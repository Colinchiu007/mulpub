---
record: gate-record-sync-derived-status
task: 执行记录「远程同步」收口从人工回填改为门禁按主干历史推导（消除回填 PR）
date: 2026-10-17
---

## 本次执行记录：远程同步收口改为门禁现场推导（gate-record-sync-derived-status，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更（`scripts/` 工具 + `.github/workflows/` + CI 判据）⇒ 走隔离 worktree `D:/Data/projects/mp-worktrees/mp-gate-record-sync-derived-status`，裸分支 `gate-record-sync-derived-status`，经 PR 落地。入口 `scripts/start-mp-task.ps1`，依赖三件套实跑：`pnpm install --frozen-lockfile`（56.6s）+ `ensure-electron`（v43.7.7）+ `verify-worktree-deps`（11 个消费方解析通过）。分支/基线以产物核：`rev-parse --abbrev-ref HEAD` = 任务分支、`HEAD..origin/main` = 0、dirty=0 |
| 本仓运行时代码 | ✅ 仅 `scripts/` 与 `.github/` | 未触 `apps/desktop/`、`packages/`、`ops-center/` ⇒ 无产品运行面变更 |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未触 electron 主进程与渲染层，无打包面、无 UI 变更 |
| QM-6 CCG 双模型外部评审 | 见下 | 决策层（plan-review，critic=claude）+ QM-6 后端（claude）+ 前端（opencode）共 3 轴 36 条 findings 已逐条处置；验证层 deep-review（DUAL）见本表末段与 `reviews/` |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件相等（31/0、9/10、8/6、8/5），无行尾改写；工作副本 `i/lf w/crlf` 的既有文件一律保留原行尾（一次变异工具因锚点含 `\n` 未命中，就是这条差异暴露的，已改按 `\r?\n` 匹配） |
| 接线棘轮 | ✅ | 新增 `scripts/lib/merge-ledger.test.js` 已在本 PR 内接进 `quality-gate.yml` 的 `changes` job（无 job 级 `if:`、非 PR 早退之前）；`check-unwired-tests.js` rc=0 且把它摘掉会同时被它与新增的 `workflow-contract` 落点锁点名（变异 M-A/M-B 各红） |
| 存量零漂移 | ✅ | 真仓对账行为锁：同一 main tip 上「派生不可用（= 改前口径）」与「派生可用」两档跑，`open / missingRecordRows / staleRecordFields / statusContradictions / crossSrcViolations` 五个维度逐篇相同，且记录文件字节零改动。现场读数：改前 rc=0、`派生收口=403 / byDesign=0`、旧键歧义 6 篇转可见 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导（只认 squash 尾注 `(#NNNN)`，取最近一次新增）。本次交付自身即被该判据覆盖 |

### 交付物与判据

| 项 | 判据 | 实测 |
|---|---|---|
| 单一取源模块 | `scripts/lib/merge-ledger.js`：合并账本 + 记录归属，判据内不得有第二份 git 解析 | 10 用例全绿；端到端 1.03s；真仓 `prs=1936`、归属可解析 424、歧义 0 |
| 派生收口三态 | `NOT_IN_BASE / NO_FOOTER / PR(n)` 不塌态；优先级链 `missingRow → NOT_IN_BASE → derivedClosed → blobClosed → debt` | `check-gate-record-debt.test.js` 73/73（既有 58 + 新增 15）；N1/N2/N3/N4 变异各红在指名用例 |
| 取不到读数不得判绿 | 三种不可用（ref / 非仓库 / 空账本）退回断言档并出声；CI 档 rc=2 | 真起子进程断言 rc=2 且本机不套用；N5 CAUGHT |
| 净增拦截 | 合并前预写 `PASS` ⇒ `prematureClaims` 红；`delivered_by_pr` 与主干事实不符或读不出整数 ⇒ `intentMismatch` 红 | N3/N7 CAUGHT；真仓两集合均为空（新增防线，不动存量） |
| 兼容读 | 存量 384 篇 blob 闭合、21 篇旧形态登记、2 篇无尾注 ⇒ 全部原样放行 | 真仓对账锁 + `ambiguousPrKeys >= 6` 下界断言 |
| 口径同步 | `_TEMPLATE.md` 四处矛盾一次改完；`AGENTS.md` 取消回填禁令分支、收尾清单重编号；`check-pr-exec-record` 出路④注释不再声称"真实性无人校验" | 邻居套件 19/19、57/57；`check-workflow-structure` rc=0 |
| 相邻缺陷守卫 | 仓侧碰撞拦截（根因在仓外技能的 slug 只用文件名）：同名 slug 且内容不同 ⇒ 拒绝并给出路，知情放行必留痕 | `plan-review-deps.test.js` 9/9；P-A/P-B/P-C/P-D 四条变异各自 CAUGHT |

### 遗留（不假装已闭合）

1. **CI 上的 `MERGE-LEDGER prs=` 真实读数未取**。本机已证 git 侧可行，GitHub runner 的 `changes` job 是否真能解析 `origin/main` 只能等本 PR 的 CI 日志（design 残留风险 1）。取不到就记"派生档未在 CI 生效"，不得拿本机数当成功证据。
2. **旧载体的 23 条 ledger 自指欠账原样保留**（存量不动）。回填 PR 消失后它们应自然消化；本 change 不碰 `.quality-gates.md` 与 `gate-carrier-debt-ledger.json`。
3. **`byDesign` 判定未复用 `changedFileStatuses`**（tasks §6 记为 3.3 偏差）：改用"路径不在 base 归属映射里"，代价是本地陈旧 baseRef 下会把他人已合并的记录判成 byDesign（只少拦不多拦）。评审若否决，换回注入 changeset 即可。
4. **`--current-pr` 旗标已实现但生产无人传**（tasks 4.1 偏差）：byDesign 不依赖它。留着是为将来要把"本次 PR"与"base 缺失"区分开时不必改判据；若被评审判为死参数，删之。
5. **squash 尾注 `(#NNNN)` 是本仓惯例不是 git 保证**：改用不写尾注的合并方式会让派生档整体退回兼容层。该依赖已写进 `openspec-integration` 的新 Requirement，但"谁来守这条"仍靠人工自觉——没有机械锁能看见未来改了合并方式。
6. **归档顺序**：本 change 的 delta 两侧都只能 ADDED（实测 MODIFIED 对不存在基线被 `archive_spec_update_failed` 硬拒）。若 `enforce-gate-record-presence` 后归档，基线里会并存两条描述同一 concern 的 Requirement，靠本 change 正文里的取代声明消歧；彻底收敛需改写对方那条，属他人未归档工件，不在本 PR 动。
7. **M9（严格 reorder 变异）与 2.9 的完整反证**留待片 5 与 M1–M13 一并实跑；未跑就是未跑。
