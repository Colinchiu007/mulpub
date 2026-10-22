'use strict'
/**
 * ccg-delivery-digest.test.js —— `delivery@` 摘要的规范化口径（qm6-closure-writeback tasks 4.1 / 4.1b）
 *
 * 为什么要有行为向量：只写「实现只有一份」防得住分叉，防不住腐蚀——
 * 一份所有人都调用的实现，如果被改成"不排序"或"多缩进两格"，写回器和判据会**一致地**算出同一个错值。
 * 所以这里把规范化规则本身钉成写死的期望值（4.1b），两条性质各测各的。
 *
 * 跑法：node --test scripts/ccg-delivery-digest.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const MOD = path.join(__dirname, 'lib', 'ccg-delivery-digest.js')

/** 写死样本：两个 finding，字段顺序按"真实产物里会出现的顺序"，不是字母序。 */
const SAMPLE = [
  { id: 'i1', severity: 'Critical', dimension: 'correctness', finding: '断言取的是字符串存在性而非执行', suggestion: '改成真跑' },
  { id: 'i2', severity: 'Warning', dimension: 'maintainability', finding: '失败出口之前有一步永远不会被读到', suggestion: '移到失败出口之后' }
]
// 由一份仓外参考实现独立算出（对象递归按键名码点升序 + 数组保序 + JSON.stringify(v, null, 0) + sha256）。
const VECTOR = '53e1642c75f563418894009d11b3c27255e9f7bb73715233de9abc0f66dfabd3'

function mod () {
  return require(MOD)
}

test('单一实现必须存在：写回器与判据共用一份（4.1）', () => {
  assert.ok(fs.existsSync(MOD),
    '没有 scripts/lib/ccg-delivery-digest.js ⇒ 写回器与判据会各算一份哈希，两者互不可验（跨家族评审 i2 原话）')
})

test('行为向量：写死样本的摘要必须逐字符等于写死值（4.1b）', () => {
  assert.strictEqual(mod().deliveryDigest(SAMPLE), VECTOR)
})

test('两条性质各自成立：键序无关、数组序有关（向量不是碰巧对上）', () => {
  const { deliveryDigest } = mod()
  const permuted = SAMPLE.map((o) => {
    const r = {}
    for (const k of Object.keys(o).reverse()) r[k] = o[k]
    return r
  })
  assert.strictEqual(deliveryDigest(permuted), deliveryDigest(SAMPLE), '同一对象换键序 ⇒ 摘要必须不变（否则不同实现算出不同值）')
  assert.notStrictEqual(deliveryDigest(SAMPLE.slice().reverse()), deliveryDigest(SAMPLE),
    '数组换序必须改变摘要 ⇒ findings 顺序是语义的一部分，不得按键排序时把数组也排了')
})

test('输出形状：64 位小写十六进制（不是 base64、不是大写）', () => {
  assert.match(mod().deliveryDigest(SAMPLE), /^[0-9a-f]{64}$/)
})

test('输入域：只接受 findings 数组，其它一律抛错（不得把 undefined 静默哈希成一个稳定值）', () => {
  const { deliveryDigest } = mod()
  assert.throws(() => deliveryDigest(undefined), /findings 必须是数组/)
  assert.throws(() => deliveryDigest({}), /findings 必须是数组/)
  assert.throws(() => deliveryDigest('x'), /findings 必须是数组/)
  assert.match(deliveryDigest([]), /^[0-9a-f]{64}$/, '空数组是合法交付（零条意见的评审仍应有确定摘要）')
})

test('语义指纹：deepReview 去掉 at 后同内容同指纹，换 status 必变（D2 条件④的判据来源）', () => {
  const { deepReviewFingerprint } = mod()
  const base = { required: true, status: 'cleared', performedBy: 'claude', findings: SAMPLE, minScore: 4, at: '2026-10-20T00:00:00.000Z' }
  const onlyClock = Object.assign({}, base, { at: '2026-10-21T09:00:00.000Z' })
  assert.strictEqual(deepReviewFingerprint(onlyClock), deepReviewFingerprint(base),
    '引擎每个写回站点都会重写 at ⇒ 含 at 的指纹会把"只刷时间戳"当成新交付')
  assert.notStrictEqual(deepReviewFingerprint(Object.assign({}, base, { status: 'needs_revision' })), deepReviewFingerprint(base),
    'status 变了必须算新交付，否则 ④-b 会把真交付吃掉')
  assert.notStrictEqual(deepReviewFingerprint(Object.assign({}, base, { findings: [SAMPLE[0]] })), deepReviewFingerprint(base))
  assert.match(deepReviewFingerprint(base), /^[0-9a-f]{64}$/)
  assert.throws(() => deepReviewFingerprint(null), /deepReview 必须是对象/)
})

test('禁词：规范化实现只准有一份，写回器与判据都必须 require 它（接线锁）', () => {
  const consumers = ['ccg-review-writeback.js', 'check-pr-exec-record.js']
  for (const f of consumers) {
    const p = path.join(__dirname, f)
    if (!fs.existsSync(p)) continue
    const src = fs.readFileSync(p, 'utf8')
    assert.ok(/ccg-delivery-digest/.test(src), `${f} 必须引用共享摘要实现，而不是自带一份 createHash 规范化`)
  }
})

test('sha256Hex：Buffer 走原始字节、字符串走 utf8，且两者对非 ASCII 确实不同形（陷阱存在性自证）', () => {
  const crypto = require('node:crypto')
  const { sha256Hex } = mod()
  const buf = Buffer.from('全仓没有任何生产方写 tier', 'utf8')
  assert.strictEqual(sha256Hex(buf), crypto.createHash('sha256').update(buf).digest('hex'),
    '入口侧用 sha256sum 量的是原始字节，这一侧必须同形')
  // 负控：把 Buffer 先 toString('binary') 再交给字符串分支，会得到**另一个**哈希。
  // 这条不是"顺手一测"——它就是 ④-a2 那格判据的成因；哪天有人"统一成一种入参"，
  // 这条会先红，而 no-write 那格会在 CI 上静默失效。
  const viaBinary = sha256Hex(buf.toString('binary'))
  assert.notStrictEqual(viaBinary, sha256Hex(buf),
    '非 ASCII 字节经 binary→utf8 重编码会翻倍；若这条相等，说明上面的负控没构造到多字节内容')
  assert.strictEqual(sha256Hex('abc'), crypto.createHash('sha256').update('abc', 'utf8').digest('hex'))
})

test('扩展平面：排序按码点而不是 UTF-16 码元（外部深审 i4 的取证用例）', () => {
  const { canonicalize, deliveryDigest } = mod()
  // U+FFFF 与 U+1F600（😀）：按**码元**比会把代理对的首元 0xD83D 当成更小 ⇒ 顺序反过来；
  // 按**码点**比 0x1F600 > 0xFFFF。两条断言一起才算证明：只测"稳定"测不出方向错。
  const astral = '\u{1F600}'
  const bmpTop = '\uFFFF'
  // canonicalize 返回的是**对象**，键序要看序列化后的串才知道（第一版直接 strictEqual 两个对象，
  // 拿到的是引用不等而非顺序不等——那是一条会误报实现有 bug 的判据，先把它改成串比较）。
  const s1 = JSON.stringify(canonicalize({ [astral]: 'a', [bmpTop]: 'b' }), null, 0)
  const s2 = JSON.stringify(canonicalize({ [bmpTop]: 'b', [astral]: 'a' }), null, 0)
  assert.strictEqual(s1, s2, '键序无关必须对扩展平面同样成立')
  assert.ok(s1.indexOf('"' + bmpTop + '"') < s1.indexOf('"' + astral + '"'),
    'U+FFFF 必须排在 U+1F600 之前（码点序）；实得顺序说明比较退化成了 UTF-16 码元序：' + JSON.stringify(s1))
  // 值里带扩展平面时摘要必须稳定（中文/emoji finding 是现场常态）
  assert.strictEqual(deliveryDigest([{ finding: 'a\u{1F600}' }]), deliveryDigest([{ finding: 'a\u{1F600}' }]))
  assert.notStrictEqual(deliveryDigest([{ finding: 'a\u{1F600}' }]), deliveryDigest([{ finding: 'a' }]))
})
