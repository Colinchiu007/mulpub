<template>
  <div class="quick-render">
    <!-- 模式 tab：AI 模式按 provider 能力显示，图片轮播是本地 Remotion 路径 -->
    <div class="mode-tabs" role="tablist">
      <button
        v-for="m in modes"
        :key="m.value"
        type="button"
        role="tab"
        :aria-selected="mode === m.value"
        :class="['mode-tab', { active: mode === m.value }]"
        :data-testid="`quick-mode-${m.value}`"
        @click="selectMode(m.value)"
      >{{ m.label }}</button>
    </div>

    <!-- ── AI 视频（文生 / 首尾帧 / 参考素材） ── -->
    <template v-if="isAiMode">
      <div class="form-group">
        <label>{{ $t('create.story2video.ui.quickPromptLabel') }}</label>
        <textarea
          v-model="prompt"
          rows="6"
          class="form-input textarea"
          data-testid="quick-ai-prompt"
          :placeholder="$t('create.story2video.ui.quickPromptPlaceholder')"
        ></textarea>
        <p class="text-muted quick-hint">{{ $t('create.story2video.ui.quickPromptHint') }}</p>
        <button class="btn-secondary" :disabled="aiLoading" data-testid="quick-ai-write" @click="aiWrite">
          {{ aiLoading ? $t('create.story2video.ui.quickAiWriting') : $t('create.story2video.ui.quickAiWrite') }}
        </button>
      </div>

      <QuickRenderMaterials
        :mode="mode"
        :frames="frames"
        :reference-images="referenceImages"
        :reference-audios="referenceAudios"
        :gallery-images="galleryImages"
        :max-images="maxImages"
        :max-audios="maxAudios"
        @pick-frame="pickFrame"
        @pick-images="pickImages"
        @pick-audios="pickAudios"
        @pick-gallery="pickGallery"
        @drop-frame="pushFrame"
        @drop-images="pushImages"
        @drop-audios="pushAudios"
        @drop-gallery="pushGallery"
        @remove-frame="clearFrame"
        @remove-image="(i) => referenceImages.splice(i, 1)"
        @remove-audio="(i) => referenceAudios.splice(i, 1)"
        @remove-gallery="(i) => galleryImages.splice(i, 1)"
      />

      <div class="form-group">
        <label>{{ $t('create.story2video.ui.quickOutputProfileLabel') }}</label>
        <UiSelect v-model="profile" :options="profileOptions" testid="quick-profile" />
      </div>

      <div class="form-group">
        <label>{{ $t('create.story2video.ui.quickDurationLabel') }}</label>
        <UiSelect v-model="seconds" :options="secondsOptions" testid="quick-seconds" />
      </div>

      <div class="form-group">
        <label>{{ $t('create.story2video.ui.quickSeedLabel') }}</label>
        <input v-model="seedInput" type="number" class="form-input" data-testid="quick-seed" />
        <p class="text-muted quick-hint">{{ $t('create.story2video.ui.quickSeedHint') }}</p>
      </div>

      <div class="form-group" v-if="sizeOptions.length > 0">
        <label>{{ $t('create.story2video.ui.quickResolutionLabel') }}</label>
        <UiSelect v-model="size" :options="sizeOptions" :disabled="sizeOptions.length <= 1" testid="quick-size" />
      </div>
    </template>

    <!-- ── 图片轮播（本地 Remotion，不调 AI 视频模型） ── -->
    <template v-else>
      <QuickRenderMaterials
        mode="gallery"
        :frames="frames"
        :reference-images="referenceImages"
        :reference-audios="referenceAudios"
        :gallery-images="galleryImages"
        @pick-gallery="pickGallery"
        @drop-gallery="pushGallery"
        @remove-gallery="(i) => galleryImages.splice(i, 1)"
      />

      <div class="form-group">
        <label>{{ $t('create.story2video.ui.quickOutputProfileLabel') }}</label>
        <UiSelect v-model="profile" :options="profileOptions" testid="quick-gallery-profile" />
      </div>

      <div class="form-group">
        <label>{{ $t('create.story2video.ui.quickThemeLabel') }}</label>
        <UiSelect v-model="theme" :options="themeOptions" testid="quick-theme" />
      </div>
    </template>

    <div class="actions">
      <UiButton data-testid="quick-start" :disabled="!canStart || rendering" @click="start">
        {{ rendering ? $t('create.story2video.ui.quickRendering') : $t('create.story2video.ui.quickStart') }}
      </UiButton>
      <button v-if="rendering" class="btn-secondary" data-testid="quick-cancel" @click="cancel">
        {{ $t('create.story2video.ui.quickCancel') }}
      </button>
    </div>

    <div v-if="rendering" class="progress-section">
      <div class="progress-bar"><div class="progress-fill" :style="{ width: progress + '%' }"></div></div>
      <p class="progress-text" data-testid="quick-progress">{{ progress }}% — {{ stage }}</p>
    </div>

    <div v-if="result" class="result-banner success">
      <p>{{ $t('create.story2video.ui.quickCompleted') }}</p>
      <UiButton data-testid="quick-view-result" @click="viewResult">{{ $t('create.story2video.ui.quickViewVideo') }}</UiButton>
    </div>

    <div v-if="error" class="result-banner error">
      <p data-testid="quick-error">{{ error }}</p>
      <button class="btn-secondary" data-testid="quick-retry" @click="error = ''">{{ $t('create.story2video.ui.quickRetry') }}</button>
    </div>

    <input ref="imageInput" data-testid="quick-image-input" type="file" accept="image/*" multiple style="display:none" @change="onImagesPicked" />
    <input ref="audioInput" data-testid="quick-audio-input" type="file" accept="audio/*" multiple style="display:none" @change="onAudiosPicked" />
    <input ref="frameInput" data-testid="quick-frame-input" type="file" accept="image/*" style="display:none" @change="onFramePicked" />
    <input ref="galleryInput" data-testid="quick-gallery-input" type="file" accept="image/*" multiple style="display:none" @change="onGalleryPicked" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '@/components/UiButton.vue'
import UiSelect from '@/components/UiSelect.vue'
import { STYLES } from '@/domain/pipeline-constants'
import { renderAiVideoCapabilities, renderStart, renderStartAiVideo, renderCancel, onRenderProgress, onRenderComplete, onRenderError } from '@/api/publisher'
import { validateVideoRequest, AGNES_VIDEO_REQUEST_ERRORS } from '@multi-publish/shared-utils/src/agnes-video-request'
import { formatUserError } from '@/utils/user-facing-error'
import QuickRenderMaterials from './QuickRenderMaterials.vue'
import { useQuickRenderMaterials } from './useQuickRenderMaterials'
import {
  PROFILE_ASPECT_RATIO, DEFAULT_ASPECT_RATIO, SECONDS_MIN, SECONDS_MAX,
  DEFAULT_SECONDS, DEFAULT_PROFILE, DEFAULT_THEME,
} from './quick-render-constants'

const { t } = useI18n()
const emit = defineEmits(['view-result'])

/** 模式 → 领域错误码 → locale key（错误文案一律走 locale，不硬编码） */
const MODE_ERROR_KEY = Object.freeze({
  [AGNES_VIDEO_REQUEST_ERRORS.MODE_UNSUPPORTED]: 'create.story2video.ui.quickError.modeUnsupported',
  [AGNES_VIDEO_REQUEST_ERRORS.TEXT_DISALLOWS_MEDIA]: 'create.story2video.ui.quickError.textDisallowsMedia',
  [AGNES_VIDEO_REQUEST_ERRORS.KEYFRAME_REQUIRES_FRAME]: 'create.story2video.ui.quickError.keyframeRequiresFrame',
  [AGNES_VIDEO_REQUEST_ERRORS.KEYFRAME_DISALLOWS_REFERENCE]: 'create.story2video.ui.quickError.keyframeDisallowsReference',
  [AGNES_VIDEO_REQUEST_ERRORS.REFERENCE_REQUIRES_MEDIA]: 'create.story2video.ui.quickError.referenceRequiresMedia',
  [AGNES_VIDEO_REQUEST_ERRORS.REFERENCE_DISALLOWS_FRAMES]: 'create.story2video.ui.quickError.referenceDisallowsFrames',
})

const mode = ref('text')
const prompt = ref('')
const theme = ref(DEFAULT_THEME)
const profile = ref(DEFAULT_PROFILE)
const seconds = ref(String(DEFAULT_SECONDS))
const size = ref('')
const seedInput = ref('')
const referenceImages = ref([])
const referenceAudios = ref([])
const galleryImages = ref([])
const frames = ref({ first: null, last: null })
const rendering = ref(false)
const progress = ref(0)
const stage = ref('')
const result = ref(null)
const error = ref('')
const aiLoading = ref(false)
const capabilities = ref(null)

const imageInput = ref(null)
const audioInput = ref(null)
const frameInput = ref(null)
const galleryInput = ref(null)
let pendingFrameSlot = 'first'

const cleanups = []

const materials = useQuickRenderMaterials({
  t,
  maxImages: () => maxImages.value,
  maxAudios: () => maxAudios.value,
  frames,
  referenceImages,
  referenceAudios,
  galleryImages,
  onError: (message) => { error.value = message },
})

const isAiMode = computed(() => mode.value !== 'gallery')
const maxImages = computed(() => (capabilities.value && capabilities.value.maxImages) || 0)
const maxAudios = computed(() => (capabilities.value && capabilities.value.maxAudios) || 0)

const modes = computed(() => {
  const list = []
  const caps = capabilities.value
  const aiModes = caps && Array.isArray(caps.modes) ? caps.modes : ['text']
  if (aiModes.includes('text')) list.push({ value: 'text', label: t('create.story2video.ui.quickModeText') })
  if (aiModes.includes('keyframe')) list.push({ value: 'keyframe', label: t('create.story2video.ui.quickModeKeyframe') })
  if (aiModes.includes('reference')) list.push({ value: 'reference', label: t('create.story2video.ui.quickModeReference') })
  list.push({ value: 'gallery', label: t('create.story2video.ui.quickModeGallery') })
  return list
})

const profileOptions = computed(() => [
  { value: 'youtube-landscape', label: t('create.story2video.ui.quickProfileYouTube') },
  { value: 'youtube-shorts', label: 'YouTube Shorts (1080x1920)' },
  { value: 'tiktok', label: t('create.story2video.ui.quickProfileTikTok') },
  { value: 'bilibili', label: 'Bilibili (1920x1080)' },
  { value: 'wechat', label: t('create.story2video.ui.quickProfileWechat') },
  { value: 'xiaohongshu', label: t('create.story2video.ui.quickProfileXiaohongshu') },
])

const themeOptions = computed(() => STYLES.map((s) => ({ value: s.value, label: s.label })))

const secondsOptions = computed(() => {
  const out = []
  for (let s = SECONDS_MIN; s <= SECONDS_MAX; s += 1) out.push({ value: String(s), label: `${s}s` })
  return out
})

const sizeOptions = computed(() => {
  const caps = capabilities.value
  const sizes = caps && Array.isArray(caps.sizes) ? caps.sizes : []
  return sizes.map((s) => ({ value: s, label: s }))
})

const aspectRatio = computed(() => PROFILE_ASPECT_RATIO[profile.value] || DEFAULT_ASPECT_RATIO)

/** 当前模式与素材是否自洽（与主进程共用同一判据） */
const contract = computed(() => validateVideoRequest({
  mode: isAiMode.value ? mode.value : 'text',
  images: referenceImages.value.map((i) => i.dataUrl),
  audios: referenceAudios.value.map((a) => a.dataUrl),
  firstFrame: frames.value.first ? frames.value.first.dataUrl : '',
  lastFrame: frames.value.last ? frames.value.last.dataUrl : '',
}))

const canStart = computed(() => {
  if (rendering.value) return false
  if (!isAiMode.value) return galleryImages.value.length > 0
  if (!prompt.value.trim()) return false
  return contract.value.ok
})

function selectMode (next) {
  mode.value = next
  error.value = ''
  result.value = null
}

function localizeModeError (code) {
  const key = MODE_ERROR_KEY[code]
  return key ? t(key) : t('create.story2video.ui.quickError.generic')
}

function pickImages () { if (imageInput.value) imageInput.value.click() }
function pickAudios () { if (audioInput.value) audioInput.value.click() }
function pickGallery () { if (galleryInput.value) galleryInput.value.click() }
function pickFrame (slot) {
  pendingFrameSlot = slot
  if (frameInput.value) frameInput.value.click()
}

async function onImagesPicked (e) { await materials.pushImages(e.target.files); e.target.value = '' }
async function onAudiosPicked (e) { await materials.pushAudios(e.target.files); e.target.value = '' }
async function onGalleryPicked (e) { await materials.pushGallery(e.target.files); e.target.value = '' }
async function onFramePicked (e) { await materials.pushFrame(pendingFrameSlot, e.target.files); e.target.value = '' }

async function loadCapabilities () {
  try {
    const res = await renderAiVideoCapabilities()
    if (res && res.code === 0 && res.data) {
      capabilities.value = res.data.capabilities || null
      const sizes = capabilities.value && Array.isArray(capabilities.value.sizes) ? capabilities.value.sizes : []
      if (sizes.length && !sizes.includes(size.value)) size.value = sizes[0]
    }
  } catch (e) {
    capabilities.value = null
  }
}

async function aiWrite () {
  aiLoading.value = true
  try {
    const { aiGenerate, modelProviderGetDefault } = await import('@/api/publisher')
    const def = await modelProviderGetDefault('llm')
    const providerId = def && def.code === 0 && def.data && def.data.id ? def.data.id : null
    const r = await aiGenerate('llm', providerId, { prompt: t('create.story2video.ui.quickAiWritePrompt') + theme.value })
    if (r && r.code === 0 && r.data && r.data.content) prompt.value = r.data.content
  } catch (e) {
    error.value = t('create.story2video.ui.quickError.aiWriteFailed')
  } finally {
    aiLoading.value = false
  }
}

async function start () {
  error.value = ''
  result.value = null
  if (!canStart.value) return

  if (!isAiMode.value) {
    await startGallery()
    return
  }

  const check = contract.value
  if (!check.ok) {
    error.value = localizeModeError(check.code)
    return
  }

  rendering.value = true
  progress.value = 2
  stage.value = t('create.story2video.ui.quickStageSubmitting')
  const seedValue = seedInput.value === '' || seedInput.value === null ? undefined : Number(seedInput.value)
  const payload = {
    prompt: prompt.value.trim(),
    mode: mode.value,
    aspectRatio: aspectRatio.value,
    seconds: Number(seconds.value),
    seed: Number.isFinite(seedValue) ? seedValue : undefined,
    // 分辨率档位：只有模型声明支持多档时才下发（单档位模型由适配器取默认档）
    size: size.value || undefined,
  }
  if (mode.value === 'keyframe') {
    payload.firstFrame = frames.value.first ? frames.value.first.dataUrl : undefined
    payload.lastFrame = frames.value.last ? frames.value.last.dataUrl : undefined
  }
  if (mode.value === 'reference') {
    payload.images = referenceImages.value.map((i) => i.dataUrl)
    payload.audios = referenceAudios.value.map((a) => a.dataUrl)
  }
  try {
    const res = await renderStartAiVideo(payload)
    if (res && res.code === 0) {
      result.value = res.data
      rendering.value = false
      progress.value = 100
      stage.value = t('create.story2video.ui.quickStageCompleted')
    } else {
      const message = res && res.message ? String(res.message) : ''
      error.value = MODE_ERROR_KEY[message]
        ? localizeModeError(message)
        : formatUserError(res, { fallback: t('create.story2video.ui.quickError.renderFailed') }).message
      rendering.value = false
    }
  } catch (e) {
    error.value = formatUserError(e, { fallback: t('create.story2video.ui.quickError.renderFailed') }).message
    rendering.value = false
  }
}

async function startGallery () {
  rendering.value = true
  progress.value = 0
  stage.value = t('create.story2video.ui.quickStageSubmitting')
  try {
    const cuts = galleryImages.value.map((img, i) => ({
      id: `scene-${i}`,
      type: 'anime_scene',
      images: [img.dataUrl],
      animation: 'ken-burns',
      in_seconds: i * 5,
      out_seconds: (i + 1) * 5 - 0.5,
    }))
    const res = await renderStart({ props: { cuts, theme: theme.value, renderer_family: 'explainer-data' }, profile: profile.value })
    if (res && res.code === 0) {
      result.value = res.data
      rendering.value = false
      progress.value = 100
      stage.value = t('create.story2video.ui.quickStageCompleted')
    } else {
      error.value = formatUserError(res, { fallback: t('create.story2video.ui.quickError.renderFailed') }).message
      rendering.value = false
    }
  } catch (e) {
    error.value = formatUserError(e, { fallback: t('create.story2video.ui.quickError.renderFailed') }).message
    rendering.value = false
  }
}

/**
 * 取消：只停止本地等待（上游未公开任务取消端点），如实告知远端可能仍在生成。
 * renderCancel 取消的是**本地 Remotion 渲染**（图片轮播路径）；对 AI 视频路径是空操作，
 * 因此统一调用：图片轮播能真停，AI 视频则由提示如实说明。
 */
function cancel () {
  try { renderCancel() } catch (e) { /* 取消是尽力而为，不阻断 UI */ }
  rendering.value = false
  error.value = t('create.story2video.ui.quickCancelNotice')
}

function viewResult () {
  if (result.value && result.value.outputPath) emit('view-result', result.value.outputPath)
}

onMounted(() => {
  loadCapabilities()
  // ⚠️ 载荷形状：preload 的 onRenderProgress 把 IPC 载荷**原样**传给回调
  // （`(_e, p) => callback(p)`），主进程发的是 `{ percent, stage }` **对象**。
  // 历史实现按 `(pct, stg)` 两个位置参数解构 ⇒ pct 拿到的是整个对象，
  // 进度条渲染成 "[object Object]%"（这正是「进度条不动」的真实根因，不只是「没推进度」）。
  // 这里按对象读取，并兼容旧的位置参数形态。
  cleanups.push(onRenderProgress((payload) => {
    if (!rendering.value) return
    const isObject = payload && typeof payload === 'object'
    const percent = isObject ? payload.percent : payload
    const stageText = isObject ? payload.stage : undefined
    progress.value = Number(percent) || 0
    stage.value = String(stageText || '')
  }))
  cleanups.push(onRenderComplete((res) => {
    if (!rendering.value) return
    result.value = res
    rendering.value = false
    progress.value = 100
  }))
  cleanups.push(onRenderError((err) => {
    if (!rendering.value) return
    error.value = formatUserError(err, { fallback: t('create.story2video.ui.quickError.renderFailed') }).message
    rendering.value = false
  }))
})

onBeforeUnmount(() => {
  cleanups.forEach((fn) => { if (typeof fn === 'function') fn() })
})
</script>

<style scoped>
.quick-hint {
  font-size: 12px;
  margin: 6px 0 0;
  line-height: 1.5;
}
</style>
