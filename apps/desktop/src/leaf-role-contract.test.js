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
/** 真实可交互控件：出现在叶子角色容器内部即为违规 */
const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])
/** 组件标签带这些属性时也算"卡里的另一个交互"（Vue 自定义组件渲染出的是真 DOM 节点） */
const INTERACTIVE_ATTR_RE = /(?:@click|@keydown|v-on:click|:href|\bhref=|tabindex)/

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
function readOpenTag (src, lt) {
  let j = lt + 1
  let quote = null
  while (j < src.length) {
    const c = src[j]
    if (quote) { if (c === quote) quote = null }
    else if (c === '"' || c === "'") quote = c
    else if (c === '>') return { attrs: src.slice(lt, j), end: j }
    j += 1
  }
  return { attrs: src.slice(lt), end: src.length }
}

/** 找与 start 处 <tag 配对的闭合标签起点（跳过同名嵌套）；找不到返回 src.length */
function matchingCloseStart (src, after, tag) {
  const openRe = new RegExp('<' + tag + '(?=[\\s/>])', 'g')
  const closeRe = new RegExp('</' + tag + '\\s*>', 'g')
  const events = []
  openRe.lastIndex = after
  closeRe.lastIndex = after
  for (let m; (m = openRe.exec(src));) events.push({ at: m.index, d: 1 })
  for (let m; (m = closeRe.exec(src));) events.push({ at: m.index, d: -1 })
  events.sort((a, b) => a.at - b.at)
  let depth = 1
  for (const e of events) {
    depth += e.d
    if (depth === 0) return e.at
  }
  return src.length
}

function roleIn (attrs) {
  const m = attrs.match(/\brole\s*=\s*["']([^"']+)["']/)
  return m ? m[1].trim() : null
}

/** 扫出一份 .vue 里所有「叶子角色容器内含真实交互」的站点 */
export function findLeafRoleConflicts (relPath, src) {
  const hits = []
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    const tm = /^<([a-zA-Z][\w-]*)/.exec(src.slice(lt, lt + 40))
    if (!tm) { i = lt + 1; continue }
    const tag = tm[1]
    const ot = readOpenTag(src, lt)
    const role = roleIn(ot.attrs)
    if (role && LEAF_ROLES.includes(role)) {
      const closeAt = matchingCloseStart(src, ot.end + 1, tag)
      const inner = src.slice(ot.end + 1, closeAt)
      const bad = scanInteractive(inner)
      if (bad.length > 0) {
        hits.push({
          key: relPath + ':' + role,
          line: src.slice(0, lt).split('\n').length,
          tag, role, bad,
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
    if (INTERACTIVE_TAGS.has(t2) || attrHit) found.push(t2 + (attrHit ? ':' + attrHit[0] : ''))
    k = o2.end + 1
  }
  return [...new Set(found)]
}

describe('叶子角色合同：role=button/link/tab 的容器内不得嵌真实交互控件', () => {
  const files = listVueFiles(SRC_ROOT)
  const rel = (p) => p.slice(SRC_ROOT.length + 1).replace(/\\/g, '/')
  const all = []
  for (const p of files) for (const h of findLeafRoleConflicts(rel(p), readFileSync(p, 'utf8'))) all.push(h)

  it('扫描域非空（>100 个 .vue，且确实扫到过叶子角色元素）', () => {
    // 反失明：域退化成空集合时"零违规"读起来完全像通过
    expect(files.length, '扫描域退化 ⇒ 本锁看不见任何东西').toBeGreaterThan(100)
    const withLeafRole = files.filter((p) => new RegExp('\\brole=("|\')(' + LEAF_ROLES.join('|') + ')').test(readFileSync(p, 'utf8')))
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

  it('本批两个被修站点：容器已降级为普通盒子，卡内真实控件仍在', () => {
    const collection = readFileSync(join(SRC_ROOT, 'views', 'Collection.vue'), 'utf8').replace(/\r\n/g, '\n')
    const createHistory = readFileSync(join(SRC_ROOT, 'views', 'CreateHistory.vue'), 'utf8').replace(/\r\n/g, '\n')
    const cardLine = collection.split('\n').find((l) => l.includes("copy-library-item-' + entry.item.id"))
    expect(cardLine, '找不到采集卡片容器行（坐标漂移）').toBeTruthy()
    expect(cardLine).not.toMatch(/role="button"/)
    expect(cardLine).not.toMatch(/tabindex="0"/)
    // 卡内那枚等价真实控件必须还在（移除容器 role 的前提就是它存在）
    expect(collection).toMatch(/@click\.stop="openRecordForEdit\(entry\.item\)"/)

    const renderCard = createHistory.split('\n').find((l) => l.includes('class="render-card"'))
    expect(renderCard, '找不到渲染卡片容器行（坐标漂移）').toBeTruthy()
    expect(renderCard).not.toMatch(/role="button"/)
    expect(renderCard).not.toMatch(/tabindex="0"/)
    expect(createHistory).toMatch(/@click\.stop="\$router\.push\('\/create\/result\?path=' \+ encodeURIComponent\(r\.outputPath \|\| ''\)\)"/)
  })
})
