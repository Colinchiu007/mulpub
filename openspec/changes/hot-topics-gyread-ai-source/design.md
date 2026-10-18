# 设计：gyread.com 作为 AI 分类专用信源（hot-topics-gyread-ai-source）

## 1. 分层与影响面

```
主进程  electron/services/hot-topics-service.js    CATEGORY_BOOSTS.ai 增加 gyread 源
        electron/services/hot-topics/channels.js   parseGyreadIndex / parseGyreadEdition
        electron/services/hot-topics/classifier.js AI 词表扩充
        electron/services/hot-topics/scorer.js     CHANNEL_WEIGHTS.gyread
渲染层  src/locales/hot-topics/{zh,en}.js          channels.gyread / channels['gyread-ai']（成对）
测试    electron/services/hot-topics-gyread.test.js（新增）
```

**不新增一级分类、不改跨端五处契约**：`ai` 分类已由上一个 change 落地，本期只补它的信源供给。

## 2. 关键设计决策

### 2.1 为什么挂 `CATEGORY_BOOSTS.ai` 而不是 `CHANNEL_CONFIGS`

gyread 的本质是**每日编辑精选的日报**，不是热度榜单。这个差异有四个后果，每一条都指向「不能当主渠道」：

| 主渠道的隐含前提 | gyread 的实情 | 若当主渠道会怎样 |
|---|---|---|
| 条目有可比的热度值 | 完全没有 `hotValue` 字段 | `heatNorm=-1` 全走名次兜底，`rank` 还是编辑意志 |
| 榜单序即热度序 | 栏目内是「头版优先」的编辑序 | 排序信号被污染 |
| 跨榜同现 = 全民热点 | 它的条目不会出现在别的榜 | `sourceBonus` 对它无效，但它会稀释整体分布 |
| 一天多次刷新有意义 | 一天只更一次 | 高频抓取纯浪费，且违背站点 `intervalMinutes` 克制原则 |

挂补拉的额外好处：复用 `CATEGORY_BOOSTS.ai` 既有的 `threshold=4`（AI 条目够多时本不打它），
以及 `_collectBoostChannel` 里已修好的「分类器优先、`general` 才兜底」语义。

### 2.2 两个解析器，一个管「选题列表」一个管「溯源」

- `parseGyreadIndex` 面向 `search-index.json`，产出**入选热门选题的条目**。这是主力。
- `parseGyreadEdition` 面向单期 HTML，产出**带原文链接的条目**。为什么还需要它：
  `search-index.json` 的 `u` 字段指向的是**日报页本身**，不是新闻原文。用户点进去只会看到
  同一份日报，拿不到一手信息 —— 而「溯源跳板」正是调研结论里 gyread 的核心价值。
  所以补拉时**先用 index 定选题，再用 edition 页补原文链接**。

  但这一步有成本（多一次 HTTP）。故设计为**按需增强**：`_collectBoostChannel` 成功后，
  若配置了 `enrichWithEdition: true`，则对每个条目按其 `u` 抓一次 edition 页并抽取 `src-line`。
  抓取失败**只丢失原文链接，不丢失条目本身**（fail-open，选题列表仍是完整可用的）。

  上限保护：`MAX_PER_CHANNEL=50` 已在 `_collectBoostChannel` 内 slice，
  而 edition 页实测 6-17 条/期，因此一轮最多 50 次附加请求。为避免放大，
  `enrichWithEdition` 只对 `onlyCategory==='ai'` 的补拉源开启，且条目上限收紧到 **10 条**
  （AI 分类每期平均 11.5 条，10 条已覆盖主体）。

### 2.3 两版版式的兼容策略

实测站点 2026-10-17 起换了 DOM 结构：

| 版式 | 来源标注 | 出处链接 |
|---|---|---|
| 旧版（≤10-16） | `<div class="dateline">CNBC · 话题 · 独家</div>` | `<div class="src-line">出处：<a href="...">媒体 ↗</a></div>` |
| 新版（10-17 起） | `<div class="item-meta"><span class="meta-source">NASA / STScI</span><span class="meta-sep">·</span><span class="meta-topic">深空巡天</span></div>` | `<div class="src-line"><a href="...">NASA ↗</a> · <a href="...">Quanta ↗</a></div>` |

策略：**两条路径都实现，谁命中用谁**，不猜站点会停在哪个版本。同时新版 `src-line` 是
「一条多项出处」，解析必须返回**数组**而非单个 URL —— 这是旧版没有的形态。
测试里两条路径各锁一例，外加「两版混存」的合成样本。

### 2.4 配额与合规

| 项 | 值 | 理由 |
|---|---|---|
| `intervalMinutes` | 60 | 日报一天一更；60 分钟足够覆盖，且不打扰 |
| `riskLevel` | `medium` | 无登录态、无反爬对抗，但站点有 `x-robots-tag: noai` 声明，须比纯公开榜克制 |
| `throttleKey` | `gyread-index` | 显式声明，与 URL 归一化键等价但更可读；未来若加第二个 gyread 端点可共享 |
| 用途声明 | 代码注释 + 设计文档 | 明确「检索/引用」而非「训练语料」。`robots.txt` 对检索类 UA 放行 `/news/`，对训练类 UA 全站禁 |

**明确的合规边界**：本接入**不**把 gyread 内容用于模型训练或语料构建。它的用途是
「帮用户找到值得关注的一手 AI 新闻，并让用户点回原文」。这与站点 `Content-Signal: search=yes,
ai-input=yes, ai-train=no` 的声明一致。

### 2.5 分类器词表扩充的边界

gyread 标题的高频词要补，但**不能为它单开一份词表**（那会造成判据漂移，与上一个 change
里 `onlyCategory` 复用分类器本身是同一条纪律）。扩充的字词必须同时满足：
① 在 gyread 语料里高频；② 在通用 AI 语境里也成立（不绑定该站的私活用语）。

因此 `日报`/`情报`/`信号` 这类**该站专有用语不进词表** —— 它们放进任何分类都没有判别力。
真正要补的是 `智能体经济`、`开源权重`、`多智能体`、`世界模型`、`上下文`、`强化学习`、
`蒸馏`、`对齐`、`幻觉` 这类**跨语料通用的 AI 术语**。

## 3. 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
|---|---|---|---|
| `search-index.json` 结构变更 | 补拉解析失败 | 空列表记失败（既有合同）→ 熔断 → `channelStats` 显示 `ok=false`；不影响其他渠道 | 从 `CATEGORY_BOOSTS.ai.sources` 摘除该行 |
| 站点更换版式（第三版） | `parseGyreadEdition` 抽不到 `src-line` | fail-open：只丢原文链接，不丢条目；`item-meta`/`dateline` 双路径已覆盖已知两版 | 关掉 `enrichWithEdition` |
| 站点加反爬（403/429） | 补拉失败 | 熔断 3 连败冷却；`intervalMinutes=60` 已极保守 | 摘除该源 |
| 词表扩充导致个别类误判 | 个别选题分类变化 | 新增 6 条正例 + 既有 32 例回归；`general` 占比观察 | 回退单个词表条目 |
| `enrichWithEdition` 放大抓取（最多 10 次/轮） | 对站点压力 | 上限 10 条；仅 AI 补拉开；失败不扩散 | 关掉该开关 |
| 原文链接失效（实测 7/26） | 用户点了打不开 | 条目仍可用（标题+摘要）；链接是**附加价值**不是必需项 | 无（本就 fail-open） |

## 4. 未落地项（登记为后续迭代）

1. **来源可信度自动判废**：调研发现的「出处张冠李戴」（Swin-Transformer 仓库被当作投资事件出处）
   需人工或 LLM 判断，本期只透出链接。
2. **gyread 英文版 / 周报 / 专题**：同源或二次加工，本期不接。
3. **`search-index.json` 的 `g` 标签字段**：实测恒为空串（0/1421），无信息量，本期不解析。
4. **entryUrl 的 UI 呈现**：溯源入口链接目前只附在条目数据上，前端是否展示「查看当日日报」
   入口属 UI 决策，本期不做（避免动视觉回归基线）。
