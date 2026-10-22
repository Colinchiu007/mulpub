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
 * 本工具逐文件起一次 `git show`，主干 1.6k 份产物实测要数分钟 ⇒ 它不是 CI 每 PR 的锁，
 * 是「规格里的数字由谁生产」的那把生产工具；它的判据面由 `ccg-artifact-shape-survey.test.js`
 * 用注入行 + 临时仓真跑采集路径来守。
 *
 * 「闭环 × tier」交叉表（`summarizeClosedTier`）是 `qm6-closure-writeback` design §2
 * 那三条数的唯一生产处。两份词表**都不在本文件里抄**：闭环词表 require 判据的
 * `CLOSED_DEEP_REVIEW_STATUSES`，tier 词表经判据的 `classifyEvidenceTier` 问一次
 * 「这个原始值算不算闭集之外」——重抄任何一份就是第二份事实，两份必然漂移。
 */
const cp = require('child_process')
const { CLOSED_DEEP_REVIEW_STATUSES, SELF_PLAY_RESOLVED_STATUS, classifyEvidenceTier } = require('./check-pr-exec-record.js')

function arg (name, dflt) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}

/** 采集面：git 只在这里出现，其余都是可注入的纯函数。 */
function resolveRef (ref, opts) {
  // 读数必须连着「它量的是哪个 commit」一起报：主干在并发合并，同一条命令隔 4 分钟两次数不同
  // （实测 1658 → 1662），只有 ref 名而不带 sha 的数无法归因，也无法复现。
  const cwd = requireCwd(opts, 'resolveRef')
  try {
    return cp.execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`],
      { encoding: 'utf8', cwd }).trim()
  } catch { return 'unresolvable' }
}

/**
 * `cwd` 是**必填的显式定位键**，不给就当场抛错。
 * 动因（2026-10-21，QM-6 后端轴 i8）：第一版让它默认 `process.cwd()`，于是"测试的临时仓夹具"
 * 与"实际在扫真仓 1662 份产物"在代码上完全同形——症状不是报错而是整条锁挂死数分钟，
 * 读日志的人只会以为机器慢。默认值在这里就是那个把缺陷藏起来的形状。
 */
function requireCwd (opts, who) {
  const cwd = opts && opts.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new Error(`${who}: cwd 必须由调用方显式给出（缺它不报错的话，量的是 process.cwd()，不是你以为的那份仓）`)
  }
  return cwd
}

function collectRows (ref, opts) {
  const cwd = requireCwd(opts, 'collectRows')
  const spawn = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd }
  const names = cp.execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', '.ccg/reviews'], spawn)
    .trim().split(/\r?\n/).filter((n) => n.endsWith('.json'))
  const rows = []
  let parseFail = 0
  for (const n of names) {
    let txt = ''
    try { txt = cp.execFileSync('git', ['show', `${ref}:${n}`], spawn) } catch { parseFail++; continue }
    let j = null
    try { j = JSON.parse(txt) } catch { parseFail++; continue }
    const dr = (j && j.deepReview) || {}
    const pb = dr.performedBy === null ? 'null'
      : (dr.performedBy === undefined ? 'absent' : String(dr.performedBy))
    const f = dr.findings === null ? 'null'
      : (Array.isArray(dr.findings) ? `arr/${dr.findings.length}` : (dr.findings === undefined ? 'absent' : typeof dr.findings))
    rows.push({ file: n, mode: String(j.mode), status: String(dr.status), pb, f, sp: Array.isArray((j.stats || {}).sensitivePathHits) ? j.stats.sensitivePathHits.length : -1, sc: typeof (j.stats || {}).sensitiveContentHits === 'number' ? j.stats.sensitiveContentHits : -1, xr: Array.isArray(dr.externallyReviewed) ? dr.externallyReviewed.length : 0, tier: dr.tier === undefined ? 'absent' : String(dr.tier) })
  }
  return { rows, parseFail, jsonTotal: names.length }
}

/** tier 词表的真源在判据侧：这里只问「原始值算不算闭集之外」，不复制闭集本身。 */
function vocabOfJudgeAuthority (raw) {
  if (raw === 'absent') return 'absent'
  return classifyEvidenceTier({ tier: raw }) === 'unrecognized' ? 'unrecognized' : raw
}

/**
 * 闭环 × tier 交叉表。`closedSet` 与 `vocabOf` **必须由调用方显式透传**：
 * 本仓实测过「多层链上的定位键/词表靠内部默认，漏传不报错、中间两级成死代码」这一型，
 * 所以缺任一项当场抛错，绝不静默回落成一份本地默认词表。
 */
function summarizeClosedTier (rows, opts) {
  const closedSet = opts && opts.closedSet
  const vocabOf = opts && opts.vocabOf
  if (!(closedSet instanceof Set)) {
    throw new Error('summarizeClosedTier: closedSet 必须是调用方透传的 Set（闭环词表真源在 check-pr-exec-record.js，本文件不得抄）')
  }
  if (typeof vocabOf !== 'function') {
    throw new Error('summarizeClosedTier: vocabOf 必须是调用方透传的 function（tier 词表真源在判据侧 classifyEvidenceTier）')
  }
  const m = new Map()
  for (const r of rows) {
    const k = (closedSet.has(r.status) ? 'closed' : 'not-closed') + ' tier=' + vocabOf(r.tier)
    m.set(k, (m.get(k) || 0) + 1)
  }
  const entries = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const closed = rows.filter((r) => closedSet.has(r.status))
  return {
    entries,
    closed: closed.length,
    absentInClosed: closed.filter((r) => vocabOf(r.tier) === 'absent').length,
    tierPresent: rows.filter((r) => vocabOf(r.tier) !== 'absent').length,
    unrecognized: rows.filter((r) => vocabOf(r.tier) === 'unrecognized').length
  }
}

/**
 * 以**自扮演出口**收口的记录有几条、其中带 `externallyReviewed` 条目的有几条（tasks 11.5③ 的
 * 配套可见性）。11.5 选了 ③——自扮演收口永远拿不到 `tier=external` 是正确的，但如果这一档在
 * 读数里与"评过了"混成一行，下一个会话就看不见"高危面只能自扮演收口"到底有多少存量。
 * 分档按 **status**（走的是哪个出口），不按 tier：两者刻意可以重叠（一条记录可以是
 * `self_play_resolved` 而 tier 已是 external），把它们做成互斥就是把这格读数改成药。
 * `closedSet` 与 `selfPlayStatus` 必须显式注入，理由与 summarizeClosedTier 同一条：词表真源在判据侧。
 */
function summarizeSelfPlay (rows, opts) {
  const closedSet = opts && opts.closedSet
  if (!(closedSet instanceof Set)) {
    throw new Error('summarizeSelfPlay: closedSet 必须是调用方透传的 Set（闭环词表真源在 check-pr-exec-record.js，本文件不得抄）')
  }
  const selfPlayStatus = opts && opts.selfPlayStatus
  if (typeof selfPlayStatus !== 'string' || !selfPlayStatus) {
    throw new Error('summarizeSelfPlay: selfPlayStatus 必须是调用方透传的字符串（自扮演出口词表真源在 check-pr-exec-record.js，本文件不得抄）')
  }
  const out = { selfPlayClosed: 0, withExternalReview: 0, withoutExternalReview: 0, externalClosed: 0 }
  for (const r of rows || []) {
    if (!r || !closedSet.has(r.status)) continue
    if (r.tier === 'external') out.externalClosed++
    if (r.status !== selfPlayStatus) continue
    out.selfPlayClosed++
    if (Number(r.xr) > 0) out.withExternalReview++
    else out.withoutExternalReview++
  }
  return out
}

function tally (rows, key) {
  const m = new Map()
  for (const r of rows) { const k = key(r); m.set(k, (m.get(k) || 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
function show (title, entries, cap) {
  console.log(`\n-- ${title} --`)
  if (entries.length === 0) { console.log('     0  （空集也出行：否则「没跑」与「没有记录」逐字同形）'); return }
  for (const [k, v] of (cap ? entries.slice(0, cap) : entries)) console.log(`  ${String(v).padStart(4)}  ${k}`)
}

function main () {
  const REF = arg('ref', 'origin/main')
  // CLI 这一档把"默认就是当前目录"写成**看得见的实参**，而不是藏在函数默认值里。
  const AT = { cwd: process.cwd() }
  const SHA = resolveRef(REF, AT)
  const { rows, parseFail, jsonTotal } = collectRows(REF, AT)

  console.log(`REF=${REF}@${SHA.slice(0, 9)}  json=${jsonTotal}  读不到或解析失败=${parseFail}  参与统计=${rows.length}`)
  show(`performedBy 取值（去重 ${tally(rows, (r) => r.pb).length} 种）`, tally(rows, (r) => r.pb.slice(0, 70)), 12)
  show('mode / status', tally(rows, (r) => `${r.mode} / ${r.status}`), 12)
  show('findings 形状', tally(rows, (r) => r.f))
  show('闭环态下 performedBy 的形态（分级判据的正反样本）',
    tally(rows, (r) => (CLOSED_DEEP_REVIEW_STATUSES.has(r.status)
      ? `${r.status} pb=${r.pb.slice(0, 46)} f=${r.f}` : '-')).filter(([k]) => k !== '-'), 12)
  const selfPlayPrefixButClaimsExternal = rows.filter((r) => /^self-play/.test(r.pb) && /external|claude|opencode/i.test(r.pb))
  console.log(`\n[结论锚点] 以 "self-play" 开头却同时声明做过外部复核的记录条数 = ${selfPlayPrefixButClaimsExternal.length}`)
  console.log('[结论锚点] ⇒ 前缀分级会把这类记录误判成自扮演，故 tier 必须是结构化字段，MUST NOT 从 performedBy 推断')

  show('高危轴：sensitivePathHits 命中条数分布（-1 = 字段缺席）', tally(rows, (r) => String(r.sp)), 12)
  const spNonEmpty = rows.filter((r) => r.sp > 0).length
  const scNonEmpty = rows.filter((r) => r.sc > 0).length
  const scMax = rows.reduce((a, r) => Math.max(a, r.sc), 0)
  console.log(`\n[高危轴读数] pathHits 非空=${spNonEmpty}/${rows.length}  contentHits 非空=${scNonEmpty}/${rows.length}  content 最大值=${scMax}`)
  console.log('[高危轴结论] pathHits 近零 ⇒ 高危面清单不得回读该字段（构造性零，design §9.2 结论一），必须对变更集现算')
  console.log('[高危轴结论] contentHits 会触发，但它答的是「改了加密/凭证内容」，不答「改了守门人」⇒ 只作旁证出声，不作闭环资格（结论二）')
  const tierAbsent = rows.filter((r) => r.tier === 'absent').length
  console.log(`[丙的前提] deepReview.tier 缺席=${tierAbsent}/${rows.length} ⇒ 结构化分级只能对新记录生效，历史产物无源可回填（结论三）`)
  console.log(`[缺口主体] mode 分布见上表 ⇒ 若 single 多于 dual，则真正没被闭环要求覆盖的是被判 single 的那批（结论四）`)

  const ct = summarizeClosedTier(rows, { closedSet: CLOSED_DEEP_REVIEW_STATUSES, vocabOf: vocabOfJudgeAuthority })
  show('闭环 × tier 交叉表（qm6-closure-writeback design §2 三条数的唯一生产处）', ct.entries)
  console.log(`\n[闭环×tier] closed=${ct.closed} 其中 tier=absent=${ct.absentInClosed}` +
    ` ｜ 全库带 tier=${ct.tierPresent}（其中闭集外自造值=${ct.unrecognized}）`)
  const spv = summarizeSelfPlay(rows, { closedSet: CLOSED_DEEP_REVIEW_STATUSES, selfPlayStatus: SELF_PLAY_RESOLVED_STATUS })
  console.log('\n[self-play×外部复核] 以自扮演出口收口=' + spv.selfPlayClosed + ' 其中带 externallyReviewed=' + spv.withExternalReview + ' 不带=' + spv.withoutExternalReview + ' ；tier=external 已闭环=' + spv.externalClosed)
  console.log('[闭环×tier 结论] 已闭环却整段无 tier 的那批 = 判据放行、但来源无法归类的存量；' +
    '闭集外自造值 = 判据一律拦的 unrecognized。两者都不是「有人作弊」，是结构要求由判据提出、结构却无人生产。')
}

if (require.main === module) main()

module.exports = { summarizeSelfPlay, collectRows, resolveRef, requireCwd, summarizeClosedTier, vocabOfJudgeAuthority }
