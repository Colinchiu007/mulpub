# 融媒宝前端功能模块 API 全清册

> 来源：`D:\Program Files (x86)\融媒宝\Asset\`（266 个 JS，多为未压缩，GBK 编码）
> 提取方式：解析各模块 `request.js` / `Ajax*.js` 的 `Ajax(url, ...)` 调用 + 中文注释
> 生成时间：2026-10-13T04:38:34.385Z

---

## 认证机制（所有模块共用）

```javascript
xhr.setRequestHeader("loginToken", interface.loginInfo.logintoken)
```

所有业务请求都带 **`loginToken` 请求头**（融媒宝自有服务端 token，非平台 token）。
token 来源：`localStorage['AICLIPLOGIN']` 或 `sessionStorage['loginInfo']`，
由原生层通过 `LoginUserChange(logintoken, uid, usertype, ...)` 注入。

统一错误处理：响应 `code == 10010` → 调用 `window.JsAuthAccountInvalidate(id)`
**通知原生层「账号授权已失效」**（JS → C++ 反向回调）。

---

## 数据格式观察：混用两种字符编码

分析过程中实测发现的编码分布：

| 位置 | 编码 | 证据 |
|---|---|---|
| `Asset/` 下 .js / .html | **UTF-8**（无 BOM）| 按 UTF-8 读取中文注释正常 |
| `data/` 下 .txt / .ini | **GBK(936)** | 按 UTF-8 读会出现 `⟨U+FFFD×2⟩ֲ⟨U+FFFD×2⟩` 类替换字符 |

**踩坑记录**：把 UTF-8 的 `request.js` 按 GBK 解码，`产品卖点` 会变成 `浜у搧鍗栫偣`
（UTF-8 字节被按 GBK 解读的典型双重编码）。两类文件必须分别处理。

**对本项目的参考**：本项目源码统一 UTF-8（有编码门禁），
不存在这个问题。若将来导入第三方数据文件（如平台分类表），需先探测编码。

---

## AI 写作（6 个接口）

> 一键生成/改写文章 · 目录 `dist/view-ai-writing`

| # | 功能（源码注释）| 函数 | 方法 | 端点 |
|---|---|---|---|---|
| 1 | 产品卖点 | `getChatCompletions` | POST | `https://public.17van.com/dmx/PopV1` |
| 2 | AI写作 | `getAiWriting` | POST | `https://public.17van.com/dmx/AssistantV2` |
| 3 | 数据投递 | `getActionDeliver` | POST | `https://action.17van.com/action/deliver-ai` |
| 4 | 意见反馈 | `submitFeedback` | POST | `https://public.17van.com/feedback/submit` |
| 5 | 扣除额度 | `deductToken` | POST | `https://public.17van.com/dmx/AbnormalToken` |
| 6 | 获取用户资源 | `getUserSources` | POST | `https://public.17van.com/dmx/GetCommonNum` |

## 抖音互动（34 个接口）

> 评论 + 私信运营 · 目录 `dist/view-dy-interaction`

| # | 功能（源码注释）| 函数 | 方法 | 端点 |
|---|---|---|---|---|
| 1 | 获取用户视频 | `getUserVideo` | POST | `interface.17van.com/pc/selectAuthVideo` |
| 2 | 获取单个视频评论 | `getVideoComment` | POST | `interface.17van.com/pc/selectCommentlist` |
| 3 | 获取全部视频评论 | `getAllVideoComt` | POST | `interface.17van.com/pc/selectCommentByTime` |
| 4 | 获取评论回复 | `getCommentReply` | POST | `interface.17van.com/pc/selectCommentReplylist` |
| 5 | 获取剩余回复条数 | `getReplyLimit` | POST | `interface.17van.com/pc/getCommentLimit` |
| 6 | 发送回复评论 | `sendReplyComment` | POST | `interface.17van.com/pc/replyComment` |
| 7 | 获取话术列表 | `getScriptList` | POST | `interface.17van.com/pcdouyin/getScript` |
| 8 | 新增话术 | `addScript` | POST | `interface.17van.com/pcdouyin/addScript` |
| 9 | 修改话术 | `editScript` | POST | `interface.17van.com/pcdouyin/updateScript` |
| 10 | 删除话术 | `delScript` | POST | `interface.17van.com/pcdouyin/delScript` |
| 11 | 设置已读 | `setReadComment` | POST | `interface.17van.com/pc/resetCommentByTimeRead` |
| 12 | 获取视频封面 | `getVideoCover` | POST | `interface.17van.com/pc/getCover` |
| 13 | 获取推送开关接口 | `getPushSwitch` | POST | `interface.17van.com/pc/UpdatePushRate` |
| 14 | 查询开关 | `getBindEvent` | POST | `interface.17van.com/pc/getBindEventCallBack` |
| 15 | 查询开关 | `getBindCallBack` | POST | `interface.17van.com/pc/getBindCallBack` |
| 16 | 获取渠道列表 | `getChannelOem` | POST | `interface.17van.com/users/getOem` |
| 17 | 获取websocket连接信息 | `getWebSocketUrl` | POST | `interface.17van.com/PcDouyinLetter/getWs` |
| 18 | 获取当前账号下的联系人 | `getAccountContacts` | POST | `interface.17van.com/PcDouyinLetter/getContacts` |
| 19 | 置顶联系人 | `setContactsTop` | POST | `interface.17van.com/PcDouyinLetter/top` |
| 20 | 批量标识已读 | `setBatchRead` | POST | `interface.17van.com/PcDouyinLetter/batchRead` |
| 21 | 初始化聊天记录 | `setInitRecord` | POST | `interface.17van.com/PcDouyinLetter/iniRecord` |
| 22 | 搜索聊天记录 | `getSearchRecord` | POST | `interface.17van.com/PcDouyinLetter/searchRecord` |
| 23 | 删除联系人 | `delContacts` | POST | `interface.17van.com/PcDouyinLetter/delContacts` |
| 24 | 获取token | `getClientToken` | POST | `interface.17van.com/PcDouyinLetter/getClientToken` |
| 25 | 图片上传 | `getUploadFile` | POST | `interface.17van.com/PcDouyinLetter/douYinUpload` |
| 26 | 创建、更新小程序引导卡片 | `setAppletTemp` | POST | `interface.17van.com/PcDouyinLetter/addUpdateGuideCard` |
| 27 | 查询小程序引导卡片 | `queryAppleTemp` | POST | `interface.17van.com/PcDouyinLetter/selectGuideCard` |
| 28 | 删除小程序引导卡片 | `delAppleTemp` | POST | `interface.17van.com/PcDouyinLetter/delGuideCard` |
| 29 | 撤回私信 | `revokeMessage` | POST | `interface.17van.com/PcDouyinLetter/imRevoke` |
| 30 | 发送私信 | `sendMessage` | POST | `interface.17van.com/PcDouyinLetter/sendIm` |
| 31 | 获取话术 | `getScriptInfo` | POST | `interface.17van.com/PcDouyinLetter/getScript` |
| 32 | 新增话术 | `addScriptInfo` | POST | `interface.17van.com/PcDouyinLetter/addScript` |
| 33 | 删除话术 | `delScriptInfo` | POST | `interface.17van.com/PcDouyinLetter/delScript` |
| 34 | 获取主\|子账号详情 | `getUserInfo` | POST | `interface.17van.com/PcDouyinLetter/getSubUserAccount` |

## 自动回复规则（10 个接口）

> 关键词回复策略 · 目录 `dist/view-dy-rules`

| # | 功能（源码注释）| 函数 | 方法 | 端点 |
|---|---|---|---|---|
| 1 | 新增规则 | `addCommentRules` | POST | `interface.17van.com/pcdouyin/addRules` |
| 2 | 修改规则 | `editCommentRules` | POST | `interface.17van.com/pcdouyin/updateRules` |
| 3 | 删除规则 | `delCommentRules` | POST | `interface.17van.com/pcdouyin/batchDel` |
| 4 | 获取规则列表 | `getList` | POST | `interface.17van.com/pcdouyin/getRules` |
| 5 | 图片上传 | `getUploadFile` | POST | `interface.17van.com/PcDouyinLetter/douYinUpload` |
| 6 | 七牛云上传 | `getUploadQn` | POST | `https://bkend.17van.com/ApiWebsite/UploadQiNiuYun` |
| 7 | 新建规则 | `addPrivateRules` | POST | `interface.17van.com/PcDouyinLetter/addRules` |
| 8 | 修改规则 | `editPrivateRules` | POST | `interface.17van.com/PcDouyinLetter/updateRules` |
| 9 | 获取规则列表 | `getList` | POST | `interface.17van.com/PcDouyinLetter/getRules` |
| 10 | 查询小程序引导卡片 | `queryAppleTemp` | POST | `interface.17van.com/PcDouyinLetter/selectGuideCard` |

## 抖音数据分析（14 个接口）

> 账号/视频/直播/粉丝数据 · 目录 `dist/view-dy-analysis`

| # | 功能（源码注释）| 函数 | 方法 | 端点 |
|---|---|---|---|---|
| 1 | 获取全部用户数据 | `getAllAccount` | POST | `interface.17van.com/PccDouyinOpen/getSubUserAccount` |
| 2 | 获取账号下用户列表 | `getAccountUser` | POST | `interface.17van.com/pcdouyin/getSubUserAccount` |
| 3 | 获取账号下总粉丝数据 | `getAllFansData` | POST | `interface.17van.com/PcDouyinOpen/getParallelFanData` |
| 4 | 获取用户数据 | `getNewUserData` | POST | `interface.17van.com/PccDouyinOpen/getNewAccount` |
| 5 | 获取单个用户视频 | `getUserVideo` | POST | `interface.17van.com/pc/selectAuthVideo` |
| 6 | 获取视频详情 | `getVideoDetails` | POST | `interface.17van.com/PcDouyinOpen/getVideoBase` |
| 7 | 获取视频播放量 | `getVideoPlay` | POST | `interface.17van.com/PcDouyinOpen/getVideoPlay` |
| 8 | 获取视频点赞量 | `getVideoLike` | POST | `interface.17van.com/PcDouyinOpen/getVideoLike` |
| 9 | 获取视频评论量 | `getVideoComment` | POST | `interface.17van.com/PcDouyinOpen/getVideoComment` |
| 10 | 获取视频分享量 | `getVideoShare` | POST | `interface.17van.com/PcDouyinOpen/getVideoShare` |
| 11 | 获取直播数据 | `getLiveData` | POST | `interface.17van.com/PcDouyinOpen/getLiveData` |
| 12 | 获取用户粉丝数据 | `getUserFans` | POST | `interface.17van.com/PcDouyinOpen/getFanData` |
| 13 | 获取用户粉丝热评 | `getFansHot` | POST | `interface.17van.com/PcDouyinOpen/getFanHotReview` |
| 14 | 数据投递 | `getActionCollect` | POST | `https://action.17van.com/action/collection` |

## 快捷回复（8 个接口）

> 话术库 · 目录 `dist/view-quick-reply`

| # | 功能（源码注释）| 函数 | 方法 | 端点 |
|---|---|---|---|---|
| 1 | — | `getReplyList` | POST | `interface.17van.com/pcdouyin/getScript` |
| 2 | — | `addReply` | POST | `interface.17van.com/pcdouyin/addScript` |
| 3 | — | `editReply` | POST | `interface.17van.com/pcdouyin/updateScript` |
| 4 | — | `deleteReply` | POST | `interface.17van.com/pcdouyin/delScript` |
| 5 | — | `getReplyList` | POST | `interface.17van.com/PcDouyinLetter/getScript` |
| 6 | — | `addReply` | POST | `interface.17van.com/PcDouyinLetter/addScript` |
| 7 | — | `editReply` | POST | `interface.17van.com/PcDouyinLetter/updateScript` |
| 8 | — | `deleteReply` | POST | `interface.17van.com/PcDouyinLetter/delScript` |

---

## 汇总

**共提取 72 个前端接口**，分布在 5 个功能模块。

| 模块 | 接口数 |
|---|---:|
| 抖音互动 | 34 |
| 抖音数据分析 | 14 |
| 自动回复规则 | 10 |
| 快捷回复 | 8 |
| AI 写作 | 6 |

---

## 后端域名分布

| 域名 | 接口数 | 用途 |
|---|---:|---|
| `interface.17van.com` | 64 | **业务主接口**（发布/数据/互动/私信/话术） |
| `public.17van.com` | 5 | **AI 服务 + 公共接口**（AI 写作/额度/反馈/Office 转换/语音） |
| `action.17van.com` | 2 | **埋点投递**（deliver-ai / collection / deliver-solve） |
| `bkend.17van.com` | 1 | **后台接口**（配置/广告/公告/组件检查/七牛上传） |

**架构判读**：融媒宝按**职责拆分域名**——
`interface`（业务）/ `public`（AI+公共）/ `bkend`（后台）/ `action`（埋点）。
本项目对应的是单机 + FastAPI 后端（`ops-center` :8010），不存在多域名拆分需求，
但**按职责分层**的思路可用于本项目后端路由组织。

---

## 代码质量观察：API 前缀命名混乱

同样指向抖音业务的接口，存在**多个不一致的路径前缀**：

```
  /PcDouyinLetter/
  /PcDouyinOpen/
  /PccDouyinOpen/
  /pcdouyin/
```

`pcdouyin` / `PcDouyinLetter` / `PcDouyinOpen` / `PccDouyinOpen` / `pc` —— 
大小写与字母数都不统一（`Pcc` 疑似 `Pc` 的笔误被沿用）。
这反映**长期迭代中缺少接口命名规范**。

> 对照本项目：AGENTS.md 有明确的目录/命名规范与门禁（`check-no-brand-residue`、
> `content-formatter` 单一实现、`safe-http-url` 单一实现等），工程纪律明显更强。
