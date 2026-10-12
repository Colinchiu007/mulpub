# 技术设计：wechat-mp-publish-track

## 契约来源（参考产品逆向取证，2026-10-12 逐函数提取）

| 函数（参考产品） | 本仓实现 | 对齐点 |
| --- | --- | --- |
| `createPublicMsg` | `runPublishChecks` | 5 道检查顺序与 query/body；`err_msg==='default'` 才算原创通过；`found reprint from other article` 提取冲突 `source_url` |
| `createSendMsg` | `runMassSendChecks` | `masssendpage` 页「腾讯提醒你/同意以上声明」→ `setprotocolsign(issigned=1)` → 重拉；`operation_seq` 提取；64715+TEXT_NUM_TOO_SMALL 文案 |
| `buildPushData` | `buildPushBody` | 21 字段与顺序；发布态 `isFreePublish` 双写；`country==='0'/'全部'` 置空；定时 `direct_send=1` |
| `pushMsgResponse` | `sendPush` | 发布 `is_release_publish_page=1`；定时群发 `action=time_send`；`ret===0` 判定；失败 5s 重试一次 |

参考产品页面提取正则 `operation_seq:[\s]{0,}".*"` **不匹配**数组形态 `operation_seq:["…"]`；
本实现放宽为 `operation_seq:\s*\[?\s*"([^"]*)"`，提取语义不变（第一个引号串）。

## 关键决策

### D1 发布/群发共用 `masssend` 端点，靠 query/body 区分

参考产品即如此（发布= `is_release_publish_page=1` + `isFreePublish=true`，群发= `operation_seq`）。
不引入第二端点，回归面最小。

### D2 成功判据

- **API 轨**：`base_resp.ret === 0`（平台业务应答，非 HTTP 200）；失败 5s 重试一次
  （参考产品同值同节奏），两次失败 fail-closed。
- **DOM 轨**：`masssend` XHR 200（`_waitForResponse`，URL 判据）**或** 页面成功提示
  （`_waitForCondition` 轮询「群发成功/已发送/发表成功/已发表/发布成功」）——至少一条。
  不读响应体（`_waitForResponse` 无 body 能力；读 body 需 CDP 捕获，改动面大），
  双判据已消除「点了就算成功」的主要假成功面。

### D3 模式归一与互斥优先级

`massSend > freePublish > draft`（capability hint 与 router 同口径）。理由：群发是更强承诺，
用户显式勾选它时不得被 freePublish 静默覆盖。`publishMode` 的权威解析在适配器
`buildPostData`（单点），taskData 层只做 camelCase → snake_case 别名。

### D4 「切轨静默错位」的消除方式

不靠「API 轨拒绝 massSend」，而是**直接实现** API 轨群发/发布（本 change 的 C 部分）。
这样 `api-then-dom` 切换后语义完整：勾什么发什么。DOM 兜底仍然成立（API 轨失败抛错 →
上层降级 DOM），且 API 轨失败发生在发送链，不存在「草稿已建 + DOM 再建草稿」之外的
新重复形态（草稿创建失败时不进发送链）。

## 测试策略（TDD，无网络）

- `wechat-mp-publish.test.js`（直跑组，11 例）：注入 fake http，逐检查断言端点/action 顺序、
  原创两形态文案、协议签署时序、operation_seq 两形态、body 21 字段、发送旗标、重试与 fail-closed。
- `wechat-mp-adapter.test.js`（+5 例）：适配器接线——masssend/publish 全链、push ret!=0 fail-closed、
  draft 默认不触达 masssend、publishMode 归一。
- `rpa-view-platforms.test.js`（+3 例）：DOM 判据——双缺失 fail-closed、XHR 单证据成功、
  freePublish 按钮候选。
- `publish-capabilities.test.js`：快照更新（新增 freePublish）。

## 风险

- DOM「发布」按钮选择器是**候选表**，真机未验证（与 #3375 同口径标注）。
- masssend 配额/风控错误码未穷举；fail-closed 保证不假成功，文案带平台 `err_msg` 原文。
- API 轨发布/群发链整体待真机验证（前置检查的参数形态取自参考产品线上行为）。
