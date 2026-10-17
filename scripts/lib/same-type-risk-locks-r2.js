/**
 * same-type-risk-locks-r2.js — 第二批「竞品缺陷同型风险」锁（R5 + R9a）
 *
 * 来源：`01-docs/research/competitor-reverse-2026-10-13/derived/竞品缺陷同型风险清单.md` §2 的
 * R5（失败分支不复位 UI 状态 ⇒ 按钮永久置灰）与 R9（假进度条）。
 * 第一批四条锁在 `scripts/lib/same-type-risk-locks.js`（L1-L4）——本模块刻意**不并入**：
 * 判据风格不同（L1-L4 是「出现违规形态就红」，R5/R9a 是「审计面」），且第一份 363 行已是既定上限。
 *
 * ## R5 判据（先侦察后立判据，27 处赋值点实测分布：16 finally / 4 finally 外 / 1 顶层 / 6 其他形态）
 *   `loading` 型状态在函数体内置 true 后：
 *   - **函数体内无任何复位（=false）** ⇒ 红（竞品 C3 同型：按钮永久置灰且无反馈）
 *   - 有复位但**不在 finally** ⇒ 出声不拦截（可见面；大量合法写法如「提前 return 前复位」）
 *   判据纪律与第一批一致：注释/字符串先屏蔽；组合式函数（composable）顶层赋值不在函数体判据内，
 *   单独以「audit 面」输出交人工。
 *
 * ## R9a 判据（假进度的最可判定子集）
 *   **固定值心跳进度**：向进度型状态赋**字面量** `0|90|100`（不经计算）的语句数 ≥ 下界即打印
 *   （本轮实测：`CreateView.vue:3320` progress:0、`:3768` progress:100 均为「阶段开始/完成」语义，
 *   不是假进度条 —— 侦察否证了「我们有假进度」的猜想，故 R9a 只锁「新增整段假进度条」的形状：
 *   setTimeout 驱动的递增到固定值。当前 0 命中，锁的作用是防回归。）
 *
 * 纯函数；不读文件系统。CLI 在 scripts/check-same-type-risk-locks.js 里追加调用。
 */

'use strict'

const { CROSS_METHOD_LOADING_MACHINES } = require('./loading-machine-exemptions')

/**
 * 屏蔽注释与字符串（与第一批同语义，独立实现以保持本模块零依赖自洽）。
 * opts.keepStrings 为 true 时保留字符串内容（供需要看字面量的判据用）。
 */
function maskNonCode (src, opts) {
  const keepStrings = !!(opts && opts.keepStrings)
  const out = src.split('')
  let i = 0
  const n = src.length
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ' }
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') { let j = i; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue }
    if (c === '/' && d === '*') { let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; blank(i, Math.min(j + 2, n)); i = Math.min(j + 2, n); continue }
    if (!keepStrings && (c === "'" || c === '"' || c === '`')) {
      const q = c
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === q) { j++; break }
        j++
      }
      blank(i + 1, j - 1)
      i = j
      continue
    }
    i++
  }
  return out.join('')
}

function matchBrace (masked, openIdx) {
  let depth = 0
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === '{') depth++
    else if (masked[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const FN_RE = /(?:function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{|(?:^|\n)[ \t]*(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{)/g
const LOADING_SET_RE = /\b([A-Za-z_$][\w$]*[Ll]oading|[Ll]oading[\w$]*)\s*=\s*true\b/g

/** 找包住 at 的最内层函数体。 */
function enclosingFn (masked, at) {
  let owner = null
  FN_RE.lastIndex = 0
  let m
  while ((m = FN_RE.exec(masked)) !== null) {
    const b = m.index + m[0].length - 1
    const e = matchBrace(masked, b)
    if (e === -1) continue
    if (b < at && at < e && (!owner || b > owner.b)) owner = { b, e }
  }
  return owner
}

/**
 * R5：loading 型状态置 true 后，函数体内无复位 ⇒ 红；复位不在 finally ⇒ 出声。
 * @returns {{ok:boolean, findings:Array, visible:Array, stats:Object}}
 */
function scanLoadingReset (sources) {
  // i7（CCG 13fc9740）：只有**已签核**（pending_signoff 非 true）的登记项才豁免；
  // 未签核的照红 —— agent 起草 / 人类生效的机械分界。
  const exempt = new Set(CROSS_METHOD_LOADING_MACHINES
    .filter((x) => x.pending_signoff !== true)
    .map((x) => x.path + '#' + x.name))
  const findings = []
  const visible = []
  const stats = { setTrue: 0, finallyReset: 0, manualResetNoFinally: 0, noReset: 0, outsideFn: 0 }
  for (const src of sources) {
    const { path, text } = src
    const masked = src._masked || maskNonCode(text)
    const re = new RegExp(LOADING_SET_RE.source, 'g')
    let m
    while ((m = re.exec(masked)) !== null) {
      const name = m[1]
      const at = m.index
      const fn = enclosingFn(masked, at)
      if (!fn) { stats.outsideFn++; visible.push({ path, name, kind: 'outside-fn', detail: '函数体外的 loading 赋值（组合式函数顶层），交人工确认' }); continue }
      stats.setTrue++
      const body = masked.slice(fn.b, fn.e)
      // w4（CCG a9283db4）：lastIndexOf('finally') 会被含 finally 的标识符命中 ⇒ 用词边界正则取最后一个
      let finallyIdx = -1
      let fm2
      const finRe = /\bfinally\b/g
      while ((fm2 = finRe.exec(body)) !== null) finallyIdx = fm2.index
      const resets = [...body.matchAll(new RegExp('\\b' + name + '\\s*=\\s*false\\b', 'g'))].map((x) => x.index + fn.b)
      if (finallyIdx >= 0 && resets.some((r) => r > fn.b + finallyIdx)) { stats.finallyReset++; continue }
      if (resets.length > 0) {
        stats.manualResetNoFinally++
        visible.push({ path, name, kind: 'manual-reset', detail: '复位在 finally 之外（×' + resets.length + '）；合法写法多，出声不拦截' })
        continue
      }
      const key = path + '#' + name
      if (exempt.has(key)) {
        visible.push({ path, name, kind: 'cross-method-machine', detail: '跨方法状态机（已人工登记豁免，见 scripts/lib/loading-machine-exemptions.js）' })
        continue
      }
      // i1（CCG 03daf453）：noReset 必须在豁免之后计数 —— 否则「无复位」指标混入已豁免的
      // 跨方法状态机，监控读数与「无复位=0（豁免后）」的宣称不一致。
      stats.noReset++
      findings.push({
        rule: 'R5-loading-no-reset',
        path,
        detail: name + ' 在函数内置 true 后无任何复位（按钮将永久置灰，竞品 C3 同型）',
      })
    }
  }
  return { ok: findings.length === 0, findings, visible, stats }
}

/**
 * R9a：假进度条的最可判定形状 —— setTimeout/setInterval 驱动、递增到固定值的心跳进度。
 * 判据（红面很窄，宁缺勿滥）：
 *   同一函数体内同时出现
 *     ① 定时器原语（setTimeout|setInterval）
 *     ② 对 progress/percent 型状态赋**字面量**（0/90/100 等，不经计算）
 *   且该状态名同时出现在 ①② 两个语句的 ±2000 字符窗口内。
 * 当前仓 0 命中（侦察否证了「我们有假进度条」的猜想：现有 progress:0/100 都是阶段语义）。
 */
function scanFakeProgress (sources) {
  const findings = []
  const stats = { timerStatements: 0, literalProgressAssigns: 0 }
  for (const src of sources) {
    const { path, text } = src
    const masked = src._maskedKeepStrings || maskNonCode(text)
    const timerRe = /\b(setTimeout|setInterval)\s*\(/g
    let tm
    while ((tm = timerRe.exec(masked)) !== null) {
      stats.timerStatements++
      const winA = Math.max(0, tm.index - 2000)
      const winB = Math.min(masked.length, tm.index + 2000)
      const window = masked.slice(winA, winB)
      const litRe = /\b((?:[A-Za-z_$][\w$]*)?(?:[Pp]rogressText|[Pp]rogress|[Pp]ercent))\s*=\s*(\d{1,3})(?![.\d])/g
      let lm
      while ((lm = litRe.exec(window)) !== null) {
        stats.literalProgressAssigns++
        findings.push({
          rule: 'R9a-fake-progress-heartbeat',
          path,
          detail: '定时器窗口内对 ' + lm[1] + ' 赋字面量 ' + lm[0].split('=')[1].trim() + '（竞品 X-15 型：固定值心跳假进度，与真实完成度无关）',
        })
      }
    }
  }
  return { ok: findings.length === 0, findings, stats }
}

/** 两条一起跑。 */
function scanAllR2 (sources) {
  const prepared = sources.map((s) => ({
    ...s,
    _masked: s._masked || maskNonCode(s.text),
    _maskedKeepStrings: s._maskedKeepStrings || maskNonCode(s.text, { keepStrings: true }),
  }))
  const r5 = scanLoadingReset(prepared)
  const r9 = scanFakeProgress(prepared)
  return {
    ok: r5.ok && r9.ok,
    findings: [...r5.findings, ...r9.findings],
    visible: r5.visible,
    stats: { r5: r5.stats, r9: r9.stats },
  }
}

module.exports = { maskNonCode, matchBrace, scanLoadingReset, scanFakeProgress, scanAllR2 }
