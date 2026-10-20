---
| S10 | 现场（非评审预判） | MAJOR | 改 `listJobBlocks` 签名只按「我以为的调用点」验证，实际消费者并集里那份「与生产判据互证」的镜像锁被打断；此前一次清点的 `git grep` 被 `head -10` 截断，恰好把该文件削掉 | 已修：调用点补传 `domainFiles(root)`，`quality-rhythm-spec-mirror.test.js` 8/8 复绿；QM-5 ⑤ 第 ⑤ 条把「清点不得截断」写成口径 |
record: unwired-tests-git-domain
task: 把测试接线棘轮 check-unwired-tests 的判定域从磁盘遍历改成 git 的域，并消掉同一缺陷的反向（假绿）面
date: 2026-10-20
---

## 本次执行记录：测试接线棘轮的判定域改成 git 的域（unwired-tests-git-domain，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 混合 PR（改 CI 门禁脚本本体 `scripts/check-unwired-tests.js` + 其锁 + `.github/workflows/quality-gate.yml` 一行注释）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-unwired-tests-git-domain`、裸分支 `unwired-tests-git-domain`（`git rev-parse --abbrev-ref HEAD` 实证），基线 = `origin/main` 的 `280a8c9c0` |
| 第一性原因（QM-5 ①） | PASS | 判据把**「这台机器磁盘上现在有什么」当成了「仓库里有什么」**。两处枚举各自持有磁盘原语：测试与嵌套 workflow 用 `walkRepoFiles`（递归 `readdirSync` + 逐个目录名的 `PRUNE_DIRS`），"有哪些 workflow" 用 `fs.readdirSync(.github/workflows)`。这两者与 CI 检出态（= `git status` 口径）在**任何本机产物出现的那一刻**分叉。追溯：`826fa7e13`（PR #3782 bundle-untrack）把构建产物移出版本控制时只补了消费它们的 CI 作业，没问"任何自己扫磁盘的门禁"—— #3876 修了 `check-max-lines`、#3900 修了 `check-debt-budget`，本文件是同根因的**第三处**，且是最后一处（判据本体在 `scripts/`，域比前两者更大：它扫全仓） |
| 逃逸分析（QM-5 ②） | PASS | ① **上一轮的处置把补丁形态钉成了受保护形态**：`.agent_context` 那次给 `PRUNE_DIRS` 加了一条目录名，并加了一条常量钉死用例（"PRUNE_DIRS 必须含 .agent_context"）。它只防"有人摘掉那一条"，不防"下一类本机目录出现"—— 实测本轮就出现了第二例（`.adversarial/`），常量锁照绿。归类 断言不精确（锁住了打补丁的动作，没锁住"要不要打补丁"这个决策）；② 既有 33 条用例的夹具是**玩具目录**（`mkdtemp` + 写文件，不是 git 仓），对"域从哪里取"这个变量**结构性免疫**：磁盘实现与 git 实现在它上面给出的结论差别只由"我写了几个文件"决定，所以无论判据取哪一盘，用例都绿。归类 夹具不同形（与 AGENTS「断言 `git status` 干净度的测试夹具必须自己声明 EOL 档并把索引交给 checkout」同族）；③ **假绿方向零覆盖**：`readWorkflowText`/`listJobBlocks` 的目录枚举从来没有一条断言，所以"本机私产伪造接线"这个方向连测试意图都不存在。归类 测试场景缺失；④ 两条 fail-closed 断言写成 `/git\|工作树\|work tree/i`，而 `.github` 里就含 `git` 子串 ⇒ 恒真（变异 M3 实测：取域改成"失败返回空集"后它照绿，红的是别的两条）。归类 探针不能区分两种状态；⑤ **消费者并集没跑全**：把 `listJobBlocks(root)` 改成 `(root, domain)` 之后，`scripts/quality-rhythm-spec-mirror.test.js` 那条「与生产判据逐 job 互证」的锁在提交前的本地门禁电池里当场红（8 条里 1 条）。它没被预判的原因很具体：那次「全仓清点调用点」的 `git grep` 输出被我接了 `head -10` **截断**，而截断后的清单里恰好没有这个文件 ⇒ 归类 探针自身失明（AGENTS「凡「扫到 0」当完成判据，一律 `grep -na`」的同族新落点：不只是二进制要 `-a`，**清点结论不得被管道削掉**）。已修：调用点补传 `domainFiles(root)`，并把它列为 S10。 |
| 系统性漏洞定位（QM-5 ③） | PASS | 不是"某条用例漏写"，而是**判据自己持有枚举原语**：只要 `readdirSync` 在这个文件里，"域"就永远等于磁盘，任何按目录名/按前缀的收敛都是下游打补丁。落点 = 取域这一步必须由共享实现（`scripts/lib/git-domain.js`）持有，判据本体不得再出现递归目录枚举 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：① 删除 `walkRepoFiles` 与 `PRUNE_DIRS`（含两个导出键），新增 `domainFiles(root)`（一次取域，四条枚举共用）；② `listTestFiles(domain)` / `listNestedWorkflows(domain)` 改收域；③ 新增 `topLevelWorkflowPaths` + `workflowPathPairs` + `readWorkflowBody`，`readWorkflowText(root, domain)` 与 `listJobBlocks(root, domain)` 的"有哪些 workflow"也改由域给，并把三份退化出口按方向分开（目录不存在 / 域里零个 workflow / **域里有但磁盘读不到** = 索引与工作树不一致，拒绝"跳过那一份"）；④ 夹具换成真 git 仓：`initFixtureRepo` 做 `init -b main` + `add -A` + `commit`，并**自带** `core.excludesFile`（指夹具内空文件）与 `core.hooksPath` 钉住 —— 判据本体按调用方 git 环境如实取域（git-domain 语义 ⑥），所以机器态解耦只能由夹具自己做。回归锁 39 条（起点 33）：域正控 / 负控 A（被忽略的 workflow 与被忽略的 `*.test.js` 都不得进判据）/ 负控 B（未跟踪但未忽略必须仍在域内）/ 夹具钉住压过机器 global 档（含"不钉就被藏掉"的负控半区）/ 取域失败出声（收紧为点名「无法从 git 取得扫描域」）/ root 不存在抛错 / 「本机忽略的 workflow 不得充当已接线证据」（假绿方向）/ 「不得为接线资格登记表充当不被跳过的 job」/ 反向锁「磁盘遍历与剪枝清单不得回来」。实跑 `node --test scripts/check-unwired-tests.test.js` = **39/39**；`scripts/lib/git-domain.test.js` = 12/12；`.github/scripts/workflow-contract.test.js` = 44/44 |
| 防止再次发生（QM-5 ⑤） | PASS | ① **把"退回磁盘"变成会红的动作**：反向锁断言 `checker.walkRepoFiles === undefined`、`checker.PRUNE_DIRS === undefined`、源码必须 `require("./lib/git-domain")`、源码不得出现 `withFileTypes`（四条各测一格，M1/M4 实测各自指名变红）；② **同树对照的可复现入口**留在本机（disk 域 vs git 域的差集探针，输出 `tests_lost/tests_gained/nested_*`），下轮换域时一句话可重取；③ **夹具自带机器态解耦**而不是靠调用方记得设环境变量（M5 实测：摘掉钉子只有那一条红，红集大小 1，说明它测的是钉子本身）；④ 同源复述同步更新：`quality-gate.yml` 里描述"WORKSPACE_COVERED 在遍历时跳过 apps/ 子树"的注释改成现机制表述（历史记录 `.quality-gates.md` 与 `openspec/records/risk-closeout.md` 里的旧读数按"快照不改写"保留）；⑤ **签名变更后的验证域按消费者并集取，且清点输出不得截断**：`git grep -n` 列出 `listJobBlocks/readWorkflowText/walkRepoFiles/PRUNE_DIRS/listTestFiles/listNestedWorkflows` 全部命中（原样打印，不接 head），再逐条分「真调用点」与「同名但不同模块的局部函数」—— 实测 `check-test-microtask-spin.js` 的 `listTestFiles()` 与 `scripts/lib/mask-coverage-ab.js` 的 `PRUNE_DIRS` 都是**别的模块自己的**同名符号，不构成调用点；真调用点只有 `quality-rhythm-spec-mirror.test.js:179` 一处；⑥ 教训落内置记忆 / 外部记忆（本文件）/ EverOS |
| 行尾与 diff 对账 | PASS | 三个被改文件 `git ls-files --eol` 均 `i/lf w/crlf attr=text=auto`；两份 JS 的工作副本实测 **CRLF 420 / 1019 行、lone CR 0**，插入的注释与用例同样落 CRLF（Edit 工具按文件既有 EOL 写回）；`git diff --numstat` 与 `--diff --ignore-cr-at-eol --numstat` 逐字相等（`check-unwired-tests.js` 32/48、`quality-gate.yml` 2/1）；删除行全部归因到被替换的函数体与导出键，无幽灵行。**驱动侧教训**：变异驱动最初按 LF 拼锚点 ⇒ M1/M3/M5 报「锚点未命中」，那不是"这条锁抓不到"，是探针自己失明；改为按目标文件 EOL 拼锚点后三条全部命中 |
| 接线棘轮 | PASS | 本片**不新增测试文件**（只改既有 `scripts/check-unwired-tests.test.js`），无新点名需求；判据自证 `node scripts/check-unwired-tests.js --root=.` ⇒ `检查域内测试文件 111 个 / OK`，rc=0。`check-workflow-structure.js` files=15 violations=0（因动了 workflow 正文注释）；`check-step-failfast.js` 未改动 run 块，Gate 2c 仍是 `shell: bash` 的 fail-fast 形态 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 `.vue`/样式/locale；改动全在 CI 门禁脚本与 workflow 注释，产物与像素判定域无交集 |
| QM-6 CCG 双模型外部评审 | 自演，非外部模型 | 按用户指定「QM-6 你自己来模拟外部评审」执行：以 QM-6 两轴标准（后端=正确性/边界/安全/规格合规，前端=命名/模式/可维护性/集成）逐条自审实现 diff，结论与处置见下节。**如实标注：这不是外部模型产出，不得当作双模型证据登记**；机械闸门侧 pre-commit 仍会生成 `.ccg/reviews/<sha>.json`，其 status 由该产物自己表达 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

### 验收：两次对照，方向各不相同

**对照一 —— 假红面（本机垃圾冒充仓库缺陷）。同一环境、同一 `--root` 参数，只换判据实现：**

| 档 | 实现 | rc | 读数 |
|---|---|---|---|
| A | 修复前（磁盘遍历 + `PRUNE_DIRS`），共享根自带那一份 | **1** | `检查域内测试文件 101 个` + `嵌套 workflow 永不执行 .adversarial/arl-patched/.github/workflows/ci.yml` |
| B | 修复后（git 域），同一个 `--root=<共享根>` | **0** | `检查域内测试文件 101 个 / OK: 全部测试均已接线或按欠账登记` |

两档的**测试文件数相同（101）**，差的只有那份 gitignored 的本机文件（`git check-ignore -v` 实测命中 `.gitignore:417`）⇒ 换域只排除"本机才有"的东西，没有少量任何一个 CI 检出的文件。现场日志 `<临时目录>/p216-A.log`、`p216-B.log`（各 2 行）。

**对照二 —— 域不得缩小（同树，disk vs git 逐项差集）**，探针 `<临时目录>/p216-domain-diff.js`，取自本片 worktree：

```
disk_all=6789  git_all=10805  tests_old=111  tests_new=111
tests_lost=[]  tests_gained=[]
nested_old=[".quality-rhythm/.github/workflows/mechanism-check.yml"]
nested_new=[".quality-rhythm/.github/workflows/mechanism-check.yml"]
```

`git_all > disk_all` 是因为磁盘遍历按前缀剪掉了 `apps/ packages/ ops-center/`，而 git 域如实包含它们（随后由 `TEST_DOMAIN_EXCLUDED` 在**测试域这一步**排除）⇒ 嵌套 workflow 的检测面因此**变宽**，实测真实仓库上没有任何新的未承认项。

### QM-6 自演两轴：发现与处置（9 条，逐条给落点）

| 编号 | 轴 | 级别 | 发现 | 处置 |
|---|---|---|---|---|
| S1 | 后端 | CRITICAL | 只改测试/嵌套两处的枚举，`readWorkflowText`/`listJobBlocks` 仍按磁盘目录决定"有哪些 workflow" ⇒ 同一缺陷留下**反向**那一半（本机私产伪造接线 = 假绿） | 已修：两处改由域给清单，并各补一条假绿行为锁（TDD 先红后绿，实测红 2 条） |
| S2 | 后端 | MAJOR | 域收窄成"只看被跟踪文件"就能让"新写的测试没接线"永久隐身，而这是本判据存在的理由 | 已锁：负控 B 断言未跟踪未忽略的测试与 workflow 都必须在域内（M2 实测 4 条红） |
| S3 | 前端 | MAJOR | `PRUNE_DIRS` 常量钉死用例会把"逐个目录名打补丁"这个决策本身钉成受保护形态 | 已改：删除该常量，替换为"剪枝清单与磁盘遍历不得回来"的反向锁（M1/M4 各自指名变红） |
| S4 | 前端 | MAJOR | 夹具如依赖宿主 `core.excludesFile`，同一套件在 CI 与本机可给出两个不同的域（本仓有"本机绿 CI 红"前史） | 已修 + 已证：`initFixtureRepo` 自带 `core.excludesFile` 钉住，配一条"敌意 global 档下夹具仍量到全部文件"的用例，并带"不钉就被藏掉"的负控半区（M5 红集恰为 1） |
| S5 | 后端 | MINOR | fail-closed 断言用 `/git\|工作树\|work tree/i`，被 `.github` 子串恒真满足 | 已收紧为点名「无法从 git 取得扫描域」（M3 由"未红"变红，实证这条锁此前是装饰性的） |
| S6 | 后端 | MINOR | `listTestFiles(root, domain)` 这类"root 只为兼容旧签名而留着"的参数会诱导下一个调用方重新去磁盘取数 | 已清：两条枚举函数只收 `domain`，`listJobBlocks/readWorkflowText` 收 `(root, domain)` 且 root 只用于读文件 |
| S7 | 前端 | MINOR | 一次取域 vs 每处各自取域（4 条枚举 × 4 个 git 子进程） | 已按一次取域实现（`collectCheck` 内 `domainFiles(root)` 一处），并在注释写明"为什么共用一份" |
| S8 | 后端 | INFO | 本机套件耗时从"玩具目录"变成"每夹具起 4 个 git" | 实测套件 39 条 **≈25s**（Gate 2c 内其余条目同量级），未触任何预算常量；不为此加超时，只留读数 |
| S9 | 前端 | INFO | 历史文档里留着的旧剪枝描述会被下一个会话当现状引用 | 只改**活文档**（workflow 注释）；`.quality-gates.md` / `openspec/records/risk-closeout.md` 的旧读数作为历史事实保留，并在本轮 learnings 里点名"不得再当现状引用" |

### 反证矩阵（7 条，逐条独立跑；每条跑完按备份字节还原并回读）

| 变异 | 改成什么 | 红数 | 点名的锁 |
|---|---|---|---|
| M1 | `domainFiles` 退回磁盘递归遍历（**被禁止的形态本身**） | 9 | 域负控 A / `.agent_context` 行为锁 / 反向结构锁 / 两条 fail-closed / 两条假绿锁 等 |
| M2 | 域收窄成只看被跟踪文件 | 4 | 域负控 B / 两条"夹具后写文件"的嵌套 workflow 锁 / 机器态解耦锁 |
| M3 | 取域失败静默返回空集 | 3 | 取域失败出声（收紧后才红）/ root 不存在 / CLI rc=2 文案 |
| M4 | 判据里自带一份 git 调用、不引用共享实现 | 8 | 反向结构锁（require 那一格）+ 其余行为面 |
| M5 | 摘掉夹具的 `core.excludesFile` 钉住 | 1 | 机器态解耦锁（红集大小恰为 1 ⇒ 这条钉子只由它自己守） |
| M6 | "有哪些 workflow"退回磁盘目录枚举 | 3 | 两条假绿方向锁 + 「workflow 集合为空必须报错」 |
| M7 | 域里有但磁盘读不到时跳过那一份 | 1 | 「workflow 集合为空时必须报错而非静默判绿」 |

七条红集互不相同（M5/M7 各 1 条 ⇒ 各自独占一格），全部 `restored_byte_equal=true`，套件最终 **39/39** 绿。

### 一处既有期望随机制搬家（不是放宽）

`workflow 集合为空时必须报错而非静默判绿` 里"删掉 `.github` 目录"那一格，旧断言期望「未找到 workflows 目录」；现机制下 `gate.yml` **仍被跟踪**，所以走的是新增那一格：「workflow 在 git 域里但磁盘读不到」，仍抛错、仍 fail-closed。文案随取数来源一起搬，判据强度未变（不许退化成"跳过那一份"，M7 实测红）。

### 遗留（不假装已闭合）

1. `scripts/lib/mask-coverage-ab.js` 仍自带一份 `PRUNE_DIRS` + 磁盘遍历。**未判定**它的域"该不该"含未跟踪产物——那是覆盖率 A/B 探针，与"仓库里有什么测试"不是同一问题，需要单独取证再动，本片不顺手收敛（顺手改等于给另一个判据换语义）。
2. 让共享根可用 ≠ 让共享根干净：`.agent_context/`、`.adversarial/` 这类会话产物仍在磁盘上，只是不再冒充仓库。它们归属会话隔离面（AGENTS 的 Write Guard / 归档机制），本片不动。
3. 三条等人工的项未动：`~/.local/bin/env` 缺 `exec "$@"`、共享根那个游离空目录、把 `scripts/doc-abs-paths-baseline.json` 加进 `CI_IGNORED_PATHS`（属"改谁来守门"）。
4. QM-6 是自演（用户指定），**不构成**双模型外部评审证据；机械链上 `check-pr-exec-record.js` 的 `evaluateDeepReviewDebt` 只看 `.ccg/reviews/<sha>.json` 的 status，该产物由 pre-commit 生成，其"是否真的跑过外部模型"这一维度本仓仍无判据（AGENTS「残留风险」一节已记录，未闭合）。
