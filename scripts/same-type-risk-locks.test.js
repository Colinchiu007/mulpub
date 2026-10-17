/**
 * same-type-risk-locks.test.js — 四条「竞品缺陷同型风险」锁的回归测试
 *
 * 背景：这四条锁来自 2026-10-17 的逆向衍生文档
 * `01-docs/research/competitor-reverse-2026-10-13/derived/竞品缺陷同型风险清单.md`（12 类同型风险里的 4 类）。
 * 它们防的是**竞品真实踩过、我们当前还没踩**的坑，所以「现在全绿」不构成证据 ——
 * 证据只能是：把坑的形状喂进去必须红，且不许把正常写法判红。
 *
 * ## 断言的三层（缺一层就等于没锁）
 * ① **红夹具**：四种违规形态各一条 ⇒ 必须报 finding（这就是变异反证，不需要改仓内文件）
 * ② **绿夹具**：注释/字符串里的字样、属性访问同名方法、`if (` 相邻、带 clearInterval 的文件 ⇒ 必须不报
 * ③ **真实仓覆盖下界**：命中条数必须 ≥ 实测下界（0 命中会让「解析失败」伪装成「全部合规」——
 *    本模块开发时真的踩过：findCharMaps 首版在屏蔽文本上跑，mapsFound=0 却打印 PASS）
 *
 * ## 开发期被自己抓住的两个假绿/假阳（写进注释，防后人重犯）
 * - `maskNonCode` 把 `[&<>"']` 里的 `"` 当字符串起始 ⇒ 后续代码被抹白 ⇒ **L1 空转**（mapsFound=0）。
 *   修法：给屏蔽器加 `{ maskStrings: false }`，L1 用它。
 * - 「最近的前置函数声明」当外层函数 ⇒ `if(` / `console.warn(` / `setTimeout(` 全被当成函数名 ⇒ **30+ 假阳**。
 *   修法：按花括号范围判**包含**，取最内层；并要求调用点前一个非空字符不是 `.`。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const {
  maskNonCode,
  scanEscapeMapCoverage,
  scanWhileTrue,
  scanCatchRecursion,
  scanIntervalCleanup,
  prepareSources,
  scanAll,
} = require('./lib/same-type-risk-locks')

const REPO = path.join(__dirname, '..')
const src = (p, text) => [{ path: p, text }]

// ─────────────────────────── ① 红夹具（必须红） ───────────────────────────

test('L1 红夹具：字符类含 `/` 但映射表无 `/`（竞品 C1 原形）⇒ 必须报', () => {
  const code = [
    'const escapeSpecialChars = (str) => {',
    '  const escapeMap = {',
    "    '&': '&amp;', '<': '&lt;', '>': '&gt;',",
    "    '\"': '&quot;', \"'\": '&apos;'",
    '  }',
    "  return str.replace(/[&<>\"'/]/g, (m) => escapeMap[m])",
    '}',
  ].join('\n')
  const r = scanEscapeMapCoverage(src('fixture.js', code))
  assert.equal(r.ok, false, '字符类里的 / 未被映射，必须红')
  assert.match(r.findings[0].detail, /"\/(?:")?|"\\"\/\\""/, 'finding 必须点名缺的字符（/）')
  assert.ok(r.stats.mapsFound >= 1, '必须真的解析到映射表（否则是空转）')
})

test('L1 绿夹具：字符类 ⊆ 映射表键集 ⇒ 不报', () => {
  const code = [
    'const map = {',
    "  '&': '&amp;', '<': '&lt;', '>': '&gt;',",
    "  '\"': '&quot;', \"'\": '&#039;'",
    '}',
    "text.replace(/[&<>\"']/g, (m) => map[m])",
  ].join('\n')
  const r = scanEscapeMapCoverage(src('ok.js', code))
  assert.equal(r.ok, true, '键集覆盖字符类，不得报')
})

test('L2 红夹具：while (true) 体内无出口 ⇒ 必须报', () => {
  const code = [
    'async function poll () {',
    '  while (true) {',
    "    const r = await fetch('/x')",
    "    if (r.ok) console.log('ok')",
    '    await new Promise((res) => setTimeout(res, 1000))',
    '  }',
    '}',
  ].join('\n')
  const r = scanWhileTrue(src('fixture.js', code))
  assert.equal(r.ok, false)
  assert.equal(r.findings[0].rule, 'L2-while-true-no-exit')
})

test('L2 绿夹具：break / return / deadline 任一存在 ⇒ 不报', () => {
  const three = [
    'while (true) { const { done } = await reader.read(); if (done) break }',
    'while (true) { const i = cursor++; if (i >= items.length) return; go(i) }',
    'const deadline = Date.now() + 600000',
    'while (true) { if (Date.now() > deadline) break; await sleep(10000) }',
  ].join('\n')
  const r = scanWhileTrue(src('ok.js', three))
  assert.equal(r.ok, true, '三种出口形态都不得报')
  assert.equal(r.stats.loops, 3, '必须真的识别到 3 个循环')
})

test('L3 红夹具：catch 内重调外层函数（竞品 X-C1 原形）⇒ 必须报', () => {
  const code = [
    'function onElToThumbnail () {',
    '  return new Promise((resolve) => {',
    '    html2canvas(el).then((c) => resolve(c)).catch((error) => {',
    '      this.onElToThumbnail()',
    '    })',
    '  })',
    '}',
  ].join('\n')
  const r = scanCatchRecursion(src('fixture.js', code))
  assert.equal(r.ok, false, 'catch 重调自身必须红')
  assert.equal(r.findings[0].rule, 'L3-catch-self-recursion')
  assert.match(r.findings[0].detail, /onElToThumbnail/)
})

test('L3 绿夹具：属性访问同名方法 / 调用别的函数 / 相邻 if( ⇒ 都不许报', () => {
  const code = [
    'function outer () {',
    '  try {',
    '    go()',
    '  } catch (e) {',
    "    this._logger.warn('failed', e)",     // 属性访问同名方法：不算自调用
    "    console.warn('x')",                  // 同样不算
    '    if (e) { retryOnce() }',             // 相邻 if(：不许把 if 当函数名
    '    const fallback = new outer()',     // 构造调用不算自调用（CCG 评审 i4）
    '  }',
    '}',
    'function retryOnce () { return 1 }',
  ].join('\n')
  const r = scanCatchRecursion(src('ok.js', code))
  assert.equal(r.ok, true, '三种正常写法都不得报')
  assert.ok(r.stats.catchBlocks >= 1, '必须真的扫到 catch 块')
})

test('L4 红夹具：有 setInterval 无 clearInterval ⇒ 必须报', () => {
  const code = [
    'export default {',
    '  mounted () {',
    '    this.timer = setInterval(() => this.tick(), 1000)',
    '  }',
    '}',
  ].join('\n')
  const r = scanIntervalCleanup(src('Comp.vue', code))
  assert.equal(r.ok, false)
  assert.equal(r.findings[0].rule, 'L4-interval-no-cleanup')
})

test('L4 绿夹具：配了 clearInterval ⇒ 不报；测试文件整类跳过', () => {
  const ok = 'mounted () { this.t = setInterval(f, 1000) }\nbeforeUnmount () { clearInterval(this.t) }'
  assert.equal(scanIntervalCleanup(src('Comp.vue', ok)).ok, true)
  const testFile = 'const t = setInterval(() => {}, 10)'
  const r = scanIntervalCleanup(src('apps/x/Comp.test.js', testFile))
  assert.equal(r.ok, true, '测试文件的定时器语义不同，不归这条管')
  assert.equal(r.stats.skippedTestFiles, 1)
})

// ─────────────────── ② 屏蔽器：注释与字符串里的字样不算 ───────────────────

test('maskNonCode：注释与字符串里的 while (true) 不得被当成真循环', () => {
  const code = [
    '// while (true) { 这里是注释，不是代码 }',
    "const s = 'while (true) { 字符串里 }'",
    '/* while (true) { 块注释 } */',
    'const t = 1',
  ].join('\n')
  const masked = maskNonCode(code)
  assert.doesNotMatch(masked, /while\s*\(\s*true\s*\)/, '注释/字符串内容必须被抹掉')
  assert.match(masked, /const t = 1/, '真代码必须保留')
  assert.equal(masked.length, code.length, '等长（下标可复用）')
})

test('L1 红夹具（评审驱动 i4）：单键映射表也必须在射程内', () => {
  // 评审指出：findCharMaps 原要求 keys.length >= 2，只有一个键的转义表会被静默跳过。
  // 值是 `&xxx;` 形态 + 必须有字符类回调，随机对象字面量撞上的概率可忽略 ⇒ 降到 >= 1。
  const code = [
    'const m = {',
    "  '&': '&amp;'",
    '}',
    's.replace(/[&<]/g, (x) => m[x])',
  ].join('\n')
  const r = scanEscapeMapCoverage(src('fixture.js', code))
  assert.equal(r.ok, false, '单键映射表 + 字符类含 < ⇒ 必须红')
  assert.equal(r.stats.mapsFound, 1, '单键映射表必须被识别')
})

test('prepareSources（评审驱动 i6）：屏蔽结果被扫描器复用，而不是各自重算', () => {
  const prepared = prepareSources(src('a.js', 'while (true) { await x() }'))
  assert.equal(prepared.length, 1)
  assert.equal(typeof prepared[0]._masked, 'string')
  assert.equal(typeof prepared[0]._maskedKeepStrings, 'string')
  // 把预置的屏蔽文本换成空白：扫描器若复用，就看不出循环（证明没有重算）
  prepared[0]._masked = ' '.repeat(prepared[0]._masked.length)
  const r = scanWhileTrue(prepared)
  assert.equal(r.stats.loops, 0, '必须复用外部预置的屏蔽文本（重算会得到 1）')
})


// ────────────────── ③ 真实仓：覆盖下界（防空转） ──────────────────

test('真实仓：四条锁都能命中真目标（命中数 ≥ 实测下界）', () => {
  const { collectSources } = require('./check-same-type-risk-locks')
  const sources = collectSources(REPO)
  assert.ok(sources.length > 2000, '扫描面必须覆盖整个仓（实测 2861 文件）')
  const r = scanAll(sources)
  // 打印是纪律的一部分：没有这些数字，「PASS」无法与「解析失败」区分
  console.log('[real-repo] L1 字符类回调=' + r.stats.l1.filesWithCharClassCallback +
    ' 映射表=' + r.stats.l1.mapsFound +
    ' ｜ L2 while(true)=' + r.stats.l2.loops +
    ' ｜ L3 catch=' + r.stats.l3.catchBlocks +
    ' ｜ L4 含 setInterval 文件=' + r.stats.l4.filesWithInterval)
  assert.ok(r.stats.l1.filesWithCharClassCallback >= 3, 'L1 调用点下界（实测 4）')
  assert.ok(r.stats.l1.mapsFound >= 1, 'L1 映射表下界（实测 2；=0 说明锁空转）')
  assert.ok(r.stats.l2.loops >= 8, 'L2 循环下界（实测 9）')
  assert.ok(r.stats.l3.catchBlocks >= 3000, 'L3 catch 块下界（实测 3257）')
  assert.ok(r.stats.l4.filesWithInterval >= 20, 'L4 定时器文件下界（实测 34）')
  assert.equal(r.ok, true, '当前仓应当全绿：' + JSON.stringify(r.findings))
})

// ─────────────────── ④ 接线锁：CLI 必须用同一实现，且被 CI 执行 ───────────────────

test('接线锁：CLI 复用同一实现（禁止第二份扫描器）', () => {
  const cli = fs.readFileSync(path.join(__dirname, 'check-same-type-risk-locks.js'), 'utf8')
  assert.match(cli, /require\(['"]\.\/lib\/same-type-risk-locks['"]\)/, 'CLI 必须 require 共享实现')
  assert.match(cli, /scanAll\s*\(/, 'CLI 必须调用 scanAll')
  for (const fn of ['function scanWhileTrue', 'function scanCatchRecursion', 'function scanEscapeMapCoverage']) {
    assert.equal(cli.includes(fn), false, 'CLI 里不得出现第二份实现：' + fn)
  }
})

test('接线锁：require CLI 不得退出进程（否则测试文件会假装通过）', () => {
  // 实测教训：CLI 的 main() 未加 require.main 守卫时，测试 require 它 ⇒ process.exit(0) 直接把
  // 测试进程干掉，node --test 只报 1 个 test 且结论 pass —— 那是**假绿**（本轮真踩到）。
  const cliPath = path.join(__dirname, 'check-same-type-risk-locks.js').split(path.sep).join('/')
  const script = "require('" + cliPath + "'); console.log('ALIVE')"
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
  assert.equal(r.status, 0, 'require 后应正常退出 rc=0；stderr=' + r.stderr)
  assert.match(r.stdout, /ALIVE/, 'require 之后必须还能继续执行（未被 process.exit 截断）')
})

test('接线锁：测试文件已被 quality-gate 的 changes job 执行（否则永不运行）', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  assert.match(wf, /node --test scripts\/same-type-risk-locks\.test\.js/, '必须登记进 workflow（check-unwired-tests 会红）')
})

test('端到端：CLI 在当前仓退出码为 0 且打印覆盖数字', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-same-type-risk-locks.js')], { encoding: 'utf8' })
  assert.equal(r.status, 0, 'CLI 必须 0 退出；stderr=' + r.stderr)
  assert.match(r.stdout, /\[same-type-risk\] PASS/)
  assert.match(r.stdout, /L2 while\(true\)=\d+/)
})
