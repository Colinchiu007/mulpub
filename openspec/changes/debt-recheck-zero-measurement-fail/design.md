## D1 归因粒度必须等于「可被修复的那个单位」

现状把三件不同的事写进同一个 `worktree-setup`：seam 没装配（工具自己的代码问题）、`git commit-tree` 失败、`git worktree add` 失败。这三者的**修法完全不同**（补注入 / 补身份或参数 / 补检出形态），共用一个档名等于让读日志的人从结论倒推原因。

拆成三个档，且**旧名不改语义**：`worktree-setup` 继续只表示"seam 没装配好"（`evaluatePr` 第 71 行那条出口），真 git 的两个阶段新增 `merge-commit-failed` / `merge-worktree-failed`。这样切片 C 记录里"缺 commitTree/worktreeAdd/runChecker 任一 ⇒ 归 `worktree-setup`，不得归成 conflict"那句既有合同仍然成立。

`mergedTreeEvidence`（构造合并态、从不判决的那条）同步改，保持两条路档位同源——它是集成用例走的路，若两路边数不一致，"同一件事在两个函数里叫不同名字"就是下一个会话的坑。

映射表（设计评审 i1/i6 要求逐字写出来，不许只说"同步改"）：

| 失败单位 | `stage` | `reason` | 归类 |
|---|---|---|---|
| seam 未装配（缺 commitTree/worktreeAdd/runChecker 任一） | `seam` | `worktree-setup` | tool-fault |
| `git commit-tree` 非零或回显不是 oid | `commit-tree` | `merge-commit-failed` | tool-fault |
| `git worktree add` 非零或没返回目录 | `worktree-add` | `merge-worktree-failed` | tool-fault |
| merge-tree 报 CONFLICT | — | `conflict` | other-pr |
| 浅历史 / 取不到 ref / 回显看不懂 | — | `unrelated-histories` / `ref-missing` / `unknown-shape` | tool-fault |

**新增档名必须同时进 `REASON_CLASS`**（i1 命中的正是这一格：D1 说了拆档，D2 没说表要跟着长）。这条不是文档纪律，是机械判据——`UNJUDGEABLE_REASONS` 由表派生，测试断言"三档名都在词表里且都属故障档"，漏登记当场红。

## D2 故障归类只准有一处真源

`REASON_CLASS` 是 `{ reason: 'tool-fault' | 'other-pr' }` 一张表，`UNJUDGEABLE_REASONS = Object.keys(REASON_CLASS)`，`TOOL_FAULT_REASONS = keys.filter(fault)`。配一条判据：表里每个值必须落在这两个档之一，否则红（值写错 = 该档既不算故障也不算别人的 PR ⇒ 会静默退 0）。

为什么这不是"把 3 档名单改成 5 档名单"就完事：漏一档的原因就是**名单抄了两遍**。只补 `worktree-setup` 进 `TOOL_FAULT_REASONS` 是同一缺陷的下一版——第六档照样会漏。派生 + 闭集校验把"忘了归类"从"没人会发现的静默放行"变成"当场红"。

## D3 退出码：结构不变式，外加一条刻意的窄出口

主判据不看名单是否完备，只看计数。**术语先定义清楚**（设计评审 i3 命中：原文没写 conflict 算不算进 rows，混合轮因此有歧义）：

- `rows` = 本轮拿到的**全部**条目（含 conflict，它就是"一笔待重算的 open PR"的读数）；
- `measured` = `IN_BASELINE + VIOLATES`（唯一算"量到了"的两档；conflict/工具故障/判据崩溃都不算）；
- `allConflict` = rows>0 且**每一条**都是 `UNJUDGEABLE/conflict`。

```
exitCode != 0  ⟺  存在 tool-fault 行  ∨  (rows > 0 ∧ measured = 0 ∧ ¬allConflict)
```

两条子句不是冗余，各自的观测对象不同（这条由变异 M-D3 逼出来——第一轮它 MISSED，因为既有夹具的故障样本全是"整轮零测量"形状，"量到一笔 + 另一笔失明"的**混合轮**从未被表示过；补了「混合轮」用例后 M-D3 才指名红）：

- 第一句管**混合轮**：只要有一行是工具故障就非零，哪怕别的行量到了。半份结论不得写成完整判决，也不得往别人 PR 上写评论（`shouldComment` 同一判据）。
- 第二句管**verdict 面之外的失明**：整轮全 `CHECKER_FAILED` 时没有一行是 `UNJUDGEABLE`，故障名单按 verdict 筛就够不着它；这一句只看计数，所以名单不完备也拦得住。

**全 conflict 的一轮为什么仍退 0**（这条是对原报缺陷「零测量 ⇒ 非零」的收窄，属裁决，必须留着理由）：`conflict` 的含义是"这笔 PR 与主干真有冲突"，而 GitHub 在 `CONFLICTING` 状态下**根本不让合并**——陈旧绿进不了主干，本作业要防的那件事没有发生。把它判红会诱导人去"让它不红"（改评论、放宽判据），而不是解决什么。留痕仍然要给：打印 `MEASURED=0(all-conflict)`，让"这一轮一条都没量"在日志里看得见，与"量了且都在基线内"（`MEASURED>0`）两形态可区分。

`rows=0`（没有任何 open PR）仍退 0——这是既有语义，别改：它是"无事可做"，不是"没量到"。

## D4 `detail` 只取失败命令的首条非空 stderr，不取全文

取**该命令回显的首条非空行**、`stderr` 优先、`stdout` 兜底（设计评审 i4：`merge-tree` 的 CONFLICT 写在 stdout，只取 stderr 会在这一格拿到空串），截 **200** 字符并落进条目的 `detail`，随逐条日志与评论表格一起出来——**下一轮自动运行会自己说出口**，不需要人去猜。为什么不放全文：评论是写给别人 PR 的，多行原文会把别人的 PR 页面刷成长帖；而 git 的报错首行就是结论（`fatal: …`）。为什么必须放：本次运行的日志里没有任何 git 原文，导致"CI 上哪一步坏了"到现在未证实——这是本刀唯一能立刻消灭的失明。

还有一条是实现时才看见的：`live()` 的**默认闭包**原先 `return { rc, commitOid }`，不带 `stderr`。也就是说即便判决侧开始读 `detail`，生产那条路仍会拿到空串——"可归因"这句话只在注入面成立。因此透传本身由一条独立用例锁住（测试 §29），变异是把 `stderr` 字段摘掉（M-D9），必须指名红。

同时不改判：拿到 `detail` 之后根因仍要另起一轮修（见「不做」）。

## D5 生产默认装配必须有一条锁（替身掩盖接线缺口）

`live()` 的四个 seam 都有默认实现（真 git / 真 spawn 判据），而现有 25 条锁**全部**注入假实现。后果：默认闭包里任何笔误——`path.join(d,'scripts','check-debt-budget.js')` 拼错、`commit-tree` 少传一个 `-p`、`worktree add` 参数顺序错——测试面完全看不见，只能在 CI 上以"整轮零测量"的形态显形（这次就是这么发生的）。

新增用例的形态：只注入 `gh`（网络面必须假，本仓 `network-egress-guard` 会拦真出站）与 `repoDir`（`os.tmpdir()` 下真建一个 git 仓库，含 `scripts/check-debt-budget.js` 的**桩**——桩的是被消费的判据，不是本函数的 seam），`classify/commitTree/worktreeAdd/runChecker` 一律不注入，断言：

- 真跑完 merge-tree → commit-tree → worktree add → 真 `spawn(process.execPath, ...)`；
- 结论档位是 `IN_BASELINE`/`VIOLATES` 之一（即真的量到了），不是任何 `UNJUDGEABLE`；
- 该用例必须能抓住"把默认 `runChecker` 的路径改错一个字母"这一变异（改名后条目变 `UNJUDGEABLE/merge-worktree-failed` 或 `CHECKER_FAILED`，绝不静默变绿）。

夹具注意两条：① 临时仓库的 `GIT_DIR` 不得泄漏到进程 env（本仓记过「夹具读到别人的仓」的同型事故），一律 `repoDir` 显式传 + `-C`，并在用例里先断言 `rev-parse` 落在这个克隆上；② 夹具**曾**显式 `git config user.email/user.name`（设计评审 i2 命中：不声明身份时用例会因环境失败而报错误的原因）——实现评审 i5 之后这一条被反过来加强了：夹具现在**摘光一切身份来源**（仓库不配、`GIT_CONFIG_GLOBAL`/`SYSTEM` 指空文件、清 author/committer env）再跑默认链，于是"CI 上没有身份"那一格从不可表示变成可表示，见 D9。

## D6 拆分：撞的是 max-lines 红线，正解是拆结构而不是上调 targets

加完归因与退出码判据后 `scripts/check-debt-recheck.js` 到 **503 行**，而 `.github/scripts/check-max-lines.js` 的 `limit=500` 按 **git 索引**取域——本地跑还是绿的，`git add` 之后就会红（这个顺序差本身要记住：判据读索引 blob，不看工作树）。既有裁决（项目记忆 `max-lines-target-grew-split-not-raise`）是**拆结构**，不调基线、不登记挂账。

按**依赖形态**切三份，方向是 core ← live ← cli，无循环 require：

| 文件 | 装什么 | 为什么这样切 |
|---|---|---|
| `scripts/lib/debt-recheck-core.js` | 词表/归类、`classifyMergeTree`、`evaluatePr`、`summarize`、`measurementLine`、`renderComment`、`findMarkerComment`、`blockingGateInputs` | 零 IO、零 env ⇒ 每条决策都能在单测里逐档验证 |
| `scripts/lib/debt-recheck-live.js` | `gitSafeEnv`/`gitRunner`/`mergedTreeEvidence`/`live`/门闩与预算 | 真 git、真 gh、真 spawn 全在一处，默认闭包只有一份可读 |
| `scripts/check-debt-recheck.js` | CLI 门面 + `main()`，对外名字与拆分前一致 | workflow 的调用面不变（仍是 `node scripts/check-debt-recheck.js --live`） |

**一条必须同改的连带，而且它当场显形了**：所有"读源码"的结构锁，扫描域从 1 个文件变成 3 个。拆完第一跑，「重算脚本里不得出现任何债务指标名」那条锁**绿得毫无道理**——入口只剩 41 行，它扫的东西少了 460 行，判据退化成恒真。这不是假设，是同一次实跑的读数。正解是 `toolSources()`：三份拼起来扫，并对每份字节数与总行数做**下界断言**（规模塌陷意味着有整块实现被删掉而不是被搬走）。同族教训：凡按"这里有什么"迭代的门禁，永远看不见"该有什么"。

拆分零行为改动有两条证据，不靠"看起来一样"：① 用例在拆前拆后都全绿（拆前 34/34，拆后同一条命令跑）；② 抽取的四个区间**逐字节**出现在新文件里（探针报 `verbatim=true`），顶层声明名集合无缺失。

## D7 环境卫生（设计评审 i5，落码）

hazard 不是推演，是五格探针实测（两个临时仓库，各自有一个独有的提交主题）：

| 格 | 形态 | 被测仓库 |
|---|---|---|
| G1 | `cwd=A`、无 `-C`、env 带 `GIT_DIR=B/.git` | **B** |
| G2 | `git -C A`、env 带 `GIT_DIR=B/.git` | **B** |
| G3 | G2 再叠 `GIT_WORK_TREE=A` | **B** |
| G4 | `git -C A`、干净 env（对照） | A |
| G5 | `cwd=A`、干净 env（对照） | A |

两条口径由此定下：

1. **`-C` 挡不住 `GIT_DIR`**，所以只传 `repoDir` 不够，必须把这三个键从子进程 env 里剔掉；其余 env 原样带着（全清会让 git 连自己的配置都读不到）。
2. **验证"仓库归属"的锁不得用路径判据**：同一现场里 `--show-toplevel` 仍回 A，而内容判据（提交主题）回 B。拿 toplevel 写这条锁会得到一条恒真断言——这正是"写得像修好的"那种判据，字符串/路径看着对，量的不是那件事。

处置：`gitSafeEnv()` + `gitRunner(repo, notice)` **每次调用**取 env（第一版在建 runner 时快照，「告警侧」用例当场红：宿主可能在工具跑起来之后才带上变量，快照式剔除漏掉那一格——是测试纠正了实现顺序）；剔除时 `envDefectNotice` 出声一次（静默剔除会让"这台机器的环境一直有问题"永远不被知道，与 `ELECTRON_RUN_AS_NODE` 同口径）。同一份卫生也必须传进 `runChecker` 的子进程：判据本体自己跑 `git ls-files` 取域，泄漏时"在合并态里测量"这句前提会被静默换成"在别人的仓库里测量"。

## D8 设计层评审的处置（critic=claude 交付 7 条；proposer 轴未交付）

`sh scripts/plan-review.sh <方案> --force` 真跑（判定 SINGLE：方案 30 行、无敏感命中；critic=claude）交付 **3 Critical / 2 Warning / 2 Info**。逐条先取证再处置：

| 条 | 严重度 | 处置 | 落点 |
|---|---|---|---|
| i1 | Critical | **采纳**：D1 说了拆档，D2/D1 都没写"表必须跟着长"。这正是本次事故的形状（名单两抄、漏一档）。补映射表 + 派生判据（词表由表来），漏登记当场红 | D1 表、测试 §25 |
| i2 | Critical | **采纳**：夹具不声明身份 ⇒ 用例会因环境失败而**报错误的原因**。已在实现里显式 `git config`，并把代价写进 D5（该锁因此证不了 CI 缺身份那一格） | D5、测试 §27 注释 |
| i3 | Critical | **采纳**：`rows` 是否含 conflict 未定义 ⇒ 混合轮有歧义。D3 补三条定义，并新增「混合轮」用例 | D3、测试 §23b |
| i4 | Warning | **部分采纳**：`stderr` 优先、`stdout` 兜底与 200 截断**实现里本来就有**（`excerptOf`），文档没写才算缺；多行原文刻意不进评论（理由在 D4） | D4 |
| i5 | Warning | **采纳并落码**：探针实测 `-C` 挡不住 `GIT_DIR`。剔三键 + 每次调用取 env + 出声一次，行为锁带对照格 | D7、测试 §28 |
| i6 | Info | **采纳**：映射表逐字写出（同一张表也堵住"只改一条路"的边数漂移） | D1 |
| i7 | Info | **采纳**：跟进机制落在执行记录的「遗留」与合并后 `workflow_dispatch` 一次真重算（见 D11） | 记录、D11 |

**proposer=opencode 那一轴未交付**：引擎在跨家族校验那一步把方案回投给 opencode 时被后端**输入上限 7800 字符**拒（方案 7871 字符，长度构成里角色提示占 147），且拒绝是 exit 1、零错误信息。⇒ 设计层实质单后端。按既有裁决「认单轴，合并并把缺轴登记为欠账」，欠账记在 D9 与执行记录，不把它写成"双模型已覆盖"。

## D9 实现层评审把"身份"从假设变成已证的依赖（i5 采纳）

设计阶段我把"runner 上没配 git 身份 ⇒ `commit-tree` 失败"列为**未证实候选**。实现层评审（同一后端 claude，独立命中）把它推到可测：本机三格探针（仓库不配身份 + `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` 指空文件 + 清掉 author/committer env）——

| 现场 | 裸 `git commit-tree` | 带 `-c user.name/-c user.email` |
|---|---|---|
| 无任何身份来源 | **rc=128 / `Author identity unknown`** | rc=0 |
| 干净 env（对照） | rc=0（宿主全局配置里有身份） | rc=0 |

两条结论，各自都有落点：

1. **`commit-tree` 硬依赖 committer 身份**，而"合成一个临时 merge 提交"这件事**不需要任何人类身份**——所以这是本工具的一条**未声明环境依赖**。修法是显式 `-c`（只作用于本次调用，不写配置、不改别人的仓库），两处 `commit-tree`（判决那条路与构造那条路）挂同一份 `SYNTHETIC_IDENTITY` 常量。这不是"赌根因"：身份在不在 runner 上都不影响正确性，而它把候选 ① 从诊断面上**删掉**了——下一次运行要么绿（说明那就是根因），要么红并带着 `detail` 说出别的原因。
2. **默认装配锁的现场因此升级**：`makeLiveWorld` 不再给克隆配身份，并在 `live()` 前后装卸"取不到任何身份"的 env。对照探针（同现场跑一次裸 `commit-tree`）**必须放在 env 还原之前**——第一版放在 `finally` 之后，宿主配置已经装回来，探针把自己的现场错位读成"这台机器能自造身份"，于是那条锁静默变成形式（这条坑当场被 §30 的断言抓到）。

`-c` 之外还有一条"为什么不全清 env"的裁决：`HOME`/`USERPROFILE` 刻意保留。清空它们会连 git 自身的合理配置一起丢，风险大于收益；正确姿势是**声明这条链真正依赖的那一样东西**，而不是试着隔离一切。

## D10 实现层评审第 1 轮的逐条处置

判定 DUAL（1268 行 > 200，`scripts/check-*` 属高危面），critic=claude 交付 8 条（2 Critical / 3 Warning / 3 Info），其中进入裁决的 5 条：

| 条 | 严重度 | 裁决 | 依据（可验证，不写"看起来没问题"） |
|---|---|---|---|
| i1 | Critical | **dismissed** | 它要求把 `deps.env`（旗标袋 `{MP_REPO:'o/r'}`）当子进程 env 传给 git ⇒ 与 §28 那条"其余 env 原样带着，全清会让 git 读不到自己的配置"正面冲突。它指的另一半（stderr 透传不全）**是真**，但落点在默认 `commitTree`/`worktreeAdd` 而非 `runChecker` ⇒ 已修 + §29 锁 + M-D9 指名红 |
| i2 | Critical | **upheld，不在本刀修** | 指控对象是评审链工具（proposer 轴被 7800 字符上限拒），本 diff 改不到；登记为独立一刀（design「残余」+ tasks 2.2 的缺轴声明），不写成"双模型已覆盖" |
| i3 | Warning | **dismissed（文档半采纳）** | 未登记档判 tool-fault 是**刻意的不对称**：它只会让这一轮更响，不会更静；反过来默认 `other-pr` 就复刻本次事故。升级协议补进 D2，非法归类由 `assertReasonClass` 在加载时抛 |
| i4 | Warning | **upheld，已改判据形态** | 字节/行数下界会把正常瘦身判成退化 ⇒ 换成"每层都有顶层声明 + `TOOL_DECLARATIONS` 名字集合齐全"，并由 M-D14（把扫描域缩回单文件）反证这条新判据有牙 |
| i5 | Warning | **upheld，已落码** | 见 D9。`-c` 身份 + 默认装配锁跑在无身份现场 + 对照探针放在 env 还原之前；结构侧断言两处 `commit-tree` 都挂同一份常量（漏一处=只修一半） |
| i6/i7/i8 | Info | i6 无动作；i7 **dismissed**、i8 **采纳** | i7 说混合轮的 conflict 被隐藏——同一轮 `summarizeLine` 已经打印 `UNJUDGEABLE=<n>` 且逐条日志每行都带档名与 detail，`measurementLine` 的职责只是"量到了几笔"，两个数分居相邻两行是刻意分工。i8 采纳：D9/记录里固定了下一次真实运行要读的三行格式 |

## D11 合并后的第一件事：让下一次真实运行把根因报出来


本刀落地后立刻 `workflow_dispatch` 一次重算（该 workflow 自带 `workflow_dispatch`），读它自己打印的 `verdict=…/<档名> :: <失败命令首行>`。三种可能各自对应不同的下一刀：

- `merge-commit-failed :: fatal: …ident…` ⇒ 是 committer 身份，修法是给 `commit-tree` 显式 `-c user.name/-c user.email`（**不是**给 CI 补全局配置——那会把脆弱前提留在 runner 上）。
- `merge-worktree-failed :: fatal: …` ⇒ 是 CI 检出形态，按原文另判。
- 全部 `conflict` ⇒ 本轮 `MEASURED=0(all-conflict)`、退 0，说明链路其实通了，剩下的只是别人真的都在跟主干冲突。

在此之前，"CI 上哪一步坏"这句话一律写**未证实**，不得用本机跑通去否证它（本机默认链实测能跑通：单笔含建仓 11.5 秒，见执行记录）。

## 残余（不假装已闭合）

- **CI 上"哪一步坏了"仍未证实，但候选 ① 已被摘掉**。原先列的三条候选里，"runner 缺 committer 身份"这一条已不再是假设也不是修复赌注：本机实测无身份时 `git commit-tree` rc=128 / `Author identity unknown`，而合成提交根本不需要人类身份 ⇒ 本刀让它自带 `-c` 身份（见 D9），于是**下一次运行的读数本身就是实验**：全 `conflict` 或量到了 ⇒ 那确实是根因；仍红并报出 `merge-worktree-failed :: <原文>` ⇒ 根因在别处。剩余候选：`worktree add` 在 CI 检出形态被拒；其它。
- **落地后这个非 required 作业会持续红**，直到根因那一刀进去。这是设计意图，但要在执行记录里写明，否则下一个会话会把它当成新引入的故障去"修绿"。
- 评论面（`MP_RECHECK_COMMENT="1"`）仍未启用，因此 CI 侧耗时与评论速率**依旧未测**；本轮新取的 13.3 秒只覆盖 fetch+merge，不覆盖判据执行。
- **两条评审链工具缺陷（本刀实测，另起一刀修）**：
  ① `deep-review.sh --force` 在**验证层**不生效——shell 入口只在 `MODE=skip 且未 force` 时早退（`:798`），但仓外引擎 `ccg-deep-review.js:985` 自己读到 `mode=skip` 又退一次，且**不认识 force**。现场：入口打印"判定为 S 复杂度低风险…退出 0"，rc=0。这是「跑完但零交付」的第 18 种形态：**看 rc 的人会以为审过了**。本轮改用 `plan-review.sh`（决策层）绕开，代价见 ②。
  ② `plan-review.sh` 的产物 slug 只取**方案文件名** ⇒ 与 OpenSpec 的固定文件名（`design.md` / `proposal.md`）结构性撞车：任何第二个 change 跑设计评审都会被碰撞守卫拒（拒时同样 rc=0）。守卫本身是对的（实测撞车目录里躺着别的会话 18:23 的评审现场，覆盖即销毁他人证据），但正解应是 slug 带上 change 目录维度。本轮把方案拷到 `%TEMP%` 换唯一文件名才跑起来——**代价是评审对象是一份快照**，之后对设计文档的改动不在那一轮里，最终版由实现层 dual 评审覆盖。
- **「混合轮」那一格是变异逼出来的，不是我先想到的**：M-D3（退出码只看零测量）第一轮在 34 条全绿里**没有对手** ⇒ 说明既有夹具的故障样本全是"整轮零测量"形状，判据的另一半从未被测到。补用例（§23b）后它才有牙。口径：变异 MISSED 时先怀疑夹具没表示出那一格，**不要**先判"这条判据多余"。
