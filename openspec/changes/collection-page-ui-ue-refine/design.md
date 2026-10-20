# Design: collection-page-ui-ue-refine

## 方案对比

### 方案 1（采纳）：新增采集域共享规范层 + 死类清零 + CSS 契约判据
- 新建 `features/collection/collection-page.css` 承载采集页专属规范（`--col-*` 变量组 + `col-btn`/`col-field`/`col-card`/`col-badge`/`col-banner` 类族），由 `Collection.vue` 与域内组件共同 import。
- 既有类名全部保留（测试与样式引用不改），只把它们的**视觉声明**改为引用新变量组 ⇒ 一次统一、零引用面破坏。
- 新增 `collection-page-css-contract.test.js` 做「消费⇒有定义」机械判据。
- 优点：不牵动 `cohere-design-system.css` 的 62 文件共用面；行数可控（Collection.vue 净增 ≤0）；判据可机械执行。
- 缺点：域内出现第二套类名（`col-btn--*` 与 `cohere-btn-*` 并存），需要 PRD §2 明确「采集域不再新建 cohere-btn-* 引用」的纪律。

### 方案 2：直接改 `cohere-design-system.css` 的按钮/卡片规则值
- 被否：那是 62 个文件的共用面，改按钮圆角/高度会让全库视觉回归，像素基线要全量重建，且违背「上一轮刻意不动的边界」。

### 方案 3：引入 UI 框架按需组件（element-plus 全量替换采集域控件）
- 被否：QM-2 明令禁止新增全局 `app.component`/全量框架引入（首屏 bundle 地雷，2026-10-15 事故）；且采集域现有 el-icon/el-dialog 已按需使用，替换收益不抵风险。

## 组件契约

### `collection-page.css`（新增，非 scoped）
被 `Collection.vue` / `BatchCollectPanel.vue` / `CollectedResultsList.vue` / `ColProgressBlock.vue` / `CollectionDraftsPanel.vue` / `QuickCollectPanel.vue` 共同 `@import`。因 Vue scoped 样式的作用域限制，**导入方必须是 `Collection.vue`（唯一非 scoped 入口）或在各组件 `<style scoped>` 内 `@import`**——本轮采取后者（各组件自行 import，Vite 会把同一 CSS 合并进同一 chunk，无重复运行时开销；`collection-page-css-contract.test.js` 直接读文件不断言 import 次数）。

类族与变量组：

| 类族 | 类名 | 视觉锚点 |
|---|---|---|
| 按钮 | `.col-btn--primary/secondary/danger/ghost` | `--col-btn-h`(32px) + `--radius-sm`(8px) + 语义色 |
| 输入 | `.col-field` / `--grow` / `--sm` | `--col-field-h`(32px) + `--col-field-pad`(0 10px) + `--radius-xs`(4px) |
| 面板 | `.col-panel` / `.col-panel__head` | `--radius-lg`(16px) + `--col-panel-pad`(20px) + `--shadow-sm` |
| 卡片 | `.col-card` | `--radius-md`(12px) + `--col-card-pad`(16px) + 1px 边框无影 |
| 徽标 | `.col-badge` / `--ok` / `--warn` / `--muted` | `--radius-xs`(4px) + `--font-size-xs` |
| 横幅 | `.col-banner` / `--error` / `--info` / `--warn` | `--col-banner-pad`(8px 12px) + 语义 soft 底 |
| 页签 | `.col-tabs` / `.col-tab` / `.col-tab-badge` | `--color-tab-active-bg` + `--shadow-tab-active` |

### 「消费⇒有定义」判据的实现口径

```
遍历 SCOPE_VUE = [Collection.vue, BatchCollectPanel.vue, CollectedResultsList.vue,
                  ColProgressBlock.vue, CollectionDraftsPanel.vue, QuickCollectPanel.vue,
                  QuickCollectCommandDialog.vue]
  从每个文件的 <template> 抽取 class="..." 的 token（去掉 :class 动态部分，只取静态字符串）
  对每个 token T：
    若 T 以 col- / zb- / qc- / card- / batch- / stat- 等前缀开头（域内命名空间）
      ⇒ 必须在 collection-page.css 或该组件自身 <style> 中找到 .T { 规则
    否则（cohere-* / mp-* / el-*）⇒ 跳过（属全局层，由 cohere-design-system 管）
反向：is-primary / primary 两个死类 ⇒ 域内 0 消费
```

⚠ 判据必须**打印命中条数并对下界断言**（AGENTS QM-2：「结构解析类判据必须打印命中条数并对命中数做下界断言」——裸 `/from\s+…/` 形态会匹配 0 条并算出「闭包 = 已导入」的假结论，同类事故）。

## 视觉规范

### 死类修复（P3/P14）
| 死类 | 消费点 | 处方 |
|---|---|---|
| `is-primary` | `CollectedResultsList.vue:99/100` | → `col-btn--primary`；测试同步改断言 |
| `primary` | `Collection.vue:328`、`CollectionDraftsPanel.vue:56` | → `col-btn--primary` |
| `collection-tab-badge` | `CollectionDraftsTab.vue:11`、`CollectionCreatorTab.vue:11` | 补定义：主色底 + 白字 + `min-width:18px` + 居中 + `99+` 截断 |

### 页头与底色（P4）
`.cohere-page-header` 在采集页加 `background: var(--color-bg-page)`，与 `.cohere-content` 同底；分隔沿用 1px `--color-border` 底线。实现位置：`collection-page.css` 里写 `html .cohere-page-header` 前缀抬特异性（tokens.css P4D 同手法：scoped 的 (0,2,0) 压过全局 (0,1,0)）。

### 页签 aria（P5）
- 按钮：`role="tab"` + `:aria-selected` + `:aria-controls="'collection-tabpanel-' + activeTab"`（既有 `role="tablist"` 保留）。
- 内容容器：`role="tabpanel"` + `:aria-labelledby` 指向当前 active 按钮 id；5 个页签面板各自一个 id（`collection-tabpanel-collect` 等）。
- ⚠ 既有测试 `Collection.test.js:1465` 断言 `.collection-tab-btn` 数量 = 5 —— aria 改动不影响该计数。

### 快捷操作卡重排（P6）
DOM 从「6 张平铺」改为「3 组 × 分组标题 + 组内卡片」，用 `<section class="col-quick__group">` 承载。保留 `data-testid="quick-drafts-box"` 与 `.cohere-stat-card` 类（视觉用例 `functional-test.js:265` 依赖 `.cohere-stat-card`，`waitForCount(…, 2)` 要求 ≥2 张——重排后仍有 6 张，不破）。

### 间距收敛（P2/P11）
- `zb-mt4` → `margin-top: var(--spacing-2)`；`zb-mt6` → `--spacing-3`；`zb-mt8` → `--spacing-4`。
- `col-panel` 的 `padding: var(--space-md)` 改为 `var(--col-panel-pad)`（20px，比原 12px 大——**这是有意的视觉变化**，像素 diff 归因时须落在「面板内边距」这一带）。
- 5 种 select/input padding 统一走 `--col-field-pad`。

## 数据校验（不变项）

见 PRD §5。本轮零新增业务校验；唯一新增是 CSS 契约判据（§「消费⇒有定义」）。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 类名大面积替换引入行为回归 | 既有 287 例测试全绿是门槛；testid 一律不动；`:class` 动态绑定保留原表达式只换静态 token |
| 像素基线必漂移且本机无 Chromium | 先归因（差异带 = 页头底/页签/快捷卡/卡片内边距/按钮五带）→ CI `QG Visual` 取证；本机装不上则如实登记「未本机取证」 |
| CJK 基线迁移被判「新增」 | 7 处裸串迁 locale 是**同一字符串搬家**，`check-locale-sync --cjk` 两侧同步更新；迁移前后渲染文字逐字相同（用 diff 验证） |
| `col-panel` 内边距 12→20px 推开布局 | 有意变化，PRD §4.3 明示；像素 diff 归因第二带 |
| targets 零容差（Collection.vue ceiling 2920） | 现状 2230 行有 690 行余量；纪律仍要求净增 ≤0（迁出的比加入的多） |
