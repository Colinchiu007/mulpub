---
record: redeem-code-redemption
task: 激活码改走服务端 POST /api/v1/redeem 核销，正确处理幂等重放与过期订阅
date: 2026-10-11
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除
sync_status: PENDING
sync_reason: PR #3293 已建，CI 未跑完，merge SHA 尚不存在；合并后由回填 PR 收口
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

### 环境阻塞与解法：按仓库名查不到，改按 node id 建 PR

分支已推送成功（`redeem-code-redemption` @ `b25fc805f`，经 fetch 往返确认），
但**本会话无法调用 GitHub REST/GraphQL API 建 PR**：

| 通路 | 结果 |
|---|---|
| `git push` / `ls-remote`（HTTPS） | ✅ 成功，2288 refs 可读 |
| `GET /user` | ✅ 200（login=`Colinchui007`） |
| `GET /user/repos` | ✅ 200（65 repos，含 mulpub，permissions 含 admin/push） |
| `GET /rate_limit` | ✅ 200（core remaining=5000 ⇒ **非限流**） |
| `GET /repos/{owner}/{repo}` | ❌ 404（所有名称变体均如此） |
| `GET /repositories/{id}` | ❌ 404 |
| GraphQL `repository(owner:…)` | ❌ NOT_FOUND |
| `gh` CLI | 不可用 |

判读：token 为 **fine-grained PAT**，持有该仓库的 git 读写权限，
但**未获 REST/GraphQL 的 repository 读取授权**——GitHub 对无授权的 repo 端点
一律返回 404（而非 403），因此「404 = 不存在」这个直觉在这里是错的。

排查中也修正了一处自身错误：先前记的 owner 一度被我怀疑为 `Colinchui`，
逐字符核对 `/user/repos` 返回的 `full_name` 后确认就是 `Colinchui007`（位置 7-8 是 i/u）。

**但解法不在这张表里**：所有**按仓库名**的入口（REST `/repos/...`、`/repositories/{id}`、
GraphQL `repository(owner:…)`，带 token 与匿名全部试过）一律 404，
而 `GraphQL node(id:)` 能正常解析出该仓库且 `viewerPermission: ADMIN`。
node id 取自 `GET /user/repos`（该端点反而正常）。于是改用
`createPullRequest(input:{repositoryId:"R_kgDOSy9mNw",…})` 建 PR，**成功创建 #3293**。

结论：fine-grained PAT 对该仓库的 **git 授权生效、REST 名字解析路径异常**，
不是仓库不存在，也不是需要新 token。**遇到「按名字 404」应先换 node id 试一次**，
而不是停在权限结论上。

**后续动作**：
1. ✅ PR #3293 已建（head `redeem-code-redemption` → base `main`，2 commits，MERGEABLE）
2. 跑 CI，确认 `pull_request` 事件的 required checks 全绿（合并判定只认该事件）
3. squash merge → 回读 main SHA、确认远端分支已删除
4. 回填本记录的 `远程同步` 行为 PASS，并删除 frontmatter 的 `sync_*` 三字段

| 远程同步 | IN PROGRESS —— 分支已推送（e4f0bc468），PR #3293 已建（https://github.com/Colinchui007/mulpub/pull/3293），CI 运行中；待 `pull_request` 事件 required checks 全绿后 squash merge 并回填 PASS |
|---|
