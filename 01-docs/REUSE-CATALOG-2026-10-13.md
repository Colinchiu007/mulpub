# mulpub 可复用资产总目录（逐项 × 代码现状核实）

> **日期**：2026-10-13 ｜ **素材来源**（只读）：`D:\Data\projects\rea\analysis\` 的 22 份报告，主索引 `交付物总索引.md`
> **核实对象**：`D:\Data\projects\mp-worktrees\mp-reuse-rollout\`（worktree，非共享根 `D:\Data\projects\mulpub`）
> **性质**：只读盘点。本次未修改素材报告，也未修改 mulpub 任何既有代码/文档（仅新建本文件）。

## 目录

[0. 核实方法、范围与口径](#0-核实方法范围与口径) ｜ [1. Top 清单](#1-top-清单真缺失--高价值) ｜
[2. A 组 数据资产](#2-a-组融媒宝数据资产c-01--c-07) ｜ [3. B 组 算法与实现](#3-b-组算法与实现c-08--c-16) ｜
[4. C 组 平台与接口](#4-c-组平台与接口c-17--c-20) ｜ [5. D 组 负面知识自查](#5-d-组负面知识--mulpub-自查c-21--c-23) ｜
[6. 增补项](#6-增补项c-24--c-29) ｜ [7. 汇总统计](#7-汇总统计) ｜ [8. 未核实与边界](#8-未核实与边界不假装已查清) ｜
[9. 搜索证据索引](#9-搜索证据索引) ｜ [附录 A 品牌门禁](#附录-a品牌残留门禁提示)

---

## 0. 核实方法、范围与口径

### 0.1 为什么必须先核实（本文的成败关键）

本仓有一次代价明确的失败先例，记录在现已归档的
[LEGACY-MP-REUSABLE-ACTUAL-PLAN.md](archive/LEGACY-MP-REUSABLE-ACTUAL-PLAN.md:7)（原名 `01-docs/MP-REUSABLE-ACTUAL-PLAN.md`，
本会话期间由另一会话移入 `archive/`）：

> 「原方案假设 7 项『缺失项』，**实际审计发现 6 项已存在于代码库**」

被点名的 8 个组件（`CancelToken`/`ProgressEmitter`/`BasePlatformAdapter.execute()`/`createProxyAgent`/
`TaskPool`/`withRetry`+熔断器/`RichTextProcessor`/`ProgressThrottle`）**全部已存在**于 `packages/api-publish-engine`，
真正缺口只有一条（`rpa-view-manager.js` 未桥接）。详见
[RESEARCH-COMPETITOR-REVERSE-2026-10-13.md](RESEARCH-COMPETITOR-REVERSE-2026-10-13.md:293) §4.2 理由 3。

**本文硬纪律**：任何一项都**不得**因「竞品有」就写成「待做」。每项必须先在 mulpub 代码里搜一遍，
并给出可复核的搜索证据（命中的文件:行，或「零命中」这一事实本身）。

### 0.2 核实方法（五步）

| 步 | 做法 |
|---|---|
| ① 读报告取候选 | 逐份读完 8 份主报告，取出点名「可复用/可借鉴/建议落点」的条目 |
| ② 抽关键词 | 每项抽 3–8 个**在竞品代码里真实出现的标识符**（函数名/常量名/字段名/文件名），**不用中文意译** |
| ③ 在 mulpub grep | 用这些标识符 + 同义实现词全域检索，**同时**记录「命中」与「零命中」 |
| ④ 读命中文件定性 | 命中 ≠ 能力同构。必须打开文件判断语义（例：`getClientRects` 有 20+ 命中，但全是可见性判据，不是视觉行映射） |
| ⑤ 三档结论 | ✅ 已存在 / 🟡 部分存在（写明缺什么）/ ❌ 真缺失 |

### 0.3 搜索范围（本次实际搜过的目录）

`packages/`（16 包：`api-publish-engine` 118 文件、`shared-utils` 90、`python-backend` 243、`video-clone-engine` 21、
`story2video-engine` 18、`remotion-composer` 40、`rpa-engine`、`rewrite-engine`、`ai-writer`、`ai-writer-api`、
`collection-engine`、`audio-aligner`、`ai-autonomous-tester`、`ui`、`ui-design-tokens`）、`apps/desktop/`
（`electron/`、`src/`、`scripts/`、`tests/`）、`config/`、`ops-center/`、`scripts/`、`01-docs/`、`openspec/`。

**明确未搜**：`node_modules/`、`dist*/`、`media-tools-lock.json` 指向的媒体工具二进制本体、
`01-docs/learnings.md`（2.25 MB，仅按关键词局部读）。

### 0.4 结论口径

- **✅ 已存在**：mulpub 有**语义同构**实现，且读到了具体文件与行（可能是更好的实现，会注明）。
- **🟡 部分存在**：有相邻能力或骨架，但**明确缺一块**（一定写明缺哪块）。
- **❌ 真缺失**：候选标识符 + 同义实现词全域检索**零命中**，或命中物语义完全不同。
- **N/A**：依赖的前置能力在 mulpub 不存在，该缺陷类别无从落地（仅 D 组出现）。

---

## 1. Top 清单：真缺失 × 高价值

| 序 | 编号 | 名称 | 价值 | 难度 | 为什么排这里 |
|---:|---|---|---|---|---|
| 1 | C-11 | 测量驱动贪心装箱分页引擎 | 高 | 中 | **唯一能直接补上「长文 → N 张固定尺寸图文卡片」空白**的整块算法；485 行单文件、零依赖、规则外置，与 mulpub 痛点正面对位 |
| 2 | C-08 | 素材组合三级降级算法 | 高 | 低 | 纯函数零依赖，可直接进 `packages/shared-utils`；质量分层决定成片观感，且把 N=20 的 20! 压成常数 |
| 3 | C-01 | 平台分类体系（平台侧分类 ID） | 高 | 低-中 | API 发布多数平台需平台侧分类 ID，当前是**硬编码默认值**（B站 `tid` 恒 21、YouTube `"22"`）；最难自行收集、最易过期 |
| 4 | C-13 | `getClientRects` 视觉换行对齐 | 中-高 | 低-中 | 任何 `contenteditable` 富文本标注都会撞上「看到的换行 ≠ DOM 的 `\n`」；两函数自包含，且竞品同文件有一份未接线的正确实现可参考 |
| 5 | C-12 | `box-decoration-break: clone` 跨行高亮 | 中-高 | 低 | 一条 CSS + 约 20 行替换函数；跨行荧光笔高亮不断裂的**唯一** CSS 手段，附赠「浏览器能画 ≠ 截图库能画」补丁 |
| 6 | C-15 | 命令式撤销栈（闭包对） | 中 | 低 | DOM 密集型编辑器存闭包比存快照便宜；mulpub 渲染层当前**无任何 undo/redo** |
| 7 | C-07 | 数据导出模板列定义 | 中 | 低 | 三类实体（账号/平台/内容）× 两粒度（汇总/按日按条）的导出结构；mulpub 无任何数据导出 |
| 8 | C-04 | 采集脚本注入规则（声明式） | 低 | 高 | **不建议做**：mulpub 走 CDP 注入；且该规则表的实际 JS 内容未定位（未闭合项）。登记为「已知但刻意不做」 |
| 9 | C-17 | 1,338 个平台 API 端点清单 | 低-中 | 高 | **不建议整体引入**：端点写在各 adapter 更可维护；建议只做**查询索引**，不做代码迁移 |

> **给决策者的一句话**：值得排期的是 **C-11、C-08、C-01**；C-13/C-12/C-15/C-07 是「顺手做掉」的低成本增强；
> **C-04/C-17 建议明确记录为不做并写理由**，而非留在待办里被反复重新发现。

---

## 2. A 组：融媒宝数据资产（C-01 ~ C-07）

### C-01 平台分类体系（31 平台 / 11,623 节点 / 26 文件带平台侧分类 ID）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-data.zip数据集拆解.md:65-135`（§3.1–3.3）、`:326-334`（§4.2 P0） |
| 性质 | 数据 |
| **mulpub 现状** | **❌ 真缺失** |
| 价值 | 高 —— API 发布时多数平台需平台侧分类 ID，这是最难自行收集、最易过期的一类数据 |
| 移植难度 | 低-中 —— 需解析 5 种互不相同的 JSON 形态（**必须 fail-loud**），再落成 mulpub 配置结构 |
| 依赖与风险 | 数据是 **2026-07-14 冻结快照**、**未做任何联网校验**（报告 §6.4/6.5 自陈）；**必须可热更新、不得硬编码进源码** |

**搜索证据**
- `categort` / `categortmap`（竞品文件名的产品拼写错误）→ **零命中**，未导入任何竞品分类表
- `categoryId` → 命中，但**全部**是 YouTube 发布选项（恒 `"22"`）与播客 `itunes:category`，与平台侧图文/视频分类无关
- `config/platforms.yaml` 全文 → 只有 `category: 中文/海外`（语言分组）与 `content_category: VIDEO/IMAGE_TEXT/MIXED`，**无平台分类字段**
- `content-categories.js` → 命中但语义**完全不同**：这是**热点选题的内容类别**（11 类 `general/society/finance/tech/ai/…`），
  与「发布到平台的哪个分类」无关 —— **不得混为一谈**
- `api-publish-engine/src/publish/platforms/bilibili-video.js:77` → `tid: Number(taskData.category || taskData.tid) || 21`：
  adapter **能收**分类但**默认写死 21**
- 仓内已自陈：`01-docs/platform-publish-options-audit/REPORT.md:79`「分类 \| ❌ UI 无 \| ⚠️ B站 tid 恒 17、YouTube categoryId 恒 "22"…\| **缺失**」；`:124` P0-3 列明待做
- `01-docs/archive/LEGACY-PM-PRD-rongmeibao.md:64` 曾写 `categories: "weixin_categories.yaml"`，但该文件**全仓不存在**（已递归检索 `*categor*`）⇒ **纸面计划，从未落地**

**结论**：真缺失，且**仓内已知**。竞品数据是现成**输入**；落地必须先解决「冻结快照 + 易过期」——
建议接 C-14 的远程下发 + 本地兜底双轨，而不是新增一张硬编码表。

### C-02 平台指标能力矩阵（`mediadatamgr.ini`，11 指标 × ~30 平台）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-data.zip数据集拆解.md:137-156`（§3.4） |
| 性质 | 数据 |
| **mulpub 现状** | **🟡 部分存在** |
| 价值 | 中-高 —— 能力边界显式化，避免「抓平台不提供的指标」或编造数据 |
| 移植难度 | 低 —— 11 指标 × ~30 平台布尔矩阵 |
| 依赖与风险 | ① 竞品用**整型平台 ID**（`1=微信、3=头条、4=百家…`），mulpub 用字符串 slug，**不可照搬 ID**；② 竞品矩阵是「能不能拿到」的**声明**，mulpub 的形态是「adapter 真的实现了什么」 |

**搜索证据**
- **已有**：`apps/desktop/electron/services/account-metrics/adapters.js`（17.8 KB）注册 **4 个平台**，每个带 `metrics` 块：
  `xiaohongshu`(`:137-182`，读 `datacenter/note/analyze/list`，取 read/like/comment/fav/share)、`douyin`(`:184`)、
  `kuaishou`(`:240`)、`toutiao`(`:297`)；`getAdapter()`(`:124`) / `supportedPlatforms()`(`:128`) 构成注册表
- 该形态**比布尔矩阵更严谨**：能力 = adapter 真实现了它，而非纸面声明
- **缺的一块**：**没有覆盖 ~30 平台的集中能力矩阵**；未接入平台既不在表里、也无「该平台能拿哪些数」的声明，
  因此 UI 无法如实表达「这个平台拿不到收藏数」
- 旁证：`adapters.js:6` 自陈与既有 `services/platform-metrics` 的分工（后者抓公开作品页 HTML 正则，前者调创作者中心 API）

**结论**：部分存在。建议动作不是「搬矩阵」，而是**把现有 4 个 adapter 的 `metrics` 块提升为可查询能力表**，
并为未接入平台显式登记「不支持」，让「拿不到」成为一等公民。

### C-03 各平台数据看板 URL 表（`media_url_list.txt`，252 行）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-data.zip数据集拆解.md:158-180`（§3.5） |
| 性质 | 数据 |
| **mulpub 现状** | **🟡 部分存在（骨架已在，数据只填了 4 个平台）** |
| 价值 | 中 —— 若做「发布后数据看板 / 账号数据回收」，这是现成入口清单 |
| 移植难度 | 低 —— 字段已存在，只需补值 |
| 依赖与风险 | **URL 随平台改版失效**；竞品数据是冻结快照，**不能当长期契约** |

**搜索证据**
- `media_url_list` → 命中 **3 处，且全是「参考它设计」的注释**：`config/platforms.yaml:2`
  （`# 参考融媒宝 data/media_url_list.txt 设计`）、`01-docs/ARCH-F1-platform-config.md:4`、`archive/LEGACY-PM-PRD-rongmeibao.md:111`
- `data_url` 字段已在 `platforms.yaml` 定义，非空值只 **4 个平台**：`wechat_mp`(`:19`)、`xiaohongshu`(`:85`)、`toutiao`(`:149`)、`bilibili`(`:189`)
- `comment_url` 字段已定义，非空值只 **3 个平台**：`wechat_mp`(`:20`)、`xiaohongshu`(`:86`)、`toutiao`(`:150`)
- 竞品的另 3 类字段 `income_url` / `msg_url` / `monitor_url` → **零命中**（mulpub 只有 2 类，竞品有 5 类）
- **交叉验证**：`platforms.yaml` 里 `wechat_mp`(`:19-20`) 与 `toutiao`(`:149-150`) 的 URL 与竞品表**逐字相同**
  （`https://mp.toutiao.com/profile_v4/analysis/works-overall/all`、`https://mp.weixin.qq.com/misc/appmsgcomment`）
  ⇒ 早期确实照抄过这份表，只是抄了 4 行就停了

**结论**：部分存在。补法是「把 5 类字段补齐 + 声明失效风险」，而不是新建一套。

### C-04 采集脚本注入规则（`comment_media_js.json`，328 行）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-data.zip数据集拆解.md:182-195`（§3.6） |
| 性质 | 数据 / 架构模式 |
| **mulpub 现状** | **❌ 真缺失（且建议明确不做）** |
| 价值 | 低 —— 属 RPA 数据回收能力，与 mulpub 的 API 优先路线不同 |
| 移植难度 | 高 —— 需持续维护 URL 匹配表；且**规则表的实际 JS 内容不在该文件内**（报告 §6.2 未闭合） |
| 依赖与风险 | ① 注入脚本本体**未定位，无法还原**；② 声明式规则表是「平台改版即失效」的形态 |

**搜索证据**
- `comment_media_js` / `jspos` / `exactmatch` / `LoadEnd` → **全部零命中**
- 相邻实现（形态不同、目标一致）：mulpub 走命令式 CDP 注入 —— `rpa-view-helpers.js:70,73,106,111`、
  `rpa-view-platforms.js:1028`、`rpa-view-navigation-helpers.js:110-113`；并有 `electron/core/js-eval-payload.js`
  专门负责安全地把主进程数据拼进脚本文本

**结论**：真缺失，**但不建议做**。① 竞品那份规则表的 JS 内容未闭合，抄来只有骨架没有实体；
② mulpub 的命令式注入 + `js-eval-payload.js` 更可控。**登记为「已知但刻意不做」**。

### C-05 DOM 类名指纹（`media_class_set{,_new}.txt`）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-data.zip数据集拆解.md:197-212`（§3.7）、`:336-339`（§4.3 明确不建议照搬） |
| 性质 | 数据 / 负面知识 |
| **mulpub 现状** | **🟡 部分存在（且实现路线更好）** |
| 价值 | 中 —— 「账号失效 / 登录页已渲染」的探测能力有价值，但**指纹方案**价值为负 |
| 移植难度 | 低（能力）/ 不建议（指纹方案） |
| 依赖与风险 | 竞品类名带**平台侧随机后缀**（`login-card-double-Gtywl8`、`eK1Z2Sel`）⇒ 注定持续返工 |

**搜索证据**
- **已有**：`packages/shared-utils/src/platform-definitions.js`（28.7 KB / 495 行）提供**多层**登录态判据，全为导出常量：
  `PLATFORM_LOGIN_URLS`、`PLATFORM_DASHBOARD_URLS`、`PLATFORM_LOGIN_SUCCESS_PATTERNS`、`PLATFORM_AUTH_HOSTS`、
  `PLATFORM_COOKIE_DOMAINS`、`PLATFORM_POST_LOGIN_REDIRECT`、`PLATFORM_POST_LOGIN_PROOF_COOKIES`、
  `PLATFORM_LS_SESSION_MARKERS`、`PLATFORM_SESSION_COOKIE_MARKERS`、`PLATFORM_LOGIN_SUCCESS_SELECTORS`、
  `PLATFORM_ACCOUNT_INFO_SELECTORS`
- **关键差异（更好）**：`PLATFORM_ACCOUNT_INFO_SELECTORS` 用**语义类名 + 通配回退**，例如
  `douyin: { nickname: ['.user-name', '[class*="user-name"]'], followers: ['.fans-count', '[class*="fans"]'] }` ——
  **不是**随机后缀指纹。这正是竞品报告 §4.3 第 1 条建议的「应优先用语义特征」
- **缺的一块**：这些表**硬编码在源码里**，平台改版必须发版。竞品对应做法是**远程下发**
  （`download.17van.com/plugin/media_class_set.txt?_t=`，见 `竞品分析报告.md:854-882` 优先级 10）

**结论**：部分存在，能力已在且路线更优；唯一值得补的是「远程可更新 + 本地兜底」——
而 mulpub **已有这套机制**（C-14），所以这是**接线工作**，不是新建工作。

### C-06 多源搜索清单（`deepsearchercat.txt`，73 行）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-data.zip数据集拆解.md:229-252`（§3.9） |
| 性质 | 数据 |
| **mulpub 现状** | **🟡 部分存在** |
| 价值 | 中 —— 可补中文源；但纯 HTML 抓取有反爬/合规成本 |
| 移植难度 | 中 —— 竞品清单**全是中文搜索引擎且多为 HTML 抓取（无官方 API）** |
| 依赖与风险 | 新增外部搜索源**必须遵守** AGENTS.md「外部搜索源相关性门禁」：判据挂在共用出口 `ContentIntelligence.search()` 且在 `engagement` 排序**之前**；词素切分必须复用 `tokenizeContentWords`；来源标签禁止兜底品牌名；门禁日志禁止记 query 原文 |

**搜索证据**
- **已有（英文检索源 3 个）**：`quick-collect-sources.js:40-55` 的 `SOURCES` 含 `reddit`/`hackernews`/`github`（`kind: 'search'`）；
  `quick-collect-presets.js:30` `EN_SEARCH_SOURCES = Object.freeze(['reddit','hackernews','github'])`；
  实现在 `content-intelligence-sources.js`（Reddit 公开 JSON API、HN Algolia API）
- **已有（中文热榜 7 个）**：`quick-collect-sources.js` 的 `cn-hot` 组含 `weibo`/`zhihu`/`douyin`/`bilibili`/`baidu`/`toutiao`/`tencent`
  （`quick-collect-presets.js:26` `CN_HOT_SOURCES`）；另有 `hot-topics-service.js` 9 主渠道 + tophub 兜底 + 5 垂类补拉
- **缺的一块**：竞品清单里那批**「知识类」中文搜索引擎**（百度知道/百科、知乎站内、搜狗微信文章）——
  `deepsearchercat` / `chineseSearch` **零命中**
- 报告自身精确列出的两个真实缺口：**新榜热点**、**搜狗微信文章**；以及百度榜 board 数（竞品 5 个 / mulpub 2 个，`竞品分析报告.md:804-807`）

**结论**：部分存在。中文热榜已覆盖得比竞品更广；缺口集中在「知识类搜索引擎」这一窄类，成本主要在反爬与合规，不宜无脑扩。

### C-07 数据导出模板列定义（`doc/*.csv` 6 份）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-data.zip数据集拆解.md:254-269`（§3.10） |
| 性质 | 数据 |
| **mulpub 现状** | **❌ 真缺失** |
| 价值 | 中 —— 三类实体（账号/平台/内容）× 两粒度（汇总/按日按条）的导出结构，可作数据模块设计参照 |
| 移植难度 | 低 —— 只读结构，不含代码 |
| 依赖与风险 | ⚠️ **竞品示例数据不是占位的**：`内容数据.csv` 留着真实抖音分享链接、`数据总览.csv` 有真实 B 站账号数据。**复用列定义时不得带入任何示例行**（打包卫生 + 隐私） |

**搜索证据**
- `export.*csv` / `toCsv` / `CSV` / `exportData` / `导出.*表格` → 在 `apps/desktop/electron/` 全域**零命中**
- 相邻能力只有 `story2video.test.js:67`「将本地视频导出为 **ZIP**」（媒体文件，非数据表）
- 现有导出面全是媒体：`cover:extract` / `cover:crop`（图片）、`story2videoSaveAs`（视频）—— **无任何数据导出**

**结论**：真缺失，且是**零风险**可复用项（只借列定义），能顺手补齐「发布历史 / 账号数据 / 平台数据」的导出面。

---

## 3. B 组：算法与实现（C-08 ~ C-16）

### C-08 素材组合三级降级算法（`compose.js:7-207`）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-ai-clip拆解.md:623-635`（§6.1） |
| 性质 | 算法 |
| **mulpub 现状** | **❌ 真缺失** |
| 价值 | 高 —— ① 质量分层直接决定成片观感；② 把 N=20 的 20! 压成常数（上限 1000 + 去重）；③ 纯函数零依赖 |
| 移植难度 | 低 —— 可原样搬入 `packages/shared-utils`（外部仅需 `deepClone`/`getRandomInt`/`retainDecimalPlaces`） |
| 依赖与风险 | 无外部依赖。⚠️ 竞品 `fnRemoveDuplicate` 用 `join("")` 去重，**素材 id 长度不一时可能误判**，移植应改成分隔符 join |

**搜索证据**
- `NoRepetition` / `LowRepetition` / `OrdinaryCombination` → **全部零命中**
- `组合算法` / `降级组合` / `permutation` / `全排列` / `combination` → **全部零命中**
- 相邻能力：`packages/remotion-composer` 有合成、`packages/ai-autonomous-tester` 有测试编排，
  但**均无「同批素材生成 N 种不重复排列」这一算法**

**结论**：真缺失，且是**移植难度最低**的一项。Top 清单第 2 位。

### C-09 时间轴「绝对时间拍平 + 累计 stopTime + 单一主时钟」

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-ai-clip拆解.md:637-651`（§6.2） |
| 性质 | 架构模式 / 算法 |
| **mulpub 现状** | **🟡 部分存在**（绝对时间模型已有且多处；缺的是「前端预览播放器」这一半） |
| 价值 | 中-高 —— 音/字/画三轨同步最易写崩；这套模型无嵌套状态、可序列化、可断点恢复 |
| 移植难度 | 中 —— 算法直白，但**必须保留「秒为主、出参转毫秒」的边界约定**（竞品出参处统一 ×1000） |
| 依赖与风险 | 秒/毫秒单位边界最易出错；mulpub 已有 `subtitleAlign` 的毫秒口径，需对齐 |

**搜索证据（已存在的部分）**
- `story2video-segmentation.js:224-232` → `endTime = index === blocks.length-1 ? duration : currentTime + blockDuration`，
  随后 `currentTime = endTime` —— 这正是「**累计和拍平**」的写法
- `subtitle-align-aggregator.js:95-113` → 取末段 ASR 结束时间作 `lastAsrEnd`，逐段 `startTime`/`endTime` 顺序回填，
  强制 `endTime >= startTime` —— 单调时间轴
- `packages/video-clone-engine/src/clone-report.js:34-45` → `narrative.timeline` 逐条校验 `t0>=0`、`t1>t0`，
  且**跨条必须排序且不重叠**（`:45` 报「与上一段重叠」）—— **比竞品更严**
- `story2video-compose-engine.js:621-632` → `xfade` 的 duration 必须小于相邻输入时长，且 `transitionName` 必须随 `plan` 返回
  （缺失会生成 `transition=undefined`）—— 对应竞品「xfade 参与时长补偿」
- `video-clone-engine/src/adapters/analyze-ffprobe.js:87` → 场景切点实测映射为 `timeline`(`t0`/`t1`)

**缺的一块**：**单一主时钟驱动的前端预览播放器**。`stopTime` / `masterClock` / `主时钟` **零命中**；
mulpub 的时间轴都活在**合成/导出侧**（主进程 / Python），没有竞品那种「`setInterval 200ms` 累加 + 每 tick 只做三个比较」的渲染层播放器。

**结论**：部分存在。若要做「多素材自动成片的可视化预览」，竞品这套模型可作中间表示；
但**不要把它当成「mulpub 没有时间轴」**—— 时间轴模型不但有，还有更严的重叠校验。

### C-10 SSE 真实进度（兄弟模块 `clipMethods.js:1236`）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-ai-clip拆解.md:706-717`（§6.7）、`:864`（假进度列为 MAJOR） |
| 性质 | 架构模式 |
| **mulpub 现状** | **✅ 已存在（形态为 IPC 推送 + 节流，非 SSE，且更完整）** |
| 价值 | 中 —— 竞品报告的价值在**反面教材**：`view-ai-clip` 用定时器冒充进度，同产品兄弟模块才有真 SSE |
| 移植难度 | N/A（已存在） |
| 依赖与风险 | 无。建议把竞品的**假进度**作为 Code Review 必检项（见 C-21） |

**搜索证据（证明 mulpub 有真实进度）**
- `packages/shared-utils/src/task-queue.js` 事件总线：`task:added`(`:203`)、`task:cancelled`(`:247`)、`task:manual-retry`(`:276`)、
  `queue:paused`(`:428`)、`queue:resumed`(`:437`)、`queue:cleared`(`:458`)、`task:start`(`:526`)、`publish:blocked`(`:553`)、
  `task:success`(`:636`)、`task:retry`(`:661`)、`task:failed`(`:668`)
- `apps/desktop/electron/services/batch-manager.js:534` → `win.webContents.send('batch:progress', payload)` ——
  **队列事件流式推到渲染层**；`:347-348` 订阅 `task:success`/`task:failed`，`:274-275` 销毁时 `off` 退订
- `rpa-progress-throttle.js:6-23` → `ProgressThrottle`：`_minInterval=5000ms` + `_minPercentDelta=10`，`percent===100` 恒放行 ——
  **进度节流**已封装为可测纯逻辑
- `zhihu-favlist.js:192` → `event.sender.send('zhihu-fav-batch:progress', payload)` —— 另一条独立进度通道
- 竞品对照：真 SSE 在 `view-smart-clip/main/clipMethods.js:1236`（`EventSource`），但同产品 `view-ai-clip` 用 `setInterval` 假进度（`methods.js:615-621`）

**结论**：已存在，且 mulpub 的形态（EventEmitter + IPC 推送 + 节流器）比竞品 SSE 更适合 Electron。
**本项不需要借鉴，只需要把「禁止假进度」写进门禁。**

### C-11 测量驱动贪心装箱分页引擎（`calculateContainers.js`，485 行）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-xhs-template拆解.md:266-388`（§7 逐函数）、`:490-505`（§9.1）、`:664`（行动建议 P0） |
| 性质 | 算法 |
| **mulpub 现状** | **❌ 真缺失** |
| 价值 | 高 —— **唯一能直接补上「长文 → N 张固定尺寸图文卡片」能力空白**的整块算法；与 mulpub 痛点正面对位 |
| 移植难度 | 中 —— 依赖 DOM（`offsetHeight`/`getClientRects`/`rAF`），**只能在渲染进程用**；需提供等价 CSS |
| 依赖与风险 | ① **必须修掉「测量模型 ≠ 渲染模型」的 3 处缺陷**（不渲染 icon / `_noMarginTop` 只在一侧 / 副标题首项判据语义不同），否则把溢出缺陷一起搬来；② 建议先把 `distributeItemsByHeightSimple`(`:162-259`) 与 `processRemainingItems`(`:262-327`) **合并成一份**；③ 性能 ≈ `(条目数 + 切分次数 × 12) × 16ms` |

**搜索证据**
- `calculateContainers` / `distributeItems` / `分页引擎` / `贪心装箱` / `测量容器` / `标点吸附` / `二分切分` → **全部零命中**
- 相邻但不同：`packages/shared-utils/src/cover-processor/index.js:116` 有「二分法降低质量」——
  是 **JPEG 质量二分**，不是字符切分二分，语义无关

**结论**：真缺失，Top 清单第 1 位。这也是竞品两份模块拆解里**唯一被两边同时评为「最值得借鉴」**的一项。

### C-12 `box-decoration-break: clone` 跨行高亮 + 导出前 DOM 重写补丁

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-xhs-template拆解.md:507-518`（§9.2） |
| 性质 | 算法 / 实现技巧 |
| **mulpub 现状** | **❌ 真缺失** |
| 价值 | 中-高 —— 该属性让 `background-color`/`border` 在**被折行 span 的每一行碎片上独立绘制**，是跨行荧光笔高亮/圈选不断裂的唯一 CSS 手段 |
| 移植难度 | 低（CSS + 约 20 行替换）/ 中（截图补丁需按实际截图库验证） |
| 依赖与风险 | 竞品补丁是为 **html2canvas** 打的；换截图库需重新验证。「浏览器能画 ≠ 截图库能画」这条经验本身可复用 |

**搜索证据**
- `box-decoration-break` / `-webkit-box-decoration-break` → **全域零命中**
- 相邻能力走向不同：`local-cover-generator.js` 走 **SVG 生成封面**（`escapeXml`:70-77、`<tspan>`:269），
  `packages/shared-utils/src/cover-processor/` 走 canvas 裁剪 —— **都不是 HTML 富文本截图路线**

**结论**：真缺失，但**价值取决于产品是否走「HTML 渲染 → 截图导出」路线**。若维持 SVG/canvas 封面路线，
本项边际价值显著下降 —— 建议**按路线决策后再排期**，不要盲目移植。

### C-13 `getClientRects` 视觉换行对齐（`lineBreaks.js`）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-xhs-template拆解.md:203-263`（§6 逐函数）、`:520-524`（§9.3） |
| 性质 | 算法 |
| **mulpub 现状** | **❌ 真缺失**（同类 API 已大量使用，但**用途完全不同**） |
| 价值 | 中-高 —— 任何基于 `contenteditable` 的编辑器都会撞上「用户看到的换行 ≠ DOM 里的 `\n`」 |
| 移植难度 | 低-中 —— 两函数自包含可直接复制；**但必须重写 `getVisualLinesFromSelection`**（依赖空壳 `getNextNodeInRange`，跨文本节点不可用） |
| 依赖与风险 | 移植时应参考竞品同文件里**那份未接线的正确实现**（`getSelectionLinesRobust` 的 `TreeWalker` + `intersectsNode`） |

**搜索证据（关键：区分「有 API」与「有这能力」）**
- `getClientRects` → **20+ 处命中，但全部**是 `getClientRects().length > 0` 形式的**可见性判据**：
  `rpa-selector-utils.js:44`（`_visible`）、`wechat-mp-draft-mediaid.js:103`（toast 可见性）、`rpa-view-helpers.js:351`、
  `upload-waiter.js:60-62`、`rpa-view-navigation-helpers.js:110-113`。**没有一处**用于「视觉行分组 / 二分切行」
- `mergeDomObjectsByBottom` / `splitTextNodeByLines` / `getVisualLinesFromSelection` / `视觉行` → **全部零命中**
- mulpub 的既有替代（同 API、异问题）：`PRD-WECHAT-MP-ARTICLE-PUBLISH-2026-10-12.md:515,571,645` 与
  `openspec/changes/wxmp-draft-mediaid-fix/design.md:41-91` —— 判据是 `offsetParent || getClientRects().length > 0`（取或，覆盖 `position:fixed`）

**结论**：真缺失。这是**最容易被误判为「已有」**的一项（`getClientRects` 命中满屏），故特意逐条判语义。Top 清单第 4 位。

### C-14 模板配置「远端优先、本地兜底」双轨（`methods.js:19-29`）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-xhs-template拆解.md:526-529`（§9.4）、`竞品分析报告.md:854-882`（优先级 10） |
| 性质 | 架构模式 |
| **mulpub 现状** | **✅ 已存在（且比竞品强一个量级）** |
| 价值 | 中 —— 竞品启示是「模板/规则这类运营频繁改、代码不该跟着发版的数据，用双轨最省事」 |
| 移植难度 | N/A（已存在） |
| 依赖与风险 | 竞品方案有 3 个反面教材：① **无兜底**（`result._ruleList.length` 抛 TypeError，其 §10-4）；② 远端**整体覆盖非合并**（远端少一套模板，本地不补回）；③ `timemap` 缓存参数**硬编码字面量**，等于把配置更新绑到发版 |

**搜索证据（证明 mulpub 实现更完整）**
- `apps/desktop/electron/services/ops-center-sync.js` → 运营后台→桌面端**运行时同步**主干；`:32` `SETTING_KEY='opsCenterSync'`；
  `:579-633` 逐字段分发到 6 个 manager 的 `applyRemote*`
- **签名校验**：含 `verifyRuntimeSignature` / `canonicalJson` / `DEFAULT_RUNTIME_PUBLIC_KEY`；`:91` 注释明写
  「否则持有 DEV 私钥的人可给生产客户端下发整份运行时策略」；配套 `runtime-trust-anchor.js`（打包版禁止吃内置 DEV 公钥）——**竞品没有这一层**
- **本地兜底（fail-open）**：`content-categories.js:9`「① **fail-open 回退内置 11 类**：运营中心没下发/下发为空/结构非法时…」；
  测试 `content-categories.test.js:28`「未下发 / 空 / 结构非法 → 内置 11 类」
- **结构净化**：`template-manager.js` 的 `sanitizeRemoteTemplate`（逐字段类型/长度/数量自防御，`MAX_REMOTE_TEMPLATES=200`）；
  `app-menu-config.js:3-8`「把不可信的远端 payload 净化为渲染端可直接消费的形状」+ 原型污染防御
- **覆盖 6 个数据面**：`platformConfig`(`:579`)、`templateManager`(`:588`)、`keywordMonitor`(`:597`)、
  `rewriteStrategyManager`(`:606`)、`rewriteHardConstraintManager`(`:617`)、`rewriteAiTasteMapManager`(`:633`)
- **变更检测**：各 manager 的 `applyRemote` 返回 `changed` 布尔（`rewrite-ai-taste-map-manager.test.js:51-57`「同内容 false、变更 true」），避免无变化刷写持久化
- **三层降级 + 断连韧性**：`ops-center-sync.resilience.test.js:127`「三层降级接线」；`ops-runtime-snapshot.js` 提供 L2 快照回放

**结论**：已存在，且是 mulpub 的一个**领先面**。竞品那套在 mulpub 里不止有，还多了
**签名验签 + 结构净化 + 变更检测 + 三层降级 + 本地快照回放**。
→ 正确动作不是「借鉴」，而是**把 C-01/C-03/C-05 这三类易变资产接到这套已有机制上**。

### C-15 命令式撤销栈（闭包对，`methods.js:1566-1604`）

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-xhs-template拆解.md:536-539`（§9.6） |
| 性质 | 算法 / 架构模式 |
| **mulpub 现状** | **❌ 真缺失** |
| 价值 | 中 —— DOM 密集型编辑器**存闭包比存快照便宜得多**（不必序列化 `innerHTML`），且天然支持不可逆操作的补偿语义 |
| 移植难度 | 低 |
| 依赖与风险 | 竞品踩的 3 个坑要一并规避：① 闭包持有 DOM 引用 ⇒ **元素被删后 undo 会操作游离节点**（应先检查 `isConnected`）；② `shift()` + `historyPosition--` 在连续溢出时正确性依赖逐次递减（建议 `splice(0, overflow)` 一次裁多笔并同步修正）；③ 上限 100 应提为配置 |

**搜索证据**
- `onSaveHistory` / `pushHistory` / `undoStack` / `redoStack` / `historyPosition` / `命令式撤销` / `撤销栈` → **全部零命中**
- `apps/desktop/src` 全域 `undo` / `redo` → 仅命中**「不可撤销」提示文案**（`locales/story2video/zh.js:37,44,48`、
  `locales/accounts-page/en.js:167`、`locales/history-page/en.js:176` 等）与一处注释
  （`useBatchPublish.js:563`「`batch:cancel` 只作废本地记录（平台无撤销接口）」）—— **没有任何撤销/重做实现**
- 相关但不同：`apps/desktop/src/views/ReplayTimeline.vue` 是**生产回放**（时间轴回放），不是编辑器撤销栈

**结论**：真缺失。mulpub 的编辑器/画布类页面（`CreateView`、发布正文编辑器等）**当前没有撤销能力**，
既是可感知的产品缺口，也是低成本可补项。

### C-16 「前端只产编排 JSON、重活交原生」职责切分

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-ai-clip拆解.md:117-122`（§2.2 纠正 1 的结论）、`:924`（P0 建议） |
| 性质 | 架构模式 |
| **mulpub 现状** | **✅ 已存在（且形态更系统）** |
| 价值 | 高（模式本身）—— 竞品价值在**反面证据**：它证明「桥接风格不可照抄（CEF vs IPC），但职责切分完全可移植」 |
| 移植难度 | N/A（已存在） |
| 依赖与风险 | 竞品报告的具体建议是「把编排 JSON schema 文档化并用 zod 校验」。⚠️ **mulpub 的既有决定是不引入 zod**（`archive/LEGACY-MP-REUSABLE-DELIVERY.md:48`：`helpers.js` 已有 `wrapIpcHandler(requireArgs:true)` + 手写校验覆盖高频路径，引入 zod 增 ~14 KB 收益不明确）⇒ **这条建议已被评估并否决，不应重新提出** |

**搜索证据**
- `pipeline-engine.js` → `orchestrationMode` 双模：`'state_machine'`(`:913`) 与 `'orchestrator'`(`:1410`)；
  `:7` 注释「orchestrator（新增）- 通过 `StageExecutor` 真正执行每个阶段，调用 `ServiceBus`」
- `run-state-store.js:112,126` → 快照 `kind: 'orchestration-run-state'`、`orchestrationMode` —— 编排状态**可持久化、可断点恢复**
- `story2video-stages.js` → `context.video_plan = plan`(`:2410`)、`emptyPlan`(`:2275`) —— 阶段间以**结构化 plan 对象**传递
- `story2video-compose-engine.js:621-632` → `_xfadeMerge(segments, plan, outputPath)` —— 合成层只消费 `plan`，不回调 UI
- `video-clone-engine/src/clone-report.js:99-102` → `editReport(r, { path: 'narrative.timeline.0.label', value })` ——
  报告以**路径寻址**的可编辑结构表达，纯数据
- `packages/python-backend/` → 重活（ffmpeg 工具族、渲染引擎）全在 Python 侧，含 `render_engine_registry`
  （`remotion`/`hyperframes`/`ffmpeg` 三引擎注册表）

**结论**：已存在。本项**不需要借鉴**，但值得作为**架构原则**写进文档，防止后来者重新发明。
唯一可补的是「编排 JSON schema 文档化」—— **文档化，不是引入 zod**。

---

## 4. C 组：平台与接口（C-17 ~ C-20）

### C-17 1,338 个平台 API 端点清单（`mtm-platform-apis.md`，1533 行）

| 字段 | 内容 |
|---|---|
| 来源 | `mtm-platform-apis.md`（全文）、`原生层分析报告.md:264-284`、`竞品分析报告.md:580,834` |
| 性质 | 接口清单 |
| **mulpub 现状** | **❌ 真缺失（建议只做查询索引，不做代码迁移）** |
| 价值 | 低-中 —— 作为「实现新平台时先查表」的**参考资料**有价值；作为**代码资产**价值低 |
| 移植难度 | 高 —— 1,338 条是竞品整机的端点快照，与 mulpub 的 adapter 架构不对应 |
| 依赖与风险 | ① 端点随平台改版失效；② **照搬会把 mulpub 拖回「大而全端点表」的维护模式**——现行形态（每平台一 adapter，端点写在 adapter 内）更可维护 |

**搜索证据**
- `01-docs/` 下的端点目录类文档（`*endpoint*` / `*api-list*` / `*platform-api*`）→ **零命中**
- `mtm-` / `MediaTaskMgr` / `1338` → 在 `packages/`、`apps/` 全域**零命中**（仅在
  `RESEARCH-COMPETITOR-REVERSE-2026-10-13.md:100` 作为**引用**出现）
- mulpub 的实际形态：端点在 adapter 内 —— `api-publish-engine/src/adapters/*`、
  `account-metrics/adapters.js`（每平台一个 `buildListRequest()` 返回 URL）、`content-intelligence-sources.js`

**结论**：真缺失，**但不建议迁移**。建议把竞品清单**作为只读参考**登记在文档里（「实现新平台时先查此表」），
不产出代码资产。**明确记录为「不做」**。

### C-18 参考产品 36 平台配置（登录页 URL + 登录后入口 URL）

| 字段 | 内容 |
|---|---|
| 来源 | `Refproduct-platforms.md:8-49`（§1 全表）、`:53-94`（§2 自定义登录判定）、`:151-219`（§4 64 个唯一 URL） |
| 性质 | 接口清单 / 数据 |
| **mulpub 现状** | **🟡 部分存在**（15 平台齐全；36 平台是**候选输入**，未登记） |
| 价值 | 中-高 —— 「补平台时直接可用，不必再试探平台登录入口」 |
| 移植难度 | 低（补数据）/ 高（每加一个平台要走完整门禁） |
| 依赖与风险 | 每新增一个平台**必须**同步四件事（否则 CI 会红，`平台覆盖差距分析.md:111-125`）：① `platform-definitions.js` 加记录；② `config/platforms.yaml` 加配置；③ **`content-formatter.js` 承载形态登记表**扩表；④ 补「纯文本多段 → 产物形态」的**精确**断言测试。另 i18n `zh.js`/`en.js` 成对提交 |

**搜索证据**
- `PLATFORM_LOGIN_URLS` / `PLATFORM_DASHBOARD_URLS` → **已存在，各含 15 个平台**，与 `config/platforms.yaml` 的 15 个**一一对应**：
  `wechat_mp`/`zhihu`/`weibo`/`douyin`/`xiaohongshu`/`tencent_video`/`kuaishou`/`toutiao`/`bilibili`/`baijiahao`/
  `youtube`/`tiktok`/`twitter`/`instagram`/`facebook`
- mulpub 的判据面**比竞品宽得多**：竞品 36 平台表只有 2 列（登录页 + 入口），mulpub 的 15 平台有 10+ 个判据表（见 C-05 清单）
- 竞品那 36 个平台名（`DaYuHao`/`CSDN`/`JianShu`/`DouBan`/`XueQiuHao`/`CheJiaHao`/`YiCheHao`/`DeWu`/`PiPiXia`/
  `MeiYou`/`WifiWanNengYaoShi`/`AI_DouBao`…）→ **全部零命中**，确实未登记
- **关键洞察（竞品报告 §优先级 1）**：36 个平台里**只有 2 个**（DouYin、WangYiHao）有自定义 `waitForLoginFinish`，
  其余 34 个用通用 URL 判定 —— **与 mulpub 是同一路线**。所以「补 36 套特化」这个初始印象是**错的**，
  真实工作量是「补 2 个平台的特化」

**结论**：部分存在。真实动作是：把 36 平台表作为**补平台时的输入数据**，而不是「照抄 36 套配置」；
且优先补 `平台覆盖差距分析.md:44-59` 那张「两家都有」的 **9 个平台**。

### C-19 平台覆盖差集（mulpub 缺 38 个 / 独有 5 个国际平台）

| 字段 | 内容 |
|---|---|
| 来源 | `平台覆盖差距分析.md`（全文 135 行） |
| 性质 | 数据 / 决策输入 |
| **mulpub 现状** | **🟡 部分存在**（差集结论与代码现状**核实一致**；38 个缺口未落地，且**不建议全量追平**） |
| 价值 | 中 —— 结论是「数量不是护城河，5 个国际平台是差异化优势，优先补 9 个行业标配」 |
| 移植难度 | 见 C-18 的四件事门禁 |
| 依赖与风险 | 报告 §6 第 4 条明确：**低质资讯分发平台（趣头条/惠头条等 9 个）不建议做**，与本项目「内容质量门禁」定位冲突 |

**搜索证据（核实差集结论是否与代码一致）**

| 报告主张 | 代码实测 | 一致？ |
|---|---|---|
| 本项目 15 个平台 | `config/platforms.yaml` 实测 **15** 条；`PLATFORM_LOGIN_URLS` 亦 **15** | ✅ |
| 10 中文 + 5 国际 | 中文 10：`wechat_mp`/`zhihu`/`weibo`/`douyin`/`xiaohongshu`/`tencent_video`/`kuaishou`/`toutiao`/`bilibili`/`baijiahao`；国际 5：`youtube`/`tiktok`/`twitter`/`instagram`/`facebook` | ✅ |
| 「独有 5 个国际平台」是护城河 | 两竞品 36/30 个平台**全部是中文**（`Refproduct-platforms.md:8-49` 无国际平台；`融媒宝-data.zip数据集拆解.md:317` 自陈「全无（该产品不做海外）」） | ✅ |
| 9 个「两家都有」平台未接入 | `DaYuHao`(大鱼号)/`QiEHao`(企鹅号)/`WangYiHao`(网易号)/`SouHuHao`(搜狐号)/`YiDianHao`(一点号)/`KuaiChuanHao`(快传号)/`AiQiYi`(爱奇艺号)/`MeiPai`(美拍)/`AZhan`(A站) 名字与域名**全部零命中** | ✅ |
| 报告把「微信视频号」列为 **P0 待补** | ⚠️ **命名冲突**：mulpub 的 `tencent_video` 条目 `name` 实际是**「视频号」**、`publish_url` 指向 `channels.weixin.qq.com`（`config/platforms.yaml:93-97` 有专门命名澄清注释）⇒ **视频号已接入**，只是 id 叫 `tencent_video` | ⚠️ **需按代码口径修正** |

**结论**：部分存在 + **一处结论需修正**。差集分析本身可靠，但「视频号 P0」在代码口径下**已不成立**。
补平台时应先按 `platform-definitions.js` 的 slug 对齐，不要凭平台中文名判断是否已接入 ——
这正是 `platforms.yaml:93-97` 那条注释警告过的坑。

### C-20 15 种 ffmpeg 操作（原生层）

| 字段 | 内容 |
|---|---|
| 来源 | `原生层分析报告.md:264-320`（§3）、`:391-402`（交叉验证）；`竞品分析报告.md:585-586` |
| 性质 | 接口清单 / 算法 |
| **mulpub 现状** | **🟡 部分存在（覆盖广、形态不同、有明确缺口）** |
| 价值 | 中 —— 最有价值的是**两条经实战调优的参数**：`amix=...dynaudnorm=f=500:g=30:p=0.8:m=20` 与 SSML 前后静音 |
| 移植难度 | 低（参数）/ 中（任务抽象） |
| 依赖与风险 | ⛔ **打包工具的已验证滤镜清单是硬约束**：`apps/desktop/scripts/stage-media-tools.js:10-22` 的 `REQUIRED_FILTERS` 实测为 `scale/pad/zoompan/rotate/boxblur/drawtext/fade/xfade/acrossfade/anullsrc/amix`（11 个），编码器 `libx264/aac/libmp3lame/png`。**`loudnorm`/`adelay`/`dynaudnorm` 都不在清单内** ⇒ 引入它们必须**同 PR 改 `media-tools-lock.json` + `before-pack` 校验 + 重打包实测**（一条混合 PR 的体量） |

**逐项对照（竞品 15 种 vs mulpub 实测）**

| # | 竞品任务串 | mulpub 对应实现 | 判定 |
|---:|---|---|---|
| 1 | `..._auto_cut` 自动裁剪 | `python-backend/.../providers/video/auto_reframe.py`（`:240` ffprobe 取宽高、`:457`/`:551` ffmpeg `-vf`） | ✅ |
| 2 | `..._clip` 剪辑 | `packages/video-clone-engine` 切片/合成管线 + `video_trimmer.py` | ✅ |
| 3 | `..._compress` 压缩 | ⚠️ 仅 `cover-processor` 的**图片** JPEG 二分压缩（`index.js:116`）；**视频压缩任务无** | 🟡 缺视频侧 |
| 4 | `..._convert` 转码 | `python-backend` 渲染引擎（`render_runtime:"ffmpeg"`，`media_profiles.ffmpeg_output_args`） | ✅ |
| 5 | `..._create_task_center` | `shared-utils/src/task-queue.js` + `pipeline-engine.js` + 进度节流（见 C-10） | ✅ 更规范 |
| 6 | `..._cut` 切割 | `story2video-compose-engine._concatSegmentsChunked`(`:2218`) + `video_trimmer.py` | ✅ |
| 7 | `..._extrat_subtitle` 提取字幕 | `aggregation/video_service.py:3` 管线（下载→ffmpeg 提 16kHz WAV→`AsrEngine`）+ `video-clone-engine` ASR 契约 | ✅ |
| 8 | `..._merge` 合并 | `_concatSegments`(`:2090`)：`xfade`(`:2126`) 或 **concat demuxer 无损拼接**(`:2175-2183`) | ✅ |
| 9 | `..._mix` 混剪 | `story2video-compose-engine` + `video-clone-engine/compose-ffmpeg.js` + BGM 混音(`:2395-2399`) | ✅ |
| 10 | `..._snap` 截图 | `cover:extract` → `cover-extractor.js:42`（离屏 canvas 抽帧） | ✅ |
| 11 | `..._speed` 变速 | `compose_utils.build_atempo`(`:83-92`，含 >100× 与 <0.5× 链式拆分) + `video_trimmer._build_atempo_chain`(`:231`) + `silence_cutter._build_atempo_chain`(`:535`) + `setpts` | ✅ 更严谨 |
| 12 | `..._split_audio` 音视频分离 | `video_service.py:363-366`（ffmpeg 提 16kHz PCM WAV）+ `audio/_utils.probe_duration` | ✅ |
| 13 | `..._subtitle` 加字幕 | `video-clone-engine/buildAssScript` → `subtitles=` 滤镜（`compose-ffmpeg.js:75,131`）；`test_ffmpeg_subtitle_burn_command_shape` | ✅ |
| 14 | `..._to_gif` 转 GIF | ⚠️ **未见**（`to_gif` 零命中；仅门禁的图片扩展名白名单含 `.gif`） | 🟡 缺 |
| 15 | `..._watermark` 加水印 | `video-clone-engine`（`args.push('-i', assets.watermark.path)`，`:71,117`）+ `story2video-compose-engine` 后置烧录 | ✅ |
| 补 | `AudioSilenceRemove` 静音段移除 | `providers/video/silence_cutter.py`（`_build_atempo_chain:535`） | ✅ **有**（纠正报告） |
| 补 | 混音动态归一化 `dynaudnorm` | ⚠️ **零命中**；现有 `amix=inputs=2:duration=first:dropout_transition=2`(`:2396`) 无 `dynaudnorm` | 🟡 **真缺口** |
| 补 | TTS SSML 前后静音 | ⚠️ 未命中；`loudnorm` 被**明确排除**（`PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md:322`） | 🟡 缺口 |

**结论**：部分存在，且**纠正了报告的一处判断** —— 报告称「音频降噪 `wavelet_denoise()` + `AudioSilenceRemove` 本项目 ❌ 未见」，
实测 **`silence_cutter.py` 已存在**（静音段切割 + atempo 变速链）。真实缺口只有 3 处：
**视频压缩任务抽象**、**转 GIF**、**混音动态归一化 `dynaudnorm`**；其中 `dynaudnorm` 因**不在已验证滤镜清单**内，落地成本显著高于表面。

---

## 5. D 组：负面知识 → mulpub 自查（C-21 ~ C-23）

> 本组重点不是「竞品有什么可抄」，而是「**竞品踩的坑，mulpub 有没有**」。每项都给 grep 证据，而非「应该没问题」。

### C-21 view-ai-clip 的 4 个 CRITICAL → mulpub 自查

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-ai-clip拆解.md:736-812`（§7 CRITICAL C1–C4） |
| 性质 | 负面知识 |
| **mulpub 现状** | **✅ 四类均未复现**（逐条给证据） |
| 价值 | 高（作为门禁条目）—— 这 4 条都是「主路径必然可达」的缺陷，值得写进 Code Review 必检项 |
| 移植难度 | N/A |

| 竞品缺陷 | mulpub 自查证据 | 判定 |
|---|---|---|
| **C1** `escapeSpecialChars` 字符类 `[&<>"'/]` 含 `/`，但 `escapeMap` 无 `"/"` 键 ⇒ 替换回调返回 `undefined` ⇒ 插入字面量 `"undefined"` | `escapeMap` **零命中**。唯一同族函数是 `local-cover-generator.js:70-77` 的 `escapeXml`，逐字符 `.replace()` 链（`&`/`<`/`>`/`"`/`'`），**不存在「正则字符类比映射表多一项」的形态**；有单测锁（`local-cover-generator.test.js:116`「`&lt;script&gt;`」） | ✅ 未复现 |
| **C2** `while(true)` 每秒请求一次，任何非 `{code:"200",data:"1"}`（**含正常业务拒绝**）都永不退出、永不 resolve | `while (true)`/`for (;;)` 全域 **22 处命中**，但重试语义已被两道封顶：`retry-middleware.js:63` `maxRetries = opts.maxRetries \|\| 3`（`:79` 循环 + 熔断器）与 `publish/core/http-base.js:61` `maxAttempts = opts.maxAttempts \|\| 3`（`:8-9` 注释「总尝试封顶」）。其余命中为队列/轮询循环 | ✅ 未复现（**注**：未逐个读完 22 处循环体，见 §8.2） |
| **C3** AI 失败分支无上限递归 + 按钮永久禁用（`onSafeAsyncAssign` 自我重调，不检查次数） | `catch` 内重入同一函数的形态（`\.catch\(\(\) => this\.`、`catch (e) { this.on…`）**零命中**。另有**降级留痕**门禁：`compose-degradation-trace.test.js:111` 断言 `catch 必须记录原因或转抛`（`assert.deepEqual(silent, [], …)`） | ✅ 未复现 |
| **C4** `v-html` + 未转义用户文本 ⇒ HTML 注入（注入点在能调原生桥的 iframe 内） | `apps/desktop/**/*.vue` 全域 `v-html` **零命中**；**机械锁** `apps/desktop/eslint.config.mjs:61` `"vue/no-v-html": "error"`；独立审计 `docs/frontend-deep-review-2026-10-05.md:22`「`v-html` 命中 **0**」、`:558` `dangerouslySetInnerHTML` **0**；`FRONTEND-UI-UX-OPTIMIZATION-PLAN.md:22`「`v-html` 使用为 **0 处**」。命令式 `innerHTML` **都带净化**：`rpa-view-helpers.js:170` 与 `rpa-view-platforms.js:1028` 写入前 `querySelectorAll("script, iframe, object, embed").forEach(remove)` + 摘除全部 `on*` 属性 | ✅ 未复现（**有机械锁**） |

**结论**：**✅ 四类均未复现**，其中 C4 有 ESLint 机械锁。
建议把 C1/C2/C3 的缺陷**形态**（不是代码）补进 `.quality-gates.md` 的 Code Review 必检项。

### C-22 view-xhs-template 的 3 个 🔴 → mulpub 自查

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-xhs-template拆解.md:547-573`（§10 的 🔴 1–3） |
| 性质 | 负面知识 |
| **mulpub 现状** | **✅ 前两类未复现；第 3 类 N/A** |
| 价值 | 中-高 |
| 移植难度 | N/A |

| 竞品缺陷 | mulpub 自查证据 | 判定 |
|---|---|---|
| **🔴1** `onElToThumbnail` 的 `.catch` **重调整个函数** ⇒ 原 Promise 的 `resolve` 永不调用 ⇒ 所有 `await` 永久挂起，界面永远停在加载遮罩 | `.catch(() => this.` / `.catch(() => that.` **零命中**。同族防护：`compose-degradation-trace.test.js:111` 断言 catch 必须记录原因或转抛（禁止静默吞） | ✅ 未复现 |
| **🔴2** 选「JPG」下载，内容却是 PNG：`toDataURL()` **不传 mime**（规范默认 `image/png`），而扩展名与 base64 前缀剥离都按 `imageType` 走 | mulpub 的 `toDataURL` **3 处命中，全部显式传 mime**：`cover-extractor.js:42` `toDataURL("image/jpeg",Q/100)`、`cover-cropper.js:106` `toDataURL("image/jpeg",q/100)`、`qrcode-login.js:397` `toDataURL('image/png')`（二维码需无损，此处 PNG 是有意的） | ✅ 未复现 |
| **🔴3** 测量模型与渲染模型不一致（测量不渲染 icon / `_noMarginTop` 只在一侧 / 副标题首项判据语义不同） | **N/A**：mulpub 没有该分页引擎（见 C-11），不存在「测量侧 vs 渲染侧」这对模型。⚠️ 但**若移植 C-11，这三处缺陷会被一起搬来** —— 移植清单必须包含修复项 | N/A（移植时须带修复） |

**结论**：**✅ 未复现**，第 3 类转为「C-11 的移植前置条件」。

### C-23 `lineBreaks.js` 65% 死代码 + `getNextNodeInRange` 恒 null

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-xhs-template拆解.md:203-263`（§6）、`:590`（缺陷 6）、`:648-652`（纠正 4） |
| 性质 | 负面知识 |
| **mulpub 现状** | **✅ 未复现（文件与 API 均不存在）**，但**类别风险未被机械覆盖** |
| 价值 | 中 —— 教训是「**做完之后忘了接线**」，且「真正正确的实现就在死代码区」 |
| 移植难度 | N/A |

**搜索证据**
- `lineBreaks` / `getNextNodeInRange` / `getVisualLinesFromSelection` / `getSelectionLinesRobust` /
  `mergeDomObjectsByBottom` / `splitTextNodeByLines` → **全部零命中**（该文件及其 7 个函数在 mulpub 不存在）
- mulpub 的同类防护：`scripts/check-unwired-tests.js`（**检测未接线的测试**，有 `MUST_LIVE_IN_UNGATED_JOB`
  登记表与陈旧项判红）—— 但它的**扫描域是测试文件，不是生产代码**

**结论**：**✅ 未复现**（本项无从复现）。但要如实指出：**mulpub 对「生产代码死函数」没有机械门禁**，
`check-unwired-tests.js` 只管测试文件。这条属「**类别风险未被覆盖**」，而非「已规避」。

---

## 6. 增补项（C-24 ~ C-29）

> 下列 6 项不在任务给出的候选清单里，是**读完 8 份报告后**补的。之所以补：它们都是报告点名「建议落点」的条目，
> 而核实后大多数**已有更强的实现** —— 不登记的话，下一轮会重蹈「把已存在的写成待做」的覆辙。

### C-24 「服务端 prompt 模板 + 客户端只填槽」契约

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-view-ai-clip拆解.md:576-592`（§5.1）、`融媒宝-view-xhs-template拆解.md:462` |
| 性质 | 架构模式 |
| **mulpub 现状** | **✅ 已存在（有契约文件与单测）** |
| 价值 | 中 —— 好处是「改 prompt 不用发版」；代价是「服务端改返回格式客户端就会炸」 |
| 移植难度 | N/A |
| 依赖与风险 | 竞品方案的反面教训：`onFormatDubItem` 完全依赖 `【方案N】` 分隔，服务端改格式即触发一条 MAJOR 缺陷路径；且模型名**硬编码无配置**（`glm-4-air`/`deepseek-r1-0428`/降级 `glm-4-plus`） |

**搜索证据**
- `apps/desktop/electron/services/prompt-engine-contract.js`（+ `.test.js`）→ 文本域 prompt 引擎契约（**独立文件**）
- `apps/desktop/electron/services/video-prompt-engine-contract.js`（+ `.test.js`）→ 视频域契约（**分文件分命名**）
- `apps/desktop/electron/services/prompt-engine-kernel.js` → prompt 引擎内核
- `apps/desktop/electron/services/rewrite-hard-constraint-manager.js` → 服务端下发的改写硬约束（`applyRemote`，bootstrap 只下发默认版本）
- **与竞品的差异**：mulpub 的模型名**不是硬编码** —— `model-provider-manager.js:78,95` 经运营中心**目录同步下发**（`applyCatalog`），
  `:396` 还支持下发桌面端未登记的 provider

**结论**：已存在，且竞品此项的可借鉴点已被 mulpub 以更规范的方式实现（契约文件 + 独立单测 + 模型可配置）。

### C-25 登录态探针：等「具备凭证」而非等「URL 跳转」

| 字段 | 内容 |
|---|---|
| 来源 | `竞品分析报告.md:697-733`（优先级 1）、`深挖补充报告-第5轮.md` |
| 性质 | 算法 / 架构模式 |
| **mulpub 现状** | **✅ 已存在** |
| 价值 | 高 —— 关键洞察：`s_sdk_crypt_sdk` 等**不是普通登录标记，而是签名密钥材料**，「等的不是登录成功，而是**具备签名能力**的那一刻」 |
| 移植难度 | N/A |
| 依赖与风险 | 报告同时纠正一个常见误判：**36 个平台里只有 2 个**需要自定义 `waitForLoginFinish`，其余 34 个用通用 URL 判定 ⇒ 「补 36 套特化」是错的 |

**搜索证据**
- `platform-definitions.js` → `PLATFORM_POST_LOGIN_PROOF_COOKIES = { xiaohongshu: ['web_session'] }` ——
  **「证明性 cookie」概念已落地**
- 同文件常量后注释（逐字）：「二段式补跳的等待预算（毫秒）：凭证轮询在此窗口内反复复查（主站可能整页加载后才由 JS/XHR 种会话 cookie，
  **就绪判据是「凭证真出现」而非页面加载完成**），耗尽则 stop 在途导航、按当前快照继续，不阻断登录」；`POST_LOGIN_REDIRECT_WAIT_MS = 15000`
- 同文件 → `PLATFORM_LS_SESSION_MARKERS`：「部分平台（如视频号）登录态依赖 localStorage 而非仅 Cookie…值为非空即视为会话证据。
  **新增标记键必须以 CDP 实测取证为准**」；配套 `hasPlatformLsSessionMarker()`
- 同文件 → `PLATFORM_SESSION_COOKIE_MARKERS` + `hasPlatformSessionCookie()` + `sessionCookieNames()`
- 签名侧 → `packages/api-publish-engine/src/signer/`（含 `douyin-ticket-guard.js`、`browser-page-provider.js`）——
  「具备签名能力」这一层 mulpub 已有独立实现

**结论**：已存在，且概念（「凭证真出现」而非「页面加载完成」）与竞品报告的建议**逐字同构**。
报告提议的 `appearKeys`/`changeKeys` 探针，在 mulpub 里的对应物是
`PLATFORM_POST_LOGIN_PROOF_COOKIES` / `PLATFORM_LS_SESSION_MARKERS` / `PLATFORM_SESSION_COOKIE_MARKERS` 三张表。

### C-26 敏感词库「服务端下发 + 本地兜底」双层

| 字段 | 内容 |
|---|---|
| 来源 | `竞品分析报告.md:790`（优先级 6 表格末行）、`原生层分析补充报告.md`（`WordChangeZip` + `WordChangeZipOLD`） |
| 性质 | 架构模式 |
| **mulpub 现状** | **✅ 已存在** |
| 价值 | 中 |
| 移植难度 | N/A |
| 依赖与风险 | mulpub 既有纪律：**渲染端最小权限**（词库/替换串不下发），但**持久化必须带 `word_list`**，否则重启后敏感词只剩内置库（`ops-center-sync.test.js:391,406` 注释） |

**搜索证据**
- `packages/shared-utils/src/sensitive-filter.js`（+ `__tests__/sensitive-filter.test.js`）→ 本地敏感词过滤
- `packages/rewrite-engine/src/sensitive-filter.js` → 改写引擎侧
- `apps/desktop/electron/ipc-handlers/sensitive.js`（+ `.test.js`）→ IPC 面
- `ops-center-sync.js` + `ops-center-sync.test.js:391,406` → 运营中心**下发** + 本地**持久化兜底**；
  `:391`「渲染端最小权限：词库/替换串不下发」、`:406`「（渲染端不下发 word_list，但持久化必须带 —— 否则重启后敏感词只剩内置库）」
- 同族：`rewrite-ai-taste-map-manager.js`（`applyRemote(payload)`，`:102`「全量替换语义：下发即当前覆盖层全貌」；
  `:92` 测试「空下发（空数组）清空覆盖层（回内置语义）」）

**结论**：已存在（不止敏感词 —— 改写策略 / 硬约束 / AI 味词库都走同一套）。

### C-27 加密敏感词库：明确不破解，走正版来源

| 字段 | 内容 |
|---|---|
| 来源 | `融媒宝-data.zip数据集拆解.md:285-300`（§3.12）、`:365`（§6.1）、`:340`（§4.3 第 3 条） |
| 性质 | 负面知识 / 合规 |
| **mulpub 现状** | **✅ 已存在（合规前提下已有正规来源）** |
| 价值 | 低（技术）/ 高（合规） |
| 移植难度 | N/A |
| 依赖与风险 | ⚠️ **这条应写成硬约束**：不得因「竞品有词库」而试图取用/解密其资产；合规词库走正版来源 |

**搜索证据**
- mulpub **不依赖**竞品词库：词库来自①内置 `packages/shared-utils/src/sensitive-filter.js`；
  ②运营中心**下发**（`ops-center-sync` + `word_list` 持久化，见 C-26）
- `sensitivelibrary` / 相关竞品资产名 → **零命中**（未引入任何竞品词库资产）
- 报告的正向结论（§3.12 末段）：「若需要敏感词能力，**不应**指望从这份数据取词」

**结论**：已存在（合规路线已就位）。建议把「**不取用竞品加密资产**」写进 `learnings` 或质量门禁，避免后来者重复评估。

### C-28 分片上传 + 断点续传（`uploadId` 语义）

| 字段 | 内容 |
|---|---|
| 来源 | `竞品分析报告.md:604`（§6.2「本项目 `chunked-uploader.js` 已有 `uploadId` 语义」）、`:606-608`（视频号三段式上传交叉验证） |
| 性质 | 接口清单 / 算法 |
| **mulpub 现状** | **✅ 已存在（报告已确认「本项目更规范」）** |
| 价值 | 中 |
| 移植难度 | N/A |
| 依赖与风险 | 无 |

**搜索证据**
- `packages/shared-utils/src/chunked-uploader.js` → `chunkSize`(`:64`)、`uploadId = generateUploadId()`(`:151`)、
  逐片回调 `uploadChunkFn(chunk, index, totalChunks, uploadId)`(`:178`)、事件 `chunk:retry`(`:190`)/`chunk:uploaded`(`:213`)/
  `upload:error`(`:216,220,244`)/`upload:complete`(`:240`)
- `packages/shared-utils/src/index.js:14` → 已导出 `ChunkedUploader`
- **交叉验证（报告 §6.2 亮点）**：mulpub 的 `shipinhao-video.js` 与竞品原生层**独立实现了完全相同的视频号三段式上传协议**
  （`applyuploaddfs` → `uploadpartdfs` → `completepartuploaddfs`）⇒ 证实 mulpub 实现正确，且**更规范**
  （统一分片抽象 + 进度门控 + 分片重试）

**结论**：已存在，报告自己已写明「本项目更规范」，**不需要借鉴**。

### C-29 「发布前双重预检」（含平台侧标题查重）

| 字段 | 内容 |
|---|---|
| 来源 | `竞品分析报告.md:814-824`（优先级 8）、`原生层分析报告.md:348-361` |
| 性质 | 架构模式 |
| **mulpub 现状** | **🟡 部分存在**（本地查重已有；**平台侧查重缺失**） |
| 价值 | 中 —— 「避免白跑一次发布流程」 |
| 移植难度 | 中 —— 需按平台实现 `checkTitle` 类接口，只有部分平台提供 |
| 依赖与风险 | 平台侧接口不是通用能力，需逐平台取证；不宜过早抽象 |

**搜索证据**
- `checkTitle` / `titleExists` / **平台侧**标题查重 → **零命中**
- **本地标题查重（已有）**：`quick-collect-command.js:202`「标题查重：去首尾空白 + 不区分大小写（`localeCompare` 不可用于去重，直接 lower）」；
  渲染端同行为 `features/collection/quick-collect-commands.js:158`；另有 `history-utils.js:190` 的**重复标题检测**
  （`CreateViewHistory.vue:137` 渲染「有重复标题」标签）
- **本地内容风险预检（已有）**：`content-quality-gate.js`（内容质量门禁）+ `sensitive-filter.js`（敏感词）+
  `publish/core/risk-signals.js`（发布风控信号识别，含 `gateway timeout ts=…` 类命中判断）
- 竞品对照：原生层 `ArticleCheckRiskTask`（文章风险检测）+ 网易号 `checkTitle`（标题查重）构成**双重预检**

**结论**：部分存在。缺的**只有「平台侧标题查重」这一环**。
注意不要写成「mulpub 没有发布前预检」—— 本地那两层（质量门禁 + 敏感词 + 风控信号）都在。

---

## 7. 汇总统计

### 7.1 三档分布（29 项）

| 结论 | 项数 | 编号 |
|---|---:|---|
| ❌ **真缺失** | **9** | C-01、C-04、C-07、C-08、C-11、C-12、C-13、C-15、C-17 |
| 🟡 **部分存在** | **9** | C-02、C-03、C-05、C-06、C-09、C-18、C-19、C-20、C-29 |
| ✅ **已存在** | **11** | C-10、C-14、C-16、C-21、C-22、C-23、C-24、C-25、C-26、C-27、C-28 |

> **最重要的一格是「✅ 已存在 = 11 项」**。若不做核实，这 11 项里相当一部分
> （C-10 真实进度、C-14 远端配置双轨、C-16 编排职责切分、C-25 登录态探针、C-28 分片上传）
> 会被写成「待做」—— 与 2026-09-11 那次「7 项假设里 6 项已存在」是同一型错误。

### 7.2 「真缺失」的处置建议分组

| 处置 | 编号 | 说明 |
|---|---|---|
| **排期做** | C-11、C-08、C-01 | Top 3；C-01 需先解决「冻结快照 + 易过期」 |
| **低成本顺手做** | C-13、C-12、C-15、C-07 | C-12 的价值取决于是否走 HTML 截图路线 |
| **明确记录为不做** | C-04、C-17 | 各附理由（规则表 JS 内容未闭合 / 端点表维护成本高于收益）；写清理由可防止被反复重新发现 |

### 7.3 需修正素材报告结论的 3 处

| # | 报告原话 | 实测修正 | 出处 |
|---:|---|---|---|
| 1 | 「音频降噪 `wavelet_denoise()` + `AudioSilenceRemove` \| 本项目 ❌ 未见」 | **已有**：`python-backend/.../providers/video/silence_cutter.py`（静音段切割 + `_build_atempo_chain`） | `原生层分析报告.md:315` |
| 2 | 「微信视频号」列为 **P0 待补** | **已接入**，只是平台 id 叫 `tencent_video`、`name` 为「视频号」；`config/platforms.yaml:93-97` 有专门命名澄清注释 | `平台覆盖差距分析.md:100-101` |
| 3 | §4.3「仅融媒宝有 12 个」表格未标注优先级 | 该栏中 `qie`（趣头条）等属报告**自己判定的低质流量池 P3/不建议**，与 §4.4「不建议做」自洽，但 §4.3 表格未标注 ⇒ 易被误读为可补 | `平台覆盖差距分析.md:82-94` vs `:106` |

---

## 8. 未核实与边界（不假装已查清）

### 8.1 本次**未能核实**的项（如实登记）

| # | 项 | 卡在哪 |
|---:|---|---|
| 1 | **C-12 的价值判定** | mulpub 封面走 SVG/canvas 路线（`local-cover-generator.js`、`cover-processor/`），**没有 HTML→截图 路线**，故「跨行高亮 + 截图补丁」在现有架构下**没有落点**。是否移植取决于产品是否新增该路线 —— 这是**产品决策**，不是技术核实能定的 |
| 2 | **C-11 的实际渲染宿主** | 竞品引擎依赖 `.editor-shell`/`.editable` 的 CSS（其 `css/index.css:642-668`）。mulpub 无等价结构，**移植时必须新建等价 CSS**；本次未评估该 CSS 的重建工作量 |
| 3 | **C-20 视频压缩缺口的严重度** | 只确认「无视频压缩任务抽象」，**未确认** `python-backend` 的 `media_profiles.ffmpeg_output_args` 是否已隐含码率/体积控制（读到的只有函数签名与测试） |

### 8.2 本次核实的**方法学边界**（避免被当成全面结论）

| # | 边界 | 说明 |
|---:|---|---|
| 1 | **`while (true)` 22 处未逐个读完** | C-21② 的判据是「重试语义已被 `withRetry` / `http-base` 两道封顶」，**不是**「已逐个证明这 22 处都有界」。剩余循环体（`model-call-scheduler.js:127`、`asset-generator.js:189`、`videogen-stages.js:823`、`adapters/*.js` 的 SSE 读取循环等）**属未闭合** |
| 2 | **「零命中」不等于「不可能存在」** | 若 mulpub 用完全不同命名实现同一能力，纯关键词检索会漏。缓解做法：对每个 ❌ 项**同时**搜竞品标识符 + 中文意译 + 相邻能力词（如 C-11 额外搜「分页引擎/贪心装箱/测量容器」） |
| 3 | **未做运行时验证** | 全部结论基于**静态检索 + 读文件**，未启动应用、未跑测试。因此「已存在」指**代码存在且语义同构**，不指「功能实测可用」 |
| 4 | **`01-docs/learnings.md`（2.25 MB）仅按关键词局部读** | 该文件可能已记录过本目录的某些结论（甚至已否决过），本次未逐行读完 |
| 5 | **未搜 `node_modules/`、`dist*/`** | 构建产物与依赖不构成源码现状，故排除 |
| 6 | **素材报告自身的未闭合项未被本文重新闭合** | 22 份报告共有 16 条未闭合边界（另见 `RESEARCH-COMPETITOR-REVERSE-2026-10-13.md:319-358` 的重归类表）。本文只做「报告结论 × mulpub 现状」核实，**不重新取证竞品** |

### 8.3 与同轮文档的分工（避免重复劳动）

本 worktree 的 `01-docs/` 下，另一会话已产出
[RESEARCH-COMPETITOR-REVERSE-2026-10-13.md](RESEARCH-COMPETITOR-REVERSE-2026-10-13.md)（53 KB）。
两份文档**分工不同、互为补充，不重复**：

| 文档 | 回答的问题 |
|---|---|
| `RESEARCH-COMPETITOR-REVERSE-2026-10-13.md` | 本轮逆向**做了什么、发现了什么、哪些还没闭合**（成果索引 + 诚实边界） |
| **本文** | 发现的这些东西里，**哪些可复用、mulpub 现在有没有**（逐项代码现状核实） |

另：本会话开始时读取的 `01-docs/MP-REUSABLE-ACTUAL-PLAN.md`，在本次核实**进行期间**已被另一会话
移入 `01-docs/archive/LEGACY-MP-REUSABLE-ACTUAL-PLAN.md`。本文引用该文件时统一使用**当前实际路径**。

---

## 9. 搜索证据索引

> 检索工具：`ripgrep`（经 grep 工具，`path = D:\Data\projects\mp-worktrees\mp-reuse-rollout`）。

| 编号 | 决定性搜索词 | 结果 | 判定依据 |
|---|---|---|---|
| C-01 | `categort` / `categortmap` | 零命中 | 未导入竞品分类表；旁证 `platform-publish-options-audit/REPORT.md:79` 自陈缺失 |
| C-02 | 读 `account-metrics/adapters.js` | 4 平台各有 `metrics` 块 | 存在但非集中矩阵 |
| C-03 | `media_url_list` | 3 命中，全是「参考它设计」注释 | 骨架已在（`platforms.yaml:2`），值只填 4 平台 |
| C-04 | `comment_media_js` / `jspos` / `exactmatch` / `LoadEnd` | 全部零命中 | 真缺失 |
| C-05 | 读 `platform-definitions.js` 的 11 张表 | 逐表确认 | 能力已在，路线更优（语义类名 vs 随机后缀） |
| C-06 | `deepsearchercat` + 读 `quick-collect-sources.js` | 前者零命中；后者 3 英文 + 7 中文 | 部分存在 |
| C-07 | `toCsv` / `CSV` / `exportData` / `export.*csv` | 零命中 | 真缺失 |
| C-08 | `NoRepetition` / `LowRepetition` / `OrdinaryCombination` / `permutation` / `全排列` / `组合算法` | 全部零命中 | 真缺失 |
| C-09 | `stopTime` / `masterClock` / `主时钟` | 零命中；但 `startTime`/`endTime`/`timeline` 大量命中 | 部分存在（合成侧有、预览侧无） |
| C-10 | `task-queue.js` 的 `emit` + `batch-manager.js:534` + `rpa-progress-throttle.js` | 命中 | 已存在 |
| C-11 | `calculateContainers` / `distributeItems` / `分页引擎` / `贪心装箱` / `测量容器` / `标点吸附` | 全部零命中 | 真缺失 |
| C-12 | `box-decoration-break` | 零命中 | 真缺失 |
| C-13 | `getClientRects` 20+ 命中，逐条判语义 | 全是可见性判据 | **真缺失**（易误判，故逐条判） |
| C-14 | 读 `ops-center-sync.js` + 6 个 `applyRemote` | 命中 | 已存在且更强 |
| C-15 | `onSaveHistory`/`pushHistory`/`undoStack`/`redoStack`/`historyPosition`；`src` 全域 `undo`/`redo` | 前者零命中；后者仅「不可撤销」文案 | 真缺失 |
| C-16 | `orchestrationMode` / `run-state-store` / `video_plan` | 命中 | 已存在 |
| C-17 | `mtm-` / `MediaTaskMgr` / `*endpoint*` 文档 | 零命中 | 真缺失（不建议迁移） |
| C-18 | `PLATFORM_LOGIN_URLS`（15 键）+ 竞品 36 平台名 | 前者齐、后者零命中 | 部分存在 |
| C-19 | `platforms.yaml` 计数 + 5 国际平台 + 9 缺口平台名 | 计数一致、缺口名零命中 | 部分存在；**1 处结论需修正** |
| C-20 | `dynaudnorm`/`loudnorm`/`silenceremove`/`atempo`/`to_gif`/`vcodec` | `silence_cutter.py`/`atempo` 命中；`dynaudnorm`/`to_gif` 零命中 | 部分存在；**修正报告 1 处** |
| C-21 | `escapeMap`；`\.catch\(\(\) => this\.`；`v-html`（`.vue`） | 全零命中 | 四类均未复现 |
| C-22 | `toDataURL`（3 处均显式 mime） | 命中且均正确 | 前两类未复现，第 3 类 N/A |
| C-23 | `lineBreaks` / `getNextNodeInRange` 等 6 名 | 全部零命中 | 未复现（但类别无机械防线） |
| C-24 | `prompt-engine-contract.js` / `video-prompt-engine-contract.js` | 命中 | 已存在 |
| C-25 | `PLATFORM_POST_LOGIN_PROOF_COOKIES` / `PLATFORM_LS_SESSION_MARKERS` | 命中 | 已存在 |
| C-26 | `sensitive-filter.js`（2 处）+ `word_list` 持久化 | 命中 | 已存在 |
| C-27 | `sensitivelibrary` | 零命中 | 未引入竞品资产 |
| C-28 | `chunked-uploader.js` / `uploadId` | 命中 | 已存在 |
| C-29 | `checkTitle` / `titleExists` | 零命中；本地查重命中 | 部分存在 |

**关键文件路径**（本文引用的 mulpub 侧证据，按引用频次）：
`packages/shared-utils/src/platform-definitions.js`（平台判据 11 表）、`config/platforms.yaml`（平台配置）、
`packages/shared-utils/src/task-queue.js` + `apps/desktop/electron/services/batch-manager.js`（队列与进度）、
`apps/desktop/electron/services/ops-center-sync.js`（远端配置双轨）、
`apps/desktop/electron/services/account-metrics/adapters.js`（指标适配器）、
`apps/desktop/electron/services/story2video-compose-engine.js`（合成引擎）、
`apps/desktop/scripts/stage-media-tools.js`（已验证滤镜清单）、
`packages/shared-utils/src/chunked-uploader.js`（分片上传）、
`apps/desktop/eslint.config.mjs`（前端 XSS 机械锁）、
`01-docs/platform-publish-options-audit/REPORT.md`（仓内既有发布选项审计）。

---

## 附录 A：品牌残留门禁提示

`scripts/check-no-brand-residue.js` 的门禁词表按码点构造，覆盖**一个竞品品牌**的 7 种变体
（`BRAND_FULL` 全拼小写 8 字母、`BRAND_ZH` 中文 3 字、`BRAND_ABBR` 三字母缩写，各含首字母大写与全大写形态，
外加 `qianming.<BRAND_FULL>.cn` 签名服务主机名的豁免逻辑 —— 见该文件 `:47-73`）。

本文按需求**如实写出竞品名**（以便与 `D:\Data\projects\rea\analysis\` 各报告文件名一一对应、保持可追溯）。因此：

- 该门禁**会打红本文件** —— 这与 `AGENTS.md`「docs-only 快速通道保留门禁 ③ 品牌残留」一致；
- 本次**不擅自替换名词**，以免丢失与素材报告的可追溯对应关系；
- 若本文需作为 PR 落地，可选：① 定位为**内部只读取证文档**、不进 PR；② 按门禁口径把竞品名改写为「参考产品 A/B」；
  ③ 由人对该门禁做一次性裁决。

> 处置取向与 [RESEARCH-COMPETITOR-REVERSE-2026-10-13.md](RESEARCH-COMPETITOR-REVERSE-2026-10-13.md) §4.5 保持一致，
> 避免两份同轮文档在同一门禁上给出互相矛盾的口径。
