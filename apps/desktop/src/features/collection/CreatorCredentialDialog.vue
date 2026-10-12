<template>
  <div v-if="visible" class="cm-modal-mask" data-testid="creator-credential-dialog">
    <div class="cm-modal" role="dialog" aria-modal="true" aria-labelledby="cm-cred-title">
      <div id="cm-cred-title" class="cm-modal-title">{{ $t('collection.creatorCredentialTitle') }}</div>
      <p class="cm-modal-intro">{{ $t('collection.creatorCredentialIntro') }}</p>

      <div class="cm-status" data-testid="creator-credential-status">{{ statusText }}</div>

      <div class="cm-field">
        <label class="cm-field-label" for="creator-credential-input">{{ $t('collection.creatorCredentialLabel') }}</label>
        <input
          id="creator-credential-input"
          v-model="key"
          type="password"
          class="cm-input"
          data-testid="creator-credential-input"
          :placeholder="$t('collection.creatorCredentialPlaceholder')"
          :disabled="busy"
          @keyup.enter="save"
        />
        <div class="cm-hint">{{ $t('collection.creatorCredentialHint') }}</div>
        <div v-if="error" class="cm-field-error" data-testid="creator-credential-error">{{ error }}</div>
      </div>

      <div class="cm-modal-actions">
        <button
          v-if="hasStored"
          class="cohere-btn-secondary"
          data-testid="creator-credential-clear"
          :disabled="busy"
          @click="clear"
        >
          {{ $t('collection.creatorCredentialClear') }}
        </button>
        <button class="cohere-btn-secondary" data-testid="creator-credential-close" :disabled="busy" @click="close">
          {{ $t('collection.creatorCredentialClose') }}
        </button>
        <button
          class="cohere-btn-primary"
          data-testid="creator-credential-save"
          :disabled="busy || !key.trim()"
          @click="save"
        >
          {{ busy ? $t('collection.creatorCredentialSaving') : $t('collection.creatorCredentialSave') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * CreatorCredentialDialog.vue — YouTube Data API v3 密钥配置弹窗
 *
 * 契约真源：`01-docs/PRD-CREATOR-MONITOR-COLLECT-2026-10-07.md` §7.4。四条硬约束：
 *
 * | 约束 | 本组件的落点 |
 * | --- | --- |
 * | 写入方向允许送明文（用户必须在渲染层输入） | 只经 `creatorCredentialSet` 单通道发出 |
 * | 读取方向**永不**回传明文 | 只显示 `{ status, fingerprint }`；组件从不请求明文 |
 * | 保存成功后**立刻清空输入框**、不写任何 store/localStorage | `save()` 成功分支第一件事就是 `key.value = ''` |
 * | `safeStorage` 不可用 → fail-closed（不降级明文） | 主进程返回 `creator:credential_unavailable`，本组件如实显示并**不**假装已保存 |
 *
 * ## 为什么这个弹窗是「必须有」而不是「锦上添花」
 *
 * 2026-10-12 之前，全仓**没有任何**地方能填 YouTube API Key：
 * `container.setup.creator.js` 里读的 `creatorCredentialProvider` 从未注册，
 * 而页面上「未配置 YouTube API Key，请在设置中填写」指向的设置页**没有这个字段**。
 * 也就是说「如何新增要监控的博主」在当时的答案是：做不到。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 主进程回传的四态载荷 { status, fingerprint?, reason? } */
  status: { type: Object, default: null },
})
const emit = defineEmits(['update:visible', 'saved'])

const { t } = useI18n()

const key = ref('')
const busy = ref(false)
const error = ref('')

/** 每次打开清空输入：密钥不该在内存里跨次留存（PRD「用后即弃」） */
watch(() => props.visible, (open) => {
  if (open) {
    key.value = ''
    error.value = ''
  }
})

const hasStored = computed(() => !!(props.status && props.status.status === 'ok'))

const statusText = computed(() => {
  const s = props.status
  if (!s || !s.status) return t('collection.creatorCredentialStatusUnknown')
  if (s.status === 'ok') return t('collection.creatorCredentialStatusOk', { fingerprint: s.fingerprint || '' })
  if (s.status === 'not_configured') return t('collection.creatorCredentialStatusNotConfigured')
  if (s.status === 'unavailable') return t('collection.creatorCredentialStatusUnavailable')
  if (s.status === 'decrypt_failed') return t('collection.creatorCredentialStatusDecryptFailed')
  if (s.status === 'read_failed') return t('collection.creatorCredentialStatusReadFailed')
  return t('collection.creatorCredentialStatusUnknown')
})

function bridge () {
  const b = globalThis.electronAPI
  if (!b || typeof b.creatorCredentialSet !== 'function') return null
  return b
}

function saveErrorText (reason) {
  switch (reason) {
  case 'creator:credential_invalid': return t('collection.creatorCredentialInvalid')
  case 'creator:credential_unavailable': return t('collection.creatorCredentialUnavailable')
  case 'creator:credential_persist_failed': return t('collection.creatorCredentialPersistFailed')
  case 'service-unavailable': return t('collection.creatorErrServiceUnavailable')
  default: return t('collection.creatorCredentialPersistFailed')
  }
}

function close () {
  if (busy.value) return
  emit('update:visible', false)
}

async function save () {
  const value = key.value.trim()
  if (!value || busy.value) return
  const b = bridge()
  if (!b) { error.value = t('collection.creatorErrServiceUnavailable'); return }
  busy.value = true
  error.value = ''
  try {
    const r = await b.creatorCredentialSet({ key: value })
    if (!r || r.code !== 0) {
      error.value = saveErrorText(r && r.reason)
      return
    }
    key.value = '' // 成功即丢弃明文引用（PRD §7.4「保存后清除」）
    if (r.looksLikeGoogleKey === false) {
      // 形态提示**不阻塞**：Google 未来可能改前缀，硬拒会把可用密钥挡在门外
      ElMessage.warning(t('collection.creatorCredentialWarnShape'))
    } else {
      ElMessage.success(t('collection.creatorCredentialSaved', { fingerprint: r.fingerprint || '' }))
    }
    emit('saved')
  } catch (e) {
    error.value = (e && e.message) || t('collection.creatorCredentialPersistFailed')
  } finally {
    busy.value = false
  }
}

async function clear () {
  if (busy.value) return
  const b = bridge()
  if (!b || typeof b.creatorCredentialClear !== 'function') {
    error.value = t('collection.creatorErrServiceUnavailable')
    return
  }
  busy.value = true
  error.value = ''
  try {
    const r = await b.creatorCredentialClear()
    if (!r || r.code !== 0) {
      error.value = saveErrorText(r && r.reason)
      return
    }
    ElMessage.success(t('collection.creatorCredentialCleared'))
    emit('saved')
  } catch (e) {
    error.value = (e && e.message) || t('collection.creatorCredentialPersistFailed')
  } finally {
    busy.value = false
  }
}

defineExpose({ save, clear })
</script>

<style scoped>
.cm-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.cm-modal {
  width: 460px;
  max-width: calc(100vw - 32px);
  background: var(--el-bg-color, #fff);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.cm-modal-title { font-weight: 600; font-size: var(--font-size-lg); }
.cm-modal-intro { margin: 0; color: var(--el-text-color-secondary, #909399); font-size: var(--font-size-xs); }
.cm-status { font-size: var(--font-size-sm); }
.cm-field { display: flex; flex-direction: column; gap: 4px; }
.cm-field-label { font-size: var(--font-size-sm); }
.cm-input {
  padding: 6px 8px;
  border: 1px solid var(--border, #dcdfe6);
  border-radius: 4px;
  font-size: var(--font-size-sm);
}
.cm-hint { color: var(--el-text-color-secondary, #909399); font-size: var(--font-size-xs); }
.cm-field-error { color: var(--el-color-danger, #f56c6c); font-size: var(--font-size-xs); }
.cm-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
