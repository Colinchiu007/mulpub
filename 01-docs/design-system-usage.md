# Multi-Publish 设计系统组件使用指南

> **版本**: v1.0 | **最后更新**: 2026-07-07
> **配套文档**: `DESIGN.md`（色彩/字体/间距完整规范）

---

## 一、组件概览

| 组件 | Props | Emits | Slots | 测试 | 状态 |
|------|-------|-------|-------|------|------|
| **UiButton** | variant, size, disabled, tag | click | default | ✅ | 稳定 |
| **UiBadge** | (无) | — | default | ✅ | 稳定 |
| **UiCard** | (无) | — | default, header, footer | ✅ | 稳定 |
| **UiInput** | modelValue, placeholder, type, disabled, readonly | update:modelValue | — | ✅ | 稳定 |
| **UiModal** | modelValue | update:modelValue | default, title | ✅ | 稳定 |
| **UiSelect** | modelValue, options, placeholder, disabled | update:modelValue | — | ✅ | 稳定 |

---

## 二、组件 API 规范

### 2.1 命名约定

- **Props**: camelCase（`modelValue`, `placeholder`）
- **Emits**: kebab-case 事件（`click`, `update:modelValue`）
- **Slots**: kebab-case（`header`, `footer`）
- **CSS class**: `ui-{name}` 前缀（`ui-btn`, `ui-card`）
- **CSS 变量**: `--{name}`（`--primary`, `--shadow-lg`）

### 2.2 通用 Props

所有表单类组件（UiInput, UiSelect）应支持：
- `modelValue` — v-model 绑定值
- `disabled` — 禁用状态
- 通过 `update:modelValue` emit 实现双向绑定

### 2.3 通用行为

- 禁用状态：添加 `disabled` class + `opacity: 0.5; cursor: not-allowed`
- 聚焦状态：`outline` + `box-shadow` 统一使用 `--primary` 色
- 过渡动画：统一 `transition: all 150ms ease-out`

---

## 三、组件详解

### 3.1 UiButton

```vue
<UiButton variant="primary" size="md" @click="handleClick">发布</UiButton>
<UiButton variant="secondary" size="sm">取消</UiButton>
<UiButton variant="ghost" size="lg">更多</UiButton>
<UiButton variant="danger">删除</UiButton>
<UiButton :disabled="true">不可用</UiButton>
```

| Prop | 类型 | 默认值 | 可选值 |
|------|------|--------|--------|
| variant | String | "primary" | primary, secondary, ghost, danger |
| size | String | "md" | sm, md, lg |
| disabled | Boolean | false | — |
| tag | String | "button" | button, a, span |

### 3.2 UiInput

```vue
<UiInput v-model="text" placeholder="输入标题" />
<UiInput v-model="email" type="email" :disabled="sending" />
```

| Prop | 类型 | 默认值 |
|------|------|--------|
| modelValue | String/Number | — |
| placeholder | String | "" |
| type | String | "text" |
| disabled | Boolean | false |
| readonly | Boolean | false |

### 3.3 UiSelect

```vue
<UiSelect v-model="platform" :options="platforms" placeholder="选择平台" />
```

| Prop | 类型 | 默认值 |
|------|------|--------|
| modelValue | String | — |
| options | Array | [] |
| placeholder | String | "请选择" |
| disabled | Boolean | false |

### 3.4 UiModal

```vue
<UiModal v-model="show">
  <template #title>确认发布</template>
  <p>确定要将内容发布到上述平台？</p>
</UiModal>
```

| Prop | 类型 | 默认值 |
|------|------|--------|
| modelValue | Boolean | false |

### 3.5 UiBadge

```vue
<UiBadge>新功能</UiBadge>
```

纯展示组件，嵌套在 UiCard 中使用。

### 3.6 UiCard

```vue
<UiCard>
  <template #header>数据概览</template>
  <p>卡片内容...</p>
  <template #footer><UiButton>查看详情</UiButton></template>
</UiCard>
```

---

## 四、CSS 变量参考

> ⚠️ 下面这份清单是 **2026-06 的旧版 cohere 系**（`--primary: #7c5cbf` 等），
> 与当前 `apps/desktop/src/styles/tokens.css` 的权威取值**已经不一致**。
> 2026-10-20 视觉系统升级后，**唯一真源是 `tokens.css` + `cohere-design-system.css` + `premium-design-system.css`**。
> 本仓实际使用的口径见下方「四之二」。

```css
/* 颜色（旧版，已停用 —— 仅供历史文档对照） */
--primary: #7c5cbf;        /* 浅薰衣草紫 */
--primary-hover: #6a4dab;
--primary-light: #f0ebff;
--secondary: #f472b6;      /* 粉色点缀 */
--text: #1e1b4b;
--text-muted: #7c7c9a;
--border: #e0d8f0;
--border-light: #f0ebff;
--success: #34d399;
--warning: #fbbf24;
--error: #f87171;
--bg: #f8f4ff;
--surface: #ffffff;

/* 圆角（旧版，已停用） */
--r-sm: 6px;
--r-md: 10px;
--r-lg: 16px;

/* 阴影（旧版，已停用） */
--shadow-sm: 0 1px 3px rgba(124, 92, 191, 0.08);
--shadow-md: 0 4px 12px rgba(124, 92, 191, 0.12);
--shadow-lg: 0 8px 30px rgba(124, 92, 191, 0.16);
```

---

## 四之二、当前权威口径（2026-10-20 视觉系统升级后）

> 真源文件：
> - `apps/desktop/src/styles/tokens.css` —— **唯一令牌源**（含亮/暗两套）
> - `apps/desktop/src/styles/cohere-design-system.css` —— **类名契约**（有哪些类、语义是什么）
> - `apps/desktop/src/styles/premium-design-system.css` —— **观感契约**（这些类看起来应该怎样）
>
> 完整说明见 [UI 视觉巡检与高级感升级方案](./UI-VISUAL-AUDIT-2026-10-20.md) 与
> [PRD：桌面端视觉系统升级](./PRD-UI-VISUAL-SYSTEM-2026-10-20.md)。

### 4.1 表面阶梯（必须分层用，不得混用）

```css
--surface-canvas:   #f5f4fa;   /* L0 页面底（过渡色） */
--surface-raised:   #ffffff;   /* L1 卡片 / 面板 */
--surface-sunken:   #f1f0f8;   /* L2 空态 / 内嵌 / 分段控件底 */
--glass-bg:         rgba(255,255,255,.72);  /* L3 顶栏 / 侧栏 */
--surface-scrim:    rgba(24,22,48,.32);      /* L4 模态遮罩 */
```

### 4.2 描边与高度

```css
--hairline-soft:   rgba(30,27,75,.05);   /* 区块分隔 */
--hairline:        rgba(30,27,75,.09);   /* 卡片外框 */
--hairline-strong: rgba(30,27,75,.14);   /* 输入框 / 次级按钮 */

--elevation-1: 0 1px 2px rgba(30,27,75,.04), 0 1px 3px rgba(30,27,75,.05);
--elevation-2: 0 2px 6px rgba(30,27,75,.05), 0 8px 20px -8px rgba(30,27,75,.10);
--elevation-3: 0 4px 10px rgba(30,27,75,.06), 0 16px 32px -12px rgba(30,27,75,.14);
--elevation-4: 0 8px 20px rgba(30,27,75,.08), 0 32px 64px -20px rgba(30,27,75,.20);
```

> 阴影统一用**品牌紫调**而非中性黑 —— 中性黑投影会让白底界面显"发灰"。

### 4.3 品牌渐变与毛玻璃

```css
--brand-gradient:       linear-gradient(135deg, #5B5EE8 0%, #8B3FD9 100%);
--brand-gradient-hover: linear-gradient(135deg, #4F52DE 0%, #7C35CE 100%);
--brand-gradient-soft:  linear-gradient(135deg, rgba(91,94,232,.10), rgba(139,63,217,.10));
--brand-glow:           0 6px 16px -4px rgba(91,86,216,.38);
--brand-ring:           0 0 0 3px rgba(91,94,232,.16);   /* 聚焦柔光环 */

--glass-blur: saturate(180%) blur(20px);
--glass-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 8px 24px -12px rgba(30,27,75,.16);
```

> ⚠️ **对比度硬约束**：白字压在 `--brand-gradient` 上，两端对比度须 ≥ 4.5:1
> （实测 `#5B5EE8` 端 4.91:1、`#8B3FD9` 端 5.51:1）。
> 调亮渐变亮端（如提到 `#A855F7`）会跌到 3.96:1，**不合格**。

### 4.4 圆角（收敛为 6 档）

```css
--r-xs: 4px;     /* 标签内嵌 */
--r-sm: 8px;     /* 图标底座、小按钮 */
--r-md: 12px;    /* 输入框、次级按钮 */
--r-lg: 16px;    /* 卡片 / 面板 / 统计卡（主力档） */
--r-xl: 20px;    /* 弹窗 */
--r-pill: 32px;  /* 主按钮、胶囊页签 */
```

> **档外圆角一律判不合格**：写死 3/5/6/7/10/14/15px 会在同屏内产生"外圆内方"错位。

### 4.5 字体栈（收敛为 2 套）

```css
--font-family-ui:         'SF Pro Text','Inter','PingFang SC','Microsoft YaHei',ui-sans-serif,system-ui,sans-serif;
--font-family-ui-display: 'SF Pro Display','Inter','PingFang SC','Microsoft YaHei',ui-sans-serif,system-ui,sans-serif;
```

- 正文用 `--font-family-ui`；标题与统计数字用 `--font-family-ui-display`。
- 数字类内容必须加 `font-variant-numeric: tabular-nums`（多卡数字小数点对齐）。
- 字号只用 `--font-size-xs/sm/base/md/lg/xl/xxl`（12/13/15/17/20/24/32px）。
- **正文不得小于 12px**；**不得出现小数像素字号**（`19.5px` 一类会在缩放下产生半像素模糊）。

### 4.6 动效

```css
--motion-fast: 140ms;  --motion-base: 200ms;  --motion-slow: 320ms;
--ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);
```

> **禁止 `transition: all`** —— 会把 `width/height/margin` 纳入插值，造成不可控重排。
> 一律按属性列举（`background-color / border-color / color / box-shadow / transform`）。

---

## 五、组件开发规范

### 5.1 新增组件检查清单

- [ ] 使用 `<script setup>` Composition API
- [ ] Props 使用 `defineProps` + 默认值
- [ ] Emits 使用 `defineEmits`
- [ ] CSS class 前缀 `ui-{name}`
- [ ] 样式使用 scoped
- [ ] 引用 CSS 变量而非硬编码颜色
- [ ] 支持 v-model（表单类组件）
- [ ] 有对应的 `.test.js` 测试文件
- [ ] 至少覆盖：渲染、Props、Emits 三类测试

### 5.2 组件目录

```
src/components/
  Ui{Name}.vue       # 组件
  Ui{Name}.test.js   # 单元测试
```

### 5.3 测试模式

```js
import { mount } from "@vue/test-utils";
import UiButton from "./UiButton.vue";

it("renders with variant", () => {
  const w = mount(UiButton, { props: { variant: "danger" } });
  expect(w.classes()).toContain("ui-btn-danger");
});

it("emits click on click", async () => {
  const w = mount(UiButton);
  await w.trigger("click");
  expect(w.emitted("click")).toBeTruthy();
});
```

---

*本指南基于 `apps/desktop/src/components/Ui*` 组件族生成。*
