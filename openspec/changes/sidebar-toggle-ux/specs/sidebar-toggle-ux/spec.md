## MODIFIED Requirements

### Requirement: 折叠按钮必须使用可表意的语义化图标并随状态翻转

按钮图标 MUST 为内联 SVG，使用 `currentColor`，MUST NOT 使用 emoji 或图标字体。
图标 MUST 由「左侧矩形（表示侧栏面板）+ 方向箭头」构成，**不再是双向 `chevron`（「<>」形状）**，
且 MUST 随折叠状态改变图形（不只是改颜色）：

- `expanded`（侧栏可见）：面板**实心**，箭头指向**左侧**（点击后侧栏去左边）
- `collapsed`（侧栏已隐藏）：面板**虚线/空心**，箭头指向**右侧**（点击后侧栏回到左边）

理由：双向 `chevron` 在通行图标语义里读作「代码」或「展开更多」，与「收起侧栏」无关；
且原实现两态共用同一图形，用户无法从图标判断当前处于哪个状态，只能靠颜色——
颜色是单通道，对色觉障碍用户失效。把状态差异放进**形状**，才成为冗余编码。

图标组件 MUST 接收 `collapsed` prop（`Boolean`，默认 `false`）以选择图形；
默认值 MUST 渲染展开态图形。图标视觉尺寸 MUST 为 18px（原 16px，见下条「视觉权重」）。

#### Scenario: 两态图形不同

- **WHEN** `collapsed=false` 渲染图标
- **THEN** 图形为实心面板 + 左向箭头
- **AND** `collapsed=true` 时图形为虚线面板 + 右向箭头
- **AND** 两态的 SVG `path` 集合不相等（不是同一图形换颜色）

#### Scenario: 图标不参与读屏

- **WHEN** 读屏器遍历按钮
- **THEN** SVG 带 `aria-hidden="true"` 与 `focusable="false"`，不被单独播报
- **AND** 状态语义仍由按钮的 `aria-pressed` 与 `aria-label` 承担

## ADDED Requirements

### Requirement: 折叠按钮必须在常态下具备可发现性

按钮 MUST 在**未悬停、未聚焦**的常态下就与 TabBar 背景产生可辨差异，MUST NOT 只有 hover 时才显现。
判据分三层（**取实测值，不得用估算**）：

**① 图形对比度（主判据）**：图标颜色 MUST 使用 `--color-text-primary`
（亮 `#1e1b4b` / 暗 `#e8e8ed`），对按钮底色实测对比度 MUST ≥ 4.5:1。
现状 `--color-text-secondary`（亮 `#707080` / 暗 `#b4b2c6`）对 TabBar 背景实测为
亮色 **4.40:1**（不达标）、暗色 **7.79:1**（达标）——即现状的问题**仅在亮色主题不达标**，
本判据要求两态都换到 primary，取得亮色 **15.99:1** / 暗色 **12.80:1**。

**② 视觉权重**：按钮尺寸 MUST 由 30×28px 提升到 **32×28px**，图标由 16px 提升到 **18px**。
按钮 MUST 保持 `margin: 4px 2px 0 var(--spacing-2)`，36px 行高 MUST 不变。

**③ 边界与悬浮反馈**：按钮 MUST 带 `1px solid` 边框与非常态底色，但**判据不要求边框自身达到 3:1**——
实测 `--color-border`（`#efefef`）对 TabBar 背景（`#f4f2ff`）仅 **1.04:1**，
`--color-bg-card`（`#ffffff`）对同一背景仅 **1.11:1**。TabBar 背景本身极亮（`#f4f2ff`→`#faf6f8`），
任何「更亮」的底色都无法产生对比，靠边框拉满 3:1 会把按钮做得过重、破坏 TabBar 的轻盈语言。
因此边界的定位是**辅助暗示**而非主判据：边框 MUST 使用带品牌色倾向的半透明描边
（`rgba(<brand>, .22)` 量级）使边界可辨，hover 时 MUST 加深底色（复用 `--color-sidebar-hover-bg`）
并切换图标色到 `--color-primary`，focus-visible MUST 保留 2px 品牌色焦点环。

#### Scenario: 常态即可辨认（不依赖 hover）

- **WHEN** 页面静止、鼠标不在按钮上
- **THEN** 按钮图标对底色的对比度亮色 ≥ 4.5:1、暗色 ≥ 4.5:1（实测应分别约 16:1 / 13:1）
- **AND** 按钮因 1px 品牌倾向描边与底色而具备可辨边界
- **AND** 无需 hover 即可定位到该控件

#### Scenario: hover 与键盘聚焦反馈仍可用

- **WHEN** 鼠标悬停，或用 Tab 聚焦按钮
- **THEN** hover 时底色加深且图标转为 `--color-primary`
- **AND** focus-visible 时显示 2px `--color-primary` 焦点环（`outline-offset: 1px`）
- **AND** `prefers-reduced-motion: reduce` 下不播放过渡

### Requirement: 收起态必须提供醒目的恢复入口标识

侧栏收起后，按钮是用户**唯一**的恢复入口。收起态 MUST 在按钮上增加一条 **2px 品牌色竖条**
（`--color-primary`，亮 `#5048E5` / 暗 `#8b85ff`），位置 MUST 贴按钮左缘、纵向留 4px 内缩，
MUST 用 `position: absolute` 实现（MUST NOT 占用布局空间、MUST NOT 影响 32×28 的命中区）。
竖条对按钮底色的实测对比度 MUST ≥ 3:1（实测亮 **6.18:1** / 暗 **5.13:1**，均达标）。

为什么单独要求：侧栏消失后按钮落在窗口最左侧，位置本身失去了「这是个按钮」的语境线索；
仅靠颜色从 primary 变 secondary（原实现）在视觉上几乎不可察觉。一条垂直品牌色锚点
能在余光里形成「这里有东西」的强提示，且不增加任何布局占用。

#### Scenario: 收起态肉眼可定位恢复入口

- **WHEN** 侧栏处于收起态
- **THEN** 按钮左缘出现 2px 品牌色竖条，且面板图标为虚线
- **AND** `aria-pressed="true"`、`aria-label`/`title` 为「展开左侧菜单」
- **AND** 按钮命中区仍为 32×28，未被竖条挤压

#### Scenario: 展开态不得残留指示条

- **WHEN** 侧栏为展开态
- **THEN** 不渲染该竖条（伪元素 `content: none` 或不挂载）
- **AND** 按钮视觉与「常态可发现性」判据一致
