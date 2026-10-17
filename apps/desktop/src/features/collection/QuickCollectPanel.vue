<template>
  <div class="cohere-content" role="tabpanel" :aria-label="$t('collection.quickCollect.title')" data-testid="quick-collect-panel">
    <!-- 官方内置 -->
    <div class="cohere-card col-panel">
      <div class="cohere-section-title col-section-title col-section-title--flex">
        <span>{{ $t('collection.quickCollect.builtinSection') }}</span>
      </div>
      <div class="qc-intro">{{ $t('collection.quickCollect.intro') }}</div>
      <div v-if="presetsFailed" class="col-error-banner" data-testid="quick-collect-presets-error">
        {{ $t('collection.quickCollect.presetsFailed') }}
      </div>
      <div class="qc-grid" data-testid="quick-collect-builtin-list">
        <div
          v-for="c in presets"
          :key="c.id"
          class="cohere-card qc-card"
          :data-testid="'quick-collect-card-' + c.id"
        >
          <div class="qc-card-head">
            <span class="qc-icon">{{ c.icon || '⚡' }}</span>
            <span class="qc-title">{{ c.title }}</span>
            <span class="qc-badge">{{ $t('collection.quickCollect.builtinBadge') }}</span>
          </div>
          <div class="qc-summary">{{ c.summary }}</div>
          <div class="qc-meta">
            <span>{{ $t('collection.quickCollect.windowLabel') }}{{ windowText(c.windowHours) }}</span>
            <span v-if="c.keywords && c.keywords.length">{{ $t('collection.quickCollect.keywordsLabel') }}{{ c.keywords.join(' / ') }}</span>
            <span v-else>{{ $t('collection.quickCollect.noKeywords') }}</span>
          </div>
          <div v-if="runningId === c.id" class="qc-stage" data-testid="quick-collect-stage">
            {{ stageText }}
          </div>
          <div v-if="errorFor === c.id" class="col-error-banner" data-testid="quick-collect-error">
            {{ errorText }}
          </div>
          <div class="qc-actions">
            <button
              class="cohere-btn-primary"
              :disabled="!!runningId"
              :data-testid="'quick-collect-run-' + c.id"
              @click="run(c)"
            >
              {{ runningId === c.id ? $t('collection.quickCollect.running') : $t('collection.quickCollect.run') }}
            </button>
            <button class="cohere-btn-secondary" :data-testid="'quick-collect-view-' + c.id" @click="togglePrompt(c.id)">
              {{ expandedId === c.id ? $t('collection.quickCollect.hidePrompt') : $t('collection.quickCollect.viewPrompt') }}
            </button>
          </div>
          <pre v-if="expandedId === c.id" class="qc-prompt" :data-testid="'quick-collect-prompt-' + c.id">{{ c.prompt }}</pre>
        </div>
      </div>
    </div>

    <!-- 我的自定义 -->
    <div class="cohere-card col-panel">
      <div class="cohere-section-title col-section-title cohere-section-title--flex">
        <span>{{ $t('collection.quickCollect.customSection') }}（{{ customs.length }}）</span>
        <button
          class="cohere-btn-primary"
          :disabled="!!runningId"
          data-testid="quick-collect-add"
          @click="openAdd"
        >
          ＋ {{ $t('collection.quickCollect.add') }}
        </button>
      </div>
      <div class="qc-intro">{{ $t('collection.quickCollect.customHint') }}</div>
      <div v-if="readFailed" class="col-error-banner" data-testid="quick-collect-read-error">
        {{ $t('collection.quickCollect.readFailed') }}
      </div>
      <div v-if="skipped > 0" class="qc-stage" data-testid="quick-collect-skipped">
        {{ $t('collection.quickCollect.skippedWarning', { count: String(skipped) }) }}
      </div>
      <EmptyState
        v-if="customs.length === 0"
        data-testid="quick-collect-empty"
        icon="⚡"
        :title="$t('collection.quickCollect.emptyTitle')"
        :description="$t('collection.quickCollect.emptyDesc')"
        :action-text="$t('collection.quickCollect.emptyAction')"
        @action="openAdd"
      />
      <div v-else class="qc-grid" data-testid="quick-collect-custom-list">
        <div
          v-for="c in customs"
          :key="c.id"
          class="cohere-card qc-card"
          :data-testid="'quick-collect-card-' + c.id"
        >
          <div class="qc-card-head">
            <span class="qc-icon">🧩</span>
            <span class="qc-title">{{ c.title }}</span>
          </div>
          <div class="qc-summary">{{ c.summary || truncatePrompt(c.prompt) }}</div>
          <div class="qc-meta">
            <span>{{ $t('collection.quickCollect.windowLabel') }}{{ windowText(c.windowHours) }}</span>
            <span v-if="c.keywords && c.keywords.length">{{ $t('collection.quickCollect.keywordsLabel') }}{{ c.keywords.join(' / ') }}</span>
            <span v-else>{{ $t('collection.quickCollect.noKeywords') }}</span>
          </div>
          <div v-if="runningId === c.id" class="qc-stage" data-testid="quick-collect-stage">
            {{ stageText }}
          </div>
          <div v-if="errorFor === c.id" class="col-error-banner" data-testid="quick-collect-error">
            {{ errorText }}
          </div>
          <div class="qc-actions">
            <button
              class="cohere-btn-primary"
              :disabled="!!runningId"
              :data-testid="'quick-collect-run-' + c.id"
              @click="run(c)"
            >
              {{ runningId === c.id ? $t('collection.quickCollect.running') : $t('collection.quickCollect.run') }}
            </button>
            <button
              class="cohere-btn-secondary"
              :disabled="!!runningId"
              :data-testid="'quick-collect-edit-' + c.id"
              @click="openEdit(c)"
            >
              {{ $t('collection.quickCollect.edit') }}
            </button>
            <button
              class="cohere-btn-secondary"
              :disabled="!!runningId"
              :data-testid="'quick-collect-delete-' + c.id"
              @click="remove(c)"
            >
              {{ $t('collection.quickCollect.delete') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <QuickCollectCommandDialog
      v-model:visible="dialogVisible"
      :command="editing"
      :existing="customs"
      @save="onSave"
    />
  </div>
</template>

<script setup>
/**
 * QuickCollectPanel.vue — 「快捷采集」页签面板
 *
 * 职责边界（PRD §4）：本面板只做**启动器 + 管理器**。执行成功后 emit 结果条目，
 * 由 `Collection.vue` 走既有出口入列表并切到「采集」页签复用同一张结果卡 ——
 * 结果卡（改写策略 / 字数区间 / 爆款库 / 草稿 / 发布）不在这里复制第二份。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotify } from '@/composables/useNotify'
import { quickCollectRun, onQuickCollectProgress } from '@/api/quick-collect'
import {
  DOMAIN_CODE_TO_FORM_KEY,
  FORM_ERROR_KEYS,
  windowLabelKey,
} from './quick-collect-commands'
import { useQuickCollectCommands } from './useQuickCollectCommands'
import QuickCollectCommandDialog from './QuickCollectCommandDialog.vue'

// 页签激活由父级 `v-else-if` 保证（挂载即激活），因此这里不消费 active；
// 保留声明是为了让父级显式传递语义、且未来切到 v-show 时不需要改组件签名。
defineProps({
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['collected'])

const { t } = useI18n()
const { notifyError, notifySuccess, notifyInfo, notifyConfirm } = useNotify()
const { presets, customs, skipped, presetsFailed, readFailed, load, addCommand, updateCommand, removeCommand } = useQuickCollectCommands()

const runningId = ref('')
const stage = ref('')
const errorFor = ref('')
const errorText = ref('')
const expandedId = ref('')
const dialogVisible = ref(false)
const editing = ref(null)
let currentRequestId = ''
let unsubscribeProgress = null

const stageText = computed(() => {
  if (stage.value === 'retrieving') return t('collection.quickCollect.stageRetrieving')
  if (stage.value === 'summarizing') return t('collection.quickCollect.stageSummarizing')
  if (stage.value === 'done') return t('collection.quickCollect.stageDone')
  return t('collection.quickCollect.running')
})

function windowText (h) {
  return t('collection.quickCollect.' + windowLabelKey(h))
}

function truncatePrompt (prompt) {
  const text = String(prompt || '')
  return text.length > 70 ? text.slice(0, 70) + '…' : text
}

function togglePrompt (id) {
  expandedId.value = expandedId.value === id ? '' : id
}

/**
 * 领域码 → 文案。`-2` 优先按主进程领域码映射到**同一批表单文案**
 * （例如 QC_TITLE_TOO_LONG 与表单的 errTitleTooLong 是同一句话，
 * 不另起一份"服务端校验文案"，否则两侧措辞必然漂移）。
 * @param {{ code?: number, message?: string }|null} res
 */
function errorTextOf (res) {
  const code = Number(res && res.code)
  const message = String((res && res.message) || '')
  if (code === -2) {
    const formKey = DOMAIN_CODE_TO_FORM_KEY[message]
    if (formKey && FORM_ERROR_KEYS[formKey]) return t('collection.quickCollect.' + FORM_ERROR_KEYS[formKey])
    return t('collection.quickCollect.errorValidation', { message })
  }
  if (code === -101) return t('collection.quickCollect.errorLlmNotConfigured')
  if (code === -102) return t('collection.quickCollect.errorLlmFailed', { message })
  if (code === -103) return t('collection.quickCollect.errorLlmEmpty')
  if (code === -1) return t('collection.quickCollect.errorIpcUnavailable')
  return t('collection.quickCollect.errorUnknown', { message: message || String(code) })
}

function notifyTextOf (res) {
  const code = Number(res && res.code)
  const message = String((res && res.message) || '')
  if (code === -101) return { key: 'collection.quickCollect.errorLlmNotConfigured', params: {} }
  if (code === -103) return { key: 'collection.quickCollect.errorLlmEmpty', params: {} }
  if (code === -1) return { key: 'collection.quickCollect.errorIpcUnavailable', params: {} }
  return { key: 'collection.quickCollect.errorLlmFailed', params: { message: message || String(code) } }
}

async function run (command) {
  if (runningId.value || !command) return
  runningId.value = command.id
  stage.value = 'retrieving'
  errorFor.value = ''
  errorText.value = ''
  currentRequestId = 'qcr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  try {
    // IPC 参数必须是纯 JSON（Vue reactive proxy 直接传会报 "An object could not be cloned"）
    const payload = JSON.parse(JSON.stringify(command))
    const res = await quickCollectRun(payload, currentRequestId)
    if (!res || res.code !== 0 || !res.data) {
      errorFor.value = command.id
      errorText.value = errorTextOf(res)
      const n = notifyTextOf(res)
      notifyError(n.key, { params: n.params })
      return
    }
    const item = res.data
    const count = String((item.quickCollect && item.quickCollect.materialCount) || 0)
    if (Number(count) > 0) notifySuccess('collection.quickCollect.runSuccess', { params: { count } })
    else notifyInfo('collection.quickCollect.runSuccessNoMaterial')
    emit('collected', item)
  } catch (e) {
    errorFor.value = command.id
    errorText.value = t('collection.quickCollect.errorUnknown', { message: (e && e.message) || String(e) })
    notifyError('collection.quickCollect.errorUnknown', { params: { message: (e && e.message) || String(e) } })
  } finally {
    runningId.value = ''
    stage.value = ''
  }
}

function openAdd () {
  editing.value = null
  dialogVisible.value = true
}

function openEdit (command) {
  editing.value = command
  dialogVisible.value = true
}

async function onSave (form) {
  const isEdit = !!(editing.value && editing.value.id)
  const res = isEdit
    ? await updateCommand(editing.value.id, form)
    : await addCommand(form)
  if (!res || !res.ok) {
    notifyError('collection.quickCollect.errorUnknown', { params: { message: String((res && res.code) || '') } })
    return
  }
  dialogVisible.value = false
  editing.value = null
  notifySuccess('collection.quickCollect.saved')
}

async function remove (command) {
  const confirmed = await notifyConfirm('collection.quickCollect.deleteConfirm', {
    params: { title: command.title },
    title: t('collection.quickCollect.confirmTitle'),
  })
  if (!confirmed) return
  const res = await removeCommand(command.id)
  if (!res || !res.ok) {
    notifyError('collection.quickCollect.errorUnknown', { params: { message: String((res && res.code) || '') } })
    return
  }
  if (expandedId.value === command.id) expandedId.value = ''
  notifySuccess('collection.quickCollect.deleted')
}

function handleProgress (payload) {
  if (!currentRequestId || !payload) return
  if (payload.requestId && payload.requestId !== currentRequestId) return
  if (payload.stage) stage.value = String(payload.stage)
}

onMounted(async () => {
  unsubscribeProgress = onQuickCollectProgress(handleProgress)
  await load()
})

onUnmounted(() => {
  if (typeof unsubscribeProgress === 'function') unsubscribeProgress()
  unsubscribeProgress = null
})

defineExpose({ run, load, openAdd, openEdit, onSave, remove, errorTextOf })
</script>

<style scoped>
/* 2026-10-17 collection-page-ui-ue-refine：本区块原有 11 处硬编码 hex 与
 * 「var(--x, #兜底)」形态（#666/#888/#e0e0e0/#e6a23c/#f7f7f7/#fff/#f56c6c/#dcdfe6/#999），
 * 且此前不在任何 hex 门禁的扫描范围内（门禁照绿、代码照脏）。全部收编到
 * tokens.css 语义槽 / collection-page.css 规范层变量；间距与圆角走阶梯。
 * ⚠ 本注释内不得出现 hex 字面量（会被契约测试当成真硬编码）。 */
@import './collection-page.css';

.qc-intro {
  margin: var(--spacing-2) 0 var(--spacing-3);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.6;
}
.qc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--spacing-3);
}
.qc-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  padding: var(--col-card-pad);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.qc-card-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}
.qc-icon {
  font-size: var(--font-size-lg);
  line-height: 1;
}
.qc-title {
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}
.qc-badge {
  margin-left: auto;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  padding: 1px var(--spacing-2);
}
.qc-summary {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.qc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
/* 进行中提示：与采集页其它「进行中」横幅同语义，走 warning 档（原 #e6a23c 是 EP 旧警告色） */
.qc-stage {
  font-size: var(--font-size-xs);
  color: var(--color-warning);
}
.qc-actions {
  display: flex;
  gap: var(--spacing-2);
  flex-wrap: wrap;
  margin-top: var(--spacing-1);
}
.qc-prompt {
  margin: var(--spacing-2) 0 0;
  padding: var(--spacing-2);
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--font-size-xs);
  background: var(--color-bg-inset);
  border-radius: var(--radius-xs);
}
.qc-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(23, 23, 32, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.qc-modal {
  width: min(680px, 92vw);
  max-height: 88vh;
  overflow: auto;
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  padding: var(--spacing-4) var(--spacing-5);
}
.qc-modal-title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}
.qc-modal-intro {
  margin: var(--spacing-2) 0 var(--spacing-3);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.6;
}
.qc-field {
  margin-bottom: var(--spacing-3);
}
.qc-field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-1);
  color: var(--color-text-primary);
}
.qc-counter {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.qc-counter--over {
  color: var(--color-danger);
}
.qc-input,
.qc-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  padding: var(--spacing-2);
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--color-text-primary);
  background: var(--color-bg-card);
}
.qc-input:focus,
.qc-textarea:focus {
  border-color: var(--color-primary);
  outline: none;
  box-shadow: 0 0 0 2px var(--color-primary-light);
}
.qc-textarea {
  resize: vertical;
  line-height: 1.6;
}
.qc-hint {
  margin-top: var(--spacing-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  line-height: 1.5;
}
.qc-field-error {
  margin-top: var(--spacing-1);
  font-size: var(--font-size-xs);
  color: var(--color-error-banner-text);
}
.qc-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
  margin-top: var(--spacing-2);
}
</style>
