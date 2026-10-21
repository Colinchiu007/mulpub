# Proposal: 债务基线变更后重算在飞 PR，并把陈旧结论点名（debt-baseline-recheck）

## Why

收紧债务红线之后，**别人早就跑绿的 CI 不会重跑**。GitHub 只看"这条 required check 上次是什么结论"：`pull_request` 的 run 固定在触发时那一刻的 merge ref 上，主干前进不会重新排队。于是基线变严当天，一笔带着**旧基线绿结论**的 PR 照样能自动合并——红线是新收紧的，可没有任何东西拿它量过这笔 PR，合进去主干当场变红。

这不是推演，是**当下主干上仍然成立的读数**（探针 `probe-debt-staleness`，取法见 tasks 1.1）：

| 量 | 读数 |
|---|---|
| open PR | 30 |
| 顶着**陈旧绿**的 PR（绿 run 完成时刻 < 基线最近一次变更） | **4** |
| 最久一笔陈旧绿的年龄 | #3376，run 完成于 2026-10-12，基线 2026-10-19 收紧 ⇒ **陈旧 7 天** |
| 一条 check 都没有的 open PR（另一族，见「不做」） | 7 |
| `scripts/debt-baseline.json` 近 30 天变更次数 | **12** |
| `scripts/check-debt-budget.js`（判据本体）近 30 天变更次数 | 1 |
| 单次重算耗时（**本机**实测 `time node scripts/check-debt-budget.js`） | **1.9 秒** ⇒ 纯判据部分 30 笔 ≈ 57 秒 |
| **CI 侧单轮总耗时 / 评论写入速率** | **未测**（见 Impact 末条，首次运行必须打印实测再回填，不预先估个数） |

规范侧也承认这是缺口：AGENTS.md 的收尾链第 6 条只要求"回读**本次合并**触发的 main push"，而"基线收紧不作废在飞绿 run"这一格是我上一轮**登记过、按用户裁决『另起一刀修』**的欠账。

## What Changes

- 新增 `.github/workflows/debt-baseline-recheck.yml`：只在**主干上这两份守门输入变化**时触发（`paths: scripts/debt-baseline.json`、`scripts/check-debt-budget.js`），外加 `workflow_dispatch` 手动重算。它**不是** required check，也**不改任何分支保护/ruleset**——本刀按用户裁决只做「重算 + 点名」这一档。作业退出码语义见 design D6：**量到了就退 0（哪怕结论是"有债"）**，只有工具侧故障（浅历史、取错 ref、评论写不进去）才非 0 且只归因一次。
- 新增 `scripts/check-debt-recheck.js`（唯一实现，可注入、无网络）：
  - `evaluatePr(...)`：对一笔 PR 取「与当下主干的合并态」，在**那个树里**跑 `scripts/check-debt-budget.js`，返回四档之一：`IN_BASELINE` / `VIOLATES` / `UNJUDGEABLE`（合并冲突等）/ `CHECKER_FAILED`（判据自身报错）。⚠ 基线归属必须说精确，否则与 design D2 自相矛盾（外部评审 Critical#1 命中我这一句旧括注）：**不是**"取主干那份覆盖 PR"，而是"取合并态里那份"——PR **没动**基线 ⇒ 它就是主干当下收紧后的那份（本刀要量的正是这一格）；PR **自己改了**基线 ⇒ 它是该 PR 提议的那份（不得没收一个正在还债的 PR 的提议）。两种情况都由同一条规则覆盖，无需特例。
  - `renderComment(...)`：产出一段带机器标记的 Markdown 表格（每笔一行、含当下基线读数与陈旧 run 的完成时刻），**空集也必须出行**（`rows=0`），并显式单列 `UNJUDGEABLE/CHECKER_FAILED` 两档。
  - `findMarkerComment(...)`：按标记决定"更新既有评论"还是"新发一条"，避免每轮往 30 个 PR 上叠评论。
- 后两档**不得被读成通过**：工具失明一律出声并单独计数（本仓「把工具的失明读成结论」是同型缺陷，`check-branch-merged.js` 的 rc=2 口径同源）。
- 写入面**默认关**（实现层外部复核 i3，高危域 `auth`）：`shouldCommentOn(env)` 严格只认字符串 `"1"`，workflow 里显式 `MP_RECHECK_COMMENT: "0"` ⇒ 首轮只打印"本来会写谁"，不动任何人的 PR（design D7）。开启后再受两道边界约束（i3 的后续 W3/W4，design D8）：每轮上限 `MP_RECHECK_MAX_COMMENTS`（默认 10，`0` = 只点名不写，非法值回落并出声），以及**每次写入前重新核查该 PR 仍为 `OPEN`**（读不到状态按未证实处理 ⇒ 不写）。这三条都由注入 seam 的**行为级**用例锁住，不只用"源码里调了门闩"的结构断言。

## 不做（划清边界，免得这一刀长成守门改造）

- **不**打开 `strict`（要求分支与主干同步）、**不**写 required 上下文、**不**启用 Merge Queue。三条都能真阻断，但都是"改谁来守门"，需人工过目；用户 2026-10-20 在四档里明确选了「只做重算+点名」。所以本刀交付后，陈旧绿**仍可能**被合进去——变化是：它会在合并前被点名在 PR 上，而不是合并后靠 main 变红才知道。
- **不**处理"一条 check 都没有"那 7 笔（归因是 `mergeable=UNKNOWN`/触发层问题，已有独立记录 [[pr-no-checks-attribution]]），别在一刀里混两个判据面。
- **不**自动 rebase 任何人的 PR，也**不**代点合并。
- **不**新建第二份债务度量实现：重算必须调用 `scripts/check-debt-budget.js` 本体，本刀只决定"什么时候、在哪个树上调它"。

## Impact

- 受影响行为：主干基线/判据变更后的 CI 图拓扑（多一条非 required workflow）与 30 个在飞 PR 的评论面。
- 新增判据文件需**同 PR 接线**（本仓铁律「测试文件必须显式接进 CI，否则等于没写」）：`scripts/check-debt-recheck.test.js` 登记进 `quality-gate.yml` Gate 2b；新 workflow 必须过 `.github/scripts/check-workflow-structure.js`（Gate 2b 已在扫，改 workflows 正文后必须本机跑一次）。
- 分层：动 `.github/workflows/` 与 `scripts/` ⇒ **混合 PR**，走完整质量节拍；`.github/workflows/` 属 `HIGH_RISK_SURFACES`，故 QM-6 需真外部评审（不是自扮演）。
- 权限：新 workflow 只需 `pull-requests: write` + `contents: read`；不申请 `checks: write`（那正是本刀刻意不做的守门改造）。
- **成本口径的诚实边界**（外部评审 Warning#3）：本机 1.9 秒/条只覆盖判据本身，**不覆盖** 30 次 `refs/pull/<n>/head` fetch、30 次合成提交与只读 worktree 创建，更不覆盖评论写入的 API 速率。所以本刀不预先写"约 N 分钟"这种数——要求是：作业必须带 `timeout-minutes`（初值按"判据部分 57 秒 + 每笔 PR 的 git 开销"留足余量，取 **15**），并且**每笔 PR 打印一行实测**（`pr=<n> fetch=<ms> merge=<ms> judge=<ms> comment=<ms>`）；首次真实运行后把这批读数回填进本文件与执行记录，之后才算"量过"。在此之前，CI 耗时与 GitHub 二级速率限制都是**未证事实**，不得当成已闭合的前提去设计重试风暴。
