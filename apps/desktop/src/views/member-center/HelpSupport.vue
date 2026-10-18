<template>
  <div class="member-center-help">
    <section class="member-center-card" data-testid="member-center-about">
      <div class="member-center-card-title">{{ t('memberCenter.aboutCardTitle') }}</div>
      <div class="member-center-about-row">
        <span class="member-center-about-label">{{ t('memberCenter.versionLabel') }}</span>
        <span data-testid="member-center-version">{{ version || '—' }}</span>
      </div>
    </section>

    <!--
      帮助与支持（UX-AUDIT 阶段 1.10 / audit-24）。
      此前这里只有一句「请联系支持团队或查阅使用文档」——本仓没有任何文档站地址，
      也没有任何入口能落到那句话上，属于典型的死胡同文案。
      本版全部指向**应用内真实存在的落点**（设置弹窗的具体 Tab / 账号页 / 日志真源），
      不引入任何编造的外链；确需外链时必须走既有受控通道（window.open →
      setWindowOpenHandler → isAllowedExternalUrl），本文件目前不需要。
    -->
    <section class="member-center-card" data-testid="member-center-help">
      <div class="member-center-card-title">{{ t('memberCenter.helpTitle') }}</div>
      <p class="member-center-empty-hint">{{ t('memberCenter.helpHint') }}</p>

      <ul class="member-center-help-entries">
        <li v-for="entry in entries" :key="entry.key">
          <button
            type="button"
            class="cohere-btn-secondary member-center-help-entry"
            :data-testid="`help-entry-${entry.key}`"
            @click="entry.run"
          >
            {{ t(entry.labelKey) }}
          </button>
          <span class="member-center-help-entry-hint">{{ t(entry.hintKey) }}</span>
        </li>
      </ul>
    </section>

    <!-- 日志区块：反馈时用户需要知道日志在哪、有多大；数据取 logs:info 真源。 -->
    <section class="member-center-card" data-testid="member-center-logs-card">
      <div class="member-center-card-title">{{ t('memberCenter.helpLogsTitle') }}</div>

      <p v-if="logs.state === 'loading'" role="status" data-testid="help-logs-loading">
        {{ t('memberCenter.helpLogsLoading') }}
      </p>

      <template v-else-if="logs.state === 'ready'">
        <p class="member-center-logs-summary" data-testid="help-logs-summary">
          {{ t('memberCenter.helpLogsSummary', { files: logs.fileCount, size: formatBytes(logs.totalBytes) }) }}
        </p>
        <div class="member-center-logs-dir">
          <span class="member-center-about-label">{{ t('memberCenter.helpLogsDirLabel') }}</span>
          <code class="member-center-logs-dir-value" data-testid="help-logs-dir">{{ logs.dir || '—' }}</code>
        </div>
        <button
          type="button"
          class="cohere-btn-secondary"
          data-testid="help-copy-logs-dir"
          :disabled="!logs.dir || copying"
          @click="copyLogsDir"
        >
          {{ t('memberCenter.helpCopyDir') }}
        </button>
      </template>

      <!-- 取不到就如实说取不到 + 给重试；不得显示 0 个文件冒充「没有日志」 -->
      <div v-else class="member-center-logs-error" role="alert" data-testid="help-logs-error">
        <span>{{ t('memberCenter.helpLogsUnavailable') }}</span>
        <button type="button" class="cohere-btn-secondary" data-testid="help-logs-retry" @click="loadLogs">
          {{ t('memberCenter.helpLogsRetry') }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { logsGetInfo } from '@/api/publisher'
import { getApi } from '@/api/electron-bridge'
import { requestSettingsDialog } from '@/stores/settings-dialog'
import { useNotify } from '@/composables/useNotify'
import { formatBytes } from '@/utils/bytes'
import { writeClipboard } from '@/utils/clipboard'

const { t } = useI18n()
const router = useRouter()
const { notifySuccess, notifyError } = useNotify()

const version = ref('')
const copying = ref(false)
const logs = ref({ state: 'loading', dir: '', totalBytes: 0, fileCount: 0 })

const entries = computed(() => [
  {
    key: 'feedback',
    labelKey: 'memberCenter.helpFeedback',
    hintKey: 'memberCenter.helpFeedbackHint',
    run: () => requestSettingsDialog('general'),
  },
  {
    key: 'model',
    labelKey: 'memberCenter.helpModelConfig',
    hintKey: 'memberCenter.helpModelConfigHint',
    run: () => requestSettingsDialog('model'),
  },
  {
    key: 'accounts',
    labelKey: 'memberCenter.helpAccounts',
    hintKey: 'memberCenter.helpAccountsHint',
    run: () => router.push('/accounts'),
  },
])

async function loadLogs () {
  logs.value = { ...logs.value, state: 'loading' }
  try {
    const res = await logsGetInfo()
    if (res && res.code === 0 && res.data) {
      logs.value = {
        state: 'ready',
        dir: res.data.dir || '',
        totalBytes: Number.isFinite(res.data.totalBytes) ? res.data.totalBytes : 0,
        fileCount: Number.isFinite(res.data.fileCount) ? res.data.fileCount : 0,
      }
      return
    }
    logs.value = { ...logs.value, state: 'error' }
  } catch {
    logs.value = { ...logs.value, state: 'error' }
  }
}

async function copyLogsDir () {
  if (!logs.value.dir) return
  copying.value = true
  try {
    const ok = await writeClipboard(logs.value.dir)
    if (ok) notifySuccess('memberCenter.helpCopied')
    else notifyError('memberCenter.helpCopyFailed')
  } catch {
    notifyError('memberCenter.helpCopyFailed')
  } finally {
    copying.value = false
  }
}

onMounted(async () => {
  loadLogs()
  const api = getApi()
  if (api && typeof api.getVersion === 'function') {
    try {
      const res = await api.getVersion()
      if (res && res.code === 0 && res.data) version.value = String(res.data)
    } catch {
      version.value = ''
    }
  }
})
</script>

<style scoped>
.member-center-help-entries {
  margin: var(--space-md) 0 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.member-center-help-entries li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}
.member-center-help-entry-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted, var(--muted));
}
.member-center-logs-dir {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: var(--space-sm) 0;
}
.member-center-logs-dir-value {
  font-size: var(--font-size-xs);
  word-break: break-all;
}
.member-center-logs-error {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
</style>
