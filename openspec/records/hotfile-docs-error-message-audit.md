---
record: hotfile-docs-error-message-audit
task: 补登 #4062（用户可见失败提示友好化）的 CHANGELOG 条目与 4 条教训 —— 该 PR 为避免热文件竞速把这两处移到本 PR
date: 2026-10-20
delivered_by_pr: 4090
---

## 本次执行记录：补登 #4062 的 CHANGELOG 条目与教训（hotfile-docs-error-message-audit，2026-10-20）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档补登（`CHANGELOG.md` + `01-docs/learnings.md` + 本篇），零运行时代码、零判据改动。**动因**：#4062 是代码 PR，原本同批带 CHANGELOG 与 learnings；但 `CHANGELOG.md` / `01-docs/learnings.md` 是全仓最热的追加型写面（实测同一晚被 4 个 PR 置顶插入），代码 PR 的 CI 约 50 分钟，期间主干必然再合入新条目 ⇒ 每轮都以 `CONFLICTING` 告终（实测连续 4 轮：`9d4470c65` → `f947b6978` → `d075a7a4b` …）。正解不是继续 rebase 竞速，而是把热写面拆到**docs-only 快速通道**（重型 job 被短路，窗口约 5 分钟）。#4062 的处置即此：先在代码 PR 内把这两个文件改为「跟随 base 版本」（净差异归零），合并后再用本 PR 一次性补登 |
| 补登内容与来源 | ✅ | 两处文本**逐字取自** #4062 的合并历史（`git show 52ddb3c5e:CHANGELOG.md` / `:01-docs/learnings.md`），不是重新撰写：① CHANGELOG 新增 1 条 13 行的 `# [未发布] fix(s2v): …` 条目，含四层逃逸链、修复四层、locale 成对 8 条、五侧门禁、三轮 CCG 外部评审 13 条逐条处置、回归保护 45 例；② learnings 新增 1 条 42 行教训块（「靠匹配英文原文还原语义」本身就是缺陷 —— 用户可见失败的稳定错误码契约）。**只补这两处**：`01-docs/PRD-USER-FACING-ERROR-MESSAGES-2026-10-20.md`、`BUGFIX-*.md`、`openspec/changes/**`、执行记录等文档**已随 #4062 落地**，无需重复 |
| 教训块的增量（本轮新写） | ✅ | #4062 合并前的 learnings 只有首版教训；本次补登的是**经三轮外部评审后**的版本，多了四条「修复自己带的新缺陷」：① `\uXXXX` 字形无人核对（`\u6664`=晤 而非 `\u666f`=景，850 例测试全绿）；② 占位符残留比原 bug 更糟（存量原文无体积数字 ⇒ 用户看到 `{actualMb}`）；③ 判据域漏「字符串拼出来的 key」（`key + '_no_numbers'`、`'COMPOSE_XXX'` 字面量都不进登记表）；④ 成对数字判不出时必须不给数（猜错比不显示严重）。另含 QM-6 闭环口径与 rebase 三个操作陷阱 |
| 与 #4062 的边界（不假装本 PR 补全了它） | ✅ | 本 PR **只补文档**，不改任何代码/判据/测试。#4062 已合并的代码事实不受本 PR 影响；若两处文案与代码不符，那是 #4062 的问题，本 PR 不代改（也不得据此把 #4062 的验收当成已完成） |
| 热写面写法（防「后推覆盖」） | ✅ | 两文件均为「新条目置顶」：插入前先断言 `base` 的**全部标题**仍在新内容中（`check-changelog-growth` 的判据同形），插入后复核 `git diff --numstat origin/main` 为 `14 0` / `42 0` —— **零删除**。这是本次教训的直接应用：同日一次错误的 rebase 冲突消解曾把 `CHANGELOG.md` 删掉 336 行 / 17 条，根因是「ours/theirs 顺序写反」而非内容冲突 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（`14 0` / `42 0` / 本篇记录若干行新增 0 删除）。Git 提示的 `LF will be replaced by CRLF` 属既有 `text=auto` 行为，不是本 PR 引入的混写 |
| 旧载体冻结 | ✅ | 未向 `.quality-gates.md` 插块、未向 `scripts/gate-record-debt-ledger.json` 加键；`check-gate-record-debt.js` 读数见下 |
| 品牌残留 / 文档同步 / 绝对路径 | ✅ | 三条实跑读数见下「本地判据实跑」 |
| QM-1 打包 / QM-4 视觉 / TDD / QM-6 | N/A | 零代码、零 UI、零判据改动；按 AGENTS「纯文档/流程变更走 docs-only 快速通道」跳过重型门禁。**补充免得被读成免检**：本 PR 不含任何 `apps/` / `packages/` / `.github/workflows/` / `scripts/` 改动，`classify-docs-only` 判定须为 `true`（读数见下）|
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导；现场读数以判据打印为准 |

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 的 `docs-only=` 读数写在 PR 正文（同一判据在 commit 之后取证；预提交时 `HEAD==base` 会得 `files=0`，那是取证顺序不是判定失灵）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #4062

### 本地判据实跑（合并前取，落点 `origin/main` == `8fdd617b2`）

| 判据 | 现场读数 |
| --- | --- |
| `node scripts/check-changelog-growth.js --base=origin/main --head=HEAD` | `PASS：base 573 条（573 种标题）全部在 head 573 条（573 种）里` —— 注意 head 条数与 base 同数是因为我在**工作树未提交**时跑的（未提交则 HEAD==base）；提交后应变为 `base 573 → head 574`，以 PR 正文的 commit 后读数为准 |
| `node scripts/check-changelog-duplicate-entries.js` | `OK: 无重复条目` |
| `node scripts/check-no-conflict-markers.js` | `OK：冲突标记残留 4 个文件全部带原因登记且不超基线（域=11113 个受管文件，标记行=8）` |
| `node scripts/check-no-brand-residue.js` | 见 PR 正文（只扫 tracked，故先 `git add` 再跑） |
| `node scripts/check-doc-abs-paths.js` | 本 PR 不新增本机绝对路径；worktree 一律写 `<仓库父目录>/mp-worktrees/mp-<task>` 占位形态 |
| `node scripts/check-gate-record-debt.js` | 读数见 PR 正文；本 PR 未触碰旧载体 |

### 为什么值得单独记一笔（结构性成本）

#4062 的代码本身在第 1 轮 CI 就已全绿（24 项 required check 全过），真正把它拖了 5 轮的是**热写面竞速**：代码 PR 的 CI 窗口（约 50 分钟）> 主干平均合入间隔（当晚实测约 20–30 分钟），而 `CHANGELOG.md` 又是「谁合谁置顶」的单点写面。

这条对后续同类 PR 的可迁移结论是：**代码 PR 与热写面应当解耦** —— 代码 PR 只做「跟随 base」的净零差异，热写面用 docs-only 快速通道单独补登。代价是多一个 PR；收益是把「必然冲突」变成「必然不冲突」，且补登内容可以按已合并的历史逐字取，比在代码 PR 里反复解冲突更不容易引入「后推覆盖」这类真实数据损失（同日已实测丢过 336 行）。
