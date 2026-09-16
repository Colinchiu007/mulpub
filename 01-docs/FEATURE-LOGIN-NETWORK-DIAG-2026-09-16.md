# FEATURE: 登录页网络诊断日志（二维码加载失败可观测化）

> 日期: 2026-09-16 | 分支: `login-qr-net-diag` | 基点: main `62edccb62`
> 背景: BUGFIX-LOGIN-CHECK-FALSE-EXPIRED-2026-09-16.md 同日排查链——微信公众号登录二维码加载失败诊断为代理/网络问题后，发现应用对该类失败完全无感知

---

## 1. 问题

登录页（如 https://mp.weixin.qq.com/）的二维码由 **iframe** 加载（`open.weixin.qq.com/cgi-bin/mpqrconnect`，长轮询走 `long.open.weixin.qq.com`，静态 JS 走 `res.wx.qq.com`）。**iframe 内部请求失败不触发 Electron `webContents` 的 `did-fail-load` 事件**——主进程仅有的 `did-fail-load` warn 监听（rpa-view-session.js:31）对这类失败完全静默，排障时无法区分「网络/代理问题」与「应用问题」。

## 2. 方案：会话级 webRequest 监听

`session.webRequest` 工作在 Electron session 层，**能观察到页面内所有请求（含 iframe 内部）**，正好补上盲区。

### 2.1 新模块 `electron/services/login-network-diagnostics.js`

导出：

| 导出 | 说明 |
|---|---|
| `attachLoginNetworkDiagnostics(ses, { platform, accountId })` | 挂接诊断监听（幂等） |
| `classifyNetError(error)` | net 错误码 → 人类可读排查提示（纯函数，便于单测） |

**行为**：

1. **幂等**：session 对象打标记 `ses.__loginNetDiagAttached`，同分区被多个登录标签复用不重复注册。
2. **URL 过滤**（webRequest filter）：`*://*.weixin.qq.com/*`、`*://*.wx.qq.com/*` 及裸域共 4 条——覆盖 mp/open/long.open/res.wx 全部登录链路域名。
3. **`onErrorOccurred`**：`ERR_ABORTED` 跳过（正常导航取消，避免噪音）；其余 `log.warn('LoginNetDiag', '[platform/accountId] request failed: <url> error=<net错误> ip=<ip> → <分类提示>')`。
4. **`onCompleted`**：`statusCode >= 400` 时——URL 含 `mpqrconnect`/`qrconnect`（二维码关键端点）→ `log.warn`；其余 → `log.info`。
5. **代理路径探测**：挂接时 `ses.resolveProxy('https://open.weixin.qq.com/')` → `log.info` 记录该域名实际会走 `DIRECT` 还是某个 `PROXY host:port`——这一条日志能直接回答「二维码请求走哪个代理」（本次排障最缺的信息）。

**错误分类（classifyNetError）**：

| net 错误码 | 提示 |
|---|---|
| ERR_PROXY_CONNECTION_FAILED / ERR_TUNNEL_CONNECTION_FAILED / ERR_PROXY_AUTH_REQUESTED | 代理不可达或认证失败：检查系统代理与账号代理设置 |
| ERR_NAME_NOT_RESOLVED | DNS 解析失败：可能为代理 fake-IP 残留，建议 ipconfig /flushdns |
| ERR_CONNECTION_TIMED_OUT / ERR_CONNECTION_RESET / ERR_CONNECTION_REFUSED | 连接失败：检查防火墙/代理节点可用性 |
| 其他 | 网络异常，请检查本机网络 |

### 2.2 挂接点 `electron/services/webview-manager.js`

- 位置：`createNewTabPage` 内 `session.fromPartition('persist:account-{accountId}')` 创建之后（~292 行）。
- 条件：仅 `useAccountSession === true`（账号分区）——**home 虚拟标签与普通浏览标签（`persist:browse-*`）不挂**。
- 防御：try/catch 包裹，挂接失败只 warn 不影响登录流程主功能。

## 3. 日志样例（排障时 grep `LoginNetDiag`）

```
[LoginNetDiag] [wechat_mp/acc-3] proxy for open.weixin.qq.com → PROXY 127.0.0.1:7892
[LoginNetDiag] [wechat_mp/acc-3] request failed: https://long.open.weixin.qq.com/connect/l/qrconnect error=ERR_TUNNEL_CONNECTION_FAILED ip=127.0.0.1 → 代理不可达或认证失败：检查系统代理与账号代理设置
[LoginNetDiag] [wechat_mp/acc-3] HTTP 502 https://open.weixin.qq.com/cgi-bin/mpqrconnect?... (二维码关键端点)
```

## 4. 数据校验与边界

- 监听是**只读观测**（webRequest 不调用任何 preventDefault/修改），对登录流程零干扰。
- platform/accountId 缺省 `'unknown'`。
- 幂等标记挂在 session 实例上，session 生命周期结束标记随之消失，无泄漏。
- URL 过滤限定微信登录链路域名，其他平台/浏览流量零开销（filter 由 Chromium 网络层前置匹配）。

## 5. 显示项 / 提示文字 / 交互

- **零 UI 变化、零新增用户可见文案**（全部为主进程日志）；i18n zh/en 无变化；无新增 IPC/preload 通道（契约门禁零涉及）。

## 6. 测试

- `login-network-diagnostics.test.js` 14 例：幂等重挂不翻倍、filter 4 条 URL、classifyNetError 四类映射、ERR_ABORTED 静默、mpqrconnect+502→warn、其他 URL+404→info、200→无日志、resolveProxy 成功/失败路径、缺省 unknown。
- `webview-manager.test.js` 37 例回归全绿（挂接文件定向回归）；定向合计 51/51。
- eslint 0 error（webview-manager 存量风格 warning 不变）；`check-locale-sync --cjk` PASS（1410 < 基线 1644）。

## 7. 未来扩展

- 覆盖其他平台登录链路域名（douyin/toutiao/bilibili 等）：往 URL filter 数组追加即可。
- auth 独立窗口（auth-view-session）同样挂接：同一函数直接复用。
- 失败事件经 IPC 透出到前端登录页提示条（需新增通道，走契约登记链）。
