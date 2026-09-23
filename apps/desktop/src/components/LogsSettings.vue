<template>
  <div class="logs-settings">
    <!-- 页面头部 -->
    <div class="cohere-page-header">
      <div>
        <div class="page-title">{{ t('settings.logs.title') }}</div>
        <div class="page-subtitle">{{ t('settings.logs.subtitle') }}</div>
      </div>
      <div class="page-actions">
        <button class="cohere-btn-secondary" :disabled="loading" @click="loadInfo">⟳ {{ t('common.refresh') }}</button>
        <button class="clear-btn" :disabled="!info.fileCount || clearing" @click="clearLogs">
          {{ clearing ? t('common.loading') : t('settings.logs.clearBtn') }}
        </button>
      </div>
    </div>

    <!-- 语言设置 -->
    <div class="lang-section" role="group" :aria-label="t('settings.langAria')">
      <div class="lang-row">
        <div class="lang-meta">
          <div class="lang-title">{{ t('settings.language') }}</div>
          <div class="lang-hint">{{ t('settings.langHint') }}</div>
        </div>
        <select class="lang-select" :value="localeModel" data-testid="locale-select" @change="changeLocale">
          <option value="zh">{{ t('settings.langZh') }}</option>
          <option value="en">{{ t('settings.langEn') }}</option>
        </select>
      </div>
    </div>

    <!-- 自动清理提示 -->
    <div class="log-hint" role="note">
      <span class="hint-icon">ℹ️</span>
      {{ t('settings.logs.autoClearHint') }}
    </div>

    <NetSchedDiagnose />

    <!-- 摘要卡片 -->
    <div class="log-summary">
      <div class="summary-row">
        <span class="summary-label">{{ t('settings.logs.dirLabel') }}</span>
        <span class="summary-value log-dir" :title="info.dir">{{ info.dir || '—' }}</span>
      </div>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">{{ t('settings.logs.fileCount') }}</div>
          <div class="summary-value">{{ info.fileCount }}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">{{ t('settings.logs.totalSize') }}</div>
          <div class="summary-value">{{ formatBytes(info.totalBytes) }}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">{{ t('settings.logs.maxSize') }}</div>
          <div class="summary-value">{{ formatBytes(info.maxFileBytes) }}</div>
        </div>
      </div>
    </div>

    <!-- 文件列表 -->
    <div class="log-file-list">
      <div v-if="loading" class="log-empty" data-testid="logs-loading">
        <UiSkeleton variant="list" :count="4" />
      </div>
      <div v-else-if="!info.fileCount" class="log-empty">{{ t('settings.logs.empty') }}</div>
      <div v-else>
        <div v-for="file in info.files" :key="file.name" class="log-file-row">
          <span class="file-name">{{ file.name }}</span>
          <span class="file-size">{{ formatBytes(file.size) }}</span>
        </div>
      </div>
    </div>

    <!-- 缓存清理（独立组件：逐文件行数门禁下的自包含卡片拆分范式） -->
    <CacheCleanupSection />

    <section class="feedback-section" aria-labelledby="feedback-title">
      <div class="feedback-header">
        <div>
          <div id="feedback-title" class="feedback-title">{{ t('settings.feedback.title') }}</div>
          <div class="feedback-subtitle">{{ t('settings.feedback.subtitle') }}</div>
        </div>
      </div>
      <form class="feedback-form" @submit.prevent="submitFeedback">
        <label class="feedback-label" for="feedback-message">{{ t('settings.feedback.label') }}</label>
        <textarea
          id="feedback-message"
          v-model="feedbackMessage"
          class="feedback-textarea"
          :placeholder="t('settings.feedback.placeholder')"
          maxlength="10000"
          rows="5"
          :disabled="submittingFeedback"
        ></textarea>
        <div class="feedback-count">{{ feedbackMessage.length }}/10000</div>
        <label class="feedback-checkbox">
          <input v-model="includeFeedbackLogs" type="checkbox" :disabled="submittingFeedback">
          <span>{{ t('settings.feedback.attachLogs') }}</span>
        </label>
        <div class="feedback-log-hint">{{ t('settings.feedback.attachLogsHint') }}</div>
        <div v-if="feedbackError" class="feedback-message feedback-error" role="alert">{{ feedbackError }}</div>
        <div v-if="feedbackSuccess" class="feedback-message feedback-success" role="status">{{ feedbackSuccess }}</div>
        <div class="feedback-actions">
          <button class="cohere-btn-primary" type="submit" :disabled="submittingFeedback">
            {{ submittingFeedback ? t('settings.feedback.submitting') : t('settings.feedback.submit') }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { logsGetInfo, logsClear, submitFeedback as submitFeedbackRequest } from '@/api/publisher'
import { getAppLocale, setAppLocale } from '@/i18n'
import NetSchedDiagnose from './NetSchedDiagnose.vue'
import CacheCleanupSection from './CacheCleanupSection.vue'
import { formatBytes } from '@/utils/bytes'

const { t } = useI18n()

const loading = ref(false)
const clearing = ref(false)
const info = reactive({ dir: '', totalBytes: 0, fileCount: 0, maxFileBytes: 0, files: [] })
const localeModel = ref(getAppLocale())
const feedbackMessage = ref('')
const includeFeedbackLogs = ref(false)
const submittingFeedback = ref(false)
const feedbackError = ref('')
const feedbackSuccess = ref('')

function changeLocale (event) {
  localeModel.value = setAppLocale(event && event.target && event.target.value === 'en' ? 'en' : 'zh')
}

async function loadInfo () {
  loading.value = true
  try {
    const result = await logsGetInfo()
    if (result && result.code === 0 && result.data) {
      info.dir = result.data.dir || ''
      info.totalBytes = result.data.totalBytes || 0
      info.fileCount = result.data.fileCount || 0
      info.maxFileBytes = result.data.maxFileBytes || 0
      info.files = Array.isArray(result.data.files) ? result.data.files : []
    }
  } finally {
    loading.value = false
  }
}

async function clearLogs () {
  if (clearing.value) return
  clearing.value = true
  try {
    const result = await logsClear()
    if (result && result.code === 0) {
      await loadInfo()
    }
  } finally {
    clearing.value = false
  }
}

async function submitFeedback () {
  if (submittingFeedback.value) return
  feedbackError.value = ''
  feedbackSuccess.value = ''
  const message = feedbackMessage.value.trim()
  if (!message) {
    feedbackError.value = t('settings.feedback.required')
    return
  }
  if (message.length > 10000) {
    feedbackError.value = t('settings.feedback.tooLong')
    return
  }
  submittingFeedback.value = true
  try {
    const result = await submitFeedbackRequest({
      message,
      includeLogs: includeFeedbackLogs.value === true,
    })
    if (result && result.code === 0) {
      feedbackMessage.value = ''
      includeFeedbackLogs.value = false
      feedbackSuccess.value = t('settings.feedback.submitted')
    } else {
      feedbackError.value = t('settings.feedback.submitFailed')
    }
  } catch {
    feedbackError.value = t('settings.feedback.submitFailed')
  } finally {
    submittingFeedback.value = false
  }
}

onMounted(() => {
  loadInfo()
})
</script>

<style scoped>
.logs-settings {
  padding: 20px;
}

.lang-section {
  margin-bottom: 16px;
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 8px;
  padding: 14px 16px;
}

.lang-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.lang-meta {
  min-width: 0;
}

.lang-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary, #1a202c);
}

.lang-hint {
  margin-top: 4px;
  font-size: var(--font-size-xs);
  color: var(--text-muted, #718096);
  line-height: 1.5;
}

.lang-select {
  flex-shrink: 0;
  padding: 6px 10px;
  border: 1px solid var(--border-light, #cbd5e0);
  border-radius: 6px;
  background: var(--surface, #fff);
  color: var(--text-primary, #1a202c);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.log-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: var(--primary-light, #eef4ff);
  color: var(--text-secondary, #4a5568);
  border-radius: 8px;
  padding: 10px 14px;
  margin: 12px 0 16px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

.hint-icon {
  flex-shrink: 0;
}

.clear-btn {
  background: #e5484d;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: opacity 150ms;
}

.clear-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.clear-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.log-summary {
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 16px;
}

.summary-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
  margin-bottom: 10px;
  border-bottom: 1px dashed var(--border-light, #e2e8f0);
}

.log-dir {
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-size-xs);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.summary-label {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--text-muted, #718096);
  margin-bottom: 4px;
}

.summary-value {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary, #1a202c);
}

.log-file-list {
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 10px;
  overflow: hidden;
}

.log-file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  font-size: var(--font-size-sm);
  border-bottom: 1px solid var(--border-light, #e2e8f0);
}

.log-file-row:last-child {
  border-bottom: none;
}

.file-name {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.file-size {
  color: var(--text-muted, #718096);
}

.log-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-muted, #718096);
}

.feedback-section {
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 10px;
  padding: 16px;
  margin-top: 20px;
}

.feedback-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.feedback-title {
  font-size: var(--font-size-base);
  font-weight: 650;
  color: var(--text-primary, #1a202c);
}

.feedback-subtitle,
.feedback-log-hint {
  color: var(--text-muted, #718096);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

.feedback-subtitle {
  margin-top: 4px;
}

.feedback-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.feedback-label {
  color: var(--text-secondary, #4a5568);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.feedback-textarea {
  width: 100%;
  min-height: 120px;
  resize: vertical;
  border: 1px solid var(--border-light, #cbd5e0);
  border-radius: 7px;
  padding: 10px 12px;
  color: var(--text-primary, #1a202c);
  background: var(--surface, #fff);
  font: inherit;
  line-height: 1.55;
}

.feedback-textarea:focus {
  outline: 2px solid var(--primary, #4c6fff);
  outline-offset: 1px;
}

.feedback-count {
  align-self: flex-end;
  color: var(--text-muted, #718096);
  font-size: var(--font-size-xs);
}

.feedback-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary, #4a5568);
  font-size: var(--font-size-sm);
}

.feedback-checkbox input {
  width: 15px;
  height: 15px;
}

.feedback-message {
  border-radius: 6px;
  padding: 8px 10px;
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

.feedback-error {
  color: #b42318;
  background: var(--color-bg-card)1f0;
}

.feedback-success {
  color: #067647;
  background: #ecfdf3;
}

.feedback-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

</style>
