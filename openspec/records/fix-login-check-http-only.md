---
record: fix-login-check-http-only
task: 登录态判定收敛到 HTTP 单轨——隐藏窗口兜底默认关闭（消除「应用因某平台页面整体消失」这一族崩溃）
date: 2026-10-16

---

## 本次执行记录：登录态判定收敛到 HTTP 单轨（fix-login-check-http-only，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR | 改 `apps/desktop/electron/publishers/account-manager.js`(+test)、`account-manager.test.js`；新增 `account-manager-http-only-policy.test.js`；文档 `01-docs/BUGFIX-LOGIN-CHECK-HTTP-ONLY-2026-10-16.md`（新）、`01-docs/PRD.md`、`01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §18、`CHANGELOG.md` ⇒ docs-only=false。隔离 worktree `D:\Data\projects\mp-worktrees\mp-login-check-http-only`（**D 盘，非 C 盘**）+ 裸分支 `fix-login-check-http-only`；共享根保持 main |
| 第一性原因（QM-5 ①） | ✅ | `checkLoginStatus` 在 HTTP/本地证据不足时开**隐藏 sandbox 窗口**加载平台页面抓 DOM 判登录态（`playwrightManager.getContext({show:false})` → `new BrowserWindow({show:false, webPreferences:{sandbox:true}})`）。该支路自 2026-09 起按平台逐个触发**原生渲染崩溃**：toutiao(09-16) → wechat_mp(10-06) → 知乎(10-14 #3726) → kuaishou(10-16)。真机现场三条判据同时成立：app 日志**戛然而止**（停在 `checkLoginStatus: start kuaishou`）、`crashpad_client_win.cc:867 not connected`（无 minidump）、主进程 `electron-exit code=4294930435`(`0xC0000135`)；随后全部 electron 进程消失、窗口空白 ⇒ 用户视角「应用突然关闭」。**关键补证**：只拆启动参数（`--no-sandbox` 与 swiftshader 互斥，另一 PR）**不足以**收敛——同一实例第一轮 kuaishou 通过、30 分钟后第二轮仍在同一处崩溃 ⇒ 这条支路本身必须默认关闭 |
| 逃逸分析（QM-5 ②） | ✅ | 单测层：既有锁只覆盖"白名单内的平台不开窗"，**没有"默认不允许开窗"这条不变量**，因此新增平台必然走老路；集成层：崩溃需要真实平台页面 + 真实账号 Cookie，CI 两者皆无（等价于永不覆盖）；观测层：崩溃不留 minidump、crashpad 连不上、日志戛然而止，现场无归因信息；对策层：每次处置都是"往白名单再加一个平台"（第 1→4 例），**默认值始终留在崩的那一侧** |
| 系统性漏洞定位（QM-5 ③） | ✅ | 分类：**测试场景缺失**——"默认路径不触碰隐藏窗口"这条安全不变量缺失，只有枚举式例外清单；**审查盲区**——需求原文（`01-docs/PRD.md` §「三种认证模式」第 2 条「隐藏 BrowserWindow 静默验证」）把"开隐藏窗口"写成了**产品契约**，于是实现与评审都以"白名单不够全"为结论，而不是质疑手段本身；**测试质量不足**——两例真正依赖该路径的子行为（数组选择器逐个尝试、仪表盘域名兜底）没有独立断言，一旦默认关闭就会连带失效而无人察觉 |
| 修复 + 回归保护（QM-5 ④） | ✅ | **修复**：新增 `DOM_LOGIN_CHECK_ALLOWED_PLATFORMS`（**默认空集**）——只有显式登记的平台才允许开隐藏窗口；`RENDER_CRASH_PRONE_OPEN_PLATFORMS` 保留为**硬否决**且**先于**允许集判定（否决永远赢）；不确定一律 `CHECK_LOGIN_INCONCLUSIVE`（`reason=hidden-browser-disabled-default`）。两个集合提到模块级并 **`Object.freeze`**；允许集**不再**以可变全局或 `_internals` 导出暴露（见下条"外部复核与整改"），测试注入改走 **函数显式参数** `checkLoginStatus(p, id, { domLoginCheckAllowed })`，不传即永远走模块常量（空集）。**回归保护**：新增 `account-manager-http-only-policy.test.js`（行为锁：非允许集平台 + HTTP 不确定 ⇒ `getContext` **零调用** + 未确认；结构锁：允许集**默认空集** + 否决判定先于允许判定）；两例既有用例改为**显式注入允许集**后原意保留（数组选择器 3 个候选断言、仪表盘域名兜底判有效） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 需求侧同步：`PRD.md` 的「三种认证模式」条目改写为「HTTP 单轨登录态判定」并留历史备注（说明"静默验证"目标保留、"隐藏窗口"手段下线）；② 功能 PRD 新增 §18（默认翻转表、判定优先级、流程影响、交互与显示影响、回退通道、回归保护）；③ 新增详细文档 `01-docs/BUGFIX-LOGIN-CHECK-HTTP-ONLY-2026-10-16.md`（含数据校验/流程/功能逻辑/交互逻辑/显示项与提示文字/边界与风险）；④ 文档写明**验证口径**：判断"崩溃已修"时观测窗口**必须覆盖 ≥2 轮 LoginMonitor（≥60 分钟）**（本轮曾以 240 秒误判）；⑤ 允许集的每一行准入都要求**真机复测证据**，禁止用环境变量临时开启 |
| TDD | ✅ | 先 RED 后 GREEN：新增策略锁 **2/2 红**（`expected "vi.fn()" to not be called at all, but actually been called 1 times`、`expected '// @ts-check…' to match /DOM_LOGIN_CHECK_ALLOWED_PLATFORMS…/`）→ 实现后绿；整改后策略锁扩为 **4 例**（反向控制 / **正向控制**（注入后才开窗，防"零开窗"断言退化成永真）/ 结构锁 / 生产面静态锁），全量回归 **108/108**（`account-manager.test.js` + 策略锁 + toutiao/wechat/zhihu 三个同族崩溃用例 + `playwright-manager.test.js`，6 文件 rc=0） |
| 变异反证 | ✅ | ① 把注入缝判定短路（`if (!(domLoginCheckAllowed instanceof Set ? … ).has(platform))` → `if (false)`）后**反向控制 + 结构锁同时变红**（`Tests 2 failed | 2 passed`），还原复验 `已还原 = True`；② **绕过探针**：按外部复核给出的具体绕过写法新建 `apps/desktop/electron/services/__probe-bypass.js`（内容 `const k = 'domLoginCheck' + 'Allowed'`）后，生产面静态锁**当场变红**（`1 failed | 3 passed`），探针随后按 R0 走 `node scripts/safe-delete.js`（`backend=mavis-trash`）可恢复删除 |
| 参考产品实证（本地逆向） | ✅ | **参考产品A（Electron v4.14.20，`app.asar` 9.5MB）**：`no-sandbox`/`swiftshader`/GPU 开关命中数**均为 0**；`loginStatus`/`isLogin`/`loginState` 标识符**全 0**；登录走**可见** `BrowserView`/`WebContentsView` + Cookie 提取，判定与发布走 **HTTP API**（axios/fetch 命中 472）；`render-process-gone` 仅 2 处且都挂普通 UI 窗口，处理是 `browserWindow.reload()`（**可恢复**，不升级为应用级）⇒ 它**不存在**"隐藏窗口抓 DOM 判登录"这条路。**参考产品B**：CEF 壳（`CefBrowser.dll`/`cefplug`，266 个 JS 按平台分文件），账号/发布逻辑在 JS 侧，本轮未深入。（按 AGENTS.md 品牌口径，仓库内不写竞品实名，实名与本地路径见会话记忆） |
| QM-1 打包 | ✅ | `vite build`（renderer 前置，rc=0，`dist/index.html`=True）+ `electron-builder --win --x64` **rc=0**；asar 清单 **15020** 条且含 `electron/services/playwright-manager.js`（`dev-launcher.js` 不在 asar 属预期）；启动验证按三层判据 + **存活断言**：`alive=true`、**stderr 字节=0** ⇒ **PASS**；子进程 env 经 `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE`，`envDefectNotice()` 如实出声告警（父环境带该变量=1） |
| QM-2 代码必检项 | ✅ | 未改 preload / IPC 签名 / require 路径；无新增同步 CPU 密集原语；未新增全局组件或顶层 CSS；改动仅影响登录态判定的降级分支与新增常量/导出 |
| QM-4 视觉 | N/A | 不涉及渲染端 UI、样式或布局；受影响的是**既有**第三态 `unverified`（「未确认」徽章，§17.4 已定义），本次不新增控件、不新增文案 |
| QM-6 CCG 双模型评审 | ⚠️→✅ | pre-commit 判定 `mode=dual`（命中 auth/加密语义），记录 `.ccg/reviews/450b91ac….json`；`scripts/deep-review.sh`（Git for Windows Bash，依赖体检通过：proposer=opencode / critic=claude 跨家族）跑出 **5 条问题、4 个维度、最低分 6**，收敛为自扮演裁决（`.adversarial/ccg-deep-0989bfc3/adjudication.json`，3 条待裁，其中 i1/i3 属 **auth 高危域必须外部复核**）。**关键过程**：我最初把 i1/i2/i3 全判 `dismissed`；**跨家族外部复核推翻其中两条——i1/i3 均 upheld**，并指出残余风险「生产代码误读 `_internals` 无防御」。**整改**（不是改文字）：① `Object.freeze` 两个集合（`add()` 失效）；② 删除 `_internals` 导出；③ 注入改**函数显式参数** `options.domLoginCheckAllowed`（不传即默认空集）；④ 补**正向控制**锁（注入后才开窗）+ **生产面静态锁**（除 `account-manager.js` 外，出现 `._internals`/`domLoginCheck`/`DOM_LOGIN_CHECK_ALLOWED` 片段即红，能拦住"动态拼接属性名"这一具体绕过）。第二轮外部复核：**i1 resolved、i3 resolved**；残余风险仍判 `not_resolved` 并给出边界（把属性名切成互不相邻片段再拼不可机械拦截）——如实登记，不假装闭合 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 品牌残留 | ✅ | `check-no-brand-residue.js` **PASS**（9515 个 tracked 文件）。本轮一度红：新写的注释/文档/CHANGELOG 直接写了竞品实名 ⇒ 已统一改为「参考产品A/B」口径；并回退了对 `PRD.md` 既有历史行的误改（保持 diff 最小） |
| 文档门禁 | ✅ | `check-doc-abs-paths.js` PASS（3464 受管文件，无新增本机绝对路径）；新增文档全部用相对路径引用 |
| 接线棘轮 | ✅ | `check-unwired-tests.js` OK（90 个测试文件）——新测试落在已登记的 `electron/publishers/**` 通配内，无需新增接线 |
| 已知边界（不假装闭合） | ✅ | ① 本变更**不修 Chromium 缺陷**，也不声称消除该类崩溃：它把会崩的那条支路**默认关掉**；允许集一旦被追加平台，风险立即回归 ⇒ 准入须附真机复测证据。② 代价是「未确认」账号会变多（不计入失效、不触发失效横幅、无「去登录」按钮）；正解是给平台补 HTTP 侧能力（`HTTP_CHECK_APIS[p].checkHtml`），而不是重开隐藏窗口。③ 更彻底的解法（把 DOM 判定搬进独立进程、崩溃不回传主进程，参照参考产品A 的 `reload()` 可恢复思路）列为后续工作。④ 崩溃根因未做 minidump 级归因（现场无 minidump）。⑤ 参考产品B 的账号实现未深入。⑥ **静态锁的机械边界**：生产面扫描覆盖含片段的字面量（含 `'domLoginCheck' + 'Allowed'` 这类拼接），但"把属性名切成互不相邻片段再拼"（如 `['dom','Login'].join(')`）无法机械拦截——这类代码同时绕过本仓所有命名约定，属通用限制；本轮以"探针即红"证明已覆盖外部复核点名的具体路径 |
| 远程同步 | PASS | 已合并：merge SHA `1cda0ba19df052e3c425de87e686e66793df78cf`（squash，2026-10-16T19:37:52Z）；远端分支已删（`git ls-remote --heads origin fix-login-check-http-only` 返回 0 行）；`git log origin/main --grep='(#3759)$'` 恰 1 行；该 merge SHA 的 main push `quality-gate` 回读 **completed/success**（run 38956333350，10/10 job 全绿，含 `QG Changes`）|

## 关联

- 另一半修复（启动参数互斥 + kuaishou 止血 + 隐藏窗口可观测）：PR #3739 / 记录 `openspec/records/fix-hidden-window-render-crash.md`
- 需求侧：`01-docs/PRD.md`「三种认证模式」、`01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §18
- 详细文档：`01-docs/BUGFIX-LOGIN-CHECK-HTTP-ONLY-2026-10-16.md`

## 合并后回读（2026-10-17）

| 项 | 读数 |
|------|------|
| #3759 merge SHA `1cda0ba19` 的 main push `quality-gate` | **completed/success**（run `38956333350`，10/10 job 全绿，含 `QG Changes`；`QG Coverage` 亦 success） |
| #3760（#3739 回填）merge SHA `ae46def6e` | `NO_RUN(by design)` —— docs-only 的 push 被 paths-ignore 按设计跳过；该 SHA 上仅 `CI Failure Handler`（skipped） |
| #3768（#3759 回填）merge SHA `c6bf5a8e1` | `NO_RUN(by design)`；其上 `债务熔断门禁` = **success** |
| worktree 清理 | `safe-worktree-remove.ps1` → `worktree gone: True`、R7 PASS（主干脏项/stash 与基线一致） |
| 本地分支退役 | `retire/fix-login-check-http-only-20261017`、`retire/backfill-3759-sync-20261017` 留可恢复出口；逐字节核对 13/13 与 2/2 |