---
record: remove-native-menu-bar
task: 去掉主窗口顶部那行 Windows 系统菜单（File / Edit / View / Window），只保留本产品自己的导航
date: 2026-10-21
branch: remove-native-menu-bar
---

## 本次执行记录：去掉窗口顶部系统菜单（remove-native-menu-bar，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（主进程）+ 文档：独立 worktree `<仓库父目录>\mp-worktrees\<任务名>`（分支 `remove-native-menu-bar`），裸分支 `remove-native-menu-bar`，基线 `origin/main` = `c074b91b6`；`scripts/pre-code-edit-guard.ps1` rc=0 |
| 第一性原因（QM-5 ①） | PASS | Electron 默认给应用装一份「默认应用菜单」（File/Edit/View/Window），本仓从未替换过它——`Menu.setApplicationMenu` 全仓**零调用**（改动前实测 grep 只命中 `system-tray.js` 的 `Menu.buildFromTemplate` 与 `test-setup.js` 的 mock），于是每个窗口都自带这行菜单。**它是原生窗口框架的一部分，不是渲染层 DOM**，改 CSS 无效 |
| 逃逸分析（QM-5 ②） | PASS | 此前**无任何测试**覆盖应用菜单形态：`Menu.setApplicationMenu` 从未被调用过，因此没有可断言的对象；单测层面（`window.test.js` 只断言 width/height/show/preload）对此完全不可见 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增 `electron/services/native-menu.test.js` 15 例 + `window.test.js` 2 例 + `main.test.js` 2 例；**变异反证**：撤掉实现后 4 条新锁当场变红（window 2 + main 2） |
| 防止再次发生（QM-5 ⑤） | PASS | ① 回归锁进 vitest（`electron/services/**/*.test.js` 已被既有 glob 覆盖，**不新增 CI 接线需求**）；② 「真实依赖锁」直接读已安装 Electron 的 `electron.d.ts` 核对三个 API 签名；③ `native-menu.js` 作单一真源，平台策略与两级移除策略只此一份 |
| 行尾与 diff 对账 | PASS | `git diff --numstat origin/main...HEAD` 与 `--ignore-cr-at-eol` 两口径逐行相等（8 个文件，两口径完全一致） |
| 接线棘轮 | PASS | 新测试位于 `apps/`（`WORKSPACE_COVERED`），vitest `include` 里 `electron/services/**/*.test.{js,ts}` 已覆盖 → 自动收集。**未新增 `scripts/` 下测试文件**，故不涉及 `check-unwired-tests.js` 的显式点名要求 |
| QM-1 打包 / QM-4 视觉 | PASS / N/A | **QM-1 PASS**：`build:vue` exit 0 + `electron-builder --win --x64` exit 0，产出 `Multi-Publish.Setup.0.2.0.exe`；**QM-4 N/A**：未改渲染层任何像素（改动全在主进程窗口参数），且本改动**减少**一整行窗口高度，视觉基线（渲染层固定视口）不受影响 |
| QM-6 CCG 双模型外部评审 | 见 §5 | 变更 293 行 > 200 行阈值 ⇒ 判定 **DUAL**，后端 `claude` + `opencode`（`scripts/ccg-review-backends.list` 真源）；真跑 `sh scripts/deep-review.sh` 的结论见 §5 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

- 保留门禁：变更类型与隔离 ✅ | TDD ✅ | 行尾对账 ✅ | 接线棘轮 ✅ | QM-1 打包 ✅ | QM-2 ✅ | QM-6 ✅ | 文档同步 ✅ | 远程同步（收口由门禁按主干历史推导）

## 1. 用户诉求与实现口径

用户截图框出主窗口顶部 `[File] [Edit] [View] [Window]` 一行，要求「全部去掉，这样更美观一点」。

**实现口径（两级移除，单一真源 `apps/desktop/electron/services/native-menu.js`）**

| 级 | 动作 | 作用面 |
|---|---|---|
| 全局（根因级） | `Menu.setApplicationMenu(null)` | 移除默认菜单**模板** ⇒ 之后创建的窗口不再自带这行 |
| 窗口级（兜底） | 主窗 `autoHideMenuBar: true` + `win.setMenu(null)` | 把「这个窗口没有菜单栏」钉在窗口自己身上 ⇒ 将来有人再装菜单，主窗口也不长出这行，按 Alt 也唤不回 |

**为什么两级缺一不可**：只做全局 ⇒ 窗口若先于菜单设置创建，仍会带默认菜单；只做窗口 ⇒ 其它窗口（登录窗 / 授权窗）仍会带菜单。

**平台策略**：macOS 保留原生菜单（它的菜单在**屏幕顶部**且承载 Cmd+C / Cmd+V / Cmd+Q 等平台级快捷键，移除会破坏平台惯例）；本仓 electron-builder 只配 win（nsis），保留 darwin 分支是为了将来出 mac 包时不至于静默坏掉。

**明确不做**：① 不动托盘右键菜单（`system-tray.js` 是另一套，用户要的是窗口内那一行）；② 不动应用内导航菜单（`app-menu-config.js` 是运营中心下发的**侧边栏**配置，与原生菜单毫无关系，故本仓模块取名 `native-menu.js` 以免混淆）；③ 不改任何既有快捷键语义；④ 不做「换一套更简洁的自定义菜单」——诉求是**去掉**，不是替换。

## 2. 风险面核查（为什么去掉菜单栏不会破坏布局）

去掉菜单栏 ⇒ 窗口客户区高度增加约一行（Windows 100% DPI 约 20~24px）。本仓曾有一处坐标口径缺陷（2026-09-13「右侧没有滚动条 / 底部内容显示不全」），故逐项核查：

- 内嵌视图定位统一走 `view-bounds.js` 的 `getContentBounds()`（**客户区**坐标），**无任何硬编码的菜单栏偏移**；`BROWSER_CHROME_TOP=76` 是渲染进程 DOM 头高（TabBar+NavBar），与原生窗口边框无关。⇒ 客户区变大，视图自动铺满，**布局自动适配**。
- 生产代码里的 `+39px` / `+16px` 只出现在 `view-bounds.js` 的**注释与测试夹具**里（描述那次历史 Bug 的量级），不在任何计算路径上。
- 渲染层无任何与原生菜单栏/标题栏相关的偏移（`src/` 内 grep「菜单栏 / menuBar / titleBar / 标题栏」只命中一条关于窗口标题的注释）。
- 结论：**视觉回归（QM-4）对本改动 N/A**——改动全在主进程窗口参数，未触碰渲染层任何一个像素。

## 3. TDD 与变异反证

| 阶段 | 结果 |
|---|---|
| 先写锁（`native-menu.test.js` 15 例 + window 2 例 + main 2 例） | **RED**：19 例中 4 例失败（`autoHideMenuBar` 未设、`setMenu(null)` 未调、`setApplicationMenu(null)` 未调、时序断言取不到调用序） |
| 实现后 | **GREEN**：3 文件 **101 例全绿**；采纳 QM-6 的 i5 后再补 1 例日志断言 ⇒ **102 例全绿** |
| **变异反证** | 撤掉实现（删 `removeWindowMenuBar(mainWindow)` / `autoHideMenuBar: true` / `removeApplicationMenu({ Menu })`）后 **4 条新锁当场变红**（window 2 条 + main 2 条，逐条指名失败原因），**确认不是恒绿断言**；还原后复跑 101 例全绿 |

**「真实依赖锁」**：`native-menu.test.js` 直接读**已安装** Electron 的 `electron.d.ts`，断言三处签名真实存在——`static setApplicationMenu(menu: (Menu) | (null)): void;`、`setMenu(menu: (Menu) | (null)): void;`、`autoHideMenuBar?: boolean;`。前提一旦被上游改掉，这条先红，避免「按不存在的 API 写代码、单测靠 mock 全绿」。

## 4. 真机验证（打包产物 + 原生窗口截图）

- **QM-1 打包**：`build:vue` exit 0 → `electron-builder --win --x64` exit 0 ⇒ 产出 `dist-electron/Multi-Publish.Setup.0.2.0.exe`。
- **真机启动**：以**独立 profile**（`--user-data-dir` + `ELECTRON_USER_DATA_DIR` 指向临时目录）启动打包产物，避开用户正在使用的实例；DWM 取窗口外框（**含原生边框**）并 `PrintWindow(PW_RENDERFULLCONTENT)` 抓图。
- **读数**：窗口标题「汤姆鱼」，1584×992；截图中标题栏（右上角最小化/最大化/关闭按钮仍在）**下方直接就是侧边栏与内容区**，File/Edit/View/Window 那一行**已消失**；与用户截图对比即验收标准本身。
- **收尾**：只按 PID 终止本次自起的实例（主进程 45448 及其 gpu/utility/renderer 子进程），终止后 `Get-Process -Name Multi-Publish` 计数归 0，**未触碰用户自己的实例**。

## 5. QM-6 外部双模型评审

- **判定**：变更 **293 行 > 200 行阈值** ⇒ `mode=dual`（判定记录 `.ccg/reviews/137001411e34501e4c68fa18c55a892c425d816a41f93e59b895cd94405b6772.json`，`reason: 变更 293 行 > 200 行阈值（对齐 §12.6 Red Team）`）。
- **后端（真源 `scripts/ccg-review-backends.list`）**：critic=`claude` / proposer=`opencode`；本轮**未覆盖**后端（`reviewBackends.overridden=false`），跑的是 `sh scripts/deep-review.sh`（Git Bash）。依赖体检先行通过（`codeagent-wrapper` / `claude.exe` / `opencode.cmd` 三者均可解析），后端不可用时如实报失败原因、不以自审冒充通过。
- **产出**：critic=claude 提出 **6 条**发现（1 Critical + 3 Warning + 2 Info），4 个维度分（correctness 5 / security 7 / performance 9 / maintainability 4），最低分 4。
- **关键读数**：**6 条里没有一条是关于本次实现本身的**——4 条（i1 / i2 / i4 / i6）指向 CCG 工具链产物 `.ccg/reviews/*.json`，1 条（i3）指向测试写法，1 条（i5）指向缺可观测性。**菜单移除的两级策略与平台分支未收到任何 Critical/Warning 指控**。
- **逐条处置**（4 条争议项走自扮演裁决；其中 1 条被引擎误标高危域，另走外部复核）：

| # | 级别 | 发现 | 裁决 | 依据（可当场重取） |
|---|---|---|---|---|
| i1 | Critical | 产物 `sha` 字段指向 `b149359…`（父提交）而非 HEAD `c18e0fdb…`，「元数据与变更不一致」 | **dismissed（否证）** | 实测 `git rev-parse HEAD^` = `b149359519aeeb96479e41e4290c25c23b993a9e`，与产物 `sha` 字段**逐位相等** ⇒ 它记的确实是「判定时刻的 HEAD」。判定器跑在 pre-commit、新提交尚未生成，记父 sha 是机制设计（`scripts/deep-review.sh` 输出明写「这是预期行为」）。真正承担「这次评的是哪一笔」职责的是 `stagedDiffHash`，与引擎内容寻址配方逐字节一致、实测命中 |
| i2 | Warning | 建议把 `.ccg/reviews/` 加进 `.gitignore` | **dismissed（否证）** | 该文件是 QM-6 欠账门禁的**数据源**：`scripts/check-pr-exec-record.js:1086` 用 `fs.readFileSync(path.join(repo, rel))` 从**仓库工作树**读回它判闭环，CI checkout 只含已提交文件 ⇒ 不入库则门禁在 CI 上根本看不到它；同判据 `:1055` 还把「删除未闭环 dual 产物」列为欠账。仓内先例同结论：`CHANGELOG.md:23`「`.ccg/reviews/*.json` 是 QM-6 机械闭环链的载体，gitignore 等于拆掉守门」 |
| i3 | Warning | 测试运行时读 `electron.d.ts`，与 `node_modules` 物理布局强耦合，易意外跳过或失败 | **dismissed（否证；经外部复核）** | 被引擎按正文「**签名**断言」四字误标进 `crypto` 高危域（本改动与密码学无关）⇒ 触发外部复核：由**外部后端 claude** 只读独立复核（allowedTools 仅 Read/Grep/Glob，未改任何文件），公开凭据 **PR #4181 评论**（读了 native-menu.test.js / startup-compat.test.js / native-menu.js / quality-gate.yml）。复核结论 dismissed，取证与本片一致：① 同仓已有**完全同形**先例 `startup-compat.test.js`；② CI 的 `unit-tests` 与 `desktop-shards` 作业都有 `node scripts/ensure-electron.js` ⇒ `.d.ts` 在 CI 上必然存在，这条锁**真跑不是真跳过**；③ 读不到时是**显式 skip**（报告标 skipped），非静默吞掉；④ **原建议的静态 mock 化会把锁变成恒真装饰**（检查复制内容与复制内容一致）。**唯一真实弱点**：`.d.ts` 缺失时是静默 skip 而非红 ⇒ 登记为已知技术债，**不改代码** |
| i4 | Warning | 「455 行」与 `stats.changedLines=293` 不一致 | **dismissed（否证）** | 三个数字各在其口径内正确：`git diff --numstat origin/main...HEAD` 增删合计 **350**（348 增 + 2 删），减去产物自身 **57** 行 = **293**，与 `stats.changedLines` **逐位相等**；「455」= **diff 文本行数**（含 `diff --git` / `@@` 头与上下文，实测提案文件 468 行中 diff 块 455 行）。指控把不同口径读成了互相矛盾 |
| i5 | Info | `main.js` 未检查 `removeApplicationMenu` 返回值，`Menu` 缺失或平台为 macOS 时静默返回，生产环境无可见痕迹 | **upheld（采纳并已修）** | 补 `log.info('App', 'Native application menu removal: ' + reason)`：菜单没被移除只是「不好看」而非「起不来」，但**静默失败会让它无从排查**（Electron 升级后 API 变了吗？平台策略命中了吗？日志能答）。配套补 `main.test.js` 1 例断言该日志 |
| i6 | Info | 产物泄露内部评审后端名（`claude` / `opencode`） | **dismissed（否证）** | 与 i2 同源（产物必须入库才能被门禁读到）；且这是全仓既有惯例，单方面改变会拆掉守门 |

- **收口**：产物 `deepReview.status` = **`self_play_resolved`**（阻断项 0），并按门禁在**非高危面**的合规出口补 `deepReview.closureNote`（须含**轮次标记 + 逐条处置结论**，形态已自检：`hasRound=true` / `hasVerdict=true` / 长度 954）。
- **外部复核凭据**：i3 的 `externalReview` 三格已填 —— `performedBy=claude`（= 判定记录的 `expectedExternalBackend`）、`evidenceRef=https://github.com/Colinchiu007/mulpub/pull/4181#issuecomment-6314198843`、`reviewedAt`（ISO 时间）。
- **明确不做**：不因 i1 / i2 / i4 / i6 去改判据本体或 `.gitignore`（属「改谁来守门」，须人工过目）；不因 i3 把 `.d.ts` 锁改成静态 mock（会把真实约束削成恒真装饰）。
- **评审范围如实登记**：dual 评审覆盖的是 **commit #1 的 293 行实现差量**；i5 的修复（日志 + 1 例断言）落在 **commit #2**（该提交自身判定为 `single`，按判据不在 deep-review 欠账面）。它由 critic 亲自提出、按其建议实现，但**未再走一轮 dual 评审** —— 如实记录，不假称已覆盖。


## 6. CI 门禁实测（第一轮红与修法）

| 门禁 | 首轮 | 修法 |
|---|---|---|
| `Gate 12c - Doc abs-path validity` | **红** | 本记录 L12 写了本机 worktree 的**绝对路径** ⇒ 属「**新增**的本机绝对路径」，超出存量基线（计数口径不问存在性，路径当下有效也算新增）。修法：**改写成占位符形态** `<仓库父目录>\mp-worktrees\<任务名>` —— 这也是仓内既有惯例（见 `zhihu-fav-step-hint.md` §1 的隔离方式行）。修后本地复跑 `node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD` ⇒ **PASS**（counts=1161 / 无新增本机绝对路径）。**不得**用 `--write-baseline` 把这次新增记进账本消红（那正是该判据要拦的形状） |

**教训（可复用）**：执行记录里写「隔离 worktree 路径」时**不要写绝对路径**——它既是机器专属、又会随临时目录清理而失效；`Gate 12c` 按「新增绝对路径」计数，写占位符形态既合规又长期有效。

## 7. 遗留（不假装已闭合）

- **决策层未跑**：`scripts/ccg-gate.js` 在 pre-commit 打出告警「决策层范围漂移：以下改动文件不在方案声明范围内」——本次未先写方案文件跑 `sh scripts/plan-review.sh`。该告警**不阻断**（判据本身是告警级），且本任务的「方案」就是用户截图那一行需求；但按 AGENTS「先文档再代码」的完整口径，这一条如实记为**未执行的环节**，不假称已补。
- **macOS 未实机验证**：本仓只构建 win（nsis），darwin 分支只有单测覆盖平台策略，**没有 mac 真机证据**。若将来出 mac 包，需要重跑一遍真机截图。
- **快捷键面未逐条实机验证**：默认菜单被移除后，原先挂在 Edit/View 菜单上的原生加速键（Ctrl+W / Ctrl+R / Ctrl+Shift+I 等）随之消失。本仓自有的全局快捷键走 `electron/hotkeys.js`（`globalShortcut.register`），**不受影响**；但上述系统级加速键本次**没有做逐条实机点击验证**，属已知行为变化而非缺陷。
- **i3 登记为已知技术债（外部复核后不改代码）**：`native-menu.test.js` 的「真实依赖锁」在运行时读已安装 electron 包的 `electron.d.ts`；若该文件消失（包重命名 / `.d.ts` 挪位 / 分发方式变更），该块会**静默 `skip` 而非红**——CI 仍绿，但这条锁已不在守。外部后端 claude 复核确认这是**唯一**真实弱点，并反对改成静态 mock（会变成恒真装饰）；本片据此**登记为技术债、不改代码**，改由 CI 的 `ensure-electron` 步骤保证该文件在位。
- **`sha` 字段语义未在仓内写明**：判定产物的 `sha` 记的是「判定时刻的 HEAD」（= 本次提交的父提交），字段名本身不自带语义，下一个读它的人仍可能误读（外部评审 i1）。修法涉及判据本体（属「改谁来守门」，须人工过目），本片只在 §5 写明语义。

