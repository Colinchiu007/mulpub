# RPA 发布前把凭证库 cookie 注入浏览器 session

## 问题（2026-10-23 实测）
- 账号 `0891817b` 重新登录后，App 侧 `cookieLen=284`（凭证库/分区已更新）。
- 但 `channels.weixin.qq.com` 页面 context 里 `cookies()` 返回 **0 条**，页面停在 `login.html`。
- 页内调用 `helper_upload_params` 返回 `{"errCode":300334}` / 早前 `300342`。
- ⇒ **凭证库有登录态、浏览器没有**，RPA 页面因此永远未登录。

## 变更
- `apps/desktop/electron/services/rpa-view-manager.js`：在 `cookie` 字符串确定后，按 cookie 名逐条
  `session.defaultSession.cookies.set({ url, name, value, domain, path })` 注入。
- 域名：`tencent_video → .weixin.qq.com`，`toutiao → .toutiao.com`。
- 注入失败仅 warn，不阻塞发布；注入成功打印 `cookie inject -> browser session: N cookies platform=… domain=…`。

## 验证
- `node --check` 通过。
| 项 | 状态 |
| --- | --- |
| 远程同步 | 由门禁推导 |
