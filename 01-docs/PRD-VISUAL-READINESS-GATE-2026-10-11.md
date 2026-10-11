# PRD：让「视图从未渲染出来」成为硬失败（visual-readiness-gate，2026-10-11）

## 1. 一句话需求

`QG Visual` 的 Gate 7 用 `|| views_exit=$?` 把三套视图/暗档套件的退出码**捕获后从不判定**，于是一个自 2026-10 起每次 main push 都发生的失败被静默吞了一个多星期。**归属先看 §2b**：选择器那一半在 re-sync 时遇到 main 已由另一会话独立改掉，本 PR 的净差量是「捕获而不判定」那一道判定与分档机制。本 change 做两件事：① 修掉这个具体失败的根因（选择器指向了该路由上不存在的节点）；② 把「就绪超时」这一类**确定性**故障与「像素差异」这一类**交给基线门禁判定**的故障分开，前者变成阻断，后者维持由 Gate 7b 负责。

## 2. 现场（全部当场取证，不是推测）

main push run `38104148726`（head `337f17257`）/ job `QG Visual` id `114366028731`：

```
:752 单视图视觉门禁失败: film-engineering: 视觉测试就绪超时（15000ms）：stage=业务选择器(.film-canvas-view)；expectedHash=#/film-engineering；url=http://127.0.0.1:5174/#/film-engineering…
:753 [ELIFECYCLE] Command failed with exit code 1.
:835 [GATE-7] suite exits: pixel=0 views=1 views-supplement=0 dark=0
:…   [GATE-7] All visual tests passed        ← 同一步的结尾
```

同一份日志里暗档套是 `像素结果[dark]: 20/20 通过`。⇒ **`views=1` 与 "All visual tests passed" 在同一步内共存**。

## 2b. 与 main 的相遇（归属与本 PR 的净差量）

re-sync 时 `all-views.visual.test.js` 的 `film-engineering` 登记行与 origin/main 冲突 —— **另一会话已经独立把同一个选择器改掉了**。origin/main 当时是：

```js
routeView('film-engineering', '/film-engineering', '.film-hub-view'),
// #3234 三标签重组后 /film-engineering 是 Hub 页（默认「自动」标签，画布懒挂载）——
// 就绪探针等 Hub 稳定根；等 .film-canvas-view 会 15s 超时（batch-teleport-fix 实测）
```

两侧结论语义相同、出处不同，所以归属必须写清：**选择器那一半不是本 PR 独占的发现**。解法取**更深的锚点** `.film-hub-view .fh-title`（Hub 在任何标签下都渲染的 `<h1>`），并把两侧注释合并、保留对方出处；判据仍由 R7 从 `router/index.js` + Hub 源码自行推导根类名前缀，不写死字符串相等。

本 PR 的**净差量**当场用 `git show origin/main` 对照过（不是推断）：

| 项 | origin/main 实测 | 本 PR |
| --- | --- | --- |
| Gate 7 是否有 `= 3` 判定 | **无** | 有（四个套件逐个判） |
| 是否有 `$suitesNotReady` | **无** | 有 |
| `|| views_exit=$?` 是否仍在吞退出码 | **仍在** | 改为逐个取 `$LASTEXITCODE` 并参与判定 |
| 是否有 `ready-classification` 模块 | **无** | 有（两套共用判据**与失败对象合成**） |

⇒ **main 上"视图从未渲染出来"依然不可判**：选择器修好之后它暂时不再发生，但一旦再发生（新视图登记错、Hub 结构调整、路由改名），没有任何东西会拦 —— 本 PR 交付的是那一道判定，而不是那条别人也能走到的选区修复。

## 3. QM-5 五步

### ① 第一性原因

`apps/desktop/tests/visual-testing/views/all-views.visual.test.js:69`：

```js
routeView('film-engineering', '/film-engineering', '.film-canvas-view'),
```

而 `apps/desktop/src/router/index.js:52` 里 `/film-engineering` 渲染的是 **`FilmEngineeringHubView.vue`**（根节点 `.film-hub-view`，`data-testid="film-hub"`）。`.film-canvas-view` 属于 `FilmCanvasView.vue`，它在 Hub 里是**懒挂载的一个标签页**：

```js
const TABS = Object.freeze(['auto', 'canvas', 'classic'])
const DEFAULT_TAB = 'auto'
const mountedTabs = ref(new Set([activeTab.value]))   // 初始只挂 'auto'
<FilmCanvasView v-if="isMounted('canvas')" :embedded="true" … />
```

⇒ 不带 `?tab=canvas` 时 `.film-canvas-view` **永远不存在**，`page.waitForSelector` 每次都烧满 15s 预算后抛 `视觉测试就绪超时`。这不是 flake：它出现在每一个跑 `test:visual` 的 run 上（main push 与 PR 皆然），且失败视图名固定。

第二层根因（为什么它能藏这么久）：`quality-gate.yml` Gate 7 里三套视图命令写作 `pnpm.cmd run test:visual || views_exit=$?`，而该步的失败条件（`:1092-1099`）只读 `$pixelExit` 与 `$judgeExit`。**捕获退出码却不判定**，正是 learnings 里第 N 次复发的「装饰性链路」形态。

引入点：视图登记来自影视工程 Hub 那批工作（Hub 视图与 `/film-engineering` 路由同为该批产物），`routeView` 的第三个参数按"这一页的核心节点"直觉填了 canvas 类名；同期 Gate 7 的 `views_exit` 一直是装饰。**两者互相掩盖**：如果退出码被判定，这个错误选择器在落地当天就会红。

### ② 测试逃逸链

| 层 | 是否拦到 | 原因 |
| --- | --- | --- |
| 单元（vitest） | ❌ | `runViewSuite` 没有针对"选择器与路由不匹配"的任何断言；就绪超时只在真浏览器里暴露 |
| 像素门禁 `test:visual:pixel` | ❌ | `film-engineering` 根本不在 `run-pixel-tests.js` 的 `pixelTests` 清单里（实测该文件零命中） |
| 基线新鲜度 Gate 7b | ❌ | 判据是"基线是否等于本次渲染"；该视图**没有基线**（浅色/暗档各 20 个注册视图无基线）⇒ 不在判定域内 |
| CI 步骤成败 | ❌（**本 change 要修的层**） | `views_exit` 被捕获但不参与判定 |
| 代码审查 | ❌ | 登记行只有 `routeView('film-engineering', …, '.film-canvas-view')` 一行，看不出它是 Hub 的某个非默认标签 |

分类：**门禁缺失漏洞**（捕获而不判定）+ **测试场景缺失**（就绪选择器与路由的对应关系无人校验）。

### ③ 系统性漏洞定位

1. `.github/workflows/quality-gate.yml:1040-1099`：Gate 7 的失败条件是 `$pixelExit`/`$judgeExit` 的白名单，**新增套件时容易只加捕获不加判定**（#3221 加暗档时就只加了打印）。
2. `apps/desktop/tests/visual-testing/views/all-views.visual.test.js::runViewSuite`：把"就绪超时"（视图没渲染出来，确定性问题）与"像素/校验失败"（可能是可容忍差异）压成同一个 `ERR_VISUAL_SUITE_FAILED` + 同一个退出码 1 ⇒ 门禁无法表达"只拦前者"的语义，也就没法在不引入 flake 风险的前提下接进判定。**这是本 change 选择分离两类故障的理由**：直接把 `views_exit -ne 0` 接成阻断，会把 views 套件的像素抖动（历史上确实存在，见 Gate 7b 两轮甄别机制的由来 #31）变成所有 PR 的常量红。

### ④ 修复 + 回归保护（按落地实况书写，2026-10-11）

1. **新增唯一实现** `apps/desktop/tests/visual-testing/ready-classification.js`：`READY_TIMEOUT_CODES` / `isReadyFailure` / `exitCodeForError` / `classifyFailures`。
   分类判据取 **`error.code`**，不取消息文本 —— 原判据草案写的是"按 `视觉测试就绪超时` 文本"，实现时改掉了：`test-runner.js` 在 `_waitForApplicationReady` 的两个阶段分别抛 `ERR_VISUAL_APP_READY_TIMEOUT`（Vue 从未挂载）与 `ERR_VISUAL_READY_SELECTOR_TIMEOUT`（挂载了但业务选择器没出现），**码是合同、消息随时可重写**。**不得按 `error.name === 'TimeoutError'` 兜底** —— 该写法曾在初版里作为"保险"存在，被 QM-6 后端评审判为 Critical，理由与实测见 §8。
2. `all-views.visual.test.js`：`runViewSuite` 改走 `classifyFailures`，就绪优先归类，先 `console.error(line)` 打 `[VISUAL-READY] N 个视图从未渲染出来: <names>`，再抛 `error.code = 'ERR_VISUAL_NOT_READY'` 并挂 `neverReady`/`otherFailures`；`main().catch` 用 `exitCodeForError` ⇒ 就绪 ⇒ **3**，其余仍 1（`--single` 走同一个 `main()`，同口径自动覆盖）。
3. `supplementary-views.visual.test.js`：**同一份分类**。该文件有自己的一份 `runViewSuite`（两份聚合循环），过去它的失败错误连 `code` 都没有；若不同步改，Gate 7 里 `views-supplement` 那条 `= 3` 判定**永远点不到火**，就是一道装饰性门禁。现它 require 共享实现，退出码同一映射。
4. `quality-gate.yml` Gate 7：`$pixelExit`/`$viewsExit`/`$viewsSuppExit`/`$darkExit` 任一 **等于 3** ⇒ 汇总进 `$suitesNotReady` 并在 `$pixelExit` 判定**之前** `exit 3`，点名套件；`1` 仍交给 Gate 7b。名单**显式初始化为空串**（PowerShell 里 `$null -ne ''` 为真，见 §5 实测表第 6 行）。
5. `.github/scripts/workflow-contract.test.js`：新结构锁「Gate 7 必须按退出码 3 阻断就绪故障（捕获而不判定的回退锁）」，四条：四个套件各有 `-eq 3`、`= ''` 初始化在场、就绪拦截排在像素判定之前、`$LASTEXITCODE` 取值数 ≥7（防退回 `|| x=$?`）。接线位置不变（该文件跑在 static-gates 的 `Gate 2`，本 PR 是混合 PR，不会被 docs-only 短路）。
6. 根因本身：`routeView('film-engineering', '/film-engineering', '.film-hub-view .fh-title')` —— Hub 的 `<h1 class="fh-title">` 在任何标签下都渲染，是"这一页确实挂载了"的最小出口；不写 locale 字面量（`:has-text("…")` 会把测试和 zh 文案钉死，是既有假红来源）。
7. 回归保护测试 `apps/desktop/tests/visual-testing/visual-readiness-classification.test.js`（vitest，注入假 runner，**不需要浏览器/dev server**；不放 `views/` 目录，因为 `vitest.config.js` 的 exclude 里有 `tests/visual-testing/views/**`）。13 例覆盖 R1–R13。


### ⑤ 预防措施

- 结构锁（上面第 4 条）+ 分类单测（第 6 条）落进既有 CI：`apps/desktop` 的 vitest 与 `Gate 2b` 的 workflow-contract，均已接线，无需新接线点。
- `AGENTS.md` QM-4 补一条：**在 CI 里用 `|| x=$?` 捕获套件退出码的步骤，必须同 PR 补一道"该退出码是否参与判定"的锁**；就绪类故障（视图没渲染出来）一律阻断，像素差异类才允许交给基线门禁。
- `01-docs/learnings.md` 记录"捕获而不判定"与"选择器指向非默认标签节点"两条。

## 4. 测试场景矩阵

| # | 场景（注入假 runner） | 期望 |
| --- | --- | --- |
| R1 | 一个视图抛 `视觉测试就绪超时（15000ms）…` | 抛错 `code=ERR_VISUAL_NOT_READY`、message 点名该视图、并打印 `[VISUAL-READY]` 行 |
| R2 | 一个视图抛像素差异失败（非超时） | 仍 `ERR_VISUAL_SUITE_FAILED`（**不得**因新分类被误升级） |
| R3 | 两类同时出现 | 按"就绪优先"归类（更严重的确定性故障必须阻断），且两类计数都出现在汇总里 |
| R4 | 全部通过 | 返回 `{total, passed}`，不抛错 |
| R5 | `runner.close()` 抛错 + 无失败 | 原样抛（不得把清理失败误分类为就绪问题） |
| R6 | 假 runner 的 `results` 里已有 FAILED 记录 | 不重复 push（保持既有 alreadyRecorded 语义） |
| R7 | 真注册表自证 | `viewTests` 里 `film-engineering` 的 `waitFor` 必须是 Hub 的锚点，且 `/film-engineering` 的路由组件根类名与之对应（读 `router/index.js` + Hub 源码，不是写死字符串相等） |
| R8 | 退出码映射 | `ERR_VISUAL_NOT_READY ⇒ 3`、`ERR_VISUAL_SUITE_FAILED ⇒ 1`、其它 ⇒ 1 |
| R9 | **补充套件**同样注入就绪超时（假 runner 的 `_navigateToRoute` 抛错） | `ERR_VISUAL_NOT_READY` + `exitCodeForError ⇒ 3`（两份 runViewSuite 不得各判各的） |
| R10 | 补充套件的断言失败（选择器不可见） | 保持 `ERR_VISUAL_SUITE_FAILED` + 退出码 1 |
| R11 | 结构锁：两个套件都 `require('../ready-classification')` 且**不得自带** `isReadyFailure`/`exitCodeForError`/`classifyFailures`/`READY_TIMEOUT_CODES` 定义；共享实现必须真的持有三个函数（各恰好 1 处定义） | 反向也锁：共享文件里少一个函数即红，防"锁在扫两个空文件" |
| R12 | 补充套件的视图带 `trigger`，`page.click` 抛**裸** `TimeoutError`（Playwright 原生形状，无我们的 code） | 仍 `ERR_VISUAL_SUITE_FAILED` ⇒ 退出码 **1**（不得绕过 Gate 7b 的两轮甄别）—— §8 的 Critical 回归锁 |
| R13 | 共享分类逐判例：裸 `TimeoutError` / 两个就绪码 / `ERR_VISUAL_NOT_READY` / `null` | 依次 `false / true / true / false`；`classifyVisualFailures` 对裸 TimeoutError 的 `neverReady` 为空 |
| R14 | all-views：一个视图就绪超时 **且** `runner.close()` 抛错 | 抛出的仍是 `ERR_VISUAL_NOT_READY`（`neverReady` 点名），close 的失败挂在 `cause` 上——清理失败不得把就绪故障压回 1 |
| R15 | supplement：同上组合 | 同一结论（`ERR_VISUAL_NOT_READY` + `cause` + `exitCodeForError ⇒ 3`），证明两套同口径 |

## 5. 反证（变异与行为表均**当场实测**，2026-10-11）

变异驱动 `D:/Data/projects/.tools/tmp/vt-rb/mutate_vrg2.cjs`（每个变异跑一次测试，收尾按 `Buffer.compare` 断言与备份**逐字节相同**；红绿一律以子进程 rc 为准，汇总行只做留痕，且"匹配不到汇总行"直接抛错而非当成 0 失败）：

| # | 变异 | 实测结果 |
| --- | --- | --- |
| N1 | 去掉就绪分类（`neverReady` 恒空） | **RED** rc=1，`Failed Tests 3`（R1/R3/R9） |
| N2 | 放宽成"任何失败都算就绪" | **RED** rc=1，`Failed Tests 5`（R2/R10/R12/R13 + 那条"只有真区分才绿"的） |
| N3 | `neverReady` 只打印、不影响 `code` | **RED** rc=1，`Failed Tests 2`（R1、R9 的 code 断言） |
| N4 | 删掉 Gate 7 对 `$viewsExit` 的 `= 3` 判定 | **RED** rc=1，`workflow-contract.test.js` 结构锁点名 viewsExit |
| N5 | 选择器改回 `.film-canvas-view` | **RED** rc=1，`Failed Tests 1`（R7 根因回归锁） |
| N6 | 退出码映射退化成恒 1 | **RED** rc=1，`Failed Tests 2`（R8 + R9 的映射断言） |
| N7 | 把 `error.name === 'TimeoutError'` 兜底加回来（§8 的 Critical 回归反证） | **RED** rc=1，`Failed Tests 2`（R12 + R13） |
| N8 | 把就绪失败消息模板抄回套件（`个视图从未渲染出来` 出现在 `all-views` 里） | **RED** rc=1，`Failed Tests 1`（R11 的新断言：模板与 `code` 赋值只许一份） |

（表内数字取 **§8 两次修复之后**那一批同驱复跑：`BASELINE[vitest] rc=0 :: Tests 15 passed (15)`，收尾 `red=8/8 notRed=0`（N1–N8），每个变异还原后 `Buffer.compare` 断言与备份逐字节相同。）

**Gate 7 判定逻辑的行为表**（把 workflow 里那几行原文抽出来喂给 `pwsh` 真跑，不是读代码猜）：

| `$pixelExit` | `$viewsExit` | `$viewsSuppExit` | `$darkExit` | rc | 现场输出 |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | **0** | `NOTREADY=[]`（合规形态必须绿） |
| 0 | 3 | 0 | 0 | **3** | `[GATE-7] FATAL: … 套件: views` |
| 0 | 1 | 0 | 0 | 0 | `NOTREADY=[]`（像素类交 Gate 7b，不阻断） |
| 0 | 0 | 1 | 0 | 0 | `NOTREADY=[]` |
| 3 | 0 | 0 | 0 | **3** | `[GATE-7] FATAL: … 套件: pixel` |
| 0 | 0 | 0 | 0 | **3** | 同上，但 `套件: ` 为**空** —— 这是**删掉 `$suitesNotReady = ''` 初始化**的那一行实测：PowerShell 里 `$null -ne ''` 为真，于是每条合规 PR 都被判红 |

最后一行是本条锁要同时锁住"合规形态能绿"的实测依据：只写"必须存在 `= 3` 判定"的存在性锁，会把下一条 PR 的修复路径焊死（AGENTS.md/记忆里 PR #3225 同族教训）。

## 6. 不在本 PR 范围（登记，不静默修）

- 37 个注册视图里 **20 个没有基线**（浅色与暗档同）⇒ 它们整体不在 Gate 7b 判定域内。补齐需要 CI 侧采集，属另一条线（且基线必须同源，见 QM-4 规则 7）。
- `test:all:visual` 四套聚合器（`run-all-visual.js`）自身的退出码语义：它逐套隔离采集，本轮只统一了两套 views 的**分类**，没有改聚合器的 3 档传播。
- `run-pixel-tests.js`（`test:visual:pixel` / `:pixel:dark` 的实现）没有接入 `ready-classification`：它的就绪失败目前仍以 1 退出，Gate 7 的 `$pixelExit -ne 0` 本来就阻断，所以**不构成盲区**，只是 3 档语义在那一侧未使用。
- Gate 7b round2 暗档重采至今无运行时现场（只在 round1 报违规时可达）。
- 影视工程 Hub 是否需要把 canvas 也纳入像素基线覆盖（那是**新增视觉用例**，要两份清单都登记）。
- `test:all:visual` 的发版前路径上，聚合器 `run-all-visual.js:152` 把任何失败归一成退出码 1（它只按 `summary.failed/aborted` 记账，不消费套件的 3）⇒ **3 档在那条人工核查路径上被稀释**。不改的理由见 §8 前端轴 E：聚合器的角色是汇总而非门禁；这里登记是因为"它跑过且绿"不等于"就绪故障在那条路上被拦住"。

## 7. 验收标准

1. `pnpm exec vitest run tests/visual-testing/visual-readiness-classification.test.js` 全绿，R1–R15 逐条存在（实测 `Tests 15 passed (15)`，含 §8 两次评审补的 R12–R15）。
2. 消费者并集全跑（`git grep` 反查引用被改模块的测试文件）：`tests/visual-ci.test.js` + `tests/visual-testing/condition-waiting.test.js` + `electron/tests/visual-view-runner.test.js` + 本条新测试 ⇒ 实测 `4 passed / Tests 72 passed (72)`（§8 两次修复后复跑）。
3. `node --test .github/scripts/workflow-contract.test.js` 全绿，含新结构锁（实测 `35 pass / 0 fail`，改前基线 34）。
4. 本 PR 自己的 `QG Visual` 现场：`[GATE-7] suite exits: pixel=0 views=0 views-supplement=0 dark=0`（`views` 必须由 1 变 0）且 `[GATE-7] All visual tests passed` 与之一致。这条现场证明的是**「Gate 7 在这个 head 上真的判了，且没有就绪故障被吞」**；"根因被修掉"不能单独记在本 PR 头上 —— 见 §2b，main 已独立修掉同一选择器。
5. 变异 N1–N8 逐个实测变红并逐字节还原（见 §5 表 + §8，`red=8/8 notRed=0`）。
6. 混合 PR（含 `apps/`、`.github/`）⇒ `classify-docs-only` 必 `docs-only=false`。

## 8. QM-6 外部评审处置（替代通道，2026-10-11）

标准通道本机不可用（`ccg-deep-review.js` 缺失；CC Switch `:15721` 探针 DOWN ⇒ `routing.backend=codex` / `routing.frontend=claude` 两个 primary 都连不上），按既有替代通道跑 `opencode run --agent plan --auto`，任务书逐条要求"给结论 + 证据行号"。评审的 stdout/err 是会话内 scratch（`.qm6/`，不入库、随会话清理），所以**本节的每条结论都以我自己的复核为准**，不引用那份产物当依据——入库文档把判据指向一个别人取不到的临时路径，等于没有依据。

**后端轴（`opencode/nemotron-3-ultra-free`）结论**：A 不漏拦 / **B Critical：会误拦** / C 聚合语义符合 / D PowerShell 判定安全 / E 第 4 条验收只有 CI 现场能证伪、本地替代可接受。

**B 项我自己复核过才动手**（不接受"评审说了就改"）：

- 事实 1：`_waitForApplicationReady` 的 catch 把该阶段**所有**超时（含它自己造的 `exhaustedBudgetError`）统一改写成上面两个码（`test-runner.js:231-250`）⇒ "就绪"必然带码，`name === 'TimeoutError'` 兜底**捞不到任何就绪路径**。
- 事实 2：它真正捞到的是**别处**的超时。补充套件 19 个视图里 **4 个带 `trigger`/`afterTrigger`**（`user-menu-upgrade-entry`、`model-provider-add-dialog`、`model-provider-edit-dialog`、`model-provider-delete-dialog`），走 `page.click(..., {timeout:5000})` 与 `page.waitForSelector(..., {timeout:10000})`（`supplementary-views.visual.test.js:231-234`），其中 `button:has-text("添加服务商")` 这类**文案锚点**本就可能在校验层失败；`page.goto` 的 15s 超时同样是裸 `TimeoutError`（`test-runner.js:292-295`，冷 Vite 首次依赖优化就能超）。
- 后果：这些会被编成 `exit 3` ⇒ Gate 7 当场阻断 ⇒ **绕过 Gate 7b 的两轮甄别**，正是本 PR 立"分档"要防止的"把抖动变成所有 PR 的常量红"。且这条路径是**本 PR 把 supplement 接进分类时才打通的** —— 属自引入回归，不是既有缺陷。

**处置**：删掉 `error.name === 'TimeoutError'` 兜底（`isReadyFailure` 只认三个码），新增 **R12**（trigger 点击超时不得升级，仍 `ERR_VISUAL_SUITE_FAILED` ⇒ 1）与 **R13**（共享分类本身逐判例：裸 `TimeoutError` 判否、两个就绪码判是、`ERR_VISUAL_NOT_READY` 判是、`null` 判否）；变异 **N7 = 把兜底加回来 ⇒ 实测 RED（`Failed Tests 2`）**，与 N1–N6 同批复跑 `red=7/7 notRed=0`。

**未采纳**：评审建议的"在 `runViewTest` 里给 click/waitForSelector 超时新增 `ERR_VISUAL_TRIGGER_TIMEOUT` / `ERR_VISUAL_DIALOG_TIMEOUT` 两个码"。理由：那要改动既有异常形状、属**新增契约**，而这些失败的目标语义就是"不阻断、交 Gate 7b"，1 档已足够；为不需要区分的失败发明码，是在给下一个会话留第二份要维护的枚举表。


### 前端/工程轴（`opencode/ling-3.1-flash-free`）

**Critical=1（读取时刻成立，现已闭合）+ Minor=7。** 它报的唯一 Critical 是"已提交 tip 仍带 `name === 'TimeoutError'` 兜底，修复只在未提交的工作副本里"—— 那是它读取时的事实（当时 tip = `7d37f1e2b`），我随后提交了 `1ce35fc2b`。复核口径不是"它说了就改"而是自己取证：`git show HEAD` 版本的 `ready-classification.js` 里该字样**只出现在禁止性注释中**，`return error.name` 那一行不存在。

已采纳并落地的 5 条 Minor（每条都我自己 grep 过才动）：

| 评审条目 | 我的独立取证 | 处置 |
| --- | --- | --- |
| A：消息模板 + `code` 赋值 + 三属性挂载在两套循环里各抄一遍，而 R11 只锁"不自带定义" | 逐行对照 `all-views:151-172` 与 `supplementary-views:280-301`，除前缀外**逐字相同** ⇒ 两份模板会在下次改文案时漂移，而 `code` 一漂移 Gate 7 的 `= 3` 就点不到火 | 收进共享模块 `buildSuiteError(prefix, failures)`；R11 加两条锁（套件里不得出现 `个视图从未渲染出来` 模板；不得自行赋那两个 `error.code`）；反证 **N8＝把模板抄回套件 ⇒ 实测 RED（`Failed Tests 1`）** |
| A/E：`close()` 抛错会吞掉已收集的就绪失败（就绪被压回 1，`= 3` 点不到火） | `supplementary-views` 是裸 `finally { await runner.close() }`；`all-views` 虽有 `fatalError`，但 `if (fatalError) throw` 排在分类块**之前** | 两套统一改为「视图失败优先、close 失败挂 `cause`」；launch 失败时 `failures` 必为空，故 R5 原语义不变；新增 **R14/R15** |
| B：两套 re-export 的 `isReadyFailure`/`exitCodeForError` 是零消费者死导出，且注释声称"给 run-all-visual.js 使用" | 全仓 grep：`run-all-visual.js:19-33` 与 `visual-ci.test.js:18/46-49` 只取注册表与运行函数；分类单测已直连共享模块 ⇒ **那句注释与事实不符** | 删掉两处 re-export，注释改成"不 re-export"的说明；测试改走 `rc.exitCodeForError` |
| C：`classifyFailures` 与 `autonomous-enforce-loop.js:197` 同名不同义 | `grep "function classifyFailures"` 命中 2 处，另一份签名是 `(pixelResults, functionalResults)` | 改名 `classifyVisualFailures`，并在模块头注释点名碰撞来源 |
| C/E：Gate 7 对 pixel/dark 的 `-eq 3` 当前不可达 | `run-pixel-tests.js` 实测只有一处 `process.exitCode`，值为 1（含 `ERR_VISUAL_ENV_MISSING`） | 保留判据（下一个开始发 3 的套件不必再改判定面），在 workflow 里**如实注明**当前不可达 + "不得把它当成环境故障已被拦住"（环境类的既有出口是 `$pixelExit -ne 0`） |

未采纳的 2 条（带理由，不是"顺手不改"）：

- **D**：假 runner 未覆盖 `page.waitForSelector` 的超时面 —— 评审自身已判定"无缺陷不可表示"（该面与 click 面同落 `other ⇒ exit 1` 桶，R13 又直接钉死判据），再加一个 `waitForSelectorErr` 选项属低价值重复。
- **E**：`run-all-visual.js:152` 把任何失败都归一成 1（发版前 `test:all:visual` 路径上 3 档被稀释）—— 聚合器的角色是**汇总而非门禁**，改它等于给人工核查路径新增一道判定。登记进 §6，不动代码。

**关于评审过程自身的一条记录（我的操作错误）**：两路评审运行期间，我在同一 worktree 跑了变异电池。前端轴在输出里点名观察到工作副本出现 `// MUT N6` 瞬时态，并自称改用"当前稳定快照 + `git show HEAD`"对照取证。干扰的后果不是我改坏了什么（每个变异都 `Buffer.compare` 还原过），而是**它当时读到的是哪一版无法由我事后重建** —— 所以我没有照抄它的任何一条结论，上表第三列全部重新独立取证。已写入跨会话记忆：外部评审读目录期间禁止写型反证。

本轮同批实测数字：`Tests 15 passed (15)`、消费者并集 `72 passed (72)`、`workflow-contract` `35 pass / 0 fail`、变异 **N1–N8 `red=8/8 notRed=0`**。
