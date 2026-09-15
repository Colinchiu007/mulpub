# PRD：全局「回到顶部」浮标按钮（BackToTop）

| 项目 | 内容 |
|------|------|
| 文档类型 | 功能 PRD（增量） |
| 日期 | 2026-09-14 |
| 变更标识 | `back-to-top-button` |
| 分支 | `back-to-top-button`（隔离 worktree：`D:/Data/projects/mp-worktrees/mp-back-to-top-button`） |
| 需求来源 | 用户直接需求（附悬浮态效果截图） |
| 复杂度判定 | S+ / 低风险（纯渲染层 UI，不涉及 auth / 数据库 / API 契约 / 加密），按 `openspec/specs/openspec-integration/spec.md`「适用范围约束」不强制创建 OpenSpec change |
| 关联文档 | `docs/desktop-ui-layout-spec.md` §14、`docs/frontend-interaction-spec.md` §2、`01-docs/PRD.md` 末尾增量章节、`CHANGELOG.md` |
| 状态 | 已实现（待评审） |

---

## 一、需求概述

### 1.1 背景

桌面端应用内多个页面的内容高度会超过一屏（发布历史、账号管理、模型服务商、创作历史、热榜、收藏等列表页与详情页）。用户滚动到列表底部后，若想修改顶部筛选项或直接切换模块，必须手动长距离回滚，操作成本高且容易丢失上下文。

当前应用**没有任何「回到顶部」入口**（全库检索 `back-to-top` / `backToTop` / `回到顶部` / `scrollToTop` 零命中），属于交互能力缺口。

### 1.2 目标

在窗口**右侧接近底部**的位置提供一个统一的「回到顶部」浮标按钮，滚动到一定距离后出现，点击后平滑回滚到滚动区顶部，并具备悬浮/按下/焦点三种状态的视觉反馈与文字提示。

### 1.3 非目标（明确不做）

| 项 | 理由 |
|----|------|
| 「回到底部」按钮 | 当前无需求；长列表底部通常已有分页/加载更多入口 |
| 各视图单独引入浮标 | 违反 `docs/frontend-interaction-spec.md` §2「交互原语唯一实现清单」，会造成长页面遗漏与重复实现 |
| 改变各页面既有滚动实现 | 本需求只做「回滚入口」，不动各视图内部滚动容器结构 |
| 虚拟滚动 / 分页重构 | 属于性能域独立议题，超出本次范围 |
| 全局 `window` 滚动支持 | 应用 `html, body` 为 `overflow: hidden`（`App.vue` 内联样式），滚动只发生在内容容器上，无此场景 |

---

## 二、适用范围与页面判定

### 2.1 判定规则（能力条件，非页面白名单）

**不采用页面白名单**，而采用可自我判定的能力条件：

> 只要当前页面存在「可滚动容器，且其 `scrollTop` 超过阈值（默认 320px）」，浮标就自动出现；否则不出现。

由此自然得到两个良性结果：

1. **内容不足一屏的页面自动不显示**——`scrollTop` 恒为 0，永远不会越过阈值，无需人工维护「哪些页面要加」的清单。
2. **未来新增页面自动获得该能力**——不需要在新增页面时记得补挂组件。

### 2.2 当前生效页面（基于 `apps/desktop/src/router/index.js` 路由表分类）

| 路由 | 视图 | 类型 | 滚动来源 | 典型触发场景 |
|------|------|------|---------|-------------|
| `/` | `Home.vue` | 首页/列表 | 主容器 | 数据源卡片区超一屏 |
| `/publish/history` | `PublishHistory.vue` | 列表 | 主容器 + 视图内嵌滚动区 | 发布记录多页 |
| `/accounts` | `Accounts.vue` | 列表 | 主容器 | 多平台账号卡片堆积 |
| `/collection` | `Collection.vue` | 列表 | 主容器 | 采集内容长列表 |
| `/library` | `ProjectLibrary.vue` | 列表 | 主容器 | 项目库长列表 |
| `/create?view=history` | `CreateView.vue` | 列表 | 视图内嵌滚动区 | 创作历史长列表 |
| `/monitor` | `Monitor.vue` | 列表 | 主容器 | 监控卡片长列表 |
| `/calendar` | `Calendar.vue` | 列表 | 主容器 | 日历网格 + 下方列表 |
| `/hot-topics` | `HotTopics.vue` | 列表 | 主容器 | 热榜条目超一屏 |
| `/member-center` | `MemberCenter.vue` | 列表 | 主容器 | 权益与记录区 |
| `/cloud-publish` | `CloudPublish.vue` | 列表 | 主容器 | 云端任务列表 |
| `/create/result` | `ResultView.vue` | 详情 | 主容器 + 视图内嵌滚动区 | 结果详情长内容 |
| `/board/:projectId` | `ProductionBoard.vue` | 详情 | 主容器 | 分镜看板纵向展开 |
| `/board/:projectId/contact-sheet` | `ContactSheetView.vue` | 详情 | 视图内嵌滚动区 | 联络表大图流 |
| `/replay/:projectId` | `ReplayTimeline.vue` | 详情 | 主容器 | 时间线长内容 |
| `/video-clone` | `VideoCloneView.vue` | 详情 | 主容器 | 克隆任务详情 |
| `/model-providers` | `ModelProviders.vue` | 设置 | 视图内嵌滚动区 | 服务商列表长 |
| `/prompt-eval` | `PromptEval.vue` | 设置 | 主容器 | 评估任务列表 |
| `/intelligence` | `Intelligence.vue` | 设置 | 主容器 | 情报面板 |

> 上表为「具备触发条件」的页面，实际是否出现仍取决于该页面当次内容高度与滚动距离。

### 2.3 显式排除的页面/场景

| 场景 | 排除方式 | 理由 |
|------|---------|------|
| `/first-run`（首跑引导） | 挂载点位于 `App.vue` 的 `v-else` 分支内；该路由走 `isFullScreenRoute` 独立分支 | 分步引导流程内容受控，无长列表回滚诉求 |
| 登录标签页（`isLoginTab`） | 同分支下 `router-view` 不渲染（`v-if="!isLoginTab"`），滚动容器无内容，`scrollTop` 恒为 0 | 此时右侧主体由 `WebContentsView` 覆盖，SPA 内容不可见 |

---

## 三、数据校验（配置契约）

### 3.1 组件入参契约

| 参数 | 类型 | 默认值 | 校验规则 | 非法值处理 |
|------|------|--------|---------|-----------|
| `threshold` | `Number` | `320` | 期望为非负数值；语义为「显示阈值（px）」 | 非数值时比较恒为 `false`，按钮不显示（fail-safe，不误弹） |
| `containerSelector` | `String` | `[data-testid="mp-workspace"]` | 必须能 `document.querySelector` 命中 | 未命中时 `console.warn` 并**不注册监听**，按钮保持隐藏，不抛异常 |

### 3.2 运行时校验项

| 校验项 | 规则 | 位置 | 失败处理 |
|--------|------|------|---------|
| 滚动事件目标有效性 | `event.target` 存在且 `typeof target.scrollTop === 'number'` | `onScroll` | 直接 `return`，忽略该次事件 |
| `scrollTop` 数值读取 | `Number(target.scrollTop)|| 0` 语义，使用 `> threshold` 严格比较 | `onScroll` | 阈值边界等于不触发，避免抖动 |
| 回滚目标可用性 | `activeScroller.isConnected` 为真才使用，否则回退到主容器 | `resolveScroller` | 回退主容器；主容器也为空则 `return`（不动作） |
| 平滑滚动能力 | `try { el.scrollTo({top,behavior}) }` | `handleClick` | 捕获异常后降级为 `el.scrollTop = 0` 并 `console.warn` |
| 重复点击 | 600ms 时间锁 | `handleClick` | 锁定期内直接 `return`，保证一次滚动只触发一次 |
| 定时器清理 | `unlockTimer` 在卸载/路由切换时 `clearTimeout` | `onBeforeUnmount` / 路由 `watch` | 防止解锁回调在组件销毁后执行 |

### 3.3 无外部数据依赖声明

本功能**不读写任何持久化数据**（不涉及 SQLite / localStorage / IPC）。唯一状态是组件内存中的 `visible` 布尔量与滚动位置，属纯视图层临时状态，关闭或刷新应用后自然重置。因此不存在数据迁移、脏数据、并发写入风险。

---

## 四、流程与功能逻辑

### 4.1 显隐流程

```
用户滚动内容区
    │
    ▼
scroll 事件（捕获阶段，在 .mp-workspace 上监听）
    │   —— scroll 不冒泡，仅在捕获阶段能同时拿到主容器与嵌套子容器的滚动
    ▼
解析 event.target
    │
    ├── target.scrollTop > threshold(320px)？
    │       ├── 是 → 记录 activeScroller = target；visible = true（浮标淡入）
    │       └── 否 → 若 activeScroller === target → activeScroller = null；visible = false（浮标淡出）
    │
    ▼
路由切换（route.fullPath 变化）
    │
    ▼
visible = false；activeScroller = null；解除点击锁（新页面默认停在顶部，浮标不应残留）
```

**关键设计说明**：显隐条件为「最后一个产生滚动的容器是否超过阈值」，而非「页面是否有滚动条」。原因是一个页面可能同时存在主容器与视图内嵌滚动区，用「最后滚动者」更贴近用户意图。

### 4.2 多滚动容器解析规则

| 层级 | 容器 | 举例 | 解析方式 |
|------|------|------|---------|
| 主容器 | `.mp-workspace`（`overflow: auto`） | `Accounts.vue`、`HotTopics.vue` | 组件挂载时 `querySelector` 定位，捕获阶段监听 |
| 嵌套容器 | 视图内自带的 `overflow: auto` 区块 | `PublishHistory.vue`、`ModelProviders.vue`、`ResultView.vue`、`ContactSheetView.vue` | 通过主容器捕获阶段监听自动覆盖，无需逐个声明 |

点击时的回滚目标优先级：

```
1. activeScroller（最后一个产生滚动的容器）且 isConnected === true
2. 主容器 containerEl
3. 两者皆不可用 → 不执行任何动作
```

### 4.3 点击回滚流程

```
用户点击浮标
    │
    ▼
点击锁已持有？（600ms 时间锁）
    ├── 是 → 忽略本次点击（防连点重复滚动）
    └── 否 → 上锁，启动 600ms 解锁定时器
    │
    ▼
resolver 选定回滚目标容器
    │
    ▼
系统开启「减少动态效果」（prefers-reduced-motion: reduce）？
    ├── 是 → scrollTo({ top: 0, behavior: 'auto' })   // 瞬时跳转，避免前庭不适
    └── 否 → scrollTo({ top: 0, behavior: 'smooth' }) // 平滑滚动
    │
    ▼
平滑滚动过程中 scrollTop 递减，最终归 0
    │
    ▼
主容器捕获到 scroll 事件 → scrollTop(0) 未越过阈值 → activeScroller = null；visible = false
    │
    ▼
浮标自动淡出（无需在点击时强制隐藏，避免滚动被中断时「按钮已消失但没回到顶部」的状态不一致）
```

### 4.4 状态机

| 状态 | 进入条件 | 退出条件 | 视觉 |
|------|---------|---------|------|
| 隐藏（initial） | 初始挂载 / 显隐条件不满足 | `scrollTop > threshold` | 不在 DOM 中（`v-if`） |
| 进入中（enter） | `visible` 由 `false → true` | 180ms 过渡结束 | 透明度 0→1，`translateY(8px)→0` 自右下方浮起 |
| 常态（idle） | 进入动画结束 | 指针进入 / 键盘聚焦 / 显隐条件不满足 | 见 §5、§7 |
| 悬浮（hover） | 指针进入按钮区域 | 指针离开 | 底色加深、图标转为深色、左侧弹出文字提示 |
| 按下（active） | 鼠标左键 / 触摸按下 | 抬起 | 底色再加深，`scale(0.94)` 轻微内收 |
| 焦点（focus-visible） | 键盘 Tab 聚焦（`focus-visible`，鼠标点击不触发） | 失焦 | 2px 主色描边 + 2px offset；文字提示与悬浮态一致显示 |
| 离开中（leave） | `visible` 由 `true → false` | 180ms 过渡结束 | 透明度 1→0，`0→translateY(8px)`，结束后移出 DOM |

---

## 五、交互与显示项

### 5.1 指针交互

| 操作 | 行为 | 说明 |
|------|------|------|
| 悬浮 | 底色加深 + 图标转深色 + 左侧文字提示淡入 | 提示与图标变化同时发生，覆盖用户「这是什么按钮」的瞬时疑问 |
| 按下 | 底色再加深 + 轻微缩放 | 提供即时触觉反馈感 |
| 单击 | 平滑回滚至顶部（见 §4.3） | 600ms 内重复点击被忽略 |
| 指针离开 | 恢复常态，提示淡出 | 提示本身 `pointer-events: none`，不拦截鼠标事件 |

### 5.2 显示项

| 显示项 | 内容 | 位置 | 备注 |
|--------|------|------|------|
| 图标 | 20×20 向上箭头（内联 SVG，`stroke-width: 2`，圆头圆角连接） | 按钮中心 | 采用 `currentColor`，随状态自动变色 |
| 文字提示 | 「回到顶部」/「Back to top」 | 按钮**左侧**，垂直居中 | 深色圆角气泡 + 指向按钮的右侧小三角 |

> 图标方案选型：项目存在 `@element-plus/icons-vue` 与内联 SVG 两套并存的情况。本组件选用**内联 SVG**——零新依赖、便于精确控制 `stroke-width` 与端点样式以匹配截图中的线性箭头形态，且与 `CreateView.vue` 等既有按钮图标写法一致。

### 5.3 键盘交互

| 按键 | 行为 |
|------|------|
| `Tab` | 可聚焦（原生 `<button>`，`type="button"`） |
| `Enter` / `Space` | 触发回滚（原生按钮行为，无需额外绑定） |
| 聚焦 | 显示 2px 主色描边，并同样弹出文字提示（保证键盘用户获得与鼠标用户等价的信息） |

### 5.4 提示展示条件汇总

| 条件 | 是否显示文字提示 |
|------|----------------|
| 鼠标悬浮按钮 | ✅ |
| 键盘聚焦（`:focus-visible`） | ✅ |
| 鼠标点击（`focus` 但非 `focus-visible`） | ❌ 不弹提示，避免点击后提示滞留 |
| 按钮隐藏 | ❌ 不显示（元素已移出 DOM） |

---

## 六、提示文字清单（zh / en）

| Key | zh | en | 用途 | 出现位置 |
|-----|----|----|------|---------|
| `common.backToTop` | 回到顶部 | Back to top | 按钮文字提示气泡 + `aria-label` 无障碍名 | 浮标按钮左侧气泡 |

**i18n 约束**（对应 CI Gate 7）：

1. zh/en **必须成对提交**（`check-locale-sync.js --pair-base` 强制）；
2. 渲染端**不得新增硬编码中文**（`--cjk` 强制，基线只减不增）；
3. 代码中 `t('...')` 引用的 key 必须在 zh/en 同时存在（`--keys` 强制）。

**缺 key 兜底行为**：`vue-i18n` 在 key 缺失时返回 key 原文。组件据此判断——若返回值等于 key 原文则视为未翻译，文案回退为空串（不渲染气泡），`aria-label` 再回退为英文常量 `Back to top`，保证读屏用户不会遇到「无名按钮」。此策略与 `PipelineBackgroundToast.vue` 的既有处理保持一致。

---

## 七、视觉规范

### 7.1 几何参数

| 项 | 值 | 来源 |
|----|----|------|
| 按钮尺寸 | 44 × 44 px | 桌面端点击热区下限，兼顾视觉轻量 |
| 圆角 | `var(--radius-lg)` = 16px | `tokens.css` 圆角阶梯（4/8/12/16/999），对齐截图的近方圆形（squircle）观感 |
| 图标尺寸 | 20 × 20 px | 与 44px 按钮形成约 45% 占比 |
| 图标描边 | `stroke-width: 2`，`linecap/linejoin: round` | 匹配截图线性箭头形态 |
| 距右边距 | `var(--spacing-6)` = 24px | 间距阶梯 |
| 距下边距 | `var(--spacing-6)` = 24px | 间距阶梯 |
| 气泡与按钮间距 | 10px | 视觉可辨识且不显疏离 |
| 气泡内边距 | 6px 10px | — |
| 气泡圆角 | `var(--radius-sm)` = 8px | 圆角阶梯 |
| 气泡三角 | 4px 等边，位于气泡右侧垂直居中 | 指向按钮 |

### 7.2 颜色（新增语义 token，亮/暗双模式）

所有色值统一落在 `apps/desktop/src/styles/tokens.css`，遵守「禁止组件内重定义同语义变量」规则。

| 语义 | Token | 亮色模式 | 暗色模式 | 用途 |
|------|-------|---------|---------|------|
| 浮标底色 | `--color-float-surface` | `#ececef` | `#2c2c34` | 常态背景 |
| 浮标底色（悬浮） | `--color-float-surface-hover` | `#e0e0e5` | `#383842` | 悬浮背景 |
| 浮标底色（按下） | `--color-float-surface-active` | `#d4d4dc` | `#44444f` | 按下背景 |
| 图标色 | `--color-float-icon` | `#707080` | `#a0a0b0` | 常态图标 |
| 图标色（悬浮） | `--color-float-icon-hover` | `#1e1b4b` | `#f0f0f5` | 悬浮/聚焦图标（对应截图深色箭头） |
| 气泡底色 | `--color-float-tooltip-bg` | `#303038` | `#4a4a55` | 深色提示气泡 |
| 气泡文字 | `--color-float-tooltip-text` | `#ffffff` | `#ffffff` | 气泡文字 |
| 浮标阴影 | `--shadow-float` | `0 2px 8px rgba(30,27,75,.08)` | `0 2px 10px rgba(0,0,0,.45)` | 与页面内容分离 |
| 焦点描边 | `--color-primary` | `#5048E5` | `#5048E5` | 键盘焦点环 |

**暗色模式取值原则**：浮标表面保持「比页面卡片（`--color-bg-card` `#232329`）更亮一档」的层级感，图标使用亮色（`#f0f0f5`）而非降级为低对比灰，遵循 `docs/frontend-interaction-spec.md` §1「暗色模式不降级为低对比灰」条款。

### 7.3 层级（z-index）与浮层关系

| 浮层 | z-index | 与本浮标关系 |
|------|---------|-------------|
| `PipelineBackgroundToast` | 2100 | 居中显示，与右下角浮标无空间冲突 |
| `UpdateNotification` / `UiModal` overlay | 2000 | **高于浮标（1900）**：模态弹窗打开时应有最高焦点，浮标被遮罩覆盖符合模态语义 |
| **`BackToTop`** | **1900** | 低于模态层，高于所有普通页面内容 |
| 页面普通内容 | auto | — |

### 7.4 与右下角 UpdateNotification toast 的位置协调

**问题**：`UpdateNotification.vue` 的临时提示条定位为 `bottom: 16px; right: 16px`，与浮标（`bottom: 24px; right: 24px`，占位 44×44）在水平 24–68px、垂直 24–60px 区间重叠。

**方案**：将提示条右偏移由 `16px` 调整为 `88px`（仅调整 `right`，保持 `bottom: 16px` 贴底）。

**理由**：浮标占据窗口右下角最角落，让提示条水平左移是最小改动方案；保持贴底对齐视觉更稳，且不改变提示条本身的层级与语义。调整后提示条右边缘距窗口 88px > 浮标左边缘距窗口 68px，**完全消除重叠**。

**取舍**：提示条不再严格贴右边缘（视觉上内缩 72px），但出现频率低（仅更新检查完成/失败时），影响可忽略。

---

## 八、可访问性

| 项 | 实现 |
|----|------|
| 语义元素 | 原生 `<button type="button">`，非 `div` + 事件模拟 |
| 可访问名 | `aria-label` 绑定 `common.backToTop` 译文，缺失时回退英文常量 `Back to top` |
| 图标 | SVG 标记 `aria-hidden="true"` + `focusable="false"`，避免读屏朗读无意义图形 |
| 提示气泡 | 标记 `aria-hidden="true"`——其文字与 `aria-label` 重复，避免重复朗读 |
| 键盘可达 | 原生按钮天然可 Tab 聚焦，`Enter` / `Space` 触发 |
| 焦点可见 | `:focus-visible` 显示 2px 主色描边（`:focus` 会导致鼠标点击也出现描边，故不用） |
| 减少动效 | `@media (prefers-reduced-motion: reduce)` 关闭全部过渡，并将平滑滚动降级为瞬时跳转 |
| 触屏 | 应用为桌面端，不做触屏专项适配；`<button>` 原生支持触摸事件 |

---

## 九、测试覆盖

测试文件：`apps/desktop/src/components/BackToTop.test.js`（12 项，全部通过）

| # | 场景 | 断言要点 | 类型 |
|---|------|---------|------|
| 1 | 初始不渲染 | 内容未滚动时 DOM 中无按钮 | 正常路径 |
| 2 | 显隐基本流 | 319px 不显示 → 321px 显示 → 100px 隐藏 | 正常路径 |
| 3 | 阈值边界 | 恰好等于 320px 不显示，321px 显示（严格 `>`） | 边界值 |
| 4 | 自定义阈值 | `threshold=10` 时 11px 即显示 | 配置契约 |
| 5 | 点击回滚 | `scrollTo` 被调用且参数为 `{top:0, behavior:'smooth'}` | 正常路径 |
| 6 | 减少动效降级 | `matchMedia('reduce')` 命中时 `behavior: 'auto'` | 无障碍 / 降级 |
| 7 | 嵌套滚动容器 | 内层容器滚动可触发；点击回滚内层而非外层 | 组合场景 |
| 8 | 防重复点击 | 连续 3 次点击仅触发 1 次滚动 | 竞态 / 幂等 |
| 9 | i18n 双语文案 | zh 渲染「回到顶部」、en 渲染「Back to top」，`aria-label` 同步 | 提示文字 |
| 10 | 路由切换重置 | 切换路由后按钮收起 | 状态隔离 |
| 11 | 容器缺失 | 找不到滚动容器时不崩溃、保持隐藏、输出 `console.warn` | 异常路径 |
| 12 | 卸载清理 | 卸载后容器再滚动不报错、按钮不复活 | 资源释放 |

**回归保护依据**：第 3 项锁定阈值比较符（`>` 而非 `>=`），第 8 项锁定防连点时间锁，第 12 项锁定监听器与定时器清理——这三项是最容易在后续重构中被无意改坏的行为契约。

---

## 十、错误处理与降级

| 异常场景 | 现象 | 处理 | 影响 |
|---------|------|------|------|
| 滚动容器未找到 | `querySelector` 返回 `null` | `console.warn` 后不注册监听，组件保持隐藏 | 浮标不出现，页面其余功能不受影响 |
| `scrollTo(options)` 不被支持 | 调用抛 `TypeError` | 捕获后降级 `el.scrollTop = 0` 并 `console.warn` | 由平滑滚动退化为瞬时跳转，功能仍可用 |
| `scrollTop` 非数值 | 某些宿主环境返回 `undefined` | `onScroll` 提前 `return` | 该次滚动不改变显隐，无副作用 |
| 回滚目标已脱离 DOM | 路由切换后容器被替换 | `resolveScroller` 回退主容器 | 仍能正常回滚 |
| i18n key 缺失 | `t()` 返回 key 原文 | 判断后回退空串 + 英文 `aria-label` | 气泡不渲染；按钮仍可用且可被读屏识别 |
| 平滑滚动中路由切换 | 滚动被中断，`scrollTop` 未归零 | 路由 `watch` 强制 `visible=false` 并解锁 | 浮标收起，无残留状态 |

---

## 十一、已知限制与非目标

1. **不做滚动位置记忆**：应用重启或路由往返后不恢复上次滚动位置，属独立议题。
2. **不做「滚动进度」视觉**：按钮不显示当前滚动百分比。
3. **`threshold` 为组件级默认值**：当前未做「按页面差异化阈值」，如需可后续通过 props 传入。
4. **视觉回归基线未新增**：本次未在 `apps/desktop/tests/visual-testing/` 增加该组件的像素基线用例；若需要可在后续补充单视图基线。
5. **暗色模式配色为设计推导值**：`tokens.css` 暗色变体依据「表面层级 + 对比度」原则推导，尚未经过设计师逐色确认。

---

## 十二、变更历史

| 日期 | 版本 | 变更内容 | 关联 |
|------|------|---------|------|
| 2026-09-14 | v1.0 | 初始版本：新增全局回到顶部浮标（组件 + 挂载 + i18n + token + 测试 + 文档） | 分支 `back-to-top-button` |
