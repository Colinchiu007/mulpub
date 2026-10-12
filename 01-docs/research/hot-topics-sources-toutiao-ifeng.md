# 调研：今日头条 / 头条号 / 凤凰网 热榜数据源

- 调研日期：2026-10-12（Asia/Shanghai）
- 实测环境：Windows / PowerShell `Invoke-WebRequest` + `curl.exe`，公网直连（无代理环境变量）
- GitHub 元数据取证：`gh api`（本机已登录 gh，绕过匿名 60 次/小时限流）；抓取时间 2026-10-12
- 本文件所有端点除注明「未核实」外，均为**本次实测**（含 HTTP 状态码与响应体摘录）
- 说明：`api.inews.ifeng.com` 在本机 **DNS 无法解析**，下文据此排除该候选（不是「未测试」，是「不存在该主机」）

---

## 今日头条（今日头条站内热榜）

### 结论

- 现有端点 `https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc` **仍然有效，可直接复用**：实测 HTTP 200，返回 50 条，无 cookie、无签名、无 UA 校验（连完全不带头部的裸请求也返回 200）。
- **用户列出的字段名不完全准确**，两处需要修正：
  1. **没有 `Category` 字段**：50 条里 0 条存在该属性（`(item.Category)` 取值为空）。与之语义相近的是 **`InterestCategory`（字符串数组，如 `["sports"]`，42/50 存在）**。
  2. **`LabelDesc` 是稀疏字段**：仅 25/50 条存在，另 25 条为 `null`（实测输出里它显示成 `null` 而非缺失，说明 JSON 里是显式 `null`）。
- `Title / HotValue / Url` 三个字段 **50/50 全部存在**，字段名大小写与用户描述一致。
- `HotValue` 是**字符串**（如 `"34870847"`，50/50 为纯数字字符串），解析时需 `Number()` 转换；注意 JS 端 3 千多万仍在安全整数范围内，但**不要假定它是 number**。
- **`v2` / `v1` 端点不存在**：`hot-event/hot-board/v2/` 与 `/v1/` 均返回 **404**。没有找到更新的版本化端点。
- 存在**镜像主机** `https://api.toutiaoapi.com/hot-event/hot-board/?origin=toutiao_pc`，实测同样 200 / 同榜单，可作为 `www.toutiao.com` 失败时的备用主机。

### 可用端点表

| 端点 | 方法 | 头部 | 响应字段路径 | 是否需要签名/登录 | 实测/来源 | 稳定性 |
|---|---|---|---|---|---|---|
| `https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc` | GET | 无要求（实测裸请求亦 200）；建议带 `User-Agent` + `Referer: https://www.toutiao.com/` | `status`；`data[]`（50 条）：`Title` / `HotValue`(string) / `Url` / `ClusterIdStr` / `ClusterId` / `Type`? / `Label` / `LabelDesc`(稀疏 25/50) / `LabelUri.url` / `Image.url` / `QueryWord` / `InterestCategory[]`；另有 `fixed_top_data[]`(1 条置顶)、`fixed_top_style`、`impr_id` | **不需要**（无 cookie、无签名、无 UA 校验） | 本次实测 200，len≈126KB | 高（长期存在；但字段可能随版本增减，需容错） |
| `https://api.toutiaoapi.com/hot-event/hot-board/?origin=toutiao_pc` | GET | 同上 | 同上（图片 CDN 主机变为 `p11-sign.toutiaoimg.com`） | 不需要 | 本次实测 200，len≈128KB | 中（镜像主机，未见于主流开源项目，需自行监控） |
| `https://www.toutiao.com/hot-event/hot-board/v2/?origin=toutiao_pc` | GET | — | — | — | 本次实测 **404** | **不存在** |
| `https://www.toutiao.com/hot-event/hot-board/v1/?origin=toutiao_pc` | GET | — | — | — | 本次实测 **404** | **不存在** |
| `https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc&_signature=` | GET | — | 与主端点完全一致（空签名无影响） | 不需要 | 本次实测 200，len 与主端点完全相同 | 说明 **当前不需要 `_signature`** |

实测响应结构（首个元素，原始 JSON 摘录，已省略图片长 URL）：

```json
{
  "status": "success",
  "impr_id": "20261012075720913651A8026524C94BE9",
  "fixed_top_data": [ /* 1 条置顶，结构同 data[] */ ],
  "fixed_top_style": 0,
  "data": [
    {
      "ClusterId": 7694547961828851748,
      "ClusterIdStr": "7694547961828851748",
      "ClusterType": 1,
      "Title": "郑钦文首夺中网冠军",
      "Label": "hot",
      "LabelDesc": "热门事件",
      "LabelUrl": "https://p3-sign.toutiaoimg.com/...",
      "LabelUri": { "uri": "...", "url": "https://p3-sign.toutiaoimg.com/...", "width": 48, "height": 48, "url_list": [ /* ... */ ], "image_type": 1 },
      "Url": "https://www.toutiao.com/trending/7694547961828851748/?category_name=topic_innerflow&event_type=hot_board&log_pb=...&style_id=40132&topic_id=7694547961828851748",
      "HotValue": "34870847",
      "QueryWord": "郑钦文首夺中网冠军",
      "InterestCategory": ["sports"],
      "Image": { "uri": "...", "url": "https://p3-sign.toutiaoimg.com/...", "width": 320, "height": 180, "url_list": [ /* ... */ ] },
      "Schema": ""
    }
  ]
}
```

实测字段覆盖率（50 条样本，2026-10-12 07:57）：

| 字段 | 存在条数 |
|---|---|
| `Title` / `HotValue` / `Url` / `ClusterIdStr` / `Label` / `LabelUri` / `Image` / `QueryWord` / `Schema` | 50/50 |
| `InterestCategory` | 42/50 |
| `LabelDesc` | 25/50（其余为 `null`） |
| `Category` | **0/50（该字段不存在）** |

`Label` 实测取值集合：`""`、`hot`、`new`、`onSite`、`refuteRumors`；`LabelDesc` 实测取值集合：`"辟谣"`、`"热门事件"`、`"现场"`、`"新事件上榜"`。

### 参考开源项目

- `imsyy/DailyHotApi` — `src/routes/toutiao.ts`（MIT）。它把 `Label` / `LabelDesc` / `InterestCategory` **全部忽略**，只取 `ClusterIdStr` / `Title` / `Image.url` / `HotValue`，并自行拼 `https://www.toutiao.com/trending/{ClusterIdStr}/` 作为 `url`，`mobileUrl` 拼到 `https://api.toutiaoapi.com/feoffline/amos_land/new/html/main/index.html?topic_id={ClusterIdStr}`。源码：<https://raw.githubusercontent.com/imsyy/DailyHotApi/master/src/routes/toutiao.ts>
- `newsnext/newsnow` — `server/sources/toutiao.ts`（MIT）。取 `ClusterIdStr` / `Title` / `LabelUri.url`（当图标），**不取 `HotValue`**。源码：<https://raw.githubusercontent.com/newsnext/newsnow/main/server/sources/toutiao.ts>
- `wu529778790/newshub.shenzjd.com` — `server/sources/toutiao.ts`（**无 LICENSE 文件**）。与 newsnow 几乎逐行同构，额外把 `HotValue` 放进 `extra.info`（`热度: {HotValue}`），并显式设置 UA + Referer。源码：<https://raw.githubusercontent.com/wu529778790/newshub.shenzjd.com/main/server/sources/toutiao.ts>
- `Lysander66/briefy` — `fetcher/toutiao.py`（MIT，仅 10 star）。httpx 直连同一 URL，取 `ClusterIdStr` / `Title` / `HotValue`（`int()` 转换）。源码：<https://raw.githubusercontent.com/Lysander66/briefy/main/fetcher/toutiao.py>
- `sansan0/TrendRadar`（GPL-3.0）与 `tophubs/TopList`（Apache-2.0）**不直接抓今日头条**：TrendRadar 的热榜数据全部来自 newsnow 的 API（其 `config/config.yaml` 里 `sources[].id: "toutiao"`，并注明「数据来源于 newsnow 开源项目」）；TopList 的 `App/GetHot.go` 里 `toutiao` / `头条` 命中 **0 次**，不含今日头条。

### 风险

- **无鉴权是优点也是风险**：字节侧随时可以加签名（历史上多个头条接口经历过 `_signature` 时代）。当前实测空 `_signature` 不影响，说明签名校验未开启，但**不能假定永久有效**。
- 字段随版本漂移：`Category` 已经不存在、`LabelDesc` 只覆盖一半样本——**解析必须对每个字段做缺省容错**，不要用严格 schema 校验整条记录。
- `Url` 里带 `log_pb`（内含 `impr_id`、时间戳）等埋点参数，属跟踪参数而非必要参数；可安全丢弃，自拼 `https://www.toutiao.com/trending/{ClusterIdStr}/`（多个开源项目都这么做且长期可用）。
- 图片 URL 带 `x-signature` / `x-expires`（CDN 防盗链签名），**不要缓存图片 URL 超过其过期时间**；若不展示图片可直接忽略。
- 高频轮询有 IP 级风控风险（未实测触发阈值）。建议 ≥5 分钟一次并加缓存。

### 复用建议

**直接复用**（推荐）。端点、头部、字段均已实测确认，且被 `DailyHotApi`（4.0k star）与 `newsnow`（22k star）两个活跃项目长期使用。

```yaml
id: toutiao
name: 今日头条热榜
url: https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc
headers:
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
  Referer: https://www.toutiao.com/
requires_login: false
parser:
  list_path: data
  fields:
    id: ClusterIdStr
    title: Title
    hot: Number(HotValue)          # HotValue 是字符串
    url: Url | https://www.toutiao.com/trending/${ClusterIdStr}/
    label: Label                   # "", hot, new, onSite, refuteRumors
    label_desc: LabelDesc          # 稀疏，可能为 null
    cover: Image.url
    icon: LabelUri.url
    category: InterestCategory[0]  # 注意：不是 Category（该字段不存在）
```

---

## 头条号（创作者平台）

### 结论

- 头条号创作者平台的入口域是 `https://mp.toutiao.com/`，实测返回 200，页面 `<title>` 为「头条号」，是一个 SPA 外壳（**未登录也返回同一份 HTML**）。
- 该外壳里**真实存在**的热门内容相关入口有 3 个（从页面内联的导航配置里提取，非猜测）：

  | 名称 | 路径 | 附加权限标记 |
  |---|---|---|
  | 热点精选 | `/activity/hot-selection` | `tag_info.hotboard_invitation` |
  | 热点（创作灵感） | `/activity/hot-spot` | — |
  | 搜索任务 | `/activity/task-list` | — |

  取证：`https://mp.toutiao.com/` 响应体内联 JSON 片段
  `{"name":"热点精选","link":"/activity/hot-selection","content":{"permission":"tag_info.hotboard_invitation"}}`
  与 `{"name":"热点","link":"/activity/hot-spot"}`。

- **登录态结论：必须登录，且部分入口还需额外权限。**
  - `/activity/hot-spot` 与 `/activity/hot-selection` 实测在无 cookie 下返回 **502 Bad Gateway**（带 Referer 亦然）；`/hotboard` 返回 502 而 `/profile_v4/hotboard` 返回 200 外壳。返回 502 而非 302 到登录页，说明这些路由由服务端按登录态/权限决定是否下发，**未登录不可访问**。
  - `热点精选` 的导航项自带 `permission: tag_info.hotboard_invitation`，说明即便登录，是否可见还取决于账号是否被邀请开通热榜权益。**不能假定任意头条号账号都可见。**
- **没有找到不需要登录态的头条号热榜接口**：本次抓取了 `mp.toutiao.com` 首页引用的 **16 个 JS bundle**，正则提取出 **250 条** `/mp/agw/...` API 路径，其中与「热点/热榜」相关的**只有导航用的 `/activity/hot-spot` 字符串本身**；`statistic/*trend*` 全是账号自身的粉丝/内容趋势统计，与平台热榜无关。即：**热点列表的数据接口不在主包内**（大概率由子应用/微前端按需加载），未登录无法触达。
- 我**手动猜探测**的 4 个候选接口全部 **404**，均已排除，记录在此以免后人重复试探：
  `POST/GET https://mp.toutiao.com/mp/agw/creator_hot_spot/list` → 404；
  `.../mp/agw/hot_spot/list` → 404；
  `.../mp/agw/trend/list` → 404；
  `.../mp/agw/get_hot_board` → 404。
  （这些是**我构造的猜测**，404 说明其不存在，**不应写入任何实现**。）
- **开源项目里没有头条号创作平台热榜的实现**：GitHub 代码搜索 `mp.toutiao.com/hot` 命中 **0** 个结果（`total_count: 0`）。结论是 **未找到 / 未核实**，不是说「不可能」，而是「没有可参考的现成实现」。

### 是否与「今日头条热榜」同源（关键判断，避免重复接入）

**结论：不应视为同源同数据，但内容高度重叠，建议暂不接入头条号。**

- 可以在 `mp.toutiao.com` 的创作者平台里看到「热点/热榜」入口（说明平台确实提供这类能力），但**创作者平台展示的是「创作灵感/选题向」的热点**（含搜索任务、可参与的活动话题），与 `www.toutiao.com` 面向消费者的热榜**列表、排序、字段、时效均无法从公开信息证明一致**。
- 本次**未能取得**头条号热点列表的实际响应体（必须登录态），因此**无法证实也无法证伪「同源」**。凡涉及「字段是否一致」的判断，一律标注 **未核实**。
- **实操建议**：只接入 `www.toutiao.com/hot-event/hot-board/`（公开、免登录、已实测）。头条号侧作为**后续可选增强**，等能用登录态实测其响应体后再决定，避免为了「同一个榜单」接两套。

### 可用端点表

| 端点 | 方法 | 头部 | 响应字段路径 | 是否需要签名/登录 | 实测/来源 | 稳定性 |
|---|---|---|---|---|---|---|
| `https://mp.toutiao.com/` | GET | `User-Agent` | HTML 外壳（`<title>头条号</title>`），导航配置内联在 HTML 字符串里 | 不需要登录即可拿到外壳 | 本次实测 200，len≈59.7KB | 高（但外壳≠数据） |
| `https://mp.toutiao.com/activity/hot-spot` | GET | `User-Agent` | — | **必须登录**（未登录 502） | 本次实测 **502**（带 Referer 亦 502） | 未核实（拿不到数据） |
| `https://mp.toutiao.com/activity/hot-selection` | GET | `User-Agent` | — | **必须登录 + 需 `tag_info.hotboard_invitation` 权限** | 本次实测 **502**；权限标记取自首页内联导航 | 未核实 |
| `https://mp.toutiao.com/activity/task-list` | GET | `User-Agent` | — | **必须登录** | 本次实测 **502** | 未核实 |
| `https://mp.toutiao.com/mp/agw/creator_hot_spot/list` 等 4 个猜测路径 | GET | — | — | — | 本次实测全部 **404**（**猜测，勿用**） | 不存在 |
| 巨量算数 `https://trendinsight.oceanengine.com/` | GET | `User-Agent` | — | 疑似需要登录 | 本次实测 200，**但任意路径都返回同长度 HTML（SPA catch-all），无法据此判定任何子接口存在** | 未核实 |

### 参考开源项目

- **无**。`imsyy/DailyHotApi`、`newsnext/newsnow`、`wu529778790/newshub.shenzjd.com`、`JackyST0/hotpush`、`sansan0/TrendRadar`、`tophubs/TopList`、`Lysander66/briefy` 的源码/文件树中均**没有**任何 `mp.toutiao.com` 创作者平台热榜实现（各项目源码文件树已逐一核对）。
- `JackyST0/hotpush` 走的是 RSSHub 路由（`backend/app/utils/sources.py` 里只有 weibo / zhihu / bilibili / v2ex / hackernews / juejin / ithome / nodeseek / sspai / douban / zaobao / thepaper），**既无今日头条也无凤凰网**。
- `tophubs/TopList` 的 `App/GetHot.go`（44KB）里 `toutiao`（不区分大小写）**0 命中**，其数据源是百度、微博、知乎、豆瓣、虎扑、天涯、抽屉、V2EX、GitHub Trending 等，**不含今日头条**。

### 风险

- **登录态 = 账号级风控风险**：在桌面端应用里用用户自己的头条号 cookie 抓创作者平台热点，等于把「内容创作者的登录态」用于自动化读取，**可能触发账号风控**，且与发布流程共用同一 cookie 时耦合度高（登录失效会同时打断发布与热点）。
- **权限门槛**：`热点精选` 需要 `tag_info.hotboard_invitation`，**不是所有账号都有**，产品上会出现「有的用户有、有的没有」的不一致体验，需设计好降级。
- **接口不可发现**：数据接口不在主包内，未登录不可见，**任何实现都建立在「抓包一次登录态请求」之上**，长期稳定性完全依赖对端不改变实现 —— 这是最脆弱的一类接入。
- 若强行接入，还涉及**用户隐私与合规**（读取用户账号上下文）问题，需产品明确授权。

### 复用建议

**不可复用（公开渠道）/ 参考实现（如确有账号授权）。**

- 对「公开热榜」需求：**不接入**头条号，直接用上一节的今日头条热榜即可。
- 若产品确实要「创作者选题向热点」，需要的是一次**登录态抓包**（我自己无法完成，web-access 的 CDP 模式在本机不可用：`check-deps.mjs` 报「没有任何浏览器打开远程调试开关」，需要用户手动在浏览器里开启 `edge://inspect/#remote-debugging` / `chrome://inspect/#remote-debugging`），并在实现里明确标注 `requires_login: true` + 独立的 cookie 分区，**与发布用登录态隔离**。

---

## 凤凰网（ifeng）

### 结论

- **凤凰网有公开热榜，且质量比多数聚合项目用的方案更好。** 本次找到并实测了 **3 条可用路径**，其中 1 条是**真正的分页 JSON API**，另 2 条是从页面内联 JSON 里解析。
- 纠正两个常见说法：
  1. **`api.inews.ifeng.com` 不存在**：本机 DNS 直接报「不知道这样的主机」。任何引用该主机的实现（网上流传的 `api.inews.ifeng.com/hot/ranking/hot_rank_list.php`）都应删除 —— 它不是「暂时挂了」，是**域名不解析**。
  2. **`i.ifeng.com/news/hotRankList` 返回 404**，不是热榜接口。
- **最佳端点（推荐）**：`https://ne883dbn.ifeng.com/hotspotlist?page=1&gv=7.9.1&av=7.9.1` —— 实测 200，`application/json`，`{"code":0,"msg":"OK"}`，第 1 页 30 条、第 2 页 5 条（**共 35 条**，`totalPage` 字段实测为 `1` 但实际第 2 页仍有数据，**不要信 `totalPage`，应按返回条数判断是否翻页**）。**无需 cookie、无需签名、无需 Referer**（裸请求同样 200）。
  - 该主机名 `ne883dbn.ifeng.com` 是**凤凰网页面的 `window.allData.__nd__` 动态下发**的（`ishare.ifeng.com/hotNewsRank` 页面的 JS bundle 用 `allData.__nd__` 拼 API 域名，默认回退值就是 `ne883dbn.ifeng.com`）。这意味着**主机名理论上可能变化**，实现时应把默认值写死为 `ne883dbn.ifeng.com` 并允许配置覆盖。
- **次要端点 A（移动端首页内联，最全）**：`https://i.ifeng.com/` 的 HTML 里有 `window.allData.hotRankData.data`，实测 **51 条**，含 `update_time`（如 `2026-10-12 07:52:20`）与 `title/source/url/thumbnail/newsTime/base62Id/commentUrl`。零额外请求，但需解析 HTML 里的 JS 对象。
- **次要端点 B（PC 首页内联，条数少）**：`https://www.ifeng.com/` 的 `window.allData.hotNews1`，实测 **仅 12 条**，且部分条目只有 `url`/`title`（缺 `newsTime`/`thumbnail`）。**`newsnow` 与 `briefy` 用的就是这一条，是三者中最弱的一个**（它们在 PC 站上跑得通，但拿到的条目明显少于移动端）。
- `https://ishare.ifeng.com/hotNewsRank` 是「凤凰热榜」的**展示页**（`<title>凤凰热榜_凤凰网</title>`），页面是 React 客户端渲染（`<div id="root"></div>`，HTML 里 0 条内容），数据靠上面的 `hotspotlist` 接口。可以拿它当「人类可读的榜单页」引用链接，但**不要试图解析它的 HTML**。

### 可用端点表

| 端点 | 方法 | 头部 | 响应字段路径 | 是否需要签名/登录 | 实测/来源 | 稳定性 |
|---|---|---|---|---|---|---|
| `https://ne883dbn.ifeng.com/hotspotlist?page=1&gv=7.9.1&av=7.9.1` | GET | 无要求（实测裸请求 200）；建议 `User-Agent` + `Referer: https://ishare.ifeng.com/hotNewsRank` | `code`(0) / `msg`("OK") / `data.list[]`（`type` ∈ {`doc`,`phvideo`} / `id` / `documentId` / `staticId` / `title` / `source` / `thumbnail` / `imageList[].url` / `updateTime`（`2026/10/12 05:57:01` 格式）/ `link.url` / `link.weburl` / `commentsUrl` / `commentsCount`(25/30) / `intro` / `hotLabel` / `subscribe.catename`）；`data.totalPage`（**实测不准，恒 1**）/ `data.banner.title`（"凤凰热榜"）/ `data.banner.updateTime`（"更新于07:50"） | **不需要** | 本次实测 200；page=1 → 30 条，page=2 → 5 条，page=3 → 0 条 | 中高（主机名由前端动态下发，可能变） |
| `https://i.ifeng.com/` （解析内联 `allData.hotRankData`） | GET | `User-Agent` | `allData.hotRankData.update_time`；`allData.hotRankData.data[]`（**51 条**）：`type`(`article`) / `title` / `source` / `url` / `thumbnail` / `newsTime`（`2026-10-11 23:33:34`）/ `base62Id` / `commentUrl` / `page` / `duration` / `selectedPoolTags` | **不需要** | 本次实测 200，len≈342KB | 中（依赖 HTML 内联结构，改版即失效） |
| `https://www.ifeng.com/` （解析内联 `allData.hotNews1`） | GET | `User-Agent` | `allData.hotNews1[]`（**仅 12 条**）：`url` / `title` / `newsTime`(稀疏) / `thumbnail`(稀疏) / `children` | **不需要** | 本次实测 200，len≈277KB；`var allData = {...}` 为单行，`newsnow`/`briefy` 的 `var\s+allData\s*=\s*(\{[\s\S]*?\});` 正则可匹配 | 中（条数少；HTML 内联结构） |
| `https://ishare.ifeng.com/hotNewsRank` | GET | `User-Agent` | 展示页（客户端渲染，HTML 内 0 条数据，`content.list` 为空数组） | 不需要 | 本次实测 200，len≈56.6KB | 高（作为引用页面链接） |
| `https://api.inews.ifeng.com/hot/ranking/hot_rank_list.php` | — | — | — | — | **主机名 DNS 不解析**（本机两次探测分别报「不知道这样的主机」「找不到请求的类型的数据」） | **不存在** |
| `https://i.ifeng.com/news/hotRankList` | GET | — | — | — | 本次实测 **404** | **不存在** |
| `https://ishare.ifeng.com/` | GET | — | — | — | 本次实测 **404** | **不存在**（空路径 404；有效路径是 `/hotNewsRank`） |
| `https://nine.ifeng.com/hotSpotDetailList?eventName=...&groupid=&docid=` | GET | — | 榜单条目详情页（`hotNewsRank` 页面里每个条目链到这个地址） | 未核实 | 从 `hotNewsRank` 页面 HTML 提取（30+ 条不同 `eventName`） | 未核实（未单独抓取） |

实测 `hotspotlist` 响应（page=1，首条摘录）：

```json
{
  "code": 0,
  "msg": "OK",
  "data": {
    "totalPage": 1,
    "banner": { "title": "凤凰热榜", "updateTime": "更新于07:50", "img": "...", "titleImg": "..." },
    "shareInfo": { "desc": "胡塞震惊世界，惨烈踩断了中东战争的刹车板", "weburl": "https://ishare.ifeng.com/hotNewsShare", "chid": "hotspotlist", "counterId": "hot_merge" },
    "chConfig": { "staticId": "hot_merge" },
    "list": [
      {
        "type": "doc",
        "id": "ucms_8x95bPy37CL",
        "documentId": "ucms_8x95bPy37CL",
        "staticId": "ucms_8x95bPy37CL",
        "title": "胡塞震惊世界，惨烈踩断了中东战争的刹车板",
        "source": "胡锡进",
        "thumbnail": "http://d.ifengimg.com/w224_h150_q100_webp/x0.ifengimg.com/ucms/2026_42/....png.webp",
        "imageList": [{ "url": "https://x0.ifengimg.com/ucms/2026_42/....png", "width": "975", "height": "549" }],
        "updateTime": "2026/10/12 05:57:01",
        "link": {
          "type": "doc",
          "url": "https://nine.ifeng.com/getNewsDocs?aid=ucms_8x95bPy37CL&secret=v006KG1pUBKcdGK98xDPIRy55KGlZsoJFfXsQ9eKODO9zMw__&channelId=&category=&imId=8x95bPy37CL&channelKey=&startfrom=hotmerge",
          "weburl": "...",
          "openType": "...",
          "backendStaticId": "...",
          "staticId": "..."
        },
        "commentsUrl": "...",
        "commentsCount": 0,
        "intro": "...",
        "hotLabel": "..."
      }
    ]
  }
}
```

字段覆盖率（30 条样本）：`type/id/title/source/thumbnail/imageList/documentId/staticId/updateTime/commentsUrl/link/intro/hotLabel/subscribe` 均 **30/30**；`commentsCount` **25/30**；**`url` 字段 0/30（顶层没有 `url`！链接在 `link.url`）** —— 这是最容易踩的坑，`briefy` 的凤凰网实现里读的是 `news["url"]`，但那是 PC 首页 `hotNews1`（那里确实有顶层 `url`），**两个数据源字段结构不同，不能混用解析器**。

### 参考开源项目

- `newsnext/newsnow` — `server/sources/ifeng.ts`（MIT，22k star，2026-09-16 仍在推送）。实现：`myFetch("https://www.ifeng.com/")` → 正则 `/var\s+allData\s*=\s*(\{[\s\S]*?\});/` → `JSON.parse` → 读 `hotNews1` 的 `url`/`title`/`newsTime`。源码：<https://raw.githubusercontent.com/newsnext/newsnow/main/server/sources/ifeng.ts>
- `wu529778790/newshub.shenzjd.com` — `server/sources/ifeng.ts`（**无 LICENSE**，23 star）。与 newsnow **逐行相同**（含同一条正则），是同一实现的复制。源码：<https://raw.githubusercontent.com/wu529778790/newshub.shenzjd.com/main/server/sources/ifeng.ts>
- `Lysander66/briefy` — `fetcher/ifeng.py`（MIT，10 star）。同样正则 + `hotNews1`，读 `news.get("url")` / `title`。源码：<https://raw.githubusercontent.com/Lysander66/briefy/main/fetcher/ifeng.py>
- `sansan0/TrendRadar`（GPL-3.0，62.8k star，2026-10-10 活跃）—— **自身不实现凤凰网**，其 `config/config.yaml` 里 `sources` 配了 `id: "ifeng"` / `name: "凤凰网"` / `expected_domain: "ifeng.com"`，数据经 newsnow 的 API 取得；它额外做了 **`expected_domain` 域名白名单校验**（返回链接必须是 HTTPS 且匹配 `ifeng.com` 及其子域，否则丢弃并告警），这个防御模式值得借鉴。源码：<https://raw.githubusercontent.com/sansan0/TrendRadar/master/config/config.yaml>
- `imsyy/DailyHotApi` **没有凤凰网源**：`src/routes/` 下无 `ifeng.ts`（完整文件树见下节，56 个 route 文件已逐一列出）。
- `JackyST0/hotpush`（MIT，193 star）**没有凤凰网源**，其 RSSHub 源清单里无凤凰网。
- `tophubs/TopList`（Apache-2.0，4.7k star）**没有凤凰网源**，`App/GetHot.go` 里 `ifeng` / `凤凰` **0 命中**；且 2023-02-23 后无推送。

### 风险

- **`ne883dbn.ifeng.com` 这个主机名不是写死在页面里的**，它来自 `window.allData.__nd__`。凤凰网换 CDN/边缘节点时主机名可能变，**接口可能整个换域**。必须把主机名做成可配置，并保留「从 `ishare.ifeng.com/hotNewsRank` 页面读 `__nd__` 再拼 URL」的兜底逻辑。
- **`totalPage` 字段不可信**（实测恒为 1，但第 2 页仍有 5 条数据）。翻页必须按「本页返回条数 > 0」驱动。
- **凤凰网页面是客户端渲染 + 内联 JSON 双形态**：`i.ifeng.com` / `www.ifeng.com` 的内联 `allData` 依赖 HTML 结构；一旦改版，正则会静默失败（`newsnow` 的实现匹配失败时只是返回空数组，**不会报错** —— 这会导致「热榜为空但无告警」）。
- **只覆盖 12 条的 PC 内联方案（newsnow/briefy 用的那个）内容明显偏少**，建议不要照抄。
- `link.url` 里的 `secret` 参数看起来是短时令牌（形如 `v006...__`），**不要长期缓存该 URL**；若只需展示，用 `id` 自拼 `https://news.ifeng.com/c/{base62Id}` 更稳（`hotRankData.data[].base62Id` 与 `url` 里的 `/c/8x95bPy37CL` 一致，已实测）。
- `thumbnail` 是 `d.ifengimg.com/.../....webp` 的**转码代理 URL**，`imageList[].url` 是原图；按需选择。

### 复用建议

**直接复用** —— 但**用 `hotspotlist` API，不要照抄 newsnow/briefy 的 PC 首页正则方案**（后者条数少 3/4）。

```yaml
id: ifeng
name: 凤凰热榜
url: https://ne883dbn.ifeng.com/hotspotlist?page={page}&gv=7.9.1&av=7.9.1
headers:
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
  Referer: https://ishare.ifeng.com/hotNewsRank
requires_login: false
pagination: 按 data.list 长度 > 0 继续翻页（忽略 data.totalPage，实测不准）
parser:
  code: code            # 必须 == 0
  list_path: data.list
  fields:
    id: id                            # ucms_xxx
    title: title
    source: source
    url: link.url                     # 注意：顶层没有 url 字段
    updated_at: updateTime            # "2026/10/12 05:57:01"
    cover: imageList[0].url | thumbnail
    comments_url: commentsUrl
    comments_count: commentsCount     # 25/30 存在
    content_type: type                # doc | phvideo
```

---

## 可复用的开源项目清单

以下 **13 个仓库**全部经 `gh api repos/<owner>/<repo>` 实证存在（star / 推送时间 / License 均为 2026-10-12 实测值）。凡未实测到的一律标「未核实」，**没有任何仓库名是编造的**。

### 总表

| 仓库 | star | fork | 最后推送 | License | 今日头条 | 头条号创作者平台 | 凤凰网 | 关键文件 | 活跃度 | 风险 |
|---|---|---|---|---|---|---|---|---|---|---|
| `imsyy/DailyHotApi` | 4088 | 1345 | 2026-03-11 | MIT | ✅ `src/routes/toutiao.ts` | ❌ | ❌ | `src/routes/*.ts`（56 个） | 中（7 个月未推送，但 issue 活跃） | 端点直连、无兜底；无凤凰网 |
| `newsnext/newsnow` | 22008 | 5989 | 2026-09-16 | MIT | ✅ `server/sources/toutiao.ts` | ❌ | ✅ `server/sources/ifeng.ts`（弱，12 条） | `server/sources/*.ts` | 高 | 凤凰网走 PC 首页正则，条数少、改版即静默失败 |
| `sansan0/TrendRadar` | 62807 | 24900 | 2026-10-10 | **GPL-3.0** | ⚠️ 间接（经 newsnow API） | ❌ | ⚠️ 间接（经 newsnow API） | `config/config.yaml` | 很高 | **GPL-3.0 传染性**；不自采，依赖第三方 API |
| `imsyy/DailyHot` | 910 | 668 | 2024-11-05 | MIT | 前端（消费 DailyHotApi） | ❌ | ❌ | — | 低（近 2 年未推送） | 只是前端，无采集逻辑 |
| `tophubs/TopList` | 4733 | 935 | 2023-02-23 | Apache-2.0 | ❌ | ❌ | ❌ | `App/GetHot.go` | 停滞（3.5 年） | Go；不含目标平台 |
| `huqi-pr/trending-in-one` | 466 | 81 | 2025-04-24 | MIT | ✅（今日头条热搜） | ❌ | ❌ | — | **已归档**（archived=true） | 归档项目，仅供历史参考 |
| `Lysander66/briefy` | 10 | 4 | 2026-03-08 | MIT | ✅ `fetcher/toutiao.py` | ❌ | ✅ `fetcher/ifeng.py`（弱，12 条） | `fetcher/*.py` | 低（小项目） | star 少；凤凰网方案弱 |
| `wu529778790/newshub.shenzjd.com` | 23 | 8 | 2026-08-06 | **无 LICENSE 文件** | ✅ `server/sources/toutiao.ts` | ❌ | ✅ `server/sources/ifeng.ts`（弱，12 条） | `server/sources/*.ts` | 低 | **无 License = 默认保留所有权利，不可直接复制代码**；实现是 newsnow 的复制 |
| `JackyST0/hotpush` | 193 | 26 | 2026-10-10 | MIT | ❌ | ❌ | ❌ | `backend/app/utils/sources.py` | 中 | 走 RSSHub，目标平台均不支持 |
| `lixi5338619/lxSpider` | 1976 | 460 | 2024-05-09 | **GPL-3.0** | ⚠️ 爬虫案例合集（含头条） | ❌ | ❌ | — | 低 | GPL-3.0；教学向代码，非生产可用 |
| `imsyy/DailyHotApi-Vercel` | 77 | 211 | 2025-02-17 | MIT | 同 DailyHotApi | ❌ | ❌ | — | 低 | 只是 Vercel 部署壳 |
| `ShellMonster/DailyHotApi-Go` | 8 | 5 | 2025-10-21 | **未核实**（无 LICENSE） | 声明「基于 DailyHotApi 重构，聚合 60+」 | ❌ | ❌ | — | 低 | star 极少，未核实质量 |
| `getoneapi/OneAPI` | 104 | 3 | 2026-10-09 | **未核实**（无 LICENSE） | 声称含 Toutiao 接口 | ❌ | ❌ | — | 低 | 商业 API 聚合，非开源实现；未核实 |

> 说明：`ttttmr/NewsNow` 与 `xykt/hot-topics` 经 `gh api` 实测 **HTTP 404 不存在**，已排除，未列入上表。

### 重点核实：`imsyy/DailyHotApi`

**这是用户点名要核实的项目，以下是逐项实证结论。**

- 仓库全名：`imsyy/DailyHotApi`；star **4088**、fork **1345**；创建于 2023-03-14；默认分支 **`master`**（不是 `main`）；License **MIT**（仓库根有 `LICENSE` 文件）；`archived: false`；最后推送 **2026-03-11T10:38:03Z**。
- 语言 TypeScript，Hono/Vercel 风格；RSS 与 JSON 双输出；前端在 `imsyy/DailyHot`（910 star）。
- **`src/routes/` 下全部 57 个平台 route（`gh api .../git/trees/master?recursive=1` 实证，非推测；同目录另有 `types.d.ts`，故 blob 数为 58）**：
  `36kr` `51cto` `52pojie` `acfun` `baidu` `bilibili` `coolapk` `csdn` `dgtle` `douban-group` `douban-movie` **`douyin`** `earthquake` `gameres` `geekpark` `genshin` `github` `guokr` `hackernews` `hellogithub` `history` `honkai` `hostloc` `hupu` `huxiu` `ifanr` `ithome-xijiayi` `ithome` `jianshu` `juejin` `kuaishou` `linuxdo` `lol` `miyoushe` `netease-news` `newsmth` `ngabbs` `nodeseek` `nytimes` `producthunt` `qq-news` `sina-news` `sina` `smzdm` `sspai` `starrail` `thepaper` `tieba` **`toutiao`** `v2ex` `weatheralarm` `weibo` `weread` `yystv` `zhihu-daily` `zhihu`
  （上列 57 个平台 route 即 `src/routes/` 全部内容；`index.ts` / `config.ts` / `registry.ts` / `app.tsx` / `robots.txt` 等在 `src/` 根目录，不在 `src/routes/` 下。）

- **是否有 抖音 / 小红书 / 今日头条 / 凤凰网 —— 逐项回答：**

  | 平台 | 有无 | 证据 |
  |---|---|---|
  | **抖音** | ✅ **有** | `src/routes/douyin.ts` 存在；实测读其源码：调用 `https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1`，**需先请求 `https://www.douyin.com/passport/general/login_guiding_strategy/?aid=6383` 取 `passport_csrf_token` 放入 Cookie**，然后解析 `data.data.word_list[]` 的 `sentence_id` / `word` / `event_time` / `hot_value`，并拼 `https://www.douyin.com/hot/{sentence_id}` |
  | **小红书** | ❌ **没有** | `src/routes/` 57 个平台 route 名中无 `xiaohongshu.ts`（也无 `xhs.ts` / `redbook.ts`） |
  | **今日头条** | ✅ **有** | `src/routes/toutiao.ts`，端点为 `https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc`，解析 `data[].ClusterIdStr / Title / HotValue / Image.url`，**不用 `LabelDesc`/`InterestCategory`**，用 `getTime(ClusterIdStr)` 推算时间戳 |
  | **凤凰网** | ❌ **没有** | `src/routes/` 57 个平台 route 名中无 `ifeng.ts` |

- 其它有用细节：`src/utils/getData.ts`（统一 fetch 层）、`src/utils/getTime.ts`（**从 `ClusterIdStr` 反推时间**，见下）、`src/utils/getToken/` 下只有 `51cto / bilibili / coolapk / weread` 四家的取 token 实现，**头条与凤凰网都不在其中**（进一步佐证凤凰网源不存在）。
- `getTime` 的依据：今日头条的 `ClusterIdStr` 是雪花 ID，其高位含时间戳，`DailyHotApi` 用它生成 `timestamp`。这是**社区经验而非官方文档**，若要复刻请自行验证精度（本次调研**未核实**其准确性）。

### 其它项目补充细节

- `newsnext/newsnow`：`server/sources/` 下有 **59 个** source 文件，覆盖 `toutiao` / `ifeng` / `douyin` / `kuaishou` / `baidu` / `weibo` / `zhihu` / `bilibili` / `thepaper` / `cls` / `wallstreetcn` / `jin10` 等；**同样没有 `xiaohongshu`**（未在文件树中出现）。`server/sources/ifeng.ts` 与 `server/sources/toutiao.ts` 源码已在上文摘录。
- `sansan0/TrendRadar`：**GPL-3.0** —— 若本项目要参考其代码需注意传染性；其价值主要在于**产品形态与 `expected_domain` 域名白名单防御模式**，而非采集实现（采集全交给 newsnow）。
- `huqi-pr/trending-in-one`：`archived: true`，2025-04-24 最后推送。历史数据归档价值 > 代码复用价值。
- `tophubs/TopList`：`App/GetHot.go` 实测 44,642 字节，`toutiao`(忽略大小写) 命中 **0**、`ifeng` 命中 **0**、`头条` 命中 **0**、`凤凰` 命中 **0**；其 URL 常量为百度 / 微博 / 知乎 / 豆瓣 / 虎扑 / 天涯 / 抽屉 / V2EX / GitHub Trending / segmentfault / csdn / chiphell / 煎蛋 / 网易新闻排行等。
- `JackyST0/hotpush`：`backend/app/utils/sources.py` 的 `HOT_SOURCES` 只有 weibo / zhihu / bilibili / v2ex / hackernews / juejin / ithome / nodeseek / sspai / douban_movie / douban_book / zaobao / thepaper，全部经 **RSSHub 路由**；文件头注释明确「微博需要 `WEIBO_COOKIE`、B站需要 `BILIBILI_COOKIE`、抖音需要反代理配置」。

---

## 给实现的建议

综合上文的实测结论，给出 **3 个可直接落地的渠道定义**。三个渠道**均不需要登录态**，可以立刻接入。

### 渠道 1：`toutiao-hot` — 今日头条热榜（直接复用）

```yaml
id: toutiao-hot
name: 今日头条热榜
url: https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc
method: GET
headers:
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
  Referer: https://www.toutiao.com/
requires_login: false
parser:
  ok_check: status == "success"
  list_path: data            # 50 条；另有 fixed_top_data[]（1 条置顶，可单独处理）
  fields:
    id:         ClusterIdStr
    title:      Title
    hot:        Number(HotValue)                       # HotValue 是字符串
    url:        Url                                    # 或自拼 https://www.toutiao.com/trending/${ClusterIdStr}/
    label:      Label                                  # "", hot, new, onSite, refuteRumors
    label_desc: LabelDesc                              # 稀疏（25/50），可能为 null
    cover:      Image.url
    icon:       LabelUri.url
    category:   InterestCategory[0]                    # 42/50 存在；注意不存在 Category 字段
notes:
  - 端点无签名、无 cookie 校验（裸请求亦 200）
  - v1/v2 端点 404，不存在更新版本
  - 备用镜像主机：https://api.toutiaoapi.com/hot-event/hot-board/?origin=toutiao_pc
```

### 渠道 2：`ifeng-hot` — 凤凰热榜（直接复用，**不要用 PC 首页正则方案**）

```yaml
id: ifeng-hot
name: 凤凰热榜
url: https://ne883dbn.ifeng.com/hotspotlist?page={page}&gv=7.9.1&av=7.9.1
method: GET
headers:
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
  Referer: https://ishare.ifeng.com/hotNewsRank
requires_login: false
pagination:
  start_page: 1
  stop_when: data.list.length == 0      # ⚠️ 不要信 data.totalPage（实测恒为 1 但第 2 页仍有 5 条）
  known_total: 35                        # page1=30 + page2=5
parser:
  ok_check: code == 0
  list_path: data.list
  fields:
    id:             id                   # ucms_xxx
    title:          title
    source:         source
    url:            link.url             # ⚠️ 顶层没有 url 字段，链接在 link.url
    updated_at:     updateTime           # "2026/10/12 05:57:01"
    cover:          imageList[0].url     # 或 thumbnail（webp 转码代理）
    comments_url:   commentsUrl
    comments_count: commentsCount        # 稀疏（25/30）
    content_type:   type                 # doc | phvideo
notes:
  - 主机名 ne883dbn.ifeng.com 由页面 window.allData.__nd__ 动态下发，必须可配置
  - 备选内联方案（零额外请求、51 条）：解析 https://i.ifeng.com/ 的 allData.hotRankData.data[]
  - 展示页链接：https://ishare.ifeng.com/hotNewsRank
  - 不要使用 api.inews.ifeng.com（域名不解析）/ i.ifeng.com/news/hotRankList（404）
```

### 渠道 3：`ifeng-hot-mobile-inline` — 凤凰热榜（兜底，仅在渠道 2 换域时启用）

```yaml
id: ifeng-hot-mobile-inline
name: 凤凰热榜（移动端内联兜底）
url: https://i.ifeng.com/
method: GET
headers:
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
requires_login: false
parser:
  strategy: 从 HTML 中提取并解析 `var allData = {...}`（需做花括号配对，不能用 `\{[\s\S]*?\}` 非贪婪正则——
            i.ifeng.com 的 allData 内嵌多行 JSON，惰性匹配会截断；www.ifeng.com 是单行，惰性匹配可用）
  list_path: hotRankData.data            # 51 条
  fields:
    id:         base62Id
    title:      title
    source:     source
    url:        url                      # 这里是顶层 url（与渠道 2 的 link.url 不同！）
    cover:      thumbnail
    updated_at: newsTime                 # "2026-10-11 23:33:34"
    comments_url: commentUrl
  meta: hotRankData.update_time          # "2026-10-12 07:52:20"
notes:
  - 仅在渠道 2 失败时启用；两者是同一份榜单的不同出口
  - 顶层列表字段名与渠道 2 不同，解析器不可共用
```

### 三个渠道的落地优先级

1. **先上渠道 1 + 渠道 2**：两条都已实测 200、免登录、JSON 结构化，共约 **85 条**热榜数据（50 + 35），覆盖今日头条与凤凰网两个目标平台。
2. **渠道 3 作为渠道 2 的熔断兜底**：因为渠道 2 的 API 主机名由前端 `__nd__` 动态下发，存在换域风险；用 `i.ifeng.com` 内联数据做兜底可显著降低单点失效。
3. **头条号（创作者平台）本轮不接入**：需要登录态 + 可能还需 `tag_info.hotboard_invitation` 权限，且无任何开源实现可参考，且**无法证实其与今日头条热榜是否同源** —— 投入产出比低，且与发布链路的登录态耦合会带来账号风控风险。若产品后续确实需要，必须先做一次登录态抓包确认响应结构。

---

## 未核实清单（诚实声明）

以下内容本次**未能证实**，实现时不可当作已知事实：

1. **头条号创作者平台热点列表的实际响应结构与字段** —— 必须登录态，本机 CDP 不可用（`web-access` 的 `check-deps.mjs` 报「没有任何浏览器打开远程调试开关」，需用户在浏览器手动开启远程调试），因此未取得。
2. **头条号热点与今日头条热榜是否同源** —— 无法证实也无法证伪。
3. **`DailyHotApi` 用 `ClusterIdStr` 反推时间戳（`getTime`）的准确性** —— 社区经验，未做精度验证。
4. **`nine.ifeng.com/hotSpotDetailList`** —— 从 `hotNewsRank` 页面提取到的条目详情链接，未单独抓取验证。
5. **巨量算数 `trendinsight.oceanengine.com` 的任何子接口** —— 该站任意路径都返回同长度 HTML（SPA catch-all），无法据此判定存在性。
6. **`ne883dbn.ifeng.com` 之外是否还有其它 `__nd__` 值** —— 仅在本次请求中观测到该值。
7. **`ShellMonster/DailyHotApi-Go`、`getoneapi/OneAPI` 的实际实现质量与端点** —— 仓库无 LICENSE 文件，未读源码。
