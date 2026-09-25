<template>
  <div class="member-center-usage">
    <section v-if="quotaEntries.length" class="member-center-card" data-testid="member-center-quota">
      <div class="member-center-card-title">{{ t('memberCenter.quotaCardTitle') }}</div>
      <div class="member-center-quota-grid">
        <div v-for="entry in quotaEntries" :key="entry.key" class="member-center-quota-item">
          <span class="member-center-quota-label">{{ entry.key }}</span>
          <span class="member-center-quota-value">{{ entry.value }}</span>
        </div>
      </div>
    </section>
    <section v-else class="member-center-card member-center-empty" data-testid="member-center-quota-empty">
      <p class="member-center-empty-hint">{{ t('memberCenter.quotaEmpty') }}</p>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentityStore } from '@/stores/identity'

const { t } = useI18n()
const identityStore = useIdentityStore()

const quotaEntries = computed(() => {
  const quota = identityStore.entitlement?.quota
  if (!quota || typeof quota !== 'object') return []
  return Object.entries(quota)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }))
})
</script>
