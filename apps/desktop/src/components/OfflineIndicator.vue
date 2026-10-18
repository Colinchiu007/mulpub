<template>
  <!-- 阶段 1.7（audit-7）：横幅由三条通道驱动，断网即时可见；文案入 locales（此前是硬编码中文 + emoji） -->
  <div v-if="isOffline" class="offline-banner" role="alert" data-testid="offline-banner">
    <span class="offline-banner-text">{{ t('common.offlineBanner') }}</span>
    <span v-if="cachedTaskCount > 0" class="offline-banner-count" data-testid="offline-cached-count">
      {{ t('common.offlineCachedCount', { count: cachedTaskCount }) }}
    </span>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOfflineStatus } from '@/composables/useOfflineStatus'

const { t } = useI18n()
const { isOffline, cachedTaskCount, init, dispose } = useOfflineStatus()

onMounted(() => { init() })
// 监听必须成对释放（AGENTS.md：全局单例事件监听器生命周期）；
// 本组件随 App 常驻，释放点在异常卸载/测试重挂载上生效。
onBeforeUnmount(() => { dispose() })
</script>

<style>
/* Offline banner */
.offline-banner {
  background: #fef3c7;
  border-bottom: 1px solid #fbbf24;
  padding: 8px 16px;
  font-size: var(--font-size-sm);
  color: #92400e;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  animation: slideDown 0.3s ease-out;
}
@keyframes slideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* 暗色档：原实现只有浅色底色，进入暗色后这块横幅会以高饱和浅黄压在深色界面上。
   暗色不是新的设计决定，只是把同一语义（警示）换一档色板。 */
html[data-theme='dark'] .offline-banner {
  background: #3a2a08;
  border-bottom-color: #8a6d1f;
  color: #f5d98b;
}

.offline-banner-count {
  font-weight: 600;
}
</style>
