# 把旧载体冻结成只读存档，取消「每个 PR 都要挤公共文件」

## Why

质量节拍要求每次 PR 收尾把执行记录写三处：`openspec/records/<分支>.md`（每 PR 一篇）、`.quality-gates.md`（顶部插块）、`scripts/gate-record-debt-ledger.json`（加登记键）。后两者是**所有会话共用的追加型写面**，而共享主工作区只有一份工作树、一份 index、一份 HEAD——于是每次收尾都要在别人的 HEAD 底下攒一段"已改未提交"，任何一次 `reset` / `rebase` / `checkout` 都会静默抹掉它。

**但机器判定其实不需要后两者。** 实测（读 `scripts/check-gate-record-debt.js` 源码，非推断）：

- 记录文件源的未收口行，登记信息读**文件自己的 frontmatter**（`sync_reason` / `sync_backfill_owner`，`source:'records'`），全程不碰 ledger；
- ledger 只在处理旧载体那些历史行时被查询（`source:'legacy'`）；
- `check-pr-exec-record.js:43` 的 `CARRIER_RE` 三种载体任一即可，且注释写明"只 M 载体不带记录文件是红的"——即 A 本来就是硬要求。

所以 B、C 对判定是纯冗余，对并发是真实风险。代价已经发生过：

| 实测 | 数值 |
| --- | --- |
| 同一条回填落了两遍 | #3602（`e9c412398`）与 #3606（`32fdd3d4c`）标题逐字相同，相隔 **20 分 17 秒**；刀 1 只改记录文件，刀 2 才改 `.quality-gates.md` 4 行 + 删 ledger 1 行 |
| 共享根 HEAD 上的 git 写动作 | 窗口 2026-10-14 23:00 → 10-15 04:00 共 **29 次**（7 commit / 7 reset→origin/main / 9 merge --ff-only / 2 rebase / 2 checkout），7 条 commit 全是 docs-only 回填与 learnings |
| 旧载体被 git 写重写 | `.quality-gates.md` 与 ledger 的 mtime `03:53:00.552/.556`，与 03:53:00 那次 rebase **同秒** |
| 前科 | `stash@{0}` 名为 `shared-root-dirty-20261014: 56 files (54 tracked + 2 untracked)` |
| 复现 | 2026-10-15 20:2x，本会话再次在共享根观察到未提交的热点载体改动（另一会话 82 行 learnings，实测其内容 66 行未进主干，故本会话未清除它） |

`hot-carrier-atomic-landing`（本日已合入，PR #3632）走的是"加测量 + 加一条命令收口"路线。它自己的 D7 就写明：一旦热点写面消失，本机制 MUST 删除。本 change 直接去消除写面，并把那份规格的两档拦截判据降级为不实现——否则会出现"为一个正在消失的对象新建一道会误伤无辜方的闸"。

## What Changes

- **旧载体转为冻结存档**：新 PR 的执行记录一律只写 `openspec/records/<分支名>.md`；`.quality-gates.md` 的记录块集合 MUST 等于冻结基线（`scripts/gate-carrier-freeze.json`：排序标题的 sha256 + 条数），**加块或删块即红**。
- **保留关旧账的通道**：就地改写已有记录块里的状态行不算漂移。依据是 ledger 现存 **25 条未收口**欠账多为 2026-08 的老记录、只存在于旧载体——封掉这条路等于把旧账永远钉红。
- **顶部棘轮退役**：「最顶部那篇记录必须带 `远程同步` 行」从拦截面移入可见面。它唯一的用处是"用位置猜哪篇最新"，而记录文件源有逐篇硬判据（`missingRecordRows`、`statusContradictions` 均在拦截面上），位置猜测不再必要；继续拦着就等于持续逼每个会话去挤那个大文件。
- **基线重算是人工动作**：`node scripts/freeze-gate-carrier.js`，属"改谁来守门"，不走 agent 自动合并。
- 同步 `AGENTS.md`（新增小节，不改写既有段落）与 `openspec/specs/openspec-integration/spec.md` 的分层分支策略。

非 BREAKING：不删除旧载体任何一行历史内容；不迁移 213 篇"整块无状态行"的历史记录（现判据也只可见不拦截）；不批量替他人关闭那 25 条欠账。

## Capabilities

### New Capabilities

- `gate-record-carrier-freeze`：旧载体作为冻结存档的判据（集合等于基线、加块/删块皆红、就地改状态行皆合法）、基线的承载形态与不可静默跳过口径（缺基线/零基线一律抛错）、顶部棘轮退役后"哪篇最新"由谁承担、以及基线重算的人工边界。

### Modified Capabilities

- `openspec-integration`：「分层分支策略」里"纯流程/规格/文档变更 MAY 在共享主工作区就地编辑"这条，对**旧载体两个文件**收窄为"只读存档，唯一例外是就地关闭已有行"，新 PR 的记录载体固定为 `openspec/records/<分支名>.md`。

基线差异审计：`openspec/specs/` 全树对 `freeze`、`冻结`、`carrier` 命中均为 0；`quality-gate-execution-record` 能力尚未进 `openspec/specs/`（其来源 change 仍 active 未归档），故本 change 不改写它的 requirement，只声明与其判据域的边界——它管"记录该落在哪、是否收口"，本 change 管"旧载体不许再长"。

## Impact

- 新增：`scripts/freeze-gate-carrier.js`（基线重算器）、`scripts/gate-carrier-freeze.json`（基线：603 个标题 + sha256）、本 change 工件、`openspec/records/freeze-legacy-gate-carrier.md`。
- 修改：`scripts/check-gate-record-debt.js`（`carrierDrift` 判据 + 顶部规则移入可见面 + 旧 `❌ 最顶部…` 打印删除）、`scripts/check-gate-record-debt.test.js`（55 条：新增 6 条冻结用例，改写 2 条旧语义，真仓自检换成冻结自检）、`AGENTS.md`（追加小节）、`openspec/changes/hot-carrier-atomic-landing/tasks.md`（把两档拦截判据标为不实现）。
- **本 PR 自身即示范**：只写 `openspec/records/`，未触碰 `.quality-gates.md` 与 ledger（判据 `git diff --name-only` 可自证）。
- 属**混合 PR**（动 `scripts/` 判据本体），走完整门禁；且因改动 CI 判据，**不适用 agent 自动合并**，需人工过目。
- 残留风险（不假装已闭合）：①「加一块同时删一块」的净零漂移只被哈希抓到、不被计数抓到——哈希项在，故仍可判红，但报出的 added/removed 会同时非空，需人读；②基线含 603 条标题（约 71 KB），是仓内较大的数据文件，其代价换取"不依赖 git 历史"（CI 浅检出取不到冻结 commit，若改用 `git show <sha>:` 会落入"读不到基线就当没漂移"的假绿通道）；③计时器（`hot-carrier-atomic-landing` 保留的那一档）尚未实现，因此"是否还有人误碰旧载体"目前只有判据拦截、没有事后读数。
