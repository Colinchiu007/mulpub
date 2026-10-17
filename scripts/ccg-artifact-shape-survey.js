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
  rows.push({ mode: String(j.mode), status: String(dr.status), pb, f })
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
