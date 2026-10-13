'use strict'

/**
 * 运营侧兑换码能力：列表（默认掩码）+ 吊销（幂等语义）。
 *
 * 覆盖的核心不变量：
 *   1. 掩码是默认态，且只有严格 true 的 reveal 才放行完整码（"true"/1/"1" 都不放行）
 *   2. 吊销对已 disabled 幂等（200），对已 used 必须 409——两者语义不同不可混同
 *   3. 404 与 409 区分清楚，调用方才知道「没这码」还是「撤销不了」
 */

const assert = require('assert')
const test = require('node:test')

const {
  SubscriptionService,
  maskRedeemCode,
  REDEEM_CODE_PATTERN,
} = require('../src/auth/subscription-service')

const CODE_A = 'ABCD-EFGH-JKMN'
const CODE_B = 'WXYZ-2345-6789'

function createRepositoryFixture(initial = []) {
  const codes = new Map(initial.map((c) => [c.code, {
    plan: 'standard', duration_days: 30, batch: 'b1', status: 'active',
    used_by: null, used_at: null, expires_at: null, created_at: '2026-01-01T00:00:00.000Z',
    ...c,
  }]))
  return {
    codes,
    // 记录每次查询用到的筛选条件，验证 store 的 WHERE 拼装确实生效
    listCalls: [],
    async listRedeemCodes({ plan, status, batch, limit, offset }) {
      this.listCalls.push({ plan, status, batch, limit, offset })
      let rows = [...codes.values()]
      if (plan) rows = rows.filter((r) => r.plan === plan)
      if (status) rows = rows.filter((r) => r.status === status)
      if (batch) rows = rows.filter((r) => r.batch === batch)
      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.code < b.code ? -1 : 1))
      return rows.slice(offset, offset + limit)
    },
    async countRedeemCodes({ plan, status, batch }) {
      let rows = [...codes.values()]
      if (plan) rows = rows.filter((r) => r.plan === plan)
      if (status) rows = rows.filter((r) => r.status === status)
      if (batch) rows = rows.filter((r) => r.batch === batch)
      return rows.length
    },
    async getRedeemCode(code) { return codes.get(code) || null },
    async disableRedeemCode(code) {
      const row = codes.get(code)
      if (!row || row.status !== 'active') return null
      row.status = 'disabled'
      return row
    },
  }
}

function createService(initial = []) {
  const repository = createRepositoryFixture(initial)
  const service = new SubscriptionService({ repository, now: () => Date.parse('2026-01-01T00:00:00Z') })
  return { service, repository }
}

test('maskRedeemCode 只保留首段', () => {
  assert.strictEqual(maskRedeemCode(CODE_A), 'ABCD-****-****')
  // 非法格式不得回显原文（否则等于没掩码）
  assert.strictEqual(maskRedeemCode('ABCD-EFGH'), '****-****-****')
  assert.strictEqual(maskRedeemCode(null), '****-****-****')
  assert.strictEqual(maskRedeemCode(''), '****-****-****')
  // 掩码值本身不得再匹配真码格式，防止下游把它当码用
  assert.ok(!REDEEM_CODE_PATTERN.test(maskRedeemCode(CODE_A)))
})

test('listRedeemCodes 默认掩码：列表不得泄露未兑换码', async () => {
  const { service } = createService([{ code: CODE_A }, { code: CODE_B }])
  const out = await service.listRedeemCodes({})
  assert.strictEqual(out.revealed, false)
  assert.deepStrictEqual(out.codes.map((c) => c.code).sort(), ['ABCD-****-****', 'WXYZ-****-****'])
  assert.ok(out.codes.every((c) => c.masked === true))
  assert.strictEqual(out.total, 2)
})

test('listRedeemCodes reveal 严格等于 true 才放行完整码', async () => {
  for (const truthy of [1, '1', 'yes', {}]) {
    const { service } = createService([{ code: CODE_A }])
    const out = await service.listRedeemCodes({ reveal: truthy })
    assert.strictEqual(out.revealed, false, `reveal=${JSON.stringify(truthy)} 不得被当作放行`)
    assert.strictEqual(out.codes[0].code, 'ABCD-****-****')
  }
  const { service } = createService([{ code: CODE_A }])
  const out = await service.listRedeemCodes({ reveal: true })
  assert.strictEqual(out.revealed, true)
  assert.strictEqual(out.codes[0].code, CODE_A)
  assert.strictEqual(out.codes[0].masked, false)
})

test('listRedeemCodes 透传筛选与分页，并回报 total', async () => {
  const { service, repository } = createService([
    { code: CODE_A, plan: 'standard', status: 'active' },
    { code: CODE_B, plan: 'pro', status: 'used' },
  ])
  const out = await service.listRedeemCodes({ plan: 'pro', status: 'used', limit: 10, offset: 0 })
  assert.deepStrictEqual(repository.listCalls[0], { plan: 'pro', status: 'used', batch: null, limit: 10, offset: 0 })
  assert.strictEqual(out.total, 1)
  assert.strictEqual(out.codes.length, 1)
})

test('listRedeemCodes 拒绝越界分页与非法 status', async () => {
  const { service } = createService([{ code: CODE_A }])
  const cases = [
    [{ limit: 0 }, 'LIST_LIMIT_INVALID'],
    [{ limit: 201 }, 'LIST_LIMIT_INVALID'],
    [{ limit: 1.5 }, 'LIST_LIMIT_INVALID'],
    [{ offset: -1 }, 'LIST_OFFSET_INVALID'],
    [{ status: 'revoked' }, 'STATUS_INVALID'],
  ]
  for (const [args, code] of cases) {
    let thrown = null
    try { await service.listRedeemCodes(args) } catch (e) { thrown = e }
    assert.ok(thrown, `参数 ${JSON.stringify(args)} 必须被拒`)
    assert.strictEqual(thrown.code, code)
    assert.strictEqual(thrown.status, 400)
  }
})

test('disableRedeemCode：active → disabled 首次生效 idempotent=false', async () => {
  const { service } = createService([{ code: CODE_A, status: 'active' }])
  const out = await service.disableRedeemCode({ code: CODE_A })
  assert.deepStrictEqual(out, { code: CODE_A, status: 'disabled', idempotent: false })
})

test('disableRedeemCode：重复吊销返回 200 且 idempotent=true（不是 409）', async () => {
  const { service } = createService([{ code: CODE_A, status: 'active' }])
  await service.disableRedeemCode({ code: CODE_A })
  const again = await service.disableRedeemCode({ code: CODE_A })
  assert.strictEqual(again.status, 'disabled')
  assert.strictEqual(again.idempotent, true)
})

test('disableRedeemCode：已 used 必须 409，且与幂等重放区分开', async () => {
  const { service } = createService([{ code: CODE_A, status: 'used', used_by: 'u-1' }])
  let thrown = null
  try { await service.disableRedeemCode({ code: CODE_A }) } catch (e) { thrown = e }
  assert.ok(thrown, '已使用的码必须拒绝吊销——权益已发放，回滚会留下已享受服务的账')
  assert.strictEqual(thrown.code, 'REDEEM_CODE_ALREADY_USED')
  assert.strictEqual(thrown.status, 409)
})

test('disableRedeemCode：不存在 → 404', async () => {
  const { service } = createService([{ code: CODE_A }])
  let thrown = null
  try { await service.disableRedeemCode({ code: CODE_B }) } catch (e) { thrown = e }
  assert.strictEqual(thrown.code, 'REDEEM_CODE_NOT_FOUND')
  assert.strictEqual(thrown.status, 404)
})

test('disableRedeemCode：格式非法 → 400，且不得触发任何写库', async () => {
  const { service, repository } = createService([{ code: CODE_A }])
  for (const bad of ['', 'ABCD-EFGH', 'ABCD-EFGH-JKMN-EXTRA', 'IIII-EFGH-JKMN', null, 123]) {
    let thrown = null
    try { await service.disableRedeemCode({ code: bad }) } catch (e) { thrown = e }
    assert.ok(thrown, `非法码 ${JSON.stringify(bad)} 必须被拒`)
    assert.strictEqual(thrown.code, 'REDEEM_CODE_FORMAT')
    assert.strictEqual(thrown.status, 400)
  }
  assert.strictEqual(repository.codes.get(CODE_A).status, 'active', '被拒的请求不得改动任何码的状态')
})

test('列表字段是投影白名单：不得把 used_by 等内部列原样外泄为 snake_case', async () => {
  const { service } = createService([{ code: CODE_A, status: 'used', used_by: 'u-1', used_at: '2026-02-02T00:00:00.000Z' }])
  const out = await service.listRedeemCodes({ reveal: true })
  const row = out.codes[0]
  assert.strictEqual(row.usedBy, 'u-1')
  assert.strictEqual(row.usedAt, '2026-02-02T00:00:00.000Z')
  assert.strictEqual(row.durationDays, 30)
  // 仓储层的 snake_case 键不得出现在响应体里
  for (const leaked of ['used_by', 'used_at', 'duration_days', 'created_at', 'expires_at']) {
    assert.ok(!(leaked in row), `响应体泄漏了内部列 ${leaked}`)
  }
})
