# tasks — 内嵌登录视图的外部协议守卫

## 1. 规格与设计
- [x] 1.1 openspec change 落盘（proposal / design / specs）
- [x] 1.2 现场取证记录（Windows 弹窗 = 未注册 `bitbrowser://`；本机唯一发出方 = Tabbit 扩展探测；本应用自身 0 命中）

## 2. TDD：先写失败测试
- [ ] 2.1 `external-protocol-guard.test.js`：判据（http/https 放行；自定义协议 / javascript: / data: / file: / 非 URL 拒绝；带 userinfo 拒绝）
- [ ] 2.2 同文件：守卫行为（window-open allow/deny + WARN 日志；will-navigate preventDefault / 放行；缺方法时静默跳过）
- [ ] 2.3 接线测试：五个视图创建点均调用统一守卫并带可区分 tag

## 3. 实现
- [ ] 3.1 新增 `electron/services/external-protocol-guard.js`（判据复用 `safe-http-url` 共享实现，不自带协议正则）
- [ ] 3.2 接线：`auth-view-session.createAuthView`（tag=auth-view）
- [ ] 3.3 接线：`qrcode-login.openLogin`（tag=qrcode-login）
- [ ] 3.4 接线：`oauth-manager`（tag=oauth）
- [ ] 3.5 接线：`rpa-view-session._createWindow`（tag=rpa-view）
- [ ] 3.6 接线：`auth-view-manager.loginSilent`（tag=silent-auth）

## 4. 验证
- [ ] 4.1 新增/相关单测全绿
- [ ] 4.2 `href-scheme-contract.test.js` 仍绿（守卫模块不得自带协议正则；window.js 判据不得被动）
- [ ] 4.3 QM-2 代码必检项 + 文档同步门禁
- [ ] 4.4 CCG 外部双家族评审（claude + opencode 后端）并处理发现

## 5. 落地
- [ ] 5.1 提交 + 推分支 + 开 PR
- [ ] 5.2 门禁全绿后自动 squash 合并 + 删远端分支
- [ ] 5.3 回读该 merge SHA 触发的 main push CI
- [ ] 5.4 写 `openspec/records/login-view-protocol-guard.md` 执行记录
