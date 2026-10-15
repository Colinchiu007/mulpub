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

新增 **`scripts/ccg-review-decider.test.js`**（初版 10 条；本轮按评审 i1 追加 `collectStaged` 真实覆盖，**共 11 条**），并给
`scripts/check-pr-exec-record.test.js` **加 8 条**（39 → 47；初版加 5 条，本轮按评审 i2 追加 3 条白名单锁）。

### ⑤ 预防措施

- 判据逻辑全部可测（测试用「源码剥离 `process.exit(main())` 后注入 exports」的方式，
  **不给纯 CLI 脚本硬加 `module.exports`**，避免改变调用契约）
- 变异反证：**只有缺陷 A、D 做了**（见下）。初版此处写「每个缺陷都配真变异反证」，
  **与事实不符** —— 2026-10-15 由 CCG 深度审查（QM-6 评审 i1/i7）指出后改正为实际动作。

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

## ★ 真变异反证（初版标题写「三个缺陷各一次」，**实际只有 A、D 两次**；此处按实改正）

> 标题失真由 CCG 深度审查指出（QM-6 评审 i1/i7）。**声明超出证据**是本仓零容忍的一类问题，
> 且它恰是自动化门禁挡不住、只能靠人守的那一格 —— 故原文保留在此以便追溯，不静默改掉。

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
| `node --test scripts/ccg-review-decider.test.js` | **11/11**（初版 10/10；本轮 +1 条 `collectStaged` 真实覆盖）|
| `node --test scripts/check-pr-exec-record.test.js` | **47/47**（初版 44/44；本轮 +3 条白名单锁）|
| `node --test scripts/ccg-bash-entry.test.js` | **9/9**（本轮 +1 条缺陷 E 真实行为锁）|
| 变异 A / D 反证 | 各精确红 2 / 1 条，还原后全绿 |
| 缺陷 A 三场景实测 | 只有 `.md` 含敏感词 ⇒ **SINGLE（原为 dual）** |
| 缺陷 C 实测 | 带路径 ⇒ `使用显式目标路径 1 个`、`4 项通过`（原为 2 项）|
| 缺陷 D CLI 实测 | 报 `CCG 深度审查欠账 1 条` + 补跑命令，exit=1 |
| `node --check` 三个脚本 | 全部 exit=0 |
| `check-gate-record-debt` | exit=0，`❌` 行 0 |
| `check-pr-exec-record` | **见下方「取证时机」更正** | 初版此行标 OK，但那是**提交前**取的证（此时 `--base` 与 HEAD 相同 ⇒ 变更集为空 ⇒ 走的是另一条理由分支），不是提交后的结论。该失真由评审 i2 指出 |
| 行尾对账 | 两口径一致 |

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 新增测试 | PASS | decider **11** 条（含 `collectStaged` 真实覆盖）+ exec-record 增 **8** 条 + bash-entry 增 **1** 条 |
| 真变异反证 | PASS | A/D 各一次，精确命中 |
| CLI 端到端 | PASS | 缺陷 C/D 均实测生效 |
| `node --check` | PASS | 三脚本 exit=0 |
| `check-gate-record-debt` | PASS | 两形态已写 |
| `check-unwired-tests` | PASS | exit=0 |
| `check-no-brand-residue` | PASS | 全仓扫描 |
| 行尾对账 | PASS | 两口径一致 |
| **QM-1 打包** | **不适用** | 只改 `scripts/` 与文档，不碰运行时代码 |
| 远程同步 | PENDING | 本 PR 未合并 |

- 保留门禁：新增测试 11+8+1（decider 11 / exec-record 47 / bash-entry 9）✅ | 变异反证 A/D + collectStaged + 缺陷E ✅ | CLI 端到端 ✅ | 深度审查已跑并裁决 7/7 ✅ | unwired ✅ | 品牌 ✅ | 行尾 ✅ | 远程同步 PENDING

## 残余（未含，不假装闭合）

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | ~~`deep-review.sh` 本身未验证~~ | **本轮已修并实跑通过** —— 见下「缺陷 E」。原残余项保留删除线以便追溯 |
| 2 | **`ccg-gate.js` 的显式路径未接进 decider** | 带路径跑 gate 时，模式判定仍读暂存区（会打印「暂存区无变更，跳过」）。要让 decider 也支持显式路径，需改它的 `collectStaged` —— 本 PR 未做 |
| 3 | **decider 仍无 `module.exports`** | 测试靠「源码剥离 + 注入 exports」实现，耦合了源码结构（`assert.notEqual(stripped, src)` 守着）。若 decider 结构变动，测试会先红 |
| 4 | **历史 pending 记录未清理** | 本 PR 只查「本次涉及的」，仓库里既有的 pending 记录仍躺着。需要时单独清理 |
| 5 | **`mavis-trash` 本机缺失** | `safe-delete.js` 的删除步骤必然失败（四道闸都过，但 trash 命令不存在）。本轮清理实验文件时只能逐文件 `Remove-Item`（单文件、非递归、非目录）|
| 6 | **缺陷 B 的根因仍是假设** | 见下「缺陷 B 的诚实结论」 |
| 7 | **引擎侧终审未取** | 深度审查的自扮演裁决由 agent 填写后收口，**没有**再跑一次引擎取得终审 verdict |
| 8 | **磁盘曾经打满** | 中途 D 盘 0 字节可用（写入 ENOSPC），由用户自行清理后恢复；期间一次写入失败已补做 |

---

## ★ 本轮追加（2026-10-15）：跑真实深度审查 + 按裁决改正

### 缺陷 E：`deep-review.sh` 永远找不到判定记录（补跑命令本身是坏的）

**这是缺陷 D 的"最后一公里"**：缺陷 D 让欠账可见、并提示「补跑 `sh scripts/deep-review.sh`」，
但那条命令**跑不起来**。

取证：

| 项 | 值 |
| --- | --- |
| `HEAD` | `a711a5e0e…` |
| `HEAD^` | `71e7994e3…` |
| 记录文件名 | `71e7994e3949f8eef38e2a757aa292ac0eaddc2a.json` ← **= HEAD^** |
| `<HEAD>.json` | **不存在** |

成因：判定器在 pre-commit 里跑，那时新 commit 还不存在、`currentSha()` 拿到的是**父提交**
⇒ 记录恒写在 `<HEAD^>.json` 名下。而 `deep-review.sh` 用 `git rev-parse HEAD` 找记录，
找不到就 `exit 0` 打印「判定记录: 无 —— 提交时没跑判定器」。

**⇒ 深度审查在真实流程里一次都没跑起来过。** 更讽刺的是：引擎 `ccg-deep-review.js` 的
`readDecision()` **早就有 `stagedDiffHash` 内容寻址兜底**（其注释专门写了这件事），
却被包装脚本这行早退挡在门外 —— 兜底成了死代码。

**修法**：`MODE` 为空时回退到 `HEAD^` 的 `<HEAD^>.json`（语义正确：该记录描述的正是 HEAD 这一笔的
改动集，因为判定器当时写入的暂存 diff == `HEAD^..HEAD`），并打印命中说明。

**修后实测**：`判定记录按父提交 sha 命中：71e7994e` → `判定: DUAL` → 依赖体检通过 →
引擎内容寻址也命中 → 真的开始深度审查。

### 深度审查结果：critique 7 条，agent 裁决 **7/7 upheld**

引擎跑完走「第三档出口·自扮演裁决」，落盘 `adjudication.json` 并置
`status=self_play_pending`（5/5 条无 verdict）。由 agent 逐条填写
`prosecution / defense / verdict / rationale`，并把模板未取的 i6/i7 一并补齐
（否则「声称 7 条全裁、实裁 5 条」又是一次声明超出证据）。

> **产物位置说明**：`adjudication.json` / `critique-v1.md` / `proposal-v1.md` 位于
> `.adversarial/ccg-deep-a711a5e0/`，该目录本轮已加进 `.gitignore`（审查工作产物，不进主干）。
> **因此这些路径只在本地可见**；裁决的实质内容已按上表落在本记录里，以免证据随目录消失。
> 判定记录 `.ccg/reviews/*.json` 才是进主干的留痕（其中 `deepReview.adjudication` 指向的
> 也是那个本地路径 —— 读到时请以本记录为准）。

| # | 维度 | 指控要点 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | correctness | `collectStaged` 零覆盖；变异标题夸大 | upheld | 新增真实覆盖测试（真实暂存区 + 子进程），**当场抓出真 bug**（见下）；标题已改正 |
| i2 | correctness | 记录 `exec OK` 与自带 pending 记录自相矛盾 | upheld | 改正记录；并暴露判据漏洞（见缺陷 F）|
| i3 | security | 敏感内容限定到源码后，文档里的真凭证失去观测 | upheld | 新增 `docChangedLines` + `docSensitiveContentHits`（**只报告、不改判定**）|
| i4 | correctness | 拼错门禁名被当幽灵路径 ⇒ fail-open | upheld | 改用 `allowedGates` 权威词表 + 显式路径存在性校验，均 rc=2 |
| i5 | performance | 每文件一个 git 进程；catch 静默吞错 | upheld | 改单次 diff 切段；读取缺口记 `lineReadGaps` 并在 CLI 点名 |
| i6 | correctness | 重命名 `old => new` 定位不到 | upheld | 新增 `resolveRenamed`；并修同族的删除文件路径洞 |
| i7 | maintainability | 记录表述与实际不符 | upheld | 已改正 |

### 缺陷 F：我新加的门禁写成了**黑名单**（评审 i2 引出，实测确认）

初版 `evaluateDeepReviewDebt` 判据是 `status === 'pending'`。而引擎写回的是
**`self_play_pending`**（公开承认 5/5 条无 verdict）⇒ **静默放行**。

**⇒ 换一个失败形态就绕过了 —— 正是本仓反复出现的「判据被改宽」同型错误，
出现在我自己的修复里。**

**修法**：改**闭环白名单** `{cleared, needs_revision, self_play_resolved}`，
白名单外一律计欠账（fail-closed）⇒ 引擎将来新增任何状态都会自动计入。
`status` 缺失/非字符串同样计欠账，不给「字段被删」留后门。

**修后实测**（真实变更集）：

```
- CCG 深度审查欠账 1 条 —— …状态不在闭环白名单 {cleared, needs_revision, self_play_resolved} 内：
    - .ccg/reviews/71e7994e….json（mode=dual，status=self_play_pending，decidedAt=…）
不通过：1 条理由        exit=1
```

新增 3 条锁：`self_play_pending` 必须算欠账（**黑名单写法正是在这里漏掉的**）、
未知/缺失状态 fail-closed、白名单形态（不得含 `pending`/`error`，且不得为空集）。

### 新覆盖测试当场抓出的真 bug（i1 的价值证明）

补上 `collectStaged` 真实覆盖后**第一次运行就红了**：

```
不得有「有规模却读不到行」的文件；实际 ["scripts/old-name.js"]
```

成因：**删除文件**时 diff 段的 `+++` 是 `/dev/null`，路径只在 `--- a/<path>` 里。
只认 `+++` ⇒ 该文件定位失败 ⇒ 每个被删除的文件都误报 `lineReadGaps`，
且它的删除行完全没被采集（敏感内容漏检）。

⇒ 这正是伪造对象**结构上测不到**的部分，也直接反驳了「没有直接覆盖不等于没有保护」的辩护。
已修并配变异反证：禁用删除路径回退 ⇒ `not ok 11`；还原 ⇒ 11/11。

### 缺陷 B 的诚实结论（更正初版的表述强度）

初版把「rebase 路径下 `GIT_INDEX_FILE` 指向临时 index」写成结论。**那是假设，未证实** ——
我只有一条观测（某次 rebase 产生的提交被采成 `changedLines=0, fileCount=1`），
**没有**做出可复现的最小实验。评审 i1 指出的正是这一点。

本轮的处置不是"再断言一次"，而是：把该假设在代码注释里显式标注为假设，
并把「不再静默吞掉读取失败」做成可验证的行为（`lineReadGaps`）。
**⇒ 缺陷 B 仍记为残余。**

### 本轮验证（追补）

| 项 | 结果 |
| --- | --- |
| `node --test scripts/ccg-review-decider.test.js` | **11/11**（新增 `collectStaged` 真实覆盖）|
| `node --test scripts/check-pr-exec-record.test.js` | **47/47** |
| `node --test scripts/ccg-bash-entry.test.js` | **9/9**（新增缺陷 E 真实行为锁）|
| 变异反证（本轮新增） | ① 禁用删除路径回退 ⇒ `not ok 11` ② 撤掉父提交回退 ⇒ `not ok 9` |
| 缺陷 E 实测 | 修前「判定记录: 无」；修后「判定记录按父提交 sha 命中：71e7994e」且真跑到引擎 |
| 缺陷 F 实测 | 修前 `self_play_pending` 静默放行；修后 exit=1 并点名 |
| i4 实测 | 拼错门禁名 rc=2 / 幽灵路径 rc=2 / 合法路径 rc=0 |
| 深度审查 | 跑通，critique 7 条，裁决 7/7 upheld |

**★ 一处方法教训（本轮第三次犯同型）**：我用 `node … | Select-Object` 之后读
`$LASTEXITCODE` 判门禁退出码，得到 rc=2；不经管道重测为 rc=0。
**管道尾端的 cmdlet 会吃掉原生程序的真 rc** —— 与本仓已登记的「`cmd | tail` 吃掉真 rc」同源。
凡判退出码，一律不经管道。

**★ 一处取证教训**：记录里 `check-pr-exec-record | OK` 那次是在**提交前**跑的，
`--base` 与 HEAD 相同 ⇒ 变更集为空。**凡判据依赖变更集，取证必须在 commit 之后**——
本仓已有同类登记（`classify-docs-only --head=HEAD` 必须在 commit 后取）。

---

## ★ 合并前追加（2026-10-15，rebase 到最新 main 时暴露）

### 缺陷 G：门禁对 `single` 也要求闭环双模型审查 ⇒ **无法闭合的循环**

修完缺陷 F 后，门禁开始正常工作，随即暴露出**它自己的第 7 个缺陷**：

引擎对 `mode !== 'skip'`（**含 `single`**）一律置 `deepReview.required = true`，
但 `deepReview` 这个字段名有歧义 —— 它是「是否需要**评审**」，不是「是否需要**双模型深度**评审」。
判定器自己的输出把两者分得很清楚：

| mode | 判定器原话 | 需要什么 |
| --- | --- | --- |
| `dual` | 「要求 双模型(claude + opencode) 深度审查」 | 双模型深度审查（15 分钟级）|
| `single` | 「常规专家分派」（§12.6） | 单人专家分派 |
| `skip` | 「按 CCG 决策矩阵不调外部模型」 | 无 |

初版门禁对 `single` 也要求「闭环」⇒ 每次提交都必须跑一次 15 分钟双模型审查；
而**写完审查结果再提交时又会生成一条新的 `single` 记录**（因为记录文件本身命中了
`codeExtensions` 里的 `.json`）⇒ **永远闭合不了**。本 PR 实测撞上：第一次提交
（`mode=dual`，492 行）确实应当审；但收口那次提交又生出 `single` 记录。

**修法**：判据收窄到 `mode === 'dual'`，并补一条反向锁（dual 未闭环必须判欠账），
防止「为省事把判据整个关掉」。

> 为什么这不是「把判据改宽来放行自己」：收窄的是**适用范围**（single 本就不属于双模型
> 深度审查），而不是**判定强度**；且原始诉求（被判要双模型深度审查却从未执行）被完整保留，
> 并有反向锁守着。**测试 48 条**覆盖两侧。

### 一条记录命名的设计缺陷：`<父提交 sha>.json` 会在并发分支间撞名

rebase 时冲突文件是 `.ccg/reviews/71e7994e3949f8eef38e2a757aa292ac0eaddc2a.json`，两侧内容：

| 侧 | 来源 | mode |
| --- | --- | --- |
| ours | `origin/main` 上**别的会话**的提交 | `single` |
| theirs | 我的提交 | `dual` |

成因：记录名 = **父提交 sha**，而 `71e7994e3` 是当时 `origin/main` 的 tip ——
**从同一 base 拉出的并发分支，其提交的父 sha 相同 ⇒ 记录文件名必然相同**。
两条记录描述的是**两个不同的 changeset**，却被挤在同一个路径上。

处置与教训：
- rebase 时取 `ours` 保住 main 侧（**不销毁别人已合并提交的审计产物**）；
- 但我的第二个提交随后又把 `deepReview` 块叠上去，得到「别人的 `mode=single`
  + 我的裁决」的**混合体** —— 语义错乱，已还原成 main 版本；
- 我自己那条改由 `a711a5e0e….json` 承载并如实收口；
- **残余**：rebase 改写了提交 sha ⇒ 该文件名指向的父提交已不在当前历史中，
  其 `stagedDiffHash` 也不对应 rebase 后的 diff。这是「记录名 = 父 sha」在 rebase 下的固有失真，
  本 PR **未修**（属独立问题，见残余 9）。

### rebase 后实测

| 项 | 结果 |
| --- | --- |
| `check-pr-exec-record` | exit=0（`71e7994e3` 与 main 逐字节一致 ⇒ 退出变更集；`a711a5e0e` 已闭环）|
| `check-pr-exec-record.test.js` | **48/48**（+1 条缺陷 G 锁，含反向锁）|
| `ccg-review-decider.test.js` | 11/11 |
| `check-gate-record-debt` / `check-unwired-tests` | exit=0 |

### 残余（追加）

| # | 项 | 说明 |
| --- | --- | --- |
| 9 | **记录名 = 父 sha 在并发/rebase 下失真** | 并发分支撞名（本节实证）、rebase 后名字指向不存在的提交。修它需要改命名方案（内容寻址已有 `stagedDiffHash`，可考虑以它为主键）——属独立改动，本 PR 不做 |

