# BUGFIX：账号页首开 10 秒后显示「暂无账号」（Logto JWKS 抖动被伪装成 401 并逐层放大）

- 报告编号：BUGFIX-ACCOUNT-PAGE-JWKS-RESILIENCE-2026-09-22
- 日期：2026-09-22
- 分支 / worktree：`codex/account-page-jwks-resilience` / `D:\Data\projects\mp-worktrees\mp-account-page-jwks-resilience`
- 严重级别：P0（账号主页面首屏不可用 + 展示语义与真实状态相反：把「这一帧取不到」显示成「一个账号都没有」）
- 关联文档：[PRD-F14-LOGTO-PRODUCTION-READINESS.md](./PRD-F14-LOGTO-PRODUCTION-READINESS.md)、[RUNBOOK-LOGTO-PRODUCTION.md](./RUNBOOK-LOGTO-PRODUCTION.md)、`01-docs/learnings.md`

---

## 1. 现象

启动应用后点「账号」：

1. 账号页转圈约 **10 秒**，最终显示 **暂无账号**（实际本机已有多个账号）；
2. 稍后再进同一页面，**瞬间**列出全部账号；
3. 后端日志同期出现 `AUTH_JWKS_UNAVAILABLE`。

「首开慢且空、二次秒开且全」的组合指向一个结论：**结果不是没有数据，而是取数据的那一次请求被上游拖死后失败，而失败被上层当成了空结果。**

## 2. 根因链（逐环节实测，非推断）

账号列表请求路径：渲染端 `stores/accounts.load()` → IPC `accounts:list` → `account-manager.listAccounts()` → `pythonBridge.requestBackend('GET','/api/accounts')` → Python 后端 `GET /api/accounts`（FastAPI 依赖 `LogtoJwtVerifier` 验签）→ Logto `/.well-known/openid-configuration` → `https://auth.iart.work/oidc/jwks`。

| # | 环节 | 实测事实 | 后果 |
|---|------|----------|------|
| 1 | JWKS 取键 | 每次取键 `async with httpx.AsyncClient(timeout=5)` **新建客户端**，无连接复用；本机走系统代理时 TCP+TLS 握手重复付费 | 单次抖动即 5~10s |
| 2 | 失败语义 | `AUTH_JWKS_UNAVAILABLE` 由 `AuthError` 统一按 **401** 返回 | 上游不可用被伪装成「你的令牌有问题」 |
| 3 | 主进程重放 | `requestBackend` 见 401 即 `forceRefresh` 令牌并**重放整条请求** | 同一个超时再付一遍：6s + 8s + 10.7s ≈ **25s** |
| 4 | IPC 返回 | 最终 `code=-503/-1, data=[]`；`account-manager` 抛错时**丢掉** `errorCode`/`status` | 渲染端无法区分「上游不可用」与「确实没有账号」 |
| 5 | 渲染端 | `load()` 的 else 分支静默 `accounts=[]` 且 **不设 `error`** | UI 显示「暂无账号」，无错误态、无重试入口 |
| 6 | 自愈 | JWKS 缓存 TTL 300s；下一次拉取成功后命中缓存 | 二次进入秒开——掩盖了故障，只留「慢」的表象 |

一句话根因：**一次上游 JWKS 超时，被 401 语义放大成双份超时，再被 `data: []` 的空态语义放大成「没有账号」的错误结论。**

## 3. 修复（三层同时收口，任一层单独做都不足以消除用户可见错误）

### P0-B Python 后端（`packages/python-backend`）
- `AUTH_JWKS_UNAVAILABLE` / `AUTH_JWKS_INVALID` / `AUTH_CONFIG_INVALID` → **503**；令牌类错误仍 401。语义分层是本次全部放大效应的源头。
- **共享 `httpx.AsyncClient`**（connect 2s / read 5s、keep-alive 连接池）；传输层异常时丢弃连接池，下一次重建。
- **失败退避 15s**：取键失败后窗口内不再重复打网络；`force=True`（unknown-kid 触发的强制刷新）**同样受限**，否则故障期每次验签都付一次超时。后台刷新共用同一退避纪律。discovery 校验失败（`AUTH_DISCOVERY_INVALID`，属配置问题非上游抖动）**不**记退避。
- **stale-while-revalidate**：TTL 过期但在 3600s 宽限期内 → 立即返回旧 key，刷新丢到后台，刷新成本不压到用户请求路径。
- **启动预热**：FastAPI `lifespan` 里 `create_task(prefetch())`——只调度不等待（不阻塞健康检查、不拖慢启动），退出时取消任务并 `aclose()` 连接池。

### P1 Electron 主进程（`apps/desktop/electron`）
- `services/python-bridge.js`：401 重放改为**白名单门禁**——仅 `AUTH_TOKEN_MISSING/INVALID/EXPIRED/NOT_ACTIVE`、`AUTH_SIGNATURE_INVALID/ALGORITHM_INVALID`（令牌自身失效）才 `forceRefresh` + 重放；`AUTH_JWKS_*` 与其它 5xx **不重放**。
- `_extractErrorCode()` 归一 FastAPI 两种 detail 形态（对象 `{error_code}` / 全大写字符串码），统一以 `errorCode` + `status` 透传。
- `publishers/account-manager.js`：`listAccounts()` 抛错时用 `Object.assign` 带上 `errorCode`/`status`（此前 `new Error(message)` 把码丢了）。
- `ipc-handlers/account.js`：`accounts:list` 的 catch 返回体展开 `ipcFailureDetail(e)`，`code` 保持 `EC.REQUEST_ERROR(-1)` 不变（不破坏既有契约）。

### P0-A 渲染端（`apps/desktop/src`）
- `stores/accounts.js`：`code !== 0` **必须** `error.value = formatUserError(...)`；`TRANSIENT_FAILURE_CODES`（`AUTH_JWKS_*`）或 `status >= 500` 判为瞬时失败 → **保留上一次账号列表** 且 `loaded` 不置真（下次进入仍会重拉）。真实空列表（`code:0` + 空数组）与非瞬时失败仍清空，既有契约不变。
- `views/Accounts.vue`：`loadError && visibleAccounts.length === 0` 时渲染错误态 EmptyState（`data-testid="accounts-error"`，标题/提示/重试按钮 + `WarningFilled` 图标），点击重试走 `refresh()`；已有账号时不因失败切换空态。
- `locales/zh.js` / `en.js`：成对新增 `accountsPage.errorTitle` / `errorHint` / `errorAction`。

## 4. 契约与回归保护

| 层 | 新增用例（合计 **+28**） | 数量 |
|----|----------------|------|
| python `tests/test_logto_auth.py` | 503 语义（fetch 失败 / 非 2xx / FastAPI 依赖抛出）、退避窗口内不重试、discovery 校验失败不退避、退避同样约束 force、成功取键清零退避、后台刷新在退避内不重复打网络、stale 服务不阻塞 + 超宽限期必须阻塞刷新、`prefetch()` 预热且从不抛异常、http client 复用与关闭 | +12 |
| python `tests/test_server_logto_auth.py` | lifespan 只调度不等待（不拖慢启动）、预热失败不影响启动、退出取消预热任务并 `aclose()` | +3 |
| `electron/services/python-bridge.integration.test.js` | 「收到 503（AUTH_JWKS_UNAVAILABLE）时不刷新令牌、不重放」「收到 401 但错误码不属于令牌类时不重放」（既有 `AUTH_TOKEN_EXPIRED` 重放一次契约保留） | +2 |
| `electron/publishers/account-manager.test.js` | 非零 code 抛出携带 `errorCode`/`status`；无错误码时仍抛原始 message | +2 |
| `electron/ipc-handlers/account.test.js` | `accounts:list` 把 `errorCode`/`status` 透传给渲染层；普通异常不带这两个字段 | +2 |
| `src/stores/accounts.test.js` | `code!=0` 记 error、errorCode 命中保留列表、无 errorCode 但 `status>=500` 同样按瞬时、瞬时失败不置 `loaded` | +4 |
| `src/views/Accounts.test.js` | 错误态与「暂无账号」互斥且含重试入口、点重试触发 `load()`、已有账号时不切错误态 | +3 |

既有契约零破坏（重点保护）：`test_invalid_discovery_is_not_cached_for_a_later_request`、`test_unknown_kid_refresh_is_single_flight_and_bounded`、store 的「`code:0` 空数组 → 清空」「reject → 清空 + `error=message`」、bridge 的 `AUTH_TOKEN_EXPIRED` 重放一次。

## 5. Decision Log

| 决策 | 理由 | 被否方案 |
|------|------|----------|
| 退避同样约束 `force=True` | 事故根因就是「故障期重复付超时」；若 force 可绕过，unknown-kid 会把每次验签打成超时 | 仅约束非 force（原实现直觉）→ **改测试不改实现**，并新增用例固化语义 |
| 后台刷新共用同一退避 | 自查发现：stale 宽限期内每个请求都会 `create_task` 一次刷新，故障期等于无限重试 | 只靠 `_background_refresh` 去重（只防并发，不防连续） |
| 不把 `AUTH_JWKS_UNAVAILABLE` 加入 `USER_ERROR_CODES` 目录 | 避免触碰 message-contract 门禁；store 的 `fallback` 文案已足够友好，且文案属渲染端职责 | 新增目录条目 + 专门 locale 键 |
| IPC `code` 仍为 `-1` | `EC.REQUEST_ERROR` 是既有契约，渲染端与既有测试都依赖它；区分度由新增 `errorCode`/`status` 承担 | 改成 `-503`（破坏既有断言） |
| 预热 fire-and-forget | `waitForHealthy` 不能被身份服务抖动拖慢；启动失败也不该由预热决定 | lifespan 内 `await prefetch()` |

## 6. 遗留与另案

1. **后端端口冲突 + 健康检查假阳性**：本机偶发 `[Errno 10048] 127.0.0.1:8299` 绑定失败但 `waitForHealthy` 仍判定健康（探到的是**别人的**实例），会独立造成验签/行为异常——与本次链路无关，另案排期。
2. **运维侧**：`auth.iart.work` 在本机走系统代理时抖动明显，建议在代理客户端对该域名直连放行（环境优化，不作为代码修复前提）。
3. **E2E**：真实「首开无网络/JWKS 抖动」注入需打包环境，交由 CI electron-tests 与后续 /canary 冒烟覆盖。

## 7. 复审修复（CodeReview W1–W5）

首轮提交后 CodeReview（0 Critical / 5 Warning）指出的 5 条，均以 TDD 补齐并回归通过：

| # | 问题 | 修复 | 回归 |
|---|------|------|------|
| W1 | 错误态 `:description="loadError \|\| errorHint"` 使 `errorHint` 成死键；store `fallback` 硬编码中文，en 界面直出中文 | store `fallback` 改 `i18n.global.t('accountsPage.loadFailed')`（随语言）；view description 直接用 `t('accountsPage.errorHint')` | `Accounts.test.js`「错误态描述使用本地化提示，不直出后端原始文本」 |
| W2 | 未登录（后端 `-3` → `AUTH_REQUIRED`）被呈现为「加载失败 + 重试」错误态，缺少登录引导 | store 暴露结构化 `errorCode`；view 按码分流：`authRequired`（`AUTH_REQUIRED`/`NOT_SIGNED_IN` 且未登录）走登录引导 EmptyState，点击触发 `ensureLogin` → 成功刷新；已登录但令牌异常仍走错误态 | store「暴露 AUTH_REQUIRED 错误码」；view「未登录展示登录引导 / 已登录仍走错误态 / 点击触发 ensureLogin」3 例 |
| W3 | 后端 401 `AUTH_TOKEN_REQUIRED`（server.py 强制鉴权但无有效令牌）不在 `TOKEN_RETRY_ERROR_CODES` 白名单，漏掉一次「强刷 + 重放」自愈 | 白名单补入 `AUTH_TOKEN_REQUIRED` | bridge「收到 401（AUTH_TOKEN_REQUIRED）时强制刷新并重放一次」 |
| W4 | `connect_timeout_seconds = 2.0` 相对事故环境实测握手 5–10s 过激，会把本可 keep-alive 复用的连接在建链阶段误判失败 | 调整为 `5.0`（与 read 对齐），补注释说明收益来自连接复用 / 退避而非激进超时 | `test_logto_auth.py` 全绿（无断言耦合具体超时值） |
| W5 | `requestBackend` 直接 reject（后端未起 / 连接超时）时 catch 无条件清空列表，绕过 `isTransientFailure` | catch 内同样按 `formatUserError` 归类：`NETWORK_ERROR`/`TIMEOUT` 计入 `TRANSIENT_FAILURE_CODES` → 保留上一次列表且不标记已加载 | store「网络 reject / 超时 reject 归类为瞬时失败并保留列表」2 例 |

 locale：`accountsPage.loginRequiredTitle / loginRequiredHint / loginRequiredAction` zh/en 成对新增。

### 追加 Decision Log

| 决策 | 理由 | 被否方案 |
|------|------|----------|
| store 暴露 `errorCode`（结构化）而非让 view 解析文案 | 界面按稳定码分流，避免用中文文案正则判断登录态 | view 直接正则匹配 `error` 文本 |
| 仅 `未登录 && AUTH_REQUIRED` 才走登录引导 | 已登录仍报 `AUTH_REQUIRED` 多为令牌异常，应保留错误重试入口而非循环弹登录 | 只要 `AUTH_REQUIRED` 一律弹登录 |
| `AUTH_TOKEN_REQUIRED` 纳入重放白名单 | 语义为「缺有效令牌」，强刷 + 重放正是自愈；区别于 `AUTH_JWKS_*`（上游不可用，重放只翻倍超时） | 维持黑名单外的静默 401 |
| connect 超时放宽到 5.0 而非更激进预热重试 | 首开慢的根因是每请求重做握手，已由共享 client + 预热解决；超时只兜底新连接 | 继续压低 connect 超时追求「快速失败」 |
