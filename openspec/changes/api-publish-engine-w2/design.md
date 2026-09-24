# Design: api-publish-engine-w2（抖音准自包含发布链）

## 1. 证据基线与待补面

| 步骤 | 证据切片 | 状态 |
|------|----------|------|
| getSdkToken（HEAD csrf） | `yx-bundle-slices.txt @837894`（含 URL 轮换池 `%3`） | ✅ 逐字在手 |
| getAuthKey v5（上传鉴权） | 同上（`upload/auth/v5/` GET，retryCondition=!isJson） | ✅ |
| 视频 aws4 上传（vod/分片/finish→Vid） | `yx-douyin-w2-slices.txt`（tasks 1.1 已补提 `uploadVideo$8`/`getVideoUploadArgs`/`uploadCover$d` 全段） | ✅ 已取证 |
| create_v2 提交（头组/查询串/风控分支） | `yx-bundle-slices.txt @2672895`（完整头组 + msToken 回退 + x-tt-verify 分支） | ✅ |
| clientSign 本地签名 | `yx-slices-v2b.txt douyin-clientSign@2673500`（双层解码 + SHA256/EC + base64 组装 + fail-closed throw） | ✅ |
| buildPostData_v2 body 字段 | `yx-douyin-w2-slices.txt`（tasks 1.2 已补提 `item.common`/`cover`/`declare` 全字段映射） | ✅ 已取证 |

**取证事实源（本规划已核实、遵守品牌词不入库红线 Gate 12）**：参考产品主进程 bundle 在本机已解包且完好——大小 `8401332` bytes、SHA256 `EC829DA4CD41871B84D589537955AE875EEF08C9CC1AB08AB1BD856F3F8008BC`（两份解包副本字节一致）。**真实本机目录名含参考产品品牌词，按红线不得写入本 tracked 文档**；apply 阶段用品牌词无关的可复现定位法寻回：`Get-ChildItem D:\Data -Recurse -Filter index.cjs | Where { $_.Length -eq 8401332 }`，再以 SHA256 确认（实际路径已同步至内置记忆与 EverOS）。历史文档记录的 `D:\Data\refpub-bundle` 为陈旧路径（refpub 系参考产品厂商域，非门禁品牌词），盘上已不存在。已核实 `@837894`（aws4Interceptor 注册段）/`@633934`（aws4 `AWS4-HMAC-SHA256` authHeader）逐字对齐，证明现有切片即源自本 bundle。

**实现顺序硬约束**：tasks 1.1/1.2 取证**已完成**（六块证据全部在手，upload/body 两块落 `yx-douyin-w2-slices.txt` 并过品牌残留门禁）；实现任务不再受「待取证」约束，但契约字段名以取证切片为准，禁止臆造（见 AGENTS 供应商契约会则）。

## 2. 链结构（platforms/douyin-video.js）

复用 W1 `publish/core` 基座（http-base axios 工厂、contract 校验、errors 语义码、emit-gate 节流、spacer/riskSuspender 联动经 publishWithMode 单例无需感知）。编排入口对应参考产品 `douyinPublishVideo`。步骤序列：

```
0) 前置校验（零请求 fail-closed）：
   cookie 必含 security-sdk/s_sdk_crypt_sdk、security-sdk/s_sdk_sign_data_key/web_protect、
   bd_ticket_guard_client_data(_v2)、sid_tt；clientSign 预生成失败 → throw「账号信息缺失，请重新授权」
   视频文件存在性 stat()/existsSync（不存在 → io_error，对齐 douyinPublishVideo 首检，零请求）
1) sdkToken = HEAD csrf：URL 池 [anchor/search, aweme/create/, homepage/module/]
   idx%3 轮换；headers {cookie, Accept, referer:/content/upload, x-secsdk-csrf-request:1,
   x-secsdk-csrf-version:'1.2.7'} → headers['x-ware-csrf-token'].split(',')[1] ?? ''
2) authKey = GET upload/auth/v5/（retryCondition=!isJson ≤3）→ {auth, status_code, status_msg}
   auth 为 JSON 字符串：JSON.parse(auth) = {AccessKeyID, SecretAccessKey, SessionToken}（凭证三件套，字段名已取证钉死）
   !auth → 上传授权失败（返回 status_code），零后续请求
3) 上传（service:"vod"，region cn-north-1）：
   3a) apply：GET https://vod.bytedanceapi.com params{Action:"ApplyUploadInner", Version:"2020-11-19",
       SpaceName:"aweme", FileType:"video", IsInner:1, FileSize:size, app_id:2906, user_id, s:rand}
       retryCondition=!isJson → Result.InnerUploadAddress.UploadNodes[]（SessionKey/UploadHost/StoreInfos[].Auth/StoreUri）
   3b) 分片：aws4 拦截 http 实例 PUT；partSize 默认 3145728(3MiB)，>500MB→5MiB，>1GB→10MiB
       size≤partSize 走单片；否则分片并发（在途上限 O，Promise.race 回收），每片 uploadVideoPart 校验 res.data.crc32，
       Map<partNum,crc32> 收齐（缺片 <总片数 → io_error）；uploadId = Guid
   3c) finish/commit → Result.Results[0].Vid = videoId（字段名 Vid，已取证）
4) 封面（service:"imagex"，同源 aws4，region cn-north-1）：
   apply：GET https://imagex.bytedanceapi.com params{Action:"ApplyImageUpload", Version:"2018-08-01",
     ServiceId:"jm8ajry58r", app_id:2906, user_id, s:rand} → InnerUploadAddress.UploadNodes[0]
   单 PUT `https://${UploadHost}/upload/v1/${StoreInfos[0].StoreUri}`
     headers{"Content-CRC32":crc32(buf).hex, "Authorization":StoreInfos[0].Auth, "Content-Type":octet-stream, "X-Storage-U":user_id}
   → Result.Results[0].Uri = poster/coverUri（字段名 Uri，已取证）
5) 提交：POST create_v2/?read_aid=2906&cookie_enabled=true&...&aid=1128&support_h265=1
   &msToken=<cookie 或 a12man123masb${Date.now()}>&a_bogus=（空）
   headers: {cookie, UA, Content-Type:application/json, x-secsdk-csrf-token,
     bd-ticket-guard-version:'2', bd-ticket-guard-web-version: ticket.startsWith('hash')?'2':'1',
     bd-ticket-guard-iteration-version:'1', bd-ticket-guard-web-sign-type:'0',
     bd-ticket-guard-ree-public-key, bd-ticket-guard-client-data, Referer:/content/publish, Origin}
   body = buildPostData_v2(payload, coverResult, videoResult, ..., horizontalCoverResult).trim()
     关键字段映射（已取证）：item.common{ item_title←title, visibility_type←visibility_type??0, media_type:4,
       video_id←videoResult.Result.Results[0].Vid, creation_id:`jdhajhsh${Date.now()}`, download??1, timing??0 }
     cover{ poster←coverResult.Result.Results[0].Uri, horizontal_custom_cover_image_uri←horizontal/cover Uri,
       custom_cover_image_{width,height}, horizontal_custom_cover_image_{width,height} }
     declare{ user_declare_info:"{}" }（AI 声明位，默认空 JSON，本项目不自动声明）
6) 响应裁决：
   - headers['x-tt-verify-passport-decision'] 非空 → risk_blocked（⛔ 不移植 checkByPassword 自动验证/二次提交）
   - isJson(data) 否 → 交由 http-base retryCondition；连续非 JSON → risk_blocked
   - status_code===0 && aweme_id → {success, publishId:aweme_id, mode:'api', url?}
   - 登录失效码族（切片取证确定，如 status_code 与重定向 login）→ login_expired 不降级
```

## 3. clientSign 契约（逐字对齐切片）

```js
// signCommand: 'douyin.ticket-guard-client-data'（注册进 signer/registry，payload={cookie}）
const crypt = JSON.parse(JSON.parse(decodeURIComponent(cookie.split('security-sdk/s_sdk_crypt_sdk=')[1].split(';')[0].trim())).data)
const pk = crypt.ec_privateKey                          // PEM
const sd = JSON.parse(JSON.parse(decodeURIComponent(cookie.split('security-sdk/s_sdk_sign_data_key/web_protect=')[1].split(';')[0].trim())).data)
const ts = parseInt(Date.now() / 1000)
const str = `ticket=${sd.ticket}&path=/web/api/media/aweme/create_v2/&timestamp=${ts}`
const sign = crypto.createSign('SHA256'); sign.update(str); sign.end()
const req_sign = sign.sign(crypto.createPrivateKey(pk), 'base64')
return Buffer.from(JSON.stringify({ ts_sign: sd.ts_sign, req_content: 'ticket,path,timestamp', req_sign, timestamp: ts })).toString('base64')
// 任何一步异常 → throw Error('账号信息缺失，请重新授权此账号再试')
```

`bd-ticket-guard-ree-public-key` 提取同为 registry 命令 `douyin.ticket-guard-ree-public-key`（payload={cookie}）。**逐字对齐 bundle @2671737（tasks 2.2 探针补提，订正原「优先 v2」误记）**：

```js
let K = "";
if (cookie.includes("bd_ticket_guard_client_data="))
  K = JSON.parse(Buffer.from(decodeURIComponent(cookie.split("bd_ticket_guard_client_data=")[1].split(";")[0].trim()), "base64").toString("utf-8"))["bd-ticket-guard-ree-public-key"];
else if (cookie.includes("bd_ticket_guard_client_data_v2="))
  K = JSON.parse(Buffer.from(decodeURIComponent(cookie.split("bd_ticket_guard_client_data_v2=")[1].split(";")[0].trim()), "base64").toString("utf-8")).ree_public_key;
// plain 键为带连字符的 "bd-ticket-guard-ree-public-key"；_v2 键为驼峰 .ree_public_key；两者皆无 → K 保持 "" （上层链步骤 0 fail-closed 拦截）
```

**安全红线**：私钥/ticket 材料只存内存与请求头，禁止 logger 序列化输出（错误路径打印需脱敏）；证据文档域切片不含真实私钥值（占位符化）。

## 4. 双轨与风控接线（零新增架构）

- `platforms.yaml` douyin：`dom-only → api-then-dom` 一行；`publishWithMode`/降级日志/挂起守卫/频控全自动继承（W1 §5 enforcement 的 `platform::accountId` 键天然覆盖 douyin）。
- risk_blocked 判定并入 `publish-risk.isRiskBlocked`：新增 douyin 信号——响应头 `x-tt-verify-passport-decision` 与 `status_code===110`（切片验证失败语义），命中即 suspend + `publish:risk-suspended` 广播（复用桌面横幅/人工恢复，无新 UI）。
- AI 声明字段：取证确认 create_v2 body 声明位为 `item.declare.user_declare_info`（默认 `"{}"`，即不声明）；本项目按 Q 红线保持透传上层传入值，MVP 默认不自动声明，验收报告注明。

## 5. Adapter 重指向（§4.4 委托模式）

`adapters/douyin.js` 保留 BaseAdapter 契约面（checkLogin/headers 复用），`publish()` 变薄委托 `douyin-video.publishDouyinVideo(http, task, cookie, {proxy, onProgress})`；删除旧 `aweme/post` 链与 `getDouyinSignature` import（grep 门禁扩展：`aweme/post|_signature` 在 src 运行时代码零命中）。委托测试模式对齐 shipinhao-adapter（uploadVideo/封面/委托契约/fail-closed 四类）。

## 6. 依赖决策

- aws4 签名：新增 npm 依赖 `aws4`（单文件零依赖 MIT，参考产品内嵌同款算法）——**否决**自研复刻（易错且无必要）与完整 `@aws-sdk`（过重）。lockfile 变更按规范在单一 worktree 一次 `pnpm install` 并提交（本 W2 worktree 即该唯一执行点）。
- 其余零新增：crypto/node 内置、http-base 复用。

## 7. 测试矩阵（本机假服务器，零外发）

| 套件 | 钉住内容 |
|------|----------|
| douyin-video-chain.test.js | 步骤序列与每步 method/URL 前缀/headers 白名单/body 字段（对照切片逐字）；apply(vod ApplyUploadInner)/分片(partSize 3MiB 单片边界、多片 crc32 收集)/finish→Vid 序列；x-tt-verify → risk_blocked；非 JSON ≤3 重试语义；msToken 缺失回退伪值 `a12man123masb` |
| douyin-fail-closed.test.js（并入链测试） | 四类签名材料 cookie 逐一缺失 → 零请求；私钥 PEM 非法 → throw 重新授权；文件不存在 → io_error 零请求；auth 缺 → 零上传请求 |
| clientSign 单测 | 固定测试用自生成 EC 私钥 + 构造 cookie → 断言 base64 三层结构与 req_content 契约、timestamp 单调、web-version hash 前缀推导、失败消息 |
| douyin-adapter.test.js | 委托契约（成功/失败归一/fail-closed 透传/零请求）|
| publish-mode 回归 | douyin api-then-dom 降级 DOM、risk 不降级（既有 suites 扩展平台行） |

> 注：抖音分片 partSize（3MiB/5MiB/10MiB 阶梯）与 W1 通用分片器 8MiB 不同，链测试按抖音实际取证阈值钉，不复用 8MiB 边界。

## 8. 活体裁决（M2，用户在场门槛）

前置：W2 代码合入 + W1 §7.5 共用账号窗口。执行：真实标题私密/草稿优先 1 条 → 平台前台回查 → 证据四件套（作品ID/链接/回查截图/degraded 标志）入 `evidence/api-w2-douyin/`；风控即停不换号。裁决结果（go/no-go + 平台响应记录）回写 PRD F11 与 techdoc 修订记录；no-go 时 platforms.yaml 回拨 dom-only（独立小 PR）。

## 9. 决策记录（本波新增，decided）

- D1 不移植 checkByPassword 自动验证：合规红线（风控即停），二次提交路径整体砍掉。
- D2 msToken 回退伪值保留（切片原样 `a12man123masb${Date.now()}`）：真实 msToken 来自 cookie 常态，伪值仅防 null 拼 URL。
- D3 csrf URL 池 `%3` 轮换保留，本仓默认 idx=1。
- D4 clientSign 走进程内签名 registry（非 platforms 内联），W3 签名页基建可复用。
