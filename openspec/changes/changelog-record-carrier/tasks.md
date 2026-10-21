# tasks：changelog-record-carrier

> 顺序不是排班好看，是被两条硬约束逼出来的：
> ① **聚合器必须先存在**，禁改门禁才能落地——否则窗口内新条目无处可去；
> ② **禁改门禁必须先 advisory**，因为此刻在飞 35 个 PR 里绝大多数已经按旧写法改了 CHANGELOG，直接转 blocking 会把它们全部判红，而那不是它们的错。
> 引用本文件任何"在飞 PR 数 / 重复键数 / 提交占比"前一律现跑重取。

## 0. 前置取证（已在提案会话完成，结论落 proposal.md）

- [x] 0.1 冲突面归因：`git merge-tree --write-tree origin/main <pr-head>` 逐 PR 取冲突文件清单（实测 4/4 只撞 `CHANGELOG.md`，其中 1 个另撞 `learnings.md`，无第三类文件）
- [x] 0.2 确认无任何门禁要求「PR 必须改 CHANGELOG」（`Gate 2c3` 只判只可增长；`ci-pr-changeset.test.js` 只把该文件名当夹具用）⇒ 禁改门禁不与既有判据自相矛盾
- [x] 0.3 确认 `scripts/release-gate.mjs` 已要求 `## [v<版本>]` 小节存在 ⇒ 聚合器的天然接入点
- [x] 0.4 隔离 worktree 产物核对：`git worktree list` 命中 + `rev-parse --abbrev-ref HEAD` == `changelog-carrier-aggregate`，共享根 `main` 且 `status --porcelain` 0 行；起点已 `merge --ff-only` 到 `origin/main`（期间 main 前进了两次，未按 rc 决断）

## 1. records 携带两个可聚合小节（合同层，先写不改判据）

- [ ] 1.1 在 `openspec/records/` 的模板/说明里定义两个小节：`## CHANGELOG 条目`（必填）、`## learnings`（选填，存在即要求 `### lesson: <slug>` 形状）
- [ ] 1.2 定义**幂等键合同**：聚合产出条目标题 MUST 以 `（<record-slug>）` 结尾，`<record-slug>` 取 `openspec/records/<文件名>`，MUST NOT 取 `frontmatter.task`（那是一句中文长描述，会随改写漂移）
- [ ] 1.3 验收判据：拿 `origin/main` 现成的记录文件各跑一次解析，输出「识别到的小节名 + 取出块数 + 逐字节回写等于原文」自证；**必须包含一条负面**：正文里出现同名串（如引用规范原文提到 `## CHANGELOG 条目`）时不得被当成小节边界（禁令与存在性判据必须按语义位置切）

## 2. 聚合器 `scripts/aggregate-changelog.js`

- [ ] 2.1 实现：扫 `origin/main` 上已合并且带 `(#NNNN)` 尾注的提交所引入的 records（复用 `scripts/lib/merge-ledger.js`，MUST NOT 另写一份"哪些记录算已合并"的判断——那是第二份事实）
- [ ] 2.2 追加形态：新块插到文件顶部（沿用人类习惯），但写入者只有这一处；逐行保留各自行尾，禁止"探测多数派后统一回写"（本仓实测会造 26 行幽灵改动）
- [ ] 2.3 幂等：按 record 名判是否已落；同一 record 被搬运第二次 MUST 跳过且**出声**（`skip=…`），MUST NOT 静默
- [ ] 2.4 行为锁（`aggregate-changelog.test.js`，只 require node 内置模块）：
  - 真实 records 夹具走端到端（写→聚合→再聚合），断言第二趟产物字节等于第一趟
  - 反例：同一标题的两份不同 record MUST 各落一次（文本判据在此必错）
  - 反例：record 缺 `## CHANGELOG 条目` MUST 出声点名并跳过该条，MUST NOT 把整轮当成失败静默退出
  - 变异反证：把幂等键从 record 名退回标题文本 ⇒ 指名用例必须红（这条锁测的是"键的选型"，不是"函数存在"）
- [ ] 2.5 `--dry-run` 打印 `records=N 待搬=M 已落跳过=K 缺小节=X`，四个数全部可在一句话命令里重取

## 3. 禁改门禁 `scripts/check-no-hot-carrier-edit.js`（advisory 档）—— 已交付（分支 hot-carrier-edit-gate，2026-10-21）

> 每勾一项带**绑定点证据**（读数从哪个文件/用例来），不写"已实现"三个字。

- [x] 3.1 判据按 **PR 差量** `merge-base..head` 取文件集 ⇒ `diffNameStatus()` 是唯一入口；`T4` 用"他人把台账改进主干、我 rebase 上去"的夹具断言判 PASS，并在用例末尾断言工作树里确有他人那行（证明它站在"按现状必错"的形态上）；变异 MA（改读工作树现状）指名让 T4 变红
- [x] 3.2 命中即点名 + 给正解 ⇒ `printFindings()` 打 `HOT_CARRIER_EDIT <路径>` 与「写进 openspec/records/<分支名>.md 的『## CHANGELOG 条目』/『## learnings』小节」；`T1`/`T2` 断言点名与正解，变异 MG（摘掉正解文案）指名让 T1 变红；`T11` 钉住清单不外溢（改 `AGENTS.md` 必须判 PASS）
- [x] 3.3 授权出口 ⇒ 只认本次差量 `status=A` 的 `scripts/hot-carrier-write-authorization.json`，`applies_to_base` 须逐字等于实际 merge-base，`authorizedPaths` 须逐个覆盖命中项；用例 `T5`(放行)/`T5b`(路径未覆盖→拒)/`T6`+`T6b`+`T6c`(常驻证→拒)/`T7`(坐标不符→拒)，变异 MC/MD/MH 分别指名 T6c/T7/T5b
- [x] 3.4 落点与档位 ⇒ `Gate 2b9 - Hot-carrier edit gate (changes job, advisory)`（编 2b9：2b2–2b8 已占用，`Gate 2b5` 由 #3724 合入后用掉）；首行打印 `MODE=`，`T8` 断言两档点名逐字一致、只在是否阻断上分档；base 取 merge-base 并回落 base ref（更严方向）
- [x] 3.5 接线三处同改 ⇒ `.gitignore` 反选本体 + `MUST_LIVE_IN_UNGATED_JOB` 登记 + **同 PR 改 `check-unwired-tests.test.js` 那份 deepEqual 钉死的清单**（上一片 #4109 首笔提交漏这一步把 required 的 `QG Static` 跑红，教训见 `openspec/records/changelog-carrier-aggregate.md`）；本机按 CI 的 `Gate 2c` 完整 argv 复跑
- [x] 3.6 对本 PR 自己实跑 ⇒ 提交后 `node scripts/check-no-hot-carrier-edit.js --base=c5087351d --head=495cd3513 --mode=enforce` → `差量文件=10 命中热写面=0 判定=PASS` rc=0（加门禁这笔 PR 自己过这道门禁）。**提交前故意没勾**：未提交时差量为空，跑出来的绿不是证据

**动代码前的差异审计（补记）**：查到 `openspec/changes/hot-carrier-atomic-landing/`（规格已合入、实现未做），其 D4 明确把 `AGENTS.md`/`CHANGELOG.md`/`01-docs/learnings.md` 移出它的热点载体清单，理由"没量过"，且 tasks 1.2(d) 计划立锁防止后人"顺手补全"。判定为**不同机制、不同读数**（它量共享根未提交窗口，本判据量跨 worktree 的 PR 差量冲突），故不冲突；已在 `specs/changelog-ledger-integrity/spec.md` 新增一条 Requirement 禁止两份清单合并，并写明本处读数**不满足**它设定的重进前提。
## 4. 发版接入 + 规范改写 + 转 blocking（独立一片，需人工过目）

- [ ] 4.1 `scripts/release-gate.mjs` 在版本小节校验之前调用聚合器；把"聚合器报错"与"版本小节缺失"分成两个退出码文案（合并成一句会让人去改 CHANGELOG 而不是修聚合器）
- [ ] 4.2 `AGENTS.md` 改写：删除「PR 里往 CHANGELOG/learnings 顶部插块」的既有口径，新增 records 小节模板；更新「多会话共用写面」清单，把这两个文件标注为"仅聚合器可写"
- [ ] 4.3 转 blocking：**前置条件 = 当场重取的在飞 CONFLICTING/UNKNOWN PR 数为 0**，或已逐个确认其差量不含热写面；不满足则本片不开
- [ ] 4.4 QM-6：本片命中高危面（`scripts/check-`、`.github/workflows/`），MUST 取 `tier=external` + 可核 `evidence`；后端不可得时按四档归因（ENOENT / 额度重置 / IP 封禁 / 403 额度不足）如实登记欠账，MUST NOT 用 `closureNote` 或自扮演冒充高危面闭合
- [ ] 4.5 收尾链：`gh pr view --json mergeable` + `gh pr checks` 双绿后自动合并；合并后按 AGENTS 第 6 条回读该 merge SHA 的 main push run，读数写 PR 评论（不回写仓库文件）

## 不在范围（写明以免被"顺手"扩进来）

- 存量 1061 条 / 6.4 MB 历史与那批重复标题键的清理（需另立一片，且必须在本刀之后）
- `changelog.d/` 分片化历史
- 提前摘除 `check-branch-merged.js` 的共用写面登记（顺序错误 ⇒ 收尾判据退回整文件比较，是已实测的假阳性来源）
