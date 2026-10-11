---
record: redeem-code-redemption
task: 激活码改走服务端 POST /api/v1/redeem 核销，正确处理幂等重放与过期订阅
date: 2026-10-11
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 收口
sync_backfill_owner: 下一会话的回填 PR
---

## 本次执行记录：激活码服务端核销（redeem-code-redemption，2026-10-11）

> 分支：`redeem-code-redemption`（base `c41ca0436`）；`classify-docs-only` → **docs-only=false**
> 规模：12 文件 / +405 行 ⇒ **M** ⇒ CCG 判定 **DUAL** → 双模型 CLI 沙箱不可用 ⇒ **降级 SELF-REVIEW**（下方如实记录）

### 为什么必须做

#3085 已把正式构建的 `license:activate` 堵上（任意非空激活码可换永久 Pro）。
但那只堵住了本地路径，**服务端 `POST /api/v1/redeem` 从未被桌面端调用过**——
激活码对正式用户等于完全不可用。本次补齐最后一段链路。

### 服务端真实契约（逐条读代码确认，非推测）

| 项 | 事实 | 出处 |
|---|---|---|
| 路由/方法 | `POST /api/v1/redeem`（仅 POST） | `publish-api-server.js:919` |
| scope | `profile:write` | `publish-api-server.js:461` |
| 请求体 | `{ code }` | `publish-api-server.js:925` |
| 成功体 | `{ success: true, ...redeemResult }` | `publish-api-server.js:926` |
| 错误体 | `{ error: "<语义码>", message }`，**error 是扁平字符串** | `publish-api-commerce.js:8` |
| 错误码 | `REDEEM_CODE_FORMAT/NOT_FOUND/USED/DISABLED/EXPIRED` | `member-commerce-api.test.js:370-375` |

**踩过的坑**：我第一版测试把错误体写成 `{ error: { code, message } }`，
结果 `member-api-service` 取不到语义码、静默退化成 `MEMBER_API_REQUEST_FAILED`。
**服务端是扁平字符串**，写成嵌套对象测试会假绿。

### 关键设计决定

1. **必须区分首次成功 / 幂等重放 / 幂等且订阅已过期**。
   服务端在「同码重放且订阅已过期」时返回 **HTTP 200 + `subscription: null`**，
   既不是失败也不是开通。只判 `code === 0` 就显示「兑换成功」= 对用户发假承诺。
   store 因此返回 `idempotent` + `hasActiveSubscription` 两个独立字段，而非合成 success 布尔。

2. **未登录在本地短路**（`requireSubject: true`）。激活码是一次性资源，
   未登录请求走到服务端只会白跑一趟再拿 `BUSINESS_USER_REQUIRED`。
   **只给 redeem 加**，读通道（sessions/notifications）维持原语义，并加回归守卫用例锁住这点。

3. **三层白名单**：路径 + HTTP 方法（`ME_API_PATHS`）+ body 形状（IPC 层只放行 `code`）。
   renderer 是不可信输入源，未来加字段时不该顺手整包透传。

### 测试与变异验证

新增 23 个用例，本地全绿（`identity.test.js` 13 + `member-api-service.test.js` 10）。

沙箱无 vitest/ESLint/pnpm workspace，故写最小 vitest shim 真跑（非跳过断言）：

| 变异 | 结果 |
|---|---|
| body 白名单改成整包透传 | ❌ 红（2 例）|
| 去掉 `requireSubject` 短路 | ❌ 红 |
| `/api/v1/redeem` 加进 GET 白名单 | ❌ 红 |
| 把 `subscription: null` 抹成 `{}` | ❌ 红（2 例）|

store 三态归一化用**真实 `member.js` 源码**（剥 import + defineStore 桩）跑 6 例全绿，
非复制粘贴副本——复制品验证的是复制品。

### preload bundle（提交物）手工同步

`index.bundle.js` 手工同步，已双重验证：

- 与 main 的 identity API 面差异**恰好 +1**（`identityRedeemCode:`）
- bundle 内形态与 esbuild 产出一致（`ipcRenderer2` 重命名 + 双引号风格）
- 递归 API 面差 5 个方法（`paymentComplete`/`proxyTest` 等）经查为
  `access-control.js` 的 `ADMIN_ONLY_METHODS` **运行时剥离**，非缺失；本次未触碰相关文件

`preload.test.js` 顶层键基线 **343 → 344**，用与测试完全同构的 7 工厂聚合方式本地实算得出
（直接改数字而不验证增量 = 上一轮踩过的坑）。

### 未验证项（诚实登记，依赖 CI 兜底）

- `eslint`（Gate 11）：沙箱无。已做 no-undef 静态扫描 + 逐个核对标识符来源，全为误报。
- `vitest` 全量、`build-preload.test.js`（esbuild / expect-type 缺失）、`check-locale-sync --py-cjk` 已在本地跑通者除外。
- `.vue` SFC 无法在沙箱真解析（无 vue compiler）：已做括号平衡 + 标识符定义 + 模板引用齐全性静态检查，**语法验证依赖 CI**。

### CCG 评审降级说明

安全相关 + 中等规模 ⇒ 规则要求双模型交叉评审。**沙箱双模型后端不可用**，
本次为 **SELF-REVIEW（单人自审，降级）**，不冒充外部评审。
自审重点：权限边界（withSenderCheck / subject / scope）、三层白名单、
幂等与 null 订阅语义、竞态（`canSubmitRedeem` + `finally` 恢复按钮）。

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（无 UI 截图产物），仅改既有会员中心页面的一个区块 |
| QM-2 静态门禁（21 项本地可跑子集） | PASS | check-debt-budget / gate-record-debt / text-encoding / no-brand-residue / max-lines / locale(cjk,keys,py-cjk,pair-base) 全绿 |
| QM-3 单元测试 | PASS（本地 shim）/ 待 CI | `identity.test.js` 13 + `member-api-service.test.js` 10 + store 三态 6 全绿；真实 vitest 待 CI |
| QM-6 CCG 双模型外部评审 | **未执行（降级 SELF-REVIEW）** | 沙箱双模型后端不可用，如实降级，不冒充外部评审 |

### 遗留（不假装已闭合）

- **购买入口仍关闭**：本次只做激活码核销，`paymentChannelUnavailable` 未动。
- **`preload.test.js` 基线 343 → 344**：只加了 `identityRedeemCode` 一键，
  并补 `toContain` 反断言防止「改了数字但方法没接上」。
- **`.vue` SFC 语法未在沙箱真解析**（无 vue compiler），依赖 CI 的 rollup 阶段兜底。
- **eslint 未执行**（沙箱无依赖），已做 no-undef 静态扫描替代，CI Gate 11 为准。

| 远程同步 | PENDING —— 本 PR 尚未合并，merge SHA 尚不存在；合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI' 回填 merge SHA 并删除 frontmatter 的 sync_* 三字段 |
|---|
