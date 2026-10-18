# 本次执行记录：抖音签名材料形态实证 —— API 轨根因诊断与报错订正（douyin-material-diagnosis，2026-10-19）【混合 PR】

- 分支：`douyin-material-diagnosis`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：PR #3952（头条推荐封面，已合并 `09831741d9`）、PR #3953（小红书草稿取证，已合并 `0dde267606`）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §14（本轮新增）

## 一、这轮想做什么，以及为什么只做到这一步

目标是把抖音的真实发布打通。真机一路推进到「只差 create_v2」：

| 步骤 | 结果 |
| --- | --- |
| `getSdkToken`（creator HEAD csrf） | ✅ 拿到 92 字符 token |
| `getAuthKey`（VOD 授权） | ✅ 有 SessionToken |
| `uploadVideo`（VOD 5 步） | ✅ **`videoId=v0300fg10000dbaja5fog65rgu1mtqe0`** |
| `uploadCover`（imagex） | ✅ **`coverPoster=tos-cn-i-jm8ajry58r/d07ece5987354a938803e90b394f6dd7`** |
| `create_v2`（发稿） | ❌ `{"status_code":8,"status_msg":"用户未登录"}` |

## 二、两个根因（都是实测，不是推断）

### 2.1 会话对 **API** 已失效，即使页面外壳仍能渲染

```
GET  /aweme/v1/creator/pc/user/info/?aid=2906   → HTTP 200，但 body = {"status_code":8,"status_msg":"用户未登录"}
POST /aweme/v1/web/aweme/create_v2/…            → HTTP 200，body 同上
页面内 fetch 同一接口                            → 同样 status_code:8
```

⚠️ **重要教训**：`HTTP 200` 完全不代表登录有效。本仓历史上就曾把「创作页能打开」当作「登录态 OK」。
**判据必须看 body 的 `status_code`，不能看 HTTP 状态码。**
另外 `rpa-douyin-01ab122e` 这份分区仍有 62 个 cookie（含 `sessionid`/`sid_tt`/`uid_tt`），
**名字齐全 ≠ 服务端认可**。

### 2.2 签名私钥在页面 IndexedDB 且**不可导出** ⇒ 纯 Node 侧 API 轨架构性不可行

真机实测三类安全 cookie 的值：

```
__security_mc_1_s_sdk_crypt_sdk               = 056709ca-4e73-9159   （18 字符）
__security_mc_1_s_sdk_sign_data_key_web_protect = 6c6586e1-4222-8f79 （18 字符）
__security_mc_1_s_sdk_cert_key                = fdef635f-4ae0-8ed3   （18 字符）
```

这是 **key id**，不是密文。签名器期望的值形态是 `encodeURIComponent({"data":"<json>"})`
（JSON 里含 `ec_privateKey` PEM / `ticket`），而这三个值解出来是 `JSON.parse` 失败。

真材料在哪（逐项实测）：

| 位置 | 内容 |
| --- | --- |
| `localStorage['security-sdk/s_sdk_server_cert_key']` | 服务端证书（`BEGIN CERTIFICATE`，1739 字符） |
| `localStorage['ztsdk_tcc_config']` | secsdk 配置（1022 字符，含 `certType`） |
| `IndexedDB['secure-store']` | ★ **私钥所在**（WebCrypto `CryptoKey`，设计上 `extractable:false`） |

⇒ **私钥不可导出**，所以「cookie/本地存储里读出 PEM，再用 Node 的 crypto 签名」这条路**在本机行不通**。
这不是配置问题，是安全设计。

## 三、由此暴露并修掉的一个真实代码缺陷

`douyin-video.js` 的 Step 0 前置校验**硬要求**

```js
if (!c.includes('bd_ticket_guard_client_data')) throw FAIL_MSG   // 「账号信息缺失，请重新授权此账号再试」
```

而真机证明：

1. 真实账号的该 cookie **不存在**（它只在「受保护的 create_v2 请求真正发生**之后**」由 ticket-guard 握手下发 —— 执行后才有）；
2. 真实账号的材料**只剩 key id**（见 §2.2）。

⇒ 这条判据对真实账号**恒不成立**，链是 **dead-on-arrival**；
而且它抛的是通用 `FAIL_MSG`，把「架构性不可行」**误导成「用户该重新授权」**（重新授权也拿不到私钥）。

### 修法（刻意**不放松**任何既有守卫）

| 顺序 | 判据 | 变化 |
| --- | --- | --- |
| 1 | `hasSecurityMaterials(c)` | 不变 |
| 2 | **`hasKeyIdOnlyMaterials(c)`（新增）** | 材料只剩 key id ⇒ 抛**专用**诊断：`抖音签名材料仅剩 key id（私钥在页面 IndexedDB 中不可导出），纯 API 轨无法完成 create_v2 签名；请改用页面内签名或 RPA/DOM 轨` |
| 3 | `bd_ticket_guard_client_data` 存在 | **原样保留**（无证据表明可省 ⇒ 继续 fail-closed） |
| 4 | `sid_tt=` 存在 | 不变 |
| 5 | `clientSign(c)` 可签出 | 不变 |

`hasKeyIdOnlyMaterials` 的判据**刻意宽松**（只认「短且无 `data=` 结构且解不出版本」）：
出现任意一条像真材料的就判否 —— 宁可交给 `clientSign` 裁决，也不要把好材料误判成 key-id。

## 四、代码改动

| 文件 | 改动 |
| --- | --- |
| `src/signer/douyin-ticket-guard.js` | 新增 `hasKeyIdOnlyMaterials(cookie)` + 导出；注释写明真机形态与它服务的诊断目的 |
| `src/publish/platforms/douyin-video.js` | 新增 `FAIL_MSG_MATERIAL_ONLY_ID`；Step 0 插入 key-id 专用诊断（位于 ree 判据之前）；导入/导出对齐 |
| `test/douyin-video-chain.test.js` | 15 → **17 例**：真机 key-id 形态 → 专用诊断 + 零请求 + **与「账号信息缺失」明确区分**；对照用例「完整材料不会被误判成 key-id」 |
| `test/douyin-client-sign.test.js` | 30 → **31 例**：`hasKeyIdOnlyMaterials` 的形态矩阵（3 种完整形态 / 逐字真机形态 / 材料不全 / 混合形态） |

## 五、测试读数

| 套件 | 读数 |
| --- | --- |
| `test/douyin-video-chain.test.js` | **17 passed**（15 → 17） |
| `test/douyin-client-sign.test.js` | **31 passed**（30 → 31） |
| `test/douyin-image-chain.test.js` | 通过（未改） |
| `packages/api-publish-engine` 全量 | 见 §七 |

## 六、顺带取得的四条平台事实（供后续复用）

1. **页面内 fetch 会被 secsdk 自动补 `x-secsdk-csrf-token`**（实测 19 个页面内请求带该头，我 `page.evaluate` 发的 fetch 也触发 SDK 补头）⇒ 「页面内执行」是可行的中间路线，不必自己算 csrf；
2. 视频号 15 个 `rpa-rpa-tencent_video-36b5b265-*` 分区全部是 **2026-09-23**（近一个月前）⇒ 必然失效，别再拿它们试；
3. 视频号/头条/抖音的**活会话**都在 `account-*` 分区，而被当时运行中的应用（另一 worktree 的 `mp-app-live2` 实例）**独占锁定**（`Cookies` 文件读不开）；
4. 抖音「页面能打开」与「API 已登录」是两件事（§2.1）。

## 七、质量节拍读数

| 门禁 | 读数 |
| --- | --- |
| `packages/api-publish-engine` 全量 | **rc=0**（44 个 vitest 文件 + 全部直跑用例） |
| `check-max-lines.js` | **✅** |
| `check-unwired-tests.js` | **OK** |
| 编码 / 品牌 / 绝对路径 / 记录债务 | **OK / PASS / PASS / OK**（10,444 / 4,228 文件） |
| QM-1 `build:vue` | **rc=0**（23.5s） |
| QM-1 `electron-builder --win --dir` | **rc=0** |
| QM-1 启动验证 | **PASS**：alive(8s)=true / stderr **0 字节** / stdout 22,187 字节 |


## 八、还没做完（不假装）

1. **抖音真实发布未成功**：卡在 ① 会话对 API 失效；② 即使会话有效，纯 Node 签名也被「私钥不可导出」硬阻断。
   可行动的两条路：**(a) 页面内签名/页面内发 create_v2**（§六 第 1 条已验证 csrf 自动补齐，方向可行）；
   **(b) 走 RPA/DOM 轨**。
2. **视频号 / 头条的活会话无法读取**（被另一实例独占），因此这两个平台的真实发布本轮无法验证。
3. `create_v2` 是否真的需要 `bd-ticket-guard-ree-public-key` 仍**未经验证**（会话失效导致实验走不到那一步）；
   因此该判据保持 fail-closed，不据「未验证」放松。

## 九、远程同步

| 远程同步 | 由门禁推导 |
