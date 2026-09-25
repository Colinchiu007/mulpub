'use strict'
/**
 * browser-page-provider.test.js — 签名页基建 provider 槽 TDD（W3 tasks 2.1）
 *
 * 契约（design §1/§2）：
 * - createBrowserPageProvider() 返回 { setBridge, registerCommands, sign, status, resetState }
 * - 未注入 bridge → sign() 抛「签名页未就绪」（fail-closed）
 * - 仅 verified 命令可求签（未验证 → 抛错）
 * - bridge({signCommand, payload}) 返回值必须是纯字符串（非对象/非 null）
 * - 限流 ≤3 次异常/hour/platform → status.degraded=true → 后续抛「已降级」
 * - 零外发：provider 不 import http/axios/fetch，bridge 是唯一通道
 */
const assert = require('assert')
const { createBrowserPageProvider } = require('../src/signer/browser-page-provider')

let passed = 0, failed = 0
const queue = []
function t(name, fn) { queue.push({ name, fn }) }
async function run() {
  for (const { name, fn } of queue) {
    try { await fn(); passed++; console.log('  \u2705 ' + name) }
    catch (e) { failed++; console.log('  \u274C ' + name + ': ' + e.message) }
  }
  console.log(`\n  ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

// ============ 1. 未注入 bridge → fail-closed ============
t('未注入 bridge 时 sign 抛「签名页未就绪」', async () => {
  const prov = createBrowserPageProvider()
  await assert.rejects(() => prov.sign('kuaishou.ns-sig3', {}), /\u7b7e\u540d\u9875\u672a\u5c31\u7edc/)
})

// ============ 2. 注入 bridge + 命令注册 ============
t('setBridge + registerCommands 后 sign 正常', async () => {
  const prov = createBrowserPageProvider()
  const calls = []
  prov.setBridge(async (cmd, payload) => { calls.push({ cmd, payload }); return 'sig-result' })
  prov.registerCommands(['kuaishou.ns-sig3'], 'kuaishou')
  // 需要先 verify
  prov.verify('kuaishou.ns-sig3')
  const result = await prov.sign('kuaishou.ns-sig3', { body: 'test' })
  assert.strictEqual(result, 'sig-result')
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].cmd, 'kuaishou.ns-sig3')
})

// ============ 3. 仅 verified 命令可求签 ============
t('未 verify 的命令 sign 抛「未验证」', async () => {
  const prov = createBrowserPageProvider()
  prov.setBridge(async () => 'x')
  prov.registerCommands(['kuaishou.ns-sig3'], 'kuaishou')
  // 不调 verify
  await assert.rejects(() => prov.sign('kuaishou.ns-sig3', {}), /\u672a\u9a8c\u8bc1|unverified/)
})

// ============ 4. bridge 返回非字符串 → 抛错 ============
t('bridge 返回对象时 sign 抛「返回值必须纯字符串」', async () => {
  const prov = createBrowserPageProvider()
  prov.setBridge(async () => ({ sig: 'x' }))
  prov.registerCommands(['x.y'], 'test')
  prov.verify('x.y')
  await assert.rejects(() => prov.sign('x.y', {}), /\u5b57\u7b26\u4e32|string/)
})

// ============ 5. bridge 返回 null/undefined → 抛错 ============
t('bridge 返回 null 时抛错', async () => {
  const prov = createBrowserPageProvider()
  prov.setBridge(async () => null)
  prov.registerCommands(['x.y'], 'test')
  prov.verify('x.y')
  await assert.rejects(() => prov.sign('x.y', {}))
})

// ============ 6. 白名单外 command 拒绝 ============
t('未注册的 command sign 抛错', async () => {
  const prov = createBrowserPageProvider()
  prov.setBridge(async () => 'ok')
  prov.registerCommands(['known.cmd'], 'test')
  prov.verify('known.cmd')
  await assert.rejects(() => prov.sign('unknown.cmd', {}), /unknown|not registered|\u672a\u6ce8\u518c/)
})

// ============ 7. 限流降级 ============
t('连续 3 次异常后 degraded=true，后续抛「已降级」', async () => {
  const prov = createBrowserPageProvider()
  let callCount = 0
  prov.setBridge(async () => { callCount++; throw new Error('net fail') })
  prov.registerCommands(['x.y'], 'platform1')
  prov.verify('x.y')
  // 触发 3 次
  for (let i = 0; i < 3; i++) {
    try { await prov.sign('x.y', {}) } catch (e) { /* expected */ }
  }
  const st = prov.status('platform1')
  assert.strictEqual(st.degraded, true)
  // 第 4 次直接拒绝
  await assert.rejects(() => prov.sign('x.y', {}), /\u964d\u7ea7|degraded/)
})

// ============ 8. resetState 清除降级 ============
t('resetState 后 degraded 复位', async () => {
  const prov = createBrowserPageProvider()
  prov.setBridge(async () => { throw new Error('x') })
  prov.registerCommands(['x.y'], 'p1')
  prov.verify('x.y')
  for (let i = 0; i < 3; i++) { try { await prov.sign('x.y', {}) } catch(e){} }
  assert.strictEqual(prov.status('p1').degraded, true)
  prov.resetState('p1')
  assert.strictEqual(prov.status('p1').degraded, false)
})

// ============ 9. 零外发合规（无 http/axios import） ============
t('browser-page-provider 源码不含 http/axios/fetch import', () => {
  const fs = require('fs')
  const src = fs.readFileSync(require.resolve('../src/signer/browser-page-provider'), 'utf8')
  // 允许注释中出现，但 require/import 语句不允许
  const lines = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  const code = lines.join('\n')
  assert.ok(!/\brequire\s*\(\s*['"]http['"]\s*\)/.test(code), 'must not require http')
  assert.ok(!/\brequire\s*\(\s*['"]axios['"]\s*\)/.test(code), 'must not require axios')
  assert.ok(!/\bfetch\s*\(/.test(code), 'must not call fetch')
})

// ============ 10. payload 尺寸上限 ============
t('payload 超过 1MB 拒绝', async () => {
  const prov = createBrowserPageProvider()
  prov.setBridge(async () => 'ok')
  prov.registerCommands(['x.y'], 'p')
  prov.verify('x.y')
  const big = 'a'.repeat(1024 * 1024 + 1)
  await assert.rejects(() => prov.sign('x.y', { data: big }), /\u5c3a\u5bf8|size|limit|\u8d85\u8fc7/)
})

run()
