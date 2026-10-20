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
4. 该记录由本次驱动刚产出（按记录路径 + sha 归属，不许翻历史产物顶替）。

第 3 条是**引擎自己的口径**（`externalReviewSatisfied` 在 `:446-448` 写的就是
「期望值由驱动写进模板，不由填写方自选」）。本片把它搬到写入方侧，
且**期望值必须由上层显式透传**——本仓有一条同族教训：*多层回退链的定位键必须由上层显式透传，漏传不报错、中间两级成死代码*。
这里透传断了不会抛异常，只会让第 3 条恒假 ⇒ 写回器静默不写 ⇒ 又回到手写。所以第 3 条必须有自己的出声与用例。

### D3 `evidence` 用可就地重算的交付摘要，而不是自述指针

现有五档形态里只有 `path` 能真验证（`git cat-file -e`），其余四档
（`pr`/`session`/`uuid`/`oid`）指向仓外对象，**离线判据无法核真伪**（`:747-759` 的注释自己写着"只能继续按形状判"）。

本片新增第六档 `delivery@<sha256>`：值 = 对该记录自己的 `findings` 数组规范化后的 sha256。
判据拿到它时**重算并逐字符比对**，于它成为第二档可就地验证的形态。

这条把造假成本从「写一个词 `cleared`」抬到「伪造一份条数、内容、后端名三者互相对得上的评审正文」。
**它不是签名**，措辞上也不许写成"防伪造"——强度边界沿用引擎自己在 `:431-433` 写下的那句话
（形状 + 一致性判据，不联网核真伪）。真正的绑定是 tasks 8.1（联网核验），单独立片。

规范化实现 MUST 只有一份（`scripts/lib/` 下一个模块），写回器与判据 require 同一文件，
并配接线锁——摘要算法抄两份是这道判据最省力的腐化方式（两侧算出的值不同 ⇒ 合规产物反被判 unverified）。

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
