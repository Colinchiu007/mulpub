/**
 * img-loading-contract.test.js — 每个 `<img>` 必须显式声明 loading 与 decoding（UX 审计 4.8 的 `<img>` 半边）
 *
 * 为什么这是一条合同而不是"顺手加属性"：
 * 1. **懒加载是列表页的性能与流量前提**。本仓的图多为账号头像、平台图标、封面缩略图，
 *    一个列表几十条时默认是「全部立刻下请求」；浏览器要下载并解码完才让位，
 *    用户感知就是「进页面卡一下」。
 * 2. **`decoding="async"` 是解码不阻塞渲染**：默认 `auto` 由浏览器决定，
 *    大图解码会占住主线程那一帧 —— 这与 AGENTS.md「高频路径不得同步阻塞事件循环」是同一条判据的图像版本。
 * 3. **eager 必须是显式决定，不能是"忘了写"**。默认值是 eager，所以"没写 loading"
 *    与"要它立刻加载"在代码里长得完全一样 —— 这正是本锁要消灭的歧义。
 *
 * 边界（如实声明，不得当成已覆盖）：
 * - 只扫模板里的 `<img>` 字面量；运行时用 `document.createElement('img')` 或
 *   `v-html` 注入的图片在本锁里**不可见**（与叶子角色锁同一类模板级边界）。
 * - 宽高占位（CLS）本批**刻意不做**：`width`/`height` 属性决定浏览器预留的盒子比例，
 *   给错了会让图片被拉伸；而本仓封面/缩略图的真实比例是动态的，正确解法是容器
 *   `aspect-ratio` 或按原图尺寸写属性 —— 那会改变渲染结果，必须由 CI 的同源基线来判，
 *   不能在本批用 `--update-baseline` 消化。登记在 PRD 的后续项里。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(HERE, '.')

const ALLOWED_LOADING = ['lazy', 'eager']
const ALLOWED_DECODING = ['sync', 'async', 'auto']
export { ALLOWED_LOADING, ALLOWED_DECODING }

/**
 * eager 白名单（文件 → 理由）。**只能缩小**，且条目对应文件不再用 eager 时必须报陈旧。
 * 口径：只给「用户刚要它出现的内容」与「不滚动的应用外壳」；列表/网格一律 lazy。
 */
export const EAGER_ALLOWLIST = {
  'layouts/MpSidebar.vue': '全局侧栏 logo：属于不滚动的应用外壳，首屏恒可见，lazy 只会让它晚一帧出现。',
  'components/CoverPreviewDialog.vue': '封面预览弹窗：图片本身就是用户点开的对象，lazy 会让弹窗先空一帧，用户会读成"封面没生成"。',
  'components/CoverCropDialog.vue': '封面裁剪弹窗：同上，裁剪器的输入就是这张图，延迟加载等于让用户对着空框操作。',
  'views/ResultView.vue': '素材预览面：用户从列表点开的就是这张图，预览空一帧会被读成加载失败。',
  'views/CreateView.vue': '刚选中的本地图片预览：src 是 blob URL，本地数据不省流量，懒加载只推迟可见。',
  'views/PromptEvalView.vue': '待评测图片本身：评测视图的内容就是这张图，lazy 无收益且会打断"图在哪"的判断。',
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

/** 引号感知地取开标签边界：属性值里带 `>` 不得把标签截断（本仓踩过，同叶子角色锁） */
export function readOpenTag (src, lt) {
  let j = lt + 1
  let quote = null
  while (j < src.length) {
    const c = src[j]
    if (quote) { if (c === quote) quote = null }
    else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '>') return { attrs: src.slice(lt + 1, j), end: j }
    j += 1
  }
  throw new Error('开标签未闭合（拒绝把"读不完"当成"没有属性"）：' + src.slice(lt, lt + 60))
}

/** 把注释、<script>/<style>、插值等长涂白 —— 与叶子角色锁同判据：不涂白就会把注释里的示例算成站点 */
export function blankOutNonTemplate (src) {
  const n = src.length
  const hide = new Uint8Array(n)
  for (let at = src.indexOf('<!--'); at >= 0;) {
    const close = src.indexOf('-->', at + 4)
    const stop = close < 0 ? n : close + 3
    hide.fill(1, at, stop)
    at = close < 0 ? -1 : src.indexOf('<!--', stop)
  }
  const blockRe = /<(script|style)\b[\s\S]*?<\/\1\s*>/gi
  for (let m; (m = blockRe.exec(src));) hide.fill(1, m.index, m.index + m[0].length)
  for (let at = src.indexOf('{{'); at >= 0;) {
    const close = src.indexOf('}}', at + 2)
    if (close < 0) break
    hide.fill(1, at, close + 2)
    at = src.indexOf('{{', close + 2)
  }
  let out = ''
  for (let i = 0; i < n;) {
    let j = i
    while (j < n && hide[j] === hide[i]) j += 1
    out += hide[i] ? src.slice(i, j).replace(/[^\n]/g, ' ') : src.slice(i, j)
    i = j
  }
  return out
}

function attr (attrs, name) {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(attrs)
  return m ? (m[1] !== undefined ? m[1] : m[2]).trim() : null
}

/** 扫出一份文件里所有 `<img>` 的声明情况 */
export function scanImgTags (relPath, rawSrc) {
  const src = blankOutNonTemplate(rawSrc.replace(/\r\n/g, '\n'))
  const hits = []
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<img', i)
    if (lt < 0) break
    if (!/^<img(?=[\s/>])/.test(src.slice(lt, lt + 6))) { i = lt + 4; continue }
    const ot = readOpenTag(src, lt)
    hits.push({
      file: relPath,
      line: src.slice(0, lt).split('\n').length,
      loading: attr(ot.attrs, 'loading'),
      decoding: attr(ot.attrs, 'decoding'),
      srcKind: /:src\s*=/.test(ot.attrs) ? 'bound' : 'static',
    })
    i = ot.end + 1
  }
  return hits
}

describe('img 加载合同：每个 <img> 必须显式写 loading，eager 必须有理由', () => {
  const files = listVueFiles(SRC_ROOT)
  const contents = new Map(files.map((p) => [p.slice(SRC_ROOT.length + 1).replace(/\\/g, '/'), readFileSync(p, 'utf8')]))
  const all = []
  for (const [rel, text] of contents) for (const h of scanImgTags(rel, text)) all.push(h)

  it('扫描域非空（>100 个 .vue，且确实扫到过 <img>）', () => {
    expect(files.length, '扫描域退化 ⇒ 本锁看不见任何东西').toBeGreaterThan(100)
    expect(all.length, '全仓没有扫到任何 <img> ⇒ 判据没在测东西').toBeGreaterThan(0)
  })

  it('每个 <img> 都必须声明合法的 loading 与 decoding', () => {
    const noLoading = all.filter((h) => !h.loading)
    expect(noLoading, '未声明 loading 的 <img>（默认就是 eager，等于"忘了写"）：'
      + noLoading.map((h) => h.file + ':' + h.line).join(' | ')).toEqual([])
    const noDecoding = all.filter((h) => !h.decoding)
    expect(noDecoding, '未声明 decoding 的 <img>：' + noDecoding.map((h) => h.file + ':' + h.line).join(' | ')).toEqual([])
    const badLoading = all.filter((h) => h.loading && !ALLOWED_LOADING.includes(h.loading))
    expect(badLoading, 'loading 取值不在闭合词表 ' + ALLOWED_LOADING.join('/') + '：'
      + badLoading.map((h) => h.file + ':' + h.line + '=' + h.loading).join(' | ')).toEqual([])
    const badDecoding = all.filter((h) => h.decoding && !ALLOWED_DECODING.includes(h.decoding))
    expect(badDecoding, 'decoding 取值不在闭合词表：' + badDecoding.map((h) => h.file + ':' + h.line).join(' | ')).toEqual([])
  })

  it('eager 必须逐条有理由，白名单只能缩小且不得虚挂', () => {
    const eagerFiles = [...new Set(all.filter((h) => h.loading === 'eager').map((h) => h.file))]
    const unauthorized = eagerFiles.filter((f) => !Object.prototype.hasOwnProperty.call(EAGER_ALLOWLIST, f))
    expect(unauthorized, '出现没有理由的 eager（默认值不该被当成"决定"）：' + unauthorized.join(' | ')).toEqual([])
    const stale = Object.keys(EAGER_ALLOWLIST).filter((f) => !eagerFiles.includes(f))
    expect(stale, '白名单条目已不再使用 eager ⇒ 必须删除（留着就是永久豁免）：' + stale.join(' | ')).toEqual([])
    for (const [f, why] of Object.entries(EAGER_ALLOWLIST)) {
      expect(why, 'eager 条目 ' + f + ' 缺理由').toBeTruthy()
      expect(why.length, 'eager 条目 ' + f + ' 的理由过短').toBeGreaterThan(20)
      expect(why, 'eager 条目 ' + f + ' 的理由必须说清"为什么必须立刻加载"').toMatch(/首屏|弹窗|点开|本地|内容就是|外壳/)
    }
  })

  it('解析器自身：注释/插值里的示例不得制造站点，自闭合写法必须被看到', () => {
    // 反向锁：把"锁会不会漏"这件事本身钉住。当前仓库全绿只证明现状没踩中。
    const commented = [
      '<template>',
      '  <!-- 举例：<img src="a.png"> 这样是漏写 loading -->',
      '  <div>{{ \'<img src="b.png">\' }}</div>',
      '  <img src="c.png" loading="lazy" decoding="async">',
      '</template>',
    ].join('\n')
    const hits = scanImgTags('FixtureA.vue', commented)
    expect(hits, '注释与插值里的示例 <img> 被当成真实站点 ⇒ 误报').toHaveLength(1)
    expect(hits[0].loading).toBe('lazy')

    // 自闭合写法（Vue 模板里常见）必须同样被扫到
    const selfClosed = ['<template>', '  <img :src="url" alt="" />', '</template>'].join('\n')
    const sc = scanImgTags('FixtureB.vue', selfClosed)
    expect(sc).toHaveLength(1)
    expect(sc[0].loading, '自闭合 <img/> 漏进检测域').toBeNull()

    // 属性值里带 > 的 img 不得被截断（同叶子角色锁的踩坑点）
    const tricky = ['<template>', '  <img :src="url" :alt="a > b ? \'x\' : \'y\'" loading="lazy" decoding="async" />', '</template>'].join('\n')
    const t = scanImgTags('FixtureC.vue', tricky)
    expect(t, '含 `>` 的属性值把开标签截断 ⇒ 该站点静默漏扫').toHaveLength(1)
    expect(t[0].loading).toBe('lazy')
  })

  it('词表本身必须闭合：不在 {lazy,eager} / {sync,async,auto} 里的值一律算违规', () => {
    // 反向锁：仓里现在没有人写错值，所以"合法词表"这条只有用 fixture 才可被观测到。
    // 没有这一条，把 ALLOWED_LOADING 改宽（例如加进 'immediate'）不会让任何东西变红 ——
    // 那就是把判据写成"精确但无用"的装饰（本仓反复记录的同型）。
    const wrong = scanImgTags('FixtureD.vue', ['<template>', '  <img src="a.png" loading="immediate" decoding="weird">', '</template>'].join('\n'))
    expect(wrong).toHaveLength(1)
    expect(ALLOWED_LOADING.includes(wrong[0].loading), 'loading 词表被放宽 ⇒ 任意字符串都算合法').toBe(false)
    expect(ALLOWED_DECODING.includes(wrong[0].decoding), 'decoding 词表被放宽').toBe(false)
  })
})
