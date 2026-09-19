<template>
  <div class="member-center-view" data-testid="member-center-view">
    <!-- 页面头部 -->
    <div class="cohere-page-header">
      <div>
        <div class="page-title" data-testid="member-center-title">{{ t('memberCenter.title') }}</div>
        <div class="page-subtitle">{{ t('memberCenter.subtitle') }}</div>
      </div>
      <div class="page-actions">
        <button v-if="!hasSessionIdentity && status !== 'disabled'" class="cohere-btn-primary" data-testid="member-center-login" :disabled="loading" @click="handleSignIn">
          {{ loading ? t('memberCenter.signingIn') : t('memberCenter.login') }}
        </button>
      </div>
    </div>

    <div class="cohere-content member-center-grid">
      <!-- 未登录空态 -->
      <section v-if="!hasSessionIdentity && status !== 'disabled'" class="member-center-card member-center-empty" data-testid="member-center-empty">
        <div class="member-center-empty-icon" aria-hidden="true">⚡</div>
        <div class="member-center-empty-title">{{ t('memberCenter.notLoggedIn') }}</div>
        <p class="member-center-empty-hint">{{ t('memberCenter.notLoggedInHint') }}</p>
        <button class="cohere-btn-primary" :disabled="loading" @click="handleSignIn">
          {{ loading ? t('memberCenter.signingIn') : t('memberCenter.login') }}
        </button>
      </section>

      <!-- 账号信息卡 -->
      <section class="member-center-card" data-testid="member-center-account">
        <div class="member-center-card-title">{{ t('memberCenter.accountCardTitle') }}</div>
        <template v-if="hasSessionIdentity">
          <div class="member-center-account-row">
            <span class="member-center-avatar" aria-hidden="true">{{ avatarInitial }}</span>
            <div class="member-center-account-main">
              <strong class="member-center-account-name">{{ displayName }}</strong>
              <span v-if="user?.username" class="member-center-account-username">@{{ user.username }}</span>
            </div>
            <span class="member-center-status-badge" :class="`status-${status}`" data-testid="member-center-status">{{ statusLabel }}</span>
          </div>
          <div class="member-center-card-actions">
            <button class="cohere-btn-secondary" data-testid="member-center-switch" :disabled="loading" @click="handleSwitchAccount">
              {{ pendingAction === 'switch' ? t('memberCenter.switchingAccount') : t('memberCenter.switchAccount') }}
            </button>
            <button class="cohere-btn-secondary" data-testid="member-center-signout" :disabled="loading" @click="handleSignOut">
              {{ pendingAction === 'sign-out' || isSigningOut ? t('memberCenter.signingOut') : t('memberCenter.signOut') }}
            </button>
          </div>
        </template>
        <template v-else-if="status === 'disabled'">
          <div class="member-center-disabled">
            <div class="member-center-disabled-title">{{ t('memberCenter.identityDisabled') }}</div>
            <p class="member-center-empty-hint">{{ t('memberCenter.identityDisabledHint') }}</p>
          </div>
        </template>
        <template v-else>
          <p class="member-center-empty-hint">{{ t('memberCenter.accountCardEmptyHint') }}</p>
        </template>
        <p v-if="errorMessage" class="member-center-error" role="alert">{{ errorMessage }}</p>
      </section>

      <!-- 版本与许可证卡 -->
      <section class="member-center-card" data-testid="member-center-license">
        <div class="member-center-card-title">{{ t('memberCenter.licenseCardTitle') }}</div>
        <div class="member-center-license-row">
          <div class="member-center-plan-block">
            <span class="member-center-plan-name" data-testid="member-center-plan">{{ licenseLabel }}</span>
            <span class="member-center-plan-meta">{{ licenseMeta }}</span>
          </div>
          <button v-if="!licenseStore.isPro" class="cohere-btn-primary" data-testid="member-center-upgrade" @click="showUpgrade = true">
            {{ t('memberCenter.upgradePro') }}
          </button>
          <span v-else class="member-center-plan-check" data-testid="member-center-pro-active">✓</span>
        </div>
        <p class="member-center-upgrade-hint">{{ t('memberCenter.upgradeHint') }}</p>
        <UpgradeModal v-if="showUpgrade" @close="showUpgrade = false" />
      </section>

      <!-- 会员权益卡 -->
      <section v-if="entitlement" class="member-center-card" data-testid="member-center-entitlement">
        <div class="member-center-card-title">
          {{ t('memberCenter.entitlementCardTitle') }}
          <span class="member-center-source-badge" :class="`source-${entitlement.source || 'online'}`">
            {{ entitlement.source === 'offline' ? t('memberCenter.sourceOffline') : t('memberCenter.sourceOnline') }}
          </span>
        </div>
        <div class="member-center-plan-block">
          <span class="member-center-plan-name" data-testid="member-center-entitlement-plan">{{ entitlementPlanLabel }}</span>
          <span v-if="entitlement.expiresAt" class="member-center-plan-meta">
            {{ t('memberCenter.expiresAt', { date: formatExpiresAt(entitlement.expiresAt) }) }}
          </span>
          <span v-else class="member-center-plan-meta">{{ t('memberCenter.noExpiry') }}</span>
        </div>
        <ul v-if="entitlement.features?.length" class="member-center-feature-list" data-testid="member-center-features">
          <li v-for="feature in entitlement.features" :key="feature" class="member-center-feature-item">
            <span class="member-center-feature-check" aria-hidden="true">✓</span>{{ feature }}
          </li>
        </ul>
        <p v-else class="member-center-empty-hint">{{ t('memberCenter.entitlementEmptyHint') }}</p>
      </section>

      <!-- 资源配额卡 -->
      <section v-if="quotaEntries.length" class="member-center-card" data-testid="member-center-quota">
        <div class="member-center-card-title">{{ t('memberCenter.quotaCardTitle') }}</div>
        <div class="member-center-quota-grid">
          <div v-for="entry in quotaEntries" :key="entry.key" class="member-center-quota-item">
            <span class="member-center-quota-label">{{ entry.key }}</span>
            <span class="member-center-quota-value">{{ entry.label }}</span>
          </div>
        </div>
      </section>

      <!-- 关于卡 -->
      <section class="member-center-card" data-testid="member-center-about">
        <div class="member-center-card-title">{{ t('memberCenter.aboutCardTitle') }}</div>
        <div class="member-center-about-row">
          <span class="member-center-about-label">{{ t('memberCenter.versionLabel') }}</span>
          <span data-testid="member-center-version">{{ version || '—' }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentity } from '@/composables/useIdentity'
import { useIdentityStore } from '@/stores/identity'
import { useLicenseStore } from '@/stores/license'
import { resolveIdentityErrorMessageKey } from '@/utils/identity-error-messages'
import { getApi } from '@/api/electron-bridge'
import UpgradeModal from '@/components/UpgradeModal.vue'

const { t } = useI18n()
const identityStore = useIdentityStore()
const licenseStore = useLicenseStore()
const { status, user, displayName, loading, error, signIn, switchAccount, signOut } = useIdentity()

const showUpgrade = ref(false)
const pendingAction = ref(null)
const version = ref('')

const hasSessionIdentity = computed(() => Boolean(user.value?.sub) && !['disabled', 'signed_out', 'expired'].includes(status.value))
const isSigningOut = computed(() => status.value === 'signing_out')
const errorMessage = computed(() => {
  const entry = error.value
  if (!entry?.code) return ''
  const primary = t(resolveIdentityErrorMessageKey(entry.code))
  const cleanupCode = entry.cleanup?.code
  if (!cleanupCode) return primary
  const secondary = t(resolveIdentityErrorMessageKey(cleanupCode))
  return secondary === primary ? primary : `${primary} ${secondary}`
})
const entitlement = computed(() => identityStore.entitlement)

const avatarInitial = computed(() => Array.from(displayName.value || 'M')[0].toUpperCase())
const licenseLabel = computed(() => {
  if (licenseStore.isPro) return t('memberCenter.licensePro')
  if (licenseStore.isTrial) return t('memberCenter.licenseTrial')
  return t('memberCenter.licenseFree')
})
const licenseMeta = computed(() => {
  if (licenseStore.isPro) return t('memberCenter.licenseUnlimited')
  if (licenseStore.info?.daysRemaining > 0 && licenseStore.isTrial) {
    return t('memberCenter.daysRemaining', { days: licenseStore.info.daysRemaining })
  }
  if (licenseStore.info?.daysRemaining > 0) {
    return t('memberCenter.daysRemaining', { days: licenseStore.info.daysRemaining })
  }
  return t('memberCenter.licenseUnlimited')
})
const entitlementPlanLabel = computed(() => {
  const plan = entitlement.value?.plan || 'free'
  if (plan === 'pro') return t('memberCenter.planPro')
  if (plan === 'trial') return t('memberCenter.planTrial')
  if (plan === 'free') return t('memberCenter.planFree')
  return t('memberCenter.planCustom')
})
const quotaEntries = computed(() => {
  const quota = entitlement.value?.quota
  if (!quota || typeof quota !== 'object') return []
  return Object.entries(quota)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({
      key,
      label: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }))
})

const statusLabel = computed(() => {
  if (status.value === 'authenticated') return t('memberCenter.statusConnected')
  if (status.value === 'offline_authenticated') return t('memberCenter.statusOffline')
  if (status.value === 'refreshing') return t('memberCenter.statusRefreshing')
  if (status.value === 'signing_in') return t('memberCenter.statusSigningIn')
  if (status.value === 'expired') return t('memberCenter.statusExpired')
  if (status.value === 'error') return hasSessionIdentity.value ? t('memberCenter.statusConnected') : t('memberCenter.statusError')
  if (isSigningOut.value) return t('memberCenter.statusSigningOut')
  if (status.value === 'disabled') return t('memberCenter.identityDisabled')
  return t('memberCenter.notLoggedIn')
})

function formatExpiresAt(expiresAt) {
  const date = new Date(Number(expiresAt) * 1000)
  if (Number.isNaN(date.getTime())) return String(expiresAt)
  return date.toLocaleDateString()
}

async function handleSignIn() {
  await signIn()
}

async function handleSwitchAccount() {
  pendingAction.value = 'switch'
  try {
    await switchAccount()
  } finally {
    pendingAction.value = null
  }
}

async function handleSignOut() {
  pendingAction.value = 'sign-out'
  try {
    await signOut()
  } finally {
    pendingAction.value = null
  }
}

onMounted(async () => {
  const api = getApi()
  if (api && typeof api.getVersion === 'function') {
    try {
      const res = await api.getVersion()
      if (res && res.code === 0 && res.data) version.value = String(res.data)
    } catch {
      version.value = ''
    }
  }
})
</script>

<style scoped>
.member-center-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  max-width: 760px;
}

.member-center-card {
  padding: var(--space-md) var(--space-lg);
  border: 1px solid var(--card-border, #e5e4f0);
  border-radius: 12px;
  background: var(--surface, #fff);
}

.member-center-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--ink, #25252b);
  font-size: 14px;
  font-weight: 700;
}

.member-center-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.member-center-empty-icon {
  font-size: 32px;
}

.member-center-empty-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ink, #25252b);
}

.member-center-empty-hint {
  margin: 0;
  color: var(--muted, #8b8e9a);
  font-size: 13px;
  line-height: 1.6;
}

.member-center-account-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.member-center-avatar {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 50%;
  background: linear-gradient(140deg, #ffcf80, #ef9e68);
  color: #5d3824;
  font-size: 16px;
  font-weight: 700;
}

.member-center-account-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.member-center-account-name {
  overflow: hidden;
  color: var(--ink, #25252b);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-center-account-username {
  color: var(--muted, #8b8e9a);
  font-size: 12px;
}

.member-center-status-badge {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 10px;
  background: #e3e1f2;
  color: #5d5f7a;
  font-size: 11px;
}

.member-center-status-badge.status-offline_authenticated {
  background: #fdecc8;
  color: #8a6d1f;
}

.member-center-status-badge.status-expired,
.member-center-status-badge.status-error {
  background: #fde2e2;
  color: #a33;
}

.member-center-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.member-center-license-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.member-center-plan-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.member-center-plan-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink, #25252b);
}

.member-center-plan-meta {
  color: var(--muted, #8b8e9a);
  font-size: 12px;
}

.member-center-plan-check {
  color: var(--success, #059669);
  font-size: 20px;
  font-weight: 700;
}

.member-center-upgrade-hint {
  margin: 10px 0 0;
  color: var(--muted, #8b8e9a);
  font-size: 12px;
}

.member-center-source-badge {
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 400;
}

.member-center-source-badge.source-online {
  background: #d9f0d9;
  color: #2f6b2f;
}

.member-center-source-badge.source-offline {
  background: #fdecc8;
  color: #8a6d1f;
}

.member-center-feature-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 6px 16px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.member-center-feature-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary, #3a3a45);
  font-size: 13px;
}

.member-center-feature-check {
  color: var(--success, #059669);
  font-weight: 700;
}

.member-center-quota-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.member-center-quota-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border: 1px solid var(--hairline, #ecebf5);
  border-radius: 8px;
  background: var(--bg, #f8f7fc);
}

.member-center-quota-label {
  overflow: hidden;
  color: var(--muted, #8b8e9a);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-center-quota-value {
  color: var(--ink, #25252b);
  font-size: 14px;
  font-weight: 700;
  word-break: break-all;
}

.member-center-about-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.member-center-about-label {
  color: var(--muted, #8b8e9a);
  font-size: 13px;
}

.member-center-disabled-title {
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink, #25252b);
}
</style>