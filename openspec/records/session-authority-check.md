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

> ### ⚠ 2026-10-21 订正（视频号已从"不确定"转为**确定过期**）
>
> 上表第三行「INCONCLUSIVE，跑探针定论」**已被后续实测否证**。同法复测（2026-10-20T20:27Z）：
> ```json
> {"platform":"tencent_video","accountId":"b1e05ac2","valid":false,
>  "code":"CHECK_LOGIN_COOKIE_EXPIRED","loginStatus":"expired","persisted":{"ok":true,"status":"expired"}}
> ```
> ⇒ 视频号会话**同样已过期**，判据从"不确定"变成了明确结论。**不必再跑 #4050 探针**
> （探针的前提是"HTTP 检测不确定"，而现在已经确定）。此前"信封库里可能有活 cookie"的推测
> 也随之失效 —— `authLoginSilent` 当时的 `valid:false` 并非"不能静默重登"的语义差异，
> 而更可能就是**会话确已失效**的信号（当时把它解释成语义差异，是这次订正要纠正的判断）。
>
> 订正后三平台终态：**仅头条 active**；抖音、视频号均 `expired`（都须重新扫码）。
>
> ### 订正的**独立佐证**（2026-10-21，绕过应用判定直接问平台）
>
> 为确保不是应用判定的误报，直接用活 cookie 调视频号自身的 `auth_data`：
> ```
> POST https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data
> → HTTP 200 {"errCode":300334,"errMsg":"request failed"}    （分区 rpa-tencent_video-b1e05ac2）
> ```
> 而 `apps/desktop/electron/publishers/http-login-checker.js` 的 `tencent_video.check`
> 注释写明：**errCode 300333/300334 = 登录失效**。**300334 正是失效码**，
> 与应用 `CHECK_LOGIN_COOKIE_EXPIRED` 的判定**互相印证** ⇒ 过期结论**不是误判**。
>
> （旁证：其余 11 个 `wechat_mp` 相关分区同法返回 `300330`，那是公众号分区、与视频号无关，
> 也说明 300334 是视频号分区特有的、而非通用网络/风控噪声。）
>
> ⚠ **与目标描述的冲突**：目标写「视频号已经登录了」，但当前实测（应用判定 + 平台 errCode
> 双证据）为**已过期**。该描述在当下**已不成立**，须重新扫码后才恢复。

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
| 视频号 | 「active（信封 1 cookie），真活性待探针」 | **2026-10-21 订正：应用确认为 `expired` 并已持久化**（`CHECK_LOGIN_COOKIE_EXPIRED`）。旧判断「待探针」作废，见 §一 订正块 |
| 头条 | 「is_login:true（自己探的）」 | **应用确认 active**（HTTP API 校验通过）——两法一致 |

## 三、未闭合

1. ~~视频号真活性：跑 #4050 探针（需 cookie 授权）~~
   **已闭合（2026-10-21）**：复用测确认为 `expired` ⇒ 无需探针，改**重新扫码**。
   `#4050` 交付的探针脚本本身仍保留（将来若出现"HTTP 不确定"时可用），但当前不适用。
2. 抖音：等用户扫码（应用已把账号置为 expired）。
3. 头条：等用户完善账号信息（实名）—— 完成后 API 轨直接真实发布，无需改代码。

## 四、远程同步

| 远程同步 | 由门禁推导 |
