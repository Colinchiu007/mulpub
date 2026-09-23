'use strict'

const assert = require('assert')
const test = require('node:test')

const { PLAN_IDS, getPlanEntitlement, getPlanCatalog, PLAN_MATRIX_VERSION } = require('../src/auth/plan-matrix')

test('plan-matrix 契约（spec §2）', async (t) => {
  await t.test('档位枚举与版本', () => {
    assert.deepStrictEqual([...PLAN_IDS], ['free', 'standard', 'pro'])
    assert.strictEqual(typeof PLAN_MATRIX_VERSION, 'string')
    assert.throws(() => { PLAN_IDS.push('enterprise') }, /object|frozen|not extensible/i)
  })

  await t.test('价格与 spec 矩阵逐字一致（单位：分）', () => {
    const catalog = getPlanCatalog()
    assert.strictEqual(catalog.length, 3)
    const [free, standard, pro] = catalog
    assert.strictEqual(free.priceMonthlyCents, 0)
    assert.strictEqual(standard.priceMonthlyCents, 2900)
    assert.strictEqual(standard.priceYearlyCents, 19900)
    assert.strictEqual(pro.priceMonthlyCents, 7900)
    assert.strictEqual(pro.priceYearlyCents, 59900)
    for (const item of catalog) assert.strictEqual(item.currency, 'CNY')
  })

  await t.test('无限值约定 -1：pro 平台数 / standard AI 写稿（自有 Key）', () => {
    assert.strictEqual(getPlanEntitlement('pro').limits.max_platforms, -1)
    assert.strictEqual(getPlanEntitlement('standard').quota.ai_write_monthly, -1)
    assert.strictEqual(getPlanEntitlement('free').limits.max_platforms, 5)
    assert.strictEqual(getPlanEntitlement('standard').limits.max_platforms, 15)
  })

  await t.test('日发布数折算 cloud_publish_monthly = daily_publish × 30（双口径）', () => {
    assert.strictEqual(getPlanEntitlement('free').quota.cloud_publish_monthly, 5 * 30)
    assert.strictEqual(getPlanEntitlement('standard').quota.cloud_publish_monthly, 50 * 30)
    assert.strictEqual(getPlanEntitlement('pro').limits.daily_publish, 1000)
    assert.strictEqual(getPlanEntitlement('pro').quota.cloud_publish_monthly, 1000 * 30)
  })

  await t.test('feature/quota 形状对齐 consumeFeature 契约（features 数组 + 顶层 quota）', () => {
    const free = getPlanEntitlement('free')
    assert.ok(free.features.includes('cloud_publish'))
    assert.ok(free.features.includes('ai_write'))
    assert.ok(!free.features.includes('video_create'))
    assert.ok(!free.features.includes('schedule_batch'))
    assert.ok(!free.features.includes('dashboard_full'))
    const standard = getPlanEntitlement('standard')
    assert.ok(standard.features.includes('video_create'))
    assert.ok(standard.features.includes('schedule_batch'))
    assert.ok(standard.features.includes('dashboard_full'))
    assert.strictEqual(standard.quota.video_create_monthly, 500)
    assert.strictEqual(getPlanEntitlement('pro').quota.video_create_monthly, 3000)
    assert.strictEqual(standard.limits.concurrent_tasks, 3)
    assert.strictEqual(getPlanEntitlement('pro').limits.concurrent_tasks, 10)
    // 官方积分档位：free 无 / standard 中 / pro 高
    assert.strictEqual(free.quota.official_credit_monthly, 0)
    assert.ok(standard.quota.official_credit_monthly > 0)
    assert.ok(getPlanEntitlement('pro').quota.official_credit_monthly > standard.quota.official_credit_monthly)
  })

  await t.test('运营 overrides 注入：合法覆盖生效、未知键与非法值 fail closed', () => {
    const patched = getPlanEntitlement('standard', { standard: { videoMonthly: 600 } })
    assert.strictEqual(patched.quota.video_create_monthly, 600)
    assert.strictEqual(getPlanEntitlement('standard').quota.video_create_monthly, 500) // 不污染基线
    assert.throws(() => getPlanEntitlement('standard', { standard: { noSuchKey: 1 } }), /unknown key/i)
    assert.throws(() => getPlanEntitlement('standard', { standard: { videoMonthly: 1.5 } }), /integer/i)
    assert.throws(
      () => getPlanEntitlement('standard', { standard: { videoMonthly: -2 } }),
      (err) => /-1|range|invalid/i.test(err.message) && err.code === 'PLAN_MATRIX_CONFIG_INVALID'
    )
    // dailyPublish 是被扣减 feature 的派生源，-1 会击穿 consumeFeature 的 limit>=0 校验 → 必须 fail closed
    assert.throws(() => getPlanEntitlement('standard', { standard: { dailyPublish: -1 } }), /does not accept -1/i)
    // aiWriteMonthly 允许 -1（P1 无服务端 consumeFeature('ai_write') 路径，仅契约下发）
    assert.doesNotThrow(() => getPlanEntitlement('standard', { standard: { aiWriteMonthly: -1 } }))
  })

  await t.test('overrides 顶层形状 fail closed：档位键拼错 / 非对象一律抛配置错误（Finding 1 回归守卫）', () => {
    // 拼错档位键：过去静默返回基线（fail open），现在必须抛错
    assert.throws(
      () => getPlanEntitlement('standard', { standart: { videoMonthly: 600 } }),
      (err) => err.code === 'PLAN_MATRIX_CONFIG_INVALID'
    )
    // 非对象 overrides：数字 / 布尔 / 数组
    for (const bad of [42, true, []]) {
      assert.throws(
        () => getPlanEntitlement('standard', bad),
        (err) => err.code === 'PLAN_MATRIX_CONFIG_INVALID'
      )
    }
    // 段值非对象（既非 null/undefined 亦非 object）
    assert.throws(
      () => getPlanEntitlement('standard', { standard: 42 }),
      (err) => err.code === 'PLAN_MATRIX_CONFIG_INVALID'
    )
  })

  await t.test('overrides 段值为 null 视为「该档位不覆盖」，返回基线不抛错（Finding 1 决策）', () => {
    const baseline = getPlanEntitlement('standard')
    assert.doesNotThrow(() => getPlanEntitlement('standard', { standard: null }))
    const withNull = getPlanEntitlement('standard', { standard: null })
    assert.deepStrictEqual(withNull, baseline)
    assert.strictEqual(withNull.quota.video_create_monthly, 500) // 未被覆盖，仍是基线值
  })

  await t.test('getPlanCatalog(overrides)：合法覆盖在目录展示与内嵌 entitlement 均生效', () => {
    const catalog = getPlanCatalog({ standard: { priceMonthlyCents: 3900, videoMonthly: 600 } })
    const standard = catalog.find((it) => it.id === 'standard')
    assert.strictEqual(standard.priceMonthlyCents, 3900)
    assert.strictEqual(standard.entitlement.quota.video_create_monthly, 600)
    assert.strictEqual(catalog.find((it) => it.id === 'free').priceMonthlyCents, 0) // 其它档位不受影响
  })

  await t.test('不可覆盖键（scheduleBatch / dashboard）抛配置错误码（契约开关阶段 1 冻结）', () => {
    assert.throws(
      () => getPlanEntitlement('free', { free: { scheduleBatch: true } }),
      (err) => err.code === 'PLAN_MATRIX_CONFIG_INVALID'
    )
    assert.throws(
      () => getPlanEntitlement('free', { free: { dashboard: 'full' } }),
      (err) => /is not overridable/.test(err.message) && err.code === 'PLAN_MATRIX_CONFIG_INVALID'
    )
  })

  await t.test('concurrentTasks: 0 病态配置被拒（Finding 4），dailyPublish: 0 仍合法', () => {
    assert.throws(
      () => getPlanEntitlement('standard', { standard: { concurrentTasks: 0 } }),
      (err) => err.code === 'PLAN_MATRIX_CONFIG_INVALID'
    )
    assert.doesNotThrow(() => getPlanEntitlement('standard', { standard: { dailyPublish: 0 } }))
  })

  await t.test('快照携带 matrixVersion；getPlanCatalog 返回值深冻结（Finding 3）', () => {
    const ent = getPlanEntitlement('standard')
    assert.strictEqual(ent.matrixVersion, PLAN_MATRIX_VERSION)
    const catalog = getPlanCatalog()
    for (const item of catalog) {
      assert.ok(Object.isFrozen(item))
      assert.ok(Object.isFrozen(item.entitlement))
      assert.ok(Object.isFrozen(item.entitlement.quota))
    }
  })

  await t.test('未知档位抛 PLAN_INVALID', () => {
    assert.throws(() => getPlanEntitlement('enterprise'), (err) => err.code === 'PLAN_INVALID')
  })

  await t.test('返回值深冻结，调用方不能篡改矩阵', () => {
    const snapshot = getPlanEntitlement('free')
    // 必须 `'use strict'`（见本文件首行）：sloppy 模式下给冻结属性赋值是静默失败，assert.throws 永不满足
    assert.throws(() => { snapshot.quota.cloud_publish_monthly = 999 }, /read-only|frozen|not extensible|Cannot assign/i)
  })
})
