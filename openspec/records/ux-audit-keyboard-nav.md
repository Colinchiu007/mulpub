---
record: ux-audit-keyboard-nav
task: UX 审计阶段 1.5（快捷键与鼠标共用一段可见导航）—— 把「该跳到哪一面」的三段判断收敛为单一 composable，App.vue 的 app:navigate 与 MpSidebar.onNavClick 同时改为消费它，并配 28 条契约锁与 10 条变异反证
date: 2026-10-21
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src）+ 文档，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：快捷键与鼠标共用一段可见导航（ux-audit-keyboard-nav，2026-10-21）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 独立 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-keyboard-nav`（D 盘），分支 `ux-audit-keyboard-nav`（回读 `git rev-parse --abbrev-ref HEAD` = 该值），由 `scripts/start-mp-task.ps1 -TaskName ux-audit-keyboard-nav` 创建 |
| 质量节拍 pre-flight | ✅ | 编辑前确认当前分支非共享根 `main`；共享根未被写入（本轮所有落盘都在 worktree 内） |
| TDD 顺序 | ✅ | 先写 `App.visible-navigation.test.js`，实现前实测 **6 failed \| 3 passed**（三条红点名「先切回首页标签，再跳目标路由」「定向让它自己跳，主窗口隐藏路由不动」「键盘入口必须调用共享实现」），再改实现转绿 |
| 自测（新增面） | ✅ | `vitest run src/composables/useVisibleNavigation.test.js src/App.visible-navigation.test.js src/layouts/MpSidebar.sidebar-focus-nav.test.js` → **Tests 34 passed**（19 + 9 + 4）、无 `Errors` 行、rc=0 |
| 自测（消费者并集） | ✅ | 改造前先 `git grep -l "navigateActiveHomeShell\|onNavClick"` 取并集 ⇒ `MpSidebar.sidebar-focus-nav.test.js` / `App.sidebar-collapse` / `App.dispatch-failed` / `shell-mode-6b` / `overlay-view-suspension` / `publish-tab-state-keepalive` 全部纳入验证域 |
| 自测（全域） | ✅ | `vitest run src`（dot reporter）→ **Test Files 405：2 failed \| 403 passed；Tests 6421：2 failed \| 6417 passed \| 2 skipped**。两条红见「二、两条红的归因」 |
| 反证（10 条） | ✅ | `node scripts/visible-navigation-contract-mutate.js` → `[BASELINE] rc=0 failed=0 errors=0 blind=false`、`[SUMMARY] 共 10 条：CAUGHT=10 其余=0`，rc=0。还原后逐文件 `git diff --numstat` 与变异前**逐字相等**（App.vue 7/3、MpSidebar.vue 6/24）——不采信驱动自报 |
| 静态门禁 | ✅ | `check-locale-sync.js --cjk` → **PASS（基线 1330 条，当前 1124 条，无新增硬编码）**：本批无任何新用户可见文案 ⇒ 不改 locales（Gate 7 无触发面）；`check-no-brand-residue` → **PASS（扫描 11514 个 tracked 文件）**；`check-doc-abs-paths.js --base=origin/main` → **PASS（counts=1161 domain=562 files=561 canJudge=true）**；聚合 `eslint electron/ src/ --quiet` → **rc=0** |
| 行尾对账 | ✅ | 五个改动文件 `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **逐文件相等**（App.vue 7/3、MpSidebar.vue 6/24、sidebar-focus-nav 10/1、审计文档 61/1、.gitignore 4/0） |
| QM-1 打包 | N/A | 只改 `apps/desktop/src/**`（渲染端）与 `scripts/`，未触碰 `apps/desktop/electron/**` 与 `packages/rpa-engine/**` ⇒ 打包判据不触发；`.gitignore` 反选与新增驱动均非运行时依赖 |
| QM-4 视觉回归 | N/A（如实登记） | 本批零视觉变更：不新增节点/样式/locale，不改盒模型与颜色；判定域不含本批改动面（`check-visual-coverage` 的域是注册表 × 两档主题，本批未动注册表）。像素门禁由 `QG Visual` 在 CI 上以 CI 渲染为准执行 |
| QM-6 双模型 | 见「五、QM-6」 | 本机 CCG 判定链已跑（`ccg-review-decider` 由 pre-commit 落产物）；外部模型评审结果与处置如实登记，不伪造 `cleared` |
| 第一性原因（QM-5 ①） | ✅ | 不是「App.vue 漏了一个 if」，而是**同一段判断被抄了两遍**：三段式只存在于 `MpSidebar.onNavClick`，`app:navigate` 回调只做裸 `router.push`。取证：改造前 `git grep -n "navigateActiveHomeShell" -- apps/desktop/src` 只命中 `MpSidebar.vue` 一个文件 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：既有 `MpSidebar.sidebar-focus-nav.test.js` 4 条**只测鼠标侧**，壳层没有任何一条断言「快捷键也走这段判断」；集成层：`App.dispatch-failed` / `App.sidebar-collapse` 挂载 App 但不断言导航；视觉层：结构上失明（覆盖层背后的路由变化不改一个像素）；审查层：audit-1.5 是人工读模板发现的。四类原因同时命中：无测试 / 断言不精确（只测一条入口）/ 环境差异（`WebContentsView` 是原生图层）/ 审查盲区 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 单一实现 `src/composables/useVisibleNavigation.js`（A 定向 / B 切回首页标签 / C 推主窗口路由 + 三条降级纪律）；回归保护 = `useVisibleNavigation.test.js`（19 条，含装配锁与全仓调用点集合断言）+ `App.visible-navigation.test.js`（9 条，真 tab store + 假桥 + 顺序账本 + 3 条「两处入口同源」结构锁） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 结构锁禁止任一处再出现 `navigateActiveHomeShell` / `switchToTab(home…)` 形态（扫描域排除注释行）；② **全仓调用点集合断言** —— 新增入口未登记即红，防「下一个入口重演」；③ 反证驱动把「调用点漏传注入参数」单列一条（M3），因为该类失败在类型层与编译期都不出声；④ 方法论写入 PRD §4：在 setup 期绑定 `getApi` 会让 mock 桥接层的 3 个文件 26 条用例整片变红 —— 依赖注入的**求值时机**也是契约 |

## 一、这次到底改了什么（用户可见口径）

| 用户此刻聚焦在 | 改造前按快捷键 | 改造后按快捷键 |
|---|---|---|
| 首页标签 | 可见跳转 | 不变（不多发一次切标签 IPC） |
| 普通网页标签 | 主窗口路由在覆盖层背后变了，**屏幕无反应** | 先切回首页标签，再显示目标页 |
| 内嵌主页实例（home-shell） | 该实例没动，且主窗口多出一条看不见的路由（从此漂移） | 定向让该实例自己跳，主窗口隐藏路由不动 |

无新增文案、无新增可聚焦元素、无样式变化 ⇒ 不刷视觉基线、不改 locales。
诊断痕迹沿用改造前同款 `console.warn` 前缀（`[sidebar] navigate home-shell failed` /
`[sidebar] switch home failed` / `[sidebar] navigate failed`），历史日志检索不断链。

## 二、两条红的归因（不认领、也不放行）

`overlay-view-suspension.test.js > preload index.bundle.js 已重打包` 与
`shell-mode-6b.test.js > preload index.bundle.js 已重打包`：两者读的是
`apps/desktop/electron/preload/index.bundle.js`，该文件**不是 git 受管文件**
（`git ls-files --error-unmatch` → "did not match any file(s) known to git"），
由构建步骤生成。本 worktree 是新建的、没跑过打包步骤 ⇒ 文件不存在即红。
本批 diff 不含 `electron/preload/**` 任何文件，且这两条断言的输入只有一个构建产物路径，
因此归因为「fresh worktree 缺构建产物」这一既有类（同 [[project-mulpub-known-test-failures]]），
非本 PR 引入；CI 侧由 `electron-ci` 的打包步骤先产出该 bundle 再跑桌面全量。

## 三、两条关于「反证自身」的实测更正（不写下来就会被重抄）

1. **M6 第一版零条红。** 它摘的是 `if (tabStore.isHomeTab) return`，而紧随其后的
   `activeTabId === homeTab.tabId` 比较把同一种状态又挡了一遍 —— 前者是冗余防御，
   **有牙的是 id 比较**。把变异打在后者上才打通。教训：写变异前先问「这一格真的决定行为吗」。
2. **M7 第一版是 `PROBE_BLIND`。** 多行片段替换留下了悬空的 `} catch {}`，vitest 在解析期失败，
   汇总行整体缺失 ⇒ 既不能判 CAUGHT 也不能判 MISSED。改为**整函数体替换**保证可编译。
   由此驱动新增两档：`RUN_UNCLEAN`（零具名红但 `Errors>0`）与基线不干净一律拒跑（rc=2）。

## 四、依赖注入的求值时机（本轮实测踩出）

组合式不 import `@/api/electron-bridge`；调用点写 `apiGetter: () => getApi()`。
两种"更省事"的写法都被实测否证：

- 在组合式里 `import { getApi }` ⇒ 每个 mock 桥接层的夹具被迫补出该具名导出；
- 在 setup 期绑定函数本身（`apiGetter: getApi`）⇒ **同样是访问**，实测把
  `MpSidebar.more-keyboard` / `.appmenu` / `.more-active` 三个文件共 26 条无关用例整片打红
  （`No "getApi" export is defined on the "@/api/electron-bridge" mock`）。

代价是"调用点漏传"不会编译失败 ⇒ 用装配锁补（M3 变异 + 逐调用点参数面断言 + 全仓调用点集合断言）。

## 五、QM-6

`scripts/ccg-review-decider.js --base origin/main` 的判定与 pre-commit 产物
`.ccg/reviews/<sha>.json` 一并入库；评审发现与处置见下（本段由评审回来后就地补写，
未跑成功时如实登记为未闭合，不伪造 `cleared`）。

- 状态：待补（本轮尚未取得外部模型的评审产物）。

## 六、遗留

1. 反证驱动仍未接进 CI（与 `publish-staleness` / `offline-live` 等同批 `contract-mutate` 一起欠账，任务 #23）：
   落点必须避开 30 分钟预算墙，本批不擅自决定。
2. 仍在裸 `router.push` 的其它入口（`TabBar` 新建标签、`ProfileMenu` 里的跳转等）未收敛。
   调用点集合锁只在有人新增 `useVisibleNavigation(` 而未登记时红，**不会**把旧入口拉进来；
   清点那条属阶段 3.2 / 5.x 的域。
3. 「覆盖层背后跳转看不见」的最终观测需要真机或像素级证据；本批只有行为锁，未做真机验证。
