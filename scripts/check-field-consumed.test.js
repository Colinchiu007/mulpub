'use strict'
/**
 * check-field-consumed 自测（阶段 5.4）。
 *
 * 每条都对着一个"如果写反就会假绿/假红"的具体落点：
 *  ① store 的 return 清单那一行**不能**被当成消费（否则判据永不红）；
 *  ② `storeToRefs` 的重命名解构 `{ currentBoard: board }` **必须**被当成消费
 *     （判据第一版加了 `(?!\s*:)` lookahead，在这里假红过一次，本仓把它钉成回归锁）；
 *  ③ 测试文件里的引用**不能**算消费（夹具自己喂的数据不构成生产接线）；
 *  ④ 扫描域 / store 数为 0 ⇒ rc=2，"一个都没扫到"必须与"全都合格"可区分。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { main, classifyField, isTest } = require('./check-field-consumed')

const C = (...l) => l.join('\n')

test('classifyField：写而不读 ⇒ dead；getter 里读一次就不是 dead', () => {
  const dead = C('const lastEventAt = ref(null)', '  task.value.lastEventAt = 1', '  lastEventAt.value = Date.now()', '  lastEventAt.value = Date.now()', 'return { lastEventAt }')
  assert.deepStrictEqual(classifyField(dead, 'lastEventAt', []), { writes: 2, reads: 0, crossUses: 0, dead: true })
  const alive = C('const lastEventAt = ref(null)', '  lastEventAt.value = Date.now()', '  return { fmt: () => lastEventAt.value }')
  assert.strictEqual(classifyField(alive, 'lastEventAt', []).dead, false)
})

test('赋值左值与 ++/-- 不得被数成读；复合赋值也不能（否则写动作会被洗成"已消费"）', () => {
  const onlyWrites = C('const n = ref(0)', 'n.value = 1', 'n.value += 2', 'n.value++', 'n.value--', 'n.value = n.value === 1 ? 2 : 3')
  const r = classifyField(onlyWrites, 'n', [])
  assert.strictEqual(r.reads, 1, '三元里那一次 n.value 是真读，其余三行都是写')
  assert.strictEqual(r.dead, false)
})

test('return 清单那一行不算消费（判据的牙就在这条）', () => {
  const store = C('const hidden = ref(false)', 'hidden.value = true', 'return { hidden }')
  assert.strictEqual(classifyField(store, 'hidden', []).dead, true,
    '把 export 行当消费 ⇒ 任何字段都判不死')
})

test('跨文件消费三种写法都要认：重命名解构 / 直接点名 / computed 里取值', () => {
  const store = C('const currentBoard = ref(null)', 'currentBoard.value = x')
  assert.strictEqual(classifyField(store, 'currentBoard', [C('const { currentBoard: board } = storeToRefs(store)')]).dead, false,
    '带冒号的重命名解构必须算消费 —— 加 (?\\!\\s*:) 的旧写法在这里假红过（useBacklot.js:69）')
  assert.strictEqual(classifyField(store, 'currentBoard', [C('store.currentBoard')]).dead, false)
  assert.strictEqual(classifyField(store, 'currentBoard', [C('const b = computed(() => s.currentBoard)')]).dead, false)
})

test('isTest：用例与 tests/ 目录都不算生产消费者', () => {
  assert.strictEqual(isTest('apps/desktop/src/composables/useBacklot.test.js'), true)
  assert.strictEqual(isTest('apps/desktop/tests/e2e/a.spec.ts'), true)
  assert.strictEqual(isTest('apps/desktop/src/stores/backlot.js'), false)
})

test('真实域必须落在千级文件 / 十级 store，且命中数 == 登记数（反失明 + 棘轮）', () => {
  const sink = []
  const orig = { l: console.log, e: console.error }
  console.log = (...a) => sink.push(a.join(' '))
  console.error = (...a) => sink.push('E:' + a.join(' '))
  let rc
  try { rc = main(['--json']) } finally { console.log = orig.l; console.error = orig.e }
  const joined = sink.join('\n')
  assert.strictEqual(rc, 0, '本分支已按现状登记欠账，门禁必须绿：\n' + joined)
  const m = joined.match(/域=(\d+) 文件 \/ store=(\d+) \/ ref 候选=(\d+) \/ 死字段=(\d+) \/ 登记=(\d+)/)
  assert.ok(m, '判据没打印现场读数 ⇒ 拒绝"看不见即通过"：\n' + joined)
  assert.ok(Number(m[1]) > 500 && Number(m[2]) > 10 && Number(m[3]) > 30, '规模退化：' + joined)
  assert.strictEqual(Number(m[4]), Number(m[5]), '命中数必须等于登记数：' + joined)
})

test('清空欠账清单 ⇒ rc=1 并逐个点名（防"把清单清空就当免检"）', () => {
  const debtPath = path.join(__dirname, 'field-consumed-debt.json')
  const before = fs.readFileSync(debtPath, 'utf8')
  fs.writeFileSync(debtPath, '{}', 'utf8')
  const sink = []
  const orig = { l: console.log, e: console.error }
  console.log = (...a) => sink.push(a.join(' '))
  console.error = (...a) => sink.push('E:' + a.join(' '))
  let rc
  try { rc = main([]) } finally { fs.writeFileSync(debtPath, before, 'utf8'); console.log = orig.l; console.error = orig.e }
  const joined = sink.join('\n')
  assert.strictEqual(rc, 1, '清空清单不得免检：\n' + joined)
  for (const k of Object.keys(JSON.parse(before))) {
    assert.ok(joined.includes('DEAD_FIELD ' + k), '必须点名：' + k)
  }
  assert.strictEqual(fs.readFileSync(debtPath, 'utf8'), before, '还原后必须逐字节相同')
})

test('登记缺 reason ⇒ rc=1（无原因的豁免等于没有门禁）', () => {
  const debtPath = path.join(__dirname, 'field-consumed-debt.json')
  const before = fs.readFileSync(debtPath, 'utf8')
  const obj = JSON.parse(before)
  const key = Object.keys(obj)[0]
  fs.writeFileSync(debtPath, JSON.stringify({ [key]: {} }, null, 2), 'utf8')
  const sink = []
  const orig = { l: console.log, e: console.error }
  console.log = (...a) => sink.push(a.join(' '))
  console.error = (...a) => sink.push(a.join(' '))
  let rc
  try { rc = main([]) } finally { fs.writeFileSync(debtPath, before, 'utf8'); console.log = orig.l; console.error = orig.e }
  assert.strictEqual(rc, 1)
  assert.ok(sink.join('\n').includes('DEBT_NO_REASON'))
  assert.strictEqual(fs.readFileSync(debtPath, 'utf8'), before)
})
