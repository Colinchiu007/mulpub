---
record: main-red-required-scope
task: check-main-red 主干侧收窄到 required 检查（**已否决，不合并**）
date: 2026-10-22
verdict: REJECTED
---

# ❌ 否决：这条改动把「真红」读成了「绿」

## 0. 先说结论

**本 PR 不合并。** 新版实测把一次真实的 `STOP_MAIN_RED` 判成了 `exit=0`。
决定性证据在同一天的活数据上：

| 版本 | 对 PR #4240 的判定 |
|---|---|
| 主干旧版 | `MAIN-RED verdict=STOP_MAIN_RED exit=2 mainFail=1 baseline=29322e5a0 staleness=2 baseKind=red` |
| 本分支新版 | `MAIN-RED verdict=OK exit=0 mainFail=0 baseline=01a7e9451 staleness=3 baseKind=green` |

## 1. 差在哪：`QG Desktop Shards (1/2)` 是真失败，但它不是 required

`29322e5a0`（20:15 推送）的作业终态：

```
success  QG Changes / QG Visual / QG Unit Tests / QG Browser E2E / QG Autonomous
success  QG Desktop Shards (2/2) / QG Static / QG Coverage / QG Business API Postgres
failure  QG Desktop Shards (1/2)          ← 这一条
queued   Gate Result                      ← 因而会红
```

而 required 清单（两套机制并集，10 条）里**没有** `QG Desktop Shards`：

```
GUI Gate Result, Gate Result, QG Coverage, QG Static, QG Unit Tests,
build, electron-tests, 债务熔断检查, 单元测试 + Lint, 文档同步检查
```

于是新版按 required 过滤时把这条失败**滤掉了** ⇒ 那个版本看起来"完整且绿" ⇒ `exit=0`。

## 2. 为什么旧版的"严"是**故意的**

AGENTS 的判据说明里写着：

> 实测代价：一条**非 required** 的分片红（`QG Desktop Shards` 不在 ruleset 也不在 required 清单里）
> **反过来把之后每一个 PR 的 required `Gate Result` 判红** —— 两个 PR 被这条冻了约 40 分钟

也就是说：**非 required 的红照样会把全仓的 `Gate Result` 判红**。
旧判据"看全部作业"不是疏忽，是为了提前接住这种红；按 required 收窄等于把这层保护拆掉。

我写 PR 时把这一点列成了"风险"，但我当时只有推演、没有反例。现在有了反例，且是**当场**撞上的。

## 3. 那我当初遇到的 rc=3 是怎么回事

初稿写"几乎不可满足"，**过强**，已在本文件 §1.5 更正：旧版对 PR #4240 实测 `exit=0`、
回溯 **2 步**就命中绿基线（`maxBack=5`）。退回 rc=3 的条件是
「主干连续被推 + 回溯窗口内每一步都有作业没跑完」，我遇到的 3 小时属于密集期，不是常态。

**正确的处置是等**，不是放松判据。这 3 小时的代价，比"把红读成绿"便宜得多。

## 4. 保留下来仍然有价值的东西

- `pickRequiredContexts()`（两套机制并集）—— 这个函数本身是对的，将来若要**加严**（例如把
  "required 之外还必须有 Gate Result 绿"写进判据）可以直接复用
- 两条**形态锁**的方法论：`this` 绑定这类缺陷 `require()` 查不出、单测碰不到，只有源码形态锁能拦
- 一条负结果：**不要**按 required 收窄主干侧，理由如上

# 主干侧只统计 required 检查

## 1. 现场：这条闸门在繁忙主干上常态 rc=3

PR #4219 合并前，`check-main-red` 连续撞到 **3 个不同主干 tip**：

| 时刻 | 主干 tip | 我等到的状态 |
|---|---|---|
| 15:57 | `4b1ecf4a` | 9 个 job 全排队 25 分钟 |
| 17:06 | 该轮 success | 但主干已换成 `a55df4509`，前功尽弃 |
| 17:30 | `a55df4509` 清零（实测 0 未完成） | 2 分钟后被推成 `71a61e540` |
| 17:59 | `71a61e540` 只剩 2 项 | 又被推成 `3b14585f4` |

**每次都 `mainFail=0 newRed=0`** —— 主干从未观察到达失败，只是「还没跑完」。

## 1.5 ⚠️ 措辞更正（同日实测，必须写在前面）

初稿写的是「几乎不可满足」。**2026-10-22 19:31 实测否证了这个强度**：
主干旧版 `check-main-red` 对 PR #4240 返回

```
MAIN-RED verdict=OK exit=0 ... baseline=6c6d156bc staleness=2 baseKind=green
```

即：它沿第一父链回溯 **2 步**就找到了绿基线（`mainBaseline` 的 `maxBack=5`）。

所以准确的说法是：**当主干连续被推、且回溯窗口内每一步都有非必需长跑项没跑完时**，
才会退回 rc=3。我遇到的那 3 小时属于这种密集期，不是常态。
本改动把「完成」的判定面从全部作业收窄到 required，降低该情形发生率 —— **是缓解，不是修复不可满足**。

同一次对比里还要记一条**反向**读数：新版 `staleness=3` 比旧版 `2` **更差**。
因为收窄后每个版本的「完整」标准变了，命中绿基线的那一步可能被跳过。
即本改动的收益不是单调的 —— 它减少「必须等非必需作业」的等待，但可能多回溯一步。

## 2. 根因：非必需的长跑项也参与「是否已完整跑完」

`mainRowsAt` 原先取该 tip 上**全部**非 `workflow_run` 作业的终态。而本仓真正 required 的只有 10 条
（两套机制并集，实测）：

```
GUI Gate Result, Gate Result, QG Coverage, QG Static, QG Unit Tests,
build, electron-tests, 债务熔断检查, 单元测试 + Lint, 文档同步检查
```

不 required 但被计入的：`Build & Release`、`Visual Tests`、`GUI Tests`、`QG Visual`、
`QG Desktop Shards (1/2)`、`QG Desktop Shards (2/2)`、`QG Browser E2E`、`QG Autonomous`。

主干每 15-30 分钟前进一次、整条 quality-gate 要 44 分钟 ⇒ **一个「全部作业都已完成」的版本
几乎不存在** ⇒ `mainBaseline` 沿链回溯 5 步也找不到绿基线 ⇒ 常态 rc=3。

## 3. 改法：只收窄**主干侧**

| 位点 | 改动 |
|---|---|
| `pickRequiredContexts(protection, rulesetDetails)` | 纯函数：两套机制取并集。**两源都读不到 → 返回 `null`（不过滤）**；两源读到了但一条 required 都没有 → 也返回 `null` |
| `createGhCollector.requiredContexts()` | 逐源 try/catch：`branches/main/protection` 的 `contexts[]` 与 `checks[].context`，加上 `rulesets` 里 `target=branch` + `enforcement=active` 的 `required_status_checks` 规则；只算一次（缓存） |
| `mainRowsAt` | `rows` 在写缓存前按 required 过滤；`required === null` 时不过滤 |

**为什么必须两套都读**：AGENTS「取证口径」已写明 `branches/main/protection` 与 `rulesets` **并存**，
只查前者会得出「某检查不是 required」的假结论。本仓实测两份各自只列一部分（protection 4 条、
ruleset 7 条、交集 1 条）—— 少读任一份都是**放松**判据。

### 三条刻意的不对称

1. **PR 侧不放宽**：仍是「全部检查零 pending、零 fail」。收窄只针对主干基准。
2. **取不到清单 → 不过滤**（回到原口径）：慢，但不会误判为绿。
3. **绝不用空集代替 null**：空集会滤掉所有作业 ⇒ 「主干没有检查」⇒ 恒绿。这是本条最危险的误实现，
   已被测试与变异反证双重钉住。

## 4. 判据

新增 7 例（`scripts/check-main-red.test.js`，总计 60 例），另跑 `main-red-baseline.test.js` 17 例：

| 用例 | 断言 |
|---|---|
| 两源取并集（真实形状） | 7 条，重复的 `QG Unit Tests` 去重 |
| 只有 rulesets（protection 403 的免费仓） | 仍能取到 |
| 新版 `checks[].context` 形状 | 也认 |
| 两源都取不到 | `null`（不过滤） |
| 两源读到但零 required | `null` —— **不得返回空集** |
| 空白名字 | 被忽略，不制造幽灵匹配 |

### 变异反证

把 `if (names.size === 0) return null` 改成 `return new Set()` →
**58 pass / 2 fail**，「两源读到但零 required」与父用例精确变红；逐字节还原 True。

### 真实探针

```
required= GUI Gate Result, Gate Result, QG Coverage, QG Static, QG Unit Tests,
          build, electron-tests, 债务熔断检查, 单元测试 + Lint, 文档同步检查
size= 10
```

与手工查 `branches/main/protection`（4 条）+ `rulesets/23749994`（7 条）的并集逐字一致。

## 5. 这条改动的性质

**改判据口径 = 放松**。放松判据的风险方向与「加严」相反：加严最多误伤流程，放松会让真红漏过。
所以本节刻意把「哪些**没有**被放宽」写清楚：PR 侧一切照旧、取不到清单时不过滤、空集被禁止。
并且这条改动**只让「已完成」更容易达成，不让「有红」更容易通过** ——
`mainFail` 的判定完全没动：只要 required 里有一条红，仍然 rc=1/2。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
