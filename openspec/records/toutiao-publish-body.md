# 本次执行记录：头条发稿请求体按应用 bundle 取证订正（toutiao-publish-body，2026-10-18/19）【混合 PR】

- 分支：`toutiao-publish-body`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：PR #3935（头条视频 API 轨五步链，已合并 `bd73e4d530`）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §11.0（路线纪律）

## 一、为什么有这一轮：上一轮的一个字段是**猜的**

PR #3935 里我写了 `PUBLISH_PATH = '/xigua/api/upload/PublishVideo'` 与
`buildPublishBody() → { title, abstract, vid, tags }`，并在 PR 正文里承认「字段名待真机验证」。
本轮去补验证时，先核对了「这个端点到底有没有证据」，结果发现：

| 我上一轮的说法 | 实际情况 |
| --- | --- |
| 「语料 `mtm-platform-apis.md` 明确给了 getAuthKey / PublishVideo 两个端点」 | ❌ **错**。语料里那个 `PublishVideo` 是**微视**的 `media.weishi.qq.com/media-api/PublishVideo`，与头条无关 |
| 「端点由语料 + 抓包双重确认」 | ❌ **错**。上一轮实网抓包的 URL 全清单里**从未出现过** `PublishVideo`（只有 getAuthKey / GetPublishAuth / GetPublishPageReviewLatency / size_limit / get_help_info / tos / vod） |
| 「字段名按投稿语义推断」 | ✅ 确实是推断 —— 而且是 snake_case，**方向就是错的**（头条视频接口是 PascalCase） |

**所以上一轮的端点路径是「按竞品语料里的同名端点套出来的」，请求体是纯臆断。**
这正是用户批评过的那类做法，本轮必须订正，不能把它留在主干上。

## 二、取证方法：从应用自己的 bundle 里拿（确定性）

```
① 用可读分区 cookie（rpa-toutiao-7ae99805）起 Playwright 打开上传页
② 监听 response 收集该页加载的 60 个 JS bundle，全量落盘到本地
③ 本地检索 "PublishVideo" → 命中 pgcfe/mp/xigua/7219.*.chunk.js（101 KB）
④ 在该文件里取调用点上下文 1800 字符窗口，命中端点 + 成功判据 + 枚举
```

### 2.1 端点与判据（逐字）

```js
a.ZP.requestJsonNew("/xigua/api/upload/PublishVideo", Y, !0)   // 端点
// 成功判据：0===dt && 0===vt  即  status===0 && data.Code===0，并取 data.ItemId
// 成功后文案：bt ? "全部保存成功" : "全部发表成功"（bt = 是否草稿）
```

### 2.2 PublishType 枚举（逐字）

```js
var a = { publish: 1, timer: 2, draft: 0 }
```

⚠️ **草稿是 0，不是 1**。上一轮我在 `run()` 里用 `draft: true` 布尔，没有任何枚举语义；
如果哪天真按「1=发布」写死，会把草稿发成正式发布。

### 2.3 请求体构造器（逐字摘录，PascalCase）

```js
Dt.ItemId = L || ""                                    // 新建为空 / 有 id = 编辑
Dt.Title = a
Dt.VideoInfo = { Vid: i, VName: Ct, ThumbUri: s, ThumbUrl: f,
                 Duration: I, VideoWidth: Q||nt, VideoHeight: X||rt }
Dt.Abstract = u
Dt.PublishType = e                                      // 0 草稿 / 1 发布 / 2 定时
Dt.From = "mp"
Dt.EnterFrom = 5
Dt.IsNew = !L
Dt.VideoType = Tt                                       // Tt = U<1 ? 6 : 3
Dt.CreateSource = 2
Dt.HashtagIds = [...]
Dt.AttrsValueMap = st
Dt.HideInfo = { HideType: gt }
Dt.ComplianceInfo = ...                                 // IsAIGC / ComplianceType / CreativeInfo
```

`VideoType` 语义由发布后的路由反证：`3 === Y.VideoType` ⇒ 横版管理页，否则 ⇒ 小视频页。

### 2.4 发稿前的五道平台侧闸门（每条都有平台原文）

| # | 闸门 | 平台原文 |
| --- | --- | --- |
| 1 | 实名认证 | `realNameNewDialog("video")` —— 未实名**直接弹框，根本不发请求** |
| 2 | 用户状态 | `当前用户状态不能发文！` |
| 3 | 视频上传完成 | `该视频还未上传完成，请上传完成再发表` |
| 4 | 标题长度 | 草稿：`保存草稿失败，标题限制为 N 字以内`；发布：`该视频的标题需要在 W～z 字之间` |
| 5 | **封面必填** | `该视频需要上传一个封面` |

## 三、这条证据解释了今晚真机「点了按钮什么都不发」的现象

真机取证时我先后试了三版脚本，都捕获不到发稿请求。最后查账号状态才发现根因**不在技术侧**：

```
GET /mp/agw/media/get_user_base_info  →  { "is_auth": false, "media_status": 4 }
页面顶部：「请完善账号信息，解锁发布文章、视频等权益功能」
```

⇒ 该头条号在**第 1 道闸（实名认证）**就被拦，请求根本没发出去。
也正因为被本地闸门拦住，**今晚没有产生任何草稿或正式作品**（已核实草稿箱为空、作品管理无新增）。

**结论：头条真机发布成功的前置条件是账号完成实名/信息完善 —— 这是人工操作，不是代码缺陷。**
我不去绕过它（绕实名认证既违规也不该做）。

## 四、代码改动

| 文件 | 改动 |
| --- | --- |
| `publish/platforms/toutiao-video-publish.js`（新，约 210 行） | **发稿契约**纯函数模块：端点常量、`PUBLISH_TYPE`/`VIDEO_TYPE` 枚举、`truncateByCodePoint`、`buildToutiaoPublishBody`、`parsePublishResponse`。不发请求、不持状态，可直测 |
| `publish/platforms/toutiao-video.js` | ① 头部文档改为**如实记录证据来路**（承认上一轮是套语料 + 臆断）；② 发稿相关全部委托新模块（`buildPublishBody`/`publish` 变薄）；③ 新增 `checkPublishAuth()` 只读闸门（`GetPublishAuth` + `GetPublishPageReviewLatency`）；④ `run()` 增加「封面必填」本地闸门 + 上传前的权限闸门。**513 行 → 446 行**（`:500` 熔断内） |
| `test/toutiao-video-chain.test.js` | 17 例 → **28 例**（新增 11 例：body 形状、竖版 `VideoType=6`、草稿枚举、定时发布、两级判据、无权限时在上传前返回、缺封面零请求等） |
| `01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` | ① §11.0 表格订正头条行（语料那条是微视的）+ 新增「跨平台套用」纪律；② §11.1 第 3 条标记已实现；③ **新增 §12**（证据来源、发稿契约逐字表、五道闸门、真机结论、显示项与提示文字） |

### 关键取舍

- **封面闸门放在本地（零请求）**：平台原文要求封面必填，先判省掉「传完大文件才被拒」。
  同时提供 `opts.skipCoverCheck` 仅供链路自测，生产路径默认不跳。
- **权限闸门「取不到不阻断」**：`checkPublishAuth()` 失败只记 warn 并把结论置 `null`，
  因为只读遥测端点偶发失败不该让整个发布失败；但**取到 `DisablePublish=true` 就在上传前直接返回失败**。
- **不删旧字段解析**：`publish()` 里仍兼容 `data.Code === undefined` 的情况（有些网关不回 Code），
  但 `ItemId` 为硬要求 —— 没有 id 就不算成功，不谎报。

## 五、测试读数

| 套件 | 读数 |
| --- | --- |
| `test/toutiao-video-chain.test.js` | **28 passed** |
| `test/toutiao-adapter-routing.test.js` | 8 passed |
| `test/douyin-video-chain.test.js`（共用 VOD 改造面） | 15 passed |
| `packages/api-publish-engine` 全量 | **rc=0**（44 个 vitest 文件 + 全部直跑用例） |

## 六、还没做完 / 不能假装做完

1. **头条真机发布未成功**，卡在账号实名认证（外部前置条件，非代码）。已核实**没有误发**任何内容。
2. **`VideoInfo.Duration/VideoWidth/VideoHeight`** 需要调用方提供（本地 mp4 探元数据能力尚未接进链），
   当前缺省会传 0；`VideoType` 因此会落到默认 3（横版）。属下一步待补。
3. **封面链路**：平台要求封面必填，但本链只接受调用方给 `thumbUri`/`cover.uri`，
   **尚未实现 imagex 封面上传**（抖音链有 `uploadCover` 可复用，头条的 imagex serviceId 待取证）。
4. `publishMode` 仍保持 `dom-only`（配置未动）：形态验证完了，但账号权益不通，切换无意义也无从验证。

## 七、质量节拍读数

| 门禁 | 读数 |
| --- | --- |
| `packages/api-publish-engine` 全量（含 vitest 44 文件） | **rc=0** |
| `check-max-lines.js` | **✅**（拆分后 `toutiao-video.js` 446 行 < 500；拆分前 513 行曾报 `NEW_OVER_LIMIT`） |
| `check-unwired-tests.js` | **OK** |
| `check-text-encoding-integrity.js` | **OK** |
| `check-no-brand-residue.js` | **PASS**（10358 tracked 文件） |
| `check-doc-abs-paths.js` | **PASS**（4150 受管文件） |
| `check-gate-record-debt.js` | **OK** |
| `verify-platform-onboarding.js toutiao` | **13 条判据全 PASS** |
| `verify-platform-onboarding.test.js` | **21/21 pass** |
| QM-1 `build:vue` | **rc=0**（1m 54s） |
| QM-1 `electron-builder --win --dir` | **rc=0** |
| QM-1 启动验证 | **PASS**：alive(8s)=true / stderr **0 字节** / stdout 20,428 字节 |

## 八、自扮演裁决（评审后端第 7 次环境超时）

`sh scripts/deep-review.sh` 判定 DUAL（526 行 > 200 阈值），跨家族后端再次
`spawnSync codeagent-wrapper.exe ETIMEDOUT` ⇒ 按引擎第三档出口 `self_play` 自查。
本条是「订正上一轮臆断」的 PR，自查重点是**「新实现会不会又引入新的不一致/新臆断」**：

| # | 级别 | 问题 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | Warning | **封面闸门与 body 构造接受的封面来源不一致**：闸门只认 `cover/coverPath`，而 `buildToutiaoPublishBody` 还认 `thumbUri` ⇒ 调用方给「已上传好的 thumbUri」反被本地拦掉 | 成立·已修 | 闸门收敛成 `coverInputs` 数组，与 body 来源逐一对应；补 1 例回归（只给 `thumbUri` 必须放行且落进 `VideoInfo.ThumbUri`） |
| i2 | Info | 失败文案的 status 取自 `res.data.status`，`res.data` 为空时打印 `status=undefined` | 成立·已修 | `parsePublishResponse` 增加归一化 `status`（缺失即 `null`），文案改用之 |
| i3 | Warning | `parsePublishResponse` 把 `data.Code === undefined` 当成功，理论上可把失败读成成功 | 接受·已登记 | 放宽理由：部分网关变体不回 `Code`，硬要求会全部误判失败；兜底是 **`ItemId` 为硬要求**，这点没放宽。若真机观察到「有 ItemId 但实际失败」应去掉放宽 |
| i4 | Info | `run()` 每次发布多打 2 个只读请求（约 +200–400ms） | 接受·已登记 | 换来「上传大文件前」就判出无权限；且取不到时只 warn 不阻断 |
| i5 | Info | 为过 `:500` 熔断拆出 `toutiao-video-publish.js`，是否属装饰性拆分 | 成立·说明 | 拆分边界是**纯函数契约 vs 链编排**（零 IO / 零状态），公开 API 未变（`PUBLISH_TYPE`/`VIDEO_TYPE`/`truncateByCodePoint` 仍从原文件再导出） |
| i6 | Info | 「bundle 取证」会不会是另一种臆断 | 成立·说明 | bundle 是**平台自己运行的那份代码**，证据等级高于竞品语料；且端点/判据/枚举三者互证。但**仍未经真机放行验证**（账号被实名闸挡住）⇒ `publishMode` 保持 `dom-only`，不把「bundle 取证」当成「线上已验证」 |

**小结**：6 条（成立并修复 2 / 接受并登记 2 / 成立并说明 2）。

## 九、远程同步

| 远程同步 | 由门禁推导 |
