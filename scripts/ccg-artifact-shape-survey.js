'use strict'
/**
 * ccg-artifact-shape-survey.js —— 普查 .ccg/reviews 判定记录的真实形态分布
 *
 * 为什么入库：`ccg-review-degradation-ladder` 的 design §9 用它的读数否证了
 * 「按 performedBy 前缀分级」这条判据（34 种散文取值）。规格里写进去的覆盖面数字
 * 必须能在仓库里一句话重取，否则就变成「量过一次之后没人再量」的孤立读数。
 *
 * 用法：node scripts/ccg-artifact-shape-survey.js [--ref=origin/main]
 * 数字会随主干增长漂移 ⇒ 引用时现跑，不要把某次输出当常数。
 */
const cp = require('child_process')

function arg (name, dflt) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const REF = arg('ref', 'origin/main')

const names = cp.execFileSync('git', ['ls-tree', '-r', '--name-only', REF, '--', '.ccg/reviews'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .trim().split(/\r?\n/).filter((n) => n.endsWith('.json'))

const rows = []
let parseFail = 0
for (const n of names) {
  let txt = ''
  try { txt = cp.execFileSync('git', ['show', `${REF}:${n}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }) } catch { parseFail++; continue }
  let j = null
  try { j = JSON.parse(txt) } catch { parseFail++; continue }
  const dr = (j && j.deepReview) || {}
  const pb = dr.performedBy === null ? 'null'
    : (dr.performedBy === undefined ? 'absent' : String(dr.performedBy))
  const f = dr.findings === null ? 'null'
    : (Array.isArray(dr.findings) ? `arr/${dr.findings.length}` : (dr.findings === undefined ? 'absent' : typeof dr.findings))
  rows.push({ mode: String(j.mode), status: String(dr.status), pb, f, sp: Array.isArray((j.stats || {}).sensitivePathHits) ? j.stats.sensitivePathHits.length : -1, sc: typeof (j.stats || {}).sensitiveContentHits === 'number' ? j.stats.sensitiveContentHits : -1, tier: dr.tier === undefined ? 'absent' : String(dr.tier) })
}

function tally (key) {
  const m = new Map()
  for (const r of rows) { const k = key(r); m.set(k, (m.get(k) || 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
function show (title, entries, cap) {
  console.log(`\n-- ${title} --`)
  for (const [k, v] of (cap ? entries.slice(0, cap) : entries)) console.log(`  ${String(v).padStart(4)}  ${k}`)
}

console.log(`REF=${REF}  json=${names.length}  读不到或解析失败=${parseFail}  参与统计=${rows.length}`)
show(`performedBy 取值（去重 ${tally((r) => r.pb).length} 种）`, tally((r) => r.pb.slice(0, 70)), 12)
show('mode / status', tally((r) => `${r.mode} / ${r.status}`), 12)
show('findings 形状', tally((r) => r.f))
show('闭环态下 performedBy 的形态（分级判据的正反样本）',
  tally((r) => (r.status === 'cleared' || r.status === 'needs_revision' || r.status === 'self_play_resolved')
    ? `${r.status} pb=${r.pb.slice(0, 46)} f=${r.f}` : '-').filter(([k]) => k !== '-'), 12)
const selfPlayPrefixButClaimsExternal = rows.filter((r) => /^self-play/.test(r.pb) && /external|claude|opencode/i.test(r.pb))
console.log(`\n[结论锚点] 以 "self-play" 开头却同时声明做过外部复核的记录条数 = ${selfPlayPrefixButClaimsExternal.length}`)
console.log('[结论锚点] ⇒ 前缀分级会把这类记录误判成自扮演，故 tier 必须是结构化字段，MUST NOT 从 performedBy 推断')

show('高危轴：sensitivePathHits 命中条数分布（-1 = 字段缺席）', tally((r) => String(r.sp)), 12)
const spNonEmpty = rows.filter((r) => r.sp > 0).length
const scNonEmpty = rows.filter((r) => r.sc > 0).length
const scMax = rows.reduce((a, r) => Math.max(a, r.sc), 0)
console.log(`\n[高危轴读数] pathHits 非空=${spNonEmpty}/${rows.length}  contentHits 非空=${scNonEmpty}/${rows.length}  content 最大值=${scMax}`)
console.log('[高危轴结论] pathHits 近零 ⇒ 高危面清单不得回读该字段（构造性零，design §9.2 结论一），必须对变更集现算')
console.log('[高危轴结论] contentHits 会触发，但它答的是「改了加密/凭证内容」，不答「改了守门人」⇒ 只作旁证出声，不作闭环资格（结论二）')
const tierAbsent = rows.filter((r) => r.tier === 'absent').length
console.log(`[丙的前提] deepReview.tier 缺席=${tierAbsent}/${rows.length} ⇒ 结构化分级只能对新记录生效，历史产物无源可回填（结论三）`)
console.log(`[缺口主体] mode 分布见上表 ⇒ 若 single 多于 dual，则真正没被闭环要求覆盖的是被判 single 的那批（结论四）`)
