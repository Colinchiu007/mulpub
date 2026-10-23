---
record: ccg-decider-merge-skip-archive
task: 把已合并的 ccg-decider-merge-skip 归档进 openspec/changes/archive/ 并把 delta 同步成主规格 ccg-review-decider
date: 2026-10-23
---

## 本次执行记录：归档 ccg-decider-merge-skip 并同步主规格 ccg-review-decider（ccg-decider-merge-skip-archive，2026-10-23）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档（改动 5 个路径全在 `openspec/**` 下、全为 `.md`，命中 `scripts/classify-docs-only.js` 的 `CI_IGNORED_PATHS`）：共享主工作区就地编辑 + 经 PR 落地，**未**进 worktree；未触 `apps/`、`packages/`、`scripts/`、`.github/` |
| 第一性原因（QM-5 ①） | N/A | 本刀零代码改动，改的是规格文本与目录位置；被判定的行为本身已在 PR #4232 落地 |
| 逃逸分析（QM-5 ②） | N/A | 同上；本刀发现的「delta 与实现不同步」按下方「防止再次发生」处置 |
| 修复 + 回归保护（QM-5 ④） | N/A | 行为回归锁 T1–T11 与变异 M1–M16 已在 #4232 合入（`scripts/ccg-review-decider.test.js` 71 例）；本刀不改实现，无新增锁可写 |
| 防止再次发生（QM-5 ⑤） | ✅ | delta 相对实现的两处缺口在归档时补齐：第 4 条 Requirement（合并态读不到交集）此前**只有正文没有 `#### Scenario:`**，第 5 条（探测失明与「真的不在合并中」分开，实现与 T9 已合入）**根本没进规格**。补齐后 `openspec validate ccg-decider-merge-skip --strict` 由 rc=1 变 `is valid`；新主规格 `✓ spec/ccg-review-decider` |
| 行尾与 diff 对账 | ✅ | 两口径相等：`git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 逐行同值。rename 检出 `R100 design.md / R100 proposal.md / R092 tasks.md / R064 delta spec`，新增 `A openspec/specs/ccg-review-decider/spec.md`。删除数 5 全部归因：`tasks.md` 里 4 行是 5.2–5.5 的 `[ ]`→`[x]` 就地改写、1 行是 M15 说明段尾行被扩写成 4 行（**无**幽灵行、**无**整文件重写） |
| 接线棘轮 | N/A | 未新增 `*.test.js` / `*.test.ps1`，不涉及 `check-unwired-tests.js` 的登记面 |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 UI 文件；无运行时代码 |
| QM-6 CCG 双模型外部评审 | N/A | 纯 `.md` 文档归档，按 AGENTS「纯文档/流程变更不强制 QM-6」。`scripts/ccg-review-decider.js` 的 `isDocsOnly()` 把 `.md` 记为 docs-only ⇒ 不落入 `mode=dual`；判定产物随本次提交写入 `.ccg/reviews/<sha>.json` |
| 远程同步 | 由门禁推导 | 不事后改写、不手写状态词：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注 `(#NNNN)` 推导归属；现场读数以判据首行 `MERGE-LEDGER prs=<n>` 为准 |
| 旧载体冻结 | ✅ | 未向 `.quality-gates.md` 插块、未向 `scripts/gate-record-debt-ledger.json` 加键（change: `freeze-legacy-gate-carrier`）；本记录只落在 `openspec/records/<分支名>.md` |

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 在 **commit 之后**取证（预提交取会得空差量假结论，`HEAD==base`），`docs-only=true`；具体 `files=` 读数写在 PR 正文。
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导（本行不写状态词、不写 PR 号占位）
- 保留门禁（续）：并跑 `scripts/check-gate-record-debt.js`、`scripts/quality-rhythm-spec-mirror.test.js`、`scripts/check-spec-purpose.js`、`scripts/openspec-sync-check.js`、`scripts/check-doc-abs-paths.js`，读数见下表。

### 归档动作与读数

| 步骤 | 命令 | 实测读数 |
|------|------|---------|
| 归档前校验 | `openspec validate ccg-decider-merge-skip --strict` | `is valid`（rc=0）。补齐前该 change **不合法**：第 4 条 Requirement 缺 `#### Scenario:` |
| 归档 | `openspec archive ccg-decider-merge-skip -y` | rc=0；`Specs to update: ccg-review-decider: create`、`+ 5 added`、`archived as '2026-10-23-ccg-decider-merge-skip'`。归档后旧 change 目录在磁盘上**已不存在** |
| 归档目录完整 | 逐文件 `Get-Item` + 与 `origin/main` blob 对账 | 4 个文件齐全（`design.md` 28015 / `proposal.md` 5196 / `tasks.md` 21732 / `specs/ccg-review-decider/spec.md` 7408 字节，磁盘态），无 `.openspec.yaml`（主干该 change 本就只有 4 个 tracked 文件）。`design.md`/`proposal.md` 与主干 blob 的**字节差恰等于 CR 数**（+400 / +78）⇒ `openspec archive` 只翻行尾、未改内容 |
| 主规格形状 | 逐行比对 + 计数 | `openspec/specs/ccg-review-decider/spec.md`：130 行 / 129 个 LF（纯 LF）/ `### Requirement:` **5** / `#### Scenario:` **10** / `TBD` **0** / `created by archiving` **0**；自 `### Requirement:` 起与归档 delta **逐行比对 0 处差异** |
| 主规格校验 | `openspec validate ccg-review-decider --type spec --strict` | `is valid`（rc=0）；`openspec validate --all --strict` 的输出里该行为 `✓ spec/ccg-review-decider` |
| Purpose 段 | `node scripts/check-spec-purpose.js` | 155 份主规格、违规 **0**、rc=0 |
| 同步一致性 | `node scripts/openspec-sync-check.js` | `OK: 387 tasks, 101 active changes, 244 archives`，rc=0；`openspec list` 已不含该 change |
| 文档绝对路径 | CI 同款口径 `node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD` | 改动集 6 个文件按 `[A-Za-z]:[\\/]`、`/home/`、`/Users/`、`/mnt/`、`/d/`、`%USERPROFILE%` 六形态扫描 **0 命中**（新增文档统一用 `<worktreeRoot>` / `<tip>` / `<merge SHA>` / `%TEMP%` 占位）；账本 `scripts/doc-abs-paths-baseline.json` **未被触碰**（未新增、未放宽）。CI 同款口径的 `counts=` 读数必须在 commit 之后才取得到差量，写在 PR 正文。**另记一处不属本刀的红**：本机 `--all` 全量模式会扫到他人会话未跟踪产物 `.ccg/evidence-ccg-deep-8e315f3b-multi-account/proposal-v1.md:680` 而红，该文件是 `??` 状态、不在本次提交内，且 CI 用改动集口径不覆盖它 |

### delta 在归档时被扩写并改名（为什么不是纯搬运）

1. **改名**：delta 目录名原本是 `specs/ccg-decider-merge-skip/`，那是 **change slug**，不是能力名。归档生成的主规格目录名取自 delta 目录名，若照原名搬运，`openspec/specs/` 下会多出一个以「变更」命名的能力。因此 `git mv` 成 `specs/ccg-review-decider/`（语义能力名，先核实 `origin/main` 上该目录未被占用），归档后才长成 `openspec/specs/ccg-review-decider/spec.md`。代价如实记录：历史记录 `openspec/records/ccg-decider-merge-skip.md` 的 numstat 行引用旧 slug 路径，那是**历史快照，不改写**。
2. **补第 4 条的 Scenario**（`合并态读不到交集时打印「未判定」且不落盘`）：正文早已存在且实现已合入，但缺 `#### Scenario:` ⇒ `openspec validate --strict` 判 rc=1，归档会把不合法 delta 带进主规格。
3. **补第 5 条 Requirement**（`合并态探测的「失明」MUST 与「真的不在合并中」分开`）：`detectMergeState()` 的 `probeError` 三档分治与其行为锁 T9 已随 #4232 合入，**规格此前完全没反映**——这是「实现先落地、规格漏同步」，不是本刀新增功能。补齐后带两个 Scenario（探测失明必须出声 / 真的不在合并中不得告警），把三档不可同形写成可校验的形态。
4. 度量：旧 delta blob 86 行 / 4 Requirement / 7 Scenario → 现 126 行 / 5 / 10（`+40 −0`，LF 原始；磁盘态因 `openspec` CLI 在 Windows 的写入形态呈 CRLF，`* text=auto` 在 stage 时归一为 LF，与既有归档目录的 `i/lf w/crlf` 同形，故**不做**磁盘归一化）。

### tasks.md 的处置（不把未实测写成实测）

- `[x]` **60** / `[ ]` **1**。勾选的 5.2–5.5 均附可核证据：merge SHA `7178ad27c`（`state=MERGED`，`mergedAt=2026-10-22T11:19:02Z`）、`git ls-remote --heads origin ccg-decider-merge-skip` 返回 **0 行**、`retire/ccg-decider-merge-skip-20261022` → `bff24e7b0`、`check-branch-merged.js --ref bff24e7b0 --merge 7178ad27c` **rc=0 / `files=9 identical=9`**、四个 workflow 在 `7178ad27c` 上全部 `conclusion=success`（run `39769657366` / `39769657285` / `39769657324` / `39769657340`）、`safe-worktree-remove.ps1` `-WhatIf` 干跑 → 实跑 → R7 与基线一致。
- 唯一未勾的是 **M15**，并明确标注「**非交付物**、预测项、未实测」：它是同一处 pathspec 的第五条变异探针，缺它只影响该探针的取证完整度（M14 已覆盖「观测面收窄」这一格），不影响已合入行为。归档时按未实测原样保留，**MUST NOT** 改写成实测。

### 遗留（不假装已闭合）

- M15 变异**未实测**，据实保留未勾选（见上）。把推断写成实测是本仓反复记过的失守形态。
- `openspec validate --all --strict` 现报 **39 条失败**，逐条点名后**全部是其它 active change**（`change/avatar-voice-clone`、`change/main-red-liveness` 之类），本 change 与其主规格均不在其中；但**没有做 A/B 对照**（未在未改动的 `origin/main` 上重跑同一命令），因此只能写「本刀没有新增这些红」，**不能**声称「与本刀无关已验证」。
- 残留空目录 `<worktreeRoot>/mp-ccg-decider-merge-skip`（`entries=0`）`rmdir` 仍报 `EBUSY`，持有者未确认；按 R0 禁止递归删除，故**未清理**，留待重启后重试。它不阻塞本刀归档。
- 本刀只让 delta 与已合入实现一致；**规格与实现的长期同步**仍无机器判据在看——`openspec validate` 查结构（必需段、场景覆盖），不查「规格是否漏掉已落地的分支」。要拦得住必须新增一条「实现分支 ↔ Requirement 覆盖」的判据，那是另一刀。

## CHANGELOG 条目

# docs(openspec): 归档 ccg-decider-merge-skip 并同步主规格 ccg-review-decider（ccg-decider-merge-skip-archive）

- 把已合并的 `ccg-decider-merge-skip` change 归档进 `openspec/changes/archive/2026-10-23-ccg-decider-merge-skip/`，并新增主规格 `openspec/specs/ccg-review-decider/spec.md`（5 Requirement / 10 Scenario）。
- 归档时补齐了 delta 与实现之间两处漂移：第 4 条 Requirement 缺 Scenario（此前 `openspec validate --strict` 判不合法）、第 5 条「探测失明与『真的不在合并中』分开」整条未进规格（实现与 T9 早已合入）。
- 能力目录从 change slug 改名为语义名 `ccg-review-decider`，避免 `openspec/specs/` 出现以变更命名的能力。
