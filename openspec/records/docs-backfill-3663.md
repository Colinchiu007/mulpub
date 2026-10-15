---
record: docs-backfill-3663
task: 回填 #3663 远程同步 PASS + 销账（百家号图文段落塌陷 + 知乎假发布成功）
date: 2026-10-16
---

## 本次执行记录：回填 #3663 远程同步 PASS + 销账（docs-backfill-3663，2026-10-16）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯文档/流程回填 ⇒ 允许就地编辑 + PR 落地。**本轮在隔离 worktree 内完成**（`mp-fix-article-paragraph-zhihu-publish`，改完 `git switch -c docs-backfill-3663 origin/main`）：非必需，但该 worktree 已就绪且不触碰共享根（共享根同一时刻可能被其它会话做 git 写，按「多会话绑定同一共享 cwd 时先暂停 Git 写操作」纪律规避 index/HEAD 竞争） |
| 判定（docs-only） | PASS | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ **docs-only=true files=5**（`.quality-gates.md`、`CHANGELOG.md`、`01-docs/learnings.md`、`openspec/records/fix-article-paragraph-zhihu-publish.md`、本记录）⇒ 走 docs-only 快速通道：QM-1 打包 / QM-4 视觉 / TDD / QM-6 双模型按通道豁免（与运行时无关） |
| 第一性原因（QM-5 ①） | PASS | 本体 PR **#3663**（merge `ffb2209251b3c3a1221300b39cd9d238f0193d1a`，2026-10-16T00:48:12+08:00）已合并。本体按「**代码 PR 不带热点载体**」纪律刻意不带 `.quality-gates.md` / `CHANGELOG.md` / `01-docs/learnings.md`（共同追加热点 ⇒ CI 30–37 分钟期间主干前进即冲突），其条目推迟到本回填 PR；本 PR 即该缺口的收口动作 |
| 逃逸分析（QM-5 ②） | PASS | 沿用已沉淀判据：①「远程同步」**两形态同写**（表格行 + bullet 以状态词收尾，缺一即红）；②**回填与销账同一次提交**；③状态列只写当下状态（不写 `PENDING→PASS` 历程）。本轮三处均按此执行（见「修复 + 回归保护」行） |
| 修复 + 回归保护（QM-5 ④） | PASS | 同一次提交内四件事：① `openspec/records/fix-article-paragraph-zhihu-publish.md` 的「远程同步」**表格行与 bullet 两形态同改为 PASS** + merge SHA（`ffb220925`）+ 时间，并**删除 frontmatter 的 `sync_*` 三字段**；② `.quality-gates.md` 顶部补本体 QG 块（24 行，直接写最终 PASS 形态，含 QM-1/QM-6/热点载体隔离/CCG 存量误报取证/远程同步 PASS）；③ `CHANGELOG.md` 两条条目（百家号段落塌陷、知乎假发布）；④ `01-docs/learnings.md` 本轮教训 6 条（修复层级必须早于事故点 / 夹具会把缺陷锁成契约 / 成功判据只能严格形状 等）。远端分支已删（`git ls-remote --heads origin fix-article-paragraph-zhihu-publish` = **0 行**） |
| 防止再次发生（QM-5 ⑤） | PASS | 本体已是**机械锁**（4 个回归测试文件 + 真实 Quill DOM 用例 + 与发布链逐字节等价的 parity 锁 + 两处变异反证），非文档纪律；`AGENTS.md` QM-2 新增「富文本编辑器装载合同」。本轮回填另把 4 条过程教训写入 `learnings`：① 本地门禁清单必须与 CI 的 `QG Static` 逐条对齐（本轮漏跑 Gate 11 ESLint，被 CI 拦下一次）；② 热点载体隔离 + 回填同次销账；③ 「记录按父提交 sha 命名」使闭环记录结构性不可达（`origin/main` 594 条判定记录中 `dual/pending` 213 条 vs `dual/cleared` 1 条）；④ pre-commit 的 `.ccg/reviews/*.json` 全量遍历在 590+ 文件时单次提交可达 30 分钟以上（本机实测 2.2–7 s/文件） |
| 反证 | N/A | 纯文档改写，无行为面；本体反证见 #3663（改回 `props.modelValue` ⇒ 组件级 4 红 + 真实 Quill 3 红；放宽终态判据 ⇒ `/edit` 反例当场红） |
| 编码与行尾 | PASS | `git diff --numstat origin/main` 与 `--ignore-cr-at-eol --numstat` **逐文件一致**（两口径 IDENTICAL）；新增/改写文本一律 **UTF-8 无 BOM**、CRLF |
| QM-1 / QM-4 | N/A | 未触生产代码与渲染层 |
| QM-6 双模型外部评审 | 未执行 | 纯文档回填；通道本身豁免。本体 QM-6 已在 `fix-article-paragraph-zhihu-publish.md` 如实登记为 PENDING（工具链形态 + 本仓常态统计），**不以自审冒充通过** |
| 记录欠账 | PASS | `node scripts/check-gate-record-debt.js` ⇒ OK（两源所有未收口的「远程同步」行均已登记，清单无陈旧项）；`node scripts/check-record-qm5-rows.js --base=origin/main --head=HEAD` ⇒ OK；`node scripts/check-no-brand-residue.js` ⇒ PASS（9277 tracked 文件） |
| 远程同步 | PASS | 本体 #3663 squash 合并 merge SHA `ffb2209251b3c3a1221300b39cd9d238f0193d1a`（2026-10-16T00:48:12+08:00）；远端分支 `fix-article-paragraph-zhihu-publish` 已删（`git ls-remote --heads` 0 行）；`git log origin/main --grep='(#3663)$'` 恰好 1 行。本回填 PR 自身的远程同步在合并后由后续 docs PR 收口（回填与销账同次发生） |

- 保留门禁：判定 docs-only=true ✅ | 行尾对账 ✅（两口径 IDENTICAL）| 品牌残留 ✅（9277 tracked，命中 0）| 文档同步 ✅（CI doc-gate，`01-docs/**` + `openspec/**` + `CHANGELOG.md` 命中 PRD_PATTERN）| 记录欠账 ✅ | 热点载体落地 ✅（`.quality-gates.md` + `CHANGELOG.md` + `01-docs/learnings.md` 三份在本 PR 同次补上）| 远程同步 PASS（#3663 merge `ffb220925`，远端分支已删）
