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
| `false-positive` | `rebuttalRef{fingerprint}` | 该 `fingerprint` MUST 在同一记录的 `rebuttals[]` 中存在；不存在 ⇒ `dangling-rebuttal-ref`，一律拦。**但 `rebuttals[]` 这一面本身不可得时 MUST NOT 走这条**，见下方「缺席面不得被读成悬空」 |
| `deferred` | `task{change,line}` | `line` 取该行**去掉前后空白后的逐字内容**（MUST NOT 存行号，指针型字段在追加型载体上结构上必然过期），且该行在 `openspec/changes/<change>/tasks.md` 中存在**且未被勾选** |
| `unsupported` / `accepted-risk` | — | 非高危面出声；高危面**拦** |

**两件事不得混为一谈**：`dangling-rebuttal-ref` 是**形状**判据（引用悬空在任何面都拦，因为它意味着记录自相矛盾）；
"`false-positive` 能不能当高危面 Critical 的**收口出口**"是另一条，按 design §3 的顺序在第 4 刀之前只出声。
把两者写成一条，会让"引用合法但高危面不认这个出口"与"引用根本不存在"在读数里同形。

**但悬空判据自己有一个必须先解决的前置**（第 1 轮评审 i1 命中，且它比评审说的形态更危险）：
今天主干上**没有任何产物写过 `rebuttals[]`**（生产方是还在飞的 #4297）。若 `dangling-rebuttal-ref` 无条件生效，
实现者只有两条路，**两条都是本 change 要消灭的形状**：

- 照字面拦 ⇒ 每一个合法的 `false-positive` 都成悬空，**"评审发现问题时高危面没有出口"这条原病被复刻一遍**；
- 为了让它不拦而写"没有 `rebuttals[]` 就跳过检查" ⇒ 这条判据**永久 no-op**，而日志读起来完全像"已核对且无悬空"
  （装饰性门禁）。评审建议的"推迟到 #4297 固化后再开"其实只是第二条路换了个说法。

正解是**再开一档，与 `resolution` 自身的三态同构**，三条都要有独立计数：

| 现场 | 档 | 动作 |
| --- | --- | --- |
| 记录里 `rebuttals` 键整段缺席 | `rebuttal-face-absent` | **不拦、必须出声、计数进 `RESOLUTION-CENSUS`** |
| `rebuttals` 存在，指纹没命中 | `dangling-rebuttal-ref` | 一律拦 |
| `rebuttals` 存在且命中 | 已核 | 通过 |

转前置条件 MUST 写在判据里而不是靠人记：**只有当 #4297 合并、且普查工具当场读到 ≥1 条带 `rebuttals[]` 的产物之后**，
`dangling-rebuttal-ref` 才有资格从"不拦"变"拦"；`rebuttal-face-absent` 计数归零是这件事的现场证据
（归零之前把它转拦，就是在用一条没有生产方的规则拦人。该前置条件同时写在 tasks 3.1。）

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

#### Scenario: 生产方还没出现时不得把合法引用判成悬空

- **WHEN** 一条 `false-positive` 带着 `rebuttalRef`，而该记录的 `rebuttals` 键整段不存在（#4297 尚未合并的现场态）
- **THEN** MUST 落 `rebuttal-face-absent` 档：不拦、出声、计数进 `RESOLUTION-CENSUS`
- **AND** MUST NOT 落 `dangling-rebuttal-ref`（那会把"出口为空"这个本 change 要修的病复刻一遍）
- **AND** MUST NOT 因为"没东西可查"而静默跳过整条判据（那读起来完全像"已核对且无悬空"）

### Requirement: 判据回归语料必须只可追加，且新判据的命中集必须是旧判据命中集的超集

系统 SHALL 维护 `scripts/qm6-judgment-corpus.jsonl`：每条是一个**真实历史案例**的输入面
（可直接喂给判据的 `--statuses=<json>` 那一层）与旧判据在录制当时给出的命中集读数。

判据 `scripts/check-qm6-judgment-regression.js` MUST 对每条语料把**两版实现各真跑一遍**
（旧版从 PR base 的 blob 读源码注入执行；新版取当前工作树），并要求 `hits_new ⊇ hits_old`。

七条不可破（第 1–4 条为初稿，第 5 条由第 1 轮外部评审 i3 补，第 6 条由 i5 补，第 7 条由 i4 补）：

1. **存输入面，不存结论**。比对靠重放，不靠快照相等——否则任何文案改动都全量红，
   那条锁会在两周内被放宽（本仓对"快照型判据"的失败形态有先例）。
2. **命中集由判据自己产出**，MUST NOT 由重放器从散文 `reasons` 里猜。判据侧今天只返回
   `{reasons: string[]}`，因此 MUST 新增**并行**的结构化出口 `hits: string[]`，
   其取值为一个**封闭常量登记表**（`QJ_RULES`，导出）里的规则 id；`reasons` 文案 MUST NOT 因此改动。
   `hits` MUST 与 `reasons` **无派生关系**——在每条规则触发的同一处 `push`，
   MUST NOT 事后从 `reasons` 文本反推（反推就是把"文案漂移"接进判据，第 1 轮评审 i2 担心的正是这个落点）。
   决策层已有结构化命中面（`stats` 的 `sensitivePathHits` / `plannedPathHits` 与 `mode`），MUST 直接复用，
   MUST NOT 另造一份。
3. **收紧永远放行**：`hits_new ⊃ hits_old` 不红。只有"旧命中、新不命中"才是变宽。
4. **读不到按未证实，不得读成没有变宽**：某条语料的产物或 blob 取不到 ⇒ 计入 `unverified` 并在读数行点名；
   `registered=0` 或 `corpus-cases=0` ⇒ 退出码 MUST 落"判据自身故障"档（2），MUST NOT 落 0。
5. **`hits_old` 与 `coverage` 都不可被就地改写**（i3：只可追加在"整条重写并同步改小期望值"面前是纯约定）。
   判据 MUST 把每次运行的 `(corpusSha256, registered, corpus-cases, 各维度覆盖数合计)` 追加进
   `openspec/changes/<change>/judgment-replay-runs.json`，并在本次运行里与**上一条运行账**对账：
   本次读到的语料哈希与上一条记录不一致、或覆盖合计低于上一条 ⇒ 红并点名两次的哈希。
   **只读当前文件、不和上一账比**，等于把"改语料"这件事完全交给自觉。
6. **录制侧必须先自证能重放，不得录进注定 `unverified` 的条目**（i5）。
   一条 blob 取不到的语料会**永久**落未证实档，而它照样把 `corpus-cases` 分母抬高——
   于是"扫到 N 条语料"这句读数从此含死条目，而下一条判据把它当覆盖。硬约束三条：
   ① 录制脚本 MUST 在写入前对每条案例跑 `git cat-file -e <base blob>`，
   ② 不可读 ⇒ **拒绝录入**并以非零码收场、逐条点名 PR 号（不得静默跳过——跳过和"没有可录的"必须可区分），
   ③ 每次录制打印 `RECORD-ATTEMPTED=<n> REJECTED-UNREPLAYABLE=<n> WRITTEN=<n>`，
      且 `WRITTEN=0` 而 `RECORD-ATTEMPTED>0` ⇒ 非零退出。
7. **选择集读数必须常态打印**（i4 的成立那一半：成本随语料规模走，而选择集依赖命中读数）。
   判据每次运行 MUST 无条件打印 `REPLAY-SCOPE full|selected=<n> hit-dimensions=<逗号清单>`，
   而不是只在降级时打 `DEGRADED(...)`。理由：只在降级时打印，等于"平时没人知道自己跑的是哪一档"，
   而下一次会话会把选择集误当成全量来引用覆盖率结论（本仓「局部绿不等于整体绿」同型）。

#### Scenario: 就地改写语料期望值必须被运行账抓到

- **WHEN** 有人不把 `hits_old` 里的某个 id 删掉，而是同时把 `coverage` 与条数改小，使超集判据平凡成立
- **THEN** `corpusSha256` 与上一条运行账不符 ⇒ MUST 红并打印两个哈希
- **AND** 若该文件的 git 历史里这一行是本次改动集带来的，MUST 在红文案里直接点名"语料期望值被同一次改动重写"

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

### Requirement: 探测器自身的可审计痕迹必须是一个维度，且明文声明它不参与放行

D3 的判据本体 `scripts/check-qm6-judgment-regression.js` 落在 `scripts/check-` 高危面上，因此它守别人、
守不了自己——这条自指**不假装已闭合**。系统 SHALL 把它做成语料覆盖面的一个具名维度 `probe:self-test`，
并规定：

1. 该维度 MUST 有 **≥ 2 条**真实案例，且两条形态缺一不可：一条**能触发变宽检出**
   （历史上确有"旧命中、新不命中"的那次），一条**在合规改动上正确地不报错**（防把探针改成恒红也算"有痕迹"）。
   一条下限写 1 是不够的：单条形态对"探针只在一种输入下工作"完全失明。
2. 该维度 MUST NOT 参与任何放行判据（它答的是"这台探测器被重放过"，不是"改动是对的"）。
   红文案与 spec 都必须把这句写出来——**不写，下一个会话就会把它当收口资格用**。
3. 该维度计数下降 MUST 红，与普通维度同判据（否则"痕迹"本身可以被静默删掉）。

#### Scenario: 只留一条形态的自测维度必须被拒

- **WHEN** `probe:self-test` 只覆盖到"能检出变宽"那一条，缺"合规改动不报错"那条
- **THEN** MUST 红并点名缺哪条形态，MUST NOT 因"该维度计数 > 0"而放行

#### Scenario: 不得把可审计痕迹读成收口资格

- **WHEN** 某条高危面记录的收口判据试图以"probe:self-test 已覆盖"替代 `tier=external`
- **THEN** MUST 拦，并打印该维度在合同里被明文排除于放行资格之外

### Requirement: 顺序锁——转拦必须依赖探测器已有可核读数

第 1 刀在高危面上把 `unsupported` / `accepted-risk` 由"出声"改为"拦"的那段逻辑，MUST 读取
`openspec/changes/<change>/judgment-replay-runs.json` 才能生效。该文件取不到、条数为 0、
或其 `headSha` 与当前 HEAD 无可核关系时，MUST **维持出声档并点名 `probe-unverified`**，
MUST NOT 因"读数缺失"而**同时**丢掉出声（那等于顺序锁与探测器一起下线而日志完全安静）。

落点选该路径而非 `.ccg/` 或 `scripts/` 的理由是实测约束：pre-commit 暂存判定记录用的 glob 是
`:(glob).ccg/reviews/*.json`，其中 `*` 不跨 `/` ⇒ 放子目录的账不随 PR 入库，会变成"只有本机知道"的第二份事实。

**这个账的形状由 spec 持有**（第 1 轮评审 i7：文件名定了、内容结构没定，而顺序锁读的正是内容）。
最小字段闭集，缺任一 ⇒ 按未证实处理：

```
schemaVersion: 1          // 换代只由人改这个数；读不到已知版本一律未证实
runs: [{
  at:            "<ISO>",
  headSha:       "<本次被重放的提交>",
  corpusSha256:  "<语料文件内容摘要>",
  registered:    <QJ_RULES 条数>,
  corpusCases:   <语料条数>,
  unverified:    <blob 或产物取不到的条数>,
  scope:         "full" | "selected",
  hitDimensions: ["<与 REPLAY-SCOPE 行同源展开>"],
  coverageTotals: { "<维度键>": <合计> }   // 键 MUST NOT 是记录名
}]
```

三条约束：`runs` **只可追加**（与语料同判据，就地改写由 `corpusSha256` / `coverageTotals` 对账暴露）；
`schemaVersion` 不认识 ⇒ 未证实，**MUST NOT 按 v1 的字段布局猜读**；语料与本文件的摘要都进账，
否则"上一账"自己可以无痕替换——那等于给防改宽的探测器留了一个没守卫的后门。

#### Scenario: 探测器没跑过时不得静默降级

- **WHEN** `judgment-replay-runs.json` 不存在
- **THEN** MUST 打印 `probe-unverified` 并保持出声档；MUST NOT 打印"已转拦"或"无需拦截"

#### Scenario: 账本版本不认识时不得按上一版猜

- **WHEN** 该文件的 `schemaVersion` 是判据不认识的数
- **THEN** MUST 落 `probe-unverified` 并维持出声档，MUST NOT 用已知版本去解析未知结构

### Requirement: 本 change 不改变"谁算高危面"，也不改闭环闭集

本 change MUST NOT 增删 `HIGH_RISK_SURFACES` 的任何一条（现读数 10 条，vendored 排除 1 项），
MUST NOT 改 `CLOSED_DEEP_REVIEW_STATUSES` 闭集内容，MUST NOT 改写回器的五条合取。
这两组是"谁来守门"的清单，改动一律属人工过目面，与本 change 的机械判据正交。

#### Scenario: 顺手扩表必须被拒

- **WHEN** 实现片把 tasks 11.6 那四个库文件的前缀一并加进守门面以"顺带收口"
- **THEN** 该改动 MUST 被拆成独立 change 并交人工过目；本 change 的 PR 里出现即视为越界
