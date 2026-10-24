/**
 * 会员中心标签/格式化的纯函数集合（壳层与各子视图共用，避免逻辑重复）。
 * 全部以 t 作首参注入，保持 i18n 可测试且不耦合具体组件。
 */

export function avatarInitialOf(name) {
  const chars = Array.from(String(name || 'M'))
  return (chars[0] || 'M').toUpperCase()
}

export function licenseLabelOf(t, licenseStore, entitlement) {
  // A2 单一真源：登录且有服务端权益快照时，版本卡与权益卡同源展示 entitlement.plan。
  if (entitlement) return planLabelOf(t, entitlement.plan)
  if (licenseStore.isPro) return t('memberCenter.licensePro')
  if (licenseStore.isTrial) return t('memberCenter.licenseTrial')
  return t('memberCenter.licenseFree')
}

export function licenseMetaOf(t, licenseStore, entitlement) {
  if (entitlement) {
    return entitlement.expiresAt
      ? t('memberCenter.expiresAt', { date: formatExpiresAt(entitlement.expiresAt) })
      : t('memberCenter.noExpiry')
  }
  if (licenseStore.isPro) return t('memberCenter.licenseUnlimited')
  const days = Number(licenseStore.info?.daysRemaining)
  if (days > 0) return t('memberCenter.daysRemaining', { days })
  return t('memberCenter.licenseUnlimited')
}

export function isProActiveOf(licenseStore, entitlement) {
  if (entitlement) return entitlement.plan === 'pro'
  return Boolean(licenseStore.isPro)
}

export function planLabelOf(t, plan) {
  // P0-3 / MISS-4：三档显式映射 + 缺失中性态。
  // **不再 `|| 'free'` 兜底**——entitlement 未加载时显示「免费版」是错误标注
  // （pro 用户会短暂看到免费版；standard 用户曾看到「自定义方案」）。
  if (plan === 'pro') return t('memberCenter.planPro')
  if (plan === 'standard') return t('memberCenter.planStandard')
  if (plan === 'trial') return t('memberCenter.planTrial')
  if (plan === 'free') return t('memberCenter.planFree')
  if (plan === undefined || plan === null || plan === '') return t('memberCenter.planUnknown')
  return t('memberCenter.planCustom')
}

// ── feature / quota 本地化（P0-4 / C1-09）─────────────────────────
// 服务端 features 是英文 feature 名、quota 键形为 `${feature}_monthly`
// （plan-matrix.js 派生段）。本地化键与服务端键**逐字符同形**，
// 命中则用 t()，未知键回退原文——服务端加新 feature 不开天窗。
const FEATURE_KEYS = new Set([
  'cloud_publish',
  'ai_write',
  'video_create',
  'schedule_batch',
  'dashboard_full',
])

export function featureLabelOf(t, feature) {
  if (typeof feature !== 'string' || !feature) return ''
  if (FEATURE_KEYS.has(feature)) return t('memberCenter.feature.' + feature)
  return feature
}

// plan-matrix.js:160-165 派生的四个 quota 键；新增键必须与派生段同步。
const QUOTA_KEYS = new Set([
  'cloud_publish_monthly',
  'ai_write_monthly',
  'video_create_monthly',
  'official_credit_monthly',
])

export function quotaLabelOf(t, quotaKey) {
  if (typeof quotaKey !== 'string' || !quotaKey) return ''
  if (QUOTA_KEYS.has(quotaKey)) return t('memberCenter.quota.' + quotaKey)
  return quotaKey
}

// -1 是 plan-matrix 的「不限」语义（UNLIMITED_ALLOWED 内的键）。
export function quotaValueText(t, value) {
  if (value === null || value === undefined) return '—'
  if (value === -1) return t('memberCenter.quotaUnlimited')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// ── 宽限期（v4 新增：#4051 已透传 graceUntil / previousPlan）────────
// 「降级不是悬崖」：到期后 7 天保留只读 + 队列收尾，配额按免费档。
// **禁止**把宽限期渲染成正式权益——UI 不得暗示满血。
export function graceState(t, entitlement) {
  const empty = { inGrace: false, untilText: '', previousPlanLabel: '' }
  const until = entitlement?.graceUntil
  if (typeof until !== 'string' || !until) return empty
  const date = new Date(until)
  if (Number.isNaN(date.getTime())) return empty // 非法 ISO：退化普通到期，不崩
  return {
    inGrace: true,
    untilText: date.toLocaleDateString(),
    previousPlanLabel: entitlement?.previousPlan
      ? planLabelOf(t, entitlement.previousPlan)
      : '',
  }
}

// ── member store 错误码 → i18n key（P0-5 / §8 MAJOR-1）────────────
// 白名单制：store 的 error 字段现在只可能是这些码（safeInvoke 规范化）；
// 未知码一律走通用失败文案——**绝不把裸错误码透给终端用户**。
const MEMBER_ERROR_KEYS = {
  MEMBER_PERMISSION_REQUIRED: 'memberCenter.memberPermissionRequired',
  MEMBER_REQUEST_FAILED: 'memberCenter.memberRequestFailed',
}

export function resolveMemberErrorKey(code) {
  if (typeof code !== 'string' || !code) return 'memberCenter.memberRequestFailed'
  return MEMBER_ERROR_KEYS[code] || 'memberCenter.memberRequestFailed'
}

export function statusLabelOf(t, status) {
  if (status === 'authenticated') return t('memberCenter.statusConnected')
  if (status === 'offline_authenticated') return t('memberCenter.statusOffline')
  if (status === 'refreshing') return t('memberCenter.statusRefreshing')
  if (status === 'signing_in') return t('memberCenter.statusSigningIn')
  if (status === 'signing_out') return t('memberCenter.statusSigningOut')
  if (status === 'expired') return t('memberCenter.statusExpired')
  if (status === 'error') return t('memberCenter.statusError')
  if (status === 'disabled') return t('memberCenter.identityDisabled')
  return t('memberCenter.notLoggedIn')
}

export function formatExpiresAt(expiresAt) {
  const date = new Date(Number(expiresAt) * 1000)
  if (Number.isNaN(date.getTime())) return String(expiresAt)
  return date.toLocaleDateString()
}

export function formatTimestamp(value) {
  if (value === null || value === undefined || value === '') return '—'
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value)
  if (Number.isNaN(ms)) return String(value)
  return new Date(ms).toLocaleString()
}
