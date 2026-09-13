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
| 页面级 Loading | 统一 LoadingState 封装（P2 落地，底层 v-loading） | 各视图自写 spinner CSS |
| 列表空态 | 统一 `<EmptyState>` 组件（P2 落地，tasks 3.3），含说明 + 引导 CTA；落地前暂维持现状样式，禁止新增自造副本 | 空白区域、裸 `<p>` 文本、自造 .empty 样式副本 |
| 错误文案 | `formatUserError()`（user-facing-error.js，遵循 user-facing-messages spec） | 手工拼接原始 error message 直出给用户 |
| 长页面回到顶部 | 全局 `components/BackToTop.vue` 唯一实例（App.vue 挂载，2026-09-14 落地） | 各视图自写滚动按钮、自写 `scrollTo(0)` 逻辑、自造浮标样式副本 |

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

- **左侧导航栏（YixiaoerSidebar）是固定区域**，不可滚动、不可移动，不随右侧内容变化而移动
- 侧边栏宽度由 CSS 变量 `--yixiaoer-sidebar-width` 控制（默认 200px，定义于 `cohere-design-system.css:69`）
- 侧边栏通过 `ResizeObserver` 实时同步宽度到主进程，确保 WebContentsView 定位准确
- 任何新增路由/视图不得覆盖或遮挡侧边栏区域
- 详细规格见 [桌面端 UI 布局规格](./desktop-ui-layout-spec.md)

### 6.2 WebContentsView 定位

- 所有由主进程管理的 WebContentsView（浏览器标签页、登录视图、扫码视图）必须定位在右侧主体区域
- X 偏移 = 侧边栏宽度（默认 200px），Y 偏移 = 76px（TabBar + NavBar）
- 新增 WebContentsView 场景必须遵循相同的定位规则，调用 `WebviewManager` 或 `AuthViewManager` 的标准方法
- 详细规格见 [桌面端 UI 布局规格](./desktop-ui-layout-spec.md) 第 4 节

### 6.3 模块导航栏

- `YixiaoerModuleNav` 仅在首页标签（`isHomeTab === true`）时显示
- 当浏览器标签或登录标签激活时，模块导航自动隐藏，WebContentsView 占据右侧主体区域
- 详细规格见 [桌面端 UI 布局规格](./desktop-ui-layout-spec.md) 第 3 节

## 7. 死代码处置原则

不可达路由页、零引用组件、未挂载功能模块：先全库检索引用（含 tests、story2video 子目录）→ 无引用即删 → 全量单测验证。同功能双实现合并时保留一份测试并迁移引用方。
