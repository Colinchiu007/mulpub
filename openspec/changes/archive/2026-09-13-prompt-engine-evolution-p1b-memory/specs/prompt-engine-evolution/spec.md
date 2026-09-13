## ADDED Requirements

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
