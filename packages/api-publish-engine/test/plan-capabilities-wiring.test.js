'use strict'

/**
 * 接线锁（不是行为测试）：判据本体在 `plan-capabilities.test.js` 里已单测，
 * 守卫执行体在 `plan-capability-guard.js`，这里只锁「三条入口确实接了它」——
 * 上一批的教训是**判据写好了但没人调用**，那种形态在单测里永远绿，只有接线锁能守住。
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const SERVER = path.join(__dirname, '..', 'src', 'publish-api-server.js')
const GUARD = path.join(__dirname, '..', 'src', 'auth', 'plan-capability-guard.js')

const readServer = () => fs.readFileSync(SERVER, 'utf8')
const readGuard = () => fs.readFileSync(GUARD, 'utf8')

test('服务端 require 了守卫模块（删掉 require 会先在这里红）', () => {
  const source = readServer()
  assert.match(source, /require\(["']\.\/auth\/plan-capability-guard["']\)/, 'publish-api-server.js 必须 require 守卫模块')
  assert.match(source, /assertPlanCapabilitiesForRequest/, '必须使用请求形态的守卫')
  assert.match(source, /assertPlanCapabilitiesForContext/, '必须使用上下文形态的守卫（定时通道）')
})

test('即时发布入口接了平台数判据', () => {
  const source = readServer()
  const index = source.indexOf('await this._authorizeImmediateEntry(req, 1);')
  assert.ok(index > 0, '单平台发布的授权调用点必须存在（改名会在这里红）')
  const window = source.slice(index, index + 600)
  assert.match(
    window,
    /assertPlanCapabilitiesForRequest\(this\._entitlementProvider, req, \{ platforms: \[platform\] \}\)/,
    '单平台发布必须传 platforms: [platform]',
  )
})

test('批量发布入口同时判平台数与批量条数', () => {
  const source = readServer()
  const index = source.indexOf('await this._authorizeImmediateEntry(req, platforms.length);')
  assert.ok(index > 0, '批量发布的授权调用点必须存在')
  const window = source.slice(index, index + 800)
  assert.match(window, /assertPlanCapabilitiesForRequest\(this\._entitlementProvider, req, \{ platforms, batchSize: platforms\.length \}\)/)
})

test('定时入口与即时入口对称：_authorizeScheduledEntry 也接了判据且排在扣额度之前', () => {
  const source = readServer()
  const start = source.indexOf('async _authorizeScheduledEntry(entry) {')
  assert.ok(start > 0, '_authorizeScheduledEntry 必须存在')
  const end = source.indexOf('async _authorizeImmediateEntry(', start)
  const body = source.slice(start, end)
  const guardIndex = body.indexOf('assertPlanCapabilitiesForContext(')
  const consumeIndex = body.indexOf('_consumeEntitlementFeature(')
  assert.ok(guardIndex > 0, '定时入口必须接数量判据（否则定时通道可绕过）')
  assert.ok(consumeIndex > 0, '定时入口必须仍然扣额度')
  assert.ok(guardIndex < consumeIndex, '先判上限再扣额度：被上限拒绝的请求不得消耗用户额度')
})

test('守卫的两条放行边界写死在模块里（provider 缺失 / 无 businessUser）', () => {
  const guard = readGuard()
  assert.match(guard, /if \(!provider \|\| typeof provider\.getForUser !== 'function'\) return true/)
  assert.match(guard, /if \(!context \|\| !context\.businessUser\) return true/)
  assert.match(guard, /capabilityError\(violation\)/, '越界必须抛 typed error（402/403 由它带出）')
})

test('设备会话登记（PRD N1）：上限来自权益、超限只返回提示不抛错', async () => {
  const { registerDeviceSession } = require('../src/auth/plan-capability-guard')
  const context = { auth: {}, businessUser: { id: 'u-1' } }

  // 免费档 2 台：limit 被透传给存储层（存储层只判「新设备 vs 已知设备」）
  const calls = []
  const repository = { async upsertSession(input) { calls.push(input); return { id: 'ses-1' } } }
  const provider = { async getForUser() { return { limits: { max_devices: 2 } } } }
  const notice = await registerDeviceSession({ provider, repository, context, deviceId: 'device-1' })
  assert.strictEqual(notice, null)
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].maxDevices, 2, '上限必须由权益算出并透传')
  assert.strictEqual(calls[0].userId, 'u-1')

  // 存储层拒绝 ⇒ 转成提示对象（不是异常：/me 不该因设备超限整体失败）
  const rejecting = { async upsertSession() { throw Object.assign(new Error('DEVICE_LIMIT_EXCEEDED'), { code: 'DEVICE_LIMIT_EXCEEDED', limit: 2 }) } }
  const rejected = await registerDeviceSession({ provider, repository: rejecting, context, deviceId: 'device-2' })
  assert.deepStrictEqual(rejected, { reached: true, limit: 2 })

  // 其它错误 ⇒ 走 onWarn，仍不抛（best-effort 语义不变）
  const warned = []
  const broken = { async upsertSession() { throw Object.assign(new Error('boom'), { code: 'DB_DOWN' }) } }
  const result = await registerDeviceSession({ provider, repository: broken, context, deviceId: 'device-3', onWarn: (e) => warned.push(e.code) })
  assert.strictEqual(result, null)
  assert.deepStrictEqual(warned, ['DB_DOWN'])

  // provider 缺失 / 无 businessUser ⇒ maxDevices 为 null（不限）
  const noProvider = []
  await registerDeviceSession({
    provider: null, repository: { async upsertSession(i) { noProvider.push(i) } }, context, deviceId: 'device-4',
  })
  assert.strictEqual(noProvider[0].maxDevices, null)
})
