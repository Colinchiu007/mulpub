# 本次执行记录：头条 API 链全通至账号墙（imagex-cover-chain，2026-10-19）【docs-only】

- 分支：`toutiao-imagex-cover-chain`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：#3977（账号检测 `9a64a9db`）、#3983（解法链接 UI `027ed26f`）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §12.6.4/§12.6.6（本轮订正）

## 一、一句话：五步全通，最后一步是账号墙（服务端亲口说的）

`getAuthKey(image_temp)` → `GetImageUploadParams` → **PUT(204)** → **`GetImageUploadInfos`（登记）** → 上传视频 → **`PublishVideo` → Code 21000**

```
{"data":{"ItemId":0,"Code":21000,"Message":"未实名认证/帐号不可用，可前往西瓜创作平台/西瓜App投稿"},"status":0}
```

这是 **API 层的服务端权威证据**：账号闸门不用碰 UI 也能检测到（错误码 `21000`）。
R7 的「提交前检测（IsIdentifyAuth）」与这条**提交时兜底**互为双保险。

## 二、封面链（纠正前几轮的全部错误归因）

| 旧结论 | 本轮真相 |
| --- | --- |
| 「pgc 空间 object 上传是封面」 | **否**。6 次 `ApplyUploadInner&SpaceName=pgc` 从未有对应 tos 传输 —— 是 SDK 候选路由**预探测**（与 `GetUploadCandidates` 同层），从没上传过任何东西 |
| 「ThumbUri 要 ImageX 的 ApplyImageUpload」 | **否**。真页面用 `getAuthKey(type=**image_temp**, useStsToken=false)` → `vas-lf-x.ixigua.com/video/openapi/v1/?action=GetImageUploadParams` 拿三元组 |
| 「invalid top Account = pgc 授权上下文不同」 | **部分对**。根因是拿 `type=video` 的 STS 去签 pgc/imagex 请求；换 image_temp 即通 |
| 「SpaceKey/…tos_sign 只是 JWT 参数」 | **它就是 PUT 的 `Authorization` 头**（完整 656 字符，截断即 401） |

### 2.1 封面链的精确五步（全部真机实证）

1. **凭证**：`GET /xigua/api/upload/getAuthKey/?params={"type":"image_temp",...,"useStsToken":false}`
   → `{accessKey, uploadToken:"HMAC-SHA1:1.0:<unix>:<accessKey>:<sig>"}`
2. **三元组**：`GET vas-lf-x.ixigua.com/video/openapi/v1/?action=GetImageUploadParams&s=<5hex>&use_edge_node=1&file_size=<n>`
   头：`Authorization: <uploadToken>` + **`X-TT-Access: <accessKey>`**（缺它报 `10413 X-TT-Access does not match`）
   → `{tos_host, tos_sign, bucket:"tos-cn-i-e874c6", object_ids:["tos-cn-i-e874c6/<oid>"]}`
3. **PUT 图**：`PUT https://<tos_host>/<object_id>`，头 `Authorization: <tos_sign 原文>` + `Content-Type:image/jpeg`（CRC 可带可不带）→ **204**
4. **登记**：`POST …?action=GetImageUploadInfos&` body `[{"uri":"<object_id>"}]`
   → `{result_uri, info:{width,height,size,format,md5}}` —— **服务端此刻才入库**；缺这步 PublishVideo 报 `21084 封面图片不存在`
5. **提交**：`PublishVideo` 的 `VideoInfo.ThumbUri = result_uri`（`tos-cn-i-e874c6/…` 形态，与 #3960 时代码里的 `pickPosterUri` 兼容）

### 2.2 排障矩阵（本轮真实读数，防重蹈）

| 尝试 | 结果 | 教训 |
| --- | --- | --- |
| `ApplyImageUpload` (ServiceId=pk90l89vgd) | `100008 Could not find operation` | 头条 publish 页没用 imagex 公共网关的这条路；`pk90l89vgd` 只是 SDK 配置里的 serviceId |
| pgc + `user_id=undefined`/uid/EnOID/ServiceId 变体 ×5 | 全 `100008` | 同上；且 v1 的「30414 invalid top Account」来自**签了 vod 的 STS** 去打 vod 域名的 object 分支 |
| PUT 截断的 `tos_sign.slice(0,80)` | `401` | JWT 必须完整 |
| PUT 无 Authorization | `204` 但 `Infos.meta={}`（未登记） | 204 ≠ 已入库；**必须过第 4 步** |
| PUT 带完整 `tos_sign` | `200 {"success":0}` → Infos 有 meta ✅ | 正确形态 |

## 三、对已合入代码/文档的订正

| 位置 | 订正 |
| --- | --- |
| PRD §12.6.4（21085） | 补：21085 是**上个时代**的读数（当时 ThumbUri 传的是 VOD vid）；正确 URI 下若缺第 4 步登记，报的是 **21084 封面图片不存在**；两者都是封面链未走全的表现，不是「格式不接受」 |
| PRD §12.6.6 ② | 补：封面真实来源 = `image_temp` 链（上表），`GetPosterList` 服务端故障不再阻塞封面（可自传） |
| 记录 `toutiao-account-gate.md` §二 | pgc object 上传的解读**订正为预探测**（当时记为「封面机制」，误） |

## 四、发布链现在的完整状态图

| 步骤 | 状态 |
| --- | --- |
| getAuthKey(video) → ApplyUploadInner → 分片 → CommitUploadInner | ✅（ Vid=`v02d16g10004dbarnvvog65osoip723g`，本轮新产生） |
| getAuthKey(image_temp) → GetImageUploadParams → PUT → GetImageUploadInfos | ✅（本轮打通） |
| PublishVideo | ⛔ **Code 21000 未实名认证/帐号不可用**（服务端权威） |
| UI 闸门 | ✅ 已上线（#3977 检测 + #3983 解法链接） |

⇒ 头条 API 轨**技术上已无未解题**；唯一剩余是账号实名（与 UI 弹窗一致）。

## 五、未闭合

1. `21000` 的**提交时**结构化映射：`toutiao-video.js` 现在会把平台 `data.Message` 透出（通用），但尚未把 `21000` 映射到 `ACCOUNT_NOT_VERIFIED`（已有 `IsIdentifyAuth` 提交前检测；提交时兜底映射是锦上添花的下一轮）。
2. 封面链尚未沉淀为代码（`toutiao-video.js` 现在 491/500 行，新链 5 步应放 `toutiao-video-cover.js` 新模块，避免撞行数闸）。
3. 视频号/抖音仍等扫码（登录态不落盘）。

## 六、远程同步

| 远程同步 | 由门禁推导 |
