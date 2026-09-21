# 渲染隐形缺陷防线：CI Gate 15b 与像素基线内容守卫

> 2026-09-21 · PR #2121 · 事故原型：PR #2075 数据看板「奶油·薰衣草」重构 → PR #2114 修复

## 背景：两类"渲染隐形"缺陷逃过了全部现有测试

PR #2075 引入的两处缺陷都让页面在真实用户眼里坏掉，但单元测试、headless 截图、像素回归全部绿灯：

1. **scoped 裸 `:root` 静默失效**：Vue scoped 样式块中写 `:root {}` 会被编译为
   `:root[data-v-xxx]`，而 `data-v` 属性只挂在组件内部元素上，html 根元素永远不带
   → 块内 CSS 自定义属性（token）全部未定义 → 引用它们的 `linear-gradient` 整条作废
   → 看板 hero 卡片白字白底完全隐形。
2. **动画驱动可见性污染像素基线**：视觉 runner 注入 `animation: 0s !important`
   简写会连带重置 `animation-name: none`，凡"基础 `opacity: 0` + 靠动画变可见"的
   元素在测试环境永久隐形 → 用它生成的像素基线是空白页（当时 dashboard.png 仅 48KB）
   → 之后所有像素对比恒等于自洽，视觉回归形同虚设
   （`prefers-reduced-motion` 的真实用户同样受害）。

## 防线一：Gate 15b — scoped 裸根选择器静态门禁

- 脚本：`.github/scripts/check-scoped-root.js`（自测 `check-scoped-root.test.js`）
- 范围：`apps/desktop/src` 与 `ops-center/frontend/src` 全部 `.vue` 的 **scoped** 样式块
- 规则：用 `@vue/compiler-sfc` + `postcss` 解析，剥掉 `:global(...)` 包装后仍含
  `:root` / 裸 `html` / `body` 根选择器即 FAIL
- 正确写法：scoped 块中声明全局 token 用 `:global(:root) {}`，或把 token 移到全局样式
- 本地同口径：`node .github/scripts/check-scoped-root.js`

## 防线二：像素基线入库内容下限守卫

- 模块：`apps/desktop/tests/visual-testing/providers/baseline-content-guard.js`
- 接线：`PixelDiffProvider.updateBaseline` 在 `UPDATE_BASELINE` 落盘前校验
- 规则（拦截"明显未渲染"的截图）：
  | 指标 | 下限 | 含义 |
  |------|------|------|
  | 尺寸 | ≥ 1280×720 | 视口截图异常过小 = 渲染故障 |
  | 单一颜色占比 | < 99.5% | 整页近纯色疑似空白 |
  | 折叠线（25% 高度）以下着墨率 | ≥ 0.3% | 内容区未渲染 |
- 逃生门：确属空页（如登录门控页）经人工审核后可用 `BASELINE_ALLOW_EMPTY=1` 显式放行
- **守卫拦不住"语义空白"**：新基线入库前仍必须人工目检内容（见 learnings:
  `visual-runner-animation-disable-blank-baseline`）
- 已知存量空白基线：`analytics-overview.png`（1920×1080 纯白，与上述事故同源），
  已登记于 `pixel-diff-baseline-guard.test.js` 的 `KNOWN_EMPTY_BASELINES`，待重建后移除

## 防线三：Dashboard 样式源码守卫（专项回归保护）

`apps/desktop/src/views/Dashboard.style-guard.test.js` 在 SFC 源码层锁定四条不变量
（token 必须在 `:global(:root)`、禁裸 `:root`、禁"基础 opacity:0 + animation"同体、
hero 背景必须引用 `var(--deep-purple)` 渐变），使 PR #2075 的两类缺陷模式在看板页
再次出现时单测直接变红。

## 组件样式编写约定（由此沉淀）

1. 元素的**基态必须可见**；入场淡入一律交给 `@keyframes` 的 `from { opacity: 0 }`，
   禁止把 `opacity: 0` 写在元素基础样式上再靠动画救活。
2. scoped 样式块中需要全局选择器（`:root` / `html` / `body`）时一律包 `:global()`。
3. 更新像素基线必须 `cd` 进目标 worktree 的 `apps/desktop` 运行（baselineDir 按
   `process.cwd()` 解析），生成后目检内容再入库。
