# 本次执行记录：头条视频 API 轨（复用字节系 VOD 协议，实网抓包取证）（toutiao-video-api，2026-10-18）【混合 PR】

- 分支：`toutiao-video-api`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：PR #3928（头条/小红书视频选择器 + 抖音 D2 签名兜底 + PRD 路线纪律，已合并 `c4f140419`）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §11.0（路线纪律）

## 一、为什么做这一轮（用户直接批评推动）

> 「不明白你为什么不复用蚁小二和融媒宝的逆向成果来实现几个平台的发布，
> 非要自己去研究 DOM？又复杂又有风控风险。」

复盘后确认批评成立，且范围可以精确到平台：

| 平台 | 我之前的做法 | 复核结论 |
| --- | --- | --- |
| 视频号 | 改 CDN 主机（竞品 bundle 里读出 `finder.video.qq.com`） | ✅ 本来就是 API 轨修复 |
| 抖音 | 加 D2 签名材料兜底（命名家族来自逆向语料） | ✅ 本来就是 API 轨修复 |
| 小红书 | 登记 DOM 选择器 | ⚠️ API 轨存在但 2026-10-10 真机实测 `note` 恒 406（缺主站 `web_session`），属**已记录死路** |
| **今日头条** | 登记 DOM 选择器 | ❌ **走偏**：语料 `mtm-platform-apis.md` L360-361 明确给了两个端点，仓库却**没有**任何视频 API 实现 |

所以本轮只做一件事：**把头条视频 API 轨补上**。

## 二、取证方法（确定性，不是猜测）

`adapters/toutiao.js` 原只有 56 行纯图文（`/api/article/publish`），`uploadVideo()` 是返回 null 的空壳。
补链之前先拿真实协议形状：

```
① 复制可读的 RPA 分区 cookie 库做 Playwright profile
   shared-user-data/session/Partitions/rpa-toutiao-7ae99805/Network/Cookies
   → <profile>/Default/Network/Cookies（+ 根目录 Local State）
   （Chromium 用同一 Windows 用户的 DPAPI 自行解密 ⇒ 真实登录态）
② node input[type=file].setInputFiles(<mp4>) 触发真实上传
③ page.route('**/*') 记录逐字请求；对
   PublishVideo|create_v2|/publish$|article/publish **硬 abort**
   ⇒ 全程未发出任何发稿请求
```

### 抓到的完整五步（1.1 MB mp4 实测）

| 步 | 真实请求 | 关键返回 |
| --- | --- | --- |
| 1 | `GET /xigua/api/upload/getAuthKey/?params={"type":"video","column":false,"ugc":false,"useImageX":true,"useStsToken":true}` | `data.spaceName="middlevideo_toutiao"`、`data.uploadToken.SessionToken`（STS） |
| 2 | `GET vod.bytedanceapi.com/?Action=ApplyUploadInner&Version=2020-11-19&SpaceName=middlevideo_toutiao&FileType=video&IsInner=1&FileSize=1251787&EnOID=1&app_id=1231&user_id=1342958645023752&s=<16hex>` | `Result.InnerUploadAddress.UploadNodes[0]` = `{Vid, StoreInfos[{StoreUri,Auth}], UploadHost, UploadHeader, SessionKey}` |
| 3 | `POST <UploadHost>/upload/v1/<StoreUri>?uploadid=..&part_number=1&phase=transfer&part_offset=0` | 原始二进制 |
| 4 | `POST <UploadHost>/upload/v1/<StoreUri>?uploadid=..&phase=finish&uploadmode=part` | — |
| 5 | `POST vod.bytedanceapi.com/?Action=CommitUploadInner&Version=2020-11-19&SpaceName=middlevideo_toutiao&app_id=1231&user_id=<uid>` | `Result.Results[0].Vid` |
| 6 | `POST /xigua/api/upload/PublishVideo` | **未抓（被硬拦）** → 见 §六 |

附带抓到的三个可做**前置门禁**的辅助端点（比 DOM 探测可靠）：

| 端点 | 用途 | 实测 |
| --- | --- | --- |
| `GET /xigua/api/upload/GetPublishAuth?params={}&msToken=..` | 发布权限 | `data.authorPermission.DisablePublish=false` 等 |
| `GET /xigua/api/upload/GetPublishPageReviewLatency` | 审核/封禁状态 | `data.ReviewLatency=0, BlockStatus=0` |
| `GET /ixigua/api/upload/size_limit` | 时长上限 | `data.duration=10800`（3 小时） |

## 三、复用而不是重写：核心发现

抖音链 `douyin-video.js#uploadVideo` 里本来就写着：

```js
const base = this.uploadScheme + '//' + n0.UploadHost + '/upload/v1/' + store.StoreUri
```

即**上传主机是从 apply 响应动态取的**，抖音的 `vod.bytedanceapi.com` 与头条的
`tos-lf-x.snssdk.com` 走的是**同一段代码**。所以两条链的差异只有三处：

| 项 | 抖音 | 头条 | 处理 |
| --- | --- | --- | --- |
| SpaceName | `aweme` | `middlevideo_toutiao`（由 getAuthKey 响应给） | 参数化 |
| app_id | `2906` | `1231` | 参数化 |
| EnOID | 无 | `1` | 参数化 |
| auth 端点 | `/web/api/media/upload/auth/v5/` | `/xigua/api/upload/getAuthKey/?params=…` | 各链自持 |
| 发稿端点 | `aweme/create_v2` | `/xigua/api/upload/PublishVideo` | 各链自持 |

据此把 apply → 分片 → finish → commit 抽成 `publish/core/bytedance-vod.js` **单一实现**，
**抖音链也改为调用它**（行为逐字等价，回归由既有 15 例抖音链测试兜住）。

## 四、代码改动

| 文件 | 改动 |
| --- | --- |
| `packages/api-publish-engine/src/publish/core/bytedance-vod.js`（新，约 250 行） | 字节系共用 VOD 协议：`buildApplyQuery` / `signedGet` / `signedPost` / `uploadVideoToVod` / `partSizeFor` / `crc32hex`。差异用参数表达（`spaceName` / `appId` / `innerOid`） |
| `packages/api-publish-engine/src/publish/platforms/toutiao-video.js`（新，约 330 行） | 头条链：`getAuthKey` / `_applyQueryFor` / `uploadVideo` / `buildPublishBody` / `publish` / `run`。导出 `TT_APP_ID=1231`、`TT_SPACE_NAME_FALLBACK`、`TT_VIDEO_API`（端点与 params 常量） |
| `packages/api-publish-engine/src/publish/platforms/douyin-video.js` | `uploadVideo` 改为调用共用实现（由 50 行降为 18 行）；`partSizeFor` 改为从共用模块再导出；删掉本地 `VOD_VERSION` 与 `partSizeFor` |
| `packages/api-publish-engine/src/adapters/toutiao.js` | `uploadVideo` 由「丢给通用 orchestrator」改为空实现（视频由链内部编排）；新增 `_videoChain()`；override `execute()` 按内容类型分流 |
| `config/platforms.yaml` | `toutiao.has_api: false → true`；**`publishMode` 保持 `dom-only`**（见 §六 理由） |
| `packages/api-publish-engine/scripts/run-tests.js` | 登记两个新测试文件到 `VITEST_FILES`（脚本注释点名：漏登记会 `describe is not defined` 且文件数不增） |
| `packages/api-publish-engine/test/helpers/fake-http.js` | 新增 `replaceRouteBody()`：apply 响应必须回填服务器**自己的** host，而 host 要等 `listen(0)` 后才有 |

### TDD（新增 17 例）

| 文件 | 用例数 | 锁什么 |
| --- | --- | --- |
| `test/toutiao-video-chain.test.js` | **9** | ① getAuthKey 的 `params` 四字段逐字 = 抓包值；② apply 的 `SpaceName` 取自响应、`app_id=1231`、`EnOID=1`、`s` 为 16 hex；③ 二进制上传走 `<UploadHost>/upload/v1/<StoreUri>` 且带 `Authorization`(SpaceKey)/`Content-CRC32`/`X-Storage-U`，字节数一致；④ CommitUploadInner 返回 Vid；⑤ PublishVideo 成功以 `status=0 && data.item_id` 判定、失败透出平台 message 不谎报；⑥ 缺 sessionid / 文件不存在 ⇒ **零请求** fail-closed；⑦ `uid_tt` 优先、注入值兜底；⑧ `run()` 五步**顺序不变量** + PublishVideo body 带 apply 阶段拿到的 vid |
| `test/toutiao-adapter-routing.test.js` | **8** | ① 有 `video.path` ⇒ 走视频链且**绝不触达图文 publish()**（防「静默错发成文章」）；② taskData 保真；③ 无 video 仍走图文路径（不回归）；④ dryRun 短路；⑤ 缺 cookie fail-closed 零请求；⑥ 链抛错归一成失败结果不冒泡；⑦ `onProgress` 透传；⑧ 适配器 referer/origin 不变 |

### 回归面

| 套件 | 读数 |
| --- | --- |
| `test/douyin-video-chain.test.js`（被改造的链） | **15 passed** |
| `packages/api-publish-engine` 全量 | **exit 0**（44 个 vitest 文件 + 全部直跑用例） |

## 五、门禁读数

| 门禁 | 读数 |
| --- | --- |
| `check-max-lines.js` | **rc=0**（无新增超大文件） |
| `check-unwired-tests.js` | **rc=0**（106 个测试文件均已接线） |
| `check-text-encoding-integrity.js` | **OK** |
| `check-no-brand-residue.js` | **PASS**（10301 tracked 文件） |
| `node --check` 四个改动文件 | **rc=0** |
| QM-1 `build:vue` | **rc=0**（1m 2s） |
| QM-1 `electron-builder --win --dir` | **rc=0** |
| QM-1 启动验证 | **PASS**：alive(8s)=true / stderr **0 字节** / stdout 21,945 字节（一次性临时 profile） |
| `check-gate-record-debt.js` | **rc=0** |
| `check-unwired-tests.js` | **rc=0** |

> 注：CI 的 `Gate 11 - ESLint` 只覆盖 `apps/desktop/{electron,src}`，不覆盖 `packages/`，
> 故本轮新文件不在该门禁域内；已用 `node --check` 做语法兜底并逐项确认无死导入。

## 六、如实记录：还没做完的部分

1. **`PublishVideo` 的真实 body 形状未取证**。抓包时我对它 `abort()`（安全边界），
   所以当前 body 是按头条投稿语义推断的 `{ title, abstract, vid, tags? }`。
   请求**端点**是语料 + 抓包双重确认的，**字段名**尚待一发真机验证。
2. **因此 `publishMode` 保持 `dom-only`**：只把 `has_api` 打开（陈述「有 API 实现」这个事实），
   但不把头条流量切到 API 轨 —— 在 PublishVideo 形状验证前切轨，等于拿线上流量试错。
3. **未做真机验证**：本轮验证停在「契约测试 + 全量回归 + 打包 + 启动」。
   真机一发需要：真实登录态 + `PublishVideo` 形状确认。

## 七、远程同步

| 远程同步 | 由门禁推导（合并后按主干历史收口；不手写状态词） |
