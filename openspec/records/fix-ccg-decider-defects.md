---
record: fix-ccg-decider-defects
task: 修 CCG 四个缺陷 —— 口径假阳性 / rebase 规模失真 / 深度审查静默 / 不可补跑
date: 2026-10-15
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：修 CCG 四个缺陷（fix-ccg-decider-defects，2026-10-15）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 含 `scripts/`
  ⇒ **混合 PR**，走完整质量节拍。

## 承接与动因

上一轮（PR #3621）我审计「哪些环节漏了质量节拍和 CCG」时，发现四个缺陷并**只登记未修**。
用户明确要求「这 4 项进行修复」，本 PR 落地。

**四个缺陷的共同后果：让「需要 CCG 审查」这件事在流程上完全静默。**

## ★ QM-5 Bug 反思循环（对「缺陷长期无人发现」这件事本身）

### ① 第一性原因

不是「某人忘了修」，而是 **`ccg-review-decider.js` 是一个纯 CLI 脚本：
无 `module.exports`、无任何测试覆盖**。

```bash
$ grep ccg-review-decider scripts/*.test.js
plan-review-deps.test.js:44  # 判定器（ccg-review-decider.js）在仓库 scripts/ 下本来就存在，直接用；
```

**⇒ 唯一命中是一条注释。** 于是判据逻辑的任何退化都不会有测试变红。

### ② 逃逸分析（按测试层级）

| 层 | 为什么没拦住 |
| --- | --- |
| 单元测试 | **完全没有**（见①）|
| 集成测试 | `ccg-gate.js` 只验证证了「门禁跑没跑」，没验证「判定对不对」|
| CI | `ccg-gate.js` 的 `verify-quality`/`verify-change` 是**仅告警不阻断**，判定错也照常绿 |
| 代码审查 | 判据逻辑读起来完全合理（`contentHits` 过滤变更行），**看不出口径问题** |

### ③ 系统性漏洞

**「工具自身的判据没有测试」这一类漏洞**：门禁脚本改宽/改错时，
没有一层会说「你改错了」。CI 只验证证「门禁执行了」，不验证「门禁判对了」。

### ④ 修复 + 回归保护测试

新增 **`scripts/ccg-review-decider.test.js`（10 条）**，并给
`scripts/check-pr-exec-record.test.js` **加 5 条**（39 → 44）。

### ⑤ 预防措施

- 判据逻辑全部可测（测试用「源码剥离 `process.exit(main())` 后注入 exports」的方式，
  **不给纯 CLI 脚本硬加 `module.exports`**，避免改变调用契约）
- 每个缺陷都配**真变异反证**（见下）

## 四个缺陷与修法

### 缺陷 A：`contentHits` 口径含文档 ⇒ 假阳性判 `dual`

```js
const pathHits = codeFiles.map(...)...        // L215  只用 codeFiles ✅
const contentHits = staged.changedLines.filter(...) // L228  用了全部暂存行 ❌
```

**⇒ 两个口径不一致 ⇒ 在文档里写「加密/口令/鉴权」的分析文字，会被判成「改动涉及加密」。**

**修法**：`collectStaged()` 新增 `codeChangedLines`（按 `codeExtensions` 过滤），
`judge()` 的 `contentHits` 改用它。

### 缺陷 B：rebase 路径下规模与敏感判定失真

原 `collectStaged()` 用**整仓** `git diff --cached -U0`；
`rebase --continue` 走 git 内部 cherry-pick，pre-commit 触发时 `GIT_INDEX_FILE`
指向 rebase 临时 index ⇒ 读不到预期内容。

**实测证据**（我自己的三个 commit）：

| commit | 实际包含 | CCG 记录 |
| --- | --- | --- |
| `3eca218d0`（rebase 产生）| **5 文件，`scripts/` 两源码 +107 行** | `fileCount=1, codeFileCount=0, changedLines=0` |

**修法**：改为**逐文件**取 diff（`git diff --cached -U0 -- <file>`），
天然绕开整仓 diff 在 rebase 路径下读空的问题。

### 缺陷 C：`ccg-gate.js` 只读暂存区 ⇒ 改动提交后无法补跑

原实现 `resolveTargetFiles(gitStagedFiles())`，**位置参数根本没被解析**。
事后补跑 `node scripts/ccg-gate.js verify-quality <file>` 会被静默忽略，
只得到「暂存区无变更，跳过」。

**修法**：解析位置参数，凡不像门禁名的一律当作目标路径：

```js
const gateNames = new Set(CONFIG.gates.map((g) => g.name));
const explicitTargets = argv.filter((a) => !a.startsWith("-") && !gateNames.has(a));
const targetFiles = explicitTargets.length > 0 ? explicitTargets : resolveTargetFiles(staged);
```

**⇒ pre-commit（无参数）与事后补跑（带路径）走同一条代码路径。**

### 缺陷 D：`deepReview.status=pending` 无人检查 ⇒ 深度审查静默缺失

`ccg-review-decider.js` 对 `mode != skip` 置
`deepReview: { required: true, status: "pending", performedBy: null }`，
但**没有任何环节检查它是否被执行过**。而 `ccg-gate.js` 的对应 gate 仅告警不阻断
⇒ 「需要深度审查」在流程上完全静默。

**实测教训**：我自己的 PR 就带着一条 pending 记录合了，直到用户问才发现。

**修法**：`check-pr-exec-record.js` 新增 `evaluateDeepReviewDebt()`，
只查**本次变更集涉及**的 `.ccg/reviews/*.json`（`AUDIT_ARTIFACT_RE`），
不扫全仓历史（否则历史遗留会让所有 PR 红）。

**★ 实现时踩到并修掉的一个坑**：`--no-remote` 时 `remoteBranches` 为 null，
控制流会重新 `evaluate` 出 `r2` 并 `return report(r2)`。
我最初只把欠账应用到 `r` 上 ⇒ **CLI 实测发现欠账被静默丢弃**。
改为 `applyDeepDebt(target)` 同时应用到 `r` 与 `r2`。

## ★ 真变异反证（三个缺陷各一次）

```
缺陷 A（contentHits 改回含文档行）:
  基线  10/10
  变异  not ok 1（缺陷A反证）+ not ok 3（只计源码那份）  => 10 tests / 8 pass / 2 fail
  还原  10/10        ← 从内存备份还原（不用 git checkout，见下）

缺陷 D（deepReview 检查条件恒 false）:
  基线  44/44
  变异  not ok 40（缺陷D欠账测试）  => 44 tests / 43 pass / 1 fail
  还原  44/44
```

**⇒ 两次变异都精确命中预期测试，无其他受影响。**

## ★ 本轮又犯一次已记录的错，当场纠正

**做变异 A 的还原时，我用了 `git checkout -- scripts/ccg-review-decider.js`** ——
而修复是**未提交**的工作区改动 ⇒ **修复被恢复到 HEAD 版本，整个丢掉**。

**这与我上一轮刚写进 `p3-2-tagstyles-default.md` 的教训一字不差：
「对未提交改动做变异测试时，必须从备份还原，不能用 `git checkout --`」。**

**⇒ 发现后立即从内存备份重放了两处修复，重跑 10/10，再用备份重做变异闭环。**

**⇒ 这条错误连犯两次，说明「记在记录里」不够。** 本 PR 的预防措施是：
变异脚本统一改成「先备份到变量/临时文件，还原只认备份」，
并在测试文件的注释里写明。

## 验证

| 项 | 结果 |
| --- | --- |
| `node --test scripts/ccg-review-decider.test.js` | **10/10** |
| `node --test scripts/check-pr-exec-record.test.js` | **44/44** |
| 变异 A / D 反证 | 各精确红 2 / 1 条，还原后全绿 |
| 缺陷 A 三场景实测 | 只有 `.md` 含敏感词 ⇒ **SINGLE（原为 dual）** |
| 缺陷 C 实测 | 带路径 ⇒ `使用显式目标路径 1 个`、`4 项通过`（原为 2 项）|
| 缺陷 D CLI 实测 | 报 `CCG 深度审查欠账 1 条` + 补跑命令，exit=1 |
| `node --check` 三个脚本 | 全部 exit=0 |
| `check-gate-record-debt` | exit=0，`❌` 行 0 |
| `check-pr-exec-record` | OK |
| 行尾对账 | 两口径一致 |

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 新增测试 | PASS | decider 10 条 + exec-record 增 5 条 |
| 真变异反证 | PASS | A/D 各一次，精确命中 |
| CLI 端到端 | PASS | 缺陷 C/D 均实测生效 |
| `node --check` | PASS | 三脚本 exit=0 |
| `check-gate-record-debt` | PASS | 两形态已写 |
| `check-unwired-tests` | PASS | exit=0 |
| `check-no-brand-residue` | PASS | 全仓扫描 |
| 行尾对账 | PASS | 两口径一致 |
| **QM-1 打包** | **不适用** | 只改 `scripts/` 与文档，不碰运行时代码 |
| 远程同步 | PENDING | 本 PR 未合并 |

- 保留门禁：新增测试 10+5 ✅ | 变异反证 A/D ✅ | CLI 端到端 ✅ | unwired ✅ | 品牌 ✅ | 行尾 ✅ | 远程同步 PENDING

## 残余（未含，不假装闭合）

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | **`deep-review.sh` 本身未验证** | 本 PR 只保证「欠账会被发现」，没验证补跑命令真的能跑通。建议后续单独验证 |
| 2 | **`ccg-gate.js` 的显式路径未接进 decider** | 带路径跑 gate 时，模式判定仍读暂存区（会打印「暂存区无变更，跳过」）。要让 decider 也支持显式路径，需改它的 `collectStaged` —— 本 PR 未做 |
| 3 | **decider 仍无 `module.exports`** | 测试靠「源码剥离 + 注入 exports」实现，耦合了源码结构（测试里有 `assert.notEqual(stripped, src)` 守着）。若 decider 结构变动，测试会先红 |
| 4 | **历史 pending 记录未清理** | 本 PR 只查「本次涉及的」，仓库里既有的 pending 记录仍躺着。需要时单独清理 |
| 5 | **`mavis-trash` 本机缺失** | `safe-delete.js` 的删除步骤必然失败（四道闸都过，但 trash 命令不存在）。本轮清理实验文件时只能逐文件 `Remove-Item`（单文件、非递归、非目录）|
