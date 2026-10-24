<template>
  <div class="hotkeys" data-testid="hotkeys-settings">
    <h3 class="hotkeys__title">{{ t('settings.hotkeys.title') }}</h3>
    <p class="hotkeys__hint">{{ t('settings.hotkeys.hint') }}</p>

    <el-alert
      v-if="state === 'error'"
      type="error"
      :closable="false"
      show-icon
      :title="errorText"
      data-testid="hotkeys-error"
    />
    <p v-else-if="state === 'unavailable'" class="hotkeys__state" data-testid="hotkeys-unavailable">
      {{ t('settings.hotkeys.unavailable') }}
    </p>
    <p v-else-if="state === 'loading'" class="hotkeys__state" data-testid="hotkeys-loading">
      {{ t('settings.hotkeys.loading') }}
    </p>
    <p v-else-if="rows.length === 0" class="hotkeys__state" data-testid="hotkeys-empty">
      {{ t('settings.hotkeys.empty') }}
    </p>
    <!-- 表头常驻：读屏在行间移动时能报出「组合键 / 动作」，而不是只念出一串符号 -->
    <table v-else class="hotkeys__table" data-testid="hotkeys-table">
      <thead>
        <tr>
          <th scope="col">{{ t('settings.hotkeys.colKeys') }}</th>
          <th scope="col">{{ t('settings.hotkeys.colAction') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key" data-testid="hotkeys-row" :data-mapped="row.actionKey ? 'true' : 'false'">
          <td><kbd class="hotkeys__kbd" data-testid="hotkeys-combo">{{ row.combo }}</kbd></td>
          <!-- 展示名只走 locales；未登记项回显原始 route（不显示主进程那份中文 label，
               也不编一个看着像真名的词）。data-mapped=false 让"忘了补文案"在 DOM 上可检。 -->
          <td data-testid="hotkeys-action">{{ row.actionKey ? t(row.actionKey) : row.rawLabel }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
/**
 * HotkeysSettings —— 设置页的「快捷键」面板（UX 审计 1.6）
 *
 * 此前主进程 `hotkeys:list` 与 preload `hotkeysList` 早已就位且登记在 PUBLIC_METHODS，
 * 但渲染端零消费方 —— 一套全局快捷键在系统层生效，用户在界面里却一条都查不到。
 * 展示口径（平台化组合键 / locales 键化 / 未登记回显）全部收在 `@/utils/hotkey-labels`，
 * 与主进程快捷键表逐项对齐由 `hotkey-labels.test.js` 的跨包锁守住。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElAlert } from 'element-plus'
import { getApi } from '@/api/electron-bridge'
import { normalizeHotkeyList } from '@/utils/hotkey-labels.js'

const { t } = useI18n()
/**
 * `isMac` 是**可注入的平台档**（QM-6 i1 的处置）：默认 null 表示"按宿主探测"，
 * 测试必须显式传 `false`/`true`。原因：组件内 `detectMac()` 读 `navigator.platform`，
 * 而用例把 `'Ctrl + Alt + P'` 写死 ⇒ 换到 mac runner 上这些断言整片变红，
 * 反证驱动也会以「基线不干净」退出，12 道变异全部不可归因。
 * 注入点让"平台差异"变成用例可控的变量，而不是 runner 的属性。
 */
const props = defineProps({
  isMac: { type: Boolean, default: null },
})
const rows = ref([])
const state = ref('loading')

const errorText = computed(() => t('settings.hotkeys.loadFailed'))

function detectMac () {
  if (typeof navigator === 'undefined') return false
  const probe = `${navigator.platform || ''} ${navigator.userAgent || ''}`
  return /Mac|iPhone|iPad|iPod/.test(probe)
}

onMounted(async () => {
  const api = getApi()
  if (!api || typeof api.hotkeysList !== 'function') {
    state.value = 'unavailable'
    return
  }
  try {
    const res = await api.hotkeysList()
    if (!res || res.code !== 0 || !Array.isArray(res.data)) {
      state.value = 'error'
      return
    }
    rows.value = normalizeHotkeyList(res.data, {
      isMac: props.isMac === null ? detectMac() : props.isMac,
    })
    state.value = 'ready'
    const unmapped = rows.value.filter((row) => !row.actionKey)
    if (unmapped.length > 0) {
      console.warn(`[hotkeys] ${unmapped.length} shortcut(s) have no localized label; rendering raw route`)
    }
  } catch (error) {
    console.warn('[hotkeys] hotkeys:list failed', error)
    state.value = 'error'
  }
})
</script>

<style scoped>
.hotkeys {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hotkeys__title {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text-strong);
}

.hotkeys__hint,
.hotkeys__state {
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--color-text-muted);
}

.hotkeys__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.hotkeys__table th {
  padding: 6px 10px;
  text-align: left;
  font-weight: 600;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}

.hotkeys__table td {
  padding: 6px 10px;
  color: var(--color-text-strong);
  border-bottom: 1px solid var(--color-border);
}

.hotkeys__kbd {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--font-size-xs);
  color: var(--color-text-strong);
  background: var(--color-surface-sunken);
  white-space: nowrap;
}
</style>
