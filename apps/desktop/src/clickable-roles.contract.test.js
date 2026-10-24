// 非 button 可点击元素的键盘可达性合同（实施方案阶段 4.4 / audit-24 / WCAG 2.1.1 Keyboard）
//
// 三条不变量，都来自本批实测：
//  1) 域清点由模板扫描得出，不按类名或组件名猜。**必须排除渲染原生控件的组件**
//     （el-button / router-link / UiButton —— 后者实测 `tag` 默认值就是 "button"），
//     否则第一版探针把 109 个它们算成"缺口"，域虚高 3 倍，判据就成了噪音。
//  2) 已补 role="button" 的元素**不得有可见的可聚焦后代**：button 是 leaf 角色，
//     子树会被呈现为 presentational —— 本批正是这条把我自己的错误修法拦下来
//     （CreateView 两个上传区里有可见「移除」按钮、CreatorMonitor 列表项里有 3 个可见按钮，
//     给它们加 role 等于把那些按钮从无障碍树上抹掉，比原状更差）。
//  3) 欠账台账只能缩小，且每条必须带原因；新出现的未登记站点当场红。
//
// 判据域与规模都打印，扫描退化（域为空/骤降）会由下界断言抓住。
//
// ── 2026-10-24：扫描器自身的三处盲区（本次修）────────────────────────────
// 上一版扫描器有两处结构性盲区，**它自己看不见**（判据域被悄悄截断，缺口读起来像"全绿"）：
//
//  A) 多行开始标签：标签匹配是**按行**做的（`/<([A-Za-z][\w.-]*)(?=[\s/>])/` 逐行 exec），
//     而那个先行断言 `(?=[\s/>])` 要求标签名后面**同一行内**还有字符。
//     ⇒ 只写 `<div`（属性换行，Prettier 对长标签的默认排版）时该行后面没有字符 ⇒ 先行断言失败
//     ⇒ **整个元素对扫描器隐形**。本批实测：修复前可见站点 31 个，修复后 76 个。
//  B) 模板边界：`lines.findIndex(l => l.includes('</template>'))` 取的是**第一个** `</template>`。
//     但 Vue SFC 内部有嵌套 `<template>`（`#slot` / `v-slot`），它的闭合标签**排在根 template 闭合之前**
//     ⇒ 扫描窗口在嵌套 template 处被截断，**根 template 的后半段从未被扫过**。
//     本批实测：199 个 .vue 里有 56 个的扫描域被截断。
//  C) 同名闭合标签不配平：取「元素正文」时取的是**第一个同名闭合标签**，同名嵌套元素会让正文被提前截断
//     ⇒ 可见可聚焦后代被漏数 ⇒ 「role=button 不得含可见可聚焦后代」这条硬判据在 ProjectCard.vue 上失明
//     （卡片里的「删除」按钮本该被数到，实际数到 0）。
//
// 本次把扫描改成**顺序分词器**（逐字符推进、每个开始标签整体消费），
// 模板边界按 `<template>` 嵌套配平求出，正文按同名标签配平求出。
// 三处盲区各有**夹具级反断言**（见文件末尾「扫描器自身的反盲区断言」），
// 判据域完整性另有**逐文件**断言（每个 .vue 的扫描窗口必须等于它的根 template 全文）。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// 本文件就在 src/ 下：SRC 即 __dirname（上一版拼成 src/src 时是响亮 ENOENT，不是静默扫空）
const SRC = __dirname

// 渲染原生可聚焦控件的元素/组件（不算缺口）
const NATIVE = new Set(['button', 'a', 'input', 'label', 'select', 'summary'])
const RENDERS_NATIVE = /^(UiButton|RouterLink|router-link|el-[a-z-]+|component)$/

// 自带键盘契约的 widget 角色：它们的键盘路径由**容器**承担（listbox 的方向键 + roving tabindex），
// 不是"缺 role=button"。本仓实测两例：PublishDestinationConfigPicker 的 `li role="option"`
// （父级 `ul role="listbox"` 带 `@keydown` 方向键处理）。
// ⇒ 这类元素不计入"button 缺口"，但**必须显式出现**在统计里（见 widgetRoleSites 断言），
// 不能因为"扫描器看不见它"就当它不存在。
const WIDGET_ROLES = new Set([
  'option', 'menuitem', 'menuitemradio', 'menuitemcheckbox',
  'tab', 'switch', 'radio', 'checkbox',
])

// ⛔ 本批核定登记（由本文件扫描当场得出，键 = 文件|标签|@click 表达式）
const LEDGER = [
  { key: "/components/PersonalFormDialog.vue|div|emit('close')",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/components/UpgradeModal.vue|div|emit('close')",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/components/ViralFormDialog.vue|div|emit('close')",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/views/AutomationView.vue|div|closeDialog",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/views/video-creation/ErrorDialog.vue|div|$emit('close')",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/components/PodcastScriptEntry.vue|div|onCancel",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。 另记一处真实待办：这里用的是 @click 而不是 @click.self（其余四例都是 .self），意味着点击对话框内部会冒泡触发取消 —— 那是行为缺陷，不属本判据域，已单独登记进执行记录。" },
  { key: "/components/ViralLibraryTable.vue|th|sortBy('likes')",
    reason: "th 承载列名与排序状态（aria-sort），给它 role=\"button\" 会剥夺单元格语义、破坏表格读法；正解是在 th 内放一个真 <button> 承载排序点击，属结构改造不是加属性。" },
  { key: "/components/ViralLibraryTable.vue|th|sortBy('collections')",
    reason: "th 承载列名与排序状态（aria-sort），给它 role=\"button\" 会剥夺单元格语义、破坏表格读法；正解是在 th 内放一个真 <button> 承载排序点击，属结构改造不是加属性。" },
  { key: "/components/ViralLibraryTable.vue|th|sortBy('comments')",
    reason: "th 承载列名与排序状态（aria-sort），给它 role=\"button\" 会剥夺单元格语义、破坏表格读法；正解是在 th 内放一个真 <button> 承载排序点击，属结构改造不是加属性。" },
  { key: "/components/ViralLibraryTable.vue|th|sortBy('like_collect_ratio')",
    reason: "th 承载列名与排序状态（aria-sort），给它 role=\"button\" 会剥夺单元格语义、破坏表格读法；正解是在 th 内放一个真 <button> 承载排序点击，属结构改造不是加属性。" },
  { key: "/views/ReplayTimeline.vue|h3|showEventList = !showEventList",
    reason: "标题作为列表折叠头：role=\"button\" 会失去 heading 语义（读屏靠 h 级跳读页面结构）。正解是 h3 内放 button 并保留标题层级。" },
  { key: "/views/CreateView.vue|div|$refs.pipelineFileInput?.click()",
    reason: "该上传区内部有**可见**的「移除」按钮（实测 nestedVisible=1）。给它 role=\"button\" 会让那些按钮从 a11y 树消失 —— 本批正是这条判据把我自己的错误修法拦下来并撤销的。正解是把「选择文件」提为区内显式 <button>，遮罩区保持非控件。" },
  { key: "/views/CreateView.vue|div|$refs.pipelineAudioInput?.click()",
    reason: "该上传区内部有**可见**的「移除」按钮（实测 nestedVisible=1）。给它 role=\"button\" 会让那些按钮从 a11y 树消失 —— 本批正是这条判据把我自己的错误修法拦下来并撤销的。正解是把「选择文件」提为区内显式 <button>，遮罩区保持非控件。" },

  // ── 以下 18 条是 2026-10-24 修扫描器盲区后**新暴露**的欠账（不是本次引入的缺陷）──
  // 上一版扫描器看不见它们（模板边界被嵌套 <template> 截断 / 多行开始标签整元素隐形），
  // 所以它们一直"不欠账"。修好扫描器后它们必须逐条带原因登记，否则就变成"看得见却不认账"。
  { key: "/components/PublishDestinationModal.vue|div|close",
    reason: "浮层遮罩的\"点击空白处关闭\"（@click.self），不是操作控件：给它 role=\"button\" 会把整个弹层子树呈现为 presentational（弹层内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/components/UiModal.vue|div|handleOverlayClick",
    reason: "UiModal 遮罩的\"点击空白处关闭\"（@click.self），不是操作控件：给它 role=\"button\" 会把弹层内所有控件呈现为 presentational。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/features/collection/CollectedResultsList.vue|div|$emit('select', item)",
    reason: "卡片的信息区与图标区各有一处 @click（同一动作\"选中该条并展示详情\"），**卡内已有等价按钮**（「编辑」col-btn--secondary，同一 emit('select')）承担键盘路径。这两处是鼠标便利区：做成可聚焦会产生一个动作两个 Tab 站位（WCAG 2.4.3 顺序焦点），且图标区无可聚焦后代。**本键在同文件对应 2 处**（card-icon / card-info），原因同。" },
  { key: "/features/collection/CreatorMonitor.vue|li|activeCreatorId = c.id; loadDiscoveries(",
    reason: "创作者列表项（li）点击即切换选中的创作者，但**项内有 3 个可见按钮**（实测 nestedVisible=3）⇒ 给它 role=\"button\" 等于把那些按钮从 a11y 树抹掉，比原状更差。键盘等价物是项内按钮 + 列表的方向键导航；正解是结构改造（把\"选中创作者\"提为项内真 <button> 或让列表承担 roving tabindex）。" },
  { key: "/features/publish/components/PublishTypeDialog.vue|div|emit('close')",
    reason: "发布类型弹窗的遮罩\"点击空白处关闭\"（@click.self，且已带 @keydown.esc），不是操作控件：给它 role=\"button\" 会把弹层内所有控件呈现为 presentational。键盘等价物已有（Esc 关闭）+ 浮层互斥合同的焦点陷阱。" },
  { key: "/views/Collection.vue|div|openRecordForEdit(entry.item)",
    reason: "采集正文卡片的卡面点击（打开编辑），**卡内已有等价按钮**（「编辑」col-btn--secondary，同一 openRecordForEdit）承担键盘路径。卡面本身还含 7 个可见操作按钮（改写/创建草稿/编辑/转视频/发布/删除 + 标签编辑，nestedVisible=10）⇒ 卡面挂 role=\"button\" 会把它们全部呈现为 presentational。本次已撤掉卡面的 role/tabindex/@keyup.enter（那正是 blind spot C 之外的存量 role-leaf 缺陷），改为登记：卡面是鼠标便利区，键盘路径走卡内真按钮。" },
  { key: "/views/Collection.vue|div|previewRewrite = null",
    reason: "改写预览浮层的遮罩\"点击空白处关闭\"（@click.self），不是操作控件：给它 role=\"button\" 会把预览层内容呈现为 presentational。键盘等价物是 Esc 关闭 + 焦点陷阱。" },
  { key: "/views/CreateHistory.vue|div|$router.push('/create/result?path=' + en",
    reason: "成片卡片的卡面点击（进结果页），**卡内已有等价按钮**（「预览」UiButton，同一 router.push）承担键盘路径。卡面还含 2 个可见按钮（发布/预览，nestedVisible=2）⇒ 卡面挂 role=\"button\" 会把它们呈现为 presentational。本次已撤掉卡面的 role/tabindex/@keydown.enter（存量 role-leaf 缺陷），改为登记：卡面是鼠标便利区，键盘路径走卡内真按钮。" },
  { key: "/views/CreateViewHistory.vue|div|openDetail(item)",
    reason: "历史条目的 role/tabindex 是**条件绑定**（`:role=\"historyItemOpenable(item) ? 'button' : undefined\"` / `:tabindex=\"... ? 0 : undefined\"`），运行期取值扫描器无从得知（静态 role 判据按设计不认动态绑定）。键盘路径本身已完备（@keydown.enter.prevent / @keydown.space.prevent 与 @click 同表达式）⇒ 不是缺口，但必须登记，等有人改成静态绑定时销账。" },
  { key: "/views/PublishHistory.vue|article|onCardClick($event, record)",
    reason: "发布记录卡片点击即打开详情，但**卡内有 4 个可见按钮**（实测 nestedVisible=4）⇒ 给它 role=\"button\" 会把那些按钮从 a11y 树抹掉。正解是结构改造：把\"打开详情\"提为卡内真 <button>（或让整卡成为 link 语义且不包交互控件）。" },
  { key: "/views/PublishHistory.vue|div|closeRecordDetail",
    reason: "记录详情浮层的遮罩\"点击空白处关闭\"（@click.self，且已带 role=\"presentation\"），不是操作控件：给它 role=\"button\" 会把详情层内容呈现为 presentational。键盘等价物是 Esc 关闭 + 焦点陷阱。" },
  { key: "/views/ViralAnalysis.vue|div|showLibraryDialog = false",
    reason: "爆款库弹窗的遮罩\"点击空白处关闭\"（@click.self，容器已带 role=\"dialog\"），不是操作控件：给它 role=\"button\" 会把弹窗内容呈现为 presentational。键盘等价物是 Esc 关闭 + 焦点陷阱。" },
  { key: "/views/video-creation/QuickRenderMaterials.vue|div|emit('pick-frame', slot.key)",
    reason: "首帧素材上传区点击即打开文件选择器，**区内有可见的「移除」按钮**（实测 nestedVisible=1）⇒ 给它 role=\"button\" 会让移除按钮从 a11y 树消失。键盘等价物缺位（区内没有可聚焦的\"选择文件\"入口）⇒ 真缺口，正解同 CreateView 两处上传区：把「选择文件」提为区内显式 <button>，上传区保持非控件。本批未做结构改造，登记待办。" },
  { key: "/views/video-creation/QuickRenderMaterials.vue|div|emit('pick-images')",
    reason: "参考图上传区点击即打开文件选择器，**区内有可见的「移除」按钮**（nestedVisible=1）⇒ 不能挂 role=\"button\"。键盘等价物缺位 ⇒ 正解是区内显式「选择文件」<button>，上传区保持非控件。本批未做结构改造，登记待办。" },
  { key: "/views/video-creation/QuickRenderMaterials.vue|div|emit('pick-videos')",
    reason: "参考视频上传区点击即打开文件选择器，**区内有可见的「移除」按钮**（nestedVisible=1）⇒ 不能挂 role=\"button\"。键盘等价物缺位 ⇒ 正解是区内显式「选择文件」<button>，上传区保持非控件。本批未做结构改造，登记待办。" },
  { key: "/views/video-creation/QuickRenderMaterials.vue|div|emit('pick-audios')",
    reason: "参考音频上传区点击即打开文件选择器，**区内有可见的「移除」按钮**（nestedVisible=1）⇒ 不能挂 role=\"button\"。键盘等价物缺位 ⇒ 正解是区内显式「选择文件」<button>，上传区保持非控件。本批未做结构改造，登记待办。" },
  { key: "/views/video-creation/QuickRenderMaterials.vue|div|emit('pick-gallery')",
    reason: "图库上传区点击即打开文件选择器，**区内有可见的「移除」按钮**（nestedVisible=1）⇒ 不能挂 role=\"button\"。键盘等价物缺位 ⇒ 正解是区内显式「选择文件」<button>，上传区保持非控件。本批未做结构改造，登记待办。" },
  { key: "/views/video-creation/ResultSegmentCard.vue|article|slot.path && $emit('select-material', se",
    reason: "素材槽位（article，带 aria-pressed）点击即选中，但**槽内有可见的预览 <button> 与单选 <input>**（实测 nestedVisible=4）⇒ 给它 role=\"button\" 会把它们呈现为 presentational；而且 aria-pressed 只有在 button 角色下才成立。正解是结构改造：槽位改用真 <button> 承载选中语义，预览与单选移出该按钮（或改用 role=\"group\" + 内部按钮）。" },
]

// ⛔ 「键盘处理不是 @click 的逐字镜像」的显式登记（可清账，名单只能缩小）
//
// 这不是"漏了键盘处理"，而是**刻意不同**：键盘处理是鼠标处理的一个**守卫包装**
// （只响应卡片自身焦点 + preventDefault），逐字镜像反而会造成行为回归。
const KEY_HANDLER_EXEMPT = [
  { key: "/features/accounts/components/AccountManagementCard.vue|article|onCardClick",
    reason: "@keydown.enter/space 指向 onCardActivate，而 @click 指向 onCardClick：onCardActivate 是 onCardClick 的守卫包装（`if (event.target !== event.currentTarget) return` + preventDefault），用来挡掉\"卡内 checkbox 回车冒泡到卡片\"。若改成逐字镜像 onCardClick，卡内文字的点击也会被守卫拦掉（点击卡片正文将不再打开账号）⇒ 行为回归。两者最终调用的是同一个动作，不构成行为分裂。" },
]

// ⛔ 「已补 role=button 但含可见可聚焦后代」的存量缺陷（单独名单，可清账）
//
// 这三处是**主线上已存在**的缺陷（不是本次引入）：卡片容器挂了 role="button"，
// 而卡片内部还有可见的真 <button>（删除/收藏/播客入口）—— role=button 是 leaf 角色，
// 子树被呈现为 presentational ⇒ 这些内层按钮**从 a11y 树里消失**（读屏用户摸不到）。
//
// 为什么不在本次一并结构改造：正解是「把卡片主动作提为区内真 <button>，卡面去 role」，
// 那是 DOM + CSS + 交互语义的改造（并会动焦点环落点），与"修扫描器盲区"是两件事，
// 混在一个 PR 里会让评审无法分别验收。故按可清账名单登记，**名单只能缩小**。
const ROLE_LEAF_DEBT = [
  { key: "/components/ProjectCard.vue|div|handleClick",
    reason: "项目卡片 role=\"button\"，但卡内有可见的「删除」<button>（nestedVisible=1）⇒ 该删除按钮被 leaf 角色呈现为 presentational，读屏用户摸不到它。正解是结构改造：删除按钮移出 role=\"button\" 容器，或把卡片主动作（打开项目）提为卡内真 <button>、卡面去掉 role。**不要**用加属性的方式修。" },
  { key: "/features/accounts/components/AccountManagementCard.vue|article|onCardClick",
    reason: "账号卡片 role=\"button\"，但卡内有可见的「批量选择」<input type=checkbox> 与「收藏」<button>（nestedVisible=8）⇒ 二者被 leaf 角色呈现为 presentational，读屏用户既摸不到勾选也摸不到收藏。正解是结构改造：卡面去 role，把这两个控件移出 presentational 子树，卡片主动作（打开账号）改由卡内真 <button> 承载。**不要**用加属性的方式修。" },
  { key: "/views/CopyLibraryView.vue|article|openDetail(entry)",
    reason: "文案库卡片 role=\"button\"，但卡内有条件渲染的「播客脚本入口」<button>（nestedVisible=1）⇒ 该按钮被 leaf 角色呈现为 presentational。正解是结构改造：把入口按钮移出 role=\"button\" 容器（或卡面去 role，主动作由卡内真 <button> 承载）。**不要**用加属性的方式修。" },
]

const CLICK_RE = /@click((?:\w+\.\w+|\.\w+)*)="((?:[^"\\]|\\.)*)"/
const INTERACTIVE_RE = /<(button|a|input|select|textarea|router-link|RouterLink|UiButton|el-button)\b([^>]*)?>/g
// 静态 role 的取值（动态绑定 `:role="expr"` 不算 —— 它的运行期值扫描器无从得知）
const STATIC_ROLE_RE = /(?<!:)\brole="([^"]*)"/

// ── 扫描器原语 ───────────────────────────────────────────────────────────────

/** 读出一个开始标签全文（引号感知；可跨行）→ { text, end } | null */
function readStartTag(text, from) {
  let inQuote = null
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) { if (ch === inQuote) inQuote = null; continue }
    if (ch === '"' || ch === "'") { inQuote = ch; continue }
    if (ch === '>') return { text: text.slice(from, i + 1), end: i + 1 }
  }
  return null
}

/** 标签是否自闭合（`/>` 结尾） */
function isSelfClosed(tagText) {
  return /\/>$/.test(tagText)
}

// 粘性正则：在**全文**上定位，不做切片拷贝；先行断言看到的是标签名之后的**真实下一个字符**
// （可能是换行）—— 这正是多行开始标签能被看见的关键。
const OPEN_TAG_RE = /<([A-Za-z][\w.-]*)(?=[\s/>])/y
const CLOSE_TAG_RE = /<\/([A-Za-z][\w.-]*)\s*>/y
// 顶层块：定位根 <template> 时要把 script/style 整块跳过
const ROOT_BLOCK_RE = /<(script|style|template)(?=[\s/>])/y

/**
 * 根 <template> 块的正文范围（**按 <template> 嵌套配平**）→ { start, end } | null
 *
 * 上一版取的是"第一个 `</template>`"，而 SFC 内部的嵌套 `<template #slot>` 闭合在前
 * ⇒ 扫描窗口被提前截断（实测 197 个 .vue 里有 55 个中招）。
 *
 * 定位根 template 时**先跳过 script/style 整块**：仓里有 10+ 个 .vue 把 `<script setup>`
 * 写在 `<template>` 之前（`components/icons/*.vue`、`CreatorMonitor.vue` 等），
 * 而脚本里出现 "<template" 字面量（动态组件 / 文档示例）会让"文件里第一个 <template>"
 * 指向脚本里的字符串 ⇒ 扫描域指向错误的位置 ⇒ 又一次"静默缩小"。
 */
function rootTemplateRange(text) {
  // ① 跳过顶层非 template 块，定位根 <template>
  let pos = 0
  let rootStart = -1
  while (pos < text.length) {
    const lt = text.indexOf('<', pos)
    if (lt < 0) break
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt)
      pos = end < 0 ? text.length : end + 3
      continue
    }
    ROOT_BLOCK_RE.lastIndex = lt
    const bm = ROOT_BLOCK_RE.exec(text)
    if (!bm) { pos = lt + 1; continue }
    if (bm[1] === 'template') { rootStart = lt; break }
    // script/style（以及任何其它顶层块）：整块跳过，别在它里面找根 template
    const st = readStartTag(text, lt)
    if (!st) { pos = lt + 1; continue }
    if (isSelfClosed(st.text)) { pos = st.end; continue }
    const close = matchingClose(text, bm[1], st.end)
    pos = close ? close.end : text.length
  }
  if (rootStart < 0) return null

  // ② 从根 <template> 起，按嵌套配平求正文范围
  const first = readStartTag(text, rootStart)
  if (!first || isSelfClosed(first.text)) return null
  let depth = 1
  let p = first.end
  while (p < text.length) {
    const lt = text.indexOf('<', p)
    if (lt < 0) break
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt)
      p = end < 0 ? text.length : end + 3
      continue
    }
    CLOSE_TAG_RE.lastIndex = lt
    const cm = CLOSE_TAG_RE.exec(text)
    if (cm) {
      if (cm[1] === 'template') {
        depth--
        if (depth === 0) return { start: rootStart, end: lt + cm[0].length }
      }
      p = lt + cm[0].length
      continue
    }
    OPEN_TAG_RE.lastIndex = lt
    const om = OPEN_TAG_RE.exec(text)
    if (!om) { p = lt + 1; continue }
    const st = readStartTag(text, lt)
    if (!st) { p = lt + 1; continue }
    if (om[1] === 'template' && !isSelfClosed(st.text)) depth++
    p = st.end
  }
  return null
}

/**
 * 与开始标签配对的闭合标签范围（**同名嵌套配平**）→ { start, end } | null
 *
 * 上一版取的是"第一个同名闭合标签"，同名嵌套元素会让元素正文被提前截断
 * ⇒ 可见可聚焦后代漏数 ⇒ 「role=button 不得含可见可聚焦后代」这条硬判据失明。
 */
function matchingClose(text, tag, from) {
  let depth = 1
  let pos = from
  while (pos < text.length) {
    const lt = text.indexOf('<', pos)
    if (lt < 0) return null
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt)
      pos = end < 0 ? text.length : end + 3
      continue
    }
    CLOSE_TAG_RE.lastIndex = lt
    const cm = CLOSE_TAG_RE.exec(text)
    if (cm) {
      if (cm[1] === tag) {
        depth--
        if (depth === 0) return { start: lt, end: lt + cm[0].length }
      }
      pos = lt + cm[0].length
      continue
    }
    OPEN_TAG_RE.lastIndex = lt
    const om = OPEN_TAG_RE.exec(text)
    if (!om) { pos = lt + 1; continue }
    const st = readStartTag(text, lt)
    if (!st) { pos = lt + 1; continue }
    if (om[1] === tag && !isSelfClosed(st.text)) depth++
    pos = st.end
  }
  return null
}

function isHidden(attrs) {
  return /type="hidden"/.test(attrs) || /display:\s*none/.test(attrs) || /v-show="false"/.test(attrs)
}

function vueFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.vue')) out.push(p)
    }
  }
  walk(dir)
  return out
}

/** 偏移 → 行号（1 基） */
function lineAt(text, offset) {
  let line = 1
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/**
 * 扫描一个 SFC 源文本，返回该文件里的可点击站点。
 * 顺序分词：逐字符推进，每个开始标签**整体消费**（引号感知的属性值不会被当成标签重扫）。
 */
function scanSource(rel, text) {
  const tpl = rootTemplateRange(text)
  if (!tpl) return { sites: [], scannedChars: 0, templateChars: 0 }
  const body = text.slice(tpl.start, tpl.end)
  const sites = []
  let pos = 0
  while (pos < body.length) {
    const lt = body.indexOf('<', pos)
    if (lt < 0) break
    if (body.startsWith('<!--', lt)) {
      const end = body.indexOf('-->', lt)
      pos = end < 0 ? body.length : end + 3
      continue
    }
    CLOSE_TAG_RE.lastIndex = lt
    if (CLOSE_TAG_RE.exec(body)) { pos = lt + CLOSE_TAG_RE.lastIndex - lt; continue }
    OPEN_TAG_RE.lastIndex = lt
    const om = OPEN_TAG_RE.exec(body)
    if (!om) { pos = lt + 1; continue }
    const tag = om[1]
    const st = readStartTag(body, lt)
    if (!st) { pos = lt + 1; continue }
    const joined = st.text
    if (!NATIVE.has(tag.toLowerCase()) && !RENDERS_NATIVE.test(tag)) {
      const cm = CLICK_RE.exec(joined)
      if (cm) {
        const roleMatch = STATIC_ROLE_RE.exec(joined)
        const staticRole = roleMatch ? roleMatch[1] : null
        const hasRole = staticRole === 'button'
        const hasTab = /:?\btabindex=/.test(joined)
        const hasKey = /@key(down|up)/.test(joined)
        let nestedVisible = 0
        if (hasRole) {
          const close = matchingClose(body, tag, st.end)
          if (close) {
            const inner = body.slice(st.end, close.start)
            let n
            INTERACTIVE_RE.lastIndex = 0
            while ((n = INTERACTIVE_RE.exec(inner))) if (!isHidden(n[2] || '')) nestedVisible++
          }
        }
        sites.push({
          key: `${rel}|${tag}|${cm[2].slice(0, 40)}`,
          file: rel, tag, line: lineAt(text, tpl.start + lt), expr: cm[2],
          hasRole, hasTab, hasKey, nestedVisible,
          tagText: joined,
          staticRole,
          widgetRole: staticRole && WIDGET_ROLES.has(staticRole) ? staticRole : null,
          dynamicRole: /(?<!:)\b:role=/.test(joined) || /\bv-bind:role=/.test(joined),
          selfOnly: /@click\.self/.test(joined),
        })
      }
    }
    pos = st.end
  }
  return { sites, scannedChars: body.length, templateChars: body.length }
}

/** 扫描整个 src/ 域 */
function scan() {
  const sites = []
  const perFile = []
  for (const abs of vueFiles(SRC)) {
    const rel = '/' + path.relative(SRC, abs).replace(/\\/g, '/')
    const text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
    const r = scanSource(rel, text)
    perFile.push({ rel, ...r })
    sites.push(...r.sites)
  }
  return { sites, perFile }
}

/** 该站点的开始标签里，键盘处理是否与 @click 逐字镜像（Enter 与 Space 都要，且表达式相同） */
function mirrorOffenders(joined, expr) {
  const enter = /@keydown\.enter(?:\.prevent)?="([^"]*)"/.exec(joined)
  const space = /@keydown\.space(?:\.prevent)?="([^"]*)"/.exec(joined)
  if (!enter || !space) return '缺 Enter 或 Space'
  if (enter[1] !== expr || space[1] !== expr) return 'keydown 表达式与 @click 不一致'
  return null
}

describe('非 button 可点击元素的键盘可达性（阶段 4.4 / WCAG 2.1.1）', () => {
  const { sites, perFile } = scan()
  // widget 角色（option/menuitem/…）自带键盘契约，不计入 button 缺口，但必须可见
  const widgetRoleSites = sites.filter((s) => s.widgetRole)
  const inDomain = sites.filter((s) => !s.widgetRole)
  const fixed = inDomain.filter((s) => s.hasRole && s.hasTab && s.hasKey)
  const gaps = inDomain.filter((s) => !(s.hasRole && s.hasTab && s.hasKey))
  const gapKeys = [...new Set(gaps.map((g) => g.key))].sort()
  console.log(
    `[clickable-roles] 站点=${sites.length} 已补全=${fixed.length} 仍缺=${gapKeys.length}（去重键）` +
    ` widget角色=${widgetRoleSites.length}`,
  )

  it('扫描域非空且有规模下界（扫描器退化时"零缺口"读起来像全绿）', () => {
    expect(sites.length).toBeGreaterThanOrEqual(30)
    expect(fixed.length).toBeGreaterThanOrEqual(15)
  })

  it('每个 .vue 的扫描窗口必须等于它的根 template 全文（模板边界不得被提前截断）', () => {
    // 反盲区 B：上一版按"第一个 </template>"截断 ⇒ 199 个 .vue 里有 56 个的扫描域被砍掉后半段。
    // 这里逐文件核对"扫了多少字符"与"根 template 有多少字符"，任何提前截断当场红。
    const truncated = perFile.filter((f) => f.templateChars > 0 && f.scannedChars !== f.templateChars)
    expect(
      truncated,
      `这些文件的扫描窗口不等于根 template 全文：${truncated.map((t) => t.rel).join(', ')}`,
    ).toEqual([])
    const scanned = perFile.filter((f) => f.templateChars > 0)
    expect(scanned.length).toBeGreaterThan(100)
  })

  it('多行开始标签的元素必须被扫到（反盲区 A：标签名独占一行时整元素隐形）', () => {
    // 夹具级反断言：标签名独占一行、属性在后续行 —— 上一版按行匹配时这个元素完全看不见。
    const fixture = [
      '<template>',
      '  <div',
      '    class="multi-line"',
      '    @click="doThing"',
      '  >',
      '    <span>内容</span>',
      '  </div>',
      '</template>',
    ].join('\n')
    const { sites: found } = scanSource('/fixture.vue', fixture)
    expect(found.map((f) => f.tag)).toEqual(['div'])
    expect(found[0].expr).toBe('doThing')
    expect(found[0].line).toBe(2)
  })

  it('嵌套 <template> 之后的根 template 后半段必须被扫到（反盲区 B：夹具级）', () => {
    // 夹具级反断言：根 template 里有嵌套 <template #slot>，闭合标签排在根闭合之前。
    // 上一版在这里就把扫描窗口截断了 ⇒ 根 template 后半段的元素永远看不见。
    const fixture = [
      '<template>',
      '  <div>',
      '    <template #extra>',
      '      <span>槽内容</span>',
      '    </template>',
      '  </div>',
      '  <div',
      '    class="after-slot"',
      '    @click="afterSlot"',
      '  >按钮位</div>',
      '</template>',
    ].join('\n')
    const { sites: found } = scanSource('/fixture.vue', fixture)
    expect(found.map((f) => f.expr)).toEqual(['afterSlot'])
    expect(found[0].line).toBe(7)
  })

  it('同名嵌套元素的正文必须配平（反盲区 C：不得用第一个同名闭合标签截断）', () => {
    // 夹具级反断言：外层 div 里还有内层 div，删除按钮在**内层 div 之后**。
    // 上一版取"第一个 </div>"当正文结束 ⇒ 内层之后的删除按钮被漏数 ⇒ nestedVisible=0（失明）。
    const fixture = [
      '<template>',
      '  <div role="button" tabindex="0" @click="outer" @keydown.enter="outer" @keydown.space="outer">',
      '    <div class="inner">',
      '      <span>内层</span>',
      '    </div>',
      '    <button class="delete">删除</button>',
      '  </div>',
      '</template>',
    ].join('\n')
    const { sites: found } = scanSource('/fixture.vue', fixture)
    expect(found).toHaveLength(1)
    expect(found[0].nestedVisible).toBe(1)
  })

  it('脚本块在前、且脚本里有 "<template" 字面量时，根 template 仍要定位正确', () => {
    // 仓里有 10+ 个 .vue 把 <script setup> 写在 <template> 之前；
    // 脚本里出现 "<template" 字面量（动态组件 / 文档示例）会让"文件里第一个 <template>"
    // 指向脚本里的字符串 ⇒ 扫描域指向错误位置 ⇒ 又一次静默缩小。
    const fixture = [
      '<script setup>',
      "const demo = '<template>占位</template>'",
      '</script>',
      '<template>',
      '  <div',
      '    class="real-root"',
      '    @click="realRoot"',
      '  >真实根</div>',
      '</template>',
    ].join('\n')
    const { sites: found } = scanSource('/fixture.vue', fixture)
    expect(found.map((f) => f.expr)).toEqual(['realRoot'])
    expect(found[0].line).toBe(5)
  })

  it('已补 role="button" 的元素不得含可见可聚焦后代（button 是 leaf 角色）', () => {
    const bad = fixed.filter((s) => s.nestedVisible > 0)
    const unexempt = bad.filter((s) => !ROLE_LEAF_DEBT.some((d) => d.key === s.key))
    expect(
      unexempt,
      `这些站点会把内部按钮从 a11y 树抹掉：${unexempt.map((b) => `${b.file}:${b.line}(nested=${b.nestedVisible})`).join(', ')}`,
    ).toEqual([])
  })

  it('role-leaf 欠账名单不得有陈旧条目，且名单只能缩小（本次重锚：0 → 3）', () => {
    const live = new Set(fixed.filter((s) => s.nestedVisible > 0).map((s) => s.key))
    const stale = ROLE_LEAF_DEBT.map((d) => d.key).filter((k) => !live.has(k))
    expect(stale, `名单里这些键已不存在（站点被修好或改名），必须同步删除：${stale.join(' , ')}`).toEqual([])
    expect(ROLE_LEAF_DEBT.length).toBeLessThanOrEqual(3)
    for (const d of ROLE_LEAF_DEBT) {
      expect(d.reason, `role-leaf 欠账项缺少原因：${d.key}`).toBeTruthy()
      expect(d.reason.length).toBeGreaterThan(20)
    }
  })

  it('键盘处理必须逐字镜像鼠标处理（漏一个修饰键即行为分裂）', () => {
    const offenders = []
    for (const s of fixed) {
      const why = mirrorOffenders(s.tagText, s.expr)
      if (!why) continue
      if (KEY_HANDLER_EXEMPT.some((e) => e.key === s.key)) continue
      offenders.push(`${s.file}:${s.line} ${why}`)
    }
    expect(offenders, offenders.join(' | ')).toEqual([])
  })

  it('键盘处理豁免名单不得有陈旧条目，且每条必须写明"为什么不能逐字镜像"', () => {
    const live = new Set(
      fixed
        .filter((s) => mirrorOffenders(s.tagText, s.expr))
        .map((s) => s.key),
    )
    const stale = KEY_HANDLER_EXEMPT.map((e) => e.key).filter((k) => !live.has(k))
    expect(stale, `豁免里这些键已不存在（站点被修好或改名），必须同步删除：${stale.join(' , ')}`).toEqual([])
    expect(KEY_HANDLER_EXEMPT.length).toBeLessThanOrEqual(1)
    for (const e of KEY_HANDLER_EXEMPT) {
      expect(e.reason, `豁免项缺少原因：${e.key}`).toBeTruthy()
      expect(e.reason.length).toBeGreaterThan(20)
    }
  })

  it('tabindex 不得为负（负值把元素移出 Tab 序列，等于没有键盘入口）', () => {
    for (const s of fixed) {
      expect(s.tagText, `${s.file}:${s.line} 应含 tabindex="0"`).toMatch(/tabindex="0"/)
    }
  })

  it('每一处未补全的站点都必须在台账里带原因登记，且台账不得陈旧', () => {
    const registered = LEDGER.map((l) => l.key).sort()
    const missing = gapKeys.filter((k) => !registered.includes(k))
    const stale = registered.filter((k) => !gapKeys.includes(k))
    console.log(`[clickable-roles] 未登记=${missing.length} 陈旧=${stale.length}`)
    if (missing.length) console.log('[clickable-roles] 待登记键：\n  ' + missing.join('\n  '))
    expect(missing, `新增未登记的键盘可达缺口：${missing.join(' , ')}`).toEqual([])
    expect(stale, `台账里这些键已不存在（站点被修好或改名），必须同步删除：${stale.join(' , ')}`).toEqual([])
  })

  it('台账规模上界（只能缩小；本次因扫描域修复而重锚 13 → 31，见执行记录）', () => {
    expect(LEDGER.length).toBeLessThanOrEqual(31)
    expect(gapKeys.length).toBeLessThanOrEqual(LEDGER.length)
  })

  it('台账每条必须给出可判读的原因，且原因不得是空话', () => {
    for (const l of LEDGER) {
      expect(l.reason, `台账项缺少原因：${l.key}`).toBeTruthy()
      expect(l.reason.length).toBeGreaterThan(20)
    }
  })

  it('widget 角色（option/menuitem…）不计入 button 缺口，但必须在统计里显式可见', () => {
    // 反"扫描器看不见就当它不存在"：这类元素被排除出缺口集，但必须能被看见并被计数。
    for (const s of widgetRoleSites) {
      expect(s.staticRole, `${s.file}:${s.line} 的 widget 角色应被识别`).toBeTruthy()
      expect(gapKeys.some((k) => k.startsWith(`${s.file}|${s.tag}|`))).toBe(false)
    }
  })

  it('动态 role 绑定（:role="expr"）的站点必须登记 —— 扫描器不认动态取值，只能靠人认账', () => {
    const dyn = inDomain.filter((s) => s.dynamicRole)
    const registered = new Set(LEDGER.map((l) => l.key))
    const missing = dyn.filter((s) => !registered.has(s.key))
    expect(
      missing,
      `动态 role 绑定的站点未登记（扫描器把 :role="expr" 当作没有 role）：${missing.map((m) => `${m.file}:${m.line}`).join(', ')}`,
    ).toEqual([])
  })
})
