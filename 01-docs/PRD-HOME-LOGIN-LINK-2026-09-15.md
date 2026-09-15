# PRD：主页未登录问候语「请登录」可点击链接

> **日期**: 2026-09-15 | **版本**: v1.0 | **状态**: 已实现（分支 `home-login-link`）
> **类型**: UI 交互优化（P1）| **影响范围**: `apps/desktop/src`（渲染端，无主进程 / IPC / 后端改动）
> **关联文档**: `01-docs/PRD.md`（首页模块）、`01-docs/ARCH-F14-logto-user-system.md`（身份体系）

---

## 1. 背景与问题

主页（`/` 路由，`views/Home.vue`）欢迎区在**未登录**状态下渲染为「中午好，登录」。其中「登录」二字来自
`stores/identity.js` 的 `displayName` 兜底值（未登录时返回 `'登录'`），存在三个问题：

| # | 问题 | 影响 |
|---|------|------|
| 1 | 文案歧义 | 「中午好，登录」读起来像问候语 + 一个动词，用户无法理解「登录」指的是当前状态还是可执行动作 |
| 2 | 无交互入口 | 「登录」是纯文本（`<h2>` 内插值），未登录用户在主页没有任何直达登录窗口的入口，只能绕道侧边栏底部头像 |
| 3 | 不可发现性 | 主页是应用首屏，登录引导的缺失直接抬高了新用户的注册/登录转化摩擦 |

## 2. 目标与非目标

### 2.1 目标

- G1：未登录状态下，问候语由「中午好，登录」改为「中午好，**请登录**」。
- G2：「请登录」渲染为**可点击链接**（区别于周围纯文本的视觉样式 + 手型光标）。
- G3：点击「请登录」后**直接弹出登录窗口**（Logto OAuth，由主进程承载），无需中间确认框。
- G4：登录成功后主页自动切换为「问候语 + 用户昵称」，无需刷新页面（复用身份状态响应式）。
- G5：身份服务不可用（`disabled`）时**不提供登录入口**（fail-closed，与侧边栏 `ProfileMenu` 降级策略一致）。

### 2.2 非目标

- 不改动登录窗口本身的实现（`AuthViewManager` / Logto OAuth 流程）。
- 不改动 `useLoginGate`（主动操作登录门，带确认框）的既有行为——本功能是「显式登录意图」，直接进入登录。
- 不改动已登录态的问候语展示（「中午好，昵称」）。
- 不新增 IPC 通道 / preload 方法 / 主进程服务（零契约变更，规避 4 处契约快照同步成本）。

## 3. 身份状态 × 渲染矩阵（核心逻辑）

问候语区由新组件 `components/HomeGreeting.vue` 承载，按身份状态决定渲染内容：

| `identityStore.status` | `isAuthenticated` | 渲染内容 | 可点击 |
|------------------------|-------------------|----------|--------|
| `authenticated` / `refreshing` / `offline_authenticated`（已有 `user.sub`） | `true` | `{{greeting}}，{{用户昵称}}` | 否（纯文本昵称） |
| `signed_out` | `false` | `{{greeting}}，`**请登录** | **是** → 弹登录窗口 |
| `expired` | `false` | `{{greeting}}，`**请登录** | **是** → 弹登录窗口（重新登录） |
| `error`（无会话） | `false` | `{{greeting}}，`**请登录** | **是** → 尝试登录；失败走提示 |
| `signing_in` | `false` | `{{greeting}}，`**请登录** | 是，但点击被 `loading` 守卫忽略（防重入） |
| `signing_out` | `false` | `{{greeting}}，`**请登录** | 同上 |
| `disabled`（身份服务未配置） | `false` | `{{greeting}}，{{displayName 兜底}}` | **否**（不渲染链接，fail-closed） |

判定表达式（与 `ProfileMenu.vue` 的 `handleTriggerClick` 口径对齐）：

```js
const showLoginEntry = computed(() =>
  !identityStore.isAuthenticated && identityStore.status !== 'disabled'
)
```

## 4. 功能逻辑

### 4.1 组件拆分

| 文件 | 变更 | 说明 |
|------|------|------|
| `components/HomeGreeting.vue` | **新增** | 欢迎区问候语子组件：问候语 + 登录链接/昵称 + 副标题；持有全部登录入口逻辑 |
| `views/Home.vue` | 修改 | 模板中问候语块替换为 `<HomeGreeting />`；移除 `greetingText`/`displayName` 计算属性与 `useIdentityStore` 依赖；移除问候语 CSS（随组件迁移） |

> 拆分动机：`Home.vue` 原 495 行，直接内联新增代码会突破 **500 行债务熔断**
> （`scripts/check-debt-budget.js`，`filesOver500` 计数不得超基线）。拆分后 `Home.vue` 470 行，新组件约 90 行。

### 4.2 点击处理（`handleLoginClick`）

```
用户点击「请登录」
  → 守卫 1：identityStore.loading === true → 直接 return（signIn 内部 runExclusive 也会拒绝，双保险防重入）
  → identityStore.signIn()
      → IPC identity:sign-in → 主进程 AuthViewManager 打开 Logto OAuth 登录窗口
      → 登录成功 → applyState(authenticated) → onIdentityStateChanged 推送 → 主页响应式切换为昵称
  → 结果判定：
      ok === false 或 登录后 isAuthenticated 仍为 false
        → notifyWarning('loginGate.loginIncomplete') → 提示「登录未完成，操作已取消」
  → 异常（signIn 理论上内部已 catch，此处兜底）：
        → reportError('home login entry failed', e) 上报日志
        → notifyWarning('loginGate.loginIncomplete') 兜底提示
```

### 4.3 数据校验与防御点

| 校验点 | 规则 | 失败行为 |
|--------|------|----------|
| 重入守卫 | `loading === true` 时点击无效 | 静默忽略（无重复 OAuth 窗口） |
| 状态守卫 | `status === 'disabled'` 不渲染链接 | 无入口（fail-closed，不弹「必然失败」的登录） |
| 登录结果 | `signIn()` 返回值 + `isAuthenticated` 双重判定 | 仅以真实状态为准，不信返回值单方面 |
| 异常兜底 | `try/catch` 包裹全流程 | 上报日志 + 用户提示，不抛出到全局 |
| i18n 回退 | `displayName` 为空时回退 `t('home.user')` | 不渲染空字符串 |

## 5. 显示项与提示文字（i18n）

新增用户可见文案一律走 locale（zh/en 成对提交，`check-locale-sync.js --cjk / --keys` 门禁）：

| i18n key | zh | en | 用途 |
|----------|----|----|------|
| `home.pleaseLogin` | 请登录 | Sign in | 未登录态问候语链接文本 |
| `home.greetings.*` | 夜深了/早上好/中午好/下午好/晚上好 | Late night/Good morning/Good noon/Good afternoon/Good evening | 问候语（复用，未改动） |
| `home.user` | 用户 | User | `displayName` 为空的兜底（复用） |
| `home.subtitle` | 多平台内容一键发布 | Publish everywhere with one click | 副标题（复用） |
| `loginGate.loginIncomplete` | 登录未完成，操作已取消 | （复用既有 key） | 登录未完成时的 warning 提示 |

最终渲染效果（未登录）：

```
中午好，请登录          ← 「请登录」为主题色 #5048e5 加粗链接，hover/聚焦变深 + 下划线
多平台内容一键发布      ← 副标题不变
```

### 5.1 视觉与无障碍规格

| 项 | 规格 |
|----|------|
| 颜色 | 常态 `#5048e5`（与主按钮同色系）；hover / `:focus-visible` `#3f37c9` + 下划线 |
| 字重 | 600（与标题同级，弱化「误以为是标题一部分」的歧义） |
| 光标 | `pointer` |
| 焦点可达性 | 原生 `<a href="#">` 元素，`@click.prevent` 阻止 hash 跳变；键盘 Tab 可聚焦 |
| 忙碌状态 | `:aria-busy="identityStore.loading"`，登录进行中向读屏器声明 |
| 测试锚点 | `data-testid="home-login-link"`；容器 `data-testid="home-greeting"` |

## 6. 交互流程（时序）

```
渲染端                          主进程                          Logto
   │ 点击「请登录」                 │                               │
   ├─ signIn() ──IPC sign-in────→ │                               │
   │                              ├─ 打开独立登录 BrowserWindow ──→ │
   │                              │←── OAuth 授权回调 ─────────────┤
   │                              ├─ 写 identity-session.json      │
   │←─ onIdentityStateChanged ────┤ (status=authenticated)         │
   │  displayName 变为用户昵称      │                               │
   │  链接消失，问候语变「中午好，昵称」│                               │
```

用户在登录窗口中途关闭 / 取消 → 主进程回调 `error/signed_out` → 渲染端 `signIn()` 返回 `false` → warning 提示，链接保持可再次点击。

## 7. 测试覆盖（`views/Home.test.js`，19 例全绿）

| 用例 | 断言 |
|------|------|
| 已登录不渲染链接 | `home-login-link` 不存在；显示昵称「测试用户」 |
| 未登录渲染链接 | `status=signed_out` → 链接存在、文本为「请登录」、整句含「，请登录」+ 问候语 |
| 点击触发登录 | 点击后 `identityStore.signIn` 恰好调用 1 次（弹登录窗口） |
| disabled fail-closed | `status=disabled` → 链接不渲染、`signIn` 未被调用 |
| 登录未完成提示 | `signIn` 返回 `false` → `notifyWarning('loginGate.loginIncomplete', …)` |
| loading 防重入 | `loading=true` 时点击 → `signIn` 不被调用 |
| 回归 | 问候语/副标题/快捷入口/平台标签/统计/近期动态/英文 locale 等既有 13 例不变 |

门禁验证：`check-debt-budget.js` ✅（86 = 基线 86）· `check-locale-sync.js --cjk / --keys` ✅ · `check-frontend-consistency.js` ✅
关联回归：`ProfileMenu.test.js` 17 例、`identity.test.js` 17 例、`useLoginGate.test.js` 8 例全绿。

## 8. 验收标准（QA 口径）

- [ ] AC1 未登录启动应用 → 主页显示「（时段问候语），请登录」，「请登录」为可点击链接样式
- [ ] AC2 点击「请登录」→ 弹出独立登录窗口（Logto OAuth），主页无中间确认框
- [ ] AC3 完成登录 → 窗口关闭，主页问候语自动变为「（时段问候语），昵称」，链接消失
- [ ] AC4 中途关闭登录窗口 → 主页出现「登录未完成，操作已取消」提示，链接仍可再次点击
- [ ] AC5 连续快速双击链接 → 只弹出一个登录窗口
- [ ] AC6 身份服务未配置（`disabled`）→ 主页只显示问候语 + 兜底文案，无链接
- [ ] AC7 英文 locale → 显示「Good afternoon, Sign in」（文案随 locale 切换）
- [ ] AC8 已登录用户 → 主页不出现「请登录」，行为与改动前完全一致

## 9. 已知限制与后续建议

| 项 | 说明 | 建议 |
|----|------|------|
| `displayName` 兜底词仍为「登录」 | `stores/identity.js:176` 未改动（影响侧边栏等多处消费方，本次不动） | 后续统一切到 i18n key 并改为中性词（如「未登录」），需单独评估侧边栏/会员中心影响 |
| 主页其余「未登录引导」未增强 | 统计卡、快捷入口在未登录时仍展示（与既有设计一致） | 如需登录墙，应走 `useLoginGate` 渐进式门禁而非硬拦截 |
| 问候语时段边界 | `<6 夜深 / <12 早上 / <14 中午 / <18 下午 / 其余晚上`，跨午夜使用无「凌晨」文案 | 低优先级，可并入 i18n 文案迭代 |
