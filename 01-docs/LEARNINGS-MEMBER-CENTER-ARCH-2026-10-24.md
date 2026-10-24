# 会员中心（member-center）架构与踩速查（2026-10-24 落地实录）

> 来源：member-center-revamp 任务（PRD：`01-docs/PRD-MEMBER-CENTER-REVAMP-2026-10-24.md`）
> 用途：后续会话接触会员中心/支付/权益链路时先读这份，避免重复核实。

## 1. 服务端契约真源

| 项 | 位置 | 要点 |
|---|---|---|
| 档位矩阵 | `packages/api-publish-engine/src/auth/plan-matrix.js` | `PLAN_IDS = free/standard/pro` 三档；`PLAN_RANK = {free:0, standard:1, pro:2}` **独立于 BASE_MATRIX 且不可被 overrides 覆盖**；`entitlement.limits.plan_rank` 已透传渲染层（#4051） |
| quota 派生 | 同上 `getPlanEntitlement` | 键形 **`${feature}_monthly`**：`cloud_publish_monthly` / `ai_write_monthly` / `video_create_monthly` / `official_credit_monthly`。⚠️ 测试 mock 里的 `credits/used` 是自造形状，**不得作为 i18n 键设计依据** |
| 兑换码校验 | 同上 `subscription-service.js:14` | `REDEEM_CODE_PATTERN` 字母表 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（排除易混淆字符 I/L/O/0/1），4-4-4 形如 `ABCD-EFGH-JKMN`；前端镜像常量在 `apps/desktop/src/views/member-center/constants.js` |
| 到期宽限 | 同上 `PLAN_EXPIRY_GRACE_DAYS = 7` | `entitlement.graceUntil`（ISO）+ `previousPlan`；到期后 7 天只读 + 队列收尾，**配额按免费档**——UI 必须中性态展示，禁止渲染成正式权益 |
| 支付链路 | `auth/payment-providers/` + `subscription-payment.js` | 唯一前端入口 `Subscription.vue` 的 `openPay(plan, period)` → `WeChatPayDialog`（defineAsyncComponent 懒加载）；IPC 命名 **`wechatPay*`**（刻意避开 `buyout-removal.contract.test.js` 的 `/\bpayment[A-Z]\w+/` 买断形态锁） |

**渲染层铁律**：档位判定永远以 `entitlement.limits.plan_rank` 为准；禁止硬编码档位名单、禁止读本地 `licenseStore`（本地授权与服务端权益是两套真源，A2 早已定论同源展示 entitlement）。

## 2. preload 权限层（unhandled rejection 高发区）

`electron/preload/access-control.js`：`identitySessions` / `identitySessionsRevokeOthers` / `identityNotifications` / `identityNotificationsMarkRead` / `identityRedeemCode` **不在 PUBLIC_METHODS**，权限不足时 :141-146 **同步 throw `LicensePermissionError`**；而 `api/electron-bridge.js` 的 `invoke` 是 async 函数 ⇒ 同步 throw 变 **rejected promise**。store 侧不兜 = unhandled rejection + UI 零反馈。正解模式见 `apps/desktop/src/stores/member.js` 的 `safeInvoke(channel, payload, onError)`。

## 3. 本次落地踩坑（每条都付出过调试成本）

1. **CCG pre-commit 钩子与 pathspec 冲突**：钩子无条件 `git add` 整个 `.ccg/reviews/`，会把其他会话的未跟踪快照扫进提交；amend 也无法摆脱（每次提交重新 add）。绕开：`GIT_INDEX_FILE=<tmp> git read-tree HEAD` + `git add <我的文件>` + `git commit-tree`（不经 pre-commit）。**值得排期修钩子本体**。
2. **vue-router mock 必须同时提供 `useRouter` 和 `useRoute`**——缺一个整个测试文件红（`No "useRoute" export is defined on the mock`）。
3. **vi.mock 工厂返回普通对象不会触发 computed 更新**：Vue 响应式只跟踪 reactive/ref。回调内改值后断言失败的，把 mock 对象包 `reactive({...})`。
4. **safeInvoke 的 error 覆盖陷阱**：safeInvoke 捕获抛错并落好错误码，调用方接着 `if (!responseOk(response)) return setError(response)` 会把权限码覆盖成通用码。正解：`if (response === null) return false` 先行拦截抛错路径。
5. **immediate watch 的 TDZ**：`watch(..., { immediate: true })` 的 source 在 watch 创建时立即求值，引用文件后方 const 会 ReferenceError。immediate watch 必须放在被引用 const 之后。
6. **删 Vue 组件必须同步清两处机械登记**：`src/clickable-roles.contract.test.js` 的 `LEDGER` 数组（按 key 删）+ `src/icon-usage.test.js` 的 `FILES` 收敛清单（对清单内文件逐个 `readFileSync`，删文件不删登记 = ENOENT 整套件红）。

## 4. 视觉回归口径（member-center 场景）

- 本次 Subscription.vue 的新样式是**从无到有的 scoped 新增**，不修改既有共享规则 ⇒ 不存在「影响其他页面」的回归面。
- 壳层移除 plans/redeem 区块导致其他 tab 布局变化——这是**预期的结构变化**（方案 P0-1 的目标），不是回归；判据用壳层结构锁测试（`member-center-plans` testid 不得存在）而非像素比对。
- 若后续修改 `styles/member-center.css` 既有规则，按 AGENTS.md 像素门禁四步：选择器差集真实页面命中数 → 带 e2e 夹具采控制台 → 同态连拍互比 → 逐元素计算样式签名对比。
