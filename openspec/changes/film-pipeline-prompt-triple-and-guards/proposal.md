# film-pipeline-prompt-triple-and-guards — 影视工程流水线：提示词三分 / 生成闸门 / 出站安全

> 依据：`01-docs/RESEARCH-AI-FILM-OPENSOURCE-2026-10-19.md`（19 个 AI 影视开源项目调研）
> §4.2 复用价值梯队 + §5.2 批次二/三 + §3.21 连续性七档武器 + §3.22.1 F 清单×七档映射
> ｜前序落地：`01-docs/PRD-FILM-PROMPT-ASSETS-2026-10-20.md`（批次一，PR #4052）
> ｜调研审核记录：`01-docs/RESEARCH-AI-FILM-REVIEW-2026-10-19.md`
>
> **改动边界（用户指定）**：只动「影视工程 → 自动」标签 与「视频创作 → 流水线 → 提示词优化（stage `optimize`）」两处。
> 其余标签（画布 / 项目案例 / 流水线创作 / 快速渲染 / 历史记录）**只允许被"接线"影响，不允许改变其交互语义**。

---

## 一、范围与边界

### 1.1 动什么

| 目标面 | 定位 | 本次改动 |
|--------|------|---------|
| 影视工程 → **自动**标签 | `FilmAutoPanel.vue` + `auto-plan.js` / `auto-project.js` / `auto-runner.js` / `video-gen.js` / `kit-loader.js` | 分镜提示词拆三份、生成前就绪度判定、锁镜保护、成片下载出站安全、外部工具体检 |
| 视频创作 → **提示词优化**阶段 | `story2video-stages.js` 的 `story2video_optimize` 阶段 + `story-context-engine.js` | 角色身份锚点与参考图优先级声明进入优化上下文 |

### 1.2 不动什么

- 「画布」标签（`film-canvas/`、`useFilmCanvas.js`）——本次**零改动**。
- 「项目案例」标签（`FilmEngineeringView.vue`）——仅允许新增"方法论分区"这一**只读展示**（见 F1-UI），不改既有四标签的结构与语义。
- 「快速渲染」「历史记录」「流水线创作」——零改动。
- `packages/python-backend/` 全域——本次不落任何 Python 改动（详见 §六 的 D-4）。

---

## 二、现状缺口（实测取证，非推测）

调研报告 §4.1 的差距表写于 2026-10-19；**批次一已于 2026-10-20 落地（PR #4052）**，故本表是重新实测后的版本。

### 2.1 已就位（不再重复做）

| 能力 | 证据 |
|------|------|
| 镜头语言枚举 | `film-kit/shot-grammar.json`（12.2KB，10 景别/12 运镜/8 机位/6 光线/8 特效/3 情绪/4 时长档） |
| 剧本合规清单 | `film-kit/compliance-checklist.json`（11.5KB，12 条 blocker 5 / warn 7） |
| 剧组色盘 | `film-kit/palette.json`（4.6KB，4 主色 + 2 扩展 + 5 情绪映射 + 漂移治理） |
| 任务级提示词库 | `film-kit/prompts/tasks/<task>/{zh,en}/{system,user}.md`（4 任务 × 4 文件）+ `prompt-library.js` |
| 方法论扩容 | `prompt-doctrine.json` v2：11 blocks / 14 rules / 2 recipes / 8 失败台账 / 10 glossary |
| 单镜时长可算 | `shot-duration.js`：`resolveShotDurationMs` 四级来源链 `user→tts→formula→tier` |
| 实体强引用（连续性武器 1） | Shot 的 `refTokens`（UUID），`kit-loader.js:126-131` |

### 2.2 真实缺口（本方案要补的）

| # | 缺口 | 实测证据 | 后果 |
|---|------|---------|------|
| G-1 | **提示词一段到底**：Shot 只有单一 `prompt` | `shot-library.json:5`；`kit-loader.js:121`（`prompt` 必填 ≤50000）；全目录 grep `imagePrompt\|videoPrompt\|endFramePrompt` **零命中** | 最长单镜提示词 13,922 字符，模型注意力衰减、中段约束被忽略；重试无效 |
| G-2 | **无生成就绪度概念**：成本闸是全批次级 | `video-gen.js:279-307`；`costCheck.shots[]` 仅 `{index, shotId, title, aspect, seconds}`（`:297-303`） | 缺提示词/参考图坏/档位不支持的镜**确认后才失败**——用户白付一次确认 |
| G-3 | **成片下载出站无防护** | `video-gen.js:116-145 downloadToFile`：**允许 http**、3xx **无限递归跟随**、**无私网段拦截**、**无 DNS 校验**、**无大小上限**、**直接写目标文件** | provider 回传 `http://169.254.169.254/` 可打穿云元数据；下载中断留半成品 mp4 被下游当完成 |
| G-4 | **工具缺失在合成期才暴露** | `film-render.js:278/304` `findFfmpeg()` 失败 → 到合成阶段才返回「FFmpeg 不可用，无法合成成片」 | 用户跑完 8 镜才发现环境缺件 |
| G-5 | **重跑会覆盖人工确认过的镜** | `auto-project.js` shot patch 白名单仅 `prompt/refPaths/seconds/title`（`:295`）；无 `locked` 字段（全目录零命中） | 人工精修过的镜在批量重跑时被覆盖 |
| G-6 | **并发写无版本保护** | `auto-project.js:246-259 writeProject` 直接覆盖写；`auto-plan-fingerprint.js` 是**审计指纹**不是冲突锁 | 两个会话同时改同一任务 → 后写覆盖先写 |
| G-7 | **提示词优化阶段无身份锚点/参考图优先级** | `story2video-stages.js:1747-1798` 只有 `negativeAnchors`/`characters` 文本锚点；story2video 主管线**不传参考图**；`story2video-engine/src` 无 identity 相关文件 | 跨镜角色漂移；多角色同框串脸 |
| G-8 | **单镜时长链路断在项目文件** | `auto-project.js:209-221` 的 shot 结构**不落** `durationMs`/`durationSource` | 规划层算出的时长在续跑/重生成时丢失，回落全局 `seconds` |

### 2.3 调研报告结论被实测推翻的两处（本方案据此修正）

> 调研报告自身记录了 7 次「外部判断被回到本仓实测推翻」的自我修正。本次实测又推翻 2 处，**修正方案以本节为准**：

| 报告原判 | 独立实测证据（文件:行号 + 代码片段） | 本方案修正 |
|---------|------------------------------------|-----------|
| F11b SSRF 防护**完全没有**，落点新建 `shared-utils/src/net/safe-fetch.js` | 影视工程「原片下载」通道**已实现完整出站合同**。`shot-downloader.js:54-70`：<br>`if (parsed.protocol !== 'https:') return { ok:false, reason:'下载通道仅允许 https 协议' }`<br>`if (isPrivateAddress(hostname)) return { ok:false, reason:'不允许访问内网地址（SSRF 防护）' }`<br>`:130-144`：每跳请求前 `addresses = await lookupImpl(host)` → `if (addresses.some((a) => isPrivateAddress(a))) return { ok:false, error:'主机解析到内网地址，拒绝下载（SSRF/DNS 重绑定防护）' }`<br>`:154-166`：3xx 手动逐跳，每跳 `validateDownloadUrl(next, allowedHosts)`<br>`:12`：`单文件上限 MAX_DOWNLOAD_BYTES=500MB`<br>`:210`：`fs.renameSync(tmpPath, finalPath)`（先写 `.part`，ffprobe 通过才改名） | **不新建模块**。把既有合同**复用到 G-3 的裸奔路径**；`safe-fetch.js` 不做 |
| F11d 外部工具体检落 `packages/python-backend/src/multi_publish/core/doctor.py` | 影视工程走的是 **Electron 主进程**的 ffmpeg：`film-render.js:278` `const ffmpeg = _testRunTool ? (findFfmpeg() \|\| 'ffmpeg') : findFfmpeg()`；`:279` `if (!ffmpeg) return { success:false, error:'FFmpeg 不可用，无法合成成片' }`。`packages/python-backend/src/multi_publish/core/` 目录实测 12 个文件，**无 `doctor.py`** | 落点改为 **Electron 主进程侧**（出片前体检），Python 侧不动 |
| F11c 就绪度闸门落 `story2video-engine/src/shotReadiness.ts` | `packages/story2video-engine/src/` 实测 21 个文件（`index/history-prompt/segment/slideshow/storyboard-prompt/text-segmentation/...`），**无** `shotReadiness`；影视工程的成本闸实测在 `apps/desktop/electron/services/film-engineering/video-gen.js:279-307` | 落点改为 **内联进既有 `costCheck`**（研究报告 §5.2 已明示"非新增第二道闸"），不新建 TS 文件 |

### 2.4 未消费字段台账（统一判据：**字段是否有明确的读取点**——消费或展示）

「字段已引入但没人读」是死代码的温床。本方案对所有新增字段用**同一把尺子**：**是否有明确的读取点**（是否已写明"由谁、在什么条件下读它"）。读取点分两类：**消费**（进入请求/计算）与**展示**（给人核对）。

| 字段 | 读取点 | 判定 | 处置 |
|------|--------|------|------|
| `imagePrompt` | **消费**：`video-gen.js` 图片请求直接取该字段 | ✅ 有消费 | 本批次落地 |
| `videoPrompt` | **消费**：`video-gen.js` 视频请求取该字段 | ✅ 有消费 | 本批次落地 |
| `endFramePrompt` | **展示点已定义**（见下）；**消费路径已定义但前置未就绪** | 🟡 **有读取点，消费待前置** | 保留字段与派生；展示点=规划确认卡逐镜「尾帧」只读行 + 分镜节点详情；spec 明确写「当前 SHALL NOT 送入 provider」。**解封判据**：① provider 适配器支持「首帧 + 尾帧」双图入参（当前 `video-reference-inputs.js:30-34` 的 3 家仅支持单图）；② 该镜已绑定两张参考图；③ 公网图床通道可用（报告 F28，未落地）。**三项齐备 ⇒ 解封消费**；未齐备 ⇒ 该字段作为**长期保留字段**存在（不是无期欠账，是「等外部能力」） |
| `viewpointId`（Scene 视角变体） | **无任何读取点**——没有函数会读它，连展示位都没有 | 🔴 **无读取点** | **本批次不做**（见 §六 D-2） |

> **判据说明**：`endFramePrompt` 与 `viewpointId` 的差别不在"是否已进入请求"，而在**有没有明确写下来的读取点**。前者已写明展示位置与消费前置条件，属"等前置"；后者连读取方都不存在，属"无归属"。两者都被显式登记在案，不靠"暂时没接"含糊过去。
>
> **展示点不得成为"什么都展示"的垃圾桶**：`endFramePrompt` 的展示位限定在「规划确认卡逐镜只读行」与「分镜节点详情」两处，供用户核对首尾帧衔接质量，**不进入任何生成路径**。验收 V-23 机械核对：`.js` 中**不存在**把 `endFramePrompt` 送入 provider 请求的读取点。

### 2.5 存量分镜的 `videoPrompt` 边界（回应评审 i1，Critical）

评审 i1 指出：若 `videoPrompt` 对存量分镜回落 `imagePrompt`（= 同一段长文），则 **G-1「注意力衰减」在存量 153 条上根本不成立**，F-A 的收益只剩"新写的分镜"。**问题成立**。但**不能靠机械重算存量解决**——实测证据：

```
shot-library.json 共 153 条；shot[0].prompt 长 13,922 字符，
且是**无块标记的自由文本**（开头 "EXACT 2 CHARACTERS" 后接角色长描述），
没有 SCENE CONTEXT / ACTION TIMING 等可机械切分的块分隔标记。
```

按运镜/机位关键词做启发式抽取会把 153 条行业分镜的运镜信息抽漏 ⇒ **画质回归**，比"长 prompt"更糟。

⇒ **本批次的处置（部分采纳）**：

| 对象 | 处置 | 依据 |
|------|------|------|
| **自动模式新规划的分镜** | `auto-plan.js` **真正重算** `videoPrompt`：只保留「运镜 + 主体 + 时长内的变化」，**不含**静态画面全量 ⇒ 显著短于 `imagePrompt` | 这才是 F-A 的主战场；**新增断言**「自动模式新规划分镜的 `videoPrompt` 长度显著小于 `imagePrompt`」（验收 V-29） |
| **存量 153 条分镜** | 归一化口径为 `videoPrompt ??= ''`（**空**，不是回落 `prompt`）；视频请求回落 `imagePrompt`，**行为与本次变更前逐字一致** | 存量是**行业案例资产**（给人看/给人抄的模板），不是系统自动产物；机械重算会丢信息 |
| **存量长 prompt 的真正治理** | 列为**后续项**（不阻塞本批次）：用提示词优化引擎做**一次性批量重算 + 人工审核**（153 次调用），产出新的 `videoPrompt` 落库 | 一次性资产生成，不进运行时；需人工审核，范围独立 |

> **明确不假装**：本批次**不解决**存量分镜的视频提示词过长问题（§六 D-14 列入不做项）。归一化口径由 `videoPrompt ??= prompt` 改为 `videoPrompt ??= ''` 正是为了让"存量没被解决"这件事**在数据上可见**（`videoPrompt` 为空 ⇒ 回落 `imagePrompt`），而不是被 `??= prompt` 掩盖成"已解决"。

---

## 三、选型：选了什么、为什么、许可证结论

### 3.1 选中的条目

| 本方案编号 | 对应报告项 | 报告梯队/位置 | 为什么选（引用报告 + 本仓实测） | 许可证结论 |
|-----------|-----------|--------------|--------------------------------|-----------|
| **F-A** 提示词三分（首帧/视频/尾帧） | 报告 §4.2 第二梯队 #12、§5.2 批次二 F6 | 「镜头语言结构化」差距标 **大**；`prompt-doctrine` 已有 `frame_constraint`（首尾帧 21 条）+ `transition_medium_cover`（介质掩护）**数据已就绪但无处消费** | 数据已备而消费端缺位，是投入产出比最高的一处：只改派生与消费，不迁 153 条存量 | 🟡 **只能抄思路**——来源 `moyin-creator` 为 **AGPL-3.0**。**禁止复制其源码**；三分结构属通用工程做法，自行实现。**提示词文本不受版权保护**，可参考其规则表述 |
| **F-B** 生成就绪度闸门 | 报告 §4.2 第一梯队 #12「就绪度闸门」 | 报告 §5.2 批次三 F11c：Jellyfish **Apache-2.0**，「可安全复制」；且报告已给出"内联进既有 costCheck，非新增第二道闸"的精确口径 | 成本闸已被测试锁死（`film-video-checkpoint-integration.test.js:140-172`），**不能新增第二道闸**；内联是唯一不破既有锁的做法 | 🟢 **可抄代码**（Apache-2.0，保留 NOTICE/版权头）。本仓实现按自身数据结构重写，仍标注来源 |
| **F-C** 出站安全复用 | 报告 §4.2 第一梯队 #11「出站媒体 SSRF 防护」 | 来源 `waoowaoo` **Elastic 2.0**（桌面端自用不触发托管服务禁令）；但**本仓已有更强实现**（`shot-downloader.js`） | 见 §2.3 修正 1：不新建，只复用。既有实现比研究报告假设的更完整；**并补本仓缺的两项**：IP pinning（消 TOCTOU）+ 端口 443 + 主机分级策略（见 §4.2.1） | 🟢 **本仓自有实现，无需引入外部代码**。参照外部思路时仅取"私网段 + DNS 重绑定 + 逐跳重校验"三点（Elastic 2.0 允许参考） |
| **F-D** 外部工具体检 | 报告 §4.2 第一梯队 #26、§5.2 批次三 F11d | 报告来源 `app.yumcut.com` **PolyForm NC 1.0**（科研非商用已解禁）；报告建议"只做存在性校验，不硬钉 7.1.1"（会误判大量环境） | G-4 是真实可感知缺陷；报告的"只做存在性"建议已被本方案采纳（避免制造新的假失败） | 🟡 **只能抄思路**。本仓实现自研（读取自身 `findFfmpeg()` 解析结果 + 版本输出解析） |
| **F-E** 单镜锁定 | 报告 §4.2 第二梯队 #9 | 差距标「**中**」；`ai-art-engine` GPL-3.0 → 报告已标「仅思路」 | G-5 真实；消费方明确（自动模式重跑时跳过锁镜），不会变成死代码 | 🟡 **只能抄思路**（GPL 传染，**禁止复制代码**）。字段与跳过逻辑自研 |
| **F-F** 身份锚点 + 参考图优先级 | 报告 §4.2 第二梯队 #19、§3.21 武器 2 | 报告 §3.21：mulpub 已握武器 1（实体强引用 ★★★★★），但**武器 2–5、7 全缺**；武器 2 成本最低（★★★★） | G-7 真实；报告 §3.22.1 已把 F15 **提级到批次一**（"最低成本换最强档"），批次一未做，本次补上。**边界**：story2video 主管线**当前不传参考图**（实测），故「参考图优先级声明」**按「无图则不生成」条件渲染**（回应评审 i2）——无参考图时不产出该声明，只产出角色身份锚点 | 🟡 **只能抄思路 + 提示词可抄**——来源 `moyin-creator` AGPL-3.0。**报告明确：提示词不受版权保护**，角色身份锚点/参考图优先级/防串脸三类**提示词**可重写后使用 |
| **F-G** 乐观锁（expectedRevision） | 报告 §4.2 第一梯队 #5 | 来源 `Toonflow-app` **MIT**；报告列入第一梯队"立即可落地" | G-6 真实；MIT 可抄 | 🟢 **可抄代码**（MIT，保留版权声明）。本仓按自身 project.json 结构实现 |
| **F-H** 方法论 UI 分区 | 报告 §5.2 批次一 F1 收尾项 | 批次一已把 doctrine 扩到 11 块 + 台账 + 配方，但 PRD §九 明确"新增 4 个方法论块未接入 UI，方法论标签页目前仍按 7 块渲染" | 数据已就绪、UI 未接线，是**批次一留下的确定性缺口**，且不引入新运行时风险 | 🟢 纯本仓资产，无外部代码 |
| **F-I** 任务级提示词接入规划流程 | 报告 §5.2 批次一 F30 收尾项 | PRD §十 明确"库与渲染器已就绪，规划流程未接"；`auto-plan.js:243` 仍走 `buildTemplatePrompt`，**不读 doctrine、不读 promptLibrary** | 同上，批次一遗留；接上后 `generate_shot_prompt` 任务模板才真正被用 | 🟢 纯本仓资产 |
| **F-J** 导入 IPC 接 `requireAssets: true` | PRD §十 第 3 项 | `kit-loader.js` 已提供 `requireAssets` 严格模式，导入 IPC 未启用 | 严格模式能让"资产缺失"在**导入时**暴露，而不是出片时 | 🟢 纯本仓资产 |

### 3.2 未选中的条目与理由

| 报告项 | 为什么不选 |
|--------|-----------|
| §4.2 第一梯队 #1 剪映草稿生成 | 工作量「**大**」且需前置 spike 实测草稿格式版本兼容（报告 §5.2 已上调）。超出本次范围 |
| §4.2 第一梯队 #10 两遍 loudnorm + BGM ducking | **硬墙**：打包 ffmpeg 滤镜白名单仅 11 个，无 `loudnorm`（`apps/desktop/scripts/stage-media-tools.js:10-22`），须改 `media-tools-lock.json` + 重打包实测 → 混合 PR |
| §4.2 第一梯队 #4 / #7 音频三件套（F8c 三态对齐、F11 字幕多路回退） | F8c 需 `tpad` 滤镜（同样受白名单约束）；本仓合成走 concat 直拷、无 xfade（`film-render.js:308`），音画不同步压力不成立 |
| §4.2 批次四 F12 VLM 质检闭环 | **前置缺失**：`adapters/_base/base.js` 无任何视觉方法；且自动重试会绕过成本闸（测试锁死）。拆出的 F12-0 未做则 F12 不可开工 |
| §4.2 批次四 F13 场次并发 | 现状批内并发=2（`production-runner.js:14`），方向是场间提并发；与本次两处目标面无直接关系 |
| §4.2 批次四 F14 跨集 Series Bible | 工作量「**大**」；依赖 F7 视角变体概念（本次不做，见 §六 D-2） |
| §4.2 批次四 F16 组级多镜头提示词 / F17 时长双向归一 / F18 分片渲染 / F19 checkpoint | 属批次四；F17 需 ZJT 署名（保守处理），本次不引入新的署名义务面 |
| §4.2 批次二 F7 视角变体 `viewpointId` | **无消费方 = 死代码**（见 §六 D-2） |

---

## 四、落点与规模

### 4.1 文件级清单

| 编号 | 文件 | 改什么 | 预计行数变化 |
|------|------|--------|------------|
| F-A | `apps/desktop/electron/services/film-engineering/kit-loader.js` | 加载时归一化 `imagePrompt/videoPrompt/endFramePrompt`（`videoPrompt ??= ''`，**不回落 prompt**，见 §2.5）；`KIT_FILES` 不变（同文件） | +45 / -5 |
| F-A | `apps/desktop/electron/services/film-engineering/auto-plan.js` | 规划期**重算**三分：首帧=静态画面全量，视频=**仅运镜+主体+时长内变化**（显著更短），尾帧=frame_constraint 规则 | +70 / -15 |
| F-A | `apps/desktop/electron/services/film-engineering/video-gen.js` | 图片走 `imagePrompt`、视频走 `videoPrompt`（`videoPrompt` 为空回落 `imagePrompt`）；**`endFramePrompt` 本批次不送入 provider**（消费前置见 §2.4） | +25 / -8 |
| F-A | `apps/desktop/electron/film-kit/SCHEMA.md` | 三字段规格 + 合计上限口径 | +30 / 0 |
| F-A | `apps/desktop/electron/film-kit/shot-library.json` | **零改动**（153 条存量不迁，靠加载期归一化） | 0 |
| F-A | `apps/desktop/src/views/film-auto/ShotTailFrameRow.vue`（**新建**） | 承载「尾帧只读行」——`endFramePrompt` 的展示落点（回应评审 i4：§2.4 声明的读取点必须有真实文件承载） | +70 / 0 |
| F-B | `apps/desktop/electron/services/film-engineering/video-gen.js` | `costCheck` 内联 `readiness` 字段 + 逐镜 `ready`/`reason` | +50 / -5 |
| F-B | `apps/desktop/electron/services/film-engineering/shot-readiness.js`（**新建**） | 逐镜就绪度**判决器**。**分层**（回应评审 i1）：**IO 探测层**（调用侧）先产出「事实入参」`facts`——参考图可解析性、provider 能力（画幅/秒数档位）**在调用侧读文件与能力表后填入**；本模块**只对 `facts` 做纯函数判决**（零 IO、可单测）。入参形状：`{ shotId, index, prompt, durationMs, aspect, seconds, locked, facts: { referenceResolvable, aspectSupported, secondsSupported } }`。**`skipped`（锁镜）不计入成本汇总**——确认卡的「预计调用次数」与费用只统计 `ready` 的镜 | +130 / 0 |
| F-C | `apps/desktop/electron/services/film-engineering/egress-guard.js`（**新建**） | 从 `shot-downloader.js` 抽出可复用的出站合同（私网段/DNS/逐跳/上限/`.part`+ffprobe→rename） | +180 / 0 |
| F-C | `apps/desktop/electron/services/film-engineering/shot-downloader.js` | 改为调用 `egress-guard`（**既有可观察行为不变**；实现层新增 IP pinning 属有意增强） | +10 / -40 |
| F-C | `apps/desktop/electron/services/film-engineering/film-video-downloader.js`（**新建**，PR-5 纯重构） | 把 `video-gen.js` 的 `downloadToFile` 原样搬出（**行为不变**），PR-6 只在此模块换实现 | +60 / -30 |
| F-D | `apps/desktop/electron/services/film-engineering/tool-doctor.js`（**新建**） | ffmpeg/ffprobe 存在性 + 版本解析；**只做存在性校验**（不硬钉版本下限） | +110 / 0 |
| F-D | `apps/desktop/electron/services/film-engineering/video-gen.js` | 出片前体检；缺失时返回可操作错误码 | +25 / 0 |
| F-E | `apps/desktop/electron/services/film-engineering/auto-project.js` | shot 结构加 `locked`；patch 白名单加 `locked` | +25 / 0 |
| F-E | `apps/desktop/electron/services/film-engineering/auto-runner.js` | 重跑跳过 `locked` 镜 | +25 / 0 |
| F-E | `apps/desktop/src/views/film-auto/FilmAutoPanel.vue` | 自动模式逐镜行显示锁标记 + 锁定/解锁交互。**锁定走既有 `film-engineering:auto-*` 的分镜 patch 通道**（`auto-project.js` 的 `patch` 白名单新增 `locked`），不新增 IPC 通道 | +40 / 0 |
| F-F | `apps/desktop/electron/services/story-context-engine.js` | 角色身份锚点提取（硬上限 4 条）+ 参考图优先级声明构造 | +110 / 0 |
| F-F | `apps/desktop/electron/services/story2video-stages.js` | optimize 阶段把锚点与优先级声明注入 prompt-engine context | +50 / 0 |
| F-F | `apps/desktop/electron/film-kit/prompts/tasks/generate_shot_prompt/{zh,en}/` | 增补身份锚点/参考图优先级/防串脸三类提示词（**外置，不内联进代码**） | ±30 / 0 |
| F-G | `apps/desktop/electron/services/film-engineering/auto-project.js` | `project.json` 加 `revision`；写前比对，冲突 fail-closed。**并发正确性靠独占锁文件**（`fs.open(lock, 'wx')` 串行化「读 revision → 比对 → 自增 → 写」），**rename 只负责落盘原子性**（tmp → fsync → rename）——rename 本身**不提供 compare-and-swap 语义**（两进程可各自读到同一 revision 再先后 rename，后写仍覆盖先写） | +70 / 0 |
| F-H | `apps/desktop/src/views/FilmEngineeringView.vue` | 方法论分区（11 块 + 台账 + 配方 + glossary） | +60 / 0 |
| F-G/H | `apps/desktop/src/locales/film-engineering/{zh,en}.js` | 新增用户可见文案成对 | +40 / +40 |
| F-I | `apps/desktop/electron/services/film-engineering/auto-plan.js` | 规划期用 `prompt-library` 的 `generate_shot_prompt` 任务模板 | +35 / -5 |
| F-J | `apps/desktop/electron/services/film-engineering/film-engineering-service.js` | 导入 IPC 传 `requireAssets: true` | +10 / 0 |
| — | 测试 | 新增 `shot-readiness.test.js` / `egress-guard.test.js` / `tool-doctor.test.js`；扩充 `auto-plan.test.js` / `auto-project.test.js` / `auto-runner.test.js` / `kit-loader.test.js` / `video-gen.test.js` / `story-context-engine` 相关测试 | +900 / 0 |
| — | 文档 | `01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md`（本批详细规格）、既有 PRD/ARCH 同步 | +600 / 0 |

**合计**：新建 3 个源文件 + 3 个测试文件；改动 13 个既有文件；净增约 **2,200 行**（含测试与文档），其中运行时源码约 **+820 行**。

### 4.2 安全合同摘要（供独立评审逐条核验）

复用自 `shot-downloader.js` 的出站合同，**逐条带行号**：

| # | 规则 | 既有实现位置 | 复用后对成片下载的适用范围 |
|---|------|------------|--------------------------|
| S-1 | 仅 `https`（明文 http 一律拒绝） | `:60-62` | ✅ 适用（成片 URL 也必须 https） |
| S-2 | 主机名不在可信清单内即拒 | `:68-70` | ✅ **适用**（见下方「成片下载的主机策略」）：可信清单 = provider API 主机（自动派生）∪ `assetDownloadHosts`（可配） |
| S-3 | 主机名命中内网黑名单即拒。`isPrivateAddress` 的覆盖面 SHALL **不限于** IPv4 私网段 | `:40-46`（`isPrivateAddress`）、`:65-67`（调用点） | ✅ 适用，且**本批次补齐**（见 S-3a） |
| S-4 | **每次请求发起前**解析主机名，解析结果含内网地址即拒 | `:130-144` | ✅ 适用，**并追加 IP pinning**（见 §D5.1 增补：把已校验的解析结果 pin 进 socket 的 `lookup` 覆写，消除「校验用 A 解析、连接用 B 解析」的 TOCTOU 窗口） |
| S-5 | 3xx 手动逐跳跟随，每跳重过 S-1/S-3/S-4，跳数有上限（`MAX_REDIRECTS`） | `:154-166` | ✅ 适用 |
| S-6 | 单文件字节上限（500MB），流超限立即中止 | `:12`、`:~180` | ✅ 适用 |
| S-7 | 先写 `.part`，ffprobe 探测通过才 `rename`；失败路径清理 `.part`，不留半成品 | `:210`、`:221-232` | ✅ 适用 |
| S-8 | 落盘目录必须位于受控媒体根内 | `validateDestDir`（`:110`） | ✅ 适用 |
| S-9 | **端口约束**：仅允许可信清单声明的端口（缺省 `{443}`） | 无既有实现（本次新增） | ✅ 适用（端口集随可信域配置声明，缺省 443） |
| S-3a | **内网判定覆盖面**：`isPrivateAddress` SHALL 覆盖 IPv4 私网段（`10./8`、`172.16/12`、`192.168/16`）、`127/8`、`0.0.0.0/8`、`100.64/10`（CGNAT）、链路本地 `169.254/16`；IPv6 `::1`、`fc00::/7`（ULA）、链路本地 `fe80::/10`；**IPv4-mapped IPv6**（`::ffff:10.0.0.1` 等，须先还原成 IPv4 再判）；**纯十进制 / 八进制 / 十六进制 IP 字面量**（`http://2130706433/` = 127.0.0.1、`http://0177.0.0.1/`）SHALL 先**规范化**再判定 | 无既有实现（本次新增） | ✅ 适用 |

> **「行为逐字不变」的准确口径**（回应评审 i3）：`shot-downloader` 重构后，**既有 23 条用例断言的可观察行为全部不变**（拒绝判定、错误文案分类、落盘/清理语义、跳数上限、体积上限）。但**实现层新增了 IP pinning**——这是**有意的安全增强**，不是"逐字不变"。因此本方案把二者分开记账：既有断言全绿（回归保证）**+** 新增独立 pinning 用例（增强保证），二者缺一不可。

> 评审可独立核验：以上每条都能在 `apps/desktop/electron/services/film-engineering/shot-downloader.js` 的对应行号找到实现与既有测试断言。

### 4.2.1 成片下载的主机策略（回应评审 i2 / 第 3 轮 i3，Critical）

评审第 2 轮 i2 指出：放弃 `allowedHosts` 后，**唯一的主机约束只剩私网黑名单，公网任意域名可下载，等于放开出站面**。我方第 2 轮回应为"L1/L2 两级 + 端口 443 + 状态可见"，但**第 3 轮 i3 进一步指出**：L1 缺省仍无白名单，且"仅提示可见而非阻断 ⇒『不是静默放开』只在文案层面成立"。**该批评成立**——文案层的"可见"挡不住一次真实的越权下载。

⇒ **最终口径：缺省 fail-closed + 同源自动预填 + 放宽需显式勾选且留痕。**

| 要素 | 规则 |
|------|------|
| **可信主机集合** | = { provider **API base URL 的主机名**（**自动派生**，无需配置） } ∪ { `assetDownloadHosts`（模型服务商配置，运营可配，逗号分隔） } |
| **允许端口集** | 随可信域配置声明（`assetDownloadPorts`，缺省 `{443}`） |
| **默认行为（fail-closed）** | 成片 URL 主机不在可信集合内 ⇒ **拒绝下载**，错误文案：「素材域名 {host} 不在可信清单内。请在『模型提供商 → {provider}』中配置『素材下载可信域』，或本次显式允许外部素材域名。」 |
| **放宽通道（需显式授权）** | 用户可在成本确认卡**显式勾选**「本次允许从外部素材域名下载」；勾选产生**运行期一次性令牌**（**只存内存，不落盘**；任务结束即失效）；**未勾选 ⇒ 拒绝下载**。审计只记「发生过一次外部域名授权」这一事实，**不保存任何可用于放行的授权位** |
| **其余合同** | S-1 https / S-3 私网段 / S-4' DNS 校验 + IP pinning / S-5 逐跳重校验 / S-6 体积上限 / S-7 `.part`+ffprobe→rename / S-8 受控媒体根 —— **全部无条件生效**，不放宽通道也不豁免它们 |

**为什么这样既堵住又不打死用户**：

| 场景 | 结果 |
|------|------|
| provider 的素材与 API **同源**（多数 provider） | API 主机自动进可信集合 ⇒ **零配置可用** |
| provider 的素材走**独立 CDN** | 运营在模型设置里配一次 `assetDownloadHosts`（+ 端口集）⇒ 之后可用；未配时给出**可操作**指引而不是静默失败 |
| 用户临时要访问一个未登记的素材域 | 确认卡**显式勾选**一次并留痕；不勾选就拒 |

**为什么不用"固定公共 DNS"或"任意公网主机"**：前者破坏本地 DNS/hosts/内网可用性且公共 DNS 本身可被投毒；后者就是第 3 轮 i3 批评的"控制面押在第三方响应上"。

**配套新增**：模型服务商配置新增可选 `assetDownloadHosts` 与 `assetDownloadPorts`（缺省空 ⇒ 只认 API 同源主机 + 443）。

**上线前必做（否则会打死存量用户）**（回应评审 i5）：
1. **实测各视频 provider 的素材域名与 API 主机是否同源**（逐个 adapter 跑一次真实出片并记录素材 URL 主机），产出「同源比例」清单；
2. 对**非同源**的 provider，**上线前**在模型服务商配置里预置好 `assetDownloadHosts` 与端口（随随包资产或运营配置下发）；
3. 对仍无法确定的 provider，给出**一次性引导**：首次出片被拒时，在确认卡上直接给出「去配置可信域」的跳转，而不是只给一句错误文案。

> **不做「默认放开」来图省事**——那正是评审第 2/3 轮连续两次打回的点。宁可上线前多跑一轮实测。

### 4.3 防膨胀硬约束（沿用报告 §5.5 + 本仓纪律）

1. **提示词文本一律外置**为 `.md`/`.json`，禁止内联进 `.js`（F-F 的三类提示词进 `film-kit/prompts/tasks/`，经 `prompt-library.js` 渲染）。
2. **新增文件单文件 ≤500 行**；`egress-guard.js`（~180）与 `shot-readiness.js`（~130）均留余量。
3. **外置提示词走 `kit-loader` 的 fail-closed 校验**；`prompts/tasks/**` 已在 `KIT_FILES` 覆盖范围内（`kit-loader.js:341-364`），不新增目录登记。

---

## 五、排期与依赖（PR 拆分）

### 5.0 每个 PR 的落地路径（回应评审 i8，与本仓 SOP 对齐）

每个 PR 都是**独立的 worktree + 独立的分支**，从最新 `origin/main` 重新开：

```bash
# 1) 建隔离 worktree（共享根只做 main-only 协调，禁止在共享根改运行时代码）
pwsh -File scripts/start-mp-task.ps1 -TaskName <pr-slug>
# 2) 在 worktree 内改代码 + 跑定向测试 + 跑门禁
cd <worktree>
node scripts/classify-docs-only.js --base=origin/main --head=HEAD   # commit 之后
# 3) 提交（禁止 --no-verify）→ 推分支 → 开 PR → CI 全绿 → 自动 squash 合并
```

**openspec 五件套的归属**：`proposal.md` / `design.md` / `tasks.md` / `specs/film-engineering/spec.md` / `.openspec.yaml` **在 PR-1（方案）一次落全**，后续 PR 只更新 `tasks.md` 的勾选与 `openspec/records/<分支名>.md` 的执行证据。**全部实现 PR 合并完毕后**，才做 `openspec archive`（`proposal → design → specs → tasks → archive`）+ 归档同步（`openspec/specs/film-engineering/spec.md` 落库）+ CHANGELOG。

**执行记录**：`openspec/records/<分支名>.md` 每个 PR 一份（按分支名命名），含 `| 远程同步 | 由门禁推导 |` 表行与对应 bullet。

> 拆 PR 原则：① 体积小 → 对抗性审查不被截断（批次一曾因单提交 4058 行 diff 导致 critic 输出截断，`PRD-FILM-PROMPT-ASSETS-2026-10-20.md` §11.6）；② 单 PR 可独立 CI 绿、独立合并；③ 依赖顺序显式。

| PR | 内容 | 依赖 | 门禁要点 |
|----|------|------|---------|
| **PR-1** | **方案 + F-A 提示词三分** | 无（本 change 根） | 主进程改动 → QM-1 打包；`kit-loader` fail-closed 回归；存量 153 条零迁移断言 |
| **PR-2** | **F-I + F-H + F-J 资产接线与 UI** | PR-1（三分字段存在后，F-I 才能按任务模板派生三份） | UI 改动 → QM-4 视觉；i18n zh/en 成对；方法论分区只读渲染 |
| **PR-3** | **F-E 锁镜 + F-G 乐观锁 + G-8 时长落项目文件** | PR-1（项目文件结构变更） | 并发冲突 fail-closed 用例；锁镜不覆盖断言 |
| **PR-4** | **F-B 就绪度闸门**（只改 `video-gen.js` 的 `costCheck`） | **PR-3**（就绪度要识别 `SHOT_LOCKED`，需要 PR-3 引入的 `locked` 字段） | 成本闸**未新增第二道闸**断言（既有 `film-video-checkpoint-integration.test.js` 必须仍绿） |
| **PR-5** | **纯重构**：把 `video-gen.js` 里的 `downloadToFile` 抽成独立模块 `film-video-downloader.js`（**行为逐字不变**，仍是现有裸实现） | PR-1 | 纯重构无行为变化：既有 `video-gen.test.js` 19+7 例全绿；新模块有等价性用例 |
| **PR-6a** | **零行为抽取** `egress-guard`：`shot-downloader.js` 的出站合同原样抽成独立模块，`shot-downloader` 改调它（**行为零变化**） | PR-5 | `shot-downloader.test.js` 既有 23 例全绿；`egress-guard.test.js` 覆盖抽取前的同一套判据 |
| **PR-6b** | **F-C 出站安全加固**：`egress-guard` 加 pinning + 端口集 + 可信主机策略；`film-video-downloader` 改走合同；`shot-downloader` 同步获得加固 | **PR-6a**（抽取先行）+ PR-4 | SSRF / pinning / 端口 / 主机策略用例；`shot-downloader` 既有 23 例仍全绿 |
| **PR-7** | **F-D 工具体检** | **PR-1**（与出站下载**无逻辑依赖**；只依赖 `video-gen.js` 的既有形状） | ffmpeg 缺失在出片前给可操作提示；`film-render.test.js` 既有 20+2 例全绿 |
| **PR-8** | **F-F 身份锚点 + 参考图优先级** | 无（独立面） | 提示词外置断言；锚点硬上限 4 条断言；optimize 阶段 context 注入用例 |

> **PR-5 独立成 PR 的理由**（回应评审 i6）：`video-gen.js` 同时承载成本闸（PR-4）与下载实现（PR-6b）。若不先把下载实现抽离，PR-6 的"换合同"与 PR-4 的"改 costCheck"会落在同一文件同一函数的邻近位置，**回归面重叠、变红时无法定位**。PR-5 是零行为变化的纯重构，把"搬家"与"换实现"分成两次可独立验证的提交。
>
> **PR-4 依赖 PR-3 的理由**（回应评审 i8）：就绪度判据含 `SHOT_LOCKED`，它读的是 PR-3 引入的 `locked` 字段。若 PR-4 先行，判据要么悬空、要么漏判锁镜。**依赖显式标注，不靠"顺序恰好对"**。

**依赖图**

```
PR-1 (F-A 三分)
 ├─► PR-2 (F-I 任务模板派生 + F-H UI + F-J 严格模式)
 ├─► PR-3 (F-E 锁镜 + F-G 乐观锁 + G-8 时长落盘) ─► PR-4 (F-B 就绪度) ─┐
  └─► PR-5 (纯重构：抽出 film-video-downloader) ─► PR-6a (零行为抽取 egress-guard) ─► PR-6b (F-C 加固)

PR-7 (F-D 体检) ── 依赖 PR-1（与出站链路无逻辑依赖）

PR-8 (F-F 身份锚点) — 独立，可与任意 PR 并行
```

> **PR-6 拆 6a/6b 的理由**（回应评审 i8）：`egress-guard` 若"抽自 `shot-downloader` 又被 `shot-downloader` 反向调用"，抽取方向与依赖顺序就是未定的——评审无法判断"这是重构还是循环依赖"。6a 只做**零行为抽取**（模块从 `shot-downloader` 里搬出来、`shot-downloader` 改调它，测试全绿），6b 再在 `egress-guard` 上**加** pinning / 端口 / 主机策略，并让 `film-video-downloader` 改走它。两步各自可独立验证、依赖单向（`shot-downloader` → `egress-guard` → 无反向）。

**串行理由**：PR-2/3/4 都改 `auto-plan.js` / `video-gen.js` / `auto-project.js`，并行会持续冲突；**按 PR 编号顺序合并**，每个 PR 从最新 `origin/main` 重新开分支。

---

## 六、明确不做

| # | 不做什么 | 理由 |
|---|---------|------|
| **D-1** | ❌ 不做 F12 VLM 质检闭环 / F12-0 VLM 适配器 | 前置缺失（`adapters/_base/base.js` 无视觉方法），且自动重试会绕过被测试锁死的成本闸。**本次不碰** |
| **D-2** | ❌ 不做 F7 视角变体 `viewpointId` | Scene 已有 `parentId`（`kit-loader.js:97-102` 树校验 + 无环）。新增 `viewpointId` **当前无消费方** ⇒ 死代码。报告 §3.22.1 自己已把口径改成"先让 Scene 树被消费"。**待有消费者时再做** |
| **D-3** | ❌ 不做 F10 剪映草稿导出 | 需前置 spike 实测草稿格式版本兼容，工作量「大」，与本次两处目标面无关 |
| **D-4** | ❌ 不动 `packages/python-backend/` | 影视工程走 Electron 主进程 ffmpeg，不经 Python；报告的 `core/doctor.py` 落点对本目标面不成立 |
| **D-5** | ❌ 不做 F8c 三态时长对齐 / F8d loudnorm + BGM ducking | 需 `tpad`/`loudnorm` 滤镜，打包白名单仅 11 个（`stage-media-tools.js:10-22`），须混合 PR + 重打包实测 |
| **D-6** | ❌ 不做 F13 场次并发 / F14 Series Bible / F16 组级提示词 / F17 时长双向归一 / F18 分片渲染 / F19 checkpoint | 批次四；F14 还依赖 D-2；F17 会引入 ZJT 署名义务面 |
| **D-7** | ❌ 不迁 153 条 `shot-library.json` 存量数据 | 改存量即改 fail-closed 资产，风险最高（改坏整个影视工程不可用）。改用**加载期归一化**（研究报告 §5.2 F6 兼容方案①，推荐） |
| **D-8** | ❌ 不新增第二道生成闸 | 成本闸被 `film-video-checkpoint-integration.test.js:140-172` 锁死；就绪度**内联进 `costCheck`**，不新造 checkpoint |
| **D-9** | ❌ 不硬钉 ffmpeg 版本下限（7.1.1） | 报告 §5.2 已警告会误判大量环境；本次只做**存在性**校验 + 可操作提示 |
| **D-10** | ❌ 不动「画布」「快速渲染」「历史记录」标签 | 用户指定的改动边界 |
| **D-11** | ❌ 不为了赶工放宽任何门禁判据 | 本仓铁律；任何契约锁变红时先判断「改动不对」还是「锁该更新」 |
| **D-12** | ❌ 不引入 `shared-utils/src/net/safe-fetch.js` | 本仓已有更强实现（`shot-downloader.js`），新建即第二份真相源 |
| **D-13** | ❌ 不给「项目案例」标签加写操作 | F-H 仅新增只读展示分区；写操作一律走「自动」标签 |

---

## 七、验收标准（可执行）

### 7.1 逐项判据

| # | 标准 | 怎么证明生效（命令 + 期望） | 怎么证明没破坏既有功能 |
|---|------|---------------------------|------------------------|
| V-1 | 分镜提示词拆三份且存量零迁移 | `node --test apps/desktop/electron/services/film-engineering/kit-loader.test.js` —— 断言加载 153 条存量后每条 `imagePrompt` 非空且等于原 `prompt`、`endFramePrompt` 合法（空串或合法串）；**`videoPrompt` 的存量判据不在本条**（统一由 V-30 负责，避免两条互斥）；`git diff --stat apps/desktop/electron/film-kit/shot-library.json` 为空 | `kit-loader.test.js` 既有 23 例全绿 |
| V-2 | 三分合计有上限 | 新增用例：三分合计超上限 → 加载 **fail-closed**（`FILM_KIT_UNAVAILABLE`），不是静默截断。**口径**：`FILM_PROMPT_BUNDLE_MAX_LEN = 50000`，单位 = **字符**（`String.length`，非字节），计量对象 = `imagePrompt + videoPrompt + endFramePrompt` **三者之和**（旧字段 `prompt` 不计入）；错误文案含文件名、镜 id、实测长度与上限 | 同上；数值/单位/口径同步写进 `SCHEMA.md` |
| V-3 | 图片/视频各走各的提示词 | `video-gen.test.js` 新增用例断言图片提交用 `imagePrompt`、视频提交用 `videoPrompt`；缺 `videoPrompt` 时回落 `imagePrompt` | `video-gen.test.js` 既有 19+7 例全绿 |
| V-4 | 就绪度内联在既有闸内 | `video-gen.test.js` 断言未确认时输出含 `costCheck.readiness`，且 **provider 调用次数 = 0**；断言 `film-video-checkpoint-integration.test.js` 既有 140-172 行用例**未被修改且仍绿** | `film-video-checkpoint-integration.test.js` 全绿（**只读断言，不改它**） |
| V-5 | 缺提示词/坏参考图的镜在确认前就被标出 | 新增用例：构造 1 镜空提示词 → `costCheck.shots[0].ready === false` 且 `reason` 非空 | 同上 |
| V-6 | 成片下载拒绝内网地址 | `egress-guard.test.js`：注入 `lookupImpl` 返回 `169.254.169.254` → 拒绝且错误文案含「内网」；注入 `10.0.0.1`/`172.16.0.1`/`192.168.1.1` → 同样拒绝 | `shot-downloader.test.js` 既有 23 例全绿（既有可观察行为不变；pinning 增强由 V-24 独立覆盖） |
| V-7 | 成片下载只允许 https | 用例：`http://` URL → 拒绝 | 同上 |
| V-8 | 成片下载跟随重定向时逐跳重校验 | 用例：首跳 https 合法 → 跳到私网 → **拒绝**（不是跟到底） | 同上 |
| V-9 | 下载失败不留半成品 | 用例：中途中断 → 目标文件不存在，只存在 `.part` 且被清理 | 同上 |
| V-10 | 下载有体积上限 | 用例：响应超过上限 → 中止并清理 | 同上 |
| V-11 | ffmpeg 缺失在出片前暴露 | 新增用例：注入"无 ffmpeg"环境 → `auto-start`/出片阶段返回**可操作错误码**（非合成期才报） | `film-render.test.js` 既有 20+2 例全绿 |
| V-12 | 锁镜不被重跑覆盖 | `auto-runner.test.js`：1 镜 `locked: true` → 重跑后该镜提示词原值不变、`outputPath` 不变 | `auto-runner.test.js` 既有 13 例全绿 |
| V-13 | 并发写冲突 fail-closed | `auto-project.test.js`：用陈旧 `revision` 写入 → 返回冲突错误，项目文件不被覆盖 | `auto-project.test.js` 既有 14 例全绿 |
| V-14 | 逐镜时长落进项目文件 | `auto-project.test.js`：创建项目后读 `project.json` 的 `shots[0].durationMs` 非空且与计划一致 | 同上 |
| V-15 | 身份锚点硬上限 4 条 | `story-context-engine` 相关测试：5 个候选角色 → 只取 4 条 | 该模块既有测试全绿 |
| V-16 | 参考图优先级声明进入优化上下文 | `story2video-stages` 相关测试：断言送进 prompt-engine 的 context 含优先级声明且**最早参考图被标为身份锚** | 该模块既有测试全绿 |
| V-17 | 提示词未内联进代码 | 新增机械用例/人工复核：三类新提示词只存在于 `film-kit/prompts/tasks/**`，`.js` 内无对应长文本 | — |
| V-18 | i18n 成对 | `node scripts/check-locale-sync.js --keys` PASS + `--cjk` PASS | 既有 PASS |
| V-19 | 品牌残留 | `node scripts/check-no-brand-residue.js` rc=0 | 既有 rc=0 |
| V-20 | 门禁记录完整 | `node scripts/check-gate-record-debt.js` rc=0（执行记录含 `| 远程同步 | 由门禁推导 |` 表行 + 对应 bullet） | — |
| V-21 | 打包可用（涉及主进程时） | QM-1：`electron-builder --win --x64` exit 0 + asar 清单含新文件 | — |
| V-22 | 文档与实现同源 | `SCHEMA.md` 与 `kit-loader` 校验器逐项对齐；PRD 的字段表与代码字段逐项对齐 | — |
| V-23 | 未消费字段台账一致 | 机械核对：`imagePrompt`/`videoPrompt` 在 `video-gen.js` 有读取点；`endFramePrompt` **无** provider 提交读取点（断言其只出现在展示与派生路径）；`viewpointId` **全仓零命中** | — |
| V-24 | IP pinning 生效（消除 TOCTOU） | `apps/desktop/electron/services/film-engineering/egress-guard.test.js`：注入解析器返回**两个不同 IP**（第一次校验用 A、socket 连接用 B）→ 断言实际连接目标为**已校验的 A**；断言 socket 收到的 `lookup` 覆写被使用 | — |
| V-25 | 端口约束随可信域声明 | `egress-guard.test.js`：可信清单声明端口含 8443 ⇒ `:8443` 放行；未声明 ⇒ 拒绝；`:443` 或省略端口 ⇒ 放行到下一项校验 | — |
| V-26 | 主机策略缺省 fail-closed | `egress-guard.test.js`：① 主机 = provider API 主机 ⇒ 放行（自动预填，零配置）；② 主机不在可信集合且**未**显式授权 ⇒ **拒绝**；③ 持有运行期授权令牌 ⇒ 放行到私网段检查；④ 私网地址即使持有令牌也**仍拒绝** | — |
| V-26b | 放宽授权是**运行期令牌**，不落盘 | 勾选「本次允许从外部素材域名下载」⇒ 运行期产生一次性令牌（内存）；**项目文件里不得出现任何可放行的授权位**（机械核对：`project.json` 中无 `egressAllow` 类字段）；任务结束后令牌失效 | — |
| V-27 | 锁定不新增 IPC 通道 | `preload.test.js` 的通道计数**不变**（锁镜复用既有 `film-engineering:auto-*` patch 通道）；`auto-project.test.js` 断言 `patch.locked` 被接受 | — |
| V-28 | 出站下载实现已独立成模块 | `film-video-downloader.test.js` 存在且覆盖等价行为；`video-gen.test.js` 既有 19+7 例全绿 | — |
| V-29 | 自动模式新分镜的视频提示词显著更短 | `auto-plan.test.js`：逐镜断言 `videoPrompt.length <= 0.6 * imagePrompt.length`（**比例阈值，不是「严格小于」**——后者可被差 1 字符满足）；断言失败时打印两镜的实际长度；新规划分镜 `videoPrompt` 须非空 | — |
| V-30 | 存量分镜的 videoPrompt 为空（不假装已解决） | `kit-loader.test.js`：存量 153 条归一化后 `videoPrompt === ''`、`imagePrompt === prompt`；`video-gen` 侧回落 `imagePrompt`，**行为与变更前逐字一致** | — |
| V-31 | 乐观锁写入原子 | `auto-project.test.js`：并发写用例断言「无半写文件」（临时文件已清理，目标文件要么是旧内容要么是完整新内容），且 `revision` 自增与内容替换在同一次 rename 内完成 | — |
| V-32 | 就绪度三态 | `shot-readiness.test.js`：锁镜判为 `skipped`（**不阻断**出片）；阻止类判据（空提示词等）判为 `notReady`；两者在 `costCheck.readiness.shots[]` 中可区分 | — |

> **判据口径（回应评审 i7）**：本节所有「既有 N 例全绿」里的 **N 只是参考信息**，**不是门禁判据**——用例条数随需求增长而变动，把条数当门禁会制造假回归。**真正的判据是「该测试文件全绿 + 下表列出的关键断言清单齐备」**。
>
> **测试文件路径（可执行）**：
> - 主进程定向：`apps/desktop/electron/services/film-engineering/{kit-loader,auto-plan,auto-project,auto-runner,video-gen,shot-downloader,shot-duration,prompt-library,kit-asset-validators}.test.js`
> - 本批新增：`apps/desktop/electron/services/film-engineering/{shot-readiness,egress-guard,tool-doctor,film-video-downloader}.test.js`
> - 既有锁（只读不改，必须仍绿）：`apps/desktop/electron/services/film-engineering/film-video-checkpoint-integration.test.js`
> - 前端：`apps/desktop/src/views/film-auto/FilmAutoPanel.test.js`、`apps/desktop/src/views/FilmEngineeringHubView.test.js`
> - 提示词优化链路：`apps/desktop/electron/services/story2video-stages.test.js`、`apps/desktop/electron/services/story-context-engine.test.js`（若该文件不存在则新建同名测试）

### 7.2 全局回归

每个 PR 必须跑：
```
node apps/desktop/electron/tests/film-*.test.js   # 影视工程定向
node scripts/check-locale-sync.js --keys && node scripts/check-locale-sync.js --cjk
node scripts/check-no-brand-residue.js
node scripts/check-gate-record-debt.js
node scripts/classify-docs-only.js --base=origin/main --head=HEAD   # commit 之后跑
```

---

## 七之二、门禁记录与执行载体（回应评审 i7）

**执行记录的唯一强制载体**是 `openspec/records/film-pipeline-prompt-triple-and-guards.md`（按分支名命名）。本方案落地时必须写入**远程同步状态列**与**对应 bullet**（两处都写，状态列不写手写闭合词）：

**① 表行（状态列写「由门禁推导」——不手写 `PASS`）**：

```markdown
| 远程同步 | 由门禁推导 |
```

**② 对应 bullet**：

```markdown
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #NNNN
```

> **口径说明**（回应评审 i7）：AGENTS.md 已于 2026-10-17 把「两形态缺一即红」收窄为**只约束旧载体（`.quality-gates.md` / ledger）与存量旧行**；**新 PR 的记录不再手写状态词**，收口由 `scripts/lib/merge-ledger.js` 按主干历史**推导**（`MERGE-LEDGER` 找到把本篇带进 main 的合并提交即收口）。手写 `PASS` 会被判 `prematureClaim`。因此本方案只要求：**状态列写「由门禁推导」+ bullet 写明 PR 号**；**不要求**"两形态缺一即红"的旧强度描述。

**每个 PR 的门禁自检清单**（PR-1 至 PR-5 各一份，逐 PR 落盘）：

| 门禁 | 命令 | 通过标准 |
|------|------|---------|
| 分类判定 | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` | **commit 之后**跑；本方案含运行时代码 ⇒ 预期 `docs-only=false` |
| 门禁记录 | `node scripts/check-gate-record-debt.js` | rc=0 |
| PR 执行记录 | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` | OK |
| i18n 成对 | `node scripts/check-locale-sync.js --keys` / `--cjk` | 双 PASS |
| 品牌残留 | `node scripts/check-no-brand-residue.js` | rc=0 |
| openspec 结构 | `openspec validate film-pipeline-prompt-triple-and-guards --strict` | `is valid` |

## 七之三、外置提示词的信任边界（回应评审 i5）

评审建议"为外置提示词增加轻量哈希校验（记录预期文件哈希列表）"。**本方案不采纳该建议**，理由是它在本仓形态下**不构成安全措施**：

- 哈希清单与提示词同仓同包，**能改提示词就能改哈希清单**——这是自证，不是防篡改；
- 本仓提示词资产随 Electron `asar` 包分发（QM-1 已验证 `film-kit` 52 条目在包内），包完整性由打包与分发链路保证，应用内再挂一层哈希只是重复；
- 真正需要防的是**用户自定义 kit 目录**里的文件被篡改——但那本来就是用户自己的资产。

**采纳的替代做法**（把信任边界写清楚，而不是假装有校验）：

| 资产来源 | 信任级别 | 校验 |
|---------|---------|------|
| 随包内置 `asar` 内 `film-kit/**` | 可信（由打包链路保证） | `kit-loader` 结构校验 + fail-closed；QM-1 asar 清单核对 |
| 用户导入的 kit 目录 | **用户自持**（非应用信任边界） | 同样走结构校验 + fail-closed；出问题由用户自行负责 |

既有防护已覆盖结构层：`prompt-library.js` 的路径穿越防护（含符号链接真实路径二次断言，批次一 §11.4 补齐）+ 非空校验 + 中英成对校验；`kit-loader.js` 的 fail-closed 装载。

## 七之四、F-F 的验证闭环与 F12 依赖（回应评审 i3）

评审指出：F-F 引入锚点后，因 D-1 排除 VLM 质检，锚点缺少**自动化验证闭环**。**采纳**，补两条规则级验证（不依赖视觉模型）：

| 验证 | 手段 | 判据 |
|------|------|------|
| 锚点确实被使用 | 断言送进提示词引擎的 context 含锚点条目与优先级声明 | V-15 / V-16（规则级，可自动断言） |
| 参考图身份锚点可核对 | 对参考图**内容哈希**排序，"最早参考图"的判定与实际注入顺序一致；锚点声明中的图序号与实际注入序号一致 | 新增用例：乱序注入 → 断言声明与注入序号不一致时报错（**不静默**） |

**F12 依赖关系明示**（写进 spec）：F-F 是未来 F12（VLM 质检）的**前置之一**——F12 要判"角色是否串脸"，必须先有"角色身份锚点"作为比对基线；反之 F12 未落地不影响 F-F 交付。**本批次不因 F12 缺席而放宽 F-F 的验证标准**，改用规则级验证闭环。

## 八、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 三分字段让存量 153 条数据的 `prompt` 语义漂移 | 已有分镜库展示错乱 | 加载期归一化：`imagePrompt ??= prompt`、**`videoPrompt ??= ''`（空，不回落 prompt——理由见 §2.5：让「存量未被重算」在数据上可见，而不是被 `??= prompt` 掩盖成「已解决」）**、`endFramePrompt ??= ''`；`prompt` 字段**保留不删**，既有消费方零改动 |
| 就绪度判定过严导致"永远不就绪" | 用户无法出片 | 每条 `reason` 必须给出**可操作**描述；判据只取"必然失败"项（空提示词/参考图不可解析/档位不支持/锁镜），不做主观质量判断 |
| 出站合同复用改动既有下载路径 | 原片下载回归 | `shot-downloader.js` 重构后**既有可观察行为不变**，其 23 例既有测试必须全绿；pinning 作为**新增增强**用独立用例覆盖；新合同以"新增参数 + 默认值不变"方式接入 |
| 乐观锁在既有单写路径上误报冲突 | 自动模式跑不起来 | `revision` 仅在**同一任务被并发写**时递增；单会话串行写不产生冲突；冲突返回**可操作**错误码并保留原文件 |
| 身份锚点硬上限 4 条截掉重要角色 | 多人同框仍串脸 | 截断时在 context 里带 `anchorTruncated: true` 与被截角色名，供下游显式提示，不静默 |
| 新增文件触发行数门禁 | CI 红 | 三个新文件均预留余量（≤500 行）；拆分前先量 |
| 契约锁按 job 名/步骤内容断言 | CI 红 | 任何锁变红先判断「改动不对」还是「锁该更新」；确需更新锁时在提交信息写明理由与依据，**不放宽断言** |

---

## 九、Capabilities

- `film-engineering`（增量：分镜提示词三分契约、生成就绪度契约、单镜锁定契约、项目文件乐观锁契约、出站下载契约、外部工具前置体检契约）
- 复用能力：`pipeline-progress-push`（不动）、`story2video-page-ux`（仅参考，不改其规格）

## 十、Impact

- **影响用户**：影视工程「自动」标签在出片前会明确告知"哪一镜还不能生成、为什么"；成片下载不再存在被恶意 URL 指向内网的可能；人工精修过的镜不会被批量重跑覆盖；缺 ffmpeg 时在开工前就得到可操作提示。视频创作「提示词优化」阶段会带上角色身份锚点与参考图优先级声明，跨镜角色一致性更强。
- **影响开发**：Shot 结构新增 3 个可选字段（存量零迁移）；`costCheck` 新增 `readiness` 子结构；`project.json` 新增 `revision`；新增 3 个纯函数模块。
- **风险等级**：**中**（触及主进程生成与下载路径 + 项目文件结构），按 M+ 走完整质量节拍与 openspec 五件套。
