# hot-topics-gyread-ai-source Specification

## Purpose

定义把 `gyread.com/news/`（AI 情报日报）接入「热门选题」AI 分类信源的契约。本规格锁的是
**行为判据**：该站点以什么数据面解析、解析产物的字段映射、日报版式两代结构的兼容要求、
补拉条目的原文链接增强语义、配额与合规边界，以及它为什么 MUST NOT 作为主渠道。

## Requirements

### Requirement: gyread 数据面与解析产物

系统 SHALL 通过 `https://gyread.com/news/search-index.json` 获取 gyread 的索引数据
（字段 `generated` / `pages` / `count` / `items[]`，每条 item 含 `u` 相对 URL、`d` 日期、
`c` 栏目、`t` 标题、`s` 摘要、`g` 标签），并由 `parseGyreadIndex` 解析为统一条目结构
`{channel, rank, topic, hotValue, url, rawCategory}`。

`parseGyreadIndex` SHALL 支持按调用方传入的日期过滤（单日或最近 N 天），因为全量索引
（实测 1421 条）远超单轮候选上限。`hotValue` SHALL 为 `null`（该站点不提供热度值）。

#### Scenario: 字段映射
- **WHEN** 传入含 3 条 items 的索引 JSON，其中第 2 条日期不在过滤窗口内
- **THEN** 返回 2 条；每条 `channel === 'gyread'`、`topic` 取自 `t`、`rawCategory` 取自 `c`、
  `hotValue === null`、`url` 由 `u` 拼成绝对地址

#### Scenario: 日期过滤
- **WHEN** 以 `{ date: '2026-10-14' }` 调用
- **THEN** 仅返回 `d === '2026-10-14'` 的条目；传入 `{ days: 3 }` 时返回最近 3 个日期的条目

#### Scenario: 空结构与畸形输入
- **WHEN** 传入 `null` / `{}` / `{ items: [] }` / `items` 非数组
- **THEN** 返回空数组，不抛错（由 service 层按既有合同判失败）

### Requirement: 单期日报的原文链接抽取（双版式兼容）

`parseGyreadEdition` SHALL 从单期日报 HTML 中抽取每条选题的标题、来源标注与**原文链接**，
并 MUST 同时兼容两代版式：

- 旧版（实测 ≤ 2026-10-16）：`<div class="dateline">` 承载「媒体 · 话题 · 栏目属性」，
  出处为 `<div class="src-line">出处：<a href="...">媒体 ↗</a></div>`（单链接）。
- 新版（实测 2026-10-17 起）：`<div class="item-meta">` 内含 `meta-source` 与 `meta-topic`，
  出处为 `<div class="src-line"><a href="...">A ↗</a> · <a href="...">B ↗</a></div>`（**多链接**）。

新版多出处 SHALL 以数组返回；解析失败或缺失 MUST NOT 抛错（fail-open：只丢原文链接，不丢条目）。

#### Scenario: 旧版单链接
- **WHEN** 传入含 `dateline` 与「出处：」前缀 `src-line` 的 HTML
- **THEN** 正确抽出标题、来源文本与单个原文 URL

#### Scenario: 新版多链接
- **WHEN** 传入含 `item-meta`（`meta-source` + `meta-topic`）与多 `<a>` 的 `src-line`
- **THEN** 正确抽出标题、来源文本，且原文链接为**长度 ≥ 2 的数组**

#### Scenario: 两版混存
- **WHEN** 同一 HTML 内既有旧版结构条目又有新版结构条目
- **THEN** 两类条目均被抽出，各自按对应版式取链接

#### Scenario: 无出处或畸形 HTML
- **WHEN** HTML 无 `src-line`，或为 `null` / 空串 / 不含任何 `item-title`
- **THEN** 返回空数组或不含链接的条目，不抛错

### Requirement: gyread 作为 AI 分类定向补拉源

`CATEGORY_BOOSTS.ai.sources` SHALL 包含 gyread 源，其 `id` / `channel` / `board` /
`boostCategory` / `parser` / `onlyCategory` / `throttleKey` / `intervalMinutes` /
`riskLevel` 分别为 `gyread-ai` / `gyread` / `ai` / `ai` / `gyread_index` / `ai` /
`gyread-index` / `>= 30` / `medium`。该源 SHALL NOT 出现在 `CHANNEL_CONFIGS` 中。

理由（MUST NOT 作为主渠道的判据）：gyread 是**每日编辑精选的日报**而非热度榜单 ——
无 `hotValue`、榜单序是编辑意志而非热度序、条目不会跨榜同现。把它当主渠道会污染
`scorer` 的渠道内热度归一、名次兜底与 `sourceBonus`（全民热点信号）。

#### Scenario: 补拉源配置完整
- **WHEN** 读取 `CATEGORY_BOOSTS.ai.sources`
- **THEN** 存在 `id === 'gyread-ai'` 的源，上述各字段符合要求，且 `sources.length >= 2`
  （与既有 `ithome-ai` 互补）

#### Scenario: 不进主渠道
- **WHEN** 读取 `CHANNEL_CONFIGS`
- **THEN** 长度为 10（既有契约），且 id 集合不含 `gyread`

#### Scenario: AI 补拉条目走分类器
- **WHEN** gyread 补拉源返回的条目被 `onlyCategory: 'ai'` 筛选
- **THEN** 仅分类器判定为 `ai` 的条目进入结果；条目 `id` 以 `gyread:ai:` 开头

### Requirement: 原文链接增强（enrichWithEdition）

补拉源可声明 `enrichWithEdition: true`。此时 SHALL 在索引解析成功后，对每个条目按其
日报页地址抓取单期 HTML 并调用 `parseGyreadEdition` 补齐原文链接，写入条目的
`sourceUrls` 数组与 `entryUrl`（当日日报入口）。

该增强 MUST fail-open：抓取或解析失败时仅丢失原文链接，MUST NOT 丢失条目本身，
MUST NOT 让整个补拉渠道记失败。增强抓取的条目数 SHALL 有显式上限（默认 10）。

#### Scenario: 增强成功
- **WHEN** 补拉源带 `enrichWithEdition: true` 且 edition 页可抓可取
- **THEN** 条目携带 `sourceUrls`（数组，长度 ≥ 1）与 `entryUrl`

#### Scenario: 增强失败不扩散
- **WHEN** edition 页抓取抛错或返回空
- **THEN** 条目仍存在且无 `sourceUrls`，补拉结果 `items` 非空、`error` 为空

#### Scenario: 条目数上限
- **WHEN** 索引返回超过上限的条目
- **THEN** 仅前 N 条（默认 10）执行增强抓取，其余条目不带 `sourceUrls`

### Requirement: 渠道权重与配额

`CHANNEL_WEIGHTS` SHALL 为 `gyread` 声明权重，取值 SHALL 显著低于国民级综合榜（1.0）
且不低于 0.5 —— 前者因为日报的热度不可比，后者因为补拉进来的高质量 AI 条目
不应在统一热度截断时被全部挤掉。gyread 源 SHALL 声明 `throttleKey` 使同一端点共享配额。

#### Scenario: 权重区间
- **WHEN** 读取 `CHANNEL_WEIGHTS.gyread`
- **THEN** 值在 `[0.5, 0.85]` 区间内，且小于 `weibo` / `baidu` / `douyin` / `toutiao` / `zhihu` 的 1.0

#### Scenario: 配额键共享
- **WHEN** 检查 gyread 补拉源与任何未来 gyread 端点
- **THEN** `quotaKeyOf` 得到同一键（`gyread-index`），不因身份不同而绕过限流

### Requirement: 合规边界

gyread 的接入用途 SHALL 限定为「检索/引用」：条目携带原文链接供用户点回一手信息，
MUST NOT 把该站点内容用作模型训练语料或语料构建输入。代码与文档 SHALL 明示此边界。

依据（站点自身声明）：`robots.txt` 对检索类 UA（`OAI-SearchBot` / `ChatGPT-User` /
`PerplexityBot` 等）放行 `/news/`，对训练类 UA（`GPTBot` / `ClaudeBot` / `CCBot` /
`Google-Extended` 等）全站 `Disallow`；HTTP 响应头带 `x-robots-tag: noai, noimageai`；
`Content-Signal: search=yes, ai-input=yes, ai-train=no`。

#### Scenario: 用途声明存在
- **WHEN** 检索代码库中 gyread 相关实现
- **THEN** 注释与设计文档均含「检索/引用而非训练语料」的明示边界

### Requirement: 分类器 AI 词表扩充

分类器的 `ai` 关键词表 SHALL 扩充跨语料通用的 AI 术语（如 `智能体经济` / `开源权重` /
`多智能体` / `世界模型` / `强化学习` / `蒸馏` / `对齐` / `幻觉` / `端侧` / `上下文`），
MUST NOT 收录仅对单一站点成立的私活用語（如 `日报` / `情报` / `信号` 这类无判别力的词）。

#### Scenario: 新增正例
- **WHEN** 分别分类 `多智能体协作框架开源` / `强化学习训练成本下降` / `模型对齐问题引热议` /
  `世界模型空间推理突破` / `端侧推理速度提升` / `开源权重模型追平闭源`
- **THEN** 依次为 `ai` / `ai` / `ai` / `ai` / `ai` / `ai`

#### Scenario: 不为单站加私活词
- **WHEN** 分类 `今日情报日报发布`（仅含站点自有用语、无 AI 术语）
- **THEN** 结果不得为 `ai`

#### Scenario: 既有回归不破
- **WHEN** 运行既有分类器测试（32 例）
- **THEN** 全部通过（词表扩充不得改变已锁定的判定）

### Requirement: 渠道文案成对

新增的渠道 id（`gyread` 与 `gyread-ai`）SHALL 在 `src/locales/hot-topics/zh.js` 与
`en.js` 的 `channels` 下均有文案键（成对），避免界面渲染出原始 key。

#### Scenario: zh/en 键齐全
- **WHEN** 汇总 `CHANNEL_CONFIGS` 与 `CATEGORY_BOOSTS` 的全部 source id
- **THEN** 每个 id 在 zh 与 en 的 `hotTopics.channels` 中都存在对应键
