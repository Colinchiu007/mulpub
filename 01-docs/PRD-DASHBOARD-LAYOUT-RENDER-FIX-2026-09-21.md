# PRD：数据看板布局与渲染缺陷修复（dashboard-layout-fix）

- 日期：2026-09-21
- 分支：`local/dashboard-layout-fix`；worktree：`D:/Data/projects/mp-worktrees/mp-dashboard-layout-fix`
- 前序关联：PR #2075（看板奶油·薰衣草改版）、PR #2114（`:root` token 失效修复）、PR #2121（QM-5 整改 A/B/C）
- 变更类型：🐛 Bug 修复（P0×3 / P1×2 / P2×1）+ 🔧 门禁反哺（Gate 15c）+ 📄 文档
- 风险等级：M / 中风险（纯展示层，无数据流变更）

## 1. 背景与目标

数据看板（`apps/desktop/src/views/Dashboard.vue`）经 PR #2114/#2121 修复「渲染隐形」两类缺陷后，本次全功能
UI 复审（quality-rhythm 节拍）发现仍残留 6 项显示缺陷：网格算术错误导致统计卡孤儿换行、引用了从未定义的
shadow/cream 设计 token、错误变量名导致次要文字样式失效、模板残留 emoji 状态图标、登录门禁按钮无样式、
hero 大卡右半大面积空白。目标：全部修复并以静态守卫测试 + CI 门禁 + 像素基线三重锁定，防止回归。

## 2. 缺陷清单与修复

| 级别 | 缺陷 | 根因 | 修复 |
|------|------|------|------|
| P0-1 | 统计卡第 4 张孤儿换行 | `.stats-grid` 为 `repeat(4,1fr)`，但内容需要 5 个网格单元（hero span2 + 3 普通卡） | 改 `repeat(5,1fr)`、`grid-template-rows:auto`，单行铺满 |
| P0-2 | 卡片阴影 / 门禁奶油底失效 | 引用 `--shadow-sm/md/lg`、`--cream-surface` 未在任何样式源定义；CSS 未定义 var 且无 fallback → 整条声明失效（非回退默认值） | 在 `src/styles/tokens.css` 明暗两套 `:root` 中补齐定义 |
| P0-3 | 次要文字颜色失效 | 写了 `var(--text-secondary)`，项目真实 token 名为 `--color-text-secondary` | 4 处统一改名 |
| P1-1 | 模板残留 emoji（📤👥✅❌） | 与 Element Plus 图标体系不一致，跨字体环境基线错位、像素对比抖动 | 替换为 `Promotion` / `UserFilled` / `CircleCheckFilled` / `CircleCloseFilled`（条件渲染 success） |
| P1-2 | 门禁「去登录」按钮为裸 button | `.gate-sign-in`/`.dashboard-login-gate`/`.gate-hint` 无样式定义 | 新增品牌紫胶囊按钮（hover brightness + translateY）、门禁卡片 flex 居中 + cream 底 + dashed 边框 |
| P2 | hero 大卡右半空斑 | 深色渐变卡仅左上有图标，右侧无内容 | 新增 `.stat-decor`（160px radial-gradient 柔光圆斑，`aria-hidden="true"` 纯装饰） |
| P0-4（响应式） | ≤1024px 时 hero span2 占满 2 列，3 张小卡又成孤儿 | 媒体查询只改了列数未改跨度 | hero 改 `span 1`，4 卡 2×2 无孤儿 |

### 5 列网格算术（守卫不变量）

`cols == heroSpan × largeCount + (cardCount − largeCount)`。桌面：5 = 2×1 + 3；平板（≤1024px）：4 = 1×1 + 3。
该公式由 `Dashboard.style-guard.test.js` 从模板静态解析 `class="stat-card"` / `class="stat-card large"` 计数校验。

## 3. 设计 Token（tokens.css 本次新增）

| Token | 亮色 | 暗色 | 用途 |
|-------|------|------|------|
| `--shadow-sm` | `0 1px 2px rgba(30,27,75,.06), 0 1px 3px rgba(30,27,75,.10)` | 同结构提高不透明度 | 静态卡片阴影 |
| `--shadow-md` | `0 4px 12px rgba(30,27,75,.10)` | 同上 | 悬浮中层 |
| `--shadow-lg` | `0 12px 28px rgba(30,27,75,.16)` | 同上 | hover  elevatation |
| `--cream-surface` | `#faf6f8` | `#26262d` | 奶油表面（门禁卡片等） |

hero 渐变基色 `--deep-purple: #1e1b4b` 与 lavender 三件套由 `:global(:root)` 提供（PR #2114 范式，不得回退为裸 `:root`）。

## 4. 显示项逐项说明

1. **页头**：标题「数据看板」+ 副标题「各平台发布数据与趋势分析」；右侧「⟳ 刷新数据」按钮（同步中显示「同步中...」并禁用）。
2. **试用横幅** `TrialBanner`：可 dismiss，触发升级弹窗。
3. **统计卡网格（5 列单行）**：
   - hero 大卡（span2，深紫渐变+装饰光晕）：Promotion 图标、`totalArticles`、标签「已发布内容」、`↑ 较上周 +12%`（正例绿）；
   - 阅读卡：View 图标、`totalViews` 万格式化、标签「总阅读」、`↑ +8.5%`；
   - 评论卡：ChatDotRound 图标、`totalComments`、「总评论」、`↑ +23%`；
   - 粉丝卡：UserFilled 图标、`totalFollowers` 万格式化、「总粉丝」、`↓ -2.1%`（负例红）。
   - 变更百分比当前为静态示例数据（已知债，见 §8）。
4. **登录门禁卡片**（`statsLoginRequired` 时显示，`role="status"`，`data-testid="dashboard-login-gate"`）：提示文案 + 「去登录」胶囊按钮（`data-testid="dashboard-sign-in"`）。
5. **发布统计面板**（登录后 `statsData` 存在时）：累计发布 / 成功（绿 `--color-success`）/ 失败（红 `--color-danger`）/ 成功率 `successRate||0` %。
6. **发布趋势（近 14 天）**：柱状图，高度 `max(4, total/dailyMax×160)px`，有数据柱用 lavender 渐变 + 不透明度随占比 0.7→1.0，零值柱灰色 `--color-border`；tooltip `countUnit`；日期标签取 `MM-DD`。
7. **平台分布**：按 `total` 降序横向条形，宽度 `total/maxPlatformTotal×100%`，计数「N 篇」。
8. **最近发布**（最多 5 条）：时间（HH:mm）+ 成功/失败图标（CircleCheckFilled/CircleCloseFilled）+ `平台名: 标题`，标题回退链 `r.title → r.article?.title → '(无标题)'`。
9. **各平台数据卡**：空态 `EmptyState`（含「立即同步」按钮）；有数据时图标（URL/emoji 双形态）、平台名、「更新于 时间」或「数据获取失败」，四指标 阅读/评论/点赞/粉丝，null 显示 `-`。
10. **内容基准比较**：输入标题（回车或「分析」按钮，trim 空禁用）→ `BenchmarkChart` 按 title key 重挂载。

## 5. 交互逻辑与流程

- **进入页面**（onMounted）：并行 `loadCached()`（各平台缓存数据）+ `loadStats()`（发布统计）+ `loadRecent()`（最近发布）。
- **刷新同步**：`refreshSync()` → `syncAll()` → 成功后重拉 `loadCached()`；`syncing` 期间按钮禁用防重入；失败仅 toast，不重置已有数据。
- **登录门禁**：`dashboardStats`/`historyList` 返回 `isAuthGateResult(res)` → `statsLoginRequired=true`，隐藏统计/最近发布面板；点「去登录」→ `identity.signIn()`（主进程 Logto OAuth，唯一正确入口），用户取消静默保持门禁态；`watch(identityAuthenticated)` 登录成功自动重载 loadStats+loadRecent，无需刷新页面。
- **hover**：统计卡 `translateY(-4px)` + `--shadow-lg` + 顶部 4px 渐变条淡入；门禁按钮 brightness + 微位移。

## 6. 数据校验规则

| 数据 | 校验/边界 |
|------|-----------|
| IPC 响应 | `res.code === 0` 才写入 state；`api`/方法不存在直接 return（非 Electron 环境静默降级） |
| 登录态 | `isAuthGateResult(res)` 判定 AUTH_REQUIRED，与普通错误分离 |
| 最近发布 | `historyList({limit:5})`；`records` 缺失回退 `[]`；成功判定 `r.success !== false`（undefined 视为成功） |
| 万格式化 | `value > 10000 → (value/10000).toFixed(1)+'万'`，否则原值 |
| 聚合 | `totalViews` 等仅累加 `!d.error` 的平台，字段 `|| 0` 兜底 |
| 图表除零 | `dailyMax`、`maxPlatformTotal` 均 `Math.max(1, ...)` 且空数组返回 1 |
| 趋势窗口 | `daily.slice(-14)`，长度不足按实际渲染 |
| 成功率 | `statsData.successRate || 0` 防 NaN |
| 基准输入 | `trim()` 空串拒绝（按钮禁用 + 函数内二次校验） |
| 平台图标 | `isIconUrl` 仅接受 `/`、`data:`、`http` 前缀，否则按文本 emoji 渲染 |

## 7. 提示文字（i18n zh/en 成对，locales key 全清单）

| key | zh | en |
|-----|----|----|
| dashboard.loginGateHint | 登录后可查看发布统计与最近发布。 | Sign in to view publish stats and recent publishes. |
| dashboard.signInNow | 去登录 | Sign in |
| dashboard.publishedContent | 已发布内容 | Published content |
| dashboard.weekChange | 较上周 +12% | vs last week +12% |
| dashboard.totalComments | 总评论 | Total comments |
| dashboard.totalFollowers | 总粉丝 | Total followers |
| dashboard.publishStatsTitle | 发布统计 | Publishing stats |
| dashboard.trendTitle | 发布趋势（近 14 天） | Publishing trend (last 14 days) |
| dashboard.last14DaysHint | 最近 14 天 | Last 14 days |
| dashboard.platformDistTitle | 平台分布 | Platform distribution |
| dashboard.recentTitle | 最近发布 | Recent publishes |
| dashboard.countUnit | {count} 篇 | {count} posts |
| dashboard.loadStatsFailed（错误 toast） | 数据看板统计加载失败 | Failed to load dashboard statistics |
| dashboard.loadRecentFailed（错误 toast） | 最近发布加载失败 | Failed to load recent publishes |
| dashboard.loadCachedFailed（错误 toast） | 平台数据加载失败 | Failed to load platform data |
| dashboard.syncFailed（错误 toast） | 平台同步失败，请稍后重试 | Platform sync failed. Please try again later |

**已知 i18n 债（本次不扩大范围，登记待办）**：页头标题/副标题、「⟳ 刷新数据」「同步中...」「总阅读」「累计发布」「成功」「失败」「成功率」「各平台数据」「内容基准比较」「立即同步」「数据获取失败」「(无标题)」「N 篇」「阅读/评论/点赞/粉丝」仍为硬编码中文，后续按 Gate 7（check-locale-sync）+ 基线扫描流程迁移 locales。

## 8. 防回归机制

1. **守卫测试** `Dashboard.style-guard.test.js`（9 项，TDD 先红后绿）：`:global(:root)` lavender token、禁裸 `:root`、禁「基础 opacity:0+animation」可见性模式、hero 引用 `--deep-purple`、5 列网格算术、shadow/cream token 必须在 tokens.css 成对定义（明暗两套）、gate 三类有样式、模板禁 emoji（U+1F300–1FAFF / U+2600–27BF）、`.stat-decor` 存在。
2. **CI Gate 15c** `.github/scripts/check-css-var-defined.js`（本次新增，事故泛化）：扫描 `apps/desktop/src`、`ops-center/frontend/src` 全部样式源，凡 `var(--x)` 无 fallback 且 `--x` 从未定义（声明/setProperty/对象键三种定义形态，`--el-` 前缀白名单）即失败；基线 `cssVarUndefined=64`（存量债，Dashboard 0 处）只降不升 ratchet；含 6 用例 `node --test` 自测；已接入 quality-gate.yml（Gate 15b 与 16 之间）。
3. **像素基线**：`tests/visual-testing/base-screenshots/dashboard.png` 重建（212,637 字节），目检确认单行 5 列、装饰光晕、el-icon、阴影、cream 门禁卡后落盘；复跑 PASSED。

## 9. 验收标准

- [x] `Dashboard.style-guard.test.js` 9/9 绿（其中 5 项本次先红）；`Dashboard.test.js` 13/13 无回归
- [x] Gate 15c 自测 6/6、扫描 exit 0（0 新增违规，基线 64 锁定）
- [x] 像素套件 dashboard 子集 PASSED（新基线）
- [x] tokens.css 明暗两套均含 `--shadow-sm/md/lg`、`--cream-surface`
- [x] 模板无任何 emoji 字面量；统计图标全部 el-icon
- [x] locales zh/en 成对无新增缺失（Gate 7 通过）