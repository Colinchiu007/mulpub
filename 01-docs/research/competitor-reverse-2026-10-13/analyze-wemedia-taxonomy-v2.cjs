/**
 * 融媒宝「平台分类映射」数据集的**形态无关**解析与统计（v2）。
 *
 * v1 的教训（必须记住）：我按「{id,name,cates:[{id,name}]}」一种形态写了解析器，
 * 结果 douyin（{code,text} 扁平）、baijia（{child,...} 嵌套）、sohu（{childrenCate,
 * level,parentCate,title,titles} 任意深度）三类**静默产出 L2=0**，报表因此少算。
 * 解析失败必须以「未识别形态」显式报出，绝不静默当 0。
 *
 * v2 做法：不预设键名。对每个 JSON 值递归遍历，凡是**对象**就尝试判定它是不是一个
 * 分类节点（有任一 id 类字段 + 任一 name 类字段），子节点取任一 children 类字段；
 * 同时记录实际命中的键名，供人工核对。
 *
 * 只读。用法: node analyze-wemedia-taxonomy-v2.cjs <dir>
 */
const fs = require('node:fs')
const path = require('node:path')

const DIR = process.argv[2]
if (!DIR) { console.error('用法: node analyze-wemedia-taxonomy-v2.cjs <dir>'); process.exit(2) }

const utf8strict = new TextDecoder('utf-8', { fatal: true })
const gbk = new TextDecoder('gbk')
function readText (p) {
  const b = fs.readFileSync(p)
  try { return { text: utf8strict.decode(b), enc: 'utf-8' } } catch { return { text: gbk.decode(b), enc: 'gbk' } }
}

const ID_KEYS = ['id', 'code', 'cateId', 'cate_id', 'categoryId', 'category_id', 'value', 'key', 'channel_id', 'channelId']
const NAME_KEYS = ['name', 'text', 'title', 'label', 'channel', 'channel_chinese', 'cateName', 'cate_name']
const CHILD_KEYS = ['cates', 'child', 'children', 'childrenCate', 'sub', 'subs', 'list', 'items', 'cateList', 'childCate', 'childrenCates']

function asArrayOfStrings (v) { return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null }

/** 递归遍历，返回 {nodes, maxDepth, levelCounts, idKeyHits, nameKeyHits, childKeyHits} */
function walk (root) {
  const st = { nodes: 0, maxDepth: 0, levelCounts: {}, idKeyHits: {}, nameKeyHits: {}, childKeyHits: {}, leaves: 0, leafNames: [] }
  const seenPair = new Set()

  /** 形态 C：{"一级分类名": ["二级名", ...] | {子名: ...}} —— **键即分类名**，无 id。
   *  实测 36 个 *subcategort.txt 全是此形态，v2 首版因要求「有 name 字段」而漏掉。*/
  function walkNameMap (obj, depth) {
    for (const [k, v] of Object.entries(obj)) {
      st.nodes++
      const d = depth + 1
      st.levelCounts[d] = (st.levelCounts[d] || 0) + 1
      if (d > st.maxDepth) st.maxDepth = d
      seenPair.add(d + '\u0000' + k)
      st.leafNames.push({ name: k, depth: d, hasId: false })
      if (Array.isArray(v)) {
        for (const s of v) {
          if (typeof s !== 'string') continue
          st.nodes++
          st.levelCounts[d + 1] = (st.levelCounts[d + 1] || 0) + 1
          if (d + 1 > st.maxDepth) st.maxDepth = d + 1
          seenPair.add((d + 1) + '\u0000' + s)
          st.leafNames.push({ name: s, depth: d + 1, hasId: false })
        }
      } else if (v && typeof v === 'object') {
        walkNameMap(v, d)
      }
    }
    st.nameKeyHits['(键即名)'] = (st.nameKeyHits['(键即名)'] || 0) + 1
  }

  /** 形态 C 的判定：值为「字符串数组」或「嵌套对象」或 **null**（实测 sohusubcategort.txt /
   *  toutiaovideosubcategort.txt 就是 `{"新闻资讯":null, ...}` —— 一级分类无二级）。
   *  v2 首版因 null 不满足「数组或对象」而把这 14 个文件判成未识别。*/
  const isNameMapValue = (v) =>
    (Array.isArray(v) && v.every((x) => typeof x === 'string')) ||
    (v !== null && typeof v === 'object' && !Array.isArray(v)) ||
    v === null
  const isNameMap = root && !Array.isArray(root) && typeof root === 'object' &&
    Object.keys(root).length > 0 &&
    Object.values(root).every(isNameMapValue)
  if (isNameMap) { walkNameMap(root, 0); st.uniqueNames = seenPair.size; st.idKey = null; st.nameKey = '(键即名)'; st.childKey = '(值)'; return st }

  function visit (node, depth) {
    if (depth > 24) return // 防御
    if (Array.isArray(node)) { for (const c of node) visit(c, depth); return }
    if (!node || typeof node !== 'object') return

    // 记录键命中（只看本层）
    for (const k of Object.keys(node)) {
      if (ID_KEYS.includes(k)) st.idKeyHits[k] = (st.idKeyHits[k] || 0) + 1
      if (NAME_KEYS.includes(k)) st.nameKeyHits[k] = (st.nameKeyHits[k] || 0) + 1
      if (CHILD_KEYS.includes(k)) st.childKeyHits[k] = (st.childKeyHits[k] || 0) + 1
    }

    const idKey = Object.keys(node).find((k) => ID_KEYS.includes(k) && node[k] !== undefined && node[k] !== null && node[k] !== '')
    const nameKey = Object.keys(node).find((k) => NAME_KEYS.includes(k) && typeof node[k] === 'string' && node[k].trim())
    const childKey = Object.keys(node).find((k) => CHILD_KEYS.includes(k) && (Array.isArray(node[k]) || (node[k] && typeof node[k] === 'object')))

    if (nameKey) {
      st.nodes++
      const d = depth + 1
      st.levelCounts[d] = (st.levelCounts[d] || 0) + 1
      if (d > st.maxDepth) st.maxDepth = d
      st.leafNames.push({ name: node[nameKey], depth: d, hasId: !!idKey })
      // 同名同层去重统计（有些数据集把同一分类抄了多份）
      seenPair.add(d + '\u0000' + node[nameKey])
    }

    if (childKey) {
      const kids = node[childKey]
      if (Array.isArray(kids)) for (const c of kids) visit(c, depth + 1)
      else visit(kids, depth + 1)
    }
  }

  visit(root, 0)
  st.uniqueNames = seenPair.size
  st.idKey = Object.entries(st.idKeyHits).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  st.nameKey = Object.entries(st.nameKeyHits).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  st.childKey = Object.entries(st.childKeyHits).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  return st
}

function tryJson (text) {
  const s = text.trim()
  try { return { ok: true, value: JSON.parse(s) } } catch { /* 剥注释/尾逗号再试 */ }
  try { return { ok: true, value: JSON.parse(s.replace(/^\s*#.*$/gm, '').replace(/,\s*([}\]])/g, '$1')) } } catch { }
  return { ok: false }
}

const files = fs.readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isFile() && /categort/i.test(e.name)).map((e) => e.name)
const rows = []; const unknown = []
for (const f of files) {
  const p = path.join(DIR, f)
  const { text, enc } = readText(p)
  const j = tryJson(text)
  const isMap = /categortmap\.txt$/i.test(f)
  if (!j.ok) { unknown.push({ f, why: 'JSON 解析失败' }); continue }
  const isFlatStringArray = asArrayOfStrings(isMap ? j.value : null)
  const st = isFlatStringArray ? { flatStringArray: true, nodes: isFlatStringArray.length, levelCounts: { 1: isFlatStringArray.length }, maxDepth: 1, idKey: null, nameKey: '(裸字符串)', childKey: null, uniqueNames: new Set(isFlatStringArray).size, leafNames: [] } : walk(j.value)
  if (!st.nodes) unknown.push({ f, why: '遍历到 0 个分类节点（形态未识别）' })
  rows.push({ f, kind: isMap ? 'map' : 'sub', enc, bytes: fs.statSync(p).size, ...st })
}

const slugOf = (n) => (n.match(/^(.*?)(video)?(sub)?categort(map)?\.txt$/i) || [, n])[1]
const bySlug = {}
for (const r of rows) { const s = slugOf(r.f); (bySlug[s] = bySlug[s] || []).push(r) }

console.log('=== 形态无关解析结果（v2）===')
console.log(`  文件 ${rows.length} 个；识别出节点的 ${rows.filter((r) => r.nodes > 0).length} 个；未识别 ${unknown.length} 个`)
console.log(`  最大深度分布: ` + Object.entries(rows.reduce((a, r) => { a[r.maxDepth] = (a[r.maxDepth] || 0) + 1; return a }, {})).sort().map(([k, v]) => `深度${k}:${v}个`).join('  '))
const idK = {}; const chK = {}
for (const r of rows) { if (r.idKey) idK[r.idKey] = (idK[r.idKey] || 0) + 1; if (r.childKey) chK[r.childKey] = (chK[r.childKey] || 0) + 1 }
console.log(`  id 类键命中分布: ` + Object.entries(idK).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '))
console.log(`  子节点键命中分布: ` + Object.entries(chK).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '))
if (unknown.length) { console.log('\n  ⚠ 未识别形态（不静默当 0）:'); for (const u of unknown) console.log(`    ${u.f}  —— ${u.why}`) }

console.log('\n=== 按平台聚合（v2，含深度）===')
const F = Object.entries(bySlug).map(([slug, g]) => {
  const total = g.reduce((a, r) => a + r.nodes, 0)
  const uniq = g.reduce((a, r) => a + (r.uniqueNames || 0), 0)
  const maxD = Math.max(...g.map((r) => r.maxDepth))
  const lv = {}
  for (const r of g) for (const [k, v] of Object.entries(r.levelCounts)) lv[k] = (lv[k] || 0) + v
  return { slug, total, uniq, maxD, lv, files: g.length, bytes: g.reduce((a, r) => a + r.bytes, 0), idKey: g.find((r) => r.idKey)?.idKey || null, childKey: g.find((r) => r.childKey)?.childKey || null }
}).sort((a, b) => b.total - a.total)

console.log('  ' + 'platform'.padEnd(24) + '节点'.padStart(6) + '去重'.padStart(6) + '深度'.padStart(5) + '  KB'.padStart(8) + '  id键'.padEnd(12) + '子键'.padEnd(14) + '各层节点')
for (const r of F) {
  const lvStr = Object.entries(r.lv).sort((a, b) => a[0] - b[0]).map(([k, v]) => `L${k}:${v}`).join(' ')
  console.log('  ' + r.slug.padEnd(24) + String(r.total).padStart(6) + String(r.uniq).padStart(6) + String(r.maxD).padStart(5)
    + (r.bytes / 1024).toFixed(1).padStart(8) + '  ' + String(r.idKey || '—').padEnd(12) + String(r.childKey || '—').padEnd(14) + lvStr)
}
console.log(`\n  合计: ${F.length} 个平台 / ${F.reduce((a, r) => a + r.total, 0)} 个分类节点 / ${(F.reduce((a, r) => a + r.bytes, 0) / 1024).toFixed(0)} KB`)
console.log(`  最深平台: ${F[0].slug} 深度 ${Math.max(...F.map((r) => r.maxD))}`)

fs.writeFileSync(path.join(DIR, '_taxonomy-summary-v2.json'), JSON.stringify({ platforms: F, unknown, files: rows.map(({ leafNames, ...r }) => r) }, null, 2))
console.log(`\n汇总: ${path.join(DIR, '_taxonomy-summary-v2.json')}`)

// ── fail-loud：未识别形态必须让进程非零退出 ──
// 只打印不退出，等于把「我没看懂」降级成一条日志 —— 下游（人或脚本）照样会拿偏小的数字当结论。
// 本脚本 v1 就是这么把 11,623 个节点报成 3,838 的（少算 67%），故此处必须机械拦截。
if (unknown.length) {
  console.error(`\n❌ 有 ${unknown.length} 个文件形态未识别 —— 上面的节点总数是**下界**，不得作为结论引用。`)
  console.error('   请为每个未识别文件补充形态支持后重跑：')
  for (const u of unknown) console.error(`     · ${u.f}  —— ${u.why}`)
  process.exitCode = 1
} else {
  console.log('✅ 全部文件形态已识别，节点总数为完整计数')
  process.exitCode = 0
}
