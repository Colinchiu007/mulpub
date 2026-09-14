<template>
  <el-popover
    placement="top-start"
    :width="280"
    trigger="hover"
    :show-after="200"
    popper-class="mp-service-popover"
  >
    <template #reference>
      <span
        class="mp-service-status"
        :class="summaryClass"
        data-testid="mp-service-status"
        role="button"
        tabindex="0"
        aria-haspopup="dialog"
      >
        <i aria-hidden="true"></i>{{ summaryLabel }}
      </span>
    </template>
    <div class="mp-service-list" data-testid="mp-service-list">
      <div v-if="serviceStatusStore.unavailable" class="mp-service-unavailable">
        {{ t('sidebar.serviceStatus.unavailable') }}
      </div>
      <template v-else>
        <div
          v-for="svc in serviceStatusStore.services"
          :key="svc.key"
          class="mp-service-item"
          :data-testid="'mp-service-' + svc.key"
        >
          <i class="mp-service-dot" :class="'is-' + svc.status" aria-hidden="true"></i>
          <span class="mp-service-name">{{ serviceLabel(svc) }}</span>
          <span class="mp-service-state">{{ serviceStateLabel(svc.status) }}</span>
        </div>
      </template>
    </div>
  </el-popover>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useServiceStatusStore } from '@/stores/serviceStatus'

const { t } = useI18n()
const serviceStatusStore = useServiceStatusStore()

onMounted(() => { serviceStatusStore.startPolling() })
onUnmounted(() => { serviceStatusStore.stopPolling() })

const summaryLabel = computed(() => {
  if (serviceStatusStore.unavailable) return t('sidebar.serviceStatus.unavailable')
  if (serviceStatusStore.allRunning) return t('sidebar.serviceStatus.allRunning')
  return t('sidebar.serviceStatus.partialRunning', { count: serviceStatusStore.runningCount })
})

const summaryClass = computed(() => serviceStatusStore.allRunning && !serviceStatusStore.unavailable ? 'is-ok' : 'is-degraded')

function serviceLabel (svc) {
  const key = 'sidebar.serviceStatus.services.' + svc.key
  const label = t(key)
  return label === key ? svc.name : label
}

function serviceStateLabel (status) {
  return t('sidebar.serviceStatus.states.' + status)
}
</script>

<style scoped>
.mp-service-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #6f9c6f;
  cursor: default;
}

.mp-service-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6fbf73;
}

.mp-service-status.is-degraded {
  color: #b08a3e;
}

.mp-service-status.is-degraded i {
  background: #e6a23c;
}
</style>

<style>
/* el-popover 渲染在 body 下，scoped 样式无法命中，需全局样式（mp- 命名空间防冲突） */
.mp-service-popover .mp-service-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mp-service-popover .mp-service-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #5a5c73;
}

.mp-service-popover .mp-service-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.mp-service-popover .mp-service-dot.is-running {
  background: #6fbf73;
}

.mp-service-popover .mp-service-dot.is-stopped {
  background: #f56c6c;
}

.mp-service-popover .mp-service-dot.is-standby {
  background: #c0c2cf;
}

.mp-service-popover .mp-service-state {
  margin-left: auto;
  color: #9294ab;
}

.mp-service-popover .mp-service-unavailable {
  font-size: 12px;
  color: #b08a3e;
}
</style>
