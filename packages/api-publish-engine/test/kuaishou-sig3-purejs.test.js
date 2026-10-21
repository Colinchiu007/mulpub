'use strict'

/**
 * kuaishou-sig3 纯 JS 实现的回归测试
 *
 * 期望值来源（全部为已固化的证据，不是本次现算后填进去的）：
 *   - 硬基线：04-rea-evidence/sig3-纯JS完整实现对拍.json（与竞品 VM 10/10 逐字节一致）
 *   - 输入构造：04-rea-evidence/sig3-purejs-live-result.json（真实服务端 result:1 的请求）
 *
 * 本文件不联网、不依赖第三方包。
 */

const assert = require('assert')
const crypto = require('crypto')
const k = require('../src/signer/kuaishou-sig3')

let passed = 0
let failed = 0
function test (name, fn) {
  try {
    fn()
    passed++
    console.log('  \u2705 ' + name)
  } catch (e) {
    failed++
    console.log('  \u274C ' + name + ': ' + e.message)
  }
}

// ── 1. 硬基线：与竞品 VM 逐字节一致的固化期望值
// startupRandom=1750000000，count=100..103，payload="abc"
test('硬基线 count=100', () => {
  assert.strictEqual(
    k.signPayload('abc', 1750000000, 100),
    'bbabecdc6b0ba78083e6e5e4d5636a523eda729efafaf8f8f7f6f5ef')
})
test('硬基线 count=101', () => {
  assert.strictEqual(
    k.signPayload('abc', 1750000000, 101),
    'baaaeddd6a0aa68183e7e4e5d4626b533fdb739ffbfbf9f9f6f7f4ee')
})
test('硬基线 count=102', () => {
  assert.strictEqual(
    k.signPayload('abc', 1750000000, 102),
    'b9a9eede6909a58283e4e7e6d76168503cd8709cf8f8fafaf5f4f7ed')
})
test('硬基线 count=103', () => {
  assert.strictEqual(
    k.signPayload('abc', 1750000000, 103),
    'b8a8efdf6808a48383e5e6e7d66069513dd9719df9f9fbfbf4f5f6ec')
})

// ── 2. 输入构造：真实服务端验证过的样例
test('输入构造 url 无 query + params={} ⇒ md5("" + "{}")', () => {
  // 该值对应的请求在真实环境返回 result:1
  assert.strictEqual(k.buildSignatureInput({ url: '/rest/v2/creator/pc/authority/account/current', params: {} }),
    '99914b932bd37a50b983c5e7c90ae93b')
})
test('输入构造 无 url 无 params 等价空 query + 空对象', () => {
  assert.strictEqual(k.buildSignatureInput({}), '99914b932bd37a50b983c5e7c90ae93b')
})
test('输入构造 query 按 key 排序', () => {
  const expected = crypto.createHash('md5').update('a=1&b=2' + '{}', 'utf8').digest('hex')
  assert.strictEqual(k.buildSignatureInput({ url: '/x?b=2&a=1', params: {} }), expected)
})
test('输入构造 body 参与 md5', () => {
  const body = { caption: 'hi', part: 1 }
  const expected = crypto.createHash('md5').update('' + JSON.stringify(body), 'utf8').digest('hex')
  assert.strictEqual(k.buildSignatureInput({ url: '/x', params: body }), expected)
})
test('输入构造 忽略 url fragment', () => {
  const a = k.buildSignatureInput({ url: '/x?k=v#frag', params: {} })
  const b = k.buildSignatureInput({ url: '/x?k=v', params: {} })
  assert.strictEqual(a, b)
})

// ── 3. 输出形态
test('输出长度恒为 56 hex', () => {
  k.__resetState({ startupRandom: 1750000000, count: 100 })
  for (const p of ['', 'a', 'abc', '中文', 'x'.repeat(200)]) {
    const s = k.sign({ url: '/rest/x', params: { p } })
    assert.strictEqual(s.length, k.SIG_LENGTH, 'bad length for payload ' + JSON.stringify(p))
    assert.ok(/^[0-9a-f]{56}$/.test(s), 'not lowercase hex: ' + s)
  }
})
test('SIG_LENGTH 常量与 MIN_SIG_LEN 门槛相容（56 ≥ 40）', () => {
  assert.strictEqual(k.SIG_LENGTH, 56)
  assert.ok(k.SIG_LENGTH >= 40)
})

// ── 4. 状态管理
test('count 初值 100 且每次签名自增', () => {
  k.__resetState({ startupRandom: 1750000000 })
  const s1 = k.sign({ url: '/r', params: {} })
  const s2 = k.sign({ url: '/r', params: {} })
  const s3 = k.sign({ url: '/r', params: {} })
  assert.notStrictEqual(s1, s2)
  assert.notStrictEqual(s2, s3)
  assert.deepStrictEqual(k.__getState().count, 103)
})
test('同一输入 + 固定 count ⇒ 幂等（可复现）', () => {
  k.__resetState({ startupRandom: 1750000000, count: 100 })
  const a = k.sign({ url: '/r', params: {} })
  k.__resetState({ startupRandom: 1750000000, count: 100 })
  const b = k.sign({ url: '/r', params: {} })
  assert.strictEqual(a, b)
})
test('startupRandom 首次签名时冻结', () => {
  k.__resetState({ startupRandom: null })
  k.sign({ url: '/r', params: {} })
  const first = k.__getState().startupRandom
  assert.strictEqual(typeof first, 'number')
  k.sign({ url: '/r', params: {} })
  assert.strictEqual(k.__getState().startupRandom, first)
})
test('显式 startupRandom / count 覆盖状态', () => {
  k.__resetState({ startupRandom: 1750000000, count: 500 })
  const explicit = k.sign({ url: '/r', params: {}, startupRandom: 1700000000, count: 7 })
  // 覆盖后不应消耗内部 count
  assert.strictEqual(k.__getState().count, 500)
  // 且与直接调用 signPayload 一致
  const input = k.buildSignatureInput({ url: '/r', params: {} })
  assert.strictEqual(explicit, k.signPayload(input, 1700000000, 7))
})

// ── 5. 边界与容错
test('params 为 null / undefined 按空对象处理', () => {
  assert.strictEqual(k.buildSignatureInput({ url: '/r', params: null }),
    k.buildSignatureInput({ url: '/r', params: {} }))
  assert.strictEqual(k.buildSignatureInput({ url: '/r', params: undefined }),
    k.buildSignatureInput({ url: '/r', params: {} }))
})
test('sign(undefined) 不抛错（按空 payload 处理）', () => {
  k.__resetState({ startupRandom: 1750000000, count: 100 })
  const s = k.sign()
  assert.strictEqual(s.length, 56)
})
test('payload 非字符串按空串处理', () => {
  assert.strictEqual(k.signPayload(null, 1, 1), k.signPayload('', 1, 1))
  assert.strictEqual(k.signPayload(123, 1, 1), k.signPayload('', 1, 1))
})

// ── 6. 原语自检
test('原语：checksum 已知值', () => {
  assert.strictEqual(k.checksum(''), '00')
  assert.strictEqual(k.checksum('01'), '01')
  assert.strictEqual(k.checksum('ff'), 'ff')
  assert.strictEqual(k.checksum('abfc'), '59')
})
test('原语：permute 自逆', () => {
  const probe = '5445013080e14e686400000036818bb2c1248f6201000100000000ef'
  assert.strictEqual(k.permute(k.permute(probe)), probe)
})
test('原语：j 的大小端', () => {
  assert.strictEqual(k.j(255, true), '000000ff')
  assert.strictEqual(k.j(255, false), 'ff000000')
})
test('原语：utf8 多字节', () => {
  assert.strictEqual(k.utf8('中文'), '\xe4\xb8\xad\xe6\x96\x87')
})

// ── 7. 合规红线：模块不得引入网络能力
test('合规：kuaishou-sig3.js 不含网络模块引用', () => {
  const fs = require('fs')
  const path = require('path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'signer', 'kuaishou-sig3.js'), 'utf8')
  for (const bad of ['axios', 'node:http', "require('http')", 'require("http")', 'https.request', 'fetch(']) {
    assert.strictEqual(src.includes(bad), false, 'forbidden token in module: ' + bad)
  }
})

// ── 8. 算法完整性自检（CCG 深度评审 i3 的回归保护）
test('verifyKnownVector 全绿（固化的对拍基线）', () => {
  const r = k.verifyKnownVector()
  assert.strictEqual(r.ok, true, 'self-test failed: ' + JSON.stringify(r.cases.filter((c) => !c.ok)))
  assert.ok(r.cases.length >= 2)
})
test('verifyKnownVector 能捕获算法被改坏（变异反证）', () => {
  // 直接改 signPayload 的行为不现实；改为验证「基线确实与当前实现不同」这一可观测事实：
  // 若有人把 MAGIC 改掉，硬基线条目必然失配。此处用错参数模拟"实现漂移"。
  const good = k.signPayload('abc', 1750000000, 100)
  const drifted = k.signPayload('abc', 1750000000, 101) // 换 count ⇒ 不同签名
  assert.notStrictEqual(good, drifted)
  // 且 verifyKnownVector 里两条基线的 expected 互不相同（说明断言不是恒真式）
  const r = k.verifyKnownVector()
  const expectedSet = new Set(r.cases.map((c) => c.expected).filter(Boolean))
  assert.ok(expectedSet.size >= 2, 'baselines must not be identical (否则断言是恒真式)')
})

// ── 9. 独立状态实例（CCG 深度评审 i7 的回归保护）
test('createSigner 提供独立状态，互不污染', () => {
  const a = k.createSigner({ startupRandom: 1750000000, count: 100 })
  const b = k.createSigner({ startupRandom: 1750000000, count: 100 })
  const sa1 = a.sign({ url: '/x', params: {} })
  const sb1 = b.sign({ url: '/x', params: {} })
  // 两个实例从同一初始状态出发 ⇒ 第一次签名必须相同
  assert.strictEqual(sa1, sb1)
  // 但各自继续走各自的计数
  const sa2 = a.sign({ url: '/x', params: {} })
  const sb2 = b.sign({ url: '/x', params: {} })
  assert.strictEqual(sa2, sb2)
  assert.notStrictEqual(sa1, sa2)
  assert.strictEqual(a.getState().count, 102)
  assert.strictEqual(b.getState().count, 102)
})
test('createSigner 与模块级 sign 状态互不干扰', () => {
  k.__resetState({ startupRandom: 1750000000, count: 100 })
  const before = k.__getState().count
  const iso = k.createSigner({ startupRandom: 1750000000, count: 100 })
  iso.sign({ url: '/x', params: {} })
  iso.sign({ url: '/x', params: {} })
  // 模块级状态不应因实例签名而改变
  assert.strictEqual(k.__getState().count, before)
})
test('createSigner.reset 可回到确定状态', () => {
  const s = k.createSigner({ startupRandom: 1750000000, count: 100 })
  const first = s.sign({ url: '/x', params: {} })
  s.sign({ url: '/x', params: {} })
  s.reset({ startupRandom: 1750000000, count: 100 })
  assert.strictEqual(s.sign({ url: '/x', params: {} }), first)
})
test('并发语义已在文档中声明（模块级 sign 非并发安全）', () => {
  const fs = require('fs')
  const path = require('path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'signer', 'kuaishou-sig3.js'), 'utf8')
  assert.ok(/并发语义/.test(src), 'module must document concurrency semantics')
  assert.ok(/createSigner/.test(src), 'module must expose createSigner for isolation')
})

console.log('\n========== kuaishou-sig3 Result ==========')
console.log('  Passed: ' + passed + ' / ' + (passed + failed))
console.log('  Failed: ' + failed + ' / ' + (passed + failed))
if (failed > 0) process.exit(1)
