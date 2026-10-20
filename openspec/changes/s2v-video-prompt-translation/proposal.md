# 视频提示词中文翻译与提示词区交互重构

## Why

**用户诉求（2026-10-19，附截图）**：视频创作-视频详情页（成品编辑页）每个视频分段的提示词优化区里，只有图片提示词带中文翻译，视频提示词没有；且整个区域内容过多，视觉体验不好。

**根因（两条，独立）**：

1. **翻译缺失**：图片提示词的翻译链路自 2026-08-12 建立（`translatePromptsForLocale` → compose 并行任务 `story2video_prompt_translation_compose` → 按场景 index 回填 `promptTranslation` → 随分段持久化）。视频提示词（`videoPrompt`）是 2026-08-15 才新增的字段，其生成链路（`optimizeVideoScenePrompts`）与「重新生成视频优化词」（`regenerateScenePrompt kind=video`）**从未接入翻译能力**。
2. **信息密度**：结果页唯一的翻译块被放在「画面提示词 textarea + 视频优化词 textarea + 两枚重新生成按钮」**之后**，与它描述的提示词隔了一整个区块；10+ 分段时首屏被 textarea/表单淹没。

## What Changes

### 1. 视频提示词中文翻译（数据 + 生成）

- 新增分段字段 `videoPromptTranslation`（string | null，≤2000 字符，只读）。
- 生成时机：用户点击「重新生成视频优化词」成功后，由主进程调用 LLM 生成中文译文并落库。
- 生成实现：`story2video-stages.js` 新增并导出 `translateVideoPromptForLocale(aiGenerator, prompt, uiLocale, log)`，**复用** `translatePromptsForLocale` 的批量调用、JSON 解析、markdown fence 剥离、平衡 JSON 提取与逐行兜底（避免第二份翻译实现漂移）。
- fail-open：LLM 不可用 / 解析失败 / 超时 / 单条失败 → `videoPromptTranslation = null`，**不影响 `videoPrompt` 本身**，不抛错、不改分段状态。
- 陈旧译文治理：重写 `videoPrompt` 时**先清后写**（与图片提示词 `promptTranslation` 同语义），翻译失败不留上一轮译文。
- 译文与原文相同（引擎直出中文或回显原文）视为未翻译，返回 null，不展示冗余。
- 持久化路径：compose 回填（按稳定 source index，与 `videoPrompt` 同源治理）、草稿分段、`ensureProjectFromRun` 三条构造路径全部补该字段。
- **`updateSegments` 不接收该字段**：白名单外字段丢弃，防止前端伪造译文。

### 2. 提示词/翻译成对展示（渲染）

- 「画面提示词」textarea 下方紧邻只读中文翻译块（标签「图片提示词中文翻译」）。
- 「视频优化词」textarea 下方紧邻只读中文翻译块（标签「视频提示词中文翻译」）。
- 翻译块样式弱化（左边框 + 次级底色 + 只读、不可编辑），与可编辑 textarea 形成层级差。
- 展示条件与图片提示词翻译一致：界面语言非 `en` 且译文非空；否则显示占位文案「未生成」。

### 3. 编辑区默认折叠（交互）

- 分段卡片默认紧凑态：只保留分段序号/状态/素材区概览，编辑主体（旁白文字/字幕/提示词/翻译/语音设置/操作按钮）不渲染。
- 卡片头部新增「展开编辑 / 收起编辑」开关（`data-testid="segment-editor-toggle"`，带 `aria-expanded`）。
- 展开态**互斥**：同时只有一个分段展开；再次点击当前分段收起为紧凑态。
- 删除已展开的分段时收起编辑区，不残留指向已删除 id 的展开态。

## Impact

- **Affected code**：
  - `apps/desktop/electron/services/story2video-stages.js`（新增 `translateVideoPromptForLocale` 并导出）
  - `apps/desktop/electron/services/story2video-project-service.js`（`regenerateScenePrompt` 视频分支接线 + `_resolveUiLocale` + 三条分段构造路径补字段）
  - `apps/desktop/src/views/ResultView.vue`（翻译块成对 + 折叠交互 + 样式）
  - `apps/desktop/src/locales/story2video/zh.js` / `en.js`（新增 5 条成对文案）
- **数据兼容**：`videoPromptTranslation` 为新增可选字段，旧项目无该字段时正常加载（`safeText(undefined) → ''` → null），不报错。
- **无新增依赖、无新增 IPC 通道、无 schema 迁移**：复用既有 `aiGenerator` 与 `story2video:regenerate-scene-prompt` 通道。
- **成本**：每次「重新生成视频优化词」多一次 LLM 调用（单条、temperature 0.1、max_tokens ≤ 400 + 输入长度）。仅在用户主动点击时触发，不进入流水线自动路径。

## Out of Scope

- 存量项目 `videoPromptTranslation` 批量回填（需遍历 N 个项目的 LLM 批量翻译，成本与失败面不适合本次 UI 修复）。
- 流水线自动路径（`optimize` 阶段 / `generate_assets` 阶段）的视频提示词翻译——本次只覆盖「重新生成视频优化词」这一交互入口。若后续要在成片生成时同步产出视频译文，应扩展 `prompt_translations_pending` 机制而非复制逻辑。
- 提示词与翻译的左右分栏布局（已评估并否决，理由见执行记录）。
