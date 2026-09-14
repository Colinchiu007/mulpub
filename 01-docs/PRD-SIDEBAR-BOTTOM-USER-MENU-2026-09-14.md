# PRD：侧边栏底部用户菜单与导航精简（2026-09-14）

> 状态：已实现（分支 `codex/sidebar-footer-user-menu`）
> 类型：🎨 UI/UX 布局调整（应用壳导航层）
> 关联文档：[桌面端 UI 布局规格](../docs/desktop-ui-layout-spec.md)、[桌面端前端交互规范](../docs/frontend-interaction-spec.md)、[i18n 词条表](./i18n-glossary.md)
> 关联 change：`openspec/changes/sidebar-bottom-user-banner`

---

## 1. 背景与目标

应用壳（左侧侧边栏 + 右侧工作区）当前把「登录/账号区」放在**左上角**，把「服务连接信息 + 升级 Pro」放在**左下角**，模块导航右上角还有 4 个占位功能入口（移动端预览 / 客服支持 / 使用指南 / 通知 — 内容均为占位文案，不具备真实能力）。这造成：

1. 左上角登录区与主导航争夺视觉焦点，导航层级不清；
2. 右上角 4 个占位入口提供零价值信息却占据视觉热区；
3. 左下角「服务连接信息」「升级 Pro」与登录区四散在多处，入口碎片化；
4. 主流桌面工具（参考客户端 Claw）已普遍采用「底部收起 banner → 点击向上展开完整用户菜单」的成熟范式。

**本次目标**：把用户与系统级入口收敛到侧边栏底部一个可展开的 banner（对齐截图 2 的交互范式），并清掉右上角占位入口。

**用户原始诉求（5 条，逐条对应实现）**：

| # | 诉求 | 实现位置 |
|---|------|---------|
| 1 | 右上角几个标识删掉 | `YixiaoerModuleNav.vue` 移除工具区与工具面板 |
| 2 | 左上角登录区域移到左下角，类似第 2 张截图（点击展开、收起只有一个 banner） | `ProfileMenu.vue` 迁移为底部向上展开 banner + `YixiaoerSidebar.vue` footer 挂载 |
| 3 | 左下角服务连接信息往上移，移动到左下角 banner 上方 | `YixiaoerSidebar.vue` footer 顺序调整 |
| 4 | 升级 Pro 按钮放进展开菜单，样式与展开菜单统一 | `ProfileMenu.vue` 菜单项 + `profile-menu-action-upgrade` |
| 5 | 左侧菜单中的设置移到展开菜单中 | 主导航移除「设置」按钮，改由菜单 `profile-menu-settings` 承载 |

---

## 2. 变更范围

### 2.1 In Scope

- 侧边栏顶部 header 结构（登录区移出、品牌标识补充）
- 侧边栏底部 footer 结构（服务连接信息上移、登录 banner 落位）
- `ProfileMenu` 组件能力扩展（向上展开、菜单项扩展、事件外抛）
- 模块导航右上角工具区整体删除
- 上述变更的单测、文档、规格同步

### 2.2 Out of Scope（明确不做）

- 不改动侧边栏宽度（仍为 `--yixiaoer-sidebar-width: 200px`）、不引入可折叠侧边栏
- 不改动「更多」二级菜单的路由清单
- 不改动设置弹窗（`SettingsDialog`）内部结构，仅改入口位置
- 不改动升级弹窗（`UpgradeModal`）内部结构，仅改入口位置与版式
- 不改动账号认证 / 身份服务 / 服务状态轮询的 IPC 与数据契约
- 不新增第三方依赖

---

## 3. 术语与改动前现状

| 术语 | 说明 |
|------|------|
| 登录区 / 用户 banner | `ProfileMenu.vue`：头像 + 名称 + 许可徽标 + 展开菜单 |
| 服务连接信息 | `SidebarServiceStatus.vue`：六服务（主服务/分句引擎/提示词优化引擎/回调服务/媒体服务/对齐引擎）聚合状态 + hover 明细列表 |
| 模块导航 | `YixiaoerModuleNav.vue`：仅首页标签显示的工作区级标签栏（主页 / 账号管理... / 发布...） |
| 应用壳 | `App.vue` 的 `.yixiaoer-shell`（侧边栏 + 标签栏 + 导航栏 + 模块导航 + 工作区） |

**改动前的侧边栏结构（自上而下）**：

```
Header   : [登录区 ProfileMenu ............] [+ 新建发布]
主导航    : 主页 / 发布 / 账号 / 数据 / 视频创作 / 采集 / 设置 / 更多(二级菜单)
Footer   : 客户端状态（已连接/未登录...）
           [服务连接信息 ...]        [⭐ 升级 Pro]
```

**改动后**：

```
Header   : [MP] Multi-Publish ............. [+ 新建发布]
主导航    : 主页 / 发布 / 账号 / 数据 / 视频创作 / 采集 / 更多(二级菜单)
             ↑ 设置已移出
Footer   : [服务连接信息 六服务聚合状态]          ← 上移
           [ (avatar) 用户名  [Pro]  ⌃ ]          ← 登录 banner（收起态）
             ↑ 点击向上展开 ↓
           ┌───────────────────────────┐
           │ 用户名 / 连接状态          │
           │ 会员中心                   │
           │ 切换账号                   │
           │ 退出登录                   │
           │ ─────────────────          │
           │ 设置                       │
           │ ⭐ 升级 Pro                │  ← 非 Pro 用户
           └───────────────────────────┘
```

---

## 4. 需求明细

### 4.1 移除模块导航右上角占位工具入口（诉求 1）

| 项 | 要求 |
|----|------|
| 删除对象 | 工具区容器 `.yixiaoer-module-tools`（`data-testid="yixiaoer-module-tools"`）及其 4 个按钮：移动端预览 `▯` / 客服支持 `◉` / 使用指南 `◫` / 通知 `♧` |
| 删除对象 | 配套的工具面板 `#yixiaoer-tool-panel`（`role="dialog"`，含关闭按钮与三步引导文案） |
| 删除对象 | 相关脚本状态（`activeTool` / `toolPanels` / `activeToolContent` / `toggleTool`）与全部工具样式 |
| 保留 | 左侧模块标签（主页 / 账号管理、分组管理、分享链接、收藏分组 / 新建发布、发布记录、草稿箱）及其激活态下划线 |
| 布局 | 工具区移除后模块导航改为单一子元素左对齐（去掉 `justify-content: space-between` 与 `gap`），高度仍为 `var(--yixiaoer-nav-height, 70px)` |

**动机**：4 个入口的真实能力均为"占位说明"（面板文案为"当前工作区尚未接入在线客服服务""暂无新通知"等），属未交付能力的前置入口，保留会误导用户。

### 4.2 登录区迁移为底部可展开 banner（诉求 2）

**收起态（默认）**：只显示一条 banner，内容为：

| 显示项 | 内容 | 说明 |
|--------|------|------|
| 头像 | 已登录：用户名首字母大写；未登录/无会话：`⚡` | 30×30 圆形，渐变底 |
| 存在状态点 | 头像右下角 10×10 圆点 | `online` 绿 / `busy`·`error` 橙 / 其他灰 |
| 主文案 | 显示名（未登录为「未登录」等状态文案） | 单行省略 |
| 许可徽标 | 免费版 / 试用版 / 专业版 | `profile-license-*` 三色 |
| 展开指示 | `⌃`（ArrowUp），展开后旋转 180° | 明示"点击可展开" |
| 悬停提示 | `title` = 当前身份状态文案（已连接 / 未登录 / 登录已过期…） | 取代被移除的底部状态行 |

**展开态**：banner 上方弹出菜单面板（`data-testid="profile-menu-panel"`），面板与 banner **同宽**且不超出侧边栏宽度。

**交互逻辑（状态机）**：

| 触发 | 前置条件 | 行为 |
|------|---------|------|
| 点击 banner（菜单已开） | — | 关闭菜单 |
| 点击 banner | 身份状态 = `signed_out` / `expired` 且未在登录中 | **不展开菜单**，直接发起登录（`signIn()`）；登录失败才展开菜单展示错误 |
| 点击 banner | 身份状态 ∈ {`authenticated`, `offline_authenticated`, `refreshing`, `disabled`, `error`} | 展开菜单并把焦点移到第一个菜单项 |
| 键盘 `↓`（banner 聚焦） | — | 展开菜单并聚焦第一项 |
| 点击菜单外部 | 菜单已开 | 关闭菜单 |
| `Esc` | 菜单已开 | 关闭菜单并把焦点还给 banner |
| `Tab`（面板内） | 菜单已开 | 关闭菜单（避免焦点落入未展开区域） |
| `↑`/`↓`/`Home`/`End`（面板内） | 菜单已开 | 在可聚焦菜单项间循环移动 |
| 选中任一菜单项 | — | 先关闭菜单，再执行动作 |

### 4.3 服务连接信息上移（诉求 3）

| 项 | 要求 |
|----|------|
| 位置 | footer 内**第一行**，位于登录 banner **上方** |
| 结构 | 新增容器 `.yixiaoer-sidebar-service`，内部为 `SidebarServiceStatus`（聚合文案 + 六服务 hover 明细） |
| DOM 顺序契约 | footer 子元素顺序固定为 `[0] 服务连接信息` → `[1] 登录 banner` → （升级弹窗，条件渲染） |
| 窄屏 | 视口 ≤900px 时隐藏服务连接信息（保留登录 banner，保证账号入口可用） |

> 说明：原 footer 中的「客户端状态」独立文字行（`已连接 / 未登录 / 登录已过期…`）被移除，其信息合并进 banner：状态点 + `title` + 展开菜单标题区的状态文案。该行与登录 banner 属同一语义域，保留会造成重复显示。

### 4.4 设置入口迁移（诉求 5）

| 项 | 要求 |
|----|------|
| 移除 | 主导航中的「设置」按钮（`data-testid="yixiaoer-primary-settings"`，齿轮图标 + 文案） |
| 新增 | 展开菜单中的「设置」菜单项（`data-testid="profile-menu-settings"`，文案 `t('nav.settings')`） |
| 行为 | 点击后**先关闭菜单**，再向宿主抛出 `open-settings` 事件；侧边栏原样透传给 `App.vue` → 打开 `SettingsDialog`（沿用既有链路，0 新增 IPC） |
| 可见性 | 与身份状态无关，**任何状态都显示**（含身份服务未启用 `disabled`） |

### 4.5 升级 Pro 进入展开菜单并统一版式（诉求 4）

| 项 | 要求 |
|----|------|
| 移除 | footer 中原有的独立胶囊按钮 `.yixiaoer-upgrade-btn`（`⭐ 升级 Pro`，金色圆角胶囊） |
| 新增 | 展开菜单中的「升级 Pro」菜单项（`data-testid="profile-menu-upgrade"`），`⭐` 图标 + 文案 `t('memberCenter.upgradePro')` |
| 版式 | 与「设置」「会员中心」等菜单项**同一套** `.profile-menu-action` 结构（同宽、同内边距、同圆角、同焦点态），仅以 `profile-menu-action-upgrade` 增加金色描边/渐变/加粗做强调 |
| 可见性 | `!licenseStore.isPro` 时显示；Pro 用户不显示（与旧逻辑一致） |
| 行为 | 点击后先关闭菜单，再抛出 `upgrade` 事件；侧边栏接住后打开 `UpgradeModal` |

---

## 5. 组件对外契约

### 5.1 `ProfileMenu.vue`

| 项 | 类型 | 值 / 说明 |
|----|------|----------|
| emit `open-settings` | — | 用户点击「设置」 |
| emit `upgrade` | — | 用户点击「升级 Pro」（仅在非 Pro 显示） |
| 沿用 | — | 原有登录 / 切换账号 / 退出登录 / 会员中心 行为与事件一律不变 |
| 稳定选择器 | — | `data-testid`：`profile-menu` / `yixiaoer-profile` / `yixiaoer-profile-status` / `profile-menu-panel` / `profile-menu-member` / `profile-menu-switch` / `profile-menu-signout` / `profile-menu-signin` / `profile-menu-settings` / `profile-menu-upgrade` |

### 5.2 `YixiaoerSidebar.vue`

| 项 | 说明 |
|----|------|
| emit `open-settings` | 由 `ProfileMenu` `@open-settings` 直接透传（`emit('open-settings')`），外部行为与改造前完全一致（`App.vue` 无需改动） |
| 本地状态 | `showUpgradeModal`：由 `ProfileMenu` `@upgrade` 置真，`UpgradeModal` 仍由侧边栏承载 |
| 移除 | `useIdentityStore` / `useLicenseStore` 依赖与相关 computed（身份状态判定已下沉到 `ProfileMenu`） |

### 5.3 `YixiaoerModuleNav.vue`

| 项 | 说明 |
|----|------|
| 移除 | 工具区、工具面板、工具状态与样式 |
| 保留 | `module` / `tabs` / `isTabActive` 逻辑与标签渲染，`aria-label="工作区导航"` |

---

## 6. 数据校验与边界

| 校验项 | 规则 | 位置 | 失败处理 |
|--------|------|------|---------|
| 面板展开方向 | 恒为向上（`bottom` 定位）且与 banner 等宽 | `ProfileMenu.vue` scoped CSS + `ProfileMenu.test.js` 源码级契约断言 | 越出侧边栏宽度即断言失败（防回归） |
| 身份状态枚举 | `status` 仅可能为 `authenticated` / `offline_authenticated` / `refreshing` / `signing_in` / `signing_out` / `signed_out` / `expired` / `disabled` / `error` | `ProfileMenu.vue` `identityStatus` | 未匹配值归为 `error` 档（橙点 + 错误文案），不出现无样式状态点 |
| 显示名兜底 | `displayName` 为空 → 头像取 `'M'` 首字母，菜单标题回落 `Multi-Publish` | `ProfileMenu.vue` | 无空字符串渲染 |
| 会话身份判定 | `hasSessionIdentity = Boolean(user?.sub) && status ∉ {disabled, signed_out, expired}` | `ProfileMenu.vue` | 判定失败走未登录分支（展示状态说明 + 重试登录） |
| Pro 判定 | `licenseStore.isPro`（来源 `info.isPro`） | `ProfileMenu.vue` | `undefined/false` 一律按非 Pro 处理（显示升级入口，fail-safe 不误隐藏付费入口） |
| 菜单项禁用 | `loading`（登录/切换/退出进行中）时禁用切换账号与退出登录 | `ProfileMenu.vue` | `disabled` 属性 + `cursor: wait` + `opacity: .6` |
| 重复提交 | `pendingAction` 标记当前进行中的账号动作 | `ProfileMenu.vue` | 进行中显示「切换中…/退出中…」文案，防止二次触发 |

**数据依赖声明**：本次改动**不新增任何持久化读写**（无 SQLite / localStorage / 文件 IPC）；仅消费既有 `identity` / `license` / `serviceStatus` Pinia store 的只读状态。服务连接信息仍由 `SidebarServiceStatus` 的既有轮询（`startPolling`/`stopPolling`）驱动，生命周期未改动。

---

## 7. 显示项与提示文字（i18n）

### 7.1 新增/沿用的 i18n key（zh / en 均已在 locales 中存在，无需新增词条）

| 显示项 | Key | zh | en |
|--------|-----|----|----|
| 设置（菜单项） | `nav.settings` | 设置 | Settings |
| 升级 Pro（菜单项） | `memberCenter.upgradePro` | 升级 Pro | Upgrade to Pro |
| 会员中心 | `memberCenter.menuEntry` | 会员中心 | Membership |
| 切换账号 / 切换中 | `memberCenter.switchAccount` / `switchingAccount` | 切换账号 / 切换中… | Switch account / Switching… |
| 退出登录 / 退出中 | `memberCenter.signOut` / `signingOut` | 退出登录 / 退出中… | Sign out / Signing out… |
| 重试登录 / 登录中 | `memberCenter.loginRetry` / `signingIn` | 重试登录 / 登录中… | Retry sign-in / Signing in… |
| 状态：已连接 / 离线 / 刷新中 / 登录中 / 已过期 / 异常 | `memberCenter.statusConnected` / `statusOffline` / `statusRefreshing` / `statusSigningIn` / `statusExpired` / `statusError` | — | — |
| 身份服务未启用 | `memberCenter.identityDisabled` / `identityDisabledHint` | — | — |
| 未登录 / 未登录说明 | `memberCenter.notLoggedIn` / `notLoggedInHint` | — | — |
| 许可：免费/试用/专业 | `memberCenter.licenseFree` / `licenseTrial` / `licensePro` | — | — |
| 服务聚合状态 | `sidebar.serviceStatus.allRunning` / `partialRunning` / `unavailable` | 服务运行中 / 部分服务运行中（{count}） / 服务状态不可用 | Service running / … |

> **i18n 约束**：本次改动**不新增硬编码中文**（CI Gate 7 `--cjk` 基线只减不增，本次扫描 1461 < 基线 1689）；`ProfileMenu.vue` 保持「零中文字面量」，全部走 `t()`。

### 7.2 移除的显示项

| 移除项 | 原位置 | 原因 |
|--------|--------|------|
| 移动端预览 / 客服支持 / 使用指南 / 通知 | 模块导航右上角 | 占位能力，无真实功能 |
| 工具面板（含三步引导文案） | 模块导航右上角面板 | 同上 |
| 主导航「设置」（齿轮） | 侧边栏主导航 | 收敛到底部菜单（诉求 5） |
| 独立「升级 Pro」胶囊按钮 | 侧边栏 footer | 收敛到底部菜单（诉求 4） |
| 客户端状态独立文字行 | 侧边栏 footer | 与登录 banner 语义重复，合并为状态点 + title + 菜单内状态文案 |

---

## 8. 视觉规范

### 8.1 底部 banner（收起态）

| 项 | 值 |
|----|----|
| 尺寸 | 宽 100%（footer 内容宽度），内边距 `8px 10px` |
| 圆角 | 10px |
| 描边 | 1px `#e3e1f2`，悬停/展开 `#bab9d3` |
| 底色 | `rgba(255,255,255,.72)`，悬停/展开 `rgba(255,255,255,.94)` |
| 阴影 | `0 2px 8px rgba(99,91,195,.06)` |
| 头像 | 30×30，`linear-gradient(140deg,#ffcf80,#ef9e68)`，字色 `#5d3824` |
| 状态点 | 10×10，2px 白描边；`online #6fbf73` / `busy`·`error #e6a23c` / 其他 `#a7a8b5` |
| 主文案 | 12px `#4d4f6f`，单行省略 |
| 展开指示 | 13×13，`#a5a6bd`，展开时 `rotate(180deg)`，过渡 `.15s ease` |

### 8.2 展开菜单面板

| 项 | 值 |
|----|----|
| 定位 | `position: absolute`，`bottom: calc(100% + 8px)`，`left/right: 0`（与 banner 同宽，绝不溢出侧边栏） |
| 尺寸 | 宽度随容器；`max-height: min(70vh, 420px)`，超出内部滚动 |
| 层级 | `z-index: 140` |
| 阴影 | `0 12px 32px rgba(30,27,75,.14)` |
| 菜单项 | 宽 100%，`margin-top: 10px`，`padding: 8px 10px`，1px 描边，圆角 `var(--r-xs)` |
| 菜单项悬停/聚焦 | 描边与文字变 `var(--primary)` |
| 分隔线 | `.profile-menu-sep` 上方 `10px` 间距 + `1px var(--hairline)` |
| 升级项强调 | 描边 `#d9c98a`、底色 `linear-gradient(180deg,#fff7e0,#ffeec2)`、文字 `#8a6d1f`、`font-weight: 600`（结构与其余菜单项一致） |
| 许可徽标 | 免费 `#e3e1f2/#9293a6`、专业 `#fdecc8/#8a6d1f`、试用 `#d9f0ff/#27618a` |

### 8.3 响应式断点（`max-width: 900px`，侧边栏 68px）

| 元素 | 窄屏行为 |
|------|---------|
| 品牌标识 `MP` / 标题 `Multi-Publish` / `+` 新建发布 | 隐藏 |
| 主导航文字标签 | 隐藏（仅图标） |
| 服务连接信息 | 隐藏 |
| 登录 banner | **保留**（仅头像 + 状态点，文案与徽标隐藏）——保证窄屏仍可登录/切换账号/进入设置 |
| 展开菜单面板 | 从 banner 上方展开，宽度随容器（68px - 内边距） |

---

## 9. 无障碍（a11y）

| 元素 | 属性 |
|------|------|
| banner 按钮 | `type="button"`、`aria-haspopup="menu"`、`:aria-expanded="open"`、`:aria-busy="loading"`、`id="profile-menu-trigger"`、`:title="当前身份状态文案"` |
| 菜单面板 | `role="menu"`、`aria-labelledby="profile-menu-trigger"` |
| 菜单项 | `role="menuitem"`（禁用项带 `disabled`） |
| 分隔线 | `role="separator"` |
| 视觉状态（头像点、图标） | `aria-hidden="true"`，语义由 banner `title` 与菜单标题区的状态文案承载 |
| 键盘可达 | banner 可 Tab 聚焦、`↓` 展开；面板内 `↑/↓/Home/End` 循环、`Esc` 关闭并回焦、`Tab` 关闭 |
| 焦点样式 | `outline: 2px solid #5149e8; outline-offset: 1px`（banner）/ 菜单项描边高亮 |
| 错误提示 | `<p role="alert">` 播报身份错误（沿用既有实现） |

---

## 10. 异常与降级

| 场景 | 表现 | 处理 |
|------|------|------|
| 身份服务不可用（`disabled`） | 点击 banner 展开菜单并显示"身份服务未启用"说明 | 不触发登录；「设置」「升级 Pro」仍可用 |
| 会话过期（`expired`） | 点击 banner 直接发起登录 | 登录失败才展开菜单并展示错误 |
| 登录 / 切换 / 退出失败 | 面板内 `role="alert"` 显示 `formatUserError` 友好文案 | 菜单保持展开，用户可重试 |
| 服务状态接口不可用 | 服务连接信息显示"服务状态不可用" | 不影响 banner 与菜单 |
| IPC 不可用（浏览器调试环境） | `invokePageManager` 静默降级 | 侧边栏宽度同步失败不影响布局正确性（默认 200px） |
| 许可信息未加载 | `isPro` 为假 → 显示升级入口 | 不误隐藏付费入口 |

---

## 11. 测试设计

### 11.1 单元测试映射（TDD 回归保护）

| 测试文件 | 用例 | 覆盖契约 |
|----------|------|---------|
| `src/layouts/YixiaoerModuleNav.test.js` | 「no longer renders module tool entries or the tool panel」 | 工具区/4 个按钮/工具面板全部不渲染（防回归） |
| `src/layouts/YixiaoerSidebar.test.js` | ①footer 顺序（服务连接信息在上、banner 在下）②登录区不在 header ③设置已移出主导航 ④`@open-settings` 透传 ⑤`@upgrade` → 打开升级弹窗 ⑥服务明细/降级展示 ⑦新建发布路由 | 诉求 2/3/4/5 的结构与事件流 |
| `src/components/ProfileMenu.test.js` | ①banner 收起仅一条 + 状态点 + 点击展开 ②面板样式契约（向上展开 / 左右铺满，负向断言不回归 `top` 定位）③设置项抛出并关菜单 ④非 Pro 显示升级项（同版式类）并抛出 ⑤Pro 不显示升级项但保留设置 ⑥禁用身份服务仍提供设置/升级 ⑦既有登录/切换/退出用例全保留 | 组件对外契约与可见性规则 |

### 11.2 视觉回归

- CI Gate 7 像素门禁（`apps/desktop/tests/visual-testing/base-screenshots/`，阈值 6%）覆盖 `home-baseline` / `accounts-list` 等含应用壳的视图。
- 变更影响区域集中在侧边栏（约 200×250px）与模块导航右端（约 130×70px），需在 PR 的 CI 视觉门禁中确认无越阈差异；若越阈则按 `pnpm run test:visual:update-baseline` 重建基线。

### 11.3 手工验收清单

1. 打开应用，侧边栏左上角不再显示登录区，显示 `MP Multi-Publish` 与 `+`；
2. 模块导航右上角 4 个图标消失，标签仍可切换并高亮当前页；
3. sidebar 底部依次为「服务连接信息」「用户 banner」，hover 服务信息可见六服务明细；
4. 点击左下角 banner 向上展开菜单；再次点击或点击外部/Esc 收起；点击后菜单先关闭再动作；
5. 菜单含「设置」「⭐ 升级 Pro」（非 Pro），两者版式与其它菜单项一致；
6. 点击「设置」打开设置弹窗；点击「升级 Pro」打开升级弹窗；
7. 未登录状态点击 banner 直接唤起登录；身份服务不可用时点击展开说明菜单；
8. 窗口缩到 900px 以下：服务信息消失，banner 仅剩头像且仍可展开菜单。

---

## 12. 验收标准

| # | 验收标准（可验证） |
|---|-------------------|
| 1 | `YixiaoerModuleNav.vue` 中不存在 `.yixiaoer-module-tools`、`.yixiaoer-tool-button`、`#yixiaoer-tool-panel` 及其脚本状态/样式 |
| 2 | 侧边栏 footer 的 DOM 顺序为 [服务连接信息, 登录 banner]（由单测断言钉死） |
| 3 | 登录 banner 收起时**仅一条**，展开面板与 banner 同宽且不溢出侧边栏 |
| 4 | 主导航不再包含「设置」；菜单含「设置」且点击后触发 `open-settings` → 打开 `SettingsDialog` |
| 5 | 非 Pro 用户菜单含「⭐ 升级 Pro」，点击打开 `UpgradeModal`；Pro 用户不显示该入口 |
| 6 | 三个测试文件全绿：`YixiaoerSidebar.test.js`(9) / `YixiaoerModuleNav.test.js`(5) / `ProfileMenu.test.js`(12) |
| 7 | ESLint error 级 0 问题；i18n `--cjk` 无新增硬编码、`--keys` 全命中 |
| 8 | CI 全绿（QG Static/Unit/Coverage/Shards/Visual/E2E、electron-tests、build 等） |

---

## 13. 影响面与回滚

| 项 | 说明 |
|----|------|
| 改动文件 | `apps/desktop/src/layouts/YixiaoerSidebar.vue`、`apps/desktop/src/layouts/YixiaoerModuleNav.vue`、`apps/desktop/src/components/ProfileMenu.vue` + 3 个单测文件 |
| 对外契约 | `ProfileMenu` 新增 `open-settings` / `upgrade` 两个 emit（既有 props / emit 语义不变）；`YixiaoerSidebar` 的 `open-settings` 事件语义不变 |
| 数据/接口 | 无变更（无 IPC / DB / 持久化改动） |
| 回滚方式 | 单 PR 纯前端改动，按提交回滚即可；无数据迁移、无状态残留 |
| 风险等级 | 低—中（仅应用壳布局，无业务逻辑；由 3 个组件测试 + 像素门禁保护） |

---

## 14. 相关文件

| 文件 | 职责 |
|------|------|
| `apps/desktop/src/layouts/YixiaoerSidebar.vue` | 侧边栏容器：header 品牌区、主导航、footer（服务信息 + 底部用户 banner） |
| `apps/desktop/src/components/ProfileMenu.vue` | 登录区用户菜单：banner 触发 + 展开面板（账号操作 / 设置 / 升级 Pro） |
| `apps/desktop/src/components/SidebarServiceStatus.vue` | 服务连接信息聚合与明细 |
| `apps/desktop/src/layouts/YixiaoerModuleNav.vue` | 模块导航（工具区已移除） |
| `apps/desktop/src/components/UpgradeModal.vue` | 升级弹窗（由侧边栏承载） |
| `apps/desktop/src/components/SettingsDialog.vue` | 设置弹窗（由 `App.vue` 承载） |
| `apps/desktop/src/stores/license.js` | 许可状态（`isPro`） |
| `apps/desktop/src/composables/useIdentity.js` | 身份状态与登录/切换/退出动作 |
| `apps/desktop/src/composables/useDropdownBehavior.js` | 下拉行为（外部点击/Esc/方向键） |
| `docs/desktop-ui-layout-spec.md` | 布局规格（本次同步 §2 / §3 / §8 / §9 / §12） |
| `docs/frontend-interaction-spec.md` | 交互规范（本次新增 §6.4 底部用户 banner 规则） |
