<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card">
      <div class="dialog-header">
        <span class="dialog-title">{{ isEdit ? t('knowledgeBase.edit') : t('knowledgeBase.addViral') }}</span>
        <button class="dialog-close" @click="emit('close')">✕</button>
      </div>

      <div class="dialog-body">
        <div class="cohere-form-item">
          <label class="cohere-form-label">{{ t('knowledgeBase.formTitle') }}</label>
          <input v-model="form.title" class="cohere-input" :placeholder="t('knowledgeBase.formTitle')" />
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">{{ t('knowledgeBase.formLink') }}</label>
          <input v-model="form.url" class="cohere-input" :placeholder="t('knowledgeBase.formLink')" />
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">{{ t('knowledgeBase.formContent') }} <span style="color:var(--danger,#c53b3b)">*</span></label>
          <textarea v-model="form.content" class="cohere-input" rows="5" :placeholder="t('knowledgeBase.formContent')"></textarea>
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">{{ t('knowledgeBase.formAuthor') }}</label>
          <input v-model="form.author" class="cohere-input" :placeholder="t('knowledgeBase.formAuthor')" />
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">{{ t('knowledgeBase.formPlatform') }}</label>
          <input v-model="form.platform" class="cohere-input" :placeholder="t('knowledgeBase.formPlatform')" />
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">{{ t('knowledgeBase.formTags') }}</label>
          <input v-model="tagsText" class="cohere-input" :placeholder="t('knowledgeBase.formTags')" />
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">{{ t('knowledgeBase.colCover') }}</label>
          <input v-model="form.cover_url" class="cohere-input" placeholder="https://..." />
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">{{ t('knowledgeBase.colPublishedAt') }}</label>
          <input v-model="form.published_at" type="date" class="cohere-input" />
        </div>
        <div style="display:flex;gap:8px">
          <div class="cohere-form-item" style="flex:1">
            <label class="cohere-form-label">{{ t('knowledgeBase.colLikes') }}</label>
            <input v-model.number="form.likes" type="number" class="cohere-input" />
          </div>
          <div class="cohere-form-item" style="flex:1">
            <label class="cohere-form-label">{{ t('knowledgeBase.colCollections') }}</label>
            <input v-model.number="form.collections" type="number" class="cohere-input" />
          </div>
          <div class="cohere-form-item" style="flex:1">
            <label class="cohere-form-label">{{ t('knowledgeBase.colComments') }}</label>
            <input v-model.number="form.comments" type="number" class="cohere-input" />
          </div>
        </div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </div>

      <div class="dialog-footer">
        <button class="cohere-btn-secondary" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="cohere-btn-primary" :disabled="saving" @click="submit">{{ saving ? '...' : t('common.save') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { addViralToLibrary, updateViralItem } from '@/api/knowledge-library'

const props = defineProps({
  item: { type: Object, default: null },
})

const emit = defineEmits(['close', 'saved'])
const { t } = useI18n()

const isEdit = computed(() => Boolean(props.item && props.item.id))

const form = ref({
  title: props.item?.title || '',
  url: props.item?.url || '',
  content: props.item?.content || '',
  author: props.item?.author || '',
  platform: props.item?.platform || '',
  cover_url: props.item?.cover_url || '',
  published_at: props.item?.published_at ? props.item.published_at.slice(0, 10) : '',
  likes: props.item?.likes ?? null,
  collections: props.item?.collections ?? null,
  comments: props.item?.comments ?? null,
})

const tagsText = ref((props.item?.tags || []).join(', '))
const saving = ref(false)
const error = ref('')

async function submit () {
  error.value = ''
  const content = (form.value.content || '').trim()
  if (!content) {
    error.value = t('knowledgeBase.contentRequired')
    return
  }
  if (content.length > 50000) {
    error.value = t('knowledgeBase.contentRequired')
    return
  }
  if (form.value.url && !isValidUrl(form.value.url)) {
    error.value = t('knowledgeBase.formLink')
    return
  }

  const payload = {
    title: form.value.title || undefined,
    url: form.value.url || undefined,
    content,
    author: form.value.author || undefined,
    platform: form.value.platform || undefined,
    cover_url: form.value.cover_url || undefined,
    published_at: form.value.published_at || undefined,
    likes: form.value.likes ?? undefined,
    collections: form.value.collections ?? undefined,
    comments: form.value.comments ?? undefined,
    tags: tagsText.value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
  }

  saving.value = true
  try {
    const res = isEdit.value
      ? await updateViralItem(props.item.id, payload)
      : await addViralToLibrary(payload)
    if (res && res.code === 0) {
      ElMessage.success(isEdit.value ? t('knowledgeBase.updateSuccess') : t('knowledgeBase.addSuccess'))
      emit('saved')
      emit('close')
    } else {
      error.value = (res && res.message) || t('knowledgeBase.loadFailed')
    }
  } catch (_e) {
    error.value = t('knowledgeBase.loadFailed')
  } finally {
    saving.value = false
  }
}

function isValidUrl (value) {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch (_e) {
    return false
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.dialog-card {
  width: 560px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: var(--surface, #fff);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.dialog-title { font-size: 15px; font-weight: 600; }
.dialog-close {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--muted);
}
.dialog-body { margin-bottom: 12px; }
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.cohere-form-item { margin-bottom: 10px; }
.cohere-form-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  margin-bottom: 4px;
}
.cohere-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.cohere-input:focus { border-color: var(--coral); }
.form-error { color: var(--danger, #c53b3b); font-size: 12px; margin: 4px 0 0; }
.cohere-btn-primary {
  padding: 8px 16px;
  background: var(--coral, #f56c6c);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.cohere-btn-primary:disabled { opacity: 0.5; cursor: default; }
.cohere-btn-secondary {
  padding: 8px 16px;
  background: var(--surface, #fff);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.cohere-btn-secondary:hover { border-color: var(--coral); color: var(--coral); }
</style>
