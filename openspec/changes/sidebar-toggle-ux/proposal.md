# 侧栏折叠按钮可发现性优化（sidebar-toggle-ux）

## 为什么做

用户原话：**「现在显示的按钮样式太不明显，根本让人注意不到。从用户体验上考虑，按钮的样式需要体现出它的功能性。」**

`sidebar-collapse-toggle`（PR #3916）交付了功能正确的折叠按钮，但**呈现层没有传达功能**。三条独立问题：

1. **图形不表意**：双向 `chevron`（「<>」）在通行图标语义里是「代码」或「展开更多」，与「收起侧栏」无关。
2. **两态共用同一图形**：收起/展开的差异只体现在颜色（primary vs secondary）上，是**单通道编码**，对色觉障碍用户无效；用户也无法从图标判断当前状态。
3. **常态几乎不可见**：实测图标色 `--color-text-secondary` 对 TabBar 背景亮色仅 **4.40:1**（差 0.1 不达 WCAG AA 4.5:1）；边框为 `transparent`、底色为 `transparent`，视觉上与纯背景同形，没有任何「这里有个控件」的暗示。

## 关键实测数据（推翻了三条初始假设）

初始诊断基于估算，落地前用 `contrast-calc` 精算后**修正了三处**：

| 初始假设 | 实测值 | 处理 |
|---|---|---|
| 现状对比度约 3:1 | 亮色 **4.40:1**、暗色 **7.79:1** | 问题比预估小；只有亮色不达标 |
| 用 `--color-border` 做常态边框 | `#efefef` vs TabBar `#f4f2ff` = **1.04:1** | **边框等于不存在**，原「层②」失效 |
| 用 `--color-bg-card` 做底色 | `#ffffff` vs 同背景 = **1.11:1** | 底色无区分度 |

**核心结论**：TabBar 背景本身极亮（`#f4f2ff`→`#faf6f8`），任何「更亮」的底色都产生不了对比；
靠边框拉满 3:1 会把按钮做得过重、破坏 TabBar 的既有轻盈语言。
⇒ **主判据改为「图形对比度 + 图形语义化」**，边框降级为辅助暗示。

## 改动范围

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/components/icons/SidebarToggleIcon.vue` | 重绘为「侧栏面板 + 方向箭头」；新增 `collapsed` prop |
| `apps/desktop/src/components/SidebarToggleButton.vue` | 透传 `collapsed` 给图标；常态描边/底色；图标色 `text-primary`；尺寸 30×28 → 32×28；收起态 2px 品牌色竖条 |
| `apps/desktop/src/components/icons/SidebarToggleIcon.test.js` | 新增（两态图形不同、aria-hidden） |
| `apps/desktop/src/components/SidebarToggleButton.test.js` | 增补（prop 透传、常态样式断言、收起态竖条） |
| `apps/desktop/tests/visual-testing/base-screenshots/*.png` | **重建**（所有含 TabBar 的基线） |
| `openspec/changes/sidebar-toggle-ux/**` | 本 change |
| `openspec/records/sidebar-toggle-ux.md` | 执行记录 |
| `CHANGELOG.md` | 收口 |

**不改**：任何主进程代码、布局契约（`TabBar(36) + NavBar(40) = 76`）、`aria-pressed`/`aria-label` 语义、locale 文件、折叠状态机与持久化。

## 为什么不混在 #3916 里做

视觉基线会大面积变更（43 张基线里绝大多数含 TabBar）。
把它与「行为修复」混在同一个 PR，CI 上的基线 diff 就无法与行为变更的因果分离——
评审者要么盲签基线，要么无法判断行为是否真的没变。**单独 PR 让「只改外观、不改行为」成为可验证的命题**。

## 验收

见 `specs/sidebar-toggle-ux/spec.md` 的 7 个 Scenario：
两态图形不同 / 图标不参与读屏 / 常态即可辨认 / hover 与聚焦反馈 / 收起态恢复入口可定位 / 展开态不残留指示条 / （原规格 8 条 Requirement 全部保持）。
