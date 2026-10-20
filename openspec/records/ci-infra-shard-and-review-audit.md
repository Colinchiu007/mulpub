# 执行记录：QM-6 记录欠账只读审计档 + Electron CI 分片方案（ci-infra-shard-and-review-audit，2026-10-20）

> 变更类型：**质量基础设施**（`scripts/` 判据辅助 + `.github/workflows/`）⇒ 混合 PR，走完整质量节拍。
> **两处目标均命中 `HIGH_RISK_SURFACES`**（`scripts/check-`、`.github/workflows/`）⇒ 按 `AGENTS.md`
> 属「改谁来守门」，**由人工过审，agent 不自动合并**。

## 1) 变更类型与隔离

| 项 | 读数 |
| --- | --- |
| 隔离 | 隔离 worktree `<仓库父目录>/mp-worktrees/mp-ci-infra-shard-and-review-audit`（与仓库同一块非系统盘，非 C 盘），裸分支名 `ci-infra-shard-and-review-audit` |
| 入口 | `./scripts/session-init.sh ci-infra-shard-and-review-audit`，产物：`verify-worktree-deps` 11 项 OK、`ensure-electron` v43.7.7 就绪 |
| 共享根 | 留在 `main` 且 clean，未在其中落盘 |
| 分层 | 含 `.github/workflows/` ⇒ 运行/门禁面 ⇒ 必须 worktree（已满足） |

## 2) 做了什么（只读审计档）

`node scripts/check-pr-exec-record.js --audit [--json] [--limit=N]`：新增只读审计档，
把主干上累积的未闭环记录**分档并给出归因**。enforce 路径**一行未改**（`--audit` 分支
早退于一切取证之前，结构上不进判定）。

四条硬约束与对应锁（`scripts/check-pr-exec-record.audit.test.js`，**7 例**）：

| 约束 | 锁住的失败形态 |
| --- | --- |
| 不判定「已修/未修」 | 记录无 branch/PR 字段、无 finding→修复提交链接 ⇒ 任何"已修好"判定都是编的 |
| 落地归因比「文件是否在 origin/main 树里」而非 sha | squash 后主干是新对象，按 sha 判会把每个已合并 PR 误判成未落地 |
| 只读 | 跑完工作区无改动、无新提交（审计自己变成写方是最大风险） |
| 永不阻断 | 未闭环 40 条也 exit 0；仅 `--limit=abc` 这类用法错误 exit 2 |

**真实读数**（`--repo=<共享根>`，耗时 **1657 ms**，全程 **2 次 git spawn**）：

```
记录总数 : 1509 ｜ dual : 433 ｜ 已闭环 : 156 ｜ 未闭环 : 277
  pending 254 ｜ error 15 ｜ self_play_blocked 4 ｜ self_play_adjudicated 2 ｜ self_play_pending 2
已落地 433 ｜ 未落地 0
待人工看的 findings 条数（未闭环 dual 累加）: 17
```

**最重要的一条结论**：277 条未闭环里**只有 17 条 findings** ⇒ 欠账主体不是「277 个没修的
问题」，而是「277 份**没有结论**的记录」。这与 `openspec/changes/ccg-convergence-exit`
的诊断一致（验证层单轮 critic + `currentRound` 谎报 ⇒ 出口①②不可达）。所以**减少这批欠账
只能改判定写入方**，清理文件或批量补 closureNote 都不是解法。

## 3) 做了什么（Electron CI 分片：**只出方案，不提交实现**）

方案与精确补丁写在 `openspec/changes/quality-infra-2026-10/proposal.md` §What Changes 2)。
不提交实现的三条理由（任一都足以停手）：

1. 需改写「自证块必须真能执行」这把锁（`apps/desktop/tests/gui-ci-exit-contract.test.js`），
   它用文本替换后**真跑**一遍来防装饰性门禁；并行 `&`/`wait` 聚合改动会让替换点与自证
   时点都要重设计，改错正是 #2525 的原始失效形态。
2. 单片预算必须由**一次真实 main push** 给出，不能拿 `794/2` 推算（本仓反复出现的
   「把推算当实测」）。
3. 分片改变「全仓单 worker 串行」语义 ⇒ 影响该步骤原本承担的 flake 检出意图，需产品级确认。

同时更正了此前一处**我自己的不准确表述**：近 16 次 main 运行 11 次 failure 里，实证为
`rc=124` 超时的至少 3 次，**另 1 次是真失败且与超时无关**（`4a610ded4`：
`elapsed=1844s budget=2100s rc=1`，红在 `windows-file-lock.test.js` 的 Windows 时序用例）。
两者必须分开归因。

## 4) 测试

| 层 | 读数 |
| --- | --- |
| 新增锁 | `node --test scripts/check-pr-exec-record.audit.test.js` ⇒ **7/7 绿**（先写测试，6 红之后实现转绿） |
| 既有锁 | `node --test scripts/check-pr-exec-record.test.js` ⇒ 见 §6 |
| 接线 | `.github/workflows/quality-gate.yml` 增加 `node --test scripts/check-pr-exec-record.audit.test.js`，否则新锁不跑 |

## 5) 门禁

见 §6 逐条读数（提交时补齐）。

## 6) 门禁读数（本地实跑，2026-10-20）

| 判据 | 读数 |
| --- | --- |
| `node --test scripts/check-pr-exec-record.audit.test.js` | **7 / 7 绿**（先 6 红，后转绿） |
| `check-max-lines.js` | ✅ 无新增超大文件，挂账清单与现实一致（`超限=95 挂账=95`） |
| `check-unwired-tests.js` | ✅ OK（域内 112 个测试文件全部已接线或已登记） |
| `check-no-conflict-markers.js` | ✅ OK |
| `check-doc-abs-paths.js` | ✅ PASS（首次跑红：我把本机绝对路径写进记录；已改为 `<仓库父目录>` / `<共享根>` 占位符 —— 这是本仓反复出现的形态，记在此处备查） |
| `check-locale-sync.js --keys` | ✅ PASS（2180 个 key 均存在） |
| `eslint --quiet`（三个改动文件） | ✅ rc=0 |
| QM-1 打包 | **N/A** —— 本次未改 `apps/desktop/electron/**` / `packages/rpa-engine/**`，不触发 |
| QM-4 视觉 | **N/A** —— 无 UI 变更 |
| QM-6 深度审查 | **未闭合，且按规矩不由 agent 自证**：目标命中 `HIGH_RISK_SURFACES`，闭环只认 `tier=external` + 可核 evidence；`closureNote` 在这一档不够格 |

### ⚠️ 本 PR 的合并前提（写清楚，避免下个会话误判）

1. 命中两处高危面 ⇒ **必须人工过审**（`AGENTS.md`「禁止自动合并的情形」第二条）。
2. QM-6 需要**外部评审**（双后端 claude + opencode；`sh scripts/deep-review.sh --check-deps` 实测通过）。
   agent 不代签、不写 `resolution`、不把 `pending` 改成闭环词。
3. 分片方案只是文档，未改 `electron-ci.yml` ⇒ 本次不改变任何 CI 行为。


## 7) 保留门禁

变更类型与隔离 ✅ | 行尾对账（以 CI 为准）| 品牌残留（以 CI 为准）| 文档同步 ✅（PRD 无需改；
本文 + change proposal 即文档）| 执行记录 ✅ | 远程同步 ⏳

| 远程同步 | 由门禁推导 |
| --- | --- |
