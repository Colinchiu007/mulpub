# Proposal: hot-topics-viral-items

> **本 change 只落合同，不落实现。** 交付物是「热门选题条目数据模型」的规格 Requirement；
> 代码服从本文件与 `specs/hot-topics-viral-items/spec.md`，不是反过来。实现切片在规格被批准之后另开。

## Why

「热门选题」现在的统一条目结构是 `{ channel, rank, topic, hotValue, url, rawCategory }`
（`apps/desktop/electron/services/hot-topics/channels.js` 各 `parse*` 的返回值，2026-10-18 读码核实）。
用户 2026-10-17 的诉求是「在热门选题中增加短视频平台**近期的具体爆款视频内容**」，而这套结构**装不下它要的东西**：

1. **没有内容条目字段**——没有作者、没有发布时间、没有点赞/评论/分享/播放，一条爆款视频进来也只能被当成一个「话题词」显示。
2. **话题与条目在类型上不可区分**——`topic` 字段既承载「英雄联盟S16世界赛开赛」这种热搜词，也将被用来承载「某条具体视频的标题」，下游（分类器 `classifier.js`、评分器 `scorer.js`、渲染层 `HotTopics.vue`）无法知道自己在处理哪一种，于是必然出现**用名次冒充热度**、**跨平台直接比数值**这类口径污染。
3. **没有兼容与校验边界**——缓存里已有的是话题条目，新加的是内容条目；一旦缺一个显式判别位与"字段缺席 ≠ 空值"的校验，恢复路径会把半截数据当成合法条目渲染（本仓「降级/占位产物不得冒充成功产物」的同型）。
4. 开源参照系实测（`01-docs/PRD-HOT-TOPICS-SHORTVID-VIRAL-ITEMS-2026-10-17.md` §3）已经给出结论：**话题热榜过剩、内容条目级的源稀缺且多数不可商用**（MediaCrawler 是非商业学习许可、creatorhub/Spider_XHS 无许可证、TrendRadar/TikTokDownloader 是 GPL-3.0）。也就是说，**接下来无论接哪个源，先受的都是这个模型**；模型不先定，接一个源就要在四个消费层各抄一份特殊分支。

## What Changes

- **新增 capability `hot-topics-viral-items`**，规定热门选题条目的**二态模型**：`kind = 'topic' | 'item'`，以及 `item` 态的可选段 `author` / `publishTime` / `interaction`。
- **确立四条不变量**（全部以 Requirement + Scenario 表达，可被测试直接引用）：
  1. 判别位必须存在且向后兼容——旧数据/旧渠道读作 `topic`，**MUST NOT** 因新字段整体重构既有解析器；
  2. `kind='item'` 但三个内容字段全空 ⇒ 在**采集出口**判不合格并丢弃，不得进入渲染（防"装饰性升级"）；
  3. 字段缺席与空值语义分离——缺席即不渲染该段，**MUST NOT** 用渠道名/平台名/抓取时间兜底作者或发布时间；
  4. 数值口径不得互相冒充——归档派生的名次类量（`daysOnBoard` / `peakRank`）与平台自报 `hotValue` **不同源**，禁止写入彼此字段，跨平台不得直接比大小。
- **新增「投影链必须逐层透传」的合同**：条目新字段从主进程到界面要连续穿过 IPC 序列化、渲染层 store、视图三处白名单，规格里钉住「必须有一条接线锁，漏一层即红」——这是本仓「新增持久化字段必须同时改所有投影白名单，两侧各自单测都会绿」那条 MUST 的同族落点。
- **文档**：专项 PRD（§6.1 已落盘）+ 本 change + 执行记录。

## 不在本 change 范围

- ❌ 任何运行时代码、任何新渠道、任何平台请求。
- ❌ 归档型热度标签（`daysOnBoard` / `peakRank`）的实现——那是 PRD §5 的另一片，本 change 只规定它**不得**污染 `hotValue` 口径。
- ❌ 抖音官方「热门视频榜」OpenAPI 的字段表：本轮抓取该文档站只拿到样式脚本，**字段/权限/配额/计费一律标为未核实**，规格里不写不可证的东西（见 spec 的 OPEN 项）。
- ❌ 视频号数据源。PRD §4.3 已判「开源检索未命中任何榜单/推荐流 API」，不得为凑三平台塞假源。

## Impact

| 面 | 影响 |
|---|---|
| 主进程 | `hot-topics/channels.js` 各 `parse*` 需产出判别位（实现片）；`hot-topics-service.js` 的收集出口新增一条资格判据 |
| 分类/评分 | `hot-topics/classifier.js`、`hot-topics/scorer.js` 需按 `kind` 分流，禁止跨 `kind` 复用同一权重语义 |
| IPC / 渲染层 | 条目对象经 IPC 到 `src/stores` 再到 `src/views/HotTopics.vue`，三处投影白名单必须同步（有接线锁要求） |
| 缓存 | 需 schema 版本位；旧缓存无 `kind` 读作 `topic`，不做反向迁移 |
| i18n | 新增显示段必须 zh/en 成对进 locales（Gate 7），渲染层不得新增中文字面量 |
| 风险 | 判别位一旦被写成可选，「item 但字段全空」的假条目会在四个消费层各自兜底成不同形状——故规格里把"必填判别位 + 采集出口丢弃"钉成一条不可拆的 Requirement |
