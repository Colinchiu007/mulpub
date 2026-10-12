# 设计：发布记录页作品互动数据回流（publish-history-engagement）

## 1. 数据源选择（本设计的第一性问题）

### 1.1 被否掉的方案：继续扩公开页 parser

现方案（`services/platform-metrics`）抓的是**公开作品页 HTML + 正则**，已注册 4 个平台。实测它对本需求
结构性不可行：

| 平台 | 公开页可取性 | 证据 |
| --- | --- | --- |
| 抖音 | 作品页对无 Cookie 请求返回登录/风控页 | 68 条真实记录里 4 条 douyin success **全部 `mode=dom`**（API 失败降级），且 DOM 成功路径返回值里**没有 postId**（`rpa-view-platforms.js:1052`） |
| 小红书 | 需 `web_session`；发布本身是 `draftOnly`，页面上根本没有公开作品 | `rpa-view-platforms.js:1316` |
| 头条 | 页面指标在打包脚本里，正则命中率低 | 8 条 success 的 `url` 是**空串**、无 postId |
| 快手 | 无 Cookie 取不到 | 10 条 success 的 postId 全是合成值 `published-<ts>` |

放宽判据只会把「点不动」变成「点了 404 / 点了登录页」——**更差的失败模式**（PRD §1.3 已逐条论证）。

### 1.2 采用的方案：账号级创作者后台列表接口

竞品（蚁小二 4.13.19）逐个平台的实现已逆向清楚，端点、请求形态、返回字段见 PRD §1.4。
关键性质有两条：

1. **一次请求返回该账号全部作品的指标** —— 100 条作品 = 1 次请求，而不是 100 次页面抓取。
   请求数下降两个数量级，这是「防封」最有效的手段（比调延迟参数有效得多）。
2. **同一份响应里带真实作品 ID** —— 这正好也是「整卡可点」缺的那份证据。一个数据源同时解掉两个需求。

## 2. 架构

```
[调度] bootstrap.js
  └─ accountMetricsService.start()            60s 首轮 + 24h 一轮
       └─ runRound({ reason, ownerSubject })
            ├─ 归属解析：调用方给 / 问 identityService / undefined=legacy
            │    └─ null（有身份服务但认不出）⇒ 整轮跳过（fail closed）
            ├─ listAccounts()（Python 后端 /api/accounts）
            ├─ 逐账号【串行】：
            │    ├─ adapter = getAdapter(platform)   无 ⇒ unsupported
            │    ├─ throttle.canRun(accountId)       否 ⇒ skipped_daily_cap
            │    ├─ loadSavedCredentials()           缺必需 Cookie ⇒ needs_login（不发请求）
            │    ├─ adapter.requiresSigner && !signer ⇒ unsupported（不伪造签名）
            │    └─ 分页循环（页上限 10 / 页间抖动 / 游标去重 / 失败熔断）
            │         └─ parseList → items[{ postId, title, publishedAt, metrics }]
            ├─ planWorkLinks({ trackedRows, works, records })   一级 post_id → 二级 标题+时间（唯一才认）
            └─ applyAccountSyncLinks({ links })                写快照 + 只补空值回填 post_id

[读取] PublishHistory.vue
  └─ usePublishHistoryMetrics.loadMetrics()
       └─ IPC performance:history-metrics { taskIds }
            └─ store.getHistoryMetricsByTaskIds(taskIds, owner)
                 └─ tracked_content ⨝ performance_snapshot（每行最新一份）
       └─ 回填 record.views/likes/... + metricHint(record) 四分类空态
```

## 3. 关键决策与理由

### D1 为什么写 `performance_snapshot` 而不是新表

该表已有五项字段、已有 `(tracked_content_id, captured_at)` 索引、已有一处聚合真源
（`performance-overview.js`）与两个读侧（发布记录页 / 数据看板）。新表会立刻产生**第二份真源**与两处口径漂移。
代价是同一张表出现两种 `source`（`auto` = 公开页回采、`account_sync` = 账号级、`manual` = 手工），
这一维恰好是我要的可区分性（排障时能知道数字从哪条链来）。

### D2 为什么幂等键是「UTC 日」而不是「小时」或「每次」

- 按「每次」：用户连点刷新会在同一分钟堆 N 行；`performance-overview` 的日增趋势会把同一天的多次采集
  算成多天增量 ⇒ 趋势图假峰。
- 按「小时」：跨零点抖动会在 UTC 日边界附近产出两行，同样污染日增。
- 按「UTC 日」：一天一份，与日增趋势的最小粒度天然对齐。日期键取 **UTC 日**而不是本地日，
  因为派生它的时间戳全程以 ISO 存储、排序也在 UTC 上做。

### D3 为什么归因的二级判据要求「候选唯一」

真实数据里 58/68 条记录没有作品 ID，二级判据（标题 + 时间窗）是救回它们的唯一路径。
但「同名」在自媒体场景极其常见（同一系列、批量发布、标题被平台截断）。
本仓既有纪律已经给出答案：`tracked-content-link.js` 的「(platform, post_id) 恰好命中 1 条才补，
**歧义必须留空，不许猜**」。猜错的关联把 A 作品的播放数挂到 B 作品的记录上，比「没有数据」更伤——
用户会据此判断「这篇爆了」并重复一个其实没爆的选题。

### D4 为什么会话校验放在发请求之前

缺会话 Cookie 的请求 100% 被平台重定向到登录页：纯属浪费风控配额，而且会把「没登录」误记成
「平台不支持」。两类结论在界面上的下一步动作完全不同（去登录 vs 无需操作），必须分开计数。

### D5 为什么非 2xx / 非 JSON 不写「零值快照」

「取到 0」与「没取到」是两种结论。写 0 会让界面显示一个看起来像真数据的 0，且 `performance-overview`
会把它计入总量（虚低）。本仓同族纪律：审核状态无定论不落库、队列状态无定论记 `unclassified`。

### D6 为什么 `platform-metrics` 的 `recrawl_status` 不复用

两条链的粒度不同（一个按作品、一个按账号）。共用一个字段必然互相打架：账号级采集成功会把某个作品的
`recrawl_status` 从 `failed` 改成 `ok`，而那个作品的公开页回采其实仍然失败。故账号级状态另存
`settings` 的 `account_metrics_sync_state`（按归属分桶）。

### D7 为什么渲染端逻辑必须落 composable

`PublishHistory.vue` 被 `.github/scripts/check-max-lines.js` 的 `targets` 点名（1394 行、**零增长容差**，
超一行即 `TARGET_GREW` 阻断）。本次把既有逻辑（旁路合并 + 手工录入 ≈ 46 行）整体外移，
净减到 1380 行后才有空间加界面元素。这是「加功能」与「行数门禁」二者兼得的唯一路径。

### D8 为什么 `container.setup.js` 的装配外移

该文件原本 498 行（limit=500，`lines >= limit` 即阻断）。加 25 行装配会直接触发 `NEW_OVER_LIMIT`。
把「效果闭环三服务」（回采 / 归因 / 账号级采集，同属一条业务链）整体移到
`core/register-engagement-services.js` 后为 493 行，既过门禁又提升了内聚。

## 4. 平台适配器契约

```js
{
  platform: 'xiaohongshu',
  displayName: '小红书',
  requiredCookieNames: ['web_session'],   // 缺任一 ⇒ needs_login，不发请求
  requiresSigner: 'xiaohongshu',          // 取不到签名器 ⇒ unsupported，不伪造
  buildListRequest({ cursor, pageSize })  // ⇒ { url, method, headers, body } | { unsupportedReason }
  parseList(json)                         // ⇒ { items: [{ postId, title, publishedAt, metrics }], nextCursor, hasMore }
}
```

`parseList` 的**契约**（三条不可破）：

1. 结构不符**抛错**（编排层记 `parse_error` 判失败）—— 不得返回空数组冒充「这个账号没作品」；
2. 平台无该字段 ⇒ `null`（不是 0）—— 快手列表给的是涨粉量不是分享数、抖音/头条不返回收藏数，
   顶替等于伪造数据；
3. 无 `postId` 的条目丢弃 —— 拼不出链接也归不了因。

## 5. 判据清单（与 PRD §三 一一对应）

| # | 判据 | 落点 | 测试 |
| --- | --- | --- | --- |
| V1 | 只处理 `active` 账号 | `index.js` | T9 |
| V2 | 缺必需 Cookie ⇒ `needs_login` 且不发请求 | `index.js` | T9b/T9c |
| V3 | 页数硬上限 10，触顶报 `truncated` | `index.js` | T11 |
| V4 | 页间延迟 = base ×(1+random[0,ratio]) | `throttle.js` | T1/T1b |
| V6 | 单账号每 UTC 日 ≤4 轮 | `throttle.js` | T3/T3b/T20c |
| V7 | 游标首条重复即 `break` | `index.js` | T10 |
| V8 | 连续失败 3 次转 backoff | `throttle.js` | T4 |
| V9 | 非 2xx / 非 JSON ⇒ 失败，不写 0 值快照 | `index.js` | T12 |
| V10 | 指标缺失 ⇒ `null` 不是 0 | `adapters.js` + store | T6 族 / T15c |
| V11 | 一条作品一行快照，`source='account_sync'` | store | T15 |
| V12 | 归因三级（`publish_history_id` → `post_id` → 标题+时间） | `link.js` | T17 族 |
| V13 | 幂等键 = `acct:<trackedId>:<UTC 日>` | store | T15/T15b |
| V14 | 回填只补空值，绝不覆盖 | store | T16/T16b |
| V15 | 不改 `recrawl_status` | store | D6 决策 |

## 6. 残余风险（如实登记，不假装已闭合）

1. **四个平台的接口形态来自竞品逆向与公开资料，未经真机逐个取证**。首次接入需一次真实登录态验证；
   接口变更会让对应平台退化为 `failed`（不影响其他平台）。
2. **小红书签名**依赖隐藏创作者页（`electron/signer/xhs-extractor.js`）。隐藏页不可用时该平台降级
   `unsupported`，不伪造签名。
3. **快手 `__NS_sig3`**：本仓 `signer-local.js` 的实现是 md5 派生，与平台真实算法未必一致；
   采集侧因此**不自行签名**，只取 Cookie 里的 `kuaishou.web.cp.api_ph`，取不到即 `unsupported`。
4. **草稿记录永远不可点**，这是正确语义而非缺陷。
5. **账号 Cookie 过期**后需用户在账号页重新登录；本切片只如实报 `needs_login`，不做自动续期。
6. **本机无真实回流数据** ⇒ 数字级验收依赖一次真实账号跑通；离线可验收的是判据、编排、存储、
   IPC 门禁与界面五层。
