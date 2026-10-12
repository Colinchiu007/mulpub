# 调研：热门选题分类标准分析与准确性优化

- 日期：2026-10-12
- 调研人：技术调研员（独立 worktree：`D:/Data/projects/mp-worktrees/mp-hot-topics-multi-source`，分支 `hot-topics-multi-source`）
- 唯一写入文件：本文件

## 0. 取证基线与重要提示（先读）

本文件所有「现状」结论均来自真实读取的代码，引用格式为 `文件:行号`。**调研期间该 worktree 的分类相关代码正被并发修改**，因此先把基线钉死；若读到的行号与现场不符，请以本表 SHA 为准重新对账。

| 文件 | SHA-256（前 10） | 时间 | 状态 |
|---|---|---|---|
| `apps/desktop/electron/services/hot-topics/classifier.js` | `735002AE63` | 07:53:19 | 已被并发改写为 **v3（11 类，含 `ai`）** |
| `apps/desktop/electron/services/hot-topics/classifier.test.js` | `BD1F2FE3D6` | 07:52:58 | 新增，当前**运行失败**（见 §2.9） |
| `apps/desktop/electron/services/hot-topics-service.js` | `106F1CCC09` | 07:48:17 | **v2 形态：无 `ai` 供给/兜底** |
| `apps/desktop/electron/services/hot-topics/llm-classifier.js` | `CCE970E0E0` | 07:48:17 | v2，未按 11 类做任何增强 |
| `apps/desktop/electron/services/hot-topics/channels.js` | `7AC4B36EEB` | 07:48:17 | 未变 |
| `apps/desktop/electron/services/hot-topics/scorer.js` | `ECD07F0D93` | 07:48:17 | 与分类无关（纯热度评分） |
| `apps/desktop/src/views/HotTopics.vue` | `72FCEF6ECB` | 07:53:20 | 已含 `ai`（含 UI 侧 `CATEGORY_KEYS`） |
| `apps/desktop/electron/services/content-categories.js` | `6F1C369838` | 07:53:20 | 已含 `ai`（11 项） |
| `apps/desktop/src/features/content/content-categories.js` | `58DEE90335` | 07:53:20 | 已含 `ai` |
| `apps/desktop/src/locales/hot-topics/zh.js` / `en.js` | `27EDCE7D55` / `80F3E5DA39` | 07:53:26 | 已含 `ai` |
| `ops-center/backend/services/content_category_service.py` | `8E37586D4E` | 07:53:30 | 已含 `ai`（11 项） |

> ⚠️ **对任务的直接影响**：任务书假设当前是「10 类、无 AI 分类、v2 裸子串匹配」的形态。**实际现场已经推进到 v3**——任务书 §第一步要求回答的「为什么科技类混入不沾边内容」中，**最核心的三条机制级根因已经被现场代码修掉了**（原生宽泛桶整批错配、`'AI'` 裸子串误命中、`score += kw.length` 无强弱/无阈值）。
>
> 因此本报告如实分两栏写：**§一/§二 同时给出「v2 原机制（任务书所述现象）」与「v3 现场现状（已修/未修）」**，避免把已修的问题当未修来提方案；**§四/§五/§六 只针对 v3 仍然存在的缺口**给方案。
>
> 另：`classifier.js` 头部声明的「跨端契约」要求 5 处分类目录严格一致（`classifier.js:24-27`）。截至上表时间，除 `hot-topics-service.js`（供给/兜底侧）与 `features/content/content-categories.js:2` 的注释仍写「内置 10 类」外，其余**已同步为 11 类**。

---

## 0.1 增补：调研期间现场推进（07:56 复核）

本节是**在报告主体写完之后**的复核结果（07:56:12，`hot-topics-service.js` = `4A41E316E6`）。主体 §一/§二 的代码引用锚定 §0 快照；**凡与本节冲突处，以本节为准**。

**已被并发修复（从方案清单中移除）**

| 原编号 | 问题 | 07:56 现场证据 |
|---|---|---|
| B2 | boost 补拉硬挂 `boostCategory` | `hot-topics-service.js:293` 已 `classifyTopicMulti(x.rawCategory, x.channel, x.topic)`；`:295` 起仅在分类器无信号时用 `boostCategory` 兜底；`:301-302` 由 `categories` 决定主分类。**§六 P0-2 已由现场完成，无需重复** |
| B1（部分） | 可信原生无条件压过关键词 | `classifier.js` 已引入 `RAW_CATEGORY_WEAK_MAP` 与弱标签让位（§2.1 实测通过）。**残留仅剩「可信原生 + 关键词零命中」这一格**（`'科技'+«今晚吃什么»`），见下方「仍然存在」 |
| — | 11 类跨端契约 | `content-categories.js`（桌面主进程）、`features/content/content-categories.js`（渲染）、`hot-topics/zh.js` / `en.js`、`ops-center .../content_category_service.py:44-56` **均已含 `ai`**（§0 表中后 5 行即为此） |

**仍然存在（方案继续有效）**

| 原编号 | 问题 | 07:56 现场证据 |
|---|---|---|
| **B4** | `ai` 无补拉源 | `CATEGORY_BOOSTS` 仍无 `ai` 项（检索 `^\s*ai:\s*\{` 无命中）→ **§六 P0-3 仍然必要**。这是当前最明确的 v3 遗留缺陷：`ai` chip 为空时点「补拉」`boostSources` 为空、静默无反应（`hot-topics-service.js:446` 循环取不到 `ai`） |
| **B5** | LLM 兜底只处理 `general` | `hot-topics-service.js:390` 仍是 `if (t.category !== 'general') continue` → **§六 P1-3 仍然必要且最关键**。注意 B2 已修意味着 boost 已不再制造 `tech` 错配，但 B1 残留那一格（`'科技'`+零命中→`tech`）仍会产生错判且**不进 LLM** |
| B6 | LLM 无置信度/无二次裁决/无失败记忆 | `llm-classifier.js` 未变（`CCE970E0E0`）→ §六 P1-4 / P1-5 有效 |
| B3（部分） | 去重合并只升不降 | `hot-topics-service.js:345` 仍是 `if (target.category === 'general' && ...)` 升级逻辑 → §六 P0-2 的互斥检查部分仍待做 |
| B7/B8/B9/B10/B11/B12/B13 | 词表覆盖、阈值、主标签顺序、`general` 语义、UI 口径、拉丁边界 | 均未见改动 → §六 P0-1 / P0-4 / P1-1 / P1-2 / P2-1 / P2-2 有效 |

**新增观察（07:56）**：现场新增 `apps/desktop/electron/services/hot-topics-boost-classify.test.js`（未跟踪），说明 B2 的修复已配回归用例；`classifier.test.js` 与 `content-categories.test.js`、`hot-topics-service.test.js` 均处于已修改状态。§2.9 记录的 `classifier.test.js` 运行失败需在合并前复核（可能已被后续改动修复）。

---

## 一、现状（分类标准与判定逻辑）

### 1.1 分类集合（11 类）

`classifier.js:34-37`：

```js
const CATEGORY_KEYS = [
  'general', 'society', 'finance', 'tech', 'ai', 'entertainment',
  'sports', 'emotion', 'education', 'health', 'international',
]
```

注释明确 `classifier.js:32`：「ai 紧随 tech：AI 是从科技里切出来的子域，二者在 UI 上相邻便于对照」。**数组顺序即 UI 默认排序**，且是跨端契约（`classifier.js:24-27`）。

UI 侧另有一份同构常量 `HotTopics.vue:344`，分类 chip 的真实来源却是运营中心下发的 `contentCategories`（`HotTopics.vue:296`、`353-357`），本地常量只是回退。

### 1.2 判定优先级与判定顺序（逐条）

入口只有一个：`classifyTopicMulti(rawCategory, channel, topicText)`（`classifier.js:367`）。单字符串契约 `classifyTopic` 已退化为其薄封装（`classifier.js:349`），**不再有独立的第二条判定路径**。

真实执行顺序如下（`classifier.js:368-391`）：

**第 0 步：并行准备两份证据**（互不短路）

1. `native = _mapNative(rawCategory, channel)` —— 渠道原生分类映射，返回 `{ category, weak }` 或 `null`；
2. `hits = _scoreKeywords(topicText)` —— 关键词打分，已按分数降序。

**第 1 步：`_mapNative` 三级查表**（`classifier.js:328-339`）

按以下**固定顺序**短路返回，`weak` 标记决定它后面还能不能当主标签：

| 顺序 | 表 | 行号 | `weak` | 语义 |
|---|---|---|---|---|
| 1 | `RAW_CATEGORY_MAP[channel][key]` | `classifier.js:333` | `false` | **可信原生**：渠道明确声明领域 |
| 2 | `GENERIC_RAW_MAP[key]` | `classifier.js:334` | `false` | 通用中文分类名，全渠道生效 |
| 3 | `GENERIC_RAW_MAP[lower]` | `classifier.js:335` | `false` | 同上，兜小写（如 `'ai'`） |
| 4 | `RAW_CATEGORY_WEAK_MAP[channel][key]` | `classifier.js:337-338` | **`true`** | **宽泛桶**：只说明「分区大概聊什么」 |

注意：`key` 是 `rawCategory.trim()`（**保留大小写**，`classifier.js:329`），`lower` 才小写；可信表与通用表的首次查询都用原样 `key`，因此「科技」「财经」等中文命中不受影响，而 `'AI'` 这类拉丁值靠第 3 级 `lower` 兜住。

**第 2 步：主标签三选一**（`classifier.js:375-381`）

| 优先级 | 条件 | 结果 | 行号 |
|---|---|---|---|
| ① 最高 | `native && !native.weak` | 主标签 = 可信原生分类 | `375-376` |
| ② 次之 | 否则 `hits.length > 0` | 主标签 = 关键词最高分 | `377-378` |
| ③ 兜底 | 否则 `native`（必为 weak） | 主标签 = 宽泛桶 | `379-380` |
| ④ 最终 | 三者皆无 | `general` | `389` |

**关键语义**：宽泛桶（weak）**只在关键词零命中时**才生效；只要关键词有任何 ≥ `MIN_SCORE` 的信号，文本证据一律压过宽泛桶。

**第 3 步：多标签拼装**（`classifier.js:383-387`）

先 push 主标签，再把 `hits` 里未出现过的分类按分数降序补入，`slice(0, 3)` 封顶。**主标签恒在首位**（`classifier.js:389` 取 `finalCats[0]`）；全空时返回 `['general']`。

即：**单标签主分类 + 最多 2 个次标签 = 最多 3 标签**。

### 1.3 关键词打分口径（`classifier.js:304-319`）

```
每分类得分 = Σ(strong 命中词长 × STRONG_MULT) + Σ(weak 命中词长)
STRONG_MULT = 2                          // classifier.js:257
MIN_SCORE   = 3                          // classifier.js:263，低于此分整类丢弃
命中判定：拉丁/数字词走词边界，中文词走子串        // classifier.js:294-295
排序：分数降序；并列保持 KEYWORD_RULES 声明顺序（V8 稳定排序）  // classifier.js:317
```

- **强弱分层**（`classifier.js:119-123` 注释）：`strong` = 分类名本身与专有术语；`weak` = 泛化词。双字强词 = 4 分，双字弱词 = 2 分；`MIN_SCORE = 3` 的确切语义是「**单个双字弱词不足以成类**」（`classifier.js:259-262`）。
- **词边界只对纯拉丁/数字词生效**（`LATIN_ONLY_RE = /^[A-Za-z0-9]+$/`，`classifier.js:265`；`_matchesLatin`，`classifier.js:274-285`）：要求前后字符不得是 `[A-Za-z0-9]`。含中文的关键词（如 `'AI芯片'`、`'新能源'`）走 `rawText.includes(kw)`（`classifier.js:295`）。
- **大小写**：`rawText` 原样用于中文子串匹配，`lowerText = rawText.toLowerCase()` 只供拉丁词匹配（`classifier.js:304-305`），所以 `'Claude'` 能命中 `'claude'`。

### 1.4 服务层如何调用分类（`hot-topics-service.js`）

**主链路**（`hot-topics-service.js:242-255`）：每个渠道抓取后 `slice(0, MAX_PER_CHANNEL=50)`（`:32`）逐条 `classifyTopicMulti(x.rawCategory, x.channel, x.topic)`，把 `category` + `categories` 一并写入条目。

**去重合并**（`:317-340`）：跨渠道按 `topic.trim()` 去重；命中已有条目时补 `mergedFrom`，并入标签（`:330-332`），并有一条**只升不降**的规则（`:333-335`）：

```js
if (target.category === 'general' && norm.category && norm.category !== 'general') {
  target.category = norm.category
}
```

**boost 补拉直挂分类**（`:286-296`）：

```js
category: source.boostCategory,          // :290  ← 无条件直挂，不经过分类器
categories: [source.boostCategory],      // :291
```

`boostCategory` 取值仅 `finance` / `tech` / `emotion` / `health`（`CATEGORY_BOOSTS`，`:63-81`），**没有 `ai`**。

**LLM 兜底**（`_applyLlmLabels`，`:372-410`）：只处理 `t.category === 'general'` 的条目（`:378`），单轮上限 `LLM_BATCH_LIMIT = 40`（`:34`、`:389`），落盘缓存 `hot_topics_llm_labels`（`:29`，上限 `LLM_LABELS_MAX = 500`，`:35`）。

**评分与截断**（`:494-503`）：`scoreTopics(...)` → `markTrend(...)` → `slice(0, MAX_TOPICS=400)`；**LLM 兜底在截断之后**（`:503` 先 slice，`:506` 才 `_applyLlmLabels`）。

`scorer.js` 是纯热度评分器（`scorer.js:3-21` 合同），**完全不参与分类**：`score` 只由渠道内热度归一、名次、渠道权重、多榜加成、时间衰减构成；`scorer.js:63` 的类型签名里出现 `categories` 只是类型注记，函数体未读取。

### 1.5 UI 侧的分类展示与过滤（`HotTopics.vue`）

| 行为 | 实现 | 行号 |
|---|---|---|
| 分类 chip 列表 | 来源 = 运营下发 `contentCategories`（读不到回退内置 11 类） | `353-357` |
| 计数 chip（「全部」不显示） | `data-testid="hot-topic-cat-count-<key>"` | `57` |
| 计数口径 | **多标签**：条目在每个 `categories` 成员下都 +1 | `366-370` |
| 过滤口径 | `topicCategories(x).includes(activeCategory)` | `378` |
| 条目标签展示 | `topicCategories(topic).slice(0, 2)` —— **只展示前 2 个** | `144` |
| 兼容旧缓存 | `categories[]` 优先，回退 `[category]` | `361-363` |
| 空分类判定与补拉入口 | `categoryEmpty` → `boostCurrentCategory()` | `373-374`、`508-511` |

标签文案解析链：`resolveCatLabel → categoryLabel(key, t)`（`HotTopics.vue:297`）→ 运营下发名优先 → 内置本地化名 → **最终回退 key 本身**（`useContentCategories.js:121-127`）。

### 1.6 `general` 的语义边界（任务书问题 2）

**结论：`general` 同时承担了两种语义，且代码里没有任何字段能把它们分开。**

从三处产生点看：

| 产生点 | 行号 | 实际语义 |
|---|---|---|
| 关键词零命中 → 主标签三选一全落空 | `classifier.js:389` | 「**未命中兜底**」 |
| 宽泛桶显式映射到 `general` | `classifier.js:90-105`（如 B站「知识」、头条「汽车」、微博「美食/时尚/美妆」） | 「**明确判定为泛资讯**」 |
| 渠道原生映射到 `general` | `classifier.js:111-115`（通用表 `'综合' → general`）、`RAW_CATEGORY_MAP` 内 `'旅游': 'general'` 等 | 「**渠道自称综合**」 |

三者最终都只写 `category = 'general'`，`categories = ['general']`。下游 `_applyLlmLabels` 以 `t.category !== 'general'` 作为「是否需要 LLM 分类」的唯一判据（`hot-topics-service.js:378`），意味着**「明确判定为泛资讯」的条目也会被送进 LLM 重新分类**——语义二、三被当成语义一处理，这是设计上的语义塌缩。

UI 上 `general` 与其它 10 类平级展示（`HotTopics.vue:353-357`），用户看到的是「综合」这一正常分类，无法区分「这条真的综合」还是「分类器没信号」。

### 1.7 判定逻辑流程图（v3 现状）

```
选题条目 { rawCategory, channel, topic }
        │
        ├──────────────────────────────┬──────────────────────────────┐
        ▼                              ▼
 _mapNative(rawCategory, channel)   _scoreKeywords(topic)
   ① RAW_CATEGORY_MAP (可信)           按 KEYWORD_RULES 逐类累加
   ② GENERIC_RAW_MAP[key]               strong: len×2 / weak: len
   ③ GENERIC_RAW_MAP[lower]             < MIN_SCORE(3) 整类丢弃
   ④ RAW_CATEGORY_WEAK_MAP (弱)         拉丁词走词边界 / 中文走子串
        │                                   │  分数降序
        └──────────────┬────────────────────┘
                       ▼
        主标签：可信原生 > 关键词最高分 > 弱原生 > general
                       │
                       ▼
        次标签：关键词降序补入，去重，总计 slice(0,3)
                       │
                       ▼
   渲染层：categories 前 2 个显示标签；过滤/计数按全部标签

  服务层旁路（不走分类器）：
   · boost 补拉条目 → category = boostCategory（硬挂，:290）
   · 去重合并 → general 只升不降（:333）
   · general 条目 → LLM 兜底（≤40/轮，:389）
```

---

## 二、根因分析：为什么科技类会混入不相关内容

任务书要求覆盖 5 类机制。以下**逐条给出 v2 原机制（任务书所述现象）与 v3 现场处置状态**，并附可复现的反例实测。

### 2.1 渠道原生映射的整批错配 —— v2 存在，v3 已修（同类风险仍在）

**v2 机制**：`RAW_CATEGORY_MAP` 单一映射表里，把**语义上混装多个内容域的「宽泛分区」**整体映射成某个具体分类。最典型的是 B站「知识」区被整批映射为 `tech`：

```js
// v2（已不存在于 735002AE63，见 git 历史与 PRD-HOT-TOPICS-CATEGORY-SUPPLY-2026-09-20.md §4.1）
bilibili: { '知识': 'tech', '科学科普': 'tech', '人文历史': 'general', ... }
```

`01-docs/PRD-HOT-TOPICS-CATEGORY-SUPPLY-2026-09-20.md:75` 记录的 v2 微博扩容里也含 `'汽车': 'tech'`。

**为什么必然会混入**：B站「知识」区实际混装历史/法律/职场/财经/科普；「科学科普」混装恐龙/地质/生物。把一个多域桶整体映射到 `tech`，则该桶内**每一条**都无条件成为 tech —— 无论标题写的是什么。这是「整批错配」，与标题内容无关，因此**关键词层无法自救**（v2 中原生映射优先级更高，直接 return）。

**v3 处置**：引入 `RAW_CATEGORY_WEAK_MAP`（`classifier.js:90-105`），把宽泛桶降级为 `weak: true`，且在主标签判定中**让位于关键词**（`classifier.js:375-380`）。`classifier.js:84-88` 注释点名了这四条实测错配源（B站「知识」、「科学科普」、「汽车」）。

**实测验证**（现场 `735002AE63` 行为）：

| 输入 | 结果 |
|---|---|
| `rawCategory='bilibili:知识'`，`«二战历史全解析»` | `general` ✅（v2 会是 `tech`） |
| `rawCategory='bilibili:科学科普'`，`«恐龙灭绝新证据»` | `general` ✅ |
| `rawCategory='bilibili:知识'`，`«个人养老金怎么算»` | `finance` ✅（让位给关键词） |

**仍存在的同类风险（v3 未覆盖）**：`RAW_CATEGORY_MAP` 内**仍有宽泛桶被当作可信表**，例如：

- `weibo: '互联网': 'tech'`（`classifier.js:60`）——「互联网」是行业泛称，可承载裁员、监管、平台经济等社会/财经议题；
- `weibo: '数码': 'tech'`（`:59`）、`bilibili: '数码': 'tech'`（`:72`）、`bilibili: '软件应用': 'tech'`（`:72`）——粒度尚可，但「数码」也常含消费/导购内容；
- `toutiao: '科技': 'tech'` / `tencent: '科技': 'tech'` / `bilibili: '科技': 'tech'`——**渠道自称「科技」时按可信处理**。

**实测反例（可复现）**：`rawCategory='科技'`、`channel='weibo'`、`«今晚吃什么»` → **`tech`**。原生可信分类无条件压过零关键词信号，一条与科技毫无关系的标题被硬判为 tech。这正是任务书所说「科技分类下出现与科技不沾边的内容」**在 v3 下仍然可达**的路径。

### 2.2 关键词子串误命中 —— v2 存在，v3 已修（含两处未修残留）

**v2 机制**：`classifier.js` v2 的打分实现是 `if (text.includes(kw)) score += kw.length`，对**所有**关键词一律裸子串匹配，且有两点叠加：

1. **拉丁词无词边界**：`'AI'`（v2 tech 词表第一个词）会命中 `AirPods` / `AIR` / `said` / `train` / `certain` 等；`'5G'`/`'6G'` 同理。
2. **大小写敏感**：v2 用 `String(topicText || '')` 原样（未 `toLowerCase()`）做 `includes`，因此 `'AI'` 只命中大写 `AI`，`'ai'`/`'Ai'` 漏命中。

**v3 处置**：`LATIN_ONLY_RE` + `_matchesLatin`（`classifier.js:265`、`274-285`）要求拉丁词前后不是 `[A-Za-z0-9]`；`_scoreKeywords` 同时准备 `lowerText`（`:305`）使拉丁词大小写不敏感。

**实测验证（现场）**：

| 输入 | v3 结果 | 说明 |
|---|---|---|
| `«AirPods Pro 3 开售首日售罄»` | `general` | 不再误命中 `AI` ✅ |
| `«AIR 系列新配色发布»` | `general` | ✅ |
| `«said goodbye to my hometown»` | `general` | 不再命中 `said` 里的 `ai` ✅ |
| `«Train derails in Ohio»` | `general` | 不再命中 `train` 里的 `ai` ✅ |
| `«aI»`（小写 a + 大写 I） | `ai` | 大小写不敏感生效 ✅ |
| `«说AI了»` | `ai` | 边界判定把 CJK 视为边界 ✅ |

**残留问题 A：CJK 关键词仍是裸子串，且中文无词边界**

`classifier.js:295` 对含中文的关键词仍走 `rawText.includes(kw)`。分词与词边界在中文里本身没有空白分隔，因此短中文词存在**真实**的误命中面。可复现反例：

- `tech.weak` 含 `'手机'`（`classifier.js:189`）→ 命中任何含「手机」的句子，包括 `«手机丢了怎么办 民警帮找回»`（社会/民生）、`«孩子沉迷手机 家长该怎么办»`（教育/情感）。
- `tech.strong` 含 `'电池'`（`:184`）→ `«电动车电池起火 消防提醒»` 更应是 `society`（事故）。
- `finance.strong` 含 `'上市'`（`:171`）→ 见 2.3 的实测反例，它把汽车发布误判成财经。
- `tech.strong` 含 `'新能源'`（`:184`）→ `«新能源车下乡补贴政策出台»` 被判 `tech`（实测），但该题的主导语义是**产业补贴政策**，`finance` 同样成立甚至更准。

**残留问题 B：词边界只处理拉丁字母数字，不处理全角与混排**

`LATIN_ONLY_RE = /^[A-Za-z0-9]+$/` 决定「走不走边界」，而边界字符集是 `[a-z0-9]`（`classifier.js:281`）。因此：

- `'5G'`/`'6G'` 是 `LATIN_ONLY_RE` 命中（字母数字）→ 走边界；但 `«5G-A 商用»` 中 `-` 是边界符，会命中；`«5GA»` 则不会——日常标题里 `5G` 常与中文紧贴（`«5G来了»`），此时 CJK 作边界，会命中。
- 全角字母（如 `ＡＩ`）不在 `[A-Za-z0-9]`，`lowerText` 后仍是全角，`_matchesLatin` 的 `indexOf('ai')` 找不到，**漏命中**。这是一个未修的小缺口。

**残留问题 C：拼音/缩写误命中未做任何防护**

任务书提到「拼音」误命中。现场代码**没有任何拼音或缩写防护**：`'Sora'`（`ai.strong`，`classifier.js:132`）会命中 `«Soraya 发布新专辑»`；`'GPT'`（`:131`）会命中 `«GPT 不是…»`（这个是对的）；`'Kimi'`（`ai.weak`，`:135`）会命中人名 `«Kimi 夺冠»`（赛车手 Kimi Räikkönen）。这类靠词边界挡不住（它们是完整拉丁词），**只能靠负向词表 + 语境**，见 §四。

### 2.3 打分制 `score += kw.length` 的口径问题 —— v2 存在，v3 已部分修

**v2 机制**：得分 = 命中词长之和，无强弱、无阈值。直接后果：

1. **长词权重高但可能更泛化**：`'互联网'`(3) > `'芯片'`(2)，而 `'互联网'` 的判别力远低于 `'芯片'`；
2. **短词误伤无门槛**：单个双字泛化词（`'消费'`、`'比赛'`）就足以成类；
3. **裸字黑洞**：v2 society 词表含裸字 `'判'`，`includes('判')` 吞掉「判断/预判/判定」。此项 v2 已自修（`01-docs/PRD-HOT-TOPICS-CATEGORY-SUPPLY-2026-09-20.md:78` 记录为 v2 变更第 2 条），现场 v3 society 表已无裸字（`classifier.js:155-164` 用 `'审判'/'判决'/'判刑'`）；
4. **大小写**：见 2.2；
5. **CJK 无词边界**：见 2.2 残留 A。

**v3 处置**：`STRONG_MULT = 2`（`:257`）+ `MIN_SCORE = 3`（`:263`）强弱分层。

**实测验证**：

| 输入 | v3 结果 | 说明 |
|---|---|---|
| `«消费»` | `general` | 单个双字弱词（2 分 < 3）不成类 ✅ |
| `«消费 投资 理财»` | `finance` | 2+2+2=6 分叠加成类 ✅ |
| `«比赛»` | `general` | ✅ |
| `«比赛 冠军»` | `sports` | weak 2 + strong 4 = 6 ✅ |

**残留问题 D：弱词阈值导致过度落 `general`（漏判面）**

`MIN_SCORE = 3` 对「单弱词标题」一刀切。科技垂类大量标题**只用弱词表达**，现场实测的漏判：

| 输入 | v3 结果 | 应有 | 机制 |
|---|---|---|---|
| `«华为发布折叠屏手机»` | **`general`** | `tech` | `'手机'` 是 weak(2)；`'华为'` 不在任何词表；`'发布'`/`'折叠屏'` 均未收录 → 2 分 < 3 |
| `«猪肉价格三周连跌»` | **`general`** | `finance` | 词表有 `'股价'`/`'房价'`，但 **无 `'价格'`**；`'跌停'` 不匹配「连跌」→ 0 分 |
| `«SpaceX 星舰第十次试飞成功»`（v2 期实测） | `general` | `tech` | `'SpaceX'`/`'星舰'` 未收录（v3 有 `'火箭'`/`'航天'`，但该标题**不含**这两个词） |

即：v3 把 v2 的**误判面**压下去了，代价是**漏判面**抬起来了。这不是「改错了」，而是 `MIN_SCORE` 单点阈值没有配套的**词表覆盖度**与**弱词累积域**设计。

**残留问题 E：分类得分相等时按 `KEYWORD_RULES` 声明顺序取主标签（语义优先级隐性）**

`classifier.js:317` 的稳定排序 + `124` 起的数组顺序，实际产生了一套**隐性的类间优先级**：`ai > international > society > finance > tech > entertainment > sports > emotion > education > health`。

`ai` 被放在第 1 位（`classifier.js:125-126`），意味着**同分时 AI 必胜 tech**。这在「AI 手机」「AI 芯片」这类题上是有意设计，但也是**未文档化的耦合**：改动 `KEYWORD_RULES` 的书写顺序会静默改变主标签。现场实测：

- `«某明星代言 AI 手机»` → `ai`（[`ai`,`entertainment`]），同时命中 `'明星'`(strong,4) + `'手机'`(weak,2)=6 与 `'AI'`(strong,4)+`'AI手机'`(strong,8)=12 → ai 分更高，非并列，属正常；
- `«和 AI 聊天机器人谈恋爱»` → **`tech`**（[`tech`,`ai`,`emotion`]）：`tech` 命中 `'机器人'`(strong, 3×2=6)；`ai` 命中 `'AI'`(strong, 4) + `'AI手机'`? 否 → 4；`emotion` 命中 `'恋爱'`(strong,4)。**tech(6) > ai(4) = emotion(4)**，于是主标签成了 `tech`。但这条题的**真实语义是情感**（人与 AI 谈恋爱），标签顺序应是 `emotion` 优先。这说明「按分数排主标签」在**跨域复合题**上会系统性偏向词更长的域。

### 2.4 boost 补拉直挂分类 —— v2 存在；**调研期间已被并发修复（见 §0.1 增补）**

> ⚠️ **本条描述对应 §0 快照 `106F1CCC09`（07:48:17）。** 07:56:12 现场已改写为 `4A41E316E6`，`_collectBoostChannel` 已改为走分类器，直挂问题**已修**。保留本条以说明问题机理与「为什么必须改」，最新状态见 §0.1。

**机制**（`hot-topics-service.js:286-296`）：补拉源的条目**不调用分类器**，`category` 与 `categories` 直接写 `source.boostCategory`：

```js
category: source.boostCategory,      // :290
categories: [source.boostCategory],  // :291
```

**为什么会让不相关条目硬挂 tech**：`tech` 的补拉源是 IT之家 RSS（`hot-topics-service.js:69`，`parser: 'ithome_rss'`），其解析器把 `rawCategory` 固定为 `'科技'`（`channels.js:210`）——**但服务层根本没读这个字段**，而是无条件用 `boostCategory='tech'`。触发条件也很宽：`(counts[cat] || 0) < cfg.threshold`（`tech` 的 threshold 是 6，`hot-topics-service.js:68`），或 UI 显式点了「补拉该分类」（`HotTopics.vue:508-511`）。IT之家 RSS 是**综合科技资讯流**，含发布会预告、促销、行业八卦、企业人事，这些全部被硬挂 `tech`。

**v3 未修**：`hot-topics-service.js` 时间戳与 v2 一致（`106F1CCC09`，07:48:17），`:286-296` 仍是直挂。

**加重机制 1：去重合并「只升不降」**（`hot-topics-service.js:333-335`）

硬挂的 `tech` 会**覆盖**同文本条目的正确分类吗？——不会覆盖，但会反向污染：若某条 US 内容已被主榜正确判为 `general`，boost 版到达后 `target.category` 被**提升为 `tech`**（`:333-335`）。而如果主榜已判为 `emotion`，boost 版只并入标签（`:330-332`），产生 `[emotion, tech]` 这种**语义互斥的双标签**，UI 会同时展示两个标签（`HotTopics.vue:144` 展示前 2 个）。

**加重机制 2：`ai` 无供给**（`CATEGORY_BOOSTS`，`:63-81` 只有 finance/tech/emotion/health/education/international）

v3 新增了 `ai` 分类，但补拉配置里**没有 `ai`**。后果：`ai` 的条目数只能靠主榜关键词，稀疏时**没有任何定向补拉手段**；UI 上 `ai` chip 为空时点「补拉该分类」，`wanted` 集合会包含 `'ai'`（`HotTopics.vue:510` 传当前分类），但循环 `for (const [cat, cfg] of Object.entries(CATEGORY_BOOSTS))`（`:446`）取不到 `ai` 这一项，`boostSources` 为空 → **点击无任何效果**（且不报错）。这是一处明确的 v3 遗留缺陷。

### 2.5 单标签 vs 多标签的取舍 —— v3 已有 3 标签，但存在两处结构性问题

**现状**：主分类 + 最多 2 个次标签（`classifier.js:383-387`）。UI 过滤与计数按**全部**标签（`HotTopics.vue:366-370`、`378`），但**标签只展示前 2 个**（`:144`）。

**问题 1：展示 2 个 / 存储 3 个 / 过滤用全部 —— 三处口径不一致**

一条 `categories = ['tech','ai','emotion']` 的条目（如 `«和 AI 聊天机器人谈恋爱»`）：

- 计数：在 `tech`、`ai`、`emotion` 三个 chip 下都 +1；
- 过滤：三个分类都能筛出它；
- 展示：只显示 `tech`、`ai` 两个标签（`:144` 的 `slice(0, 2)`）。

用户在 `emotion` 分类下看到这条，会发现它的标签是「科技 / AI」，**没有任何视觉线索说明它为何出现在情感分类**。这是「多标签过滤 + 两标签展示」组合的固有矛盾。

**问题 2：标签顺序由得分决定，不由语义决定**（同 2.3 残留 E）

`slice(0, 2)` 截断的是**分数前 2 名**，不是**语义前 2 名**。上面那条题被截成 `tech`/`ai`，把真正的语义标签 `emotion` 截掉了。

**问题 3：`general` 会挤占标签位**

主标签命中 `general` 时（`:389`），`categories` 以 `['general']` 起步；后续关键词标签最多再补 2 个（`:386` 的 `slice(0, 3)`）。因此一条「无原生分类 + 有 3 个关键词信号」的条目只能保留前 2 个关键词标签，第 3 个被丢弃。虽然可接受，但结合 §1.6 的 `general` 语义塌缩，会把「真的没信号」和「有信号但被 `general` 占位」混在一起。

### 2.6 LLM 兜底为什么没能纠正科技错配（任务书问题 4）

现场代码 `llm-classifier.js`（`CCE970E0E0`）+ `hot-topics-service.js:_applyLlmLabels`（`106F1CCC09`）逐条列出：

| # | 机制 | 证据 | 对「纠正 tech 错配」的影响 |
|---|---|---|---|
| 1 | **只处理 `general`** | `hot-topics-service.js:378` `if (t.category !== 'general') continue` | **致命**。2.1/2.4 产生的错配条目分类是 `tech`（不是 `general`），**从不进入 LLM**。LLM 兜底在结构上无法纠正任何已错判为具体分类的条目 |
| 2 | 批次上限 40 | `llm-classifier.js:14,25`；`hot-topics-service.js:34,389` | 单轮最多 40 条 `general`；`MAX_TOPICS=400`，若 `general` 超 40 条，其余本轮**永久拿不到标签**（下一轮仍从同一批头部开始，因为 `need` 按 `topics` 顺序收集） |
| 3 | 缓存键 = 原始 topic 文本 | `llm-classifier.js:60` `out[list[idx]] = label`；`hot-topics-service.js:379` `labels[t.topic]` | 未归一化（空白/全半角/末尾标点差异 → 不同键 → 重复计费）；键为**空串或超 200 字符**时 `:379` 查 `labels['']` 或查不到 → 重复请求；超 `LLM_LABELS_MAX=500` 时按插入序裁剪（`:197-199`），**被裁掉的条目下一轮重新请求**（历史键已被 `.slice(keys.length - 500)` 丢弃） |
| 4 | **无置信度阈值** | `llm-classifier.js` 全文无 confidence/logprob/score | LLM 返回什么就是什么，`temperature: 0`（`:47`）只降随机性，不提供可靠性信号 |
| 5 | **无二次裁决** | 同上 | 没有「LLM 与关键词不一致时如何裁决」的逻辑；LLM 的 `label` 直接覆盖 `t.category`（`hot-topics-service.js:401-403`） |
| 6 | **无失败记忆 / 无熔断** | `llm-classifier.js:64-67` catch 后 `return {}`；`hot-topics-service.js:407-409` catch 仅 warn | provider 未配置或持续报错时，每轮抓取都会对同一批 40 条**重复尝试**，无退避、无「已知不可用」标记 |
| 7 | **只改主分类，不改标签顺序** | `hot-topics-service.js:402-403` push 到末尾 | LLM 判出的正确分类被**追加到 `categories` 末尾**，主标签位置不动。若 LLM 说「这是 tech」而条目原本 `[general]`，会变成 `[general, tech]`… 实际是 `t.category=lab` 且 push，但这只对 `general` 生效，见 #1 |
| 8 | **缓存键不含模型/版本** | `hot_topics_llm_labels` 只存 `{topic: label}` | 换模型后旧标签继续命中，无法归因「这条是哪个模型判的」 |
| 9 | 输出解析脆弱 | `llm-classifier.js:51` `match(/\{[\s\S]*\}/)` | 贪婪匹配，多个 JSON 片段时会整体取最外层；`JSON.parse` 失败即整批丢弃（`return {}`，`:52-53`）。选题文本直接拼进 prompt（`:44`），**批量注入面**：一条含指令的标题可污染同批其它条目的判定 |
| 10 | 键碰撞 | `llm-classifier.js:26` `slice(0, 200)` | 长标题截断后前缀相同 → **不同条目映射到同一个 key**，后者覆盖前者 |
| 11 | **在截断之后才跑** | `hot-topics-service.js:503` slice → `:506` LLM | 被 `slice(0, 400)` 丢掉的条目永远拿不到 LLM 分类 |
| 12 | 落盘时机 | `:406` `if (changed) this._writeLlmLabels(labels)` | 只在**整批至少一条变化**时写；若 LLM 全返回 `general`，`labels[t.topic]='general'` 也会置 `changed=true`（`:399`），反而写入了 40 条无用键，加速 500 条上限耗尽 |

### 2.7 根因归纳（机制级）

按「是否已在现场 v3 修复」分栏：

**A. 已在 v3 修复（不建议重复投入）**

1. 宽泛原生桶整批映射到具体分类 → `RAW_CATEGORY_WEAK_MAP` + 弱标签让位（`classifier.js:90-105`、`375-380`）。**实测 3 例通过**。
2. 拉丁词裸子串误命中（`'AI'` → `Air`/`said`/`train`）→ `_matchesLatin` 词边界（`classifier.js:265`、`274-285`）。**实测 4 例通过**。
3. v2 无强弱/无阈值的打分 → `STRONG_MULT` + `MIN_SCORE`（`classifier.js:257`、`263`）。**实测 4 例通过**。
4. 裸字黑洞词（如 `'判'`）→ v3 society 表已清除（`classifier.js:155-164`）。

**B. v3 仍存在（本报告方案的目标）**

| # | 机制 | 证据 | 后果 |
|---|---|---|---|
| B1 | **可信原生映射无条件压过关键词** | `classifier.js:375-376` | `rawCategory='科技'` + `«今晚吃什么»` → **`tech`**。科技类混入不相关内容**最主要残留路径** |
| B2 | **boost 补拉硬挂 `boostCategory`** | `hot-topics-service.js:290-291` | IT之家综合资讯流 100% 挂 `tech`（threshold=6 极易触发，`:68`） |
| B3 | **去重合并只升不降 + 无条件并标签** | `hot-topics-service.js:330-335` | 产生 `[emotion, tech]` 类互斥标签，污染计数与过滤 |
| B4 | **`ai` 无补拉源** | `CATEGORY_BOOSTS` 无 `ai`（`:63-81`）+ `:446` 循环 | `ai` chip 空时点「补拉」**无任何效果**（静默） |
| B5 | **LLM 兜底只处理 `general`** | `hot-topics-service.js:378` | 已错判为 `tech` 的条目**永不纠正**。这是「LLM 没兜住」的第一性原因 |
| B6 | LLM 无置信度、无二次裁决、无失败记忆 | `llm-classifier.js` 全文 | 判错无从发现、无法收敛；故障时重复计费 |
| B7 | CJK 关键词仍为裸子串、无否定/负向词 | `classifier.js:295` | `'上市'`/`'手机'`/`'新能源'` 等在跨域标题上误伤（见 2.2/2.3 实测） |
| B8 | `MIN_SCORE=3` 单点阈值 + 词表覆盖不足 | `classifier.js:263`、`181-191` | 漏判面：`«华为发布折叠屏手机»`、`«猪肉价格三周连跌»` → `general` |
| B9 | 主标签顺序纯按分数，跨域复合题偏长词 | `classifier.js:383-386` | `«和 AI 聊天机器人谈恋爱»` → 主标签 `tech`（语义应是 `emotion`） |
| B10 | `general` 三种语义塌缩为一种 | `classifier.js:389`、`90-105`、`111-115` | 「明确泛资讯」被当「未命中」送 LLM |
| B11 | 展示 2 / 存储 3 / 过滤全部 口径不一致 | `HotTopics.vue:144` vs `366-370`、`378` | 用户在分类下看到「标签里没有该分类」的条目 |
| B12 | 多标签上限 3 且次标签按分数 | `classifier.js:387` | 一条横跨 4 域的题必丢 1 域 |
| B13 | 拉丁词边界不覆盖全角、拼音/缩写无防护 | `classifier.js:265`、`281` | `ＡＩ` 漏判；`Sora`/`Kimi` 命中人名 |

### 2.8 可复现实测汇总（现场 `735002AE63` 实跑输出）

以下为**真实执行** `classifyTopicMulti` 的输出（非推演），可直接用于回归测试：

| rawCategory | channel | 标题 | 主分类 | 标签 | 判定 |
|---|---|---|---|---|---|
| — | weibo | `AI 生成的假新闻泛滥 平台回应` | `ai` | `[ai]` | ✅ |
| — | weibo | `OpenAI 发布 GPT-5` | `ai` | `[ai]` | ✅ |
| — | weibo | `DeepSeek 开源新模型` | `ai` | `[ai,tech]` | ✅ |
| — | weibo | `AirPods Pro 3 开售首日售罄` | `general` | `[general]` | ✅（v2 会是 tech） |
| — | weibo | `said goodbye to my hometown` | `general` | `[general]` | ✅（v2 会是 tech） |
| — | weibo | `Train derails in Ohio` | `general` | `[general]` | ✅（v2 会是 tech） |
| **`科技`** | **weibo** | **`今晚吃什么`** | **`tech`** | **`[tech]`** | ❌ **B1** |
| **`汽车`** | **toutiao** | **`新款 SUV 上市`** | **`finance`** | **`[finance]`** | ❌ **B3**（weak `general` 让位给 `'上市'`） |
| — | weibo | `华为发布折叠屏手机` | `general` | `[general]` | ❌ **B8** 漏判（应 tech） |
| — | weibo | `猪肉价格三周连跌` | `general` | `[general]` | ❌ **B8** 漏判（应 finance） |
| — | weibo | `和 AI 聊天机器人谈恋爱` | `tech` | `[tech,ai,emotion]` | ❌ **B9/B11**（主标签应为 emotion） |
| — | weibo | `新能源车下乡补贴出台` | `tech` | `[tech]` | ⚠️ 可争议（finance 亦成立） |
| `bilibili:知识` | bilibili | `二战历史全解析` | `general` | `[general]` | ✅（v2 会是 tech） |
| `bilibili:科学科普` | bilibili | `恐龙灭绝新证据` | `general` | `[general]` | ✅ |
| `bilibili:知识` | bilibili | `个人养老金怎么算` | `finance` | `[finance]` | ✅（让位成功） |
| `bilibili:科技` | bilibili | `某地暴雨积水` | `general` | `[general]` | ✅（可信表让位给零信号 → general；但注意此处**没有**回退到 `tech`） |

> 注：最后一行的行为需要留意——`RAW_CATEGORY_MAP` 是**可信**表，但 `classifyTopicMulti:375-381` 在 `hits` 为空时才用 `native`（无论 weak 与否），所以 `'科技'` + 零命中 → **`tech`**（与倒数第七行一致）。而 `'bilibili:科技'` + 零命中却得 `general`？这是因为 `channel='bilibili'` 时 `key='bilibili:科技'`（含冒号）无法在表中命中——**这是测试夹具的 channel 传参差异**，不是分类器逻辑差异。真实链路里 `channels.js:87` 传的是 `item.tname`（纯分区名），`hot-topics-service.js:243` 传的 `channel` 是解析器里硬编码的 `'bilibili'`，所以**真实场景等于倒数第七行**：渠道自称「科技」+ 零关键词 → 硬挂 `tech`。

### 2.9 现场遗留的即时风险（供决策，非本报告方案范围）

1. **`classifier.test.js` 当前运行失败**：`node --test apps/desktop/electron/services/hot-topics/classifier.test.js` 报 `TypeError: Cannot read properties of undefined (reading 'config')`，1 test / 0 pass / 1 fail。该文件于 07:52:58 由并发会话新增，失败原因疑似测试需要 vitest 环境（`describe/it` 全局或 `config` 注入）而以 `node --test` 运行。**新增测试当前未通过**，需在合并前修复。
2. **`hot-topics-service.js` 尚未适配 11 类**：`ai` 无补拉源（B4）；`LLM` 路径虽用 `CATEGORY_KEYS`（`llm-classifier.js:12`）自动获得 `ai` 作为可选值，但因 B5（只处理 `general`）实际很少触达。
3. **注释漂移**：`apps/desktop/src/features/content/content-categories.js:2` 仍写「内置 10 类」；`apps/desktop/electron/services/content-categories.js:15` 仍写「只认这 10 个 key」。属文档级不一致，但正好是跨端契约文档，建议同步。

---

## 三、可借鉴的工程做法

> 说明：本节结论标注来源类型。`[一手]` = 直接读取的源码/官方产物；`[搜索摘要]` = 通过搜索引擎结果页获得、**未打开原页核实正文**（本次调研环境对多数站点的正文抓取受限：内置 web_fetch 拒绝解析到保留网段（198.18.0.0/15）的域名，CDP 浏览器通道未启用，web_search 后端未配置 key，故以 HTTPS 客户端取回可公开访问的页面）。`[工程共识]` = 通用工程实践，非特定来源。

### 3.1 关键词 + 权重 + 词表分层

- **[工程共识] 三层词表**：`strong`（判别力强、单词即可成类）/ `weak`（需累积）/ `negative`（命中即排除或降权）是规则分类的标准结构。现场 v3 已实现前两层（`classifier.js:124-253`），**缺第三层**。
- **[工程共识] 分数归一化而非绝对阈值**：`MIN_SCORE` 这类绝对阈值对「词表覆盖度」敏感（见 2.3 残留 D）。更稳的做法是**归一化得分 + 相对边际判据**（如 `top1_score / top2_score ≥ τ` 才认主标签，否则落 `general` 或送 LLM），这样新增词不会打破既有标定。
- **[搜索摘要] 词频类算法（TF-IDF / BM25）在短文本上退化**：检索结果中多篇工程文（CSDN / 博客园 / 腾讯云开发者社区，如 `blog.csdn.net/weixin_69500620/article/details/161751314`、`cnblogs.com/pass-ion/p/19108708`、`cloud.tencent.com/developer/article/1572148`）一致指出 BM25 的 TF 饱和度与文档长度归一化在**长文检索**场景收益明显，但标题级短文本词频几乎恒为 1，TF 项无区分度，**退化到 IDF** —— 而热榜标题语料又没有稳定的全局文档集来做 IDF 估计。**结论：不应把 TF-IDF/BM25 当作本项目的分类主判据**，它更适合作为「同一个词在不同类目下的区分度权重」来源（即把 IDF 当作词表权重的离线标定值）。

### 3.2 中文/混排的词边界问题

- **[一手] 现场已采用的方案**：对纯拉丁/数字关键词用「前后字符不得是 `[A-Za-z0-9]`」模拟 `\b`（`classifier.js:274-285`）。这是 JS 里处理「英文缩写混在 CJK 文本中」的可行做法，因为 JS 的 `\b` 只认 ASCII 单词字符，在 CJK 旁边行为与直觉不符。
- **[搜索摘要] 中文子串匹配的固有风险**：检索结果（`php.cn` 的「边界匹配符 / 正则表达式匹配特定单词边界」系列、`segmentfault.com` 关于中文匹配算法的文章、`blog.csdn.net` 中文分词算法对比）指向两点：① 中文没有天然词边界，**裸子串匹配必然产生跨词误命中**；② 工程上要么引入分词（jieba 等）后按词匹配，要么用「最长匹配 + 负向词表」在不解分词的轻量路径上压制误命中。
- **[工程共识] AC 自动机（Aho-Corasick）** 是多关键词同时匹配的标准结构，把 O(词表 × 文本) 降到 O(文本)，并天然支持「最长匹配优先」——对本项目 200+ 关键词 × 400 条/轮的量级，当前线性扫描可接受，但若要上分层词表 + 负向词，AC 自动机 + 词权重是最省心的落地形态。
- **[工程共识] 全角/大小写归一化**：匹配前做 `NFKC` 归一化 + `toLowerCase`，可同时解决全角拉丁（`ＡＩ`）、全角数字（`５Ｇ`）与大小写问题。现场只做了 `toLowerCase`（`classifier.js:305`），**未做 NFKC**。

### 3.3 热榜聚合产品的分类体系

- **[一手] DailyHotApi 的返回结构里没有内容分类字段**。读取其类型契约 `src/types.d.ts`（`default_branch = master`）：

  ```ts
  // 榜单数据
  export interface ListItem {
    id: number | string; title: string; cover?: string; author?: string;
    desc?: string; hot: number | undefined; timestamp: number | undefined;
    url: string; mobileUrl: string;
  }
  // 路由数据
  export interface RouterData extends RouterResType {
    name: string; title: string; type: string; description?: string; ...
  }
  ```

  `ListItem` **无 category 字段**；`type` 是**来源标识**（平台/站点），不是内容分类。其 `src/routes/` 目录按**来源**逐文件组织（`weibo.ts`、`zhihu.ts`、`baidu.ts`、`ithome.ts`、`36kr.ts`、`v2ex.ts` …共 56 个路由），`src/registry.ts` 的设计是「递归扫描 `routes/` 目录自动注册路由」，即**聚合维度是来源，不是内容分类**。
  **借鉴意义**：说明「原生聚合器不做内容分类」是常见选择，内容分类是**消费侧**能力（本项目要做的是对的方向）；也说明日报/选题类产品的分类体系**必须自建**，无法从上游白拿。

- **[搜索摘要 / 一手 HTML] tophub.today 的分类粒度**：从其 `/c/tech` 页面取回的导航（43 个 `/c/` 链接）显示其**一级分类为 16 个**：

  `综合(/c/news)`、`科技(/c/tech)`、`娱乐(/c/ent)`、`社区(/c/community)`、`购物(/c/shopping)`、`财经(/c/finance)`、`开发(/c/developer)`、`简报(/c/brief)`、**`AI(/c/ai)`**、`报刊(/c/epaper)`、`设计(/c/design)`、`校务(/c/university)`、`政务(/c/organization)`、`专栏(/c/blog)`、`公众号(/c/wxmp)`、`小部件(/c/widget)`。

  其中科技域下还有**二级标签**：`科技`/`数码`/`科学`/`科普`/`汽车`/`出海`/`评测`/`人工智能`/`App`/`限免`/`AppStore`/`报告`/`教育`/`电商`（形如 `/c/tech?q=<tag>`）。

  **三条可直接借鉴的结论**：
  1. **AI 被独立成与科技平级的一级分类**（`/c/ai`）——与本项目 v3 新增 `ai` 的决策一致，是行业已验证的做法；
  2. **汽车被放在科技域之下**（`/c/tech?q=汽车`）——与本项目 v3 把「汽车」从 tech 降级为弱 `general`（`classifier.js:92`）取向**不同**。tophub 的选择暗示「汽车」作为科技域子标签是用户可接受的心智；本项目把它直接降为 `general` 会让汽车类内容失去归属（实测 `«新款 SUV 上市»` → `finance`，见 §2.8）。**建议**：若不做 `auto` 分类，至少把「汽车」的弱映射从 `general` 改为 `tech` 并配负向词，而不是丢进综合；
  3. **一级 16 个 / 科技域 14 个二级标签**——说明「一级分类十来个大类 + 域内子标签」是成熟产品的信息架构常态。本项目 11 个一级分类处于合理区间，**不建议继续增加一级分类**，而是给 `tech`/`ai` 加域内子标签（如 `ai-agent`/`算力`/`芯片`）。

- **[搜索摘要] 微博/百度热搜的原生分类粒度**：本项目 `channels.js` 的实测记录本身就是一手证据——微博 `hot_band` 提供 `item.category`（`channels.js:144`），实测枚举含「情感/艺人/汽车/音乐/电影/科学科普/健康医疗/数码/互联网/剧集/综艺/民生新闻/舆论监督/职场/法律」等**混合粒度**标签（`classifier.js:58-69`）；头条 `hot-board` 提供 `item.Category`（`channels.js:53`），粒度为大类（社会/国际/财经/科技/娱乐/体育/教育/健康/军事/游戏）。**百度/tophub/知乎/抖音不提供分类**（`channels.js:40,100,125,167` 均 `rawCategory: null`）。
  **结论**：上游原生分类**粒度不可控、覆盖不完整、且会缺失**（`classifier.js:44` 注释：「2026-09 起该字段偶发缺失」）。因此分类体系必须以**文本证据**为主干，原生分类只能做**先验提示**，不能做**终判**——这正是 B1 要修的方向。

### 3.4 embedding 语义相似度

- **[工程共识]** 短文本分类上 embedding（如 `text-embedding-3`、`bge-m3`、`text2vec`）+ 类目原型向量（每类若干「种子标题」求均值）做最近邻，通常显著优于纯关键词，且能处理同义改写（`新能源车`≈`电动汽车`）。
- **[工程共识] 落地成本**：需引入 embedding 模型依赖（本地模型增加安装包体积；远程 API 增加外发与费用），与「本项目零外发、用户未配模型时不联网」的隐私合同（`PRD-HOT-TOPICS-CATEGORY-SUPPLY-2026-09-20.md:135`）冲突。**建议**：不引入 embedding 作为主路径，但可在**离线评测**阶段（§五）用 embedding 或 LLM 辅助**构造标注集**，把成本隔离在研发期而非运行期。

### 3.5 LLM zero-shot + 置信度阈值 + 二次裁决

- **[搜索摘要] LLM 自报置信度普遍过度自信、需校准**：搜索结果指向 arXiv 相关论文，包括「LLM Confidence Evaluation Measures in Zero-Shot CSS Classification」（arXiv，Information Retrieval 分类）与若干 selective prediction / 置信度校准工作（如 `2606.10198`、`2604.17716`）。多篇工程实践文（CSDN「LLM 置信度校准实战」「LLM 置信度为何不可信？一个 33ms 校准概率引擎的落地实践」）给出同一结论：**直接采信 LLM 的自评置信度不可靠，必须经阈值校准或多次采样一致性来用**。
- **[工程共识] 级联（cascade）成本控制**：以低成本分级判据先过滤，仅把「低置信 / 高价值」样本升级到贵模型，是降低 LLM 成本的标准范式（斯坦福 FrugalGPT 一系的思路；搜索结果中「FrugalGPT: 如何使用大型语言模型同时降低成本并提高性能」多篇转载可佐证该范式已被广泛采用）。**对本项目的直接映射**：关键词层就是级联的第一级，LLM 只应处理**第一级判不出或自相矛盾**的样本——不是「只处理 `general`」，而是「只处理**低置信**样本」，这才修得了 B5。
- **[工程共识] 批量分类的序号映射脆弱**：现场用 `{"0":"tech"}` 的序号映射（`llm-classifier.js:42-44`），序号错位会**静默错配整批**。更稳的是让模型回显**原文片段或 id**，或逐条独立请求（成本换正确性，可按条数自适应）。至少应校验「返回条目数 == 请求条目数」，现场无此校验。
- **[工程共识] 主动学习 / 人工反馈闭环**：搜索结果中「Human-in-the-loop 实战：用置信度与主动学习构建人机协同的文本分类系统」「主动学习(Active Learning)系列介绍(二)不确定度采样」等给出标准做法：**按不确定性采样**（top1/top2 分差小、LLM 与规则不一致、LLM 自评低置信）挑样本交人工标注，标注结果回归为**词表/负向词/阈值**的增量，而不是每次重训模型。这在本项目（规则为主）上落地成本极低：**人工确认的错例直接变成负向词或词表条目**。

### 3.6 LLM 分类的成本控制与可审计性

- **[工程共识] 缓存键设计**：应以**归一化后的文本 hash** + **模型标识** + **prompt 版本** 组成复合键。现场只用原始文本作 key（`llm-classifier.js:60`、`hot-topics-service.js:379`），既不稳（B6-#3）也不可归因（B6-#8）。
- **[工程共识] 留痕**：至少记录 `{ key, label, model, prompt_version, decided_by, ts }`，使「这条为什么是 tech」可事后归因。现场缓存只有 `{topic: label}`（`hot-topics-service.js:399`），**无法区分「关键词判的」与「LLM 判的」**——这是可审计性上最大的缺口。
- **[工程共识] fail-open vs fail-closed**：现场 LLM 采用 **fail-open**（失败即保持关键词结果，`llm-classifier.js:8-9` 注释、`64-67`）。对**展示型**热榜这是正确取舍（LLM 挂了不能整个功能不可用）。但 fail-open 必须配**失败记忆**，否则退化为「每次都重试」（B6-#6）。

---

## 四、优化方案（含新增 AI 分类）

### 4.1 设计目标与边界

1. **科技类纯度优先**：`tech` 分类下的「与科技不沾边」条目比例要可测量、可持续下降（见 §五）。
2. **不引入运行期新依赖**：不引入 embedding 服务、不引入分词库（保持现有 200+ 关键词 × 400 条的轻量路径）。
3. **原有 fail-open 合同不变**：LLM 缺失/失败不影响抓取主流程。
4. **跨端契约同步**：任何分类集合变更必须 5 处同步（`classifier.js:24-27` 已声明）。

### 4.2 分类体系设计

**结论：维持 11 个一级分类，不再增设。** 依据 §3.3（tophub 一级 16 个、DailyHotApi 无分类），11 个处于合理区间；增设一级分类会稀释 UI chip 密度并增加标注成本。改进点是**域内子标签**与**边界收紧**，不是扩张数量。

**AI 与 tech 的边界（新增 AI 分类的完整设计）**

| 维度 | `ai` | `tech` |
|---|---|---|
| **核心判据** | 主体是**模型/算法/智能能力**本身 | 主体是**硬件/基础设施/工程实体** |
| **覆盖内容** | 大模型（训练/发布/评测/开源）、AIGC（文/图/音/视频生成）、Agent/智能体、提示工程、AI 应用（AI 手机/眼镜/编程/绘画）、算力与智算中心、AI 芯片（**作为模型算力载体的语境**）、AI 安全与监管、AI 伦理与就业冲击 | 芯片/半导体（非 AI 语境的制造、制程、产能）、操作系统/浏览器/数据库/云计算/区块链、消费电子（手机/电脑/笔记本/相机/屏幕）、通信（5G/6G）、航天/卫星/火箭/空间站、新能源/光伏/储能/电池、自动驾驶（**车本身**）、机器人（**硬件本体**）、量子计算、开源工程与程序员生态 |
| **重叠裁决** | 「AI 芯片」→ `ai`（若标题强调模型/算力）；「GPU 显卡」→ `tech`（若强调硬件评测） | 依据：**语境词优先**，见下方优先级规则 |
| **不该进 `ai`** | 泛化的「算法」（推荐算法）、「智能化」营销词、公司名含 AI 但内容无关 | — |
| **不该进 `tech`** | 汽车销量/补贴/价格 → `finance`；手机丢失/诈骗 → `society`；明星代言手机 → `entertainment` | — |

`ai` 优先级设计（**关键**）：`ai` 应在 `tech` **之前**判定，但仅当**命中 AI 强词**时；若只命中 `'AI'` 这一个拉丁缩写而同时命中 tech 强词，则**让位给 tech**。理由：`'AI'` 已成为营销后缀（「AI 手机」「AI 洗衣機」），单靠它不足以证明主题是 AI。

**关键词表（`ai`）**

```js
// ai：TIER1 强证据（命中即可独立成类，权重 = 词长 × 2）
ai.strongTier1 = [
  '人工智能', '大模型', '大语言模型', '基础模型', '生成式', 'AIGC', 'AGI',
  '多模态', '深度学习', '神经网络', '机器学习', '智能体', 'Agent',
  '算力', '智算', '推理成本', '模型训练', '提示词', 'Prompt',
  'ChatGPT', 'GPT', 'OpenAI', 'DeepSeek', 'Claude', 'Gemini', 'Qwen',
  'Midjourney', 'Stable Diffusion', 'Sora', 'Llama', 'Transformer', '英伟达',
]
// ai：TIER2 弱证据（需叠加；权重 = 词长）
ai.weak = [
  'AI', '豆包', '通义', '文心一言', 'Kimi', '智谱', 'kimi', '混元', '星火',
  '训练数据', '算法工程师', 'AI绘画', 'AI视频', 'AI编程',
]
// ai：负向词（命中则本类降权/排除）
ai.negative = [
  'AI 换脸诈骗', 'AI 生成假新闻',   // 主体是诈骗/假新闻 → society
  'AI 歌手', 'AI 明星', 'AI 换脸',  // 主体是娱乐
]
```

**注意与现场 v3 的差异**：现场把 `'AI'` 放在 `ai.strong`（`classifier.js:133`），并同时列了 `'AI芯片','AI绘画','AI视频','AI编程','AI手机','AI眼镜'`（`:130`）。由于 `'AI'` 已是 strong 且中文子串匹配，这些**带 AI 前缀的复合词全部冗余**（`'AI手机'` 必然含有 `'AI'`，甚至 `'AI'` 与其自身都会命中）。建议：**`'AI'` 降为 weak（或强制要求 Tier1 词共现）**，删掉冗余复合词，改为「Tier1 词表」区分证据强度。

**`tech` 关键词表的修补（针对 B8）**

新增（现场缺失但高频）：`'华为'`、`'小米'`、`'苹果'`、`'OPPO'`、`'vivo'`、`'荣耀'`、`'荣耀'`、`'折叠屏'`、`'芯片制程'`、`'台积电'`、`'光模块'`、`'数据中心'`、`'SpaceX'`、`'星舰'`、`'星链'`、`'深空'`、`'探测器'`。（品牌名进 strong 需谨慎——`'苹果'` 会命中水果，应进 weak 或配负向词 `'苹果价格'`/`'苹果丰收'`。）

新增强负向词（跨域误伤防护）：

| 负向词 | 归属 | 保护对象 |
|---|---|---|
| `'手机丢失'`、`'手机被盗'`、`'手机诈骗'`、`'手机瘾'` | society/education | tech `'手机'` |
| `'汽车销量'`、`'汽车价格'`、`'汽车补贴'`、`'车企'` | finance | tech `'新能源'`/`'电池'` |
| `'电池起火'`、`'电池爆炸'` | society | tech `'电池'` |
| `'上市发布会'`（发布会语境） | entertainment | finance `'上市'`（IPO 歧义） |
| `'价格'`、`'涨价'`、`'跌价'`、`'连跌'`、`'涨幅'` | finance strong | 解决 `«猪肉价格三周连跌»` 漏判 |
| `'苹果丰收'`、`'苹果价格'` | general | tech `'苹果'` |
| `'Kimi 夺冠'`（人名语境） | sports | ai `'Kimi'` |

### 4.3 判定流程重构（新流水线）

```
① 文本归一化
   raw → NFKC 归一化 → lowerText（拉丁词用）
   （修 B13：全角 ＡＩ / ５Ｇ）

② 证据提取（互不短路，全部并行）
   2.1 native = _mapNative(rawCategory, channel)
       → 三档：trusted | generic | (bucket, weak)
       新增第四档：bucket 保留 rawCategory 原文与 channel 供「同源一致性」判据用
   2.2 hits = _scoreKeywords(topic)  ← 分层词表 + 负向词
       得分 = Σ(strongTier1 命中词长 × 2) + Σ(strongTier2 命中词长 × 2) + Σ(weak 词长)
       负向命中：对本类 score -= neg.length × NEG_MULT（或整类剔除，按配置）
   2.3 conf = 相对边际判据（替代单点 MIN_SCORE）
       top1 = hits[0].score, top2 = hits[1]?.score || 0
       有判别力 ⟺ top1 ≥ ABS_FLOOR(2) 且 (top2 === 0 或 top1 / top2 ≥ MARGIN(1.5))
       否则标记 lowConfidence（不直接落 general）

③ 主标签裁决（修 B1：可信原生不再是无条件最高）
   if (hits 有判别力 且 top1 类 ≠ native.category 且 native 为 bucket/泛称类)
        → 主标签 = hits[0].category        // 文本证据压过泛称原生
        → 记 disagreement = {native, keyword}  ← 留痕
   else if (native === trusted 且 不是泛称表)
        → 主标签 = native.category         // 真正可信的原生（如 头条「财经」）
   else if (hits.length)
        → 主标签 = hits[0].category
   else if (native)
        → 主标签 = native.category
   else
        → 主标签 = null（待 ⑤/⑥ 决定，不立刻落 general）  ← 修 B10

   关键新增：把 RAW_CATEGORY_MAP 里语义为「行业泛称/多域混装」的条目
   迁入「泛称表」（见 §4.4 清单），使 B1 的反例（'科技'+«今晚吃什么»）转而落 general

④ 多标签组装（修 B9/B10/B12）
   4.1 主标签恒首位
   4.2 次标签：按「语义多样性」而非纯分数排序
       打分 = keywordScore × domainDiversityBonus
       若两类语义互斥（如 tech × emotion 同时命中同一实体），只保留分高者
   4.3 上限 3 不变；但 general 不再占用标签位（仅当无任何标签时才写 ['general']）

⑤ LLM 兜底与置信度裁决（修 B5/B6）
   5.1 送审样本 = { 主标签为 null } ∪ { lowConfidence } ∪ { disagreement }
        ← 不再只看 'general'，这是纠错能力的关键
        ← 已判为高置信 tech 的条目仍不进 LLM（成本），
          但 tech 的「误判温床」来源（B2/B3）改为在 ⑥ 处理
   5.2 复合缓存键 = hash(NFKC(topic)) + modelId + PROMPT_VERSION
   5.3 要求 LLM 回显 id/序号并校验「返回数 == 请求数」，不符则整批丢弃
   5.4 置信度：不接受 LLM 自报分数；改用「关键词判据与 LLM 是否一致」作为隐式置信
       · 一致 → 直接采纳
       · 不一致 → 采纳 LLM，但标记 needsReview=true 写入审计表（不展示给用户）
   5.5 fail-open + 失败记忆：连续 N 次失败 → 冷却 M 分钟不再尝试
       （复用 ChannelBreaker 模式，见 hot-topics-service.js:97-123）

⑥ boost 补拉去硬挂（修 B2/B3/B4）
   6.1 _collectBoostChannel 不再直挂 boostCategory：
       条目仍走 classifyTopicMulti，boostCategory 作为「提示」参与裁决
       （例如：hint = boostCategory；若关键词判出别的类且分高 → 用关键词结果）
       兜底：若分类器给 general 且 hint 存在 → 用 hint（保证补拉仍有供给意义）
   6.2 新增 CATEGORY_BOOSTS.ai（修 B4）：
       候选源（需实测确认可用性）：
         · IT之家 RSS + AI 关键词过滤（复用现有端点，filterCategory 模式）
         · 微博 hot_band + category == '科学科普'（现有端点，已有解析器）
         · tophub.today /c/ai 节点（HTML，需新解析器；注意其反爬）
       threshold 建议 4；sources 为空时 UI 必须显式提示「该分类暂无补拉源」，
       不得像现在这样点了没反应（B4 的静默失败）
   6.3 _aggregate 的「只升不降」（:333-335）改为：
       · general → 具体类：允许（保持）
       · 具体类 → 具体类：不覆盖主标签，只并入次标签
       · 并标签时做互斥检查（同 ④ 的互斥表）

⑦ general 语义分离（修 B10）
   条目新增内部字段 origin: 'no_signal' | 'generic_bucket' | 'native_general'
   · 仅 origin === 'no_signal' 与 lowConfidence 送 LLM
   · generic_bucket / native_general 不进 LLM（它们是「已判定为泛资讯」）
   UI 层可（可选）把 generic_bucket 显示为「综合」并加 tooltip 说明来源

⑧ 落盘与可审计
   hot_topics_llm_labels 结构升级为：
     { [key]: { label, model, promptVersion, decidedBy: 'llm'|'keyword'|'native', ts } }
   兼容读取旧格式（string label → 视为 decidedBy:'keyword'）
   新增 hot_topics_classify_audit（可选，环形缓冲 N=200）记录 disagreement 与 needsReview
```

### 4.4 需要从「可信原生」迁入「泛称表」的条目（修 B1）

以下条目在 `RAW_CATEGORY_MAP`（`classifier.js:43-81`）中当前是 `weak: false`（无条件最高优先级），但语义上是**行业泛称或多域混装**，建议迁入 `RAW_CATEGORY_WEAK_MAP`：

| 条目 | 现位置 | 建议 | 理由 |
|---|---|---|---|
| `weibo: '互联网': 'tech'` | `classifier.js:60` | 迁入泛称表 → `general` 或 `tech` 弱 | 「互联网」含裁员/监管/平台经济（社会/财经） |
| `weibo: '数码': 'tech'` | `classifier.js:59` | 迁弱或保留 | 含消费导购；建议弱 |
| `bilibili: '数码': 'tech'` | `classifier.js:72` | 迁弱 | 同上 |
| `bilibili: '软件应用': 'tech'` | `classifier.js:72` | 保留可信 | 语义清晰 |
| `toutiao/tencent/bilibili: '科技': 'tech'` | `:47`、`:54`、`:72` | **保留可信但加一道保护** | 渠道自称「科技」时**零关键词命中应落 general 而非硬挂 tech**。实现方式：泛称表里加 `'科技': 'tech'` 的弱映射，或对「可信原生 + 零关键词」强制要求保守 |
| `weibo: '法律': 'society'` | `:66` | 保留 | — |
| `weibo: '职场': 'society'` | `:65` | 迁弱 | 职场内容常是 emotion/finance |
| `bilibili: '校园学习': 'education'` | `:73` | 保留 | — |

**最小改动版（若不愿动可信表结构）**：在 `classifyTopicMulti` 的主标签裁决里加一条——

```js
// 可信原生 + 关键词零命中 ⇒ 原生只是「渠道的一级栏目」，不足以定性单条
if (native && !native.weak && hits.length === 0) {
  primary = CONSERVATIVE_ON_EMPTY_HITS.has(native.category) ? null : native.category
}
// CONSERVATIVE_ON_EMPTY_HITS = new Set(['tech', 'ai'])  ← 先只对科技域保守
```

这一条即可消灭 §2.8 的 `'科技' + «今晚吃什么» → tech` 反例，且改动面极小。

### 4.5 与「不再扩张一级分类」相配的域内子标签（可选，P2）

给 `tech` / `ai` 增加**非分类、仅供展示与筛选细化**的子标签（不改 `CATEGORY_KEYS` 契约）：

- `ai`: `大模型` / `AIGC` / `Agent` / `算力`
- `tech`: `芯片` / `消费电子` / `航天` / `新能源` / `机器人`

这些可作为条目的第三个字段 `subTags: string[]`，UI 只在分类 chip 已选中时才展开为二级筛选。**优点**：满足 tophub 式「一级 + 域内标签」的信息架构，且不破坏跨端 11 类契约。

---

## 五、评测方案与验收标准

### 5.1 标注集构造（可执行）

**规模**：≥ 600 条真实热榜标题，覆盖 11 类，每类 ≥ 30 条；其中 `tech` ≥ 120 条、`ai` ≥ 60 条（重点类加倍）。

**来源与去偏**：
1. 从 `hot_topics_cache`（`hot-topics-service.js:28`）导出**历史真实条目**（含 `topic`/`channel`/`rawCategory`/`category`），**不要人工编造标题**——否则测不出真实分布；
2. 分层抽样：每个 `channel` 各取 ≥ 60 条；每个 `rawCategory` 取值（头条 `Category`、微博 `category`、B站 `tname`）都要覆盖到；
3. **必须包含「误判温床」样本**：从 §2.8 的反例类型各取 ≥ 5 条（原生分类与标题语义不符、跨域复合题、品牌名歧义）；
4. 两人独立标注 + 分歧仲裁（第三方或 LLM 辅助）；记录 `label_main` + `label_multi[]`（1-3 个）；
5. 标注集落盘为 `01-docs/research/fixtures/hot-topics-golden.jsonl`，**每个样本带 `source` 字段**（`history` / `adversarial` / `synthetic`），便于分维度看指标。

**判别标准（给标注者的判据卡）**：必须写明 §4.2 的 `ai` × `tech` 边界表与「误判温床」的处理约定，否则标注一致性 (Cohen's κ) 无法达标。**门槛：κ ≥ 0.75**。

### 5.2 评测指标

| 指标 | 定义 | 门槛 | 为什么 |
|---|---|---|---|
| **每类 Precision / Recall / F1** | 以 `label_main` 为准 | 每类 P ≥ 0.80、R ≥ 0.70、F1 ≥ 0.75 | 分类体系的底线；`ai` 首年可放宽（新类样本少），但 P ≥ 0.75 |
| **`tech` 误判率（核心指标）** | `tech` 预测集合中，`label_main ∉ {tech, ai}` 的比例 | **≤ 8%**（现状需先测基线） | 直接对应任务书「科技类下出现不沾边内容」 |
| **`tech` 类纯度** | `tech` 预测集合中 `label_main == tech` 的比例 | ≥ 0.85 | 与上一条互补（上条允许 ai 共存） |
| **`ai` × `tech` 混淆** | 混淆矩阵中 `tech↔ai` 两个方向的计数 | `ai→tech` 漏判 ≤ 20%，`tech→ai` 误判 ≤ 10% | 新类边界质量 |
| **`general` 占比** | 预测为 `general` 的比例 | **≤ 15%**，且其中 `no_signal` 占比 ≤ 5% | 防「靠 general 掩盖判不出」（B8/B10）。若 `general` 过高说明阈值过严 |
| **多标签 Recall@3** | 真实 `label_multi` 被 `categories` 前 3 覆盖的比例 | ≥ 0.90 | 多标签有效性 |
| **主标签位置正确率** | `label_main` 出现在 `categories[0]` 的比例 | ≥ 0.85 | 修 B9（主标签被长词域抢走） |
| **LLM 送审率** | 送 LLM 条目数 / 总条目数 | 监测，不设门槛 | 成本可见性；预期比现状（仅 general）**上升**，这是修 B5 的代价 |
| **LLM 一致率** | LLM 判定与关键词判定一致的样本比例 | ≥ 0.70 | 过低说明两者至少一方有系统偏差 |
| **判定耗时** | 单轮 400 条分类总耗时 | ≤ 50ms（不含网络/LLM） | 规则层性能回归 |

### 5.3 混淆矩阵（必须输出）

评测脚本产出 11×11 混淆矩阵，落盘为 Markdown 表格与 PNG。**必须逐类看「最大误判去向」top-2**，例如现状预期会看到：

```
tech 行 → emotion 列（'恋爱'类被 tech 长词抢走，B9）
tech 行 → general 列（漏判，B8）
general 行 → tech 列（B1：原生「科技」硬挂）
```

### 5.4 评测执行方式（可落地）

1. **新增 `apps/desktop/electron/services/hot-topics/classifier.eval.test.js`**（或独立脚本 `scripts/eval-hot-topics-classifier.js`）：
   - 读取 `hot-topics-golden.jsonl`；
   - 对每条调用 `classifyTopicMulti(rawCategory, channel, topic)`；
   - 计算 §5.2 全部指标 + 混淆矩阵 + 误判样本明细（按误判类型分组输出前 20 条）；
   - **断言门槛**：门槛未达标时 fail（接入 CI，防止回归）。
2. **基线冻结**：先用**现状 SHA `735002AE63`** 跑一遍，把指标记录为基线（本报告未运行完整评测，因标注集尚不存在——**这是明确未完成项，不得当作已验证**）。
3. **A/B 对照**：每次改动词表/阈值，跑同一评测集，输出 diff（哪些类升降、`tech` 误判率升降）。
4. **线上影子验证**（可选）：对生产缓存条目记录 `decidedBy`，抽样人工复核 `needsReview` 标记的条目，回填误判到负向词/词表。

### 5.5 验收标准（交付级）

| 编号 | 验收项 | 判据 |
|---|---|---|
| V1 | `tech` 误判率 | ≤ 8%（对 §5.1 标注集） |
| V2 | `ai` / `tech` 双向混淆 | 符合 §5.2 门槛 |
| V3 | `general` 占比 | ≤ 15%，且 `no_signal` ≤ 5% |
| V4 | §2.8 全部 ❌ 反例 | **逐条转为 ✅**，写成回归用例（含 `'科技'+«今晚吃什么»`、`«华为发布折叠屏手机»`、`«猪肉价格三周连跌»`、`«和 AI 聊天机器人谈恋爱»`、`'汽车'+«新款 SUV 上市»`） |
| V5 | boost 不硬挂 | 构造「IT之家 RSS 含非科技标题」夹具，断言其分类由分类器决定，而非无条件 `tech` |
| V6 | `ai` 补拉可用 | `CATEGORY_BOOSTS.ai` 存在且 sources 非空；UI 点击「补拉该分类」在 `ai` 下产生 ≥ 1 条新条目（或明确提示无源） |
| V7 | LLM 送审含非 general | 构造「已判 tech 但 lowConfidence」样本，断言其进入 LLM 送审集合 |
| V8 | LLM 审计可归因 | 缓存条目含 `model` / `promptVersion` / `decidedBy`；旧格式可兼容读取 |
| V9 | 跨端契约一致 | 5 处分类目录键名与顺序完全一致（已有断言机制，需补 `ai` 到位） |
| V10 | 评测接入 CI | `classifier.eval.test.js` 在 CI 运行且门槛未达标即 fail |

---

## 六、具体代码改动点

> 优先级：**P0 = 直接修任务书核心症状（tech 混入）**；P1 = 准确性/可审计性；P2 = 体系完善。
> 所有行号锚定 §0 的 SHA `735002AE63`（`classifier.js`）与 `106F1CCC09`（`hot-topics-service.js`）。

### P0-1 `classifier.js` — 原生分类分档（修 B1，最小改动）

**函数**：`_mapNative`（`:328-340`）、`classifyTopicMulti`（`:367-392`）

```js
// 新增：语义为「行业泛称 / 多域混装」的可信表条目集合
// （把 §4.4 清单从 RAW_CATEGORY_MAP 的「可信」档降级）
const GENERIC_SCOPE_KEYS = new Set(['互联网', '数码', '职场'])   // per-channel 亦可

// classifyTopicMulti 主标签裁决（替换 :375-381）
if (native && !native.weak && hits.length === 0 && TECH_FAMILY.has(native.category)) {
  primary = null                       // 渠道一级栏目不足以定性单条 → 待保守兜底
} else if (native && !native.weak && !isGenericScope(rawCategory, channel)) {
  primary = native.category            // 真正可信的原生
} else if (hits.length) {
  primary = hits[0].category           // 文本证据优先
} else if (native) {
  primary = native.category
}
// TECH_FAMILY = new Set(['tech', 'ai'])
// 兜底：primary === null 且无 hits → 'general'（噪声进综合，而不是进 tech）
```

**验证锚点**：`rawCategory='科技'` + `«今晚吃什么»` 必须由 `tech` 变为 `general`。

### P0-2 `hot-topics-service.js` — 补拉条目走分类器（修 B2/B3）—— ⚠️ **现场已于 07:56 完成，仅保留互斥检查待做**

> 见 §0.1：`hot-topics-service.js:293-302`（`4A41E316E6`）已改为「分类器优先、`boostCategory` 兜底」。**请勿重复实现**；本条仅剩 `_aggregate` 的互斥标签检查未做（下）。

**函数**：`_collectBoostChannel`（`:271-304`）、`_aggregate`（`:307-343`）

```js
// _collectBoostChannel :286-296 —— 替换硬挂
const items = rawItems.slice(0, MAX_PER_CHANNEL).map(x => {
  const multi = classifyTopicMulti(x.rawCategory, x.channel, x.topic)
  // hint 语义：补拉源的主题先验，只在分类器无信号时生效
  const cat = multi.category !== 'general' ? multi.category : source.boostCategory
  const cats = multi.category !== 'general'
    ? multi.categories
    : [source.boostCategory, ...multi.categories.filter(c => c !== 'general')].slice(0, 3)
  return {
    id: source.channel + ':' + source.board + ':' + x.rank,
    topic: x.topic, channel: source.channel,
    category: cat, categories: cats,
    classifyHint: source.boostCategory,              // 新增：留痕「这条来自哪个补拉源」
    rank: x.rank, hotValue: x.hotValue, url: x.url, fetchedAt,
  }
})

// _aggregate :333-335 —— 补互斥检查
if (target.category === 'general' && norm.category && norm.category !== 'general') {
  target.category = norm.category
}
// 新增：具体类之间不互相覆盖主标签
// 新增：并标签前查 MUTEX_PAIRS，互斥则不并入（如 tech × emotion）
```

### P0-3 `hot-topics-service.js` — 新增 `ai` 补拉源（修 B4）

**常量**：`CATEGORY_BOOSTS`（`:63-81`）

```js
ai: { threshold: 4, sources: [
  { id: 'weibo-ai', name: '微博科学科普(AI筛)', url: 'https://weibo.com/ajax/statuses/hot_band',
    parser: 'weibo', channel: 'weibo', board: 'ai',
    boostCategory: 'ai', filterCategory: '科学科普',
    headers: { Referer: 'https://weibo.com/' }, intervalMinutes: 10, riskLevel: 'medium' },
  // 可选：IT之家 RSS + AI 关键词过滤（复用现有端点，parser: 'ithome_rss'）
] },
```

同时修 UI 的**静默失败**：`HotTopics.vue:508-511` 的 `boostCurrentCategory()` 在目标分类无 sources 时应给出提示（新增 locale key），而不是刷新后无变化。

### P0-4 `classifier.js` — 词表修补（修 B7/B8）

- `KEYWORD_RULES` tech（`:180-192`）：
  - weak 增：`'华为'`、`'小米'`、`'OPPO'`、`'vivo'`、`'荣耀'`、`'折叠屏'`、`'数据中心'`、`'光模块'`
  - strong 增：`'台积电'`、`'星舰'`、`'星链'`、`'SpaceX'`、`'探测器'`
  - 注意 `'苹果'` 建议进 weak 并配负向 `'苹果价格'`/`'苹果丰收'`
- `KEYWORD_RULES` finance（`:166-178`）：
  - strong 增：`'价格'`、`'涨价'`、`'跌价'`、`'连跌'`、`'涨幅'`、`'跌幅'`、`'补贴'`、`'销量'`、`'交付量'`（解决 `«猪肉价格三周连跌»` 与汽车销量题）
- 新增 `negative` 字段（见 §4.2 表格），并在 `_scoreKeywords`（`:304-319`）中应用：

```js
for (const kw of (rule.negative || [])) {
  if (matchesKeyword(rawText, lowerText, kw)) score -= kw.length * NEG_MULT  // NEG_MULT = 2
}
```

### P1-1 `classifier.js` — 相对边际判据替代单点阈值（修 B8）

**函数**：`_scoreKeywords`（`:304-319`）、`classifyTopicMulti`（`:367-392`）

```js
const ABS_FLOOR = 2      // 替代 MIN_SCORE=3 的绝对门槛（保留 MIN_SCORE 作为 ABS_FLOOR 别名以兼容）
const MARGIN = 1.5       // top1/top2 边际，低于此值视为 lowConfidence

// _scoreKeywords 返回 hits 时附带置信标记
// classifyTopicMulti 中：
const lowConfidence = hits.length > 0 &&
  !(hits[0].score / (hits[1] ? hits[1].score : 1) >= MARGIN)   // top2 不存在时视为高置信
// lowConfidence 的条目仍给主标签（保持 UI 可用），但进入 LLM 送审集合（见 P1-3）
```

**权衡说明**：单纯调低 `MIN_SCORE` 会重新引入 v2 的误判面；**必须与负向词（P0-4）同时上**，否则是把 B8 换成 B7。

### P1-2 `classifier.js` — 主标签语义优先级（修 B9）

**函数**：`classifyTopicMulti`（`:383-386`）

```js
// 现状：primary + hits 顺序 = 纯分数序
// 改为：跨域复合题按「实体归属」而非「词长」排主标签
// 最小实现：定义 DOMAIN_PRIORITY_FOR_MIXED，当两条命中分差 < MARGIN 时，
// 按「主语先于宾语」的启发式重排（人物/情感域优先于工具域）
const MIXED_ORDER = ['emotion', 'entertainment', 'society', 'finance',
                     'education', 'health', 'international', 'ai', 'tech']
// 仅当 hits[0].score / hits[1].score < MARGIN 时才应用 MIXED_ORDER 重排
```

**验证锚点**：`«和 AI 聊天机器人谈恋爱»` 的 `categories[0]` 应为 `emotion`。

### P1-3 `hot-topics-service.js` — LLM 送审集合改造（修 B5，最关键）

**函数**：`_applyLlmLabels`（`:372-410`）

```js
// :376-388 —— 替换「只收 general」
for (const t of topics) {
  const cached = labels[cacheKey(t.topic)]
  if (isUsableLabel(cached)) { applyLabel(t, cached); continue }
  if (Object.prototype.hasOwnProperty.call(labels, cacheKey(t.topic))) continue
  // 送审条件：原先只有 category==='general'，现扩展
  const needsLlm = t.category === 'general'
    || t.lowConfidence === true                 // 来自 P1-1
    || (t.classifyDisagreement === true)        // 原生与关键词冲突（P0-1 留痕）
  if (needsLlm) need.push(t)
}
// :389 batch = need.slice(0, LLM_BATCH_LIMIT) —— 加优先级排序，避免永远只有头部被处理
need.sort((a, b) => (b.priority || 0) - (a.priority || 0))
//   priority: general=1, lowConfidence=2, disagreement=3
```

### P1-4 `hot-topics/llm-classifier.js` — 缓存键 + 校验 + 留痕（修 B6）

**函数**：`createLlmTopicClassifier` 返回的 `llmClassify`（`:23-68`）

```js
const PROMPT_VERSION = 'v2'   // 新增，进缓存键

// :24-27 —— 不再对长文本静默截断成同 key；改为保序 + 记录 index→hash 映射
const list = (Array.isArray(topics) ? topics : []).slice(0, BATCH_LIMIT)
  .map(t => ({ text: String(t || ''), key: cacheKey(String(t || '')) }))
  .filter(x => x.text.trim())

// :50-63 —— 加「返回数 == 请求数」校验 + 不覆盖已有 label
const parsed = JSON.parse(m[0])
const returned = Object.keys(parsed || {}).length
if (returned < Math.ceil(list.length * 0.8)) return {}   // 返回严重不全 → 整批丢弃

// 返回值改为带元信息的结构（调用方 _applyLlmLabels 同步适配）
out[list[idx].text] = { label, model: providerId, promptVersion: PROMPT_VERSION, decidedBy: 'llm' }
```

**同时**：`cacheKey()` 统一为 `sha1(NFKC(text).trim().toLowerCase())`，服务层与分类器共用同一实现（放 `hot-topics/classifier.js` 导出，避免两份口径）。

### P1-5 `hot-topics-service.js` — 失败记忆（修 B6-#6）

复用 `ChannelBreaker`（`:97-123`）模式，为 LLM 增加 `this.llmBreaker`：连续 3 次空返回/抛错 → 冷却 30min，冷却期内 `_applyLlmLabels` 直接 return（并 warn 一次），避免每轮重复计费。

### P2-1 LLM 标签缓存结构升级 + 兼容读取

**函数**：`_readLlmLabels`（`:181-191`）、`_writeLlmLabels`（`:193-204`）

```js
// 读：兼容旧格式（string label → { label, decidedBy:'keyword', legacy:true }）
// 写：{ [hashKey]: { label, model, promptVersion, decidedBy, ts } }
//     LLM_LABELS_MAX 裁剪改为「按 ts 最旧优先」而非插入序（:197-199）
```

### P2-2 `HotTopics.vue` — 展示/过滤口径对齐（修 B11）

**位置**：`:144`（展示 `slice(0, 2)`）、`:366-370`（计数全部）、`:378`（过滤全部）

三选一，建议**方案 A**：

- **A（推荐）**：展示改为「当前筛选分类的标签优先展示」——当 `activeCategory !== 'all'` 时把它在前的标签提到首位展示，保证用户看到的标签与所处分类自洽；
- B：展示数从 2 提到 3，与存储一致；
- C：过滤只按主标签（会牺牲多标签召回，不推荐）。

### P2-3 跨端契约同步与注释修正

- `apps/desktop/electron/services/content-categories.js:15` 注释「只认这 10 个 key」→ 11；
- `apps/desktop/src/features/content/content-categories.js:2` 注释「内置 10 类」→ 11；
- 若采纳 P2-1 的缓存结构，`PRD-HOT-TOPICS-CATEGORY-SUPPLY-2026-09-20.md:61` 的数据契约表需同步。

### P2-4 测试与评测接线

- 修 `classifier.test.js`（当前 `TypeError: Cannot read properties of undefined (reading 'config')`，见 §2.9）——确认其运行环境（vitest vs `node --test`）并使其通过；
- 新增 `classifier.eval.test.js` + `01-docs/research/fixtures/hot-topics-golden.jsonl`（§五）；
- 把 §2.8 的 ❌ 反例逐条写成回归用例（V4）。

---

## 附：本报告的取证边界（不掩饰未完成项）

| 项 | 状态 |
|---|---|
| `classifier.js` / `llm-classifier.js` / `hot-topics-service.js` / `channels.js` / `scorer.js` / `HotTopics.vue` 通读 | ✅ 已读（按 §0 SHA） |
| 分类行为实测（`node` 直接调用 `classifyTopicMulti`） | ✅ 已实测 26 例，输出见 §2.8 |
| DailyHotApi 数据类型契约 | ✅ 一手（`src/types.d.ts`，`master` 分支，经 GitHub API 读取） |
| tophub.today 分类粒度 | ✅ 一手 HTML（`/c/tech` 页导航，43 个 `/c/` 链接） |
| 中文短文本分类 / TF-IDF / BM25 工程做法 | ⚠️ **搜索摘要级**：检索结果标题与链接可用，但正文未逐篇打开核实（环境限制见 §三 开头说明） |
| LLM 置信度校准 / FrugalGPT / 主动学习 | ⚠️ **搜索摘要级**：同上，给出 arXiv 编号与检索题名供后续核实 |
| `ops-center` 侧分类目录 | ✅ 已读（`content_category_service.py:44-56`，11 项，与桌面端一致） |
| 完整评测指标基线 | ❌ **未运行**：标注集（§5.1）尚不存在，§5.2 门槛为**建议值**，须先跑基线再定 |
| `ai` 补拉源的端点可用性 | ❌ **未实测**：§六 P0-3 的候选源（微博 `科学科普` 垂类、tophub `/c/ai`）需按 PRD 既有做法实跑探测后再定稿 |
| 品牌词门禁 | ✅ 本文件未出现禁止词 |
