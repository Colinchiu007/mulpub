# PRD：发布记录未登录门禁态 — 错误语义分流与登录引导

> **日期**: 2026-09-15 | **类型**: Bug 修复 + UX 语义修正 | **分支**: `publish-history-auth-gate`（worktree `mp-fix-publish-history-auth`）
> **关联**: `license-access-control.js`（IPC 权限门禁）、`PublishHistory.vue`（发布记录页）、`stores/identity.js`（登录体系）
> **状态**: ✅ 已实现，回归测试 23/23 通过

---

## 1. 背景与问题描述

**用户报告（2026-09-15，截图 electron.exe_20260915_140249.png）**：未登录状态下点击左侧边栏「发布」菜单，「发布记录」页内容区报错：

> **发布记录加载失败**
> 请检查服务连接后重试
> [重试]

而页面底部服务状态面板显示「2 项服务运行中」，桥接健康——**服务本身正常**，提示严重误导。

---

## 2. 根因分析（五环节证据链）

| # | 环节 | 位置 | 事实 |
|---|------|------|------|
| 1 | 页面挂载即拉取 | `PublishHistory.vue` `onMounted(loadRecords)` | 未登录也会自动调用 `historyList()` |
| 2 | IPC 走权限门禁 | `electron/ipc-handlers/license-access-control.js:97-106` | `history:list/get/delete`、`queue:*`、`dashboard:stats` 自 2026-08-11 起**有意要求登录**（不在 `PUBLIC_CHANNELS`，属 `LOGIN_ONLY_FEATURE_MAP` → `publish_history`） |
| 3 | 未登录 → 拒绝 | `license-access-control.js` `getAccessLevel()/hasAccess()` | 未登录时访问级别为 `public`，通道要求 `authenticated` → 返回 `{ code:-3, errorCode:'AUTH_REQUIRED', message:'当前许可证无权访问该功能，请先登录并确认账号已开通所需权益后重试。' }` |
| 4 | 渲染端丢弃语义 | `PublishHistory.vue` `normalizeRecords()` | 见 `code !== 0` 直接 `throw new Error(message)`，**errorCode 丢失** |
| 5 | catch 一刀切 | `PublishHistory.vue` `loadRecords()` catch | `errorMessage` 写死 `t('historyPage.checkService')` =「请检查服务连接后重试」→ 权限拒绝被伪装成网络故障 |

**引入点溯源（git 追溯）**：发布记录页 2026-09-11 重构新建（含 `checkService` 兜底）时，未感知 2026-08-11 收紧的 `history:*` 登录门禁；两者叠加形成本 bug。

**测试逃逸分析**：既有测试「加载失败时显示错误并允许重试」只覆盖 **reject 异常路径**（`mockRejectedValueOnce`），未覆盖「主进程 resolve 但 `code:-3` 业务拒绝」路径——门禁拒绝恰是后者，因此从未被抓到。

---

## 3. 产品决策

| 方案 | 说明 | 结论 |
|------|------|------|
| **A. 登录引导门控（采纳）** | `history:list` 保持需登录；未登录时展示明确的「登录后查看发布记录」引导态 +「去登录」按钮，不再误报服务连接失败 | ✅ 用户 2026-09-15 确认 |
| B. 本地只读放行 | 把 `history:list/get` 加入 `PUBLIC_CHANNELS`（owner 回退 `__legacy__`） | ❌ 未采用：扩大未登录可读面，权限语义变更需单独评审 |
| A+B 组合 | 默认登录引导 + 可切换本地浏览 | ❌ 未采用：改动面大，待产品验证需求 |

**与既有范式的关系**：视频创作历史（`story2video:list-projects`）走的是「本地只读放行」范式；发布记录是**账号维度业务数据**（`publish_history` 表按 owner 隔离），保持「登录即可」语义（`LOGIN_ONLY_FEATURE_MAP`），两者定位不同、不强制对齐。

---

## 4. 功能逻辑：错误语义分流规则

`loadRecords()`（仅首屏 `!append` 分支）对 `historyList()` 结果按以下优先级分流：

| 优先级 | 结果形态 | 判定 | UI 状态 | 显示 |
|--------|---------|------|---------|------|
| 1 | `{ code:0, data }` | 正常 | 记录列表 / 空态 | 原有逻辑不变 |
| 2 | `errorCode ∈ {AUTH_REQUIRED, NOT_SIGNED_IN}`，或 **无 errorCode 且 `code === -3`**（遗留兜底） | 登录门禁 | `loginRequired` 门禁态 | 登录引导（见 §6），**无重试按钮** |
| 3 | 其他非零 code（含 `ENTITLEMENT_REQUIRED`） | 业务拒绝 | 错误态 | 标题「发布记录加载失败」+ **具体原因**（`formatUserError` 映射，如「当前账号没有所需权益…」）+ 重试按钮 |
| 4 | IPC 调用抛异常（reject） | 传输/桥故障 | 错误态 | 标题「发布记录加载失败」+ 兜底文案「请检查服务连接后重试」+ 重试按钮 |

**数据校验要点**：
- `isAuthGateResult()` 必须**按 errorCode 判定**；`ENTITLEMENT_REQUIRED` 同样携带 `code:-3`，只看数值码会把它误判成登录门禁（实现过程中抓到并修正）。
- `normalizeRecords()` 抛错时在 error 对象上携带 `errorCode` 与 `userMessage`（`formatUserError(result, { fallback: checkService })`），catch 分支取 `e?.userMessage || t('historyPage.checkService')`——普通异常无 `userMessage`，行为与修复前完全一致（向后兼容）。
- 分页 `append` 失败保持原有「静默保留已加载数据」逻辑，不触发门禁检测（首屏已确认登录态）。

---

## 5. 交互逻辑与状态机

```
页面挂载 onMounted
   └→ loadRecords()：loading=true，清空 errorMessage 与 loginRequired
        ├→ code:0 ─────────────→ 记录列表 / 空态
        ├→ AUTH_REQUIRED ──────→ 门禁态（登录引导）
        │     └→ 点击「去登录」→ identity.signIn()（主进程 Logto OAuth，独立登录窗口）
        │           ├→ 登录成功 → watch(isAuthenticated) 触发 → 自动 loadRecords()（无需手动重试）
        │           └→ 用户取消 / 窗口关闭 → 保持门禁态，可再次点击
        ├→ 其他非零 code ──────→ 错误态（具体原因 + 重试）
        └→ 调用异常 ───────────→ 错误态（服务连接文案 + 重试）
```

- **登录成功自动重载**：`watch(identityAuthenticated, authed => { if (authed && loginRequired.value) loadRecords() })`，消除「登录完还要手点重试」的断点。
- **登录入口合规**：使用 `useIdentity()` 组合式函数的 `signIn`（内部即 `identityStore.signIn()`）——打开登录窗口的唯一正确入口；`status === 'disabled'` 的 fail-closed 语义由 identity 层自持，本页不重复处理。
- **重试按钮**：错误态保留 `retry-history`（行为不变）；门禁态不渲染重试（重试无意义，权限不会因重试获得）。

---

## 6. 显示项与提示文字（zh / en 成对，`historyPage` 命名空间）

| Key | zh | en | 用途 |
|-----|----|----|------|
| `loginRequiredTitle`（新增） | 登录后查看发布记录 | Sign in to view publish records | 门禁态标题 |
| `loginRequiredHint`（新增） | 发布记录与账号绑定，登录后即可查看本机的发布历史与任务状态。 | Publish records are tied to your account. Sign in to view publish history and task status on this device. | 门禁态说明 |
| `signInNow`（新增） | 去登录 | Sign in | 门禁态按钮 |
| `recordsLoadFailed`（既有） | 发布记录加载失败 | Failed to load publish records | 错误态标题 |
| `checkService`（既有） | 请检查服务连接后重试 | Please check the service connection and try again | 仅传输类故障兜底 + formatUserError fallback |
| `retry`（既有） | 重试 | Retry | 错误态按钮 |

**data-testid 清单**：`history-login-gate`（门禁态容器，`role="status"`）、`history-sign-in`（去登录按钮）、`retry-history`（重试，仅错误态）。

**样式**：门禁态复用 `.state-panel`（居中面板），按钮 `margin-top: 8px`；不引入新颜色 token。

---

## 7. 权限模型对照（未改动部分，明确边界）

| 通道 | 归属 | 未登录 |
|------|------|--------|
| `history:list` / `history:get` / `history:delete` | `LOGIN_ONLY_FEATURE_MAP` → `publish_history`（登录即可，暂不强制服务端 feature） | ❌ 拒绝（本次修复的是拒绝后的呈现） |
| `queue:status/history/cancel/retry`、`dashboard:stats` | 同上 | ❌ 拒绝（看板页如有同类误报，按同范式另行修复） |
| `story2video:list-projects`、`pipeline:history` 等 | `PUBLIC_CHANNELS`（本地只读） | ✅ 放行（不属本次范围） |

本次**零 IPC / preload / 主进程变更**，不触发「新增桥方法的 4 处契约快照同步」。

---

## 8. 测试覆盖（`PublishHistory.test.js`，23/23 通过）

| 用例 | 断言要点 |
|------|---------|
| 既有「加载失败时显示错误并允许重试」 | reject 路径行为不变（防回归） |
| 新增「未登录被门禁拒绝（AUTH_REQUIRED）时显示登录引导」 | 门禁态容器存在；含标题与「去登录」；**不含**「发布记录加载失败」「请检查服务连接后重试」；无重试按钮 |
| 新增「点击去登录触发 identity.signIn，登录成功后自动重载」 | 点击调用 `signIn` 恰 1 次；`isAuthenticated→true` 后 `historyList` 自动第 2 次调用；门禁态消失、记录渲染 |
| 新增「登录后权益不足（ENTITLEMENT_REQUIRED）显示具体原因」 | 非门禁态；标题仍为「发布记录加载失败」；正文为 formatUserError 映射的权益文案（zh/en 任一命中）；**不误报**服务连接；有重试按钮 |

测试基建：mock `@/composables/useIdentity`（`isAuthenticated` 用 `ref` 驱动 + `signIn` spy），`beforeEach` 复位 ref；新用例末尾 `wrapper.unmount()` 防 watcher 泄漏（否则前序用例仍挂载的组件会在 `isAuthenticated` 翻转时多发请求，造成断言不稳定）。

---

## 9. 门禁与验证快照

- `vitest run src/views/PublishHistory.test.js`：**23/23 通过**
- `check-locale-sync.js --keys`：PASS（968 个使用中 key 均存在于 zh/en）
- `check-locale-sync.js --cjk`：PASS（无新增硬编码中文）
- `eslint`（4 个改动文件）：0 errors（1 个既有 warning `openManualEntry`，HEAD 已存在，非本次引入）
- 债务熔断：改动文件均已在 500 行基线内，未把新文件推过阈值

---

## 10. 已知局限与后续项

1. **看板/队列页同类误报**：`dashboard:stats`、`queue:*` 同样要求登录，对应页面未登录时可能仍有误导文案，建议按本范式统一排查（P2）。
2. **append 分页失败**不区分门禁（首屏已确认登录，实际影响极小）。
3. **formatUserError 语言依赖运行环境**：测试对权益文案做了 zh/en 双语命中断言；如后续统一测试语言需同步调整。
4. 方向 B（本地只读放行）如产品后续需要，参照 `story2video` owner 隔离 + `__legacy__` 回退范式单独立项。
