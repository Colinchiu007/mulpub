# 设计：Electron CI 串行单测按 `--shard` 切开（**方案，未提交实现**）

> 状态：**未落地**。本文件只是方案 + 精确补丁，`electron-ci.yml` **本次未被修改**。
> 落地前提见文末「为什么先不提交实现」。
> 归属：`openspec/changes/quality-infra-2026-10/`（与 `proposal.md` 的只读审计实现分开，
> 因为两者一个是**已落地代码**、一个是**未落地计划**，混在一篇会让读者无法分辨边界——
> 这一点由外部评审第 1 轮 i3 点名）。

## 目标读数（现状，实测）

| 指标 | 读数 | 来源 |
| --- | --- | --- |
| 步骤健康耗时 | **794 s** | `docs/electron-ci-step-budget-baseline.md`（run 36380533567 / main push `bef5fb72`） |
| 现预算 `BUDGET_SECONDS` | **2100 s**（= 794 × 2.64） | `electron-ci.yml` L153 |
| job 级上限 | 70 min | `electron-ci.yml` L82 |
| 失败形态 | `[electron-ci-timeout-budget] elapsed=2100s budget=2100s rc=124` | `efcc84b78`、`8d673f1e8`、`f947b6978`（2 次重跑） |
| 近 16 次 main 运行失败 | 11 次；其中**实证超时 ≥3 次**，**另有 1 次是真失败**（`4a610ded4`：`elapsed=1844s rc=1`，红在 `windows-file-lock.test.js` 的 Windows 时序用例） | `gh run list` + 逐次 `--log-failed` |

关键：该步骤 `if: github.event_name != 'pull_request'`，**PR 上不跑**（PR 侧由
`QG Desktop Shards` 承担），所以「PR 侧绿」不构成「main push 会绿」的任何证据。

## 设计

在**同一个 job 内并行跑两片**，保留 job 名 `electron-tests` 不变。

为什么不用 matrix：`AGENTS.md`「取证口径」已实测登记 matrix 与 required status check 的
结构性冲突（matrix 把作业报成 `job (1)/(2)`，required context 要的是不带后缀的名，
于是全绿也判 `base branch policy prohibits the merge`）。job 内 `&`/`wait` 并行不改变
check 名，无此问题。

### 补丁

把 `electron-ci.yml` 的
`- name: Unit tests (Vitest, non-Electron, single-worker deterministic)` 步骤体替换为：

```bash
# 分片预算：健康整轮 794 s ⇒ 单片约 400 s；负载放大 2.6 倍约 1040 s。
# 1400 s = 单片健康耗时 ×3.5；两片并行 ⇒ 墙钟约 17-24 min（现状 35 min 且常超）。
# 注意：这与「抬预算」是两件事 —— 抬预算只会把阈值推到下一轮负载峰值，本仓已实测漂移。
BUDGET_SECONDS=1400
SHARDS=2
LOG=electron-ci-unit-tests.log
run_shard () {
  i="$1"
  timeout --signal=TERM --kill-after=30s ${BUDGET_SECONDS}s \
    pnpm --filter @multi-publish/desktop test -- \
    --shard=${i}/${SHARDS} --maxWorkers=1 --no-file-parallelism \
    --reporter=verbose --testTimeout=10000 --hookTimeout=10000 \
    --teardownTimeout=10000 2>&1 | tee "${LOG}.${i}"
  # 必须读 PIPESTATUS：`cmd | tee` 的 $? 是 tee 的（恒 0）
  echo "${PIPESTATUS[0]}" > "rc-${i}"
}
run_shard 1 &
run_shard 2 &
wait

RC=0
for i in 1 2; do
  r=$(cat "rc-${i}")
  echo "[electron-ci-timeout-budget] shard=${i}/${SHARDS} budget=${BUDGET_SECONDS}s rc=${r}"
  if [ "$r" -eq 124 ]; then
    echo "TIMEOUT_BUDGET_EXCEEDED：shard ${i} 被步骤级 timeout 掐断，不是断言失败。"
    grep -cE '^ *(Test Files|Tests) ' "${LOG}.${i}" | sed 's/^/摘要行数(应为 2): /' || true
    tail -n 8 "${LOG}.${i}" | sed 's/^/末段输出: /' || true
  fi
  [ "$r" -eq 0 ] || RC=$r
done
exit "${RC}"
```

### 必须同步改的锁

1. `apps/desktop/tests/gui-ci-exit-contract.test.js`
   - 「预算挂实测」用例：`measuredStepElapsedSeconds` 从 794（整轮）改为**单片实测**，
     且 `expect(job.timeout-minutes).toBeGreaterThan(otherCaps + budget/60)` 需按「两片并行」
     重新表述（并行时 job 只需容下**单片**预算 + 其它步骤，不是两片之和）。
   - **「自证块必须在 bash -e -o pipefail 下真能执行」用例必须重做**：它靠文本替换把内层
     命令换成 `sleep 2` 再真跑。并行 `&`/`wait` + `PIPESTATUS` 的聚合让替换点改变，
     改错就是把锁改绿而自证仍死（#2525 的原始失效形态）。这是本方案最主要的风险面。
2. `docs/electron-ci-step-budget-baseline.md`：新增「单片」这一层的实测数字与出处。

## 为什么先不提交实现

1. **锁的重做风险最高**：上面第 2 条锁是专门用来防「门禁只在 YAML 里存在」的，它的判据域
   是「真执行」。并行聚合后的替换点与时点都要重新设计并做破坏-恢复反证。
2. **单片预算只能实测**：不能拿 `794/2` 推算 —— 那正是本仓反复出现的「把推算当实测」。
   必须落地后跑**一次真实 main push**，拿到单片 `elapsed` 再钉进锁。
3. **语义变化需产品级确认**：分片后不再是「全仓单 worker 串行」，该步骤原本承担的
   「第二次独立运行的 flake 检出」语义会改变（两片各自单 worker，但两片并发）。

## 可选的更彻底方案（供决策）

该步骤与 `QG Desktop Shards` 覆盖重叠（同一批桌面测试，一个单 worker 串行、一个分片）。
若目标是「省机器 + 稳」，可考虑：**保留分片跑，把单 worker 那步降级为 nightly 或只跑
smoke 子集**。这比加 shard 更彻底，但改变了「确定性串行覆盖」的存在性，需产品决策。
