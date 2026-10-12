# hot-topics-multi-source Specification

## Purpose

定义「热门选题」多平台数据源接入、分类枚举（含 AI）与归类判定的契约。本规格锁的是**行为判据**：
哪些平台以什么端点接入、抓取失败的语义边界、分类结果的置信度分级与阈值、
以及分类枚举在五处跨端实现之间必须保持一致。

## Requirements

### Requirement: 多平台数据源接入清单

热门选题聚合 SHALL 至少覆盖以下主渠道（`channel id` 为稳定契约，用于缓存与渠道筛选）：
`zhihu` / `toutiao` / `tencent` / `bilibili` / `douyin` / `xiaohongshu` / `ifeng` / `baidu` / `weibo` / `tophub`。
所有主渠道端点在接入时 SHALL 满足「无需登录态」；需要登录态的端点（如头条号创作者平台）
MUST NOT 作为主渠道接入。每个渠道 SHALL 声明 `intervalMinutes >= 5` 与 `riskLevel`。

#### Scenario: 渠道清单完整性
- **WHEN** 读取 `CHANNEL_CONFIGS`
- **THEN** 恰好 10 项，且包含 `xiaohongshu` 与 `ifeng`；每项 `url` 以 `https://` 开头、`intervalMinutes >= 5`

#### Scenario: 需要登录态的平台不接入
- **WHEN** 评估「头条号创作者平台热点」是否接入
- **THEN** 不接入（无 cookie 下 `mp.toutiao.com` 热点入口返回 502，`/activity/hot-selection` 另有
  `tag_info.hotboard_invitation` 权限门槛；GitHub 代码搜索 0 命中无参考实现；无法证实其与今日头条热榜同源）

### Requirement: 抖音三个同源端点的顺序降级

抖音渠道 SHALL 以 `www.douyin.com/aweme/v1/web/hot/search/list/` 为主端点（必须同时带浏览器 UA 与
`Referer: https://www.douyin.com/`），并在主端点失败或解析出空列表时，按 `config.fallbacks` 顺序降级到
`aweme-lq.snssdk.com/aweme/v1/hot/search/list/` 与 `www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/`。
三个端点解析结果 SHALL 归入同一个 `channel id = douyin`。同源端点 MUST NOT 作为并列渠道并发抓取。

#### Scenario: 主端点返回空列表时降级
- **WHEN** 主端点返回 `{"data":{"word_list":[]}}`
- **THEN** 继续尝试 fallback #1；若其返回条目，则结果 `viaFallback === 1` 且条目 `channel === 'douyin'`

#### Scenario: 同源端点不得作为独立渠道
- **WHEN** 检查 `CHANNEL_CONFIGS` 的 id 集合
- **THEN** 不包含 `douyin_app` / `douyin_ies`（否则同源条目会被算成 `sourceCount >= 2`，
  污染 scorer 的 `sourceBonus`「多榜同现」信号）

#### Scenario: 三端点共用解析器
- **WHEN** 传入 web/snssdk 形态（`data.word_list` + `data.trending_list`）或 iesdouyin 形态（顶层 `word_list`）
- **THEN** `parseDouyin` 均返回统一结构 `{channel, rank, topic, hotValue, url, rawCategory}`；
  `rank` 优先取 `position`、`trending_list` 与主榜按 `topic` 去重并标 `rawCategory='上升热点'`

### Requirement: 小红书渠道固定请求头

小红书渠道 SHALL 使用 `edith.xiaohongshu.com/api/sns/v1/search/hot_list`，并要求
`User-Agent` / `referer` / `xy-direction` / `shield` / `xy-platform-info` / `xy-common-params`
六项固定头全部存在（缺任一即 HTTP 406）。`shield` 为静态常量，SHALL 集中定义以便人工替换。

#### Scenario: 五件套齐全
- **WHEN** 检查 `xiaohongshu` 渠道配置
- **THEN** 上述六项头部均非空，`riskLevel === 'high'`

#### Scenario: 406 是固定头失效的特征信号
- **WHEN** 抓取抛出的错误信息包含 `406`
- **THEN** 记录一条**点明 `shield` 已失效、需人工更新静态常量**的 warn 日志（不得与普通网络失败混排）

### Requirement: 凤凰网渠道双出口

凤凰网渠道 SHALL 以 `ne883dbn.ifeng.com/hotspotlist?page=1&gv=7.9.1&av=7.9.1` 为主端点（JSON，
条目链接在 `link.url`，**顶层没有 `url`**），并以 `i.ifeng.com` 首页内联
`allData.hotRankData.data`（条目链接在顶层 `url`）作为顺序降级兜底。

#### Scenario: 内联出口必须做花括号配对
- **WHEN** 解析内联 HTML 中的 `allData`（内嵌多行 JSON，字符串里可能含 `}`）
- **THEN** `extractIfengAllData` 通过配对扫描正确取出完整对象；使用惰性正则会截断即为缺陷

#### Scenario: 两个出口不共用解析器
- **WHEN** 检查 `ifeng` 的 fallback 配置
- **THEN** 兜底条目显式声明 `parser: 'ifeng_inline'`（字段名与主端点不同，共用解析器会静默产出空列表）

### Requirement: 抓取失败的语义边界

渠道抓取 SHALL 把「HTTP 非 2xx / 超时 / JSON 解析失败 / **解析出 0 条**」一律视为失败：
先尝试 fallback，全部失败后 `recordFailure` 并让该渠道在 `channelStats` 中呈现 `ok=false` 与 `error`。
0 条 MUST NOT 记为成功。

#### Scenario: 空列表记失败
- **WHEN** 所有尝试都返回 0 条
- **THEN** 返回 `items === null` 且 `error` 含 `empty list`；熔断器失败计数 +1

#### Scenario: fallback 恢复不记失败
- **WHEN** 主端点异常但 fallback 成功返回条目
- **THEN** `recordSuccess`，该渠道失败计数归零

### Requirement: 分类枚举（11 类）与跨端一致性

分类枚举 SHALL 为 `general, society, finance, tech, ai, entertainment, sports, emotion, education, health, international`
（11 类，`ai` 紧随 `tech`）。以下五处的键名与顺序 MUST 完全一致：
`electron/services/hot-topics/classifier.js` 的 `CATEGORY_KEYS`、
`electron/services/content-categories.js`、`src/features/content/content-categories.js`、
`src/views/HotTopics.vue` 的 `CATEGORY_KEYS`、`ops-center/backend/services/content_category_service.py` 的 `CATALOG`。

#### Scenario: 跨端 key 与顺序一致
- **WHEN** 对比渲染层内置类别 key 数组与分类器 `CATEGORY_KEYS`
- **THEN** 两者 `toEqual`（长度 11、顺序一致）

#### Scenario: 运营端目录补齐
- **WHEN** 调用运营端类别列表接口
- **THEN** 前 11 项 key 顺序为上述枚举，且 `preset_keys` 长度为 11

### Requirement: AI 与科技的分类边界

`ai` SHALL 覆盖「模型/算法/智能能力本身」：大模型、大语言模型、生成式、AIGC、AGI、多模态、
深度学习、神经网络、机器学习、智能体、算力/智算、AI 芯片与应用、提示词、主流模型与厂商专名。
`tech` SHALL 覆盖「硬件/基础设施/工程实体」：非 AI 语境的芯片/半导体/光刻机、操作系统/数据库/云计算、
消费电子/数码、通信（5G/6G）、航天、新能源/电池/光伏、机器人硬件、量子计算、开源。
两者同时命中时 SHALL 由打分裁决，不允许「科技栏目的原生分类」覆盖关键词证据。

#### Scenario: AI 主题判 ai
- **WHEN** 分类 `国产大模型发布新版本`
- **THEN** 结果为 `ai`

#### Scenario: 纯硬件判 tech
- **WHEN** 分类 `国产芯片半导体产业链突破`
- **THEN** 结果为 `tech`

#### Scenario: AI 原生分类直挂
- **WHEN** 渠道下发的原生分类为 `AI` 或 `人工智能`
- **THEN** 结果为 `ai`

### Requirement: 分类置信度分级

原生分类 SHALL 分三档：**可信原生**（渠道明确声明内容域）、**宽泛桶**（一个桶混装多个内容域）、
**域级泛称**（栏目名，不是单条定性）。域级泛称 SHALL NOT 参与主标签裁决与零信号兜底。
宽泛桶 SHALL 仅在关键词零命中时兜底。主标签裁决顺序 SHALL 为：
可信原生 → 关键词最高分 → 宽泛桶 → `general`。

域级泛称清单 SHALL 至少包含：`科技` / `互联网` / `科学科普` / `知识` / `资讯` / `热点`。

#### Scenario: 域级泛称不提供原生信息
- **WHEN** 分类 `rawCategory='科技'` + `今晚吃什么`
- **THEN** 结果为 `general`（不得为 `tech`）

#### Scenario: 域级泛称有关键词证据时由关键词裁决
- **WHEN** 分类 `rawCategory='科技'` + `芯片产业新突破`
- **THEN** 结果为 `tech`

#### Scenario: 宽泛桶不覆盖关键词
- **WHEN** 分类 `rawCategory='知识'`（B站）+ `央行降息利好股市`
- **THEN** 结果为 `finance`

#### Scenario: 宽泛桶在零信号时仍可兜底
- **WHEN** 分类 `rawCategory='知识'`（B站）+ 无任何关键词信号
- **THEN** 结果为 `general`

#### Scenario: 「汽车」不是科技
- **WHEN** 分类 `rawCategory='汽车'` + 无关键词信号
- **THEN** 结果为 `general`

### Requirement: 关键词打分口径

关键词 SHALL 分 `strong`（权重 = 词长 × 2）与 `weak`（权重 = 词长）两档；
分类得分低于 `MIN_SCORE = 3` SHALL 视为无判别力信号并丢弃。纯拉丁/数字关键词 SHALL 做词边界匹配
（前后不得为 `[A-Za-z0-9]`），中文关键词 SHALL 走子串匹配。匹配前 SHALL 做全角 ASCII → 半角归一。
关键词表 MUST NOT 出现长度为 1 的中文裸字。

#### Scenario: 拉丁词边界
- **WHEN** 分类 `Air Jordan 复刻发售` 或 `He said nothing about the market`
- **THEN** 结果不得为 `ai`

#### Scenario: 单个双字弱词不足以成类
- **WHEN** 分类 `消费`
- **THEN** 结果为 `general`（得分 2 < 3）；而 `消费 投资` 可判 `finance`

#### Scenario: 全角归一
- **WHEN** 分类 `ＡＩ 应用落地加速`
- **THEN** 结果为 `ai`

#### Scenario: 禁裸单字
- **WHEN** 遍历全部关键词规则
- **THEN** 不存在长度为 1 的中文关键词（拉丁词亦要求长度 ≥ 2）

### Requirement: general 语义

`general` SHALL 仅表示「无判别力信号」。一旦条目被判定出任何真实分类，
其 `categories` MUST NOT 再包含 `general`。

#### Scenario: general 不与真实分类混排
- **WHEN** 分类 `rawCategory='知识'` + `央行降息利好股市`
- **THEN** `categories` 不含 `general`

### Requirement: 分类判定的稳定性抽查

分类器 SHALL 对常见品类保持稳定判定（不得退化为 `general` 黑洞）。

#### Scenario: 八类正例
- **WHEN** 分别分类 `A股大涨沪指重返3000点` / `国足世界杯预选赛` / `法院一审判决被告赔偿` /
  `卫健委通报最新疫情数据` / `高考录取分数线公布` / `明星演唱会门票秒空` /
  `恋爱婚姻情感话题引热议` / `完全无关文本`
- **THEN** 依次为 `finance` / `sports` / `society` / `health` / `education` / `entertainment` / `emotion` / `general`

### Requirement: 定向补拉条目的分类归属

定向补拉（`CATEGORY_BOOSTS`）条目 SHALL 先经分类器判定；分类器给出明确分类时 SHALL 以分类器为准，
仅在分类器给出 `general` 时才使用 `source.boostCategory` 兜底。补拉条目 `id` SHALL 含 `board` 段以避免与主榜撞号。
`onlyCategory` SHALL 使用分类器本身做筛选（不得引入第二份关键词表）。
用户显式请求补拉而该分类未配置源时 SHALL 出声告警，不得静默无反应。

#### Scenario: 补拉不硬挂分类
- **WHEN** 一个 `boostCategory='tech'` 的补拉源返回原生分类为「财经」的条目
- **THEN** 该条目主分类为 `finance`，`categories` 不含 `tech`

#### Scenario: 零信号时才兜底
- **WHEN** 补拉源返回的条目无任何分类信号
- **THEN** 该条目主分类为 `boostCategory`

#### Scenario: AI 补拉可用
- **WHEN** 检查 `CATEGORY_BOOSTS.ai`
- **THEN** 存在且 `sources` 非空、每个源的 `boostCategory === 'ai'`、`board === 'ai'`

#### Scenario: onlyCategory 用分类器筛
- **WHEN** AI 补拉源收到的 RSS 同时含 AI 题与非 AI 题
- **THEN** 仅 AI 题进入结果，且 id 以 `<channel>:ai:` 开头

#### Scenario: 无源出声
- **WHEN** 用户显式请求补拉某分类，而该分类 `sources` 为空
- **THEN** 记录一条点明「no boost source configured for category」的 warn
