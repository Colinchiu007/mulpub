# 发布记录页作品互动数据回流 + 整卡打开内容页（publish-history-engagement）

## Why

发布记录页的「播放 / 评论 / 点赞 / 收藏 / 分享」五列**恒为 `-`**，用户明确报障「这些信息都没有获取」。
根因不是展示层，而是**三层断链叠加**（可复跑取证见 `01-docs/PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12.md` §1）：

1. **落库侧从不写互动字段** —— 发布历史真源是 JSONL（`services/publish-history.js:80-100`），
   两个写入点的 payload 里根本没有互动数据（发布瞬间平台也不回传）；
2. **渲染端唯一灌数处是旁路 join** —— `PublishHistory.vue` 从 `tracked_content.latest_snapshot`
   合并，匹配不上即回落 `'-'`；
3. **旁路 join 自身有四处缺陷** —— 读侧不按归属过滤、只取第一页 100 条、关联键缺 id 时留 NULL、
   回采只覆盖 4 个平台**且抓的是公开作品页 HTML**。

第 3 条的最后一节是最致命的：公开作品页对国内主流平台**结构性不可行**（需登录、指标在打包脚本里）。
实测 68 条真实发布记录的可点性与数据面：

```
CLICKABLE: 10 / 68
  baijiahao → derived（9 条，真实 ID）
  bilibili  → recorded（1 条）
  douyin / xiaohongshu / toutiao / kuaishou / wechat_mp → 全部 none（0 / 26）
```

被形态闸门拦下的 12 条里 10 条是快手 `published-<ts>`、2 条是百家号 `task_2_<ts>` —— **拦得对**
（这些值拼 URL 必然 404）。所以真正缺的是**真实作品 ID**，而它和互动数据是同一个源头问题。

竞品（参考产品 4.13.19，本地逆向产物路径不入库）的做法给出了行业答案：
**带账号 Cookie 调平台创作者后台自己的列表接口**，一次请求返回该账号全部作品的指标与真实作品 ID。
量级差异是「100 条作品 = 1 次请求」而非 100 次页面抓取；其节流参数（24h 周期 + 每页 1s）与本仓
既有回采链同量级，说明这是安全取值。

用户已确认两项取舍：**① 走创作者后台 API（对齐竞品）；② 允许用已保存的账号 Cookie**，
并明确「可以接受非实时数据，主要给用户一个大概参考」。

## What Changes

- **NEW** `apps/desktop/electron/services/account-metrics/`（五个模块 + 单测）
  - `constants.js`：配置真源（24h 轮次 / 页间基准 1s + 抖动 / 单账号单轮页上限 / 单账号日上限 / 失败阈值），
    env 覆盖非法值**回落默认并出声**。
  - `throttle.js`：节流与熔断（页间抖动、UTC 日额度、连续失败 3 次转 backoff）。纯逻辑、`nowMs` 由调用方给。
  - `adapters.js`：**四个平台适配器**（小红书 / 抖音 / 快手 / 头条），统一接口
    `{ platform, requiredCookieNames, requiresSigner, buildListRequest, parseList }`。
    端点逐个标注逆向来源函数名。**平台无该字段一律 `null`，不补 0、不跨字段顶替**。
  - `link.js`：归因（一级 `post_id` 精确；二级 归一标题 + 时间窗，**候选唯一才认**，歧义留空）。
  - `index.js`：编排（只处理 `active` 账号、会话校验在发请求之前、分页节流、非 2xx 判失败**不写 0 值快照**）。
  - `http.js`：最小传输层（超时、失败返回状态码而不抛错、日志不落 Cookie）。
  - `signer-bridge.js`：把既有发布链签名器接成采集侧形状，**fail-closed**（签不出即 `unsupported`，绝不硬发）。
- **NEW** `apps/desktop/electron/services/store/account-metrics-store.js`（store mixin）
  - `getHistoryMetricsByTaskIds`：**发布记录页的唯一指标读口**，一次 SQL 完成
    「任务 id → tracked 行 → 每行最新一份快照」并带 `postId`（修 D1/D2）。
  - `applyAccountSyncLinks`：写快照 + **只补空值地**回填 `post_id`（V14）；幂等键
    `acct:<trackedId>:<UTC 日>`（同日同源只留一份）。
  - `getLatestSnapshotsForTrackedIds` / `getAccountSyncState` / `setAccountSyncState`。
- **NEW** `apps/desktop/electron/core/register-engagement-services.js`：效果闭环三服务装配外移
  （回采 / 归因 / 账号级采集），同时把 `container.setup.js` 压回 500 行门禁内。
- **MODIFIED** `electron/ipc-handlers/performance-loop.js`：新增三个通道
  `performance:history-metrics`（读指标，AUTH_ERROR 门禁与 `performance:overview` 同口径）、
  `metrics:sync`（手动触发一轮）、`metrics:sync-status`；三个都带 `withSenderCheck`。
- **MODIFIED** `electron/preload/knowledge-library.js` + 重建 `index.bundle.js` /
  `home-shell-preload.bundle.js`（`pnpm run build:preload`）；`src/api/knowledge-library.js` 对应封装。
- **MODIFIED** `electron/bootstrap.js`：注入归属解析器（identityService 在 `servicesResult` 上，
  容器装配期拿不到）+ 启动调度器（60s 首轮 + 24h 一轮）。
- **NEW** `src/composables/usePublishHistoryMetrics.js`：取数、空态四分类、刷新、数据截至、手动录入。
- **MODIFIED** `src/views/PublishHistory.vue`：接入该 composable，**净减 13 行**
  （1393 → 1380；该文件被行数门禁 targets 点名、零增长容差），新增刷新按钮与非实时说明。
- **MODIFIED** `src/composables/usePublishHistoryContentLink.js`：草稿语义（`result.draft === true` ⇒
  title 为「草稿（未公开，无链接）」，点不动是**正确语义**）。
- **MODIFIED** locale `history-page/{zh,en}.js`：15 个新键成对新增。
- **NEW** 文档：`01-docs/PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12.md`、本 change 五件套、
  `openspec/records/publish-history-engagement.md`、CHANGELOG、`01-docs/learnings.md`。

## 明确不做（防范围蔓延）

- 不做小红书 `draftOnly` 记录的链接派生（草稿不是公开作品）。
- 不做账号级粉丝/主页阅读趋势（`data-sync` 无时间序列，属另一切片）。
- 不做逐作品详情接口（列表已含五项指标，多打一次只增加风控面）。
- 不动 SQLite `history-store.js`（全仓无生产写入方）。
- 不删既有 `platform-metrics` 公开页 parser（保留为无 Cookie 场景的兜底）。
- 不接代理池（代理是独立的合规议题）。

## Impact

- **数据面**：新增 `performance_snapshot` 的 `source='account_sync'` 行；`tracked_content.post_id`
  在**原本为空**时被回填（不覆盖既有值）。**无 schema 变更、无迁移**。
- **网络面**：新增对 4 个平台创作者后台的 GET/POST（低频：每账号每天 ≤4 轮、单轮 ≤10 页、
  页间 1–1.5s 抖动、账号间串行）。
- **安全面**：Cookie 只在主进程内存解引用，不落日志、不进 IPC 返回值、不写快照 `raw`；
  读侧全部按 `owner_subject` 过滤（SQL 层），未登录 = `AUTH_ERROR` 而非空数据。
- **门禁面**：`container.setup.js` 因本次改动一度触发 `NEW_OVER_LIMIT`，已按「同域装配外移」解决；
  `PublishHistory.vue` 保持零增长并净减。
