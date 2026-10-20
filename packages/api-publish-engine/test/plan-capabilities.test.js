'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  CAPABILITY_RULES,
  resolveLimits,
  checkPlanCapability,
  capabilityError,
} = require('../src/auth/plan-capabilities')

const FREE = { plan: 'free', limits: { max_platforms: 5, batch_size_per_run: 1, max_cloud_accounts: 0, max_devices: 2 } }
const STANDARD = { plan: 'standard', limits: { max_platforms: 10, batch_size_per_run: 10, max_cloud_accounts: 20, max_devices: 3 } }
const PRO = { plan: 'pro', limits: { max_platforms: -1, batch_size_per_run: -1, max_cloud_accounts: -1, max_devices: -1 } }

test('平台数：边界值放行、超一个即拒（不是 >= 判据）', () => {
  assert.strictEqual(checkPlanCapability(FREE, { platforms: 5 }), null)
  assert.deepStrictEqual(checkPlanCapability(FREE, { platforms: 6 }), {
    code: 'PLATFORM_LIMIT_EXCEEDED', status: 402, key: 'max_platforms', limit: 5, requested: 6, label: '平台数',
  })
  assert.strictEqual(checkPlanCapability(STANDARD, { platforms: 10 }), null)
  assert.strictEqual(checkPlanCapability(STANDARD, { platforms: 11 }).code, 'PLATFORM_LIMIT_EXCEEDED')
})

test('免费档 0 云账号是「本档不提供」，第 1 个就拒；不是「不限」', () => {
  assert.strictEqual(checkPlanCapability(FREE, { cloudAccounts: 0 }), null)
  const violation = checkPlanCapability(FREE, { cloudAccounts: 1 })
  assert.strictEqual(violation.code, 'CLOUD_ACCOUNT_LIMIT_EXCEEDED')
  assert.strictEqual(violation.limit, 0)
})

test('-1 是不限（pro 三档全开）', () => {
  for (const key of ['platforms', 'batchSize', 'cloudAccounts', 'devices']) {
    assert.strictEqual(checkPlanCapability(PRO, { [key]: 999999 }), null, key)
  }
  assert.deepStrictEqual(resolveLimits(PRO).limits, {
    max_platforms: null, batch_size_per_run: null, max_cloud_accounts: null, max_devices: null,
  })
})

test('缺失即放行：无 limits / 空对象 / 非数字 / 空串 一律不拦', () => {
  const cases = [
    null,
    undefined,
    {},
    { plan: 'free' },
    { plan: 'free', limits: null },
    { plan: 'free', limits: [] },
    { plan: 'free', limits: {} },
    { plan: 'free', limits: { max_platforms: 'n/a' } },
    { plan: 'free', limits: { max_platforms: '' } },
    { plan: 'free', limits: { max_platforms: NaN } },
    { plan: 'free', limits: { max_platforms: null } },
  ]
  for (const entitlement of cases) {
    assert.strictEqual(checkPlanCapability(entitlement, { platforms: 999 }), null, JSON.stringify(entitlement))
  }
  assert.strictEqual(resolveLimits({}).present, false)
  assert.strictEqual(resolveLimits(null).present, false)
})

test('数字字符串按数值判定（兼容 JSON 序列化 / 环境变量来源）', () => {
  assert.strictEqual(checkPlanCapability({ limits: { max_platforms: '3' } }, { platforms: 3 }), null)
  assert.strictEqual(checkPlanCapability({ limits: { max_platforms: '3' } }, { platforms: 4 }).code, 'PLATFORM_LIMIT_EXCEEDED')
})

test('只判传入的请求项：传了 platforms 就不因未传的 batchSize 而报错', () => {
  assert.strictEqual(checkPlanCapability(FREE, { platforms: 1 }), null)
  assert.strictEqual(checkPlanCapability(FREE, { batchSize: 1 }), null)
  assert.strictEqual(checkPlanCapability(FREE, { batchSize: 2 }).code, 'BATCH_SIZE_EXCEEDED')
})

test('判定顺序：先平台数、再批量、再云账号、再设备（给用户最贴近动作的那条）', () => {
  const entitlement = { limits: { max_platforms: 1, batch_size_per_run: 1, max_cloud_accounts: 1, max_devices: 1 } }
  assert.strictEqual(
    checkPlanCapability(entitlement, { platforms: 5, batchSize: 5, cloudAccounts: 5, devices: 5 }).code,
    'PLATFORM_LIMIT_EXCEEDED',
  )
  assert.strictEqual(
    checkPlanCapability(entitlement, { batchSize: 5, cloudAccounts: 5, devices: 5 }).code,
    'BATCH_SIZE_EXCEEDED',
  )
  assert.strictEqual(checkPlanCapability(entitlement, { cloudAccounts: 5, devices: 5 }).code, 'CLOUD_ACCOUNT_LIMIT_EXCEEDED')
  assert.strictEqual(checkPlanCapability(entitlement, { devices: 5 }).code, 'DEVICE_LIMIT_EXCEEDED')
})

test('每条规则都有唯一的键与违约码（配置漂移会在这里红）', () => {
  const keys = CAPABILITY_RULES.map((rule) => rule.key)
  const codes = CAPABILITY_RULES.map((rule) => rule.code)
  assert.strictEqual(new Set(keys).size, keys.length)
  assert.strictEqual(new Set(codes).size, codes.length)
  for (const rule of CAPABILITY_RULES) {
    assert.match(rule.key, /^[a-z_]+$/)
    assert.match(rule.code, /^[A-Z_]+$/)
    assert.ok(rule.status === 402 || rule.status === 403)
  }
})

test('capabilityError 把违约翻成可抛错误，状态与上限随错误走', () => {
  const violation = checkPlanCapability(FREE, { platforms: 9 })
  const error = capabilityError(violation)
  assert.strictEqual(error.code, 'PLATFORM_LIMIT_EXCEEDED')
  assert.strictEqual(error.status, 402)
  assert.strictEqual(error.limit, 5)
  assert.strictEqual(error.requested, 9)
  assert.strictEqual(capabilityError(null), null)
})
