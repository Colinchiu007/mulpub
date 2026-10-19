---
record: ux-audit-nav-locales
task: UX 审计阶段 3.1（部分）—— TabBar 标签兜底文案收进 locales，并把"谁决定可见文案"的层间关系钉成断言；登记 首页/主页 术语边界与审计稿已被否证的半条
date: 2026-10-19
---

## 本次执行记录：TabBar 文案走 locales（ux-audit-nav-locales，2026-10-19）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时渲染端代码（`apps/desktop/src/components/TabBar.vue`）+ 其测试 + `01-docs/i18n-glossary.md` ⇒ 混合 PR，隔离 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-nav-locales`，裸分支同名，基线 `b8069ab1a`（= #3992 合并后的 origin/main） |
| 第一性原因（QM-5 ①） | ✅ | `getTabLabel` 的两处字面量是 locales 结构拆分时漏掉的兜底分支（同一函数的 `t()` 版本已在别处使用，`useI18n` 也早已 import 进该组件）——不是新缺陷，是"抽取未完成"的残口。 |
| 逃逸分析（QM-5 ②） | ✅ | **既有全部用例对这类残口免疫**：`beforeEach` 把 locale 钉成 `zh`，而 zh 档下 `t(‘nav.home’)` 与字面量 `‘首页’` 产出逐字相同 ⇒ 抽没抽、接没接上 i18n，在 zh 档**不可观测**。写这条测试时还暴露第二件事：模板是 `{{ tab.title || getTabLabel(tab) }}`，**title 优先**，所以只测 zh 档连"走没走 fallback"都测不到。归类：测试场景缺失（缺非默认语言档）。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 两处 → `t(‘nav.home’)` / `t(‘tabs.newTabTitle’)`（两个键与其 en 侧早已存在，**不动 locale 文件**）；新增 4 例：zh 档文案、en 档必须产出 `Home`/`New Tab` 且不得再含中文、结构锁（`getTabLabel` 源码必须含两个 `t(...)` 且不得再 `return ‘首页’`/`‘新标签页’`）、层间关系（title 非空时可见文案取 title）。`vitest run src/components/TabBar.test.js` ⇒ **15 pass / 0 fail**；`NavBar.test.js` + `TabBar.sidebar-toggle.test.js` 同跑合计 **29 → 33 全绿**。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 层间关系那条用例把"真正决定文案的是 store 的 title"钉成断言：谁把 store 也改成随语言走，它会立刻红，逼那次改动显式改判据并交代持久化标签数据的迁移；② 词典新增《首页 / 主页 术语边界》一节，规定新文案一律取 `nav.home`、要区分就改键名不改词；③ 该节同时登记审计稿 3.1 的 `MpModuleNav.vue:37-47` 半条已被实况否证（组件由 #3951 删除，`git log origin/main --diff-filter=D` 取证），并写明"按 `git ls-files` 核在位状态，别按审计稿行号"。 |
| 变异反证 | ✅ | T1 `t(‘nav.home’)` 退回 `‘首页’`、T2 `t(‘tabs.newTabTitle’)` 退回 `‘新标签页’` ⇒ 各自 rc=1、≥1 条指名用例红；驱动以 md5 自证还原，`RESTORED_OK=true`。 |
| QM-2 必检项 | ✅ | 无新增同步阻塞原语；无新增全局组件/顶层 CSS；无新增 require 路径；未改 preload/IPC；无新增 `v-html`；渲染端非 locales 文件的中文字面量**净减 2 处**（该文件仍有的 `‘New Tab’` 是与主进程哨兵值比较的字面量，不属可见文案，保留）。 |
| locale 成对 | ✅ | 本批**未新增任何 locale 键**（只消费既有 `nav.home`、`tabs.newTabTitle`），zh/en 成对状态不变；`check-locale-sync` 由 CI 复核 |
| QM-4 视觉 | N/A→已核 | 可见文案逐字不变（zh 档产出与旧实现完全一致）⇒ 无像素面变化。en 档变化属"原本就被 i18n 忽略的兜底"被接上，不构成基线漂移（像素基线取 CI 的 zh 档渲染）。**未刷新任何基线**。 |
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/`、`packages/rpa-engine/`；纯渲染端 composable/组件层 |
| QM-6 CCG 双模型外部评审 | 未执行 | pre-commit 打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁`；本机无可用外部评审通道 ⇒ 如实记未执行 |
| 行尾与 diff 对账 | ✅ | 三个被改文件（`TabBar.vue`、`TabBar.test.js`、`i18n-glossary.md`、`CHANGELOG.md`）工作副本均纯 CRLF，插入前后 `crlf==lf` 双校验；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件一致 |
| 品牌残留 / 受管文档绝对路径 | ✅ | 两把内容门禁都在**持有该内容的本 worktree** 内跑并通过；worktree 路径写 `<仓库父目录>/...` 占位 |
| 远程同步 | 由门禁推导 | 本行不事后改写；合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导 |

- 保留门禁：docs-only=false 完整节拍 | 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件 | 远程同步 PR #（合并后由门禁推导）

## 刻意没做的事

- **没有**改 `stores/tab.js` 的 `title: ‘首页’`（那才是真正的可见文案来源）：它写进标签持久化数据，"旧数据要不要跟着改名"是产品语义问题，属阶段 3.2 的四份真源收敛。
- **没有**统一 `sidebar.home=主页` 与 `nav.home=首页`：同上，需要一个词做决定，且会改用户可见文案 ⇒ 触发像素基线重取与人工审核。本批只在词典里定下写作规范。
- **没有**新增 locale 键、没有动 `TabBar.vue` 里与主进程哨兵值比较的 `‘New Tab’`。
