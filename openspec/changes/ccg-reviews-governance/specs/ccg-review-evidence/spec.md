## ADDED Requirements

### Requirement: 深度审查的闭环状态 MUST 由执行记录台账承载并可被机械复核

已判定需要深度审查（`deepReview.required === true` 且 `mode === 'dual'`）的改动，其闭环状态 MUST 由 `openspec/records/<分支>.md` 的 frontmatter 台账字段承载（`ccg_mode` / `ccg_status` / `ccg_rounds` / `ccg_evidence` / `ccg_payload_sha256` / `ccg_payload_base` / `ccg_payload_head` / `ccg_written_by`），且 MUST 能被门禁在不依赖任何人工承诺的前提下复核。闭环状态词表 MUST 取白名单（fail closed）。

#### Scenario: 台账闭环且证据自洽时不得报欠账

- **WHEN** 某 dual 改动的台账状态在白名单内、provenance 为引擎收口、证据 URL 合规、载荷与 head 均可重算对上，且引擎判定记录同样已闭环
- **THEN** 门禁 MUST 判为已闭环，并 MUST 出声说明本次取值源是台账

#### Scenario: 台账与引擎记录不一致 MUST 计欠账（手造闭环的主拦截点）

- **WHEN** 台账声明闭环（含四个被判值全部自洽可导出），但同一变更集内引擎那份判定记录的 `deepReview.status` 不在闭环白名单内
- **THEN** 门禁 MUST 计欠账并 MUST 同时点名两个源的读数；MUST NOT 因「台账看起来完整」而放行 —— 台账值全部可由本机离线导出，单靠仓内文本不构成闭环

#### Scenario: 手填的 provenance 不构成闭环

- **WHEN** `ccg_written_by` 缺失或不等于引擎收口写出的取值
- **THEN** 门禁 MUST 计欠账并点名该字段

#### Scenario: 新源优先，旧源 MUST NOT 反过来掩盖新源

- **WHEN** 旧 `.ccg/reviews/*.json` 已闭环而台账缺失、状态不在白名单、或证据不成立
- **THEN** 门禁 MUST 以台账为准报欠账

#### Scenario: 台账不存在时旧语义逐字保持（双读兼容期）

- **WHEN** 一个在飞 PR 的变更集只有 `.ccg/reviews/*.json`，本分支记录文件里没有任何 `ccg_*` 字段
- **THEN** 门禁 MUST 退回按旧 json 判定，既不得因其「没有新字段」判红，也不得因此撤掉该 PR 的深度审查守卫

### Requirement: 闭环声明 MUST 绑定到一份可重算、可定位到具体提交范围的载荷

台账 MUST 记录载荷哈希、base 与 head 三个值；门禁 MUST 用同一实现重算并比对。base 与 head **两端** MUST 是完整 commit sha —— MUST NOT 以 ref 名入锚。载荷 diff 的**生成参数 MUST 被钉死**（不取决于运行它的那台机器的 `[diff]` 配置）。

#### Scenario: 改完代码沿用旧裁决必须被抓住

- **WHEN** 作者在深度审查之后又改了被审的代码并沿用旧裁决
- **THEN** 重算值与声明值不符，门禁 MUST 报「该裁决描述的不是这份代码」

#### Scenario: base 或 head 写成移动指针必须被拒绝

- **WHEN** `ccg_payload_base` / `ccg_payload_head` 缺失、非 40hex，或写成 `origin/main` / `HEAD` 这类会移动的 ref 名
- **THEN** 门禁 MUST 判为未闭环并点名该字段；MUST NOT 退化为用调用方传入的 base 重算

#### Scenario: 锚签在别的提交上必须被拒绝

- **WHEN** 台账记录的 head sha 与本次评审对象的 commit sha 不一致
- **THEN** 门禁 MUST 计欠账并点名两个 sha

#### Scenario: 本机 diff 配置不得改变载荷哈希

- **WHEN** 计算载荷时本机全局配置含 `diff.noprefix=true` 或 `diff.context=9`
- **THEN** 得到的 sha MUST 与默认配置下的 sha 相等；而真实改动源码时 sha MUST 改变（前者防跨机假红，后者防「钉死=算死」的假绿）

#### Scenario: 载荷哈希的排除面 MUST 防止自指

- **WHEN** 收口把证据 URL 与哈希写进 `openspec/records/**`，或钩子重写 `.ccg/reviews/**`
- **THEN** 载荷哈希 MUST 不随之改变

#### Scenario: 空载荷不得成为闭环证据

- **WHEN** 声明的载荷哈希等于「0 字节 diff」的固定常量，或本次 diff 为 0 字节
- **THEN** 写入侧与门禁 MUST 都拒绝，MUST NOT 把它当同源成立

### Requirement: 证据锚 MUST 指向公开 PR 面上的一条具体评论，且 MUST NOT 由写入侧伪造

`ccg_evidence` MUST 是形如 `https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>`（或 `#discussion_r<id>`）的 URL；仅指向 PR 本体不构成证据。写入侧 MUST 在**评论确实贴出并可从平台读回**之后才回写台账字段；读回不成立时 MUST 放弃写入并出声，MUST NOT 合成一个看似合法的 URL 顶上。

#### Scenario: 贴评论失败时一个字都不写

- **WHEN** 贴评论失败 —— 无论其 stdout 是否带着一个形状完全合法的 URL
- **THEN** 收口 MUST 不写任何台账字段（反序即「字段说闭环、外部没有这条证据」）

#### Scenario: 未出裁决不得入台账

- **WHEN** `mode` 非 `dual`、`deepReview.required` 不为 true、状态不在闭环白名单，或找不到判定记录
- **THEN** 收口 MUST 跳过写入并如实说明原因，MUST NOT 给自己发通过章

#### Scenario: 借用他人裁决必须被同源校验拒绝

- **WHEN** 按分支起点命中的判定记录，其 `stagedDiffHash` 与本次重算值不符（或根本没有该字段可核）
- **THEN** 收口 MUST 拒绝采用该记录，并 MUST 给出与「找不到记录」**不同**的补救说明（前者记录存在但不属于本次）

### Requirement: 台账字段与取值口径 MUST 各只有一份实现，且只在解析出本分支时才接管

载荷哈希定义与 diff 钉参、闭环白名单取值、台账字段清单、frontmatter 改写规则、证据 URL 形状 MUST 各自只有一份实现并被写入侧与判据侧共同 require。判据 MUST 只接受 `<headBranch>` 对应那篇记录作为台账，且 MUST 交叉核对 frontmatter 的 `record:` 与分支名同键。

#### Scenario: 任一侧单方面改清单必须当场失败

- **WHEN** 清单新增字段而写入侧未产出（或反之）
- **THEN** 写入侧 MUST 抛出「字段清单不一致」，MUST NOT 静默产出一份判据永远等不到该键的台账

#### Scenario: 别的分支那篇记录不得被当成本 PR 的取值源

- **WHEN** 变更集只修改了 `openspec/records/<别人的分支>.md`（回填型 PR 的常规动作），而本分支记录里没有台账字段
- **THEN** 判据 MUST 退回 json 源并如实说明取值源，MUST NOT 借用他分支的台账 —— 那会让一次回填既可能由绿转红、也可能把别人的闭环当自己的

#### Scenario: frontmatter 改写 MUST 保持每一行自身的行尾

- **WHEN** 收口改写一个含混合行尾的执行记录文件
- **THEN** 除被点名的键所在行外其余行 MUST 逐字节不变（含各自的 `\r`），MUST NOT 探测多数派后统一回写；`changed` MUST 等于真实变动行数
