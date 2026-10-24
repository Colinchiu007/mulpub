'use strict'
/**
 * check-toast-single-exit 自测（UX 审计 §16.2 口径③）。
 *
 * 判据的牙是「按文件计份数」，所以核心用例必须是**同一文件从 3 涨到 4** 要红 ——
 * 任何"该文件已在基线里"的存在性判据对此完全免疫。另两条：泛化入口也要被数（否则
 * "改用 ElMessage({...})" 会绕过直调统计）、基线只能缩小。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { main, scan, stripLineComments, EXIT_ALLOWLIST } = require('./check-toast-single-exit')

function fixture (files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-toast-exit-'))
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text, 'utf8')
  }
  return root
}
function baselineFile (root, obj) {
  const p = path.join(root, 'baseline.json')
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8')
  return p
}
function run (argv) {
  const sink = []
  const orig = { l: console.log, e: console.error }
  console.log = (...a) => sink.push(a.join(' '))
  console.error = (...a) => sink.push('E:' + a.join(' '))
  let rc
  try { rc = main(argv) } finally { console.log = orig.l; console.error = orig.e }
  return { rc, out: sink.join('\n') }
}

test('同一文件直调数从 3 涨到 4 ⇒ 必须红（存在性判据抓不到这一格）', () => {
  const root = fixture({
    'views/A.vue': '<script>\nElMessage.error(1)\nElMessage.error(2)\nElMessage.error(3)\nElMessage.error(4)\n</script>\n',
  })
  const bl = baselineFile(root, { byFile: { 'views/A.vue': 3 }, genericByFile: {} })
  const r = run(['--scan-root=' + root, '--baseline=' + bl])
  assert.strictEqual(r.rc, 1, r.out)
  assert.match(r.out, /GREW views\/A\.vue：基线 3 处 → 现 4 处/)
  assert.match(r.out, /直调处数=4 \/ 基线处数=3/)
})

test('新文件开口子 ⇒ NEW_FILE；基线里的文件不再命中 ⇒ STALE（清单只能缩小）', () => {
  const root = fixture({
    'views/Old.vue': '<script>ElMessage.error(1)</script>\n',
    'views/New.vue': '<script>ElMessage.success(1)\nElMessage.success(2)</script>\n',
  })
  const bl = baselineFile(root, { byFile: { 'views/Old.vue': 1, 'views/Gone.vue': 3 }, genericByFile: {} })
  const r = run(['--scan-root=' + root, '--baseline=' + bl])
  assert.strictEqual(r.rc, 1, r.out)
  assert.match(r.out, /NEW_FILE views\/New\.vue 直调 2 处/)
  assert.match(r.out, /STALE_BASELINE views\/Gone\.vue/)

  // 存量减少（迁走一处）必须放行 —— 棘轮只管上涨
  const bl2 = baselineFile(root, { byFile: { 'views/Old.vue': 1, 'views/New.vue': 2 }, genericByFile: {} })
  assert.strictEqual(run(['--scan-root=' + root, '--baseline=' + bl2]).rc, 0)
})

test('泛化 ElMessage({...}) 在出口之外出现 ⇒ 红；进基线后只能缩小', () => {
  const exitRel = EXIT_ALLOWLIST[0]
  const root = fixture({
    [exitRel]: 'ElMessage({ message: 1 })\n',
    'views/B.vue': 'ElMessage({ message: 2 })\nElMessage({ message: 3 })\n',
  })
  const r1 = run(['--scan-root=' + root, '--baseline=' + baselineFile(root, { byFile: {}, genericByFile: {} })])
  assert.strictEqual(r1.rc, 1, r1.out)
  assert.match(r1.out, /NEW_GENERIC_FILE views\/B\.vue/)
  const r2 = run(['--scan-root=' + root, '--baseline=' + baselineFile(root, { byFile: {}, genericByFile: { 'views/B.vue': 2 } })])
  assert.strictEqual(r2.rc, 0, r2.out)
  const r3 = run(['--scan-root=' + root, '--baseline=' + baselineFile(root, { byFile: {}, genericByFile: { 'views/B.vue': 1 } })])
  assert.strictEqual(r3.rc, 1, r3.out)
  assert.match(r3.out, /GREW_GENERIC views\/B\.vue/)
})

test('方括号成员形态 ElMessage[type]({...}) 在出口之外出现 ⇒ 红；出口内出现不计', () => {
  // 这一档不是理论完备性：出口**正是**用这一形（档位由变量承载）。
  // 如果门禁只数 `.error(` 与 `(`，那么"别人也改用方括号"就是一条完全不被观测的绕过路径。
  const exitRel = EXIT_ALLOWLIST[0]
  const root = fixture({
    [exitRel]: 'ElMessage[type]({ message: 1 })\n',
    'views/D.vue': 'ElMessage[foo]({ message: 2 })\n',
  })
  const r1 = run(['--scan-root=' + root, '--baseline=' + baselineFile(root, { byFile: {}, genericByFile: {}, memberByFile: {} })])
  assert.strictEqual(r1.rc, 1, r1.out)
  assert.match(r1.out, /NEW_MEMBER_FILE views\/D\.vue/)
  assert.doesNotMatch(r1.out, /NEW_MEMBER_FILE composables/, '出口内的成员形态必须由豁免吸收，否则门禁会把自己的出口判成违规')
  const r2 = run(['--scan-root=' + root, '--baseline=' + baselineFile(root, { byFile: {}, genericByFile: {}, memberByFile: { 'views/D.vue': 1 } })])
  assert.strictEqual(r2.rc, 0, r2.out)
  // 登记陈旧：文件不再命中却不删条目，同样必须红
  const r3 = run(['--scan-root=' + fixture({ [exitRel]: 'ElMessage[type]({ message: 1 })\n' }),
    '--baseline=' + baselineFile(root, { byFile: {}, genericByFile: {}, memberByFile: { 'views/D.vue': 1 } })])
  assert.strictEqual(r3.rc, 1, r3.out)
  assert.match(r3.out, /STALE_MEMBER_BASELINE views\/D\.vue/)
})

test('注释里举例写的 ElMessage.error( 不得计数（与 5.3 同源：文档提到 ≠ 代码在用）', () => {
  assert.strictEqual(stripLineComments('// 例如 ElMessage.error(x)\nconst a = 1').includes('ElMessage'), false)
  assert.ok(stripLineComments('ElMessage.error(x) // 顺带 ElMessage.error 的说法').includes('ElMessage.error(x)'))
  const root = fixture({ 'views/C.vue': '<script>\n// 迁移前写法：ElMessage.error(msg)\nconst ok = 1\n</script>\n' })
  const r = run(['--scan-root=' + root, '--baseline=' + baselineFile(root, { byFile: {}, genericByFile: {} })])
  assert.strictEqual(r.rc, 2, '一个直调都没数到 ⇒ 必须走"判据失明"档而不是 PASS：\n' + r.out)
})

test('测试面不计入；扫描根缺失与基线格式错都走 rc=2', () => {
  const root = fixture({
    'views/D.vue': '<script>ElMessage.error(1)</script>\n',
    'views/D.test.js': 'ElMessage.error(1)\nElMessage.error(2)\n',
  })
  const { byFile } = scan(root)
  assert.deepStrictEqual([...byFile.keys()], ['views/D.vue'], '测试文件被计入了')
  assert.strictEqual(run(['--scan-root=' + path.join(root, 'nope')]).rc, 2)
  assert.strictEqual(run(['--scan-root=' + root, '--baseline=' + path.join(root, 'missing.json')]).rc, 2)
  assert.strictEqual(run(['--scan-root=' + root, '--baseline=' + baselineFile(root, { nope: 1 })]).rc, 2)
})

test('真实仓：现场处数必须等于基线总数，且规模不得退化（反失明）', () => {
  const r = run(['--json'])
  assert.strictEqual(r.rc, 0, '本批按现状登记基线，门禁必须绿：\n' + r.out)
  const m = r.out.match(/域=(\d+) 文件 \/ 直调文件=(\d+) \/ 直调处数=(\d+) \/ 基线处数=(\d+) \/ 泛化处数=(\d+)/)
  assert.ok(m, '判据必须打印现场读数：\n' + r.out)
  const [, domain, files, now, base] = m.map(Number)
  assert.ok(domain > 500 && files > 10 && now > 50, '规模退化即探针失明：' + r.out)
  assert.strictEqual(now, base, '现场处数必须等于基线总数：' + r.out)
})
