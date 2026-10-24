---
record: hifly-clone-provider-parity
task: 形象克隆按 providerId 路由远端 + 飞影 Blob 自动换 file_id
date: 2026-10-24
---

## 本次执行记录：形象克隆 provider 路由 + 飞影素材上传（hifly-clone-provider-parity）

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `mp-hifly-voice-subtitle-parity`（续用 PR #4341 分支，避免两个 PR 互相依赖） |
| TDD | ✅ | `hifly.test.js` +3（Blob 上传 / 失败不半截 / MIME 别名）、`avatar-clone-service.test.js` +3（provider 路由）；均先 RED 后 GREEN |
| 回归零破坏 | ✅ | 21 个相关测试文件 **473/473** 全绿 |
| 超大文件 | ✅ | `check-max-lines.js` 无新增 |
| locale 成对 | ✅ | `--keys` PASS（2238）、`--cjk` PASS（1125，无新增硬编码） |
| 同型风险锁 / 品牌 | ✅ | r3 18/0、no-brand-residue PASS |
| 免费首跑验证 | ✅ | 真实 token，0 积分消耗（见下） |
| 债务基线 | ⚠️ 未抬（如实记录） | `CreateView.vue` 5528 → 5630（+109），**未擅自抬**，见「四」 |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导；本行不手写状态词 |

## 一、修的第二个静默错配缺陷

上一个 commit 修了 `params.videoProvider = 'heygen'` 硬编码（启动参数）。
本次修的是**同一类缺陷在形象克隆链路的翻版**：

`avatar-clone-remote.js` 里 `const AVATAR_CLONE_PROVIDER = 'heygen'` 是唯一的 provider 来源。
而 service 层早已按 providerId 分段存 registry（`avatar-clones:v1:<providerId>:<ownerHash>`）。

后果：切到飞影 → 点「用照片创建」→ 调 **HeyGen** 的 `createAvatar` → 拿到的 avatar id 存进 **飞影** 的 registry → 生成视频时飞影不认这个 id。

**比报错更糟的是它不报错**——id 是同形的（都是 look id），只是不属于这家服务商。用户看到的是「克隆成功了但生成视频失败」。

修法：`providerId` 一律由 `owner` 传入（`owner.providerId` 由 service 从 IPC 请求解析），模块级常量降级为兜底。涉及 5 个调用点：`createAvatar` / `getAvatarStatus` / `deleteAvatar` / 补偿路径 / 删除编排。

## 二、飞影的 Blob → file_id 适配

**契约差异**：飞影的克隆接口（`create_by_image` / `create_by_video` / `voice/create`）
**只接受 `*_url` 或 `file_id`，不接受二进制**；而 `avatar-clone-service` 按 HeyGen 契约传
`{ image|video: Blob }`。

**编排放哪的取舍**：

| 方案 | 理由 |
|---|---|
| adapter 内闭环（✅ 选这个） | 「怎么把素材送到飞影」是飞影的实现细节；service/IPC/UI 零改动，且不长 provider 分支 |
| service 里分叉 | 会让 service 长出 `if (providerId === 'hifly')`，违背「统一 UI / 单一编排」原则 |

**实现**：`ensureFileId(blob, fileNameHint, kind)` 三步——`create_upload_url` 换地址 → PUT 传二进制 → 拿 `file_id`。

**后缀推断三级兜底**（踩过的坑）：Blob **没有文件名**，而飞影 `create_upload_url` 必须要 `file_extension`：
1. 显式 `fileName`
2. Blob 的 MIME 反查 —— 但 MIME 子类型不总等于扩展名，需别名表（`audio/mpeg → mp3`、`video/quicktime → mov`、`image/jpeg → jpg`）
3. `type` 兜底（photo → png / digital_twin → mp4 / audio → mp3）

## 三、免费首跑验证（0 积分）

用户提供了真实 token（premium 会员，1596 积分）。按要求**先不花积分**验证：

| 验证项 | 结果 |
|---|---|
| adapter baseUrl | `https://hfw-api.hifly.cc/api/v2/hifly`（非 heygen） |
| `create_upload_url` 真实调用 | ✅ 返回真实 `upload_url` + `file_id` |
| MIME 后缀推断 5 例 | ✅ png / mp4 / mp3 / mov / png（兜底） |
| service 侧 provider 路由 | ✅ `createAvatar` 打到的 `providerId = 'hifly'` |

**顺带说明**：`create_upload_url` 调用会产生一个未使用的 `file_id`（孤儿），但**不消耗积分**（积分只在创建克隆/生成视频时扣）。

## 四、债务基线未抬（如实记录）

`CreateView.vue` 相对 `origin/main` +109 行（5528 → 5630），触发 `maxFileLines` 熔断。

**增量来源**：本分支未合并的数字人多 provider + 字幕 + 声音克隆工作（provider 下拉 computed/data、字幕 payload computed、`probeAvatarVoiceCloneSupport`、`switchAvatarProvider`、watch 等，共约 79 行分散在 5 处）。

**这不是主干腐烂**——`origin/main` 的 CreateView 是 5528 行、基线也是 5528，一致。

**未擅自 `--update`**（AGENTS：属「改谁来守门」，必须人工过目）。且这已是同一文件**第四次**因数字人功能申请抬基线（5423 → 5495 → 5528 → 5630）。

**建议的根治方案**（下一轮做）：把 provider 下拉相关逻辑（约 45 行：computed + 探测方法 + 切换方法 + watch）抽成 `useAvatarProvider` composable，CreateView 只留模板绑定。这与已落地的 `AvatarProviderPicker.vue` / `AvatarSubtitlePanel.vue` / `AvatarVoiceClone.vue` 是同一条路。

## 五、遗留

- **真实克隆未执行**（需花积分）：`create_by_image` / `create_by_video` / `voice/create` 均未真实调用。用户要求「测试一两条即可、选最少秒数」，上一条视频已花 14 积分；克隆需额外素材且计费，等用户明确指示再做。
- **`KNOWN_METHODS` 仍未登记形象三方法**：`callAdapter` 的 `supports()` 闸门会 fail-closed。这是计划内的（等真实 clone 首跑核对字段后才登记），但意味着**当前点「用照片创建」对两家都会返回「provider 不可用」**——这是已知且预期的 fail-closed，不是回归。
- **声音克隆未接进形象克隆编排**（用户问题中的选项 A/B 未定）：当前声音克隆走 `tts-voice-clone` 独立链路（已 provider 化、可用），未与形象克隆合并成「一次操作得形象+声音」。

## CHANGELOG 条目

# fix(video): 形象克隆按当前服务商路由，飞影支持直接上传素材

- 修复「切换到飞影后克隆形象，实际调的是 HeyGen」：形象克隆此前把服务商名写死为 HeyGen，而克隆记录已按服务商分开存放，导致拿到的形象 id 不属于当前服务商、生成视频时才失败。现按当前选中的服务商路由。
- 飞影 HiFly 支持直接上传照片/视频克隆形象：飞影接口只接受文件 id，应用现在会自动完成「换取上传地址 → 上传 → 拿文件 id」三步，无需用户手动上传到别处再填链接。
- 支持从 mp3 / mov / jpeg 等常见格式自动推断扩展名（此前只能按文件名后缀）。
