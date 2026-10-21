# PRD + 调研：热门选题引入短视频平台「近期爆款」数据源

> **本文状态**：docs-only（调研 + 需求 + 合同）。**文中所有功能均未实现**，用户对界面看不到任何变化。
> **§5 是「第一刀」的实施合同**（代码服从本节，不是反过来）；**§6 是后续片的接口合同**，同样**未实现**。

---

## 1. 文档信息

| 项 | 内容 |
|---|---|
| 文档标题 | PRD + 调研：热门选题引入短视频平台「近期爆款」数据源 |
| 版本 | v1.0 |
| 日期 | 2026-10-17 |
| 作者 | PM + 技术文档（基于 2026-10-17 的开源参照系实测与两轮本机探针） |
| 变更类型 | 纯文档（本 PR）；§5–§6 的实现属运行时代码变更，须另开 worktree |
| 关联既有调研 | `01-docs/research/hot-topics-sources-douyin-xhs.md`（抖音/小红书**端点**逐项实测，2026-10-12）、`01-docs/research/hot-topics-sources-toutiao-ifeng.md`、`01-docs/research/hot-topics-classification-accuracy.md` |
| 关联既有 PRD | `01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md`、`01-docs/PRD-HOT-TOPICS-MULTI-SOURCE-AI-CATEGORY-2026-10-12.md`、`01-docs/PRD-HOT-TOPICS-SOURCES-QUALITY-2026-09-13.md`、`01-docs/PRD-HOT-TOPICS-QUOTA-GOVERNANCE-2026-10-13.md` |

### 1.1 一句话结论

用户要的是「近期**具体爆款视频**」，而开源世界给得很不均衡：**话题热榜已经过剩**（本仓已接入抖音、小红书热榜，再加一个榜没有增量），**内容条目级的源稀缺且大多不可商用**，**视频号一侧基本空白**。因此第一刀不打实时抓取，打**零风控的归档语料**：用 `douyin-hot-hub` 的每日在榜归档派生「连续在榜天数 + 峰值排名」这类**热度持续性信号**，先把「这条选题近期到底有多热、热了几天」做出来；条目级爆款另立合同（§6），前置是**扩条目数据模型**而不是加渠道。

### 1.2 为什么不是「再多接一个热榜」（本仓现状，读码核实）

| 现状 | 证据 |
|---|---|
| 抖音热榜**已在**渠道表，且已有三级兜底 | `apps/desktop/electron/services/hot-topics-service.js` 的 `CHANNEL_CONFIGS` 含 `id: 'douyin'` + `fallbacks`（`aweme-lq.snssdk.com`、`iesdouyin.com/.../billboard/word/`） |
| 小红书热榜**已在**渠道表 | 同上 `id: 'xiaohongshu'`；解析器 `parseXiaohongshu` 在 `apps/desktop/electron/services/hot-topics/channels.js` |
| 渠道解析器的统一产物是**话题**，没有内容条目字段 | `channels.js` 每个 `parse*` 返回 `{ channel, rank, topic, hotValue, url, rawCategory }` —— 没有 `author` / `publishTime` / `playCount` / `likeCount` |
| 因此「爆款视频进来也展示不出为什么爆」 | 渲染端 `apps/desktop/src/views/HotTopics.vue` 按 `topic` 展示与筛选，`CHANNEL_KEYS` 只认渠道 id |

**结论**：条目字段缺席是**结构性**的。任何"给热门选题加爆款视频内容"的方案，第一性问题都是数据模型，不是渠道清单。

---

## 2. 需求背景与目标用户

### 2.1 背景（用户原话与症状）

用户 2026-10-17 提出：「想在现在的热门选题中，**增加更多的短视频平台的近期的具体爆款视频内容**」，并要求先做开源项目检索。症状拆解：

1. 现有选题池给的是**热搜词**（「英雄联盟S16世界赛开赛」），用户得自己再去平台搜才知道有哪些视频在爆；
2. 榜单只有**当日快照**的热度值，看不出「这条是刚冒头还是已经热了 5 天」，而短视频选题的决策恰恰依赖后者；
3. 三个短视频平台里，**视频号**完全没有数据源。

### 2.2 目标用户

| 用户 | 场景 | 关心什么 |
|---|---|---|
| 短视频创作者（主） | 每天进「热门选题」挑一条能拍的 | 这条**还来得及吗**（刚冒头 vs 已退烧）、别人怎么做的（具体条目） |
| 多平台运营 | 选题后一键生成文案并分发 | 选题池够新、够宽，不要全是社会新闻 |
| 视频号运营 | 只管视频号 | 有没有可用的视频号热点（本文结论：开源侧没有，见 §4.3） |

### 2.3 用户故事

| # | 用户故事 | 验收绑定 |
|---|---|---|
| US-8 | 作为创作者，我希望看到某条抖音选题**已经在榜几天**，这样我能判断跟拍还来不来得及 | 条目带 `daysOnBoard`；连续在榜 3 天与首次上榜的条目在界面上可区分 |
| US-9 | 作为创作者，我希望看到某条选题的**峰值排名**，这样我知道它是不是曾经冲进前十 | 条目带 `peakRank`，与当前 `rank` 分列展示 |
| US-10 | 作为用户，我希望这个能力**不会因为平台风控而整页失败** | 数据源是 GitHub 归档而非平台接口；归档不可达时只在对应位置缺标签，不影响其余渠道（降级不扩散） |
| US-11 | 作为维护者，我需要界面**如实说明**标签来自离线归档 | 标签的悬浮说明里写明数据口径与截止日，不伪装成实时值 |
| US-12 | 作为后续施工者，我需要一份条目级爆款的**字段合同**，不必等实现完再补文档 | §6 的字段表、校验判据、错误码→locale 键映射齐备 |

---

## 3. 开源参照系实测（2026-10-17 取证）

### 3.1 档 A：热榜/热搜聚合（产物 = 话题词，与本仓现有渠道同质）

|---|---|---|---|---|---|
| [newsnow](https://github.com/ourongxing/newsnow) | 22,066 | MIT | 2026-10-13 | 抖音、快手；**无小红书、无视频号**（读 `server/sources/` 47 个适配器清单核实） | 自托管友好，但与本仓重复 |
| [DailyHotApi](https://github.com/imsyy/DailyHotApi) | 4,088 | MIT | 2026-03-11 | 抖音热点榜、快手热点榜等 45 站；**无小红书、无视频号**（逐行读 README 站点表核实） | 同上；半年未推送 |
| [60s](https://github.com/vikiboss/60s) | 5,821 | MIT | 2026-09-10 | 抖音 + `rednote`（小红书热搜）。**实测其小红书端与本仓同一个** `edith.xiaohongshu.com/api/sns/v1/search/hot_list`，且把 2023 年的 `shield` App 指纹**硬编码在源码里** | 不作为依赖：本仓已在用同一端点，抄过来只多一个会过期的常量 |
| [TrendRadar](https://github.com/sansan0/TrendRadar) | 62,975 | **GPL-3.0** | 2026-10-15 | 35 平台 + 关键词订阅 + AI 摘要 + 9 渠道推送；数据面**包的是 newsnow** | 产品形态最贴本需求（订阅词 + 跨平台去重 + AI 趋势），但 GPL ⇒ 只能用户自托管后调用，不得引入代码 |
| [TopList](https://github.com/tophubs/TopList) | 4,733 | Apache-2.0 | 2023-02-23 | 聚合站（Go） | 停更三年以上，不作候选 |
| [douyin-hot-hub](https://github.com/lonnyzhang423/douyin-hot-hub) | 780 | MIT | 2026-10-17（**每小时跑，今日仍在更新**） | 抖音热榜/明星榜/直播榜/音乐榜/品牌榜，**按日归档进 git** | ✅ **第一刀选定**：零平台请求、可离线、许可干净 |
| [website-hot-hub](https://github.com/cxyfreedom/website-hot-hub) 421 / [weibo-trending-hot-search](https://github.com/justjavac/weibo-trending-hot-search) 798 / [trending-in-one](https://github.com/huqi-pr/trending-in-one) 466 | — | MIT | 活跃 | 归档型（含抖音） | 同第一刀的机制，可作后续扩平台的选择 |

### 3.2 档 B：能给「具体爆款条目 + 互动数」的（这才对得上用户的原话）

|---|---|---|---|---|
| [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) | 16,332 | **Apache-2.0** | ✅ 首页推荐列表 + 关键词搜索 + 笔记详情/评论（读 README 功能清单核实），需登录态本地浏览器 | 小红书「近期爆款笔记」的现实来源。但本仓已有内嵌浏览器与账号登录态基建，**照其语义自持实现比引第三方更省**（同 AGENTS.md「单一实现」取向） |
| [TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader) | 16,920 | GPL-3.0 | ✅ README 明列「采集抖音热榜数据」「采集抖音搜索数据」，含 WebAPI 模式 | 同 TrendRadar：只可用户自托管调用，代码不入包 |
| [XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader) | 13,033 | GPL-3.0 | 作品采集/链接提取 | 同上 |
| [douyin-downloader](https://github.com/jiji262/douyin-downloader) | 12,322 | MIT | 单条/主页批量下载，**不是榜** | 与「发现爆款」无关 |
| [ReaJason/xhs](https://github.com/ReaJason/xhs) | 2,220 | MIT | 小红书 web 请求封装（需自备 cookie 签名） | 可作签名口径参照；本身不含热榜/推荐 |

### 3.3 档 C：整链产品参照（选题 → 拆解 → 发布），抄思路不抄码

[AiToEarn](https://github.com/yikart/AiToEarn) 26,556 MIT（14 平台分发，含视频号）· [AIWriteX](https://github.com/iniwap/AIWriteX) 2,107 Apache-2.0（全网热搜聚合 + 趋势分析 + **爆款选题**，公众号向）· [Easel](https://github.com/ZJU-REAL/Easel) 3,745 Apache-2.0（discover trends → create → publish）· [OpenBiliClaw](https://github.com/whiteguo233/OpenBiliClaw) 3,465 MIT（跨平台内容发现 Agent）· [social-account-doctor](https://github.com/JuneYaooo/social-account-doctor) 303 MIT（扫同赛道找对标、拆爆款）· [tangdan-hot-collector](https://github.com/1968820297-hue/tangdan-hot-collector) 11 未标注协议（抖音热点宝达人分析/作品采集扩展，功能正中但体量与许可都不具备）· [Viral_Radar](https://github.com/Cloudbird-Software/Viral_Radar) 3 MIT（视频号/抖音/小红书对标采集 + ASR/OCR 拆解）。

### 3.4 本机探针（2026-10-17，与既有调研互证）

| 探针 | 本轮实测读数 | 与既有文档的关系 |
|---|---|---|
| `douyin.com/aweme/v1/web/hot/search/list/?...&detail_list=1` | HTTP 200，66,639 字节；`data.word_list` **50** 条 + `data.trending_list` **5** 条；条目字段仅 `word / hot_value / position / sentence_id / video_count / discuss_video_count / word_cover / …` | **确认不含任何视频条目**（`video_count` 只是计数）。既有调研 2026-10-12 记为 46 条，本轮 50 条，属平台侧条数波动，不影响结论 |
| `iesdouyin.com/web/api/v2/hotsearch/billboard/aweme/` | HTTP 200，109 字节，`status_code:0`、`aweme_list: []` | 与 `01-docs/research/hot-topics-sources-douyin-xhs.md` 记录的「实测恒为 `[]`」**互证**（相隔 5 天仍为空）。旧的公开「热门视频榜」端点已无数据 ⇒ **不能据此写任何"爆款视频"功能** |
| 同域 `billboard/word/` | HTTP 200，3,736 字节，50 条话题词 | 本仓现有第 3 级兜底仍有效 |
| `douyin-hot-hub` 归档 `archives/2026-10-16.md` | 38,930 字节 / 131 行；小节 = `## 抖音热榜`(约 50 条)、`## 明星榜`(4)、`## 直播榜`(4)、`## 音乐榜`(31)、`## 品牌榜`(34)；条目形态 `N. [标题](https://www.douyin.com/search/< urlencode 标题 >)`；**全文 0 处热度值**；仅一行 `最后更新时间：2026-10-16 23:17:47 +0800` | 第一刀的数据形状据此确定（§5.2）。三条硬事实必须写进合同：**没有 hotValue、没有视频条目、一天只有末次快照**（日内轨迹不保留，`raw/<date>/*.json` 的结构化产物实测只到 2021 年，2026-10-16 目录 MISSING） |

---

## 4. 逐平台可用性判定

### 4.1 抖音

- 话题榜：已有，且免登录可用（本仓三级兜底）。
- **爆款视频条目**：开源侧只有两条真路 ——
  1. **官方抖音开放平台「热门视频榜」OpenAPI**（[文档](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/data-open-service/tops-data/hot-video-list/hot-video-list)、[能力页](https://developer.open-douyin.com/capacity-center-page/capacity-detail/7180577040481910795)）。唯一「合规 + 直接给视频条目」的来源。**本轮未能读出字段表**：该文档站是 SPA，抓取只拿到样式脚本 ⇒ **返回字段、权限项、配额、是否收费一律标为「未核实」**，接入前必须由有资质的账号按页面实测，不得凭本文想象写字段。
  2. 带签名/登录态的自托管采集（DTK Apache-2.0，或 TrendRadar/TikTokDownloader 这类 GPL 服务）。既有调研已核实「签名只在热搜词详情/相关视频/搜索接口上需要，热榜本身不需要」⇒ 条目必然落在**要签名**的那一侧，属平台侧可随时收紧的口子。

### 4.2 小红书

- 话题榜：已有（App 端热搜，需硬编码 `shield`，本仓已带 406 专项告警）。
- 爆款笔记条目：`xiaohongshu-mcp`（Apache-2.0）那套 homefeed/搜索语义是现实可做的；`MediaCrawler` 仅作采集链路参考。
- 本仓落点建议：**自持实现**，复用既有内嵌浏览器与账号分区登录态，不引入第三方代码（避免第二份签名口径，AGENTS.md 的「单一实现」同族）。

### 4.3 视频号（微信 Channels）

- **开源侧没有热榜来源**（本轮 6 组关键词检索 + 逐仓库读 README 未命中任何"榜单/推荐流" API；表述为「未命中」而非「不存在」）。
- 官方侧 [WxJava](https://github.com/binarywang/WxJava) 33,164 Apache-2.0 描述含「视频号」，但那是账号/电商管理面，**没有"热门内容"接口**。
- **决策**：视频号短期不追开源源。要么走人工录入（把链接粘进选题池），要么把付费数据服务列为可选项（TikHub / JustOneAPI / SocialDataX / 新榜 / 飞瓜），并在界面上如实标付费来源。**不得**为了"三平台齐全"把一个假源塞进渠道表。
- 同族判据提醒：视频号属**另一种通道种类**，不得为它扩 `publishMode` 的枚举，也不得塞进平台登记面 —— 先例见 `01-docs/PRD-PODCAST-RSS-CHANNEL-2026-10-09.md` 的「协议型分发通道不挤进平台登记面」。

---

## 5. 第一刀：归档型「近期热度」信号（`douyin_hot_hub`）

### 5.1 这一刀交付什么、不交付什么

| 交付 | 明确不交付 |
|---|---|
| 抖音选题的 **`daysOnBoard`（近 14 日内在榜天数）** 与 **`peakRank`（同期最好名次）** 两个标签，数据来自 GitHub 归档，零平台请求 | ❌ 具体爆款视频条目（那是 §6 的合同） |
| 数据口径与截止日在界面上可见（不伪装成实时值） | ❌ 小红书/视频号的同类标签（归档仓库只有抖音；小红书侧无等价归档源） |
| 归档不可达时的降级：标签缺席、其余渠道照常 | ❌ hotValue（归档里没有，**禁止**用"名次"冒充热度值喂给现有 `scorer`） |

### 5.2 数据形状合同（据 §3.4 实测，不得凭想象）

```
GET https://raw.githubusercontent.com/lonnyzhang423/douyin-hot-hub/main/archives/<YYYY-MM-DD>.md
```

- 解析域**只取 `## 抖音热榜` 小节**，`明星榜/直播榜/音乐榜/品牌榜` 一律不并入（口径不同：品牌榜是商业榜，混进来会把广告词当选题）。
- 条目形如 `N. [标题](https://www.douyin.com/search/%E8%8B%B1...)` ⇒ 取 `标题` 作文本；**链接必须是 `https:` 才产出锚点**，判据只走 `packages/shared-utils/src/safe-http-url.js`（AGENTS.md 的 href 协议守卫，禁止第二份实现）。
- 文件内 `最后更新时间：…` 行 = **该日末次快照**，即整个归档的时效上限；`N.` 的序号即当日名次。
- 归档**没有** `hotValue`。⇒ `daysOnBoard` / `peakRank` 是**名次派生量**，与现有 `hotValue`（平台自报热度）**不同源、不同口径，不得互相冒充、不得进 `scorer` 的 sourceBonus 加权**。

### 5.3 流程

```
进入热门选题页
  ├─ 现有：实时渠道并发抓取（Promise.allSettled）        ← 不改
  └─ 新增：热度标签通道（独立、非阻塞）
        ① 读本地归档缓存（userData 下，TTL 6h）
        ② 缓存命中且日期覆盖够（近 14 日）→ 直接算标签
        ③ 缺口：按「今天 → 最多回溯 14 天」拉 raw.githubusercontent.com 的 .md
             · 串行拉取，单次上限 14 个文件，总预算 8s（可环境变量覆盖，非法值回落默认并告警）
             · 任一文件 404/超时 → 跳过该日，**不中断**其余日
        ④ 逐日解析 → 以「标题原文（剥空白后）」为键聚合成 { daysOnBoard, peakRank, firstSeenDate, lastSeenDate }
        ⑤ 写缓存；当前榜单条目按标题精确匹配贴标签
        ⑥ 匹配不到 → 该条目不显示标签（**禁止**模糊匹配造标签）
```

### 5.4 功能逻辑（判据）

- **聚合键 = 标题逐字**。抖音话题词在归档里是稳定字面串，任何"归一化后匹配"（去标点、简繁、大小写折叠）都会把两条不同选题并成一条 —— 与既有调研「同一条选题被跨渠道去重后误算成多榜同现」是同一类风险，宁可漏标不可错标。
- `daysOnBoard = 近 14 个有归档的日期中该标题出现过的**不同日期数**`；缺失日（404）不计入分母，并记 `archiveDaysFetched < 14` 供界面如实显示口径。
- `peakRank = 所有出现日里的最小名次`；名次并列取出现次数多的那条，再并列按字典序（保证渲染稳定，沿用既有高频词统计的收口做法）。
- **上限与预算**：单次回溯 14 日；单文件解析上限 60 条；标签通道整体预算 8s，超时即带已有部分结果渲染并如实标注，**不得**阻塞首屏（AGENTS.md 首屏不得阻塞在 IPC 之后）。
- **缓存位置**：`userData/hot-topics-archive/<yyyy-mm-dd>.md`，按当日 TTL 覆盖写；写失败只 warn。测试一律落 `os.tmpdir()` 带 PID 的独立路径（AGENTS.md 文件系统测试隔离）。

### 5.5 交互逻辑

| 交互 | 行为 |
|---|---|
| 条目右侧标签 | 显示「在榜 N 天」；`N=1` 显示「新上榜」；`N≥7` 追加「持续热」 |
| 峰值排名 | 标签内以次级文本呈现「峰值第 M」；`M` 缺失（未回溯到）则不显示该段 |
| 悬浮 | 说明数据口径：来源 = 抖音公开热榜每日归档、截止日 `lastSeenDate`、抓取覆盖 `archiveDaysFetched/14` 天 |
| 点击标签 | 不新增跳转（锚点仍用条目自身既有链接），避免与既有「一键创作/生成视频」入口争交互 |
| 归档不可达 | 标签整列缺席，**不**弹错误、**不**进 `partialFail` 那条「部分渠道获取失败」（它不是渠道） |

### 5.6 显示项与提示文字（**locale 合同，尚未写入 `locales/hot-topics/{zh,en}.js`**）

命名空间沿用现有 `hotTopics`（实测 `apps/desktop/src/locales/hot-topics/zh.js` 第 23 行即 `channels: {`）。新增键与逐字文案：

| 键 | zh | en |
|---|---|---|
| `recency.new` | 新上榜 | New on list |
| `recency.days` | 在榜 {n} 天 | On list {n}d |
| `recency.sustained` | 持续热 | Sustained |
| `recency.peakRank` | 峰值第 {rank} | Peak #{rank} |
| `recency.tooltip` | 来自抖音公开热榜的每日归档，数据截至 {date}，本次覆盖 {fetched}/{total} 天 | From daily snapshots of Douyin's public hot list archive. Data as of {date}, covering {fetched}/{total} days. |
| `recency.partialCoverage` | 归档覆盖 {fetched}/{total} 天，天数可能偏少 | Archive covers {fetched}/{total} days; day counts may be lower |

三条硬约束：① zh/en **必须成对提交**（CI Gate 7 `check-locale-sync.js` 拦截）；② 渲染端 `src/` 不得新增中文字面量（CJK 基线扫描）；③ 文案里的「抖音」是平台名，可写；**不得**写任何参考产品的品牌名（Gate 12 品牌残留），取证 note 用中性称谓。

### 5.7 数据校验

| 校验点 | 判据 | 失败处理 |
|---|---|---|
| 日期文件名 | 只接受 `YYYY-MM-DD`，且不得晚于本机当日 | 拒绝并跳过（防把未来日期的空档算成"未在榜"） |
| 响应体 | 必须含 `## 抖音热榜` 小节标题；否则视为格式漂移 | 记 `ARCHIVE_SHAPE_DRIFT` warn，该日不入库（**不得**退回"整文件都算热榜"，会把品牌榜当选题） |
| 条目数 | 单日解析结果为 0 条 ⇒ 视为失败，不是「当日无热点」 | 与既有调研「200 + 空数组必须当失败」同口径 |
| 标题 | 空串、纯空白、长度 > 60 字符 ⇒ 丢弃 | 静默丢弃并计入 `dropped` 计数（日志只记计数，**不记标题原文**，防与用户草稿标题混淆） |
| 链接 | 非 `https:` 协议 ⇒ 不产出锚点，保留文本 | 沿用 `safeHttpUrl` 的「不产出锚点、保留文本」语义，不得渲染死链 |
| 名次 | 非正整数 ⇒ `peakRank` 置空 | 标签退化为只有天数 |
| 环境变量 | `MP_ARCHIVE_MAX_DAYS` / `MP_ARCHIVE_BUDGET_MS` 非法值回落默认并 `warn` | 对齐 publish-frequency-policy / task-queue 的既有 env 纪律 |

### 5.8 落点清单（实现那一刀时逐个改）

| 层 | 文件 | 改动 |
|---|---|---|
| 主进程 · 解析 | `apps/desktop/electron/services/hot-topics/channels.js` | 新增 `parseHotHubArchive(md, date)`（纯函数，不发网络请求，与既有解析器同构） |
| 主进程 · 归档 | 新目录 `apps/desktop/electron/services/hot-topics/archive.js` | 逐日拉取 + 聚合 + 缓存；**不进 `CHANNEL_CONFIGS`**（避免被当作实时渠道参与 `channelStats`/`partialFail`/配额） |
| 主进程 · 服务 | `apps/desktop/electron/services/hot-topics-service.js` | 首帧后 `setTimeout(0)` 懒触发标签通道；结果与既有条目按标题精确匹配后合并 |
| 渲染层 | `apps/desktop/src/views/HotTopics.vue` | 标签插槽；`CHANNEL_KEYS` 不动 |
| 文案 | `apps/desktop/src/locales/hot-topics/{zh,en}.js` | §5.6 六键成对 |
| 测试 | `hot-topics/archive.test.js`（新增）+ `hot-topics-new-sources.test.js`、`hot-topics-service.test.js`（同步） | 见 §8 |

---

## 6. 后续片的合同（**这是合同，不是实现；对用户仍不可用**）

### 6.1 前置：条目数据模型扩展（所有爆款源的公共前提）

现有产物 `{ channel, rank, topic, hotValue, url, rawCategory }` 必须扩为向后兼容的可选段：

| 新字段 | 类型 | 必填判据 | 缺席语义 |
|---|---|---|---|
| `kind` | `'topic' \| 'item'` | 是（默认 `'topic'`） | 旧渠道全部照旧走 `'topic'`，**不得**因新字段整体重构解析器 |
| `author` | string \| null | 源给得出才填 | null ⇒ 界面不渲染作者段，**不得**兜底成渠道名或平台名 |
| `publishTime` | ISO string \| null | 源给得出才填 | null ⇒ 不渲染"发布于"；**禁止**用抓取时间冒充发布时间 |
| `interaction` | `{ like?, comment?, share?, play? }`，值必须为非负整数 | 至少一项存在才允许产出对象 | 空对象 ⇒ 视为字段缺席（避免「有对象但全 undefined」的假数据） |

校验不变式：`kind='item'` 的条目若 `author`、`publishTime`、`interaction` **三者全空**，必须在收集层判为不合格并丢弃 —— 那说明源其实没给条目，只是把话题贴了个 `'item'` 标签（**装饰性升级**，本仓「假绿」的同型）。

### 6.2 片二（抖音条目）

优先官方「热门视频榜」OpenAPI（资质/权限/字段以实测为准，见 §4.1 的「未核实」标注）；拿不到资质时才退到自托管签名方案，并把该源标为 `riskLevel: 'high'` + 独立熔断。

### 6.3 片三（小红书条目）

自持实现 homefeed / 搜索语义（参照 `xiaohongshu-mcp`，**不引其代码**），复用既有账号分区登录态；互动数取平台自报口径，与抖音不同源 ⇒ 跨渠道排序仍按渠道内归一（沿用现有 `scorer` 口径），**不得**直接跨平台比点赞。

### 6.4 片四（视频号）

在拿到可用源之前，界面保持"无视频号选题"的如实空态；不得用抖音条目冒充。

---

## 7. 非目标

- ❌ 不做客户端 hook / 逆向微信来获取视频号数据。
- ❌ 不在本刀引入任何**新的平台请求**（第一刀只走 GitHub raw）。
- ❌ 不扩 `publishMode` 枚举、不动 `publish-capabilities.json` 与平台登记面。
- ❌ 不把归档标签接进 `scorer` 的跨渠道加权（口径不同源，见 §5.2）。

## 8. 验收标准与测试计划（第一刀）

| # | 验收 | 测试形态 |
|---|---|---|
| A1 | 给定 3 个日期、同一标题出现 3 次 ⇒ `daysOnBoard=3`、`peakRank` 取最小名次 | 单元（纯函数，喂真实归档样本节选） |
| A2 | 中间某日 404 ⇒ 其余日照常聚合，`archiveDaysFetched` 如实小于 total | 单元（注入假 fetch） |
| A3 | 文件缺少 `## 抖音热榜` 小节 ⇒ 该日判失败，**不**把品牌榜并入 | 单元 + **变异反证**：把小节门禁摘掉必须变红 |
| A4 | 单日解析 0 条 ⇒ 记为失败而非"无热点" | 单元（空数组负控） |
| A5 | 标题不在归档里 ⇒ 该条目**无标签**，不出现「在榜 0 天」 | 集成 |
| A6 | 归档通道抛错/超时 ⇒ 首屏其余渠道照常渲染 | 集成（预算用假时钟单次推进 + 断言每文件各请求一次） |
| A7 | `kind='item'` 三字段全空被丢弃 | 单元（§6.1 的不变式，随片二落地） |
| A8 | locale 六键 zh/en 成对、无渲染端中文字面量新增 | CI Gate 7 + CJK 基线扫描 |
| A9 | 文本结构断言：解析器对「小节边界 + 条目行」的产物用 `toEqual` 精确断言，不许只 `toContain` | 单元（AGENTS.md 文本结构断言 MUST） |
| A10 | 视觉：标签属 HotTopics 行内新增元素；CI 像素门禁 `pixelTests` 若不含 `hot-topics`，必须**登记盲区**并按 `hot-topics-pipeline-picker` 那轮的替代取证方式做（组件锁 + 真实 dev 截图），不得拿「QG Visual 绿」当证据 | QM-4 |

> 反证纪律：A3/A4/A6 各做一次「把该判据改成 no-op ⇒ 必须立刻变红」的变异，否则不构成回归锁。

## 9. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 上游归档仓库停更（GitHub Actions 由第三方维护） | 标签口径停在旧日期 | 数据口径与截止日写进界面 tooltip（US-11），**过期即如实显示**；`archiveDaysFetched=0` 时整列标签缺席而非报错 |
| 归档格式漂移（小节名/条目形态变化） | 解析出 0 条 | A3/A4 的 fail-closed；warn 文案点名小节名，便于定位是上游改版还是网络故障 |
| 平台收紧热榜接口签名 | 实时渠道受影响 | 与本刀解耦：本刀不发平台请求；实时渠道已有三级兜底 |
| 「daysOnBoard」被误读为热度值 | 用户决策被误导 | tooltip 写清口径；`hotValue` 字段留 null 不填 |
| 条目级那一片的合规面（爬虫 ToS） | 法务/账号风险 | §6 实现前须单独过一次合规评估，不在本 PR 范围 |

## 10. 变更记录

| 日期 | 内容 |
|---|---|
| 2026-10-17 | v1.0 首版：开源参照系实测（档 A/B/C）、逐平台可用性判定、第一刀（归档型热度标签）六维度规格、条目模型合同（§6，未实现） |
