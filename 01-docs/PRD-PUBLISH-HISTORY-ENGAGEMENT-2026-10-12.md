# PRD：发布记录页作品互动数据回流 + 整卡打开内容页（publish-history-engagement）

> 分支：`publish-history-engagement`；worktree：`D:\Data\projects\mp-worktrees\mp-publish-history-engagement`
> 日期：2026-10-12；类型：运行时代码（主进程采集服务 + IPC/preload + 渲染层 + locale）
> 前序切片：P2-6b 关联键（#2861）、P2-6c 看板（`PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md`）、
> 作品链接目的地判据（`PRD-PUBLISH-HISTORY-PUBLIC-LINK-2026-10-07`，落地为 `usePublishHistoryContentLink.js`）
> 竞品调研：参考产品 4.13.19（本地逆向产物，路径与品牌名不入库）

---

## 〇、一句话

发布记录页的「播放 / 评论 / 点赞 / 收藏 / 分享」五列目前**恒为 `-`**。本切片新增一条**账号级创作者后台数据回流通道**（低频、可调度、按账号 Cookie 认证），把真实互动数写进 `performance_snapshot`；顺带用同一条通道拿回的**真实作品 ID** 回填关联键，让「点整张卡片打开对应内容页」从「多数记录点不动」变成「有内容的记录都点得动」。

---

## 一、现状勘察（逐条可复跑）

### 1.1 五列为空的根因（三处断链，缺一即恒空）

| # | 断链 | 证据 |
| --- | --- | --- |
| A | **落库侧从不写互动字段**。发布历史真源是 JSONL（不是 SQLite），`addRecord()` 纯展开传入对象；两个写入点 payload 里根本没有互动数据（发布瞬间平台也不回传） | `electron/services/publish-history.js:80-100`；`electron/bootstrap/phase4-events.js:109-118`（success）、`:213-220`（failed） |
| B | **渲染端唯一灌数处是旁路 join**，匹配不上即回落 `'-'` | `src/views/PublishHistory.vue:638-661`（`attachPerformanceSnapshots`）、`:1021`（`metricValue` 默认值 `'-'`） |
| C | **旁路 join 自身有四处缺陷**（见 1.2） | 见下 |

> 补注：`electron/services/store/history-store.js:12-29` 的 SQLite 版本同样没有这五列，且全仓生产调用点为 0（`store:add-publish-record` 无生产调用方），是死路，**不在本次改动面内**。

### 1.2 四处缺陷（决定「就算采到了也显示不出来」）

| # | 缺陷 | 位置 | 后果 |
| --- | --- | --- | --- |
| D1 | `performance:list-tracked` **不按归属过滤**且只取第一页 | `electron/ipc-handlers/performance-loop.js:14-29`（`SELECT * FROM tracked_content` 无 owner 条件） | 多归属互相污染；历史早于第 100 条的作品永远取不到 |
| D2 | 渲染端只拉 **100 条** tracked | `src/views/PublishHistory.vue:640`（`pageSize: 100`） | 同上 |
| D3 | join 键 `publish_history_id` **缺 id 时留 NULL** | `electron/bootstrap/phase4-events.js:166`（`task.id` 缺失即 null，只 warn，`:172-176`） | 该记录永久恒空 |
| D4 | 回采只有 **4 个平台**注册 parser，且采的是**公开作品页 HTML** | `electron/services/platform-metrics/index.js:9-11`（zhihu / baijiahao / kuaishou / bilibili），`parse` 用正则匹配页面 | 抖音 / 小红书 / 头条 / 公众号等全部 `unsupported`；且公开页多数需登录，无 Cookie 取不到数 |

### 1.3 本机实测：68 条真实发布记录的可点性与数据面

对 `shared-user-data/publish-history.jsonl` 跑生产判据（`resolvePublishedContentUrl`）实测：

```
CLICKABLE: 10 / 68
  baijiahao success → derived (×9，postId=1874289148083371214 等真实 ID)
  bilibili  success → recorded (BV187pF63EtD)
  douyin / xiaohongshu / toutiao / kuaishou / wechat_mp → 全部 none（0 / 26）
```

被拦下的 12 条中 10 条是快手 `published-<ts>`、2 条是百家号 `task_2_<ts>` —— **形态闸门拦得对**：这些值拼 URL 必然 404。所以「点不动」不是判据过严，而是**落库根本没有真实作品 ID**：

| 平台 | 实际结果 | 证据 |
| --- | --- | --- |
| 抖音 | 4 条 success **全 `mode=dom`**（API 失败降级）；DOM 成功路径返回值里**根本没有 postId** | `electron/services/rpa-view-platforms.js:1052` |
| 小红书 | `draftOnly`，**只进草稿箱未真实发布** ⇒ 无公开作品，卡片点不动是**正确语义** | `rpa-view-platforms.js:1316`、`:478` |
| 头条 | 8 条 success 的 `url` 是空串、无 postId（artifact 未命中） | `rpa-view-platforms.js` + `rpa-view-artifacts.js:152` |
| 快手 | DOM 合成 `published-<ts>` 冒充成功信号 | `rpa-view-platforms.js:827-830` |

`platformWorkId` 是 `result.postId` 的衍生副本，且写入它的审核回查**从未启动**（`AUDIT_REQUERY_VERIFIED_PLATFORMS = Object.freeze([])`，`electron/services/publish-audit-requery.js:33`）⇒ 实测命中 **0 / 68**，不能当回退来源。

### 1.4 为什么必须换数据源（竞品调研结论）

竞品走的是**平台创作者后台自己的数据接口 + 账号 Cookie**，不是抓公开页：

| 平台 | 数据接口 | 返回字段 |
| --- | --- | --- |
| 小红书 | `edith.xiaohongshu.com/web_api/sns/v5/creator/note/user/posted`（列表，需 `X-s`/`X-t` 签名） | `read_count` / `like_count` / `comment_count` / `fav_count` / `share_count` / `imp_count` |
| 抖音 | `creator.douyin.com/web/api/creator/data/item/option/` | `statistics.play_count` / `attitude_count` / `comment_count` / `reposts_count` |
| 快手 | `cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/list`（需 `__NS_sig3`） | `playCount` / `likeCount` / `commentCount` / `collectCount` / `followCount` |
| 头条 | `mp.toutiao.com/mp/agw/creator_center/list`（`need_stat:true`） | `impression_count` / `play_count` / `digg_count` / `comment_count` |

**一次列表请求返回该账号全部作品的指标**，而不是逐个作品抓页面 —— 这是量级差异：100 条作品 = 1 次请求，而非 100 次。该产品的节流参数也与本仓现有一致（24h 周期 + 每页 `Task.Delay(1000)` + 游标去重 + 7 天窗口裁剪），说明「24h 一轮」是行业内的安全取值。

**结论：公开页抓取这条路对国内主流平台结构性不可行，必须换成账号级后台接口。**

---

## 二、目标与非目标

### 目标

- **G1** 新增账号级作品互动回流通道：按账号 Cookie 调创作者后台接口，一次列表拿回该账号全部作品的五项指标。
- **G2** 低频、防封：24h 周期 + 账号间/页间随机抖动 + 单轮上限 + 游标去重 + 失败退避 + 日上限。
- **G3** 数据落 `performance_snapshot`（复用既有表与聚合口径，不新造第二份真源），并按作品 ID 归因回发布记录。
- **G4** 用同一次拉取拿回的**真实作品 ID** 回填 `tracked_content.post_id`，使发布记录的「整卡可点」从 10/68 提升到「有公开内容页的平台都点得动」。
- **G5** 修掉 §1.2 的四处缺陷（归属过滤 / 分页上限 / join 键回退 / 平台覆盖）。
- **G6** 界面如实表达：「数据截至 <时刻>」+ 手动刷新入口 + 四类空态可区分（未采集 / 采集中 / 平台不支持 / 需重新登录）。

### 非目标（明确不做）

- **不做**小红书「仅草稿」记录的链接派生：草稿不是公开作品，`draftOnly` 的卡片点不动是**正确语义**，改为如实显示「草稿（无公开链接）」。
- **不做**账号级粉丝/主页阅读的趋势图（`data-sync` 无时间序列，属另一切片）。
- **不做**逐作品详情接口（`note_detail_new` / `postDetail`）——列表接口已含五项指标，多打一次接口只增加风控面。
- **不动** `SQLite history-store.js`（无生产写入方）。
- **不动** `platform-metrics` 公开页 parser（保留为无 Cookie 时的兜底，不删）。
- **不做**代理池接入（`proxy-pool.js` 存在但账号级拉取走直连，代理是独立的合规议题）。

---

## 三、数据校验（判据全部可测）

### 3.1 输入侧

| # | 判据 | 理由 |
| --- | --- | --- |
| V1 | 只处理 `status === 'active'` 的账号；`expired` / `unverified` 跳过并各自计数 | 拿不到数的账号发请求只会触发风控；且「未登录」与「平台不支持」必须在 UI 上可区分 |
| V2 | Cookie 为空数组 / 无 `web_session`（小红书）等**平台必需的会话 Cookie** 时，判 `needs_login`，**不发请求** | 无会话的请求 100% 被重定向到登录页，纯属浪费风控配额 |
| V3 | 一个账号一轮的请求数上限 = `ceil(作品数 / 页大小)`，硬上限 `MAX_PAGES_PER_ACCOUNT = 10` | 防单个账号被无限翻页拖死；触顶如实返回 `truncated:true`，不静默 |
| V4 | 页间延迟 = `PAGE_DELAY_BASE_MS`(1000) × (1 + 随机 [0, `PAGE_DELAY_JITTER_RATIO`])，默认抖动 0.5 | 固定 1s 是机器特征；竞品用固定 1s，我们在同量级上加抖动，成本不变、特征更弱 |
| V5 | 账号之间串行，账号间延迟取 `resolveIntervals(platform)` 与自身基准的**较大值** | 复用 `publish-frequency-policy` 的既有频控口径，避免同一个账号在「发布」与「采集」两条链上各算一套间隔 |
| V6 | 单轮日上限 `ACCOUNT_DAILY_MAX`（默认 4 轮/账号/天），超出直接跳过并计数 `skipped_daily_cap` | 用户反复点「刷新」不得把额度打光；上限可经 env 覆盖 |
| V7 | 游标去重：记录上一页首条作品 ID，与本页首条相同即 `break` | 平台游标实现有重复页的已知形态（竞品同样处理），不去重会死循环 |
| V8 | 失败退避：单账号连续失败 3 次 → 该账号当轮终止并置 `backoff`，下一轮恢复 | 与既有 `PerformanceRecrawlService` 的 `MAX_CONSECUTIVE_FAILURES = 3` 同口径 |
| V9 | HTTP 非 2xx / 重定向 / 非 JSON 一律判失败并**出声**（记录状态码与平台），绝不把失败当 0 值 | 「取到 0」与「没取到」在界面上必须是两种结论；这是 §1.2 的同族错误 |

### 3.2 输出侧（写库）

| # | 判据 | 理由 |
| --- | --- | --- |
| V10 | 平台返回的指标经 `normalizeMetrics` 归一：非有限数 / 负数 → `null`（**不是 0**） | 0 是「平台说这条是 0」，null 是「没这个字段」。小红书无 `share_count`、微博无收藏，混成 0 就是伪造数据 |
| V11 | 一条作品写一行 `performance_snapshot`（`source = 'account_sync'`），并按 `(platform, post_id)` upsert 到 `tracked_content` | 复用既有表；`source` 区分采集通道，便于排障与回滚 |
| V12 | 归因顺序：① `tracked_content.publish_history_id`；② `(platform, post_id)` 精确命中；③ `(platform, url)` 归一 URL 命中 | 三条按强度递减；②③ 是 §1.2 D3「缺 id 留 NULL」的回退，能救回存量记录 |
| V13 | **写库幂等**：同一 `(tracked_content_id, captured_at 的 UTC 日, source)` 只保留最新一份 | 用户手动连点刷新不得在同一分钟内堆 N 行；按「UTC 日」折叠而非按小时，避免跨零点抖动 |
| V14 | 回填 `post_id` 时**只补空值**（`post_id IS NULL OR TRIM(post_id) = ''`），绝不覆盖既有值 | 与 `tracked-content-link.js` 的既有纪律一致：不覆盖已确立的关联 |
| V15 | 采集全程不改 `recrawl_status`（那是公开页回采链的字段），另立 `account_sync_status` | 两条链的语义不同（一个按作品、一个按账号），共用一个字段必然互相打架 |

### 3.3 归属与安全

- 所有读写带 `owner_subject`，口径与 `publish-history` 的 `matchesOwner` / `_ownerPredicate` **逐字同源**（`LEGACY_OWNER_SUBJECT` 必须 import，禁止手打字符串）。
- Cookie 只在主进程内存中解引用，**不落日志、不进 IPC 返回值、不写快照 `raw` 字段**。日志只记 `accountId` 与平台。
- 渲染端新增通道默认 `authenticated`，无需登记 `license-access-control.js`（未知通道默认档，见 `license-access-control.js:209-213`），但必须过 `withSenderCheck`。

---

## 四、流程

```
【写入链】新增
用户打开应用 / 点「刷新数据」
  → EngagementSyncService.runRound({ reason })
      ├─ 取账号列表（AccountManager.listAccounts，只留 active）
      ├─ 逐账号串行：
      │    ├─ V1/V2 前置校验（登录态 / 必需 Cookie）→ 不合格记 needs_login，跳过
      │    ├─ V6 日上限校验 → 超限记 skipped_daily_cap，跳过
      │    ├─ GET 创作者后台列表接口（带账号 Cookie + 平台签名头）
      │    ├─ 分页循环：V3 页上限、V4 页间抖动、V7 游标去重、V8 失败退避
      │    └─ 每页解析 → V10 归一 → V11 写快照 + upsert tracked_content
      └─ 写 accounts 级状态（last_run_at / 各账号结果计数）

【读取链】修四处缺陷
用户打开发布记录页
  → history:list（JSONL，不变）
  → api.performanceSyncStatus()  ← 新增：拿「数据截至 + 各账号状态」
  → api.listTrackedForHistory(recordIds)  ← 新增：按归属 + 按需分页取 tracked
  → 合并 latest_snapshot 进 record（V12 三级归因）
  → 无快照时按状态渲染空态（未采集 / 采集中 / 平台不支持 / 需重新登录）
```

**为什么触发点是服务内调度 + 手动刷新，而不是渲染端每次进页面都拉**：进页面就拉等于把请求频率交给用户的点击习惯，而风控看到的是**请求密度**。服务侧 24h 一轮保证了下限，手动刷新经 V6 日上限与 V4 抖动约束上限。

**为什么写 `performance_snapshot` 而不是新表**：该表已有五项字段、已有索引 `(tracked_content_id, captured_at)`、已有一处聚合真源（`performance-overview.js`）和一个读侧（发布记录页 / 看板）。新表会立刻产生第二份真源与两处口径漂移。

---

## 五、功能逻辑

### 5.1 适配器注册表（新平台接入 = 加一个文件，核心零改动）

每个平台适配器实现统一接口：

```js
{
  platform: 'xiaohongshu',
  listRequest({ account, cursor, pageSize, cookieHeader }) 
    → { url, method: 'GET'|'POST', headers, body } | { unsupportedReason },
  parseList(responseJson) → { items: [{ postId, url, title, metrics }], nextCursor, hasMore },
  requiredCookieNames: ['web_session'],   // V2
}
```

未注册平台的账号在状态里记 `unsupported` 并点名，界面如实说明「该平台暂不支持自动采集」，**不补 0**。

### 5.2 五项指标的来源与缺失语义

| 指标 | 小红书 | 抖音 | 快手 | 头条 |
| --- | --- | --- | --- | --- |
| 播放 | `read_count` | `play_count` | `playCount` | `play_count` |
| 点赞 | `like_count` | `attitude_count` | `likeCount` | `digg_count` |
| 评论 | `comment_count` | `comment_count` | `commentCount` | `comment_count` |
| 收藏 | `fav_count` | — （无） | `collectCount` | — （无） |
| 分享 | `share_count` | `reposts_count` | — （无） | — （无） |

**平台无该字段时一律 `null`**，界面渲染 `-`。禁止跨字段顶替（例如拿 `imp_count` 当播放）。

### 5.3 整卡点击打开内容页

链路已是现成的（`usePublishHistoryContentLink` → `tabStore.createTab` → 主进程把新标签置为活动标签），本次**不改判据**，只补两件事：

1. **让更多记录能解析出真实作品 ID**：账号同步拿回的真实 post_id 经 V14 只补空地回填，历史记录无需迁移即在渲染期恢复正确。
2. **草稿语义如实化**：`result.draft === true` 的记录，卡片标题提示由「暂无平台公开链接」改为「草稿（未公开，无链接）」，避免用户以为是功能坏了。

**新标签保持前台**：`createNewTabPage` 已设 `self._activeTabId = tabId`（`webview-manager/tab-lifecycle.js:206`）并 `setVisible` + `_repositionAll`，渲染层随 `tab-created` 事件把 `activeTabId` 同步为 `homeShell:false` ⇒ `App.vue` 的 `isHomeTab` watch 调 `setShellMode('browser')` 恢复内嵌视图。这条链本次**不改**，仅补一条回归锁断言「新标签创建后 `setShellMode` 被调为 `browser`」。

---

## 六、交互逻辑与显示项

| 场景 | 卡片行为 | 五列显示 |
| --- | --- | --- |
| 有快照且新鲜 | 整卡可点（指针 + hover 边框），点击开应用内新标签并置前台 | 真实数字 |
| 有快照但超过 24h | 同上 | 真实数字 + 卡片角标「数据截至 X 小时前」 |
| 已登记未采集（`pending`） | 整卡可点（若有链接） | `-`，hover 提示「尚未采集」 |
| 平台不支持（`unsupported`） | 若有链接仍可点 | `-`，hover 提示「该平台暂不支持自动采集」 |
| 需重新登录（`needs_login`） | — | `-`，hover 提示「账号登录已过期，请在账号页重新登录」 |
| 草稿（`result.draft`） | **不可点**，title = 「草稿（未公开，无链接）」 | `-` |
| 采集失败 | 若有链接仍可点 | `-`，hover 提示「上次采集失败（<原因>）」 |
| 未登录应用 | 与既有登录门禁一致 | 不渲染 |

新增控件：

- 列表工具栏「刷新数据」按钮（`data-testid="refresh-metrics"`）：触发 `metrics:sync`；运行中禁用并显示 `正在采集…`；受 V6 日上限约束，达上限时按钮禁用并提示「今日已达采集上限，明天再试」。
- 列表工具栏一行小字：「数据为低频采集（每账号每天最多 N 次），非实时」（N 随 V6 配置渲染）。

新增 locale 键（zh/en 成对，**不得出现中文字面量**）：

`historyPage.metricsRefresh / metricsRefreshing / metricsDailyCapReached / metricsNotRealTime / metricsAsOf / metricsNeverCollected / metricsUnsupported / metricsNeedsLogin / metricsFailed / metricsDraftNoLink / metricsCapHint`

---

## 七、验收标准

### 7.1 测试矩阵（TDD：先写测试后实现）

`electron/services/account-metrics/throttle.test.js`（纯函数）
- T1 页间延迟落在 `[base, base*(1+ratio)]` 且两次调用不相等（V4）
- T2 抖动比例非法/未配置回落默认
- T3 日上限计数与跨日复位（V6）
- T4 连续失败 3 次返回 `backoff`，成功后计数清零（V8）

`electron/services/account-metrics/adapters.test.js`
- T5 四个平台适配器各自把**真实响应夹具**解析为标准 `{postId, metrics}`（断言精确对象）
- T6 平台无该字段 ⇒ `null` 而**不是 0**（V10，逐字段断言）
- T7 `requiredCookieNames` 缺失 ⇒ 返回 `needs_login` 且**不产出请求**（V2）
- T8 未注册平台 ⇒ `unsupported`（不抛错）

`electron/services/account-metrics/index.test.js`（编排，注入假 http 与假 store）
- T9 只处理 `active` 账号；`expired`/`unverified` 跳过并计数（V1）
- T10 分页至 `hasMore=false`；游标重复即 `break`（V7）
- T11 页数触顶 ⇒ `truncated:true` 且请求数 == `MAX_PAGES_PER_ACCOUNT`（V3）
- T12 非 2xx / 非 JSON ⇒ 判失败并带状态码，**不写 0 值快照**（V9）
- T13 账号间串行（断言不并发：假 http 记录调用顺序）
- T14 归属过滤：只写当前 owner 的 `tracked_content`（V12/V14）

`electron/services/store/account-metrics-store.test.js`（真 sqlite，`os.tmpdir()`）
- T15 同日同源幂等：连写两次只有一行（V13）
- T16 回填只补空值，不覆盖既有 `post_id`（V14）
- T17 三级归因：`publish_history_id` 优先，其次 `(platform, post_id)`，再次归一 URL
- T18 读侧按 owner 过滤（不串号）

`electron/ipc-handlers/performance-loop.test.js`（追加）
- T19 `metrics:sync` 信封 `code:0` 且带 `{ran, accounts, skipped, truncated}`
- T20 未登录 ⇒ `AUTH_ERROR`，**不得**返回全零成功信封
- T21 服务缺席 ⇒ 明确错误而非静默成功

`src/views/PublishHistory.test.js`（追加）
- T22 有快照 ⇒ 五列渲染真实数字（不是 `-`）
- T23 平台不支持 / 需登录 / 未采集 / 失败四类空态文案互斥
- T24 草稿记录不可点且 title 为草稿语
- T25 刷新按钮调用 `metricsSync` 且运行中禁用（防连点）
- T26 行数门禁：`PublishHistory.vue` ≤ 1394（零容差，见 §九）

**接线锁**
- T27 `preload` 暴露 `metricsSync` / `metricsSyncStatus` / `listTrackedForHistory`，且 `src/api/*` 有对应封装与兜底信封
- T28 新通道全部带 `withSenderCheck`（Gate 17 比例棘轮）
- T29 新标签打开后 `setShellMode('browser')` 被调用（整卡点击保持前台的回归锁）

### 7.2 反证（必须实跑，逐条变红）

| # | 变异 | 期望变红 |
| --- | --- | --- |
| M1 | 把 `null` 指标写回 0 | T6 |
| M2 | 去掉游标去重 | T10 |
| M3 | 去掉页数上限 | T11 |
| M4 | 非 2xx 也写零值快照 | T12 |
| M5 | 去掉 owner 过滤 | T14/T18 |
| M6 | 回填改成覆盖式 | T16 |
| M7 | 幂等键去掉「UTC 日」 | T15 |
| M8 | 未登录时返回 `code:0` | T20 |
| M9 | 去掉 `withSenderCheck` | T28 |

### 7.3 复跑命令

```bash
cd apps/desktop
pnpm vitest run electron/services/account-metrics electron/services/store/account-metrics-store.test.js \
  electron/ipc-handlers/performance-loop.test.js src/views/PublishHistory.test.js
```

---

## 八、质量门禁映射

- **QM-1**：改 `apps/desktop/electron/` ⇒ 本地 `electron-builder --win --x64` 打包 + asar 清单核对 + 8 秒启动无 stderr 崩溃。
- **QM-2**：require 路径、preload 重建（`pnpm run build:preload`）、IPC 参数纯 JSON、归属单一来源。
- **QM-4**：改 `src/views/PublishHistory.vue` ⇒ 跑 `test:visual:pixel`（本切片新增元素为条件渲染，像素基线需实证）。
- **QM-6**：M+ 跨模块（主进程服务 + 存储 + IPC + preload + 渲染层）⇒ 双模型评审，findings 回写 `.quality-gates.md`。
- **Gate 7**：locale zh/en 成对，模板零中文字面量。
- **Gate 17**：新增 IPC 全部带 `withSenderCheck`。
- **行数门禁**：`PublishHistory.vue` 被 `targets` 点名（`1394`，**零容差**）⇒ 必须先把既有逻辑抽成 composable 腾出空间，再添加界面元素，净增长 ≤ 0。

---

## 九、残余限制（如实登记）

1. **四个平台的接口形态来自竞品逆向与公开资料，未经真机逐个取证** ⇒ 首次接入需一次真实登录态验证；接口返回结构变化会让对应平台退化为 `failed`，不影响其他平台。
2. **小红书签名**：`X-s`/`X-t` 的真源在隐藏创作者页（`electron/signer/xhs-extractor.js`）。若隐藏页不可用，该平台降级为 `unsupported` 而非伪造签名。
3. **快手 `__NS_sig3`**：本仓 `signer-local.js` 的实现是 md5 派生，与平台真实算法可能不一致；接入时以页内 webpack 抽取（`signer-page-manager.js` 的 `kuaishou.ns-sig3-browser`）为准。
4. **草稿记录永远不可点**，这是正确语义而非缺陷。
5. **账号 Cookie 有效期**由平台决定，过期后需用户在账号页重新登录；本切片只如实报告 `needs_login`，不做自动续期。
6. **本机无真实回流数据** ⇒ 数字级验收依赖一次真实账号跑通；离线可验收的是判据、编排、存储与界面四层。
