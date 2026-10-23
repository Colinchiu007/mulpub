# Design: qm6-zero-human-closure

> 全部行号取于 `origin/main@a12f60512`（2026-10-23）。本仓行号**会漂**——
> 上一片实测过"隔 3 笔合并漂 5 行"（见 `qm6-closure-writeback/proposal.md` 的 0.1）。
> 引用前一律 `grep -n` 现取，不得照抄本文。

## §0 与本家族在飞三片的边界（先划清，否则本 change 会造出第二份事实）

同一条 QM-6 收口链上今天有三片在飞，全部 OPEN、全部不自动合并：

| 片 | PR | 它管什么 | 本 change 与它的关系 |
| --- | --- | --- | --- |
| 守门面单一真源 + 高危面唯一机械出口 | **#4261** | 把 5 条守门面前缀收成 `scripts/lib/ccg-review-gate-surfaces.js`；矩阵补"变更集须含 ≥1 条 `tier=external` 已闭环产物" | **D3 的守门面维度取该单源**，故本 change 建在它之上。它自己正是被 §2 那条链打在身上的第一个 PR |
| 收口值写回第三刀 | **#4148** | 写回器剩余两格 | 它的 QM-6 收口经用户 2026-10-23 裁决**保持未闭合交人工**；本 change **不为它开后门**，也不得被读成"已解决 #4148" |
| 已否证清单 + 跨调用轮次上限 | **#4297** | `rebuttals[]`（带可核证据的否证）与 `openspec/changes/<change>/external-rounds.json` 轮次账；其 spec 有一条 Requirement 明文写"**本 change 不得改变什么算闭合**" | **本 change 就是它留议未裁决的那"第 1 条"**（同一份 proposal 的《不做什么》里点名排除、需单独裁决的那一条）⇒ D1 的 `false-positive` 档 MUST 复用 `rebuttals[]` 作唯一真源，见 §4.2 |

**从 #4297 直接继承的两条硬约束**（它已实测，本 change 不得重新踩）：

1. **判定记录名是内容寻址**（`git diff HEAD^ HEAD -- . ':(exclude).ccg' | sha256sum` 逐字等于记录名），
   八轮里换过 6 个名字 ⇒ **任何计数/状态都不得挂在记录名上**。D3 的 `coverage` 维度键取守门维度
   （前缀 / `tier` 档 / 合取条号），**结构性不引用记录名**（§5.4）——这是继承，不是选择。
2. **`.ccg/reviews/` 子目录不被 pre-commit 的暂存 glob 收走**（钩子用 `:(glob).ccg/reviews/*.json`，`*` 不跨 `/`）
   ⇒ 跨调用状态账必须落**受管可见路径**。本 change 据此把重放运行账放在
   `openspec/changes/<change>/judgment-replay-runs.json`（随 PR 走、可 diff），**不放 `scripts/`、不放 `.ccg/`**。

## §1 现场读数（每条都是当场跑出来的，附重取方式）

| 读数 | 值 | 怎么重取 |
| --- | --- | --- |
| 高危面条目 | **10 条**，vendored 排除 1 项（`.quality-rhythm/`） | `node -e "const m=require('./scripts/check-pr-exec-record.js');console.log(m.HIGH_RISK_SURFACES.length,m.VENDORED_SUBTREES.length)"` |
| 评审产物普查分母 | **1975 枚**（普查工具自己的形状口径） | `node scripts/ccg-artifact-shape-survey.js --ref=origin/main` |
| 同目录 `.json` 文件数 | **1980 个**（比上一行多 5 枚） | `git ls-tree -r --name-only origin/main -- .ccg/reviews/ \| grep -c '\.json$'` |
| 已闭环产物 × tier 交叉表 | `closed=339`，其中 **`tier=absent=202`、`tier=external=84`、`tier=self-play=40`、`tier=unrecognized=3`** | 同普查工具（交叉表是该组数的唯一生产处） |
| `deepReview.tier` 缺席 | **1332/1975** | 同上 |
| 「`performedBy` 以 self-play 开头却声明做过外部复核」 | **24 条** | 同上 |
| 已合并 PR（`#4xxx` 段） | **205 笔** | `git log origin/main --grep='(#4[0-9][0-9][0-9])$' --oneline \| wc -l` |
| `openspec/records/` 篇数 | **706 篇** | `git ls-tree -r --name-only origin/main -- openspec/records/ \| wc -l` |
| 一枚真实 dual 产物的字段 | `drKeys=required,status,performedBy,confidenceWeight,requiresExternalReview,findings,template,note,at,artifacts`；**无 `tier`、无 `evidence`**；`status=cleared`、`performedBy="self-play(claude critic) + agent adjudication"` | 读 `.ccg/reviews/fff39f5b31e2b9cf7b267fb905d963b524d133c38716521e44b7a65e7d094e50.json` |
| `findings` 每条的键 | `id \| severity \| verdict \| title \| evidence`（同产物，6 条） | 同上 |
| 判据入口的可注入性 | `evaluate()` 入参纯数据；CLI 已支持 `--statuses=<json>`；`evaluateDeepReviewDebt(statuses, repo, readAtBase, existsAt)` 后两参是注入的读取器 | `check-pr-exec-record.js:256 / :29 / :991` |
| 决策层入口 | `judge(staged)` 返回 `{mode, reason, stats}`，`stats` 已含 `sensitivePathHits` / `plannedPathHits` / `sensitiveContentHits` | `ccg-review-decider.js:532 / :646-669` |

**§1 里有两条读数本身就是本 change 的论据**，必须单独说：

- **以 `tier=self-play` 收口的产物今天就有 40 条**。它们每一条都不具备高危面资格（链条见 §2）。
  这不是设想的边界，是主干上的存量。
- **"产物有多少枚"这一个问题有两个答案**（1975 与 1980），差 5 枚，成因**本会话没有取证**。
  ⇒ 这恰好是 D3 要解决的那类事的微缩版：**同一个数由不同口径的探针产出，而口径没跟着数字一起记录**。
  所以 §5.1 规定语料条目 MUST 连"这个数是谁算的"一起存（`recordedBy` = 产出该读数的命令 + 判据 blob sha），
  不得只存裸数。

**§1 最重要的一条是倒数第二、三行的不对称**，它决定了本 change 的实现量：

- **决策层**（decider）**已经有结构化命中面**——`stats` 里那三栏 `*Hits` 就是"命中集"，重放只需要把 `judge()` 跑两遍比集合。
- **判据侧**（check-pr-exec-record）**只有散文**：`evaluate()` 与 `evaluateDeepReviewDebt()` 都返回
  `{reasons: [string]}`（`check-pr-exec-record.js:387 / :1083 / :1232`）。reasons 里插了文件名、条数、时间戳。
  ⇒ **D3 在判据侧必须先补一个结构化 `hits` 出口**，否则"命中集"只能靠散文比对——
  而散文一改（本仓每周都改）就是成片假红，那台探测器会在两周内被当成噪声关掉。
  这是本 change 唯一一处**为可重放而做的生产改动**，且它是**新增并行字段**、不动 `reasons`，
  所以不碰现有 CI 日志与既有测试的断言面。

## §2 病根的机械链（为什么"评审发现问题"必然卡死）

四环节逐条可复核，缺一环就不成立：

1. 高危面收口**只认** `tier=external` + 可核 `evidence`——判据本体
   `check-pr-exec-record.js:690`（`closureCorroboration` 只把 `tier==='external'`/`'external-unverified'` 当出处），
   以及 `:1178` / `:1193` 两条红文案（原文即"高危面……只认 tier=external + 可核 evidence，closureNote 在那一侧不够格"）。
2. `tier` 的唯一生产方是 `scripts/ccg-review-writeback.js`，其写入条件是**五条合取**
   （合同正文唯一真源：`openspec/changes/qm6-closure-writeback/specs/*/spec.md` 的「写入 MUST 同时满足五条」，
   本文**不复述**——复述就是造第三份事实，那片自己复发过一次）。其中一条把 `performedBy`
   钉成"必须等于本轮 `reviewBackends.critic`"。
3. 引擎在**仍有 Critical 未决**时降级自扮演，`performedBy` 写成 `self-play…`（§1 那枚产物就是现场形状）。
4. ⇒ 环节 2 的那条永不成立 ⇒ 环节 1 要求的出处**永远不会出现**。

**现场实证**：PR #4261 的 CI 里 required 格只有 `Gate 2b11 - QM-6 closure writeback chain` 红
（run `39847244091`，`gh run view 39847244091 --json jobs` 现取失败步骤名可复现），其余全绿。
红因就是本片要消的那条链打在它自己身上。tasks 11.7 登记的三个候选（a)/(b)/(c) 已逐条否证
（见 proposal 表），本 change 是第四种：**换判据的问句，不换出口的真值来源**。

## §3 顺序约束：探测器必须先于拆闸（本 change 的第一约束）

```
D3（探测器：判据变宽当场可复现地红）   ← 必须先上线
        ↓
D1（把"谁签字"换成"每条意见的处置凭证"）← 才允许把高危面 Critical 的转拦打开
```

**为什么不可并行成一轮**：人工过目这道闸门今天承担的职责，不是"审内容"，
而是"**没有任何东西能发现判据被改宽**"的唯一补偿。D1 单独落地时，
`HIGH_RISK_SURFACES` 的十条、`tier` 的闭集、写回器的五条合取**全部失去看守**——
那不是零人工，是零看守。D3 落地后，"改宽"这件事的产物形态从"没人看得见"变成
"重放一遍必红且点名一条真实历史案例"，此时撤掉人工闸门才是**等价替换**。

⇒ 本 change 的交付顺序写进 tasks：**第 3 刀全部转拦完成后，第 1 刀的 `unsupported`/`accepted-risk`
在高危面上才从"留痕"改为"拦"**。这一条本身由 `check-unwired-tests.js` 之外的一把新锁守
（tasks 1.4：把"转拦开关必须依赖 D3 已在 CI 上跑过"做成判据自证，见 §6.3）。

## §4 D1 设计：`resolution` 是封闭分档 + 按档凭证

### 4.1 为什么加在 finding 层而不是记录层

`closureNote` 是**记录级**自由文本，本仓已给它加了结构判据（`isStructuredClosureNote`），
但它对"六条意见里有一条没处置"完全失明——实测产物有 6 条 findings（§1），记录级一句话可以盖住任意多条。
`verdict` 是**评审方对这条意见的裁决**，不是**本仓对这条意见的处置**。
⇒ 处置必须逐条落，键名与 `verdict` 分开（新增 `resolution`），否则两个语义挤一个字段，
下一个会话无法判断该读哪个。

### 4.2 四档的凭证形状（全部可机械核）

```
resolution: {
  kind: 'code-fix' | 'false-positive' | 'deferred' | 'unsupported' | 'accepted-risk',
  // kind=code-fix 时必填，其余档 MUST NOT 出现（缺席/野值分两档，见 4.3）
  redThenGreen: { lock: '<测试文件相对路径>', case: '<用例名片段>',
                  red:   { ranAt: '<ISO>', rc: <int>, matched: true },
                  green: { ranAt: '<ISO>', rc: 0, matched: true } },
  // kind=false-positive 时必填。**不新建否证登记**，只引用 #4297 的 `rebuttals[]`：
  rebuttalRef: { fingerprint: '<与 rebuttals[] 条目逐字相同的 finding 指纹>' },
  // kind=deferred 时必填
  task: { change: '<openspec change slug>', line: '<该行去掉前后空白后的逐字内容>' },
}
```

四条设计约束（不是风格选择）：

- **`false-positive` 的凭证不在本 change 里定义**。#4297 已经立了一条 Requirement
  「一条被 `dismissed` 的争议 MUST 携带可核证据（`文件:行号` 或可重跑命令）才能进 `rebuttals[]`」，
  且它的 spec 明文写着"本 change 不得改变什么算闭合"——**本 change 正是它留议的那第 1 条**。
  所以 D1 只加一条判据：`kind=false-positive` 的 `rebuttalRef.fingerprint` **必须在同一条记录的
  `rebuttals[]` 里命中**，命中不到 ⇒ `dangling-rebuttal-ref`（新档，一律拦）。
  **MUST NOT** 在本 change 再写一份"否证需要什么证据"的规则——两份证据要求必然漂移，
  而漂移的表现是"在 A 表里合规、在 B 表里不合规"，正是本仓反复定性的第二份事实。

- **`redThenGreen` 存的是"跑过两次"的读数，不是"我保证红过"**。本仓对"声明与字节不同源"有实测事故
  （`qm6-closure-writeback` 的 tasks 0.1 记的就是勾选全真、但在没进 git 的工作树里）。
  所以 D1 的凭证**必须能重放**：判据在**有依赖的那一档**按 `lock`+`case` 跑一次绿色；
  红色一侧**不重放**（重放要改回旧实现，成本落在每个 PR 上），而是要求
  `red.rc !== 0` 且 `red.matched === true`，并把"这两个字段被人手工改成任意值"这一档**如实承认为残余**（§6.2）。
  ⚠ **重放不是到处都能做**：CI 的 `changes` 作业不装依赖（AGENTS 明文「接进 changes job 的锁只能 require node 内置模块」），
  而绝大多数回归锁是 vitest。所以判据 MUST 有第三档 `rerun-unavailable` 并按**未证实**处理（合同见 spec 的
  「跑不了必须写成跑不了」场景）。把"当场重跑"写成无条件 MUST，就是要求 CI 打印一句假话——
  这是本设计初稿的一处自相矛盾，写 spec 时被仓内既有约束否证后改的，不是修辞。
- **`deferred` 的锚点取"行的逐字内容"而不是行号**。理由与本仓 ledger 的同一教训一致
  （AGENTS：`line` 指针在追加型载体上"结构上必然过期"，2026-10-19 实测 9 条 line 中 0 条仍指向自己的行）。
- **`code-fix` 与 `false-positive` 不得互转**。一条意见从"我改了"改成"你说错了"是收口动作里最省事的逃逸路径，
  因此跨档变更必须由语料侧（D3）看见——该 finding 的旧命中集里有一条 `disposition:code-fix`，
  新读数是 `disposition:false-positive` ⇒ 计数变化进覆盖棘轮（§5.4）。

### 4.3 与既有判据词表的关系（闭集必须分"缺席"与"野值"两档）

`kind` 走本仓既有口径：**闭集含缺席档**。`resolution` 整段缺失 ⇒ `absent`（新产物还没有这个键是常态，
§1 那枚产物的 `drKeys` 连 `tier` 都没有）；`kind` 存在但不在五值里 ⇒ `unrecognized`，**一律拦**——
拼错、写成数字、写成对象都算。这条分档不是抄现有风格，是因为 `EVIDENCE_TIERS` 那段注释记过实测：
把缺席和野值混成一档 ⇒ "每条新产物都被判不认识，而合规出口又只能手写"（`check-pr-exec-record.js:740-745` 附近）。

**首批只转拦两格**：高危面上 `kind ∈ {unsupported, accepted-risk}` ⇒ 红。其余档先只出声（`RESOLUTION-CENSUS` 行），
转拦条件按 §3 的顺序锁在 D3 之后。

## §5 D3 设计：语料、命中集、超集判据、覆盖棘轮

### 5.1 语料条目（一条 = 一个真实历史案例的输入面 + 旧读数）

```
{"id":"corpus-<seq>-<pr>","source":{"pr":4261,"merge":"<sha>","record":"openspec/records/<branch>.md"},
 "input":{"statuses":[...],                 // 逐字取自 merge-base..merge 的 porcelain，可直接喂 --statuses
          "headBranch":"qm6-gate-surface-parity","branchSource":"arg","remoteBranches":[...],
          "artifacts":[{"path":".ccg/reviews/<sha>.json","json":{...}}],   // 产物整体存，重放时由注入的 existsAt/readAtBase 供
          "staged":{"files":[...],"proposal":false}},
 "recorded":{"judge":"<base blob 的 sha256>",
             "hits":{"exec":["no-record","dual-debt:xxx"], "decider":{"mode":"dual","sensitivePathHits":[...]}},
             // 数字必须连着"是谁算的"一起存。动因是 §1 现场撞到的那两件：
             // 普查工具报 1975 而 git ls-tree 报 1980（同一目录、两个口径）；
             // 同一条分位数命令隔 25 秒从 p90=10.11h 变 7.92h（窗口随主干前进）。
             "recordedBy":[{"metric":"exec-hits","command":"node scripts/check-qm6-judgment-regression.js --replay-only=<id>","ref":"origin/main@<9位>"},
                            {"metric":"decider-mode","command":"node scripts/ccg-review-decider.js --dry-run","ref":"origin/main@<9位>"}]},
 "coverage":{"surface:scripts/check-":3, "tier:external":1, "conj:3-backend-equal":2}}
```

**为什么存输入面而不是存结论**：存结论就是"快照比对"，实现一改必然全量红，那种锁的第一周就会被放宽。
存输入面 ⇒ 旧判据和新判据**都真跑一遍**，"变宽"与"改了文案"是两种读数，天然可分。
这条选择的可行性由 §1 最后一行背书（注入 seam 已存在）。

### 5.2 命中集（`hits`）的定义——这是本设计的核心，也是 D1/D3 唯一的共用面

三个入口各给一个**规范化集合**，全部由判据**自己**产出，不由重放器猜：

| 入口 | 命中集内容 | 现在有没有 |
| --- | --- | --- |
| `evaluate()`（记录/豁免面） | 每条命中的规则 id（新增并行出口 `hits: string[]`，`reasons` 原样不动） | **没有** ⇒ D3-T1 要补 |
| `evaluateDeepReviewDebt()`（收口矩阵面） | 同上，且矩阵里每条"点名为欠账"的规则有独立 id | **没有** ⇒ D3-T1 要补 |
| `judge()`（决策层） | `{mode}  ∪  stats.sensitivePathHits  ∪  stats.plannedPathHits  ∪  {sensitive-content-count>0}` | **已有**（§1）⇒ 直接用 |

规则 id 必须是**一个封闭常量登记表**（`QJ_RULES`，导出），不是散落字符串。理由：
登记表为空/解析退化时判据必须能自证（本仓反复的同型事故——"迭代域为空 ⇒ 零命中读起来像通过"）。
⇒ 判据首行必须打印 `JUDGMENT-RULES registered=<n> corpus-cases=<n>`，两个数任一为 0 一律 rc=2（判据自身故障档），
**不得**把工具失明读成"没有变宽"。

### 5.3 超集判据

对每条语料：`hits_new ⊇ hits_old`。

- 任一 `h ∈ hits_old 且 h ∉ hits_new` ⇒ **红**，点名 `corpus id` + `source.pr` + 那条 `h`。
  这条语料是一次**真实历史事故**，所以红文案里给的复现命令能直接重跑——这是它比人工 review 强的地方：
  人能忘，语料不能。
- `hits_new ⊃ hits_old`（新命中更多）**不红**。收紧永远放行。
- 输入面里某条产物**读不到**（对象被 GC、路径改名）⇒ 该条记 `unverified` 并计入读数行，
  **不得**当成"这条没变宽"。这是 §3 那条"失明不得读成结论"的直接应用。

### 5.4 覆盖计数棘轮（闭掉"追加只增"防不住的那一格）

"只可追加"防批量删，防不住删一条"看起来没人依赖"的。所以再加**一条独立判据**：

- 每条语料在录制时算出 `coverage`：每个守门维度（逐个高危面前缀、`tier` 各档、写回器五条合取的每条、
  `resolution.kind` 各档）在这条语料上**被真正行使过**的计数。
- 全语料的 `coverage` 求和 ⇒ 每个维度的覆盖数。判据要求**任何维度的覆盖数都不得下降**。
- 于是"删掉唯一覆盖 `surface:scripts/check-` 的那三条案例"因该维度计数从 3 掉到 0 而红，
  即使语料总条数仍满足下限。
- **新增维度的初始覆盖数必须 > 0**（不允许登记一条零覆盖规则就当"已登记"）——
  这条堵住"新守门规则先挂名、以后补案例"的空头支票。

`coverage` 因此不是可选元数据；它和 `hits` 是**两个正交判据**：`hits` 防"改了判据"，`coverage` 防"改了语料"。
只写前者会留一格——那一格恰好是"看起来最无害"的操作。

### 5.5 旧判据那一份实现从哪来（不新增构建产物）

沿用本仓既有注入路（`ccg-review-decider.test.js:1269` 的注释就写明了这条路）：
`git show <base>:scripts/check-pr-exec-record.js` → 剥末尾 `process.exit` → `_compile` 注入 `module.exports`。
`recorded.judge` 存 base blob 的 sha256，用于**归因**（红文案能答"哪一版判据给的旧读数"），
不是用于**放行**——比对时永远取"PR base 那份 blob"，不取语料里存的数。

两条**当场核实过的可行性前提**（不是推断）：

- **重放器可以待在 CI 的 `changes` 作业里**：`check-pr-exec-record.js:32-38` 与
  `ccg-review-decider.js:30-36` 的 require 全部是 node 内置（`fs`/`path`/`child_process`/`crypto`）
  加仓内 `./classify-docs-only.js`、`./lib/ccg-delivery-digest.js`、`./lib/ccg-review-backends.js`，
  **零第三方依赖** ⇒ 满足 AGENTS「接进 changes job 的锁只能 require node 内置模块」那条硬约束。
  （对照：D1 的 `code-fix` 绿侧重跑**不满足**这条，因此它必须分档，见 §4.2 末注。）
- **`git show <base>:<file>` 要求检出里能看到 base**：`actions/checkout` 默认浅检出会让这条取不到 blob，
  而"取不到"在超集判据里长得完全像"没有变宽"。⇒ 判据 MUST 先自证 base blob 可读
  （读不到 ⇒ 全量落 `unverified` 并 rc=2），接线任务（tasks 2.5）必须带上检出深度这一项。

### 5.6 自检脚本站在同一条陷阱上（本会话现场撞到的，写下来因为形状会复发）

写 §1 那张引用核对脚本时，"裸文件名 → 仓内路径"的解析把 `check-pr-exec-record.js`
指到了 `.agent_context/worktree-archive-*/scripts/` 下的**归档副本**（330 行），
于是把 `scripts/` 里那份真文件（1318 行）的合法行号报成"越界"。
⇒ 任何按 basename 在仓库里找实现的探针，都会先撞上归档/vendored 副本；
判据必须**先按 `git ls-files` 限定受管路径**，或干脆要求引用带目录前缀。
这不是工具小毛病：本 change 的整个动机就是"探针读错了对象而读数看起来完全正常"。

## §6 闭合边界（这台探测器能挡什么、不能挡什么）

### 6.1 能挡

| 攻击形态 | 为什么挡得住 |
| --- | --- |
| 把前缀 `scripts/check-` 改窄 | 该维度 `hits` 在某条真实案例上从命中变不命中 ⇒ 超集判据红 |
| 把 `tier=external` 的判据放宽（例如接受自由文本 evidence） | `evidence` 形态判据的命中集变化在案例上可见 |
| 删掉语料里"没人依赖"的一条 | 覆盖计数棘轮红（§5.4） |
| 新增一条零覆盖的守门规则 | 新维度初始覆盖数必须 > 0 |
| 探针自身失效（解析退化、语料为空） | `registered=0` 或 `corpus-cases=0` ⇒ rc=2 未证实档，不放行 |

### 6.2 挡不住（如实写，不假装已闭合）

- **手工伪造 `redThenGreen` 的两个 rc**：§4.2 明写这是承认的残余。缓解只有一条且不依赖人——
  绿色一侧**判据自己当场重跑**，所以能伪造的只有红色一侧；因此 D1 把"红色一侧是手填的"这件事
  写进产物的 `manualFields`，普查工具单列一档读数。**不得**声称这一档已被机器闭合。
- **LLM 判据漂移**（换模型 / 改 prompt / 改严重度口径）：D3 的超集判据只对仓内机械判据成立。
  落在第 5 刀（不做），因此本 change 之后"评审质量下降"仍然只能靠人工，必须如实读。
- **语料种子由谁录**：首批 205 笔 PR（本日现跑，活数）的录制脚本是机械的，但"哪些案例值得录"是判断。
  本 change 采取**全量录制**（凡变更集命中守门面的已合并 PR 一律进语料），用规模换掉这个判断；
  代价是语料条数与重放时长，见 §7。
- **自指**：D3 的判据文件自身落在 `scripts/check-` 面上。它守别人，别人守不了它自己。
  本 change 的处置是**把 D3 的判据本体也做成语料的一个维度**（`coverage` 里出现 `probe:self-test` 计数），
  并保留一条事实：这条只能证明"改动被重放复现过"，不能证明"改得对"。

### 6.3 顺序锁的自证

D1 的"转拦"必须依赖"D3 已在 CI 上跑过且有读数"。这一条不能只写在文档里（写在文档里的顺序约束
是本项目反复失效的那类：靠临场自觉）。落法是 D3 每次运行写一条**可核指针**
（`openspec/changes/<change>/judgment-replay-runs.json`，记录 `headSha` 与 `registered`/`corpus-cases`；
 落点选它而不是 `scripts/` 或 `.ccg/` 的理由见 §0 继承约束 2——**pre-commit 的暂存 glob 不收 `.ccg` 子目录**，
 而 `scripts/` 是所有会话共用的追加型写面，正是本仓热写面竞态的那一格），
D1 的转拦分支读它：取不到 ⇒ **按未证实处理，维持留痕档并点名原因**。
这样"顺序"是数据依赖，不是纪律。

## §7 成本与优化

| 场景 | 成本 | 优化手段（都写进 tasks，不是愿望） |
| --- | --- | --- |
| 普通 PR（不碰守门面） | **零**：D3 由 `changes` 作业里的守门面命中选择集门控 | 选择集 = `highRiskPrefixOf` 命中数 > 0；命中为 0 时只打印 `SKIPPED(no-surface-hit)` |
| 改判据的 PR | 全量重放：40 条 ≈ **5 分钟串行**（本日早前实测，属待重取档） | ① 并行（按 corpus id 分片，无共享状态）；② 缓存键 `(<judge blob sha256>, <corpus id>)`，同一版判据重复跑零成本；③ **只跑受影响维度**：diff 只碰某个前缀 ⇒ 覆盖数非 0 的维度才进重放集 |
| 判据自身测试 | 193s（实测） | D3 的锁独立成文件，不并进 193s 那条；接线走 `changes` 作业（秒级档） |
| 预算倒挂风险 | — | 重放总预算必须 **小于** CI job 超时，且每次打印 `elapsed=`（本仓「等待预算按相位拆分」那条 MUST 的同一族） |

**净效果**（与现状相比，口径是增量不是总量）：不加人工步骤；改判据的提交多 1–5 分钟；
处置一条严重意见多一次"红→绿"重跑（这个动作本仓今天已经在做，只是不留痕）。
今天真正的成本在别处：**PR 交付 p50 1.54h、p90 7.92h**（本日两次实测的现值，两组数与漂移都记在 proposal 成本表），
主导项是等外部评审与等 CI，不是等闸门变严。

## §8 回退策略

1. D3 全量重放超时或退化为不可用：**降级为选择集重放**（只跑 diff 命中的前缀），
   不删判据、不调阈值；降级必须打印 `DEGRADED(scope=...)`，且降级态下**不解除 D1 的转拦**（否则§3 的顺序锁被绕过）。
2. D1 的 `resolution` 形状判据把历史产物全判野值：`resolution` 整段**缺席**属 `absent` 档、不拦（§4.3），
   所以这条不会发生；若发生说明 `absent` 判据被写错，按"门禁撞异常输出先查源头"处理，**不得**加白名单。
3. 语料里存了一条含凭证缺失的历史产物：加 `exemptAbsentBefore=<ISO>` 一条显式承认项，
   且该承认项**只能缩小**、必须带实测出处（沿用 `KNOWN_UNWIRED` 那套只可缩小的口径）。

## §9 明确不做与理由

| 不做 | 理由（不是"以后再说"） |
| --- | --- |
| 第 4 刀：跨家族共识自动组装 | 要求同一实例跑两个后端。**三个数我没量到、也拒绝写进文档当依据**：① 单轮各后端真实墙钟（现有记录只有时长断言没有分布）；② 语料规模—时长曲线（5 分钟是 40 条单点，不外推）；③ 跨家族对同一条 finding 的不一致率。没有③ 就无法判断"共识"是不是恒等于"两个都不否决"——那可能只是把假阳率乘了一次。 |
| 第 5 刀：严重度夹具集 + prompt 进守门面 | LLM 输出不可重放，进不了 §5.3 的超集判据；硬进就是把判据降级成散文比对。它需要另一套判据（夹具 + 版本锚），属独立 change。 |
| 第 6 刀：统计异常自动收紧（自动 park PR） | 依赖第 4、5 刀的数据面。现在做等于用未校准的分布去拦人。 |
| tasks 11.6（把 `scripts/lib/ccg-delivery-digest.js` / `main-red.js` / `merge-ledger.js` / `gate-timeout-registry.js` 收进守门面） | 那是**扩表**，属"改谁来守门"，须人工过目；本 change 若顺手做，评审焦点会从"零人工怎么做"漂到"这 4 个库该不该守"。分开走。 |
| 改 `HIGH_RISK_SURFACES` 的内容 | 同上。D3 给现有 10 条装探测器，一条不加、一条不减。 |
