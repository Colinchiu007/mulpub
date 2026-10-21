# 本次执行记录：分轨诊断透传（router-diag-passthrough，2026-10-21）【混合 PR】

- 分支：`router-diag-passthrough`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false（含 electron 运行时代码）
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动因（真机实证）

2026-10-21 头条视频发布（**已认证账号 45261bb5**，新二进制）失败：

```json
{ "status":"failed", "result":null,
  "error":"今日头条 视频上传未完成（未检测到上传完成信号…），已中止，未点击发布。…",
  "submitAttempted": false }
```

分轨诊断 `track` / `apiTrackAttempted` / `apiTrackFailed` **全部缺失**。

### 附带的重要进展
错误从 round 56 的「**尚未登记该页的上传入口选择器**」变成了「**视频上传未完成**」
⇒ #4170（`_getPlatformConfig('toutiao', article)`）**已生效**：选择器找到了、上传已启动，
现在卡在上传完成信号检测。**头条视频的真实阻塞点又前进了。**

## 二、根因（代码层）

`rpa-view-manager.js` L249-255 确实往返回对象写了三个诊断字段，但
`publisher-router.js` 的 `RpaVmPublisher.publish`：

| 分支 | 行为 | 后果 |
| --- | --- | --- |
| 成功（L593-602） | 重新构造返回体，只挑 success/url/postId/platform/mode/draft/diagnostics | 诊断字段丢失 |
| 失败（L607-613） | `throw new Error(result.error)`，诊断只被 `markNotSentByResult`/`attachRiskSignals` 摘走 notSent/code | **诊断全丢**，task.result=null |

⇒ **PRD §16.19.4 的埋点白做了**（产生了但没进历史）。

## 三、修法

新模块 `apps/desktop/electron/services/publish-diag-fields.js`：
- `pickDiagFields(r)` —— 只摘 `track`/`apiTrackAttempted`/`apiTrackFailed`/`publishId`（**不透传整个 result**，避免 cookies/大对象进历史）
- `attachDiagToError(err, r)` —— 失败分支把诊断挂到 error 对象（不改 throw 语义与 message）

router 内两处**内联 require 调用**（成功分支 spread、失败分支挂 error），**0 额外行**
（因 `publisher-router.js` 在 check-max-lines 点名还账清单内，登记 629 行零增长容差）。

## 四、踩坑与消红：check-max-lines 从红转绿

`publisher-router.js` 在 origin/main 已是 **828 行**（登记 629 + 容差 200 = 829）——
**历史累积本就逼近上限**。我的改动一度 +34 行，逐步压缩后仍 +2 行 ⇒ 830 > 829 ⇒ **门禁红**。

我曾据此外推「这 2 行是历史债务、无法避免」并解除 auto-merge。**CCG i2 指出还有第三方案**，
采纳后不仅消红，还净减 2 行：

把失败分支的三个连续装饰调用
（`markNotSentByResult` + `attachRiskSignals` + `attachDiagToError`，各带一段注释）
**合并为新模块的 `decorateRpaError(err, result, deps)` 一次调用**：

```js
require('./publish-diag-fields').decorateRpaError(rpaErr, result, { markNotSentByResult, attachRiskSignals })
```

⇒ 失败分支从「3 调用 + 3 段注释（6 行）」变「1 调用 + 1 行注释（2 行）」，
**router 回到 828 行**，max-lines 转绿；三个装饰的语义与顺序完全不变（新模块内 try 包裹，不吞错）。

⇒ 教训：**「不能再压了」往往是急躁下的误判**；把相邻的同类操作合并成一次调用，
常常既能消红又能让代码更紧。（本轮第三次被这个文件咬，前两次的教训这次才真正用上。）

## 五、过程中的测试不同步（已修）

改实现（内联函数 → 新模块）后，我的 3 条测试断言的目标已不在 router 文件里 ⇒ 2 例红。
修正测试指向新模块后 4/4 绿。教训：**改实现位置必须同步改断言目标**。

## 六、读数

| 项 | 读数 |
| --- | --- |
| 新增测试 `router-diag-passthrough.test.js` | 4 passed（TDD：先 RED 后 GREEN） |
| 相关回归 | **153 passed**（4 文件） |
| abs-paths / brand / enc / unwired | rc=0 / rc=0 / rc=0 / rc=0 |
| **QM-1** | build:vue 26.07s + electron-builder ✅ + 启动 **PASS（stderr 0 字节）** |
| **check-max-lines** | ❌ LEDGER_GREW +2 行（历史债务最后 2 行，见 §四） |

## 七、遗留事项（非阻塞）

| 项 | 状态 |
| --- | --- |
| `publisher-router.js` 行数 | 已回到 **828 行**（阈值 829 内），**本次净 -2 行** |
| 拆分建议 | 仍未做：RpaVmPublisher / ApiPublisher / BackendPublisher / PublisherRouter 四个类可各自成文件（828 行已贴顶，后续任何改动都会再触线，建议单独一轮处理） |
| `--update` | **未跑**（改判据基线需人工，且本次已不需要） |

## 八、远程同步

| 远程同步 | 由门禁推导 |
