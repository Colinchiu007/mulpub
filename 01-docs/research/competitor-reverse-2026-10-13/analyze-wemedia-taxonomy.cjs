/**
 * 融媒宝「平台分类映射」数据集的结构解析与覆盖率统计。
 *
 * 数据来自 `<融媒宝安装目录>/data.zip` → `data/*categortmap.txt` / `*subcategort.txt`。
 * 两类文件的语义（由实际解析得出，非猜测）：
 *   * `*categortmap.txt` —— JSON **数组**：一级分类 {id, name, cates:[{id,name}...]}，**带平台侧 ID**
 *   * `*subcategort.txt` —— JSON **对象**：{一级分类名: [二级分类名...]}，**不带 ID**
 * 形态不统一（缩进/单行、字符串或数字 id、对象套对象），故解析器必须容错并记录失败原因，
 * 而不是把解析失败静默当成"空文件"。
 *
 * 编码：78/130 个文件是 GBK，必须按 GBK 解码，否则中文全乱。
 * 只读；把结果打印到 stdout（JSON 汇总另存到 <dir>/_taxonomy-summary.json）。
 * 用法: node analyze-wemedia-taxonomy.cjs <dir>
 */
const fs = require('node:fs')
const path = require('node:path')

const DIR = process.argv[2]
if (!DIR) { console.error('用法: node analyze-wemedia-taxonomy.cjs <dir>'); process.exit(2) }

const utf8strict = new TextDecoder('utf-8', { fatal: true })
const gbk = new TextDecoder('gbk')
function readText (p) {
  const buf = fs.readFileSync(p)
  try { return { text: utf8strict.decode(buf), enc: 'utf-8' } } catch { return { text: gbk.decode(buf), enc: 'gbk' } }
}

// mulpub 现有平台（config/platforms.yaml 口径，供差距对照）
const MULPUB = ['douyin', 'xiaohongshu', 'kuaishou', 'bilibili', 'tencent_video', 'weibo', 'zhihu',
  'youtube', 'tiktok', 'twitter', 'instagram', 'facebook', 'baijiahao', 'toutiao', 'wechat_mp']

const files = fs.readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)

/** 从文件名推平台 slug：douyinvideocategortmap -> douyin */
function slugOf (name) {
  const m = name.match(/^(.*?)(video)?(sub)?categort(map)?\.txt$/i)
  return m ? m[1] : name.replace(/\.txt$/i, '')
}

/** 容错 JSON：剥掉行注释与尾逗号后 tryParse */
function tryJson (text) {
  const attempts = [
    ['raw', text],
    ['strip-comments', text.replace(/^\s*#.*$/gm, '').replace(/\/\/.*$/gm, '')],
    ['strip-trailing-commas', text.replace(/,\s*([}\]])/g, '$1')],
  ]
  for (const [how, t] of attempts) {
    const s = t.trim()
    if (!s) continue
    try { return { ok: true, value: JSON.parse(s), how } } catch (e) { /* 继续 */ }
  }
  return { ok: false }
}

/** 统计一个 categortmap（数组形态）*/
function statMap (v) {
  if (!Array.isArray(v)) return null
  let l1 = 0; let l2 = 0; let withId = 0; let sampleIds = []
  for (const top of v) {
    if (!top || typeof top !== 'object') continue
    l1++
    if (top.id !== undefined) { withId++; if (sampleIds.length < 5) sampleIds.push(String(top.id)) }
    const cates = top.cates || top.children || top.sub
    if (Array.isArray(cates)) {
      l2 += cates.length
      for (const c of cates) if (c && c.id !== undefined) { withId++; if (sampleIds.length < 5) sampleIds.push(String(c.id)) }
    }
  }
  return { l1, l2, withId, sampleIds }
}

/** 统计一个 subcategort（对象形态）*/
function statSub (v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const keys = Object.keys(v)
  let l2 = 0; let nested = 0
  for (const k of keys) {
    const val = v[k]
    if (Array.isArray(val)) l2 += val.length
    else if (val && typeof val === 'object') { nested++; l2 += Object.keys(val).length }
  }
  return { l1: keys.length, l2, nested }
}

const out = []
let parseFail = []
for (const f of files) {
  if (!/categort/i.test(f)) continue
  const p = path.join(DIR, f)
  const { text, enc } = readText(p)
  const j = tryJson(text)
  const isMap = /categortmap\.txt$/i.test(f)
  if (!j.ok) { parseFail.push({ file: f, bytes: fs.statSync(p).size, lines: text.split(/\r?\n/).length, head: text.slice(0, 120) }); continue }
  const st = isMap ? statMap(j.value) : statSub(j.value)
  out.push({ file: f, slug: slugOf(f), kind: isMap ? 'map' : 'sub', enc, bytes: fs.statSync(p).size, how: j.how, stat: st, parseOk: !!st })
}

console.log('=== 分类映射文件解析结果 ===')
console.log(`  参与解析: ${out.length + parseFail.length}   成功: ${out.filter((x) => x.parseOk).length}   失败: ${parseFail.length}`)
const hows = {}
for (const o of out) hows[o.how] = (hows[o.how] || 0) + 1
console.log('  JSON 容错档位命中: ' + Object.entries(hows).map(([k, v]) => `${k}=${v}`).join('  '))

// 按平台聚合
const bySlug = {}
for (const o of out) {
  bySlug[o.slug] = bySlug[o.slug] || { slug: o.slug, map: null, sub: null }
  bySlug[o.slug][o.kind] = o
}

console.log('\n=== 按平台聚合（一级/二级分类数）===')
const rows = Object.values(bySlug).map((g) => {
  const m = g.map && g.map.stat
  const s = g.sub && g.sub.stat
  return {
    slug: g.slug,
    mapFile: g.map ? g.map.file : '—',
    l1: m ? m.l1 : (s ? s.l1 : null),
    l2: m ? m.l2 : (s ? s.l2 : null),
    bytes: (g.map ? g.map.bytes : 0) + (g.sub ? g.sub.bytes : 0),
    sameL1: m && s ? (m.l1 === s.l1) : null,
    hasId: m ? m.withId > 0 : null,
    sampleIds: m ? m.sampleIds.slice(0, 4) : [],
    layered: s ? s.nested > 0 : null,
  }
}).sort((a, b) => (b.l2 || 0) - (a.l2 || 0))

console.log('  ' + 'platform'.padEnd(26) + 'L1'.padStart(5) + 'L2'.padStart(6) + '  KB'.padStart(8) + '  带ID  两文件一致  例ID')
for (const r of rows) {
  console.log('  ' + r.slug.padEnd(26) + String(r.l1 ?? '?').padStart(5) + String(r.l2 ?? '?').padStart(6)
    + (r.bytes / 1024).toFixed(1).padStart(8) + '  ' + (r.hasId ? ' 是 ' : ' 否 ') + '   '
    + (r.sameL1 === null ? '—' : (r.sameL1 ? '是' : '否')) + '        ' + r.sampleIds.join(','))
}
console.log(`\n  共 ${rows.length} 个平台的分类映射，一级分类合计 ${rows.reduce((a, r) => a + (r.l1 || 0), 0)}，二级分类合计 ${rows.reduce((a, r) => a + (r.l2 || 0), 0)}`)

console.log('\n=== 解析失败的文件（如实列出，不静默当空）===')
for (const f of parseFail) console.log(`  ${f.file}  ${f.bytes} B  ${f.lines} 行  首 120 字: ${f.head.replace(/\s+/g, ' ')}`)

console.log('\n=== 与 mulpub 现有 15 平台的对照 ===')
const have = new Set(rows.map((r) => r.slug.toLowerCase()))
const alias = {
  douyin: ['douyin'], xiaohongshu: ['xhs', 'xiaohongshu'], kuaishou: ['kuaishou', 'kuaichuan'],
  bilibili: ['bilibili'], tencent_video: ['tencentvideo'], weibo: ['weibo'], zhihu: ['zhihu'],
  youtube: [], tiktok: [], twitter: [], instagram: [], facebook: [],
  baijiahao: ['baijia'], toutiao: ['toutiao', 'huitoutiao', 'qqkandian'], wechat_mp: ['weixin', 'wechat'],
}
for (const p of MULPUB) {
  const hits = (alias[p] || [p]).filter((a) => have.has(a))
  console.log(`  ${p.padEnd(16)} ${hits.length ? '有 → ' + hits.join(', ') : '【本数据集无】'}`)
}
const extra = [...have].filter((s) => !MULPUB.some((p) => (alias[p] || [p]).includes(s))).sort()
console.log(`\n  本数据集独有（mulpub 未覆盖）${extra.length} 个: ${extra.join(', ')}`)

fs.writeFileSync(path.join(DIR, '_taxonomy-summary.json'), JSON.stringify({ rows, parseFail, extra }, null, 2))
console.log(`\n汇总已写: ${path.join(DIR, '_taxonomy-summary.json')}`)
