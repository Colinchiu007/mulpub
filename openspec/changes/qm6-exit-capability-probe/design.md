# Design: qm6-exit-capability-probe

## 1. 三格出口，各自一个纯谓词，输入都是"源码字符串"

```
externalReviewCapable(driverSrc)   → 三档  // 高危域那条能不能被"外部复核三格"解除
upheldExitCapable(driverSrc)       → 三档  // 被判成立(upheld)那条有没有解除臂
toolSignatureCapable(writebackSrc) → 三档  // 工具署 tier 有没有 performedBy 之外的第二条路
```

三个谓词的**落点是独立模块 `scripts/qm6-exit-capabilities.js`，不是探针本体**（动笔时写的是"在探针里加谓词"，实施时改的，理由是这条刀的立项事实本身）：
谓词若住在探针里，"#4067 加检测 → #4062 连检测一起撤"那种撤销会把谓词一并带走，
而探针本体被撤销时恰恰没有任何东西能发现（撤销者就是被撤销者的唯一读者）。
⇒ 谓词 + 契约锁 + 探针分住三个文件，`quality-gate.yml` 同时点名后两者，撤销任一格都会红在另一格上。

三条都是**纯函数**（同样的输入必然同样的输出），因此可以在 CI 上用夹具跑 —— 这是关键选择：
把"vendor 在不在"与"判据有没有牙"分开。vendor 缺席时探针报 rc=2（失明），但**夹具档永远跑**，
所以三格谓词本身在 CI 上是被测的，不会因为"runner 上没有引擎"而变成只在开发者机上成立的散文。

返回值是三档（`true / false / 'unknown'`），不是布尔：`'unknown'` 表示"读不出被声明物"，
它必须与 `false`（"确实没有这条出口"）在文案上可区分 —— 把工具失明读成结论是本仓反复定性的同型错误。

### 1.1 每条都必须"两版实现给出不同答案"

`#4261` 的口径：一把"是否复用某实现"的锁，必须取两版实现答案不同的输入，否则 vendored 副本会同形。
本刀把它推广到"是否存在某条解除路"：每条谓词都配一对夹具 ——

| 谓词 | 在位夹具 | 不在位夹具 |
| --- | --- | --- |
| `externalReviewCapable` | `function externalReviewSatisfied(` + 模板里 `expectedExternalBackend:` | 只有其中一格（谓词被定义但模板没写期望后端）/ 只有注释提到 |
| `upheldExitCapable` | `verdict === 'upheld'` 分支里先 `if (resolvedEvidenceSatisfied(i)) return;` | **当前 vendor 的真实形状**（push 前无任何守卫） |
| `toolSignatureCapable` | `if (dr.performedBy === expected \|\| externalDeliveryMatches(dr, expected))` | **当前仓内的真实形状**（单条件，拒签即 `backend-mismatch`） |

后两列不是编的：它们就是 2026-10-23 当场从 `~/.claude/.../ccg-deep-review.js` 与
`scripts/ccg-review-writeback.js` 读到的形状。⇒ 探针今天跑真源码，三格里两格必须报"不在位"，
**报成"在位"才是 bug**。这条不靠"把 false 钉进用例"来守（那是把一次观测钉成契约），
而由 A9 只断言"三格都读得出"、A2/A5 断言"两版夹具答案必须不同"共同守：将来 vendor 真加了臂，A9 仍绿、探针自动改口。

### 1.2 为什么 `upheldExitCapable` 不能只靠正则

`blockingFromAdjudication` 里"有没有解除臂"这件事，正则读的是**文本**，而将来那条臂可能写成
`if (i.resolution && ok(i.resolution)) return;`、也可能写成 `continue`、也可能被塞进一个 helper 调用。
所以本刀的取向：**结构谓词给结论，行为真跑给证据**，两路各测各的、互不代替。

行为真跑的取法在实施时换了（动笔时写的是 `vm` 编译，实测否证后改的）：vendor 驱动**已经把
`blockingFromAdjudication` 放进了 `module.exports`**，且它自己的 `main()` 被 `if (require.main === module)` 挡住，
所以 `require(driverPath)` 是安全且权威的 —— 拿到的是**真正会被评审链调用的那个函数**，
而不是"我从源码里编译出来的那份相似物"。先例（`ccg-review-decider.test.js:1269` 那套"读源码 → 剥 `process.exit` →
注入 `module.exports` → `_compile`"）是被迫的：那个被测脚本**没有**导出任何东西。有导出面可用时选 `vm`
等于自愿多养一份编译接缝（本刀实测：`vm` 那版当场 `Unexpected end of input`）。

喂两份合成裁决各调一次：

- A 份：一条 `verdict:'upheld'` 且**无**任何凭证 → 必须计阻断（不阻断即抛错，因为"随便填两格就能收口"
  这种实现不能被判成"出口在位"）；
- B 份：同一条但**同时**带两份凭证形状 → 计不计阻断就是这条出口在不在。
  两份形状不是冗余：`externalReview.{performedBy,evidenceRef,reviewedAt}` 是 **vendor 今天真读的那一份**
  （高危域那条出口就读它），`resolution.{resolvedBy,verifiedBy,verifiedAt}` 是"给 upheld 补一臂"最可能写的那一份。
  ⛔ **本模块最初版只写了 `resolution`，而 vendor 从不消费它** —— 于是"带凭证仍阻断"这句是在拿一份
  没有任何分支会消费的形状做测量，读到的 `false` 碰巧对，但不是量出来的。这一格由 QM-6 第一轮评审
  i2/i5 逼出（它们的安全主张并不成立，但它们让我去核对形状，形状是坏的）。

### 1.2b 正控：夹具的键名必须被证明"确实有人消费"

只测"答案不同"不够 —— 两份实现都忽略一份写错的键名时，行为档永远给 `false`，
而那个 `false` 与"真跑确认过没有出口"**逐字同形**。因此导出一条正控
`externalReviewReceiptLive(fn)`：喂一条**高危域**条目 + 那份 `externalReview` 凭证，
vendor 的高危域出口必须真的解除阻断。正控为假 ⇒ 说明凭证形状在本 vendor 上不被消费 ⇒
`upheldExitBehavioral` 一律返回 `'unavailable'` 而不是 `false`（拒绝在空夹具上给结论）。
探针把这一格作为 `exitCapabilities.receiptLive` 单独打印，⑤ 行同时报三路。
回归锁：A16（正控三档 + 键名逐个点名 + `performedBy` 不得是 self-play + `evidenceRef` 必须过 vendor 的形状判据）；
变异 n19（正控恒 true）、n20（摘掉"正控不成立即拒给结论"这道闸）。

将来 vendor 加上那一臂，B 份不阻断 ⇒ 行为读数翻成 true。**但结构读数不会自动跟着翻**：
两路不一致时探针出声（见 §1.3），而不是替那条 PR 猜一个结论。
这条设计的目的就是：把"出口有没有"变成被测量量，而不是被声明量。

### 1.3 两路不一致时**出声**，不自动翻转

原设计写过"将来 vendor 加上那一臂，B 份不阻断 ⇒ `upheldExit` 自动翻成 true"。**实施时否证了这句**：
自动翻转等于"结论来自那一路此刻恰好没瞎的读数"，而本刀的全部目的就是不再产出未经交叉验证的结论。
现在的口径是 `crossCheckUpheld(structural, behavioral)`：

- 两路一致 → `ok:true`，文案点名"两路一致"；
- 两路不一致 → `ok:false` ⇒ 探针进 `problems` ⇒ **rc=1 并点名"结构读法失效"**（真加了臂的那条 PR 必须回来改谓词，
  而不是让探针替它猜一个结论）；
- `behavioral === 'unavailable'`（CI 上没有 vendor）或 `structural === 'unknown'` → 不参与比较、`ok:true`，
  但**不得**被措辞成结论；
- 另有一道守卫堵"两路全瞎"：探针走到交叉这一步就说明 vendor 在位，此时行为档仍取不到数
  ⇒ 记一条 `problems`（rc=1）。缺这道守卫时它会报"两路一致：这条出口不在位"，与真跑确认过的句子**逐字同形**。

## 2. 结论行不得写死（这一格是本次事故的直接后件）

现在那行 stdout 是字面量：`… self-play 对 crypto 项无条件计阻断 ⇒ …不可达 …`。
#4067 删掉了它、#4062 又把它恢复回来 —— 说明"结论文本"与"读数"必须是**生成关系**而不是并列关系：

```
conclusionLine(caps) =
  caps.externalReview === 'unknown' ? "高危域条目：读不出（vendor 缺席或被改名，不得当成无出口）"
                                    : caps.externalReview ? "高危域条目：填齐外部复核三格后可解除（vendor 已能表达）"
                                                          : "高危域条目：self-play 内无出口"
  + upheld        三档同理（"带处置凭证可解除" / "诚实标 upheld ⇒ 永久阻断（机制缺口，非本 PR 缺陷）" / "读不出"）
  + toolSignature 三档同理（"自扮演收口可署 tier" / "永拿不到 tier=external（须人工补字段或全驳回）" / "读不出"）
```

`unknown` 那一档**必须有独立文案**：它和 `false` 都读起来像"没有出口"，而含义相反 ——
一个是"确实没有"，一个是"我没看见"。A6 与 A8 分别钉这两格（A8 逐格翻转一次，翻转而文案不变即红，
于是任何一格被写死都会被当场抓住）。

用例锁的方向：把结论生成器换成任何一条写死的句子 ⇒ 红（n8/n10 两条变异分别针对"写死为可达"与"写死为不可达"）。
两个方向都要钉，因为只钉一边会诱导人把文案改成另一边来交差。

## 3. 撤销检出：必须换文件

`#4067` 那条检测（P9）与探针**同批被删**，所以"同一批文件里的锁"对这类撤销结构性无效。
本刀把检出拆到**两个新文件**（动笔时规划的是一个，实施时拆成"谓词 + 契约锁"两格，理由见 §1 的落点说明）：

- `scripts/qm6-exit-capabilities.js` —— 三格纯谓词 + 行为档 + 交叉比较 + 结论生成器；
- `scripts/qm6-exit-capabilities.test.js` —— 契约锁 A1–A15，只做四件事：
  1. `require` 读数器并**按名字**逐个断言导出面在位（缺席即红 —— 这正是 #4062 那种删除的显形方式，A12）；
  2. 每条谓词跑"两版夹具"，断言答案**不同**（同形即红 —— 防"谓词被改成恒 true/恒 false"，A1/A2/A5）；
  3. 行为档与交叉比较各测一遍，且**不需要 vendor**（A13/A14 喂本地函数）；
  4. 接线自检：新锁与探针都必须被 `quality-gate.yml` 的**可执行正文**点名（A11，注释里提一句不算）。

它不碰网络、不读被 `.gitignore` 的目录（真源码档 A9 例外：vendor 缺席时只打印并跳过那一格，仓内那一格照读）
⇒ 在 CI runner 上无条件跑。探针侧另补 P10（行为档必须真的取到数）与 P11（vendor 在位而行为档失明必须 rc=1），
两格合起来才堵住"调用在位但结果被常数覆盖"这一格 —— A15 只查源码，查不出它。

## 4. 退出码沿用三档，不混档

| 码 | 含义 |
| --- | --- |
| 0 | 三格都有读数，且结论行由读数生成（读数为"不在位"也是 0 —— **测到"墙还在"不是失败**） |
| 1 | 读数与预期形状矛盾（既有那五条 ladder/形状判据），或两路交叉不一致，或 vendor 在位而行为档取不到数 |
| 2 | 探针自身取不到数（找不到 vendor、读不出必需参数、仓内写回器读不到）；vendor 缺席这一档仍打印仓内那一格的读数，不把"没引擎"混成"没有出口" |

"测到墙还在"必须是 0：否则这条常驻判据会因为**说实话**而天天红，最后被人摘掉 —— 那是本仓最贵的一种失败。

## 5. 明确不做

- 不改 `blockingFromAdjudication` / `ccg-review-writeback.js` 的任何语义（本刀只**读**它们）。
- 不做"给 upheld 加解除臂"那一刀（PR #4304 已立项，且明写顺序契约：先有探测器，再拆闸）。
  本刀交付的探测器就是那一句"先有探测器"——它把"墙在不在"变成每次 PR 都重取的读数，
  #4304 拆完闸之后不需要再改探针一行，结论行会自己改口（而两路不一致时是 rc=1 出声，见 §1.3）。
- 不改 `HIGH_RISK_SURFACES`、闭环词表、`CI_IGNORED_PATHS`、分支保护。
- 不把 #4062 的撤销做成 revert 提交（已合并历史不改写；直接前滚）。
- 不做 #4304 的 D3 语料差分（那是另一台探测器，键与数据面都不同；本刀只做"出口可达性 + 撤销检出"）。
