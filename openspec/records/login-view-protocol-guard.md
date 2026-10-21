---
record: login-view-protocol-guard
task: 给加载平台真实页面的内嵌视图（账号登录/扫码登录/OAuth/RPA/静默登录）装统一外部协议守卫，拦掉会交给操作系统、进而弹出 Windows「获取打开此'xxx'链接的应用」的自定义协议跳转
date: 2026-10-21
---

## 本次执行记录：内嵌登录视图的外部协议守卫（login-view-protocol-guard，2026-10-21）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/electron/**`、`apps/desktop/test-setup.js`、`apps/desktop/src/href-scheme-contract.test.js`）+ 新增 openspec change ⇒ 隔离 worktree `D:/Data/projects/mp-worktrees/mp-login-view-protocol-guard`、裸分支 `login-view-protocol-guard`；共享根全程停在 `main` 且未落盘、未执行任何 git 写操作 |
| 第一性原因（QM-5 ①） | ✅ | 用户报障：账号页抖音账号已失效 → 点卡片 → 应用内新标签打开抖音登录页，**同一时刻** Windows 弹系统框「获取打开此'bitbrowser'链接的应用」。本机取证：该框是 Windows 的「未注册协议」提示框（`HKCU\Software\Classes\bitbrowser`、`HKLM\SOFTWARE\Classes\bitbrowser` **均不存在**；Tabbit 只注册 `tabbit-browser`/`tabbit-cn-browser`）；本机唯一发出 `bitbrowser://` 的是 Tabbit Browser 自带扩展的隐藏 iframe 探测（`…/Extensions/dbjibobg…/static/js/async/48515.js`：`t.src="bitbrowser://cc/"`）；**本应用自身 0 命中**（全仓字面量 + 本地账号数据均无），其唯一交给系统的地方 `electron/window.js` 的 `openExternalUrl → shell.openExternal` 被 `isAllowedExternalUrl` 硬拦为 http/https。**但本应用自身的洞是真的**：加载平台真实页面的五个内嵌视图**都没有协议守卫**——Electron 默认会把页面发起的自定义协议跳转当外部协议交给操作系统 ⇒ 平台登录页里任何一段第三方脚本都能把系统弹窗顶到用户脸上 |
| 逃逸分析（QM-5 ②） | ✅ | ①**判据层**：既有协议守卫只装在三处（`webview-manager/tab-lifecycle.js`、`identity-auth-window.js`、`signer/signer-page-manager.js`），登录/扫码/OAuth/RPA/静默登录五处**没有**；`href-scheme-contract.test.js` 的「单一口径接线锁」管的是"成链门禁文件必须引用共享实现"，**没有**"每个加载外部页面的视图必须装守卫"这一条 ⇒ 缺口既不在断言面也不在接线面。②**测试层**：五个视图的创建路径都带定时器/分区/真实平台 URL，既有测试无一断言"视图装没装守卫" ⇒ 装了不装都绿。③**人工层**：账号失效是常规操作，登录页是外部页面，"系统弹窗"这件事在应用内没有任何可见痕迹（框在系统层、应用内无日志、无状态）⇒ 现场只能靠本机注册表与浏览器扩展取证反推 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `apps/desktop/electron/services/external-protocol-guard.js`（判据复用 `packages/shared-utils/src/safe-http-url.js` 的共享实现 + 额外拒绝 userinfo；提供 `attachExternalProtocolGuard(webContents,{tag})`：window-open 非 http(s) 一律 deny、will-navigate 非 http(s) 一律 preventDefault，拦截记 WARN 结构化日志 `ExternalProtocolGuard/external-protocol-blocked`），并接线到五处：账号登录视图（`auth-view-session.createAuthView`，tag=auth-view）、扫码登录（`qrcode-login.openLogin`）、OAuth 授权（`oauth-manager`）、RPA 窗口（`rpa-view-session._createWindow`）、静默登录（`auth-view-manager.loginSilent`）。新增用例 33 条（判据 21 + 守卫行为 9 + **行为级接线 1**：造出登录视图后直接调它的 window-open handler，断言自定义协议被拒、http(s) 放行），另加接线锁 6 条（五处必须调用统一守卫且带可区分 tag；已有守卫的三处不得被重复接管）。TDD 先测后码：模块未实现时 7 条红，实现后全绿 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①新守卫模块**登记进** `href-scheme-contract.test.js` 的 `MAIN_CHAIN_URL_GATE_FILES` ⇒ "必须引用共享判据、不得自带协议正则"从此受合同锁守；②新增接线锁文件 `external-protocol-guard-wiring.contract.test.js` ⇒ 以后再新增"加载外部页面的视图"却忘装守卫，五处清单会因"新增视图未登记"而被点名（清单只能缩小这一约束在 spec 里写死）；③`apps/desktop/test-setup.js` 的 electron mock 补 `setWindowOpenHandler`（真实 Electron 有此方法，之前 mock 缺它 ⇒ 接线在测试里根本不可见，这是逃逸层②的具体成因） |
| 行尾与 diff 对账 | ✅ | 新增 8 个文件全部转成 **CRLF、无 BOM**（与工作区既有形态一致：抽样 `logger.js` CRLF=334/bareLF=0、`auth-view-session.js` CRLF=210/bareLF=0）；改动的 7 个既有文件逐个复核仍为纯 CRLF、bareLF=0（编辑未引入混合行尾）；两口径 numstat 待提交后取 |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` ⇒ 检查域内测试文件 **116 个**、`OK: 全部测试均已接线或按欠账登记`（exit=0）⇒ 新增 2 个测试文件无新增欠账；`node .github/scripts/check-max-lines.js` ⇒ 无新增超大文件、挂账清单与现实一致；`node scripts/check-renderer-cjs-boundary.js` PASS；`node scripts/check-no-brand-residue.js` PASS（扫 11410 tracked 文件） |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | QM-1：`pnpm --filter @multi-publish/desktop build:dir` **rc=0**（vite built in 35.97s；electron-builder 25.1.8 / electron 43.7.7 / win-unpacked 产出 `Multi-Publish.exe` 239,075,328 字节）；`npx asar list` 实测 asar 内含 `\electron\services\external-protocol-guard.js` ⇒ 新模块真进了包。QM-4：无 `.vue`/样式/locale 变更 ⇒ 无视觉面（唯一用户可感知变化是"系统不再弹那个框"） |
| QM-6 CCG 双模型外部评审 | 待回填 | 见下方「外部双家族评审」小节（提交后跑 `scripts/deep-review.sh`，critic=claude / proposer=opencode） |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 推导（只认 squash 尾注 `(#NNNN)`）；合并前本篇不预写 `PASS`（`Gate 2c` 会判 `prematureClaim`） |

- 保留门禁：判定 docs-only=false（走完整节拍）| 变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅（`openspec/**` 命中 doc-gate 白名单）| 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按「旧载体冻结」政策**零改写**）| 远程同步 由门禁推导

### 用户视角的变化

- **改之前**：在账号页点开一个已失效的抖音账号，登录页正常打开，但 Windows 会冷不丁弹一个「获取打开此'bitbrowser'链接的应用」的系统框——用户既不知道它从哪来，也关不掉不掉地杵在屏幕中央（点"浏览 Microsoft Store"还会被带去装一个无关应用）。
- **改之后**：平台页再发起这类跳转，请求**在应用内部**就被拦下并记进应用日志，**操作系统不再弹任何框**；登录页本身的跳转、新窗口、扫码、OAuth、发布自动化全部照旧，行为零变化。

### 外部双家族评审

（提交后按 `scripts/deep-review.sh` 真跑，critic=claude / proposer=opencode；本节随评审结果回填，不预写结论。）

### 未闭合（不假装已闭合）

- 本机复现未做：触发 `bitbrowser://` 的是 Tabbit 扩展在**Tabbit 窗口**里的探测帧，而本应用内嵌视图没有那个扩展 ⇒ **本应用这条链上的具体触发点无法在真机上复现**；本片证明的是"这条链不再通向操作系统"，不是"平台页不再请求该协议"。用户那边若要彻底消掉那个框，另有环境侧两条路（装上会注册 `bitbrowser://` 的客户端，或在 Tabbit 里禁用该注入扩展），属环境配置，不在本 PR 范围。
- `will-navigate` **只对主框架导航**触发；子框架（iframe）里的自定义协议跳转不在本守卫拦截面内（Electron 侧同样不外抛）。
- 守卫对 `about:blank` 也按"非 http(s)"拦下（登录视图不需要它）；若将来某平台的登录流依赖 `about:blank` 中转，需要在守卫里显式放行。
- 五处接线的**行为级**验证只覆盖了账号登录视图一处（`createAuthView` 可独立驱动）；其余四处由源码接线锁覆盖（理由与局限见 design.md §4）。
- RPA 窗口的真实自动化路径（抖音/知乎/快手发布）**未做真机端到端复核**：本片只保证"非 http(s) 协议被拦"，不保证"没有平台自动化流程依赖被拦的跳转"。
