<template>
  <div class="automation-page">
    <div class="cohere-page-header">
      <div>
        <div class="page-title">{{ t('automation.title') }}</div>
        <div class="page-subtitle">{{ t('automation.subtitle') }}</div>
      </div>
      <button class="cohere-btn-primary" data-testid="automation-create" @click="openCreate">
        {{ t('automation.create') }}
      </button>
    </div>

    <div class="cohere-content">
      <!-- 资源竞争提示（不藏代价） -->
      <div class="automation-notice" data-testid="automation-notice">
        {{ t('automation.resourceNotice') }}
      </div>

      <!-- 真源不可读提示：「读不到」与「没有任务」是两件事 -->
      <div v-if="status !== 'ok'" class="automation-alert" data-testid="automation-status">
        {{ status === 'unreadable' ? t('automation.unreadable') : t('automation.saveFailed') }}
      </div>

      <div v-if="tasks.length === 0" class="automation-empty" data-testid="automation-empty">
        {{ t('automation.empty') }}
      </div>

      <div v-else class="cohere-card">
        <table class="automation-table">
          <thead>
            <tr>
              <th>{{ t('automation.colName') }}</th>
              <th>{{ t('automation.colTrigger') }}</th>
              <th>{{ t('automation.colAction') }}</th>
              <th>{{ t('automation.colPolicy') }}</th>
              <th>{{ t('automation.colLastRun') }}</th>
              <th class="col-ops">{{ t('automation.colOps') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in tasks" :key="task.id" :data-testid="'automation-row-' + task.id">
              <td>
                <label class="automation-switch">
                  <input
                    type="checkbox"
                    :checked="task.enabled"
                    :data-testid="'automation-enabled-' + task.id"
                    @change="toggleEnabled(task, $event.target.checked)"
                  />
                  <span>{{ task.name }}</span>
                </label>
              </td>
              <td>
                <span v-for="label in task.triggerLabels" :key="label" class="automation-chip">{{ label }}</span>
              </td>
              <td>{{ t('automation.actionPipeline') }}</td>
              <td>
                {{ task.failurePolicy === 'abort' ? t('automation.policyAbort') : t('automation.policySkip') }}
                <span v-if="task.maxRetries > 0" class="automation-sub">
                  （{{ t('automation.retryTimes', { count: task.maxRetries }) }}）
                </span>
              </td>
              <td>
                <span v-if="task.running" class="automation-chip automation-chip--running">
                  {{ t('automation.running') }}
                </span>
                <span v-else-if="!task.lastRunAt" class="automation-sub">—</span>
                <span v-else>
                  <span :class="'automation-status automation-status--' + task.lastStatus">
                    {{ statusLabel(task.lastStatus) }}
                  </span>
                  <span class="automation-sub">{{ formatTime(task.lastRunAt) }}</span>
                </span>
                <div v-if="task.lastError" class="automation-error" :title="task.lastError">
                  {{ task.lastError }}
                </div>
              </td>
              <td class="col-ops">
                <button class="cohere-btn-text" :data-testid="'automation-run-' + task.id" @click="runNow(task)">
                  {{ t('automation.runNow') }}
                </button>
                <button class="cohere-btn-text" @click="openEdit(task)">{{ t('automation.edit') }}</button>
                <button class="cohere-btn-text cohere-btn-text--danger" @click="remove(task)">
                  {{ t('automation.delete') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新建 / 编辑抽屉 -->
    <div v-if="showDialog" class="automation-mask" @click.self="closeDialog">
      <div class="automation-dialog" data-testid="automation-dialog">
        <div class="automation-dialog__title">
          {{ editing ? t('automation.editTitle') : t('automation.createTitle') }}
        </div>

        <div class="automation-field">
          <label class="automation-label">{{ t('automation.fieldName') }}</label>
          <input v-model="form.name" class="automation-input" :placeholder="t('automation.namePlaceholder')" />
        </div>

        <div class="automation-field">
          <label class="automation-label">{{ t('automation.fieldTriggers') }}</label>
          <div class="automation-sub">{{ t('automation.triggersHint') }}</div>

          <label class="automation-check">
            <input v-model="form.useAppStart" type="checkbox" data-testid="trigger-appstart" />
            {{ t('automation.triggerAppStart') }}
          </label>

          <label class="automation-check">
            <input v-model="form.useDaily" type="checkbox" data-testid="trigger-daily" />
            {{ t('automation.triggerDaily') }}
            <input v-model="form.dailyTime" type="time" class="automation-input automation-input--sm" :disabled="!form.useDaily" />
          </label>

          <label class="automation-check">
            <input v-model="form.useWeekly" type="checkbox" data-testid="trigger-weekly" />
            {{ t('automation.triggerWeekly') }}
            <input v-model="form.weeklyTime" type="time" class="automation-input automation-input--sm" :disabled="!form.useWeekly" />
          </label>
          <div v-if="form.useWeekly" class="automation-weekdays">
            <label v-for="d in 7" :key="d" class="automation-weekday">
              <input v-model="form.weekdays" type="checkbox" :value="d" /> {{ weekdayLabel(d) }}
            </label>
          </div>

          <label class="automation-check">
            <input v-model="form.useInterval" type="checkbox" data-testid="trigger-interval" />
            {{ t('automation.triggerInterval') }}
            <input
              v-model.number="form.intervalMinutes"
              type="number"
              min="5"
              max="1440"
              class="automation-input automation-input--sm"
              :disabled="!form.useInterval"
            />
            {{ t('automation.minutesUnit') }}
          </label>
        </div>

        <div class="automation-field">
          <label class="automation-label">{{ t('automation.fieldPolicy') }}</label>
          <label class="automation-check">
            <input v-model="form.failurePolicy" type="radio" value="skip" data-testid="policy-skip" />
            {{ t('automation.policySkip') }}
            <span class="automation-sub">— {{ t('automation.policySkipHint') }}</span>
          </label>
          <label class="automation-check">
            <input v-model="form.failurePolicy" type="radio" value="abort" data-testid="policy-abort" />
            {{ t('automation.policyAbort') }}
            <span class="automation-sub">— {{ t('automation.policyAbortHint') }}</span>
          </label>
        </div>

        <div class="automation-field">
          <label class="automation-label">{{ t('automation.fieldRetries') }}</label>
          <select v-model.number="form.maxRetries" class="automation-input automation-input--sm">
            <option :value="0">{{ t('automation.retryNone') }}</option>
            <option :value="1">1</option>
            <option :value="2">2</option>
            <option :value="3">3</option>
          </select>
        </div>

        <div v-if="formError" class="automation-alert" data-testid="automation-form-error">{{ formError }}</div>

        <div class="automation-dialog__footer">
          <button class="cohere-btn-secondary" @click="closeDialog">{{ t('automation.cancel') }}</button>
          <button class="cohere-btn-primary" :disabled="saving" @click="save">{{ t('automation.save') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  automationList, automationCreate, automationUpdate, automationRemove, automationRunNow,
  onAutomationNotification,
} from '@/api/automation'
import { useNotify } from '@/composables/useNotify'

const { t } = useI18n()
const { notifyError, notifySuccess } = useNotify()

const tasks = ref([])
const status = ref('ok') // ok | unreadable | save-failed
const saving = ref(false)

const showDialog = ref(false)
const editing = ref(false)
const formError = ref('')
const form = ref(emptyForm())

let stopNotifier = null

function emptyForm () {
  return {
    id: '',
    name: '',
    useAppStart: false,
    useDaily: false,
    dailyTime: '09:00',
    useWeekly: false,
    weeklyTime: '09:00',
    weekdays: [],
    useInterval: false,
    intervalMinutes: 30,
    failurePolicy: 'skip',
    maxRetries: 0,
  }
}

/** 表单 → triggers 数组（多个可同时有效，同类型只出一个） */
const formTriggers = computed(() => {
  const list = []
  if (form.value.useAppStart) list.push({ type: 'onAppStart' })
  if (form.value.useDaily) list.push({ type: 'daily', time: form.value.dailyTime })
  if (form.value.useWeekly) list.push({ type: 'weekly', weekdays: [...form.value.weekdays], time: form.value.weeklyTime })
  if (form.value.useInterval) list.push({ type: 'interval', minutes: Number(form.value.intervalMinutes) })
  return list
})

function weekdayLabel (d) {
  // 星期名走 locale（渲染端非 locales 文件不得新增中文字面量，CI Gate 7 --cjk 拦截）
  return t('automation.weekdays.' + d)
}

function statusLabel (s) {
  if (s === 'completed') return t('automation.statusCompleted')
  if (s === 'failed') return t('automation.statusFailed')
  if (s === 'cancelled') return t('automation.statusCancelled')
  return '—'
}

function formatTime (iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load () {
  const res = await automationList()
  if (!res || res.code !== 0) { status.value = 'unreadable'; return }
  tasks.value = (res.data && res.data.tasks) || []
  status.value = 'ok'
}

function openCreate () {
  editing.value = false
  form.value = emptyForm()
  formError.value = ''
  showDialog.value = true
}

function openEdit (task) {
  editing.value = true
  const f = emptyForm()
  f.id = task.id
  f.name = task.name
  for (const tr of task.triggers || []) {
    if (tr.type === 'onAppStart') f.useAppStart = true
    if (tr.type === 'daily') { f.useDaily = true; f.dailyTime = tr.time }
    if (tr.type === 'weekly') { f.useWeekly = true; f.weeklyTime = tr.time; f.weekdays = [...(tr.weekdays || [])] }
    if (tr.type === 'interval') { f.useInterval = true; f.intervalMinutes = tr.minutes }
  }
  f.failurePolicy = task.failurePolicy || 'skip'
  f.maxRetries = Number(task.maxRetries) || 0
  form.value = f
  formError.value = ''
  showDialog.value = true
}

function closeDialog () {
  showDialog.value = false
}

async function save () {
  formError.value = ''
  if (!form.value.name.trim()) { formError.value = t('automation.errNameEmpty'); return }
  if (form.value.name.trim().length > 40) { formError.value = t('automation.errNameTooLong'); return }
  if (formTriggers.value.length === 0) { formError.value = t('automation.errNoTrigger'); return }
  if (form.value.useWeekly && form.value.weekdays.length === 0) { formError.value = t('automation.errNoWeekday'); return }

  const payload = {
    name: form.value.name.trim(),
    triggers: formTriggers.value,
    failurePolicy: form.value.failurePolicy,
    maxRetries: Number(form.value.maxRetries) || 0,
  }
  saving.value = true
  try {
    const res = editing.value
      ? await automationUpdate(form.value.id, payload)
      : await automationCreate(payload)
    if (!res || res.code !== 0 || !res.ok) {
      formError.value = (res && res.message) || t('automation.errSaveFailed')
      return
    }
    notifySuccess(editing.value ? 'automation.saved' : 'automation.created')
    showDialog.value = false
    await load()
  } catch (e) {
    formError.value = (e && e.message) || t('automation.errSaveFailed')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled (task, value) {
  const res = await automationUpdate(task.id, { enabled: value })
  if (!res || res.code !== 0 || !res.ok) { notifyError('automation.errSaveFailed'); await load(); return }
  task.enabled = value
}

async function runNow (task) {
  const res = await automationRunNow(task.id)
  if (!res || res.code !== 0) { notifyError('automation.errRunFailed'); return }
  if (res.data && res.data.reason === 'already-running') {
    notifyError('automation.errAlreadyRunning')
    return
  }
  notifySuccess('automation.started')
  await load()
}

async function remove (task) {
  const res = await automationRemove(task.id)
  if (!res || res.code !== 0 || !res.ok) { notifyError('automation.errDeleteFailed'); return }
  notifySuccess('automation.deleted')
  await load()
}

onMounted(async () => {
  // 阶段 2.4（audit-64）：监听注册必须在 `await load()` **之前**。
  // 原来排在之后 ⇒ 首屏列表 IPC 未返回的那段窗口里，后台任务恰好失败时通知落在
  // "还没人监听"上被整体丢掉，用户只看到列表后来变红、没有任何 toast，
  // 而这条通知存在的目的正是"不打断操作也要让人知道失败"。
  stopNotifier = onAutomationNotification((payload) => {
    if (!payload) return
    if (payload.level === 'error') notifyError('automation.notifyFailed', { message: payload.message || '' })
    else notifySuccess('automation.notifyRecovered', { message: payload.message || '' })
    load()
  })
  await load()
})

onUnmounted(() => {
  if (stopNotifier) { stopNotifier(); stopNotifier = null }
})
</script>

<style scoped>
.automation-page { display: flex; flex-direction: column; }
.automation-notice {
  padding: 10px 14px; margin-bottom: 12px; border-radius: 8px;
  background: var(--color-fill-light, #f7f8fa); color: var(--color-text-secondary, #85858f);
  font-size: var(--font-size-xs, 12px); line-height: 1.6;
}
.automation-alert {
  padding: 10px 14px; margin-bottom: 12px; border-radius: 8px;
  background: #fef0f0; color: #d9534f; font-size: var(--font-size-xs, 12px);
}
.automation-empty {
  padding: 48px 16px; text-align: center; color: var(--color-text-secondary, #85858f);
  font-size: var(--font-size-sm, 13px);
}
.automation-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm, 13px); }
.automation-table th, .automation-table td {
  padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--color-border-light, #eff0f4);
  vertical-align: top;
}
.automation-table th { color: var(--color-text-secondary, #85858f); font-weight: 500; }
.col-ops { white-space: nowrap; }
.automation-switch { display: inline-flex; align-items: center; gap: 6px; }
.automation-chip {
  display: inline-block; margin: 0 4px 4px 0; padding: 2px 8px; border-radius: 10px;
  background: var(--color-fill-light, #f2f3f5); font-size: var(--font-size-xs, 12px);
}
.automation-chip--running { background: #e8f3ff; color: #2f6fd0; }
.automation-sub { display: block; color: var(--color-text-secondary, #85858f); font-size: var(--font-size-xs, 12px); }
.automation-error {
  max-width: 260px; margin-top: 4px; color: #d9534f; font-size: var(--font-size-xs, 12px);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.automation-status--completed { color: #3ba55d; }
.automation-status--failed { color: #d9534f; }
.automation-mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.automation-dialog {
  width: 520px; max-height: 84vh; overflow-y: auto; padding: 20px 24px;
  background: var(--color-bg, #fff); border-radius: 12px;
}
.automation-dialog__title { margin-bottom: 16px; font-size: var(--font-size-lg, 16px); font-weight: 600; }
.automation-dialog__footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.automation-field { margin-bottom: 16px; }
.automation-label { display: block; margin-bottom: 6px; font-weight: 500; font-size: var(--font-size-sm, 13px); }
.automation-check { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: var(--font-size-sm, 13px); }
.automation-input {
  height: 32px; padding: 0 10px; border: 1px solid var(--color-border, #dcdfe6);
  border-radius: 6px; font-size: var(--font-size-sm, 13px);
}
.automation-input--sm { width: 120px; height: 28px; }
.automation-weekdays { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 10px 24px; }
.automation-weekday { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-xs, 12px); }
</style>
