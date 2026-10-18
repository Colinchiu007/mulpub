<template>
  <section class="hotkeys-section" data-testid="hotkeys-section" role="region" :aria-label="t('hotkeys.title')">
    <div class="hotkeys-head">
      <div class="hotkeys-title">{{ t('hotkeys.title') }}</div>
      <div class="hotkeys-subtitle">{{ t('hotkeys.subtitle') }}</div>
    </div>

    <!-- 三态齐挂：加载期不渲染表格（防假空态闪烁，audit-40 同族），
         失败/不可用给 role="alert" + 重试出口，不把主进程故障读成「没有快捷键」 -->
    <p v-if="loading" class="hotkeys-loading" role="status" data-testid="hotkeys-loading">
      {{ t('hotkeys.loading') }}
    </p>
    <div v-else-if="errorText" class="hotkeys-error" role="alert" data-testid="hotkeys-error">
      <span class="hotkeys-error-text">{{ errorText }}</span>
      <UiButton variant="secondary" size="sm" data-testid="hotkeys-retry" @click="load">
        {{ t('hotkeys.retry') }}
      </UiButton>
    </div>
    <table v-else class="hotkeys-table" data-testid="hotkeys-table">
      <caption class="hotkeys-caption">{{ t('hotkeys.title') }}</caption>
      <thead>
        <tr>
          <th scope="col">{{ t('hotkeys.colKeys') }}</th>
          <th scope="col">{{ t('hotkeys.colAction') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.accelerator" data-testid="hotkeys-row">
          <th scope="row"><kbd class="hotkeys-kbd">{{ row.keys }}</kbd></th>
          <td>{{ row.action }}</td>
        </tr>
      </tbody>
    </table>

    <p class="hotkeys-hint">{{ t('hotkeys.customizeHint') }}</p>
  </section>
</template>

<script setup>
/**
 * 设置页「快捷键」面板（UX-AUDIT-2026-10-17 阶段 1.6 / audit-10）
 *
 * 数据源是现成的 `hotkeys:list` IPC（主进程 electron/services/hotkeys.js 的 SHORTCUTS 单点持有），
 * 此前渲染端**零消费点** —— 用户看不到自己有哪些全局键位，也无从发现键位与用途不符。
 * 面板只做只读展示：主进程不提供写路径，因此这里不假装可以改键（假装的控件比没有控件更伤）。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@/api/electron-bridge'
import { formatAccelerator } from '@/utils/accelerator-format'
import UiButton from '@/components/UiButton.vue'

const { t } = useI18n()

const loading = ref(true)
const failed = ref(false)
const items = ref([])

const platform = computed(() => {
  const nav = typeof navigator !== 'undefined' ? navigator : {}
  const hint = String(nav.platform || nav.userAgent || '')
  return /Mac|iPhone|iPad/.test(hint) ? 'darwin' : 'win32'
})

const errorText = computed(() => (failed.value ? t('hotkeys.unavailable') : ''))

const rows = computed(() => items.value.map(item => ({
  accelerator: item.accelerator,
  keys: formatAccelerator(item.accelerator, platform.value),
  // labelKey 缺失时如实退回主进程 label 并出声告警：静默兜底会让「表里写的和按出来的不一样」
  // 永久看不见（audit-16 同族：非 error 级的未命中必须出声）。
  action: actionOf(item),
})))

function actionOf (item) {
  if (item && typeof item.labelKey === 'string' && item.labelKey) return t(item.labelKey)
  console.warn('[hotkeys] 缺少 labelKey，退回主进程中文标签：', item && item.accelerator)
  return item ? item.label : ''
}

async function load () {
  loading.value = true
  failed.value = false
  try {
    const api = getApi()
    if (!api || typeof api.hotkeysList !== 'function') {
      items.value = []
      failed.value = true
      return
    }
    const res = await api.hotkeysList()
    const list = res && res.code === 0 && Array.isArray(res.data) ? res.data : null
    if (!list || list.length === 0) {
      items.value = []
      failed.value = true
      return
    }
    items.value = list
  } catch {
    items.value = []
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => { load() })

defineExpose({ load, items, loading, failed })
</script>

<style scoped>
.hotkeys-section {
  padding: 4px 0;
}
.hotkeys-head {
  margin-bottom: 12px;
}
.hotkeys-title {
  font-size: var(--font-size-lg, 16px);
  font-weight: 600;
  color: var(--color-text-primary, var(--text, #1d1d1f));
}
.hotkeys-subtitle {
  margin-top: 2px;
  font-size: var(--font-size-xs, 12px);
  color: var(--color-text-muted, var(--text-muted, #6b6b70));
}
.hotkeys-loading {
  margin: 8px 0;
  font-size: var(--font-size-sm, 13px);
  color: var(--color-text-muted, var(--text-muted, #8a8a8f));
}
.hotkeys-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid var(--color-border, #dcdfe6);
  border-radius: 8px;
  font-size: var(--font-size-sm, 13px);
}
.hotkeys-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm, 13px);
}
.hotkeys-caption {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.hotkeys-table th,
.hotkeys-table td {
  padding: 7px 8px;
  text-align: left;
  border-bottom: 1px solid var(--color-border, #ececef);
}
.hotkeys-table thead th {
  font-weight: 600;
  color: var(--color-text-muted, var(--text-muted, #6b6b70));
}
.hotkeys-table tbody th {
  font-weight: 500;
  width: 40%;
}
.hotkeys-kbd {
  padding: 2px 6px;
  border: 1px solid var(--color-border, #d2d2d7);
  border-radius: 5px;
  background: var(--surface-bright, #f7f7f9);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: var(--font-size-xs, 12px);
}
.hotkeys-hint {
  margin: 10px 0 0;
  font-size: var(--font-size-xs, 12px);
  color: var(--color-text-muted, var(--text-muted, #8a8a8f));
}
</style>
