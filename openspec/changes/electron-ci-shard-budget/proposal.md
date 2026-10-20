# Proposal: electron-ci-shard-budget（Electron CI 串行单测：接通自证块 + 按 shard 切开）

## Why

`electron-tests` 在 main push 上间歇性红，且**红得不可归因**：2026-10-19T21:58 的 merge SHA `4832662e9`（本仓 PR #4052 合入）与 22:50 的 `715391c88`（**不是** PR #4052 的内容）都红；近 12 次 main push 里 5 次失败。日志里**零条** `×` 失败用例、**零条** `FAIL`、**零条** vitest 摘要行，只有 `##[error]Process completed with exit code 124`。

三件事叠在一起才让它「不可归因」：

1. **预算墙被撞穿**：步骤内层 `timeout --signal=TERM --kill-after=30s ${BUDGET_SECONDS}s` 的预算是 `BUDGET_SECONDS=2100`（35 分钟）。job 实测 22:46:01Z→23:22:31Z = 36.5 分钟，`exit 124` ⇒ 撞的是这堵墙。
2. **自证块从未执行过一次**：#2525 的标题是「**让超时失败能自证**」，正文在 `timeout … | tee` 之后写了 `RC=${PIPESTATUS[0]}` 与一整段 `TIMEOUT_BUDGET_EXCEEDED` 诊断（含 `elapsed=`、已完成测试行数、摘要行数）。但 GitHub 给的 shell 是 `bash -e -o pipefail`：`timeout` 返回 124 时 `-e` **立刻退出步骤**，其后每一行都不执行。实测两次 attempt 的日志里都**没有** `[electron-ci-timeout-budget] elapsed=… rc=…` 这行——它专门为之设计的那个场景，恰恰是它唯一不出现的场景。
3. **没有 shard**：整轮是单 worker 串行（`--maxWorkers=1 --no-file-parallelism`），一次跑完全部桌面测试。工作流自己的注释写着「根因修法是按 `--shard` 把这一轮切开（issue 档 2）」，并且明确「不是继续加大预算」。

### 量化：到底是套件变大了，还是 runner 变慢了

| 读数 | 值 | 出处 |
|------|-----|------|
| 步骤健康耗时 | **794s** | 自证行 `elapsed=794s budget=2100s rc=0`（run 36380533567 / `bef5fb72`） |
| 本步骤预算 | 2100s（=794×2.64） | 同上 |
| 本次失败轮耗时 | ≥2100s（撞墙） | job 36.5 min |
| 本 PR 之前新增的桌面测试 | 508 例 / 29 文件，本地并行 141s | film 批次一（#4052） |

794s 的健康值对 2100s 本来有 2.64 倍余量；失败轮要**放大 2.6 倍**才撞墙。所以**主导因素是 runner 负载**，不是套件自然增长——但这恰好说明「单轮全量串行」这个形状对负载极度敏感，而 shard 是唯一能从形状上消除敏感性的修法（每片工作量降到 1/N，同样的负载放大不再撞墙）。

## What changes

| # | 变更 | 判据 |
|---|------|------|
| C1 | 把 `timeout … \| tee` 段用 `set +e` / `set -e` 包起来，使 `RC=${PIPESTATUS[0]}` 与自证块**真的执行** | 行为测试：在 `bash -e -o pipefail` 下跑等价片段，必须看到 `[electron-ci-timeout-budget] elapsed=… rc=124` 与 `TIMEOUT_BUDGET_EXCEEDED` |
| C2 | `electron-tests` 加 `strategy.matrix.shard: [1,2,3]`，每片传 `--shard=<i>/3`，每片独立 `BUDGET_SECONDS` | 结构测试：matrix 存在、每片命令含 `--shard=<i>/3`、预算 ≥ 单片健康耗时 × 3 |
| C3 | 单片预算 `1200s`（20 min）：794/3≈265s 健康 + 新增约 100s ≈ 365s，余量 3.3× | 结构测试同上 |
| C4 | 保留 `--maxWorkers=1 --no-file-parallelism`（确定性 + 第二次独立 flake 检出的原意不丢） | 结构测试：每片仍带这两个参数 |
| C5 | 把既有结构锁的**断言域从「文本存在」改成「行为成立」**，并新增 shard 锁 | 新锁必须在改动前**红**、改动后绿 |

### matrix 与 required context：我第一次取证取错了，修法是补一个汇入作业

`electron-tests` **就是** required context —— 但 gate 挂在 **ruleset** 上，不在 legacy protection API 上。

这是本轮我犯的一个实质错误，必须留证：我最初只查了
`gh api repos/<owner>/<repo>/branches/main/protection`，它返回 `required_status_checks.contexts`
只有 4 条（`Gate Result` / `build` / `QG Unit Tests` / `QG Coverage`），于是我写下「matrix 不会破坏
分支保护」。**该结论是错的**：真正的 gate 在 `gh api repos/<owner>/<repo>/rulesets` 里 ——
ruleset `main-ci-gate`（id 23749994，enforcement=active）要求的 context 是：

```
QG Static / QG Unit Tests / electron-tests / 文档同步检查
债务熔断检查 / 单元测试 + Lint / GUI Gate Result
```

matrix 会把作业报成 `electron-tests (1)` / `(2)` / `(3)`，**`electron-tests` 这个 context 于是永远
不会出现** ⇒ 22 项全绿的 PR 依然被判 `base branch policy prohibits the merge`（2026-10-20 实测）。

修法：加一个汇入作业 `electron-tests-summary`，`name: electron-tests`、`needs: [electron-tests]`、
`if: always()`，把 matrix 的聚合结果按 required 名报出去（任一片失败即失败；docs-only 短路时是
`skipped`，按本仓既有约定放行）。结构锁同时钉住：汇入作业不得被删、名字不得改、
matrix 作业自己不得叫同一个名字。

**教训**：取证要看**所有**承载 gate 的机制。GitHub 有两套并存的分支保护面
（legacy protection + rulesets），只查一套就得出「不受约束」的结论，是「查到第一个空结果就收工」。

## 非目标

- ❌ 不动 `BUDGET_SECONDS` 作为「修法」——工作流注释已明确那是反模式；C3 的 1200s 只约束单片，总工作量由 C2 摊薄
- ❌ 不动 `quality-gate.yml` 已有的 `desktop-shards`（那套是 PR 侧分片，与本 job 的「main 侧第二次独立串行运行」定位不同）
- ❌ 不动 `job.timeout-minutes=70`（既有锁要求它容得下「预算 + 其余显式 timeout 之和」，1200s=20min 下 70 仍满足）
- ❌ 不为了让锁变绿而放宽任何既有断言

## 测试策略

| 层 | 用例 | 位置 |
|----|------|------|
| 行为锁（新增） | 提取 workflow 里那段 `run:` 原文，用 `bash -e -o pipefail` 执行；把内层命令替换成必超时的 stub，断言输出含 `elapsed=` 与 `rc=124` | `apps/desktop/tests/gui-ci-exit-contract.test.js` |
| 结构锁（改写） | 既有的「预算挂实测/可自证/不倒挂」断言保留，但**自证部分改为引用行为锁的结论**，不再只数字符串 | 同上 |
| 结构锁（新增） | matrix 存在性、`--shard=i/N` 逐片、单片预算下界、确定性参数保留、job 级不倒挂 | 同上 |

行为锁若不成立（`set +e` 缺失）必须**先红**：本轮按 TDD 先写锁、跑红、再改实现。

## 影响面

| 项 | 变化 |
|----|------|
| 文件 | `.github/workflows/electron-ci.yml`（主改）+ `apps/desktop/tests/gui-ci-exit-contract.test.js`（锁）+ 本 proposal + 执行记录 + CHANGELOG |
| 运行时代码 | 无（不改 `apps/desktop/electron/**`，QM-1 打包 N/A） |
| CI 墙钟 | 三片并行 ⇒ 预期从「35 min 撞墙」降到「≈ setup 6 min + 单片 6 min ≈ 12-15 min」 |
| 成本 | runner 分钟数约 ×3（setup 重复），以换取不再撞墙 |
