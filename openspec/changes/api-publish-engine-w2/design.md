# Design: api-publish-engine-w2（抖音准自包含发布链）

## 1. 证据基线与待补面

| 步骤 | 证据切片 | 状态 |
|------|----------|------|
| getSdkToken（HEAD csrf） | `yx-bundle-slices.txt @837894`（含 URL 轮换池 `%3`） | ✅ 逐字在手 |
| getAuthKey v5（上传鉴权） | 同上（`upload/auth/v5/` GET，retryCondition=!isJson） | ✅ |
| 视频分片上传（TOS/aws4） | `@837894` 尾部 `uploadCover$d` 截断段 + `aws4@633934`（签名算法库） | ⚠️ 需 tasks 1.1 前置补提（从 bundle 回提取 upload 全段：endpoint 选择、Key/Auth 字段、分片方式、finish 响应→videoId 字段名） |
| create_v2 提交（头组/查询串/风控分支） | `yx-bundle-slices.txt @2672895`（完整头组 + msToken 回退 + x-tt-verify 分支） | ✅ |
| clientSign 本地签名 | `yx-slices-v2b.txt douyin-clientSign@2673500`（双层解码 + SHA256/EC + base64 组装 + fail-closed throw） | ✅ |
| buildPostData_v2 body 字段 | 截断段引用未展开 | ⚠️ 需 tasks 1.2 补提（title/video_id/cover/可见性/图文声明字段映射） |

**取证事实源路径（本规划已核实）**：bundle 实际在 `D:\Data\yixiaoer-extracted\packages\main\dist\index.cjs`（8401332 bytes，SHA256 `EC829DA4CD41871B84D589537955AE875EEF08C9CC1AB08AB1BD856F3F8008BC`；与 `D:\Data\yixiaoer-asar-extract` 同字节）。历史文档中的 `D:\Data\refpub-bundle`（refpub 为参考产品厂商域）为陈旧路径，盘上已不存在。已核实 `@837894`（aws4Interceptor 注册段）/`@633934`（aws4 `AWS4-HMAC-SHA256` authHeader）逐字对齐，证明现有切片即源自本 bundle。

**实现顺序硬约束**：tasks 1.1/1.2 取证未完成的 upload/body 两块，对应实现任务不得凭记忆先行（禁止臆造契约，见 AGENTS 供应商契约会则）；已在手证据的 4 块可即刻 TDD。

## 2. 链结构（platforms/douyin-video.js）

复用 W1 `publish/core` 基座（http-base axios 工厂、contract 校验、errors 语义码、emit-gate 节流、spacer/riskSuspender 联动经 publishWithMode 单例无需感知）。步骤序列：

```
0) 前置校验（零请求 fail-closed）：
   cookie 必含 security-sdk/s_sdk_crypt_sdk、security-sdk/s_sdk_sign_data_key/web_protect、
   bd_ticket_guard_client_data(_v2)、sid_tt；clientSign 预生成失败 → throw「账号信息缺失，请重新授权」
   视频文件存在性 stat()（io_error）
1) sdkToken = GET/HEAD csrf：HEAD URL 池 [anchor/search, aweme/create/, homepage/module/]
   idx%3 轮换；headers {cookie, Accept, referer:/content/upload, x-secsdk-csrf-request:1,
   x-secsdk-csrf-version:'1.2.7'} → headers['x-ware-csrf-token'].split(',')[1] ?? ''
2) authKey = GET upload/auth/v5/（retryCondition=!isJson ≤3）→ {AK,SK,sessionToken?,auth,bucket,endPoint,region...}
   ⚠️ 字段名以 tasks 1.1 补提切片为准
3) 上传：aws4 签名（region cn-north-1, service 由 auth 响应定）对 TOS 端点 PUT/POST 分片
   —— 对齐既有分片器 8388608 与 Content-Range 语义（若取证表明抖音为整文件单 PUT 则按实际，分片模式以 tasks 1.1 切片钉）
   完成 → videoId（字段名待 tasks 1.1 钉）
4) 封面：uploadCover（aws4 同源，auth JSON 解析）→ coverUri/coverUrl（待 tasks 1.1 钉）
5) 提交：POST create_v2/?read_aid=2906&cookie_enabled=true&...&aid=1128&support_h265=1
   &msToken=<cookie 或 a12man123masb${Date.now()}>&a_bogus=（空）
   headers: {cookie, UA, Content-Type:application/json, x-secsdk-csrf-token,
     bd-ticket-guard-version:'2', bd-ticket-guard-web-version: ticket.startsWith('hash')?'2':'1',
     bd-ticket-guard-iteration-version:'1', bd-ticket-guard-web-sign-type:'0',
     bd-ticket-guard-ree-public-key, bd-ticket-guard-client-data, Referer:/content/publish, Origin}
   body = buildPostData_v2(taskData, videoId, cover, ...)  .trim()
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

`bd-ticket-guard-ree-public-key` 提取同为 registry 命令 `douyin.ticket-guard-ree-public-key`（payload={cookie}）：优先 `bd_ticket_guard_client_data_v2`（decodeURIComponent→base64→JSON.ree_public_key），回退 `bd_ticket_guard_client_data`（base64 解码 utf-8 后按切片正则取键）。

**安全红线**：私钥/ticket 材料只存内存与请求头，禁止 logger 序列化输出（错误路径打印需脱敏）；证据文档域切片不含真实私钥值（占位符化）。

## 4. 双轨与风控接线（零新增架构）

- `platforms.yaml` douyin：`dom-only → api-then-dom` 一行；`publishWithMode`/降级日志/挂起守卫/频控全自动继承（W1 §5 enforcement 的 `platform::accountId` 键天然覆盖 douyin）。
- risk_blocked 判定并入 `publish-risk.isRiskBlocked`：新增 douyin 信号——响应头 `x-tt-verify-passport-decision` 与 `status_code===110`（切片验证失败语义），命中即 suspend + `publish:risk-suspended` 广播（复用桌面横幅/人工恢复，无新 UI）。
- AI 声明字段：切片取证若发现 create_v2 body 有声明位（如 `statement`/aigc 标记）按 Q 红线默认如实声明平移；无则验收报告注明。

## 5. Adapter 重指向（§4.4 委托模式）

`adapters/douyin.js` 保留 BaseAdapter 契约面（checkLogin/headers 复用），`publish()` 变薄委托 `douyin-video.publishDouyinVideo(http, task, cookie, {proxy, onProgress})`；删除旧 `aweme/post` 链与 `getDouyinSignature` import（grep 门禁扩展：`aweme/post|_signature` 在 src 运行时代码零命中）。委托测试模式对齐 shipinhao-adapter（uploadVideo/封面/委托契约/fail-closed 四类）。

## 6. 依赖决策

- aws4 签名：新增 npm 依赖 `aws4`（单文件零依赖 MIT，参考产品内嵌同款算法）——**否决**自研复刻（易错且无必要）与完整 `@aws-sdk`（过重）。lockfile 变更按规范在单一 worktree 一次 `pnpm install` 并提交（本 W2 worktree 即该唯一执行点）。
- 其余零新增：crypto/node 内置、http-base 复用。

## 7. 测试矩阵（本机假服务器，零外发）

| 套件 | 钉住内容 |
|------|----------|
| douyin-video-chain.test.js | 步骤序列与每步 method/URL 前缀/headers 白名单/body 字段（对照切片逐字）；8MiB 分片三边界（视 tasks 1.1 取证结果调整单/多片）；x-tt-verify → risk_blocked；非 JSON ≤3 重试语义；msToken 缺失回退伪值 |
| douyin-fail-closed.test.js（并入链测试） | 四类签名材料 cookie 逐一缺失 → 零请求；私钥 PEM 非法 → throw 重新授权；文件不存在 → io_error 零请求 |
| clientSign 单测 | 固定测试用自生成 EC 私钥 + 构造 cookie → 断言 base64 三层结构与 req_content 契约、timestamp 单调、失败消息 |
| douyin-adapter.test.js | 委托契约（成功/失败归一/fail-closed 透传/零请求）|
| publish-mode 回归 | douyin api-then-dom 降级 DOM、risk 不降级（既有 suites 扩展平台行） |

## 8. 活体裁决（M2，用户在场门槛）

前置：W2 代码合入 + W1 §7.5 共用账号窗口。执行：真实标题私密/草稿优先 1 条 → 平台前台回查 → 证据四件套（作品ID/链接/回查截图/degraded 标志）入 `evidence/api-w2-douyin/`；风控即停不换号。裁决结果（go/no-go + 平台响应记录）回写 PRD F11 与 techdoc 修订记录；no-go 时 platforms.yaml 回拨 dom-only（独立小 PR）。

## 9. 决策记录（本波新增，decided）

- D1 不移植 checkByPassword 自动验证：合规红线（风控即停），二次提交路径整体砍掉。
- D2 msToken 回退伪值保留（切片原样 `a12man123masb${Date.now()}`）：真实 msToken 来自 cookie 常态存在，伪值仅防 null 拼 URL；不引入 msToken 算法。
- D3 csrf URL 池轮换 `%3` 保留：降低 HEAD 探测同质化；本仓以 idx=1（aweme/create/）为默认，池序不变。
- D4 clientSign 走 registry 而非 platforms 内联：统一签名抽象层纪律（Q3），W3 签名页基建可复用同一注册面。
