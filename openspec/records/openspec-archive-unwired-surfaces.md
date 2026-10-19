---
record: openspec-archive-unwired-surfaces
task: 归档最后一个频率 change（publish-frequency-unwired-surfaces）并把 2 条 ADDED + 1 条 MODIFIED 并入主干规格
date: 2026-10-20
---

## 本次执行记录：归档 publish-frequency-unwired-surfaces（openspec-archive-unwired-surfaces，2026-10-20）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯规格/文档变更（只动 `openspec/**`）⇒ 按 AGENTS 分层规则本可就地编辑；实际仍用隔离 worktree `<仓库父目录>/mp-worktrees/mp-openspec-archive-unwired-surfaces` + 裸分支 `openspec-archive-unwired-surfaces`（入口 `bash scripts/session-init.sh`，基线 `4fa810d95`），经 PR 落地。判定 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 见下方读数 |
| 归档前置对账（第一性原因 QM-5 ①） | PASS | 这条 change 的 delta **未并入主干**是"归档从不在合并后收尾清单里"这一结构性缺口的最后一处残留（记忆 [[project-openspec-archive-after-merge]] 2026-10-18 条）。当场核对三项前提后才动手：① 主干 capability 存在且已同步（`openspec/specs/publish-frequency-control/spec.md`，实测 Requirement **22** 条、`### Requirement: 间隔维度与策略单一真源` 在第 32 行）；② 两条 ADDED 的名字在主干**不存在**（`grep -c` = 0）；③ MODIFIED 块的 scenario 集合是主干那块（2 条）的**超集**（我 4 条 ⊇ 主干 2 条）⇒ CLI 的 fail-closed（scenario 标题集合差）不会误中止，也不需要 `--skip-specs` |
| 逃逸分析（QM-5 ②） | PASS | 本片的"缺陷"不是代码而是**归档从未被任何收尾清单要求**：`openspec/changes/publish-frequency-unwired-surfaces/` 在 PR #3712 合并（2026-10-16）后原地留了 4 天，其 delta 也从未进主干 ⇒ 主干规格读起来像"频率契约只有 22 条"，而实现里已有启动期裁剪与死接口禁令。归类 流程缺失（AGENTS「合并后收尾清单」6 步不含 `openspec archive`，已在记忆里登记为结构性缺口） |
| 修复 + 回归保护（QM-5 ④） | PASS | 归档动作：`openspec archive publish-frequency-unwired-surfaces -y` ⇒ `Totals: + 2, ~ 1, - 0`，存档名 `2026-10-20-publish-frequency-unwired-surfaces`，落点判据 `git diff --cached --name-status` = **3 条 R100 + 1 条 R080 + 1 条 M**（三个文件纯移动、tasks.md 是移动+我这两处编辑、只有主干规格被改）。归档后主干 Requirement **22 → 24**，两条新 Scenario（`日配额越界在两条路径上都被拒（但拒绝方式不同）` 第 60 行 / `UI 的上界来自下发，不来自抄写` 第 67 行）与两条新 Requirement（第 521 / 558 行）逐个 `grep -n` 命中；`TBD` 计数 = 0；`openspec validate publish-frequency-control --type spec --strict` = **valid** |
| 防止再次发生（QM-5 ⑤） | PASS | ① 归档**前**纠过期勾选：`tasks.md` 顶部新增「## 0. 归档处置对账」表，两类处置分开写 —— 4.4 补勾（四个条件各有产物：merge SHA `456214660…`、合并前 `gh pr checks 3712` = 23 pass/0 fail/0 pending/1 skipping、回填销账 #3744、worktree/分支退役现场 + `retire/publish-frequency-unwired-surfaces-20261017` 在位）；3.6 **保持未勾**（要求的是外部双模型 + 原件入库，三条外部通道实测不可用，随后用户指定自演双轴 ⇒ **自演不等于外部交叉审查**，补勾就是拿替代做法冒充未建立的能力）。② 主干 Purpose 那句「共 6 条」是**已被 #3910 否证、又被我进一步否证**的过期陈述（实测当时已是 22，归档后 24），改写为「判据只认本文件当前列出的 Requirement 与其 Scenario，不在此写死计数」——把会随归档漂移的量从散文里删掉，而不是改一个新数字继续漂 |
| 行尾与 diff 对账 | PASS | 两个被我编辑的文件 `git ls-files --eol` 均为 `i/lf … attr=text=auto`；重建 tasks.md 时**逐行按原文件 EOL join**（`headRaw.includes("\r\n")` 判定），并用行多重集对账：`head_missing=0 / unexpected_extra=0`（除声明的两处编辑外与 HEAD 版零差异）。`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径见提交前实测 |
| 接线棘轮 | N/A | 本片不新增测试文件；`node scripts/check-unwired-tests.js --root=.` 自证读数见提交前电池 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（`apps/desktop` / `packages/` / 渲染层），产物与像素判定域无交集 |
| QM-6 CCG 双模型外部评审 | N/A（纯规格文档） | AGENTS：「纯文档/流程变更不强制 QM-6，但建议执行」。本片被机械链命中的风险点是"改谁守门"以外的规格文本，且判据全部给了可复算读数 ⇒ 未执行；如实登记，不以自审冒充 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导（只认 squash 尾注 `(#NNNN)`）；写成 `PASS` 会被判 prematureClaim 而红 |

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见 PR 正文现场读数（改动集只含 `openspec/**` ⇒ docs-only=true）
- 保留门禁：判定与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅（随 CI）| 文档同步 ✅（`openspec-sync-check` 0 violations，archives 241→242）| 远程同步 PR #NNNN

### 现场读数与对照

| 判据 | main 侧 | 本分支 | 归因 |
|---|---|---|---|
| `node scripts/openspec-sync-check.js` | OK: 387 tasks / 72 active / **241 archives**，rc=0 | OK: **387 tasks** / 71 active / **242 archives**，rc=0 | tasks 数不变 ⇒ 重建没有增删任务行；active −1 / archives +1 ⇒ 正是这一篇归档 |
| `openspec validate --all --strict` | 200 passed / **26 failed** | 199 passed / **27 failed** | 集合差**只有一条** `change/member-tier-contract`，它随基线 `4fa810d95`（PR #4051，他人会话）进来，与本分支无关；本分支触碰的三个路径名在两份失败清单里 `grep -icE "unwired"` = **0** ⇒ 路径不相交 |
| 主干 Requirement 计数 | 22 | 24 | `+2 added` 与 CLI 自报 `Totals: + 2, ~ 1` 一致 |

**取证纪律**：计数对照必须**先做集合差再做计数差**，且失败清单不得用 `head` 截断 —— 本片第一次核计时就用 `head -30` 截了列表并据此报"0 命中"，重跑不截断才发现那条 `member-tier-contract`（它不是我引入的，但**当时我无法知道**这一点，靠截断得到的"0"是探针失明，不是结论）。

### 我自己在这次归档里犯的一个工具性错误（写下来因为它是复发型）

给 `tasks.md` 打 4.4 补丁时用了 `String.prototype.replace(anchor, newText)`，而 newText 里含 shell 串 `--grep='(#3712)$'` —— JS 把 **`$'`** 解释为「匹配之后的全部文本」，于是把 4.5 那一整块复制进了我新写的续行中间，产出「4.5 出现两次 + 4.4 的续行被拦腰截断」。
- **怎么被抓到的**：不是靠眼看，是 `node scripts/openspec-sync-check.js` 报了一条 `TASKS_MD_DUPLICATE_TASK_ID: task 4.5 appears 2 times`，以及我随后 `sed -n '104,133p'` 读现场看到第 14 行是个孤立的 `` ` 唯一一行，``。
- **修复方式**：不"手工把多出来的删掉"，而是**从 HEAD 原始 blob 重建**该文件，只施加两处声明式编辑，并用行多重集断言 `head_missing=0 / unexpected_extra=0`（这条断言同时也是"重建没有夹带别的改动"的证据）。第一次重建还因 `encoding: "binary"` 把 UTF-8 读成 latin1 而被首行标题断言当场拦下（**写盘前抛错，零损坏**）。
- **口径**：文档正文里出现 `$'` / `` $& `` / `$1` 这类串是常态（本仓大量取证命令就带 `(#NNNN)$`），**任何以字符串为替换体的文本编辑一律用 split/join 或函数式替换**（`s.replace(a, () => b)`）。这条与既有记忆 [[feedback-batch-edit-verify-diff]] 同源，本次是它的第二次实测。

### 遗留（不假装已闭合）

1. `openspec/changes/member-tier-contract` 在 `--type change --strict` 下红，是 PR #4051 落地时带进来的（不在 required 清单里，所以没人被拦）。归属该 change 的会话/人工处置，本片不顺手改别人的规格。
2. 主干规格的 Purpose 文本仍是"人写的摘要"，没有任何机械判据保证它与 Requirement 全集同步（本片只是**去掉了会漂移的计数**）。要真正闭合，需要一条「Purpose 里若出现条数则必须等于实测 Requirement 数」的门禁 —— 属新增守门，未开工。
3. 归档仍不在 AGENTS「合并后收尾清单」里（本片的动因正是这条缺口）。把它写进收尾清单要改 AGENTS 本体，属人工过目项。
