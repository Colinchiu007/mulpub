#!/usr/bin/env node
/**
 * check-toast-single-exit.js — 「toast 只有一个出口」棘轮（UX 审计 §16.2 口径 ③）
 *
 * 现状（2026-10-19 当场实跑，仪器 = 本文件的 `scan()` + `stripLineComments`）：
 * 判定域（**出口之外**）直调 **84** 处 / 22 文件、泛化 6 处、成员 0 处；出口内 typed=1 + member=1 由豁免吸收。
 * 批次前实测是 **90** 处，口径差就一处：那时候出口自己的 6 处 `ElMessage.error(...)` 这类**分类型直调**也在域内。
 * 本批把那 6 处收成 2 处，并且出口整体退出判定域（它就是要被允许调用宿主的那个地方），
 * 于是 90 = 84（出口之外，未动）+ 6（出口自身，已收）——**两个数是同一把尺子的两个时刻**，不是两套尺子。
 * 全仓现场调用点合计 86 = 84（域内）+ 2（出口内）。
 *
 * 2026-10-19 re-sync：主干 PR #3978（film-engineering 五条缺陷修复）在 views/FilmCanvasView.vue 新增 1 处 ElMessage.error( 直调，本门禁当场判 GREW 并点名该文件（第一次真实拦截，动因来自 trunk、不是本分支）。按「不在本次改动集里的上涨归因给 base 并逐项出声」口径把基线 12→13（总数 84→85），不做静默放宽、不改判据。
 * 策略（时长上限 + 同源合并）只写在出口里 ⇒ 直调那 84 处**绕过策略**。本门禁不要求一次迁完（那会把"出口有没有策略"与
 * "某页文案对不对"混成一次变更，归因互相污染），只保证**存量不再增长、新文件不得开口子**。
 *
 * 四条口径：
 *  ① **按文件计份数**，不按"文件名出现过"计 —— 一个文件从 3 处涨到 4 处必须红，
 *     而"该文件已在基线里"这种存在性判据对此完全免疫（本仓「装饰性门禁」的同型）。
 *  ② ElMessage 的**三种调用形态**都计入：`ElMessage.error(` 直调、`ElMessage({...})` 泛化、
 *     `ElMessage[type]({...})` 成员。只允许出现在**出口**（`EXIT_ALLOWLIST`，出口豁免覆盖三态）。
 *     否则"换一种写法"就能绕过 ① 的份数统计 —— 而出口自己用的正是成员形态，
 *     豁免若只覆盖泛化那一态，门禁会把自己的出口判成违规。
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
// 第三种形态：`ElMessage[type]({...})`。出口本身就用这一形（档位由变量承载），
// 所以它必须与上面两种一样被计入并靠出口豁免拦住——否则"改用方括号取值"就是门禁自己的漏项。
const MEMBER_RE = /\bElMessage\s*\[/g
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
  const memberByFile = new Map()
  const exitByFile = new Map()
  const unreadable = []
  for (const f of all) {
    const rel = path.relative(scanRoot, f).replace(/\\/g, '/')
    if (isTestFile(rel)) continue
    let src
    try { src = fs.readFileSync(f, 'utf8') } catch (e) { unreadable.push(rel); continue }
    const code = stripLineComments(src)
    const direct = countIn(DIRECT_RE, code)
    const generic = countIn(GENERIC_RE, code)
    const member = countIn(MEMBER_RE, code)
    // 出口豁免覆盖**全部三种形态**：出口就是那个出口，它调用 ElMessage 定义上不是绕过。
    // 只豁免泛化形态会把真相写歪——出口改用方括号形态后，门禁会把自己的出口判成违规。
    if (EXIT_ALLOWLIST.some((a) => rel.endsWith(a))) {
      if (direct || generic || member) exitByFile.set(rel, { direct, generic, member })
      continue
    }
    if (direct > 0) byFile.set(rel, direct)
    if (generic > 0) genericByFile.set(rel, generic)
    if (member > 0) memberByFile.set(rel, member)
  }
  return { all, byFile, genericByFile, memberByFile, exitByFile, unreadable }
}

function main (argv) {
  const opt = (name) => {
    const hit = argv.find((a) => a.startsWith('--' + name + '='))
    return hit ? hit.slice(name.length + 3) : null
  }
  const scanRoot = opt('scan-root') || DEFAULT_SCAN_ROOT
  const baselinePath = opt('baseline') || DEFAULT_BASELINE
  if (!fs.existsSync(scanRoot)) { console.error('[toast-exit] 扫描根缺失：' + scanRoot); return 2 }
  const { all, byFile, genericByFile, memberByFile, exitByFile, unreadable } = scan(scanRoot)
  if (unreadable.length) { console.error('[toast-exit] 有文件读不到，判据自身故障：' + unreadable.slice(0, 3).join(', ')); return 2 }
  if (all.length === 0 || (byFile.size === 0 && genericByFile.size === 0 && memberByFile.size === 0 && exitByFile.size === 0)) {
    // 判据失明的定义是"什么都没数到"，不是"没有直调"——
    // 只存在成员形态调用、或只有出口在调用的仓库状态都是**可判定的**，
    // 把它读成"门禁坏了"会让真正的空域与"存量已被迁完"两种情况无法区分（前者该红，后者该绿）。
    // 加第三/第四张计数图时必须一起放进这条判据，否则新那张图**永远救不了**旧的 blindness（本轮由自测当场抓住）。
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
  // 方括号形态：出口之外出现即红（出口自己用这一形，已由 scan 的出口豁免移出判定域）。
  // 没有这一档，"改用 ElMessage[type](...)" 就是门禁的第四个漏项——而它恰好是出口的正解形态。
  for (const [rel, n] of memberByFile) {
    const allowed = baseline.memberByFile && baseline.memberByFile[rel]
    if (allowed === undefined) problems.push(`NEW_MEMBER_FILE ${rel}：ElMessage[...] 成员形态 ${n} 处，出口只有 ${EXIT_ALLOWLIST.join(', ')}`)
    else if (n > allowed) problems.push(`GREW_MEMBER ${rel}：基线 ${allowed} 处 → 现 ${n} 处（只可缩小）`)
  }
  for (const rel of Object.keys((baseline.memberByFile && typeof baseline.memberByFile === 'object') ? baseline.memberByFile : {})) {
    if (!memberByFile.has(rel)) problems.push(`STALE_MEMBER_BASELINE ${rel}：已不再命中，必须删掉这条登记`)
  }
  const memberTotal = [...memberByFile.values()].reduce((a, b) => a + b, 0)
  const exitTotal = [...exitByFile.values()].reduce((a, x) => a + x.direct + x.generic + x.member, 0)
  console.log('[toast-exit] 域=' + all.length + ' 文件 / 直调文件=' + byFile.size +
    ' / 直调处数=' + totalNow + ' / 基线处数=' + totalBase +
    ' / 泛化处数=' + genericTotal + ' / 成员处数=' + memberTotal +
    ' / 出口内=' + exitTotal + ' / 违规=' + problems.length)
  for (const p of problems) console.log('  ' + p)
  if (argv.includes('--json')) console.log(JSON.stringify({ totalNow, totalBase, byFile: Object.fromEntries(byFile), problems }))
  if (problems.length) return 1
  console.log('[toast-exit] PASS（存量未增长）')
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { main, scan, stripLineComments, DIRECT_RE, GENERIC_RE, MEMBER_RE, EXIT_ALLOWLIST }
