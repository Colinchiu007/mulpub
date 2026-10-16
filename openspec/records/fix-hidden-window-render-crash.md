---
record: fix-hidden-window-render-crash
task: 隐藏窗口登录检测触发原生渲染崩溃（应用启动 30-130 秒后窗口消失）——从成因侧让「--no-sandbox + swiftshader」崩溃组合不可达
date: 2026-10-16
# ↓ 三字段只在「远程同步」无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（fix-hidden-window-render-crash）尚未合并，merge SHA 尚不存在，无法取证收口
sync_backfill_owner: 下一个会话（同一次提交内改表格行 + 删这三个字段）
---

## 本次执行记录：隐藏窗口原生渲染崩溃——从成因侧拆掉崩溃组合（fix-hidden-window-render-crash，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR | 改 `apps/desktop/scripts/dev-launcher.js`（+test）、`apps/desktop/electron/services/playwright-manager.js`（+test）、`apps/desktop/test-setup.js` ⇒ docs-only=false。隔离 worktree `mp-hidden-window-crash` + 裸分支 `fix-hidden-window-render-crash`；共享根保持 main |
| 第一性原因（QM-5 ①） | ✅ | **用户报「应用看不到」**。定位过程：三次启动的应用都在 30-130 秒内自行消失（**前台与脱离两条路都崩**，故与启动方式无关——先前的「脱离会话被杀」是另一件事）。现场证据链：① app 日志**停在** `AccountManager checkLoginStatus: start kuaishou:a4505f45 url=https://cp.kuaishou.com/`，之后**无任何日志行**；② 紧接着 `crashpad_client_win.cc:867 not connected`（原生崩溃、无 minidump）；③ dev.js 审计日志 `electron-exit code=4294930435`（`0xC0000135`）；④ 全部 electron 进程消失、窗口空白。**机制**：`account-manager.checkLoginStatus` 走 `playwrightManager.getContext({ show:false })`，后者在 `playwright-manager.createPage` 里 `new BrowserWindow({ show:false, webPreferences:{ sandbox:true, ... } })` —— 一个**永不显示却仍建合成表面**的窗口加载平台页面。**成因**：`dev-launcher.buildElectronArgs` 默认 `noSandbox=true` 且 `softwareGpu=true`，**同时**下发 `--no-sandbox` 与 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` —— 而 `apps/desktop/scripts/dev-launcher.js:23-25` 早就记着「2026-10-06：--no-sandbox 与 swiftshader 组合下，登录检测拉起的隐藏 BrowserWindow 会触发原生渲染崩溃」，**默认值恰好就是那个组合**。于是同一崩溃按平台逐个复发：2026-09-16 toutiao → 2026-10-06 wechat_mp → 2026-10-14 知乎（PR #3726，白名单第四例）→ 2026-10-16 kuaishou |
| 逃逸分析（QM-5 ②） | ✅ | **逃逸链**：单测层——`dev-launcher.test.js:37-44` 的用例标题是「**默认带 --no-sandbox（保持既有 dev 行为）**」，把崩溃组合当契约**锁死**了，改实现会当场变红，而它并不检查组合本身；集成层——崩溃发生在用户机器上的真实账号检测，CI 无账号无隐藏窗口，等价于永不覆盖；观测层——崩溃不留 minidump、crashpad 也连不上，**日志戛然而止**，没有「谁崩的」这类证据，只能靠人肉对比；对策层——既有对策是往 `RENDER_CRASH_PRONE_OPEN_PLATFORMS` 白名单加平台（第四例 #3726），**属打地鼠**：名单外平台一开隐藏窗就再崩一次。系统性漏洞：**把「成因」写成注释、把「症状」做成白名单，默认值却仍留在成因那一侧** |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① **成因侧（决定性）**：`buildElectronArgs` 让二者互斥 —— `softwareGpu` 为真时**不再下发** `--no-sandbox`（`else if (noSandbox)`）。保留 swiftshader（它决定「无 GPU 的机器窗口画不画得出来」），去掉 `--no-sandbox`（也更贴合隐藏窗口自身的 `webPreferences.sandbox=true`）。显式换取路径仍在：`MP_E2E_SOFTWARE_GPU=0` 关掉软件光栅化后 `--no-sandbox` 照旧下发（该组合不崩）。② **纵向加固**：隐藏窗口加 `paintWhenInitiallyHidden: show`（隐藏窗口不建可绘制表面；可见窗口保持默认，否则主界面画不出来），并接线 `render-process-gone`（记录 reason/exitCode + 让 `goto`/`waitForSelector`/`waitForFunction` fail-fast）——**如实说明：单靠 ② 未拦住崩溃（已活体验证，见下）**，它买的是"下次再有同类崩溃时现场可归因、调用方不再把崩溃伪装成登录态不确定"。白名单**保持原样**（纵深防御，不因本修法而放宽）。**回归保护**：`dev-launcher.test.js` 新增**全组合性质锁**——对 `(noSandbox, softwareGpu)` 四种取值断言"崩溃组合不可达"，并保留显式换取路径断言；`playwright-manager.test.js` 新增两条（隐藏上下文 `paintWhenInitiallyHidden===false` 且可见上下文不为 false；`render-process-gone` 必须被接线且后续等待 fail-fast） |
| 我在本轮犯并修掉的错（如实） | ✅ | 「真修」的第一版只改了 ②（`paintWhenInitiallyHidden`）。**单元测试全绿，但活体验证当场证伪**：默认参数启动后日志仍停在 `start kuaishou`、进程再次消失。若只看单测就会把"没修好"提交成"修好了"——单测能锁住代码形状，锁不住"崩溃是否还发生"。因此本记录的判据一律以活体 A/B 为准 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 崩溃组合由**性质锁**守（不是逐平台白名单），新平台无需再登记；② `dev-launcher.js` 注释改成记载**因果与复发链**，并指向契约锁名；③ `test-setup.js` 的 `webContents.on` 从空函数改为**记录 handler**（旧实现对"事件是否被接线"完全不可见，本次排查正卡在这里），使接线类回归可断言；④ 已知边界写下"白名单是打地鼠"的判断依据 |
| TDD | ✅ | 两处都先 RED 后 GREEN：`dev-launcher.test.js` 13/14（新锁红）→ **14/14**；`playwright-manager.test.js` 4/6（两条新用例红：`expected undefined to be false`、`expected 'undefined' to be 'function'`）→ **6/6**。相邻面回归：`account-manager` + toutiao/wechat/zhihu 三个崩溃白名单套件 **100/100** |
| 活体 A/B（决定性，非单测） | ✅ | **崩溃前**：默认参数（sandbox 关 + swiftshader 开）前台 ~100-130s 崩、脱离 ~50s 崩；仅关 swiftshader ⇒ **无窗口**且仍崩 ~50s；`MP_E2E_NO_SANDBOX=0`（sandbox 开）前台 **稳定 150s**。**修复后（默认参数、WMI 脱离、真实账号检测）**：kuaishou 检测**跑通**——日志 `start kuaishou:a4505f45` → `refreshProfileFromPage 已回填资料字段` → `LoginMonitor result kuaishou:a4505f45 valid=true -> active code=CHECK_LOGIN_SUCCESS` → 继续检测 bilibili（`API check → valid`）；**240 秒全程 electron=6 / window=1**，无 crashpad 行 |
| QM-1 打包 | ✅ | `vite build`（renderer 前置，rc=0，dist/index.html=True）+ `electron-builder --win --x64` **rc=0**。asar 清单 **15019** 条且含 `electron/services/playwright-manager.js`（修复确在产物里）；`dev-launcher.js` 不在 asar 属预期（dev 专用脚本，打包产物不走 dev.js）。启动验证按 QM-1 三层判据 + **存活断言**：`alive=true`、**stderr 字节=0** ⇒ **PASS**；`buildChildEnv()` 已剔除 `ELECTRON_RUN_AS_NODE`，且 `envDefectNotice()` 如实出声告警（父环境带该变量=1）——**首次打包未先构建 renderer，stderr 出现 `ERR_FILE_NOT_FOUND .../dist/index.html`（NEEDS_REVIEW）**，补齐前置后复验为空，该现象属打包前置缺失、非本次改动引入 |
| QM-2 代码必检项 | ✅ | 未改 preload / IPC 签名 / require 路径；无新增同步 CPU 密集原语；未新增全局组件或顶层 CSS；改动仅影响 dev 启动参数与隐藏窗口生命周期 |
| QM-4 视觉 | N/A | 不涉及渲染端 UI、样式或布局；隐藏窗口本就 `show:false`（可见窗口的绘制行为未改，`paintWhenInitiallyHidden` 对其为默认值） |
| QM-6 CCG 双模型评审 | 见 `.ccg/reviews/` | 判定随提交生成（本片为启动参数 + 隐藏窗口加固） |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 相等 |
| 接线棘轮 | ✅ | `check-unwired-tests.js` OK（改动落在既有已接线测试文件内） |
| 已知边界 | ✅ | ① 本修法**消除的是该组合**；若将来有人显式同时要求 sandbox 关 + 软件光栅化（例如为其它 GPU 问题），崩溃组合会被重新打开——故用全组合性质锁守，而不是靠注释；② 白名单机制仍在（纵深防御），未纳入名单的平台在**其它**成因下仍可能崩，届时 `render-process-gone` 会留下 reason/exitCode，不再只剩"日志戛然而止"；③ 崩溃根因在 Chromium 原生层，本 PR 是**规避成因**而非修复 Chromium 缺陷，未做 minidump 级归因（现场无 minidump）；④ 活体 A/B 是单机单次观测，240 秒窗口内未复现；`paintWhenInitiallyHidden` 单独不足已由活体验证记录在案 |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后由回填会话同一次提交改写 PASS + merge SHA 并删除上方 sync_* 三字段 |
