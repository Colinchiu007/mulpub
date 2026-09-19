<template>
  <!-- 离线提示 -->
  <div v-if="isOffline" class="offline-banner">
    <span>📡 网络已断开 — 发布任务将被缓存，网络恢复后自动重试</span>
    <span v-if="cachedTaskCount > 0" style="margin-left:8px;font-weight:600">({{ cachedTaskCount }} 个待发布)</span>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useOfflineStatus } from '@/composables/useOfflineStatus'

const { isOffline, cachedTaskCount, init: initOfflineStatus } = useOfflineStatus()

onMounted(() => {
  initOfflineStatus()
})
</script>

<style>
/* Offline banner */
.offline-banner {
  background: #fef3c7;
  border-bottom: 1px solid #fbbf24;
  padding: 8px 16px;
  font-size: 13px;
  color: #92400e;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: slideDown 0.3s ease-out;
}
@keyframes slideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
</style>
