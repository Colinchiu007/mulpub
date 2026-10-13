/**
 * verify-platform-onboarding 的测试（P3-1 验收判据③）。
 *
 * 风格对齐本仓既有 scripts/*.test.js：node:test + node:assert/strict
 * （本仓 scripts 下的测试没有 expect —— 用 vitest 风格会 expect is not a function，
 *   本文件第一版就是这么红的）。
 *
 * 关键：反证 —— 故意漏一步，该步必须 FAIL。
 * 一个永远绿的自检脚本比没有脚本更坏（它会让人以为查过了）。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts/verify-platform-onboarding.js')
const { buildChecks, slugIsKnown } = require(SCRIPT)

function run (slug) {
  const args = slug === '' ? [SCRIPT] : [SCRIPT, slug]
  try {
    const out = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

test('① 对已有平台 baijiahao 跑 ⇒ 13 条全 PASS，exit=0', () => {
  const r = run('baijiahao')
  assert.ok(r.out.includes('全部 13 条判据通过'), '实际输出尾部: ' + r.out.slice(-200))
  assert.ok(!r.out.includes('FAIL'), '不应有 FAIL')
  assert.equal(r.code, 0)
})

test('② 对不存在的 slug 跑 ⇒ exit 非 0，且逐条报 FAIL（不静默通过）', () => {
  const r = run('no_such_platform_xyz')
  assert.notEqual(r.code, 0)
  assert.match(r.out, /FAIL/)
  assert.ok(r.out.includes('config/platforms.yaml 里没有'))
  assert.ok(!r.out.includes('全部 13 条判据通过'))
})

test('②b 缺参数 ⇒ exit=2 并给用法', () => {
  const r = run('')
  assert.equal(r.code, 2)
  assert.ok(r.out.includes('用法'))
})

test('②c slug 形态非法 ⇒ exit=2（防路径注入）', () => {
  for (const bad of ['../etc', 'A-B', 'a b', 'a/b']) {
    const r = run(bad)
    assert.equal(r.code, 2, 'slug=' + bad + ' 未被拒绝（code=' + r.code + '）')
  }
})

test('③ 反证：不存在的 slug 让多数判据 FAIL，而全局不变量仍 PASS', () => {
  const checks = buildChecks('no_such_platform_xyz')
  assert.equal(checks.length, 13)
  const results = checks.map((c) => {
    try { return c.fn().ok } catch (e) { return false }
  })
  assert.ok(results.filter((x) => !x).length > 0, '不存在的 slug 必须让判据 FAIL')
  // ★ 步骤 12/13 是全局不变量（与 slug 无关），本就不该 FAIL ——
  //   这正是「逐条独立」的证据：不同判据对同一输入给出不同结论。
  assert.equal(results[11], true, '步骤 12 是全局不变量，不应因 slug 不存在而 FAIL')
  assert.equal(results[12], true, '步骤 13 是全局不变量，不应因 slug 不存在而 FAIL')
})

test('③b 反证：前 11 步对不存在的平台不能全部通过', () => {
  const checks = buildChecks('zzz_absent_platform')
  const perStep = checks.slice(0, 11).map((c) => {
    try { return { id: c.id, ok: c.fn().ok } } catch (e) { return { id: c.id, ok: false } }
  })
  const passed = perStep.filter((x) => x.ok)
  assert.ok(passed.length < 11, '步骤 ' + passed.map((x) => x.id).join(',') + ' 对不存在的平台也通过了')
  assert.ok(perStep.filter((x) => !x.ok).length >= 5, 'FAIL 步数低于预期底线')
})

test('slugIsKnown 对真实平台 true，对瞎写的 false', () => {
  assert.equal(slugIsKnown('baijiahao'), true)
  assert.equal(slugIsKnown('zzz_absent_platform'), false)
})

test('判据条数恰为 13（11 步 + 2 条额外），且 id 连续 1..13', () => {
  const checks = buildChecks('baijiahao')
  assert.deepEqual(checks.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
})

test('每条判据都返回 {ok, detail} 形态（不抛）', () => {
  for (const c of buildChecks('baijiahao')) {
    const r = c.fn()
    assert.equal(typeof r.ok, 'boolean', '步骤 ' + c.id + ' 未返回 ok')
    assert.equal(typeof r.detail, 'string', '步骤 ' + c.id + ' 未返回 detail')
  }
})

test('输出里 PASS/FAIL 逐条可见（不是只给汇总）', () => {
  const r = run('baijiahao')
  const passes = (r.out.match(/^PASS/gm) || []).length
  assert.equal(passes, 13)
})
