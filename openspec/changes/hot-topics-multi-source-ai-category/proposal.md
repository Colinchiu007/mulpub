# 变更：热门选题·扩展多平台数据源 + 新增 AI 分类 + 归类准确性优化（hot-topics-multi-source-ai-category）

## Why

用户 2026-10-12 提出三件事，全部源自**实际使用中看到的症状**：

1. **数据源太少**：「对热门选题扩展更多数据源」，并点名调研**抖音 / 小红书 / 今日头条 / 头条号 / 凤凰网**
   在开源项目里是否已有热榜或热门内容的获取实现，能复用就复用、否则参考技术实现。
2. **缺 AI 分类**：「类别中，再增加一个 AI 分类」——现有 10 类里 AI 内容被压进「科技」，
   而 AI 内容已经是独立的一大块内容域。
3. **归类不准**：「科技类别下，有时候存在和科技不沾边的内容」——要求分析归类标准与逻辑，
   并给出优化准确性的办法。

现场核查（真实读码 + 实测端点）确认这三条都不是错觉：

- 原有 8 个渠道里**没有小红书、没有凤凰网**；抖音虽在列，但缺 UA/Referer 时是
  「HTTP 200 + `word_list` 空数组」，而旧实现把这种情况**记成成功**，导致熔断器永不打开、
  界面上只看到「该渠道 0 条」，没有任何可排查信号。
- `classifier.js` v2 的分类链是「渠道原生映射 → 关键词先到先得 → general」，
  其中**渠道原生映射无条件压过关键词**，而 `bilibili['知识']='tech'`、`weibo['科学科普']='tech'`、
  `toutiao['汽车']='tech'` 这三条把**整批泛知识/泛科普/汽车内容**硬挂进科技；
  补拉渠道（`_collectBoostChannel`）更是把条目 `category` **无条件硬写成 `boostCategory`**，
  分类器完全不参与。这就是「科技类混入不沾边内容」的机制级根因。
- LLM 兜底的送审集合是 `if (t.category !== 'general') continue` ——**只处理 general**，
  所以已经被错判成 `tech` 的条目**永远不会进 LLM**，结构上无法纠错。

## What Changes

### 一、新增数据源（全部免登录；端点均经 2026-10-12 实测）

- **新增小红书渠道** `xiaohongshu`：App 端 `edith.xiaohongshu.com/api/sns/v1/search/hot_list`，
  免登录、免 Cookie，但需**固定头六项**（`User-Agent` / `referer` / `xy-direction` / `shield` /
  `xy-platform-info` / `xy-common-params`）**缺任一 `xy-*` 或 `shield` 即 406**。
- **新增凤凰网渠道** `ifeng`：`ne883dbn.ifeng.com/hotspotlist?page=1&gv=7.9.1&av=7.9.1`（JSON，约 35 条），
  字段注意**顶层没有 `url`，链接在 `link.url`**；兜底走 `i.ifeng.com` 内联 `allData.hotRankData.data`
  （约 51 条，顶层 `url`，需花括号配对解析）。
- **抖音增强 + 顺序降级链**：主端点补全查询参数；新增 `config.fallbacks` 顺序降级链
  （`aweme-lq.snssdk.com` 零头部兜底 → `iesdouyin.com` 热词兜底）。**刻意不用并发**：
  同源端点并发会放大风控面，且同源条目跨渠道去重后会被误算成「多榜同现」，
  污染 scorer 的 `sourceBonus`（那是「全民热点」信号，被同源灌水即失真）。
- **今日头条字段修正**：响应用**没有** `Category` 字段（0/50），语义相近的是 `InterestCategory[]`（42/50），
  解析器改为优先 `InterestCategory[0]`、回退历史 `Category`；`HotValue` 是字符串。
- **头条号明确不接入**：`mp.toutiao.com` 热点入口无 cookie 下均 502（`/activity/hot-selection`
  还带 `tag_info.hotboard_invitation` 权限门槛），GitHub 代码搜索 0 命中无参考实现，
  且**无法证实其与今日头条热榜是否同源**。

### 二、新增 AI 一级分类（跨端 5 处契约同步）

- `classifier.js` `CATEGORY_KEYS`、主进程 `content-categories.js`、渲染层 `content-categories.js`、
  `HotTopics.vue` 的 `CATEGORY_KEYS`、`ops-center` 的 `content_category_service.CATALOG` 五处
  **键名与顺序严格一致**（ai 紧随 tech），并有测试锁死跨端一致性。
- AI 与科技的边界：`ai` = 模型/算法/智能能力本身（大模型、AIGC、Agent、提示工程、算力/智算、
  AI 芯片与应用、AI 监管伦理）；`tech` = 硬件/基础设施/工程实体（非 AI 语境芯片、操作系统/云计算、
  消费电子、通信、航天、新能源/电池、机器人硬件、量子、开源）。
- 新增 `CATEGORY_BOOSTS.ai`（复用 IT之家 RSS + `onlyCategory` 用分类器筛 AI），
  修掉「ai chip 为空时点『补拉该分类』静默无反应」。

### 三、归类准确性优化（v3 分类器）

- **原生映射分置信度**：`RAW_CATEGORY_WEAK_MAP` 承载「宽泛桶」（B站「知识」、微博/ B站「科学科普」、
  「汽车」），只在关键词零命中时兜底；`DOMAIN_LEVEL_RAW`（科技/互联网/科学科普/知识/资讯/热点）
  是**栏目名而非单条定性**，一律不参与裁决。
- **关键词分强弱**：strong 权重 = 词长 ×2，weak = 词长；`MIN_SCORE=3` 使单个双字弱词不再单独成类。
- **拉丁词走词边界**：修掉 `text.includes('AI')` 命中 `Air`/`said` 的裸子串误判；并新增全角归一
  （`ＡＩ` → `AI`）。
- **`general` 语义收窄**：只要文本给出任何真实分类，就不再保留 `general` 标签。
- **补拉条目走分类器**：`_collectBoostChannel` 改为「分类器判出明确分类则以分类器为准，
  只有 general 才用 `boostCategory` 兜底」。
- **渠道抓取两条新合同**：① 空列表视为失败（不得记成功）；② 406 单独告警（小红书 shield 失效的唯一特征）。

## 不做（明确排除）

- **不接入头条号**：需登录态 + 可能需邀请权限 + 无参考实现 + 无法证实与今日头条热榜同源；
  与发布链路登录态耦合还会带来账号风控风险。若后续确需，必须先做一次登录态抓包确认响应结构。
- **不走小红书 Web / 创作者平台登录态方案**：`/explore` 未登录已 302 → `/login`（`__INITIAL_STATE__` 不存在）；
  `/api/sns/web/v1/*` 需 `X-S`/`X-T`/`x-S-Common` 签名 + 登录 Cookie 且**不含热榜**。
- **不改快速采集（quick-collect）的源注册表**：那是另一个模块（且其测试明确要求
  「不存在需要登录态的源」），本次范围只在热门选题。
- **不扩张一级分类数量**：仍 11 类，不做二级子标签。
- **不改 UI 交互结构**：chip / 渠道下拉 / 空态补拉沿用既有交互，只增枚举与文案键。
