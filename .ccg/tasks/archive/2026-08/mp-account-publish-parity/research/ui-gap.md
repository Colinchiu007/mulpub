# 账号 / 发布前端缺口研究

## 1. 研究范围与证据口径

- 只读取当前工作树的 `App.vue`、`AppNavbar.vue`、`AppSidebar.vue`、`Accounts.vue`、`Publish.vue`、`PublishHistory.vue`，以及直接使用的 store、composable、feature component、router 与测试。
- 用户更正后的外部逆向资料：D:\Data\projects\_逆向工程_参考产品4.0\；安装包目录为 D:\Program Files\mp\。
- 反向资料：`01-docs/ui-reference/analysis/01-feature-comparison.md`、`02-ui-comparison-report-round2.md`、`prd/PRD-mp-features.md`、`01-docs/PRD-mp-reuse.md`、`01-docs/TEST-CASES-mp-reuse.md`。
- `02-ui-comparison-report-round2.md` 是 2026-07-17 的视觉基线；下文以当前源代码为准，不把历史“高匹配”直接当作当前行为证据。
- 不推断后端未公开能力；缺口均对应当前 renderer 中缺少的控件、字段、调用或测试。

## 2. 当前结构摘要与调用链

### 2.1 应用壳层

- `apps/desktop/src/App.vue:1-20` 固定挂载 `OfflineIndicator`、`AppNavbar`、`AppSidebar`、`router-view`、`UpdateNotification`、`SettingsDialog`；`App.vue:36-62` 加载 license/identity 并注册全局 `electronAPI.onNavigate`。
- `apps/desktop/src/layouts/AppNavbar.vue:8-36` 负责账号、发布记录、采集、监控、评论、数据看板、创作、项目库、日历和设置；右侧还有登录关闭、Pro、身份菜单和静态“服务运行中”（`AppNavbar.vue:38-45`）。
- `apps/desktop/src/layouts/AppSidebar.vue:1-32` 是平台账号上下文栏：平台搜索、状态、默认账号切换。平台点击只修改 `activePlatform`（`AppSidebar.vue:16-17`），不改变路由、账号页筛选或发布目标。
- `.stitch/DESIGN-current.md:9-15,28-32` 已记录“顶部导航与侧栏同时参与导航，信息架构需先澄清”。

### 2.2 账号页

- `Accounts.vue:1-18,22-132` 提供刷新、分组管理、添加账号、状态/搜索/平台筛选、批量选择和账号卡片网格。
- `Accounts.vue:138-177` 组装 `AccountLoginDialog`、`AccountProxyDialog`、`AccountGroupManager`、`AccountAuthorizationGuide`；`Accounts.vue:422-606` 负责登录/扫码事件、默认账号、代理、验证、删除和批量删除。
- 挂载时调用 `accountStore.loadGroups()`、`startAccountEvents()`、`refresh()`（`Accounts.vue:605-610`）→ `stores/accounts.js:26-45` 的 `listAccounts()`；分组和收藏仍由 `stores/accounts.js:138-239` 读写 `localStorage`。
- `AccountLoginDialog.vue:18-39` 只有“网页登录”和“扫码登录”；`useAccountActions.js:7-20` 只是调用 `authOpenLogin`/`authOpenQrCodeLogin`，没有手机号验证码/用户名密码表单。

### 2.3 发布页

- `Publish.vue:1-114` 为批量模式，`Publish.vue:116-292` 为单篇模式。单篇包含标题、作者、正文、视频文件、封面 URL、定时、平台差异化面板、草稿箱和发布/取消按钮（`Publish.vue:153-234`）。
- `Publish.vue:296-435` 将业务拆到 `usePlatformSelection`、`usePublishFlow`、`useBatchPublish`、`usePublishDrafts`、`usePublishPlatformCatalog`；`Publish.vue:438-451` 挂载时加载账号、默认账号和路由草稿。
- `PublishTargetSelector.vue:1-34,55-72` 支持平台/账号搜索和多选；平台目录由 `usePublishPlatformCatalog` 组合 `platformStore` 与 `accountStore`。
- 单篇 payload 由 `usePublishFlow.js:169-180` 构建，当前明确发送 `title/content/contentFormat/author/cover_url/video_path/precheck/platformOverrides`；发布执行在 `usePublishFlow.js:286-324`。
- 批量目标在 `useBatchPublish.js:118-132,244-328` 生成并调用 `batchCreate`；其旧版字符串回退见 P0-4。

### 2.4 历史/草稿

- `PublishHistory.vue:1-133` 提供记录/草稿 Tab、搜索、发布人/作品类型/状态/模式筛选、网格/列表、批量管理、导出和新建发布。
- `PublishHistory.vue:141-225` 展示加载、错误、空态、记录卡片和分页；删除按钮明确 disabled 并写“发布记录暂不支持删除”（`PublishHistory.vue:123`）。
- `PublishHistory.vue:246-423` 直接调用 `historyList`/`draftList`，实现分页、补页筛选、草稿加载和 `/publish?draft=...`；没有 `historyGet` 或失败记录重试入口。
- `PublishHistory.vue:246-247` 直接读取共享平台名称/图标，和动态 `platformStore` 不是同一运行时来源。

## 3. P0 缺口

### P0-1：主导航不能直接表达“发布工作台”，且壳层 IA 与目标不一致

**证据**

- 目标资料要求左侧 10 项主导航（首页/发布/账号/数据/工具/评论/创作/小蚁 AI/团队/素材），并把“发布”作为高频入口（`01-docs/PRD-mp-reuse.md:49-64,112-134`）。
- 当前 `AppNavbar.vue:9-14` 只有账号和“发布记录”，发布链接固定到 `/publish/history`；`/publish` 编辑器只能从历史页“新建发布”按钮（`PublishHistory.vue:84-87,131-132`）或其他代码路径进入。
- `AppSidebar.vue:1-32` 是平台清单而不是主导航，平台点击只改变 `activePlatform`，不会筛选账号页、设置发布目标或改变路由。

**影响/建议**

- 用户无法从持久主导航直接进入“一键发布”；“发布记录”和“发布工作台”被混成一个入口。
- 由 `AppNavbar.vue`、`AppSidebar.vue`、`App.vue`、`router/index.js` 确定唯一主导航/上下文栏边界；不要在页面中临时补路由。
- 增加壳层路由测试：当前路径、点击发布、点击账号、平台上下文切换分别断言；若保留历史为默认页，必须另提供明确 `/publish` 主导航。

### P0-2：图文编辑器缺少图片/封面/标签/@能力

**证据**

- 目标 P0-03 要求富文本、图片上传、封面选择、标签/话题/@好友（`01-docs/PRD-mp-reuse.md:53-58`；`01-docs/ui-reference/prd/PRD-mp-features.md:62-68`）。
- 当前 `Publish.vue:153-177` 只有正文、视频本地选择和“封面图 URL”文本框，没有图片素材选择/上传、独立标签、@好友或通用话题字段。
- `ArticleEditor.vue:22-45,77-88` 的 Quill 工具栏虽含 `'image'`，但没有图片上传 handler 或 renderer API 调用；不能仅凭按钮存在证明本地上传可用。
- `usePublishFlow.js:169-180` payload 不包含 `images`、`tags`、`mentions`；差异化面板只处理标题/正文及少数平台字段。

**影响/建议**

- 图文内容无法完成“选择图片/封面/标签/话题/@好友”闭环。由 `ArticleEditor.vue` 明确图片插入合同，`Publish.vue`/publish feature 负责封面、标签、话题、@，`usePublishFlow.js`/`publish-contract.js` 负责 payload/校验。
- 测试覆盖图片文件、封面本地文件与 URL、标签/@、草稿保存/恢复和真实 Electron IPC；不要只 stub Quill 或直接写 `article.video_path`。

### P0-3：视频平台能力判定与平台目录不一致

**证据**

- `stores/platforms.js:30-49` 内容分类包含抖音、视频号、快手、YouTube、TikTok、B 站等视频平台。
- `usePlatformSelection.js:16-28` 的 `VIDEO_PLATFORMS` 只有 `douyin`、`tencent_video`、`kuaishou`；`Publish.vue:161-168` 仅在 `hasVideoPlatforms` 为真时渲染视频上传。
- `PublishHistory.vue:489-501` 又维护另一套视频平台硬编码列表，页面类型判断没有统一契约。

**影响/建议**

- 选择 B 站、TikTok、YouTube 等平台时，可能不会出现视频文件输入，直接阻断视频发布。
- 以 `platformStore.getContentCategory()` 或 publish contract 为唯一来源；测试所有 VIDEO/MIXED 平台是否显示正确媒体控件，并同步断言历史页类型。

### P0-4：批量发布保留“无账号平台字符串”回退，绕过单篇账号约束

**证据**

- 单篇流程构建目标后执行 `validatePublishTargets`；无真实账号会提示“请为…选择至少一个账号”（`usePublishFlow.js`、`features/publish/publish-contract.js`）。
- 批量 `useBatchPublish.js:118-125` 在没有显式账号时退回 `(articleItem.platforms || []).slice()` 字符串数组；`useBatchPublish.js:251-273` 没有对应的 `validatePublishTargets`。
- 批量 UI 在 `Publish.vue:46-63` 只有存在账号时展示账号勾选区；没有账号时只是“不展示选项”。

**影响/建议**

- 批量模式可能提交平台级目标，让后端自行选默认账号或进入旧兼容路径，与单篇“每个目标必须绑定账号”的合同不一致。
- 批量统一使用 `buildPublishTargets` + `validatePublishTargets`；兼容旧草稿应在迁移层显式标记。补无账号、账号被删除、多个账号分别发布的回归测试，确认不会调用 `batchCreate` 或会明确报错。

### P0-5：登录 parity 仍是 BrowserView/扫码，没有统一密码/手机号流程

**证据**

- 逆向功能表将参考产品登录定义为密码、手机号快捷和扫码，Multi-Publish 标为“部分实现”（`01-docs/ui-reference/analysis/01-feature-comparison.md:15-23`）。
- P0 资料要求扫码/账号密码登录（`01-docs/PRD-mp-reuse.md:59-64`）；当前 `AccountLoginDialog.vue:18-39` 只有 `browser`/`qrcode`，`useAccountActions.js:7-20` 没有手机号、验证码、密码或记住密码。

**影响/建议**

- 当前能覆盖“在平台原生页登录”的 BrowserView 路径，但不能证明完成 YiXiaoer 的统一登录体验。若产品有意只保留 BrowserView，应更新 PRD/验收；若要 parity，需新增独立表单和相应 IPC/API，不应继续把 `authOpenLogin` mock 当作密码登录测试。

## 4. P1 缺口

### P1-1：代理入口已接到页面，但账号卡片没有发出事件

- `Accounts.vue:116-132` 给 `AccountManagementCard` 绑定了 `@configure-proxy="openProxyDialog"`；`Accounts.vue:503-548` 也实现了打开、保存、清除代理。
- `AccountManagementCard.vue:70-110` 的操作只有设默认、打开主页、验证、删除，`defineEmits` 也没有 `configure-proxy`；没有用户可点击的代理入口。
- 建议在卡片/详情菜单补齐事件和控件，增加“卡片→代理弹窗→保存/清除→刷新”的页面 wiring 测试；现有 `AccountProxyDialog.test.js` 不能证明入口可达。

### P1-2：分组只有创建/删除/勾选，缺少平台筛选和重命名；数据是本地存储

- `AccountGroupManager.vue:4-62` 只有名称输入、创建、删除、账号勾选，没有重命名或 `platformFilter` UI。
- `Accounts.vue:328-339` 创建分组时固定传空平台过滤值；`stores/accounts.js:138-207` 虽支持 `platformFilter` 结构，但只读写 `localStorage` 的 `mp_account_groups`。
- `stores/accounts.js:218-239` 同样把收藏写到 `localStorage`。这满足单机便利功能，但不满足资料中的团队分享/跨用户语义，至少需在产品合同中明确为设备级状态。
- 建议先补组重命名、平台筛选和组内批量操作测试；如需多租户/跨设备，再把 groups/favorites 迁到 owner-scoped API。

### P1-3：批量账号管理缺少启用/禁用，Store 能力未暴露

- `stores/accounts.js:299-309,335` 已实现 `batchSetStatus(status)`，但 `Accounts.vue:41-57` 工具栏只有批量删除和取消选择。
- 目标资料把批量启用/禁用列为账号列表能力（`01-docs/ui-reference/prd/PRD-mp-features.md:103-109`）。
- 建议补启用/禁用入口，测试空选择、部分失败和状态刷新；不要只把 `batchSetStatus` 留在 store 中。

### P1-4：账号状态只有二态文案，异常/过期恢复没有独立 UI

- `AccountManagementCard.vue:43-48` 只有“登录有效/登录失效”；`Accounts.vue:555-559` 的验证只 toast 成功/失效。
- `useAccountEvents` 收到状态事件后，Accounts 仅 `refresh()`，expiredCount>0 时显示 toast（`Accounts.vue:232-245`）；没有过期原因、异常状态、重新授权 CTA 或逐账号错误信息。
- 资料要求登录/过期/异常检测与引导（`01-docs/ui-reference/analysis/01-feature-comparison.md:57-61`；`01-docs/TEST-CASES-mp-reuse.md:47-50`）。建议映射稳定状态枚举/testid，并为失效账号提供直接“重新登录”。

### P1-5：发布页没有固定操作栏

- 设计系统要求发布工作台始终可见 draft、preview、scheduling、primary publish（`.stitch/DESIGN.md:119-121,165-167`）。
- 当前 `Publish.vue:209-234` 将保存草稿、草稿箱、一键发布、取消任务放在右侧普通卡片，没有 `position: sticky/fixed` 底部 action bar；编辑器默认高度 400px（`ArticleEditor.vue:48-55`）。
- 建议在 publish feature 内抽共享 action bar，保持 composable/API 不变；补滚动和窄窗口视觉回归。

### P1-6：历史页缺少任务详情、失败重试和删除，筛选维度也不完整

- `PublishHistory.vue:123` 明确禁用删除；`PublishHistory.vue:246-247` 只导入 `draftList/historyList`，没有 `historyGet` 或 retry API。
- 当前筛选是搜索、发布人、作品类型、状态、发布模式（`PublishHistory.vue:91-108`），没有平台、账号或时间范围；资料测试要求按平台/状态/时间范围筛选（`01-docs/TEST-CASES-mp-reuse.md:64-68`）。
- 记录卡片只有聚合统计和状态，没有任务详情、平台/账号分解、日志/诊断、失败重试入口；与设计系统 task detail 恢复顺序不符（`.stitch/DESIGN.md:134`）。
- 建议先补 `historyGet` 详情抽屉/路由和失败重试，再决定删除是否由后端支持；增加真实 IPC/E2E 流程。

### P1-7：发布/草稿存在两套 UI，状态和视觉契约容易漂移

- `Publish.vue:245-267` 内嵌草稿箱列表；`PublishHistory.vue:201-225` 又内嵌一套草稿列表。两处分别维护空状态、时间字段和加载/继续编辑/删除动作。
- `Publish.vue` 使用 `usePublishDrafts`（`Publish.vue:374-388`），历史页直接调用 `draftList`（`PublishHistory.vue:406-423`）；没有共享 draft view-model/formatter。
- 建议抽 `features/publish/components/PublishDraftList.vue` 与统一 `normalizeDraft`，页面只负责上下文动作；用一套兼容数据测试两入口。

### P1-8：平台目录和账号加载有多个来源，可能漂移及重复请求

- `usePlatformAccounts.js:16-23` 从静态 `platform-display-definitions.json` 构造 `platformMeta`；`stores/platforms.js:73-136` 从 IPC 拉取平台定义并带硬编码 fallback；`PublishHistory.vue:246-247` 直接读取共享常量；`publish-contract.js` 还有独立 `PLATFORM_LABELS`。
- AppSidebar 挂载调 `accountStore.load()`（`AppSidebar.vue:49-67`），Accounts 挂载再次 `refresh()`（`Accounts.vue:605-610`），Publish 挂载又 `accountStore.load()`（`Publish.vue:438-445`）；没有请求去重层。
- 建议以 `platformStore`/共享定义作为唯一 adapter，sidebar/history/publish 只读 adapter；给 account store 加 `ensureLoaded`/请求去重，并测试路由切换时调用次数和最终数据一致性。

### P1-9：空态/加载态不完整，顶部服务状态是静态文案

- `Accounts.vue:111-114,732-735` 的空态只有图标和标题，没有下一步说明或“添加账号” CTA；加载态只有文字。设计系统要求空态说明缺失原因/下一步、加载态尽量保留最终布局（`.stitch/DESIGN.md:115,141-143`）。
- `AppNavbar.vue:42-45` 永远渲染“服务运行中”，而 `App.vue:3` 另挂载 `OfflineIndicator`；没有证据表明 navbar 文案随离线/bridge 状态更新。
- 建议抽共享 `EmptyState/LoadingState/ConnectionStatus` 语义组件，避免各页继续硬编码静态状态。

### P1-10：设计 token 与页面实现仍分离，目标 Stitch 系统无法直接覆盖账号/历史页

- `.stitch/DESIGN-current.md:15,28-32` 记录 `cohere-design-system.css` 同时包含 token 与具体布局规则，且 Publish 使用大量 inline style。
- `Publish.vue:3-13,18-27,80-111,118-151,209-234` 大量内联布局/颜色；Accounts 和 account components 又各自硬编码紫色、边框、圆角。
- `.stitch/DESIGN.md:1-35,52-69` 的目标是 graphite/neutral/blue 语义色，但当前页面大量使用 `#5048e5`、`#f56c6c`、`var(--coral)` 等旧主题。
- 建议先分离语义 token 与 layout/component CSS，再按代表性 `/publish` slice 迁移；不要让 Stitch 生成内容替换真实业务模板或 API/IPC 合同。

## 5. P2 缺口

- **账号使用统计/矩阵视图**：账号卡只有添加日期、状态和操作，没有发布次数、阅读量、账号维度趋势；资料把账号详情使用统计列为目标（`01-docs/ui-reference/prd/PRD-mp-features.md:120-128`）。
- **发布数据与内容管理**：历史页只有聚合值和 CSV 导出，没有内容详情、已发内容编辑/删除、排行榜或账号分析；资料 P1/P2 列出内容管理、账号分析、排行榜和数据统计（`01-docs/PRD-mp-reuse.md:69-83,93-100`）。
- **素材库/编辑器联动**：当前编辑器没有素材库选择入口；资料将图片/视频素材管理列为 P1/P2，需先确定稳定素材 API。
- **团队/账号分享**：groups/favorites 是 localStorage，未见成员/权限/共享入口；资料将分享管理和团队协作列为 P1。
- **周期性定时发布/批量排期**：当前支持 `datetime-local` 与 scheduler/batchSchedule，但没有周期性规则、排期列表或提醒；资料把定时循环/多任务调度列为增强。

## 6. 重复实现与设计/代码分离遗漏

| 问题 | 当前来源 | 建议唯一归属 |
|---|---|---|
| 平台名称/图标 | `usePlatformAccounts.js` 静态 JSON；`stores/platforms.js` IPC + fallback；`PublishHistory.vue` shared constants；`publish-contract.js` `PLATFORM_LABELS` | `platforms` store + shared platform definitions adapter；历史/发布只读 adapter |
| 视频平台判断 | `usePlatformSelection.js` `VIDEO_PLATFORMS`；`PublishHistory.vue` `contentTypeValue()` | `platformStore.getContentCategory()` 或 publish contract |
| 账号加载 | `AppSidebar`、`Accounts`、`Publish` 各自 onMounted 调 `accountStore.load()`；composable 另有无 store 时 `accountList()` fallback | `accountStore.ensureLoaded()` + 页面只声明需要刷新 |
| 草稿列表/字段归一化 | `Publish.vue` 面板 + `usePublishDrafts`；`PublishHistory.vue` 直接列表 | 共享 draft view-model/list component |
| 账号筛选/平台筛选 | `Accounts.vue` 本地 `filter/platformFilter` watcher + store 过滤；sidebar 自己的 `platformSearch` | store 暴露稳定筛选 API，sidebar 只做上下文过滤 |
| 目标账号合同 | 单篇 `validatePublishTargets`；批量 `getArticleTargets` 旧字符串回退 | 同一 `build/validate` contract，兼容迁移独立处理 |
| 视觉状态 | `cohere-design-system.css`、页面 scoped CSS、大量 inline style | 先 token/component 分层，再页面级迁移；业务 composable 保持不动 |

## 7. 现有测试覆盖与新增测试建议

### 已有覆盖

- `Accounts.test.js` 覆盖标题、状态/平台筛选、扫码/网页登录、授权说明、事件和批量删除；`features/accounts/components/*test.js` 覆盖登录、卡片、分组、代理组件本身。
- `Publish.test.js`、`usePublishFlow.test.js`、`useBatchPublish.test.js`、`usePublishDrafts.test.js` 覆盖标题正文校验、发布/离线、定时、批量进度、草稿和重试等逻辑。
- `PublishHistory.test.js` 覆盖分页、补页筛选、状态/搜索、网格列表、草稿跳转、批量选择和加载错误；`AppNavbar.test.js` 仅覆盖升级、设置和“发布导航进入发布记录页”。

### 明显缺口

1. 没有 `AppSidebar.test.js`，也没有 `App.vue` 壳层路由/全局快捷导航测试；无法证明平台点击会影响目标上下文或跨路由不重复加载。
2. `AppNavbar.test.js:51-55` 把 `/publish/history` + “发布记录”固化为唯一发布导航，没有测试 `/publish` 主入口或 active 状态。
3. 账号页未覆盖“卡片配置代理事件可达”（当前组件无该 emit）、分组重命名/平台筛选、批量启用/禁用、过期/异常映射、BrowserView/扫码/密码/验证码边界和 localStorage 作用域。
4. 发布页未覆盖图片/封面文件、标签/@、B 站/YouTube/TikTok 视频控件、批量无账号目标、真实 Electron IPC 参数序列化；部分 `Publish.test.js` 仅直接写 `article.video_path`，不模拟用户选择文件。
5. 历史页未覆盖平台/账号/时间筛选、`historyGet` 详情、失败任务重试、删除能力；CSV 导出只验证按钮存在，未验证内容/编码/当前筛选集。
6. 缺少跨页面 E2E：添加账号 → 状态事件 → 发布目标选择 → 单篇/批量发布 → 历史记录/草稿恢复；资料要求的 E2E P0 流程见 `01-docs/TEST-CASES-mp-reuse.md:146-166`，当前单元测试不能替代。
7. 视觉回归只能证明截图可渲染，不能证明固定 action bar、空/加载/权限/部分失败状态或业务契约；账号页/历史页尚无与目标设计系统对应的完整状态基线。

## 8. 建议实施顺序（研究建议，不是已批准计划）

1. **先修合同/路由阻断项**：P0-1 主导航入口、P0-3 视频目录统一、P0-4 批量账号合同；同步补路由/contract 单测。
2. **补齐发布输入合同**：P0-2 图片/封面/标签/@；先明确 API/IPC payload，再改 `ArticleEditor`/publish feature，避免只做视觉占位。
3. **补齐账号可达性**：P1-1 代理入口、P1-2 分组编辑、P1-3 批量状态、P1-4 失效恢复；覆盖组件 wiring 和真实事件。
4. **统一历史/草稿恢复**：P1-6 详情/重试/筛选，P1-7 草稿共享组件；保持 `historyList/draftList` 现有 API 语义。
5. **最后做设计迁移**：按 `.stitch/DESIGN.md` 将 token 与页面 CSS 分离，先 `/publish` 代表页，再扩展账号/历史，保留真实 composable/store/API。

## 9. 结论

当前代码已经有可运行的账号 CRUD、浏览器/扫码授权、平台/账号多选、单篇/批量发布、定时、草稿和历史分页骨架；但“功能存在”与“参考产品 parity 已闭环”之间仍有明确断点。最需要优先处理的是发布主入口 IA、媒体/标签输入合同、视频平台能力统一，以及批量发布的账号绑定安全合同。账号代理入口不可达、分组编辑不完整、历史无详情/重试、平台元数据多源和草稿双实现则是下一层高频体验与维护风险。所有 UI 重构应在这些合同明确后进行，避免设计稿覆盖掉真实业务状态。

## 10. 路径更正与新证据

用户已确认外部逆向工程目录为 D:\Data\projects\_逆向工程_参考产品4.0\（此前路径缺少下划线，不能继续引用错误目录）。该目录包含 renderer/preload/main 打包产物、RPA分析报告.md 和 可复用代码分析.md；本轮已将其用于校验 BrowserView/Cookie、发布队列、上传、取消、重试和富文本元数据的边界。

该资料只能证明反编译产物中的资源和调用形状，不能单独证明所有页面状态、服务端权限或第三方平台成功发布；相关结论仍按 PENDING_EXTERNAL 记录。