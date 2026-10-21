# login-view-protocol-guard — 内嵌登录视图的外部协议守卫

> 起因：2026-10-21 用户报「账号页抖音账号已失效 → 点卡片 → 新标签打开抖音登录页」的同一时刻，
> Windows 弹出系统对话框「获取打开此'bitbrowser'链接的应用 / 你的电脑没有可打开此链接的应用」。
>
> 现场取证（本机实测，非推测）：
> - 该对话框是 **Windows 11 系统自身**的"未注册协议"提示框：系统被要求打开一个 `bitbrowser://` 开头的链接，
>   而本机注册表里 **没有** `bitbrowser` 协议（`HKCU\Software\Classes\bitbrowser`、`HKLM\SOFTWARE\Classes\bitbrowser` 均不存在），
>   Tabbit Browser 只注册了 `tabbit-browser` / `tabbit-cn-browser`。
> - 本机唯一会发出 `bitbrowser://` 的东西是 **Tabbit Browser 自带扩展**
>   （`Tabbit Browser\User Data\Default\Extensions\dbjibobg…\1.38.0_0\static\js\async\48515.js`）：
>   它给每个注入页面创建一个隐藏 iframe `t.src="bitbrowser://cc/"` 探测本机是否装了比特浏览器客户端。
>   Tabbit 又是本机 https 默认浏览器（UserChoice ProgId `TbBrHTM…`），于是"任何交给系统浏览器打开的页面"都可能触发这次探测。
> - **本应用自身不产生 `bitbrowser://`**：全仓字面量搜索 0 命中；唯一把链接交给系统的地方
>   （`electron/window.js` 的 `openExternalUrl → shell.openExternal`）被 `isAllowedExternalUrl` 硬拦为 http/https；
>   本地账号数据（`shared-user-data/backend-data/accounts.json`）里也没有此类 URL。

---

## 一、为什么这仍然是本应用要修的洞

取证只能证明"**弹窗由谁发起**"，不能证明"**弹窗可以在什么条件下由本应用内的页面发起**"。
本应用把多个平台的真实登录页/创作者页装进 **内嵌视图**（Electron `WebContentsView` / `BrowserWindow`）里跑，
而这些视图**没有装协议守卫**：

| 视图 | 加载的页面 | 现状 |
|---|---|---|
| `auth-view-session.js` `createAuthView` | 平台登录页（账号登录/重新登录） | ❌ 无 `setWindowOpenHandler`、无 `will-navigate` 守卫 |
| `qrcode-login.js` | 平台扫码登录页 | ❌ 同上 |
| `oauth-manager.js` | 平台 OAuth 授权页 | ❌ 同上 |
| `rpa-view-session.js` `_createWindow` | 平台自动化页（发布/采集） | ❌ 同上 |
| `auth-view-manager.js` `loginSilent` | 平台登录页（静默校验） | ❌ 同上 |
| `webview-manager/tab-lifecycle.js` | 账号标签页 | ✅ 已有协议白名单守卫 |
| `identity-auth-window.js` | Logto 身份登录窗 | ✅ 已有守卫 |
| `signer/signer-page-manager.js` | 平台签名页 | ✅ 已有硬锁 |

Electron 的默认行为是：页面发起 `window.open('bitbrowser://…')` 或主框架导航到自定义协议时，
Chromium 会把它当**外部协议**交给操作系统 → Windows 找不到处理程序 → 弹「获取打开此'xxx'链接的应用」。
也就是说：**平台登录页里任何一段第三方脚本（广告、SDK、跳端逻辑）都可能触发这个系统弹窗**，
而这条路径今天在登录/扫码/OAuth/RPA 五个视图上是敞开的。

## 二、做什么

1. 新增统一守卫模块 `apps/desktop/electron/services/external-protocol-guard.js`：
   - 协议判定复用共享实现 `packages/shared-utils/src/safe-http-url.js`（**不自带协议正则**，符合
     `apps/desktop/src/href-scheme-contract.test.js` 的"单一口径接线锁"）；
   - 额外拒绝带 userinfo（`username`/`password`）的 URL；
   - 提供 `attachExternalProtocolGuard(webContents, { tag })`：装 `setWindowOpenHandler`（非 http/https 一律 deny）
     与 `will-navigate`（非 http/https 一律 `preventDefault`），拦截时记一条 WARN 结构化日志。
2. 把守卫接到上表五个缺守卫的视图上。
3. `window.js` 的 `isAllowedExternalUrl` **保持原样不动**（`href-scheme-contract.test.js:306-311` 钉住
   它必须留在 window.js 源码里、必须含 `url.username`、必须写明与 `safe-http-url` 的关系）。

## 三、不做什么

- 不改 `window.js` 的 OS 打开面策略（它比导航面更严，本 PR 不去动）。
- 不改任何登录/扫码/OAuth/RPA 的业务流程、URL、超时与凭证抓取逻辑。
- 不改普通标签页（`tab-lifecycle.js`）已有的守卫。
- 不做"新窗口一律禁止"：http(s) 的 `window.open` 行为保持与今天一致（登录页跳新窗的既有场景不受影响）。
- 不引入 `bitbrowser`/`比特浏览器` 等任何具体产品名到代码里（本仓有品牌残留门禁）。

## 四、影响面

- 行为变化：仅"平台页请求非 http/https 协议"这一种情况，从"交给操作系统 → 弹系统框"变成"应用内拦截 + 记日志"。
- 不受影响：所有 http/https 跳转、登录成功判定、Cookie/localStorage/IndexedDB 抓取、标签页、发布链路。
