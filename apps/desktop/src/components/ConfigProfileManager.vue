<template>
  <div class="config-profile-manager">
    <div class="config-profile-entry-actions">
      <button
        type="button"
        class="config-profile-entry"
        :data-testid="testIdPrefix + '-save'"
        :disabled="props.disabled"
        @click="openSave"
      >
        {{ t('create.story2video.configProfile.saveButton') }}
      </button>
      <button
        type="button"
        class="config-profile-entry"
        :data-testid="testIdPrefix + '-manage'"
        :disabled="props.disabled"
        @click="openList"
      >
        {{ t('create.story2video.configProfile.manageButton') }}
      </button>
    </div>

    <UiModal
      :visible="saveOpen"
      :title="t('create.story2video.configProfile.saveTitle')"
      size="sm"
      @close="closeSave"
    >
      <div class="config-profile-dialog" :data-testid="testIdPrefix + '-save-dialog'">
        <p class="config-profile-hint">{{ t('create.story2video.configProfile.saveHint') }}</p>
        <input
          v-model="nameDraft"
          class="config-profile-input"
          maxlength="60"
          :placeholder="t('create.story2video.configProfile.namePlaceholder')"
          :data-testid="testIdPrefix + '-name-input'"
          @keyup.enter="save"
          @keyup.esc="closeSave"
        />
        <p v-if="overwriteNeeded" class="config-profile-hint" :data-testid="testIdPrefix + '-overwrite-hint'">
          {{ t('create.story2video.configProfile.duplicateName') }}
        </p>
        <p v-if="errorMessage" class="config-profile-error">{{ errorMessage }}</p>
      </div>
      <template #footer>
        <UiButton variant="secondary" :disabled="saving" @click="closeSave">
          {{ t('create.story2video.configProfile.cancel') }}
        </UiButton>
        <UiButton
          variant="primary"
          :disabled="saving || !normalizedName"
          :loading="saving"
          :data-testid="testIdPrefix + '-save-confirm'"
          @click="save"
        >
          {{ overwriteNeeded ? t('create.story2video.configProfile.overwriteSave') : t('create.story2video.configProfile.save') }}
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :visible="listOpen"
      :title="t('create.story2video.configProfile.listTitle')"
      size="md"
      @close="closeList"
    >
      <div class="config-profile-list" :data-testid="testIdPrefix + '-list-dialog'">
        <div v-if="loading" class="config-profile-state" data-testid="config-profile-loading">
          <UiSkeleton variant="list" :count="3" />
        </div>
        <p v-else-if="errorMessage" class="config-profile-error">{{ errorMessage }}</p>
        <ul v-else-if="profiles.length" class="config-profile-items">
          <li v-for="profile in profiles" :key="profile.id" class="config-profile-item" :data-testid="testIdPrefix + '-row'">
            <template v-if="renamingId === profile.id">
              <input
                v-model="renameDraft"
                class="config-profile-input"
                maxlength="60"
                :data-testid="testIdPrefix + '-rename-input'"
                @keyup.enter="rename"
                @keyup.esc="cancelRename"
              />
              <div class="config-profile-actions">
                <button type="button" :disabled="busy" :data-testid="testIdPrefix + '-rename-confirm'" @click="rename">{{ t('create.story2video.configProfile.save') }}</button>
                <button type="button" :disabled="busy" @click="cancelRename">{{ t('create.story2video.configProfile.cancel') }}</button>
              </div>
            </template>
            <template v-else>
              <div class="config-profile-content">
                <span class="config-profile-name" :title="profile.name">{{ profile.name }}</span>
                <span class="config-profile-meta">{{ pipelineLabelFor(profile.pipelineId) }} · {{ formatTime(profile.updatedAt) }}</span>
              </div>
              <div class="config-profile-actions">
                <button
                  type="button"
                  :disabled="busy || !canApply(profile)"
                  :title="canApply(profile) ? t('create.story2video.configProfile.apply') : t('create.story2video.configProfile.wrongPipeline')"
                  :data-testid="testIdPrefix + '-apply'"
                  @click="requestApply(profile)"
                >{{ t('create.story2video.configProfile.apply') }}</button>
                <button type="button" :disabled="busy" :data-testid="testIdPrefix + '-rename'" @click="startRename(profile)">{{ t('create.story2video.bgmLibrary.rename') }}</button>
                <button type="button" :disabled="busy" :data-testid="testIdPrefix + '-delete'" @click="requestDelete(profile)">{{ t('create.story2video.configProfile.delete') }}</button>
              </div>
            </template>
          </li>
        </ul>
        <p v-else class="config-profile-state">{{ t('create.story2video.configProfile.empty') }}</p>
      </div>
      <template #footer>
        <UiButton variant="secondary" :data-testid="testIdPrefix + '-list-close'" @click="closeList">
          {{ t('create.story2video.configProfile.close') }}
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :visible="applyOpen"
      :title="t('create.story2video.configProfile.applyTitle')"
      size="sm"
      @close="cancelApply"
    >
      <p class="config-profile-confirm" :data-testid="testIdPrefix + '-apply-dialog'">
        {{ t('create.story2video.configProfile.applyConfirm') }}
      </p>
      <template #footer>
        <UiButton variant="secondary" @click="cancelApply">{{ t('create.story2video.configProfile.cancel') }}</UiButton>
        <UiButton variant="primary" :data-testid="testIdPrefix + '-apply-confirm'" @click="confirmApply">{{ t('create.story2video.configProfile.apply') }}</UiButton>
      </template>
    </UiModal>

    <UiModal
      :visible="deleteOpen"
      :title="t('create.story2video.configProfile.deleteTitle')"
      size="sm"
      @close="cancelDelete"
    >
      <p class="config-profile-confirm" :data-testid="testIdPrefix + '-delete-dialog'">
        {{ t('create.story2video.configProfile.deleteConfirm') }}
        <strong v-if="deleteTarget">{{ deleteTarget.name }}</strong>
      </p>
      <template #footer>
        <UiButton variant="secondary" @click="cancelDelete">{{ t('create.story2video.configProfile.cancel') }}</UiButton>
        <UiButton variant="danger" :data-testid="testIdPrefix + '-delete-confirm'" @click="confirmDelete">{{ t('create.story2video.configProfile.delete') }}</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiModal from './UiModal.vue'
import UiButton from './UiButton.vue'
import { ElMessage } from 'element-plus'
import { formatDateTime } from '@/utils/datetime'
import { formatUserError } from '@/utils/user-facing-error'
import { getPipelineName } from '@/i18n/pipeline-labels'

const props = defineProps({
  pipelineId: { type: String, required: true },
  pipelineLabel: { type: String, default: '' },
  snapshot: { type: Object, required: true },
  dirty: { type: Boolean, default: false },
  existingProfiles: { type: Array, default: null },
  testIdPrefix: { type: String, default: 's2v-config-profile' },
  disabled: { type: Boolean, default: false },
  onList: { type: Function, default: null },
  onSave: { type: Function, default: null },
  onApply: { type: Function, default: null },
  onRename: { type: Function, default: null },
  onDelete: { type: Function, default: null },
})

const { t } = useI18n()
const saveOpen = ref(false)
const listOpen = ref(false)
const applyOpen = ref(false)
const deleteOpen = ref(false)
const nameDraft = ref('')
const renameDraft = ref('')
const overwriteNeeded = ref(false)
const profiles = ref([])
const applyTarget = ref(null)
const deleteTarget = ref(null)
const renamingId = ref('')
const errorMessage = ref('')
const busy = ref(false)
const loading = ref(false)
const saving = ref(false)
let requestGeneration = 0

const normalizedName = computed(() => {
  const value = String(nameDraft.value || '').trim()
  return Array.from(value).length <= 60 ? value : ''
})

function cloneJson (value) {
  try { return JSON.parse(JSON.stringify(value)) } catch (_) { return null }
}

function hasResultCode (value) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'code'))
}

function isFailedResult (value) {
  if (value == null) return true
  if (hasResultCode(value)) return value.code !== 0
  if (typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'ok')) return value.ok === false
  return false
}

function resultData (value) {
  return hasResultCode(value) ? value.data : value
}

function errorText (value, fallbackKey) {
  const raw = typeof value?.message === 'string' ? value.message.trim() : ''
  // 保留服务端给出的自然语言原因；明显的内部/桥接文本交给统一安全映射。
  if (raw && !/electronAPI not available|(?:[A-Z]{2,}_[A-Z0-9_]+)|[a-z][a-z0-9-]*:[a-z][a-z0-9-]*/i.test(raw)) return raw
  return formatUserError(value, { fallback: t(fallbackKey) }).message
}

function formatTime (value) {
  return formatDateTime(value, { style: 'short', invalidText: '' })
}

function pipelineLabelFor (pipelineId) {
  if (pipelineId === props.pipelineId && props.pipelineLabel) return props.pipelineLabel
  return getPipelineName(t, pipelineId) || String(pipelineId || '')
}

function sortProfiles (items) {
  return (Array.isArray(items) ? items : []).slice().sort((a, b) => {
    const right = Number(b?.updatedAt)
    const left = Number(a?.updatedAt)
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0)
  })
}

function canApply (profile) {
  return Boolean(profile && profile.pipelineId === props.pipelineId && profile.snapshot && typeof profile.snapshot === 'object' && !Array.isArray(profile.snapshot))
}

function nextRequest () {
  requestGeneration += 1
  return requestGeneration
}

function isCurrentRequest (generation) {
  return generation === requestGeneration && (saveOpen.value || listOpen.value)
}

function openSave () {
  if (props.disabled) return
  errorMessage.value = ''
  overwriteNeeded.value = false
  nameDraft.value = ''
  saveOpen.value = true
}

function closeSave () {
  saveOpen.value = false
  saving.value = false
  nextRequest()
}

async function save () {
  const name = normalizedName.value
  if (!name || Array.from(name).length > 60 || !props.onSave) {
    if (!name) errorMessage.value = t('create.story2video.configProfile.nameRequired')
    return
  }
  const duplicate = profiles.value.find((item) => item.pipelineId === props.pipelineId && item.name === name)
  if (duplicate && !overwriteNeeded.value) {
    overwriteNeeded.value = true
    return
  }
  saving.value = true
  errorMessage.value = ''
  const generation = nextRequest()
  try {
    const result = await props.onSave(name, { overwrite: overwriteNeeded.value, snapshot: cloneJson(props.snapshot) })
    if (!isCurrentRequest(generation)) return
    if (isFailedResult(result)) {
      if (result?.code === -2 || /duplicate|同名|already exists/i.test(String(result?.message || ''))) overwriteNeeded.value = true
      errorMessage.value = errorText(result, 'create.story2video.configProfile.saveFailed')
      ElMessage.error(errorMessage.value)
      return
    }
    const saved = resultData(result)
    if (!saved || !saved.id) {
      errorMessage.value = t('create.story2video.configProfile.saveFailed')
      ElMessage.error(errorMessage.value)
      return
    }
    profiles.value = sortProfiles([...profiles.value.filter((item) => item.id !== saved.id), saved])
    saveOpen.value = false
    overwriteNeeded.value = false
    ElMessage.success(t('create.story2video.configProfile.saved'))
  } catch (error) {
    if (isCurrentRequest(generation)) {
      errorMessage.value = errorText(error, 'create.story2video.configProfile.saveFailed')
      ElMessage.error(errorMessage.value)
    }
  } finally {
    // 成功路径会先关闭弹窗，不能再用 isCurrentRequest 判断，否则 loading 永远残留。
    saving.value = false
  }
}

async function openList () {
  if (props.disabled) return
  listOpen.value = true
  errorMessage.value = ''
  const generation = nextRequest()
  loading.value = true
  try {
    const result = props.onList ? await props.onList() : (props.existingProfiles || [])
    if (!isCurrentRequest(generation)) return
    if (isFailedResult(result)) {
      errorMessage.value = errorText(result, 'create.story2video.configProfile.loadFailed')
      profiles.value = []
      ElMessage.error(errorMessage.value)
      return
    }
    const data = resultData(result)
    if (!Array.isArray(data)) {
      errorMessage.value = t('create.story2video.configProfile.loadFailed')
      profiles.value = []
      ElMessage.error(errorMessage.value)
      return
    }
    profiles.value = sortProfiles(data)
  } catch (error) {
    if (isCurrentRequest(generation)) {
      errorMessage.value = errorText(error, 'create.story2video.configProfile.loadFailed')
      ElMessage.error(errorMessage.value)
    }
  } finally {
    if (isCurrentRequest(generation)) loading.value = false
  }
}

function closeList () {
  listOpen.value = false
  renamingId.value = ''
  nextRequest()
  loading.value = false
}

function requestApply (profile) {
  if (!canApply(profile)) {
    errorMessage.value = t('create.story2video.configProfile.wrongPipeline')
    return
  }
  applyTarget.value = cloneJson(profile)
  if (props.dirty) applyOpen.value = true
  else confirmApply()
}

function cancelApply () {
  applyOpen.value = false
  applyTarget.value = null
}

async function confirmApply () {
  const target = applyTarget.value
  applyOpen.value = false
  applyTarget.value = null
  if (!target || !canApply(target) || !props.onApply) return
  busy.value = true
  try {
    const result = await props.onApply(target)
    if (result === false || (hasResultCode(result) && result.code !== 0)) {
      errorMessage.value = errorText(result, 'create.story2video.configProfile.applyFailed')
      ElMessage.error(errorMessage.value)
      return
    }
    listOpen.value = false
    nextRequest()
    ElMessage.success(t('create.story2video.configProfile.applied'))
  } catch (error) {
    errorMessage.value = errorText(error, 'create.story2video.configProfile.applyFailed')
    ElMessage.error(errorMessage.value)
  } finally { busy.value = false }
}

function startRename (profile) {
  renamingId.value = profile.id
  renameDraft.value = profile.name
  errorMessage.value = ''
}

function cancelRename () {
  renamingId.value = ''
  renameDraft.value = ''
}

async function rename () {
  const id = renamingId.value
  const name = String(renameDraft.value || '').trim()
  if (!id || !name || Array.from(name).length > 60 || !props.onRename) {
    errorMessage.value = t('create.story2video.configProfile.nameRequired')
    return
  }
  busy.value = true
  errorMessage.value = ''
  try {
    const result = await props.onRename(id, name)
    if (isFailedResult(result)) {
      errorMessage.value = errorText(result, 'create.story2video.configProfile.renameFailed')
      ElMessage.error(errorMessage.value)
      return
    }
    const changed = resultData(result)
    if (!changed || changed.id !== id) {
      errorMessage.value = t('create.story2video.configProfile.renameFailed')
      ElMessage.error(errorMessage.value)
      return
    }
    profiles.value = sortProfiles(profiles.value.map((item) => item.id === id ? changed : item))
    cancelRename()
    ElMessage.success(t('create.story2video.configProfile.renamed'))
  } catch (error) {
    errorMessage.value = errorText(error, 'create.story2video.configProfile.renameFailed')
    ElMessage.error(errorMessage.value)
  } finally { busy.value = false }
}

function requestDelete (profile) {
  deleteTarget.value = cloneJson(profile)
  deleteOpen.value = true
}

function cancelDelete () {
  deleteOpen.value = false
  deleteTarget.value = null
}

async function confirmDelete () {
  const target = deleteTarget.value
  cancelDelete()
  if (!target || !props.onDelete) return
  busy.value = true
  errorMessage.value = ''
  try {
    const result = await props.onDelete(target)
    if (isFailedResult(result)) {
      errorMessage.value = errorText(result, 'create.story2video.configProfile.deleteFailed')
      ElMessage.error(errorMessage.value)
      return
    }
    profiles.value = profiles.value.filter((item) => item.id !== target.id)
    ElMessage.success(t('create.story2video.configProfile.deleted'))
  } catch (error) {
    errorMessage.value = errorText(error, 'create.story2video.configProfile.deleteFailed')
    ElMessage.error(errorMessage.value)
  } finally { busy.value = false }
}

watch(() => props.existingProfiles, (value) => {
  if (!listOpen.value && Array.isArray(value)) profiles.value = sortProfiles(value)
}, { deep: true, immediate: true })
</script>

<style scoped>
.config-profile-manager { display: inline-flex; align-items: center; }
.config-profile-entry-actions { display: inline-flex; gap: 8px; flex-wrap: wrap; }
.config-profile-entry { border: 0; background: transparent; color: var(--apple-accent); cursor: pointer; font: inherit; padding: 0; }
.config-profile-entry:disabled { opacity: .5; cursor: not-allowed; }
.config-profile-dialog, .config-profile-list { min-width: 0; }
.config-profile-hint, .config-profile-state { color: var(--apple-ink-secondary); font-size: var(--apple-size-sm); line-height: 1.5; }
.config-profile-error { color: var(--apple-error); font-size: var(--apple-size-sm); line-height: 1.5; }
.config-profile-input { width: 100%; box-sizing: border-box; border: 1px solid var(--apple-border); border-radius: var(--apple-radius-sm); padding: 8px 10px; font: inherit; }
.config-profile-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.config-profile-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--apple-border-subtle); border-radius: var(--apple-radius-sm); padding: 10px; }
.config-profile-content { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.config-profile-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--apple-weight-semibold); }
.config-profile-meta { color: var(--apple-ink-tertiary); font-size: 12px; }
.config-profile-actions { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; }
.config-profile-actions button { border: 1px solid var(--apple-border); border-radius: var(--apple-radius-sm); background: var(--apple-surface-primary); color: var(--apple-ink-secondary); cursor: pointer; padding: 4px 7px; font-size: 12px; }
.config-profile-actions button:disabled { opacity: .45; cursor: not-allowed; }
.config-profile-confirm { line-height: 1.6; }
.config-profile-confirm strong { margin-left: 4px; }
@media (max-width: 560px) { .config-profile-item { align-items: flex-start; flex-direction: column; } .config-profile-actions { flex-wrap: wrap; } }
</style>
