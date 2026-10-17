/**
 * same-type-risk-locks-r3.test.js — R7/R11 锁的回归测试 + 共享库抽取的等价性锁
 *
 * 三层（与前两批一致）：
 * ① 红夹具：R7 独立映射表 / R11 有写无清 ⇒ 必须出现；
 * ② 绿夹具：真源文件自身豁免、配对完整的模块级集合、函数内局部集合 ⇒ 不出声；
 * ③ 共享库抽取的**行为等价锁**（本批的工程主体）：code-mask 与两批旧实现的 maskNonCode
 *    在同一夹具集上逐字节相等 —— 抽库最怕「顺手改语义」，这条锁把「等价」变成可回归验证的断言。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { scanIndependentMimeMaps, scanModuleStateGrowth, scanAllR3 } = require('./lib/same-type-risk-locks-r3')
const shared = require('./lib/code-mask')
const batch1 = require('./lib/same-type-risk-locks')
const batch2 = require('./lib/same-type-risk-locks-r2')

const REPO = path.join(__dirname, '..')
const src = (p, text) => [{ path: p, text }]

// ── R7 ──

test('R7 红：同对象内 image/jpeg 与 .jpg 共现 ⇒ 独立映射表必须报', () => {
  const code = [
    'const MIME = {',
    "  '.jpg': 'image/jpeg',",
    "  '.png': 'image/png',",
    '}',
  ].join('\n')
  const r = scanIndependentMimeMaps(src('svc.js', code))
  assert.equal(r.ok, false)
  assert.equal(r.findings[0].rule, 'R7-independent-mime-map')
})

test('R7 绿：真源文件自身豁免（否则锁自我报警）', () => {
  const text = fs.readFileSync(path.join(REPO, 'scripts', 'lib', 'image-mime.js'), 'utf8')
  const r = scanIndependentMimeMaps(src('scripts/lib/image-mime.js', text))
  assert.equal(r.ok, true, '真源文件的 FORMATS 表不得判红')
  assert.equal(r.stats.hits, 0)
})

test('R7 绿：与 mime 无关的对象（含 .png 无 image/png）不报', () => {
  const code = "const conf = { 'a.png': 'icon', output: 'out.png' }"
  const r = scanIndependentMimeMaps(src('svc.js', code))
  assert.equal(r.ok, true)
})

// ── R11 ──

test('R11 出声：模块级 Map 有写无清 ⇒ visible 面出现（不进红面）', () => {
  const code = [
    'const cache = new Map()',
    'function put (k, v) { cache.set(k, v) }',
    'function get (k) { return cache.get(k) }',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.ok, true, 'R11 只出声不拦截')
  assert.equal(r.stats.writeOnly, 1)
  assert.match(r.visible[0].detail, /只增语义/)
})

test('R11 绿：写清配对完整 ⇒ 不出声', () => {
  const code = [
    'const lock = new Map()',
    'function lockIt (k) { lock.set(k, 1) }',
    'function unlock (k) { lock.delete(k) }',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.stats.writeOnly, 0)
  assert.equal(r.visible.length, 0)
})

test('R11 绿：函数内局部集合不在审计面（只看模块顶层）', () => {
  const code = [
    'function f () {',
    '  const local = new Set()',
    '  local.add(1)',
    '  return local',
    '}',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.stats.moduleSets, 0)
})

test('R11（评审驱动 acefedf1-i4）：let/var 声明的模块级集合也在审计面', () => {
  // 首版 MODULE_SET_RE 只认 const ⇒ let/var 的模块级集合被静默漏掉（覆盖缺口）。
  const code = [
    'let cache = new Map()',
    'cache.set(1, 1)',
  ].join('\n')
  const r = scanModuleStateGrowth(src('svc.js', code))
  assert.equal(r.stats.writeOnly, 1, 'let 声明的只增集合必须出声')
})


// ── 共享库抽取的行为等价锁（本批工程主体） ──

const EQUIV_CASES = [
  '// while (true)',
  "const s = 'x = 90'",
  '/* comment */',
  'const t = `tpl ${a}`',
  's.replace(/[&<>"\']/g, m)',
  'a // trailing',
  'let r = /regex/g',
  'x = 1; // y = 2',
  "str = \"it's\"",
  '`multi\nline`',
  '// 中文注释 this.loading = true 「引号」',
  'const zh = "中文字符串"',
  'const nested = { a: { b: { c: 1 } } }',
]

test('code-mask：与第一批 maskNonCode 行为逐字节等价（12/12 夹具）', () => {
  for (const code of EQUIV_CASES) {
    assert.equal(
      shared.maskNonCode(code),
      batch1.maskNonCode(code),
      'mask 形态差异: ' + JSON.stringify(code.slice(0, 30))
    )
    assert.equal(
      shared.maskNonCode(code, { strings: 'keep' }),
      batch1.maskNonCode(code, { maskStrings: false }),
      'keep 语义差异: ' + JSON.stringify(code.slice(0, 30))
    )
  }
})

test('code-mask：与第二批 maskNonCode 行为逐字节等价（10/10 夹具）', () => {
  for (const code of EQUIV_CASES) {
    assert.equal(shared.maskNonCode(code), batch2.maskNonCode(code))
    assert.equal(
      shared.maskNonCode(code, { strings: 'keep' }),
      batch2.maskNonCode(code, { keepStrings: true })
    )
  }
})

test('code-mask：等长性（下标跨文本复用的前提）与 matchBrace 一致', () => {
  const code = 'a /* c */ b "s" { x: 1 }'
  const m = shared.maskNonCode(code)
  assert.equal(m.length, code.length)
  const open = m.indexOf('{')
  assert.equal(shared.matchBrace(m, open), code.lastIndexOf('}'))
  assert.equal(shared.matchBrace(m, open), batch1.matchBrace(m, open))
})

// ── 真实仓：覆盖下界（防空转） ──

test('真实仓：R7 扫描面真实覆盖；R11 审计面 ≥ 侦察实测；R7 当前 0 违规（四表已归真源）', () => {
  const { collectSources } = require('./check-same-type-risk-locks')
  const sources = collectSources(REPO)
  assert.ok(sources.length > 2000)
  const r = scanAllR3(sources)
  console.log('[real-repo-r3] R7 对象=' + r.stats.r7.objectsScanned +
    ' 独立映射=' + r.stats.r7.hits +
    ' ｜ R11 模块级集合=' + r.stats.r11.moduleSets +
    ' 有写无清=' + r.stats.r11.writeOnly)
  assert.ok(r.stats.r7.objectsScanned >= 500, 'R7 对象扫描下界')
  assert.ok(r.stats.r11.moduleSets >= 10, 'R11 模块级集合下界（侦察实测 4+）')
  assert.equal(r.ok, true, '当前仓应全绿：' + JSON.stringify(r.findings))
})

// ── 接线锁 ──

test('接线锁：CLI 已接入第三批（scanAllR3）且两个旧批次仍被同-cli 使用', () => {
  const cli = fs.readFileSync(path.join(__dirname, 'check-same-type-risk-locks.js'), 'utf8')
  assert.match(cli, /same-type-risk-locks-r3/)
  assert.match(cli, /scanAllR3\s*\(/)
  assert.match(cli, /same-type-risk-locks-r2/)
})

test('接线锁：r3 测试已登记进 quality-gate changes job', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  assert.match(wf, /node --test scripts\/same-type-risk-locks-r3\.test\.js/)
  assert.match(wf, /node --test scripts\/image-mime\.test\.js/)
})

test('接线锁：require 第三批模块不得退出进程', () => {
  const { spawnSync } = require('node:child_process')
  const p = path.join(__dirname, 'lib', 'same-type-risk-locks-r3.js').split(path.sep).join('/')
  const r = spawnSync(process.execPath, ['-e', "require('" + p + "'); console.log('ALIVE')"], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /ALIVE/)
})
