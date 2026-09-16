# 桌面端前端交互规范

> 状态：**生效中**（unify-desktop-frontend change P0 产出）
> 适用范围：`apps/desktop/src` 渲染层全部视图、组件、composable
> 强制力：新增代码违反本规范将被 CI Gate 10 / Code Review 打回；存量代码按批次迁移
> 契约来源：openspec/specs/desktop-ui-consistency（随 unify-desktop-frontend 归档后生效）

## 1. 设计 Token 规则

- **唯一来源**：颜色/字号/间距/圆角/阴影变量一律来自 `src/styles/tokens.css`（P2 落地）。任何组件/视图不得自定义与 token 同语义的变量。
- **主色定标**：`--color-primary: #5048e5`（用户决策，2026-08-24）。全库禁止第二种"主蓝/主紫"字面量（现存 `#3a7be5`、Element 默认蓝等在 P2 清零）。
- **暗色模式**：`[data-theme="dark"]` 下主色保持品牌可辨识度，禁止覆盖为低对比浅灰（现存 bug 见 cohere-design-system.css:1427，P2 修复）。
- **阶梯约束**：字号收敛到 12/13/15/17/20/24/32 七档，圆角收敛到 4/8/12/16/999(pill) 五档。新代码不得引入档位外的魔法值。

### 旧 token → 新 token 映射表（P2 迁移依据）

| 语义 | 旧变量（来源文件） | 新 token |
|------|-------------------|----------|
| 主色 | `--apple-*` 主色系（apple-design-tokens.css）、`--action-blue`、`--primary`（cohere-design-system.css:10）、video-creation 主色系 | `--color-primary` |
| 页面底色 | `--canvas`、`--cohere-black` 等 | `--color-bg-canvas` |
| 卡片底色 | 各视图 scoped `.card` 内重复定义 | `--color-bg-card` |
| 正文/次要文字 | `--ink`、`--text-muted` 等 | `--color-text-primary` / `--color-text-secondary` |
| 危险色 | `--danger`、`--coral` | `--color-danger` |
| 成功/警告 | 分散定义 | `--color-success` / `--color-warning` |
| 字号 | 三套各自 px 值 | `--font-size-{xs..xxl}` |
| 圆角 | 三套各自 px 值 | `--radius-{sm..full}` |
| 间距 | 零散值 | `--space-{1..8}`（4px 基数） |

## 2. 交互原语唯一实现清单

| 交互场景 | 唯一实现 | 禁止 |
|----------|---------|------|
| 操作成功/失败提示 | `ElMessage.success/error` | 自造 toast、console 提示、静默吞错 |
| 危险操作确认（删除/批量删除/不可逆操作） | `ElMessageBox.confirm`（经 `confirmDanger` 封装，P1 提供），文案必须说明后果 | **`window.confirm`（CI Gate 10 拦截）**、无确认直接执行 |
| 表单/内容弹窗 | 复杂表单用 `el-dialog`；轻量确认用 ElMessageBox | 同页面混用三套弹窗体系 |
| 页面级 Loading | 统一 `<UiSkeleton>` 组件（2026-09-13 落地；令牌与骨块外观见 `src/styles/skeleton.css`） | 各视图自写 spinner / 纯文字 / CSS 渐变骨架、`@keyframes *shimmer*` |
| 列表空态 | 统一 `<EmptyState>` 组件（P2 落地，tasks 3.3），含说明 + 引导 CTA；落地前暂维持现状样式，禁止新增自造副本 | 空白区域、裸 `<p>` 文本、自造 .empty 样式副本 |
| 错误文案 | `formatUserError()`（user-facing-error.js，遵循 user-facing-messages spec） | 手工拼接原始 error message 直出给用户 |
| 长页面回到顶部 | 全局 `components/BackToTop.vue` 唯一实例（App.vue 挂载，2026-09-14 落地） | 各视图自写滚动按钮、自写 `scrollTo(0)` 逻辑、自造浮标样式副本 |
| 用户/账号入口（含设置、升级 Pro） | 侧边栏底部 `components/ProfileMenu.vue`（向上展开形态，2026-09-14 落地） | 各视图自建用户菜单、自建登录入口、自建「升级 Pro」按钮副本、在主导航另设「设置」入口 |

### 危险操作门禁（最高优先级条款）

以下操作当前**无确认直接执行**，P1 必须补齐：

- 批量删除发布记录（PublishHistory.vue `deleteSelectedRecords`）
- 删除项目（useBacklot.deleteProject 调用链）
- 删除音色

判定标准：操作不可逆 **或** 影响面 >1 条数据 → 必须确认。确认框需列出影响数量。

## 3. IPC 访问单轨制

- Vue 组件/composable/store **禁止**直接调用 `window.electronAPI`（CI Gate 10 基线拦截；存量以 `.github/scripts/frontend-consistency-baseline.json` 为准，只降不升）
- 一律通过 `src/api/**` 桥接层函数调用
- 需要"失败静默降级"的 channel 在桥接层显式声明 fallback，不允许调用方自行 try/catch 后吞掉

## 4. i18n 规则

- 用户可见文案一律走 `$t()` / `useI18n`，zh/en 成对提交（CI Gate 7 强制）
- 渲染端硬编码中文基线只减不增（CI Gate 7 --cjk 已强制）
- CreateView/ResultView 存量词条迁移随巨石拆解批次执行（延后项已登记）

## 5. 组件使用规则

- 优先复用 `components/Ui*.vue` 现存组件（UiInput/UiSelect/UiModal/UiButton）；UiCard/UiBadge 已判定为废弃死代码（零使用），**P2 批次删除**，期间不得新增引用
- 新增全局组件前必须先检索是否已有等价实现（components 平铺区 + features/ 域目录两处都查）
- 视图命名：路由页面统一 `XxxView.vue` 后缀（存量不一致者随触碰逐步改名，不做专项批量）

## 6. 布局框架规则

### 6.1 左侧侧边栏固定

- **左侧导航栏（MpSidebar）是固定区域**，不可滚动、不可移动，不随右侧内容变化而移动
- 侧边栏宽度由 CSS 变量 `--mp-sidebar-width` 控制（默认 200px，定义于 `cohere-design-system.css:69`）
- 侧边栏通过 `ResizeObserver` 实时同步宽度到主进程，确保 WebContentsView 定位准确
- 任何新增路由/视图不得覆盖或遮挡侧边栏区域
- 详细规格见 [桌面端 UI 布局规格](./desktop-ui-layout-spec.md)

### 6.2 WebContentsView 定位

- 所有由主进程管理的 WebContentsView（浏览器标签页、登录视图、扫码视图）必须定位在右侧主体区域
- X 偏移 = 侧边栏宽度（默认 200px），Y 偏移 = 76px（TabBar + NavBar）
- 新增 WebContentsView 场景必须遵循相同的定位规则，调用 `WebviewManager` 或 `AuthViewManager` 的标准方法
- 详细规格见 [桌面端 UI 布局规格](./desktop-ui-layout-spec.md) 第 4 节

### 6.3 模块导航栏

- `MpModuleNav` 仅在首页标签（`isHomeTab === true`）时显示
- 当浏览器标签或登录标签激活时，模块导航自动隐藏，WebContentsView 占据右侧主体区域
- **发布域整行不渲染（2026-09-15）**：发布域路由（`/publish`、`/publish/history`、`/publish?tab=drafts`、`/collection` 等非首页非账号域路由）下模块导航整行移除——无标签、无 70px 占位、无底部分隔线；发布域导航入口由左侧边栏唯一承担。主页域与账号域标签保留。回归保护：`MpModuleNav.test.js` 断言发布域四路由零 `role="tab"` 节点
- **不含右侧工具区**：原「移动端预览 / 客服支持 / 使用指南 / 通知」4 个占位入口已于 2026-09-14 整体移除。新增入口前必须确认其具备真实能力，禁止再以"占位面板"形式提供入口
- 详细规格见 [桌面端 UI 布局规格](./desktop-ui-layout-spec.md) 第 3 节

### 6.4 侧边栏底部用户 banner（登录区，2026-09-14 落地）

- **位置唯一**：登录区唯一落点是侧边栏底部 banner（`ProfileMenu placement="top"`），收起时只显示一条 banner；不得放回顶部 header，也不得在页面内另设登录入口
- **服务连接信息在其上方**：footer DOM 顺序固定为 [0] 服务连接信息 → [1] 用户 banner（`MpSidebar.test.js` 断言钉死）；新增 footer 元素必须排在 banner 之后
- **展开方向**：banner 一律向上展开（`bottom` 定位），面板宽度与 banner 等宽、不得溢出侧边栏；该契约由 `ProfileMenu.test.js` 的源码级 CSS 断言钉死
- **菜单项版式统一**：「设置」「升级 Pro」等新增项必须复用 `.profile-menu-action` 结构（仅可加强调色类），禁止自造按钮样式
- **入口归属**：`设置` 只从本菜单进入（主导航不得再有设置项）；`升级 Pro` 只在非 Pro 用户的本菜单中出现，禁止在侧边栏/footer 另设独立按钮
- **事件链路**：菜单项只抛事件（`open-settings` / `upgrade`），由侧边栏承接（`open-settings` 透传给 `App.vue`，`upgrade` 打开 `UpgradeModal`）；菜单项内不得直接操作路由以外的副作用
- 详细规格见 [桌面端 UI 布局规格](./desktop-ui-layout-spec.md) §2.5；需求见 [PRD：侧边栏底部用户菜单](../01-docs/PRD-SIDEBAR-BOTTOM-USER-MENU-2026-09-14.md)

### 6.5 侧边栏左上角品牌区（Logo + 版本号，2026-09-14 落地）

- **位置唯一**：产品品牌标识（Logo）与应用版本号的唯一落点是侧边栏 header（布局规格 §2.6）；不得在 NavBar / 模块导航 / 页面内另设品牌标识或版本号副本
- **资产唯一**：品牌 Logo 唯一资源为 `src/assets/brand/tom-fish-logo.png`（176×108 RGBA）；禁止各视图内联不同 Logo 或另存副本；更换 Logo 必须同步替换该文件并核对 §2.6.2 尺寸推导
- **版本号取数唯一**：只能经 `@/api/electron-bridge` 的 `invoke('getVersion')` 读取（主进程 `app:get-version` → `apps/desktop/package.json.version`，该字段由根 `package.json` 单一真相源经 `scripts/sync-version.mjs` 派生，见 [版本管理规范](./version-management.md)），统一封装在 `src/composables/useAppVersion.js`；禁止直连 `window.electronAPI`，禁止新增第二个版本号 IPC，**禁止硬编码版本号字面量**
- **降级必须静默**：版本号缺失（无 `electronAPI` / `code !== 0` / `data` 为空 / IPC 抛错）一律**不渲染**该节点且不抛错——装饰性信息不得阻塞应用壳渲染，也不得把错误 `message` 当版本号展示
- **无交互原则**：Logo 与版本号均为纯展示（不可聚焦、不可点击、不可拖拽/选中）；点击 Logo **不**跳首页（避免与「主页」导航项语义重复）
- **文案必须走 i18n**：替代文本用 `sidebar.brandLogoAlt`、悬停提示用 `sidebar.appVersionTitle`（zh/en 成对）
- 详细规格见 [桌面端 UI 布局规格](./desktop-ui-layout-spec.md) §2.6；需求见 [PRD：侧边栏左上角品牌区](../01-docs/PRD-SIDEBAR-BRAND-LOGO-VERSION-2026-09-14.md)

## 7. 死代码处置原则

不可达路由页、零引用组件、未挂载功能模块：先全库检索引用（含 tests、story2video 子目录）→ 无引用即删 → 全量单测验证。同功能双实现合并时保留一份测试并迁移引用方。

## 8. 加载态（骨架屏）规则

> 落地日期 2026-09-13。详细方案与分批计划见 [前端 UI/UX 优化方案](../01-docs/FRONTEND-UI-UX-OPTIMIZATION-PLAN.md)。

### 8.1 唯一实现

- **唯一组件**：`src/components/UiSkeleton.vue`（全局注册于 `main.js`，单测镜像注册于 `test-setup.js`）。
- **唯一视觉来源**：`src/styles/skeleton.css` 的 `--skeleton-*` 令牌与 `.mp-skeleton-surface`；`@keyframes mp-skeleton-shimmer` 全库仅此一处。
- **禁止**：自写骨架渐变、`@keyframes *shimmer*`、在 `skeleton.css` / `UiSkeleton.vue` 之外引用 `var(--skeleton-*)`；由 `UiSkeleton.contract.test.js` 8 条契约断言强制。

### 8.2 变体选择规则（页面内容形态 → variant）

| 内容形态 | variant | 建议数量 |
|----------|---------|---------|
| 卡片栅格（项目 / 流水线 / 模板 / 场景素材） | `card`（容器配 `.mp-skeleton-grid` + `.mp-skeleton-card`） | 6 |
| 纵向条目列表（草稿 / 历史 / 收藏 / 榜单 / 日志 / 时间线） | `list` | 3~5 |
| 明细、详情、弹窗内容 | `paragraph` | 3~4 |
| 数据表格 | `table`（`tag="tr"` 可用于表格内） | 5 |
| 图表 / 统计 | `chart` | — |
| 看板、泳道 | `rect` 或 `card`（高度对齐真实卡片） | 6 |
| 单字段、单行状态 | `text` | — |
| 按钮内提交中 | **不用骨架**，用 `UiButton :loading` + 文案切换 | — |

### 8.3 交互与显示项

- 骨架在**数据到达后立即整体替换**为真实内容，不做逐条展开动画，避免"跳动"。
- 骨架期间**不显示**"加载中"文字（视觉噪音）；文字仅保留给辅助技术（见 8.4）。
- 加载超过 1 次的同页数据（分页加载更多）用骨架追加在列表尾部，不用全屏替换。
- 骨架**不进入 tab 焦点序列**，不阻断用户操作其他区域（除提交按钮的 `disabled` 之外不做全局遮罩）。
- 容器统一带 `data-testid="<page>-loading"`，便于视觉回归与单测定位。

### 8.4 无障碍与动效

- 根节点 `role="status"` + `aria-busy="true"`；内含视觉隐藏文案 `.mp-skeleton__sr`，默认读 i18n `common.loading`（zh「加载中...」/ en「Loading...」），可用 `label` prop 覆盖。
- 尊重 `prefers-reduced-motion: reduce`：**关闭流光动画但保留骨块**（保持"内容会来"的心理模型）。
- 明暗两套令牌由 `[data-theme="dark"]` 切换，禁止骨块颜色硬编码。

### 8.5 文案与 i18n

- 骨架屏本身不新增用户可见文案（零硬编码中文风险）；无障碍文案复用既有 key `common.loading`。
- 若某页面需要"预计耗时"等附加提示，必须走 locale（zh/en 成对）并显示在骨架容器外，不覆盖骨架。

### 8.6 已登记例外

| 例外 | 位置 | 理由 |
|------|------|------|
| `@keyframes seg-shimmer` | `styles/history-panel.css` | 流水线进度条活动段扫光（2s 无限），非加载占位 |
| `<el-dialog>` 内的 `v-loading` | FilmEngineering / PerformanceInsights 等 | Element Plus 表格/卡片局部遮罩，改造收益低 |
| `UiButton .ui-btn-spinner` | `components/UiButton.vue` | 按钮内提交态，非页面级加载 |

## 9. 路由入口登记规则

> 落地日期 2026-09-17（desktop-ui-consistency T0-5）。背景：`src/router/index.js` 只声明「路由怎么匹配」，不回答「用户从哪进来」，历史沉淀出一批没有任何导航入口的暗路由（运营中心「应用菜单」也配置不到它们）。

### 9.1 强制条款

**新增页面必须先在 `src/config/route-registry.js` 登记，再在 `src/router/index.js` 加路由。** 顺序反了 CI 会拦：Quality Gate 的 **Gate 13 - Route registry completeness**（`.github/scripts/check-route-registry.js`）会在未登记时 exit 1，并在日志里给出补登记指引。

本地同口径验证：

```bash
node .github/scripts/check-route-registry.js          # 期望输出 [route-registry] PASS
node --test .github/scripts/check-route-registry.test.js
```

### 9.2 登记字段

每条路由登记一个对象，六个字段必须填全：

| 字段 | 含义 | 填写规则 |
|------|------|----------|
| `path` | 路由路径 | 与 `router/index.js` **逐字一致**（含 `:param`） |
| `name` | vue-router 路由名 | redirect 路由无 name，填 `null` |
| `view` | 视图文件名 | 如 `Home.vue`；redirect 路由填 `''`（空串即 redirect 标记） |
| `navEntry` | 侧边栏菜单项 | 不进侧边栏填 `null`；否则 `{ key, group, labelI18nKey, to, icon }` |
| `internal` | 是否暗路由 | `true` = 无侧边栏菜单入口，只能从其它页面进入 |
| `entryFrom` | 宿主入口路径 | `internal: true` 时**必填**，且必须指向表内已登记的 path |

### 9.3 internal / entryFrom 判定

- **有侧边栏入口** → 填 `navEntry`（`key` 同时加进 `SIDEBAR_MENU_KEY_ORDER`，并同步运营中心 `ops-center/backend/services/app_menu_service.py` 的 `CATALOG`），`internal: false`。
- **无侧边栏入口**（暗路由）→ `navEntry: null` + `internal: true` + `entryFrom`。`entryFrom` 要写**真实宿主页面**：去对应视图里查它是从哪个页面 `router.push` 进来的；查不到就填 `'/'` 并在 PR 说明里标注「入口待确认」（登记表的注释里也要写明）。
- **redirect 路由** → `view: ''` + `navEntry: null` + `internal: false`，不填 `entryFrom`。
- `navEntry` 与 `internal: true` **互斥**，二者只能选一个；CI 会拦。

### 9.4 与侧边栏的关系

`src/config/sidebar-menu.js` 的 `SIDEBAR_MENU_DEFINITION` 由登记表派生（`deriveSidebarMenu(ROUTE_REGISTRY)`），菜单渲染顺序由 `SIDEBAR_MENU_KEY_ORDER` 决定（不是路由顺序）。因此**改登记表等于改运营中心菜单种子**：`sidebar-menu.test.js` 里的 `EXPECTED_DERIVED_MENU` 冻结了 19 项的 `key/group/labelI18nKey/to` 与顺序，有意变更菜单时必须同步改该基线并在 PR 说明中写明对运营侧配置的影响。
