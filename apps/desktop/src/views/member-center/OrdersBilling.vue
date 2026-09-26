<template>
  <div class="member-center-orders">
    <section class="member-center-card member-center-empty" data-testid="member-center-orders-empty">
      <div class="member-center-card-title">{{ t('memberCenter.ordersTitle') }}</div>
      <p class="member-center-empty-hint">{{ t('memberCenter.ordersEmptyHint') }}</p>
    </section>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
