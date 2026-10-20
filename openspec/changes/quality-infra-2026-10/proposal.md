# quality-infra-2026-10：QM-6 记录欠账**只读审计档** + Electron CI 串行单测**分片方案**

> 分支：`ci-infra-shard-and-review-audit`（隔离 worktree，非 C 盘）
> 触发：2026-10-20 收尾 PR #4044 时暴露的两条机制问题（用户点名要「按建议执行」）
> 状态：**需人工过审**。两处都命中 `check-pr-exec-record.js` 的 `HIGH_RISK_SURFACES`
> （`scripts/check-` 与 `.github/workflows/`），按 `AGENTS.md` 属「改谁来守门」，agent 不自动合并。

## Why

### 问题一：`.ccg/reviews` 的欠账是「结构性陷阱」

`.ccg/reviews/<hash>.json` 是 QM-6 判定的**证据载体**：pre-commit 的
`ccg-review-decider.js` 按 diff 判 `mode`，写一份记录并随提交入库；CI 的
`check-pr-exec-record.js` 只看**本 PR 差量**里的记录，`status` 不在
`{cleared, needs_revision, self_play_resolved}` 内即判欠账。

于是形成一个没人看得见的黑洞：**主干上累积的未闭环记录既拦不住任何 PR，也没有任何
地方能看见它们**。本次实测（`node scripts/check-pr-exec-record.js --audit`，2026-10-20）：

| 指标 | 读数 |
| --- | --- |
| 记录文件 | 1509（主干树 1580） |
| `mode=dual` | 433 |
| 已闭环 | 156 |
| **未闭环** | **277** |
| ├ `pending`（引擎从未给出结论） | 254 |
| ├ `error`（引擎失败，无结论） | 15 |
| ├ `self_play_blocked`（裁决后仍阻断） | 4 |
| ├ `self_play_pending` | 2 |
| └ `self_play_adjudicated`（有裁决但状态词不在白名单） | 2 |
| **未闭环里 findings 总条数** | **17** |

最后一行是关键：**277 条未闭环里只有 17 条 findings**。也就是说这批欠账的主体不是
「277 个没修的问题」，而是「277 份**没有结论**的记录」——这正好对上
`openspec/changes/ccg-convergence-exit` 的诊断（验证层只跑一轮 critic 且把
`currentRound` 报成 `maxRounds`，出口①②不可达，只能落到 self-play/无结论）。

### 问题二：Electron CI 串行单测在 main push 上系统性超时

该步骤 `if: github.event_name != 'pull_request'`，**PR 上不跑**（PR 侧由
`QG Desktop Shards` 承担），只在 main push 跑。预算 `BUDGET_SECONDS=2100`。
健康耗时 794 s（`docs/electron-ci-step-budget-baseline.md`），但 runner 负载会把它放大
≈2.6 倍后顶穿 2100 s 墙。实测形态（同一 `exit code 124`，步骤自证行）：

```
[electron-ci-timeout-budget] elapsed=2100s budget=2100s rc=124
##[error]Process completed with exit code 124.
自证判据：日志里没有 vitest 摘要行（Test Files ... / Tests ...），说明整轮没跑完。
```

近 16 次 main 运行里 11 次 failure，其中**至少 3 次实证为上述超时**（`efcc84b78`、
`8d673f1e8`、本次合并 `f947b6978` 跑了两次），**另有 1 次是真失败且与超时无关**
（`4a610ded4`：`elapsed=1844s budget=2100s rc=1`，红在
`electron/services/windows-file-lock.test.js` 的 Windows 时序用例）。**两者必须分开归因**：
把它们统称「同形超时」会掩盖那条真 flake。

workflow 自己在超时分支里已经写明方向：

> `echo "下一步应该是把这一轮按 --shard 切开，而不是继续加大预算。"`（L180）

## What Changes

### 1) 只读审计档（**本次落地**）

`node scripts/check-pr-exec-record.js --audit [--json] [--limit=N] [--repo=<dir>]`

新增 `scripts/lib/exec-record-audit.js`（逻辑）+ `main()` 里约 15 行委派；**不改动任何
enforce 路径**。四条硬约束（均由 `scripts/check-pr-exec-record.audit.test.js` 7 例锁住）：

| 约束 | 理由 |
| --- | --- |
| **不判定「已修/未修」** | 记录里没有 branch/PR 字段，也没有 finding→修复提交的链接，那件事在记录层面不可判定。任何据此批量改状态词的实现都是把真债洗成漂亮话 |
| **落地归因比「文件是否在 `origin/main` 树里」，不比 commit sha** | 本仓 squash 合并：主干 commit 是新对象，feature 分支的 sha 永远不在主干历史里，按 sha 判会把每个已合并 PR 都算成未落地 |
| **只读** | 跑完不得留下工作区改动、不得创建提交（审计的最大风险是它自己变成写方） |
| **永不阻断** | 未闭环再多也 exit 0；只有用法错误（如 `--limit=abc`）exit 2 |

性能：整仓 1509 份记录 1.7 s，全程 **2 次 git spawn**（`git ls-tree` 一次 + 读工作区文件），
不逐文件 `git show` —— 本仓有 `fix-precommit-reviews-spawn-storm` 登记的 spawn 成本问题
（单次进程创建拥堵时 1175 ms），逐文件 spawn 会把审计本身变成风暴。

### 2) Electron CI 分片（**本次只出方案 + 精确补丁，不提交实现**）

设计：**同一个 job 内并行跑两片**，保留 `electron-tests` 这个 job 名不变。

为什么不是 matrix：`AGENTS.md`「取证口径」已实测登记 matrix 与 required status check
结构性冲突（matrix 把作业报成 `job (1)/(2)`，required context 要的是不带后缀的名，
于是全绿也判 `base branch policy prohibits the merge`）。job 内 `&`/`wait` 并行不改变
check 名，无此问题。

```yaml
          # 分片预算：健康整轮 794 s ⇒ 单片约 400 s；负载放大 2.6 倍约 1040 s，
          # 1400 s = 单片健康耗时 ×3.5，且两片并行 ⇒ 墙钟约 17-24 min（现 35 min 且常超）
          BUDGET_SECONDS=1400
          SHARDS=2
          run_shard () {
            i="$1"
            timeout --signal=TERM --kill-after=30s ${BUDGET_SECONDS}s \
              pnpm --filter @multi-publish/desktop test -- \
              --shard=${i}/${SHARDS} --maxWorkers=1 --no-file-parallelism \
              --reporter=verbose --testTimeout=10000 --hookTimeout=10000 \
              --teardownTimeout=10000 2>&1 | tee "electron-ci-unit-tests-${i}.log"
            echo "${PIPESTATUS[0]}" > "rc-${i}"
          }
          run_shard 1 &
          run_shard 2 &
          wait
```

**为什么这次不提交实现**（三条，任一都足以停下来交给人工）：

1. **结构锁的「真执行」用例会被改写，而它正是防止装饰性门禁的那把锁**：
   `apps/desktop/tests/gui-ci-exit-contract.test.js` 的
   「自证块必须在 bash -e -o pipefail 下真能执行」用**文本替换**把内层命令换成
   `sleep 2` 再真跑一遍。并行后台 + `wait` 的聚合逻辑改动后，这个替换点与「谁的自证行
   在什么条件下打印」都要重新设计，改错就会让锁变成绿的但自证仍是死的（#2525 的原始失效形态）。
2. **单片预算的依据只能由一次真实 main push 给出**。现预算 2100 s 的依据是
   `docs/electron-ci-step-budget-baseline.md` 里一次实测（794 s / run 36380533567）。
   分片后的单片耗时同样必须实测后再钉进锁，不能拿「794/2」推算——那与本仓反复出现的
   「把推算当实测」是同一形态。
3. 语义变化需要产品级确认：分片后**不再是全仓单 worker 串行**，这会影响该步骤原本承担的
   「第二次独立运行的 flake 检出」语义（两片各自单 worker，但两片并发）。

因此本次交付：**这条方案 + 上述补丁文本 + 归因读数**，由人工在独立 PR 里落地并跑一次
main push 取单片实测，再更新锁与 `docs/electron-ci-step-budget-baseline.md`。

## 影响范围

| 文件 | 变更 |
| --- | --- |
| `scripts/lib/exec-record-audit.js` | 新增（只读审计实现） |
| `scripts/check-pr-exec-record.js` | `+15` 行委派（`--audit` 早退分支）+ 用法注释 |
| `scripts/check-pr-exec-record.audit.test.js` | 新增 7 例 |
| `.github/workflows/quality-gate.yml` | 新增 1 行 `node --test scripts/check-pr-exec-record.audit.test.js`（否则锁不跑，等于没锁） |
| `openspec/records/ci-infra-shard-and-review-audit.md` | 执行记录 |

## 风险与不假装闭合

- `--audit` 是**可见面**不是拦截面：它不会让那 277 条变少，只是让它们可解释。真要减少，
  只能改判定写入方（`ccg-convergence-exit` / `ccg-review-degradation-ladder`）。
- 审计的落地归因只回答「这份记录有没有随某次合并进过主干」，**不回答**「它的 findings
  修了没有」。这一点写在输出的结论段里，避免读者过度解读。
- 未纳入本次：`.ccg/reviews` 的保留策略（体积 2.5 MB / 占 `.git` 0.4%，不是瓶颈；
  真正成本是 pre-commit 的 spawn 风暴，已由 `fix-precommit-reviews-spawn-storm` 负责）。
