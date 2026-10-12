# PRD：微信公众号 API 发布轨与 DOM 轨补强（WECHAT-MP-API-TRACK-2026-10-12）

- 关联 change：`openspec/changes/wechat-mp-api-publish-track/`
- 上游依据：参考产品（4.0）逆向工程产物——`packages/main/dist/index.cjs（本机逆向工程产物，不入库）`
  （`publishGongZhongHaoArticle` / `buildArticles` / `createWeixinArticleMsgResponse` / `uploadWeixinImageResponse` /
  `getImageInfoFromUrlResponse` / `getUserInfoAsync` / `checkQrcodeOpen` 六段实测取证）
- 上一轮关联：`01-docs/PRD-WECHAT-MP-ARTICLE-PUBLISH-2026-10-12.md`（DOM 轨正文/封面完整性，PR #3364）
- 分层：**运行时改动** ⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-wechat-mp-api-track`，分支 `wechat-mp-api-track`

---

## 1. 背景与问题

### 1.1 问题一：API 适配器是「可被调用但从不发布」的空壳，且返回假成功

现实现（`packages/api-publish-engine/src/adapters/wechat_mp.js:41-59`）只做了一件事：
`GET /cgi-bin/appmsgpublish?sub=list`（**已发布内容列表**），拿到 `base_resp.ret === 0` 就返回
`{success: true, note: "Auth OK. Publish via appmsgpublish API needs token/params extraction"}`。

- 它**忽略** `postData`（含 title/content/cover/摘要/作者），一个字节都没发出去；
- 它打的是**列表**端点，与"建草稿"无关；
- 它返回成功 ⇒ 调用方 `publishViaApi()` 正常 resolve ⇒ 上层认为发布完成。

**可达性精确清点**（详见 proposal.md 表）：桌面发布流不可达（`platforms.yaml` 的 `wechat_mp` 是
`has_api:false` + `publishMode:dom-only`），但 `publish-api-server.js:1112` 用的是 `supportsApi()`
（只看 REGISTRY 是否登记），**HTTP 发布 API 调用方会拿到假成功**。
这与上一轮修复的"保存成功但草稿没内容"属同一类缺陷：**平台没做成事，我们却报成功**。

### 1.2 问题二：DOM 轨有天花板

上一轮把 DOM 轨的正文与封面补全了，但它的固有弱点没变：

- 全部依赖**选择器候选表**（公众号后台是 SPA，改版即失效）；
- 真机验证仍 PENDING；
- 正文内图片不转存平台 CDN（外链图可能不显示）——参考产品会逐张转存。

参考产品对微信公众号**完全不碰 DOM**，而是回放编辑器自身的 XHR。这提供了第二条轨，
且这条轨的契约是**可取证**的（见 §3）。

### 1.3 问题三：群发保护会让发布"莫名失败"

微信公众号后台有"群发消息"风险操作保护。开启时，群发类操作会被平台拦截或静默拒绝。
当前本仓没有任何前置检查，用户只会看到一次含糊的失败。

---

## 2. 目标与非目标

### 目标

| 编号 | 目标 | 验收 |
| --- | --- | --- |
| G1 | wechat_mp 的 API 轨能真正建出草稿（会话 → 图片上传 → create → 回读） | AC-1…AC-9 |
| G2 | **消灭假成功**：任何"没建出草稿"的情形一律失败 | AC-4 / AC-5 |
| G3 | DOM 轨补：群发保护预检 + 可操作失败文案 + 原文链接尽力透传 | AC-10…AC-13 |
| G4 | 不引入未经验证的默认行为变更（保持 `dom-only`） | AC-14 |

### 非目标（明确不做）

- ❌ 不把 `wechat_mp` 切成 `api-then-dom` 默认（见 §8，需真机验证 + 产品决策）；
- ❌ 不改 `api-then-dom` / `api-only` 的降级语义（属其他平台既有行为，另案）；
- ❌ 不做多图文（`contentList.length > 1` 直接 fail-closed，不做半成品）；
- ❌ 不做群发/发布的 API 轨（本期 API 轨**只建草稿**；群发仍走 DOM 轨）；
- ❌ 不做正文内图片转存（成本高，需与 API 轨一起评估）；
- ❌ 不改 UI，不加 locales 文案。

---

## 3. 参考产品的实测契约（本 PR 的唯一外部依据）

> 以下每一条都在 `index.cjs` 里定位到具体函数，不是记忆或推测。

| 步骤 | 端点与参数 | 回包字段 |
| --- | --- | --- |
| 会话 | `GET /cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome` | HTML：`&token=`、`nick_name:`、`uin:`、`user_name:`、`ticket:`、`can_app_msg` |
| 图片（URL） | `POST /cgi-bin/uploadimg2cdn?lang&token&t=0.428538<ts>`；body `t=ajax-editor-upload-img&imgUrl=<url>&token&lang=zh_CN&f=json&ajax=1` | `{url, img_format, file_id}` |
| 图片（本地） | `POST /cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1&ticket_id&ticket&svr_time&token&lang=zh_CN&seq&t=0.245301<ts>`；multipart(`id`/`name`/`type`/`lastModifiedDate`/`size`/`file`) | `{cdn_url, content, type}` |
| 建草稿 | `POST /cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=<T>&lang=zh_CN`；body 扁平字段 + 顶层参数 | `{appMsgId, base_resp}` |
| 群发保护 | `GET /cgi-bin/safecenterstatus?action=protect&t=setting/safe-protect&token=` | HTML：`wx.cgiData`、`"protect_status":1` |
| 群发前检查 | `POST /cgi-bin/masssend?...&t=ajax-response&for_check=1&is_release_publish_page=1` | `base_resp` |

**封面槽位**：`cdn_url0` / `cdn_235_1_url0` / `cdn_16_9_url0` / `cdn_1_1_url0` / `cdn_url_back0` 五者同值，
另有 `crop_list0="{}"`、`show_cover_pic0=0`、`fileid0=0`。
**注意**：不写 `thumb_media_id0`——参考产品这条路完全靠 `cdn_*` 槽位设封面。

**顶层参数**：`token` / `lang=zh_CN` / `f=json` / `ajax=1` / `random=0.1617291<ts>` / `AppMsgId=` /
`count=<N>` / `articlenum=<N>` / `data_seq=0` / `operate_from=Chrome` / `isnew=0` / `remind_flag=null`。

---

## 4. 功能逻辑

### F1 会话 bootstrap（`wechat-mp/session.js`）

```
fetchSession(http, {cookie}) →
  GET loginpage?url=%2Fcgi-bin%2Fhome  (headers: cookie)
  解析 HTML：
    token      = /&token=[0-9a-zA-Z]{3,}/            → 去掉 "&token="
    nickName   = /nick_name:[\s]".*"/
    authorId   = /uin:[\s]{0,}"[0-9]{3,}"/
    ticketId   = /user_name:[\s]{0,}".*"/            ← filetransfer 的 ticket_id
    ticket     = /ticket:[\s]{0,}".*"/               ← filetransfer 的 ticket
    canAppMsg  = /can_app_msg:(\d)/（"material_acl" 段内）
  判据：token 为空 或 authorId 为空 ⇒ throw WechatMpError('needRelogin')
```

### F2 图片上传（`wechat-mp/assets.js`）

```
uploadImage(http, {cookie, session, source}) →
  if (/^https?:\/\//i.test(source)) → uploadByUrl()
  else                              → uploadLocalFile()
  两者都返回 { url, fileId?, format? }；url 为空 ⇒ throw cover-upload-failed
```

### F3 建草稿（`wechat-mp/draft.js`）

```
buildDraftBody(article, index) → string          // 纯函数，逐字段可断言
createDraft(http, {cookie, session, body, count}) → { appMsgId }
readbackDraft(http, {cookie, session, appMsgId, expect}) → { titleOk, contentOk, coverOk }
```

### F4 编排（`adapters/wechat_mp.js`）

```
publish(cookie, postData):
  0. postData.contentList 长度 > 1 ⇒ { success:false, code:'multi-article-unsupported' }
  1. session = fetchSession(...)                    // 失败 ⇒ 失败（needRelogin）
  2. 封面：有 cover_url ⇒ uploadImage(...)          // 失败 ⇒ 失败（cover-upload-failed）
  3. body = buildDraftBody(article, 0)
  4. { appMsgId } = createDraft(...)                // 无 appMsgId ⇒ 失败（draft-not-created）
                                                    // ret==="64714" ⇒ 失败（originality-required）
  5. readback = readbackDraft(...)                  // 三项不齐 ⇒ 失败（readback-mismatch）
  6. 成功：{ success:true, platform:'wechat_mp', publishId:String(appMsgId), url:<编辑器链接> }
```

### F5 群发保护预检（DOM 轨，`wechat-mp-dom-guard.js`）

```
checkMassSendProtection(win, article) →
  if (!article.massSend) return { ok:true, skipped:true }        // 不请求
  html = executeJavaScript(fetch('/cgi-bin/safecenterstatus?action=protect&t=setting/safe-protect&token=<T>'))
  if (!html.includes('wx.cgiData')) return { ok:true }           // 安全中心未开通 ⇒ 放行
  if (html.includes('"protect_status":1')) return { ok:false, error:<可操作文案> }
  return { ok:true }
```

### F6 原文链接尽力透传

```
fillSourceUrl(win, url) →
  if (!/^https?:\/\//i.test(url)) return { filled:false, reason:'not-http' }
  遍历候选选择器，命中即填 + dispatch input/change ⇒ { filled:true, selector }
  全部未命中 ⇒ { filled:false, reason:'no-selector' }   // 不抛
```

### F7 失败文案映射（DOM 轨草稿保存失败）

| 平台回包特征 | 提示文字 |
| --- | --- |
| `64714` / 含"原创" | 文章保存失败：请检查文章原创性（该内容可能已被声明原创） |
| 含 `protect_status` / 群发保护已开 | 发布失败：账号开启了群发保护。请前往 微信公众平台 → 设置与开发 → 安全中心 → 风险操作保护，关闭「群发消息」保护后重试 |
| 其他 | 文章保存失败：<平台原文> |

---

## 5. 数据校验规则

### 5.1 会话（C 组）

| 编号 | 规则 | 失败语义 |
| --- | --- | --- |
| C1 | `token` 非空且匹配 `[0-9a-zA-Z]{3,}` | `needRelogin` |
| C2 | `authorId` 非空 | `needRelogin` |
| C3 | 请求必须带 `cookie`；空 cookie 直接失败（不空跑一次网络） | `needRelogin` |
| C4 | `ticketId`/`ticket` 缺失时：允许纯文本草稿，**禁止任何图片上传** | `cover-upload-failed` |
| C5 | 同一会话内 `token` 复用；不复用跨账号 | — |

### 5.2 图片（B 组）

| 编号 | 规则 | 失败语义 |
| --- | --- | --- |
| B1 | 本地文件必须存在且是文件（`fs.statSync().isFile()`） | `cover-upload-failed` |
| B2 | 本地封面 ≤ **2MB**（与上一轮 DOM 轨同口径） | `cover-upload-failed`（文案带实际大小） |
| B3 | 扩展名 → MIME：`.jpg/.jpeg→jpeg`、`.png→png`、`.gif→gif`、`.webp→webp`；其他按 `jpeg` | — |
| B4 | **最终 URL 只能来自平台回包**（`cdn_url` 或 `url`）；不得回退用输入路径 | `cover-upload-failed` |
| B5 | URL 轨的 `imgUrl` 必须 `encodeURIComponent` | — |
| B6 | multipart 的 `name` 用文件名（缺省 `myPic.png`），`type` 用 `image/<ext>` | — |

### 5.3 草稿请求体（D 组）

| 编号 | 规则 | 失败语义 |
| --- | --- | --- |
| D1 | 字段名 = `<key><index>`，值为 `encodeURIComponent(String(v))` | — |
| D2 | 封面 5 槽位必须**同值**（缺任一即视为校验失败，测试断言五者相等） | `draft-not-created` |
| D3 | `title` 截断 64 字，`digest` 截断 120 字，`author` 截断 60 字（与 `platforms.yaml` 的 `max_title` 一致） | — |
| D4 | `sourceurl` 仅接受 `http(s)://` 开头；否则写空串 | — |
| D5 | 评论三态：`0=关闭`、`1=仅粉丝`、`2=仅粉丝N天`、`3=所有人`；关闭时不写 `need_open_comment=1` | — |
| D6 | `count` / `articlenum` 必须等于实际文章数 | `multi-article-unsupported`（>1） |
| D7 | 正文为空 ⇒ 直接失败（**不允许建只有标题的草稿**——这正是上一轮的故障形态） | `draft-not-created` |
| D8 | 无封面 ⇒ 直接失败（公众号封面为必填项；无封面草稿在后台也存不下） | `cover-required` |
| D9 | 已是平台 CDN（`mmbiz.qpic.cn`）的封面 URL 直接复用，不重复上传 | — |

### 5.4 回读（H 组）

| 编号 | 规则 | 失败语义 |
| --- | --- | --- |
| H1 | 回读页必须含标题（HTML 转义后比对） | `readback-mismatch` |
| H2 | 回读页正文容器文本长度 > 0 且含正文前 20 个非空白字符 | `readback-mismatch` |
| H3 | 回读页含 `mmbiz.qpic.cn` 且与上传 URL 同 path | `readback-mismatch` |
| H4 | 任一不满足即整体失败（**不做"警告但成功"**） | `readback-mismatch` |

### 5.5 DOM 轨（T 组）

| 编号 | 规则 | 失败语义 |
| --- | --- | --- |
| T1 | 群发保护预检只在 `article.massSend` 为真时执行 | — |
| T2 | 预检请求失败/超时 ⇒ **放行**（fail-open，预检是增益不是依据） | — |
| T3 | `fillSourceUrl` 任何异常都必须被吞掉并返回 `{filled:false}` | — |
| T4 | 非 `http(s)` 的原文链接一律不填 | — |

---

## 6. 流程与失败语义

### 6.1 API 轨时序

```
POST /api/v1/publish {platform:'wechat_mp', title, content, cover, ...}
  │
  ├─ publishViaApi → adapter.execute()
  │     ├─ formatContent（既有）
  │     ├─ uploadVideo → null（图文无视频）
  │     ├─ uploadCover（有封面时）→ 平台上传 ⇒ cdn url
  │     └─ publish(cookie, postData)
  │           ├─ ① fetchSession          失败 ⇒ needRelogin
  │           ├─ ② uploadImage(封面)     失败 ⇒ cover-upload-failed
  │           ├─ ③ createDraft           无 appMsgId ⇒ draft-not-created
  │           │                          64714      ⇒ originality-required
  │           ├─ ④ readbackDraft         不齐       ⇒ readback-mismatch
  │           └─ ⑤ success:true, publishId=appMsgId
  │
  └─ publishViaApi：!success ⇒ throw ⇒ 上层按 publishMode 决定是否降级 DOM
        · dom-only      ：到不了这里
        · api-then-dom  ：降级（既有语义，本 PR 不改）
        · api-only      ：停报
```

### 6.2 DOM 轨新增前置

```
_publish_wechat_mp(win, article)
  ├─ 导航首页 → 提取 token（既有）
  ├─ 【新增】checkMassSendProtection(win, article)   ← massSend 才请求
  │        !ok ⇒ return {success:false, error:<群发保护文案>}
  ├─ 导航编辑器（既有）
  ├─ 填标题/正文/封面（既有，PR #3364）
  ├─ 【新增】fillSourceUrl(win, article.content_source_url)   ← 尽力，不阻断
  └─ 保存草稿（既有）+ 【新增】失败文案映射
```

---

## 7. 交互逻辑与显示项

本 PR **不改 UI**，因此交互面只有两条：**失败提示的文字** 与 **日志**。

### 7.1 显示项（沿用既有承载，不改组件）

| 位置 | 显示内容 | 触发 |
| --- | --- | --- |
| 发布页进度提示 | 「正在上传封面…」「正在创建草稿…」「正在校验草稿…」 | API 轨 `onProgress` |
| 发布失败弹层 | §F7 的可操作文案 | 失败 |
| 历史记录 | 无变化（`publishId` = `appMsgId`，与 DOM 轨的 `appmsgid` 同语义） | — |

### 7.2 提示文字（逐条）

| 场景 | 文案 | 依据 |
| --- | --- | --- |
| 登录失效 | 微信公众号登录已失效，请重新登录账号后重试 | C1/C2 |
| 封面上传失败 | 封面上传失败：<原因>。请检查图片是否为本地文件且不超过 2MB | B1/B2/B4 |
| 草稿未创建 | 微信公众号草稿创建失败：<平台原文> | D7 |
| 原创性失败 | 文章保存失败：请检查文章原创性（该内容可能已被其他账号声明原创） | 64714 |
| 草稿校验不一致 | 草稿已提交但校验未通过（标题/正文/封面不齐），请到公众号后台草稿箱确认后再决定是否重发 | H4 |
| 群发保护开启 | 发布失败：账号开启了群发保护。请前往「微信公众平台 → 设置与开发 → 安全中心 → 风险操作保护」，关闭「群发消息」保护后重试 | F5 |
| 多图文 | 当前版本一次只支持单篇图文，草稿未创建 | D6 |

### 7.3 日志契约

| 事件 | 级别 | 字段 |
| --- | --- | --- |
| `wechat-mp-api:session-ok` | info | `hasTicket`, `canAppMsg`（**不记 token/ticket 明文**） |
| `wechat-mp-api:cover-uploaded` | info | `sourceKind`, `urlHost` |
| `wechat-mp-api:draft-created` | info | `appMsgId` |
| `wechat-mp-api:readback` | info | `titleOk`, `contentOk`, `coverOk` |
| `wechat-mp-api:failed` | warn | `code`, `detail`（**不记 cookie**） |
| `wechat-mp:mass-send-protected` | warn | `platform`, `accountId` |

---

## 8. 未闭合与切换前置（不假装已通）

### 8.1 真机验证 PENDING

本机**无可用公众号账号会话**，因此以下三项未完成：

1. 导出真实 `loginpage` HTML，核对 §3 的六个正则是否命中（尤其 `user_name` / `ticket`）；
2. 真机建一条草稿，核对草稿箱里**标题 + 正文 + 封面**三项齐全；
3. 核对回读页的正文容器选择器（当前按候选表取，可能需按真机 DOM 调整）。

**未完成前不得声称 API 轨端到端可用。**

### 8.2 为什么不切默认轨（`platforms.yaml` 保持 `dom-only`）

两条前置，缺一不可：

1. **没有真机证据**。跨网络契约不做默认开是本仓既有纪律（先例：登录首屏噪声取消开关停在实验档）。
2. **回读不一致会触发 DOM 降级 ⇒ 可能产生第二份草稿**。
   契约已核实：`publishViaApi()` 把 `{success:false}` 转成 throw（`index.js:95`），
   而 `rpa-view-manager` 在 `api-then-dom` 下对 throw **降级 DOM**（`rpa-view-manager.js:144`）。
   即"API 已建草稿但回读不齐"会再建一份。**重复草稿 vs 缺内容草稿**是产品取舍，本 PR 单方面定默认不合适。

**切换动作（待真机通过后）**：把 `config/platforms.yaml` 的 `wechat_mp` 改为
`has_api: true` + `publishMode: api-then-dom`，并在同一 PR 里给出重复草稿取舍的决策记录。

### 8.3 已知的既有缺陷（本 PR 只记录，不改）

- `publish-api-server.js:1112` 用 `supportsApi()` 而不用 `shouldUseApi()`，使 HTTP 发布 API
  可以调用任何"登记了但配置为不可用"的适配器。本 PR 修掉了 wechat_mp 的假成功，
  但**这个判定口径本身**仍是隐患（其他平台同样受影响），建议另案。
- `contentList` 多图文、正文图转存、API 轨群发/发布三项未实现。

---

## 9. 验收标准

| 编号 | 验收项 | 证据 |
| --- | --- | --- |
| AC-1 | 会话正则六字段各自命中 | `wechat-mp-session.test.js` |
| AC-2 | 缺 token/authorId ⇒ `needRelogin`，且**未发出** create 请求 | 同上（断言请求计数） |
| AC-3 | URL/本地两种图片来源分别命中正确端点与参数 | `wechat-mp-assets.test.js` |
| AC-4 | 回包无 URL ⇒ 抛错，**绝不**回退输入路径 | 同上 + 变异反证 M2 |
| AC-5 | 无 `appMsgId` ⇒ `success:false`（**核心回归锁**） | `wechat-mp-adapter.test.js` + 变异反证 M1 |
| AC-6 | 不再请求 `appmsgpublish?sub=list` | 同上（断言 URL 不含该路径） |
| AC-7 | 封面 5 槽位同值；`sourceurl0` 仅在 http(s) 时出现 | `wechat-mp-draft.test.js` + 变异反证 M3 |
| AC-8 | `64714` ⇒ `originality-required` | 同上 |
| AC-9 | 回读三项判据各自可反证（摘掉任一条目必须变红） | 同上 + 变异反证 M6 |
| AC-10 | 未开群发 ⇒ **不发出** `safecenterstatus` 请求 | `wechat-mp-dom-guard.test.js` + 变异反证 M5 |
| AC-11 | 群发保护开启 ⇒ 返回可操作文案 | 同上 |
| AC-12 | `fillSourceUrl` 找不到候选 ⇒ 不抛、返回 `filled:false` | 同上 |
| AC-13 | 非 http(s) 的原文链接不写入（两个轨一致） | 同上 + draft 测试 |
| AC-14 | `platforms.yaml` 的 `wechat_mp` 仍为 `has_api:false` + `dom-only` | 结构锁测试 |
| AC-15 | 全部测试无真实网络（注入假 HTTP） | 测试内断言 `http` 为注入对象 |
