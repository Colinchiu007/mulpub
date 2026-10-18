---
record: podcast-plan-accounting
task: 播客一键发布计划的任务账与 PRD 自我承诺就地对账（勾已落的四行、拆未落的两处、补 PRD 自己要求过却没执行的两条接受项）
date: 2026-10-19
---

## 本次执行记录：播客一键发布计划账本对账（podcast-plan-accounting，2026-10-19）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | docs-only 就地编辑：`openspec/changes/podcast-oneclick-publish/tasks.md` 与 `01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md`，零运行时代码、零新增测试文件。判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（commit 之后取证，见下"判定读数"）。仍按 AGENTS 经 PR 落地，不直推 main。 |
| 第一性原因（QM-5 ①） | ✅ | 这批改动的原始引入点不是某次代码改动，而是**规范自己下的支票没有兑付机制**，三处各自独立发生过：① PRD §7.4.0 第 2 条要求"后果必须如实写进 §13"，§13 存续 11 条里一条都没写响度（要求存在 8 天）；② §13 第 9 条把「读侧横幅」与「崩溃对账」写在同一句并整条标 `已闭合`，实测崩溃对账零实现（`publishInflight` 在全部代码里命中 0，忙标记是进程内状态 `services/podcast-channel-locks.js:121`，`:92` 那句"残留由启动对账接管"是注释）；③ §15.4 主张两张表"覆盖 `src/views` 下所有产出文案或成片的页面"，实测该目录 36 个 `.vue`，按产物词元扫出 5 个候选页不在任一表内。⇒ 根因是**陈述句形状的承诺没有判据在看**（与 AGENTS「装饰性门禁」同族，只是这次被承诺方是 PRD 自己）。 |
| 逃逸分析（QM-5 ②） | ✅ | ①单测层：无任何测试读 PRD §13 的条目集合，"写进 §13"这类要求对 CI 结构性不可见；②门禁层：`check-record-qm5-rows.js` 只核**执行记录**的必需行，不核 PRD 内部交叉引用；`openspec-sync-check` 只比 change delta 与主干 spec，不看 PRD 散文；③审查层：历次 QM-6 评审的对象是实现 diff，规格里过期陈述（§8.2.9 标题"尚未实现"、§13 第 9 条的半真半假）不在被审面内；④**本次实测的逃逸点最具体**：`grep -c 响度 §13` 这类核对从未被写进任何收尾判据，而 tasks 4.6 那一行把义务写成了"本期不做"，读起来像已闭合，没人回去看 §13 有没有那一条。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 文档侧四处：① §13 新增第 12 条（跨 provider 降级各块响度可能不一致，含 `REQUIRED_FILTERS` 11 项不含 `loudnorm` 的实测出处与替代口径 `podcast-episode-tts-adapters.js:88-92`）；② §13 新增第 13 条（强杀后在途出期无人认领，点名"第 9 条只对了一半"并把落地顺序钉死为 spec Requirement → 跨重启凭据 → `channel:get` 投影 → 横幅 + zh/en）；③ §8.2.9 标题改「部分实现」并插入落地状态段（含键名偏离 `podcast.episode.origin*` vs 表内 `podcast.voice.origin*`、判据 2 未落、落点换到文本浮层而 `PodcastEpisodeEntry.vue` 的 `voice\|origin` 命中 0）；④ §15.4 的穷尽性主张收窄为"已裁定的 11 个位置"并列出 5 个未裁定候选页。任务侧：勾 `3.3a`/`3.7`/`4.3②`/`4.6` 四行（每行同次补逐绑定点证据行），拆出 `3.6b②`/`4.5b①`/`4.5b②`/`5.1b②` 四条新的未勾项，`3.6b`/`3.11`/`3.12`/`4.5`/`5.1b` 各补现状行后保持未勾。**回归保护**＝这四处更正都带 `文件:行号` 级取证，下一个会话可按同一坐标重取；本 PR 不新增测试文件（无运行面可锁，见"接线棘轮"行的如实说明）。 |
| 防止再次发生（QM-5 ⑤） | ✅ | 三条具体措施，不靠自觉：① **凡"后果必须写进 §X"这类 PRD 自我指涉条款，落点必须与它同批写进 tasks 的验收句**——本次把 §13 第 12 条与 tasks 4.6 的闭合方式绑成一句（"补为 §13 第 12 条后本行按『决定不做 + 接受项已登记』闭合"），下一个人在勾 4.6 时会被迫看到那条支票；② **拆行而不是改写原行**：`3.6b` 没有就地改写成"已落"，而是补现状行 + 新增 `3.6b②` 未勾行——保留原始记录、让未完成部分有自己的可勾对象，这是本仓"禁止把状态列写成历程"的同族手法；③ **over-claim 一律按实测收窄并留下重取坐标**（§15.4 那句改成"36 个 `.vue`、扫出 5 个候选、词元计数分别为 46/14/10/8/6"，下一个会话可以一句话重跑同一条扫描命令验证），而不是删掉了事。未闭合的一条如实记下：**这套"PRD 内部承诺是否兑付"仍无任何机械判据在看**，把它做成门禁需要新判据（扫 PRD 里的"必须写进 §X"句式并要求目标章节含对应条目），属另一刀，本轮不顺手造门。 |
| 行尾与 diff 对账 | ✅ | 两个目标文件在工作副本里都是 `i/lf w/crlf attr/text=auto`。两处更正都由一次性驱动完成（落点 `<本机临时目录>/docs-plan-accounting-tasks.cjs`、`<本机临时目录>/docs-plan-accounting-prd.cjs`，按 AGENTS「受管文档不得新增本机绝对路径」用占位符写、不写盘符）：`split('\n')` 后逐行原样保留各自己的 `\r`，新增行取该文件当场主导行尾，并在写盘前断言「CR 增量 === 新增行数」（tasks：`cr 113→126 / inserted 13`；PRD：`cr→1529 / added 4`，两个断言都过）。提交后两口径对账相等：`git diff --numstat` = `git diff --ignore-cr-at-eol --numstat` = `tasks.md 17/4`、`PRD 6/2`（读数见下"判定读数"）。 |
| 接线棘轮 | N/A | 本 PR 不新增任何 `*.test.js`/`*.test.mjs`/`*.test.sh`/`*.test.ps1`，`scripts/check-unwired-tests.js` 的扫描域无新命中；改动集只有两个 `.md`。 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与 `packages/rpa-engine/`，未触任何 `.vue`/样式文件 ⇒ QM-1 与 QM-4 均不适用（`node scripts/classify-docs-only.js` 判 `docs-only=true` 即为同一结论的机械见证）。 |
| QM-6 CCG 双模型外部评审 | ✅ | 判定产物按 `scripts/ccg-review-decider.js` 落 `.ccg/reviews/<sha>.json`：纯文档改动集 → `mode=skip`/`single`，**未调用外部模型**。这条必须如实读成"外部评审未做"，不得被下一个会话写成"已双模型复核"。理由与边界：本次交付的是文档对账，被审对象没有实现 diff；真正的风险面（勾账是否属实）由本记录的逐绑定点取证承担，评审对象是 `文件:行号` 而不是散文。 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：收口由 `scripts/lib/merge-ledger.js` 按主干历史推导（这篇文件被哪个带 `(#NNNN)` 尾注的已合并提交最近一次带入 main，即算收口）。合并后的 main push 回读证据写在 PR 评论里，不写回本文件。 |

## 判定读数（commit 之后取证，`--head=HEAD`）

- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（文件集：`openspec/changes/podcast-oneclick-publish/tasks.md`、`01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md`、`openspec/records/podcast-plan-accounting.md`、`CHANGELOG.md`）。
- `node scripts/check-changelog-growth.js --base="$(git merge-base origin/main HEAD)" --head=HEAD` → PASS（base 条数全部在 head 里，head 恰好多本片这一条标题块）。
- `node scripts/check-record-qm5-rows.js --base=… --head=HEAD` → OK（必需步骤 ①②④⑤ 齐）。
- `node scripts/check-doc-abs-paths.js --base=… --head=HEAD` → PASS。本记录与 PRD 更正都不写盘符绝对路径：一次性驱动与临时产物的落点一律用 `<本机临时目录>` 占位（AGENTS「受管文档不得新增本机绝对路径」，判据 `all_abs_paths_v2` 按文件内绝对路径条数计，账本只能缩小、不为自己的新增放宽）。
- `node scripts/check-gate-record-debt.js` → rc=0；旧载体（`.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json`）本次**一字未动**（载体冻结，新记录只写 `openspec/records/`）。
- `node scripts/check-no-brand-residue.js` → PASS。

## 逐行勾账表（本 PR 改了哪几行、依据是什么）

| tasks 行 | 处置 | 依据（一句话） |
| --- | --- | --- |
| 3.3a | 勾 + 证据 | 第三条 `publish:progress` 通道七相位真在，`cancellable` 由主进程算，消费者与结构锁逐个有 `文件:行号` |
| 3.6b | 不勾 + 现状行 + 拆 3.6b② | 按相位取消已落、`feedSync` 读侧已落，**崩溃对账零实现** |
| 3.7 | 勾 + 证据 | ①–⑦ 逐条实测在位；⑧ 未落但已由 3.11 单独跟踪，不留悬空 |
| 3.11 | 不勾 + 现状行 | 三处手写常量在位（`:27`/`:33`/`:40`，另 `:69,100,124` 重复） |
| 3.12 | 不勾 + 现状行 | 两份实例那半已消（测试改 `require`），观察面那半未改（5 处直打单例） |
| 4.3②（父项） | 勾 + 证据 | 三枚入口 + 通道 + 计费二次确认 + 三显示项逐项在位；六个子项（含 PR #3942 那枚收尾②）全闭 |
| 4.3②-b 收尾② | 由 PR #3942 勾 | 不在本 PR 内，指针写明 |
| 4.5 | 不勾 + 现状行 + 拆 4.5b①/② | 四档回退在位且定位键真被消费；缺判据 2 抑制与频道 `voiceRef` 写侧 |
| 4.6 | 勾 + 证据 | 决定不做，且 PRD 要求的"后果写进 §13"本次兑付为第 12 条 |
| 5.1b | 不勾 + 现状行 + 拆 5.1b② | 后半句（§15.2 状态列）已执行；前半句的穷尽性主张说过头，5 页未裁定 |

## 本轮沉淀、下次直接可用的三条

- **规格里"必须写进 §X"这类自我指涉承诺，和"待办状态"一样需要东西在看。** 本轮三条 over-claim 全是同一个形状：句子写了义务（§13 补一条 / 覆盖所有页面 / 后果如实写出），而没有任何判据读过那句话。区别只在于这次守门的是 PRD 自己，所以它比"装饰性门禁"更安静——CI 永远不会因为它红。
- **一行里绑两件事，其中一件落了一半，那整行的状态词就成了假话。** §13 第 9 条把「读侧横幅」与「崩溃对账」绑在同一句并标 `已闭合`，四年后（相对本仓寿命而言）没人能只闭合其中一半。正解是本轮用的**拆行**：原行保留、补现状行、未完成那半获得自己的未勾行——绝不就地改成"部分已落"那种没有可勾对象的状态词。
- **收窄 over-claim 时必须同时留下"这句话怎么重取"的坐标。** §15.4 那句从"覆盖所有页面"改成"已裁定的 11 个位置"若只删掉夸张，下一个会话会再犯一次；所以连带写下重取法（该目录 36 个 `.vue`、按产物词元扫、5 个候选各自计数 46/14/10/8/6），让主张可以一句话验证。
