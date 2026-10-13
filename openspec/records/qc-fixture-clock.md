---
record: qc-fixture-clock
task: quick-collect 测试夹具时钟时间炸弹——48h 窗口按真实时钟判定而夹具钉死绝对日期，到点全库分片转红
date: 2026-10-13
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并在同一次提交整段删除本三个 sync_ 字段与 ledger 登记项
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账）
---

## 本次执行记录：quick-collect 夹具时钟时间炸弹（qc-fixture-clock，2026-10-13）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（**仅测试文件**：`apps/desktop/electron/ipc-handlers/quick-collect.test.js`、`apps/desktop/electron/services/quick-collect-cn-sources.test.js`）+ 文档 ⇒ `classify-docs-only` 判 **false**（测试文件在代码路径），走完整门禁；隔离 worktree `D:\Data\projects\mp-worktrees\mp-qc-fixture-clock`（D 盘）+ 裸分支 `qc-fixture-clock`，基线 `origin/main` = `c6b4709cd`；`start-mp-task.ps1` 自动完成依赖就绪（`verify-worktree-deps.js` 11 项解析到本 worktree） |
| 发现路径（非本任务自述需求） | ✅ | 本会话在 PR **#3454**（小红书创作者中心开卡 URL）上观察到两个桌面分片同时红。逐一排除后证明与本 PR 无关：① `git diff --stat origin/main -- <失败文件>` 为空（未触及）；② **把改动文件还原到主干版本后本地复跑，同样 2 红**；③ CI Failure Handler 已为**另一个 PR #3434** 自动开 issue **#3456**，失败用例完全相同 ⇒ 全仓库级阻塞，非单 PR 问题 |
| 第一性原因 | ✅ | **夹具时钟与判据时钟不同源**：两个测试文件的夹具钉死 `const NOW = Date.parse('2026-10-11T04:00:00.000Z')`，而 48h 窗口的判据时钟走**真实时间**——`quick-collect-engine.js` 的 `now = typeof deps.now === 'function' ? deps.now : () => Date.now()`，而这两条路径（IPC 处理器 / hotTopicsService）**不注入 now**。于是夹具年龄随时间单调增长，到「固定时刻 + 48h」准时越窗、素材被判空（`retrieval:'empty'`、`timeKinds:[]`）⇒ 测试按日历过期，而非代码回归 |
| 过期时刻（逐条算出并实测） | ✅ | 三条夹具各自的到期时刻：`created_utc = NOW-1h` ⇒ **2026-10-13T03:00Z** 到期（IPC 2 例）；`fetchedAt = NOW` ⇒ **04:00Z** 到期（hotTopics 2 例）；RSS `pubDate = 2026-10-11T02:00Z` ⇒ **02:00Z** 到期（solidot 1 例）。CI 在 03:14–03:25Z 跑：只有 03:00Z/02:00Z 已到期的 3 例红（shard1 solidot、shard2 IPC 2 例），04:00Z 那 2 例当时仍绿——**与 CI 日志逐条吻合**（shard1 `1 failed | 457 passed`、shard2 `1 failed | 456 passed`，失败文件恰为这两个），本地在 04:29Z 后复跑则 5 例全红 |
| 修复 | ✅ | ①两文件夹具时钟改为 `const NOW = Date.now()`（相对真实时钟；`hoursAgo(49)` 仍越窗、`fetchedAt: NOW` 仍在窗内，**断言语义不变**）；②solidot 的 RSS `pubDate` 改为按 `NOW - 2h` 生成并保持 `+0000` 形态（不再写死绝对时间字符串）。**不改任何生产代码**（引擎/处理器行为未动） |
| 防再犯（回归锁） | ✅ | 两个文件各加一条**防时间炸弹锁**：`expect(Math.abs(Date.now() - NOW)).toBeLessThan(5 * 60 * 1000)`——夹具时钟一旦被重新钉死成绝对日期，该用例**立即变红**（不必等到窗口过期）。变异反证：把 `NOW` 改回 `Date.parse('2026-10-11T04:00:00.000Z')` 后该锁当场红 |
| TDD 与相关域全量 | ✅ | 修复前：两文件 **5 failed / 100 passed**（整族 9 文件 105 例）；修复后：**9 files / 107 passed / 0 failed**（含新增 2 条锁） |
| 变异反证（3/3 实测变红） | ✅ | M1 把 IPC 夹具时钟改回钉死绝对日期 ⇒ 红；M2 把中文源夹具时钟改回钉死 ⇒ 红；M3 把 solidot `pubDate` 改回绝对字符串 ⇒ 红。三条均在 `finally` 整体回写原文并核对「已还原」（脚本 `D:\Temp\xhs-repro\mutations-timebomb.js`） |
| 逐文件行数 / 债务基线 | ✅ | `node .github/scripts/check-max-lines.js` → “无新增超大文件，挂账清单与现实一致”（`quick-collect.test.js` 154 行、`quick-collect-cn-sources.test.js` 364 行，远低于 testLimit 1500）；`node scripts/check-debt-budget.js` → 全指标基线内 |
| ESLint | ✅ | `cd apps/desktop && pnpm run lint`（`eslint electron/ src/ --quiet`）**rc=0**，0 error |
| 行尾对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐值相等（14/1 与 19/2） |
| QM-1 打包 | N/A | 本次**未改任何生产代码**（只改两个测试文件的夹具与新增 2 条断言），引擎/处理器/IPC 行为零变化 ⇒ 打包不会带来额外信号；本 worktree 亦缺 `.playwright-browsers` 前置（~170MB Chromium） |
| QM-4 视觉 | N/A | 无渲染端、样式、文案变更 |
| QM-6 CCG 双模型深审 | 判定为 SKIP（如实记录） | 变更 33 行 < 200 行阈值 ⇒ 提交时 `ccg-gate.js` 判 SKIP（非 DUAL）。判据以钩子产物为准 |
| OpenSpec change | 判定不建 | 测试夹具缺陷修复，无方案级取舍、无接口/存储/IPC/依赖变化 |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后由回填 PR 就地改写 `PASS` + merge SHA，并在**同一次提交**删除本文件 frontmatter 三个 `sync_*` 字段与 `scripts/gate-record-debt-ledger.json` 登记项 |

### 影响面与关联

- **本修复解除的是全仓库阻塞**：修复前 `QG Desktop Shards (1/2)`/`(2/2)` 必红，任何 PR 都无法满足 required checks（已确认 #3434 同因被拦，issue #3456 由 CI Failure Handler 自动开出）。
- **未做的选择**（如实记录）：没有把夹具时钟改成「注入 `deps.now`」——那需要让 IPC 处理器 / hotTopicsService 透传 `now`，属生产代码改动；本轮目标是**最小、可快速合并**地解阻，故选相对真实时钟这一测试侧最小改动，并把「链路支持注入 now」留作后续可选加固。
- 同族其它文件（`quick-collect-engine.test.js` / `quick-collect-command.test.js` / `quick-collect-materials.test.js`）同样钉死 `NOW`，但它们**处处注入** `now: () => NOW`，判据与夹具同源 ⇒ 确定性、不会过期，本轮不动（整族实测 107/107 绿已证）。
