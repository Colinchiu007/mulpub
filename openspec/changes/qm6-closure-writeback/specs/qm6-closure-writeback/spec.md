## ADDED Requirements

### Requirement: 闭环值的写入方必须是仓内驱动，且写入条件是可核的合取

系统 SHALL 在 `scripts/deep-review.sh` 完成一次深度审查后，由**仓内**唯一实现
`scripts/ccg-review-writeback.js` 决定是否把 `deepReview.tier` 写为 `external` 并写 `deepReview.evidence`。
生产代码 MUST NOT 再出现第二处写 `tier` 的实现，判定记录里 `tier` 的写入方 MUST 唯一。

写入 MUST 同时满足五条，任一不成立即**不写、不改 `status`、不猜默认值**，并输出一行点名缺哪一条：

1. `deepReview.status` 在 `CLOSED_DEEP_REVIEW_STATUSES` 内；
2. `deepReview.findings` 是**数组**且长度 > 0；
3. `deepReview.performedBy` 与同一份记录的 `reviewBackends.critic` **逐字相等**（期望值由驱动写入，不由填写方自选）；
4. 该记录是本次驱动调用刚产出的，**两条同时成立且各自出声**：
   ① 调用前后记录文件**字节不同**（相同 ⇒ `no-write`）；
   ② `deepReview` **去掉 `at` 后的规范化摘要不同**（相同 ⇒ `no-new-delivery`）。
   仅用 ① 不合格：引擎每个写回站点都带 `at` 时间戳，字节差会被时间戳单独满足；
   仅用 ② 也不合格：无变化的复审但 `status` 改变时必须能写。
   第 ② 项的规范化与 `delivery@` 证据摘要（只取 `deepReview.findings`）是**两个不同实现**，
   MUST 各有一个名字、各有一条用例，MUST NOT 合并；
5. 记录文件路径由入口**显式透传**。路径缺失 MUST 当场以 `missing-record-path` 出声并终止写回，
   MUST NOT 回退为"扫目录取最近一个"或"用 HEAD sha 猜"。

`externalReview` 一类的形状判据若需要「后端名与本轮 critic 一致」这一条，MUST 复用本 Requirement 的第 3 条口径，
MUST NOT 在别处再抄一份比较逻辑。

写回器 MUST NOT 依赖 `CLOSED_DEEP_REVIEW_STATUSES` 的当前内容而不设防：
它 SHALL 有一条**冻结快照**用例断言该闭集逐项相等；闭集变动 MUST 同次改快照并走评审，
**MUST NOT** 出现"改判据即静默改了生产者"。

#### Scenario: 时间戳单独变化不构成新交付
- **WHEN** 引擎重写同一条记录、`findings`/`status`/`performedBy` 逐字未变而只有 `at` 变了
- **THEN** 写回器 MUST 以 `no-new-delivery` 出声且 MUST NOT 写 `tier`

#### Scenario: status 变了但 findings 没变仍算新交付
- **WHEN** 一轮无变化的复审把 `status` 从 `escalated` 改为 `cleared`，`findings` 未变
- **THEN** 语义指纹 MUST 判定为已变并允许写回（前提第 1–3 条成立）

#### Scenario: 路径未透传必须出声而不是猜
- **WHEN** 调用写回器时未传记录文件路径
- **THEN** MUST 以 `missing-record-path` 失败并终止，MUST NOT 扫描目录或改用 HEAD sha 推断

#### Scenario: 五条件齐备时驱动写回 external
- **WHEN** 引擎已把 `status:"cleared"`、`performedBy:"claude"`、`findings:[3 条]` 落进 `.ccg/reviews/<sha>.json`，且该记录 `reviewBackends.critic` 为 `claude`
- **THEN** 写回器 MUST 把 `deepReview.tier` 置为 `external` 并写入 `delivery@<sha256>` 形态的 `evidence`
- **AND** `scripts/check-pr-exec-record.js` 对同一条记录 MUST 读成 `external`（不再依赖任何手写）

#### Scenario: 后端名不符即不写，且不冒充
- **WHEN** 同上，但 `reviewBackends.critic` 为 `codex`（即被请求的后端与实际执行者不同）
- **THEN** 写回器 MUST NOT 写 `tier`，MUST NOT 改 `status`
- **AND** MUST 输出一行包含 `skip-writeback` 与缺失条件名（`backend-mismatch`）的读数

#### Scenario: 空 findings 不算交付
- **WHEN** 记录里 `status:"cleared"` 而 `findings` 为 `[]`、`null` 或不是数组
- **THEN** 写回器 MUST 拒绝写回并以 `empty-findings` 出声
- **AND** 判据侧对该条 MUST 仍读成 `unknown`/`unrecognized`（按字段是否存在），MUST NOT 因"驱动跑过"而放行

#### Scenario: 写入方唯一
- **WHEN** 生产代码里出现第二处给 `tier` 赋 `external` 的字面量（`deep-review.sh` 与本写回器之外）
- **THEN** 结构锁 MUST 变红

### Requirement: `delivery@` 出处必须可就地重算，判据不得只认形状

`scripts/check-pr-exec-record.js` 的 `evidenceForm()` SHALL 增加一档 `delivery`，
接受形如 `delivery@<64 位小写十六进制>` 的值，并 MUST **验证内容而不是验证形状**：
判据 MUST 对该记录自己的 `deepReview.findings` 按声明的规范化口径重算摘要，
与 `evidence` 里的值逐字符相等才判该形态成立；不等或 `findings` 不可读一律降为 `external-unverified`。

该档与既有 `path` 档同属**可就地验证**的两档；其余四档（`pr`/`session`/`uuid`/`oid`）仍按形状判，
本片 MUST NOT 把它们伪装成已验证。摘要的规范化实现 MUST 只有一份，写回器与判据 MUST require 同一文件。

#### Scenario: 自洽摘要判 external
- **WHEN** `evidence` 的摘要等于该记录 `findings` 规范化后的 sha256
- **THEN** `closureCorroboration()` MUST 返回 `external`

#### Scenario: 抄来的摘要不成立
- **WHEN** `evidence` 是合法 64 位十六进制但与本记录 findings 重算值不等（含从别的记录整段复制）
- **THEN** `closureCorroboration()` MUST 返回 `external-unverified`
- **AND** 在**高危面**上该条 MUST 判欠账（高危面只认 `external`）

#### Scenario: 判据与写回器不得各存一份规范化
- **WHEN** 摘要规范化逻辑被复制到第二处实现
- **THEN** 接线锁 MUST 变红，并点名第二处的文件与行

<!-- 原 Requirement「跨仓形状判据的两份实现必须逐字对账」（D5 / tasks §5）已于 2026-10-22 从本 delta 移出，
     随 tasks §5 那片一起进规格。理由与前提见 tasks.md §5 段首三条（对账对象只活在引擎那份未提交补丁里，
     本仓此刻无法让它真跑）。规格不写没实现的要求。 -->

### Requirement: 跑完真评审不得让记录在结构上退化

写回器 MUST 保证「引擎完成一次交付」这一事件不会使判定记录失去判据所要求的字段。
具体地：读到 `deepReview` 缺 `tier` 键时 MUST 按 `ccg-review-decider.js::buildDeepReviewInit()` 的同一口径补齐初值再判定，
MUST NOT 让"跑过评审"的记录比"什么都没做"的记录更差（后者有 `tier:"unknown"`，前者曾被整体替换成无此键）。

`deep-review.sh` 由 `exec` 改为调用后，其退出码 MUST 与被调用方的退出码逐字一致；
`--dry-run` 出口与引擎缺失（`DRY_NO_DRIVER`）出口的行为 MUST 与改动前一致。
信号终止的映射（跨家族评审 codex i2）**由 shell 的 `$?` 原生提供**（`128+signo`），因此对本仓的要求不是"再抄一份映射表"，
而是 **入口 MUST NOT 对 rc 做任何加工**：MUST 在被调方返回后立刻 `_wb_rc=$?`，其后任何命令（含写回器）都不得改写它。
`137` 这个期望值 MUST 由**同机同 shell 的实测探针**给出，而不是把常数写死进断言——Windows Git Bash 与 Linux 对信号终止
给出的读数不同形，写死常数的锁会在一侧恒红或恒绿。
写回器 CLI MUST 整体包在 `try/catch` 内：抛错只打印一行原因（含 `reason=`），MUST NOT 以裸栈收尾，MUST NOT 改变已确定的退出码。

#### Scenario: 子进程被信号终止时不得洗成 0
- **WHEN** 引擎进程被 `SIGKILL`（`code` 为 `null`、`signal` 为 `SIGKILL`）
- **THEN** 入口 MUST 以「同一 shell 里探针实测到的同种死法的退出码」退出（POSIX 下即 `137`），MUST NOT 因写回器未抛错而返回 0
- **AND** 该期望值 MUST 由锁在同一次运行里现测得到并打印出来，不得写成常数

#### Scenario: 写回器抛错不改退出码
- **WHEN** 引擎以 rc=0 正常收敛，而写回器内部抛异常
- **THEN** 入口 MUST 仍以 0 退出，且 stderr MUST 出现写回失败的原因行

#### Scenario: rc 语义不因加写回而漂移
- **WHEN** 引擎以 rc=1 退出（如 `escalated`）
- **THEN** `deep-review.sh` MUST 以 1 退出，MUST NOT 因写回器成功而返回 0

#### Scenario: 缺键补齐而非静默丢字段
- **WHEN** 记录 `deepReview` 有 `status`/`performedBy`/`findings` 而无 `tier` 键
- **THEN** 写回器 MUST 先按统一口径补 `tier` 初值，再按五条件决定是否升 `external`
- **AND** 判据对该条 MUST 能区分「补过初值未升级」与「字段整段消失」两种形态
