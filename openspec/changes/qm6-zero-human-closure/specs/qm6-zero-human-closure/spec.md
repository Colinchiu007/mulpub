# Spec delta: qm6-zero-human-closure

> 本 delta 只覆盖第 1 刀（D1，处置凭证）与第 3 刀（D3，判据回归语料差分）。
> 与 #4297 的边界：`rebuttals[]` 的**证据要求**不在本 delta 定义，本 delta 只定义"引用必须命中"。

## ADDED Requirements

### Requirement: 每条评审意见的处置必须是封闭分档，且凭证按档机械可核

系统 SHALL 在判定记录的 `deepReview.findings[]` 每条上接受一个可选的 `resolution` 对象，其 `kind`
取值构成**闭集** `{code-fix, false-positive, deferred, unsupported, accepted-risk}`。

分档 MUST 按**三态**处理，不得把"缺席"与"野值"混成一档：

- `resolution` 整段**缺席** ⇒ 档名 `absent`。非高危面放行；高危面**只出声**（首批不拦，理由见 design §3 的顺序约束）。
- `kind` 存在但不在上述闭集内（拼错、数字、对象、空串）⇒ 档名 `unrecognized`，**任何面一律拦**。
- `kind` 在闭集内 ⇒ 该档的凭证判据生效，缺凭证即拦。

各档凭证（唯一真源在本 Requirement，proposal/design 只引用不复述）：

| kind | 必填凭证 | 判据动作 |
| --- | --- | --- |
| `code-fix` | `redThenGreen{lock,case,red{rc,matched},green{rc,matched}}` | `green.rc` MUST 由判据**当场重跑**得出，MUST NOT 采信记录里的值；**拿不到可跑环境时 MUST 落第三档 `rerun-unavailable` 并按未证实处理**（见下方"重跑不是免费的"）；`red` 一侧采信但 MUST 计入 `manualFields` 读数 |
| `false-positive` | `rebuttalRef{fingerprint}` | 该 `fingerprint` MUST 在同一记录的 `rebuttals[]` 中存在；不存在 ⇒ `dangling-rebuttal-ref`，一律拦 |
| `deferred` | `task{change,line}` | `line` 取该行**去掉前后空白后的逐字内容**（MUST NOT 存行号，指针型字段在追加型载体上结构上必然过期），且该行在 `openspec/changes/<change>/tasks.md` 中存在**且未被勾选** |
| `unsupported` / `accepted-risk` | — | 非高危面出声；高危面**拦** |

**两件事不得混为一谈**：`dangling-rebuttal-ref` 是**形状**判据（引用悬空在任何面都拦，因为它意味着记录自相矛盾）；
"`false-positive` 能不能当高危面 Critical 的**收口出口**"是另一条，按 design §3 的顺序在第 4 刀之前只出声。
把两者写成一条，会让"引用合法但高危面不认这个出口"与"引用根本不存在"在读数里同形。

**重跑不是免费的**（本仓既有约束的直接后果，不是新发明）：AGENTS 明文
「接进 `changes` 作业的锁**只能 require node 内置模块**」，而该作业**不装依赖**——
一条 vitest 回归锁在那个作业里物理上跑不了。所以"当场重跑"只可能在带依赖的档（本机 enforce、
`QG Static`/`QG Unit Tests` 一类）成立。硬把它写成无条件的 MUST，等于要求 CI 打印一句假话。
`rerun-unavailable` MUST 有独立计数并出现在读数行里；该档存在时判据 MUST NOT 宣布 `code-fix` 已核。

`code-fix` 与 `false-positive` MUST NOT 互转（同一 `id` 的 `kind` 在两版记录间跨这两档即视为收口动作变更，
MUST 进语料覆盖差分并被点名）。`deferred` MUST NOT 指向一条已勾选的行——那是"用一个已完成的动作给未完成的意见背书"。

#### Scenario: 高危面上的无处置意见必须被点名

- **WHEN** 变更集命中 `HIGH_RISK_SURFACES`，且本次变更集内某条 `mode=dual` 产物含 `severity=Critical` 而 `resolution.kind=unsupported`
- **THEN** 判据 MUST 拦并逐条点名 `finding.id`，MUST NOT 只报"存在未处置意见"这类不指名的汇总

#### Scenario: 野值与缺席不得同形

- **WHEN** 一条 finding 的 `resolution.kind` 写成 `"codefixed"`（拼错）
- **THEN** MUST 落 `unrecognized` 并拦；而另一条整段没有 `resolution` 的 finding MUST 落 `absent`
- **AND** 两档在读数行里 MUST 各有一个独立计数（合成一格就等于把"写错"洗成"还没有这个键"）

#### Scenario: 绿侧采信记录里的值等于没有验证

- **WHEN** 某条 `code-fix` 凭证的 `green.rc` 写着 0 但判据当场重跑该 `lock`+`case` 失败
- **THEN** 判据 MUST 以当场重跑结果为准并拦，MUST NOT 因为"记录里写了 0"而放行

#### Scenario: 跑不了必须写成跑不了，不得写成已核

- **WHEN** 判据运行在没有依赖的档（如 CI `changes` 作业），无法执行那条 vitest 回归锁
- **THEN** MUST 落 `rerun-unavailable` 档并在读数行计数
- **AND** MUST NOT 因"没跑出失败"而把该条 `code-fix` 记为已核 —— 把工具的失明读成结论是本仓反复定性的同型错误

#### Scenario: 指向已勾选行的 deferred 不算处置

- **WHEN** `resolution.task.line` 在 `tasks.md` 里存在但那一行是 `[x]`
- **THEN** MUST 拦并说明"deferred 的语义是本刀不做，已勾选表示已做，两者互斥"

### Requirement: 判据回归语料必须只可追加，且新判据的命中集必须是旧判据命中集的超集

系统 SHALL 维护 `scripts/qm6-judgment-corpus.jsonl`：每条是一个**真实历史案例**的输入面
（可直接喂给判据的 `--statuses=<json>` 那一层）与旧判据在录制当时给出的命中集读数。

判据 `scripts/check-qm6-judgment-regression.js` MUST 对每条语料把**两版实现各真跑一遍**
（旧版从 PR base 的 blob 读源码注入执行；新版取当前工作树），并要求 `hits_new ⊇ hits_old`。

四条不可破：

1. **存输入面，不存结论**。比对靠重放，不靠快照相等——否则任何文案改动都全量红，
   那条锁会在两周内被放宽（本仓对"快照型判据"的失败形态有先例）。
2. **命中集由判据自己产出**，MUST NOT 由重放器从散文 `reasons` 里猜。判据侧今天只返回
   `{reasons: string[]}`，因此 MUST 新增**并行**的结构化出口 `hits: string[]`，
   其取值为一个**封闭常量登记表**（`QJ_RULES`，导出）里的规则 id；`reasons` 文案 MUST NOT 因此改动。
   决策层已有结构化命中面（`stats` 的 `sensitivePathHits` / `plannedPathHits` 与 `mode`），MUST 直接复用，
   MUST NOT 另造一份。
3. **收紧永远放行**：`hits_new ⊃ hits_old` 不红。只有"旧命中、新不命中"才是变宽。
4. **读不到按未证实，不得读成没有变宽**：某条语料的产物或 blob 取不到 ⇒ 计入 `unverified` 并在读数行点名；
   `registered=0` 或 `corpus-cases=0` ⇒ 退出码 MUST 落"判据自身故障"档（2），MUST NOT 落 0。

#### Scenario: 改窄守门面前缀必须当场红并点名一条真实案例

- **WHEN** 有人把 `HIGH_RISK_SURFACES` 的 `scripts/check-` 改成 `scripts/check-pr`
- **THEN** 语料中某条 base 判据命中 `surface:scripts/check-` 而新判据不命中 ⇒ MUST 红
- **AND** 红文案 MUST 打出该语料的 `source.pr` 与可重跑命令，使复核不依赖任何人的记忆

#### Scenario: 语料为空不得读成通过

- **WHEN** `scripts/qm6-judgment-corpus.jsonl` 不存在或解析后条数为 0
- **THEN** MUST 以退出码 2（判据自身故障）出声，MUST NOT 打印 `PASS`；`JUDGMENT-RULES registered=<n> corpus-cases=<n>` 行 MUST 仍被打印

#### Scenario: 规则登记表退化必须可区分

- **WHEN** `QJ_RULES` 被改成空数组，而语料与实现照旧
- **THEN** 判据 MUST 报 `registered=0` 且落未证实档 —— "零条规则"与"零条命中"在日志里必须不是同一句话

### Requirement: 每条守门维度的语料覆盖计数不得下降，新维度初始覆盖必须为正

"语料只可追加"防得住批量删，防不住删一条"看起来没人依赖的"。系统 SHALL 为每条语料记录 `coverage`：
逐个高危面前缀、`tier` 各档、写回器合取每条、`resolution.kind` 各档在该语料上**被真正行使过**的计数。
键 MUST NOT 使用判定记录名（记录名内容寻址、重投提交即换名，挂它的计数器每次归零且全程看着正常）。

判据 MUST 同时断言三件事，缺一不可，且三件事的红文案 MUST 各不相同：

1. 任一维度的**覆盖计数**在语料集合上不得下降（删掉唯一覆盖某维度的案例 ⇒ 该维从 N 掉到 0 ⇒ 红）；
2. **新增维度**的初始覆盖数 MUST > 0（禁止"先挂名、以后补案例"的空头登记）；
3. 语料**总条数**不得下降（批量删）。

只写第 3 条等于只防住最粗糙的一种；只写第 1、2 条则总规模退化无人问。

#### Scenario: 删除唯一覆盖某前缀的案例必须因覆盖计数而红

- **WHEN** 从语料中删除若干条，剩余条数仍高于下限，但 `surface:scripts/ccg-review-` 的覆盖从 2 变 0
- **THEN** MUST 红并点名该维度，MUST NOT 因"条数仍达标"而放行

#### Scenario: 零覆盖的新维度登记必须被拒

- **WHEN** 新增一个守门维度但没有任何语料行使过它
- **THEN** MUST 红并说明该维度需要至少一条真实案例，MUST NOT 允许把它记成"已登记"

### Requirement: 顺序锁——转拦必须依赖探测器已有可核读数

第 1 刀在高危面上把 `unsupported` / `accepted-risk` 由"出声"改为"拦"的那段逻辑，MUST 读取
`openspec/changes/<change>/judgment-replay-runs.json` 才能生效。该文件取不到、条数为 0、
或其 `headSha` 与当前 HEAD 无可核关系时，MUST **维持出声档并点名 `probe-unverified`**，
MUST NOT 因"读数缺失"而**同时**丢掉出声（那等于顺序锁与探测器一起下线而日志完全安静）。

落点选该路径而非 `.ccg/` 或 `scripts/` 的理由是实测约束：pre-commit 暂存判定记录用的 glob 是
`:(glob).ccg/reviews/*.json`，其中 `*` 不跨 `/` ⇒ 放子目录的账不随 PR 入库，会变成"只有本机知道"的第二份事实。

#### Scenario: 探测器没跑过时不得静默降级

- **WHEN** `judgment-replay-runs.json` 不存在
- **THEN** MUST 打印 `probe-unverified` 并保持出声档；MUST NOT 打印"已转拦"或"无需拦截"

### Requirement: 本 change 不改变"谁算高危面"，也不改闭环闭集

本 change MUST NOT 增删 `HIGH_RISK_SURFACES` 的任何一条（现读数 10 条，vendored 排除 1 项），
MUST NOT 改 `CLOSED_DEEP_REVIEW_STATUSES` 闭集内容，MUST NOT 改写回器的五条合取。
这两组是"谁来守门"的清单，改动一律属人工过目面，与本 change 的机械判据正交。

#### Scenario: 顺手扩表必须被拒

- **WHEN** 实现片把 tasks 11.6 那四个库文件的前缀一并加进守门面以"顺带收口"
- **THEN** 该改动 MUST 被拆成独立 change 并交人工过目；本 change 的 PR 里出现即视为越界
