# 融媒宝自家后端 API 面（interface.17van.com 等 10 域）端点全表

> **文档性质**：纯静态读码取证。不反编译、不执行、不联网。
> **取证日期**：2026-10-19
> **脚本**：`02-analysis-scripts/extract-17van-api-surface.cjs`（可重跑）
> **机器可读**：`04-rea-evidence/17van-API面扫描.json`（每端点含全部调用点 file:line / exe 偏移 + ±200 字符上下文）
> **上游**：`融媒宝-hxfalcon指令集与URL三分类.md` §5 遗留 #2（`/key/map` 用途）由本篇收敛；同篇 §3.3「自家后端 9 域」扩为 **10 域**（Asset 收割出第 10 域 `static2.17van.com`）。
>
> 证据口径：`exe@偏移` = `WEMedia.exe` latin1 可打印段内偏移；`Asset\<路径>:<行号>` = 前端页面文件行号；`exe-js` = exe 内嵌 JS 字符串常量（同 exe 偏移）。凡无证据的推断一律标「未证」。

---

## 0. 结论先行

1. **端点总数 498**（唯一 host+path）：起点清单 57（URL三分类 own paths，被上游脚本截断）→ 注入JS片段.json 全量 urls 补齐 70（=127）→ Asset 前端收割新增 371（含第 10 域 `static2.17van.com` 的 292 条静态资源路径）。498 条**全部有调用点证据**，脚本侧「未证端点」为 0。
2. **接口分层是双栈**：exe 注册表（@13859900~@13864290，129 条 URL 与参数名交替存放，紧邻原生 `WinHttp`/`HttpRequest.cpp` 字符串区）承载**账号/VIP/子账号/备份/风控**；Asset 前端独有约 90 个接口（评论、私信、榜单、AI 扣费）**在 exe 双编码（ascii+utf16）下 0 出现** —— 由 CEF 页面直发。`UserExtend/deductCreate` 等扣费端点只存在于 Asset（`Asset\dist\common\request.js:96`），exe 注册表里没有。
3. **三问答案**：
   - **(a) `/key/map`：语义未证。** 全 exe 仅 1 处（裸 URL，前后即注册表相邻项），Asset 0 处，无任何邻近参数名/键名/调用代码；注册表内其它端点多有参数名伴随（inviteCode、sub_uid_list…），它是唯一例外。「密钥分发」是上一轮的猜测，本轮取证不支持升级为结论。
   - **(b) 计费语义：已证，扣在 `UserExtend/deductCreate`。** 「创点（createpoints）」是可购买、按任务消耗的账户级点数：发起前查余额，AI 混剪按视频时长计点（≤30s=1 点，之后每 30s+0.5）、红薯模板每篇扣 1 点；购买走原生桥 `JsBuyCreatePoints(type)`，余额由原生回调 `SetCreatePoints(%I64d)` 下发（原生按 0.1 粒度整型存储）。**注意：扣费调用点在 Asset 前端发起，但账务是服务端记账**——「怎么扣」能看出「扣多少、何时扣、扣失败怎么办」，「服务端怎么记」未证。
   - **(c) `/danger/*` 风控自检：触发方与时机未证。** 两个端点只出现在 exe 静态注册表（@13862676/@13862720），Asset 前端 0 引用，注册区 ±1.7KB 无 danger 相关原生标识符，UTF-16 文案区无「危险/风控」。同区紧邻的 `/rewrite/check`+`/rewrite/rewrite`、`/danger/check`+`/danger/danger` 都是「check+主操作」对，check 大概率是前置校验端点——但谁在什么时机调它，静态证据取不到。

---

## 1. 数据源与收割口径

| # | 载体 | 说明 | 产出 |
| --- | --- | --- | --- |
| ① | `WEMedia.exe.URL三分类.json` own 数组 | 起点清单（paths 被上游脚本截断至 12 条/host） | 57 端点 |
| ② | `WEMedia.exe.注入JS片段.json` 全量 urls | exe 内嵌 JS 字符串常量里的 URL（单一真源回源） | +70 → 127 |
| ③ | `<安装目录>\Asset\` 全部 316 个 .js/.html | 字面 URL + `baseUrl("...")` 模式收割 + 行级定位 | +371 → 498 |
| ④ | `WEMedia.exe` latin1 printable-runs | 原生侧字符串常量，逐字节扫描 | exe 命中 127 端点 |

**关键勘误**：URL三分类.json 显示 `interface.17van.com` 仅 12 条 path（count=70），是 `extract-url-classification.cjs` 的 `g.paths.size < 12` 截断，**不是**实际 API 面边界；本篇以回源后的全量为准。

**域划分**（10 域）：

| 域 | 端点数 | 角色 |
| --- | --- | --- |
| interface.17van.com | 135 | **主 API**：账号、VIP、子账号、备份、评论、私信、榜单、扣费 |
| public.17van.com | 17 | 公共能力：AI（dmx/*）、配音配乐、文档转换、VIP 公共查询 |
| bkend.17van.com | 17 | 运营后台：广告位、公告、更新检查、配置下发、七牛上传凭证 |
| action.17van.com | 4 | 埋点/数据投递 |
| www.17van.com | 3 | 官网购买/微信二维码 |
| api.17van.com | 1 | 原创检测 |
| download.17van.com | 6 | 插件/字体/文档下载 |
| static.17van.com | 3 | 前端 base 路径 |
| static2.17van.com | 292 | 静态资源（表情包 183、模板图、UI 图）——Asset 收割新增域 |
| toolsdownload.17van.com | 20 | 字体文件（arttext 用，`Asset\dist\store\useClip.js:489~603`）|

⇒ **真正的 API 面 ≈ interface(135) + public(17) + bkend(17) + action(4) + www(3) + api(1) ≈ 177 个**，其余是资源分发。

---

## 2. interface.17van.com（135 端点，主 API）

### 2.1 exe 注册表区（原生侧，`exe-js`=段偏移）

注册表位于 exe @13859900~@13864290，**URL 与参数名交替存放**（如 `/pc/reg` 前置 `inviteCode`、`bd_vid`；`/subUsers/unbind` 前置 `sub_uid_list`；`/pcdouyin/bind` 前置 `tik_id`），表尾紧邻原生 HTTP 引擎区（`WinHttp`、`HttpRequest.cpp`、`DoRequest Fail:%d`、curl 日志路径 `curl_ipv4.ini`）⇒ 原生直接消费这张表。区首还有 4 个 GUID 常量与 `guid` 字面（@13859800~@13859960，用途未证）。

| 前缀 | 端点 | 证据 | 推断语义 |
| --- | --- | --- | --- |
| **账号体系 /pc/**（40 条，此处列原生侧）| login / reg | exe@13860164 / @13860036 | 登录 / 注册（参数 inviteCode、bd_vid——带邀请码与投放来源）|
| | checkPhone / resetPwdCheckPhone / resetPwd | exe@13859972 / @13860091 / @13860143 | 手机校验 / 改密前校验 / 重置密码 |
| | quit | exe@13860376 | 登出（参数 uniqueIds）|
| | deleteAccount | exe@13860480 | 注销账号（参数 del_backup）|
| | activate | exe@13860528 | 激活（与 teamVip/activate 平行的单账号激活）|
| | getUserInfo / getPermission | exe@13860248 / @13863412 | 用户信息 / 权限查询（参数 issubuser）|
| | weChatReg / weChatBind / phoneBindWeChat / weChatBindPhoneOld / weChatBindPhoneReg | exe@13862928~@13863116 | 微信绑定/换绑 5 条（参数 regOrigin）|
| | getScanEventCallBack | exe@13862864 | 扫码登录轮询 |
| | getUrlConfig | exe@13863640 | **未证**（URL 字面指向配置下发；注册表内无参数伴随）|
| | getStreamerInfo | exe@13863840 | **未证**（Stream(er) 语义存疑）|
| **VIP / teamVip** | teamVip/get / teamVip/activate | exe@13860336 / @13862764 | 团队 VIP 查询 / 激活（与 public/info/team-vip-get 平行）|
| **收藏/关注 /pc/** | addCollect / delCollect / getCollect | exe@13860924~@13861012 | 收藏（参数 isadd）|
| | addFollow / delFollow / updateFollow / getFollow | exe@13863236~@13863368 | 关注/追更（参数 follow_id）|
| **备份 /pc/** | backup / getbackup / getBackupCount / delBackupGroup | exe@13860624 / @13860664 / @13860748 / @13860568 | 备份写/读/计数/删组（public 域有同路径平行实现）|
| **子账号 /subUsers/（18）·/subBackup/（3）·/subCollect/（3）** | add/del/update/login/quit/bind/unbind/batchBind/batchUnBind/batchGetSubUserAccount/getSubUserAccount/getVipInfo/backUp + MonitorAccount 系 6 条 | exe@13861272~@13862532 | 子账号全家桶：独立登录态、VIP 与创点共享主账号、备份隔离 |
| **监控账号 /users/（4）** | getMonitorAccount / addMonitorAccount / delMonitorAccount / backUp | exe@13862264~@13862480 | 账号监控 |
| **抖音开放平台** | pcdouyin/bind / pcdouyin/unbind | exe@13863544 / @13863588 | 抖音官方开放平台授权绑定/解绑 |
| | PcDouyinLetter/getSubUserAccountMew | exe@13863472 | 私信模块子账号查询（参数 tik_id）|
| **AI 改写** | rewrite/check + rewrite/rewrite | exe@13862588 / @13862632 | check+主操作对：改写前校验 / 执行改写 |
| **风控自检** | danger/check + danger/danger | exe@13862676 / @13862720 | check+主操作对；**触发方与时机未证**（详见 §5）|
| **活动** | PcActivity/getTicket / newUserPreferential | exe@13863728 / @13863780 | 活动门票（getTicket 字面）/ 新人优惠 |
| **unknown 域** | **key/map** | exe@13863887 | **未证**（详见 §4）|

### 2.2 Asset 前端独有接口（exe 双编码 0 出现，CEF 页面直发）

| 前缀 | 端点 | 证据 | 推断语义 |
| --- | --- | --- | --- |
| **扣费 /UserExtend/（2）** | UserExtend/deductCreate | `Asset\dist\common\request.js:96` | **扣除创点**（POST {create_num, type}；返回 code==="200" 且 data==="1" 才算扣成）——计费核心，详见 §3 |
| | UserExtend/getCreate | `Asset\dist\common\request.js:110` | **刷新创点**（查余额，返回 data.create；前端展示 ×10 还原 0.1 粒度）|
| **评论区 /pc/（前端 8 条）** | selectAuthVideo / selectCommentlist / selectCommentReplylist / selectCommentByTime / replyComment / getCommentLimit / resetCommentByTimeRead / getCover | `Asset\AgComment\js\request.js:44~76`、`Asset\dist\view-dy-interaction\js\AjaxComment.js:47~91` | 授权视频/评论列表/回复列表/定时评论/回复/评论数限额/已读标记/视频封面 |
| **话术库 /pcdouyin/（前端 7 条）** | getScript / addScript / updateScript / delScript / addRules / updateRules / getRules / batchDel | `Asset\AgComment\js\request.js:34~72`、`Asset\dist\view-dy-rules\js\AjaxComment.js:46~61` | 自动回复话术与策略规则 CRUD |
| **抖音私信 /PcDouyinLetter/（前端 22 条）** | getWs / getContacts / top / batchRead / iniRecord / searchRecord / delContacts / sendIm / imRevoke / getClientToken / douYinUpload / getSubUserAccount / addUpdateGuideCard / selectGuideCard / delGuideCard / getScript·addScript·delScript·updateScript / addRules·getRules·updateRules | `Asset\dist\view-dy-interaction\js\AjaxPrivate.js:122~217`、`Asset\dist\view-quick-reply\js\request.js:47~56`、`Asset\dist\view-dy-rules\js\AjaxPrivate.js:121~146` | 私信 WebSocket、联系人、置顶、已读、记录检索、发消息/撤回、上传、引导卡片、话术与规则（+exe 的 getSubUserAccountMew 共 23 条）|
| **数据分析 /PcDouyinOpen/（8）·/PccDouyinOpen/（2）** | getSubUserAccount / getNewAccount / getParallelFanData / getVideoBase·Play·Like·Comment·Share / getLiveData / getFanData / getFanHotReview | `Asset\dist\view-dy-analysis\js\request.js:46~94` | 数据分析子账号 + 视频/直播/粉丝数据。`PccDouyinOpen`（双 c）与 `PcDouyinOpen` 并存——拼写漂移说明该后端没有 API 契约测试 |
| **榜单 /pcrank/（9）** | hot_rank / hotSentences / sentenceDetails / hotVideo / topic / liveRank / musicRank / sageRank / startRank | `Asset\DouyinBd\js\request.js:31~63` | 抖音热榜 9 条（热点/金句/视频/话题/直播/音乐/涨粉/带货/起号）|
| **互动辅助 /pc/（前端 3 条）** | UpdatePushRate / getBindEventCallBack / getBindCallBack | `Asset\dist\view-dy-interaction\js\AjaxIndex.js:51~68` | 推送频率 / 绑定事件轮询 |
| **渠道** | users/getOem | `Asset\dist\common\request.js:49`、`Asset\dist\view-dy-interaction\js\AjaxIndex.js:72` | OEM 渠道列表（exe 注册表无此条 ⇒ 前端独有）|

> 分层判据：`UserExtend`、`pcrank`、`selectCommentlist`、`PcDouyinOpen`、`PcDouyinLetter/getWs` 等在 exe 中 ascii 与 utf16 双口径均 **0 出现** ⇒ 这些接口由 CEF 页面直发，不经原生 HTTP 引擎。反之为原生侧持有（如 danger/*、key/map、pc 账号族）。

**两个结构性发现**：① `PcDouyinLetter/*` 23 条 + `getWs` WebSocket ⇒ 抖音私信是完整的独立子系统（联系人/话术/规则/已读/撤回），即 `view-quick-reply` 页面的服务端；② `/pcrank/*` 9 条热榜 ⇒ 「热榜」由**自家后端聚合**而非直连各平台——与 URL 三分类里 5 个第三方内容平台（yuncheapp 等）互为印证。

---

## 3. 计费语义（问 b）：创点（createpoints）体系，证据全链路

### 3.1 计费端点

| 端点 | 证据 | 请求 | 语义 |
| --- | --- | --- | --- |
| `interface.17van.com/UserExtend/deductCreate` | `Asset\dist\common\request.js:92~104`（注释「扣除创点」）| POST `{create_num: N, type: 1|2}` | 扣点；`code==="200" && data==="1"` 视为扣成，否则 resolve(0) |
| `interface.17van.com/UserExtend/getCreate` | `Asset\dist\common\request.js:106~118`（注释「刷新创点」）| POST 空 body | 查余额：`result.data?.create`；前端 `Number(val)*10` 广播 |

两个端点**只存在于 Asset**（exe ascii/utf16 均 0 命中）——扣费由前端直发 interface 域，不经原生层。

### 3.2 扣多少：前端计价规则（字面注释为证）

| 场景 | 计价 | 证据 |
| --- | --- | --- |
| AI 混剪（type=1）| ≤30s 视频=1 创点；之后每 30s +0.5 | `Asset\dist\view-smart-clip\home.html:117`（「合成视频消耗点数规则1分钟以内视频，合成并下载之后消耗一个创点，超出部分的时长，每30秒加0.5个」）；算法 `Asset\dist\view-ai-clip\main\methods.js:1233~1240`（`parseInt(i.totalDuration/30)*0.5`）|
| 红薯图文模板（type=2）| 每篇 1 点 | `Asset\dist\view-xhs-template\main\methods.js:190~193`（`DeductCreatePoint({create_num: 1, type: 2})`）|
| 「4 购买字符」 | 字符包（AI 写作类按字符计）| `Asset\dist\view-smart-clip\js\clientApi.js:166` 注释「1、2、3混剪购买创点、4购买字符、5红薯模版购买创点」；具体点率未证 |
| 发起前校验 | `createpoints < N` 即拦 | `Asset\dist\view-ai-clip\main\methods.js:51`（`loginVal.createpoints <= 0` 拦截）、`view-xhs-template\main\methods.js:109` |

### 3.3 怎么扣（时序，全部有代码证据）

```
① 发起任务前：页面查 loginInfo.createpoints（原生 LoginUserChange 下发，页面 createpoints/10 还原 0.1 粒度）
   证据：Asset\dist\view-smart-clip\js\clientApi.js:223~234
② 不足 → 弹「创点不足」对话框：「您的剩余创点不足以发起本次任务，您可以在支付页选择
   不同视频创点加油包进行购买！」→ 点击购买 → 原生桥 FnJsBuyCreatePoints(type)
   证据：Asset\dist\view-xhs-template\main\methods.js:164~181；
        exe@13782836 与 @13441245（桥名 JsBuyCreatePoints 注册表两处）
③ 足够 → 任务完成后 POST UserExtend/deductCreate{create_num, type}
   （ai-clip 场景 while(true) 重试至 code=200&data="1"，间隔 1000ms）
   证据：Asset\dist\common\request.js:92~104；Asset\dist\view-ai-clip\main\methods.js:1218~1232
④ 客户端余额更新：原生 interface.SetCreatePoints(%I64d) 回调页面（%I64d ⇒ 原生按 0.1 粒度整型存储）
   证据：exe@13576154；页面侧 Asset\dist\view-smart-clip\js\clientApi.js:274~286（SetCreatePoints）
```

### 3.4 计费相关辅助证据

| 证据 | 位置 |
| --- | --- |
| 「子账号与主账号共享创点,请联系您的主账号进行购买！」 | exe UTF-16 文案区 @13458158（子账号场景创点归属主账号）|
| 「创点：{{ loginInfo.createpoints }}」「剩余创点」UI | `Asset\dist\view-xhs-template\index.html:108`、`view-ai-clip\index.html:84` |
| exe 桥名注册表含 JsBuyCreatePoints / JsCreatePointsUpdate | exe@13441245、@13782836、@13440901 |
| exe 调用串 interface.SetCreatePoints(%I64d) | exe@13576154 |

**未证部分**：`deductCreate` 的服务端记账逻辑、创点价格表、「4 购买字符」具体点率、`type` 全部取值枚举（静态取不到，需运行时观察）。

---

## 4. `/key/map` 是什么（问 a）：**未证**

| 取证动作 | 结果 |
| --- | --- |
| exe 全量 latin1 扫描 `/key/map` | **仅 1 处**：@13863887（±400B 窗口内为注册表相邻 URL，无任何参数名/键名/函数名）|
| `Asset\` 全部 .js/.html | **0 处**（`keyMap` 命中均为 CodeMirror 快捷键表与配音样式映射，无关注入）|
| exe 键名线索（key_map/keyMap/getKey/secretKey/aes_key/encryptKey） | exe 仅 `publicKey`（4 处）与 `public_key`（7 处），均在签名/TLS 上下文（@12967988、@13405732 等），与该端点无关联证据 |
| 注册表参数名伴随 | 其它 128 条端点多有参数名交替（inviteCode、bd_vid、uniqueIds、del_backup、subUid、sub_uid_list、tik_id、follow_id、issubuser…）；`/key/map` 是**唯一裸 URL** |
| workspace 既往文档 | 仅 `融媒宝-hxfalcon指令集与URL三分类.md` §3.3 一句「疑似密钥分发（未证）」——该说法本身即上轮的猜测 |

**结论：未证。** 它是 exe 静态端点注册表的最后一个裸 URL 常量，路径字面（`key`+`map`）与「密钥/映射」的联想均无法在上下文中找到支撑；「密钥分发」停留在假设层级。收敛需运行时观察（抓包/断点），静态已到边界。

---

## 5. `/danger/*` 风控自检（问 c）：**触发方与时机未证**

| 取证动作 | 结果 |
| --- | --- |
| exe | 仅注册表 2 处（`/danger/check` @13862676、`/danger/danger` @13862720），连续存放，中间隔一个 `teamVip/activate` |
| Asset 全部 .js/.html `danger` 检索 | 0 处接口引用（命中均为 element-plus/ueditor 的 CSS 类 `danger` 与 sign2 打包库的 `Me.ZP.danger()` toast API，与该端点无关）|
| 注册区 ±1.7KB PascalCase 标识符 | Collect/VipInfo/Account/Backup/UnBind/MonitorAccount/Follow/Permission… **无任何 danger 相关**（原生触发函数名不可见）|
| exe UTF-16 中文 | 「危险」「风控」均 0 命中（相关提示文案不存在）|
| 结构类比 | 同区紧邻 `/rewrite/check` + `/rewrite/rewrite`（AI 改写校验+执行对）⇒ `check+主操作` 是该后端的端点命名惯例，`/danger/check` 大概率同为前置校验 —— **推断，未证** |

**结论：未证。** 静态可证的是：① 两端点由原生侧持有（只存在于 exe 注册表，前端 0 引用）；② 与 `/rewrite/*`、`/PcActivity/*` 同区，属「原生发起的功能簇」。谁调用（原生哪个模块/哪个页面触发）、什么时机（发布前/登录时/定时）——静态证据链在此中断。上一轮文档称其「风控自检」，本轮只能确认「名字含 danger 的原生侧端点对」，语义与触发链需运行时取证。

---

## 6. 其余域速览

| 域 | 端点 | 证据 | 推断语义 |
| --- | --- | --- | --- |
| **public.17van.com**（17）| dmx/PopV1 / dmx/AssistantV2 / dmx/xhs / dmx/GetCommonNum / dmx/AbnormalToken | `Asset\dist\common\request.js:62`、`view-ai-writing\js\request.js:29~49`、`view-xhs-template\js\request.js:4`、`view-smart-clip\js\request.js:5~18` | AI 系列：产品卖点 / AI 写作 / 红薯文案 / **获取用户资源（配额查询）** / **扣除额度**（`request.js:44` 注释「扣除额度」；与创点并行的第二套配额——字符额度，费率未证）|
| | voice/VoiceTemplate / voice/Music | `Asset\dist\common\request.js:73~85` | 配音主播 / 背景音乐 |
| | office/DocxToHtml / office/read | exe@13240784 / @13240744 | 文档转换（exe 侧）|
| | feedback/submit | `Asset\dist\view-ai-writing\js\request.js:41` | 意见反馈 |
| | info/getVipInfo / info/team-vip-get / info/check / info/getUserInfo | exe@13861515 / @13860291 / @13863924 / @13860204 | VIP 查询族（exe 侧；与 interface/subUsers/getVipInfo 平行）|
| | pc/backup / pc/getbackup / subusers/getbackup | exe@13861108 / @13860708 / @13861740 | 备份（public 域平行实现）|
| **bkend.17van.com**（17）| ApiAd/GetRotateInfo·GetAllInfo·GetAlertInfo·GetSideInfo | exe@13240344~@13240484 | 广告位（轮播/全部/弹窗/侧边）|
| | apiInterface/GetAnnounceInfo·GetSoftwareNotice·GetSwitchInfo | exe@13240872 / @13240528 / @13470200 | 公告 / 软件通知 / 开关（GetSwitchInfo 参数 `code=isQuitService`；同区 getUsersConf / setUsersConf 用户配置读写）|
| | apiInterface/NewGetQiNiuToken | exe@13863168 | 七牛上传凭证（客户端拿临时凭证直传七牛，不经自家服务器中转）|
| | ApiSoftware/CheckUpdate·CheckComponent | exe@13306532 / @13305092 | 更新检查 / 组件检查 |
| | ApiInterface/WordChangeZip·WordChangeZipOLD·apiInterface/AjaxWordChange | exe@13240636 / @13240688 / @13240584 | 文档转换打包（含 OLD 保留路径）|
| | ApiWebsite/Feedback | exe@13240828 | 反馈 |
| | ApiWebsite/UploadQiNiuYun | `Asset\dist\view-dy-interaction\js\AjaxPrivate.js:163` | 七牛直传（前端）|
| **action.17van.com**（4）| action/collection | `Asset\dist\view-dy-analysis\js\request.js:97~98`（源码注释「数据投递」）| 埋点上报 |
| | action/deliver / deliver-ai / deliver-solve | `view-smart-clip\js\request.js:43` / `view-ai-writing\js\request.js:37`（注释「数据投递」）/ exe@13403444 | 数据投递三变体（deliver-solve 紧邻 VIP 状态字符串 is_team/vip_type/vip_expire，@13403300 附近）|
| **www.17van.com**（3）| ajaxBuy/AjaxActivity | exe@13863684 | 购买活动（exe 注册表）|
| | ApiWeChat/GetWeChatQrCodeUrl / BindGetWeChatQrCodeUrl | exe@13862812 / `Asset\dist\view-dy-interaction\js\AjaxIndex.js:56` | 微信扫码（登录/绑定）二维码 |
| **api.17van.com**（1）| other/getOriCheck | exe@13256247 | 原创检测（getOriCheck 字面；URL三分类 other 里的 `120.35.10.209:10099/Keyword/checkoriginal` 为同功能直连 IP 后端）|
| **download / static / static2 / toolsdownload** | 见 §1 域划分 | exe 与 Asset | 纯资源域（字体、插件 zip、表情包、模板图、UI 图、PDF）|

---

## 7. 复现

```bash
node 02-analysis-scripts/extract-17van-api-surface.cjs
# → 04-rea-evidence/17van-API面扫描.json（498 端点全量调用点 + ±200 字符上下文）
```

脚本四路扫描：起点清单（URL三分类 own）→ 注入JS片段.json 全量 urls → Asset 316 个 .js/.html（字面 URL + baseUrl 模式 + 行级定位，含路径边界防前缀误吃）→ exe latin1 printable-runs。不联网、不执行。

---

## 8. 未闭合

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | `/key/map` 语义 | **未证**：全静态证据仅 1 处裸 URL；「密钥分发」停留在假设。需运行时抓包/断点 |
| 2 | `/danger/*` 触发方与时机 | **未证**：原生侧持有、前端 0 引用；check+主操作对仅是命名惯例类比。需运行时观察 |
| 3 | `UserExtend/deductCreate` 服务端记账与价格表 | 未证（客户端只见请求/响应形状与重试语义）|
| 4 | `dmx/AbnormalToken`（字符额度）费率与「4 购买字符」点率 | 未证（只有端点与注释）|
| 5 | `/pc/getUrlConfig`、`/pc/getStreamerInfo` 的载荷语义 | 未证（exe 注册表内无参数伴随）|
| 6 | `PcDouyinLetter/getWs` 返回的 WebSocket 地址结构 | 未证（只看到调用形态 `AjaxPrivate.js:122`）|
| 7 | exe 注册表区首 4 个 GUID 常量（@13859800~@13859960）的用途 | 未证 |
| 8 | interface.17van.com 是否还有 exe 未持有的原生端点（URL 拼接构造形态） | 未知（printable-runs 只见完整 URL 常量）|

> 全部为静态证据；未运行、未联网、未请求任何端点。
