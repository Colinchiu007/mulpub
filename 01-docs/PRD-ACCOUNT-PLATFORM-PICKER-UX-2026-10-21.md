# PRD：账号页「添加账号」平台选择器视觉优化

- 文档编号：PRD-ACCOUNT-PLATFORM-PICKER-UX-2026-10-21
- 状态：已实现（随 PR 落地）
- 变更类型：🎨 UI/UX 变更（组件替换 + 样式重做），不改变业务语义
- 影响面：`apps/desktop/src/features/accounts/components/AccountLoginDialog.vue` 的「平台」字段
- 触发来源：用户反馈——「添加账号时弹出的选择平台的浮层，UI 界面非常粗糙，不精致，需要从视觉上优化」

---

## 1. 背景与问题定位

### 1.1 现象

账号管理页点「+ 添加账号」弹出「添加账号」弹窗（360px 宽），其中「平台」字段是一个**原生 `<select>`**。

点击后展开的是**操作系统级下拉列表**（Windows 由 Chromium 交给系统渲染）：

- 列表项是纯文字，无平台图标，15 个平台长得一模一样；
- 高亮是系统蓝（`#0078D4` 一类），与本应用的品牌紫（`#5048E5`）完全脱节；
- 直角、无圆角、无投影，与弹窗卡片不是同一套视觉语言；
- 列表从弹窗里「长」出来盖住弹窗底部按钮，宽度不受控，容易顶出窗口边缘；
- 没有搜索、没有分组，15 个平台平铺一条，用户要靠滚动找。

### 1.2 第一性原因

**不是「样式没写好」，而是「控件选错了」。**

`UiSelect.vue` 的实现是原生 `<select>` + `appearance: none`。`appearance: none` 只能去掉**收起态**的原生外观（箭头、边框），一旦展开，弹出列表由**操作系统/浏览器**绘制，**CSS 完全无法介入**——这是 Web 平台的能力边界，不是本项目的实现缺陷。

因此「把这个下拉框调精致一点」这条路在当前控件形态下**走不通**。要做精致，必须把展开态收回到应用内自绘。

### 1.3 目标

把「平台」字段换成**应用内自绘的平台选择器**：图标、搜索、分组、动效、键盘可达，全部由本应用控制，从而与弹窗其余部分、与全站设计令牌保持同一套视觉语言。

### 1.4 不做什么（明确排除）

- **不改业务语义**：选中的平台 id 如何流转、`addAccount()` 的登录流程、扫码能力判定，全部不动。
- **不改 `UiSelect` 组件本身**：它有 15 处调用方（含视频创作面板的运营后台隐藏守卫契约），替换它属于跨模块重构，不在本次范围。本次新增专用组件，只在「添加账号」一处接线。
- **不改 `Accounts.vue`**：该文件是 `check-max-lines` 的点名还账文件（天花板 1578 行，零增长容差意图），新增一行都是负债。分组信息由选择器自己从 `usePlatformStore()` 读，视图层零改动。
- **不做深色主题专项打磨**：沿用 `tokens.css` 的 `[data-theme="dark"]` 重定义，浅色下写对的颜色在暗色下自动跟随；不额外写暗色分支。
- **不做平台多选**：本字段语义是「选一个平台去登录」，不是「勾选发布目标」（那是发布页 `PublishTargetSelector` 的职责）。
- **不引入新依赖**：图标复用现成的 `PlatformIcon.vue`（已接 15 个平台 SVG），图标资源不新增。

---

## 2. 功能逻辑

### 2.1 数据来源与真源

| 数据 | 真源 | 本组件如何取 |
|------|------|--------------|
| 平台 id / 显示名 | `usePlatformStore().platforms`（IPC → `config/platforms.yaml`），由 `Accounts.vue` 以 `platforms` prop 传入 | prop `platforms: [{ id, label }]` |
| 平台图标 | `apps/desktop/src/assets/platforms/*.svg`（`usePlatformIconUrl.js` 静态导入） | `PlatformIcon.vue`（无 SVG 时回退为品牌色首字块） |
| 国内 / 海外分组 | `config/platforms.yaml` 的 `category` 字段 | `usePlatformStore().getCategoryGroup(id)`（新增，见 §2.2） |
| 分组显示名 | locale | prop `groupLabels: { domestic, international }`，由 `AccountLoginDialog` 注入 `t()` 结果 |

### 2.2 新增 store 访问器

`apps/desktop/src/stores/platforms.js` 新增：

```js
/**
 * 平台分组键：'domestic'（国内） | 'international'（海外）。
 * 分类真源仍是 config/platforms.yaml 的 category 字段（中文/海外），
 * 这里只把它翻成**非本地化的结构键**，让 UI 层不必在代码里写中文字面量。
 */
function getCategoryGroup (id) {
  return getCategory(id) === '海外' ? 'international' : 'domestic'
}
```

**为什么要这一层而不是直接用 `getCategory()`**：`getCategory()` 返回的是中文值「中文」/「海外」。若 UI 层拿它去比字符串，就得在 `.vue` 的 `<script>` 里写中文字面量——本仓 `check-locale-sync.js --cjk` 门禁会把渲染端硬编码中文判红（基线只降不升，新增即失败）。改成结构键后，**中文字面量只留在 store 与 locale 两处**，UI 层拿到的是 `domestic` / `international` 这样的 ASCII 键。

分组口径与发布页 `usePublishPlatformCatalog.js` 完全一致（同为 `getCategory(id) === '海外'` 判海外），避免「同一个平台在两个页面被归到不同组」。

### 2.3 搜索匹配规则

对每个平台，`label` 与 `id` 都参与匹配，**大小写不敏感的子串匹配**：

| 输入 | 命中 | 说明 |
|------|------|------|
| `抖` | 抖音 | 中文名子串 |
| `dou` | 抖音 | id `douyin` 子串 |
| `XiaoHongShu` | 小红书 | id `xiaohongshu` 子串，且大小写不敏感（显示名里没有这段字母，命中即证明走的是 id 匹配） |
| `YOUTUBE` | YouTube | id `youtube` 子串（全大写也命中） |
| `知乎` | 知乎 | 中文名子串 |
| ` `（仅空格） | 全部 | 空格不参与匹配，不应过滤掉任何平台 |

匹配规则统一为：`needle = keyword.trim().toLowerCase()`，命中条件为 `label.toLowerCase().includes(needle) || id.toLowerCase().includes(needle)`。`trim()` 保证纯空格输入等价于空输入（显示全部），这是「用户随手打了个空格结果列表全没了」这类事故的防线。

**不做**：拼音首字母匹配（`xhs` ↔ 小红书）。本仓没有拼音库，引入需要新依赖；`id` 子串已覆盖「知道英文名」的用户。注意 `xhs` **不是** `xiaohongshu` 的子串，搜 `xhs` 搜不到小红书——这是本次明确接受的边界，不做隐藏兜底。

### 2.4 分组与排序

1. 先按 §2.3 过滤，得到候选平台集合；
2. 再按 `getCategoryGroup(id)` 分成 `domestic` / `international` 两组；
3. **组内顺序 = 传入顺序**（即 `config/platforms.yaml` 的配置顺序），不重排、不按字母排序——配置顺序本身就是产品想让人看到的优先级；
4. **组间顺序 = domestic 在前、international 在后**（与发布页一致）；
5. 某组为空则**整组不渲染**（不出现空标题）；
6. 搜索过滤后若一组变空，同样整组不渲染。

### 2.5 选中与提交

- 选中某平台 → `emit('update:modelValue', id)` → 浮层关闭 → 焦点回到触发器；
- 触发器收起态显示**已选平台的图标 + 平台名**（不再是空占位），让用户随时能确认「我现在选的是哪个」；
- 未选时显示占位文案，**占位文案颜色比已选文案更浅**（`--color-text-muted` vs `--color-text-primary`），两者不靠字号区分；
- 选中项在浮层列表里带**勾选标记**并高亮，滚动/搜索后仍能一眼认出当前选中项。

### 2.6 数据校验

| 校验点 | 规则 | 失败时的行为 |
|--------|------|--------------|
| 平台 id 合法性 | 选中项必须来自 `platforms` prop | 不存在则忽略该次选择，不 emit（防止脏 id 流进 `addAccount()`） |
| 空列表 | `platforms` 为空数组 | 浮层仍可打开，但列表区显示「暂无可选平台」空态；触发器保持可点 |
| 重复 id | prop 里出现重复 id | 以**首次出现**为准，后续重复项跳过（避免 key 重复与列表重影） |
| 缺失 label | `label` 为空 | 回退显示平台 `id`（`platforms` 的 `id` 是稳定标识，不会出现空白项） |
| modelValue 不在候选内 | 外部传入了一个不存在的平台 | 触发器仍显示该 id（不吞掉外部状态），但列表里没有对应勾选项 |

---

## 3. 交互逻辑

### 3.1 状态机

```
        点击触发器 / Enter / Space / ArrowDown
关闭态 ───────────────────────────────────────► 打开态
  ▲                                              │
  │  Esc / 选中 / 点击外部 / Tab / 弹窗关闭        │
  └──────────────────────────────────────────────┘
```

浮层打开时：**自动聚焦搜索框**（用户的第一意图是「找平台」而不是「用方向键翻」）。

### 3.2 键盘可达（ARIA 1.2 combobox + listbox 模式）

| 位置 | 按键 | 行为 |
|------|------|------|
| 触发器 | `Enter` / `Space` | 打开浮层 |
| 触发器 | `ArrowDown` | 打开浮层，激活**第一项** |
| 触发器 | `ArrowUp` | 打开浮层，激活**最后一项** |
| 触发器 | `Esc` | 无（未打开时不消费） |
| 搜索框 | `ArrowDown` | 激活项下移一项（到末尾不循环） |
| 搜索框 | `ArrowUp` | 激活项上移一项（到首位不循环） |
| 搜索框 | `Home` / `End` | 激活第一项 / 最后一项 |
| 搜索框 | `Enter` | 选中当前激活项（无激活项时不动作） |
| 搜索框 | `Esc` | 关闭浮层，焦点回到触发器 |
| 任意 | `Tab` | 关闭浮层（不阻止正常焦点流转） |

**语义标注**：搜索框 `role="combobox"` + `aria-expanded="true"` + `aria-controls`（指向 listbox）+ `aria-activedescendant`（指向当前激活项）；列表容器 `role="listbox"`；每个选项 `role="option"` + `aria-selected`。触发器是 `role="combobox"` 的宿主按钮，带 `aria-haspopup="listbox"` / `aria-expanded` / `aria-controls`。

### 3.3 定位与避让

浮层 `Teleport` 到 `body`（**必须**）：`UiModal` 的 `.ui-modal` 是 `overflow: hidden`、`.ui-modal-body` 是 `overflow-y: auto`，留在弹窗内必然被裁掉。

- 宽度 = `max(触发器宽度, 320px)`，与触发器左边缘对齐；
- 下方空间不足时**向上翻转**（贴在触发器上方）；
- 最大高度 = `min(320px, 可用空间)`，超出部分列表内部滚动（搜索框与分组标题不随之滚走）；
- 浮层打开期间监听 `resize` / `scroll`，重新计算位置（弹窗内容滚动时浮层不会错位）。

### 3.4 关闭时机

- 选中平台；
- `Esc`；
- 点击浮层外部（`pointerdown` 判定，避免「点选项的同时浮层已关」的竞态）；
- 浮层打开时宿主弹窗关闭（`AccountLoginDialog` 的 `visible` 变 false 时同步收起）。

### 3.5 鼠标行为

- 悬停某项 → 该项成为「激活项」（键盘高亮与鼠标高亮同一套状态，不会出现两处高亮）；
- 单击选项 → 选中并关闭；
- 点击搜索框的清除按钮 → 清空关键词，焦点留在搜索框。

---

## 4. 显示项（视觉规格）

### 4.1 触发器（收起态）

| 部位 | 规格 |
|------|------|
| 容器 | 高 40px，圆角 `var(--radius-md)`(12px)，1px 边框 `var(--color-border)`，底色 `var(--color-bg-card)` |
| 悬停 | 边框转 `var(--color-primary)` |
| 聚焦 | `outline: 2px solid var(--color-primary-dark-tint)`，`outline-offset: 2px` |
| 禁用 | 透明度 0.5，禁用光标，底色 `var(--color-bg-inset)` |
| 平台图标 | 24px（`PlatformIcon` 的 `size="sm"`），左侧内边距 10px |
| 文案 | 已选：`--color-text-primary`；未选（占位）：`--color-text-muted` |
| 箭头 | `▾`，`--color-text-muted`；展开时旋转 180°，160ms 过渡 |

### 4.2 浮层（展开态）

| 部位 | 规格 |
|------|------|
| 容器 | 圆角 `var(--radius-lg)`(16px)，1px 边框 `var(--color-border)`，投影 `var(--shadow-lg)`，底色 `var(--color-bg-card)` |
| 进入动效 | 透明度 0→1 + 上移 6px→0，160ms `ease-out` |
| 搜索区 | 内边距 10px 12px；输入框高 34px，圆角 `var(--radius-sm)`，底色 `var(--color-bg-inset)`，左侧 14px 搜索图标（muted），右侧清除按钮（仅在有内容时出现） |
| 分组标题 | 12px（`--font-size-xs`），`--color-text-muted`，内边距 6px 8px 4px，字重 600 |
| 选项行 | 高 38px，圆角 `var(--radius-sm)`，左内边距 8px；网格布局 `[24px 图标][1fr 名称][20px 勾选]` |
| 选项悬停 / 激活 | 底色 `var(--color-bg-inset)` |
| 选项已选 | 底色 `color-mix(in srgb, var(--color-primary) 8%, transparent)`，名称用 `var(--color-primary)`，右侧 14px 勾选图标 |
| 空态 | 居中，`--color-text-muted`，12px 文案 |
| 底部提示条 | 1px 上边框 `var(--color-border)`，11px muted 文案，键盘操作提示 |

### 4.3 底部分组名与文案来源

全部走 locale（`apps/desktop/src/locales/accounts-page/zh.js` / `en.js`，**成对提交**）：

| key | 中文 | 英文 |
|-----|------|------|
| `accountsPage.platformPicker.searchPlaceholder` | 搜索平台 | Search platforms |
| `accountsPage.platformPicker.emptyResult` | 未找到匹配的平台 | No matching platform |
| `accountsPage.platformPicker.emptyPlatforms` | 暂无可选平台 | No platforms available |
| `accountsPage.platformPicker.groupDomestic` | 国内平台 | Domestic |
| `accountsPage.platformPicker.groupInternational` | 国际平台 | International |
| `accountsPage.platformPicker.triggerAria` | 选择平台 | Select platform |
| `accountsPage.platformPicker.searchAria` | 按平台名称搜索 | Search platforms by name |
| `accountsPage.platformPicker.clearSearchAria` | 清空搜索 | Clear search |
| `accountsPage.platformPicker.listAria` | 平台列表 | Platform list |
| `accountsPage.platformPicker.optionAria` | 选择平台 {platform} | Select {platform} |
| `accountsPage.platformPicker.hint` | ↑↓ 选择 · Enter 确认 · Esc 关闭 | ↑↓ to move · Enter to select · Esc to close |

> 文案里出现 `{platform}` 的条目走命名插值（`locales/index.js` 的 `toMessageFunctions` 会把含 `{` 的字符串编译成 Message Function，不会泄漏占位符）。

---

## 5. 数据流

```
Accounts.vue
  └─ platformStore.load()                     ← 平台目录真源（IPC → config/platforms.yaml）
  └─ allPlatforms = [{ id, label }]  ─────────► AccountLoginDialog.platforms
                                                  └─ AccountPlatformPicker.platforms
AccountPlatformPicker
  ├─ usePlatformStore().getCategoryGroup(id)   ← 分组（domestic / international）
  ├─ PlatformIcon(platform)                   ← 图标（SVG / 品牌色首字回退）
  └─ emit('update:modelValue', id) ──────────► AccountLoginDialog → Accounts.vue
                                                  └─ newPlatform → addAccount() → openLogin(mode, platform)
```

**闭环校验**：选中值最终被 `addAccount()` 读取并交给 `accountActions.openLogin(mode, platform)`，主进程据此打开对应平台登录页。选择器只负责**产生正确的 id**，不参与登录流程。

---

## 6. 边界与异常

| 场景 | 表现 |
|------|------|
| 平台目录 IPC 拉取失败 | `usePlatformStore` 回退内置 15 个平台，选择器照常工作（分组回退 `domestic`） |
| 平台数为 0 | 浮层打开显示「暂无可选平台」 |
| 搜索无结果 | 显示「未找到匹配的平台」，同时清空激活项 |
| 窗口高度不足以放下 320px 浮层 | 浮层高度收缩到可用空间，列表内部滚动，不出现「浮层超出屏幕」 |
| 快速连点触发器 | 开/关互斥，浮层不会叠加出两层 |
| 浮层打开时弹窗被关 | 浮层同步关闭，不留孤儿节点 |

---

## 7. 可访问性小结

- 全键盘可达（§3.2），不依赖鼠标；
- ARIA 语义完整（combobox / listbox / option / activedescendant）；
- 焦点管理：打开浮层聚焦搜索框；关闭浮层（含选中、Esc、外部点击）焦点回到触发器；
- 颜色不是唯一信息载体：选中态同时有**勾选图标** + 底色 + 文字色三重表达；
- 焦点环使用仓库统一的 `--color-primary-dark-tint`，不新造焦点色。

---

## 8. 回归保护

| 层级 | 覆盖点 |
|------|--------|
| 组件单测 `AccountPlatformPicker.test.js` | 展开/收起、搜索过滤（中英文 + 大小写 + 纯空格）、分组渲染、选中 emit、空态、键盘（上下/Enter/Esc/Home/End）、焦点回收、重复 id 去重、缺失 label 回退 |
| 现有单测 `AccountLoginDialog.test.js` | 接线后弹窗仍能选平台并提交；扫码能力判定不受影响 |
| 视觉回归 `all-workflows.visual.test.js` | 「打开添加账号弹窗 → 展开平台选择器」整段交互截图，锁住浮层形态 |

---

## 9. 变更影响面清单

| 文件 | 变更 |
|------|------|
| `apps/desktop/src/features/accounts/components/AccountPlatformPicker.vue` | **新增**：自绘平台选择器 |
| `apps/desktop/src/features/accounts/components/AccountPlatformPicker.test.js` | **新增**：组件单测 |
| `apps/desktop/src/features/accounts/components/AccountLoginDialog.vue` | 「平台」字段由 `UiSelect` 换成 `AccountPlatformPicker` |
| `apps/desktop/src/stores/platforms.js` | 新增 `getCategoryGroup(id)` 访问器 |
| `apps/desktop/src/stores/platforms.test.js` | 新增 `getCategoryGroup` 用例 |
| `apps/desktop/src/locales/accounts-page/zh.js` / `en.js` | 新增 12 条成对文案 |
| `apps/desktop/tests/visual-testing/workflows/all-workflows.visual.test.js` | 新增视觉回归工作流 |
| `01-docs/UI-INVENTORY.md` | 同步组件清单 |
| `CHANGELOG.md` | 变更收口 |
| `openspec/records/platform-picker-ux.md` | 执行记录（QM-5 ①~⑤） |
