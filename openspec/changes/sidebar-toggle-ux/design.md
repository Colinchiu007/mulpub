# 设计：折叠按钮可发现性（sidebar-toggle-ux）

## 一、图标几何

16×16 viewBox 改为 18×18（视觉尺寸 18px），两态共用同一套坐标骨架，只换图形：

```
expanded（面板实心，箭头朝左）        collapsed（面板虚线，箭头朝右）
┌─────────────────┐                  ┌─────────────────┐
│  ┌──┐           │                  │  ┌ ─┐           │
│  │██│  ◀──      │                  │  │  │  ──▶      │
│  │██│           │                  │  └ ─┘           │
│  └──┘           │                  │                 │
└─────────────────┘                  └─────────────────┘
```

- **面板**：左缘 2..6、上 3、下 13 的竖矩形（宽 5）。
  - expanded：`<rect>` 实心 `currentColor`，`rx=1`
  - collapsed：同形状 `<rect>` 但 `fill=none` + `stroke=currentColor` + `stroke-dasharray="1.6 1.4"`
- **箭头**：面板右侧的 chevron，展开态朝左（`M13 6.5 L9.8 9 L13 11.5`），收起态朝右（`M9.8 6.5 L13 9 L9.8 11.5`）。

**为什么面板用「实心 vs 虚线」而不是「显示 vs 隐藏」**：虚线仍占位，两种状态**外围轮廓完全一致**，
用户感知到的是「同一个按钮换了内部填充」，而不是「按钮换了个位置或换了个东西」——
后者会引发「我是不是点错了」的疑虑。

**为什么用 `<rect>` + `<path>` 而非单一 path**：虚线需要 `stroke-dasharray`，实心需要 `fill`，
两者在同一条 path 上要靠 `fill-rule` 之类的技巧，可读性差且不好测。分开更清晰。
（⚠ 需确认项目 lint 是否允许 SVG `<rect>`；不允许则退化为 `fill-rule="evenodd"` 的单 path 方案。）

## 二、样式层次

```css
.sidebar-toggle {
  /* 尺寸：30×28 → 32×28，为 18px 图标留出 7px 内边距；margin 不变（不动 36px 行高） */
  width: 32px;
  height: 28px;
  margin: 4px 2px 0 var(--spacing-2);

  /* 边界：品牌色倾向的半透明描边（--color-border 实测 1.04:1，等于没有，故不采用） */
  border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
  border-radius: var(--radius-sm);
  background: var(--color-bg-card);

  /* 图形对比度主判据：亮 15.99:1 / 暗 12.80:1 */
  color: var(--color-text-primary);
}

.sidebar-toggle:hover {
  background: var(--color-sidebar-hover-bg);   /* 与 TabBar 内既有元素同语言 */
  border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
  color: var(--color-primary);
}

.sidebar-toggle:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

/* 收起态：唯一恢复入口，加品牌色锚点 */
.sidebar-toggle.is-collapsed {
  color: var(--color-primary);
}
.sidebar-toggle.is-collapsed::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 1px;
  background: var(--color-primary);   /* 实测 6.18:1 / 5.13:1 */
}
```

`position: relative` 需加在 `.sidebar-toggle` 上（`::before` 定位基准）。

### 关于 `color-mix`

Electron 43 = Chromium 130+，`color-mix()` 自 Chromium 111 起支持，可用。
**回退策略**：若构建目标或测试环境的 jsdom 不解析 `color-mix`，样式断言只检查
「border-color 不是 transparent 且不是 `--color-border` 的展开值」，不硬编码颜色字面量——
避免测试被实现细节绑死。

## 三、被否决的备选方案（记录理由，避免下一轮重提）

| 备选 | 否决理由 |
|---|---|
| 用 `--color-border` 做常态边框 | 实测对 TabBar 背景 **1.04:1**，等于不存在。这正是现状「看不见」的技术原因 |
| 把边框做到 3:1（约 `#8a8a99`） | 视觉过重，会让 28px 高的按钮在 36px TabBar 里变成一块「补丁」，破坏既有轻盈语言 |
| 按钮常态给深色底（`--color-primary` 浅色） | 同上，且与 TabBar 内其它元素（透明/半透明白）语言冲突 |
| 给侧栏收起加动画过渡 | 原规格 `sidebar-collapse-toggle` 明确 MUST NOT 引入收起/展开过渡；本变更不改该契约 |
| 把按钮移出 TabBar 换位置 | 原规格要求位置固定于 TabBar 最左侧、不随标签滚动；改变位置是另一个 change |

## 四、测试策略（TDD）

**先写失败测试**，三层：

1. **图形层**（`SidebarToggleIcon.test.js`，新增）
   - 两态渲染出的 SVG `path`/`rect` 集合不相等（防「同图形换色」退化）
   - `collapsed` 默认 `false` ⇒ 渲染展开态
   - `aria-hidden="true"` + `focusable="false"`
2. **组件层**（`SidebarToggleButton.test.js`，增补）
   - `collapsed` prop 透传给图标
   - 常态：`border-color` 非 `transparent`、`background` 非 `transparent`、`color` = `--color-text-primary`
   - 收起态：挂 `is-collapsed`、`::before` 存在且 `width` 为 2px（通过 class 断言，不测伪元素计算值——jsdom 不支持）
   - `aria-pressed` / `aria-label` / `title` 语义**不得回退**（已有用例保留）
3. **视觉层**（基线重建）
   - 重建后 43 张基线全部通过
   - 明暗两主题各出一组「改前/改后」局部裁图，附在 PR 描述

**jsdom 的已知边界**：`::before` 伪元素、`color-mix()` 计算值、真实层叠后的颜色都取不到。
所以样式判据只能断言「声明了」（通过读 `style` 或 class 快照），**真实观感必须靠视觉基线**。
这条要写进执行记录，不能假装单测覆盖了视觉。

## 五、风险

| 风险 | 缓解 |
|---|---|
| 43 张基线全变，review 盲签 | 单独 PR + PR 描述附裁图对比 + 明暗双主题 |
| `color-mix` 在 jsdom 报错 | 测试不断言颜色字面量；必要时改用 `rgba()` 写死并在 tokens.css 加注释说明来源 |
| 32px 宽挤压 TabBar 首个标签 | 按钮 margin 不变，总占用 +2px；.tab-bar-tabs 本身可横向滚动，无固定宽度契约 |
| 18px 图标在 28px 高按钮里偏满 | 高度方向留 5px/边，视觉可接受；基线截图验证后再定 |
