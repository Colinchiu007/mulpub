---
record: fix-hidden-window-render-crash
task: 隐藏窗口登录检测触发原生渲染崩溃（应用启动后窗口消失）——成因侧拆掉「--no-sandbox + swiftshader」组合，并把实测触发点 kuaishou 纳入白名单止血
date: 2026-10-16
# ↓ 三字段只在「远程同步」无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（fix-hidden-window-render-crash）尚未合并，merge SHA 尚不存在，无法取证收口
sync_backfill_owner: 下一个会话（同一次提交内改表格行 + 删这三个字段）
---

## 本次执行记录：隐藏窗口原生渲染崩溃（fix-hidden-window-render-crash，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR | 改 `apps/desktop/scripts/dev-launcher.js`（+test）、`apps/desktop/electron/services/playwright-manager.js`（+test）、`apps/desktop/electron/publishers/account-manager.js`（+新 test `account-manager-kuaishou-render-crash.test.js`）与同目录 `account-manager.test.js`、`apps/desktop/test-setup.js` ⇒ docs-only=false。隔离 worktree `mp-hidden-window-crash` + 裸分支 `fix-hidden-window-render-crash`；共享根保持 main |
| 第一性原因（QM-5 ①） | ✅ | **用户报「应用看不到」**。① 崩溃与启动方式无关：前台与 WMI 脱离两条路径都崩；我用「job 内保持存活 180 秒」的判定性实验证伪了「job teardown 杀进程」这一假设——应用在 job 仍活着时自行消失。② 现场证据链：app 日志**停在** `AccountManager checkLoginStatus: start kuaishou:a4505f45 url=https://cp.kuaishou.com/`，之后**无任何日志行**；紧接着 `crashpad_client_win.cc:867 not connected`（原生崩溃、无 minidump）；dev.js 审计 `electron-exit code=4294930435`（`0xC0000135`）；全部 electron 进程消失、窗口空白。③ 机制：`account-manager.checkLoginStatus` → `playwrightManager.getContext({show:false})` → `playwright-manager.createPage` 里 `new BrowserWindow({show:false, webPreferences:{sandbox:true}})` —— 一个**永不显示却仍建合成表面**的窗口加载平台页面。④ 成因：`dev-launcher.buildElectronArgs` 默认 `noSandbox=true` 且 `softwareGpu=true`，**同时**下发 `--no-sandbox` 与 swiftshader 三件套，而该文件 2026-10-06 的注释早已记着「该组合会让登录检测拉起的隐藏 BrowserWindow 触发原生渲染崩溃」⇒ **默认配置就是崩溃配置**，同一崩溃按平台逐个复发：2026-09-16 toutiao → 2026-10-06 wechat_mp → 2026-10-14 知乎（#3726 白名单第四例）→ 2026-10-16 kuaishou |
| ⚠️ 我在本轮的错判与纠正（如实） | ✅ | 两处过早收口均被后续证据推翻，记录在案以免重蹈：① 「单层 WMI 就解决了启动问题」——其实那次死亡是 app 自身崩溃所致，与 WMI 层数无关；② 「修复已生效」——我以「240 秒全程稳定」为据，但 240 秒**覆盖不到 30 分钟后的第二轮检测**；补测后同一实例在 22:20:58 第二轮 kuaishou 检测处**仍然崩溃**。教训：**观测窗口必须覆盖被测周期**，否则「通过」只是窗口太短的产物 |
| 逃逸分析（QM-5 ②） | ✅ | **逃逸链**：单测层——`dev-launcher.test.js:37-44` 的用例标题是「**默认带 --no-sandbox（保持既有 dev 行为）**」，把崩溃组合当契约锁死，改实现当场变红，而它从不检查组合本身；集成层——崩溃发生在真实账号检测，CI 无账号、无隐藏窗口，等价于永不覆盖；观测层——崩溃不留 minidump、crashpad 连不上、**日志戛然而止**，没有「谁崩的」证据，只能人肉对比；对策层——既有对策是往 `RENDER_CRASH_PRONE_OPEN_PLATFORMS` 逐平台加白名单（第四例 #3726），**属打地鼠**。系统性漏洞：**把「成因」写成注释、把「症状」做成白名单，而默认值仍留在成因那一侧** |
| 系统性漏洞定位（QM-5 ③） | ✅ | 分类：**测试场景缺失**——CI 无真实账号、无隐藏窗口，该路径等价于永不覆盖；**审查盲区**——「成因」只写在 dev-launcher.js 注释里，「症状」却做成逐平台白名单，而**默认值仍留在成因那一侧**，于是同一崩溃每换一个平台就复发一次（四例：toutiao/wechat_mp/知乎/kuaishou）；**测试质量不足**——既有契约锁把「默认带 --no-sandbox」写成了期望（dev-launcher.test.js:37-44），锁住了错误行为本身 |
| 修复 + 回归保护（QM-5 ④）——修复 A：成因侧（消除组合） | ✅ | `buildElectronArgs` 让二者互斥——`softwareGpu` 为真时**不再下发** `--no-sandbox`（`else if (noSandbox)`）。保留 swiftshader（它决定「无 GPU 的机器窗口画不画得出来」），去掉 `--no-sandbox`（也更贴合隐藏窗口自身的 `webPreferences.sandbox=true`）。显式换取路径仍在：`MP_E2E_SOFTWARE_GPU=0` 时 `--no-sandbox` 照旧下发（该组合不崩） |
| 修复 B：止血（切断崩溃路径） | ✅ | 现场证明 A 单独**不足**（第一轮通过、第二轮仍崩）⇒ 把实测唯一触发点 **kuaishou 纳入 `RENDER_CRASH_PRONE_OPEN_PLATFORMS`**（同族第五例）：HTTP 判定不确定时判 `INCONCLUSIVE`，**绝不开隐藏窗口**。同时**更正**该文件里已被推翻的旧结论——原文写「同配置窗口加载 kuaishou/douyin 均成功返回 CHECK_LOGIN_SUCCESS，故为站点特定」，该结论对 kuaishou 已不成立，并写明 douyin 本轮未复测、不得再被当免检依据引用 |
| 修复 C：纵向加固（可观测） | ✅ | 隐藏窗口加 `paintWhenInitiallyHidden: show`（隐藏窗口不建可绘制表面；可见窗口保持默认，否则主界面画不出来），并接线 `render-process-gone`（记录 reason/exitCode + 让 `goto`/`waitForSelector`/`waitForFunction` fail-fast）。**如实**：单靠 C 未拦住崩溃（活体验证当场证伪），它买的是「下次同类崩溃可归因、且不再把崩溃伪装成登录态不确定」 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 崩溃组合由**全组合性质锁**守（不是逐平台白名单）；② `dev-launcher.js` 注释改记**因果与复发链**并指向契约锁名；③ `test-setup.js` 的 `webContents.on` 从空函数改为**记录 handler**（旧实现对「事件是否被接线」完全不可见，本次排查正卡在这里）；④ 新平台触发时按 kuaishou 这一例的流程处置（现场取证 → 白名单止血 → 记录边界） |
| TDD | ✅ | 全部先 RED 后 GREEN：`dev-launcher.test.js` 13/14 → **14/14**；`playwright-manager.test.js` 4/6 → **6/6**；`account-manager-kuaishou-render-crash.test.js` 6/6 红 → 收敛为 1 条不变量后 GREEN（首轮拷贝自 zhihu 用例时带进了 5 条 `checkHtml` 能力锁，那属 zhihu 那例的第二半，需真机页面形态证据，本轮不做故收敛，边界已写明）；同族四例 + playwright 共 **18/18**；`account-manager.test.js` **89/89** |
| 契约迁移（既有用例改写，需评审注意） | ✅ | `account-manager.test.js`「selector 超时但 URL 在仪表盘域名下仍判为有效」原用 kuaishou 走隐藏窗口，kuaishou 入白名单后该用例在其上已不可能成立。改挂到**不在白名单且同样有仪表盘域名**的 `weibo`，并把 HTTP 判定钉成 `null` 以免随实现漂移；语义与覆盖点不变（HTTP 不确定 → 降级隐藏窗口 → selector 超时但 URL 命中仪表盘域名 ⇒ 判有效）。改写理由写在用例上方注释里 |
| 活体 A/B（决定性，含反例） | ✅ | **修复前**：默认参数（sandbox 关 + swiftshader 开）前台 ~100-130s 崩、脱离 ~50s 崩；仅关 swiftshader ⇒ **无窗口**且仍崩 ~50s；`MP_E2E_NO_SANDBOX=0`（sandbox 开）前台稳定 150s。**修复 A+C 后（默认参数、WMI 脱离、真实账号检测）**：**第一轮** kuaishou 跑通（`valid=true code=CHECK_LOGIN_SUCCESS`）并继续检测 bilibili；**但 30 分钟后第二轮同一条检测处再次崩溃** ⇒ 据此补做修复 B。三段合起来才是完整证据，缺最后一段就会把「未修好」记成「修好了」 |
| QM-1 打包 | ✅ | 改动 `apps/desktop/electron/` 后**重跑**：`vite build`（renderer 前置，rc=0）+ `electron-builder --win --x64` **rc=0**；asar 清单 **15019** 条且含 `electron/services/playwright-manager.js`（`dev-launcher.js` 不在 asar 属预期——dev 专用脚本，打包产物不走 dev.js）；启动验证按三层判据 + **存活断言**：`alive=true`、**stderr 字节=0** ⇒ **PASS**；`buildChildEnv()` 已剔除 `ELECTRON_RUN_AS_NODE`，`envDefectNotice()` 如实出声告警（父环境带该变量=1）。首次打包未先构建 renderer 时 stderr 出现 `ERR_FILE_NOT_FOUND .../dist/index.html`（NEEDS_REVIEW），补齐前置后为空——属打包前置缺失、非本次改动引入 |
| QM-2 代码必检项 | ✅ | 未改 preload / IPC 签名 / require 路径；无新增同步 CPU 密集原语；未新增全局组件或顶层 CSS；改动限于 dev 启动参数、隐藏窗口生命周期与登录检测的降级分支 |
| QM-4 视觉 | N/A | 不涉及渲染端 UI、样式或布局；隐藏窗口本就 `show:false`，可见窗口绘制行为未变（`paintWhenInitiallyHidden` 对其为默认值） |
| QM-6 CCG 双模型评审 | 见 `.ccg/reviews/` | 判定随提交生成 |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 相等 |
| 接线棘轮 | ✅ | `check-unwired-tests.js` OK；新测试落在已登记的 `electron/publishers/**` 通配内，无需新增接线 |
| 已知边界（不假装闭合） | ✅ | ① 修复 A 消除的是**该组合**；若将来有人显式同时要求 sandbox 关 + 软件光栅化，崩溃组合会被重新打开——故由全组合性质锁守，而非靠注释。② **崩溃根因在 Chromium 原生层，本 PR 是规避成因 + 切断触发路径，不是修复 Chromium 缺陷**；未做 minidump 级归因（现场无 minidump）。③ kuaishou 本轮**不补 `checkHtml`**：没有 cp.kuaishou.com 真机登录页/已登录页形态证据就不许凭空写判据，因此其登录态在 HTTP 判定不足时会显示「未确认」；要恢复确定性结论须先取证。④ 白名单机制仍在且会继续沿用（纵深防御），名单外平台在**其它**成因下仍可能崩——届时 `render-process-gone` 会留下 reason/exitCode，不再只剩「日志戛然而止」。⑤ **真修（把隐藏窗口检测隔离到独立进程，使浏览器进程崩溃不再拖死主进程）本轮未做**，属后续工作；本 PR 不声称已消除该类崩溃。⑥ 活体 A/B 为单机观测，样本有限 |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后由回填会话同一次提交改写 PASS + merge SHA 并删除上方 sync_* 三字段 |