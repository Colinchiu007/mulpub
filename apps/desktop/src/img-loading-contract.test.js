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
 * eager 白名单 —— **粒度是「一张图」而不是「一个文件」**（QM-6 评审 i3）。
 *
 * 第一版是 `{ 文件: 理由 }`，锁只检查"含 eager 的文件在不在白名单"。后果是文件级豁免：
 * 已在名单上的文件（如 `CreateView.vue` 本来就有 2 个本地预览 eager）**再新增第三个毫无理由的
 * eager** 时，unauthorized 与 stale 两条断言全部放行 —— 与合同标题「eager 逐条给理由」不符。
 * 现在每条必须给一个 `match` 锚点（该 `<img>` 开标签里唯一可辨的特征串），
 * 于是"授权"落到具体那一张图上。
 *
 * `match` 的取法：优先 `data-testid` / `class`，其次 `:src` 表达式 —— 必须是**该文件内唯一**，
 * 否则同文件多个锚点会互相认领（下面「锚点必须互不重叠」那条锁就是在防这件事）。
 *
 * 口径三条（与 PRD 的《图片加载合同》同源，改这里必须同步改 PRD）：
 *  ① **单例、不滚动的应用外壳**（侧栏 logo）；
 *  ② **用户这次操作刚点开/刚要编辑的那张图本身**（预览弹窗、裁剪器输入、灯箱大图）；
 *  ③ **本地内容的预览**：src 是 `FileReader` 的 data URL 或 `URL.createObjectURL(file)` ——
 *     数据已经在内存里，lazy 不省一个字节，只推迟可见。③ 允许出现在 v-for 里（每选一张就立刻要看到哪张）。
 *  反向：**远程**列表/网格缩略图一律 lazy（含壳层里 v-for 出来的小图标，如标签栏的平台图标）。
 */
export const EAGER_ALLOWLIST = [
  { file: 'layouts/MpSidebar.vue', match: 'data-testid="mp-sidebar-logo"', reason: '全局侧栏 logo：属于①不滚动的应用外壳，首屏恒可见，lazy 只会让它晚一帧出现。' },
  { file: 'components/CoverPreviewDialog.vue', match: 'data-testid="cover-preview-image"', reason: '封面预览弹窗：图片本身就是用户点开的对象（②），lazy 会让弹窗先空一帧，用户会读成"封面没生成"。' },
  { file: 'components/CoverCropDialog.vue', match: 'class="crop-img"', reason: '封面裁剪弹窗：同上（②），裁剪器的输入就是这张图，延迟加载等于让用户对着空框操作。' },
  { file: 'views/ResultView.vue', match: ':src="sceneMaterialPreview.url"', reason: '素材预览面：用户从列表点开的就是这张图（②），预览空一帧会被读成加载失败。' },
  { file: 'views/video-creation/SceneAssetSelection.vue', match: 'data-testid="sas-preview-image"', reason: '候选素材灯箱大图：点开缩略图后才出现的这张就是操作对象（②），与 ResultView 的同类预览必须同口径。' },
  { file: 'views/CreateView.vue', match: ':src="img.preview"', reason: '刚选中的本地图片预览（③）：src 是 FileReader 的 data URL，本地数据不省流量，懒加载只推迟可见。' },
  { file: 'views/PromptEvalView.vue', match: ':src="img.url"', reason: '待评测图片本身（③）：src 由 URL.createObjectURL(file) 生成本地 blob，lazy 无收益且会打断"图在哪"的判断。' },
]

/** 空话词表：命中任一即理由不合格。理由的**强弱**由人评审，这条只把"最省事写法"挡在门外。 */
const EMPTY_REASON_RE = /以后再说|先这样|回头再说|顺手|都行|随便|默认值|默认的/

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

/**
 * 属性 tokenizer（QM-6 评审 i4）。
 *
 * 第一版是 `attr(attrs,name)` 直接在**整段属性串**上跑正则
 * `(?:^|\s)name\s*=\s*(?:"…"|'…')`。它自称引号感知，却漏了同族另一种形态：
 * **属性名字面量出现在别的属性值里**。实测两向都会错 ——
 * `:alt='loading="lazy"'` 被判成"已声明 loading"（假绿），
 * `:class="'loading=bad'"` 被判成非法值（假红）。
 * 所以这里按「名字 → (可选) = → 带引号的值」逐个 token 走，**值内部不再参与名字匹配**。
 *
 * 只认静态字面量声明：`:loading="x"` 属动态绑定，本合同的口径是"声明必须是看得见的字面量"，
 * 判为缺席（红）是保守方向 —— 动态绑定把 eager/lazy 的决定推迟到运行时，正是要消灭的歧义。
 */
export function attrTokens (attrText) {
  const toks = []
  let i = 0
  while (i < attrText.length) {
    while (i < attrText.length && /\s/.test(attrText[i])) i += 1
    if (i >= attrText.length) break
    const ns = i
    while (i < attrText.length && !/[\s=]/.test(attrText[i])) i += 1
    const name = attrText.slice(ns, i)
    let k = i
    while (k < attrText.length && /\s/.test(attrText[k])) k += 1
    if (attrText[k] !== '=') { toks.push({ name, value: null }); i = k; continue }
    k += 1
    while (k < attrText.length && /\s/.test(attrText[k])) k += 1
    const q = attrText[k]
    if (q === '"' || q === "'" || q === '`') {
      const vs = k + 1
      let j2 = vs
      while (j2 < attrText.length && attrText[j2] !== q) j2 += 1
      toks.push({ name, value: attrText.slice(vs, j2) })
      k = j2 + 1
    } else {
      const vs = k
      let j2 = vs
      while (j2 < attrText.length && !/\s/.test(attrText[j2])) j2 += 1
      toks.push({ name, value: attrText.slice(vs, j2) })
      k = j2
    }
    i = k
  }
  return toks
}

function attr (attrText, name) {
  const hit = attrTokens(attrText).find((t) => t.name === name && t.value !== null)
  return hit ? hit.value.trim() : null
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
      // 逐张授权的锚点域：只在这段属性串里找 EAGER_ALLOWLIST 的 match
      attrs: ot.attrs.replace(/\s+/g, ' '),
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

  it('eager 必须逐张有理由：授权按「文件 + 那张图的锚点」，白名单只能缩小且不得虚挂', () => {
    const eager = all.filter((h) => h.loading === 'eager')
    const unauthorized = eager.filter((h) => !EAGER_ALLOWLIST.some((e) => e.file === h.file && h.attrs.includes(e.match)))
      .map((h) => h.file + ':' + h.line)
    expect(unauthorized, '出现没有理由的 eager（默认值不该被当成"决定"）。注意授权粒度是**单张图**：'
      + '同文件里已有一张被批准的 eager，不会替你新加的那张背书：' + unauthorized.join(' | ')).toEqual([])
    const stale = EAGER_ALLOWLIST.filter((e) => !eager.some((h) => h.file === e.file && h.attrs.includes(e.match)))
      .map((e) => e.file + ' [' + e.match + ']')
    expect(stale, '白名单条目已不再对应任何 eager ⇒ 必须删除（留着就是永久豁免）：' + stale.join(' | ')).toEqual([])
    // 锚点不得互相认领：同一张 eager 若被两条条目同时命中，"逐张授权"就退化成"任挑一条挂着"
    const doubleCovered = eager.filter((h) => EAGER_ALLOWLIST.filter((e) => e.file === h.file && h.attrs.includes(e.match)).length > 1)
      .map((h) => h.file + ':' + h.line)
    expect(doubleCovered, '这些 eager 同时被两条白名单命中 ⇒ 锚点重叠，逐张授权不成立：' + doubleCovered.join(' | ')).toEqual([])
    for (const e of EAGER_ALLOWLIST) {
      expect(e.match, '条目 ' + e.file + ' 缺 match 锚点（文件级豁免就是这么来的）').toBeTruthy()
      expect(e.reason, 'eager 条目 ' + e.file + ' [' + e.match + '] 缺理由').toBeTruthy()
      expect(e.reason.length, 'eager 条目 ' + e.file + ' 的理由过短').toBeGreaterThan(20)
      expect(EMPTY_REASON_RE.test(e.reason), 'eager 条目 ' + e.file + ' 的理由是空话词表里的写法（' + e.reason + '）').toBe(false)
      expect(e.reason, 'eager 条目 ' + e.file + ' 的理由必须点名三条口径之一（①外壳 / ②点开或操作对象 / ③本地内容）')
        .toMatch(/①|②|③|外壳|点开|操作对象|本地/)
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

    // i4：属性名字面量出现在**别的属性值里**，不得被当成声明（第一版在整段属性串上跑正则，两向都错）
    const fake = ['<template>', '  <img :src="url" :alt="\'loading=\\"lazy\\" 这段只是说明文字\'" decoding="async" />', '</template>'].join('\n')
    const f = scanImgTags('FixtureE.vue', fake)
    expect(f).toHaveLength(1)
    expect(f[0].loading, '属性值里的 "loading=\\"lazy\\"" 字面量被当成真声明 ⇒ 漏写会被读成已写（假绿）').toBeNull()
    // 反向：单引号值里含 loading= 也不得被误判成非法值（假红）
    const fake2 = ['<template>', '  <img :src="url" alt=\'a loading=b\' loading="lazy" decoding="async" />', '</template>'].join('\n')
    const f2 = scanImgTags('FixtureF.vue', fake2)
    expect(f2).toHaveLength(1)
    expect(f2[0].loading, '值里的 "loading=b" 抢走了真正的 loading 声明 ⇒ 合法写法被误判').toBe('lazy')
    // tokenizer 自身：无值属性（disabled）与动态名都要有确定行为
    expect(attrTokens(' disabled :src="u" alt=\'x\' ").').map((x) => x.name))
      .toEqual(['disabled', ':src', 'alt', '").'])
  })

  it('理由词表自身：空话必须被拒、在册真实理由必须被放行（否则"理由不得是空话"只是装饰）', () => {
    // 与「词表本身必须闭合」同族的反向锁：仓里现在没有人写空话理由 ⇒
    // "空话词表在工作"这句话**无法**由存量观测到，只能由 fixture 直接测判据本身。
    // （M12 就是把 EMPTY_REASON_RE 改成恒不匹配 —— 没有这条 fixture，那一道变异会 MISSED。）
    expect(EMPTY_REASON_RE.test('以后再说：这张就是用户点开的图，先放着。'), '空话写法没被拒 ⇒ 逐条理由退化成走过场').toBe(true)
    expect(EMPTY_REASON_RE.test('都行，反正这图就是弹窗里点开看的那张'), '空话写法没被拒').toBe(true)
    expect(EMPTY_REASON_RE.test('默认值而已，这张是本地内容'), '空话写法没被拒').toBe(true)
    for (const e of EAGER_ALLOWLIST) {
      expect(EMPTY_REASON_RE.test(e.reason), '在册理由被空话词表误杀：' + e.file + ' [' + e.reason + ']').toBe(false)
      expect(/①|②|③|外壳|点开|操作对象|本地/.test(e.reason), '在册理由没点名三条口径之一：' + e.file).toBe(true)
    }
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
