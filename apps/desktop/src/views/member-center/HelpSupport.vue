<template>
  <div class="member-center-help">
    <section class="member-center-card" data-testid="member-center-about">
      <div class="member-center-card-title">{{ t('memberCenter.aboutCardTitle') }}</div>
      <div class="member-center-about-row">
        <span class="member-center-about-label">{{ t('memberCenter.versionLabel') }}</span>
        <span data-testid="member-center-version">{{ version || '—' }}</span>
      </div>
    </section>

    <section class="member-center-card">
      <div class="member-center-card-title">{{ t('memberCenter.helpTitle') }}</div>
      <p class="member-center-empty-hint">{{ t('memberCenter.helpHint') }}</p>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@/api/electron-bridge'

const { t } = useI18n()
const version = ref('')

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
