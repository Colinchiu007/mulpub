# 本次执行记录：分轨诊断字段补齐（track-diag-full，2026-10-21）【混合 PR】

- 分支：`track-diag-full`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 前序：#4150（`apiTrackFailed`，PRD §16.19.4 埋点清单第 ③ 项）

## 一、补的是哪一项

PRD §16.19.4 埋点清单共三项：

| 项 | 内容 | 状态 |
| --- | --- | --- |
| ① | 分轨切换原因（实际用了哪条轨） | **本轮补** |
| ② | API 轨失败的服务端返回 | #4150 已覆盖（`code` 经 `attachRiskSignals` 挂到 Error，`_lastApiFailure.code` 已记录） |
| ③ | DOM 轨等待 URL + 时长 | #4150 已部分覆盖（`error` 里带 url；时长未单独记，见 §四） |

本轮补 ①：DOM 轨返回新增两个字段：
- `track`：`'api-then-dom'`（走过 API 轨）/ `'dom'`（没走）
- `apiTrackAttempted`：仅走过 API 轨时为 `true`（**条件写入**，dom-only 轨不得声称走过 API）

成功与异常两条返回路径都带。

## 二、TDD 过程（含一次判据域修正）

**第一次写测试时判据域搞错了**：我写的是「样本对象有这些键」——
那测的是字面逻辑，不是实现（正是 AGENTS.md「取证口径」警告的：
判据域要跟着被测性质走）。改为**静态结构锁**（读真实源码断言两个返回点都写入字段），
与 `failed-record-keeps-result.test.js` 同模式。

## 三、连带修复：3 个既有测试的契约期望

我的新字段让 3 处 `toEqual` 精确匹配失败（多一个 `track` 键）。
A/B 归因确认是我的改动引起（B 态 0 失败）后，把新契约**写进期望**
（而不是放宽成 `toMatchObject`）—— 更严，防将来漂移。

| 文件 | 处数 |
| --- | --- |
| `electron/services/rpa-view-manager.test.js` | 3（成功契约补 `track: 'dom'`） |
| `apps/desktop/tests/rpa-view-manager-xiaohongshu.test.js` | 1（空内容契约补 `track: 'dom'`） |

## 四、读数

| 项 | 读数 |
| --- | --- |
| 相关回归（10 个测试文件） | **105 passed** ✅ |
| 新增 `rpa-view-manager-track-diag.test.js` | 4 passed（结构锁） |
| `check-blanket-fs-mock` | pass 21 / fail 0（**本地先跑**，避免再被 CI 拦） |
| max-lines / unwired / abs-paths / 品牌 / 编码 | ✅ / OK / PASS / PASS / OK |
| **QM-1**（改 electron ⇒ 混合 PR） | build:vue 47.92s + electron-builder ✅ + 启动 **PASS（stderr 0 字节）** |

## 五、未闭合
- §16.19.4 ③ 的「DOM 轨等待时长」仍未单独记录（只有 url）；价值边际递减，暂不补。
- 抖音 E2E **仍未成功发布**（timeout 未修，只是诊断信息现已完整：track + apiTrackAttempted + apiTrackFailed）。
- 应用未运行（electron=0），无法用新埋点复跑 —— 待用户重启。

## 六、远程同步

| 远程同步 | 由门禁推导 |
