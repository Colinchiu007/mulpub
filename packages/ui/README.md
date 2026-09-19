# @multi-publish/ui

Multi-Publish Electron 桌面应用的 UI 组件库。基于 Design Tokens 构建，提供一致、可复用的 UI 组件。

## 📦 安装

```bash
pnpm add @multi-publish/ui
```

## 🎨 Design Tokens

本组件库使用 Design Tokens 系统确保视觉一致性。所有颜色、间距、字体等都通过 CSS 变量定义。

### 引入 CSS 变量

```html
<!-- index.html -->
<link rel="stylesheet" href="/packages/ui-design-tokens/src/tokens.css">
```

### 暗黑模式支持

自动检测系统偏好：

```css
@media (prefers-color-scheme: dark) {
  :root {
    /* 暗黑主题变量 */
  }
}
```

手动切换：

```javascript
document.documentElement.classList.add('dark') // 开启暗黑模式
document.documentElement.classList.remove('dark') // 关闭暗黑模式
```

## 🧩 组件列表

### Button - 按钮

**Props:**
- `variant`: `'primary' | 'secondary' | 'danger' | 'text'` (默认：`'primary'`)
- `size`: `'small' | 'medium' | 'large'` (默认：`'medium'`)
- `loading`: boolean (默认：`false`)
- `disabled`: boolean (默认：`false`)
- `icon`: string (默认：`''`)
- `block`: boolean (默认：`false`)

**示例:**

```vue
<template>
  <MpButton variant="primary" size="medium">主要按钮</MpButton>
  <MpButton variant="danger" loading>危险操作</MpButton>
  <MpButton icon="📁" block>全宽按钮</MpButton>
</template>
```

### Input - 输入框

**Props:**
- `modelValue`: string | number (默认：`''`)
- `type`: `'text' | 'password' | 'email' | 'number'` (默认：`'text'`)
- `placeholder`: string (默认：`''`)
- `size`: `'small' | 'medium' | 'large'` (默认：`'medium'`)
- `disabled`: boolean (默认：`false`)
- `error`: boolean (默认：`false`)
- `success`: boolean (默认：`false`)
- `prefix`: string (默认：`''`)
- `suffix`: string (默认：`''`)
- `minLength`: number
- `maxLength`: number
- `pattern`: string
- `required`: boolean (默认：`false`)

**示例:**

```vue
<template>
  <MpInput v-model="username" placeholder="请输入用户名" prefix="@"/>
  <MpInput v-model="email" type="email" error placeholder="请输入邮箱"/>
</template>
```

### Card - 卡片

**Props:**
- `title`: string (默认：`''`)
- `subtitle`: string (默认：`''`)
- `footer`: string (默认：`''`)
- `variant`: `'elevated' | 'outlined' | 'filled'` (默认：`'elevated'`)
- `size`: `'small' | 'medium' | 'large'` (默认：`'medium'`)
- `hoverable`: boolean (默认：`false`)
- `shadow`: boolean (默认：`true`)

**示例:**

```vue
<template>
  <MpCard title="卡片标题" subtitle="副标题">
    <p>卡片内容...</p>
  </MpCard>
</template>
```

### Modal - 弹窗

**Props:**
- `modelValue`: boolean (默认：`false`)
- `title`: string (默认：`'提示'`)
- `confirmText`: string (默认：`'确定'`)
- `cancelText`: string (默认：`'取消'`)
- `confirmType`: `'primary' | 'danger' | 'text'` (默认：`'primary'`)
- `showCancel`: boolean (默认：`true`)
- `draggable`: boolean (默认：`false`)
- `closeOnBackdrop`: boolean (默认：`true`)

**Events:**
- `@update:modelValue`
- `@confirm`
- `@cancel`
- `@open`
- `@close`

**示例:**

```vue
<template>
  <MpModal v-model="showModal" title="确认删除">
    <p>确定要删除这个项目吗？</p>
  </MpModal>
  
  <MpButton @click="showModal = true">打开弹窗</MpButton>
</template>
```

### Navigation - 导航栏

**Props:**
- `mode`: `'sidebar' | 'topbar'` (默认：`'sidebar'`)
- `collapsed`: boolean (默认：`false`)
- `activeItem`: string (默认：`''`)

**Events:**
- `@item-click`

**示例:**

```vue
<template>
  <MpNavigation mode="sidebar" active-item="dashboard"/>
</template>
```

## 🔒 安全工具函数

### sanitizeHtml

HTML 清洗，防止 XSS 攻击。

```typescript
import { sanitizeHtml } from '@multi-publish/ui'

const safeHtml = sanitizeHtml('<script>alert("xss")</script>')
// 输出：""
```

### escapeHtml

转义 HTML 特殊字符。

```typescript
import { escapeHtml } from '@multi-publish/ui'

const escaped = escapeHtml('<div>Hello & World</div>')
// 输出："&lt;div&gt;Hello &amp; World&lt;/div&gt;"
```

### containsDangerousContent

检测危险内容。

```typescript
import { containsDangerousContent } from '@multi-publish/ui'

containsDangerousContent('<script>alert(1)</script>') 
// 输出：true
```

## 📊 代码质量

- ✅ TypeScript 严格模式
- ✅ ESLint 检查
- ✅ 单元测试覆盖率 ≥80%
- ✅ Storybook 文档

## 🚀 开发指南

### 本地开发

```bash
# 安装依赖
pnpm install

# 运行 Storybook
pnpm storybook

# 运行测试
pnpm test
```

### 构建

```bash
pnpm build
```

## 📝 License

MIT
