## ADDED Requirements

### Requirement: 素材源清单是声明式的唯一真源

系统 SHALL 用一个声明式源注册表（`apps/desktop/electron/services/quick-collect-sources.js`）表达全部素材源，
每条源 SHALL 声明 `{ id, label, kind ∈ {search, trend}, sourceType ∈ {hottest, realtime}, timeKind ∈ {published, observed},
expectedDomains, intervalMinutes, riskLevel, group }`。指令校验的源闭集 SHALL 从该注册表派生
（`ALL_SOURCE_IDS`），SHALL NOT 存在第二份手写清单；`quick-collect-command.js` SHALL 继续导出 `ALLOWED_SOURCES`
（值为派生结果）以保持既有消费者兼容。

#### Scenario: 未知源被拒绝
- **WHEN** 提交 `sources: ['weibo', 'weixin-mp']`
- **THEN** 校验返回 `{ ok: false, code: 'QC_SOURCES_INVALID' }`，且 `weixin-mp` 不被静默忽略后放行

#### Scenario: 跨平面清单一致
- **WHEN** 主进程注册表新增一个源而渲染端镜像清单未同步
- **THEN** 跨平面 parity 测试失败并点名该源 id

### Requirement: 素材时间分两种语义且都可为空

系统 SHALL 在素材上区分 `timeKind = 'published'`（源自报发布时间，取 `createdUtc`）与 `timeKind = 'observed'`
（源无发布时间，取抓取时刻 `observedAt`）。窗口过滤 SHALL 使用「有效时间」＝按 `timeKind` 选择的时间字段；
两种时间皆缺且 `windowHours > 0` 时 SHALL 以 `missing_time` 丢弃该素材。

#### Scenario: 榜单素材按抓取时刻通过窗口
- **WHEN** 一条 `timeKind='observed'`、`observedAt` 为当前时刻的榜单素材，在 `windowHours=48` 下合并
- **THEN** 该素材被保留，且产出素材带 `timeKind='observed'` 与 `observedAt`

#### Scenario: 缺时间的素材仍被丢弃
- **WHEN** 一条 `timeKind='published'` 但 `createdUtc` 缺失的素材，在 `windowHours=48` 下合并
- **THEN** 被丢弃并计入 `dropped.missing_time`（行为与既有实现一致）

#### Scenario: 未来时间戳被拒绝
- **WHEN** 素材有效时间晚于 `now + 86400s`
- **THEN** 被丢弃并计入 `dropped.future_time`

### Requirement: 榜单素材不得被表述为发布时间

系统 SHALL 在提示词的 system 段声明「榜单类素材只有名次与抓取时刻，不得写成发布时间」，SHALL 在素材清单行内
标注时间语义（`observed` 写「抓取时刻」，`published` 写「发布」），并在 `quickCollect` 元数据回传 `timeKinds`。
界面 SHALL 按两类时间语义分别标注来源。

#### Scenario: 提示词包含硬约束
- **WHEN** 构建任意快捷采集指令的消息
- **THEN** system 文本包含该硬约束条款，且素材行含对应时间语义标签

### Requirement: search 与 trend 源分流且旧指令行为不变

系统 SHALL 按 `kind` 分流：`search` 源经既有 `searchFn`（逐关键词，行为逐字不变），`trend` 源经注入的 `trendFn`
（一次调用）。检索三态口径 SHALL 为 `attempted = searchQueryCount + trendSourceCount`；`trendFn` 未注入时
SHALL 降级为「该分支不产出素材」，SHALL NOT 抛出异常中断执行。

#### Scenario: 纯英文指令不触发 trend 分支
- **WHEN** 指令源集合仅含 `reddit/hackernews/github`
- **THEN** `trendFn` 不被调用，且检索结果、三态与既有实现逐字一致

#### Scenario: 纯榜单指令不被判为 skipped
- **WHEN** 指令无关键词但含趋势源且 `trendFn` 返回素材
- **THEN** `retrieval` 为 `ok`，`quickCollect.trendSources` 非空

#### Scenario: 趋势源未接线时降级
- **WHEN** `trendFn` 未注入而指令含趋势源
- **THEN** 执行不抛错，素材为空、`retrieval` 为 `empty` 或 `skipped`（按其真实情况），并插入引擎声明行

### Requirement: 单源失败整源丢弃且可归因

系统 SHALL 对每个源记录 `sourceStats[src] ∈ {ok, skipped, failed}`；单源失败 SHALL 只影响该源，
SHALL NOT 逐条污染其他源；来源域名不在该源 `expectedDomains` 内的条目 SHALL 被丢弃并计入 `dropped.domain_mismatch`。
来源标签 SHALL 如实回显源 id，SHALL NOT 使用兜底品牌名。

#### Scenario: 单源失败仍出结果
- **WHEN** 3 个趋势源中 1 个抛错、2 个返回素材
- **THEN** 产出素材来自 2 个成功源，`retrieval='partial'`，`sourceStats` 明确标出失败源

#### Scenario: 域名不匹配被丢弃
- **WHEN** 标称来自 `weibo` 的条目 url host 为 `example.com`
- **THEN** 该条被丢弃并计入 `dropped.domain_mismatch`

### Requirement: 计划性空榜与真故障必须可区分

系统 SHALL 区分「源按计划无更新」（如 arXiv RSS `skipDays` 含周末）与「源故障」。前者 SHALL 标记为
`emptyBySchedule` 并在界面显示为「该源本期不更新」，后者 SHALL 计入 `sourceStats.failed` 并在界面显示为源不可用。

#### Scenario: 周末 arXiv 空榜
- **WHEN** 周六抓取 `arxiv_cs_ai` 返回仅含 channel 的空 feed
- **THEN** 该源状态为 `ok` 且标记计划性空，界面不显示为故障

### Requirement: 抓取层有字节与条数上限

系统 SHALL 对每个趋势源限制响应体处理上限（默认 512KB）与条目上限（默认 20/源），
SHALL 在超限时截断到完整条目边界，SHALL NOT 因单个超大响应阻塞采集流程。

#### Scenario: 超大响应被截断
- **WHEN** 某源返回 1.3MB 的 feed
- **THEN** 解析在 `MAX_BYTES` 处截断，产出条目数 ≤ `MAX_PER_SOURCE`，不抛异常

### Requirement: 不做登录态抓取且不记录用户原文

系统 SHALL NOT 实现需要用户登录态（Cookie/扫码）的素材源；日志 SHALL 只记录源 id、条数、失败原因与位置，
SHALL NOT 记录关键词、指令正文或用户草稿原文。

#### Scenario: 登录态源不在册
- **WHEN** 校验源注册表
- **THEN** 不存在任何标注需要登录态的源；公众号直采路径不存在于实现中
