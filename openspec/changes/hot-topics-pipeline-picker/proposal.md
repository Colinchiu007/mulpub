## Why

热门选题页每条选题只有单一【生成视频】按钮，且该按钮把流水线写死为 `story2video-compose`（故事讲述）。用户实际拥有的视频创作流水线远不止一条（视频创作页的流水线列表由主进程 `pipelineList` 下发，当前 15 条），但热门选题这条最快的创作入口无法选择它们，用户必须先跳视频创作页重新走一遍选流水线/填文案的流程，选题上下文（改写文案）随之丢失。

用户本次明确要求：在列表行项目的右侧按钮操作区、紧邻【生成视频】按钮，增加一个**小的下箭头图标按钮**；点击后弹出下拉选择层，**列出所有的视频创作流水线**；点击其中某一条流水线后，直接以该流水线开始生成视频流程。

## What Changes

- **行内按钮组**：热门选题行（`hot-topics` tab）与收藏选题行（`favorites` tab）的【生成视频】按钮右侧新增一个紧凑的下箭头（▾）按钮：
  - `data-testid="hot-topic-gen-video-picker-{topicId}"` / 收藏行 `hot-topic-favorite-gen-video-picker-{favKey}`
  - `aria-haspopup="menu"` + `aria-expanded`；标题/aria-label 为「选择视频创作流水线」
  - 与主按钮共享 `genVideoBusy` 禁用闸门（编排在途时两个按钮一起灰显）
- **下拉选择层（不是浏览器原生 select，也不是 Element Plus 下拉）**：点击下箭头打开一个轻量浮层：
  - 数据源唯一真源：`pipelineList()` IPC（与视频创作页、流水线浏览器同源），首开懒加载、同一次挂载内缓存；失败时展示「流水线列表加载失败」+【重试】，并保留回退项「故事讲述」保证主流程可用
  - **列出所有视频创作流水线**（主进程返回的全部条目，含暂不可用项）；可执行的排在前，不可执行的排在后并附原因：
    - 可用：`story2video-compose`（故事讲述，默认）+ 文本驱动自动流水线 `animated-explainer` / `documentary-montage` / `animation` / `avatar-spokesperson` / `character-animation` / `hybrid`
    - 禁用：`talking-head` / `cinematic` / `clip-factory` / `localization-dub` / `podcast-repurpose`（需先导入视频/音频素材）、`film-engineering`（需在专属页面使用）、`framework-smoke`（内部调试流水线）、`screen-demo`（尚未实现执行引擎），以及 `available === false` 的其它流水线
  - 默认项 `story2video-compose` 带「默认」徽标；禁用项显示原因文案且不可点（`disabled` + 原因 `title`/行内 hint）
  - 关闭方式：再点下箭头、点击面板外、Esc；打开时焦点进入首个可选项，Esc 关闭后焦点回到下箭头；↑/↓ 在可选项间移动
- **点击流水线即开始生成**（不新增二次确认）：选中项 → 关闭面板 → 调用 `startGenerateVideo(topic, pipelineName)`：
  - `story2video-compose`：沿用现有完整链路（aiRewrite → 存草稿 → 读取 `story2video.lastOptions.v1` → `buildStory2VideoTextConfigFromSnapshot` → `pipelineStartOrchestrated`）
  - 文本驱动自动流水线：同一改写产物作为 `params.text`，按创作页 `startExplainerPipeline` 的同口径参数启动（`inputMode/text/checkpointPolicy/autoAdvance/background/uiLocale/storyboardMode/style/resolution/aspectRatio/fps/format`），分辨率/帧率/格式取用户上次保存的 S2V 输出配置
  - 弹窗阶段列表按所选流水线的真实阶段名生成（`rewrite_copy` + 该流水线 stages），不再固定 8 阶段；进度百分比、阶段状态归并与终态判定都按动态阶段数计算
  - 弹窗内新增一行「流水线：{名称}」，让用户明确当前跑的是哪条流水线
- **主【生成视频】按钮语义不变**：仍用默认流水线 `story2video-compose`，提示文案说明「使用默认流水线；点右侧箭头可选择其它流水线」。
- **成片提取口径扩展**：`finishGenVideoCompleted` 从仅识别 `publish/compose` 扩展为共享纯函数 `extractRunContextVideoPath`（publish → compose → export → render → report），与视频创作页 `extractOrchestrationVideoPath` 同一实现；无 `story2videoProject` 的 run-only 产物仍按「只带 `video_path`」交接发布页。
- **文案**（`locales/hot-topics/{zh,en}.js` 成对）：选择器标题/aria、默认徽标、加载中、加载失败+重试、空列表、禁用原因 4 类、弹窗流水线标识；`genVideoStartToast` 由「故事讲述流水线」改为「所选流水线」的通用表述。
- **文档**：`PRD-HOT-TOPICS-MODULE-2026-09-11.md` 新增 §3.13（选择器完整规格：显示项/校验/流程/交互/提示/边界/验收）并同步 §3.10、§5.6、§6.6、§7.1、§8、§9；`PRD-HOT-TOPICS-MULTI-SOURCE-AI-CATEGORY-2026-10-12.md` 行内操作按钮清单；`PRD-VIDEO-PIPELINE-PROGRESS-MODAL-2026-10-17.md` 弹窗显示项；`DESIGN.md` 行内下拉视觉契约；`i18n-glossary.md`；`CHANGELOG.md`；本 change + `openspec/records/hot-topics-pipeline-picker.md`。

## Capabilities

### New Capabilities

- `hot-topics-pipeline-picker`: 热门选题行内「生成视频」按钮组的下箭头流水线选择器——入口与可访问性、数据源与懒加载、全部流水线的可执行性分类与禁用原因、选择即启动的参数/阶段分支、加载失败回退、弹窗流水线标识与成片提取口径。

### Modified Capabilities

- `story2video-page-ux`: 热门选题一键生成视频不再写死 `story2video-compose`；按所选流水线构造启动参数与阶段（仅行为扩展，视频创作页自身路径不变）。
- `pipeline-progress-feedback`: 热门选题进度弹窗的阶段集合与总进度改为按所选流水线的动态阶段数计算，并展示流水线名称。

## Impact

- **渲染端**：新增 `apps/desktop/src/features/hot-topics/gen-video-pipelines.js`（纯函数：分类/排序/标签/启动参数/阶段名）、`apps/desktop/src/features/pipeline/run-context-video-path.js`（共享成片提取）、`apps/desktop/src/components/HotTopicsGenVideoPicker.vue`（按钮组 + 下拉）；修改 `apps/desktop/src/views/HotTopics.vue`、`apps/desktop/src/components/HotTopicsFavorites.vue`、`apps/desktop/src/composables/useHotTopicsGenVideo.js`、`apps/desktop/src/views/CreateView.vue`（`extractOrchestrationVideoPath` 改为委托共享纯函数）、`apps/desktop/src/locales/hot-topics/{zh,en}.js`。
- **测试**：新增 `gen-video-pipelines.test.js`、`run-context-video-path.test.js`、`HotTopicsGenVideoPicker.test.js`；在 `HotTopics.test.js` 追加选择器集成与收藏行用例；`CreateView.test.js` 回归（委托后行为不变）。
- **不触碰**：主进程 / 流水线引擎 / IPC 契约 / 平台适配器 / 发布页装载逻辑；不改 `.github/workflows`、不改 `CI_IGNORED_PATHS` 白名单。
- **风险面**：
  1. 媒体型流水线从纯选题文本无法启动，若放开会必然失败 ⇒ 统一禁用并显示原因；「列出全部」与「可点击」的差异用文案解释，避免用户误以为按钮坏了。
  2. 非 `story2video-compose` 流水线不产出 `story2videoProject`，【去发布】只能交接成片路径（现有 run-only 语义），不伪造标题正文。
  3. 流水线列表 IPC 失败时若整个按钮组不可用，会让「生成视频」主路径一起挂掉 ⇒ 采用回退默认项策略，主按钮永不受影响。
  4. 自定义/插件动态注册的流水线无法判定文本驱动性 ⇒ 默认禁用并标注「暂不支持从选题直接生成」，避免静默失败。
