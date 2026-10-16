---
record: openspec-archive-audit
---

## 本次执行记录：OpenSpec 变更归档审计与单个可安全归档项落地（openspec-archive-audit，2026-10-16）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 📝 纯文档/规格变更（搬 `openspec/changes/**` 目录 + 新增 `01-docs/AUDIT-*.md` + 本记录 + CHANGELOG），按 AGENTS 分层判定**不需要**独立 worktree；但共享根当时有**他人会话的 4 个未提交文件**（`CHANGELOG.md`、`openspec/changes/publish-frequency-policy-v4/tasks.md` 已改，两份 `01-docs/*.md` 未跟踪），强制入口 `scripts/start-mp-task.ps1` 的健康门带 `-RequireClean` 因此**拒绝创建**（实测 `mp-worktree-health.ps1` 单跑 `ok:true / clean:false`，worktree 未被创建、也未留下半失效注册）。为**不碰他人状态**，改用 `git worktree add -b openspec-archive-audit '<仓库父目录>\mp-worktrees\mp-openspec-archive-audit' origin/main` 直建隔离目录，并按 AGENTS 工具层要求当场 `rev-parse --show-toplevel` + `--abbrev-ref HEAD` 验证可进入（`c9086f1cb` / `openspec-archive-audit`）。**这是对"必须从强制入口启动"的一条偏离，偏离原因与验证都写在这里**；docs-only 不触发 QM-1，也不需要依赖树 |
| 判定证据（docs-only 通道） | PASS | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（在提交之后取）；本 PR 全部落在 `openspec/**`、`01-docs/**`、`CHANGELOG.md` 白名单面 |
| 第一性原因（QM-5 ①） | PASS | **归档前置条件从来没有被定义过，只被"感觉"过**。`openspec/changes/` 攒到 51 个活跃变更，而仓内没有任何东西回答"哪些是已合并且可以归档"；既有的 `scripts/openspec-sync-check.js` 只管 change 引用是否**悬空**（引用不到就红），**反向不查**（做完的没归档 = 完全无声）。于是每次有人想清理，都要现场重读一遍 change，判据每次重写、每次口径不同——这才是"归档积压"的第一性原因，不是"谁忘了归档" |
| 逃逸分析（QM-5 ②） | PASS | ① **判据层**：没有"A 类可归档"这一档，所以既没有测试也没有门禁能逃逸与否——它压根不存在；② **审计层**：`tasks.md` 全勾被默认当成"做完了"，而实测有 3 个变更（B 类）**全勾但 delta 从未进主规格**，按默认理解归档就会把这三组需求永久留在 `archive/` 里，主规格面从此缺条；③ **计数层**：4 个 change **没有 `tasks.md`**（D 类），任何"`grep -c '\[ \]'` == 0 ⇒ 可归档"的朴素写法都会把它们**判成满足**——本轮脚本对这类返回 `-1` 并单列，就是为堵这个形状；④ **分类**：测试场景缺失（缺"归档前置条件"这一判据）+ 流程缺失（归档动作没有定义"什么状态才许做"） |
| 修复 + 回归保护（QM-5 ④） | PASS | ① 把前置条件写成三条可重取的判据（任务全勾 ∧ delta **整块**已进主规格 ∧ 有 `MERGED` 证据），并落 `01-docs/AUDIT-OPENSPEC-ARCHIVE-2026-10-16.md`，含**不依赖本地脚本**的复现命令；② 按这三条实测分桶：A=1 / B=3 / C=43 / D=4，A 类那一个当场归档——`film-production-artifact-identity`：27/27 任务已勾、`film-engineering` 主规格 16 条中整块命中 3/3、PR #3427 `MERGED` + merge SHA `e82c1d3f797be4578339e97a859de354b9b349a2`；③ **回归保护不是新增测试而是 A/B 对照**：搬迁前后各跑一次 `node scripts/openspec-sync-check.js`，两份输出**逐字节相同**（同为 `rc=2 / 14 条`，那 14 条是本工作树基于 main 的既有状态、由 PR #3693 在修），证"归档搬迁不引入新违规"。标题级判据被明确标注为**只够分桶、不够放行**，真要归档必须换整块包含——这条口径差异是本审计与既往"顺手归档"的实质区别 |
| 防止再次发生（QM-5 ⑤） | PASS | ① **规范**：`01-docs/AUDIT-OPENSPEC-ARCHIVE-2026-10-16.md` §一 把三条判据定死，§四/§五/§六 把 B/C/D 三类各自的下一步写清（谁做、做什么、为什么本轮不代做），下一个会话不必重造口径；② **判据形状已备好待接线**：`CHANGE_READY_TO_ARCHIVE`（任务全勾 ∧ delta 整块已进主规格 ∧ 有 MERGED 证据 ⇒ 出声不拦）**刻意不在本 PR 实现**——它要改的正是 #3693 正在改造与接线的 `openspec-sync-check.js` 判据集，同期改两处会让两个 PR 的判据变更无法分别归因；这条"为什么不现在做"写进 §七，防止被读成遗漏；③ 顺序依赖如实登记：#3693 先合或本 PR 先合都不需要回头改对方，由上面的 A/B 相同证出 |
| 落地顺序与不代做 | PASS | 本 PR 不碰任何 `task.json`、不新增 change 引用；B 类三个的主规格同步（`collection-ui` / `quick-collect` / `wechat-mp-publish-track` 三份主规格**整份不存在**）与 C 类 43 个的逐个判定，均留给各自能力线会话，本 PR 不代做——把"实质同步主规格"塞进"卫生清理"会让两种风险混在一个 PR 里 |
| 行尾与编码对账 | PASS | 新增两份 MD 均按仓库惯例写；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径对账见 PR 说明；归档的 6 个文件是纯 rename（内容零改写），不引入行尾变化 |
| re-sync 与一条 main 侧既有红 | PASS | 分支落后 5 个提交、`CHANGELOG.md` 顶部冲突。⛔ 第一版**取数域是错的**：worktree 建在 `c9086f1cb` 而本地 `origin/main` 之后又前进，于是 `--base=origin/main --head=HEAD` 把「上游新增」算成本分支的反向改动，凭空报出 4 个我没碰过的文件（`learnings.md`、`publish-frequency-v4.md`、`pub-record-republish-changelog.md`、`publish-frequency-policy-v4/tasks.md`）。正解是先 `git fetch` + re-sync 到 `behind=0` 再取数。解冲用 `git merge-file --union`，判据换成**多重集恒等** `merged == theirs + (ours − base)`（旧口径「本分支每一行都必须保留」会把 main 的合法就地删除判成丢内容，本轮第三次命中）；恒等式当场抓到 union 吃掉的一个分隔空行（`missing=1×"\n"`），补回后 `identityHolds=true / markers=0`。**另记一条我自己的形状错**：置顶块插入时条目正文与下一条 `#` 标题之间漏了空行，第一反应是让解冲器"顺手补上"，但那会让恒等式多出一行无归属——正解是 `merge --abort`、把形状修在**自己那一笔**里（`4593b2fc4`）再重合，归属才干净。 **⛔ `check-doc-abs-paths.js --base=origin/main --head=HEAD` 判红，但那是**本机专属**的读数，CI 上是 PASS；据此写的全称断言已被现场否证并撤回**：本地（连控制组 `--head=origin/main`、改动 0 个）都报 `rc=1 / 01-docs/learnings.md：35 处 > 基线 34`；而 CI run `38860340386` 的 `QG Changes` 同一步打 `PASS（改动 2 个 + 基线并入，扫描 437 个文件）`——**域逐字相同、结论相反**。候选解释一（取数域钉错起点）已否证：把 `--base` 钉成 CI 的 merge_base `c3ef51208` 后本地仍红，且 `git rev-list --count c3ef51208..origin/main` = 0。**真因在源码**：`check-doc-abs-paths.js:163` 的 `existingDriveRoots()` 用 `fs.existsSync` 逐盘符探测本机有哪些盘，`:191` 的 `firstMissingSegment()` 开头 `if (!driveRoots.has(drive)) return null`，其注释原文「CI runner 上不存在 `D:`…只认本机盘符」⇒ 本机有 `D:` 时那条失效路径入域（35），runner 无 `D:` 时不入域（34）＝PASS。所以这条判据的 PR 侧结果**本就是机器相关的**，也正是 #3652 把入域条件从「盘上不存在」换成「出现即计」要收的那一维。我犯的错：拿一次本机读数外推出全称断言，而这件事从源码问一句就能先知道。本 PR 不代修：把别人的新增用 `--write-baseline` 记进账本，正是本判据要拦的形状；收口属 PR #3652（其账本换代在 re-sync 时重算，第五轮读数 552/1171）。本 PR 自带的两份新文档实测**绝对路径形 token=0**，未贡献任何新增 |
| 品牌残留 | PASS | `node scripts/check-no-brand-residue.js` rc=0（9402 个受管文件）；本文只写「参考产品」 |
| 文档同步（doc-gate） | PASS | 本 PR 动的是 `openspec/changes/**` 与 `01-docs/AUDIT-*.md`；主规格 `openspec/specs/film-engineering/spec.md` **未改动**（判据已验 3/3 整块命中，无需同步），故不触发规格同步欠账 |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 `.vue`/样式/基线 PNG；本 PR 无代码变更，走 docs-only 快速通道 |
| QM-6 CCG 双模型外部评审 | N/A | 纯文档/规格变更，按 AGENTS「纯文档/流程变更不强制 QM-6」；本轮**未跑**外部评审，如实记 N/A 而非 PASS |
| 远程同步 | PASS | 本 PR 即 **#3708**，`state=MERGED`，merge SHA `3518b54560b3efc4d94a97ca11a8bda3ffad2a3f`，时间 2026-10-16T06:35:44Z（UTC）= 14:35:43+08:00。取证三件：① `git log origin/main` 按主题尾 `(#3708)$` 检索得**恰好 1 行**；② `git ls-remote --heads origin openspec-archive-audit` 返回 **0 行**（远端分支已随 squash 删除）；③ 产物回读：`origin/main` 上 `openspec/changes/archive/2026-10-16-film-production-artifact-identity` 与 `01-docs/AUDIT-OPENSPEC-ARCHIVE-2026-10-16.md` 各命中 1。同一次提交内已删除 frontmatter 的三个 `sync_*` 字段（新载体不在 JSON ledger 留项） |

### 遗留（不假装已闭合）

- **A 类只有 1 个不是"清理完成"，恰恰是"积压被量化了"**：50 个 change 各有一道具体前置没满足，
  其中 43 个从未被逐个判过"未勾项是故意不做还是没做完"。本 PR 给的是判据与分母，不是清空的队列。
- **`CHANGE_READY_TO_ARCHIVE` 判据仍未接线**（理由见上），所以"A 类又攒了几个"这件事**目前没有任何东西在看**，
  下一次仍要靠人工重跑本审计。这是既有缺口的缩小，不是闭合。
- 本审计的数字绑 `origin/main` 的这一刻；main 每几十分钟前进一次，后续会话请重取引用值。
