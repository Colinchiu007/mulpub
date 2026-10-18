---
record: debt-ledger-shape-normalize
task: 欠账账本拒收会腐化的第二份事实（line/status），登记项只留原因字符串
date: 2026-10-19
---

## 本次执行记录：账本登记项形状收敛（debt-ledger-shape-normalize，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（含 `scripts/` 判据 + 数据文件）：worktree `mp-debt-ledger-shape-normalize`、裸分支 `debt-ledger-shape-normalize`，`verify-worktree-deps` OK；commit 后取 `classify-docs-only` |
| 第一性原因（QM-5 ①） | ✅ | 9 条对象形态登记项带 `line`/`status`；当场逐条核对载体：`line` **9/9 指不到自己的 `远程同步` 行**（3 越界/空、6 指到别的 QM 行），`status` **1/9 已与现状不符**（登记 PENDING、载体"执行中"）。根因是载体为置顶追加型，行号必然随每笔合并过期 |
| 逃逸分析（QM-5 ②） | ✅ | 既有判据只把账本当"原因登记表"用（`loadLedger` 只取 reason），从未看这两个字段是否还成立；全仓亦无 `entry.status`/`entry.line` 读取 ⇒ 腐化对任何门禁都不可见，只对**读文件的人**可见（下一个会话会把它当坐标） |
| 修复 + 回归保护（QM-5 ④） | ✅ | `loadLedger` 非字符串值当场抛错并点名键（空原因旧判据保留）；9 条对象解包为 `reason`，迁移对账：键数 23→23、键序逐字相等、原因文本逐字相等、判据读数不变（「已登记欠账 23 条」rc=0）。外部评审后又加固四处：`collect()` 的账本改为**必须注入**（缺注入按判据自身故障抛错，`{}` 仍是合法值）、真账本喂真 `loadLedger` 的永久用例、"或"正则拆成逐条精确断言、文件名唯一性锁改**逐处定位**。回归锁 `check-gate-record-debt.test.js` **115 例全绿**（本刀净增 7 条） |
| 防止再次发生（QM-5 ⑤） | ✅ | 规格 `quality-gate-execution-record` 新增 ADDED Requirement（含 5 个 Scenario：拒收并点名键、行号必被证伪为过期、空原因仍抛、迁移不改语义、空账本不得读成合规）；AGENTS 销账登记口径补"值只写原因字符串"；结构锁钉账本文件名在判据里只出现一处 |
| 行尾与 diff 对账 | ✅ | 判据/测试/AGENTS/CHANGELOG/learnings 逐行 CRLF、账本按当场档位写；插行一律 splice + join。**但要如实记下这次没兜住的那一格**：迁移脚本把账本的**末行换行**写丢了，而我原先断言的「CR 增量 == 插入行数 == LF 增量」抓不到它（三项计数在"少一个结尾换行"时照样自洽）——真正抓到它的是 AGENTS 那条**两口径 numstat 对账**：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 对同一文件报 10/46 与 9/45，差 1 行就是 ` No newline at end of file` 的形状。正解按当场档位补回 `
` 后两口径归一（9/45 == 9/45）。教训：**守恒式只覆盖它数的东西，末字节是不是换行不在计数里** |
| 接线棘轮 | ✅ | 未新增测试文件；用例并入已接线的 `check-gate-record-debt.test.js`（`quality-gate.yml` Gate 2c 已点名 `node --test`） |
| 变异反证 | ✅ | 驱动 `mutate-final-1019.cjs`：**M1–M11 全部 CAUGHT**（逐条指名到用例）+ **C1 合规正控绿**（行尾注释点名文件名不得假红）。先自证基线 115/115 绿再跑（基线不绿即停手，不在既有红上解释变异）；跑后判据/测试/账本三文件 md5 与跑前逐一相等。两组红集重合已归因而非掩盖：M4/M9 同用例不同**断言支路**（`--test-name-pattern` 单跑取 message 分辨），M10/M11 攻同一条不变式（"缺注入必须抛"） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | **PARTIAL（单轴 codex），缺轴经人工裁决放行** | 配置两轴本轮均未交付（claude 探针 90s→ETIMEDOUT/0 字节；opencode 探针 120s→rc=124 无载荷），第三轴 codex 交付 5 条并逐条处置（W1/W3/I4/I5 落地、W2 拒绝修法采纳内核）。探针读数、豁免边界与「为什么这不是 CI 红而是自动合并判据第 4 条」全部写在下面 **《QM-6 单轴放行的边界》** 一节；本行不得读作「双模型通过」 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导；`HAND-CLOSURE … 触碰记录=<n>` 与 `MERGE-LEDGER … byDesign=<n>` 两行给现场读数 |

### QM-6 单轴放行的边界（人工裁决 2026-10-19）

- **两轴的当场读数**：`critic=claude` 两字探针 90s → `spawnSync ETIMEDOUT`，stdout/stderr 各 **0 字节**（此前同轴另有 75s/0B、直跑 150s→rc=124/0B 两次同形，AGENTS 的重试额度已用满）；`proposer=opencode` 两字探针 120s → **rc=124**，正文只有 `> build · mimo-v2.6-flash-free`。后端名取自 `origin/main:scripts/ccg-review-backends.list`（第一行 critic、第二行 proposer），不是本文写死的。
- **一次调用形态错误不占额度**：首派 codex 用 `codex exec --cwd <dir>` ⇒ 212 字节 `error: unexpected argument '--cwd' found`，进程根本没到模型；改 `-C` 后正常交付。"跑完没交付"与"根本没跑"必须分档记。
- **codex 交付 5 条的处置**（3 WARNING + 2 INFO，产物 `shape-review-codex2.txt` 287,705 字节）：W1/W3/I4/I5 采纳落地；**W2 拒绝其修法、采纳其内核**——把当前读数 23 钉成数量下界会拦住以后的合法销账（本仓记案的「常量红」），防清空改由 M7/M8 两条行为反证守。逐条写进 `design.md` D6。
- **`mode=dual` 是怎么被触发的**：不是代码规模（`changedLines=193` ≤ 阈值 200），而是 `sensitiveContentHits=1`——取样就是我自己在 proposal 里写的那句「用户授权…」。与本仓已记案的「CHANGELOG 里出现 crypto 字样即打高危标签」同族：**散文可以触发高危域标签**。
- **放行的三条边界**（少写一条，这次豁免就会被读成第二个 `self_play_resolved`）：① `.ccg/reviews/439c132a….json` 的 `deepReview.status=pending` **一字未改**，改它就是在仓侧自造闭环标记；② `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` 的读数「CCG 深度审查欠账 1 条」**原样保留**；③ **CI 的 `changes` job 并不执行这条 enforce**（它跑 2c2 presence、2c3 QM-5 row ratchet，实测 `QG Changes` 各步骤全 success），所以 enforce 判红不是 required check 红，而是 AGENTS「PR 自动合并」判据第 4 条不满足——正因为它不是机械闸门能定的事，才必须交人裁决，反过来也意味着**机械全绿不构成"QM-6 已满足"的证据**。

### 遗留（不假装已闭合）
- **QM-6 缺轴欠账（本次放行换来的账，不是已闭合）**：本 PR 只有 codex 一轴真跑过。清偿入口两条、互相独立——(a) 后端恢复后（`claude` 额度是**日重置**，须过了重置点再试一次才有资格宣布"该轴不可得"）补跑 critic 轴并把 findings 逐条处置，读数写进 **PR 评论**而不是新开回填 PR；(b) 根治「散文里的敏感字样触发 dual」要改 `scripts/ccg-review-decider.js` 的判定形态，属改谁来守门，**必须人工过目、不走 agent 自动合并**。只做 (b) 不做 (a)，等于给一个假阳找借口；两条都不做，这一行就是活欠账。
- **QM-6 的第二轴仍缺**：claude / opencode 本轮按"能不能从产物里切出 findings"判为未交付（读数见上表）。这是**运行态**事实，不是"该轴永久不可得"的定律——下一次要引用本行前先重跑两字探针，别把今天的 0 字节当明天的结论。
- **W3 的尾巴按残余记录、不扩域**：真账本用例里读原始文件仍用字面文件名（唯一性锁只扫判据源、不扫测试文件）。现状是"改名后该用例必大声红"（旧路径 ENOENT 或键数不等），所以没有静默读旧文件的通道；把锁扩成"扫测试文件的字面串"换来的是又一条排版锁，收益不抵成本。
- 本刀**不销任何一笔账**：23 条欠账原样保留，销账仍须该记录作者取证 merge SHA 并与删除登记项同次发生（实测其中 22 条原因里连 PR 号线索都没有，1 条登记的是孤儿行，都不属于"顺手能销"）。
- `status` 字段被删后，账本不再携带任何状态信息——这是有意的：状态由判据从载体现场测，避免第二真源。若将来要做"欠账趋势统计"，应新增从载体派生的读数，而不是把字段加回来。
- 旧载体 9 处同形态矛盾、23 条欠账、闭合→闭合不拦这三笔，仍是上一刀记录在案的已知口子，本刀不消。
