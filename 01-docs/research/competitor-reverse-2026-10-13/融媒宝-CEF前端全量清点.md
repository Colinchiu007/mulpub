# 融媒宝 CEF 前端（`Asset/`）全量静态清点

> **文档性质**：对 `Asset/` 下 **316 个 js/html（32.7 MB）** 做纯文本静态扫描，
> **不执行任何 JS、不联网、不加载页面**。
> **取证日期**：2026-10-19 ｜ **复现**：`<REA_WORKSPACE>` 下的 `extract-asset-js-inventory.cjs`（一次 5 秒）
>
> **补的是哪块空白**：本目录此前只有 `融媒宝-view-ai-clip拆解.md`（69 KB）与
> `融媒宝-view-xhs-template拆解.md`（77 KB）**两个 view** 被逐字拆解，
> 而 `Asset/` 实际有 316 个文件 / 32.7 MB。业务逻辑（调哪个接口、走什么流程、签名怎么拼）**全在这一层**，
> 且它是**明文** —— 不像原生层每次要付 30 分钟反编译。**投入产出比最高的一块此前恰恰最薄。**

---

## 1. 规模与结构

| 项 | 值 |
| --- | --- |
| 文件数 | **316**（`.js` + `.html`）|
| 总体积 | **32.7 MB** |
| 扫描耗时 | **5 秒** |
| 去重 URL | **967** |
| 去重域名 | 192（排除噪声后 **175**）|
| 去重 API 路径 | **98** |
| window 全局函数 | 112 |
| **JS → 原生回调** | **63** |

### 1.1 各子目录体积（决定后续分析优先级）

| 目录 | js 数 | 体积 | 内容判读 |
| --- | --- | --- | --- |
| `sign2/` | 10 | **18.7 MB** | **签名体系**（`sign2.js` 6.35 MB、`chuangzuozhe.js` 3.4 MB、`crypto-js.min.js`）|
| `dist/` | 89 | 6.1 MB | **主前端**（各 view 实现）← **真正的业务逻辑主战场** |
| `DouyinBd/` | 10 | 2.6 MB | 抖音绑定 |
| `WEMediaEdit/` | 139 | 2.5 MB | 编辑器（含 ueditor）|
| `Chart/` | 4 | 1.4 MB | 图表 |
| `AgComment/` | 6 | 883 KB | 评论/互动运营 |
| `ImageCut/` | 5 | 260 KB | 图片裁剪 |
| `BaiduVerifyToken/` | 1 | 40 KB | 百度验证令牌 |
| `Sign/sign.js` | 1 | 0.9 KB | **百度/Google 挑战签名** → 见 `derived/融媒宝-签名算法-TKK与gtk系列.md` |
| `sign2/sign3.js` | — | 13.7 KB | 抖音 `a_bogus`（SM3 实现）|
| `sign2/sign4.js` | — | 28.8 KB | 抖音 `X-Bogus`（jsVMP 字节码）|

> **优先级建议**：`sign2/` 体积最大但价值已被签名文档覆盖；
> **`dist/` 的 89 个 js 才是尚未逐 view 拆解的部分**。

---

## 2. ★ 竞品自家后端：9 个域名 / 333 条 URL

这是本轮**最具行动价值**的产出 —— 竞品自己的服务端架构，与各平台 API 完全不同。

| 域名 | 关键路径 | 判读 |
| --- | --- | --- |
| `interface.17van.com` | `/UserExtend/getCreate`<br>`/UserExtend/deductCreate`<br>`/users/getOem` | **额度体系**（查询创建配额 / 扣减）+ **OEM 贴牌** |
| `public.17van.com` | `/dmx/PopV1`<br>`/dmx/AbnormalToken`<br>`/dmx/AssistantV2`<br>`/dmx/GetCommonNum`<br>`/dmx/xhs`<br>`/voice/Music`<br>`/voice/VoiceTemplate`<br>`/feedback/submit` | 公共能力：弹窗、**token 异常恢复**、助手、小红书特化、**音乐/配音模板**、反馈 |
| `action.17van.com` | `/action/deliver`<br>`/action/deliver-ai`<br>`/action/collection` | **发布动作 / AI 发布 / 采集** |
| `bkend.17van.com` | `/ApiWebsite/UploadQiNiuYun` | **七牛云上传**（对象存储用第三方）|
| `static2.17van.com` | 293 条（`/images/expression/*.png` 为主）| 静态资源 CDN（表情包素材）|
| `static.17van.com` | `/rmbclient/images/prod*.png` | 静态图片（`rmbclient` = 融媒宝 client）|
| `toolsdownload.17van.com` | — | 工具下载 |
| `download.17van.com` | `/word/douyinqiyehao.pdf` | 文档下载（抖音企业号说明）|
| `www.17van.com` | — | 官网 |

### 2.1 三条可直接借鉴的架构判读

1. **额度是服务端扣减的**（`/UserExtend/deductCreate`）—— 不是客户端记账。
   对本项目：若要做订阅/次数限制，**必须在服务端留扣减点**，客户端只做展示。
2. **`/dmx/AbnormalToken` 是独立的恢复通道** —— 他们承认 token 会异常，并为此单独开接口。
   对本项目：各平台 token 失效是常态，**需要一条「异常恢复」而非「重新登录」的轻量路径**。
3. **上传走七牛云**（`/ApiWebsite/UploadQiNiuYun`）—— 不自建对象存储。
   对本项目：若自建上传会多一份运维成本，可对照。

---

## 3. 各平台 API 路径（98 条）

分布反映**实际集成**的平台，而不是宣传的平台数：

| 服务名前缀 | 条数 | 归属 |
| --- | --- | --- |
| `/api/galaxy/*` | 14 | **小红书**创作者平台（galaxy = XHS 内部服务名）|
| `/api/sns/*` | 6 | 小红书（`capa/servicegw` = XHS 能力网关）|
| `/api/cas/*` | 12 | 统一登录（CAS）|
| `/api/sec/v1/*` | 2 | 安全（`scripting` / `sbtsource`）|
| `/api/media/v1/upload/*` | 2 | 媒体上传许可 |
| `/api/edith/*` | 1+ | 小红书编辑器（edith）|
| `/rest/kd/log/*`、`/rest/wd/common/log/*` | 4 | 埋点上报 |

> 这 98 条只覆盖**以 `/api/` 等固定前缀开头**的；
> 完整平台接口清单见 `mtm-platform-apis.md`（1,327 条，来自原生层字符串，覆盖面更广）。

---

## 4. ★ JS → 原生 回调面（63 个，全枚举）

竞品把「JS 调原生」统一实现成 `window.JsXxx(...)`，原生侧注册 `cef_browser_*` 处理器。
这 63 个就是**前端与原生之间的完整契约面**：

### 4.1 文件 IO（13 个）—— 前端重度依赖本地文件

`JsReadLocalFile` · `JsWriteLocalFile` · `JsReadFileBase64` · `JsWriteBase64File` ·
`JsReadFileDataPiece` · `JsReadLocalJsonFile` · `JsDeleteFile` · `JsDeleteFolder` ·
`JsOpenFolder` · `JsLocateFile` · `JsPathFileExist` · `JsGetFileSize` · `JsStartSelectFolder`

### 4.2 媒体处理（9 个）

`JsStartSelectVideo` · `JsStartSelectMusic` · `JsTextToAudio` · `JsDownloadFont` ·
`JsGetVideoInfo` · `JsGetVideoSize` · `JsGetCutVideoImgData` · `JsGetCutImgData` · `JsGetCutPlayTime`

### 4.3 智能剪辑任务（14 个，`view-smart-clip`）

`JsCreateWork` · `JsCreateWorkPathUpdate` · `JsCreateXhsImagePathUpdate` · `JsCancelTask` ·
`JsCloseTaskCenter` · `JsDeleteWork` · `JsDeleteDraft` · `JsSaveDraft` · `JsDraftStatuChange` ·
`JsSwitchPage` · `JsCreatePointsUpdate`

> **`view-smart-clip` 是最大的单块功能**（14 个专用回调）⇒ 智能剪辑是他们的主打差异点。

### 4.4 商业化（4 个）—— **免费/付费边界在这**

`JsBuyVip` · `JsBuyVipPageOpenUrl` · `JsBuyCreatePoints` · `JsCreatePointsUpdate`

> **`CreatePoints`（创建点数）与 `BuyCreatePoints`（购买点数）成对出现** ⇒
> 计费单位是**「创建次数」**，不是时长/席位。与 §2 的 `/UserExtend/deductCreate` 完全对应。

### 4.5 其余分组

| 组 | 数量 | 频道 |
| --- | --- | --- |
| 账号与授权 | 2 | `JsAuthAccountInvalidate`（**×11，频率最高**）· `JsSelectMediaAccount` |
| 内容与风控 | 4 | `JsGetRiskArticle` · `JsRiskContentChange` · `JsGetIntelligentWriteArticle` · `JsGetArticleContent` |
| 评论区运营（`AgComment`）| 7 | `JsReplyCommentTimes` · `JsNewPolicySuc` · `JsCancelNewPolicy` · `JsQueryWorkList` · `JsQueryWorkDetail` · `JsCancelQueryWorkList` · `JsShowSelectContentWnd` |
| 抖音专项 | 6 | `JsSelectDouyinCard` · `JsShowSelectDouyinCardWnd` · `JsCloseSelectDouyinCardWnd` · `JsStartUseDouyinInteractionMgr` · `JsUpdateDouyinMsgUnReadCount` · `JsSendMsgToWeb` |
| 签名与验证 | 3 | `JsBaiduSign` · `JsGoogleSign` · `JsBaiduVerifyToken` |
| 编辑器（`WEMediaEdit`）| 5 | `JsConvertWordToHtml` · `JsInsertImg` · `JsPasteMemoryImage` · `JsContentChange` · `JsReadFileBase64` |

---

## 5. 三个可直接落地的结论

1. **竞品的计费单位是「创建次数」**（`JsBuyCreatePoints` + `/UserExtend/deductCreate` 双证）。
   对本项目：讨论订阅模型时这是竞品的实际口径。
2. **前端有 13 个文件 IO 回调** ⇒ 业务重度依赖本地文件（素材/草稿都在本地）。
   这解释了为什么他们的「草稿」不怕断网，但也意味着**多端同步是弱项**。
3. **`view-smart-clip` 是最大单块功能**（14 个专用回调）⇒ 智能剪辑是主打差异点。

---

## 6. 复现

```bash
# 全量清点（约 5 秒）
node extract-asset-js-inventory.cjs "<安装目录>\Asset" --json > asset-inventory.json

# 人读摘要
node extract-asset-js-inventory.cjs "<安装目录>\Asset"
```

> `<安装目录>` 指目标机器上的融媒宝安装目录（厂商产物，不入仓）。

---

## 7. 未闭合

| # | 项 | 卡在哪 |
| --- | --- | --- |
| 1 | **`dist/` 89 个 js 未逐 view 拆解** | 本轮只做「清点」不做「逐字拆解」；`view-ai-clip` / `view-xhs-template` 已有专项文档 |
| 2 | **112 个 window 函数未逐个判读用途** | 只统计了数量与 top30 名单 |
| 3 | **`sign2/sign2.js`（6.35 MB）未拆** | 体积最大但疑似是打包后的抖音/创作者逻辑，价值待评估 |
| 4 | **view 正则仍有残余假阳** | 已从 43 降到 35，但 `view-class`/`viewport` 仍是噪声 |
| 5 | **无活体验证** | 全部为静态文本，**没有向任何接口发过请求** |
