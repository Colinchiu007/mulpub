---
record: publish-history-engagement
task: 发布记录页作品互动数据回流（播放/评论/点赞/收藏/分享）与整卡打开内容页
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR（publish-history-engagement）尚未合并：远程同步行停在 PENDING，合并后由回填 PR 改写 PASS + merge SHA，并在同一次提交删除本条 frontmatter 三字段与 scripts/gate-record-debt-ledger.json 的登记项
sync_backfill_owner: 本 PR 作者（publish-history-engagement 会话）
---

## 本次执行记录：发布记录页作品互动数据回流 + 整卡打开内容页（publish-history-engagement，2026-10-12）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`electron/services/account-metrics/**`、`electron/services/store/account-metrics-store.js`、`electron/core/register-engagement-services.js`、`ipc-handlers/performance-loop.js`、`preload/knowledge-library.js`、`bootstrap.js`、`bootstrap/{phase1-context,phase5-ipc}.js`、`src/composables/usePublishHistoryMetrics.js`、`src/views/PublishHistory.vue`、`src/composables/usePublishHistoryContentLink.js`、locale 两文件）+ 文档 ⇒ `classify-docs-only` 判 false（混合 PR，不走 docs-only 快通道）；隔离 worktree `D:\Data\projects\mp-worktrees\mp-publish-history-engagement`（D 盘，非 C 盘）、裸分支 `publish-history-engagement`；共享根保持 main |
| 第一性原因（QM-5 ①） | ✅ | 五项互动列恒 `-` 是**三层断链**叠加：① 落库侧从不写互动字段（发布历史真源是 `services/publish-history.js` 的 JSONL，两个写入点 payload 里没有互动数据）；② 渲染端唯一灌数处是旁路 join（`tracked_content.latest_snapshot`），匹配不上即回落 `-`；③ 旁路 join 本身四处缺陷（读侧不按归属过滤、只取第一页 100 条、关联键缺 id 留 NULL、回采只覆盖 4 平台**且抓公开作品页 HTML**）。第三层最致命：对 68 条真实记录跑生产判据实测**可点 10/68**，抖音/小红书/头条/快手/公众号 **0/26**；被拦下的 12 条里 10 条是快手 `published-<ts>` 合成值、2 条是百家号 `task_2_<ts>` ⇒ 形态闸门**拦得对**，缺的是真实作品 ID |
| 数据源决策 | ✅ | 竞品（4.13.19）走**带账号 Cookie 调创作者后台列表接口**：一次请求返回该账号全部作品指标 + 真实作品 ID（100 条作品 = 1 次请求，而非 100 次页面抓取）。用户已确认两项取舍：走后台 API、允许用已保存的账号 Cookie；并明确「可接受非实时」。该决策同时解掉「五列没数」与「卡片点不动」两个需求（同一份响应里带真实作品 ID） |
| TDD | ✅ | 先写合同再写实现。新增/更新 122 条主进程用例 + 14 条 composable + 14 条视图用例全绿（`account-metrics` 6 文件、store、IPC handler、preload 契约） |
| 判据落地（V1–V15） | ✅ | 全部有对应断言：只处理 `active` 账号（T9）；缺必需 Cookie ⇒ `needs_login` 且**零请求**（T9b/T9c）；页上限触顶报 `truncated`（T11）；页间抖动落 `[base, base×(1+ratio)]`（T1）；UTC 日额度（T3/T20c）；游标去重（T10）；连续失败 3 次熔断（T4）；非 2xx/非 JSON **不写 0 值快照**（T12）；缺失字段落 `null` 不补 0（T6 族/T15c/T20c）；归因三级且歧义留空（T17 族）；幂等键 `acct:<trackedId>:<UTC 日>`（T15/T15b）；回填只补空值（T16/T16b） |
| QM-1 打包 | ✅ | ①`cd apps/desktop && pnpm run build:win`（含 `build:vue` 渲染层构建 + `electron-builder --win --x64`）→ **exit 0**，产物 `dist-electron/Multi-Publish.Setup.0.2.0.exe` + `win-unpacked/`；②asar 清单核对（`@electron/asar list`）：`\electron\core\register-engagement-services.js`、`\electron\services\account-metrics\{constants,throttle,adapters,link,index,http,signer-bridge}.js`、`\electron\services\store\account-metrics-store.js` **全部在 app.asar 内**；③extract 后从产物 `require` 成功：`index` 导出 `AccountMetricsService,cookiesToHeader,cookieNameSet`、`adapters.supportedPlatforms()` = `xiaohongshu,douyin,kuaishou,toutiao`、`link` 导出 4 项、`throttle.AccountMetricsThrottle` 为 function |
| QM-4 视觉 | ✅ | 渲染端确有变更（新增「刷新数据」按钮 + 「数据为低频采集，非实时」说明）⇒ 基线必须刷新，且**必须取自 CI 自己的渲染**（QM-4 第 7 条禁止拿本地图当基线）。取证链：CI Gate 7b 两轮 `gate7b-round{1,2}.json` 的**唯一违规**是 `publish-history.png` 889px / `publish-history-dark.png` 955px，**两轮逐字相同 ⇒ 确定性漂移**（两轮交集终判因此拦下）；CI 自渲染两轮亦逐字节同 SHA（`DD69018C…` / `026BB92A…`）；目视核对确认新元素已在图中；同批其余 7 张差异**只出现在本机**（CI 两轮对它们全绿）⇒ 实证本地渲染环境与基线环境不同源，拿本地图当基线会引入新漂移。Gate 7c 暗色对比度本地实测 18 视图 / 低对比 0 / `无退化`（exit 0）；明暗像素套件 `PIXEL_ONLY=publish-history` 均 100% 通过 |
| QM-6 双模型对抗评审 | ✅ 11 条全部处置 | 跨家族双 agent 并行实跑（后端轴 + 前端轴），**共 11 条**（后端 2 CRITICAL / 7 MAJOR / 3 MINOR，前端 3 CRITICAL / 4 MAJOR / 4 MINOR，去重后合计 21 条独立发现）。逐条处置见 §「QM-6 处置」 |
| 行数门禁 | ✅ | `check-max-lines.js` 全绿。过程中两次真触发并按要求**外移**而非抬阈值：① `PublishHistory.vue` 被 `targets` 点名（1394 零容差）⇒ 把旁路合并 + 手工录入外移到 composable，**1393 → 1380**；② `core/container.setup.js` 498 行逼近 limit ⇒ 效果闭环三服务装配外移到 `core/register-engagement-services.js`，**498 → 493**；③ 修复评审时 `account-metrics/index.js` 涨到 505 ⇒ 凭证转换外移到 `cookies.js`，**505 → 446** |
| locale 门禁（Gate 7） | ✅ | `check-locale-sync.js --cjk` PASS（基线 1489，当前 1224，无新增硬编码）、`--keys` PASS（1887 个使用中 key 均在 zh/en）、`--pair-base origin/main` PASS（zh/en 成对）。新增 16 个键成对写入 |
| 品牌残留（Gate 12） | ✅ | `node scripts/check-no-brand-residue.js` PASS（扫描 8099 个 tracked 文件）。文档与代码里一律写「竞品 / 参考产品 4.13.19」，未抄含品牌词的逆向目录路径字面 |
| 远程同步 | PENDING | PR 创建后由 CI 判定；合并后在本行与 `.quality-gates.md` 同名行回填 `PASS` + merge SHA，并同一次提交删除 `scripts/gate-record-debt-ledger.json` 登记项与 frontmatter `sync_status` |

### QM-6 处置（逐条）

**后端轴 CRITICAL（均实测可触发）**

1. **账号级快照把平台缺失字段写成 NULL，而共用聚合口径 `readMetric(null)→0` 且「最新一份 wins」无来源优先级** ⇒ 后跑的 `account_sync` 会把另一条链（`manual`/`auto`）已确立的真实值在读侧抹成 0，并算出一笔假「负差 retreat」（评审实测：`auto(50/30)` + `account_sync(null)` ⇒ totals 归零、`retreats=1`）。
   **处置：upheld，已修**。`applyAccountSyncLinks` 改为**按字段继承**——本次为空的列取该作品最近一份快照的非空值（`inherit(fresh, prev)`）。补三条锁：T20（双源不抹零）、T20b（无历史快照仍为 null，继承不得凭空造数）、T20c（平台真给 0 时不继承——0 是有效值）。
2. **快手 `pcursor` 被当作页码回灌**（逆向真源该端点纯页码分页、从不读 pcursor）⇒ 实测请求 `body.page=[0,0]`、只采到第一页且状态仍报 `ok`；三条分支（无 pcursor / 非数字 / 数字跳页）全坏。
   **处置：upheld，已修**。`parseList` 改为 `nextCursor: null` + `hasMore: list.length > 0`（编排层按页码自增）；新增 T5b **round-trip 锁**（把响应喂回 `buildListRequest`，断言 `page` 必须前进而不是回到 0）。

**后端轴 MAJOR**

3. **`truncated` 在空页 break 与游标去重 break 后都误报为 true** ⇒「正常采完」被报成「触顶截断」。**upheld，已修**：引入 `exhaustedPages` 显式标志，只有 for 条件自然耗尽才为真；补 T30/T30b（自然结束必须 `truncated` 为 undefined / `counts.truncated` 为 0）。
4. **小红书签名基址用绝对 URL，而发布链默认 `pathname + search`** ⇒ 签名不匹配、采集恒被拒。**upheld，已修**：`signer-bridge` 新增 `signBaseUri()`（默认路径口径，`MP_XHS_SIGN_URI=absolute` 时用绝对），补 `signer-bridge.test.js` 3 条 + 签名结果形态 4 条。
5. **头条把 `impression_count`（展现量）当播放量**，且 T6b 把该顶替写成正向断言。**upheld，已修**：`views` 只取 `play_count`，缺失如实 `null`；T6b 改为断言 `null`。同时按评审建议为抖音的 `digg_count/share_count/forward_count` 与数据中心口径 `attitude_count/reposts_count` 互为候补（同义字段，非跨语义顶替）。
6. **过期 Cookie 无任何路径能落到 `needs_login`**（200 + 业务码会被归成 `failed`，界面给出的下一步动作就错）。**upheld，已修**：`adapters` 新增 `throwIfLoginRequired()`（抖音 `status_code=8`、`success=false + code ∈ {-100,401}`），编排层据 `err.needsLogin` 记 `needs_login`；补 T2b（适配器层）与 T31（编排层）。
7. **写侧读 tracked 失败被静默吞掉**（`ran:true / synced=N` 而 snapshots=0，与「库真的坏了」不可区分）。**upheld，已修**：`tracked.error` 非空 ⇒ 出声并记 `writeError`、不写快照；补 T33。`truncated` 也带入结果。
8. **读侧静默 500 条上限**（第 501 条起连 `missing` 都不含）。**upheld，已修**：composable 按 500 分批请求并合并（超出即分批，不再静默丢）；`nextCursor` 语义随之收敛到适配器。
9. **`performance:list-tracked` 仍无归属过滤且暴露在渲染端**（D1 的遗留通道，可读到所有归属的 tracked 与快照）。**upheld，已修**：补 `withSenderCheck` + 归属过滤（与 `performance:overview` 同口径），快照读改走带归属 JOIN 的批量接口。

**后端轴 MINOR**

10. **采集状态分桶无锁**（夹具 stub 丢掉 owner 参数）。**upheld，已修**：改 owner 感知 stub，补 T21（user-A 写、user-B 读不到）。
11. **`_throttle` 单例与「每次重读 env」注释矛盾**（改 env 只有一半生效）。**upheld，已修**：按参数签名重建；补 T34。
12. **V8 熔断是空壳**（达阈值只让错误串多一段 `:backoff`）。**upheld，如实登记为已知限制**：本切片把 `:backoff` 保留为**可观测标记**（状态里可见），真正「达阈值后跳过当日剩余轮次」需把熔断态落 settings 以跨重启生效，属独立切片 —— 已写入 PRD §九残余限制，不假装已闭合。

**前端轴**

13. **CRITICAL：手动录入整条链是死路**（`applyMetrics` 不回填 `trackedId`；`openManualEntry` 在 main 上就无任何调用点）。**upheld，已修**：`applyMetrics` 回填 `trackedContentId`，`submitManualSnapshot` 回退该字段；详情弹窗补触发点（仅在无指标时出现）；保存按钮加 `manualSaving` 禁用。
14. **CRITICAL：`applyMetrics` 丢弃 `postId`** ⇒ G4「整卡可点从 10/68 提升」在渲染侧完全没兑现（评审探针实测：卡片无 `is-clickable`、title 恒「暂无平台公开链接」）。**upheld，已修**：`record.platformWorkId = record.platformWorkId || m.postId`（只补空值）；补 3 条锁（可点 + 打开到派生 URL、不覆盖既有值、采集失败出声）。
15. **CRITICAL：并发 `loadMetrics` 丢失更新**（筛选补页逐页触发，旧响应晚到会把已采数据整体覆盖回「尚未采集」）。**upheld，已修**：自增 `_loadSeq` 守卫 + 过期响应丢弃；失败路径保留旧数据。
16. **MAJOR：`metricsError` 零消费者**（采集/刷新失败对用户完全不可见）。**upheld，已修**：工具栏新增 `metrics-error` 提示（`role="alert"`），补视图用例。
17. **MAJOR：`dailyCapReached` 只读上一次 run 的持久化状态**。**upheld，已修**：两档判据 —— 本轮结果优先，回落持久化状态时**只认当日**（UTC 日）；补 3 条锁（当日判真 / 昨日不锁 / 本轮优先）。
18. **MAJOR：`latestCapturedAt` 取最大值 ⇒ 一条新鲜记录漂白整页陈旧记录**。**upheld，已修**：新增卡片级新鲜度提示（超过 24h 才出声，`metricsStale` 键），文案与总览行共用 composable 的 `captionFor`；补视图用例。
19. **MAJOR：草稿记录可能「title 说草稿、卡片仍可点」**。**upheld，已修**：`isCardClickable` 改为 `!isDraftRecord(record) && Boolean(publicLinkHref(record))`。
20. **MINOR：`publish-history-metrics.test.js` 最后一条只断言 `exists()`，是恒真假锁且用例名冒充 D3 凭证**。**upheld，已修**：改为断言 `.is-clickable` + title + 点击后打开的派生 URL（现已能真实变红）。
21. **MINOR：`metricsSyncStatus` 零调用方**。**upheld，已修**：列表为空时仍拉一次状态（避免归因引用与当前列表无关的旧状态）。
22. **MINOR：`rank` 表 `?? 9` 漏项**。**upheld，已修**：补 `skipped_daily_cap: 3`，并把该状态的提示语指向「今日采集次数已用完」而不是「尚未采集」。

**评审明确核查但不成立（记录以免误报）**：归属三态落桶与 SQL 谓词正确（T19c/T17b/T18d 真 sqlite 通过）；幂等键不与 `auto`/`manual` 互撞；同日双源不会被算成两天；`start()/stop()` 定时器均 `unref()`；require 路径与 `parseEnvNumber` 签名一致；T10/T11/T13 是真锁（T13 偏弱，已按建议补「两个账号都真的发过请求」的前置断言以加固）。

### 残余限制（不假装已闭合）

1. 四平台接口形态来自竞品逆向与公开资料，**未经真机逐个取证**；接口变更会让对应平台退化为 `failed`，不影响其他平台。
2. 小红书签名依赖隐藏创作者页；快手的设备指纹只从 Cookie 取。取不到时如实记 `unsupported`，**不伪造签名硬发**。
3. V8 熔断目前是**可观测标记**而非行为闸门（见 QM-6 处置 12）；跨重启的额度/熔断持久化属独立切片。
4. 草稿记录永远不可点 —— 这是正确语义而非缺陷。
5. 账号 Cookie 过期需用户在账号页重新登录；本切片只如实报 `needs_login`，不做自动续期。
6. 本机无真实回流数据 ⇒ 数字级验收依赖一次真实账号跑通；离线可验收的是判据、编排、存储、IPC 门禁与界面五层。
