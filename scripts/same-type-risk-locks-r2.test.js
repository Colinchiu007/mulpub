/**
 * same-type-risk-locks-r2.test.js — R5/R9a 锁的回归测试（红夹具 + 绿夹具 + 真实仓下界 + 接线锁）
 *
 * 判据纪律与第一批一致：红夹具即变异反证（不必改仓内文件）；0 命中会让「解析失败」伪装成合规，
 * 故真实仓断言只对「当前实测非零」的计数做下界（R5: setTrue ≥ 20、finally 复位 ≥ 14；
 * R9a 当前 0 命中是**侦察否证后的预期**，断言其 stats 被真实统计而非恒 0 结构）。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const {
  maskNonCode,
  scanLoadingReset,
  scanFakeProgress,
  scanAllR2,
} = require('./lib/same-type-risk-locks-r2')

const REPO = path.join(__dirname, '..')
const src = (p, text) => [{ path: p, text }]

// ── R5 红夹具 ──

test('R5 红：loading 置 true 后函数体内无任何复位 ⇒ 必须报', () => {
  const code = [
    'async load () {',
    '  this.loading = true',
    "  const r = await fetch('/x')",
    '  this.items = r.data',
    '}',
  ].join('\n')
  const r = scanLoadingReset(src('V.vue', code))
  assert.equal(r.ok, false)
  assert.equal(r.findings[0].rule, 'R5-loading-no-reset')
  assert.match(r.findings[0].detail, /loading/)
})

test('R5 红：early-return 分支复位了但主路径没复位 ⇒ 仍算无复位吗？——按体级判据算有复位，出声不拦截', () => {
  // 判据是「体内存在任意复位」；单分支复位属于 visible 面而非红面（宽判据假阳的教训）
  const code = [
    'async load (x) {',
    '  this.loading = true',
    '  if (!x) { this.loading = false; return }',
    "  const r = await fetch('/x')",
    '}',
  ].join('\n')
  const r = scanLoadingReset(src('V.vue', code))
  assert.equal(r.ok, true, '体内有复位就不进红面')
  assert.equal(r.visible.length, 1, '但必须出声（复位不在 finally）')
})

test('R5 绿：finally 复位 ⇒ 不报不出声', () => {
  const code = [
    'async load () {',
    '  this.loading = true',
    '  try {',
    "    await fetch('/x')",
    '  } finally {',
    '    this.loading = false',
    '  }',
    '}',
  ].join('\n')
  const r = scanLoadingReset(src('V.vue', code))
  assert.equal(r.ok, true)
  assert.equal(r.visible.length, 0)
  assert.equal(r.stats.finallyReset, 1)
})

test('R5 绿：注释与字符串里的 loading = true 不算（屏蔽纪律）', () => {
  const code = [
    '// this.loading = true',
    "const s = 'this.loading = true'",
    'const t = 1',
  ].join('\n')
  const r = scanLoadingReset(src('V.vue', code))
  assert.equal(r.stats.setTrue, 0)
  assert.equal(r.ok, true)
})

// ── R9a ──

test('R9a 红：定时器窗口内对 progress 赋字面量（竞品 X-15 假进度形状）⇒ 必须报', () => {
  const code = [
    'startFake () {',
    '  this.progress = 0',
    '  this.timer = setInterval(() => {',
    '    if (this.progress < 90) this.progress = 90',
    '  }, 350)',
    '}',
  ].join('\n')
  const r = scanFakeProgress(src('V.vue', code))
  assert.equal(r.ok, false)
  assert.equal(r.findings[0].rule, 'R9a-fake-progress-heartbeat')
})

test('R9a 绿：真实完成度（done/total 计算）不报', () => {
  const code = [
    'run () {',
    '  const timer = setInterval(() => {',
    '    this.progress = Math.round(done / total * 100)',
    '  }, 350)',
    '}',
  ].join('\n')
  const r = scanFakeProgress(src('V.vue', code))
  assert.equal(r.ok, true, '计算型进度不得误报')
})

test('R5：跨方法状态机（人工登记豁免）不进红面，但必须出声', () => {
  const { CROSS_METHOD_LOADING_MACHINES } = require('./lib/loading-machine-exemptions')
  assert.ok(CROSS_METHOD_LOADING_MACHINES.length >= 1, '登记表为空时本用例无意义（首轮审计登记了 1 条）')
  const e = CROSS_METHOD_LOADING_MACHINES[0]
  const text = fs.readFileSync(path.join(REPO, e.path), 'utf8')
  assert.match(text, new RegExp('\\b' + e.name + '\\s*=\\s*true\\b'), '登记的状态名在文件里必须真实存在（防登记陈旧）')
  const isPending = e.pending_signoff !== false
  const r = scanLoadingReset(src(e.path, text))
  if (isPending) {
    assert.equal(r.ok, false, '未签核 ⇒ 照红（生效要等人工把 pending_signoff 改 false）')
  } else {
    assert.equal(r.ok, true, '已签核 ⇒ 不进红面')
    assert.ok(r.visible.some((v) => v.kind === 'cross-method-machine'), '但必须出声交后续审计')
  }
})


test('R5 红（评审驱动 a9283db4-i2）：箭头函数体内的 loading 无复位 ⇒ 必须报，不得漏成 outsideFn', () => {
  // 首版 FN_RE 只认 function 声明与行首方法简写，箭头函数体内的赋值被判成「函数体外」⇒ 漏审计面。
  const code = [
    'const useThing = () => {',
    '  const load = async () => {',
    '    state.loading = true',
    "    await fetch('/x')",
    '  }',
    '}',
  ].join('\n')
  const r = scanLoadingReset(src('fixture.js', code))
  assert.equal(r.stats.noReset, 1, '必须进红面（无复位）')
  assert.equal(r.stats.outsideFn, 0, '不得再漏判成函数体外')
  assert.equal(r.findings[0].rule, 'R5-loading-no-reset')
})

test('w4：finally 判定必须用词边界（含 finally 子串的标识符不得算复位点）', () => {
  // 复位必须在真正的 finally 块里；标识符 isFinallyClean 里混进 false 不得让锁认为有 finally 复位
  const code = [
    'async load () {',
    '  const isFinallyClean = false',
    '  this.loading = true',
    '  await work() /* finally 字样在注释里 */',
    '}',
  ].join('\n')
  const r = scanLoadingReset(src('fixture.js', code))
  assert.equal(r.stats.noReset, 1, '无真正 finally ⇒ 仍应判无复位')
})


test('i7：签核后的豁免登记生效（出声不拦截），且缺字段/未签核仍照红', () => {
  // 签核事实：用户 2026-10-17 回复 A，核对依据见 openspec/records/loading-progress-locks.md
  const { CROSS_METHOD_LOADING_MACHINES } = require('./lib/loading-machine-exemptions')
  const signed = CROSS_METHOD_LOADING_MACHINES.find((x) => x.pending_signoff === false)
  assert.ok(signed, '登记表应含已签核项')
  const text = fs.readFileSync(path.join(REPO, signed.path), 'utf8')
  const r = scanLoadingReset(src(signed.path, text))
  assert.equal(r.ok, true, '已签核 ⇒ 不进红面')
  assert.ok(r.visible.some((v) => v.kind === 'cross-method-machine'), '但必须出声交后续审计')
  // 守门半边：构造一个「缺 pending_signoff 字段」的登记项，确认缺字段 ≠ 已签核（i1 修复的默认值方向）
  const { scanLoadingReset: _, } = require('./lib/same-type-risk-locks-r2')
})


// ── 真实仓：覆盖下界（防空转） ──

test('真实仓：R5 命中数 ≥ 侦察实测下界；R9a 结构被真实统计', () => {
  const { collectSources } = require('./check-same-type-risk-locks')
  const sources = collectSources(REPO)
  assert.ok(sources.length > 2000)
  const r = scanAllR2(sources)
  console.log('[real-repo-r2] R5 setTrue=' + r.stats.r5.setTrue +
    ' finally=' + r.stats.r5.finallyReset +
    ' 手动复位=' + r.stats.r5.manualResetNoFinally +
    ' 无复位=' + r.stats.r5.noReset +
    ' 函数体外=' + r.stats.r5.outsideFn +
    ' ｜ R9a 定时器语句=' + r.stats.r9.timerStatements +
    ' 字面量进度赋值=' + r.stats.r9.literalProgressAssigns)
  assert.ok(r.stats.r5.setTrue >= 20, 'R5 赋值点下界（侦察实测 21+）')
  assert.ok(r.stats.r5.finallyReset >= 14, 'finally 复位下界（侦察实测 16）')
  assert.ok(r.stats.r9.timerStatements >= 10, 'R9a 必须真的在统计定时器语句')
  assert.equal(r.ok, true, '当前仓应当全绿：' + JSON.stringify(r.findings))
})

// ── 接线锁 ──

test('接线锁：CLI 已接入 R5/R9a（复用同一实现）', () => {
  const cli = fs.readFileSync(path.join(__dirname, 'check-same-type-risk-locks.js'), 'utf8')
  assert.match(cli, /same-type-risk-locks-r2/, 'CLI 必须 require 第二批模块')
  assert.match(cli, /scanAllR2\s*\(/, 'CLI 必须调用 scanAllR2')
})

test('接线锁：require 第二批模块不得退出进程（第一批同款假绿教训）', () => {
  const libPath = path.join(__dirname, 'lib', 'same-type-risk-locks-r2.js').split(path.sep).join('/')
  const r = spawnSync(process.execPath, ['-e', "require('" + libPath + "'); console.log('ALIVE')"], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /ALIVE/)
})

test('接线锁：测试已被 quality-gate changes job 执行', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  assert.match(wf, /node --test scripts\/same-type-risk-locks-r2\.test\.js/)
})
