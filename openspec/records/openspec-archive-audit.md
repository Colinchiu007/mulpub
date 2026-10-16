---
record: openspec-archive-audit
sync_status: PENDING
sync_reason: 本 PR 尚未合并；合并后由后续回填 PR 把远程同步行改为 PASS 并删除本段三个字段
sync_backfill_owner: 下一个会话（合并后改为 PASS 并删除本段三个字段；新载体不进 JSON ledger）
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
| 品牌残留 | PASS | `node scripts/check-no-brand-residue.js`（本 PR 文档只写"参考产品"，未写竞品名） |
| 文档同步（doc-gate） | PASS | 本 PR 动的是 `openspec/changes/**` 与 `01-docs/AUDIT-*.md`；主规格 `openspec/specs/film-engineering/spec.md` **未改动**（判据已验 3/3 整块命中，无需同步），故不触发规格同步欠账 |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 `.vue`/样式/基线 PNG；本 PR 无代码变更，走 docs-only 快速通道 |
| QM-6 CCG 双模型外部评审 | N/A | 纯文档/规格变更，按 AGENTS「纯文档/流程变更不强制 QM-6」；本轮**未跑**外部评审，如实记 N/A 而非 PASS |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin openspec-archive-audit` 返回 0 行证远端分支已删；回填时把本行改写为 PASS 并**删除上方三个 `sync_*` 字段**（同一次提交内完成，不在 JSON ledger 留项） |

### 遗留（不假装已闭合）

- **A 类只有 1 个不是"清理完成"，恰恰是"积压被量化了"**：50 个 change 各有一道具体前置没满足，
  其中 43 个从未被逐个判过"未勾项是故意不做还是没做完"。本 PR 给的是判据与分母，不是清空的队列。
- **`CHANGE_READY_TO_ARCHIVE` 判据仍未接线**（理由见上），所以"A 类又攒了几个"这件事**目前没有任何东西在看**，
  下一次仍要靠人工重跑本审计。这是既有缺口的缩小，不是闭合。
- 本审计的数字绑 `origin/main` 的这一刻；main 每几十分钟前进一次，后续会话请重取引用值。
