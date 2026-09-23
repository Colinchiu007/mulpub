# 主链路活体门禁：生产 publishViaApi(bilibili) Tier-A 适配器 → 真 bvid（2026-09-23）

## 结论
「热门选题 → 生成视频 → 发布」主链路的发布端，已在**生产代码路径**上活体验证成功：
调用 `packages/api-publish-engine/src/index.js` 导出的 `publishViaApi("bilibili", taskData, cookie, opts)`
（这正是桌面 `ApiPublisher.publish()` 经 `ROUTE_TABLE[bilibili].mode==="api"` 分派后运行的同一条链），
对**活体 B 站登录态**完成真实投稿，拿到可在公开 `view` API 回查的真 bvid。

## 证据链（可复核）
- 驱动脚本：`.agent_context/staging/bili-mainchain.js`（require origin/main 工作树的 api-publish-engine 生产入口）
- 登录探活：`bili-nav-check.js` → `GET api.bilibili.com/x/web-interface/nav` → `code=0 isLogin=true uname=奔跑的丘丘 mid=3747542357510297`
- 视频输入：`D:/tmp/mp-hv-e2e/final5b/pub-topic03-720p.mp4`（E2E 流水线产物，横版）
- 生产适配器执行：`BilibiliAdapter.execute` → `_getUploadArgs(preupload probe→args)` → `init upload_id` → 8MiB 分片 PUT → `complete` → `add/v3` 投稿
- 进度日志：`[10%] Uploading video... [85%] Publishing... [100%] Published!`
- 投稿响应：`{"success":true,"platform":"bilibili","publishId":"BV1y1ht6PEfM","aid":117319246288101,"url":"https://www.bilibili.com/video/BV1y1ht6PEfM","code":0}`
- 公开回查：`GET api.bilibili.com/x/web-interface/view?bvid=BV1y1ht6PEfM` → `code=0 title=热门选题 3 aid=117319246288101 owner=奔跑的丘丘`
  （发布瞬间短暂 -404 为传播延迟，数秒后稳定 code=0）

## 内容纯净复核
适配器 `_cleanText` 去除标题/简介中括号包裹的「自动发布/一键发布工具/由多平台」类水印；本次 desc 走纯净正文，不带任何水印文字。

## 运行态 app 与主链路差距（运维项，非仓缺陷）
- origin/main 已完成主链接线：`publisher-router.js` 的 `ROUTE_TABLE.bilibili = { mode: "api" }`；
  `adapters/bilibili.js` 为真 upos 链（`_buildBase`/分片 PUT/`add/v3`/返回 bvid），`bilibili-upos.test.js` 覆盖纯逻辑（base 解析、add/v3 schema、bvid 返回、水印回归）。
- 但持久运行工作树 `mp-app-live2` 落后 origin/main 26 个提交（其 `ROUTE_TABLE.bilibili` 仍 `rpa_vm`、适配器仍占位），
  故「经 Electron 队列 publishBatch 触发 api 发布」的端到端只在**生产函数直调**层面得证；
  完整 Electron 队列跑需先由普通终端执行 `scripts/sync-app.ps1` 将 mp-app-live2 同步到 origin/main 并重启（沙箱纪律禁止整树重写）。

## 失败态可观测（生产适配器已内建）
- `601` 上传风控 → `BILI_RISK_601`「请先在创作者中心完成滑块验证」
- `-1025/-1026` → `cookieExpired:true`「B 站登录态失效，请重新登录」
- 获取 args 失败 → `BILI_ARGS_FAIL`；未得 upload_id → `BILI_INIT_FAIL`；分片 status>204 → `BILI_PART_FAIL`
