# B站 Tier-A API 真实活体发布证据（2026-09-23）

## 结论
「热门选题 → 一键生成视频 → 发布到自媒体平台」端到端链路，已在 **B站** 以 **Cookie + 官方创作者域名 HTTP API（upos 链）** 方式**真实发布成功并通过独立回查核验**。全程仅直连 `member.bilibili.com` / `api.bilibili.com`，未调用任何第三方（含蚁小二 `qianming.yixiaoer.cn`）远程服务。

**复现性**：同一条链路连发 2 条均成功（topic01 敏感社会题材 + topic02 中性体育题材），证明链路稳定、非偶发。

## 发布产物
| 项 | 值 |
|----|----|
| bvid | `BV1MahW6tE36` |
| aid | `117317988063126` |
| URL | https://www.bilibili.com/video/BV1MahW6tE36 |
| 标题 | 13岁女孩遭强奸案闺蜜被认定为共犯（选题 topic01） |
| 视频 | pub-topic01-720p.mp4，6,705,084 B，时长 219s |
| 账号 | mid=3747542357510297（奔跑的丘丘） |

第二条（复现，中性选题）：bvid=`BV1DxhW6hEwZ`、aid=`117318055106795`、标题「汪顺400混的含金量」（topic02）、URL https://www.bilibili.com/video/BV1DxhW6hEwZ 。

## 独立回查（非发布响应自证）
`GET https://api.bilibili.com/x/web-interface/view?bvid=BV1MahW6tE36`
→ `code=0`，稿件真实存在：`state=0`（公开）、`duration=219`、`owner=奔跑的丘丘`、`pubdate=1790130634`。

## 完整调用链（逐步实测）
1. `GET member.bilibili.com/preupload?r=probe` → 取 lines。
2. `GET preupload?<line.query>&r=<line.os>&name=<fileName>.mp4&size&profile=ugcupos/bup&ssl=0&version=2.7.1&build=2070100` → `{ endpoint, upos_uri:"upos://bucket/object", auth, biz_id }`。
3. `POST https:<endpoint>/<upos_uri去upos://>?uploads&output=json`（`X-Upos-Auth: auth`）→ `upload_id`。
4. 分片 `PUT <base>?partNumber&uploadId&chunk&chunks&size&start&end&total`（8MiB/片，body=octet-stream）→ 200。
5. `POST <base>?output=json&name&profile&uploadId&biz_id`，body `{"parts":[{"partNumber","eTag"}]}`（eTag 用字面量 `etag` 即可，B站 upos 信任对象本身）→ `{OK:1, location, bucket, key}`。
6. `POST member.bilibili.com/x/vu/web/add/v3?t&csrf=bili_jct`，JSON body（关键 schema 见下）→ `{code:0, data:{bvid, aid}}`。

## add/v3 精确 schema（21015 排障关键）
- `videos[]` = `[{ cid: <args.biz_id>, desc: "", title, filename }]`，**无 `file` 字段、无 `format` 字段**。
- `filename` = `complete.location` 去扩展名 + 去 bucket 段（等价 bundle `P.split(".")[0].split("/")[1]`）。
- `tid` 默认 **21**（日常/综合）。`copyright:1`、`desc_format_id:0`、`web_os:1`、`recreate:-1`。
- 踩坑：曾误用 `videos[].file=/bucket/obj` + `format`，B站返回 `21015「视频可能上传过程出现问题」`——根因即 file/format 字段形态错误，与上传/eTag 无关。

## 风控处置（601）
- `preupload` 返回 `code=601「您上传视频过快」` + `detail.v_voucher`：为**账号/IP 级人工滑块验证**，退避重试无效，不可程序化绕过（合规红线）。
- 处置：脚本在 getArgs 命中 601 时以 `BILI_RISK_601` 明确失败并提示「请先在创作者中心完成一次滑块验证后重试」；用户手动验证通过后再跑即成功（本次即此路径）。

## 代码落地
- 适配器：`packages/api-publish-engine/src/adapters/bilibili.js`（Tier-A upos 全链，`BasePlatformAdapter` 契约：uploadVideo/buildPostData/publish）。
- 路由：`publisher-router.js` `ROUTE_TABLE.bilibili` 由 `rpa_vm` → `api`（RPA 点击式上传/发布此前均失败，API 式已活体验证）。
- 单测：`packages/api-publish-engine/test/bilibili-upos.test.js`（纯逻辑 5 例，不联网）。
- 合规门禁：全程仅 bilibili 官方域名，绝不触碰 `yixiaoer.cn`。
