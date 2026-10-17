---
record: ccg-deg-evidence-tier
task: QM-6 降级梯 切片B预备——用主干普查否证「按 performedBy 前缀分级」，把 tier 改成结构化字段并入库普查工具
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（按「PR 自动合并」收尾清单 1–4 条回填，并整段删除本三个 sync_* 字段）
---

## 本次执行记录：证据分级的判据落点更正（ccg-deg-evidence-tier，2026-10-17）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | worktree `mp-ccg-review-degradation`，裸分支 `ccg-deg-evidence-tier`（**叠加在 #3777 之上**，同一文件 `check-pr-exec-record.js` 不能并行改）。Step ⓪ 守卫：`pre-code-edit-guard.ps1` 在本 worktree 内未阻断（共享根才拒）。内容＝规格更正 + 普查工具入库 + `.gitignore` negation，**未动任何判据代码** |
| 判定（docs-only） | PENDING | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 须在 commit 后取；注意本分支叠在未合并的 #3777 上，判定基数是 `origin/main`（含 #3777 的改动 ⇒ 会读成混合 PR），故本行读数连同**叠加事实**一起写，不假装它是独立 docs-only |
| 第一性原因（QM-5 ①） | PASS | 规格里我原先写的分级判据是 `(status, performedBy)` 二元组、按 `self-play` 前缀分档。引入点＝我自己 2026-10-17 写的 `openspec/changes/ccg-review-degradation-ladder/design.md` §1——**错因不是抄错代码，是没普查就用**：动手前我只读了 decider 的初始化（`performedBy: null`）就假设它是枚举 |
| 逃逸分析（QM-5 ②） | PASS | 单元/集成/视觉层无关（这是规格判据）。逃逸在规格审查层：`design.md` 的 §1 当时读起来"有实测出处（`:444`/`:312-313`）"因而显得可信——**引用两处行号不等于量过全量分布**，而前缀判据的失败恰好只在分布里才看得见（`null` ×744 谁都过，问题在那 12 条散文） |
| 修复 + 回归保护（QM-5 ④） | PASS | ① `spec.md` 的判据句改写：`tier` 必须是**结构化来源字段**，MUST NOT 从 `performedBy` 自由文本推断，佐证复用既有口径「`findings` 是非空数组」（`shouldPreserveClosedRecord` 主判据同源，不造第二套词汇）。② `design.md` 新增 §9/§9.0，把普查数字与两条更硬的现场（12 条 self-play 开头却声明外部复核；`cleared`/`needs_revision` 配 `pb=null f=null` 的零出处闭环）写进去。③ 普查工具**入库** `scripts/ccg-artifact-shape-survey.js` + `.gitignore` 补 `!scripts/…` negation（实测 `check-ignore` 现命中 negation 行 117）⇒ 覆盖面数字可在仓库内一句话重取，不留孤立读数。④ `tasks.md` 1.1 改为 **blocked on decision**，并新增 1.0 已勾项 |
| 防止再次发生（QM-5 ⑤） | PENDING | 待 §9.1 合同裁决后落机械锁：`tier` 的闭集校验 + 覆盖率**可见不拦**先行、转拦需覆盖率读数（主干 `dual+pending` 存量 220 条，直接转拦＝一上线红两百条，正是该文件头部 forward-only 注释点名的失败形态）。本条不留成口号：判据与反证已写进 tasks 1.1/1.2 |
| 行尾与 diff 对账 | PENDING | commit 后取两口径 numstat。本分支既有文件为 CRLF 工作副本 / LF blob（`git ls-files --eol` = `i/lf w/crlf attr/text=auto`），新入库脚本按 LF 写；`.gitignore` 的 negation 按原档插行、不整份回写 |
| 接线棘轮 | PENDING | 新增 `scripts/ccg-artifact-shape-survey.js`（非 `*.test.js`，不被 `check-unwired-tests.js` 收）⇒ 是否接进 CI 属"要不要每次跑"的预算决定，当前只在被引用时现跑；登记为待裁决，不假装它已被守 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与渲染层 |
| QM-6 CCG 双模型外部评审 | N/A（如实登记） | 按 AGENTS.md「纯文档/流程变更（`openspec/`、`docs/`、`scripts/` 工具脚本）不强制 QM-6」。⚠️ 但本片的**产物是一条判据合同的更正**，且下一步（转拦）会改 required check 判定面 ⇒ 届时不得复用本次豁免，按 #3777 的自反条款走人工过目 + 外部评审 |
| 记录欠账 | PENDING | commit 后跑 `check-gate-record-debt.js` / `check-record-qm5-rows.js` / `check-pr-exec-record.js --mode=enforce` / `openspec validate --strict` 并补读数 |
| 远程同步 | PENDING | 合并后取 merge SHA 与 `(merge SHA, workflow)` 的 main push 读数（纯规格/工具改动预计 `NO_RUN(by design)`，须如实记而非当免检），同次删除本三字段 |

- 保留门禁：判定 docs-only PENDING | 行尾对账 PENDING | 品牌残留 PENDING | 文档同步 PENDING | 记录欠账 PENDING | 远程同步 PENDING

### 待你裁决（本片的唯一阻塞点）

`design.md` §9.1 三个候选合同，差别在「外部证据由谁声明、拿什么佐证」：甲=结构化 `tier`+`evidence`（自报路径，只验存在）；乙=只认 `findings` 非空数组（内容判据，但**干净通过的外部评审往往 findings 为空**，误红面需估算）；**丙（我的倾向）= 甲乙合取且只对新记录生效**，`tier=external` 必须带 `evidence`，`findings` 为空时不拦只点名（"无发现"是合法结论，"没跑"不是）。选错方向的代价不对称：选窄了会把真评审判成没评审（误红，逼人绕），选宽了就还是装饰（假绿）。

### 遗留（不假装已闭合）

- 普查工具未接进任何 CI job，数字要靠人现跑；是否值得每次跑（约 800 份 `git show`，本机能跑完）待裁决。
- §9.0 那条"闭环可以零出处"在裁决前不会有任何机械拦截——它现在只是**被记录下来了**，这一点必须说明白，否则下一个人会以为已经有人在看。
