# 本次执行记录：头条发布闸门订正 + 封面来源实证（toutiao-account-gate，2026-10-19）【docs-only】

- 分支：`toutiao-account-gate`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：#3957（小红书草稿落地 `0472bed979`）、#3960（头条 CSRF 修复 `2cdb761af3`）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §12.6.2 ①（本轮订正）

## 一、必须订正的一件事：我上一轮的「推翻」是错的

上一轮我据 `GetPublishAuth` 读数（`canPublish=true` / `disablePublish=false` / `blockStatus=0`）
写下「『未实名』≠『不能发』，此前『卡实名认证、需人工』属**错误归因，予以撤回**」。

**本轮真机反证推翻了那个撤回**：用活会话在真实发布页上传视频完成后点「发布」，平台弹出模态框：

> **账号信息未完善**
> 账号信息未完善，暂时不能进行发布文章、视频等权益操作，请完善后重试
> （取消 / 去完善）

⇒ 平台真正的拦截面在**提交动作**上，且**只在 UI 层给出（客户端模态框），接口读数里看不到**。
**R5 的结论（该头条号当前不能发布、需人工）是正确的，现予恢复。**

### 1.1 由此确立的判据纪律（比结论本身更重要）

| # | 纪律 | 本轮的违例 |
| --- | --- | --- |
| ① | 「接口读数说可以」**不能**推出「实际可以」；必须找到**真实提交路径上的拦截点** | 上一轮只看了 `GetPublishAuth` 就下结论 |
| ② | 推翻既有结论必须有**行为级证据**（真实操作 + 平台反馈原文），不能只凭一个相反的静态读数 | 上一轮正是这样推翻了一个有 UI 证据支撑的结论 |

## 二、头条封面来源：真机录制出真实做法

用活会话驱动真实发布页、完整上传视频、录制全部网络请求，得到封面机制：

| 步骤 | 真机观测 |
| --- | --- |
| 视频上传 | `ApplyUploadInner&SpaceName=middlevideo_toutiao&FileType=video&…&app_id=1231&user_id=<uid>` → tos 分片 → `CommitUploadInner` |
| **封面** | 反复出现的 `ApplyUploadInner&SpaceName=**pgc**&FileType=**object**&IsSize=687464&app_id=1231&user_id=undefined` → 上传成功后把得到的对象 URI 当 `ThumbUri` |
| 授权 | `getAuthKey/?params={"type":"video","useImageX":true,"useStsToken":true}`；STS 策略里显式含 `ImageX:ApplyImageUpload` / `CommitImageUpload`，且 `Condition.PSM = toutiao.fe.xigua_pgc`、`UploadScene=12` |

**复刻尝试与结果**：按同样形态用 `SpaceName=pgc&FileType=object&user_id=undefined` 调
`ApplyUploadInner`，VOD 返回 `CodeN=30414 "invalid top Account"`。
⇒ pgc 空间的授权上下文（PSM / UploadScene / STS 分支）与 `middlevideo_toutiao` 不同，
**不能照抄同一套 creds**，尚未打通。

### 2.1 「平台推荐封面」这条路已被证否（服务端故障）

`GetPosterList` 用**正确形态** `GET /ixigua/api/upload/GetPosterList/?params={"vid":"<vid>"}`
连试 6 次，全部返回：

```
{"status":-1,"message":"Not allowed by service circuitbreaker.
 toutiao.fe.xigua_creator_web:default:hl to toutiao.videoarch.poster:default:hl. Stop retry.
 Error rate: 0.1. Sample: 1. Last error: Error: Guldan.GetCandidatePosters Failed: send vframe_async success"}
```

⇒ 越过了参数校验、进入 poster 服务，但**服务端自身失败**（`Guldan.GetCandidatePosters Failed`）。
**结论：推荐封面当前不可用是平台侧故障，不是我方请求形态问题**；`POST` 恒 405 也印证该端点只走 GET + `params`。

## 三、视频号：登录态**不落盘**，磁盘取不到

按授权关闭占用 `shared-user-data` 的应用实例（6 个 electron 进程，`mp-app-live2` 实例）后，
全量扫描 `session/Partitions/*/Network/Cookies`：

| 观测 | 结果 |
| --- | --- |
| 含 `channels.weixin.qq.com` cookie 的分区 | 19 个 |
| **含 `_log_finder_id`（视频号助手会话键）的分区** | **0 个** |
| `default-session`（默认会话）里的微信域 cookie | **0 个** |
| `account-b1e05ac2`（视频号账号分区） | 仅 4 个 cookie；`auth_data` 返回 `errCode:300342 request failed`；页面「登录视频号助手 / 加载失败，点击重试」 |

⇒ 视频号的会话键是**内存态 / 不持久化**，磁盘上不存在任何可复用的登录态。
**唯一可行路径是活浏览器内重新扫码登录**，无法靠拷 cookie 复用。

## 四、抖音：分区会话仍对 API 失效

`account-01ab122e` 活 cookie 实测：`/aweme/v1/creator/pc/user/info/` 与 `/aweme/v1/creator/user/info/`
均返回 `{"status_code":8,"status_msg":"用户未登录"}`（HTTP 200）。
与 R6 结论一致：**cookie 名齐全 ≠ 登录有效**。

## 五、与参考产品的实现对照（回答「它们具体怎么实现的」）

参考产品 4.0 的发布路径（仓库既有逆向结论，`01-docs/MP-REUSABLE-ANALYSIS.md` +
`01-docs/ANALYSIS-SIGN-SERVICE-DEEP-2026-09-30.md`）：

| 层面 | 参考产品做法 |
| --- | --- |
| 发布方式 | **Cookie + 直接调平台 HTTP API**（不走浏览器 DOM） |
| 签名 | **自建远程签名服务** `POST /Sign/GetSign`，端口按平台分配（头条 `5031/5032`、快手 `5008-5011`、小红书 `5096`…），主进程只拼参数 |
| 登录态 | 本地保存 cookie，直连 API |

⇒ 我方与它的**唯一实质差距就是「签名」这一环**：它把签名外包给自建服务，
我们卡在抖音「私钥不可导出」（R6）、头条「`ThumbUri` 需图片 URI」（本轮）。

**但本轮结论是：当前 4 个平台的真实阻塞都不在签名/技术层，而在账号侧**：

| 平台 | 阻塞点 | 需人工 |
| --- | --- | --- |
| 头条 | 平台弹窗「账号信息未完善」 | ✅ 完善账号信息 |
| 视频号 | 登录态不落盘，磁盘无可用会话 | ✅ 活浏览器扫码登录 |
| 抖音 | 分区会话对 API 失效（`status_code:8`） | ✅ 重新扫码登录 |
| 小红书 | —— | ❌ 已完成（草稿落地产品分区） |

## 六、未闭合

1. 头条封面：pgc 空间的授权上下文（PSM / UploadScene 12 / STS 分支）未打通，`invalid top Account` 未解。
2. 头条发布：即使封面解决，仍会被「账号信息未完善」拦住（需人工）。
3. 视频号 / 抖音：均需人工重新登录。

## 七、远程同步

| 远程同步 | 由门禁推导 |
