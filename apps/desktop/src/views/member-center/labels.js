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
  const value = plan || 'free'
  if (value === 'pro') return t('memberCenter.planPro')
  if (value === 'trial') return t('memberCenter.planTrial')
  if (value === 'free') return t('memberCenter.planFree')
  return t('memberCenter.planCustom')
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
