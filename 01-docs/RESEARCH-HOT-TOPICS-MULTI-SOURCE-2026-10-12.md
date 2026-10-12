# 研究报告：热门选题多渠道扩展 + 新增 AI 分类 + 归类准确性分析

- 版本：v1.0
- 日期：2026-10-12
- 关联 change：`openspec/changes/hot-topics-multi-source-ai-category`
- 关联实现：`apps/desktop/electron/services/hot-topics-service.js`、`apps/desktop/electron/services/hot-topics/{channels,classifier,scorer}.js`、`apps/desktop/src/views/HotTopics.vue`、`ops-center/backend/services/content_category_service.py`
- 一手来源（本次三份源调研报告，均已落盘）：
  - `01-docs/research/hot-topics-sources-douyin-xhs.md`（抖音 / 小红书）
  - `01-docs/research/hot-topics-sources-toutiao-ifeng.md`（今日头条 / 头条号 / 凤凰网）
  - `01-docs/research/hot-topics-classification-accuracy.md`（分类标准与准确性）
- 本文件是**归纳与索引**：结论与实测数字一律取自上列三份源报告与工作区真实代码，不重新发明、不补造。

---

## 0. 摘要（一句话结论）

| 诉求 | 调研结论 | 本轮处置 |
|---|---|---|
| 扩展更多数据源 | 抖音主端点免登录免签名可用但「缺 UA/Referer 即 200+空列表」；小红书存在**唯一**免登录 App 端热搜接口（需静态 `shield` 头）；今日头条端点可用但**响应里没有 `Category` 字段**；凤凰网有比主流开源实现更优的 JSON 端点；头条号**必须登录态** | 新增 `xiaohongshu` / `ifeng` 两渠道（渠道数 8 → 10），抖音补两级顺序降级链，头条字段修正，头条号明确不接入 |
| 新增 AI 分类 | AI 已是独立内容域，行业产品（tophub）已把 AI 作一级分类 | 分类枚举 10 → 11，`ai` 紧随 `tech`；同步 5 处跨端契约 + 4 个 locale 文件 + `CATEGORY_BOOSTS.ai` 补拉源 |
| 归类准确性 | 「科技类混入不沾边内容」的机制级根因有四条：整批错配的宽泛原生桶、拉丁词裸子串、无强弱/无阈值的打分、补拉条目硬挂分类；LLM 兜底只处理 `general`，结构上无法纠错 | 已修：宽泛桶让位 + 域级泛称不参与裁决、拉丁词边界、强/弱词打分 + `MIN_SCORE`、补拉走分类器、`general` 语义收窄。**未修**：LLM 送审集合、去重合并只升不降、展示 2 / 存储 3 口径不一致 |

---

## 1. 背景与目标

### 1.1 用户原话诉求拆解

用户在 2026-10-12 提出三件事，全部源自**实际使用中看到的症状**（原话拆解如下）：

1. **「对热门选题扩展更多数据源」** —— 并点名要求调研 **抖音 / 小红书 / 今日头条 / 头条号 / 凤凰网** 在开源项目里是否已有热榜或热门内容的获取实现，「能复用就复用、否则参考技术实现」。
   - 隐含验收：新增渠道必须能在缓存/列表里看到条目，而不是只写进配置文件。
2. **「类别中，再增加一个 AI 分类」** —— 现有 10 类中 AI 内容被压进「科技」，而 AI 已是一大块独立内容域。
   - 隐含验收：AI chip 下有数据（意味着分类器要能判出 `ai`，而不是只加一个枚举）。
3. **「科技类别下，有时候存在和科技不沾边的内容」** —— 要求分析归类标准与逻辑，并给出优化准确性的办法。
   - 隐含验收：要能说清「为什么错」的机制，而不是笼统地说「关键词表不够全」。

### 1.2 三条诉求对应的现状核查（先证实症状，再谈方案）

| 诉求 | 现场核查结论 | 证据 |
|---|---|---|
| 数据源少 | 原有 8 个渠道里**没有小红书、没有凤凰网** | `hot-topics-service.js:64-106` 的 `CHANNEL_CONFIGS` 历史形态；本轮回填后共 10 项 |
| 数据源少 | 抖音虽在列，但缺 UA/Referer 时是「HTTP 200 + `word_list` 空数组」；旧实现把这种情况**记成成功** | 源报告《抖音/小红书》§结论 2 的逐项隔离实验（实验 3/4/5 全部 200 + 空列表） |
| 缺 AI 分类 | `classifier.js` v2 只有 10 类，`CATEGORY_BOOSTS` 里也没有任何 AI 供給 | 源报告《分类准确性》§0 基线表 + §0.1（B4 现场证据） |
| 归类不准 | v2 分类链为「渠道原生映射 → 关键词先到先得 → general」，其中**渠道原生映射无条件压过关键词**；`bilibili['知识']='tech'`、`weibo['科学科普']='tech'`、`toutiao['汽车']='tech'` 把**整批泛知识/泛科普/汽车内容**硬挂进科技 | 源报告《分类准确性》§2.1 的 v2 代码引用 + `PRD-HOT-TOPICS-CATEGORY-SUPPLY-2026-09-20.md:75` |
| 归类不准 | 补拉渠道（`_collectBoostChannel`）把条目 `category` **无条件硬写成 `boostCategory`**，分类器完全不参与 | 源报告 §2.4；现工作区已改为分类器优先（`hot-topics-service.js:393-403`） |
| 归类不准 | LLM 兜底送审集合是 `if (t.category !== 'general') continue` —— **只处理 `general`**，已被错判成 `tech` 的条目永不进 LLM | 源报告 §2.6 机制 #1；现工作区 `hot-topics-service.js:491` **仍是这一行** |

**结论：三条诉求都不是错觉，全部有一手机制证据支撑。**

---

## 2. 调研方法与取证边界

### 2.1 取证方式与时间

| 维度 | 抖音 / 小红书报告 | 今日头条 / 头条号 / 凤凰网报告 | 分类准确性报告 |
|---|---|---|---|
| 时间 | 2026-10-12 07:50–08:15 | 2026-10-12（含 07:57 字段覆盖率） | 2026-10-12（含 07:56 增补） |
| 端点实测方式 | 本机 `curl`（Windows），**未携带任何 Cookie / 登录态 / 代理 / 账号** | PowerShell `Invoke-WebRequest` + `curl.exe`，公网直连（无代理环境变量） | 直接 `node` 调用 `classifyTopicMulti` 实跑 26 例 |
| GitHub 元数据 | `api.github.com`（首方）+ `img.shields.io`（首方派生 star / 最后提交 / 许可） | `gh api`（本机已登录 gh，绕过匿名 60 次/小时限流） | `api.github.com` 读 `src/types.d.ts` |
| 源码取证 | `raw.githubusercontent.com` 逐文件读取 | 同上 | `raw.githubusercontent.com` 读取 DailyHotApi 类型契约 |

### 2.2 三分法：一手实测 / 搜索摘要级 / 未核实

> 这一节是本文的**诚信边界**。凡未核实项一律不得在本 PRD 或代码里当作已知事实。

**A. 一手实测（可直接作为实现依据）**

| 项 | 状态 |
|---|---|
| 抖音三端点（web / `aweme-lq.snssdk.com` / `iesdouyin`）状态码、条数、字段 | ✅ 30 条请求记录逐条落表 |
| 抖音「UA 与 Referer 缺一即 200 + 空列表」 | ✅ 逐项隔离实验（实验 3/4/5/6） |
| 抖音 `board_type=0..8` 矩阵、三个 404 端点 | ✅ 实测 |
| 小红书五件套头部隔离矩阵（实验 16–22，全部 406 或 200） | ✅ 实测 |
| 小红书 `/explore` 302 → `/login` | ✅ 实测（130B，无 `__INITIAL_STATE__`） |
| tophub.today 无小红书榜（首页命中 2 / 节点索引命中 0） | ✅ 实测 HTML |
| 今日头条 `hot-board` 200 / 50 条 / 字段覆盖率（`Category` 0/50） | ✅ 实测 |
| 今日头条 `v1` / `v2` 端点 404、空 `_signature` 无影响 | ✅ 实测 |
| 头条号 `mp.toutiao.com` 外壳 200、三个入口无 cookie 全 502 | ✅ 实测 |
| 头条号 4 个猜测接口全部 404、16 个 bundle 提取 250 条 `/mp/agw/...` 无热点接口 | ✅ 实测 |
| 凤凰网 `hotspotlist` page1=30 / page2=5 / page3=0、`totalPage` 恒 1 | ✅ 实测 |
| 凤凰网 `i.ifeng.com` 内联 51 条 / `www.ifeng.com` 内联 12 条 | ✅ 实测 |
| `api.inews.ifeng.com` **DNS 不解析** | ✅ 实测（不是「暂时挂了」） |
| `i.ifeng.com/news/hotRankList` 404、`ishare.ifeng.com` 空路径 404 | ✅ 实测 |
| DailyHotApi 57 个 route 文件清单（无 `ifeng.ts`、无 `xiaohongshu.ts`） | ✅ `gh api .../git/trees/master?recursive=1` |
| tophub.today 一级 16 类（含 `/c/ai`）、科技域 14 个二级标签 | ✅ 一手 HTML |
| DailyHotApi `src/types.d.ts` 的 `ListItem` **无 category 字段** | ✅ 一手 |
| 分类器 26 例实跑输出（含 `'科技'+«今晚吃什么»` → `tech` 等反例） | ✅ 实跑 |

**B. 搜索摘要级（结论可用，但正文未逐篇打开核实）**

| 项 | 说明 |
|---|---|
| 中文短文本分类 / TF-IDF / BM25 在标题级短文本上退化 | 源报告 §3.1，给出 CSDN / 博客园 / 腾讯云开发者社区的检索题名与链接；**正文未逐篇核实** |
| LLM 自报置信度过度自信、需校准 | 源报告 §3.5，给出 arXiv 编号与检索题名；**正文未逐篇核实** |
| FrugalGPT 式级联成本控制、主动学习按不确定性采样 | 同上 |

> 取证环境限制（源报告 §三 开头已如实记录）：内置 `web_fetch` 拒绝解析到保留网段（198.18.0.0/15）的域名，CDP 浏览器通道未启用，`web_search` 后端未配置 key —— 因此上述三项**只能到搜索摘要级**。

**C. 未核实（实现时不可当作已知事实）**

1. **头条号创作者平台热点列表的实际响应结构与字段** —— 必须登录态；本机 CDP 不可用（`web-access` 的 `check-deps.mjs` 报「没有任何浏览器打开远程调试开关」，需用户手动开启远程调试），因此未取得。
2. **头条号热点与今日头条热榜是否同源** —— 无法证实也无法证伪。
3. **DailyHotApi 用 `ClusterIdStr` 反推时间戳（`getTime`）的准确性** —— 社区经验，未做精度验证。
4. **`nine.ifeng.com/hotSpotDetailList`** —— 从展示页提取到的条目详情链接，未单独抓取验证。
5. **巨量算数 `trendinsight.oceanengine.com` 的任何子接口** —— 该站任意路径都返回同长度 HTML（SPA catch-all），无法据此判定存在性。
6. **`ne883dbn.ifeng.com` 之外是否还有其它 `__nd__` 值** —— 仅观测到该值。
7. **小红书 `items` 数组序在多次请求间是否严格稳定** —— 未做重复采样。
8. **高频轮询的 IP 级风控触发阈值** —— 未实测触发。
9. **完整评测指标基线** —— 标注集不存在，源报告 §5.2 的门槛为**建议值**，不得当作已验证。
10. **`ai` 补拉源的端点可用性（tophub `/c/ai` 路线）** —— 未实测；本轮改用已有端点 + 分类器筛选（见 §4.2）。
11. **`ShellMonster/DailyHotApi-Go`、`getoneapi/OneAPI` 的实际实现质量** —— 仓库无 LICENSE 文件，未读源码。
12. **`ccbikai` 名下是否有热榜项目** —— 该用户仓库列表页为 JS 渲染，本次未取到；不做推测。

### 2.3 已发现的口径瑕疵（如实列出，避免以讹传讹）

| # | 瑕疵 | 事实 | 本文/实现的口径 |
|---|---|---|---|
| 1 | 小红书「五件套」与 6 个头部名 | 源报告正文称「五件套（缺一即 406）」，但其表格与逐项实验实际枚举 **6 个头名**：`User-Agent`、`referer`、`xy-direction`、`shield`、`xy-platform-info`、`xy-common-params` | 实现按 **6 项全非空**落配置；测试 `hot-topics-new-sources.test.js` 逐一断言这 6 个键。文档保留「五件套」这一历史称谓，但以「6 个头部名」为准 |
| 2 | 凤凰网「3 条可用路径」的强弱 | 3 条路径条数差异极大：JSON 出口 35 条 / 移动端内联 51 条 / **PC 首页内联仅 12 条**；主流开源实现（newsnow / briefy）用的是最弱的那条 | 实现采用「JSON 主出口 + 移动端内联兜底」，**不使用** PC 首页 12 条方案 |
| 3 | 头条号入口权限标记的取数方式 | `tag_info.hotboard_invitation` 取自 `mp.toutiao.com` 首页内联导航 JSON，**不是**从实际接口 403 反推 | 本文只表述为「导航项自带该权限标记」，不表述为「接口返回 403」 |
| 4 | 源报告 §2.8 最后一行 | 该行得 `general` 是因为测试夹具把 `channel` 位置写成了 `bilibili:科技`（含冒号），与分类器逻辑无关；真实链路等于倒数第七行 | 源报告已自行注明；本文不采用该行作为反例 |

---

## 3. 开源项目调研总表

> 数据取自两份源调研报告；star 数为 2026-10-12 量级。**本表只做归纳，未新增任何仓库名**。

### 3.1 抖音 / 小红书组（11 个已核实仓库）

| # | 仓库全名 | Star | 最后更新 | License | 抖音 | 小红书 | 与本项目的关系 |
|---|---|---|---|---|---|---|---|
| 1 | `imsyy/DailyHotApi` | 4.1k（API 精确 4088） | 2026-03-11 | MIT | ✅ | ❌（57 个 route 中无） | 参考实现（抖音取 `passport_csrf_token`） |
| 2 | `ourongxing/newsnow` | 22k | 2026-09 | MIT | ✅ | ❌（59 个 source 中无） | 参考实现（抖音从 `login.douyin.com` 取 Set-Cookie） |
| 3 | `vikiboss/60s` | 5.8k | 2026-09 | MIT | ✅ | ✅ | **最直接参考**：小红书端点 + 5 头常量逐字可用；其托管 API 从本机出口 429 |
| 4 | `NanmiCoder/MediaCrawler` | 67k | 近期 | **NON-COMMERCIAL LEARNING LICENSE 1.1** | ✅ | ✅ | **不可复用代码**（非商用许可）；可作为「平台收紧风控」的影响面参考 |
| 5 | `cloxl/xhshow` | 1.1k | 2026-06 | MIT | ❌ | ✅（签名库） | 不采用（Web 端签名路线投入产出比低） |
| 6 | `JoeanAmier/XHS-Downloader` | 13k | 2026-09 | **GPL-3.0** | ❌ | ✅（作品采集，非热榜） | **不可复用**（GPL 传染 + 目标不匹配） |
| 7 | `ReaJason/xhs` | 2.2k | 2025-03 | MIT | ❌ | ✅（Web 封装） | 不采用（需 Cookie + 签名，且无热榜） |
| 8 | `ymybxx/SoloMCN` | 50 | 2026-10-10 | MIT | ✅ | ⚠️ 仅发布侧 | 参考实现（`trending_list` 作 `rising`、三级兜底） |
| 9 | `wimdaw/hot-topics` | 0 | 2026-09-14 | NOASSERTION（未识别） | ✅ | ✅ | **范式参考**：`firstOk` 顺序降级；`if (!items.length) throw` 空列表即失败 |
| 10 | `chensn05/hot-radar` | 1 | 2026-09-07 | MIT | ✅ | ✅ | 参考 `_parse_cn_number`（`'920.8w'/'1.2万'` → int）；但其数据经第三方托管 API，不可控 |
| 11 | `ieliwb/tophub-api` | 33 | 2023-11-30 | 未标注 | ❌ | ❌ | 仅文档仓库；今日热榜本身无小红书榜 |

### 3.2 今日头条 / 头条号 / 凤凰网组（13 个已核实仓库）

| # | 仓库全名 | Star | 最后推送 | License | 今日头条 | 头条号 | 凤凰网 | 结论 |
|---|---|---|---|---|---|---|---|---|
| 1 | `imsyy/DailyHotApi` | 4088 | 2026-03-11 | MIT | ✅ `src/routes/toutiao.ts` | ❌ | ❌（无 `ifeng.ts`） | 今日头条：参考；凤凰网：无源 |
| 2 | `newsnext/newsnow` | 22008 | 2026-09-16 | MIT | ✅ | ❌ | ✅ 但**弱**（PC 首页 12 条） | 凤凰网方案**不照抄** |
| 3 | `sansan0/TrendRadar` | 62807 | 2026-10-10 | **GPL-3.0** | ⚠️ 间接（经 newsnow API） | ❌ | ⚠️ 间接 | 借鉴其 `expected_domain` 域名白名单防御模式；代码不可复用 |
| 4 | `imsyy/DailyHot` | 910 | 2024-11-05 | MIT | 前端消费 DailyHotApi | ❌ | ❌ | 无采集逻辑 |
| 5 | `tophubs/TopList` | 4733 | 2023-02-23 | Apache-2.0 | ❌（`GetHot.go` 0 命中） | ❌ | ❌（0 命中） | 不含目标平台 |
| 6 | `huqi-pr/trending-in-one` | 466 | 2025-04-24 | MIT | ✅（今日头条热搜） | ❌ | ❌ | **已归档**，仅历史参考 |
| 7 | `Lysander66/briefy` | 10 | 2026-03-08 | MIT | ✅ `fetcher/toutiao.py` | ❌ | ✅ 弱（12 条） | 凤凰网方案弱 |
| 8 | `wu529778790/newshub.shenzjd.com` | 23 | 2026-08-06 | **无 LICENSE 文件** | ✅ | ❌ | ✅ 弱 | **默认保留所有权利，不可复制代码** |
| 9 | `JackyST0/hotpush` | 193 | 2026-10-10 | MIT | ❌ | ❌ | ❌ | 走 RSSHub，目标平台均不支持 |
| 10 | `lixi5338619/lxSpider` | 1976 | 2024-05-09 | **GPL-3.0** | ⚠️ 教学向爬虫合集 | ❌ | ❌ | 非生产可用 |
| 11 | `imsyy/DailyHotApi-Vercel` | 77 | 2025-02-17 | MIT | 同 DailyHotApi | ❌ | ❌ | 部署壳 |
| 12 | `ShellMonster/DailyHotApi-Go` | 8 | 2025-10-21 | 未核实（无 LICENSE） | 声称含 | ❌ | ❌ | 未核实质量 |
| 13 | `getoneapi/OneAPI` | 104 | 2026-10-09 | 未核实（无 LICENSE） | 声称含 | ❌ | ❌ | 商业 API 聚合，非开源实现 |

### 3.3 点名/流传但**实测不存在**的仓库（避免后人重复试探）

| 被点名/流传 | 核实结果 | 证据来源 |
|---|---|---|
| `ccbikai/hot-search` | **不存在**（Not Found） | `api.github.com/repos/ccbikai/hot-search` |
| `ccbikai/NewsNow` | **不存在**（同名项目实为 `ourongxing/newsnow`） | `api.github.com` Not Found |
| `wangyucode/hot-search` | **不存在** | `api.github.com` Not Found |
| `tophub/tophub` | **不存在**；tophub.today 为闭源商业站点 | `api.github.com` Not Found |
| `ruanyf/hot-news` | **不存在**（`ruanyf/weekly` 存在，105,835★，但是科技周刊） | `api.github.com` Not Found |
| `ttttmr/NewsNow`、`xykt/hot-topics` | **不存在**（HTTP 404） | `gh api` |
| `seiichieto07/rebang` | 存在（24★）但**只有 81 篇 VPS 推广 md**，是导流/SEO 仓库，不是抓取实现 | 实测仓库文件树 |
| `Gazer-887/mini-hot` | 存在（0★）但**未定位到其源码文件**，实现细节未核实 | — |

---

## 4. 平台逐一结论

### 4.1 抖音：主端点免登录免签名，但门槛在「两个 header」

**三端点（均已实测 2026-10-12）**

| 端点 | 角色 | 头部要求 | 实测 |
|---|---|---|---|
| `www.douyin.com/aweme/v1/web/hot/search/list/` | **主端点** | 浏览器 `User-Agent` **且** `Referer: https://www.douyin.com/`（**缺一即 200 + 空列表**） | 200，`data.word_list` 46 条 |
| `aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880` | 兜底 #1 | **零头部**（连 UA 都不需要） | 200，`status_code=0`，46 条 + `trending_list` 5 条 |
| `www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/` | 兜底 #2 | 零头部 | 200，50 条，字段最简（仅 `word`/`hot_value`/`label`） |

**关键机制结论**

1. **门槛不是签名，是 header。** 逐项隔离实验：只给 Referer 或只给浏览器 UA → HTTP 仍 200 但 `word_list` 为空；两者同时具备才 46 条。→ **失败形态是「200 + 空列表」而非 4xx**，这是「空列表必须视为失败」这条合同的直接来源。
2. **`board_type` 不产生子榜。** `0..3` 返回同一份榜单（47/46/46/46），`4..8` 返回 0 条 —— 容易被误判成「渠道挂了」。
3. **签名只在详情/搜索接口上需要。** `MediaCrawler` 为 `/aweme/v1/web/*` 详情与搜索接口生成 `a_bogus`（JS 计算 + Playwright 注入）、`msToken`、`webid`、`verifyFp`；其源码注释写明「当前网关尚未校验该头的值…将来若开始真校验，会重新出现 Signature Not Found」。→ **今天不需要，但这是平台侧可随时收紧的口子**，因此该渠道 `riskLevel='high'` 且必须纳入熔断。
4. **三个端点不存在，禁止写进代码**：`/aweme/v1/web/billboard/list/`、`/aweme/v1/web/hot/search/detail/`、`/aweme/v1/web/hot/word/` 实测均为 **404 `Unsupported path(Janus)`**；`iesdouyin .../billboard/hot_video/` 返回 `status_code:1 / Url doesn't match`；`.../billboard/aweme/` 恒为空数组。
5. **字段语义**（`data.word_list[]`）：`word` 正文、`hot_value` 热度、`position` 名次（`trending_list` 项**无**此字段且 `hot_value` 实测为 0）、`sentence_id` 可拼 `https://www.douyin.com/hot/{id}`、`max_rank` 历史最高名次、`is_n1` 置顶推广位、`sentence_tag`/`label` 原生分类角标。`data.active_time` 为榜单快照时间。

**本轮落地点**（`hot-topics-service.js:69-79`、`channels.js:112-132`）：主端点保留并显式声明 `Referer`（UA 由 service 统一注入 `DESKTOP_UA`，见 `:271`）；新增 `fallbacks` 两级；`parseDouyin` 共用三端点、`rank` 优先 `position`、`trending_list` 去重后标 `rawCategory='上升热点'`、`url` 用 `sentence_id`。

### 4.2 小红书：唯一免登录入口是 App 端，代价是静态 `shield`

**结论：不存在「免登录的公开 Web 热榜接口」，但存在一个免登录的 App 端热搜接口。**

| 端点 | 结果 | 结论 |
|---|---|---|
| `edith.xiaohongshu.com/api/sns/v1/search/hot_list` | **200**，`code:0`，`data.items` **20 条**，全程未发 Cookie | ✅ 唯一实测可用的热榜数据源 |
| `www.xiaohongshu.com/explore` | **302 → `/login?redirectPath=…`**，响应体 130B，**无 `__INITIAL_STATE__`** | ❌ Web SSR 路线已失效 |
| `edith.xiaohongshu.com/api/sns/web/v1/search/notes` | 需 `X-S`/`X-T`/`x-S-Common` 签名 + 登录 Cookie | ❌ 成本极高，且**不是热榜** |
| `creator.xiaohongshu.com/...` | 根路径 200；本次猜测的两个数据路径 404 / 401（**路径未经开源项目印证**） | ❌ 不采用 |
| `60s.viki.moe/v2/rednote` 等第三方托管 | 三次重试全部 **429 + Cloudflare `error code: 1027`** | ❌ 不可控，不作为来源 |

**`shield` 是硬性门槛（逐项隔离实验）**

| 实验 | 发送的头 | 结果 |
|---|---|---|
| 16 | 仅 UA | 406 |
| 17 | UA + `referer` | 406 |
| 18 | + `xy-direction: 22` | 406 |
| 19 | + `xy-platform-info` | 406 |
| 20 | + `xy-common-params`（**不含 shield**） | **406** ← 证明 `shield` 是硬门槛 |
| 21 | 完整 6 头（含 `shield`） | **200**，20 条 |
| 22 | 仅 `shield`（无其它 `xy-*`） | **406** ← 证明缺一不可 |

**字段语义**：`data.items[].title` / `.score`（**字符串且带 `w` 后缀**，如 `"947.5w"`）/ `.word_type`（实测仅 `「热」`/`「无」`两值）/ `.id`（`dora_` 前缀）；`rank_change` 实测全 0；`type` 全 `normal`。**接口不返回 rank**，排名只能按数组序 `i+1`。

**「多个项目都在用」是假冗余**：`60s`、`wimdaw/hot-topics`、`chensn05/hot-radar` 三家的「小红书热点」**同源**（hot-radar 走 60s 托管 API），源码 URL 与头部逐字一致 → 换一个聚合器不带来独立可用性。

**「tophub / DailyHotApi / newsnow 有小红书榜」在本项目实测中不成立**：tophub.today 首页「小红书」命中 2（一条资讯标题 + 一个站外链接）、节点索引 `/c/news` 命中 **0**，且无任何 `/n/*` 节点指向小红书榜；DailyHotApi 57 个 route 无 `xiaohongshu.ts`；newsnow 59 个 source 无 `rednote`/`xiaohongshu`。

**本轮落地点**（`hot-topics-service.js:80-92`、`channels.js:139-149`）：新增 `xiaohongshu` 渠道，6 个头全部落配置，`shield` 抽为集中常量 `XHS_SHIELD`（`:52`）并在注释中写明「平台轮换即失效，只能人工替换」；`riskLevel='high'`、`intervalMinutes=30`；新增 `parseCnNumber`（`'947.5w'` → 9475000）与 `parseXiaohongshu`。

**合规**：不复制 `MediaCrawler`（非商用许可）与 `XHS-Downloader`（GPL-3.0）的代码，只按其公开的**接口事实**自行实现解析。

### 4.3 今日头条：端点可用，但**响应里没有 `Category` 字段**

| 项 | 实测 |
|---|---|
| `www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc` | **200**，`data[]` **50 条**；无 cookie、无签名、无 UA 校验（裸请求亦 200） |
| 镜像主机 `api.toutiaoapi.com/...` | 200，同榜单（图片 CDN 主机不同） |
| `hot-board/v1/`、`hot-board/v2/` | **404**（没有更新的版本化端点） |
| 带空 `_signature=` | 200，响应体与主端点完全相同 → 当前不需要签名 |

**字段覆盖率（50 条样本，2026-10-12 07:57）**

| 字段 | 存在条数 | 说明 |
|---|---|---|
| `Title` / `HotValue` / `Url` / `ClusterIdStr` / `Label` / `LabelUri` / `Image` / `QueryWord` / `Schema` | 50/50 | `HotValue` 是**字符串**（如 `"34870847"`） |
| `InterestCategory` | **42/50** | 字符串数组，如 `["sports"]` |
| `LabelDesc` | **25/50**（其余为显式 `null`） | 稀疏字段 |
| **`Category`** | **0/50** | **该字段不存在** |

`Label` 实测取值集合：`""`、`hot`、`new`、`onSite`、`refuteRumors`；`LabelDesc` 实测取值：`"辟谣"`、`"热门事件"`、`"现场"`、`"新事件上榜"`。

**用户列出的字段名有两处不准确**，这是本节最重要的结论：任务书假设的 `Category` 字段在响应里**根本不存在**，语义相近的是 `InterestCategory[]`。→ 解析器必须改为优先 `InterestCategory[0]`、回退历史 `Category`（兼容旧缓存/旧响应）。

**本轮落地点**（`channels.js:48-59`）：`parseToutiao` 已按上述修正；`url` 优先 `Url`、回退 `ClusterIdStr` 自拼 `https://www.toutiao.com/trending/{id}/`；`HotValue` 经 `Number()`。

### 4.4 头条号（创作者平台）：**本轮不接入**

| 项 | 实测/核实结论 |
|---|---|
| 入口域 | `https://mp.toutiao.com/` 返回 **200** 与 `<title>头条号</title>`，是 SPA 外壳（**未登录也返回同一份 HTML**） |
| 真实存在的热点入口（从首页内联导航提取，非猜测） | `热点精选` `/activity/hot-selection`（带 `permission: tag_info.hotboard_invitation`）、`热点` `/activity/hot-spot`、`搜索任务` `/activity/task-list` |
| 无 cookie 访问 | 三个入口全部 **502 Bad Gateway**（带 Referer 亦然）；`/hotboard` 502，`/profile_v4/hotboard` 200 外壳 → **未登录不可访问** |
| 数据接口 | 抓取首页引用的 **16 个 JS bundle**，正则提取 **250 条** `/mp/agw/...` 路径，与热点/热榜相关的**只有导航字符串本身**；`statistic/*trend*` 全是账号自身趋势统计 → **数据接口不在主包内** |
| 手动猜测的 4 个接口 | `creator_hot_spot/list`、`hot_spot/list`、`trend/list`、`get_hot_board` **全部 404**（明确记录以免后人重复试探） |
| 开源参考实现 | GitHub 代码搜索 `mp.toutiao.com/hot` **命中 0**（`total_count: 0`） |
| 与今日头条热榜是否同源 | **无法证实也无法证伪**（拿不到响应体） |

**不接入的四条理由（逐条可取证）**：
1. **必须登录态**，且部分入口还需 `tag_info.hotboard_invitation` 邀请权限 —— 不是所有账号都有，产品上会出现「有的用户有、有的没有」的不一致体验。
2. **无任何开源实现可参考**（0 命中），任何实现都建立在「抓包一次登录态请求」之上，长期稳定性完全依赖对端不改实现。
3. **无法证实与今日头条热榜同源**，为「可能是同一个榜单」接两套不划算。
4. **账号风控与耦合风险**：在桌面端用用户自己的头条号 cookie 抓创作者平台热点，等于把「内容创作者的登录态」用于自动化读取；若与发布流程共用同一 cookie，登录失效会同时打断发布与热点。

**如果后续确需**：先做一次登录态抓包确认响应结构，实现里明确标注 `requires_login: true` + 独立 cookie 分区（**与发布用登录态隔离**）。

### 4.5 凤凰网：两个出口，JSON 出口优于主流开源实现

| 出口 | 实测 | 字段要点 |
|---|---|---|
| **主出口** `ne883dbn.ifeng.com/hotspotlist?page=1&gv=7.9.1&av=7.9.1` | 200，`application/json`，`code:0`；page1=**30 条**、page2=**5 条**（共 35 条）、page3=0 条 | 条目链接在 **`link.url`**（**顶层没有 `url` 字段**）；`hotValue` 口径可用 `commentsCount`（25/30 存在）；`type ∈ {doc, phvideo}`；`updateTime` 形如 `2026/10/12 05:57:01` |
| **兜底出口** `i.ifeng.com` 首页内联 `allData.hotRankData.data` | 200（len≈342KB），**51 条** | 条目链接在**顶层 `url`**；`newsTime` 形如 `2026-10-11 23:33:34`；`base62Id` 可拼 `https://news.ifeng.com/c/{base62Id}` |
| 不采用：`www.ifeng.com` 内联 `allData.hotNews1` | 200（len≈277KB），**仅 12 条**，部分条目缺 `newsTime`/`thumbnail` | 这正是 `newsnow` / `briefy` 用的那条 —— **三者中最弱**，不照抄 |
| 不存在：`api.inews.ifeng.com/hot/ranking/hot_rank_list.php` | **DNS 不解析**（本机两次探测分别报「不知道这样的主机」「找不到请求的类型的数据」） | 不是「暂时挂了」，是**域名不存在**，任何引用它的实现都应删除 |
| 不存在：`i.ifeng.com/news/hotRankList` | **404** | — |
| 展示页：`ishare.ifeng.com/hotNewsRank` | 200（len≈56.6KB），`<title>凤凰热榜_凤凰网</title>`，React 客户端渲染（HTML 内 0 条数据） | 可作「人类可读榜单页」引用链接，**不要解析它的 HTML** |

**三个必须注意的机制**

1. **`totalPage` 不可信**：实测恒为 1，但第 2 页仍有 5 条数据 → 翻页必须按「本页返回条数 > 0」驱动。
2. **主机名由前端动态下发**：`ne883dbn.ifeng.com` 来自 `ishare.ifeng.com/hotNewsRank` 页面 JS bundle 的 `window.allData.__nd__`（默认回退值就是它）→ **理论上可能换域**，这正是必须有兜底出口的原因。
3. **两个出口不能共用解析器**：JSON 出口用 `link.url`，内联出口用顶层 `url`；混用会静默产出空列表。内联出口的 `allData` 是**内嵌多行 JSON**，用 `\{[\s\S]*?\}` 惰性正则会截断在第一个 `}`（`www.ifeng.com` 恰好是单行、惰性匹配可用 —— 这是「换个出口就静默少数据」的隐蔽陷阱），必须做花括号配对并跳过字符串字面量与转义。

**本轮落地点**（`hot-topics-service.js:93-102`、`channels.js:157-220`）：新增 `ifeng` 渠道，主端点 JSON + `fallbacks: [{ parser: 'ifeng_inline' }]`；`parseIfeng` 读 `link.url`、`extractIfengAllData` 做配对扫描、`parseIfengInline` 读顶层 `url`；`hotValue` 取 `commentsCount`（由 scorer 在渠道内归一）。

---

## 5. 分类标准与准确性分析

### 5.1 现状判定链（工作区现场 = v3）

入口只有一个：`classifyTopicMulti(rawCategory, channel, topicText)`（`classifier.js:396`）。单字符串契约 `classifyTopic` 已退化为其薄封装（`:378-380`）。

```
选题条目 { rawCategory, channel, topic }
        │
        ├──────────────────────────────┬──────────────────────────────┐
        ▼                              ▼
 _mapNative(rawCategory, channel)   _scoreKeywords(topic)
   ⓪ DOMAIN_LEVEL_RAW → null           按 KEYWORD_RULES 逐类累加
      （科技/互联网/科学科普/知识/         strong: 词长 × STRONG_MULT(2)
        资讯/热点 一律不参与裁决）          weak  : 词长
   ① RAW_CATEGORY_MAP[channel][key]     < MIN_SCORE(3) 整类丢弃
      → 可信原生（weak=false）           拉丁/数字词走词边界，中文走子串
   ② GENERIC_RAW_MAP[key]             匹配前 normalizeForMatch 全角→半角
   ③ GENERIC_RAW_MAP[lower]             分数降序（并列保持声明顺序）
   ④ RAW_CATEGORY_WEAK_MAP[channel] → 宽泛桶（weak=true）
        │                                   │
        └──────────────┬────────────────────┘
                       ▼
     主标签：可信原生 > 关键词最高分 > 宽泛桶 > general
                       ▼
     标签组装：主标签 + 关键词降序补入，去重，剔除 general，slice(0,3)
                       ▼
 渲染层：标签只展示前 2 个（HotTopics.vue:144）；过滤/计数按全部标签
```

| 口径 | 取值 | 代码位置 |
|---|---|---|
| 分类枚举 | 11 类，`ai` 紧随 `tech` | `classifier.js:34-37` |
| 可信原生表 | `RAW_CATEGORY_MAP` + `GENERIC_RAW_MAP` | `classifier.js:43-81`、`:111-116` |
| 宽泛桶表 | `RAW_CATEGORY_WEAK_MAP`（仅关键词零命中时兜底） | `classifier.js:90-105` |
| 域级泛称 | `DOMAIN_LEVEL_RAW = {科技, 互联网, 科学科普, 知识, 资讯, 热点}`，一律返回 `null` | `classifier.js:344-346`、`:360` |
| strong 权重 | 词长 × `STRONG_MULT = 2` | `classifier.js:261`、`:326` |
| weak 权重 | 词长 | `classifier.js:329` |
| 成类阈值 | `MIN_SCORE = 3`（单个双字弱词 = 2 分 < 3 ⇒ 不足以成类） | `classifier.js:267`、`:331` |
| 拉丁词边界 | 前后不得是 `[a-z0-9]`；`LATIN_ONLY_RE = /^[A-Za-z0-9]+$/` 决定是否走边界 | `classifier.js:269`、`:289-301` |
| 全角归一 | `[\uFF01-\uFF5E]` → 半角（`ＡＩ` → `AI`） | `classifier.js:272`、`:278-281` |
| 多标签上限 | 3 | `classifier.js:419` |
| `general` 不变量 | 只要文本给出任何真实分类，标签里不得残留 `general` | `classifier.js:418-419` |

### 5.2 `general` 的语义（v3 已收窄，但仍不完整）

v2 里 `general` 同时承担三种语义，且代码里**没有任何字段能把它们分开**：

| 产生点 | v2 语义 | v3 现状 |
|---|---|---|
| 关键词零命中且主标签三选一全落空 | 「**未命中兜底**」 | 仍为 `general`（这是 `general` 唯一正当语义） |
| 宽泛桶显式映射到 `general`（B站「知识」、头条「汽车」、微博「美食/时尚/美妆」） | 「**明确判定为泛资讯**」 | 仍落 `general`，与「未命中」**同形**（未加 `origin` 字段） |
| 渠道原生映射到 `general`（通用表 `'综合' → general`） | 「**渠道自称综合**」 | 同上 |

v3 做了**一处收窄**：`general` 不再能与真实分类同排（`classifier.js:418-419`），修掉了「有信号但被 `general` 占位」污染计数与空态判定的问题。但**语义二分仍未做**（无 `origin: 'no_signal' | 'generic_bucket' | 'native_general'`），因此下游 LLM 兜底仍以 `t.category !== 'general'` 作为唯一判据，把「明确判定为泛资讯」的条目也当成「未命中」处理。

### 5.3 tech 错配的机制级根因（v2 原机制 → v3 处置状态）

| # | v2 机制 | 为什么会混入 | v3 现场处置 | 状态 |
|---|---|---|---|---|
| 1 | **宽泛原生桶整批映射到具体分类**：`bilibili['知识']='tech'`、`weibo['科学科普']='tech'`、`toutiao['汽车']='tech'` | 一个桶里混装多域内容（B站「知识」含历史/法律/职场/财经/科普），整体映射 ⇒ **桶内每一条**都无条件成为 tech，与标题内容无关，关键词层无法自救 | 引入 `RAW_CATEGORY_WEAK_MAP` 降级为 `weak`，主标签判定中让位于关键词；`DOMAIN_LEVEL_RAW` 进一步把「科技」等**栏目名**设为一律不参与裁决 | ✅ 已修 |
| 2 | **拉丁词裸子串**：`text.includes('AI')` | 命中 `AirPods`/`AIR`/`said`/`train`/`certain`；且 v2 大小写敏感，`ai`/`Ai` 反而漏命中 | `_matchesLatin` 要求前后不是 `[A-Za-z0-9]`；`_scoreKeywords` 同时准备 `lowerText` 使拉丁词大小写不敏感 | ✅ 已修 |
| 3 | **打分无强弱、无阈值**：`score += kw.length` | 单个双字泛化词即可成类；长词反而更泛化（`'互联网'`(3) > `'芯片'`(2)）；v2 society 含裸字 `'判'` 吞掉「判断/预判/判定」 | `STRONG_MULT = 2` + `MIN_SCORE = 3`；society 表改用 `'审判'/'判决'/'判刑'`；新增测试机械锁死「不得出现裸单字」 | ✅ 已修 |
| 4 | **补拉条目硬挂 `boostCategory`** | `_collectBoostChannel` 无条件写 `category = source.boostCategory`；`tech` 的补拉源是 IT之家 RSS（综合科技资讯流，含发布会预告、促销、行业八卦、企业人事），`threshold=6` 极易触发 ⇒ 这些全部被硬挂 `tech` | 改为先走分类器，**只有 `general` 才用 `boostCategory` 兜底**；`onlyCategory` 用分类器筛（不新增第二份关键词表） | ✅ 已修 |
| 5 | **LLM 兜底只处理 `general`** | 根因 1/4 产生的错配条目分类是 `tech`（不是 `general`），**从不进入 LLM** ⇒ 结构上无法纠正任何已错判为具体分类的条目 | **未改**：`hot-topics-service.js:491` 仍是 `if (t.category !== 'general') continue` | ❌ 未修 |
| 6 | **去重合并「只升不降」+ 无条件并标签** | 主榜已正确判为 `general` 的条目被 boost 版**提升为 tech**；主榜已判为 `emotion` 的条目被并入 `tech`，产生 `[emotion, tech]` 语义互斥双标签 | **未改**：`hot-topics-service.js:443-448` 仍是无条件并标签 + `general` 升级，无互斥表 | ❌ 未修 |
| 7 | **`ai` 无补拉源** | v3 新增 `ai` 分类但 `CATEGORY_BOOSTS` 无 `ai` ⇒ `ai` chip 为空时点「补拉该分类」，`boostSources` 为空，**点击无任何效果且不报错** | 新增 `CATEGORY_BOOSTS.ai`（复用 IT之家 RSS + `onlyCategory: 'ai'` 由分类器筛）；用户显式请求无源分类时输出 warn | ✅ 已修 |
| 8 | **CJK 关键词仍为裸子串、无负向词表** | `'手机'`(weak) 命中 `«手机丢了怎么办»`；`'电池'`(strong) 命中 `«电动车电池起火»`；`'上市'`(strong) 把汽车发布误判成财经 | **部分缓解**：`'上市'` 已从 strong 降为 weak，并新增 `'新股'`/`'上市公司'`/`'CPI'`/`'物价'`/`'折叠屏'`/`'谈恋爱'`；但**没有 `negative` 负向词表**，中文子串匹配与分词问题未解 | ⚠️ 部分 |
| 9 | **`MIN_SCORE` 单点阈值 + 词表覆盖不足** | `«华为发布折叠屏手机»`、`«猪肉价格三周连跌»` 落 `general`（漏判面） | **部分缓解**：新增 `'折叠屏'`(strong) 使前者成类；`«猪肉价格连跌 CPI 走低»` 因 `CPI` 成类。但纯 `«猪肉价格三周连跌»` 仍无命中 → 落 `general`；相对边际判据（`MARGIN`）未做 | ⚠️ 部分 |
| 10 | **主标签顺序纯按分数，跨域复合题偏长词** | `«和 AI 聊天机器人谈恋爱»` 主标签成 `tech` | **未做结构性修复**（无 `MIXED_ORDER`）。本轮该反例转为 `emotion` 是**词表效应**：emotion 命中 `'谈恋爱'`(3×2=6) 与 `'恋爱'`(2×2=4，为 `'谈恋爱'` 的子串) 共 **10 分** > tech 命中 `'机器人'` 的 6 分。机制仍是「词更长/命中更多者胜」 | ⚠️ 症状已消、机制未改 |
| 11 | **`general` 三种语义塌缩为一种** | 「明确判定为泛资讯」被当「未命中」送 LLM | **部分修**：`general` 不变量已实现；`origin` 字段未加 | ⚠️ 部分 |
| 12 | **展示 2 / 存储 3 / 过滤全部 口径不一致** | 一条 `['tech','ai','emotion']` 的条目在 `emotion` 下能被筛出，但标签只显示 `tech`/`ai`，用户看不出它为何出现在情感分类 | **未改**：`HotTopics.vue:144` 仍是 `.slice(0, 2)` | ❌ 未修 |
| 13 | **拉丁词边界不覆盖全角、拼音/缩写无防护** | `ＡＩ` 漏判；`'Sora'` 命中 `«Soraya…»`、`'Kimi'` 命中人名 | **全角已修**（`normalizeForMatch`）；**拼音/缩写消歧未做**（无证据表明是主要错源，登记 P2） | ⚠️ 部分 |

### 5.4 LLM 兜底为什么没兜住（第一性原因）

`llm-classifier.js` + `_applyLlmLabels` 逐条列出，按「对纠正 tech 错配的影响」排序：

| # | 机制 | 证据 | 影响 |
|---|---|---|---|
| 1 | **只处理 `general`** | `hot-topics-service.js:491` | **致命**。已错判为 `tech` 的条目从不进入 LLM —— LLM 兜底在结构上无法纠正任何已错判为具体分类的条目 |
| 2 | 批次上限 40 | `LLM_BATCH_LIMIT = 40`（`hot-topics-service.js:34`、`:502`） | `MAX_TOPICS = 400`，`general` 超 40 条时其余本轮拿不到标签；下一轮仍从同一批头部开始（`need` 按 `topics` 顺序收集） |
| 3 | 缓存键 = 原始 topic 文本 | `hot-topics-service.js:492`、`labels[t.topic]` | 未归一化（空白/全半角/末尾标点差异 → 不同键 → 重复计费）；超 `LLM_LABELS_MAX = 500` 时按**插入序**裁剪（`:256`），被裁掉的条目下一轮重新请求 |
| 4 | 无置信度阈值 | `llm-classifier.js` 全文无 confidence/logprob | LLM 返回什么就是什么；`temperature: 0`（`:47`）只降随机性，不提供可靠性信号 |
| 5 | 无二次裁决 | 同上 | 没有「LLM 与关键词不一致时如何裁决」的逻辑 |
| 6 | 无失败记忆 / 无熔断 | `llm-classifier.js:64-67` catch 后 `return {}`；`hot-topics-service.js:520-522` catch 仅 warn | provider 未配置或持续报错时，每轮抓取都对同一批 40 条重复尝试，无退避 |
| 7 | 只改主分类、不改标签顺序 | `hot-topics-service.js:515-516` push 到末尾 | LLM 判出的分类被追加到 `categories` 末尾，主标签位置不动 |
| 8 | 缓存键不含模型/版本 | 只存 `{topic: label}` | 换模型后旧标签继续命中，无法归因「这条是哪个模型判的」 |
| 9 | 输出解析脆弱 + 批量注入面 | `llm-classifier.js:51` 贪婪 `match(/\{[\s\S]*\}/)`；`:44` 直接把选题文本拼进 prompt | 多个 JSON 片段时整体取最外层；解析失败整批丢弃；一条含指令的标题可污染同批其它条目 |
| 10 | 键碰撞 | `llm-classifier.js:26` `slice(0, 200)` | 长标题截断后前缀相同 → 不同条目映射到同一个 key |
| 11 | **在截断之后才跑** | `hot-topics-service.js:620` 先 `slice(0, MAX_TOPICS)` → `:623` 才 `_applyLlmLabels` | 被截断丢掉的条目永远拿不到 LLM 分类 |
| 12 | 落盘时机 | `:519` 仅在整批至少一条变化时写 | LLM 全返回 `general` 时也会置 `changed`，写入无用键，加速 500 条上限耗尽 |

**唯一结构正确的修法**：把送审集合从「`category === 'general'`」改为「`general` ∪ `lowConfidence` ∪ 原生/关键词冲突」，并按优先级排序取批。本轮**未做**，登记为 P1。

### 5.5 其它可借鉴的工程做法（来源类型已标注）

| 来源 | 结论 | 对本项目的意义 |
|---|---|---|
| [一手] DailyHotApi `src/types.d.ts` | `ListItem` **无 category 字段**，`type` 是来源标识；聚合维度是**来源**而非内容分类 | 内容分类是**消费侧**能力，无法从上游白拿，必须自建 —— 本项目方向正确 |
| [一手 HTML] tophub.today | 一级 **16** 类且 **AI 独立成一级**（`/c/ai`）；科技域下另有 14 个二级标签；**汽车放在科技域之下** | ① 印证「AI 独立成类」是行业已验证做法；② 本项目把「汽车」降为 `general` 与 tophub 取向不同，会让汽车内容失去归属（见 §6.4 的 P1 建议）；③ 11 个一级分类处于合理区间，**不建议继续增加一级分类** |
| [一手] 各渠道原生分类粒度 | 微博 `hot_band` 的 `category` 是**混合粒度**（情感/艺人/汽车/音乐/科学科普/健康医疗/数码/互联网/剧集/综艺/民生新闻/舆论监督/职场/法律）；头条粒度为大类；百度/tophub/知乎/抖音**不提供分类** | 上游原生分类**粒度不可控、覆盖不完整、且会缺失**（`classifier.js:44` 注释：2026-09 起偶发缺失）⇒ 分类必须以**文本证据**为主干，原生只能做先验提示 |
| [搜索摘要] TF-IDF / BM25 | 标题级短文本词频恒为 1，TF 项无区分度，退化为 IDF；而热榜标题没有稳定全局文档集估计 IDF | **不应**把 TF-IDF/BM25 作为主判据；只适合作为词表权重的离线标定来源 |
| [搜索摘要] 中文分词 | 中文无天然词边界，裸子串必然跨词误命中；工程上要么分词后按词匹配，要么「最长匹配 + 负向词表」 | 本轮选择不动分词（避免引入第二份切词逻辑），登记负向词表为 P1 |
| [工程共识] 全角/大小写归一 | 匹配前做归一可同时解决全角拉丁与大小写 | v3 已做全角→半角 + `toLowerCase`（未做完整 NFKC） |
| [搜索摘要] LLM 自评置信度 | 普遍过度自信，**直接采信不可靠**，必须经阈值校准或多次采样一致性 | 支持「不接受 LLM 自报分数，改用关键词判据与 LLM 是否一致作为隐式置信」 |
| [工程共识] FrugalGPT 式级联 | 关键词层是级联第一级，LLM 只应处理**第一级判不出或自相矛盾**的样本 | 直接映射为「送审集合 = general ∪ lowConfidence ∪ 冲突」，而不是「只处理 general」 |
| [工程共识] 批量分类序号映射脆弱 | 现场用 `{"0":"tech"}` 序号映射，错位会**静默错配整批**；应回显原文/id 并校验「返回数 == 请求数」 | 现场**无此校验**，登记 P1 |
| [工程共识] 可审计性 | 留痕至少含 `{key, label, model, prompt_version, decided_by, ts}` | 现场缓存只有 `{topic: label}`，**无法区分「关键词判的」与「LLM 判的」** —— 可审计性最大缺口 |
| [工程共识] fail-open | 现场 LLM 采用 fail-open（失败即保持关键词结果），对**展示型**热榜是正确取舍 | 合同保留；但 fail-open 必须配**失败记忆**，否则退化为「每次都重试」 |

---

## 6. 结论与复用建议

### 6.1 直接复用（已落地）

| 平台/能力 | 复用内容 | 落地位置 |
|---|---|---|
| 抖音 | 主端点 + 移动端零头部兜底 + 旧端点热词兜底（**顺序降级，不并发**） | `hot-topics-service.js:69-79`、`channels.js:112-132` |
| 小红书 | App 端 `search/hot_list` + 完整固定头 + `data.items[]` 字段映射；**只复用它公开的接口事实，不复制任何代码** | `hot-topics-service.js:80-92`、`channels.js:96-102`、`:139-149` |
| 今日头条 | `hot-event/hot-board` + 字段修正（`InterestCategory[0]` 优先） | `channels.js:48-59` |
| 凤凰网 | `hotspotlist` JSON 出口（约 35 条）+ `i.ifeng.com` 内联兜底（约 51 条）；**不照抄主流开源实现的 PC 首页 12 条方案** | `hot-topics-service.js:93-102`、`channels.js:157-220` |
| 失败语义 | 「空列表视为失败」（范式取自 `wimdaw/hot-topics` 的 `if (!items.length) throw`） | `hot-topics-service.js:331-332` |
| 中文数量解析 | `'947.5w' / '1.2万' / '8850'` → int（范式取自 `hot-radar` 的 `_parse_cn_number`） | `channels.js:96-102` |
| 域名白名单防御（参考） | `TrendRadar` 的 `expected_domain` 模式：返回链接必须是 HTTPS 且属于目标域 | 本轮以 `sanitizeUrl`（`safeHttpUrl`）做协议白名单；域名白名单**未做**，登记 P2 |

### 6.2 参考实现（读思路，未复制代码）

| 仓库 | 参考点 |
|---|---|
| `imsyy/DailyHotApi` | 今日头条解析；抖音取 `passport_csrf_token`（本项目不需要）；`src/registry.ts` 的「按来源注册」结构 |
| `ourongxing/newsnow` | 抖音从 `login.douyin.com` 取 Set-Cookie（本项目不需要，仅记录影响面）；凤凰网实现（**弱，不照抄**） |
| `ymybxx/SoloMCN` | 抖音三级策略、`trending_list` 作 `rising`、`position`/`max_rank`/`event_time` 作扩展指标 |
| `wimdaw/hot-topics` | `firstOk` 多 host 顺序降级范式；空列表即失败 |
| `chensn05/hot-radar` | 中文数量字符串解析 |
| `sansan0/TrendRadar` | `expected_domain` 域名白名单（**GPL-3.0，只学模式不取代码**） |
| `60s` | 小红书端点与 6 个头常量的**第一手出处**（MIT，可读可核） |

### 6.3 不接入（本轮明确排除）

| 项 | 理由 |
|---|---|
| **头条号创作者平台** | 必须登录态 + 可能需 `tag_info.hotboard_invitation` 邀请权限 + GitHub 0 命中无参考实现 + 无法证实与今日头条热榜同源 + 与发布链路登录态耦合的账号风控风险 |
| **小红书 Web / 创作者平台登录态方案** | `/explore` 已 302 → `/login`；`/api/sns/web/v1/*` 需 `X-S`/`X-T`/`x-S-Common` 签名 + 登录 Cookie，需引入 Playwright 与反爬对抗，且**不提供热榜**；创作者平台必须登录且路径未核实 |
| **第三方托管聚合 API**（如 `60s` 托管实例） | 与本项目同源，且从本机出口 429（Cloudflare 1027），可用性不由我们控制 |
| **签名方案（`a_bogus`）** | 热榜用不到，且会把渠道复杂度推到 Playwright 级别 |
| **tophub / DailyHotApi / newsnow 提供小红书榜**这一前提 | 实测不成立（见 §4.2） |
| **快速采集（quick-collect）源注册表** | 属另一模块（且其测试明确要求「不存在需要登录态的源」），本次范围只在热门选题 |

### 6.4 调研结论 → 代码落点映射

| 调研结论 | 代码落点 |
|---|---|
| 抖音三端点同构 + 顺序降级 | `hot-topics-service.js:75-78`、`channels.js:112-132` |
| 空列表视为失败 | `hot-topics-service.js:331-332` |
| 406 单独告警（shield 失效唯一特征） | `hot-topics-service.js:341-345` |
| 小红书 6 头 + `parseCnNumber` | `hot-topics-service.js:51-54`、`:80-92`、`channels.js:96-102`、`:139-149` |
| 今日头条字段修正 | `channels.js:48-59` |
| 凤凰网双出口 + 花括号配对 | `hot-topics-service.js:93-102`、`channels.js:157-220` |
| 新渠道纳入评分（量级对齐综合榜） | `scorer.js:30-31`（`xiaohongshu: 1.0` / `ifeng: 0.95`） |
| AI 独立成一级分类（11 类，紧随 tech） | `classifier.js:34-37` + 4 处跨端孪生 + 4 个 locale 文件 |
| 宽泛桶让位 / 域级泛称不裁决 | `classifier.js:90-105`、`:344-346`、`:360`、`:404-410` |
| 强/弱词 + `MIN_SCORE` | `classifier.js:261`、`:267`、`:319-335` |
| 拉丁词边界 + 全角归一 | `classifier.js:269`、`:278-281`、`:289-301` |
| `general` 语义收窄 | `classifier.js:418-419` |
| 补拉条目走分类器（修硬挂） | `hot-topics-service.js:393-403` |
| `ai` 补拉可用 + `onlyCategory` 分类器筛选 | `hot-topics-service.js:130-134`、`:390-392` |
| 显式请求无源分类要出声 | `hot-topics-service.js:560-563` |
| 跨端契约 5 处一致 | `classifier.js:24-27` 注释 + `classifier.test.js`、`content-categories.test.js`、`test_content_categories_api.py` |

---

## 7. 未核实清单（实现时不可当作已知事实）

1. 头条号创作者平台热点列表的实际响应结构与字段（**必须登录态**，本机 CDP 不可用）。
2. 头条号热点与今日头条热榜是否同源（**无法证实也无法证伪**）。
3. `DailyHotApi` 用 `ClusterIdStr` 反推时间戳的准确性（社区经验，未做精度验证）。
4. `nine.ifeng.com/hotSpotDetailList`（未单独抓取验证）。
5. 巨量算数 `trendinsight.oceanengine.com` 的任何子接口（SPA catch-all，无法判定存在性）。
6. `ne883dbn.ifeng.com` 之外是否还有其它 `__nd__` 值（仅观测到该值）。
7. 小红书 `items` 数组序在多次请求间是否严格稳定（未做重复采样）。
8. 高频轮询的 IP 级风控触发阈值（未实测触发）。
9. 完整评测指标基线（**标注集尚不存在、基线未跑**；源报告 §5.2 的门槛为建议值）。
10. `ai` 补拉源的候选路线（tophub `/c/ai`）端点可用性 —— 本轮改用已有端点 + 分类器筛选，未实测新端点。
11. `ShellMonster/DailyHotApi-Go`、`getoneapi/OneAPI` 的实际实现质量（无 LICENSE，未读源码）。
12. `ccbikai` 名下是否有热榜项目（仓库列表页 JS 渲染，未取到）。
13. `bilibili:科技` + 零关键词命中的真实链路行为**已由代码推定**为 `general`（`DOMAIN_LEVEL_RAW` 短路），本轮**未单独实跑**该组合（其余 26 例为实跑）。

---

## 附：本报告的取证边界（不掩饰未完成项）

| 项 | 状态 |
|---|---|
| 三份源调研报告通读 | ✅ 已读（406 + 477 + 1012 行） |
| 工作区改动代码逐文件通读 | ✅ 已读 `hot-topics-service.js`(650) / `channels.js`(359) / `classifier.js`(437) / `scorer.js`(181) / `llm-classifier.js`(71) / `HotTopics.vue`(708) / `content-categories.js`(147+137) / locales(87+87+17+17) / `content_category_service.py`(340) |
| 新增测试逐文件通读 | ✅ `classifier.test.js`(206) / `hot-topics-new-sources.test.js`(265) / `hot-topics-boost-classify.test.js`(120) |
| openspec change 五件套通读 | ✅ proposal / design / tasks / spec delta / `.openspec.yaml` |
| 本轮测试实跑 | ❌ **未执行**（见 PRD §11：门禁项待跑） |
| QM-1 打包验证 | ❌ **未执行**（tasks.md 6.5 未勾选） |
| 完整分类评测（标注集 + 混淆矩阵） | ❌ **未运行**（标注集不存在） |
| 品牌词门禁 | ✅ 本文件未出现禁止词 |
