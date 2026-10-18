---
version: alpha
name: Cohere-design-analysis
description: Cohere's 2026 web system is a controlled enterprise AI interface built from stark white editorial space, deep green-black product bands, soft mineral surfaces, rounded media cards, and a distinctive type split between monospaced-feeling display headlines and precise Unica77 UI text.

colors:
  primary: "#17171c"
  cohere-black: "#000000"
  ink: "#212121"
  deep-green: "#003c33"
  dark-navy: "#071829"
  canvas: "#ffffff"
  soft-stone: "#eeece7"
  pale-green: "#edfce9"
  pale-blue: "#f1f5ff"
  hairline: "#d9d9dd"
  border-light: "#e5e7eb"
  card-border: "#f2f2f2"
  muted: "#93939f"
  slate: "#75758a"
  body-muted: "#616161"
  action-blue: "#1863dc"
  focus-blue: "#4c6ee6"
  coral: "#ff7759"
  coral-soft: "#ffad9b"
  form-focus: "#9b60aa"
  on-primary: "#ffffff"
  on-dark: "#ffffff"
  error: "#b30000"

typography:
  hero-display:
    fontFamily: CohereText
    fontSize: 96px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -1.92px
  product-display:
    fontFamily: CohereText
    fontSize: 72px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -1.44px
  section-display:
    fontFamily: Unica77 Cohere Web
    fontSize: 60px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -1.2px
  section-heading:
    fontFamily: Unica77 Cohere Web
    fontSize: 48px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: -0.48px
  card-heading:
    fontFamily: Unica77 Cohere Web
    fontSize: 32px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: -0.32px
  feature-heading:
    fontFamily: Unica77 Cohere Web
    fontSize: 24px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 0
  body-large:
    fontFamily: Unica77 Cohere Web
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  body:
    fontFamily: Unica77 Cohere Web
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  button:
    fontFamily: Unica77 Cohere Web
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.71
    letterSpacing: 0
  caption:
    fontFamily: Unica77 Cohere Web
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  mono-label:
    fontFamily: CohereMono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.28px
  micro:
    fontFamily: Unica77 Cohere Web
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 22px
  xl: 30px
  pill: 32px
  full: 9999px

spacing:
  xxs: 2px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  section: 80px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 12px 24px
  button-secondary:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    padding: 8px 0
  button-pill-outline:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.xl}"
    padding: 6px 12px
  announcement-bar:
    backgroundColor: "{colors.cohere-black}"
    textColor: "{colors.on-dark}"
    typography: "{typography.micro}"
    height: 36px
  hero-photo-card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
  agent-console-card:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.sm}"
    padding: 24px
  trust-logo-strip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
  capability-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    padding: 24px
  dark-feature-band:
    backgroundColor: "{colors.deep-green}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.lg}"
    padding: 80px
  product-card:
    backgroundColor: "{colors.soft-stone}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: 32px
  blog-filter-chip:
    backgroundColor: transparent
    textColor: "{colors.coral}"
    typography: "{typography.card-heading}"
    rounded: "{rounded.sm}"
    padding: 8px 14px
  research-table:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-large}"
  contact-form-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 32px
  footer-newsletter:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-dark}"
    typography: "{typography.micro}"
---

## Overview

Cohere's current web presence feels like a sober enterprise AI command center with editorial restraint. The home page opens on a huge typographic declaration over a white canvas, then uses photography, dark product mockups, trust logos, and generous empty space to make AI infrastructure feel controlled rather than speculative. Product pages invert the tone into deep green-black or dark navy bands, while blog and research pages move toward publishing-system clarity: large filters, thin rules, dense lists, and pale technical backgrounds.

What makes the system distinctive is the mix of austere black-and-white UI with bursts of tactile brand imagery. The site avoids decorative chrome in the normal interface; color arrives through photography, abstract 3D media, coral blog taxonomy chips, blue research links, and dark product environments. Cards are rounded but not cute. Type is large, tight, and almost monospaced in spirit, creating a research-lab cadence across marketing, product, and editorial surfaces.

**Key Characteristics:**
- Monumental display headlines with very tight line height and negative tracking.
- White editorial canvases interrupted by deep green, dark navy, and image-led CTA bands.
- Rounded media cards and product cards, usually 8px to 22px.
- Pill CTAs in near-black or white, with most secondary actions rendered as underlined text links.
- Trust-logo strips with monochrome partner marks and very wide vertical spacing.
- Agent-console mockups using dark panels, small status chips, and product integration badges.
- Blog and research surfaces with prominent taxonomy chips, long rule-separated lists, and search fields.

## Colors

### Brand & Accent

- **Cohere Black** (`#000000`): Announcement bar, highest-contrast text, and the global brand anchor.
- **Near-Black Primary** (`#17171c`): Primary CTA buttons, dark footer, and deep UI cards.
- **Deep Enterprise Green** (`#003c33`): Product hero bands for North and Command-style dark sections.
- **Dark Navy** (`#071829`): Financial-services and security-oriented solution bands.
- **Action Blue** (`#1863dc`): Editorial links, pagination, and secondary action emphasis.
- **Coral** (`#ff7759`): Blog category chips, taxonomy outlines, and warm product markers.
- **Soft Coral** (`#ffad9b`): Pale chip borders and segmented article-label details.

### Surface & Background

- **Canvas White** (`#ffffff`): Dominant page background and form/card surface.
- **Soft Stone** (`#eeece7`): Product cards, testimonial placeholders, and warm neutral surface blocks.
- **Pale Green Wash** (`#edfce9`): North page section backdrop behind stacked dark capability panels.
- **Pale Blue Wash** (`#f1f5ff`): Blog CTA surface behind abstract 3D imagery.
- **Card Border** (`#f2f2f2`): Softest card containment line.

### Text & Rules

- **Ink** (`#212121`): Default body text and most link text on light backgrounds.
- **Muted Slate** (`#93939f`): Footer links, dates, metadata, and de-emphasized labels.
- **Slate** (`#75758a`): Research separators and tertiary text.
- **Hairline** (`#d9d9dd`): Standard list rules and section dividers.
- **Border Light** (`#e5e7eb`): Secondary divider and utility rule.

### Semantic

- **Focus Blue** (`#4c6ee6`): Keyboard focus and ring color.
- **Form Focus Violet** (`#9b60aa`): Focus border for text inputs.
- **Error Red** (`#b30000`): Extracted ring/shadow color associated with validation-like states.

### Gradient System

Cohere does not use gradients as a generic UI fill. Gradients and color fields are media-led: abstract 3D hero imagery, deep blue open-science particle fields, red-orange product video posters, and dark green-to-black product environments. Keep UI surfaces flat; reserve gradient richness for large media panels and CTA image bands.

## Typography

### Font Family

- **Display**: `CohereText`, falling back to `Space Grotesk`, `Inter`, `ui-sans-serif`, and `system-ui`.
- **Body/UI**: `Unica77 Cohere Web`, falling back to `Inter`, `Arial`, `ui-sans-serif`, and `system-ui`.
- **Technical labels**: `CohereMono`, falling back to `Arial`, `ui-sans-serif`, and `system-ui`.
- **Icons**: Cohere uses custom icon fonts and thin-line geometric illustrations.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|---|---|---:|---:|---:|---:|---|
| Hero Display | CohereText | 96px | 400 | 1.00 | -1.92px | Home page declaration scale. |
| Product Display | CohereText | 72px | 400 | 1.00 | -1.44px | Product and research hero headlines. |
| Section Display | Unica77 | 60px | 400 | 1.00 | -1.2px | Large product-page headings. |
| Section Heading | Unica77 | 48px | 400 | 1.20 | -0.48px | Split hero and CTA headings. |
| Card Heading | Unica77 | 32px | 400 | 1.20 | -0.32px | Feature card and list section titles. |
| Feature Heading | Unica77 | 24px | 400 | 1.30 | 0 | Cards, filters, and article titles. |
| Body Large | Unica77 | 18px | 400 | 1.40 | 0 | Lead text and larger paragraphs. |
| Body | Unica77 | 16px | 400 | 1.50 | 0 | Default copy and link text. |
| Button | Unica77 | 14px | 500 | 1.71 | 0 | Compact CTA labels. |
| Caption | Unica77 | 14px | 400 | 1.40 | 0 | Metadata and small explanatory text. |
| Mono Label | CohereMono | 14px | 400 | 1.40 | 0.28px | Uppercase technical labels. |
| Micro | Unica77 | 12px | 400 | 1.40 | 0 | Footer, nav microcopy, and small links. |

### Principles

- Use massive type sparingly; Cohere pages often have one oversized headline and then settle into restrained 16px-24px UI copy.
- Keep display type tight. Hero copy should feel compact and carved, not airy.
- Avoid heavy bold weights. Size, spacing, and surface contrast do most of the hierarchy work.
- Use uppercase mono labels for category and system markers, especially on product and research pages.
- Editorial pages can use coral chips and blue links, but the base typography remains black and measured.

## Layout

### Spacing System

The system uses an 8px base with many one-off alignment values: `2px`, `6px`, `8px`, `10px`, `12px`, `16px`, `20px`, `22px`, `24px`, `28px`, `32px`, `36px`, `40px`, `56px`, `60px`, `64px`, and `80px`.

Large sections rely on dramatic vertical breathing room. The home page places a trust-logo strip far below the hero media. Product pages often hold dark panels inside fields of empty white space, then transition to dense forms or footers only near the end.

### Grid & Container

- Global nav uses a three-zone layout: logo left, menu centered, sign-in/CTA right.
- Home hero is centered text above a two-card media composition: a wide product mockup card beside a narrower photography card.
- Feature sections commonly use 3-column cards on desktop.
- Product pages alternate centered hero blocks, trust-logo strips, large single-feature bands, and 2- or 3-column card grids.
- Research pages use full-width lists with date and chip columns instead of decorative cards.
- Forms use two-column input rows inside a rounded white card on dark or stone section backgrounds.

### Whitespace Philosophy

Cohere uses whitespace as a trust signal. Large empty intervals separate the brand claim, customer proof, product proof, and CTA. Dense content appears only where it serves the information architecture: research paper rows, blog card grids, and contact form fields.

## Elevation & Depth

Cohere is mostly flat. Depth comes from surface alternation, media contrast, rounded corners, and thin borders rather than drop shadows.

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, white or dark field | Hero copy, research lists, editorial surfaces |
| Bordered | 1px `#d9d9dd`, `#e5e7eb`, or dark translucent rules | Research rows, forms, pale cards, footer inputs |
| Media Lift | Rounded image or video over contrasting section color | Hero photo cards, product videos, CTA imagery |
| Dark Product Field | Deep green or navy full-width band | Command, North, financial services, security sections |

## Shapes

### Radius Scale

| Token | Value | Role |
|---|---:|---|
| `xs` | 4px | Small images, search fields, article thumbnails, utility elements |
| `sm` | 8px | Blog chips, cards, small media, dialogs |
| `md` | 16px | Medium product cards and grouped blocks |
| `lg` | 22px | Signature media-card and soft placeholder radius |
| `xl` | 30px | Research/topic filter pills |
| `pill` | 32px | Primary CTA buttons |
| `full` | 9999px | Round status elements and fully pill-shaped controls |

### Image Treatment

Images are not decorative backdrops for text except in CTA bands. Most imagery sits as rounded cards with visible corners: product videos, enterprise photography, article thumbnails, and abstract 3D renders. The dominant radii are 8px and 22px.

## Components

### **`button-primary`**

Near-black or white pill CTA, depending on surface contrast. Uses 14px-16px Unica77, 12px 24px padding, and a 32px pill radius. This is the primary action style for "Request a demo", "Submit", and hero CTAs.

### **`button-secondary`**

Text-only action link, usually underlined or rule-aligned, with no filled background. Used for "Explore products", "Try the Playground", newsletter signup, and secondary hero actions.

### **`button-pill-outline`**

Outlined pill control with transparent fill, 1px dark border, and 30px radius. Used for research filters, topic tags, and lightweight taxonomy controls.

### **`announcement-bar`**

Full-width black strip above the nav, 36px tall, centered microcopy with an underlined "Learn more" link and a close control at the far right.

### **`hero-photo-card`**

Rounded media card used in the home hero and solution pages. It combines photography or abstract imagery with an overlaid dark agent-console module. Radius is usually 22px on large cards and 8px on smaller thumbnails.

### **`agent-console-card`**

Dark product mockup panel showing agent names, status chips, integration badges, prompt fields, and generated response cards. Background is near-black, text is white or muted, and small accent chips use product colors.

### **`trust-logo-strip`**

Centered copy above a row of monochrome customer logos. It is intentionally quiet: no cards, no borders, just large horizontal spacing and black or white logos depending on the background.

### **`capability-card`**

Content block with thin-line geometric illustration, 24px heading, body copy, and a text link. On light backgrounds, cards often have only a top rule or a subtle image/card relationship rather than full boxing.

### **`dark-feature-band`**

Deep green or navy full-width section used for product capabilities, security claims, and feature breakdowns. Text turns white; cards use darker translucent surfaces, pale borders, and abstract line illustrations.

### **`product-card`**

Warm stone card used for product/model summaries. Typically 3-column on desktop, with 8px radius, generous padding, a small pill button, a divider line, and checkmark bullet rows.

### **`blog-filter-chip`**

Large coral taxonomy chip used on the blog index. Active chips invert to coral fill with dark text; inactive chips use coral outline and pale fill. Typography is oversized relative to typical filters, making the taxonomy a hero-level control.

### **`research-table`**

Rule-separated publication list with title left, topic pills centered, and date right. Rows are tall, white, and border-driven; filters above use many compact outlined pills.

### **`contact-form-card`**

Rounded white form panel set against dark green or warm stone sections. Inputs are rectangular with thin gray borders, 12px-16px padding, and compact labels/placeholders. Submit uses the same near-black pill style as primary CTAs.

### **`footer-newsletter`**

Dark footer subscription block with coral "AI moves fast" label, white headline, muted legal microcopy, a single-line email field, and arrow submit marker. Footer columns use white section labels and muted links.

## Copy & Microcopy（交互文案分册，2026-08-12）

交互文案（提示/错误/警告/建议/状态/引导）与视觉 token 同等重要。完整规范见 `01-docs/PROMPT-TEXT-SPEC.md`（唯一事实源：`src/utils/user-facing-error.js`）。

### 写作原则

1. **自然语言**：像人说话，不用内部标识符（IPC 通道名、英文错误码、栈信息、IP:端口、英文括号注释）。
2. **原因 + 建议**：失败提示必须同时给「具体原因」和「解决方法建议」。
   - ❌ 「当前许可证无权访问 store:list-publish-history」
   - ✅ 「当前未登录或登录状态已失效，无法使用该功能。请先登录后重试；若仍提示无权限，请确认当前账号已开通所需权益。」
3. **具体 > 笼统**：优先保留业务原因（「排期失败：任务不存在」），不无脑替换为「操作失败」。
4. **多语言**：zh/en 成对提供；语言解析 = 用户显式设置 > 系统语言（`zh*`→zh、`en*`→en、其余→en）> 默认 zh；设置弹窗「通用设置」可切换。
5. **语气**：礼貌、克制、无责备；错误不 panic，给可执行的下一步。

### 四类文案口径

| 类型 | 要求 | 示例（zh） |
|------|------|-----------|
| 错误 | 原因 + 建议 | 「网络连接失败。请检查网络后重试。」 |
| 警告 | 风险 + 选择 | 「操作过于频繁，已被服务商限流。请稍等片刻后再试。」 |
| 成功/状态 | 结果 + 下一步（可选） | 「已复制视频文件位置。」 |
| 引导 | 目的 + 操作 | 「请在「模型设置」中填写对应服务商的 API Key 后重试。」 |

### 渲染约束

- 用户可见区域禁止直接渲染 `result.message` / `e.message` 原文，必须经 `formatUserError()`。
- 主进程 `message` 不得包含内部通道名；诊断信息放 `messageParams.channel` / `messageParams.detail`。
- Story2Video 通知沿用 pattern→key 映射（保留「当前许可证无权访问」「当前账号没有所需权益」前缀兼容）。

## Do's and Don'ts

### Do

- Use white canvas as the default surface; introduce dark green or navy as full-width product bands.
- Keep primary CTAs pill-shaped and near-black on light surfaces.
- Use 22px radius on major media cards and placeholders.
- Use coral for editorial taxonomy and small warm accents, not as the main CTA system.
- Use monochrome trust logos with wide spacing.
- Use thin-line geometric illustrations for research and capability icons.
- Let photography and product mockups carry color, while the UI shell stays restrained.

### Don't

- Do not turn coral or blue into broad decorative surface colors.
- Do not add heavy drop shadows to cards.
- Do not make every section card-based; Cohere often uses unframed rows, rules, and open space.
- Do not use rounded cards below 8px for major media.
- Do not replace the display/body type split with one generic sans-serif voice.
- Do not render undocumented interaction variants in documentation or previews.
- Do not use saturated gradients as normal UI backgrounds; keep gradients media-led.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---:|---|
| Small Mobile | <425px | Single-column cards, compact nav, reduced hero headline scale |
| Mobile | 425-640px | Hero media stacks, card grids become one column, form rows stack |
| Large Mobile | 640-768px | Wider one-column layouts with larger media cards |
| Tablet | 768-1024px | Two-column cards begin, nav spacing tightens |
| Desktop | 1024-1440px | Full nav, 3-column card grids, split hero compositions |
| Large Desktop | 1440-2560px | Wide containers and large empty vertical intervals |

### Touch Targets

Primary CTAs and pills meet comfortable touch sizing through 12px-24px padding and pill radii. Research filter chips and blog category chips are larger than standard tags, making dense taxonomy surfaces usable on touch devices.

### Collapsing Strategy

- Nav collapses from full horizontal links to a compact mobile menu.
- Hero media moves from split cards to stacked cards.
- Product and capability grids collapse from 3 columns to 2 and then 1.
- Form fields collapse from paired rows to a single column.
- Research rows preserve their rule-separated structure but stack metadata below titles on smaller widths.

## Iteration Guide

1. Start from a white canvas or a full-width dark green/navy band; avoid mid-tone page backgrounds unless the screenshot shows a specific CTA/form section.
2. Use `button-primary` for the single highest-priority action and `button-secondary` for the companion action.
3. Use `hero-photo-card` or `agent-console-card` when a page needs visual energy; avoid invented dashboard data.
4. For editorial pages, combine `blog-filter-chip`, `button-pill-outline`, and `research-table` instead of generic marketing cards.
5. Keep component examples structurally honest: placeholder product frames are better than invented product content.

## 视频流水线进度弹窗（2026-08-23）

### 结构与层级

- 进度弹窗是运行详情的唯一完整承载，不在启动页正文重复渲染 StageProgress。统一使用 `UiModal variant=progress`、`xl`、`960px` 最大宽度。
- 桌面 overlay 的 z-index 为 100，固定底部 action bar 为 110；overlay 保持视觉遮罩但不拦截 action bar，弹窗 surface 与 body 内容仍可交互。
- header/footer 固定，body 使用 `overflow-y: auto`；最大高度减去 `88px` action-bar 空间和安全边距，窄屏按 `136px` 移动 action-bar 空间计算。

### 交互与动效

- 进度弹窗是 modeless 观察窗：遮罩点击和 Escape 不关闭，只有右上角关闭按钮可触发 detach。关闭按钮带可访问 label 和稳定 test id。
- 离场使用 opacity + `scale(0.96) translateY(4px)`，让用户明确看到观察窗被收起，而不是任务被取消。
- **footer 四按钮契约（2026-10-17）**：所有视频流水线进度浮层（视频创作页与热门选题页）footer 从左到右固定为 **【查看】【去发布】【后台运行】【取消】**，且一律用 `UiButton` 渲染（`secondary` 变体；重试用 `primary`）。任何页面 SHALL NOT 在 footer 用小节私有按钮类（如 `cohere-btn-*`）承载流水线动作 —— 与弹窗内 `StageProgress` 同源，保证圆角、内边距、禁用态、主次色一致。
- 【查看】【去发布】在任何状态都渲染，但初始 `disabled` + `aria-disabled="true"` 并保留可见文案（不用 tooltip 替代）；仅本次 run `completed` 且取得成片后转为可点。
- 运行中 footer 提供【后台运行】；右上角关闭和该按钮走同一 detach handler。toast 为“任务已转入后台运行，在历史记录中可查看”。
- 终态（`completed`）后【后台运行】【取消】不再渲染（无运行中任务可脱离/可取消），由右上角关闭承接收起；关闭动作改为复位前端态并收起浮层，不调用 `pipelineCancel`。
- 人工 checkpoint（素材选择/内容策略/等待用户输入）关闭按钮 disabled，footer 不显示后台按钮，保留确认、修改、取消动作；【查看】【去发布】此时保持灰显。
- footer 中的长文案（错误提示、人工检查点提示）以 `flex: 1` / `margin-right: auto` 占位在左，按钮组靠右，避免错误文字被挤到按钮之间。

### 内容与数据表现

总进度、已用时、终态摘要、所有阶段、状态、详情、阶段耗时、子进度、合成时间参考、provider warning、BGM 跳过、加载/不可用提示和素材选择面板都属于弹窗内容。数组、对象和进度范围先归一化，错误字段只隐藏或走既有 fallback，不使 renderer 崩溃。

**完成态即决策中枢（2026-10-17）**：run 成功后弹窗**保持打开**，内容区定格为「阶段全完成 + 进度 100% + 完成汇总」，footer 的【查看】【去发布】同帧解锁。不再自动跳转结果页 —— 成功瞬间用户要的是"下一步做什么"，而不是被动离开当前上下文。

### 范围边界与废弃组件

该统一壳只覆盖编排流水线、历史续跑等“有可观察流水线阶段状态”的路径；快速渲染 loading、发布 timeline、独立分析状态保持各自轻量展示。已废弃的 `CreateHistory.vue` 不再提供内嵌进度卡片，历史入口统一为 `CreateViewHistory.vue` 的摘要与恢复。

## 热门选题行内流水线选择器（2026-10-17）

### 结构与层级

- 每条选题行（热门 tab 与收藏 tab）的右侧按钮区是一个**按钮组**：主按钮【生成视频】+ 紧邻的小下箭头按钮（▾）。两者同用 `cohere-btn-primary`（主色实心、小尺寸），间距 2px；下箭头内边距 4px 6px、行高 1，视觉上是主按钮的“分段”而非并列的第二个主操作。
- 下箭头点击后打开**行内下拉面板**：`position: absolute; right: 0; top: calc(100% + 6px)`，`z-index: 60`；绝对定位不参与行 flex 布局 ⇒ 列表行高不变、不产生跳动。
- 面板尺寸：`min-width: 260px; max-width: 340px; max-height: 320px`（超出纵向滚动）；圆角 10px、1px 边框、`box-shadow 0 10px 28px` 低透明度；内部 `padding: 6px`，菜单项圆角 7px。
- 面板结构：标题行（`hotTopics.genVideoPipelinePickTitle`）→ 状态区（加载中/加载失败+重试/空）或菜单项列表 → 底部操作提示（仅存在可执行项时）。菜单项名称左对齐、默认徽标/禁用原因右对齐（`flex-shrink: 0`），长名称省略号截断。
- 不引入 `el-dropdown` / `el-popover`：与 Element Plus 按需注册的机械锁（组件清单 + 样式闭包）保持零变更，避免为一个行内菜单扩大全局组件面。样式全部 scoped 在该组件内，禁止放到全局 `styles/`。

### 视觉令牌

- 面板底色 `--color-bg-card`、边框 `--color-border`、标题/原因文字 `--color-text-muted`、正文 `--color-text-primary`；hover/焦点底色 `color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-card))`。
- 默认徽标：主色淡底 + `--color-primary-dark-tint` 文字（与列表其它主色徽标同源）；禁用项整体 `opacity: .66` + `cursor: not-allowed`。
- 主色禁用态由 `cohere-btn-primary:disabled` 统一提供，不在组件内重定义语义色。

### 交互与动效

- 下箭头 → 面板：0.15s 箭头 180° 旋转；面板无入场动画（避免在长列表中出现多个浮动动画体）。
- 关闭路径：再次点击下箭头、点击面板外（document `pointerdown` capture）、Esc；Esc 关闭后焦点回到下箭头。
- 面板打开时焦点进入第一个可执行项；↑/↓ 在可执行项间循环、Home/End 到首/末项、禁用项不可聚焦；回车 = 点击（原生 button）。
- 同一时刻只允许一个面板打开（跨行单例指针）；busy（编排在途）时主按钮与下箭头一起禁用，面板强制关闭。
- **空间自适应（2026-10-17 视觉取证后补）**：面板下方可用高度 < 面板理想高度（320px）+ 6px 时翻转到按钮上方；翻转后仍不足则按可用空间压缩面板高度（下限 160px，内部滚动），避免被页面滚动容器（`.cohere-content`，实测仅 342px 高）裁掉前几项。
- **滚动即关闭**：捕获阶段监听 `window` 的 scroll（能收到滚动容器的事件），面板一滚动就收起，避免面板与按钮脱位或被裁切。
- 加载中显示「正在加载流水线…」；加载失败显示错误 +【重试】+ 回退项「故事讲述（默认）」；空清单显示提示，不渲染空菜单。

### 内容与数据表现

- 菜单项 = 本地化流水线名 + 类型徽标（可省略）+ 默认徽标 / 禁用原因。默认项固定 `story2video-compose`；可执行项在前、禁用项在后，顺序保持主进程返回顺序。
- 禁用原因四类文案：需先导入视频/音频素材、需在专属页面使用、内部调试流水线、尚未实现执行引擎；未知条目统一“暂不支持从选题直接生成”。
- 弹窗内显示当前流水线名称（`hotTopics.genVideoPipelineLabel`），与阶段清单一起构成“我点了哪条流水线、它跑到哪了”的完整上下文。

### 范围边界

- 该选择器只负责“选哪条流水线并立即开始”，不承载流水线参数编辑（参数仍在视频创作页配置）。
- 不做“记住上次选择”作为主按钮默认值；主按钮固定默认流水线，避免隐式状态。
- 像素门禁当前不覆盖 `hot-topics`（见 PRD §9.2 盲区登记），视觉正确性由组件/集成测试 + 人工截图取证保证。


## 全局壳层：左侧菜单收起/展开（2026-10-18）

### 结构与层级

- 按钮固定于顶部标签栏 `TabBar` 最左侧、可横向滚动的 `.tab-bar-tabs` 之前；标签条滚动不带动按钮；按钮在既有 36px 行内垂直撑满，不新增行高，`TabBar(36px) + NavBar(40px) = BROWSER_CHROME_TOP(76px)` 的主进程契约不变。
- 使用原生 `<button type="button">`；图标为内联 SVG 的双向 `chevron`（左箭头 + 右箭头，组合成「<>」），不使用 emoji、图标字体、位图或新图标依赖。
- `role="tablist"` 只属于 `.tab-bar-tabs`；折叠按钮与「+」新建标签按钮位于 tablist 之外，不参与 tab 序列（原实现把 `role="tablist"` 放在 `TabBar` 根节点，既包含非 tab 元素，ARIA 不合规）。
- `App.vue` 对 `<MpSidebar>` 施加 `v-show` 跟随折叠态（`display:none`），**不卸载组件**（保留其内部状态、`ResizeObserver` 与运营菜单订阅）；`MpSidebar.vue` 本体**未改动**，其既有 `if (w > 0)` 守卫保证收起时不会上报 `width=0`。收起时主内容区横向铺满。

### 尺寸与视觉令牌

- 按钮高度撑满标签栏 36px；宽度 = 16px 图标 + 左右水平内边距（复用 `--spacing-*` token），不设固定像素宽；图标视觉尺寸 16×16，`stroke`/`fill` 使用 `currentColor`。
- 常态前景 `--color-text-secondary`；hover 背景 `--color-sidebar-hover-bg`、前景 `--color-text-primary`；焦点环 `2px solid var(--color-primary)` + `2px` offset；`aria-pressed="true"`（已收起）允许用主色强化，但图标形状不变。
- 暗色主题由 `[data-theme="dark"]` 的 token 覆写自动适配；组件内禁止十六进制颜色字面量。
- **无动画、无过渡**：原生 `WebContentsView` 不跟随 CSS 过渡插值，动画期间视图边界必然与 DOM 不同步；折叠是「瞬时切换 + 一次重排」。

### 状态与交互

- 二态 `expanded ⇄ collapsed`；点击或键盘 Enter/Space 切换，切换幂等；本地状态先于 IPC 生效，不做防抖延迟。
- `aria-label` 与 `title` 使用同一文案，按「点击后会发生什么」描述：展开态显示「收起左侧菜单」/“Collapse sidebar”，收起态显示「展开左侧菜单」/“Expand sidebar”；`aria-pressed="true"` 表示已收起。
- 文案写入 `apps/desktop/src/locales/tab-bar/{zh,en}.js`，zh/en 成对；`.vue` 内不硬编码中文。
- 不进入 tablist、不注册全局快捷键；作为 `TabBar` 内第一个可聚焦元素参与 Tab 顺序。

### 持久化与跨进程

- `localStorage['mulpub.ui.sidebarCollapsed']`：`'1'` 收起；其他值、缺失、`getItem`/`setItem` 抛异常一律按展开/静默处理，不阻塞渲染。
- 收起状态经 preload `pageManager.setSidebarCollapsed(boolean)` → IPC `page-manager:set-sidebar-collapsed` → 主进程 `WebviewManager._sidebarCollapsed`，并同步 `AuthViewManager` / `QRCodeLogin`；`computeEmbeddedViewBounds(win, sidebarWidth, 76, sidebarCollapsed)` 第 4 参为 `true` 时内嵌视图 `x=0`、宽=客户区全宽。
- **收起不得用 `setSidebarWidth(0)` 表达**：`MIN_SIDEBAR_WIDTH=1` / `MAX_SIDEBAR_WIDTH=600` 与三处 `setSidebarWidth` 守卫逐字保留；收起不修改 `_sidebarWidth`，展开直接恢复 200px（≤900px 时 68px）。
- 启动时若持久化为收起，工作台壳层挂载后主动上报一次；非 Electron（`invokePageManager` 返回 `undefined`）静默跳过。

### 可访问性

- 原生按钮语义；`aria-pressed` 暴露状态；SVG 带 `aria-hidden="true"` 与 `focusable="false"`，不进入可访问名称。
- 焦点环可见且不被标签栏裁切；前景/背景对比度 ≥ 3:1（非文本 UI 元素），hover/focus 态同样满足。
- `role="tablist"` 仅覆盖 `.tab-bar-tabs`，读屏器不会把「+」与折叠按钮播报为 tab。

### 范围边界

- 不做动画、拖拽调宽、窄屏 68px 图标栏的第二种折叠形态、快捷键；OAuth 内嵌视图（`apps/desktop/electron/services/oauth-manager.js:86` 不传侧栏宽度）不跟随折叠，登记为已知限制。
- 该按钮是全局可见 UI：`apps/desktop/tests/visual-testing/base-screenshots/` 下 43 张 PNG 全部变化，基线由 CI 同源渲染重建并逐张审核，不得声称「视觉中性」。

## Known Gaps

- Exact proprietary font files are not bundled; use the documented fallbacks when implementing externally.
- Mobile screenshots were not regenerated in this public update, so mobile behavior is documented from the desktop system and existing responsive patterns.
- Some live pages lazy-load content blocks late; blank testimonial placeholders are documented as placeholder skeleton surfaces rather than filled testimonial cards.
