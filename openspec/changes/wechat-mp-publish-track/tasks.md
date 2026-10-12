# Tasks: wechat-mp-publish-track

## 1. API 轨发布链（C）

- [x] 1.1 `wechat-mp/publish.js`：`runPublishChecks`（5 道检查 + 原创两形态文案）
- [x] 1.2 `runMassSendChecks`（群发页 + 协议签署 + operation_seq + 64715 文案）
- [x] 1.3 `buildPushBody`（21 字段对齐 + 发布态双写 + 定时）
- [x] 1.4 `sendPush`（发布/定时旗标 + ret===0 + 5s 重试一次 + fail-closed，delayFn 可注入）
- [x] 1.5 `publishArticle` 编排（publish/masssend 分支 + 未知模式 fail-closed）

## 2. 接线（A 的切轨错位消除 + C 落地）

- [x] 2.1 `wechat_mp.js`：`buildPostData` 归一 `publishMode/publishTime/定向参数`；`publish()` 回读后按模式走发布链（masssend 前置群发保护预检）
- [x] 2.2 `task-data.js`：PASSTHROUGH_KEYS 扩充 + camelCase 别名归一
- [x] 2.3 `publisher-router.js`：`freePublish` 解析（与 massSend 互斥、群发优先）+ article/后端 body 透传

## 3. DOM 轨正判据（A）

- [x] 3.1 群发分支：`masssend` XHR 监听 + 页面成功提示轮询，双缺失 fail-closed
- [x] 3.2 `freePublish` 分支（发布按钮候选选择器，真机待验证标注）

## 4. 能力与 UI

- [x] 4.1 `publish-capabilities.json`：wechat_mp 新增 `freePublish`（互斥/配额/不可撤回 hint）
- [x] 4.2 快照测试更新

## 5. 测试

- [x] 5.1 engine 直跑组 `wechat-mp-publish.test.js`（11 例）
- [x] 5.2 适配器接线用例（5 例）
- [x] 5.3 DOM 判据用例（3 例）
- [x] 5.4 变异反证（见执行记录）
