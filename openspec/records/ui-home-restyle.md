---
record: ui-home-restyle
task: 桌面首页 UI 视觉改版（主任务卡 + 连续发布天数 + 告警条重绘 + 概览行，参考产品风格迁移 PRD 落地）
date: 2026-10-13
sync_reason: 本 PR（ui-home-restyle）自身的远程同步收口，合并后由本会话回填
sync_backfill_owner: ui-home-restyle 任务会话
---

## 本次执行记录：桌面首页 UI 视觉改版（ui-home-restyle，2026-10-13）【混合 PR】

- **变更类型**：渲染层运行时（`apps/desktop/src/**` + locales）⇒ 隔离 worktree `mp-ui-home-restyle`，裸分支 `ui-home-restyle`（基线 `origin/main` = `87e182144`）。
- **方案依据**：`01-docs/PRD-UI-HOME-RESTYLE-2026-10-13.md`（PR #3442 已合并）。参考产品风格迁移：只迁「模式与 token」，不复制素材/文案。
- **改动范围**（T1-T6，全部渲染层，零新增 IPC、零主进程改动）：
  - T3 主任务卡：Home.vue 欢迎区重构——「开始发布」hero 大卡（图标方块 + 描述 + 右上角品牌淡紫弧形渐变装饰 + hover 抬升），原「新建发布」按钮由 hero 整体点击承担；
  - 连续发布天数（streak）：从 `dashboard:stats.daily`（近 30 天逐日聚合，现有 IPC）前端推导，容许今日未发布回退昨日；30 天无发布显示占位「—」（禁假报 0 天）；`stats` 初始态补 `daily: []`；
  - T4 概览行：问候下新增「已授权账号 N · 本月发布 N」（tabular-nums），数据复用 accountStore 与 dashboardStats，零新增数据源；
  - T2 告警条重绘：LoginExpiredBanner 改告警条模式——图标方块（danger 实底）+ 标题/计数徽章 + 说明 + **描边式**操作按钮（hover 实底化）；全部颜色走 token（`--color-danger/-soft/on-primary` 等，暗色自动继承既有 soft 覆盖）；
  - T6 快捷入口图标升级为淡紫底图标方块（纯 CSS）；
  - T5 用量仪表卡：现有数据源无可取的配额 IPC，按 PRD「取不到的行不显示」降级为概览行（并入 T4）；
  - T1 token：全部复用既有 tokens.css 槽位（`--color-primary-light`、`--shadow-card-hover`、`--radius-*`、`--font-size-*`），**零新增 token、零新增 hex**；
  - locales：`home.hero.*` / `home.overview.*` 新键 zh/en 成对。
- **TDD**：先红后绿——Home.test.js 新增 3 例（hero+streak 渲染、无数据显示「—」、概览行计数），LoginExpiredBanner.test.js 新增 1 例（图标方块/计数徽章/描边按钮断言，含「禁实心按钮」负控）；en 用例「New Publish」→「Start Publishing」同步。全绿：Home 家族 5 文件 53 passed。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | worktree `mp-ui-home-restyle`（D 盘）+ 裸分支；`verify-worktree-deps.js` OK（11 项消费方解析到本 worktree）；`ensure-electron.js` v43.7.7 |
| 相关域测试 | PASS | `Home.test.js`(28) + `Home.todo-guard` + `tab-independent-home` + `LoginExpiredBanner.test.js`(8) + `home-shell` = **53 passed / 0 failed** |
| ESLint | PASS | `pnpm run lint` 0 error |
| locale 成对 + CJK | PASS | `check-locale-sync.js --keys` PASS（2010 keys）；`--cjk` PASS（基线 1374 → 当前 1224，无新增硬编码） |
| 颜色字面量 | PASS | `check-color-literals.js` 129/129 基线持平（HomeGreeting/Home 现存 3 处基线项未增长，本次零新增） |
| 前端一致性 | PASS | `check-frontend-consistency.js` PASS（windowConfirm/rendererIpcDirect/appleAlias 均 0） |
| CSS 变量定义 | PASS | `check-css-var-defined.js` 0 / 基线 64 |
| QM-1 打包 | 见下 | 渲染层改动仍按门禁完整打包（本记录「打包」小节） |
| QM-4 视觉 | 部分 | 本机 GUI 被用户运行中的生产实例占用（8 个 electron 进程，单实例锁使隔离 userData 启动秒退 exit 0），视觉走查与前后截图由用户在真机验证；渲染产物验证见下 |
| 新增文件行数 | PASS | 无新增超大文件（改 3 个 Vue + 2 个 locale + 测试） |

### 打包（QM-1）

- 命令：`cd apps/desktop && pnpm exec electron-builder --win --dir --publish never`
- rc=0；asar 清单含 logger（`@multi-publish/api-publish-engine/src/logger.js` 等）；`asar extract` 后 `require('node_modules/@multi-publish/rpa-engine')` **REQUIRE_CHAIN_OK**
- renderer 产物（`pnpm run build:vue` rc=0）`dist/assets/Home-*.js` 含 `home-publish-hero`、`index-*.js` 含「已连续发布」——新组件已进包
- **8 秒启动测试受限说明**：本机同账号下有 8 个运行中 electron 进程（用户的生产应用），`requestSingleInstanceLock` 在 `configureUserDataPath` 生效前按默认 userData 抢锁，隔离 `ELECTRON_USER_DATA_DIR` 启动秒退 exit 0、无 stderr。按「不杀用户进程」纪律未强杀，改以 asar require 链 + 渲染产物断言为启动面证据；stderr 0 行无 updater/路径错误栈。

### 残留限制

- streak 判据基于 `daily`（近 30 天窗口）——31 天前的连续历史不计入，与「激励近期连续发布」的产品语义一致。
- LoginExpiredBanner 的「全部保存」按钮沿用警告色描边，未做独立视觉测试断言（既有 save-all 用例全绿覆盖行为）。

| 远程同步 | PENDING | 合并后回填 |
