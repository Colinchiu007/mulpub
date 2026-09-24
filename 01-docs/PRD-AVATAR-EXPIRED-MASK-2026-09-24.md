# PRD：账号登录态失效改为「头像遮罩」呈现

- 日期：2026-09-24
- 类型：UI/UX 显示规则变更（非功能新增，不改变判定逻辑）
- 关联 PRD：`PRD-ACCOUNT-LOGIN-STATE-PERSISTENCE-2026-09-23.md`（三态判定与真源，本文只改「显示载体」，不改判定）
- 关联文档：`UI-INVENTORY.md` §6.7、`CHANGELOG.md`
- 交付形态：独立分支 `codex/avatar-expired-mask` + worktree `D:\Data\projects\mp-worktrees\mp-avatar-expired-mask`，经 PR 与 CI 后 squash 合并 main

---

## 1. 需求原文与拆解

用户报告（2026-09-24，附目标效果图）：

> 当自媒体账号的登录态失效时，头像的图片上加上遮罩效果并加文字"已失效"。现有的已失效时头像附近显示的"已失效"文字，就不再显示了。有登录态的"已登录"的文字显示仍保留。

拆解为三条可验证规则：

| 编号 | 规则 | 验收方式 |
|------|------|----------|
| **R1** | `status` 判定为失效（`expired`）时，头像图片上叠加半透明遮罩带，遮罩内白字「已失效」 | E2E 计算样式 + 几何断言；单测类名/文案断言 |
| **R2** | 失效态下，头像旁（头像下方/右侧）的旧「已失效」徽章**不再渲染**——同一信息只出现一次 | 失效卡片内 `.login-badge` 数量必须为 0 |
| **R3** | 有登录态（`online`）的「已登录」徽章**保持原样**，头像不加遮罩 | 有效卡片 `hasMask === false && badgeCount === 1 && text === '已登录'` |

### 1.1 范围界定（刻意不扩大的部分）

遮罩只代表**失效**这一种状态。其余状态维持「头像旁徽章」的既有载体，理由：

- 需求原文只提到「已失效」；把遮罩泛化到未确认/异常会改变用户对琥珀色/红色徽章的既有心智。
- 遮罩的语义是「这个账号现在不能用了」，而 `unverified`（未确认）/`error`（异常）/`unknown`（暂无检查记录）表达的是「我们不知道」，用同一视觉会构成误导。

| kind | 触发 status | 文案（zh / en） | 载体 | 配色 |
|------|-------------|-----------------|------|------|
| `online` | `active` / `online` | 已登录 / Logged in | 头像旁徽章（R3 保留） | 绿 `#e7f7ef / #18794e` |
| **`expired`** | `expired` | **已失效 / Invalid** | **头像遮罩（R1），徽章消失（R2）** | 遮罩底 `rgba(0,0,0,.55)` + 白字 |
| `unverified` | `unverified` | 未确认 / Unconfirmed | 头像旁徽章（不变） | 琥珀 `#fffaf0 / #974706` |
| `error` | `error` / `failed` / `failure` | 异常 / Error | 头像旁徽章（不变） | 红 |
| `unknown` | 空值 / 脏值（`inactive`、`offline` 等） | 暂无检查记录 / No check record | 头像旁徽章（不变） | 灰 |

---

## 2. 交互与数据流程

```
后端账号记录 status（唯一真源，见 PRD-ACCOUNT-LOGIN-STATE-PERSISTENCE §3）
   │  accountList IPC（publicAccountFields 白名单含 status / status_source）
   ▼
Accounts.vue 拉取列表 → 渲染 AccountManagementCard（网格视图 / 列表视图共用同一组件）
   │
   ▼
accountStatusKind(account)  ← 归一化：trim + toLowerCase，词表外一律 unknown
   │
   ├─ kind === 'expired' ──→ showAvatarMask = true
   │                            ├─ .account-avatar 加 has-status-mask 类
   │                            ├─ 头像内渲染 <span class="avatar-status-mask expired">已失效</span>
   │                            └─ 头像旁 <span class="login-badge"> 不渲染（v-if="!showAvatarMask"）
   │
   └─ kind !== 'expired' ──→ showAvatarMask = false
                                ├─ 头像内不渲染遮罩
                                └─ 头像旁 <span class="login-badge {kind}"> 照常渲染
```

判定逻辑（`accountStatusKind`）**完全未改动**，本次只改「用哪个节点承载状态文字」。

---

## 3. 功能逻辑规格

### 3.1 状态载体分流（`AccountManagementCard.vue`）

```js
const statusKind = computed(() => accountStatusKind(props.account))
const showAvatarMask = computed(() => statusKind.value === 'expired')
const statusAriaLabel = computed(() =>
  t('accountsPage.accountCardLabels.accountLoginStatus', { status: statusLabel(props.account) }))
```

- `showAvatarMask` 是**唯一**分流开关，模板中遮罩用 `v-if="showAvatarMask"`、徽章用 `v-if="!showAvatarMask"`，二者互斥且穷尽 → 不可能同时出现（R2 由结构保证，不依赖 CSS 隐藏）。
- `statusAriaLabel` 提取为 computed 供两个载体共用，避免两种状态下的无障碍名称措辞漂移。

### 3.2 与「头像加载失败回落」的共存（不可回退项）

`#2290` 引入的 `showAvatar`（`avatarBroken` 为真时回落 `<UserFilled/>` 占位图标）必须与遮罩独立生效：

- 遮罩挂在 `.account-avatar` 容器上，**不挂在 `<img>` 上**；
- 因此 `<img>` 因 404/网络失败被 `v-if` 移除后，占位图标 + 遮罩 + 「已失效」仍然完整显示；
- 该交互由单测 `头像图片加载失败回落占位图标时，失效遮罩仍然显示` 锁死（触发 `img` 的 `error` 事件后断言 `img` 不存在、遮罩文本仍为「已失效」）。

### 3.3 显示项清单（失效卡片）

| 区域 | 变更 | 说明 |
|------|------|------|
| 头像容器 | 新增 `has-status-mask` 类；新增 `position: relative` | 作为遮罩的定位上下文；保留既有 `overflow: hidden` + 圆形裁切 |
| 头像图片 | 不变 | `width:100%; height:100%; object-fit: cover` |
| 遮罩带 | 新增 `.avatar-status-mask` | 见 §3.4 |
| 头像旁徽章 | 失效态**不再渲染** | 非失效态完全不变（含 `margin-top: -4px`、`border: 2px solid #fff`） |
| 账号名 / 粉丝 / 负责人 / 代理 / 最近检查 | 不变 | — |
| 操作区（设置 / 验证 / 删除 / 去登录） | 不变 | 失效态仍显示「去登录」入口，本次不动 |

### 3.4 遮罩视觉规格

| 属性 | 值 | 依据 |
|------|-----|------|
| `position` | `absolute` | 相对 `.account-avatar`（`relative`）定位 |
| `top` / `transform` | `top: 55%` + `translateY(-50%)` | 横带中心落在头像纵向 55% 处，对齐效果图「中部略偏下」 |
| `left` / `right` | `0` | 横向铺满头像直径，被 `overflow: hidden` 裁成弓形（与效果图一致） |
| `background` | `rgba(0, 0, 0, 0.55)` | 半透明黑，保证任意头像底色上白字对比度 ≥ 4.5:1 |
| `color` | `#fff` | — |
| `font-size` | `var(--font-size-xs, 12px)` | 走字号 token（CI `check-font-size-scale` 要求） |
| `line-height` / `padding` | `16px` / `1px 0` | 实测渲染带高 18px（62px 头像的 29%） |
| `text-align` | `center` | — |
| `white-space` | `nowrap` | 「已失效」三字不换行；短文案不会溢出成多行 |
| `pointer-events` | `none` | **不拦截点击**：卡片整体可点（打开创作者中心）、批量模式可勾选，遮罩不能变成点击障碍 |
| 语言适配 | 直接复用 `statusLabel()` | en 为 `Invalid`（7 字符）仍可在 60px 宽内单行显示 |

### 3.5 两种视图一致性

网格视图与列表视图共用同一组件，差异只在 CSS 布局方向（`Accounts.vue` 列表模式把 `.account-profile` 改为 `flex-direction: row`）。实测：

| 视图 | 头像盒 | 遮罩盒 | 结论 |
|------|--------|--------|------|
| 网格 | 62×62 @ (609,297) | 60×18 @ (610,322) | 遮罩水平居中、垂直落在圆内 |
| 列表 | 46.7×62 @ (661,325) | 44.7×18 @ (662,350) | 遮罩随头像宽度自适应铺满，仍无徽章 |

---

## 4. 无障碍与语义契约

| 项 | 值 | 说明 |
|----|-----|------|
| `data-testid` | `account-status-{id}`（**遮罩与徽章共用同一 testid**） | 既有 E2E（`account-login-state-tristate.js`）与单测按此 testid 取 innerText，载体切换对其透明，无需改动 |
| `role` | `status` | 与原徽章一致，屏幕阅读器在状态变化时播报 |
| `aria-label` | `账号登录状态：{文案}`（`accountLoginStatus`） | 与载体无关，失效态仍为「账号登录状态：已失效」 |
| 信息唯一性 | 失效态整卡内 `[data-testid="account-status-*"]` 节点数恒为 1 | 单测断言 `findAll(...).length === 1`，防止「遮罩 + 徽章」双份播报 |

---

## 5. 数据校验

本次无新增字段、无新增 IPC、无后端改动，校验沿用既有链路：

| 层 | 校验点 | 与本次的关系 |
|----|--------|--------------|
| IPC 入口 | `withSenderCheck` 校验 `senderFrame.url` 白名单；`getOwnerSubject()` 为空 fail-closed | 不变 |
| 下发字段 | `publicAccountFields` 白名单含 `status` / `status_source`；`login_check_error`、`status_reason` 经 `toPublicErrorValue` 脱敏 | 遮罩只读 `status`，不引入新字段 |
| 归一化 | `accountStatusKind`：`String(...).trim().toLowerCase()`，词表外（含 `null`/`undefined`/脏值 `inactive`/`offline`）→ `unknown` | **决定遮罩不误触发**：只有精确 `expired` 才出遮罩 |
| 头像值 | `account.avatar \|\| account.avatar_url`，空则回落占位图标；`@error` 置 `avatarBroken` | 遮罩不依赖 `<img>` 存在（§3.2） |
| 文案 | 全部走 locales（`statusExpired` 等），渲染层无硬编码中文 | CI Gate 7（`check-locale-sync.js --pair-base/--cjk`）保持 PASS，本次未改 locales |

---

## 6. 边界与异常场景

| 场景 | 期望行为 | 保护测试 |
|------|----------|----------|
| `status` 为脏值 `inactive` / `offline` | kind=`unknown` → 灰色「暂无检查记录」徽章，**不出遮罩** | 既有 `历史脏值 inactive / offline 不再谎称「已登录」` |
| `status` 为空 / 从未检测 | 同上 `unknown` | 同上 |
| `unverified` / `error` | 仍走琥珀/红徽章，**不吃遮罩语义** | 新增 `未确认与异常状态仍走徽章，不吃遮罩语义` |
| 头像 URL 加载失败（404/断网） | 占位图标 + 遮罩 + 「已失效」三者共存 | 新增 `头像图片加载失败回落占位图标时，失效遮罩仍然显示` |
| 无头像（`avatar` 为空） | 占位图标上仍叠遮罩（失效语义不丢） | 新增用例覆盖 `.account-avatar` 容器级遮罩 |
| 列表视图 | 规则与网格完全一致 | 新增 `遮罩样式契约` + E2E 列表视图断言 |
| 长文案（en `Invalid`） | `white-space: nowrap` 单行，容器 `overflow: hidden` 兜底裁切 | E2E 几何断言遮罩盒不超出头像盒 |
| 遮罩覆盖区域被点击 | `pointer-events: none` 穿透到卡片，不阻断打开创作者中心/批量勾选 | E2E 计算样式断言 `pointerEvents === 'none'` |
| 批量模式下多选 | 遮罩是纯展示层，不参与选中态 | 未改动选中逻辑 |

---

## 7. 测试矩阵

### 7.1 单元测试（`AccountManagementCard.test.js`，新增 5 条）

| 用例 | 锁定规则 |
|------|----------|
| `失效账号把「已失效」渲染为头像遮罩，头像旁不再出现徽章` | R1 + R2：类名含 `avatar-status-mask`/`expired`、文本「已失效」、`role=status`、aria 正确、`.login-badge` 不存在、同 testid 节点数 = 1、头像含 `has-status-mask` |
| `已登录账号保留头像旁的「已登录」徽章，头像不加遮罩` | R3 |
| `未确认与异常状态仍走徽章，不吃遮罩语义（遮罩只代表失效）` | 范围界定（§1.1），遍历 `unverified`/`error`/`unknown` |
| `头像图片加载失败回落占位图标时，失效遮罩仍然显示` | §3.2 与 #2290 共存 |
| `遮罩样式契约：头像为定位容器，遮罩绝对定位覆盖并自带半透明底` | §3.4 样式契约（JSDOM 不应用 scoped CSS，故读 `.vue` 源码断言，沿用 `Accounts.test.js` 既有惯例） |

同时把既有失效用例名中的「徽章」改为「状态」，避免用例名与新实现矛盾。

### 7.2 真实渲染层 E2E（新增 `apps/desktop/tests/e2e/specs/account-avatar-expired-mask.js`）

注入 `expired` + `active` 两个账号与内联 SVG 头像（不依赖外网，避免 CDN 抖动误判），一次 `evaluate` 取全 computed style 与 `getBoundingClientRect`，11 项断言：

1. 账号页加载、失效/有效卡片均渲染
2. 遮罩存在且文本「已失效」
3. `role=status` 与 `aria-label="账号登录状态：已失效"`
4. `position:absolute` + `background: rgba(0, 0, 0, 0.55)` + `color: rgb(255, 255, 255)`
5. 遮罩盒落在头像盒内，且头像 `overflow: hidden` + `position: relative`
6. 失效卡片 `.login-badge` 数量为 0（R2）
7. 有效卡片无遮罩、徽章数 1、文本「已登录」（R3）
8. 列表视图切换后规则一致
9. 零 console error / 零 page error
10–11. 截图存证 `01-expired-mask-and-active-badge.png`、`02-list-view-mask.png`

执行方式（需 dev server 在 `TEST_URL`，默认 `http://127.0.0.1:5174`）：

```
node tests/e2e/specs/account-avatar-expired-mask.js
```

> 与 `account-login-state-tristate.js` 同属独立 spec，未接入 `run-all.js` 的 ROUTE/FLOW 清单，按需本地/人工执行。

### 7.3 像素视觉门禁的适用性说明（如实记录）

`tests/visual-testing/scripts/run-pixel-tests.js` 含 `accounts-list` 视图，但仓库跟踪的 `base-screenshots` 仅 22 个基线且**不含 accounts-list**，本地亦无 baselines 目录 → 该视图在像素门禁下是「首次生成基线即通过」，抓不到本改动。因此本次以 §7.2 的**运行态计算样式 + 几何断言 + 截图目视**作为视觉证据，不以像素门禁通过作为依据。

---

## 8. 验收标准

- [x] R1：失效账号头像上出现半透明横带遮罩，白字「已失效」，随圆形头像裁切（E2E 断言 + 截图目视通过）
- [x] R2：失效账号头像旁不再出现「已失效」徽章（`.login-badge` 计数 0）
- [x] R3：已登录账号的「已登录」徽章保留，头像无遮罩
- [x] 未确认 / 异常 / 暂无检查记录三态显示不受影响
- [x] 网格视图与列表视图表现一致
- [x] 无障碍语义不丢失（`role=status` + `aria-label` + testid 唯一）
- [x] 定向单测：12 文件 252 passed / 2 skipped（vitest exit 0）
- [x] 真实浏览器 E2E：11/11 checks passed，零 console/page error
- [x] 静态门禁全绿：max-lines / debt-budget / brand-residue / locale-sync(cjk, pair-base, keys, py-cjk) / color-literals / css-var-defined / font-size-scale / vue-style-parse / frontend-consistency / hardcoded-secrets / scoped-root / route-registry
- [x] ESLint 0 error

---

## 9. 不做项与后续观察

| 项 | 原因 |
|----|------|
| 把遮罩推广到 `unverified` / `error` | 需求只覆盖失效；语义不同（§1.1） |
| 为 accounts-list 补像素基线 | 需固定字体/滚动条环境，全量 `UPDATE_BASELINE` 会把环境差烘进基线、抬高 CI 误报；本次以运行态断言替代 |
| 改「去登录」按钮文案或位置 | 不在需求范围 |
| 首页失效横幅、发布前校验提示 | 属另一显示面（`Home.vue` / 发布门禁），本次不动 |
| 观察项 | 若后续产品要求「未确认」也用头像载体（如问号角标），需重新设计 `showAvatarMask` 为 kind→载体映射表，而非再加布尔量 |
