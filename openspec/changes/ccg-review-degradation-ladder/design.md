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
