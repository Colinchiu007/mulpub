---
record: fix-main-red-too-stale
task: 修主干上已合入的 too-stale 漏拦 + 弱网重试（PR #4221 合并后才暴露的两处 Critical）
date: 2026-10-22
---

## 本次执行记录：too-stale 曾不拦 + 弱网下判据几乎必然 rc=4（fix-main-red-too-stale，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（`scripts/` 判据本体 + 测试）⇒ 隔离 worktree `mp-main-red-run-baseline` 内、分支 `fix-main-red-too-stale`（从 `origin/main` `a55df4509` 切出，`git rev-parse --abbrev-ref HEAD` 实证）。**为什么复用同一个 worktree**：本任务是 PR #4221 的直接延续（同一模块、同一批文件），且原分支已合并、工作区无未提交改动（`git status --porcelain` 空）。共享根全程停在 `main` 且未落盘任何运行时路径 |
| 第一性原因（QM-5 ①） | PASS | **两处，都是 PR #4221 合并之后才暴露的，且都是我自己引入的。** ① **`too-stale` 从不拦**：`pickBaseline` 的 `too-stale` 档返回的 `rows` 是**全绿**的（它确实找到了绿基线，只是落后 tip 太远），而 `judge()` 只看 `rows` ⇒ 判绿。`maxStale` 这个参数**只存在于生产者侧的返回值里**，消费者（`judge`）根本不知道它存在 ⇒ 参数是装饰。现场：`verdict=OK exit=0 baseline=98e94bc3b staleness=4 baseKind=too-stale`，`staleness=4 > maxStale=3` 却放行。② **弱网下几乎必然 rc=4**：一次 `mainBaseline()` 要**连续成功 10+ 次** gh 调用（每条链 1 次 `actions/runs` + N 次 `actions/runs/{id}/jobs`，N = workflow 数 6~8）；实测本机单次失败率 **20%**（同一端点连试 5 次有 1 次 `EOF`）⇒ 连续全成功概率 `0.8^10 ≈ 10%`。现场同一分钟连跑两次：一次 `rc=4`（`attempt=3/3` 全失败）、一次正常。`main()` 的 3 次重试是**整段重来**，救不了这个数量级 |
| 逃逸分析（QM-5 ②） | PASS | ① **只测生产者、没测消费者**：`main-red-baseline.test.js` 的 1.1.5 只断言 `pickBaseline` 返回 `kind==='too-stale'`，**没有一条测试断言 `main()` 要把它变成 `rc=3`** ——「函数返回对了」和「调用方用了它」之间那一格空着。这与我上一轮刚采纳的 CCG i1（接线锁）是**同一个形状**，只是发生在另一个参数上：`mainRows` 我补了接线锁，`mainBaselineKind` 没补。② **读数行有信息但没人强制读**：`baseKind=too-stale` 就印在读数行里，但 `verdict=OK` 更显眼，人眼会先看 verdict ⇒ 「可见」不等于「被发现」。③ **网络失败被归到「自身故障」档**：`rc=4` 语义上是「判据自己坏了」，与「主干状态未知」混在一档，操作者只看到「工具故障」，不会想到是请求数量放大导致的必然性 |
| 修复 + 回归保护（QM-5 ④） | PASS | ① `judge()` 新增可选入参 `mainBaselineKind` / `mainBaselineStaleness`，在差集之前单独拦一档 `too-stale ⇒ INCOMPLETE(3)` + `newRedComputed=false`（读数行打 `newRed=na`），与既有 `mainMoved` 档同族（基准不可用 ⇒ 未证实，且不报新增红）。② `createGhCollector` 的 `run()` 加**逐次** gh 调用重试（2 次 × 1.2s），只对瞬时错误（`wsarecv`/`ECONNRESET`/`ETIMEDOUT`/`socket hang up`/`EOF`/`timeout`/502-504）重试，**不重试** 401/403/404（凭据或路径错重试只会把「配置错」拖成「慢失败」）。③ 回归锁新增 2 例：`too-stale ⇒ rc=3`（即使 rows 全绿）、`too-stale` 时读数行必须 `newRed=na` 且点名 staleness。**变异反证**：删掉 too-stale 拦截档 ⇒ 2 例当场红（`not ok 16`、`not ok 17`），还原后 19/19 |
| 防止再次发生（QM-5 ⑤） | PASS | ① **接线锁补齐到 `mainBaselineKind`**：`baseline=red⇒rc=2`、`baseline=unknown⇒rc=3`、`baseline=too-stale⇒rc=3`、缺 `mainBaseline⇒rc=4` 四条都断言的是**消费者行为**（`run()` 的退出码），不是生产者返回值 —— 这是本轮的通用修法：**新增一个参数就要有一条断言它在消费端生效**。② **错误上下文**：`pickBaseline` 对 `rowsAt` 抛错加包装 `pickBaseline: rowsAt(<sha9>) 取数失败（第 i 条回溯）`，让「网络抖动」与「基准逻辑错」在日志里可区分（本轮实测直接受益：一眼看出失败在 `rowsAt(a55df4509)` 第 0 条）。③ 网络重试的判据是**正则白名单**而不是「所有非零都重试」，避免把 401/404 拖成慢失败 |
| 行尾与 diff 对账 | PASS | `git diff --numstat origin/main...HEAD` 与 `git diff --ignore-cr-at-eol --numstat origin/main...HEAD` 两口径逐行一致（详见提交前实测）；无整文件删除 |
| 接线棘轮 | PASS | **未新增** `*.test.js` 文件（新增 2 例落在**已接线**的 `scripts/main-red-baseline.test.js` 内，该文件已由 `quality-gate.yml` 的 changes 作业 `Gate 2b8` 执行：`node --test scripts/check-main-red.test.js scripts/main-red-baseline.test.js`）⇒ `node scripts/check-unwired-tests.js` rc=0 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/`、`packages/`、`apps/desktop/electron/**`、locale、视觉基线 ⇒ 打包与像素基线不适用 |
| QM-6 CCG 双模型外部评审 | PASS | 本修复是 PR #4221 第 1 轮 CCG 裁决（i2「请求预算」+ i1「接线锁」）在真机上被证实的**两个具体缺口**，属既有裁决的落地补强；判据本体的高危面收口沿用 #4221 的 `deepReview.tier=external` + 公开 PR 评论证据（`#issuecomment-6335241418`）。本 PR 不新增判据语义，只补「消费端断言」与「瞬时故障重试」两处实现 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。合并后 main push 的回读证据写在 PR 评论里，不写回本文件 |

### 遗留（不假装已闭合）

- **`maxStale=3` 的依据仍偏弱**：实测在主干活跃时 `staleness` 会到 4，此时正确行为是 `rc=3`（等主干出现更近的完整结论）。这是 fail-closed，不是缺陷；但「3 这个数字」只有一次实测支撑（另一次实测只需 2）。若将来频繁落在 `too-stale`，应把它做成可配参数并记录选取依据，而**不是直接调大**。
- **`rc=4` 与「主干未知」仍共用一档**：网络故障与判据自身故障在退出码上不可区分（都是 4）。本轮只把「网络失败的概率」降下来了，没有拆档。
- **`permissions` 缺 `actions: read`**（#4221 CCG i3 的存量发现）：`ci-failure-handler.yml` 调 `classify-ci-failure.js` 要读 jobs，但 workflow 级 permissions 只有 contents/issues/pull-requests。有 fallback（降级为 `classifier-unavailable` 仍开单），故不阻断，但值得与分类器改造一起单独评审。

## CHANGELOG 条目

# fix(gates): 补两处真机暴露的 Critical —— too-stale 曾不拦、弱网下判据几乎必然 rc=4

- `maxStale` 以前只是「生产者返回值里的一个字段」，判据消费端没有读它：明明 `staleness=4 > maxStale=3`，
  仍然给出「主干绿、本 PR 无红」。现在 `too-stale` 会在差集之前单独拦成「未证实」，且读数行打 `newRed=na`
  （「未计算」不再被涂成「零新增红」）。
- 一次基线选择要连续成功 10 次以上 GitHub 接口调用，而本机实测单次失败率约 20% ⇒ 连续成功概率只有约 10%，
  判据在弱网下几乎必然报「自身故障」。现在每次调用都带小重试（2 次 × 1.2 秒），只对瞬时错误重试，
  凭据/路径错仍然立刻失败。
- 这两处都是 PR #4221 合并之后才暴露的：一个测了「函数返回对了」没测「调用方用了它」，
  一个把「请求数量放大」误当成「工具坏了」。
