# Spec: wechat-mp-publish-track

## ADDED Requirements

### Requirement: 公众号发布方式三态

公众号发布必须支持三种互斥方式，优先级 `massSend > freePublish > draft`：

- **draft**（默认）：只创建草稿，不触达任何 masssend 端点；
- **publish**：创建草稿并通过校验后执行「发布」（公开可访问、不推送粉丝、无群发配额）；
- **masssend**：创建草稿并通过校验后执行「群发」（推送全部粉丝，受平台配额约束，不可撤回）。

#### Scenario: 只存草稿不触达发送端点

- **WHEN** 未勾选群发与发布
- **THEN** 全链只含会话/封面/建草稿/回读，`masssend` 端点请求数为 0，返回 `draft:true`

#### Scenario: 群发优先于发布

- **WHEN** `massSend` 与 `freePublish` 同时为真
- **THEN** 按 masssend 执行

### Requirement: API 轨发送判据 fail-closed

发送结果必须以平台业务应答 `base_resp.ret === 0` 判定；失败间隔 5s 重试一次，
两次失败必须返回失败并携带平台 `err_msg`。禁止以 HTTP 200 或「请求已发出」判定成功。

#### Scenario: 发送端 ret 非 0

- **WHEN** 首次与重试的 `base_resp.ret` 均非 0
- **THEN** 返回 `success:false, code:'masssend-push-failed'`，error 含平台 err_msg

#### Scenario: 首败重试成功

- **WHEN** 首次 ret 非 0、5s 后重试 ret === 0
- **THEN** 返回成功且标记 `retried:true`

### Requirement: 发布路径前置检查

「发布」必须依次通过 `for_check`、`check_same_material`、`get_appmsg_copyright_stat`、
`check_ad`、`check_music` 五道检查；原创校验以 `err_msg === 'default'` 判通过；
`found reprint from other article` 时错误文案必须包含冲突文章 `source_url`。

#### Scenario: 原创校验冲突

- **WHEN** copyright 回包 err_msg 含 `found reprint from other article`
- **THEN** 返回失败，error 含冲突文章链接

### Requirement: 群发路径前置检查与协议签署

「群发」必须先拉取 `masssendpage`：页面含「腾讯提醒你」且「同意以上声明」时先
`POST setprotocolsign(issigned=1)` 再重拉；从页面提取 `operation_seq`（引号与数组两形态）；
正文过短（`ret===64715` 且 `TEXT_NUM_TOO_SMALL`）返回可操作文案（不少于 300 字）。

#### Scenario: 未签署群发协议

- **WHEN** 群发页含协议提示
- **THEN** 发出 `setprotocolsign` 请求后重拉页面，并继续后续检查

### Requirement: 发送体字段契约

发送体必须按参考产品契约包含 21 个字段与顺序；发布态 `isFreePublish` 双写（`true` 布尔值 +
查询参数 `isFreePublish=true`）；`country` 为 `'0'` 或 `'全部'` 时置空；定时任务带
`direct_send=1&send_time=<ts>`；URL 旗标：发布带 `is_release_publish_page=1`，
定时群发带 `action=time_send`。

#### Scenario: 发布态发送

- **WHEN** publishMode 为 publish
- **THEN** body 含 `isFreePublish=true`（两次）且 `operation_seq=` 为空，URL 含 `is_release_publish_page=1`

### Requirement: DOM 轨群发/发布正判据

DOM 轨执行群发/发布时，必须以「masssend XHR 200」或「页面成功提示
（群发成功/已发送/发送成功/发表成功/已发表/发布成功）」至少一条为成功依据；
两条都缺失时必须 fail-closed 并提示到公众号后台核实，禁止以「点击完成」判定成功。

#### Scenario: 无任何成功信号

- **WHEN** 三次点击成功但 XHR 监听超时且页面无成功提示
- **THEN** 返回 `success:false`，error 含「无法确认」与后台核实指引
