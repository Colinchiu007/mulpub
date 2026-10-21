/**
 * leaf-role-contract.test.js — 叶子角色容器不得吞掉真实控件（UX 审计 4.4 的第二批 / WCAG 4.1.2 + 2.1.1）
 *
 * 形状：`<div role="button" tabindex="0">` 里嵌着 `<button>` / `<input>` / `<a>`。
 * ARIA 的叶子角色（button / link / tab / menuitem / checkbox / radio / img）会把**后代在无障碍树里
 * 变成 presentational** —— 于是里面那枚真按钮对读屏彻底消失，而且是**视觉上完全正常**的消失：
 * 鼠标点得到、看上去也在，只有辅助技术看不见。这与本仓「装饰性链路」是同族问题，
 * 但比"接线断了"更坏：这里控件被主动从可访问性树里删掉了。
 *
 * 修法不是"给容器补键盘"（上一批 4.4 那种缺键盘的情况才那么修），而是**把容器降级成普通盒子**：
 * 卡片的外层点击只作为鼠标便利保留，键盘路径交给卡内那枚**真实**控件 ——
 * 本批两个被修站点都已经有等价真实控件（Collection 的【编辑】按钮调同一个 `openRecordForEdit`；
 * CreateHistory 的【预览】按钮 push 同一个 `encodeURIComponent(...)` 表达式），
 * 所以移除容器 role 不丢任何功能。
 *
 * 例外清单只可缩小：每项必须带 reason，且**条目消失时必须报陈旧**（否则清单会变成永久豁免）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(HERE, '.')

/** 会被当成"叶子"的角色：声明它们意味着"我就是一个控件，内部没有结构" */
const LEAF_ROLES = ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'img']
/**
 * 真实可交互控件：出现在叶子角色容器内部即为违规。
 * 除原生标签外必须把**本仓实际在用的交互组件名**也列进来（QM-6 评审 i2）：
 * `<el-button>` / `<UiButton>` 这类自定义组件渲染出的就是真 DOM 按钮，
 * 只认原生标签会让"同一缺陷换一种写法"整条绕过这把锁。
 * 边界（如实声明，不得当成已覆盖）：模板级扫描看不到渲染后的 DOM —— 容器内放一个
 * **既不在此清单、模板层也不带交互属性**的第三方组件，本锁结构上判不出来。
 */
const INTERACTIVE_TAGS = new Set([
  'button', 'a', 'input', 'select', 'textarea', 'summary',
  'el-button', 'el-checkbox', 'el-radio', 'el-radio-group', 'el-switch', 'el-input',
  'el-input-number', 'el-select', 'el-date-picker', 'el-upload', 'el-link', 'el-tabs',
  'ui-button', 'uibutton', 'router-link',
])
/** 组件标签带这些属性时也算"卡里的另一个交互"（Vue 自定义组件渲染出的是真 DOM 节点） */
const INTERACTIVE_ATTR_RE = /(?:@click|@keydown|@keyup|@keypress|@focus|v-on:(?:click|keydown|keyup|keypress|focus)|:href|\bhref=)/
/**
 * void 元素没有闭合标签（`<img role="img">` / `<input role="button">`）：
 * 若仍按"同名闭合配对"找 inner，`closeAt` 会一路落到文件尾，inner 退化成"文件剩余全文"，
 * 于是把无关代码里的交互控件当成容器内违规（误报方向），并让 containerOf 的
 * "inner 非空"断言对整段文件尾都成立 —— 形状断言悄悄失去"限定在被降级容器区间内"的语义。
 */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
/**
 * `tabindex="-1"` 是**程序性焦点目标**（滚动锚点、dialog 落点），不是用户可操作控件
 * （QM-6 评审 i7）：把它计成"交互"会让任何加过渡焦点元素的卡片误报。
 * 非 -1 的 tabindex 仍计。
 */
const TABINDEX_RE = /\btabindex\s*=\s*["']?\s*(-?\d+)/

/**
 * 把注释与 `<script>` / `<style>` 区块**等长地**涂白（QM-6 评审 i1，Critical）。
 * 不涂白会怎样：`matchingCloseStart` 按同名闭合标签配对算深度，而注释/脚本里的
 * `</div>` 同样被计入 —— 于是容器 inner 里只要有一句写着 `</div>` 的注释，深度就在
 * 那里提前归零，其后的真 `<button>` 永久不被看到：**锁变绿而缺陷仍在**，正是本锁
 * 自己声称要防的静默漏扫。等长替换（保留 `\n`）是为了让行号与偏移继续对得上原文。
 */
export function blankOutNonTemplate (src) {
  const n = src.length
  const hide = new Uint8Array(n)
  // 注释：<!-- 到最近的 -->（未闭合则到文件尾）
  for (let at = src.indexOf('<!--'); at >= 0;) {
    const close = src.indexOf('-->', at + 4)
    const stop = close < 0 ? n : close + 3
    hide.fill(1, at, stop)
    at = close < 0 ? -1 : src.indexOf('<!--', stop)
  }
  // script / style 整块（含标签本身）
  const blockRe = /<(script|style)\b[\s\S]*?<\/\1\s*>/gi
  for (let m; (m = blockRe.exec(src));) hide.fill(1, m.index, m.index + m[0].length)
  // 插值区 {{ … }}：模板文本里的 `{{ '<button>x</button>' }}` 不是标记，
  // 不涂白就会把插值字面量里的尖括号当成真实开标签命中（误报方向）
  for (let at = src.indexOf('{{'); at >= 0;) {
    const close = src.indexOf('}}', at + 2)
    if (close < 0) break
    hide.fill(1, at, close + 2)
    at = src.indexOf('{{', close + 2)
  }
  // 等长输出：隐藏区里的非 \n 字符换成空格，行号与偏移继续对得上原文
  let out = ''
  for (let i = 0; i < n;) {
    let j = i
    while (j < n && hide[j] === hide[i]) j += 1
    out += hide[i] ? src.slice(i, j).replace(/[^\n]/g, ' ') : src.slice(i, j)
    i = j
  }
  return out
}


/** 已知例外（file:角色 → 原因）。只能缩小；条目对应的违规消失即报陈旧。 */
export const KNOWN_LEAF_ROLE_CONFLICTS = {
  'components/TabBar.vue:tab':
    '标签按钮里嵌着关闭按钮（`<button>` 套 `<button>` 本身是非法 HTML）。正解要把关闭按钮移出 tab 元素并重排 tab 宽度与 hover 命中区，属带像素风险的结构性改动，需单独一批并跑视觉门禁 —— 本批不动。',
  'features/accounts/components/AccountManagementCard.vue:button':
    '正解 = 把"选中"交给卡内那枚 checkbox（它本来就是真控件），把"展开/收起"交给卡头一枚真按钮，容器只保留鼠标点击不加 role。'
    + '但容器点击语义与卡内控件不是同一个动作，移除容器 role 前要先定"整卡是否还应保留点击"（产品口径），且涉及勾选态样式，须与 4.1 第二批同批处理。',
  'views/CopyLibraryView.vue:button':
    '卡片容器是唯一"查看详情"入口（卡内没有等价真实控件）。正解是把标题做成真按钮或加一枚 stretched-link，涉及样式与焦点环归属，需与 4.1 第二批同批处理。',
}

function listVueFiles (dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'locales') continue
      listVueFiles(join(dir, ent.name), out)
      continue
    }
    if (ent.isFile() && ent.name.endsWith('.vue')) out.push(join(dir, ent.name))
  }
  return out
}

/** 引号感知地读完一个开标签的属性区（属性值里带 `>` 不得截断标签 —— 本仓踩过） */
export function readOpenTag (src, lt) {
  let j = lt + 1
  let quote = null
  while (j < src.length) {
    const c = src[j]
    if (quote) { if (c === quote) quote = null }
    // 反引号也算引号：`<div :id="`x>y`">` 里的 `>` 若被当标签结束会整站截断（QM-6 二轮 i3）
    else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '>') return { attrs: src.slice(lt, j), end: j, selfClosing: src[j - 1] === '/' }
    j += 1
  }
  return { attrs: src.slice(lt), end: src.length, selfClosing: false }
}

/**
 * 找与 start 处 <tag 配对的闭合标签起点（跳过同名嵌套）。两条必须（QM-6 二轮 i1）：
 * ① **自闭合**的同名开标签不得计入深度 —— `<div/>` 只加不减，会让后面的 `</div>`
 *    永远降不到 0；② void 元素（img / input / br …）根本没有闭合标签，按配对找 inner
 *    会一路落到文件尾，把"文件剩余全文"当容器 inner ⇒ 无关代码里的控件被报成容器内违规，
 *    且 containerOf 的"inner 非空"断言对整段文件尾都成立，区间断言悄悄失去语义。
 * 因此：void 容器与"配不上对"一律返回 **-1 让调用方出声**，不得返回 src.length。
 */
export function matchingCloseStart (src, after, tag) {
  if (VOID_TAGS.has(String(tag).toLowerCase())) return -1
  const openRe = new RegExp('<' + tag + '(?=[\\s/>])', 'g')
  const closeRe = new RegExp('</' + tag + '\\s*>', 'g')
  const events = []
  openRe.lastIndex = after
  closeRe.lastIndex = after
  for (let m; (m = openRe.exec(src));) {
    const ot = readOpenTag(src, m.index)
    if (!ot.selfClosing) events.push({ at: m.index, d: 1 })
    openRe.lastIndex = ot.end + 1
  }
  for (let m; (m = closeRe.exec(src));) events.push({ at: m.index, d: -1 })
  events.sort((a, b) => a.at - b.at)
  let depth = 1
  for (const e of events) {
    depth += e.d
    if (depth === 0) return e.at
  }
  return -1
}

/**
 * 取元素声明的 role token 列表。三条都不可省（QM-6 二轮 i2）：
 * ① ARIA 规范里 role 值**大小写不敏感** ⇒ `role="Button"` 与 `role="button"` 等义，
 *    只在原值上比表就会因一个首字母大写整条逃逸；
 * ② role 允许**空格分隔多值**（`role="button tab"`）⇒ 必须按 token 逐个比，不能整串比；
 * ③ 三种写法都要认：role="…" / role='…' / :role="'…'"（:role 的值外层是模板属性引号、
 *    内层还有一层字符串引号，必须先取整个属性值再剥内层引号 ——
 *    把内层引号直接写进字符类会整条不匹配）。
 * 边界（如实声明）：`:role="某变量"` 这种运行时才知道的角色，本锁判不出来。
 */
export function roleTokens (attrs) {
  const m = /(?:^|[\s:])role\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs)
  if (!m) return []
  const raw = (m[1] !== undefined ? m[1] : m[2]).trim()
  const v = raw.replace(/^['"`]+|['"`]+$/g, '').trim()
  if (!v) return []
  // 边界如实声明：`:role="某变量"` 这种运行时才知道的角色值不是合法 token，会被下面的
  // token 过滤丢掉 ⇒ 本锁判不出来。反失明那条用例负责盯"域不为空"，不负责盯这种逃逸。
  return v.toLowerCase().split(/\s+/).filter((t) => /^[\w-]+$/.test(t))
}

/**
 * 扫出一份 .vue 里所有「叶子角色容器内含真实交互」的站点。
 * 解析不出容器边界时**必须出声**（抛错），不得把"文件剩余全文"当 inner 静默接受 ——
 * 后者同时制造误报与让区间断言失效，而"锁变绿但测的不是它声称的那段"是本仓反复记录的
 * 装饰性门禁形态（QM-6 二轮 i1）。
 */
export function findLeafRoleConflicts (relPath, rawSrc) {
  const src = blankOutNonTemplate(rawSrc.replace(/\r\n/g, '\n'))
  const hits = []
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    const tm = /^<([a-zA-Z][\w-]*)/.exec(src.slice(lt, lt + 40))
    if (!tm) { i = lt + 1; continue }
    const tag = tm[1]
    const ot = readOpenTag(src, lt)
    const leaf = roleTokens(ot.attrs).find((t) => LEAF_ROLES.includes(t))
    if (leaf) {
      if (ot.selfClosing || VOID_TAGS.has(tag.toLowerCase())) { i = ot.end + 1; continue }
      const closeAt = matchingCloseStart(src, ot.end + 1, tag)
      if (closeAt < 0) {
        throw new Error(relPath + '：第 ' + src.slice(0, lt).split('\n').length + ' 行的 <' + tag +
          ' role="' + leaf + '"> 找不到配对闭合标签 ⇒ 本锁无法界定它的 inner，拒绝把文件剩余全文当容器内容')
      }
      const inner = src.slice(ot.end + 1, closeAt)
      const bad = scanInteractive(inner)
      if (bad.length > 0) {
        hits.push({
          key: relPath + ':' + leaf,
          line: src.slice(0, lt).split('\n').length,
          tag, role: leaf, bad,
        })
      }
      i = Math.max(closeAt, ot.end + 1)
      continue
    }
    i = ot.end + 1
  }
  return hits
}

/** 内层逐个开标签扫（不再递归展开嵌套叶子，避免把同一棵子树重复计） */
function scanInteractive (inner) {
  const found = []
  let k = 0
  while (k < inner.length) {
    const l2 = inner.indexOf('<', k)
    if (l2 < 0) break
    const m2 = /^<([a-zA-Z][\w-]*)/.exec(inner.slice(l2, l2 + 40))
    if (!m2) { k = l2 + 1; continue }
    const t2 = m2[1]
    const o2 = readOpenTag(inner, l2)
    const attrHit = o2.attrs.match(INTERACTIVE_ATTR_RE)
    const ti = o2.attrs.match(TABINDEX_RE)
    const focusable = ti !== null && ti[1] !== '-1'
    // 标签名按大小写不敏感比一次（模板里 `<UiButton>` 与 `<uibutton>` 都可能出现）
    const tagHit = INTERACTIVE_TAGS.has(t2) || INTERACTIVE_TAGS.has(t2.toLowerCase())
    if (tagHit || attrHit || focusable) {
      found.push(t2 + (attrHit ? ':' + attrHit[0] : (focusable ? ':tabindex' + ti[1] : '')))
    }
    k = o2.end + 1
  }
  return [...new Set(found)]
}


/**
 * 取某个开标签（按锚点子串定位）的属性区 + 到其配对闭合标签之间的区间。
 * 三条拒绝静默的路径（QM-6 二轮 i1/i5）：锚点必须**唯一**（同文件另一张卡先出现且含同一
 * 子串时，indexOf 会取到第一处，形状断言就校验到错误的容器）；配不上对一律抛错；
 * 锚点被格式化掉时表现为"抛错停摆"而不是"悄悄校验别处"。
 */
function containerOf (src, anchor, tag) {
  const at = src.indexOf(anchor)
  if (at < 0) throw new Error('锚点不存在，无法定位容器：' + anchor)
  if (src.indexOf(anchor, at + 1) >= 0) throw new Error('锚点在文件里不唯一，无法确定校验的是哪个容器：' + anchor)
  const lt = src.lastIndexOf('<', at)
  const ot = readOpenTag(src, lt)
  const tagName = tag || /^<([a-zA-Z][\w-]*)/.exec(src.slice(lt, lt + 40))[1]
  const closeAt = matchingCloseStart(src, ot.end + 1, tagName)
  if (closeAt < 0) throw new Error('容器 <' + tagName + '> 配不上闭合标签，拒绝把文件剩余全文当 inner：锚点=' + anchor)
  return { attrs: src.slice(lt, ot.end + 1), inner: src.slice(ot.end + 1, closeAt) }
}

describe('叶子角色合同：role=button/link/tab 的容器内不得嵌真实交互控件', () => {
  const files = listVueFiles(SRC_ROOT)
  const rel = (p) => p.slice(SRC_ROOT.length + 1).replace(/\\/g, '/')
  // 每份文件只读一次（域会随仓库增长，逐趟重复读是免费可修的冗余 —— QM-6 评审 i5）
  const contents = new Map(files.map((p) => [rel(p), readFileSync(p, 'utf8')]))
  const all = []
  for (const p of files) for (const h of findLeafRoleConflicts(rel(p), contents.get(rel(p)))) all.push(h)

  it('扫描域非空（>100 个 .vue，且确实扫到过叶子角色元素）', () => {
    // 反失明：域退化成空集合时"零违规"读起来完全像通过
    expect(files.length, '扫描域退化 ⇒ 本锁看不见任何东西').toBeGreaterThan(100)
    const withLeafRole = [...contents.entries()]
      .filter(([, text]) => new RegExp('\\brole=("|\')(' + LEAF_ROLES.join('|') + ')').test(text))
    expect(withLeafRole.length, '全仓没有任何叶子角色元素 ⇒ 判据没在测东西').toBeGreaterThan(0)
  })

  it('违规站点必须命中例外清单，且清单条目不得虚挂（只能缩小）', () => {
    const unexpected = all.filter((h) => !Object.prototype.hasOwnProperty.call(KNOWN_LEAF_ROLE_CONFLICTS, h.key))
    expect(unexpected, '新出现的叶子角色吞控件：' + unexpected.map((h) => h.key + '@' + h.line + ' 内含=' + h.bad.join(',')).join(' | '))
      .toEqual([])
    const keysNow = new Set(all.map((h) => h.key))
    const stale = Object.keys(KNOWN_LEAF_ROLE_CONFLICTS).filter((k) => !keysNow.has(k))
    expect(stale, '例外清单里的条目已不再违规 ⇒ 必须删除（留着就是永久豁免）：' + stale.join(' | ')).toEqual([])
  })

  it('每个例外条目必须带非空 reason，且不得用"以后再说"充当理由', () => {
    for (const [k, why] of Object.entries(KNOWN_LEAF_ROLE_CONFLICTS)) {
      expect(why, '例外 ' + k + ' 缺理由').toBeTruthy()
      expect(why.length, '例外 ' + k + ' 的理由过短').toBeGreaterThan(20)
      expect(why, '例外 ' + k + ' 的理由必须说清"正解是什么、为何不在本批"').toMatch(/正解|需|须/)
    }
  })

  it('注释与 script/style 里的 </div> 不得截断容器（漏扫方向必须锁死）', () => {
    // QM-6 评审 i1（Critical）。这条 fixture 是"锁自己声称要防的那种静默漏扫"：
    // 不涂白注释时，同名闭合标签会让深度提前归零，其后的真 <button> 永久看不见。
    const withCommentCloser = [
      '<template>',
      '  <div role="button" tabindex="0" class="card">',
      '    <!-- 历史上这里是个 </div> 容器，现已改造成卡片 -->',
      '    <button @click="onEdit">编辑</button>',
      '  </div>',
      '</template>',
    ].join('\n')
    const hits = findLeafRoleConflicts('Fixture.vue', withCommentCloser)
    expect(hits, '注释里的 </div> 把容器提前截断 ⇒ 卡内那枚真按钮被静默漏扫').toHaveLength(1)
    expect(hits[0].bad.join(',')).toMatch(/button/)

    // 反向：注释里写的假交互不得制造命中（否则"涂白"只是把漏扫换成误报）
    const commentOnly = [
      '<template>',
      '  <div role="button" tabindex="0" class="card">文本</div>',
      '  <!-- 举例：<button @click>x</button> 与 <a href="/y">z</a> 这类写法 -->',
      '</template>',
    ].join('\n')
    expect(findLeafRoleConflicts('Fixture2.vue', commentOnly), '注释里的示例代码被当成了卡内控件').toEqual([])

    // script 区块里的同名闭合标签同样不得参与配对
    const scriptCloser = [
      '<template>',
      '  <div role="link">',
      '    <a href="/x">去</a>',
      '  </div>',
      '</template>',
      '<script setup>',
      "const html = '</div><div class=\\'x\\'>demo'",
      '</script>',
    ].join('\n')
    expect(findLeafRoleConflicts('Fixture3.vue', scriptCloser)).toHaveLength(1)
  })

  it('tabindex="-1" 是程序性焦点目标，不得被计成可操作控件', () => {
    // QM-6 评审 i7 之一：宽匹配 tabindex 会让任何加过渡焦点元素的卡片误报。
    const scrollAnchor = [
      '<template>',
      '  <div role="button" tabindex="0">主区',
      '    <span tabindex="-1" aria-hidden="true"></span>',
      '  </div>',
      '</template>',
    ].join('\n')
    expect(findLeafRoleConflicts('Fixture4.vue', scrollAnchor), 'tabindex="-1" 的过渡焦点元素被计成交互 ⇒ 误报').toEqual([])
  })

  it('动态 :role 绑定同样是叶子角色声明，必须在判定域内', () => {
    // QM-6 评审 i7 之二：只认 role="…" 字面量时，:role="'button'" 整条逃逸。
    const dynamic = [
      '<template>',
      "  <div :role=\"'button'\" tabindex=\"0\">",
      '    <button @click="go">go</button>',
      '  </div>',
      '</template>',
    ].join('\n')
    expect(findLeafRoleConflicts('Fixture5.vue', dynamic), ':role="\'button\'" 逃逸出检测域').toHaveLength(1)
  })

  it('交互组件名必须在判定域内（否则同一缺陷换一种写法就整条绕过这把锁）', () => {
    // QM-6 评审 i2：只认原生标签时，`<el-button>` / `<UiButton>` 里的真按钮对锁完全隐形。
    const el = ['<template>', '  <div role="button" tabindex="0">', '    <el-button>编辑</el-button>', '  </div>', '</template>'].join('\n')
    expect(findLeafRoleConflicts('Fixture6.vue', el), '<el-button> 未被计入交互控件').toHaveLength(1)
    const pascal = ['<template>', '  <div role="button">', '    <UiButton @click="go">去</UiButton>', '  </div>', '</template>'].join('\n')
    expect(findLeafRoleConflicts('Fixture7.vue', pascal), '<UiButton> 未被计入交互控件').toHaveLength(1)
  })

  it('容器边界不得靠"落到文件尾"蒙过去（void / 自闭合 / 多值大小写 / 插值字面量）', () => {
    // QM-6 二轮 i1 + i2 + i3 + i4，四组 fixture 各钉一条解析器退化路径。
    const t = (rows) => rows.join('\n')

    // ① void 容器：`<img role="img">` 没有闭合标签，绝不能把"文件剩余全文"当 inner
    const voidLeaf = t([
      '<template>',
      '  <img role="img" :src="url" alt="封面">',
      '  <div class="other"><button @click="x">别的卡</button></div>',
      '</template>',
    ])
    expect(findLeafRoleConflicts('V1.vue', voidLeaf), 'void 元素被当容器 ⇒ 把无关按钮报成它的后代').toEqual([])

    // ② 自闭合同名开标签不得计入深度
    const selfClosing = t([
      '<template>',
      '  <div role="button" tabindex="0">',
      '    <div class="sizer"/>',
      '    <button @click="go">go</button>',
      '  </div>',
      '</template>',
    ])
    const scHits = findLeafRoleConflicts('V2.vue', selfClosing)
    expect(scHits, '自闭合 <div/> 让深度永远降不到 0 ⇒ inner 退化成文件尾').toHaveLength(1)
    expect(scHits[0].bad.join(',')).toMatch(/button/)

    // ③ role 值大小写不敏感 + 空格分隔多值
    const upper = t(['<template>', '  <div role="Button">', '    <button @click="x">x</button>', '  </div>', '</template>'])
    expect(findLeafRoleConflicts('V3.vue', upper), 'role="Button" 因大小写逃逸').toHaveLength(1)
    const multi = t(['<template>', '  <div role="tab button">', '    <input value="v">', '  </div>', '</template>'])
    expect(findLeafRoleConflicts('V4.vue', multi), '多值 role 整串比对 ⇒ "tab button" 逃逸').toHaveLength(1)

    // ④ 插值字面量里的尖括号不是标记 —— **必须放在叶子容器内**，
    //    否则这条 fixture 根本没在测涂白（第一版把它写在容器外，M13 变异因此 MISSED）。
    const interp = t(['<template>', '  <div role="button">写个 {{ \'<button>x</button>\' }} 说明</div>', '</template>'])
    expect(findLeafRoleConflicts('V5.vue', interp), '插值字面量里的 <button> 被当成真实控件 ⇒ 误报').toEqual([])

    // ⑤ @keyup / v-on:keydown 必须算交互（本批自己就从 Collection.vue 移除过 @keyup.enter）
    const keyup = t(['<template>', '  <div role="button">', '    <span @keyup.enter="open">标题</span>', '  </div>', '</template>'])
    expect(findLeafRoleConflicts('V6.vue', keyup), '@keyup 未被计入交互属性').toHaveLength(1)

    // ⑥ presentation / none 刻意**不**当叶子角色 —— 且这不是漏coverage 而是规范差异：
    //    ARIA 的 "children presentational" 规则只挂在叶子角色上，presentation/none 只剥自己
    //    那层的语义，后代控件仍在无障碍树里。把它们计成叶子会把合法写法判成缺陷。
    const pres = t(['<template>', '  <div role="presentation">', '    <button @click="x">仍然可见</button>', '  </div>', '</template>'])
    expect(findLeafRoleConflicts('V7.vue', pres), 'presentation 只剥自身语义，后代控件不应被报成消失').toEqual([])

    // ⑧ "出声"这条出口必须可达：配不上对时要抛错，而不是静默把文件尾当内容。
    //    没有这条，上面那句"拒绝把剩余全文当 inner"就只是注释里的承诺（装饰性分支）。
    const unpaired = t(['<template>', '  <div role="button" tabindex="0">', '    <button @click="x">x</button>', '</template>'])
    // 断言取的是**实际抛出的那句话**（第一次写成 /配不到|配不上/，与实际文案"找不到配对闭合标签"
    // 不同 ⇒ 这条用例自己先红 —— 期望也要当场验，不是写完就当它对）
    expect(() => findLeafRoleConflicts('V8.vue', unpaired), '配不上对时必须抛错，不得静默退化').toThrow(/找不到配对闭合标签/)
    expect(() => findLeafRoleConflicts('V8.vue', unpaired)).toThrow(/V8\.vue/)
  })

  it('本批两个被修站点：容器已降级，且等价真实控件必须在**被降级的那个容器区间内**', () => {
    // QM-6 评审 i3：文件级 grep 证明不了"降级没丢功能"——按钮若属于另一张卡/另一分支，
    // 移除容器键盘路径后锁照样全绿。所以断言必须落在容器 inner 上。
    const collection = blankOutNonTemplate(contents.get('views/Collection.vue').replace(/\r\n/g, '\n'))
    const card = containerOf(collection, "copy-library-item-' + entry.item.id")
    expect(card.inner, '采集卡片 inner 为空 ⇒ 锚点或配对失效（不得当成"没有内容所以没问题"）').not.toBe('')
    expect(card.attrs, '采集卡片容器仍带 role ⇒ 降级未落地').not.toMatch(/\brole\s*=/)
    expect(card.attrs).not.toMatch(/\btabindex\s*=/)
    expect(card.inner).toMatch(/@click\.stop="openRecordForEdit\(entry\.item\)"/)

    const createHistory = blankOutNonTemplate(contents.get('views/CreateHistory.vue').replace(/\r\n/g, '\n'))
    const render = containerOf(createHistory, 'class="render-card"')
    expect(render.inner, '渲染卡片 inner 为空 ⇒ 锚点或配对失效').not.toBe('')
    expect(render.attrs).not.toMatch(/\brole\s*=/)
    expect(render.attrs).not.toMatch(/\btabindex\s*=/)
    expect(render.inner).toMatch(/encodeURIComponent\(r\.outputPath \|\| ''\)/)
  })
})
