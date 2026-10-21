# 本次执行记录：API→DOM 降级诊断留存（api-fallback-diag，2026-10-21）【混合 PR】

- 分支：`api-fallback-diag`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 前序：PRD §16.19（抖音 E2E 实测 `publish timeout`，降级原因只能靠日志反推）

## 一、动因（真机实证）

2026-10-21 抖音视频发布 E2E 失败，历史记录只有：
```json
{ "status":"failed", "result":null, "error":"publish timeout" }
```
而真实路径是 **API 轨抛错 → 降级 DOM 轨 → DOM 超时**：
- `rpa-view-manager.js:186` `log.error('API publish ...')` ← 有日志
- `rpa-view-manager.js:195` `log.warn('API failed, falling back to RPA')` ← 有日志
- **但历史里查不到**「是否走过 API 轨、其失败原因」

⇒ 只能靠终态 error 反推（PRD §16.19.2 已如实标注这是推断）。

## 二、改动（两处，缺一不可）

### 2.1 `rpa-view-manager.js`：降级时把诊断写进实例字段，并并入 DOM 终态

```js
// 进入 API 轨前清空（防跨任务/跨平台污染）
this._lastApiFailure = null
// 降级分支（原只有 log.warn）
this._lastApiFailure = { platform, error: String(e?.message || e), code: e?.code, at: Date.now() }
// DOM 轨返回时并入（成功/失败两条路径都带）
if (this._lastApiFailure && this._lastApiFailure.platform === platform) out.apiTrackFailed = this._lastApiFailure
```

### 2.2 `phase4-events.js`：失败记录不再硬编码 `result: null`

原：`status: 'failed', result: null, error: task.error`
改：`status: 'failed', result: safeResult(task.result), error: task.error`

配套 `safeResult()`：先 JSON 化；失败则逐层剥（3 层 / 每层 40 键）；仍失败返回 null
—— **绝不阻断发布主流程**（历史写入是辅助信息，不是关键路径）。

> 两处**缺一不可**：只改 2.2 则 result 里没有诊断（源头没写）；只改 2.1 则诊断到不了历史（落库被丢）。

## 三、TDD 过程

| 文件 | 例数 | 说明 |
| --- | --- | --- |
| `apps/desktop/tests/failed-record-keeps-result.test.js` | 3 | 先 RED（2 失败：硬编码 null + 无安全序列化）后 GREEN |
| `apps/desktop/tests/rpa-view-manager-api-fallback-diag.test.js` | 3 | 诊断形状 / 合并契约 / 跨任务不串味 |

## 四、读数

| 项 | 读数 |
| --- | --- |
| 针对性回归（20 个相关测试文件） | **392 passed** ✅ |
| 新增测试 | 6 passed |
| `check-max-lines` / `check-unwired-tests` | ✅ / OK |
| abs-paths / 品牌残留 | PASS / PASS |
| **QM-1**（改 electron 代码 ⇒ 混合 PR） | build:vue 45.61s + electron-builder ✅ + 启动 **PASS（stderr 0 字节）** |

## 五、效果与未闭合

**效果**：下次同类失败，历史记录将形如
```json
{ "status":"failed", "result":{"apiTrackFailed":{"platform":"douyin","error":"API timeout (600s)","code":"API_TIMEOUT"}},
  "error":"publish timeout" }
```
⇒ 一眼可见"走过 API 轨且因 X 失败，DOM 轨又超时"，无需翻日志。

**未闭合**：
- 埋点只在**降级后**记录，若 API 轨成功而 DOM 轨未被触发则无此字段（符合预期）。
- §16.19.4 的另两项（分轨切换原因、DOM 轨等待 URL + 时长）本轮未做 —— 属同一专项，留待下轮。
- 抖音 E2E **仍未成功发布**（`publish timeout` 未修，只是现在可定位）。

## 六、远程同步

| 远程同步 | 由门禁推导 |
