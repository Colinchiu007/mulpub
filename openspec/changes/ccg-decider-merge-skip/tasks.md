# Tasks: ccg-decider-merge-skip

> 状态口径：`[ ]` 未开始 / `[x]` 完成且**有产物可核**。每条完成项必须在
> `openspec/records/ccg-decider-merge-skip.md` 里有对应读数，不接受「已实现」这种自述。

## 1. 先写测试（TDD，红灯先行）

- [x] 1.1 夹具：`mkdtempSync` 真实 git 仓库（`git init -q` + `user.email`/`user.name` +
      `commit.gpgsign false` + `core.autocrlf false`），与既有夹具同范式
- [x] 1.2 夹具：可复用的「造两侧历史 + merge」构造器 `mkGitFixture(opts)`（`ours` 改一组文件、
      `theirs` 改另一组，交集由入参决定），支持「交集为空」「交集非空」「非 merge 档
      （`merge:false` + `stageOnly`）」「linked worktree 档（`worktree:true`）」
- [x] 1.3 T1：交集为空的 merge ⇒ `mode=skip`、理由含「交集为空」、`.ccg/reviews/` **无新文件**
- [x] 1.4 T2：交集非空的 merge ⇒ 判定按交集（`fileCount` 等于交集大小，不等于整侧导入），
      记录含 `mergeScope` 五元组
- [x] 1.5 T3：非 merge 态对照 —— 断言**三件事**：`detectMergeState().merging === false`、
      `collectMergeStaged() === null`（不是空对象！空对象会被读成「交集为空 ⇒ skip」，
      把每次提交都跳掉）、以及 CLI 在非 merge 态**照旧落盘**恰好一条记录
- [x] 1.6 T4：`git worktree add` 造隔离 worktree，在其中 merge ⇒ `detectMergeState().merging === true`，
      并**同例**断言主仓库（`fx.repo`）为 `false`（只断 `true` 无法区分「探测对了」与「探测恒真」）；
      交集口径在 worktree 里也成立（防「硬编码 `.git/MERGE_HEAD`」在 worktree 下静默失效）
- [x] 1.7 T5：`saveRecord` 主分支与 alt 分支产出的文件末字节都是 `\n`（**两例分开**：
      共用实现证明不了「两个调用点都用了它」）
- [x] 1.8 T6：`opts.diffPaths` 让 stats 与内容寻址键同源（两种 pathspec ⇒ 不同记录名；
      默认档与历史配方逐字节一致）
- [x] 1.9 T7：文件名含 glob 元字符（`scripts/a[1].js` + 诱饵 `scripts/a1.js`）时
      交集路径不被通配符放大（`:(literal)` 锁）。`*`/`?` 在 Windows 文件名里非法，
      `[`/`]` 合法且仍是 glob 元字符 ⇒ 唯一能跨平台的形态
- [x] 1.10 T8：**CLI 级接线锁** —— 合并态夹具里真跑 `node scripts/ccg-review-decider.js`，
      断言落盘文件名 == 「交集 pathspec 的暂存 diff」sha256、且 `!=` 「全域 diff」sha256。
      理由：T6 自己传 `opts`，只能证明 `saveRecord` 认这个参数，证明不了 `main` 把它接了下去
      （把第 6 参摘掉，T1/T2/T6 全绿而遗留 10 原地复活）
- [x] 1.11 T9（QM-6 第一轮 i1 的回归锁）：`detectMergeState()` 必须**分清**两种事实 ——
      ① ref 不存在（`128`/`1`，正常缺席）；② 探测本身失明（spawn 失败 / 崩溃）。
      三形态断言：合并中 `merging=true` / 干净仓库 `merging=false && probeError===null` /
      失明 `merging=false && probeError` 非空且**含 `ENOENT`**；末尾**还原 PATH 后重新读到
      `MERGE_HEAD`**（自证「还原真的生效」，而不是三个形态恰好都返回同一个值）。
      环境键按 `Object.keys(process.env).filter(/^path$/i)` 取，**不硬编码 `"PATH"`**
      （Windows 上是 `Path`，写死会让「改了没生效」和「本来就对」同形）
- [x] 1.12 T10（QM-6 第一轮 i6 的回归锁）：判定域漏进非交集文件时**出声并升 dual**。
      三条：正例（不变量成立 ⇒ `single` 且 `stats.mergeScopeLeak === undefined`）/
      破例 A（交集 1 个而判定域 2 个 ⇒ `dual` + 告警文案）/
      破例 B（交集为空却塞进文件 ⇒ 必须 `dual` **而非 `skip`**，证明升级分支排在零语义短路之前）
- [x] 1.13 先跑一遍确认**全部红**，并把红灯原文留进执行记录
- [x] 1.14 T11（合并 `origin/main` 时与 `ccg-decider-exclude-self-artifacts` 相遇的产物）：
      `.ccg` 自产物必须「观测面进、消费面出」。三向断言：① git 层把 `:(exclude).ccg` 加回
      `sideFiles()` ⇒ 交集少一个文件且 `ccgChangedLines === 0`（观测面失明）；② 两层都不排除
      ⇒ `changedLines` 多出 `.ccg` 的行（消费面漏进来）；③ 正确形态 ⇒ 交集含 `.ccg` 文件、
      `ccgChangedLines > 0`、而 `changedLines` 不含它。夹具必须让**两侧改 `.ccg` 的不同行**
      （改同一行时该文件不进 numstat，三格退化成两格）

## 2. 实现

- [x] 2.1 `detectMergeState()`：`git rev-parse --verify MERGE_HEAD`，不得硬编码 `.git/MERGE_HEAD`
      （linked worktree 的 `.git` 是文件）；失败方向 `merging:false`（fail-open，
      见 design §9.5 的方向论证）
- [x] 2.2 `collectMergeStaged(mergeState?)`：参数可选、缺省自行探测；`merge-base HEAD MERGE_HEAD` +
      两侧 `--name-only --no-renames` + **交集** + 以交集为 pathspec 走 `collectFromDiff`。
      三处 git 参数**一律不排除 `.ccg`**（观测面），排除只发生在消费面 `isSelfArtifact`，
      命名面（`main()` 的 `mergeDiffPaths`）保留排除 —— 三面分工见 design §3 与 2.14
- [x] 2.3 交集为空时返回空形状（全 0/全空 + `mergeScope`）而**不派生** git 子进程
- [x] 2.4 `mergeScope` 五元组：`mergeHead` / `base` / `oursFileCount` / `theirsFileCount` /
      `intersectionFileCount`（固定键集，测试用排序后 `deepStrictEqual` 钉住）
- [x] 2.5 `judge()` 显式分支（置于阈值判定**之前**），理由是「交集为空」而非「≤10 行」
- [x] 2.6 `main()` 暂存区分支：merge 态走 `collectMergeStaged`，非 merge 态逐字节不变；
      「暂存区无变更 ⇒ 未判定」的早退**仅非 merge 态**生效
- [x] 2.7 `main()` 在 `mode==='skip' && mergeScope` 时不落盘 + 打印豁免理由（三条理由见 design §5）
- [x] 2.8 `saveRecord` 接收第 6 参 `opts.diffPaths`，默认值与历史配方逐字节相等
- [x] 2.9 写盘内容抽单点 `recordBody(record)`（`JSON.stringify(record, null, 2) + "\n"`），
      **两处**写盘点都改用它；不回溯清理历史 969 份无尾换行文件
- [x] 2.10 交集路径使用 `:(literal)` magic，防 glob 元字符放大
- [x] 2.11 `module.exports` 导出 `detectMergeState` / `collectMergeStaged`
- [x] 2.12 **i1（QM-6 第一轮，Critical）**：`detectMergeState()` 不再复用 `git()`（它的 catch
      把「ref 不存在」与「进程没起来」压成同一个 `null`），改 `execFileSync` 直调并按
      `err.status` 分档：`128`/`1` ⇒ 正常缺席；其余（含 `status===null` 的 spawn 失败，
      实测 `err.code==='ENOENT'`）⇒ `probeError = err.code || "exit=<status>"`。
      **判定方向不变**（仍 fail-open 走非合并口径），只把「我不知道」变成可见状态，
      由 `main()` 打 warn；不改成抛错，理由见 design §9.5（pre-commit 本身由 git 调起，
      git 在、它的子进程 PATH 坏了这一格不该让整次提交卡死）
- [x] 2.13 **i6（QM-6 第一轮，Warning）**：`judge()` 校验「`files` 是交集」这条不变量 ——
      `staged.files.length > mergeScope.intersectionFileCount` ⇒ `console.log` 点名实测计数，
      并把 mode **升级为 `dual`**（fail-closed），不抛错；分支置于零语义短路与阈值链**之前**。
      取**上界**而非严格相等：交集里的文件在合并结果里可能没有差异（两侧做了同一处改动），
      `files` 合法地**小于**交集数，只有「多」才是漏。破坏时 `stats.mergeScopeLeak` 落值，
      正常时 `undefined`（不进 JSON）
- [x] 2.14 **`.ccg` 口径对齐（T11）**：`collectMergeStaged()` 删除 `sideFiles()` 与 `pathspecs`
      两处 `:(exclude).ccg`；`judge()` 的 `!isSelfArtifact` **保留**（消费面）；
      `main()` 里 `mergeDiffPaths` 的排除**保留**（命名面）。理由：git 层排除会让
      `ccgChangedLines` 结构性恒为 0，与主干刚修掉的暂存档缺陷同形；而命名面算进
      hook 自动 stage 的 `.ccg/reviews/*.json` 会让「同一次改动」在「钩子跑没跑」两种情况下
      得到两个键，破坏「同一份变更 ⇒ 同名 ⇒ 后写覆盖先写」的收敛性

## 3. 变异反证（每条单独跑，红必须是**指名**的那条）

> 评估域：`node --test --test-name-pattern=遗留 scripts/ccg-review-decider.test.js`。
> 分四批：M1–M11 的 baseline 实测 `rc=0 / pass=8 / fail=0`（T1–T8 命中该 pattern），
> 算术自洽：域内 8 条 ⇒ 任一变异跑完 `pass + fail = 8`；M12/M13 是在 T9/T10 落地后补跑的，
> baseline 实测 `rc=0 / pass=10 / fail=0` ⇒ 这两条 `pass + fail = 10`；
> M14 是在 T11 落地后补跑的，评估域收窄为 `--test-name-pattern=T11`
> （baseline `rc=0 / pass=1 / fail=0`）—— 它与前两批不在同一个 pattern 下，故不参与那种算术；
> M16 守的是另一条**不属于 `遗留10-Tn` 族**的行为锁，评估域为
> `--test-name-pattern=命名配方行为锁`（baseline `rc=0 / pass=1 / fail=0`）。
> 下方「实测红集」是**跑出来的**，不是预期；凡与预期不同的都在条目里写明原因。

- [x] M1 `detectMergeState` 恒 `merging:false` ⇒ 实测 `pass=3 fail=5`，红 =
      T1/T2/T4/T7/T8（预期 T1/T2/T4/T6/T7/T8）。**T6 未红且应当不红**：T6 直接给
      `saveRecord` 传 `opts.diffPaths`，根本不经过 `detectMergeState` —— 这正是
      「判定范围」与「记录名同源」被拆成两层锁的证据，不是漏测。
- [x] M2 交集改并集 ⇒ 实测 `pass=3 fail=5`，红 = T1/T2/T4/T7/T8（预期只写 T1）。
      并集让「交集」退化成全域，于是 T2 的 `fileCount`、T7 的元字符文件、T8 的哈希
      全部跟着变 —— 一条变异能同时打穿多道锁，是因为它们共享同一个不变量
      （「判定范围 = 双方交集」），不是判据冗余。
- [x] M3 删 `judge` 的 merge 分支 ⇒ 实测 `pass=7 fail=1`，红 = T1（理由退化成「≤10 行」）
- [x] M4 删「`skip`+`mergeScope` 不落盘」⇒ 实测 `pass=7 fail=1`，红 = T1（文件数 != 0）。
      **M3 与 M4 的红集相同**（都只有 T1），因为 T1 一条里同时断「judge 判 skip」与
      「CLI 不写记录」。这里如实记为「同集」，不写成「红集互不相同」。
- [x] M5 摘主分支尾 LF ⇒ 实测 `pass=7 fail=1`，红 = T5（主分支例）
- [x] M6 摘 alt 分支尾 LF ⇒ 实测 `pass=7 fail=1`，红 = T5（alt 例）。
      M5/M6 分开跑的理由：两处写盘点，改一处不得由另一处顶罪
- [x] M7 `:(literal)` 换裸路径 ⇒ 实测 `pass=7 fail=1`，红 = T7（诱饵 `a1.js` 被读进来）
- [x] M8 `diffPaths` 被忽略（不影响哈希）⇒ 实测 `pass=6 fail=2`，红 = T6/T8
- [x] M9 把 `main` 的第 6 参接线摘掉 ⇒ 实测 `pass=7 fail=1`，红 = **只有 T8**
      （T1/T2/T6 全绿 —— 这条是 T8 存在的唯一理由：T6 自己传 `opts`，只能证明
      `saveRecord` 认这个参数，证明不了 `main()` 把它接了下去）
- [x] M10 把 `mergeScope` 从 `stats` 摘掉 ⇒ 实测 `pass=7 fail=1`，红 = **只有 T8**
      （预期写的是 T2/T8）。偏差原因：T2 断的是 `collected.mergeScope`（生产者侧五元组），
      T8 断的是 `rec.stats.mergeScope`（记录层）。**预期写错了，不是判据缺牙**；
      两层各自留一条锁是有意的，故不合并成一条。
- [x] M11 交集为空时仍派生子进程（不返回零值形态）⇒ 实测 `pass=6 fail=2`，红 = T1/T4
- [x] M12 摘掉 `detectMergeState` 的 `probeError` 分档（`status === 128 || 1` 与 spawn 失败
      合并成同一分支，任何失败都返回 `probeError: null`）⇒ 实测 `pass=9 fail=1`，
      红 = **只有 T9**「「探测失明」不得与「真的不在合并中」同形（i1）」。
      判据咬住的是「**两种事实可分**」而不是「有没有 warn 文案」：变异的产物仍会打
      `读不到暂存区`，只有把 `probeError` 读出来比对的 T9 才看得见差别。
- [x] M13 摘掉 `judge()` 里 `mergeScopeLeak ⇒ dual` 的升级分支（不变量破坏时不告警、
      退化成「交集非零 ⇒ 走阈值链」）⇒ 实测 `pass=9 fail=1`，
      红 = **只有 T10**「判定域漏进非交集文件 ⇒ 出声并升 dual（i6 不变量）」。
      M12/M13 的红集不相交（一条只打 T9、一条只打 T10），因为它们守的是两台不同的机器：
      前者守「探测失明的可见性」，后者守「判定域上界」。
- [x] M14 把 `:(exclude).ccg` 加回 `collectMergeStaged` 的 `sideFiles()`（观测面重新收窄）
      ⇒ 实测 `--test-name-pattern=T11` 下 `pass=0 fail=1`，红 = T11，
      首个失败断言是 `collected.files` 的 `deepStrictEqual`（观测面：交集少了一个文件）
- [ ] M15（**预测项，未实测**）把 `:(exclude).ccg` 只加回 `pathspecs`（交集仍含 `.ccg`，
      只收窄 numstat/diff）⇒ 预期只有 T11 红，断言位置应在 `changedLines` / `ccgChangedLines`
      （消费面）。如实记为未实测：实现上它与 M14 落在同一函数的两处 pathspec，红集形态可推，
      但不把推断写成实测
- [x] M16 摘掉默认档实参尾巴上的 `:(exclude).ccg`（**行为锁的反证**，不是结构锁的反证）
      ⇒ 实测 `--test-name-pattern=命名配方行为锁` 下 `pass=0 fail=1`，红 = 只有「默认档必须真的
      排除 `.ccg`（位置不是判据，行为才是）」。失败断言是 `strictEqual` 而不是 `match`：
      `expected` = 40 位父 sha 名（暂存 diff 在排除 `.ccg` 后为空 ⇒ 回落 `HEAD` 命名），
      `actual` = `4de98fbd….json`（把 `.ccg` 内容读进判定域后算出的 64-hex 名）。
      **这条锁刻意不编进 `遗留10-Tn` 族**：它的动因是 CI 的 `Gate 2c2` 当场红（见 4.12），
      与遗留 10/7 的语义无关；编进族里会让 `--test-name-pattern=遗留` 的域从 10 变 11，
      前两批的算术自洽（`pass + fail = 8` / `= 10`）随之失真。

**15/15 实测 CAUGHT**（M15 不计入）。每条跑完都做还原校验（`src === original` 逐字节相等 +
`node --check` rc=0），源文件不曾以变异态存在过跨条。M12/M13/M14/M16 的跑法是脚本化的
（备份 → 精确替换 → 跑 → 还原 → **sha256 复核还原结果与基线一致**），
且脚本会先自证「变异已落盘」再跑 —— 否则「锚点没命中」会被读成「测试没抓到」。
M12/M13 两次跑完打印的还原 sha 均等于当时基线 `d18336b179a4d016`；
M14 的还原 sha 等于 T11 落地后的基线 `d184754d4abd0e27`；
M16 的还原 sha 等于行为锁落地后的基线 `a6e2ca68a043`（每加用例文件就变长，基线随之变化，
读数不同是**正确**的，不是还原失败）。

## 4. 门禁与评审

- [x] 4.1 `node --test scripts/ccg-review-decider.test.js` 全量通过：**71 例**
      （既有 52 + T1–T11 新增 + 命名配方行为锁 1 条），零 fail / 零 skip
      ✅ 实测全量 **71 例 / 0 fail / 0 skip**，`rc=0`（耗时 414.8s，读数见执行记录「本机读数」一节）
- [x] 4.2 回归锁：既有 52 例逐一仍在且通过（非 merge 路径「零行为变化」的证据）
      ✅ 既有 52 例逐一仍在并通过；变异 M1–M16 全部 CAUGHT（M12/M13/M14/M16 红集互不相交）
- [x] 4.3 `node scripts/check-pr-exec-record.js --mode=enforce`
      ✅ rc=0：`TIER-COVERAGE dual-closed total=1 external=1 … unknown(字段缺席)=0 unrecognized=0`、`TRANSITION-CHECK 转变=无转变`、`新增记录 1`
- [x] 4.4 `node scripts/check-doc-abs-paths.js`（本 PR 文档不得新增本机绝对路径）
      ✅ 读数 `counts=1161 domain=562 files=561`（本 PR 文档未新增本机绝对路径，统一用 `<worktreeRoot>` / `<tempDir>` 占位）
- [x] 4.5 `node scripts/check-no-brand-residue.js`
- [x] 4.6 `node scripts/check-step-failfast.js`
- [x] 4.7 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（预期 false：混合 PR）
      ✅ `docs-only=false`、`files=9`（含 `scripts/*.js` 与 `scripts/*.test.js` ⇒ 混合 PR，走完整质量节拍）
- [x] 4.8 `node scripts/check-unwired-tests.js`（本单元只往已接线的测试文件追加用例，未新增文件）
- [x] 4.9 QM-6：真跑 `sh scripts/deep-review.sh`，产物写 `tier=external` + 可核 `evidence`；
      `reviewBackends` 与 `deepReview.performedBy` 对账一致（`scripts/ccg-review-backends.list` 为真源）
      ✅ 轮 1 `70e58a90e` 7 条（i1/i6 已落实现 + 锁 T9/T10）、轮 2 `bb42676d3` 存档 critique 7 条
      （裁决覆盖 i1–i4，全 `dismissed`）；`tier=external` **由会话手写**——`scripts/ccg-review-writeback.js`
      在自扮演路径上五条合取中的 `performedBy === 清单 critic` 结构性不可达，故走门禁红文案的出口②；
      `evidence=delivery@4cc601b8…` 由 `deliveryEvidence(findings)` 实算；外部复核真跑
      `codeagent-wrapper --backend claude`，结论贴 PR 评论作 `evidenceRef`。逐条处置见执行记录「QM-6 两轮外部评审」一节
- [x] 4.10 执行记录 `openspec/records/ccg-decider-merge-skip.md`：逐条读数、变异反证红集、
      遗留清单（不写「远程同步」手写状态词，表行状态列写「由门禁推导」）
      ✅ 执行记录 300 行（CRLF 纯、末尾有换行）；`远程同步` 行保持「由门禁推导」；QM-6 行已按产物回填
- [x] 4.11 **两条既有结构锁同 PR 更新并留理由**（不是「为了让测试变绿而改测试」）：
      ① Test 36 的 `/String\(git\(\[/` 判据**不放宽**，改的是实现（先判 `null` 再 `String`）；
      ② 「丙3.2 接线锁」正则尾部 `\s*\)` → `\s*[,)]`（只放宽「第 5 参之后还有没有参数」，
      `backends` 标识符仍逐字要求），并用 T8 补上「第 6 参到底传了什么」这一维。
      详见 design §10
      ✅ 两处判据都**没有放宽**（Test 36 改实现、丙3.2 只放宽尾部参数位），T8 覆盖第 6 实参
- [x] 4.12 **CI 红当场闭环**：首轮推送后 `QG Changes` 的 `Gate 2c2 - Execution-record presence` 红
      （根因：收尾把默认 pathspec 从 `saveRecord` 调用点**上提到函数头**，行为一寸未变，
      但 `scripts/check-pr-exec-record.test.js` 的同源结构锁按 `git diff --cached` 那一行的
      **字符窗口**（`slice(h, h + 200)`）定位排除项，上提把字面量推出窗口）。
      处置三条：① 缺省**留在调用点实参里**（判据可定位性优先于代码整齐度），
      ② 约束写进 JSDoc 与 6 行说明注释（下一次改这里的人先看到「为什么不能上提」），
      ③ 补一条**行为锁**（M16）——结构锁守「配方能在窗口内被找到」，行为锁守「配方真的
      排除了 `.ccg`」，两条各守一侧、谁也不替谁。**既有结构锁一行未改**（139 例全量复跑通过）。
      ✅ `node scripts/check-pr-exec-record.test.js` **139/139 pass、rc=0**（修复前是红）；
      `node --check` 两文件 rc=0；`scripts/ccg-review-decider.test.js` 全量 **71/71 pass**

## 5. 收尾

- [x] 5.1 PR 正文含「为什么」，不只含「改了什么」
      ✅ PR <https://github.com/Colinchiu007/mulpub/pull/4232> 正文含「为什么」、分层说明与门禁读数
- [ ] 5.2 CI 全绿后 squash 合并、删远端分支
- [ ] 5.3 `check-branch-merged.js --ref <tip> --merge <merge SHA>` rc=0 后删本地分支
- [ ] 5.4 main push 回读（`quality-gate` / `Electron CI` / `Build & Release` / `债务熔断门禁`），
      读数写 **PR 评论**（`gh pr comment`），不写仓库文件
- [ ] 5.5 worktree 走 `scripts/safe-worktree-remove.ps1`（干跑 → 实跑 → R7 对账）
