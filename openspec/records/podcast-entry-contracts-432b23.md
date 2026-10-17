---
record: podcast-entry-contracts-432b23
task: 为 tasks 4.3②-b②/③（RewriteView / Publish.vue 两枚入口）补齐它们缺的正文来源与频道来源合同，并就地收敛 §15.2 两行的冲突措辞
date: 2026-10-17
sync_reason: 本 PR 合并后由同线程回填 PR 收口（回填与销账同一次提交，并删除本 frontmatter 登记字段）
sync_backfill_owner: 本会话（podcast-entry-contracts-432b23 线程）
---

## 本次执行记录：②-b②/③ 入口合同（podcast-entry-contracts-432b23，2026-10-17）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见下方 CI 现场（变更集只有 PRD 与本篇记录，无代码/依赖/CI 路径）。
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 PENDING | 远程同步 PENDING

| 门禁 | 状态 | Fresh 证据（当场实测） |
|------|------|-----------|
| 变更类型与隔离 | ✅ | docs-only：未动 `apps/`、`packages/`、`.github/`、`config/`。工作面是 `git worktree add --detach` 到临时目录后 `checkout -B podcast-entry-contracts-432b23`，基点取**合并 #3776 与 #3780 之后**的 `origin/main`（`d68663f3b`，含 #3779）；共享根 `D:/Data/projects/mulpub` 未被触碰（它带着他人会话的实时写入 `M 01-docs/learnings.md` 与一个未跟踪 PLAN 文件，按并发铁律不 stash、不 checkout、不代其清账） |
| 为什么是合同而不是直接实现 | ✅ | 两枚入口此前**不可实现**：§15.2 只各留一行，没有任何一节规定正文从哪取、频道从哪来。判据沿用 §7.10.4.1 那条已被验证的口径——「实现者能否不问就知道这个值从哪来」。硬接的结果必然是在前端另写一份取文/分块/选频道逻辑，即本 PRD 反复禁止的两份口径 |
| 一条被当场否证的旧措辞 | ✅ | §15.2 原把 `Publish.vue` 那行的频道来源写成「上下文频道」，**这是空头支票**：本仓播客频道只有 `usePodcastChannel` 一处解析，发布页的上下文是**平台与账号**，与 RSS 频道不同源。照抄会把入口接到一个不存在的键上，且症状是「入口出现但永远被宿主②层拒」——比报错更难诊断。现裁定为默认频道（与 §7.10.3.2 同一条口径） |
| 现场依据（读码，非记忆） | ✅ | `Publish.vue`：正文真源是 `article.content` —— `ArticleEditor` 的 `v-model`（`:403`）、AI 写作面板入参（`:375`）、回写含 `rewriteHistoryId`（`:378`）、描述框（`:228`）。`:378` 这条同时证明该字段是**在途状态**，因此合同明写「入口只读，不为出期做归一化/落盘/追加」，并把「出期即固化一版草稿」推给另一切片且要求先补发布链幂等判据。`RewriteView.vue`：`rewriteResult.value` 已在 `:395` / `:424` / `:738` 三处以 `content: rewriteResult.value` 被消费 ⇒ 它是改写结果的唯一持有者，**不需回源**（这是它与文案库那枚的关键差异） |
| 新增内容 | ✅ | PRD 新增 `§7.10.3.4`（+44 行）：三条共用不变量（复用同一浮层与同一只读预览 / 频道解析只有一份 / 正文缺席不挂浮层）、两枚各自的「数据校验-流程-交互-显示项-提示文字」逐字段表、5 条验收判据、故意不做三条 |
| 行尾与 diff 对账 | ✅ | 两口径逐行相同：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 均为 `01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md 46/2`。驱动按逐行保留各自行尾写入，CR 总量增量 == 新增行数（脚本内断言） |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` 实跑 `PASS（扫描 9687 个 tracked 文件）`；文中提第三方一律用「参考产品」形态 |
| 受管文档绝对路径 | ✅ | `node scripts/check-doc-abs-paths.js` 实跑 `PASS`；本记录与 §7.10.3.4 写工作树时**一律用占位符/相对形态**，不写本机绝对路径（②-b 那笔 PR 正是被 Gate 12c 点名一处才改正的，这次按同一口径写） |
| 逐字文案表漂移锁 | ✅ | `node scripts/gen-prd-copy-table.js --check` 两份 PRD 均 `OK`（本节不新增 locale 键，故表内容不变；锁仍跑） |
| 与旧载体冻结的关系 | ✅ | 未写 `.quality-gates.md`、未加 `scripts/gate-record-debt-ledger.json` 键；本篇是唯一载体 |
| QM-1 / QM-4 / QM-6 | N/A | 纯文档变更：不涉运行时产物与像素面；QM-6 对 docs-only 不强制（AGENTS：纯文档/流程变更不强制 QM-6） |
| 远程同步 | PENDING | 由本线程回填：`git log origin/main --grep='(#PR)$'` 现取 merge SHA，`git ls-remote --heads` 证远端分支已删，回填与删除登记字段在同一次提交内完成 |

## 一、这一节解决的不是「少一段文档」，而是「少一次静默错误实现」

§7.10.3.4 的每条都带现场行号，目的是让实现切片**没有猜的余地**：正文取哪个变量、频道走哪个解析、正文缺席时浮层该不该挂载、显示值能不能自己算——四问四答。其中「正文缺席 ⇒ 不挂浮层」这一条不是风格：②-b 实测过先挂后取的后果是预览拿空正文跑一趟并弹一句与用户无关的原因句。

## 二、两枚入口仍留为未勾项（不是遗漏，是范围声明）

`tasks 4.3②-b②` / `②-b③` 保持未勾，父项 `4.3②` 依既有规则在两子项落地前不勾。本篇只交付它们的**合同**，不交付实现，也不把合同说成实现。
