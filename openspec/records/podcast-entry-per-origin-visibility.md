---
record: podcast-entry-per-origin-visibility
task: 收口 4.3②-b 收尾②（入口可见性按来源分档）与 QM6-2（摘掉两处不可达的 ensureChannel 兜底）
date: 2026-10-19
---

## 本次执行记录：文案库出期入口按来源分档 + 摘死分支（podcast-entry-per-origin-visibility，2026-10-19）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/views/CopyLibraryView.vue` + `RewriteView.vue` + `CopyLibraryView.test.js`）⇒ 隔离 worktree（`session-init.sh` 唯一入口），裸分支 `podcast-entry-per-origin-visibility`；`ensure-electron` 报 v43.7.7 就绪，`verify-worktree-deps.js` 11 项解析通过；开工前 `mp-worktree-health.ps1 -RequireWriteGuard` ok=true、共享根 `git status --porcelain` 为 0 行且停在 main |
| 第一性原因（QM-5 ①） | ✅ | 不是"忘了判正文"。第一性原因是**引入判据那一刻就选错了判据的输入**：`useCopyLibrarySources.js` 的 video 分支把 `content` 写成 `sourceText 的前 N 字`（列表预览），而该分支的过滤器只要求 `sourceText || title` 非空 ⇒ `content` 在 video 档**不是"有没有正文"的可靠代理**（有标题没预览的视频项，列表态 `content` 就是空串，回源却有全文）。于是"统一按 `entry.content` 判"这一眼看上去最自然的写法，会同时犯两个错：把 video 档的**可用入口藏掉**，又留着一个 `origin=rewrite` 且正文为空的**点了没反应的死按钮**（四层来源里只有 rewrite 那层没做 `|| title` 兜底）。同一条判据对两种来源给出两种相反的错误，所以修法只能是**分档**，不是把阈值调宽或调窄 |
| 逃逸分析（QM-5 ②） | ✅ | ①单测层：`CopyLibraryView.test.js` 原有 3 条入口用例只覆盖了「有频道 ⇒ 出现」「无频道 ⇒ 不出现」「draft 空正文 ⇒ 点了不挂浮层」，**没有任何一条把 video 档与 rewrite 档分开**——夹具里 video 项 `content='截断预览'` 非空，所以"按 content 判"和"按 wordCount 判"在该输入下**同形**，测试结构上无法区分两种实现；②断言层：第三条用例断言的是"点了之后什么都没发生"，这把坏按钮**断言成了正确行为**（同类教训见 learnings 的「测试断言不得反向固化错误行为」）；③审查层：QM6-1 在 #3807 已点名该残留并判 Warning 不阻塞，注释里写了收口条件，但没有任何机械东西在等这笔账——欠账的可发现性只有 PRD 与注释两处散文 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 判据收成一处 `canShowEpisodeEntry(entry)`：无默认频道一律不出现；`copyEntryOrigin(entry) === ORIGIN_VIDEO` 判 `Number(entry.wordCount) > 0`；其余三档判 `String(entry.content || '').trim().length > 0`。模板 `v-if` 与点击路径**共用它**（`if (!canShowEpisodeEntry(entry)) return`），不再各写一份。QM6-2 同时落地：两处 `const channelId = podcast.activeChannelId.value \|\| await podcast.ensureChannel()` 的兜底分支不可达（`v-if` 已保证非空），摘掉并各留一道 `if (!channelId) return`；`RewriteView.openScriptEntry` 因此不再需要 `async`，一并改回同步。回归保护 4 条新用例 + 1 条改写：`video 档按 wordCount 判`（空预览 + 回源有全文 ⇒ 动作在，且送预览的是回源全文而非列表态空串）、`video 档 wordCount 为 0 ⇒ 不出现`（同档配「有字数的 v1 必须在」的正控，防"video 全被藏"假绿）、`rewrite 档空白正文不出现`（同档「有正文必须在」正控）、`draft 空正文不出现`（把原来那条"点了没反应"改成渲染期判据），另加一条结构合同：两处入口不得再出现 `await …ensureChannel()` 兜底、`canShowEpisodeEntry` 定义恰好一处且函数体内 `ORIGIN_VIDEO` 与 `.trim()` 两档判据都在。末态：把两条结构合同合并成单一源码读取点后，`CopyLibraryView.test.js` **16 passed**，与 `RewriteView.test.js` 合跑 **110 条 109 passed / 0 failed**（中间那次 `1 failed` 是我自己写错的判据，见变异行末两条）|
| 防止再次发生（QM-5 ⑤） | ✅ | 三条都有落点：① **夹具必须能区分两种实现**——本档的根因是"video 项 content 非空"这一夹具形状让两条判据同形，故新增 `video:v2`（`content=''` + `wordCount>0` + 回源有全文）与 `video:v0`（`wordCount=0`）两支，使"按 content 判"与"按 wordCount 判"在任何输入下都不再同形；这条写成判据：**给多来源共用的判据写用例时，先问"有没有一个输入能让两种实现给出不同结果"，没有就说明夹具测不到这一维**。② **不得把坏行为断言成正确**——原先那条"点了没反应"的用例改名改判为「按钮根本不该存在」，同类形态已在 `01-docs/learnings.md` 有记录，本次是它在入口族上的第二次落点。③ **负向断言成对**（本文件已有纪律）：每条"不出现"都在同一档配一条"必须出现"，`video` 档两条用例分别覆盖 `wordCount>0` 与 `=0`，避免分档被悄悄抹平成"一律显示"或"一律隐藏" |
| 变异反证 | ✅ | **6 道全部指名红（N1–N6），无 NOT_CAUGHT**。逐条先断言锚点命中=1、直跑 `node <root>/node_modules/vitest/vitest.mjs`、规模下界 `numTotalTests ≥ 16`、跑完按字节还原并核 md5（`baselines` 与 `restored` 两行读数逐文件相等：`CopyLibraryView.vue=4db1c72d`、`RewriteView.vue=b5c69b91`）。读数：`N1` video 档退回按 content 判 ⇒ 2 红（分档行为用例 + 结构合同）；`N2` `> 0` 放宽成 `>= 0` ⇒ 1 红（零字数视频那条）；`N3` 非 video 档判据改恒真 ⇒ 3 红（draft、rewrite 两条行为 + 结构合同）；`N4` / `N5` 把不可达兜底分别加回文案库 / 改写区 ⇒ 各由结构合同指名红；`N6` 点击路径绕开共用判据 ⇒ 结构合同红。**红集重合处如实写出**：`N4`/`N5`/`N6` 三条同由那条结构合同承载（它们攻的本来就是"判据只写一处"这一个承重点），不是三道互不相同的闸。**两条驱动自坏（都是"探针瞎"被读成"数据坏"）**：① `N5` 第一版用「函数头 + channelId 那行」两行拼锚点，而它们之间隔着三行注释 ⇒ 恒 0 命中，只被记成 `ANCHOR_MISS`——那会被读成"这条变异不成立"，实际是锚点写错；改成「起始行 → 含结束片段那行的行尾」的跨行取法后 CAUGHT。② 把结构合同拆成两个 `it` 时，第二个 `await import('node:url')` + `fileURLToPath(import.meta.url)` 在 vitest SSR 下抛 `TypeError: The URL must be of scheme file`，症状像"我的源码路径写错了"，而两处代码逐字相同——合并成单一读取点后全绿。教训写成两条：**跨行锚点必须由文件自己的行尾与真实行距推出**；**同一测试文件里"按源码读的结构锁"要共用一处读取，别在多个 `it` 里各开一次动态 import** |
| 行尾与 diff 对账 | ✅ | 两口径 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件相同（当场读数见 PR 说明）。`CopyLibraryView.test.js` / 两个 `.vue` 工作副本是 CRLF（`i/lf w/crlf attr/text=auto`），编辑一律单行锚点或按文件自身行尾拼装；本篇记录与新写的注释均按该文件档位逐行写回，落笔后断言 `cr == lf == 行数` |
| 接线棘轮 | ✅ | 不新增测试文件，改的是已被 `vitest.config.js` 的 `src/**/*.test.{js,ts}` glob 收进的 `CopyLibraryView.test.js`；现场证据是该文件在本轮 `--reporter=json` 报告里 **16 条被收集且 16 passed**（`total=16`），不是"文件存在" |
| QM-1 打包 / QM-4 视觉 | N/A / 交 CI | QM-1 不触发：改动集零 `apps/desktop/electron/**`、零 `packages/rpa-engine/**`。QM-4：`CopyLibraryView` 属像素域视图（动作按钮的出现条件变了），本机不冒充跑像素门禁，证据责任交给 CI `QG Visual` |
| QM-6 CCG 双模型外部评审 | 待判定后如实填 | 提交时由 pre-commit 的 `ccg-review-decider.js` 按 diff 规模判档；本片量小（两视图 + 一测试），若判 `single/skip` 就不调外部模型，判定与原因写回本行，不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 遗留（不假装已闭合）

- `origin=collect` / `origin=draft` 两档的正文当前**只来自列表态 `entry.content`**，不回源。若将来某层来源的正文也变成"列表态只是预览"（video 档已经是这样），判据必须再分一档，而不是继续用 `content.trim()` 统称——本片把这件事写成了注释与判据结构，防止被后来者"顺手统一"。
- 像素门禁本机未跑；`CopyLibraryView` 的按钮从"有频道就有"变成"有频道且该档有正文"，若基线截图里有带标题无正文的视频卡，可能出现真实视觉差异——留给 CI 判，不预先解释成噪声。
