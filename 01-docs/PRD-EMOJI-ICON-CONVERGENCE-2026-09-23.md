# PRD：全站 Emoji 功能图标收敛（Element Plus 线性图标统一）

> **立项日期**: 2026-09-23 | **最后更新**: 2026-09-23
> **来源**: 用户反馈「个人知识库空态图标（📚 emoji）太丑，换精致图标」→ 全站同类问题扫描 → 一次性批量收敛
> **关联 PR**: #2249（分支 `kb-personal-empty-icon`，squash auto-merge）
> **变更日志**: 本文件记录 v1（PersonalKnowledgePanel 单点修复）+ v2（全站 41 处 / 28 文件批量收敛）

---

## 一、问题定义

### 1.1 现象

应用内大量**功能图标位**（空态图标、面板标题装饰、按钮图标、导航图标、占位图）直接使用 emoji 字符。Windows 平台 emoji 由 Segoe UI Emoji 渲染为**彩色实体图案**，与整体 Linear/线性图标设计语言冲突，观感粗糙（用户原话：「太丑」）。

### 1.2 违反的既有规范

`apps/desktop/src/icon-usage.test.js`（T1-5 图标使用守卫）早已规定：

1. **功能图标位**（按钮/标题装饰/卡片图标/导航项）禁止 emoji，一律 `@element-plus/icons-vue`；
2. **状态类 emoji 允许**：✅ ❌ ⚠️ ⏳ 🔄（表达结果/进行中，不是功能图标）；
3. **内容/文案类 emoji 允许**：营销话术、引导语、元信息标签的语义化修饰。

### 1.3 逃逸根因（为什么规范存在却大量违规）

守卫测试采用 **FILES 白名单逐文件登记制**：只检查登记过的文件，历史仅登记 9 个文件。其余 24 个组件/视图全部处于守卫盲区，新代码违规不会被 CI 拦截。属于「审查盲区 + 流程缺失」类系统性漏洞。

---

## 二、收敛范围与清单（v2，41 处 / 28 文件）

### 2.1 图标映射表（emoji → Element Plus 组件）

| Emoji | 码点 | 替换为 | 语义依据 |
|---|---|---|---|
| 🎬 | U+1F3AC | `VideoCamera` | 视频/创作类空态与缩略图占位 |
| 🔥 | U+1F525 | `TrendCharts` | 热点/爆款/高互动（趋势语义） |
| 📝 | U+1F4DD | `Document` / `EditPen` | 文案库→Document；编辑/模板动作→EditPen |
| 🔍 | U+1F50D | `Search` | 搜索/监测 |
| 🚀 | U+1F680 | `Promotion` | 启动/流水线/一键发布（纸飞机=推送语义） |
| 📋 | U+1F4CB | `CopyDocument` | 复制操作 |
| 🔗 | U+1F517 | `Link` / 移除 | 关联/引用；title 属性中的直接删除 |
| ⚙️ | U+2699 FE0F | `Setting` | 环境检测/设置 |
| 🔑 | U+1F511 | `Key` / 移除 | 账号密钥；ops-center 标题直接删除 |
| 🎯 | U+1F3AF | `Aim` | 选择目标平台 |
| 📊 | U+1F4CA | `DataLine` | 数据/统计/基准 |
| 💡 | U+1F4A1 | `MagicStick` | AI 建议（Suggestion 图标不存在，经导出名校验改用 MagicStick） |
| ⚡ | U+26A1 | `Medal` / `User` | 会员中心→Medal（会员语义）；头像占位→User |
| 🏠 | U+1F3E0 | `HomeFilled` | 返回首页/首页标签 |
| 📭 | U+1F4ED | `Box`（EmptyState 默认值） | 通用空态 |
| 🐦📷👤💬🎵📕🔴📺📰❓▶️🌐 | — | 删除 PLATFORM_ICONS 表 | TabBar 品牌 emoji 整体移除（见 2.2） |

### 2.2 特殊处理项

- **EmptyState.vue（共享空态组件）**：
  - 默认 `icon` 由 `'📭'` 改为 `'Box'`；新增图标名白名单映射 `ICON_COMPONENTS = { Box, VideoCamera, TrendCharts, Document, Search, Promotion }`。
  - `icon` prop 传入**白名单图标名**时渲染 `<el-icon><component :is="..."/></el-icon>`；传入其他字符串按纯文本回退（兼容 `#icon` slot 覆盖与历史调用方）。
  - `#icon` slot 优先级不变（slot 存在时完全接管，如 PersonalKnowledgePanel 用 `<Collection>`）。
  - 尺寸继承容器 `.mp-empty-state__icon { font-size: 38px }`（el-icon 使用 currentColor + em 尺寸）。
- **TabBar.vue 平台标签图标**：原 `PLATFORM_ICONS` 全 emoji 表仅作「无品牌 URL 时」fallback（真实品牌图标 `getPlatformIconUrl` 的 `<img>` 分支优先，该分支保留）。本次删除整个 emoji 表及 `getPlatformIcon`/`getDomainForPlatform` 函数，fallback 统一为 `<el-icon><Monitor/></el-icon>`（通用网页标签语义）；首页标签 🏠 → `HomeFilled`。
- **CreateHistory.vue `icon="🔄"`**：状态类（进行中/循环）允许，**保留不收敛**（同 FirstRun ❌、Publish ⏰/✕、NavBar ✓/⟳ 等状态符号）。
- **TemplatePicker.vue 类别标签**：`📊 报告/📣 营销/📚 教育/💬 社交` 为纯文本标签（无法嵌 el-icon），直接去 emoji 保留文字。
- **ops-center 前端**（独立 Vue3 应用）：`ModelKeys.vue` 页面标题去 🔑；`PromptEvalWorkbench.vue` `'🔍 评估中'` → `'⏳ 评估中'`（评估是进行中状态，归状态类，与相邻 `'⏳ 生成中'` 统一）。

### 2.3 显示项与交互逻辑约束（回归验收口径）

1. **视觉**：功能图标位一律单色线性图标，颜色继承容器（空态主色图标经 `color="var(--color-primary)"` 的保持现状）；不得出现彩色 emoji。
2. **a11y**：原 `aria-hidden="true"` 容器保留；图标组件本身不引入新的可聚焦元素；`title`/`aria-label` 文案不变（仅 ReferenceFinder 弹窗标题去掉 emoji 前缀，文字「引用查找」不变）。
3. **i18n**：本次不新增用户可见文案；Publish 模板按钮折叠态 `'📝 ' + t('publishPage.template')` 改为纯 `t('publishPage.template')`，locale 键零变化。
4. **数据校验**：EmptyState `icon` prop 仍为 String；白名单外值不报错（纯文本回退）；不做运行时 console.warn（避免污染）。
5. **交互零变更**：所有按钮点击、路由跳转、IPC 调用逻辑不动；NavBar 复制按钮 `copied` 态显示 `✓`（状态字符）→ 未复制态 `CopyDocument` 图标，切换逻辑与原 `{{ copied ? '✓' : '📋' }}` 等价。
6. **TabBar 行为**：无品牌图标 URL 的标签从「平台 emoji」变为统一 `Monitor` 线性图标——有真实品牌图标的标签（走 `getPlatformIconUrl`）显示不变。

---

## 三、守卫防回退（防逃逸闭环）

1. `icon-usage.test.js` FILES 从 9 个扩展到 **34 个**（新增 25 项：28 个收敛文件 + EmptyState + 上批 PersonalKnowledgePanel 已登记），后续任何登记文件重新引入禁用 emoji 都会被 CI 拦截。
2. `ICON_EMOJI` 禁用清单新增 📭（U+1F4ED，EmptyState 旧默认值）。
3. **测试 mock 纪律**：6 个视图测试文件对 `@element-plus/icons-vue` 使用受限 `vi.mock` 工厂（vitest 对 mock 缺失导出抛 "No X export is defined"），统一改为 **Proxy 兜底**（`has: () => true` + 未知图标名返回 `<span />` stub），保证守卫后续新增图标不逐案破坏既有测试。

## 四、验收结果

- 定向测试 26 文件 487 用例 + views 深测 6 文件 161 用例全绿（icon-usage 34 文件登记后 35/35）。
- 复扫：禁用 emoji 码点全站扫描 `apps/desktop/src` + `ops-center/frontend/src` 0 命中。
- 文档回写：本 PRD、`docs/frontend-interaction-spec.md` §11、CHANGELOG。

## 五、后续可选项（不在本次范围）

- 视觉基线截图（需要打包环境，CI 视觉回归由既有 gates 覆盖）。
- TabBar 品牌图标补齐更多平台 URL 映射（数据侧，非本 PR）。

## 六、Gate 7 --cjk 联动修复附录（2026-09-23，CI 补漏）

- **现象**：PR #2249 merge main 后 CI QG Static 报 `check-locale-sync --cjk` 新增 12 处渲染端硬编码中文（BenchmarkChart「内容基准比较」、KeywordMonitorPanel「关键词监测」、OptimalTimeTip「{n} 条数据」、ReferenceFinder「引用查找」×2（文本+title 属性）、TemplatePicker「内容模板」「报告/营销/教育/社交」、TitleAssistantPanel「标题参考」、TrendingPanel「热门趋势」）。
- **根因**：Gate 7 新版基线按 `file||content` 键存储；emoji→el-icon 替换改变了模板文本节点内容（「📊 内容基准比较」→「内容基准比较」），旧键失配判为 fresh。属既有硬编码文案的键形态迁移，非新增违规。
- **修复（不掩盖新增纪律）**：不使用 `--update-baseline`；12 处文案全部迁入 locale——`intelligence` 命名空间成对新增 11 键（benchmarkTitle/keywordMonitorTitle/dataPointsCount/referenceFinderTitle/templatePickerTitle/categoryReport/categoryMarketing/categoryEducation/categorySocial/titleAssistantTitle/trendingTitle），zh 值与原文案逐字一致（含 `{n}` 插值），渲染显示零变化；模板改 `{{ $t(...) }}` / `:title="$t(...)"`；TemplatePicker `categoryLabel()` 改用 `useI18n().t`。
- **测试适配**：7 个组件测试 mount 无 i18n 插件导致 `$t is not a function`（42 例红），按仓库 TagSuggester 惯例经 `config.global.plugins` 注入 `createI18n({legacy:false, locale:zh, messages:{zh,en}})` 修复，47/47 绿。
- **验收**：`--cjk` PASS（基线 1581/当前 1376 无 fresh）、`--keys` PASS（1125 键 zh/en 成对存在）、Gate7 node:test 6/6、icon-usage 守卫 35/35。
