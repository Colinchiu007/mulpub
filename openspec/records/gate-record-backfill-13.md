---
record: gate-record-backfill-13
task: 回填 ci-quality-rhythm-whitelist（#3188）与 pr-dark-baseline-gate（#3221）的远程同步行并销账，并对齐 gate-record-backfill-12（#3145）正文里与既有 PASS 行矛盾的 PENDING 措辞
date: 2026-10-09
---

## 本次执行记录：回填 #3188 / #3221 远程同步并纠正 #3145 的 PENDING 措辞（gate-record-backfill-13，2026-10-09）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（**提交后**复跑）→ 结果见下表
- 变更类型与隔离声明：纯文档/流程变更（只动 `openspec/records/*.md`），按分层规则本可就地编辑；因并发会话多、且回填要跑取证脚本，仍走隔离 worktree `mp-gate-record-backfill-13`（分支 `gate-record-backfill-13`），经 PR 落地
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 编码完整性 ✅ | 文档同步 ✅ | Gate 2c ✅ | 远程同步 PASS（PR #3229 已 squash 合并，main `a3e632c3cba0646715a79c34f4aad262ae1083fe` @ 2026-10-10T00:07:00+08:00；取证 `git log origin/main --grep='(#3229)$' --format=%H|%cI` 恰 1 行、`git ls-remote --heads origin gate-record-backfill-13` 返回 0 行；本记录未登记 ledger，无登记项可删）

### 这批实际收了几笔：2 真收 + 1 措辞对齐，不是 3 真收

任务清单里挂着「#3145 合并后回填销账」，我按它准备当第三笔真收。动手前读 `origin/main` 实况时发现**该篇的 `^\| 远程同步 \|` 行早已是 `PASS`**（第 46 行，附 merge SHA `67a5047ff`，正文还写着「本文件为 #3164 批量回填的漏项，由本次回填 PR 就地闭合」），frontmatter 也没有任何 `sync_*` 字段。所以 #3145 这笔**不是欠账**，我从任务清单继承了一个过期前提。

真正未收口的是两篇：`ci-quality-rhythm-whitelist`（`| 远程同步 | PENDING |` + 三个 sync_* 字段）与 `pr-dark-baseline-gate`（同形状）。本轮改动因此是：

| 记录 | 动之前 | 动之后 |
| --- | --- | --- |
| `ci-quality-rhythm-whitelist` | 表格行 PENDING + frontmatter 三字段在 | 表格行 `PASS（PR #3188 → main 9d2618058 @ 2026-10-09T22:59:13+08:00）` + **三字段同次删除** |
| `pr-dark-baseline-gate` | 表格行 PENDING + frontmatter 三字段在 | 表格行 `PASS（PR #3221 → main 8a64e3d1e @ 2026-10-09T23:48:27+08:00）` + **三字段同次删除**，并补「门禁②的端到端证据」整节 |
| `gate-record-backfill-12` | 表格行**已是 PASS**，但正文「保留门禁」那句仍写 `远程同步 PENDING（本条自己的欠账）` | 该句改为 PASS + 同一份取证，**表格行与 frontmatter 未动**（本来就闭合） |

净效果 **2 收 1 开**（开的是本条自己），仍满足"一轮至少闭合两篇"的下界；若我按最初口径把它写成「3 收 0 开」，就是拿一个过期前提冒充成果。

### 顺带暴露的判据盲区（只登记，不在本 PR 修）

`check-gate-record-debt.js` 的行判据是 `ROW_RE = /^\|\s*远程同步\s*\|/`（:25），只看**以 `|` 开头的表格行**；而 docs-only 记录按 AGENTS.md 精简模板把状态写在 `- 保留门禁：… | 远程同步 PENDING` 这种 **bullet 内**，该行不会被 `ROW_RE` 命中 → 于是 `readRecord()` 找的是别处的表格行（若有），bullet 里的 PENDING 对门禁**完全失明**，`#3145` 这次的"行 PASS、正文 PENDING"就是它的现场产物。这不是本轮引入的，也不在本轮范围内（本轮只改文档，改判据属运行时代码变更，需独立 PR + 反证）。登记于此，供下一个动这条门禁的会话取证。

**本轮当场撞上的对照现场**：本记录初稿只写了 bullet 形态的 PENDING、没有表格行，`check-gate-record-debt.js` **当场**报 `❌ 记录文件整块缺 远程同步 行 1 篇 —— gate-record-backfill-13.md`（rc=1）。所以"整行缺席"是被拦住的；真正漏网的是**行已 PASS、bullet 仍写 PENDING** 这种两处并存且互相矛盾的形态 —— 它有两行里的其中一行合规，判据看不到另一行。

### 证据（每条三源，缺一不回填）

| 记录（== 分支名） | PR | main 上的 squash 提交 | committer | 远端分支 |
| --- | --- | --- | --- | --- |
| `ci-quality-rhythm-whitelist` | #3188 | `9d2618058292377b9620095639694d2f6f5ff316` | 2026-10-09T22:59:13+08:00 | `git ls-remote --heads origin` = 0 行 |
| `pr-dark-baseline-gate` | #3221 | `8a64e3d1e4110f1d8d7b5b8790ad797babe70840` | 2026-10-09T23:48:27+08:00 | 同上 0 行 |
| `gate-record-backfill-12`（仅措辞对齐） | #3145 | `67a5047ff8aaab28bf57e2146a161ad32aa8afeb` | 2026-10-08T15:40:13+08:00 | 同上 0 行 |

三源均在本轮**当场重跑**（`node D:/Data/projects/.tools/tmp/vt-rb/bf13.cjs probe` 输出 `main_lines=1 / remote_branch_lines=0` ×3），不凭上一轮的记忆抄写。

### #3221 的端到端现场（本轮把它落进它自己的记录）

#3221 让暗档在 PR 侧可判，它的判据不是"我断言我做了"，而是本 PR 自己那次 `QG Visual` 的日志现场 + main 首次 push 的转绿。本轮把两段现场写入 `openspec/records/pr-dark-baseline-gate.md` 的新节「门禁②的端到端证据（本 PR 就是第一次，已实跑）」，关键行：

- PR 侧（run `37948835371` / job `QG Visual` id `113883853017`）：`像素结果[dark]: 19/19 通过，0 失败`、`[GATE-7] suite exits: pixel=0 views=0 views-supplement=0 dark=0`、`基线新鲜度[partial…]：检查 41 张 / 违规 0 张 / … / 本次跳过 3 张`，未判定名单只有 `analytics-overview.png` / `login-form.png` / `settings-general.png`（脚本断言 `dark_in_skipped=false`）。
- main 侧（Visual Tests run `37954471616` / job `visual-test` id `113901352944`，head `8a64e3d1e`，success）：`基线新鲜度：检查 41 张 / 违规 0 张 / … / 本次跳过 0 张`；`gh run list --workflow visual-test.yml --limit 8` 显示其前四个 main push（`aecb75ab3` / `15fd49c0d` / `8b3d3e91f` / `07550cf37`）全 failure。
- **同一节里如实登记了残留**：Gate 7b 的 round2 暗档重采在本 run 没有被运行时执行过（round1 干净即 `exit 0`），它的保障目前只有结构锁，运行时现场要等下一次 round1 报违规的 run。

### 远程同步状态

| 门禁 | 状态 | 取证与后续动作 |
| --- | --- | --- |
| 远程同步 | PASS（PR #3229 已 squash 合并，main `a3e632c3cba0646715a79c34f4aad262ae1083fe` @ 2026-10-10T00:07:00+08:00；取证 `git log origin/main --grep='(#3229)$' --format=%H|%cI` 恰 1 行、`git ls-remote --heads origin gate-record-backfill-13` 返回 0 行；本记录未登记 ledger，无登记项可删） | 本 PR 尚未合并，merge SHA 还不存在。合并后由后续回填轮把本行改写为 `PASS（PR #NNNN → main <sha> @ <committer ISO8601>）`，并在**同一次提交**删除 frontmatter 的 `sync_status`/`sync_reason`/`sync_backfill_owner` 三字段与本行以外的 PENDING 措辞；取证一律用 `git log origin/main --grep='(#NNNN)$' --format=%H |

### 本地门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| Gate 2c 欠账自证 | `node scripts/check-gate-record-debt.js` | rc=0；`远程同步行 255 条 / 执行记录 463 篇 / 已登记欠账 8 条 / 记录文件 138 篇（含本篇）`，顶部 `OK…记录文件登记字段无残留` |
| 品牌残留（硬红线） | `node scripts/check-no-brand-residue.js` | 见下表（提交后复跑） |
| 编码完整性 | `node scripts/check-text-encoding-integrity.js` | 见下表（提交后复跑） |
| 行尾两口径对账 | `git diff --numstat` vs `git diff --ignore-cr-at-eol --numstat` | 逐文件相等：`1/4`、`1/1`、`17/7`（改前三份均 `i/lf w/crlf attr/text=auto`，脚本按 CRLF 逐行写回，改后 `lone LF=0`） |
| docs-only 判定 | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` | 提交后复跑，结果见结论 |
| 执行记录取证 | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` | 见结论 |
| ledger 销账 | 三篇的标题均不在 `scripts/gate-record-debt-ledger.json`（该文件 8 个键全是 2026-08 的 `.quality-gates.md` 历史标题） | 无登记项可删；"回填与删登记项必须同一次发生"在此表现为**两侧都无事可做**，已逐个核对而非默认 |
