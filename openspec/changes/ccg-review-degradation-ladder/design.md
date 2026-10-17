# Design: ccg-review-degradation-ladder

## 0. 一处让整片变便宜的实测

`ccg-review-decider.js:459-470` 的 `detectBackends()` **已经**算出 `{wrapper, wrapperExists, claude, opencode}`（只判可执行文件在不在，注释明写"认证探测要联网，故不做"），但**没有任何一条链路把它写进判定记录**——记录体只落了 `deepReview{required,status,performedBy,findings}`（`:442-447`）。

⇒ D6「降级资格以物证为准」不需要新造探针，只需要把已经在算的东西落到产物里。同类先例：`performedBy` 也是"已经在写、没人读"。**本片的主要动作是接线，不是新增机制**——这一点决定了它的体量与风险都远低于初看时的估计。

## 1. 判据落点：把单字段判据换成二元组

新增两个仓侧纯函数（都放在 `check-pr-exec-record.js` 内，保持它「只 require node 内置模块」的接线前提，见 AGENTS.md「接进 `changes` job 的锁只能 require 内置模块」）：

```
classifyEvidenceTier(deepReview) -> 'external' | 'self-play' | 'unknown'
isHighRiskSurface(files, changedSurfaceSet) -> boolean
```

`mode=dual` 的收口矩阵（唯一真源，写进 spec）：

| 证据档 | 非高危面 | 高危面（含判据本体自指） |
|---|---|---|
| `external` ≥1 轴 | `cleared` / `needs_revision` ⇒ **闭环**（现状不变） | 同左 |
| 仅 `self-play` | `self_play_resolved` + **机械对抗产物** + **可重开欠账** ⇒ 闭环（降级态） | **一律欠账** |
| `unknown`（字段缺失/形态不认识） | **一律欠账** | **一律欠账** |

`unknown` 单列一行是刻意的：现状 `performedBy: null` 是 decider 的初值，把 `null` 读成"外部"或读成"自扮演"都会误判，必须第三档 fail-closed。这与既有「状态列只认闭合词表 `^(PASS|N/A|✅|已)`，未知写法一律未收口」是同一条纪律的复用，不是新口径。

## 2. 为什么不直接删掉 `self_play_resolved`

最省事的做法是把它从闭集里摘出去，但它一摘就同时踩两坑：

1. **撤销引擎的既有能力**：`self_play_*` 三态是引擎在轮次不收敛时的第三档出口（`:312/:1038`），摘掉等于要求"任何 dual 都必须有外部模型交付"，回到用户提的那个堵塞问题本身。
2. **把已合入的历史产物判成欠账**：records 里 `self_play_resolved` 已在用（#3617 的 18 条 findings 处置即走该出口），判据收窄后旧 PR 的产物会在新 main push 上连环保红——AGENTS.md「收尾清单第 7 条」要求回读 main，正是为了避免这类"事后追红"。

正解是**给它加前提**（产物 + 欠账 + 高危面不得用），而不是取消它。

## 3. 高危面清单：取路径前缀，不取内容指纹

判据必须是机械可复现的。两档候选：

- **内容指纹**（扫 diff 里有没有 `crypto.` / `pbkdf2` 之类字样）：records 里已有当场否证——#3747 的后端评审 #5 指出"加了内容指纹后，被塞进 `docs/` 前缀的源码仍会落到『未触及前端目录 ⇒ report-only』那一格，洞只是换了形状"。同一形状在这里复发：改 `credential-store.js` 时把敏感行挪进一个注释密集的函数，指纹判据就漏。
- **路径前缀 + 显式自指清单**（选它）：`apps/desktop/electron/services/credential-*`、`apps/desktop/electron/services/account-state-lock.js`、`packages/api-publish-engine/src/auth/*`、`packages/shared-utils/src/login-state.js`、`**/*fingerprint*`、`.github/workflows/*`、`scripts/check-*.js`（判据本体）。

如实登记**残余**：路径前缀会漏「行为变更发生在非高危路径却影响高危面」这类跨面改动。收窄方式是清单**只能缩小**且新增高危面前缀必须带实测出处（与 `LOGIN_PAGE_PATH_MARKERS` 那条「无证据不得加词」同口径），不做自动推断。

## 4. 货币为什么只能是变异产物

降级要付的不是"我认真对抗想了想"，而是**跑过、有产物、可复跑**。本仓唯一已具备这种形态的对抗性证据是变异反证驱动（records 里 M1–M15 逐条指名红的写法已成熟，且 `json reporter` 的 `assertionResults[].fullName` 取法有专条教训）。

判据三条：① 取 `escaped=0`（**有逃逸即不合格**，这是行为判据不是自述）；② 变异条数下界（`>= 2`，防"跑了一次 no-op 变异"）；③ 产物路径必须在本 PR 可寻（防指着一个被 gitignore 的临时目录）。

不选的方案：要求一段"对抗性提示词记录"。理由：提示词形态无法机械判"这次真的对抗了"，会把降级资格重新变回自觉——那是本条要消灭的形态。

## 5. 可重开欠账的载体：走记录 frontmatter，不碰冻结 ledger

`.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json` 自 2026-10-15 是**存档面**，往里加块会被 `carrierDrift` 判红。所以欠账字段落 `openspec/records/<分支>.md` 的 frontmatter，完全复用 `sync_status/sync_reason/sync_backfill_owner` 已验证可行的三字段形态（含"回填时整段删除，留着即判『已收口却仍留登记字段』"这条配套判据）。

outstanding 棘轮：仓内 `fallback_closed` 计数**只能缩小**，且新增必须带 `deep_review_backfill_owner`；计数不清零到 0 不阻塞别的 PR，但每次都在 Gate 读数里出声——这样降级不会悄悄变成永久。

## 6. 自反条款（本片自己被自己管）

判据本体在 D3 的高危清单里 ⇒ **本片的 PR 不得以 `self-play` 收口 QM-6**。落地形态：本片的执行记录必须写明 QM-6 的真实证据档（外部轴交付，或如实写"未执行 + 不得自扮演豁免"），**不得**出现"降级已建立且本 PR 用它收口"这种自我授权。这是 tasks 5.4 的验收项，也是判据 5「没有待人工裁决的争议」在本片的具象——本 PR 一律人工过目，不自动合并。

## 7. 反证计划（每条都要指名红）

| 编号 | 变异 | 期望 |
|---|---|---|
| M1 | `classifyEvidenceTier` 把 `null` 读成 `external` | `unknown` 不放行那条红 |
| M2 | 高危面前缀清单里摘掉 `scripts/check-*.js` | 判据本体自指那条红 |
| M3 | 产物路径只判"字符串非空"、不判存在 | 指向不存在产物仍绿 ⇒ 该用例必须红 |
| M4 | `escaped` 缺省当 0 | 缺字段的产物被接受，红 |
| M5 | outstanding 棘轮改成"只打印不判" | 棘轮那条红 |
| M6 | 摘掉 `backendAvailability` 落盘 | 接线锁红（与既有「接线按成本分档」同族） |

## 8. 预算与阻塞的真实数字（不拿未知当已知）

- 变异驱动：本仓实测 10–35 分钟（`scripts/*` 变更属混合 PR，不得借 docs-only 通道）。
- pre-commit 带代码 DUAL：实测 23–40 分钟（records 已两次撞上，**不得按时长判失败**，判据看产物）。
- 外部 CLI 不可用时的等待：一次真实 timeout 是 80 分钟——降级的收益基准就是这个数，不虚构。
## 9. 实测推翻 §1/§2 的判据落点（2026-10-17 普查主干 827 份 `.ccg/reviews/*.json`）

**`performedBy` 是散文，不是枚举**：去重后 34 种取值，代表样本（原样，含大小写与中英混排）：
`null` ×744、`"self-play(pending)"` ×14、`"self-play"` ×13、`absent` ×10、`"claude"` ×7、
`"self-play → external-review(claude) 已通过，agent 按 (a) 口径置 cleared"`、
`"dual (critic=claude, proposer=opencode) + self-play adjudication + external cross-family recheck (claude)"`、
`"lead-self-assessment (docs-only commit inside nav-perf-ux PR #3742)"`、
`"not-applicable (foreign commit record)"`、`"analyst-triage（关键词误报确认；非模型评审）"`、`"false-positive-adjudication"`。

**⇒ 以 `performedBy` 前缀分级的规则会把"真做过外部复核"的记录判成自扮演**（上列第 6、7 条都以 `self-play` 开头却声明做过 external review）。
这正撞上 AGENTS.md 两条既有纪律：「合法性/噪声类守卫的判据不得用文本形态猜，必须记录来源意图」与「枚举式判据必须配结构化正向契约」。

**`findings` 也不能独立当佐证**：`null` ×767、string ×17、absent ×16、数组仅 16 份（`arr/6` ×8、`arr/8` ×5、`arr/4` ×3）、object ×3。
但本仓已有一条**可复用的既有口径**：`ccg-review-decider.js` 的 `shouldPreserveClosedRecord` 以「`findings` 是非空数组 ⇒ 有实质内容」为**主判据**
（其注释 435-439 行记录了反面现场：`self_play_pending + findings:null` 等于什么都没产出）。新判据应接这条，而不是再造一套词汇。

**`mode/status` 分布**（前几位）：`single/pending` 305、`dual/pending` 220、`skip/pending` 212、`dual/self_play_resolved` 22、
`dual/cleared` 18、`single/needs_revision` 9、`dual/needs_revision` 8、`dual/error` 6。
⇒ 主干上 `dual+pending` 存量 220 条，**任何"要求 dual 必须带结构化 tier 否则红"的规则一上线就红两百条**，
正是 `check-pr-exec-record.js` 头部注释第 3 条（forward-only）点名的失败形态。所以本合同必须分两步：先**可见不拦**并打印覆盖率，再在覆盖率起来后转拦。

### 9.0 两条更硬的现场数字（`node scripts/ccg-artifact-shape-survey.js` 现场重取，2026-10-17）
- 以 `self-play` 开头、同时又在同字段里声明做过外部复核的记录 = **12 条** ⇒ 前缀分级会**当场误判 12 份真外部证据**，这不是理论风险。
- 存在 `status=cleared / needs_revision` 而 `performedBy=null`、`findings=null` 的产物（实测 `needs_revision pb=null f=null` ×3、`cleared pb=lead-self-assessment… f=null` ×4 等）⇒ **今天的"闭环"可以完全无出处**；只补 `tier` 字段而不要求 `evidence`，等于把同一个洞换个名字。

### 9.1 待裁决的合同岔口（两条候选，差别在"外部证据由谁声明、拿什么佐证"）

- **甲：来源意图字段**——闭环时由写入方（引擎或处置人）写 `deepReview.tier = external|self-play|none` + `evidence`（wrapper stdout 路径或 session id）。
  优点：判据零猜测；缺点：`evidence` 是自报的路径，门禁只能验"路径存在且非空"，不能验内容真伪 ⇒ 与既有「声明与字节不同源」的坑同源。
- **乙：产物内容判据**——沿用 `shouldPreserveClosedRecord` 的既有主判据「`findings` 是非空数组」当外部佐证，`tier` 缺省时按它推。
  优点：内容而非声明；缺点：**干净通过的外部评审往往 findings 为空**（实测 16 份数组 vs 18 份 dual/cleared），会把真评审判成没评审 ⇒ 误红面需要估算。
- 丙（我的倾向）：**甲 + 乙合取，但只在"新记录"上生效**——`tier=external` 必须带 `evidence`，且当 `findings` 为空数组/null 时**不拦只点名**（因为"无发现"是合法结论，"没跑"不是）。
  代价：判据仍依赖写入方诚实，真正的牙在"覆盖率棘轮 + 事后抽查"，不在字段本身。
