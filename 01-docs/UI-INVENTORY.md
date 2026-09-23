# Multi-Publish 桌面端 — UI 界面完整清单

> **用途**：供前端开发、QA、接手人员快速了解所有界面、弹窗、状态显示的入口和触发条件。  
> **最后更新**：2026-08-10（分组管理/收藏分组改为页面级面板）  
> **覆盖范围**：67 个 `.vue` 文件，22 条路由，全部弹窗 / 模态框 / 特殊状态。

---

## 一、应用 Shell 架构

### 1.1 双布局模式（App.vue）

| 布局 | 触发条件 | 组成 |
|------|---------|------|
| **Mp 工作区** | 路由 **不在** `NON_WORKSPACE_ROUTES`（`/first-run`, `/model-providers`, `/keywords`, `/viral-analysis`）| `MpSidebar` + `TabBar` + `NavBar` + `MpModuleNav`（仅首页标签） + `<router-view>` |
| **经典布局** | 路由在 `NON_WORKSPACE_ROUTES` 中 | `AppNavbar` + `AppSidebar` + `<router-view>` |

**浏览器式标签栏（Mp 工作区，对标参考产品）**：

| 组件 | 内容 |
|------|------|
| `TabBar`（`components/TabBar.vue`） | 首页标签 + 浏览器标签；非 home 标签显示平台图标（按 URL 域名匹配）、标题与关闭按钮（×） |
| `NavBar`（`components/NavBar.vue`） | 后退/前进/刷新/返回首页 + 地址栏（搜索或输入网址，可复制）+ 右侧操作区 |
| 虚拟登录标签（2026-08-14 新增） | 网页登录视图注册为标签 `auth-login`：标题「{平台中文名}登录」、带平台图标与关闭按钮；登录页全屏显示（TabBar+NavBar 以下全部区域），不再避让侧边栏 |
| NavBar「保存账号」按钮 | 仅登录标签活动态显示：蓝色（#409eff）圆角按钮，文案「保存账号」/「保存中...」（禁用态）；点击调用 `authCompleteLogin` 提取并保存登录凭证 |

**全局挂载组件**（两种布局共享）：
- `OfflineIndicator` — 断网时顶部黄色提示条
- `UpdateNotification` — 自动更新**结果提示宿主**（已是最新提示条 / 更新失败告警条；新版本入口已下沉到侧边栏，见 §4.2）
- `SettingsDialog` — 设置弹窗（由 `showSettingsDialog` 控制）
- `RouteLoadError` — 路由懒加载失败时替代 `<router-view>`

---

## 二、路由表（22 条）

| 路径 | 名称 | 视图组件 | 布局 |
|------|------|---------|------|
| `/` | Home | `Home.vue` | Mp |
| `/accounts` | Accounts | `Accounts.vue` | Mp |
| `/publish` | Publish | `Publish.vue` | Mp |
| `/publish/history` | PublishHistory | `PublishHistory.vue` | Mp |
| `/dashboard` | Dashboard | `Dashboard.vue` | Mp |
| `/collection` | Collection | `Collection.vue` | Mp |
| `/monitor` | Monitor | `Monitor.vue` | Mp |
| `/comments` | Comments | `Comments.vue` | Mp |
| `/create` | Create | `CreateView.vue` | Mp |
| `/create/result` | CreateResult | `ResultView.vue` | Mp |
| `/create/history` | CreateHistory | `CreateHistory.vue` | Mp |
| `/cloud-publish` | CloudPublish | `CloudPublish.vue` | Mp |
| `/intelligence` | Intelligence | `Intelligence.vue` | Mp |
| `/calendar` | Calendar | `Calendar.vue` | Mp |
| `/library` | ProjectLibrary | `ProjectLibrary.vue` | Mp |
| `/board/:projectId` | ProductionBoard | `ProductionBoard.vue` | Mp |
| `/board/:projectId/contact-sheet` | ContactSheetView | `ContactSheetView.vue` | Mp |
| `/replay/:projectId` | ReplayTimeline | `ReplayTimeline.vue` | Mp |
| `/first-run` | FirstRun | `FirstRun.vue` | 经典 |
| `/model-providers` | ModelProviders | `ModelProviders.vue` | 经典 |
| `/keywords` | Keywords | `KeywordMonitorView.vue` | 经典 |
| `/viral-analysis` | ViralAnalysis | `ViralAnalysis.vue` | 经典 |

**重定向**：`/providers` → `/model-providers`，`/create/pipeline` → `/create`

---

## 三、布局组件

### 3.1 MpSidebar（`layouts/MpSidebar.vue`，376 行）

| 元素 | 说明 |
|------|------|
| 用户头像 + 名称 + 许可证标签 | 从 `identityStore` / `licenseStore` 读取 |
| 「＋」新建发布按钮 | 点击 → `router.push('/publish')` |
| 主导航列表 `primaryItems` | 主页、发布、账号、数据（数据看板）、视频创作、采集、**设置** |
| 「更多」展开菜单 `moreItems` | 监控、发布日历、私信评论、CLI、素材库 |
| 底部状态栏 | "客户端已连接" |

### 3.2 MpModuleNav（`layouts/MpModuleNav.vue`，344 行）

| 元素 | 说明 |
|------|------|
| 模块 Tab 栏 | 根据当前路由动态显示 Tab 组（如账号模块：账号管理/分组管理/收藏分组）|
| 工具按钮组 | 移动端预览、客服支持、使用指南、通知 |
| 工具面板 `activeTool` | 点击工具按钮展开右侧面板，再次点击关闭 |

### 3.3 AppNavbar（`layouts/AppNavbar.vue`，77 行）

| 元素 | 触发 / 状态 |
|------|------------|
| 导航链接 | 账号管理、发布记录、采集、监控、评论、数据看板、视频创作、项目库、发布日历、设置 |
| 设置按钮 | `emit('open-settings')` → App.vue 打开 SettingsDialog |
| 「⭐ 升级 Pro」按钮 | `showUpgradeModal = true` → 弹出 UpgradeModal |
| IdentityMenu | 用户身份菜单（登录/登出/许可证信息）|
| 关闭登录按钮 | 仅 `authViewVisible` 时显示 |
| 服务状态指示器 | 始终显示 "服务运行中" |

### 3.4 AppSidebar（`layouts/AppSidebar.vue`，85 行）

| 元素 | 说明 |
|------|------|
| 平台列表 | 从 `usePlatformAccounts` 获取，按平台分组显示账号 |
| 搜索框 | 过滤平台列表 |
| 账号切换器 | 多账号平台显示 `<select>` 下拉 |
| 状态指示点 | 在线/离线/异常状态颜色 |

---

## 四、全局弹窗 / 通知组件

### 4.1 SettingsDialog（`components/SettingsDialog.vue`，134 行）

| 项目 | 内容 |
|------|------|
| **入口** | AppNavbar 设置按钮 → `App.vue showSettingsDialog = true` |
| **触发条件** | `visible` prop 为 true |
| **尺寸** | `UiModal size="xl" width="1100px"` |
| **Tab 列表** | 模型设置（ModelProviders）、通用设置（LogsSettings）、发布设置（🚧 敬请期待）、账号设置（🚧 敬请期待）|
| **关闭** | 点击 ✕ 或 backdrop |

### 4.2 UpdateNotification（`components/UpdateNotification.vue`）+ SidebarUpdateButton（`components/SidebarUpdateButton.vue`）

> 2026-09-14 变更：新版本入口由「自动弹出的模态框」改为「侧边栏底部常驻入口」，模态框已下线。

| 项目 | 内容 |
|------|------|
| **入口（新版本）** | 侧边栏 footer `SidebarUpdateButton`（仅在检测到新版本时渲染），位于登录菜单按钮**正上方**；由 `useAutoUpdate`（模块级共享单例）驱动 |
| **入口（结果提示）** | App.vue 全局挂载 `UpdateNotification`，持有 `start()/cleanup()` 生命周期（唯一注册 `update:status` 监听与启动检查处） |
| **触发条件** | electron-updater `update-available`（真实新版本）/ `update-not-available` / `error` / 策略事件 |
| **入口四态** | `available` 图标 +「新版本」（可点击）｜`downloading`「下载中 N%」（禁用）｜`downloaded`「重启安装」｜`error`「重试安装」 |
| **点击行为** | 提示「正在下载新版本，完成后将自动退出应用并安装」→ IPC `update:install-now` → 未下载先下载，下载完成自动退出并安装（点击即视为同意退出） |
| **结果提示** | `not-available` → 右下角（`right: 88px`）绿色提示条「当前已是最新版本」（4s）；`error` → 右下角 el-alert 告警条「更新失败：{原因}」 |
| **已下线** | UiModal sm 更新对话框（原 available/downloading/downloaded 三段式弹窗）、进度条与下载速度展示 |

### 4.3 UpgradeModal（`components/UpgradeModal.vue`，363 行）

| 项目 | 内容 |
|------|------|
| **入口** | AppNavbar "⭐ 升级 Pro" 按钮 |
| **触发条件** | `showUpgradeModal = true` |
| **实现** | 自建 overlay（非 UiModal），`.upgrade-overlay` backdrop |
| **内容** | 免费版 vs Pro 版对比卡片 |
| **支付流程** | 选择支付方式（支付宝/微信）→ 创建订单 → 扫码支付 → 激活 |
| **状态场景** | |
| - `select` | 选择支付方式 |
| - `qrcode` | 显示支付二维码 |
| - `success` | 激活成功 |

### 4.4 RouteLoadError（`components/RouteLoadError.vue`）

| 项目 | 内容 |
|------|------|
| **入口** | `router.onError` 触发 |
| **触发条件** | 路由懒加载失败（chunk load error） |
| **显示** | 替代 `<router-view>` 的全屏错误页面 |
| **操作** | "重试" 按钮（重新导航）、"刷新" 按钮（`window.location.reload()`）|

### 4.5 OfflineIndicator（`components/OfflineIndicator.vue`）

| 项目 | 内容 |
|------|------|
| **入口** | App.vue 全局挂载 |
| **触发条件** | `navigator.onLine === false` |
| **显示** | 顶部固定黄色提示条 "网络连接已断开" |

### 4.6 CommandPalette（`components/CommandPalette.vue`）

| 项目 | 内容 |
|------|------|
| **入口** | 全局快捷键 `Ctrl+K` / `Cmd+K` |
| **显示** | 居中模态搜索框，输入命令快速导航 |

### 4.7 IdentityMenu（`components/IdentityMenu.vue`）

| 项目 | 内容 |
|------|------|
| **入口** | AppNavbar 右侧用户头像区域 |
| **显示** | 下拉菜单：用户名称、许可证状态、登录/登出 |

### 4.8 TrialBanner（`components/TrialBanner.vue`）

| 项目 | 内容 |
|------|------|
| **入口** | Dashboard 等页面内嵌 |
| **触发条件** | `licenseStore.isPro === false` 且试用期内 |
| **显示** | 页面顶部横幅，提示升级 + 剩余天数 |
| **操作** | "升级" → 打开 UpgradeModal、"关闭" → 隐藏 |

---

## 五、主页面视图

### 5.1 Home.vue（452 行）— 首页

| 区块 | 内容 |
|------|------|
| 欢迎区 | 问候语 + 用户名 + 三个快捷按钮（新建发布、添加账号、发布记录）|
| 数据概览 | 四张统计卡片：总发布、成功、失败、已绑定账号 |
| 快捷入口 | 六个图标入口：一键发布、账号管理、发布记录、数据看板、内容采集、私信评论 |
| 支持平台 | 平台标签列表 |

**特殊状态**：
- 加载中：统计数据加载时
- 未登录：`displayName` 显示默认值

### 5.2 Accounts.vue（1087 行）— 账号管理

| 区块 | 内容 |
|------|------|
| 顶部工具栏 | 平台搜索、账号搜索、负责人/发布人筛选、排序字段+升降序、视图切换(grid/list)、批量操作、+添加账号 |
| 状态 Tab | 全部、已登录、未登录、收藏 |
| 平台筛选侧栏 | 按平台过滤 |
| 分组筛选 | 按分组过滤 |
| 账号卡片网格/列表 | `AccountManagementCard` 组件 |
| 加载骨架 | `UiSkeleton variant="card"` ×4（`mp-skeleton-grid`），与真实栅格共消费 `--account-grid-columns` / `--account-grid-gap` 同一列口径，加载期不塌缩成单列（2026-09-22 accounts-grid-align，详见 `PRD-ACCOUNTS-GRID-SKELETON-ALIGN-2026-09-22.md`） |

**弹窗**：
| 弹窗 | 触发入口 | 组件 |
|------|---------|------|
| 添加账号 | 工具栏 "+添加账号" 按钮 | `AccountLoginDialog` |
| 设置代理 | 卡片操作按钮 "设置" | `AccountProxyDialog` |
| 授权引导 | 首次添加账号时 | `AccountAuthorizationGuide` |

> 注：**分组管理**原为弹窗（`AccountGroupManager`），已改为页面级 Tab 面板 `AccountGroupsPanel`（对标参考产品）；**收藏分组** Tab 为页面级 `AccountFavoritesPanel`。

**特殊状态**：
| 状态 | 触发条件 | 显示 |
|------|---------|------|
| loading | 首次加载 | 加载中提示 |
| empty-无账号 | 账号列表为空 | "暂无账号，点击添加" |
| empty-无收藏 | 收藏 Tab 无数据 | "暂无收藏账号" |
| empty-分组内无 | 分组筛选无结果 | "该分组内暂无账号" |
| empty-无匹配 | 搜索无结果 | "没有匹配的账号" |
| batch-mode | 勾选批量操作 | 底部工具栏：全选/批量启用/禁用/删除/取消 |
| login-state-bar | **扫码登录**过程中（2026-08-14 起仅 qrcode 模式） | 底部登录状态条 + QR 码预览；**网页登录已改为全屏登录标签**（见 1.1 虚拟登录标签），账号页不再显示横幅/浮动关闭按钮 |
| batch-check-overlay | 点击工具栏【一键检测】期间 | 全屏遮罩：进度条（已完成/总数）+「检测中 x/y：平台」+ 第二行明细「正在检测：平台1、平台2 · 已耗时 N 秒」（`data-testid="batch-check-detail"`，2026-09-22 batch-check-progress-speed，详见 `BUGFIX-BATCH-CHECK-PROGRESS-STALL-2026-09-22.md`） |

### 5.3 Publish.vue（874 行）— 发布

| 区块 | 内容 |
|------|------|
| 模式切换 | 批量模式 toggle |
| 内容编辑区 | 标题输入、正文编辑（`ArticleEditor`）、图片/视频/封面上传 |
| 平台选择 | `PublishTargetSelector` 组件 |
| 平台差异化 | `PlatformOverridePanel` 展开/收起 |
| AI 辅助 | AI Writer 面板 toggle、标题助手、标签建议 |
| 操作按钮 | 保存草稿、草稿箱、一键发布 |

**弹窗**：
| 弹窗 | 触发入口 | 组件 |
|------|---------|------|
| 发布类型选择 | 批量模式 / 新建发布 | `PublishTypeDialog`（自建 backdrop，非 UiModal）|
| 草稿箱 | "草稿箱" 按钮 | `PublishDraftList` 面板 |

**特殊状态**：
| 状态 | 触发条件 | 显示 |
|------|---------|------|
| 发布进度 | 点击 "一键发布" 后 | 时间线进度显示 |
| 发布结果 | 发布完成 | 成功/失败 + 重试 + 复制链接 |
| 批量发布进度 | 批量模式下发布 | 完成/失败/重新发布 |
| 草稿箱空 | 无草稿 | 空状态提示 |

### 5.4 PublishHistory.vue（1037 行）— 发布记录

| 区块 | 内容 |
|------|------|
| Tab 切换 | 发布记录 / 草稿箱 |
| 工具栏 | 搜索、批量管理、视图切换(grid/list)、导出、+新增发布 |
| 筛选器 | 发布人、作品类型、发布状态、发布模式、平台、时间 |
| 记录列表 | 缩略图 + 标题 + 作者 + 时间 + 状态 + 平台 + 统计列 |

**弹窗**：
| 弹窗 | 触发入口 | 组件 |
|------|---------|------|
| 新增发布 | "+新增发布" 按钮 | `PublishTypeDialog` |
| 详情模态 | 记录行点击 "详情" | 内联模态框（14 字段 + 内容摘要）|

**特殊状态**：
| 状态 | 触发条件 | 显示 |
|------|---------|------|
| loading | 数据加载 | 加载提示 |
| empty-无记录 | 列表为空 | "暂无发布记录" |
| empty-无匹配 | 筛选无结果 | "没有匹配的记录" |
| empty-无草稿 | 草稿 Tab 为空 | "暂无草稿" |
| error | 加载失败 | 错误提示 + 重试按钮 |
| batch-mode | 批量管理 | checkbox + 全选/删除/取消工具栏 |
| pagination | 列表滚动到底 | "加载更多" 按钮 |

### 5.5 Dashboard.vue（253 行）— 数据看板

| 区块 | 内容 |
|------|------|
| 汇总卡片 | 总发布、总阅读、评论、粉丝 |
| 发布统计 | 累计发布、成功、失败、成功率 |
| 发布趋势图 | 近 14 天柱状图（纯 CSS 实现）|
| 平台分布 | 进度条图 |

**特殊状态**：`TrialBanner` 横幅（非 Pro 用户）

### 5.6 Collection.vue（234 行）— 内容采集

| 区块 | 内容 |
|------|------|
| URL 采集 | 输入链接 → 采集标题/正文/封面 |
| 快捷操作 | 新建草稿、剪贴板导入、微博/知乎/今日头条 |
| 草稿箱 | 草稿卡片列表 |

**特殊状态**：
- 采集结果预览（`collectedResult`）
- 空草稿 "暂无草稿"

### 5.7 Comments.vue（132 行）— 评论管理

| 区块 | 内容 |
|------|------|
| 左侧平台列表 | 平台图标 + 名称 + 评论 URL 状态 |
| 右侧评论区 | WebContentsView（主进程渲染） |

**特殊状态**：
- "选择平台" — 未选平台
- "暂不支持" — 平台无评论 URL

### 5.8 Monitor.vue（226 行）— 分屏监控

| 区块 | 内容 |
|------|------|
| 布局切换 | 1/2/3/4/6 屏 |
| 操作按钮 | "添加监控"、"全部关闭" |
| 监控区域 | WebContentsView |
| 底部状态栏 | 监控数量、当前布局 |

**弹窗**：
| 弹窗 | 触发入口 | 组件 |
|------|---------|------|
| 添加监控 | "＋ 添加监控" 按钮 | 内联 `UiModal(size="sm")` + 平台选择 |

**特殊状态**：
- "暂无监控" — tabs 为空

### 5.9 CreateView.vue（3307 行）— 视频创作

| 区块 | 内容 |
|------|------|
| Remotion 状态提示 | 渲染引擎未就绪警告 |
| 视图 Tab | 流水线创作、快速渲染、历史记录 |
| 流水线列表 | 卡片网格：分类 badge + 阶段数 + 成本 + 可用性 |
| 流水线详情 | 阶段进度时间线 + 配置面板 |
| 快速渲染 | 简易上传 + 渲染 |
| 历史记录 | 内联（Tab 切换）|

**特殊状态**：
| 状态 | 触发条件 | 显示 |
|------|---------|------|
| pipelineLoading | 加载流水线列表 | spinner |
| pipelineError | 加载失败 | 错误提示 |
| Remotion 未就绪 | `renderStatus.ready === false` | 黄色警告横幅 + 安装依赖按钮 |
| 安装日志 | `installLog` 非空 | 日志面板 |
| 编排进度 | 流水线运行中 | 进度条 + 已用时 + 摘要（已用时 = 步骤执行耗时累计 `activeMs`，2026-08-10 起；暂停/断点恢复空闲不计入，完成/失败定格） |

### 5.10 ResultView.vue（782 行）— 视频预览

| 区块 | 内容 |
|------|------|
| 视频播放器 | `<video>` + controls |
| 操作按钮 | 下载、导出 ZIP、复制路径、打开文件夹、去发布、重新创作 |
| 视频裁剪 | 入点/出点滑块 |
| 项目信息 | 完成摘要、格式、路径 |

**特殊状态**：loading、"没有可预览的视频"（empty）

### 5.11 CreateHistory.vue（290 行）— 创作历史

| 区块 | 内容 |
|------|------|
| Tab 切换 | 渲染记录 / 流水线记录 |
| 运行中横幅 | 有进行中/失败流水线时显示 |

**特殊状态**：loading、error + 重试、empty（暂无记录）

### 5.12 ProductionBoard.vue（349 行）— 生产看板

| 区块 | 内容 |
|------|------|
| 顶部信息栏 | 返回链接、项目名、总成本、已耗时、审批门按钮、查看回放 |
| 阶段指示器 | `BoardStageIndicator` |
| 场景卡片网格 | `SceneCard` |
| 右侧信息面板 | 当前操作 + 最新事件日志 |

**弹窗**：
| 弹窗 | 触发入口 | 组件 |
|------|---------|------|
| 审批门 | "审批门 (N)" 按钮 | `ApprovalGateModal` |

**特殊状态**：loading（加载看板）、empty（暂无看板数据）、no-scenes（当前阶段暂无场景）

### 5.13 ContactSheetView.vue（291 行）— 场景审批

| 区块 | 内容 |
|------|------|
| 顶部栏 | 返回看板、标题、审批进度(N/M 已审批)、刷新 |
| 场景列表 | 场景卡片 + Take 缩略图 + 选择/审批操作 |

**特殊状态**：loading、error + 重试、empty（暂无待审批场景）

### 5.14 ReplayTimeline.vue（658 行）— 生产回放

| 区块 | 内容 |
|------|------|
| 顶部栏 | 返回看板、项目名、总时长 |
| 时间轴控制 | 播放/暂停、速度(1x/2x/4x)、进度滑块 |
| 事件时间线 | 按时间顺序展示生产事件 |

**特殊状态**：loading、error + 重试、empty（无录制数据）

### 5.15 Calendar.vue（406 行）— 发布日历

| 区块 | 内容 |
|------|------|
| 月份导航 | 上/下月、今天 |
| 日历网格 | 日期格子 + 事件点（最多 3 个 + "+N"）|
| 详情面板 | 选中日期的事件列表 |

**特殊状态**：日期无事件 → "该日期暂无发布记录"

### 5.16 CloudPublish.vue（285 行）— 云端发布

| 区块 | 内容 |
|------|------|
| orchestrator 状态 | 在线/离线标签 |
| 提交表单 | 视频 URL、平台、标题、描述、标签、封面 URL |
| 发布记录列表 | 任务列表 + 刷新 |

**特殊状态**：submitResult（成功/失败反馈）、loadingTasks

### 5.17 Intelligence.vue（243 行）— 内容情报

| 区块 | 内容 |
|------|------|
| 热门趋势 | `TrendingPanel` 组件 |
| 搜索栏 | 关键词输入 + 来源筛选（Reddit/HN/GitHub）|
| 搜索结果 | 按互动评分排序的内容列表 |

**特殊状态**：searching（搜索中）、无结果（"暂无结果，试试其他关键词"）

### 5.18 ModelProviders.vue（1244 行）— 模型服务商设置

| 区块 | 内容 |
|------|------|
| safeStorage 警告 | 系统加密不可用时横幅 |
| 视图 Tab | 已配置 / 全部 |
| 分类筛选条 | 推理/TTS/语音识别/图片生成/视频/音频/多模态 |
| 服务商卡片网格 | 卡片 + 配置表单 |

**特殊状态**：
| 状态 | 触发条件 | 显示 |
|------|---------|------|
| loading | 加载服务商列表 | 骨架屏（3 张 skeleton-card）|
| safeStorage 不可用 | 系统密钥链异常 | 黄色警告横幅 |
| 空列表 | 无已配置服务商 | 引导添加 |

### 5.19 FirstRun.vue（240 行）— 首次运行向导

| 步骤 | 内容 | 触发条件 |
|------|------|---------|
| Step 0 | 欢迎页：三步引导说明 | 初始 |
| Step 1 | 环境检测：Python 依赖 + Playwright 安装 | 点击 "开始配置" |
| Step 2 | 添加账号：平台网格选择 | Step 1 完成或跳过 |
| Step 3 | 首次发布：引导写文章 | Step 2 完成 |

**特殊状态**：
- depError：安装出错 + 重试/跳过
- allDepsDone："✅ 环境就绪"
- 通知条：右上角 toast（成功绿/失败红）

### 5.20 KeywordMonitorView.vue（18 行）— 关键词监测

| 区块 | 内容 |
|------|------|
| 页面头部 | 标题 + 副标题 |
| 内容区 | `KeywordMonitorPanel` 组件 |

### 5.21 ViralAnalysis.vue（312 行）— 爆款分析

| 区块 | 内容 |
|------|------|
| 输入区 | 主题/关键词、目标平台、文章数据 JSON（可选）|
| 操作按钮 | "爆款分析" + "生成文案" |
| 分析结果 | 爆款因子评分 + AI 生成文案 |

**特殊状态**：loading（"分析中..."）

### 5.22 ProjectLibrary.vue（201 行）— 项目库

| 区块 | 内容 |
|------|------|
| 项目网格 | `ProjectCard` 卡片列表 |

**弹窗**：
| 弹窗 | 触发入口 | 实现 |
|------|---------|------|
| 删除确认 | 卡片删除按钮 | 自建 `.confirm-overlay` + `.confirm-dialog` |

**特殊状态**：loading（骨架屏）、error + 重试、empty（"暂无项目"）

---

## 六、Feature 组件（账号模块）

### 6.1 AccountLoginDialog（95 行）

| 项目 | 内容 |
|------|------|
| **入口** | Accounts.vue → "添加账号" 按钮 |
| **实现** | `UiModal(size="sm")` |
| **内容** | 平台选择（`UiSelect`）+ 登录方式切换（网页/扫码）|
| **操作** | 选择平台 → 打开登录窗口 |

### 6.2 AccountProxyDialog（132 行）

| 项目 | 内容 |
|------|------|
| **入口** | AccountManagementCard → "设置" 操作 → 代理设置 |
| **实现** | `UiModal` |
| **内容** | 代理类型（HTTP/HTTPS/SOCKS5）+ 地址 + 端口 + 用户名/密码 |
| **状态** | 当前代理状态显示、清除按钮、表单验证 |

### 6.3 AccountGroupsPanel（页面级分组管理面板，对标参考产品）

| 项目 | 内容 |
|------|------|
| **入口** | 账号模块 Tab「分组管理」（`/accounts?tab=groups`）|
| **工具栏** | 搜索分组、平台筛选（全部）、仅看包含我的分组、设置排序（名称/账号数 + 升降序）、紫色「创建分组」按钮 |
| **创建交互** | 点击创建分组 → 内联创建行（名称 + 平台 + 确定/取消）|
| **分组卡片** | 名称 + 成员统计 + 平台筛选 + 重命名 + 删除 + 成员勾选 |
| **空态** | 云朵图标 + "暂无数据"（无分组或有分组但筛选无结果时附提示）|

### 6.4 AccountFavoritesPanel（页面级收藏分组面板，对标参考产品）

| 项目 | 内容 |
|------|------|
| **入口** | 账号模块 Tab「收藏分组」（`/accounts?tab=favorites`）|
| **工具栏** | 搜索收藏、使用指南文案、「创建分组」按钮（未接入，disabled）|
| **表格** | 分组名称 / 账号数 / 操作（查看账号 → 回账号列表并按分组筛选）|
| **空态** | 云朵图标 + "暂无数据" |

### 6.5 AccountGroupManager（176 行，已停用）

| 项目 | 内容 |
|------|------|
| **状态** | 原分组管理弹窗，已被页面级面板替代，不再挂载 |
| **内容** | 创建分组、重命名、删除、平台筛选、成员勾选 |

### 6.6 AccountAuthorizationGuide（52 行）

| 项目 | 内容 |
|------|------|
| **入口** | 首次添加账号时自动弹出 |
| **实现** | 自建 fixed 定位 overlay（非 UiModal）|
| **内容** | 登录 → 完成步骤图 |

### 6.7 AccountManagementCard（597 行）

| 项目 | 内容 |
|------|------|
| **入口** | Accounts.vue 卡片网格/列表 |
| **内容** | 头像 + 名称 + 状态徽章 + 停用标记 + 粉丝数 + 负责人/运营人/代理 + 操作按钮 |
| **操作按钮** | 设置、验证、重新登录、删除 |
| **状态徽章（登录态）** | 已登录(绿)、已失效(红)、未确认(琥珀)、异常(红)、暂无检查记录(灰) —— 只由 `status` 决定 |
| **停用标记（启用态）** | `is_active === false` 时账号明细行追加「已停用」灰底标记（`account-disabled-flag`，`role="status"` + `aria-label`），同时卡片加 `is-disabled`（虚线边框 + 降饱和 + 半透明，不改布局尺寸）；与登录徽章完全正交，两者可同时出现 |
| **头像回落（资料真源）** | 有 `avatar` / `avatar_url` 且未判定失效时渲染 `<img>`（`alt=""`，昵称文本已在旁，非装饰信息缺失），`@error` 触发即置 `avatarBroken` 并回落 `<UserFilled>`，不留空白框；昵称取序 `account_name` → `name` → 平台显示名 |
| **支持** | 批量选择 checkbox、收藏星标、重命名、默认账号标识、停用标识 |
| **不再出现** | `inactive` / `offline` 曾映射为「已登录」+ `offline` 徽章，现统一落到「暂无检查记录」兜底（历史脏数据诚实呈现） |

### 6.8 PlatformAccountGroup（305 行）

| 项目 | 内容 |
|------|------|
| **入口** | Accounts.vue 列表视图 |
| **内容** | 平台分组行，水平布局 |
| **操作** | 设为默认、打开、验证、代理、删除 |
| **头像回落（资料真源）** | 口径同 6.7，但失效状态用 `avatarBrokenIds = ref(new Set())` 按 `account.id` 逐个记录（`markAvatarBroken(account)`）—— 一行内并列展示多账号，单个外链失效不得牵连同组其他账号 |

---

## 七、Feature 组件（发布模块）

### 7.1 PublishTypeDialog（254 行）

| 项目 | 内容 |
|------|------|
| **入口** | Publish.vue / PublishHistory.vue → "新增发布" |
| **实现** | 自建 backdrop（非 UiModal）|
| **内容** | 4 种类型卡片：视频、图文、文章、公众号 |
| **显示** | 每种类型下方支持平台图标列表 |

### 7.2 PublishTargetSelector（108 行）

| 项目 | 内容 |
|------|------|
| **入口** | Publish.vue 平台选择区域 |
| **内容** | 搜索 + 平台分组 + 账号子列表 |
| **停用账号** | 仍列出但复选框 `disabled`、行加 `is-disabled`（降透明度 + `not-allowed`），账号名后显示「已停用」标记（`target-account-disabled-flag`）；判定来自 `usePublishPlatformCatalog` 附加的 `disabled` 字段，与可选集合同源 |
| **默认回填** | `usePlatformSelection.getAccounts()` 已过滤停用账号，故停用账号不会被自动选为发布目标；已勾选的账号一旦被停用，`reconcileSelectedAccounts` 自动剔除 |

### 7.3 PlatformOverridePanel（211 行）

| 项目 | 内容 |
|------|------|
| **入口** | Publish.vue 展开平台差异化面板 |
| **内容** | 每平台独立标题/正文/特殊字段（知乎: 评论权限/创作声明/话题/草稿）|

### 7.4 PublishDraftList（`features/publish/components/PublishDraftList.vue`）

| 项目 | 内容 |
|------|------|
| **入口** | Publish.vue "草稿箱" 按钮 |
| **内容** | 草稿列表/空状态 |

---

## 八、共享 UI 基础组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `UiModal` | `components/UiModal.vue`（103 行）| Teleport to body + Transition 动画 + 4 种尺寸 (sm:360/md:480/lg:640/xl:800) + blur backdrop |
| `UiButton` | `components/UiButton.vue` | 多变体：primary/secondary/ghost/danger |
| `UiInput` | `components/UiInput.vue` | 文本输入 + textarea |
| `UiSelect` | `components/UiSelect.vue` | 下拉选择 |
| `UiCard` | `components/UiCard.vue` | 卡片容器 |
| `UiBadge` | `components/UiBadge.vue` | 标签徽章 |
| `PlatformIcon` | `components/PlatformIcon.vue` | 平台图标（sm/md/lg）|

---

## 九、辅助功能组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `AiWriterPanel` | `components/AiWriterPanel.vue` | AI 写作辅助面板 |
| `ArticleEditor` | `components/ArticleEditor.vue` | 富文本文章编辑器 |
| `TagSuggester` | `components/TagSuggester.vue` | 标签建议弹出面板 |
| `TitleAssistantPanel` | `components/TitleAssistantPanel.vue` | 标题助手面板 |
| `TemplatePicker` | `components/TemplatePicker.vue` | 内容模板选择器 |
| `OptimalTimeTip` | `components/OptimalTimeTip.vue` | 最佳发布时间提示 |
| `TrendingPanel` | `components/TrendingPanel.vue` | 热门趋势面板（Intelligence 页使用）|
| `KeywordMonitorPanel` | `components/KeywordMonitorPanel.vue` | 关键词监控面板 |
| `ReferenceFinder` | `components/ReferenceFinder.vue` | 参考资料查找器 |
| `BenchmarkChart` | `components/BenchmarkChart.vue` | 基准图表 |
| `PipelineBrowser` | `components/PipelineBrowser.vue` | 流水线浏览器 |
| `SceneCard` | `components/SceneCard.vue` | 场景卡片（ProductionBoard 使用）|
| `BoardStageIndicator` | `components/BoardStageIndicator.vue` | 看板阶段指示器 |
| `ProjectCard` | `components/ProjectCard.vue` | 项目卡片（ProjectLibrary 使用）|
| `ApprovalGateModal` | `components/ApprovalGateModal.vue` | 审批门弹窗 |
| `LogsSettings` | `components/LogsSettings.vue` | 日志设置面板（SettingsDialog 内）|

---

## 十、弹窗总览（快速索引）

| # | 弹窗名称 | 触发页面 | 实现方式 | 尺寸 |
|---|---------|---------|---------|------|
| 1 | SettingsDialog | App.vue（全局）| UiModal xl | 1100px |
| 2 | ~~UpdateNotification~~ | 已下线（2026-09-14 改为 SidebarUpdateButton 常驻入口） | — | — |
| 3 | UpgradeModal | AppNavbar | 自建 overlay | 自定义 |
| 4 | AccountLoginDialog | Accounts | UiModal sm | 360px |
| 5 | AccountProxyDialog | Accounts (Card) | UiModal | 默认 |
| 6 | ~~AccountGroupManager~~ | 已改为页面级面板 | — | — |
| 7 | AccountAuthorizationGuide | Accounts（首次）| 自建 fixed overlay | 自定义 |
| 8 | PublishTypeDialog | Publish / History | 自建 backdrop | 自定义 |
| 9 | Monitor 添加监控 | Monitor | UiModal sm | 360px |
| 10 | ApprovalGateModal | ProductionBoard | ApprovalGateModal 组件 | 自定义 |
| 11 | 删除确认对话框 | ProjectLibrary | 自建 confirm-overlay | 自定义 |
| 12 | CommandPalette | 全局 Ctrl+K | 模态搜索框 | 自定义 |
| 13 | RouteLoadError | 全局（路由失败）| 全屏替代 | 全屏 |

---

## 十一、状态显示总览

### 11.1 全局状态

| 状态 | 组件 | 触发条件 |
|------|------|---------|
| 离线提示 | OfflineIndicator | `navigator.onLine === false` |
| 路由加载失败 | RouteLoadError | 路由 chunk 加载异常 |
| 自动更新 | SidebarUpdateButton（侧边栏底部「新版本」入口）+ UpdateNotification（结果提示） | electron-updater 事件 |
| 试用横幅 | TrialBanner | 非 Pro 用户 + 试用期内 |

### 11.2 页面级 Loading 状态

| 页面 | 实现 |
|------|------|
| Accounts | 加载中提示 |
| PublishHistory | 加载 spinner |
| Dashboard | 统计数据加载 |
| ModelProviders | 骨架屏（3 张 skeleton-card）|
| CreateView | pipelineLoading spinner |
| ProductionBoard | "加载看板..." spinner |
| ContactSheetView | "加载场景..." spinner |
| ReplayTimeline | "加载回放数据..." spinner |
| ProjectLibrary | 骨架屏（6 张 skeleton-card）|
| CloudPublish | "加载中..." 文本 |
| CreateHistory | spinner + "加载中..." |

### 11.3 页面级 Empty 状态

| 页面 | 空状态文案 |
|------|-----------|
| Accounts | "暂无账号" / "暂无收藏" / "分组内暂无" / "没有匹配" |
| PublishHistory | "暂无发布记录" / "没有匹配" / "暂无草稿" |
| Collection | "暂无草稿" |
| Comments | "选择平台" / "暂不支持" |
| Monitor | "暂无监控" |
| CreateView | 流水线列表为空 |
| ResultView | "没有可预览的视频" |
| CreateHistory | "暂无渲染记录" / "暂无流水线记录" |
| ProductionBoard | "暂无看板数据" / "当前阶段暂无场景" |
| ContactSheetView | "暂无待审批场景" |
| ReplayTimeline | "无录制数据" |
| Calendar | "该日期暂无发布记录" |
| ProjectLibrary | "暂无项目" |
| Intelligence | "暂无结果" |
| Dashboard | 无数据时不显示趋势图 |

### 11.4 页面级 Error 状态

| 页面 | 实现 |
|------|------|
| PublishHistory | 错误提示 + 重试 |
| ProjectLibrary | 错误文本 + UiButton "重试" |
| CreateView | "⚠️ {pipelineError}" |
| ContactSheetView | 错误文本 + "重试" |
| ReplayTimeline | 错误文本 + "重试" |
| CreateHistory | 错误文本 + "重试" |
| ModelProviders | safeStorage 警告横幅 |
| ViralAnalysis | "分析中..." loading 态 |

---

## 十二、参考产品对标差异备忘

以下为与参考产品截图（mp-live-20260810）对比的 UI 差异点及处理状态：

1. ✅ **账号页顶层 Tab 导航**：参考产品有"账号管理/分组管理/分享链接/收藏分组"四个 Tab，`MpModuleNav` 已实现；**分组管理/收藏分组已从弹窗改为页面级面板**（`AccountGroupsPanel`/`AccountFavoritesPanel`，2026-08-10）
2. ✅ **分组管理工具栏**：已对齐参考产品布局 — 搜索分组 + 全部筛选 + 仅看包含我的分组 + 设置排序 + 紫色创建分组按钮
3. ✅ **空态风格**：分组/收藏面板采用参考产品同款"云朵 + 暂无数据"空态
4. ✅ **状态徽章颜色**：已按参考产品契约分色 — 负责人蓝（`assignee-owner`）/ 运营人灰（`assignee-publisher`）/ 代理紫（`assignee-proxy`），2026-08-10
5. ✅ **Publish.vue inline style**：已全部迁移为语义化 class（64 处 → 0），定义收敛至 `<style scoped>`，2026-08-10
6. **卡片视觉细节**：AccountManagementCard 的底部按钮布局与参考产品略有差异
7. **批量模式工具栏**：参考产品批量选择时工具栏样式更紧凑（发布记录页已对齐：已选择 N 项内容 + 删除 + 取消选择 + 导出）
