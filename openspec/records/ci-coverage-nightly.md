---
record: ci-coverage-nightly
task: 覆盖率检查降为按天跑，解主干 quality-gate 排队死锁
type: 门禁变更
requiresHumanReview: true
date: 2026-10-24
---

## 本次执行记录：覆盖率改按天跑（ci-coverage-nightly）

> ⚠️ **本 PR 是门禁变更，按 AGENTS「PR 自动合并」一节的禁止清单，必须人工过目，不自动合并。**

| 门禁 | 状态 |
|---|---|
| 变更类型与隔离 | ✅ CI 配置变更（`.github/workflows/`），worktree `mp-ci-coverage-nightly` |
| 授权 | ✅ **用户明确授权**（2026-10-24 21:30 「A 授权改 CI」） |
| 结构锁 | ✅ `workflow-contract.test.js` **46/46** 通过 |
| YAML 校验 | ✅ `js-yaml` 解析通过，`coverage.if` 保持原表达式、`gate5.if` 已加、`schedule` 已注册 |
| 自动合并 | ❌ 禁止（门禁变更须人工复核） |

## 一、为什么要做这件事

2026-10-24 一天里，4 个数字人 PR **代码侧全部就绪**（#4362 / #4381 均 22/22 全绿、
#4387 修完三个真红后仅剩 2 个疑似环境红、#4378 待重触发），但**一个都合不进去**。

7 轮检查（18:12 → 21:14）的读数全部是同一个：

```
check-main-red --pr <n>
verdict=INCOMPLETE exit=3   baseKind=unknown   mainFail=0
```

即「主干该 tip 的读数还没生成」。

**两个量倒挂了**：

| 量 | 实测值 |
|---|---|
| 主干单次 `quality-gate` 排队 | **1~2 小时** |
| 主干提交间隔 | 十几分钟 |

于是「主干是否能合」这件事永远读不到读数，判据永远 rc=3，所有在飞 PR 被**结构性卡死**。
更糟的是 `in_progress` 还会退回 `queued`（实测 21:10 → 21:13 一次），说明调度本身也不稳。

## 二、改了什么

### 2.1 `QG Coverage` 的核心步骤改为按天跑

```yaml
- name: "Gate 5 - Test coverage check"
  if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
  run: pnpm --filter @multi-publish/desktop test:coverage -- --coverage.reporter=text-summary
```

`QG Coverage` 自身约 **44 分钟**，是全部 job 里最长的。跳过它之后该 job 只剩 setup
（~2 分钟），主干单次预检的**排队与执行总量**显著下降。

### 2.2 新增每日 schedule

```yaml
on:
  schedule:
    - cron: '0 18 * * *'   # 每天 02:00（北京）
```

覆盖率仍然每天真跑一次，只是不再阻断每次 PR/push。

### 2.3 为什么**没有**改 job 级 `if`

`workflow-contract.test.js` 有一条结构性锁：

```js
assert.equal(job.if, "needs.changes.outputs.docs-only != 'true'")
```

精确相等。我第一版把 `&&` 加到 job 级 `if` 上，**当场被它判红**（46 → 45 pass / 1 fail）。

**没有去改那条锁**——它的意图是「防止有人悄悄摘掉 docs-only 短路」，是正当的结构保护。
改法改成保留 job 级 `if` 原样、把降级落在**最后一个 step** 上：

- 被 `if` 跳过的 **step** 不影响 job 结论 ⇒ job 仍 `success` ⇒ required check 照样满足；
- 44 分钟的覆盖率跑不再发生。

> 这与本文件 `changes` job 注释里的既有口径一致：
> 「被 `if` 跳过的 job 显示 skipped => required check 视为满足；`gate-result` 的 `$allowed` 含 `'skipped'` 即为此口径。」
> 我用的是同一原理的 step 级版本，因此**不需要动 GitHub 的 required status checks 列表**——
> 那才是爆炸半径最大的改法，本次刻意避开。

## 三、代价（明确记录，不粉饰）

| 影响 | 说明 |
|---|---|
| **PR 与 main push 不再看覆盖率** | 覆盖率回退只能靠**次日 nightly** 发现，最长延迟约 24 小时 |
| 覆盖率不再是合并阻断项 | 一个引入大面积未覆盖代码的 PR 可以合进去，第二天才报 |
| nightly 失败谁看 | 目前没有自动告警链路；需要人工看 Actions 或后续补告警 |

**这是用户明确接受的取舍**：用「覆盖率反馈延迟一天」换「合并链路重新流动」。

## 四、如果日后要回滚

把 `Gate 5` 那个 `if:` 删掉即可恢复成每次 PR/push 都跑覆盖率；
`schedule` 触发可以保留（无害）或一并删除。

## 五、验证

```
node --test .github/scripts/workflow-contract.test.js
# pass 46
# fail 0
```

```
coverage.if : "needs.changes.outputs.docs-only != 'true'"     ← 与原值逐字相同
gate5.if    : "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'"
schedule    : [{"cron":"0 18 * * *"}]
```

## CHANGELOG 条目

# ci(gates): 覆盖率检查改按天跑，解主干 quality-gate 排队导致的合并死锁

- `QG Coverage` 的核心覆盖率步骤改为只在每日 schedule 与手动触发时执行，PR 与 main push 不再跑那 44 分钟。
- 新增每日 02:00（北京）的 schedule 触发，覆盖率仍每天真跑一次。
- job 级 `if` 保持原样，降级落在 step 层——不触碰 `workflow-contract.test.js` 的结构锁，也不动 GitHub 的 required status checks 列表。
- 代价：覆盖率回退的发现延迟最长约 24 小时；已在本记录中明确列出。
