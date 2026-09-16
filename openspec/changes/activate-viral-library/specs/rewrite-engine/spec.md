# rewrite-engine

## ADDED Requirements

### Requirement: 关键词提取模块

系统 SHALL 提供包级关键词提取模块 keyword-extractor，支持同步规则提取（中文 2-4 字贪婪切分 + 英文整词 + 停用词过滤 + 词频排序）与异步 LLM 兜底提取（严格 JSON 输出，解析失败返回空数组 fail-open）。

#### Scenario: 中文长文规则提取

- **WHEN** 输入 500 字以上中文长文调用 extractSync(text, 8)
- **THEN** 返回 1-8 个按词频排序的关键词，不含停用词

#### Scenario: LLM 兜底 fail-open

- **WHEN** 规则提取产出关键词 < 2 个且 LLM 调用失败或返回非法 JSON
- **THEN** 返回空数组，不抛错，改写主流程不受影响

### Requirement: 知识库关键词检索

爆款库与个人知识库检索 SHALL 先对查询文本做关键词提取，再按多关键词 OR 命中取候选集（上限 100），JS 侧按「关键词命中数×10 + log10(1+likes+collections+comments) + confidence×5」评分排序（个人库无互动中项），命中数为 0 的条目不返回；保留检索即强化（access_count/置信度重算/审计日志）行为。

#### Scenario: 长文改写检索命中

- **WHEN** 改写 500 字中文长文且库中存在同主题爆款
- **THEN** 检索返回该爆款，评分中关键词命中数权重最高

#### Scenario: 无关内容不返回

- **WHEN** 关键词与某条目零命中
- **THEN** 该条目不出现在结果中

### Requirement: 异步知识上下文构建

KnowledgeContextBuilder.buildFullContext SHALL 变更为 async；构造 opts 新增 llmKeywords 回调；仅当规则提取关键词 < 2 个时触发 LLM 兜底；检索为空不注入、未勾选不检索、三层皆空保持原行为。

#### Scenario: LLM 兜底触发条件

- **WHEN** extractSync 产出 ≥ 2 个关键词
- **THEN** 不发起 LLM 调用

## MODIFIED Requirements

### Requirement: 爆款风格注入

注入内容 SHALL 从浅层特征（标题模式+前100字+标签）升级为模式卡片聚合风格指导：检索 Top3 爆款加载模式卡片，聚合输出钩子建议（含标题公式）、情绪曲线、叙事结构、CTA、金句参考；卡片缺失或 failed 的条目回退浅层特征，全部缺失整体回退。
