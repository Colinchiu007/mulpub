# 微信公众号 API 发布轨（wechat-mp-api-publish-track）

## 为什么（Why）

`packages/api-publish-engine/src/adapters/wechat_mp.js` 的 `publish()` 是一个**可被调用但从不发布**的空壳：

```js
async publish(cookie, postData) {
  const resp = await this.http.get(this.apiBase + "/cgi-bin/appmsgpublish", { params: { sub: "list", ... } });
  if (resp.data?.base_resp?.ret === 0) {
    return { success: true, platform: "wechat_mp", note: "Auth OK. Publish via appmsgpublish API needs token/params extraction" };
  }
  ...
}
```

三个缺陷叠在一起：

1. **忽略入参**：`postData`（由本适配器自己的 `buildPostData()` 构造，含 `title`/`content`/`cover_url`/`digest`/`author`）从未被读取，一个字节都没发出去。
2. **打错端点**：`cgi-bin/appmsgpublish?sub=list` 是**已发布内容列表**查询，与"建草稿"无关。
3. **假成功**：只要列表查询返回 `ret: 0`（登录态正常即可）就返回 `success: true`。调用方 `publishViaApi()` 因此**正常 resolve**，桌面 API-first 闸门（`rpa-view-manager.js:133`）直接 `return apiResult`——不会降级到 RPA。

可达路径精确清点（本 PR 不改这些路径的判定，只如实记录）：

| 路径 | 是否可达 | 依据 |
| --- | --- | --- |
| 桌面发布流（RPA / 发布按钮） | **不可达** | `config/platforms.yaml` 的 `wechat_mp` 是 `has_api: false` + `publishMode: dom-only`（`getPublishMode` 返回 `dom-only` ⇒ `apiEnabled=false`） |
| `publish-api-engine` 的 HTTP 发布服务 | **可达** | `src/publish-api-server.js:1112` 用 `supportsApi(platform)` 判定，而 `supportsApi` 只看 REGISTRY 是否登记（`wechat_mp` 已登记）⇒ `POST /api/v1/publish {platform:"wechat_mp"}` 会拿到 `success:true` 而**什么都没建** |
| `api-router.publishWithFallback` | 不可达 | `shouldUseApi('wechat_mp')` 读 `has_api`，为 false |

即：**桌面用户看不到它，但 HTTP 发布 API 的调用方会拿到假成功。** 这与上一轮修复的公众号"保存成功但内容为空"是同一类缺陷（平台没做成事，我们却报成功）。

同时，上一轮（`wechat-mp-article-content-cover`）把 DOM 轨的正文与封面补全了，但 DOM 轨的天花板仍在：
选择器是**候选表**、真机验证仍 PENDING。参考产品（4.0）对微信公众号**完全不碰 DOM**——它回放编辑器自身的 XHR。这提供了第二条轨。

## 做什么（What Changes）

### 一、把 wechat_mp 的 API 轨做成真的（不再假成功）

按参考产品的实测契约实现四段，全部落 `packages/api-publish-engine/src/adapters/wechat-mp/`：

1. **会话 bootstrap** —— `GET /cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome`，从返回 HTML 提取
   `token`、`nick_name`、`uin`(author_id)、`user_name`(**ticketId**)、`ticket`、`can_app_msg`。
2. **图片上传**（封面与正文图共用）——
   - 远程 URL：`POST /cgi-bin/uploadimg2cdn?lang&token&t=0.428538<ts>`，body `t=ajax-editor-upload-img&imgUrl=<url>&token&lang=zh_CN&f=json&ajax=1` ⇒ `{url, img_format, file_id}`
   - 本地文件：`POST /cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1&ticket_id=<user_name>&ticket=<ticket>&svr_time&token&lang=zh_CN&seq&t=0.245301<ts>`，multipart(`id`/`name`/`type`/`lastModifiedDate`/`size`/`file`) ⇒ `{cdn_url, content, type}`
3. **建草稿** —— `POST /cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=<T>&lang=zh_CN`，
   body 为**扁平化字段（字段名 + 文章序号）**；**封面写 5 个槽位同一个 URL**
   （`cdn_url0` / `cdn_235_1_url0` / `cdn_16_9_url0` / `cdn_1_1_url0` / `cdn_url_back0`）+ `crop_list0={}`。
4. **强校验** —— 必须拿到 `appMsgId` 才算成功；`ret === "64714"` 单独映射为"原创性校验未通过"。

### 二、失败即失败（消灭假成功）

- 会话拿不到 / 图片上传失败 / 没有 `appMsgId` ⇒ 一律 `{success: false, error}`；
  `publishViaApi()` 会把它转成 throw，`api-then-dom` 因此**按设计降级**（契约已核实：`index.js:95`）。
- 新增**回读校验**（参考产品没有这一步，本仓加上）：建草稿后 `GET` 编辑器页，读回标题/正文长度/封面是否就位；
  三项齐全才算成功。

### 三、`wechat_mp` 暂不切默认轨（本 PR 的显式决定）

**不**把 `platforms.yaml` 的 `wechat_mp` 改成 `has_api: true` / `api-then-dom`，理由两条，都可核对：

1. **没有真机账号可验证**。本机无可用公众号会话，无法证明该轨在真实后台可用；
   本仓既有纪律是"未验证的跨网络契约不做默认开"（先例：登录首屏噪声取消开关停在实验档）。
2. **建草稿成功但回读不一致时会触发 DOM 降级 ⇒ 可能产生第二份草稿**。
   该取舍需要产品决策（重复草稿 vs 缺内容草稿），不宜在本 PR 单方面定默认。

改动只留**一行配置**作为切换开关，并在 PRD §8 写清切换前置条件。

### 四、DOM 轨补强（C）

1. **群发保护预检**：群发前置检查 `GET /cgi-bin/safecenterstatus?action=protect&t=setting/safe-protect&token=`，
   `"protect_status":1` 即 fail-fast，给出可操作指引（去安全中心关闭"群发消息"保护）。
   只在**本次要群发**时检查（只存草稿不该被群发保护拦住）。
2. **可操作失败文案**：草稿保存失败时按平台回包映射提示（原创性 64714 / 群发保护 / 通用）。
3. **原文链接（`sourceurl`）尽力透传**：DOM 轨按候选选择器填"原文链接"，**找不到就跳过、不阻断**（非关键字段，不允许为它让发布失败）；API 轨写 `sourceurl0`。

## 影响面（Impact）

- 变更类型：**运行时代码**（`packages/api-publish-engine/**` + `apps/desktop/electron/**`）⇒ 必须在隔离 worktree 分支上完成。
- 新文件（`packages/api-publish-engine/src/adapters/wechat-mp/` 4 个模块 + 1 个测试）与
  `apps/desktop/electron/services/wechat-mp-dom-guard.js`；
- 改写 `packages/api-publish-engine/src/adapters/wechat_mp.js`（61 行 → 接线）；
- `apps/desktop/electron/services/rpa-view-platforms.js` 加 ≤4 行接线（该文件**被点名还账**：
  `targets = 1476`，当前 1469，只有 7 行余量）；
- 配置不改（见上）；`apps/desktop` 之外无 UI 变更，无 locales 变更。

## 红线（不可破）

- ⛔ **不得为通过测试而放宽判据**：`appMsgId` 缺失一律失败；不得保留任何"返回值成功但没建草稿"的分支。
- ⛔ **不得改 `api-then-dom` 的降级语义**（属其他平台的既有行为，另案处理；本 PR 只加**结构锁测试**把当前语义钉住）。
- ⛔ **不得把未验证的默认开**：`platforms.yaml` 的 `wechat_mp` 保持 `has_api:false` / `publishMode:dom-only`。
- ⛔ 测试**不得打真实 `mp.weixin.qq.com`**：全部依赖注入假 HTTP。
