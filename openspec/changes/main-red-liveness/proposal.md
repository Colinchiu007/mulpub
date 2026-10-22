# main-red-liveness — 让「主干红就别合」这条判据在主干高频变动下仍可用

> 起因：2026-10-21 ~ 10-22，PR #4186（账号资料兜底修复）被合并门禁卡了约 8 小时。
> 该 PR 全程 **24 项检查 fail=0 / pending=0**，`mergeable=MERGEABLE`，`mergeStateStatus=CLEAN`；
> 卡住它的不是它自己的改动，而是**主干上别人的一条超时红**，加上一条**结构性不可满足**的判据。
>
> 本文只提方案，不动实现。四个阶段里前两个要改门禁判据，按 AGENTS「改谁来守门须人工过目」，
> 必须人工裁决后才可实施。

---

## 零、⚠️ 并行任务比对：本提案与 PR #4221 的关系（2026-10-22 补，实施前必读）

按 AGENTS「开 worktree 前先 `git worktree list` + 检查同模块活跃 worktree」的纪律，
实施前做了并发预检，发现**同一问题上已有一个在飞的任务**：

| 项 | 内容 |
|---|---|
| 分支 | `main-red-run-baseline` |
| PR | **#4221**（OPEN / MERGEABLE / BLOCKED，8 个 commit） |
| 改动文件 | `scripts/check-main-red.js`、`scripts/lib/main-red.js`、`scripts/check-main-red.test.js`、`scripts/merge-when-green.{sh,ps1}`、`.github/workflows/ci-failure-handler.yml`、`.github/scripts/workflow-contract.test.js` |
| 成熟度 | 已完成 **6 轮** codex/claude 真跨家族决策层评审，带 `evidence.md`（E1–E5）与 `specs/` |

### 它比本文多发现的两件事实（**本文据此修正**）

**修正 1｜主干侧 pending 有一半是噪声。**

来自它 E1 的实测：主干 tip `8da92948` 的 check-run **总行数 102**，其中 `handle-ci-failure`
**81 条**（同一个名字，来自 30 个 handler run），真实信号只有 **21 行**。
闸门实测 `mainPending=4`，而**真实**未完成只有 **2** 条。

机制：GitHub 把 `workflow_run` 触发的工作流的 check run **一律挂在默认分支当前 tip 上**。
`ci-failure-handler.yml` 监听 5 个 workflow ⇒ **仓库里每完成一次 CI，主干 tip 就多一条同名
`handle-ci-failure`**。它们全是 `windows-latest` 作业，在拥挤的托管池里排队 ⇒ 只要任意一条在飞，
主干侧就多一个 pending ⇒ 闸门判「未证实」，**哪怕三条真实 workflow 全绿**。

⇒ **本文 §2.2 的诊断方向正确（pending ≠ 红），但归因不完整**：不只是「主干在正常重跑」，
更有一半 pending 是**别人 CI 的副产物挂在我读的 tip 上**。这也解释了轮询里 pending 数
（11→10→9→7→5→4→2→3→2…）为何抖动得毫无规律。

**修正 2｜`electron-tests` 长期红的根因已修，本文 §1.2 的归因过时。**

`electron-tests` 的根因已由 **PR #4192 修复并合入主干（`1dc7417ed`）**，其后连续 3 次 push 全绿。
本文 §1.2 引用的 `elapsed=2101s budget=2100s rc=124` 是**当时的现场**，把它读成
「预算卡在成功区间与失败区间之间 ⇒ 必然抖动」是**过度归因**——真实链路是
「Windows 池排队 46.6/51.5 分钟才起跑 ⇒ 作业墙钟被排队吃掉 ⇒ 撞预算墙」。
⇒ **本文 §1.2 与 §2.3 的结论应降级为「该红的历史现场」，不作为当前证据**；
「基础设施类红」这个类别仍然必要（排队/runner 失联仍会发生），但不应把 #4192 已修的那条当成理由。

### 两者互补，不冲突（但**有先后依赖**）

| 层次 | #4221 做 | 本文做 |
|---|---|---|
| 读数可信 | ✅ 去 `workflow_run` 噪声 + 按 run 实例取最严格一格 + 取数重试 | — |
| 读数目标 | ✅ 读数稳定窗（前后两次比对 tip SHA，变了就作废重试） | — |
| **判定语义** | ❌ **明确列为「不做」**（原文：「本片**不**引入『钉住旧 tip 当已验证』（那要改守门者的权限，须人工过目）」） | ✅ **阶段 1 正是这一条** |
| 基础设施类红 | ❌ 不在范围（它只做「让未证实这个答案诚实且可归因」） | ✅ 阶段 2 |

⇒ **#4221 是本文阶段 1 的前置**：它先把读数弄准，本文再把「判的是哪棵树」这条语义改对。
在 #4221 合入前动手，会改**同样两个文件**（`check-main-red.js` / `lib/main-red.js`），必然冲突。

### 因此的执行顺序（**取代 §四 原顺序**）

```
0. 等 #4221 合入（它已在飞，且 8 个 commit + 6 轮评审已完成）
1. 本文阶段 1（主干基线化）—— 基于 #4221 合入后的新版代码
2. 本文阶段 2（基础设施类红登记）
3. 阶段 3（Merge Queue）暂缓
   （原阶段 4「缩短 electron-tests」已由 #4192 完成，从清单移除）
```

---

## 一、问题（现场取证，不是推测）

### 1.1 同一份 PR、同一个判据，退出码在 2 / 3 之间来回跳

2026-10-21 23:43 ~ 10-22 00:12 的一次 40 轮轮询（每 90 秒一次），同一主干 sha `8da92948` 上：

| 轮次 | `verdict` | `exit` | `mainFail` | 含义 |
|---|---|---|---|---|
| 19–20 | `INCOMPLETE` | 3 | 0 | 有检查未完成 ⇒ 未证实 |
| **21–22** | **`STOP_MAIN_RED`** | **2** | **1** | 主干红（`electron-tests`） |
| 23 | `INCOMPLETE` | 3 | 0 | 又回到未完成 |
| 37–40 | `INCOMPLETE` | 3 | 0 | 一直未证实 |

同一份代码、同一条主干，**四分钟内从「红」跳到「未知」再跳回来**。
原因是 GitHub 的 CI Failure Handler 在自动重跑那条失败的 job：重跑期间它的 `status` 是
`in_progress`，判据就读成「未完成」；重跑结束仍失败，就读成「主干红」。

### 1.2 主干那条红是什么

从 `8da92948` 的 `electron-tests` **attempt 1** 日志取到原文：

```
[electron-ci-timeout-budget] elapsed=2101s budget=2100s rc=124
TIMEOUT_BUDGET_EXCEEDED：本轮被步骤级 timeout 掐断，不是断言失败。
```

**是步骤超时预算差 1 秒（2101s vs 2100s），不是用例断言失败。**
这类红**没有任何 PR 能"修"它** —— 它只能靠调预算或查出那一步为什么变慢。

> ⚠️ **本节归因已被修正（2026-10-22，见 §零）**：`electron-tests` 的**根因**已由 **PR #4192**
> 修复并合入主干（`1dc7417ed`），其后连续 3 次 push 全绿。真实链路是
> 「Windows 池排队 46.6/51.5 分钟 ⇒ 作业墙钟被排队吃掉 ⇒ 撞预算墙」，
> 不是「预算值本身卡在成功/失败区间之间」。本段保留为**历史现场**，不作为当前证据。

### 1.3 绿色窗口在数学上可能根本不存在

| 量 | 实测值 |
|---|---|
| `electron-tests` 单次耗时 | 约 35–45 分钟（单线程全量单测） |
| 主干提交间隔（多会话并发） | 约 30–60 分钟 |
| ⇒ 「全部 checks 已完成的窗口」期望时长 | **≈ 提交间隔 − 检查耗时 ⇒ 可为负** |

也就是说：不是「我手慢没抓住窗口」，而是**窗口很多时候压根不存在**。

### 1.4 三次尝试的时间账

| 尝试 | 做法 | 结果 |
|---|---|---|
| 1 | 40 轮轮询，只观察 | 只抓到 `rc=2`；主干红被重跑循环掩盖成 `rc=3` |
| 2 | 第 26 轮抓到 `rc=0`「主干绿、本 PR 无红」，但**只报告未合并** | 再回来时主干已前进，窗口关闭，`rc=3` |
| 3 | 判定与合并**在同一轮轮询里原子完成** | 第 48 轮命中并合并成功 |

合并最终发生在 `2026-10-22T03:20:20Z`，merge commit `636030118`。

---

## 二、根因（三条，都是结构性的）

### 2.1 TOCTOU：被检查的东西和被合并的东西不是同一个

`check-main-red.js` 的采集层读的是 **`origin/main` 的当前 tip**：

```js
// scripts/check-main-red.js:128-131
mainSha: () => {
  runGit(['fetch', 'origin', 'main'])
  return String(runGit(['rev-parse', 'origin/main']).trim())
},
```

然后 `checksAt(mainSha)` 取该 tip 的检查。判据通过后，我在**下一个动作**里才去合并。
这两步之间主干会变 —— 这是教科书式的 **time-of-check to time-of-use** 竞态。
判据越严格、检查越慢，这个间隙造成的损失越大。

### 2.2 判据把「主干此刻有没有人在跑检查」误当成「主干有没有红」

`scripts/lib/main-red.js` 的 `bucketOf()` 把检查分四类：`pass / fail / pending / skipped`，
`judge()` 在主干侧只要有 `pending` 就判 `INCOMPLETE`（rc=3）。

但 `pending` 的语义是「**还不知道**」，不是「有问题」。
主干每被推一次，**所有** checks 都会回到 `pending`。于是：

> 主干越活跃 ⇒ 主干侧 pending 越多 ⇒ 判据越判不出来 ⇒ 越不敢合并。

这条判据的惩罚方向**与它的目标恰好相反**：它想保护主干，实际效果却是**主干越忙，所有人越合不进去**。

### 2.3 判据没有区分「PR 可修的红」与「PR 不可修的红」⇒ 死锁

AGENTS 的出口只有一条：`--allow-main-red "<逐条点名全部主干红 + 归因 + run 号>"`，
语义是「**本 PR 正是去修那条红**」。

当主干红是**超时 / runner 失联 / OOM** 这类基础设施故障时：

- 没有任何 PR 是「去修那条红」的（只能改预算或排查机器）
- 于是所有人都不能用这个出口
- 于是**全仓所有 PR 一起冻住**，直到有人单独开一个调预算的 PR

本次 8 小时就是这条死锁的现场。这不是「判据太严」，是**判据缺了一整个类别**。

### 2.4 一个容易被忽略的事实：这条判据比 GitHub 本身更严

实测分支保护（两套机制并存）：

| 机制 | required status checks |
|---|---|
| classic `branches/main/protection` | `Gate Result`、`build`、`QG Unit Tests`、`QG Coverage` |
| ruleset `main-ci-gate`（id 23749994） | `QG Static`、`QG Unit Tests`、`electron-tests`、`文档同步检查`、`债务熔断检查`、`单元测试 + Lint`、`GUI Gate Result` |

且 ruleset 的 `strict_required_status_checks_policy = **false**`。

含义：**GitHub 并不要求「主干绿」才允许合并**，也不要求分支 rebase 到最新。
「主干红就别合」是**本仓自加的、比平台更严的**策略（`main-red.js` 文件头注释亦自述"这条比
GitHub 的 required 清单更严"）。加这条策略的**目标是正确的**——不把红留给下一个会话；
但**实现方式**（要求主干瞬时全绿）在高频主干下不可满足。

---

## 三、现状盘点（改哪里，行号坐标）

| 文件 | 角色 | 与本文的关系 |
|---|---|---|
| `scripts/lib/main-red.js`（330 行） | **纯判据**，零依赖、不碰网络/git | 阶段 1 要在此加「基线」概念；阶段 2 要在此加「基础设施类」分类 |
| `scripts/check-main-red.js`（189 行） | **采集层 + 出口** | 阶段 1 主改点：`mainSha()`（:128-131）→ `mainBaseline()` |
| `scripts/lib/main-red.test.js` | 判据单测 | 阶段 1/2 的回归落点 |
| `scripts/merge-when-green.{sh,ps1}` | 两个合并入口，已强制调用 `check-main-red` | 阶段 1 不改它们（保持单一真源） |
| `.github/workflows/*.yml`（16 个） | **全部没有 `merge_group:` 触发器** | 阶段 3 的前置条件 |

退出码契约（**不得改动语义**，只允许新增信息）：

```
0 = 可以合    1 = 本 PR 新增红（必须修）    2 = 主干红（停手）
3 = 未证实    4 = 判据自身故障
```

---

## 四、方案

### 阶段 1｜主干基线化：把「此刻」换成「最后一次完整结论」

**一句话**：不再问「主干此刻是否全绿」，改问「**主干最后一次跑完的结论是不是绿的**」。

#### 设计

采集层新增 `mainBaseline()`，从当前 tip 沿第一父链回溯，找到第一个「所有检查都已完成」的 sha：

```js
mainBaseline: ({ maxBack = 12, maxStale = 3 } = {}) => {
  const tip = mainSha()
  const chain = runGit(['rev-list', '--first-parent', 'origin/main', '-n', String(maxBack)])
    .trim().split('\n').filter(Boolean)

  for (const [i, sha] of chain.entries()) {
    const rows = checksAt(sha)
    if (rows.length === 0) continue                        // 该提交还没有任何检查 → 不是基线

    // ⚠ 顺序承重：先判 fail 再判 pending。
    // 反过来的话，「中间某个提交真红、更新的提交还在跑」会被跳过 ⇒ 把红读成绿。
    if (rows.some(r => bucketOf(r) === 'fail')) {
      return { sha, rows, staleness: i, kind: 'red' }      // 真红：立刻停，不看更旧的
    }
    if (!rows.some(r => bucketOf(r) === 'pending')) {
      return i > maxStale
        ? { sha, rows, staleness: i, kind: 'too-stale' }   // 太旧 ⇒ 不认（fail-closed）
        : { sha, rows, staleness: i, kind: 'green' }       // 找到绿基线
    }
  }
  return { sha: tip, rows: checksAt(tip), staleness: 0, kind: 'unknown' }  // 全程无结论 ⇒ 退回 rc=3
}
```

判据层在 `judge()` 里只多做一件事：把 `mainBaseline.staleness` 透传进读数行，
verdict 计算**完全不动**（绿基线 ⇒ 主干侧无 fail 无 pending ⇒ 现有逻辑自然给出 rc=0）。

#### 为什么这样是对的

| 它回答的问题 | 是否仍然是「我有没有把主干弄坏」 |
|---|---|
| 主干最后一次完整跑完是绿的 | ✅ 是 |
| 主干此刻有没有人在跑检查 | ❌ 不是，与我的改动无关 |

#### 边界（全部 fail-closed）

| 情形 | 行为 |
|---|---|
| 当前 tip 全部 completed 且无 fail | `kind: 'green'`，`staleness=0` —— 与今天完全一致 |
| 当前 tip 有 pending，上一个提交全绿 | `kind: 'green'`，`staleness=1` —— **这是本次要救的那一格** |
| 回溯窗口内任一提交有 fail | `kind: 'red'` ⇒ rc=2，**不放行**（先判 fail 的顺序保证） |
| 找不到绿基线，且没有 fail | `kind: 'unknown'` ⇒ rc=3，**退回今天的行为** |
| 绿基线比 tip 落后 > `maxStale` | `kind: 'too-stale'` ⇒ rc=3，不认旧账 |
| 采集失败 | rc=4（原样） |

#### 验证

1. **单测**（`scripts/lib/main-red.test.js`）四种形态：
   - tip 全绿 → rc=0，`staleness=0`
   - tip pending + 上一提交全绿 → **rc=0**，`staleness=1`（新行为）
   - tip pending + 中间某提交 fail → **rc=2**（不得因"更新的是 pending"而放过）
   - 全程 pending → rc=3（不得读成绿）
2. **变异反证**：把 `mainBaseline()` 里「先判 fail」改成「先判 pending」，第 3 条用例必须当场红 ——
   证明这个顺序是承重的，不是风格。
3. **真机对照**：用本次现场三个 sha 复现 ——
   `8da92948`（红）→ rc=2；`ab806ce0`（绿）→ rc=0；`72f371925`（当时 pending）→ 应判到绿基线。

#### 风险与取舍

- **会漏掉「新提交引入了红但还没跑完」**。缓解：`maxStale ≤ 3`（默认 3），且读数行显式打印
  `baseline=abc1234 staleness=2`。要更严可把 `maxStale` 设 0（等价于今天）。
- **不放宽任何一档退出码的语义**：阶段 1 只会把「rc=3 未证实」的一部分升级成「rc=0」，
  永远不会把「rc=2 主干红」降级成 rc=0。

---

### 阶段 2｜失败原因分类：把「考场坏了」和「答错了」分开

**一句话**：超时/runner 失联这类红，不该让所有人一起冻住。

#### 设计

**(a) 失败原因探针**（只对主干失败集里的 check 各取一次 job 详情）

```js
infraKindOf(sha, checkName) → 'timeout' | 'runner-lost' | 'oom' | 'unknown'
```

判据（机械，不靠人眼看）：

| 形态 | 判据来源 |
|---|---|
| `timeout` | 日志含 `TIMEOUT_BUDGET_EXCEEDED`，或步骤 `conclusion=timed_out`，或 `rc=124` |
| `runner-lost` | 日志含 `The runner has received a shutdown signal` / `The operation was canceled` |
| `oom` | 日志含 `JavaScript heap out of memory` / `exit code 137` |
| 其余 | `unknown`（**默认按可修处理**，不豁免） |

**(b) 显式登记表** `scripts/main-red-infra-exemptions.json`（沿用本仓 ledger 风格：只能缩小）

```json
{
  "$comment": "基础设施类主干红的显式登记。【只能缩小】。每条必须写清哪条检查、什么形态、证据 run/attempt、谁认领、何时到期。到期即恢复阻断（fail-closed）。禁止把它当「主干红的通用免检」。",
  "entries": [
    {
      "check": "electron-tests",
      "kind": "timeout",
      "evidence": "run 39633868932 attempt 1 · [electron-ci-timeout-budget] elapsed=2101s budget=2100s rc=124",
      "owner": "electron-ci-budget-rescale",
      "expiresAt": "2026-11-05T00:00:00Z"
    }
  ]
}
```

**(c) 放行条件（三条全满足才放行，缺一不放）**

1. `kind !== 'unknown'`（机械可证是基础设施类）
2. `expiresAt` 未过期
3. 证据里的 `run`/`attempt` **能对上当前这次红**（防止拿一条旧登记豁免将来的另一条红）

放行时读数行必须点名：`主干失败格子：electron-tests(infra:timeout,expires=2026-11-05)`。

#### 与 `--allow-main-red` 的分工

| 出口 | 语义 | 适用 |
|---|---|---|
| `--allow-main-red` | 「**本 PR 正是去修那条红**」 | 断言类红，PR 能修 |
| 登记表 | 「**这条红 PR 修不了，已有人认领，且有到期日**」 | 基础设施类红 |
| 两者都不满足 | 停手 | 其余一切 |

#### 验证

1. 单测：三种 `kind` 各自的放行/阻断矩阵；过期后必须恢复阻断。
2. **变异反证**：把「证据 run 能对上」这一条去掉，用「旧 run 号」的用例必须当场红。
3. 真机：用 `8da92948` 的 `electron-tests` 实跑探针，应判出 `timeout` 且证据串逐字吻合。

#### 风险

- **这是放宽门禁**，必须人工过目，且登记表必须**只能缩小**（有测试锁住：条数不得增加）。
- 到期日必须真实（建议 ≤ 2 周）。过期不续 = 自动恢复阻断。

---

### 阶段 3｜Merge Queue（治本，中期）

**一句话**：让 GitHub 在**合并瞬间的最新主干**上先跑一遍，把「检查和合并不是同一个东西」这个洞从根上堵掉。

#### 为什么它能治本

Merge Queue 的机制：把 PR 放进队列 → GitHub 在当前最新 `main` 上生成一个**临时合并提交** →
**在临时提交上跑 required checks** → 绿了才快进合并；期间主干又动了就**自动重新排队重跑**。

⇒ 被验证的树和最终落地的树是同一棵，TOCTOU 消失，绿色窗口这个概念也不再需要。

#### 前置条件（这是它的真实成本）

1. **16 个 workflow 全部没有 `merge_group:` 触发器**（实测：`grep -c merge_group .github/workflows/*.yml` 全为 0）。
   至少要给承载 10 条 required checks 的那几个加：`quality-gate`、`electron-ci`、`gui-test`、
   `build`、`doc-gate`、`debt-guard`、`dep-audit`、`visual-test`。
2. 启用 merge queue 属于改**分支保护规则**（ruleset `main-ci-gate` + classic protection），必须人工过目。
3. CI 成本约 ×2（队列里的临时提交要重跑一遍）。

#### 上了 Merge Queue 之后本仓判据怎么变

`check-main-red` 的「主干绿」那一半可以被 Merge Queue 直接取代；
但它的**差集归因**（「这条红是不是我引入的」）仍然有价值，建议保留为**合并前自查**，
不再作为阻塞闸门。

---

### 阶段 4｜缩短 `electron-tests`（**已由 #4192 完成，从清单移除**）

~~窗口为负的根因之一是单次检查 35–45 分钟。把它压到 10 分钟量级，即使不改判据也能大幅缓解。~~
**2026-10-22 更正**：`electron-tests` 的根因已由 PR #4192 修复并合入主干（`1dc7417ed`），
其后连续 3 次 push 全绿。剩下的「主干 tip 15–30 分钟前进一次 vs quality-gate 整条 44 分钟」
这一格，由 #4221 认定属于「读数窗口 vs tip 节奏」，需要靠**合并批量化 / CI 分层**来解，
不在本提案范围。本阶段**取消**。

---

## 五、明确不做

| 不做 | 理由 |
|---|---|
| 把 `QG Desktop Shards` / `QG Coverage` 加进 required 清单 | 那是改「谁来守门」，且会让窗口更不存在 |
| 取消「主干红就别合」这条策略 | 它防的问题（把红留给下一个会话）是真实的；要修的是**实现方式**，不是目标 |
| 让 agent 临场判断「这条红算不算基础设施类」 | 本仓反复证明「靠临场自觉」的门禁必然失守（`main-red.js` 文件头就是为此而写） |
| 用 `--allow-main-red` 兜住基础设施类红 | 语义是「本 PR 就是去修它」，用它属于把豁免当免检 |
| 提高 `maxStale` 到很大（如 20）来"总能合" | 那等于取消主干判据，只是换了个名字 |

---

## 六、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 当前 tip 有 pending、上一提交全绿时判 rc=0 | 单测（阶段 1 第 2 例） |
| 2 | 回溯链中间有 fail 时判 rc=2，不放过 | 单测（阶段 1 第 3 例）+ 变异反证 |
| 3 | 全程 pending 仍判 rc=3 | 单测（阶段 1 第 4 例） |
| 4 | 读数行打印 `baseline=<sha> staleness=<n>` | 真机跑一次读 stdout |
| 5 | 基础设施类红按登记表放行时点名 + 打印到期日 | 单测 + 真机 |
| 6 | 登记表过期后恢复阻断 | 单测（TTL 用例） |
| 7 | 登记表条数不得增加（只能缩小） | 结构锁 |
| 8 | 用本次现场三个 sha 复现三种 verdict | 真机对照表 |

---

## 七、需要人工决策的三件事（agent 不自作主张）

1. **阶段 1 是否批准**：它把「主干此刻全绿」换成「主干最后一次完整跑完是绿的」。
   这是**判据语义变更**，虽然只会把 rc=3 升级成 rc=0、永不降级 rc=2，但仍是改门禁。
2. **阶段 2 是否批准**：它新增一条**放行通道**。这是全仓风险面最大的一处改动，
   必须有人确认「登记 + TTL + 证据对得上当前红」这三道锁够用。
3. **阶段 3 是否立项**：Merge Queue 要改分支保护 + 改 8 个 workflow 的触发器，
   工作量与 CI 成本都要人拍板。

> 建议顺序：**1 → 2 →（并行）4 → 3**。
> 1+2 合计即可把本次的 8 小时压到 5 分钟量级；3 是长期正解但成本最高。
