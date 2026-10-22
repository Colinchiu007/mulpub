# Proposal: main-red-run-baseline（主干红闸门改读「该 tip 的 run 集合」+ 读数稳定窗重试 + CI Failure Handler 让出 Windows 并发）

> 现场读数见 `openspec/changes/main-red-run-baseline/evidence.md`（E1–E5）。
> 拆附件的原因：CCG 决策层的修订环节要把「方案正文 + 评审意见」喂给出方案后端，
> 该后端单次输入上限 7800 字节（实测边界 8125–8145），超限即被**同步拒绝**
> （~120ms、exit 1、无错误信息），评审会停在「挑完刺但没人回应」那一格。

## Why

「主干红着就别往里合」这道闸门（`scripts/check-main-red.js` / `scripts/lib/main-red.js`）
在多会话并发合并时几乎读不出「主干绿」。三个独立原因（证据 E1–E3）：

1. **主干侧检查清单被同名噪声淹没**：GitHub 把 `workflow_run` 触发的工作流的 check run
   一律挂在默认分支当前 tip 上。实测主干 tip 上 102 条检查行里 **81 条**是同一个
   `handle-ci-failure`（来自 30 个 handler run），真实信号只有 21 行；闸门实测
   `mainPending=4` 而真实未完成只有 2 条——**另一半是噪声**。噪声随 tip 存续时间增长。
2. **读数期间主干 tip 会移动**：闸门读「此刻的 tip」，而 tip 每 15–30 分钟前进一次。
   实测一次读数期间 tip 从 `2f5c0a32f` 移到 `8da92948`，那次读数整个作废。
3. **Windows 并发额度被挤爆**：`electron-tests` 作业实测排队 46.6 分 / 51.5 分才起跑
   （同批次纯 ubuntu 作业零排队）。读数 = 45 分钟执行 + 47 分钟排队，而 tip 每 25 分钟跳一次。

> `electron-tests` 长期红的**根因**已由 PR #4192 修复并合入主干（`1dc7417ed`），
> 其后主干连续 3 次 push 全绿。本片不碰 `electron-ci.yml`（证据 E4）。

## What changes

| # | 变更 | 判据 |
|---|------|------|
| C1 | **主干基准改读「该 tip 的 run 集合」**：采集层新增 `mainRowsAt(sha)`，读 `actions/runs?head_sha=<sha>`（`--paginate` + `per_page=100`），**只取 `event != 'workflow_run'` 的 run**，同一 workflow 取**最新**一次（`run_number` 与 `run_attempt` 双重最大），再取其**作业级**终态；**PR 侧仍读 check-runs** | 结构锁：入口必须调 `c.mainRowsAt(`，`c.checksAt(` 只出现一次（PR 侧）；行为锁：`workflow_run` 的 run 不得进基准；`event` 缺失 ⇒ 抛错（形状不认识不得静默放行） |
| C2 | **读数稳定窗**：每次尝试都重新取当前 tip，取数**前后各取一次**；不一致 ⇒ 本次读数作废 ⇒ **有界重试**（`--attempts` 默认 3、`--retry-seconds` 默认 90）；耗尽 ⇒ 判「未证实」并点名两个 sha | 行为锁：移动后重试拿到稳定读数即判绿；耗尽则 rc=3 且 reason 含两个 sha |
| C3 | **档位契约不变**：`0` 可合 / `1` 本 PR 新增红 / `2` 主干红 / `3` 未证实 / `4` 判据自身故障（**五档**；AGENTS 口语的「四档」指不可合的 1/2/3/4）。「tip 移动」归入既有「未证实」档（3），**不新增退出码** | 结构锁：`lib/main-red.js` 的退出码集合仍恰好覆盖 0–4（既有锁已钉） |
| C4 | **CI Failure Handler 改跑 `ubuntu-latest`** | 契约锁（`workflow-contract.test.js`，由 quality-gate Gate 2b 接入 CI）：handler 必须 `runs-on: ubuntu-latest`；步骤不得显式声明 pwsh |
| C5 | 合并入口透传稳定窗参数（`MAIN_RED_ATTEMPTS` / `MAIN_RED_RETRY_SECONDS`） | 接线锁：两个入口仍只调 `scripts/check-main-red.js`，且都排在 REST 合并之前（既有锁已钉） |

### 三条口径澄清（上一轮评审 i1/i2/i4 指出的自相矛盾处）

- **i1 · 档位是五档不是四档**：`0/1/2/3/4` 五个退出码，本片**不新增**任何一档。
- **i2 · 两端「口径一致」指行粒度，不是同一个 API**：主干侧读 `actions/runs`（按 `event` 过滤），
  PR 侧读 `commits/<sha>/check-runs`；两侧的行**都落在作业名这一层**（check-run 名 == 作业名），
  差集仍按名字对齐——**不是「同一个 API」**。
- **i4 · 重试追新 tip，不钉旧 sha**：每次尝试都重新 fetch 取当前 tip，下一次从**新的当前 tip** 开始；
  **不得**把 tip 钉死在旧 sha 上继续判绿。

### C1 与 C4 不混为一体（评审 i3）

C1 解决「读数被噪声污染」（按 `event` 过滤换源）；C4 解决「Windows 并发额度被占」。
迁移后 handler **仍会挂在主干 tip 上**（那是 C1 在读数侧隔离的事，本片不动挂载语义）。

## 不做什么（非目标）

- ❌ 不改分支保护 / ruleset / `CI_IGNORED_PATHS`（「改谁来守门」须人工过目）。
- ❌ 不改 `electron-ci.yml` 的预算与分片（根因已由 #4192 修掉）。
- ❌ 不引入第 5 个退出码；不把 tip 钉死在旧 sha 上继续判绿。
- ❌ 不改 `workflow_run` 的挂载语义；不取消 main push 的 workflow（发版链完整性邻域）。

## Impact

> 这是**声明范围**（CCG 决策层据此判「范围漂移」），必须与实际落地文件一致；
> 实施中途新增的文件**也要在这里点名**。路径写**仓库相对完整路径**（决策层逐字比对 + basename 兜底）。

- 判据本体与入口：`scripts/lib/main-red.js`、`scripts/check-main-red.js`、
  `scripts/check-main-red.test.js`（**行为锁主体**）、`scripts/merge-when-green.ps1`、`scripts/merge-when-green.sh`
- CI 配置与契约锁：`.github/workflows/ci-failure-handler.yml`、`.github/scripts/workflow-contract.test.js`
  （**契约锁**，由 quality-gate Gate 2b 接入 CI，不是只在本地跑）
- 本 change 文档（只声明判据，**不装判据**；可执行证据在上面两个锁里）：
  `openspec/changes/main-red-run-baseline/proposal.md`、
  `openspec/changes/main-red-run-baseline/evidence.md`、
  `openspec/changes/main-red-run-baseline/tasks.md`、
  `openspec/changes/main-red-run-baseline/specs/ci-main-red-gate/spec.md`、
  `openspec/changes/main-red-run-baseline/specs/ci/spec.md`、
  `openspec/changes/main-red-run-baseline/.openspec.yaml`
- 执行记录：`openspec/records/main-red-run-baseline.md`

> 另有 `.ccg/reviews/<sha>.json` 由 pre-commit 的 CCG 判定自动生成（产物，非人工改动）。

## 影响面

运行时代码**无**（不触 `apps/`、`packages/`；QM-1 打包 N/A）。退出码集合不变；主干基准来源从
「commit 上的全部 check-runs」换成「该 tip 的非 workflow_run run 集合」。CI 墙钟：读数的
**排队**部分预计缩短（Windows 额度释放），`quality-gate` 的 44 分钟真实执行时间**不变**。
风险：若某条真实检查只经 `workflow_run` 途径产生，它将不再进入基准（实测：三条真实 workflow
全部是 push 触发，无此情形）。
