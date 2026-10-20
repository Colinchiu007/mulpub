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
| 逃逸分析（QM-5 ②） | ✅ | 逃过了：① `check-branch-merged.test.js` 的 T28–T33 只锁"读数说什么"，**没有任何一条锁"读数能不能被当成许可"**，所以"把 different 降为可删"这个念头从未被测试面反驳过；② §10 的现场读数只给了两格计数（`落地版本不同=13 没带上=1`），没给**逐行类别 × LOST 的交叉表**，于是"LOST 行全是 different"这句要到本次逐条 grep 才第一次被看见；③ 真实仓 A/B 用的是"新鲜合并的 5 例"，不含这种"落地后被重构搬走"的形态。**为什么看得见却没拦住**：上一片刻意把宽严留在原处（正确），但把"要不要放宽"写成一个二选一问题（错误）——选项本身就漏了第三条（显式 opt-in） |
| 系统性漏洞（QM-5 ③） | ✅ | 具体落点：`scripts/check-branch-merged.js` 的 `revisionsAtMerge` 产出的三分是**文件级**读数，而 rc 由 `counts.LOST` **行级**决定，两者之间没有任何一处代码表达"这一格能不能变成许可"——缺的是 `releaseEligibleForLanding` 这个谓词本身（本片新增），不是它的阈值。分类：机制缺失（判据没有"授权面"这一层），而非断言不精确 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `--allow-different-landing`（**不接受取值**，`=false` 直接 `JudgeError`）+ 谓词 `releaseEligibleForLanding(rev)`（`different>0 ∧ notCarried==0 ∧ !carried`，`rev` 缺失按不合格）；放行行改为**独立一档** `DIFFERENT-LANDING`（不回 `IDENTICAL`，那会抹掉"没落地"）并保留双向规模；末行追加 ` 放行=N`、另打一行 `[BRANCH-MERGED][OPT-IN]` 告示；`--json` 仅旗标档带 `releasedDifferent` / `optIn.allowDifferentLanding`。**默认档 verdict/rc/文案一字未改**。回归锁 6 条：T34 默认档不得渗改（实现前即绿，作用是钉"跳过")、T35 旗标生效 + 三处出口 + 告示点名、**T36 反洗白**（`not-carried` 带旗标仍 LOST/rc=1）、T37 谓词表逐格（含 `carried` 与空读数两格）、T38 混合两笔 merge 时危险格优先、T39 旗标只管 LOST、不得碰 `UNATTRIBUTED` |
| 防止再次发生（QM-5 ⑤） | ✅ | ① PRD 新增 §11，把"放宽 default 被现场否证"的三条实测（含 `:194` 那条反向证据）与"类别是线索不是许可"入库；② 谓词的三条理由写成 `releaseEligibleForLanding` 的函数头注释（下一个想调它的人不必重新发现）；③ 8 条变异驱动入库登记在本文，红集互不相同、可机器重跑；④ 遗留如实写：旗标仍不判断内容在不在（跨文件"这些行在主干任何地方都存在"的判据是另一片） |
| 行尾与 diff 对账 | ✅ | PRD 三份来源分开量：`HEAD blob cr=0 lf=284` / 工作副本 `cr=284 lf=284`（`git ls-files --eol` = `i/lf w/crlf attr/text=auto`）⇒ 追加按 CRLF 写；追加后 `cr=lf=352` 自洽（285→353 行，未出现行尾混存） |
| 接线棘轮 | ✅ | 未新增测试**文件**（用例并进已接线的 `scripts/check-branch-merged.test.js`，`quality-gate.yml:414` 已点名）⇒ `check-unwired-tests.js` 域不变；提交后复跑作数 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面；改动是根级门禁脚本与文档 |
| QM-6 CCG 双模型外部评审 | PENDING | 见下节（逐次通道读数登记；未跑成一律如实写"未跑成"，不拿自审替代） |
| 远程同步 | 由门禁推导 | 本 PR 不手写状态词、不为收口另开 PR（`gate-record-sync-derived-status` / #3879）；合并发生即由 `scripts/lib/merge-ledger.js` 推导收口 |

## 自测块（当场读数，不预写）

- `node --test scripts/check-branch-merged.test.js` ⇒ **48 tests / 48 pass / 0 fail**（`SUITE_RC=0`）。
  先红后绿：实现前红 **5 条**（T35/T36/T37/T38/T39），红因是 `--allow-different-landing` 属未知旗标、
  `parseArgv` 大声拒绝并走 **rc=2**，而不是"用例没被执行"；**T34 在实现前就是绿的** —— 它的职责是"默认档不得被渗改"，
  不是"实现前该红"。
- 变异反证 **9 条**（N1–N9），逐条实跑、红集互不相同、**9/9 CAUGHT**，收尾 `RESTORE BYTE-IDENTICAL`
  （驱动 `mut-optin.cjs`，仓库外；单行锚点 + `node --check` + `PROBE_BLIND` 档 + `process.on('exit')` 还原兜底）：
  N1 放行不再限于 LOST ⇒ T39｜N2 谓词不看 notCarried ⇒ T37,T38｜**N9 谓词恒真 ⇒ T36,T37,T38**｜
  N3 carried 也放行 ⇒ T37｜N4 默认档也放行 ⇒ T4,T12,T28,T31,T34｜N5 汇总不报送出数 ⇒ T35｜
  N6 摘掉 OPT-IN 告示 ⇒ T35｜N7 放行行改写 IDENTICAL ⇒ T35｜N8 空读数也放行 ⇒ T37。
- **两处我自己的错由电池当场暴露，如实记**：
  ① 首版 N6 的 `from` 多打了一个尾随 `+ '` ⇒ `ANCHOR_0`，那条变异**一次都没生效**却差点被读成"没红"；锚点存在性按 `IDX=34129` 复核后修正。
  ② 首版把 T36 写进 N2 的期望，实测 **T36 不红**，机制是 T36 的夹具 `different=0`，任何"只看 different>0"的实现都自然不放行它
  ⇒ **T36 的保护面比我写的说明窄**，它守的是"单凭 not-carried 就放行"这一格（改由 N9 打红），"混合两笔"那格实际由 T38 守。
  处置：订正 N2 期望为 T37/T38 + 新增 N9；**锁的断言一字未动**（改的是期望清单，不是判据）。
  ③ 电池第一轮被我中途叫停时，源文件停在 N2 的变异态（`md5` 与备份不等）⇒ 从备份还原并 `node --check` 复验；
  驱动据此补了 `exit` 兜底还原。这条是本驱动的**设计缺口**（原先只逐条还原、无退出兜底），不是运气。
- 真实仓 A/B（用**与提交字节 md5 相同**的实现副本跑，root=共享根，against=`origin/main@f6a61d24c`）：

  | 分支 / 属主 PR | 默认档 | 旗标档 |
  |---|---|---|
  | `fix-rewrite-paragraph-preserve` #2842 | `lost=1 … 落地版本不同=1 没带上=1` rc=**1** | `lost=0 … 没带上=1 放行=1` rc=**0**（OPT-IN 告示 1 行） |
  | `fix-tab-title-url-placeholder` #2847 | `lost=1 … 落地版本不同=2 没带上=0` rc=**1** | `lost=0 … 放行=1` rc=**0** |
  | `fix-toutiao-submit-chain` #2729 | `lost=4 … 落地版本不同=5 没带上=0` rc=**1** | `lost=0 … 放行=4` rc=**0** |

  默认档三行的 `lost=` 与 rc 与 #3984 上线后**逐字相同**（放宽没有渗进默认档）；
  且 #2842 的 `没带上=1` 在旗标档**照样打印** —— 危险格没有被顺带洗掉。
- CLI 边界（同副本）：`--allow-different-landing=false` ⇒ `参数不合法：… 不接受取值`，**rc=2**；
  拼错的 `--allow-diffrent` ⇒ `未知旗标` 且可用清单里带上新旗标，**rc=2**。两者都不是静默忽略。
- Gate 12c：`node scripts/check-doc-abs-paths.js --all` ⇒ `counts=1161 domain=4658 files=561 canJudge=true PASS`。
- 品牌残留：`node scripts/check-no-brand-residue.js` ⇒ PASS（扫描 11006 个 tracked 文件）。
- 接线棘轮：`node scripts/check-unwired-tests.js` ⇒ `检查域内测试文件 111 个 / OK`（未新增测试文件，用例并进已接线的那份）。
- 行尾：PRD 按 CRLF 追加，追加后 `cr=lf=352` 自洽（285→353 行，未产生混行尾）。

## QM-6（如实登记，逐次通道读数）

PENDING

## 逐条处置

PENDING
