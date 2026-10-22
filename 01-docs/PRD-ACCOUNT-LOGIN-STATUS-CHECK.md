# PRD: 账号登录状态自动检测与主页提醒

> 版本: 2.5 | 日期: 2026-10-22 | 状态: 已实现
> 关联 PR: #1558（v1）、#1804（session cookie 路径修复）、#1805（v2.0：检测反馈 + 失效标识 + 结果持久化 + 公众号 HTTP 检测）、v2.1（2026-09-16 三态判定修复：HTTP 检测黑名单语义，修复抖音假阳性，详见 BUGFIX-LOGIN-CHECK-FALSE-EXPIRED-2026-09-16.md 与本文 §14）、v2.2（2026-09-22 登录态检测口径统一：四平台黑名单语义收口 + 保存凭证回写 active + 首页横幅检测回写，详见 BUGFIX-LOGIN-STATE-CONSISTENCY-2026-09-22.md 与本文 §15）、v2.3（2026-09-22 一键检测进度可见性与并发加速：start/done 双边界广播 + 并发池 3 + 单账号 60s 超时计入失效，详见 BUGFIX-BATCH-CHECK-PROGRESS-STALL-2026-09-22.md 与本文 §16）、v2.4（2026-09-23 登录态真源与三态统一：双库伪回写修复 + 单一写者 + unverified 第三态，详见 PRD-ACCOUNT-LOGIN-STATE-PERSISTENCE-2026-09-23.md 与本文 §17）、**v2.5（2026-10-22 一键检测提示统一为一条汇总 + 卡片登录态刷新兜底：4 条 toast 收敛为 1 条、下一步与固化失败并入汇总句、`loginStatus` 缺失时按三态结论兜底刷新卡片，详见本文 §20）**

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
    → 启动已耗时秒表（每秒 tick，让慢检测「看得见在跑」）
    → 订阅 accounts:batch-check-progress 事件（按 phase 维护 in-flight 平台集合）
    → 调用 accountBatchCheckLogin(全部账号 ID)
      → IPC: accounts:batch-check-login
        → 校验 owner subject
        → AccountManager.listAccounts()
        → 并发池执行（默认并发 3，MP_BATCH_CHECK_CONCURRENCY 可调、上限 4）
          → 每个账号：广播 phase='start' → AccountManager.checkLoginStatus(platform, accountId) → 广播 phase='done'（带 valid/code/elapsedMs）
          → 优先 HTTP API 快速路径（<1s/平台，含公众号）
          → 无 HTTP 检测 / HTTP 判定 INCONCLUSIVE 的平台走 Playwright 无头浏览器 DOM 检测
          → 单账号硬超时 60s（MP_BATCH_CHECK_ACCOUNT_TIMEOUT_MS 可调）→ valid:false, code:CHECK_LOGIN_TIMEOUT（计入失效，不阻断其余）
        → 结果按输入顺序落位（slots[index]），返回 { results: [{platform, accountId, valid, code, error?}], checkedAt }
    → 按结果更新本地 account.status（active / expired）+ last_validated
    → 调用 accountUpdate(id, { status, last_validated }) 写回后端（持久化）
    → 更新 checkedExpiredIds（失效账号集合）
    → 停止秒表并取消事件订阅（finally / onUnmounted 双保险）
    → 汇总提示正常/失效数量
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

## 16. 一键检测进度可见性与并发加速（v2.3，2026-09-22）

> 完整根因证据链、逃逸分析见 `01-docs/BUGFIX-BATCH-CHECK-PROGRESS-STALL-2026-09-22.md`。

### 16.1 问题（用户报告）

账号页点【一键检测】后遮罩长时间停在「检测中 0/7」（第二次停在 1/7），中间计数纹丝不动，过一会直接一次性出全部结果 —— 视觉上等同卡死。

根因：主进程 `broadcastProgress` 位于 `await checkLoginStatus` **之后**，进度语义 = 已完成数，「正在检测哪个账号」从不广播；只要有账号走浏览器降级检测（10-30s）遮罩就冻结那么久。§15（v2.2）的三态语义使 INCONCLUSIVE 降级变多，是放大因素而非回归。

### 16.2 行为契约

| 维度 | v2.2 之前 | v2.3 |
|---|---|---|
| 进度广播边界 | 仅每账号完成时 | 每账号 **start + done** 双边界，载荷含 `phase/checked/total/platform/accountId`，done 另含 `valid/code/elapsedMs` |
| 执行方式 | 严格串行，总耗时=各账号之和 | 并发池，默认 **3**（`MP_BATCH_CHECK_CONCURRENCY`，clamp ≤4）；依据：`getContext()` 每账号独立 `auth-check-<uuid>` 分区 + 独立隐藏窗口，无共享启动锁 |
| 结果顺序 | 完成顺序 | **输入顺序**（`slots[index]` 落位） |
| 慢账号 | 无上限，拖住整批 | 单账号硬超时 **60s**（`MP_BATCH_CHECK_ACCOUNT_TIMEOUT_MS`），超时计入失效 `CHECK_LOGIN_TIMEOUT`，不阻断其余 |
| in-flight 展示 | 无 | 遮罩第二行「正在检测：知乎、抖音 · 已耗时 12 秒」，同平台多账号去重 |

### 16.3 数据校验与安全

- 超时分支只在服务端生成 `valid:false` + 固定 code，不接受渲染层传入的状态；
- `Promise.race` 会订阅原 promise，超时后迟到的 reject 不会成为 unhandledRejection（有回归测试钉住）；
- 进度广播失败（窗口销毁等）静默吞掉，不阻断检测与结果回写；
- 结果条目缺 `accountId` 仍按原规则跳过回写，空 results 不触发写操作（§15.4 不变）。

### 16.4 交互、显示与提示文字变更

- **新增显示项**：一键检测遮罩第二行明细 `data-testid="batch-check-detail"`（正在检测平台列表 + 已耗时秒数）。
- **新增 i18n 文案（zh/en 成对）**：`accountsPage.batchCheckAllCurrent` = 「正在检测：{platforms}」/ "Checking now: {platforms}"；`accountsPage.batchCheckAllElapsed` = 「已耗时 {seconds} 秒」/ "Elapsed: {seconds}s"。
- **不变**：`batchCheckAllProgress`（检测中 {checked}/{total}：{platform}）、进度条口径（已完成/总数，不虚增）、结果列表、账号卡片状态标识、完成汇总提示。

### 16.5 回归保护测试

- `electron/ipc-handlers/account-batch-check.test.js`（新增 7 例）：串行模式钉 `a1:start→a1:done→a2:start→a2:done` 边界序 + 「检测体执行时该账号只收到过 start」；并发峰值 >1 且 ≤3、首 done 前已有多个 start、结果保序、并发=1 退化串行；超时计入失效且不阻断、迟到 reject 无 unhandledRejection。
- `src/views/Accounts.test.js`（新增 4 例）：start 即时展示正在检测平台、递增秒表（fake timers 须在启动前安装）、结束取消订阅且 `getTimerCount()===0`、超时账号回写 expired。
- 门禁：新增/修改批量 IPC 进度广播时，必须同时覆盖 start 与 done 边界并保留「检测体期间已收到 start」断言；`account-batch-check.test.js` 与 `Accounts.test.js` 全量必须绿。

---

## 17. 登录态真源与三态统一（v2.3，2026-09-23）

> 本节是对 §2.1、§11（检测结果持久化）、§14、§15 的**口径修订**；凡与本文早前描述冲突处，以本节与
> `PRD-ACCOUNT-LOGIN-STATE-PERSISTENCE-2026-09-23.md` 为准。完整数据模型、判定矩阵、交互与文案、
> 测试矩阵、已知边界均写在该新文档中，此处只记录"改了什么、为什么、以及哪些旧描述作废"。

### 17.1 触发缺陷

| 编号 | 用户可见现象 |
|------|--------------|
| D1 | 账号页一键检测显示部分账号「已失效」，退出再进入又显示「已登录」→ 检测结论未固化 |
| D2 | 今日头条号已登录并保存凭证后仍被显示「已失效」→ 假阴性 |
| D3 | 视频号一键检测显示「已登录」，实际已失效 → 假阳性 |

### 17.2 六条根因（RC-A ~ RC-F）

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

### 17.3 新口径（作废旧描述的条目）

| 旧描述（本文早前章节） | 新口径 |
|------------------------|--------|
| §2.1「本地无加密凭证 → status 强制置 expired；有凭证且 status 为 active 不在此列」 | 保留「无凭证 → expired」；但 **active/expired/unverified 一律以后端 status 为准（粘滞）**，不再有 2 小时窗口，不再被"本地存在凭证文件"推翻 |
| §11「检测结果写回 DB + 2 小时内尊重」 | 2 小时窗口作废。**登录态唯一写者 = 主进程 `AccountManager.persistLoginState()`**（后端 PATCH）；渲染层禁止写 `status`，monitor 禁止读写 SQLite 账号表 |
| 降级返回 `valid:true`（`CHECK_LOGIN_SUCCESS_LOCAL_ONLY`） | 作废。改为 `valid: undefined` + `CHECK_LOGIN_INCONCLUSIVE`；**「凭证文件存在」永远不是正向证据** |
| 无 Cookie 即判 `CHECK_LOGIN_COOKIE_EXPIRED`（toutiao/baijiahao fast-path） | 作废。判定基于「加密凭证 + 账号级 session 分区」合并后的 Cookie 集合；合并后仍为 0 且属强依赖 Cookie 平台才判失效 |
| 批量检测 `valid: Boolean(status.valid)` | 作废。三态透传：`undefined`（未确认）既不计入失效，也不冒充已登录 |
| 账号 status 仅 active/expired | 三态：`active` / `expired` / **`unverified`（未确认）**；新建账号默认 `unverified`，历史脏值读侧归一化为 `unverified` |

### 17.4 新增显示项与文案

- 卡片徽章第三态：`unverified` → 中文「未确认」/ 英文 `Unconfirmed`，琥珀底 `#fffaf0` + 字 `#974706`；
  与「从未检测」的 `unknown`（暂无检查记录，灰底）**刻意区分**。未确认不计入失效数量、不显示「去登录」按钮。
- 一键检测汇总：`检测完成：X 个正常，Y 个失效，Z 个未确认`（Z=0 时省略该段）。
- 固化失败提示（新增）：`检测完成，但有 N 个账号的登录状态未能保存到服务端，请重试或检查后端服务`。
- `toPublicAccount` 新增下发字段 `status_source`（`no-local-credential` / `backend` /
  `derived-from-is-active`），并在 `account:status-derive` 日志中输出，用于排障。

### 17.5 校验加固

- 后端 `PATCH /api/accounts/{id}` 接受 `status`，枚举白名单外返回 `400 ACCOUNT_STATUS_INVALID` **且不落盘**；
  `status` 与 `is_active` 正交（写 status 不得改动 is_active）。
- Cookie 提取失败不再静默落一份空 Cookie 凭证：`saveAccountTabCredentials` 返回
  `{ ok:false, reason:'cookie-extract-failed' }`。

### 17.6 回归保护

新增/改写测试共 40+ 例，覆盖后端 status 契约（8）、cookies 提取（2）、检测三态与唯一写者（9+1）、
IPC 口径（7+1）、定期检测（新建 10 例）、渲染层（3 改写 + 3 新增）。实现层每处均以
`git checkout HEAD -- <impl>` 保留测试复现红灯，确认测试是真护栏。

### 17.7 遗留问题（本次不改，需单独 PR）

`stores/accounts.batchSetStatus('active'|'inactive')`（账号页「批量启用/停用」）仍走
`accountUpdate` → Electron 本地 SQLite，且复用了登录态词表 `status`，因此对展示实际无效。
应改为写 `is_active` 并接入后端 PATCH。本 PR 不动它，以免混淆"登录态"与"启用状态"两个正交概念。

---

## 18. 2026-10-16 变更：登录态判定收敛到 HTTP 单轨（隐藏窗口兜底默认关闭）

> 详细版见 `01-docs/BUGFIX-LOGIN-CHECK-HTTP-ONLY-2026-10-16.md`。本节只记**需求侧契约的变化**。

### 18.1 动机（真实事故）

`checkLoginStatus` 在 HTTP/本地证据不足时会**开隐藏 sandbox 窗口**加载平台页面抓 DOM 判状态。
该支路自 2026-09 起按平台逐个触发**原生渲染崩溃**：toutiao（09-16）→ wechat_mp（10-06）→
知乎（10-14，PR #3726）→ kuaishou（10-16）。现场三条判据同时成立：应用日志**戛然而止**（停在
`checkLoginStatus: start <platform>`）、`crashpad_client_win.cc: not connected`（无 minidump）、
主进程退出（`0xC0000135` / `0xC0000409` 等同族码），随后**全部 electron 进程消失、窗口空白**——
用户视角就是"应用突然关闭"。2026-10-16 实测：kuaishou 检测在**同一实例的两轮**（间隔 30 分钟的
`LoginMonitor`）中，第一轮通过、第二轮仍崩，说明"只调启动参数"不足以收敛。

### 18.2 需求契约变化（默认翻转）

| 项 | 变更前 | 变更后 |
|---|---|---|
| 证据不足时的默认动作 | 开隐藏窗口做 DOM 判定（除白名单外） | **判「未确认」，不开窗** |
| 白名单语义 | `RENDER_CRASH_PRONE_OPEN_PLATFORMS` = "不开窗"的名单（枚举式打地鼠） | 保留为**硬否决**；新增 `DOM_LOGIN_CHECK_ALLOWED_PLATFORMS` = "**允许**开窗"的名单，**默认空集** |
| 判定顺序 | 仅一次白名单判断 | **先否决、后允许**（否决永远赢） |
| 影响面 | — | 「未确认」账号数量上升；**应用不再因某平台页面整体消失** |

### 18.3 数据校验与判定优先级（需求口径）

1. 凭证与分区 Cookie 皆无 ⇒ 确定失效（不检测）。
2. HTTP 检测给出确定结论 ⇒ 采纳（含 `checkHtml` 黑名单语义的平台）。
3. HTTP 明确失效证据（302 登录页 / Cookie 过期）⇒ 判失效。
4. HTTP 不确定且平台**不在允许集**（或在否决集）⇒ **判未确认**（本次核心变更），返回
   `CHECK_LOGIN_INCONCLUSIVE`，`reason ∈ {hidden-browser-disabled-default, render-crash-prone-http-inconclusive}`。
5. 仅当平台**既在允许集又不在否决集**时才允许 DOM 兜底（默认无人命中）。
6. 任何解析/配置/网络异常一律按"不确定"处理，**绝不**按"已登录"处理（fail closed）。

### 18.4 流程影响

- **启动批量检测**与账号页「一键检测」：单账号最坏耗时下降（不再有 8s 导航 + 3s 选择器 + 500ms 固定等待）。
- **`LoginMonitor` 周期检测（30 分钟一轮）**：结论分布变化同 18.3 第 4 条。
- ⚠️ **验证口径（写给未来的自己）**：判断"崩溃已修"时，观测窗口**必须覆盖至少两轮（≥60 分钟）**。
  本轮曾以"240 秒稳定"误判"已修复"，而第二轮仍在同一处崩溃。
- 单账号「重新登录」仍走**可见**窗口（`AuthViewManager`），不属本次变更范围。

### 18.5 交互与显示影响（复用既有第三态，**不新增文案**）

- 受影响的是**既有**第三态 `unverified`：徽章「未确认」/ `Unconfirmed`，琥珀底 `#fffaf0` + 字 `#974706`，
  与「从未检测」`unknown`（灰底）**刻意区分**（§17.4 已定义，本次沿用，不新增 locales 条目）。
- `unverified` **不计入**失效数量、**不显示**「去登录」按钮、**不触发**主页失效横幅
  （既有测试 `src/composables/useExpiredAccountsBanner.test.js` 已锁定该行为）。
- 账号页「一键检测」汇总里的 `Z 个未确认` 计数会上升，属预期。
- 若将来要为「未确认」补原因提示文案，必须 zh/en **成对**提交（否则 CI Gate 7 `check-locale-sync.js` 判红）。

### 18.6 回退通道与边界

- 恢复某平台的 DOM 兜底：把它加入 `DOM_LOGIN_CHECK_ALLOWED_PLATFORMS`，**并在同一次提交**把它登记到 `scripts/dom-login-check-registry.json`（≥2 轮 / ≥60 分钟 / 登录页与已登录页形态 / 证据载体，7 字段齐备），否则 `account-manager-http-only-policy.test.js` 的「准入配对锁」当场红；并附上
  **真机复测证据**（该平台隐藏窗口加载不再崩溃）；**不得**用环境变量临时开启（避免线上出现无留痕的崩溃面）。
- 本变更**不修 Chromium 缺陷**，也不声称消除该类崩溃；任何对允许集的追加都必须重新评估风险。
- 更彻底的解法（把 DOM 判定搬进独立进程、崩溃不回传主进程）列为后续工作。

### 18.7 回归保护

新增行为锁：非允许集平台 + HTTP 不确定 ⇒ `playwrightManager.getContext` **零调用**且返回
`CHECK_LOGIN_INCONCLUSIVE`；允许集**默认空**；否决集优先于允许集；判定顺序（先否决后允许）。
既有回归同跑：`account-manager.test.js` 全量、四个 `*-render-crash.test.js`（同族先例）、
`playwright-manager.test.js`、`useExpiredAccountsBanner.test.js`。

### 18.7 外部互证：参考产品B（CEF 壳）的账号逻辑（2026-10-17 逆向补证）

对参考产品B 的**静态逆向**（详见 `01-docs/REVERSE-REFERENCE-PRODUCT-B-CEF-ACCOUNT-2026-10-17.md`）给出三条与本变更一致的证据：

1. **它也不用浏览器判定登录态**：宿主二进制里 `windowless` / `offscreen` / `OSR` 命中均为 **0**；平台账号态由原生 HTTP 引擎（`MediaTaskMgr.dll`，1337 条平台 URL、显式 `Cookie:` 头、WinHttp/libcurl）调用各平台"当前账号/用户信息"接口得出（如 `.../aweme/v1/creator/user/info/`、`.../rest/v2/creator/pc/authority/account/current`、`.../api/galaxy/user/info`）。
2. **它同样区分"失效"与"不确定"**：查询结果分 `suc` / `logout` / `fail` 三桶，UI 文案分别为「查询成功」/「查询失败 账号登录失效」/「查询失败」——与本 PRD §17.4 的「正常 / 失效 / 未确认」三态**同构**。
3. **它把失败原因翻译成可执行提示**：平台错误码 `2190008` → 「授权失效,请重新授权」、`100437` → 「无法获取私密账号数据」。这一点强于我们现状（`reason` 仅内部可见、UI 统一显示「未确认」），已列为后续改进项（`PLATFORM_LOGIN_ERROR_HINTS`）。

## 19. 2026-10-17 变更：登录态提示可执行化 + 能力级授权 + DOM 判定进程隔离

> 对应执行记录：`openspec/records/account-login-ux.md`。三件事互为配套：
> **提示**让"未确认"不再是一句废话；**能力**把账号从一维变二维；**隔离**给"将来若必须开窗"上最后一道保险。

### 19.1 背景与第一性原因

1. **提示层缺口**：主进程的 `checkLoginStatus` 一直带细到原因的 `reason`（9 种），
   但渲染端只拿到 `code`，未确认时一律显示「未能确认登录状态：本轮检测未取到定论」——
   "该重试"还是"该重新登录"全靠用户猜。参考产品B 把平台错误码翻译成可执行提示（§18.7 第 3 条）。
2. **账号模型一维**：我们只回答"登录了吗"，回答不了"能读它的数据吗 / 能自动评论吗"。
   参考产品B 的账号是**两维**：登录态 × 能力授权（`im_flag` / `sp_flag` / `open_id`）。
3. **崩溃收场缺口**：隐藏窗口判定跑在主进程浏览上下文里，原生渲染崩溃时**主进程自己没了**，
   连"降级未确认"都来不及返回。#3759 已让默认路径不触碰它，但**没有进程隔离这最后一道保险**。

### 19.2 功能逻辑（主进程）

| 模块 | 职责 | 关键约束 |
|------|------|---------|
| `electron/publishers/login-status-hints.js`（新） | `reason`/`code` → `{locales 键, 兜底文案, action}` | **只解释、不改判**；未知码回落 `null`（调用方用通用文案）；**不登记** `CHECK_LOGIN_INVALID_PARAMS`（那是开发缺陷，配提示等于把 bug 包装成产品文案） |
| `electron/publishers/login-check-capabilities.js`（新） | `dataRead` / `commentInteract` 两能力，状态 `unknown`/`granted`/`revoked` | **缺证据一律 unknown**；只有平台明确拒绝（错误码，如 `100437`）才判 `revoked`；未授权 ≠ 未登录 |
| `electron/publishers/dom-login-check-runner.js`（新） | 隐藏页面判定的隔离运行器 | 子进程死亡/异常/空结果一律降级 `CHECK_LOGIN_INCONCLUSIVE` + `reason=dom-check-process-died`；**默认仍在主进程内执行**（允许集为空 ⇒ 生产走不到） |
| `electron/publishers/account-manager.js` | 判定链**保持纯净**；新增 `loginStatusHint` / `loginStatusCapabilities` 两个只读包装器供 IPC 调用 | ⚠️ 决策记录：曾把 hint/capabilities 装饰到判定返回值上，**实测打破 13 个 `toEqual` 精确断言**，故改为 IPC 层显式挂载 |

### 19.3 数据流与 IPC 合同

```
渲染端 → accounts:batch-check-login / account:check-login
主进程 AccountManager.checkLoginStatus(platform, id)   ← 只返回三态（合同不变）
        ↓
   IPC 层显式取展示语义（缺内容不挂键）：
     item.hint         = AccountManager.loginStatusHint(status)        // 有才挂
     item.capabilities = AccountManager.loginStatusCapabilities(status) // 有才挂
```

`item` 的键集合被测试锁定（多一个键就红）：`platform / accountId / valid / code / loginStatus /
statusChanged / last_validated / persisted` + 可选的 `hint` / `capabilities` / `error`。

### 19.4 交互逻辑与显示项

**单账号「验证」**（`src/views/Accounts.vue` → `checkLogin`）：

| 判定 | 反馈 |
|------|------|
| `valid === true` | 成功提示「登录状态正常」 |
| `valid === undefined` | 信息提示：**平台名 + hint 的具体原因与下一步**（例："哔哩哔哩：平台接口未给出明确结论（可能正在风控或改版），请稍后重试"）；`hint` 缺失时回落既有通用文案 |
| `valid === false` | 既有确认框（错误码 → 文案映射不变），确认后走 `reloginAccount` |

**一键检测汇总**（`batchCheckAllLogins`）：在既有"X 正常 / Y 失效 / Z 未确认"之外**追加一条
「后续操作建议」**，把未确认/失败账号按 `hint.action` 分成两半说：
`N 个账号需要重新登录`、`M 个账号请稍后重试`（两者处置不同，不得混成一句）。

**账号卡片能力行**：仅当某能力为 `granted`/`revoked` 时才渲染（全 `unknown` 不渲染，避免满屏噪声）；
`revoked` 时给出该能力的后果说明（"数据读取未授权 ⇒ 统计与素材同步不可用"）。

### 19.5 提示文案（zh/en 成对，键名与主进程一一对应）

`accountsPage.checkHints.*` 共 17 条，覆盖 8 种 `reason` + 9 种 `code`。示例：

| 场景 | zh | en |
|------|----|----|
| 接口无定论（可重试） | 平台接口未给出明确结论（可能正在风控或改版），请稍后重试 | The platform API gave no clear verdict (possibly rate-limited or redesigned). Please try again later. |
| 无 Cookie（要重登） | 未检测到已保存的登录凭证，请重新登录该平台账号 | No saved login credential found. Please log in to this platform account again. |
| 页面检测进程退出 | 页面检测进程已退出，本次未取到定论，请稍后重试 | The page check process exited, so no verdict was reached this round. Please try again later. |
| 崩溃高危平台 | 该平台无法用接口判定且不能开窗检测，请重新登录以恢复确定结论 | This platform cannot be judged via API and window-based checks are disabled. Please log in again for a definite result. |

### 19.6 进程隔离的工作方式（P2 落地）

```
主进程 ──IPC──▶ 子进程（utilityProcess）
   ▲                  │
   │                  └─ 只在这里开隐藏窗口抓 DOM
   └─ 收到 exit ──────▶ 判 INCONCLUSIVE + reason=dom-check-process-died，应用不死
```

- 运行器 `runHiddenPageCheck(req, runners, options)`：`options.isolated` 为真且注入了
  `spawnIsolated` 时走子进程；否则走 `runners.runInProcess`（默认路径）。
- **子进程死亡不是失败，是"本次无定论"**：无论退出码/信号/超时，一律降级，绝不抛给调用方、
  绝不判失效。测试用 `createDeadProcessRunner` 注入"必死子进程"验证该契约。
- 注入必须是显式参数，**不得**用环境变量切换（改契约必须同批改锁）。

### 19.7 回归保护与验证证据

| 层 | 锁 |
|----|----|
| 新模块单测 | `login-status-hints.test.js`（5 例：reason 优先于 code / 未知回落 null / 键与动作三要素齐全 / 开发缺陷不给提示 / 聚合计数）、`login-check-capabilities.test.js`（8 例：缺证据 unknown / 显式判定优先 / 错误码 revoked / granted 不被降级 / 展示门槛 / 清单与信号表双向对齐）、`dom-login-check-runner.test.js`（7 例：默认透传 / 异常降级 / **子进程死亡降级** / 无 spawnIsolated 回落 / 空结果降级 / 合同守卫 / diedResult 形状） |
| IPC 透传 | `account.test.js` 新增 5 例：hint 透传且**键集合精确** / 有定论不挂 hint / capabilities 透传 / 单账号同口径 / 旧注入无该方法不炸 |
| 既有回归 | `account-manager.test.js` 89 例、4 个 `*-render-crash.test.js`、`account-manager-http-only-policy.test.js` 5 例、`playwright-manager.test.js`、渲染端账号 16 文件 296 例、`check-locale-sync.js --cjk` |
| 变异反证 | 三个探针均当场红：让未知 reason 也返提示 → 1 failed；把子进程死亡改成抛出 → 2 failed；缺证据猜 granted → 4 failed；还原后全绿 |
| 行数闸 | `account-manager.js` 1260 行（登记 1061 + 容差 200 = 1261）；按门禁意图**压缩崩溃史注释**（65 行 → 18 行，细节移入 BUGFIX 文档并留指针），**未抬登记值** |

### 19.8 边界（不假装闭合）

1. `hint` 只覆盖**已登记**的 reason/code；新平台新码要先补映射，否则回落通用文案。
2. 能力状态**不会主动请求平台**：当前只从检测结果与已知错误码推导；真实能力接口接入前，
   多数账号会长期是 `unknown`（不渲染，属预期）。
3. 进程隔离的**默认路径仍在主进程内**：它保护的是"经准入登记、确需 DOM 兜底"的将来场景；
   生产上允许集为空，这条路径今天走不到。
4. 文案里"可能正在风控或改版"是**推测性说明**，不是平台确认的原因；我们无法从一次失败区分两者。

## 19. 2026-10-17 变更：登录态提示可执行化 + 能力级授权 + DOM 判定进程隔离

> 对应执行记录：`openspec/records/account-login-ux.md`。三件事互为配套：
> **提示**让"未确认"不再是一句废话；**能力**把账号从一维变二维；**隔离**给"将来若必须开窗"上最后一道保险。

### 19.1 背景与第一性原因

1. **提示层缺口**：主进程的 `checkLoginStatus` 一直带细到原因的 `reason`（9 种），
   但渲染端只拿到 `code`，未确认时一律显示「未能确认登录状态：本轮检测未取到定论」——
   "该重试"还是"该重新登录"全靠用户猜。参考产品B 把平台错误码翻译成可执行提示（§18.7 第 3 条）。
2. **账号模型一维**：我们只回答"登录了吗"，回答不了"能读它的数据吗 / 能自动评论吗"。
   参考产品B 的账号是**两维**：登录态 × 能力授权（`im_flag` / `sp_flag` / `open_id`）。
3. **崩溃收场缺口**：隐藏窗口判定跑在主进程浏览上下文里，原生渲染崩溃时**主进程自己没了**，
   连"降级未确认"都来不及返回。#3759 已让默认路径不触碰它，但**没有进程隔离这最后一道保险**。

### 19.2 功能逻辑（主进程）

| 模块 | 职责 | 关键约束 |
|------|------|---------|
| `electron/publishers/login-status-hints.js`（新） | `reason`/`code` → `{locales 键, 兜底文案, action}` | **只解释、不改判**；未知码回落 `null`（调用方用通用文案）；**不登记** `CHECK_LOGIN_INVALID_PARAMS`（那是开发缺陷，配提示等于把 bug 包装成产品文案） |
| `electron/publishers/login-check-capabilities.js`（新） | `dataRead` / `commentInteract` 两能力，状态 `unknown`/`granted`/`revoked` | **缺证据一律 unknown**；只有平台明确拒绝（错误码，如 `100437`）才判 `revoked`；未授权 ≠ 未登录 |
| `electron/publishers/dom-login-check-runner.js`（新） | 隐藏页面判定的隔离运行器 | 子进程死亡/异常/空结果一律降级 `CHECK_LOGIN_INCONCLUSIVE` + `reason=dom-check-process-died`；**默认仍在主进程内执行**（允许集为空 ⇒ 生产走不到） |
| `electron/publishers/account-manager.js` | 判定链**保持纯净**；新增 `loginStatusHint` / `loginStatusCapabilities` 两个只读包装器供 IPC 调用 | ⚠️ 决策记录：曾把 hint/capabilities 装饰到判定返回值上，**实测打破 13 个 `toEqual` 精确断言**，故改为 IPC 层显式挂载 |

### 19.3 数据流与 IPC 合同

```
渲染端 → accounts:batch-check-login / account:check-login
主进程 AccountManager.checkLoginStatus(platform, id)   ← 只返回三态（合同不变）
        ↓
   IPC 层显式取展示语义（缺内容不挂键）：
     item.hint         = AccountManager.loginStatusHint(status)        // 有才挂
     item.capabilities = AccountManager.loginStatusCapabilities(status) // 有才挂
```

`item` 的键集合被测试锁定（多一个键就红）：`platform / accountId / valid / code / loginStatus /
statusChanged / last_validated / persisted` + 可选的 `hint` / `capabilities` / `error`。

### 19.4 交互逻辑与显示项

**单账号「验证」**（`src/views/Accounts.vue` → `checkLogin`）：

| 判定 | 反馈 |
|------|------|
| `valid === true` | 成功提示「登录状态正常」 |
| `valid === undefined` | 信息提示：**平台名 + hint 的具体原因与下一步**（例："哔哩哔哩：平台接口未给出明确结论（可能正在风控或改版），请稍后重试"）；`hint` 缺失时回落既有通用文案 |
| `valid === false` | 既有确认框（错误码 → 文案映射不变），确认后走 `reloginAccount` |

**一键检测汇总**（`batchCheckAllLogins`）：在既有"X 正常 / Y 失效 / Z 未确认"之外**追加一条
「后续操作建议」**，把未确认/失败账号按 `hint.action` 分成两半说：
`N 个账号需要重新登录`、`M 个账号请稍后重试`（两者处置不同，不得混成一句）。

**账号卡片能力行**：仅当某能力为 `granted`/`revoked` 时才渲染（全 `unknown` 不渲染，避免满屏噪声）；
`revoked` 时给出该能力的后果说明（"数据读取未授权 ⇒ 统计与素材同步不可用"）。

### 19.5 提示文案（zh/en 成对，键名与主进程一一对应）

`accountsPage.checkHints.*` 共 17 条，覆盖 8 种 `reason` + 9 种 `code`。示例：

| 场景 | zh | en |
|------|----|----|
| 接口无定论（可重试） | 平台接口未给出明确结论（可能正在风控或改版），请稍后重试 | The platform API gave no clear verdict (possibly rate-limited or redesigned). Please try again later. |
| 无 Cookie（要重登） | 未检测到已保存的登录凭证，请重新登录该平台账号 | No saved login credential found. Please log in to this platform account again. |
| 页面检测进程退出 | 页面检测进程已退出，本次未取到定论，请稍后重试 | The page check process exited, so no verdict was reached this round. Please try again later. |
| 崩溃高危平台 | 该平台无法用接口判定且不能开窗检测，请重新登录以恢复确定结论 | This platform cannot be judged via API and window-based checks are disabled. Please log in again for a definite result. |

### 19.6 进程隔离的工作方式（P2 落地）

```
主进程 ──IPC──▶ 子进程（utilityProcess）
   ▲                  │
   │                  └─ 只在这里开隐藏窗口抓 DOM
   └─ 收到 exit ──────▶ 判 INCONCLUSIVE + reason=dom-check-process-died，应用不死
```

- 运行器 `runHiddenPageCheck(req, runners, options)`：`options.isolated` 为真且注入了
  `spawnIsolated` 时走子进程；否则走 `runners.runInProcess`（默认路径）。
- **子进程死亡不是失败，是"本次无定论"**：无论退出码/信号/超时，一律降级，绝不抛给调用方、
  绝不判失效。测试用 `createDeadProcessRunner` 注入"必死子进程"验证该契约。
- 注入必须是显式参数，**不得**用环境变量切换（改契约必须同批改锁）。

### 19.7 回归保护与验证证据

| 层 | 锁 |
|----|----|
| 新模块单测 | `login-status-hints.test.js`（5 例：reason 优先于 code / 未知回落 null / 键与动作三要素齐全 / 开发缺陷不给提示 / 聚合计数）、`login-check-capabilities.test.js`（8 例：缺证据 unknown / 显式判定优先 / 错误码 revoked / granted 不被降级 / 展示门槛 / 清单与信号表双向对齐）、`dom-login-check-runner.test.js`（7 例：默认透传 / 异常降级 / **子进程死亡降级** / 无 spawnIsolated 回落 / 空结果降级 / 合同守卫 / diedResult 形状） |
| IPC 透传 | `account.test.js` 新增 5 例：hint 透传且**键集合精确** / 有定论不挂 hint / capabilities 透传 / 单账号同口径 / 旧注入无该方法不炸 |
| 既有回归 | `account-manager.test.js` 89 例、4 个 `*-render-crash.test.js`、`account-manager-http-only-policy.test.js` 5 例、`playwright-manager.test.js`、渲染端账号 16 文件 296 例、`check-locale-sync.js --cjk` |
| 变异反证 | 三个探针均当场红：让未知 reason 也返提示 → 1 failed；把子进程死亡改成抛出 → 2 failed；缺证据猜 granted → 4 failed；还原后全绿 |
| 行数闸 | `account-manager.js` 1260 行（登记 1061 + 容差 200 = 1261）；按门禁意图**压缩崩溃史注释**（65 行 → 18 行，细节移入 BUGFIX 文档并留指针），**未抬登记值** |

### 19.8 边界（不假装闭合）

1. `hint` 只覆盖**已登记**的 reason/code；新平台新码要先补映射，否则回落通用文案。
2. 能力状态**不会主动请求平台**：当前只从检测结果与已知错误码推导；真实能力接口接入前，
   多数账号会长期是 `unknown`（不渲染，属预期）。
3. 进程隔离的**默认路径仍在主进程内**：它保护的是"经准入登记、确需 DOM 兜底"的将来场景；
   生产上允许集为空，这条路径今天走不到。
4. 文案里"可能正在风控或改版"是**推测性说明**，不是平台确认的原因；我们无法从一次失败区分两者。


> 同时如实记录其**与我们不同**的选择：参考产品B 保留了「后台自动重登窗口」（`backgroundautoreloginwnd`），并把用户账号密码注入平台登录页模拟点击。我们**不采用**这两条（安全 / 合规 / 风控三重风险），维持"默认关闭 + 用户手动重新登录"的口径。

---

## 19. 2026-10-17 变更：登录态提示可执行化 + 能力级授权 + DOM 判定进程隔离

> 对应执行记录：`openspec/records/account-login-ux.md`。三件事互为配套：
> **提示**让"未确认"不再是一句废话；**能力**把账号从一维变二维；**隔离**给"将来若必须开窗"上最后一道保险。

### 19.1 背景与第一性原因

1. **提示层缺口**：主进程的 `checkLoginStatus` 一直带细到原因的 `reason`（9 种），
   但渲染端只拿到 `code`，未确认时一律显示「未能确认登录状态：本轮检测未取到定论」——
   "该重试"还是"该重新登录"全靠用户猜。参考产品B 把平台错误码翻译成可执行提示（§18.7 第 3 条）。
2. **账号模型一维**：我们只回答"登录了吗"，回答不了"能读它的数据吗 / 能自动评论吗"。
   参考产品B 的账号是**两维**：登录态 × 能力授权（`im_flag` / `sp_flag` / `open_id`）。
3. **崩溃收场缺口**：隐藏窗口判定跑在主进程浏览上下文里，原生渲染崩溃时**主进程自己没了**，
   连"降级未确认"都来不及返回。#3759 已让默认路径不触碰它，但**没有进程隔离这最后一道保险**。

### 19.2 功能逻辑（主进程）

| 模块 | 职责 | 关键约束 |
|------|------|---------|
| `electron/publishers/login-status-hints.js`（新） | `reason`/`code` → `{locales 键, 兜底文案, action}` | **只解释、不改判**；未知码回落 `null`（调用方用通用文案）；**不登记** `CHECK_LOGIN_INVALID_PARAMS`（那是开发缺陷，配提示等于把 bug 包装成产品文案） |
| `electron/publishers/login-check-capabilities.js`（新） | `dataRead` / `commentInteract` 两能力，状态 `unknown`/`granted`/`revoked` | **缺证据一律 unknown**；只有平台明确拒绝（错误码，如 `100437`）才判 `revoked`；未授权 ≠ 未登录 |
| `electron/publishers/dom-login-check-runner.js`（新） | 隐藏页面判定的隔离运行器 | 子进程死亡/异常/空结果一律降级 `CHECK_LOGIN_INCONCLUSIVE` + `reason=dom-check-process-died`；**默认仍在主进程内执行**（允许集为空 ⇒ 生产走不到） |
| `electron/publishers/account-manager.js` | 判定链**保持纯净**；新增 `loginStatusHint` / `loginStatusCapabilities` 两个只读包装器供 IPC 调用 | ⚠️ 决策记录：曾把 hint/capabilities 装饰到判定返回值上，**实测打破 13 个 `toEqual` 精确断言**，故改为 IPC 层显式挂载 |

### 19.3 数据流与 IPC 合同

```
渲染端 → accounts:batch-check-login / account:check-login
主进程 AccountManager.checkLoginStatus(platform, id)   ← 只返回三态（合同不变）
        ↓
   IPC 层显式取展示语义（缺内容不挂键）：
     item.hint         = AccountManager.loginStatusHint(status)        // 有才挂
     item.capabilities = AccountManager.loginStatusCapabilities(status) // 有才挂
```

`item` 的键集合被测试锁定（多一个键就红）：`platform / accountId / valid / code / loginStatus /
statusChanged / last_validated / persisted` + 可选的 `hint` / `capabilities` / `error`。

### 19.4 交互逻辑与显示项

**单账号「验证」**（`src/views/Accounts.vue` → `checkLogin`）：

| 判定 | 反馈 |
|------|------|
| `valid === true` | 成功提示「登录状态正常」 |
| `valid === undefined` | 信息提示：**平台名 + hint 的具体原因与下一步**（例："哔哩哔哩：平台接口未给出明确结论（可能正在风控或改版），请稍后重试"）；`hint` 缺失时回落既有通用文案 |
| `valid === false` | 既有确认框（错误码 → 文案映射不变），确认后走 `reloginAccount` |

**一键检测汇总**（`batchCheckAllLogins`）：在既有"X 正常 / Y 失效 / Z 未确认"之外**追加一条
「后续操作建议」**，把未确认/失败账号按 `hint.action` 分成两半说：
`N 个账号需要重新登录`、`M 个账号请稍后重试`（两者处置不同，不得混成一句）。

**账号卡片能力行**：仅当某能力为 `granted`/`revoked` 时才渲染（全 `unknown` 不渲染，避免满屏噪声）；
`revoked` 时给出该能力的后果说明（"数据读取未授权 ⇒ 统计与素材同步不可用"）。

### 19.5 提示文案（zh/en 成对，键名与主进程一一对应）

`accountsPage.checkHints.*` 共 17 条，覆盖 8 种 `reason` + 9 种 `code`。示例：

| 场景 | zh | en |
|------|----|----|
| 接口无定论（可重试） | 平台接口未给出明确结论（可能正在风控或改版），请稍后重试 | The platform API gave no clear verdict (possibly rate-limited or redesigned). Please try again later. |
| 无 Cookie（要重登） | 未检测到已保存的登录凭证，请重新登录该平台账号 | No saved login credential found. Please log in to this platform account again. |
| 页面检测进程退出 | 页面检测进程已退出，本次未取到定论，请稍后重试 | The page check process exited, so no verdict was reached this round. Please try again later. |
| 崩溃高危平台 | 该平台无法用接口判定且不能开窗检测，请重新登录以恢复确定结论 | This platform cannot be judged via API and window-based checks are disabled. Please log in again for a definite result. |

### 19.6 进程隔离的工作方式（P2 落地）

```
主进程 ──IPC──▶ 子进程（utilityProcess）
   ▲                  │
   │                  └─ 只在这里开隐藏窗口抓 DOM
   └─ 收到 exit ──────▶ 判 INCONCLUSIVE + reason=dom-check-process-died，应用不死
```

- 运行器 `runHiddenPageCheck(req, runners, options)`：`options.isolated` 为真且注入了
  `spawnIsolated` 时走子进程；否则走 `runners.runInProcess`（默认路径）。
- **子进程死亡不是失败，是"本次无定论"**：无论退出码/信号/超时，一律降级，绝不抛给调用方、
  绝不判失效。测试用 `createDeadProcessRunner` 注入"必死子进程"验证该契约。
- 注入必须是显式参数，**不得**用环境变量切换（改契约必须同批改锁）。

### 19.7 回归保护与验证证据

| 层 | 锁 |
|----|----|
| 新模块单测 | `login-status-hints.test.js`（5 例：reason 优先于 code / 未知回落 null / 键与动作三要素齐全 / 开发缺陷不给提示 / 聚合计数）、`login-check-capabilities.test.js`（8 例：缺证据 unknown / 显式判定优先 / 错误码 revoked / granted 不被降级 / 展示门槛 / 清单与信号表双向对齐）、`dom-login-check-runner.test.js`（7 例：默认透传 / 异常降级 / **子进程死亡降级** / 无 spawnIsolated 回落 / 空结果降级 / 合同守卫 / diedResult 形状） |
| IPC 透传 | `account.test.js` 新增 5 例：hint 透传且**键集合精确** / 有定论不挂 hint / capabilities 透传 / 单账号同口径 / 旧注入无该方法不炸 |
| 既有回归 | `account-manager.test.js` 89 例、4 个 `*-render-crash.test.js`、`account-manager-http-only-policy.test.js` 5 例、`playwright-manager.test.js`、渲染端账号 16 文件 296 例、`check-locale-sync.js --cjk` |
| 变异反证 | 三个探针均当场红：让未知 reason 也返提示 → 1 failed；把子进程死亡改成抛出 → 2 failed；缺证据猜 granted → 4 failed；还原后全绿 |
| 行数闸 | `account-manager.js` 1260 行（登记 1061 + 容差 200 = 1261）；按门禁意图**压缩崩溃史注释**（65 行 → 18 行，细节移入 BUGFIX 文档并留指针），**未抬登记值** |

### 19.8 边界（不假装闭合）

1. `hint` 只覆盖**已登记**的 reason/code；新平台新码要先补映射，否则回落通用文案。
2. 能力状态**不会主动请求平台**：当前只从检测结果与已知错误码推导；真实能力接口接入前，
   多数账号会长期是 `unknown`（不渲染，属预期）。
3. 进程隔离的**默认路径仍在主进程内**：它保护的是"经准入登记、确需 DOM 兜底"的将来场景；
   生产上允许集为空，这条路径今天走不到。
4. 文案里"可能正在风控或改版"是**推测性说明**，不是平台确认的原因；我们无法从一次失败区分两者。
> 同时如实记录其**与我们不同**的选择：参考产品B 保留了「后台自动重登窗口」（`backgroundautoreloginwnd`），并把用户账号密码注入平台登录页模拟点击。我们**不采用**这两条（安全 / 合规 / 风控三重风险），维持"默认关闭 + 用户手动重新登录"的口径。

---

## 20. 2026-10-22 变更：一键检测提示统一为一条汇总 + 卡片登录态刷新兜底

> 对应执行记录：`openspec/records/fix-batch-check-toast-unify.md`。
> 用户报告：账号页点「一键检测」后**先后弹出约 4 条文字提示，且几条内容互相矛盾**；
> 同时**账号卡片的登录状态没有任何刷新和变化**，还是老的、不准确的状态。
> 本章写全数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字与边界。

### 20.1 背景与第一性原因

**两个现象，同一个根：检测结论有了，但"怎么告诉用户"和"怎么让用户看见"两条链路都断在最后一米。**

**现象 A —— 4 条提示互相矛盾。** `Accounts.vue` 的 `batchCheckAllLogins()` 在一次点击后依次弹出四条 toast：

| # | 原代码位置 | 级别 | 文案 | 问题 |
|---|---|---|---|---|
| ① | `notifyInfo('accountsPage.batchCheckAllStarted')` | info | 开始检测 N 个账号的登录状态… | **纯进度噪音**：进度已由同一 `v-if` 条件的全屏遮罩 `batch-check-overlay`（45% 深色 + `backdrop-filter: blur(2px)`，z-index 300）承载，这条 toast 出现在遮罩**底层被盖住，根本不可读** |
| ② | `notifyWarning('accountsPage.batchCheckAllDone')` | warning | 检测完成：4 个正常，0 个失效，6 个未取取到定论（保持原状态） | **只报数，不说该做什么** |
| ③ | `notifyInfo('accountsPage.checkHintsSummary')` | info | 后续操作建议：5 个账号需要重新登录；1 个账号请稍后重试 | 与 ② **同源数据**（都来自 `item.hint.action` 聚合），却分成两条；且文案读不出它与 ② 的关系 |
| ④ | `notifyError('accountsPage.batchCheckAllPersistFailed')` | **error** | 检测完成，但有 1 个账号的登录状态未能保存到服务端… | 红色 error 级把「**部分**账号的结论没落库」渲染成「**整个**检测失败」，用户以为一键检测功能坏了 |

用户读到的"矛盾"精确地来自这里：**② 说"0 个失效"，③ 说"5 个账号需要重新登录"**。这两句其实在说**同一批账号**——6 个"未取到定论"里有 5 个的 `reason` 是 `no-cookie` / `credential-file-only` / `no-positive-evidence` 这类**负向倾向证据**，被 `login-status-hints.js` 映射成 `action: 'relogin'`。但两句各自独立成 toast，用户无法看出这个指代关系，只能读成"检测说没问题，又让我去重登 5 个"。

**现象 B —— 卡片登录态不刷新。** 原实现 `Accounts.vue:1090`：

```js
if (item.loginStatus) account.status = item.loginStatus
```

`loginStatus` 由主进程 `account.js:722` 的 `outcome.status || outcome.keptStatus` 给出。当主进程的 `readAccountSnapshot()`（`GET /api/accounts/{id}` 单条读取）**读不到真源现状**时（后端瞬时不可达 / 该账号刚被另一写者改动导致读取竞态），`keptStatus` 为 `null` ⇒ `loginStatus` 为 `null` ⇒ 上面这行**整段跳过** ⇒ 卡片徽章一动不动。用户侧的表现就是"检测跑完了，卡片还是老状态"。

而**本轮检测自己的三态结论**（`item.valid === true/false`）此刻是**唯一可得的证据**，却被丢掉了。

### 20.2 需求契约（四条，逐条可验证）

| # | 契约 | 判据 |
|---|---|---|
| C1 | **一次操作一条结果提示**：一键检测的结果侧只弹 **1 条** toast，不论同时存在多少种异常 | `AccountsBatchCheck.test.js`「最坏形态也只弹 1 条结果 toast」 |
| C2 | **汇总句自带下一步**：把"该重新登录 / 该稍后重试"并入汇总句，并用「其中 …」前缀写明它指代前面那几个未取到定论的账号 | `accounts-batch-check-copy.test.js` 逐字面量锁定「其中 5 个建议重新登录」 |
| C3 | **局部失败降级为汇总尾段**：固化失败不再单独弹红色 error，拼在汇总句最尾部，级别跟着它所在那句走 | `batch-check-summary.test.js`「固化失败不把 success 抬成 warning」「本模块永远不产出 error 级」 |
| C4 | **卡片刷新有兜底**：`loginStatus` 缺失但检测有明确结论时，按三态结论刷新卡片；仍无定论则保持原状 | `AccountsBatchCheck.test.js`「卡片登录态刷新兜底」3 例 |

### 20.3 数据校验

**渲染层 → 装配器（`buildBatchCheckSummary`）的入参，六项计数全部由 `results[]` 派生，缺省按 0：**

| 字段 | 来源 | 校验 |
|---|---|---|
| `validCount` | `item.valid === true` 计数 | 累加前必须已判定为严格 `true`（不用 truthy） |
| `invalidCount` | `item.valid === false` 计数 | 严格 `false`；`undefined` 不得落入此支 |
| `unconfirmedCount` | `item.valid === undefined` 计数 | 第三态；既不计入失效，也不加入 `checkedExpiredIds` |
| `reloginCount` | `item.hint.action === 'relogin'` | `hint` 可能缺席；缺席时不计 |
| `retryCount` | `item.hint.action === 'retry'` | 同上 |
| `persistFailedCount` | `item.persisted.ok === false` | `persisted` 可能缺席；`ok !== false` 不计 |

**三条校验不变量：**

1. `validCount + invalidCount + unconfirmedCount === results.length`（去掉无 `accountId` 的项）。
2. `results` 非数组 ⇒ 抛 `invalid batch-check response`，走 catch 分支弹 error 级提示并复位 busy。
3. 全零 + 无固化失败 ⇒ 装配器返回 `null`，调用方**不弹 toast**（不弹一句空洞的「检测完成」）。

### 20.4 流程

```
用户点击【一键检测】
   │
   ├─ busy 置 true；遮罩出现（标题 + 检测中 X/N + 正在检测哪些平台 + 已耗时秒数）
   ├─ 订阅 accounts:batch-check-progress（start / done 双边界）
   │      ⚠️ 2026-10-22 起**不再**弹「开始检测 N 个账号…」toast（C1：进度由遮罩承载）
   │
   ├─ await accountBatchCheckLogin(全部账号 id)
   │      主进程：有限并发(≤3) + 单账号硬超时(60s) + per-account 串行锁
   │      每个账号：读凭证 → 检测 → persistCheckOutcome（单向证据规则）→ 装配 item
   │
   ├─ 逐 item 处理：
   │      ├─ 三态分派计数 + checkedExpiredIds 增删
   │      ├─ hint.action 聚合 → reloginIds / retryIds
   │      ├─ 卡片乐观刷新（见 20.5 优先级）
   │      └─ persisted.ok === false → persistFailedIds
   │
   └─ buildBatchCheckSummary(六项计数) → { level, message } | null
          ├─ null   → 不弹
          ├─ success → notifySuccess（1 条）
          └─ warning → notifyWarning（1 条）
   │
   └─ finally：退订、停秒表、清进度、清 verifying、busy 复位
```

**与主进程的口径分界（不变）**：渲染层只做**本次会话的乐观展示**，持久化仍由主进程 `AccountManager.persistLoginState` 单点写回后端 `accounts.json`。渲染层**绝不**再调 `accountUpdate` 写 Electron 本地 SQLite（那是「一键检测后重进又显示已登录」的根因）。

### 20.5 功能逻辑

#### 20.5.1 卡片登录态刷新优先级（本次新增中间一级）

```
主进程回传的 loginStatus（真源现状，!= null 且 != ''）  →  最高优先
        │ 缺失时降级
        ▼
检测自己的三态结论（item.valid）  —— 仅当 statusChanged === true  →  中间级（本次新增）
        │ statusChanged 为 false 或 valid 为 undefined 时
        ▼
什么都不做（保持原状）               →  最低优先
```

- 第一级保留：主进程 `readAccountSnapshot` 读到现状时，展示层**跟随真源**，不从 `valid` 反推。
  这锁住「检测有效、但另一写者刚把真源改成 `unverified`」时展示层不得反超真源。
- 第二级是本次修复，**门控条件是 `statusChanged === true`，不是"`loginStatus` 缺失"**：
  `statusChanged` 来自主进程 `persistCheckOutcome` 的 `changed`，表示**本轮真源已被改写**。
  只有"真源确实被改成某结论、而回传的 `loginStatus` 却缺失"时，用 `valid` 兜底才是等价的
  （展示的值 == 刚落盘的值）。若 `statusChanged` 为 false（无定论 / 结论未变 / 读不到现状），
  **一律不碰卡片**——那正是"用可能过期的 `valid` 覆盖真源"的风险路径
  （CCG 深度评审 i1 指出的 Critical，见 `openspec/records/fix-batch-check-toast-unify.md` §9）。
- 第三级不变：`item.valid === undefined` ⇒ 卡片保持原徽章，且**不得**伪造 `last_validated`
  （否则「最近检查」会指向一次没有结论的检测）。

`last_validated` 的更新条件不变：`item.statusChanged !== false` 时才写 `checkedAt`。

> **契约澄清（为什么 `loginStatus` 为 null 不等于"没有现状"）**：主进程
> `readAccountSnapshot()` 读不到真源时返回 `null`，`keptStatus` 也随之是 `null`。
> 这里的 null 有两种可能含义——「真的没有现状」与「读取失败」——而渲染层无法区分。
> 因此**不能**把 null 当作"可以用 `valid` 兜底"的信号；`statusChanged` 才是"真源被动过"的可靠信号。

#### 20.5.2 提示装配器（`apps/desktop/src/views/batch-check-summary.js`）

**为什么下沉成独立模块**（三条理由，写进模块头）：

1. `Accounts.vue` 在 `check-max-lines` 点名还账清单上（登记值 1578 行、**零增长容差**），就地写必然超限；
2. 这段逻辑是**纯字符串装配**，抽成纯函数后可在 node 环境直接单测，不必 mount 整个 Vue 视图；
3. 段序、分隔符、空段处理是本模块唯一的正确性所在，集中一处才说得清。

**段序恒定为：计数 → 下一步 → 固化失败**，段间分隔符 `；`（全角分号，与汇总句内部的「，」分层，让用户看出这是补充段而非又一个计数）。

**分支：**

| 条件 | level | 句首 | 附带段 |
|---|---|---|---|
| `invalidCount === 0 && unconfirmedCount === 0` | **success** | `batchCheckAllAllValid`（短句，不带计数细节） | 仅固化失败段（若有） |
| 有失效或有未定论 | **warning** | `batchCheckAllDone`（计数句） | 下一步段 + 固化失败段（按序，空则不出） |
| 全零且无固化失败 | — | 返回 `null`，不弹 | — |
| IPC 整体 reject / `results` 非数组 | **error** | `batchCheckAllFailed` | 不经装配器（`Accounts.vue` catch 分支） |

**三条不可破（模块头 + 单测双重锁定）：**

1. 只返回单个 `{ level, message }` 对象，**不得返回数组**让调用方循环弹；
2. 空段必须从数组中消失（`filter(Boolean)`），**绝不出现**「；；」或句首/句尾孤立分隔符；
3. **级别只由三态结论决定，固化失败不参与定级**——它是尾段，跟着所在那句走。

### 20.6 交互逻辑与显示项

| 显示项 | 变更 |
|---|---|
| 一键检测遮罩 `batch-check-overlay` | **不变**（标题 + 进度 + 明细 + 进度条 + 秒表） |
| 按钮文案 | **不变**（检测中固定短标签「检测中…」，不随进度增长） |
| 账号卡片登录徽章 | 刷新兜底（20.5.1）；徽章配色与文案**不变** |
| 「去登录」按钮显隐 | **不变**（仍由 `checkedExpiredIds` 驱动；未取到定论不进入该集合） |
| 结果 toast | **4 条 → 1 条**；级别：全定论 success / 有异常 warning / 整体失败 error |
| 进度 toast | **删除**（`batchCheckAllStarted` 键保留但不再由一键检测调用，见 20.7） |

### 20.7 提示文案（zh/en 成对）

**汇总句主体（既有键，未改）：**

| 键 | zh | en |
|---|---|---|
| `batchCheckAllAllValid` | 检测完成：{count} 个账号登录状态全部正常 | Check complete: all {count} accounts are valid |
| `batchCheckAllDone` | 检测完成：{valid} 个正常，{invalid} 个失效[，{unconfirmed} 个未取到定论（保持原状态）] | Check complete: {valid} valid, {invalid} expired[, {unconfirmed} unresolved (status kept)] |

**新增两个尾段键（2026-10-22）：**

| 键 | zh | en | 用途 |
|---|---|---|---|
| `checkHintsSummaryInline` | 其中 {relogin} 个建议重新登录[；{retry} 个建议稍后重试] | of which {relogin} should log in again[; {retry} should be retried later] | 下一步段；两者都为 0 时**返回空串** |
| `checkHintsPersistFailedInline` | 另有 {count} 个账号的检测结论未能保存到服务端，请重试或检查后端服务 | login status of {count} account(s) could not be saved to the server. Retry or check the backend service | 固化失败段 |

**完整示例（用户截图场景，10 个账号：4 正常 / 0 失效 / 6 未定论，其中 5 个建议重登、1 个建议重试，1 个固化失败）：**

> 检测完成：4 个正常，0 个失效，6 个未取到定论（保持原状态）；其中 5 个建议重新登录；1 个建议稍后重试；另有 1 个账号的检测结论未能保存到服务端，请重试或检查后端服务

**关键措辞决策：「其中」而不是「N 个账号需要重新登录」。** 原独立 toast 的文案读不出它与汇总句的关系，正是用户报「0 个失效」与「5 个要重登」矛盾的直接原因。「其中」把指代关系写明。

**保留但不用的键（如实登记）：** `batchCheckAllStarted`、`checkHintsSummary`、`checkHintsSummaryRelogin`、`checkHintsSummaryRetry`、`batchCheckAllPersistFailed` 五个键**仍在 locales 中**，但一键检测链路不再调用它们：

- `batchCheckAllPersistFailed` 仍被**首页失效横幅**的 `reportError` 标题读取（`useExpiredAccountsBanner.js`），删键会打破 CI Gate 7 `--keys` 与横幅告警；
- 其余四个已无调用方，保留是为了避免本次 PR 夹带「删 key」这类与主题无关的改动（删键需单独评估 `--keys` 基线与 `--cjk` 基线双重影响）。已在 locales 源码内逐条标注「一键检测不再使用」。

### 20.8 回归保护与验证证据

| 层 | 锁 |
|---|---|
| 装配器单测（新文件 `batch-check-summary.test.js`，17 例） | 单对象不数组 / 段序不可交换 / 空段不泄漏分隔符（含 5 种组合穷举）/ 定级只由三态决定 / 固化失败不抬级 / 永不产出 error 级 / 结果集为空返 null / 缺 t 不抛 / 负数不产空句 |
| 文案结构断言（`accounts-batch-check-copy.test.js`，4 → 14 例） | 三个新键的 zh/en 逐字面量、三段条件形态、空串契约、「其中」前缀存在性、不复用红色错误措辞 |
| 组件合同（`AccountsBatchCheck.test.js`，21 例） | 最坏形态只 1 条 toast / 开始检测不再弹 info / 全正常 1 条 success 且无附加段 / IPC 整体失败仍独立 error / 卡片兜底 5 例（`statusChanged=true` 才兜底、`statusChanged=false` 两个方向都不得兜底、空串 `loginStatus` 不被误送进兜底、无定论保持、真源优先不被反超） |
| 测试文件拆分 | 一键检测 19 例整体迁出 `Accounts.test.js` → `AccountsBatchCheck.test.js`（`Accounts.test.js` 2374 → 1848 行，回到登记值 2029 以下） |
| 变异反证 | 三个探针均当场红：摘掉卡片兜底 → 1 failed；从汇总里删下一步段 → 1 failed；把固化失败恢复成独立红色 error → 1 failed。全部还原后 164/164 绿 |
| CCG 深度评审（QM-6） | claude 评审 × opencode 出方案，8 条问题（最低两项 `correctness 5` / `maintainability 4`）。**i1（Critical / auth）upheld 且已收窄修复**——兜底门控从「`loginStatus` 缺失」改为 `statusChanged === true`，并补 2 条回归锁；i4 upheld 已修（严格判定 `!= null && !== ''`）；i2 / i6 / i8 upheld 已补登记与可核证据；i3 / i5 / i7 dismissed（i3 有反证、i5 / i7 属独立 change 范围）。逐条处置见 `openspec/records/fix-batch-check-toast-unify.md` §8 |
| 既有回归 | 账号域 5 文件 235 例全绿（Accounts / AccountsBatchCheck / useExpiredAccountsBanner / accounts store / 文案结构） |
| 静态门禁 | `check-locale-sync.js --keys` PASS（2207 key）/ `--cjk` PASS（基线 1330、当前 1124，无新增硬编码）/ `check-max-lines.js` PASS（`Accounts.vue` 1577 ≤ 1578）/ `check-no-brand-residue.js` PASS / ESLint error 级 0 / 行尾两口径 numstat 一致且无裸 CR |

### 20.9 边界（不假装闭合）

1. **`hasCred=false` 覆盖后端 `active` 的规则本轮未动**（`toPublicAccount` 的「本地无凭证一律降 expired」）。它是多年存在的安全兜底，改动会影响**所有**账号列表显示而不只是一键检测，需要独立的证据链（凭证文件损坏 vs session 分区 Cookie 的判定边界），已登记为后续 change。
2. **`loginStatus` 为 null 的根因未消**：主进程 `readAccountSnapshot` 读不到真源时依然返回 null，本次只是在展示层加了兜底。更彻底的做法是让 `persistCheckOutcome` 在读不到现状时返回明确的 `keptStatus: null` 语义标记，让渲染层能区分"真的没有现状"与"读取失败"。
3. **`unconfirmed` 计数与 `hint.action` 不是同一维度**：一个账号可以既"未取到定论"又带 `retry` 提示（如 `http-check-inconclusive`），也可以"未取到定论"却没有任何 hint（未知 reason）。文案用「其中」弱耦合两者，不做"每个账号一行"的明细——那会变成第 5 条 toast。
4. **本文档 §19 存在三份逐字重复副本**（第 502-601、602-706、707-806 行，均以 `## 19. 2026-10-17 变更：登录态提示可执行化 + 能力级授权 + DOM 判定进程隔离` 开头）。这是**本次修复之前就存在的结构性债务**（历史 PR 重复追加所致），本次不改——删副本会与"只做本主题改动"冲突，且需确认哪一份是权威版。已登记为后续 change（见 `openspec/records/fix-batch-check-toast-unify.md` §8.4）。
5. **卡片兜底契约经 CCG 深度评审（i1，Critical / auth 域）收窄**：门控是 `statusChanged === true`，**不是**"`loginStatus` 缺失"。原因是 `loginStatus` 为 null 有「真的没有现状」与「读取失败」两种含义，渲染层无法区分；只有真源确被改写时，用 `valid` 兜底才等价（展示值 == 刚落盘的值）。该条评审的外部复核（claude）尚未完成，如实留空、不冒充闭环。
6. **5 个失效 locales 键无机械判据**：仅靠源码注释标注「一键检测不再使用」+ 保留理由；删键 / 误引用的闸门属后续 change（§8.4 第 1 条）。
7. **`Accounts.test.js` 与 `AccountsBatchCheck.test.js` 的 mock 头部重复**：迁移时原样复制以保行为一致，抽取共享夹具属独立重构（§8.4 第 3 条）。