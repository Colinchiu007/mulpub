# changelog-record-carrier — delta for changelog-ledger-integrity

## ADDED Requirements

### Requirement: 热写面清单与共享根热点载体清单 MUST NOT 合并成一份

**本条规则的效力来自本 Requirement 自身**，不来自下面提到的那份 change —— 即便 `hot-carrier-atomic-landing` 被放弃、其 `scripts/hot-carrier-paths.json` 从未落地，"MUST NOT 合并"照样成立。引用它只解释边界从何而来，并防止后来者拿"那边也管这两个文件"当误删本判据的理由（规则自持，引用仅作历史指针）。

仓库里另有一份既存的"热点载体"清单设计（change `hot-carrier-atomic-landing` 的 `scripts/hot-carrier-paths.json`，规格已合入、实现未做）。它的 D4 明确把 `AGENTS.md`、`CHANGELOG.md`、`01-docs/learnings.md` **移出**其清单，理由是「没有量过它们在回填链里是否真的构成窗口」，且重进的前提是「由窗口读数先量到」。

本 Requirement 下的清单是**另一个机制的输入**，两者量的是不同的东西，MUST NOT 被"顺手统一"成一份：

| | `hot-carrier-paths.json`（既存 change） | 本判据的热写面清单 |
| --- | --- | --- |
| 防的失效 | 共享根里热点文件的**未提交窗口**（同机并发会话互踩工作树） | 跨 worktree 的 **PR 差量冲突**（`mergeable=CONFLICTING`、CI 绿也合不进） |
| 观测面 | 常驻写守卫的 `violations.jsonl` 时长 | `git merge-tree` 的冲突文件清单与 PR `mergeable` 状态 |
| 现场读数 | 未量（故 D4 撤下那三项） | 实测 4/4 可判定的 CONFLICTING PR 冲突文件只有这两个；最近 30 笔 main 提交 20 笔动台账 |

D4 那句"撤下"的**适用域是它自己的机制**，不构成对本判据的否证；反之本判据的读数也**不满足** D4 为 `hot-carrier-paths.json` 设定的重进前提（那是另一种读数）。两份清单各自一处实现、各自带锁，MUST NOT 出现"改一处另一处跟着漂"。

`hot-carrier-atomic-landing` 还有一条 Requirement「热点写面消失时，本机制必须一并退场」——本 change 若最终消除了这两个写面，退场判据归那一侧，MUST NOT 由本 change 顺手删它的东西。

#### Scenario: 合并两份清单必须被其中一方的锁拒绝

- **WHEN** 有人把 `CHANGELOG.md` / `01-docs/learnings.md` 加进 `scripts/hot-carrier-paths.json`，理由是"那边也有热写面"
- **THEN** `hot-carrier-atomic-landing` 自己那条"清单恰为两项 + 这三项不在清单内"的锁 MUST 判红（它的判据未被本 change 削弱，也不得被本 change 的读数当证据）
- **AND** 本判据 MUST NOT 因此变化 —— 它读的是自己那份 `HOT_CARRIERS`，两把锁各自独立成立

#### Scenario: 本判据命中不得被读成另一机制的窗口证据

- **WHEN** `Gate 2b9` 对某个 PR 报 `HOT_CARRIER_EDIT CHANGELOG.md`
- **THEN** 该读数 MUST NOT 被当作 `hot-carrier-atomic-landing` D4 所要求的"共享根未提交窗口超时"读数（那是另一个观测面的量），MUST NOT 据此把那三项加进它的清单
- **AND** 若要推进 D4 的重进条件，MUST 由常驻守卫的窗口读数单独取证，并记在它自己的 change 里

### Requirement: 台账 MUST 只由聚合器写入，业务 PR 手改即点名

`CHANGELOG.md` 与 `01-docs/learnings.md` 的写入者 MUST 只有一个：`scripts/aggregate-changelog.js`。任何 PR 的差量（`merge-base..head`）里出现这两个文件 MUST 被点名。

判据 MUST 按 **PR 差量**取文件集，MUST NOT 按工作树或文件现状——按现状会把「别人刚合并的内容」算到本 PR 头上（同族实测见 `AGENTS.md`：全树比较 5 例中 3 例假阳性，差异全是别人的文件）。

本 Requirement 落地时 MUST 分两档，且档位由判据自己打印：
- **advisory**：点名不阻断，用于消化窗口——窗口内绝大多数在飞 PR 已按旧规改了 CHANGELOG，直接转阻断会把它们全部判红，而那不是它们的错；
- **enforce**：阻断，转档前置条件是在飞的冲突/未判定 PR 清零或逐个确认差量不含热写面。

`## 未发布` 之外的历史条目 MUST NOT 被本刀改写。**存量重复标题键不因此消失**，那是独立一片的范围；本刀只消掉新增来源。

#### Scenario: 业务 PR 改了台账必须被点名

- **WHEN** 某 PR 的差量含 `CHANGELOG.md`
- **THEN** 判据 MUST 点名该路径并给出正解（写进 `openspec/records/<分支>.md` 的变更说明小节，不动台账）
- **AND** 首行 MUST 打印本次 `MODE=advisory` 或 `MODE=enforce`，档位 MUST NOT 只能从文案措辞推断

#### Scenario: 他人的并发改动不得算到本 PR 头上

- **WHEN** 本 PR rebase 后，`origin/main` 上别人新增的台账行出现在工作树里，而本 PR 差量不含该文件
- **THEN** 判据 MUST 判 PASS
- **AND** 若判据实现改为「读台账文件现状」，该用例 MUST 变红——这条用例测的是差量口径的选择，不是函数是否存在

#### Scenario: 聚合器自己是唯一合法写者

- **WHEN** 发版/聚合 PR 的差量含 `CHANGELOG.md`，且本次差量**新增**授权文件 `scripts/hot-carrier-write-authorization.json` 并声明的 `applies_to_base` 等于本次实际 merge-base
- **THEN** 判据 MUST 放行该文件
- **AND** 授权文件在 base 已存在时 MUST NOT 生效（常驻通行证会让后续每个 PR 白蹭），且缺 `applies_to_base` 或与该 sha 不符 MUST 判红

### Requirement: 聚合 MUST 以记录名为幂等键，且重跑不得改写已有字节

`scripts/aggregate-changelog.js` MUST 以 **record 名**（`openspec/records/<文件名>`，= 分支名，唯一）判定某条是否已落台账；MUST NOT 以标题文本判定。动因是实测事实：主干上同一标题存在多份副本（AGENTS.md 2026-10-17 读数 `CHANGELOG.md` 3348 个重复行键、单键最多 286 份；**该数为活数，引用前重取**），以文本判「已落」会把应当新搬的一条误判成已搬，表现为**静默少一条**——比多搬一条更难发现。

聚合 MUST 逐行保留各自行尾，MUST NOT 探测多数派后统一回写（`AGENTS.md` 行尾条款实测：统一回写一次改写 26 行，且此后任何合并都变成整文件冲突）。

重跑 MUST 幂等：第二次运行的产物字节 MUST 等于第一次，并对每条被跳过的记录出声（`skip=<record>`）。聚合器 MUST 只 require node 内置模块，因为它接在 `quality-gate.yml` 的 `changes` job（该 job 无 Install deps）。

#### Scenario: 同一记录搬第二次不得产生副本

- **WHEN** 对同一 `origin/main` 连续运行两次聚合
- **THEN** 第二趟产物字节 MUST 等于第一趟
- **AND** 第二趟 MUST 打印跳过计数，MUST NOT 静默跳过（静默会让"漏搬"与"正常幂等"两种情况在输出上无法区分）

#### Scenario: 同标题不同记录 MUST 各落一次

- **WHEN** 两条 record 名不同、其变更说明小节标题逐字相同（并发会话写同名标题是既有现场）
- **THEN** 聚合 MUST 落两块
- **AND** 把幂等键退回"按标题文本判重"时，本用例 MUST 变红——这是本 Requirement 的核心选型，必须可被证伪

#### Scenario: 记录缺小节时跳过并出声

- **WHEN** 某条已合并记录缺 `## CHANGELOG 条目` 小节
- **THEN** 聚合 MUST 跳过该条并点名，MUST NOT 整轮静默失败，也 MUST NOT 搬一个空块进台账冒充"已收口"
- **AND** 跳过计数 MUST 出现在首行读数里，使「本轮一条都没搬」与「本轮搬了但都跳过」可区分
