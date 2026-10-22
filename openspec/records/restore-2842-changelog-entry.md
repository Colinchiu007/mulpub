---
record: restore-2842-changelog-entry
task: 把 #2842 squash 漏带的那一行 CHANGELOG「顺带修复」条目逐字节搬回主干——只补记录，不改任何判据与运行时
date: 2026-10-21
---

## 本次执行记录：补回 #2842 丢掉的 CHANGELOG 行（restore-2842-changelog-entry，2026-10-21）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档：`CHANGELOG.md`（+7 行：搬回那一行 1、本次条目 6）与 `01-docs/PRD-BRANCH-MERGED-CHECKER-2026-10-16.md` §13（+19 行）。`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 前两笔后 = `docs-only=true files=2`，本篇记录提交后复跑 = **`docs-only=true files=3`**（终值，含本篇）⇒ 走 docs-only 快速通道。worktree `<仓库父目录>/mp-worktrees/mp-restore-2842-changelog-entry` + 裸分支同名，由 `start-mp-task.ps1` 创建；判成败按产物（`rev-parse --abbrev-ref HEAD` = 分支名、起点 `rev-parse HEAD` = `b14935951`、`status --porcelain` 行数 0、`verify-worktree-deps.js OK`），不按入口 rc |
| 第一性原因（QM-5 ①） | ✅ | 引入点 = `1292b6555`（#2842 的 squash，`2026-10-03T14:43:15Z`）。**逐 blob 取证**（`git cat-file -p`，不用 `git show`，理由见「行尾」那行）：该 merge 的 `CHANGELOG.md` blob = `a12acd8a8`、`ops-center/backend/services/platform_def_service.py` blob = `fab06b022`，两个值都与分支**倒数第二笔** `49165a742`（`14:14:12Z`）**逐字节相同**；而这两处内容都由最后一笔 `214cbb2e2`（`14:55:12Z`）写下（CHANGELOG blob 变为 `53386cda5`）。⇒ 不是"评审改了产物再落地"，也不是"分支在这笔之后自己前进"，而是 **squash 发生在提交之前**——`214cbb2e2` 推上去时 PR 已 closed，GitHub 落的是它当时看到的 head |
| 逃逸分析（QM-5 ②） | ✅ | 逃过了：① PR 侧 CI——它评的是当时 head 那棵树，合并后不再重算，`214cbb2e2` 从未被任何 required check 看过；② 次日的追平提交 `e5fb069b7`（#2852，主题直写「#2842 合并时序错位漏带」）只追平了**代码**（它的红因是 `test_platform_def_seed_limits`，pytest 不读 CHANGELOG）⇒ 记录面的丢失对那次修复结构性不可见；③ 事故当时**还不存在**落地判据（`scripts/check-branch-merged.js` 首版 2026-10-16，晚 13 天）。**为什么现在看得见仍没被代偿**：2026-10-19/20 两轮清理已把这格读成 rc=1 并登记在案，但「判据出声」与「有人去补那一行」之间没有机制——那是流程缺口，不是判据缺口 |
| 系统性漏洞（QM-5 ③） | ✅ | 具体落点：`scripts/check-branch-merged.js::releaseEligibleForLanding` 只回答「能不能删分支」，不回答「这一行该由谁搬回来」；缺的是 **LOST 行 → 补记录 PR** 这条处置通道，不是阈值。**不把这一格写成"判据不够严"**：它已正确报出 `onlyInMerge=0` 并对旗标拒绝放行，读数是对的；本片不动它一个字 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修复 = 把那一行**逐字节**插回原位（标题行后、空行后、`### 根因` 前），内容取自 `git cat-file -p 214cbb2e2dbd:CHANGELOG.md` 的原始字节，不手抄（脚本 `patch-changelog.cjs`，仓库外）。插入前后各做一次精确串相等判定：`main_blob_hits=0 → target_hits=1`，位置 = `EXACT_HITS=1 at_line=7251`。**未新增测试文件**；本片唯一的机器回归判据是落地判据本体：合并后用 **main 上那份** `scripts/check-branch-merged.js` 默认档复跑 `--ref 214cbb2e2dbd --merge 1292b65556`，必须 `lost=0 rc=0`（合并后取，写在收尾） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① PRD 新增 §13，把「合并时刻早于提交时刻」这一形态的逐 blob 证据表入库，并写明它为什么只能读成 `different/onlyInMerge=0`、修法为什么必须逐字节（改写那一行不会清除 LOST，只会把一条记录变成两条互相对不上的记录）；② §13 同时如实登记**没关**的那格（closed PR 之后 head 又动，没有任何门禁在看），并说明拦它属"改谁来守门"、本片不做；③ 本记录 QM-5 ② 把「追平提交只改代码、看不见记录面」钉成一个可复用的归因形状 |
| 行尾与 diff 对账 | ✅ | 两份文件的工作副本实测**全 CRLF**（`CHANGELOG.md` `cr=lf=23513`、PRD `cr=404`），`git ls-files --eol` 均为 `i/lf w/crlf attr/text=auto`，本机 `core.autocrlf=false`——所以行尾一律以当场计数为准，不按配置推断。**踩到并修掉的一处真问题**：PRD 那一笔把工作副本的 CRLF 原样存进了 blob，`git diff --numstat` 报 `424/404` 而 `--ignore-cr-at-eol --numstat` 报 `20/0`（两口径差得远就是行尾被改，AGENTS 那条判据当场可用）；`git add --renormalize` 对这个文件**不生效**（同一次 `add` 里 `CHANGELOG.md` 被正常归一成 LF）。机制已在独立临时仓（`core.autocrlf=false` + `* text=auto`）用四格 A/B 量出：**纯 CRLF** ⇒ blob `i/lf`（正常归一）｜ **CRLF + 任意一个 lone CR**（CR 不紧跟 LF，落文件末尾或中间都一样）⇒ `git ls-files --eol` 变 `i/-text w/-text`，**git 把该文件判成非文本、整条跳过 CRLF→LF 归一**，`--renormalize` 同样 no-op ｜ 混行尾但**无** lone CR ⇒ 仍归一（`w/mixed / i/lf`）。本 PRD 那一笔凭空造出一个 lone CR（追加数组的末元素带 `\r` 而文件没有收尾换行）⇒ 整份 CRLF 入 blob。⇒ **早判据**：`git ls-files --eol` 里出现 `-text` 就是这件事的现场，比等 numstat 两口径对账更早一步。正解是把工作副本写成 LF 再 add，由 `e6f971069` 那一笔退回。**两条口径记录**（下次不要再拿错探针）：① 量 blob 行尾只能用 `git cat-file -p`，`git show <rev>:<path>` 会套 smudge 滤镜（同一份 LF blob 它报 `CR=404`）——记忆里那条"一次读数 248 CR 而真值 0"的探针错乱，根因就是这个；② 最终差量两口径均为 `19/0`（PRD）与 `7/0`（CHANGELOG），逐行剥 `\r` 后与改前**逐行相等**（脚本断言），blob 实测 `origin/main CR=0/LF=23513 → HEAD CR=0/LF=23520` |
| CHANGELOG 两把棘轮 | ✅ | `node scripts/check-changelog-growth.js --base=origin/main --head=HEAD` ⇒ `PASS：base 590 条（590 种标题）全部在 head 591 条（591 种）里，字节 3102251 -> 3104190`；`node scripts/check-changelog-duplicate-entries.js --base=origin/main --head=HEAD` ⇒ `冗余份数 0 -> 0；本 PR 新增副本=0 / OK`。本片不删任何历史条目、不把任何标题的副本数变大（搬回的那一行是正文 bullet，不新增标题） |
| 接线棘轮 | ✅ | 未新增测试文件 ⇒ `node scripts/check-unwired-tests.js` = `检查域内测试文件 117 个 / OK`（域由其他会话在扩，本片不动它） |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` = `PASS（扫描 11447 个 tracked 文件，无品牌残留）` |
| Gate 12c 绝对路径 | ✅ | `node scripts/check-doc-abs-paths.js --all` = `counts=1161 domain=5035 files=561 canJudge=true PASS`；本篇记录与 PRD §13 的工作区路径一律写成 `<仓库父目录>/mp-worktrees/...` 占位符 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面；改动只有 CHANGELOG 与两份文档（`classify-docs-only=true`） |
| QM-6 CCG 双模型外部评审 | N/A（docs-only） | `classify-docs-only=true` ⇒ 按 AGENTS「docs-only 快速通道」跳过 QM-6；**不以自审替代、也不谎称跑过**。本片零运行时变更、零判据变更，需要外部评审的那件东西（谓词与旗标）已在 #4073 评过并落地 |
| 远程同步 | 由门禁推导 | 本 PR 不手写状态词、不为收口另开 PR（`gate-record-sync-derived-status` / #3879）；合并发生即由 `scripts/lib/merge-ledger.js` 推导收口 |

- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | CHANGELOG 双棘轮 ✅ | 远程同步 由门禁推导

## 自测块（当场读数，不预写）

- 搬回那一行的前后判定（脚本 `patch-changelog.cjs`，逐字节、不手抄）：
  `LOST_LINE_LEN=216 CR_IN_LINE=0` → `main_blob_hits=0 tip_blob_hits=1` → 写入后 `crlf=23514 loneLF=0 target_hits=1`、`EXACT_HITS=1 at_line=7251`（上一行 `7249` 是 #2842 的条目标题、`7250` 空行、下一行 `### 根因`）。
  注意 `grep '^[-] 顺带修复'` 在本文件有 **5** 处命中（别的条目里也有这三个字），所以判据用**整串相等**而不是前缀——前缀口径会把别人的记录读成"我那行已经在主干"。
- 静态门禁：`check-no-brand-residue` PASS（11447 文件）| `check-doc-abs-paths --all` PASS（`counts=1161 domain=5035 files=561`）| `check-unwired-tests` OK（117）| `check-changelog-growth` PASS | `check-changelog-duplicate-entries` OK | `check-gate-record-debt` RC=0（两源所有未收口行均已登记；现场可见项：213 篇历史记录整块缺 远程同步行、旧载体同形态矛盾 9 处，均属他人会话存量，不代改）| `classify-docs-only` 前两笔后 `files=2`、本篇提交后终值 **`docs-only=true files=3`**
- 待合并后取的读数（不预写）：① `check-branch-merged.js`（main 上那份、默认档）对 `214cbb2e2dbd / 1292b65556` 必须 `lost=0 rc=0`；② 本 merge SHA 的 main push 回读按「(merge SHA, quality-gate.yml)」判，承载 `check-changelog-growth` / `duplicate-entries` 的是 `changes` 作业，读数写 PR 评论、不写回仓库文件。

## 逐条处置

本片走 docs-only 通道，QM-6 未执行（理由见上表），因此**没有外部评审条目可处置**；自审发现的两个真问题都已在提交里修掉并留了现场：

| 编号 | 发现（自审，当场实测） | 处置 |
|---|---|---|
| S1 | PRD 那一笔把工作副本 CRLF 存进 blob，两口径 numstat `424/404` vs `20/0` | 由 `e6f971069` 退回 LF（逐行内容断言相等）。根因不是"这个文件特殊"，而是**我写进去的那个 lone CR** 让 git 把整份文件判成 `-text` —— 四格 A/B 由仓库外探针 `eol-probe.cjs` 在独立临时仓量出，机制与**早判据**（`git ls-files --eol` 出现 `-text` 即此事）记在上面「行尾」那一行。另记「`git show` 会套 smudge、量 blob 只能 `cat-file -p`」这条探针口径；不改判据、不放宽对账 |
| S2 | 搬回那一行时若用 `- 顺带修复` 前缀判存在，会命中别的条目里同前缀的行（实测 5 处） | 判据改为整串相等；自测块记下这条口径，防止下一个会话用 `grep 前缀` 得出"已经在主干"的假结论 |
