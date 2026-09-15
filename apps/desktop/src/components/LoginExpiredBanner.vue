<template>
  <div v-if="visible" class="login-expired-banner">
    <div class="banner-content">
      <span class="banner-icon">⚠️</span>
      <div class="banner-text">
        <div class="banner-title">{{ t('home.loginExpiredBanner.title') }}</div>
        <div class="banner-desc">{{ t('home.loginExpiredBanner.description', { count: expiredCount }) }}</div>
        <div class="banner-hint">{{ t('home.loginExpiredBanner.hint') }}</div>
      </div>
      <button class="banner-btn" :disabled="batchLoading" @click="$emit('batch-login')">
        {{ batchLoading ? t('home.loginExpiredBanner.batchLoginBtnLoading') : t('home.loginExpiredBanner.batchLoginBtn') }}
      </button>
      <button class="banner-close" @click="$emit('dismiss')">✕</button>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

defineProps({
  expiredCount: { type: Number, default: 0 },
  visible: { type: Boolean, default: false },
  batchLoading: { type: Boolean, default: false },
})

defineEmits(['batch-login', 'dismiss'])

const { t } = useI18n()
</script>

<style scoped>
.login-expired-banner {
  padding: 10px 16px;
  border-radius: 10px;
  margin-bottom: var(--space-md);
  background: #fef0f0;
  border: 1px solid #fbc4c4;
}
.banner-content {
  display: flex;
  align-items: center;
  gap: 10px;
}
.banner-icon {
  font-size: 20px;
}
.banner-text {
  flex: 1;
  min-width: 0;
}
.banner-title {
  font-size: 14px;
  font-weight: 600;
  color: #c45656;
}
.banner-desc {
  font-size: 13px;
  color: #e67474;
}
.banner-hint {
  font-size: 12px;
  color: #999;
}
.banner-btn {
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: #f56c6c;
  color: #fff;
  white-space: nowrap;
}
.banner-btn:hover {
  opacity: 0.9;
}
.banner-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.banner-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--muted);
  padding: 2px 4px;
}
</style>
