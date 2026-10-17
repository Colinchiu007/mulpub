# 第 3 轮：前端轴重跑（opencode，收窄范围后交付）

前两轮的记录在 `r1-*`（决策层 claude，8 条）与 `r2-*`（QM-6 后端 claude，22 条）。前端轴第一次跑 rc=0 却没交 findings（只回会话状态），收窄到 3 个文件 + 强制 `finding`/`falsifiable_proof` 双字段非空后交付 **6 条（2 critical / 3 high / 1 medium）**，原件 `r3-findings-frontend-opencode.json`。

**这轮的价值不在条数，在于它抓到的是一条元缺陷**：我前两轮每次都只改 `design.md`，没把修订传导到 `specs/` 与 `_TEMPLATE.md`，于是规格从三个方向独立复现了同一个裂口——

| 条 | 内容 | 处置 |
|---|---|---|
| F1 critical | spec 三处写「**首次**把它加入基线」，而 design 已按 GIT-1 实验改成「取**最近一次** A」 ⇒ 按 spec 实现就是让被判过死刑的 first-wins 从规格侧复活 | spec 三处原文改为"最近一次"，并在归属 Requirement 里写明取向与理由；openspec-integration 同一条同步 |
| F2 critical | 「登记字段」三方打架：spec 要求未收口必须携带、D5 禁止新记录写、模板默认预填 ⇒ 下一个会话照任一读法都违反另一条 | spec 把该 Scenario 作用域收到"**已在基线上**的兼容档记录"，并显式禁止新形态用登记字段换豁免（新记录走 byDesign）；模板改动并入 4.3 |
| F3 high | D5 把字段卫生收窄到"做过闭合断言的记录"，但 spec 全文没有一个字提字段卫生 ⇒ 只读 spec 的实现会全量执行，21 篇存量当场变红，违反本 change 自己的「存量零漂移」 | 在 Requirement 正文加作用域条款（含 21 篇这个数与理由），断言通道命中或"派生命中且状态列仍写闭合词"才受约束 |
| F4 high | 模板第 28 行改"由门禁推导"后，第 8/9/10–12 行自相矛盾（删除触发器永不触发、豁免句对纯派生记录不成立、默认预填与 D5 相反、证据列还写着人工回填） | tasks 4.3 重写为"四处必须一次改完"，逐行列出正解与禁止 |
| F5 high | 断言通道触发条件两处不一致：spec 说"派生不可用时"，design 链是"派生不成立即落 blobClosed" ⇒ `NO_FOOTER` 与「PR 不在账本」两种情形**两通道都不适用，判定悬空**；同一场景三种读法三个结论 | spec 改为"派生通道不成立时**一律**进入断言通道（含三情形）"，并新增 Scenario「派生不成立的三种情形都必须落到断言通道，不得悬空」；design 把 `PR(n)∉ledger` 定性为"取证不一致 ⇒ 出声 + 走断言通道"，不再写"按未收口处理" |
| F6 medium | 新词只活在 design，spec 里 `derivedClosed/blobClosed/NOT_IN_BASE/NO_FOOTER` 出现 0 次 ⇒ 只按 spec 实现必然把三态塌成两态（正是 M2b 防的那格）；另 D1 原文"人不写任何状态字段"与仓规里"状态列"字面撞车，会被读成"这一行可以不写"，与 D2 直接冲突 | 三态定义写进 spec 正文；D1 改为"不写任何**登记字段**"并补一句与"状态列仍必须存在"的区分；`ABSENT` 更名 `NOT_IN_BASE`，与 `missingRow`（行不存在）不再共用"不存在"字面 |

4.8（`plan-review.sh` 产物目录撞名）经用户拍板**并入本 PR**，修法与配套锁写在该条内。

## 方法论回读（写给下一个会话）

评审轮次之间必须做一次「**修订传导面**」检查：本轮三条 critical/high（F1/F3/F5）全部属于"设计已改、规格未改"，而不是新的设计缺陷。改一处判据语义时，传导面清单是固定的四处：`design.md` → `specs/<capability>/spec.md` → `openspec/records/_TEMPLATE.md` → `AGENTS.md`。少改任一处，CI 不会红（这三份都是文档），但下一个照 spec 或模板干活的人会实现出已被否证的形态。本条同步写入 learnings。
