<template>
  <div class="scene-asset-selection" data-testid="scene-asset-selection">
    <div class="sas-header">
      <h3 class="sas-title">{{ titleText }}</h3>
      <p class="sas-subtitle">{{ subtitleText }}</p>
      <p class="sas-hint">{{ selectHintText }}</p>
      <p class="sas-preview-hint">{{ clickToPreviewText }}</p>
    </div>

    <div v-if="error" class="sas-error" role="alert" data-testid="sas-error">{{ error }}</div>

    <div v-if="!candidates || candidates.length === 0" class="sas-empty" data-testid="sas-empty">
      {{ notReadyText }}
    </div>

    <div v-else class="sas-scene-list">
      <div v-for="scene in candidates" :key="scene.index" class="sas-scene" :data-testid="'sas-scene-' + scene.index">
        <div class="sas-scene-header">
          <span class="sas-scene-label">{{ sceneLabelText(scene.index) }}</span>
          <span v-if="defaultHint(scene)" class="sas-default-hint">{{ defaultHint(scene) }}</span>
        </div>
        <p v-if="scene.text" class="sas-scene-text">{{ scene.text }}</p>
        <p class="sas-scene-prompt" :title="scene.prompt">{{ scene.prompt }}</p>

        <div class="sas-candidates">
          <label
            v-for="candidate in scene.candidates"
            :key="candidate.id"
            class="sas-candidate"
            :class="{ 'is-selected': selected[scene.index] === candidate.id }"
            :data-testid="'sas-candidate-' + scene.index + '-' + candidate.id"
          >
            <input
              type="radio"
              class="sas-radio"
              :name="'sas-scene-' + scene.index"
              :value="candidate.id"
              :checked="selected[scene.index] === candidate.id"
              @change="select(scene, candidate.id)"
            />
            <span class="sas-candidate-badge">{{ candidateLabel(candidate) }}</span>
            <span
              v-if="candidate.kind === 'image' && urls[candidate.path]"
              class="sas-media-wrap"
              role="button"
              tabindex="0"
              :aria-label="previewAriaLabel(candidate)"
              :data-testid="'sas-preview-' + scene.index + '-' + candidate.id"
              @click="openPreview(scene, candidate)"
              @keydown.enter.prevent="openPreview(scene, candidate)"
            >
              <img
                class="sas-thumb"
                :src="urls[candidate.path]"
                :alt="candidateLabel(candidate)"
              />
              <span class="sas-zoom-overlay" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <circle cx="11" cy="11" r="7"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
              </span>
            </span>
            <video
              v-else-if="candidate.kind === 'video' && urls[candidate.path]"
              class="sas-thumb sas-thumb-video"
              :src="urls[candidate.path]"
              muted
              playsinline
              preload="metadata"
              controls
              :data-testid="'sas-preview-' + scene.index + '-' + candidate.id"
              @click="openPreview(scene, candidate)"
            ></video>
            <span v-else class="sas-thumb sas-thumb-loading">
              <UiSkeleton variant="rect" height="100%" />
            </span>
          </label>
        </div>
      </div>
    </div>

    <div class="sas-actions">
      <button
        type="button"
        class="s2v-btn-primary"
        :disabled="confirming || !allSelected"
        data-testid="sas-confirm"
        @click="confirm"
      >
        {{ confirming ? confirmingText : confirmText }}
      </button>
    </div>

    <UiModal
      :visible="!!preview"
      :title="previewTitle"
      size="lg"
      @close="closePreview"
    >
      <div class="sas-preview" data-testid="sas-preview-modal">
        <p v-if="previewMetaText" class="sas-preview-meta">{{ previewMetaText }}</p>
        <div class="sas-preview-stage">
          <button
            type="button"
            class="sas-preview-nav sas-preview-prev"
            :disabled="previewCount < 2"
            :aria-label="previewPrevLabel"
            data-testid="sas-preview-prev"
            @click="previewPrev"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <img
            v-if="preview && preview.candidate.kind === 'image'"
            class="sas-preview-media"
            :src="previewUrl"
            :alt="previewLabel"
            data-testid="sas-preview-image"
          />
          <video
            v-else-if="preview && preview.candidate.kind === 'video'"
            class="sas-preview-media"
            :src="previewUrl"
            controls
            playsinline
            autoplay
            data-testid="sas-preview-video"
          ></video>
          <button
            type="button"
            class="sas-preview-nav sas-preview-next"
            :disabled="previewCount < 2"
            :aria-label="previewNextLabel"
            data-testid="sas-preview-next"
            @click="previewNext"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
        <button
          type="button"
          class="sas-preview-select-toggle"
          :class="{ 'is-selected': previewSelected }"
          :aria-pressed="previewSelected"
          data-testid="sas-preview-toggle"
          @click="togglePreviewSelection"
        >
          {{ previewSelectedLabel }}
        </button>
        <p v-if="previewHintText" class="sas-preview-close-hint">{{ previewHintText }}</p>
      </div>
    </UiModal>
  </div>
</template>

<script>
import { story2videoCreateShareUrl } from '@/api/publisher'
import UiModal from '@/components/UiModal.vue'

export default {
  name: 'SceneAssetSelection',
  components: { UiModal },
  props: {
    runId: { type: String, default: '' },
    candidates: { type: Array, default: () => [] },
    confirming: { type: Boolean, default: false },
    error: { type: String, default: '' },
  },
  emits: ['confirm'],
  data() {
    return {
      selected: {},
      urls: {},
      preview: null,
    }
  },
  computed: {
    titleText() {
      return this.$t?.('story2video.sceneAssetSelection.title') || '选择分镜素材'
    },
    subtitleText() {
      return this.$t?.('story2video.sceneAssetSelection.subtitle') || '每个分镜的成品由您自主选择；全部选定后将生成旁白并完成视频合成。'
    },
    selectHintText() {
      return this.$t?.('story2video.sceneAssetSelection.selectHint') || '请为每个场景选择最终使用的素材（单选）。'
    },
    confirmText() {
      return this.$t?.('story2video.sceneAssetSelection.confirm') || '确认选择并继续（生成旁白 + 合成）'
    },
    confirmingText() {
      return this.$t?.('story2video.sceneAssetSelection.confirming') || '提交中...'
    },
    notReadyText() {
      return this.$t?.('story2video.sceneAssetSelection.notReadyHint') || '素材生成中，请稍候…'
    },
    clickToPreviewText() {
      return this.$t?.('story2video.sceneAssetSelection.clickToPreviewHint') || '点击缩略图可放大预览'
    },
    previewTitle() {
      if (!this.preview) return ''
      const key = this.preview.candidate.kind === 'video'
        ? 'story2video.sceneAssetSelection.previewVideoTitle'
        : 'story2video.sceneAssetSelection.previewImageTitle'
      return this.$t?.(key) || (this.preview.candidate.kind === 'video' ? '视频预览' : '图片预览')
    },
    previewUrl() {
      if (!this.preview) return ''
      return this.urls[this.preview.candidate.path] || ''
    },
    previewLabel() {
      if (!this.preview) return ''
      return this.candidateLabel(this.preview.candidate)
    },
    previewMetaText() {
      if (!this.preview) return ''
      const sceneText = this.sceneLabelText(this.preview.scene.index)
      const mediaText = this.candidateLabel(this.preview.candidate)
      const pos = this.previewAllIndex >= 0 ? this.previewAllIndex + 1 : 0
      const total = this.allCandidates.length
      const template = this.$t?.('story2video.sceneAssetSelection.previewPositionLabel') || '第 {pos}/{total} 个素材'
      const position = typeof template === 'string' ? template.replace('{pos}', String(pos)).replace('{total}', String(total)) : ''
      return [sceneText + ' · ' + mediaText, position].filter(Boolean).join(' · ')
    },
    previewHintText() {
      return this.$t?.('story2video.sceneAssetSelection.previewCloseHint') || '点击关闭或按 × 退出预览'
    },
    previewCount() {
      return this.allCandidates.length
    },
    // 全部素材有序列表：按场景 index 升序，场景内按候选顺序（供预览跨场景循环切换）
    allCandidates() {
      return (Array.isArray(this.candidates) ? this.candidates : [])
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .flatMap(scene => (Array.isArray(scene.candidates) ? scene.candidates : []).map(candidate => ({ scene, candidate })))
    },
    previewAllIndex() {
      if (!this.preview) return -1
      return this.allCandidates.findIndex(item =>
        item.scene.index === this.preview.scene.index && item.candidate.id === this.preview.candidate.id)
    },
    previewSelected() {
      if (!this.preview) return false
      return this.selected[this.preview.scene.index] === this.preview.candidate.id
    },
    previewSelectedLabel() {
      return this.previewSelected
        ? (this.$t?.('story2video.sceneAssetSelection.previewSelectedLabel') || '已选定')
        : (this.$t?.('story2video.sceneAssetSelection.previewUnselectedLabel') || '未选定')
    },
    previewPrevLabel() {
      return this.$t?.('story2video.sceneAssetSelection.previewPrevLabel') || '上一个素材'
    },
    previewNextLabel() {
      return this.$t?.('story2video.sceneAssetSelection.previewNextLabel') || '下一个素材'
    },
    allSelected() {
      return Array.isArray(this.candidates) && this.candidates.length > 0
        && this.candidates.every(scene => this.selected[scene.index] !== undefined && this.selected[scene.index] !== '')
    },
  },
  watch: {
    candidates: {
      immediate: true,
      deep: true,
      handler(value) {
        if (!Array.isArray(value) || value.length === 0) return
        const next = { ...this.selected }
        let changed = false
        for (const scene of value) {
          if (next[scene.index] === undefined) {
            next[scene.index] = this.defaultCandidateId(scene)
            changed = true
          }
        }
        if (changed) this.selected = next
        this.resolveUrls(value)
      },
    },
  },
  methods: {
    defaultCandidateId(scene) {
      const list = Array.isArray(scene.candidates) ? scene.candidates : []
      const video = list.find(c => c && c.kind === 'video')
      if (video) return video.id
      const first = [...list].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))[0]
      return first ? first.id : ''
    },
    defaultHint(scene) {
      const id = this.defaultCandidateId(scene)
      if (!id) return ''
      const candidate = (scene.candidates || []).find(c => c && c.id === id)
      if (!candidate) return ''
      const videoHint = this.$t?.('story2video.sceneAssetSelection.defaultVideoHint') || '默认选中视频'
      const imageHint = this.$t?.('story2video.sceneAssetSelection.defaultFirstImageHint') || '默认选中第 1 张图片'
      return candidate.kind === 'video' ? videoHint : imageHint
    },
    candidateLabel(candidate) {
      if (!candidate) return ''
      const imageLabel = this.$t?.('story2video.sceneAssetSelection.imageLabel') || '图片 {n}'
      const videoLabel = this.$t?.('story2video.sceneAssetSelection.videoLabel') || '视频'
      if (candidate.kind === 'video') return videoLabel
      const n = (candidate.seq ?? 0) + 1
      return typeof imageLabel === 'string' ? imageLabel.replace('{n}', String(n)) : ('图片 ' + n)
    },
    sceneLabelText(index) {
      const template = this.$t?.('story2video.sceneAssetSelection.sceneLabel') || '场景 {index}'
      return typeof template === 'string' ? template.replace('{index}', String((index ?? 0) + 1)) : ('场景 ' + ((index ?? 0) + 1))
    },
    select(scene, candidateId) {
      this.selected = { ...this.selected, [scene.index]: candidateId }
    },
    openPreview(scene, candidate) {
      if (!candidate || !candidate.path || !this.urls[candidate.path]) return
      this.preview = { scene, candidate }
    },
    closePreview() {
      this.preview = null
    },
    previewPrev() {
      const list = this.allCandidates
      if (!this.preview || list.length < 2) return
      const idx = this.previewAllIndex
      if (idx < 0) return
      const next = (idx - 1 + list.length) % list.length
      this.preview = { ...list[next] }
    },
    previewNext() {
      const list = this.allCandidates
      if (!this.preview || list.length < 2) return
      const idx = this.previewAllIndex
      if (idx < 0) return
      const next = (idx + 1) % list.length
      this.preview = { ...list[next] }
    },
    // 已选定/未选定切换：与素材选定界面单选状态一致（同场景只保留一个已选定）
    togglePreviewSelection() {
      if (!this.preview) return
      const { scene, candidate } = this.preview
      const current = this.selected[scene.index]
      this.selected = current === candidate.id
        ? { ...this.selected, [scene.index]: '' }
        : { ...this.selected, [scene.index]: candidate.id }
    },
    previewAriaLabel(candidate) {
      const template = this.$t?.('story2video.sceneAssetSelection.previewAriaLabel') || '放大预览 {label}'
      const label = this.candidateLabel(candidate)
      return typeof template === 'string' ? template.replace('{label}', label) : ('放大预览 ' + label)
    },
    async resolveUrls(scenes) {
      const pending = []
      for (const scene of scenes) {
        for (const candidate of (scene.candidates || [])) {
          if (!candidate || !candidate.path || this.urls[candidate.path]) continue
          pending.push({ path: candidate.path, id: candidate.id })
        }
      }
      if (pending.length === 0) return
      const results = await Promise.allSettled(pending.map(async ({ path }) => {
        const result = await story2videoCreateShareUrl(path)
        return { path, url: result?.code === 0 ? (result.data?.url || result.data) : null }
      }))
      const next = { ...this.urls }
      let changed = false
      results.forEach((entry, i) => {
        if (entry.status === 'fulfilled' && entry.value.url) {
          next[pending[i].path] = entry.value.url
          changed = true
        }
      })
      if (changed) this.urls = next
    },
    confirm() {
      if (!this.allSelected || this.confirming) return
      const selections = (this.candidates || []).map(scene => ({
        index: scene.index,
        candidateId: this.selected[scene.index],
      }))
      this.$emit('confirm', selections)
    },
  },
}
</script>

<style scoped>
.scene-asset-selection { padding: 4px 0; }
.sas-header { margin-bottom: 10px; }
.sas-title { margin: 0 0 4px; font-size: 15px; }
.sas-subtitle, .sas-hint { margin: 2px 0; font-size: 12px; color: #8a8f98; }
.sas-error { color: #e5534b; font-size: 12px; margin: 6px 0; }
.sas-empty { color: #8a8f98; font-size: 13px; padding: 12px 0; }
.sas-scene { border: 1px solid #33373f; border-radius: 8px; padding: 10px; margin-bottom: 10px; background: #1d2026; }
.sas-scene-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sas-scene-label { font-weight: 600; font-size: 13px; }
.sas-default-hint { font-size: 11px; color: #58a6ff; }
.sas-scene-text { margin: 6px 0 2px; font-size: 12px; color: #c9d1d9; }
.sas-scene-prompt { margin: 0 0 8px; font-size: 11px; color: #8a8f98; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.sas-candidates { display: flex; flex-wrap: wrap; gap: 8px; }
.sas-candidate { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 1px solid #33373f; border-radius: 8px; padding: 6px; cursor: pointer; min-width: 108px; }
.sas-candidate.is-selected { border-color: #58a6ff; box-shadow: 0 0 0 1px #58a6ff; }
.sas-radio { accent-color: #58a6ff; }
.sas-candidate-badge { font-size: 11px; color: #c9d1d9; }
.sas-thumb { width: 96px; height: 128px; object-fit: cover; border-radius: 4px; background: #0d1117; display: flex; align-items: center; justify-content: center; }
.sas-thumb-loading { color: #8a8f98; font-size: 16px; }
.sas-thumb-video { cursor: zoom-in; }
.sas-media-wrap { position: relative; display: block; cursor: zoom-in; border-radius: 4px; line-height: 0; }
.sas-media-wrap:focus-visible { outline: 2px solid #58a6ff; outline-offset: 1px; }
.sas-zoom-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.35); color: #fff; opacity: 0; transition: opacity 0.15s ease; border-radius: 4px; pointer-events: none; }
.sas-media-wrap:hover .sas-zoom-overlay { opacity: 1; }
.sas-preview-hint { margin: 2px 0 0; font-size: 11px; color: #8b5cf6; }
.sas-preview { text-align: center; }
.sas-preview-meta { margin: 0 0 8px; font-size: 13px; color: #c9d1d9; }
.sas-preview-stage { display: flex; align-items: center; justify-content: center; gap: 10px; }
.sas-preview-media { max-width: 100%; max-height: 70vh; border-radius: 6px; background: #0d1117; }
.sas-preview-nav { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 1px solid #33373f; border-radius: 50%; background: #1d2026; color: #c9d1d9; cursor: pointer; transition: border-color 0.15s ease, color 0.15s ease; }
.sas-preview-nav:hover:not(:disabled) { border-color: #58a6ff; color: #58a6ff; }
.sas-preview-nav:disabled { opacity: 0.35; cursor: not-allowed; }
.sas-preview-nav:focus-visible { outline: 2px solid #58a6ff; outline-offset: 1px; }
.sas-preview-select-toggle { margin: 12px auto 0; display: inline-flex; align-items: center; gap: 6px; padding: 6px 16px; font-size: 13px; border: 1px solid #33373f; border-radius: 6px; background: #1d2026; color: #8a8f98; cursor: pointer; transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease; }
.sas-preview-select-toggle.is-selected { border-color: #2ea043; color: #2ea043; background: rgba(46, 160, 67, 0.1); }
.sas-preview-select-toggle:hover { border-color: #58a6ff; color: #c9d1d9; }
.sas-preview-select-toggle:focus-visible { outline: 2px solid #58a6ff; outline-offset: 1px; }
.sas-preview-close-hint { margin: 8px 0 0; font-size: 11px; color: #8a8f98; }
.sas-actions { margin-top: 12px; text-align: right; }
.s2v-btn-primary { background: #2f81f7; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; }
.s2v-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
