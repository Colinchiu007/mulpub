# story2video-page-ux

详情页（`CreateView` → 流水线创作 → 选中故事讲述流水线）的视觉与交互精致化契约。字段级规格（控件清单、取值范围、步长、默认值、提示文字中英对照）以 `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §11 为单一来源，本文件只承载可被 CI/测试校验的行为合同。

## ADDED Requirements

### Requirement: 详情页列宽与页签合同

`CreateView` 的页面容器 SHALL 显式声明 `width: 100%` 并配合 `max-width: 1080px; margin: 0 auto` 取得设计列宽；不得依赖 flex 交叉轴默认拉伸。详情页容器 SHALL 补 `min-width: 0`。视图切换页签 SHALL 按页签数量自适应等分（`flex: 1 1 0; min-width: 0`），SHALL NOT 硬编码栅格列数，且激活态 SHALL NOT 使用会引发重排/抖动的 `transform: scale()`。

#### Scenario: 宽视口下不出现右侧死白

- **WHEN** 应用在 1920px 视口打开 `/create` 的任一视图
- **THEN** 内容列宽为 1080px 且水平居中，右侧不出现因 `fit-content` 退化（约 500px）导致的大片死白

#### Scenario: 页签数量变化不留空灰

- **WHEN** 视图切换页签数量为 3（或未来增减）
- **THEN** 页签等分整行宽度，尾部无未填充的容器背景；激活页签以 `box-shadow` + `font-weight` 表达，切换时无布局抖动

#### Scenario: 返回按钮不被拉伸

- **WHEN** 详情页渲染 `.back-btn`
- **THEN** 其宽度等于内容宽度（`align-self: flex-start`），不呈现通栏灰条；顶部导航箭头在详情页隐藏，避免与页内返回语义重复

#### Scenario: 滚动合同不回退

- **WHEN** 详情页内容超出一屏
- **THEN** 保持既有「操作条在正常流底部 + 内层独立滚动」行为（PRD §2.1.6），不得改为整页滚动或固定悬浮遮挡

### Requirement: 表单控件统一实现

详情页 SHALL 不存在裸 `<select>` 与未定制的裸 `<input type="range">`；下拉一律经 `UiSelect`、滑杆一律经 `UiSlider`，需要 label/hint/错误位/运营显隐的组合一律经 `UiField`。滑杆 SHALL 使用品牌主色（`--color-primary`）作为填充与 thumb 描边色，不得保留浏览器默认强调色。运营的选项显隐判定 SHALL 只经 `s2vOptionVisible` 的 fail-open 语义，新组件 SHALL NOT 绕过或重新实现该判定。

#### Scenario: 滑杆可视状态与取值一致

- **WHEN** 用户拖动「旁白语速」滑杆（`min 0.5 / max 2 / step 0.1 / 默认 1`）
- **THEN** 已填充段按百分比增长，右侧数值以 `toFixed(1)` 显示并带 `x` 后缀，越界输入被 clamp

#### Scenario: 键盘与复位可发现

- **WHEN** 用户聚焦滑杆后按 ↑/↓ 或 PageUp/PageDown，或双击滑杆
- **THEN** 分别以 `step` 与 `step×10` 调值、以 `defaultValue` 复位；hint 文案（`doubleResetHint`：「双击滑杆可恢复默认值」）常驻可见

#### Scenario: 漏改的裸滑杆仍有兜底

- **WHEN** 某处仍存在未迁移的裸 `<input type="range">`
- **THEN** `video-creation-forms.css` 的兜底规则使其 `accent-color` 为品牌主色，不出现浏览器默认蓝

#### Scenario: 运营关闭选项时整项消失

- **WHEN** 某 `optionKey` 被运营后台置为不可见
- **THEN** 该字段（label + 控件 + hint）整块不渲染，而非仅隐藏控件留下空洞 label

### Requirement: 禁用原因必须可见

主操作（启动流水线）在 `canStartPipeline === false` 时 SHALL 同时提供 (a) 按钮 `disabled`、(b) 按钮 `title`、(c) 按钮下方常驻的阻塞原因文字（取首条阻塞项），SHALL NOT 静默禁用。原因文案 SHALL 来自 locale 的 `create.story2video.ui.blockedReason.*`，ZH/EN 成对。

#### Scenario: 未填文案时的禁用反馈

- **WHEN** 故事文案为空导致启动按钮禁用
- **THEN** 按钮下方出现 `blockedReason.noText` 对应的可读原因（zh「请先输入视频文案」），用户无需猜测

#### Scenario: 数值越界时的禁用反馈

- **WHEN** 任一数值选项越出允许范围导致禁用
- **THEN** 显示 `blockedReason.invalidRange`（zh「部分数值参数超出允许范围，请检查语速、音量与分镜长度」），而非通用失败提示

### Requirement: 辅助信息防跳变

预估摘要与字符计数等辅助信息 SHALL NOT 因内容为空而移除容器。文案字符计数 SHALL 内嵌于 textarea 右下角，并按比例分档着色：`<90%` 中性、`≥90%` warning、达上限 danger 且以 `aria-live="polite"` 播报。

#### Scenario: 无文案时的预估占位

- **WHEN** 用户尚未输入文案
- **THEN** 预估区显示 `estimatePlaceholder`（zh「填写文案后自动预估分镜数、旁白时长与成本」），容器保持固定最小高度，输入后内容替换占位不引发布局跳动

#### Scenario: 接近上限的可访问性

- **WHEN** 文案长度达到上限
- **THEN** 计数转为 danger 色并通过 `aria-live` 追加 `charLimitReached`（zh「（已达字数上限）」）

### Requirement: 折叠分组状态跨会话持久

配置分组（`basic / visual / videoEnhance / voice / advanced / publish`）的展开态 SHALL 复用既有「上次选项」持久化通道（`ui.expandedGroups`）保存与恢复，SHALL NOT 新增并行字段造成双源真相；读取失败 SHALL 回落为默认展开。未改动过取值的分组 SHALL 在摘要处显示默认值并追加 `sectionDefaultSuffix`（zh「（默认）」/ en " (default)"）。

#### Scenario: 重启后恢复展开态

- **WHEN** 用户收起若干分组、退出应用后重新进入详情页
- **THEN** 展开态与退出前一致；持久化数据缺失或损坏时回落到默认全展开，不出现空白页

#### Scenario: 摘要反映真实取值

- **WHEN** 用户修改了某分组内任一取值
- **THEN** 该分组收起后摘要行显示新值，且不再带「（默认）」后缀
