# 参考产品B（CEF 壳）账号逻辑逆向分析（2026-10-17）

> 分析对象：本机安装的参考产品B（CEF 外壳形态的自媒体多平台发布工具）。
> 方法：**静态逆向**（只读取安装目录与 `%APPDATA%` 数据目录，未运行其程序、未抓包、未登录其服务）。
> 目的：回答一个问题——**它靠什么判断"某平台账号是否还登录着"**，并据此评估我们（Electron 版）可迁移/不可迁移的部分。
> 口径：本仓一律称「参考产品B」；其厂商自有后端域名不转录（仅给命中条数，便于复核时按同法重取）。

---

## 0. 结论摘要

1. **账号态判定 = HTTP 单轨**：原生层用 **Cookie + WinHttp/libcurl** 直接调用各平台"当前账号/用户信息"接口；**没有任何离屏/隐藏浏览器渲染判定**（`windowless` / `offscreen` / `OSR` 在宿主二进制里命中 **0**）。
2. **浏览器只用于"人登录/授权"**：平台登录页跑在**可见的 CEF 窗口**里（窗口资源名 `loginwndweb`），宿主通过 **`ExecuteJavaScript` 注入脚本**填账号密码/点登录（`ipt-account-login` / `btnLogin` / `ClickEnterLoginPage`）。
3. **三态状态模型**：平台查询结果为 `suc` / `logout` / `fail` 三桶，UI 分别显示「查询成功」/「查询失败 账号登录失效」/「查询失败」，并把**平台错误码**翻译成人话（`2190008` →「授权失效,请重新授权」；`100437` →「无法获取私密账号数据」）。
4. **比我们更细的授权维度**：除登录态外还有**能力级授权标志**——`im_flag`（私信授权）、`sp_flag`（特定视频数据授权）、`open_id`（授权 id）、`im_supported`（是否支持私信）、`im_enterprise`（是否企业号）。
5. **它确实有"后台自动重登"这条路**（窗口资源名 `backgroundautoreloginwnd`），且把用户账号密码注入平台登录页自动点击 —— 这正是我们 2026-10 刻意关掉的那类后台窗口；**不建议照搬**（安全/合规/风控三重风险）。

---

## 1. 取证范围与方法

| 项 | 内容 |
|------|------|
| 只读对象 | 安装目录（`libcef.dll`、`WEMedia.exe`、`MediaTaskMgr.dll`、`Asset/**`）+ 用户数据目录 `%APPDATA%\WEMedia/**` |
| 手段 | ① 文件清单与体积；② JS 源码关键词扫描（字节级 ASCII 匹配，规避 GBK/UTF-8 差异）；③ 原生二进制 ASCII / UTF-16LE 字符串提取与分类；④ 用户数据目录结构枚举 |
| 未做 | 未运行其程序；未抓包（无平台侧请求/响应原文）；未解 SQLite 表结构；未取 `libcef.dll` 版本资源；未验证"账号密码是否本地明文保存" |
| 复核方式 | 本文所有条数均由同一脚本一次性统计，可按 §9 的关键词在同路径重跑 |

---

## 2. 载体形态总览

| 文件 / 目录 | 体积 | 判读 |
|------|------|------|
| `libcef.dll` | 148.8 MB | CEF 运行时本体 |
| `WEMedia.exe` | 17.3 MB | 原生宿主：窗口与流程编排、注入脚本、自家账号体系 |
| `MediaTaskMgr.dll`（另有 `_1.0.0.257` 版） | 10.0 MB ×2 | **平台 HTTP 引擎**：1337 条平台 URL、Cookie 处理、HTTP 客户端 |
| `icudtl.dat` / `resources.pak` / `libGLESv2.dll` | 10.0 / 7.2 / 5.4 MB | CEF 标准资源 |
| `Asset\sign2\` | 11.7 MB（7 个 js） | **平台官方 SDK 与签名件**：`sign2.js` 6.20 MB、`chuangzuozhe.js` 3.32 MB、`main.js` 2.04 MB、`sign3/4.js`、`crypto-js.min.js` |
| `Asset\dist\` | 14 个 `view-*` 模块 | **自研前端**（Vue + Element Plus）：`view-dy-analysis`/`view-dy-interaction`/`view-dy-publicize`/`view-dy-rules`/`view-work-analysis`/`view-quick-reply`/`view-smart-clip`/`view-ai-*`/`view-xhs-template` |
| `Asset\{Sign,BaiduVerifyToken,GoogleSign,DouyinBd,AgComment,WEMediaEdit,...}` | — | 签名/验证/绑定/评论/编辑器等辅助页 |
| `cefplug/` `plugins/` `txt/` `zip/` `data/` | — | CEF 插件、业务分类映射表（`*categortmap.txt`）、帮助文案 |

**重要辨识**：`Asset\sign2\sign2.js`、`sign\sign6.js` 里命中的 `checkLoginWithAction` / `isLogin` 属于**小红书官方 Launcher SDK**（证据：文中出现 `@xhs/launcher-plugin-store`、cookie `domain:"xiaohongshu.hk"`、`Auth/REGISTER_AUTH_PERMISSION` 等 `Auth/*` 状态机、`internalSSO`），**不是**参考产品B 自研的账号判定逻辑。自研逻辑在 `Asset\dist` + 原生宿主。

---

## 3. 三层架构

### 3.1 CEF 前端：纯展示层（"哑"客户端）

自研前端共注入/暴露 **5 个宿主桥函数**（全量枚举，`window.*` 扫描）：

```
window.wkSelectMediaAccount      // 选择发布目标账号（宿主回填列表）
window.wkSetAccountWorkList      // 注入"账号作品列表"结果
window.wkSetLoginUser            // 注入"本产品登录用户"信息（logintoken/uid/等级/团队）
window.wkSetQueryWorkListRes     // 注入"作品查询"结果（三态：suc/logout/fail）
window.wkSetWorkAnalysisRes      // 注入"作品分析"结果
```

结论：前端**没有**自己算账号态的路径 —— 它只把宿主推来的结果渲染成列表/图表。这点与我们不同（我们的账号态是 Electron 主进程算、渲染进程展示，形态相近，但我们的判定逻辑在主进程 JS 里，而它在原生 C++ 里）。

### 3.2 原生宿主：窗口编排 + 注入脚本 + 自家账号体系

宿主内命中的**窗口/流程资源名**（ASCII 串，可读性很高）：

| 资源名 | 判读 |
|------|------|
| `loginwndweb` | **登录窗口（带 web 内容）**：平台登录页在这里打开 |
| `backgroundautoreloginwnd` | **后台自动重登窗口**（掉线后自动重试） |
| `importaccountwnd` | 导入账号 |
| `cloudrestoreaccountwnd` | 云端恢复账号 |
| `scan_code_from_loginwnd` | 登录窗内的扫码入口 |
| `tip_pop_from_loginwnd[_user/_passwd]` | 登录窗的提示气泡（账号/密码维度） |
| `backup_account_from_{init,addaccount,loginaccount,accountmgr}` | 账号备份的四个入口 |

宿主**注入平台登录页的脚本片段**（原生字符串，即 `ExecuteJavaScript` 的载荷）：

```js
window.GetAccountInfo('%s',name,passwd,'%s')
var x=document.getElementById('ipt-account-login'); x.value='%s';
var y=document.getElementById('ipt-pwd-login');    y.value='%s';
var z=document.getElementById('btnLogin'); if(z){z.click();}
setTimeout(() => {window.ClickEnterLoginPage('%s','%s');},1000);
window.InputAccountInfo3('%s','%s');
else{window.AiqiyiAccountLoginSuc('%s','%s');}
```

⇒ **它把"账号+密码"作为参数注入平台登录页并模拟点击**，属于"凭证重放式自动登录"。这也是 `backgroundautoreloginwnd` 能工作的前提。

### 3.3 平台 HTTP 引擎：`MediaTaskMgr.dll`

该 DLL 里 **1337 条 URL**，按域名分布（前 12）：

| 域名 | 条数 | 域名 | 条数 |
|------|------|------|------|
| `mp.toutiao.com` | 67 | `member.bilibili.com` | 26 |
| `baijiahao.baidu.com` | 58 | `mp.sina.com.cn` | 25 |
| `creator.douyin.com` | 48 | `mp.163.com` | 25 |
| `mp.weixin.qq.com` | 45 | `www.zhihu.com` | 25 |
| `cp.kuaishou.com` | 35 | `om.qq.com` | 34 |
| `mp.sohu.com` | 34 | `channels.weixin.qq.com` | 27 |

**HTTP/Cookie 原语命中**（同一 DLL，ASCII 串全量统计）：

| 原语 | 命中 | 判读 |
|------|------|------|
| `Cookie:` / `Set-Cookie` / `cookies` | 各 1 / 1 / 2 | 手工拼 Cookie 头 |
| `WinHttp` | 4 | WinHTTP 客户端 |
| `libcurl` / `curl_easy` | 1 / 6 | libcurl 客户端 |
| `CefCookieManager` | **0** | 不借 CEF 的 cookie 管理器发请求 |

⇒ 平台请求由**原生 HTTP 客户端**发出，Cookie 显式携带；**不是**让浏览器去加载页面。

---

## 4. 账号态判定（核心）

### 4.1 判定入口：直接调平台"当前账号/用户信息"接口

| 平台 | 证据接口（`MediaTaskMgr.dll` 内字符串） |
|------|------|
| 抖音 | `https://creator.douyin.com/aweme/v1/creator/user/info/` |
| 快手 | `https://cp.kuaishou.com/rest/v2/creator/pc/authority/account/current`（另有 `/rest/pc/authority/account/current`） |
| 小红书 | `https://creator.xiaohongshu.com/api/galaxy/user/info` |
| 腾讯视频 | `https://access.v.qq.com/trpc.creator_center.entrance.Entrance/GetAccountInfo` |
| 百家号 | `https://baijiahao.baidu.com/builder/author/...` |
| B 站 | `https://member.bilibili.com/...` |
| 火山 | `https://creator.huoshan.com/web/api/media/user/info/` |

规律：**每平台一个"取当前账号"的轻量接口**，成功即"在登录态"，失败按错误码落到「失效」或「失败」。—— 与我们在 PR #3759 收敛出的「HTTP 单轨判定」同构。

### 4.2 三态模型与错误码翻译（自研前端 `view-work-analysis/js/client.js`）

```js
// 结果三桶（注释即原文）：
//   suc:    查询成功
//   logout: 登录失效的账号
//   fail:   查询失败
result.suc.forEach(i => { i.type = "success"; i.msg = "查询成功" })
result.logout.forEach(i => { i.type = "logout";  i.msg = "查询失败 账号登录失效" })
result.fail.forEach(i => { i.type = "fail";      i.msg = "查询失败" })
```

错误码 → 用户话术（`view-dy-analysis/user-list.html`）：

```js
if (errorCode.indexOf("100437") !== -1)  { el.errorInfo = "无法获取私密账号数据"; el.errorCode = "100437" }
else if (errorCode.indexOf("2190008") !== -1) { el.b = "1"; el.errorInfo = "授权失效,请重新授权"; el.errorCode = "2190008" }
else { switch (el.b) { case "1": … "授权失效,请重新授权" …; case "3": … "授权失效,请重新授权" … } }
```

⇒ 它把"登录失效"与"查询失败"分开，并且**把平台错误码翻成可执行提示**（"请重新授权"）。我们目前 `CHECK_LOGIN_INCONCLUSIVE` 只给内部 `reason`，UI 一律显示「未确认」——**这一点它是更强的**（见 §8 P1）。

### 4.3 Cookie 与账号数据落盘

| 位置 | 体积 | 判读 |
|------|------|------|
| `%APPDATA%\WEMedia\CefCookie\globalCache\Network\Cookies` | 20 KB（SQLite） | **CEF 的 cookie 库**：平台登录产生的 Cookie 由 CEF 持久化 |
| `%APPDATA%\WEMedia\DB\AccountDb.db` | 64 KB（SQLite，含 `CREATE TABLE`/`account`/`cookie`/`token` 字样） | **自家账号库**：平台账号 + cookie + token 落这里 |
| `%APPDATA%\WEMedia\DB\AccountDb_<ts>.db` ×5 | 20–64 KB | 账号库的历史/多副本（疑似备份或迁移残留） |
| `%APPDATA%\WEMedia\{ArticleDb,MaterialDb,VideoDb,StatisticsDb,Data,DynamicDb}.db` | 8 KB–4.5 MB | 作品/素材/统计等业务库 |
| `%APPDATA%\WEMedia\UserInfo` | 1.9 KB | 本产品登录用户信息 |
| `Config\{...}` / `ConfigWEMediaUrl.ini` / `WEMediaConfig.txt` | — | 配置与"后端地址"配置 |

⇒ 账号态与凭证是**两套存储**：CEF 侧 cookie 库（浏览器登录用）+ 自家 `AccountDb`（本产品账号/平台账号映射与 cookie/token）。安装目录内**没有**任何 cookie/账号文件（便携目录只读，数据全在用户目录）。

### 4.4 决定性否定证据：不用离屏渲染做判定

| 关键词 | `WEMedia.exe` | `MediaTaskMgr.dll` |
|------|------|------|
| `windowless` | **0** | **0** |
| `offscreen` | **0** | **0** |
| `OSR` | **0** | **0** |
| `CefBrowser` | 6（正常嵌入） | 0 |

⇒ 参考产品B **不存在**「隐藏/离屏浏览器加载平台页面并抓 DOM 判登录」这条路径。它的浏览器只用于**人可见的登录/授权**，判定全部走 HTTP。这正是我们在 #3759 里改成默认关闭的那条路径的**反向印证**。

---

## 5. 登录 / 授权交互

### 5.1 可见 webview + 注入脚本（非隐藏）

平台登录页在 `loginwndweb` 里可见打开；宿主注入 §3.2 的脚本自动填表/点击；登录成功与否由宿主从 CEF 会话/页面回调判定，之后取 Cookie 交给 HTTP 引擎。**登录这一步是"可见的"**，不是后台偷跑。

### 5.2 但有"后台自动重登"（`backgroundautoreloginwnd`）

掉线后宿主可在后台打开该窗口**自动重登**。这就是我们刻意关掉的那类后台窗口 —— 它把"不需要用户看见"的浏览器隐藏起来，风险面与我们遇到的崩溃同类（只是它用 CEF，崩溃后果不一定同级）。

### 5.3 掉线 UX（原文话术，宿主 UTF-16 字符串）

- 「请扫码重新登录自媒体账号 "%s"」
- 「请重新登录自媒体账号 "%s"」
- 「正在登录-%s(第%d个/总共%d个账号)」
- 「首次登录的抖音号可能会频繁掉线，在登录 2-3 次后稳定」
- 「打开账号授权页面失败」
- 「您重新授权的账号不是原账号」（防换号）
- 「你添加的账号授权数量已经超出限制!」

⇒ 它的产品语义是"**账号 = 需要用户参与维持的授权**"，并且**明确承认平台侧存在"频繁掉线"的客观现象**（甚至写进文案）。这与我们"不假装能消除崩溃、只保证降级不丢应用"的口径一致。

### 5.4 能力级授权标志（比我们细）

前端 `accountInfo` 字段（原文注释）：

```js
id / name / avatar          // 账号身份
im_flag        // 0 私信未授权 1 私信已授权
open_id        // 账号授权id
im_enterprise  // 是否企业账号 0 否 1 是
im_supported   // 是否支持私信 0 是 1 否
sp_flag        // 查询特定视频数据是否授权 1 是 0 否
```

还有独立的功能账号类型：「设置附属抖音账号」「设置私信监控账号」「设置评论监控账号」，且各自有配额（"添加私信监控账号失败!"、"您可以添加的评论监控账号数量超过限制"）。

⇒ 它的账号模型是**二维**：`账号登录态` × `能力授权(私信/数据/评论监控)`。我们目前只有一维（登录态三态）。

### 5.5 自家账号体系与平台账号分离

`loginInfo`（本产品用户）：`logintoken` / `uid` / `usertype`(免费/中级/高级/定制/初级) / `issubuser`(主/子账号) / `isteam`(个人/团队) / `istryvip`(试用)。
`accountInfo`（平台账号）：见 §5.4。
另：宿主 169 条自有 URL 指向**厂家自有后端**（用其品牌域名，此处不转录），说明其 VIP/团队/云端恢复等能力由自家服务提供。

---

## 6. 与我们（Electron 版）的对比

| 维度 | 参考产品A（Electron） | 参考产品B（CEF 壳） | 我们（现状） |
|------|------|------|------|
| 平台登录态判定 | Cookie 提取 + HTTP API | **Cookie + 原生 HTTP API**（同法） | Cookie + HTTP API（#3759 起**唯一**路径） |
| 浏览器用于判定？ | 否（可见 BrowserView 仅登录用） | **否**（`windowless/OSR` = 0） | 否（默认关闭，允许集空集） |
| 隐藏/后台浏览器 | `render-process-gone` 只挂普通 UI 窗口且只 `reload()` | **有** `backgroundautoreloginwnd`（后台自动重登） | **无**（刻意去掉） |
| 状态粒度 | 登录/失效（推测） | **登录态 × 能力授权**（`im_flag`/`sp_flag`） | 三态：正常/失效/**未确认**（#3759） |
| 失败原因话术 | 未知 | **平台错误码 → 人话**（"授权失效,请重新授权"） | 仅内部 `reason`，UI 统一「未确认」 |
| 凭证处理 | 提取 Cookie | Cookie + **账号密码注入登录页**（凭证重放） | 仅 Cookie（不重放密码） |
| 判定执行位置 | 主进程 JS | **原生 C++**（`MediaTaskMgr.dll`） | 主进程 JS（同进程，崩溃会带崩应用） |

---

## 7. 可迁移 / 不可迁移

### 可迁移（建议做）

1. **错误码 → 用户话术映射表**（`2190008`→重新授权、`100437`→无权限取私密数据…）。当前我们只会说「未确认」，用户不知道该做什么。→ 新建 `PLATFORM_LOGIN_ERROR_HINTS`（平台级），把 `reason` 细化到"可执行提示"。
2. **能力级授权态**（对应 `im_flag`/`sp_flag`）：把"能发布正文"与"能取数据/能评论"拆成独立状态，用于发布前置校验与提权引导。我们已有 `unverified` 第三态，扩成二维是自然演进。
3. **三态命名口径**：它把"登录失效"与"查询失败"分开（`logout` vs `fail`），与我们「失效 vs 未确认」**同构**；可把它作为 PRD §17.4 的外部互证写进去。
4. **"频繁掉线"如实写进 UI 文案**：它把平台客观现象直接告诉用户（"首次登录的抖音号可能会频繁掉线，在登录 2-3 次后稳定"），降低误判为产品 bug 的概率。

### 不可迁移（明确不做）

1. **后台自动重登窗口**（`backgroundautoreloginwnd`）：正是我们关掉的路径；且自动重登会放大风控/验证码触发概率。
2. **账号密码注入平台登录页重放**：安全（本地保存可逆凭证）、合规（自动化登录）、风控（异地/异常登录）三重风险，且一旦失败会带来更多"账号异常"支持成本。
3. **原生 C++ 承载账号引擎**：迁移成本极高（我们要重写整套平台适配），且我们的 Electron 主进程同样能做到 HTTP 单轨；真正的收益点应是 §9 的"独立进程隔离"，而不是"换语言"。

---

## 8. 对我们后续动作的建议（按优先级）

| 优先级 | 动作 | 落点 |
|------|------|------|
| **P0（已在做）** | 维持 HTTP 单轨 + 允许集空集；把本文 §4.4/§6 作为**外部互证**写进 PRD 与 BUGFIX 文档 | `01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §18、`01-docs/BUGFIX-LOGIN-CHECK-HTTP-ONLY-2026-10-16.md` |
| **P1** | `PLATFORM_LOGIN_ERROR_HINTS`：把 `reason` 细化为用户可执行提示（"请重新登录"/"无权限读取该数据"/"网络失败可重试"） | `apps/desktop/electron/publishers/account-manager.js` + locales（zh/en 成对） |
| **P1** | 能力级授权态二维化（登录态 × 能力），先做"数据读取"与"评论/互动"两项 | 账号模型 + 账号页 UI（需 PRD 先行） |
| **P2** | 独立进程隔离（DOM 判定将来若需要，放 `utilityProcess`，崩溃不回传主进程） | 见 §9 |
| **P2** | 掉线文案补充"平台侧可能频繁掉线"的说明 | locales + 账号页 |
| **不做** | 后台自动重登、凭证重放、换语言重写账号引擎 | — |

---

## 9. 证据清单（可复核）

| 证据 | 取值方式 | 结果 |
|------|------|------|
| 宿主桥函数全量 | 扫 `Asset\dist` 全部 js/html，正则 `window\.(wk[A-Za-z0-9_]+)` | **5 个**（见 §3.1） |
| 离屏渲染 | `WEMedia.exe`/`MediaTaskMgr.dll` 字节扫描 `windowless`/`offscreen`/`OSR` | **0 / 0 / 0** |
| 平台 URL | `MediaTaskMgr.dll` 可打印 ASCII 串中 `^https?://` | **1337 条**（域名分布见 §3.3） |
| HTTP 原语 | 同 DLL 串扫描 | `Cookie:`1 / `Set-Cookie`1 / `cookies`2 / `WinHttp`4 / `libcurl`1 / `curl_easy`6 / `CefCookieManager`**0** |
| 三态模型 | `Asset\dist\view-work-analysis\js\client.js` 原文注释与赋值 | `suc`/`logout`/`fail` + 三句 `msg` |
| 错误码映射 | `Asset\dist\view-dy-analysis\user-list.html` | `100437`→无法获取私密账号数据；`2190008`→授权失效,请重新授权；`el.b` case 1/3 同 |
| 登录注入脚本 | `WEMedia.exe` ASCII 串 | `ipt-account-login`/`ipt-pwd-login`/`btnLogin`/`ClickEnterLoginPage`/`GetAccountInfo`/`InputAccountInfo3`/`AiqiyiAccountLoginSuc` |
| 窗口资源名 | 同 EXE | `loginwndweb`/`backgroundautoreloginwnd`/`importaccountwnd`/`cloudrestoreaccountwnd`/`scan_code_from_loginwnd`/`tip_pop_from_loginwnd*` |
| 能力级授权 | `Asset\dist\view-dy-interaction|view-dy-publicize\js\login.js` | `im_flag`/`sp_flag`/`open_id`/`im_supported`/`im_enterprise`（含中文注释） |
| Cookie 落盘 | `%APPDATA%\WEMedia` 目录枚举 | `CefCookie\globalCache\Network\Cookies` 20KB；`DB\AccountDb.db` 64KB（含 `account`/`cookie`/`token`） |
| 第三方 SDK 辨识 | `Asset\sign2\sign2.js`、`sign\sign6.js` | 出现 `@xhs/launcher-plugin-store`、`Auth/*`、`internalSSO`、`domain:"xiaohongshu.hk"` ⇒ 平台官方 SDK，非自研 |

---

## 10. 局限（不假装闭合）

1. 未抓包：无法证明"它调 user-info 接口时带的就是 AccountDb 里的 cookie"，只能从"原生侧有 Cookie 头 + CEF 侧有 cookie 库 + DB 里有 cookie/token 字段"三点推断链路。
2. 未解 SQLite：`AccountDb.db` 的表结构与字段未展开（只按字节出现 `account`/`cookie`/`token` 判读）；`Cookies` 库未解码 host 列表，因此**哪几个平台曾在 CEF 内登录过**没有直接读数。
3. 未取 CEF 版本（`libcef.dll` 版本资源未读）；因此"其 CEF 版本是否存在与我们同类的渲染崩溃"无法比较。
4. `sign2/sign6` 只做了归属辨识，未做签名算法还原（那是另一条线：`ANALYSIS-SIGN-SERVICE-DEEP-2026-09-30.md` 的范畴）。
5. 错误码映射只来自**前端 switch 的字面**，样本仅两个码；不代表其后端完整错误码表。
6. 未验证其"账号密码"是否本地明文/可逆保存——只证明宿主会把密码作为参数注入登录页；存储形态未取证。

---

## 11. 与我们的关系（一句话）

> 参考产品A（Electron）告诉我们「**不用隐藏窗口也能判登录**」；参考产品B（CEF）进一步告诉我们「**浏览器只做人可见的登录，判定一律走 HTTP，并且把失败原因翻译给用户、把能力授权拆成独立维度**」。
> 我们 #3759 走的是同一条路（默认关闭 + HTTP 单轨），下一步该补的不是架构，而是**失败语义**（原因话术）与**能力维度**（授权细化）。
