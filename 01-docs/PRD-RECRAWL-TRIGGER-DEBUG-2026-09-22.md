# PRD：立即回采调试入口（发布→回采→写回爆款库 第四链路可观测化）

- 日期：2026-09-22
- 分支/worktree：`local/recrawl-trigger`（D 盘隔离 worktree `mp-recrawl-trigger`）
- PR：#2210
- 关联模块：`apps/desktop/electron`（performance-loop IPC / performance-recrawl-service / performance-loop-store / preload）

## 1. 背景与问题

爆款分析应用的四条链路：①采集 ②热榜 ③爆款分析×改写 ④**发布→回采→写回爆款库**。前三条已实证线上闭环；第四链路此前只有单元测试契约，线上无法观测「回采结果按 norm_url 写回爆款库」的真实闭环。

根因（三重时序锁死）：

1. 发布成功的 `phase4-events` 登记 `tracked_content` 时，首采排期为 `nextRecrawlAt = now + 1h`（T+1h 首采），新帖 1 小时内不入回采队列。
2. 回采调度器 `PerformanceRecrawlService.start()` 仅「启动后 30s / 每 24h」各跑一轮 `processRound`。
3. IPC `performance:trigger-recrawl` 原为**空壳**：只 `return { supported }`，从不执行 `processRound`，用户/调试无法主动催一轮回采。

结论：会话内既不能自然等到 T+1h，也没有手动催采入口，第四链路「当场观测写回」不可能。

## 2. 目标

把空壳 `performance:trigger-recrawl` 升级为「**立即回采**」调试入口：一键触发一轮巡检，且 `force` 模式忽略 T+1h 到期排期、纳入 7 天窗口内全部可回采条目，从而当场观测「回采→爆款库写回」闭环。**不改动数据写回逻辑本身**，仅增强触发能力。

## 3. 功能规格

### 3.1 store：`listDueForRecrawl(nowMs, opts)`

- 新增可选 `opts.force`（默认 `false`，向后兼容无参调用）。
- `force === true`：忽略 `next_recrawl_at` 到期排期，纳入 7 天窗口内 `recrawl_status ∈ (pending, ok, failed)` 的全部条目（`LIMIT 50`），仍按 `next_recrawl_at ASC` 排序。
- `force` 缺省/false：维持原语义——`next_recrawl_at IS NOT NULL AND next_recrawl_at <= now` 的到期条目。
- 7 天窗口与状态过滤在两种模式下都保留（不放宽数据边界，只放宽时间排期）。

### 3.2 service：`processRound(opts)`

- 透传 `opts` 给 `listDueForRecrawl(Date.now(), opts)`；无参调用行为不变。

### 3.3 IPC：`performance:trigger-recrawl`

- 由空壳改为实跑：`await performanceRecrawlService.processRound({ force })`。
- `force = Boolean(opts && opts.force)`。
- 返回 `{ code, data: { supported, ran, force } }`；`ran` 表示本轮是否真正执行（service 不可用时为 `false`，不抛错）。
- `withSenderCheck` 受信 sender 校验保持。

### 3.4 preload

- `triggerPerformanceRecrawl(opts)` 透传参数至 IPC。

## 4. 验收标准

- AC-1：`force=true` 时，`processRound` 收到 `{force:true}`，且窗口内未到期（T+1h 内）的可回采条目被纳入本轮。
- AC-2：缺省 opts 时，`processRound` 收到 `{force:false}`，仅纳入已到期条目（原语义不变）。
- AC-3：`force` 仍守 7 天窗口——窗口外（>7 天）条目不纳入。
- AC-4：service 缺失/不可用时，`ran=false` 且不抛异常（fail-safe）。
- AC-5：QM-1 本地打包通过，改动的 5 个源文件均在 `app.asar` 内。

## 5. 测试

- 新增 `apps/desktop/electron/ipc-handlers/performance-loop.test.js`（electron mock 范式）：覆盖 AC-1/AC-2/AC-4。
- `apps/desktop/tests/performance-loop-store.test.js`（真 sqlite）：force 纳入未到期 vs 默认过滤；force 仍守 7 天窗（AC-1/AC-3）。
- `apps/desktop/tests/performance-recrawl-service.test.js`：`processRound({force:true})` 透传；首参为 number（AC-2 兼容）。
- 目标用例本地全绿（18 passed）。全量套件由 CI 权威运行。

## 6. 非目标 / 边界

- 不改 `_writeBackViral` / `updateViralEngagementByNormUrl` 的写回与单调不减规则。
- 不改发布登记 `nextRecrawlAt = now + 1h` 的产品默认排期（force 只在显式调用时绕过排期）。
- 本入口定位为调试/运维催采，不改变常规 24h 自动巡检调度。

## 7. 线上实证记录：第四链路写回闭环（2026-09-23，mp-app-live2）

**方法**（种子数据 + 强制触发 + 真实公开 API，不改任何代码）：

1. 停 app（shared-user-data 先热备份 `shared-user-data.backups\seed-<ts>\`）后用 Node 22 `node:sqlite` 直写 `multi-publish.db` 灌种子（幂等：先 DELETE 固定 id 再 INSERT）：`viral_library.vv-seed-bili-0001`（platform=bilibili、url=`https://www.bilibili.com/video/BV1YDhJ6ZEL6`、likes/comments=NULL 基线）+ `tracked_content.tc-seed-bili-0001`（post_id=BV1YDhJ6ZEL6、recrawl_status=pending）。**必须停 app 改文件再重启**——store 是 sql.js 内存库（启动读一次、每 5s 整库 persist 覆盖），运行中外部写入不可见且会被覆盖。
2. 重启载入后 CDP（:9279）调 `triggerPerformanceRecrawl({ force: true })`，返回 `{ ran: true, force: true, supported: [zhihu, baijiahao, kuaishou, bilibili] }`。
3. 回采走真实代码路径：`getParser('bilibili')` → `resolveContentUrl` → 免登录公开 API `api.bilibili.com/x/web-interface/view?bvid=` 取真实互动 → `addPerformanceSnapshot` → tracked→ok → `_writeBackViral` 按 `_normUrlForMatch` 命中种子爆款行 → `updateViralEngagementByNormUrl` 写回。

**证据（内存读回 + 盘上读回双确认）**：

| 指标 | 回采前 | 回采后 |
|---|---|---|
| viral_library.likes | NULL | 111,760 |
| viral_library.comments | NULL | 8,774 |
| tracked_content.recrawl_status | pending | ok（last_recrawl_at=2026-09-22T16:23:07Z UTC） |
| performance_snapshot | 无 | +1（source=auto；views=977,406 / favorites=19,887 / shares=14,605） |

db 文件只读复验（persist 落盘后）：`FILE viral.likes=111760 comments=8774 tracked=ok snaps=1`，与 CDP 内存读回一致。**结论：第四链路「发布→回采→写回爆款库」在线上运行层面闭合，不再只是单测契约**（本入口 `force` 语义 AC-1 同时得到真实数据验证）。

**实证暴露的边界**：写回仅对 platform-metrics 已注册 4 平台（zhihu/baijiahao/kuaishou/bilibili）生效；快手/B站为视频平台，图文 `publish:batch` 产不出可回采锚点，「不灌种子的自然闭环」待视频发布链路 + parser 覆盖面扩展。种子行经用户决定保留为常态验证样本，还原点见上述备份目录。
