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
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `apps/desktop/electron/services/external-protocol-guard.js`（判据复用 `packages/shared-utils/src/safe-http-url.js` 的共享实现 + 额外拒绝 userinfo；提供 `attachExternalProtocolGuard(webContents,{tag})`：window-open 非 http(s) 一律 deny、will-navigate 非 http(s) 一律 preventDefault，拦截记 WARN 结构化日志 `ExternalProtocolGuard/external-protocol-blocked`；**同一 webContents 重复安装幂等**，见 QM-6 i1），并接线到五处：账号登录视图（`auth-view-session.createAuthView`，tag=auth-view）、扫码登录（`qrcode-login.openLogin`）、OAuth 授权（`oauth-manager`）、RPA 窗口（`rpa-view-session._createWindow`）、静默登录（`auth-view-manager.loginSilent`）。新增用例 **47 条**：`external-protocol-guard.test.js` 31 条（判据 18 + 守卫行为 10 + 账号登录视图行为级接线 1 + 幂等/身份冲突 2）、`external-protocol-guard-wiring.contract.test.js` 8 条（源码接线锁：五处必须调用统一守卫且带可区分 tag + 已有守卫的三处不得被重复接管 + 模块本身必须复用共享判据 + **锁自身的 4 探针元用例**：跨行/嵌套括号/括号前空格三种写法都认，证明这条锁不是恒绿）、`external-protocol-guard-wiring.behavior.test.js` 4 条（**行为级**接线：真实驱动 qrcode/oauth/rpa/silent-auth 四处，取真实视图/窗口直接调用其守卫 handler）、`external-protocol-guard-wiring.negative.test.js` 4 条（**变异反向**：把守卫模块替换成空实现后同样四处确实没有守卫 ⇒ 正向断言敏感、非恒真）。TDD 先测后码：模块未实现时 7 条红，实现后全绿 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①新守卫模块**登记进** `href-scheme-contract.test.js` 的 `MAIN_CHAIN_URL_GATE_FILES` ⇒ "必须引用共享判据、不得自带协议正则"从此受合同锁守；②新增接线锁文件 `external-protocol-guard-wiring.contract.test.js` ⇒ 以后再新增"加载外部页面的视图"却忘装守卫，五处清单会因"新增视图未登记"而被点名（清单只能缩小这一约束在 spec 里写死）；③`apps/desktop/test-setup.js` 的 electron mock 补 `setWindowOpenHandler`（真实 Electron 有此方法，之前 mock 缺它 ⇒ 接线在测试里根本不可见，这是逃逸层②的具体成因） |
| 行尾与 diff 对账 | ✅ | 新增 8 个文件全部转成 **CRLF、无 BOM**（与工作区既有形态一致：抽样 `logger.js` CRLF=334/bareLF=0、`auth-view-session.js` CRLF=210/bareLF=0）；改动的 7 个既有文件逐个复核仍为纯 CRLF、bareLF=0（编辑未引入混合行尾）；两口径 numstat 待提交后取 |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` ⇒ 检查域内测试文件 **116 个**、`OK: 全部测试均已接线或按欠账登记`（exit=0）⇒ 新增 2 个测试文件无新增欠账；`node .github/scripts/check-max-lines.js` ⇒ 无新增超大文件、挂账清单与现实一致；`node scripts/check-renderer-cjs-boundary.js` PASS；`node scripts/check-no-brand-residue.js` PASS（扫 11410 tracked 文件） |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | QM-1：`pnpm --filter @multi-publish/desktop build:dir` **rc=0**（vite built in 35.97s；electron-builder 25.1.8 / electron 43.7.7 / win-unpacked 产出 `Multi-Publish.exe` 239,075,328 字节）；`npx asar list` 实测 asar 内含 `\electron\services\external-protocol-guard.js` ⇒ 新模块真进了包。QM-4：无 `.vue`/样式/locale 变更 ⇒ 无视觉面（唯一用户可感知变化是"系统不再弹那个框"） |
| QM-6 CCG 双模型外部评审 | ✅ | 真跑 `sh scripts/deep-review.sh`（critic=claude / proposer=opencode，判定 `DUAL`），**跑满 2 轮对抗**：第 1 轮 critic 出 4 条（1 Critical + 3 Warning，最低维度分 6）⇒ 引擎判 `self_play` 出口 → 逐条裁决（`prosecution`/`defense`/`verdict`/`rationale`）落 `.adversarial/ccg-deep-eea4b794/adjudication.json`：**i1 upheld 并已修**（守卫安装幂等：WeakMap 登记，重复安装不叠加 `will-navigate` 监听器，+2 条用例）、**i2 dismissed**（高危域 auth 项，已补 4 条行为级接线 + 4 条变异反向用例；**外部后端 claude 独立复核结论同为 dismissed**，公开证据 = PR #4163 评论）、**i3 dismissed 但采纳其文档建议**（spec.md 新增「新增同类视图必须同步登记」硬要求）、**i4 dismissed 但采纳其文档建议**（spec.md 明确 iframe 排除范围）。第 2 轮（对处置后的 diff 再评）critic 再出 4 条：i1 upheld 并已修（**幂等分支吞掉二次身份** ⇒ 身份不一致时保留首次 tag、记 `tagConflicts` 并出声，+1 条用例）、i2 upheld 并已修（**规格低报了覆盖面**：子框架的 `window.open` 其实照样被拦 ⇒ 规格改为按通道分列「导航 vs 新窗口」，实现不动——放行子框架等于重新开口子）、i3 upheld 并已修（接线锁的单条正则被正常写法打穿 ⇒ 改成**括号配平扫描** + 锁自身的 4 探针元用例）、i5 dismissed（"mock 可能拦不住 CJS require 导致假绿"已被本片自己的**变异反向用例**证伪：同一机制下守卫被替换成空实现后 4 条断言仍全绿）。第 2 轮**无高危域项**（`requiresExternalReview=[]`）⇒ 自扮演裁决即可闭合 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 推导（只认 squash 尾注 `(#NNNN)`）；合并前本篇不预写 `PASS`（`Gate 2c` 会判 `prematureClaim`） |

- 保留门禁：判定 docs-only=false（走完整节拍）| 变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅（`openspec/**` 命中 doc-gate 白名单）| 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按「旧载体冻结」政策**零改写**）| 远程同步 由门禁推导

### 用户视角的变化

- **改之前**：在账号页点开一个已失效的抖音账号，登录页正常打开，但 Windows 会冷不丁弹一个「获取打开此'bitbrowser'链接的应用」的系统框——用户既不知道它从哪来，也关不掉不掉地杵在屏幕中央（点"浏览 Microsoft Store"还会被带去装一个无关应用）。
- **改之后**：平台页再发起这类跳转，请求**在应用内部**就被拦下并记进应用日志，**操作系统不再弹任何框**；登录页本身的跳转、新窗口、扫码、OAuth、发布自动化全部照旧，行为零变化。

### 外部双家族评审

真跑 `sh scripts/deep-review.sh`（判定记录按内容寻址命中 `8d6a9bc4…`，critic=claude / proposer=opencode，
`mode=DUAL`）。critic 出 **4 条**发现、4 个维度、最低分 6；引擎判 `status=self_play`（自扮演出口），
按裁决协议逐条填 `prosecution` / `defense` / `verdict` / `rationale`（落 `.adversarial/ccg-deep-eea4b794/adjudication.json`，
该目录被 `.gitignore` 排除 ⇒ 裁决产物是本机证据，**公开证据是 PR #4163 的评论**）。

| 编号 | 级别 | 裁决 | 处置与可验证证据 |
|---|---|---|---|
| i1 守卫安装无幂等性 | Critical | **upheld** | 已修：`WeakMap` 登记「已装守卫的 webContents」，重复安装直接返回首次状态对象、不再注册监听器（design §2.4）。证据：新增 2 条用例——重复安装时 `setWindowOpenHandler`/`on` **各只调一次**且第二次返回**同一个**状态对象；重复安装后触发一次拦截，日志**只写一条**。指控里「累积重叠 deny 处理器」那半句不成立（`setWindowOpenHandler` 是 setter，只覆盖不叠加），但「累积 `will-navigate` 监听器」那半句成立 ⇒ 判 upheld 并按"机制保证优于调用纪律"修 |
| i2 仅 1/5 处有行为级验证 | Warning（auth 高危域） | **dismissed** | 缺口真实，已闭合：新增 `external-protocol-guard-wiring.behavior.test.js`（4 条，真实驱动 qrcode-login / oauth-manager / rpa-view-session / auth-view-manager 四处，取真实视图/窗口直接调用其守卫 handler）+ `external-protocol-guard-wiring.negative.test.js`（4 条变异反向：把守卫模块替换成空实现后同样四处**确实没有**守卫 ⇒ 正向断言敏感、非恒真）。**高危域项的外部复核已按协议完成**：外部后端 `claude` 独立复核，结论同为 **dismissed**，原文与逐条处置见 PR #4163 评论（公开可点开，即 `externalReview.evidenceRef`）。claude 另提「若接线传错对象测试仍会绿」——已否证：正向用例断言的是视图**自己的** `webContents` 上的 handler，接线若传成 `view` 则取不到 handler ⇒ 用例会红 |
| i3 接线清单手动维护 | Warning | **dismissed**（采纳文档建议） | 形态与本仓既有登记制同形（`MAIN_CHAIN_URL_GATE_FILES` / `OPEN_SITES_GUARDED_IN_MAIN`），且仓内判据明确反对把登记表改成源码启发式推导（实测启发式出假阳与假阴，结局是逼人清空登记表）⇒ 换成启发式是更差的方案。但"要写进规格"的建议成立且已采纳：spec.md 新增 Scenario「新增同类视图必须同步登记」，要求 ① 新视图 SHALL 装守卫并同步登记、② 接线锁 SHALL 同时含行为级断言、③ 清单只能显式登记变更 |
| i4 iframe 内跳转不在拦截面 | Warning | **dismissed**（采纳文档建议） | 事实成立（`will-navigate` 只对主框架触发），但不在本守卫能力范围内、也不在本片威胁模型内（子框架外部协议请求在 Chromium 侧默认要求用户手势才外抛，暴露面显著小于主框架）。指控自带的建议是"在 spec.md 明确标注排除范围" ⇒ 已采纳：spec.md 新增 Scenario「子框架内的协议跳转属排除范围」（含"SHALL 显式声明，不得以'已全覆盖'表述"），design §2.5 同步写出边界 |

**评审环境缺陷（如实登记，非本刀引入）**：本机 Git Bash 的 `PATH` **不含 `/usr/bin`**（只有继承来的 Windows 条目），
`sha256sum` / `wc` / `cut` / `rm` 全部 `command not found` ⇒ 评审脚本算不出 diff 哈希、判定记录按内容寻址**落空**
（首跑报「提交时没跑判定器」，实为工具失明而非没跑）。处置：不改仓内脚本（本仓判据明确"工具失明比报错更贵"，
且改它属"改谁来守门"要人工过目），改用**调用侧**补 `PATH`（`export PATH="/usr/bin:/bin:/mingw64/bin:$PATH"` 后再跑
`sh scripts/deep-review.sh`）⇒ 判定记录按内容寻址命中 `8d6a9bc4…`，评审照常跑完。

### 未闭合（不假装已闭合）

- 本机复现未做：触发 `bitbrowser://` 的是 Tabbit 扩展在**Tabbit 窗口**里的探测帧，而本应用内嵌视图没有那个扩展 ⇒ **本应用这条链上的具体触发点无法在真机上复现**；本片证明的是"这条链不再通向操作系统"，不是"平台页不再请求该协议"。用户那边若要彻底消掉那个框，另有环境侧两条路（装上会注册 `bitbrowser://` 的客户端，或在 Tabbit 里禁用该注入扩展），属环境配置，不在本 PR 范围。
- `will-navigate` **只对主框架导航**触发 ⇒ **iframe 内的自定义协议导航**不在拦截面内（Electron 侧同样不外抛）；但 iframe 的 `window.open` 新窗口请求**照样被拦**（`setWindowOpenHandler` 对整个 webContents 生效，不区分发起帧）。已在 spec.md 写成按通道分列的口径，不以"已全覆盖"表述。
- 守卫对 `about:blank` 也按"非 http(s)"拦下（登录视图不需要它）；若将来某平台的登录流依赖 `about:blank` 中转，需要在守卫里显式放行。
- **真实 Electron 与单测 mock 的行为差异未覆盖**（CCG 外部复核 claude 指出）：触发时序、视图销毁后的清理等只能在真机验证，单测里的 mock 形状证明不了；本片未做真机端到端复核。
- 幂等性目前只有**模块级**用例（同一 mock 上重复安装不叠加监听器），未在真实视图上做行为级验证。
- 五处接线的**行为级**验证已覆盖 4 处（qrcode / oauth / rpa / silent-auth）+ 账号登录视图 1 处 = 全部 5 处；但驱动的是 mock 视图/窗口，非真机。
- RPA 窗口的真实自动化路径（抖音/知乎/快手发布）**未做真机端到端复核**：本片只保证"非 http(s) 协议被拦"，不保证"没有平台自动化流程依赖被拦的跳转"。
