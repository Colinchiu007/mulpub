<template>
  <div class="copy-rewrite-overlay" data-testid="copy-rewrite-overlay" @click.self="onCancel">
    <div
      class="copy-rewrite-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('collection.libraryRewriteModalTitle')"
      data-testid="copy-rewrite-modal"
    >
      <header class="copy-rewrite-header">
        <h3 class="copy-rewrite-title">{{ t('collection.libraryRewriteModalTitle') }}</h3>
        <button
          type="button"
          class="copy-rewrite-close"
          :aria-label="t('collection.libraryClose')"
          data-testid="copy-rewrite-close"
          @click="onCancel"
        >✕</button>
      </header>

      <div class="copy-rewrite-body">
        <!-- 原文（改写输入，只读展示） -->
        <div class="config-row">
          <label class="cohere-form-label">{{ t('collection.librarySourceSection') }}</label>
          <div class="copy-rewrite-source-title" data-testid="copy-rewrite-source-title">
            {{ sourceTitle || t('collection.libraryUntitled') }}
          </div>
          <textarea
            class="copy-rewrite-source"
            rows="4"
            readonly
            data-testid="copy-rewrite-source"
            :value="sourceContent"
          ></textarea>
          <div class="copy-rewrite-source-meta" data-testid="copy-rewrite-source-meta">
            {{ sourceMeta }}
          </div>
        </div>

        <div class="cohere-section-title">{{ t('collection.libraryRewriteOptions') }}</div>

        <!-- 改写模式 -->
        <div class="config-row">
          <label class="cohere-form-label">{{ t('rewritePage.modeLabel') }}</label>
          <div class="mode-chips">
            <button
              v-for="m in REWRITE_MODES"
              :key="m.value"
              type="button"
              :class="['mode-chip', { active: mode === m.value }]"
              :disabled="rewriting"
              :data-testid="'copy-rewrite-mode-' + m.value"
              @click="mode = m.value"
            >{{ t(m.labelKey) }}</button>
          </div>
        </div>

        <!-- 改写风格（语气） -->
        <div class="config-row">
          <label class="cohere-form-label">{{ t('collection.libraryRewriteStyle') }}</label>
          <select v-model="style" class="cohere-input config-select" :disabled="rewriting" data-testid="copy-rewrite-style">
            <option v-for="s in REWRITE_STYLES" :key="s.value" :value="s.value">{{ t(s.labelKey) }}</option>
          </select>
        </div>

        <!-- 改写参考（知识库） -->
        <div class="config-row">
          <label class="cohere-form-label">{{ t('collection.libraryRewriteKnowledge') }}</label>
          <div class="config-checkboxes">
            <label class="config-checkbox" :class="{ disabled: rewriting }">
              <span class="checkbox-label">
                <input type="checkbox" v-model="useViralLibrary" :disabled="rewriting" class="coral-check" data-testid="copy-rewrite-viral" />
                <span>{{ t('rewritePage.useViralLibrary') }}</span>
              </span>
              <span class="checkbox-hint">{{ t('rewritePage.useViralLibraryHint') }}</span>
            </label>
            <label class="config-checkbox" :class="{ disabled: rewriting }">
              <span class="checkbox-label">
                <input type="checkbox" v-model="usePersonalExperience" :disabled="rewriting" class="coral-check" data-testid="copy-rewrite-personal" />
                <span>{{ t('rewritePage.usePersonalExperience') }}</span>
              </span>
              <span class="checkbox-hint">{{ t('rewritePage.usePersonalExperienceHint') }}</span>
            </label>
          </div>
        </div>

        <!-- 目标字数 -->
        <div class="config-row">
          <label class="cohere-form-label">{{ t('collection.libraryRewriteLength') }}</label>
          <WordCountRangeInput
            v-model:min="wordCountMin"
            v-model:max="wordCountMax"
            :label="t('collection.wordCountLabel')"
            :min-placeholder="t('collection.wordCountMinPlaceholder')"
            :max-placeholder="t('collection.wordCountMaxPlaceholder')"
            :unit="t('collection.wordCountUnit')"
            :error="wordCountError"
            :disabled="rewriting"
          />
        </div>

        <!-- 目标平台 -->
        <div class="config-row">
          <label class="cohere-form-label">{{ t('collection.libraryRewritePlatform') }}</label>
          <select v-model="platform" class="cohere-input config-select" :disabled="rewriting" data-testid="copy-rewrite-platform">
            <option v-for="p in REWRITE_PLATFORMS" :key="p.value" :value="p.value">{{ t(p.labelKey) }}</option>
          </select>
        </div>

        <!-- 改写策略 -->
        <RewriteStrategyPicker
          v-model:strategy-mode="strategyMode"
          v-model:strategy-id="strategyId"
          :strategies="strategies"
          :preview-name="previewName"
          :disabled="rewriting"
          :labels="strategyLabels"
        />

        <div v-if="errorText" class="copy-rewrite-error" role="alert" data-testid="copy-rewrite-error">
          {{ errorText }}
        </div>

        <!-- 改写结果 -->
        <div v-if="result" class="config-row" data-testid="copy-rewrite-result-section">
          <label class="cohere-form-label">{{ t('collection.libraryResultSection') }}</label>
          <textarea class="copy-rewrite-result" rows="6" readonly :value="result"></textarea>
          <div class="copy-rewrite-done">{{ t('collection.libraryRewriteDone') }}</div>
        </div>
      </div>

      <footer class="copy-rewrite-footer">
        <button type="button" class="cohere-btn-secondary" :disabled="rewriting" @click="onCancel">
          {{ t('collection.libraryClose') }}
        </button>
        <button
          type="button"
          class="cohere-btn-primary"
          data-testid="copy-rewrite-start"
          :disabled="rewriting || !canStart"
          @click="start"
        >
          {{ rewriting ? t('collection.libraryRewriteStarting') : t('collection.libraryRewriteStart') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
/**
 * CopyRewriteModal — 文案库「改写」弹窗
 *
 * 职责：承载改写相关的**全部选项**（模式 / 风格 / 知识参考 / 目标字数 / 目标平台 / 策略），
 * 调用 aiRewrite 执行改写，成功后把结果通过 `rewritten` 事件交给父组件持久化到文案库。
 * 本组件不做存储（持久化归 useCopyLibrary），便于单测与复用。
 *
 * 选项取值一律用引擎侧 ASCII 枚举（tone / mode / platform id），文案全部走 i18n，
 * 符合 check-locale-sync 的「渲染端零硬编码中文」门禁。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { aiRewrite, aiListRewriteStrategies, aiGetRecommendedStrategies } from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'
import { formatUserError } from '@/utils/user-facing-error'
import { useWordCountValidation } from '@/composables/useWordCountValidation'
import RewriteStrategyPicker from '@/components/RewriteStrategyPicker.vue'
import WordCountRangeInput from '@/components/WordCountRangeInput.vue'

const props = defineProps({
  /** 待改写文案：{ title, content, origin, fromKey, platform, sourceUrl } */
  source: { type: Object, default: null },
})

const emit = defineEmits(['close', 'rewritten'])

const { t } = useI18n()
const { notifyError } = useNotify()

// ── 选项定义（value 为引擎侧枚举；label 走 i18n）──
const REWRITE_MODES = [
  { value: 'imitate', labelKey: 'rewritePage.modeImitate' },
  { value: 'expand', labelKey: 'rewritePage.modeExpand' },
  { value: 'create', labelKey: 'rewritePage.modeCreate' },
]
const REWRITE_STYLES = [
  { value: 'casual', labelKey: 'collection.rewriteStyleEasy' },
  { value: 'formal', labelKey: 'collection.rewriteStyleFormal' },
  { value: 'catchy', labelKey: 'collection.rewriteStyleEyeCatching' },
  { value: 'professional', labelKey: 'collection.rewriteStyleDeep' },
  { value: 'anchor', labelKey: 'collection.rewriteStyleCognitive' },
]
const REWRITE_PLATFORMS = [
  { value: '', labelKey: 'rewriteEngine.platformGeneral' },
  { value: 'douyin', labelKey: 'rewriteEngine.platformDouyin' },
  { value: 'xiaohongshu', labelKey: 'rewriteEngine.platformXiaohongshu' },
  { value: 'wechat_mp', labelKey: 'rewriteEngine.platformWechatMp' },
  { value: 'bilibili', labelKey: 'rewriteEngine.platformBilibili' },
  { value: 'zhihu', labelKey: 'rewriteEngine.platformZhihu' },
]

// ── 表单状态 ──
const mode = ref('imitate')
const style = ref('casual')
const platform = ref('')
const wordCountMin = ref(800)
const wordCountMax = ref(2000)
const useViralLibrary = ref(true)
const usePersonalExperience = ref(false)
const strategyMode = ref('auto')
const strategyId = ref('')
const strategies = ref([])
const previewName = ref('--')

const rewriting = ref(false)
const errorText = ref('')
const result = ref('')

const sourceTitle = computed(() => String((props.source && props.source.title) || '').trim())
const sourceContent = computed(() => String((props.source && props.source.content) || ''))
const sourceMeta = computed(() => t('collection.libraryWordCount', { count: [...sourceContent.value].length }))

const canStart = computed(() => sourceContent.value.trim().length > 0 && !wordCountError.value)

const { error: wordCountError } = useWordCountValidation(
  wordCountMin,
  wordCountMax,
  (key) => t('collection.' + key)
)

const strategyLabels = computed(() => ({
  label: t('rewritePage.strategyLabel'),
  auto: t('rewritePage.strategyAuto'),
  manual: t('rewritePage.strategyManual'),
  preview: t('rewritePage.strategyPreview'),
  previewColon: t('rewritePage.strategyPreviewColon'),
  placeholder: t('rewritePage.strategySelectPlaceholder'),
}))

// ── 策略列表与自动匹配预览 ──
async function loadStrategies () {
  try {
    const res = await aiListRewriteStrategies()
    if (res && res.code === 0) strategies.value = res.data || []
  } catch {
    // 策略列表不可用时改写仍可发起（自动匹配兜底）
  }
}

/** 预览请求序列号：快速切换平台时只保留最后一次结果（竞态防护） */
let previewSeq = 0

async function refreshPreview () {
  if (rewriting.value) return
  const seq = ++previewSeq
  try {
    const res = await aiGetRecommendedStrategies({ platform: platform.value || undefined })
    if (seq !== previewSeq) return
    const first = res && res.code === 0 && Array.isArray(res.data) ? res.data[0] : null
    previewName.value = (first && first.name) || '--'
  } catch {
    if (seq === previewSeq) previewName.value = '--'
  }
}

watch(platform, refreshPreview)

onMounted(() => {
  void loadStrategies()
  void refreshPreview()
})

// ── 行为 ──
function onCancel () {
  if (rewriting.value) return
  emit('close')
}

/** 字数区间 → targetLength 三档语义（与采集页既有映射保持一致，wordCountRange 仍是主约束） */
function deriveTargetLength (minW, maxW) {
  if (maxW <= 800) return 'short'
  if (minW >= 1500 || maxW >= 2500) return 'long'
  return 'medium'
}

function buildParams (content) {
  const minW = Number(wordCountMin.value) || 800
  const maxW = Number(wordCountMax.value) || 2000
  return {
    mode: mode.value,
    content,
    userSettings: {
      tone: style.value,
      platform: platform.value || undefined,
      wordCountRange: { min: minW, max: maxW },
      targetLength: deriveTargetLength(minW, maxW),
      knowledgeOptions: {
        useViralLibrary: useViralLibrary.value,
        usePersonalKnowledge: usePersonalExperience.value,
      },
    },
    strategyId: strategyMode.value === 'manual' ? (strategyId.value || null) : null,
  }
}

async function start () {
  const content = sourceContent.value.trim()
  if (!content) {
    errorText.value = t('collection.libraryRewriteNoContent')
    return
  }
  if (wordCountError.value) {
    errorText.value = wordCountError.value
    return
  }
  rewriting.value = true
  errorText.value = ''
  result.value = ''
  try {
    const res = await aiRewrite(buildParams(content))
    if (res && res.code === 0 && res.data && res.data.success && res.data.result) {
      result.value = res.data.result
      emit('rewritten', {
        fromKey: (props.source && props.source.fromKey) || '',
        fromTitle: sourceTitle.value,
        title: sourceTitle.value,
        content: res.data.result,
        platform: platform.value || '',
        sourceUrl: (props.source && props.source.sourceUrl) || '',
      })
    } else {
      const errorSource = (res && res.__error) || res || {}
      errorText.value = formatUserError(errorSource, { fallback: t('collection.rewriteFailed') }).message
      notifyError('collection.rewriteFailed', { message: errorText.value })
    }
  } catch (e) {
    errorText.value = formatUserError(e, { fallback: t('collection.rewriteFailed') }).message
    notifyError('collection.rewriteFailed', { message: errorText.value })
  } finally {
    rewriting.value = false
    refreshPreview()
  }
}
</script>

<style scoped>
.copy-rewrite-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(23, 23, 32, 0.45);
  padding: 20px;
}

.copy-rewrite-modal {
  width: min(720px, 100%);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--surface, #fff);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.copy-rewrite-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 24px 12px;
  flex-shrink: 0;
}

.copy-rewrite-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary, #25252b);
}

.copy-rewrite-close {
  border: none;
  background: transparent;
  color: var(--muted, #73777d);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.copy-rewrite-close:hover { background: var(--soft-stone, #f5f5f5); color: var(--text-primary); }

.copy-rewrite-body {
  padding: 0 24px 8px;
  overflow-y: auto;
  min-height: 0;
}

.copy-rewrite-source-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.copy-rewrite-source,
.copy-rewrite-result {
  width: 100%;
  border: 1px solid var(--border, #e5e5ea);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.6;
  font-family: inherit;
  background: var(--soft-stone, #f7f7f8);
  color: var(--text-secondary, #666);
  box-sizing: border-box;
  resize: vertical;
}

.copy-rewrite-result {
  background: #fff;
  color: var(--text-primary, #25252b);
}

.copy-rewrite-source-meta,
.copy-rewrite-done {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted, #73777d);
}

.copy-rewrite-done { color: var(--primary, #ea580c); }

.copy-rewrite-error {
  margin: 8px 0;
  padding: 6px 10px;
  border-radius: 6px;
  background: #fff3f3;
  color: #d32f2f;
  font-size: 12px;
}

.copy-rewrite-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 24px 20px;
  border-top: 1px solid var(--border-subtle, #eeeeef);
  flex-shrink: 0;
}

.config-row { margin-bottom: 14px; }
.cohere-form-label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.config-select { max-width: 320px; }
.config-checkboxes { display: flex; flex-direction: column; gap: 8px; }
.config-checkbox { display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
.config-checkbox.disabled { opacity: 0.6; cursor: default; }
.checkbox-label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-primary); }
.checkbox-hint { font-size: 12px; color: var(--muted); margin-left: 20px; }
.coral-check { accent-color: var(--coral); }
.mode-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.mode-chip {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: all 0.15s;
}
.mode-chip:hover { border-color: var(--coral); }
.mode-chip.active { border-color: var(--coral); background: var(--coral-bg, #fef2f2); color: var(--coral); font-weight: 500; }
.mode-chip:disabled { opacity: 0.5; cursor: default; }

@media (max-width: 768px) {
  .copy-rewrite-modal { max-height: 92vh; }
  .copy-rewrite-body { padding: 0 16px 8px; }
  .copy-rewrite-header, .copy-rewrite-footer { padding-left: 16px; padding-right: 16px; }
}
</style>
