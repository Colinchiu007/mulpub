## ADDED Requirements

### Requirement: QM-6 评审后端对必须有单一真源

系统 SHALL 把「本次 QM-6 深度审查用哪两个后端」保存在**唯一一份**声明里
（`scripts/ccg-review-backends.list`，第一行 critic、第二行 proposer），
并由该声明派生判定器的目标文案、可用性探测名单、入口体检名单与落进判定记录
（`.ccg/reviews/<sha>.json` 的 `reviewBackends`）的请求值。
生产代码 MUST NOT 再出现第二份写死的后端对（`["claude","opencode"]`、
`for _rb_b in claude opencode` 这类形态）。

由于 `--check-deps` 刻意不依赖 node（它是「node 本身可能就是坏的」时的第一手诊断入口），
本仓存在两个读取方（`scripts/lib/ccg-review-backends.js` 与 `scripts/lib/ccg-backends.sh`）；
两个读取方 MUST 被一把**逐字对账**的行为锁钉住，MUST NOT 以「各自断言等于某个常量」替代。

#### Scenario: 覆盖 critic 后所有消费面一起变
- **WHEN** 以 `--critic codex` 或 `MP_QM6_CRITIC=codex` 运行入口
- **THEN** 判定器目标文案 MUST 报 `双模型(codex + opencode)`
- **AND** 入口体检 MUST 只探测 `codex` 与 `opencode`，MUST NOT 出现 `· claude`
- **AND** 判定记录 MUST 写入 `reviewBackends.critic === "codex"` 且 `overridden === true`

#### Scenario: 同族单后端不得被读成降级
- **WHEN** 解析结果满足 `proposer === critic`
- **THEN** 体检名单 MUST 只列一行
- **AND** 该后端可用时 MUST NOT 打印「降级为单后端」/「只剩单后端可用」
- **AND** MUST 打印一行说明该配置不参与跨家族交叉验证

#### Scenario: 两个读取方不得漂移
- **WHEN** 运行 `scripts/deep-review-deps.test.js` 的对账锁
- **THEN** 默认 / env 覆盖 / 同族单后端 / 未登记后端名 四档配置下，
  shell 渲染的后端表与 node `--print-table` 的输出 MUST 逐字节相同
- **AND** 覆盖档与默认档 MUST 确实不同（否则该锁是在比较常量，属恒真断言）

### Requirement: 后端覆盖参数 MUST 被转发且 MUST NOT 被静默忽略

`scripts/deep-review.sh` 与 `scripts/plan-review.sh` SHALL 接受 `--critic <name>` 与
`--proposer <name>`，并按 **CLI 旗标 > 环境变量 > 清单文件** 的优先级解析；解析结果
SHALL 在驱动调用点作为 `--proposer/--critic` 转发。未覆盖时命令行 MUST 与历史逐字相同
（不把本仓默认值钉进命令行，以免成为第二真源）。

入口 MUST NOT 静默忽略参数：未知旗标与缺值 MUST 以退出码 2 拒绝并点名是哪种错误。

#### Scenario: 缺值与未知旗标一律拒
- **WHEN** 传入 `--critic`（无值）、`--critic --force` 或一个不认识的旗标
- **THEN** 入口 MUST 返回 rc=2
- **AND** 输出 MUST 含「缺值」或「未知旗标」字样，MUST NOT 只有栈或空输出

#### Scenario: 诊断入口不得依赖 node
- **WHEN** 阅读 `scripts/deep-review.sh` 的执行顺序
- **THEN** 后端解析 MUST 早于「定位 node」段与 `--check-deps` 段

### Requirement: 请求的后端 MUST 与实际执行者对账

`scripts/check-pr-exec-record.js` SHALL 提供纯函数 `judgeBackendMismatch(record)`，
当且仅当判定记录满足「`reviewBackends.overridden === true`」且
「`deepReview.status !== 'self_play_resolved'`」且「`deepReview.performedBy` 非空」
且「performedBy 的记号集合不含 `reviewBackends.critic` 与 `proposer`」时，MUST 报告该条
深度审查**未闭合**，并在理由里同时写出请求值与实际执行者。

字段缺失（历史产物）、未覆盖、自扮演闭合、performedBy 为空四种情况 MUST 返回"不适用"，
MUST NOT 追溯把既有 PR 判红，也 MUST NOT 把自扮演豁免改判。
判据 MUST 按显式字段决定收口，MUST NOT 按「这个名字看起来像不像后端」猜——
`self-play` 切分后得到的记号与后端名完全同形，形态判据会恒不成立。

#### Scenario: 设了 codex 却由 claude 评审 ⇒ 判不闭合
- **WHEN** 记录含 `reviewBackends={critic:"codex",proposer:"opencode",overridden:true}`
  且 `deepReview={status:"cleared",performedBy:"claude"}`
- **THEN** `evaluateDeepReviewDebt` MUST 产出含「后端不符」的理由并点名该记录文件

#### Scenario: 相符的多种写法都算相符
- **WHEN** `performedBy` 为 `codex`、`claude+codex` 或 `codex, opencode`
- **THEN** 判据 MUST 返回 null（记号集合含被请求的后端）

#### Scenario: 历史产物不得被追溯判红
- **WHEN** 记录里没有 `reviewBackends` 字段
- **THEN** 判据 MUST 返回 null，且门禁的整体理由里 MUST NOT 出现该文件


### Requirement: 评审时请求的后端 MUST 回写进判定记录

`scripts/deep-review.sh` 在把控制权交给评审驱动**之前**，MUST 把本次生效的后端对写进它已解析到的
那份判定记录（`.ccg/reviews/<…>.json` 的 `reviewBackends`）。提交时 decider 写下的那份 MUST 以
`commitRequest` 留档并带 `rewrittenAt`，MUST NOT 被就地覆盖销毁 ——
「谁在提交时请求了谁」与「谁在本次审查被请求」是两条不同的审计事实，只留一条等于抹掉另一条。

四条边界，缺一不可：默认路径（未覆盖）MUST NOT 改动任何判定产物；dry-run MUST NOT 改动判定产物
但 MUST 出声说明没改；回写这一跳失败 MUST fail-closed（非零退出）且 MUST NOT 启动驱动 ——
带着不一致的记录跑出来的结论不可用；读不到记录 MUST NOT 新建（新建判定产物等于伪造判定）。
"只在覆盖时写" MUST 由机械守卫保证：`--record-request` 在请求值与清单一致时 MUST 拒绝。

#### Scenario: 覆盖 critic 后记录顶层是评审时值、提交时值留档
- **WHEN** 提交时记录为 `reviewBackends={critic:"claude",overridden:false}`，本次以 `--critic codex` 真跑
- **THEN** 记录顶层 MUST 为 `critic="codex"` 且 `overridden=true`，`commitRequest.critic` MUST 仍为
  `claude`，且驱动启动时读到的 MUST 已是 `codex`（这一格是"回写早于 exec"的现场证据，
  只按源码位置断言顺序证不出来：回写排在 exec 之后时源码里两个串仍在，读数却永远是旧值）

#### Scenario: 连换两次**不同**后端时，留档仍是提交时那一份

- **WHEN** 提交时记录为 `{critic:"claude",overridden:false}`，第一次以 `--critic codex` 回写、第二次以 `--critic gpt` 再回写
- **THEN** 顶层 MUST 为 `critic="gpt"`；`commitRequest.critic` MUST **仍为** `claude`，MUST NOT 变成上一次的回写值
  （第二次进函数时 `before` 已经是「上一次评审请求的后端」，直接 `commitRequest = before` 会把审计锚往前挪一格，
  而这条留档存在的唯一理由就是记住**提交时**请求的是谁）；`commitRequest.overridden` MUST 仍为 `false`；
  `rewrittenAt` MUST 锚在第一次改写，多轮换后端不得把它变成「最近一次什么时候跑的」

#### Scenario: 没覆盖时判定产物逐字不变
- **WHEN** 不带 `--critic` / `--proposer` / `MP_QM6_*` 跑一次
- **THEN** 记录文件字节 MUST 与跑之前完全相同，且输出 MUST NOT 出现"已覆盖"行

#### Scenario: 回写失败不得放行审查
- **WHEN** 回写那一跳以非零退出（lib 坏掉 / 记录在运行中途被删）
- **THEN** 入口 MUST 以 rc=2 退出并点名"没能写回"，驱动 MUST 一次都没有被启动

#### Scenario: dry-run 只预览不改产物
- **WHEN** `--dry-run --critic codex`
- **THEN** 记录字节 MUST 保持不变，且输出 MUST 明确说明本次未回写
