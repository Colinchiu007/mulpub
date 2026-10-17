/**
 * same-type-risk-locks.js — 「竞品缺陷同型风险」的静态扫描器（纯函数，零依赖）
 *
 * ## 为什么有这四条
 * 2026-10-17 的逆向衍生文档 `01-docs/research/competitor-reverse-2026-10-13/derived/竞品缺陷同型风险清单.md`
 * 从竞品的 8 个 🔴 CRITICAL 里抽出 12 类同型风险，逐条核到我们仓里。核完发现：
 * **我们当前是对的，但没有锁** —— 现状安全靠的是当时写它的人，不是机器。
 * 本模块把其中最可机械判定的 4 条做成纯函数，CLI 与测试共用同一实现（禁止第二份）。
 *
 * 四条（编号与清单文档一致）：
 *   L1 转义表完整性：`replace(/[abc]/g, m => map[m])` 的字符类必须 ⊆ map 的键集
 *      （竞品 C1：字符类含 `/` 但 map 无 `/` ⇒ 替换回调返回 undefined ⇒ 插入字面量 "undefined"；
 *       不抛错、不告警，只在每处命中时静默损坏文本）
 *   L2 `while (true)` 必有出口：循环体内必须出现 break / return / deadline·timeout 字样
 *      （竞品 C2：只认一种成功响应 ⇒ 每秒打服务端、Promise 永不 settle、按钮永久置灰）
 *   L3 catch 不得重调被包裹的函数：catch 体内不得出现**外层函数自身**的调用
 *      （竞品 X-C1：catch 里重调整个截图函数 ⇒ 原 Promise 的 resolve 永不调用 ⇒ 流程死锁）
 *   L4 组件内定时器必须清理：同一文件里出现 setInterval( 就必须出现 clearInterval(
 *      （竞品 X-20 型：观察者/定时器建了不 dispose）
 *
 * ## 判据纪律（本仓反复踩过的三条）
 * ① **注释与字符串必须先屏蔽**：注释里会出现 `while (true)`、`2>&1` 这类字样，把它们算进来
 *    会让锁自我报警而没人看得懂（`scripts/start-mp-task.test.js` 的同款教训）。
 * ② **命中条数要能被断言下界**：0 命中会让「解析失败」伪装成「全部合规」。
 * ③ **不做靠命名猜语义的启发式**：宽判据的假阳性比真阳性多（见
 *    `01-docs/research/competitor-reverse-2026-10-13/方法论-度量工具的五次同族错误.md`）。
 *
 * 纯函数边界：本模块**不读文件系统**，只吃 `{ path, text }[]`；读盘由 CLI 做。
 */

'use strict'

/**
 * 把注释与字符串内容替换成等长空白，保留所有下标。
 * 目的：后续所有正则都在「只剩代码」的文本上跑，注释里的字样不会误命中。
 * @param {string} src
 * @returns {string} 与 src 等长
 */
function maskNonCode (src, opts) {
  const maskStrings = !opts || opts.maskStrings !== false
  const out = src.split('')
  let i = 0
  const n = src.length
  const blank = (from, to) => { for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ' }
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    // 行注释
    if (c === '/' && d === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    // 块注释
    if (c === '/' && d === '*') {
      let j = i + 2
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++
      blank(i, Math.min(j + 2, n))
      i = Math.min(j + 2, n)
      continue
    }
    // 字符串 / 模板串（模板串里的 ${} 当字符串内容处理：本扫描器不追求对模板求值）
    if (maskStrings && (c === "'" || c === '"' || c === '`')) {
      const quote = c
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === quote) { j++; break }
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

/** 从 openIdx（必须是 `{`）开始做括号配对，返回闭合 `}` 的下标；找不到返回 -1。 */
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

/**
 * L1：`replace(/[<class>]/g, m => map[m])` 的字符类必须 ⊆ map 键集。
 * @param {{path:string,text:string}[]} sources
 */
function scanEscapeMapCoverage (sources) {
  const findings = []
  const stats = { filesWithCharClassCallback: 0, mapsFound: 0 }
  for (const src of sources) {
    const { path, text } = src
    // ⚠ 这里必须保留字符串：L1 的字符类形如 `[&<>"']`，把引号当字符串起始会把后续代码一起抹白
    //   ⇒ 调用点匹配不到 ⇒ 这条锁变成空转（首版实测 mapsFound=0 就是这么来的）。
    const masked = src._maskedKeepStrings || maskNonCode(text, { maskStrings: false })
    // 形态：replace(/[...]/g, (m) => map[m]) 或 replace(/[...]/g, function (m) { return map[m] })
    const callRe = /replace\(\s*\/\[([^\]]*)\]\s*\/[a-z]*\s*,\s*(?:\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>|function\s*\(?\s*[A-Za-z_$][\w$]*\s*\)?)/g
    let m
    while ((m = callRe.exec(masked)) !== null) {
      stats.filesWithCharClassCallback++
      const parsed = unescapeClassChars(m[1])
      if (parsed.unsupported.length > 0) {
        // `\d` / `\p{...}` / 区间（`a-z`）无法与「字面量键表」对账 ⇒ 明确跳过并计数，
        // 不猜（宁可少覆盖，也不要假阳把这条锁变成噪音）。
        stats.skippedNonLiteralClasses = (stats.skippedNonLiteralClasses || 0) + 1
        continue
      }
      const classChars = parsed.chars
      // 在同一个文件的 ±80 行窗口内找「单字符键 → &xxx; 值」的对象字面量
      const windowStart = Math.max(0, m.index - 4000)
      const windowEnd = Math.min(masked.length, m.index + 4000)
      // ⚠ 必须用**原文**切片：map 的值是字符串，maskNonCode 会把它们抹成空白 ⇒
      //   用 masked 永远找不到映射表（首版实测 mapsFound=0，等于这条锁从未生效）。
      //   两个文本等长，窗口下标可直接复用。
      const maps = findCharMaps(text.slice(windowStart, windowEnd))
      if (maps.length === 0) continue          // 不是 map 形态（如 chained replace），不归本条管
      const keys = new Set(maps.flatMap((x) => x.keys))
      stats.mapsFound += maps.length
      const missing = [...classChars].filter((c) => !keys.has(c))
      if (missing.length) {
        findings.push({
          rule: 'L1-escape-map-coverage',
          path,
          detail: '字符类含未映射字符: ' + missing.map((c) => JSON.stringify(c)).join(',') + '（替换回调会返回 undefined ⇒ 插入字面量 "undefined"）',
        })
      }
    }
  }
  return { ok: findings.length === 0, findings, stats }
}

/**
 * 把正则字符类内容拆成「字面量字符集 + 不支持项」。
 * 支持：普通字符、`\-` `\]` 之类单字符转义。
 * 不支持（会进 unsupported，调用方必须跳过而不是猜）：`\d\w\s\b\p{..}` 简写、`a-z` 区间。
 */
function unescapeClassChars (body) {
  const chars = new Set()
  const unsupported = []
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\\') {
      const nx = body[i + 1]
      if (nx === undefined) break
      if ('dwsbB'.includes(nx) || nx === 'p' || nx === 'P') { unsupported.push('\\' + nx); i++; continue }
      chars.add(nx)
      i++
      continue
    }
    if (c === '-' && i > 0 && i < body.length - 1) { unsupported.push('range'); continue }
    chars.add(c)
  }
  return { chars, unsupported }
}

/**
 * 找「单字符键 → '&...;' 值」的对象字面量，返回键集。
 *
 * ⚠ 键解析必须用**后向引用**定界：键本身可能就是引号（`'"'` 与 `"'"`）。
 *   首版写成 `['"]([^'"]{1,2})['"]`，于是「键是引号」的两条永远匹配不到 ——
 *   而它们恰好就是 L1 要守的字符（`"` 与 `'`），结果锁报了 2 条假阳。
 */
function findCharMaps (text) {
  const maps = []
  const objRe = /\{([^{}]{4,400})\}/g
  let m
  while ((m = objRe.exec(text)) !== null) {
    const body = m[1]
    const pairRe = /(['"])((?:\\.|(?!\1).){1,2})\1\s*:\s*(['"])(&[#A-Za-z0-9]+;)\3/g
    const keys = []
    let p
    while ((p = pairRe.exec(body)) !== null) {
      if (p[2].length === 1) keys.push(p[2])
    }
    if (keys.length >= 1) maps.push({ keys })
  }
  return maps
}
/**
 * L2：`while (true)` 的循环体必须有出口（break / return / deadline·timeout 字样）。
 */
function scanWhileTrue (sources) {
  const findings = []
  const stats = { loops: 0 }
  for (const src of sources) {
    const { path, text } = src
    const masked = src._masked || maskNonCode(text)
    const re = /while\s*\(\s*true\s*\)/g
    let m
    while ((m = re.exec(masked)) !== null) {
      stats.loops++
      const braceIdx = masked.indexOf('{', m.index + m[0].length)
      if (braceIdx === -1) continue
      const close = matchBrace(masked, braceIdx)
      if (close === -1) {
        findings.push({ rule: 'L2-while-true-no-exit', path, detail: '括号未配对，无法判定出口（fail-closed）' })
        continue
      }
      const body = masked.slice(braceIdx + 1, close)
      const hasExit = /(\bbreak\b|\breturn\b|\bdeadline\b|\bDeadline\b|\btimeout\b|\bTimeout\b)/.test(body)
      if (!hasExit) {
        findings.push({ rule: 'L2-while-true-no-exit', path, detail: 'while(true) 体内无 break/return/deadline/timeout' })
      }
    }
  }
  return { ok: findings.length === 0, findings, stats }
}

/** 测试文件判定：L3/L4 只在生产代码上判（测试里的 catch/定时器语义不同，算进来就是假阳）。 */
function isTestFile (p) {
  return /(^|\/)(test|tests|__tests__)\//.test(p) || /\.(test|spec)\.[cm]?[jt]s$/.test(p)
}

/**
 * 收集文件里所有**带函数体**的函数声明及其体范围。
 * 认四种形态：`function NAME(`、`NAME: function(`、行首方法简写 `NAME(…) {`、`const NAME = (…) => {`。
 */
/** 控制流/声明词：后面也跟 `(`，但不是函数名（宽判据会把它当外层函数 ⇒ 假阳）。 */
const NON_FUNCTION_NAMES = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return', 'typeof',
  'else', 'do', 'try', 'finally', 'new', 'delete', 'void', 'await', 'yield', 'in', 'of',
])

function collectFunctions (masked) {
  const out = []
  const patterns = [
    /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
    /([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?function\s*\([^)]*\)\s*\{/g,
    /(?:^|\n)[ \t]*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g,
  ]
  const seen = new Set()
  for (const re of patterns) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(masked)) !== null) {
      const name = m[1]
      if (NON_FUNCTION_NAMES.has(name)) continue
      const at = m.index + m[0].indexOf(name)
      const prev = masked.slice(0, at).trimEnd().slice(-2)
      if (prev.endsWith('.')) continue
      if (/\bnew$/.test(prev)) continue
      const braceIdx = m.index + m[0].length - 1
      const close = matchBrace(masked, braceIdx)
      if (close === -1) continue
      const key = name + '@' + braceIdx
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name, bodyStart: braceIdx, bodyEnd: close })
    }
  }
  return out
}

/**
 * L3：catch 体内不得调用**同时包住这个 catch 的那个函数自身**。
 *
 * ⚠ 首版用「最近的前置函数声明」猜外层函数，实测 30+ 条全假阳（把 `if(`/`console.warn(`/`setTimeout(`
 *   都当成外层函数名）。改成**按花括号范围判包含**：只有「体范围真正覆盖该 catch」的函数才算外层，
 *   且取范围最小的那个（最内层）。另外调用点前一个非空字符若是 `.`（属性访问，如
 *   `this._logger.warn(`）不算自调用 —— 只有裸 `NAME(` 与 `this.NAME(` 才算。
 */
function scanCatchRecursion (sources) {
  const findings = []
  const stats = { catchBlocks: 0, skippedTestFiles: 0 }
  for (const src of sources) {
    const { path, text } = src
    if (isTestFile(path)) { stats.skippedTestFiles++; continue }
    const masked = src._masked || maskNonCode(text)
    const fns = collectFunctions(masked)
    // ⚠ 必须容忍 `catch((error) => {`（promise 链最常见的写法）：首版只认 `catch (e) {`，
    //   把这一整类漏掉，是**红夹具**当场抓出来的。同时要求后面真跟 `{`：
    //   `.catch(handler)` 只是引用，不算 catch 块。
    const re = /catch\s*(?:\([^)]*\)\s*(?:=>\s*)?)?\{/g
    let m
    while ((m = re.exec(masked)) !== null) {
      stats.catchBlocks++
      const catchIdx = m.index
      const braceIdx = catchIdx + m[0].length - 1
      const close = matchBrace(masked, braceIdx)
      if (close === -1) continue
      const body = masked.slice(braceIdx + 1, close)
      // 最内层：bodyStart 最大且范围覆盖 catch
      let owner = null
      for (const fn of fns) {
        if (fn.bodyStart < catchIdx && catchIdx < fn.bodyEnd) {
          if (!owner || fn.bodyStart > owner.bodyStart) owner = fn
        }
      }
      if (!owner) continue
      const name = owner.name
      const callRe = new RegExp('(?:\\bthis\\s*\\.\\s*)?\\b' + name + '\\s*\\(', 'g')
      let c
      let hit = false
      while ((c = callRe.exec(body)) !== null) {
        const before = body.slice(0, c.index).trimEnd()
        if (before.endsWith('.')) continue        // 属性访问同名方法，不算自调用
        if (/\bnew$/.test(before)) continue      // 构造调用 new NAME( 不是重调自身（CCG 评审 73742862-i4）
        hit = true
        break
      }
      if (hit) {
        findings.push({
          rule: 'L3-catch-self-recursion',
          path,
          detail: 'catch 内重调外层函数 ' + name + '()（原 Promise 的 resolve 可能永不调用 ⇒ 流程死锁）',
        })
      }
    }
  }
  return { ok: findings.length === 0, findings, stats }
}

/**
 * L4：同一文件里出现 setInterval( 就必须出现 clearInterval(。
 * 只扫渲染端 `.vue` 与 `apps/desktop/src/**`（组件生命周期语义明确的区域）。
 */
function scanIntervalCleanup (sources) {
  const findings = []
  const stats = { filesWithInterval: 0, skippedTestFiles: 0 }
  for (const src of sources) {
    const { path, text } = src
    if (isTestFile(path)) { stats.skippedTestFiles++; continue }
    const masked = src._masked || maskNonCode(text)
    if (!/\bsetInterval\s*\(/.test(masked)) continue
    stats.filesWithInterval++
    if (!/\bclearInterval\s*\(/.test(masked)) {
      findings.push({ rule: 'L4-interval-no-cleanup', path, detail: '文件内有 setInterval( 但无 clearInterval(' })
    }
  }
  return { ok: findings.length === 0, findings, stats }
}

/** 四条一起跑（CLI 与测试共用，禁止第二份实现）。 */
/** 一次性预算每个文件的两种屏蔽文本（i6：避免四个扫描器各自 mask 一遍）。 */
function prepareSources (sources) {
  return sources.map((s) => ({
    ...s,
    _masked: s._masked || maskNonCode(s.text),
    _maskedKeepStrings: s._maskedKeepStrings || maskNonCode(s.text, { maskStrings: false }),
  }))
}

function scanAll (sources) {
  const prepared = prepareSources(sources)
  const l1 = scanEscapeMapCoverage(prepared)
  const l2 = scanWhileTrue(prepared)
  const l3 = scanCatchRecursion(prepared)
  const l4 = scanIntervalCleanup(prepared)
  const findings = [...l1.findings, ...l2.findings, ...l3.findings, ...l4.findings]
  return {
    ok: findings.length === 0,
    findings,
    stats: { l1: l1.stats, l2: l2.stats, l3: l3.stats, l4: l4.stats },
  }
}

module.exports = {
  maskNonCode,
  matchBrace,
  collectFunctions,
  scanEscapeMapCoverage,
  scanWhileTrue,
  scanCatchRecursion,
  scanIntervalCleanup,
  prepareSources,
  scanAll,
}
