<template>
  <section
    v-if="items.length"
    class="risk-suspended-banner"
    data-testid="risk-suspended-banner"
    role="status"
    aria-live="polite"
  >
    <div class="risk-suspended-header">
      <span class="risk-suspended-title">
        {{ t('publish.riskHold.suspended', { count: items.length, platform: platformLabel(items[0].platform) }) }}
      </span>
    </div>
    <ul class="risk-suspended-list">
      <li
        v-for="(it) in items"
        :key="keyOf(it)"
        class="risk-suspended-item"
        data-testid="risk-suspended-item"
      >
        <span class="risk-suspended-tag">{{ platformLabel(it.platform) }}</span>
        <span v-if="it.accountId" class="risk-suspended-account">{{ it.accountId }}</span>
        <button
          type="button"
          class="risk-suspended-resume"
          :disabled="busyKeys.has(keyOf(it))"
          data-testid="risk-suspended-resume"
          @click="onResume(it)"
        >
          {{ t('publish.riskHold.resume') }}
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup>
/**
 * 风控挂起横幅（W1 §5 enforcement 消费端 · 账号列表锚点）
 * 订阅 useRiskStore 权威挂起清单，逐条展示并提供「恢复发布」入口。
 * 合规红线：恢复必须经人工确认（tracker.confirm），绝不自动恢复 / 自动换号。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRiskStore } from '@/stores/risk'
import { usePlatformStore } from '@/stores/platforms'
import { useNotify } from '@/composables/useNotify'

const { t } = useI18n()
const riskStore = useRiskStore()
const platformStore = usePlatformStore()
const { notifySuccess, notifyError } = useNotify()
const busyKeys = ref(new Set())

const items = computed(() => (Array.isArray(riskStore.suspended) ? riskStore.suspended : []))

function keyOf(it) {
  return it.platform + '::' + (it.accountId == null ? '*' : it.accountId)
}
function platformLabel(p) {
  return platformStore.getLabel(p) || p
}

// 恢复：交给 riskStore.resume（内部弹人工确认框）。取消则静默保持挂起。
async function onResume(it) {
  const k = keyOf(it)
  if (busyKeys.value.has(k)) return
  busyKeys.value = new Set(busyKeys.value).add(k)
  try {
    const res = await riskStore.resume(it.platform, it.accountId)
    if (res && res.ok) {
      notifySuccess('publish.riskHold.resumed', { params: { platform: platformLabel(it.platform) }, module: 'publish' })
    } else if (res && res.reason === 'error') {
      notifyError('publish.riskHold.resumeFailed', { params: { message: res.message || '' }, module: 'publish' })
    }
    // reason==='cancelled' / 'invalid' → 用户选择保持暂停，静默
  } finally {
    const next = new Set(busyKeys.value)
    next.delete(k)
    busyKeys.value = next
  }
}
</script>

<style scoped>
.risk-suspended-banner {
  margin: 0 0 12px;
  padding: 12px 16px;
  border: 1px solid var(--el-color-warning-light-5, #f3d19e);
  border-radius: 8px;
  background: var(--el-color-warning-light-9, #fdf6ec);
}
.risk-suspended-header {
  margin-bottom: 8px;
}
.risk-suspended-title {
  font-size: var(--font-size-sm);
  color: var(--el-color-warning, #e6a23c);
  font-weight: 600;
}
.risk-suspended-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.risk-suspended-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
}
.risk-suspended-tag {
  font-size: var(--font-size-sm);
  font-weight: 500;
}
.risk-suspended-account {
  font-size: var(--font-size-xs);
  color: var(--el-text-color-secondary, #909399);
}
.risk-suspended-resume {
  font-size: var(--font-size-xs);
  padding: 2px 10px;
  border-radius: 4px;
  border: 1px solid var(--el-color-warning, #e6a23c);
  color: var(--el-color-warning, #e6a23c);
  background: transparent;
  cursor: pointer;
}
.risk-suspended-resume:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
