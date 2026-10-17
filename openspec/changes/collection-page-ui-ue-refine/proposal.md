# Proposal: collection-page-ui-ue-refine

## Why

采集页是使用频率最高的页面，但用户真机走查反馈「整体布局和细节元素和用户交互体验，视觉上都很散乱，不够统一和清晰，也不够精致高级」。逐条取证（详见 PRD §1，共 15 项）后定位到三层根因：

1. **没有组件级规范可依**：六套按钮方言（`cohere-btn-primary` 32px 药丸 / `cohere-btn-secondary` 幽灵文字 / `card-actions button` 药丸描边 / `zb-*` / `tag-*` / `library-filter-btn`）、六套卡片内边距（12/12/12/10/14/12 px）、五种输入控件高度（28–36px）、四套徽标圆角。每个作者按 nearest-neighbor 抄一份，没有任何东西说「采集页这一页该怎么组合」。
2. **消费了不存在的 class**：`is-primary`（`CollectedResultsList.vue:99-100`）与 `primary`（`Collection.vue:328`、`CollectionDraftsPanel.vue:56`）在全仓 **0 处样式定义** ⇒ 「创建草稿/发布」与「查看/视频创作」视觉上完全相同，分级是假的；`collection-tab-badge`（两个页签组件在用）同样无定义 ⇒ 角标是裸文本。而现有测试只断言 class 名存在、不断言它有样式 ⇒ 功能测试全绿也发现不了。
3. **页面级语法缺位**：页头白底 + 内容区 `--color-bg-page` 灰底形成硬切；6 张快捷操作卡混了写操作/导航/外跳三种语义且用 emoji 图标（跨平台字体渲染不一致，是「不高级」的直接来源）；错误/进行中/警告三套横幅视觉；`QuickCollectPanel.vue` 残留 11 处硬编码 hex 且不在 token 门禁的 SCOPE_FILES 里（门禁照绿、代码照脏）。

## What Changes

- **立采集页组件规范**（新增 `features/collection/collection-page.css`，~200 行）：按钮三档 `col-btn--primary/secondary/danger/ghost`、输入控件一档 `col-field`、卡片两档 `col-panel`/`col-card`、间距四档、徽标一档 `col-badge`、横幅一档 `col-banner`。既有类名（`col-select`/`col-error-banner`/`zb-select`…）**保留**（测试在用），视觉声明统一引用新变量组。
- **修两个死类**：`is-primary`/`primary` 从采集域清零，改 `col-btn--primary`；`collection-tab-badge` 补真实定义（主色底 + 白字 + `99+` 截断）。
- **新增机械判据**：`collection-page-css-contract.test.js` —— ① 新槽亮暗两档；② 采集域 6 文件 `<style>` 无 hex（SCOPE_FILES 扩 3 个文件）；③ **「消费的类必须有定义」**（枚举 .vue 里的 class 用法逐个在 CSS 找规则）；④ 死类 0 消费。第 ③ 条是本轮最关键的增量：它防的正是「抄了类名没抄定义」这类功能测试永远看不见的缺陷。
- **页面级统一**：页头与内容区同底；页签 aria 补全（`aria-controls` + 内容容器 `role="tabpanel"`）；快捷操作卡重排为「新建 / 草稿 / 素材来源」三组并去 emoji；文案库与结果卡操作分级落地（primary 真有样式）。
- **硬编码收编**：`QuickCollectPanel.vue` 11 处 + `WordCountRangeInput.vue` 1 处 + `Collection.vue` 1 处兜底 hex → tokens 语义槽；tokens.css 新增 9 个 `--col-*`/`--color-tab-active-bg`/`--shadow-tab-active` 槽（亮暗两档）。
- **删死文件**：`views/Collection.polish.css`（49 行，全仓零 import，亮色硬编码源头）。
- **文案迁 locale**：7 处裸中文字符串（副标题/placeholder/采集按钮/重试/结果标题/快捷卡标签/chip 行按钮）→ `collection.*` key，zh/en 成对；CJK 基线同步迁移。
- **文档**：PRD `01-docs/PRD-COLLECTION-PAGE-UI-UE-REFINE-2026-10-17.md`（15 项问题逐条 file:line + 控件规范 + 数据校验不变声明 + 提示文字逐条登记）。

## Impact

- Affected specs: `openspec/specs/collection-ui/spec.md`（本轮 change 归档后新建该 capability；delta 见 `specs/collection-ui/spec.md`）
- Affected code: `apps/desktop/src/views/Collection.vue`、`apps/desktop/src/features/collection/{BatchCollectPanel,CollectedResultsList,ColProgressBlock,CollectionDraftsPanel,QuickCollectPanel,QuickCollectCommandDialog}.vue`、`apps/desktop/src/components/WordCountRangeInput.vue`、`apps/desktop/src/styles/tokens.css`、`apps/desktop/src/locales/collection/{zh,en}.js`、视觉基线 `apps/desktop/tests/visual-testing/base-screenshots/collection{,-dark}.png`
- **不改**：IPC 契约、数据模型、采集/改写/批量发布业务逻辑、页签集合（5 个）与默认页签、`zhihu-fav-*` testid、`cohere-design-system.css` 既有规则值（62 文件共用面）。
