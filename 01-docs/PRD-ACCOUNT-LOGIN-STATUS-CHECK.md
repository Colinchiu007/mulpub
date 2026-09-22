# PRD: 账号登录状态自动检测与主页提醒

> 版本: 2.3 | 日期: 2026-09-22 | 状态: 已实现
> 关联 PR: #1558（v1）、#1804（session cookie 路径修复）、#1805（v2.0：检测反馈 + 失效标识 + 结果持久化 + 公众号 HTTP 检测）、v2.1（2026-09-16 三态判定修复：HTTP 检测黑名单语义，修复抖音假阳性，详见 BUGFIX-LOGIN-CHECK-FALSE-EXPIRED-2026-09-16.md 与本文 §14）、v2.2（2026-09-22 登录态检测口径统一：四平台黑名单语义收口 + 保存凭证回写 active + 首页横幅检测回写，详见 BUGFIX-LOGIN-STATE-CONSISTENCY-2026-09-22.md 与本文 §15）

## 1. 需求背景

不同内容平台的账号登录具有不同的时效（Cookie/Session 过期时间不同）。用户可能在应用关闭期间，平台 Cookie/会话已经过期，但当下次启动应用时并不知情。如果用户用已失效的账号进行发布，会导致发布失败。

现有系统在账号列表加载时仅做本地凭证存在性检测（`checkLocalCredentials`），不做真实网络验证，无法及时发现 Cookie 过期。

## 2. 功能目标

### 2.1 启动时自动检测失效账号
- 应用启动时，主页自动从账号 Store 中筛选 `status === 'expired'` 的账号
- 这里的 `expired` 状态由主进程 `toPublicAccount` 逻辑推导：本地无加密凭证 → `status` 强制置为 `'expired'`
- 有凭证但 `status` 为 `'active'` 的账号不在此列（需要主动触发 `checkLogin` 做 Playwright 真实校验）

### 2.2 主页登录失效提醒横幅
当有失效账号时，在主页欢迎区与数据概览之间显示横幅：

| 显示项 | 内容 | i18n key |
|--------|------|----------|
| 标题 | 登录失效提醒 | `home.loginExpiredBanner.title` |
| 描述 | X 个账号待处理 | `home.loginExpiredBanner.description` |
| 说明 | 不同平台的登录具有不同的时效。请完成已失效账号的登录验证，以免影响发布。 | `home.loginExpiredBanner.hint` |
| 按钮 | 【批量登录】 | `home.loginExpiredBanner.batchLoginBtn` |

### 2.3 批量登录
点击【批量登录】按钮后：
1. 收集所有失效账号的 ID 列表
2. 调用 `accounts:batch-open-login` IPC 获取各平台的登录 URL
3. 对每个失效账号，通过 `tabStore.createTab` 打开对应平台的登录标签页
4. 标签页标题格式：`登录 - {平台名称}`

## 3. 数据校验

### 3.1 渲染层 → 主进程
- `accountId` 必须经过 `_isSafePathSegment` 校验（仅允许字母/数字/下划线/短横线）
- 拒绝包含 `/`、`?`、`#`、`..` 等路径操纵字符的 accountId
- `platform` 同样必须经过安全校验

### 3.2 主进程 → 渲染层
- 账号列表经 `toPublicAccount` 过滤白名单字段
- `login_check_error` 和 `status_reason` 经 `toPublicErrorValue` 脱敏（截断到 240 字符，脱敏 token/密钥）
- 所有账号字段必须通过 `publicAccountFields` 白名单

### 3.3 批量检测
- 单账号检测失败不中断整体流程
- 每个账号的检测结果独立记录到 `results` 数组
- 返回 `checkedAt` ISO 时间戳

## 4. 流程

### 4.1 启动检测流程
```
App.vue 挂载 Home 组件
  → onMounted
    → accountStore.ensureLoaded()  // 幂等加载账号列表
    → 筛选 account.status === 'expired'
    → 设置 expiredAccountCount / showExpiredBanner
    → 如果 expiredCount > 0，显示横幅
```

### 4.2 批量登录流程
```
用户点击【批量登录】
  → handleBatchLogin()
    → 收集 expiredAccounts 的所有 ID
    → 调用 accountBatchOpenLogin(expiredAccountIds)
    → IPC: accounts:batch-open-login
      → 校验每个 accountId 安全路径段
      → AccountManager.listAccounts()
      → 从 PLATFORM_LOGIN_URLS 获取各平台登录 URL
      → 返回 { items: [{accountId, platform, name, loginUrl}] }
    → 遍历 items，逐项调用 tabStore.createTab({ url, platform, accountId, title })
      → 主进程 WebviewManager 创建新标签页
      → 按账号持久化 session 分区
```

### 4.3 批量检测流程（账号管理页「一键检测」）
```
用户点击【一键检测】（账号管理页）
  → batchCheckAllLogins()
    → 校验 batchCheckAllBusy（防重复触发）
    → 校验账号列表非空
    → 设置 batchCheckAllBusy = true，verifyingIds = 全部账号
    → 订阅 accounts:batch-check-progress 事件（逐账号进度）
    → 调用 accountBatchCheckLogin(全部账号 ID)
      → IPC: accounts:batch-check-login
        → 校验 owner subject
        → AccountManager.listAccounts()
        → 顺序执行 AccountManager.checkLoginStatus(platform, accountId)
          → 优先 HTTP API 快速路径（<1s/平台，含公众号）
          → 无 HTTP 检测的平台走 Playwright 无头浏览器 DOM 检测
          → 返回 { valid, code }
        → 返回 { results: [{platform, accountId, valid, code, error?}], checkedAt }
    → 按结果更新本地 account.status（active / expired）+ last_validated
    → 调用 accountUpdate(id, { status, last_validated }) 写回后端（持久化）
    → 更新 checkedExpiredIds（失效账号集合）
    → 汇总提示正常/失效数量
    → 复位 batchCheckAllBusy / verifyingIds

检测期间屏幕中央显示进度遮罩（batch-check-overlay）：
  - 旋转 spinner + 「正在检测账号登录状态」标题 + 「检测中 X/N：平台」进度 + 进度条
```

## 5. 功能逻辑

### 5.1 横幅显示逻辑
- `showExpiredBanner = expiredAccountCount > 0`
- 用户可点击 ✕ 关闭横幅（`showExpiredBanner = false`）
- 横幅关闭后本次会话不再显示（除非刷新页面重新挂载）
- 如果所有失效账号都处理完毕，下次加载时横幅自动消失

### 5.2 批量登录逻辑
- 收集当前 `expiredAccounts` 中的所有 ID
- 调用 IPC 获取 URL 列表
- 逐个打开标签页（顺序执行，避免浏览器资源竞争）
- 标签页使用 `account-{accountId}` session 分区，自动恢复加密凭证 cookie
- 注意：标签页模式无凭证捕获机制，登录成功后需在账号管理页手动确认

### 5.3 组件交互
- `LoginExpiredBanner` 组件 Props: `visible` (Boolean), `expiredCount` (Number)
- Emits: `batch-login`, `dismiss`
- 所有文案通过 `t('home.loginExpiredBanner.*')` 获取

## 6. 交互逻辑

### 6.1 横幅样式
- 背景色：`#fef0f0`（浅红），边框：`1px solid #fbc4c4`
- 标题：14px, font-weight 600, `#c45656`
- 描述：13px, `#e67474`
- 提示：12px, `#999`
- 按钮：背景 `#f56c6c`，白色文字，hover 透明度 0.9
- 关闭按钮：右侧 ✕，无边框背景

### 6.2 状态变化
- 无失效账号：横幅不显示
- 有失效账号：横幅显示在欢迎区与数据概览之间
- 点击关闭：横幅消失
- 点击批量登录：触发批量登录流程，打开多个标签页

## 7. 显示项

| 元素 | 位置 | 内容 | 条件 |
|------|------|------|------|
| 横幅容器 | Home.vue 欢迎区与数据概览之间 | LoginExpiredBanner 组件 | showExpiredBanner = true |
| 图标 | 横幅左侧 | ⚠️ emoji | 始终 |
| 标题 | 图标右侧 | 登录失效提醒 | 始终 |
| 计数 | 标题下方 | {count} 个账号待处理 | 始终 |
| 说明 | 计数下方 | 不同平台的登录具有不同的时效... | 始终 |
| 按钮 | 说明右侧 | 批量登录 | 始终 |
| 关闭 | 按钮右侧 | ✕ | 始终 |

## 8. 技术架构

### 8.1 新增 IPC 通道
| 通道 | 方向 | 功能 |
|------|------|------|
| `accounts:batch-check-login` | renderer → main | 批量检测账号登录状态 |
| `accounts:batch-open-login` | renderer → main | 返回批量登录 URL 列表 |

### 8.2 新增组件
| 组件 | 路径 | 功能 |
|------|------|------|
| `LoginExpiredBanner` | `apps/desktop/src/components/LoginExpiredBanner.vue` | 登录失效提醒横幅 |

### 8.3 修改文件
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `electron/ipc-handlers/account.js` | 新增 | 2 个 IPC handler |
| `electron/preload/account.js` | 新增 | 2 个 preload 方法 |
| `src/api/publisher.js` | 新增 | 2 个 API 封装 |
| `src/views/Home.vue` | 修改 | 集成横幅 + 批量登录 |
| `src/locales/zh.js` | 新增 | 6 个中文 key |
| `src/locales/en.js` | 新增 | 6 个英文 key |

## 9. 测试

### 9.1 单元测试
- `LoginExpiredBanner.test.js`：visible 控制、文案渲染、batch-login 事件、dismiss 事件
- `Home.test.js`（新增）：横幅显示/隐藏、批量登录触发、横幅关闭

### 9.2 集成验证
- 18/18 测试通过
- locale `--keys` 门禁通过（739 个 key 均存在于 zh/en）
- zh/en 成对检查通过

## 10. 关于"定期检查"和"启动时检测"

### 启动时检测
**已实现。** 应用启动时，Home.vue 的 `onMounted` 中调用 `accountStore.ensureLoaded()` 加载账号列表，然后筛选 `status === 'expired'` 的账号显示横幅。这里的 `expired` 状态由主进程 `toPublicAccount` 推导：`checkLocalCredentials` 检查本地加密凭证是否存在，无凭证则强制设为 `expired`。

### 定期检查（定时轮询）
**当前未实现前端定时轮询。** 原因分析：
- 现有 `account:check-login` 每次调用启动一次 Playwright 无头浏览器，耗时 10-30 秒/账号
- 如果用户有 10+ 个账号，全量检测耗时 3-5 分钟，不适合前台定时轮询
- 已新增 `accounts:batch-check-login` IPC 通道，未来可配合后台定时任务使用
- 建议未来实现方案：Electron 主进程后台定时任务（如每小时），静默调用 `batch-check-login`，结果通过 `account:status-changed` 事件推送到渲染层

## 11. 检测结果持久化（v2.0 已实现）

一键检测结果通过 `accountUpdate(id, { status, last_validated })` 写回后端数据库（accounts 表新增 `last_validated` 列）。退出账号管理页再进入时，列表加载能读到本次检测结果。

### 11.1 数据校验
- `accountUpdate` 的 `status` / `last_validated` 字段经 `rendererAccountUpdateFields` 白名单校验
- `store.updateAccount` 经 `sanitizeUpdateFields` 白名单过滤（防 SQL 注入）
- `last_validated` 为 ISO 时间戳字符串

### 11.2 状态推导优先级（toPublicAccount）
```
后端 status = expired 且 last_validated 在 2 小时内（一键检测写回）
  → 尊重检测结果，status = expired
否则
  → 回退到 checkLocalCredentials（本地凭证文件检测）
    → hasCred = true → status = active（覆盖陈旧 expired）
    → hasCred = false → status = expired
```

### 11.3 失效账号卡片标识
账号卡片 `statusLabel` 区分三种状态：
- `active` / `online` → 「已登录」（绿色）
- `expired` → 「已失效」（红色，v2.0 新增）
- `inactive` / `offline` → 「已登录」（灰色，未检测语义）
- `error` → 「异常」（红色）

## 12. 公众号失效检测（v2.0 已实现）

### 12.1 问题
公众号登录页与后台同域（mp.weixin.qq.com）。Cookie（slave_sid）过期后访问后台首页可能仍渲染骨架、URL 停在 cgi-bin/home，DOM 选择器检测会误判有效。

### 12.2 修复
`http-login-checker.js` 为公众号注册 HTTP API 检测（对齐参考产品 `getWeixingongzhonghaoUserInfo`）：
- 访问 `https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome`（GET，带 Cookie + Referer）
- 用 `checkHtml` 正则解析返回 HTML：`&token=[0-9a-zA-Z]{3,}`（或 `token=[0-9a-zA-Z]{3,}`）与 `uin:"[0-9]{3,}"` 同时存在 → 判有效（CHECK_LOGIN_SUCCESS_HTTP_API）
- token/uin 任一缺失 → 判失效（CHECK_LOGIN_COOKIE_EXPIRED）
- 采用 loginpage 正则而非「访问后台首页看 302」的原因：Cookie（slave_sid）过期后访问 `cgi-bin/home` 仍可能返回 200 渲染后台骨架，但 loginpage 页面未登录时不会内嵌 token/uin

### 12.3 数据校验
- Cookie 数组经 `cookiesToHeader` 转请求头（过滤空 name/value）
- 请求前无 Cookie → `CHECK_LOGIN_NO_CREDENTIAL` 判失效
- **v2.1 语义**（黑名单）：
  - 302/301/303/307 且 Location 含登录特征（`/login|passport|signin|sso/i`）→ 失效；其他重定向 → `CHECK_LOGIN_INCONCLUSIVE` 降级浏览器检测
  - HTTP 401/403（明确未授权）→ 失效；其余非 2xx（404/429/5xx）→ `CHECK_LOGIN_INCONCLUSIVE` 降级
  - JSON 判定返回 `undefined`（不确定：风控页/结构变更/非预期状态码）→ `CHECK_LOGIN_INCONCLUSIVE` 降级
- 网络错误 / 超时返回 `valid: undefined`，降级到浏览器 DOM 检测（不误判失效）
- 超时阈值 `HTTP_CHECK_TIMEOUT_MS = 8000`

> ⚠️ v2.0 原语义「HTTP 非 2xx → 失效」「重定向 → 失效」已在 v2.1 废弃：非预期响应 ≠ Cookie 失效（抖音风控假阳性根因，见 §14）。

## 13. 未来扩展

- 定时后台检测：利用 `accounts:batch-check-login` + Electron 主进程定时器
- 通知提醒：检测到失效时发送系统通知
- 检测结果过期策略：2 小时窗口可配置化

## 14. HTTP 检测三态判定（v2.1，2026-09-16）

> 详细根因证据链、判定矩阵、测试清单见 `01-docs/BUGFIX-LOGIN-CHECK-FALSE-EXPIRED-2026-09-16.md`。

### 14.1 问题
抖音账号 Cookie 实际有效（批量登录打开页面仍为登录态），但被主页横幅标记「已失效」。根因：`http-login-checker.js` 白名单语义——仅响应完全符合预期才判有效，302/非 2xx/JSON 结构不符一律判失效；抖音风控拦截 Node fetch 检测请求（TLS 指纹/固定 UA 与登录浏览器不符）返回非预期响应 → 假阳性。参考产品逆向语义为黑名单（仅 `code===8`/「未登录」判失效 + 4 端点轮询），本项目搬运端点时反转了语义。

### 14.2 三态判定模型
| check 返回 | 语义 | 结果码 | 下游 |
|---|---|---|---|
| `true` | 明确有效 | `CHECK_LOGIN_SUCCESS_HTTP_API` | 直接采用 |
| `false` | 平台明确告知未登录 | `CHECK_LOGIN_COOKIE_EXPIRED` | 直接采用 |
| `undefined` | 不确定（风控页/结构变更/非预期状态码） | `CHECK_LOGIN_INCONCLUSIVE`（v2.1 新增） | 降级 Playwright 浏览器检测（既有链路零修改承接） |

明确失效证据（黑名单）：douyin `status_code===8` 或 status_msg/msg 含「未登录」；HTTP 401/403；3xx 且 Location 含 `/login|passport|signin|sso/i`。

### 14.3 影响面
- douyin JSON 判定改三分支；HTTP 状态码黑名单化对**全部平台**生效（404/429/5xx 从误判失效改为降级确认，同类潜在误报一并消除）
- 其他平台 JSON 判定零变化；公众号 checkHtml / bilibili precheck / 视频号 errCode 黑名单均不变
- 代价：不确定场景 +4-8s（浏览器降级）；正常/真失效账号检测速度不变
- ~~已知债：toutiao JSON 判定仍为白名单语义，后续按需复制三态模式~~（v2.2 已销账：toutiao/bilibili/tencent_video/wechat_mp 四平台全部收口三态语义，见 §15）

### 14.4 测试
`http-login-checker.test.js` 28 例（新增 8 例覆盖判定矩阵）；`account-manager.test.js` 52 例降级链路回归；eslint 0 error；CJK 门禁无新增。

## 15. 登录态检测口径统一（v2.2，2026-09-22）

> 完整根因证据链、判定矩阵、逃逸分析见 `01-docs/BUGFIX-LOGIN-STATE-CONSISTENCY-2026-09-22.md`。

### 15.1 问题（用户报告两现象）
- **现象 A**：主页横幅显示 5 个失效，账号页【一键检测】只有 2 个失效——横幅与账号页各自独立实时检测，横幅**只读不回写**，账号页回写，两处计数无统一持久化事实来源；HTTP 检测的风控抖动（见 15.2）放大差异。
- **现象 B**：批量登录标签已登录头条号并点【保存账号】，账号页【一键检测】仍报失效——`updateCapturedAccount` 只 PATCH 元数据不回写 `status=active`，DB 残留 expired + 新 last_validated 落入 §11.2 `backendExpiredFresh` 2 小时窗口被持续压制；且 toutiao HTTP 检测白名单语义对新 Cookie 也假阳性并短路浏览器检测。

### 15.2 三处修复
1. **http-login-checker 四平台收口黑名单三态语义**（延续 §14 契约到 toutiao/bilibili/tencent_video/wechat_mp）：
   - toutiao：`code===0 && user.(id||user_id)` → true；message/msg/status_msg 含「未登录/请先登录/登录过期/重新登录」→ false；其余 → undefined 降级
   - bilibili：`code===0 && data.mid` → true；`code===-101` → false；其余（风控 -352 等）→ undefined
   - tencent_video：`errCode===0 && finderUser` → true；`errCode 300333/300334` → false；其余 → undefined
   - wechat_mp（HTML）：token+uin → true；无 token 且含登录页特征（扫码登录/请使用微信扫码/请登录/welcome_login）→ false；空响应/风控页 → undefined（`checkHtml` 返回值放宽为 `boolean|undefined`，HTML 分支新增 INCONCLUSIVE 处理）
2. **updateCapturedAccount 保存凭证即回写 active**：PATCH 移到 `saveCredential` 成功之后（消除半成功状态），PATCH 体携带 `status:'active'` + `last_validated`；返回对象含 `status:'active'` 供调用方复用。
3. **首页横幅检测结果统一回写**：`useExpiredAccountsBanner.refresh()` 检测成功后逐账号 `accountUpdate(id, {status: valid?'active':'expired', last_validated: checkedAt}).catch(()=>{})`，与账号页 `batchCheckAllLogins` 完全同口径；code≠0 不回写、单账号失败不阻断。

### 15.3 一致性不变量
任何一处批量检测或凭证保存完成后，DB 的 `status + last_validated` 被刷新为最近一次真实结果；横幅与账号页都经 `toPublicAccount` 读同一份持久化状态。两处瞬时差异只可能来自"两次真实检测"（平台会话实时变化），不再来自口径分裂。

### 15.4 数据校验与安全
- 横幅回写复用 `accountUpdate` 既有白名单校验链（`rendererAccountUpdateFields` + `sanitizeUpdateFields`），不新增 IPC 通道；
- `updateCapturedAccount` PATCH 的 status 仅限服务端常量 `'active'`，不接收渲染层传入的任意 status（防越权改状态）；
- results 中缺 accountId 的条目跳过回写；空 results 不触发写操作。

### 15.5 交互与显示（无文案变更）
横幅/一键检测/账号卡片所有 i18n 文案与显示项不变。用户可感知变化：①保存账号后自动刷新即显示「已登录」；②风控抖动不再使横幅计数随机虚高；③不确定场景单账号检测 +4-8s（浏览器降级），进度遮罩照常展示。

### 15.6 回归保护测试
- `http-login-checker-blacklist.test.js`（新增 14 例）：四平台 true/false/undefined 三态矩阵；
- `account-manager-relogin-status.test.js`（新增 2 例）：PATCH 携带 active + 凭证失败不回写（顺序契约）；
- `useExpiredAccountsBanner.test.js`（新增 3 例）：统一回写/失败不回写/回写失败不阻断；
- `http-login-checker.test.js` 更新 1 例：公众号 expired fixture 补明确登录页特征。
- 门禁：新增平台 HTTP 检测注册时，三态样本（true/false/undefined）齐备才算完成（以 blacklist 测试为模板）。


---

## 16. 登录态真源与三态统一（v2.3，2026-09-23）

> 本节是对 §2.1、§11（检测结果持久化）、§14、§15 的**口径修订**；凡与本文早前描述冲突处，以本节与
> `PRD-ACCOUNT-LOGIN-STATE-PERSISTENCE-2026-09-23.md` 为准。完整数据模型、判定矩阵、交互与文案、
> 测试矩阵、已知边界均写在该新文档中，此处只记录"改了什么、为什么、以及哪些旧描述作废"。

### 16.1 触发缺陷

| 编号 | 用户可见现象 |
|------|--------------|
| D1 | 账号页一键检测显示部分账号「已失效」，退出再进入又显示「已登录」→ 检测结论未固化 |
| D2 | 今日头条号已登录并保存凭证后仍被显示「已失效」→ 假阴性 |
| D3 | 视频号一键检测显示「已登录」，实际已失效 → 假阳性 |

### 16.2 六条根因（RC-A ~ RC-F）

- **RC-A 双库分裂**：读侧真源是后端 `accounts.json`，而 `Accounts.vue` 一键检测、`useExpiredAccountsBanner`
  首页横幅、`login-status-monitor` 定期检测三处写侧都写 Electron 本地 SQLite（`store:update-account`），
  两库 accountId 不互通，写入永不生效，且 `.catch(() => {})` 静默 → **D1**。
- **RC-B 422**：保存凭证的 PATCH 带 `status:'active'`，后端 `AccountUpdateRequest` 为
  `ConfigDict(extra="forbid")` 且无 `status` 字段 → 实测 `PATCH /api/accounts/xxx status=422`，
  重新登录也无法清除失效标记。
- **RC-C `cookies.getAll` 不存在**：Electron `Session.cookies` 只有 `get/set/remove/flush`；
  保存链路调用 `getAll({})` 抛 TypeError 被吞 → 存下的凭证 `cookies` 恒为 0 条（日志 `cookies=0 lsKeys=13`）。
- **RC-D 降级语义反向**：`toutiao`/`baijiahao` 无加密 Cookie 即 fast-path 判失效（**D2**）；
  `tencent_video` 无 Cookie 降级到"本地凭证文件存在"→ `CHECK_LOGIN_SUCCESS_LOCAL_ONLY valid:true`（**D3**）。
- **RC-E 2 小时窗口 + 凭证推翻**：`toPublicAccount` 只在 `last_validated` 距今 <2h 时尊重后端 expired，
  超窗后又因"本地存在凭证文件"把 expired 翻回 active → 检测结论最长 2 小时后自动蒸发。
- **RC-F timestamp 冻结**：`http-login-checker` 视频号 POST 的 `body` 写在模块级常量，
  `Date.now()` 只在 require 时求值一次。

### 16.3 新口径（作废旧描述的条目）

| 旧描述（本文早前章节） | 新口径 |
|------------------------|--------|
| §2.1「本地无加密凭证 → status 强制置 expired；有凭证且 status 为 active 不在此列」 | 保留「无凭证 → expired」；但 **active/expired/unverified 一律以后端 status 为准（粘滞）**，不再有 2 小时窗口，不再被"本地存在凭证文件"推翻 |
| §11「检测结果写回 DB + 2 小时内尊重」 | 2 小时窗口作废。**登录态唯一写者 = 主进程 `AccountManager.persistLoginState()`**（后端 PATCH）；渲染层禁止写 `status`，monitor 禁止读写 SQLite 账号表 |
| 降级返回 `valid:true`（`CHECK_LOGIN_SUCCESS_LOCAL_ONLY`） | 作废。改为 `valid: undefined` + `CHECK_LOGIN_INCONCLUSIVE`；**「凭证文件存在」永远不是正向证据** |
| 无 Cookie 即判 `CHECK_LOGIN_COOKIE_EXPIRED`（toutiao/baijiahao fast-path） | 作废。判定基于「加密凭证 + 账号级 session 分区」合并后的 Cookie 集合；合并后仍为 0 且属强依赖 Cookie 平台才判失效 |
| 批量检测 `valid: Boolean(status.valid)` | 作废。三态透传：`undefined`（未确认）既不计入失效，也不冒充已登录 |
| 账号 status 仅 active/expired | 三态：`active` / `expired` / **`unverified`（未确认）**；新建账号默认 `unverified`，历史脏值读侧归一化为 `unverified` |

### 16.4 新增显示项与文案

- 卡片徽章第三态：`unverified` → 中文「未确认」/ 英文 `Unconfirmed`，琥珀底 `#fffaf0` + 字 `#974706`；
  与「从未检测」的 `unknown`（暂无检查记录，灰底）**刻意区分**。未确认不计入失效数量、不显示「去登录」按钮。
- 一键检测汇总：`检测完成：X 个正常，Y 个失效，Z 个未确认`（Z=0 时省略该段）。
- 固化失败提示（新增）：`检测完成，但有 N 个账号的登录状态未能保存到服务端，请重试或检查后端服务`。
- `toPublicAccount` 新增下发字段 `status_source`（`no-local-credential` / `backend` /
  `derived-from-is-active`），并在 `account:status-derive` 日志中输出，用于排障。

### 16.5 校验加固

- 后端 `PATCH /api/accounts/{id}` 接受 `status`，枚举白名单外返回 `400 ACCOUNT_STATUS_INVALID` **且不落盘**；
  `status` 与 `is_active` 正交（写 status 不得改动 is_active）。
- Cookie 提取失败不再静默落一份空 Cookie 凭证：`saveAccountTabCredentials` 返回
  `{ ok:false, reason:'cookie-extract-failed' }`。

### 16.6 回归保护

新增/改写测试共 40+ 例，覆盖后端 status 契约（8）、cookies 提取（2）、检测三态与唯一写者（9+1）、
IPC 口径（7+1）、定期检测（新建 10 例）、渲染层（3 改写 + 3 新增）。实现层每处均以
`git checkout HEAD -- <impl>` 保留测试复现红灯，确认测试是真护栏。

### 16.7 遗留问题（本次不改，需单独 PR）

`stores/accounts.batchSetStatus('active'|'inactive')`（账号页「批量启用/停用」）仍走
`accountUpdate` → Electron 本地 SQLite，且复用了登录态词表 `status`，因此对展示实际无效。
应改为写 `is_active` 并接入后端 PATCH。本 PR 不动它，以免混淆"登录态"与"启用状态"两个正交概念。
