# 变更：热门选题新增 gyread.com 作为 AI 分类专用信源（hot-topics-gyread-ai-source）

## Why

用户 2026-10-18 调研 `gyread.com/news/` 后提出：这个站是否适合作为 AI 类别热门选题的信息源。
调研结论（`01-docs/research/hot-topics-sources-gyread.md`）是「适合，但要摆正位置」：
它是**一级筛选后的候选池 + 溯源跳板**，不是最终事实来源。核心价值与核心风险如下。

**价值（为什么值得接）**：

1. **时效与连续性**：2026-06-02 创刊，截至 2026-10-17 连续 139 天无中断日出刊；
   对外索引 `search-index.json` 每日更新（实测 `generated` 最新一期为 2026-10-17 18:46）。
2. **一手信源直达**：每条选题都带原文链接，实测 10-14/10-15 两天共 26 条中 19 条回验成功
   （CNBC / The Verge / Understanding AI / Ben's Bites / NVIDIA Blog / Allen AI / Stanford CSB 等），
   且标题与原文 `og:title` 高度一致。
3. **信源质量高**：集中在一线科技媒体与研究者，不是聚合站搬运。
4. **中文 + 已结构化**：`search-index.json` 有 `u/d/c/t/s/g`（URL/日期/栏目/标题/摘要）字段，
   621KB、1421 条，可直接入库。
5. **AI 浓度极高**：近 30 天 321 条里 OpenAI(44)、智能体(44)、Anthropic(27)、GPT(28)、
   开源(51)、Agent(30)、安全(29)、芯片(17)、融资(24) —— 正是 AI 分类最缺的供给。

**风险（为什么必须专门设计而不是直接当普通渠道挂上）**：

| 风险 | 实测证据 |
|---|---|
| **robots 禁止 AI 训练** | `robots.txt` 对 GPTBot/ClaudeBot/CCBot/Google-Extended 全站 `Disallow`；响应头 `x-robots-tag: noai, noimageai`。仅 OAI-SearchBot/ChatGPT-User/PerplexityBot 等**检索类** UA 放行 `/news/` |
| **源链接失效率 7/26** | MarkTechPost 403、higgsfield.ai 404、X 帖子 404；且有一处**出处张冠李戴**（「梁文锋注资 Winverse AI」的出处链到微软 Swin-Transformer 仓库，与该事件无关） |
| **版式仍在演进** | 2026-10-17 起新版用 `item-meta`（`meta-source`/`meta-topic`）替代 `dateline`，`src-line` 支持一条多链接 |
| **无官方 API / RSS** | 无 RSS、无 `llms.txt`，`/api/` 被 robots 禁。可用数据面只有 sitemap + search-index.json + HTML |
| **不是「榜单」而是「日报」** | 它的排序是编辑意志，不是热度排序；`hotValue` 字段不存在，跨渠道热度可比性为零 |

最后一条决定了架构：gyread **不能**作为普通 `CHANNEL_CONFIGS` 主渠道（那里的条目要参与
统一热度评分与跨渠道 `sourceBonus` 全民热点信号），而应作为 `CATEGORY_BOOSTS.ai` 的定向补拉源
——AI 分类正是它供给最对口、而现有补拉源（IT之家 RSS 筛 AI）质量最弱的一环。

## What Changes

### 一、新增两个解析器（`channels.js`）

- `parseGyreadIndex(json)`：解析 `search-index.json`。输入 `{generated, pages, count, items[]}`，
  每条 `item` 有 `u`(相对 URL) / `d`(日期) / `c`(栏目) / `t`(标题) / `s`(摘要) / `g`(标签)。
  输出统一条目结构，`channel: 'gyread'`，`rawCategory` 取栏目名 `c`。
  **按调用方传入的 `date` 过滤**（只取某一天或最近 N 天），因为全量 1421 条远超 `MAX_PER_CHANNEL`。
- `parseGyreadEdition(html)`：解析单期日报 HTML，抽取 `item-title` / `item-meta` / `body` / `src-line`。
  这是**溯源信息的载体**：`src-line` 里的一手原文链接必须带进条目，供用户点击回跳。
  同时**兼容两版结构**：旧版 `dateline`（`CNBC · 华尔街金融防线 · 独家`）与新版 `item-meta`
  （`meta-source` + `meta-topic`），因为实测站点 2026-10-17 起已切换版式。

**刻意不接的形态**：`/news/<date>` 无后缀 URL（实测与 `/news/<YYYY-MM>/<date>.html` 内容同源但
返回体不同，且 sitemap 用的是前者而页面内链用的是后者，双入口增加解析歧义）；
`sitemap.xml` 只用于发现 URL 列表，不作为解析目标。

### 二、`CATEGORY_BOOSTS.ai` 增加 gyread 源

```
ai: { threshold: 4, sources: [
  { id: 'ithome-ai', ... },                 // 既有：IT之家 RSS 筛 AI
  { id: 'gyread-ai', name: 'GYREAD AI 情报日报',
    url: 'https://gyread.com/news/search-index.json',
    parser: 'gyread_index', channel: 'gyread', board: 'ai',
    boostCategory: 'ai', onlyCategory: 'ai',
    intervalMinutes: 60, riskLevel: 'medium',
    throttleKey: 'gyread-index',
    entryUrl: 'https://gyread.com/news/' },  // 溯源入口，附在条目上供用户回跳
]}
```

**为什么挂 `ai` 补拉而不是主渠道**：见上文「不是榜单而是日报」。挂补拉还顺带解决三个问题：
① 不参与 `sourceBonus`（它的排序是编辑意志，混进「全民热点」信号会失真）；
② 受 `CATEGORY_BOOSTS.ai` 既有 threshold=4 控制，AI 分类条目充足时不会每轮都打它；
③ 与既有 `ithome-ai` 共用 `board: 'ai'`，两源互补而非互斥。

**配额**：`intervalMinutes: 60`（日报一天一更，60 分钟足够；站点是 Cloudflare 缓存 HIT，
压力极小但仍按最保守口径设）。`riskLevel: 'medium'`：无登录态、无反爬对抗，但存在
`x-robots-tag` 声明，必须比纯公开榜更克制。

### 三、分类器 AI 词表扩充（`classifier.js`）

gyread 的高频词在现有词表里有缺口，实测这些标题会漏判或误判：

- **补 strong**：`日报`、`情报`、`前沿`、`信号`、`智能体经济`、`算力战`、`端侧`、
  `开源权重`、`闭源`、`多智能体`、`世界模型`、`上下文`、`强化学习`、`蒸馏`、`对齐`、
  `幻觉`、`智能体`
- **补 weak**：`推理`、`评测`、`基准`、`参数量`、`激活参数`、`上下文窗口`、`token 成本`
- **新增 `gyread` 渠道原生映射**（`RAW_CATEGORY_MAP.gyread`）：该站栏目名直挂分类。
  注意 `DOMAIN_LEVEL_RAW` 已含 `资讯`/`热点`，而 gyread 的栏目名（`前线`/`开源前线`/`创造`/
  `视觉`/`投资与资金流向`/`声音`/`小结`）**全是域级泛称**，天然被短路为 `null`，
  由关键词裁决 —— 这正好符合该站「栏目名不是单条定性」的实情，不需要新增弱桶。

### 四、`scorer.js` 渠道权重

`CHANNEL_WEIGHTS.gyread = 0.7`。理由：日报不是热度榜，条目热度不可比，
必须显著低于国民级综合榜（1.0），避免它挤占真实热搜位次；但也不能太低（< 0.5），
否则补拉进来的高质量 AI 条目会在截断时被全部挤掉，失去接入意义。

### 五、locales zh/en 成对

`hotTopics.channels.gyread` 与 `gyread-ai` 两条文案键（zh/en 成对）。
既有回归锁 `hot-topics-new-sources.test.js` 已断言「CHANNEL_CONFIGS 与 CATEGORY_BOOSTS
的全部 source id 在 zh/en 都有键」，新增 id 自动被锁住。

## 不做（明确排除）

1. **不做全文抓取**：只取 `search-index.json` 的标题+摘要（各 ≤110 字），不抓日报全文。
   理由：全文 5000 字/期，对选题列表无增益，且放大对站点的抓取面。
2. **不抓英文版**：`/news/en/` 结构对称但内容同源，中文版已够用。
3. **不抓周报与专题**：`ai-weekly-*.html` / `special/*.html` 属二次加工，且更新不连续。
4. **不接 sitemap.xml 作为数据源**：它只提供 URL 列表，信息量低于 search-index.json。
5. **不改 robots 声明的语义**：接入用途是「检索/引用」（用户点回原文），不是训练语料。
   这一点写进设计文档，并在代码注释里标明，避免后续被误用为语料来源。
6. **不做来源可信度自动评分**：调研发现的「出处张冠李戴」问题（如 Swin-Transformer 仓库
   被当作投资事件出处）需要人工或 LLM 判断，本期只把**原文链接透出**让用户自行判断，
   不引入自动判废逻辑（无依据的复杂度）。
7. **不动主渠道清单**：gyread 不进 `CHANNEL_CONFIGS`，`CHANNEL_CONFIGS` 仍是 10 项
   （既有契约测试 `toHaveLength(10)` 继续成立）。
