# PRD：侧边栏「更多」菜单选中态修复 + 效果洞察页 UI/UE 精致化

- 日期：2026-09-21
- 分支：`sidebar-insight-polish`（worktree 隔离，D 盘）
- 关联：`01-docs/PRD-ACTIVATE-VIRAL-LIBRARY-2026-09-13.md` §5.6「效果洞察页」
- 类型：🐛 Bug 修复（选中态缺失）+ 🎨 UI/UX 精致化（效果洞察页）
- 影响面：`apps/desktop/src/layouts/MpSidebar.vue`、`apps/desktop/src/styles/sidebar.css`、`apps/desktop/src/views/PerformanceInsights.vue`、`apps/desktop/src/locales/{zh,en}.js`

---

## 一、背景与问题

### 1.1 侧边栏「更多」菜单无选中态（Bug）

用户点击左侧边栏「更多」折叠菜单中的某一项（如「效果洞察」），右侧内容区打开了对应页面，但侧边栏的「更多」触发器与其子菜单项**均无任何选中/高亮状态**。用户无法感知"当前所在页面对应哪个菜单项"，产生定位迷失。

根因（git 追溯）：
- `MpSidebar.vue` 中 more 组子项此前渲染为**裸 `router-link`**，只绑定了 `to`，**未绑定 active class**（一级导航 `primaryItems` 早已绑定 `isActive(item)`，more 组被遗漏）。
- 「更多」触发器的 `:class` 仅由本地 `moreOpen`（菜单是否展开）驱动，子路由命中时触发器不会保持高亮，菜单收起后当前页在导航中"消失"。
- `sidebar.css` 只有 `.mp-primary-item.active`，缺 `.mp-more-item.active` / `.mp-more-trigger.active` 的视觉规则。

### 1.2 效果洞察页视觉散乱（UI/UE）

原 `PerformanceInsights.vue` 用 4 个 `el-table` 直接铺排，缺：数据概览、平台维度筛选、页面级/维度级空态区分、错误可重试反馈、排行可视性与样本可信度提示；表头/数值/留白层次弱，观感粗糙。

---

## 二、功能逻辑与数据校验

### 2.1 侧边栏选中态（单一判定来源 `isActive`）

- 判定函数（primary 与 more 复用同一实现，避免语义漂移）：
  - `home`：`route.path === '/'`
  - 其它：`route.path === item.to || route.path.startsWith(item.to + '/')`（支持子路由归属父项）
- 数据校验：`item.to` 缺失（理论不应发生，运营下发 fail-open 已过滤非法项）时 `isActive` 返回 false，不影响其它项渲染。

### 2.2 效果洞察数据链路（沿用既有归因，不新增后端）

- 取数：`listPatternPerformance({ platform? })` → `pattern_performance` 表，后端 `ORDER BY engagement_score DESC`。
- **前端二次显式降序**：`rowsFor(dim)` 对每个维度再按 `engagement_score` 数值降序稳定排序（不依赖后端返回顺序，保证"最优模式 = 首行"恒成立；同分保持原序）。
- 互动得分口径：`engagement_score = avg_likes + avg_comments + avg_favorites × 2`（首版启发式，与后端一致）。
- 数值校验：所有参与计算/展示的字段一律 `Number(...) || 0` 兜底，`NaN`/`null`/字符串不炸渲染。
- 更新时间：`computed_at` 经 `new Date()` 解析，`Invalid Date` → 显示 `—`；维度内取最大值（最近一次计算）。

### 2.3 平台筛选

- 选项**从当前数据派生**（`platform` 为空的聚合行不产生选项），去重升序。
- 切换平台 → `watch(platform, loadData)` 以 `{ platform }` 重新拉取；选「全部平台」传空参。
- 平台标签映射复用 `@multi-publish/shared-utils` 的 `PLATFORM_NAMES`（统一口径，如 `douyin → 抖音`），未知值原样展示不吞。

---

## 三、交互逻辑（UE）

### 3.1 侧边栏「更多」

1. **触发器常驻高亮**：`:class="{ active: moreOpen || hasActiveMoreItem }"`。`hasActiveMoreItem = moreItems.some(isActive)`。菜单展开**或**存在命中子项时，触发器保持高亮——收起后仍能感知"当前页在『更多』内"。
2. **子项高亮 + 无障碍**：more 子项绑定 `:class="{ active: isActive(item) }"` 与 `:aria-current="isActive(item) ? 'page' : undefined"`，与一级导航一致（键盘/读屏可感知当前页）。
3. **深链自动展开**：`watch(() => route.path)` 命中 more 组时置 `moreOpen = true`。
   - 为何用 watch 而非仅 onMounted：真实应用初始路由**异步解析**，硬刷新深链时 onMounted 早于 `route.path` 就绪；watch 在路由解析后再展开（onMounted 保留用于首屏同步态）。
   - 单测环境 `route` 为非响应式 mock，watch 不触发，由 onMounted + `await nextTick()` 覆盖断言。

### 3.2 效果洞察页

1. **重算归因防重复**：`recomputing` ref 守卫，进行中直接 `return`；按钮 `:loading` + `:disabled` 双保险（幂等但全量重分开销大）。成功后 `ElMessage.success` 并自动 `loadData()` 刷新。
2. **加载/错误分离**：
   - `loading` 期间表格 `v-loading`；
   - 接口异常 `loadError=true` → 顶部**可重试错误横幅**（不静默、不吞错误），行数据降级为空数组，页面不崩溃。
3. **两级空态**：
   - 页面级（无任何数据）：解释数据从哪来，引导"发布带改写关联的内容并回采"；
   - 维度级（该维度无行）：卡片内空态，避免残留空白表格。
4. **可信度提示**：`sample_count < 3` 的行以警告徽标呈现样本数，`el-tooltip` 悬浮说明"样本不足，结论仅供参考"（阈值 `LOW_SAMPLE_MIN=3`，与后端归因口径一致）。

---

## 四、显示项清单

### 4.1 侧边栏
- 「更多」触发器：图标 + "更多" + 箭头（展开时 `rotated`）；`aria-haspopup="true"`、`aria-expanded`。
- more 子项：图标 + 文案（i18n `labelI18nKey`）；active 时高亮 + `aria-current="page"`。

### 4.2 效果洞察页
- 头部：标题 / 副标题 / 平台筛选下拉 / 刷新 / 重算归因。
- 概览条（有数据时）：总样本数、模式数、最近计算时间。
- 四维卡片（开头钩子 / 情绪曲线 / 叙事结构 / CTA 方式），每卡：
  - 标题 + **最优模式 chip**（该维度得分最高项，值经 i18n 枚举翻译）；
  - 元信息：`{n} 个样本`、`更新于 {time}`；
  - 排行表：名次徽标（Top1 强调）、模式值、平台标签、样本数（低样本警告徽标）、平均阅读/点赞/评论/收藏、互动得分（进度条归一化 + 数值，表头 `ⓘ` 悬浮公式）。

---

## 五、用户可见文案（i18n zh/en 成对，CI Gate 7）

`perfInsights.*` 新增 key（zh/en 成对）：
`allPlatforms`、`platformFilterAria`、`scoreFormula`、`bestPrefix`、`samplesSummary`（`{n} 个样本`）、`updatedAt`（`更新于 {time}`）、`overviewSamples`、`overviewPatterns`、`overviewUpdated`、`dimEmptyTitle`、`loadFailed`、`lowSampleTip`（`样本不足 {min} 条…`）。

关键提示：
- 页面级空态标题「暂无归因数据」；提示「发布带改写关联的内容并回采表现数据后，这里会展示各表达模式的效果排行」。
- 维度内空态标题「该维度暂无归因数据」。
- 得分公式悬浮：`avg_likes + avg_comments + avg_favorites × 2`。
- 低样本悬浮：「样本不足 {min} 条，结论仅供参考」。
- 重算成功「归因重算完成」/ 失败「归因重算失败，请稍后重试」。

模式值标签复用 `knowledgeBase.patternHook_*` / `patternCurve_*` / `patternNarrative_*` / `patternCta_*` 枚举（同一套枚举体系），未知值原样展示（数据兼容）。

---

## 六、验收标准

1. 点击「更多」→「效果洞察」：子项高亮 + `aria-current="page"`；触发器高亮；菜单收起后触发器仍高亮。
2. 硬刷新/深链直达 `#/performance-insights`：「更多」自动展开且当前项高亮。
3. 路由不在 more 组（如 `/accounts`）：触发器与子项均无 active。
4. 一级导航激活不受影响（回归）。
5. 效果洞察页：概览/排行/最优 chip/低样本徽标/两级空态/错误横幅/平台筛选/重算守卫均按上文渲染；接口异常降级不崩溃。
6. 单测：`MpSidebar.more-active.test.js`（5）+ `PerformanceInsights.test.js`（7）全绿；既有 `sidebar-menu*.test.js` 无回归；locale `--keys`/`--cjk` 门禁通过。

## 七、测试与验证证据

- TDD：RED（12 例先失败）→ GREEN（12 passed）。
- 真实应用（Vite 渲染端 + 浏览器 DOM 取证）：
  - 收起态触发器 `class` 含 `active`（`mp-more-trigger active`）；
  - 展开后子项 `class` 含 `active` 且 `aria-current="page"`；
  - 深链重载后 `aria-expanded="true"`、触发器 active、子项 active。
