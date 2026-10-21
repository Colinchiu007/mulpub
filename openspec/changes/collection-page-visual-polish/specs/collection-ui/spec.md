# 采集页视觉精致化 — Spec Delta（collection-page-visual-polish）

## ADDED Requirements

### Requirement：采集域视觉噪音上限

采集页面**不得**包含任何 `infinite` 循环动画，也不得在面板/卡片上使用装饰性渐变饰带
（顶部/侧边彩色条）。层次由 `1px 边框 + box-shadow` 承担。

**判据**：`collection-page-visual-polish.test.js` 的 A1 组（3 例）——
关键帧不存在、`::before` 不构成装饰性色条、无 `animation:*infinite*`。

#### Scenario: 面板无装饰饰带
- **当** 采集域样式（`collection-page.css` + `collection-page-legacy.css`，去注释）
- **那么** 不得命中 `col-panel-ribbon`，且 `.col-panel::before` 不同时具备
  「绝对定位 + 顶部贴边 + 固定高度 + background」四要素

#### Scenario: 采集域无无限循环动画
- **当** 扫描采集域样式里的 `animation:` 声明
- **那么** 不得出现任何含 `infinite` 的声明

### Requirement：采集结果卡片文本截断

采集结果卡的标题**必须**限制为 2 行，且必须显式声明行高与换行兜底。
标题被截断时，必须通过 `title` 属性提供**原文全文**。

**判据**：A3 组（4 例）—— clamp 存在、line-height 存在、三件套齐全、模板 `:title` 绑定原文。

#### Scenario: 长标题不撑破卡片
- **当** 某条采集结果标题为 25 字中文（如「有哪些历史上牛逼哄哄的人物却没有出现在初中和高中历史教科书上的？为什么？」）
- **那么** 标题在 2 行处截断并显示省略号，卡片高度与同排其它卡片一致
- **并且** 悬停时 tooltip 展示完整原文（不是截断后的文本）

### Requirement：采集结果无效态视觉可分

当采集结果**无标题（含纯空白）或字数为 0** 时，该卡片必须呈现与正常卡片**可区分**的
视觉态，并给出「建议重新采集」的提示。不得隐藏该条目、不得修改其数据。

**判据**：A5 组（4 例模板/样式）+ A5b 组（9 例行为，直接 import `collected-result-validity.js`）。

#### Scenario: 验证页条目被标出
- **当** 采集落地是「百度安全验证」页，标题为空且字数为 0
- **那么** 该卡片带 `col-result-card--invalid` 类（警告色边框 + 软底）
- **并且** 卡内显示 `collection.invalidResultHint` 提示行
- **并且** 提供 `data-testid="result-invalid-<id>"` 供视觉/E2E 定位
- **并且** 不修改 `item`、不改变任何既有 emit 与行为

#### Scenario: 无效判定 fail-closed
- **当** `wordCount` 为字符串 `'0'`（旧存储形态）
- **那么** 判为无效（数字归一后 0）
- **当** `wordCount` 为 `NaN`
- **那么** 判为无效（读数不可信 ⇒ fail-closed）
- **当** `wordCount` 缺失但 `content` 有正文
- **那么** 判为有效（退回 `content.length`）

### Requirement：采集域间距落在 4px 刻度

采集域新样式不得使用非刻度间距值（`14px` / `2px` 等），不得引用旧 `--space-*` 命名空间，
卡片内部间距必须经由 `--col-card-gap` 单点定义。

**判据**：A4 组（3 例）。

### Requirement：采集结果卡片操作按钮尺寸下限

卡片内操作按钮 `min-height` 不得低于 32px（`--col-btn-h`），字号不得使用 12px 档。

**判据**：A2 组（2 例）。

### Requirement：采集卡片光标不承诺未实现行为

采集域内 `.cohere-card` 不得保留 `cursor: pointer`（卡片本体不绑定点击）；
真正可点的子区域（`card-icon` / `card-info`）各自持有 pointer 光标。

**判据**：A7 组（1 例）。
