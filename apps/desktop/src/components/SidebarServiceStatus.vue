<template>
  <el-popover
    v-model:visible="opened"
    placement="top-start"
    :width="300"
    trigger="click"
    popper-class="mp-service-popover"
  >
    <template #reference>
      <span
        class="mp-service-status"
        :class="summaryClass"
        data-testid="mp-service-status"
        role="button"
        tabindex="0"
        aria-haspopup="true"
        :aria-expanded="String(opened)"
        :aria-label="summaryLabel"
      >
        <i aria-hidden="true"></i>{{ summaryLabel }}
      </span>
    </template>
    <div
      class="mp-service-list"
      data-testid="mp-service-list"
      :aria-busy="String(serviceStatusStore.unavailable)"
    >
      <div v-if="serviceStatusStore.unavailable" class="mp-service-unavailable">
        {{ t('sidebar.serviceStatus.unavailable') }}
      </div>
      <template v-else>
        <div
          v-for="svc in serviceStatusStore.services"
          :key="svc.key"
          class="mp-service-row"
        >
          <button
            type="button"
            class="mp-service-item"
            :class="{ 'is-expanded': expandedKey === svc.key }"
            :data-testid="'mp-service-' + svc.key"
            :aria-expanded="String(expandedKey === svc.key)"
            @click="toggle(svc)"
          >
            <i class="mp-service-dot" :class="'is-' + svc.status" aria-hidden="true"></i>
            <span class="mp-service-name">{{ serviceLabel(svc) }}</span>
            <span class="mp-service-state">{{ serviceStateLabel(svc) }}</span>
          </button>

          <div
            v-if="expandedKey === svc.key"
            class="mp-service-detail"
            :data-testid="'mp-service-detail-' + svc.key"
          >
            <p class="mp-service-reason">{{ reasonLabel(svc) }}</p>
            <p v-if="lastSeenLabel(svc)" class="mp-service-since">
              {{ lastSeenLabel(svc) }}
            </p>
            <p v-if="restartError" class="mp-service-error">{{ restartError }}</p>
            <button
              v-if="svc.restartable && svc.status !== 'running'"
              type="button"
              class="mp-service-retry"
              :disabled="!!serviceStatusStore.restarting[svc.key]"
              :data-testid="'mp-service-retry-' + svc.key"
              @click.stop="onRestart(svc)"
            >
              {{ serviceStatusStore.restarting[svc.key]
                ? t('sidebar.serviceStatus.retrying')
                : t('sidebar.serviceStatus.retry') }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </el-popover>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useServiceStatusStore } from '@/stores/serviceStatus'

const { t, te } = useI18n()
const serviceStatusStore = useServiceStatusStore()

const expandedKey = ref('')
const opened = ref(false)
const restartError = ref('')

onMounted(() => { serviceStatusStore.startPolling() })
onUnmounted(() => { serviceStatusStore.stopPolling() })

const summaryLabel = computed(() => {
  if (serviceStatusStore.unavailable) return t('sidebar.serviceStatus.unavailable')
  if (serviceStatusStore.allRunning) return t('sidebar.serviceStatus.allRunning')
  if (serviceStatusStore.stoppedCount > 0) {
    return t('sidebar.serviceStatus.degradedSummary', {
      stopped: serviceStatusStore.stoppedCount,
      running: serviceStatusStore.runningCount,
      total: serviceStatusStore.services.length,
    })
  }
  return t('sidebar.serviceStatus.partialRunning', { count: serviceStatusStore.runningCount })
})

const summaryClass = computed(() => serviceStatusStore.allRunning && !serviceStatusStore.unavailable ? 'is-ok' : 'is-degraded')

function serviceLabel (svc) {
  const key = 'sidebar.serviceStatus.services.' + svc.key
  const label = t(key)
  return label === key ? svc.name : label
}

function serviceStateLabel (svc) {
  // 按需服务（如对齐引擎）显示「按需」，避免「待命」被误读为随时可用
  if (svc.onDemand) return t('sidebar.serviceStatus.states.onDemand')
  return t('sidebar.serviceStatus.states.' + svc.status)
}

/** IPC 返回的 reason 为 snake_case，i18n key 统一为 camelCase */
const REASON_KEY = {
  ok: 'ok',
  not_started: 'notStarted',
  on_demand: 'onDemand',
  connection_refused: 'connectionRefused',
  timeout: 'timeout',
  http_error: 'httpError',
  unhealthy: 'unhealthy',
  unknown: 'unknown',
}

function reasonLabel (svc) {
  const key = 'sidebar.serviceStatus.reasons.' + (REASON_KEY[svc.reason] || 'unknown')
  return te(key) ? t(key) : t('sidebar.serviceStatus.reasons.unknown')
}

function lastSeenLabel (svc) {
  if (svc.status === 'running') return ''
  const ts = serviceStatusStore.lastSeenRunning[svc.key]
  if (!Number.isFinite(ts)) return ''
  return t('sidebar.serviceStatus.lastSeen', { time: formatTime(ts) })
}

function formatTime (ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

function toggle (svc) {
  restartError.value = ''
  expandedKey.value = expandedKey.value === svc.key ? '' : svc.key
}

async function onRestart (svc) {
  restartError.value = ''
  const result = await serviceStatusStore.restart(svc.key)
  if (!result.ok) {
    const key = 'sidebar.serviceStatus.restartErrors.' + result.message
    restartError.value = te(key) ? t(key) : t('sidebar.serviceStatus.restartErrors.fallback')
  }
}
</script>

<style scoped>
.mp-service-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #6f9c6f;
  cursor: pointer;
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

@media (prefers-reduced-motion: no-preference) {
  .mp-service-status.is-degraded i {
    animation: mp-service-pulse 1.8s ease-in-out infinite;
  }
}

@keyframes mp-service-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>

<style>
/* el-popover 渲染在 body 下，scoped 样式无法命中，需全局样式（mp- 命名空间防冲突） */
.mp-service-popover .mp-service-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mp-service-popover .mp-service-row {
  display: flex;
  flex-direction: column;
}

.mp-service-popover .mp-service-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-family: inherit;
  font-size: var(--font-size-xs);
  color: #5a5c73;
  text-align: left;
  cursor: pointer;
}

.mp-service-popover .mp-service-item:hover,
.mp-service-popover .mp-service-item.is-expanded {
  background: rgba(0, 0, 0, 0.04);
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

.mp-service-popover .mp-service-detail {
  margin: 2px 0 6px 21px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.03);
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: #5a5c73;
}

.mp-service-popover .mp-service-reason {
  margin: 0;
}

.mp-service-popover .mp-service-since {
  margin: 2px 0 0;
  color: #9294ab;
}

.mp-service-popover .mp-service-error {
  margin: 4px 0 0;
  color: #f56c6c;
}

.mp-service-popover .mp-service-retry {
  margin-top: 6px;
  padding: 3px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  font-family: inherit;
  font-size: var(--font-size-xs);
  color: #5a5c73;
  cursor: pointer;
}

.mp-service-popover .mp-service-retry:hover:not(:disabled) {
  border-color: #b08a3e;
  color: #b08a3e;
}

.mp-service-popover .mp-service-retry:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.mp-service-popover .mp-service-unavailable {
  font-size: var(--font-size-xs);
  color: #b08a3e;
}
</style>
