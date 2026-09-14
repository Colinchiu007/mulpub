# 会员中心 + 左上角头像入口 — 需求与实施计划

## 1. 需求背景
桌面版无会员中心/个人中心。需新增会员中心页面，并在左上角用户头像与「更多」菜单提供入口；未登录时点头像直接弹出登录弹窗（复用既有 IdentityAuthWindow）。历史"头像点击没生效"根因：`.mp-profile`（MpSidebar.vue:4-10）自引入起从未绑定点击事件；IdentityMenu 仅在首页标签模块导航渲染。

## 2. 功能范围（P0 + P1，全部只读聚合，不新增后端/IPC）

### 2.1 会员中心页 `/member-center`（views/MemberCenter.vue）
- 账号信息卡：首字母头像、昵称(user.name||username)、登录状态标签、切换账号、退出登录（复用 identity store）
- 版本会员卡：licenseType（免费/试用/Pro）、daysRemaining、升级 Pro 按钮（复用 UpgradeModal 组件，沿用其支付/激活码/试用全流程）
- 登录权益卡：entitlement.plan / features[] / source（在线/离线 badge）/ expiresAt（仅已登录且有 entitlement 时）
- 配额卡：entitlement.quota（有则显、无则隐；需在 stores/identity.js normalizeState 补 quota 透传）
- 关于卡：应用版本号（复用 app:get-version / 与设置弹窗一致的数据来源）
- 未登录空态：引导文案 + 「登录」按钮（signIn()）+ 版本权益仍可见（license 本地数据）
- 身份服务 disabled：账号卡显示"身份服务未启用"，权益卡/配额卡隐藏，页面不白屏

### 2.2 左上角头像入口（components/ProfileMenu.vue + 侧边栏接线）
按身份状态分派点击行为：
| status | 点击行为 |
|---|---|
| signed_out / expired | 直接 signIn()（打开既有 OIDC 登录弹窗）；失败 → 展开菜单展示 store error |
| signing_in / loading | 忽略（防连点） |
| authenticated / offline_authenticated / refreshing | 弹菜单：会员中心 / 切换账号 / 退出登录 |
| disabled | 弹菜单 + 「身份服务未启用」说明，不直登 |
| error | 弹菜单（错误文本 + 登录/重试） |
- 菜单交互：点击外部/Esc 关闭、键盘方向键导航（复用 IdentityMenu 模式，抽 useDropdownBehavior composable）
- 侧边栏折叠态（≤900px）：保留头像、面板 left:0 展开、z-index 高于 workspace

### 2.3 菜单入口
- 「更多」菜单（MpSidebar moreItems）新增「会员中心」router-link → /member-center（未登录可进）
- IdentityMenu 补「会员中心」菜单项（与左上行为一致）；不改其既有行为与测试

### 2.4 i18n
- locales/zh.js + en.js 成对新增 memberCenter.* key；新文案一律走 i18n，禁止硬编码中文；`{daysRemaining}`/`{quota}` 等占位符 zh/en 完全一致

## 3. 验收标准
- 会员中心页面 4 种身份态（未登录/已登录/离线/disabled）均不白屏、数据正确
- 未登录点头像 → 登录弹窗出现；成功后状态刷新
- 已登录点头像 → 菜单三项可用；退出/切换后状态同步
- vitest 全通过；check-locale-sync.js --cjk 通过；pnpm run build:vue 通过
- 变更仅限 renderer：不动 electron/（无 QM-1 整包门禁）；zh/en 同提交成对变更

## 4. 文件清单
新增：
- apps/desktop/src/views/MemberCenter.vue
- apps/desktop/src/components/ProfileMenu.vue
- apps/desktop/src/composables/useDropdownBehavior.js
- apps/desktop/src/views/MemberCenter.test.js
- apps/desktop/src/components/ProfileMenu.test.js
- apps/desktop/src/composables/useDropdownBehavior.test.js
修改：
- apps/desktop/src/layouts/MpSidebar.vue（profile 区替换为 ProfileMenu + moreItems 加会员中心）
- apps/desktop/src/router/index.js（/member-center 路由）
- apps/desktop/src/stores/identity.js（normalizeState 透传 quota）
- apps/desktop/src/stores/identity.test.js（quota 透传断言）
- apps/desktop/src/layouts/MpSidebar.test.js（如有，更新断言）
- apps/desktop/src/components/IdentityMenu.vue（补会员中心项，P1）
- apps/desktop/src/locales/zh.js + en.js
- 01-docs/PRD.md、CHANGELOG.md、01-docs/learnings.md（文档更新在同一分支）

## 5. 实施计划与执行状态（M1-M4，已全部完成 ✅）

### M1 基础组件与 composable ✅
- composables/useDropdownBehavior.js + test（外点/Esc 关闭、上下键、Tab）
- components/ProfileMenu.vue + test（头像触发器：未登录直登/已登录菜单/disabled/error）

### M2 会员中心页面 ✅
- views/MemberCenter.vue + test（空态/账号/版本/权益/配额/升级/Pro 标记/disabled）
- router/index.js 注册 /member-center

### M3 入口接线与数据透传 ✅
- layouts/MpSidebar.vue：头像区换 ProfileMenu + 「更多」菜单加会员中心项；删除从未绑定点击事件的死 CSS .mp-profile 系列
- components/IdentityMenu.vue：已登录菜单加「会员中心」项 + goMemberCenter 路由跳转
- stores/identity.js：normalizeState 透传 entitlement.quota（此前 renderer 恒空）
- locales zh/en：memberCenter.* 54 键成对（含 {date}/{days} 命名插值）

### M4 门禁与文档 ✅
- tests/visual-testing/views/all-views.visual.test.js 注册 /member-center 单视图视觉门禁
- locale CJK 基线吸收行号漂移（1504/1504 PASS）；pnpm run build:vue 通过
- PRD v2.3.60 §2.3.3、CHANGELOG、learnings（6 条经验）、.quality-gates.md、review.md 已更新

> 执行状态（2026-08-27）：实现与验证全部完成；提交 76a61bae9（feat 实现）+ 0182b1bb9（docs/PRD v2.3.60）；PR #1197。
