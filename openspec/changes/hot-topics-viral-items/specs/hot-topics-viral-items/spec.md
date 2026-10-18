# hot-topics-viral-items 变更

## ADDED Requirements

### Requirement: 热门选题条目必须携带显式判别位

统一条目对象 MUST 携带 `kind` 字段，取值闭集为 `'topic' | 'item'`；该字段 MUST 为**必填**（由产出层写入，而非由消费层推断）。读取既有缓存或既有渠道产物时，`kind` 缺席 MUST 读作 `'topic'`，MUST NOT 触发任何数据迁移或反向改写。

#### Scenario: 旧数据向后兼容
- **WHEN** 缓存中的条目是本次改造前写入、不含 `kind` 键
- **THEN** 收集出口将其视为 `kind='topic'`，分类、评分、渲染行为与改造前逐字一致，且不产生任何写回

#### Scenario: 判别位由产出层负责
- **WHEN** 某个解析器产出内容条目但未写 `kind`
- **THEN** 该产物在采集出口被判为不合格并丢弃，同时输出一条点名该渠道与缺失字段的告警；MUST NOT 由渲染层"看起来像条目"来猜

#### Scenario: 取值闭集
- **WHEN** 上游产物里 `kind` 为 `'topics'`、`'video'`、空串或 `null`
- **THEN** 判为非法值并按 `topic` 不合格处理（丢弃 + 告警），MUST NOT 静默归一为任一合法值

### Requirement: 内容条目必须真正带有内容字段，否则不得进入列表

`kind='item'` 的条目若 `author`、`publishTime`、`interaction` **三者全部缺席或全部为 `null`**，MUST 在主进程**采集出口**被判定不合格并丢弃，MUST NOT 进入分类、评分、缓存或渲染。`interaction` 若存在，MUST 至少含一个非负整数项；只有 `undefined` 值的空对象 MUST 视为字段缺席。

#### Scenario: 装饰性升级被拦
- **WHEN** 某渠道把一个热搜词贴成 `kind='item'` 但未提供任何内容字段
- **THEN** 该条在采集出口即被丢弃，`classifier` 与 `scorer` 都收不到它，界面不出现"有作者位但空着"的行

#### Scenario: 部分字段仍算合格
- **WHEN** 条目只给得出 `author` 与 `interaction.like`，给不出 `publishTime`
- **THEN** 条目合格进入列表；`publishTime` 段不渲染，且不计为数据缺陷

#### Scenario: 空对象不等于零
- **WHEN** 条目带 `interaction: {}` 或 `interaction: { like: undefined }`
- **THEN** 按"互动段缺席"处理；MUST NOT 渲染成"点赞 0"

### Requirement: 字段缺席不得被兜底值替代

内容条目的 `author` MUST NOT 用渠道名、平台名、账号昵称兜底或任何其他字段的派生值替代；`publishTime` MUST NOT 用本地抓取时间、缓存时间或 `hot-topics` 刷新时间替代。任一字段无法取得时 MUST 保持缺席，界面 MUST 不渲染对应段。

#### Scenario: 作者未知
- **WHEN** 源响应里没有作者身份字段
- **THEN** 界面该行不出现作者段；MUST NOT 出现平台名占位（那等于给用户假证据）

#### Scenario: 发布时间未知
- **WHEN** 源只给出"热度"而无发布时间
- **THEN** 不渲染"发布于"，且排序 MUST NOT 把该条目按抓取时间当作发布时间参与时间衰减

### Requirement: 名次类派生量与平台自报热度不得互相冒充

归档/快照派生的 `daysOnBoard`（在榜天数）与 `peakRank`（峰值名次）MUST 存放在独立字段，MUST NOT 写入 `hotValue` 或由其换算；`hotValue` MUST 只承载**平台自报**热度读数。跨平台的原始数值 MUST NOT 直接比较大小，比较 MUST 发生在渠道内归一之后。

#### Scenario: 口径隔离
- **WHEN** 一条选题的归档标签为「在榜 5 天 / 峰值第 3」
- **THEN** `hotValue` 保持其原有来源值或 `null`，MUST NOT 被写成 `5` 或 `3`

#### Scenario: 跨渠道不比的量
- **WHEN** 抖音条目 `hotValue=12000000` 与小红书条目 `hotValue=947.5万` 同池排序
- **THEN** 排序使用各渠道内归一分；MUST NOT 因数值更大而把某一平台的条目整体置顶

### Requirement: 条目新字段必须逐层透传并有接线守卫

从主进程条目对象到界面实际渲染，新增字段经过的每一道**手工维护的白名单/映射**（IPC 返回体投影、渲染层 store 转发、视图取数）MUST 同时包含该字段，并 MUST 存在一条机械守卫：要么逐道断言白名单含该键，要么有一条「落盘 → store」的穿透断言。MUST NOT 以「两侧各自的单测通过」作为通过证据。

#### Scenario: 漏一层即红
- **WHEN** 某实现片在主进程加了 `author` 但漏了 IPC 投影白名单
- **THEN** 接线守卫判红并点名缺该键的那一道；症状"界面永远看不到作者"不作为唯一发现途径

#### Scenario: 反证
- **WHEN** 把某一层投影故意摘掉该字段
- **THEN** 该守卫必须变红且红在指名的那条用例上；若全绿则该守卫视为装饰性，不得登记为回归锁

### Requirement: 分类与评分必须按 `kind` 分流

`hot-topics/classifier.js` 与 `hot-topics/scorer.js` MUST 显式区分 `kind='topic'` 与 `kind='item'` 两条口径：内容条目的标题 MUST NOT 套用为热搜词设计的加权；跨渠道"多榜同现"类信号 MUST 只在同 `kind` 内累计。

#### Scenario: 不混算多榜同现
- **WHEN** 同一文本串既作为热搜词出现，又作为某条视频标题出现
- **THEN** 两者的 sourceBonus 类信号各自独立累计，MUST NOT 合并成"多平台同时热议"的假信号

### Requirement: 用户可见新增文案必须成对进 locales 且不裸写中文

条目模型带来的所有新增用户可见文案（作者段、互动段、缺席态提示）MUST 以 zh/en 成对写入 `apps/desktop/src/locales/**`，术语 MUST 与 `01-docs/i18n-glossary.md` 一致；渲染层 `src/` 非 locales 文件 MUST NOT 新增中文字符串字面量。

#### Scenario: 成对提交
- **WHEN** 新增文案只写进 `zh.js`
- **THEN** CI 的 locale 同步门禁拦截；MUST NOT 以"先只上中文"作为收口

### Requirement: 未核实的源字段不得进入规格或代码

任何**尚未以真实现场取证**的外部字段名、返回形状、权限要求与配额，MUST NOT 写入规格 Requirement 或代码常量；MUST 以显式 OPEN 项登记「待取证 + 取证方法」，取证完成前对应的实现切片不得开工。

#### Scenario: 文档读不到就不写
- **WHEN** 上游文档站因前端渲染无法取回字段表
- **THEN** 规格里保留 OPEN 条目并写明取证方法，MUST NOT 依据同名第三方实现或印象补写字段清单
