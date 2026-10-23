# 抖音 web-API 发布链（模块 + 单测）

## 依据
竞品 `00-vendor-originals/refproduct/main-dist-index.cjs` 实读：`creator.douyin.com` 11 处、
`ApplyUploadInner`/`CommitUploadInner` 各 3 处、`msToken` 11 处、`a_bogus` 9 处；
抽样调用中 `msToken=` 与 `a_bogus=` 为**空值**仍可调用。

## 变更
- 新增 `packages/api-publish-engine/src/publish/platforms/douyin-web.js`
  - `getUserInfo` / `getUploadAuth` / `createV2`，统一 `cookie + referer + Origin` 头
  - 成功判据：`status_code===0` 且含 `aweme_id`/`item_id`（**2xx 不算**）
- 新增 `packages/api-publish-engine/test/douyin-web.test.js`：4 例
- 新增设计文档 `01-docs/DESIGN-DOUYIN-WEB-API-2026-10-23.md`

## 测试
`node --test packages/api-publish-engine/test/douyin-web.test.js` → **pass 4 / fail 0**

## 未做（后续）
- 接入路由与 `vod-upload.js` 复用（下一个 PR）
- 真机验证（空签名是否被风控接受）
| 项 | 状态 |
| --- | --- |
| 远程同步 | 由门禁推导 |
