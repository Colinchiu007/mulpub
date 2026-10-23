# 抖音 web-API 发布链（对齐竞品实现）设计

## 依据（竞品代码实读）
`00-vendor-originals/refproduct/main-dist-index.cjs`：
- `creator.douyin.com` 11 处；`ApplyUploadInner` / `CommitUploadInner` 各 3 处；`msToken` 11 处；`a_bogus` 9 处；`X-Bogus` 2 处。
- 抽样调用：
  - `GET https://creator.douyin.com/aweme/v1/creator/pc/user/info/`
    headers `{ cookie, referer: https://creator.douyin.com/creator-micro/home, Origin: https://creator.douyin.com }`
  - `GET https://creator.douyin.com/web/api/media/user/anchor/list?…&msToken=&a_bogus=`
    ⇒ **`msToken` 与 `a_bogus` 传空仍可调用**

## 与现有实现的差异
| 项 | 现有 `douyin-video.js` | 竞品 web-API 链 |
| --- | --- | --- |
| 前置校验 | 四类 `__security_mc_*` 安全材料齐备，否则 fail-closed | 仅需 cookie + referer |
| 创建 | `create_v2` + `bd-ticket-guard-*`（clientSign/ree/web-version） | `create_v2`，签名头可缺省 |
| 上传 | VOD `ApplyUploadInner`→`FinishUpload`→`CommitUploadInner`（aws4 自签） | 同协议 |

## 实施步骤
1. 新增 `douyin-web.js`：`getUserInfo()` → `getUploadAuth()` → `uploadVideo()`（复用 `vod-upload.js`）→ `createV2()`。
2. 路由：`publishMode` 增加 `web-api` 档；`has_api` 仍为 true。
3. 降级：web-API 失败（非 2xx 或 `status_code!=0`）→ 记录 `errCode/errMsg` → 回退 DOM（现有路径不变）。
4. 判定口径：仅当 `create_v2` 返回 `status_code===0` 且含 `aweme_id`/`item_id` 才算成功；**2xx 不算**（沿用 PRD 8.1/8.4）。

## 风险
- 抖音 creator 接口风控强，空签名可能被拒（`status_code` 非 0）；需真机验证一次再定去留。
- 若被拒，退回 DOM 轨，本分支不合入。

## 验收
- 单测：mock 4 步响应，断言 URL/头/体；失败路径断言错误含 `[step=… status=…]`。
- 真机：发布一条真文案视频，**以创作者中心作品列表为准**。
