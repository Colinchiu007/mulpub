<template>
  <div v-if="visible" class="qc-modal-mask" data-testid="quick-collect-dialog">
    <div class="qc-modal" role="dialog" aria-modal="true">
      <div class="qc-modal-title" data-testid="quick-collect-dialog-title">
        {{ isEdit ? $t('collection.quickCollect.dialogEditTitle') : $t('collection.quickCollect.dialogAddTitle') }}
      </div>
      <p class="qc-modal-intro">{{ $t('collection.quickCollect.dialogIntro') }}</p>

      <!-- 标题 -->
      <div class="qc-field">
        <label class="qc-field-label" for="qc-title">
          {{ $t('collection.quickCollect.titleLabel') }}
          <span class="qc-counter" :class="{ 'qc-counter--over': title.length > LIMITS.TITLE_MAX }">
            {{ $t('collection.quickCollect.titleCounter', { count: String(title.length) }) }}
          </span>
        </label>
        <input
          id="qc-title"
          v-model="title"
          class="qc-input"
          data-testid="quick-collect-title-input"
          :placeholder="$t('collection.quickCollect.titlePlaceholder')"
          @blur="validateField('title')"
        />
        <div class="qc-hint">{{ $t('collection.quickCollect.titleHint') }}</div>
        <div v-if="errors.title" class="qc-field-error" data-testid="quick-collect-title-error">{{ errorText(errors.title) }}</div>
      </div>

      <!-- 指令正文 -->
      <div class="qc-field">
        <label class="qc-field-label" for="qc-prompt">
          {{ $t('collection.quickCollect.promptLabel') }}
          <span class="qc-counter" :class="{ 'qc-counter--over': prompt.length > LIMITS.PROMPT_MAX }">
            {{ $t('collection.quickCollect.promptCounter', { count: String(prompt.length) }) }}
          </span>
        </label>
        <textarea
          id="qc-prompt"
          v-model="prompt"
          class="qc-textarea"
          rows="7"
          data-testid="quick-collect-prompt-input"
          :placeholder="$t('collection.quickCollect.promptPlaceholder')"
          @blur="validateField('prompt')"
        ></textarea>
        <div class="qc-hint">{{ $t('collection.quickCollect.promptHint') }}</div>
        <div v-if="errors.prompt" class="qc-field-error" data-testid="quick-collect-prompt-error">{{ errorText(errors.prompt) }}</div>
      </div>

      <!-- 关键词 -->
      <div class="qc-field">
        <label class="qc-field-label" for="qc-keywords">{{ $t('collection.quickCollect.keywordsFieldLabel') }}</label>
        <input
          id="qc-keywords"
          v-model="keywords"
          class="qc-input"
          data-testid="quick-collect-keywords-input"
          :placeholder="$t('collection.quickCollect.keywordsPlaceholder')"
          @blur="validateField('keywords')"
        />
        <div class="qc-hint">{{ $t('collection.quickCollect.keywordsHint') }}</div>
        <div v-if="errors.keywords" class="qc-field-error" data-testid="quick-collect-keywords-error">{{ errorText(errors.keywords) }}</div>
      </div>

      <!-- 时间范围 -->
      <div class="qc-field">
        <label class="qc-field-label" for="qc-window">{{ $t('collection.quickCollect.windowFieldLabel') }}</label>
        <select id="qc-window" v-model="windowHours" class="qc-input" data-testid="quick-collect-window-select">
          <option v-for="h in WINDOW_HOURS" :key="h" :value="h">{{ windowText(h) }}</option>
        </select>
        <div class="qc-hint">{{ $t('collection.quickCollect.sourcesLabel') }}</div>
      </div>

      <div class="qc-modal-actions">
        <button class="cohere-btn-secondary" data-testid="quick-collect-cancel" @click="close">
          {{ $t('collection.quickCollect.cancel') }}
        </button>
        <button class="cohere-btn-primary" data-testid="quick-collect-save" @click="submit">
          {{ $t('collection.quickCollect.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * QuickCollectCommandDialog.vue — 快捷采集指令的新增/编辑弹窗
 *
 * 校验判据全部来自 `quick-collect-commands.js`（与主进程同一组边界），
 * 本组件只负责：字段绑定、计数器、内联错误渲染、"提交时全量校验"。
 *
 * 关闭方式由父组件通过 `update:visible` 控制；保存成功与否由父组件决定
 * （本组件emit 后不自行关闭 —— 父组件保存失败时不应把用户输入扔掉）。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { WINDOW_HOURS, LIMITS, validateCommandForm } from './quick-collect-commands'

const props = defineProps({
  visible: { type: Boolean, default: false },
  command: { type: Object, default: null },
  existing: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:visible', 'save'])

const { t } = useI18n()

const title = ref('')
const prompt = ref('')
const keywords = ref('')
const windowHours = ref(48)
const errors = ref({})

const isEdit = computed(() => !!(props.command && props.command.id))

function resetFromCommand () {
  const c = props.command || {}
  title.value = typeof c.title === 'string' ? c.title : ''
  prompt.value = typeof c.prompt === 'string' ? c.prompt : ''
  keywords.value = Array.isArray(c.keywords) ? c.keywords.join(', ') : ''
  windowHours.value = WINDOW_HOURS.includes(Number(c.windowHours)) ? Number(c.windowHours) : 48
  errors.value = {}
}

// `immediate: true` 是必须的：弹窗组件在挂载时 `visible` 可能已经是 true
// （父组件打开后才挂载 / 直接以编辑态渲染），没有它编辑态会显示空表单 ——
// 用户点"保存"就会用空值覆盖原指令。
watch(
  () => [props.visible, props.command && props.command.id],
  ([open]) => { if (open) resetFromCommand() },
  { immediate: true },
)

function windowText (h) {
  if (h === 24) return t('collection.quickCollect.window24')
  if (h === 48) return t('collection.quickCollect.window48')
  if (h === 168) return t('collection.quickCollect.window168')
  return t('collection.quickCollect.window0')
}

function errorText (key) {
  return key ? t('collection.quickCollect.' + key) : ''
}

/** 单字段即时校验（blur 时只报该字段，避免用户一进来就被红字追着跑） */
function validateField (field) {
  const result = validateCommandForm(
    { title: title.value, prompt: prompt.value, keywords: keywords.value, windowHours: windowHours.value },
    { existing: props.existing, excludeId: props.command && props.command.id },
  )
  const next = { ...errors.value }
  if (result.errors[field]) next[field] = result.errors[field]
  else delete next[field]
  errors.value = next
}

function submit () {
  const form = { title: title.value, prompt: prompt.value, keywords: keywords.value, windowHours: windowHours.value }
  const result = validateCommandForm(form, { existing: props.existing, excludeId: props.command && props.command.id })
  errors.value = result.errors
  if (!result.ok) return
  emit('save', form)
}

function close () {
  emit('update:visible', false)
}

defineExpose({ submit, validateField })
</script>
