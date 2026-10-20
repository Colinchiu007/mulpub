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

| 报告原判 | 实测 | 本方案修正 |
|---------|------|-----------|
| F11b SSRF 防护**完全没有**，落点新建 `shared-utils/src/net/safe-fetch.js` | 影视工程「原片下载」通道**已实现完整出站合同**：`shot-downloader.js` https-only（`:60`）+ 私网段黑名单（`:65`/`:43`）+ **每次请求前 DNS 解析校验 IP**（`:130-144`）+ 3xx 手动逐跳重校验（`:154-166`）+ 500MB 上限（`:12`）+ `.part` → ffprobe → rename（`:210`） | **不新建模块**。把既有合同**复用到 G-3 的裸奔路径**；`safe-fetch.js` 不做 |
| F11d 外部工具体检落 `packages/python-backend/src/multi_publish/core/doctor.py` | 影视工程走的是 **Electron 主进程**的 ffmpeg（`film-render.js` `findFfmpeg()`），**不经过 python-backend**；且 `core/` 下无 `doctor.py` | 落点改为 **Electron 主进程侧**（出片前体检），Python 侧不动 |
| F11c 就绪度闸门落 `story2video-engine/src/shotReadiness.ts` | `story2video-engine/src` 21 个文件**无**该能力；影视工程的成本闸在 `apps/desktop/electron/services/film-engineering/video-gen.js` | 落点改为 **内联进既有 `costCheck`**（研究报告 §5.2 已明示"非新增第二道闸"），不新建文件 |

---

## 三、选型：选了什么、为什么、许可证结论

### 3.1 选中的条目

| 本方案编号 | 对应报告项 | 报告梯队/位置 | 为什么选（引用报告 + 本仓实测） | 许可证结论 |
|-----------|-----------|--------------|--------------------------------|-----------|
| **F-A** 提示词三分（首帧/视频/尾帧） | 报告 §4.2 第二梯队 #12、§5.2 批次二 F6 | 「镜头语言结构化」差距标 **大**；`prompt-doctrine` 已有 `frame_constraint`（首尾帧 21 条）+ `transition_medium_cover`（介质掩护）**数据已就绪但无处消费** | 数据已备而消费端缺位，是投入产出比最高的一处：只改派生与消费，不迁 153 条存量 | 🟡 **只能抄思路**——来源 `moyin-creator` 为 **AGPL-3.0**。**禁止复制其源码**；三分结构属通用工程做法，自行实现。**提示词文本不受版权保护**，可参考其规则表述 |
| **F-B** 生成就绪度闸门 | 报告 §4.2 第一梯队 #12「就绪度闸门」 | 报告 §5.2 批次三 F11c：Jellyfish **Apache-2.0**，「可安全复制」；且报告已给出"内联进既有 costCheck，非新增第二道闸"的精确口径 | 成本闸已被测试锁死（`film-video-checkpoint-integration.test.js:140-172`），**不能新增第二道闸**；内联是唯一不破既有锁的做法 | 🟢 **可抄代码**（Apache-2.0，保留 NOTICE/版权头）。本仓实现按自身数据结构重写，仍标注来源 |
| **F-C** 出站安全复用 | 报告 §4.2 第一梯队 #11「出站媒体 SSRF 防护」 | 来源 `waoowaoo` **Elastic 2.0**（桌面端自用不触发托管服务禁令）；但**本仓已有更强实现**（`shot-downloader.js`） | 见 §2.3 修正 1：不新建，只复用。既有实现比研究报告假设的更完整 | 🟢 **本仓自有实现，无需引入外部代码**。参照外部思路时仅取"私网段 + DNS 重绑定 + 逐跳重校验"三点（Elastic 2.0 允许参考） |
| **F-D** 外部工具体检 | 报告 §4.2 第一梯队 #26、§5.2 批次三 F11d | 报告来源 `app.yumcut.com` **PolyForm NC 1.0**（科研非商用已解禁）；报告建议"只做存在性校验，不硬钉 7.1.1"（会误判大量环境） | G-4 是真实可感知缺陷；报告的"只做存在性"建议已被本方案采纳（避免制造新的假失败） | 🟡 **只能抄思路**。本仓实现自研（读取自身 `findFfmpeg()` 解析结果 + 版本输出解析） |
| **F-E** 单镜锁定 | 报告 §4.2 第二梯队 #9 | 差距标「**中**」；`ai-art-engine` GPL-3.0 → 报告已标「仅思路」 | G-5 真实；消费方明确（自动模式重跑时跳过锁镜），不会变成死代码 | 🟡 **只能抄思路**（GPL 传染，**禁止复制代码**）。字段与跳过逻辑自研 |
| **F-F** 身份锚点 + 参考图优先级 | 报告 §4.2 第二梯队 #19、§3.21 武器 2 | 报告 §3.21：mulpub 已握武器 1（实体强引用 ★★★★★），但**武器 2–5、7 全缺**；武器 2 成本最低（★���） | G-7 真实；报告 §3.22.1 已把 F15 **提级到批次一**（"最低成本换最强档"），批次一未做，本次补上 | 🟡 **只能抄思路 + 提示词可抄**——来源 `moyin-creator` AGPL-3.0。**报告明确：提示词不受版权保护**，角色身份锚点/参考图优先级/防串脸三类**提示词**可重写后使用 |
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
| F-A | `apps/desktop/electron/services/film-engineering/kit-loader.js` | 加载时归一化 `imagePrompt/videoPrompt/endFramePrompt`；`KIT_FILES` 不变（同文件） | +45 / -5 |
| F-A | `apps/desktop/electron/services/film-engineering/auto-plan.js` | 规划期派生三分（首帧用模板全文、视频用尾帧精简、尾帧用 frame_constraint 规则） | +60 / -10 |
| F-A | `apps/desktop/electron/services/film-engineering/video-gen.js` | 图片走 `imagePrompt`、视频走 `videoPrompt`（`videoPrompt` 缺省回落 `imagePrompt`） | +25 / -8 |
| F-A | `apps/desktop/electron/film-kit/SCHEMA.md` | 三字段规格 + 合计上限口径 | +30 / 0 |
| F-A | `apps/desktop/electron/film-kit/shot-library.json` | **零改动**（153 条存量不迁，靠加载期归一化） | 0 |
| F-B | `apps/desktop/electron/services/film-engineering/video-gen.js` | `costCheck` 内联 `readiness` 字段 + 逐镜 `ready`/`reason` | +50 / -5 |
| F-B | `apps/desktop/electron/services/film-engineering/shot-readiness.js`（**新建**） | 纯函数：逐镜就绪度判定（无 IO、可测） | +130 / 0 |
| F-C | `apps/desktop/electron/services/film-engineering/egress-guard.js`（**新建**） | 从 `shot-downloader.js` 抽出可复用的出站合同（私网段/DNS/逐跳/上限/`.part`+ffprobe→rename） | +180 / 0 |
| F-C | `apps/desktop/electron/services/film-engineering/shot-downloader.js` | 改为调用 `egress-guard`（行为逐字不变） | +10 / -40 |
| F-C | `apps/desktop/electron/services/film-engineering/video-gen.js` | `downloadToFile` → 走 `egress-guard` | +15 / -30 |
| F-D | `apps/desktop/electron/services/film-engineering/tool-doctor.js`（**新建**） | ffmpeg/ffprobe 存在性 + 版本解析；**只做存在性校验**（不硬钉版本下限） | +110 / 0 |
| F-D | `apps/desktop/electron/services/film-engineering/video-gen.js` | 出片前体检；缺失时返回可操作错误码 | +25 / 0 |
| F-E | `apps/desktop/electron/services/film-engineering/auto-project.js` | shot 结构加 `locked`；patch 白名单加 `locked` | +25 / 0 |
| F-E | `apps/desktop/electron/services/film-engineering/auto-runner.js` | 重跑跳过 `locked` 镜 | +25 / 0 |
| F-E | `apps/desktop/src/components/film-canvas/../`（**不动**）+ `apps/desktop/src/views/film-auto/FilmAutoPanel.vue` | 自动模式逐镜行显示锁标记 + 可锁定交互 | +40 / 0 |
| F-F | `apps/desktop/electron/services/story-context-engine.js` | 角色身份锚点提取（硬上限 4 条）+ 参考图优先级声明构造 | +110 / 0 |
| F-F | `apps/desktop/electron/services/story2video-stages.js` | optimize 阶段把锚点与优先级声明注入 prompt-engine context | +50 / 0 |
| F-F | `apps/desktop/electron/film-kit/prompts/tasks/generate_shot_prompt/{zh,en}/` | 增补身份锚点/参考图优先级/防串脸三类提示词（**外置，不内联进代码**） | ±30 / 0 |
| F-G | `apps/desktop/electron/services/film-engineering/auto-project.js` | `project.json` 加 `revision`；写前比对，冲突 fail-closed | +45 / 0 |
| F-H | `apps/desktop/src/views/FilmEngineeringView.vue` | 方法论分区（11 块 + 台账 + 配方 + glossary） | +60 / 0 |
| F-G/H | `apps/desktop/src/locales/film-engineering/{zh,en}.js` | 新增用户可见文案成对 | +40 / +40 |
| F-I | `apps/desktop/electron/services/film-engineering/auto-plan.js` | 规划期用 `prompt-library` 的 `generate_shot_prompt` 任务模板 | +35 / -5 |
| F-J | `apps/desktop/electron/services/film-engineering/film-engineering-service.js` | 导入 IPC 传 `requireAssets: true` | +10 / 0 |
| — | 测试 | 新增 `shot-readiness.test.js` / `egress-guard.test.js` / `tool-doctor.test.js`；扩充 `auto-plan.test.js` / `auto-project.test.js` / `auto-runner.test.js` / `kit-loader.test.js` / `video-gen.test.js` / `story-context-engine` 相关测试 | +900 / 0 |
| — | 文档 | `01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md`（本批详细规格）、既有 PRD/ARCH 同步 | +600 / 0 |

**合计**：新建 3 个源文件 + 3 个测试文件；改动 13 个既有文件；净增约 **2,200 行**（含测试与文档），其中运行时源码约 **+820 行**。

### 4.2 防膨胀硬约束（沿用报告 §5.5 + 本仓纪律）

1. **提示词文本一律外置**为 `.md`/`.json`，禁止内联进 `.js`（F-F 的三类提示词进 `film-kit/prompts/tasks/`，经 `prompt-library.js` 渲染）。
2. **新增文件单文件 ≤500 行**；`egress-guard.js`（~180）与 `shot-readiness.js`（~130）均留余量。
3. **外置提示词走 `kit-loader` 的 fail-closed 校验**；`prompts/tasks/**` 已在 `KIT_FILES` 覆盖范围内（`kit-loader.js:341-364`），不新增目录登记。

---

## 五、排期与依赖（PR 拆分）

> 拆 PR 原则：① 体积小 → 对抗性审查不被截断（批次一曾因单提交 4058 行 diff 导致 critic 输出截断，`PRD-FILM-PROMPT-ASSETS-2026-10-20.md` §11.6）；② 单 PR 可独立 CI 绿、独立合并；③ 依赖顺序显式。

| PR | 内容 | 依赖 | 门禁要点 |
|----|------|------|---------|
| **PR-1** | **方案 + F-A 提示词三分** | 无（本 change 根） | 主进程改动 → QM-1 打包；`kit-loader` fail-closed 回归；存量 153 条零迁移断言 |
| **PR-2** | **F-I + F-H + F-J 资产接线与 UI** | PR-1（三分字段存在后，F-I 才能按任务模板派生三份） | UI 改动 → QM-4 视觉；i18n zh/en 成对；方法论分区只读渲染 |
| **PR-3** | **F-E 锁镜 + F-G 乐观锁 + G-8 时长落项目文件** | PR-1（项目文件结构变更） | 并发冲突 fail-closed 用例；锁镜不覆盖断言 |
| **PR-4** | **F-B 就绪度闸门 + F-C 出站安全 + F-D 工具体检** | PR-1（`video-gen.js` 分支从 PR-1 起） | 成本闸**未新增第二道闸**断言（既有 `film-video-checkpoint-integration.test.js` 必须仍绿）；SSRF 拒绝用例；ffmpeg 缺失可操作提示 |
| **PR-5** | **F-F 身份锚点 + 参考图优先级** | 无（独立面） | 提示词外置断言；锚点硬上限 4 条断言；optimize 阶段 context 注入用例 |

**依赖图**

```
PR-1 (F-A 三分)
 ├─► PR-2 (F-I 任务模板派生 + F-H UI + F-J 严格模式)
 ├─► PR-3 (F-E 锁镜 + F-G 乐观锁 + G-8 时长落盘)
 └─► PR-4 (F-B 就绪度 + F-C 出站 + F-D 体检)

PR-5 (F-F 身份锚点) — 独立，可与任意 PR 并行
```

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
| V-1 | 分镜提示词拆三份且存量零迁移 | `node apps/desktop/electron/tests/.../kit-loader.test.js` —— 断言加载 153 条存量后每条 `imagePrompt` 非空、`videoPrompt` 非空、`endFramePrompt` 合法；`git diff --stat apps/desktop/electron/film-kit/shot-library.json` 为空 | `kit-loader.test.js` 既有 23 例全绿 |
| V-2 | 三分合计有上限 | 新增用例：三分合计超上限 → 加载 **fail-closed**（`FILM_KIT_UNAVAILABLE`），不是静默截断 | 同上 |
| V-3 | 图片/视频各走各的提示词 | `video-gen.test.js` 新增用例断言图片提交用 `imagePrompt`、视频提交用 `videoPrompt`；缺 `videoPrompt` 时回落 `imagePrompt` | `video-gen.test.js` 既有 19+7 例全绿 |
| V-4 | 就绪度内联在既有闸内 | `video-gen.test.js` 断言未确认时输出含 `costCheck.readiness`，且 **provider 调用次数 = 0**；断言 `film-video-checkpoint-integration.test.js` 既有 140-172 行用例**未被修改且仍绿** | `film-video-checkpoint-integration.test.js` 全绿（**只读断言，不改它**） |
| V-5 | 缺提示词/坏参考图的镜在确认前就被标出 | 新增用例：构造 1 镜空提示词 → `costCheck.shots[0].ready === false` 且 `reason` 非空 | 同上 |
| V-6 | 成片下载拒绝内网地址 | `egress-guard.test.js`：注入 `lookupImpl` 返回 `169.254.169.254` → 拒绝且错误文案含「内网」；注入 `10.0.0.1`/`172.16.0.1`/`192.168.1.1` → 同样拒绝 | `shot-downloader.test.js` 既有 23 例全绿（重构后行为逐字不变） |
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

## 八、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 三分字段让存量 153 条数据的 `prompt` 语义漂移 | 已有分镜库展示错乱 | 加载期归一化：`imagePrompt ??= prompt`、`videoPrompt ??= prompt`、`endFramePrompt ??= ''`；`prompt` 字段**保留不删**，既有消费方零改动 |
| 就绪度判定过严导致"永远不就绪" | 用户无法出片 | 每条 `reason` 必须给出**可操作**描述；判据只取"必然失败"项（空提示词/参考图不可解析/档位不支持/锁镜），不做主观质量判断 |
| 出站合同复用改动既有下载路径 | 原片下载回归 | `shot-downloader.js` 重构后**行为逐字不变**，其 23 例既有测试必须全绿；新合同以"新增参数 + 默认值不变"方式接入 |
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
