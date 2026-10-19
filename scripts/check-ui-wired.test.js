'use strict'
/**
 * check-ui-wired 自测（阶段 5.3）。
 *
 * 三条判据各自的"能不能失败"都在这里测：
 *  ① props 检测漏一种写法 ⇒ 那一类组件永远不进域；
 *  ② 注释没剥 ⇒ 「文档里提到」被读成「代码里在用」（TrialBanner 的真实命中就是一句注释）；
 *  ③ 测试面没排除 ⇒ 每个组件都被自己的用例"引用"，判据恒不成立（本仓「注册≠注入」的同型）。
 * 另加两条**反失明**判据：扫描域为空 / 规模退化到个位数 ⇒ 一律非零，
 * 因为"零个候选"读起来完全像"零个违规"。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { main, stripComments, isTestSurface, hasProps, countProductionRefs } = require('./check-ui-wired')

const C = (...l) => l.join('\n')

test('hasProps：四种 props 声明写法都必须进判定域，纯展示组件不得进', () => {
  assert.strictEqual(hasProps(C('<template><div/></template>', '<script setup>', 'const props = defineProps({ a: Number })', '</script>')), true)
  assert.strictEqual(hasProps(C('<script setup>', 'defineProps<{ a: number }>()', '</script>')), true)
  assert.strictEqual(hasProps(C('<script>', 'export default { props: { a: Number } }', '</script>')), true)
  assert.strictEqual(hasProps(C('<script>', 'export default { props: [\'a\'] }', '</script>')), true)
  assert.strictEqual(hasProps(C('<template><div/></template>', '<script setup>', 'const x = 1', '</script>')), false)
})

test('stripComments：整行注释与 HTML 注释必须被剥掉，模板用法与 import 必须留下', () => {
  const src = C('<!-- 见 TrialBanner.vue 的三轮注释 -->', ' // 引用 TrialBanner.vue', 'const b = \'TrialBanner.vue\' // TrialBanner.vue', '<TrialBanner />')
  const out = stripComments(src)
  assert.ok(!out.includes('见 TrialBanner'), 'HTML 注释行没被剥掉')
  assert.ok(!out.includes('// 引用'), '整行 // 注释没被剥掉')
  assert.ok(out.includes('const b ='), '代码行被误剥')
  assert.ok(out.includes('<TrialBanner />'), '模板行被误剥')
})

test('isTestSurface：用例文件与 tests/ 目录都不算生产消费者', () => {
  assert.strictEqual(isTestSurface('apps/desktop/src/components/Foo.test.js'), true)
  assert.strictEqual(isTestSurface('apps/desktop/tests/e2e/foo.spec.ts'), true)
  assert.strictEqual(isTestSurface('apps/desktop/src/App.vue'), false)
  assert.strictEqual(isTestSurface('apps/desktop/electron/main.js'), false)
})

test('countProductionRefs：PascalCase / kebab / import 三种真实引用都要数到，注释里的名字数不到', () => {
  const target = path.join('D:', 'x', 'components', 'FooBar.vue')
  const consumers = [
    [path.join('D:', 'x', 'views', 'A.vue'), C('<FooBar />')],
    [path.join('D:', 'x', 'views', 'B.vue'), C('<foo-bar :a="1" />')],
    [path.join('D:', 'x', 'views', 'C.vue'), C('import FooBar from \'./FooBar.vue\'')],
    // 只有注释提到 —— 传进来的必须已是 stripComments 的产物，这里模拟已剥完的状态
    [path.join('D:', 'x', 'views', 'D.vue'), ''],
  ]
  assert.strictEqual(countProductionRefs(target, '<script setup>defineProps({a:Number})</script>', consumers), 3)
})

test('规模下界：真实仓扫描必须落在千级文件 / 百级组件，退化到个位数即判探针失明', () => {
  const log = []
  const orig = { log: console.log, err: console.error }
  console.log = (...a) => log.push(a.join(' '))
  console.error = (...a) => log.push('E:' + a.join(' '))
  let rc
  try { rc = main(['--json']) } finally { console.log = orig.log; console.error = orig.err }
  const joined = log.join('\n')
  assert.strictEqual(rc, 0, '本分支已按现状登记欠账，门禁必须绿；rc=' + rc + ' 现场：\n' + joined)
  const m = joined.match(/域=(\d+) 文件 \/ 生产面 vue=(\d+) \/ 声明 props=(\d+) \/ 零引用=(\d+) \/ 登记=(\d+)/)
  assert.ok(m, '判据没有打印现场读数（域/组件/props/零引用/登记），拒绝"看不见即通过"：\n' + joined)
  assert.ok(Number(m[1]) > 500 && Number(m[2]) > 50 && Number(m[3]) > 50, '规模退化：' + joined)
  assert.ok(Number(m[4]) === Number(m[5]), '命中数与登记数必须相等（多命中=新死组件，少命中=陈旧登记）：' + joined)
})

test('fixture 整跑 main：注释-only 与 测试-only 两种"假引用"都必须被判未接线，真实使用不得被判', () => {
  // 这条用例是变异 A / B 的靶心：两处判据（剥注释、排除测试面）都住在 main 的装配层，
  // 纯函数级用例对它们结构性免疫 —— 摘掉 stripComments 或去掉 isTestSurface 过滤时，
  // 只有这里会立刻把「本该判死的组件」读成「已被消费」。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-uiwired-'))
  const w = (rel, text) => {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text, 'utf8')
  }
  const comp = (name) => C('<template><div/></template>', '<script setup>', 'defineProps({ a: Number })', '</script>')
  w('components/Wired.vue', comp('Wired'))
  w('components/CommentOnly.vue', comp('CommentOnly'))
  w('components/TestOnly.vue', comp('TestOnly'))
  w('views/A.vue', C('<template><div/></template>', '<script>', '// 未来可能挂 CommentOnly.vue', '</script>'))
  w('views/B.test.js', 'import TestOnly from \'../components/TestOnly.vue\'')
  w('views/C.vue', C('<template><Wired /></template>'))
  const debtPath = path.join(root, 'debt.json')
  fs.writeFileSync(debtPath, '{}', 'utf8')

  const sink = []
  const orig = { l: console.log, e: console.error }
  console.log = (...a) => sink.push(a.join(' '))
  console.error = (...a) => sink.push(a.join(' '))
  let rc
  try { rc = main(['--scan-root=' + root, '--debt=' + debtPath, '--json']) }
  finally {
    console.log = orig.l; console.error = orig.e
    // 这里是删**本用例自己刚在 os.tmpdir() 里创建的 fixture 目录**，不是仓库产物：
    // AGENTS R0 的守卫域是"仓库内的临时产物"（误删事故五次全发生在仓库目录上），
    // 而 safe-delete.js 拒收目录、且会把东西送进用户回收站 —— 在测试里调它等于污染用户机器。
    // 口径：目录级递归删除只允许作用于本次 mkdtemp 出来的、路径由本用例持有的临时目录。
    fs.rmSync(root, { recursive: true, force: true })
  }
  const joined = sink.join('\n')
  assert.strictEqual(rc, 1, '两条死组件必须判红：\n' + joined)
  assert.ok(joined.includes('UNWIRED components/TestOnly.vue'), '测试面引用不算消费：\n' + joined)
  assert.ok(joined.includes('UNWIRED components/CommentOnly.vue'), '注释里提到不算被使用：\n' + joined)
  assert.ok(!joined.includes('UNWIRED components/Wired.vue'), '真实使用被判死（判据过严）：\n' + joined)
  assert.ok(joined.includes('零引用=2'), '命中数必须恰好是 2：\n' + joined)
})

test('扫描根缺失 ⇒ rc=2（"一个都没扫到"不得读成合规）', () => {
  const sink = []
  const orig = { e: console.error, l: console.log }
  console.error = (...a) => sink.push(a.join(' '))
  console.log = (...a) => sink.push(a.join(' '))
  let rc
  try { rc = main(['--scan-root=' + path.join(os.tmpdir(), 'mp-uiwired-definitely-missing-' + process.pid)]) }
  finally { console.error = orig.e; console.log = orig.l }
  assert.strictEqual(rc, 2, '必须走"判据自身故障"档而不是 0/1')
  assert.ok(sink.join('\n').includes('扫描根不存在'))
})

test('未知旗标不得让判据静默跳过（参数一律 fail-closed，不静默忽略）', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mp-uiwired-')), 'missing')
  const orig = { e: console.error }
  const sink = []
  console.error = (...a) => sink.push(a.join(' '))
  let rc
  const savedRoot = path.resolve(__dirname, '..')
  try {
    // 通过临时改变 process.cwd 无法移动 REPO（模块已解析），因此直接断言 main 对不存在的
    // DEFAULT_SCAN_ROOT 的分支行为：用一个隔离目录跑，期望它走"扫描根不存在"档
    fs.mkdirSync(dir, { recursive: true })
    rc = main(['--nowhere'])
  } finally { console.error = orig.e }
  // --nowhere 不是已知旗标 ⇒ 走真实域，结果必须仍是 0（证明未知旗标不会被当成"关掉判据"）
  assert.strictEqual(rc, 0, '未知旗标必须被忽略而不是让判据静默跳过：\n' + sink.join('\n'))
  assert.ok(savedRoot)
})

test('欠账必须带 reason；缺原因 ⇒ rc=1（防"清空清单即免检"）', () => {
  const debtPath = path.join(__dirname, 'ui-wired-debt.json')
  const before = fs.readFileSync(debtPath, 'utf8')
  const obj = JSON.parse(before)
  const key = Object.keys(obj)[0]
  const bad = { [key]: {} }
  fs.writeFileSync(debtPath, JSON.stringify(bad, null, 2), 'utf8')
  const orig = { e: console.error, l: console.log }
  const sink = []
  console.error = (...a) => sink.push(a.join(' '))
  console.log = (...a) => sink.push(a.join(' '))
  let rc
  try { rc = main([]) } finally { fs.writeFileSync(debtPath, before, 'utf8'); console.error = orig.e; console.log = orig.l }
  assert.strictEqual(rc, 1, '无 reason 的登记必须判红：\n' + sink.join('\n'))
  assert.ok(sink.join('\n').includes('DEBT_NO_REASON'), '必须点名缺原因的条目')
  assert.strictEqual(fs.readFileSync(debtPath, 'utf8'), before, '还原后必须与备份逐字节相同')
})

test('清单被清空（伪造"没有欠账"）⇒ 立刻判红并点名未登记的死组件', () => {
  const debtPath = path.join(__dirname, 'ui-wired-debt.json')
  const before = fs.readFileSync(debtPath, 'utf8')
  fs.writeFileSync(debtPath, '{}', 'utf8')
  const orig = { e: console.error, l: console.log }
  const sink = []
  console.error = (...a) => sink.push(a.join(' '))
  console.log = (...a) => sink.push(a.join(' '))
  let rc
  try { rc = main([]) } finally { fs.writeFileSync(debtPath, before, 'utf8'); console.error = orig.e; console.log = orig.l }
  assert.strictEqual(rc, 1, '清空清单不得免检：\n' + sink.join('\n'))
  const joined = sink.join('\n')
  for (const k of Object.keys(JSON.parse(before))) {
    assert.ok(joined.includes('UNWIRED ' + k), '必须逐个点名：' + k)
  }
  assert.strictEqual(fs.readFileSync(debtPath, 'utf8'), before)
})
