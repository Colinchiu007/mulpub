<template>
  <!--
    单个分段卡片（2026-10-20 从 ResultSegmentEditor 抽出）。

    为什么再拆一层：ResultSegmentEditor 抽出来后有 521 行，撞上 max-lines 的
    「新代码不得引入超大文件」。分段卡片本身是一个自洽单元（头部 + 缩略图 +
    四素材槽 + 文案/字幕/提示词 + 语音设置 + 操作区），拆开后编辑器只留
    列表/窗口/哨兵，卡片可独立读与独立测。

    所有副作用经 emits 上抛，本组件不直接调 IPC。
  -->
  <article
    class="segment-item"
    :class="{ 'segment-policy-flagged': policyFlagged }"
    :ref="el => $emit('card-ref', el, absoluteIndex)"
  >
    <div class="segment-header">
      <strong>{{ tOrKey('story2video.sceneMaterial.segmentTitle', { n: absoluteIndex + 1 }) }}</strong>
      <span class="segment-status" :class="draft.status">{{ segmentStatusLabel(draft.status) }}</span>
      <span v-if="draft.status === 'failed' && draft.error" class="segment-status-reason" data-testid="segment-status-reason">{{ statusReason }}</span>
      <span v-if="policyFlagged" class="segment-policy-flag" data-testid="segment-policy-flag">{{ $t('story2video.sceneMaterial.scenePolicyFlag') }}</span>
      <div class="segment-order">
        <button type="button" :disabled="absoluteIndex === 0" :title="tOrKey('story2video.sceneMaterial.segmentMoveUp')" @click="$emit('move-segment', absoluteIndex, -1)">{{ tOrKey('story2video.sceneMaterial.segmentMoveUp') }}</button>
        <button type="button" :disabled="absoluteIndex === totalCount - 1" :title="tOrKey('story2video.sceneMaterial.segmentMoveDown')" @click="$emit('move-segment', absoluteIndex, 1)">{{ tOrKey('story2video.sceneMaterial.segmentMoveDown') }}</button>
        <button type="button" :disabled="totalCount === 1" :title="tOrKey('story2video.sceneMaterial.segmentDelete')" @click="$emit('remove-segment', absoluteIndex)">{{ tOrKey('story2video.sceneMaterial.segmentDelete') }}</button>
      </div>
    </div>

    <div class="segment-thumb" :class="{ 'asset-placeholder': !draft.imageUrl }" data-testid="segment-image-preview">
      <img v-if="draft.imageUrl" :src="draft.imageUrl" :alt="tOrKey('story2video.sceneMaterial.segmentImageAlt', { n: absoluteIndex + 1 })" loading="lazy" decoding="async" @error="clearSegmentImageUrl(draft)" />
      <span v-if="!draft.imageUrl">{{ tOrKey('story2video.sceneMaterial.emptySlot') }}</span>
    </div>
    <div class="scene-material-section" data-testid="scene-material-section">
      <div class="scene-material-heading">
        <strong>{{ $t('story2video.sceneMaterial.title') }}</strong>
        <span class="scene-material-hint">{{ $t('story2video.sceneMaterial.previewHint') }}</span>
      </div>
      <div class="scene-material-slots">
        <article
          v-for="slot in materialSlots"
          :key="slot.kind"
          class="scene-material-slot"
          :class="{ selected: slot.selected, empty: !slot.path || !slot.url }"
          :data-testid="'scene-material-slot-' + slot.kind"
          :aria-pressed="slot.selected ? 'true' : 'false'"
          @click.self.prevent="slot.path && $emit('select-material', segment.id, slot.kind)"
        >
          <button
            type="button"
            class="scene-material-thumb"
            :disabled="!slot.path || !slot.url"
            :aria-label="slot.path && slot.url
              ? $t('story2video.sceneMaterial.previewAriaLabel', { label: slot.label })
              : $t('story2video.sceneMaterial.emptyAriaLabel', { label: slot.label })"
            @click.stop="slot.path && slot.url ? $emit('preview-material', slot) : undefined"
          >
            <img v-if="!slot.kind.includes('video') && slot.url" :src="slot.url" :alt="slot.label" loading="lazy" decoding="async" @error="clearSceneMaterialUrl(segment, slot.kind)" />
            <video v-else-if="slot.kind.includes('video') && slot.url" :src="slot.url" preload="metadata" muted @error="clearSceneMaterialUrl(segment, slot.kind)"></video>
            <span v-if="!slot.path || !slot.url" class="scene-material-empty-text">{{ $t('story2video.sceneMaterial.emptySlot') }}</span>
          </button>
          <div class="scene-material-choice">
            <input
              :id="'scene-material-radio-' + segment.id + '-' + slot.kind"
              type="radio"
              class="scene-material-radio"
              :name="'scene-material-' + segment.id"
              :value="slot.kind"
              :checked="slot.selected"
              :aria-label="$t('story2video.sceneMaterial.selectAriaLabel', { label: slot.label })"
              :disabled="busy || !slot.selectable"
              @change="$emit('select-material', segment.id, slot.kind)"
            />
            <label :for="'scene-material-radio-' + segment.id + '-' + slot.kind" class="scene-material-label">{{ slot.label }}</label>
          </div>
          <span v-if="slot.selected" class="scene-material-badge">{{ $t('story2video.sceneMaterial.selectedBadge') }}</span>
          <div v-if="slot.kind === 'image1' || slot.kind === 'image2'" class="scene-material-slot-action">
            <UiButton
              size="sm"
              variant="secondary"
              data-testid="generate-image-button"
              :disabled="busy"
              @click.stop="$emit('generate-image', segment.id)"
            >
              {{ busyKind === 'genImage' ? $t('story2video.sceneMaterial.generating') : $t('story2video.sceneMaterial.generateImage') }}
            </UiButton>
          </div>
          <div v-if="slot.kind === 'video1' || slot.kind === 'video2'" class="scene-material-slot-action">
            <UiButton
              size="sm"
              variant="secondary"
              data-testid="generate-ai-video-button"
              :disabled="busy || !hasUsableVideoPrompt"
              :title="hasUsableVideoPrompt ? '' : $t('story2video.sceneMaterial.aiVideoNeedsPromptHint')"
              @click.stop="$emit('generate-ai-video', segment.id)"
            >
              {{ busyKind === 'aiVideo' ? $t('story2video.sceneMaterial.generatingAiVideo') : $t('story2video.sceneMaterial.generateAiVideo') }}
            </UiButton>
          </div>
        </article>
      </div>
    </div>

    <label class="field-label">
      {{ $t('story2video.sceneMaterial.narrationTextLabel') }}
      <textarea v-model="draft.text" rows="3" @input="$emit('dirty')"></textarea>
    </label>
    <label class="field-label">
      <span>{{ $t('story2video.sceneMaterial.subtitleLabel') }}</span>
      <textarea
        :value="subtitleText"
        :placeholder="$t('story2video.sceneMaterial.emptySlot')"
        rows="3"
        data-testid="segment-subtitle-textarea"
        @input="$emit('update-subtitle-blocks', segment, $event.target.value)"
      ></textarea>
    </label>
    <div class="segment-inline-actions">
      <UiButton size="sm" variant="secondary" data-testid="regenerate-subtitle-button" :disabled="busy" @click="$emit('regenerate-subtitle', segment.id)">
        {{ busyKind === 'subtitle' ? $t('story2video.sceneMaterial.regeneratingSubtitle') : $t('story2video.sceneMaterial.regenerateSubtitle') }}
      </UiButton>
    </div>
    <label class="field-label">
      {{ $t('story2video.sceneMaterial.imagePromptLabel') }}
      <textarea v-model="draft.prompt" rows="3" :placeholder="$t('story2video.sceneMaterial.emptySlot')" @input="$emit('dirty')"></textarea>
    </label>
    <label class="field-label">
      <span>{{ $t('story2video.sceneMaterial.videoPromptLabel') }}</span>
      <textarea v-model="draft.videoPrompt" rows="3" data-testid="segment-video-prompt-textarea" :placeholder="$t('story2video.sceneMaterial.emptySlot')" @input="$emit('dirty')"></textarea>
    </label>
    <div class="segment-inline-actions">
      <UiButton size="sm" variant="secondary" data-testid="regenerate-image-prompt-button" :disabled="busy" @click="$emit('regenerate-prompt', segment.id, 'image')">
        {{ busyKind === 'promptImage' ? $t('story2video.sceneMaterial.regeneratingPrompt') : $t('story2video.sceneMaterial.regenerateImagePrompt') }}
      </UiButton>
      <UiButton size="sm" variant="secondary" data-testid="regenerate-video-prompt-button" :disabled="busy" @click="$emit('regenerate-prompt', segment.id, 'video')">
        {{ busyKind === 'promptVideo' ? $t('story2video.sceneMaterial.regeneratingPrompt') : $t('story2video.sceneMaterial.regenerateVideoPrompt') }}
      </UiButton>
    </div>
    <div class="segment-prompt-translation" data-testid="segment-prompt-translation">
      <span class="segment-prompt-translation-label">{{ promptTranslationLabel }}</span>
      <p class="segment-prompt-translation-text">{{ showPromptTranslation ? draft.promptTranslation : $t('story2video.sceneMaterial.emptySlot') }}</p>
    </div>

    <div class="segment-voice-settings">
      <span class="segment-voice-title">{{ $t('story2video.sceneMaterial.voiceSettingsLabel') }}</span>
      <div class="segment-voice-grid">
        <label class="field-label">
          <span>{{ $t('story2video.sceneMaterial.voiceIdLabel') }}</span>
          <select
            v-if="voiceSelectable"
            v-model="draft.voiceId"
            data-testid="segment-voice-id-select"
            @change="$emit('dirty')"
          >
            <option value="">{{ $t('story2video.sceneMaterial.voiceIdPlaceholder') }}</option>
            <option v-for="voice in voiceOptions" :key="voice.id" :value="voice.id" :disabled="voice.invalid">
              {{ voice.invalid ? voice.name + $t('story2video.sceneMaterial.voiceInvalidSuffix') : voice.name }}
            </option>
            <option v-if="draft.voiceId && !voiceOptionIds.has(draft.voiceId)" :value="draft.voiceId">{{ draft.voiceId }}</option>
          </select>
          <input v-else v-model="draft.voiceId" data-testid="segment-voice-id-input" :placeholder="$t('story2video.sceneMaterial.voiceIdPlaceholder')" @input="$emit('dirty')" />
          <span v-if="voiceCatalogError" class="field-hint field-hint-warning" data-testid="voice-catalog-error">{{ tOrKey('story2video.sceneMaterial.voiceCatalogUnavailable') }}</span>
        </label>
        <label class="field-label">
          <span>{{ $t('story2video.sceneMaterial.voiceSpeedLabel') }}: {{ voiceSpeedText }}x</span>
          <input v-model.number="draft.voiceSpeed" data-testid="segment-voice-speed-range" type="range" min="0.5" max="2" step="0.1" @input="$emit('dirty')" />
        </label>
        <label class="field-label">
          <span>{{ $t('story2video.sceneMaterial.voicePitchLabel') }}</span>
          <input v-model.number="draft.voicePitch" data-testid="segment-voice-pitch-input" type="number" step="0.1" min="-12" max="12" @input="$emit('dirty')" />
        </label>
        <label class="field-label">
          <span>{{ $t('story2video.sceneMaterial.voiceEmotionLabel') }}</span>
          <input v-model="draft.voiceEmotion" data-testid="segment-voice-emotion-input" :placeholder="$t('story2video.sceneMaterial.voiceEmotionPlaceholder')" @input="$emit('dirty')" />
        </label>
      </div>
      <div class="segment-inline-actions">
        <UiButton size="sm" variant="secondary" data-testid="regenerate-audio-button" :disabled="busy" @click="$emit('regenerate-audio', segment.id)">
          {{ busyKind === 'tts' ? $t('story2video.sceneMaterial.generatingVoice') : $t('story2video.sceneMaterial.regenerateVoice') }}
        </UiButton>
      </div>
      <div class="segment-audio-preview" data-testid="segment-audio-preview">
        <audio v-if="segment.audioUrl" :src="draft.audioUrl" controls class="audio-player" @error="clearSegmentAudioUrl(segment)"></audio>
        <span v-else class="asset-placeholder">{{ tOrKey('story2video.sceneMaterial.emptySlot') }}</span>
      </div>
    </div>

    <div class="segment-actions">
      <label class="segment-file-action" :class="{ disabled: busy }">
        {{ $t('story2video.sceneMaterial.replaceNarration') }}
        <input
          type="file"
          accept=".wav,.m4a,.mp3,audio/wav,audio/x-m4a,audio/mpeg"
          :disabled="busy"
          @change="$emit('replace-audio', segment.id, $event)"
        />
      </label>
      <UiButton v-if="segment.imagePath" size="sm" variant="ghost" @click="$emit('download-artifact', segment.imagePath, artifactName('image', segment.imagePath))">{{ $t('story2video.sceneMaterial.downloadImage') }}</UiButton>
      <UiButton v-if="segment.audioPath" size="sm" variant="ghost" @click="$emit('download-artifact', segment.audioPath, artifactName('audio', segment.audioPath))">{{ $t('story2video.sceneMaterial.downloadAudio') }}</UiButton>
      <UiButton v-if="segment.videoPath" size="sm" variant="ghost" @click="$emit('download-artifact', segment.videoPath, artifactName('video', segment.videoPath))">{{ $t('story2video.sceneMaterial.downloadVideo') }}</UiButton>
    </div>
  </article>
</template>

<script>
import UiButton from '../../components/UiButton.vue'
import { getAppLocale } from '@/i18n'
import { resolveStory2VideoNotification } from '@/story2video/story2video-notifications'
import { resolveSceneMaterialSlots, resolveSegmentStatusReason, resolveSubtitleBlocksText } from './composables/useResultPreviewMedia'

export default {
  name: 'ResultSegmentCard',
  components: { UiButton },
  props: {
    segment: { type: Object, required: true },
    // 全量下标（上移/下移/删除/导出命名/政策徽标都按它寻址）
    absoluteIndex: { type: Number, required: true },
    totalCount: { type: Number, default: 0 },
    // 该段是否被 focusScenes 点名
    policyFlagged: { type: Boolean, default: false },
    // 该段忙碌态（'' = 空闲）
    busyKind: { type: String, default: '' },
    voiceOptions: { type: Array, default: () => [] },
    voiceCatalogError: { type: String, default: '' },
    // 音色下拉可用性由父级算好传入（QM-6 审查项 D10：卡片不再自收 voiceContext）
    voiceSelectable: { type: Boolean, default: false },
    // 已标记不可用的素材位：'segmentId:kind' -> true
    unavailableMaterialKinds: { type: Object, default: () => ({}) },
  },
  emits: [
    'dirty',
    'card-ref',
    'move-segment',
    'remove-segment',
    'select-material',
    'generate-image',
    'generate-ai-video',
    'regenerate-subtitle',
    'regenerate-prompt',
    'regenerate-audio',
    'replace-audio',
    'download-artifact',
    'preview-material',
    'mark-material-unavailable',
    'update-subtitle-blocks',
  ],
  computed: {
    busy() {
      return Boolean(this.busyKind)
    },
    // 模板 v-model 的绑定目标。
    //
    // **为什么直接返回 prop 而不是快照副本**（QM-6 审查项 A1 实测缺陷）：
    // 宿主的 `refreshSegmentImageUrls()` 会**原地改** `segment.imageUrl/audioUrl/
    // videoUrl/...`（保存 / 重试 / 重新合成后的 URL 刷新）。若 draft 是
    // `{...segment}` 快照 + deep watch，原地改写不触发卡片侧 watch，浅拷贝展开
    // 拿到的还是旧值 ⇒ 用户看到旧图或空白（第一版即此缺陷，由 A1 用例抓住）。
    //
    // 直接返回 prop 的代价是 `v-model="draft.text"` 实际写在 prop 上。这在语义上
    // 是对的：宿主把 segments 数组元素作为可编辑对象传进来，本就期望字段被改写，
    // 随后经 `story2video:update-segments` 落盘并整体替换 segments。
    // 为满足 eslint 的 vue/no-mutating-props，模板侧统一写 `draft.xxx`，
    // 由本 getter 把写入导向 prop；`@input` 同时 emit dirty 让宿主知道要保存。
    draft: {
      get() {
        return this.segment
      },
      set() {
        // 模板从不整体赋值 draft（只做 draft.xxx = ...），setter 仅用于满足可写语义
      },
    },
    materialSlots() {
      return resolveSceneMaterialSlots(this.segment, {
        label: key => this.$t('story2video.sceneMaterial.' + key),
        unavailable: this.unavailableMaterialKinds,
      })
    },
    statusReason() {
      return resolveSegmentStatusReason(this.segment, {
        resolveNotification: resolveStory2VideoNotification,
        truncate: (value, max) => this.truncateText(value, max),
      })
    },
    subtitleText() {
      return resolveSubtitleBlocksText(this.segment)
    },
    hasUsableVideoPrompt() {
      return Boolean(this.segment && [this.segment.videoPrompt, this.segment.prompt, this.segment.text]
        .some(source => typeof source === 'string' && source.trim()))
    },
    voiceOptionIds() {
      return new Set((this.voiceOptions || []).map(voice => voice.id).filter(Boolean))
    },
    voiceSpeedText() {
      const speed = Number(this.segment && this.segment.voiceSpeed)
      return Number.isFinite(speed) && speed > 0 ? speed.toFixed(1) : '1.0'
    },
    promptTranslationLabel() {
      const locale = getAppLocale()
      const key = locale === 'zh'
        ? 'story2video.sceneMaterial.promptTranslationLabelZh'
        : 'story2video.sceneMaterial.promptTranslationLabelOther'
      return this.$t(key)
    },
    showPromptTranslation() {
      if (getAppLocale() === 'en') return false
      const translation = this.segment && this.segment.promptTranslation
      return typeof translation === 'string' && translation.trim() !== ''
    },
  },
  methods: {
    tOrKey(key, params) {
      return typeof this.$t === 'function' ? this.$t(key, params) : key
    },
    segmentStatusLabel(status) {
      const key = ['completed', 'failed', 'processing', 'pending'].includes(status) ? status : 'completed'
      return this.tOrKey(`story2video.segmentStatus.${key}`)
    },
    truncateText(value, max) {
      const points = Array.from(String(value || ''))
      return points.length > max ? points.slice(0, max - 1).join('') + '…' : points.join('')
    },
    // 分享 URL 失效：清渲染端坏 URL + 标记素材位不可用（保留来源路径供恢复）。
    // 入参是 draft（模板传入），改它即改本地副本，同时 emit 让宿主登记不可用位。
    clearSegmentImageUrl(draft) {
      if (!draft) return
      draft.imageUrl = null
      this.$emit('mark-material-unavailable', draft, 'image1')
    },
    clearSegmentAudioUrl(draft) {
      if (draft) draft.audioUrl = null
    },
    clearSceneMaterialUrl(draft, kind) {
      if (!draft) return
      if (kind === 'image1') draft.imageUrl = null
      else if (kind === 'image2') draft.alternateImageUrls = []
      else if (kind === 'video1') draft.videoUrl = null
      else if (kind === 'video2') draft.altVideoUrl = null
      this.$emit('mark-material-unavailable', draft, kind)
    },
    artifactName(kind, filePath) {
      const fallback = kind === 'image' ? '.png' : kind === 'audio' ? '.mp3' : '.mp4'
      return 'segment-' + String(this.absoluteIndex + 1).padStart(3, '0') + '-' + kind + this.extension(filePath, fallback)
    },
    extension(filePath, fallback) {
      const name = String(filePath || '').split(/[\\/]/).pop() || ''
      const match = name.match(/(\.[a-z0-9]{2,5})$/i)
      return match ? match[1].toLowerCase() : fallback
    },
  },
}
</script>

<style scoped>
/* 以下规则 2026-10-20 随卡片拆分从 ResultSegmentEditor/ResultView 搬入 */
.segment-item { border: 1px solid var(--border); border-radius: 8px; padding: 14px; background: var(--surface); }
.segment-thumb { margin-bottom: 12px; border-radius: 6px; overflow: hidden; background: var(--bg); max-width: 320px; }
.segment-thumb { display: flex; align-items: center; justify-content: center; min-height: 120px; }
.segment-thumb img { display: block; width: 100%; height: 120px; object-fit: cover; }
.asset-placeholder { color: var(--text-muted); font-size: var(--font-size-xs); }
.narration-placeholder { display: flex; align-items: center; min-height: 44px; padding: 0 12px; border-radius: 6px; background: var(--bg); }
.scene-material-section { margin: 12px 0; padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
.scene-material-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.scene-material-heading strong { font-size: var(--font-size-sm); }
.scene-material-hint { color: var(--text-muted); font-size: var(--font-size-xs); }
.scene-material-slots { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.scene-material-slot { position: relative; display: flex; min-width: 0; flex-direction: column; gap: 7px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.scene-material-slot:hover { border-color: var(--primary); }
.scene-material-slot.selected { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
.scene-material-slot.empty { opacity: 0.75; }
.scene-material-thumb { display: flex; align-items: center; justify-content: center; width: 100%; aspect-ratio: 3 / 4; min-height: 96px; padding: 0; border: 0; border-radius: 4px; overflow: hidden; background: var(--bg); color: inherit; cursor: pointer; }
.scene-material-thumb:disabled { cursor: not-allowed; }
.scene-material-thumb img, .scene-material-thumb video { width: 100%; height: 100%; object-fit: cover; }
.scene-material-empty-text { color: var(--text-muted); font-size: var(--font-size-xs); }
.scene-material-choice { display: flex; align-items: center; gap: 6px; min-height: 24px; }
.scene-material-radio { flex: 0 0 auto; accent-color: var(--primary); width: 16px; height: 16px; cursor: pointer; }
.scene-material-radio:disabled { cursor: not-allowed; }
.scene-material-label { min-width: 0; color: var(--text); font-size: var(--font-size-xs); line-height: 1.3; cursor: pointer; }
.scene-material-radio:disabled + .scene-material-label { color: var(--text-muted); cursor: not-allowed; }
.scene-material-badge { position: absolute; top: 6px; right: 6px; max-width: calc(100% - 12px); padding: 2px 6px; border-radius: 4px; background: var(--primary); color: #fff; font-size: var(--font-size-xs); line-height: 1.2; }
.scene-material-slot-action { display: flex; min-height: 30px; align-items: flex-end; }
.scene-material-slot-action > * { width: 100%; min-width: 0; }
.scene-material-slot-action button { width: 100%; min-width: 0; white-space: normal; }
.segment-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.segment-status { padding: 3px 6px; border-radius: 4px; background: var(--border-light); color: var(--text-muted); font-size: var(--font-size-xs); }
.segment-status-reason { flex: 1 1 auto; min-width: 0; color: var(--status-failed-text, var(--danger, #d93025)); font-size: var(--font-size-xs); line-height: 1.45; word-break: break-word; }
.segment-policy-flag { padding: 3px 6px; border-radius: 4px; background: var(--danger-bg, #fdecea); color: var(--danger, #d93025); font-size: var(--font-size-xs); font-weight: 600; }
.segment-policy-flagged { border-color: var(--danger, #d93025); box-shadow: 0 0 0 1px var(--danger, #d93025) inset; }
.segment-status.failed { background: var(--status-failed-bg); color: var(--status-failed-text); }
.segment-status.processing { background: var(--warning-bg); color: var(--warning); }
.segment-order { display: flex; gap: 4px; margin-left: auto; }
.segment-order button { border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); border-radius: 4px; padding: 5px 8px; cursor: pointer; }
.segment-order button:disabled { opacity: 0.4; cursor: not-allowed; }
.field-label { display: grid; gap: 6px; margin-top: 10px; color: var(--text-muted); font-size: var(--font-size-xs); font-weight: 600; }
.field-label textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid var(--border); border-radius: 6px; padding: 9px 10px; background: var(--bg); color: var(--text); font: inherit; font-size: var(--font-size-sm); line-height: 1.5; }
.segment-inline-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.segment-voice-settings { margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
.segment-voice-title { display: block; color: var(--text-muted); font-size: var(--font-size-xs); font-weight: 600; margin-bottom: 4px; }
.segment-voice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.segment-voice-grid .field-label { margin-top: 6px; }
.segment-voice-grid input { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; background: var(--bg); color: var(--text); font: inherit; font-size: var(--font-size-sm); }
.segment-actions { margin-top: 12px; }
.segment-file-action { display: inline-flex; align-items: center; min-height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); cursor: pointer; font-size: var(--font-size-xs); font-weight: 600; }
.segment-file-action:hover { border-color: var(--primary); color: var(--primary); }
.segment-file-action.disabled { opacity: 0.45; cursor: not-allowed; }
.segment-file-action input { display: none; }

/* 窄屏（≤720px）：分段卡片头部与语音网格改为单列（随卡片拆分从 ResultView 搬入） */
@media (max-width: 720px) {
  .segment-header { align-items: flex-start; flex-direction: column; }
  .segment-order { margin-left: 0; }
  .scene-material-slots { grid-template-columns: repeat(2, 1fr); }
  .segment-voice-grid { grid-template-columns: 1fr; }
}
</style>
