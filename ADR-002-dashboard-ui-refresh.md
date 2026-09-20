# ADR-002: 数据看板 UI 重构 - 奶油·薰衣草设计方向

## 状态
已接受 (Accepted)

## 日期
2026-09-20

## 背景
当前数据看板 UI 存在以下问题：
1. **AI Slop 检测失败**：过度使用 emoji 图标、均匀卡片网格、单调紫色强调色
2. **视觉层级混乱**：4 个统计卡片完全平等，无主次区分
3. **认知负荷过高**：信息分组不合理，缺少数据可视化
4. **情感旅程缺失**：冷冰冰的数字展示，无情感连接
5. **设计细节粗糙**：内联样式过多，圆角/间距不统一

## 决策
采用"奶油·薰衣草"设计方向，核心变更：

### 色彩系统
```css
--lavender-primary: #7c5cbf;      /* 主品牌色 */
--lavender-light: #f8f4ff;        /* 浅色背景 */
--lavender-accent: #f472b6;       /* 粉色强调 */
--deep-purple: #1e1b4b;           /* 深色文字 */
```

### 布局结构
- **不规则卡片网格**：大卡片占 2 列 +3 小卡片
- **渐变背景**：`linear-gradient(135deg, var(--deep-purple), #4a3f8f)`
- **动画系统**：所有动画使用 `cubic-bezier(0.33, 1, 0.68, 1)` 缓动

### 交互增强
- Hover 效果：阴影加深 + translateY(-4px)
- 加载动画：staggered fadeInUp (0.2s delay 递增)
- 趋势图表：hover 显示数值 tooltip
- 进度条：fillProgress 动画

## 影响
- ✅ 提升视觉精致度
- ✅ 改善用户体验
- ✅ 保持向后兼容（保留 fallback 值）
- ⚠️ 需要测试响应式布局

## 验证
- [x] 高保真原型创建 (`01-docs/prototypes/dashboard-ui-refresh/dashboard-prototype.html`)
- [x] Vue 组件代码实现 (正式实现：`apps/desktop/src/views/Dashboard.vue`；原型快照：`01-docs/prototypes/dashboard-ui-refresh/Dashboard.vue.sample`)
- [ ] 本地应用手动验证
- [ ] E2E 测试通过
- [ ] 视觉回归测试
