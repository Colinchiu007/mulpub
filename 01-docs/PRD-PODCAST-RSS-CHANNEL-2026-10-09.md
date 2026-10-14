# PRD：播客 RSS 频道发布（自动覆盖小宇宙收录）（podcast-rss-channel）

- 日期：2026-10-09
- 状态：v1.0（文档刀；共享引擎已实现，渲染层/IPC 为规划）
- 前置材料：`01-docs/INVESTIGATE-XIAOYUZHOU-PODCAST-2026-10-09.md`（调研报告，含 D1/D2/D3 三个架构决策的全部分析）
- 配套：`docs/adr/0008-podcast-rss-is-protocol-channel-not-platform.md`、`openspec/changes/podcast-rss-channel/`
- 单一真源：校验/生成引擎 `packages/shared-utils/src/podcast-rss.js`（CJS）与分发端目录 `packages/shared-utils/src/podcast-endpoints.json`（CJS `podcast-endpoints.js` / ESM `podcast-endpoints.browser.js` 双版本消费同一份 JSON）。**本文档所有字段、上限、校验码、常量逐项与该实现对齐**；契约夹具即 `packages/shared-utils/src/__tests__/podcast-rss.test.js`（25 例）与 `podcast-endpoints.test.js`（8 例）。

---

## 一、目标用户与核心价值

**目标用户**：用 mulpub 做内容生产的自媒体运营者，其中一部分人的内容形态是**播客（音频）**，希望"一键发布"覆盖小宇宙等播客端。

**核心价值**：把"发布到小宇宙"这个用户心智，落成一条**合规、稳定、全自动**的通道——mulpub 生成并维护一个标准的 Podcast RSS（iTunes RSS 2.0）频道，**首次收录在小宇宙 App 内人工提交一次 RSS 地址，此后每期新单集只需在 mulpub"发布"（= 向自家 feed 追加 `<item>` 并更新文件），由聚合端定时抓取自动出现**，同一份 feed 可同时分发到 Apple Podcasts、Spotify 等全部 RSS 型播客端（"一份 feed 多投"）。

**语义前提（必须写进所有相关界面文案的心智）**：小宇宙、Apple Podcasts、Spotify 是 **RSS 聚合端**，不是内容托管端；"发布到播客端"不存在逐期站内动作，它是**开放协议驱动的分发**。调研报告结论：小宇宙无官方开放平台/发布 API（官网仅主播后台，主播后台功能面为运营互动，无音频上传单集入口）。

## 二、非目标（明确不做什么）

1. **不做逆向写接口**。现证据只覆盖小宇宙读接口（验证码 token 的私有 API），写接口未发现；即便发现也属未授权访问、违反平台 ToS，账号与合规风险高（对齐本项目"聚合外部 API 先过判据再展示"的既有红线）。**明确排除。**
2. **不做主播后台 RPA**。主播后台不能发布单集，RPA 无法实现主流程；运营互动类自动化（公告/投票/改节目信息）价值低、页面改版脆弱性高，不进 MVP。
3. **不把 RSS 分发端登记为"可登录/可逐期发布的平台"**（D2/D3 决策）。分发端目录（`podcast-endpoints.json`）**不参与** `PLATFORM_LOGIN_URLS` / `PLATFORM_AUTH_HOSTS` / 会话 Cookie 标记 / 凭证采集 / `publish-capabilities.json` 的 titleMode 判定；`publishMode` 三态（`api-only|api-then-dom|dom-only`）**不新增 `rss` 第四态**——该闸回答的是"走 API 轨还是 DOM 轨、失败是否回退"，RSS 是另一种通道种类，硬塞会被 `rpa-view-manager.js` 的 `mode != null ? mode !== 'dom-only' : ...` 静默归入 API 轨（详见 ADR-0008 与调研报告 §九）。
4. **不进 MVP 的代托管**（D1 决策）。mulpub 自有桶代托管（形态 C）把产品定位改写成"播客托管服务商"，继承全部存储/带宽/审核/退出运维负担，且与既有免费托管生态正面竞争、毛利薄；仅满足 §四 P2 三前置条件后才启动。
5. **不实现音频处理**。转码、降噪、音量归一等音频后期能力不在本 PRD 范围；mulpub 只消费成品音频文件/外链。

## 三、托管形态分期（D1 决策落表)

| 分期 | 形态 | 状态 | 说明 |
| --- | --- | --- | --- |
| **P0（必答）** | A. 用户自带音频外链（零托管） | **已实现（2026-10-09 三刀落地：共享引擎 → 主进程持久化/IPC → 渲染层页面）** | mulpub 只做"外链 → RSS 生成/更新/自检"，不碰存储。零成本、零合规负担；自检工具（enclosure 可达、字段合规、XML 有效）对所有后续形态复用 |
| **P1（推荐落地形态）** | B. 用户自有 OSS/COS 直传，mulpub 代传代管 URL | **规则层已实现（2026-10-09，`apps/desktop/electron/services/podcast-hosting-upload.js` + 34 例回归锁）；主进程/IPC/渲染层接线未实现** | 已落地的是纯函数口径：托管配置资格判定（`validateHosting`，缺字段 fail-closed）、`object_key` 派生（禁止标题与路径穿越进公网 URL）、公网 URL 拼接（不得拼出 `bucket.bucket`）、OSS V1 待签串与签名头（**返回值不得含凭证**）、STS 形态的引擎 `uv` 形状、单对象 `putObject`（出站一律经注入 `httpClient`）。不接引擎分片上传链的原因见该文件头注（用户长期 AK 无 `securityToken`，签不出 `x-oss-security-token`）。仍未实现：托管配置落盘与加密（凭证入 credential-store 同源加密）、`podcast:hosting:*` IPC 通道、渲染层「选择本地文件 → 直传回填外链」入口 |
| **P2（条件后置）** | C. mulpub 代托管（自有桶，Pro 增值） | **规划，未启动** | 启动前置三条件，缺一不做：①能收费（绑 entitlement 配额：存储 GB + 抓取流量，定价覆盖云账单）；②可审核（机审 + 举报下架流程）；③可退出（用户 churn 后 feed 归属与迁移导出，避免断供把已收录账号打死） |

## 四、功能列表（P0/P1/P2，每项带可验证验收标准）

### P0 —— RSS 通道 MVP（形态 A）

| # | 功能 | 验收标准（可验证） |
| --- | --- | --- |
| F1 | 频道配置（表单 + 持久化） | 保存后重启应用数据不丢；必填缺失/超长/枚举非法时逐项显示 §六 校验码对应提示且定位到字段；合法频道可保存 |
| F2 | 单集管理（增删改 + 列表） | 新增/编辑/删除单集持久化；列表按 pubDate 倒序（与 feed 顺序一致）；同 guid（或无 guid 时同音频地址）重复保存**不产生第二条记录**（原地更新，见 §八.4 幂等） |
| F3 | feed 生成（`buildFeed`） | 校验不过 → 抛 `PODCAST_FEED_INVALID` 并携带 issues，**不产出/不覆盖 feed 文件**；校验通过 → 生成含 itunes/content 命名空间声明的 XML，单集按 pubDate 倒序、`<enclosure url/length/type>` 三属性齐全、时长为 `MM:SS`/`HH:MM:SS` 两档格式；产物可被 `parseFeed` 解析回同构字段（往返锁） |
| F4 | feed 自检（`verifyFeed`） | 无网络时（未注入 headImpl）仍可做结构检查（XML 声明/itunes 命名空间/单集数），且**引擎自身零出站请求**；注入 headImpl 后逐条 enclosure 产出 `ok/reason/status` 明细；不可达、类型不符、长度不符分别报 `ENCLOSURE_UNREACHABLE` / `ENCLOSURE_TYPE_MISMATCH` / `ENCLOSURE_LENGTH_MISMATCH` |
| F5 | 分发端目录与首次提交指引 | 目录固定含 `xiaoyuzhou`、`apple_podcasts`、`spotify` 三端（`ENDPOINT_ORDER` 精确等于该顺序）；小宇宙卡片显示「需在 App 内人工提交」「首次人工审核 1~7 天」「此后逐期零操作」；每个条目带 `verifiedAt` 取证日期与 `steps` 非空步骤列表；「复制 RSS 地址」一键复制 feed 公网地址；web 端提交链接绑定前必须过 `podcastEndpointHref()`（共享 https 判据） |
| F6 | 平台契约面隔离（防回归） | `podcast-endpoints.test.js` 断言：分发端 id 不出现在 `PLATFORM_LOGIN_URLS`/`PLATFORM_NAMES`/`PLATFORM_PUBLISH_META`/`PLATFORM_SESSION_COOKIE_MARKERS`/`PLATFORM_AUTH_HOSTS`；`PLATFORM_NAMES` 与 `PLATFORM_PUBLISH_META` 平台数保持 **15** 不变 |

### P1 —— 用户自有 OSS/COS 直传（形态 B：规则层已实现，服务/IPC/UI 接线未实现）

| # | 功能 | 验收标准 |
| --- | --- | --- |
| F7 | 托管配置（用户 AK/bucket/endpoint/前缀） | 凭证落 credential-store（AES-256-GCM），日志与错误消息不出现 AK/Secret 明文；AK 必填校验缺失时 fail-closed 提示 |
| F8 | 单集音频直传 | 本地音频文件选择后自动分片上传，成功后把公网 URL 回填该单集（`resolvedAudioUrl` 语义，见 §五.2），失败的单集不写 URL、状态如实报错；上传成功前该单集不得进入"可生成 feed"状态 |
| F9 | 外链失效预警 | 定期（或手动触发）对全部单集 enclosure 跑 `verifyFeed`，出现 `ENCLOSURE_UNREACHABLE` 时在界面点名具体单集 |

> **F7–F9 实现状态（2026-10-09）**：F7/F8 的**判定与签名口径**已在规则层落地并有回归锁（`podcast-hosting-upload.test.js`，34 例），F7 的"凭证落 credential-store + AES-256-GCM"与 F8 的"服务编排 + 回填 `resolvedAudioUrl` + UI 入口"**仍未实现**；F9 已被 P0 的 `podcast:feed:verify` 部分满足（手动触发出 `checks[]` 明细，含逐条 reason），**定期自动复检未实现**。另记一条与 F8 原文的口径偏差：长期 AK 形态走**单对象 PUT**（`putObject`）而非"自动分片上传"，只有用户给出 `securityToken`（STS 形态）时才改走引擎 `ossUploader` 的分片链——原因见 `podcast-hosting-upload.js` 头注（引擎签法固定拼 `x-oss-security-token`）。

### P2 —— 代托管（形态 C，规划，未启动）

仅当 §三 三前置条件全部闭合后另立 PRD；本文档不展开设计。

## 五、数据模型

> 字段名、默认值、上限与 `podcast-rss.js` 逐项对齐。引擎为纯函数、不落盘：下表是「消费方（主进程服务/IPC）持久化的频道/单集对象」的契约形状。

### 5.1 引擎常量（单一真源，消费方禁止另抄一份数值）

| 常量 | 值 | 语义 |
| --- | --- | --- |
| `TITLE_MAX` | 255 | 频道/单集标题上限（字符数，按 `String.length`） |
| `SUMMARY_MAX` | 4000 | 频道简介/单集简介上限 |
| `SUBTITLE_MAX` | 120 | 频道/单集副标题上限 |
| `DURATION_MAX_SEC` | 86400（24h） | 单集时长整数秒上限 |
| `ITEMS_MAX` | 1000 | feed 单集数上限 |
| `COVER_MIN_PX` / `COVER_MAX_PX` | 1400 / 3000 | 封面边长区间（正方形） |
| `EXPLICIT_VALUES` | `yes` / `no` / `clean` | 分级枚举（频道与单集共用） |
| `EPISODE_TYPE_VALUES` | `full` / `trailer` / `bonus` | 单集类型枚举 |
| `EPISODE_FEED_TYPE_VALUES` | `episodic` / `serial` | 频道 feed 类型枚举 |
| `AUDIO_MIME_VALUES` | `audio/mpeg` `audio/mp4` `audio/x-m4a` `audio/aac` `audio/ogg` `audio/wav` | 单集 MIME 白名单（显式声明时校验） |
| `LANGUAGE_RE` | `/^[a-z]{2}(-[A-Z]{2})?$/` | 语言形如 `zh-CN` / `en-US`（裸 `zh` 亦合法） |
| `EMAIL_RE` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` | 所有者邮箱格式 |
| `ITUNES_CATEGORIES` | 18 个顶级分类（The Arts、Business、Comedy、Education、Fiction、Government、Health & Fitness、History、Kids & Family、Leisure、Music、News Politics、Religion & Spirituality、Science、Society Culture、Sports、Technology、True Crime）及各子分类 | 分类白名单；字符串形如「顶级/子级」最多两级（顶级名按该表逐字，其中 `News Politics`、`Society Culture` 为本实现顶级键的既成写法） |

### 5.2 频道字段表

| 字段 | 类型 | 必填 | 上限/规格 | 语义 | feed 落点（buildFeed） |
| --- | --- | --- | --- | --- | --- |
| `title` | string | ✅ | ≤255 | 节目名 | `<title>`（转义） |
| `description` | string | ✅ | ≤4000 | 频道简介 | `<description>` |
| `subtitle` | string | — | ≤120 | 副标题（可选，非空才产出） | `<itunes:subtitle>` |
| `language` | string | — | 默认 `zh-CN`；`LANGUAGE_RE` | 语言 | `<language>` |
| `coverUrl` | string | ✅ | https 绝对地址（协议判据见 §六.0） | 频道封面（正方形 1400~3000px） | `<itunes:image href>` 与 `<image><url>` |
| `coverSize` | string | 条件必填 | 形如 `3000x3000`（`[xX]` 与空格均可），必须正方形且边长在 1400~3000 | 封面尺寸声明，供校验 | 不进 feed，仅校验面 |
| `link` | string | — | 非空时必须 https 绝对地址 | 节目站点 | `<link>`；缺省时按 `link → siteUrl → 'https://example.com/'` 兜底链取第一个合法 https 值（**兜底占位是引擎既有行为**，界面应引导用户填真实站点） |
| `siteUrl` | string | — | 校验层**不校验**该字段；仅在 `link` 缺席时由构建层按其 https 值兜底 | 站点备用字段 | 见 `link` |
| `author` | string | ✅ | 非空（代码无长度上限，如实按实现） | 作者/主播名 | `<itunes:author>` |
| `ownerName` | string | — | — | 所有者显示名 | `<itunes:owner><itunes:name>`，缺省回落 `author` |
| `ownerEmail` | string | ✅ | `EMAIL_RE` | 所有者邮箱（聚合端联系用；会**公开**出现在 feed 中，界面须提示隐私含义） | `<itunes:email>` |
| `explicit` | enum | — | `yes/no/clean`；构建默认 `no` | 频道分级 | `<itunes:explicit>` |
| `feedType` | enum | — | `episodic/serial`；默认 `episodic` | 节目叙事型别 | `<itunes:type>` |
| `categoryId` | string | ✅ | 「顶级」或「顶级/子级」，最多两级，白名单 `ITUNES_CATEGORIES` | 播客分类 | `<itunes:category text>` 嵌套两级或单级 |

### 5.3 单集字段表

| 字段 | 类型 | 必填 | 上限/规格 | 语义 | feed 落点（buildItem） |
| --- | --- | --- | --- | --- | --- |
| `title` | string | ✅ | ≤255 | 单集标题 | `<title>` |
| `description` | string | — | ≤4000 | 节目简介/show notes 纯文本 | `<description>` |
| `subtitle` | string | — | ≤120 | 单集副标题（非空才产出） | `<itunes:subtitle>` |
| `htmlContent` | string | — | 校验层**不设限**（按实现如实） | show notes 富文本（写入前仍整体转义） | `<content:encoded>` |
| `audioUrl` | string | 三选一 | https 绝对地址 | 用户自带外链（P0 形态 A） | `<enclosure url>` |
| `resolvedAudioUrl` | string | 三选一 | https 绝对地址 | 托管直传回填的解析后 URL（P1 形态 B 落点；优先级低于 `audioUrl`，见 §六.3 enclosure 解析序） | `<enclosure url>` |
| `localFilePath` | string | 三选一 | 本机路径 | 仅本地文件、托管未配置时的诊断线索（**永远不会进 feed**，只用于产出 `EPISODE_HOSTING_NOT_CONFIGURED` 引导） | 不产出 |
| `durationSec` | integer | ✅ | 1~86400 | 音频时长（秒） | `<itunes:duration>`，格式 `MM:SS`（不足一小时）/`HH:MM:SS` |
| `sizeBytes` | integer | ✅ | ≥1 正整数 | enclosure `length` 声明（聚合端断点续传与缓存依据） | `<enclosure length>`；缺失即 `EPISODE_SIZE_REQUIRED` |
| `mime` | enum | — | `AUDIO_MIME_VALUES`；未显式声明时按音频 URL **pathname 扩展名**派生（`.m4a/.aac/.ogg/.wav/.mp4` 对应类型，其余/无法解析一律 `audio/mpeg`；URL 查询串不参与派生） | 音频类型 | `<enclosure type>` |
| `guid` | string | — | ≤500 字符 | 全局唯一标识（幂等/判重主键，§八.4） | `<guid isPermaLink="false">`；缺省= enclosure URL；`trim` 后为纯空白视同缺省（与判重键同口径，绝不产出空 `<guid></guid>`；回归锁 `podcast-rss.test.js`「guid 为纯空白时与校验侧同口径视为缺省，回落 enclosure URL（QM-6 W2 回归）」） |
| `pubDate` | date/string | — | 可被 `new Date()` 解析；缺省=构建时刻 | 发布时间（排序键） | `<pubDate>` RFC-2822 GMT |
| `number` | integer | — | ≥1 | 期号 | `<itunes:episode>` |
| `season` | integer | — | ≥1 | 季号 | `<itunes:season>` |
| `coverUrl` | string | — | 非空时必须 https 绝对地址 | 单集封面 | `<itunes:image href>` |
| `explicit` | enum | — | `yes/no/clean` | 单集分级 | `<itunes:explicit>` |
| `episodeType` | enum | — | `full/trailer/bonus` | 单集类型 | `<itunes:episodeType>` |

列表级约束：单集数 ≥1（否则 `EPISODES_EMPTY`）、≤1000（`EPISODES_TOO_MANY`）；判重键 `trim(guid || audioUrl || resolvedAudioUrl)` 非空且唯一（重复 `EPISODE_DUPLICATE`）；构建序按 `pubDate` 倒序，频道级 `<pubDate>` 取最新一期。

## 六、数据校验（引擎校验码全量表）

### 6.0 协议判据（所有 URL 字段共用）

`isHttpsUrl()` = 先过共享协议白名单 `safeHttpUrl`（`packages/shared-utils/src/safe-http-url.js`，禁止第二份 `/^https?:/`），再要求解析后 `protocol === 'https:'`。即：`http://`、`//host`（协议相对）、`example.com`（缺协议）、`javascript:` 一律拒绝。**理由**：聚合端普遍要求 https 源；且外链是渲染层可点击锚点的上游，协议白名单只在一处实现。

### 6.1 fail-closed 语义

- `buildFeed()` 先跑 `validateFeed(频道+单集列表)`，**任一 issue 即抛异常** `err.code = 'PODCAST_FEED_INVALID'`，`err.issues` 携带全量校验码列表；**不产出任何文件**。禁止产出"看似成功但平台不收录"的 feed。
- `validateChannel` / `validateEpisode` / `validateEpisodeList` / `validateFeed` 单独调用时不抛错，返回 `{ok, issues}`——**保存草稿**走这个非阻断口径（允许半成品持久化），**生成 feed** 走 fail-closed 口径。
- `verifyFeed()` 属**自检/运维**口径：不阻断生成（feed 已是产物），逐 enclosure 输出 `checks[]`（`{url, ok, reason, status}`）。引擎自身不发网络请求，`headImpl` 由消费方注入；未注入时只做结构检查、`checks` 为空数组。

### 6.2 校验码表——频道（全部阻断生成 feed）

| 码名 | 触发条件（按实现逐字） | 用户提示建议（引擎中文原文为 zh 底稿） | 前端展示位置 | 阻断生成 |
| --- | --- | --- | --- | --- |
| `CHANNEL_MISSING` | 频道对象不存在/非对象 | 频道配置缺失 | 页面顶部错误条 | ✅ |
| `CHANNEL_TITLE_REQUIRED` | `title` 去空白后为空 | 频道标题不能为空 | 字段内联 | ✅ |
| `CHANNEL_TITLE_TOO_LONG` | `title` > 255 | 频道标题不得超过 255 字符 | 字段内联 | ✅ |
| `CHANNEL_DESC_REQUIRED` | `description` 为空 | 频道简介不能为空 | 字段内联 | ✅ |
| `CHANNEL_DESC_TOO_LONG` | `description` > 4000 | 频道简介不得超过 4000 字符 | 字段内联 | ✅ |
| `CHANNEL_SUBTITLE_TOO_LONG` | `subtitle` > 120 | 副标题不得超过 120 字符 | 字段内联 | ✅ |
| `CHANNEL_LANGUAGE_INVALID` | 不匹配 `LANGUAGE_RE` | 语言需形如 zh-CN / en-US | 字段内联 | ✅ |
| `CHANNEL_COVER_REQUIRED` | `coverUrl` 缺失 | 封面地址不能为空 | 字段内联 | ✅ |
| `CHANNEL_COVER_NOT_HTTPS` | `coverUrl` 非 https 绝对地址 | 封面必须是 https 绝对地址 | 字段内联 | ✅ |
| `CHANNEL_COVER_SIZE_UNKNOWN` | 封面合法但 `coverSize` 无法解析成 WxH | 封面尺寸需形如 3000x3000 以便校验 | 字段内联 | ✅ |
| `CHANNEL_COVER_NOT_SQUARE` | 宽高不等 | 封面必须为正方形 | 字段内联 | ✅ |
| `CHANNEL_COVER_SIZE_OUT_OF_RANGE` | 边长 <1400 或 >3000 | 封面边长须在 1400~3000 之间 | 字段内联 | ✅ |
| `CHANNEL_LINK_NOT_HTTPS` | `link` 非空且非 https 绝对地址 | 站点地址必须是 https 绝对地址 | 字段内联 | ✅ |
| `CHANNEL_AUTHOR_REQUIRED` | `author` 为空 | 作者/主播名不能为空 | 字段内联 | ✅ |
| `CHANNEL_OWNER_EMAIL_INVALID` | `ownerEmail` 不匹配 `EMAIL_RE` | 所有者邮箱格式非法 | 字段内联 | ✅ |
| `CHANNEL_EXPLICIT_INVALID` | 非空且 ∉ `yes/no/clean` | 分级取值须为 yes/no/clean | 字段内联 | ✅ |
| `CHANNEL_FEED_TYPE_INVALID` | 非空且 ∉ `episodic/serial` | feed 类型取值须为 episodic/serial | 字段内联 | ✅ |
| `CHANNEL_CATEGORY_REQUIRED` | `categoryId` 为空 | 播客分类不能为空 | 字段内联 | ✅ |
| `CHANNEL_CATEGORY_UNKNOWN` | 顶级名不在 `ITUNES_CATEGORIES` | 未知顶级分类「{top}」 | 字段内联 | ✅ |
| `CHANNEL_SUBCATEGORY_UNKNOWN` | 子级不在该顶级子表 | 「{top}」下不存在子分类「{sub}」 | 字段内联 | ✅ |
| `CHANNEL_CATEGORY_TOO_DEEP` | 「顶级/子级/」之后还有第三级 | 分类最多两级 | 字段内联 | ✅ |

### 6.3 校验码表——单集（全部阻断生成 feed）

enclosure 解析序（`resolveEnclosure`）：`audioUrl` → `resolvedAudioUrl` → `localFilePath`（有则报托管未配置）→ 都没有报必填缺失。

**产出口径必须与校验口径同序（QM-6 Critical 回归锁）**：`buildItem` 产出 `<enclosure url>` 与 guid 缺省回落时取 `audioUrl || resolvedAudioUrl`，优先级与 `resolveEnclosure` 逐字一致。若两处漂移（如产出侧 `resolvedAudioUrl` 优先），会出现「校验全绿、feed 里却是 http/非法地址」的病态载荷——聚合端直接拒收。回归锁：`packages/shared-utils/src/__tests__/podcast-rss.test.js`「audioUrl 与 resolvedAudioUrl 共存时 enclosure 取 audioUrl——与校验侧 resolveEnclosure 同优先级（QM-6 Critical 回归）」（`resolvedAudioUrl` 为 `http://`、`audioUrl` 为合法 https 时，`validateFeed` 通过且 feed 内 enclosure 必须是那条 https）。

| 码名 | 触发条件 | 用户提示建议 | 前端展示位置 | 阻断生成 |
| --- | --- | --- | --- | --- |
| `EPISODE_MISSING` | 单集对象不存在/非对象 | 单集数据缺失 | 该单集行/顶部错误条 | ✅ |
| `EPISODE_TITLE_REQUIRED` / `EPISODE_TITLE_TOO_LONG` | 标题空 / >255 | 单集标题不能为空 / 不得超过 255 字符 | 字段内联 | ✅ |
| `EPISODE_DESC_TOO_LONG` | 简介 > 4000 | 节目简介不得超过 4000 字符 | 字段内联 | ✅ |
| `EPISODE_SUBTITLE_TOO_LONG` | 副标题 > 120 | 副标题不得超过 120 字符 | 字段内联 | ✅ |
| `EPISODE_AUDIO_REQUIRED` | 三个 URL/路径字段全空 | 请填写音频外链地址 | 字段内联 | ✅ |
| `EPISODE_AUDIO_NOT_HTTPS` | `audioUrl`/`resolvedAudioUrl` 存在但非 https | 音频必须是 https 绝对地址 | 字段内联 | ✅ |
| `EPISODE_HOSTING_NOT_CONFIGURED` | 仅有 `localFilePath`、无外链 | 仅有本地文件，须先配置托管直传或填写外链 | 字段内联 + 引导跳转托管配置区块 | ✅ |
| `EPISODE_DURATION_INVALID` | 非整数秒 / <1 / >86400 | 时长须为 1~86400 的整数秒 | 字段内联 | ✅ |
| `EPISODE_SIZE_REQUIRED` | `sizeBytes` 缺失 | enclosure 必须声明 length（字节数） | 字段内联 | ✅ |
| `EPISODE_SIZE_INVALID` | `sizeBytes` 非正整数 | 字节数须为正整数 | 字段内联 | ✅ |
| `EPISODE_EXPLICIT_INVALID` | 分级 ∉ 枚举 | 分级取值须为 yes/no/clean | 字段内联 | ✅ |
| `EPISODE_TYPE_INVALID` | 类型 ∉ `full/trailer/bonus` | 类型取值须为 full/trailer/bonus | 字段内联 | ✅ |
| `EPISODE_PUBDATE_INVALID` | `pubDate` 无法解析 | 发布时间无法解析 | 字段内联 | ✅ |
| `EPISODE_COVER_NOT_HTTPS` | 单集封面非 https | 单集封面必须是 https 绝对地址 | 字段内联 | ✅ |
| `EPISODE_MIME_INVALID` | 显式 `mime` ∉ 白名单 | 音频 MIME 须为白名单六值 | 字段内联 | ✅ |
| `EPISODE_GUID_TOO_LONG` | `guid` > 500 | guid 不得超过 500 字符 | 字段内联 | ✅ |
| `EPISODE_NUMBER_INVALID` / `EPISODE_SEASON_INVALID` | 期号/季号非正整数 | 期号须为正整数 / 季号须为正整数 | 字段内联 | ✅ |
| `EPISODES_EMPTY` | 单集列表空 | feed 至少需要一个单集 | 单集区块空态 | ✅ |
| `EPISODES_TOO_MANY` | 单集数 > 1000 | 单集数不得超过 1000 | 单集区块顶部 | ✅ |
| `EPISODE_DUPLICATE` | 判重键 `trim(guid||audioUrl||resolvedAudioUrl)` 非空且重复 | 存在重复的 guid/音频地址 | 冲突单集行 | ✅ |

### 6.4 校验码表——feed 自检（verifyFeed，不阻断生成、属运维预警）

| 码名 | 触发条件 | 用户提示建议 | 前端展示位置 | 阻断生成 |
| --- | --- | --- | --- | --- |
| `FEED_NO_ITEMS` | 解析后 `<item>` 数为 0 | feed 中没有任何单集 | 自检结果面板 | ❌（产物级检查） |
| `FEED_MISSING_ITUNES_NS` | XML 缺 `xmlns:itunes=` | 缺少 itunes 命名空间 | 自检结果面板 | ❌ |
| `FEED_MISSING_XML_DECL` | 前 64 字符不以 XML 声明开头（允许 BOM 前缀） | 缺少 XML 声明 | 自检结果面板 | ❌ |
| `ENCLOSURE_MISSING` | 某 `<item>` 无 enclosure 元素 | 存在没有 enclosure 的单集 | 逐条明细 | ❌ |
| `ENCLOSURE_NOT_HTTPS` | enclosure url 非 https | 存在非 https 的 enclosure | 逐条明细 | ❌ |
| `ENCLOSURE_UNREACHABLE` | head 状态码非整数（含网络异常→status null）或 ≥400 | 有 enclosure 不可达（含状态码） | 逐条明细 + 单集行标红 | ❌ |
| `ENCLOSURE_TYPE_MISMATCH` | 响应 `contentType` 既非 `audio/*` 也非 `application/octet-stream` | enclosure 指向的资源不是音频 | 逐条明细 | ❌ |
| `ENCLOSURE_LENGTH_MISMATCH` | 声明 length 与响应 `contentLength` 数值不等 | 声明的 length 与实际字节数不一致 | 逐条明细 | ❌ |
| `DURATION_MISSING` | enclosure 可达且类型/长度均吻合，但该 item 无时长（`buildFeed` 产物必有时长，此码主要面向**导入的外部 feed**） | 单集缺少时长 | 逐条明细 | ❌ |

注：`ENCLOSURE_UNREACHABLE` 的既有实现消息按**逐个不可达条目各追加一条**（消息内计数固定写 1），界面汇总显示时以 `checks[]` 明细为准，不重复渲染同一句。

## 七、流程

### 7.1 首次接入时序（文字版）

```
[用户/mulpub]                                        [小宇宙等聚合端]
1 配频道（F1）→ 2 加单集（F2，外链或托管回填 URL）
3 生成 feed（F3：校验 fail-closed → 落盘 feed.xml，见 §八.2）
4 使 feed 公网可达（用户自行把 feed.xml 部署到 https 可访问位置；
   对每条 enclosure 跑自检 F4：可达、类型、length 一致）
5 首次收录——人工、一次性：在小宇宙 App「我的 → 播客投稿/创建节目」
   粘贴 mulpub 提供的 RSS 地址提交
                         └─→ [人工审核收录，通常 1~7 天，期间不得变更 feed 地址]
6 聚合端定时抓取 RSS → 频道与全部单集出现在小宇宙
7 此后逐期：mulpub「发布单集」= 追加 <item> 并重建 feed（§7.2）
                         └─→ 聚合端下一轮抓取自动出现新单集（小时级延迟）
     （Apple Podcasts / Spotify 用同一 RSS 地址在各自网页端提交一次，见分发端目录）
```

- 步骤 5 **无 web 表单证据**（调研结论），产品上不承诺代提交，只做"提交指引 + 一键复制 RSS 地址"。
- 分发端目录（`podcast-endpoints.json`）逐端承载：提交方式（`submitChannel: app|web`）、提交入口（web 端 `submitUrl`，app 端为 null）、`requiresManualFirstSubmit: true`、审核时效 `timing`、步骤 `steps`、取证日期 `verifiedAt`（界面须显示"以对方后台当日实况为准"）。

### 7.2 「单集发布 = 追加 item 并更新 feed」的判定与验收口径

- **动作定义**：向频道追加一条合法单集 → 校验通过 → 重建全量 feed（物理实现是**整体覆盖**——`buildFeed` 输出完整 XML，逻辑语义才是"追加"）。
- **验收主判据 = "RSS 生效"**：重建后的 feed 文件中出现该 `<item>`（guid 命中），且 `verifyFeed` 对该条 enclosure 判 `ok:true`。这是可控、可自动化的部分。
- **小宇宙侧展示 = 人工核对项**：聚合端抓取存在小时级延迟、且首收录含人工审核（1~7 天），**不得**把"小宇宙页面出现新单集"做成自动化验收断言；界面如实提示延迟量级（目录 `timing` 字段）。
- **失败定义**：校验不过（抛 `PODCAST_FEED_INVALID`，feed 未变更）或自检发现 enclosure 不可达（feed 已更新但需修复外链）——两者分开提示，前者"未发布"，后者"已发布但有集在聚合端侧会缺失，请修复外链后重新自检"。

## 八、功能逻辑

### 8.1 IPC 合同表

> **状态：已实现（2026-10-09 主进程刀）**，下表即运行中的合同；唯一权威实现同步见 `apps/desktop/electron/ipc-handlers/podcast.js` 文件头「通道合同」。命名沿用既有 `域:对象:动作` 风格（如 `account:check-login`）。**响应信封为 `{ code, data }`，成功恒 `code: 0`**；失败为 `{ code: EC.*, message, issues? }`（`EC` 取自 `electron/core/error-codes`），校验类失败必须携带 `issues[]`（元素形状即引擎 `{code, field, message}`），**不回传用户未发布的标题原文、音频地址查询串与 xml 正文**。渲染层参数为纯 JSON（IPC 序列化约束，响应式对象先 `JSON.parse(JSON.stringify())` 脱壳）。入参同时接受「对象本体」与 `{ <key>: 对象 }` 两种载荷形状（`unwrapObject` 只判形状，字段校验唯一实现在引擎）。

| 通道 | 请求 | 成功响应 | 错误/失败 |
| --- | --- | --- | --- |
| `podcast:channel:get` | 无参 | `{code:0, data:{channel}}`（未配置时 `channel:null`） | 读盘失败 `{code:EC.REQUEST_ERROR, message}`；存储损坏 `PODCAST_STORE_CORRUPT` |
| `podcast:channel:save` | 频道对象（或 `{channel:{…}}`） | `{code:0, data:{channel}}`（允许半成品，非 fail-closed） | 字段级 `{code:EC.VALIDATION_ERROR, message, issues}`（口径= `validateChannel`） |
| `podcast:episode:list` | 无参 | `{code:0, data:{episodes}}`（按 pubDate 倒序，与 feed 一致；总数由渲染层取 `episodes.length`） | 同上读盘/损坏码 |
| `podcast:episode:save` | 单集对象（可含 guid） | `{code:0, data:{episode}}`；命中既有判重键=**原地更新**（保留原创建时间） | `{code:EC.VALIDATION_ERROR, message, issues}`（口径= `validateEpisode`；判重冲突按 `EPISODE_DUPLICATE`） |
| `podcast:episode:remove` | `{guid}` | `{code:0, data:{removed}}` | guid 缺失 → `{code:EC.NOT_FOUND, message}` |
| `podcast:feed:build` | 无参（以已保存频道+列表为源） | `{code:0, data:{path, itemCount, bytes}}`；**校验不过不得写文件** | `{code:EC.VALIDATION_ERROR, message, issues}`（引擎原样透传 `err.issues`，`code:'PODCAST_FEED_INVALID'` 在 issues 内） |
| `podcast:feed:verify` | 无参（或 `{xml?}` 校验外部 feed） | `{code:0, data:{issues, checks, itemCount}}`（`headImpl` 由调用方显式注入；结构检查始终做、可达检查仅在注入时做） | 网络异常**不是** IPC 错误：逐条落 `checks[].reason='ENCLOSURE_UNREACHABLE'` |
| `podcast:endpoints:list` | 无参 | `{code:0, data:{endpoints}}`（`listPodcastEndpoints()` 原样，目录顺序即 `['xiaoyuzhou','apple_podcasts','spotify']`；提交链接渲染前走 `podcastEndpointHref()`） | `{code:EC.REQUEST_ERROR, message}` |

### 8.2 feed 文件落盘位置与覆盖策略（已实现，2026-10-09 主进程刀）

- 落盘位置：`<userData>/podcast/` 下三份文件——`channel.json`（频道，单频道不设 channelId 子目录）、`episodes.json`（单集列表）、`feed.xml`（构建产物）；引擎为纯函数不落盘，写文件由主进程 `podcast-channel-service.js` 负责（目录常量与文件名由 `module.exports.PODCAST_FILES` 单点导出，消费方禁止另抄路径）。
- **覆盖策略**：每次 `podcast:feed:build` 校验通过后**整体覆盖**写入（逻辑"追加 item"= 全量重建）；写入采用临时文件 + 原子 rename（对齐本仓 Windows 原子替换门禁：仅 `EPERM/EACCES/EBUSY` 有界退避重试，其余原样抛出）。
- 校验不过：不产出、不覆盖、保留上一版 feed 并在返回值里透传 `issues`。
- feed 是**要公网可达的产物**：mulpub 是桌面应用，落盘文件本身不公网可达——产品路径为 P0 引导用户把 feed 部署到可访问处（或由 P1 直传一并上传 feed.xml，具体机制属 P1 设计，见开放问题 O3）。

### 8.3 渲染层数据流

- 页面状态唯一承载 `src/composables/usePodcastChannel.js`（组合式函数；本仓未用 Pinia 承载该页状态，与既有页面组合式先例保持一致）：频道、单集列表、自检结果、目录四类状态一处持有，页面组件只做渲染与事件转发；分发端目录**不新建第二份文案**——渲染端经该 composable import `podcast-endpoints.browser.js`（ESM 孪生，读同一 JSON），parity 由测试锁。
- `submitUrl`/`docUrl` 等一切外部 URL 绑定 `<a :href>` 前必须过共享协议判据（`podcastEndpointHref` / `safeHttpUrl`），`target="_blank"` 必带 `rel="noopener"`。

### 8.4 幂等语义（同内容重复保存不产生重复单集）

- **判重键 = `guid`；无 guid 时退化为音频地址（`audioUrl || resolvedAudioUrl`）**，与引擎 `EPISODE_DUPLICATE` 的键完全同式（`trim` 后非空）。
- 保存层：命中既有键 → **原地更新该条**（保留原创建时间），不新增行——因此"同一集误点两次保存"与"直传重传同文件回填同 URL"都不产生重复 item。
- 引擎层兜底：任何绕过保存层的写入路径（如导入外部 feed）在生成 feed 时仍会被 `EPISODE_DUPLICATE` fail-closed 拦截。
- guid 缺省时 feed 中以 enclosure URL 作 `<guid>` 输出（`isPermaLink="false"`）——外链即幂等标识，符合"同 URL 同内容"直觉。

### 8.5 与既有发布面的边界（负面合同）

- 不进入 `config/platforms.yaml` 平台段、不进入 DOM RPA `platform-selectors`、不进入 api-publish-engine 平台适配器注册表、不进入 `publish-capabilities.json`（15 平台完整性断言不变）。
- `publishMode` 三态值域保持不变（唯一真源 `packages/api-publish-engine/src/publish/core/publish-mode.js` 的 `MODES`）；任何 `rss` 裸值写进 yaml 属配置错误，**实际收口点在路由决策**：`api-router.decideRoute` 先经 `normalizeMode` 归一，非法值抛 `/unknown publishMode/` fail-closed（`config-loader` 侧不另加第二份枚举校验，避免口径分裂）。回归锁：`packages/api-publish-engine/test/publish-mode-config.test.js`「ADR-0008 正交闸」describe——断言 `MODES` 值域恰为三态、`normalizeMode('rss')` 与 `decideRoute({mode:'rss'})` 均抛错、`platforms.yaml` 键集不含任何分发端 id。
- 发布历史/发布进度事件：P0 不接入 `publish:progress` 相位枚举（feed 生成是本地动作，非平台任务）；是否把"feed 更新成功/失败"接入终态属实现刀架构评审事项（若接入，`PHASE_ENUM`/`TERMINAL_PHASES` 三处同步为既有纪律）。

## 九、交互逻辑

页面「播客频道」三区块（已实现，2026-10-09 渲染层刀；下述为规范，实现偏差见 §9.1）：

**A. 频道配置区**：表单字段=§5.2；【保存】随时可用（半成品允许），保存被校验拒绝时 §6.2 issues 以**区块下方逐条清单**渲染（`podcast-channel-save-issues`，每条 `issueText` 文案 + `<code>field</code>` 定位字段，保存成功即清空；B 区单集表单同口径 `podcast-episode-save-issues`；回归锁 `PodcastChannelView.test.js`「保存频道校验失败：逐项展示引擎 issues 并定位字段，不得只有通用码（QM-6 W4 / F1 验收）」）；封面尺寸输入框旁实时显示校验结果（正方形/1400~3000/无法解析三态）；`ownerEmail` 字段下固定提示「该邮箱会公开出现在 RSS 订阅源中（写入 itunes:email），聚合端与订阅者均可见。」（`podcast-owner-email-privacy-hint`，文案唯一实现 zh/en 成对，见 §11.1）。

**B. 单集列表区**：倒序列表（期号/标题/时长/体积/发布日期/外链状态徽标）；【添加单集】打开表单：音频来源二选一「粘贴外链 / 选择本地文件（P0 提示需先有外链，P1 走直传）」；外链失焦即做 https 协议判据预检；【保存】走 `podcast:episode:save`（幂等语义）；【删除】需确认弹窗；体积人类可读（KB/MB/GB，渲染层格式化，`sizeBytes` 原值持久化）；时长 `HH:MM:SS`/`MM:SS`（与引擎 `formatDuration` 同口径，禁止第二份实现）。

**C. RSS 输出与分发端指引区**：
- 【生成/更新 feed】：进行中按钮 loading；失败 → 面板顶部错误条 + issues 逐条列表，**每条可点击定位到 A/B 区对应字段**；成功 → 显示单集数与生成时刻。
- 【自检 feed】：进度按 enclosure 逐条出 `checks[]` 明细（可达 ✓/状态码/类型不符/长度不符）；网络异常按"本轮无结论（不可达）"如实显示，不重试冒充成功。
- 【复制 RSS 地址】：复制 feed 公网地址；feed 尚未部署公网可达时按钮禁用并提示原因（不得复制一个不可达地址冒充成功）。
- **提交指引卡片**（每分发端一张，按 `ENDPOINT_ORDER`）：端名、提交方式徽标（App 内 / 网页）、`requiresManualFirstSubmit:true` → 固定文案「首次收录需人工提交，mulpub 无法代提交」、`timing` 审核时效原文、`steps` 步骤逐条编号展示、web 端提供过判据的提交入口链接、`verifiedAt` + 「以对方后台当日实况为准」。
- 未配置托管（存在仅 `localFilePath` 的单集）：生成 feed 会被 `EPISODE_HOSTING_NOT_CONFIGURED` 拦截 → 界面把该单集标红并给出两条引导路径「填写音频外链」/「配置对象存储直传（P1，即将上线）」。
- 取消：feed 生成与自检为本地/短网络动作，不提供取消按钮，按钮置灰防重复点击即可；删除单集/清空频道等破坏性动作必须确认弹窗。

### 9.1 实现偏差（2026-10-09 渲染层刀实测，逐条如实记录）

| 规范条目 | 实现现状 | 处置 |
| --- | --- | --- |
| A 区封面尺寸输入框旁「实时」显示正方形/1400~3000/无法解析三态 | 只有输入框与占位提示（`podcast-field-cover-size`），三态判定只在保存/生成 feed 时经 `validateChannel` 以 issues 形式回显，无输入即时提示 | 保留为 P1 体验项；不改判定口径（判定仍只有引擎一份） |
| C 区 issues「每条可点击定位到 A/B 区对应字段」 | issues 以纯文本列表渲染（`podcast-issue`），不可点击 | 保留为 P1 体验项 |
| C 区【复制 RSS 地址】复制公网地址、未部署时禁用 | 按钮复制的是**本地 feed 文件路径**（`podcast-feed-copy` → `onCopyFeedPath`），失败时 `podcast.publish.copyFailed` 提示；无「公网地址」概念 | 与 O3（feed 公网可达机制属 P1）一致：P0 无公网地址可复制，故复制本地路径而非禁用一个空按钮；文案已按「复制路径」写，不冒充「RSS 地址」 |
| B 区【删除】需确认弹窗 | 行内二次确认（`podcast-episode-delete-confirm-text` + yes/no 两个按钮），非模态弹窗 | 等价满足「破坏性动作必须确认」；不接入浮层挂起合同（`overlay view suspension`）正是因为不是模态浮层 |
| 音频来源「选择本地文件」入口 | P0 仅提供外链输入；本地文件与直传入口未渲染 | 与 §四 P0 范围一致，非偏差 |
| §6.2/§6.3 表「前端展示位置：字段内联」 | issues 渲染在**区块下方的逐条清单**（每条带 `<code>field</code>` 指明字段），非输入框正下方的内联提示 | 口径统一说明：「字段内联」按「逐条列出并指明所属字段」理解；判定仍只有引擎一份，渲染层只做 `issueText` 文案映射，不产生第二份校验 |
| 提交入口链接判据取用点（QM-6 Info） | 视图层直接调共享判据 `safeHttpUrl(ep.submitUrl)`，未包一层 `podcastEndpointHref(ep.id)` | 两者**同一唯一实现**（`podcastEndpointHref` 内部即 `safeHttpUrl(submitUrl)`，目录侧包装），协议口径无分裂；`docUrl` 本就只能走 `safeHttpUrl`。§十 表格相应按「共享协议判据」表述 |
| 渲染端取用主进程能力的入口（§8.1 未写，第四刀补） | `usePodcastChannel.js` 原自建探测函数直写桌面端暴露面（实数 9 处），触发 `QG Static` Gate 10「渲染端 IPC 单轨制」报红（基线 0、棘轮只能缩小）。现改为经本仓唯一白名单目录的窄面层 `src/api/podcast-channel.js` → `electron-bridge.js` 的 `invokeNamespace`，**形态为 8 个具名导出、每个各自把方法名写成字面量**（`channelGet` / `channelSave` / `episodeList` / `episodeSave` / `episodeRemove` / `feedBuild` / `feedVerify` / `endpointList`），**禁止**收敛成一个 `callPodcastIpc(method, …)` 泛化转发：`electron/tests/ipc-exposure-contract.test.js` 按调用点首参**字面量**与 preload 暴露面对账，变量转发会被判「生产侧动态取名」而让这 8 条路径从账上消失（同仓先例 `src/api/tts-voice-catalog.js` 头部注释即为此条而写）；该文件本身还必须先登记进 `SCAN_DOMAIN`（D6 棘轮）| **交互语义不变**（第四刀本身），仅收口实现：不可用仍映射 `IPC_UNAVAILABLE`、抛错仍映射 `IPC_EXCEPTION`。该层**不剥壳、不改写、不补默认值**，只把「命名空间/方法不存在」这一 `undefined` 显式转成 `{available:false}`——因为「这台构建没有播客能力」与「有能力但这次失败」是两种用户可见文案，混同会把未接线显示成网络故障。回归锁 `usePodcastChannel-ipc.test.js`（11 例，夹具只 mock 桌面暴露面、驱动真实桥接层，含 reactive→纯对象脱壳的原型断言、逐条字面量结构锁与「导出名 ↔ preload 暴露面」一致锁；变异反证：摘 `available` 判定 → 行为锁红 3 例，把任一导出退回 `forward(name, …)` 变量转发 → `ipc-exposure-contract` 与本 PR 结构锁**同时红**） |
| 「不可用」与「调用失败」两档的**实际覆盖面**（§9.1 上一行原写「环境=命名空间缺失」，第五刀按 QM-6 后端评审 Warning 修正） | 主进程 8 个 handler 全部包在 `guarded` 里，业务/领域错误一律以 `{code:负码, data}` **返回**而**不 throw**；真正会穿透调用链的抛错只有一种——preload 访问控制 `createDynamicAccessApi` 在**未登录 / 许可证未激活**时对每个 podcast 方法**同步 throw** `LicensePermissionError`（本页 8 个方法都不在 `PUBLIC_METHODS` 名单内，`requiredLevel=authenticated`）。而 `invokeNamespace` 不是 async 函数，该 throw 发生在**参数求值期**：第四刀的 `toEnvelope(await invokeNamespace(...))` 里 `try` 尚未进场，catch 永远接不到，于是**生产环境最高频的前置条件失败**被兜成 `PODCAST_IPC_EXCEPTION`（文案「调用失败，请重试」）——把用户引向"再点一次"，而正解是"去登录" | **已修正**（第五刀）：桥接层改为 `envelope(() => invokeNamespace(NS, '…'))`（**必须传 thunk**，由 envelope 在 `try` 内调用），并以 `electron-bridge` 导出的**共享判据** `isPermissionError` 把权限前置条件归进 `{available:false}` ⇒ 界面映射 `PODCAST_IPC_UNAVAILABLE`；其余错误仍原样上抛进 `IPC_EXCEPTION`。口径来源是本仓既有约定 M-14（`invokeWithFallback`：「权限不足必须落进 fallback 语义⋯⋯其余错误照原样抛出」），**不是新发明**。用户可见文案随之改写（zh/en 成对）：`PODCAST_IPC_UNAVAILABLE` 由「播客服务暂不可用（主进程通道未挂载），请稍后重试」改为**点名三种成因**且**删掉「请稍后重试」**（未登录与通道未挂载都不是重试能解决的，保留会把用户引向错误排障方向）。回归锁 `usePodcastChannel-ipc.test.js` 增至 14 例（桥接层同步 throw → available:false 且不上抛；非权限类同步 throw 仍原样上抛；composable 层未登录 → `IPC_UNAVAILABLE`；另加 4 条结构锁：共享判据的 import、`isPermissionError(err)` 在调用、`await pending()` 的 thunk 形态、以及**负向锁**「不得把 promise 直接交给 envelope」）。变异反证三条均实测变红后还原全绿：① 摘掉权限分支 → 红 3（2 行为 + 1 结构）；② 把 thunk 退回直接传 promise → 红 10（桥接 3 + composable 2 + 结构锁 1 + 视图 4）；③ 把共享判据换成内联副本 `err.name === 'LicensePermissionError'`（**行为完全等价**）→ 结构锁单独变红 1，证明「单一实现」这一维度是被守住的，不靠行为差异 |
| locale 文件形态（第三次 rebase 后的现状，第五刀补记） | 上游已把多数命名空间收成 `collection: { ...collectionZh }` 这类**单行 spread**（文案本体搬进 `locales/zh/*.js` 模块），而本 PR 新增的 `podcast` 命名空间**仍是内联字面量**（zh/en 各一份、逐键成对） | 不构成功能偏差：内联与 spread 在同一文件里共存是上游迁移自身的中间态（`knowledgeBase` 等同为内联），把 `podcast` 迁进独立模块属后续 docs 刀。Gate 7 两条判据（`--pair-base` 成对、`--cjk` 硬编码基线）实测仍 rc=0。**rebase 处置口径已落进执行记录**：先取证本 PR 未改过被迁移的五个命名空间内部，才只取上游新形态、保留自己的新块——保留那 441 行迁移前内联等于撤销上游重构 |
| 像素基线的**过期原因不止一条**（第五刀预判、第六刀实测） | 上一条文案改写使 `podcast-channel.png` 漂移 **19335 px（0.932%）**，其中超出字号令牌化的部分正是这行降级文案本身——像素捕获跑在**纯浏览器**（无 `window.electronAPI`）里，所以「无宿主即降级」分支的文案**必然**被渲染进基线；另 10 张（9 暗色各 559 px、`collection` 231 px）由本 PR 的侧边栏条目造成 | 已按**同一次 run** 的 CI 渲染重取（含 `podcast-channel-dark.png` 首次入库），逐张 SHA-256 自证与渲染逐字节相同，`check-baseline-freshness --partial` 违规 11→0；不提 `PIXEL_THRESHOLD`、不加 mask、零本机截图。文案/字号变更若再触到这些区域，判据同上：**同一次 run 重取**

其余条目（半成品可保存、`ownerEmail` 公开提示已实际渲染（`podcast-owner-email-privacy-hint`，回归锁「所有者邮箱字段下必须展示公开提示（PRD §九.A / QM-6 W3），zh/en 成对」）、倒序列表、时长/体积格式化、自检 `checks[]` 明细、提交指引卡片按 `ENDPOINT_ORDER` 与 `requiresManualFirstSubmit`/`timing`/`steps`/`verifiedAt` 展示、生成中按钮禁用防重复点击）均已按规范落地。另有两条必须写明的口径（QM-6 回归）：① 自检通过/未通过徽标的 `ok` 取自**引擎语义**（`issues.length === 0`），**不沿用 IPC envelope 的 `ok`**——主进程成功路径恒回 `code:0`，envelope.ok 对任何带 issues 的结果都是 true，沿用会把「自检发现问题」渲染成「自检通过」（唯一实现 `usePodcastChannel.verifyFeed`；回归锁「自检徽标 ok 取自引擎 issues 口径：envelope.ok=true 但 issues 非空时必须显示『自检未通过』（QM-6 W1 回归）」）；② 保存失败**不得只弹通用码 toast**——失败分支同时把 `res.issues` 落进区块清单（见 §九.A），通用提示与逐条清单并存。

## 十、显示项

| 界面元素 | 显示内容 | 格式/规则 |
| --- | --- | --- |
| 单集时长 | `durationSec` 格式化 | `formatDuration` 口径：不足一小时 `MM:SS`（如 `05:30`），≥一小时 `HH:MM:SS`（如 `01:02:03`）——与 feed 内 `<itunes:duration>` 逐字一致 |
| 单集体积 | `sizeBytes` | 渲染层人类可读（`B/KB/MB/GB` 一档，保留 1 位小数）；存储与校验一律原值整数 |
| 页面文字字号 | 各区块标题、正文、辅助说明 | **一律取 `src/styles/tokens.css` 的七档标度令牌**（`--font-size-xs` 12 / `sm` 13 / `base` 15 / `md` 17 / `lg` 20 / `xl` 24 / `xxl` 32），页内**不得**出现 `font-size: Npx` 字面量（`QG Static` Gate 16 字号标度：新增文件零字面量、存量只下棘轮）。本页实测映射：区块小标题 `h2` 原 16px → `var(--font-size-md)`(17px)、端点卡片标题 `h3` 原 14px → `var(--font-size-base)`(15px)，其余 12/13/20px 分别落 `xs`/`sm`/`lg`（本页仅有一处 14px，即上面单列的 `h3`，不在"其余"之列）。**明确禁止**用 `calc(var(--font-size-md) - 1px)` 之类写法把 off-scale 值藏回令牌——那会让字号锁失去意义，而标度锁的代价（两处各 1 px 视觉变化）必须由像素基线重取来消化，不得由规避来消化 |
| 发布日期 | `pubDate` | 界面本地化日期 `YYYY-MM-DD HH:mm`；feed 内为 RFC-2822 GMT（`toRfc2822`）——两形态同源一字段，界面不得反向把本地化串当数据存 |
| 外链状态徽标 | 最近一次自检结果 | 可达（绿）/ 不可达含状态码（红）/ 类型不符（红）/ 长度不符（黄）/ 未自检（灰） |
| 封面校验结果 | `coverSize` 解析态 | 「3000×3000 ✓」/「非正方形 ✗」/「边长须在 1400~3000」/「无法解析尺寸」 |
| 单集计数 | `total` / `ITEMS_MAX` | `n / 1000`；达上限时【添加】禁用并说明 |
| feed 生成时刻 | `lastBuildDate` | 界面本地化；feed 内 GMT |
| 分发端卡片 | `name/submitChannel/timing/steps/verifiedAt` | `submitUrl` 仅 web 端显示为链接（绑定前过共享协议判据 `safeHttpUrl`，与 `podcastEndpointHref` 同一实现）；app 端显示「在小宇宙 App 内操作」；`evidence` 为内部取证字段，默认不整段外显（可折叠"收录依据"） |
| 空态 | 无单集 / 自检无结果 | 如实文案：「还没有单集——feed 至少需要 1 期才能生成」/「尚未自检」；**不得硬凑**目录内容或示例数据填充列表 |

## 十一、提示文字（locales `podcast` 命名空间，zh/en 成对）

> 键名风格对齐既有 locales（顶层 `podcast: {}`，camelCase 子键；先例 `publish:`/`settings:`）。渲染层非 locales 文件禁止新增中文字面量（CJK 基线扫描）；校验类 issue 的 zh 文案以引擎 `issue.message` 为底稿（shared-utils 属数据层中文，PLATFORM_NAMES 先例），en 侧由渲染层按 `podcast.errors.<CODE>` 映射——**下表 code 行即为错误映射的单一清单**，新增码必须成对补键。

> **提示文字有两把不同的锁，不可互替**：① **键级成对**由 `.github/scripts/check-locale-sync.js --pair-base` 守（zh.js 与 en.js 的同名键必须同批出现，漏一侧当场红）；② **产品术语成对**由 `apps/desktop/src/i18n/glossary.test.js`（L3）守——它读 `01-docs/i18n-glossary.md` 的词条表，要求每个词条的 zh 术语出现在 zh locale、en 术语出现在 en locale（en 侧不区分大小写）。本 PR 曾只满足 ① 而未满足 ②（词典加了「RSS 订阅源 / RSS feed」而 zh 文案用裸词「RSS」），CI 一次报红 4 条但真实红因只有 1 条，故**新增或修改词典词条必须本机跑该锁**。术语取向一律是「**UI 采用词典 canonical 术语**」，不把词典削到已有裸词（后者等于把锁的目标改成缺陷）。本节下表内所有 zh 文案均按**当前实现值**抄录，与 `src/locales/zh.js` 逐字一致（第七刀 2026-10-10 校订）。### 11.1 界面 chrome（表单标签/占位/按钮/状态）

| key | zh | en |
| --- | --- | --- |
| podcast.page.title | 播客频道 | Podcast Channel |
| podcast.page.subtitle | 生成 Podcast RSS，一次提交收录、此后每期自动同步 | Generate a Podcast RSS feed — submit once for inclusion, every episode syncs automatically after |
| podcast.channel.section | 频道设置 | Channel Settings |
| podcast.channel.title | 节目名称 | Show Title |
| podcast.channel.titlePlaceholder | 不超过 255 个字符 | Up to 255 characters |
| podcast.channel.description | 节目简介 | Description |
| podcast.channel.subtitle | 副标题 | Subtitle |
| podcast.channel.language | 语言 | Language |
| podcast.channel.coverUrl | 封面地址 | Cover URL |
| podcast.channel.coverSize | 封面尺寸 | Cover Size |
| podcast.channel.coverSizeHint | 正方形，边长 1400~3000 像素，形如 3000x3000 | Square, 1400–3000 px per side, e.g. 3000x3000 |
| podcast.channel.link | 节目站点（可选） | Website (optional) |
| podcast.channel.author | 作者/主播 | Author |
| podcast.channel.ownerName | 所有者名称 | Owner Name |
| podcast.channel.ownerEmail | 所有者邮箱 | Owner Email |
| podcast.channel.ownerEmailPrivacy | 该邮箱会公开出现在 RSS 订阅源中（写入 itunes:email），聚合端与订阅者均可见。 | This email is published in the RSS feed (written to itunes:email) and visible to aggregators and subscribers. |
| podcast.channel.explicit | 内容分级 | Explicit Rating |
| podcast.channel.feedType | 节目类型 | Feed Type |
| podcast.channel.category | 播客分类 | Podcast Category |
| podcast.channel.save | 保存频道 | Save Channel |
| podcast.channel.saved | 频道已保存 | Channel saved |
| podcast.episode.section | 单集 | Episodes |
| podcast.episode.add | 添加单集 | Add Episode |
| podcast.episode.title | 单集标题 | Episode Title |
| podcast.episode.audioUrl | 音频外链 | Audio URL |
| podcast.episode.audioUrlPlaceholder | https 开头的音频绝对地址 | Absolute https audio URL |
| podcast.episode.localFile | 本地音频文件 | Local Audio File |
| podcast.episode.duration | 时长 | Duration |
| podcast.episode.size | 体积 | Size |
| podcast.episode.pubDate | 发布时间 | Publish Date |
| podcast.episode.number | 期号 | Episode No. |
| podcast.episode.season | 季号 | Season No. |
| podcast.episode.episodeType | 单集类型 | Episode Type |
| podcast.episode.mime | 音频格式 | Audio MIME |
| podcast.episode.guid | 唯一标识（可留空，默认用音频地址） | GUID (optional, defaults to audio URL) |
| podcast.episode.save | 保存单集 | Save Episode |
| podcast.episode.saved | 单集已保存 | Episode saved |
| podcast.episode.updated | 已更新同标识的既有单集 | Existing episode with same identifier updated in place |
| podcast.episode.delete | 删除单集 | Delete Episode |
| podcast.episode.deleteConfirm | 删除后 feed 将在下次生成时移除该集，已收录端会保留历史缓存。确认删除？ | The feed will drop this item on next build; aggregators may keep cached copies. Delete? |
| podcast.feed.section | RSS 输出 | RSS Output |
| podcast.feed.build | 生成 / 更新 feed | Build / Update Feed |
| podcast.feed.building | 正在生成… | Building… |
| podcast.feed.built | feed 已生成（{count} 期） | Feed built ({count} episodes) |
| podcast.feed.buildFailed | 未生成：存在 {count} 项校验问题 | Not generated: {count} validation issues |
| podcast.feed.verify | 自检 feed | Verify Feed |
| podcast.feed.verifying | 自检中… | Verifying… |
| podcast.feed.verifyOk | 自检通过：{count} 个音频全部可达 | Verification passed: all {count} enclosures reachable |
| podcast.feed.verifyFailed | {count} 个 enclosure 异常，聚合端可能缺集 | {count} enclosure problems; episodes may be missing on aggregators |
| podcast.feed.copyUrl | 复制 RSS 地址 | Copy RSS URL |
| podcast.feed.copied | RSS 地址已复制 | RSS URL copied |
| podcast.feed.notDeployed | feed 尚未公网可达，无法复制有效地址 | Feed is not publicly reachable yet; no valid URL to copy |
| podcast.feed.emptyEpisodes | 还没有单集——feed 至少需要 1 期才能生成 | No episodes yet — a feed needs at least 1 episode |
| podcast.feed.countLimit | 单集数已达上限 1000 | Episode limit of 1000 reached |
| podcast.endpoint.section | 分发端提交指引 | Distribution Endpoint Guides |
| podcast.endpoint.appNote | 首次收录需人工提交，mulpub 无法代提交 | First inclusion requires manual submission; mulpub cannot submit for you |
| podcast.endpoint.manual | 需一次性人工提交 | One-time manual submission required |
| podcast.endpoint.timing | 审核与同步时效 | Review & Sync Timing |
| podcast.endpoint.steps | 提交步骤 | Submission Steps |
| podcast.endpoint.openSubmit | 打开发布端 | Open Distributor |
| podcast.endpoint.verifiedAt | 收录情况取证于 {date}，以对方后台当日实况为准 | Verified on {date}; subject to the distributor's current UI |
| podcast.endpoint.submitApp | 请在 {name} App 内操作 | Submit inside the {name} app |
| podcast.hosting.guideTitle | 需要稳定的音频外链 | You need a stable audio URL |
| podcast.hosting.guideP0 | 为每集填写已有外链 | Provide an existing URL for each episode |
| podcast.hosting.guideP1 | 对象存储直传（规划中，即将上线） | Upload to your own object storage (planned) |
| podcast.error.issueAnchor | 查看具体校验问题 | See detailed validation issues |

### 11.2 校验错误映射（`podcast.errors.<CODE>`；zh 列即引擎原文）

| key | zh（引擎原文） | en |
| --- | --- | --- |
| podcast.errors.CHANNEL_MISSING | 频道配置缺失 | Channel configuration missing |
| podcast.errors.CHANNEL_TITLE_REQUIRED | 频道标题不能为空 | Show title is required |
| podcast.errors.CHANNEL_TITLE_TOO_LONG | 频道标题不得超过 255 字符 | Show title must be ≤ 255 characters |
| podcast.errors.CHANNEL_DESC_REQUIRED | 频道简介不能为空 | Description is required |
| podcast.errors.CHANNEL_DESC_TOO_LONG | 频道简介不得超过 4000 字符 | Description must be ≤ 4000 characters |
| podcast.errors.CHANNEL_SUBTITLE_TOO_LONG | 副标题不得超过 120 字符 | Subtitle must be ≤ 120 characters |
| podcast.errors.CHANNEL_LANGUAGE_INVALID | 语言需形如 zh-CN / en-US | Language must look like zh-CN / en-US |
| podcast.errors.CHANNEL_COVER_REQUIRED | 封面地址不能为空 | Cover URL is required |
| podcast.errors.CHANNEL_COVER_NOT_HTTPS | 封面必须是 https 绝对地址 | Cover must be an absolute https URL |
| podcast.errors.CHANNEL_COVER_SIZE_UNKNOWN | 封面尺寸需形如 3000x3000 以便校验 | Cover size must be declared like 3000x3000 |
| podcast.errors.CHANNEL_COVER_NOT_SQUARE | 封面必须为正方形 | Cover must be square |
| podcast.errors.CHANNEL_COVER_SIZE_OUT_OF_RANGE | 封面边长须在 1400~3000 之间 | Cover side must be 1400–3000 px |
| podcast.errors.CHANNEL_LINK_NOT_HTTPS | 站点地址必须是 https 绝对地址 | Website must be an absolute https URL |
| podcast.errors.CHANNEL_AUTHOR_REQUIRED | 作者/主播名不能为空 | Author is required |
| podcast.errors.CHANNEL_OWNER_EMAIL_INVALID | 所有者邮箱格式非法 | Invalid owner email format |
| podcast.errors.CHANNEL_EXPLICIT_INVALID | 分级取值须为 yes/no/clean | Rating must be yes/no/clean |
| podcast.errors.CHANNEL_FEED_TYPE_INVALID | feed 类型取值须为 episodic/serial | Feed type must be episodic/serial |
| podcast.errors.CHANNEL_CATEGORY_REQUIRED | 播客分类不能为空 | Category is required |
| podcast.errors.CHANNEL_CATEGORY_UNKNOWN | 未知顶级分类「{top}」 | Unknown top-level category "{top}" |
| podcast.errors.CHANNEL_SUBCATEGORY_UNKNOWN | 「{top}」下不存在子分类「{sub}」 | Subcategory "{sub}" does not exist under "{top}" |
| podcast.errors.CHANNEL_CATEGORY_TOO_DEEP | 分类最多两级 | Categories allow at most two levels |
| podcast.errors.EPISODE_MISSING | 单集数据缺失 | Episode data missing |
| podcast.errors.EPISODE_TITLE_REQUIRED | 单集标题不能为空 | Episode title is required |
| podcast.errors.EPISODE_TITLE_TOO_LONG | 单集标题不得超过 255 字符 | Episode title must be ≤ 255 characters |
| podcast.errors.EPISODE_DESC_TOO_LONG | 节目简介不得超过 4000 字符 | Episode description must be ≤ 4000 characters |
| podcast.errors.EPISODE_SUBTITLE_TOO_LONG | 副标题不得超过 120 字符 | Episode subtitle must be ≤ 120 characters |
| podcast.errors.EPISODE_AUDIO_REQUIRED | 音频地址不能为空（音频必须是 https 绝对地址；仅有本地文件时须先配置托管直传） | Audio URL is required |
| podcast.errors.EPISODE_AUDIO_NOT_HTTPS | 音频必须是 https 绝对地址；仅有本地文件时须先配置托管直传 | Audio must be an absolute https URL |
| podcast.errors.EPISODE_HOSTING_NOT_CONFIGURED | 仅有本地文件，须先配置托管直传 | Only a local file exists; configure object-storage upload first |
| podcast.errors.EPISODE_DURATION_INVALID | 时长须为 1~86400 的整数秒 | Duration must be an integer of 1–86400 seconds |
| podcast.errors.EPISODE_SIZE_REQUIRED | enclosure 必须声明 length（字节数） | Enclosure must declare byte length |
| podcast.errors.EPISODE_SIZE_INVALID | 字节数须为正整数 | Byte length must be a positive integer |
| podcast.errors.EPISODE_EXPLICIT_INVALID | 分级取值须为 yes/no/clean | Rating must be yes/no/clean |
| podcast.errors.EPISODE_TYPE_INVALID | 类型取值须为 full/trailer/bonus | Type must be full/trailer/bonus |
| podcast.errors.EPISODE_PUBDATE_INVALID | 发布时间无法解析 | Unparseable publish date |
| podcast.errors.EPISODE_COVER_NOT_HTTPS | 单集封面必须是 https 绝对地址 | Episode cover must be an absolute https URL |
| podcast.errors.EPISODE_MIME_INVALID | 音频 MIME 须为 audio/mpeg/audio/mp4/audio/x-m4a/audio/aac/audio/ogg/audio/wav | Audio MIME not in whitelist |
| podcast.errors.EPISODE_GUID_TOO_LONG | guid 不得超过 500 字符 | GUID must be ≤ 500 characters |
| podcast.errors.EPISODE_NUMBER_INVALID | 期号须为正整数 | Episode number must be a positive integer |
| podcast.errors.EPISODE_SEASON_INVALID | 季号须为正整数 | Season must be a positive integer |
| podcast.errors.EPISODES_EMPTY | feed 至少需要一个单集 | A feed needs at least one episode |
| podcast.errors.EPISODES_TOO_MANY | 单集数不得超过 1000 | At most 1000 episodes per feed |
| podcast.errors.EPISODE_DUPLICATE | 存在重复的 guid/音频地址 | Duplicate GUID / audio URL found |
| podcast.errors.PODCAST_FEED_INVALID | 校验未通过，feed 未生成 | Validation failed; feed not generated |
| podcast.errors.FEED_NO_ITEMS | feed 中没有任何单集 | Feed contains no items |
| podcast.errors.FEED_MISSING_ITUNES_NS | 缺少 itunes 命名空间 | itunes namespace missing |
| podcast.errors.FEED_MISSING_XML_DECL | 缺少 XML 声明 | XML declaration missing |
| podcast.errors.ENCLOSURE_MISSING | 存在没有 enclosure 的单集 | An item has no enclosure |
| podcast.errors.ENCLOSURE_NOT_HTTPS | 存在非 https 的 enclosure | A non-https enclosure found |
| podcast.errors.ENCLOSURE_UNREACHABLE | 有 enclosure 不可达（状态 {status}） | Enclosure unreachable (status {status}) |
| podcast.errors.ENCLOSURE_TYPE_MISMATCH | enclosure 指向的资源不是音频 | Enclosure is not an audio resource |
| podcast.errors.ENCLOSURE_LENGTH_MISMATCH | 声明的 length 与实际字节数不一致 | Declared length mismatches actual bytes |
| podcast.errors.DURATION_MISSING | 单集缺少时长 | Episode duration missing |

### 11.5 实现态全量文案清单（**由 `scripts/gen-prd-copy-table.js` 从 `apps/desktop/src/locales/podcast/{zh,en}.js` 生成，改文案必须重新生成，禁止手工维护本节**）

- 生成口径：解析两份 locale 的 `export default` 字面量 → 扁平化键名 → 按本节的收录前缀取键并**按字典序**排列。
- `--check` 已接进 `.github/workflows/quality-gate.yml`（Gate 2c）：本节与 locale 不一致即红，所以「文档比代码旧」不再是可能状态。
- 两处不一致时的裁决方向：以本节（即代码）为准，回改规划态小节，而不是反过来改文案去迁就文档。

| 键路径 | zh（用户可见，逐字） | en（用户可见，逐字） |
| --- | --- | --- |
| `podcast.audioSource.oss` | 托管直传（对象存储） | Managed upload (object storage) |
| `podcast.audioSource.url` | 外链直连（https 音频地址） | External URL (https audio link) |
| `podcast.channel.categoryPlaceholder` | 请选择顶级分类 | Select a top-level category |
| `podcast.channel.fieldAudioSource` | 音频来源 | Audio Source |
| `podcast.channel.fieldAuthor` | 作者/主播名 | Author / Host |
| `podcast.channel.fieldCategory` | 分类 | Category |
| `podcast.channel.fieldCoverSize` | 封面尺寸 | Cover Size |
| `podcast.channel.fieldCoverUrl` | 封面地址 | Cover URL |
| `podcast.channel.fieldDescription` | 频道简介 | Channel Description |
| `podcast.channel.fieldEpisodeType` | 更新方式 | Update Order |
| `podcast.channel.fieldExplicit` | 分级 | Rating |
| `podcast.channel.fieldLanguage` | 语言 | Language |
| `podcast.channel.fieldLink` | 站点地址 | Site URL |
| `podcast.channel.fieldOwnerEmail` | 所有者邮箱 | Owner Email |
| `podcast.channel.fieldOwnerName` | 所有者名称 | Owner Name |
| `podcast.channel.fieldSubCategories` | 子分类 | Subcategories |
| `podcast.channel.fieldSubtitle` | 副标题 | Subtitle |
| `podcast.channel.fieldTitle` | 频道标题 | Channel Title |
| `podcast.channel.ownerEmailPrivacy` | 该邮箱会公开出现在 RSS 订阅源中（写入 itunes:email），聚合端与订阅者均可见。 | This email is published in the RSS feed (written to itunes:email) and visible to aggregators and subscribers. |
| `podcast.channel.save` | 保存频道设置 | Save Channel |
| `podcast.channel.saved` | 频道设置已保存 | Channel saved |
| `podcast.channel.sectionHint` | 频道元信息只需配置一次，生成 Feed 时写入。带校验的字段以自检结果为准。 | Channel metadata is configured once and embedded into the feed. Validation results are shown by the feed self-check. |
| `podcast.channel.sectionTitle` | 频道设置 | Channel Settings |
| `podcast.channel.subCategoriesHint` | 可选，最多一个（聚合端按「顶级/子级」单层归类）；切换顶级分类会清空已选子分类 | Optional, at most one (aggregators classify by "Top/Sub"); changing the top category clears the selected subcategory |
| `podcast.channel.subCategoryNone` | 不指定子分类 | No subcategory |
| `podcast.channelFeedType.episodic` | 随更（节目型） | Episodic (auto-latest order) |
| `podcast.channelFeedType.serial` | 按时间序（连续剧型） | Serial (chronological) |
| `podcast.endpoints.docLink` | 官方文档 | Official docs |
| `podcast.endpoints.empty` | 未能读取分发端目录 | Failed to load the distribution endpoint catalog |
| `podcast.endpoints.manualFirstSubmit` | 需先人工首次提交 | Manual first submission required |
| `podcast.endpoints.noSubmitUrl` | 暂无公开提交地址，请按指引步骤操作 | No public submission URL; follow the guide steps |
| `podcast.endpoints.sectionHint` | RSS 聚合端没有发布 API，请按各端指引人工提交 Feed 地址；小宇宙首次收录需要等待其抓取周期。 | RSS aggregators have no publish API. Submit your feed URL manually following each directory guide; the first Xiaoyuzhou inclusion needs to wait for its crawl cycle. |
| `podcast.endpoints.sectionTitle` | 分发端提交指引 | Directory Submission Guide |
| `podcast.endpoints.submitLink` | 前往提交页 | Open submission page |
| `podcast.episodeType.bonus` | 加更 | Bonus |
| `podcast.episodeType.full` | 正片 | Full |
| `podcast.episodeType.trailer` | 预告片 | Trailer |
| `podcast.episodes.add` | 新增单集 | Add Episode |
| `podcast.episodes.addTitle` | 新增单集 | Add Episode |
| `podcast.episodes.cancel` | 收起 | Close |
| `podcast.episodes.confirmDelete` | 确定删除这一期吗？ | Delete this episode? |
| `podcast.episodes.delete` | 删除 | Delete |
| `podcast.episodes.deleteNo` | 取消 | Cancel |
| `podcast.episodes.deleteYes` | 确认删除 | Confirm |
| `podcast.episodes.deleted` | 单集已删除 | Episode deleted |
| `podcast.episodes.edit` | 编辑 | Edit |
| `podcast.episodes.editTitle` | 编辑单集 | Edit Episode |
| `podcast.episodes.empty` | 暂未添加单集。点击「新增单集」添加第一期。 | No episodes yet. Click "Add Episode" to create the first one. |
| `podcast.episodes.explicitInherit` | 沿用频道设置 | Inherit from channel |
| `podcast.episodes.fieldAudioUrl` | 音频直链（https） | Audio URL (https) |
| `podcast.episodes.fieldDescription` | 节目简介 | Episode Description |
| `podcast.episodes.fieldDurationSec` | 时长（秒） | Duration (sec) |
| `podcast.episodes.fieldEpisodeType` | 类型 | Type |
| `podcast.episodes.fieldExplicit` | 分级 | Rating |
| `podcast.episodes.fieldGuid` | GUID | GUID |
| `podcast.episodes.fieldLocalFilePath` | 本地音频文件路径 | Local Audio File Path |
| `podcast.episodes.fieldPubDate` | 发布时间（ISO） | Publish Date (ISO) |
| `podcast.episodes.fieldSizeBytes` | 字节数 | Size (bytes) |
| `podcast.episodes.fieldTitle` | 单集标题 | Episode Title |
| `podcast.episodes.guidHint` | 唯一标识，不可为空；新增时已自动生成 | Unique identifier, must not be empty; auto-generated for new episodes |
| `podcast.episodes.save` | 保存单集 | Save Episode |
| `podcast.episodes.saved` | 单集已保存 | Episode saved |
| `podcast.episodes.sectionTitle` | 单集管理 | Episodes |
| `podcast.errors.CHANNEL_AUTHOR_REQUIRED` | 作者/主播名不能为空 | Author / host name is required |
| `podcast.errors.CHANNEL_CATEGORY_REQUIRED` | 必须选择顶级分类 | A top-level category is required |
| `podcast.errors.CHANNEL_CATEGORY_TOO_DEEP` | 分类最多两级 | Category supports at most two levels |
| `podcast.errors.CHANNEL_CATEGORY_UNKNOWN` | 未知顶级分类 | Unknown top-level category |
| `podcast.errors.CHANNEL_COVER_NOT_HTTPS` | 封面必须使用 https 绝对地址 | Cover must be an absolute https URL |
| `podcast.errors.CHANNEL_COVER_NOT_SQUARE` | 封面必须为正方形 | Cover must be square |
| `podcast.errors.CHANNEL_COVER_REQUIRED` | 封面地址不能为空 | Cover URL is required |
| `podcast.errors.CHANNEL_COVER_SIZE_OUT_OF_RANGE` | 封面边长超出允许范围（1400~3000） | Cover side length is out of the allowed range (1400–3000) |
| `podcast.errors.CHANNEL_COVER_SIZE_UNKNOWN` | 需填写封面尺寸（形如 3000x3000）以便校验 | Cover size (e.g. 3000x3000) is required for validation |
| `podcast.errors.CHANNEL_DESC_REQUIRED` | 频道简介不能为空 | Channel description is required |
| `podcast.errors.CHANNEL_DESC_TOO_LONG` | 频道简介超出长度上限 | Channel description exceeds the length limit |
| `podcast.errors.CHANNEL_EXPLICIT_INVALID` | 频道分级取值不合法（yes/no/clean） | Channel rating must be yes / no / clean |
| `podcast.errors.CHANNEL_FEED_TYPE_INVALID` | feed 类型取值不合法（episodic/serial） | Feed type must be episodic / serial |
| `podcast.errors.CHANNEL_LANGUAGE_INVALID` | 语言需形如 zh-CN / en-US | Language must look like zh-CN / en-US |
| `podcast.errors.CHANNEL_LINK_NOT_HTTPS` | 站点地址必须使用 https 绝对地址 | Site URL must be an absolute https URL |
| `podcast.errors.CHANNEL_MISSING` | 缺少频道配置 | Channel configuration is missing |
| `podcast.errors.CHANNEL_OWNER_EMAIL_INVALID` | 所有者邮箱格式不正确 | Owner email format is invalid |
| `podcast.errors.CHANNEL_SUBCATEGORY_UNKNOWN` | 未知子分类 | Unknown subcategory |
| `podcast.errors.CHANNEL_SUBTITLE_TOO_LONG` | 频道副标题超出长度上限 | Channel subtitle exceeds the length limit |
| `podcast.errors.CHANNEL_TITLE_REQUIRED` | 频道标题不能为空 | Channel title is required |
| `podcast.errors.CHANNEL_TITLE_TOO_LONG` | 频道标题超出长度上限 | Channel title exceeds the length limit |
| `podcast.errors.DURATION_MISSING` | 有单集缺少时长 | An episode is missing its duration |
| `podcast.errors.ENCLOSURE_LENGTH_MISMATCH` | 声明的字节数与实际大小不一致 | Declared byte size does not match the actual length |
| `podcast.errors.ENCLOSURE_MISSING` | 存在缺少 enclosure 的单集 | An episode has no enclosure |
| `podcast.errors.ENCLOSURE_NOT_HTTPS` | 存在非 https 的 enclosure | An enclosure is not an https URL |
| `podcast.errors.ENCLOSURE_TYPE_MISMATCH` | enclosure 指向的资源不是音频 | The enclosure does not point to an audio resource |
| `podcast.errors.ENCLOSURE_UNREACHABLE` | 音频地址不可达，请检查托管或直链是否过期 | Audio URL is unreachable; check the hosting or whether the link expired |
| `podcast.errors.EPISODES_EMPTY` | 还没有单集：feed 至少需要一个单集 | No episodes yet: the feed requires at least one episode |
| `podcast.errors.EPISODES_TOO_MANY` | 单集数量超过上限 | Episode count exceeds the limit |
| `podcast.errors.EPISODE_AUDIO_NOT_HTTPS` | 音频必须使用 https 绝对地址 | Audio must be an absolute https URL |
| `podcast.errors.EPISODE_AUDIO_REQUIRED` | 缺少音频地址：请填写 https 直链，或先配置托管直传 | Audio is missing: provide an https URL or configure hosting |
| `podcast.errors.EPISODE_COVER_NOT_HTTPS` | 单集封面必须使用 https 绝对地址 | Episode cover must be an absolute https URL |
| `podcast.errors.EPISODE_DESC_TOO_LONG` | 单集简介超出长度上限 | Episode description exceeds the length limit |
| `podcast.errors.EPISODE_DUPLICATE` | 存在重复的 guid 或音频地址 | Duplicate guid or audio URL exists |
| `podcast.errors.EPISODE_DURATION_INVALID` | 时长须为规定范围内的整数秒 | Duration must be an integer number of seconds within the allowed range |
| `podcast.errors.EPISODE_EXPLICIT_INVALID` | 单集分级取值不合法（yes/no/clean） | Episode rating must be yes / no / clean |
| `podcast.errors.EPISODE_GUID_TOO_LONG` | GUID 过长 | GUID is too long |
| `podcast.errors.EPISODE_HOSTING_NOT_CONFIGURED` | 仅有本地文件，尚未配置托管直传，无法生成公开音频地址 | Only a local file exists; managed upload is not configured, so no public audio URL can be produced |
| `podcast.errors.EPISODE_MIME_INVALID` | 音频 MIME 类型不受支持 | Audio MIME type is not supported |
| `podcast.errors.EPISODE_MISSING` | 缺少单集数据 | Episode data is missing |
| `podcast.errors.EPISODE_NUMBER_INVALID` | 期号须为正整数 | Episode number must be a positive integer |
| `podcast.errors.EPISODE_PUBDATE_INVALID` | 发布时间无法解析 | Publish date could not be parsed |
| `podcast.errors.EPISODE_SEASON_INVALID` | 季号须为正整数 | Season number must be a positive integer |
| `podcast.errors.EPISODE_SIZE_INVALID` | 字节数须为正整数 | Size in bytes must be a positive integer |
| `podcast.errors.EPISODE_SIZE_REQUIRED` | 必须填写音频字节数（enclosure length） | Audio size in bytes (enclosure length) is required |
| `podcast.errors.EPISODE_SUBTITLE_TOO_LONG` | 单集副标题超出长度上限 | Episode subtitle exceeds the length limit |
| `podcast.errors.EPISODE_TITLE_REQUIRED` | 单集标题不能为空 | Episode title is required |
| `podcast.errors.EPISODE_TITLE_TOO_LONG` | 单集标题超出长度上限 | Episode title exceeds the length limit |
| `podcast.errors.EPISODE_TYPE_INVALID` | 单集类型取值不合法（full/trailer/bonus） | Episode type must be full / trailer / bonus |
| `podcast.errors.FEED_MISSING_ITUNES_NS` | Feed 缺少 itunes 命名空间 | The feed is missing the itunes namespace |
| `podcast.errors.FEED_MISSING_XML_DECL` | Feed 缺少 XML 声明 | The feed is missing the XML declaration |
| `podcast.errors.FEED_NO_ITEMS` | Feed 中没有任何单集 | The feed contains no episodes |
| `podcast.errors.PODCAST_AUDIO_DEGRADED_SOURCE` | 检测到静音占位旁白，已阻止上传（是素材本身不可用，不是生成失败） | Silent placeholder narration detected; the upload was blocked (the source material is unusable, generation did not fail) |
| `podcast.errors.PODCAST_AUDIO_ENCODER_UNAVAILABLE` | 打包的 ffmpeg 不含 mp3/aac 编码器，已停止出期 | The bundled ffmpeg has no mp3/aac encoder; the episode publish stopped |
| `podcast.errors.PODCAST_AUDIO_EXTRACT_FAILED` | 从成片抽取音轨失败，已停止出期 | Failed to extract the audio track from the final video; the episode publish stopped |
| `podcast.errors.PODCAST_AUDIO_MEASURE_FAILED` | 无法实测音频时长或字节，已停止出期 | The audio duration or size could not be measured; the episode publish stopped |
| `podcast.errors.PODCAST_AUDIO_SIZE_MISMATCH` | 上传回来的字节与本地实测不一致，这一期没有挂上 | The bytes returned by the upload do not match the local measurement, so this episode was not attached |
| `podcast.errors.PODCAST_CANCEL_TOO_LATE` | 已进入上传阶段，现在取消会留下半态，因此不能取消；请等本次发布跑完 | The upload has started, so cancelling now would leave a half-published state; please let this publish finish |
| `podcast.errors.PODCAST_CHANNEL_BUSY` | 该频道正在一键发布，请等本次发布结束后再修改单集 | This channel is publishing right now. Wait for it to finish before editing episodes. |
| `podcast.errors.PODCAST_CHANNEL_ID_INVALID` | 频道标识形态非法，请重新选择频道 | The channel id format is invalid. Please select the channel again. |
| `podcast.errors.PODCAST_CHANNEL_ID_REQUIRED` | 未选择播客频道，请先在上方新建或选择一个频道 | No podcast channel selected. Create or pick one above first. |
| `podcast.errors.PODCAST_CHANNEL_INVALID` | 频道信息不完整，请按下方逐条修正 | Channel information is incomplete. Fix the items listed below. |
| `podcast.errors.PODCAST_CHANNEL_NAME_REQUIRED` | 频道名称不能为空 | Channel name is required |
| `podcast.errors.PODCAST_CHANNEL_NOT_FOUND` | 频道不存在，可能已被删除，请重新选择 | Channel not found, it may have been deleted. Please select another one. |
| `podcast.errors.PODCAST_EPISODES_FULL` | 该频道单集数已达上限，请先删除不再需要的旧期再登记新的 | This channel reached its episode limit. Remove an old episode before adding a new one. |
| `podcast.errors.PODCAST_EPISODE_INVALID` | 单集信息不合法，请按下方逐条修正 | Episode data is invalid. Fix the items listed below. |
| `podcast.errors.PODCAST_EPISODE_NOT_FOUND` | 单集不存在，可能已被删除，请刷新列表 | Episode not found, it may have been deleted. Refresh the list. |
| `podcast.errors.PODCAST_FEED_BUILD_FAILED` | 这一期已登记到本地频道，公网 feed 尚未更新 | This episode is registered on the local channel, but the public feed is not updated yet |
| `podcast.errors.PODCAST_FEED_INVALID` | Feed 校验未通过，请先按下列问题解决 | Feed validation failed. Fix the issues below first |
| `podcast.errors.PODCAST_FEED_NOT_BUILT` | 该频道还没有可用的 Feed 产物，请先生成 Feed 再发布 | This channel has no usable feed file yet. Build the feed before publishing. |
| `podcast.errors.PODCAST_HOSTING_BODY_READ_FAILED` | 读取本地 Feed 文件失败，本次上传并未发出，请检查文件是否被占用或已被移动 | Reading the local feed file failed, so nothing was uploaded. Check whether the file is locked or has been moved. |
| `podcast.errors.PODCAST_HOSTING_BUCKET_REQUIRED` | Bucket 名称不能为空 | Bucket name is required |
| `podcast.errors.PODCAST_HOSTING_CREDENTIAL_REQUIRED` | AccessKeyId / AccessKeySecret 不能为空 | AccessKeyId / AccessKeySecret is required |
| `podcast.errors.PODCAST_HOSTING_CRYPTO_UNAVAILABLE` | 系统凭据保护不可用或被拒绝，凭证未能加密保存，已停止写入 | OS credential protection is unavailable or denied, so the secret was not encrypted. Saving stopped. |
| `podcast.errors.PODCAST_HOSTING_ENDPOINT_REQUIRED` | Endpoint 不能为空（形如 oss-cn-hangzhou.aliyuncs.com） | Endpoint is required (e.g. oss-cn-hangzhou.aliyuncs.com) |
| `podcast.errors.PODCAST_HOSTING_IDENTITY_REQUIRED` | 当前登录态无法确定凭证归属，已阻止保存托管配置 | The current sign-in cannot be resolved as the owner, so hosting credentials were not saved. |
| `podcast.errors.PODCAST_HOSTING_INVALID` | 托管配置不合格，请按下方逐条修正 | Hosting configuration is invalid. Fix the items listed below. |
| `podcast.errors.PODCAST_HOSTING_PREFIX_UNSAFE` | 路径前缀不得以 / 开头，也不得含 . 或 .. 段（否则发布路径会被改成另一个值） | The path prefix cannot start with / and cannot contain . or .. segments (they would silently rewrite the publish path). |
| `podcast.errors.PODCAST_HOSTING_PROVIDER_INVALID` | 托管类型只能选阿里云 OSS | Hosting provider must be Aliyun OSS |
| `podcast.errors.PODCAST_HOSTING_PROVIDER_UNSUPPORTED` | 该托管类型本期未接入，请改用阿里云 OSS，或为单集直接填写音频外链 | This hosting provider is not integrated yet. Switch to Aliyun OSS, or give the episode an audio direct link instead. |
| `podcast.errors.PODCAST_HOSTING_REQUIRED` | 本地音频需先配置对象存储托管（当前支持阿里云 OSS） | Local audio files need object-storage hosting first (Aliyun OSS is supported today). |
| `podcast.errors.PODCAST_HOSTING_SECRET_MISSING` | 缺少 AccessKeyId / AccessKeySecret，且没有可复用的已存凭证，请重新填写一次 | AccessKeyId / AccessKeySecret is missing and there is no stored credential to reuse. Fill them in once more. |
| `podcast.errors.PODCAST_HOSTING_UPLOAD_FAILED` | 上传到对象存储失败，本次发布未生效，请稍后重试或查看发布状态 | Upload to object storage failed. This publish did not take effect. Retry later or check the publish status. |
| `podcast.errors.PODCAST_HOSTING_URL_UNRESOLVED` | 无法由 Endpoint 与 Bucket 拼出上传地址，请检查这两项是否写全 | The upload URL cannot be built from Endpoint and Bucket. Check that both are filled in. |
| `podcast.errors.PODCAST_INDEX_BUSY` | 频道目录正被其他操作占用，请稍后重试 | The channel catalog is busy with another operation. Try again shortly. |
| `podcast.errors.PODCAST_IPC_EXCEPTION` | 播客服务调用失败，请重试 | Podcast service call failed, please retry |
| `podcast.errors.PODCAST_IPC_UNAVAILABLE` | 播客服务暂不可用（未登录、许可证未激活，或主进程通道未挂载） | Podcast service is unavailable (not signed in, license not activated, or main-process channel not mounted) |
| `podcast.errors.PODCAST_LOCK_WAIT_TIMEOUT` | 播客数据正在被其他操作占用，请稍后重试 | Podcast data is busy with another operation. Please retry shortly. |
| `podcast.errors.PODCAST_MIGRATION_CONFLICT` | 旧的播客频道数据与新建的频道内容不一致，已停止写入以免覆盖，请在上方选择保留哪一份 | The legacy podcast data and the new channel differ. Writes are blocked to avoid overwriting. Choose which copy to keep above. |
| `podcast.errors.PODCAST_MIGRATION_DIRECTION_INVALID` | 未知的迁移处置方式，请重新选择 | Unknown migration resolution. Please choose again. |
| `podcast.errors.PODCAST_MIGRATION_IO_FAILED` | 播客频道数据迁移未完成，已停止写入，可重试；已有内容仍可读取 | Podcast channel migration did not finish. Writes are blocked; existing content stays readable and you can retry. |
| `podcast.errors.PODCAST_PAYLOAD_NOT_SERIALIZABLE` | 表单数据无法序列化，请检查后重试 | Form data could not be serialized, please check and retry |
| `podcast.errors.PODCAST_PUBLISH_CANCELLED` | 本次播客出期已在上传前取消，临时文件已回滚 | This podcast episode publish was cancelled before upload and the temporary file was rolled back |
| `podcast.errors.PODCAST_STORE_CORRUPT` | 播客数据文件读不出来（可能已损坏），已停止写入以免扩大损坏 | The podcast data file cannot be read (it may be corrupted). Writing stopped to avoid making it worse. |
| `podcast.errors.PODCAST_STORE_UNAVAILABLE` | 播客数据目录当前不可用（权限或磁盘问题），请稍后重试 | The podcast data directory is unavailable right now (permissions or disk). Try again later. |
| `podcast.errors.PODCAST_TTS_BILLING_UNCONFIRMED` | 文本出期会逐块调用语音合成服务并产生费用，请先确认用量与费用 | Publishing from text calls the speech synthesis service per chunk and incurs cost. Confirm usage and fees first. |
| `podcast.errors.PODCAST_VIDEO_NOT_FOUND` | 找不到成片文件，请回结果页重新生成或重选路径 | The final video file cannot be found; regenerate it on the result page or pick the file again |
| `podcast.errors.fallback` | 发生未知问题（{code}） | Unknown issue ({code}) |
| `podcast.explicit.clean` | Clean（干净版） | Clean |
| `podcast.explicit.no` | 未分级 | Not explicit |
| `podcast.explicit.yes` | Explicit（有成人内容） | Explicit (adult content) |
| `podcast.hosting.accessKeyId` | AccessKeyId | AccessKeyId |
| `podcast.hosting.accessKeySecret` | AccessKeySecret | AccessKeySecret |
| `podcast.hosting.backupMissing` | 注意：本次未能把上一版存档到对象存储，本地回滚点仍在，但云端没有可指回的副本。 | Note: the previous version could not be archived to object storage. The local rollback copy is still there, but there is no cloud copy to point back to. |
| `podcast.hosting.bucket` | Bucket | Bucket |
| `podcast.hosting.check` | 测试连通 | Test connection |
| `podcast.hosting.checkFailed` | 连通失败（HTTP {status}）。 | Connectivity failed (HTTP {status}). |
| `podcast.hosting.checkNoStatus` | 无状态码 | no status |
| `podcast.hosting.checkNotConfigured` | 尚未配置凭证，无法测试连通。 | No credential stored, cannot test connectivity. |
| `podcast.hosting.checkOk` | 连通正常。 | Connectivity OK. |
| `podcast.hosting.checkSkipped` | 本轮未做真实探测（默认不发出网络请求）；配置已保存，可在发布时验证。 | No live probe was made (no network by default); the config is saved and can be verified when publishing. |
| `podcast.hosting.clearSecret` | 清除已存凭证 | Clear stored credential |
| `podcast.hosting.configured` | 已配置（AccessKeyId {key}） | Configured (AccessKeyId {key}) |
| `podcast.hosting.endpoint` | Endpoint | Endpoint |
| `podcast.hosting.endpointPlaceholder` | 如 oss-cn-hangzhou.aliyuncs.com | e.g. oss-cn-hangzhou.aliyuncs.com |
| `podcast.hosting.feedNotSynced` | 公网 feed 尚未更新（{status}），本地单集与已发布内容都不受影响。 | The public feed is not up to date ({status}). Your local episodes and what is already published are unaffected. |
| `podcast.hosting.feedPartial` | 部分同步 | partially synced |
| `podcast.hosting.noPrevious` | 这是该频道首次发布，暂时还没有可退回的上一版。 | This is the first publish for this channel, so there is no previous version to roll back to yet. |
| `podcast.hosting.notConfigured` | 尚未配置托管：单集可以先生成 Feed，但公网 feed 还发不出去。 | Hosting not configured: you can still build the Feed, but it cannot be published yet. |
| `podcast.hosting.pathPrefix` | 路径前缀 | Path prefix |
| `podcast.hosting.provider` | 托管类型 | Provider |
| `podcast.hosting.providerCos` | 腾讯云 COS（本期未接入） | Tencent COS (not supported this release) |
| `podcast.hosting.providerCosDisabled` | 本期只接了阿里云 OSS，COS 尚未实现，不可选 | Only Aliyun OSS is implemented this release, so COS cannot be selected |
| `podcast.hosting.providerOss` | 阿里云 OSS | Aliyun OSS |
| `podcast.hosting.publish` | 发布本频道 Feed | Publish this feed |
| `podcast.hosting.publishFailed` | 公网 feed 未更新（{status}），本地 Feed 与已发布内容不受影响，可重试。 | Public feed not updated ({status}); the local feed and what is already published are unchanged. You can retry. |
| `podcast.hosting.publishSuccess` | 已发布：本次共 {count} 期已写入公网 feed，聚合端下次抓取后生效。 | Published: {count} episode(s) are now in the public feed; aggregators pick them up on the next crawl. |
| `podcast.hosting.retryFeed` | 按当前单集重新生成并上传 feed | Rebuild and upload the feed from current episodes |
| `podcast.hosting.save` | 保存托管配置 | Save hosting config |
| `podcast.hosting.secretKeepHint` | 两项凭证留空即保持不变；只有重新填写才会覆写。Secret 不会回显，也不会出现在浏览器里。 | Blank credential fields keep what is already stored; only a re-entered value overwrites. The secret is never echoed back and never reaches the browser. |
| `podcast.hosting.secretKeepPlaceholder` | 留空 = 沿用已存的凭证 | Leave blank to keep the stored credential |
| `podcast.hosting.sectionHint` | 凭证全局一份，跨频道共用；发布时按频道写各自的 feed 路径。 | Credentials are stored once and shared across channels; publishing writes a feed path per channel. |
| `podcast.hosting.sectionTitle` | 对象存储托管 | Object storage hosting |
| `podcast.pageSubtitle` | 经 RSS 订阅把播客收录进小宇宙 / Apple / Spotify 等聚合端：配置频道一次 → 逐期追加单集 → 生成并自检 Feed → 向分发端提交 Feed 地址 | Podcast inclusion in RSS aggregators (Xiaoyuzhou / Apple / Spotify): configure the channel once → add episodes one by one → build & self-check the feed → submit the feed URL to each directory |
| `podcast.pageTitle` | 播客 RSS 频道 | Podcast RSS Channel |
| `podcast.picker.create` | 新建频道 | New channel |
| `podcast.picker.created` | 频道已创建 | Channel created |
| `podcast.picker.current` | 当前频道 | Current channel |
| `podcast.picker.defaultSet` | 默认频道已更新 | Default channel updated |
| `podcast.picker.empty` | 还没有频道，先新建一个。 | No channel yet. Create one to get started. |
| `podcast.picker.keepExisting` | 保留当前数据 | Keep current data |
| `podcast.picker.keepLegacy` | 保留原有数据 | Keep original data |
| `podcast.picker.migrationConflict` | 频道数据迁移未完成：本地已有两份不同的频道配置，请选择保留哪一份。 | Channel migration is incomplete: two different local channel configs were found. Choose which to keep. |
| `podcast.picker.migrationError` | 频道数据迁移中途失败，暂时无法写入；请重试或联系支持。 | Channel migration failed midway. Writing is blocked; please retry or contact support. |
| `podcast.picker.migrationResolved` | 迁移冲突已处理 | Migration conflict resolved |
| `podcast.picker.namePlaceholder` | 频道名称 | Channel name |
| `podcast.picker.nameRequired` | 请填写频道名称。 | Enter a channel name. |
| `podcast.picker.quotaHint` | 该频道已收录 {count} 期，上限 {cap} 期；达到上限时须先删除旧期。 | This channel holds {count} of {cap} episodes; delete some before adding more. |
| `podcast.picker.rename` | 重命名当前频道 | Rename current channel |
| `podcast.picker.renamed` | 频道已重命名 | Channel renamed |
| `podcast.picker.sectionTitle` | 播客频道 | Podcast channels |
| `podcast.picker.setDefault` | 设为默认频道 | Set as default |
| `podcast.picker.switchFailed` | 切换频道失败，请稍后重试。 | Could not switch channel. Please try again. |
| `podcast.picker.switched` | 已切换频道 | Channel switched |
| `podcast.publish.buildFeed` | 生成 Feed | Build Feed |
| `podcast.publish.copied` | 路径已复制 | Path copied |
| `podcast.publish.copyFailed` | 复制失败，请手动复制路径 | Copy failed, please copy the path manually |
| `podcast.publish.copyPath` | 复制文件路径 | Copy File Path |
| `podcast.publish.feedBuilt` | Feed 已生成：共 {count} 期 | Feed built: {count} episode(s) |
| `podcast.publish.feedBuiltNotify` | Feed 生成成功 | Feed built successfully |
| `podcast.publish.sectionHint` | 把频道设置与单集合成为 RSS 订阅源文件并写入用户数据目录；自检通过后再向分发端提交 Feed 地址。 | Merges channel settings and episodes into an RSS file under the user data directory; submit the feed URL to directories only after the self-check passes. |
| `podcast.publish.sectionTitle` | 发布与自检 | Build & Self-check |
| `podcast.publish.verifyFailed` | 自检发现 {count} 个问题 | Self-check found {count} issue(s) |
| `podcast.publish.verifyFeed` | 自检 Feed | Verify Feed |
| `podcast.publish.verifyPassed` | 自检通过：共 {count} 期 | Self-check passed: {count} episode(s) |

共 228 键；逐键 zh/en 成对且均为非空串。

## 十二、验收标准（整体验收）

1. **引擎**：`podcast-rss.test.js`（25 例）+ `podcast-endpoints.test.js`（8 例）全绿；校验码表（§六）与测试断言逐码对齐，新增码必须同时出现在两侧。
2. **首次收录闭环（人工核对项）**：按 §7.1 时序走一遍——生成的 feed 通过外部校验（可被聚合端解析）；小宇宙 App 提交入口按指引可达；审核期内不改 feed 地址。
3. **逐期自动同步**：追加单集 → 重建 feed → 轮询自家 feed 出现新 item（主判据）；小宇宙侧小时级出现（人工核对，不作为自动化断言）。
4. **负面验收**：任一必填缺失/协议非法/枚举非法 ⇒ 生成失败且不产出文件；重复 guid ⇒ 保存层原地更新、引擎层 duplicate 拦截；分发端 id 出现在任一平台契约面 ⇒ `podcast-endpoints.test.js` 变红。
5. **文案验收**：§十一 locales 键 zh/en 成对提交（CI Gate 7）；渲染层非 locales 文件中文字面量零新增（CJK 基线扫描）；界面不出现竞品品牌名（Gate 12）。

## 十三、非功能需求

- **性能**：feed 构建为**纯本地**内存操作（排序 O(n log n)，上限 1000 集），目标 < 1s；自检逐 enclosure 串行 HEAD（`headImpl` 由消费方注入，建议实现刀加并发上限与单请求硬超时，超时语义="本轮无结论"，不得把超时当可达或不可达的定论）。
- **隐私**：日志**不得记录**未发布草稿的单集标题原文与音频 URL 的查询串（先例：标题助理门禁日志只记计数与长度）；`verifyFeed` 只读 `status/contentType/contentLength`，不抓取响应体；所有者邮箱进 feed 是 Podcast 协议要求，界面必须提前告知（§九.A）。
- **网络**：引擎零出站（`headImpl` 注入点唯一）；无网络时生成/保存/指引全部可用（首收录指引为纯文案）。
- **可访问性/稳定**：分发端目录的 `verifiedAt` 必须随界面展示——收录流程属外部事实，改版后须重新取证（目录 JSON comment 已写明）。

## 十四、风险与开放问题

| # | 风险/问题 | 说明与缓解 |
| --- | --- | --- |
| R1 | 聚合端缓存音频导致托管带宽暴露 | 调研 §8.0：聚合端收录时会把音频**一次性拉取回流**到自家 CDN，用户播放通常走聚合端缓存源，带宽暴露主要是一次性量级、不是播放量持续乘法。前提若变（客户端直拉原始 URL 的比例上升），形态 B/C 的成本模型需重估 |
| R2 | 外链失效 → 小宇宙侧缺集 | feed 更新后抓取失败即该集在聚合端缺失且不可补推体验。缓解 = `verifyFeed` 自检 + P1 定期巡检（F9）+ 发布窗口内保持外链稳定 |
| R3 | 双实现漂移 | **已闭合（2026-10-09 主进程刀）**：`packages/api-publish-engine/src/podcast/feed-schema.js` 早期草稿（校验码集与 shared-utils 有漂移：多 `CHANNEL_COVER_INVALID/CHANNEL_LINK_INVALID`、少 `EPISODE_SIZE_REQUIRED/CHANNEL_CATEGORY_TOO_DEEP/feedType/subtitle` 族、MIME 派生兜底值不同）已从源码树移出，仓库内零引用，**单一真源 = `packages/shared-utils/src/podcast-rss.js`**。草稿留档 `%TEMP%/podcast-feed-schema-divergent-draft.js` 可恢复（本机缺 `mavis-trash` CLI，`scripts/safe-delete.js` 按设计拒绝删除，故走「可逆移出」而非删）。残留监控：若有人把草稿搬回，漂移以「两侧校验码集不一致」在构建期暴露而非静默通过（`podcast-endpoints.test.js` / `publish-mode-config.test.js` 只认真源侧口径） |
| R4 | 审核时效不可控 | 小宇宙首次收录 1~7 天人工审核、聚合端抓取小时级延迟，均非产品可承诺 SLA；文案一律引用目录 `timing` 并带 `verifiedAt`（"以对方后台当日实况为准"） |
| R5 | feed 公网部署路径 | 桌面应用落盘的 feed.xml 本身不公网可达（§8.2）；P0 依赖用户自行部署或已有托管商 feed 中转，**体验断点**。开放问题 O3：P1 直传是否连带上传 feed.xml 到用户桶固定 key（推荐方向，属实现设计） |
| O1 | 多频道支持 | 引擎不限制；P0 产品决策先做单频道（`channelId='default'`）。多频道时 feed 落盘目录与指引卡片归属需重新设计 |
| O2 | 收录状态观测（各端页面轮询） | 涉及新增第三方读取面，按既有红线届时先过相关性/合规判据，不进 P0/P1 |
| O6 | `link` 缺省兜底占位 `https://example.com/` | 引擎既有行为；RSS 2.0 的 channel `<link>` 必填导致必须兜底，界面应强烈引导用户填写真实站点（校验已允许留空，属有意宽松） |

## 十五、实现状态对照（事实表）

| 组件 | 状态 |
| --- | --- |
| `packages/shared-utils/src/podcast-rss.js`（引擎） | ✅ 已实现（未跟踪文件，随本 PR 首次入库） |
| `packages/shared-utils/src/podcast-endpoints.{json,js,browser.js}`（目录 + 双版本） | ✅ 已实现 |
| `podcast-rss.test.js` 25 例 + `podcast-endpoints.test.js` 8 例 | ✅ 已实现，本机实跑 33 passed（2026-10-09） |
| 主进程服务 / IPC handlers（§8.1） | ✅ 已实现并接线（2026-10-09）：`electron/services/podcast-channel-service.js`（`channel.json`/`episodes.json`/`feed.xml` 三份、原子替换 + Windows 有界退避、损坏即 `PODCAST_STORE_CORRUPT` fail-closed）+ `electron/ipc-handlers/podcast.js`（8 通道，**字面量**注册以让 `ipc-contract.test.js` 看得见）+ `electron/preload/podcast.js`（`electronAPI.podcast`，已在 `preload/index.js` 与两个 bundle 暴露）。**唯一未接**：`headImpl` 的主进程 `net` 版 HEAD provider —— 缺省不注入即跳过网络检查（生产零真实出站，日志标 `head=off`），接线属 F9 巡检刀 |
| 渲染层页面 / 状态 / locales `podcast` 命名空间（§九~§十一） | ✅ 已实现（2026-10-09）：`src/views/PodcastChannelView.vue`（三区块）+ `src/composables/usePodcastChannel.js` + 路由/侧边菜单/`useTabDocumentTitle` 注册 + zh/en **成对** locale。**偏差声明**：状态用域组合式 `usePodcastChannel` 而非 §九原写的 `stores/podcast.js`（本页单页自持、无跨页共享，与仓内同类页口径一致）；表单↔引擎键名（`category`+`subCategory` ↔ `categoryId`）的唯一映射点是模块级 `channelFormToPayload`/`channelPayloadToForm`，由 `usePodcastChannel-contract.test.js` 证明其承重。**第四刀（2026-10-09）收口渲染端 IPC 入口**：新增 `src/api/podcast-channel.js` 作为本页唯一的桌面端能力取用点（内部走 `electron-bridge.js` 的 `invokeNamespace`，8 个具名导出各自写方法名字面量，理由见 §9.1 同名行），composable 内原自制探测函数删除；`call()` 的形参随之从方法名字符串改为**桥接层函数引用**（字符串派发会让桥接层退化成按变量转发，同样逃过静态对账）；用户可见行为与错误码文案逐字不变（**第五刀例外**：`PODCAST_IPC_UNAVAILABLE` 的成因集合扩大至「未登录 / 许可证未激活」，且该码文案改写为点名三成因并删除「请稍后重试」，见 §9.1 同名行）|
| 视觉回归登记（QM-4） | ✅ **登记与浅色基线均已闭合（2026-10-09 第三刀）**：用例 `podcast-channel` 已**同时**写入两份清单（`tests/visual-testing/views/all-views.visual.test.js` 的 `viewTests` 与 `tests/visual-testing/scripts/run-pixel-tests.js` 的 `pixelTests`），`route=/podcast`、`waitFor=.podcast-channel-page [data-testid="podcast-page-title"]` 两份**逐字一致**（等待条件指向页面主标题本身，页面渲染不出即本条失败；由 `tests/visual-ci.test.js` 的双清单漂移锁守），`base-screenshots/.gitignore` 同步放行 `!podcast-channel.png` 与 `!podcast-channel-dark.png`（根 `*.png` 会静默吞掉基线，漏放行的表现是 CI 永远缺基线而非报错）。本机 `vitest run tests/visual-ci.test.js electron/tests/visual-view-runner.test.js` → 2 files / 34 tests passed。**基线只能取自 CI artifact**（AGENTS QM-4 第 7 条）：首次 `QG Visual` 对本条如预测报 `ERR_VISUAL_BASELINE_MISSING`（上传步骤 `if: always()` ⇒ 失败那次 run 的渲染就是可用来源），已按同一次 run `37840950306` 的 `quality-gate-visual-reports` 回填并自证 0 px——新增 `podcast-channel.png`，并重建被侧栏「播客」条目位移的 8 张（`calendar`/`cloud-publish`/`collection`/`create-editor`/`intelligence`/`keyword-monitor`/`model-providers`/`viral-analysis`，diff 量级同为 473 px、包围盒同一条带，属本次改动而非噪声）；选图复用 `scripts/check-baseline-freshness.js` 的 `findRender()`（优先 `<name>.png`，不另写第二份名字映射），逐张以 SHA-256 比对「落盘字节 == artifact 渲染字节」全部 `OK_0PX`；`check-baseline-freshness` 违规数 8 → **0**（检查 42 张）。**未提 `PIXEL_THRESHOLD`、未加 mask、`KNOWN_DYNAMIC` 仍为空、未提交任何本机截图**。**唯一未闭合＝暗色基线** `podcast-channel-dark.png`：`test:visual:pixel:dark` 只接在 `.github/workflows/visual-test.yml:100`（main push / workflow_dispatch），PR 侧 `QG Visual` 只跑浅色，暗色须合并后由那次 main 的 Visual Tests artifact 回填（白名单锁只要求 `.gitignore` 放行**条目**在位，已满足）。**⚠️ 第四刀使浅色基线重新失效（如实登记）**：该刀把本页 16 处 `font-size` 字面量折进七档设计令牌，16px→`md`(17px)、14px→`base`(15px) 使两处标题各高 1 px，故 run `37840950306` 回填的 `podcast-channel.png` **不再等于下一次渲染**；须按下一次 run 的同一 artifact、同一 `findRender()` 口径重取并逐张 SHA-256 自证 0 px。**PR 侧 `QG Visual` 的 6% 全页容差对 1 px 文本变更天生失明，它报绿不作为基线有效的证据**；权威判据是**同一 job 内的 Gate 7b**（PR 侧 0 px、两轮交集终判，`quality-gate.yml`「Gate 7b - Baseline freshness (PR-side, partial, two-round verdict)」）——它会在**合并前**拦红（两轮皆红=真漂移、非 flake），故回填必须在本 PR 内完成：先推一次、取该 run 的 `quality-gate-visual-reports`（`screenshots/**` 与 `screenshots-round1/**`）回填后再推第二次；合并后 main 那次 Visual Tests 的新鲜度门禁是第二道防线。仍**禁止**提阈值、加 mask、用本机截图充数 |
| OSS/COS 直传（P1 F7~F9） | 🟡 **规则层已实现、尚未接线**：`electron/services/podcast-hosting-upload.js`（托管配置资格 fail-closed、`object_key` 派生禁标题/禁穿越、公网 URL 拼接、OSS V1 待签串结构断言、签名头不外泄凭证、MIME 复用共享实现）+ 34 例锁；除自身测试外无消费者，上传动作与回填 `resolvedAudioUrl` 属 P1 刀（tasks §7） |
| 代托管（P2） | ❌ 规划，未启动（三前置条件见 §三） |
| `api-publish-engine/src/podcast/feed-schema.js` 草稿 | ✅ 已从源码树移出（R3 闭合，见上表 R3 行；仓库内零引用） |
