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

三条后果，任一足以否决"改引擎"这条路（2026-10-21 全部重量过；命令与对象 id 随文给出，均可离线复现）：

1. **本仓门禁会依赖一个不在本仓、由 nacos 技能同步分发、各机器版本可以不同的文件**。
   比"没有锚点"更准的形态是：**锚点存在，但被消费的字节不等于锚点字节**。
   `adversarial-review-loop` 在 `skill-repo` 里是一个 **submodule（gitlink，mode 160000）**，
   外层记录 commit `fe8a518…`，内层 HEAD 也确实等于它；**但**工作树里那份
   `ccg-deep-review.js` 相对该 HEAD 是 **+49/−3 未提交**（blob `57ef9590…` → `a2842b93…`）。
   本仓对"门禁消费外部产物"的既有纪律是**必须绑字节 SHA-256 且漂移即 fail closed**
   （先例：Logto webhook 补丁）。这两层 id 此刻**没有出现在本仓任何产物里**，
   所以守的仍是"某台机器此刻恰好是那个版本"——本仓对这种门禁的定名是**装饰性门禁**。
   而且该仓会被 nacos 同步继续推进（今天 `mtime 2026-10-20 18:00` 就是同步时刻），
   **一次 `git checkout --` 或一次同步就能把下面第 2 条说的那份补丁冲掉**。
   三条复现命令（`<SR>` = `git -C ~/.claude/skills/adversarial-review-loop rev-parse --show-toplevel` 的输出）：
   `git -C <SR>/.. ls-tree HEAD adversarial-review-loop` ⇒ 首列 `160000`；
   `git -C <SR> diff --numstat -- scripts/ccg-deep-review.js` ⇒ `49 3 …`；
   `git -C <SR> rev-parse HEAD:scripts/ccg-deep-review.js` 对照 `git hash-object scripts/ccg-deep-review.js` ⇒ 两个不同 id。
2. **tasks 5.1 打算逐字对账的那两个符号，只活在这份未提交补丁里**：
   `externalReviewSatisfied` 在 HEAD 版命中 **0**、工作树命中 **4**；`EXTERNAL_EVIDENCE_RE` 命中 **0 / 3**
   （命令：`git -C <SR> show HEAD:scripts/ccg-deep-review.js | grep -ac externalReviewSatisfied`）。
   好消息是 §4 能复用它的判据口径，不必另发明；坏消息是那个"它"是**一次同步就消失的东西**，
   而别的机器（含 CI runner）本来就没有它。⇒ **5.2 的"引擎不可读出声"必须扩成两档**：
   `parity=skipped(engine-absent)`（文件读不到）与 `parity=skipped(symbol-absent:<名>)`
   （文件在、符号不在），两者文案与计数分开；把后者并入前者，等于让"上游同步把补丁冲掉"
   这一整类事故在日志里读起来像"这台机器没装技能"——那是两种完全不同的待办。
   （原记在这里的"本机补丁新增 exports"那条事实并入本条，行号 `:1261-1264` 随补丁一起未入任何 git。）
3. 因此本片把"写 `tier`"这件事放进**本仓版本控制、可被 CI 真跑**的位置：
   `scripts/deep-review.sh` 调用后由 `scripts/ccg-review-writeback.js` 写。
   引擎继续只管它已经管的事（跑对抗、写 `status`/`performedBy`/`findings`）。

> **本切片不解决"要不要把引擎 vendoring 进仓"**——那是 tasks 8.2 的独立决策（改"谁来守门"，人工过目）。
> 本片只做一件不依赖该决策就有价值的事：**让合规的产物有一个机器生产者**。

## 2. 立项读数（每条带命令，活数一律现跑）

| 读数 | 值 | 复现命令 |
| --- | --- | --- |
| 驱动出口形态 | 4 条 `exec node "$DRIVER" …`，位于 `:855 :857 :876 :878`（2026-10-21 于本切片基点 `eda41eb0e` 取，并在 `ef81036a8` 复核同值。**上一版写的 `:850 :852 :859 :861` 隔 3 笔合并漂了 5 行** ⇒ 行号只能现取，引用即过期） | `grep -n 'exec node "$DRIVER"' scripts/deep-review.sh` |
| 引擎对 `deepReview` 的赋值 | **1 处**（`:520` `rec.deepReview = deepReview`），无合并式写回 | `grep -n 'deepReview' <引擎绝对路径>`；`grep -c 'rec.deepReview = {\|\.\.\.rec\.deepReview' <引擎>` = 0 |
| 引擎成功收口写的键 | `required,status,performedBy,findings,minScore,at` —— **无 `tier`、无 `evidence`** | `sed -n '1252,1256p' <引擎>` |
| 引擎全文关键字命中 | `tier`=0、`sessionId`=0、`ses_`=0、`durationMs`=0、`exitCode`=0 | `grep -ao <词> <引擎> \| wc -l` |
| 仓侧初始化 | `buildDeepReviewInit()`（`ccg-review-decider.js:641-650`）写了 `tier:"unknown"`、`evidence:null`、`findings:null` | `grep -n -A 9 'function buildDeepReviewInit' scripts/ccg-review-decider.js` |
| 产物总体 | `.ccg/reviews` 受管 json **1664** 份（读不到/解析失败 2 ⇒ 参与统计 1662），`deepReview.tier` 缺席 **1282/1662** | `node scripts/ccg-artifact-shape-survey.js --ref=origin/main` 首行与 `[丙的前提]` 行（2026-10-21 于 `origin/main@ef81036a8`） |
| 闭环 × tier 交叉（**已由工具承载，不再是手工探针**） | 已闭环 **243**：无 `tier` **178**、`external` **33**、`self-play` **23**、`unknown` **6**、闭集外野值 **3**；未闭环 **1419**：无 `tier` **1104**、`unknown` **315**；全库带 `tier` **380**（其中闭集外野值 **3**） | 同上一条命令，看交叉表与 `[闭环×tier]` 行。工具自报它落在哪个 commit（`REF=origin/main@<9位>`），因为主干在并发合并——**同一条命令隔 4 分钟两次读数 1658 → 1662**，不带 sha 的数无法归因 |
| ↳ 口径变更说明（**不得把 22 读成降到 3**） | 旧那行是手工探针，按 `{external, unknown, 其它}` 三档分桶，「其它」里同时装着 `self-play` 与真野值；工具改按**判据自己的词表**分桶（闭集 = `CLOSED_DEEP_REVIEW_STATUSES` × `classifyEvidenceTier`），于是 `self-play` **23** 被单列出来、真野值只剩 **3**。两个数不可比，可比的是「闭集外野值 = 3」这一档 | 定义见 `scripts/ccg-artifact-shape-survey.js` 的 `vocabOfJudgeAuthority`；它不抄词表，而是向判据问一次 |

**这张表的读法（QM-6 i3 之后补写）**：`值` 列是**现场快照**，含取数当时的行号与条数，会随主干前进而失效，
它不构成证据；`复现命令` 列才是判据。两列不可混读——把「`:855 :857 :876 :878`」当证据引用，就等于引用一个
已经漂过 5 行的坐标（本表上一版正是这么写的）。所以任何下游文档要引这些数，**只引命令、并现跑**；
需要可锚定的身份时用对象 id 而不是行号：`git hash-object scripts/deep-review.sh` 与
`grep -n 'exec node "$DRIVER"' scripts/deep-review.sh` 同屏打一次，行号只在当次读数里有意义。

**最后一条是本片最硬的动因**：全库带 `tier` 的 380 份里，闭环态 `external` 只有 **33** 份，而仓内没有任何生产方写 `tier`（上面四行读数合起来就是证明）
⇒ **这 33 份逐条都是会话手写的**；另有 **3** 份写着闭集之外的野值（`unrecognized`，判据对**新增**一律拦，对**存量**不会再扫——它们是历史产物，只在被再次改动进变更集时才进入判定面，这一档如实记在 §8 遗留里）。
这不是"有人作弊"，是**结构要求由判据提出、结构却无人生产**的可预期结果。

## 3. 决策

### D1 驱动侧写回点：`exec` 必须换成"调用 + 捕获 rc + 写回 + 原样退出"

现状是 `exec` 替换进程镜像 ⇒ 评审结束后本仓代码没有任何执行点。**四条 `exec` 出口里只有真跑的那两条**改成「调用 + 捕获 rc + 写回 + 原样退出」；`--dry-run` 那两条分支（连同 `DRY_NO_DRIVER` 早退）**保持 `exec` 且不引入写回**——dry-run 不该产生交付物，这条既有语义不动。落点由实现片定稿（`run_driver_with_writeback`，`scripts/deep-review-entry-rc.test.js` 的 ⑦ 就是钉「dry-run 里不得出现写回步骤」）。

**为什么先讲 rc**：`exec` 时代入的退出码就是引擎的退出码，而本仓多把锁（`deep-review-deps.test.js`、
行为锁那批）断言的正是入口 rc。改成调用后，"写回成功"绝不能把 rc=1 洗成 rc=0——
`escalated`（引擎 `:1240-1249` 返回 1）必须照旧是 1。所以实现顺序是：先补一条"三种 rc 各跑一遍入口"的
行为锁，再动代码（示踪弹先行）。

### D2 写入条件是五元合取，缺哪条报哪条

`tier:"external"` 只在**同时**满足时写：

1. `status ∈ CLOSED_DEEP_REVIEW_STATUSES`（复用判据那份闭集，不另列）；
2. `findings` 是数组且长度 > 0；
3. `performedBy` **逐字等于**同一份记录的 `reviewBackends.critic`；
4. 该记录由**本次**驱动刚产出。机制（评审第 1 轮 i3 命中"没给实现"；第 2 轮 codex i1 又命中"给了也不成立"，见下）：
   **三条同时成立才算本次产出，并各自出声**——
   ⓪ **动手前的状态必须拿得到**（实现片自查抓到：原实现写成 `if (beforeSha && 不等)`，`beforeSha` 为空时整格跳过并照样把条件名打进 spoke —— **给一个没验证过的条件打勾**）。取不到 ⇒ `before-state-missing`，不写、不猜、不打点：盘上躺着的可能是**上一轮**的合法闭环交付，与"本次刚交付"在字节层面完全同形；
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

1. 写回器的正确性**先由测试证明**（tasks 1.1/2.2/3.x 用假驱动 + 注入记录，不需要真外部评审就能验**五条件**与摘要重算——
   条件数随 §7 i1/i6 从 4 涨到 5，spec 与 D2 已改，这一行当时漏改，2026-10-21 一致性自检抓到）；
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
| i8 | Info | **本片不引入任何开关（env 与旗标都不加）**。评审要的"要关就得留痕"是对的，但今天**没有任何人要关这一步**：写回是旁路、失败不改评审 rc、也不动既有产物，加一个 `--writeback-dry` 等于给"跳过 QM-6 收口"新增一条可被误用而无人核对的通道——本仓对未使用的旁路开关有一致否决（同 pre-commit 不加 SKIP env）。原方案里"旗标要出现在产物里"还有一条自相矛盾：dry 的语义是不落盘，而写旗标本身就是落盘 | 现状：无开关。真需要排障通道时，MUST 做成**显式旗标**（进命令行、进日志行），MUST NOT 做成 env；这条留给下一个碰它的人，不是本片的实现项。tasks 9.7 按此改写 |

**这一轮的账要算到实处**：codex 有 3 条 Critical 全落在"实现机制是否真成立"上（i1/i2/i6），最低维度分 4 是三轮里最低的一次——
单家族那轮（§6）没抓到条件 4 被时间戳满足这一条。
分数仍未达收敛线（引擎判据：无 Critical 且无未解决 High），**所以这份方案还是没盖章**；
差别在于：现在两个家族都看过了，剩下的是实现期的事，不是"还有没有第二双眼睛"的事。

## 8. 收口那一次真外部复核：自反检验的实测结果（2026-10-22）

§5 那条内部一致性检验写的是「**本片自己的收口必须由本片落地的驱动写回产出**；如果最后还要手写 `tier`，
说明写回器没真跑通」。2026-10-22 把它真跑了一次。结论是：**检验成立，但它成立的方式和我原先想的不一样**。

1. **载荷可复现，不需要重建提交**：判定记录名是**内容寻址**（`stagedDiffHash`，64 位 hex），不是 commit sha。
   主干那枚 squash 提交 `72f371925` 的非 `.ccg` diff 逐字哈希回同一个名字 ⇒ 入口第三条查找路径直接命中，
   深审对着的就是当初那份 2987 行。这一点原先没有任何文档写过（本仓的会话一直以为"分支没了就得重建"），本节补上。
2. **写回器按合同拒写两次，两次都拒得对**：第一次记录状态 `self_play_pending`（不在闭环白名单）⇒ `not-closed`；
   填完裁决重跑 ⇒ 引擎收口为 `self_play_resolved`，但 `performedBy="self-play"`，合取③期望本轮 critic `claude` ⇒ `backend-mismatch`。
   两次拒写期间既有产物逐字不变、评审 rc 未被改写 ⇒ 旁路语义与「不改 rc」这两条合同第一次在**真实调用路径**上生效过，
   而不只是夹具里绿（这正是 tasks 9.1/10.1 那一刀要的现场证据）。
3. **被否证的那半**：`tier=external` 没有"由写回器自动产出"。原因是结构性的——自扮演出口的记录级 `performedBy` 是 `self-play`，
   与合取③互斥（登记为 tasks 11.5）。**自扮演收口的记录本来就不该盖 external**，所以要改的不是写回器，
   而是 §5 那句话的适用范围：它只在「引擎按严重度或正常收敛路径出终态（`performedBy` 等于 critic）」那一档成立。
4. **本片实际的收口形态**：`status=self_play_resolved` + `closureNote`（第 4 轮标记 + 4 条逐条处置 + 那条高危项的外部复核三格），
   `tier` 字段**缺席**（判据读成 `unknown`）。本 PR 变更集只含 `openspec/`，不命中高危面前缀 ⇒ 按 #3987 立的矩阵，
   `closureNote` 在这一档够用；而"缺席不拦、野值一律拦"这个分档本来就是量出来的（主干 142 篇已闭环产物里 139 篇整段没有 `tier`）。
5. **顺带被外部复核纠正的一处自我低估**：8.7 原本记成"某文件漏登记一行前缀"，外部复核指出真问题是
   `RULES.sensitivePaths` 与 `HIGH_RISK_SURFACES` 两张守门表没有同步机制——`scripts/check-` 在表内、它消费的 `scripts/lib/ccg-delivery-` 在表外。
   已按实测改记为 tasks 11.1；8.7 的历史文本不改写，只在新条目里写明取代关系。

> **编号说明**：本节与下一节直接沿用 tasks §12/§13 的编号，所以本文件在 §8 之后没有 §9–§11——
> 那三格从没存在过，不是被谁删掉的。主干那代把收口账编成了 §8，本刀两篇账要与之同号才好用，就空出了这一档。

## 12. 真跑一轮之后发现的第三件事，与本片的实际落点（2026-10-22）

### 12.1 真跑读数（被评审的提交 `dfb4a5dd3`）

`sh scripts/deep-review.sh` 现场：判定 DUAL（本笔 2296 行 / 基线 origin/main 3015 行）、
`proposer=opencode critic=claude 通过`、critic 交付 8 条（Critical 3 / Warning 3 / Info 2）最低分 4，
引擎终态 `status=self_play reason=selfPlay` ⇒ 落 `self_play_pending`；写回器点名
`backend-mismatch | not-closed | empty-findings` 且 rc=3 **未**改写入口 rc（入口 0）。
8 条的逐条处置：i1/i2/i3 采纳（见 tasks §12 表），i4/i5 采纳一半（i5 的时序前提被实测否证：快照本就排在驱动之前），
i6/i8 已满足（补行号指针），i7 否证（`changes` 作业有 `timeout-minutes: 5`），并把真实成本写成两机读数。

### 12.2 验证层那五条在机械上凑不齐（本片的第三刀）

三条判据：① vendor 源码里验证层单轮跑完只交 `convergenceDecision`，那函数只认 `minScore >= scoreThreshold`
⇒ 出 `status="converged"`，而本仓闭集是 `{cleared, needs_revision, self_play_resolved}`；② 按**字段**分别计数（外部深审第 3 轮 i7 要求带 ref，命令一并给）：
`git rev-parse origin/main` = `96ef1b2e2c6649aa203f7eaad96a8c5950d9dc1a`，`.ccg/reviews` 下 json 共 1836 份；
`git grep -l '"status": "converged"' origin/main -- .ccg/reviews` → **0 份**；`"stoppedBy": "converged"` → **3 份**（那 3 份 status 已是 `cleared`，出自决策层）。
我原先写的"converged 出现 0 次"把这两种口径混成了一句话——可达性论证只依赖前者，现在分开写并附可重跑命令。③ 五条件同时成立只有 **11 份**，其中 `layer=decision` 仅 3 份，其余 8 份无 `layer` 字段
（其中 5 份已自带 `tier=external` —— 正是会话手写的形状）。

> ⚠ **我自己报错的一处，留痕**：向用户汇报时我说过"11 份全部来自决策层"。实测是 3 决策 + 8 手写。
> 我把"引擎只在决策层产这种形状"（源码判据，成立）当成了"存量产物都来自决策层"（产物判据，当时没跑）。

处置（用户 2026-10-22 拍板：改仓外引擎）：vendor 验证层按**严重度**出 `cleared`/`needs_revision`，
与它自己决策层早已在用的那套词汇对齐（`cfgForMode` 注释原文就写着"放行改由无 Critical 且无未解决 High 决定"，
只是从没落到验证层）。不新增状态名、不动本仓闭集、有 Critical 时照旧走 self_play/escalated。
两处如实的边界：critic 的 severity 白名单是 `Critical/Warning/Info`（`model-call.js`），所以 `High` 今天不出现，
`needs_revision` 实际不可达；而 critique 一条问题都没有时 `findings=[]`，写回器按 `empty-findings` 拒 ——
那一格要别的证据形态，留后续片。能力**不在本仓 diff 里**（技能升级会静默带回旧形态），
所以判据一律现读：`ccg-convergence-probe.js` 第 ⑤ 格真 require 驱动、真调用那个函数（三档退出码不混，P9 四格）。

### 12.3 与主干另一代实现的分叉

真跑之后回到分支时发现：#4151 已把本片的一条**并行世代**实现送进主干（函数名 `run_driver_with_writeback`、
返回形状 `{wrote, reason, spoke}`、CI 态夹具已自带 wrapper/后端桩）。我的分支那代用的是另一套形状，
整取过去会删掉主干 1767 行（实测 `git diff --numstat`）。所以本片改成净差量重放：只补主干没有的格
（`--writeback-dry` 与 dry 档还原、`DECLINE_REASONS` 与规格那张表、作用域判据、探针 ⑤ 与 P9）。
**留一个未裁决的分叉给人看**：主干那代把「拒绝写入 ⇒ 逐字节不变」钉成锁，而规格 Requirement 要求
「判据能区分『补过初值未升级』与『字段整段消失』」—— 两者不能同时成立（要区分就得落盘）。
本片不擅自翻转既有锁，只把该档在规格里标成 no-op 并登记待裁决。

## 13. 第 3 轮外部深审：出口从"装饰性"变成"可达"之后，又被打穿的那两格（2026-10-22）

### 13.1 现场读数（不是复述，是本机真跑）

`sh scripts/deep-review.sh`（HEAD=`083599b94`）：判定记录按内容寻址命中 `550a0208…` ⇒ `mode=dual` ⇒
critic=claude 交付 8 条（Critical 2 / Warning 3 / Info 3），最低维度分 4 ⇒ `收敛判定: status=self_play reason=selfPlay`，
生成裁决模板 5 条（其中 `i5` 带 `domains=["crypto"]`，`expectedExternalBackend=claude`）⇒ 未填裁决 ⇒
`status=self_play_pending` ⇒ 写回器 `未写回 reason=not-closed` ⇒ `DR_RC=0`。

两条结论：① 本片要防的那件事**在真链路上点亮了**——五条件不齐时它一个字不写，且点名缺哪一条；
② 有 Critical 时本补丁**不越权替人裁决**（`verificationSeverityVerdict` 返 `null` 交回三档），所以"跑一次真评审"
在**评审没做完**的情况下本来就不该出 `tier=external`。这两件事合起来才是 tasks 7.2 要的证据。

### 13.2 三条被推翻/被收窄的设计断言

1. **「验证层无 Critical 时能出 `needs_revision`」被否证**（i3）。`High` 不在 vendor 的严重度白名单里，
   那条分支永远到不了 ⇒ 验证层的可达终态只有 `cleared`。修法上我拒绝了"往白名单加档"（那改的是模型的输出合同，
   属改谁来守门），改成删死分支 + 把白名单内容钉进 P9 断言。
2. **「dry 档已做到逐字不变」原来是半句空话**（i5）。它只保证"写回器自己不写"，还原那一步的判据取的是
   `cp` 的返回码——而返回码证明的是"没报错"，不是"盘上就是那份"。现改为还原后再算一次哈希与动手前比对。
3. **「§12 那组变异读数算交付证据」被否证**（i2）。第一代驱动的锚点在本代树上命中 0，
   旧数只是"曾经真跑过"的历史事实，不能顶替本代的反证。已在 tasks §12 就地改写成演进链，并新增 §13 交付账。

### 13.3 仍未裁决的（交人工）

- ~~`normalize-only` 那一档要不要真把初值键落盘~~ —— **已被 §14 的 i2 裁决取代**（规格现写明「只在内存补、MUST NOT 落盘」）。此行留着是为了标出取代关系，不改写它当时的记录。
- 更强的作用域判据要不要以"迁 8 个夹具文件（当场实测；此数估错过，见 tasks 8.8 的命令）"为代价实现（tasks 8.8）。
- 高危面上"只能经自扮演收口"那一格（tasks 11.5）——本轮又给了一条现场：`083599b94` 这枚提交命中的
  正是 `scripts/ccg-review-` / `scripts/deep-review` 两条前缀，而它这一轮的收口只能靠再跑一次真评审。
  本刀对 11.5 的影响要说准：**没动**那三个候选中的任何一个，也**没让**自扮演收口拿到 `tier=external`
  （`performedBy=self-play` 与合取③的互斥照旧成立，那是设计意图）。它补的是第四种现实——验证层按严重度
  出终态时 `performedBy` 逐字就是本轮 critic，于是"高危面完全没有机械出口"在**无 Critical** 那一档被打通；
  有 Critical 时照旧落 self_play/escalated，所以 11.5 这一格**没有被本片清偿**，认领时不得把本刀写成它的解法。

## 14. 第 4 轮外部深审（跑在 `ebe10ff8e`）：三条 Critical 的归因与一处裁决（2026-10-22）

> 现场：critic=claude 交付 8 条（Critical 3 / Warning 3 / Info 2），最低维度分未达线 ⇒ `status=self_play`，
> 裁决模板 6 条待填 ⇒ 未填 ⇒ `self_play_pending` ⇒ 写回器 `reason=not-closed`，`DR_RC=0`。
> **同一条合同第二次在真链路上点亮**（第一次是第 3 轮）：这里不是"评审没跑"，是"评审没做完"。

| 意见 | 归因 | 处置 |
| --- | --- | --- |
| i1 Critical「探针 `require(vendor.driver)` 无路径限制，vendor 被换即 RCE」 | **信任边界没新增**（驱动本来就被 `deep-review.sh` 用 node 执行），但"解析时按候选根、加载前不复核"确实是一格空档 | 已补：`vendorRoots()` 成单一实现，`require` 前对 `fs.realpathSync(driver)` 做许可根包含判定，不在根内 ⇒ `capable=null`（**失明档 rc=2**）并点名「不在许可根内」。行为锁 = P9 新增格 E（含"拒绝加载时不得已经调用过那个函数"这条 `cases` 缺席断言）。**没锁到的一格点名**：许可根内放符号链接逃出去这一形态，本机（Windows 非特权）造不出 symlink ⇒ 由 realpath 本身负责，实测留给能造 symlink 的 runner（CI ubuntu） |
| i2 Critical「normalize-only 两代读法互斥 = 契约矛盾」 | **改判：这是措辞问题，不是契约矛盾**。两代实现做的事相同（内存补键后返回，不落盘），被 `①②③` 三条"文件逐字节不变"用例锁住；含糊的是规格里那句「只按 init 补初值」没说不说落盘 | **已裁决并写进规格**：`MUST NOT 落盘`。裁决理由是"落盘与 CI 上跑的三条用例直接矛盾"，不是偏好。§12.3 当年记的分叉**不改写**（那是历史事实），本节点名取代它 |
| i3 Critical「作用域判据刻意跳过父两级 `.ccg/reviews`，留下任意 `.json` 可写」 | 前提半真：判据的**消费者是入口自己算出的 `$REC`**，不是外部输入；这一格防的是"上层断链"而不是"用户输入"。更强的父级判据已登记 tasks 8.8，其前提是先迁 8 个夹具文件（第 6 轮 i8 之后实测；"约 30"是没量过的估数） | **不当场采纳**（第 3 轮 i4 已要求"实现或正式登记"，登记已在）。这里补的是**风险归因**：写范围的实际边界由 `record-unreadable`/内容条件共同限住（§12b 的诱饵用例：域内一个合规 `.json` 若内容条件不过，字节照旧不动） |
| i4 Warning「`DECLINE_REASONS` 与规格表同文只靠手工锁，可能漂」 | **前提不成立**：§12d 那条就是机械对账（解析规格表逐行、与常量做集合相等），且 `ccg-review-writeback.test.js` 已接进 CI（`grep -c` 在 `quality-gate.yml` = 1） | 否证；把这条的证据（CI 接线）写在本表里，免得下次又要人去找 |
| i5 Warning「`cp` 之后再算哈希，两者之间有并发写窗口 ⇒ 假 `verified`」 | **真的那一半**：窗口在 shell 里消不掉（任何"读共享文件再比"都有窗口）。能做的是把"信任 cp 返回码"换成"信任哈希对账"——后者至少能**发现**不一致，前者连发现都不能 | 部分采纳：保留哈希对账，`mismatch` 时保留快照不删并打印两侧哈希；无并发夹具 ⇒ 该支路无执行锁，已在 tasks §13 与记录里点名 |
| i6 Warning「design 里混了自我纠错与规格，界限不清」 | 与本仓既有惯例相反：design §4 就叫「被否证 / 被拒绝的方案（写了免得有人重走）」，自我否证**是**这份文档的功能；契约在 spec.md，现场在 records/ | 否证（保留现场），但接受它背后的诉求：新事实一律写在 §13/§14 这种**带轮次编号**的节里，不回头改历史节 |
| i7 Info「每次调用都 `delete require.cache` + require，开销大」 | 这个探针一次 PR 只跑一遍（Gate 2b6），缓存复用反而会把"上一份 vendor"读成"这一份"——正是它要防的漂移 | 否证 |
| i8 Info「分开计数了，但底层计数逻辑还是错的」 | 底层没有计数逻辑可错：本仓不产 `converged`，那两句是对 **vendor 产物**的两个不同字段的现测读数（命令与 ref 已附）。"逻辑错"没有指向任何一处代码 | 否证；若指 design §12.2 的措辞，那一行已按字段改写 |

### 14.1 这一轮对 tasks 11.5 的影响（不许写成已清偿）

i1/i2 都不改 11.5。本刀改的是**另一头**：验证层无 Critical 时 `performedBy` 逐字是本轮 critic，
所以高危面第一次有了机械出口；**有 Critical 时**照旧落 self_play/escalated，11.5 那一格原样留着。
连跑两轮都含 Critical（第 3 轮 2 条、第 4 轮 3 条）这件事本身是下一条结论的来源：
本片把"能不能出 external"从结构上打通了，但"这一轮评审是否零 Critical"不由本片决定 ——
**收口仍未闭合**，如实交给人工（tasks 7.4 的"不自动合并"这一档）。

## 15. 第 5 轮外部深审（跑在 `95d13f431`）：三条 Critical 里只有一条是我的（2026-10-22）

> 现场：critic=claude 交付 8 条（Critical 3 / Warning 3 / Info 2），最低维度分 **3**（四轮里最低：4 → 4 → 3），
> 待裁决 6 条、**这次没有高危域条目需要外部复核** ⇒ `self_play_pending` ⇒ 写回器 `reason=not-closed`，`DR_RC=0`。

| 意见 | 归因 | 处置 |
| --- | --- | --- |
| i1 Critical「判定记录 `sha` 是父提交、与提案 head 不符」 | 第 3、4 轮同一件事的第三次复发。`sha` 按 decider 设计就是 pre-commit 时的 HEAD；记录**名**才是内容键，而入口正是靠它命中的 | 不采纳修法（"按 head 重生成"在 pre-commit 时刻不可执行），真实缺口是 tasks 8.6 那条配对锁 |
| i2 Critical「`DECLINE_REASONS` 导出了但 `applyWriteback` 仍逐处写字符串名」 | **这条是真的，而且打的是我自己写的规格**——规格里那句「处置 MUST 由一张表持有，MUST NOT 散在 if 链里」当时只落成"导出常量 + 一条对账用例"，实现侧一名源仍散在 11 个 return 里 | **已修**：新增 `decline(name, spoke, detail)` 助手，所有拒写出口必须过它；名字不在表内**当场抛**（表成了唯一名源，改错名不再靠用例事后发现）。既有 26 条用例逐条复跑，reason 字符串逐字未变 ⇒ 行为不变、真源收敛 |
| i3 Critical「`vendorRoots` 含不受信的 `CCG_ARL_DIR`；realpath 只挡符号链接，不挡根内恶意文件」 | 信任模型如此：那张目录里的东西**本来就被入口用 node 执行**（`deep-review.sh` 调驱动），探针没新增边界；路径白名单无法防"被信任的目录里放了坏文件"——那要靠制品签名，属 vendoring 决策（tasks 8.2） | 否证其修法；把"realpath 只解决符号链接这一格"继续写在 §14 表 i1 行与 tasks 14.3 里，不写成"已防住恶意文件" |
| i4 Warning「规格里 normalize-only 那格仍有 PENDING-ARBITRATION」 | 规格侧已改；残留的是 **design §13.3 那条待办** | 已在原行上标注「已被 §14 取代」——历史行留着，取代关系写明 |
| i5 Warning「`deep-review.sh` 用 Linux `sha256sum`，win32 上会挂」 | 前提不成立：该脚本按设计只由 Git Bash 执行（入口级锁 `deep-review-entry-rc.test.js` 自己解析 bash 并断言必须跑起来），Windows 上有 coreutils；本仓的 CI 跑在 ubuntu/windows runner 两条面，入口锁在 runner 上实跑 | 否证 |
| i6 Warning「探针复核 driver 却不复核 engine」 | **真的那一半**：`readVendorSources` 会读 engine.js，探针不执行它但会读它 | 已修：engine 的 realpath 同样必须在许可根内，否则 `capable=null`（失明档） |
| i7 Info「根内判定里那条等值式几乎恒假」 | 真的：等值式是 `startsWith(root + sep)` 的子集，留着等于加一条不起作用的分支 | 已修：删等值式，只留 `startsWith`，并写明为什么只留一条 |
| i8 Info「`.ccg/reviews` 里 `layer=diff` 的记录与文件角色不符」 | 那是 decider 的既有 schema（`layer` 指判定发生在动手前还是动手后），不是本刀引入 | 否证 |

### 15.1 四轮读数的形状（把"每轮都有 Critical"这件事本身变成读数）

| 轮 | 载荷 | 条数 | Critical | 最低分 | 收口 |
| --- | --- | --- | --- | --- | --- |
| 3 | `083599b94` | 8 | 2 | 4 | `self_play_pending` ⇒ 写回器拒写 |
| 4 | `ebe10ff8e` | 8 | 3 | —（未达线） | 同上 |
| 5 | `95d13f431` | 8 | 3 | 3 | 同上（本轮起无高危域条目） |

机械出口仍然只有一条：**一轮零 Critical**。本片已把"能不能出 external"从结构上打通（验证层无 Critical 时
`performedBy` 逐字是本轮 critic），但每轮都还能挑出条目——其中两条（i2/i6）确实是我的错并已修。
把这条写成结论而不是过程：**收口未闭合，交人工**（tasks 14.5 / 7.4），不手写 `tier`/`evidence`。

## 16. 第 6 轮外部深审（跑在 `b4f2cf99c`）：抓到一处我自己制造的表间漏洞（2026-10-23）

> 现场：8 条（Critical 3 / Warning 3 / Info 2），最低维度分 security **2**（六轮里最低），
> 待裁决 6 条、无高危域条目 ⇒ `self_play_pending` ⇒ 写回器 `reason=not-closed`，`DR_RC=0`。

| 意见 | 归因 | 处置 |
| --- | --- | --- |
| i3 Critical「`dry-run` 这个名字既不在 `DECLINE_REASONS` 也不在规格表」 | **成立，而且是本刀自己制造的**：第 4 轮我把处置收敛成一张表并加同文锁，但只登记了"缺件"那一类；`--dry` 的出口名字确实会出现在输出里，却从两张表之间漏走 ⇒ 一个"只认表名"的消费者撞上它时没有任何出处可对 | **已修**：新增 `NON_DECLINE_OUTCOMES`（导出），`dry-run` 由常量持有；同文锁改成**三份名源一起对账**（规格表 ↔ 拒写表 ↔ 非拒写出口），并加一条"代码会出声而规格没写的名"反向差集断言；规格表补一行写明它不是缺件 |
| i7 Info「`startsWith(root + path.sep)` 在 Windows 混 `/` 与 `\` 时误放/误拒」 | 真的：realpath 给 ``，而 Git Bash 递进来的可能是 `/`，混着比会把同一目录判成两个 | 已修：`pathSegmentsUnder()` 按任意分隔符切段再比前缀（只归一、不放宽——仍要求严格在根**内**，等长不算） |
| i8 Info「8.8 说约 30 处夹具却没列文件名」 | **比指控更严重的一半它自己没说出来**：那个 30 从来没量过。当场实测是 **8 个**写记录形状夹具的文件（另两个相关口径 3 / 7），三个数各代表不同问题 | 已改成"实测数 + 三条可重取命令"，并写明此前是估数 —— 引用时现跑，别抄数 |
| i1 / i2 Critical「`vendorRoots` 含 `CCG_ARL_DIR`，realpath 与之自指 ⇒ 环境注入即可执行恶意 vendor」 | 判断正确、结论不是本刀能收的：许可根与复核根**同一张表**当然是自指——但自指不是漏洞，**根的可信性**才是，而那由"谁设置这个环境变量"决定；同一个目录里的驱动本来就被 `deep-review.sh` 用 node 执行（探针没新增边界）。要真收口必须做字节锚点/vendoring，那就是 tasks 8.2 | 不当场采纳（修法在另一刀）；把这句写进 8.2 的动因：**realpath 判定防的是"解析结果被搬走"，不防"被信任的目录里放了坏文件"，两者不得混写成同一件事** |
| i4 / i5 Warning（design 混历史与活规格、变更面 1137 行认知负荷） | 与本仓惯例相反（§4 就叫「被否证 / 被拒绝的方案」；轮次编号节正是为了"历史不改写、新事实另起一节"）；变更面大是三刀合一的必然（拆分只会让 dual 产物配对更糟） | 否证，但接受背后诉求：所有活规格句子只写进 `specs/`，design 的轮次节不承担合同 |
| i6 Warning（作用域判据偏弱，登记 8.8） | 第 3、4 轮同一件事第三次复发 | 不重复处置，指向 8.8 |

### 16.1 六轮的形状（这条比任何单轮结论都重要）

| 轮 | Critical | 最低分 | 其中"确实是我的" |
| --- | --- | --- | --- |
| 3 | 2 | 4 | 0（旧数当证据 = 流程缺陷，已修） |
| 4 | 3 | 未达线 | 1（i2 normalize-only 措辞） |
| 5 | 3 | 3 | 2（i2 表没有执行体、i6 engine 没复核） |
| 6 | 3 | **2** | 1（i3 `dry-run` 从两张表之间漏走） |

每轮都抓到一条真的，且**都是修上一轮改动引入的那一格**（收敛名源时没收全、加复核时只复核一半）。
这不是"评审在挑刺"，是"每刀的边角需要下一刀看见"——也正是 11.5 那一格在现实里的样子：
**要闭合就得继续跑，而继续跑就还会出 Critical**。收口状态见 tasks 14.5，仍交人工。

## 17. 第 7 轮外部深审（跑在 `30f93fa0c`）：一条我自己写错的成因（2026-10-23）

> 现场：7 条（Critical 3 / Warning 3 / Info 1），维度分 correctness 6 / security 6 / performance 8 / maintainability 4
> ——比第 6 轮的 security 2 抬升，但 Critical 仍为 3 ⇒ `self_play_pending` ⇒ 写回器 `reason=not-closed`，`DR_RC=0`。

### 17.1 我写错的一处成因（本轮唯一"确实是我的"且前六轮没人指出）

规格里那句「要区分『补过初值未升级』与『字段整段消失』就得落盘」是**错的归因**。落不落盘都不区分：
`classifyEvidenceTier` 对 `!dr`、键缺席、`tier=null|undefined`、`tier="unknown"` 一律回 `unknown`，
而且这一映射早已被"丙 classifyEvidenceTier"那条闭集四档锁逐形状钉住。
所以第 5 轮我"裁决" normalize-only 时，其实是把一个**判据侧的固有折叠**当成了写回器侧的选择来处理——
裁决的方向（MUST NOT 落盘）仍然成立（它由三条 CI 锁的字节不变用例支撑），但**理由写错了**，
而错理由会把下一个读者推向"那就落盘吧"这个不必要且与既有锁冲突的方向。已按实测改写规格那段与该条 AND，
并把"要真分档"登记为 tasks 8.9（改判据本体，人工过目）。

### 17.2 本轮其余处置

- i2（Critical，`vendorRoots` + realpath 仍被要求当安全边界）：第四度复发。判断对、结论不在本刀：
  根的可信性由"谁设这个环境变量"决定，而同目录里的驱动本来就被入口用 node 执行 ⇒ 真收口 = tasks 8.2（字节锚点/vendoring）。
- i3（Critical，design 混排）与第 4 轮 i6、第 6 轮 i4 同一条：与本仓惯例相反，§4 就叫「被否证 / 被拒绝的方案」；
  活规格一律只写在 `specs/`，本文件按轮次编号分节正是为了"历史不改写"。
- i4（Warning，判定记录 `sha` 指父提交）：第四度复发，指向 tasks 8.6。
- i5（Warning，8/3/7 三个实测数没有下界锁）：**成立的流程批评**——数会被下一次重构漂掉。
  本刀不加"锁住三个 grep 计数"的判据（那等于把一次性测量变成常驻门禁，且它守的是文档里的数），
  改为在 8.8 与 8.9 都附**可重取命令**并写明"引用时现跑，别抄数"。若你要机械锁，正解是给 8.8 的迁移做进度登记（另一刀）。
- i6（Warning，P9 在测试里改 `process.env` 并真 require vendor）：环境改在 `finally` 复原、夹具用 `mkdtemp`；
  "真跑 vendor"是这把锁的**全部意义**（结构锁看不见函数会不会被调用）。崩溃残留属所有 mkdtemp 夹具共性，不单独加清理守护。
- i7（Info，要不要回改历史产物里的 `dry-run`）：实测主干 `.ccg/reviews` 里 `"reason": "dry-run"` 出现 **0 次**
  （旗标是本 PR 才引入的，从没落过盘）⇒ 无存量可修，命令：`git grep -l '"reason": "dry-run"' origin/main -- .ccg/reviews | wc -l` → 0。

### 17.3 七轮的形状（这条比任何单轮结论都重要）

| 轮 | Critical | security | 确实是我的 |
| --- | --- | --- | --- |
| 3 | 2 | — | 0 |
| 4 | 3 | — | 1 |
| 5 | 3 | 3 | 2 |
| 6 | 3 | **2** | 1 |
| 7 | 3 | 6 | 1（成因写错，非行为错）|

security 分从 2 抬回 6，说明第 6 轮那两条真修到位了；而 Critical 恒为 2–3，**内容越来越偏"归因与文档"，
越来越少是行为缺陷**。收口状态不变：仍未闭合，机械出口只有一条（一轮零 Critical），交人工。

## 18. 第 8 轮外部深审（跑在 `3d997f45f`）：四条 Critical 里两条是事实错误（2026-10-23）

> 现场：8 条（Critical 4 / Warning 2 / Info 2），维度分 correctness 5 / security 4 / performance 7 / maintainability 4。
> 八轮里 security 走 2 → 6 → 4：第 6 轮那两条修完抬回 6，第 8 轮又掉——**它量的是"这一轮挑出的安全味条目数"，
> 不是"代码变差了"**。把这条曲线读成趋势是本仓最容易犯的第二次错（第一次是把孤立读数当定律）。

| 意见 | 归因 | 处置 |
| --- | --- | --- |
| i1 / i2（Critical）许可根可投毒、realpath 不验完整性；作用域判据只两格 | 第 4～8 轮同一件事的第五度复发。前者真收口 = 字节锚点/vendoring（tasks 8.2，改外部制品归属，人工过目）；后者登记 tasks 8.8 | 不当场采纳，指向编号项 |
| i3 Critical「`ccg-convergence-probe.test.js` 在未定义处用 `found`，且改全局 env 无清理」 | **事实错误**：`found` 在第 30 行模块级定义（`const found = probe.locateVendor();`），P9 第 35/56/86 行只是用它做分档；env 改动一律在 `try/finally` 里复原（格 A、格 E 各一处），临时目录同在 `finally` 删除 | 否证，并附行号 —— 评审给的"未定义变量"这类指控，唯一处置是当场读那一行，不是顺着改代码 |
| i4 Critical「`normalize-only` 仍未裁决：规格里还留着 `PENDING-ARBITRATION`」 | **事实错误**：`grep -n PENDING-ARBITRATION openspec/.../specs/qm6-closure-writeback/spec.md` **0 命中**（第 7 轮已把标记换成裁决与成因）。它看到的标记在 design/tasks 的**历史引用**里（§14/§15 那几行是在引述当时怎么写的） | 否证；历史文本不改写这条是本 change 的既定纪律（§13.3 只加"已被取代"标注，不删原文） |
| i5 Warning「`_wb_snap` 没有 trap 清理，异常退出会漏快照」 | **成立且是本机真实发生过的**：外层 10 分钟上限杀掉评审时，快照永久留在 TMPDIR；而它是"dry 档改没改产物"的唯一底本 | 已修：`trap ... EXIT`（`rm -f` 幂等、不改退出码 ⇒ 旁路合同不动）。**这一档没有行为锁**：唯一可观察结果是"TMPDIR 少一个文件"，共享目录上做数量断言本身不稳；rc 由 ⑧ 守、内容对账由 ⑫ 守，两处修完后实测 `2/2 pass` |
| i6 Warning「`capable!==true` 的文案让失明档也去重打补丁」 | **不成立**：`capable===null` 在第 221–223 行已 `return 2` 并打「探针失明」，永远走不到第 285 行那段"重打 vendor 补丁"的文案 | 否证，附行号 |
| i7 / i8 Info（design 混排；main 先读全量源码再做能力检查） | 前者同第 4/6 轮；后者是 IO 微优化，且"先把参数读齐、失败一次报齐"是刻意的（读不出默认值要 rc=2，顺序反了会把两种故障混成一档） | 否证 |

### 18.1 我对这条循环的判断（写在这里免得被读成"再跑跑就好了"）

八轮之后，剩下的 Critical 只剩两类：**反复要求把 realpath/白名单当安全边界**（真解在 tasks 8.2 的制品锚点）
与**事实错误**（本轮 4 条 Critical 里占 2 条）。继续跑第九轮，最可能产出的还是这两类。
所以本片在此停手交人工：机械出口（一轮零 Critical）在"评审把 vendoring 当本片责任"这个前提下不存在。
如果要把这条闭合，正解是**先做 tasks 8.2**（把引擎按字节锚点搬进仓内，漂移即 fail closed），
再回来跑收口——那是顺序问题，不是努力问题。
