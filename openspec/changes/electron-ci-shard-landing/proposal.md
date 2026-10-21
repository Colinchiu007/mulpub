# Proposal: 把 Electron CI 的整轮串行单测按 `--shard` 切开（分片落地）

> 承接 `openspec/changes/electron-ci-shard-budget/`：那一轮落地了 C1（自证块接通）与
> C2（台账名派生修复），并把 **matrix 分片明确留给下一轮**——理由记在
> `openspec/records/electron-ci-shard.md` §九：当时分片三轮尝试都卡在 required context 上，
> 且「它要同步改多条结构性锁……那是另一件事，且挨着『谁来守门』，不该塞进一个修超时的 PR」。
> 本轮用户明确要求继续做（2026-10-21），于是把那一刀单独成一刀落地。

## Why

`electron-tests` 作业在 main push 上**整轮**跑桌面单测（`--maxWorkers=1 --no-file-parallelism`），
单步预算 `BUDGET_SECONDS=2100`。这条整轮在 runner 负载下会**整轮跑不完**：

- 2026-10-21 实测（本轮 PR #4163 合并后 main push，merge SHA `e8799536c`）：
  步骤自证行 `elapsed=2100s budget=2100s rc=124`，
  `TIMEOUT_BUDGET_EXCEEDED：本轮被步骤级 timeout 掐断，不是断言失败`，
  vitest 摘要行 **0 条**、`×` 失败用例 **0 条**（整轮没跑完）。
- 同一份代码在 PR 侧 **2m7s 跑完**（`electron-tests` SUCCESS）——所以这不是代码问题。
- main 近 12 次 `Electron CI` 里 **6 次 failure**，且落在与本次无关的提交上
  （`feat(scripts): 抖音发布 E2E 一键脚本`、`docs(scripts): 排查绕开 GUI 取信封库凭据`、
  `fix(rewrite): 敏感词 warnings…` 等）⇒ **主干既有偶发**，不是谁带进去的。

真实红因是**单轮的工作量对 runner 负载极度敏感**：健康耗时与负载放大后的耗时都挤在同一个
2100s 墙的一侧，红的时候又**不可归因**（连 vitest 摘要都没有）。仓库自己在
`docs/electron-ci-step-budget-baseline.md` 里写明了根因修法：

> 2100s ≈ 健康步骤耗时 ×2.6 ≈ 旧墙 ×1.75，属**单调放宽**……但仍不是「修好了根因」：
> **根因修法是按 --shard 把这一轮切开（issue 档 2）**。

## What changes

| # | 改动 | 落点 |
|---|------|------|
| C3 | 整轮单测拆成 **N 片 matrix**（`electron-tests-shards`），`--shard=<i>/<N>`，保留 `--maxWorkers=1 --no-file-parallelism`（确定性语义不变） | `.github/workflows/electron-ci.yml` |
| C4 | 保留 `electron-tests` 这个 **required context**：作业 id 保持 `electron-tests`、check 名保持 `electron-tests`，并让它 `needs` 分片作业、**任一片失败即失败** | 同上 |
| C5 | 单片预算挂**单片实测**（由当前整轮实测 ÷ 片数换算，并按负载放大留余量），且**低于**它取代的现行整轮预算 2100s（原始魔数 1200s 也一并低于） | 同上 + `docs/electron-ci-step-budget-baseline.md` |
| C6 | 结构性锁同步：既有两条按 `workflow.jobs['electron-tests']` 定位单测步的锁改指分片作业；新增「汇入作业必须在、且必须叫 `electron-tests`」「matrix 作业不得叫同一个名字」「分片数与单片预算的关系」三条锁 | `apps/desktop/tests/gui-ci-exit-contract.test.js`、`.github/scripts/workflow-contract.test.js` |

## 关键约束（上一轮卡死的地方）

`electron-tests` **就是** required context，但它挂在 **ruleset** 上、不在 legacy protection API 上：

```
gh api repos/<owner>/<repo>/branches/main/protection
  → required_status_checks.contexts = ["Gate Result","build","QG Unit Tests","QG Coverage"]   # 只有 4 条

gh api repos/<owner>/<repo>/rulesets/23749994      # main-ci-gate，enforcement=active
  → required contexts: QG Static / QG Unit Tests / electron-tests / 文档同步检查
                        债务熔断检查 / 单元测试 + Lint / GUI Gate Result                          # 7 条，拦人的是这套
```

matrix 会把作业报成 `electron-tests (1)` / `(2)` / … ⇒ **`electron-tests` 这个 context 永不出现**
⇒ 22 项全绿仍被判 `base branch policy prohibits the merge`（2026-10-20 实测）。

**本刀的正解**（上一轮 §九 推出的形状，本轮落地）：matrix 作业改 id 为 `electron-tests-shards`
（check 名变成 `electron-tests-shards (1)` 等），**用 id 为 `electron-tests` 的汇入作业**把聚合结果
按 required 名报出去。作业名与 matrix 作业不得同名（否则两条同名检查、聚合语义失效）。

## 明确不做

- ❌ 不改分支保护规则、不改 `CI_IGNORED_PATHS` 白名单（那是「改谁来守门」，必须人工过目）。
- ❌ 不改 `quality-gate.yml` 的 `desktop-shards`（PR 侧那套分片）——本刀只改 main push 的整轮。
- ❌ 不改单测的确定性参数（`--maxWorkers=1 --no-file-parallelism --reporter=verbose` 全保留）：
  「main 侧第二次独立运行」的 flake 检出原意不丢。
- ❌ 不用「把预算抬到更大」冒充分片：单片墙必须**低于**它取代的现行整轮预算 2100s（原始魔数 1200s 亦然）。
