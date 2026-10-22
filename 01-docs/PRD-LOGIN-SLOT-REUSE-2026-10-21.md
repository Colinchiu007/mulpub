# PRD：登录视图按平台复用分区 + 头条号登录期网络观测 — 2026-10-21

- 状态：已实现（本 change `login-slot-reuse-and-toutiao-diagnostics`）
- 影响模块：`apps/desktop/electron/services/`（主进程登录承载 + 登录期诊断）
- 关联排障手册：`01-docs/TROUBLESHOOT-TOUTIAO-LOGIN-SLOW-2026-10-21.md`

---

## 一、背景与根因（实测，非推测）

用户在账号页添加头条号账号：登录页打开 → 填手机号 → 点「发送验证码」→ 页面**灰显** →
几秒后才弹出图形验证码。

2026-10-21 真机取证（应用日志 + 独立浏览器对照 + 外部网络对照）：

1. **应用侧无责**：登录会话走 `DIRECT`（未走账号代理）、无任何请求拦截、UA 已净化成标准 Chrome UA、
   preload 惰性、视图 `drawn=true` 未被节流；用一个**完全无关的浏览器**（独立 profile）加载同一登录页
   同样耗时 **23.8s**（应用侧同场景 28.4s）。
2. **平台侧有责**：
   - 登录页引用的 `https://s3a.bytecdn.cn/ta/resource/v0/analytics.js` 被**字节自家边缘节点 504**，
     挂 9~17 秒，页面 `load` 事件被拖住（外部网络拉同一文件同样 504 ⇒ 字节侧故障，非本机线路）；
   - 图形验证码组件（`webmssdk.js` 520KB + `captcha.js` 784KB）在**冷缓存**下要现下载，各 ~1.1s
     ⇒ 这就是「灰显几秒」。
3. **本应用有责（放大器）**：登录视图每次都用 `Date.now()` 新建一个**空分区**，
   第三方登录页的 HTTP 缓存**每次从零开始**（普通 Chrome 里这些资源早缓存了 ⇒ 「浏览器正常、app 慢」）；
   且头条号的请求**一条都不记**（登录诊断过滤面只有微信/腾讯域），现场无从归因。

**本刀解决第 3 条**（应用侧可控的部分），第 2 条由排障手册给出用户侧绕行。

---

## 二、目标 / 不做

### 2.1 目标

- G1：同一平台的多次登录**复用同一分区目录**，HTTP 缓存跨次留存 ⇒ 第二次起的验证码组件不再冷下载。
- G2：复用不得破坏**凭证隔离**（第二次登录不能带着上一个账号的登录态）。
- G3：复用不得破坏**发布链磁盘兜底**（登录成功的会话仍能被兜底读取端读到）。
- G4：头条号登录期的**失败 / 慢请求 / 验证码组件加载完成**在应用日志里可见。

### 2.2 不做（刻意的范围克制）

1. **不做「拦截/降级」第三方页面的坏资源**：那是平台自己的页面，注入脚本越界且易随平台改版失效。
2. **不做「减少 43MB 背景视频」**：那是头条登录页自带内容，应用侧无法控制（且 206 分段响应本就不入磁盘缓存）。
3. **不改发布页「添加账号」标签路径**：它本来就用固定 `mp-new-<platform>` 槽位（见
   `01-docs/PRD-PUBLISH-ADD-ACCOUNT-ENTRY-2026-10-15.md` §三），本刀只补登录视图这一条路径。
4. **不改 `loginSilent`（静默校验）**：它用的是 `silent-auth-*` 一次性分区，**必须**与登录槽位隔离
   ——否则静默校验会清掉槽位里刚拿到的会话。
5. **不改 `openSavedAccount`（打开已保存账号）**：它要往分区里注入指定凭证，用一次性分区，不进槽位。
6. **不新增任何用户可见文案**：本刀对用户完全无感（详见 §六）。

---

## 三、数据校验

| 对象 | 规则 | 拒绝时的行为 |
| --- | --- | --- |
| 平台 id | 非空字符串 | `loginSlotAccountIdOf` 返回 `null` ⇒ 退回旧的一次性分区命名，不抛 |
| 槽位分区名 | `auth-auth-<platform>-slot`（由 `partitionNameOf` 唯一派生） | 平台 id 非法 ⇒ 不生成目录名 |
| 槽位豁免 | 目录名同时满足「以 `auth-auth-` 开头」且「以 `-slot` 结尾」才被认定为槽位 | 其它一次性目录仍照旧进回收面 |
| 槽位清理时机 | **导航之前**（`loadURL` 之前） | 视图已销毁 / 会话已被替换 ⇒ 不导航 |
| 槽位清理范围 | **一律清理**（不做「空槽位就跳过」的优化） | 宿主不支持 `clearStorageData` ⇒ 记 `login-slot-wipe-unsupported`（WARN）并照常导航 |
| 槽位清理超时 | 默认 **1200ms**，可用 环境变量（名见代码注释） 覆盖（非法值回落默认，封顶 60000ms） | 超时 ⇒ 记 `login-slot-wipe-failed`（WARN）并**照常导航**（清理是旁路，不得让用户加不了账号） |
| 「本轮是否取到凭证」 | **按轮次**判定（登录视图显式传 `captured`），不得按分区名判 | 调用方未显式给出 ⇒ 回落到模块登记表（保守：宁可留着数据） |
| 观测域匹配 | 主机名等于监测域或为其子域 | 解析不出主机名 ⇒ 不计入观测 |
| 慢请求阈值 | 默认 3000ms，可用 环境变量（名见代码注释） 覆盖 | 单次登录最多记 20 条（`SLOW_REQUEST_LOG_LIMIT`），防刷屏 |
| 隐私边界 | 计时层**只读事件**，永不 `getResponseBody` | 响应体一律不读 |

---

## 四、流程

### 4.1 浏览器登录（账号页「添加账号 → 浏览器登录」）

```
用户点「添加账号」→ 选平台（头条号）→ 选「浏览器登录」
  ↓
AuthViewManager.openLogin(platform)
  ↓
accountId = loginSlotAccountIdOf(platform)          // 稳定：auth-<platform>-slot
分区目录  = partitionNameOf(accountId)               // auth-auth-<platform>-slot
  ↓
建 Session（fromPartition persist:<槽位>）+ 挂登录期诊断（webRequest + CDP）
  ↓
建视图、挂到主窗口、显示出来
  ↓
★ 开局清槽位：探 Cookie → 有则 clearStorageData()（**不清 HTTP 缓存**），带 3000ms 硬上限
  ↓
导航到 PLATFORM_LOGIN_URLS[platform]
  ↓
用户操作（填手机号 / 点发送验证码 / 扫码 / 手动保存）
  ↓
登录成功 → 取凭证入库 → markCaptured + 本轮 captured=true → close()
  ↓
close(): captured=true ⇒ 槽位保留（供发布链兜底读取）
        captured=false ⇒ 探 Cookie：有该平台 Cookie 则保留（兜底优先），
                        无则清存储（**仍不清 HTTP 缓存**）→ 下一轮开局是干净起点
```

### 4.2 扫码登录

同 4.1，分区名同为槽位；差别只在页面交互形态（页面自带「扫码登录」tab，二维码由平台渲染）。

### 4.3 静默校验（登录态检测）

`loginSilent` 走 `silent-auth-*` 一次性分区，**不碰槽位**（碰了会把刚拿到的会话清掉）。

### 4.4 回收

- 槽位**不是**一次性分区 ⇒ 回收端永不把它当 victim（`isThrowawayPartitionName` 显式豁免）。
- 存量的一次性目录（老版本留下的 `auth-auth-<platform>-<ts>`）仍按既有窗口回收，不受影响。

---

## 五、功能逻辑

### 5.1 槽位命名（单一真源）

`auth-login-slot.js` 是唯一实现处（2026-10-21 独立成模块：行数门禁 + 评审 i4「槽位规则散在四个文件」）：

- `loginSlotAccountIdOf(platform)` → `auth-<platform>-slot`
- `loginSlotPartitionNameOf(platform)` → `auth-auth-<platform>-slot`
- `isLoginSlotPartitionName(name)` → 「以 `auth-auth-` 开头」且「以 `-slot` 结尾」

**为什么落在 `auth-auth-<platform>-` 前缀下**（而不是另起 `auth-login-<platform>`）：
发布链兜底读取端 `auth-partition.listAuthPartitionCandidates` 按**前缀**分组，前缀正是 `auth-auth-<platform>-`。
槽位落在同一前缀下 ⇒ 读取端**零改动**即可读到它；且它按字典序排在时间戳目录**之后**（数字 < 字母）
⇒ 读取端「从新到旧逐份探」会**先探槽位**，槽位空（登录中/被清）时自然落到旧目录 ⇒ 回退链完整保留。

**回环契约锁**：槽位模块自己实现了「auth-<accountId>」这条目录命名规则（它不能反向依赖
`auth-partition-reclaim`，否则成环），故用一条回环用例把两份实现钉在一起：
`loginSlotPartitionNameOf(p) === authReclaim.partitionNameOf(loginSlotAccountIdOf(p))`（5 个平台逐一断言）。

### 5.2 凭证隔离（复用带来的新风险，必须显式处理）

复用槽位后，「每次新建空分区」这个隐式隔离不再成立。若不清槽位：

- 平台判定「已登录」看的是 Cookie ⇒ 第二次打开登录页会直接跳已登录态 ⇒
  用户想加**第二个**同平台账号时会静默存成**同一个账号**。

因此隔离改由**开局清**保证：导航前清掉槽位里的旧凭证/存储（保留 HTTP 缓存）。
必须是导航前：页面若先带着旧 Cookie 发出第一个请求，隔离就已经晚了。

**为什么是「一律清理」而不是「槽位里没有 Cookie 就跳过」**（2026-10-21 CCG 外部评审两条 Critical 后的定稿）：

1. 「有没有 Cookie」判据**漏掉用 localStorage/sessionStorage 存登录态的平台**
   （知乎 `z_c0` 就在 localStorage）—— 那类平台第二次登录同样会命中上一个账号的会话；
2. 「先探 Cookie、探失败就当空」的分支在宿主异常时会把**隔离**直接跳过，
   与「隔离优先」的初衷正好相反。

代价是每次登录开局多一次 `clearStorageData()`（本机磁盘操作，量级 ms 级），
而它**不动 HTTP 缓存**——本刀要的缓存收益不受影响。

### 5.3 「本轮是否取到凭证」必须按轮次判

槽位名跨轮次相同 ⇒ 模块级 `capturedPartitions`（按分区名记）会把「上一轮成功」误当成「本轮成功」
⇒ 本轮其实没登录成、槽位里还留着上一轮会话，也会被判成「已取证 ⇒ 不清」。

口径：登录视图在结算时把**本轮**结果显式传给回收端（`captured: boolean`），
回收端在调用方显式给出时**以它为准**，未给出才回落到登记表。

### 5.4 发布链兜底读取

读取端零改动（见 5.1）。槽位在登录成功后仍持有该平台会话 ⇒ 兜底链照旧能读到；
槽位在下一轮登录开始时被清 ⇒ 「正在重新登录」这段时间内兜底读不到（**已知取舍**，见 §七）。

### 5.5 头条号登录期观测

三层观测叠加：

| 层 | 机制 | 产出 |
| --- | --- | --- |
| 会话级 | `session.webRequest.onErrorOccurred` | 监测域内的请求失败（连接重置/超时） |
| 会话级 | `session.webRequest.onCompleted` | 监测域内的 HTTP ≥ 400（如字节 CDN 的 504） |
| CDP | `Network.requestWillBeSent` → `loadingFinished` | 慢请求（≥ 阈值）耗时 + 状态码；监测域内请求失败 |
| CDP | 同上 | **图形验证码组件加载完成**（`webmssdk.js` / `secsdk-captcha/captcha.js`）——灰显遮罩结束的时刻 |

监测域（实测得来，非拍脑袋）：`toutiao.com`、`toutiaostatic.com`、`bytecdn.cn`、`ibytedtos.com`、
`bytescm.com`、`bytegoofy.com`、`ibytedapm.com`、`snssdk.com`、`zijieapi.com`、`bytedance.com`。

**未登记平台走默认（微信域）过滤面，既有行为与既有契约锁一字不动。**

---

## 六、交互逻辑 / 显示项 / 提示文字

### 6.1 用户可见行为

**无任何变化。** 本刀不新增、不改动任何 UI 元素、文案、按钮、弹窗、状态条。

用户能感知到的只有**变快**：同一平台第二次起打开登录页时，风控 SDK 与页面资源命中缓存，
图形验证码不再因冷下载而晚几秒出现。

### 6.2 显示项

无新增 UI 显示项。应用日志新增以下行（写入 `userData/logs/app-YYYY-MM-DD.log`）：

| 事件 | 触发时机 | 字段 |
| --- | --- | --- |
| `LoginNetDiag request-failed` | 监测域内请求失败 | `tag`（平台/账号）、`url`、`error`、`ip`、`classify` |
| `LoginNetDiag http-status-info` | 监测域内 HTTP ≥ 400 | `tag`、`msg`（含状态码与 URL） |
| `LoginNetDiag proxy-resolved` | 挂接时探测代理解析 | `tag`、`proxy`、`probe`（探针地址） |
| `LoginRespDiag slow-request` | 监测域内请求耗时 ≥ 阈值 | `tag`、`url`、`ms`、`status`、`thresholdMs` |
| `LoginRespDiag captcha-sdk-loaded` | 图形验证码组件加载完成 | `tag`、`url`、`ms`、`bytes` |
| `LoginRespDiag monitored-request-failed` | 监测域内请求失败（CDP 侧） | `tag`、`url`、`netError`、`classify` |
| `AuthReclaim login-slot-wiped` | 槽位开局清理完成 | `reason`、`timeoutMs` |
| `AuthReclaim login-slot-wipe-failed` | 清理失败/超时 | `reason`/`error`、`timeoutMs` |

日志中的 URL 一律去掉 query（`diagnosticUrl`），只留 scheme+host+path；**永不写 Cookie 值、响应体、手机号**。

### 6.3 提示文字

本刀**不新增用户可见文案**（无新增 locale key）。
日志文案模板（英文事件名 + 中文说明）：

- `login-slot-wiped` → 「登录槽位旧凭证已清理（保留 HTTP 缓存）」
- `login-slot-wipe-failed` → 「登录槽位凭证清理未完成，按未清理继续（不影响登录）」
- `slow-request` → 「登录期慢请求：<url> 耗时 <ms>ms（阈值 <thresholdMs>ms）」
- `captcha-sdk-loaded` → 「图形验证码组件加载完成：<url> 耗时 <ms>ms」

---

## 七、取舍与已知限制（如实登记，不假装闭合）

1. **43MB 背景视频不受益**：该资源以 206 分段响应返回，Chromium 不入磁盘缓存 ⇒ 每次打开登录页仍要重新拉。
   本刀受益的是**风控 SDK 与页面 bundle**（约 1.3MB + 1.8MB + 图片），这正是「灰显几秒」的来源。
2. **「正在重新登录」窗口内发布链兜底读不到槽位**：槽位在下一轮登录开局被清。
   凭证真源（凭证库）不受影响；仅「登录态只落分区」的平台（快手类）在该窗口内可能报未登录。
3. **存量一次性目录继续存在**：老版本留下的 `auth-auth-<platform>-<ts>` 仍按既有窗口回收；
   它们与槽位同前缀，读取端仍会先探槽位、再落到旧目录 ⇒ 回退链完整。
4. **同一平台两个登录 UI 同时打开**的边缘情形：浏览器登录视图与扫码视图共用槽位，
   后开的会清掉先开的凭证。实际 UI 一次只开一个登录界面，风险极低；如需收敛可在后续刀处理。
5. **字节侧 504 无法由本仓修复**：`s3a.bytecdn.cn` 的 504 是字节自家边缘节点故障（外部网络复现），
   只能由用户在网络侧绕行（见排障手册 §3.4）或等待字节修复。

---

## 八、验收与回归锁

| 契约 | 落在哪条用例 |
| --- | --- |
| 槽位分区名按平台固定 | `auth-partition-reclaim.test.js`「登录槽位」组 |
| 槽位不是一次性分区、回收端不删它 | 同上 + 端到端真目录用例（反向对照：一次性目录仍被删） |
| 清凭证保留 HTTP 缓存 | `auth-partition-reclaim.test.js`（`keepHttpCache`）、`auth-view-manager-partition-reclaim.test.js`（close 后 `clearCache` 不得被调） |
| 导航前先清槽位凭证 | `auth-view-manager-partition-reclaim.test.js`「导航前先清掉槽位里的旧凭证」（断言调用顺序） |
| 空槽位零 IO | 同上（「槽位里没有旧凭证时零 IO」） |
| 清理失败不阻断登录 | 同上（「清理失败不阻断登录」） |
| 「本轮是否取到凭证」按轮次判 | `auth-view-manager-partition-reclaim.test.js`（超时终态 / 取消 / 跨会话三例） |
| 扫码路径用同一槽位 | `qrcode-login.test.js`（账号 id 形态 + 槽位不被删 + 反向对照） |
| 头条观测过滤面 | `login-network-diagnostics.test.js`「头条号登录期观测」组（含「微信过滤面一字不变」） |
| 慢请求 / 验证码组件 / 失败请求 | 同上（CDP 事件驱动） |
| 隐私边界（不读响应体） | 同上（「头条号永不 getResponseBody」） |
