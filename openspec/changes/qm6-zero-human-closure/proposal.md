# Proposal: 把高危面收口的"谁来签字"换成"可重放的证据"（qm6-zero-human-closure）

> **读法提示**：本文所有数字都是**当场实测**，同一批取源于 `origin/main@a12f60512`（2026-10-23）。
> 主干每天前进几十笔，产物枚数、PR 时延分布、语料条数都是**活数**——每条都附了重取命令。
> **本会话现场演示过一次**：同一条命令相隔约 25 秒两次实测，已合并 PR **203 → 205 笔**、
> 记录 **703 → 706 篇**、评审产物 **1975 → 1980 枚**、近 60 笔 PR 的 p90 时延 **10.11h → 7.92h**。
> 引用时**现跑**，不要把本文当现状——这正是第 3 刀要把读数收进可重放语料的动机。

## Why

用户目标是明确的：**高危面的收口全过程零人工**。但今天做不到，而且有**两个互不相同的**病根，
混在一起谈就会开出错的药。分开写：

### 病根一：收口出口在"评审发现了严重问题"这条路径上结构上不存在（tasks 11.7）

这不是"某次评审没过"，是一条**闭环的逻辑链**，四个环节都在仓内、可逐环节复核：

1. 高危面（`scripts/check-pr-exec-record.js:605` 的 `HIGH_RISK_SURFACES`，当场 `require` 读出 **10 条**）
   上的收口**只认** `deepReview.tier=external` + 可核 `evidence`（同文件 `:690` `closureCorroboration`、
   `:1178`/`:1193` 的红文案与判据本体）。
2. 全仓**唯一**会写 `tier` 的生产方是 `scripts/ccg-review-writeback.js`（change `qm6-closure-writeback` D2），
   它要求**五条合取**同时成立，其中第 ③ 条是 `deepReview.performedBy` 与本轮 `reviewBackends.critic` **逐字相等**。
3. 评审引擎在**仍有 Critical 未决**时降级为自扮演，把 `performedBy` 写成 `self-play…`
   （现场形状实测：`.ccg/reviews/fff39f5b31e2….json` 的 `status=cleared`、
   `performedBy="self-play(claude critic) + agent adjudication"`、`tier` 键**根本不存在**）。
4. ⇒ 合取 ③ 永不成立 ⇒ 自扮演收口**永远拿不到** `tier=external` ⇒ 只要评审真发现了严重问题，
   高危面 PR 就**没有任何机械出口**。

PR #4261 就是这条链的第一次实证：CI 唯一失败格是 `Gate 2b11 - QM-6 closure writeback chain`
（run `39847244091`），红因是本片上游那条"高危面零外部证据判据"打在它自己身上。
`QG Changes=FAILURE`  while 其余 required 格全绿——**闸门是好的，出口是空的**。
存量规模也由普查工具当场给出：主干已闭环产物 **339 条**，其中 **`tier=self-play` 收口 40 条**
（这 40 条今天全部不具备高危面资格）、`tier` 整段缺席 **202 条**、`unrecognized` 3 条
（重取：`node scripts/ccg-artifact-shape-survey.js --ref=origin/main`）。

于是今天实际发生的事情是：**逼人补字段**。这正是收口矩阵原本要防的动作。

### 病根二：即便加了出口，也没有东西能发现"出口被悄悄改宽"

AGENTS 把"改 `HIGH_RISK_SURFACES` / `CI_IGNORED_PATHS` / 分支保护"划成**必须人工过目**，
它守的不是"改的人水平不够"，而是**没有任何机械判据能区分"合理的收窄/放宽"和"为了让自己的 PR 过而放宽"**。
所以：

> **只要"判据变宽不可被机器发现"这个前提还在，"零人工"就只能靠把人工闸门挪到别处——那不叫消除，叫转移。**

本提案的核心判断是：**先造那台探测器（第 3 刀），再撤那道人工闸门（第 1 刀转拦）**。
顺序反了就是拆锁。这条顺序是本 change 的第一约束，写进 design §3，不接受"两刀一起做省一轮"的合并。

### 为什么不选另外三条显然的路

| 备选 | 否证 |
| --- | --- |
| (a) 自扮演时也写 `tier=external` | 等于把"外部评审过"这句话的**真值**改成由被评审者自己声明。这是本仓反复定性的「装饰性门禁」最纯粹的形态。 |
| (b) 把 `self_play_resolved` 从高危面闭环白名单摘掉（`:738`） | 高危面在"评审发现问题"路径上变成**永久不可合入**，且第 3 环节没有任何替代出口。比现状更糟。 |
| (c) 保留人工签字，只是流程上做提醒 | 用户目标就是不要这一步；而且提醒类纪律（"自觉"）在本仓已被反复证明挡不住（AGENTS R0 那段原话：「写进记忆、文档与提交信息都没能阻止第 5 次」）。 |

**tasks 11.7 里登记的三个候选（a)/(b)/(c) 就是上面三条**，本提案是**第四个**：不改出口的真值来源，
而是**换收口判据的问句**——从"谁签的字"换成"每条严重意见有没有可重放的处置凭证"。

## What Changes

范围**只有两刀**，且刻意不做其余四刀（不做的原因逐条写进 design §9，不是"以后再说"）。

### D1 每条评审意见的处置必须是封闭分档，且凭证按档机械可核

实测产物形状给了现成的接缝：`deepReview.findings` 是数组，每条键为
`id | severity | verdict | title | evidence`（`.ccg/reviews/fff39f5b31e2….json`，当场读，6 条）。
`evidence` 是**评审方提出这条意见的依据**，不是**本仓对这条意见的处置**——两者今天混在一个字段里，
所以"处置过"和"处置得对不对"在产物上无法区分。

D1 给每条 finding 增加一个**封闭分档**的 `resolution`，四档各自要一种**可重放**的凭证：

| 档 | 语义 | 机械凭证 | 高危面 Critical |
| --- | --- | --- | --- |
| `code-fix` | 按意见改了代码 | `redThenGreen`：点名一条回归锁，**修复前必须红、修复后必须绿**两个读数。本仓已有可复用形态（`scripts/*.mutation.js` 两例：`check-schedule-failure-watch.mutation.js`、`cleanup-artifacts.mutation.js`） | 接受 |
| `false-positive` | 意见不成立，有反证 | **不在本 change 定义否证要求**：`rebuttalRef.fingerprint` 必须命中同一记录 `rebuttals[]` 里的那条指纹（该清单的"必须带可核证据"由在飞的 PR **#4297** 独占持有）；命中不到 ⇒ 新档 `dangling-rebuttal-ref`，一律拦 | 第 1 刀仅**留痕**，转拦在第 4 刀 |
| `deferred` | 承认成立、本刀不做 | 指向本 change `tasks.md` 里**一条未勾**的行（可核：该行存在且未勾） | 接受（deferred 本身就是出口） |
| `unsupported` / `accepted-risk` | 无处置 / 认了 | — | **一律拦** |

**这一刀把"高危面不得自扮演收口"变成"高危面每条 Critical 都要有可重放的处置"**，
于是 11.7 的结构性冲突在 `code-fix` 与 `deferred` 两档上被消掉——这两档都不需要任何人签字，
也不需要伪造外部评审。

### D3 判据回归语料差分：让"改宽"当场红、且改不动

一台能自己跑的探测器，替代"有人看着别把闸门改松"：

- **语料** `scripts/qm6-judgment-corpus.jsonl`：**只可追加**。每条 = 一个真实历史案例的
  **输入面**（`statuses` 数组、被注入的产物 `deepReview` 字段、merge-base 指针）
  + **旧判据在录制当时给出的命中集读数**。
  种子可回填的规模当场实测：主干 `#4xxx` 段已合并 PR **205 笔**
  （`git log origin/main --grep='(#4[0-9][0-9][0-9])$' --oneline | wc -l`）、
  `openspec/records/` **706 篇**、`.ccg/reviews/*.json` **1980 枚**
  （`git ls-tree -r --name-only origin/main -- .ccg/reviews/ | grep -c '\.json$'`）。
- **可行性不是假设**：判据**已经**接受全注入的输入面——
  `scripts/check-pr-exec-record.js:256` 的 `evaluate()` 参数是纯数据（注释原文：
  "输入全是数据，不碰 git、不碰网络"），CLI 已有 `--statuses=<json>`（同文件 `:29` 用法行），
  `:991` 的 `evaluateDeepReviewDebt(statuses, repo, readAtBase, existsAt)` 后两参是注入的读取器。
  决策层同理（`scripts/ccg-review-decider.js:532` `judge(staged)`）。
  ⇒ **D3 不需要为可重放而重构生产代码**，只需要一个重放驱动器。
  旧判据那一份实现怎么取也有先例：`ccg-review-decider.test.js:1269` 注释写明了
  「读源码 → 剥掉最后那行 `process.exit` → 注入 `module.exports` → `_compile`」这条注入路。
- **判据**：`node scripts/check-qm6-judgment-regression.js` 对每条语料跑两遍（base blob 的判据 vs 当前判据），
  要求 **`新命中集 ⊇ 旧命中集`**。任何一条"旧命中、新不命中" = 判据变宽 = 红，并点名那条语料
  （它是一次真实历史事故，不是构造的夹具）。
- **退役漏洞的机械闭合**：语料"只可追加"自己防不住"删掉一条没人依赖的条目"。所以再加一条独立不变量——
  **每条守门规则（逐个高危面前缀、`tier` 五档、五条合取的每条）在语料里的命中计数不得下降**。
  删掉某条唯一覆盖某规则的案例 ⇒ 该规则计数下降 ⇒ 红。这把"删除覆盖率"从"看不见"变成"必报数"。

### 明确不做（本片范围外，逐条给理由）

- **跨家族共识的自动组装**（原第 4 刀）：`false-positive` 档在高危面**只留痕不转拦**。
  原因：组装器要求同一实例跑两个后端，实测时长与失败形态还没量（design §9 列了三个我拒绝猜的数）。
- **严重度夹具集 + 评审 prompt 纳入守门面**（原第 5 刀）：它防的是"LLM 判据变松"，
  而 LLM 输出**不可重放**，因此不能进 D3 的超集判据，只能另建夹具。硬塞进来会把 D3 的判据变成散文比对。
- **统计异常自动收紧**（原第 6 刀）：依赖第 4、5 刀的数据面。
- **不改 `HIGH_RISK_SURFACES` 的内容**（10 条一字不动）。D3 是给这 10 条**加探测器**，不是扩表；
  扩表仍属"改谁来守门"。tasks 11.6（`scripts/lib/ccg-delivery-digest.js` 等 4 个库文件不在任何表内）
  是**独立欠账**，本 change 不顺手做——理由见 design §9 表内该行与 §0 的边界表。

## 与本家族在飞三片的边界（这片不是凭空立项的）

同一条链上今天有三片 OPEN：

| 片 | 关系 |
| --- | --- |
| **#4261**（守门面单一真源 + 高危面唯一机械出口） | 本 change 的 D3 守门面维度取它的单源 ⇒ **建立在它之上**，不得在它之前落地 |
| **#4148**（写回第三刀） | 它的 QM-6 收口经用户 2026-10-23 裁决**保持未闭合交人工**。本 change **不为它开后门**，也不得被读成"#4148 解决了" |
| **#4297**（已否证清单 + 跨调用轮次上限） | **本 change 就是它留议未裁决的"第 1 条"**——该 proposal 的《不做什么》明文把"收口从『没有 Critical』改成『每条 Critical 都有可核处置』"排除出去、注明需单独裁决。它的 spec 另有一条 Requirement 叫「本 change 不得改变什么算闭合」，正是把这一格交给本 change |

因此两条**继承而非选择**的硬约束（#4297 已实测，本 change 不得重新踩）：

1. **判定记录名是内容寻址** ⇒ 任何计数/状态不得挂在记录名上（八轮换过 6 个名字，挂上去的计数器每次归零且全程看着正常）。
   D3 的覆盖维度键取守门维度，结构性不引用记录名。
2. **跨调用状态账必须落受管可见路径**（`.ccg/reviews/` 子目录不被 pre-commit 的 `:(glob).ccg/reviews/*.json` 收走，
   `*` 不跨 `/`）⇒ D3 的重放运行账落 `openspec/changes/<change>/judgment-replay-runs.json`。

以及一条**不造第二份事实**的收敛：D1 的 `false-positive` 档**不在本 change 定义否证要求**，
只要求 `rebuttalRef.fingerprint` 命中 `rebuttals[]`（那份清单的证据规则由 #4297 独占）。

## 成本（实测，用于判断"这套机制值不值"）

| 量 | 读数 | 重取方式 |
| --- | --- | --- |
| 近 60 笔已合并 PR 的交付时长 | 相隔约 25 秒两次实测：**p50 1.59h / p90 10.11h / max 17.79h（>12h 4 笔）** → **p50 1.54h / p90 7.92h / max 17.79h（>12h 3 笔）**。取后一组为现值，前一组留作漂移证据 | `gh pr list -R Colinchiu007/mulpub --state merged --limit 60 --json number,createdAt,mergedAt`（自行按 `mergedAt-createdAt` 取分位数） |
| enforce 判据单次耗时 | 约 **8s/PR**（本日早前实测，属**待重取**档：见 tasks 0.3） | `time node scripts/check-pr-exec-record.js --base=<merge^> --head=<merge> --mode=enforce` |
| 判据自身测试全量 | **193s** | `node --test scripts/check-pr-exec-record.test.js` |
| 40 条语料重放 | ≈**5 分钟串行**，可并行、可按选择集裁剪 | tasks 3.2 落一条自带读数的基准命令 |

结论口径：**D3 的成本落在"改了判据的那一次提交"上，不落在每个 PR 上**（语料只在守门面命中时全跑，
否则跑选择集）。也就是说它增加的是"想改闸门"的成本——而那正是我们要付的成本。
D1 的成本落在"处置一条严重意见"上：`redThenGreen` 双读数是本仓已经在做的事（变异反证），
D1 只是让它**留下产物上可重放的痕迹**。

## 验收（本 change 算做成的判据）

1. 一条高危面 Critical 可以**不经任何人工补字段**收口：走 `code-fix` + `redThenGreen`，
   enforce 判据 `RC=0`，且把 `redThenGreen` 摘掉必须**指名变红**。
2. 把任一守门规则改宽（例：把 `scripts/check-` 前缀改成 `scripts/check-pr`）在语料上必须**当场红**，
   并点名至少一条真实历史案例。
3. 删掉语料里唯一覆盖某条规则的那条案例必须**因覆盖计数下降而红**（不是因条数下降而红——那只防得住批量删）。
4. #4261 的 11.7 冲突在 D1 落地后有出口，且该出口**不写 `tier`**（不伪造外部评审）。

## 残余风险（不假装已闭合）

- **自指仍在**：`check-qm6-judgment-regression.js` 本身落在 `scripts/check-` 高危面上，
  它的判据由语料重放，而语料由它读。D3 把"悄悄改宽"变成"**改宽必须能被重放复现且当场红**"，
  不是"改宽不可能发生"。这个区别必须如实读——它也正是本 change 只撤一半人工闸门的原因。
- **LLM 侧不可重放**：D3 的超集判据只对**仓内机械判据**成立。评审模型换代、prompt 改版造成的判据漂移
  落在第 5 刀，本片**不覆盖**，不得读成"已闭合"。
- **第 4 刀未做时，高危面的 `false-positive` 档仍是人工出口**：这是有意的留口，
  它的存在本身由普查工具单列读数（`scripts/ccg-artifact-shape-survey.js` 已有 `[self-play×外部复核]` 行）。
