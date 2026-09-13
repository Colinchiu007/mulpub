<template>
  <!-- 更新通知弹窗 (保留原始逻辑) -->
  <UiModal
    :visible="showUpdateDialog"
    title="📦 发现新版本"
    size="sm"
    @close="showUpdateDialog = false"
  >
    <div v-if="updateStatus === 'available'">
      <p>新版本 <strong>{{ updateInfo?.version }}</strong> 可用</p>
      <div style="display:flex;gap:8px;margin-top:16px">
        <UiButton @click="handleDownload" :disabled="downloading">
          {{ downloading ? '下载中...' : '下载更新' }}
        </UiButton>
      </div>
    </div>
    <div v-else-if="updateStatus === 'downloading'" style="text-align:center">
      <p>正在下载更新...</p>
      <div class="update-progress-bar">
        <div class="update-progress-fill" :style="{ width: downloadPercent + '%' }"></div>
      </div>
      <p class="update-speed">{{ downloadSpeed }}</p>
    </div>
    <div v-else-if="updateStatus === 'downloaded'">
      <p>✅ 更新已下载完成</p>
      <div style="display:flex;gap:8px;margin-top:16px">
        <UiButton @click="handleInstall">立即重启安装</UiButton>
      </div>
    </div>
  </UiModal>

  <!-- 前台通知条 -->
  <div
    v-if="updateStatus === 'not-available' && showNotAvailable"
    style="position: fixed; bottom: 16px; right: 88px; z-index: 2000"
  >
    <div class="ui-toast ui-toast-success">✅ 当前已是最新版本</div>
  </div>
  <div
    v-if="updateStatus === 'error' && showError"
    style="position: fixed; bottom: 16px; right: 88px; z-index: 2000"
  >
    <el-alert :title="'更新失败: ' + updateError" type="warning" show-icon :closable="true" @close="showError = false" />
  </div>
</template>

<script setup>
import UiButton from './UiButton.vue'
import UiModal from './UiModal.vue'
import { onMounted, onBeforeUnmount } from 'vue'
import { useAutoUpdate } from '@/composables/useAutoUpdate'

const {
  showUpdateDialog,
  updateStatus,
  updateInfo,
  downloading,
  downloadPercent,
  downloadSpeed,
  showNotAvailable,
  showError,
  updateError,
  handleDownload,
  handleInstall,
  start: startAutoUpdate,
  cleanup: cleanupAutoUpdate,
} = useAutoUpdate()

onMounted(() => {
  startAutoUpdate()
})

onBeforeUnmount(() => {
  cleanupAutoUpdate()
})
</script>

<style>
.update-speed {
  font-size: 12px;
  color: var(--text-muted, #7c7c9a);
}

/* Custom progress bar (replaces el-progress) */
.update-progress-bar {
  width: 100%;
  height: 8px;
  background: var(--border-light);
  border-radius: 4px;
  overflow: hidden;
  margin: 12px 0;
}
.update-progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 4px;
  transition: width 300ms ease-out;
}

/* Toast notifications (replaces el-alert) */
.ui-toast {
  padding: 12px 16px;
  border-radius: var(--r-sm, 8px);
  font-size: 13px;
  font-weight: 500;
}
.ui-toast-success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
.ui-toast-warning { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
</style>
