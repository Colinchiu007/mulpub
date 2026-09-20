# desktop-ui-consistency

## MODIFIED Requirements

### Requirement: 设计 token 单一来源

渲染层 SHALL 以唯一的 token 文件作为颜色/字号/间距/圆角/阴影/字重/字体族/行高/动效变量的单一来源；主色 SHALL 定标为 `#5048e5`。任何样式文件不得重新定义与 token 同语义的变量（如另设主蓝），不得以 hex 字面量新增主题色。

被标记为 `@deprecated` 的别名层 SHALL NOT 存在活跃消费者：`apps/desktop/src/**` 中对别名变量的引用数 MUST 为 0，并由静态门禁把该数值钉为 0。别名层本身在消费点清零后 SHALL 删除，不得以「留着无害」为理由长期共存 —— 双轨并存的实测代价是同一类组件在不同页面圆角相差 2px、主操作按钮出现两种品牌色且无规律。

权威 token 文件 SHALL 覆盖所有语义维度：若某维度（如字重、字体族、行高、动效、通用阴影级差）在权威文件中没有对应槽位，SHALL 先补齐该槽位再迁移消费点，SHALL NOT 以就地字面量作为迁移终点（就地字面量会制造第三套真相并规避 `check-color-literals` / `check-font-size-scale` 的门禁精神）。

#### Scenario: 新增主色引用

- **WHEN** 视图或组件需要引用主色
- **THEN** 它通过 token 变量获取 `#5048e5`，且全库扫描不存在第二种主蓝色字面量

#### Scenario: 暗色模式主色不被覆盖

- **WHEN** 应用切换到暗色模式
- **THEN** 主色保持 `#5048e5` 可辨识度，不得被局部覆盖为浅灰等低对比色

#### Scenario: 别名层回潮被拦截

- **WHEN** 有人在退役完成后新增一处 `var(--<deprecated-alias>)` 引用
- **THEN** 静态门禁失败并输出文件名与行号，CI 阻断

#### Scenario: 缺失槽位不得就地写字面量

- **WHEN** 某组件需要 `font-weight: 600` 而权威 token 文件尚无字重槽
- **THEN** 先在权威文件补齐该语义槽位并给出中英一致的命名，再在组件中引用；不得直接落 `600`

## ADDED Requirements

### Requirement: 主题令牌必须自带暗色覆盖

权威 token 文件中，凡被用作**前景色（文字/图标描边）或主题强调底色**的槽位，SHALL 在 `[data-theme="dark"]` 下拥有对应覆盖值；SHALL NOT 出现「同一变量在浅色是深字、在暗色仍是深字」的暗色盲区。若某变量在暗色下确需与暗色感知别名层共存，则别名层 SHALL 收敛为对权威 token 的**纯转发**，不得长期独立维护第二套暗色值。

#### Scenario: 暗色前景色可读性由 token 层保证

- **WHEN** 组件仅消费权威 token 且应用切到暗色模式
- **THEN** 其文字与背景对比度可读，无需在 `[data-theme="dark"]` 里为该组件单独补覆盖

#### Scenario: 暗色回归可被门禁捕获

- **WHEN** 某次改动使暗色下出现低对比文字
- **THEN** 视觉回归套件（含暗色基线通道）失败并定位到具体视图，而不是依赖人工注入 `data-theme` 读计算样式才发现

#### Scenario: 新增暗色覆盖不冲击浅色基线

- **WHEN** 为补齐暗色盲区而增补 `[data-theme="dark"]` 覆盖
- **THEN** 改动为纯新增（新槽位或仅暗色分支），全部浅色基线零变化
