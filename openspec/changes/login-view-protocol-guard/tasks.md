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
- [x] 4.1 新增/相关单测全绿
- [x] 4.2 `href-scheme-contract.test.js` 仍绿（守卫模块不得自带协议正则；window.js 判据不得被动）
- [x] 4.3 QM-2 代码必检项 + 文档同步门禁
- [x] 4.4 CCG 外部双家族评审（claude + opencode 后端）并处理发现

## 4b. CCG 双家族评审处置（2026-10-21，critic=claude / proposer=opencode）

评审产物：`.adversarial/ccg-deep-eea4b794/`（critic 4 条发现，最低维度分 6，判 `self_play` 出口）。
裁决落盘：同目录 `adjudication.json`（逐条 prosecution / defense / verdict / rationale）。

| 编号 | 级别 | 裁决 | 处置 |
|---|---|---|---|
| i1 守卫安装无幂等性 | Critical | upheld | 已修：`WeakMap` 登记已装守卫的 webContents，重复安装不再叠加 `will-navigate` 监听器（design §2.4）；新增 2 条用例（重复安装不叠加监听器 / 重复安装后拦截只记一次日志） |
| i2 仅 1/5 处有行为级验证 | Warning（auth 高危域） | upheld | 已补：新增 `external-protocol-guard-wiring.behavior.test.js`，真实驱动 qrcode-login / oauth-manager / rpa-view-session / auth-view-manager 四处接线点并直接调用其守卫 handler（自定义协议拒、http(s) 放行）；按裁决协议由外部后端 claude 就本条出**公开**复核结论（PR #4163 评论），结论与 URL 落在 `adjudication.json` 的 `externalReview` 三格 |
| i3 接线清单手动维护 | Warning | dismissed | 形态与本仓既有登记制同形（`MAIN_CHAIN_URL_GATE_FILES` / `OPEN_SITES_GUARDED_IN_MAIN`），且仓内判据明确反对"从源码启发式推导名单"（实测启发式出假阳与假阴）；**采纳其文档建议**⇒ spec.md 新增 Scenario「新增同类视图必须同步登记」，把登记义务写成硬要求，并要求接线锁同时含行为级断言 |
| i4 iframe 内跳转不在拦截面 | Warning | dismissed | 事实成立（`will-navigate` 只对主框架触发），且属本守卫覆盖边界之外、暴露面显著小于主框架（Chromium 对子框架外部协议请求默认要求用户手势）；**采纳其文档建议**⇒ spec.md 新增 Scenario「子框架内的协议跳转属排除范围」，design.md §2.5 与执行记录未闭合项同步声明，不以"已全覆盖"表述 |

## 5. 落地
- [x] 5.1 提交 + 推分支 + 开 PR（#4163）
- [ ] 5.2 门禁全绿后自动 squash 合并 + 删远端分支
- [ ] 5.3 回读该 merge SHA 触发的 main push CI
- [x] 5.4 写 `openspec/records/login-view-protocol-guard.md` 执行记录

