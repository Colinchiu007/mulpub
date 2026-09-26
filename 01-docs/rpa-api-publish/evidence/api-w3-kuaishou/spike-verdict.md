# W3 快手 sig3 Spike 裁决记录

> 关联 change：`api-publish-engine-w3`（design §4 Spike 门禁执行序）
> 执行日期：2026-09-25 · 环境：Windows / Electron 桌面应用（应用内登录态，合规）
> 账号：a4505f45（is_active=true）· 全程单次请求、不重试、不换号、不刷签名

## S0 公式探针裁决 —— 结果：INCONCLUSIVE（探针端点不校验 sig3），不短路 S2/S3

### 准备（技术阻塞解除）
- 快手登录 cookie 提取成功：Electron 的 Cookies SQLite **明文存于 `value` 列**（非 `encrypted_value`），
  无需 DPAPI/os_crypt 解密即可读取。取自最新鲜的 RPA partition（api_ph 盘上更新 2026-09-23）。
- `api_ph`：36 字符，正则 `/kuaishou\.web\.cp\.api_ph=([a-z0-9]+)/` 匹配通过。
- 探针端点：`POST /rest/cp/works/v2/video/pc/upload/pre`（design §5 步骤 2，最低风险 sig3 端点：
  仅铸 upload token，不发布内容，token 自动过期）。
- 同源 UA：应用经 `app.userAgentFallback` 将 UA 净化为标准 Chrome（剔除 Electron/应用 token），
  探针注入同一净化 UA，保证与登录 session 同源。

### 双发比对（活体，真实 result 码）
| 变体 | 请求 | HTTP | 平台响应（脱敏） |
|------|------|------|------------------|
| A | `/upload/pre`（**不带** `__NS_sig3`） | 200 | `result:1` + 有效 upload token |
| B | `/upload/pre?__NS_sig3=<本地公式>` | 200 | `result:1` + 有效 upload token |

本地公式：`MD5(api_ph + "|" + JSON.stringify(body)).digest("hex")`（`signer-local.getKuaishouSign`，32 位小写 hex）。

两次响应 `currentTime` 与 `host-name` 均不同，确认为两次独立真实处理，非缓存。

### 关键结论
1. **`/upload/pre` 不校验 `__NS_sig3`**：完全不带签的 A 也返回 `result:1` + 有效 token。
   该端点对 sig3 的接受性**无法区分**「无签 / 本地近似签 / 真签」，故 **S0 无法据此确立本地公式 = Tier-A**。
2. **结构证据（独立成立）**：本地公式产出 32 位裸 MD5，低于 design §3 对真实 sig3 的 **≥40 长度门槛**，
   且真 sig3 由参考产品页面内不透明 JS 生成器产出——本地近似**在结构上不等于**真签名。
3. **不存在合规的 S0 判据端点**：真正强制 sig3 的 `video/pc/submit` 带发布副作用，禁止盲发；
   无「既强制 sig3 又无副作用」的端点可用于裁决。S0 撞结构性墙。

### 裁决与后续
- **S0 = INCONCLUSIVE → 不判 Tier-A、不短路 S2/S3**（design §4 仅「S0 通过」才短路）。
- **继续 S2**（真页抽取 + 拦截法复算比对）：从登录态 `cp.kuaishou.com` 页面抠出真 sig3 生成函数，
  同 payload 复算 == 页面真发值，这才是获得真签名有效性判据的正当路径，无需盲发发布请求。
- 若 S2 无法产出与页面真发一致的签名 → 快手保持 DOM RPA，Group 4/5 API 链不合并，platforms.yaml 不翻转
  （design §4 裁决记录 / §9 回退面）。
- 签名页基建（Group 2，已合入 main）独立评审保留，作 xiaohongshu 备胎，不受本裁决阻断。

### 探针脚本自身的偏差（记录，避免误读）
- 探针的自动裁决函数把响应体截断到 600 字符，恰好切在 token 字段中部 → `JSON.parse` 失败、
  误报 "B 非 JSON"。**真实响应头两处均为 `result:1`**，本记录以人工判读的原始响应为准。
- 后续 S2 探针脚本需修复：提高响应捕获上限或流式完整读取后再解析。

### 合规确认
- 全程对生产 API 仅发出 2 次认证请求（A/B 各一），单次、无重试。
- 铸出的 upload token 未做任何后续上传/提交，随平台策略自动过期。
- 未向账号发布任何内容；未触发风控信号（无验证页/滑块/403/429）。
- 本记录不含任何 cookie、token、api_ph/api_st 明文值或签名服务地址。



---

## S2a 离线 bundle 静态侦察 —— 结果：Tier-A 方向【成立但需重定位抽取器】，S2b 活体仍为必要条件

> 执行日期：2026-09-25（用户在窗外，降级为纯静态侦察）· 方式：未认证 GET 快手发布页公开 JS 资源，零 cookie/零发布/零真实 sig3 请求
> 侦察脚本：`.agent_context/staging/w3-s2a-bundle-recon.js`、`w3-s2a-dig-sig3.js`（gitignored，含混淆源码不外泄）

### 现场事实（可复现）
- `GET https://cp.kuaishou.com/article/publish/video?tabType=1` → 200，HTML 53KB，加载 7 个 JS bundle（webpack5 应用）。
- webpack 运行全局：`self["webpackChunkks_fe_creator_platform"]`（manifest 注册）。
- sig3 生成在 chunk `7708`（moduleId `29924`，仅 12,982 B）。核心：
  - 入口导出 `k`（`n.d` 别名 `PJ`）：`async k({url, type, params})` → 先 `h(url)` 判断 path 是否命中**带签白名单** `f`，命中则走 `w`（sig4/hxfalcon），否则走 sig3 路径。
  - sig3 计算：输入 = `md5( 按 key 排序的 query 串 + JSON.stringify(body) )`；产出 = `a().call("$encode", [输入, {suc: e => `__NS_sig3=${e}`, err}])`。
  - `$encode` 是快手**页面内的混淆 VM 签名器（Nimble-SDK）**，**回调式异步**，另依赖 `$getCatVersion`（设备指纹版本）。**不是外部 HTTP 签名服务**。
- **带签白名单 `f`** = `[ /rest/v2/creator/pc/fanstop/money/account/type, /rest/cp/works/v2/video/pc/edit/info, /rest/cp/works/v2/video/pc/submit ]`。
  - ⚠️ **`/upload/pre` 不在 `f`** → 与 S0「`/upload/pre` 不校验 sig3」互相印证：S0 探针端点选错（应选 `f` 内端点），非平台不校验。

### 对既有假设的推翻 / 修正
| 假设来源 | 原判断 | S2a 实证 | 结论 |
|----------|--------|----------|------|
| bundle §1.1（参考产品） | sig3 = 外部签名服务 `<EXT_SIGNER>` 返回 | 参考产品确实外包 | 但**快手官方 web 客户端是页面自签**（in-page VM），二者不矛盾——外包是参考产品的取巧，不是快手的机制 |
| `EXTRACTOR_SCRIPT` 全局名 | `window.webpackChunk` / `webpackChunk_kuaishou_pc` | 真名 `webpackChunkks_fe_creator_platform` | **当前 grab() 永不命中，抽取器 0% 可用** |
| `EXTRACTOR_SCRIPT` 调用契约 | 同步 `fn(payload): string` | 异步、`{url,type,params}` 入、`$encode` VM + 设备指纹 | **契约根本性错误，须重写为异步 await + 结构化入参** |

### 判决（design §4 语义）
- **不是 no-go**：sig3 由快手自己页面生成 → 「隐藏页调用平台自带签名器产出我方请求的 sig3」策略**方向成立且合规**（用户自己登录态官方页面签，非第三方外包，不触 §7 grep 门禁）。
- **也还不是 go**：`$encode` 是混淆 VM，静态无法证明「对**独立构造的新请求**调用页面签名器产出的 sig3，能被 submit 端点接受」。风险：Nimble VM 可能把签名绑定到页面**自己那一次**请求的会话/指纹/时序快照，导致同 payload 复算值未必通过独立请求校验——**这正是 S2b 活体拦截法必须裁决的核心命题**。

### S2b 前置任务（回 worktree 后、用户在场时执行）
1. 重写 `EXTRACTOR_SCRIPT`：全局名 → `webpackChunkks_fe_creator_platform`；moduleId → `29924`；导出 → `k`(PJ)；契约 → **异步**（`return k({url,type,params})` 交回 Promise，manager 侧 await 并把 `__NS_sig3=` 前缀剥离）。
2. 拦截法：用户在应用内真实驱动一次发布（submit 端点，`f` 白名单内），CDP `Network` 抓真发 sig3；同时对同 `{url,type,params}` 调页面 `k()` 复算 → 比对是否等值。
3. 等值 → Tier-A go，放行 Group 4/5；不等值 → 判定「VM 绑定单请求」，快手保持 DOM RPA（no-go），签名页基建降级为 xiaohongshu 备胎。

### 合规确认（S2a）
- 全程仅对公开静态 JS 资源做未认证 GET（等价浏览器查看源代码），无 cookie、无登录态、无签名请求、无发布、无风控面触碰。
- 未在任何 tracked 文件落混淆源码切片或真实签名值；脚本置于 gitignored staging。



---

## S2b 活体真页抽取终判 —— 结果：**Tier-A GO**（页面自带签名器为我方独立构造请求产出的 sig3 被平台接受）

> 执行日期：2026-09-26 · 用户授权代操作（测试账号）· 方式：Playwright chromium + 注入 partition cookie，加载登录态 `cp.kuaishou.com`
> 探针：`.agent_context/staging/w3-s2b-{cookie-freshness,page-probe,phaseC}.js`（gitignored，签名值/cookie 明文只在页面内存使用，绝不回传/落 tracked）

### 现场前提核实
- 登录态有效：`passToken`→2026-10-13、`api_ph`→2026-10-07、`did`/`userId` 均 valid（partition `rpa-rpa-kuaishou-a4505f45-6`）。
- headless chromium 加载 `cp.kuaishou.com/profile`：**未跳登录、未触发风控/验证码**（result 码全程正常业务码，无验证页）。

### Phase A — 页面自然签名流量（被动捕获，零主动发）
- 进入控制台自然发出 **27 条 `POST <端点>?__NS_sig3=<值>`**（唯一 query 键 `__NS_sig3`，body 为 JSON）。
- 证实：sig3 由页面内 `$encode`（Nimble VM）**实时产出**，自动化浏览器环境下同样生成 → 推翻「需真人浏览器才能签」的担忧。

### Phase B — webpack 模块 29924 导出形状（不 dump 源码）
- 运行全局 `window["webpackChunkks_fe_creator_platform"]`；require 捕获须用 **三元 push**：`chunk.push([[probeId], {}, (r)=>{req=r}])`（runtime 回调在第 3 槽，此前二元写法抓不到 —— EXTRACTOR bug 根因）。
- 导出 `PJ`/`nM`/`u$`，均 `arity=1`（单对象入参 `{url,type,params}`）。

### Phase C — 独立构造请求接受性对照（Tier-A 终判，只读端点）
| 变体 | 请求 | HTTP | result | 说明 |
|------|------|------|--------|------|
| A | `POST /rest/v2/creator/pc/authority/account/current` + **我方调用 `PJ({url,type:'json',params})` 复算的 sig3** | 200 | **`1`（成功，956B）** | 平台接受 |
| B | 同端点 **不带 sig3** | 200 | **`500002`（拒绝，63B）** | 平台强制校验 |

- `PJ` 与 `u$` 对独立构造入参均产出 `__NS_sig3=<56 字符>`；`nM` 产出 335 字符非 sig3 串（sig4/hxfalcon 路径）。
- **判据 `ACCEPT_SIG_ONLY(强)`**：带我方复算签成功 + 无签被拒 ⇒ 端点确实强制 sig3，且页面自带签名器对**独立构造**（非抓包回放）的请求产出被服务端接受的合法 sig3。

### 判决（design §4 语义）
- **S2 = GO**：「隐藏页调用平台自带签名器为我方请求产 sig3」策略**成立且合规**（用户自己登录态官方页面内 JS 自签，非第三方外包服务，不触 §7 grep 门禁）。放行 Group 4/5 快手 API 发布链开发与 platforms.yaml 翻转。
- **回填 S0 结论**：S0 本地公式 `MD5(api_ph+"|"+body)`=32 位裸 hex，**结构上短于真 sig3（56 字符 VM 产物）**，故 S0 本地近似永远不等于真签——本地签名器路线对快手 sig3 **作废**，唯一可行是页面内抽取。
- **风险残留（发布链开发期须覆盖）**：sig3 是否绑定会话 nonce/时效导致「同一 payload 隔时复算值不同但仍各自有效」——本测已证「新构造新签新发」即时有效；submit 端点（f 白名单内，含发布副作用）待发布链集成时由用户在场走一次真实发布做最终回归（S3 语义），不再阻塞 Group 4/5 开发。

### EXTRACTOR_SCRIPT 重写形态（供 Group 4 落地）
1. 全局名：`window["webpackChunkks_fe_creator_platform"]`（替换 `webpackChunk`/`webpackChunk_kuaishou_pc`）。
2. require 捕获：`chunk.push([['__mp_sig_probe__'], {}, function (r) { captured = r }])`（三元，runtime 槽）。
3. moduleId `29924`；导出选 `PJ`（`u$` 等价备用）。
4. 调用：**异步** `const s = await PJ({ url, type: 'json', params })`；返回串 `__NS_sig3=<值>` → 剥离前缀得裸签名值交回 manager。
5. fail-closed：全局缺失/抓不到 require/导出非函数/返回无 `__NS_sig3=` → 逐个降级，不回传函数体源码。

### 合规确认（S2b）
- 全程仅对**只读**签名端点各发 1 次认证请求（A/B 对照），单次、无重试、无发布、无换号。
- 未触发风控（无 403/滑块/验证页；500002 是通用「无签拒绝」业务码非风控）。
- 签名值、cookie、api_ph/api_st 明文均未落任何 tracked 文件；探针脚本置于 gitignored staging。
