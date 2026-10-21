'use strict'

/**
 * run-tests：机械判定测试文件 runner（2026-10-21，同型坑第三次的根治）
 *
 * ── 为什么要改 ──────────────────────────────────────────────────
 * 本仓三次踩「测试文件与 runner 不匹配」，形态各不相同：
 *   ① #3983 vite alias 未注册 → 浏览器端 CJS 加载失败（18 条 E2E 全红）
 *   ② #4019/本仓 新增 vitest 文件漏登记 VITEST_FILES → node 直跑 `describe is not defined`
 *   ③ #4110 反向：把 **node:test 风格**文件误登记进 VITEST_FILES → `No test suite found`
 *
 * 三次的根因同一条：**登记表要求人工判断每个文件属于哪个 runner**，
 * 而两种风格在文件名上无法区分（都是 `*.test.js`），人工判断必然周期性出错。
 * ②和③方向相反，正好说明"记得登记"解决不了问题——判不准，不是记不住。
 *
 * ── 改法 ────────────────────────────────────────────────────────
 * 按**文件内容**判定（唯一事实源是文件自身，不是人的记忆）：
 *   · 含 vitest 全局调用（describe/test/it/expect/vi）且 **不含** node:test 特征
 *     ⇒ vitest
 *   · 含 `require('node:test')` / `require("assert")` 裸脚本形态 ⇒ direct（node 直跑）
 *   · 两者都像 ⇒ 报错，由人明确（fail-loud，不猜）
 *
 * 登记表 VITEST_FILES 降级为**例外白名单**：仅用于「内容判定不了」的少数文件，
 * 且每条必须带理由（由 check-unwired-tests / 本文件的自测守住）。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..') // packages/api-publish-engine

// ── 判定规则（2026-10-21 **按实测分布**收敛，不拍脑袋）──────────────
// 全量 184 个测试文件的特征组合分布：
//   · 60  assert 裸脚本            → direct
//   · 46  vitest globals           → vitest
//   · 33  node:test + assert + globals → direct（自定义收集器，见 signer-registry.test.js）
//   · 21  node:test + globals      → direct
//   · 14  assert + globals         → direct（同上，无 node:test 但用 assert 收集）
//   · 8   无任何特征               → 须人工登记
//
// 结论：**唯一可靠的硬判据是 `require('node:test')`（55 个，全 direct）**；
// 而 `assert` 出现 108 次、`globals` 出现 114 次，二者**交叉重叠**（33+14 个同时命中）
// ⇒ 都不能单独当判据。故规则定为：
//   ① 显式 `require('node:test')`                      ⇒ direct（最硬）
//   ② 有 `assert` 且**无** vitest 显式 import  ⇒ direct（自定义收集器形态）
//   ③ 其余（含 vitest globals 或显式 import vitest）   ⇒ vitest
//   ④ 三条都判不了（8 个无特征文件）⇒ 落例外表，由人登记，不猜。
const NODE_TEST_RE = /require\((['"])node:test\1\)/
const ASSERT_RE = /require\((['"])assert\1\)/
const VITEST_IMPORT_RE = /require\(\[?(['"])vitest\1/
// vitest 特征：顶层调用了 vitest 注入的全局（本 runner 以 --globals 启动）
const VITEST_GLOBAL_RE = /(^|\n)\s*(describe|it|test|expect|vi)\s*\(/

/**
 * 判定单个测试文件应由哪个 runner 执行。
 * @param {string} file 绝对路径
 * @returns {'vitest'|'direct'|'unknown'}  unknown 表示须人工登记例外
 */
function detectRunner (file) {
  // 判定只依据**文件头部的 import 区**（前 60 行里的 require 语句），且**不做字面量剥离**：
  // ① import 区里 require("assert") 的实参就是要看的关键字，剥掉反而判不出（实测教训）；
  // ② 测试夹具把 require('node:test') 写在**字符串里**的位置通常在文件体中后部，
  //    取头部即可天然避开 —— 这比全文件正则剥离更稳，也不会误伤真实 import。
  const all = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  // A. import 区（首条测试语句之前）—— 用来认 direct 的两种形态
  let cut = all.length
  for (let i = 0; i < all.length; i++) {
    if (/^\s*(describe|it|test)\s*\(/.test(all[i]) || /^\s*function\s+(test|describe|it)\b/.test(all[i])) { cut = i; break }
  }
  const head = all.slice(0, Math.min(cut, 60)).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const requires = (head.match(/require\((['"])(?:[^'"]*)\1\)/g) || []).join('\n')

  if (NODE_TEST_RE.test(requires)) return 'direct' // ① 显式 node:test，最硬
  if (/require\((['"])assert\1\)/.test(requires)) return 'direct' // ② assert 裸收集器

  // B. vitest 判定用**行首**出现 vitest 全局调用（夹具都嵌在字符串里、不在行首）
  const bodyHasVitest = all.some((l) => /^\s*(describe|it|test|expect|vi)\s*\(/.test(l))
  if (/require\(\[?(['"])vitest\1/.test(requires) || bodyHasVitest) return 'vitest' // ③
  return 'unknown' // ④
}

/**
 * 去掉注释与字符串/模板字面量的内容，只保留"可执行代码"骨架。
 * 不追求完全正确（那是解析器的活），目标是**不把字面量里的 require 当 import**。
 * @param {string} s 源码
 * @returns {string}
 */
function stripLiteralsAndComments (s) {
  let out = ''
  let i = 0
  let quote = null // ' " `
  while (i < s.length) {
    const c = s[i]
    const next = s[i + 1]
    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote) { quote = null; out += c }
      // 字面量内容一律丢弃
      i++
      continue
    }
    if (c === '/' && next === '/') { // 行注释
      while (i < s.length && s[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') { // 块注释
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i++; continue }
    out += c
    i++
  }
  return out
}

module.exports = { detectRunner, ROOT }

// 直接运行时：对全量测试文件做一次体检（只读，不改任何文件）
if (require.main === module) {
  const dirs = [path.join(ROOT, 'test'), path.join(ROOT, 'tests')]
  const files = []
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.test.js')).sort()) {
      files.push(path.join(dir, f))
    }
  }
  let vitest = 0
  let direct = 0
  const ambiguous = []
  for (const f of files) {
    try {
      const r = detectRunner(f)
      if (r === 'vitest') vitest++
      else direct++
    } catch (e) {
      ambiguous.push(path.basename(f))
    }
  }
  console.log(`体检完成：共 ${files.length} 个测试文件`)
  console.log(`  vitest=${vitest}  direct=${direct}  无法判定=${ambiguous.length}`)
  if (ambiguous.length) {
    for (const a of ambiguous) console.log('  ⚠ ' + a)
    process.exit(1)
  }
}
