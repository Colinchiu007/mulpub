<template>
  <!--
    分段编辑区（2026-10-20 从 ResultView.vue 抽出，PRD-S2V-RESULT-VIEW-PERF §5）。

    为什么抽组件：ResultView.vue 是 .github/scripts/max-lines-baseline.json 的 targets
    点名还账对象（零增长容差），而「169 段任务进页面很慢」的修复必须往这里加逻辑。
    把整块分段编辑区搬出来，宿主只留 props/emits 接线，既拿到行数空间，
    也让分段区可以独立测试与独立演进。

    分批渲染窗口与媒体 URL 策略在 composables/useResultPreviewMedia.js（纯函数、可单测），
    本组件只负责把策略结果摆进 DOM。
  -->
  <section class="project-section" data-testid="segment-edit-section">
    <div class="section-heading">
      <div>
        <h2>{{ $t('story2video.sceneMaterial.segmentEditTitle') }}</h2>
        <p>
          {{ totalCount }} {{ $t('story2video.sceneMaterial.segmentCountSuffix') }} · {{ $t('story2video.sceneMaterial.editRecomposeHint') }}
          <span v-if="segmentsDirty" class="segments-unsaved-chip" data-testid="segments-unsaved-chip">{{ tOrKey('story2video.sceneMaterial.unsavedChanges') }}</span>
        </p>
      </div>
    </div>

    <div class="segment-list">
      <ResultSegmentCard
        v-for="({ segment, absoluteIndex }) in visibleSegments"
        :key="segment.id"
        :segment="segment"
        :absolute-index="absoluteIndex"
        :total-count="totalCount"
        :policy-flagged="isPolicyFlagScene(absoluteIndex)"
        :busy-kind="segmentBusyKind(segment.id)"
        :voice-options="voiceCatalogOptions"
        :voice-catalog-error="voiceCatalogError"
        :voice-selectable="segmentVoiceSelectable"
        :unavailable-material-kinds="unavailableMaterialKinds"
        :expanded="isSegmentEditorExpanded(segment.id)"
        @dirty="$emit('dirty')"
        @toggle-editor="toggleSegmentEditor"
        @card-ref="(el, index) => setSegmentItemRef(el, index)"        @move-segment="(index, offset) => $emit('move-segment', index, offset)"
        @remove-segment="onRemoveSegment"
        @select-material="(id, kind) => $emit('select-material', id, kind)"
        @generate-image="(id) => $emit('generate-image', id)"
        @generate-ai-video="(id) => $emit('generate-ai-video', id)"
        @regenerate-subtitle="(id) => $emit('regenerate-subtitle', id)"
        @regenerate-prompt="(id, kind) => $emit('regenerate-prompt', id, kind)"
        @regenerate-audio="(id) => $emit('regenerate-audio', id)"
        @replace-audio="(id, event) => $emit('replace-audio', id, event)"
        @download-artifact="(path, name) => $emit('download-artifact', path, name)"
        @preview-material="(slot) => $emit('preview-material', slot)"
        @mark-material-unavailable="(segment, kind) => $emit('mark-material-unavailable', segment, kind)"
        @update-subtitle-blocks="(segment, value) => $emit('update-subtitle-blocks', segment, value)"
      />
    </div>

    <!-- 分段渲染窗口哨兵（2026-10-20，PRD-S2V-RESULT-VIEW-PERF §4.3）：进入视口即追加一批，
          同时只解析新增那一批的媒体 URL。无 IntersectionObserver（jsdom）时保持全量渲染，
          并由「显示更多分段」兜底按钮手动展开。 -->
    <div
      v-if="hasMoreSegmentsToRender"
      ref="segmentListSentinel"
      class="segment-list-sentinel"
      data-testid="segment-list-sentinel"
    >
      <UiButton size="sm" variant="ghost" data-testid="segment-load-more-button" :disabled="batchLoading" @click="loadNextSegmentBatch">
        {{ batchLoading ? tOrKey('story2video.sceneMaterial.loading') : tOrKey('story2video.sceneMaterial.loadMoreSegments') }}
      </UiButton>
    </div>
  </section>
</template>

<script>
import UiButton from '../../components/UiButton.vue'
import ResultSegmentCard from './ResultSegmentCard.vue'
import { SEGMENT_RENDER_STEP, resolveResultPreviewLayout } from './composables/useResultPreviewMedia'

export default {
  name: 'ResultSegmentEditor',
  components: { UiButton, ResultSegmentCard },
  props: {
    // 全量分段（含渲染端派生的 imageUrl/audioUrl/videoUrl/alternateImageUrls）
    segments: { type: Array, default: () => [] },
    segmentsDirty: { type: Boolean, default: false },
    // 分段忙碌态：segmentId -> busy kind
    segmentBusy: { type: Object, default: () => ({}) },
    // 内容政策定位场景号（1-based）
    policySceneNumbers: { type: Set, default: null },
    // 音色目录（可用时渲染下拉，否则回退文本框）
    voiceCatalogOptions: { type: Array, default: () => [] },
    voiceCatalogError: { type: String, default: '' },
    voiceContext: { type: Object, default: () => ({}) },
    // 已解析 URL 后标记不可用的素材位：'segmentId:kind' -> true
    unavailableMaterialKinds: { type: Object, default: () => ({}) },
    // 哨兵批次加载中
    batchLoading: { type: Boolean, default: false },
    // 渲染窗口下界（已渲染段数）。**受控 prop**：单一真源在宿主，
    // 因为宿主的「分段定位」也要能把窗口一步扩到目标位次（QM-6 审查项 C7）。
    // 若这里再存一份本地计数，两个计数会漂移——宿主点定位扩了窗口、编辑器却按自己的
    // 计数渲染 ⇒ 视口纹丝不动，正是修复前的现象。
    renderedCount: { type: Number, default: 0 },
  },
  emits: [
    'dirty',
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
    'load-next-batch',
    'segment-ref',
  ],
  data() {
    return {
      // 当前展开编辑主体的分段 id（'' = 全部折叠）。默认全折叠：分段多时表单会把页面淹没。
      // 放在编辑器而非卡片里，是为了让「同时只展开一个」由同一处判定，而不是靠各卡片自觉。
      expandedSegmentId: '',
    }
  },
  computed: {
    totalCount() {
      return Array.isArray(this.segments) ? this.segments.length : 0
    },
    previewLayout() {
      return resolveResultPreviewLayout({
        segments: this.segments,
        project: null,
        ownVideoPath: '',
        // 受控：窗口下界由宿主持有（宿主的「分段定位」也要能改它）
        renderedCount: this.renderedCount,
        policySceneNumbers: this.policySceneNumbers,
      })
    },
    visibleSegments() {
      return this.previewLayout.visibleSegments
    },
    hasMoreSegmentsToRender() {
      // 以渲染窗口上界为准（renderWindow.to 同时是「已渲染上界」与「下次追加起点」）
      return this.previewLayout.renderWindow.to < this.totalCount
    },
    // 音色下拉可用性：目录非空 + 项目语音上下文完整（provider 与 model 都有）。
    // 与宿主 ResultView.segmentVoiceSelectable 同口径（QM-6 审查项 D10：
    // 曾在这里留一个只被本组件消费、却从父级重复下传的 voiceContext 孤儿链）。
    segmentVoiceSelectable() {
      const provider = (this.voiceContext && this.voiceContext.providerId) || ''
      const model = (this.voiceContext && this.voiceContext.model) || ''
      return Boolean(provider && model && Array.isArray(this.voiceCatalogOptions) && this.voiceCatalogOptions.length > 0)
    },
  },
  methods: {
    tOrKey(key, params) {
      return typeof this.$t === 'function' ? this.$t(key, params) : key
    },
    segmentBusyKind(segmentId) {
      return this.segmentBusy[segmentId] || ''
    },
    isPolicyFlagScene(index) {
      const numbers = this.policySceneNumbers
      return Boolean(numbers && typeof numbers.has === 'function' && numbers.size > 0 && numbers.has(index + 1))
    },
    setSegmentItemRef(el, index) {
      this.$emit('segment-ref', el, index)
    },
    // 展开态互斥：点开某段即收起其它段（同一时刻只有一份可编辑表单，视线不会散）
    isSegmentEditorExpanded(segmentId) {
      return Boolean(segmentId) && this.expandedSegmentId === segmentId
    },
    toggleSegmentEditor(segmentId) {
      this.expandedSegmentId = this.expandedSegmentId === segmentId ? '' : segmentId
    },
    // 删除分段前先收起它的展开态，否则会残留一个指向已删除 id 的 expandedSegmentId，
    // 让「同时只展开一个」的判据在后续点开新分段时表现得像失效。
    onRemoveSegment(index) {
      const removed = (this.segments || [])[index]
      if (removed && removed.id === this.expandedSegmentId) this.expandedSegmentId = ''
      this.$emit('remove-segment', index)
    },
    loadNextSegmentBatch() {
      const total = this.totalCount
      // 追加起点 = 当前渲染窗口上界（不是 renderedCount 本身：首次追加若从 0 开始，
      // 已解析过 URL 的首批会被再解析一遍）。窗口下界由宿主持有，这里只上报新批。
      const renderedTo = this.previewLayout.renderWindow.to
      if (renderedTo >= total) return
      const nextCount = Math.min(total, renderedTo + SEGMENT_RENDER_STEP)
      this.$emit('load-next-batch', this.segments.slice(renderedTo, nextCount), nextCount)
    },
    // 哨兵观察器：jsdom 无 IntersectionObserver 时静默跳过（保留手动按钮兜底）。
    watchSegmentListSentinel() {
      const el = this.$refs && this.$refs.segmentListSentinel
      if (this._segmentSentinelObserver) {
        this._segmentSentinelObserver.disconnect()
        this._segmentSentinelObserver = null
      }
      if (!el || typeof IntersectionObserver === 'undefined') return
      this._segmentSentinelObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) this.loadNextSegmentBatch()
      }, { rootMargin: '240px' })
      this._segmentSentinelObserver.observe(el)
    },
  },
  watch: {
    // 批次推进后重新挂哨兵（ref 变化）
    hasMoreSegmentsToRender() {
      this.$nextTick(() => this.watchSegmentListSentinel())
    },
  },
  mounted() {
    this.$nextTick(() => this.watchSegmentListSentinel())
  },
  unmounted() {
    if (this._segmentSentinelObserver) {
      this._segmentSentinelObserver.disconnect()
      this._segmentSentinelObserver = null
    }
  },
}
</script>

<style scoped>
.segment-list { display: grid; gap: 12px; }

/* 查看文案弹窗：原文案含原始换行与超长行。pre 默认 white-space: pre 不折行，
   长行会横向溢出弹窗（内容被裁切）。pre-wrap 保留原始换行并自动折行；
   overflow-wrap/word-break 兜底 URL 等无空格长串。滚动交给 .ui-modal-body，不叠第二层滚动条。 */

</style>
