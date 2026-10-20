# Change Proposal: rewrite-cancel-and-truncation-summary

> 状态：v1（完成前置勘察，含 9 条风险处置）
> 上游：rewrite-segment-and-finish-reason（PR #4063，merge `d5e2ee442`）执行记录 §遗留 第 4、5 条
> 触发：用户明确指出这两条必须修（其余三条为刻意设计边界，保持现状）

## 1. 目标

| # | 问题 | 用户可感知的伤害 |
|---|---|---|
| A | 分段改写合并后 `modelTruncated` 恒为 `false` | 5 段里某段被模型截断 ⇒ 正文中间缺一块，界面**无任何提示**（静默截断换到分段路径重现） |
| B | `ai:rewrite` 无取消通道 | 5 万字点下去，粘错文章也要等全程；分钟级操作无法中止，后续段继续计费 |

## 2. 前置勘察结论（决定方案形态）

### 2.1 为什么**不做** in-flight 中断

要真正中止「正在飞的那一次 HTTP 请求」，信号必须穿过 4 层：

```
rewrite-engine.js service → aiGenerator.generateWithDefault(..., runtimeOptions)
  → model-provider-manager.callAdapter(providerId, method, params, runtimeOptions)
  → adapter[method](params)          ← 勘察发现 runtimeOptions 到此被丢弃
  → fetch(..., { signal })
```

勘察实证：`model-provider-manager.js:294/303` 只调 `adapter[method](params)`，`runtimeOptions` 仅用于熔断判定，**没有下传到 adapter**。改动它等于给**全部** LLM 调用（改写 / 标题 / 摘要 / 视频标题 / 故事二创…）加一条新信号通路，波及面远超本需求。

### 2.2 采用本仓既有的协作式取消范式

`zhihu-favlist.js:114/150/284` 与 `batch-rate-controller.js:44-57` 已确立轻量范式：

```js
const signal = { cancelled: false }   // 纯标记对象
// 循环边界：if (signal.cancelled === true) return { cancelled: true, processed: i }
```

本 change 沿用同一范式（**不新造机制**），并复用既有 `services/abort-utils.js` 的注释与语义约定（该文件同时提供 AbortSignal 版工具，本 change 不入参 AbortSignal，只用标记对象，避免两套语义混用）。

**取消粒度如实定义**：在**段边界**生效，最坏延迟 = 一个片段的时长（约 30–60s）。文案必须写「当前片段完成后停止」，不得暗示立即中止。

### 2.3 modelTruncated 汇总

段级 `_rewriteOnce` 已产出 `once.modelTruncated`（来自 `finishReason === 'length' | 'max_tokens'`）。`segment-rewriter.js` 当前**丢弃**它并硬写 `false`，理由是「无法归属到整篇」——这个理由是错的：**「至少有一段被截断」是可以如实表达的**。

## 3. 设计

### 3.1 A：段级截断汇总（引擎侧，无 IPC 变化）

`segment-rewriter.js`：

- 循环内收集 `truncatedSegments.push(seg.index + 1)`（1-based，与用户可见段号一致）；
- 结果体：`modelTruncated: truncatedSegments.length > 0`；
- 新增 `truncatedSegments: number[]`（纯增量字段，空数组表示无截断；单次路径不出现该字段）；
- 全篇 `outputTruncated` 语义不变（仍由合并后 `_postProcess` 决定）。

渲染层：`RewriteView` 的模型截断横幅已 keyed on `data.modelTruncated`，**自动生效**；仅需让文案在分段场景下更准确（新增一条带段号的变体，避免用户以为整篇都被截）。

### 3.2 B：取消通道（跨 IPC / 引擎 / 渲染三层）

**主进程**（`ipc-handlers/ai.js`）：

```js
const activeRewrites = new Map()   // runId → { cancelled:false, senderId }
ipcMain.handle('ai:rewrite', withSenderCheck(async (event, params) => {
  const runId = normalizeRunId(params && params.runId)     // 非法/缺失 ⇒ 不登记（老调用方零影响）
  const token = { cancelled: false }
  if (runId) activeRewrites.set(runId, { token, senderId: event.sender.id })
  try {
    const result = await rewriteEngineService.rewrite({ ...params, signal: token })
    return { code: 0, data: result }
  } finally {
    if (runId) activeRewrites.delete(runId)   // R3 泄漏防护
  }
}))
ipcMain.handle('ai:rewrite-cancel', withSenderCheck((event, runId) => {
  const entry = activeRewrites.get(runId)
  if (!entry) return { code: 0, data: { cancelled: false, reason: 'not_running' } }
  if (entry.senderId !== event.sender.id) return { code: 0, data: { cancelled: false, reason: 'not_owner' } }  // R4
  entry.token.cancelled = true
  return { code: 0, data: { cancelled: true } }
}))
```

**引擎**（`packages/rewrite-engine`）：

- `rewrite(params)` 接受可选 `params.signal`（纯标记对象）；
- `segment-rewriter.js` 循环**每段开始前**检查：若已取消 ⇒ 立即返回
  `{ success:false, errorCode:'CANCELLED', cancelled:true, cancelledAtSegment, segmentCount, completedSegments }`
  （`completedSegments` 用于告知「已完成的 N 段不会保留、已产生费用」）；
- 单次路径（未分段）：在调用 LLM **前**检查一次（约等于不可取消，如实记录）；
- **不返回半成品**、不写 rewrite_history（`rewriteEngineService.rewrite` 只在 `result.success` 生效）、不写 KB recordFeedback（全篇级副作用本就在成功后才执行）。

**渲染层**（`RewriteView.vue` / `Collection.vue`）：

- 每次改写生成 `runId`（`crypto.randomUUID()`，不可用则时间戳+随机）；
- `rewriting` 为真时展示「取消」按钮；点击 ⇒ `ai:rewrite-cancel(runId)`；
- 收到 `errorCode === 'CANCELLED'` ⇒ `notifyInfo`（不是 error），文案「已取消，已完成的片段不保留、已产生费用」；`rewriting` 复位；
- 取消后不弹「改写失败」。

**preload**：`aiRewriteCancel: (runId) => ipcRenderer.invoke('ai:rewrite-cancel', runId)`。

### 3.3 风险处置

| # | 风险 | 处置 |
|---|---|---|
| R1 | 取消粒度被误读为「立即停」 | UI 文案写「当前片段完成后停止」；引擎只在段边界检查 |
| R2 | 取消后已消耗费用被误解为退款 | 文案明写「已完成的片段不保留，已产生费用不退」 |
| R3 | `activeRewrites` 泄漏 | `finally` 必删；带 runId 才登记 |
| R4 | 伪造 runId 取消他人窗口任务 | 登记 `sender.id`，非 owner 返回 `not_owner` |
| R5 | 老调用方（无 runId）行为变化 | `normalizeRunId` 返回 null ⇒ 不登记、不传 signal、引擎零检查 ⇒ **逐字节等价** |
| R6 | 同一 runId 重复提交 | 已存在则**拒绝**（返回 `DUPLICATE_RUN`），避免两个任务共享一个 token 互相误杀 |
| R7 | 取消与成功竞态 | 取消只在段边界读标记；若最后一段已开始，则该段完成后仍返回成功（如实：取消来得太晚） |
| R8 | 半成品被写入历史/知识库 | 取消返回 `success:false`，既有持久化分支不会触发；新增测试锁定 |
| R9 | 新增 IPC 通道漏登记面 | ① `preload/system.js` 新增方法 ⇒ `preload.test.js` 的 **140 / 338 精确键数锁必须同步改为 141 / 339**（该测试是本仓机械锁，不改即红）；② `license-access-control.js` 无 `ai:*` 登记（已核实），无需改；③ 无集中 channel 白名单（已核实），只需 `withSenderCheck` |

## 4. 验收标准

**A：截断汇总**
1. 5 段中第 3 段 `finishReason='length'` ⇒ `result.modelTruncated === true`、`result.truncatedSegments === [3]`。
2. 全部段 `finishReason='stop'` ⇒ `modelTruncated === false`、`truncatedSegments === []`。
3. `max_tokens`（Anthropic 系）同样计入截断（复用 `isTruncatedFinishReason`）。
4. 单次路径（未分段）不出现 `truncatedSegments` 字段（纯增量，不改旧形状）。
5. 渲染层：分段 + 有截断段 ⇒ 横幅出现且文案含段号。

**B：取消通道**
6. 取消在第 2 段开始前生效 ⇒ `success:false`、`errorCode:'CANCELLED'`、`cancelled:true`、`segmentCount` 正确、`result` 为空。
7. 取消不写 rewrite_history（`_perfStore.addRewriteHistory` 调用次数 0）。
8. 无 runId 调用 ⇒ 引擎收到的 `signal` 为 undefined、行为与改动前一致（老调用方回归锁）。
9. `ai:rewrite-cancel` 非 owner ⇒ `{cancelled:false, reason:'not_owner'}`，token 不变。
10. `ai:rewrite-cancel` 未知 runId ⇒ `{cancelled:false, reason:'not_running'}`。
11. 重复 runId 并发 ⇒ 第二个返回 `DUPLICATE_RUN`。
12. 改写结束后 `activeRewrites` 不再持有该 runId（无泄漏）。
13. 渲染层：取消后 `notifyInfo` 被调用、`notifyError` 未被调用、`rewriting` 复位。

## 5. 不做（明确登记）

- **in-flight 中止**：需给全部 LLM 调用加信号通路（4 层、波及所有 AI 功能），本次不做；取消在段边界生效。
- **断点续跑**：取消后不保留已完成段（与「任一段失败即整篇丢弃」语义一致）。
- **单次路径的取消**：单次调用只需数秒，取消价值低；仅做调用前检查。
- **段间一致性 / Python 旁路**：本轮不碰（属另外两条遗留，用户已确认保持现状）。
