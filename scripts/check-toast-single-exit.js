#!/usr/bin/env node
/**
 * check-toast-single-exit.js — 「toast 只有一个出口」棘轮（UX 审计 §16.2 口径 ③）
 *
 * 现状（2026-10-19 当场实跑）：`ElMessage.{error,success,warning,info}` 直调 **84** 处 / 22 文件，
 * 而单一出口 `useNotify.js` 已经存在。本门禁落地前实测是 **90** 处 —— 差额 6 处全部在 `useNotify.js`
 * 自己身上（它原先用 `ElMessage.error(...)` 这类**分类型直调**），本批把出口改成泛化 `ElMessage({...})`
 * 后由 90 降到 84。两个数用**同一把尺子**（本文件的 `scan()` + `stripLineComments`）量的：
 * `git show HEAD:apps/desktop/src/composables/useNotify.js` 那份 typed=6 / typed(now)=0，84+6=90 逐字对上，
 * 所以审计 §16.2 的 90 不是口径错，是"批次前的现状"。
 * 策略（时长上限 + 同源合并）只写在出口里 ⇒ 直调那 84 处**绕过策略**。本门禁不要求一次迁完（那会把"出口有没有策略"与
 * "某页文案对不对"混成一次变更，归因互相污染），只保证**存量不再增长、新文件不得开口子**。
 *
 * 四条口径：
 *  ① **按文件计份数**，不按"文件名出现过"计 —— 一个文件从 3 处涨到 4 处必须红，
 *     而"该文件已在基线里"这种存在性判据对此完全免疫（本仓「装饰性门禁」的同型）。
 *  ② `ElMessage(...)` 泛化调用只允许出现在**出口清单**里（默认只有 useNotify.js）。
 *     否则"改用泛化入口"会绕过本门禁 ① 的直调统计 —— 这是门禁自己的漏项，必须一起拦。
 *  ③ 基线只能缩小：任何文件计数上涨、新文件命中、非出口文件用泛化调用 ⇒ 红；
 *     **不提供 `--update-baseline`**，要放宽只能人手改 JSON，改动能在 diff 里被看见。
 *  ④ 扫描域为空 / 有文件读不到 / 真仓文件数退化到个位数 ⇒ rc=2（判据自身故障），
 *     与"发现违规"的 1 分档 —— 把工具的失明读成通过是本仓最忌的形态。
 *
 * 退出码：0 合规 / 1 违规（含陈旧登记：基线里的文件已不再命中，必须删条目）/ 2 自身故障。
 */
'use strict'
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '..')
const DEFAULT_SCAN_ROOT = path.join(REPO, 'apps/desktop/src')
const DEFAULT_BASELINE = path.join(__dirname, 'toast-single-exit-baseline.json')

const DIRECT_RE = /\bElMessage\s*\.\s*(?:error|success|warning|info)\s*\(/g
const GENERIC_RE = /\bElMessage\s*\(/g
const EXIT_ALLOWLIST = ['composables/useNotify.js']

function walk (dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(vue|js|ts)$/.test(ent.name)) out.push(p)
  }
  return out
}
const isTestFile = (rel) => /\.test\.[jt]s$/.test(rel) || /\.spec\.[jt]s$/.test(rel) || rel.startsWith('tests/') || rel.includes('/tests/')

/** 剥整行注释：注释里"举例提到 ElMessage.error("不得计为一次调用（同 5.3 的理由） */
function stripLineComments (src) {
  return src.split(/\r?\n/).map((l) => {
    const t = l.trim()
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--')) return ''
    return l
  }).join('\n')
}

function countIn (re, text) {
  re.lastIndex = 0
  const m = text.match(re)
  return m ? m.length : 0
}

function scan (scanRoot) {
  const all = walk(scanRoot, [])
  const byFile = new Map()
  const genericByFile = new Map()
  const unreadable = []
  for (const f of all) {
    const rel = path.relative(scanRoot, f).replace(/\\/g, '/')
    if (isTestFile(rel)) continue
    let src
    try { src = fs.readFileSync(f, 'utf8') } catch (e) { unreadable.push(rel); continue }
    const code = stripLineComments(src)
    const direct = countIn(DIRECT_RE, code)
    const generic = countIn(GENERIC_RE, code)
    if (direct > 0) byFile.set(rel, direct)
    if (generic > 0) genericByFile.set(rel, generic)
  }
  return { all, byFile, genericByFile, unreadable }
}

function main (argv) {
  const opt = (name) => {
    const hit = argv.find((a) => a.startsWith('--' + name + '='))
    return hit ? hit.slice(name.length + 3) : null
  }
  const scanRoot = opt('scan-root') || DEFAULT_SCAN_ROOT
  const baselinePath = opt('baseline') || DEFAULT_BASELINE
  if (!fs.existsSync(scanRoot)) { console.error('[toast-exit] 扫描根缺失：' + scanRoot); return 2 }
  const { all, byFile, genericByFile, unreadable } = scan(scanRoot)
  if (unreadable.length) { console.error('[toast-exit] 有文件读不到，判据自身故障：' + unreadable.slice(0, 3).join(', ')); return 2 }
  if (all.length === 0 || (byFile.size === 0 && genericByFile.size === 0)) {
    // 判据失明的定义是"什么都没数到"，不是"没有直调"——
    // 只存在泛化调用的仓库状态是可判定的，把它读成"门禁坏了"会让真正的空域与
    // "存量已被迁完"两种情况无法区分（前者该红，后者该绿）。
    console.error('[toast-exit] 扫描域为空或一个调用点都没数到 ⇒ 判据失明（不得读成合规）')
    return 2
  }
  let baseline
  try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) } catch (e) {
    console.error('[toast-exit] 基线读不到或不是合法 JSON：' + e.message)
    return 2
  }
  const base = baseline && baseline.byFile
  if (!base || typeof base !== 'object') { console.error('[toast-exit] 基线缺 byFile 字段'); return 2 }

  const problems = []
  const totalNow = [...byFile.values()].reduce((a, b) => a + b, 0)
  const totalBase = Object.values(base).reduce((a, b) => a + (Number(b) || 0), 0)
  for (const [rel, n] of byFile) {
    const allowed = base[rel]
    if (allowed === undefined) problems.push(`NEW_FILE ${rel} 直调 ${n} 处（出口只有 ${EXIT_ALLOWLIST.join(', ')}）`)
    else if (n > allowed) problems.push(`GREW ${rel}：基线 ${allowed} 处 → 现 ${n} 处（只可缩小）`)
  }
  for (const rel of Object.keys(base)) {
    if (!byFile.has(rel)) problems.push(`STALE_BASELINE ${rel}：已不再命中，必须删掉这条登记`)
  }
  for (const [rel, n] of genericByFile) {
    if (EXIT_ALLOWLIST.some((a) => rel.endsWith(a))) continue
    // 存量泛化调用点同样是"绕过出口的出口"，但**不能因此把它们放行**：
    // 记进基线并只允许缩小，比塞进 allowlist 诚实 —— allowlist 的语义是"这就是那个出口"。
    const allowed = (baseline.genericByFile && baseline.genericByFile[rel])
    if (allowed === undefined) problems.push(`NEW_GENERIC_FILE ${rel}：泛化 ElMessage(...) 直调 ${n} 处，出口只有 ${EXIT_ALLOWLIST.join(', ')}`)
    else if (n > allowed) problems.push(`GREW_GENERIC ${rel}：基线 ${allowed} 处 → 现 ${n} 处（只可缩小）`)
  }
  for (const rel of Object.keys((baseline.genericByFile && typeof baseline.genericByFile === 'object') ? baseline.genericByFile : {})) {
    if (!genericByFile.has(rel)) problems.push(`STALE_GENERIC_BASELINE ${rel}：已不再命中，必须删掉这条登记`)
  }

  const genericTotal = [...genericByFile.values()].reduce((a, b) => a + b, 0)
  console.log('[toast-exit] 域=' + all.length + ' 文件 / 直调文件=' + byFile.size +
    ' / 直调处数=' + totalNow + ' / 基线处数=' + totalBase +
    ' / 泛化处数=' + genericTotal + ' / 违规=' + problems.length)
  for (const p of problems) console.log('  ' + p)
  if (argv.includes('--json')) console.log(JSON.stringify({ totalNow, totalBase, byFile: Object.fromEntries(byFile), problems }))
  if (problems.length) return 1
  console.log('[toast-exit] PASS（存量未增长）')
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { main, scan, stripLineComments, DIRECT_RE, GENERIC_RE, EXIT_ALLOWLIST }
