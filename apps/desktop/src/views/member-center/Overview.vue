<template>
  <div class="member-center-overview">
    <section class="member-center-card" data-testid="member-center-account">
      <div class="member-center-card-title">{{ t('memberCenter.accountCardTitle') }}</div>
      <div class="member-center-account-row">
        <span class="member-center-avatar" aria-hidden="true">{{ avatarInitial }}</span>
        <div class="member-center-account-main">
          <strong class="member-center-account-name">{{ displayName }}</strong>
          <span v-if="user?.username" class="member-center-account-username">@{{ user.username }}</span>
        </div>
        <span class="member-center-status-badge" :class="`status-${status}`">{{ statusLabel }}</span>
      </div>
    </section>

    <section class="member-center-card" data-testid="member-center-license">
      <div class="member-center-card-title">{{ t('memberCenter.licenseCardTitle') }}</div>
      <div class="member-center-license-row">
        <div class="member-center-plan-block">
          <span class="member-center-plan-name" data-testid="member-center-plan">{{ licenseLabel }}</span>
          <span class="member-center-plan-meta">{{ licenseMeta }}</span>
        </div>
        <span v-if="isProActive" class="member-center-plan-check" data-testid="member-center-pro-active" aria-hidden="true">✓</span>
      </div>
      <p class="member-center-upgrade-hint">{{ t('memberCenter.upgradeHint') }}</p>
    </section>

    <section v-if="entitlement" class="member-center-card" data-testid="member-center-entitlement">
      <div class="member-center-card-title">
        {{ t('memberCenter.entitlementCardTitle') }}
        <span class="member-center-source-badge" :class="`source-${entitlement.source || 'online'}`">
          {{ entitlement.source === 'offline' ? t('memberCenter.sourceOffline') : t('memberCenter.sourceOnline') }}
        </span>
      </div>
      <div class="member-center-plan-block">
        <span class="member-center-plan-name" data-testid="member-center-entitlement-plan">{{ planLabel }}</span>
        <span v-if="entitlement.expiresAt" class="member-center-plan-meta">
          {{ t('memberCenter.expiresAt', { date: formatExpiresAt(entitlement.expiresAt) }) }}
        </span>
        <span v-else class="member-center-plan-meta">{{ t('memberCenter.noExpiry') }}</span>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentity } from '@/composables/useIdentity'
import { useIdentityStore } from '@/stores/identity'
import { useLicenseStore } from '@/stores/license'
import { avatarInitialOf, isProActiveOf, licenseLabelOf, licenseMetaOf, planLabelOf, statusLabelOf, formatExpiresAt } from './labels'

const { t } = useI18n()
const identityStore = useIdentityStore()
const licenseStore = useLicenseStore()
const { status, user, displayName } = useIdentity()

const entitlement = computed(() => identityStore.entitlement)
const avatarInitial = computed(() => avatarInitialOf(displayName.value))
const licenseLabel = computed(() => licenseLabelOf(t, licenseStore, entitlement.value))
const licenseMeta = computed(() => licenseMetaOf(t, licenseStore, entitlement.value))
const isProActive = computed(() => isProActiveOf(licenseStore, entitlement.value))
const planLabel = computed(() => planLabelOf(t, entitlement.value?.plan))
const statusLabel = computed(() => statusLabelOf(t, status.value))
</script>
