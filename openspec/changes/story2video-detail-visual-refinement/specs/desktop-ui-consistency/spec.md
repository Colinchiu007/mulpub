# desktop-ui-consistency

## ADDED Requirements

### Requirement: 暗色模式文字色必须走暗色感知别名

渲染层在暗色模式下需要文字/背景色时，SHALL 使用 `cohere-design-system.css` 提供的暗色感知别名层（`--ink` / `--muted` / `--surface` / `--error` / `--border`）或已在 `[data-theme="dark"]` 重定义的槽位；SHALL NOT 直接把 `tokens.css` 中**未提供暗色覆盖**的 `--color-text-*` / `--text` 用作暗色下的前景色。主色在暗色下需要提升可辨识度时 SHALL 使用 `--color-primary-dark-tint`。

#### Scenario: 按钮类名迁移不引入暗色回归

- **WHEN** 某按钮从浅色专用文字令牌迁移到共享按钮类
- **THEN** 暗色模式下其计算样式的前景色与背景色对比度可读（实测前景 `rgb(232,232,237)` on 背景 `rgb(35,35,41)`），不出现近黑文字压在近黑背景上

#### Scenario: 暗色修复不得冲击浅色基线

- **WHEN** 为暗色补文字/边框覆盖
- **THEN** 覆盖只写在 `[data-theme="dark"]` 分支内，浅色分支保持原样，既有浅色视觉基线零变化

### Requirement: 交互元素必须提供可见焦点与降级动效

所有可聚焦交互元素（含自研组件与裸原生控件）SHALL 提供 `:focus-visible` 可见焦点指示，禁止无替代的 `outline: none`。任何 `transition` / `animation`（含入场 stagger、thumb 缩放、流光）SHALL 在 `@media (prefers-reduced-motion: reduce)` 下关闭或降级；只允许动画 `transform` / `opacity` / `box-shadow`。

#### Scenario: 键盘遍历可见

- **WHEN** 用户用 Tab 键遍历详情页配置区
- **THEN** 每个按钮、滑杆、下拉、页签都出现焦点环，无任一元素静默不可见

#### Scenario: 减少动效偏好生效

- **WHEN** 系统开启「减少动态效果」
- **THEN** 分组入场、卡片 hover 位移、CTA 流光、滑杆 thumb 过渡均不出现，功能不受影响

### Requirement: 复用子树不得反向依赖父视图内部实现

从大视图抽取出的子组件 SHALL 通过显式契约（`provide`/`inject` 的访问器对象，或 props/emits）与父组件交互，SHALL NOT 直接引用父组件内部作用域或父组件私有方法名。当契约缺失时 SHALL **fail-closed**（抛出明确错误），不得静默渲染空白。

#### Scenario: 误用于其它父组件时立即暴露

- **WHEN** 抽取出的面板被挂到未 `provide` 契约的父组件下
- **THEN** 组件在挂载时抛出可读错误，测试与开发期即时发现，而不是页面局部静默空白

#### Scenario: 抽取保持写路径单一

- **WHEN** 子组件写配置项
- **THEN** 值仍落到父组件持有的同一响应式对象引用上，父侧 `deep` watcher 与保存节流副作用与抽取前逐字节一致，系统中不存在第二份该配置的真值来源
