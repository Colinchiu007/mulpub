---
record: explainer-production-artifact-contract
task: 把「AI 讲解视频」生产五阶段（scenes/assets/editing/compose/publish）改为上游 artifact 契约 + 结构化镜头语言 + 真剪辑决策 + 产物有效性判据
date: 2026-10-24
---

## 本次执行记录：生产五阶段的产物契约（explainer-production-artifact-contract，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`services/explainer/` 新增 6 个模块 + `explainer-stages.js` 改写 + `pipeline-engine.js` 改 2 个 type 字符串）+ E2E 桩与 fixture + 测试 + 文档 ⇒ 隔离 worktree `/workspace/mp-worktrees/mp-explainer-production-artifact-contract`、裸分支 `explainer-production-artifact-contract`，基线 `explainer-artifact-contract-preprod` 的 head `77edac26`（P2a） |
| 第一性原因（QM-5 ①） | ✅ | P2a 把**前生产**三阶段接上了上游契约，**生产**五阶段仍全是「散文/裸数组/清单透传」：`scenes` 产 `[{prompt,text,duration}]`（画面提示词由 **LLM 写散文**）、`assets` 产裸清单、`editing` 只是「校验并透传」（**没有剪辑决策**）、`compose` 走 ffmpeg 图片轮播、**产物从不验**。⇒ 本片让生产链路第一次按上游 artifact 契约产出，并把**镜头语言与剪辑决策**从「隐式行为」变成**可审计产物** |
| 逃逸分析（QM-5 ②） | ✅ | ① **「结构上像」≠「满足契约」**：上游 `scene_plan` 有 `shot_language`（10/18/7/11/3/4 六个枚举），本仓**一个都没用** ⇒ 画面提示词全靠 LLM 写散文 ⇒ 不可复现、不可校验。② **「自检永远绿」的老坑复发**：schema 的 `minItems` 补齐 ⇒ 场景类型多样性判据按补齐后长度判 ⇒ 恒绿 ⇒ 必须按**原始计数**判。③ **运动名是假契约**：上游 `transform.animation` 的示例是 `ken-burns-slow-zoom`，而本仓合成层只认 `zoom-in`/`pan-left`/… ⇒ 照抄上游 ⇒ **静默无动效**（不报错、不降级）。④ **「有音轨」对静音失明**：数字静音同样产出完整音频流 ⇒ 只断言「有音频流」对静音缺陷**完全失明**。⑤ **零容差天花板**：`pipeline-engine.js` 的 `files`/`targets` 两侧都是 2776 ⇒ 加一行就红、**主干立刻变红挡住全仓 PR**。⑥ **E2E 桩与提示词静默脱节**（见下）。⑦ **文案基准与契约脱节**（见下） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 新增 `services/explainer/explainer-shot-language.js`（镜头语言枚举 + **确定性提示词组装** + `text_card` 强制判定）；② 新增 `explainer-prod-artifacts.js`（`scene_plan` / `asset_manifest` 构造与自检，**原始计数快照**）；③ 新增 `explainer-edit-decisions.js`（时间轴映射 / cuts / 字幕 / 音频层 / pacing / 旁白预算，**按实际 narration 时长校正但不得侵占下一镜**）；④ 新增 `explainer-prod-review.js`（`render_report` / `final_review` / `publish_log` + **runtime 漂移检测**）；⑤ 新增 `explainer-media-probe.js`（ffprobe / 抽帧+blackdetect / **volumedetect 响度**，阈值 −85 dB **实测标定**）；⑥ 新增 `explainer-prod-stages.js` + `explainer-review-stages.js`（五阶段执行器；`explainer_compose`/`explainer_publish` **内部先调内置执行器**再包装 artifact）；⑦ `explainer-stages.js` **353 → 98 行**（净减 255；抽模块，不抬基线）；⑧ `pipeline-engine.js` **2 增 2 删的纯字符串替换**（读数仍 2776 = target，差 0）；⑨ 新增 `explainer-prod-artifacts.test.js`（44 例）；⑩ 既有 `explainer-stages.test.js` **6 条**按「改输入不改意图 / 契约变更改断言意图」逐条处置 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **原始计数快照**（`metadata.source_counts`）⇒ 任何补齐都救不了计数判据；② **缺项显式标注「未指定」**（上游 scene-director Step 4c：静默省略是最常见的失败模式）⇒ 六个维度**一律**如此；③ **运动名白名单取仓内合成层真源**（`buildImageEffectFilter` 的 switch 分支）+ 概念名映射记 `metadata.motion_aliases`；④ **静默阈值实测标定**（数字静音 −91 dB / 真人 −30 dB / 极静环境音 −79 dB ⇒ 阈值 −85 dB）并写进产物 `metadata`；⑤ **「未确认的锁定值」不判违规**：`render_runtime` 在 P3 的 G1 门之前只是**缺省** ⇒ 漂移记 info；若已获批准才记 error（否则成片永远出不来）；⑥ **E2E 桩的机械守卫**（见下）；⑦ **E2E 文案基准与契约同步**（见下）；⑧ **共享实现不复制**：`fillRequired`/`asText`/`asArray`/`asObject`/`asNumber` 从 `explainer-artifacts.js` **导出复用**（不重写） |
| 行尾与 diff 对账 | ✅ | 见提交前两口径 numstat 实测（下详） |
| **CI 首轮红（主干级 vs 本 PR 级）** | 待填 | 首次 push 后填写 |
| 接线棘轮 | ✅ | 新增 `explainer-prod-artifacts.test.js` 落在 vitest include 的 `electron/services/**/*.test.js` 白名单内（**无需改 vitest.config.js**）；`scripts/check-unwired-tests.js` 实测 PASS |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | QM-1：改的是 `apps/desktop/electron/services/explainer-stages.js` 与 `pipeline-engine.js` 的**既有文件**（**运行时代码**）⇒ **不适用 N/A** ⇒ 由 CI 的 `build` job（windows-latest + `electron-builder --win --x64`，required check）兜底。QM-4：**零 UI 变化**（无新增控件/文案/i18n 键）⇒ 无视觉面 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`） |

### 顺带修掉的两个「静默失效」缺陷（P2a 引入、本片暴露）

⚠ 这两个都是**P2a 改写提示词/契约时引入、但当时没人跑 E2E 所以没暴露**的缺陷。

**① E2E 桩的阶段路由静默失效**

`apps/desktop/tests/e2e/lib/local-provider-hub.js` 靠 **system prompt 特征串**路由到文案基准的四个键。
P2a 把前三个阶段的 system prompt 全改写了（`「结构化的讲解视频大纲」→「你是资深视频研究员」` 等）
⇒ 旧特征串**全部失效** ⇒ 四个阶段一起落到 default `'research'`
⇒ **E2E 拿到全是 research 文案，而且不报错**。
⇒ 修法：特征串改用**阶段角色名**（语义稳定措辞）+ **加机械守卫**：
`apps/desktop/tests/local-provider-hub.test.js` 断言**每个 `STAGE_ROUTES` 特征串都能在阶段提示词源码里找到**
⇒ 提示词再改而桩没同步 ⇒ **当场红**。

**② E2E 文案基准与上游契约脱节**

`fixtures/explainer-copy.json` 的 `research`/`proposal`/`script` 仍是**散文字符串** ⇒ P2a 的归一化器会把它收敛成**空 artifact**
⇒ 计数自检必红 ⇒ E2E 必然跑不通（本片之前的判断「P2a 之后没跑过 E2E」在此得到机理确认）。
⇒ 修法：三个键改为**JSON 形态的 LLM 原始输出**（归一化由 `explainer-artifacts.js` 负责，桩只给原始输出）；
`scenes` 增加结构化字段（`type` / `description` / `shot_language` / `script_section_id`），
**保留** `prompt` 与 `text`（旧形态匹配与旁白仍要用）；
`script.sections` **由 `scenes` 派生**（文本与时长一一对应）⇒ 杜绝两边各写一份导致漂移
（实测修前：8 个场景 vs 10 段旁白 ⇒ **末两段旁白会丢**；时长合计 87 vs 82 ⇒ 触发比例缩放）。

**③ 顺带修掉的「组装形态失配」**

P2b 起生图提示词由**代码组装**（风格 + description + 六段镜头语言 + texture）⇒ **不再等于** fixture 的 `prompt`
⇒ 桩的 `findSceneByPrompt` 纯「相等匹配」会失配 ⇒ 出图标题退化成「提示词前 40 字」。
⇒ 改为三级匹配（`description` 相等 → `prompt` 相等（旧形态）→ **含「镜头：」标记**时用「包含」匹配）。
⚠ 第三级**必须唯一命中才返回**（多个命中 ⇒ 判为串台 ⇒ 返回 null）——
否则会破坏既有断言「`prompt + 追加内容` 不得命中」。

### 既有测试的处置（逐条：改了什么 / 为什么）

⚠ 依据「**契约变更把既有测试拉红时，先判「我破坏了实现」vs「测试锁的正是我要改的行为」**」：

| 用例 | 改了什么 | 为什么 |
|---|---|---|
| 「注册全部 6 个自定义阶段类型」 | 改为 8 个（新增 `explainer_compose` / `explainer_publish`） | **契约变更**：生产五阶段新增两个专属 type |
| 「解析带 markdown 围栏的 LLM 输出」 | `parseScenesJson` → `parseScenesArray` | 旧函数被新实现取代（**同一意图**：容忍围栏/说明文字） |
| 「normalizeScenes 过滤无效项并限制数量与默认时长」 | **迁移**为「`buildScenePlan` 过滤无效项并限制数量与默认时长」 | 旧函数无生产调用点；**同一意图**（过滤/限数量/默认时长）随实现迁移，**不是删测试** |
| 「scenes 阶段输出规范化场景数组」 | 断言从 `output[0].prompt/text` 改为 `output.scenes[0].description` 等 | **产物形态变更**：数组 → `scene_plan` 对象 |
| 「scenes 阶段解析失败时用行级兜底继续」 | 断言从 `output[0].text` 改为 `output.scenes[0].description` | 同上（**兜底意图不变**） |
| 「generate_assets 通过适配 context 复用 story2video 执行器」 | 输入改为 `context.scene_plan`；**另加一条**「兼容旧形态（断点续跑的旧 run 上下文里仍是场景数组）」 | **输入形态过时**；新增的那条是**双形态适配**的证据 |
| 「editing 校验资源清单并透传」 | 改为「editing 产出上游 `edit_decisions` artifact」 | **契约变更**（从透传变成产出） |
| 「按 system prompt 判定四阶段」 | 特征串换成新提示词里的角色名 | 桩的特征串必须与提示词同源（**机械守卫**已补） |
| 「场景的 prompt 精确匹配才命中」 | **未改断言**，改的是实现（第三级匹配加了「镜头：」标记门槛 + 唯一命中） | 保持「追加内容不得命中」的防串台意图，同时支持组装形态 |

### 新增/修改清单

| 文件 | 动作 | 行数影响 |
|---|---|---|
| `apps/desktop/electron/services/explainer/explainer-shot-language.js` | **新增**（镜头语言枚举 + 确定性提示词组装 + `text_card` 强制判定） | +259 |
| `apps/desktop/electron/services/explainer/explainer-prod-artifacts.js` | **新增**（`scene_plan` / `asset_manifest` 构造与自检） | +400 |
| `apps/desktop/electron/services/explainer/explainer-edit-decisions.js` | **新增**（cuts / 字幕 / 音频层 / pacing / 旁白预算） | +381 |
| `apps/desktop/electron/services/explainer/explainer-prod-review.js` | **新增**（`render_report` / `final_review` / `publish_log` + runtime 漂移） | +366 |
| `apps/desktop/electron/services/explainer/explainer-media-probe.js` | **新增**（ffprobe / 抽帧 / 响度） | +244 |
| `apps/desktop/electron/services/explainer/explainer-prod-stages.js` | **新增**（scenes / assets / editing 执行器） | +470 |
| `apps/desktop/electron/services/explainer/explainer-review-stages.js` | **新增**（compose / publish 执行器） | +163 |
| `apps/desktop/electron/services/explainer/explainer-prod-artifacts.test.js` | **新增**（44 例） | +629 |
| `apps/desktop/electron/services/explainer/explainer-artifacts.js` | 改：导出 `fillRequired`/`asText`/`asArray`/`asObject`/`asNumber`（**供新模块复用，不重写**） | 457 → 464（+7） |
| `apps/desktop/electron/services/explainer-stages.js` | 改：只做注册（8 个 type），实现全部搬出 | 353 → 98（**净减 255**） |
| `apps/desktop/electron/services/explainer-stages.test.js` | 改：6 条既有用例逐条处置（见上） | 494 → 538 |
| `apps/desktop/electron/services/pipeline-engine.js` | 改：**2 个 type 字符串**（`'compose'`→`'explainer_compose'`、`'publish'`→`'explainer_publish'`） | **2 增 2 删；读数 2776 = target 2776，差 0** |
| `apps/desktop/tests/e2e/lib/local-provider-hub.js` | 改：路由特征串换成角色名 + `findSceneByPrompt` 三级匹配 + `SHOT_LANGUAGE_MARKER` | +约 25 |
| `apps/desktop/tests/local-provider-hub.test.js` | 改：路由断言换特征串 + 新增「组装形态唯一命中」用例 + **机械守卫**（特征串 ↔ 提示词源码） | +约 30 |
| `apps/desktop/tests/e2e/fixtures/explainer-copy.json` | 改：三个键改 JSON 形态 + `scenes` 加结构化字段 + `script.sections` 由 `scenes` 派生 | 数据 |
| `01-docs/PRD-video-creation.md` | 改：新增 §17（17.1~17.14） | +359 |

## CHANGELOG 条目

# feat(视频创作): AI 讲解视频生产五阶段改为上游 artifact 契约 —— 镜头语言可复现、剪辑决策可审计、成片产物可验收（explainer-production-artifact-contract）

