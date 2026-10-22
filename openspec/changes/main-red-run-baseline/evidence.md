# 证据：main-red-run-baseline 的现场读数

> 本文件是 `proposal.md` 的证据附件。拆出来的原因：CCG 决策层的**修订环节**要把
> 「方案正文 + 评审意见」一起喂给出方案后端（opencode），实测该后端输入上限 7800 字符
> （边界 8125–8145），方案正文超过就会**被同步拒绝**（~120ms、exit 1、无错误信息），
> 于是评审停在"挑完刺但没人回应"那一格。证据表是给**人**看的现场，不是评审对象。
> 判据本体（`openspec/changes/main-red-run-baseline/specs/`）与提案同目录。

## E1 · 主干侧的检查清单被同名噪声淹没（读数失真）

GitHub 的语义：**workflow_run 触发的工作流的 check run 一律挂在默认分支当前 tip 上**，
不管触发它的是哪个 PR 的 CI。CI Failure Handler（`.github/workflows/ci-failure-handler.yml`）
监听 5 个 workflow（`Build & Release` / `Electron CI` / `quality-gate` / `GUI Tests` / `Doc Sync Gate`），
于是**仓库里每完成一次 CI，主干 tip 就多一条同名 `handle-ci-failure`**。

实测（2026-10-22 09:0x，仓库 `Colinchiu007/mulpub`）：

| 读数 | 值 |
|------|-----|
| 主干 tip `8da92948` 的 check-run 总行数 | **102** |
| 其中 `handle-ci-failure` | **81**（同一个名字，来自 30 个 handler run） |
| 真实信号行数 | 21 |
| 25 分钟内（17:07→17:31）新增的 handler run | **29**（全部挂在同一 tip） |
| 闸门实测读数 | `MAIN-RED verdict=INCOMPLETE exit=3 … mainPending=4` |
| 同一时刻**真实**未完成的检查 | **2**（`QG Coverage`、`electron-tests`） |

即：主干侧 pending 集合里**有一半是噪声**。`main-red.js` 的 `namesBy` 把 81 行折叠成
1 个名字 `handle-ci-failure`，但只要其中任意一条在飞（它们全是 `windows-latest` 作业，
在挤爆的托管池里排队），主干侧就多出一个 pending，闸门立刻判「未证实」——
**哪怕三条真实 workflow 全绿**。噪声规模与 tip 的存续时间成正比：tip 越老，噪声越多。

取证命令：

```bash
gh api "repos/:owner/:repo/commits/<tip>/check-runs?per_page=100" \
  --jq '"总行数=\(.total_count)  handle-ci-failure=\([.check_runs[]|select(.name=="handle-ci-failure")]|length)"'
gh api "repos/:owner/:repo/actions/runs?head_sha=<tip>&per_page=20" \
  --jq '.workflow_runs[] | "\(.id)|\(.name)|\(.event)"'   # 逐条都是 event=workflow_run
```

## E2 · 读数期间主干 tip 会移动，读数当场作废（移动目标）

闸门读的是「**此刻**的 `origin/main` tip」，而主干 tip 在多会话并发下每 15–30 分钟前进一次。
2026-10-21 21:14 → 22:51 的实测：tip `2f5c0a32f` 静默了 75 分钟，正要出结果时被
`8da92948` 顶掉；闸门读数时 tip 又跳了一次，判 `INCOMPLETE exit=3`
（`main=8da92948 … prPending=1 mainPending=4`）。

旧实现**只读一次、判一次**：tip 移动不作废读数、也不重试，合并入口
`scripts/merge-when-green.ps1:81` 拿不到读数就 `FAIL(7)`，让人从头重跑脚本。

## E3 · Windows 托管并发额度被挤爆，读数要等 47–51 分钟才起跑

`electron-tests` / `GUI Tests` / `CI Failure Handler` 三家全在 `windows-latest`。
实测主干 push 的 `electron-tests` 作业从「workflow 创建」到「作业起跑」的等待：

| 主干 tip | workflow 创建 | 作业起跑 | 排队等待 |
|---|---|---|---|
| `2a63373d3` | 10:25:38 | 10:29:40 | 4.0 分 |
| `617e4bf69` | 10:54:56 | 11:03:35 | 8.6 分 |
| `e8799536c` | 12:01:36 | 12:02:05 | 0.5 分 |
| `11e7d0ca8` | 13:14:34 | 13:15:04 | 0.5 分 |
| `2f5c0a32f` | 14:51:21 | 15:42:51 | **51.5 分** |
| `8da92948` | 16:20:26 | 17:07:04 | **46.6 分** |

对照：同批次的 `quality-gate`（纯 ubuntu 作业）**零排队**（`run_started_at == created_at`），
但整条真实执行 **44 分 28 秒**（`QG Coverage` 单步 41 分 51 秒）。
所以「主干一次完整读数」的墙钟是 **≈ 45 分钟（Linux 执行）+ 47 分钟（Windows 排队）**，
而 tip 每 25 分钟就跳一次。

> 参照：`.github/scripts/workflow-contract.test.js` 里已有同型先例——
> quality-gate 的 `changes` 作业被锁死为 `ubuntu-latest`，理由原文是
> 「判定只依赖 git+node，必须用 ubuntu（**不占 Windows 并发额度**）」。
> CI Failure Handler 同样是「只跑 gh CLI + node」，却还占着 Windows 额度。

## E4 · 已经修掉的那一半（不在本片范围，但要记）

`electron-tests` 在主干上长期红，根因是「单步串行跑完整个桌面套件 + 步骤预算 2100s」，
负载放大耗时后撞墙（实测 2101 秒整被 `timeout` 掐掉，rc=124）。
**根因已由 PR #4192 修复并合入主干**（`1dc7417ed`，2026-10-22 01:48：一步切两片并发 +
共享预算 2700s + 剥 ANSI/时间戳计数）。其后主干连续 3 次 push 的 `Electron CI` 全绿。
本片不再碰 `electron-ci.yml` 的预算与分片。

## E4b · 凭据 scope 实测（i8）

```
gh auth status → Token scopes: 'gist', 'read:org', 'repo', 'workflow'
```

`repo` 覆盖 `actions/runs`（需 `actions:read`）与 `check-runs`（需 `checks:read`）——
本片两个端点都真读到了（下面的烟测读数就是证据）。**不新增任何仓库 secret**。

## E4c · required check 的触发事件（i7）

当前 10 条 required check 全部由 **push/PR 触发**的 workflow 产生——
`quality-gate.yml`（QG Static / QG Unit Tests / QG Coverage / Gate Result）、
`electron-ci.yml`（electron-tests）、`build.yml`（build）、`gui-test.yml`（gui-test / GUI Gate Result）、
`doc-gate.yml`（文档同步检查）、`debt-guard.yml`（债务熔断检查）、以及「单元测试 + Lint」所在 workflow。
**没有一条 required check 只由 `workflow_run` 产生**（那只产 `handle-ci-failure`，它不是 required），
所以本片排除 `workflow_run` **不会吞掉任何 required check 的红**。
（required 名单变化时这条要重核——登记为遗留的观测点。）

## E5 · 本片落地后的实跑读数（真实 API 烟测）

```
MAIN-RED verdict=NEW_RED exit=1 main=ab806ce0f54bd9e0fb7097f11a6cade0512944f6
  pr=ac908c47b8aefecec549923335038007b2901364 prFail=2 mainFail=0 newRed=2 uncertain=0 unknown=0/0 prPending=7 allow=no
  理由：本 PR 自己引入的红（主干上没有同名红）：QG Unit Tests, build（PR 侧另有 7 条未完成，不影响这一条已被证明）
```

对照旧实现同期的读数：`mainPending=4`（其中 2 条是 `handle-ci-failure` 噪声）⇒
判「主干基准不稳」。新实现的 `mainFail=0` 且判定**直接落到可归因的那一条**。
