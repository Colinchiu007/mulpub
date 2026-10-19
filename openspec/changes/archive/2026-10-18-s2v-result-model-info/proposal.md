# 方案：视频创作·历史记录·任务详情页模型信息展示（s2v-result-model-info）

> 决策层方案文档（`objectType=plan`）。本文在动手写码之前定稿，用于跨家族对抗评审与事后范围漂移比对。
> 预计改动 **570 行 / 8 个文件**（其中新增测试约 450 行、实现约 120 行）。

## 一、问题

视频创作 → 历史记录 → 任务详情页（`/create/result?project=<projectId>`）的视频信息区只有「格式」「位置」两项。
用户无法回答三个高频问题：这条视频的提示词是哪个文本模型生成的？旁白/配图/视频片段各走了哪家？
这条视频到底用没用视频模型？

## 二、数据源核实结论（方案的第一性依据）

沿**写入方**逐段核实模型信息是否已落盘：

| 模型类别 | 数据源 | 结论 |
|---|---|---|
| 语音模型 | `project.options.voiceProvider/voiceModel` | ✅ 已固化（`_safeOptions` 白名单） |
| 图片模型 | `project.options.imageProvider/imageModel` + `segments[].imageMeta.provider/model` | ✅ 已固化 |
| 视频模型 | `project.options.videoMode/videoProvider/videoModel` + `segments[].videoMeta.provider/model` | ✅ 已固化 |
| 文本模型 | `segments[].promptOptimizationMeta.model_used` | ⚠️ **未透传**：`story2video-stages.js` 的 `pairedScenes` 不携带 `promptOptimizationMeta`，`Story2VideoProjectService` 虽已定义该白名单字段却从不被填值 |

⇒ 「补文本模型落盘」是需求成立的前置条件，纳入同一变更。

## 三、方案选型

| 方案 | 做法 | 评价 |
|---|---|---|
| A | JS 测容器宽度决定放哪一行 | ✗ 要监听 resize、处理字体加载后重排，边界值是猜的 |
| B | CSS 媒体查询猜断点 | ✗ 容器宽度 ≠ 视口宽度，侧边栏折叠即失效 |
| **C（选）** | 「格式」与模型摘要并入**同一个 `<p>`**，内联分隔符连接 | ✅ 浏览器天然按容器宽度折行，零 JS、零断点、零猜测 |

## 四、点名改动文件（范围声明）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `apps/desktop/src/views/ResultView.vue` | 模板（格式行并入模型摘要）+ 2 个 computed + CSS |
| 2 | `apps/desktop/src/locales/create/zh.js` | 新增 `story2video.modelInfo` 四项 |
| 3 | `apps/desktop/src/locales/create/en.js` | 同上（成对，Gate 7） |
| 4 | `apps/desktop/electron/services/story2video-stages.js` | `pairedScenes` 透传 `promptOptimizationMeta` 白名单 |
| 5 | `apps/desktop/src/views/ResultView.test.js` | 新增「模型信息展示」17 例 |
| 6 | `apps/desktop/electron/services/story2video-stages.test.js` | 新增透传 6 例 |
| 7 | `01-docs/PRD-S2V-RESULT-MODEL-INFO-2026-10-18.md` | 新建功能 PRD |
| 8 | `01-docs/PRD.md` + `CHANGELOG.md` + `01-docs/learnings.md` + `openspec/records/s2v-result-model-info.md` | 主 PRD §7.1.39 合同 + 变更日志 + 经验沉淀 + 执行记录 |

**明确不做**：点击交互（跳转模型设置/切换模型重跑）、历史列表卡片展示、创作页模型选择 UI、新增 IPC 通道、历史数据回填。

## 五、关键裁决（易错口径）

1. **取值优先级**：`segments[].*Meta`（provider 实际执行）优先于 `project.options`（用户提交意图）；
   `model` 优先于 `provider`，provider 仅在 model 缺失时兜底。
2. **视频模型双重门控**：`videoMode` ∈ {`fixed`,`ai-judged`} 且解析值非空才显示。
   只按 `videoProvider` 有无判断会把「曾选过 provider 后又把 mode 切回 off」误显示成启用。
3. **降级如实呈现**：`strategy_used=template` 时 `model_used='template'`，不粉饰为具体模型名。
4. **空态契约**：四项全空时整段不渲染、不输出分隔符，DOM 与改动前同形。
5. **fail-open**：meta 取不到一律 `null`，绝不因此让 `generate_assets` 失败。

## 六、测试策略

- TDD：先写 17 + 6 例，确认 RED（预期 16 红 1 绿——绿的那条是"四项全空"，证零视觉回归契约）。
- 回归：`ResultView.test.js` / `story2video-stages.test.js` / `story2video-project-service.test.js` / `element-plus.test.js` 全跑。
- 覆盖矩阵：正常路径 / 门控边界 / 优先级 / 回退 / 脏数据 / 空态 / 响应式 / 不变量。

## 七、风险

| 风险 | 缓解 |
|---|---|
| 模型信息过长导致折行挤压内容 | 同行 + 自然折行；不设固定高度；视觉回归核对 |
| meta 透传增大 run context | 上游即收窄为白名单；`safePromptOptimizationMeta` 再有长度上限 |
| 老项目无 meta 被误判为功能损坏 | PRD/CHANGELOG 明写"有意行为"；A-3 用例锁定 |
| 视觉基线因新增文本被判红 | 差异应仅来自新增文本；`--single` 单独验证 create-result |
