# design — 登录槽位复用 + 头条登录期观测

## D1 根因取证（2026-10-21，方法与读数）

| 步骤 | 方法 | 读数 |
| --- | --- | --- |
| 复现 | 应用日志 `shared-user-data/logs/app-2026-10-21.log` | 02:11:14Z（=10:11 本地）`login page finished after 1588ms`；02:11:18Z `6222ms`；02:12:18Z 登录成功；02:15:03Z `1505ms`；02:15:30Z `28370ms` |
| 应用侧是否背锅 | 逐条查应用行为 | 登录会话 `proxy-resolved: DIRECT`（未走账号代理）；无 `onBeforeRequest` 拦截（噪声 cancel 默认关且只针对微信域）；UA 已净化成标准 Chrome UA（`startup-compat.configureUserAgentFallback`）；preload 惰性（只暴露只读接口）；`drawn=true bgThrottle=true`（未被后台节流） |
| 浏览器对照 | 用**完全无关**的浏览器（桌面端内嵌浏览器，独立 profile）打开同一登录页 | 导航耗时 **23812ms**，与本应用同量级 ⇒ 不是应用特有 |
| 元凶定位 | 该浏览器的网络面板 | `s3a.bytecdn.cn/ta/resource/v0/analytics.js` → `net::ERR_BLOCKED_BY_ORB`，**durationMs 18315** |
| 是不是本机线路 | ① 直连真实 CDN IP；② 外部网络拉同一文件 | ① `curl --resolve s3a.bytecdn.cn:443:111.13.110.60` → **504**，TTFB 9.33s；② Jina Reader → **504** ⇒ 字节侧故障 |
| 验证码组件 | 登录页 bundle 提取主机名 + 逐个计时 | `webmssdk.js` 520KB / 1.29s；`captcha.js` 784KB / 1.07s（冷缓存）⇒ 「灰显几秒」的来源 |
| 本机代理形态 | DNS / 控制口 | DNS=<路由 IP>（路由器），显式查 223.5.5.5 也返回 `fake-ip 保留段` fake-ip；`<路由 IP>:<控制台端口>` 返回 `{"message":"未授权"}` ⇒ 路由器上跑着 Clash/OpenClash（fake-ip + TUN） |

## D2 槽位命名：为什么是 `auth-auth-<platform>-slot`

候选与取舍：

| 候选 | 读取端（发布链兜底） | 回收端 | 结论 |
| --- | --- | --- | --- |
| `auth-login-<platform>`（另起前缀） | 读取端按前缀分组，**读不到** ⇒ 要改读取端（#2734 的「按内容择新」逻辑，动它风险高） | 不匹配一次性前缀 ⇒ 不被删 ✓ | ✗ 读取端零改动这条优势没了 |
| `auth-auth-<platform>-<ts>`（维持现状） | 读得到 | 每次新建、每次被 sweep | ✗ 缓存不跨次 |
| **`auth-auth-<platform>-slot`** | **读得到**（同一前缀），且按字典序排在时间戳目录**之后**（数字 < 字母）⇒ 「从新到旧逐份探」**先探槽位**，槽位空时落到旧目录 ⇒ 回退链完整 | 需**显式豁免**（`isThrowawayPartitionName` 排除）⇒ 永不进回收面 | ✓ 采用 |

补充：槽位名以 `-slot` 结尾且不以数字结尾 ⇒ `groupKeyOf` 不会把它并进「同组」，
`planReclaim` 在过滤阶段就排除它 ⇒ 回收端对它零风险（不依赖窗口宽窄这种间接保护）。

## D3 凭证隔离：复用槽位后谁来保证

原实现的隔离是**隐式**的（每次新建空分区）。复用后必须**显式**：

- 平台判定「已登录」看 Cookie ⇒ 槽位里留着一个账号的会话，第二次打开登录页会直接跳已登录态
  ⇒ 用户想加**第二个**同平台账号时会静默存成**同一个账号**（静默错误结果，最坏的一类）。
- 正解：**导航前**清掉槽位里的旧凭证（`clearStorageData()`，**不清 HTTP 缓存**）。
  必须是导航前：页面若先带着旧 Cookie 发出第一个请求，隔离就已经晚了。
- 判据用「槽位里有没有 Cookie」：Cookie 是登录态的唯一载体，localStorage 里的 token 不足以让平台判定已登录；
  空槽位清一次是白付磁盘 IO（`clearStorageData` 会遍历所有 origin）⇒ 空则跳过（零 IO）。

## D4 「本轮是否取到凭证」必须按轮次判

`capturedPartitions` 是模块级 Set，键是**分区名**。槽位跨轮次同名 ⇒ 「上一轮成功」会把
「本轮其实没登录成」误判成已取证 ⇒ 该清的没清（实测：三条既有用例当场变红，正是这条）。

口径：
- 登录视图在结算时把**本轮**结果显式传下去（`captured: boolean`）；
- 回收端在调用方显式给出时**以它为准**；未给出才回落到登记表（保守：宁可留着数据，也不误删兜底源）。

## D5 观测面：为什么在 webRequest 与 CDP 两层各做一半

- `session.webRequest` 能看到**所有**请求（含跨域 iframe），但**拿不到耗时**（details 里没有起止时间），
  且 `onBeforeRequest` 在 Electron 里**同类事件只保留最后一个监听器** ⇒ 不能为了计时再加一个
  `onBeforeRequest`（会把 `attachLoginPageNoiseCancel` 的监听顶掉）。
- CDP（`Network.*`）能给出**逐请求的起止时刻**，但只覆盖主 frame 的请求。
- 故：失败/HTTP≥400 走 webRequest（覆盖最全），耗时/验证码组件走 CDP（只有它给得出时间）。

## D6 观测域是实测的，不是拍的

头条号登录链路的资源域（从登录页 HTML 与 bundle 里逐个提取 + 计时验证）：
`mp/sso.toutiao.com`、静态资源 `*.toutiaostatic.com`、埋点 `s3a.bytecdn.cn`、
风控/验证码 `sf16-secsdk.ibytedtos.com` 与 `sf16-scmcdn-*.ibytedtos.com`、
埋点 SDK `lf3-short.ibytedapm.com`、日志 `mcs.snssdk.com`。

**未登记平台走默认（微信域）过滤面**：既有契约锁（`onCompleted` filter 精确等于微信四条）一字不变。

## D7 隐私边界

计时层**只读事件**，永不 `getResponseBody`（响应体可能含手机号/令牌）；
URL 一律去 query（`diagnosticUrl`）后落日志；日志只出「端点 + 状态码 + 耗时」三类字段。

## D8 已知取舍（不假装闭合）

1. **43MB 背景视频不受益**：206 分段响应不入 Chromium 磁盘缓存 ⇒ 每次仍重拉；
   受益的是风控 SDK（1.3MB）+ 页面 bundle（1.8MB）+ 图片，正是「灰显几秒」那部分。
2. **「正在重新登录」窗口内分区兜底读不到槽位**：槽位在下一轮开局被清。
   凭证库真源不受影响；仅「登录态只落分区」的平台（快手类）在该窗口内可能报未登录。
3. **同一平台两个登录 UI 同时打开**共用槽位：浏览器登录视图与扫码视图互为对方清凭证。
   实际 UI 一次只开一个登录界面，风险极低；如需收敛留后续刀。
4. **字节侧 504 本仓修不了**：只能由用户侧网络绕行（排障手册 §3.4）或等字节修。
