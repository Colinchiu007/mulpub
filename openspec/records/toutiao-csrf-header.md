# 本次执行记录：头条写接口 CSRF 头实证（toutiao-csrf-header，2026-10-19）【混合 PR】

- 分支：`toutiao-csrf-header`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：PR #3952（头条推荐封面，已合并 `09831741d9`）、#3953（小红书草稿取证 `0dde267606`）、
  #3956（抖音诊断 `950af9f3b6`）、#3957（小红书草稿落地 `0472bed979`）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §12.6（本轮新增）

## 一、这轮发现了什么（一句话）

**头条写接口（PublishVideo）必须带 `x-csrf-token`，值取自 cookie `xigua_csrf_token`** ——
此前整条发稿链缺这个头，所有提交都死在 `HTTP 403 invalid csrf token`，而报错文案看起来像
「签名算法不对 / 会话失效」，把人往错误方向带。

## 二、证据链（三段，逐级排除）

### 2.1 第一段：`checkPublishAuth` 推翻了「账号未实名所以不能发」的旧结论

真机读数（`rpa-toutiao-7ae99805`）：

```
canPublish = true    disablePublish = false    blockStatus = 0    reviewLatency = 0
authorPermission: IsIdentifyAuth=false（未实名）但 DisablePublish=false、IsUserBan=false
```

⇒ **「未实名」不等于「不能发」**。前几轮据此判定「卡实名认证、需人工」是**错误归因**，
本轮撤回该结论。同时拿到两个此前未记录的下游限制：
`TtVideoTitleLenMin/Max = 0/30`、`XgVideoTitleLenMin/Max = 1/30`。

### 2.2 第二段：`GetPosterList` 的 405 与 vid 传参

`POST /ixigua/api/upload/GetPosterList/` → **HTTP 405 Method Not Allowed**；
改 GET 后 `?vid=` / `?Vid=` / 路径段 / urlencoded body / JSON body **全部**
`{"status":-1,"message":"Validation Failed: \"vid\" is required"}`。
⇒ 该端点当前形态（本机、本账号）**取不到推荐封面**，细节留作未闭合项，不臆断解法。

### 2.3 第三段：CSRF 头名与来源（决定性）

应用自身 bundle `xigua_entry.*.js` 的写接口分支：

```js
var i = v("xigua_csrf_token");            // v = cookie getter
o.headers = { "x-csrf-token": i };        // 仅 POST 分支设置
```

真机对照实测（**同一 cookie 串、同一请求体**，逐变体）：

| 头部 | 结果 |
| --- | --- |
| 不带 | HTTP 403 `invalid csrf token` |
| `x-csrf-token: <csrf_session_id>` | HTTP 403 同 |
| `x-csrftoken: <csrf_session_id>` | HTTP 403 同 |
| `x-secsdk-csrf-token: <csrf_session_id>` | HTTP 403 同 |
| `X-CSRF-Token: <csrf_session_id>` | HTTP 403 同 |
| **`x-csrf-token: <xigua_csrf_token>`** | **HTTP 200，403 消失**，返回首个业务码 |

即：**头名对但 cookie 来源错，同样 403** —— 这是本轮的判据陷阱，只测「有没有这个头」会误判成功。

### 2.4 越过 CSRF 后的服务端判据（新增的一条硬约束）

```
{"data":{"Code":20007014,"Message":"request Param ThumbUri Can't be nil Error"},"status":0}
```

⇒ **`ThumbUri` 服务端必填**（不是前端提示而已）。补两条实测：

| 尝试 | 结果 |
| --- | --- |
| `ThumbUri=""` | `20007014 ThumbUri Can't be nil` |
| `ThumbUri=<VOD 上传图片得到的 vid>` | `21085 封面数据异常，请重新上传` |

⇒ `ThumbUri` 要的是**图片资源 URI**（tos/imagex 形态），**不是 VOD 视频 vid**。

## 三、代码改动

| 文件 | 改动 |
| --- | --- |
| `src/publish/platforms/toutiao-video-publish.js` | 新增 `CSRF_HEADER`（`x-csrf-token`）、`CSRF_COOKIE`（`xigua_csrf_token`）、`pickCsrfToken(cookie)`（纯函数，含逐变体对照表注释）+ 导出（231 → 273 行） |
| `src/publish/platforms/toutiao-video.js` | `_mpHeaders` 在 cookie 命中时加 `x-csrf-token`；**取不到不伪造**（让服务端如实拒绝，避免把「cookie 缺失」误诊成「签名算法不对」）；从契约模块导入常量与 helper（489 → 496 行，仍 < 500） |
| `test/toutiao-video-chain.test.js` | 23 → **26 例**：① `pickCsrfToken` 取值矩阵（共存 / 前缀相似名不得误命中 / 缺失返回空串）② `_mpHeaders` 带/不带该头 ③ **出口断言：`PublishVideo` 真实请求确实携带该头**（防「只测 helper 不测出口」） |

**为何拆到契约模块**：`toutiao-video.js` 已贴近 500 行硬闸（`.github/scripts/check-max-lines.js`
`limit=500 growthAllowance=200`，实测按 500 计），把纯函数放进无 IO 的契约模块既满足行数闸，
也符合本仓既有分层（契约 / 只读探测 / 有副作用编排）。

## 四、测试与门禁读数

| 项 | 读数 |
| --- | --- |
| `test/toutiao-video-chain.test.js` + `toutiao-adapter-routing.test.js` | **34 passed** |
| `packages/api-publish-engine` 全量 | **rc=0**（44 个 vitest 文件） |
| `check-max-lines.js` | **✅ 无新增超大文件**（首轮曾报 `500 行 >= 500`，拆导出后过闸） |
| `check-unwired-tests.js` | **OK：全部测试均已接线或按欠账登记** |
| 编码 / 品牌 / 绝对路径 / 记录债务 | **OK / PASS / PASS / OK**（10,478 / 4,260 文件） |
| QM-1 `build:vue` | **rc=0**（23.8s） |
| QM-1 `electron-builder --win --dir` | **rc=0** |
| QM-1 启动验证 | **PASS**：alive(8s)=true / stderr **0 字节** / stdout 7,846 字节 |


## 五、未闭合（不假装）

1. **头条真实发稿仍未成功**：卡在 `ThumbUri` 格式（要图片 URI，VOD vid 不行），
   而 `GetPosterList` 当前取不到推荐封面 ⇒ 封面来源仍未打通。
2. 抖音仍卡会话对 API 失效 + 签名材料不可得（PR #3956 已订正报错口径）。
3. 视频号 / 头条 / 抖音的**活会话**在 `account-*` 分区，被运行中的应用实例独占锁定。
4. 「未实名是否会影响发稿结果」仍未知 —— 只证明了 `DisablePublish=false` 且能越过 CSRF 与
   `ThumbUri` 校验进入业务码判定，尚未真正提交成功一次。

## 六、远程同步

| 远程同步 | 由门禁推导 |
