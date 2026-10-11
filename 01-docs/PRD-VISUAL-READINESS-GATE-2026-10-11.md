# PRD：让「视图从未渲染出来」成为硬失败（visual-readiness-gate，2026-10-11）

## 1. 一句话需求

`QG Visual` 的 Gate 7 用 `|| views_exit=$?` 把三套视图/暗档套件的退出码**捕获后从不判定**，于是一个自 2026-10 起每次 main push 都发生的失败被静默吞了一个多星期。本 change 做两件事：① 修掉这个具体失败的根因（选择器指向了该路由上不存在的节点）；② 把「就绪超时」这一类**确定性**故障与「像素差异」这一类**交给基线门禁判定**的故障分开，前者变成阻断，后者维持由 Gate 7b 负责。

## 2. 现场（全部当场取证，不是推测）

main push run `38104148726`（head `337f17257`）/ job `QG Visual` id `114366028731`：

```
:752 单视图视觉门禁失败: film-engineering: 视觉测试就绪超时（15000ms）：stage=业务选择器(.film-canvas-view)；expectedHash=#/film-engineering；url=http://127.0.0.1:5174/#/film-engineering…
:753 [ELIFECYCLE] Command failed with exit code 1.
:835 [GATE-7] suite exits: pixel=0 views=1 views-supplement=0 dark=0
:…   [GATE-7] All visual tests passed        ← 同一步的结尾
```

同一份日志里暗档套是 `像素结果[dark]: 20/20 通过`。⇒ **`views=1` 与 "All visual tests passed" 在同一步内共存**。

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
| R13 | 共享分类逐判例：裸 `TimeoutError` / 两个就绪码 / `ERR_VISUAL_NOT_READY` / `null` | 依次 `false / true / true / false`；`classifyFailures` 对裸 TimeoutError 的 `neverReady` 为空 |

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

（表内数字取 **§8 修复之后**那一批同驱复跑：`BASELINE[vitest] rc=0 :: Tests 13 passed (13)`，收尾 `red=7/7 notRed=0`，每个变异还原后 `Buffer.compare` 逐字节相同。）

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

## 7. 验收标准

1. `pnpm exec vitest run tests/visual-testing/visual-readiness-classification.test.js` 全绿，R1–R13 逐条存在（实测 `Tests 13 passed (13)`，含 §8 补的 R12/R13）。
2. 消费者并集全跑（`git grep` 反查引用被改模块的测试文件）：`tests/visual-ci.test.js` + `tests/visual-testing/condition-waiting.test.js` + `electron/tests/visual-view-runner.test.js` + 本条新测试 ⇒ 实测 `4 passed / Tests 70 passed (70)`（§8 修复后复跑）。
3. `node --test .github/scripts/workflow-contract.test.js` 全绿，含新结构锁（实测 `35 pass / 0 fail`，改前基线 34）。
4. 本 PR 自己的 `QG Visual` 现场：`[GATE-7] suite exits: pixel=0 views=0 views-supplement=0 dark=0`（`views` 必须由 1 变 0）且 `[GATE-7] All visual tests passed` 与之一致 —— 这一条是"根因真的被修掉"的唯一现场证据。
5. 变异 N1–N7 逐个实测变红并逐字节还原（见 §5 表 + §8，`red=7/7 notRed=0`）。
6. 混合 PR（含 `apps/`、`.github/`）⇒ `classify-docs-only` 必 `docs-only=false`。

## 8. QM-6 外部评审处置（替代通道，2026-10-11）

标准通道本机不可用（`ccg-deep-review.js` 缺失；CC Switch `:15721` 探针 DOWN ⇒ `routing.backend=codex` / `routing.frontend=claude` 两个 primary 都连不上），按既有替代通道跑 `opencode run --agent plan`，任务书落在 `.qm6/task-backend.md`，逐条要求"给结论 + 证据行号"。

**后端轴（`opencode/nemotron-3-ultra-free`）结论**：A 不漏拦 / **B Critical：会误拦** / C 聚合语义符合 / D PowerShell 判定安全 / E 第 4 条验收只有 CI 现场能证伪、本地替代可接受。

**B 项我自己复核过才动手**（不接受"评审说了就改"）：

- 事实 1：`_waitForApplicationReady` 的 catch 把该阶段**所有**超时（含它自己造的 `exhaustedBudgetError`）统一改写成上面两个码（`test-runner.js:231-250`）⇒ "就绪"必然带码，`name === 'TimeoutError'` 兜底**捞不到任何就绪路径**。
- 事实 2：它真正捞到的是**别处**的超时。补充套件 19 个视图里 **4 个带 `trigger`/`afterTrigger`**（`user-menu-upgrade-entry`、`model-provider-add-dialog`、`model-provider-edit-dialog`、`model-provider-delete-dialog`），走 `page.click(..., {timeout:5000})` 与 `page.waitForSelector(..., {timeout:10000})`（`supplementary-views.visual.test.js:231-234`），其中 `button:has-text("添加服务商")` 这类**文案锚点**本就可能在校验层失败；`page.goto` 的 15s 超时同样是裸 `TimeoutError`（`test-runner.js:292-295`，冷 Vite 首次依赖优化就能超）。
- 后果：这些会被编成 `exit 3` ⇒ Gate 7 当场阻断 ⇒ **绕过 Gate 7b 的两轮甄别**，正是本 PR 立"分档"要防止的"把抖动变成所有 PR 的常量红"。且这条路径是**本 PR 把 supplement 接进分类时才打通的** —— 属自引入回归，不是既有缺陷。

**处置**：删掉 `error.name === 'TimeoutError'` 兜底（`isReadyFailure` 只认三个码），新增 **R12**（trigger 点击超时不得升级，仍 `ERR_VISUAL_SUITE_FAILED` ⇒ 1）与 **R13**（共享分类本身逐判例：裸 `TimeoutError` 判否、两个就绪码判是、`ERR_VISUAL_NOT_READY` 判是、`null` 判否）；变异 **N7 = 把兜底加回来 ⇒ 实测 RED（`Failed Tests 2`）**，与 N1–N6 同批复跑 `red=7/7 notRed=0`。

**未采纳**：评审建议的"在 `runViewTest` 里给 click/waitForSelector 超时新增 `ERR_VISUAL_TRIGGER_TIMEOUT` / `ERR_VISUAL_DIALOG_TIMEOUT` 两个码"。理由：那要改动既有异常形状、属**新增契约**，而这些失败的目标语义就是"不阻断、交 Gate 7b"，1 档已足够；为不需要区分的失败发明码，是在给下一个会话留第二份要维护的枚举表。

