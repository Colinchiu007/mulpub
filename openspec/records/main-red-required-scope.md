---
record: main-red-required-scope
task: check-main-red 主干侧收窄到 required 检查
date: 2026-10-22
---

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
