---
record: ban-record-closure-backfill-pr
task: 给「禁止为改写收口行另开 PR」这条散文纪律加机械执行体（Gate 2c 新增人工改写档）
date: 2026-10-18
---

## 本次执行记录：给「禁止改写收口行」加执行体（ban-record-closure-backfill-pr，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（判据脚本 + 规格/文档）：隔离 worktree `mp-ban-record-closure-backfill-pr`，裸分支 `ban-record-closure-backfill-pr`；`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false`（改动集含 `scripts/`，按 AGENTS 不得借道快速通道） |
| 第一性原因（QM-5 ①） | ✅ | #3879 把收口改成「按主干历史推导」后，「禁止为改写那一行另开 PR」只活在 AGENTS 散文里，没有任何东西检测它。禁令落主干（merge `b49510794`，03:43 +08）后 6 分钟内起，实测 4 笔回填 PR 仍按旧 SOP 执行：#3889 03:49、#3891 04:18、#3890 04:20、#3884 09:15。成因不是有人抗命，是并发会话带着旧口径的分支与提示在跑 |
| 逃逸分析（QM-5 ②） | ✅ | 单元/集成/审查三层同时漏过，形状一致：既有判据只看「当下有没有未收口行」，永远看不到「这行是本次 PR 改成的」——净 diff 不在任何判据的输入里。窄判据（本 PR 只动那一行）实测漏 2/4（#3890/#3891 除那一行还加了小节），会把这条锁写成装饰 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `scripts/lib/pr-record-diff.js`（PR 差量取源单一实现，三点式 + `--no-renames` + `core.quotepath=off`，词表不进模块）；`scripts/check-gate-record-debt.js` 加三档（状态词跃迁 / 本 PR 造成的重复行 / 整删记录）+ bullet 侧同判 + `触碰记录=0｜N｜n/a` 三档读数。回归锁 `scripts/check-gate-record-debt.test.js` **108 例全绿**（本 PR 从 77 例增至 108 例，+31） |
| 防止再次发生（QM-5 ⑤） | ✅ | 规格 `quality-gate-execution-record` 新增 ADDED Requirement（含三条解析口径 + 空差量与"取不到"不得同形）；AGENTS「PR 自动合并」第 3 条补机械口径与三条正解、第 6 条补「回读读数写 PR 评论、不落仓库文件」；`openspec/records/_TEMPLATE.md` frontmatter 加「不要手工改写那一行」注；接线落 `quality-gate.yml` Gate 2c（既有，未新增测试文件） |
| 行尾与 diff 对账 | ✅ | 新增/改动文件按当场行尾档写：判据与测试文件逐行 CRLF（插入一律 splice + join，CR 增量 == 插入行数 == LF 增量，三计数自证）；新记录与本 change 文档为 LF。两口径 numstat 在 commit 后取，读数写入 PR 正文 |
| 接线棘轮 | ✅ | 未新增 `*.test.js`（用例并入已接线的 `check-gate-record-debt.test.js`，`node --test` 那行已在 Gate 2c）；`node scripts/check-unwired-tests.js` rc=0 |
| 变异反证 | ✅ | 判据本体与取源模块逐条做变异，实跑 **16 条**（M1–M16，M4 已撤销不补装饰）：每条必须 **CAUGHT 且红集指名到用例**；M5（两点式退回）红集含 1.9 的文件集断言；**M2 首跑判 PASSED**（摘掉 CLI 的 `closureDiff` 注入，104 例全绿）⇒ 同 PR 补两条锁后复跑 CAUGHT，该缺陷与后果记在 design D14 |
| 误报率（形态级） | ✅ | 对 origin/main 最近 **120 笔 squash 合并**逐笔跑真判据：命中 52 笔，差量形态**逐笔归类全部是 `PENDING → PASS`**（54 处跃迁），标题非「回填/远程同步/收口/销账」的命中数 0。正控：已知回填 #3889（`99f463121`）当场「在样本内 且 被 flag」，探针失明时脚本自己 exit 3 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 外部评审 | ⚠️ 单轴交付 | 后端轴 claude 四次零交付（前三次 wrapper 报 status 1、第四次已喂 stdin 仍 1），直连探针定性为"该 CLI 此刻对本机不可用"（150s 超时、rc=124、stdout 0 字节）；前端轴 opencode 四次零交付（两次会话状态汇报而非发现清单、两次被 wrapper 的 argv 转发打回 usage）。 替代轴 codex 交付 F1–F8：F1–F5 复核确认早已实现并有指名用例；F6 记进 design 残留风险 5/6，F7 把 proposal 的误报主张从"以标题为真值"改为"形态级 + 注入探针"并补 120 笔实测，F8 落 spec 三条解析口径 + 新用例 + 红文案归属核实指引。 **双模型未达成，如实记单轴，不以自审冒充 PASS。** 细节见下方「遗留」。
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`，本 change 新增的 `HAND-CLOSURE … 触碰记录=<n>` 同行可辨「测到了 / 没碰记录 / 没测到」。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列改写成 `PASS` 会被自己这条新锁判红 |

### 遗留（不假装已闭合）

- **闭合→闭合的改写不拦**（评审 F6，实测确认）：`PASS → PASS（换 SHA、改散文）` 两侧都是闭合词，跃迁档无感。真实暴露面是存量 36 篇手写 PASS 行的证据文字可被任意 PR 无锁改写；派生模型下收口判定不看那一列，但账本不可用那档的文案明写「收口只认状态列的闭合词表」，即回退档里手写闭合词仍有判定力。要收它得加「触碰已闭合行即红」，那会把「修正一个写错的 merge SHA」也判红——没有正解的硬要求本仓不造（见 D7）。
- **旧载体那 23 条欠账本 change 不动**，它们仍靠「就地改写 + 同次销账」这条人工通道；那条通道在形态上就是一次回填，只是落在旧载体。彻底清掉需要另一件事（批量销账或让派生通道也读旧载体）。
- **QM-6 双模型本轮未达成**：两个 primary 后端各连续四次零交付，替代轴 codex 只有一路。评审记录按单轴入库，不把「跑过一次外部模型」写成「双模型 PASS」；`ccg-review-decider` 产物的 `deepReview.status` 如实反映。
- **后端轴失败的归因走过一次半对的路**：我先把原因写成"runner 没喂 stdin"（wrapper 确实回显 `Using stdin mode for task due to: piped input, newline, length>800`），补上 stdin 后**仍然** status 1。绕开 wrapper 直连 `claude -p --output-format text` 才定性：150s 不返回、rc=124、stdout 0 字节 ⇒ 该 CLI 此刻对本机不可用。**教训不是"claude 坏了"，是"wrapper 的报错只能当线索，不能当归因"**；同族纪律见本仓"一律按产物判、不按时长判死"。
- **探针自己也会造出假读数**：第一版直连探针写成 `claude ... | head -5` 后读 `$?`，拿到的是 head 的 0，"rc=0 且零输出"读起来像"可用但没话"。改成 stdout/stderr 各自重定向到文件、再单独取 claude 的 rc，才看见 124。**凡用管道取退出码的探针都不可信**（本仓已记过 `cmd | tail` 吃 rc，这次是在诊断"工具可用性"时重犯）。
- **wrapper 参数嗅探这条只在现场观测到现象，未做归因实验**（不知道是 wrapper 的哪一层把父 argv 拼进子命令），所以写成运行现实而不是结论；下次复用 `.tools/review.cjs` 那类一次性工具时，参数一律走环境变量，不落命令行。
