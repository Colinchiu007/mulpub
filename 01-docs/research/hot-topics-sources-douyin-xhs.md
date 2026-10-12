# 调研：抖音 / 小红书 热榜数据源

> 目的：为「热门选题多渠道聚合」补齐抖音热榜与小红书热榜/热门内容两个渠道，核实**可公开抓取的端点**，并给出可直接落地的开源参考实现与 `channels.js` 渠道定义。
>
> **实测环境（本文件所有「实测」结论的取证条件）**
> - 时间：2026-10-12 07:50–08:15（Asia/Shanghai）
> - 客户端：本机 curl（Windows），**未携带任何 Cookie / 登录态 / 代理 / 账号**
> - 出口：本机默认公网出口（中国大陆）
> - 方法：直接构造 HTTP 请求并解析 JSON 响应体；对「是否需要某个头部」用**逐项隔离实验**（只加一个头部再测）判定
> - GitHub 元数据：`api.github.com`（首方）+ `img.shields.io`（首方派生的 star/最后提交/许可证）+ `raw.githubusercontent.com` 读源码
> - 本文每条结论后标注证据来源 URL；凡未能证实的一律写「**未核实**」，不做推断性断言
>
> **一句话结论**
> - 抖音热榜：**可以直接复用**，公开可抓、无需 a_bogus/X-Bogus/msToken，本项目 `channels.js` 的 `parseDouyin` 已匹配现网字段。
> - 小红书：**没有免登录的公开 Web 热榜接口**，但存在一个**免登录的 App 端热搜接口**（`edith.xiaohongshu.com/api/sns/v1/search/hot_list`），实测 200 返回 20 条，代价是需要一组**硬编码的 App 指纹头部（`shield` 等）**。

---

## 抖音

### 结论

1. **抖音热榜（热搜榜）公开可抓，且不需要签名。** 实测 `https://www.douyin.com/aweme/v1/web/hot/search/list/` 返回 HTTP 200 与 46 条 `data.word_list[]`，全程未携带 a_bogus / X-Bogus / msToken / Cookie。
2. **门槛不是签名，而是「浏览器 User-Agent + douyin.com 的 Referer」。** 逐项隔离实验显示：只给 Referer 或只给浏览器 UA 时 `word_list` 为**空数组**（HTTP 仍 200），两者同时具备才返回 46 条。→ 失败形态是「200 + 空列表」，**不是** 4xx，所以解析器必须把空列表当失败处理（现有 `parseDouyin` 返回 `[]`，会被 service 层当作 0 条，需显式判空并切兜底）。
3. **还有一个「零头部」的移动端端点**：`https://aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880`，用 curl 默认 UA、不带任何头部即返回 `status_code:0` + 46 条，还额外带 `trending_list`（5 条上升热点）与 `recommend_list`。这是最省事的兜底。
4. **`board_type` 参数不产生子榜**：`board_type=0..3` 返回同一份榜单（47/46/46/46 条），`4..8` 返回 0 条。不要指望用这个参数拿「社会榜 / 娱乐榜」。
5. **签名只在「热搜词详情 / 相关视频 / 搜索」接口上需要**，热榜本身不需要。`MediaCrawler` 的抖音客户端为 `/aweme/v1/web/*` 详情与搜索接口生成 `a_bogus`（JS 计算、Playwright 注入）、`msToken`、`webid`、`verifyFp`（必须取自 Cookie 的 `s_v_web_id`）；其源码注释写明「当前网关尚未校验该头的值，可传任意字符串；将来若开始真校验，会重新出现 "Signature Not Found"」。→ 结论：**今天不需要，但这是平台侧可随时收紧的口子**，渠道定义必须预留熔断。
6. `https://www.douyin.com/aweme/v1/web/billboard/list/`、`.../web/hot/search/detail/`、`.../web/hot/word/` 实测均为 **404 `Unsupported path(Janus)`**——不存在，不要写进代码。

### 可用端点表

| 端点 | 方法 | 头部 | 响应字段路径 | 是否需要签名/登录 | 实测/来源 | 稳定性 |
|---|---|---|---|---|---|---|
| `https://www.douyin.com/aweme/v1/web/hot/search/list/` | GET | `User-Agent`（浏览器 UA）+ `Referer: https://www.douyin.com/`（**两者缺一即返回空列表**） | `data.word_list[]`；`data.trending_list[]`（上升热点）；`data.active_time` | **无需签名 / 无需登录** | 实测 2026-10-12：HTTP 200，46 条；[DailyHotApi `src/routes/douyin.ts`](https://github.com/imsyy/DailyHotApi/blob/master/src/routes/douyin.ts)、[newsnow `server/sources/douyin.ts`](https://github.com/ourongxing/newsnow/blob/main/server/sources/douyin.ts)、[SoloMCN `hot-service/channels/douyin.py`](https://github.com/ymybxx/SoloMCN/blob/main/hot-service/channels/douyin.py) | 高（多项目长期在用）；空列表是主要失败形态 |
| `https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1` | GET | 同上（部分实现额外带 `Cookie: passport_csrf_token=...`，取自 `login.douyin.com` / `passport/general/login_guiding_strategy/?aid=6383`） | 同上 | 无需签名 / 无需登录（Cookie 为可选增强） | 实测同上；[DailyHotApi](https://github.com/imsyy/DailyHotApi/blob/master/src/routes/douyin.ts) 取 `passport_csrf_token`，[newsnow](https://github.com/ourongxing/newsnow/blob/main/server/sources/douyin.ts) 取 `login.douyin.com` 的 Set-Cookie | 高 |
| `https://aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880` | GET | **不需要任何头部**（curl 默认 UA 即可） | `data.word_list[]`；`data.trending_list[]`；`data.recommend_list[]`；`status_code`（0=成功） | 无需签名 / 无需登录 | 实测 2026-10-12：HTTP 200，`status_code=0`，46 条；[60s `src/modules/douyin.module.ts`](https://github.com/vikiboss/60s/blob/main/src/modules/douyin.module.ts)、[hot-topics `src/fetchers/douyin.ts`](https://github.com/wimdaw/hot-topics/blob/main/src/fetchers/douyin.ts)（用 `aweme-lq.snssdk.com` / `aweme.snssdk.com` 双 host 兜底） | 中高（作为 web 端点兜底）；无鉴权意味着可被随时加风控 |
| `https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/` | GET | 不需要 | `word_list[]`（仅 `word` / `hot_value` / `label`）；`active_time`；`status_code` | 无需签名 / 无需登录 | 实测 2026-10-12：HTTP 200，50 条，字段最简；[SoloMCN `douyin.py`](https://github.com/ymybxx/SoloMCN/blob/main/hot-service/channels/douyin.py) 与 [`channels/cn.py`](https://github.com/ymybxx/SoloMCN/blob/main/hot-service/channels/cn.py) 均用它兜底 | 中（老端点，字段最少，历史最久） |
| `https://www.douyin.com/aweme/v1/web/billboard/list/` | GET | — | — | — | 实测 **HTTP 404 `Unsupported path(Janus)`** | **不存在，勿用** |
| `https://www.douyin.com/aweme/v1/web/hot/search/detail/?sentence_id=<id>` | GET | — | — | — | 实测 **404 `Unsupported path(Janus)`** | **不存在，勿用** |
| `https://www.douyin.com/aweme/v1/web/hot/word/` | GET | — | — | — | 实测 **404 `Unsupported path(Janus)`** | **不存在，勿用** |
| `https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/hot_video/` | GET | — | `status_code:1` / `status_msg:"Url doesn't match"` | — | 实测 2026-10-12 | **不存在，勿用** |
| `https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/aweme/` | GET | 不需要 | `aweme_list`（实测恒为 `[]`） | 无需登录 | 实测 2026-10-12：HTTP 200 但列表为空 | 存在但无数据，勿用 |

#### 抖音字段语义（以 `data.word_list[]` 为准，均来自 2026-10-12 实测样本）

| 字段 | 类型 | 含义 | 实测观测 |
|---|---|---|---|
| `word` | string | 热搜词正文（榜单条目标题） | 例：`郑钦文首夺中网女单冠军` |
| `hot_value` | number | 热度值（越大越热） | 例：`12126112` |
| `position` | number | 当前排名（1 起） | 与数组序一致；`trending_list` 项**无**此字段 |
| `max_rank` | number | 历史最高排名（1 = 曾登顶） | 例：`1` / `3` |
| `sentence_id` | string | 话题句 id，可拼详情页 `https://www.douyin.com/hot/{sentence_id}` | 例：`2689795` |
| `sentence_tag` | number | 榜单/话题分类标识 | 实测分布：`1001`×3、`1002`×3、`2002`×2、`2006`×4、`2012`×2、`3001`×1、`4003`×4、`5000`×6、`10000`×11、`13000`×2、`17000`×1、`20002`×7 |
| `label` | number | 徽标码；与 `label_url` 文件名一一对应（`.../hotspot_detail_page/{label}.png`），可用于原生分类/角标 | 实测分布：`0`×13、`3`×22、`5`×1、`8`×2、`9`×6、`11`×1、`16`×1（`3` 最常见） |
| `label_url` | string | 徽标图 URL（含 label 码） | — |
| `word_type` | number | 词类型；热搜榜实测**恒为 1** | `1`×46 |
| `video_count` | number | 关联视频数 | 例：`11` |
| `discuss_video_count` | number | 讨论视频数 | 例：`1` |
| `article_detail_count` | number | 关联图文数 | 实测恒 `0` |
| `event_time` | number | 上榜时间（Unix 秒） | 例：`1791686651` |
| `group_id` | string | 话题组 id | 例：`7694588163146781978` |
| `is_n1` | bool | 是否置顶第一（推广位特征） | 实测 `false` |
| `word_cover.url_list[]` | array | 话题封面图候选 URL 列表 | — |
| `hotlist_param` | string(JSON) | 榜单参数（版本号） | `{"version":1}` |
| `display_style` / `room_count` / `can_extend_detail` | number / number / bool | 展示样式、直播间数、是否可展开详情 | 实测 `0` / `0` / `false` |
| `data.trending_list[]` | array | **实时上升热点**（无 `position`、`hot_value` 实测为 `0`） | 实测 5 条，例：`游客自购年卡当民办NPC` |
| `data.active_time` | string | 榜单快照时间 | 实测 `2026-10-12 07:54:43` |

> `data.trending_list` 的语义由 [SoloMCN `douyin.py`](https://github.com/ymybxx/SoloMCN/blob/main/hot-service/channels/douyin.py) 交叉印证：它把 `trending_list` 单独当作 `rising=True` 的条目，并因 `hot_value` 缺失而赋予固定中间分 `RISING_SCORE = 50.0`。

### 参考开源项目（抖音）

| 仓库 | 实现位置 | 逻辑要点 |
|---|---|---|
| [imsyy/DailyHotApi](https://github.com/imsyy/DailyHotApi) | [`src/routes/douyin.ts`](https://github.com/imsyy/DailyHotApi/blob/master/src/routes/douyin.ts) | 先请求 `https://www.douyin.com/passport/general/login_guiding_strategy/?aid=6383` 正则截取 `passport_csrf_token`，再带 `Cookie` 请求热搜；映射 `word→title`、`sentence_id→id`、`hot_value→hot`、`event_time→timestamp`、`url=https://www.douyin.com/hot/{sentence_id}` |
| [ourongxing/newsnow](https://github.com/ourongxing/newsnow) | [`server/sources/douyin.ts`](https://github.com/ourongxing/newsnow/blob/main/server/sources/douyin.ts) | 用 `$fetch.raw("https://login.douyin.com/")` 拿 `set-cookie` 拼 Cookie；同一 web 端点；同样输出 `sentence_id/word/hot_value` |
| [ymybxx/SoloMCN](https://github.com/ymybxx/SoloMCN) | [`hot-service/channels/douyin.py`](https://github.com/ymybxx/SoloMCN/blob/main/hot-service/channels/douyin.py) | 三级策略：web 端点 → `iesdouyin billboard/word` 兜底；同时合并 `word_list` 与 `trending_list`（去重）；用 `position` 作 rank、`max_rank`/`event_time`/`video_count` 作扩展指标；**源码注释明确「不用登录、不用签名」** |
| [vikiboss/60s](https://github.com/vikiboss/60s) | [`src/modules/douyin.module.ts`](https://github.com/vikiboss/60s/blob/main/src/modules/douyin.module.ts) | 走 `aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880`，**不带任何头部**；映射 `word→title`、`hot_value`、`word_cover.url_list[0]→cover`、`link=https://www.douyin.com/search/{word}` |
| [wimdaw/hot-topics](https://github.com/wimdaw/hot-topics) | [`src/fetchers/douyin.ts`](https://github.com/wimdaw/hot-topics/blob/main/src/fetchers/douyin.ts) | `firstOk` 依次尝试 `aweme-lq.snssdk.com` → `aweme.snssdk.com` → web（先从 `login.douyin.com` 取 Cookie）；是「多 host 自动降级」的现成范式 |
| [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | [`media_platform/douyin/client.py`](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/douyin/client.py) | 详情/搜索接口的签名范式：`a_bogus`（JS 计算 + Playwright 注入）、`msToken`、`webid`、`verifyFp`（必须等于 Cookie 的 `s_v_web_id`）。**热榜用不到，但可作为「平台收紧风控」时的影响面参考** |

### 风险（抖音）

| 风险 | 说明 | 证据 |
|---|---|---|
| 静默降级为「200 + 空列表」 | 缺 UA 或缺 Referer 时 HTTP 仍 200，仅 `word_list` 为空。若按「HTTP 200 即成功」判断，会把 0 条当成功并覆盖缓存 | 实测隔离实验（见上文「结论 2」） |
| 平台可随时加签 | 同域 `/aweme/v1/web/*` 的详情与搜索接口已用 `a_bogus` 等；热榜今天免签不等于明天免签 | [MediaCrawler `douyin/client.py`](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/douyin/client.py) 源码注释 |
| 无鉴权端点（snssdk）被限流 | `aweme-lq.snssdk.com` 无任何头部校验，说明对端没有按客户端身份区分，容易被统一限流 | 实测「零头部可用」 |
| `board_type` 造成误判 | 传 `board_type=4..8` 会返回 0 条，容易被误认为「渠道挂了」 | 实测 `board_type` 矩阵 |
| 无官方文档 | 上述全部端点均为社区逆向所得，**没有任何官方文档承诺**；`404 Unsupported path(Janus)` 表明网关层随时会调整路由 | 实测 404 响应体 |

### 复用建议（抖音）

**结论：直接复用。**

- 主渠道：`https://www.douyin.com/aweme/v1/web/hot/search/list/` —— 与项目现有 `CHANNEL_CONFIGS` 中的 `douyin` 一致，`parseDouyin` 已按 `data.word_list[].word / .hot_value` 解析，**现网字段完全匹配，无需改动解析逻辑即可继续用**。
- 建议增强（低成本、高收益）：
  1. `rank` 改用 `item.position`（现为数组序 `i+1`），并像 `parseBaidu` 过滤置顶一样处理 `is_n1 === true`；
  2. 补 `url = https://www.douyin.com/hot/{sentence_id}`（现为 `null`，条目不可点）；
  3. 合并 `data.trending_list`（上升热点）为 `rawCategory: '上升热点'`，扩大选题池；
  4. **显式判空**：`word_list` 为空时抛错或返回特殊标记，使 service 层的熔断器生效，而不是写入 0 条成功结果。
- 兜底链：`douyin_app`（`aweme-lq.snssdk.com`，零头部）→ `douyin_ies`（`iesdouyin .../billboard/word/`）。三级端点相互独立（不同域名、不同鉴权面），比单一端点的可用性高一个量级。参考实现见 [hot-topics `douyin.ts`](https://github.com/wimdaw/hot-topics/blob/main/src/fetchers/douyin.ts) 的 `firstOk` 模式。
- **不要**实现 `billboard/list`、`hot/search/detail`、`hot/word`（不存在），也**不要**实现签名（`a_bogus`）——热榜用不到，且会把渠道复杂度推到 Playwright 级别。

---

## 小红书

### 结论

1. **不存在「免登录的公开 Web 热榜接口」。** 实测未登录访问 `https://www.xiaohongshu.com/explore` 直接 **HTTP 302 → `https://www.xiaohongshu.com/login?redirectPath=...`**，响应体仅 130 字节，**没有 `__INITIAL_STATE__`**、页面中「热点/热榜」关键词命中 0 次。→ 之前社区流传的「`/explore` SSR 免登录可读」在当前时点**已不成立**。
2. **Web 端 `/api/sns/web/v1/*` 需要签名 + 登录态。** `MediaCrawler` 的小红书客户端对每个请求注入 `X-S` / `X-T` / `x-S-Common` 三个签名头（由 `xhshow` 纯算法库按 `uri + data + cookie` 生成），并要求扫码登录后的 Cookie（登录成功判据是 Cookie 中 `web_session` 变化）。其使用的主机为 `https://edith.xiaohongshu.com`（境内）/ `https://webapi.rednote.com`（境外），封装的方法是 `/api/sns/web/v1/search/notes`（关键词搜索）、按 id 取笔记、评论、创作者信息——**其中没有热榜**。
3. **存在一个免登录的 App 端热搜接口**：`https://edith.xiaohongshu.com/api/sns/v1/search/hot_list`（注意前缀是 **`/api/sns/v1/`**，属于 App 侧，不是 Web 侧的 `/api/sns/web/v1/`）。实测 HTTP 200、`code:0`、`success:true`、`data.items` **20 条**，全程**未发送任何 Cookie**。这是目前唯一被实测证实的小红书热榜数据源。
4. **但它需要一组硬编码的 App 指纹头部，其中 `shield` 是硬性门槛。** 逐项隔离实验：只带 UA / 只加 `referer` / 再加 `xy-direction` / 再加 `xy-platform-info` / 再加 `xy-common-params`（**不含 shield**）——全部 **HTTP 406**；只带 `shield` 不带其它 `xy-*` 也是 **406**；**只有完整 5 件套才 200**。`shield` 是一长串看似随机但**静态**的 token，来自某个 iOS 客户端的抓包样本。
5. **第三方聚合的「小红书热点」上游就是第 3 条那个 App 接口**，不是 tophub：
   - [`vikiboss/60s`](https://github.com/vikiboss/60s) 的 [`src/modules/rednote.module.ts`](https://github.com/vikiboss/60s/blob/main/src/modules/rednote.module.ts) 直接把 `https://edith.xiaohongshu.com/api/sns/v1/search/hot_list` 与同一套 `shield` / `xy-*` 常量**硬编码在源码里**；
   - [`wimdaw/hot-topics`](https://github.com/wimdaw/hot-topics) 的 [`src/fetchers/rednote.ts`](https://github.com/wimdaw/hot-topics/blob/main/src/fetchers/rednote.ts) 注释原文即为「**小红书 App 搜索热榜接口, 60s 项目同款请求头 (无需登录签名)**」，URL 与 5 个头与 60s 逐字相同；
   - [`chensn05/hot-radar`](https://github.com/chensn05/hot-radar) 的 [`backend/fetchers.py`](https://github.com/chensn05/hot-radar/blob/main/backend/fetchers.py) 走 `https://60s-api.viki.moe/v2/rednote`（60s 的托管实例），字段取 `title` / `score` / `word_type` / `link`。
   → 三者的**根数据源是同一个**，因此「换一个第三方聚合」并不带来独立可用性。
6. **「tophub 提供小红书热点」在本项目实测中不成立。** 实测 `https://tophub.today/`（21,539B）与节点索引 `https://tophub.today/c/news`（194,295B）中，`小红书` 的出现次数分别为 **2**（一条资讯标题 + 一个指向 xiaohongshu.com 的站外链接）与 **0**，**没有任何 `/n/xxx` 节点链接**指向小红书榜。同类结论：`DailyHotApi` 的 58 个 route 文件里**没有** xiaohongshu；`newsnow` 的 46 个 source 文件里**没有** rednote/xiaohongshu。
7. **创作者服务平台（`creator.xiaohongshu.com`）不可复用。** 实测根路径 200，但本任务猜测的两个数据接口路径分别返回 404 与 401——**这些路径是本次猜测，未在任何开源项目中得到印证，故不作为可用端点**（本文件不采用）。创作者平台的接口普遍需要登录态，属于「必须登录」一类。
8. **60s 托管 API 从本机出口不可用**：`https://60s.viki.moe/v2/rednote`、`https://60s-api.viki.moe/v2/rednote`、`https://60s.viki.moe/v2/douyin` 三次重试全部 **HTTP 429 + Cloudflare `error code: 1027`**（站点根路径同为 429）。→ 第三方托管实例的可用性不由我们控制，只应作为可选增强，不能作为唯一数据源。

### 可用端点表

| 端点 | 方法 | 头部 | 响应字段路径 | 是否需要签名/登录 | 实测/来源 | 稳定性 |
|---|---|---|---|---|---|---|
| `https://edith.xiaohongshu.com/api/sns/v1/search/hot_list` | GET | **5 件套必填**：`User-Agent`（iPhone MicroMessenger UA）、`referer: https://app.xhs.cn/`、`xy-direction: 22`、`shield: XYAAAAAQ…wbwkV`、`xy-platform-info: …`、`xy-common-params: …`（**缺 shield 或缺任一 `xy-*` 即 406**） | `data.items[]` → `title` / `score` / `word_type` / `rank_change` / `type` / `id` / `icon` / `title_img`；`data.title` / `data.hot_list_id` / `data.scene` / `data.host` / `data.is_new_hot_list_exp` / `data.word_request_id` | **需要硬编码 `shield`（等效签名）；不需要登录、不需要 Cookie** | 实测 2026-10-12：HTTP 200，`code:0`，20 条；[60s `rednote.module.ts`](https://github.com/vikiboss/60s/blob/main/src/modules/rednote.module.ts)、[hot-topics `rednote.ts`](https://github.com/wimdaw/hot-topics/blob/main/src/fetchers/rednote.ts) | 中——数据稳定、机制脆弱：`shield` 是静态常量，平台轮换即失效，且没有任何自动续期手段 |
| `https://www.xiaohongshu.com/explore`（原设想：SSR 抓取） | GET | 浏览器 UA | 期望 `__INITIAL_STATE__`（**实测不存在**） | 需要登录 | 实测 **HTTP 302 → `/login?redirectPath=…`**，响应体 130B，`__INITIAL_STATE__` 未命中 | **不可用（已失效）** |
| `https://edith.xiaohongshu.com/api/sns/web/v1/search/notes` | POST | `X-S` / `X-T` / `x-S-Common` 签名头 + 登录 Cookie（`web_session` / `a1`） | `data.items[]`（笔记列表） | **需要签名 + 登录态** | [MediaCrawler `xhs/client.py`](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/xhs/client.py)（`_pre_headers` 注入三头）、[`xhs/login.py`](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/xhs/login.py)（`web_session` 判据） | 可用但成本高（需登录态 + 签名库 + 风控对抗），且**不是热榜** |
| `https://www.xiaohongshu.com/user/profile/{user_id}`（SSR 主页） | GET | 浏览器 UA | HTML 内 `__INITIAL_STATE__` → `user.userPageData.basicInfo` / `user.notes[].noteCard` | 声称免登录（**本次未实测**） | [hot-radar `fetchers.py`](https://github.com/chensn05/hot-radar/blob/main/backend/fetchers.py) 的 `fetch_xhs_profile`；作者在异常分支里注明「可能被风控或需要登录」 | **未核实**（同为 SSR，与 `/explore` 已失效的情况需一并实测后才可依赖） |
| `https://60s.viki.moe/v2/rednote`（第三方托管聚合） | GET | 无需特殊头部 | `{code:200, data:[{rank,title,score,word_type,link,work_type_icon}]}` | 无需登录 | 接口契约来自 [60s `rednote.module.ts`](https://github.com/vikiboss/60s/blob/main/src/modules/rednote.module.ts) 与 [hot-radar](https://github.com/chensn05/hot-radar/blob/main/backend/fetchers.py)；**实测：从本机出口三次重试全部 HTTP 429（Cloudflare 1027）** | 低——限流/封禁由第三方与 CDN 决定；上游仍是上面那个 App 接口 |
| `https://creator.xiaohongshu.com/...`（创作者服务平台） | GET/POST | 登录态 | 未核实 | **必须登录** | 实测根路径 200；本次猜测的两个数据路径返回 404 / 401，**路径未经开源项目印证，不作为可用端点** | **不采用** |

#### 小红书 App 热搜接口字段语义（实测 2026-10-12，20 条样本）

| 字段 | 类型 | 含义 | 实测观测 |
|---|---|---|---|
| `title` | string | 热点词 / 话题标题 | 例：`用万能旅行拍照姿势美美出片` |
| `score` | string | **热度分值，字符串且带 `w` 后缀**（万） | `"947.5w"` / `"934.8w"` / `"886w"` → 需转数值 9475000 / 9348000 / 8860000 |
| `word_type` | string | 词类型标记，**实测仅两值**：`「热」`/`「无」` | `热`×12、`无`×8 |
| `rank_change` | number | 排名变化（0=无变化） | 全为 `0` |
| `type` | string | 条目类型 | 全为 `"normal"` |
| `id` | string | 热点 id（`dora_` 前缀） | 例：`dora_2178732` |
| `icon` | string | 角标图标 URL（`picasso-static.xiaohongshu.com`） | 出现在 `word_type="热"` 的条目上 |
| `title_img` | string | 标题配图（实测为空串） | `""` |
| `data.title` | string | 榜单标题 | **实测为空串** |
| `data.hot_list_id` | string | 榜单快照 id | 例：`6749638` |
| `data.scene` / `data.host` | string | 场景 / 主机 | — |
| `data.is_new_hot_list_exp` | bool | 新版热榜实验开关 | — |
| `data.word_request_id` | string | 请求追踪 id | — |
| `data.result.success` | bool | 子结果 | `true` |

> **注意「无 rank 字段」**：接口**不返回**排名，排名只能按 `items` 数组序生成（`i+1`），这也是 60s 与 hot-topics 的共同做法。数组序在多次请求间是否严格稳定，**本次未做重复采样，未核实**。

### 参考开源项目（小红书）

| 仓库 | 实现位置 | 逻辑要点 | 与本项目的关系 |
|---|---|---|---|
| [vikiboss/60s](https://github.com/vikiboss/60s) | [`src/modules/rednote.module.ts`](https://github.com/vikiboss/60s/blob/main/src/modules/rednote.module.ts) | 硬编码 App 热搜 URL + 5 个头部；映射 `rank=idx+1`、`title`、`score`、`word_type`、`work_type_icon=icon`、`link=https://www.xiaohongshu.com/search_result?keyword={title}&type=51` | **最直接的参考实现**，字段映射可照搬 |
| [wimdaw/hot-topics](https://github.com/wimdaw/hot-topics) | [`src/fetchers/rednote.ts`](https://github.com/wimdaw/hot-topics/blob/main/src/fetchers/rednote.ts) | 同上 URL/头部；显式 `if (!items.length) throw new Error('empty list')`（空列表即失败，正是本项目需要的失败语义） | 提供「空列表=失败」的处理范式 |
| [chensn05/hot-radar](https://github.com/chensn05/hot-radar) | [`backend/fetchers.py`](https://github.com/chensn05/hot-radar/blob/main/backend/fetchers.py) | 不自己请求，改调 60s 托管 API；含 `_parse_cn_number`（`'920.8w' / '1.2万' / '8850'` → int）可复用 | 提供中文数量字符串解析的现成实现 |
| [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | [`media_platform/xhs/client.py`](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/xhs/client.py)、[`xhs_sign.py`](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/xhs/xhs_sign.py)、[`login.py`](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/xhs/login.py) | Web 端全量能力（搜索/笔记/评论/创作者）的签名与登录范式：自定义 Base64 表 + CRC32 的混淆签名算法；`_pre_headers` 注入 `X-S`/`X-T`/`x-S-Common` | **参考（不直接复用）**：登录态 + 风控对抗成本高，且它没有热榜 |
| [cloxl/xhshow](https://github.com/cloxl/xhshow) | PyPI 包 `xhshow`（`XHS API signature generator`，v0.2.0；仓库地址取自 [PyPI 元数据](https://pypi.org/pypi/xhshow/json) 的 `project_urls.Repository`） | 小红书 Web API 纯算法签名器，被 MediaCrawler `requirements.txt` 依赖（`xhshow>=0.2.0`） | 若将来必须走 Web 端 API，这是签名侧的现成依赖（Python 生态，与本项目 Node 栈需跨语言） |
| [JoeanAmier/XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader) | `source/`（作品采集/下载） | 笔记与媒体采集，需从浏览器读取 Cookie；**GPL-3.0** | **不可复用**：目标不同（作品下载而非热榜）+ GPL-3.0 传染性 |
| [ReaJason/xhs](https://github.com/ReaJason/xhs) | PyPI 包 `xhs`（`xiaohongshu crawl sdk`，v0.2.13） | 小红书 Web 端请求封装，MediaCrawler 的「按 id 取笔记」直接标注 copy 自它 | 参考；最后提交 2025-03，活跃度低 |

### 风险（小红书）

| 风险 | 说明 | 证据 |
|---|---|---|
| **`shield` 是静态硬编码常量** | 5 个必需头部里 `shield` 承担等效签名角色，且是抓包得来的固定值。平台轮换 → 全部依赖方（60s、hot-topics、本项目）同时失效，且**没有自动续期手段** | 实测：缺 `shield` 即 406；值来自 [60s 源码](https://github.com/vikiboss/60s/blob/main/src/modules/rednote.module.ts) |
| **单一数据源假象** | 60s / hot-topics / hot-radar 三家的「小红书热点」同源，看起来「多个项目都在用」实则只有一个上游，不构成冗余 | 三方源码 URL 与头部逐字一致 |
| **没有官方文档 / 无 SLA** | App 侧接口无任何公开文档；本次仅证明「此刻可用」 | 实测 + 无官方来源 |
| **无 rank 字段** | 排名只能取数组序，跨请求的序稳定性未核实 | 实测字段集合中无 `position`/`rank` |
| **第三方托管实例不可控** | 60s 托管 API 从本机出口 429（Cloudflare 1027） | 实测三次重试 |
| **合规与账号安全** | App 侧接口使用他人设备的 `deviceId` / `device_fingerprint` / `sid` 常量；`MediaCrawler` 采用**非商用学习许可**、`XHS-Downloader` 为 **GPL-3.0**——直接抄代码有许可与合规风险 | 见下节许可证列 |
| **Web SSR 路线已关** | `/explore` 302 → login，历史上「免登录 SSR 解析」的写法已失效 | 实测 302 |

### 复用建议（小红书）

**结论：有条件「直接复用」——复用端点与字段映射（参考实现），不复用任何代码；并且必须按「易碎渠道」对待。**

- ✅ **可以直接复用**：`https://edith.xiaohongshu.com/api/sns/v1/search/hot_list` + 5 个固定头部 + `data.items[]` 字段映射。理由：实测免登录 200、字段稳定、有 2 个独立开源实现（60s / hot-topics）长期在用。
- ⚠️ **必须配套的工程约束**（否则不建议上线）：
  1. **熔断 + 告警**：本项目 `hot-topics-service.js` 已有 `ChannelBreaker`（连续 N 次失败 → OPEN 冷却 M 分钟），把该渠道纳入即可；另外 406 是「头部失效」的**特征信号**，应与网络错误区分开，单独记日志以便快速定位「该换 shield 了」。
  2. **空列表视为失败**（`items` 为空 → 抛错），避免把失效写进缓存。
  3. **不要把 60s 托管 API 作为唯一来源**：它同源、且从本机出口限流；可作为可选增强，但主链路应直连 App 接口。
  4. **合规**：不复制 `MediaCrawler`（非商用许可）与 `XHS-Downloader`（GPL-3.0）的代码；只按其公开的接口事实自行实现解析。
- ❌ **不可复用**：
  - Web SSR（`/explore`）：已 302 登录，失效。
  - Web API（`/api/sns/web/v1/*`）：需登录态 + `X-S`/`X-T`/`x-S-Common` 签名 + 反爬对抗，投入产出比极低，且它不提供热榜。
  - 创作者服务平台：必须登录，路径未核实。
  - 「tophub / DailyHotApi / newsnow 有小红书榜」这一前提：实测不成立。

---

## 可复用的开源项目清单

> Star / 最后更新 / License 取自 `api.github.com/repos/*` 或 `img.shields.io`（首方派生），取数时间 2026-10-12。Star 数为量级。**未核实**项如实标注，不编造。

### A. 已核实存在且覆盖目标平台

| # | 仓库全名 | Star | 最后更新 | License | 抖音 | 小红书 | 端点与解析实现位置 | 维护活跃度 | 风险 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | [imsyy/DailyHotApi](https://github.com/imsyy/DailyHotApi) | 4.1k（API 精确 4088） | 2026-03-11 | MIT | ✅ | ❌（58 个 route 中无 xiaohongshu） | [`src/routes/douyin.ts`](https://github.com/imsyy/DailyHotApi/blob/master/src/routes/douyin.ts) | 中（2026-03 后无提交） | 无付费依赖；抖音需先取 `passport_csrf_token` |
| 2 | [ourongxing/newsnow](https://github.com/ourongxing/newsnow) | 22k | 2026-09 | MIT | ✅ | ❌（46 个 source 中无） | [`server/sources/douyin.ts`](https://github.com/ourongxing/newsnow/blob/main/server/sources/douyin.ts) | 高 | 无密钥；自带公开托管实例（第三方托管 = 限流风险） |
| 3 | [vikiboss/60s](https://github.com/vikiboss/60s) | 5.8k | 2026-09 | MIT | ✅ | ✅ | [`src/modules/douyin.module.ts`](https://github.com/vikiboss/60s/blob/main/src/modules/douyin.module.ts)、[`src/modules/rednote.module.ts`](https://github.com/vikiboss/60s/blob/main/src/modules/rednote.module.ts) | 高 | 小红书依赖硬编码 `shield`；其托管 API 从本机出口 429 |
| 4 | [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | 67k | 近期（shields 报 "yesterday"） | **NON-COMMERCIAL LEARNING LICENSE 1.1**（源码头部声明；shields 报 "not identifiable by github"） | ✅ | ✅ | [`media_platform/douyin/client.py`](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/douyin/client.py)、[`media_platform/xhs/client.py`](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/xhs/client.py)、[`xhs/xhs_sign.py`](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/xhs/xhs_sign.py) | 高 | **非商用许可**；需登录态 + Playwright 签名；重依赖 |
| 5 | [cloxl/xhshow](https://github.com/cloxl/xhshow) | 1.1k | 2026-06 | MIT | ❌ | ✅（签名库） | [PyPI `xhshow` v0.2.0](https://pypi.org/pypi/xhshow/json)（"XHS API signature generator"） | 中 | 纯签名算法，平台改规则即失效；Python 生态 |
| 6 | [JoeanAmier/XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader) | 13k | 2026-09 | **GPL-3.0** | ❌ | ✅（作品采集，非热榜） | `source/`（需从浏览器读 Cookie） | 高 | **GPL-3.0 传染**；目标不匹配 |
| 7 | [ReaJason/xhs](https://github.com/ReaJason/xhs) | 2.2k | 2025-03 | MIT | ❌ | ✅（Web 封装） | [`xhs/core.py`](https://github.com/ReaJason/xhs/blob/master/xhs/core.py)（MediaCrawler 注明 copy 自此处） | 低（一年多无提交） | 需 Cookie + 签名 |
| 8 | [ymybxx/SoloMCN](https://github.com/ymybxx/SoloMCN) | 50 | 2026-10-10 | MIT | ✅ | ⚠️仅发布侧，热榜未见小红书渠道 | [`hot-service/channels/douyin.py`](https://github.com/ymybxx/SoloMCN/blob/main/hot-service/channels/douyin.py)、[`channels/cn.py`](https://github.com/ymybxx/SoloMCN/blob/main/hot-service/channels/cn.py)、[`channels/hotlist.py`](https://github.com/ymybxx/SoloMCN/blob/main/hot-service/channels/hotlist.py)、[`hub.py`](https://github.com/ymybxx/SoloMCN/blob/main/hot-service/hub.py) | 高（当日仍在提交） | 无付费依赖；`hotlist.py` 说明微博官方接口需登录、走 newsnow 兜底 |
| 9 | [wimdaw/hot-topics](https://github.com/wimdaw/hot-topics) | 0 | 2026-09-14 | NOASSERTION（未识别） | ✅ | ✅ | [`src/fetchers/douyin.ts`](https://github.com/wimdaw/hot-topics/blob/main/src/fetchers/douyin.ts)、[`src/fetchers/rednote.ts`](https://github.com/wimdaw/hot-topics/blob/main/src/fetchers/rednote.ts)（共 31 个 fetcher） | 低（0 star，未经社区检验） | 参考价值高但无社区验证 |
| 10 | [chensn05/hot-radar](https://github.com/chensn05/hot-radar) | 1 | 2026-09-07 | MIT | ✅ | ✅ | [`backend/fetchers.py`](https://github.com/chensn05/hot-radar/blob/main/backend/fetchers.py) | 低 | 抖音/小红书均经第三方 60s 托管 API，**不可控** |
| 11 | [ieliwb/tophub-api](https://github.com/ieliwb/tophub-api) | 33 | 2023-11-30 | 未标注 | ❌ | ❌ | 今日热榜官方 API 使用手册（**文档仓库**） | 停更 | 无代码；且今日热榜本身无小红书榜（实测） |

### B. 常见说法中**不存在**的仓库（实测 `git api`/shields 返回 Not Found）

> 任务清单里点名的这些，逐一核对结果如下。**没有任何一条是本次编造**——全部为 GitHub 首方接口的返回。

| 被点名/流传的仓库 | 核实结果 | 证据 |
|---|---|---|
| `ccbikai/hot-search` | **不存在**（Not Found） | `api.github.com/repos/ccbikai/hot-search` → `{"message":"Not Found"}` |
| `ccbikai/NewsNow` | **不存在**（Not Found） | `api.github.com/repos/ccbikai/NewsNow` → Not Found（同名项目实为 `ourongxing/newsnow`，22k★） |
| `wangyucode/hot-search` | **不存在**（Not Found） | `api.github.com/repos/wangyucode/hot-search` → Not Found |
| `tophub/tophub` | **不存在**（Not Found） | `api.github.com/repos/tophub/tophub` → Not Found。tophub.today 为**闭源商业站点**；其日志采集类同名仓库为 `tlc-pack/tophub`（68★，2022-12 停更，**与热榜无关**） |
| `ruanyf/hot-news` | **不存在**（Not Found） | `api.github.com/repos/ruanyf/hot-news` → Not Found。`ruanyf/weekly` 确实存在（105,835★，2026-10-10）但**是科技周刊，与热榜无关** |
| `ccbikai` 名下是否有热榜项目 | **未核实** | 该用户仓库列表页为 JS 渲染，本次未取到；不做推测 |
| `tophub` 官方 API | **未核实** | 流传的 `api.tophub.fun/v2/GetAllInfoGzip` 实测返回 HTML 跳转页（非 JSON），未能确认契约；tophub.today 节点页 `/n/KqndgxeLl9` 实测 200 可用（但那是微博榜，且**站点无小红书榜**） |

### C. 其他点名的仓库（存在但与「小红书热榜」无关，避免误用）

| 仓库 | 核实结果 | 说明 |
|---|---|---|
| `ruanyf/weekly` | 存在，105,835★，License 空，2026-10-10 | 科技爱好者周刊，**非热榜实现** |
| `justjavac/awesome-wechat-weapp` | API 返回 `Moved Permanently` | 与热榜无关 |
| `seiichieto07/rebang` | 存在，24★，2025-04-17，License 未标注 | **实测其仓库只有 `content/`（81 篇 VPS 推广 md）+ `images/` + README**，**是一个导流/SEO 内容仓库，不是热榜抓取实现**——README 里声称覆盖「小红书热榜」，但无可复用代码，**不要当作实现参考** |
| `Gazer-887/mini-hot` | 存在，0★，2026-09-21，MIT | README 称「纯前端直连」聚合 10 平台含小红书；本次**未定位到其源码文件**，实现细节**未核实** |
| `fang-yj/tophubToday` | 存在，11★，2026-10-11，License 未标注 | 抓取 tophub 搜索词；tophub 无小红书榜 → 不含小红书 |
| `ymybxx/SoloMCN` 中 `hot-service/youtube.py`、`channels/x.py` 等 | 存在 | 非目标平台 |

---

## 给实现的建议

以下 3 个渠道定义**可直接写入** `apps/desktop/electron/services/hot-topics-service.js` 的 `CHANNEL_CONFIGS`，并配套 `apps/desktop/electron/services/hot-topics/channels.js` 的解析器（沿用该文件既有的 `{ channel, rank, topic, hotValue, url, rawCategory }` 统一输出结构）。

### 渠道定义

```js
// ── 抖音（主渠道）：沿用现有 id 'douyin'，避免破坏已有缓存/权重（scorer.js 中 douyin: 1.0）
// 实测 2026-10-12：HTTP 200 / 46 条；必须同时带浏览器 UA 与 douyin.com Referer，否则 200 + 空列表
{ id: 'douyin', name: '抖音', 
  url: 'https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1',
  headers: {
    'User-Agent': DESKTOP_UA,                       // 复用文件顶部既有的 DESKTOP_UA 常量
    Referer: 'https://www.douyin.com/',
  },
  intervalMinutes: 15, riskLevel: 'high' },

// ── 抖音兜底 A（新增）：移动端 snssdk，实测零头部可用，且额外带 trending_list / recommend_list
{ id: 'douyin_app', name: '抖音(移动端兜底)',
  url: 'https://aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880',
  headers: {},                                      // 实测：连 UA 都不需要
  intervalMinutes: 15, riskLevel: 'medium' },

// ── 抖音兜底 B（新增）：iesdouyin 热搜词，字段最简但历史最久
{ id: 'douyin_ies', name: '抖音(热搜词兜底)',
  url: 'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/',
  headers: {},
  intervalMinutes: 15, riskLevel: 'medium' },

// ── 小红书（新增）：App 端热搜，实测免登录 200 / 20 条
// 代价：5 个固定头部必填，缺 shield 即 406 → 必须按「易碎渠道」处理（熔断 + 406 单独告警）
{ id: 'xiaohongshu', name: '小红书',
  url: 'https://edith.xiaohongshu.com/api/sns/v1/search/hot_list',
  headers: {
    'User-Agent': XHS_APP_UA,                       // iPhone MicroMessenger UA（见下）
    referer: 'https://app.xhs.cn/',
    'xy-direction': '22',
    shield: XHS_SHIELD,                             // 静态 token，平台轮换即失效 → 抽成常量并集中告警
    'xy-platform-info': XHS_PLATFORM_INFO,
    'xy-common-params': XHS_COMMON_PARAMS,
  },
  intervalMinutes: 30, riskLevel: 'high' },
```

```js
// 常量集中定义（独立成块，便于 shield 失效时一处替换）
const XHS_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.7(0x18000733) NetType/WIFI Language/zh_CN'
const XHS_SHIELD = 'XYAAAAAQAAAAEAAABTAAAAUzUWEe4xG1IYD9/c+qCLOlKGmTtFa+lG434Oe+FTRagxxoaz6rUWSZ3+juJYz8RZqct+oNMyZQxLEBaBEL+H3i0RhOBVGrauzVSARchIWFYwbwkV'
const XHS_PLATFORM_INFO = 'platform=iOS&version=8.7&build=8070515&deviceId=<deviceId>&bundle=com.xingin.discover'
const XHS_COMMON_PARAMS = 'app_id=ECFAAF02&build=8070515&channel=AppStore&deviceId=<deviceId>&device_fingerprint=<fp>&device_fingerprint1=<fp>&device_model=phone&fid=<fid>&gid=<gid>&identifier_flag=0&lang=zh-Hans&launch_id=716882697&platform=iOS&project_id=ECFAAF&sid=<sid>&t=1695190591&teenager=0&tz=Asia/Shanghai&uis=light&version=8.7'
// 完整取值见 60s/src/modules/rednote.module.ts 与 hot-topics/src/fetchers/rednote.ts（两者逐字一致）
```

### 解析器（可直接加入 `CHANNEL_PARSERS`）

```js
/** 中文数量字符串 → 数值：'947.5w'/'1.2万'/'8850' → 9475000 / 12000 / 8850 */
function parseCnNumber(s) {
  const t = String(s == null ? '' : s).trim()
  if (!t) return null
  const n = parseFloat(t)
  if (!isFinite(n)) return null
  return /[wW万]$/.test(t) ? Math.round(n * 10000) : Math.round(n)
}

/** 抖音热搜（web / snssdk / iesdouyin 三个端点同构，共用一个解析器）
 *  - web & snssdk: data.word_list[]  + data.trending_list[]
 *  - iesdouyin:    word_list[]       （顶层，无 data 包裹）
 *  rank 优先用 position（无则回退数组序）；url 用 sentence_id 拼热点详情页 */
function parseDouyin(json) {
  const root = (json && json.data) ? json.data : json
  const words = Array.isArray(root && root.word_list) ? root.word_list : []
  const rising = Array.isArray(root && root.trending_list) ? root.trending_list : []
  const rows = [
    ...words.map(w => ({ w, rising: false })),
    ...rising.map(w => ({ w, rising: true })),
  ]
  const items = []
  for (const { w, rising: isRising } of rows) {
    const topic = String(w.word || '').trim()
    if (!topic || items.some(x => x.topic === topic)) continue   // 与 trending_list 去重
    items.push({
      channel: 'douyin',
      rank: Number(w.position) || items.length + 1,
      topic,
      hotValue: Number(w.hot_value) || null,                     // trending_list 的 hot_value 实测为 0 → null
      url: w.sentence_id ? `https://www.douyin.com/hot/${w.sentence_id}` : null,
      rawCategory: isRising ? '上升热点' : null,
    })
  }
  return items.slice(0, 50)
}

/** 小红书 App 热搜：data.items[].title / .score / .word_type / .id
 *  注意 ① 接口不返回 rank，只能按数组序；② score 是带 w 后缀的字符串。 */
function parseXiaohongshu(json) {
  const list = (json && json.data && Array.isArray(json.data.items)) ? json.data.items : []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'xiaohongshu',
    rank: i + 1,
    topic: String(item.title || '').trim(),
    hotValue: parseCnNumber(item.score),
    url: sanitizeUrl('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(item.title || '') + '&type=51'),
    rawCategory: item.word_type || null,                          // 实测取值：'热' / '无'
  })).filter(x => x.topic)
}
```

### 落地时的四条硬约束

| # | 约束 | 原因 |
|---|---|---|
| 1 | **空列表必须视为失败**（`parseDouyin` / `parseXiaohongshu` 返回 0 条时，service 层不能让 `ChannelBreaker.recordSuccess` 记成功） | 抖音缺 UA/Referer 时是「200 + 空列表」；小红书头部失效是 406、其他异常也可能给空 `items` |
| 2 | **小红书 406 单独告警，不要混进「网络失败」** | 406 是「`shield` 头部失效」的特征信号，这是唯一需要人工介入的故障形态，混在一起排查成本极高 |
| 3 | **不要用 Web / 创作者平台登录态方案** | `/explore` 已 302 登录；`/api/sns/web/v1/*` 需 `X-S`/`X-T`/`x-S-Common` + 登录 Cookie，需引入 Playwright 与反爬对抗，且**不提供热榜**；创作者平台必须登录且路径未核实 |
| 4 | **抖音三级端点用「顺序降级」而非「并发」** | 三个端点数据同源，并发只会放大对平台的请求量与风控面；参考 [hot-topics `douyin.ts`](https://github.com/wimdaw/hot-topics/blob/main/src/fetchers/douyin.ts) 的 `firstOk` 顺序兜底 |

### 三个渠道的「是否需要登录态」一览

| 渠道 id | 是否可直接公开抓取 | 是否需要登录态 | 是否需要签名类参数 | 端点 |
|---|---|---|---|---|
| `douyin` | ✅ 是 | ❌ 否 | ❌ 否（仅需浏览器 UA + Referer） | `www.douyin.com/aweme/v1/web/hot/search/list/` |
| `douyin_app` | ✅ 是 | ❌ 否 | ❌ 否（零头部） | `aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880` |
| `douyin_ies` | ✅ 是 | ❌ 否 | ❌ 否（零头部） | `www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/` |
| `xiaohongshu` | ✅ 是（实测免登录 200） | ❌ 否 | ⚠️ **是**——需要静态 `shield` + 4 个 `xy-*` 指纹头部（缺一即 406） | `edith.xiaohongshu.com/api/sns/v1/search/hot_list` |

---

## 附录：本次实测记录（可复核）

| # | 请求 | 结果 |
|---|---|---|
| 1 | `GET https://www.douyin.com/aweme/v1/web/hot/search/list/`（浏览器 UA + `Referer: https://www.douyin.com/`） | 200，62,493B，`data.word_list` 46 条 |
| 2 | 同上 + 完整 query（`device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1&source=6&board_type=0&...`） | 200，68,992B，46 条 |
| 3 | 头部隔离：curl 默认 UA / 无 Referer | 200，`word_list` 空 |
| 4 | 头部隔离：浏览器 UA，无 Referer | 200，`word_list` 空 |
| 5 | 头部隔离：curl 默认 UA + Referer | 200，`word_list` 空 |
| 6 | 头部隔离：浏览器 UA + Referer | 200，**46 条** ← 两者缺一不可 |
| 7 | `board_type=0/1/2/3` | 47 / 46 / 46 / 46 条（同一份榜单） |
| 8 | `board_type=4/5/6/7/8` | 全部 0 条 |
| 9 | `GET https://aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880`（**无任何头部**） | 200，`status_code=0`，46 条；含 `trending_list` 5 条、`recommend_list` |
| 10 | `GET https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/` | 200，3,841B，50 条，字段仅 `word`/`hot_value`/`label` |
| 11 | `GET .../hotsearch/billboard/hot_video/` | 200，`status_code:1`，`"Url doesn't match"` |
| 12 | `GET .../hotsearch/billboard/aweme/` | 200，`aweme_list: []` |
| 13 | `GET https://www.douyin.com/aweme/v1/web/billboard/list/` | **404**，`Unsupported path(Janus)` |
| 14 | `GET https://www.douyin.com/aweme/v1/web/hot/search/detail/?sentence_id=2689795` | **404**，`Unsupported path(Janus)` |
| 15 | `GET https://www.douyin.com/aweme/v1/web/hot/word/` | **404**，`Unsupported path(Janus)` |
| 16 | `GET https://edith.xiaohongshu.com/api/sns/v1/search/hot_list`（**仅 UA**） | **406** |
| 17 | 同上 + `referer: https://app.xhs.cn/` | **406** |
| 18 | 同上 + `referer` + `xy-direction: 22` | **406** |
| 19 | 同上 + `referer` + `xy-direction` + `xy-platform-info` | **406** |
| 20 | 同上 + `referer` + `xy-direction` + `xy-platform-info` + `xy-common-params`（**无 shield**） | **406** ← 证明 `shield` 是硬门槛 |
| 21 | 同上 + 完整 5 件套（**含 shield**） | **200**，`code:0`，`data.items` 20 条 |
| 22 | 仅 `shield`（无其它 `xy-*`） | **406** ← 证明 5 件套缺一不可 |
| 23 | `GET https://www.xiaohongshu.com/explore` | **302 → `/login?redirectPath=...`**，130B，无 `__INITIAL_STATE__` |
| 24 | `GET https://edith.xiaohongshu.com/api/sns/web/v1/homefeed` / `www.xiaohongshu.com/web_api/sns/v1/search/hot_list` / `edith.../api/sns/web/v1/search/hotlist` / `www.../api/sns/web/v1/hot/list` | 404 / 500 / 406 / 500 —— **均为本次猜测路径，无一被开源项目印证，故不采用** |
| 25 | `GET https://60s.viki.moe/v2/rednote`、`https://60s-api.viki.moe/v2/rednote`、`https://60s.viki.moe/v2/douyin`（各 2 次，间隔 3s） | 全部 **429 + Cloudflare `error code: 1027`** |
| 26 | `GET https://tophub.today/`、`https://tophub.today/c/news` | 200（21,539B / 194,295B）；「小红书」命中 2 / 0，且无 `/n/*` 节点链接 → **站点无小红书榜** |
| 27 | `GET https://creator.xiaohongshu.com/` | 200（根路径） |
| 28 | GitHub 元数据：`api.github.com/repos/*`（DailyHotApi / DailyHot / SoloMCN / rebang / hot-radar / tophub-api / tophubToday / mini-hot / hot-topics 等） | 见上文清单 |
| 29 | GitHub 元数据（API 限流后改用首方派生）：`img.shields.io/github/{stars,last-commit,license}/*` | MediaCrawler 67k / XHS-Downloader 13k·GPL-3.0 / xhs 2.2k·MIT / 60s 5.8k·MIT / newsnow 22k·MIT / xhshow 1.1k·MIT |
| 30 | 源码取证：`raw.githubusercontent.com` 读取 60s（`rednote.module.ts`、`douyin.module.ts`）、hot-topics（`rednote.ts`、`douyin.ts`）、hot-radar（`fetchers.py`）、SoloMCN（`douyin.py`、`cn.py`、`hotlist.py`）、MediaCrawler（`xhs/client.py`、`xhs/login.py`、`douyin/client.py`、`requirements.txt`）、DailyHotApi（`douyin.ts`）、newsnow（`sources/douyin.ts`） | 逐条见上文引用链接 |
