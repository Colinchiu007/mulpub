# PRD：快捷采集·中文素材源扩展（quick-collect-cn-sources）

- 文档版本：v1.0（2026-10-11）
- 关联 change：`openspec/changes/quick-collect-cn-sources/`
- 上游特性：[`PRD-QUICK-COLLECT-2026-10-11.md`](PRD-QUICK-COLLECT-2026-10-11.md)（快捷采集本体，已合并 PR #3303 → `73892e06e`）
- 目标读者：实现者（主进程/渲染端）、评审者、后续维护素材源的会话

---

## 1. 背景与一句话目标

快捷采集本体已上线，但**素材源只有 Reddit / Hacker News / GitHub 三个英文源**：中文平台动态、中文科技资讯、平台规则公告这些「中文创作者真正关心的事」全都不在检索面内。

**一句话目标**：在不新建第二套采集链路的前提下，把**仓库已有的中文榜单源**（`hot-topics-service` 的 8 主榜 + 5 垂类）与**一批带时间戳的免费中文/技术源**接进快捷采集，并为「榜单类素材无发布时间」这一事实建立**诚实的统一素材模型 + 时间语义**，使中文指令能拿到真实中文素材，且**不把抓取时刻伪装成发布时间**。

## 2. 现状盘点（决定「接线 vs 新建」）

| 面 | 现状 | 结论 |
| --- | --- | --- |
| 快捷采集检索面 | `content-intelligence.search()`：Reddit / HN / GitHub 三源，条目带 `created_utc`，按关键词查 | 只能英文、只能按词查 |
| 热门选题页 | `hot-topics-service.js`：**8 个主榜**（知乎热榜、今日头条、腾讯新闻、B站热门、抖音热点、百度热搜、微博热搜、tophub 微博镜像）+ **5 个垂类补拉**（百度财经、新浪财经滚动、IT之家 RSS、微博情感、微博健康）；条目已带 `{ topic, channel, rank, hotValue, url, fetchedAt, category }`，且有节流（`intervalMinutes`）、熔断（连续失败 → 冷却）、10 分钟缓存 | **中文源已经打通并有解析器**，S1 是接线而非新建；`fetchedAt` 是现成的时间抓手 |
| 结论 | —— | S1 复用既有服务；S2/S3 才需要新写抓取与解析，且必须沿用既有纪律 |

## 3. 术语与分类（本 PRD 的判据基础）

### 3.1 源的两类形态（`kind`）

| kind | 语义 | 入参 | 例子 |
| --- | --- | --- | --- |
| `search` | 按**关键词**检索，命中正文 | 关键词 + 条数 + 相关性判据 | reddit / hackernews / github |
| `trend` | **无关键词**拉取榜单或时间线，按时间/名次取前 N | 无查询词；按窗口与条数截断 | 微博热搜、V2EX 最新、arXiv cs.AI |

> 二者**不能混在一个语义里**：`search` 有「查什么」的门禁语义（AGENTS.md 要求标题级相关性判据），`trend` 是「看现在有什么」。引擎按 `kind` 分流，检索三态也分别计数。

### 3.2 时间的两类语义（`timeKind`）——本 PRD 最重要的一条

| timeKind | 含义 | 时间字段 | 窗口过滤依据 |
| --- | --- | --- | --- |
| `published` | 源**自报发布时间** | `createdUtc`（epoch 秒） | 用它做窗口过滤（严格） |
| `observed` | 源**没有发布时间**，只有「我什么时候看到它在榜上」 | `observedAt`（epoch 秒） | 用 `observedAt` 做窗口过滤，并**在素材与提示词里显式标注这是抓取时刻** |

**为什么必须分开**（三份一手实现互证，见 §12）：

- DailyHotApi：`ListItem.timestamp: number | undefined`，微博路由 `timestamp: getTime(v.onboard_time || Date.now())` —— **有原生时间优先，没有则退化为抓取时刻**；
- TrendRadar：`news_items` 表**根本没有发布时间列**，只有 `first_crawl_time` / `last_crawl_time` / `crawl_count` / `rank` + `rank_history`；
- NewsNow：`pubDate?` 可选 + `SourceOption.hiddenDate?: boolean` 显式开关「这个源没有时间」。

**产品后果**：对 `trend + observed` 素材，界面与模型**不得**输出「最近 48 小时发布」这类结论；只能输出「当前榜单第 N 位（抓取于 X）」。这是本 PRD 的硬约束，写进提示词与 UI 文案。

### 3.3 榜单类 vs 时间线类（`sourceType`）

- `hottest`：有排名（微博/知乎/抖音/B站/百度/头条/腾讯/tophub/V2EX hot）；
- `realtime`：按发布时间倒序的时间线（RSS/Atom/JSON feed）。

## 4. 源清单

### 4.1 S1：中文榜单（复用热榜服务，零新抓取）

| id | 显示名 | 端点（仓库既有，2026-09-20 实测登记） | sourceType | timeKind | 风险 | 节流 |
| --- | --- | --- | --- | --- | --- | --- |
| `weibo` | 微博热搜 | `weibo.com/ajax/statuses/hot_band`（Referer） | hottest | observed | medium | 10m |
| `zhihu` | 知乎热榜 | `api.zhihu.com/topstory/hot-list?limit=50` | hottest | observed | low | 5m |
| `douyin` | 抖音热点 | `douyin.com/aweme/v1/web/hot/search/list/`（Referer） | hottest | observed | **high** | 15m |
| `bilibili` | B站热门 | `api.bilibili.com/x/web-interface/popular` | hottest | observed | low | 10m |
| `baidu` | 百度热搜 | `top.baidu.com/api/board?tab=realtime` | hottest | observed | low | 10m |
| `toutiao` | 今日头条热榜 | `toutiao.com/hot-event/hot-board/` | hottest | observed | medium | 5m |
| `tencent` | 腾讯新闻热榜 | `r.inews.qq.com/gw/event/hot_ranking_list` | hottest | observed | medium | 10m |
| `tophub` | 微博(tophub 镜像) | `tophub.today/n/KqndgxeLl9`（HTML） | hottest | observed | medium | 30m |
| `sina_finance` | 新浪财经滚动（垂类） | `feed.mix.sina.com.cn/api/roll/get`（JSON） | hottest | observed | low | 30m |
| `ithome_tech` | IT之家热榜（垂类科技） | `ithome.com/rss/`（RSS） | hottest | observed | low | 30m |

> **5 个垂类的口径（S1 补遗，2026-10-11 实测）**：仓库 `hot-topics-service.js` 的 `CATEGORY_BOOSTS` 定义的是
> **5 个垂类补拉**（百度财经榜 / 新浪财经滚动 / IT之家 RSS / 微博情感 / 微博健康），但它们的信道归属不同：
> - **2 个有独立信道**（`sina_finance`、`ithome_tech`）⇒ 已作为独立源入册，UI 可单独选；
> - **3 个与主榜共用信道**（`baidu-finance`→`baidu`、`weibo-emotion`/`weibo-health`→`weibo`），
>   靠 **条目 id 的 board 段**（`weibo:emotion:3`）与主榜区分、并带 `category` 直挂目标分类
>   ⇒ 它们的条目**随主榜一起到达**（请求 `baidu`/`weibo` 即含），**无需也不应**再立一个同名源
>   （那会让同一份条目在两个源下出现两次）。
> 结论：8 主榜 + 5 垂类**在数据可达性上已全覆盖**；registry 里落成 10 个 `hot-topics` 源。

抖音 `parseDouyin` 的 `url` 为 `null` ⇒ 该源条目用**源主页**（`homeUrl`）作链接，并标 `urlKind: 'board'`，提示词与 UI 文案写成「来源页面」而非「原文链接」（不伪造条目链接）。

### 4.2 S2：带时间戳的免费中文/技术时间线（新增抓取，全部本机实测 200）

| id | 显示名 | 端点 | 时间字段 | 备注 |
| --- | --- | --- | --- | --- |
| `solidot` | Solidot | `solidot.org/index.rss` | `<pubDate>`（21 处/20 条） | 中文科技 |
| `sspai` | 少数派 | `sspai.com/feed` | `<pubDate>` | 中文科技/效率 |
| `oschina` | OSCHINA 资讯 | `oschina.net/news/rss` | `<pubDate>`（51） | 中文技术 |
| `ithome` | IT之家 | `ithome.com/rss/` | `<pubDate>`（61） | 仓库已用于垂类 |
| `v2ex` | V2EX 最新主题 | `v2ex.com/index.xml`（或 `hot.json`） | `<pubDate>` / `created` | 两条形态：时间线 / 榜单 |
| `arxiv_cs_ai` | arXiv cs.AI | `export.arxiv.org/rss/cs.AI` | `<pubDate>` | **周末必然空**（`skipDays` 含 Sat/Sun）⇒ 空榜不是故障 |
| `hf_papers` | HuggingFace 每日论文 | `huggingface.co/api/daily_papers` | `publishedAt` | **格式为 `MM/DD/YYYY HH:mm:ss`（非 ISO）**，必须按美国格式解析 |
| `qbitai` | 量子位 | `qbitai.com/feed` | `<pubDate>`（10） | 中文 AI 垂直 |
| `infoq_cn` | InfoQ 中文 | `infoq.cn/feed` | `<pubDate>`（21） | 中文技术 |

> **实现状态（S2 已完成）**：上述 9 个源已入册（`quick-collect-sources.js`，`provider: 'feed'`，
> `timeKind: 'published'`），抓取与解析在 `quick-collect-trend-sources.js`。
> 两处与本节初稿的差异已按实测更正：① `v2ex` 采用 `hot.json`（榜单形态）而非 `index.xml`，
> 且因为它**每条自带 `created`**，按「有原生时间就用原生时间」标 `published`（不是 `observed`）；
> ② 由此把不变量从「hottest ⇒ observed」改为**按 provider 判**：`provider==='hot-topics'` ⇒ `observed`，
> `provider==='feed'` ⇒ `published`（测试逐条锁死）。
| `infoq_cn` | InfoQ 中文 | `infoq.cn/feed` | `<pubDate>`（21） | 中文技术 |
| `hnrss_front` | Hacker News(frontpage) | `hnrss.org/frontpage` | `<pubDate>` | 英文但补 HN 时间线（与既有 search 源区分） |

补充约束：**超大响应必须限条数或流式截断**（雷锋网 1.3MB / OpenAI News 1.2MB / HF blog 258KB 已实测），本 PRD 取「先 `res.text()` 但设 `MAX_BYTES`（默认 512KB）上限 + 解析后只取前 `MAX_PER_SOURCE`（20）条」。

### 4.3 S3：政策/合规类（**已实测：本机无可用的机器可读源** —— 以证据收口，不硬做）

> 2026-10-11 本机逐一实测（`Invoke-WebRequest`，UA 伪装 Chrome，12s 超时；判据：**能否稳定拿到条目级标题+链接+发布时间**）。
> 结论先行：**平台官方页全部是 JS 或登录态渲染，监管站点列表页缺条目级时间** ⇒ 按既有纪律（未实测通过不得入册）**本期不写入 registry**，避免用一个必然半坏、且会把"抓不到"伪装成"没有新规"的数据源。

| 候选 | 实测结果 | 判定 |
| --- | --- | --- |
| 微信公众平台公告 `mp.weixin.qq.com/cgi-bin/announce?...` | 200，13.8KB，**条目/日期命中 0**（JS 渲染 + 需 token） | ❌ 不可用 |
| B站 社区规则黑板报 `bilibili.com/blackboard/help.html` | 200，3.6KB，**0 条目 0 链接**（空壳） | ❌ 不可用 |
| 小红书 社区公约 `xiaohongshu.com/crown/community/agreement` | 200，9.3KB，**0 条目**（登录墙 + `__ERROR_TRACKER`） | ❌ 不可用 |
| 抖音 规则中心 `douyin.com/rule` | 200，**1.0KB**（纯壳） | ❌ 不可用 |
| 中央网信办 首页 `cac.gov.cn` | 200，59KB，139 处日期、358 链接，但**无「`<li>` 内标题+日期」可解析列表**（列表由脚本拼装） | ⚠️ 需逐条抓详情页才可能拿到日期 |
| 工信部 新闻列表 `miit.gov.cn/xwdt/index.html` | 200，19KB，41 条带文字的链接（标题可解析），但**列表页无条目级时间**（时间在详情页） | ⚠️ 同上 |
| 网信办子栏目（`/xxgk/tzgg/`、`/ywdt/`、`/xwzx/`） | 逐个 404（站点结构不同） | ❌ 路径不可用 |

**为什么不在本期硬做**（三条，都是产品判断而非技术偷懒）：

1. **"逐条抓详情页"会把一次点击变成 N+1 次外呼**：N 条列表项 = N 次请求，且这些站点的详情页同样可能改版；与"限频、不惊扰上游"的既有纪律冲突。
2. **半坏的源比没有源更糟**：HTML 结构一变就会静默空列表，用户会读成"近期没有新规"——这比"本功能暂不支持政策类源"严重得多（与 §9「整源丢弃 + 归因」同一条纪律）。
3. **合规/政策类信息的正确率权重最高**：创作者据此改内容策略，宁可显式缺失，不可给近似值。

**留给后续的三条可行路径**（需用户拍板其一，已登记在 tasks.md S3）：

- **A. 监管站点逐条抓取**：只取网信办/工信部等**政府站点**（无反爬、无需登录），接受 N+1 次外呼与 HTML 易碎性；必须带「结构变更 ⇒ 明确失败」判据与夹具测试。
- **B. 用户自填 RSS / 公告页 URL**：把"政策源"做成**用户可配置的订阅输入**（复用 feed 抓取层），合规与稳定性责任在用户侧；平台官方页（公众号/小红书等）由第三方 RSS 服务或用户自建实例提供。
- **C. 付费中文检索 API（= S4）**：一次性覆盖"中文全网（含公众号、社区）"，代价是 Key 与费用。

### 4.4 S4：付费中文检索 API（待用户提供 Key）

博查 / Tavily / Serper / Exa / 百度千帆 / 阿里 IQS / 腾讯云搜索，或模型厂商自带联网搜索。**无 Key 时不实现**。

> **实现现状（诚实更正）**：S4 **没有**在 registry 里留"开关位"——registry 里只允许出现**实测通过**的源（见 S3 的收口理由），
> 放一个永远不会被调用的占位条目，只会让"支持了付费源"与"只是登记了个名字"在代码里无法区分。
> 因此 S4 的现状是：**只在本 PRD 与本 change 的 tasks 里登记为「待用户提供凭证」**；用户提供 Key 与预算后，再按 tasks S4.2 新增 provider（密钥只从设置读、绝不落日志）。

## 5. 统一素材模型（一次定型，三个来源族共用）

```js
{
  url,          // string，必过共享 safeHttpUrl（否则整条丢弃，reason=invalid_url）
  urlKind,      // 'item' | 'board'（board = 用源主页兜底，UI/提示词须写成"来源页面"）
  title,        // string，非空，截断 300
  snippet,      // string，截断 200
  source,       // string，源 id（可归因，禁止兜底品牌名）
  sourceType,   // 'hottest' | 'realtime'
  timeKind,     // 'published' | 'observed'
  createdUtc,   // number|null，仅 timeKind='published' 有意义
  observedAt,   // number|null，仅 timeKind='observed' 有意义
  rank,         // number|null，榜单名次
  hotValue,     // number|null，源自报热度（不可空时不要编）
  engagement,   // number，排序用（= hotValue 或 HN points 或 0）
}
```

**借鉴来源（只借鉴字段语义与降级形状，不复制代码）**：

- `hot: number | undefined` 与 `timestamp: number | undefined` 的**可空设计**来自 DailyHotApi `src/types.d.ts`（**MIT**）；
- `pubDate?` + `hiddenDate` 显式开关、`status: "success" | "cache"` 两级新鲜度来自 NewsNow `shared/types.ts`（**MIT**）；
- `rank` + `rank_history` + `first_crawl_time`/`crawl_count` 的榜单模型来自 TrendRadar `storage/schema.sql`（**GPL-3.0，只读结论、零代码复用**）。

> 许可证边界（硬约束）：**AGPL-3.0（RSSHub）/ GPL-3.0（TrendRadar）不得内嵌或链接进本产物**；只允许借鉴其**设计结论**并在文档中注明出处。MIT 项目（DailyHotApi / NewsNow）亦不复制代码，只对齐字段语义。

## 6. 时间语义与窗口过滤规则（`quick-collect-materials.js` 判据）

1. 取有效时间：`timeKind='observed' ? observedAt : createdUtc`。
2. `windowHours > 0` 且有效时间为空 ⇒ `missing_time`（丢弃，理由与现网一致：无法证明"最近"）。
3. 有效时间早于 `now - windowHours*3600` ⇒ `out_of_window`。
4. 有效时间晚于 `now + 86400s` ⇒ `future_time`（源侧时钟漂移/脏数据）。
5. `windowHours = 0`（不限）⇒ 不做时间判据，但**仍保留并展示** `timeKind` 与 `observedAt`，供提示词如实描述。
6. 排序：`engagement` 倒序，其次有效时间倒序；并列时按 `source` 字典序（渲染稳定，与既有跨标题共性词排序纪律同族）。

## 7. 执行链（主进程）

```
点击指令
 → 校验（闭集：kind 归属、源 id、窗口、条数）
 → 分流检索：
     search 源：searchFn(keyword, {sources, limit, noCache, relevanceOn:['title','snippet']})   ← 既有链路不动
     trend  源：trendFn(sourceIds, {windowHours, limit, now})                                    ← 新增，一次调用
 → mergeMaterials（协议判据 / 去重 / 窗口 / 排序 / 截断 12）
 → buildMessages（素材清单带 source 标签、rank、timeKind 注释）
 → 默认大模型
 → normalizeCollectedItem → collectedItems（结果卡同手动采集）
```

检索三态（`retrieval`）扩展口径：`attempted = searchQueryCount + trendSourceCount`，`attempted<=0 ⇒ skipped`；有素材但有失败查询 ⇒ `partial`；无素材 ⇒ `empty`；否则 `ok`。

## 8. 数据校验（三层，fail-closed）

| 层 | 判据 | 失败表现 |
| --- | --- | --- |
| 指令层 | 标题 1–40；指令正文 10–4000；关键词 ≤5（每个 ≤30，只用前 3）；窗口 ∈ {0,24,48,168}；**源 id 必须属于闭集且 kind 归属正确** | 领域码 `QC_*_INVALID` |
| 素材层 | url 过 `safeHttpUrl`；title 非空；时间按 §6；单源条数 ≤20、总条数 ≤12 进提示词 | 计入 `dropped*`，**不改判三态** |
| 召回层 | `retrieval` 四态 + `sourceStats`（每源 `ok/skipped/failed/items`） | 空态声明行由引擎插入（不编造） |

## 9. 限流、缓存与失败降级（借鉴 RSSHub 三件套 + NewsNow 两级）

- **限流**：沿用 `hot-topics-service` 既有的 `intervalMinutes` 节流 + 熔断；新抓取源在 `quick-collect-sources` 里各带 `intervalMinutes`，用同一套内存节流实现（**只有真正放行去抓的请求才消耗一个 interval**，与 RSSHub `host-rate-limit.ts` 同形状）。
- **缓存**：trend 结果进内存缓存，键 = `namespace + 源 id 排序 + windowHours`（不拼字符串裸拼；借鉴 TrendRadar MCP 的 `make_cache_key(namespace, **params)` 形状），TTL 10 分钟（对齐热榜服务）。
- **失败降级**：单源失败 ⇒ 记 `sourceStats[src]=failed`，**整源丢弃而非逐条污染**（TrendRadar `expected_domain` 的降级语义），其余源继续；全失败 ⇒ 素材为空 ⇒ 引擎插入声明行。
- **域名校验**：trend 源的条目 url 除协议判据外，另校验 host 是否属于该源声明的 `expectedDomains`（借鉴 TrendRadar `expected_domain`）；不匹配 ⇒ 该条丢弃并计数 `domain_mismatch`（防「标签打错」与「真来自该源」无法区分）。

## 10. 交互与显示

- **页签内新增「素材来源」分组提示**（不新增页签、不新增弹窗）：在当前「检索关键词 / 素材时间范围」旁显示本次会用到的源分组（中文热榜 / 中文科技 / 英文社区），文案来自 locale（zh/en 成对）。
- **自定义指令表单**：源选择仍为可选（默认全选），但**必须显示分组与时间语义提示**（「榜单类源没有发布时间，按抓取时刻计入窗口」）。
- **结果卡溯源**：`quickCollect` 增加 `trendSources` / `sourceStats` / `timeKinds`，结果卡「来源」区如实显示「中文热榜（抓取时刻）/ 中文科技（发布时间）」两类标签，**未知源如实回显 id，禁止兜底品牌名**。
- **空态**：`empty`/`skipped` 维持既有声明行；周末 arXiv 空榜文案单独区分（「该源周末不更新」），不得显示为故障。

## 11. 内置词条变更（`quick-collect-presets.js`）

| id | 变更 | 理由 |
| --- | --- | --- |
| `builtin-ai-trends` | `sources` 增补 `arxiv_cs_ai` / `hf_papers` / `solidot` / `qbitai`；**提示词逐字不动** | 用户原话提示词按需求逐字保留；新增源给它真实 AI 素材 |
| `builtin-hot-topics` | `sources` 增补 8 个中文榜单 + `v2ex`；提示词**不改** | 中文热点是它的主场；「榜单素材没有发布时间」的约束写在 system 提示词（单实现），不在词条里重复 |
| `builtin-platform-policy` | `sources` 增补 S3 政策源（S3 落地后） | 规则类需要中文官方来源 |
| `builtin-peer-content` / `builtin-dev-tools` / `builtin-risk-alert` | 增补 `solidot`/`sspai`/`oschina`/`ithome`/`qbitai` 等中文科技时间线 | 中文创作者语境 |

**内置词条的 `sources` 必须是闭集子集**，且**新增源 id 一律进 registry**（禁止在词条里写裸字符串）。

## 12. 开源调研结论与借鉴清单（2026-10-11，证据分级见 change design.md）

| 借鉴点 | 出处 | 许可证 | 我们怎么用 |
| --- | --- | --- | --- |
| 可空 `hot`/`timestamp` 的统一素材 schema | DailyHotApi `src/types.d.ts` | MIT | 字段语义对齐（不复制代码） |
| 两级新鲜度 `interval` vs `TTL` + `status: success\|cache` | NewsNow `shared/consts.ts` / `types.ts` | MIT | 缓存与新鲜度回传形状 |
| 缓存键 + 单飞锁 + 按 host 限流（只有放行的请求消耗 interval） | RSSHub `cache.ts` / `host-rate-limit.ts` | **AGPL-3.0** | **仅借鉴设计结论**，自研实现 |
| 榜单模型 `rank` + `rank_history` + `first_crawl_time` + `crawl_count` | TrendRadar `storage/schema.sql` | **GPL-3.0** | **仅借鉴结论**（本期不落盘，故只对齐字段命名） |
| 声明式源注册表（`type: hottest\|realtime`、`interval`、`sub`、`disable`、`redirect`） | NewsNow `pre-sources.ts` | MIT | 我们的 registry 字段设计 |
| `expected_domain` 整源丢弃 + 告警 | TrendRadar `config.yaml` | GPL-3.0 | §9 的域名校验 |

**明确不可用**：① wechat2rss（`ttttmr/Wechat2RSS`）**无 LICENSE**（默认保留所有权利）⇒ 代码不可复用，且公众号直采需微信登录态 ⇒ **本 PRD 不做公众号直采**，只保留「用户自填第三方 RSS」的通用入口（S3 之后评估）；② 内嵌 RSSHub/TrendRadar 代码（AGPL/GPL 传染）；③ 机器之心 `jiqizhixin.com/rss`（200 但 0 条目）、PingWest `pingwest.com/feed`（空）、虎嗅 `huxiu.com/rss/0.xml`（超时）——实测不可用，禁止写入 registry。

## 13. 验收标准（可验证）

1. `hotTopicsService` 8 主榜中任一源可达时，`builtin-hot-topics` 的素材里出现中文榜单条目，且 `quickCollect.trendSources` 非空、`sourceStats` 每源有状态。
2. 榜单素材在素材清单与提示词里**带名次与抓取时刻**；不含「最近 48 小时发布」类表述（单测断言提示词文本）。
3. `windowHours=48` 时：`published` 素材按发布时间过滤；`observed` 素材按 `observedAt` 过滤；**缺时间且非 observed 的素材仍被丢弃**（`missing_time` 不变）。
4. 新增源全部属于闭集；未知源 id 被校验拒绝（领域码 `QC_SOURCES_INVALID`）；renderer 与主进程的源清单**逐项一致**（跨平面 parity 测试）。
5. 单源失败不影响其他源；全失败时 `retrieval='empty'` 且正文有引擎声明行。
6. 域名不匹配的条目被丢弃并计数 `domain_mismatch`。
7. 空榜（arXiv 周末）显示为「该源周末不更新」而非故障；URL 一律过 `safeHttpUrl`，未过者不落库。
8. 全部新增/改动测试文件通过；6 条变异反证各自指名变红后回滚；静态门禁（max-lines/locale-sync/ipc-bridge/brand/font-size）全绿；QM-1 打包 rc=0；QM-4 视觉基线若因新文案变化则按同一次 CI run 重取。

## 14. 非功能与合规边界

- **不做登录态抓取**：公众号/小红书/抖音需登录态的路径不进本扩展（合规风险最高）。
- **限频**：单次点击对同一上游最多 1 次请求；缓存 10 分钟；新增源必须在 registry 声明 `intervalMinutes`。
- **不记用户原文**：日志只记源 id、条数、失败原因；**不记关键词与指令正文原文**（沿用既有纪律）。
- **许可证**：AGPL/GPL 项目零代码复用；文档注明出处；如需消费其能力，只走「用户自建实例 + HTTP」。
- **地域可达性**：榜单类源在海外网络下可能不可达（DailyHotApi README 自述）⇒ 失败必须降级为「该源不可用」而不是报错中断。

## 15. 未闭合与风险（诚实记录）

1. S3 政策类源**尚未逐一实测**，未实测前不得进 registry（本 PRD 只登记候选）。
2. S4 需要付费 Key，**未提供则不实现**。
3. 榜单类源「名次跃迁/在榜时长」需要**跨次抓取的历史**（TrendRadar 用 `rank_history`）：本期不落盘，故只能给出「当前名次 + 抓取时刻」；`firstSeenAt`/`seenCount` 只做**内存内单次会话**统计，跨会话趋势留待后续切片。
4. 中文榜单源的稳定性天然弱于 RSS：单源失败/不可达是常态，产品必须能容忍（§9 已定义降级）。
5. `tophub` 与 `sina_finance` 属 HTML/滚动解析，页面结构一变即失效 ⇒ 失败计数进 `sourceStats`，不冒充「无热点」。
