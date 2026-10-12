# 规格：微信公众号 API 发布轨

## Requirement R1：会话 bootstrap 必须 fail-closed

适配器必须先从 `/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome` 提取 `token` 与 `author_id`；
两者任一缺失时**不得**继续任何写操作，必须返回可识别为"需重新登录"的失败。

#### Scenario: 会话 HTML 正常
- **WHEN** loginpage 返回包含 `&token=1234567890` 与 `uin: "123456789"` 的 HTML
- **THEN** 会话对象同时含 `token` 与 `authorId`，并提取出 `ticketId`（来自 `user_name`）与 `ticket`

#### Scenario: 登录失效
- **WHEN** loginpage 返回登录页（无 token）
- **THEN** 返回 `{success:false, code:'needRelogin'}`，且**没有**发出任何 `operate_appmsg` 请求

## Requirement R2：图片上传必须使用平台回包 URL

封面与正文图必须经平台端点上传，且**只能**使用回包里的 URL（`cdn_url` 或 `url`）；
不得使用输入路径或任何本地路径作为最终引用。

#### Scenario: 远程图片
- **WHEN** 图片来源是 `https://example.com/a.png`
- **THEN** 请求命中 `/cgi-bin/uploadimg2cdn`，body 含 `t=ajax-editor-upload-img` 与 `imgUrl=<encoded>`

#### Scenario: 本地文件
- **WHEN** 图片来源是本地文件路径
- **THEN** 请求命中 `/cgi-bin/filetransfer` 且 query 含 `action=upload_material`、`scene=8`、
  `ticket_id=<user_name>`、`ticket=<ticket>`，body 为 multipart

#### Scenario: 回包没有 URL
- **WHEN** 上传接口返回 200 但无 `cdn_url`/`url`
- **THEN** 抛出可识别为图片上传失败的异常，**不得**回退使用输入路径

## Requirement R3：草稿请求体按序号扁平化

请求体必须由 `<字段名><文章序号>` 组成，值经 `encodeURIComponent`；封面必须写满 5 个槽位。

#### Scenario: 单篇文章
- **WHEN** 传入 1 篇文章（含标题/正文/封面 URL/摘要/作者/原文链接）
- **THEN** body 含 `title0=`、`content0=`、`digest0=`、`author0=`、`sourceurl0=`，
  且 `cdn_url0`、`cdn_235_1_url0`、`cdn_16_9_url0`、`cdn_1_1_url0`、`cdn_url_back0` **五者同值**

#### Scenario: 多篇文章暂不支持
- **WHEN** 传入 2 篇及以上
- **THEN** 返回 `{success:false, code:'multi-article-unsupported'}`，不发出 create 请求

## Requirement R4：`appMsgId` 是唯一成功依据（消灭假成功）

只有当 create 回包含非空 `appMsgId` 时才算成功；且成功前必须完成回读校验。

#### Scenario: 创建成功且回读一致
- **WHEN** create 返回 `{appMsgId: 100000001}` 且回读页含标题、非空正文与 `mmbiz.qpic.cn` 封面
- **THEN** 返回 `{success:true, publishId:'100000001'}`

#### Scenario: 创建返回成功码但没有 appMsgId
- **WHEN** create 返回 `{base_resp:{ret:0}}` 但无 `appMsgId`
- **THEN** 返回 `{success:false, code:'draft-not-created'}`——**不得**返回成功

#### Scenario: 原创性校验未通过
- **WHEN** 回包 `ret === "64714"`
- **THEN** 返回 `{success:false, code:'originality-required'}` 且文案可操作

#### Scenario: 回读不一致
- **WHEN** create 给了 `appMsgId`，但回读页正文为空
- **THEN** 返回 `{success:false, code:'readback-mismatch'}` 并带回读明细

## Requirement R5：群发保护预检（DOM 轨）

只有当本次要群发时才做预检；预检不可用时按放行处理（fail-open），不得阻断发布。

#### Scenario: 只存草稿
- **WHEN** 本次不群发
- **THEN** **不发出** `safecenterstatus` 请求

#### Scenario: 群发且保护开启
- **WHEN** 本次群发且 `safecenterstatus` 回包含 `"protect_status":1`
- **THEN** 返回 `{ok:false}` 且文案指向"设置与开发-安全中心-风险操作保护-关闭群发消息保护"

#### Scenario: 安全中心未开通
- **WHEN** 回包不含 `wx.cgiData`
- **THEN** 返回 `{ok:true}`（放行）

## Requirement R6：原文链接尽力透传

`sourceurl` 为非关键字段：填不上不得导致发布失败；非 `http(s)` 值不得写入。

#### Scenario: DOM 轨找得到输入框
- **WHEN** 候选选择器命中
- **THEN** 填值并派发 `input` 与 `change`

#### Scenario: DOM 轨找不到
- **WHEN** 所有候选都未命中
- **THEN** 返回 `{filled:false}`，**不抛异常**，后续发布流程继续

#### Scenario: 非法协议
- **WHEN** 值为 `javascript:alert(1)` 或空
- **THEN** 不写入任何字段（DOM 轨与 API 轨一致）

## Requirement R7：不改变既有发布模式闸门语义

本 PR 不得修改 `api-then-dom` / `api-only` / `dom-only` 的降级判定；应以结构锁固定当前语义。

#### Scenario: 配置保持
- **WHEN** 检查 `config/platforms.yaml`
- **THEN** `wechat_mp` 仍为 `has_api: false` 且 `publishMode: dom-only`

#### Scenario: 降级语义锁
- **WHEN** 运行结构锁测试
- **THEN** 断言 `publishViaApi` 在 `success:false` 时**抛出**（这正是 `api-then-dom` 能降级的原因），
  且 `rpa-view-manager` 的 `api-only` 分支不降级
