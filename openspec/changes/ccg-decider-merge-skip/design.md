# Design: 合并提交的判定范围收敛（ccg-decider-merge-skip）

## 1. 问题定位（读码结论）

判定器只有一个验证层输入：

```
main()
  ├─ --input <json>    → 外部判定
  ├─ --base <rev>      → collectRange(base)   三点 diff `base...HEAD`
  └─ 默认（pre-commit） → collectStaged()      `git diff --cached`
```

pre-commit 在 `git merge` 的收尾提交上同样执行，而那一刻**暂存区装的是整份 merge 结果**
（相对 `HEAD`，即 ours tip）。对方分支整侧带进来的改动全部落在这个 diff 里。

`judge()` 拿到 `files.length=606`、`changedLines=1880` 就照常判 `dual`，于是：

- `check-pr-exec-record.js::evaluateDeepReviewDebt` 只按 `mode === "dual"` 收欠账，
  **不区分这份 dual 是怎么产生的** ⇒ 每次 merge 收尾凭空造一条深度审查欠账；
- `saveRecord` 的内容寻址键取自「暂存区 diff 排除 `.ccg`」的 sha256，
  而 merge 的暂存区内容随对方分支前进而变 ⇒ 同名收敛性在这些记录上完全失效；
- `.ccg/reviews/` 作为「本次变更被谁审过」的证据面被污染：一份 `files=606` 的记录
  无法回答「这个 PR 改了多少」。

## 2. 合并态识别

```js
detectMergeState() → { merging: boolean, mergeHead: string|null }
```

实现取 `git rev-parse --verify MERGE_HEAD`：

- 合并中途（含冲突已解、待 commit）该 ref 存在，命令成功并打印 sha；
- 非合并态命令以 128 失败，`git()` 返回 `null` ⇒ `merging: false`。

**为什么不用 `fs.existsSync(".git/MERGE_HEAD")`**：本仓所有运行时代码任务都在
`git worktree` 里执行，那里 `.git` 是一个**文件**（`gitdir: ...`），
硬编码路径在本仓唯一允许的工作方式下**恒为「不是合并」**——这是一条会静默失效的判据。
同理也不硬编码 `path.join(repoRoot, ".git", ...)`。

**为什么不覆盖 rebase / cherry-pick**：`git rev-parse --verify MERGE_HEAD` 对它们不成立
（rebase 用 `REBASE_HEAD`/`.git/rebase-merge/`），而且它们的「变更集」语义是
「单个提交重放」——`--continue` 触发 pre-commit 时 index 就是目标提交本身，
不存在「整侧导入」这个待收敛的问题。把三态合并处理会让「哪一侧是导入方」在
rebase 的连续重放里失去定义。

## 3. 变更集收敛：两侧交集

```js
collectMergeStaged(mergeState) → staged | null
```

口径：

```
base    = git merge-base HEAD MERGE_HEAD
ours    = git diff --name-only --no-renames <base> HEAD
theirs  = git diff --name-only --no-renames <base> MERGE_HEAD
inter   = ours ∩ theirs   （排序，稳定）
```

- `inter` 为空 ⇒ 直接返回空形状（`files: []`，其余字段全空）+ `mergeScope`，
  不派生任何 git 子进程。
- `inter` 非空 ⇒ 以 `inter` 为路径集走既有 `collectFromDiff(numstatArgs, diffArgs)`：
  `git diff --cached --numstat -- :(literal)<p>...`，`files` /
  `linesByFile` / `codeFiles` / 逐行 diff 全部由**同一次** `git diff --cached` 派生。

### `.ccg` 自产物：观测面不排除，消费面排除（T11）

本 change 与主干上刚合并的 `ccg-decider-exclude-self-artifacts` 在同一个函数上相遇，
两者要的东西不同，必须先分清是哪一层：

| 层 | 谁做 | 本 change 的口径 |
|---|---|---|
| **观测层**（git 调用取变更集） | `collectMergeStaged` 的三处 git 参数 | **不排除** `.ccg` |
| **消费层**（把路径变成「要审的内容」） | `judge()` / `collectFromDiff` 里的 `isSelfArtifact` | **排除** `.ccg`（既有实现，本 change 不动） |
| **命名层**（`stagedDiffHash` 的 pathspec） | `main()` 的 `mergeDiffPaths` | **保留** `:(exclude).ccg` |

观测层**不能**用 `:(exclude).ccg` 收窄，因为主干的修复正是为此而来：
`.ccg` 在 git 层就被过滤掉时，JS 层收不到那些路径，`ccgChangedLines` 结构性恒 0
（主干暂存档的同型缺陷）。排除该做的事只有一件——别让自产物进入「要审内容」，
那是消费层的职责，由 `isSelfArtifact` 单点持有。

命名层保留排除则是对的：它决定的是**记录文件名**，而 `.ccg/reviews/*.json` 是
hook 自动 stage 的副产物；把它算进哈希会让「同一次改动」在「钩子跑没跑」两种情况下
得到两个不同的键，把「同一份变更 ⇒ 同名 ⇒ 后写覆盖先写」这条收敛性弄坏。

T11 就是这条分工的三向锁：git 层排除 ⇒ 交集少一个文件且 `ccgChangedLines === 0`；
排除被误删（两层都排除丢失）⇒ `changedLines` 多出 `.ccg` 的行；
正确形态 ⇒ 交集含 `.ccg` 文件、`ccgChangedLines > 0`、而 `changedLines` 不含它。

### 为什么是「交集」而不是「我们的改动」或「解决冲突的文件」

| 候选口径 | 为什么不用 |
|---|---|
| ours = `diff(base..HEAD)` | 那是合并**之前**就存在、且已经在前一个提交里被审过的内容；再判一次是重复计费 |
| 「冲突已解决的文件」（`git diff --name-only --diff-filter=U` 的历史） | 冲突已解后 unmerged 标记消失，无法事后复原；且**非冲突的自动合并**（两侧改同一文件的不同区域）同样属于「本次合并对内容的选择」，不能漏 |
| 交集 `ours ∩ theirs` | 只有这些文件上，「merge 结果」与「任一侧原始版本」**必然不同**，因此是本次合并真正做出的内容决定的最小上界 |

### 已知口径偏差（保守放大，必须写进残余风险）

交集内部按 `HEAD → index` 统计，因此**对方一侧带入的改动也计入 `changedLines`**。
方向是「多算」：`dualLineThreshold` 只有 30 行，多算只会让模式更容易升到 `dual`，
**不会**把 `dual` 降成 `single`。这是刻意的——漏审的代价远大于多审一次；
但必须承认「交集非空的 merge 记录里，行数高于我实际手写的行数」。

## 4. `judge()` 的显式分支

在阈值判定**之前**插入：

```js
if (staged.mergeScope && staged.files.length === 0) {
  mode = "skip";
  reason = `合并提交（MERGE_HEAD=<sha>）：两侧改动文件交集为空 ⇒ 本合并未引入自身内容决定，不调审查`;
}
```

放在阈值判定之前而不是复用「空变更集自然落到 skip」：后者会给出
「S 复杂度：≤10 行且无敏感命中」这种**看起来像真的量过**的理由，
而事实上我们这个分支什么都没读。理由文案必须能让人分辨「量了是 0」与「没有可量的东西」。

分支复用既有 `stats` 计算（空 `files` 天然产出全 0），不另抄一份 stats 形状——
抄一份就会在下次加字段时漂移。

## 5. `skip` 不落盘（三条理由）

`main()` 在 `result.mode === "skip" && staged.mergeScope` 时**不调用 `saveRecord`**，
改为打印一行说明。

1. **merge 提交不应引入新文件**：它只把两侧历史接起来，凭空多一份 `.ccg/reviews/*.json`
   等于让「合并」这个动作本身成为内容变更，与 merge 提交的语义相悖；
2. **没有消费者**：`evaluateDeepReviewDebt` 只认 `mode === "dual"`，`skip` 记录谁都不读
   （`shouldPreserveClosedRecord` 保护的是已有闭环记录，不覆盖新建）；
3. **它会让每次 merge 都脏**：`.git/hooks/pre-commit` 在 `ccg-gate.js` 之后**无条件**
   `git add ':(glob).ccg/reviews/*.json'`，于是每一次 `git merge main` 收尾都会
   往提交里塞一个新 JSON，冲突与噪声都随之上升。

**注意与 C2 的关系**：非 merge 的 `skip` 仍然照旧落盘（现状如此，且有其价值——
它记录「这次改动被判成 skip 及其理由」）。本条只豁免 `mergeScope` 形态。

## 6. 内容寻址键与判定范围同源

`saveRecord(result, sha, layer, plannedFiles, backends, opts)` 新增 `opts.diffPaths`，
透传给内部 `stagedDiffHash` 的 pathspec：

```
默认（非 merge）：["--", ".", ":(exclude).ccg"]                       ← 逐字节等于历史配方
merge：           ["--", ":(literal)a", ":(literal)b", ..., ":(exclude).ccg"]
```

（顺序以实现为准：交集文件在前、`:(exclude).ccg` 收尾。两种顺序在 git 里等价，
但「文档写的顺序 ≠ 代码里的顺序」会让下一个读文档的人以为 pathspec 装配点有两处。）

不这样做会留下一个内部矛盾：**判定按交集读、命名按整仓算**。
记录名是「同一份变更 ⇒ 同名 ⇒ 后写覆盖先写」这条收敛性的唯一依据，
键与口径不同源等于自己把收敛性关掉。

`:(literal)` 不可省：`git diff` 的 pathspec 默认按 glob 解析，
文件名里的 `*`、`?`、`[` 会变成通配符 ⇒ 实际读到的文件集与交集不同。

## 7. 尾换行（遗留 7）

`saveRecord` 的两处写盘点都在写 `JSON.stringify(record, null, 2)`：

- `fs.writeFileSync(alt, ...)`（alt 去重分支）
- `fs.writeFileSync(file, ...)`（主分支）

实现上**不**在两处各写一次 `+ "\n"`，而是抽一个单点：

```js
function recordBody(record) {
  return JSON.stringify(record, null, 2) + "\n";
}
```

两处写盘都改用 `recordBody(record)`。**为什么抽函数**：两处各写一次就是「两次
忘记的机会」，而这类遗漏没有运行时症状（只影响下一次 append 的语法），
只能靠回归锁发现；收敛到一处后，「谁忘了补」这个问题不再存在。

**但抽函数证明不了「两个调用点都用了它」** —— 这是本仓反复踩到的形态
（共享实现存在、调用点没接上，测试全绿）。所以 T5 **分别**断言两条路径
（主分支一例、alt 分支一例），而不是「跑一次主分支 + 断言 `recordBody` 存在」。
只改主分支时，凡是走到 alt 的变更（同名记录已闭环）依然产出无尾换行的文件，
而这类文件恰好是最需要被 append 的。

不清理历史 969 份：那是历史事实，重写它们会让已合并 PR 的证据面失真，
属于「改谁来守门」之外的破坏性操作。

## 8. 测试策略（TDD，真实 git 仓库）

夹具用 `mkdtempSync` 造真实仓库 + `spawnSync("git", …)`，**不伪造 merge 态**：

| # | 用例 | 断言要点 |
|---|---|---|
| T1 | 交集为空的 merge ⇒ `skip` 且**无 JSON 落盘** | 记录目录里文件数 == 0；stdout 含「交集为空」 |
| T2 | 交集非空的 merge ⇒ 按交集判、记录带 `mergeScope` | `changedLines` 远小于整侧导入；五元组字段齐 |
| T3 | 非 merge 暂存区不受影响 | 与原口径逐字节一致（对照组） |
| T4 | `detectMergeState` 在 worktree 里也成立 | 用真实 `git worktree add` 造隔离 worktree，在其中 merge ⇒ `merging === true` |
| T5 | 两处写盘都有尾 LF | 主分支与 alt 分支各一例，末字节均为 `\n` |
| T6 | `opts.diffPaths` 让 stats 与 hash 同源 | 同一仓库、两种 pathspec ⇒ 记录名不同；且 default 档文件名与历史配方一致 |
| T7 | 交集里的 glob 元字符文件名按字面量取 | 造 `scripts/a[1].js` + 诱饵 `scripts/a1.js`；无 `:(literal)` 时 pathspec 会把 `a1.js` 也读进来 |
| T8 | **CLI 级接线锁**：`main` 确实把交集派生的 pathspec 作为第 6 参传下去 | 在合并态夹具里真跑一次 CLI，断言记录文件名 == 交集档 sha256 且 `!=` 全域档 sha256 |
| T9 | 「探测失明」不得与「真的不在合并中」同形（第一轮评审 i1） | 三形态：合并中 / 干净仓库（`probeError===null`）/ PATH 指向不存在目录（`probeError` 含 `ENOENT`）；末尾还原 PATH 后**重新读到** `MERGE_HEAD` |
| T10 | 判定域漏进非交集文件 ⇒ 出声并升 `dual`（第一轮评审 i6） | 正例 `single` 且 `mergeScopeLeak===undefined`；破例 A（交集 1 / 判定域 2）⇒ `dual` + 告警；破例 B（交集空却塞文件）⇒ `dual` **而非 `skip`** |
| T11 | `.ccg` 自产物：观测进、消费出 | 三向区分：git 层排除 ⇒ 交集 == 1 且 `ccgChangedLines === 0`；两层都不排除 ⇒ `changedLines` 含 `.ccg` 行（4）；正确 ⇒ 交集 == 2、`ccgChangedLines > 0`、`changedLines === 2` |

**T9 为什么要有「还原后重新读到」那一段**：三个形态如果各测各的、彼此独立，
那么「PATH 被我改坏了但根本没还原」这一格不会被任何一条断言看见 —— 后续用例
会在污染环境里跑，红的地方离真正的错很远。把「还原 → 再读一次 `MERGE_HEAD` 成功」
写进同一条用例，是让**清理动作本身**成为被测事实。同理，环境键不硬编码 `"PATH"`：
Windows 上键名是 `Path`，写死会让「设置没生效」和「本来就对」长得一样。

**T10 的破例 B 是顺序锁，不是重复锁**：升级分支如果放在「交集为空 ⇒ skip」之后，
`{files:[…], intersectionFileCount:0}` 会先被 skip 短路吃掉 —— 破例 A 仍然全绿，
因为 A 的交集非零、走不到那条短路。只有 B（交集为空 + 判定域非空）能区分
「排在前面」与「排在后面」。

**T8 为什么必须是 CLI 级**：T6 自己传 `opts` 给 `saveRecord`，因此它只能证明
「`saveRecord` 认这个参数」，证明不了「`main` 把算出来的值接了下去」。把
`mergeDiffPaths ? { diffPaths: mergeDiffPaths } : undefined` 整个摘掉，T1/T2/T6
依然全绿，而记录名又回到「对方整侧」的哈希上 —— 遗留 10 的形态换了个落点。
用结构正则断言「`main` 里有 `diffPaths:`」对这类接线太脆（改个变量名就假红），
所以改用行为锁：让两档哈希在夹具里**必然不同**，再看落盘文件名落在哪一档。

**T7 为什么用 `[1]` 而不是 `*`**：`*` 与 `?` 在 Windows 文件名里非法，
本仓测试要在 Windows runner 上跑。`[`、`]` 合法且仍是 glob 元字符
（`a[1].js` 的 glob 语义是「`a1.js`」），所以它既能造出「按字面量 vs 按 glob
解析结果不同」的两难，又不依赖平台。

**T11 为什么是三向而不是两向**：只写「正确形态 ⇒ 交集含 `.ccg`」这一条，
那么把 git 层排除加回去仍然部分成立（该用例里两侧都改 `.ccg` 时交集会变空，
断言直接红，可辨）；但把 `isSelfArtifact` 一并摘掉时它照样绿 —— 那正是
「观测面进、消费面出」里被放错的那一半。所以必须有第三格：
`changedLines` 不含 `.ccg` 的行。三格的分工是：
① 观测面有没有读到 `.ccg`；② 消费面有没有把它算进判定行数；③ 两者同时成立时的合成读数。

**T11 的夹具必须让两侧改 `.ccg` 的不同行**：两侧改同一行时该文件不进 numstat
（git 只对一侧的改动给读数），交集里出现它但 `changedLines` 观察不到它的行数，
三格就退化成两格 —— 这条约束写在夹具注释里，否则下一个人重构夹具时会静默丢掉一格。

变异反证（每条单独跑，必须变红且红的是**指名**用例）：

- M1：把 `detectMergeState` 改成恒 `{merging:false}` ⇒ T1/T2/T4 红
- M2：把交集改成两侧并集 ⇒ T1 红（不再 skip）
- M3：把 `judge` 的 merge 分支删掉 ⇒ T1 红（理由退化成「≤10 行」）
- M4：把 `skip && mergeScope` 的落盘豁免删掉 ⇒ T1 红（文件数 != 0）
- M5：把主分支的尾 LF 摘掉 ⇒ T5 红
- M6：把 alt 分支的尾 LF 摘掉 ⇒ T5 红（另一条）
- M7：把 `:(literal)${f}` 换成裸路径 ⇒ T7 红（诱饵 `a1.js` 被读进来）
- M8：`diffPaths` 改成忽略入参 ⇒ T6 红
- M9：把 `main` 的第 6 参接线摘掉（`{ diffPaths: mergeDiffPaths }` → 不传）⇒ **T8 红**（其余全绿）
- M10：把 `mergeScope` 从 `stats` 里摘掉 ⇒ T2/T8 红
- M11：把 `collectMergeStaged` 的「交集为空走零值形态」改成仍派生子进程 ⇒ T1 红（会读到对方整侧）

第二批（T9/T10 是 QM-6 第一轮评审的产物，故它们的变异也排在**修完之后**才补）：

- M12：摘掉 `detectMergeState` 的 `probeError` 分档（把 `128`/`1` 与 spawn 失败并成同一分支，
  任何失败都返回 `probeError: null`）⇒ **只有 T9 红**（两种事实又变成不可分）
- M13：摘掉 `judge()` 里 `mergeScopeLeak ⇒ dual` 的升级分支（不变量破坏时不告警、
  退化成「交集非零就往下走阈值链」）⇒ **只有 T10 红**（破例 A/B 同时失守）

第三批（T11 是合并 `origin/main` 时与 `ccg-decider-exclude-self-artifacts` 相遇的产物，
故其变异同样排在**对齐之后**才补）：

- M14：把 `:(exclude).ccg` 加回 `collectMergeStaged` 的 `sideFiles()`（观测面重新收窄）
  ⇒ **只有 T11 红**，且首个失败断言是 `collected.files` 的 `deepStrictEqual`（观测面）
- M15：把 `:(exclude).ccg` 加回 `pathspecs`（只收窄 numstat/diff 那一处，交集仍含 `.ccg`）
  ⇒ **只有 T11 红**，且首个失败断言是 `changedLines` / `ccgChangedLines`（消费面）

**实测红集**（本轮真跑，台账以 `tasks.md` §3 为准；上面的 M1–M11 是写码前的预测、M12–M15 是评审/合并派生的补充项，与实测不符处一律以实测为准）：
第一批 baseline `rc=0 / pass=8 / fail=0`（`--test-name-pattern=遗留`），11/11 全部 CAUGHT：
M1 `fail=5`（T1/T2/T4/T7/T8）、M2 `fail=5`（同 M1）、M3 `fail=1`（T1）、M4 `fail=1`（T1）、
M5 `fail=1`（T5）、M6 `fail=1`（T5）、M7 `fail=1`（T7）、M8 `fail=2`（T6/T8）、
M9 `fail=1`（T8）、M10 `fail=1`（T8）、M11 `fail=2`（T1/T4）。
第二批 baseline `rc=0 / pass=10 / fail=0`（T9/T10 落地后同一个 pattern），M12/M13 各 `fail=1`，
红集**不相交**（M12 只打 T9、M13 只打 T10）—— 两条守的是两台不同的机器：
前者守「探测失明是否可见」，后者守「判定域是否有上界」。
第三批 baseline `rc=0 / pass=1 / fail=0`（`--test-name-pattern=T11`），**M14 实测 CAUGHT**
（`tests=1 / pass=0 / fail=1`，首个失败断言 = `collected.files` 的 `deepStrictEqual`）。
M15 为**预测项、未实测**（实现上与 M14 落在同一函数的两处 pathspec，红集形态可推，
但不把推断写成实测），合计 **14/14 实测 CAUGHT**。
与预测的 5 处偏差逐条：① M1 少 T6 —— T6 直接调 `saveRecord` 并自传 `opts.diffPaths`，
不经过 `detectMergeState`；② M1 多 T7/T8、③ M2 多 T7/T8 —— 退回「对方整侧」或改成并集，
会让「交集」这一形态整体消失，元素级过滤与哈希级接线锁同时失守；
④ M10 少 T2 —— T2 断的是 `collected.mergeScope`，而 M10 摘的是 `stats.mergeScope`，两个载体；
⑤ M8 多 T8 —— 接线锁比对的哈希也只认域外文件时一并红。
每轮跑完都自证 `src === original: true`（逐字节）且 `node --check` rc=0。

## 9. 残余风险（如实列出）

1. **交集内按 HEAD 统计是保守放大**（见 §3），merge 记录的 `changedLines` 高于手写量。
2. **重命名不参与交集计算**：两侧都用 `--no-renames`，因此「ours 重命名 A→B、theirs 改 A」
   会得到交集 `{A, B} ∩ {A} = {A}`，判的是 A 的删除。方向仍是多算，不是漏算；
   但「合并后被判定范围含一个已不存在的路径」这件事无提示。
3. **`--no-renames` 与既有 `stagedDiffHash` 配方一致**，故不引入新的键漂移面；
   但 `collectFromDiff` 的 numstat 调用不带 `--no-renames`（历史如此），
   两条路径在 rename 场景下的解析细节仍可能不同——属既有面，本 PR 不改。
4. **`merge` 之外的整合动作（rebase / cherry-pick / `git cherry-pick -n`）不受本条约束**，
   详见 §2。
5. **`detectMergeState` 的失败方向是 `merging:false`**（fail-open 回落到整侧导入口径）。
   理由：pre-commit 是开发者的提交闸门，判据取不到读数时阻断提交的收益远小于代价，
   且既有代码对「读不到」已有统一的「未判定」口径（返回 0 并打印补救命令）。
   代价是：如果 `git rev-parse` 本身坏了，我们会退回旧行为（`dual` + 606 文件），
   而不是报错——这是刻意的方向选择，不是遗漏。
6. **「冲突未解完就提交」这一形态的行为未实测**（必须解释清楚，不能假装覆盖）。
   `collectMergeStaged` 全程用 `git diff --cached`，而冲突未解的文件在 index 里
   处于 unmerged 状态，此时 `--cached` 到底把它算不算「有差异」、`--name-only`
   会不会列出它，本次**没有实测**（夹具里所有 merge 都是「冲突已解、无 unmerged
   entry」的形态）。方向上即便出问题也是「多算/少算交集」，不会让非合并态路径改变；
   但若有人把 unmerged 路径当成「已解决的合并内容」来判，读数不可信。
   这是本 PR 明确的残余风险，不写「已覆盖」。
7. **本单元只处理 `git merge`**：`git merge --squash`（不产生 `MERGE_HEAD`）按非合并态处理，
   即仍会按整侧导入判 `dual`。这是既有行为，本次不改（改它要动「什么算合并」的定义）。
8. **交集会把「两侧都改过的热文件」累加进来，长命分支同步主干时可能被推到阈值之上。**
   这是**刻意的语义**而不是缺陷：两侧都动过 = 合并时真的在该文件上做过整合 / 解冲突，
   而 merge 提交正是那段整合唯一的落点，判 `dual` 说得通。但要如实标注两件事：
   ① 读数偏高——交集两侧各自的 numstat 相加等于「双方对该文件的改动量之和」，
   而不是「这次解冲突真正写了多少行」；② 典型触发面是追加型热文件
   （`CHANGELOG.md`、`01-docs/learnings.md`、`openspec/records/*.md`、`.quality-gates.md`）。
   **本节初稿写的「实测交集恰好只有 `CHANGELOG.md` ⇒ 判 `skip`」是错的，已被真实读数否证**：
   本 PR 收尾把 `origin/main`（`85dc44ddc`）合进本分支时，实测 base `2dbda6925`、
   ours 10 / theirs 628、**交集 3 个文件**
   （`CHANGELOG.md` / `scripts/ccg-review-decider.js` / `scripts/ccg-review-decider.test.js`），
   `git diff --cached --numstat` 求和 **538 行**（204 / 59 / 275）⇒ 判 `dual` 并落盘。
   初稿的错法是「拿预测当实测」：当时只想到热文件会两侧都改，忘了本分支与主干
   在同一个 `scripts/ccg-review-decider.js` 家族上都动过。这条同时是遗留 10 的**正向前后对照**：
   修复前同一形态会被判 `skip`（按对方整侧 628 文件却「无内容决定」），修复后判 `dual`。
   反过来，若将来出现「纯同步 merge 被判 `dual`」，先看交集清单里是不是只有热文件，
   再决定是把它当成「值得评审的解冲突」还是另立 change 收窄（不在本 PR 范围）。
   **读数与最终分支的一处差异必须标注**：上面那次实测时本分支还带着一条 `CHANGELOG.md` 条目，
   收尾把它改落执行记录的 `## CHANGELOG 条目` 小节（理由见记录的「变更类型与隔离」行），
   于是最终分支与主干的交集是 2 个文件（`scripts/ccg-review-decider.js` `53/6`、本文件 `275/0`），
   由同批逐文件 numstat **推算** `changedLines=334`（仍 > 200 ⇒ 仍判 `dual`，结论不变）。
   这个 334 是算术推算、**没有重跑**，所以不写成读数；重跑一次才会得到新读数。

## 10. 两条既有结构锁必须同 PR 更新（并说明为什么不是「放宽」）

改动后有两条既有结构锁当场变红，两条都**不是**缺陷暴露，而是「锁的判据绑在了
旧实现的字面形态上」。处置方式与理由必须写清楚，否则下一个人会把它们读成
「为了让测试变绿而改测试」：

### 10.1 Test 36「git 调用失败时不得把 null 当成 diff 内容算哈希」

锁的判据是 `assert.doesNotMatch(src, /String\(git\(\[/)` —— 它要禁的是
「把 `git()` 的返回值直接 `String()` 化」，因为 `git()` 失败返回 `null`，
而 `String(null)` 是字符串 `"null"`（非空），会被当成真 diff 内容算哈希
（得到 `sha256("null")` 这个稳定但无意义的键）。

新代码确实需要读 `git merge-base` 的输出并 `String()` 化，但写成了
**先判 `null`/`undefined`，再 `String(...)`** —— 语义上正是这条锁想要的方向。
所以处理是**改实现**（保持判据不宽），而不是放宽判据。

⚠️ 顺带踩到的坑（值得记）：这条锁扫的是**整个源码文本**，**注释也算扫描域**。
第一次触发它的不是我写的代码，而是我为了解释这件事新加的注释里原样引用了
被禁的那几个字符。结论：写解释文字时不要原样引用被禁字面量，要转述。

### 10.2「丙3.2 接线锁：main 必须把已算出的 backends 传给 saveRecord」

锁的判据是正则 `…saveRecord\([^)]*backends\s*\)`，即「第 5 参之后紧跟右括号」。
`saveRecord` 现在有第 6 参（`opts`），该正则不再匹配。

处置：把尾部 `\s*\)` 放宽成 `\s*[,)]`，**只**放宽「第 5 参之后还有没有参数」这一维，
`backends` 这个标识符仍逐字要求。这条锁真正要防的是「算出来的 backends 没被用上」
（比如退化成 `[]`），那个判别力没有被削弱。

放宽后它的判据不再能覆盖「第 6 参到底传了什么」，所以**另加 T8** 用行为锁覆盖
那一维（见 §8）。两条锁的分工必须写下来，否则下一次改调用签名时会有人
以为「丙3.2 已经管了参数」。

