# 参考产品式多账号 API 发布 —— 技术拆解报告与复用落地计划

> 状态：方案（decision-complete，供其他 Agent 直接实现）
> 关联目标：把本仓现有「DOM 点击式 RPA 发布」升级为「Cookie + 直接调用平台 HTTP API 发布」，解决 `publish btn not found` / `douyin timeout` / `kuaishou 缺作品ID` 等活体缺陷。
> 逆向事实源：`D:\Data\refpub-extracted\packages\main\dist\index.cjs`（8.4MB 压缩 webpack bundle，参考产品 4.0 主进程发布引擎）。切片证据存于主仓 `.agent_context/staging/yx-*.txt`。
> **红线（用户明令）**：⛔ 运行时**严禁**请求 `*.refpub.cn`（尤其 `http://qianming.refpub.cn:{port}/Sign/GetSign`）等参考产品域名的任何远程接口。所有能力必须逆向为**我们自己的代码**。

---

## 0. TL;DR（给实现 Agent 的三句话）

1. 参考产品发布 = 从浏览器会话拿 **Cookie** → 用 axios 直连**平台官方创作者域名**的 HTTP API（预上传→分片上传→完成→发布提交），全程不点 DOM。
2. 按「是否依赖参考产品私有远程签名器」把平台分两层：**Tier A 自包含**（视频号 / B站 / 百家号文章）可 1:1 逆向复用；**Tier B**（抖音 / 快手 / 小红书 / 头条 / 网易）参考产品把签名外包给了 `qianming.refpub.cn`，**禁用**，须用公开逆向算法自研签名或直接走官方开放平台。
3. **落地建议先做 Tier A 的视频号 + B站两条视频链路**（零远程依赖、纯本地 crypto/csrf、发布成功可回查），最快拿到「真实活体发布成功」证据；Tier B 作为二期，签名算法攻克后再上。

---

## 1. 背景：为什么要放弃 DOM 点击改走 API

本仓现有实现 `apps/desktop/electron/services/rpa-view-platforms.js` 用 Electron `<webview>` 加载平台创作者页，靠 CSS 选择器找「文件输入框 / 标题框 / 发布按钮」并模拟点击。活体证据（本轮 publish2 实跑 + 原生 CDP attach 平台 webview target 抓 DOM）暴露的结构性缺陷：

| 症状 | 根因 | API 式为何免疫 |
|------|------|----------------|
| `publish btn not found`（bilibili/tencent 反复） | 按钮选择器随平台前端改版失效；`FieldRetryState(3)` 仅 3×3s，视频上传未完成时按钮根本不存在 | 不依赖任何 DOM，上传完成即直接 POST `add/v3` |
| `douyin timeout` | `_waitForResponse(['aweme/create','aweme/post'],60000)` 抓网络响应，页面不触发就超时 | 自己就是发起方，拿返回体判定 |
| `kuaishou 缺作品ID` | 从 DOM/URL 反推作品 ID 失败 | 发布响应体直接含 `result`/`data` |
| 最低等待 25s + 900000ms 轮询 | 用「等 UI 变化」近似「等上传完成」 | 分片 PUT 全部 200 即精确完成 |

结论：参考产品路线是这些脆弱性的根因解法。

---

## 2. 参考产品发布引擎总体架构（逆向还原）

### 2.1 双基类模型

```
BasePlatForm                     BaseWorker (extends EventEmitter)
  ├─ publishVideo(...)             ├─ getUserInfo()      // 登录态探活
  ├─ publishArticle(...)           ├─ checkResult(resp)  // 登录失效码判定
  ├─ publishDynamic(...)           └─ 每个平台一个 <Name>Worker
  └─ 每个平台一个 <Name>PlatForm
```

- **Worker**：负责「账号态」（登录校验、用户信息、失效码识别）。
- **PlatForm**：负责「发布动作」（上传 + 提交），是一组匿名 async 函数的聚合对象，例如：
  ```js
  Bilibili   = { publishVideo: publishBilibiliVideo, publishArticle, getBilibiliUserInfo, ... }
  Kuaishou   = { publishVideo: publishKuaishouVideo, ... }
  Shipinhao  = { publishVideo: shipinhaoPublishVideo, ... }
  Xiaohongshu= { publishVideo: xiaohongshuPublishVideo$1, ... }
  ```

### 2.2 HTTP 基座 `$http`（axios 封装）

所有请求统一走 `$http`，关键约定（须在我们代码里等价实现）：
- `timeout: 60s`；`retryCondition: (cfg, res) => !isJson(res.data)`（返回非 JSON 视为失败并重试，最多 3 次）——**这是识别「被风控弹回 HTML 验证页」的通用信号**。
- 支持注入 `httpAgent/httpsAgent`（代理，见 `createKuaiProxyAgent(proxy)`）；我们多账号若要分 IP 出口需保留此能力。
- 失败统一包 `errorCode`（`request_error` / `data_error` / `io_error` / `unknown_error`）+ `BadRequestException`。

### 2.3 进度 / 取消 / 分片基础设施

- **`publishStatusEnum`**：`init → uploading → uploadSuccess → pushing → pushSuccess / uploadFail / pushFail`。
- **`SetProgressNewEvent(emit, status, msg, taskId, totalParts?, doneParts?, needParts?)`** 与 **`SetProgressEvent(emit, percent, msg, taskId)`**：进度回传。→ 我们等价物 = 现有队列服务的 progress 事件。
- **`CancelToken`**：`throwIfCancelled()` 在每个阶段边界调用 → 支持取消。
- **`UploadEmitGate(fileSize, totalParts)`**：节流进度回调——`>100MB` 每 5s 一次，小文件每 10%（或总片≤10 时每片）一次。直接照搬。
- **分片大小**：视频号/B站/快手均为 **8MiB（8388608）**；`FileChunker` 报告里的 1MB 是另一处通用工具。
- **`Guid.NewGuid()`**、`getTimeStamp(13)`（13 位毫秒串）、`crypto.createHash('md5')`：通用 helper。
- **`HtmlDocument` / `RichTextParser`**：图文正文解析（`<p>/<topic>/<friend>/<img>`），百家号/头条文章用。

> 落地位置建议：新建 `apps/desktop/electron/services/publish-api/`（见 §7）。上述 helper 抽到 `publish-api/core/*`。

---

## 3. ★★ 关键分叉：签名依赖分层（决定「哪些能直接复用」）

逆向到核心调度函数 `getSignServerUrl(platform)`（bundle @591720 附近，切片见 `yx-orch.txt`）：

```js
const V = "http://qianming.refpub.cn:"
switch (platform) {
  case "kuaishou":    return V + ["5008","5009","5010","5011"][i%4]
  case "douyin":      return V + ["5041","5042"][i%2]
  case "xiaohongshu": return V + ["5096"]
  case "duoduo":      return V + ["5086"]
  case "baijiahao":   return V + ["5012"]
  case "toutiaohao":  return V + ["5031","5032"]
  case "pipixia":     return V + ["5021","5022"]
  case "wangyi":      return V + ["5051","5052"]
}
// 调用形态：POST {signUrl}:{port}/Sign/GetSign  body:{url, cookie:md5(payload), signType:"browser", signCommand:<platform>}
//           返回 {signature}
```

**判定：**
- **凡是出现在此表里的平台**，参考产品把某个签名参数（`__NS_sig3` / `a_bogus` / `x-s` 等）外包给了它的私有签名微服务。⛔ 我们不能调用它 → 必须自研该签名算法。
- **不在此表里的平台 = 签名完全本地生成 = 可直接 1:1 复用**：**视频号 Shipinhao、B站 Bilibili、微信公众号**，以及 **百家号文章主发布链**（见下）。

### 3.1 Tier A — 完全自包含，可直接复用成我们自己的代码 ✅

| 平台 | 签名/鉴权成分 | 为什么自包含 |
|------|----------------|--------------|
| **视频号 Shipinhao** | `Content-MD5 = md5(buffer)`（本地 crypto）；auth key 由 `helper_upload_params` 接口在视频号自身域名返回 | 无任何 refpub.cn 调用 |
| **B站 Bilibili** | `csrf = bili_jct`（从 cookie 正则提取）；分片走 `X-Upos-Auth`（B站 preupload 接口返回的 auth 串）；全链路域名 `member.bilibili.com` / `api.bilibili.com` / upos 镜像 | 无任何 refpub.cn 调用 |
| **百家号文章** | publish `token` = GET `baijiahao.baidu.com/pcui/article/edit?type=news` **响应头 `token`**；base token = GET `baijiahao.baidu.com/?source=inner` 里正则 `BJH__INIT__AUTH__\s*=\s*['"]([^'"]+)` | 主发布链取自百家号自身域名；`getSign$2`（→5012）只服务个别辅助接口，发布不依赖 |

> ⚠️ 修正一处历史误判：早期笔记把百家号整体划入 Tier B。经核 `getBaijiahaoPublishArticleToken` / `getBaijiahaoBaseToken`（bundle @1841789），**文章发布 token 是自包含的**，归 Tier A。图片上传代理 `/pcui/picture/uploadproxy` 是标准 multipart，也不依赖签名器。

### 3.2 Tier B — 参考产品依赖远程签名器，⛔ 禁止复用其服务，须自研

| 平台 | 被外包的签名参数 | 自研难度 | 我们可先复用的「本地」部分 |
|------|------------------|----------|------------------------------|
| **快手** | `__NS_sig3`（每个 `cp.kuaishou.com/rest/...` 查询串都带）；`getSign$5`→`qianming.refpub.cn:5004-5008` | 高（私有 JS 签名 VM） | Cookie、`kuaishou.web.cp.api_ph`（cookie 正则）、分片 PUT `Content-Range`、发布 body 结构全部本地可得 |
| **抖音** | `a_bogus`（→5041/5042）；**但 `create_v2` 路径里 `a_bogus=` 留空**（见切片 @2672895）；`bd-ticket-guard-client-data` = `clientSign()` **本地**用 cookie 私钥做 SHA256 签 | 中（a_bogus 公开逆向资料充足：SM3+RC4+魔改 base64） | `getSdkToken`（HEAD `x-secsdk-csrf-request` 拿 `x-ware-csrf-token`）、`clientSign`（本地 `crypto.createSign('SHA256')` 签 `ticket=..&path=/web/api/media/aweme/create_v2/&timestamp=..`）都是**纯本地**，可先直接复用；若空 `a_bogus` 触发风控再补算法 |
| **小红书** | `x-s` / `x-t`（→5096）| 高 | 上传 permit / 分片链路本地可得 |
| **头条号 / 网易号 / 皮皮虾 / 多多** | 各自签名 | 高 | 二期再评估 |

> **策略**：一期只做 Tier A。抖音作为 Tier B 的「准自包含」试点（本地 csrf + 本地 clientSign + 空 a_bogus）单列观察：若平台侧接受空 a_bogus 或仅弱校验，可低成本纳入；否则延后。

---

## 4. Tier A 逐平台完整 API 序列（决策完备，可照抄实现）

约定：`$` = 该账号 Cookie 串；所有 `Referer/Origin/User-Agent/Cookie` 均为请求 header。UA 用 `HttpConfig.userAgent`（Chrome 1xx，须与实际登录会话浏览器一致，否则风控）。

### 4.1 视频号 Shipinhao（视频，自包含分片上传）★推荐首做

**Step 0 登录/用户态**（可选，取 uin/finderUsername）：
`getUserinfo(cookie)` → 解析 `data.finderUser.uin` 与 `.finderUsername`；失效码 `errCode ∈ {300333,300334}` → 「登录失效」。

**Step 1 取上传 authKey**：
`POST https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params`
headers `{cookie, referer:"https://channels.weixin.qq.com", Accept:"application/json, text/plain, */*"}`
body `{timestamp:getTimeStamp(13), _log_finder_id:finderUsername, rawKeyBuff:null}` → 返回含 `authKey`（用于下面 `Authorization`）。

**Step 2 申请上传（applyuploaddfs）** `getUploadId$1`：
- 分片计划：`L=ceil(size/8388608)`；`BlockPartLength`：前 L-1 片各 8388608，末片 = 余数。body `{BlockSum:L, BlockPartLength:[...]}`。
- `PUT https://finderassistancea.video.qq.com/applyuploaddfs`
  headers `{"X-Arguments":"apptype=251&filetype=<mediaType>&weixinnum=<uin>&filekey=<encodeURIComponent(fileName)>&filesize=<size>&taskid=<guid>&scene=2", Authorization:<authKey>, "Content-MD5":"null", Referer:"https://channels.weixin.qq.com/", Origin:"https://channels.weixin.qq.com/"}`
  → 返回 `{UploadID}`。

**Step 3 逐片上传** `uploadVideoPart$d`（每片）：
- `PUT https://finderassistancea.video.qq.com/uploadpartdfs?PartNumber=<n>&UploadID=<UploadID>`
  headers `{"Content-MD5": md5hex(chunkBuffer),  // ★本地 crypto
   "X-Arguments":"apptype=251&filetype=<t>&weixinnum=<uin>&filekey=<enc(fileName)>&filesize=<size>&taskid=<guid>&scene=0",
   Authorization:<authKey>, "Content-Type":"application/octet-stream", Referer:".../platform/post/create", Origin:"https://channels.weixin.qq.com", "User-Agent":UA}`
  body = 该片 Buffer。→ 返回 `{ETag}`；收集 `PartInfo:[{PartNumber:n, ETag}]`。

**Step 4 合并完成** `getUploadedVideoInfo$4`：
- `POST https://finderassistancea.video.qq.com/completepartuploaddfs?UploadID=<UploadID>`
  headers 同 Step3（`Content-MD5:"null"`，scene=2），body `{TransFlag:"0_0", PartInfo:[{PartNumber,ETag}...]}`
  → 返回含 `DownloadURL`（视频在 CDN 的引用）。判定成功：`DownloadURL` 非空。

**Step 5（有链接扩展时）解析链接**：`POST .../helper/helper_parse_mp_link` body `{timestamp, _log_finder_id, url, rawKeyBuff:""}` → 取 `data.title` 作 linkTitle。

**Step 6 提交发布** `publish$m`：
- `POST https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_create`（`pubType==1` 发布；否则 `post_draft`）
  headers `{referer:".../platform/post/create", cookie, "Content-type":"application/json"}`
  body = `buildPostData$M(...)`：含标题/描述/视频 `DownloadURL`、封面、话题、位置等。
- 成功判定：返回 `errCode==0`，`data` 内含发布对象 id。

**封面上传**（`uploadCover$c`，同 4.1 分片链路，mediaType=image，size ≤ 512KB 否则报「封面大小超限制512kb」）。

> 关键：视频号**发布/编辑页 referer 恒为** `https://channels.weixin.qq.com/platform/post/create`；`apptype=251`；`scene` apply=2、part/complete 视图片(0)/视频(2) 有别（切片已标注）。

### 4.2 B站 Bilibili（视频，upos 分片，自包含）★推荐首做

**csrf**：`regex /\bbili_jct=([a-z0-9]{20,})\b/` 从 cookie 提取（切片 `regex$1`）。缺失 → 「登录失效」。
**文件名**：`${DedeUserID}_${ts}_${ts.substring(9,12)}`（DedeUserID 从 cookie 提取，ts=Date.now()）。

**Step 1 探测上传域名** `getUploadDomainResponse`：
- `GET https://member.bilibili.com/preupload?r=probe` headers `{cookie, Referer:".../platform/upload/video/frame"}` → `{OK:1, lines:[{os, query}]}`。`OK==-101` → 登录失效。重试 ≤3 直到 `OK==1 && lines.length`。

**Step 2 取上传参数** `getUploadArgsResponse$8`：
- `GET https://member.bilibili.com/preupload?<lines[0].query>&r=<lines[0].os>`（回退 `upcdn=bda2&probe_version=20200224&r=upos`）
  params `{name:"frames_<文件名>.zip", size, profile:"ugcupos/bup", ssl:0, version:"2.7.1", build:2070100}` headers `{cookie, Referer:".../upload/video/frame?page_from=creative_home_top_upload"}`
  → `{auth, endpoint, upos_uri, bid, ...}`。需有 `auth` 且 `endpoints.length>0`。

**Step 3 初始化分片上传** `getUploadIdResponse$3`：
- `POST https:<endpoint>/<upos_uri.split("//")[1]>?uploads&output=json` headers `{Referer:"https://member.bilibili.com/", "X-Upos-Auth":<auth>}` → `{upload_id}`。

**Step 4 逐片 PUT** `uploadVideoPart$a`（每片 8MiB，可并发 O 片）：
- `PUT https:<endpoint>/<upos_key>?partNumber=<n>&uploadId=<upload_id>&chunk=&chunkSize=8388608&size=<size>&start=<off>&end=<off+len>&total=<size>&index=<n>&count=<L>&md5=<chunkMd5>&r=<os>`
  headers `{"X-Upos-Auth":auth, Content-Type:"application/octet-stream", Referer:bilibili}`；body=片 Buffer。返回 `200` 即该片成功，收集 `{partNumber, eTag}`（用 Promise.race + splice 控制并发窗口）。

**Step 5 完成合并**（`...?output=json` POST `{parts:[{partNumber,size,eTag}...]}`，header `X-Upos-Auth`）→ 返回 `bw`/`Etag`；记录 `filename=upos_uri` 去前导 `/`。

**Step 6 提交投稿** `publish$g`：
- 发布 `POST https://member.bilibili.com/x/vu/web/add/v3?t=<ts>&csrf=<bili_jct>`；存草稿 `POST https://member.bilibili.com/x/vupre/web/draft/add`。
  headers `{cookie, Referer:".../upload/video/frame", "Content-Type":"application/json;charset=UTF-8"}`，params `{t:Date.now(), csrf:bili_jct}`。
- body = buildPostData（`M` 对象）：`{title, desc(htmlDecode 后正文), desc_format_id:0, tag(逗号串), tid(分区,默认21), copyright, source, dynamic, videos:[{file:<filename>, title, desc:"", cid}], subtitle:{lan,open}, up_close_reply, up_close_danmu, dtime?, mission_id?, topic_id?...}`。风控文案「您上传视频过快」→ 直接失败并提示「前往创作者中心登录后单独发布一个作品完成验证」。
- 成功判定：`code==0`，`data.aid/bvid`。

**封面上传** `uploadImage$5`：`POST https://member.bilibili.com/x/vu/web/cover/up?t=<ts>`，body `csrf=<bili_jct>&cover=data:image/jpeg;base64,<b64>`，headers `{cookie, Referer:".../upload/video/frame..."}` → `data.url`。

### 4.3 百家号 BaiJiaHao（图文/文章，token 自包含）

- base token：`getBaijiahaoBaseToken` GET `https://baijiahao.baidu.com/?source=inner`，正则 `BJH__INIT__AUTH__\s*=\s*['"]([^'"]+)`。
- publish token：`getBaijiahaoPublishArticleToken` GET `https://baijiahao.baidu.com/pcui/article/edit?type=news`（headers 带 cookie/referer/host/baseToken）→ 取**响应头 `token`**。
- 图片上传：`POST https://baijiahao.baidu.com/pcui/picture/uploadproxy`（multipart FormData）。
- 发布/存草稿 `publish$a`：`POST https://baijiahao.baidu.com/pcui/article/publish?type=news&callback=bjhpublish`（草稿 `/article/save?callback=bjhdraft`），headers `{cookie, referer:".../builder/rc/edit?type=news", "Content-type":"application/x-www-form-urlencoded;", token}`，body 为表单编码的文章数据（HtmlDocument/RichTextParser 生成）。
- ⚠️ 个别辅助接口（`getSign$2`→`.../Sign/GetSign` 5012）依赖远程签名器，**不要接**；主发布链不需要。

---

## 5. Tier B 序列 + 待自研签名（二期）

### 5.1 快手（视频）
完整链（切片 `yx-bundle-slices.txt`）：
1. `getUploadArgsResponse$9` `POST cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/pre?__NS_sig3=<sig>` body `{uploadType:1,"kuaishou.web.cp.api_ph":<ph>}`（ph 从 cookie 正则 `kuaishou\.web\.cp\.api_ph=([a-z0-9]+)`）。
2. 分片 `uploadVideoPart$b` `POST https://<endPoints[0]>/api/upload/fragment?upload_token=<token>&fragment_id=<i>` headers `{"Content-Range":"bytes <start>-<end>/<total>","Content-Type":"application/stream", Referer:"https://cp.kuaishou.com/"}` body=片。
3. `POST https://<endPoints[0]>/api/upload/complete?fragment_count=<L>&upload_token=<token>`。
4. `getUploadedVideoInfo$3` `POST cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/finish?__NS_sig3=<sig>` body `{token,fileName,fileTyp:"video/mp4",fileLength,"kuaishou.web.cp.api_ph"}` → `{fileId}`。成功 `result===1`。
5. 封面 `uploadImage$7` `POST cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/cover/upload`（FormData：`file` + `kuaishou.web.cp.api_ph`）→ `{coverKey}`。
6. 投稿 `buildPostData$I` + 发布接口（同带 `__NS_sig3`）。
- **阻塞点**：`__NS_sig3 = getSign$5(JSON.stringify(body))` 远程签名。自研方向：快手 web cp 的 sig3 是其前端 JS 生成的反爬签名，需从 `cp.kuaishou.com` 前端 bundle 逆向；工作量大。**一期不做。**

### 5.2 抖音（视频）— Tier B 中「准自包含」，值得单独试点
- `getSdkToken$2`：`HEAD https://creator.douyin.com/web/api/media/aweme/create/` headers `{cookie, "x-secsdk-csrf-request":1, "x-secsdk-csrf-version":"1.2.7", referer:".../content/upload"}` → 取响应头 `x-ware-csrf-token` 的 `,` 分隔第 2 段。**纯本地可达，无远程签名器。**
- `getAuthKey$2`：`GET creator.douyin.com/web/api/media/upload/auth/v5/` → 上传鉴权（含 AK/SK，走 aws4Interceptor region `cn-north-1`）。
- 提交 `create_v2`：`POST creator.douyin.com/web/api/media/aweme/create_v2/?...&msToken=<from cookie>&a_bogus=` headers `{cookie,"User-Agent", "x-secsdk-csrf-token":<sdkToken>, "bd-ticket-guard-version":"2","bd-ticket-guard-web-version":<1|2>,"bd-ticket-guard-ree-public-key":<从 cookie bd_ticket_guard_client_data_v2 base64 解出 ree_public_key>,"bd-ticket-guard-client-data":<clientSign(cookie)>,"bd-ticket-guard-web-sign-type":"0","bd-ticket-guard-iteration-version":"1", Referer:".../content/publish...", Origin:"https://creator.douyin.com/"}`。
- `clientSign(cookie)`（**本地**）：取 cookie `security-sdk/s_sdk_crypt_sdk` → JSON→base64 解出 `ec_privateKey`；取 cookie `security-sdk/s_sdk_sign_data_key/web_protect` → 解出 `{ticket, ts_sign}`；`crypto.createSign('SHA256').update('ticket='+ticket+'&path=/web/api/media/aweme/create_v2/&timestamp='+unixSec).sign(privateKey,'base64')`；组 `bd-ticket-guard-client-data`。
- **注意**：切片里 `a_bogus=` **为空**——若抖音对该路径不强校验 a_bogus，则抖音整链可纯自研复用（无 refpub 依赖）；若风控回 `x-tt-verify-passport-decision`/滑块，则需补 `a_bogus`（SM3+RC4+自定义 base64，公开逆向充足）与验证处理。建议：**二期首个试点**，先小流量验证空 a_bogus 是否可行。

---

## 6. Cookie 获取与多账号登录态复用（我们侧对接点）

本仓已具备能力，无需新造：
- 平台登录态由 Electron `<webview>` session 持久化（`shared-user-data/backend-data/accounts.json`，7 平台）。
- 抽取 Cookie：对某账号对应的 `WebContentsView`/session 调 `session.cookies.get({url})` 拼成 `k=v; ...` 串。⚠️ **HttpOnly cookie 必须在主进程用 `session.cookies.get` 取，不能用 `document.cookie`**。
- UA 必须与实际登录会话一致（同一 session 的默认 UA），否则签名/风控不匹配。

## 7. 与现有代码的集成契约

新增目录与服务（不改坏现有队列，做成并列通道）：
```
apps/desktop/electron/services/publish-api/
  core/http-client.js        // §2.2 $http 等价：timeout60s + retryCondition(!isJson) + 代理注入
  core/progress.js           // publishStatusEnum + SetProgress(Event/NewEvent) → 桥接到队列事件
  core/cancel.js             // CancelToken
  core/upload-gate.js        // UploadEmitGate（照搬）
  core/chunker.js            // 8MiB 分片读取
  core/cookies.js            // 从 webview session 取 cookie 串 + UA
  platforms/shipinhao.js     // §4.1
  platforms/bilibili.js      // §4.2
  platforms/baijiahao.js     // §4.3
  platforms/douyin.js        // §5.2（二期）
  platforms/kuaishou.js      // §5.1（二期，签名阻塞）
  index.js                   // publishVideoViaApi(accountId, platform, {video,cover,caption,...})
```
接线：
- 队列服务（`getQueueStatus/getQueueHistory/publishBatch`）新增 `strategy: 'api' | 'dom-rpa'` 字段；`api` 走 `publishVideoViaApi`，`dom-rpa` 保留旧 `rpa-view-platforms.js` 作回退。
- 成功回写：API 返回体里的平台原生 id（`bvid`/视频号 post object id/百家号 `errno+url`）填进 `STRICT_PUBLISH_ID` 所需的真 `postId`，替代现在从 DOM 猜 id 的脆弱路径。
- 进度/取消：`core/progress.js` 直接 emit 现有队列进度事件，UI 无感。
- 配置：平台选择器 `packages/rpa-engine/src/platform-selectors.js` 增 `publishStrategy` 映射（视频号/B站/百家号=api 优先）。

## 8. 落地阶段计划

| 阶段 | 内容 | 验收证据 |
|------|------|----------|
| P0 | `publish-api/core/*` 基础设施（http/progress/cancel/gate/chunker/cookies） | 单测：Content-MD5/bili_jct 提取/分片边界/UploadEmitGate 节流 |
| P1 | **B站** 视频 API 发布（§4.2） | 活体 1 条真实投稿，`bvid` 可在 member.bilibili.com 作品列表回查 |
| P2 | **视频号** 视频 API 发布（§4.1） | 活体 1 条，post 在 channels.weixin.qq.com 可回查 |
| P3 | **百家号** 图文 API 发布（§4.3） | 活体 1 篇，文章 URL 回查 |
| P4 | 接入队列 `strategy:'api'`，灰度与 DOM 回退并存；caption/封面贯通 | 5 条选题×Tier A 平台端到端 |
| P5 | **抖音**（§5.2）准自包含试点：先验空 `a_bogus` | 若通过则纳入；否则记录风控码后转 Tier B 专项 |
| P6 | 快手/小红书（§5.1）签名自研 | 二期立项，风险最高 |

## 9. 成功判定与错误码（跨平台约定）

| 平台 | 成功 | 登录失效 | 常见失败 |
|------|------|----------|----------|
| 视频号 | `errCode==0` + post id | `300333/300334` | 获取用户信息失败 / 封面超512KB |
| B站 | `code==0` + `data.bvid` | `OK==-101` / 无 bili_jct | 「您上传视频过快」风控验证 |
| 百家号 | `errno==0` | 需重取 token | 非 JSON（HTML 验证页）→ 重试 |
| 快手 | `result===1` + fileId | checkKuaiShouLogin 无 `kuaishou.web.cp.api.at` | sig3 缺失 |
| 抖音 | `status_code==0`/含 aweme_id | — | `x-tt-verify-passport-decision`（需验证）、空 a_bogus 被拒 |
| 通用 | `$http` 返回非 JSON = 被弹回验证页 | | retryCondition 触发 3 次仍 HTML 即失败 |

## 10. 风险与合规

- **反爬/风控**：API 直发可能触发平台风控（滑块/短信/「发布过快」验证）。缓解：真实 UA + 完整 cookie + 合理频控 + `retryCondition` 识别 HTML；触发验证时**回传 UI 让用户在 webview 内人工完成验证**再重试（B站已内置该提示文案）。
- **签名漂移**：平台前端签名算法会更新，API 式虽免疫 DOM 改版但**受签名版本影响**；须监控非 JSON/特定错误码并快速跟进。
- **合规**：仅发布用户自有内容与自有账号；不得绕过平台账号级限制（真人验证弹窗必须交还人工）。
- **禁止项（硬红线）**：任何对 `*.refpub.cn` 的请求。代码里不得出现该域名常量；CI 可加 grep 门禁：`grep -R "refpub\.cn" apps/desktop/electron/services/publish-api` 必须为空。

## 11. 附录：bundle 关键定位（便于复核/继续逆向）

| 符号 | 偏移(@) | 说明 |
|------|--------|------|
| `getSignServerUrl` | 591720 | Tier 划分依据（签名器端口映射） |
| `getSdkToken$2`/`aweme create` | 837894 | 抖音 sdk token |
| 抖音 `create_v2`+`clientSign` | 2672895 | 抖音本地签名 + 空 a_bogus 证据 |
| `applyuploaddfs`/`getUploadId$1` | 984912 | 视频号申请上传 |
| `uploadpartdfs`/`uploadImage$a` | 986392 | 视频号分片（本地 md5） |
| `completepartuploaddfs`/`getUploadedVideoInfo$4` | 995595 | 视频号合并 |
| `publish$m`/`buildPostData$M` | 996464 | 视频号 post_create |
| `shipinhaoPublishVideo` | 1092626 | 视频号编排 |
| 快手 `getUploadArgsResponse$9`/`/rest/cp/works` | 1345198 | 快手上传 pre |
| `getSign$5`(快手)/signPorts 5004-5008 | 1341838 | 快手远程签名（禁用） |
| `uploadVideoPart$b`/fragment | 1379903 | 快手分片 |
| `publishKuaishouVideo` | 1389174 | 快手编排 |
| B站 `regex$1`(bili_jct)/nav | 1425381 | B站 cookie csrf |
| `getUploadDomainResponse`/`uploadVideo$u` | (见 yx-bili-upload.txt) | B站 preupload/upos |
| `publish$g`(add/v3) | 1466868 附近 | B站投稿 |
| `publishBilibiliVideo` | 1466868 | B站编排 |
| `getBaijiahaoPublishArticleToken` | 1841789 | 百家号 token 自包含证据 |
| 百家号 `publish$a` | 1859400 | 百家号发布 |

> 切片原文（脱壳片段）已随本文档入库：本目录 `01-docs/rpa-api-publish/evidence/` 下 `yx-bundle-slices.txt`、`yx-orch.txt`、`yx-bili.txt`、`yx-bili-upload.txt`、`yx-bjh-check.txt`。逆向原始高层文档：`_逆向工程_参考产品4.0/RPA分析报告.md`、`可复用代码分析.md`。切片生成脚本（按关键词/偏移从 bundle 抽取）：`.agent_context/staging/yx-slice*.js`。
