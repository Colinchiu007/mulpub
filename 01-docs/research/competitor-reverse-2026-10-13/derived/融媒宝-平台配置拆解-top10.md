# 融媒宝「平台配置」top 10 平台拆解

> **文档性质**：纯静态读文件。数据面 = data.zip 解包副本 + 安装目录前端 dist JS + 既有 exe 静态扫描 JSON。不联网、不执行、不反编译。
> **取证日期**：2026-10-19
> **脚本**：`02-analysis-scripts/extract-platform-profiles.cjs`（可重跑）
> **机器可读**：`03-structured-data/platform-profiles.json`
> **路径约定**：`<REA_WORKSPACE>` = 本仓工作区根；`<安装目录>` = 竞品安装根目录（其下 `data\` 已解包为 `<REA_WORKSPACE>\03-structured-data\platform-data\`，其下 `Asset\dist\` 为前端视图 JS）。

---

## 1. 数据组织方式：这套配置数据是什么

`platform-data` 是从竞品安装目录 `data.zip`（780,196 字节）解出的 133 个文件（来源：`_extract-manifest.json`），入库时已统一转 UTF-8（78 个原 GBK 文件逐字转码，字节级校验失效，来源：`platform-data/README.md`）。内容分五类：

| 类别 | 文件形态 | 语义 |
| --- | --- | --- |
| 分类映射 | `<平台名>[video]categortmap.txt` / `<平台名>[video]subcategort.txt` | 发布表单的**分类/类目树**；`categortmap` 带 ID，`subcategort` 是纯名字镜像（来源：`_taxonomy-summary-v2.json`，全库 31 平台 / 11,623 节点 / 至少 6 种 JSON 形态） |
| 指标矩阵 | `mediadatamgr.ini` | **平台 ID → 支持哪些数据指标**的二维矩阵（`[1]` 数据总览 11 种指标、`[2]` 作品/账号维度 7 种指标），头部注释即指标编号表（来源：`mediadatamgr.ini` 行 1-2、67） |
| 看板 URL | `media_url_list.txt` | `#EMEDIATYPE_*` 注释 + `[平台ID]` 段 + `data/income/comment/msg/monitor_url` 五类页面 URL（来源：`media_url_list.txt`） |
| 采集注入 | `comment_media_js.json` | 平台 ID → `BeforeResourceLoad`/`LoadEnd` 命中 URL + 注入 JS（DOM 隐藏/布局重置类，**仅规则骨架**）（来源：`comment_media_js.json`、`platform-data/README.md`） |
| 爆文/热榜/活动 | `explosivearticle/` `explosivevideo/` `mediahot/` `mediaactivity/` + `media_class_set*.txt` | 爆文选题库类目（17 平台）、热榜频道、活动分类、登录页 DOM 类名指纹（来源：`platform-data/README.md`） |

### 1.1 平台数字 ID：三处独立来源交叉一致

| 平台 | mediaTypeId | 来源 ① | 来源 ② | 来源 ③（前端 view 注释） |
| --- | --- | --- | --- | --- |
| 抖音 | 36 | `media_url_list.txt` `#EMEDIATYPE_DOUYIN` | `comment_media_js.json` 键 `"36"` | `<安装目录>\Asset\dist\view-work-analysis\js\base.js` `id:"36"`、`client.js` 注释「36、抖音」 |
| 快手 | 35 | `#EMEDIATYPE_KUAISHOU` | `"35"` | `base.js id:"35"`、`client.js`「35、快手」 |
| 小红书 | 51（主站）/ 83（专业号） | `#EMEDIATYPE_XIAOHONGSHU` | `"51"`/`"83"` | `base.js id:"51"`（内部名「红薯」）、`client.js`「51、红薯」 |
| 头条号 | 3 | `#EMEDIATYPE_TOUTIAO` | `"3"` | `base.js id:"3"`、`client.js`「3、头条号」 |
| 哔哩哔哩 | 23 | `#EMEDIATYPE_BILIBILI` | `"23"` | `base.js id:"23"`、`client.js`「23、哔哩哔哩」 |
| 微博 | 10 | `#EMEDIATYPE_WEIBO` | `"10"` | — |
| 知乎 | 12 | `#EMEDIATYPE_ZHIHU` | `"12"` | — |
| 腾讯系 | 6（企鹅号）/ 21（腾讯视频） | `#EMEDIATYPE_QIE` / `#EMEDIATYPE_TENGXUNSHIPIN` | — | — |
| 百家号 | 4 | `#EMEDIATYPE_BAIJIA` | `"4"` | `base.js id:"4"`、`client.js`「4、百家号」 |
| 西瓜视频 | 32 | `#EMEDIATYPE_XIGUA` | `"32"` | — |

来源：`media_url_list.txt`、`comment_media_js.json`、`<安装目录>\Asset\dist\view-work-analysis\js\{client.js, base.js}`。注意 `client.js` 注释「参数1：平台 36、抖音 35、快手 51、红薯 53、微信视频号 23、哔哩哔哩 3、头条号 4、百家号」的**标点把平台与编号错位了**（53 跟着「红薯」、3 跟着「哔哩哔哩」），以 `base.js` 的 `platformTabs` 数组为准（`{id:"36",name:"抖音"}` 等）——同一映射在 `mediadatamgr.ini` 的中文注释行（「#抖音 36=…」）再次确认。

---

## 2. 抖音（douyin，id=36）

**配置文件清单**（来源：`_extract-manifest.json`）：

| 文件 | 类别 | 规模 |
| --- | --- | --- |
| `douyincategortmap.txt` | 分类树（扁平） | 27 节点，`{code,text}` 键（全库唯一不用 `id` 的 map 形态） |
| `douyinvideocategortmap.txt` | 视频分类树 | 245 节点 2 层，`{id,name,child}`，id 形如 601/60101 |
| `douyinvideosubcategort.txt` | 视频分类名字镜像 | 245 节点，键即名 |
| `explosivevideo/douyin.txt` | 爆文类目 | 仅 `[{"id":"0","name":"全部"}]` 1 项 |
| `comment_media_js.json#"36"` | 采集注入规则 | 2 BeforeResourceLoad + 2 LoadEnd + 1 JS |

**关键字段**：视频分类一级 36 个（剧情/明星/综艺/…），二级 209 个（来源：`douyinvideocategortmap.txt`，节点数与 `_taxonomy-summary-v2.json` douyin 条目一致）。`douyincategortmap.txt` 的 27 个 `{code,text}`（117 动植物/110 剧情/…）用途**未证**——推测是图文/垂直领域分类，无直接调用点证据。

**发布参数（数据看板）**：id36 段仅 `comment_url`（creator.douyin.com/creator-micro/interactive/comment）、`msg_url`（…/data/following/chat）、`monitor_url`（www.douyin.com/user/self?…showTab=like）；`data_url`/`income_url` 为空（来源：`media_url_list.txt` [36]）。指标：总览 `1,2,6,7,8,9,10,11`（收益+粉丝+互动+涨粉，无图文阅读、无总播放）；作品/账号维度 `1,3,4,5,6,7`（来源：`mediadatamgr.ini` 行 47-48、108-109）。姊妹条目 **[85] 抖音代运营**：comment/msg 走 `creator.douyin.com/following/*`，指标与 36 相同（来源：`media_url_list.txt` [85]、`mediadatamgr.ini` 行 66、`comment_media_js.json` 键 "85"）。

**防爬/签名相关配置**——10 平台中证据密度最高：

- 桥 ×3：`JsDouyinGetABogus`（`var abogus=getABogus(_url,_postdata,_useragent)`）、`JsDouyinGetXBogus`（`getXBogus(...)`）、`JsDouyinGetRegSign`（ticketGuard，5 处调用）（来源：`04-rea-evidence/WEMedia.exe.注入JS片段.json` bridges 表）。
- ticketGuard 全链：从页面 `localStorage` 读 `security-sdk/s_sdk_crypt_sdk` 与 `security-sdk/s_sdk_sign_data_key/web_protect|token` 取密钥，经 `window.ZTSDK.SecureSDK.cryptoSDK.cryptoSDK.signWithHmac` 算 `reg_sign`，注入入口名 `get_douyin_bd_ticket_guard_client_data`（来源：`注入JS片段.json` 签名-抖音-ticketGuard 类目 @13405408~@13409744；`01-analysis/融媒宝-hxfalcon指令集与URL三分类.md` §1）。
- 采集端：BeforeResourceLoad 命中 `creator.douyin.com/aweme/v1/creator/item/list/` 与 `/aweme/v1/creator/im/user_token/`（来源：`comment_media_js.json`）。
- 登录页 DOM 类名指纹 ×10（`login-card-double-Gtywl8`、`trust-login-switch-button uncheck/check`、`semi-button … eK1Z2Sel` 等），且 exe 会从 `download.17van.com/plugin/media_class_set.txt?_t=` 拉新版（来源：`media_class_set.txt`/`media_class_set_new.txt`；`注入JS片段.json` 其他类目 @13314088）。指纹的具体用途（如判断扫码/信任设备开关状态）**未证**。
- 消息通道：WebSocket 监听 + `JsReportWebSocketMsg('%s','%s',2,event.data)` 回传（来源：`注入JS片段.json` 桥回调-Js @13798914）；提示音 `download.17van.com/plugin/douyin_msg_tip.wav`（@13313984）；私信 100 条接口 `interface.17van.com/PcDouyinLetter/getSubUserAccountMew`（@13863464）。
- RPA 打点：对 `creator.douyin.com` 页面 `img[src*=…douyin_creator…uncheck…]` 的点击脚本（来源：`注入JS片段.json` 其他类目 @13380616）。

**桥对应关系**：`JsDouyinGetABogus` / `JsDouyinGetXBogus` / `JsDouyinGetRegSign` ↔ 类目「签名-抖音-a_bogus / XBogus / ticketGuard」。**桥名与平台一一对应，无需推断**。

---

## 3. 快手（kuaishou，id=35）

**配置文件清单**：`kuaishouvideosubcategort.txt`（分类名字树，305 节点 2 层，无 ID）、`explosivevideo/kuaishou.txt`（仅「全部」1 项）、`comment_media_js.json#"35"`（来源：`_extract-manifest.json`）。**该平台没有带 ID 的分类 map 文件**——发布分类只能按名字匹配（来源：`kuaishouvideosubcategort.txt` 形态；`_taxonomy-summary-v2.json` kuaishou `idKey:null`）。

**关键字段**：一级 38 类（三农/二次元/亲子/健康/…），二级 267 个；「健康」下细到「消费眼科/辅助生殖」粒度（来源：`kuaishouvideosubcategort.txt`）。注意 `kuaichuancategortmap.txt` 是**快传号（360）**而非快手，勿混淆（来源：`media_url_list.txt` [19] `#EMEDIATYPE_KUAICHUAN`）。

**发布参数（数据看板）**：id35 段仅 `comment_url`/`msg_url`（均 `cp.kuaishou.com/article/comment`）（来源：`media_url_list.txt` [35]）。指标是 10 平台中最少的：总览 `6,7,8,9,10,11`——**没有任何收益类（1/2）、阅读类（3/4）、总播放（5）指标**，只有互动+粉丝；作品/账号维度 `3,4,5,6,7`（来源：`mediadatamgr.ini` 行 45-46、106-107）。

**防爬/签名相关配置**——技术壁垒最深的一个：

- 桥 ×1：`JsKuaishouGetSig3`，注入体 `var sig3=gen__NS_sig3(sig3_data);window.JsKuaishouGetSig3(_account_id,sig3);`（来源：`注入JS片段.json` 签名-快手-sig3 @13408512）。
- `sig3_data` 不是页面拼的：原生按 `%s` 占位填入（NUL 占位已实证），注入入口名 `get_kuaishou_sig3_param` 与模板交替存放（来源：`01-analysis/融媒宝-hxfalcon指令集与URL三分类.md` §1，@13408464）。
- `$encode` 算法本体在 **hxfalcon VM 字节码**里：78 条 opcode、13.8 KB、位于 `chuangzuozhe.js` module 7606，协程驱动异步签名（来源：同上 §2；机器可读 `04-rea-evidence/hxfalcon-opcode表.json`）。
- 采集端 BeforeResourceLoad 命中 `cp.kuaishou.com/rest/cp/creator/comment/home` 与 `/rest/v2/creator/pc/authority/account/current`（来源：`comment_media_js.json`）。

**桥对应关系**：`JsKuaishouGetSig3` ↔ 「签名-快手-sig3」，一一对应。

---

## 4. 小红书（xiaohongshu，id=51 主站 + 83 专业号）

**配置文件清单**：**全库无任何小红书分类树文件**（顶层、爆文、热榜目录均无 xhs 命名文件，来源：`_extract-manifest.json` 全表 + glob）；仅 `comment_media_js.json#"51"/"83"` 两段注入规则（来源：同文件）。**发布笔记时的类目/话题来源在数据目录中缺位，未证**。

**发布参数（数据看板）**：id51 段 comment/msg/monitor 均 `www.xiaohongshu.com/notification`；id83 段均 `pro.xiaohongshu.com/im/multiCustomerService` + `monitor_url=…/enterprise/home`（来源：`media_url_list.txt` [51][83]）。指标（仅 id51 有行）：总览 `4,6,7,8,9,10,11`——**无收益类指标**；作品/账号维度 `3,4,5,6,7`（来源：`mediadatamgr.ini` 行 55-56、114-115）。**id83 无指标行，未证**（专业号的数据面缺失）。

**防爬/签名相关配置**：

- 桥 ×1：`JsXiaohongshuGetX_S`，注入体 `var jsonPostData=JSON.parse(_postdata);var res=window.cssSign(_url,jsonPostData);` → `window.JsXiaohongshuGetX_S(_account_id,res['X-s'],res['X-t'].toString())`（来源：`注入JS片段.json` 签名-小红书-cssSign @13408200、@13408624，桥回调 @13408288）。有「仅取 X-T」的变体模板（来源：`01-analysis/融媒宝-hxfalcon指令集与URL三分类.md` §1，`get_xiaohongshu_x_t_param`）。
- `anti-content` 风控头：exe 字符串区紧邻 `set-cookie` 出现（@13409056），此前 7 平台清单未单列（来源：同上 §1）。
- 注入规则 id51 LoadEnd exactmatch `www.xiaohongshu.com/notification`；id83 LoadEnd `pro.xiaohongshu.com/im/multiCustomerService`（来源：`comment_media_js.json`）。

**桥对应关系**：`JsXiaohongshuGetX_S` ↔ 「桥回调-Js」类目（签名逻辑在 `cssSign`，桥只回传）——**类目名与平台不一一对应，靠桥名匹配**。小红书是唯一「一个平台占两个 mediaTypeId」的案例：51=创作者主站、83=专业号客服端，两套页面、两套注入规则、但指标矩阵只覆盖 51（来源：`media_url_list.txt`、`mediadatamgr.ini`）。

---

## 5. 头条号（toutiao，id=3）

**配置文件清单**——10 平台中**文件最多（8 个）**：`toutiaovideosubcategort.txt`（视频分类 25 节点，值全 null，即一级无二级）、`explosivearticle/toutiao.txt`（**53 项，全库最大爆文类目**）、`explosivevideo/toutiao.txt`（48 项）、`mediahot/toutiaocat.txt` + `toutiaovideocat.txt`（热榜频道 19/17 项，**带真实频道 ID**：0=实时热点、35=历史、12=娱乐…）、`mediaactivity/toutiaocat.txt` + `toutiaovideocat.txt`（活动分类 31/9 项，id=name 无独立编号）（来源：各文件；`mediahot/toutiaocat.txt`）。**发布文章的分类树无独立文件，未证**（文章类目可能复用爆文类目 53 项，无调用点证据）。

**发布参数（数据看板）**：id3 段 **5 类 URL 全配**（data/income/comment/msg/monitor，全在 `mp.toutiao.com/profile_v4/*` 下）——与百家号并列唯一全配平台（来源：`media_url_list.txt` [3]）。指标：总览 `1,2,3,4,5,6,7,8,9,11`（10/11 项，缺昨日分享）；作品/账号维度 `1,2,3,4,5,7`——**唯一有「推荐」指标（2）的平台**（来源：`mediadatamgr.ini` 行 7-8、72-73）。

**防爬/签名相关配置**：

- 桥 ×1：`JsToutiaoGetABogus`，注入体与抖音**共用同一个 `getABogus` 模板**：`var abogus=getABogus(_url,_postdata,_useragent);window.JsToutiaoGetABogus(_account_id,abogus);`（来源：`注入JS片段.json` 签名-抖音-a_bogus @13408368——桥名是头条，类目名是抖音，为共享实现的命名残留）。
- exe 内嵌头条系页面跳转：`https://www.toutiao.com/article/`、`/video/`、`/a`（预览跳转）、`https://mp.toutiao.com/mp/agw/creator_center/list/v2`、`/mp/agw/statistic/v2/item/info`、`/profile_v4/analysis/income-overview`、`/xigua/api/data/income-*`（来源：`注入JS片段.json` 其他/urls 类目）。
- 注入规则 BeforeResourceLoad 命中 `mp.toutiao.com/mp/agw/creator_center/user_info`、`/api/msg/tab_list`（来源：`comment_media_js.json`）。

**桥对应关系**：`JsToutiaoGetABogus` ↔ 类目「签名-抖音-a_bogus」。**结论标注**：类目命名不代表平台归属，是 `getABogus` 模板共用；头条与抖音同属字节系，签名技术栈同源（共享模板为实证，「同源技术栈」为合理推断）。

---

## 6. 哔哩哔哩（bilibili，id=23）

**配置文件清单**（6 个）：`bilibilicategortmap.txt`（**文章（专栏）分类树** 38 节点：动画/游戏/影视…，`children` 键）、`bilibilisubcategort.txt`（38 名字镜像）、`bilibilivideocategortmap.txt`（视频分类 143 节点：23 一级/120 二级）、`bilibilivideosubcategort.txt`（139 镜像）、`explosivevideo/bilibili.txt`（16 项：番剧/纪录片/鬼畜…）、`comment_media_js.json#"23"`（来源：各文件；「38=文章分类」由 `bilibilicategortmap` 与视频树内容区分得出——树内含「动漫杂谈/单机游戏」等专栏类目）。文章/视频分类是否如上分工**未证**（无调用点区分证据，仅按文件命名与内容推断）。

**发布参数（数据看板）**：id23 段 5 类 URL 全配：data=`member.bilibili.com/v2#/data-up/index`、income=`…#/allowance`、comment=`…/platform/comment/article`、msg/monitor=`message.bilibili.com/#/whisper`（来源：`media_url_list.txt` [23]）。指标：总览 **`1~11` 全 11 项，与百家号并列最全**；作品/账号维度 `1,3,4,5,6,7`（来源：`mediadatamgr.ini` 行 39-40、100-101）。exe 内嵌收益 API：`api.bilibili.com/studio/growup/web/up/wallet/summary`、`member.bilibili.com/platform/allowance/{excitation,charge,mutual_up,pick_up}`（来源：`注入JS片段.json` urls）。

**防爬/签名相关配置**：注入规则 BeforeResourceLoad exactmatch `api.bilibili.com/x/web-interface/nav`（登录态探测 API），LoadEnd 两页 + 2 段 DOM 隐藏 JS（`cc-header`/`internationalHeader`）（来源：`comment_media_js.json`）。**8 桥中无 `JsBilibili*`**（来源：`注入JS片段.json` bridges 表）→ 该平台发布是否有签名需求**未证**。

**桥对应关系**：无专属桥（静态扫描范围内）。数据面用 `api.bilibili.com/x/web-interface/nav` 做 exactmatch 探测，是 10 平台中唯一以**平台官方 API** 作为注入触发条件的。

---

## 7. 微博（weibo，id=10）

**配置文件清单**（3 个）：`weibovideocategortmap.txt`（190 节点，`children`，**id 是 16 位长数字串**如 `"4400850324681150"`，且带冗余 `ids` 字段）、`weibovideosubcategort.txt`（191 镜像）、`comment_media_js.json#"10"`（来源：各文件）。无文章分类、无爆文、无热榜（来源：`_extract-manifest.json`）。

**发布参数（数据看板）**：id10 段仅 `comment_url=https://weibo.com/comment/inbox`、`msg_url=https://api.weibo.com/chat#/chat`（来源：`media_url_list.txt` [10]）。指标：总览 `1,2,4,6,7`（仅收益+粉丝，无播放无互动）；作品/账号维度 `1,3`（来源：`mediadatamgr.ini` 行 19-20、84-85）。

**防爬/签名相关配置**：注入规则仅 LoadEnd 一页 + 2 段 JS，第二段是 `setTimeout(...,100)` 的**延迟二次隐藏**（`Main_side_i7Vti`）——对 SPA 晚渲染的适配（来源：`comment_media_js.json`）。**8 桥中无 `JsWeibo*`** → 签名需求**未证**。

**桥对应关系**：无专属桥。微博分类 ID 的 16 位形态与其它平台完全不同（雪花 ID 风格），提交发布表单时该 ID 如何传递**未证**。

---

## 8. 知乎（zhihu，id=12）

**配置文件清单**（3 个）：`zhihuvideocategortmap.txt`（33 节点**扁平**，id 形如 1000021，**原文件为 UTF-8**——全库少数非 GBK 的 map 文件）、`zhihuvideosubcategort.txt`（102 节点名字树：18 一级/84 二级）、`comment_media_js.json#"12"`（来源：各文件；编码事实见 `_taxonomy-summary-v2.json` files[].enc）。无文章分类（知乎发文章场景缺类目树）、无爆文（来源：`_extract-manifest.json`）。

**发布参数（数据看板）**：id12 段仅 `comment_url=https://www.zhihu.com/creator/manage/comment/answer`、`msg_url=https://www.zhihu.com/messages`（来源：`media_url_list.txt` [12]）。指标：总览 `1,2,3,4,5,6,7`（全但无互动细分）；作品/账号维度 `1,3`（来源：`mediadatamgr.ini` 行 23-24、88-89）。exe 内嵌收益 API：`zhihu.com/api/v4/creators/benefit/{income,daily,content}_statistics`、`zvideo_user_status`（来源：`注入JS片段.json` urls）。

**防爬/签名相关配置**：注入规则 BeforeResourceLoad exactmatch `https://www.zhihu.com/api/v4/me`（登录态 API），LoadEnd 两页 **exactmatch** + 2 段 JS（`Sticky AppHeader css-1x8hcdw`——类名带 hash，页面升级即失效的典型脆弱指纹）（来源：`comment_media_js.json`）。**8 桥中无 `JsZhihu*`** → 签名需求**未证**。

**桥对应关系**：无专属桥。

---

## 9. 腾讯系（tencent，id=6 企鹅号 + 21 腾讯视频）

**配置文件清单**（6 个）：`tencentvideocategortmap.txt`（155 节点，`child` 键，id 形如 "8335388"）、`tencentvideosubcategort.txt`（155 镜像）、`mediahot/qiecat.txt` + `qievideocat.txt`（热榜 19/19 项，频道 ID 10001~10044）、`mediaactivity/qiecat.txt` + `qievideocat.txt`（活动 21/21 项，id=name）（来源：各文件）。**企鹅号（id=6）本身无分类树文件**——`tencentvideocategortmap` 按命名归属腾讯视频（id=21），企鹅号发文章的分类来源**未证**。数据集内另有 `qqkandiansubcategortmap.txt`（52 频道，`channel_id` 键）等看点系文件，属 qqkandian/qqkantiao 独立 slug，不在 top10 范围（来源：`_taxonomy-summary-v2.json`）。

**发布参数（数据看板）**：id6 段 data/income/comment 全配（`om.qq.com/main/statistic/video`、`/main/income/incomeStatistic`、`/main/interactive/comment`）；id21 段仅 `comment_url=https://mp.v.qq.com/1/interact`（来源：`media_url_list.txt` [6][21]）。指标：id6 总览 `1,3,4,5,6,7`、id21 总览 `1,6,7`；作品/账号维度均为 `1,3`（来源：`mediadatamgr.ini` 行 13-14、35-36、78-79、98-99）。

**防爬/签名相关配置**：**`comment_media_js.json` 无 id=6/21 段**（采集注入规则缺位，来源：`comment_media_js.json` 全表）；**8 桥中无 `JsQie*/JsTencent*/JsWeishi*`** → 签名需求**未证**。exe 内嵌页面：`om.qq.com/income/adSettle`、`cc.v.qq.com/index`、`xui.ptlogin2.qq.com/cgi-bin/xlogin`（QQ 登录组件，来源：`注入JS片段.json` 其他/urls）。

**桥对应关系**：无专属桥（静态扫描范围内）。企鹅号在热榜/活动两个功能目录里有专属文件（`qie*` 前缀），但注入与桥两层均缺——是 10 平台中「数据目录覆盖」与「运行时注入覆盖」落差最大者。

---

## 10. 百家号（baijia，id=4）

**配置文件清单**（5 个）：`baijiavideocategortmap.txt`（**438 节点 3 层**——视频分类树规模第一，`child` 键，**id 直接用中文名**）、`baijiavideosubcategort.txt`（438 镜像）、`explosivearticle/baijia.txt`（45 项）、`explosivevideo/baijia.txt`（38 项）、`comment_media_js.json#"4"`（来源：各文件）。**无 `baijiacategortmap.txt` 文章分类树**——文章类目候选源只有爆文 45 项，是否兼作发布分类**未证**。

**发布参数（数据看板）**：id4 段 5 类 URL 全配（`baijiahao.baidu.com/builder/rc/analysiscontent`、`/market/base`、`/commentmanage/comment/all`、`/fans` ×2）（来源：`media_url_list.txt` [4]）。指标：总览 **`1~11` 全 11 项**（与 bilibili 并列最全）；作品/账号维度 `1,3,4,5,6,7`（来源：`mediadatamgr.ini` 行 9-10、74-75）。

**防爬/签名相关配置**：注入规则 LoadEnd 两页（commentmanage/fans）+ 1 段 JS（`client_layouts_header` 等）。**8 桥中无 `JsBaijia*`** → 签名需求**未证**。exe 内嵌的是**页面级操作**而非 API 签名：编辑跳转 `baijiahao.baidu.com/builder/rc/edit?article_id=<id>`（@13287277）、预览 `builder/preview/s?id=`（@13327160）——即百家号发布走的是官方编辑页托管，而非自绘表单直提（来源：`注入JS片段.json` 其他类目）。

**桥对应关系**：无专属桥（静态扫描范围内）。「无签名桥 + 页面托管」是自洽的组合，但百家号登录侧的滑动验证如何处理**未证**。

---

## 11. 西瓜视频（xigua，id=32）

**配置文件清单**（2 个）：`explosivevideo/xigua.txt`（22 项类目）、`comment_media_js.json#"32"`（来源：各文件）。**无分类树文件**——发布视频时的分类来源**未证**（爆文 22 项是唯一类目形态数据）。

**发布参数（数据看板）**：id32 段仅 `comment_url`/`msg_url`（均 `studio.ixigua.com/comment`）（来源：`media_url_list.txt` [32]）。指标：总览 `1,2,5,6,7,8,9,10,11`（9 项，无图文阅读 3/4——纯视频平台口径）；作品/账号维度 **`1~7` 全 7 项**（来源：`mediadatamgr.ini` 行 43-44、104-105）。exe 内嵌页面与 API：`studio.ixigua.com/income`、`/upload?gid=`、`/api/income/total`、`/api/home/last_video`，及头条侧 `mp.toutiao.com/xigua/api/data/income-*`（西瓜收益挂头条号体系，来源：`注入JS片段.json` urls）。

**防爬/签名相关配置**：注入规则 LoadEnd 一页 + 1 段 JS（`m-header`/`m-menu`）。**8 桥中无 `JsXigua*/JsIxigua*`** → 签名需求**未证**。西瓜与头条共用 `mp.toutiao.com` 后台 URL 群，发布签名很可能复用头条通道——**推断，未证**。

**桥对应关系**：无专属桥（静态扫描范围内）。

---

## 12. 横向对照表

「配置条数」= 该平台在 `platform-data` 中可归属的配置文件数（分类树 + 爆文 + 热榜/活动 + 注入规则段，机器可读版为 `platform-profiles.json` 的 `files` 数组长度）。

| 平台 | mediaTypeId | 配置条数 | 分类节点（树/镜像） | 签名桥 | 特殊风控字段 | 数据目录归属（顶层/爆文/热榜/活动/注入） | 未证 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 抖音 | 36（姊妹 85 代运营） | 5 | 27+245/245 | **3 个**（a_bogus/XBogus/ticketGuard） | **有**：ticketGuard+localStorage 密钥链、登录 DOM 指纹×10、WebSocket 回传、RPA 打点 | 顶层 3 / 爆文V 1 / 注入 1 | 0 |
| 快手 | 35 | 3 | —/305 | **1 个**（sig3） | **有**：sig3 + hxfalcon VM 字节码（78 opcode）+ 原生 `%s` 填 sig3_data | 顶层 1 / 爆文V 1 / 注入 1 | 0 |
| 小红书 | 51 + 83 | 2 | —（无分类树） | 1 个（cssSign→X-s/X-t） | **有**：cssSign、anti-content 头 | 注入 2（51/83 双段） | 1 |
| 头条号 | 3 | **8** | —/25（视频） | 1 个（a_bogus，与抖音共用模板） | 有：a_bogus（共享实现） | 顶层 1 / 爆文A+V 2 / 热榜 2 / 活动 2 / 注入 1 | 1 |
| 哔哩哔哩 | 23 | 6 | 38+143/38+139 | 无 | 无（官方 nav API exactmatch 探测） | 顶层 4 / 爆文V 1 / 注入 1 | 1 |
| 微博 | 10 | 3 | —/190 | 无 | 无 | 顶层 2 / 注入 1 | 1 |
| 知乎 | 12 | 3 | —/33+102 | 无 | 无（`/api/v4/me` exactmatch） | 顶层 2 / 注入 1 | 1 |
| 腾讯系 | 6 + 21 | 6 | —/155（视频） | 无 | 无（QQ 登录组件 xui.ptlogin2） | 顶层 2 / 热榜 2 / 活动 2 / 注入 0 | 2 |
| 百家号 | 4 | 5 | —/438（视频，3 层） | 无 | 无（官方编辑页托管） | 顶层 2 / 爆文A+V 2 / 注入 1 | 1 |
| 西瓜视频 | 32 | 2 | —（无分类树） | 无 | 无（收益挂头条 mp.toutiao.com） | 爆文V 1 / 注入 1 | 1 |

**对照表最有洞察的一行——快手**：它的**配置密度几乎垫底**（总览指标 6/11 项，全库唯一没有收益类、阅读类、总播放指标的平台；爆文类目只有「全部」一项；分类树还是全库少数无 ID 形态），但它是唯一被装配了**整套 VM 字节码签名**（hxfalcon 78 opcode + 原生填 `sig3_data`）的平台。配置面的简陋与技术面的深壁垒并存，说明竞品对快手的投入全部押在「能发出去」而不是「数据好看」上——反过来说，**签名桥的有无与配置文件的多少完全正交**，评估竞品平台能力时不能只数配置文件。

次高洞察：**头条号的 `JsToutiaoGetABogus` 与抖音共用同一个 `getABogus` 模板**（桥名是头条、类目名是抖音），加上西瓜收益 API 全部挂在 `mp.toutiao.com` 下——字节系四平台（抖音/头条/西瓜/火山）在竞品内部是「一套签名基建、多个平台外壳」。

---

## 13. 未证清单汇总

机器可读版（`03-structured-data/platform-profiles.json`）各平台 `unproven` 数组合计 **9 条**（小红书 1、头条 1、bilibili 1、微博 1、知乎 1、腾讯系 2、百家号 1、西瓜 1；抖音/快手为 0）。本文档读文件时另发现 11 处缺口，汇总为下列 14 项：其中第 11~13 项以聚合形态对应 JSON 的 8 条（第 12 项聚合 6 个平台的「无专属桥」条目），JSON 剩余 1 条（头条 a_bogus 类目命名说明）已在 §5 单独标注不重复计数：

1. `douyincategortmap.txt`（27 节点 `{code,text}`）的用途（图文/垂直领域分类？）无调用点证据。
2. 头条号发布**文章**的分类树无独立文件（53 项爆文类目是否兼作发布分类）。
3. 小红书发布笔记的类目/话题来源在数据目录中完全缺位。
4. `media_class_set.txt` 登录页指纹的具体用途（判断扫码/信任设备状态？）。
5. bilibili 的 38 节点树=文章分类、143 节点树=视频分类，为文件命名+内容推断，无调用点区分。
6. 微博 16 位分类 ID 在发布表单中的传递方式。
7. 企鹅号（id=6）发文章的分类来源（`tencentvideocategortmap` 按命名归属腾讯视频）。
8. 百家号文章分类：45 项爆文类目是否兼作发布分类。
9. 西瓜发布视频的分类来源（仅 22 项爆文类目）。
10. 西瓜发布签名是否复用头条通道（字节系同源推断）。
11. 小红书 id83（专业号）在 `mediadatamgr.ini` 无指标行——数据面是否支持未证。
12. bilibili/weibo/zhihu/tencent/baijia/xigua 六平台「无专属签名桥」只是 `注入JS片段.json` 静态扫描范围（latin1 ≥25 字符段）内的否定，**不能证明发布无签名需求**。
13. `comment_media_js.json` 无腾讯系 id6/21 段——运行时注入缺位是快照事实，不代表产品无该能力（2026-07-14 冻结快照，来源：`platform-data/README.md`）。
14. 平台侧分类 ID 是否仍有效：数据集为 2026-07-14 冻结快照，本轮未做任何联网校验（来源：`platform-data/README.md` §引用注意 2）。

---

## 14. 结论（3 条）

1. **配置数据的骨架是「平台数字 ID」**：分类树、指标矩阵、看板 URL、注入规则、爆文/热榜五类文件全部以 `mediaTypeId`（1~85 的整数）为主键组织；该 ID 在数据目录内两处（`media_url_list.txt` 注释、`comment_media_js.json` 键）与安装目录前端一处（`base.js platformTabs`）交叉一致，是可靠的对接锚点（来源：§1.1 表）。
2. **签名基建按「字节系 / 快手 / 小红书 / 其他」四档分化**：抖音 3 桥 + 快手 VM 字节码 + 小红书 cssSign 构成第一梯队；头条借字节系模板；其余六平台在静态扫描范围内无专属桥（是否真无签名未证，见未证 12）。做同类产品时，签名桥清单就是「平台接入难度」的代理指标（来源：§2~§11 各平台桥对应段、`注入JS片段.json` bridges 表）。
3. **配置密度与技术门槛正交**：配置文件最多的是头条号（8 个），签名桥最多的是抖音（3 个），分类树最大的是百家号视频（438 节点 3 层），指标最全的是百家号/哔哩哔哩（11/11），而技术壁垒最深的快手四项全都不是——**四张「最」榜的首位互不重叠**（来源：§12 对照表）。
