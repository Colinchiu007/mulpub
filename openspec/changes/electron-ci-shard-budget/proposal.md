# Proposal: electron-ci-shard-budget（本轮实际只落地「接通自证块」；分片见遗留）

> **范围修正（2026-10-20 收尾）**：本文件最初规划的是「接通自证块 + 按 `--shard` 切成三片」。
> 三轮实测后**分片部分未落地**，原因写在下面「为什么分片没做」。本轮实际交付只有 C1
> （接通自证）与同轮由 CI 抓出的台账名派生修复。执行记录见
> `openspec/records/electron-ci-shard.md`。

## Why

`electron-tests` 在 main push 上间歇性红，且**红得不可归因**：近 12 次 main push 里 5 次失败，
日志里**零条** `×` 失败用例、**零条** `FAIL`、**零条** vitest 摘要行，只有
`##[error]Process completed with exit code 124`。同一形态在**不是本仓 PR 内容**的提交
`715391c88` 上复现 ⇒ 与具体改动无关。

`exit 124` = 撞上步骤级 `timeout` 的墙（`BUDGET_SECONDS=2100`），不是断言失败。

真正让这件事「不可归因」的是第二层缺陷：

`bef5fb72c`（#2525，2026-09-28）的 PR 标题是「**让超时失败能自证**」，正文也确实写了
`RC=${PIPESTATUS[0]}` 与一整段 `TIMEOUT_BUDGET_EXCEEDED` 诊断。但它们被放在
`timeout … | tee` **之后**，而该 job 的 shell 是 `bash -e -o pipefail`：

```
timeout … | tee "$LOG"     # 返回 124
RC=${PIPESTATUS[0]}        # ← -e 已经退出步骤，这行及其后全部不执行
```

**该自证块自合入起从未运行过一次 —— 它专门为之设计的那个场景，恰恰是它唯一不出现的场景。**
旁证：同一 `run:` 目录下的 `Electron smoke test` 步骤早就用着正确的
`set +e … status=$?; set -e` 写法。

## What changes（实际落地）

| # | 变更 | 判据 |
|---|------|------|
| C1 | `set +e` / `set -e` 包住 `timeout … \| tee`，使 `RC=${PIPESTATUS[0]}` 与自证块**真的执行** | 行为锁：在 `bash -e -o pipefail` 下真跑该段 `run` 原文，必须看到 `[electron-ci-timeout-budget] elapsed=… rc=124`、`TIMEOUT_BUDGET_EXCEEDED`、`已完成测试行数` |
| C2 | `packages/shared-utils` 的 `ledgerCommandName` 对 `spawn(file,args)` 的**裸路径**取真实 basename（含空格路径曾被折成 `Program`） | 单测 +1 例（含负控），基线登记 `child::bash.exe` 并写全理由 |

**未落地**：matrix 分片、单片预算、汇入作业。

## 为什么分片没做（三轮实测，全部留痕）

| 尝试 | 结果 |
|------|------|
| ① matrix `shard: [1,2,3]` | 分片本身能跑（PR 上 `electron-tests (1) pass 2m14s`），但 **check 名变成 `electron-tests (1)`**；ruleset `main-ci-gate` 要求的 context 是 `electron-tests` ⇒ 该 context 永不出现，**22 项全绿的 PR 仍判 `base branch policy prohibits the merge`** |
| ② 另加 `name: electron-tests` 的汇入作业 | **整份 workflow 被判不可解析**：幻影 `push` run + **0 job**，run 的 `name` 退化成 workflow 路径，且 `on.push.branches: [main]` 下却出现本分支的 push run（说明 GitHub 连 `on:` 都没读到）。`if: always()` 与 `if: ${{ always() && … }}` 两种写法都复现 |
| ③ 只给 matrix 作业加静态 `name: electron-tests` | 解析正常，但 check 名**仍是** `electron-tests (1)` ⇒ required context 照样缺后缀 |

正解是把 matrix 作业改 id（如 `electron-tests-shards`）+ 用 id 为 `electron-tests` 的汇入作业，
但那要同步改 `.github/scripts` 与 `apps/desktop/tests` 里多条结构性锁（它们按 job 名 / `needs`
断言「跑桌面 vitest 的每个 job 必须先重建 5 个产物」「测试步的 `if` 必须是字面量」等）。
那是另一件事，且属于「谁来守门」的邻域，不该塞进一个修超时的 PR。

## 为什么这件事先做（顺序理由）

分片要定片数与单片预算，而这件事的**唯一依据是逐片实测耗时** —— 那个读数只有在自证块接通之后
才会产出。先修自证，下一次超时就能自报 `elapsed=`，届时按实测最大片时定数，而不是按均值猜
（原先那条「794 / 3」的推算就是均值假设，已在遗留里标明）。

## 非目标

- ❌ 不动 `BUDGET_SECONDS`（工作流注释已明确「加大预算」是反模式）
- ❌ 不动 `quality-gate.yml` 已有的 `desktop-shards`（那是 PR 侧分片，与本 job「main 侧第二次
  独立串行运行」的定位不同）
- ❌ 不改分支保护规则、不改 `CI_IGNORED_PATHS` 白名单

## 影响面

| 项 | 变化 |
|----|------|
| 文件 | `.github/workflows/electron-ci.yml`（两行 + 注释）、`apps/desktop/tests/gui-ci-exit-contract.test.js`（行为锁）、`packages/shared-utils/src/network-egress-guard.js`（台账名派生）、`scripts/test-egress-ledger-baseline.json`（登记 `child::bash.exe`）、文档与执行记录 |
| 运行时代码 | `shared-utils` 一处派生函数（不触 `apps/desktop/electron/**`，QM-1 N/A） |
| CI 墙钟 | 不变（分片未落地） |
| 可归因性 | **从 0 提升到明确读数**：下一次撞墙会自报 elapsed / budget / rc / 已完成用例数 |
