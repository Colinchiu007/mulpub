# PRD — 「更多」菜单新增「热门选题」功能模块

- 文档编号：PRD-HOT-TOPICS-MODULE-2026-09-11
- 状态：已合并（PR #1701，squash 提交 76e555bf，2026-09-11）；2026-09-12 追加「一键生成视频」（§3.10/§5.6）；2026-09-13 修正「后台运行后的并发语义」（前端不再自设单任务锁，支持多任务并行，§3.10/§5.6/§6.6/§6.7）
- 关联分支：`codex/hot-topics-module`
- 关联模块：`apps/desktop/src/views/HotTopics.vue`、`apps/desktop/electron/services/hot-topics-service.js`
- 创建日期：2026-09-11

## 1. 背景与目标

自媒体创作者（图文与视频）的核心痛点之一是「选题」：不知道今天写什么、拍什么。各大平台（微博、知乎、百度、B站、抖音、头条等）每天都会产生热搜榜/热榜标题，这些标题天然就是内容选题或标题素材，但分散在十几个网站里，人工逐个查看效率极低。

本需求在应用左侧菜单「更多」分组中新增「热门选题」模块，用于：

1. 从多个公开渠道定期聚合热门选题（热搜榜标题），形成统一列表；
2. 按常见内容类别（综合/社会/财经/科技/娱乐/体育/情感/教育/健康/国际）分类展示；
3. 每个选题带勾选框，支持批量操作：【创作文案】（跳转文案改写页，自动进入选题创作模式并自动开始改写）与【一键发布】（先自动改写生成新文案，再走采集页一键发布流程）；
4. 采集过程复用采集模块的防反爬体系（限流、熔断、冷却、缓存），避免封 IP。

## 2. 术语定义

| 术语 | 含义 |
|------|------|
| 热门选题（选题/选题） | 自媒体内容（图文和视频）的文案内容选题或标题；常见形态是一个词汇、一句话或一个短句；来源于各平台热搜榜/热榜的标题条目 |
| 渠道 | 提供热门选题数据的公开站点/接口，如知乎热榜、今日头条热榜、百度热搜等 |
| 分类 | 选题所属内容类别，共 10 类：综合、社会、财经、科技、娱乐、体育、情感、教育、健康、国际 |
| 创作文案 | 把选题文本带入文案改写页输入框、改写模式设为「选题创作」并自动开始改写的动作 |
| 一键发布 | 对选中选题先批量自动改写、生成新文案存为草稿，再跳转发布页草稿列表的流程 |
| 选题创作 | 文案改写页已有改写模式（`create`），以给定选题为起点创作全新文案 |
| 渠道原生分类 | 渠道接口返回数据中自带的选题分类字段（如头条的 Category、腾讯的领域信息） |

## 3. 功能范围

### 3.1 菜单入口（P0）

- 左侧菜单「更多」分组（`YixiaoerSidebar.vue` 的 `moreItems`）新增一项：`{ key: 'hot-topics', label: t('hotTopics.menuLabel'), to: '/hot-topics', icon: TrendCharts }`。
- 路由 `/hot-topics` 懒加载 `HotTopics.vue`，路由名 `HotTopics`。
- 菜单 label 走 i18n key `hotTopics.menuLabel`（zh/en 成对）。

### 3.2 选题列表页（P0）

- 页面结构：顶部标题区（页面标题 + 描述 + 分类筛选 chips + 渠道筛选下拉 + 【刷新】按钮 + 上次刷新时间）→ 批量操作条（全选/取消全选 + 已选计数 + 【创作文案】+【一键发布】）→ 选题列表。
- 每个选题条目：勾选框 + 排名徽标（渠道内排名）+ 选题标题 + 分类标签 + 渠道标签 + 热度值（如有）+ 单条【创作文案】快捷按钮。
- 列表为空时展示空状态：标题「暂无热门选题」+ 描述「点击刷新按钮获取最新选题，或等待自动刷新」+ 【立即刷新】按钮。
- 加载中展示加载指示器。
- 单渠道失败不阻塞整体：列表正常渲染其余渠道数据，失败渠道在渠道下拉中标记「不可用」并在页面顶部以警告条提示「部分渠道获取失败：xxx」。

### 3.3 分类体系（P0）

10 个分类，映射规则：

1. **渠道原生分类优先**：头条 `Category`、腾讯领域字段直接映射到 10 类之一（映射表见 5.2）；无法映射的原生分类归入综合。
2. **关键词规则兜底**：无原生分类的渠道（知乎/B站/抖音/百度/tophub-微博）用类别关键词表匹配（如 财经：股票/基金/A股/楼市/房价/经济；科技：AI/芯片/手机/互联网；情感：恋爱/婚姻/离婚/相亲；体育：足球/篮球/奥运；娱乐：明星/综艺/电影/演唱会；教育：高考/考研/开学；健康：医院/疫苗/养生；国际：美国/日本/韩国/国际）。
3. **兜底归综合**：规则匹配不中的选题归入「综合」。

### 3.4 创作文案（P0）

- 单条快捷按钮与批量【创作文案】：跳转 `/rewrite?topic=<encodeURIComponent(topic)>`。
- 改写页 `RewriteView.vue` 读取 `route.query.topic`：非空时填入 `content`，`rewriteMode` 设为 `create`（选题创作），并自动调用 `startRewrite()`。
- topic 为空/缺失时不做任何填充，保持页面原状（防止误触发）。
- 自动改写前置校验与手动一致：内容 ≥20 字符才启动；不足 20 字符的选题（如单个词汇）自动补充引导语「请以下面这个选题为主题，创作一篇适合自媒体发布的文案：」以满足长度门槛并给 AI 明确指令。

**topic 长度补足规则**：选题长度不足 20 字符时，前置引导语 + 选题原文拼接作为改写输入：

```
请以下面这个选题为主题，创作一篇适合自媒体发布的文案：
${topic}
```

### 3.5 一键发布（P0）

- 勾选选题 + 点击【一键发布】→ 弹出与采集页相同的 `PublishDestinationModal`，用户选择「图文发布」或「视频发布」。
- 选择后进入批量自动改写阶段：逐条调用改写 IPC（`aiRewrite`，模式 `create`），页面内显示批量进度（已完成 n/总数、每条成功/失败状态、整体进度条）；失败条目标红，支持单条重试。
- 全部改写完成后：逐条把改写结果存为草稿（复用采集页 `saveDraftAfterRewrite` 的草稿构造逻辑），然后跳转：
  - 图文发布 → `/publish`（草稿列表，用户逐条确认发送）；
  - 视频发布 → `/create?draft=<lastDraftId>`（视频创作页，带入最后一个草稿）。
- 批量改写中途用户可【取消】：已完成的草稿保留，未完成的条目恢复未改写状态。

### 3.6 定时刷新（P0）

- 应用启动后首次进入页面自动拉取（若缓存超过 10 分钟）。
- 页面内每 30 分钟自动刷新一次（可配置，设置项 `hotTopics.refreshIntervalMinutes`，默认 30，范围 5-120）。
- 单渠道最小抓取间隔：知乎/头条/腾讯/B站 5 分钟，抖音 15 分钟，百度 10 分钟，tophub 30 分钟（由渠道策略配置控制，复用 rate-limiter）。
- 刷新结果缓存落 SQLite（settings 表 key `hot_topics_cache`），结构：`{ topics: [...], fetchedAt, channelStats }`；缓存有效期 10 分钟（`CACHE_TTL_MS = 10 * 60 * 1000`）。

### 3.7 防反爬体系（P0）

复用 `packages/collection-engine` 现有组件：

| 组件 | 用途 |
|------|------|
| `rate-limiter.js` | 单渠道最小间隔 + 随机抖动 + 活跃时段 |
| `circuit-breaker.js` | 连续 3 次失败熔断 30 分钟 |
| `content-cache.js` | URL+内容哈希去重，避免重复抓取 |
| `default-strategies.json` | 渠道级参数（riskLevel/dailyBudget/interval） |

请求层约定：

- 统一 `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)`（桌面 Chrome UA）；
- 抖音渠道必须携带 `Referer: https://www.douyin.com/`（实测缺 Referer 返回空 body）；
- 超时 10 秒（`AbortController`），失败不自动重试（熔断器计数），下次刷新周期再试；
- 每渠道每次刷新最多取 top 20 条；
- SSRF 防护：仅允许 https/http、拒绝内网地址。

### 3.8 渠道清单（P0 接入 7 个）

| # | 渠道 | 端点 | 格式 | 登录 | 建议间隔 |
|---|------|------|------|------|---------|
| 1 | 知乎热榜 | `www.zhihu.com/api/v4/creators/rank/hot?domain=0` | JSON | 无 | 5-10 分钟 |
| 2 | 今日头条 | `www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc` | JSON | 无 | 5-10 分钟 |
| 3 | 腾讯新闻 | `r.inews.qq.com/gw/event/hot_ranking_list?page_size=20` | JSON | 无 | 10 分钟 |
| 4 | 哔哩哔哩 | `api.bilibili.com/x/web-interface/popular?ps=20&pn=1` | JSON | 无 | 10 分钟 |
| 5 | 抖音热点 | `www.douyin.com/aweme/v1/web/hot/search/list/` | JSON | 无（需 Referer） | 15 分钟 |
| 6 | 百度热搜 | `top.baidu.com/board?tab=realtime` | HTML 内嵌 JSON | 无 | 10 分钟 |
| 7 | tophub.today（含微博榜） | `tophub.today` 聚合页 | HTML | 无 | 15-30 分钟 |

明确不接入：微博直连（432/passport 反爬）、RSSHub 公共实例（Cloudflare 拦截）、网易新闻（端点失效）。tophub 作为微博数据的间接来源。

### 3.9 非目标（Out of Scope）

- 不做选题搜索/自定义选题订阅；
- 不做选题热度趋势图/历史对比；
- 不做 AI 自动分类（本期用原生分类+规则）；
- 不做发布动作的全自动发送（发布仍需用户在发布页确认）；
- 不做自建 RSSHub/代理池。

### 3.10 一键生成视频（P0，2026-09-12 新增）

每条选题新增【生成视频】按钮（与【创作文案】并列，data-testid="hot-topic-generate-video-{id}"）。点击后弹出与视频创作页流水线进度弹窗同样 UI 的进度弹窗（UiModal variant=progress + StageProgress），自动执行完整编排：

1. **文案改写阶段**（stage 名 rewrite_copy）：调用 aiRewrite(mode='create', content=buildRewriteInput(topic))，输入构造与一键发布一致（<20 字补引导前缀）。改写产物自动存入草稿箱（draftSave，source='hot-topics'，草稿保存失败不阻断视频生成）。
2. **自动启动故事讲述流水线**：读取用户已保存的默认选项（settings key story2video.lastOptions.v1，owner-scoped SQLite；缺失/非法回退内置默认值），用共享纯函数 buildStory2VideoTextConfigFromSnapshot 构建 story2videoTextConfig，调用 pipelineStartOrchestrated('story2video-compose', params)。params 与创作页 startOrchestratedPipeline 完全一致（text=改写产物、inputMode='text'、checkpointPolicy='none'、autoAdvance=true、background=true、uiLocale）。
3. **进度实时跟踪**：启动成功后订阅 onPipelineUpdate 实时推送 + 3s 轮询 pipelineGetRunContext 兜底（双通道，与创作页 startOrchestrationForeground 同口径）。runId 快照守卫防竞态。
4. **完成跳转**：流水线 completed 且提取到 videoPath（publish/compose 上下文的 videoPath/path）→ 关闭弹窗跳转 /create/result?path=...。

弹窗 stages = [rewrite_copy, split, scene_context, optimize, select_video_scenes, generate_assets, compose, publish]（8 阶段，改写环节在最前）。进度百分比 = 已完成阶段数/总数 + 流水线 run progress 映射到当前阶段区间；耗时从点击开始累计；StageProgress 的合成时间参考说明（showTimeGuidance）开启。

**取消语义**：
- 改写/启动阶段取消 = 仅中止前端编排（流水线尚未启动，无副作用）；
- 流水线运行中取消 = 调用 pipelineCancel()（取消当前 run）；
- 运行中关闭弹窗（右上角 ×）= 后台运行（停止前端跟踪并复位前端态，run 继续在主进程执行，提示可在视频创作页历史记录查看）；
- 改写/启动阶段关闭弹窗（右上角 ×，此时尚无 run）= 中止前端编排：使在途 aiRewrite / pipelineStartOrchestrated 响应失效（genVideoSeq 递增），弹窗关闭且不产生后台任务（无 run 可脱离，不误报「已转入后台」）。

**后台运行按钮**（2026-09-13 新增，与视频创作页进度弹窗对齐；2026-09-13 修正脱离后的复位语义）：

- 弹窗 footer 在【重试】与【取消】之间新增显式【后台运行】按钮（data-testid="hot-topics-gen-video-background"，文案 hotTopics.genVideoBackgroundRun），仅当 genVideoPhase === 'running' 且持有 runId 时显示；
- 点击行为与右上角 × 的后台语义完全一致（复用唯一公共脱离路径 handleGenVideoClose）：停止前端跟踪（轮询/订阅/计时器）并调用 resetGenVideoFrontendState() 复位前端态（弹窗关闭、phase='idle'、topic/stages/runId/progress/errorText/startedAt 清空、**genVideoBusy 释放**）、主进程 run 不受影响继续执行、不调用 pipelineCancelRun；
- 额外触发**全局居中提示**（见 §6.6）：应用界面正中央显示「如果想查看该任务，请进入视频创作的历史记录」，4 秒后自动消失；同时顶部 toast 提示 hotTopics.genVideoBackgroundHint；
- 改写/启动阶段（无主进程 run）与终态（completed/failed/cancelled）不显示该按钮——脱离无意义或已无任务可脱离。

**失败重试**：改写失败 → 重试从改写开始；流水线启动失败 → 重试跳过改写（产物已缓存）直接重启流水线。失败阶段在弹窗中标红显示错误摘要。

**并发约束（2026-09-13 修正）**：热门选题的一键生成视频**支持多任务并行**，与视频创作页流水线语义完全一致——后台脱离（或终态关闭）后前端立即复位，所有选题的【生成视频】按钮恢复可用，用户可对任意选题再次发起任务；并发的权威闸门是**主进程流水线并发门禁**（maxConcurrentRuns，超限返回 PIPELINE_CONCURRENCY_LIMIT，提示「当前已有 N 条流水线正在运行，最多同时运行 M 条」），前端按「流水线启动失败」处理并展示错误摘要 + 【重试】（重试跳过改写）。前端 busy 守卫只在**同一弹窗编排在途时**生效（rewriting/starting/running 且尚未脱离），用于避免同一弹窗内产生两条不受跟踪的编排，不用于限制并行任务数。详见 §6.7。

## 4. 数据校验

### 4.1 选题条目结构

| 字段 | 类型 | 校验规则 |
|------|------|---------|
| `id` | string | 必填；`channel + ':' + rank`；列表 key 与操作定位依据 |
| `topic` | string | 必填非空；trim 后长度 1-100；超长截断到 100 字符加省略号展示（完整文本保留在 title 属性） |
| `channel` | string | 必填；7 渠道枚举之一（`zhihu/toutiao/tencent/bilibili/douyin/baidu/tophub`） |
| `category` | string | 必填；10 分类枚举之一；缺省 `general`（综合） |
| `rank` | number | 0-50；渠道内排名 |
| `hotValue` | number \| null | 可空；渠道原始热度值（知乎热度分/B站播放等），仅展示用 |
| `url` | string \| null | 可空；选题详情链接；仅允许 http/https 协议，其他协议丢弃置 null |
| `fetchedAt` | string | ISO 时间戳；本批数据抓取时间 |

### 4.2 校验与防御规则

- **反序列化 fail-closed**：缓存读取 `JSON.parse` 失败或非对象/非数组 `topics` 时回退 `{ topics: [], fetchedAt: 0, channelStats: {} }`，不抛错。
- **去重**：同批次跨渠道按 `topic.trim()` 归一化去重（保留先到者，记录 `mergedFrom: [channel]` 数组）；同渠道内按 rank 去重。
- **HTML 实体解码**：HTML 渠道（百度/tophub）解析出的文本必须解码（`&amp;` 等）。
- **XSS**：选题文本一律经 Vue 转义渲染（`{{ }}`），禁止 v-html。
- **批量上限**：单次批量改写最多 20 条（超出提示「一次最多批量处理 20 条选题，请减少选择」）。
- **空选择守卫**：【创作文案】/【一键发布】未勾选任何选题时提示「请先勾选至少一条选题」。

## 5. 流程与功能逻辑

### 5.1 刷新流程

```
进入页面（onMounted，SWR 缓存优先）
  → hotTopicsGetCache() 读缓存（IPC，内存+SQLite，立即返回）
    ├─ 缓存有数据（topics.length > 0）→ 立即渲染缓存内容（0 网络等待）
    │   → 后台静默 refresh(force=false)：不显示中央提示、不打断已渲染内容
    │   → 主进程缓存新鲜（<10min）直接返回缓存；过期则并发抓取后替换列表
    └─ 缓存为空（首次使用）→ refresh(force=false) 网络抓取 + 中央加载提示

点击【刷新】（手动，force=true）
  → 显示中央加载提示（用户明确等待场景）→ 并发调用 7 渠道 fetch

定时器触发（每 30 分钟，页面可见时）
  → 后台静默 refresh(force=false)：无中央提示，不打断用户

并发抓取（7 渠道，各自过 rate-limiter + circuit-breaker 门禁）
  → 每渠道成功：解析 → 提取 top20 → 分类 → 入列表；失败：记入 channelStats.failed，不阻塞其他渠道
  → 全部返回后：跨渠道去重 → 按 fetchedAt 写缓存 → 更新页面状态

中央加载提示显隐规则
  → 显示：首次进入无缓存抓取中 / 用户点击【刷新】手动抓取中
  → 隐藏：抓取完成（成功/失败/异常）后淡出；后台静默刷新一律不显示
  → 已有内容时后台刷新：列表原地更新，内容不消失、无遮挡
```

### 5.2 分类映射流程

```
选题条目
  → 渠道有原生分类字段？
    ├─ 是 → 查原生分类映射表（头条 Category → 10 类）→ 命中 → 用之
    │        └─ 未命中 → 落入规则匹配
    └─ 否 → 关键词规则匹配（10 类词表，优先级：国际 > 社会 > 财经 > 科技 > 娱乐 > 体育 > 情感 > 教育 > 健康）
  → 规则不中 → 综合（general）
```

### 5.3 创作文案流程（单条与批量同构）

```
用户点击【创作文案】（单条或勾选后批量）
  → 勾选校验（批量时 ≥1 条，上限 20）
  → 单条：直接跳转 /rewrite?topic=xxx
  → 批量：把勾选选题存入 sessionStorage（key hot_topics_selected，上限 20 条）
        → 跳转 /rewrite?topic=<第一条>
        → 改写页读完 query 后保留 session 队列供后续手动消费（本期简化：批量创作=存队列 + 首条自动开始，改写页不新增队列 UI）
```

### 5.4 一键发布流程

```
勾选选题 + 点击【一键发布】
  → 弹 PublishDestinationModal
  → 用户选「图文发布」或「视频发布」
  → 批量自动改写（逐条 aiRewrite，模式 create，输入=引导语+topic）
  → 进度展示：n/total、单条状态（pending/rewriting/success/failed）、进度条
  → 单条失败：标红 + 【重试】按钮；整体不中断
  → 全部完成（或用户点【取消】）
  → 成功条目逐条存草稿（title=改写结果标题或选题、content=改写正文、source='hot-topics'）
  → 图文：跳 /publish（草稿列表）
  → 视频：跳 /create?draft=<lastDraftId>
```

### 5.5 定时刷新逻辑

```
onMounted
  → hotTopicsGetCache() 读缓存（SWR）
    ├─ 有数据 → 立即渲染 + 后台静默 refresh(force=false, background=true)
    └─ 无数据 → refresh(force=false)（中央加载提示）
  → 启动 setInterval(30min, refresh(force=false, background=true))
onUnmounted → clearInterval
```

`document.hidden` 时跳过自动刷新 tick，恢复可见时检查缓存过期则刷新。

### 5.6 一键生成视频流程

```
用户点击某选题的【生成视频】
  → busy 守卫（进行中则忽略）→ 初始化 8 阶段弹窗（全部 pending）
  → 阶段 rewrite_copy: running
  → aiRewrite(mode=create, content=引导语+topic)
    ├─ 成功 → 产物存草稿（失败不阻断）→ rewrite_copy: completed
    │   → 读取 story2video.lastOptions.v1（缺失回退默认）
    │   → buildStory2VideoTextConfigFromSnapshot(text, snapshot)
    │   → pipelineStartOrchestrated('story2video-compose', params)
    │     ├─ 成功 → runId 记录 → split: running → 开启双通道跟踪
    │     │   → onPipelineUpdate 推送 / 3s 轮询 getRunContext
    │     │     ├─ 阶段推进 → mergeGenStages 更新弹窗各阶段状态/子进度
    │     │     ├─ completed + videoPath → 弹窗关闭 → 跳 /create/result?path=...
    │     │     ├─ failed/cancelled → 终态处理，弹窗提供重试/关闭
    │     │     ├─ 用户点【后台运行】按钮 / 关闭弹窗 → 后台脱离 + 全局居中提示，run 继续执行
    │     │     │   → 前端态复位（busy 释放、runId/stages 清空）→ 可立即对其它选题发起并行任务
    │     │     │   → 并行上限由主进程并发门禁判定（超限 → 启动失败 + 【重试】）
    │     │     └─ 改写/启动阶段点关闭（×）→ 中止前端编排，不启动流水线、无后台任务
    │     └─ 失败 → split: failed → 弹窗错误提示 + 重试（跳过改写）
    └─ 失败 → rewrite_copy: failed → 弹窗错误提示 + 重试（从改写开始）
```

## 6. 交互逻辑

### 6.1 勾选与批量操作

- 勾选状态：`selectedIds: Set<string>`；全选=当前过滤视图全部条目 id；取消全选清空。
- 已选计数实时显示「已选 n 条」；n=0 时【创作文案】【一键发布】disabled。
- 勾选变化时按钮态即时更新。
- 单条快捷【创作文案】按钮不依赖勾选状态。

### 6.2 筛选与列表

- 分类 chips：全部 + 10 分类，单选；切换立即过滤列表。
- 渠道下拉（el-select）：全部渠道 + 7 渠道（含不可用标记）；切换立即过滤。
- 刷新按钮：loading 态（转圈 + 禁用），完成后显示「上次刷新 HH:mm」。

### 6.2a 中央加载提示（SWR 优化新增，2026-09-12）

**触发条件**（满足其一显示，非弹窗）：

- 首次进入页面且无可用缓存（topics 为空），网络抓取进行中；
- 用户点击【刷新】按钮手动触发抓取（即使列表已有内容）。

**不触发**：

- 缓存命中后的后台静默刷新（不打断已渲染内容）；
- 定时器自动刷新。

**视觉与动效规格**：

- 定位：全屏半透明遮罩（rgba(255,255,255,0.72) + backdrop-blur 2px），z-index 1001（高于应用内模态 UpgradeModal/ViralFormDialog 的 1000），内容区居中；
- 卡片：白底圆角卡片（border-radius 16px，紫色系阴影），最大宽 460px，内边距 36px 48px；
- 主文案：**「刷新中」** + 三个跳动圆点（依次延迟 0.15s 弹跳动画）；
- 副文案：**「正在从网上实时获取热门信息，一般需要5-10秒，请耐心等候」**（13px，#777）；
- 旋转 spinner：42px 紫色圆环（0.9s 线性无限旋转）；
- 流光进度条：240px 宽轨道，40% 宽渐变光带（紫→浅紫）1.4s 循环扫过；
- 进出场：0.25s 淡入淡出（Transition）；
- 无障碍：容器 role="status" aria-live="polite"，动画元素 aria-hidden。

**状态联动**：

- 中央提示显示期间刷新按钮同步显示「刷新中…」并禁用；
- 抓取失败：中央提示消失 + 错误 toast「选题获取失败，请稍后重试」；
- 抓取成功：中央提示淡出，列表渲染新数据，头部显示「上次刷新 HH:mm」。
- 失败渠道警告条：`el-alert` warning，文案「部分渠道获取失败：渠道A、渠道B」，可关闭。

### 6.3 一键发布进度交互

- 批量改写期间：批量操作条替换为进度区（进度条 + n/total + 取消按钮）。
- 取消：已完成草稿保留并提示「已取消，已保留 n 条草稿」；剩余条目恢复可勾选状态。
- 失败条目在进度列表中标红，提供【重试】；重试成功则转绿并计入草稿。

### 6.4 状态保持与竞态守卫

- 遵循 spec「目标快照守卫」：刷新请求发起时记录请求序号（requestSeq），响应返回时若序号不匹配则丢弃，防止旧响应覆盖新数据。
- 批量改写期间禁用【刷新】与筛选操作（防止列表变动导致改写目标错位）。

### 6.5 路由与菜单

- 菜单高亮：`isActive` 沿用现有前缀匹配（`/hot-topics` 精确匹配）。
- 页面离开时清理定时器（interval）与 in-flight 请求（AbortController.abort）。

### 6.6 一键生成视频弹窗操作与全局居中提示（2026-09-13 新增）

**弹窗 footer 按钮矩阵**（按 phase 状态机渲染）：

| phase | 重试 | 后台运行 | 取消 | 关闭 | 错误文本 |
|-------|------|---------|------|------|---------|
| rewriting（改写中） | ✗ | ✗（无 run，脱离无意义） | ✓ | ✗ | ✗ |
| starting（流水线启动中） | ✗ | ✗（run 未确认） | ✓ | ✗ | ✗ |
| running（流水线运行中） | ✗ | ✓ | ✓ | ✗（右上角 × 等价后台运行） | ✗ |
| background（后台脱离；弹窗已关，前端态已复位为 idle） | ✗ | ✗（已脱离） | ✗ | ✗（弹窗已关） | ✗ |
| failed（失败终态） | ✓ | ✗ | ✗ | ✓ | ✓ |
| cancelled（取消终态） | ✗ | ✗ | ✗ | ✓ | ✓ |
| completed（完成） | 弹窗已关闭并跳转结果页 | — | — | — | — |

**【后台运行】按钮交互逻辑**：

1. 显示条件：genVideoCanBackground = genVideoPhase === 'running' 且持有 runId——只有主进程 run 确实存在且正在执行时才提供脱离入口（spec 前端规则 2：可逆操作方法内重校验状态，不依赖模板条件）；
2. 点击 → detachGenVideoToBackground()：入口重校验 genVideoCanBackground（防终态竞态）→ 复用 handleGenVideoClose()（唯一公共脱离路径：判断是否可脱离 → resetGenVideoFrontendState() 停轮询/订阅/tick、弹窗关闭、phase='idle'、runId/stages/progress 清空、**busy 释放** → 可脱离时 notifyInfo 顶部 toast）→ showPipelineBackgroundToast() 触发全局居中提示；
3. 脱离后：**所有选题行的【生成视频】按钮立即恢复可用**（busy 已释放），可对任意选题发起并行任务；run 在主进程继续执行，完成后可在视频创作页「历史记录」查看产物；
4. 右上角 × 在运行中同样走后台脱离（与按钮同一 handleGenVideoClose），但不触发全局居中提示（避免与按钮路径重复提示）；在改写/启动阶段（无 run）则走「中止前端编排」语义（不提示已转入后台）。

**全局居中提示规格**（组件 PipelineBackgroundToast.vue，App.vue 全局挂载）：

- 触发方：热门选题一键生成视频【后台运行】按钮 + 视频创作页进度弹窗【后台运行】按钮（detachPipelineToBackground 成功后触发）——所有视频生成流水线进度弹窗统一；
- 文案：common.pipelineBackgroundToast = 「如果想查看该任务，请进入视频创作的历史记录」 / "To check this task, open History in Video Creation"（zh/en 成对）；
- 位置：应用界面正中央（position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%)）；
- 层级：z-index 2100（高于 UiModal overlay 的 2000，弹窗刚关闭瞬间提示仍居中可见）；
- 时长：4 秒后自动消失（重复触发时重置计时器，不叠加多个提示）；
- 视觉：深色半透明底（rgba(30,30,34,0.92)）白字圆角卡片，最大宽 480px，内边距 14px 24px，字号 14px，居中对齐，box-shadow 0 8px 24px rgba(0,0,0,0.28)；
- 动效：0.25s 淡入淡出 + 轻微缩放（enter-from/leave-to: opacity 0 + scale 0.96）；
- 交互：pointer-events: none（不阻挡任何点击，纯提示）；
- 无障碍：role="status" aria-live="polite"；
- 状态承载：模块级单例（stores/pipeline-background-toast.js，与 settings-dialog.js 同模式），脱离触发视图存活——用户点击后台运行后立即切换页面，提示仍正常显示与消失；
- 防泄漏：文案经 vue-i18n 解析；key 未命中时回退空串（不显示），绝不把 i18n key 原文或硬编码中文泄漏到界面。

### 6.7 一键生成视频：并发任务与前端态复位规格（2026-09-13 修正）

**背景**：2026-09-13 用户报障——点击某选题【生成视频】→ 弹窗内点【后台运行】→ 弹窗消失；再点另一选题的【生成视频】，**无任何反应**。根因是后台脱离路径只置 `genVideoPhase='background'` 而未释放 `genVideoBusy`，而按钮 `:disabled="genVideoBusy"` 且 `startGenerateVideo` 首行 `if (genVideoBusy.value) return`，于是所有选题的入口被永久锁死；同时该行为此前被 PRD 写成「并发约束」需求、并被单测断言固化。修正后语义与视频创作页（CreateView.detachPipelineToBackground → resetPipelineToNewTaskState → resetPipelineUiState）完全一致。

**前端状态机（genVideoPhase）**：

| 值 | 含义 | 进入条件 | 可离开到 |
|----|------|---------|---------|
| `idle` | 无在跟踪任务（初始/复位后） | 初始化；后台脱离；终态关闭 | rewriting（点击生成视频） |
| `rewriting` | aiRewrite 在途 | 点击【生成视频】后立即 | starting / failed / cancelled（取消）/ idle（关闭=中止） |
| `starting` | pipelineStartOrchestrated 在途 | 改写成功 | running / failed / cancelled / idle（关闭=中止） |
| `running` | 主进程 run 运行中且持有 runId | 启动成功返回 runId | completed / failed / cancelled / idle（后台脱离） |
| `completed` | 流水线完成（提取到 videoPath） | 轮询/推送判定 | 跳转结果页并关闭弹窗 |
| `failed` | 改写/启动/运行失败 | 任一环节失败 | 重试（failed → 重试）/ 关闭 |
| `cancelled` | 用户取消 | 取消按钮 / 关闭（改写/启动阶段） | 关闭 |

> 不再存在 `background` 滞留态：后台脱离后统一复位为 `idle`，避免「弹窗已关闭但内部仍自认有一个任务在前台」的中间态。

**复位清单（resetGenVideoFrontendState，唯一公共路径）**：

| 字段 | 复位值 | 说明 |
|------|--------|------|
| `genVideoSeq` | `+1` | 代际守卫：使在途 aiRewrite / pipelineStartOrchestrated 响应失效，防止脱离后旧响应重新挂回弹窗、或改写成功后静默启动流水线 |
| 轮询/订阅/tick | 全部清理 | `stopGenVideoTracking()`：clearInterval(3s 轮询) + 退订 onPipelineUpdate + clearInterval(1s 耗时 tick) |
| `genVideoModalOpen` | `false` | 弹窗关闭 |
| `genVideoPhase` | `idle` | 见上表 |
| `genVideoTopic` / `genVideoStages` / `genVideoRunId` | `null` / `[]` / `null` | 下次任务重新初始化，不复用旧选题与阶段 |
| `genVideoRunProgress` / `genVideoStartedAt` | `null` / `0` | 防止新任务进度/耗时继承旧 run |
| `genVideoErrorText` / `genVideoRewrittenContent` / `genVideoDraftId` | `''` / `''` / `null` | 错误与改写产物不外溢到新任务 |
| `genVideoBusy` | `false` | **关键**：释放【生成视频】按钮（修复本次报障） |

**busy 守卫的作用域（保留部分）**：

| 场景 | 守卫是否生效 | 理由 |
|------|-------------|------|
| rewriting / starting / running（弹窗在跟踪同一任务） | ✅ 生效（按钮 disabled + 方法内 return） | 避免同一弹窗内产生两条不受跟踪的编排（旧任务会静默失去 UI） |
| 后台脱离后（idle） | ❌ 不生效 | 与视频创作页一致，允许并行发起新任务 |
| 运行中取消 / 失败 / 完成 | ❌ 不生效 | 终态已复位 |

**数据校验与竞态守卫**：

1. **入参校验**：`startGenerateVideo(topic)` 校验 `topic?.topic` 非空字符串才继续，否则直接 return（不打开弹窗、不调用 IPC）；`retryGenVideo()` 仅在 `phase==='failed'` 时可用。
2. **runId 校验**：启动成功判定要求 `code===0` 且 `typeof runId==='string'` 且 `runId.trim()` 非空且 `success!==false`；`genVideoRunId` 存 trim 后的值。
3. **轮询/推送 runId 守卫**：`pollGenVideoRun(runId)` 与 `handleGenVideoPush(snapshot)` 均先比对当前 `genVideoRunId`，不匹配一律丢弃（脱离后旧 run 的推送不会污染新任务）；`pipelineGetRunContext` 返回的 `runId/id` 与请求不一致时同样丢弃。
4. **代际守卫**：`genVideoSeq` 在「开新任务 / 重试 / 取消 / 关闭 / 后台脱离 / 组件卸载」时递增，所有 await 之后都要 `seq !== genVideoSeq` 提前返回。
5. **终态单调性**：`mergeGenStages` 对已处于 completed/skipped/failed/cancelled 的阶段拒绝降级回 running（乱序推送防护）。
6. **并发上限**：前端不再自设单任务锁；由主进程 `PipelineEngine` 的 `maxConcurrentRuns` 判定，超限返回 `PIPELINE_CONCURRENCY_LIMIT`，前端落到「流水线启动失败」分支（弹窗错误摘要 + 【重试】，重试跳过改写）。

**提示文字（本次未新增 i18n key，沿用既有文案）**：

| 触发点 | key | zh 文案 |
|--------|-----|---------|
| 后台脱离（按钮或 ×） | `hotTopics.genVideoBackgroundHint`（顶部 toast） | 任务已转入后台，可在视频创作页「历史记录」中查看进度 |
| 后台脱离（按钮） | `common.pipelineBackgroundToast`（全局居中，4s） | 如果想查看该任务，请进入视频创作的历史记录 |
| 流水线启动失败（含并发超限） | `hotTopics.genVideoPipelineFailed`（弹窗错误摘要） | 视频流水线启动失败，请点击重试 |
| 改写失败 | `hotTopics.genVideoRewriteFailed` | 文案改写失败，请点击重试 |
| 取消 | `hotTopics.genVideoCancelled` | 已取消生成视频 |

**边界情况**：

1. `pipelineStartOrchestrated` 成功但返回空/非法 runId → 按启动失败处理（不进入 running、不启动跟踪）。
2. 改写返回成功但内容为空 → 抛错走「改写失败」分支（不启动流水线）。
3. 草稿保存失败 → 静默忽略，不阻断视频生成（草稿仅为回溯入口）。
4. 后台脱离瞬间旧 run 恰好完成 → 前端已退订与清空，无事后写回；产物仍可在历史记录/结果页找到。
5. 组件卸载（切页）→ `onUnmounted` 递增 seq、清理定时器与订阅；主进程 run 不受影响。
6. 连续快速点击【生成视频】（同一弹窗在途）→ 第二次点击被 busy 守卫拦截，不产生重复编排。

## 7. 显示项与提示文字（i18n）

### 7.1 新增 i18n key（zh/en 成对，命名空间 hotTopics.*）

| key | zh | en |
|-----|----|----|
| hotTopics.menuLabel | 热门选题 | Hot Topics |
| hotTopics.pageTitle | 热门选题 | Hot Topics |
| hotTopics.pageDesc | 多渠道热门选题聚合，一键创作文案或批量发布 | Aggregate trending topics, create copy or publish in batch |
| hotTopics.refresh | 刷新 | Refresh |
| hotTopics.lastRefresh | 上次刷新 {time} | Last refresh {time} |
| hotTopics.categoryAll | 全部 | All |
| hotTopics.categories.general | 综合 | General |
| hotTopics.categories.society | 社会 | Society |
| hotTopics.categories.finance | 财经 | Finance |
| hotTopics.categories.tech | 科技 | Tech |
| hotTopics.categories.entertainment | 娱乐 | Entertainment |
| hotTopics.categories.sports | 体育 | Sports |
| hotTopics.categories.emotion | 情感 | Emotion |
| hotTopics.categories.education | 教育 | Education |
| hotTopics.categories.health | 健康 | Health |
| hotTopics.categories.international | 国际 | International |
| hotTopics.channelAll | 全部渠道 | All channels |
| hotTopics.channels.zhihu | 知乎 | Zhihu |
| hotTopics.channels.toutiao | 头条 | Toutiao |
| hotTopics.channels.tencent | 腾讯新闻 | Tencent News |
| hotTopics.channels.bilibili | B站 | Bilibili |
| hotTopics.channels.douyin | 抖音 | Douyin |
| hotTopics.channels.baidu | 百度 | Baidu |
| hotTopics.channels.tophub | 微博(tophub) | Weibo (tophub) |
| hotTopics.selectAll | 全选 | Select all |
| hotTopics.selectedCount | 已选 {count} 条 | {count} selected |
| hotTopics.createCopy | 创作文案 | Create copy |
| hotTopics.publish | 一键发布 | Publish |
| hotTopics.emptyTitle | 暂无热门选题 | No topics yet |
| hotTopics.emptyDesc | 点击刷新按钮获取最新选题，或等待自动刷新 | Click refresh to fetch latest topics, or wait for auto refresh |
| hotTopics.emptyAction | 立即刷新 | Refresh now |
| hotTopics.partialFail | 部分渠道获取失败：{channels} | Some channels failed: {channels} |
| hotTopics.noSelection | 请先勾选至少一条选题 | Please select at least one topic first |
| hotTopics.batchLimit | 一次最多批量处理 20 条选题，请减少选择 | Batch limit is 20 topics, please reduce selection |
| hotTopics.topicPrefix | 请以下面这个选题为主题，创作一篇适合自媒体发布的文案： | Please create self-media copy based on the following topic: |
| hotTopics.publishProgress | 改写中 {done}/{total} | Rewriting {done}/{total} |
| hotTopics.publishCancelled | 已取消，已保留 {count} 条草稿 | Cancelled, {count} drafts kept |
| hotTopics.publishDone | 改写完成，已生成 {count} 条草稿 | Done, {count} drafts created |
| hotTopics.publishRetry | 重试 | Retry |
| hotTopics.publishCancel | 取消 | Cancel |
| hotTopics.channelUnavailable | 不可用 | Unavailable |
| hotTopics.loadFailed | 选题获取失败，请稍后重试 | Failed to fetch topics, please retry later |
| hotTopics.rank | 排名 | Rank |
| hotTopics.hotValue | 热度 | Heat |
| hotTopics.generateVideo | 生成视频 | Generate video |
| hotTopics.genVideoTitle | 一键生成视频 · {topic} | One-click video · {topic} |
| hotTopics.genVideoStartToast | 已开始生成视频，改写文案后将自动启动故事讲述流水线 | Video generation started. The storytelling pipeline will start after copy rewriting |
| hotTopics.genVideoRewriteFailed | 文案改写失败，请点击重试 | Copy rewrite failed, please retry |
| hotTopics.genVideoPipelineFailed | 视频流水线启动失败，请点击重试 | Failed to start the video pipeline, please retry |
| hotTopics.genVideoCancelled | 已取消生成视频 | Video generation cancelled |
| hotTopics.genVideoBackgroundHint | 任务已转入后台，可在视频创作页「历史记录」中查看进度 | Task moved to background. Track progress in Video Creation → History |
| hotTopics.genVideoBackgroundRun | 后台运行 | Run in background |
| hotTopics.genVideoRetry | 重试 | Retry |
| hotTopics.genVideoCancel | 取消 | Cancel |
| hotTopics.genVideoClose | 关闭 | Close |
| hotTopics.genVideoDone | 视频已生成，正在打开结果… | Video generated, opening result… |
| pipelines.stages.rewrite_copy | 文案改写 | Rewrite Copy |
| common.pipelineBackgroundToast | 如果想查看该任务，请进入视频创作的历史记录 | To check this task, open History in Video Creation |

### 7.2 显示规则

- 分类标签颜色：综合=灰、社会=蓝、财经=橙、科技=紫、娱乐=粉、体育=绿、情感=红、教育=青、健康=teal、国际=深蓝。
- 渠道标签：固定色带 + 渠道名。
- 热度值：≥10000 显示为 x.x万，否则千分位。

### 7.3 带参文案 Message Function 约定

所有含 `{param}` 的文案必须写成 `(ctx) => 'xxx' + ctx.named('param')` 形式（zh/en 两侧一致），禁止静态字符串带占位符。

## 8. 验收标准

1. 「更多」菜单出现「热门选题」入口，点击进入 `/hot-topics` 页面。
2. 首次进入自动拉取（缓存过期时），7 渠道并发抓取，单渠道失败不阻塞整体。
3. 列表按渠道内排名展示：勾选框、分类标签、渠道标签、热度值齐全。
4. 10 类分类筛选与渠道筛选正常工作，分类不中归综合。
5. 【创作文案】单条/批量跳转改写页：topic 填入、模式=create、自动开始（含 <20 字补引导语）。
6. 【一键发布】弹窗选图文/视频 → 批量改写带进度、失败重试、存草稿、跳转。
7. 缓存与定时刷新：10 分钟缓存、30 分钟自动刷新、document.hidden 暂停。
8. 防反爬组件接入（rate-limiter/circuit-breaker/cache 有测试断言）。
9. i18n zh/en 成对 + Message Function + 无硬编码中文泄漏到模板。
10. 【生成视频】按钮渲染于每条选题行；点击后弹窗打开、改写执行、流水线按用户默认选项自动启动；进度实时更新；完成跳转结果页；失败可重试（流水线失败重试不重复改写）；取消/后台运行语义正确（2026-09-12）。
11. 流水线运行中弹窗 footer 显示【后台运行】按钮；点击后弹窗关闭、run 继续后台执行、前端态复位（phase='idle'、runId/stages 清空、**busy 释放**），不调用 pipelineCancelRun；应用正中央显示「如果想查看该任务，请进入视频创作的历史记录」4 秒后消失；改写/启动/终态不显示该按钮；视频创作页进度弹窗【后台运行】同样触发全局居中提示（2026-09-13）。
12. **多任务并行**（2026-09-13 修正）：【后台运行】脱离（或终态关闭）后，所有选题的【生成视频】按钮立即可用，对另一条选题点击后能正常打开弹窗、改写并启动**第二条**并行流水线（两条 runId 互不干扰、互不覆盖进度）；并发上限由主进程门禁判定，超限时提示「视频流水线启动失败，请点击重试」并保留【重试】。
13. **改写/启动阶段关闭弹窗**（2026-09-13 修正）：点击右上角 × 应中止前端编排——弹窗关闭、前端态复位、不调用 pipelineStartOrchestrated、不调用 pipelineCancelRun、不出现「任务已转入后台」提示。

## 9. 测试覆盖

### 9.1 单元测试

| 测试文件 | 覆盖 |
|---------|------|
| `hot-topics-service.test.js` | 渠道解析（7 渠道各一 fixture）、分类映射（原生+规则+综合兜底）、去重、缓存读写 fail-closed、限流/熔断调用断言、SSRF 拒绝 |
| `HotTopics.test.js` | 渲染（菜单/标题/空态）、勾选与批量按钮态、筛选过滤、刷新交互（mock IPC）、一键发布进度流（mock aiRewrite）、一键生成视频全流程（改写/启动/进度/完成/取消/后台运行按钮与脱离语义，2026-09-13 补充）。**并发回归 4 例**（2026-09-13 修正）：①运行中关闭 → 后台脱离并复位前端态（busy 释放、runId 清空、不取消 run）；②改写阶段关闭 → 中止前端编排（不启动流水线）；③弹窗在途 busy 守卫仍拦截第二次编排；④【后台运行】脱离后另一选题可立即启动并行流水线（按钮可用 + 第二次 pipelineStartOrchestrated 使用第二条选题的改写产物 + runId 切换） |
| `pipeline-background-toast.test.js` | 全局居中提示状态机：show 立即可见、4s 自动消失、重复触发重置计时、hide 立即清除定时器 |
| `PipelineBackgroundToast.test.js` | 全局居中提示组件渲染：zh/en 文案、隐藏后 DOM 移除、key 未命中回退空串不泄漏 |
| `RewriteView.test.js`（补充） | query.topic 填充、模式切换 create、自动 startRewrite、<20 字补引导语 |

### 9.2 视觉回归

- `all-views.visual.test.js` 注册 `hot-topics` 视图（需 dev server + mock 数据，随实现落地）。

### 9.3 契约测试

- preload 暴露的 API（`hotTopicsFetch/hotTopicsGetCache`）与主进程 handler 参数/返回结构一致。
- 缓存 settings key `hot_topics_cache` 的结构契约（topics 数组 + fetchedAt + channelStats）。

### 9.4 手动验证清单

- 打包启动 → 更多菜单 → 热门选题 → 刷新 → 勾选 → 创作文案（跳转自动改写）→ 一键发布（图文/视频各一次全流程）。

## 10. 技术实现说明（附录）

### 10.1 主进程 service

- `apps/desktop/electron/services/hot-topics-service.js`：`HotTopicsService` 类，方法 `fetchTopics(force)` / `getCache()`。
- DI 链路：`container.setup.js` 注册 `hotTopicsService` → `phase1-context.js` 提取 → `phase5-ipc.js` 传递 deps → `ipc-handlers/hot-topics.js` 注册 IPC（channel：`hot-topics:fetch` / `hot-topics:get-cache`）。
- preload：`preload/hot-topics.js` 暴露 `hotTopicsFetch/hotTopicsGetCache`。
- 持久化：settings 表 `hot_topics_cache` key（复用 settings-store）。

### 10.2 渠道适配器

`apps/desktop/electron/services/hot-topics/channels/*.js`：每渠道一个解析器（fetch + parse），统一输出 `{ channel, rank, topic, hotValue, url, rawCategory }`。

### 10.3 分类器

`apps/desktop/electron/services/hot-topics/classifier.js`：`classifyTopic(rawCategory, channel, topicText) → category`，含原生分类映射表 + 关键词词表。

### 10.4 渲染层

- `HotTopics.vue`：列表 + 筛选 + 批量操作 + 进度 UI；IPC 调用经 `api/hot-topics.js`（invokeWithFallback）。
- `RewriteView.vue`：新增 query.topic 消费逻辑（约 15 行）。

### 10.5 渠道清单与间隔配置

渠道策略内嵌于 service（`CHANNEL_CONFIGS`），每渠道：`{ id, name, url, headers, parser, intervalMinutes, riskLevel }`；不新增外部配置文件（避免打包 files 清单变更）。

### 10.6 全局居中提示实现（2026-09-13 新增）

- `stores/pipeline-background-toast.js`：模块级单例状态（pipelineBackgroundToastVisible ref + showPipelineBackgroundToast/hidePipelineBackgroundToast），与 settings-dialog.js 同模式（非 Pinia store，消费方直接 import）；4s 定时器在重复 show 时重置，hide 时清除；
- `components/PipelineBackgroundToast.vue`：全局唯一渲染组件，Teleport to body，Transition 淡入淡出；App.vue 挂载（所有路由可见）；文案走 common.pipelineBackgroundToast，未命中回退空串；
- 接入点 1：HotTopics.vue 的 detachGenVideoToBackground()（热门选题一键生成视频【后台运行】按钮）；
- 接入点 2：CreateView.vue 的 detachPipelineToBackground() 成功分支（视频创作页进度弹窗【后台运行】按钮，含右上角 × 关闭=后台脱离路径）；
- 全仓库审计结论：视频生成流水线进度弹窗仅此两处（VideoCloneView/FilmEngineeringView/RewriteView/ViralAnalysis/Intelligence/Collection 的进度均为页面内嵌或本地假进度，非弹窗，不适用本需求）。

### 10.7 收藏与标签页增强（2026-09-13 新增）

#### 10.7.1 标签页切换

- 热门选题页顶部新增双标签页（tab-bar）："热门选题"（hot）与"收藏选题"（favorites），`activeTab` 切换视图。
- 收藏标签右侧角标显示收藏数量。

#### 10.7.2 收藏功能

- 每条热门选题行新增 ♡ 收藏按钮，点击收藏/取消收藏。
- 持久化方案：本地 SQLite settings 表，key `hot_topics_favorites`，owner-scoped（复用 `getUserSetting/setUserSetting`，与草稿箱同模式）。
- IPC 新增 3 通道：
  - `hot-topics:favorite-add` — 收藏选题（保存完整 topic 快照 + 收藏时间戳）
  - `hot-topics:favorite-remove` — 取消收藏（按 topicId）
  - `hot-topics:favorite-list` — 读取收藏列表

#### 10.7.3 收藏列表

- "收藏选题"tab 展示已收藏选题：分类标签、渠道标签、收藏时间（M/D HH:mm）、取消收藏按钮。
- 空态展示引导文案"在热门选题中点击 ♡ 即可收藏感兴趣的选题"。
- 收藏逻辑抽到独立 composable `useHotTopicsFavorites.js`，模板抽到 `HotTopicsFavorites.vue`。

#### 10.7.4 信息增强

- **更新时间**：每条热门选题行新增更新时间（`fetchedAt` 字段，格式 HH:mm），紧跟热度值之后。
- **摘要悬浮**：`title` 属性由纯选题文本替换为结构化摘要（渠道名称 + 排名 + 分类 + 热度值），如"【知乎第3名】分类：科技，热度：952万"，由 `getTopicSummary()` 动态生成。

#### 10.7.5 i18n

- 新增 10 个 i18n key（zh/en 成对）：`tabHot`、`tabFavorites`、`favorite`、`unfavorite`、`favoritesEmptyTitle`、`favoritesEmptyDesc`、`updateTime`、`favoritedAt`、`topicSummary`。
- 涉及文件：`apps/desktop/src/locales/zh.js`、`en.js`。

