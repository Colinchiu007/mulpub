---
record: artifact-cleanup-resilient
task: 修 `cleanup` 定时作业连续红（GitHub artifacts 列举间歇 500 × 无重试的 --paginate）
date: 2026-10-21
---

## 本次执行记录：artifact 清理作业改为逐页列举 + 每页重试 + 失败不静默（artifact-cleanup-resilient，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档（`.github/workflows/` ×2 + `scripts/` 新判据本体）。入口 `scripts/session-init.sh artifact-cleanup-resilient`（`start-mp-task.ps1` 被共享根 `clean:false` 的 heath 检查 fail-closed 挡住 —— 那两个未跟踪 `.ccg` 文件属他人在飞会话，不动它们）；`rev-parse --abbrev-ref HEAD` == 分支名、起点 `HEAD == origin/main == 2f5c0a32f`、`verify-worktree-deps` OK |
| 第一性原因（QM-5 ①） | ✅ | 不是脚本逻辑写错，是**把它绑成一次成败的形状**错了：`gh api --paginate` 把 54 页列举串成一条管道，任意一页 5xx ⇒ `set -euo pipefail` 整步退出。取证：`GET /repos/…/actions/artifacts` 现读 **HTTP 500 + `Content-Length: 0`**（gh 因此报 `unexpected end of JSON input`，读起来像"我们的解析坏了"）；同一 URL 隔几秒再请求 ⇒ 200；`per_page=1` 500 而 `per_page=100&page=3` 200 ⇒ **间歇性**，不是某个坏记录。`total_count=5350`（≈54 页）⇒ 每天必撞一次 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：逻辑内联在 `run:` 块里，**没有任何测试载体**；集成/CI 层：它只在 schedule 上跑，PR 侧根本不触发；审查层：不是 required check，`check-main-red` 按检查名对齐时才第一次把它显形。红自 **2026-10-14** 起连续 8 天（窗口内 8/8 `completed failure`），期间没有任何东西在看它 |
| 系统性漏洞（QM-5 ③） | ✅ | 两类：① 「承载 CI 行为的 `run:` 块」没有可测载体（同仓先例已要求把逻辑抽成脚本 + 接进 PR 侧作业）；② **schedule 作业的健康度无人监控** —— 这条本片只做了"让它自己能红得有意义"，监控本身是另一刀（见遗留） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 逻辑搬进 `scripts/cleanup-artifacts.js`（只依赖 node 内置；注入 `api`/`del`）：逐页列举 + 每页重试、首页失败判 `UNPROVEN` 且一条都不删、半途失败判 `DEGRADED` 但仍如实处理已列举部分、`--write` 才删、DELETE 带 `--silent`。行为锁 `scripts/cleanup-artifacts.test.js` **12 条**（A1-A12）；接进 `quality-gate.yml` 的 `changes` 作业 `Gate 2b10`（只跑锁、不跑真删），`check-unwired-tests` 现读 `检查域内测试文件 118 个 → OK` |
| 变异反证 | ✅ | 驱动 `D:/Temp/mutate-ac.cjs`：**7/7 CAUGHT、红集互不相同** —— n1 首页失败当"无待删"→A4；n2 去重试→A3；n3 expired 也删→A1；n4 cutoff 退成当天零点→A2；n5 dry-run 也删→A7；n6 去掉 `--silent`→A9；n7 半途失败仍判 OK→A5。每条断言 `# tests >= 12`，还原 md5 一致 |
| 夹具自己的一课（不写成实现缺陷） | ✅ | 首版 7 条红的根因是夹具取页码用了 `/page=(\d+)/` —— 它先匹配到同一 URL 里的 **`per_page=3`** ⇒ 每页都读成第 3 页 ⇒ 全体"空页"。判据：`[?&]page=`。写进注释当永久提醒 |
| 行尾与 diff 对账 | ✅ | 三处 CRLF 面改动（`.gitignore`、`quality-gate.yml`、`cleanup-artifacts.yml`）均用"按当场 eol 逐行写回"的脚本插入，未统一回写；两口径 numstat 对账由提交前检查留证 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | 未执行（PENDING） | 本笔代码变更量落在 DUAL 阈值附近，判定器结论与本节读数以当场为准。**深审尚未跑** ⇒ 本 PR 不满足自动合并判据第 4 条，不得合并。`.github/workflows/` 属高危面前缀 ⇒ 闭合只认 `tier=external` + 可核 `evidence`，`closureNote` 不够格 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

- 判定：混合 PR（含 workflow 与 `scripts/` 判据本体），不走 docs-only 快速通道
- 保留门禁：品牌残留 ✅（11503 tracked 文件）| 绝对路径账本未放宽 ✅ | `check-step-failfast` ✅ | `check-workflow-structure` 16 文件 0 违规 | `check-no-hot-carrier-edit --mode=enforce` 对本 PR 判定 PASS

### 遗留（不假装已闭合）

1. **QM-6 未跑**（上表已标 PENDING）：跑完把裁决逐条追加在本节下方；未闭合前不合并。
2. **schedule 作业的健康度仍无人监控**：本片让 `cleanup` 自己"红得有信息量"（`ARTIFACT-CLEAN … verdict=` 首行 + 非零退出），但仍然没有任何东西在**看**它 —— 连续 8 天全红就是这条缺口的现场。正解是一刀独立的"定时作业健康巡检"（读 `gh run list --event schedule` 的近 N 天结论并出声），属新增常驻判据、须人工过目落点与预算。
3. **500 是上游的，重试只是把可恢复故障挡掉**：若 GitHub 的列举接口退化到重试也救不动，本脚本会判 `UNPROVEN`/`DEGRADED` 并非零退出（不会静默），但**清理仍会停摆**。artifact 存量现读 5350；GitHub 自身 90 天过期是兜底，所以停摆的后果是额度压力而非数据丢失。

## CHANGELOG 条目

# fix(ci): artifact 清理定时作业改为逐页列举 + 重试，首页失败不再被读成"没有待删条目"（artifact-cleanup-resilient）

- 症状：`Cleanup Artifacts` 自 2026-10-21 回溯连续 8 天 `completed failure`，日志只有一句 `unexpected end of JSON input`，看着像脚本坏了。
- 真因：GitHub 的 artifacts 列举接口对本仓（`total_count=5350`，约 54 页）返回**间歇性 500 空体**（实测同一 URL 一次 500 一次 200），而 `gh api --paginate` 把全部页绑成一条管道、无重试，`set -euo pipefail` 于是每天必退出。
- 修法：逻辑从 `run:` 块搬进 `scripts/cleanup-artifacts.js` —— 逐页列举 + 每页重试；首页彻底失败判 `UNPROVEN` 且一条都不删，半途失败判 `DEGRADED`（已列举部分照常处理、结论不得是 OK）；默认 dry-run，真删要显式 `--write`；DELETE 带 `--silent`（204 空体与上面的 500 同形，属潜伏的第二颗雷）。
- 新增行为锁 12 条 + 变异反证 7 条全指名，接进 `quality-gate.yml` 的 `changes` 作业（`Gate 2b10`），使这段逻辑从此在每次 PR 上被执行过。
