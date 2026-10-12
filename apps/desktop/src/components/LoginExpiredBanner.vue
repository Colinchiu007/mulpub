<template>
  <div v-if="visible" class="login-expired-banner">
    <div class="banner-content">
      <span class="banner-icon-block" aria-hidden="true">
        <el-icon :size="18"><WarningFilled /></el-icon>
      </span>
      <div class="banner-text">
        <div class="banner-title-row">
          <span class="banner-title">{{ t('home.loginExpiredBanner.title') }}</span>
          <span class="banner-count-badge" data-testid="banner-count-badge">{{ expiredCount }}</span>
        </div>
        <div class="banner-desc">{{ t('home.loginExpiredBanner.description', { count: expiredCount }) }}</div>
        <div class="banner-hint">{{ t('home.loginExpiredBanner.hint') }}</div>
      </div>
      <button class="banner-btn banner-btn--outline" :disabled="batchLoading" @click="$emit('batch-login')">
        {{ batchLoading ? t('home.loginExpiredBanner.batchLoginBtnLoading') : t('home.loginExpiredBanner.batchLoginBtn') }}
      </button>
      <button
        v-if="unsavedCount > 0"
        class="banner-btn banner-btn--outline banner-btn--warn"
        data-testid="banner-save-all"
        @click="$emit('save-all')"
      >
        {{ t('home.loginExpiredBanner.saveAllBtnCount', { count: unsavedCount }) }}
      </button>
      <button class="banner-close" @click="$emit('dismiss')">✕</button>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { WarningFilled } from '@element-plus/icons-vue'

defineProps({
  expiredCount: { type: Number, default: 0 },
  visible: { type: Boolean, default: false },
  batchLoading: { type: Boolean, default: false },
  unsavedCount: { type: Number, default: 0 },
})

defineEmits(['batch-login', 'dismiss', 'save-all'])

const { t } = useI18n()
</script>

<style scoped>
/* 告警条模式（PRD-UI-HOME-RESTYLE §3.3）：
 * 图标方块 + 标题/计数徽章 + 说明 + 描边操作按钮；颜色全部走 token，
 * 浅红底/深红字保证亮暗两套主题可读（soft 槽已含暗色覆盖）。 */
.login-expired-banner {
  padding: 12px 16px;
  border-radius: var(--radius-md);
  margin-bottom: var(--space-md);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
}
.banner-content {
  display: flex;
  align-items: center;
  gap: 12px;
}
.banner-icon-block {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--color-danger);
  color: var(--color-on-primary);
  flex: 0 0 auto;
}
.banner-text {
  flex: 1;
  min-width: 0;
}
.banner-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.banner-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-danger);
}
.banner-count-badge {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--color-danger);
  color: var(--color-on-primary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.banner-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}
.banner-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
/* 描边式告警按钮：与背景同色系描边，hover 实底化（非默认实心红） */
.banner-btn {
  padding: 6px 14px;
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--color-danger);
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}
.banner-btn:hover {
  background: var(--color-danger);
  color: var(--color-on-primary);
}
.banner-btn--warn {
  border-color: var(--color-warning);
  color: var(--color-text-primary);
}
.banner-btn--warn:hover {
  background: var(--color-warning);
  color: var(--color-text-primary);
}
.banner-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.banner-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  padding: 2px 4px;
}
</style>
