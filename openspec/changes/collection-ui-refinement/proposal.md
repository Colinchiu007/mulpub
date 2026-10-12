# Proposal: collection-ui-refinement

## Why

采集页（`apps/desktop/src/views/Collection.vue`，2908 行）是全应用使用频率最高的页面之一，但用户反馈「内容散乱、视觉不够精致」：

1. **信息架构散乱**：采集 tab 内五种入口（URL 采集、RSS 批量、URL 列表批量、知乎收藏夹批量、快捷操作卡）平铺在一屏；两套进度展示（`batchTaskId` 进度条 vs 知乎「采集并改写」进度卡）机制重复、视觉不统一；结果卡片信息层级未分主次。
2. **视觉不精致**：style 块 2626–2855 行「精致化主题」为亮色硬编码（`rgba(255,255,255,0.98)`、`linear-gradient(135deg,#f8fafc…)`、`#ea580c` 系、43 处 hex），暗色模式下出现浅底浅字/深底深字（tokens.aliases.test.js 头注释记载的同族事故）；知乎收藏夹区块（172–269 行）残留 20+ 处内联样式，未走 T1-3d 收编。
3. **行数债务**：`Collection.vue` 是 max-lines 零容差登记文件（2920 基线，净增 ≤30 行），任何 UI 增强都必须以「抽组件落新文件」的方式实施。

## What Changes

- **信息架构收敛**（Q10 定案，行为契约不变）：
  - a. 两套批量进度统一为一套 `ColProgressBlock` 组件（同一 DOM 契约：标题 + 进度轨道 + 百分比 + 取消/展开）。
  - b. 批量采集区（RSS / URL 列表 / 知乎收藏夹）改为折叠分组，默认只展开第一组，一次只展开一组（互斥手风琴）；URL 单条采集工具条保持常驻不折叠。
  - c. 结果卡片与文案库卡片信息层级重排：标题/来源/时间为一级，徽标为二级，操作按钮按使用频率分主次（主操作 primary，其余 secondary，删除 danger）。
  - d. 底部平台快捷卡**保留不动**（有行为测试与既有 PRD 契约）。
  - e. 空/加载/错误三态统一复用既有 `EmptyState` 与 `col-error-banner` token 化样式，错误提示文字全部走 locale。
- **视觉收编**（Q3 定案：A + 少量 B）：
  - 亮色硬编码全部替换为 `tokens.css` 语义槽；新增语义槽仅限确有缺口者（亮/暗两档同步 + 契约测试登记）。
  - 知乎收藏夹区块内联样式全部类化（对齐 T1-3d 先例）。
- **暗色模式走查**（Q11 定案）：采集页四页签逐块核对暗色对比，补齐 `[data-theme="dark"]` 覆盖。
- **文件拆分**（Q7 定案：大粒度）：
  - `features/collection/BatchCollectPanel.vue` — 批量采集区（RSS/URL 列表/知乎收藏夹 + 统一进度），模板 135–309 行及其专属 script 状态整体迁出；
  - `features/collection/CollectedResultsList.vue` — 采集结果累计列表 + 批量操作条（311–393 行）迁出；
  - `Collection.vue` 净行数下降（目标 ≤2600 行），为零容差门禁创造余量。
- **文档**：专项 PRD `01-docs/PRD-COLLECTION-UI-REFINEMENT-2026-10-12.md`（数据校验/流程/功能逻辑/交互逻辑/显示项/提示文字全量）+ CHANGELOG 前插。

## Impact

- Affected specs: `openspec/specs/collection-ui/spec.md`（新建 capability delta）
- Affected code: `apps/desktop/src/views/Collection.vue`、`apps/desktop/src/features/collection/`（新增 2 组件 + 1 进度组件）、`apps/desktop/src/locales/zh.js`/`en.js`（成对）、视觉基线 `apps/desktop/tests/visual/*collection*`
- 不改 IPC 契约、不改数据模型、不改采集/改写/批量发布业务逻辑。
