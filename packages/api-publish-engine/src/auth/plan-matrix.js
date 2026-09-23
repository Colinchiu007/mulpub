'use strict'

/**
 * 会员中心 · 三档权益矩阵（服务端唯一真源）。
 * 数据契约：01-docs/DESIGN-MEMBER-CENTER-2026-09-23.md §2。
 *
 * 约定：
 * - 数值 -1 表示「不限」，仅 maxPlatforms / aiWriteMonthly / videoMonthly / officialCreditMonthly 允许（见 UNLIMITED_ALLOWED）；
 *   dailyPublish 被显式排除——它派生被扣减的 quota.cloud_publish_monthly，-1 会击穿 consumeFeature 的 limit >= 0 校验（CCG C5）。
 * - 输出形状直接兼容 PostgresEntitlementProvider.consumeFeature：features 为字符串数组（includes 判定），
 *   quota 为顶层对象且键名对齐 `${feature}_monthly`；limits 为 UI 展示透传字段（扣减路径不读）。
 * - overrides 为运营可配注入（config.yaml，带 * 项），只允许覆盖基线已有数值键。
 * - 客户端禁止硬编码金额/配额，一律通过 GET /api/v1/plans 与 entitlement 快照下发。
 */

const PLAN_MATRIX_VERSION = '2026-09-23'

const PLAN_IDS = Object.freeze(['free', 'standard', 'pro'])

const BASE_MATRIX = {
  free: {
    label: '免费版',
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    maxPlatforms: 5,
    dailyPublish: 5,
    aiWriteMonthly: 200,
    videoMonthly: 0,
    scheduleBatch: false,
    dashboard: 'basic',
    officialCreditMonthly: 0,
    concurrentTasks: 1,
  },
  standard: {
    label: '标准版',
    priceMonthlyCents: 2900,
    priceYearlyCents: 19900,
    maxPlatforms: 15,
    dailyPublish: 50,
    // 「不限」前提是走自有 Key；官方积分受 officialCreditMonthly（中档）约束。
    aiWriteMonthly: -1,
    videoMonthly: 500,
    scheduleBatch: true,
    dashboard: 'full',
    officialCreditMonthly: 500,
    concurrentTasks: 3,
  },
  pro: {
    label: '专业版',
    priceMonthlyCents: 7900,
    priceYearlyCents: 59900,
    maxPlatforms: -1,
    // spec：「不限（默认上限 1000，运营可配）」——用有限高值而非 -1，避免下游除零/无限逻辑。
    dailyPublish: 1000,
    aiWriteMonthly: 12000,
    videoMonthly: 3000,
    scheduleBatch: true,
    dashboard: 'full',
    officialCreditMonthly: 3000,
    concurrentTasks: 10,
  },
}

const NUMERIC_KEYS = Object.freeze([
  'priceMonthlyCents', 'priceYearlyCents', 'maxPlatforms', 'dailyPublish',
  'aiWriteMonthly', 'videoMonthly', 'officialCreditMonthly', 'concurrentTasks',
])
// 不含 dailyPublish：它派生 quota.cloud_publish_monthly，该 feature 会被 consumeFeature 扣减（要求 limit >= 0），-1 会导致发布链路 503
const UNLIMITED_ALLOWED = Object.freeze(['maxPlatforms', 'aiWriteMonthly', 'videoMonthly', 'officialCreditMonthly'])
// concurrentTasks 至少 1：0 并发为病态配置。dailyPublish 不在此列（0 属刻意清零配额，仍合法）。
const MIN_ONE_KEYS = Object.freeze(['concurrentTasks'])

/** 配置类错误：overrides 非法，属部署期缺陷（HTTP 层应映射 500 / 启动 fail-fast）。 */
const invalid = (message) => Object.assign(new Error(`plan-matrix: ${message}`), { code: 'PLAN_MATRIX_CONFIG_INVALID', status: 500 })
/** 请求类错误：档位不存在，属入参缺陷（HTTP 层应映射 400）。 */
const invalidPlan = (plan) => Object.assign(new Error(`plan-matrix: unknown plan '${plan}'`), { code: 'PLAN_INVALID', status: 400 })

function validateNumericValue(key, value, context) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalid(`'${key}' in ${context} must be an integer`)
  }
  if (value === -1 && !UNLIMITED_ALLOWED.includes(key)) {
    throw invalid(`'${key}' in ${context} does not accept -1 (unlimited)`)
  }
  if (value < -1) {
    throw invalid(`'${key}' in ${context} must be >= -1`)
  }
  if (MIN_ONE_KEYS.includes(key) && value < 1) {
    throw invalid(`'${key}' in ${context} must be >= 1`)
  }
}

// overrides 顶层形状守卫：只接受以合法档位 id 为键的普通对象；段内逐键校验交给 mergePlanSection。
// 段值为 null/undefined 视为「该档位不覆盖」（对应 YAML 空节点），显式允许；顶层非对象或档位键拼错一律抛错（fail closed）。
function validateOverridesShape(overrides) {
  if (overrides === undefined || overrides === null) return
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw invalid('overrides must be a plain object keyed by plan id')
  }
  for (const key of Object.keys(overrides)) {
    if (!PLAN_IDS.includes(key)) throw invalid(`unknown plan key '${key}' in overrides`)
    const section = overrides[key]
    if (section === null || section === undefined) continue
    if (typeof section !== 'object' || Array.isArray(section)) {
      throw invalid(`overrides.${key} must be an object of numeric keys`)
    }
  }
}

function mergePlanSection(plan, overrides) {
  validateOverridesShape(overrides)
  const base = BASE_MATRIX[plan]
  if (!overrides) return { ...base }
  const section = overrides[plan]
  if (!section) return { ...base }
  const merged = { ...base }
  for (const [key, value] of Object.entries(section)) {
    if (!(key in base)) throw invalid(`unknown key '${key}' for plan ${plan}`)
    if (!NUMERIC_KEYS.includes(key)) {
      // scheduleBatch/dashboard/label 为契约开关，阶段 1 冻结为不可覆盖（运营可配仅覆盖数值 * 项）
      throw invalid(`key '${key}' for plan ${plan} is not overridable`)
    }
    validateNumericValue(key, value, `plan ${plan}`)
    merged[key] = value
  }
  return merged
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value)
  }
  return Object.freeze(obj)
}

/** entitlement 形状：{ plan, features: string[], quota: {}, limits: {} }，兼容 consumeFeature，供 /api/v1/me 快照直接落库。 */
function getPlanEntitlement(plan, overrides) {
  if (!PLAN_IDS.includes(plan)) {
    throw invalidPlan(plan)
  }
  const matrix = mergePlanSection(plan, overrides)
  const features = ['cloud_publish', 'ai_write']
  if (matrix.videoMonthly > 0) features.push('video_create')
  if (matrix.scheduleBatch === true) features.push('schedule_batch')
  if (matrix.dashboard === 'full') features.push('dashboard_full')
  // dailyPublish 已在 UNLIMITED_ALLOWED 之外，取值必为有限非负整数（-1 被 override 校验拒绝），此处无需再判 -1
  const cloudPublishMonthly = matrix.dailyPublish * 30
  return deepFreeze({
    plan,
    matrixVersion: PLAN_MATRIX_VERSION,
    features,
    quota: {
      cloud_publish_monthly: cloudPublishMonthly,
      ai_write_monthly: matrix.aiWriteMonthly,
      video_create_monthly: matrix.videoMonthly,
      official_credit_monthly: matrix.officialCreditMonthly,
    },
    limits: {
      max_platforms: matrix.maxPlatforms,
      daily_publish: matrix.dailyPublish,
      concurrent_tasks: matrix.concurrentTasks,
    },
  })
}

/** 价目目录（GET /api/v1/plans 展示用，含展示字段，与权益分离）。 */
function getPlanCatalog(overrides) {
  return PLAN_IDS.map((plan) => {
    const matrix = mergePlanSection(plan, overrides)
    return deepFreeze({
      id: plan,
      label: matrix.label,
      currency: 'CNY',
      priceMonthlyCents: matrix.priceMonthlyCents,
      priceYearlyCents: matrix.priceYearlyCents,
      entitlement: getPlanEntitlement(plan, overrides),
    })
  })
}

// 基线为全标量 + 浅拷贝安全；显式深冻结作 tripwire，若将来有人塞入嵌套对象可及时暴露（见测试）。
deepFreeze(BASE_MATRIX)

module.exports = { PLAN_MATRIX_VERSION, PLAN_IDS, getPlanEntitlement, getPlanCatalog }
