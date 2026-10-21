# design — 内嵌登录视图的外部协议守卫

## 1. 判据（唯一真源 + 更严一档）

| 判据 | 用途 | 实现 |
|---|---|---|
| 协议白名单 | 决定"这个 URL 能不能在应用里走" | 复用 `packages/shared-utils/src/safe-http-url.js` 的 `safeHttpUrl`（`http://` / `https://` 前缀，**不自带正则**） |
| userinfo 拒绝 | 比 `safeHttpUrl` 更严一档 | `new URL()` 解析后取 `username` / `password`，非空即拒 |

> 为什么不用 `safeHttpUrl` 单独判完：它是**前缀**判定，`https://user:secret@host/` 会被放行。
> 导航面交给的是"让页面跳去哪儿"，带 userinfo 的 URL 属于伪装凭据，必须挡。
> 这与 `electron/window.js` 的 `isAllowedExternalUrl`（OS 打开面）**同档更严**，但**不合并**——
> 仓库既有约定是"按 sink 分策略"（见 `01-docs/PRD-HREF-SCHEME-GUARD-2026-09-29.md` §5.1），
> 且 `window.js` 的实现被 `apps/desktop/src/href-scheme-contract.test.js:306-311` 钉在原地，本 PR 不动它。

## 2. 模块 API

`apps/desktop/electron/services/external-protocol-guard.js`

```js
/**
 * @param {unknown} rawUrl
 * @returns {boolean} 是否允许在应用内导航/开窗（http/https 且无 userinfo）
 */
function isAllowedNavigationUrl (rawUrl)

/**
 * 给一个 webContents 装外部协议守卫。
 * @param {any} webContents
 * @param {{ tag?: string }} [options]
 * @returns {{ installed: boolean, blockedWindowOpen: number, blockedNavigation: number }}
 */
function attachExternalProtocolGuard (webContents, options = {})
```

### 2.1 拦截语义

| 通道 | 判据不通过时 | 判据通过时 |
|---|---|---|
| `setWindowOpenHandler(details)` | `{ action: 'deny' }` + WARN 日志 | `{ action: 'allow' }`（= Electron 默认新开窗口，与今天一致） |
| `will-navigate(event, url)` | `event.preventDefault()` + WARN 日志 | 放行（登录重定向链依赖它） |

`will-navigate` **只对主框架导航**触发；子框架（iframe）里的 `data:`/`blob:` 图片不在拦截面内，
不会误伤二维码图片、验证码 iframe。

### 2.2 日志

```js
log.notify('ExternalProtocolGuard', 'external-protocol-blocked', {
  level: 'WARN',
  params: { tag, source, url },
})
```

- `tag`：视图标识（如 `auth-view` / `qrcode-login` / `oauth` / `rpa-view` / `silent-auth`），用于定位是谁发起的。
- `source`：`window-open` | `navigation`。
- `url`：被拦 URL 原串（走 logger 自带脱敏/换行消毒）。

日志模块名统一用 `ExternalProtocolGuard`（不按视图分裂），`tag` 进 params —— 便于"一次 grep 看全部"。

### 2.3 安装失败怎么办

`webContents.setWindowOpenHandler` / `webContents.on` 缺失时**静默跳过**（`installed:false`），
不抛错、不中断视图创建。理由：单测里的简化 mock 与真实 Electron 行为有差，
守卫装不上不应让登录页打不开（登录是主流程，守卫是加固）。

## 3. 接线点

| 文件 | 位置 | tag |
|---|---|---|
| `electron/services/auth-view-session.js` | `createAuthView()` 造出的 `WebContentsView` | `auth-view` |
| `electron/services/qrcode-login.js` | `openLogin()` 造出的 `WebContentsView` | `qrcode-login` |
| `electron/services/oauth-manager.js` | OAuth `WebContentsView` | `oauth` |
| `electron/services/rpa-view-session.js` | `_createWindow()` 造出的 `BrowserWindow` | `rpa-view` |
| `electron/services/auth-view-manager.js` | `loginSilent()` 造出的隐藏 `BrowserWindow` | `silent-auth` |

`createAuthView` 是 `auth-view-manager` 的 `openLogin` / `openSavedAccount` 共用的视图工厂，
装在这里即覆盖"添加账号"与"重新登录"两条路径。

## 4. 测试策略（TDD）

1. **模块单测** `electron/services/external-protocol-guard.test.js`
   - 判据：http/https 放行；`bitbrowser:`/`javascript:`/`data:`/`file:`/非 URL 拒绝；带 userinfo 的 https 拒绝。
   - 守卫：`setWindowOpenHandler` 对 http(s) 返回 allow、对自定义协议返回 deny 并记 WARN；
     `will-navigate` 对自定义协议 `preventDefault`、对 http(s) 不拦。
   - 缺方法时 `installed === false` 且不抛错。
2. **接线测试**：五个视图各自在创建视图后调用了 `attachExternalProtocolGuard`（用模块 mock 断言调用参数与 tag）。

## 5. 回归风险清单

| 风险 | 评估 | 处置 |
|---|---|---|
| 登录页靠 `window.open(http)` 跳新窗 | 中（微信/公众号登录确有此形态） | http(s) 一律 allow，行为与今天一致 |
| 登录页靠主框架跳转到 http(s) | 高（登录重定向链） | `will-navigate` 对 http(s) 放行 |
| iframe 里的 `data:` 图片 | 中 | `will-navigate` 不对子框架触发；`setWindowOpenHandler` 只管新窗 |
| 平台页需要 `about:blank` 中转 | 低 | 拦下并记日志，不影响 http(s) 主链路 |
| RPA 自动化窗口 | 中 | 只拦非 http/https 协议，自动化脚本走的都是 http(s) |

## 6. 不做的事（重申）

- 不改 `window.js` 的 `isAllowedExternalUrl`（被合同测试钉在原地）。
- 不改 `safe-http-url.js` 共享实现（它是渲染层与主进程共用的单一真源）。
- 不在代码/文档里出现具体竞品或第三方浏览器产品名（仓内有品牌残留门禁）。
