---
record: branch-merged-different-optin
task: 把"落地版本不同"从解释性读数变成**可由人当面授权的一次放行**（--allow-different-landing），默认档一字不动
date: 2026-10-20
---

## 本次执行记录：显式放行旗标（branch-merged-different-optin，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（`scripts/` 门禁脚本自身 + 文档）：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` = **false**（含 `scripts/check-branch-merged.js` 与其测试）⇒ 走完整质量节拍，提交后再取一次作数。worktree `mp-branch-merged-different-optin` + 裸分支同名，由 `start-mp-task.ps1` 创建；判成败按产物（`git worktree list` 命中 1 行、`rev-parse --abbrev-ref HEAD` = 分支名、`rev-parse HEAD` = `f6a61d24c`），不按入口 rc |
| 第一性原因（QM-5 ①） | ✅ | 引入点 = 上一篇记录（#3984）在 PRD §10 遗留里写下的那句「`different` 是否应把该文件从 LOST 降级为一个新的可删档位——未做，需人工裁决」。它把"降级"预设为**放宽默认档**这一种形态。2026-10-20 拿到人工授权后先量现场，量出该预设不成立：三条 rc=1 分支的 LOST 行 100% 是 `different`，可同一类别里同时装着「主干那份是外审更正版」（#2729 `rpa-selector-utils.js`）与「我这版独有 228 行、而那 228 行的关键句在主干**同一文件** `:194` 原样存在、缺口只是热写面重复键份数」（#2729 `rpa-view-navigation-helpers.js`）⇒ 类别不是许可 |
| 逃逸分析（QM-5 ②） | ✅ | 逃过了：① `check-branch-merged.test.js` 的 T28–T33 只锁"读数说什么"，**没有任何一条锁"读数能不能被当成许可"**，所以"把 different 降为可删"这个念头从未被测试面反驳过；② §10 的现场读数只给了两格计数（`落地版本不同=13 没带上=1`），没给**逐行类别 × LOST 的交叉表**，于是"LOST 行全是 different"这句要到本次逐条 grep 才第一次被看见；③ 真实仓 A/B 用的是"新鲜合并的 5 例"，不含这种"落地后被重构搬走"的形态。**为什么看得见却没拦住**：上一片刻意把宽严留在原处（正确），但把"要不要放宽"写成一个二选一问题（错误）——选项本身就漏了第三条（显式 opt-in）。**第二层逃逸（本片自己的）**：旗标第一版的谓词只比"产物 == tip / == base"两个等式，于是"合并带的是 tip 的**严格子集**"也落进 `different` 被放行 —— 四条新锁（T35–T39）没有一个构造过 `onlyInMerge=0` 这一格，是本片自己的夹具缺口，由 QM-6 前端轴命中 |
| 系统性漏洞（QM-5 ③） | ✅ | 具体落点：`scripts/check-branch-merged.js` 的 `revisionsAtMerge` 产出的三分是**文件级**读数，而 rc 由 `counts.LOST` **行级**决定，两者之间没有任何一处代码表达"这一格能不能变成许可"——缺的是 `releaseEligibleForLanding` 这个谓词本身（本片新增），不是它的阈值。分类：机制缺失（判据没有"授权面"这一层），而非断言不精确。第二落点同型：`classifyRevision` 的三分类**不携带规模语义**，把"部分根本没带上"与"整版不同"归成同一格 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `--allow-different-landing`（**不接受取值**，`=false` 直接 `JudgeError`、rc=2）+ 谓词 `releaseEligibleForLanding(rev)`：要求 **`different` 中存在 `onlyInMerge > 0` 的条目** ∧ `notCarried.length === 0` ∧ `!rev.carried`；规模取不到（`undefined`）按未证实不放行。放行行改为**独立一档** `DIFFERENT-RELEASED`（不回 `IDENTICAL`，那会抹掉"没落地"）并保留双向规模；末行追加 ` 放行=N`、另打一行 `[BRANCH-MERGED][OPT-IN]` 告示；`releasedDifferent` 仅旗标档出现，`optIn` 亦收进旗标分支（默认档 `--json` 与 #3984 逐字同形）。**默认档 verdict/rc/文案一字未改**。回归锁 7 条：T34 默认档不得渗改（实现前即绿，职责是钉"跳过"）、T35 旗标生效 + 三处出口 + 告示点名 + `counts[本档] === releasedDifferent` 恒等、**T36 反洗白**（`not-carried` 带旗标仍 LOST/rc=1）、T37 谓词表逐格（含 `carried`、空读数、**`onlyInMerge=0` 严格子集**、规模缺失四格）、T38 混合两笔 merge 时危险格优先、T39 旗标只管 LOST 不得碰 `UNATTRIBUTED`、**T40 严格子集即便带旗标仍 LOST/rc=1（前端轴 Major 的回归锁）** |
| 防止再次发生（QM-5 ⑤） | ✅ | ① PRD 新增 §11（放宽 default 被现场否证的三条实测，含 `:194` 反向证据）与 §12（旗标第一版被 Major 打穿、修法、收紧后 A/B、采纳/不采纳各附理由）；② 谓词的三条理由写成 `releaseEligibleForLanding` 的函数头注释；③ 变异驱动 10 条入库登记在本文，红集互不相同、可机器重跑；④ 遗留如实写：旗标仍不判断内容在不在（跨文件"这些行在主干任何地方都存在"的判据是另一片）；⑤ **AGENTS.md「删分支前先跑判据」那条同次改写**：原文只说「退出码 0 才允许继续清理」，而本片新增了**第二条通往 0 的路** —— 不写清"旗标须逐分支人工授权 + 逐行读双向规模"，下一个会话就能在无人授权的情况下把闸门放宽，这与本条要防的「判据非空仍照删」同型；⑥ 消除第二份档位枚举：T25 的 plain↔json 交叉锁原先硬列档位名，改为从 `mod.VERDICTS` 派生（按长度降序拼接避免前缀吞后），否则新增档位会落在"两出口计数必须一致"这把锁之外 |
| 行尾与 diff 对账 | ✅ | PRD 三份来源分开量（`git ls-files --eol` = `i/lf w/crlf attr/text=auto`）：`HEAD blob cr=0 lf=284` / 工作副本 `cr=284 lf=284` ⇒ 追加一律按 CRLF 写。§11 追加后 `cr=lf=352`，§12 追加后 `cr=lf=404`，`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **必须量 `HEAD~1..HEAD`**（量 `origin/main..HEAD` 会把并发会话刚落地的文件读成我的删除 —— 实测 696 vs 334）。AGENTS.md 两口径均 `1/1` |
| 接线棘轮 | ✅ | 未新增测试**文件**（用例并进已接线的 `scripts/check-branch-merged.test.js`，`quality-gate.yml:414` 已点名）⇒ `check-unwired-tests.js` 域不变；提交后复跑作数 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面；改动是根级门禁脚本与文档 |
| QM-6 CCG 双模型外部评审 | ⚠️ 单轴 | 见下节：前端轴（规定 `claude`）**出货并命中一条 Major**（已修 + 加 T40/N10）；后端轴（规定 `codex`）三投零产物 = **未跑成**。双模型未成立，如实登记，不拿自审替代 |
| 远程同步 | 由门禁推导 | 本 PR 不手写状态词、不为收口另开 PR（`gate-record-sync-derived-status` / #3879）；合并发生即由 `scripts/lib/merge-ledger.js` 推导收口 |

## 自测块（当场读数，不预写）

- `node --test scripts/check-branch-merged.test.js` ⇒ **49 tests / 49 pass / 0 fail**（`SUITE_RC=0`）。
  先红后绿：旗标实现前红 **5 条**（T35–T39，红因是未知旗标被 `parseArgv` 大声拒绝走 **rc=2**，不是"用例没跑到"）；
  Major 修复轮红在**修改前的实现字节**上复现 —— 把当前测试拷到 `judge-optin-copy.js`（旧字节）同目录跑 ⇒ `导出面锁 / T35 / T37 / T40` 红（`T9` 那条红是临时目录非 git 仓的环境性红，不认领），
  即 **T40 测的确实是那一格**，不是"改完就绿"。
- 变异反证 **10 条**（N1–N10），逐条实跑、红集互不相同、收尾 `RESTORE BYTE-IDENTICAL`
  （驱动 `mut-optin.cjs`，仓库外；单行锚点 + `node --check` + `PROBE_BLIND` 档 + `process.on('exit')` 还原兜底）：
  N1 放行不再限于 LOST ⇒ T39｜N2 谓词只看 different 是否存在 ⇒ T37,T38,T40｜**N10 谓词退回"只看类别不看双向规模" ⇒ T37,T40**｜
  N9 谓词恒真 ⇒ T36,T37,T38,T40｜N3 carried 也放行 ⇒ T37,T40｜N4 默认档也放行 ⇒ T4,T28,T31,T34｜
  N5 汇总不报送行数字 ⇒ T35｜N6 摘掉 OPT-IN 告示 ⇒ T35｜N7 放行行改写 IDENTICAL ⇒ T35｜N8 空读数也放行 ⇒ T37。
  第 3 轮曾报 `N4 WRONG_TEST 未红: T12` —— 核对 T12 夹具（base=`L1`、tip=`A1,ONLY_ON_BRANCH,L1`、merge=`A1,L1`）⇒ `onlyInMerge=0`，
  收紧后**连默认档泄漏都洗不动这条先于本片存在的锁**；据此订正期望并把机制写进驱动注释，**未改任何断言**。
- 真实仓 A/B（用**与提交字节 md5 相同**的实现副本跑，root=共享根）：

  | 分支 / 属主 PR | 默认档 | 旗标档（Major 修复后） |
  |---|---|---|
  | `fix-rewrite-paragraph-preserve` #2842 | `lost=1 … 落地版本不同=1 没带上=1` rc=**1** | `lost=1 … 放行=0` rc=**1**（那行 CHANGELOG 是纯子集丢弃，正确挡住） |
  | `fix-tab-title-url-placeholder` #2847 | `lost=1 … 落地版本不同=2 没带上=0` rc=**1** | `lost=0 … 放行=1` rc=**0** |
  | `fix-toutiao-submit-chain` #2729 | `lost=4 … 落地版本不同=5 没带上=0` rc=**1** | `lost=0 … 放行=4` rc=**0** |

  三条默认档读数与 #3984 上线后逐字相同（放宽从未渗进默认档）；收紧后旗标只解锁 2 条，**少解锁的那条本来就不该解**。
- CLI 边界（同副本）：`--allow-different-landing=false` ⇒ `参数不合法：… 不接受取值`，**rc=2**；
  拼错的 `--allow-diffrent` ⇒ `未知旗标` 且可用清单带上新旗标，**rc=2**。两者都不是静默忽略。
- Gate 12c：`check-doc-abs-paths --all` ⇒ `counts=1161 domain=4658 files=561 canJudge=true PASS`；品牌残留 ⇒ PASS（11007 个 tracked 文件）；
  接线棘轮 ⇒ `检查域内测试文件 111 个 / OK`；`openspec-sync-check` ⇒ `OK: 387 tasks, 73 active changes, 242 archives`（rc 用 `PIPESTATUS` 取，不被管道吃掉）；
  `check-record-qm5-rows` ⇒ `必需步骤 ①②④⑤ / 检查域内记录=286 / 全仓未登记缺行=0 / OK`。

## QM-6（如实登记，逐次通道读数）

| 轴 | 通道（真源：`~/.claude/.ccg/config.toml` 的 `[routing.*].primary`） | 现场读数 | 结论 |
|---|---|---|---|
| 后端 | `codex` 一投 | 任务书含 `'1,200p'` / `<<'EOF'` 等示例；stdout 2622 B，stderr 4× `failed to parse function arguments: missing field 'cmd'`、`codex exited with status 1`、wrapper 自删日志、**无产物** | 零结论 |
| 后端 | 二投（改"用 shell 读、heredoc 写产物"） | 日志 523 B：`Using stdin mode for task due to: single-quote` + `codex exited with status 1`、**无产物** ⇒ 新死法第 24 条：**位置参数里的单引号会把 wrapper 推进 stdin 模式后静默 exit 1** | 零结论 |
| 后端 | 三投（一行、零引号） | 日志 1736 B：再次 `missing field 'cmd'`、`codex exited with status 1`、**无产物** | 三投全败 ⇒ 按政策跳过并登记「未跑成」 |
| 前端 | `claude` | stdout 2773 B **且产物 8856 B**（含每条实跑命令与文件:行号），`VERDICT: NEEDS_REVISION`；产物全文已贴到 PR 评论 <https://github.com/Colinchiu007/mulpub/pull/4073#issuecomment-6286520722>（**不指向 worktree 内的临时文件** —— 该文件随 worktree 清理消失，指向它等于把证据锚在会话私产上） | **出货**：1 Major + 5 Minor + 3 PASS 面 |

跨家族独立性因此仍打折：双模型只有一轴出货。但那一轴命中的是一条**会让旗标洗掉"部分根本没带上"**的 Major，且我本地独立复现成立 —— 这一条的价值不来自模型，来自可复现的反例。

## 逐条处置

| 编号 | 评审主张（摘要） | 我的复量 | 处置 |
|---|---|---|---|
| 前端 Major | `different` 只判"产物 ≠ tip 且 ≠ base"，于是"合并带的是 tip 的**严格子集**"（丢了我后加的行、又没退回 base）也归进这一格 ⇒ 旗标宣称"not-carried 一律不放行"在这格上是假的 | **本地复现成立**（`probe-subset.cjs`，临时仓）：`DEFAULT verdict=LOST rev={"different":[{"onlyInMerge":0,"onlyInTip":1}],"notCarried":[]}` ⇒ `FLAG verdict=DIFFERENT-* releasedDifferent=1` | **采纳**。谓词加正向要求：`different` 必须存在 `onlyInMerge > 0` 的条目（"主干另有独有内容"）才承认"落的是另一版"；`undefined` 规模按未证实。新增回归锁 **T40**（严格子集带旗标仍 LOST/rc=1，并在断言里先证明夹具的 `notCarried` 为空 —— 否则这条锁没测到 Major 说的那格）与变异 **N10**。后果如实写进 §12 与本文表格：#2842 由 rc=0 退回 rc=1 |
| 前端 Minor（文档与代码不同源） | 文档写"`--json` 只在旗标档带 `releasedDifferent` 与 `optIn`"，但 `res.optIn` 是无条件赋值 | 代码 `res.optIn = { … }` 确在 `if` 之前（第 614 行）；T34 只断言 `releasedDifferent` 缺位，所以这处不一致没有锁 | **采纳**，取"把赋值移进旗标分支"而非"改文档描述不一致"：默认档 `--json` 因此与 #3984 **逐字同形**，这正是本 PR 的核心承诺 |
| 前端 Minor（第二份事实） | T25 的 plain↔json 交叉锁硬列档位名，新档位落在锁外；`counts[本档]` 与 `releasedDifferent` 两处表达无断言钉相等 | 属实（test.js:764 正则可逐字看到；T35 无 counts 断言） | **采纳**：T25 的正则改为从 `mod.VERDICTS` 派生（长度降序拼接，避免前缀吞后）；T35 补 `counts['DIFFERENT-RELEASED'] === 1` 恒等断言 |
| 前端 Minor（命名完成式） | 档位名 `DIFFERENT-LANDING` 可被读成"以不同版本落了地"，与本 PR 反复强调的"不承诺内容已落地"有张力 | 与 B1 那条教训同族（上一轮就是"修订@"宣称因果被打回改中性名） | **采纳**：改 `DIFFERENT-RELEASED`，只描述闸门自己的动作。改名覆盖面逐处核对：`VERDICTS`、改档处、测试 5 处、告示文案 |
| 前端 Minor（schema 稳定性） | 建议 `releasedDifferent` 改成默认档恒存在=0，避免下游读到 `undefined` | 全仓 grep 判据消费者只有 `quality-gate.yml`（跑测试）与文档，**无机器解析 `--json`** | **不采纳**，记为已知取舍：那会让默认档 `--json` 多出字段，与"默认档一字未动"的承诺冲突；"未渗改"的证据用"旗标自己的字段缺位"比"值为 0"更难被未来会话读错 |
| 前端 Minor（回滚自洽） | 改动集可自洽回滚，无无人读的字段 | 逐字段核过导出面与打印面 | 无动作 |
| 后端轴 | 三投零结论 | — | 无条目可处置；本 PR 的外部支撑因此只有"单轴前端 1 Major + 5 Minor"，如实记在此 |
