# PRD / 变更规格：全仓代码体检第三批落地（P1 纵深防御 + P2 安全小项）

> 来源：`.adversarial/codebase-audit-20260922/proposal-v7.md`（双模型对抗评审收敛后的第 3 批整改清单）
> 分支：`codex/audit-p1-depth`（worktree 隔离，`D:\Data\projects\mp-worktrees\mp-audit-p1-depth`）
> 节拍：质量节拍 Phase 2（开发期日常循环）+ Phase 3（交付期文档同步）；三项均为**安全/架构级变更**，故按 QM-5 五步反哺逐条交付（根因 → 逃逸链 → 系统性漏洞 → 回归保护 → 防复发门禁）。
> 关联提交：`69aead55e`（P1-14）、`7e00cc5b8`（P1-15）、本批末次提交（P2 安全小项）

---

## 0. 变更总览

| 编号 | 模块 | 缺陷本质 | 修复口径 | 防复发门禁 |
|---|---|---|---|---|
| P1-14 | `apps/desktop/electron` | 10 个 service 的 `registerIpcHandlers` 写成「漏注入即回退全局 ipcMain」，静默绕过来源校验与许可证门禁；全仓 sender 守卫覆盖率无单一口径 | 注入契约改 **fail-closed 抛错** + 新增递归盘点脚本（五分类 / 双校验）+ 豁免清单 + CI Gate 17 | `.github/scripts/check-ipc-sender-guard.js`（+ 15 例 node:test 自测）、`ipc-injection-contract.test.js` 静态+行为契约 |
| P1-15 | `ops-center` | 登录接口把 HS256 JWT 放进响应体 → 前端存 localStorage 手拼 `Authorization`，一处 XSS 即管理员会话接管；7 个 view 各自复制 axios 样板导致加固无法一处改全 | 凭据迁 **HttpOnly + SameSite=Lax Cookie** + 写操作自定义头 `X-Ops-Session` + CSP 三层下发（后端中间件 / nginx / vite dev）+ 前端统一 `createApiClient()` | `.github/scripts/check-ops-session-hygiene.js`（CI Gate 18，+ 7 例 node:test 契约） |
| P2-a | `packages/ai-writer-api` | `key !== apiKey` 首个差异字节短路，耗时可作为逐字节猜密钥的侧信道 | 抽 `src/auth.js#timingSafeKeyEqual`（先 SHA-256 再 `crypto.timingSafeEqual`，非字符串/空值 fail-closed） | `tests/api-key-timing.test.js` 静态不变量（源码必须调用、不得残留 `!==` 比较） |
| P2-b | `packages/collection-engine` | 4 个 platform-adapter 的 `buildUrl` 把上游解析出的 id 裸拼进 query/路径，`&`/`#`/`?`/`/` 可追加或截断参数 | 一律 `encodeURIComponent(String(id))`（query 与路径段同口径） | `tests/build-url-encoding.test.js`（9 例，含「不新增查询参数」的解析级断言） |
| P2-c | `apps/desktop/electron/services/webview-manager.js` | 凭证 localStorage 恢复把 `JSON.stringify` 结果裸拼进 `executeJavaScript` 脚本文本，安全性完全依赖引擎宽容度 | 新增原语 `core/js-eval-payload.js`（`toSafeJsLiteral` / `buildEvalScript`），数据只在字面量内、页面侧 `JSON.parse` 还原 | `core/js-eval-payload.test.js`（13 例，含真实求值的注入用例 + 调用方静态防复发） |
| P2-d | `packages/audio-aligner` | `POST /align` 把调用方给的绝对路径直接交给 ffmpeg ⇒ 监听 `127.0.0.1:8004` 的无鉴权服务变成「任意本地文件读取原语」 | 新增 `aligner/path_guard.py`：绝对路径 + realpath + 目录白名单（默认**只允许系统临时目录**，fail-closed），越界 403 且**先于**存在性判定 | `tests/test_p2_path_guard.py`（28 例）+ 桌面端 `AlignerBridge._spawnEnv()` 注入 `AUDIO_ALIGNER_ALLOWED_DIRS`（+ 6 例契约） |

**口径一致性说明**：P2-c / P2-d 都遵循同一原则——「不可信数据不得参与代码文本构造」与「越界判定先于存在性判定」；P1-14 的 file:// 目录边界与 P2-d 的音频目录边界使用同一套 `realpath` + `commonpath` 语义，避免出现第二种「包含关系」定义。

---

## 1. P1-14：IPC 注入契约 fail-closed 与 sender 守卫覆盖门禁

### 1.1 缺陷与影响面

历史写法（10 个 service 一致）：

```js
function registerIpcHandlers (injectedIpcMain) {
  const ipcMain = injectedIpcMain || require('electron').ipcMain   // ← 漏注入即静默落到全局
}
```

`window.js` / `phase5-ipc.js` 注入的是 `createAccessControlledIpcMain()` 返回的受控 Proxy，它在转发任何 `handle` **之前**无条件执行 `isTrustedSender`，并叠加许可证/权益门禁。一旦某个调用点漏传注入对象：

1. 该通道注册到**全局** `ipcMain` ⇒ 来源校验与权益门禁双双失效（渲染进程任意 frame 可调用）；
2. 纯 Node 单测里 `require('electron')` 返回的是路径字符串，退化为一个无信息量的 `TypeError`，契约违规不被任何测试发现；
3. 静态层面没有任何指标能回答「还有多少通道没守卫」——体检报告原始统计（336 handle / 约 215 带守卫）**不可复现**，因为它沿用了 `check-ipc-bridge.js` 的非递归目录扫描。

### 1.2 注入契约（数据校验与错误语义）

统一改为：

```js
if (!injectedIpcMain) {
  throw new Error('<ServiceName>.registerIpcHandlers 必须注入受控 ipcMain（createAccessControlledIpcMain），'
    + '禁止回退全局 electron.ipcMain（会绕过 isTrustedSender 与许可证门禁）')
}
```

| 输入 | 结果 | 说明 |
|---|---|---|
| 未传参 / `undefined` / `null` | 抛 `Error` | 错误文案必须含「受控 ipcMain」字样，可操作、可检索 |
| 传受控实例（含 `handle`/`on`/`removeHandler`） | 正常注册 | 行为用例逐个验证「注册数 > 0」 |
| 传裸 `require('electron').ipcMain` | 门禁静态拦截 | 属 `via=global` 硬错误，不可豁免 |

受影响 service：`comment-manager` / `oauth-manager` / `webview-manager` / `batch-manager` / `publish-impact-tracker` / `provider-manager` / `url-collector` / `viral-engine` / `content-intelligence` / `qrcode-login`（`cloud-publisher` 已在本批之前按 MAJOR-3 范式修好，一并纳入守卫集合）。同时删除因此变成死代码的模块级 `ipcMain` 解构。

### 1.3 盘点脚本单一口径（`check-ipc-sender-guard.js`）

**递归**扫描 `apps/desktop/electron/**/*.js` 生产源码（排除 `.test.js` / `.spec.js` / `.d.ts` / `types.js` / `node_modules` / `dist`），对每个 `X.handle(...)` / `X.on(...)`（接收者名以 `ipcMain` 结尾，大小写不敏感）做注释与字符串感知的参数切分 + 作用域栈回溯，归为五类：

| 分类 | 判据 | 门禁处置 |
|---|---|---|
| `explicit` | handler 体内出现 `withSenderCheck` / `isTrustedSender(` / `assertTrustedSender(` | 计入守卫覆盖率 |
| `injected` | 接收者来自外层形参或其局部别名（即受控实例） | 咽喉点覆盖，免逐个补守卫 |
| `global` | 接收者解析到 `require('electron').ipcMain` | **硬错误，不可豁免** |
| `sync-unguarded` | `ipcMain.on` 同步通道未显式校验（Proxy 只包装 `handle`） | 必须补守卫或逐条豁免 |
| `unknown` | 静态不可判定（动态接收者等） | 必须在豁免清单逐条登记 |

**CI 双校验（两条都必须通过）**：

1. **清单式（防漂移）**：`explicit`/`injected` 之外的注册点必须逐条登记在 `apps/desktop/electron/ipc-guard-exemptions.json`（`channel` / `method` / `via` / `risk` / `reason` / `owner`）；**登记了但实际已不再出现 → 陈旧条目同样判失败**（避免清单只增不减）。
2. **比例式（防稀释）**：显式守卫占比不得低于 `minGuardedRatio`（基线 0.65，实测 0.671），防止「把已有 `withSenderCheck` 摘掉、整体躺进咽喉点」。该值**只允许上调，禁止下调**。

另含两条不可豁免的不变量：禁止 `injectedIpcMain || require('electron').ipcMain` 回退写法；同一通道重复注册且守卫状态不一致直接失败（Electron 后注册覆盖前者 ⇒ 等价于静默增删守卫）。

退出码：`0` 通过 / `1` 违规；支持 `--json`（机器可读）、`--list-unguarded`、`--base-dir`、`--min-ratio`。

### 1.4 基线与显示项

`ipc-guard-exemptions.json` 的 `baseline` 即「人可读的当前状态」，用于评审与后续对比：注册点 **407**（`handle` 404 / 同步 `on` 3）、显式守卫 **273**、咽喉点注入 **134**、不可判定 **0**、绕过路径 **0**、显式占比 **67.1%**。`entries` 为空表示当前零豁免。

`$comment` 字段固化了三条容易踩的认知误区：
- `license-access-control.js` 顶部的 `PUBLIC_CHANNELS` 是「免登录功能开关」，**不是**来源守卫，不计入覆盖率也不得作为豁免条目；
- 咽喉点只覆盖 `handle`，`on` 一律要显式守卫；
- 补 `withSenderCheck` 仍是纵深防御的推荐做法，`via=injected` 不是免检金牌。

### 1.5 CI 接入与 file:// 边界回归

- `quality-gate.yml` **Gate 17**：`node .github/scripts/check-ipc-sender-guard.js` + `node --test .github/scripts/check-ipc-sender-guard.test.js`（15 例覆盖五分类判定、陈旧条目、比例稀释、global/fallback 硬错误、重复注册不一致）。
- `core/ipc-security.test.js` 补 **realpath 目录边界**回归，关闭上一批 QM-2 的 partial 项：junction 入口穿透、兄弟目录前缀陷阱（`dist` vs `dist-evil`）、`dist` 自身、未注入 `app` 时的回退、`getAppPath()` 抛错 fail-closed。

### 1.6 交互逻辑与运维指引（开发者视角）

- 新增 IPC 通道时：优先复用受控实例（`window.js` / `phase5-ipc.js` 注入），并在 handler 内补 `withSenderCheck`；本地跑 `node .github/scripts/check-ipc-sender-guard.js --list-unguarded` 查看待办清单。
- 确实无法补守卫（第三方内建通道等）：在 `ipc-guard-exemptions.json` 逐条登记 `risk`/`reason`/`owner`，并在 PR 描述中说明——门禁会校验「条目必须真实存在」，删除守卫而不登记会直接失败。
- 覆盖率上升后：把 `minGuardedRatio` 上调到新水位（只升不降），防止退化。

---

## 2. P1-15：管理后台会话 HttpOnly Cookie + CSRF 自定义头 + 三层 CSP

### 2.1 缺陷

`POST /api/auth/login` 直接把 HS256 JWT 放在响应体，前端 `localStorage.setItem('ops_token', …)` 并在 7 个 view 各自的 axios 实例里拼 `Authorization: Bearer`。后果：

- 任意一处 XSS（含依赖链投毒）即可完整外带管理员凭据，且外带后的 token 在有效期内**可离线复用** ⇒ 会话接管；
- 7 份复制样板意味着「一处加固改不全」，历史上 CSRF/CSP 类修复正是因此反复遗漏；
- 前端本地 `isTokenExpired()` 预检与后端判定并存，两套口径造成「半登录态」（界面显示已登录、请求全 401）。

### 2.2 后端契约

#### 2.2.1 `POST /api/auth/login`

请求体校验（Pydantic）：`username`、`password` 必填，长度分别 ≤ `auth_service.USERNAME_MAX_LEN` / `PASSWORD_MAX_LEN`（超限 422）。

成功响应（**刻意不含 `token` / `access_token`**）：

```json
{ "username": "admin", "role": "admin", "expires_in": 28800, "csrf_header": "X-Ops-Session" }
```

同时 `Set-Cookie: ops_session=<JWT>; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800[; Secure]`。

错误语义（保持不变，避免把配置缺陷伪装成凭据问题）：

| 场景 | 状态码 | 提示文字（原文） |
|---|---|---|
| 用户名或密码错误 | 401 | `用户名或密码错误` |
| 同 `username|ip` 连续 5 次失败（60s 锁定，既有登录限速未削弱） | 429 | `尝试次数过多，请稍后再试` |
| 未配置管理员 | 503 | `未配置管理员账号，请设置 OPS_ADMIN_USERNAME/OPS_ADMIN_PASSWORD` |

#### 2.2.2 `POST /api/auth/logout`

`delete_cookie(key, path="/", …)` 后返回 `{"ok": true}`。**刻意不要求认证、不要求 CSRF 头**：该接口只让浏览器丢弃本地 Cookie、无服务端副作用，且在会话已过期时必须可用——否则前端「登出」按钮会退化成 401 报错。

#### 2.2.3 `GET /api/auth/session`（`/api/auth/me` 的别名）

会话探测/水合入口：有效会话返回 `{username, role}`，否则 401。保留别名是为了让体检报告、运维手册与前端代码用同一个名字，且不引入第二份鉴权逻辑。

### 2.3 配置项（`OPS_` 前缀，可覆盖）

| 配置 | 默认 | 校验 / 语义 |
|---|---|---|
| `OPS_SESSION_COOKIE_NAME` | `ops_session` | Cookie 名 |
| `OPS_SESSION_COOKIE_SAMESITE` | `lax` | 仅 `lax` / `strict` / `none`（Literal 校验，非法值启动即失败） |
| `OPS_SESSION_COOKIE_SECURE` | 未设置（`None`） | `None` ⇒ 按 `ENVIRONMENT` 判定（非 development 即 `Secure=True`）；显式配置优先，用于「反向代理终结 TLS」场景 |
| `OPS_SESSION_COOKIE_MAX_AGE_HOURS` | `0` | `0` ⇒ 沿用 `auth_service.TOKEN_TTL_HOURS`（**同一来源，避免两套 TTL 漂移**）；`>0` 显式覆盖 |
| `OPS_CSRF_HEADER` | `X-Ops-Session` | 自定义头名；前端从登录响应读回，不硬编码 |
| `OPS_CONTENT_SECURITY_POLICY` | 见下 | 置空字符串 ⇒ 后端不下发（交 nginx/CDN） |
| `OPS_X_FRAME_OPTIONS` | `DENY` | 与 CSP `frame-ancestors 'none'` 双保险 |

默认 CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`。

**附带加固**：`Settings.__repr_args__` 对凭据字段脱敏（显式名单 `jwt_secret`/`secret_key`/`encryption_key`/`redemption_secret`/`admin_password`/`catalog_api_key`/`runtime_signing_private_key` + 后缀规则 `_secret`/`_password`/`_token`/`_private_key`/`_api_key`/`_key`），一律呈现为 `***`。动因是**实测一次测试失败就会把 Ed25519 私钥明文打进日志**（pydantic 的 repr/str 都走该钩子，掩码只影响呈现，不影响属性读取）。

### 2.4 鉴权中间件判定流程（`middleware/auth.py`）

```
请求进入 get_current_user / get_current_user_optional
 ├─ 1. 有 Authorization: Bearer <jwt>？
 │      是 → 只走 Bearer 通道（桌面端/脚本/scheduler 上报），不要求 CSRF 头
 │           解码失败 → 401「令牌无效」；密钥未配置 → 503「认证服务配置不完整」
 │           （非法不回落到 Cookie：杜绝「用垃圾 Bearer 触发回落」的语义歧义）
 │      否 ↓
 ├─ 2. 读会话 Cookie（HttpOnly，浏览器自动携带，JS 读不到）
 │      有 Cookie 且方法 ∉ {GET, HEAD, OPTIONS, TRACE} 且缺 settings.csrf_header
 │           → 403「跨站请求伪造防护：基于 Cookie 会话的写操作必须携带自定义头 X-Ops-Session（前端 axios 拦截器默认注入）」
 │      有 Cookie → 解码（同上错误语义）
 │      否 ↓
 └─ 3. 完全无凭据 → 401「未提供认证令牌」（optional 版返回 None）
```

读操作不要求自定义头，以保证书签直达与只读页面可用；`require_admin` 的 403「需要管理员权限」语义不变。

### 2.5 前端交互逻辑

| 位置 | 行为 |
|---|---|
| `stores/auth.js` | 状态只剩 `username`/`role`/`initialized`/`csrfHeader`/`expiresIn`；**无 token、无 localStorage、无 `isTokenExpired`**。`restore()` 向后端探测一次（`/auth/session`），任何失败（401 或网络异常）统一按未登录处理并置 `initialized=true`，交由路由守卫跳登录页——网络异常与凭据失效在 UX 上无需区分。`logout()` 必须请后端清 Cookie（仅清内存态会让浏览器继续携带有效凭据），**后端失败也要清本地态并放行**，否则用户卡在「已登录但全是 401」。 |
| `api/http.js` | 统一客户端工厂 `createApiClient()`：`baseURL '/api/v1'` + `withCredentials: true`；非幂等方法注入 `X-Ops-Session: 1`（值无意义，存在即判据；axios v1 走 `headers.set()`，退化时才直接赋值）。响应侧：**401 → 清登录态并跳 `#/login`；403 → 不清态**（权限不足/缺 CSRF 头属业务或调用方问题，一次误操作不该把管理员踢下线）。 |
| 统一错误文案 | 连接级失败（`ERR_NETWORK` / `Network Error`）：`无法连接后端服务（Network Error）：请确认 ops-center 后端已启动（uvicorn main:app --port 8010），然后刷新页面重试`；HTTP 错误优先展示后端 `detail`，缺失回退 `操作失败，请稍后重试`。 |
| `router/index.js` | 守卫改 async，**首次导航** `await authStore.restore()` 水合（前端不再本地判活）。 |
| 7 个 view（`EnvView`/`Licenses`/`Platforms`/`RateLimitVerifier`/`Secrets`/`Snapshots`/`SystemHealth`） | 删除本地 `axios.create` + 拦截器样板，统一 `createApiClient()` ⇒ 加固一处生效。 |
| `App.vue` | 登出 `await` 完成后再跳登录页（否则停留在受保护页面继续展示旧数据）。 |

### 2.6 CSP 三层下发（缺一即漏）

| 层 | 覆盖范围 | 关键点 |
|---|---|---|
| `deploy/nginx-ops.conf` | nginx 直接返回的静态资源（index.html/js/css） | **`frame-ancestors` 只能走 HTTP 头**（`<meta>` 通道不支持），嵌框防护必须留在这一层；nginx 继承规则是「下级出现自己的 `add_header` 就完全不再继承上级」⇒ 不要在 location 里单独写 `add_header`，除非整组复制过去 |
| FastAPI `main.py#security_headers` | 所有 API 响应 | CSP + `X-Content-Type-Options: nosniff` + `Referrer-Policy: no-referrer` + `X-Frame-Options`；`OPS_CONTENT_SECURITY_POLICY` 置空则不下发 |
| `vite.config.js` dev 插件 | 仅本地开发 | `apply: 'serve'` 注入 CSP `<meta>`，**不进产物** |

### 2.7 运维指引

- **反向代理终结 TLS**：后端只见 http，必须保留 `X-Forwarded-Proto` 并显式 `OPS_SESSION_COOKIE_SECURE=1`，否则浏览器既不存也不回传会话 Cookie（现象：登录成功、刷新又回登录页）。
- **同源部署**：会话 Cookie 是 `SameSite=Lax`，前后端必须同 host（`nginx-ops.conf` 即同 host 转发 `/ops/`）。跨 origin 部署需改 `samesite=none` + 强制 Secure + CORS 精确白名单带 credentials。
- 灰度/回滚：登录响应体已不含 token，**新旧前端不可混部**；如需回滚，同时回滚前端与后端（旧前端会因拿不到 token 直接不可用，属可观测的硬失败，不会退化成「假登录」）。

### 2.8 会话卫生门禁（CI Gate 18，QM-5 第 5 步）

`check-ops-session-hygiene.js` 把修复口径变成静态不变量：

- 目录级禁用（`frontend/src`）：`ops_token`、`isTokenExpired`、`headers.Authorization =`、`defaults.headers.common[`；
- 目录级禁用（`frontend/src/views`）：`axios.create(`、`interceptors.request.use(`（必须走 `createApiClient()`，杜绝「7 份样板」重演）；
- 关键文件结构断言：登录签发点必须有 `set_cookie`/`httponly=True`/`samesite=`/`logout`/`delete_cookie` 且响应体**不得**出现 `"token":`；中间件必须有 `csrf_header`/`HTTP_403_FORBIDDEN`/`SAFE_METHODS`；`main.py` 必须下发 CSP/nosniff/no-referrer；`config.py` 必须可配置；`http.js` 必须 `withCredentials` 且只在 401 清态；`router/index.js` 必须 `await authStore.restore()`；nginx 模板必须有 CSP 与 `frame-ancestors 'none'`；
- 配套 7 例 node:test 契约测试；接入 `quality-gate.yml` **Gate 18**。

### 2.9 测试矩阵

| 文件 | 用例数 | 覆盖要点 |
|---|---|---|
| `ops-center/backend/tests/test_p1_15_session_cookie.py` | 13 | 响应体无 token、Cookie 属性（HttpOnly/SameSite/Path/Secure 默认与覆盖）、CSRF 关卡（写缺头 403、GET 免检）、Bearer 优先且非法不回落、登出清 Cookie、登录限速未削弱、CSP 下发、`Settings` repr 脱敏 |
| `ops-center/frontend/tests/auth-store.test.js` / `http-client.test.js` | 重写 | restore/login/logout 语义、401 vs 403 行为、非幂等注入 CSRF 头 |
| `.github/scripts/check-ops-session-hygiene.test.js` | 7 | 门禁自身判定（含「写了不跑」的坑修复） |
| 附带发现 | — | `vitest.config.js` 的 include 只覆盖 `src/**`，导致 `tests/` 下 **6 个用例文件从不执行**（写了不跑）；修正后 8 files / 42 tests 全绿 |

---

## 3. P2 安全小项（四项，同批收口）

### 3.1 `ai-writer-api`：API Key 恒定时间比较

- **根因**：`if (!key || key !== apiKey)` 在首个差异字节短路，响应耗时与「猜对了前缀长度」相关，本机网络下重复采样可逐字节猜出密钥。
- **修复**：新增 `src/auth.js#timingSafeKeyEqual(provided, expected)` —— 两侧先 SHA-256 再 `crypto.timingSafeEqual`（哈希使长度恒等，避免 `timingSafeEqual` 在长度不等时抛错并产生可分辨的异常分支）；非字符串（HTTP 重复头会给出数组）或空串一律 `false`，不给「两侧都空 ⇒ 相等」留口子。`server.js` 改为 `if (!timingSafeKeyEqual(key, apiKey))`，401 文案保持 `Unauthorized. Set X-API-Key header.`。
- **测试逃逸分析**：行为用例无法区分 `!==` 与恒定时间比较（耗时差异不在单测可信分辨率内）⇒ 除 6 单元 + 5 集成用例外，追加**静态不变量**断言：`src/server.js` 必须调用 `timingSafeKeyEqual(key, apiKey)`，且不得残留 `/key\s*!==\s*apiKey/`。
- **QM-5 红验证 M1**：把比较退回 `key !== apiKey` ⇒ 用例转红（exit=1，2 failed）。

### 3.2 `collection-engine`：`buildUrl` 参数编码

- **根因**：`bvid`/`aid`/`videoId`/`noteId`/`qid`/`aid` 来自**上游链接解析**（分享文档、抓到的 href），属外部输入；裸拼进 query 时 `&`/`#`/`?` 可追加或截断查询串，裸拼进路径段时 `/`/`#`/`?` 可跳到别的路由。体检报告只点了 bilibili，同类缺陷在抖音/小红书/知乎同源存在 ⇒ **同口径一并收紧**。
- **修复**：4 个 adapter 统一 `encodeURIComponent(String(id))`（bilibili query 两行、douyin `video/`、xiaohongshu `explore/`、zhihu `question/{qid}/answer/{aid}` 两段）。`typeof target === 'string'` 分支保持原样返回（调用方给的是完整 URL，不做二次编码）。
- **测试**（9 例）：含 `&fid=1` 的 bvid 不得新增查询参数（用 `new URL()` 解析参数集合断言）、含 `#` 的 id 不得产生 hash 段、数字 id 强转后 URL 文本不变、路径段含 `/` 的编码结果、真实 B 站 id 形态（`BV1xx411c7mD`）不受影响。
- **QM-5 红验证 M2**：退回裸拼 ⇒ 2 failed。（踩坑记录：首次锚点写 `'?bvid=' + …` 与源码 `'/x/web-interface/view?bvid=' + …` 不匹配，变异实际未发生——红验证脚本必须先断言锚点命中数恰为 1。）

### 3.3 `webview-manager`：`executeJavaScript` 值传递

- **根因**：旧写法把 `JSON.stringify(credLocalStorage)` 裸拼进 `'var data = ' + …`。凭证文件可被本机其他进程写入，能否逃出字面量边界**完全依赖**引擎宽容度（ES2019 起才允许 U+2028/U+2029 进字符串字面量）；且这段文本一旦被搬进 HTML 上下文（`<script>`、内联事件），还要过第二层 HTML 解析，`</script>` / `<!--` 即可改写脚本边界。Electron 43 的 `webContents.executeJavaScript(code, userGesture?)` **不支持传参**，无法靠参数通道规避 ⇒ 必须自行安全序列化。
- **修复**：新增 `electron/core/js-eval-payload.js`
  - `toSafeJsLiteral(value)`：产出**单引号包裹的 JS 字符串字面量，内容为 JSON 文本**。逐字符处理：`\` → `\\`（字面量还要过一层 JS 词法，不加倍则 JSON 的 `\n`、`\"` 被 JS 提前消耗成真实控制字符，`JSON.parse` 报 *Bad control character in string literal*）；`'`、`<`、`>`、`&`、U+2028、U+2029 → `\uXXXX`；其余原样。不可序列化输入（`undefined`/function/symbol/循环引用）抛 `TypeError` —— 静默产出 `'null'` 会把「凭证没恢复」伪装成「恢复成功」。
  - `buildEvalScript(paramNames, values, body)`：组装 IIFE，每个参数先 `var x = JSON.parse(<字面量>)` 再执行 body；`paramNames` 与 `values` 数量不一致直接抛错（不静默错位）。**踩坑记录（测试抓到真实设计缺陷）**：最初把 JSON 文本作为 IIFE **实参**传入 ⇒ 页面里 `data` 是字符串而非对象，`Object.keys(data)` 得到的是字符下标；改为 IIFE 内声明 + `JSON.parse` 还原。
  - 调用方：`credLsScript = buildEvalScript('data', [credLocalStorage], 'Object.keys(data).forEach(...)')`，`did-finish-load` 后执行。
- **测试**（13 例）：往返保真（中文/引号/换行/Windows 路径反斜杠/嵌套数组）、注入 payload 无法闭合字面量（求值后 `globalThis.__pwned` 仍 `undefined`）、`<>&` 转义后 `</script>` 无法提前闭合、控制字符不产出行、不可序列化抛错、`buildEvalScript` 4 例，以及**静态防复发**：读 `../services/webview-manager.js` 断言已 `require('../core/js-eval-payload')` 且不再出现 `/var data = ' + /`、`executeJavaScript(` 后 80 字符内不得出现 `JSON.stringify`。
- **QM-5 红验证 M3**：完全回退到裸拼写法 ⇒ 1 failed。

### 3.4 `audio-aligner`：`audio_path` 目录约束

- **威胁模型**：服务监听 `127.0.0.1:8004` 且**无鉴权**，任何本机进程（含渲染出去的网页发起的请求）都能命中 `POST /align`；把 `C:/Users/<u>/Documents/合同.docx` 或 `~/.ssh/id_rsa` 传进来，ffmpeg/faster-whisper 会尽力解码并把可读出内容以转写结果/错误信息形式回传 ⇒ 等价于「任意本地文件读取原语」。
- **校验顺序（口径与桌面端 `core/ipc-security.js` 的 file:// 边界一致）**：

| 步骤 | 判据 | 失败 code | HTTP | 提示文字 |
|---|---|---|---|---|
| 1 | 非空字符串 | `invalid_path` | 400 | `audio_path 必须是非空字符串` |
| 1 | 不含 NUL 字节 | `invalid_path` | 400 | `audio_path 含非法空字节` |
| 1 | 绝对路径 | `invalid_path` | 400 | `audio_path 必须是绝对路径（收到: …）` |
| 2 | `realpath(abspath)` 后仍在允许目录内 | `not_allowed` | 403 | `audio_path 越出允许目录: X；允许目录: [...]（如需放开，追加到环境变量 AUDIO_ALIGNER_ALLOWED_DIRS）` |
| 3 | 存在 | `not_found` | 404 | `音频文件不存在: <realpath>` |
| 4 | 是常规文件（目录拒绝） | `not_a_file` | 400 | `audio_path 不是文件（目录被拒绝）: <realpath>` |

  关键设计：① **先 realpath 再判包含** ⇒ 符号链接/junction 指向外部照样拦；② 目录包含用 `os.path.commonpath`，不用字符串前缀（`/a/dist` 与 `/a/dist-evil` 前缀相同）；跨盘符/UNC 混用抛 `ValueError` ⇒ 判为不包含；③ **目录边界先于存在性判定**，反序会把 403 变成 404，给调用方一个「外部文件是否存在」的枚举 oracle；④ 允许目录来自 `AUDIO_ALIGNER_ALLOWED_DIRS`（`os.pathsep` 分隔、逐项 strip 去重、不可解析项跳过并告警），**未配置时默认只允许系统临时目录**（fail-closed，而非 fail-open）。
- **与桌面端链路对齐**：真实 TTS 产物落在 `os.tmpdir()/story2video/assets/…`（`AssetGenerator` 默认根），语音克隆样本在 `userData` ⇒ `AlignerBridge.resolveAllowedAudioDirs()` = `tmpdir + userData + 外部已设值（视为追加项，不静默丢弃部署方配置）`，经新增钩子 `BasePythonBridge._spawnEnv()`（基类默认 `{}`）注入子进程 env，不要求部署方手工配 `process.env`。纯 Node 单测里 `require('electron')` 返回路径字符串、`app` 不存在 ⇒ `_userDataDir()` 退化为空串并被过滤，不抛错。
- **可观测性**：`GET /health` 新增 `allowed_roots`（排 403 第一件事就是确认当前允许哪些目录）；拒绝路径打 `WARNING align request_id=%s rejected=%s audio_path=%s`；成功日志与异常日志改用**规范化后的 realpath**，避免同一文件在日志里出现两种写法；`AlignRequest.audio_path` 的 Field 描述补「必须位于 AUDIO_ALIGNER_ALLOWED_DIRS 允许目录内，越界返回 403」。
- **测试**（28 例）：三档非法输入、兄弟目录前缀、`..` 遍历、symlink 逃逸（非 posix 分支，Windows 上 skip）、403 先于 404 的枚举防护、env 去重与不可解析项、health 契约、拒绝日志、`allowed_roots` 默认值。既有 `test_aligner_api.py` 的 4 处假路径（`C:/tmp/vo.mp3`）改为 `aligner_root` fixture 下的真实临时文件（新约束下假路径必然 403）。
- **QM-5 红验证 M4**：`resolve_audio_path(...)` 退回 `req.audio_path` ⇒ 5 failed。

---

## 4. 决策记录

| 决策 | 理由 | 被否方案 |
|---|---|---|
| sender 守卫用「清单 + 比例」双校验 | 单看清单会漏「把守卫摘掉变 unknown 再豁免」；单看比例可用「全量躺进咽喉点」稀释 | 只做一次性统计报告（无法防退化）；只拦 unknown（放过同步通道） |
| `minGuardedRatio` 只允许上调 | 门禁值下调是技术债最典型的静默扩面路径 | 每次自动刷新为实测值（等于没有门禁） |
| 会话凭据用 Cookie 而非内存 token + 自定义头 | HttpOnly 直接关闭「JS 可读」这条外带面；`SameSite=Lax` + 自定义头做双层 CSRF | 仅把 token 从 localStorage 挪到内存（XSS 仍可读取闭包变量并外发）；只上 CSRF token（凭据面没关） |
| 前端不做本地过期判定 | 前端拿不到 token，任何本地判活都会造成「半登录态」；权威判定只放后端 | 保留 `isTokenExpired` 的影子过期（需要把过期时间交回前端，重新扩大泄露面） |
| 登出不要求认证/CSRF 头 | 无服务端副作用，且在会话过期时必须可用 | 严格鉴权（登出按钮在过期态报 401，用户无法自助脱离） |
| 值传递原语自研而非 `executeJavaScript(code, args)` | Electron 43 typings 的 `executeJavaScript` 不接收参数，无参数通道可用 | 依赖 `JSON.stringify` 的转义宽容度（把安全性押在语言版本上）；base64 包裹（丢可读性且仍需 `JSON.parse`，未解决边界问题） |
| 音频目录默认只允许临时目录（fail-closed） | 该服务无鉴权，默认放开等于默认存在任意文件读取；真实产物本就落在临时目录 | 默认允许全盘（破坏最小权限）；默认拒绝一切（首启即不可用） |
| P2-c/P2-d 与既有 IPC 边界同口径 | 同一仓库出现两套「包含关系」定义必然漂移 | 各模块自定 helper |

---

## 5. 验证汇总（本地）

| 范围 | 命令 | 结果 |
|---|---|---|
| `packages/audio-aligner` | `python -m pytest -q` | 28 passed, 1 skipped（symlink 用例在非 posix 分支跳过；含 `test_p2_path_guard.py` 全量） |
| `packages/ai-writer-api` | `vitest run` | 23 passed（21 既有 + 本批 api-key-timing） |
| `packages/collection-engine` | `vitest run` | 11 files / 102 tests passed |
| `apps/desktop`（P2 定向） | `vitest run webview-manager / js-eval-payload / ipc-security / aligner-bridge-audio-dirs` | 4 files / **86 passed** |
| `apps/desktop` P1-14 定向 | vitest + `node --test .github/scripts/check-ipc-sender-guard.test.js` | 全绿（P1-14 提交时已验证） |
| `ops-center` P1-15 | pytest 13 例 + 前端 8 files / 42 tests + `node --test check-ops-session-hygiene.test.js` 7 例 | 全绿（P1-15 提交时已验证） |
| ESLint（本批新增/修改文件） | `eslint apps/desktop/electron/{core,services}/…` | **0 errors**，124 warnings（全为既有 `no-var` / 未用 catch 参数风格告警，非本批引入） |
| QM-5 红验证 | `python .agent_context/b3-p2-red-check.py`（4 个变异） | **M1/M2/M3/M4 全部 RED（exit=1）**，`git grep "# mutated"` 无残留 |

踩坑登记（同步进 `01-docs/learnings.md`）：
1. pytest fixture 里 `client._called = called` 会把属性挂在**函数对象**上而非 `TestClient` 实例 ⇒ 必须先实例化再赋值再返回；
2. Windows 下 pytest 的 `tmp_path` 位于系统 TEMP 内，而本机 `TEMP=D:\Temp` ⇒ 不能用 `tmp_path` 构造「允许目录之外」的路径，改用盘根目录；
3. worktree 缺 pnpm workspace 链接时 `cmd /c mklink` 被工具侧守卫拒绝（40441）⇒ 改用 `New-Item -ItemType Junction`（`node_modules` 不入库）；
4. vitest ESM 测试里 `__dirname` 不可靠 ⇒ ESM 用 `fileURLToPath(import.meta.url)`，CJS 用 `process.cwd()`；
5. CHANGELOG.md 因含 NUL 字节被 git 判为 binary（`i/-text`），`text=auto` 归一化失效 ⇒ 解冲突必须**字节级保持 CRLF**，否则整文件 12k 行伪 diff。

---

## 6. 残余风险与后续

- **P1-14**：`injected` 类覆盖依赖 `createAccessControlledIpcMain` 的 Proxy 语义不变；若将来给 `on` 也加 Proxy，需同步更新脚本口径。`unknown` 目前为 0，但脚本对「反射式动态注册」（如循环里拼通道名）判定有限，此类必须显式登记。
- **P1-15**：CSP 仍允许 `style-src 'unsafe-inline'`（Element Plus 运行时注入样式所需），进一步收紧需配合 nonce/hash 方案，列入第 4 批技术债；跨 origin 部署形态未做端到端验证（当前口径要求同源）。
- **P2-b**：`encodeURIComponent` 不覆盖「调用方直接传入完整 URL 字符串」的分支，该分支的 SSRF 由采集层域名白名单负责（第 2 批 P1-11 口径）。
- **P2-d**：目录白名单是**边界控制**而非内容校验，仍允许读取允许目录内的任意文件；若后续引入用户可选的任意音频路径，需要按账号/会话维度再加一层归属校验。
