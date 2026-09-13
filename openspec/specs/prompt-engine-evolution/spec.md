# prompt-engine-evolution Specification

## Purpose
提示词引擎自进化闭环的规格基线：生成反馈采集（GenerationEvent/FeedbackEvent 双日志）支撑经验沉淀与统计，主题指纹（Topic Fingerprint）与同类模板检索支撑候选重排与经验复用，构成「采集→评估→记忆→优化→治理」闭环。
## Requirements
### Requirement: GenerationEvent 主记录 append-only
生成反馈管道 SHALL 以 GenerationEvent 为主记录，写入 `userData/generation-logs/YYYY-MM.jsonl`（append-only，月轮转，30 天清理）。字段含：id、schemaVersion、ts、engine(image|video)、mode(story2video|standalone|storyboard)、context{tenantId,userHash(加盐HMAC),sessionId,appVersion}、input{concept,creativeLevel(1..10),stylePreset,enrichment}、prompt{raw,optimized,optimizedBy,templateVersion,librarySource,experimentId/armId,structured}、provider{name,model,params}、result{status(success|failure|partial),errorCode,outputRefs,durationMs,costEstimate}。写入失败 SHALL catch+warn，不得阻断生成主流程。

#### Scenario: 一次生成产生完整主记录（P1 接线）
- **WHEN** Story2Video 流水线完成一次图片/视频生成且已接入 `recordGeneration` 生产调用点（P1 交付项，本 change 不实现）
- **THEN** 写入一条含 input/prompt/provider/result 的 GenerationEvent 到当月 JSONL，字段通过 schema 校验
- **AND** 本 change（P0）仅交付采集器能力与反馈回填流；`onEvent` 钩子已就绪（`generateImagePromptsSmart` 可选参数），生产调用方接线列入 P1 tasks

#### Scenario: 写失败不阻断主流程
- **WHEN** 日志目录不可写或磁盘满导致追加失败
- **THEN** 采集器捕获并 warn，生成主流程继续返回正常结果

### Requirement: FeedbackEvent 回填流按 eventId join
用户操作反馈 SHALL 独立写入 `feedback-log.jsonl`（append-only），字段含 eventId、ts、type(accepted|regenerated|edited|downloaded|deleted|published)、detail{accepted,regenerated,editedFields,downloaded,publishedTo}。eventId 必填且必须能 join 回主记录；无法 join 的反馈 SHALL 记录为 orphan 并告警，不丢弃。

#### Scenario: 采纳操作回填
- **WHEN** 用户在结果页点击采纳某个候选
- **THEN** 渲染进程经 generation:feedback 上报 {eventId, type:accepted}，写入 feedback-log 且与主记录 join 成功

#### Scenario: 孤立反馈标记
- **WHEN** 上报的 eventId 在 generation-log 中不存在
- **THEN** 反馈仍写入但标记 orphan，采集器输出告警

### Requirement: generation:feedback IPC 契约
桌面端 SHALL 提供 `generation:feedback` IPC（渲染→主进程），沿用 `code+data+message` 返回约定与 `core/error-codes.js` 的 EC 常量；入参必须为纯 JSON；eventId 或 sessionId 至少其一必填；校验失败返回对应 EC 错误码。

#### Scenario: 合法上报返回成功
- **WHEN** 渲染进程调用 generation:feedback 且 eventId 非空、type 合法
- **THEN** 返回 {code:0}，反馈已写入 feedback-log

#### Scenario: sessionId 关联解析
- **WHEN** 调用 generation:feedback 未携带 eventId 但携带 sessionId
- **THEN** 采集器从当月 generation-log 解析最新同 session 生成事件作为 eventId；解析失败时按孤儿反馈写入（标记 orphan，不丢弃）

#### Scenario: eventId 与 sessionId 皆缺拒绝
- **WHEN** 调用 generation:feedback 未携带 eventId 且未携带 sessionId
- **THEN** 返回校验错误码，不写入日志

### Requirement: 采集开关三态
采集能力 SHALL 支持 config 三态：全开（默认）/ 停写（不写新日志，保留已写）/ 停上报（本地照写，不上报）。开关变更即时生效。

#### Scenario: 停写后不再追加
- **WHEN** config 设置 evolution.collection=muted
- **THEN** 采集器不再追加新日志，已写日志保留

### Requirement: 基础统计
采集器 SHALL 提供按 engine 聚合的基础统计：acceptRate（采纳数/展示数）、regenerateRate（重新生成数/展示数）、平均耗时（durationMs 均值），供 `prompt-library:list` 之外的只读查询使用。

#### Scenario: 统计聚合
- **WHEN** 存在多 engine 的生成与反馈记录
- **THEN** 统计按 engine 分组返回 acceptRate/regenerateRate/avgDurationMs

### Requirement: 测试隔离与契约
反馈管道测试 SHALL 使用 `os.tmpdir()` 下带 PID/随机标识的独立路径；JSONL 读取须容忍尾部残缺行；不得依赖真实 userData 或仓库内共享路径。

#### Scenario: tmpdir 隔离
- **WHEN** 运行反馈管道测试
- **THEN** 日志路径位于 os.tmpdir() 唯一目录，测试结束清理，不触碰真实 userData

### Requirement: 主题指纹构建
系统 SHALL 从输入主题文本构建 Fingerprint：{schemaVersion, dictVersion, domains[], compositionIntents[], topics[], tone}。domains 来自 DOMAIN_DICTIONARY（6 领域，强词 1 词即中、弱词 ≥2 词）；compositionIntents 来自 applyWhen ∪ INTENT_ALIASES（强档 1 词、弱档 ≥2 词）；topics 来自 extractTopics（≤8 个、≥2 字符、剔除词典词）；tone 复用 SentimentAnalyzer 语义（positive/negative/peaceful）。输入长度 SHALL 截断至 ≤2000 字符。

#### Scenario: 同词面主题指纹
- **WHEN** 输入 "AI 改变教育"
- **THEN** fingerprint.domains 含 tech（AI 强词）与 education（教育强词），compositionIntents 含 前后对比（"改变"强档别名），topics 为空（词典词已剔除），tone=peaceful

#### Scenario: 英文词边界不误判
- **WHEN** 输入含 domain/design/maintain/apple
- **THEN** 不命中 tech（"AI" 仅命中独立 token，"app" 不命中 apple）

### Requirement: 同类模板检索与置信档位
系统 SHALL 提供 findSimilarTemplates(concept, {rand})，按 score = 4×min(2,|intents∩|) + 2×min(2,|domains∩|) + 2×min(2,|topics∩|) + 1×(tone 相同且双方≠peaceful) 计算，置信档位：intent∩=0 → NONE；4≤score<8 且 intent≥1 → MID（fragment）；score≥8 且 intent≥1 → HIGH（full，额外要求 domains∩≥1 或 topics∩≥1）。返回 {templateId, refType, score, tier, provenance}。探索 ε 仅限 active 模板集内重排，activeCount<10 时 ε=0，rand 注入可测。

#### Scenario: 示例回归
- **WHEN** 输入 "AI 改变教育" 且库中模板 {intents:[前后对比], domains:[education,tech], topics:[], tone:positive}
- **THEN** score=8 → HIGH → refType=full（domains∩≥1 满足护栏）

#### Scenario: 无意图强制 NONE
- **WHEN** 输入 "公司融资策略"（intents 无命中）
- **THEN** 返回 NONE，refType=none，templateId=null

### Requirement: 词典与词表单一来源一致性
fingerprint 使用的 applyWhen 意图词与 SentimentAnalyzer 情感词 SHALL 与 story2video-engine TS 权威版保持一致，经 parity 测试锁死；JS 词表副本与 TS 源逐字对齐。

#### Scenario: parity 一致性
- **WHEN** 运行 fingerprint parity 测试
- **THEN** JS 副本的 COMPOSITION_PATTERNS.applyWhen 8 组词与 SentimentAnalyzer 12 情感词与 TS 权威版逐项一致

### Requirement: 测试隔离与确定性
指纹模块测试 SHALL 使用 os.tmpdir() 独立路径（如涉及持久化）；extractTopics 切分/去重/排序 SHALL 确定性；rand 注入保证探索可测；全不命中时回退内置 COMPOSITION_PATTERNS 全集（行为不变）。

#### Scenario: 回退内置
- **WHEN** 输入与库中模板全不匹配
- **THEN** 返回 NONE 且调用方回退内置 8 构图（findSimilarTemplates 自身不改变内置池）

### Requirement: 记忆库模板结构与版本化存储
系统 SHALL 提供 PromptMemory 记忆库，以 `prompt-library/library.json` 索引 + `templates/<id>@<version>.json` 版本化文件持久化模板。模板字段含 id、engine(image|video)、mode(story2video|standalone|storyboard)、type(composition|style|keyword|metaphor|full)、version、content(结构化)、sourceText(≤2000 字符生成概念原文)、fingerprint{schemaVersion, dictVersion, domains, compositionIntents, topics, tone}、source(builtin|learnt|manual)、provenance{learnedFrom,acceptedEvents}、stats{uses,acceptRate(滑窗),avgScore,avgCost,lastUsedAt}、state(draft|active|deprecated|disabled)、createdAt/updatedAt/confirmedBy(userHash 加盐 HMAC)、guard{checksum,validatedAt,gateRules,evaluatorVersion}。learnt fragment 的 content 仅允许 compositionType/action/object/creativeLevel 四类可控参数，越界字段入库即拒绝。加载时校验 dictVersion，不匹配则以 sourceText 惰性重算指纹，无法重算的标 stale 不参与检索；fingerprint 缺失的模板 fail-close 不参与检索。

#### Scenario: learnt fragment 仅四类参数
- **WHEN** 提交的 learnt fragment content 含 color/keywords/metaphor 等越界字段
- **THEN** 入库被拒绝并返回门禁错误码，不产生模板文件

#### Scenario: dictVersion 变更以 sourceText 重算
- **WHEN** 记忆库模板指纹的 dictVersion 与当前 DICT_VERSION 不一致
- **THEN** 以模板 sourceText 惰性重算指纹后参与检索；sourceText 缺失时标 stale 不参与检索

#### Scenario: fingerprint 缺失 fail-close
- **WHEN** 模板文件存在但 fingerprint 缺失或不可解析
- **THEN** 该模板不参与检索，加载时告警且其余模板保持可用

### Requirement: 门禁 6 规则
系统 SHALL 在 learnt/manual 模板进入 draft 前执行门禁 6 规则：structure（按 engine/mode 分档字段完整；fragment 四类参数白名单 + compositionType 值域校验）、compliance（合规词表）、length（按 engine 分档：storyboard 中文 50..2000 字符、英文 prompt 50..200 词）、noSecrets（疑似指令注入模式；匹配器只做预编译 token 查找，不得把用户输入拼进正则）、dedup（checksum 精确去重；近重复聚类淘汰归 P2）、evaluatorVersion 记录。任一规则失败，模板不得进入 draft。

#### Scenario: 门禁拦截注入模板
- **WHEN** 待入库模板 content 含疑似指令注入模式（如越权指令/分隔符逃逸）
- **THEN** noSecrets 规则失败，模板拒绝进入 draft，返回门禁错误

#### Scenario: checksum 完全碰撞拒绝
- **WHEN** 提交模板 content 的 checksum 与库内 active 模板完全一致（非同源升版）
- **THEN** dedup 规则失败拒绝入库，返回门禁错误

### Requirement: 模板状态机
系统 SHALL 提供模板状态机：learnt 模板必经 门禁通过 → draft →（人工确认）→ active → deprecated → disabled。V0 仅支持人工确认激活；数据确认阈值（图片 llm≥7.0 或 accepted 累计≥3、视频平台 valid_positive≥5）依赖 P1a score-log 与 P2 平台回灌，不在 V0。内置池不落库，回退路径保持生成器内置 COMPOSITION_PATTERNS 不变。仅 active 模板参与同类检索与生成引用；deprecated/disabled 即使高分也不得被引用。

#### Scenario: learnt 状态流转与检索边界
- **WHEN** 一个 learnt 模板经 save 入库且过门禁
- **THEN** 状态为 draft，不参与检索；activate（人工确认）后状态 active，可被 findSimilarTemplates 命中；置 deprecated 后即使高分也不可命中

### Requirement: 滑窗退化回滚与冷却
系统 SHALL 提供滑窗回滚能力：acceptRate 连续 N 期低于阈值或 avgScore 下滑超过阈值时，自动将模板置为 deprecated 并回退上一版本或内置池；回滚后进入冷却期防抖，冷却期内不重复回滚同一模板。statsProvider 为可注入接口；按 templateVersion 聚合的生产数据源依赖 P1 recordGeneration 生产接线与 P1a score-log，V0 以注入数据验证回滚判定。回滚判定全部指标化可测。

#### Scenario: 连续下滑触发回滚且冷却
- **WHEN** 注入的 statsProvider 返回 acceptRate 连续 N 期低于阈值
- **THEN** 模板自动置 deprecated 并回退上一版本；冷却期内再次触发不重复回滚

### Requirement: 成本配额
系统 SHALL 按 engine 提供每日成本配额（config evolution.budget 按引擎 dailyBudget）；配额超限时停止自动评分与入库评估；视频引擎默认零自动评分。配额超限不得阻断生成主流程（评估降级跳过，生成继续返回正常结果）。

#### Scenario: 配额超限降级不阻断
- **WHEN** 图片引擎当日配额超限或视频引擎默认零评分
- **THEN** 自动评分/入库评估跳过，生成主流程继续返回正常结果

### Requirement: prompt-library IPC 契约
桌面端 SHALL 提供 `prompt-library:list`（真实只读列表，保持 P0 响应 envelope `data:{templates, evolution}` 兼容）、`prompt-library:get`（单模板详情）、`prompt-library:save`（learnt 模板入库，过门禁进 draft；入参 {engine, mode, type, content, concept, eventId}，eventId 必填且校验 evt_ 前缀，concept ≤2000 字符用于计算 fingerprint/sourceText）、`prompt-library:activate`（draft→active 人工确认）四个 IPC 通道，沿用 `code+data+message` 返回约定与 `core/error-codes.js` EC 常量（TEMPLATE_* 系列占用 -20..-23 段）；入参必须为纯 JSON；校验失败返回对应 EC 错误码。

#### Scenario: save 合法入参进入 draft
- **WHEN** 调用 prompt-library:save 且入参合法（engine/mode/type/content/concept/eventId 齐备且过门禁）
- **THEN** 返回 {code:0, data:{id, version, state:'draft'}}，模板已写入记忆库并计算 fingerprint

#### Scenario: save 缺 eventId 或格式非法拒绝
- **WHEN** 调用 prompt-library:save 未携带 eventId 或 eventId 非 evt_ 前缀
- **THEN** 返回校验错误码，不写入记忆库

#### Scenario: save 携带非法 mode 拒绝
- **WHEN** 调用 prompt-library:save 携带非枚举 mode
- **THEN** 返回校验错误码，不写入记忆库

#### Scenario: activate 不存在模板拒绝
- **WHEN** 调用 prompt-library:activate 指向不存在的模板 id
- **THEN** 返回错误码，状态不变

#### Scenario: list 保持 P0 envelope
- **WHEN** 调用 prompt-library:list（含空库）
- **THEN** 返回 {code:0, data:{templates:[...], evolution:state}}，结构与 P0 骨架兼容

