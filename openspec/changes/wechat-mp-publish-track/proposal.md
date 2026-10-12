# wechat-mp-publish-track：公众号「发布 / 群发」两条发送链 + DOM 轨群发正判据

## Why

#3375 落地了公众号 API 轨的「建草稿」，但发布语义只到草稿为止：

1. **DOM 轨群发是「点了就算成功」**：`_publish_wechat_mp` 只验证三次点击（选草稿/群发按钮/确认），
   不验证平台是否真的发出。群发是**不可撤回**的推送，额度用尽/风控/内容审核弹错时都会报假成功——
   与 #3375 修掉的「`ret===0` 即成功」同一类缺陷，且代价更高。
2. **没有「发布」（freepublish）能力**：微信后台「群发」（推送粉丝，订阅号 1 次/天）与
   「发布」（公开可访问但不推送，无配额）是两个动作，本仓只有群发。
3. **切轨后存在静默错位**：API 轨不处理 `massSend` 且建完草稿返回成功；一旦 `platforms.yaml`
   切到 `api-then-dom`，勾了群发的任务会「只存草稿却报成功」。

## What Changes

- **API 轨新增 `wechat-mp/publish.js`**（契约逐函数对齐参考产品取证）：
  - 发布路径 5 道前置检查（`for_check` / `check_same_material` / `get_appmsg_copyright_stat` /
    `check_ad` / `check_music`，全部 POST `cgi-bin/masssend`，原创校验以 `err_msg==='default'` 判通过）；
  - 群发路径：`masssendpage` 拉 `operation_seq`（数组/引号两形态兼容）+ 未签群发协议时
    `setprotocolsign` 自动签署 + 原创 64715（正文不足 300 字）可操作文案；
  - `buildPushBody` 21 字段全量对齐（`isFreePublish` 发布态双写、`country==='全部'` 置空、
    定时 `direct_send=1&send_time`）；
  - `sendPush`：发布加 `is_release_publish_page=1`，定时群发加 `action=time_send`；
    判据 `base_resp.ret === 0`，失败 5s 重试一次，两次失败 fail-closed（重试间隔可注入）。
- **适配器接线**：`buildPostData` 归一 `publishMode`（draft 默认 / publish / masssend）；
  `publish()` 建草稿+回读通过后按模式走 `publishArticle`（masssend 前置群发保护预检）。
- **taskData 透传**：`PASSTHROUGH_KEYS` 增加 `mass_send/free_publish/publish_time/sex/group_id/
  country/province/city`，camelCase 入参归一。
- **DOM 轨群发正判据**：确认点击前挂 `masssend` XHR 监听（`_waitForResponse`），点击后轮询页面
  成功提示（`_waitForCondition`）；**两者至少一条成立才算成功**，否则 fail-closed 并提示去后台核实。
  同时支持 `freePublish`（发布按钮候选选择器）。
- **能力声明**：`publish-capabilities.json` 的 wechat_mp 新增 `freePublish`（与 `massSend` 互斥、群发优先，
  hint 说明配额与不可撤回）；`publisher-router` 解析并透传 `article.freePublish`。

## Impact

- 受影响 specs：`wechat-mp-api-publish-track`（本 change 扩展其发布语义）
- 受影响代码：`packages/api-publish-engine`（新增 publish.js + 适配器/taskData 接线）、
  `apps/desktop/electron/services`（rpa-view-platforms.js 群发分支、publisher-router.js）、
  `packages/shared-utils`（capabilities）
- 测试：engine 直跑组新增 `wechat-mp-publish.test.js`（11 例）+ 适配器 5 例；desktop
  DOM 轨 3 例；capabilities 快照 1 例更新
