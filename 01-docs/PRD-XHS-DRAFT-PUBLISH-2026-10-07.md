# PRD：小红书草稿箱发布（xhs-draft-publish，2026-10-07）

> 需求来源：热门选题 E2E ——「其中小红书比较特殊，只需要实现放在小红书草稿箱就行」

## 1. 背景与问题

热门选题一键生成视频/图文后要「能发的都发」。7 个平台中 6 个已有可用发布链，
**小红书此前是唯一一条走不通的链路**，根因有三处（均已实证）：

| # | 缺陷 | 证据 |
|---|---|---|
| 1 | 签名是占位实现 | `signer-local.js` 的 `getXiaohongshuSign` = `md5(ts + "MirAR" + body)`，与平台算法无关 |
| 2 | 签名被塞进 query | `adapters/xiaohongshu.js` 写 `params = { sign: {X-s, X-t} }`，对象会被序列化成 `sign=[object Object]` |
| 3 | 端点不存在 | 该 adapter 打 `/api/publish`；平台真实提交通道见 §2 |

另：`signer-assembly.js` 里小红书标着 `verified: false`、`moduleId: -1`，
注释写「x-s 依赖外包签名服务，本波只留 provider 槽不激活链」——**该链路从未真正启用过**。

## 2. 平台接口（公开资料实证）

### 2.1 三步发布

```
1. POST https://creator.xiaohongshu.com/api/media/v1/upload/web/permit
   body: { file_name, file_size, media_type }
   resp: { code:0, data:{ file_id, token, cos_key } }

2. PUT  https://ros-upload.xiaohongshu.com/{file_id}
   headers: X-Cos-Security-Token: <token>
   body: 图片二进制

3. POST https://edith.xiaohongshu.com/web_api/sns/v2/note
   headers: Cookie + Authorization: AT <token> + 小红书签名头
   body: { title, desc, image_list:[{file_id}], draft }
```

### 2.2 认证

| 凭据 | 用途 |
|---|---|
| Cookie `a1` | 签名必需（fail-closed 校验项） |
| Cookie `web_session` | 会话 |
| Cookie `access-token-creator.xiaohongshu.com` | `Authorization: AT <token>` |

### 2.3 签名（X-s / XYW_ 形态）

```
X-s = "XYW_" + hex(AES-128-CBC(
         base64("x1={md5('url=' + fullUri)};x2={envFlags};"
                "x3={a1};x4={timestampMs};"),
         key = 7cc4adla5ay0701v, iv = 4uzjr7mbsibcaldp))
```

配套请求头：`x-t`（毫秒时间戳）、`x-s-common`（设备指纹）、
`x-b3-traceid`(16 hex)、`x-xray-traceid`(32 hex)。

**关键取舍：只实现 `XYW_`，不实现 `XYS_`。** 公开资料显示老 `XYS_` 形态已被小红书
数据接口以 **HTTP 406** 拒绝，只有 `XYW_` 可用（Go 版独立实现
`tamnd/xiaohongshu-cli` 同样只走 `XYW_`，两者常量互相印证）。

## 3. 方案选择

| 方案 | 评估 |
|---|---|
| A. 移植算法到 JS | XYW_ 本质是纯 AES-128-CBC，Node 内置 `crypto` 一等公民，约 150 行；无 IPC、无额外进程 |
| B. Python bridge 调用 xhshow | 需拉起常驻 Python 服务、加 IPC 往返；算法本身不依赖浏览器/VM 环境，bridge 是纯开销 |

**选定 A**（算法取自开源实现，载体用 JS）。与既有 kuaishou 的隐藏浏览器抽签不同：
**不开任何窗口**，因而不会引入 `wechat_mp` / `baijiahao` 那类隐藏窗口原生崩溃面。

## 4. 功能需求

| # | 需求 | 验收 |
|---|---|---|
| FR-1 | 生成真实 `XYW_` 格式 X-s | 与参考实现逐字节等价（交叉校验脚本钉住） |
| FR-2 | 签名失败 fail-closed | 缺 `a1` 抛错，**不得**退回占位签名 |
| FR-3 | 签名以独立 header 下发 | 不得出现 `sign=` query 参数 |
| FR-4 | 三步链路（permit → PUT → note） | 顺序与端点严格按 §2.1 |
| FR-5 | **默认草稿**（`draft: true`） | 内容落创作者中心草稿箱，不公开发布 |
| FR-6 | 无图片 fail-closed | 平台不支持纯文字笔记 |
| FR-7 | 业务错误码如实上报 | `code != 0` 抛错，**不得**当成功 |
| FR-8 | 不创建 BrowserWindow | 求签不触碰隐藏窗口（安全不变量） |

## 5. 非功能需求

- 纯本地计算：签名只依赖 `node:crypto`，不引入新依赖
- 平台兼容性：`envFlags` / `webBuild` 等指纹常量集中单点维护，平台改版时改一处
- 可解密调试：保留 `x-s` 解码能力定位签名不匹配

## 6. 落地范围

| 文件 | 变更 |
|---|---|
| `packages/api-publish-engine/src/signer-local.js` | 真实 XYW_ 实现（替换 md5 占位） |
| `packages/api-publish-engine/src/publish/platforms/xiaohongshu-draft.js` | **新增**：三步草稿箱发布链 |
| `packages/api-publish-engine/src/adapters/xiaohongshu.js` | 重写：修端点 + 修签名结构 + 加草稿语义 |
| `apps/desktop/electron/signer/signer-assembly.js` | 小红书改 `localAlgorithm` 形态（不开窗） |
| `apps/desktop/electron/tests/signer-xhs-local.test.js` | **新增**：激活与安全不变量 |
| `packages/api-publish-engine/tests/signer-local-xyw.test.js` | **新增**：签名契约 |
| `packages/api-publish-engine/tests/signer-local-xyw-crosscheck.js` | **新增**：与参考实现交叉校验 |

## 7. 风险与遗留

| 风险 | 处置 |
|---|---|
| 平台改签名算法 | 常量单点维护；签名头是唯一收敛点，改版只动一处 |
| `envFlags` 失配导致 406/签名不匹配 | 默认取常规桌面 Chrome 取值；失配时有明确报错而非静默成功 |
| 草稿箱接口无公开文档 | 依据 `xhs-mcp` / `openclaw-xiaohongshu-skill` 等公开实现的端点与字段形态；真机验证为最终判据 |
| **尚未真机验证** | 本 PR 完成的是实现 + 契约测试 + 交叉校验；**草稿箱真机写入待验证**，未验证前不得宣称可用 |

---

# 增补：XYS_ 签名页升级 + note 页内整发（2026-10-10 增补）

> 增补来源：#3215（签名代差根因）+ #3257（页内整发机制）。原 PRD 第 3 章的技术选型 A（本地 XYW_ 纯算法）
> 已被真机取证推翻，本章为现行有效方案。

## 8. 签名代差根因（真机取证结论）

### 8.1 事实链

| # | 事实 | 取证方式 |
|---|---|---|
| 1 | 真机浏览器 x-s 是 **XYS_ 前缀**（约 300 字符） | CDP attach 签名页抓 28 条请求（`.agent_context/xhs-real-signature-sample.json`）|
| 2 | 页内生成入口是 `window._webmsxyw(url, data)` | CDP `Runtime.evaluate typeof` 直证 |
| 3 | 返回形态为 Base64 JSON 信封 `{signSvn:"56", signType:"x2", appId:"ugc", signVersion:"1", payload:<hex>}`，长度 664 | 页内调用解码 |
| 4 | 本地 XYW_（AES-128-CBC 定长 hex，~420 字符）是**旧协议仿制**，与信封结构完全不同 | 结构对比 |
| 5 | note 端点（edith `/web_api/sns/v2/note`）只认新签名：带页内签名+登录态后响应从 406 变 **业务层响应** | probe 全链真机 |
| 6 | 原记载「XYS_ 已被 406 拒、只有 XYW_ 可用」**已失效** | 本文件 8.1-1/5 与其矛盾，以本章为准 |

### 8.2 对第 3 章选型的修订

- **选项 A（本地 XYW_ 纯算法）作废**：签名格式代差不可用参数修补弥合。
- **现行方案 C（页内求签，browser 形态）**：隐藏 sandbox BrowserWindow 加载 `creator.xiaohongshu.com`，
  页内执行 `window._webmsxyw` 取真签名——与浏览器行为逐字节一致，随平台升级自动跟随。
- 本地 `signXiaohongshuLocal`（XYW_ AES）保留为**降级路径**（轻接口登录巡检仍可用），note 链不再直连。

## 9. 页内整发机制（pageInpage，本 PR #3257）

### 9.1 数据校验

| 校验 | 规则 | 失败行为 |
|---|---|---|
| accountId | 与 credential-diagnostics 同款正则 `^[a-zA-Z0-9_-]+$` | 主进程侧 fail-closed 返回 `stage:validate` |
| a1 cookie | 缺失即抛 `XHS_MISSING_A1`（链入口） | 不发起任何请求 |
| Authorization | 缺失即抛 `XHS_MISSING_AUTHORIZATION` | 同上 |
| images | 空数组抛 `XHS_NO_IMAGE`（平台不支持纯文字） | 同上 |
| title | 非空，超 20 字截断 | — |
| sendNote 返回 status>=400 | 抛 `XiaohongshuDraftError`（携带 httpStatus） | 中止链路，探针如实回传 |
| sendNote 返回 code!==0 | `assertBusinessOk` 抛业务错误（bizCode/bizMsg 入 chainDetail） | 同上 |
| draft 锁 | probe 通道**锁死 true**（#3215 审查 i2），调用方传 draft:false 被忽略 | — |

### 9.2 流程（页内路径）

```
probe 调用（renderer → IPC xiaohongshu:probe-draft-chain）
  → 阶段1 凭据解密（DPAPI，主进程内）
  → 阶段2 签名器装配（browserPageProvider 桥，fail-closed → stage=signer-bridge）
  → 阶段2.5 页内整发准备：
       bindSignerCookie("xiaohongshu", accountId, cookie)   ← cookie in-proc 注入页 session
       asm.getOrCreatePage(...)                             ← 取签名页句柄（按账号隔离）
       构造 sendNote = 页内 executeJavaScript(fetch(url, {headers, body, credentials:"include"}))
       任一步失败 → 降级回 http 路径（pageInpage=undefined，只进日志不阻断）
  → 阶段3 链执行：permit(GET) → ros-upload(PUT) → note（pageInpage.sendNote 页内整发）
       note 失败语义与 http 路径一致（业务码入 chainDetail 回传）
```

### 9.3 功能逻辑要点

- **签名页按账号隔离**：`platform::accountId` 键复用页实例；挂起/异常页下次求签自动重建（自愈）。
- **降级三层**：页内整发准备失败 → http 路径；签名页连续失败 ≥3 次 → degraded 拒签（await 自愈/手动 resetState）；
  localAlgorithm（XYW_）仅剩登录巡检等轻接口使用。
- **零回归**：`pageInpage` 缺失时 `submitNote` 行为与 #3215 前完全一致（单测钉住）。
- **noteOrigin**：`creator`/`edith` 双路由在页内路径同样生效（A/B 对照保留）。

### 9.4 交互逻辑（探针回传面）

| 字段 | 说明 |
|---|---|
| `data.stage` | `validate` / `credentials` / `signer-bridge` / `publish`——失败发生在哪一段 |
| `data.errorCode` | `XHS_*` 系列错误码 / 平台 bizCode |
| `data.chainDetail` | `{bizCode, bizMsg, topKeys, dataKeys, successFlag}`——键名级诊断，不含响应值 |
| `data.failedEndpoint` | 失败端点（origin+path，query 剥离） |
| `data.noteId/draftId` | 成功时的产物标识（非凭据，可回传） |

### 9.5 显示项与提示文字

| 场景 | 提示 |
|---|---|
| 凭据缺失 | `缺发布链硬凭据: <cookie 名列表>` |
| 签名页未就绪 | `签名器装配失败: <原因>`（stage=signer-bridge）|
| 业务拒绝 | `note 失败：code=<bizCode> <bizMsg>`（message 经 sanitizeMessage 脱敏）|
| 页内整发准备失败 | 仅日志 `inpage-prep-failed`（自动降级 http，不打断用户）|

### 9.6 安全边界（延续 #3172/#3215 五轮审查确立）

- cookie/Authorization 值**永不回传** renderer（白名单 12 键：bizCode/键名数组/布尔旗标级）
- 探针 draft 锁死 true，公开发布走产品正式通道
- 页内脚本只回签名与响应 JSON，不回 DOM/源码（extractor 合规边界）
- prewarm/求签 IPC 保持 isTrustedSender 校验（Gate 17）

## 10. 真机验证现状与遗留

| 项 | 状态 |
|---|---|
| permit + ros-upload | ✅ 真机通过（#3215）|
| note 签名（页内 XYS_） | ✅ 签名关已过（业务层响应替代 406/401）|
| note 业务受理 | ⚠️ `code:-1`（无 msg）——**端点域不匹配**：edith 不吃 creator 会话（401 实证），creator 域同名端点 404 |
| 下一刀 | 抓登录后「手动存草稿」的真实页面交互流量（CDP 拦截）→ 定位真实草稿保存端点与参数 → 替换 NOTE_PATH → 全链闭环 |

---

# 增补二：对齐参考产品A形态 + 凭据载体根因（第二轮增补，2026-10-10 晚，#3280）

> 来源：参考产品A逆向（`.agent_context/competitor-research-xhs.md`）+ xhshow 系列开源项目调研。
> 本轮把请求形态全部对齐参考产品A后，note 响应从 406/-1 推进到 **-100「无登录信息」**——
> 格式已被平台接受，暴露出最后一块拼图：**账号凭据缺主站 web_session cookie**（登录载体差异）。

## 11. 请求形态契约（对齐参考产品A publish$j/buildPostData$J，现行有效）

### 11.1 请求头

```
Cookie: <完整凭据串（a1 轮换后：a1old=旧值; a1=新值; …）>
referer: https://creator.xiaohongshu.com/
Origin:  https://creator.xiaohongshu.com
Authorization: **不发送**（参考产品A实证置空；AT 跨域半认可触发 code:-1）
Content-Type: application/json;charset=UTF-8
User-Agent: 与签名页环境一致
X-s / X-t / X-S-Common: 页内签名产物（bridge 注入，参考产品A由签名服务返回）
```

### 11.2 note body（参考产品A publish$j 形态）

```json
{
  "common": {
    "type": "normal",
    "title": "<≤20字>",
    "note_id": "",
    "desc": "<正文>",
    "source": "{\"type\":\"web\",\"ids\":\"\",\"extraInfo\":\"{\\\"systemId\\\":\\\"web\\\"}\"}",
    "business_binds": "{\"version\":1,\"noteId\":0,\"bizType\":0,\"noteOrderBind\":{},\"notePostTiming\":{},\"groupBind\":{},\"noteCollectionBind\":{\"id\":\"\"}}",
    "ats": [],
    "biz_relations": null,
    "hash_tag": [{"id":"","name":"…","link":"","type":"topic"}],
    "post_loc": null,
    "privacy_info": { "op_type": 1, "type": <visibilityType> }
  },
  "image_info": { "images": [{
    "file_id": "<permit 返回>", "height": 4096, "width": 4096,
    "extra_info_json": {"mimeType": "image/png"},
    "metadata": {"source": -1},
    "stickers": {"floating": [], "version": 2}
  }] },
  "video_info": null
}
```

**注意：平台 body 没有 draft 字段**——「草稿/私密」语义由 `privacy_info.type` 承担
（`VisibleTypeEnum`：0=public / -1=unPublic / **1=private** / 2=fan）。原 `draft:true` 平台不认。

### 11.3 a1 轮换

签名产物含新 a1（设备指纹滚动）时，请求 cookie 做：`a1=<旧>→a1old=<旧>; a1=<新>`。
链内已实现（submitNote rotatedCookie），probe 自动跟随。

## 12. 真机验证证据链（三轮迭代，#3280）

| 轮次 | 形态 | note 响应 | 判定 |
|---|---|---|---|
| 1 | 旧形态（draft:true + AT 头 + 短模板 X-S-Common） | 406 | 网关拒 |
| 2 | #3215 页内签名（XYS_）但 AT 头仍在 | code:-1（空 msg） | AT 跨域半认可 |
| 3 | 本轮对齐形态（无 AT + 参考产品A body） | **code:-100「无登录信息」** | 格式被接受，进入会话鉴权层 |

## 13. 凭据载体根因（最终确认，诚实登记）

- **-100 = 账号凭据缺主站 `web_session` cookie**。取证：`accountCredentialNames` 返回 20 个
  cookie（a1/AT/galaxy session/…）**无 web_session**；CDP `Network.getCookies` 对 edith 请求
  的模拟同样缺它。
- 参考产品A的账号登录走 **www.xiaohongshu.com 主站**（拿全量含 web_session 的 cookie）；
  我们的登录走 **creator webview**（只有创作者中心域的会话）——登录载体差异，非链路代码问题。
- **修复归属**：xiaohongshu 账号登录流程改造（登录页导航到主站或补抓主站会话），独立工作项。
- **发送路径决策**：主进程直发（显式全量 Cookie 头，参考产品A同款）。页内整发被否——浏览器 fetch
  禁显式 Cookie 头且凭据本就无 web_session，页内会话注定无登录态。

## 14. 开源生态情报（xhshow 系列调研结论）

| 项目 | 形态 | 对我们的价值 |
|---|---|---|
| Cloxl/xhshow（Python，MIT） | XYS_ 纯算（signSvn 56）+ x-s-common + x-rap-param | 算法参照；x-rap-param 是发布类接口风控头（后续需要）|
| xhshow-js / @ikenxuan/xhshow-ts | TS 移植，含 **signFormat:"xyw"**（AES，数据接口绕 406）与 **SessionManager**（会话状态）| 我们 signer-local 的 XYW_ 与其 xyw 同源；SSK 会话（x6/x7）是增强方向 |
| tamnd/xiaohongshu-cli（Go，Apache-2.0） | **clean-room XYW 实现**（常量逐字节一致：AES key/IV/envFlags/signSvn=56） | 交叉验证我们 signer-local 的正确性 |
| Tonwed/xhs_sign_service（Playwright 服务） | 浏览器池签名服务 | 与我们签名页方案同思路，佐证架构正确 |

**情报总结**：XYS_（mns0301 档）是现役网页端签名；XYW_（AES-128-CBC）是数据接口绕 406 的替代档；
两者常量与我们 signer-local 一致。**发布类接口额外需要 x-rap-param**（基于 URI+body 的 MurmurHash），
note 全链闭环后的候选增强项。

## 15. 登录载体改造：二段式补跳主站（#3309）

**决策**：登录 URL 不改（保持 creator 域，用户体验一致），登录成功后**自动补跳主站**二段式——比直接换主站登录少改 UX。

- **机制**：登录窗检测到登录成功（CDP/URL 判定）后、抓凭据快照之前，若平台配置了
  `PLATFORM_POST_LOGIN_REDIRECT`（packages/shared-utils/src/platform-definitions.js），
  登录窗自动 loadURL 该地址（xiaohongshu = `https://www.xiaohongshu.com/`）。
  creator 父域 Cookie 随请求带上，主站识别已登录态后种下 web_session，随后抓快照——
  凭据从此含完整主站会话，note 提交能过会话鉴权层（-100 根因闭合）。
- **就绪判据**：凭证轮询命中（每 500ms 复查一次会话 Cookie）——「主站已种下
  web_session」本身即就绪信号，不依赖页面加载完成（主站常在整页加载后才由 JS/XHR
  异步种会话，did-finish-load ≠ 会话已种下；r2-i1/r4-i3 实现与文档同口径）。
- **15s 兜底**：主站因网络/风控迟迟未就绪时按当前快照继续 settle，不阻断登录流程
  （platform-definitions `POST_LOGIN_REDIRECT_WAIT_MS = 15000`，超时先 stop 在途导航
  再做一次 2.5s 短重试）。兜底路径抓到的快照仍缺 web_session，属可接受的降级，
  留 snapshotWillMissMainSiteSession 失败标记日志可观测；降级发生率由真机验证圈定
  （典型登录凭证 1-3s 内即命中，实际等待远小于预算）。
- **零回归**：未配置 redirect 的平台（其余 14 个）保持原行为（登录完成直接抓快照），
  行为锁 C3c 把关。
- **回归保护**：`apps/desktop/electron/tests/xhs-mainsite-login.test.js` 六条契约——
  C1 登录 URL 不变 / C2 redirect 表导出 / C3a 结构锁（manager 接线表与常量，刻意不锁
  www 字面量防反向耦合）/ C3b 补跳时机（主站就绪前不 settle）/ C3c 零回归 / C4 兜底。
  TDD 红灯先行，实现后 6/6 绿；相关既有测试 120/120 绿。
- **真机验证**：PENDING——重新登录抓全量 cookie（应含 web_session）→ probe 重测 note
  → 草稿落箱。结论随下一轮补录本节。

