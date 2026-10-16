'use strict'

/**
 * `scripts/lib/ccg-gate-security-filter.js` 的常驻回归锁。
 *
 * 动因（2026-10-16，第十轮 CCG 外部评审遗留项）：
 *   这段「存量命中过滤」原先内联在 `ccg-gate.js` 里，而该文件末尾是顶层
 *   `process.exit(main())` ⇒ **不可 require** ⇒ 策略没有测试缝，只能临时抽源码 eval 验证，
 *   CI 永远跑不到；谁把它改回脆弱写法都没有测试会红。
 *   抽成模块后由本文件锁住，并**接线进 CI 的 changes job**（那个 job 不装依赖，
 *   所以被测模块与本文件都只允许用 node 内置 —— 见 AGENTS.md 的接线约束）。
 *
 * 风格对齐本仓既有 `scripts/*.test.js`：node:test + node:assert/strict。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const MOD = require('./ccg-gate-security-filter')

const FILE = 'apps/desktop/electron/services/rpa-view-platforms.js'
const ABS = 'D:\\Data\\projects\\multi-publish\\' + FILE.replace(/\//g, '\\')

/** 复刻扫描器报告的真实形状（含行政行 + emoji + 绝对路径 + 缩进的规则说明行）。 */
function scannerOutput (hitLine, hitPath) {
  return [
    '============================================================',
    '代码安全扫描报告',
    '============================================================',
    '',
    `扫描路径: ${hitPath || ABS}`,
    '',
    '扫描文件: 1',
    '',
    '扫描结果: ✗ 发现高危问题',
    '',
    '统计: 严重: 0 | 高危: 1 | 中危: 0 | 低危: 0',
    '',
    '----------------------------------------',
    '问题列表:',
    '----------------------------------------',
    '',
    '【XSS】(1 个)',
    `  🟠 ${hitPath || ABS}:${hitLine}`,
    '    直接操作 innerHTML 可能导致 XSS',
    '',
    '============================================================',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// ① parseSecurityHitLines：路径归因的四个方向
// ─────────────────────────────────────────────────────────────────────────────

test('命中抽取：真实扫描器形状（绝对路径）能被抽出，且行政行不算文件级命中', () => {
  const r = MOD.parseSecurityHitLines(scannerOutput(1030), FILE)
  assert.deepEqual(r.hits, [1030])
  // ★ `扫描路径: <本文件>` 这行提到本文件却**无行号**；若把它当文件级命中，
  //   每次扫这个文件都会判「有文件级命中」⇒ 存量过滤被完全关掉（第八轮实测踩到）。
  assert.equal(r.fileLevel, 0, '行政行不得被算作文件级命中：' + JSON.stringify(r))
  assert.equal(r.mentioned, 0)
})

test('命中抽取：三种路径形态都认（相对正斜杠 / 相对反斜杠 / 绝对）', () => {
  const rel = FILE
  const relBack = FILE.replace(/\//g, '\\')
  for (const p of [rel, relBack, ABS]) {
    const r = MOD.parseSecurityHitLines(scannerOutput(42, p), FILE)
    assert.deepEqual(r.hits, [42], `路径形态 ${p} 未被识别`)
  }
})

test('命中抽取：**他文件**命中不得被套到本文件（第五轮 i1）', () => {
  const other = '  🔴 apps/desktop/electron/services/other-file.js:37'
  const r = MOD.parseSecurityHitLines(other, FILE)
  assert.deepEqual(r.hits, [], '他文件命中被误收：' + JSON.stringify(r.hits))
})

test('命中抽取：文件级命中（无行号）必须被显式报出（第六轮 i2，fail-closed）', () => {
  const out = [
    '【XSS】(1 个)',
    `  🟠 ${ABS}`, // 提到本文件但无行号
  ].join('\n')
  const r = MOD.parseSecurityHitLines(out, FILE)
  assert.deepEqual(r.hits, [])
  assert.ok(r.fileLevel >= 1, '文件级命中必须计入 fileLevel：' + JSON.stringify(r))
})

test('命中抽取：同名不同目录（多个同 basename 路径）⇒ 不归因，退回 fail-closed（第十轮 i1）', () => {
  const out = [
    '  🟠 D:\\other\\rpa-view-platforms.js:999',
    '  🟠 D:\\another\\rpa-view-platforms.js:1000',
  ].join('\n')
  const r = MOD.parseSecurityHitLines(out, FILE)
  assert.deepEqual(r.hits, [], '同名路径被误归因：' + JSON.stringify(r.hits))
  assert.ok(r.mentioned >= 1,
    '兜底被拒时必须计入 mentioned，否则「无法安全归因」被静默成「没有命中」：' + JSON.stringify(r))
})

test('命中抽取：唯一的同 basename 路径允许兜底，并标记 basenameFallback', () => {
  const r = MOD.parseSecurityHitLines(`  🟠 D:\\x\\rpa-view-platforms.js:1030`, 'other/dir/rpa-view-platforms.js')
  assert.deepEqual(r.hits, [1030])
  assert.equal(r.basenameFallback, true)
})

// ─────────────────────────────────────────────────────────────────────────────
// ② parseDiffHunkRanges：改动区间解析（changedLineRanges 的纯逻辑部分）
// ─────────────────────────────────────────────────────────────────────────────

test('区间解析：普通 hunk / 省略计数 / 多 hunk', () => {
  assert.deepEqual(MOD.parseDiffHunkRanges('@@ -1,3 +5,4 @@ ctx'), [[5, 8]])
  assert.deepEqual(MOD.parseDiffHunkRanges('@@ -1,3 +7 @@ ctx'), [[7, 7]])
  assert.deepEqual(MOD.parseDiffHunkRanges('@@ -1 +5,2 @@ a\n@@ -20,4 +30,1 @@ b'), [[5, 6], [30, 30]])
})

test('区间解析：**纯删除** hunk 不产生区间（否则会把删除位置当成「本次改动」）', () => {
  assert.deepEqual(MOD.parseDiffHunkRanges('@@ -21,5 +20,0 @@ ctx'), [])
  assert.deepEqual(MOD.parseDiffHunkRanges('@@ -511,14 +506,0 @@ ctx'), [])
})

test('区间解析：空输入 ⇒ 空数组（调用方据此判「本次未改此文件」）', () => {
  assert.deepEqual(MOD.parseDiffHunkRanges(''), [])
  assert.deepEqual(MOD.parseDiffHunkRanges(null), [])
})

// ─────────────────────────────────────────────────────────────────────────────
// ③ applyPreExistingFilter：过滤策略的每条出口
// ─────────────────────────────────────────────────────────────────────────────

const blocking = (hitLine, hitPath) => ({
  code: 1,
  blocking: true,
  file: FILE,
  output: scannerOutput(hitLine, hitPath),
})

test('过滤：门禁未阻断（code=0）⇒ 原样返回', () => {
  const r = MOD.applyPreExistingFilter({ code: 0, blocking: false, file: FILE, output: 'x' }, [[1, 2]])
  assert.equal(r.code, 0)
  assert.equal(r.verdict, 'not-blocking')
})

test('过滤：fail-closed 三处 —— 区间解析失败 / 本次未改此文件', () => {
  const a = MOD.applyPreExistingFilter(blocking(1030), null)
  assert.equal(a.verdict, 'fail-closed-ranges-unparsed')
  assert.equal(a.code, 1, '区间解析失败必须**保留阻断**（不得降级）')
  assert.equal(a.blocking, true)

  const b = MOD.applyPreExistingFilter(blocking(1030), [])
  assert.equal(b.verdict, 'fail-closed-no-change')
  assert.equal(b.code, 1, '本次未改此文件时必须保留阻断')
  assert.equal(b.blocking, true)
})

test('过滤：文件级命中 ⇒ fail-closed 保留阻断 + 说明文案', () => {
  const out = ['【XSS】(1 个)', `  🟠 ${ABS}`].join('\n')
  const r = MOD.applyPreExistingFilter({ code: 1, blocking: true, file: FILE, output: out }, [[100, 200]])
  assert.equal(r.verdict, 'fail-closed-file-level')
  assert.equal(r.code, 1)
  assert.equal(r.blocking, true)
  assert.match(r.output, /文件级命中/)
})

test('过滤：提到本文件却零行号 ⇒ fail-closed 保留阻断 + 诊断（第五/八轮 i5）', () => {
  const out = ['【XSS】(1 个)', '  🟠 D:\\other\\rpa-view-platforms.js:999', '  🟠 D:\\another\\rpa-view-platforms.js:1000'].join('\n')
  const r = MOD.applyPreExistingFilter({ code: 1, blocking: true, file: FILE, output: out }, [[100, 200]])
  assert.equal(r.verdict, 'fail-closed-unparsed-hits')
  assert.equal(r.code, 1)
  assert.equal(r.blocking, true)
  assert.match(r.output, /诊断/)
})

test('过滤：命中全部落在改动区间内 ⇒ 保留阻断（本次引入，不放行）', () => {
  const r = MOD.applyPreExistingFilter(blocking(1030), [[1000, 1100]])
  assert.equal(r.verdict, 'all-in-diff')
  assert.equal(r.code, 1)
  assert.equal(r.blocking, true)
})

test('过滤：命中有行号但一个都不在本文件（mentioned=0 的 no-hits）⇒ 原样返回', () => {
  const r = MOD.applyPreExistingFilter({ code: 1, blocking: true, file: FILE, output: 'nothing here' }, [[1, 9]])
  assert.equal(r.verdict, 'no-hits')
  assert.equal(r.code, 1)
})

test('过滤：命中全部落在区间外 ⇒ 判为存量、不阻断提交', () => {
  const r = MOD.applyPreExistingFilter(blocking(1030), [[500, 510]])
  assert.equal(r.verdict, 'all-pre-existing-downgraded')
  assert.equal(r.code, 0)
  assert.equal(r.blocking, false)
  assert.match(r.output, /判为存量/)
})

test('★ 过滤：区间内 + 区间外**混合** ⇒ 仍须保留阻断（第八轮 i1，防「整体豁免」fail-open）', () => {
  // 两条命中：1030 在区间内（本次引入），900 在区间外（存量）
  const out = [
    `  🟠 ${ABS}:1030`,
    `  🟠 ${ABS}:900`,
  ].join('\n')
  const r = MOD.applyPreExistingFilter({ code: 1, blocking: true, file: FILE, output: out }, [[1020, 1040]])
  assert.equal(r.verdict, 'partial-exempt-kept-blocking')
  assert.equal(r.code, 1, '混入存量命中不得整体放行 ⇒ 必须保留阻断')
  assert.equal(r.blocking, true)
  assert.match(r.output, /部分豁免/)
  assert.match(r.output, /保留阻断/)
})

// ─────────────────────────────────────────────────────────────────────────────
// ④ 接线锁：模块存在 ≠ 真的接上了（防「两份实现」与「模块被架空」）
// ─────────────────────────────────────────────────────────────────────────────

test('接线锁：ccg-gate.js 必须 require 本模块并调用 applyPreExistingFilter', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'ccg-gate.js'), 'utf8')
  assert.match(src, /require\(["']\.\/lib\/ccg-gate-security-filter["']\)/,
    'ccg-gate.js 未 require 本模块')
  assert.match(src, /applyPreExistingFilter\s*\(/, 'ccg-gate.js 未调用 applyPreExistingFilter（模块被架空）')
  assert.match(src, /changedLineRanges\s*\(/, 'ccg-gate.js 未取改动区间')
})

test('接线锁：调用点必须在**活**分支里（防「模块存在但被短路」—— 变异 M2 实测抓出）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'ccg-gate.js'), 'utf8')
  // ★ 只断言「标识符出现过」是不够的：把调用点写成 `true ? r : applyPreExistingFilter(...)`
  //   这种死分支，标识符仍在、门禁却完全不过滤 —— 变异 M2 实测**没红**，故补下面三条。
  assert.match(src, /\?\s*r\s*:\s*applyPreExistingFilter\(r,\s*changedLineRanges\(r\.file\)\)/,
    'applyPreExistingFilter 不在「三元 else 分支」这一活位置上 ⇒ 可能被短路')
  assert.doesNotMatch(src, /\btrue\s*\?/,
    '出现 `true ? …` 形状 ⇒ 过滤被短路（模块被架空）')
  assert.match(src, /gate\.name !== "verify-security"/,
    '缺少「只对安全门禁做存量过滤」的门控条件')
})

test('接线锁：ccg-gate.js 不得再自带一份实现（防逻辑回流成两份）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'ccg-gate.js'), 'utf8')
  assert.doesNotMatch(src, /function parseSecurityHitLines/, 'ccg-gate.js 里又出现了第二份 parseSecurityHitLines')
  assert.doesNotMatch(src, /function changedLineRanges/, 'ccg-gate.js 里又出现了第二份 changedLineRanges')
})

test('等价性锁：本模块的 parseSecurityHitLines 必须是逐字搬运（与旧 ccg-gate.js 相等）', () => {
  // 抽样关键行为即可，不做 git 取证（CI 的 changes job 是浅克隆、无历史可比）：
  // 逐字等价由提取时的核对保证，这里锁「搬运后关键行为未变」的最小面。
  const r = MOD.parseSecurityHitLines(scannerOutput(7), FILE)
  assert.deepEqual(r.hits, [7])
  assert.equal(r.fileLevel, 0)
  assert.equal(typeof MOD.parseSecurityHitLines, 'function')
})
