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
| 行尾与 diff 对账 | ✅ | 判据与测试文件逐行 CRLF、账本按其当场档位写；插行一律 splice + join，写盘前断言 CR 增量==插入行数==LF 增量；两口径 numstat 于 commit 后取并写进 PR 正文 |
| 接线棘轮 | ✅ | 未新增测试文件；用例并入已接线的 `check-gate-record-debt.test.js`（`quality-gate.yml` Gate 2c 已点名 `node --test`） |
| 变异反证 | ✅ | 驱动 `mutate-final-1019.cjs`：**M1–M11 全部 CAUGHT**（逐条指名到用例）+ **C1 合规正控绿**（行尾注释点名文件名不得假红）。先自证基线 115/115 绿再跑（基线不绿即停手，不在既有红上解释变异）；跑后判据/测试/账本三文件 md5 与跑前逐一相等。两组红集重合已归因而非掩盖：M4/M9 同用例不同**断言支路**（`--test-name-pattern` 单跑取 message 分辨），M10/M11 攻同一条不变式（"缺注入必须抛"） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | **PARTIAL（单轴，codex）** | 配置的两轴本轮均未交付，如实记：**critic=claude** 两字探针 90s → `spawnSync ETIMEDOUT`、stdout/stderr 各 0 字节（此前同轴另有 75s/0B、直跑 150s→rc=124/0B 两次同形，额度用满）；**proposer=opencode** 两字探针 120s → rc=124，仅回显 `> build · mimo-v2.6-flash-free` 无答案。第三轴 **codex 交付 5 条**（3 WARNING + 2 INFO，`shape-review-codex2.txt` 287,705 字节）；首派因 `codex exec --cwd` 报 `unexpected argument`（212 字节、没到模型）——属调用形态错误，不计模型重试额度。逐条处置见 design.md D6：W1/W3/I4/I5 采纳落地，W2 **拒绝其修法**（把读数 23 钉成下界会拦掉合法销账，是本仓记案的"常量红"）**采纳其内核**（防清空改由 M7/M8 两条行为反证守）。⇒ 本行不得读作"双模型通过"，缺的是第二双眼睛而不是第一双 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导；`HAND-CLOSURE … 触碰记录=<n>` 与 `MERGE-LEDGER … byDesign=<n>` 两行给现场读数 |

### 遗留（不假装已闭合）
- **QM-6 的第二轴仍缺**：claude / opencode 本轮按"能不能从产物里切出 findings"判为未交付（读数见上表）。这是**运行态**事实，不是"该轴永久不可得"的定律——下一次要引用本行前先重跑两字探针，别把今天的 0 字节当明天的结论。
- **W3 的尾巴按残余记录、不扩域**：真账本用例里读原始文件仍用字面文件名（唯一性锁只扫判据源、不扫测试文件）。现状是"改名后该用例必大声红"（旧路径 ENOENT 或键数不等），所以没有静默读旧文件的通道；把锁扩成"扫测试文件的字面串"换来的是又一条排版锁，收益不抵成本。
- 本刀**不销任何一笔账**：23 条欠账原样保留，销账仍须该记录作者取证 merge SHA 并与删除登记项同次发生（实测其中 22 条原因里连 PR 号线索都没有，1 条登记的是孤儿行，都不属于"顺手能销"）。
- `status` 字段被删后，账本不再携带任何状态信息——这是有意的：状态由判据从载体现场测，避免第二真源。若将来要做"欠账趋势统计"，应新增从载体派生的读数，而不是把字段加回来。
- 旧载体 9 处同形态矛盾、23 条欠账、闭合→闭合不拦这三笔，仍是上一刀记录在案的已知口子，本刀不消。
