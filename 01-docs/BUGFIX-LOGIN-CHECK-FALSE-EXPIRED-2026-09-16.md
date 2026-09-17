# BUGFIX: 账号登录态 HTTP 检测误报修复（抖音假阳性「已失效」）

> 日期: 2026-09-16 | 分支: `fix-douyin-validity-check` | worktree: `mp-fix-douyin-validity`
> 关联: PRD-ACCOUNT-LOGIN-STATUS-CHECK.md（升级 v2.1）| 前序: FIX-EXPIRED-BANNER-STALE-STATUS.md（PR #1738，横幅脏数据——本修复是该文中「真实检测准确性」的下半场）

---

## 1. 问题现象（用户报告）

1. 应用启动后，主页横幅提示 3 个自媒体账号「已失效」，并提供【批量登录】入口。
2. 点击【批量登录】后为 3 个账号各打开一个平台登录标签页。
3. 其中 2 个平台确实已失效，但**抖音打开后仍是已登录状态**——检测结论与真实登录态矛盾（假阳性：有效被判失效）。

## 2. 根因分析（证据链）

### 2.1 检测链路

```
Home.vue 挂载 → useExpiredAccountsBanner.refresh()（src/composables/useExpiredAccountsBanner.js:23-57）
  → accountBatchCheckLogin(ids) → IPC accounts:batch-check-login（electron/ipc-handlers/account.js:420）
    → AccountManager.checkLoginStatus（electron/publishers/account-manager.js:433）
      → loadSavedCredentials 读加密凭证 → isPlatformCookieDomain 过滤（:471,760-786，douyin→douyin.com，过滤规则正常）
      → tryHttpLoginCheck HTTP 快速路径（:499，<1s）
        → 结果 valid===undefined 才降级 Playwright 隐藏浏览器检测（:505-570，4-8s）
        → 浏览器异常再回退 checkLocalCredentials（:574-583）
      → 30 分钟周期监控 login-status-monitor.js:52-86 复用同一检测，!valid → store status='expired'
```

**关键事实**：批量登录页（`accounts:batch-open-login` → `tabStore.createTab`，按 `account-{accountId}` session 分区恢复**同一份加密凭证 Cookie**）与 HTTP 检测用同一凭据——用户看到「检测说失效、页面却已登录」，直接证明是**检测侧误判**，不是凭据分裂。

### 2.2 根因：白名单语义 + 状态码一刀切（http-login-checker.js，修复前）

| 位置（修复前行号） | 修复前行为 | 问题 |
|---|---|---|
| `:35` douyin check | 仅 `status_code===0 且有 uid/user_id/nickname` → 有效；**其余一切 → 失效** | 白名单语义：任何非预期响应都判死刑 |
| `:142-146` 3xx | 301/302/303/307 一律 → 失效 | 风控跳转（如 `/verify`）≠ 登录页跳转 |
| `:148-150` 非 2xx | 任何非 2xx（404/429/5xx）一律 → 失效 | 临时故障/风控拦截 ≠ Cookie 失效 |
| `:162-165` JSON 判定 | check 返回 false → 失效 | 结构变更/非 JSON（data=null）→ 失效 |

### 2.3 为什么抖音最受伤

- 检测请求是 Node fetch：TLS 指纹（undici）+ 固定 UA `Chrome/120`（`:129`）+ 无 `a_bogus` 等签名，与用户登录浏览器环境不一致。
- 抖音 creator API 风控对这类「环境不一致」请求返回风控页/302/非 0 status_code 的概率高。
- Cookie 实际有效（浏览器打开仍是登录态），但 API 响应非预期 → 被判失效。

### 2.4 意图溯源（参考产品对照）

参考产品逆向（`01-docs/ref-product-reverse/asar-extract/app/packages/main/dist/index.cjs`）：

| 项 | 参考产品 checkAccountAlive | 本项目修复前 |
|---|---|---|
| 判定语义 | **黑名单**：`code===8` 或 msg 含「未登录」才判失效 | 白名单：非预期即失效 |
| 网络异常/未知码 | 返回 `-1`（未知），**不判失效** | 一律失效 |
| 端点策略 | 4 渠道轮询（pc/creator/xigua/media user-info） | 单端点 |

本项目搬运了端点但**反转了语义**——误报引入点。（注：仓库历史已 squash，代码位于 `29a9a3517`，无法向前追溯更早引入提交。）

### 2.5 已排除的候选根因

- ❌ cookie domain 过滤：`douyin.com` 允许子域，规则正常（platform-definitions.js:112-117,175-185）
- ❌ fake-IP 代理：Node fetch 连 198.18.x.x 失败会走 fetch 异常 → 降级浏览器，不会产生误判
- ❌ expiresAt 时间戳：不存在该机制
- ❌ 检测/登录页凭据不一致：两者用同一份加密凭证（§2.1）

## 3. 修复方案：黑名单语义 + 三态判定

### 3.1 设计原则

> **只有平台明确告知「未登录」才判失效；一切不确定响应返回 `undefined` 降级到浏览器真实检测。**

三态模型：

| check 返回 | 语义 | 下游行为 |
|---|---|---|
| `true` | 明确有效 | `CHECK_LOGIN_SUCCESS_HTTP_API`，直接采用 |
| `false` | 明确失效（平台明确告知未登录） | `CHECK_LOGIN_COOKIE_EXPIRED`，直接采用 |
| `undefined` | **不确定**（风控页/结构变更/非预期状态码） | `CHECK_LOGIN_INCONCLUSIVE` → `tryHttpLoginCheck` 返回 null → 降级 Playwright 浏览器检测 |

### 3.2 改动明细（apps/desktop/electron/publishers/http-login-checker.js）

**douyin check 三分支**：

```js
check: (data) => {
  if (!data || typeof data !== 'object') return undefined            // 风控页/非 JSON → 降级
  if (data.status_code === 0 && data.data && (data.data.uid || data.data.user_id || data.data.nickname !== undefined)) return true
  if (data.status_code === 8) return false                           // 对齐参考产品：8=明确未登录
  const msg = data.status_msg || data.msg || data.message
  if (typeof msg === 'string' && msg.includes('未登录')) return false // 文案明确未登录 → 失效
  return undefined                                                   // 其余一切 → 降级
}
```

**HTTP 状态码黑名单化（对全部平台生效——同类误报的系统性修复）**：

| 响应 | 修复前 | 修复后 |
|---|---|---|
| 3xx 且 Location 含 `/login|passport|signin|sso/i` | 失效 | **失效**（明确登录页跳转） |
| 3xx 其他（含拿不到 Location） | 失效 | **inconclusive → 降级** |
| 401 / 403 | 失效 | **失效**（平台明确未授权） |
| 404 / 429 / 5xx 等其余非 2xx | 失效 | **inconclusive → 降级** |
| 2xx + douyin JSON `status_code===8`/「未登录」 | 失效 | **失效**（不变） |
| 2xx + douyin JSON 有效结构 | 有效 | **有效**（不变） |
| 2xx + douyin JSON 其他（风控码/缺字段） | 失效 | **inconclusive → 降级** |
| 2xx + 非 JSON（data=null，douyin） | 失效 | **inconclusive → 降级** |
| fetch 异常/超时 | 不确定 → 降级 | **不变** |

**其他平台影响面**：

- JSON 判定行为**零变化**（toutiao/bilibili/wechat_mp/tencent_video 的 check 函数未动，仍返回 boolean）
- 状态码处理全局生效：这些平台遇 404/429/5xx 从「误判失效」变为「降级浏览器确认」——是**正确性提升**（同一类潜在误报的消除），代价是此类场景慢 4-8s
- 公众号 `checkHtml` 正则路径不变；bilibili `precheck`（缺 bili_jct 即失效）不变；视频号 errCode 300333/300334 显式黑名单不变

**typedef 同步**：`check` 签名扩为 `(data:any)=>boolean|undefined`（http-login-checker.js:27），undefined=不确定（降级）。

### 3.3 降级链路（既有机制，零修改承接新语义）

```
checkLoginViaHttpApi 返回 {valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE'}
  → tryHttpLoginCheck（:196-199）valid===undefined → return null
  → AccountManager.checkLoginStatus（:499-500）null → 走 Playwright 隐藏浏览器 DOM 检测（:505-570）
  → 浏览器检测异常 → 回退 checkLocalCredentials（:574-583）
```

## 4. 数据校验

| 环节 | 校验 | 说明 |
|---|---|---|
| 凭证输入 | `cookiesToHeader` 过滤空 name/value | 不变 |
| 无 Cookie | `CHECK_LOGIN_NO_CREDENTIAL` 判失效 | 不变（无凭据=必然未登录） |
| bilibili precheck | Cookie 头必须含 `bili_jct=` | 不变 |
| JSON 解析失败 | `data=null` → douyin 走 undefined 降级；其他平台维持 check(null)=false | 变化点见 §3.2 |
| 降级结果采用 | 浏览器检测结果具有最高优先级（真实 DOM/URL 证据） | 既有逻辑 |
| 判定结果持久化 | `accountUpdate(id, {status, last_validated})` 白名单校验 + `sanitizeUpdateFields` 防 SQL 注入 | 不变（PRD v2.0 §11.1） |
| 状态推导 | `toPublicAccount` 优先级：2 小时内 last_validated 的 expired 尊重检测结果，否则回退本地凭证检测 | 不变（PRD v2.0 §11.2） |

## 5. 流程（修复后完整视角）

### 5.1 单账号登录态检测

```
checkLoginStatus(platform, accountId)
  ├─ 无本地凭证 → expired（本地判定，不发请求）
  ├─ 平台已注册 HTTP 检测且有 Cookie
  │    ├─ 明确有效（API 结构正确 / 2xx+有效 JSON）      → active（<1s）
  │    ├─ 明确失效（8/未登录文案/401/403/登录页 302）   → expired（<1s）
  │    └─ 不确定（风控页/结构变更/429/5xx/非登录 3xx）  → 降级 ↓（+4-8s）
  ├─ Playwright 隐藏浏览器 DOM/URL 检测 → 采用结果
  └─ 浏览器检测异常 → checkLocalCredentials 兜底
```

### 5.2 用户侧流程（主页横幅 → 批量登录）

```
启动 → useExpiredAccountsBanner.refresh() 逐账号真实检测 → 横幅计数
  → 点击【批量登录】→ accounts:batch-open-login → 逐平台开标签页（同份 Cookie）
  → 真实有效的账号不会再出现在横幅中（修复点）
```

## 6. 功能逻辑要点

1. **黑名单优先**：失效判定必须有平台明确证据（专用错误码 / 未登录文案 / 401/403 / 登录页重定向）。
2. **不确定即降级**：`CHECK_LOGIN_INCONCLUSIVE` 是新增结果码，语义 = 「本次 HTTP 检测无法给出结论」，绝不直接映射为失效。
3. **渐进增强**：快速路径仍是 <1s；只有不确定场景付出浏览器检测代价。正常账号与真失效账号的检测速度不变。
4. **日志可观测**：inconclusive 路径均打 `HttpLoginChecker` 日志（含 redirect location / HTTP 状态 / data keys），便于未来抓包验证风控形态。

## 7. 交互逻辑与显示项

- **无新增 UI 组件/无新增显示项/无新增交互**：横幅、账号卡片、批量登录行为全部不变。
- **状态语义变化**：主页横幅与账号管理页的「已失效」标签现在只代表「平台明确未登录或浏览器检测确认失效」；被风控误伤的有效账号不再出现。
- **耗时感知**：极端情况（平台持续风控拦截 HTTP 检测）下，该账号检测从 <1s 变为 4-8s（走浏览器降级）；一键检测进度遮罩照常展示「检测中 X/N」，无需用户额外操作。

## 8. 提示文字

- **零新增文案**（zh/en 均无变化，i18n 门禁 CJK 扫描 1410 条 < 基线 1644，无新增硬编码）。
- 既有文案保持：`home.loginExpiredBanner.title/description/hint/batchLoginBtn`（zh.js:1006-1013）。
- 失效语义更准了，但提示措辞（「登录失效提醒 / X 个账号待处理」）无需调整。

## 9. 测试与验证

### 9.1 回归测试（http-login-checker.test.js，28 例全绿）

新增/改写用例覆盖判定矩阵：

| 用例 | 期望 |
|---|---|
| douyin `status_code===8` | expired（原断言保留并更名） |
| douyin `msg 含「未登录」`（status_code:2） | expired ✚ |
| douyin `status_code:9`（风控码） | inconclusive ✚ |
| douyin 200+非 JSON（data=null） | inconclusive ✚ |
| 302 且 Location 含 login 特征 | expired（原断言保留并更名） |
| 302 Location 无登录特征（/verify） | inconclusive ✚ |
| 302 拿不到 Location | inconclusive ✚ |
| 401/403 | expired ✚ |
| 404/429/500 | inconclusive ✚ |
| 其他平台既有断言（toutiao/bilibili/wechat_mp/tencent_video） | 全部保持通过（JSON 零变化） |
| 网络错误/超时 → 降级 | 原断言保留 |

### 9.2 降级链路回归（account-manager.test.js，52 例全绿）

- `tryHttpLoginCheck` mock 返回 null → 浏览器检测路径承接
- 公众号「302 到登录页必须判失效」回归用例通过（域名兜底先于 login 检查的既有保护不变）

### 9.3 静态门禁

- eslint 两个改动文件 0 error
- `check-locale-sync --cjk` PASS（1410 < 基线 1644，无新增硬编码中文）
- 无 IPC/preload 变更 → 契约门禁 4 处连锁零涉及；无 i18n 键变化 → `--keys` 门禁零涉及

## 10. 已知边界与后续建议

1. **性能边界**：平台持续风控时该账号每次检测 +4-8s（30 分钟周期监控与一键检测均受影响）；可接受，未来可用「inconclusive 结果短窗缓存」平滑。
2. **toutiao 同类白名单隐患（已知债）**：`code!==0 且非明确未登录码` 仍判失效（本次仅按用户报告修 douyin，其他平台 JSON 判定未动）；建议后续按需复制三态模式。
3. **多端点轮询（方案 B，未采用）**：参考产品 4 渠道轮询可作为后续加固项；不解决语义缺陷本身，暂缓。
4. **运行时验证**：静态分析三种风控形态（302/非2xx/非0码）都会走降级；具体是哪种可通过 `HttpLoginChecker` 日志确认（`→ inconclusive → fallback`）。

## 11. 质量节拍 QM-5 五步（Bug 反思循环）

| 步骤 | 内容 |
|---|---|
| 根因溯源 | 白名单语义 + 状态码一刀切（§2.2-2.4），参考产品对照定案 |
| 逃逸分析 | 单测「status_code 非 0 → expired」把误判行为**固化成断言**（修复前 :94-104），测试只验证了实现而不是需求 |
| 系统性漏洞 | 状态码一刀切影响全部 5 平台（404/429/5xx 均可能误报）→ 本次一并黑名单化；toutiao JSON 白名单登记为已知债（§10.2） |
| 回归测试 | 判定矩阵 10 类场景 + 降级链路 52 例（§9） |
| 预防措施 | 判定语义写入 http-login-checker.js 顶部注释 + typedef `boolean|undefined`；本文件作为判定矩阵权威参考 |
