---
record: ccg-deg-artifact-domain
task: QM-6 降级梯 切片A——评审产物「扫描域不得静默收窄」的出声判据（形态不认识但确是评审记录 ⇒ 必须点名）
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（按「PR 自动合并」收尾清单 1–4 条回填，并整段删除本三个 sync_* 字段）
---

## 本次执行记录：CCG 降级梯 切片A 扫描域出声（ccg-deg-artifact-domain，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 改 `scripts/check-pr-exec-record.js`（判据本体）+ 其测试 ⇒ **混合 PR，不走 docs-only 通道**（AGENTS.md：改 `scripts/` 工具脚本自身属混合 PR）。隔离 worktree `mp-ccg-review-degradation`，裸分支 `ccg-deg-artifact-domain`，基线 `origin/main`（`git rev-list --left-right --count HEAD...origin/main` = 0 0 起步） |
| 第一性原因（QM-5 ①） | PASS | 缺陷类别是「命名形态演进时扫描域静默收窄」：`.ccg/reviews/` 的判定记录命名规则在 `0386afdfc`（#3755）从 `<40hex>` 换成 `<stagedDiffHash=64hex>`（`ccg-review-decider.js:496-500`），历史上这类改名**每次都可能不带判据**——#3755 带了（同步放宽 `AUDIT_ARTIFACT_RE` 并自带 fail-open 反向锁），但它靠的是作者自觉，不是机制 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸层是「断言随实现迁移同步」这一族：既有锁只覆盖**当次**改名后的形态集合，对「下一次改名没人管」没有任何东西会红。且 `evaluateDeepReviewDebt` 在 `involved.length === 0` 时 `return {reasons, checked: 0}` ⇒ 扫描域缩到 0 与「没有欠账」在输出上**逐字同形**，属本仓反复登记的「空集恒真」形状 |
| 系统性漏洞（QM-5 ③） | PASS | 具体落点：`scripts/check-pr-exec-record.js` 的 `evaluateDeepReviewDebt`（现 :397 起）缺少「变更集内有 `.ccg/reviews/*.json` 却一条都不认识」这一格的出口。修法不得是"再放宽正则"（那是补今天这格），必须是**让不认识这件事本身出声** |
| 修复 + 回归保护（QM-5 ④） | PASS | 两格一起落：**A/M 方向**加 `REVIEWS_DIR_RE` + 内容谓词 `isReviewRecord()`，`escaped` 非空即点名文件；**D 方向**（由后端评审命中，见 QM-6 行）加 `readAtBase` 注入，读 base blob 判「被删的那条当时是否已闭环」，`removedUnclosed` 与 `unreadable` 各自出声，早退条件收敛为 `involved.length === 0`。TDD 两段实跑：阶段① 只加测试 ⇒ **3 条指名红**（D 未闭环 / 读不到 base / 接线锁）+ 三条「不得误喊」负例当场绿（它们的存在就是防我把噪音当防线）；阶段② 补实现 ⇒ **65 passed / 0 failed**。消费者并集：decider 36、qm5-rows 19、classify-docs-only 27，均 0 fail |
| 防止再次发生（QM-5 ⑤） | PASS | 变异反证 **7 条全部 CAUGHT、各自指名**，`escaped=0 anchorfail=0`，每条还原后与变异前 md5 一致：M-A 正则退回只认 40 位 / M-B `escaped` 恒空 / M-C `isReviewRecord` 恒 true（过宽）/ M-D 未闭环判据恒不成立（删除即逃逸）/ M-E 读不到 base 时静默 continue / M-F 摘掉 single 守卫（把噪音当防线）/ M-G 调用点退回两参数（判据修了但没接线）。M-G 就是本仓「装饰性门禁」的第 N 种落点的对立面：接线本身有锁 |
| 行尾与 diff 对账 | PASS | 分支累计两口径逐文件同数（`git diff --numstat` vs `--ignore-cr-at-eol --numstat`，域取 `scripts` + `openspec`）：判据本体 89/4、测试 112/0、本记录 37/0（+ 本次落账的增减）。index blob 纯 LF（实测 CR=0：本体 539 行、测试 1150 行）。另记一条差量陷阱：分支落后 main 时，`git diff origin/main -- openspec/records/...` 会把**别人新入库的记录**显示成 0/32 的"删除"——那不是本 PR 删的，引用数字必须限定到自己的文件 |
| 接线棘轮 | N/A | 未新增测试文件；新用例全部落在已接进 CI 的 `scripts/check-pr-exec-record.test.js` 内（Gate 2c 点名，无需登记） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与渲染层 |
| QM-6 CCG 双模型外部评审 | 后端交付 / 前端未交付（如实记，不写成双模型通过） | 可达性以产物为准：`deep-review.sh --check-deps` ⇒ claude/opencode 双双 ABS、rc=0（2/2 可用 ⇒ 按本片规格不得走 self-play 出口）。模型名取自 `~/.claude/.ccg/config.toml` 的 `[routing]`。**后端 claude 交付**（载荷是散文不是 JSON 数组，按内容取四条并逐条重放）：① **「D 方向不扫 ⇒ 删掉未闭环 dual 产物即静默逃逸」成立且已落码** —— 它比评审自己说的更要命：并行会话 #3776 的现场就是「中途提交被判 dual+pending 挡住 PR」，门禁给的合规出口是「写明原因并把 status 置成闭环值」，而删除是同一条出口的**免审计版本**；且本文件头部不变量 2 早就写着「必须区分 A/M/D」，判据一直在违反自己的注释。② 「`fs.readFileSync` 无大小上限 ⇒ 大文件内存压力」**不成立**：实测主干 792 个 json 最大 **14,875 B**、中位 642 B、超过 100KB 的**一个都没有**，该风险在本仓不可达（不为不可达场景加边界处理）。③ 「规格高级项（证据分级/高危面/backendAvailability/棘轮）未实现」**属实但非缺陷** —— 与本 change「先文档再代码」的约定一致，tasks 1.x/2.x/3.x/5.x 仍空勾。④ 通道健康度如实记：其输出首行含 `[claude-code:unrecognized_model] model=thinkingmachines/inkling:free[1m]`（子 agent 解析到一个不认识的 free 模型），不改判据、不因此否定其结论，但下一次引用该轴结论时应先复跑。**前端 opencode 两次 rc=0 却零 findings**（只交 Work State/Next Move 停在 SESSION_ID，records 里的第六种"跑完但零交付"形态；已把「禁止交接文本、必须输出数组」写进提示词仍同样），第三次在跑 |
| 记录欠账 | PASS | commit 后实测：`check-gate-record-debt.js` ⇒ rc=0；`check-record-qm5-rows.js` ⇒ rc=0（必需步骤 ① ② ④ ⑤ 齐全）；`check-pr-exec-record.js --base=origin/main --mode=enforce` ⇒ OK（变更 4 个，A=2 M=2，新增记录 1 篇）；`check-no-brand-residue.js` ⇒ PASS；`openspec-sync-check.js` ⇒ OK（387 tasks / 55 active changes / 231 archives） |
| 远程同步 | PENDING | 合并后按收尾清单取 merge SHA 并回读 `(merge SHA, workflow)` 的 main push 读数，同次删除本三字段 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | TDD 两段实跑 ✅（3 条指名红 → 65 pass 0 fail）| 变异反证 7 条指名 ✅（escaped=0 anchorfail=0，还原 md5 一致）| 消费者并集全跑 ✅（36/19/27）| 品牌残留 ✅ | 文档同步 ✅ | 记录欠账 ✅ | QM-6 后端已交付、前端三试中（不按 self-play 收口）| 远程同步 PENDING

### 两处自我更正（不留到下一个会话去发现）

1. **一条被写错的现行漏洞判断**：本片开工前我在会话里断言「`0386afdfc` 把产物改成 64 位命名后，新产物对欠账扫描完全隐形，主干 17 个 64 位产物不参与判定」。实测**不成立**——#3755 在同一个 PR 里就把 `AUDIT_ARTIFACT_RE` 放宽到 40/64/`-again-` 三形态，还自带一条叫「fail-open 反向锁：64 位命名的 dual+pending 记录仍必须判欠账」的用例。我的错误来自**拿共享根工作副本里 #3755 之前的旧行号当现状**（`check-pr-exec-record.js:50`），正是本仓「证据数字必须在最终基线上重跑后再写」那条纪律的又一实例。更正已同时写进测试注释块，避免下一个读者被注释带偏。
2. **一条重复锁**：新写的 `64 位命名 + pending` 用例与既有 970 行那条**逐字同格**，已删除；保留的是真正补缺口的三条（`64hex × cleared` 正控、不认识形态必须出声、不得过宽）。教训：写锁前先 grep 同名/同格既有锁。

### 遗留（不假装已闭合）

- 本切片只落「扫描域出声」这一格。规格里的其余部分未动：**证据分级（`(status, performedBy)` 二元组）**、高危面清单与自反条款的机械实现、`backendAvailability` 落盘、`fallback_closed` 欠账与 outstanding 棘轮（tasks 1.x / 2.x / 3.x / 5.x）。
- `isReviewRecord` 的三个键名是从现有产物形态归纳的；若引擎将来换键名（例如只写 `layer`），谓词会漏判——同族风险与本片要防的"改名"一模一样，只是搬到了内容维度。当前无机械兜底，记此明说。
- D 方向走「未证实」出口时，`--statuses` 外部注入且无可用 base 的调用形态会对被删记录出声；若 CI 里出现该假红，正解是补 base（或改由 `changedFileStatuses` 同源取），不是把出声改成静默。
- D 方向读 base 用 `execFileSync git show <base>:<path>`，`maxBuffer` 取 8MB；产物实测最大 14KB，余量充足，但该上限是**新增的隐式边界**，将来若有人往 `.ccg/reviews` 塞超大记录会走 unreadable 出声而不是崩 |
