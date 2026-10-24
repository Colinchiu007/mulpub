'use strict'

const assert = require('assert')
const test = require('node:test')

const { PLAN_IDS, getPlanEntitlement, getPlanCatalog, PLAN_MATRIX_VERSION, planRank, PLAN_RANK } = require('../src/auth/plan-matrix')

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
    assert.strictEqual(standard.priceMonthlyCents, 5900)
    assert.strictEqual(standard.priceYearlyCents, 49900)
    // v2.0 机制 C2.3 结构 A：相邻档 2.0x（行业中位），¥79 → ¥119、¥699 → ¥999
    assert.strictEqual(pro.priceMonthlyCents, 11900)
    assert.strictEqual(pro.priceYearlyCents, 99900)
    for (const item of catalog) assert.strictEqual(item.currency, 'CNY')
    // 档位序随目录下发，UI 排序与续叠保护同源（不得各自维护一份次序）
    assert.deepStrictEqual(catalog.map((it) => it.rank), [0, 1, 2])
  })

  await t.test('官方积分月度配额：30 / 1600 / 3330', () => {
    assert.strictEqual(getPlanEntitlement('free').quota.official_credit_monthly, 30)
    assert.strictEqual(getPlanEntitlement('standard').quota.official_credit_monthly, 1600)
    assert.strictEqual(getPlanEntitlement('pro').quota.official_credit_monthly, 3330)
  })

  // ⚠️ 这条是**防复发**断言，不是复述数值：把「成本占比守线」写死成不变量，
  // 于是「涨价了但忘了重解赠送量」会当场红，而不是像 2200 那样静默让毛利虚高 9.5 个点。
  // 口径来源：01-docs/DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md §6.1b v1.2 定价表
  //   —— 年付守线 ≤ 40%（年付按月等额发放 ⇒ 年付成本 = 12 × 月付成本）。
  await t.test('成本占比守线：月付 ≤ 30% 且年付 ≤ 40%（改价必须重解赠送量）', () => {
    const cases = [
      { plan: 'standard', monthlyCents: 5900, yearlyCents: 49900, credit: 1600 },
      { plan: 'pro', monthlyCents: 11900, yearlyCents: 99900, credit: 3330 },
    ]
    for (const c of cases) {
      const granted = getPlanEntitlement(c.plan).quota.official_credit_monthly
      assert.strictEqual(granted, c.credit, `${c.plan} 赠送量与定案不一致`)
      // 1 积分 = 1 分 = ¥0.01 ⇒ 赠送 M 积分的月成本 = M × 0.01 元
      const monthlyCostYuan = granted * 0.01
      const monthlyRatio = monthlyCostYuan / (c.monthlyCents / 100)
      const yearlyRatio = (monthlyCostYuan * 12) / (c.yearlyCents / 100)
      assert.ok(monthlyRatio <= 0.30, `${c.plan} 月付成本占比 ${(monthlyRatio * 100).toFixed(1)}% 超过 30%`)
      assert.ok(yearlyRatio <= 0.40, `${c.plan} 年付成本占比 ${(yearlyRatio * 100).toFixed(1)}% 超过 40%`)
    }
  })

  // 赠送量是**唯一**的官方积分额度字段，且必须作为能力声明出现在 features 里，
  // 否则后续 consumeFeature('official_credit') 会 403，额度形同虚设。
  await t.test('official_credit 作为能力声明出现在 features（三档皆有额度）', () => {
    for (const plan of PLAN_IDS) {
      const ent = getPlanEntitlement(plan)
      assert.ok(ent.features.includes('official_credit'), `${plan} 缺 official_credit 能力声明`)
      assert.ok(ent.quota.official_credit_monthly > 0, `${plan} 声明了能力却无额度`)
    }
  })

  await t.test('无限值约定 -1：pro 平台数 / standard AI 写稿（自有 Key）', () => {
    assert.strictEqual(getPlanEntitlement('pro').limits.max_platforms, -1)
    assert.strictEqual(getPlanEntitlement('standard').quota.ai_write_monthly, -1)
    assert.strictEqual(getPlanEntitlement('free').limits.max_platforms, 5)
    assert.strictEqual(getPlanEntitlement('standard').limits.max_platforms, 15)
  })

  // ⚠️ 「-1 = 不限」的能力声明口径：判据必须是 `!== 0` 而不是 `> 0`。
  // `officialCreditMonthly` / `videoMonthly` 都在 UNLIMITED_ALLOWED 里（运营可配 -1），
  // 若用 `> 0`，「不限」会被判成「没有额度」⇒ 能力声明整条消失
  // ⇒ 一次**合法的**运营配置静默关掉已付费的能力（consumeFeature 直接 403）。
  // 与 maxCloudAccounts 的 `!== 0` 同一形态。
  await t.test('-1（不限）仍声明对应能力；0（无额度）不声明', () => {
    const unlimited = getPlanEntitlement('standard', { standard: { officialCreditMonthly: -1 } })
    assert.ok(unlimited.features.includes('official_credit'), '不限额度不该抹掉 official_credit 能力声明')
    assert.strictEqual(unlimited.quota.official_credit_monthly, -1)

    const unlimitedVideo = getPlanEntitlement('standard', { standard: { videoMonthly: -1 } })
    assert.ok(unlimitedVideo.features.includes('video_create'), '不限额度不该抹掉 video_create 能力声明')

    const zeroed = getPlanEntitlement('standard', { standard: { officialCreditMonthly: 0 } })
    assert.ok(!zeroed.features.includes('official_credit'), '额度为 0 时不该声明 official_credit')
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
    // v2.0 机制 C4.3：视频配额 500 → 300（3× 于画像 p75 100 条/月）
    assert.strictEqual(standard.quota.video_create_monthly, 300)
    assert.strictEqual(getPlanEntitlement('pro').quota.video_create_monthly, 3000)
    assert.strictEqual(standard.limits.concurrent_tasks, 3)
    assert.strictEqual(getPlanEntitlement('pro').limits.concurrent_tasks, 10)
    // 官方积分档位：free 体验额度 / standard 中 / pro 高（逐值断言见上方专用用例）
    assert.ok(free.quota.official_credit_monthly > 0)
    assert.ok(standard.quota.official_credit_monthly > free.quota.official_credit_monthly)
    assert.ok(getPlanEntitlement('pro').quota.official_credit_monthly > standard.quota.official_credit_monthly)
  })

  await t.test('v2.0 机制：档位序 rank 单调且不可被 overrides 覆盖', () => {
    assert.strictEqual(planRank('free'), 0)
    assert.strictEqual(planRank('standard'), 1)
    assert.strictEqual(planRank('pro'), 2)
    // 未知档位返回 -1：调用方据此判「无法比较」，不得把未知值当 0/2 参与大小比较
    assert.strictEqual(planRank('enterprise'), -1)
    assert.deepStrictEqual({ ...PLAN_RANK }, { free: 0, standard: 1, pro: 2 })
    // 单一真源（CCG i3）：BASE_MATRIX.rank 引用 PLAN_RANK，三处派生必须同值，
    // 否则 limits.plan_rank 与降级保护会各读一份次序，改错一处即静默不一致
    const catalog = getPlanCatalog()
    for (const plan of PLAN_IDS) {
      assert.strictEqual(getPlanEntitlement(plan).limits.plan_rank, planRank(plan))
      assert.strictEqual(catalog.find((item) => item.id === plan).rank, planRank(plan))
    }
    // 档位序可配 ⇒ 运营改错一个数就能让 v2.0 C9.2 的降级保护静默失效 ⇒ 必须不可覆盖
    assert.throws(
      () => getPlanEntitlement('standard', { standard: { rank: 5 } }),
      (err) => err.code === 'PLAN_MATRIX_CONFIG_INVALID'
    )
  })

  await t.test('v2.0 机制：三条新权益轴的 features 派生（云同步/批量/模型分层）', () => {
    const free = getPlanEntitlement('free')
    const standard = getPlanEntitlement('standard')
    const pro = getPlanEntitlement('pro')
    // 云同步账号数：0 = 本档不提供（免费档只允许本地绑定，云同步是付费面）
    assert.ok(!free.features.includes('cloud_account_sync'))
    assert.ok(standard.features.includes('cloud_account_sync'))
    assert.ok(pro.features.includes('cloud_account_sync'))
    // 批量发布：单次上限 1 = 单篇，不派生批量能力
    assert.ok(!free.features.includes('batch_publish'))
    assert.ok(standard.features.includes('batch_publish'))
    assert.ok(pro.features.includes('batch_publish'))
    // 模型分层：features 是单调包含判定，高档覆盖低档（pro 同时含 standard 级）
    assert.ok(!free.features.includes('tier_access_standard'))
    assert.ok(standard.features.includes('tier_access_standard'))
    assert.ok(!standard.features.includes('tier_access_pro'))
    assert.ok(pro.features.includes('tier_access_standard'))
    assert.ok(pro.features.includes('tier_access_pro'))
  })

  await t.test('v2.0 机制：limits 新键随快照下发（此前客户端拿不到，G6 根因）', () => {
    const free = getPlanEntitlement('free')
    const standard = getPlanEntitlement('standard')
    const pro = getPlanEntitlement('pro')
    assert.strictEqual(free.limits.max_devices, 2)
    assert.strictEqual(standard.limits.max_devices, 3)
    assert.strictEqual(pro.limits.max_devices, -1)
    assert.strictEqual(free.limits.max_cloud_accounts, 0)
    assert.strictEqual(standard.limits.max_cloud_accounts, 20)
    assert.strictEqual(pro.limits.max_cloud_accounts, -1)
    assert.strictEqual(free.limits.batch_size_per_run, 1)
    assert.strictEqual(standard.limits.batch_size_per_run, 10)
    assert.strictEqual(pro.limits.batch_size_per_run, -1)
    assert.strictEqual(free.limits.model_tier, 0)
    assert.strictEqual(standard.limits.model_tier, 1)
    assert.strictEqual(pro.limits.model_tier, 2)
    assert.strictEqual(free.limits.plan_rank, 0)
    assert.strictEqual(pro.limits.plan_rank, 2)
  })

  await t.test('运营 overrides 注入：合法覆盖生效、未知键与非法值 fail closed', () => {
    const patched = getPlanEntitlement('standard', { standard: { videoMonthly: 600 } })
    assert.strictEqual(patched.quota.video_create_monthly, 600)
    assert.strictEqual(getPlanEntitlement('standard').quota.video_create_monthly, 300) // 不污染基线
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
    assert.strictEqual(withNull.quota.video_create_monthly, 300) // 未被覆盖，仍是基线值
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
