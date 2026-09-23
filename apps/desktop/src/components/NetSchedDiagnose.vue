<template>
    <div class="diag-card" data-testid="net-sched-diagnose">
      <div class="diag-head">
        <div>
          <div class="diag-title">{{ t('settings.diagnose.title') }}</div>
          <div class="diag-hint">{{ t('settings.diagnose.hint') }}</div>
        </div>
        <button class="cohere-btn-secondary" :disabled="diagnoseRunning" @click="runNetSchedDiagnose">
          {{ diagnoseRunning ? t('settings.diagnose.running') : t('settings.diagnose.button') }}
        </button>
      </div>
      <div v-if="diagnoseResult" class="diag-result" :class="'diag-' + diagnoseResult.level">
        {{ diagnoseResult.text }}
      </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { rateLimitSelfCheck } from '@/api/rate-limit'

const { t } = useI18n()

// Network & scheduler diagnostics: black-box one-click. Runs the real governor
// self-check with fixed internal params and shows only a traffic-light verdict
// (never exposes the 6 scheduler parameters to end users).
const diagnoseRunning = ref(false)
const diagnoseResult = ref(null)
async function runNetSchedDiagnose () {
  diagnoseRunning.value = true
  diagnoseResult.value = null
  try {
    const res = await rateLimitSelfCheck({ rpm: 20, requestCount: 6, requestDurationMs: 80 })
    const list = (res && res.data && Array.isArray(res.data.assertions)) ? res.data.assertions : []
    const pass = list.filter(a => a && a.pass).length
    const level = list.length === 0 ? 'fail' : (pass === list.length ? 'ok' : (pass > 0 ? 'warn' : 'fail'))
    diagnoseResult.value = { level, text: t('settings.diagnose.' + level) }
  } catch {
    diagnoseResult.value = { level: 'fail', text: t('settings.diagnose.fail') }
  } finally {
    diagnoseRunning.value = false
  }
}
</script>

<style scoped>
.diag-card { border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; }
.diag-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.diag-title { font-weight: 600; }
.diag-hint { font-size: var(--font-size-xs); color: var(--el-text-color-secondary, #909399); margin-top: 4px; }
.diag-result { margin-top: 12px; font-size: var(--font-size-sm); }
.diag-ok { color: var(--el-color-success, #67c23a); }
.diag-warn { color: var(--el-color-warning, #e6a23c); }
.diag-fail { color: var(--el-color-danger, #f56c6c); }
</style>
