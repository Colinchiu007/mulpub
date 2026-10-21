<template>
  <!-- 离线横幅：role=status + aria-live=polite，断网/恢复都要被读屏播报（WCAG 4.1.3） -->
  <div v-if="isOffline" class="offline-banner" role="status" aria-live="polite" data-testid="offline-banner">
    <span class="offline-banner__icon" aria-hidden="true">📡</span>
    <span class="offline-banner__text">{{ t('common.offlineBanner') }}</span>
    <span v-if="cachedTaskCount > 0" class="offline-banner__count">{{ t('common.offlinePendingCount', { count: cachedTaskCount }) }}</span>
  </div>
</template>

<script setup>
/**
 * OfflineIndicator — 离线横幅（UX 审计 1.7 整改）
 *
 * 本次改掉的四件事（原先每一条都在"功能已建成但用户看不到"的同一条链上）：
 *  1. 实时性由 `useOfflineStatus` 的浏览器 online/offline 监听提供，卸载时成对 dispose；
 *  2. 文案不再硬编码中文（原 `📡 网络已断开 — 发布任务将被缓存…` 直接写在模板里，
 *     英文用户看到的是中文），改走 `common.*`；图标与文字分离，图标 `aria-hidden`；
 *  3. 颜色不再硬编码 `#fef3c7/#fbbf24/#92400e`（暗色档下那块浅奶油底会把整条横幅变成
 *     「亮色补丁」），改走 `--color-warning-soft / --color-warning-border / --color-warning-ink`，
 *     两档都在 tokens.css 里显式声明；
 *  4. 入场动画补 `prefers-reduced-motion` 守卫（本仓既有范式）。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOfflineStatus } from '@/composables/useOfflineStatus'

const { t } = useI18n()
const { isOffline, cachedTaskCount, init: initOfflineStatus, dispose: disposeOfflineStatus } = useOfflineStatus()

onMounted(() => {
  initOfflineStatus()
})
onBeforeUnmount(() => {
  disposeOfflineStatus()
})
</script>

<style scoped>
/* Offline banner */
.offline-banner {
  background: var(--color-warning-soft);
  border-bottom: 1px solid var(--color-warning);
  padding: 8px 16px;
  font-size: var(--font-size-sm);
  color: var(--color-warning-ink);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  animation: offlineSlideDown 0.3s ease-out;
}

.offline-banner__count {
  margin-left: 8px;
  font-weight: 600;
}

@keyframes offlineSlideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .offline-banner {
    animation: none;
  }
}
</style>
