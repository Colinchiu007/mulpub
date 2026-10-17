---
branch: fix-release-window-taken-type-mismatch
date: 2026-10-17
sync_reason: PR 尚未合并，远程同步状态待合并后回填（本 PR 的收尾动作）
sync_backfill_owner: 本会话（fix-release-window-taken-type-mismatch）
---

# 本次执行记录：「未提交失败」从不回滚间隔窗口——判据在 SQLite TEXT 列上恒为 false（fix-release-window-taken-type-mismatch，2026-10-17）【混合 PR】

> task: 用户报告「发布一条视频到多个平台，其他平台正常/排队 1、2 分钟，视频号却显示『等待间隔 等待 59 分钟后重试（本账号间隔）』，
> 而视频号本账号短期并没有发布内容」，要求查原因并修复，同时排查图文发布与其他平台是否有同样情况。

| 项 | 内容 |
| --- | --- |
| 变更类型 | 🐛 Bug 修复（发布频率控制 / 跨存储类型契约）→ 完整质量节拍 + 隔离 worktree |
| 隔离 | worktree `<仓库父目录>/mp-worktrees/mp-fix-release-window-taken-type-mismatch`（非 C 盘），分支 `fix-release-window-taken-type-mismatch` |
| 计划/取证文档 | `01-docs/BUGFIX-RELEASE-WINDOW-TAKEN-TYPE-MISMATCH-2026-10-17.md` |
| 远程同步 | PENDING |

## 一、QM-5 ①：第一性原因

`packages/shared-utils/src/guard-release.js` 的 `release()` 用 `store.get(key) === hold.at` 做乐观并发判据：

- `hold.at` = `recordPublish()` 的 `Date.now()` → **number**；
- `store.get(key)` = SQLite `publish_timeline.last_publish_at`，该列在 `apps/desktop/electron/services/store-schema.js`
  声明为 **TEXT**，`sqlite-wrapper` 读回 **string**（活库实测 `"1792241248768.0"`）。

⇒ `"…" === number` **恒 false** ⇒ `release()` 永远 `window_taken` ⇒ P0-1「可确证未送出就回滚窗口」
**从未生效过**。指纹证据：`publish_daily_count` 全表 `rollback_count = 0`，
`publish_timeline` 所有键的值都等于「最后一次尝试时刻」而非「占位前值」。

**第一性引入点（git 取证）**：
`git log -S 'get(accountKey) === hold.at' -- packages/shared-utils/src`
→ `c9d08ff45`（PR #3260，2026-10-10，`feat(pubfreq): 发布频率策略 v2`）引入该判据与 TEXT 列；
`3ff90dfc`（#3731，2026-10-17）只把函数搬到 `guard-release.js`，判据逐字未改。

**现场取证（只读）**：
- `publish_timeline['tencent_video:b1e05ac2'] = "1792241248768.0"` = 2026-10-17T12:47:28.768Z（首轮尝试时刻）；
- 日志 `12:47:43 Executor Publish failed for tencent_video: tencent_video not logged in`
  （命中 `definitelyNotSent` 封闭词表 `/not logged in/i`）；
- 日志 `13:47:53 phase-start task_5_…`（视频号）——**整整 60 分钟后**才重试，即窗口从未被回滚；
- 「等待 59 分钟」= 60′ 账号档 − 约 1 分钟流逝，与用户描述逐字吻合。

## 二、QM-5 ②：测试逃逸链（五层为什么都没拦住）

| 层 | 为什么没拦住 |
| --- | --- |
| 单元测试 | 夹具是内存 Map：**写 number 读 number**，`===` 在同一类型域内成立；测试与生产的**存储类型**不同，判据只在测试侧成立 |
| 集成测试 | `task-queue-guard-integration.test.js` 同样注入内存 store，没有一条用例穿过真实 SQLite |
| 桌面 store 测试 | `store-owner-isolation.test.js` 只断言写入闸（未来戳）与 owner 隔离，从未断言「读回值的类型」，更没把读回值喂给 `release()` |
| E2E / 视觉 | 失败路径不核对 `publish_timeline` 是否被回滚；视觉回归只关心像素 |
| 代码评审 | 审的是「乐观并发是否防止回滚他人窗口」（方向正确），没质疑「相等」在真实存储类型下是否成立 |

## 三、QM-5 ③：系统性漏洞

1. **回滚失败静默**：`_maybeRollback()` 里只 `this._probeCounts.releaseFailed += 1`，**零消费者、零日志**
   —— 这是缺陷能活过一版发布的直接原因。
2. **`publish_timeline` 列类型与读取方契约无机械约束**：声明 TEXT、写 number、读 string，三处各自都对，合起来不自洽。
3. **契约锁不覆盖存储边界**：守卫的 `store.get(key): number|null` 语义从未落到真实适配器上
   （`container.setup.js` 内联对象字面量）。

## 四、QM-5 ④：修复 + 回归保护

| 层 | 文件 | 修法 |
| --- | --- | --- |
| 判据（核心） | `packages/shared-utils/src/guard-release.js` | 新增模块级 `isSameWindow(stored, expected)`：按**数值**比较，`null`/非数字/`NaN`/`Infinity`/数值不等 一律 false（fail-closed）；账号键与平台键两个判定都改用它 |
| 可观测性 | `packages/shared-utils/src/task-queue-frequency.js` | 回滚失败时新增 warn：`[task-queue] 平台 … 未能回滚间隔窗口（reason=…）` |
| 单测（新） | `packages/shared-utils/tests/guard-release-store-type.test.js` | 9 例 R1–R8 + R4b：string 读回 / `.0` 尾缀 / 内存 store 不回退 / 覆盖者窗口不被吞 / 账号键与平台键独立 / 还原占位前值 / 配额回补 / 缺 hold fail-closed |
| 集成（新） | `apps/desktop/electron/services/publish-interval-guard-store-integration.test.js` | 5 例 G1–G5：**真实 sql.js + 真实 Store**；G1 先断言「写 number 读 string」类型事实，G2–G5 断言业务结果（回滚 / 配额 / fail-closed / 图文同键） |
| 队列层（加强） | `packages/shared-utils/tests/task-queue-guard-integration.test.js` | +3 例 W1–W3：string store 下「登录失效」失败后**可立即重发且不产生 blocked**（端到端）、回滚失败必须 warn、回滚成功不得 warn（反向锁） |

**明确不改**（避免过度修复）：视频号 60′ 数值（v5 产品决策）、乐观记账时机（防重复发布）、
`publish_timeline` 列类型（需库迁移且治不了类型漂移）、`releaseGraceMs`。

## 五、TDD 见证（先红后绿）

- 新增用例修复前：`Tests 5 failed | 3 passed (9)`（R1/R2/R4/R5/R6/R7 红；R3 内存 store 与 R8 缺 hold 本就绿）。
- 修复后：shared-utils 组 `9 passed`；集成组 `5 passed`；队列组 `19 passed`。
- 首跑另发现**夹具自身缺陷**：`String(map.get(k))` 把写入的 `null` 读成 `'null'` ⇒
  `Number('null')=NaN` ⇒ 被判时钟异常 ⇒ R1 假红。已按 TEXT 列的 NULL 语义修正夹具，
  并把这条「夹具必须连 NULL 语义一起对齐生产」写进测试注释。

## 六、变异反证（逐条实跑，判定取输出 `Tests N failed`）

| 变异 | 改动 | 红集 |
| --- | --- | --- |
| **M1** | `isSameWindow(...)` 改回 `this._store.get(key) === hold.at` | shared-utils **6 failed**（R1/R2/R4/R5/R6/R7）；集成 **3 failed**（G2/G3/G5）；队列 **W1 1 failed** |
| **M2** | 删掉「未能回滚间隔窗口」那条 warn | **W2 1 failed**（`expected [] to have a length of 1`） |

两次变异均在验证后**逐字节还原**（`Copy-Item` 备份 → 还原 → 复跑）并回绿：
shared-utils 9 passed / 队列 19 passed。

## 七、影响面排查（用户点名项）

| 问题 | 结论 |
| --- | --- |
| 图文发布是否同样 | **是**。窗口键只由 `(platform, accountId)` 决定（`buildKey`），图文与视频共用同一把键、同一条 `_maybeRollback → release()` 路径 ⇒ 同一缺陷；时长由各平台账号档决定（公众号 5′ 等）。修复后两者同时恢复。由 G5 显式锁定 |
| 其他平台是否同样 | **是**。缺陷平台无关；可见度由账号档长度决定：微博/X 1′（像正常排队）、抖音/快手/小红书/B站 3′、公众号/知乎/百家号/头条 5′、**视频号 60′**（因此只有它被投诉） |
| 是否与视频号 60′ 数值有关 | **无关**。改小它只会把「1 小时白等」变成「3 分钟白等」，缺陷仍在 |

## 八、门禁读数

| 门禁 | 读数 |
| --- | --- |
| 变更类型判定 | 混合 PR（含 `packages/`、`apps/`），走完整节拍 |
| TDD（先红后绿） | 5 红 → 全绿（见第五节） |
| `packages/shared-utils` 全量 | 55 files / **1093 passed** / 10 skipped |
| 桌面受影响面（store-owner-isolation + 新集成锁 + container.setup + 调度器 parity） | 4 files / **48 passed** |
| 逐文件行数闸 `check-max-lines.js` | rc=0（无新增超大文件；挂账 95 / 墓碑 5 与现实一致） |
| ESLint（Gate 11 同款 `pnpm exec eslint … --quiet`） | 全部改动文件 rc=0 |
| QM-1 打包 | `build:vue` rc=0 + `electron-builder --win --dir` 产出 `Multi-Publish.exe`(239,075,328 B) / `app.asar`(153,627,896 B) |
| QM-1 启动验证（三层判据） | **PASS**：存活断言 8s 仍在运行 ✅；`stderr = 0 字节`；stdout 22492 B；未命中红线。父环境 `ELECTRON_RUN_AS_NODE=1` 经 `buildChildEnv()` 剔除并**出声告警**（`envDefectNotice`） |
| 品牌残留 | 待跑 |
| locale 成对 | 本 PR 未改 locales（无新增用户可见文案，§14.4 复用既有 key） |
| 执行记录 | 本文件 |
| 远程同步 | PENDING（合并后同一次提交回填 PASS + merge SHA） |

## 九、QM-5 ⑤：预防措施（已落地）

1. **跨存储类型成为判据纪律**：`01-docs/learnings.md` 新增条目
   「『写入值 === 读回值』这类乐观并发判据，必须跨**存储类型**测」，
   含四条判据（跨边界相等 / 内存夹具的结构性失明 / 归一必须收窄 / 静默计数器等于没有计数器）。
2. **至少一条锁穿过真实存储**：新增集成锁 `publish-interval-guard-store-integration.test.js` 常驻 CI，
   且**先断言类型事实再断言业务结果**（防止换驱动后锁静默适应）。
3. **回滚失败出声**：`reason` 进日志，下次同类问题在 `app-*.log` 里直接可搜
   （关键词 `未能回滚间隔窗口`）。
4. **文档三处同步**：新增 `BUGFIX-…-2026-10-17.md`（取证/根因/五层逃逸/校验 V1–V7/流程/显示项/排查手册/残留风险）、
   `PRD-PUBLISH-FREQUENCY-V4-2026-10-15.md` §14、`ARCH-PUBLISH-FREQUENCY-AND-QUEUE-2026-10-16.md` §5.5.1 与 §9 两条残留登记。

## 十、保留门禁

- 行尾对账：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（提交时补记）
- 品牌残留：见上表（待跑）
- 文档同步：PRD §14 / ARCH §5.5.1 / CHANGELOG / learnings / 本篇
- 远程同步 PENDING（合并后回填）
