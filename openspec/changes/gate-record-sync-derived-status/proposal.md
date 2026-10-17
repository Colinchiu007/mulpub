# 执行记录「远程同步」状态改为门禁现场推导（消除回填 PR）

## Why

现状：每个 PR 在 `openspec/records/<分支>.md` 写 `| 远程同步 | PENDING |`，PR 合并后再开一个**回填 PR**把它改成 `PASS` + merge SHA，并删掉 frontmatter 的 `sync_status / sync_reason / sync_backfill_owner` 三字段。

2026-10-17 实测读数（全部取 origin/main，可离线重取）：

- 最近 60 个已合并 PR 中 **32 个是纯回填 PR（53%）**；回填 PR 自身 lead time 中位 6.0 分钟、均值 8.6 分钟。
- 2026-10-15 以来 158 个 main 提交中 **73 个是回填提交**。
- 一条回填 PR 的真实内容只有 3 处改写；实测样本 #3810 的 diff 另含 **26 行 pre-commit 自动带出的 `.ccg/reviews/<sha>.json`** 判定产物，即"内容改动"与"提交噪声"的比例是 3:26。
- `scripts/gate-record-debt-ledger.json` 现存 **23 键**，Explore 逐条核对结论为"全是回填 PR 自己挂账的自指条目"——机制在自己制造欠账。

根因不是流程啰嗦，是**键选错了**：merge SHA 只有合并之后才存在，于是记录永远无法在开 PR 时写完整，只能二次落笔；而分支保护对直推 `refs/heads/main` 一律 `GH011`，二次落笔就只能再走一次 PR。这是循环依赖，不是纪律问题。

第二个更严重的问题是**判据读的是断言不是测量**：`check-gate-record-debt.js` 判"收口"的依据是状态列以 `PASS` 开头，而这个字是人在合并前或合并后手写进 blob 的。合并前写 `PASS` 门禁无法分辨（本仓已实测到"已回填记录被并发整取重放倒退回 PENDING""同一篇两条 `远程同步` 行互相矛盾而 rc=0"两类事故），即门禁把"有人这么说"当成了"这事发生了"。

## What Changes

把收口证据从「合并后才可知的 merge SHA（必须有人回填）」换成「git 里本来就有的事实：这篇记录是被哪个已合并 PR 带进主干的」，让门禁自己去做那次取证。

1. **收口证据不来自任何人工字段**：判据说的是「哪个已合并 PR 首次把这篇记录文件带进 `main`」，这是 git 的一等事实，合并后自动可知、合并前必然不可知，**无法被提前伪写**（design.md D1）。记录里可选地声明来源 PR（`sync_pr`），它**不作为收口依据**，只用来与 git 事实交叉核对——两者不符即判红，专门抓"把别人的记录夹带进我的 PR"（D4）。
2. **新增单一实现 `scripts/lib/merge-ledger.js`**：一次 `git log origin/main --diff-filter=A --name-only --no-renames` 建「记录文件 → 归属 PR」映射，配合一次 `--format=%s` 建合并账本（只认 squash 尾注 `(#NNNN)$`）。实测该遍历把每篇记录唯一解析到归属提交，歧义 0，端到端 1.03 秒；可解析的已合并 PR 数量随 main 前移而增长（本轮两次读数 1924 → 1926，**差 2 是两次测量之间主干前移，不是同一事实有两个值**，故一律按下界断言，见 design D9）。
3. **`check-gate-record-debt.js` 的收口判定改为三态**：
   - `blobClosed`——状态列命中既有闭合词表（旧形态，**兼容读、存量不动**）；
   - `derivedClosed`——状态列未闭合，但该记录文件确由某个已合并 PR 首次带入基线 ⇒ 派生收口，**不需要任何写回**；
   - `debt`——两者都不成立 ⇒ 真欠账。唯一豁免：该文件是**本次变更集**新增（自己不能证明自己已合并），但其状态列若预写闭合词则判红。
4. **账本不可用时不得判绿**：取不到 ref／解析失败／账本规模读数为 0 一律退回"旧形态判据"（只认 blob 里的 `PASS`），并把不可用原因出声打印；CI 步骤必须打印 `MERGE-LEDGER prs=<n>`，让"这一趟到底测没测"留现场。
5. **文档与模板同步**：`openspec/records/_TEMPLATE.md`、`AGENTS.md`（docs-only 快速通道的回填 SOP、「PR 自动合并」合并后收尾清单第 3–6 步、「旧载体冻结」相关句）、`scripts/check-pr-exec-record.js` 的"出路④不校验 PENDING→PASS 真实性"注释（这条信任边界在本 change 后**不再成立**，不改就是装饰性注释）。

## 不做什么（明确排除）

- **不做**任何"合并后自动往 main 写一笔"的机制（bot 直推 main 需分支保护豁免，属改「谁来守门」，且与仓规「禁止直推 refs/heads/main」正面冲突，并会自我触发的新一轮 push）。
- **不做**存量 406 篇记录的全量改写：实测 21 篇未闭合记录**状态行内均无 PR 号**，派生判据对它们的读数改动前后必须逐篇相同（这是"存量不动"的机械证据，见 tasks 片 2）。
- **不删除** `sync_status / sync_reason / sync_backfill_owner` 三字段的既有判据：旧载体与那 21 篇旧形态记录仍依赖它关历史账。
- **不放宽**闭合词表与"未知写法即未收口"的 fail-closed 口径。

## Impact

- 受影响 capability：`quality-gate-execution-record`（MODIFIED 一条 Requirement + ADDED 两条）、`ci-path-gating`（docs-only 判定合同里"回填"相关表述，本 change 以 ADDED 补一条派生收口的前提，不改写既有 Requirement 正文）。
- 代码：`scripts/lib/merge-ledger.js`（新）、`scripts/check-gate-record-debt.js`、`scripts/check-pr-exec-record.js`（注释与提示）、两个 `.test.js`。
- CI：`.github/workflows/quality-gate.yml` 的 `changes` job（该 job **无 job 级 `if:`**，docs-only 不短路，是派生判据唯一正确的落点；`static-gates` 有 `if:`，接进去等于把判据挂到可被跳过的 job 上）。
- 文档：`AGENTS.md`、`openspec/records/_TEMPLATE.md`、`CHANGELOG.md`、`01-docs/learnings.md`。
- **归档顺序依赖（必须如实说）**：`quality-gate-execution-record` 这个 capability 目前**只存在于尚未归档的 change** `enforce-gate-record-presence`（`openspec/specs/` 下无该目录，`grep -rl 远程同步 openspec/specs/` 为空）。本 change 的 MODIFIED delta 引用的那条 Requirement 位于该 change 的 `specs/.../spec.md:84`。两个 change 都实现完但未归档（前者剩 8 项、后者剩 5 项未勾）。处置口径写进 design.md D7：本 change 的 delta **自带完整 Requirement 正文**（不是"只写差异"），使任一归档顺序下 `openspec/specs/` 都能收敛到同一份文本，并在 tasks 片 5 实跑两种顺序的 `openspec validate`。

## 收益（可量化验收）

- 回填 PR 数：新 PR 的回填动作从「1 个 PR + 1 轮 CI + 一次合并」降为 **0 个 PR、0 次补写**——记录里没有任何需要事后改的状态字段，合并本身即证据。
- 判据强度：从"读人写的断言"升为"读 git 现场"，合并前写 `PASS` 不再能骗过派生通道（派生通道压根不看状态列写的是什么）。
- 兼容性：存量 406 篇逐篇判据读数零漂移（硬验收）。
