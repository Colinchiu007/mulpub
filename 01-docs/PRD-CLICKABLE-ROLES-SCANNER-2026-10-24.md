# PRD — 键盘可达性合同的扫描器盲区修复（clickable-roles-scanner，2026-10-24）

> 状态：已实现（本文件与实现同 PR 落地）
> 判据载体：`apps/desktop/src/clickable-roles.contract.test.js`
> 分支：`fix-clickable-roles-scanner-blindspots`

---

## 1. 问题：判据自己瞎了，读数却像全绿

`apps/desktop/src/clickable-roles.contract.test.js` 是「非 button 可点击元素的键盘可达性」合同
（WCAG 2.1.1 Keyboard）。它靠**扫描 `.vue` 模板**清点站点，再对每个站点断言
`role="button"` + `tabindex="0"` + 键盘处理齐备。

问题在于：**扫描器有两处结构性盲区，扫描域被悄悄截断**——不是"没扫到某个站点"，
而是"**根本不知道后半段还有站点**"。于是：

- 缺口读数偏小 ⇒ "仍缺=13" 看起来像"只欠 13 个"；
- 台账棘轮（只能缩小）在一个**更小的真源域**上生效 ⇒ 越修越假绿。

实测（`main` @ deac589，扫描域 = `apps/desktop/src` 全部 199 个 `.vue`）：

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 扫描器看见的站点数 | **31** | **76** |
| 旧扫描器的覆盖率 | **41%**（31/76） | 100%（逐文件核对扫描窗口 = 根 template 全文） |
| 扫描域被截断的 `.vue` 文件 | **56 / 199（28.1%）** | 0 |
| 根 template 内含嵌套 `<template>` 的文件 | 56 | —（这 56 个正是被截断的那些） |
| 欠账台账条目 | 13 | 31（+18，见 §5） |

用户先前报的数字是"52/192 个 `.vue` 的扫描域被截断"——方向与量级一致；
本次在**更新的 main**（`#4391` 之后，域多 7 个文件）上复测为 **56/199**。

---

## 2. 三处盲区的根因

### 盲区 A：多行开始标签 ⇒ 整元素隐形

标签匹配是**按行**做的：

```js
const tagRe = /<([A-Za-z][\w.-]*)(?=[\s/>])/g   // 逐行 exec
```

那个先行断言 `(?=[\s/>])` 要求标签名之后**同一行内**还有字符。
而只写 `<div`（属性换行，Prettier 对长标签的默认排版）时，该行后面**没有字符** ⇒
先行断言失败 ⇒ **这个元素对扫描器完全不存在**。

实测：扫描域里 **159/199** 个文件存在"标签名独占一行"的开始标签形态。

### 盲区 B：模板边界按第一个 `</template>` 截断

```js
const tplEnd = lines.findIndex((l) => l.includes('</template>'))
```

取的是**第一个** `</template>`。但 Vue SFC 内部有嵌套 `<template>`（`#slot` / `v-slot`），
它的闭合标签**排在根 template 闭合之前** ⇒ 扫描窗口在嵌套 template 处被截断，
**根 template 的后半段从未被扫过**。56 个文件命中（实测每个文件都含嵌套 `<template>`）。

### 盲区 C：同名闭合标签不配平（本次顺带发现并修）

取"元素正文"时取的是**第一个同名闭合标签**。同名嵌套元素会让正文被提前截断 ⇒
可见可聚焦后代漏数 ⇒「`role="button"` 不得含可见可聚焦后代」这条**硬判据失明**：
`ProjectCard.vue` 的卡片里有可见的「删除」`<button>`，旧扫描器数到 `nestedVisible=0`。

> C 不在用户报的两处之内，但它是**同一函数里的第三个静默失效点**，
> 且会让本次要重新锚定的硬判据继续假绿 ⇒ 一并修。

---

## 3. 修法：顺序分词器 + 嵌套配平

| 盲区 | 旧做法 | 新做法 |
|------|--------|--------|
| A | 逐行正则匹配标签名 | **全文顺序分词**：粘性正则定位标签，标签名后的先行断言看的是**真实下一个字符**（可能是换行）；每个开始标签**整体消费**（引号感知的属性值不会被重扫成标签） |
| B | 第一个 `</template>` | **按 `<template>` 嵌套配平**求根 template 的正文范围（`rootTemplateRange`） |
| C | 第一个同名闭合标签 | **按同名标签配平**求元素正文范围（`matchingClose`） |

判据侧同时补了三件**不靠写死数字**的硬约束：

1. **逐文件域完整性**：每个 `.vue` 的"扫了多少字符"必须等于"根 template 有多少字符"
   ⇒ 任何提前截断当场红（不依赖"站点数 ≥ N"这类会漂的阈值）。
2. **夹具级反盲区断言**（3 条）：多行开始标签 / 嵌套 `<template>` 之后的元素 / 同名嵌套元素的可聚焦后代，
   各自用一段内联夹具锁住。
3. **不可清账名单**：`role-leaf` 欠账（3 条）与"键盘处理非逐字镜像"豁免（1 条）各有界、只能缩小，
   各自带"陈旧条目"检查（站点被修好 ⇒ 必须同步删条目）。

---

## 4. 新暴露站点的处置（45 个新可见站点）

新暴露 45 个站点（42 个新键），逐类处置如下。**处置原则沿用合同原有的三条不变量**：
能靠"加属性"修的就修；不能加属性的（复合卡片 / 遮罩 / 上传区）**带原因登记**；
带可见可聚焦后代的**绝不**加 `role="button"`（leaf 角色会把内层按钮从 a11y 树抹掉，比原状更差）。

### 4.1 直接修好（14 个）

补 `role="button" tabindex="0"` + `@keydown.enter.prevent` + `@keydown.space.prevent`，
表达式与 `@click` **逐字镜像**（合同要求）。均为**无可见可聚焦后代**的叶子站点：

| 文件 | 站点 | 说明 |
|------|------|------|
| `views/Home.vue` | 6 个 `.mp-home-shortcut` | 快捷入口卡（图标 + 文字，文字即无障碍名） |
| `views/Collection.vue` | 6 个 `.cohere-stat-card` | 快捷操作卡（新建/草稿/素材来源） |
| `views/FilmEngineeringView.vue` | 1 个 `.fe-shot-body` | 镜头正文区（与同级 checkbox/复制按钮**平级**，非后代） |
| `components/TagSuggester.vue` | 1 个平台汇总标签 | 与同文件另外 4 处同款标签的形态对齐（那 4 处本就齐备，这一处漏了） |

### 4.2 补齐缺失的键盘处理（5 个）

已有 `role="button" tabindex="0"`，但**只认 Enter 不认 Space**（WCAG 2.1.1 的部分失败）：

`components/PipelineBrowser.vue`、`views/CreateHistory.vue`（2 处）、`views/Home.vue`（英雄卡）、
`views/video-creation/PipelineSelector.vue`。

另 1 处是**根本没有 Space**（`views/video-creation/SceneAssetSelection.vue` 的媒体预览），
连同补齐。

### 4.3 撤掉有害的 `role="button"`（2 个）

| 文件 | 处理 | 理由 |
|------|------|------|
| `views/Collection.vue` 采集正文卡 | 撤 `role="button" tabindex="0"` + `@keyup.enter` | 卡内有 **7 个可见操作按钮**（改写/创建草稿/编辑/转视频/发布/删除 + 标签编辑）⇒ `role="button"` 会把它们全部呈现为 presentational。而「编辑」按钮与卡面 `@click` 是**同一动作** ⇒ 键盘路径本就存在，撤掉卡面的 role 不丢功能 |
| `views/CreateHistory.vue` 成片卡 | 撤 `tabindex="0" role="button"` + `@keydown.enter` | 卡内「预览」`UiButton` 与卡面 `@click` 是**同一 router.push** ⇒ 同上 |

撤完这两处，卡面变成"鼠标便利区"（键盘路径在卡内真按钮上），
按合同原有形态**带原因登记**（不假装它不是缺口）。

### 4.4 带原因登记（18 条新欠账）

| 类别 | 数量 | 键 |
|------|------|---|
| 浮层遮罩"点击空白处关闭" | 6 | `PublishDestinationModal` / `UiModal` / `PublishTypeDialog` / `Collection`(预览遮罩) / `PublishHistory`(详情遮罩) / `ViralAnalysis`(爆款库遮罩) |
| 上传区（内有可见「移除」按钮） | 5 | `QuickRenderMaterials.vue` 的首帧/参考图/参考视频/参考音频/图库 |
| 复合卡片（内有可见按钮） | 3 | `CreatorMonitor` 列表项 / `PublishHistory` 记录卡 / `ResultSegmentCard` 素材槽 |
| 鼠标便利区（卡内已有等价按钮） | 2 | `Collection` 采集正文卡 / `CreateHistory` 成片卡 |
| 卡片信息区（卡内已有等价按钮） | 1 | `CollectedResultsList` 的 `card-icon` / `card-info`（同一键对应 2 处） |
| 条件绑定 role（扫描器不认动态取值） | 1 | `CreateViewHistory` 历史条目 |

### 4.5 存量 `role-leaf` 缺陷（3 条，单列可清账名单）

这三处是**主线已存在**的缺陷（不是本次引入）：卡片容器挂 `role="button"`，
而卡内还有可见真 `<button>`（删除 / 收藏+勾选 / 播客入口）⇒ 内层按钮被 leaf 角色
呈现为 presentational，**读屏用户摸不到**。

正解是结构改造（把卡片主动作提为卡内真 `<button>`、卡面去 role），
会动 DOM + CSS + 焦点环落点 ⇒ 与"修扫描器盲区"分成两个 PR。
本次**保持行为不变**，但把它们**显性化**为可清账名单（名单只能缩小），
而不是继续让扫描器看不见。

### 4.6 widget 角色不算缺口（2 处）

`PublishDestinationConfigPicker.vue` 的两个 `li role="option"`：父级是 `ul role="listbox"`
且带 `@keydown` 方向键处理 ⇒ 它们的键盘契约由**容器**承担（roving tabindex），
不是"缺 `role=button`"。判据新增 `WIDGET_ROLES` 白名单把它们排除出缺口集，
但**必须在统计里显式可见**（新增断言：反"扫描器看不见就当它不存在"）。

---

## 5. 判据本身的变化（必须显式说明，不能悄悄改）

| 变化 | 从 | 到 | 为什么 |
|------|----|----|--------|
| 台账条目数上界 | 13 | **31** | 扫描域修好后暴露 18 条新欠账（§4.4）。上界**重锚**一次，之后继续"只能缩小"。理由写在台账注释里，**不装作是"没欠账"** |
| 台账规模断言 | `LEDGER.length <= 13` | `<= 31` | 同上（重锚，不是放松） |
| 键处理豁免名单 | 无 | 1 条 | `AccountManagementCard` 的键盘处理是 `@click` 的**守卫包装**（`onCardActivate` 挡掉卡内 checkbox 的回车冒泡）。逐字镜像会造成行为回归（点击卡片正文也会被守卫拦掉）⇒ 显式登记，名单只能缩小 |
| 动态 role 绑定 | 无断言 | 必须登记 | `:role="expr"` 的运行期取值扫描器无从得知 ⇒ 静态判据不认它，必须靠人认账 |
| widget 角色 | 计入缺口 | 排除但计数 | 键盘契约由容器承担 |

---

## 6. 边界：本次不做 / 做不到什么

- **不做**三处 `role-leaf` 卡片的结构改造（DOM + CSS + 焦点环），见 §4.5。
- **不做**上传区"把「选择文件」提为区内真 `<button>`"的结构改造（5 处），见 §4.4。
- **不做** `CreatorMonitor` / `PublishHistory` / `ResultSegmentCard` 三处复合卡片的结构改造。
- 上述 9 项全部**带原因登记在册**（可清账名单 + 台账），不假装已闭合。
- 扫描器**不解析 JS**：动态 `:role`、`:tabindex` 的运行期值仍然看不见 ⇒ 只能靠登记兜住。

---

## 7. 验收

1. `apps/desktop/src/clickable-roles.contract.test.js` 全绿（16 条断言）。
2. 逐文件核对：199 个 `.vue` 的扫描窗口 = 根 template 全文（域完整性断言兜住）。
3. 三条夹具级反盲区断言全绿（多行标签 / 嵌套 template / 同名配平）。
4. 台账"未登记=0 / 陈旧=0"；两份可清账名单"无陈旧条目"。
5. 仓内行数门禁（`check-max-lines`）与债务预算（`check-debt-budget`）不红：
   `FilmEngineeringView.vue` 读数 803（登记 605 ⇒ 上限 805，**余 2 行**）、
   `Home.vue` 452（< 500，不进 `>=500` 计数）、`Collection.vue` 2669（target 2920）、
   `CreateHistory.vue` 302、`SceneAssetSelection.vue` 431、`TagSuggester.vue` 452、
   合同测试文件 548（测试文件上限 1500）。
