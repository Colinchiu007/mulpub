# 设计：热门选题多源扩展 + AI 分类 + 归类准确性（hot-topics-multi-source-ai-category）

## 1. 分层与影响面

```
渲染层  src/views/HotTopics.vue            CATEGORY_KEYS / CHANNEL_KEYS
        src/locales/hot-topics/{zh,en}.js   分类名 + 渠道名文案（成对）
        src/locales/content-categories/{zh,en}.js  分类名（成对）
        src/features/content/content-categories.js 内置 11 类（渲染层 ESM）
        src/composables/useContentCategories.js    fail-open 口径说明
主进程  electron/services/hot-topics-service.js    渠道配置 / 抓取 / 补拉 / LLM 兜底
        electron/services/hot-topics/channels.js   各端点解析器
        electron/services/hot-topics/classifier.js 分类器 v3
        electron/services/hot-topics/scorer.js     渠道权重
        electron/services/content-categories.js    内置 11 类（主进程 CJS 孪生）
运营端  ops-center/backend/services/content_category_service.py  CATALOG（唯一真源）
```

**跨端契约（唯一真源 = `CATALOG` 与 `CATEGORY_KEYS` 必须键名与顺序一致）**：
五处必须有测试锁死一致性，任一处漏改都会造成「运营端能配、桌面端认不出」的静默漂移。

## 2. 关键设计决策

### 2.1 原生分类分三级置信度（而不是「强/弱」两档）

| 档位 | 载体 | 语义 | 裁决位置 |
|---|---|---|---|
| 可信原生 | `RAW_CATEGORY_MAP` + `GENERIC_RAW_MAP` | 渠道明确声明了内容域（如头条「财经」、B站「软件应用」） | 主标签第 1 优先；也是零信号时的兜底 |
| 宽泛桶 | `RAW_CATEGORY_WEAK_MAP` | 一个桶里混装多个内容域（B站「知识」、微博「科学科普」、「汽车」） | **仅**关键词零命中时兜底 |
| 域级泛称 | `DOMAIN_LEVEL_RAW` | **栏目名**，不是单条选题的定性（科技/互联网/科学科普/知识/资讯/热点） | **不参与裁决**，一律返回 `null` |

**为什么域级泛称要单独成档**：用户看到的症状正是「科技类别下有和科技不沾边的内容」。
`'科技'` 作为一个榜单栏目名，它约束的是**栏目**而不是**单条**；把它当作单条定性，
等价于宣称「科技栏目里的每一条都是科技」。落地方式是最小改动：
`_mapNative` 对 `DOMAIN_LEVEL_RAW` 直接返回 `null`，该条目的分类完全交关键词裁决，
关键词也无信号时落 `general`（综合）——**把噪声放进「综合」比放进「科技」更不容易误导用户**。

代价已知且可接受：`classifyTopic('科技','toutiao','任意文本')` 从 `tech` 变为 `general`，
原 v2 契约测试随之更新并在测试里写明变更理由。召回由关键词表 + `CATEGORY_BOOSTS.tech` 补拉兜住。

### 2.2 关键词强/弱 + 阈值

- strong 命中权重 = 词长 × `STRONG_MULT(2)`；weak = 词长。
  strong 放**分类名本身与专有术语**（科技/财经/健康/半导体/A股/世界杯…），
  weak 放**泛化词**（消费/比赛/父母/手机…），单靠 weak 不足以定性。
- `MIN_SCORE = 3`：双字弱词 = 2 分 < 3 ⇒ **单个双字弱词不足以成类**。
  这是修「`score += kw.length` 让一个泛化词把无关选题钉进某类」的最小手段。
- 词表内**禁止裸单字**（中文无词边界，裸字必然误伤：v1 的 `'判'` 吞掉「判定」）；
  测试 `关键词规则内不得出现裸单字` 机械锁死这条纪律。

### 2.3 拉丁词边界 + 全角归一

`text.includes('AI')` 会命中 `Air` / `said`。改为：纯拉丁/数字关键词要求**前后不是 `[A-Za-z0-9]`**，
中文关键词仍走子串（中文没有词边界，且强行切词会引入第二份切词逻辑 —— 与本仓
`tokenizeContentWords` 唯一实现的纪律冲突）。另加全角 ASCII → 半角归一（中文输入法下 `ＡＩ` 很常见）。
**刻意不做的**：拼音/缩写消歧（`Sora` 命中人名、`Kimi` 命中人名）——没有证据表明这是主要错源，
加规则属于无依据的复杂度，登记为 P2。

### 2.4 `general` 语义收窄

`general` 只表示「无判别力信号」。一旦文本给出了任何真实分类，就从标签里剔除 `general`。
理由是 `general` 同时承担「综合资讯」与「未命中兜底」两种语义时，
分类计数与空态判定都会被污染（「有信号但被 general 占位」看起来像没信号）。

### 2.5 补拉条目走分类器（不再硬挂 `boostCategory`）

v2 把补拉条目 `category` 无条件写成 `source.boostCategory`，分类器完全不参与 ——
垂类端点里夹带的异质条目会被强行挂到目标分类下。v3：先走分类器，分类器判出明确分类则以它为准，
**只有 `general` 才用 `boostCategory` 兜底**（垂类榜本身就是该分类的定向供给，兜底仍保供）。
新增 `onlyCategory` 用**分类器本身**做筛选（如从 IT之家 RSS 里筛出 AI 条目），
避免新增第二份关键词表造成判据漂移。

### 2.6 渠道抓取的两条新合同

| 合同 | 内容 | 为什么 |
|---|---|---|
| 空列表视为失败 | 解析出 0 条时抛错 → 走 fallback → 全失败则 `recordFailure` | 抖音缺 UA/Referer 时是「200 + 空 `word_list`」；记成功会让熔断器永不打开、界面只显示「0 条」而无任何可排查信号 |
| fallback 顺序降级而非并发 | 主端点失败/空 → 依次尝试 `config.fallbacks` | 同源端点并发①放大平台风控面 ②同源条目跨渠道去重后会被算成 `sourceCount>=2`，把 `sourceBonus` 这个「全民热点」信号灌成假的 |
| 406 单独告警 | 错误信息含 406 时打一条点明「shield 固定头已失效，需人工更新静态常量」的 warn | 这是小红书唯一需要人工介入的故障形态，混进普通网络失败会让排查成本极高 |

`fallbacks` 条目的解析器默认**继承主端点解析器**，只有声明了自己的 `parser` 才覆盖
（凤凰网内联出口字段名不同，故显式声明 `ifeng_inline`）。

### 2.7 凤凰网内联兜底必须做花括号配对

`i.ifeng.com` 的 `allData` 是**内嵌多行 JSON**，用 `\{[\s\S]*?\}` 惰性正则会截断在第一个 `}`；
`www.ifeng.com` 恰好是单行、惰性匹配可用 —— 这正是「隐蔽陷阱」的形态（换个出口就静默少数据）。
故实现 `extractIfengAllData` 做配对扫描并跳过字符串字面量与转义。

## 3. 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
|---|---|---|---|
| 小红书 `shield` 静态 token 被平台轮换 | 该渠道 406、无可抓数据 | 406 单独告警；`intervalMinutes=30`、`riskLevel=high`；熔断 3 连败冷却 30 分钟 | 替换常量即可；或临时从 `CHANNEL_CONFIGS` 摘除该行 |
| 凤凰网 `ne883dbn.ifeng.com` 主机名由前端 `__nd__` 动态下发、可能换域 | 主端点失败 | `fallbacks` 指向 `i.ifeng.com` 内联出口 | 换 URL 常量 |
| 抖音端点加风控 | 主端点空列表 | 两级 fallback（其中 `aweme-lq.snssdk.com` 零头部可用） | 摘除该渠道 |
| 域级泛称降级使 tech 条目减少 | tech chip 变稀疏 | 关键词表扩充 + `CATEGORY_BOOSTS.tech` 补拉（threshold=6） | 从 `DOMAIN_LEVEL_RAW` 移除 `'科技'` |
| 词表调整导致个别类召回变化 | 个别选题落 general | 测试覆盖 8 类正例 + 6 条根因反例；`general` 占比纳入 P1 评测指标 | 回退单个词表条目 |
| `MAX_TOPICS=400` 在 10 渠道 × 50 候选下截断 | 最低热度尾部条目被丢弃 | 统一热度评分后截断（保头部即保热点）；上限兼顾 IPC 载荷 | 调大常量（需同步评估 IPC 载荷） |

## 4. 未落地项（登记为后续迭代，不在本 change 范围）

1. **LLM 送审集合**：仍是「只处理 general」，已错判为具体分类的条目永不进 LLM。
   第一性修法是改为 `general ∪ lowConfidence ∪ 原生/关键词冲突` 并按优先级排序。
2. **LLM 置信度与二次裁决**：现无 confidence，`temperature:0` 不提供可靠性信号。
3. **LLM 标签缓存键**：用原始 topic 文本，未归一化；换模型后旧标签仍命中、无法归因。
4. **评测集与混淆矩阵**：调研报告给出了门槛建议，但**标注集尚不存在、基线未跑**，
   不得当作已验证。
5. **UI 展示 2 / 存储 3 / 过滤全部 的口径不一致**（`HotTopics.vue` 标签只渲染前 2 个，
   但过滤按全部标签）——改它会动到视觉回归基线，本轮不动。
6. **快速采集源注册表**未同步新增平台（属另一模块，其测试要求「不存在需要登录态的源」）。
