---
record: hifly-voice-subtitle-parity
task: 声音克隆内联进数字人面板 + 飞影字幕参数全链接通 + 文案去服务商硬编码
date: 2026-10-23
---

## 本次执行记录：声音克隆内联 + 飞影字幕 + 文案去硬编码（hifly-voice-subtitle-parity）

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `mp-hifly-voice-subtitle-parity`，分支 `hifly-voice-subtitle-parity` |
| TDD | ✅ | `tts-voice-catalog.test.js` +3、`hifly.test.js` +4、`CreateView.avatar-clone.test.js` +10、`videogen-stages.digital-human.test.js` +2；每项先 RED 后 GREEN |
| 回归零破坏 | ✅ | 21 个相关测试文件 **466/466** 全绿 |
| 超大文件 | ✅ | `check-max-lines.js` 无新增 |
| locale 成对 | ✅ | zh/en 各 +18 键；`--keys` PASS（2238）、`--cjk` PASS（1125，无新增硬编码） |
| 同型风险锁 / 字号 / 品牌 / 绝对路径 | ✅ | r3 18/0、font-size PASS、no-brand-residue PASS、doc-abs-paths PASS |
| QM-1 打包 | ✅ | `vite build` exit 0（完整 `build:win` 见下） |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导；本行不手写状态词 |

## 一、开工前的阻断与处置（如实记录）

`start-mp-task.ps1` 首次被拒：`mp-worktree-health.ps1 -RequireClean` 判共享根不干净。
只读诊断 5 个未提交条目后确认**其中 2 个属他人进行中的工作**（`openspec/records/fix-collection-rewrite-publish-flow.md` 对应 OPEN 中的 PR #4114；`.ccg/evidence-ccg-deep-*` 从未入库），按 AGENTS「隔离创建失败 → 立即停、报告用户，绝不手动 rm」未擅动。

期间按用户授权清理了本会话已合并的 3 个 worktree（`mp-avatar-voice-clone` / `mp-digital-human-multiprovider` / `mp-voice-clone-multiprovider`），每个都走 `safe-worktree-remove.ps1 -WhatIf` 干跑确认 11 个链接全 self-contained、无进程占用、content gate 通过后才实跑，R7 三次均报 main 与基线一致。worktree 数 77 → 74。

他人会话随后处理了它负责的 2 个文件，`clean` 转 true，本任务才得以开工。

## 二、三个需求的落地

### 1. 文案去服务商硬编码

`avatarCloneErrProvider` 原为 `'HeyGen 暂时不可用，请稍后重试'`——切到飞影后报这个错会把人指错方向。改为 `'{name}暂时不可用，请稍后重试'`，由 `AvatarClonePanel` 渲染时 `.replace('{name}', providerName)` 代入当前服务商名。

新增回归测试：遍历所有 `avatarClone*` 键断言不含 `heygen`（大小写不敏感），并断言占位符存在。

### 2. 声音克隆内联进数字人面板

新增 `AvatarVoiceClone.vue`（挂在 `AvatarClonePanel` 内）+ `useAvatarClone.createVoiceClone`。

**为什么内联**：形象与声音在用户眼里是「一个数字人」的两半。此前声音克隆入口只在配音面板（`S2vConfigPanels`），用户在数字人面板克隆了形象后得不到任何提示。

**为什么不把配音面板那个搬过来**：那个面向 TTS provider 系，带 model 选择、requirements 提示、列表/重命名/删除一整套。数字人面板只要「上传录音 → 得到可用音色」最小闭环，且 provider/model 由当前数字人服务商决定、不给用户选——让用户在别处选 TTS provider 会造出「HeyGen 的形象配 ElevenLabs 的声音」这种服务商不认的组合。

**复用而非另起一套**：IPC 与 service 直接用 `tts-voice-clone`（那条链早已完全 provider 化），只做「按当前 provider 填 providerId/model」适配。另起一套会有两份样本目录、两套 TTL、两套清理。

**状态分开**：`voiceCreating` / `voiceCreateError` / `voiceCreatedName` 独立于形象克隆的 `creating` / `createError`——两者可并行操作，共用一个 `creating` 会造出「传照片时不能同时传录音」的假约束。

### 3. 飞影字幕参数全链接通

官方 `create_by_tts` 的 9 个 `st_*` 字段：`st_show` / `st_font_name` / `st_font_size` / `st_primary_color` / `st_outline_color` / `st_width` / `st_height` / `st_pos_x` / `st_pos_y`。

| 层 | 改动 |
|---|---|
| adapter | `hifly.js` 新增纯函数 `buildSubtitleFields(subtitle)`：全字段可选；颜色必须 `#rrggbb`、数值必须非负整数，非法即抛错并点名字段 |
| 主进程 | `resolveDigitalHumanInputs` 提取 `subtitle`（对象字段，不走 `nonEmpty`；只认非数组普通对象）；`runDigitalHumanGenerate` 透传 `...(inputs.subtitle ? { subtitle } : {})` |
| 前端 | 新增 `AvatarSubtitlePanel.vue`，`avatarSubtitleSupported` 判据 = `providerId === 'hifly'`；`avatarSubtitlePayload` 在关闭时返回 **undefined** 而非 `{show:false}` |
| 启动参数 | `params.subtitle = this.avatarSubtitlePayload`（仅非 undefined 时） |

**为什么关闭时不下发键**：请求体不出现 `subtitle`，让服务商用它自己的「默认不显示」语义。发 `{show:false}` 会让 adapter 白算一次校验，也让「用户没碰过字幕」和「用户显式关掉」在日志里无法区分。

**为什么整个面板不渲染而非置灰**：HeyGen 的 `create_by_tts` 没有 `st_*` 字段，给它看一堆字幕选项等于骗人。

**交互取舍**：默认只露一个开关，展开后才出现参数项。字幕是少数人需求，一上来铺 9 个控件会把数字人配置区撑得很难读。

## 三、实现中被测试逼出来的 5 个真缺陷

1. **`params.videoProvider = 'heygen'` 硬编码**（本次新发现，比三个需求本身更严重）：用户切到飞影后启动仍发 heygen，主进程会拿 HeyGen adapter 去解析飞影的 avatar id ⇒ 报错还指不到真正原因。改为取 `avatarProviderId`，并保留 `'heygen'` 兜底（provider 列表未就绪时不能发空串，主进程会解析不到 provider 而整条流水线失败；主进程 `resolveDigitalHumanProviderId` 的兜底也是这一家，两边一致）。
2. **`resolveDigitalHumanInputs` 用 `toEqual` 被破坏**：我给它加 `subtitle` 字段后，两条既有用例的精确匹配失败。改用 `toMatchObject`——每次加可选字段都要改既有断言，本身就是坏味道。
3. **`AvatarSubtitlePanel` 的 `{{ show ? '收起' : '展开' }}` 触发 CJK 门禁**：渲染端新增中文字面量被 `check-locale-sync.js --cjk` 拦下。改走 locale。（仓内 `S2vConfigPanels.vue` 有同款存量字样，属历史豁免，不是我可以照抄的理由。）
4. **跨用例异步探测污染**：`probeAvatarVoiceCloneSupport` 是 async，上一条用例的探测可能在 `beforeEach` 之后落地，把本条的结果覆盖成 false。表现为「同一用例内探测被触发两次、第二次拿到上一条的 mock 值」。修法是在用例内显式再探一次 + `flushAsync` 排空微任务。
5. **`selectPipeline` 里探测必然拿到空 provider**：`loadS2VProviders` 是异步的，选中数字人流水线那一刻 provider 列表往往还没回来。靠 `avatarProviderOptions[0]` 兜底仍不够（computed 也是空）⇒ 加 `watch avatarProviderId`，等默认 providerId 写入后再探一次。**这是真缺陷不只是测试问题**：用户先打开创作页（非数字人流水线）再切过去，探测永不发生。

## 四、对「多 provider 差异很大该怎么设计」的回答

用户问：数字人换供应商功能和选项差异大，该用统一 UI 还是各做一套？

**结论：统一布局 + 能力驱动显隐。** 三条规则：

1. **核心三要素（形象/音色/文案）永远统一**——这是数字人流水线的最小契约，两家都有，布局固定；
2. **可选能力按 capability 显隐**——一个选项只在「至少一家支持」时出现在 UI 里；当前 provider 不支持就整个不渲染，**不是置灰**（置灰会让用户以为再点点就能用）；
3. **provider 切换时重算显隐**，已选的不支持项清空。

**不做的两种方案及理由**：
- 做 N 套布局：N 份维护、N 份测试、N 份视觉基线，且 provider 间切换时用户要重新适应；
- 全堆上去再禁用：UI 常驻一半灰项，且「支不支持」这件事对用户没有信息量——他只想用当前这家。

**本次就是按这个原则落的**：字幕面板只对飞影渲染，声音克隆入口按能力显隐，文案全走 provider 名。字幕能力的判据目前是 `providerId === 'hifly'` 白名单（因为字幕是飞影独有契约字段，官方文档只在他家出现）；接第三家时若也支持字幕，把 id 加进去即可。

## 五、遗留

- **真实飞影 Token 首跑仍未执行**：字幕字段名与取值范围来自官方文档本地版，真实响应未经核对。
- **字幕位置/区域大小未开放**：`st_width` / `st_height` / `st_pos_x` / `st_pos_y` 已在 adapter 契约里支持，UI 暂用服务商默认值（面板有一句说明）。
- **`CreateView.vue` 连续第四次因数字人功能增长**：本轮的 `videoProvider` 修正 + 字幕 computed 又加了几行。下次涉及该文件的新增应优先抽组件。

## CHANGELOG 条目

# feat(video): 数字人面板内联声音克隆、飞影字幕全链接通、错误文案去服务商硬编码

- 「管理克隆形象」面板新增内联声音克隆区：支持克隆声音的服务商（HeyGen / 飞影 HiFly）可直接上传录音生成自己的音色，不必再跳去配音面板；不支持的服务商只显示一句说明，不渲染上传入口。
- 飞影 HiFly 支持字幕：在数字人配置区开启「添加字幕」后可设字体、字号、文字与描边颜色，配置随流水线下发。字幕位置与区域大小暂用服务商默认值。HeyGen 无此契约，故该项对 HeyGen 不显示。
- 修复「切换数字人服务商后启动仍按 HeyGen 生成」：启动参数此前把视频服务商写死为 HeyGen，切到飞影后会拿 HeyGen 的适配器解析飞影的形象 id。现改为按当前选中的服务商下发。
- 数字人相关错误文案不再写死服务商名：原为「HeyGen 暂时不可用」，现按当前选中的服务商显示。
