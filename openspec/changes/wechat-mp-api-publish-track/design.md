# 设计（wechat-mp-api-publish-track）

## D1. 模块划分与依赖方向

`packages/api-publish-engine/src/adapters/wechat_mp.js` 只做**接线**（保持 ≤ P 行），
四段逻辑各自成文件，**单向依赖**（draft/assets 依赖 session 的类型，不反向）：

```
adapters/wechat_mp.js          ← 适配器：实现基类契约（uploadCover / buildPostData / publish）
adapters/wechat-mp/session.js  ← 会话与闸门：fetchSession / checkMassSendProtection
adapters/wechat-mp/assets.js   ← 图片上传：uploadImage（URL 轨 + 本地文件轨）
adapters/wechat-mp/draft.js    ← 草稿：buildDraftBody（纯函数）/ createDraft / readbackDraft
```

**为什么拆**：`check-max-lines.js` 的单文件上限 500 行；且四段的测试面完全不同
（纯函数 / 字符串解析 / multipart 组包 / 表单序列化），拆开后每段都能单独反证。

## D2. 依赖注入（可测性的根）

四段全部把 HTTP 客户端当**参数**收，不 require axios：

```js
async function fetchSession(http, { cookie, timeout })      // http.get(url, { headers, params })
async function uploadImage(http, { cookie, session, source }) // source = { kind:'url'|'file', value }
```

适配器持有 `this.http = axios.create(...)`（基类已建），在 `publish()` 里往下传。
测试注入 `createFakeHttp(plan)`，**零真实网络**。

**为什么必须**：公众号所有端点都要真 cookie，没有测试账号；且 `axios` 直连会把测试变成网络依赖。
参照本仓既有做法（`packages/api-publish-engine/test/test-publish-api-server.js` 起 loopback 假服务）。

## D3. 会话字段的取证口径

`/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome` 返回的是**HTML 片段**（不是 JSON），
字段用正则提取。参考产品用的表达式（实测取证，逐条照抄以便对齐）：

| 字段 | 正则 | 用途 |
| --- | --- | --- |
| `token` | `&token=[0-9a-zA-Z]{3,}` | 所有 cgi-bin 请求的 `token=` 参数 |
| `nick_name` | `nick_name:[\s]".*"` | 仅日志/展示 |
| `author_id` | `uin:[\s]{0,}"[0-9]{3,}"` | 仅日志/展示 |
| `ticketId` | `user_name:[\s]{0,}".*"` | `filetransfer` 的 `ticket_id` |
| `ticket` | `ticket:[\s]{0,}".*"` | `filetransfer` 的 `ticket` |
| `can_app_msg` | `"material_acl"` 段内 `can_app_msg:[0-9]` | 是否可发图文 |

**判据**：`token` 与 `author_id` 任一缺失 ⇒ 视为**登录失效**（fail-closed，错误码 `needRelogin`）。
`ticketId`/`ticket` 缺失时仍允许"纯文本草稿"路径，但**任何图片上传**必须失败——不允许降级成"没封面的草稿"后报成功。

## D4. 两种图片上传的分工（不可互换）

| 来源 | 端点 | 为什么 |
| --- | --- | --- |
| `http(s)://` 开头 | `uploadimg2cdn` + `t=ajax-editor-upload-img&imgUrl=` | 服务端代取，避免本地转发与 SSRF 面 |
| 本地文件 | `filetransfer?action=upload_material&scene=8` multipart | 平台只收 multipart 二进制；`scene=8` 与参考产品一致 |

**封面走哪条**：按来源自动选（本地文件走 multipart）。**上传结果的 URL 必须来自平台回包**
（`cdn_url` 或 `url`），不得使用输入路径——这正是上一轮"历史缩略图不是真实封面"的同族陷阱。

Node 22 原生有 `FormData`/`Blob`/`fetch`，但本包统一走 axios 以便注入假实现；
multipart 组包用 `FormData` + `form-data` 兼容层，**不手写 boundary**（手写 boundary 是本仓既有反例）。

## D5. 草稿请求体的构造（纯函数 + 序号）

```js
buildDraftBody(article, index)  // → 'title0=..&content0=..&cdn_url0=..'
```

- 字段名 = `<key><index>`；值 `encodeURIComponent`；
- 文章标题/正文/摘要/作者/原文链接/评论映射按 PRD §4 表；
- **顶层参数**（`token`/`lang`/`f=json`/`ajax=1`/`random`/`AppMsgId=`/`count`/`articlenum`/`data_seq`/`operate_from=Chrome`/`isnew=0`/`remind_flag=null`）由 `createDraft` 拼接，不放进纯函数——
  它们依赖 token 与文章数，属**会话/请求上下文**而非文章内容。这样纯函数可以逐字段断言。

**序号语义**：`0` 是首条（本仓一期只发单条），`count`/`articlenum` = 条数。
多图文暂不支持（`contentList` 长度 > 1 时 fail-closed，不做半成品）。

## D6. 回读校验（本仓新增，参考产品没有）

建草稿后 `GET /cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=<id>&token=<T>&lang=zh_CN`，
从 HTML 里读回：

| 断言 | 判据 |
| --- | --- |
| 标题 | 页面出现 `article.title`（HTML 转义后） |
| 正文 | 页面里 `content` 容器文本长度 > 0 且包含正文前 20 个非空白字符 |
| 封面 | 出现 `mmbiz.qpic.cn` 且与上传返回的 URL 同源 |

三项任一不满足 ⇒ `success:false` + 明确 error（**不给假成功**）。

**已知取舍（写进 PRD §8）**：回读不一致时若外层是 `api-then-dom`，仍会降级 DOM ⇒ 可能产生第二份草稿。
本 PR 不把它设为默认轨，正是不想在没有产品决策的情况下引入该副作用。

## D7. 群发保护预检的位置（DOM 轨）

在 `_publish_wechat_mp` 内、**进入编辑器之前**用页面上下文发同源请求：

```js
const protect = await win.webContents.executeJavaScript(`fetch('/cgi-bin/safecenterstatus?action=protect&t=setting/safe-protect&token=<T>&lang=zh_CN').then(r=>r.text())`)
```

- **同源 fetch** 自动带 cookie，不需要主进程搬运 cookie（也比 `net.request` 少一层凭证暴露面）；
- 只在 `article.massSend`（本次要群发）时执行；
- 页面在 `setting/safe-protect` 未开通时返回不带 `wx.cgiData` 的页面 ⇒ 视为**未开启保护**（放行），
  与参考产品判据一致（`includes('wx.cgiData')` 且 `"protect_status":1` 才算开启）。

**为什么 fail-open**：预检是**增益**，不是正确性依据；把它变成硬阻断会让"没开通安全中心"的账号无法发布。
真正的失败仍由群发失败路径报告。

## D8. 原文链接（sourceurl）尽力透传

- DOM 轨：候选选择器找"原文链接"输入框，填值 → dispatch `input`/`change`；**找不到就 return，不抛**。
- API 轨：`sourceurl0=<url>`（纯字段，无副作用）。
- **校验**：非 `http(s)` 开头一律不填（避免把 `javascript:` 之类灌进平台字段）。

## D9. 结构化错误码（对齐 `needRelogin` 既有约定）

| code | 触发 | 外层行为 |
| --- | --- | --- |
| `needRelogin` | 会话 HTML 无 token/author_id | 上层提示重新登录 |
| `cover-upload-failed` | 封面图上传无 URL 回包 | 失败（**不生成无封面草稿**） |
| `draft-not-created` | create 无 `appMsgId` | 失败（**消灭假成功**） |
| `originality-required` | `ret === "64714"` | 失败 + 可操作文案 |
| `readback-mismatch` | 回读三项不齐 | 失败 + 回读明细 |
| `mass-send-protected` | 群发保护开启 | 失败 + 去安全中心的指引 |
| `multi-article-unsupported` | `contentList.length > 1` | 失败（不做半成品） |
