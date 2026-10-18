#!/usr/bin/env node
/**
 * check-danger-confirm.js —— 破坏性写入口必须经确认原语（UX-AUDIT-2026-10-17 阶段 0.4 / audit-12）
 *
 * 动因：utils/confirm-danger.js 的注释自称「所有删除类/不可逆操作必须经由此函数」，
 * 实测只有 4 个消费点；其余走 notifyConfirm（48 处）、ConfirmDialog、两步内联 ——
 * 契约与现实不符，且没有任何东西在检测它。审计结论：先把确认原语硬化成**有门禁的**，
 * 之后才允许其它 finding 把它当已硬化原语引用（评审 w6 的定序要求）。
 *
 * 判据（口径必须写清，不写"任何文件不得调用删除 API"那种不可实现的空话）：
 *  1. 破坏性 API 清单**由 `apps/desktop/src/api/**` 的导出动态派生**（动词后缀
 *     Delete/Clear/Remove/Revoke/Erase/Destroy/Purge），不维护第二份手抄名单 ——
 *     手抄名单会让"新增一个 deleteX API"落到门禁的盲区里。
 *  2. 判定单位是**函数作用域**：调用点所在的最内层函数体内必须出现确认动作
 *     （confirmDanger / notifyConfirm / ElMessageBox.confirm / 组件内自造的确认弹窗出口
 *     showConfirm）。只要求"同文件出现过确认"是假判据 —— 那会让"确认写在别的函数里"过关。
 *  3. 豁免走 `scripts/danger-confirm-debt.json`，按 `文件#函数` 为键并必须带 reason；
 *     清单**只能缩小**，登记项对应函数已消失即报陈旧。
 *
 * 退出码：0 合规 / 1 发现违规或陈旧登记 / 2 判据自身故障（解析不动、路径缺失）
 */
'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_ROOT = 'apps/desktop/src'
const DEBT_FILE = 'scripts/danger-confirm-debt.json'
const DESTRUCTIVE_SUFFIX = /(Delete|Clear|Remove|Revoke|Erase|Destroy|Purge)([A-Z0-9_]|$)/
const CONFIRM_UNIFIED = /(?:\bconfirmDanger\s*\(|\bnotifyConfirm\s*\()/
// 第二档只回答「这个文件里到底有没有确认动作」，不证明确认挂在正确的调用链上 ——
// 收敛到统一原语是后续阶段的工作，本判据的职责是**不再新增无确认的写入口**。
// 注意必须排除对**所在函数自身**的调用（`confirmRunDeletion()` 出现在 confirmRunDeletion 里
// 是递归引用，不是确认），否则会把「函数名带 confirm」误判成「已确认」。
const CONFIRM_ANY = /(?:\bconfirmDanger\s*\(|\bnotifyConfirm\s*\(|\bElMessageBox\s*\.\s*confirm\s*\(|\bshowConfirm\s*\(|<\s*ConfirmDialog|\bConfirmDialog\b|\bconfirmDelete\s*\(|\bconfirmRemoval\s*\()/
const EXPORT_FN = /export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/g
// 控制流关键字会撞进「对象方法」那条正则（`for (x of y) {` / `if (a) {`），
// 于是作用域被命名成 for/if，"最内层函数"判定就整体失真 —— 必须先剔掉。
const NOT_A_FUNCTION_NAME = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'return', 'typeof', 'await',
  'function', 'new', 'super', 'yield', 'match',
])

/**
 * 字符级掩码：把字符串/模板串/注释/正则字面量内的字节替换成空格，
 * 这样后续的括号配对与调用点扫描不会被文本内容误导。
 * 必须识别正则字面量（`/.../` 里的引号不是字符串起点），否则属性里的引号会把后续字节整体吞掉。
 */
function maskNonCode (src) {
  const out = src.split('')
  let i = 0
  let state = 'code' // code | sq | dq | tpl | lc | bc | rx
  const prevMeaningful = () => {
    for (let k = i - 1; k >= 0; k -= 1) {
      const c = src[k]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue
      return c
    }
    return ''
  }
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'lc'; out[i] = ' '; i += 1; continue }
      if (c === '/' && n === '*') { state = 'bc'; out[i] = ' '; i += 1; continue }
      if (c === "'") { state = 'sq' } else if (c === '"') { state = 'dq' } else if (c === '`') { state = 'tpl' }
      else if (c === '/') {
        // 只有出现在「运算符/开括号/逗号/行首」之后的 / 才是正则字面量的起点
        const p = prevMeaningful()
        if ('=([{,;:&|!?+'.includes(p) || p === '') state = 'rx'
      }
    } else if (state === 'lc') {
      if (c === '\n') state = 'code'; else out[i] = ' '
    } else if (state === 'bc') {
      if (c === '*' && n === '/') { out[i] = ' '; out[i + 1] = ' '; i += 2; state = 'code'; continue }
      if (c !== '\n') out[i] = ' '
    } else if (state === 'sq') {
      if (c === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === "'") state = 'code'; else if (c !== '\n') out[i] = ' '
    } else if (state === 'dq') {
      if (c === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === '"') state = 'code'; else if (c !== '\n') out[i] = ' '
    } else if (state === 'tpl') {
      if (c === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === '`') state = 'code'; else if (c !== '\n') out[i] = ' '
    } else if (state === 'rx') {
      if (c === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === '[') { out[i] = ' '; i += 1; while (i < src.length && src[i] !== ']') { if (src[i] !== '\n') out[i] = ' '; i += 1 } continue }
      if (c === '/') { state = 'code' } else if (c !== '\n') out[i] = ' '
    }
    i += 1
  }
  return out.join('')
}

/** 从掩码文本里切出所有函数作用域：函数名（或 <anon>）+ 起止偏移 */
function findFunctions (masked) {
  const heads = []
  const patterns = [
    /(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]*)\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:function\s*\*)?\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/g,
    /^\s*(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/gm,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(masked)) !== null) {
      if (m[1] && NOT_A_FUNCTION_NAME.has(m[1])) continue
      const brace = masked.indexOf('{', m.index + m[0].length - 1)
      if (brace === -1) continue
      heads.push({ name: m[1] || '<anon>', at: brace })
    }
  }
  const scopes = []
  for (const h of heads) {
    const end = matchBrace(masked, h.at)
    if (end === -1) throw new Error(`括号不闭合，无法定位函数 ${h.name} 的作用域终点`)
    scopes.push({ name: h.name, start: h.at, end })
  }
  // 由内到外排序，取"包含调用点的最内层作用域"
  scopes.sort((a, b) => (a.start - b.start) || (b.end - a.end))
  return scopes
}

function matchBrace (masked, openIndex) {
  let depth = 0
  for (let i = openIndex; i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1
    else if (masked[i] === '}') { depth -= 1; if (depth === 0) return i }
  }
  return -1
}

function innermostScope (scopes, index) {
  let best = null
  for (const s of scopes) {
    if (s.start <= index && index <= s.end) {
      if (!best || (s.end - s.start) < (best.end - best.start)) best = s
    }
  }
  return best
}

function lineOf (src, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) if (src[i] === '\n') line += 1
  return line
}

function listSourceFiles (absDir, out = []) {
  let entries
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }) } catch (e) { throw new Error(`扫描根读不动：${absDir} —— ${e.message}`) }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const full = path.join(absDir, e.name)
    if (e.isDirectory()) listSourceFiles(full, out)
    else if (e.isFile() && (e.name.endsWith('.vue') || e.name.endsWith('.js')) && !/\.(test|spec)\.[jt]s$/.test(e.name)) out.push(full)
  }
  return out
}

/** 破坏性 API 名单：由 api/ 目录的导出派生（单一真源，禁止手抄第二份） */
function collectDestructiveApis (repoRoot, root) {
  const apiDir = path.join(repoRoot, root, 'api')
  if (!fs.existsSync(apiDir)) throw new Error(`API 定义目录不存在：${root}/api —— 名单无从派生`)
  const names = new Set()
  for (const file of listSourceFiles(apiDir)) {
    const masked = maskNonCode(fs.readFileSync(file, 'utf8'))
    let m
    EXPORT_FN.lastIndex = 0
    while ((m = EXPORT_FN.exec(masked)) !== null) {
      if (DESTRUCTIVE_SUFFIX.test(m[1])) names.add(m[1])
    }
  }
  if (names.size === 0) throw new Error('破坏性 API 名单解析出空集 —— 判据退化，不判绿')
  return names
}

function loadDebt (repoRoot) {
  const abs = path.join(repoRoot, DEBT_FILE)
  if (!fs.existsSync(abs)) return {}
  let parsed
  try { parsed = JSON.parse(fs.readFileSync(abs, 'utf8')) } catch (e) { throw new Error(`${DEBT_FILE} 不是合法 JSON：${e.message}`) }
  for (const [key, value] of Object.entries(parsed)) {
    if (key.startsWith('_')) continue // 下划线前缀 = 元数据说明，不是登记项
    if (!value || typeof value.reason !== 'string' || value.reason.trim() === '') {
      throw new Error(`${DEBT_FILE} 的登记项 ${key} 缺少 reason（豁免必须写明为什么）`)
    }
  }
  return parsed
}

function check (repoRoot, root = DEFAULT_ROOT) {
  const apis = collectDestructiveApis(repoRoot, root)
  const debt = loadDebt(repoRoot)
  const tier = []
  const hits = []
  const absRoot = path.resolve(repoRoot, root)
  if (!fs.existsSync(absRoot)) throw new Error(`扫描根不存在：${root}`)
  const files = listSourceFiles(absRoot)
    .map(f => ({ f, rel: path.relative(absRoot, f).replace(/\\/g, '/') }))
    // api/ 是**定义面**不是调用面：那里的 `export async function draftDelete(...)` 不是用户动作
    .filter(x => !/^api\//.test(x.rel) && !/^locales\//.test(x.rel))
    .map(x => x.f)
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    const masked = maskNonCode(src)
    const rel = path.relative(repoRoot, file).replace(/\\/g, '/')
    const scopes = findFunctions(masked)
    for (const api of apis) {
      const callRe = new RegExp(`\\b${api}\\s*\\(`, 'g')
      let m
      while ((m = callRe.exec(masked)) !== null) {
        // 跳过**定义处**：本仓 stores/accounts.js 里有个局部函数就叫 batchDelete，
        // 与 api/publisher.js 导出的同名 API 撞名；不排除定义点就会把「声明」当「调用」。
        const before = masked.slice(Math.max(0, m.index - 30), m.index)
        if (/(?:function|const|let|var)\s+$/.test(before)) continue
        const scope = innermostScope(scopes, m.index)
        const fnName = scope ? scope.name : '<top-level>'
        hits.push(`${rel}#${fnName}`)
        const body = scope ? masked.slice(scope.start, scope.end + 1) : ''
        // 排除对所在函数自身的递归引用
        const bodyWithoutSelf = fnName !== '<top-level>'
          ? body.replace(new RegExp(`\\b${fnName}\\s*\\(`, 'g'), '')
          : body
        const unified = CONFIRM_UNIFIED.test(bodyWithoutSelf)
        const anywhere = CONFIRM_ANY.test(bodyWithoutSelf) || CONFIRM_ANY.test(masked)
        if (unified) continue
        tier.push({
          file: rel,
          line: lineOf(src, m.index),
          api,
          fn: fnName,
          key: `${rel}#${fnName}`,
          tier: anywhere ? 'B' : 'A',
        })
      }
    }
  }
  // 陈旧登记：豁免项对应的调用点已消失（收敛完成或函数被改名），必须删掉条目
  const keys = new Set(tier.map(v => v.key))
  const tierA = tier.filter(v => v.tier === 'A')
  const tierB = tier.filter(v => v.tier === 'B')
  const unregistered = tier.filter(v => !debt[v.key])
  // A 档（本文件看不到任何确认动作）必须额外写出确认到底在哪个文件哪一行，
  // 或写明"该操作可重做、按评审 w14 不锁" —— 否则登记就等于免检。
  const missingEvidence = tier.filter(v => v.tier === 'A' && debt[v.key]
    && !(typeof debt[v.key].confirmed_by === 'string' && debt[v.key].confirmed_by.trim() !== ''))
  const stale = Object.keys(debt).filter(k => !k.startsWith('_') && !keys.has(k))
  const problems = unregistered.length + stale.length + missingEvidence.length
  return {
    apis: [...apis].sort(), filesScanned: files.length, call_sites: hits.length,
    tierA, tierB, unregistered, stale, missingEvidence, problems,
  }
}

function main () {
  const args = process.argv.slice(2)
  let root = DEFAULT_ROOT
  let json = false
  for (const a of args) {
    if (a === '--json') json = true
    else if (a.startsWith('--root=')) root = a.slice(7)
    else if (a.startsWith('--')) { console.error(`FAIL(parser): 未知旗标 ${a}`); return 2 }
    else root = a
  }
  const repoRoot = process.env.MP_REPO_ROOT || process.cwd()
  let r
  try { r = check(repoRoot, root) } catch (e) { console.error(`FAIL(scanner): ${e.message}`); return 2 }
  if (json) {
    console.log(JSON.stringify({
      judge: 'danger-confirm', files_scanned: r.filesScanned, destructive_apis: r.apis,
      call_sites: r.call_sites, tier_A_no_confirm: r.tierA, tier_B_non_unified: r.tierB,
      unregistered: r.unregistered, stale: r.stale, problems: r.problems,
    }, null, 2))
  } else {
    console.log(`[danger-confirm] files=${r.filesScanned} apis=${r.apis.length} call_sites=${r.call_sites} A(本文件无确认)=${r.tierA.length} B(非统一原语)=${r.tierB.length} unregistered=${r.unregistered.length} missing_evidence=${r.missingEvidence.length} stale=${r.stale.length}`)
    for (const v of r.unregistered) console.log(`  未登记 ${v.tier} ${v.file}:${v.line} ${v.api}() in ${v.fn} —— 未走统一确认原语且未登记去向`)
    for (const v of r.missingEvidence) console.log(`  缺证据 ${v.file}:${v.line} ${v.api}() in ${v.fn} —— A 档登记必须写出 confirmed_by（确认在哪个文件行，或"可重做不锁"）`)
    for (const s of r.stale) console.log(`  陈旧豁免登记：${s}`)
  }
  return r.problems === 0 ? 0 : 1
}

if (require.main === module) process.exit(main())

module.exports = { check, maskNonCode, findFunctions, collectDestructiveApis }
