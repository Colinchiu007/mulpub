---
record: remove-home-streak
task: 移除首页主任务卡「已连续发布」streak 区块（占位破折号被 32px 粗体样式放大成粗横杠，被用户误判为显示错误）
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR #3503 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：移除首页主任务卡「已连续发布」streak 区块（remove-home-streak，2026-10-14）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更：隔离 worktree `D:/Data/projects/mp-worktrees/mp-remove-home-streak`，裸分支 `remove-home-streak`；改动 4 个文件（Home.vue / Home.test.js / locales/home/{zh,en}.js）+ CHANGELOG |
| 第一性原因（QM-5 ①） | ✅ | 引入点 `904662ed0`（PR #3446「首页 UI 视觉改版」）：占位态刻意用 `—` 并注明「禁假报 0 天」（openspec/records/ui-home-restyle.md:15），但占位符被放进 `.streak-num`，套用了 `--font-size-xxl` 32px + `font-weight:700` + primary 色，未做空态样式降级 ⇒ em dash 渲染成粗横杠。设计意图正确，视觉落地失控 |
| 逃逸分析（QM-5 ②） | ✅ | ①单元测试：旧用例只断言 `toContain("—")`（Home.test.js:269），样式不在断言范围，占位态与有数据态共用同一 class 无法区分；②视觉回归：首页 hero 虽有基线，但基线新鲜度门禁只在"有渲染"时比对，而当时基线与实际渲染一致 ⇒ 拦不住；③代码审查：占位态复用大号数字排版属"能跑就行"盲区 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修复：整体删除 hero 卡 `.hero-streak` 模板块、`streakDays`/`streakText` 两个 computed、`.hero-streak`/`.streak-num`/`.streak-label` 三条样式、locale 三对 key（zh/en 成对）。回归锁落在 `apps/desktop/src/views/Home.test.js`：两条用例改为断言 `[data-testid="home-hero-streak"]` 不存在 + 文案不出现 + 占位符不出现，并保留 hero 卡整卡点击跳转 `/publish` 断言。**变异反证已实跑**：把 streak 区块加回 Home.vue ⇒ 2 红（`2 failed | 26 passed`），还原后 28 passed ⇒ 证明锁在跑，非恒绿 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 本次回归锁同时钉「节点不存在」与「文案不出现」两个维度，避免单一 `toContain` 被"样式变体"绕过；② CHANGELOG.md 记录逃逸链三层；③ 遗留待办：首页视觉基线已更新（见 QM-4 行），"占位态复用大号数字排版"这一类错误建议进视觉审查清单——本次未改清单文件，作为遗留项如实记录，不冒充已落地 |
| 行尾与 diff 对账 | ✅ | 本次为代码变更（非 docs-only），`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false`（files=9：CHANGELOG.md、Home.vue、Home.test.js、locales/home/{zh,en}.js、2 个 .ccg/reviews/*.json、2 个基线 PNG）⇒ 走完整质量节拍。删除数归因：Home.vue −74/+12、Home.test.js +19/-19 改写、locale −3/−3；基线 PNG 由 CI 渲染更新（Bin 118783→117969 / 120618→119747） |
| 接线棘轮 | ✅ | 未新增 `*.test.js` 文件（改造既有 `Home.test.js` 的既有用例），该文件已被 `quality-gate.yml` 的 QG Unit Tests / QG Desktop Shards 显式点名；CI 实测 `QG Unit Tests pass` |
| QM-1 打包 / QM-4 视觉 | ✅ / ✅ | QM-1：N/A —— 本次纯 renderer 删除，未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/`。QM-4：CI `QG Visual pass`；`home-default` 视图在 views 套件 37/37 通过、`home-baseline` 像素 light 20/20 + dark 20/20 全通过。**视觉基线更新取证**：像素级比对 CI 渲染与 git 旧基线，全部差异 530 px 集中在 `x[1392..1490] y[327..338]` 这一个 98×12 矩形内（hero 卡右侧 streak 原位置），全图其余 0 差异 ⇒ 漂移仅由本次删除造成，据此更新两张基线 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`；以 CI 的 `QG Autonomous` + `agent-judge` 两项 pass 替代（如实记录，不以自审冒充通过） |
| 远程同步 | PENDING | 待合并后回填 |

### 遗留（不假装已闭合）

- 「占位态复用大号数字排版」这类视觉错误未进视觉审查清单文件（本次只改了 CHANGELOG 与回归锁），需后续单独落地。
- main 上 `Visual Tests` workflow 连续 12+ 次 failure（`supplementary-views 19→18/1`、`VISUAL-ALL-SUMMARY 105→104/1`，与本次改动无关、逐字同源）。该 workflow 不在分支保护 required checks 内（required 仅 `Gate Result`/`build`/`QG Unit Tests`/`QG Coverage`），故未阻塞合并；这是 main 自身未修的既有红，需单独排查 supplementary-views 采集日志整段丢失（日志中 19 个视图一行未打印，疑为 runner 日志缓冲丢弃）。
- 共享根历史脏状态（`.adversarial/`、`.ccg/reviews/` 删除项）+ 外部 worktree `D:/Temp/egress-base` 使 `mp-worktree-health.ps1` 报 `ok=false`，`start-mp-task.ps1` 无法跑完；本次改用原生 `git worktree add`（PowerShell `D:\` 路径，符合铁律 B）建隔离区完成任务，未做破坏性清理。
