---
record: archive-debt-ledger-shape
task: 归档 normalize-debt-ledger-entry-shape，把「欠账登记项只准承载原因」这条需求落进主规格
date: 2026-10-19
---

## 本次执行记录：归档 normalize-debt-ledger-entry-shape（archive-debt-ledger-shape，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档/流程变更（openspec 归档 + 主规格 + CHANGELOG + 本篇记录），`classify-docs-only` 于 commit 后取证并写进 PR 正文。隔离**没有走 `start-mp-task.ps1` 也没走 `session-init.sh`**，两条入口本刀都被**别人的现场**挡住，用的是记忆里已承认的收尾出口（详见下一行），共享根全程停在 `main` 且一字未动 |
| 隔离入口被挡的取证（不写成"我绕过了守卫"） | ✅ | ① `start-mp-task.ps1` ⇒ `mp-worktree-health.ps1 -RequireClean -RequirePrimary` 报 `ok:false`，逐字段读回是 `clean:true / hooks 全部 match / writeGuard.ok:true`，红在 **`outsideWorktrees` 有 2 个注册在标准根之外**（`<仓库父目录>/_mp-v2-wt`、`<临时根>/wt-qm6wb2`）且 `worktreeCount=55`；② `session-init.sh` 报「主目录 main 存在未提交文件」，实测那 7 项全是**他人会话的未跟踪文件**（`.ccg/adversarial/`、`01-docs/PRD-UI-FLOW-CLARITY-*.local-copy-*`、`01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md` 等）。二者都不是本刀能清的账，按既有纪律改走 **`git worktree add --detach <临时根/唯一名> origin/main` + `checkout -B`**（docs-only、不产运行时代码证据，因此不需要 `node_modules`/`verify-worktree-deps`）；两条阻塞事实已报给用户，属机器卫生欠账而非本刀的放行理由 |
| 第一性原因（QM-5 ①） | ✅ | 上一刀（#3949，merge `79f9c6cdd`）交付了判据与数据迁移，却把 change 留在 `openspec/changes/` 未归档 ⇒ 主规格 `quality-gate-execution-record` 里没有"登记项只准承载原因"这条需求，下一个会话读主规格仍会以为往账本里写 `line`/`status` 是合法形态（那正是本刀删掉的东西）。归档落点不靠临场自觉 |
| 逃逸分析（QM-5 ②） | ✅ | 本刀是文档归档，无运行面。真实风险面只有一条：**归档改主规格会不会连带把 vendored 契约镜像判红**（上一刀实测踩过——实现 PR 全绿、归档 PR 当场红 Gate 2b2）。不靠记忆回答：读锁的比对目标 `scripts/quality-rhythm-spec-mirror.test.js:13` 写死 `openspec/specs/openspec-integration/spec.md`，本刀只动 `quality-gate-execution-record` ⇒ 不同 capability，不联动；并把这条判据跑成读数（见下行） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 归档前后各跑一次镜像锁：两次均 **8 passed / 0 failed**；主规格与镜像的 Requirement 计数两侧均 **13**（未被本刀改动）。Purpose 门禁 `check-spec-purpose.js` 前后均「扫描 **154** 份主规格、违规 **0**」——本刀没新建 spec 文件，所以不会写下 `TBD - created by archiving…` 那笔账（实测归档后的 spec 里 `TBD` 计数为 **0**）。`openspec validate --all --strict` 做**真 A/B**（在同一份 origin/main 上另建一个 detached 工作树跑基线）：归档前 **223 items / 201 passed / 22 failed**，归档后 **222 / 200 / 22** ⇒ 离开 changes 域的恰是本刀这 1 项，失败集**逐条不变**（22 条为 `ccg-convergence-exit` 等他人既有，不属本刀、不代清） |
| 归档保真（本刀自己的判据） | ✅ | 归档把 delta 的 Requirement 块**逐行原样**落进主规格：驱动 `verify-archive-fidelity-1019.cjs` 从归档件与主规格各取该块，两侧均 **36 行、5 个 Scenario，逐行全等**；任一行不等即抛错并打印首个差异行。主规格 Requirement 数 3 → **4**。形态核验另加一条：`openspec` CLI 把整份 spec 重写成 LF（`cr=0 lf=166`），两口径 numstat 均为 **37/0** 纯插入 ⇒ 没有把行尾当成内容改动炸开 |
| 防止再次发生（QM-5 ⑤） | ✅ | 上一刀的 tasks 全部绑定实测落点后才是"可归档"：本刀补齐 4.9（清理链的产物判据：`check-branch-merged` rc=0、`lost=0`、`worktree gone: True`）与 4.8（main push 回读），归档器自己也打印过一次 `Warning: 1 incomplete task(s) found. Continuing due to --yes` —— **那句 Warning 就是"归档不许带着未闭合收尾"的现场证据**，本刀是在它之后把最后一项补真再提交，不是靠 `-y` 混过去 |
| 行尾与 diff 对账 | ✅ | 检出档位 `i/lf w/crlf`：CHANGELOG 按其当场档位逐行插（`loneLF=0 / dblCR=0 / cr==lf` 三计数 + 末行换行守恒，写盘前断言）；本篇记录与归档产物为 LF。两口径 numstat（`--numstat` vs `--ignore-cr-at-eol --numstat`，base 取 `git merge-base origin/main HEAD`）在 commit 后取并写进 PR 正文 |
| 接线棘轮 | N/A | 本刀未新增测试文件；归档保真驱动是一次性探针，落 `%TEMP%` 不进仓库，其结论写在本表 |
| QM-1 打包 / QM-4 视觉 | N/A | 零 `apps/desktop/electron/`、零 `packages/rpa-engine/`、零 UI 文件 |
| QM-6 CCG 双模型外部评审 | N/A | 纯文档归档，未触运行行为，按 AGENTS 不强制（不假装跑过；上一刀 #3949 缺的那一轴仍是活欠账，见其记录《QM-6 单轴放行的边界》） |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导；`HAND-CLOSURE 人工改写=…` 与 `MERGE-LEDGER … byDesign=…` 两行给现场读数。合并前本篇不在基线上 ⇒ 走 byDesign 档，不红 |

### 遗留（不假装已闭合）
- **上一刀 #3949 的 QM-6 第二轴仍未补**：`critic=claude` / `proposer=opencode` 当天零交付，只有 codex 一轴真跑。本刀不消这笔账，也不把它读成"已归档即已闭合"。清偿入口与边界写在该 PR 的执行记录里。
- **「proposal 散文里的敏感字样触发 `mode=dual`」没被本刀修**：那要改 `scripts/ccg-review-decider.js` 的判定形态，属改谁来守门 ⇒ 须人工过目，不走 agent 自动合并。
- **`openspec validate --all --strict` 的 22 条既有失败**（`ccg-convergence-exit` 等）属他人会话，本刀只证明"归档没有新增失败"，没有代清。
- **机器卫生**：标准根之外注册着 2 个 worktree、本机 worktree 总数 55、共享根躺着 7 项他人未跟踪文件——这三条合起来让两条正规隔离入口今天都不可用。清理它们需要逐个按归属判据（mtime 众数锚点 + 与 main 逐字节比对）核，且多半属于别的在飞会话，本刀不代删。
