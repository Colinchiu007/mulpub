# 本次执行记录：视频号会话状态复核 + 活性探针脚本（shipinhao-session-probe，2026-10-20）【混合 PR】

- 分支：`shipinhao-session-probe`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：#4038（封面接线 `b7ca111d`）

> ### ⚠ 2026-10-21 订正（本记录的结论已被后续实测否证）
>
> 本记录当时的结论是「视频号 status=active，真活性待探针」（依据：`listAccounts` 的
> `has_cookies=true` + `status_source=backend`，以及 `accountCheckLogin` 返回
> `CHECK_LOGIN_INCONCLUSIVE`）。
>
> **2026-10-21 同法复测**（应用自身 `accountBatchCheckLogin`）得到明确结论：
> `{"platform":"tencent_video","valid":false,"code":"CHECK_LOGIN_COOKIE_EXPIRED",
>  "loginStatus":"expired","persisted":{"ok":true,"status":"expired"}}`
> ⇒ **视频号会话确已过期**，判据从"不确定"变"确定"。
>
> 两处判断随之纠正：
> 1. `has_cookies=true` **不等于** cookie 有效 —— 它只说明"存过凭据"，不代表会话仍活。
> 2. 当时把 `authLoginSilent` 的 `valid:false` 解释为"能否静默重登的语义差异"，
>    更可能就是**会话已失效**的信号；把它当语义差异是本记录的一次误读。
>
> **行动**：不必再跑本记录的探针（其前提是"HTTP 不确定"，现已确定）→ 改**重新扫码**。
> 探针脚本保留备用。详见 `openspec/records/session-authority-check.md` §一 订正块。

## 一、探得的关键事实（应用运行态，无侵入）

应用实例（用户 2026-10-19 10:13 自启，CDP `9279` 开放）经 CDP 只读探测：

| 平台 | 应用内状态 | 关键读数 |
| --- | --- | --- |
| **视频号**（b1e05ac2「搞艺术的秋叔」） | **status=active** | `has_cookies=true`（信封里 **1 条** cookie）、`status_source=backend`、最近验证 `2026-10-18T14:29:12Z` |
| 抖音（01ab122e） | **已失效** | 与 R6/R7 cookie 探测一致 |
| 头条（7ae99805 观四方） | 已登录 | 等实名（Code 21000） |

### 1.1 修正前几轮的一个结论

此前记「视频号登录态不落盘（`_log_finder_id` 全分区 0 命中）」——**对磁盘分区仍成立**，
但本轮证实：**应用的信封加密库（`credential-store`）里存有 1 条视频号 cookie**
（`listAccounts` 读数 `has_cookies=true, cookie_count=1`），UI「已登录」标记即来源于此。
⇒ 视频号**不是没有可用会话**，而是会话在**应用信封库**里、不在 Chromium 分区里。

### 1.2 应用自身的 HTTP 检测对视频号**不能定论**

`accountCheckLogin('tencent_video','b1e05ac2')` 实测返回：

```json
{"code":"CHECK_LOGIN_INCONCLUSIVE","reason":"http-check-inconclusive","loginStatus":"active",
 "hint":{"fallback":"平台接口未给出明确结论（可能正在风控或改版），请稍后重试","action":"retry"}}
```

⇒ HTTP 探测对视频号**结构性无效**（平台不给出明确结论）。真验证只有一条路：
**实际走链的第一步 `getUploadAuthKey`**（即一次真实上传授权请求）。

## 二、本轮产出：会话活性探针脚本

`packages/api-publish-engine/scripts/shipinhao-session-probe.cjs`（新增）：
对齐仓内 tt 探针风格，一键跑链第一步 —— 只调 `getUploadAuthKey`（读授权，**不传内容、不发稿**），
把「active/失效/风控」三种结论打出来。**需用户提供授权后运行**（会在平台侧产生一条授权请求日志）。

用法：`node packages/api-publish-engine/scripts/shipinhao-session-probe.cjs <cookie串或信封key>`

## 三、边界（如实记）

1. 本轮**没有**替用户跑真实发布测试 —— 应用正被用户使用（实例 10:13 自启、cookie 全部独占锁），
   擅自发稿风险不可接受；探针脚本已就绪，待授权。
2. cookie 从信封库解密读取的 IPC 路径未深挖（`credential-store` 域），探针脚本第一参数直接收 cookie 串；
   信封解密读取留给下轮（或由用户从「账号管理→设置」导出）。

## 四、读数

| 项 | 读数 |
| --- | --- |
| `packages/api-publish-engine` 全量 | rc=0（45 文件，本轮未改 src，脚本不进 vitest） |
| `check-max-lines` / `unwired-tests` | ✅ / OK |
| 编码 / 品牌 / doc-abs-paths / 记录债务 | OK / PASS / PASS / OK |
| QM-1 | 不适用（本轮仅新增 scripts/ 下探针 + 文档；classify=混合因 scripts 变更，QM-1 见 §六） |

## 五、远程同步

| 远程同步 | 由门禁推导 |
