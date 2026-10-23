/**
 * img-loading-contract.test.js — 每个 `<img>` 必须显式声明 loading 与 decoding（UX 审计 4.8 的 `<img>` 半边）
 *
 * 为什么这是一条合同而不是"顺手加属性"：
 * 1. **懒加载是列表页的性能与流量前提**。本仓的图多为头像、平台图标、封面缩略图，
 *    一个列表几十条时默认是「全部立刻下请求」，浏览器还要下载并解码完才让位 ——
 *    用户感知就是「进页面卡一下」。
 * 2. **`decoding="async"` 让解码不阻塞渲染**：默认 `auto` 由浏览器决定，大图解码会占住主线程那一帧
 *    —— 与 AGENTS.md「高频路径不得同步阻塞事件循环」是同一条判据的图像版本。
 * 3. **eager 必须是显式决定**：默认值就是 eager，所以"没写 loading"与"要它立刻加载"在代码里
 *    长得完全一样 —— 本锁要消灭的正是这个歧义。
 *
 * 解析层：**站点与属性一律取自 `@vue/compiler-sfc` 的模板 AST**（QM-6 第二轮 i1/i3 的结构性答案）。
 * 第一版是手写的「裸文本涂白 + 引号感知取开标签 + 属性 tokenizer」三层解析器，
 * 于是每发现一个坑就要补一条 fixture 加一道变异（涂白、自闭合、属性值里的 `>`、
 * 属性名字面量出现在别的属性值里、属性值里的 `<img>` 造伪站点）——
 * **复杂度在螺旋上升，而不是从根上消解**。换成官方解析器后这些形态天然不在扫描域里，
 * 手写的三层连同其对应变异一起删除。
 *
 * 边界（如实声明，不得当成已覆盖）：
 * - 只覆盖模板里的 `<img>` 元素；运行时 `document.createElement('img')` 与 `v-html` 注入的图片在域外
 *   （与叶子角色锁同一类模板级边界）。
 * - `width`/`height` 占位（CLS）本批刻意不做：给错了会把图片拉伸，而封面/缩略图的真实比例是动态的，
 *   正解是容器 `aspect-ratio` 或按原图尺寸写属性 —— 那会改变渲染结果，必须由 CI 的同源基线判，
 *   不得在本批用 `--update-baseline` 消化。登记在 PRD 的后续项里。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc } from '@vue/compiler-sfc'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(HERE, '.')

export const ALLOWED_LOADING = ['lazy', 'eager']
export const ALLOWED_DECODING = ['sync', 'async', 'auto']

/** 空话词表：命中任一即理由不合格。理由的**语义强弱**仍由人评审，这条只挡最省事的写法。 */
const EMPTY_REASON_RE = /以后再说|先这样|回头再说|顺手|都行|随便|默认值|默认的|问题不大/

/**
 * eager 授权清单 —— 粒度是「**一个锚点 + 它应覆盖几张图**」，不是"一个文件"。
 *
 * 四条判据缺一不可：
 *   ① 未被任何锚点覆盖的 eager ⇒ 红（默认值不该被当成"决定"）；
 *   ② 锚点不再覆盖任何 eager ⇒ 陈旧红（留着就是永久豁免）；
 *   ③ 锚点覆盖数 ≠ `covers` ⇒ 红。这条是 QM-6 二轮 i2 补的：第一版只查 ①②，
 *      于是 `CreateView.vue` 里两个 v-for 块共用同一条 `:src="img.preview"` 锚点时无人出声 ——
 *      以后再加一张同形态的无理由 eager 会被旧锚点**静默授权**，那正是文件级豁免的复发形态；
 *   ④ 同一张 eager 被两条锚点同时命中 ⇒ 红（锚点互相认领 = 逐张授权不成立）。
 *
 * 口径三条（与 PRD《图片加载合同》同源，改这里必须同步改 PRD）：
 *  ① 单例、不滚动的应用外壳；② 用户这次操作刚点开/刚要编辑的那张图本身；
 *  ③ 本地内容的预览（`FileReader` 的 data URL 或 `URL.createObjectURL(file)`，允许出现在 v-for 里）。
 *  反向：**远程**列表/网格缩略图一律 lazy，即便在首屏 —— 含壳层里 v-for 出来的小图标
 *  （标签栏 16px 平台图标就是这条的实测落点：它不是"外壳单例"）。
 */
export const EAGER_ALLOWLIST = [
  { file: 'layouts/MpSidebar.vue', match: 'data-testid="mp-sidebar-logo"', covers: 1, reason: '全局侧栏 logo：①不滚动的应用外壳，首屏恒可见，lazy 只会让它晚一帧出现。' },
  { file: 'components/CoverThumbnail.vue', match: 'class="cover-thumbnail__img"', covers: 1, reason: '封面缩略图：③它渲染的就是 coverPreviewUrl —— 用户刚选/刚抽出来的本地封面预览，与同数据的预览弹窗必须同口径。' },
  { file: 'components/CoverPreviewDialog.vue', match: 'data-testid="cover-preview-image"', covers: 1, reason: '封面预览弹窗：②图片本身就是用户点开的对象，lazy 会让弹窗先空一帧，用户会读成"封面没生成"。' },
  { file: 'components/CoverCropDialog.vue', match: 'class="crop-img"', covers: 1, reason: '封面裁剪弹窗：②同上，裁剪器的输入就是这张图，延迟加载等于让用户对着空框操作。' },
  { file: 'views/ResultView.vue', match: ':src="sceneMaterialPreview.url"', covers: 1, reason: '素材预览面：②用户从列表点开的就是这张图，预览空一帧会被读成加载失败。' },
  { file: 'views/video-creation/SceneAssetSelection.vue', match: 'data-testid="sas-preview-image"', covers: 1, reason: '候选素材灯箱大图：②点开缩略图后才出现的这张就是操作对象，与 ResultView 的同类预览必须同口径。' },
  { file: 'views/CreateView.vue', match: ':src="img.preview"', covers: 2, reason: '刚选中的本地图片预览：③src 是 FileReader 的 data URL，本地数据不省流量；管线图与快图两个 v-for 块各一张，故 covers=2。' },
  { file: 'views/PromptEvalView.vue', match: ':src="img.url"', covers: 1, reason: '待评测图片本身：③src 由 URL.createObjectURL(file) 生成本地 blob，lazy 无收益且会打断"图在哪"的判断。' },
]

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

/** 把 AST 上的属性摊平成可锚定的文本（静态 `name="v"`、绑定 `:name="expr"`） */
function attrsText (props) {
  return props.map((p) => (p.type === 6
    ? p.name + (p.value ? '="' + p.value.content + '"' : '')
    : ':' + (p.arg && p.arg.type === 4 ? p.arg.content : '?') + '="' + (p.exp ? p.exp.content : '') + '"')).join(' ')
}

/**
 * 取某个属性的声明值。口径（QM-6 二轮 i8）：
 * 静态字面量与**字符串字面量绑定**（`:decoding="'async'"`）都算已声明 —— 后者是编译期常量，
 * "动态绑定把决定推迟到运行时"那条理由对它并不成立，拒收它是过度拒绝；
 * 而 `:loading="mode"` 这类非常量绑定判为**未声明**（保守红），因为它的决定确实在运行时。
 */
function declared (props, name) {
  for (const p of props) {
    if (p.type === 6 && p.name === name) return { value: p.value ? p.value.content.trim() : '', form: 'static' }
    if (p.type === 7 && p.name === 'bind' && p.arg && p.arg.content === name && p.exp) {
      const m = /^\s*(['"])([^'"]*)\1\s*$/.exec(p.exp.content)
      if (m) return { value: m[2].trim(), form: 'bound-literal' }
      return { value: null, form: 'bound-dynamic' }
    }
  }
  return { value: null, form: 'absent' }
}

/** 一个文件里所有 `<img>` 的声明情况；解析失败一律抛错（不得把"读不完"当成"没有站点"） */
export function scanImgTags (relPath, rawSrc) {
  const { descriptor, errors } = parseSfc(rawSrc, { filename: relPath })
  if (errors.length) throw new Error(relPath + ' SFC 解析失败 ⇒ 判据无从测量：' + errors.map((e) => e.message).join('; '))
  const ast = descriptor.template && descriptor.template.ast
  if (!ast) throw new Error(relPath + ' 模板 AST 取不到 ⇒ 判据失明，不得当作通过')
  const hits = []
  const walk = (node) => {
    if (node && node.type === 1 && node.tag === 'img') {
      const props = node.props.filter((p) => p.type === 6 || p.type === 7)
      const loading = declared(props, 'loading')
      const decoding = declared(props, 'decoding')
      hits.push({
        file: relPath,
        line: node.loc ? node.loc.start.line : 0,
        loading: loading.value,
        decoding: decoding.value,
        loadingForm: loading.form,
        attrs: attrsText(props),
      })
    }
    for (const k of (node && node.children) || []) walk(k)
  }
  walk(ast)
  return hits
}

describe('img 加载合同：每个 <img> 必须显式写 loading，eager 必须有理由', () => {
  const files = listVueFiles(SRC_ROOT)
  const all = []
  for (const p of files) {
    const rel = p.slice(SRC_ROOT.length + 1).replace(/\\/g, '/')
    for (const h of scanImgTags(rel, readFileSync(p, 'utf8'))) all.push(h)
  }
  const eager = all.filter((h) => h.loading === 'eager')
  const coveredBy = (h) => EAGER_ALLOWLIST.filter((e) => e.file === h.file && h.attrs.includes(e.match))

  it('扫描域非空（>100 个 .vue 且确实扫到过 <img>），读数每次打印', () => {
    expect(files.length, '扫描域退化 ⇒ 本锁看不见任何东西').toBeGreaterThan(100)
    expect(all.length, '全仓没扫到任何 <img> ⇒ 判据没在测东西').toBeGreaterThan(0)
    console.log('[IMG-DOMAIN] .vue=' + files.length + ' img站点=' + all.length
      + ' 未声明loading=' + all.filter((h) => !h.loading).length
      + ' 未声明decoding=' + all.filter((h) => !h.decoding).length + ' eager=' + eager.length)
  })

  it('每个 <img> 都必须声明合法的 loading 与 decoding', () => {
    const noLoading = all.filter((h) => !h.loading)
    expect(noLoading, '未声明 loading 的 <img>（默认就是 eager，等于"忘了写"）：'
      + noLoading.map((h) => h.file + ':' + h.line + '[' + h.loadingForm + ']').join(' | ')).toEqual([])
    const noDecoding = all.filter((h) => !h.decoding)
    expect(noDecoding, '未声明 decoding 的 <img>：' + noDecoding.map((h) => h.file + ':' + h.line).join(' | ')).toEqual([])
    const badLoading = all.filter((h) => h.loading && !ALLOWED_LOADING.includes(h.loading))
    expect(badLoading, 'loading 取值不在闭合词表 ' + ALLOWED_LOADING.join('/') + '：'
      + badLoading.map((h) => h.file + ':' + h.line + '=' + h.loading).join(' | ')).toEqual([])
    const badDecoding = all.filter((h) => h.decoding && !ALLOWED_DECODING.includes(h.decoding))
    expect(badDecoding, 'decoding 取值不在闭合词表：' + badDecoding.map((h) => h.file + ':' + h.line + '=' + h.decoding).join(' | ')).toEqual([])
  })

  it('eager 逐锚点授权：未覆盖即红、不再覆盖即陈旧、覆盖数≠声明数即红、互相认领即红', () => {
    const unauthorized = eager.filter((h) => coveredBy(h).length === 0).map((h) => h.file + ':' + h.line)
    expect(unauthorized, '没有理由的 eager（默认值不该被当成"决定"）：' + unauthorized.join(' | ')).toEqual([])
    const stale = EAGER_ALLOWLIST.filter((e) => !eager.some((h) => h.file === e.file && h.attrs.includes(e.match)))
      .map((e) => e.file + ' [' + e.match + ']')
    expect(stale, '锚点已不再覆盖任何 eager ⇒ 必须删除（留着就是永久豁免）：' + stale.join(' | ')).toEqual([])
    const mismatches = EAGER_ALLOWLIST.map((e) => {
      const n = eager.filter((h) => h.file === e.file && h.attrs.includes(e.match)).length
      return n === e.covers ? null : e.file + ' [' + e.match + '] 实际=' + n + ' 声明=' + e.covers
    }).filter(Boolean)
    expect(mismatches, '锚点覆盖数与声明不符（改图必须同步改 covers，否则一条锚点悄悄授权多张图）：'
      + mismatches.join(' | ')).toEqual([])
    const doubleCovered = eager.filter((h) => coveredBy(h).length > 1).map((h) => h.file + ':' + h.line)
    expect(doubleCovered, '同一张 eager 被两条锚点命中 ⇒ 逐张授权不成立：' + doubleCovered.join(' | ')).toEqual([])
    for (const e of EAGER_ALLOWLIST) {
      expect(Number.isInteger(e.covers) && e.covers > 0, '条目 ' + e.file + ' 的 covers 必须是正整数').toBe(true)
      expect(e.reason.length, 'eager 条目 ' + e.file + ' 的理由过短').toBeGreaterThan(20)
      expect(EMPTY_REASON_RE.test(e.reason), '在册理由被空话词表命中：' + e.file + ' [' + e.reason + ']').toBe(false)
      expect(e.reason, 'eager 条目 ' + e.file + ' 必须点名三条口径之一（①/②/③）').toMatch(/①|②|③/)
    }
  })

  it('AST 边界：注释/插值/属性值里的 <img> 字面量不制造站点；跨行属性与自闭合都扫得到', () => {
    const src = [
      '<template>',
      '  <!-- 举例：<img src="a.png"> 这样是漏写 loading -->',
      '  <div>{{ \'<img src="b.png">\' }}</div>',
      '  <UiThing :title="\'文案里写 <img src=c> 只是文字\'" />',
      '  <img :src="url" :title="\'loading=lazy 出现在值里\'" alt="a > b" loading="lazy" decoding="async">',
      '  <img :src="url2"',
      '       loading="lazy"',
      '       decoding="async" />',
      '</template>',
    ].join('\n')
    const hits = scanImgTags('FixtureA.vue', src)
    expect(hits, '注释/插值/属性值里的 <img> 被当成站点（第一版要靠手写涂白才躲开，AST 天然不会）').toHaveLength(2)
    expect(hits.every((h) => h.loading === 'lazy' && h.decoding === 'async'), '跨行写的属性、含 `>` 的 alt 都不得影响解析').toBe(true)
  })

  it('声明形态口径：字符串字面量绑定算已声明，非常量绑定算未声明（i8 的刻意取舍）', () => {
    const hits = scanImgTags('FixtureB.vue', [
      '<template>',
      '  <img :src="u" loading="lazy" :decoding="\'async\'" />',
      '  <img :src="u" :loading="mode" decoding="async" />',
      '</template>',
    ].join('\n'))
    expect(hits).toHaveLength(2)
    expect(hits[0].loadingForm).toBe('static')
    expect(hits[0].decoding, ':decoding="\'async\'" 是编译期常量，拒收它是过度拒绝').toBe('async')
    expect(hits[1].loadingForm, ':loading="mode" 把决定推迟到运行时 ⇒ 判为未声明（保守方向）').toBe('bound-dynamic')
    expect(hits[1].loading).toBeNull()
  })

  it('判据自身必须可被观测到在跑：词表闭合、空话词表、解析失败必须抛错而合法文件不得抛', () => {
    const wrong = scanImgTags('FixtureC.vue', '<template><img src="a.png" loading="immediate" decoding="weird" /></template>')
    expect(wrong).toHaveLength(1)
    expect(ALLOWED_LOADING.includes(wrong[0].loading), 'loading 词表被放宽 ⇒ 任意字符串都算合法').toBe(false)
    expect(ALLOWED_DECODING.includes(wrong[0].decoding), 'decoding 词表被放宽').toBe(false)
    for (const bad of ['以后再说：这张就是用户点开的图，先放着看效果。', '都行，反正这图就是弹窗里点开看的那张', '默认值而已，这张是本地内容']) {
      expect(EMPTY_REASON_RE.test(bad), '空话写法没被拒 ⇒ 逐条理由退化成走过场：' + bad).toBe(true)
    }
    let threwOk = ''
    try { scanImgTags('FixtureD.vue', '<template><img src="a.png" loading="lazy" decoding="async" /></template>') } catch (e) { threwOk = 'THREW' }
    expect(threwOk, '合法文件不得抛错 —— 否则"解析失败必抛"会被误读成"任何解析都抛"').toBe('')
    let threwBad = ''
    try { scanImgTags('FixtureE.vue', '<template><img src="a.png"></template>\n<<template>尾巴多余') } catch (e) { threwBad = 'THREW' }
    expect(threwBad, 'SFC 解析失败必须抛错；静默返回空站点集合会把"读不完"读成"没有违规"').toBe('THREW')
  })
})
