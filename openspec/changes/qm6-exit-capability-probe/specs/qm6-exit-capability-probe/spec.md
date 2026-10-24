# Spec: qm6-exit-capability-probe

## Requirement 1：三格收口出口的可达性必须是常驻读数，不是散文

- MUST 存在 `scripts/qm6-exit-capabilities.js`，导出三个纯谓词：`externalReviewCapable`、`upheldExitCapable`、
  `toolSignatureCapable`，输入均为源码字符串，输出均为**三档** `true / false / 'unknown'`。
  谓词住在本体之外的独立文件里，且必须出现在 `module.exports` 上（按名字逐个断言，不接受"文件还在所以没事"）。
- `scripts/ccg-convergence-probe.js` SHALL `require` 该模块并消费其读数，**不得**复制第二份谓词实现
  （复制一份就是第二个漂移源）。
- `toolSignatureCapable` 的输入 SHALL 来自仓内 `scripts/ccg-review-writeback.js`，因此该格在 CI runner 上无条件可复现
  （不依赖 vendor 引擎是否存在）。
- 读不到输入源码 ⇒ 退出码 **2** 并点名"探针失明"，**不得**把失明折叠成"不在位"；
  `'unknown'` 在结论行里必须有独立文案（它读起来像"没有出口"，含义却是"我没看见"）。

#### Scenario: vendor 已能表达外部复核，探针仍断言不可达
- **WHEN** 驱动源码里存在解除谓词的 `function` 定义，且裁决模板带期望后端字段
- **THEN** `externalReviewCapable` 为 true，结论行必须改成"填齐外部复核三格后可解除"；
  此时结论行若仍写"无条件计阻断" ⇒ 契约锁红（这一格就是 2026-10-23 主干上那条假话）

#### Scenario: 诚实标成立的那条至今没有出口
- **WHEN** 喂入当前 vendor 的真实形状（`verdict === 'upheld'` 前无任何守卫）
- **THEN** `upheldExitCapable` 必须为 **false**，并且行为真跑（无凭证 / 带凭证两份输入）两次都计阻断 —— 报"在位"才是缺陷

#### Scenario: 被声明物改名导致读不出
- **WHEN** vendor 驱动里再也找不到 `blockingFromAdjudication`
- **THEN** 该格返回 `'unknown'` 而不是 `false`，且结论行不得出现"不在位"这类结论措辞

## Requirement 2：结论行必须由读数生成，两个方向都不许写死

- stdout 那句结论 SHALL 由 `conclusionLine(caps)` 拼接；把任何一条分句改成字面量常量 ⇒ 契约锁红。
- 写死成"可达"与写死成"不可达"**都必须红**（只钉一边会诱导维护者改文案交差，而不是改判据）。
- 逐格翻转一次而结论行不变 ⇒ 红（那一格是被写死的，不是被读出来的）。
- `--json` 档的 stdout SHALL 只含 JSON：人读行一律走 stderr，且新增 `exitCapabilities`、`capabilitySource`、
  `upheldCrossCheck`、`conclusion` 四组键。

#### Scenario: 三格读数与结论不一致
- **WHEN** `exitCapabilities.upheld` 为 true 而结论行仍含"永久阻断"
- **THEN** 红，并点名是"生成器被替换成常量"这一类，而不是"结论错了"

## Requirement 3：这条读数被删掉必须被另一个文件发现

- MUST 存在 `scripts/qm6-exit-capabilities.test.js`，它只 `require` 谓词模块、不复制任何谓词实现。
- 该文件 SHALL 断言：谓词与生成器均以函数形式导出；每条谓词在**一对夹具**（在位形 / 不在位形）上答案不同。
- 该文件与探针测试都必须被 `quality-gate.yml` 的**可执行正文**点名（注释里提一句不算接线）。
- 动因是实测事故：PR #4062（一个与本主题无关的 s2v 错误码修复）携带评审前旧副本，
  把 #4067 在 `scripts/ccg-convergence-probe.js`、`scripts/ccg-convergence-probe.test.js`、
  `openspec/changes/ccg-convergence-exit/tasks.md` 三个文件里的改动**整段撤销**，
  而检测与探针同批被删 ⇒ 同文件内的锁对这类撤销结构性无效。

#### Scenario: 谓词从导出面消失
- **WHEN** 有人把某个谓词从 `module.exports` 摘掉（或删除谓词函数本体）
- **THEN** 契约锁红，且红的是"导出缺席"这一条，不是某个间接断言

#### Scenario: 谓词被改成恒真 / 恒假
- **WHEN** 任一谓词对两版夹具返回同一个值
- **THEN** 红，点名"这条谓词已无区分度"

## Requirement 4：结构读法与行为真跑互不代替，两路全瞎必须出声

- `upheld` 那一格 SHALL 同时有两路读数：结构谓词（块配对 + 守卫识别）与行为真跑
  （`require` vendor 驱动导出的 `blockingFromAdjudication`，喂"无凭证 / 带齐凭证"两份合成裁决各调一次）。
- 行为真跑**不得**用 `vm` 从源码另编译一份相似实现：有导出面可用时 `require` 拿到的才是评审链真正会调用那个函数。
- 无凭证那份若不阻断，行为档 SHALL 抛错而不是返回 true（"随便填两格就能收口"的实现不得被判成"出口在位"）。
- 行为真跑 SHALL 自带**正控**：`externalReviewReceiptLive(fn)` 用一份 vendor 自己承认的凭证（高危域那条出口读的
  `externalReview.{performedBy,evidenceRef,reviewedAt}`）证明"这份形状确实被某个分支消费"。
  正控为假 ⇒ 行为档一律返回 `'unavailable'` 而**不得**返回 `false` ——
  夹具键名没人消费时，"带凭证仍阻断"与"这条出口确实不存在"在 `false` 这个读数上完全同形。
- `crossCheckUpheld(structural, behavioral)`：两路不一致 ⇒ 进 `problems` ⇒ 退出码 **1** 并点名"结构读法失效"；
  **禁止**自动采用其中一路当结论。
- 行为档 `unavailable`（没有 vendor）与结构档 `unknown` 一律**不参与比较**且 `ok:true`，但不得被措辞成结论。
- 探针走到交叉这一步即意味着 vendor 在位；此时行为档仍取不到数 SHALL 记一条 `problems`（退出码 1）。
  缺这道守卫时，"两路全瞎"会打印成"两路一致：这条出口不在位"，与真跑确认过的句子**逐字同形**。

#### Scenario: CI runner 上没有 vendor 引擎
- **WHEN** `locateVendor()` 返回 null
- **THEN** 探针退出码 2 并点名失明，同时仍打印仓内那一格的读数；`ok` 判定不参与比较（不得把没引擎判成偏离）

#### Scenario: 结构读法与行为真跑不一致
- **WHEN** 结构谓词报 true 而带凭证那份输入实际仍计阻断
- **THEN** 退出码 1，文案点名"结构读法失效"，探针不得替它猜一个结论

#### Scenario: 调用在位但结果被常数覆盖
- **WHEN** 探针仍调用行为档函数，但把返回值写成 `'unavailable'` 常量
- **THEN** 探针测试红在"本机有 vendor 时行为档不得是 unavailable"这一条（源码形状锁查不出这一格）

## Requirement 5：本刀不得改任何一格守门语义

- MUST NOT 改动：`blockingFromAdjudication` 的行为、`scripts/ccg-review-writeback.js` 的合取条件、
  `HIGH_RISK_SURFACES`、QM-6 闭环状态词表、`CI_IGNORED_PATHS`、分支保护。
- 三格读数中任一为 false ⇒ 探针仍退出 **0**（读数如实即可；**测到"墙还在"不是失败**）。
- 只有"读数与自身证据矛盾"才退出 **1**；"取不到数"才退出 **2** —— 三档不得混用。
- 顺序合同（PR #4304 `qm6-zero-human-closure` design §3）：探测器先于拆闸；
  把"出口缺失"和"改宽不可见"两件事在同一刀里一起解决，等于在探测器存在之前先拆闸。

#### Scenario: 探针的读数为"两格墙还在"
- **WHEN** `upheldExitCapable=false` 且 `toolSignatureCapable=false`（2026-10-23 的实际现场）
- **THEN** 本 change 仍不改它们；读数进执行记录，作为后续那一刀的输入
