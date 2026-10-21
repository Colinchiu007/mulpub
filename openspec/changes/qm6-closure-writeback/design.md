# design: qm6-closure-writeback

## 1. 落点偏差：8.1b 原写「落点在仓外引擎」，本片改落仓内驱动

`ccg-review-degradation-ladder` tasks 8.1b 的原文是「落点在仓外
（`~/.claude/skills/.../ccg-deep-review.js`，或把引擎收进仓内再改），因此这一条不是本仓单 PR 能闭合的」。
本片否证了「改仓外那份」这个默认前提，**证据是路径链本身**（当场重取，命令附后）：

```
$ ls -ld ~/.claude/skills/adversarial-review-loop
lrwxrwxrwx ... -> /c/Users/<用户>/.nacos-cli/skill-sync/profiles/default/skill-repo/adversarial-review-loop/
$ readlink -f ~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js
<同步盘根>/100-Agent-data/skill-repo/adversarial-review-loop/scripts/ccg-deep-review.js
$ git -C ~/.claude/skills/adversarial-review-loop rev-parse --show-toplevel
<同一个同步盘根>/100-Agent-data/skill-repo/adversarial-review-loop
$ git -C <本仓> ls-files | grep ccg-deep-review      # 只有规格文档，无实现副本
openspec/changes/ccg-convergence-exit/specs/ccg-deep-review-convergence/spec.md
```

> 上面两行的盘符写成占位符，是因为 Gate 12c 禁止受管文档新增本机绝对路径。
> **该值不是孤立读数**：任何机器上一条命令就能重取——
> `git -C ~/.claude/skills/adversarial-review-loop rev-parse --show-toplevel`。
> 取证力在"这条命令 + 符号链接本身"，不在那个盘符。

三条后果，任一足以否决"改引擎"这条路：

1. **本仓门禁会依赖一个不在本仓、由 nacos 技能同步分发、各机器版本可以不同的文件**，
   而 mulpub 内对它没有任何字节/哈希锚点。本仓对"门禁消费外部产物"的既有纪律是
   **必须绑字节 SHA-256 且漂移即 fail closed**（先例：Logto webhook 补丁）。没有锚点的外部依赖，
   守的是"某台机器此刻恰好是那个版本"——本仓对此的定名是**装饰性门禁**。
2. **该文件今天已被动过一次本机补丁**：`mtime 2026-10-20 18:00`，新增
   `if (require.main === module) process.exit(main()); module.exports = { blockingFromAdjudication, externalReviewSatisfied, EXTERNAL_EVIDENCE_RE }`
   （`:1261-1264`）。这既是好消息（下面 §4 能复用它的判据口径），也是坏消息：
   **一处未入本仓git的行为改动已经存在**，而 CI runner 上这个文件干脆不存在
   （`deep-review.sh:536-544` 那段 2026-10-17 修复就是为此而写）。
3. 因此本片把"写 `tier`"这件事放进**本仓版本控制、可被 CI 真跑**的位置：
   `scripts/deep-review.sh` 调用后由 `scripts/ccg-review-writeback.js` 写。
   引擎继续只管它已经管的事（跑对抗、写 `status`/`performedBy`/`findings`）。

> **本切片不解决"要不要把引擎 vendoring 进仓"**——那是 tasks 8.2 的独立决策（改"谁来守门"，人工过目）。
> 本片只做一件不依赖该决策就有价值的事：**让合规的产物有一个机器生产者**。

## 2. 立项读数（每条带命令，活数一律现跑）

| 读数 | 值 | 复现命令 |
| --- | --- | --- |
| 驱动出口形态 | 4 条 `exec node "$DRIVER" …`，位于 `:850 :852 :859 :861` | `grep -n 'exec node "$DRIVER"' scripts/deep-review.sh` |
| 引擎对 `deepReview` 的赋值 | **1 处**（`:520` `rec.deepReview = deepReview`），无合并式写回 | `grep -n 'deepReview' <引擎绝对路径>`；`grep -c 'rec.deepReview = {\|\.\.\.rec\.deepReview' <引擎>` = 0 |
| 引擎成功收口写的键 | `required,status,performedBy,findings,minScore,at` —— **无 `tier`、无 `evidence`** | `sed -n '1252,1256p' <引擎>` |
| 引擎全文关键字命中 | `tier`=0、`sessionId`=0、`ses_`=0、`durationMs`=0、`exitCode`=0 | `grep -ao <词> <引擎> \| wc -l` |
| 仓侧初始化 | `buildDeepReviewInit()`（`ccg-review-decider.js:641-650`）写了 `tier:"unknown"`、`evidence:null`、`findings:null` | `grep -n -A 9 'function buildDeepReviewInit' scripts/ccg-review-decider.js` |
| 产物总体 | `.ccg/reviews` 受管 json **1563** 份，其中 `deepReview.tier` **缺席 1258** | `node scripts/ccg-artifact-shape-survey.js --ref=origin/main`（末行 `[丙的前提]`） |
| 闭环 × tier 交叉（**手工一次性读，待入库**） | 已闭环 **208**；其中整段无 `tier` **157**；全库有 `tier` 的 **301** 份里 `external`=**23**、`unknown`=**256**、**闭集之外的自造值=22** | 见 tasks 0.1b：该交叉表将由 `scripts/ccg-artifact-shape-survey.js` 承载后重跑，本行是**实现片落地前的临时读数**，不得被后续会话当现状引用 |

**最后一条是本片最硬的动因**：全库 `external` 只有 23 份，而仓内没有任何生产方写 `tier`（上面四行读数合起来就是证明）
⇒ **这 23 份逐条都是会话手写的**；同时有 22 份写着闭集之外的自造值（`unrecognized`，判据一律拦）。
这不是"有人作弊"，是**结构要求由判据提出、结构却无人生产**的可预期结果。

## 3. 决策

### D1 驱动侧写回点：`exec` 必须换成"调用 + 捕获 rc + 写回 + 原样退出"

现状是 `exec` 替换进程镜像 ⇒ 评审结束后本仓代码没有任何执行点。四条出口都要改，
且 `--dry-run` 与 `DRY_NO_DRIVER` 两条分支**不引入写回**（dry-run 不该产生交付物，这条既有语义不动）。

**为什么先讲 rc**：`exec` 时代入的退出码就是引擎的退出码，而本仓多把锁（`deep-review-deps.test.js`、
行为锁那批）断言的正是入口 rc。改成调用后，"写回成功"绝不能把 rc=1 洗成 rc=0——
`escalated`（引擎 `:1240-1249` 返回 1）必须照旧是 1。所以实现顺序是：先补一条"三种 rc 各跑一遍入口"的
行为锁，再动代码（示踪弹先行）。

### D2 写入条件是四元合取，缺哪条报哪条

`tier:"external"` 只在**同时**满足时写：

1. `status ∈ CLOSED_DEEP_REVIEW_STATUSES`（复用判据那份闭集，不另列）；
2. `findings` 是数组且长度 > 0；
3. `performedBy` **逐字等于**同一份记录的 `reviewBackends.critic`；
4. 该记录由**本次**驱动刚产出。机制（评审第 1 轮 i3 命中"没给实现"；第 2 轮 codex i1 又命中"给了也不成立"，见下）：
   **两条同时成立才算本次产出，并各自出声**——
   ① **字节变了**（驱动调用前后各读一次目标记录文件原文，相等 ⇒ `no-write`：引擎这次根本没落盘）；
   ② **语义指纹变了**（对 `deepReview` **去掉 `at` 之后**做规范化摘要，前后不同才算有新交付；相同 ⇒ `no-new-delivery`）。
   只用 ① 会被时间戳单独满足：引擎每个 `writeBack` 站点都写 `at: new Date().toISOString()`（`:1255` 等），
   所以"字节变了"其实只证明"写过一次"，不证明"交付内容有变"。
   只用 ② 也不行：一轮无变化的复审（`findings` 逐字相同但 `status` 从 `escalated` 变 `cleared`）必须能写，
   所以指纹取**整个 `deepReview` 去 `at`**，而不是只取 `findings`——
   ⚠ 这与 D3 那个"证据摘要 MUST 只取 `findings`"是**两个不同的规范化**，各有一个名字、各有一条用例，
   合并成一个就是把 i7 那类"字段路径不一致"从文档搬进代码。
   不用 pid / mtime / 临时清单：pid 会复用、mtime 属跨时钟域比较（本仓「时钟判据必须同域比较」那条），
   临时清单多一套生命周期与清理失败面。
5. 记录文件**路径本身也是必须由上层显式透传的定位键**（codex i6 命中，与我自己在第 3 条立的规矩同型，
   原先只对 critic 名立了用例、漏了路径）：路径由 `deep-review.sh` 按 `--sha` 推出后作为入参传入；
   入参缺失 ⇒ 当场抛错并出声（`missing-record-path`），MUST NOT 回退成"扫目录找最近一个"或"取 HEAD sha"——
   那正是「漏传不报错、中间两级成死代码」的落点。配一条"不传路径必须出声"的用例。

第 3 条是**引擎自己的口径**（`externalReviewSatisfied` 在 `:446-448` 写的就是
「期望值由驱动写进模板，不由填写方自选」）。本片把它搬到写入方侧，
且**期望值必须由上层显式透传**——本仓有一条同族教训：*多层回退链的定位键必须由上层显式透传，漏传不报错、中间两级成死代码*。
这里透传断了不会抛异常，只会让第 3 条恒假 ⇒ 写回器静默不写 ⇒ 又回到手写。所以第 3 条必须有自己的出声与用例。

### D3 `evidence` 用可就地重算的交付摘要，而不是自述指针

现有五档形态里只有 `path` 能真验证（`git cat-file -e`），其余四档
（`pr`/`session`/`uuid`/`oid`）指向仓外对象，**离线判据无法核真伪**（`:747-759` 的注释自己写着"只能继续按形状判"）。

本片新增第六档 `delivery@<sha256>`：值 = 对该记录自己的 `findings` 数组规范化后的 sha256。
判据拿到它时**重算并逐字符比对**，于它成为第二档可就地验证的形态。

**它不是签名**，措辞上也不许写成"防伪造"——强度边界沿用引擎自己在 `:431-433` 写下的那句话
（形状 + 一致性判据，不联网核真伪）。真正的绑定是 tasks 8.1（联网核验），单独立片。

> **删掉一句我自己撑不住的话（codex i4，接受）**：原文写"把造假成本从『写一个词』抬到『伪造一份自洽正文』"。
> 该摘要**任何填写方都能用一条命令自算**（它只对本记录自己的 `findings` 取哈希，不含任何外部秘密），
> 所以"成本抬高"这个论断不成立，留着一个成本故事比不留更糟——它会让人以为这一档有力。
> 现在的表述只留两件事：**它是继 `path` 之后第二个可就地验证的形态**；
> 一致性要求"字段互相对得上"，仅此而已，**强度边界统一写成「形状 + 一致性，摘要可被任何填写方自算」**。

> **字段路径全文统一（codex i7，接受）**：判据与写回器一律用 `deepReview.findings`（不是裸 `findings`），
> 且 MUST 定义**摘要失配后的处置**：人工在评审后追加/修订 `findings` 会让 `delivery@` 必然失配 ⇒
> 判 `external-unverified` 并在红文案里给出可操作指引（"重跑评审，或由人工改回 `closureNote` 出口（非高危面）"），
> **MUST NOT 把失配说成伪造**——那是把判据算不动写成道德指控。

> **命名误读防线（评审 i4 命中，接受）**：`delivery@<hex>` 这个形状看着就像不可否认的绑定。
> 除文档外代码里也 MUST 出声：该模块文件头与形态常量旁必须有一条注释
> 「本地一致性校验，不提供身份绑定，不提供防手写能力」；判据把它降为 `external-unverified` 时
> 红文案 MUST NOT 说成「证据无效」，要说成「摘要与本记录 findings 重算值不符」——
> 后者是可核对的事实陈述，前者会让人以为存在一层并不存在的真伪判定。

规范化实现 MUST 只有一份（`scripts/lib/` 下一个模块），写回器与判据 require 同一文件，
**并把规范化规则本身写死**（评审 i2 命中：原方案只说"只有一份实现"，没定义规则。
一份实现确实挡得住两侧互不匹配，但挡不住它被改坏后无人察觉，而"改坏"最省事的方式正是键序/空白变动）：

- 输入 = 记录里 `deepReview.findings` **数组本身**，不掺其它字段（掺 `at` 会让同一次交付因时间戳产生两个摘要）；
- 对象**递归按键名码点升序**排序，数组**保持原序**（findings 的顺序是评审给的严重度序，重排即改语义）；
- 序列化 = `JSON.stringify(v, null, 0)`（无空白）；不做 trim、不剥 Unicode 空白；
- 摘要 = 对该字节串取 `sha256`，输出 64 位**小写**十六进制，形态串固定 `delivery@<hex>`；
- **一条固定行为向量**：模块自带用例，输入是写死的 findings 样本，断言输出逐字符等于写死的期望摘要。
  任何键序/空白改动都会撞这条向量。它比"要求两个消费方 require 同一文件"更硬——
  后者只防分叉，不防腐蚀。

接线锁照旧：出现第二处摘要实现即红。

### D4 `unknown` 不转拦、`single` 绕矩阵、CI 仍 advisory —— 三条残余一条都不顺手动

这三条是 #3987/#4071 明确登记的刻意取舍（缺陷G 死循环 / tasks 8.5 / tasks 8.6）。
本片只是**加了个生产者**，不改变任何一格的判定宽度。若实现时发现某条被本片顺带改宽或改严，
那属于越界，必须在评审里点出来并回退。

## 4. 被否证 / 被拒绝的方案（写了免得有人重走）

| 方案 | 结论 | 证据 |
| --- | --- | --- |
| 改引擎让它写 `tier` | **否决** | §1 的路径链与"CI 上该文件不存在"。做完本仓门禁会依赖无锚点的外部文件 |
| 判据侧加"写入方指纹"证明不是手写 | **结构上做不到** | 产物就是同一个会话写的同一个 JSON；判据没有任何独立信号能区分"工具写的"与"手填的"。这条正是 #3987 记录的「A 状态凭空伪造在判据层不可判」。**本片因此不声称能识别手写**，只让合规路径变得可比 |
| `evidence` 写 PR 评论 URL，判据联网核验真伪 | **推迟到 tasks 8.1** | 判据要网络与凭据、CI 档必须能离线降级；与本片"可就地重算"不是同一件事，混做会让 Gate 2c 在 runner 上因网络抖动摇摆 |
| 让 `pre-commit` 钩子写 `tier` | **否决** | 钩子在提交**前**跑，那时外部评审还没发生；把写入方放在钩子上等于要求"先有闭环值再去评审"，是缺陷G 那条循环的复刻 |
| vendoring 引擎进仓后一起改 | **不在本片** | 属归属决策（tasks 8.2，人工过目）。若它先行，本片 D1-D3 仍然成立且不冲突；若它永不做，本片也不依赖它 |

## 5. 自反与验收边界

- 本片同时命中 `scripts/deep-review`（驱动本体）与 `scripts/check-`（判据本体）两条高危面前缀
  ⇒ 依 #3987 立的矩阵，**不得**以 `self-play` 收口 QM-6，且**不自动合并**。
- **本片自己的收口必须由本片落地的驱动写回产出**。这是最硬的一条内部一致性检验：
  如果最后还要手写 `tier`，说明写回器没真跑通——不是"再手写一次就行"。
- QM-6 跨家族轴可能不可得（本机实测四种后端故障档）。届时如实写"单轴复审"，
  不得写成"双模型完成"，也不得借 `closureNote` 出口在**高危面**上收口（那条出口只在非高危面够用）。
- 不在本片闭合的：提交级归因（产物需带文件清单，8.1b 范围①）、`unknown` 占比下降、
  `single` 在高危面无人守（8.5）。

## 6. 设计评审第 1 轮的处置（critic=claude 交付 7 条 / Critical 3）

### 6.1 引用出处必须分两个坐标系（评审 i5，接受）

本文所有行号来自**两处不同来源**，不分开声明就会让下一个读者误以为同源：

| 引用面 | 出处 | 稳定性 | 重取命令 |
| --- | --- | --- | --- |
| 仓内（`deep-review.sh:850/852/859/861`、`ccg-review-decider.js:641-650`、`check-pr-exec-record.js:745 / 747-759`） | 写作时的 `origin/main == 87f8de7ba` | 会随 main 前进漂移 | design §2 表每条自带 `grep -n` |
| 仓外引擎（`:431-433`、`:446-448`、`:520`、`:1240-1249`、`:1252-1256`、`:1261-1264`） | **本机那一份，无版本锚点** | **不稳定且不归本仓管**——这正是 §1 拒绝把写入方放进那里的理由 | `git -C ~/.claude/skills/adversarial-review-loop rev-parse HEAD`；再看 `git -C … status --porcelain` 是否非空（非空 ⇒ 有未提交本机改动；**本次实测非空**） |

结论：**引擎那些行号只作"当时观察到什么"的说明，不作契约。** 本片实现不依赖任何引擎行号，
只依赖它产物里有哪些 JSON 字段——字段名跨版本远比行号稳。

### 6.2 自举循环（评审 i6，接受问题、拒绝两个修法）

评审指出「本片收口必须由本片落地的驱动写回产出」是自举循环——**问题是真的**，但它的两个建议都是错的出口：
`dry-run 生成模板产物`（D1 明确 dry-run 不产交付物）与 `测试预置一条合规记录作种子`
（那是把假产物喂进判据，本仓对「降级/占位产物不得冒充成功产物」有专门纪律）。

真解是承认这个循环**必须闭合在 fail-closed 上**：

1. 写回器的正确性**先由测试证明**（tasks 1.1/2.2/3.x 用假驱动 + 注入记录，不需要真外部评审就能验四条件与摘要重算）；
2. 实现片**真的跑一次** `sh scripts/deep-review.sh`，让新驱动给自己写收口；
3. **第 2 步产不出合规产物时，唯一正解是修写回器**——不得手写、不得拿第 1 步的夹具冒充第 2 步的交付、
   不得为了让 PR 过而放宽矩阵；
4. 代价如实写：写回器修好之前**这片无法合并**。这不是缺陷，是本片的目的——
   今天的状态恰恰是"卡不住，所以手写"。

### 6.3 推迟项 → 任务 → 验收标准（评审 i1，部分接受）

评审称五项推迟"均未逐条映射到任务 ID"——**这条不准确**：`8.1` 联网核验、`8.2` vendoring、
`8.3` 提交级归因、`8.4` `unknown` 占比在 tasks §8 已逐条编号，`8.5 single` / `8.6 advisory` 在 §5 有指针。
它说对的一半是**没有验收标准**："登记了"不等于"实现片不会顺手越界做掉"。补这张表：

| 推迟项 | 任务 | 验收标准（实现片越界即红） |
| --- | --- | --- |
| 联网核验 `pr`/`session`/`uuid`/`oid` | 8.1 | 本片判据代码 MUST NOT 出现任何出站调用（`gh` / `fetch` / `https.request` / `execSync('curl`）；出现即越界 |
| 引擎 vendoring 进本仓 | 8.2 | diff MUST NOT 新增引擎实现副本；`git ls-files \| grep ccg-deep-review` 结束时仍只命中规格文档 |
| 提交级归因（产物带文件清单） | 8.3 | 写回器 MUST NOT 往记录塞文件清单字段；实现片不得声称"已可提交级归因" |
| `unknown` 转拦 | 8.4 | 闭集、`HIGH_RISK_SURFACES`、`unknown` 分支三处代码在本片 diff 中零改动 |
| `single` 绕矩阵 / CI 仍 advisory | 8.5 / 8.6 | `if (rec.mode !== 'dual') continue` 与 `quality-gate.yml` 的 `--mode=advisory` 两行逐字不变 |

### 6.4 测试文件落点（评审 i7，接受）

tasks 2.2 原先只写"注入假驱动跑入口"、没指定文件——无法定位就无法接线。落点定为
**`scripts/deep-review-entry-rc.test.js`**（`node --test`，只 require 内置模块；接进 `quality-gate.yml` Gate 2b；
`.gitignore` 的 `scripts/*.js` 会吞新建脚本，须按既有惯例补 negation 并用 `git check-ignore --no-index` 当场证明没被吞）。
它同时承载 D1 那条"写回步骤不得排在 `exit` 之后"的顺序断言，所以是两把同类锁并到一个文件，不是新增第三把锁。

### 6.5 第 1 轮自身的交付现实（不是方案的缺陷，但必须记在同一处）

`sh scripts/plan-review.sh <design 副本> --force` 实跑 **rc=2**：
critic=claude **交付 7 条**（Critical 3、最低维度分 5=feasibility），未收敛后调用 proposer=opencode 逐条回应，
**proposer 因载荷超限没有跑成**——任务提示 9790 + 角色提示 147 = **9944 字符**，超 opencode 后端上限
**7800 字符**（引擎打印的实测边界 `(8125, 8145]`，非文档承诺），后端 ~120ms、exit 1、无错误信息。

⇒ 所以 §6 是**单轴（critic）意见 + 我逐条处置**，不是"跨家族对抗收敛完成"。不得把它写成 DUAL 已闭合。
proposer 那条轴要在实现片重跑：按引擎自己的对策「去掉对 reviewer 无用的内容」——
把 §2 读数表与 §4 被否证表留在仓库文档里、但从**送审副本**里剥掉（那两张表是给人核对出处的，不是评审对象），
把载荷压到 7800 以内；这属于送审输入的处理，不改仓内那份 design.md。

## 7. 跨家族那一轮（critic=codex，8 条 / Critical 3 / 最低分 4）

副本 B（3282 字符）跑 `--critic codex --proposer claude`。**codex 交付了 8 条**，回路仍 rc=2——
但失败点是引擎**自动改文那一步的校验**（proposer 给的 `before` 没逐字命中副本原文，另有多条 `accepted` 未给 edit），
**不是评审本身没发生**。所以处置照第 6 节同一条规矩：**我自己逐条改文档，不靠引擎改**。

| 条 | 严重度 | 判定 | 落点 |
| --- | --- | --- | --- |
| i1 | Critical | **接受，且它打的是我上一轮刚补的东西**。字节比对被时间戳单独满足：引擎每个 `writeBack` 站点都写 `at`（`:1255`），所以"字节变了"只证明"写过一次"。但它的替代方案（只比 `findings` 摘要）会漏掉"无变化的复审但 `status` 从 `escalated` 变 `cleared`"这一格 | D2 条件 4 改成**两条同时成立 + 各自出声**（`no-write` / `no-new-delivery`），指纹取**整个 `deepReview` 去 `at`**，并明确它与 D3 那个 findings-only 摘要是**两个不同规范化**、各有一条用例 |
| i2 | Critical | **接受**。原文只说"三种 rc 各跑一遍"，没定义信号终止：`spawnSync` 下 `status` 为 `null` 而 `signal` 有值，映射不进去就会把引擎的非零退出洗成 0 | 新增映射表：`code !== null` 取 `code`；仅 `signal` 取 `128+signo`；两者皆 `null` 一律 1。写回器整体包 `try/catch`，失败只 stderr 出声、**MUST NOT 改 rc**。进 tasks 2.2 那把锁 |
| i3 | Critical | **一半是评审输入的缺口、一半接受**。原子写与有界重试**已经在 tasks 3.3 写死**（临时文件 + rename，只对 `EPERM/EACCES/EBUSY` 退避），副本 B 没带 tasks 所以 reviewer 看不到 | 采纳它真正新增的那半：**写前比对，语义相同则跳过**（避免 mtime 抖动与无意义 diff）。同时记一条方法论：**送审副本必须自证"哪些约束在别处"**，否则会把已闭合的格当成缺口、把裁剪掉的部分当成缺失 |
| i4 | Warning | **接受，删一句我撑不住的话**。摘要只哈希本记录的 `findings`，任何填写方一条命令可自算 ⇒ "把造假成本从写一个词抬到伪造一份正文"这个成本论断不成立 | D3 删成本论断，只留"第二个可就地验证形态"；强度边界统一写「形状 + 一致性，摘要可被任何填写方自算」 |
| i5 | Warning | **接受**。写回器复用判据的 `CLOSED_DEEP_REVIEW_STATUSES`，判据侧日后放宽/收窄会**静默跟随**——正是 D4 明令不许的"改消费者即改生产者" | 写回器侧加一条**冻结快照**用例：断言该闭集逐项等于快照；闭集变动必须同次改快照并走评审（快照只能整体换、不能单边加宽） |
| i6 | Warning | **接受，而且是它自己那条规矩的反向适用**：我只对 critic 名立了"期望值必须由上层透传"，路径本身没立 | D2 新增条件 5：记录路径由入口显式透传；缺失 ⇒ `missing-record-path` 当场出声，MUST NOT 回退成"扫目录取最近一个"或"用 HEAD sha 猜" |
| i7 | Warning | **接受**。原文 `findings` 与 `deepReview.findings` 两种写法混用，且**没定义摘要失配后谁负责、判不判红**（评审后人工追加 `findings` 必然失配） | 全文统一 `deepReview.findings`；补失配处置 = 判 `external-unverified` + 可操作指引，**MUST NOT 把失配说成伪造** |
| i8 | Info | **拒绝原方案，换一个不丢留痕的形态**。env 开关的问题是"写回被关掉"这件事**不留任何痕迹**，而下一次读到 `tier` 缺席的人无法区分"没交付"与"有人关了开关"——本仓对"以 env 静默改变行为"有一致否决（先例：pre-commit 不加 SKIP env） | 改为驱动上的显式旗标 `--writeback-dry`（只打印将写什么、不落盘），**旗标出现在命令行与产物里**，而不是环境变量 |

**这一轮的账要算到实处**：codex 有 3 条 Critical 全落在"实现机制是否真成立"上（i1/i2/i6），最低维度分 4 是三轮里最低的一次——
单家族那轮（§6）没抓到条件 4 被时间戳满足这一条。
分数仍未达收敛线（引擎判据：无 Critical 且无未解决 High），**所以这份方案还是没盖章**；
差别在于：现在两个家族都看过了，剩下的是实现期的事，不是"还有没有第二双眼睛"的事。
