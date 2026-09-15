<!--
PRD: 文案改写前端入口 (Rewrite Frontend Entry)
日期: 2026-09-09
分支: codex/rewrite-frontend-entry
关联包: packages/rewrite-engine (后端已就绪)
-->

# PRD: 文案改写前端入口

## 1. 背景与目标

packages/rewrite-engine 改写引擎后端已完整实现（多策略文案改写、LLM 推理、策略匹配、KnowledgeBase 个人知识库），但前端缺少独立入口：
- 无左侧菜单入口
- 无独立改写页面
- 改写完成后的「存入草稿→去发布→图文/视频双通道」流程缺失

目标：为改写引擎提供完整的前端入口与操作流程。

## 2. 功能范围

### 2.1 左侧菜单入口
- 在「更多」菜单组末尾添加「文案改写」菜单项
- 点击打开独立改写页面 /rewrite

### 2.2 独立改写页面 (RewriteView.vue)

输入区：
- 大文本输入框（textarea），最少 20 字，最多 6000 字
- 实时字符计数显示
- 改写中禁用输入

配置区：
- 「结合爆款库」checkbox：默认勾选。勾选后改写参数 userSettings.purpose=engagement、tone=storytelling，后端策略匹配器优先匹配 category=viral 策略（如故事化爆款、干货知识等）
- 「结合个人经历」checkbox：默认不勾选。勾选后启用 KnowledgeBase 上下文注入（knowledgeContext 模板变量），改写 prompt 将包含用户偏好、写作风格和历史成功案例
- 「改写模式」：智能仿写 / 扩写爆款 / 选题创作，默认「选题创作」
- 「目标平台」：通用 / 抖音 / 小红书 / 公众号 / B站 / 知乎
- 「策略选择」（2026-09-11 新增，与 AiWriterPanel 行为对齐）：
  - 两个 radio：「自动匹配」（默认选中） / 「手动选择」
  - 自动模式下显示「匹配策略预览」：调用 aiGetRecommendedStrategies IPC（参数 `{ platform }`），取推荐列表第一名显示为「将匹配策略：X」；目标平台切换时自动刷新；改写进行中不刷新；接口失败或返回空时降级显示「将匹配策略：--」，不报错、不阻塞改写
  - 手动模式下渲染策略下拉框：选项来自 aiListRewriteStrategies IPC（内置 5 套 + 运营后台远程下发、仅启用项），含占位项「-- 选择策略 --」；策略列表加载失败时下拉仅含占位项，改写仍可发起（走自动匹配）
  - 传参契约：手动模式传 `strategyId = 所选策略 id`（未选传 null）；自动模式显式传 `strategyId = null`，引擎 `_resolveStrategy` 收到 null 走 StrategyMatcher 自动匹配
  - 预览与实际执行的一致性说明：预览与发起改写是两次独立 IPC 调用，若期间远程策略同步变化，实际策略可能不同——以结果区显示的 strategy.name 为准
- 「开始改写」按钮：内容非空且字数区间合法时启用，点击后调用 aiRewrite IPC
- 「字数控制」行（2026-09-12）：min/max 两个数字输入框（默认 800/2000），实时校验（整数、min 0-5999、max 1-6000、max ≥ min），错误红字显示且禁用改写按钮；提交时经 userSettings.wordCountRange = { min, max } 传给引擎

结果区（改写完成后显示）：
- 改写元信息：策略名、AI味等级、原文/结果字数
- 可编辑的结果 textarea
- 「存入草稿」按钮：调用 draftSave IPC 将内容存入草稿箱
- 「去发布」按钮：先自动存入草稿，再弹出 PublishDestinationModal

数据校验：
- 内容非空（2026-09-12 起无最小字数限制）：空内容提示「请输入文案内容」
- 内容 ≤6000 Unicode 字符：rewrite-engine 后端校验
- 字数区间：min/max 整数校验 + max ≥ min 跨字段校验（前端实时 + 引擎后处理按 max 截断）
- 调用 AI 前必须登录：提示「AI 改写需要登录后使用，是否立即登录？」

### 2.3 发布去向弹窗 (PublishDestinationModal.vue)

弹窗包含两个大尺寸 banner 按钮：

1. 直接发图文
   - 描述：打开图文发布页，改写内容将自动填入文案输入框
   - 点击后 router.push('/publish?draft=<draftId>')
   - Publish.vue 的 mounted() 已有 loadDraft 处理，无需额外改动

2. 生成视频
   - 描述：打开视频创作流水线页，改写文本将自动填入文案输入框
   - 按钮下方有「流水线选择」下拉列表，默认「故事讲述」（story2video-compose）
   - 点击后 router.push('/create?draft=<draftId>&pipeline=<pipelineId>')
   - CreateView.vue 的 mounted() 新增 _loadDraftForRewrite 加载草稿并自动选择流水线

交互细节：
- 遮罩层点击关闭弹窗
- 右上角关闭按钮
- role=dialog + aria-modal 无障碍支持

### 2.4 采集页改写增强 (Collection.vue)

在现有采集结果改写区域新增：
- 改写按钮前的两个 checkbox：「结合爆款库」（默认勾选）、「结合个人经历」（默认不勾选）
- 改写完成后显示「存入草稿」和「去发布」按钮
- 「去发布」弹出 PublishDestinationModal

按钮状态逻辑：
- 采集后无改写结果：改写按钮可用，存入草稿/去发布隐藏
- 改写中：改写按钮禁用，存入草稿/去发布隐藏
- 改写有结果：改写按钮可用，存入草稿/去发布可见
- 无采集结果：改写按钮隐藏

### 2.4.1 一键改写功能（采集+改写一步完成）

**背景**：现有采集页需先点击「采集」，成功后再点「AI改写」，两步操作；且改写后原文会被覆盖，用户无法对比原文与改写结果。

**功能**：在采集 URL 输入区域新增「一键改写」按钮，点击后自动串联采集和改写，同时并排显示采集原文和改写后的内容。

**数据校验**：
- URL 非空校验：空链接提示「请输入链接」
- API 能力检查：aggregationCollect 和 aggregationRewrite 两个 IPC 通道必须同时可用
- 采集响应校验：title/content 非空，否则回退到 urlCollectFetch 降级路径
- 改写响应校验：result_content 非空，否则显示改写错误信息，但不影响采集结果展示
- 输入内容过短校验（不足 20 字）：后端 RewriteRequest 校验拒掉并返回「输入内容过短」

**流程**：
```
用户输入链接 -> 配置风格/长度/爆款库/个人经历选项
              |
      点击「一键改写」
              |
      1. 禁用所有输入控件（采集按钮、改写按钮、选项）
              |
      2. 调用 aggregation:collect 采集正文
              |-- 成功 -> 显示采集结果，追加到采集列表
              |-- 失败 -> 回退 urlCollectFetch 降级路径
                         |
      3. 采集成功后自动调用 aggregation:rewrite
              |-- 成功 -> rewriteResult 赋值，显示改写内容
              |-- 失败 -> rewriteError 赋值，显示错误信息
                         |
      4. 结果区并排显示：左侧原文（只读），右侧改写后内容（可编辑）
```

**功能逻辑**：
- `collectAndRewrite()` 函数串联两个 IPC 调用
- 采集阶段的错误处理复用 `collectUrl()` 的降级逻辑（aggregationCollect 失败 -> urlCollectFetch）
- 改写阶段的错误不覆盖采集结果——原文始终保留在 `collectedResult.content`
- 修复改写不再覆盖原文：`rewriteCollected` 不再将 `result_content` 写回 `collectedResult.content`
- `clearResult()` 清理所有状态
- "取消"按钮绑定 `clearResult`

**交互逻辑**：
- 「一键改写」按钮在 collecting 或 oneClickRewriting 期间禁用
- 「采集」按钮在 oneClickRewriting 期间禁用（防止重复请求）
- 「AI改写」按钮在 oneClickRewriting 期间禁用
- 所有选项控件（checkbox、select）在 rewriting 或 oneClickRewriting 期间禁用
- 「一键改写」和「AI 改写」共用同一组风格/长度/爆款库/个人经历选项

**显示项**：
- 一键改写按钮文案："一键改写"
- 一键改写中按钮文案："一键改写中..."
- 采集原文标签："采集原文"
- 改写内容标签："改写内容"
- 原文区域：只读 textarea，灰色背景，显示 collectedResult.content
- 改写区域：可编辑 textarea，白色背景，可修改后存入草稿/去发布
- 双栏并排布局：grid-template-columns: 1fr 1fr；小屏（<=768px）自动切换为上下堆叠

**提示文字清单（zh / en）**：
| 键 | 中文 | 英文 |
|----|------|------|
| collection.oneClickRewrite | 一键改写 | One-click Rewrite |
| collection.oneClickRewriting | 一键改写中... | Rewriting... |
| collection.originalContent | 采集原文 | Original |
| collection.rewrittenContent | 改写内容 | Rewritten |

**测试覆盖**（Collection.test.js 新增 9 个用例）：
- 一键改写按钮渲染存在性
- 空链接校验 -> warning
- API 不可用校验 -> warning
- 成功采集+改写 -> 原文保留，改写结果独立，状态变量恢复
- 采集成功但改写失败 -> 原文不丢，rewriteError 有值
- urlCollectFetch 降级路径 -> 降级成功后改写继续
- rewriteCollected 不再覆盖原文
- clearResult 正确重置所有状态

**文件变更**：
- apps/desktop/src/views/Collection.vue：+1 按钮、+双栏对比区、+collectAndRewrite 函数、+clearResult 函数、+oneClickRewriting 状态、+CSS
- apps/desktop/src/views/Collection.test.js：+9 个测试用例
- apps/desktop/src/locales/zh.js：+4 个键
- apps/desktop/src/locales/en.js：+4 个键

### 2.5 图文发布页预填充 (Publish.vue)
- 无需改动：已有 mounted() 中 loadDraft(String(draftId)) 处理 /publish?draft=<id>，改写内容直接填入 article.content

### 2.6 视频创作页预填充 (CreateView.vue)
- 新增 _loadDraftForRewrite(draftId) 方法
- 读取草稿（draftList API）并填入 pipelineText
- 设置 inputMode = 'text'
- 如果 URL 含 pipeline=<name>，自动匹配并调用 selectPipeline()
- mounted() 末尾自动检测 route.query.draft

## 3. 技术映射

- 结合爆款库 → userSettings.purpose=engagement、tone=storytelling → strategy-manager 匹配 category=viral
- 结合个人经历 → checkbox 选中标记 → KnowledgeBase.getContextSummary() → knowledgeContext
- 故事讲述流水线 → pipeline=story2video-compose → CreateView.selectPipeline()

## 4. 交互流程

入口1: 左侧菜单「更多」→「文案改写」→ /rewrite 独立页面
入口2: 采集页 → 采集成功 → [改写] → checkbox 配置 → 改写
        ↓
     输入文案 (textarea)
        ↓
     配置选项（结合爆款库 / 结合个人经历 / 模式 / 平台）
        ↓
     [开始改写] 按钮
        ↓
     AI 改写中...
        ↓
     改写结果（可编辑）
        ├── [存入草稿] → 草稿箱存储
        └── [去发布] → 选择发布去向弹窗
                          ├── 直接发图文 → /publish?draft
                          └── 生成视频 [流水线选择:▾] → /create?draft&pipeline

## 5. 国际化 (i18n)

rewritePage 区块（文案改写页面）：
- title: 文案改写 / Copy Rewrite
- subtitle: AI 驱动的多策略文案改写引擎... / AI-powered multi-strategy...
- inputSection: 输入文案 / Input content
- inputPlaceholder: 输入或粘贴需要改写的文案内容... / Enter or paste content...
- configSection: 改写设置 / Rewrite settings
- useViralLibrary: 结合爆款库 / Use viral library
- useViralLibraryHint: 优先匹配爆款文案策略... / Prioritize viral content...
- usePersonalExperience: 结合个人经历 / Use personal experience
- usePersonalExperienceHint: 注入本地知识库中的个人偏好... / Inject local knowledge base...
- modeLabel: 改写模式 / Rewrite mode
- modeImitate: 智能仿写 / Smart imitation
- modeExpand: 扩写爆款 / Expand viral content
- modeCreate: 选题创作 / Topic creation
- platformLabel: 目标平台 / Target platform
- strategyLabel: 策略选择 / Strategy
- strategyAuto: 自动匹配 / Auto match
- strategyManual: 手动选择 / Manual select
- strategyPreview: 将匹配策略 / Will match strategy
- strategySelectPlaceholder: -- 选择策略 -- / -- Select strategy --
- rewriteBtn: 开始改写 / Rewrite
- rewritingBtn: 改写中... / Rewriting...
- resultSection: 改写结果 / Result
- metaStrategy: 策略 / Strategy
- metaAiTaste: AI味等级 / AI-taste level
- metaLength: {original} 字 → {result} 字 / {original} → {result} chars
- saveDraft: 存入草稿 / Save draft
- goPublish: 去发布 / Publish
- draftSaveFailed: 存入草稿失败 / Failed to save draft
- needLogin: AI 改写需要登录后使用，是否立即登录？ / AI rewrite requires login...
- contentEmpty: 请输入文案内容 / Please enter some content（2026-09-12 替代原 tooShort，移除最小字数）
- wordCountLabel: 字数控制 / Word count
- wordCountMinPlaceholder: 最小 / Min
- wordCountMaxPlaceholder: 最大 / Max
- wordCountUnit: 字 / chars
- wordCountMinInvalid: 最小字数需为 0-5999 的整数 / Min must be an integer between 0 and 5999
- wordCountMaxInvalid: 最大字数需为 1-6000 的整数 / Max must be an integer between 1 and 6000
- wordCountMaxLtMin: 最大字数不能小于最小字数 / Max cannot be less than min
- charCount: 字 / chars

publishDestination 区块（发布去向弹窗）：
- title: 选择发布去向 / Choose publish destination
- subtitle: 改写内容已存入草稿箱，请选择下一步操作 / Rewritten content saved to drafts...
- article: 直接发图文 / Publish image-text
- articleDesc: 打开图文发布页，改写内容将自动填入文案输入框 / Open the image-text publish page...
- video: 生成视频 / Generate video
- videoDesc: 打开视频创作流水线页，改写文本将自动填入文案输入框 / Open the video pipeline page...
- pipelineLabel: 流水线选择 / Pipeline
- close: 关闭 / Close

## 6. 文件变更清单

- apps/desktop/src/views/RewriteView.vue 新增：独立改写页面
- apps/desktop/src/views/RewriteView.test.js 新增：12 个单元测试
- apps/desktop/src/components/PublishDestinationModal.vue 新增：发布去向选择弹窗
- apps/desktop/src/router/index.js 修改：+1 行 /rewrite 路由
- apps/desktop/src/layouts/MpSidebar.vue 修改：+1 行菜单项
- apps/desktop/src/views/Collection.vue 修改：checkbox + 按钮 + 弹窗
- apps/desktop/src/views/CreateView.vue 修改：草稿预填充
- apps/desktop/src/locales/zh.js 修改：rewritePage + publishDestination
- apps/desktop/src/locales/en.js 修改：rewritePage + publishDestination

## 7. 质量检查

- [x] SFC 编译通过（vue/compiler-sfc parse + compileScript + compileTemplate）
- [x] 单元测试 12/12 通过
- [x] i18n zh/en 成对（rewritePage + publishDestination 区块）
- [x] 登录门控（useLoginGate.ensureLogin）
- [x] 传入内容校验（≥20 字前端拦截，≤6000 字后端校验）
- [x] 草稿存储走正式 IPC（draftSave/draftList）
- [ ] 视觉回归（需启动 Electron 桌面应用手动验收）
- [ ] CI 通过（待 push 后验证）

