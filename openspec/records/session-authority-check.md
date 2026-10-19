# 本次执行记录：三平台会话权威定论（session-authority-check，2026-10-20）【docs-only】

- 分支：`session-authority-check`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：#4050（视频号探针 `531ebfc1`）

## 一、本轮拿到了三平台的**应用级权威定论**

经用户运行中的应用实例（CDP `9279` 无侵入）调用应用自身的批量登录检测
（`accounts:batch-check-login`，内部走各平台真实校验并持久化），三平台一次定论：

| 平台 | 账号 | 结论 | 判据码 | 平台侧动作 |
| --- | --- | --- | --- | --- |
| **头条** | 7ae99805 观四方 | ✅ **valid=true / active** | `CHECK_LOGIN_SUCCESS_HTTP_API` | 无需任何操作 |
| **抖音** | 01ab122e | ⛔ **Cookie 过期** | `CHECK_LOGIN_COOKIE_EXPIRED` / `expired` | **重新扫码** |
| **视频号** | b1e05ac2 | ❓ INCONCLUSIVE（结构性） | `http-check-inconclusive` | 跑探针定论（#4050） |

关键：**头条会话活着** —— 账号墙（Code 21000 未实名）与登录态是两回事，
技术链（#4038 封面接线 + #4019 提交兜底）就绪后，账号一旦实名即可直接真实发布。

## 二、方法沉淀：应用运行态的无侵入探测路径

| 步骤 | 手段 |
| --- | --- |
| 找应用 | `electron=5` 进程 → 命令行含 `--remote-debugging-port=9279` |
| 列页面 | `GET /json/list`（只有 1 个 page：汤姆鱼 renderer；RPA webview 不暴露） |
| 读运行态 | CDP 连 renderer → `window.electronAPI.*`（listAccounts / accountCheckLogin / accountBatchCheckLogin / authLoginSilent） |
| **不碰** | cookie 文件（独占锁）、进程（用户在用）、真实发稿 |

### 2.1 语义澄清（防误读）

`authLoginSilent` 的 `valid:false` **不等于「未登录」**——它判的是「能否用信封 cookie **静默重登**」；
头条会话明明活着但 silent=false 即为例证。真正的登录结论以
`accountBatchCheckLogin`（走各平台真实校验）为准。

### 2.2 平台专项结论订正

| 平台 | 旧记录 | 本轮权威读数 |
| --- | --- | --- |
| 抖音 | 「cookie 对 API 失效（status_code:8，自己探的）」 | **应用确认 expired 并已持久化**（`persisted.ok=true, status=expired`）——两法一致 |
| 视频号 | 「active（信封 1 cookie），真活性待探针」 | 不变；`authLoginSilent` 亦 `valid:false`（信封 cookie 不能静默重登）|
| 头条 | 「is_login:true（自己探的）」 | **应用确认 active**（HTTP API 校验通过）——两法一致 |

## 三、未闭合

1. 视频号真活性：跑 #4050 探针（需 cookie 授权）。
2. 抖音：等用户扫码（应用已把账号置为 expired）。
3. 头条：等用户完善账号信息（实名）—— 完成后 API 轨直接真实发布，无需改代码。

## 四、远程同步

| 远程同步 | 由门禁推导 |
