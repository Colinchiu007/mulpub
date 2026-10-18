/**
 * code-mask.js — 结构锁共享库：代码屏蔽与括号配对（第三批抽出，兑现 CCG 两轮评审的采纳承诺）
 *
 * ## 为什么现在抽
 * `same-type-risk-locks.js`（L1-L4）与 `same-type-risk-locks-r2.js`（R5/R9a）各自维护一份 maskNonCode，
 * 评审 i4 两轮指出「修改易分歧」。抽出前已做等价性取证：两份实现行为等价 10/10
 * （夹具集含行注释/块注释/单双引号/模板串/字符类内引号/转义引号/多行模板），差异仅在选项 API：
 *   第一批 `maskNonCode(src, { maskStrings: false })`   —— maskStrings 默认 true（屏蔽字符串）
 *   第二批 `maskNonCode(src, { keepStrings: true })`    —— keepStrings 默认 false（同义：默认屏蔽）
 * 统一后的 API：`strings: 'mask' | 'keep'`（默认 'mask'）。两个旧入口保留为**薄包装**，
 * 各批测试（16 + 14 例）的导入路径与断言不动 —— 基线重置为零。
 *
 * 判据纪律（两批共守，抽库后由本文件单点承载）：
 * ① 注释与字符串必须先屏蔽（注释里的 `while (true)` 会让锁自我报警）；
 * ② 屏蔽必须**等长**（下标可跨文本复用：L1 用屏蔽文本定位、用原文解析映射表）；
 * ③ 字符类里可能出现引号（`[&<>"']`），需要看字面量的判据用 strings: 'keep'。
 *
 * ## 支持的词法形态（改这里必须同步加例，见 code-mask.test.js）
 * | 形态 | 处理 | 备注 |
 * | --- | --- | --- |
 * | 行注释 `// …` | 掩 | |
 * | 块注释 `/* … *\/` | 掩 | |
 * | 引号字符串 `'…'` `"…"` | 掩内容、留引号 | 处理 `\` 转义 |
 * | 模板串 `` `…` `` | 掩内容 | **已知限制**：不解析 `${}` 嵌套，遇内层反引号会截断 |
 * | 正则字面量 `/…/flags` | **保留内容** | 2026-10-18 新增；保留是因为 L1 依赖字符类原文；仅把内部 `{` `}` 掩成空白避免干扰 matchBrace |
 *
 * ⛔ **本库是八条结构锁的公共底座** —— 它漏一种形态，等于八条锁在该形态上集体失明，
 *    而"看不见"与"没有违规"在输出上完全同形。2026-10-18 实测：因为漏了正则字面量，
 *    源码面 **311** 个文件含「正则内引号」、其中 **164** 个掩码被打穿（最坏可见率 **0.03**），
 *    八条锁在其上持续输出 PASS。所以：**新增/修改形态必须同时加夹具**，
 *    且只做"与旧实现等价"的断言不构成正确性证明（等价只能证明"错得一样"）。
 */

'use strict'

/**
 * 判断 src[i] 处的 `/` 是正则字面量起点还是除号。
 *
 * JS 里 `/` 二义（除号 vs 正则），只能靠前一个有效 token 推断。规则取自 ECMAScript 里
 * 「表达式位置 vs 运算符位置」的常见实践：
 *   - 前一个非空白字符是这些之一 ⇒ 处于**表达式起始位置** ⇒ 正则：
 *       ( , = : [ ! & | ? { } ; + - * % < > ~ ^
 *   - 前一个单词是关键字（return / typeof / case / in / of / new / delete / void /
 *     instanceof / do / else / yield / await）⇒ 正则
 *   - 其余（标识符字符、数字、`)`、`]`、引号、模板串）⇒ 除号
 *
 * ⚠ `}` 是唯一有争议的一格：它既可能结束块（后面可跟正则，如 `if (x) {} /re/.test()`），
 * 也可能结束对象字面量（后面是除号）。本实现按**除号**处理 ——
 * 因为「把除法误判成正则」会一直扫到下一个 `/` 才停，把中间整段代码当正则跳过（更糟），
 * 而「把正则误判成除法」只是没跳过它内部的引号，回到修复前的行为。代价最小化。
 *
 * @param {string} src 源码
 * @param {number} i `/` 的下标
 * @returns {boolean} 是否为正则字面量起点
 */
function isRegexStart (src, i) {
  let k = i - 1
  while (k >= 0 && /\s/.test(src[k])) k--
  if (k < 0) return true
  const prev = src[k]
  // 表达式起始位置的白名单 —— **必须是闭集**。两次实测教训（缺一不可）：
  //   ① 兜底不能写成 `return true`（「不在下面这些里就当作正则」）：`</p>` 的 `</` 会落进兜底，
  //      扫到下一个 `/` 之间整段被跳过，`url-collector.test.js` 可见字符 14844→8010。
  //   ② `>` **必须**在白名单里、`<` **必须**不在：
  //      `>` 最常见来源是箭头函数 —— `filter((b) => /\bpath\s*:\s*['"]/.test(b))`，
  //      不判正则会退回修复前行为（正则里的引号把后面整段吃掉，
  //      实测 `check-route-registry.js` 5622→4431）；
  //      `<` 最常见来源是模板串里的 HTML 片段（`</p>`），判正则会误跳。
  if ('(,=:[!&|?{;+-*%^~>'.includes(prev)) return true
  // 标识符/数字结尾：只有这些关键字之后才可能跟正则
  if (/[A-Za-z0-9_$]/.test(prev)) {
    let w = k
    while (w >= 0 && /[A-Za-z0-9_$]/.test(src[w])) w--
    const word = src.slice(w + 1, k + 1)
    return [
      'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
      'instanceof', 'do', 'else', 'yield', 'await',
    ].includes(word)
  }
  // 其余一律按除号：`)` `]` `}` 引号 模板串 `<` `>` 等
  return false
}

/**
 * 从 src[open]（必须是 `/`）开始找正则字面量的结束位置，返回结束 `/` 之后（含 flags）的下标。
 * 未找到（含遇到换行）返回 -1 —— 调用方必须退回「不当作正则」，不得吞掉后续内容。
 *
 * 处理三件正常写法：转义 `\/`、字符类 `[/]`（类内 `/` 不结束）、flags。
 *
 * @param {string} src 源码
 * @param {number} open 起始 `/` 的下标
 * @returns {number} 结束下标（不含）或 -1
 */
function scanRegexEnd (src, open) {
  const n = src.length
  let j = open + 1
  let inClass = false
  while (j < n) {
    const ch = src[j]
    if (ch === '\\') { j += 2; continue }
    // 正则字面量不能跨行（未转义的换行即语法错误）⇒ 视为未闭合
    if (ch === '\n' || ch === '\r') return -1
    if (inClass) {
      if (ch === ']') inClass = false
      j++
      continue
    }
    if (ch === '[') { inClass = true; j++; continue }
    if (ch === '/') {
      j++
      while (j < n && /[a-z]/i.test(src[j])) j++ // flags
      return j
    }
    j++
  }
  return -1
}

/**
 * 把注释（与可选的字符串内容）替换成等长空白，保留所有下标。
 * @param {string} src 源码
 * @param {{strings?: 'mask'|'keep'}} [opts] strings 默认 'mask'；
 *   'keep' 时保留字符串内容（字符类含引号的调用点、字面量进度值等判据需要）
 * @returns {string} 与 src 等长的「只剩代码」文本
 */
function maskNonCode (src, opts) {
  const keepStrings = !!(opts && opts.strings === 'keep')
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
    // 正则字面量（2026-10-18 修复）：必须**先于字符串分支**识别。
    //   修复前 `/["\']/g` 里的 `"` 会被当成字符串起点，一路扫到下一个引号，
    //   中间整段代码被掩掉 ⇒ 实测 164 个文件掩码被打穿（最坏只剩 3% 可见），
    //   8 条结构锁在其上几乎全盲。正则**内容保留**（L1 转义表锁依赖字符类原文，
    //   如 `replace(/[&<>"']/g, …)`），只做两件事：正确跳过边界 + 把花括号掩成空白，
    //   避免正则里的 `{`/`}`（如 `/\d{4}/`）干扰 matchBrace 的配对。
    if (c === '/') {
      const end = scanRegexEnd(src, i)
      if (end > 0 && isRegexStart(src, i)) {
        for (let k = i; k < end; k++) {
          if (out[k] === '{' || out[k] === '}') out[k] = ' '
        }
        i = end
        continue
      }
    }
    // 字符串 / 模板串（模板串里的 ${} 当字符串内容处理：本扫描器不追求对模板求值）
    if (!keepStrings && (c === "'" || c === '"' || c === '`')) {
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

module.exports = { maskNonCode, matchBrace }
