# 全平台发布选项调研 + AI 生成内容能力比对报告

日期：2026-09-11 | 任务：platform-publish-options-audit | 状态：调研完成 + CCG 双模型审查完成（意见已合并修订）

## 摘要

对 15 个自媒体平台的图文/视频发布表单选项做了字段级调研，与 Multi-Publish 当前代码逐一比对。核心结论：

1. **共有字段覆盖良好**：标题、正文、标签、话题、@提及、封面、视频、图片、定时发布、AI 声明这 10 个跨平台共有字段，UI 层全部已实现。
2. **平台特有字段是主要缺口**：B站分区、YouTube 分类、可见性、合集/播放列表、位置、原创声明、商品、受众选择等 8 类平台特有字段，UI 层基本未实现；部分在 API adapter 层有实现但**未透传到桌面端**（如 B站分区 tid 恒为默认值 17）。
3. **AI 生成能力**：标题、正文润色、摘要、改写、标签建议、最佳发布时间 6 项已实现；封面 AI 生成、视频 AI 生成在 Story2Video 模块有引擎但**未接入发布表单**；分类、位置、合集、商品等无任何 AI 辅助。
4. **发现 1 个真实 Bug**：CreateView 的「AI 写稿」按钮调用的 `aiGenerate` 函数在 `api/publisher.js` 中不存在（按钮真实可达，CreateView.vue:913）；且修复需同时适配 type 参数（应为 `llm` 而非 `text`）与响应字段（返回的是 `content` 而非 `text`），仅补导出不够。

## 第一部分：平台发布选项全景（调研结果）

### 1.1 共有字段（跨平台）

| 字段 | 必填性（多数平台） | 说明 |
|------|------|------|
| 标题 | 视频平台普遍必填；图文平台多数必填（微博/Twitter 无独立标题） | 各平台长度限制差异大（小红书 20 字 / 头条 30 字 / B站 80 字） |
| 正文/描述 | 图文平台必填；视频平台可选（作为描述） | 微博 2000 字 / 知乎 10 万字 |
| 话题标签 | 普遍可选 | 抖音/小红书以话题为核心流量入口 |
| 封面图 | 公众号必填；视频平台普遍可选（可自动取帧） | 公众号 900x500、B站 1146x717 |
| 视频/图片文件 | 对应形态必填 | 视频宽高在百家号是必填项 |
| 定时发布 | 普遍可选 | YouTube/B站/头条等支持 |
| @提及 | 普遍可选 | 微博/Twitter 核心互动方式 |
| AI 内容声明 | 各平台逐步强制（快手/百家号默认勾选） | 中国平台监管趋势 |

### 1.2 平台特有字段（调研清单）

| 平台 | 特有字段 | 必填/可选 |
|------|------|------|
| 微信公众号 | 摘要 digest、原文链接、评论开关、群发/发布方式、原创声明 | 均可选（摘要空则取正文前 54 字） |
| 知乎 | 创作声明 declare（剧透/医疗/虚构/金融/AI 创作 5 类） | 可选 |
| 微博 | @提及（核心）、投票、可见范围 | 可选 |
| 抖音 | 合集、位置、原创声明、AI 声明、商品橱窗 | 可选（合集需先创建） |
| 小红书 | 位置（地点）、合集、@提及 | 可选（位置是小红书流量入口之一） |
| 视频号 | 位置、@提醒 | 可选 |
| 快手 | AI 生成声明（平台强制如实） | 可选（默认勾选） |
| 头条 | 原创声明、合集、位置 | 可选 |
| B站 | **分区 tid（必填）**、版权声明 copyright（必填：自制/转载）、合集、充电 | 分区+版权必填 |
| 百家号 | 位置、原创声明、AI 声明、合集、首发声明、视频宽高（必填） | 多数可选 |
| YouTube | 分类 categoryId、可见性 privacy、播放列表、面向儿童声明（必填）、定时 | 儿童声明必填，其余可选 |
| TikTok | 可见性 privacy_level、位置、合拍/评论权限、AI 声明 | 可选 |
| Twitter/X | 受众（所有人/关注者）、投票、位置、定时 | 可选 |
| Instagram | 位置、高级设置（隐藏点赞/关闭评论）、交叉发布到 Facebook | 可选 |
| Facebook | 受众选择（公开/好友/仅自己）、位置、定时、交叉发布到 Instagram | 可选 |

> 必填/可选标注依据：仓库 adapter 字段契约（`packages/api-publish-engine/src/adapters/*.js`）、RPA 选择器（`packages/rpa-engine/src/platform-selectors.js`）、`01-docs/wechat-publisher-api.md`、`01-docs/PRD-mp-reuse.md`、YouTube 官方帮助页。国内平台发布页实际必填性未逐字段联网核实，标注「待确认」处以平台通用流程推断。

## 第二部分：项目代码现状（审计结果）

### 2.1 UI 层字段（apps/desktop/src/views/Publish.vue）

单篇模式 12 字段全部实现（图文 L279-398 / 视频 L186-277）：标题、作者、图片素材、正文、视频文件、封面图（视频形态含提取/裁剪）、标签、话题、@好友、定时发布、AI 内容声明、平台差异化内容。

侧栏 AI 辅助（L401-455）：标签建议 TagSuggester、最佳发布时间 OptimalTimeTip、标题参考 TitleAssistantPanel。

**批量模式缺口**（L69-180）：无 AI 声明、无封面/图片/视频上传，`batchCreate` payload（useBatchPublish.js:382-400）不含 `aiGenerated`。

### 2.2 平台差异化面板（PlatformOverridePanel.vue）

仅 3 个平台有专属字段：zhihu（评论权限/创作声明/话题/草稿）、douyin（草稿）、wechat_mp（草稿后群发）。其余 12 平台无差异化字段。

### 2.3 发布链路（publisher-router.js → RPA/API 双模）

- 桌面统一 article（publisher-router.js:142-161）：title/content/video_path/cover_path/tags/draft/mentions/images/aiGenerated + zhihu专属 + wechat_mp专属。**不含 location/original/category/合集/商品**。
- API taskData（publisher-router.js:374）：title/content/tags/draft/aiGenerated/video/cover，**不透传 category/location/original** → B站分区恒为默认 17、百家号位置恒空对象、原创声明恒关闭。
- 模式分布（经审查修正）：Instagram/Facebook 仅 RPA；百家号路由表直连 API；**youtube/tiktok/twitter/weibo/douyin 走 API-first 回退**——rpa-view-manager.js:49-76 在 RPA 路径内先调 API adapter（shouldUseApi 读 platforms.yaml has_api:true && supportsApi 注册即触发），失败才回退浏览器。即这些 adapter 实际可达，非死代码。

## 第三部分：逐项比对（用户问的 11 项）

| # | 能力 | UI | 链路 | AI 生成 | 结论 |
|---|------|----|----|------|------|
| 1 | 标题 | ✅ Publish.vue:283 | ✅ 全平台 | ✅ AI 生成（ai:generate-titles）+ 标题参考（intelligence:search-titles） | **完整** |
| 2 | 话题标签 | ✅ Publish.vue:360 | ✅ 全平台（RPA 最多5个） | ✅ LLM 标签建议+热门校准（intelligence:suggest-tags） | **完整** |
| 3 | 正文 | ✅ Publish.vue:332 | ✅ 全平台 | ✅ 润色/摘要/改写（ai:enhance-content / ai:generate-summary / ai:rewrite） | **完整** |
| 4 | 封面 | ✅ Publish.vue:344 | ⚠️ 部分（公众号 API 必填已支持；百家号 API 拒绝自定义封面） | ⚠️ 仅视频抽帧+裁剪（cover:extract/crop），无 AI 生图 | **基本完整** |
| 5 | 分类 | ❌ UI 无 | ⚠️ B站 tid 恒 17（bilibili.js:28）、YouTube categoryId 恒 "22"（youtube.js:85）、privacy 恒 "public"（youtube.js:88）——adapter 有但 taskData 未透传；B站 has_api:false 实际走 RPA 通用流程（无分区选择器），两条路径都不处理分区 | ❌ 无 AI 辅助 | **缺失** |
| 6 | 内容声明 | ✅ AI 声明（Publish.vue:379）+ 知乎创作声明 | ✅ 快手（API+RPA）/百家号（API+RPA）/B站（RPA）3 平台；知乎 declare 是创作声明枚举（剧透/医疗/虚构/金融/AI创作），不消费 aiGenerated | —（声明本身非 AI 生成） | **部分**（AI 声明 3 平台；原创声明缺失） |
| 7 | 视频 | ✅ Publish.vue:190 | ✅ 全平台 | ⚠️ Story2Video 有生视频引擎（ai:generate type=video），未接入发布表单 | **基本完整**（发布侧完整，AI 生成未打通） |
| 8 | 位置 | ❌ UI 无 | ⚠️ 仅百家号 adapter（position_lat_lng），RPA 填"全国" | ❌ 无 | **缺失** |
| 9 | 加入合集 | ❌ UI 无 | ❌ 全链路无消费（百家号 bjhtopic 传空） | ❌ 无 | **完全缺失** |
| 10 | 任务 | ❌ UI 无 | ❌ 无 | ❌ 无 | **完全缺失**（平台侧指"参与任务/活动"，如抖音话题挑战） |
| 11 | 商品 | ❌ UI 无 | ❌ 全库无 goods 字段 | ❌ 无 | **完全缺失** |

补充比对（用户清单外但审计发现）：
- **作者字段**：UI ✅ / 链路仅公众号 RPA 消费（_publish_wechat_mp L908）→ 其他平台不生效，**半实现**。
- **@提及**：UI ✅ / 链路 ✅（mentions 透传），**完整**。
- **可见性/受众**（YouTube privacy/TikTok privacy_level/FB 受众）：UI ❌ / adapter 部分有（默认 public），**缺失**。
- **定时发布**：UI ✅（publishTime）/ 链路 scheduler 独立通道（scheduler:create），**完整**。
- **摘要**（公众号 digest）：UI ❌ / adapter 未实现（空则平台自动取正文），**缺失**。
- **评论开关**（公众号 need_open_comment / IG 高级设置）：UI ❌ / zhihu 评论权限有，**部分**。
- **AI 写稿 Bug**：CreateView.vue:6277 动态导入 `aiGenerate`，但 api/publisher.js 全文（493 行）无此导出（仅 aiGenerateTitles/aiGenerateSummary 近似名）→ 运行时解构得 undefined，调用抛 TypeError（被 try/catch 捕获显示「AI 写稿失败」，不崩溃）。且修复需三处适配：type 参数（`text`→`llm`）、响应字段（`r.data.text`→`r.data.content`，见 ipc-handlers/ai.js:29-44 + ai-generator.js:144）、导出本身。

## 第四部分：AI 生成能力完整清单

| 能力 | 状态 | UI 入口 | IPC 通道 | 引擎 |
|------|------|------|------|------|
| AI 标题生成 | ✅ | AiWriterPanel（open-ai-writer 按钮） | ai:generate-titles | packages/ai-writer（OpenAI 兼容 API） |
| 正文润色 | ✅ | AiWriterPanel | ai:enhance-content | 同上 |
| 摘要生成 | ✅ | AiWriterPanel | ai:generate-summary | 同上 |
| 内容改写 | ✅ | AiWriterPanel | ai:rewrite | rewrite-engine 包（策略化改写） |
| 标签建议 | ✅ | TagSuggester 侧栏 | intelligence:suggest-tags | content-intelligence（LLM+热门库校准+本地摘词回退） |
| 标题参考 | ✅ | TitleAssistantPanel 侧栏 | intelligence:search-titles | content-intelligence（搜索方案 B） |
| 最佳发布时间 | ✅ | OptimalTimeTip 侧栏 | intelligence:get-optimal-time | content-intelligence |
| 视频封面提取 | ✅ | 视频表单「提取封面」 | cover:extract | ffmpeg 抽帧（非 AI） |
| 封面裁剪 | ✅ | CoverCropDialog | cover:crop | 本地裁剪（非 AI） |
| **AI 封面生成** | ❌ 未接入 | 无 | （ai:generate type=image 引擎存在，asset-generator.js:669） | Story2Video 的 image provider 可用，但发布表单无入口 |
| **AI 视频生成** | ❌ 未接入 | 无 | （ai:generate type=video 引擎存在） | Story2Video 场景视频生成可用，但发布表单无入口 |
| 分类 AI 辅助 | ❌ | — | — | 无 |
| 位置/合集/商品 AI 辅助 | ❌ | — | — | 无 |

引擎侧统一入口 `ai:generate`（ipc-handlers/ai.js:29-44）支持 type=llm/tts/image/video/audio（ai-generator.js:75），经 ModelProviderManager 多 provider 路由 + 故障转移 + 限流网关。**能力在，发布表单未消费。**

## 第五部分：缺口分级与实现计划

### P0 — 修复断链（2-3 天，经审查上调：P0-1 需三处适配 + P0-3 涉及多 adapter 契约）

| 项 | 内容 | 文件 |
|----|------|------|
| P0-1 | 修复 CreateView AI 写稿（三处适配缺一不可）：① api/publisher.js 补 `aiGenerate` 导出映射 `ai:generate`；② CreateView 调用参数 `type='text'` 改 `'llm'`（TYPE_TO_METHOD 契约，ai-generator.js:17-24）；③ 响应读取 `r.data?.text` 改 `r.data?.content`（ipc-handlers/ai.js:38）。或整体改调已有 aiGenerateTitles | apps/desktop/src/api/publisher.js（全文无此导出）, CreateView.vue:6277-6279 |
| P0-2 | 批量模式补 aiGenerated 字段（与单篇一致，避免「如实声明」契约不一致） | useBatchPublish.js:187-207, 382-400 |
| P0-3 | API taskData 透传 category/location/original/categoryId/privacy（B站分区/百家号位置/原创声明/YouTube 分类与可见性当前恒默认值；注意 API-first 回退路径同样消费 taskData） | publisher-router.js:374-388, youtube.js:85,88 |

### P1 — 平台特有字段 UI（1-2 周）

| 项 | 内容 | 涉及平台 |
|----|------|------|
| P1-1 | PlatformOverridePanel 扩展：B站分区（必填下拉+版权声明，**需同时补 RPA 选择器**——B站 has_api:false 走 RPA 通用流程无分区处理）、YouTube 分类+可见性+儿童声明、TikTok 可见性 | bilibili/youtube/tiktok |
| P1-2 | 位置字段（通用 POI 搜索或手输，透传 xiaohongshu/baijiahao/视频号/抖音） | 4 平台 |
| P1-3 | 原创声明开关（透传 baijiahao original_status / 头条 / 公众号） | 3 平台 |
| P1-4 | 摘要字段（公众号 digest，UI 输入+AI 生成复用 generateSummary） | 公众号 |
| P1-5 | 作者字段链路打通（当前仅公众号 RPA 消费） | 全平台 |

### P2 — 合集与 AI 生成接入（2-4 周）

| 项 | 内容 |
|----|------|
| P2-1 | 合集/播放列表：平台 API 拉取用户合集列表 → 下拉选择 → 透传（抖音 collection_id / B站 season_id / YouTube playlistId / 百家号 bjhtopic_id） |
| P2-2 | AI 封面生成接入发布表单：封面区加「AI 生成」按钮 → ai:generate type=image → 落 cover_path（复用 Story2Video asset-generator） |
| P2-3 | AI 视频生成入口（可选）：发布表单视频区加「AI 生成视频」或引导到 Story2Video 流水线 |
| P2-4 | 可见性/受众选择（YouTube/TikTok/Facebook/X） |

### P3 — 长尾（按需）

| 项 | 内容 |
|----|------|
| P3-1 | 商品橱窗（需电商权限，抖音/小红书） |
| P3-2 | 任务/活动参与（平台活动 ID 接入） |
| P3-3 | 评论开关/高级设置（公众号/IG） |
| P3-4 | 投票（微博/X）、交叉发布（IG↔FB） |
| P3-5 | 国内平台必填性实测（RPA 实测各平台发布页，修正「待确认」标注） |

### 实施原则

1. 字段契约分层：UI 渲染层契约在 apps/desktop/src/features/publish/publish-contract.js（仅渲染层消费）；**发布链路契约实际在 publisher-router.js buildPublishArticle + 各 adapter buildPostData**——每加一个平台特有字段，两层契约都要动，且 UI → buildArticleData → buildPublishArticle → taskData/adapter 四层闭环（参考 PR #998 的 DI 三步教训）。
2. 透传链路完整闭环：UI → buildArticleData → buildPublishArticle → taskData/adapter，四层缺一即「半实现」（本次审计的 B站分区即此问题）。
3. AI 声明默认值策略保持 fail-safe：`aiGenerated !== false` 默认 true 的语义不改动（kuaishou.js:33、usePublishFlow.js:209），新增平台声明字段遵循同一模式。
4. 每项 P1/P2 落地需配回归测试（字段透传断言 + UI 渲染断言），遵循 QM 门禁。

## 附录：证据边界

- 代码出处均为本仓库当前 HEAD（main == origin/main == 98b4e779，经审查实测零落后，出处新鲜度已确认）。
- 平台字段调研基于仓库 adapter/RPA 选择器/逆向文档 + YouTube 官方帮助页；国内平台发布页实际必填性未逐字段联网核实（探子联网受限），报告已标注「待确认」。
- 本报告为调研产出，未修改任何运行时代码；P0-P3 计划为建议，实施前需按质量节拍走 PRD/架构评审。
- **审查记录**：已经 CCG 双模型审查（opencode 深度核验 + claude 交叉审查），按审查意见修正 4 处 Critical（API-first 回退机制、知乎声明口径、P0-1 修复方案、git 状态）与 5 处 Warning（YouTube 默认值、行号精度、B站 RPA 分区、契约分层）。审查原文：`.ccg/tasks/archive/2026-09/audit-platform-publish-options-report/review.md`（opencode）与 claude 审查结论 80/100。
- RPA 选择器（platform-selectors.js）与平台当前页面 DOM 的匹配度未实测，平台改版可能导致选择器失效，实施 P1 时需逐一回归。
