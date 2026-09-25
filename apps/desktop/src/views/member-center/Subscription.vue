<template>
  <div class="member-center-subscription">
    <section v-if="entitlement" class="member-center-card" data-testid="member-center-subscription-detail">
      <div class="member-center-card-title">
        {{ t('memberCenter.entitlementCardTitle') }}
        <span class="member-center-source-badge" :class="`source-${entitlement.source || 'online'}`">
          {{ entitlement.source === 'offline' ? t('memberCenter.sourceOffline') : t('memberCenter.sourceOnline') }}
        </span>
      </div>
      <div class="member-center-plan-block">
        <span class="member-center-plan-name">{{ planLabel }}</span>
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
    <section v-else class="member-center-card member-center-empty">
      <p class="member-center-empty-hint">{{ t('memberCenter.entitlementEmptyHint') }}</p>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentityStore } from '@/stores/identity'
import { planLabelOf, formatExpiresAt } from './labels'

const { t } = useI18n()
const identityStore = useIdentityStore()
const entitlement = computed(() => identityStore.entitlement)
const planLabel = computed(() => planLabelOf(t, entitlement.value?.plan))
</script>
