# Proposal: main-red-run-baseline（主干红闸门改读「该 tip 的 run 集合」+ 读数稳定窗重试 + CI Failure Handler 挪出 Windows 池）

> 现场读数见 `openspec/changes/main-red-run-baseline/evidence.md`（E1–E5）。
> 拆附件的原因：CCG 决策层要把「方案正文 + 评审意见」喂给出方案后端，该后端单次输入上限
> 7800 字节（实测边界 8125–8145），超限即被**同步拒绝**（exit 1、无错误信息）。

## Why

「主干红着就别往里合」这道闸门在多会话并发合并时几乎读不出「主干绿」。三个独立原因（E1–E3）：

1. **主干侧检查清单被同名噪声淹没**：GitHub 把 `workflow_run` 触发的工作流的 check run 一律挂在
   默认分支当前 tip 上。实测主干 tip 上 102 条检查行里 **81 条**是同一个 `handle-ci-failure`
   （来自 30 个 handler run），真实信号只有 21 行；闸门实测 `mainPending=4` 而真实未完成只有 2 条。
2. **读数期间主干 tip 会移动**：闸门读「此刻的 tip」，而 tip 每 15–30 分钟前进一次。
   实测一次读数期间 tip 从 `2f5c0a32f` 移到 `8da92948`，那次读数整个作废。
3. **Windows 池排队**：实测 `electron-tests` 排队 46.6/51.5 分才起跑，同批次 ubuntu 作业**零排队**（E3）。

> `electron-tests` 长期红的**根因**已由 PR #4192 修复并合入主干（`1dc7417ed`），其后连续 3 次 push 全绿。

## What changes

| # | 变更 | 判据（行为锁落点） |
|---|------|------|
| C1 | **主干基准改读「该 tip 的 run 集合」**：采集层新增 `mainRowsAt(sha)`，读 `actions/runs?head_sha=<sha>`（`--paginate` + `per_page=100`），**只取 `event != 'workflow_run'` 的 run**，同一 workflow 取**最新**一次（`run_number` → `run_attempt`（缺失按 1）→ 时间戳兜底），再从 `actions/runs/{run_id}/jobs` 取**作业级**终态；**PR 侧仍读 check-runs** | `scripts/check-main-red.test.js`：`workflow_run` 不得进基准；`event` 缺失/空 ⇒ 抛错；**同名多行取最严格的一格**（fail > unknown > pending > skipped > pass）；API 失败（429/5xx/token/分页中断）⇒ 抛错 ⇒ 判自身故障(4)，**不合并部分页** |
| C2 | **读数稳定窗**：每次尝试**先 `git fetch origin main` 再 `rev-parse origin/main`**（fetch 失败 ⇒ rc=4），取数**前后各取一次**；**比较对象是 tip SHA**（相同即稳定、继续判读），不同 ⇒ 本次读数作废 ⇒ **有界重试**（`--attempts` 3 / `--retry-seconds` 90 / `--max-wait-seconds` 180）；耗尽 ⇒ 判「未证实」并点名**最后一次尝试**的两个 sha | 重试的**唯一触发条件是 tip SHA 变化**；同一 SHA 上的未完成 job **不**触发重试（由判据的「未证实」档 rc=3 处理）。**稳定窗解决的是「判的是哪棵树」，不是「读数会不会坏」**：读数按 sha 取，本身不会被 tip 移动污染；不重试就会拿旧 tip 的绿去放行。**时间预算**：3 次尝试 ⇒ 最多 2 次等待 ⇒ 2 × 90s = **180s**，与 `--max-wait-seconds` 默认值相等（上限在默认档刚好咬住） |
| C3 | **档位契约不变**：`0` 可合 / `1` 本 PR 新增红 / `2` 主干红 / `3` 未证实 / `4` 判据自身故障（**五档**）。「tip 移动」归入既有「未证实」档（3），**不新增退出码** | `lib/main-red.js` 的退出码集合仍恰好覆盖 0–4（既有锁已钉） |
| C4 | **CI Failure Handler 挪到 `ubuntu-latest`**（不占 Windows 池额度） | 契约锁：`.github/scripts/workflow-contract.test.js` 的用例「CI Failure Handler 必须让出 Windows 并发额度（2026-10-22，change: main-red-run-baseline）」（由 quality-gate Gate 2b 接入 CI）：必须 `runs-on: ubuntu-latest`；步骤不得显式声明 pwsh、不得含 Windows 盘符路径 / `.ps1` / cmd 专有命令 |
| C5 | 合并入口透传稳定窗参数：入口**读环境变量** `MAIN_RED_ATTEMPTS` / `MAIN_RED_RETRY_SECONDS`，**转成 CLI 参数** `--attempts` / `--retry-seconds` 传给 `check-main-red.js`（判定层只认参数，不读环境变量） | 两个入口仍只调 `scripts/check-main-red.js`，且都排在 REST 合并之前（既有接线锁已钉） |

**基准的事件范围**（i6）：= 该 tip 上的**全部非 `workflow_run` run**（含 `push` / `schedule` / `workflow_dispatch`）；
`pull_request` 事件的 run 只有在其 `head_sha` **恰好等于 tip 时**才落进集合（罕见，计入安全）。
唯一被排除的 `workflow_run` 是「对别的 CI 的反应」，不是「主干自己的验证」。
C1 解决「读数被噪声污染」，C4 解决「Windows 池被占」；迁移后 handler **仍挂在主干 tip 上**（C1 在读数侧隔离它）。

**C4 的因果只到「预期」为止**（i2）：观测事实是「Windows 作业排队 46.6/51.5 分、同批次 ubuntu 零排队」；
但**「handler 占了 electron-tests 的位置」未被证实**（托管池实时占用不可观测）。
故 C4 的收益写成**预期释放**，并留观测点：迁移后看 `electron-tests` 排队时长是否回落（E3 同口径）。

**权限**（i4/i7）：两端点 scope **不同**——`actions/runs` 需 `actions:read`，`check-runs` 需 `checks:read`。
**判据是本地工具**（由合并入口 `merge-when-green.{ps1,sh}` 调用，用 gh CLI 的本机凭据）；
CI 只跑它的**测试**（`node --test scripts/check-main-red.test.js`，不联网）⇒ **没有任何 workflow 承载它**，
也就不需要改任何 workflow 的 `permissions`，本片**不新增仓库 secret**。
本机 PAT 实测已具备 `actions:read`；不具备则 403 ⇒ 抛错 ⇒ 判自身故障(4)，**不会静默返回空**。

**两端口径**（i1）：两侧的名字集合都是**作业名**（check-run 名 == 作业名 == `jobs[].name`）⇒ 差集口径**未变**；
**不是「同一个 API」**（主干 `actions/runs`、PR `check-runs`）。**缺格方向是保守的**：
某条检查在主干侧缺席（没跑）时，PR 侧同名红仍判**新增红**（不漏判）；
但「required check 在 tip 上没跑 ⇒ 主干绿」这一面本片不额外收紧（需引入 required 名单 = 改谁来守门，登记为遗留）。
**两阶段顺序**（i6）：**先**按 workflow 取最新一次 run（`selectMainRuns`），**再**按作业名聚合（`aggregateRows`，取最严格的一格）。
**已知局限**：跨 workflow 同名作业（如 `Changes` 三处各一份）按同名合并——消歧到 workflow 级要两侧都改取数方式。
**空集合**（i2）：该 tip 上零 run / run 尚未创建 ⇒ 主干侧零行 ⇒ 既有判据的「未证实」档 **rc=3**（不判绿）。

## 不做什么（非目标）

- ❌ 不改分支保护 / ruleset / `CI_IGNORED_PATHS`（「改谁来守门」须人工过目）；不改 `electron-ci.yml`（根因已由 #4192 修掉）。
- ❌ 不引入第 5 个退出码；不把 tip 钉死在旧 sha 上继续判绿；不改 `workflow_run` 挂载语义；不取消 main push 的 workflow。

## Impact

> **声明范围**（CCG 决策层据此判「范围漂移」），必须与实际落地文件一致；路径写**仓库相对完整路径**。

**已验证的影响**（本片改了什么）：
- 判据本体与入口：`scripts/lib/main-red.js`、`scripts/check-main-red.js`、
  `scripts/check-main-red.test.js`（**行为锁主体**）、`scripts/merge-when-green.ps1`、`scripts/merge-when-green.sh`
- CI 配置与契约锁：`.github/workflows/ci-failure-handler.yml`、`.github/scripts/workflow-contract.test.js`
- 本 change 文档（只声明判据，**不装判据**）：`openspec/changes/main-red-run-baseline/proposal.md`、
  `openspec/changes/main-red-run-baseline/evidence.md`、
  `openspec/changes/main-red-run-baseline/ccg-review-record.md`、
  `openspec/changes/main-red-run-baseline/tasks.md`、
  `openspec/changes/main-red-run-baseline/specs/ci-main-red-gate/spec.md`、
  `openspec/changes/main-red-run-baseline/specs/ci/spec.md`、
  `openspec/changes/main-red-run-baseline/.openspec.yaml`
- 执行记录：`openspec/records/main-red-run-baseline.md`

**预期的影响**（**因果未证实**，只写到这里）：
- Windows 作业的排队时长**预期**缩短（`electron-tests` 的 46.6/51.5 分基线见 E3，可复跑对照）。
- 主干读数的**排队**部分**预期**缩短。

> 另有 `.ccg/reviews/<sha>.json` 由 pre-commit 自动生成（产物）。

## 影响面

**不触 `apps/`、`packages/`**（QM-1 N/A）；改的是 `scripts/` 下的**门禁运行时**（合并入口与判据本体，PR 侧必跑）
与 `.github/workflows/` 的 CI 配置。退出码集合不变；主干基准来源从「commit 上的全部 check-runs」
换成「该 tip 的非 workflow_run run 集合」。`quality-gate` 的 44 分钟真实执行时间**不变**。
风险：只经 `workflow_run` 途径产生的检查不再进基准（实测三条真实 workflow 全是 push 触发）。
