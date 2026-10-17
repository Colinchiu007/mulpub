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
 */

'use strict'

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
