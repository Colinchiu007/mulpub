<template>
  <div class="result-page">
    <div class="page-header">
      <div>
        <h1>视频预览</h1>
        <p v-if="taskTitle" class="page-subtitle" data-testid="result-task-title">{{ taskTitle }}</p>
        <p v-if="projectId" class="page-meta">{{ tOrKey('create.history.projectId') }}: {{ projectId }}</p>
      </div>
      <div class="result-header-status">
        <span v-if="project?.dirty" class="status-badge">有未合成修改</span>
        <span v-if="pipelineRunStatus" class="status-badge pipeline-run-status" data-testid="result-pipeline-status">{{ pipelineRunStatusLabel }}</span>
        <UiButton
          v-if="pipelineRunId && pipelineRunStatus === 'running'"
          size="sm"
          variant="secondary"
          data-testid="result-pause-pipeline"
          :disabled="pipelineRunActionBusy"
          @click="pausePipelineRun"
        >⏸ {{ tOrKey('create.story2video.pause') }}</UiButton>
      </div>
    </div>

    <!-- BGM 被跳过提示（由 CreateView 完成态透传 query.bgmSkipped/bgmReason） -->
    <div v-if="bgmSkippedNotice" class="bgm-skipped-notice" role="alert" data-testid="story2video-result-bgm-skipped-notice">
      🎵 {{ bgmSkippedNotice }}
    </div>

    <div v-if="loading" class="loading-state" data-testid="result-view-loading">
      <UiSkeleton variant="paragraph" :rows="4" />
    </div>

    <!-- 加载失败（QM-6 审查项 C9）：必须与「任务本来没有成片」区分开，
         否则用户关掉失败弹窗后会以为这个任务本来就没视频。 -->
    <div v-else-if="loadFailed" class="empty-state" data-testid="result-load-failed">
      <p>{{ tOrKey('story2video.sceneMaterial.loadFailedTitle') }}</p>
      <UiButton data-testid="result-load-retry-button" @click="loadProject">{{ tOrKey('story2video.sceneMaterial.loadFailedRetry') }}</UiButton>
    </div>

    <div v-else-if="!videoPath && !hasEditableContent" class="empty-state">
      <p>没有可预览的视频</p>
      <UiButton @click="$router.push('/create')">去创作</UiButton>
    </div>

    <!-- 预览区三态契约（2026-10-20，PRD-S2V-RESULT-VIEW-PERF）：
         loading 未生成成品时不渲染 <video>（不申请媒体 URL、不出现无限加载的播放器），
         改为与 <video> 同构的占位区块（固定高度 + 标题 + 说明 + 行动位），布局不跳变。 -->
    <div v-if="hasFinalVideo" class="video-section" data-testid="result-video-section">
      <video
        ref="videoPlayer"
        :src="videoSrc"
        controls
        class="video-player"
        @loadedmetadata="handleVideoMetadata"
        @timeupdate="handleTrimPreviewProgress"
        @error="handleError"
      ></video>

      <div class="video-info">
        <p v-if="completionSummary" class="completion-summary" data-testid="completion-summary">{{ completionSummary }}</p>
        <ResultModelInfoRow :project="project" :segments="segments" :format-label="formatLabel" />
        <p class="path-text">位置: {{ videoPath }}</p>
      </div>
      <div class="actions">
        <UiButton @click="download">下载视频</UiButton>
        <UiButton variant="secondary" @click="viewScript">{{ tOrKey('story2video.view_script') }}</UiButton>
        <UiButton variant="secondary" @click="exportZip">导出 ZIP</UiButton>
        <UiButton variant="secondary" @click="copyLocalPath">复制路径</UiButton>
        <UiButton variant="secondary" @click="showInFolder">打开文件夹</UiButton>
        <UiButton variant="secondary" @click="goPublish">去发布</UiButton>
        <PodcastEpisodeEntry :project="project" :segments="segments" :video-path="videoPath || ''" />
        <UiButton variant="ghost" @click="$router.push('/create')">重新创作</UiButton>
      </div>
    </div>

    <!-- 无成片时的占位区块 → 失败摘要卡（2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.2）
         旧版只有一句通用说明，回答不了用户真正的问题「为什么没生成成品视频」。
         现在给出：失败/完成段数、聚合后的主要原因、政策定位提示、定位首个失败段。
         模板与文案拼装已抽到 video-creation/ResultPreviewPlaceholder.vue（本文件是
         max-lines 点名还账对象，零增长容差）。 -->
    <ResultPreviewPlaceholder
      v-else-if="projectId && !loading"
      :placeholder="previewPlaceholder"
      :failure="failureSummary"
      :recompose-disabled="recomposing || anySegmentBusy"
      :jump-pending="jumpPendingIndex >= 0"
      @recompose="recomposeProject"
      @jump-first-failed="jumpToFirstFailedSegment"
    />

    <section v-if="videoPath" class="project-section trim-section">
      <div class="section-heading">
        <div>
          <h2>视频裁剪</h2>
          <p>导出一个新的 MP4 片段，不覆盖原视频</p>
        </div>
      </div>
      <div v-if="videoDuration" class="trim-range-panel">
        <div class="trim-range-values" aria-live="polite">
          <span>{{ formatTrimTime(trimStart) }}</span>
          <span>{{ formatTrimTime(trimEnd) }}</span>
        </div>
        <label class="trim-range-control">
          <span>开始</span>
          <input
            data-testid="trim-start-range"
            aria-label="裁剪开始时间"
            type="range"
            min="0"
            :max="trimMax"
            step="0.1"
            :value="trimStart"
            @input="setTrimBoundary('start', $event.target.value)"
          />
        </label>
        <label class="trim-range-control">
          <span>结束</span>
          <input
            data-testid="trim-end-range"
            aria-label="裁剪结束时间"
            type="range"
            min="0.1"
            :max="trimMax"
            step="0.1"
            :value="trimEnd"
            @input="setTrimBoundary('end', $event.target.value)"
          />
        </label>
      </div>
      <div class="trim-controls">
        <label>
          开始时间（秒）
          <input
            :value="trimStart"
            type="number"
            min="0"
            :max="trimEnd || videoDuration || undefined"
            step="0.1"
            @change="setTrimBoundary('start', $event.target.value)"
          />
        </label>
        <label>
          结束时间（秒）
          <input
            :value="trimEnd"
            type="number"
            :min="Number(trimStart || 0) + 0.1"
            :max="videoDuration || undefined"
            step="0.1"
            @change="setTrimBoundary('end', $event.target.value)"
          />
        </label>
        <UiButton variant="secondary" :disabled="!canTrim" @click="previewTrimRange">预览区间</UiButton>
        <UiButton :disabled="trimming || !canTrim" @click="trimVideo">
          {{ trimming ? '裁剪中...' : '导出片段' }}
        </UiButton>
      </div>
      <progress v-if="trimming" class="trim-progress" aria-label="视频裁剪进度"></progress>
      <p v-if="videoDuration" class="trim-duration">视频时长：{{ videoDuration.toFixed(1) }} 秒</p>
      <div v-if="trimmedPath" class="trim-result">
        <video :src="trimmedSrc" controls class="trimmed-player"></video>
        <div class="section-actions">
          <UiButton size="sm" variant="secondary" @click="downloadTrimmed">下载裁剪片段</UiButton>
          <UiButton size="sm" variant="ghost" @click="showTrimmedInFolder">打开所在文件夹</UiButton>
        </div>
      </div>
    </section>

    <section v-if="projectId" class="project-section narration-section">
      <div class="section-heading">
        <div>
          <h2>完整旁白</h2>
          <p>由全部分段音频按顺序合并</p>
        </div>
        <UiButton size="sm" variant="secondary" data-testid="download-narration-button" :disabled="!audioPath" @click="downloadNarration">下载旁白</UiButton>
      </div>
      <audio v-if="audioSrc" :src="audioSrc" controls class="audio-player"></audio>
      <div v-else class="asset-placeholder narration-placeholder" data-testid="narration-placeholder">
        {{ tOrKey('story2video.sceneMaterial.emptySlot') }}
      </div>
    </section>

    <!-- 分段快捷定位固定竖条（右侧 sticky，不随页面滚动）。
         2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.3/§3.6：roving tabindex + 跳转中态已抽到
         video-creation/ResultSegmentJumpBar.vue；定位样式仍留在本文件（父组件 scoped
         样式会作用到子组件根节点，媒体查询隐藏也在这里管）。 -->
    <ResultSegmentJumpBar
      v-if="projectId && segments.length > 1"
      :segments="segments"
      :active-index="activeSegmentIndex"
      :pending-index="jumpPendingIndex"
      :focus-index="jumpFocusIndex"
      @jump="scrollToSegment"
      @step="jumpSegmentBy"
      @update:focus-index="jumpFocusIndex = $event"
    />

    <!-- 分段编辑区（2026-10-20 抽为 ResultSegmentEditor，PRD-S2V-RESULT-VIEW-PERF §5）：
         本文件是 max-lines 点名还账对象（零增长容差），分段区整块搬出后宿主只留接线。 -->
    <ResultSegmentEditor
      v-if="projectId && segments.length"
      :segments="segments"
      :displayed-segments="displayedSegments"
      :segment-count-label="segmentCountLabel"
      :filtered="segmentsFiltered"
      :filter-mode="segmentFilterMode"
      :search-query="segmentSearchQuery"
      :failed-count="failureSummary.failedCount"
      :policy-count="failureSummary.policyFlaggedCount"
      :jump-pending-index="jumpPendingIndex"
      :segments-dirty="segmentsDirty"
      :segment-busy="segmentBusy"
      :policy-scene-numbers="policyFlagSceneNumbers"
      :voice-catalog-options="voiceCatalogOptions"
      :voice-catalog-error="voiceCatalogError"
      :voice-context="voiceContext"
      :unavailable-material-kinds="unavailableMaterialKinds"
      :batch-loading="segmentBatchLoading"
      :rendered-count="segmentRenderCount"
      @dirty="segmentsDirty = true"
      @move-segment="moveSegment"
      @remove-segment="removeSegment"
      @select-material="selectSceneMaterial"
      @generate-image="generateSceneImage"
      @generate-ai-video="generateSceneAiVideo"
      @regenerate-subtitle="regenerateSceneSubtitle"
      @regenerate-prompt="regenerateScenePrompt"
      @regenerate-audio="regenerateSceneAudio"
      @replace-audio="replaceSegmentAudio"
      @download-artifact="downloadArtifact"
      @preview-material="previewSceneMaterial"
      @mark-material-unavailable="markMaterialUnavailableFromEditor"
      @update-subtitle-blocks="updateSegmentSubtitleBlocks"
      @load-next-batch="onSegmentBatchLoaded"
      @expand-all="expandAllSegments"
      @update-filter-mode="segmentFilterMode = $event"
      @update-search-query="segmentSearchQuery = $event"
      @segment-ref="setSegmentItemRef"
    />

    <!-- 回到顶部（2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.6）：169 段滚到底后回顶很痛苦 -->
    <button
      v-if="showBackToTop"
      type="button"
      class="back-to-top"
      data-testid="back-to-top"
      :aria-label="tOrKey('story2video.sceneMaterial.backToTopAria')"
      :title="tOrKey('story2video.sceneMaterial.backToTop')"
      @click="backToTop"
    >↑</button>

    <!-- 底部固定操作条（2026-08-17 UX 统一）：保存分段/重新合成 不随页面滚动（2026-09-18 合并重复的再次合成视频按钮） -->
    <div v-if="projectId && segments.length" class="result-action-bar" data-testid="result-action-bar">
      <div class="result-action-bar-status">
        <span v-if="segmentsDirty" class="segments-unsaved-chip">{{ tOrKey('story2video.sceneMaterial.unsavedChanges') }}</span>
        <span v-if="saving || recomposing" class="action-bar-progress">{{ saving ? tOrKey('story2video.sceneMaterial.saving') : tOrKey('story2video.sceneMaterial.recomposing') }}</span>
      </div>
      <div class="result-action-bar-buttons">
        <UiButton :disabled="saving || anySegmentBusy" data-testid="save-segments-button" @click="saveSegments">
          {{ saving ? tOrKey('story2video.sceneMaterial.saving') : tOrKey('story2video.sceneMaterial.saveSegments') }}
        </UiButton>
        <UiButton variant="secondary" :disabled="recomposing || anySegmentBusy" data-testid="recompose-button" :title="$t('story2video.sceneMaterial.recomposeHint')" @click="recomposeProject">
          {{ recomposing ? tOrKey('story2video.sceneMaterial.recomposing') : tOrKey('story2video.sceneMaterial.recompose') }}
        </UiButton>
      </div>
    </div>

  </div>

  <UiModal :visible="unsavedLeaveDialog.visible" :title="tOrKey('story2video.sceneMaterial.unsavedLeaveTitle')" size="sm" @close="cancelUnsavedLeave">
    <p class="story2video-error-dialog-message" data-testid="unsaved-leave-message">{{ tOrKey('story2video.sceneMaterial.unsavedLeaveMessage') }}</p>
    <template #footer>
      <UiButton data-testid="unsaved-leave-save" :disabled="saving" @click="saveAndLeave">{{ tOrKey('story2video.sceneMaterial.saveAndLeave') }}</UiButton>
      <UiButton variant="ghost" data-testid="unsaved-leave-discard" :disabled="saving" @click="discardAndLeave">{{ tOrKey('story2video.sceneMaterial.discardAndLeave') }}</UiButton>
      <UiButton variant="secondary" data-testid="unsaved-leave-cancel" :disabled="saving" @click="cancelUnsavedLeave">{{ tOrKey('story2video.sceneMaterial.cancel') }}</UiButton>
    </template>
  </UiModal>

  <UiModal :visible="story2videoNotificationDialog.visible" :title="story2videoNotificationDialogUiText.dialogTitle" size="sm" @close="closeStory2VideoNotificationDialog">
    <p class="story2video-error-dialog-message">{{ story2videoNotificationDialogMessage }}</p>
    <template #footer>
      <UiButton @click="closeStory2VideoNotificationDialog">{{ story2videoNotificationDialogUiText.acknowledge }}</UiButton>
    </template>
  </UiModal>

  <UiModal :visible="sceneMaterialPreview.visible" :title="sceneMaterialPreview.title" size="xl" @close="closeSceneMaterialPreview">
    <div class="scene-material-preview-body">
      <img v-if="!sceneMaterialPreview.kind.includes('video') && sceneMaterialPreview.url" :src="sceneMaterialPreview.url" :alt="sceneMaterialPreview.label" />
      <video v-else-if="sceneMaterialPreview.kind.includes('video') && sceneMaterialPreview.url" :src="sceneMaterialPreview.url" controls autoplay @error="closeSceneMaterialPreview"></video>
      <p v-if="!sceneMaterialPreview.url" class="scene-material-preview-empty">{{ sceneMaterialPreview.label }}</p>
    </div>
  </UiModal>
  <UiModal :visible="scriptModalVisible" :title="tOrKey('story2video.script_modal_title')" size="lg" test-id="script-modal" @close="closeScriptModal">
    <div class="script-modal-body">
      <pre class="script-text" data-testid="script-text">{{ scriptText }}</pre>
    </div>
    <template #footer>
      <UiButton :disabled="!scriptText" data-testid="script-copy-button" @click="copyScript">{{ copyingScript ? tOrKey('story2video.script_copied_button') : tOrKey('story2video.script_copy_button') }}</UiButton>
      <UiButton variant="secondary" @click="closeScriptModal">{{ tOrKey('common.close') }}</UiButton>
    </template>
  </UiModal>

</template>

<script>
import UiButton from '../components/UiButton.vue'
import UiModal from '../components/UiModal.vue'
import PodcastEpisodeEntry from '../components/PodcastEpisodeEntry.vue'
import ResultModelInfoRow from './video-creation/ResultModelInfoRow.vue'
import ResultPreviewPlaceholder from './video-creation/ResultPreviewPlaceholder.vue'
import ResultSegmentEditor from './video-creation/ResultSegmentEditor.vue'
import ResultSegmentJumpBar from './video-creation/ResultSegmentJumpBar.vue'
import { buildPublishFromProject, publishDataToQuery } from '@/features/publish/publish-from-project'
import { getAppLocale } from '@/i18n'
import { STORY2VIDEO_NOTIFICATION_KEYS, formatBgmSkippedNotification, formatStory2VideoNotification, getStory2VideoNotificationUiText, resolveStory2VideoNotification } from '@/story2video/story2video-notifications'
import { getTtsVoiceCatalog } from '@/api/tts-voice-catalog'
import {
  SEGMENT_RENDER_STEP,
  buildFailureSummary,
  buildPreviewPlaceholder,
  buildSegmentCountLabel,
  effectiveSelectedMaterial,
  filterSegments,
  parseSubtitleBlocksInput,
  resolveResultPreviewLayout,
  resolveSceneMaterialSlots,
  resolveSegmentStatusReason,
  resolveSubtitleBlocksText,
} from './video-creation/composables/useResultPreviewMedia'
import {
  backToTop,
  expandAllSegments,
  jumpToSegmentIndex,
} from './video-creation/composables/useSegmentNavigation'
import {
  story2videoExportZip,
  story2videoCreateShareUrl,
  story2videoCopyPath,
  story2videoShowInFolder,
  story2videoSaveAs,
  story2videoGetProject,
  story2videoImportMedia,
  story2videoUpdateSegments,
  story2videoReplaceSegmentAudio,
  story2videoRetrySegment,
  story2videoRecomposeProject,
  story2videoSelectSceneMaterial,
  story2videoGenerateSceneImage,
  story2videoGenerateSceneVideo,
  story2videoGenerateSceneAiVideo,
  story2videoRegenerateSceneSubtitle,
  story2videoRegenerateSceneAudio,
  story2videoRegenerateScenePrompt,
  pipelineGetRunContext,
  pipelinePauseRun,
  videoProcess,
} from '@/api/publisher'

export default {
  name: 'ResultView',
  components: { UiButton, UiModal, PodcastEpisodeEntry, ResultModelInfoRow, ResultPreviewPlaceholder, ResultSegmentEditor, ResultSegmentJumpBar },
  data() {
    return {
      videoPath: null,
      loading: true,
      videoSrc: null,
      videoReloadAttempted: false,
      projectId: null,
      project: null,
      audioPath: null,
      audioSrc: null,
      segments: [],
      unavailableMaterialKinds: {},
      segmentsDirty: false,
      // 未保存修改离开守卫（2026-08-16）：hold-next 模式，弹窗确认前导航保持挂起
      pendingLeaveNext: null,
      unsavedLeaveDialog: { visible: false },
      saving: false,
      recomposing: false,
      segmentBusy: {},
      trimStart: 0,
      trimEnd: null,
      videoDuration: null,
      trimming: false,
      trimPreviewing: false,
      trimmedPath: null,
      trimmedSrc: null,
      story2videoNotificationDialog: { visible: false, messageKey: '', messageParams: {} },
      degradedAssetsWarningProjectId: null,
      sceneMaterialPreview: { visible: false, kind: '', url: '', label: '', title: '' },
      // 分段快捷定位（2026-08-17 UX 统一）
      activeSegmentIndex: -1,
      segmentItemRefs: [],
      // 滚动高亮阈值：分段顶部进入视口上方该距离内视为「当前分段」（2026-09-18）
      segmentScrollThreshold: 120,
      // 音色目录（2026-08-17 UX 统一：音色下拉）
      voiceCatalogLoading: false,
      voiceCatalogError: '',
      voiceCatalogOptions: [],
      pipelineRunId: null,
      pipelineRunStatus: null,
      pipelineRunActionBusy: false,
      scriptModalVisible: false,
      copyingScript: false,
      // 分段渲染窗口（2026-10-20，PRD-S2V-RESULT-VIEW-PERF §4.3）：已展开到的窗口下界，
      // 由列表尾哨兵进入视口时递增；无 IntersectionObserver 环境（jsdom）保持全量首屏。
      // 媒体 URL 的「已解析到哪」直接由 pendingSegmentBatch 从它派生，不另存指针
      // （QM-6 审查项 D10：曾有一个三写零读的 segmentUrlBatchCursor）。
      segmentRenderCount: 0,
      segmentBatchLoading: false,
      // 项目加载失败（QM-6 审查项 C9）：与「任务本来没有成片」区分开，
      // 空态据此显示「加载失败 + 重试」而不是误导性的「没有可预览的视频」。
      loadFailed: false,
      // ── 2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.3–§3.6 ──
      // 大跨度跳转进行中（目标段尚未进入 DOM）：渲染「正在展开到第 N 段…」，
      // 避免用户在大跳的 1–2 秒里以为点了没反应。
      jumpPendingIndex: -1,
      // roving tabindex 的焦点重置点：整组只这一个是 tabindex=0
      jumpFocusIndex: 0,
      // 分段筛选 / 搜索：只改「显示哪些」，absoluteIndex 仍是全量下标。
      segmentFilterMode: 'all',
      segmentSearchQuery: '',
      // 回到顶部按钮：滚动超过阈值才出现（避免长期悬浮污染阅读区）
      showBackToTop: false,
    }
  },
  async mounted() {
    const projectId = this.$route?.query?.project
    const filePath = this.$route?.query?.path
    this.pipelineRunId = this.normalizeRunId(this.$route?.query?.runId)
    // 滚动高亮：监听窗口滚动与尺寸变化，实时更新右侧分段导航当前分段（2026-09-18）
    window.addEventListener('scroll', this.onSegmentScroll, { passive: true })
    window.addEventListener('resize', this.onSegmentScroll)
    const loadTasks = []
    if (projectId) loadTasks.push(this.loadProject(String(projectId)))
    else if (filePath) loadTasks.push(this.loadVideoPath(String(filePath)))
    if (this.pipelineRunId) loadTasks.push(this.loadPipelineRunStatus(this.pipelineRunId))
    try {
      if (loadTasks.length > 0) await Promise.all(loadTasks)
    } finally {
      this.loading = false
    }
    // 分段列表渲染后再挂哨兵（ref 此时才存在）；无 IntersectionObserver 时保持手动按钮。
    this.$nextTick(() => this.watchSegmentListSentinel())
  },
  // 未保存修改离开守卫：dirty 时挂起导航并弹确认（hold-next，next 只调用一次），
  // 避免用户直接返回历史记录/流水线启动页时静默丢失编辑（2026-08-16）。
  beforeRouteLeave (to, from, next) {
    if (!this.segmentsDirty) { next(); return }
    this.pendingLeaveNext = next
    this.unsavedLeaveDialog.visible = true
  },
  // 测试/异常兜底：组件被销毁且守卫仍挂起时，取消导航，防止 next 悬挂。
  unmounted () {
    if (typeof this.pendingLeaveNext === 'function') {
      this.pendingLeaveNext(false)
      this.pendingLeaveNext = null
    }
    if (this._segmentSentinelObserver) {
      this._segmentSentinelObserver.disconnect()
      this._segmentSentinelObserver = null
    }
    window.removeEventListener('scroll', this.onSegmentScroll)
    window.removeEventListener('resize', this.onSegmentScroll)
  },
  computed: {
    // 有可编辑内容：projectId + segments 存在即渲染分段编辑区，无成片（failed/paused/未合成）任务也可编辑（2026-08-17）
    hasEditableContent() {
      return Boolean(this.projectId && Array.isArray(this.segments) && this.segments.length)
    },
    // 任务标题回退链：发布标题 → 原文案前 60 字 → 项目 ID（2026-08-17）
    taskTitle() {
      const title = this.project && (this.project.title || this.project.publishTitle)
      if (title) return title
      const firstText = (Array.isArray(this.segments) ? this.segments : []).find(segment => segment && segment.text)?.text
      if (firstText) {
        const text = String(firstText)
        return text.length > 60 ? text.slice(0, 59) + '…' : text
      }
      return this.projectId || ''
    },
    // 项目语音上下文：优先项目选项，其次首个带 voiceProvider/voiceModel 的分段（音色目录查询入参）
    voiceContext() {
      const fromOptions = this.project && this.project.options ? this.project.options : {}
      const first = (Array.isArray(this.segments) ? this.segments : []).find(segment => segment && (segment.voiceProvider || segment.voiceModel))
      return {
        providerId: fromOptions.voiceProvider || (first && first.voiceProvider) || '',
        model: fromOptions.voiceModel || (first && first.voiceModel) || '',
      }
    },
    voiceOptionIds() {
      return new Set((this.voiceCatalogOptions || []).map(voice => voice.id).filter(Boolean))
    },
    segmentVoiceOptions() {
      return Array.isArray(this.voiceCatalogOptions) ? this.voiceCatalogOptions : []
    },
    // 目录可用（上下文完整 + 加载成功且非空）时用下拉；否则回退文本框输入
    segmentVoiceSelectable() {
      return Boolean(this.voiceContext.providerId && this.voiceContext.model && !this.voiceCatalogLoading && this.segmentVoiceOptions.length > 0)
    },
    // 历史记录提示词翻译（2026-08-12）：非 en 界面且分段存在翻译时展示只读文案
    promptTranslationLabel() {
      const key = getAppLocale() === 'zh'
        ? 'story2video.sceneMaterial.promptTranslationLabelZh'
        : 'story2video.sceneMaterial.promptTranslationLabelOther'
      return this.tOrKey(key)
    },
    bgmSkippedNotice() {
      const query = this.$route?.query || {}
      if (query.bgmSkipped !== '1') return ''
      return formatBgmSkippedNotification(query.bgmReason).message
    },
    // 内容政策失败任务从历史跳转时携带 focusScenes（1-based 场景号，逗号分隔）：    // 场景号 = 分段下标 + 1，用于定位需要修改文案的分段；非法/缺省一律为空集合（fail-safe）
    policyFlagSceneNumbers() {
      const raw = String(this.$route?.query?.focusScenes || '')
      const numbers = new Set()
      for (const part of raw.split(',')) {
        const trimmed = String(part).trim()
        const value = Number(trimmed)
        if (Number.isInteger(value) && value > 0 && String(value) === trimmed) numbers.add(value)
      }
      return numbers
    },
    // 任一分段正在生成/重试时禁用全局保存与重新合成，避免与主进程写队列交叉（审查 W2）
    anySegmentBusy() {
      return Object.keys(this.segmentBusy || {}).some(key => Boolean(this.segmentBusy[key]))
    },
    completionSummary() {
      const query = this.$route?.query || {}
      const parts = []
      if (Number.isFinite(Number(query.durationMs)) && Number(query.durationMs) > 0) {
        const total = Math.floor(Number(query.durationMs) / 1000)
        const minutes = Math.floor(total / 60)
        const seconds = total % 60
        parts.push('完成时间共 ' + (minutes > 0 ? minutes + ' 分 ' + seconds + ' 秒' : seconds + ' 秒'))
      }
      if (Number.isFinite(Number(query.sizeBytes)) && Number(query.sizeBytes) > 0) {
        parts.push('文件大小 ' + (Number(query.sizeBytes) / 1048576).toFixed(1) + ' M')
      }
      return parts.join(' · ')
    },
    formatLabel() {
      const extension = String(this.videoPath || '').split('.').pop()
      return extension ? extension.toUpperCase() : '视频'
    },
    canTrim() {
      const start = Number(this.trimStart)
      const end = Number(this.trimEnd)
      const duration = Number(this.videoDuration)
      return Boolean(this.videoPath) && Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end > start &&
        (!Number.isFinite(duration) || duration <= 0 || end <= duration)
    },
    trimMax() {
      const duration = Number(this.videoDuration)
      if (Number.isFinite(duration) && duration > 0) return duration
      const end = Number(this.trimEnd)
      return Number.isFinite(end) && end > 0 ? end : 0.1
    },
    // 无成片时的预览占位区块文案（zh/en 成对，来自 locales 单一真源）
    previewPlaceholder() {
      return buildPreviewPlaceholder({
        translate: key => this.tOrKey(key),
        projectId: this.projectId,
        hasEditableContent: this.hasEditableContent,
      })
    },
    // 失败摘要（2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.2）：
    // 让占位区块回答「为什么没生成成品视频」，而不是只说「可先编辑再重新合成」。
    failureSummary() {
      return buildFailureSummary({ segments: this.segments })
    },
    // 首屏批次 + 渲染窗口 + 预览三态：全部由 composable 计算（单一真源），
    // 本文件只做薄接线（max-lines 点名还账对象，零增长容差）。
    previewLayout() {
      return resolveResultPreviewLayout({
        segments: this.segments,
        project: this.project,
        ownVideoPath: this.videoPath,
        renderedCount: this.segmentRenderCount,
        policySceneNumbers: this.policyFlagSceneNumbers,
      })
    },
    // 首屏批次：loadProject 只用它申请媒体 URL；哨兵触发后由 batchCursor 追加。
    segmentFirstBatch() {
      return this.previewLayout.firstBatch
    },
    // 已渲染段（首屏批次 + 窗口内追加段）：写后刷新的缺省作用域。
    // 未渲染段不在 DOM 里、用户改不到它，其 URL 等进入窗口时再取（QM-6 审查项 A2）。
    renderedSegments() {
      return this.previewLayout.visibleSegments.map(item => item.segment)
    },
    pendingSegmentBatch() {
      return this.previewLayout.pendingBatch
    },
    visibleSegments() {
      return this.previewLayout.visibleSegments
    },
    // 筛选/搜索是否生效（任一非默认即生效）
    segmentsFiltered() {
      return this.segmentFilterMode !== 'all' || Boolean(String(this.segmentSearchQuery || '').trim())
    },
    // 最终要塞进编辑器的分段：先按全量下标取可见窗口，再套筛选/搜索。
    // **absoluteIndex 始终是全量下标**（先把 previewLayout 的窗口项做筛选，不重新编号），
    // 否则「只看失败段」模式下点上移/删除会作用到别的段。
    displayedSegments() {
      if (!this.segmentsFiltered) return this.visibleSegments
      // 筛选时跨全量分段搜索（用户预期是在整个任务里找，而不是只在已展开的 20 段里找）
      return filterSegments(this.segments, {
        mode: this.segmentFilterMode,
        query: this.segmentSearchQuery,
        policySceneNumbers: this.policyFlagSceneNumbers,
      })
    },
    // 分段计数文案：169 段要告诉用户「还有多少段没显示」
    segmentCountLabel() {
      const shown = this.segmentsFiltered
        ? this.displayedSegments.length
        : this.visibleSegments.length
      return buildSegmentCountLabel({
        shown,
        total: Array.isArray(this.segments) ? this.segments.length : 0,
        filtered: this.segmentsFiltered,
        translate: (key, params) => this.tOrKey(key, params),
      })
    },
    // 预览区三态的唯一判据（无成片 ⇒ EMPTY，不得发起预览相关 IPC）
    hasFinalVideo() {
      return this.previewLayout.hasFinalVideo
    },
    hasMoreSegmentsToRender() {
      const all = Array.isArray(this.segments) ? this.segments : []
      return this.segmentRenderCount + SEGMENT_RENDER_STEP < all.length
    },
    degradedAssetKinds() {
      const kinds = new Set()
      for (const segment of this.segments) {
        if (segment?.imageMeta?.degraded === true) kinds.add('placeholder_image')
        if (segment?.audioMeta?.degraded === true) kinds.add('silent_narration')
      }
      return [...kinds]
    },
    hasDegradedAssets() {
      return this.degradedAssetKinds.length > 0
    },
    story2videoNotificationDialogMessage() {
      return formatStory2VideoNotification({
        messageKey: this.story2videoNotificationDialog.messageKey,
        messageParams: this.story2videoNotificationDialog.messageParams,
      }).message
    },
    story2videoNotificationDialogUiText() {
      return getStory2VideoNotificationUiText()
    },
    pipelineRunStatusLabel() {
      if (!this.pipelineRunStatus) return ''
      return this.tOrKey('create.history.statuses.' + this.pipelineRunStatus)
    },
    // 弹窗与复制共用同一份文本：优先原始文案（分句/分段之前的完整输入）。
    // sourceText 由流水线启动时 params.text 落盘（story2video-project-service.js），
    // 是用户在创作页提交的原文；segments[].text 是分句后的分段，带编号会污染复制内容。
    scriptText() {
      const sourceText = (this.project && typeof this.project.sourceText === 'string')
        ? this.project.sourceText.trim()
        : ''
      if (sourceText) return sourceText
      // 兼容缺失 sourceText 的历史项目（老版本落盘）：回退为分段文字拼接，且不带分段编号。
      if (!Array.isArray(this.segments) || !this.segments.length) return ''
      return this.segments
        .map(segment => (segment && typeof segment.text === 'string') ? segment.text.trim() : '')
        .filter(Boolean)
        .join('\n\n')
    },
  },
  methods: {
    // 去发布：从当前项目提取发布数据并跳转发布页（视频模式预填充）。
    // 有完整项目对象时走 buildPublishFromProject；仅文件路径模式（无 project）时只带视频路径。
    viewScript() {
      this.scriptModalVisible = true
    },
    closeScriptModal() {
      this.scriptModalVisible = false
      this.copyingScript = false
    },
    async copyScript() {
      const text = this.scriptText
      if (!text) return
      this.copyingScript = true
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          const textarea = document.createElement('textarea')
          textarea.value = text
          textarea.style.position = 'fixed'
          textarea.style.opacity = '0'
          document.body.appendChild(textarea)
          textarea.select()
          document.execCommand('copy')
          document.body.removeChild(textarea)
        }
      } catch (_) {
        // fallback already handled
      }
      setTimeout(() => { this.copyingScript = false }, 1500)
    },

    goPublish() {
      const data = this.project ? buildPublishFromProject(this.project) : null
      const videoPath = (data && data.video_path) || (typeof this.videoPath === 'string' ? this.videoPath : '')
      if (!videoPath) return
      const query = data ? publishDataToQuery(data) : { type: 'video', video_path: encodeURIComponent(videoPath) }
      this.$router.push({ path: '/publish', query })
    },
    normalizeRunId(value) {
      if (typeof value !== 'string') return ''
      const normalized = value.trim()
      return normalized && normalized.length <= 256 ? normalized : ''
    },
    async loadPipelineRunStatus(runId = this.pipelineRunId) {
      const normalizedRunId = this.normalizeRunId(runId)
      if (!normalizedRunId) return false
      try {
        const result = await pipelineGetRunContext(normalizedRunId)
        if (this.pipelineRunId !== normalizedRunId) return false
        if (result?.code !== 0 || !result.data) {
          this.pipelineRunStatus = null
          return false
        }
        const status = result.data.status && typeof result.data.status === 'object'
          ? result.data.status.status
          : result.data.status
        this.pipelineRunStatus = typeof status === 'string' && status.trim() ? status.trim() : null
        return Boolean(this.pipelineRunStatus)
      } catch (_) {
        if (this.pipelineRunId === normalizedRunId) this.pipelineRunStatus = null
        return false
      }
    },
    async pausePipelineRun() {
      if (!this.pipelineRunId || this.pipelineRunStatus !== 'running' || this.pipelineRunActionBusy) return false
      this.pipelineRunActionBusy = true
      try {
        const result = await pipelinePauseRun(this.pipelineRunId)
        if (result?.code !== 0) {
          this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.OPERATION_FAILED, error: result?.message })
          return false
        }
        await this.loadPipelineRunStatus(this.pipelineRunId)
        return this.pipelineRunStatus === 'paused'
      } catch (error) {
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.OPERATION_FAILED, error: error?.message })
        return false
      } finally {
        this.pipelineRunActionBusy = false
      }
    },
    // 字幕文本与失败原因的解析逻辑已抽到 composable（宿主与 ResultSegmentEditor 共用），
    // 此处保留薄包装供既有调用与测试沿用。
    subtitleBlocksText(segment) {
      return resolveSubtitleBlocksText(segment)
    },
    segmentVoiceSpeedText(segment) {
      const speed = Number(segment && segment.voiceSpeed)
      return Number.isFinite(speed) && speed > 0 ? speed.toFixed(1) : '1.0'
    },
    segmentStatusReason(segment) {
      return resolveSegmentStatusReason(segment, {
        resolveNotification: resolveStory2VideoNotification,
        truncate: (value, max) => this.truncateStory2VideoText(value, max),
      })
    },
    truncateStory2VideoText(value, max) {
      const points = Array.from(String(value || ''))
      return points.length > max ? points.slice(0, max - 1).join('') + '…' : points.join('')
    },
    // 导航类动作全部委托 composables/useSegmentNavigation.js（纯逻辑、可单测）：
    // 宿主只保留这层薄接线，避免把「扩窗 / 只解析新增段 / 跳转反馈」再实现一遍。
    async jumpToSegmentIndex(index) {
      return jumpToSegmentIndex(this, index)
    },
    async jumpToFirstFailedSegment() {
      const index = this.failureSummary.firstFailedIndex
      if (index < 0) return false
      return this.jumpToSegmentIndex(index)
    },
    async expandAllSegments() {
      return expandAllSegments(this)
    },
    backToTop() {
      return backToTop(this)
    },
    // ── ResultSegmentEditor 桥接（2026-10-20 抽组件后宿主只留接线） ──
    // 分段区整块搬到 video-creation/ResultSegmentEditor.vue（本文件是 max-lines
    // 点名还账对象，零增长容差）。以下是它 emit 回宿主的纯数据动作。
    markMaterialUnavailableFromEditor(segment, kind) {
      if (!segment || !kind) return
      this.markMaterialUnavailable(segment, kind)
    },
    // 分享 URL 失效：清渲染端坏 URL + 标记素材位不可用（保留来源路径供恢复）。
    // 编辑器内也有一份同语义实现（它要先改 DOM 上的 URL）；宿主保留本方法供
    // 既有调用与测试沿用，两边行为由同一组断言守住。
    clearSceneMaterialUrl(segment, kind) {
      if (!segment || !kind) return
      if (kind === 'image1') segment.imageUrl = null
      else if (kind === 'image2') segment.alternateImageUrls = []
      else if (kind === 'video1') segment.videoUrl = null
      else if (kind === 'video2') segment.altVideoUrl = null
      this.markMaterialUnavailable(segment, kind)
    },
    onSegmentBatchLoaded(batch, nextCount) {
      // 编辑器上报的新增批：宿主推进窗口下界（单一真源），并只解析这一批的媒体 URL
      if (Number.isInteger(nextCount) && nextCount > this.segmentRenderCount) {
        this.segmentRenderCount = nextCount
      }
      return this.refreshSegmentImageUrls(Array.isArray(batch) ? batch : [])
    },
    // 分段快捷定位（2026-08-17 UX 统一）：分段卡片 ref 收集 + 数字跳转 + 上一条/下一条
    setSegmentItemRef(el, index) {
      if (el) this.segmentItemRefs[index] = el
    },
    // 滚动高亮：根据各分段卡片顶部相对视口的位置，更新右侧导航当前分段（2026-09-18）
    //
    // 2026-10-20 QM-6 审查项 A3 修复：refs 是**按全量下标寻址的稀疏数组**
    // （点名段并入首屏后，169 段任务 + focusScenes=49 ⇒ refs.length=49 但只挂 21 个，
    // refs[20..47] 全是 undefined）。旧实现 `for (i < min(refs.length, segments.length))`
    // 把「稀疏数组长度」当连续下标上界，遇到空洞就 continue ⇒ activeSegmentIndex 被设成
    // 「有 ref 的最大位次」而非用户实际看到的段，高亮与滚动位置脱节。
    // 修法：改为 Object.keys 遍历实际挂上的 ref，下标即全量 absoluteIndex。
    //
    // 2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.5 补充：**rAF 合并 + 回顶显隐**。
    // 旧实现直接挂在 window scroll 上，169 段全展开时每个 scroll 事件都做 169 次
    // getBoundingClientRect（强制重排）⇒ 滚动发涩、右侧高亮拖尾。
    // 现在同一帧的多条 scroll 事件只算一次（rAF 合并），并把「回顶按钮显隐」并入同一次计算。
    onSegmentScroll() {
      if (typeof window === 'undefined') return
      // 回顶显隐与高亮无关，但同属滚动回调，合并到一帧里算，避免额外监听
      const nextShowBackToTop = (Number(window.scrollY) || 0) > 600
      if (nextShowBackToTop !== this.showBackToTop) this.showBackToTop = nextShowBackToTop

      // 前沿节流（leading-edge）：本帧第一次滚动**立即**算一次（保证高亮即时跟手，
      // 也让同步断言成立），同帧后续事件只把「帧标记」清空、不再重算。
      // 效果与「每帧最多 1 次」等价，但不会让高亮滞后一帧。
      if (this._segmentScrollFrame) return
      this.computeActiveSegmentIndex()
      const raf = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (cb) => setTimeout(cb, 16)
      this._segmentScrollFrame = raf(() => {
        this._segmentScrollFrame = null
      })
    },
    // 真正的重活：遍历已挂 ref 求当前分段（由 onSegmentScroll 经 rAF 合并后调用）
    // 程序化重算（删除/移动/新增分段后、跳转后）：**不受滚动节流**，立即算一次。
    // 滚动节流只该合并「用户滚动」这种高频事件；程序化重算若被同帧吞掉，
    // 高亮会滞留在被删掉的那一段上（本仓曾出现该形态）。
    recalcSegmentHighlight() {
      this._segmentScrollFrame = null
      this.computeActiveSegmentIndex()
    },
    computeActiveSegmentIndex() {
      const refs = Array.isArray(this.segmentItemRefs) ? this.segmentItemRefs : []
      if (!refs.length || !Array.isArray(this.segments) || !this.segments.length) return
      const threshold = Number(this.segmentScrollThreshold) >= 0 ? Number(this.segmentScrollThreshold) : 120
      let current = -1
      let bestTop = -Infinity
      for (const key of Object.keys(refs)) {
        const i = Number(key)
        if (!Number.isInteger(i) || i < 0) continue
        const el = refs[i]
        if (!el || typeof el.getBoundingClientRect !== 'function') continue
        const rect = el.getBoundingClientRect()
        // 分段顶部进入视口上方阈值区域 → 候选当前分段；取顶部最接近视口顶部的那个（top 最大）
        if (rect && typeof rect.top === 'number' && rect.top <= threshold && rect.top > bestTop) {
          bestTop = rect.top
          current = i
        }
      }
      if (current >= 0) this.activeSegmentIndex = current
    },
    // 分段渲染窗口推进（2026-10-20，PRD-S2V-RESULT-VIEW-PERF §4.3）：
    // 先扩窗口让新分段进 DOM，再只解析新增那一批的媒体 URL。
    // 追加起点 = 当前渲染窗口上界 `renderWindow.to`（不是 segmentRenderCount 本身，
    // 否则首次追加会从 0 开始、把已解析过的首批再解析一遍——QM-6 审查发现的重复解析）。
    async loadNextSegmentBatch() {
      const total = Array.isArray(this.segments) ? this.segments.length : 0
      const renderedTo = this.previewLayout.renderWindow.to
      if (this.segmentBatchLoading || renderedTo >= total) return
      this.segmentBatchLoading = true
      try {
        const nextCount = Math.min(total, renderedTo + SEGMENT_RENDER_STEP)
        const batch = this.segments.slice(renderedTo, nextCount)
        this.segmentRenderCount = nextCount
        await this.refreshSegmentImageUrls(batch)
      } finally {
        this.segmentBatchLoading = false
      }
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
    // 分段定位（2026-10-20 QM-6 审查项 C7 修复）：
    // 分批渲染后，目标段可能还没进渲染窗口（169 段点「跳到第 150 段」）。
    // 旧实现此时静默跳过：activeSegmentIndex 已跳（高亮走了）但视口纹丝不动，
    // 「状态与视图矛盾」比完全没反应更糟，且右侧 169 个数字全都可点、无 disabled 无提示。
    // 修法：先把渲染窗口一步扩展到覆盖目标位次（不要循环 7 批，那会串行 560 次 IPC），
    // 只解析新增那一段的 URL，等 DOM 落地后再 scrollIntoView。
    // 供既有调用（模板数字导航 / 上一条下一条）沿用：一律委托 jumpToSegmentIndex
    // （单一真源，含大跨度扩窗 + 跳转反馈 + 只解析新增段）
    async scrollToSegment(index) {
      await this.jumpToSegmentIndex(index)
    },
    jumpSegmentBy(offset) {
      const base = this.activeSegmentIndex >= 0 ? this.activeSegmentIndex : 0
      const target = base + Number(offset)
      this.scrollToSegment(target)
    },
    // 音色目录加载：项目语音上下文缺失或目录不可用时保持空目录，UI 自动回退文本框（2026-08-17）
    async loadVoiceCatalog() {
      const { providerId, model } = this.voiceContext
      if (!providerId || !model) {
        this.voiceCatalogOptions = []
        this.voiceCatalogError = ''
        return
      }
      this.voiceCatalogLoading = true
      try {
        const result = await getTtsVoiceCatalog({ providerId, model })
        const data = result && result.code === 0 && result.data && typeof result.data === 'object' ? result.data : null
        if (!data) {
          this.voiceCatalogOptions = []
          this.voiceCatalogError = String((result && result.message) || 'voice catalog unavailable')
          return
        }
        const normalize = voice => {
          if (!voice || typeof voice !== 'object') return null
          const id = String(voice.id || voice.voiceId || voice.voice_id || '').trim()
          if (!id) return null
          return { id, name: String(voice.name || voice.displayName || voice.display_name || id), invalid: voice.invalid === true }
        }
        this.voiceCatalogOptions = [
          ...(Array.isArray(data.voices) ? data.voices.map(normalize).filter(Boolean) : []),
          ...(Array.isArray(data.invalidVoices) ? data.invalidVoices.map(normalize).filter(Boolean) : []),
        ]
        this.voiceCatalogError = ''
      } catch (_error) {
        this.voiceCatalogOptions = []
        this.voiceCatalogError = 'voice catalog load failed'
      } finally {
        this.voiceCatalogLoading = false
      }
    },
    // 防御式翻译：无 i18n 上下文（如部分单测 mount）时回落 key，生产环境正常返回本地化文案
    tOrKey(key, params) {
      return typeof this.$t === 'function' ? this.$t(key, params) : key
    },
    showStory2VideoNotification(notification = {}) {
      const resolved = resolveStory2VideoNotification(notification)
      this.story2videoNotificationDialog = { visible: true, messageKey: resolved.key, messageParams: resolved.params }
    },
    closeStory2VideoNotificationDialog() {
      this.story2videoNotificationDialog.visible = false
    },
    showStory2VideoOperationFailure() {
      this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.OPERATION_FAILED })
    },
    maybeShowDegradedAssetsWarning() {
      if (!this.projectId || !this.hasDegradedAssets || this.degradedAssetsWarningProjectId === this.projectId) return
      this.degradedAssetsWarningProjectId = this.projectId
      this.showStory2VideoNotification({
        messageKey: STORY2VIDEO_NOTIFICATION_KEYS.DEGRADED_ASSETS_WARNING,
        messageParams: { assetKinds: this.degradedAssetKinds },
      })
    },
    showPromptTranslation(segment) {
      if (getAppLocale() === 'en') return false
      const translation = segment && segment.promptTranslation
      return typeof translation === 'string' && translation.trim() !== ''
    },
    async resolveLocalUrl(filePath, previousUrl) {      if (!filePath) return null
      const result = await story2videoCreateShareUrl(filePath, previousUrl)
      const url = result?.code === 0 ? (result.data?.url || result.data) : null
      if (!url) throw new Error(result?.message || '无法读取本地文件')
      return url
    },
    materialKey(segment, kind) {
      return String(segment?.id || '') + ':' + String(kind || '')
    },
    isMaterialUnavailable(segment, kind) {
      return Boolean(this.unavailableMaterialKinds[this.materialKey(segment, kind)])
    },
    markMaterialUnavailable(segment, kind) {
      if (!segment || !kind) return
      this.unavailableMaterialKinds = {
        ...this.unavailableMaterialKinds,
        [this.materialKey(segment, kind)]: true,
      }
    },
    clearMaterialUnavailable(segment, kind) {
      if (!segment || !kind) return
      const key = this.materialKey(segment, kind)
      if (!this.unavailableMaterialKinds[key]) return
      const next = { ...this.unavailableMaterialKinds }
      delete next[key]
      this.unavailableMaterialKinds = next
    },
    async refreshSegmentImageUrls(segments = null) {
      // 入参缺省时刷新**已渲染段**，不再全量（QM-6 审查项 A2）：
      // 保存/重试/重新合成等写后刷新原先对全量 169 段跑一遍（上限 ~845 次 IPC），
      // 而未渲染段不在 DOM 里、用户根本改不到它——它的 URL 等进入渲染窗口时再取即可。
      // 首屏路径仍显式传第一批（pendingSegmentBatch），哨兵/定位传新增批。
      const list = Array.isArray(segments) ? segments : this.renderedSegments
      await Promise.all(list.map(async (segment) => {
        if (!segment) return
        if (!segment.imagePath) {
          segment.imageUrl = null
          this.markMaterialUnavailable(segment, 'image1')
        }
        try {
          if (segment.imagePath) {
            segment.imageUrl = await this.resolveLocalUrl(segment.imagePath, segment.imageUrl)
            this.clearMaterialUnavailable(segment, 'image1')
          }
        } catch (_) {
          segment.imageUrl = null
          this.markMaterialUnavailable(segment, 'image1')
        }
      }))
      await this.refreshSceneMaterialUrls(segments)
    },
    async refreshSceneMaterialUrls(segments = null) {
      // 与 refreshSegmentImageUrls 同口径：缺省全量（写后刷新），显式传第一批（首屏）。
      const list = Array.isArray(segments) ? segments : (this.segments || [])
      await Promise.all(list.map(async (segment) => {
        if (!segment) return
        const alternate = Array.isArray(segment.alternateImages) ? segment.alternateImages[0] : null
        if (alternate && alternate.path) {
          try {
            segment.alternateImageUrls = [await this.resolveLocalUrl(alternate.path, Array.isArray(segment.alternateImageUrls) ? segment.alternateImageUrls[0] : null)]
            this.clearMaterialUnavailable(segment, 'image2')
          } catch (_) {
            segment.alternateImageUrls = []
            this.markMaterialUnavailable(segment, 'image2')
          }
        } else {
          segment.alternateImageUrls = []
          this.markMaterialUnavailable(segment, 'image2')
        }
        // 优先显示场景独立生成的 AI 视频片段，而非合成后的成片视频（2026-08-18）
        const sceneVideoPath = (segment.videoMeta && segment.videoMeta.sceneVideoPath) || null
        const altSceneVideoPath = (segment.videoMeta && segment.videoMeta.altSceneVideoPath) || segment.altVideoPath || null
        if (sceneVideoPath) {
          try {
            segment.videoUrl = await this.resolveLocalUrl(sceneVideoPath, segment.videoUrl)
            this.clearMaterialUnavailable(segment, 'video1')
          } catch (_) {
            segment.videoUrl = null
            this.markMaterialUnavailable(segment, 'video1')
          }
        } else {
          // Older projects stored the primary scene video in videoPath.
          const legacyVideoPath = typeof segment.videoPath === 'string' && segment.videoPath.trim() ? segment.videoPath : null
          if (legacyVideoPath) {
            try {
              segment.videoUrl = await this.resolveLocalUrl(legacyVideoPath, segment.videoUrl)
              this.clearMaterialUnavailable(segment, 'video1')
            } catch (_) {
              segment.videoUrl = null
              this.markMaterialUnavailable(segment, 'video1')
            }
          } else {
            segment.videoUrl = null
            this.markMaterialUnavailable(segment, 'video1')
          }
        }
        if (altSceneVideoPath) {
          try {
            segment.altVideoUrl = await this.resolveLocalUrl(altSceneVideoPath, segment.altVideoUrl)
            this.clearMaterialUnavailable(segment, 'video2')
          } catch (_) {
            segment.altVideoUrl = null
            this.markMaterialUnavailable(segment, 'video2')
          }
        } else {
          segment.altVideoUrl = null
          this.markMaterialUnavailable(segment, 'video2')
        }
        if (segment.audioPath) {
          try {
            segment.audioUrl = await this.resolveLocalUrl(segment.audioPath, segment.audioUrl)
          } catch (_) {
            segment.audioUrl = null
          }
        } else {
          segment.audioUrl = null
        }
      }))
    },
    effectiveSelectedMaterial(segment) {
      return effectiveSelectedMaterial(segment)
    },
    // 素材槽位解析（与 ResultSegmentEditor 同一 composable 真源）：宿主用于
    // selectSceneMaterial 的事前校验——该槽位没有可用路径就不发 IPC。
    sceneMaterialSlots(segment) {
      return resolveSceneMaterialSlots(segment, {
        label: key => this.tOrKey('story2video.sceneMaterial.' + key),
        unavailable: this.unavailableMaterialKinds,
      })
    },
    previewSceneMaterial(slot) {
      this.sceneMaterialPreview = {
        visible: true,
        kind: slot.kind,
        url: slot.url,
        label: slot.label,
        title: slot.kind.includes('video')
          ? this.$t('story2video.sceneMaterial.previewVideoTitle')
          : this.$t('story2video.sceneMaterial.previewImageTitle'),
      }
    },
    closeSceneMaterialPreview() {
      this.sceneMaterialPreview.visible = false
    },
    async selectSceneMaterial(segmentId, kind) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      if (!['image1', 'image2', 'video1', 'video2'].includes(kind)) return
      const segment = (this.segments || []).find(item => item && item.id === segmentId)
      const slot = segment ? this.sceneMaterialSlots(segment).find(item => item.kind === kind) : null
      if (!slot || !slot.selectable) return
      const persistedKind = kind.includes('video') ? 'video' : kind
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'select' }
      try {
        const result = await story2videoSelectSceneMaterial(this.projectId, segmentId, persistedKind)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'material selection failed')
        this.project = result.data
        if (Array.isArray(result.data.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(item => ({ ...item }))
        }
        this.segmentsDirty = true
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MATERIAL_SELECTED })
      } catch (error) {
        this.showStory2VideoNotification({ error: error && error.message ? error.message : 'material select failed' })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async generateSceneAiVideo(segmentId) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      const segment = (this.segments || []).find(item => item && item.id === segmentId)
      if (!this.hasUsableVideoPrompt(segment)) return
      // 重新生成前先落盘本地编辑：避免基于旧优化词生成，也防止服务端响应覆盖未保存修改（与 W3 语义一致）
      if (this.segmentsDirty && !(await this.saveSegments())) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'aiVideo' }
      try {
        const result = await story2videoGenerateSceneAiVideo(this.projectId, segmentId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'AI video generation failed')
        this.project = result.data
        this.segments = Array.isArray(result.data.segments)
          ? result.data.segments.map(item => ({ ...item }))
          : this.segments
        this.segmentsDirty = true
        // 服务端返回的分段不含素材 URL，重新解析本地媒体 URL 避免素材区空白
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATED })
      } catch (error) {
        this.showStory2VideoNotification({
          messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED,
          error: error && error.message ? error.message : '',
        })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async generateSceneImage(segmentId) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'genImage' }
      try {
        const result = await story2videoGenerateSceneImage(this.projectId, segmentId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'image generation failed')
        this.project = result.data
        if (Array.isArray(result.data.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(item => ({ ...item }))
        }
        this.segmentsDirty = true
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_IMAGE_GENERATED })
      } catch (error) {
        await this.refreshSegmentImageUrls().catch(() => {})
        this.showStory2VideoNotification({ error: error && error.message ? error.message : 'image generation failed' })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async generateSceneVideo(segmentId) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'genVideo' }
      try {
        const result = await story2videoGenerateSceneVideo(this.projectId, segmentId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'video generation failed')
        this.project = result.data
        if (Array.isArray(result.data.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(item => ({ ...item }))
        }
        this.segmentsDirty = true
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_VIDEO_GENERATED })
      } catch (error) {
        await this.refreshSegmentImageUrls().catch(() => {})
        this.showStory2VideoNotification({ error: error && error.message ? error.message : 'video generation failed' })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    // 字幕编辑：blocks 显式存在（含空数组=用户清空）时直接展示，避免清空后回退旧 timeline（审查 I1）
    updateSegmentSubtitleBlocks(segment, value) {
      if (!segment) return
      segment.subtitleBlocks = parseSubtitleBlocksInput(value)
      // 手动编辑后时间轴为派生数据：置空避免合成沿用陈旧时间轴（与 regenerateSceneSubtitle 语义一致，审查 I1）
      segment.subtitleTimeline = []
      this.segmentsDirty = true
    },
    async regenerateSceneSubtitle(segmentId) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      // 重新生成前先落盘本地编辑：避免基于旧文案重切，也防止服务端响应覆盖未保存修改（审查 W3）
      if (this.segmentsDirty && !(await this.saveSegments())) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'subtitle' }
      try {
        const result = await story2videoRegenerateSceneSubtitle(this.projectId, segmentId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'subtitle regeneration failed')
        this.project = result.data
        this.segments = Array.isArray(result.data.segments)
          ? result.data.segments.map(item => ({ ...item }))
          : this.segments
        this.segmentsDirty = true
        // 服务端返回的分段不含素材 URL，重新解析本地媒体 URL 避免素材区空白
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_SUBTITLE_REGENERATED })
      } catch (error) {
        this.showStory2VideoNotification({
          messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_SUBTITLE_REGENERATE_FAILED,
          error: error && error.message ? error.message : '',
        })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async regenerateSceneAudio(segmentId) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      // 重新生成前先落盘本地编辑（审查 W3）
      if (this.segmentsDirty && !(await this.saveSegments())) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'tts' }
      try {
        const result = await story2videoRegenerateSceneAudio(this.projectId, segmentId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'audio regeneration failed')
        this.project = result.data
        this.segments = Array.isArray(result.data.segments)
          ? result.data.segments.map(item => ({ ...item }))
          : this.segments
        this.segmentsDirty = true
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AUDIO_REGENERATED })
      } catch (error) {
        this.showStory2VideoNotification({
          error: error && error.message ? error.message : '',
          fallbackKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AUDIO_REGENERATE_FAILED,
        })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async regenerateScenePrompt(segmentId, kind) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      // 重新生成前先落盘本地编辑（审查 W3）
      if (this.segmentsDirty && !(await this.saveSegments())) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: kind === 'video' ? 'promptVideo' : 'promptImage' }
      try {
        const result = await story2videoRegenerateScenePrompt(this.projectId, segmentId, kind)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'prompt regeneration failed')
        this.project = result.data
        this.segments = Array.isArray(result.data.segments)
          ? result.data.segments.map(item => ({ ...item }))
          : this.segments
        this.segmentsDirty = true
        // 服务端返回的分段不含素材 URL，重新解析本地媒体 URL 避免素材区空白
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_PROMPT_REGENERATED })
      } catch (error) {
        this.showStory2VideoNotification({
          // 仅作为未知错误的回退；让额度、限流、API Key 等原始错误进入统一归一化。
          fallbackKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_PROMPT_REGENERATE_FAILED,
          error: error && error.message ? error.message : '',
        })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async loadVideoPath(filePath) {
      this.loading = true
      this.videoPath = filePath || null
      if (!this.videoPath) {
        this.videoSrc = null
        this.videoReloadAttempted = false
        this.loading = false
        return false
      }
      try {
        this.videoSrc = await this.resolveLocalUrl(this.videoPath, this.videoSrc)
        this.videoReloadAttempted = false
        return true
      } catch (_error) {
        this.videoSrc = null
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PREVIEW_MISSING })
        return false
      } finally {
        this.loading = false
      }
    },
    async loadProject(projectId) {
      this.loading = true
      try {
        const result = await story2videoGetProject(projectId)
        if (result?.code === -3) {
          // 防御：未来若访问控制收紧，未登录打开项目应引导登录而非泛化失败
          this.project = null
          this.projectId = null
          this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.ACCESS_DENIED })
          return
        }
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || '项目加载失败')
        const project = result.data
        this.project = project
        this.projectId = project.projectId
        this.segments = Array.isArray(project.segments) ? project.segments.map(segment => ({ ...segment })) : []
        this.unavailableMaterialKinds = {}
        this.segmentsDirty = false
        this.activeSegmentIndex = -1
        this.segmentItemRefs = []
        // 渲染窗口复位到首批（换项目/重进页面时不得残留上一个项目的窗口）
        this.segmentRenderCount = 0
        this.loadVoiceCatalog()
        // 首屏只解析第一批分段素材 URL（2026-10-20，PRD-S2V-RESULT-VIEW-PERF §4.2）：
        // 169 段 × 5 个媒体位 ≈ 845 次 IPC 全量串在 await 上，是「页面进入非常慢」
        // 与「loading 迟迟不结束」的直接原因。分段编辑区本身分批渲染，
        // 未进入渲染窗口的分段不需要提前拿 URL。
        await this.refreshSegmentImageUrls(this.pendingSegmentBatch)
        // 分段渲染完成后初始化滚动高亮（2026-09-18）
        this.$nextTick(() => this.recalcSegmentHighlight())
        this.audioPath = project.audioPath || null
        // 完整旁白：仅在有 audioPath 时申请一个 URL；无旁白时保留占位（与旧行为一致）
        if (this.previewLayout.shouldLoadNarration) {
          try {
            this.audioSrc = await this.resolveLocalUrl(this.audioPath, this.audioSrc)
          } catch (_error) {
            this.audioSrc = null
          }
        } else {
          this.audioSrc = null
        }
        // 成品视频预览：**无 videoPath 时完全不申请媒体 URL**（2026-10-20 修复核心）。
        // 失败任务没有成片，旧实现仍会走 resolveLocalUrl，而整个 loading 又要等
        // 全部分段素材解析完 ⇒ 用户看到「预览区一直加载」最后空白。
        this.videoPath = project.videoPath || null
        if (this.previewLayout.shouldLoadPreview) {
          try {
            this.videoSrc = await this.resolveLocalUrl(this.videoPath, this.videoSrc)
            this.videoReloadAttempted = false
          } catch (_error) {
            this.videoSrc = null
            this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PREVIEW_MISSING })
          }
        } else {
          this.videoSrc = null
          this.videoReloadAttempted = false
        }
        this.maybeShowDegradedAssetsWarning()
      } catch (_error) {
        this.project = null
        this.projectId = null
        // QM-6 审查项 C9：加载失败与「本来就没有视频」必须可区分。
        // 旧实现两者共用空态「没有可预览的视频」，用户关掉弹窗后会以为任务本来就没视频。
        this.loadFailed = true
        this.showStory2VideoOperationFailure()
      } finally {
        this.loading = false
      }
    },
    async handleError() {
      // First error self-heals: re-issue a fresh local preview URL for the same final video and reload once, so expired/evicted media tokens do not cause a false failure; only a second failure surfaces the message.
      if (!this.videoPath || this.videoReloadAttempted) {
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.VIDEO_PREVIEW_FAILED })
        return
      }
      try {
        this.videoSrc = await this.resolveLocalUrl(this.videoPath, this.videoSrc)
        // Wait for Vue to apply the new src to the <video> element before load(),
        // otherwise load() targets the stale (expired) URL.
        await this.$nextTick()
        const player = this.$refs && this.$refs.videoPlayer
        if (player && typeof player.load === 'function') player.load()
        this.videoReloadAttempted = true
      } catch (_error) {
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.VIDEO_PREVIEW_FAILED })
      }
    },
    handleVideoMetadata(event) {
      const duration = Number(event?.target?.duration)
      if (!Number.isFinite(duration) || duration <= 0) return
      this.videoDuration = duration
      if (!Number.isFinite(Number(this.trimEnd)) || Number(this.trimEnd) <= Number(this.trimStart) || Number(this.trimEnd) > duration) {
        this.trimEnd = duration
      }
      this.normalizeTrimRange('start')
    },
    normalizeTrimRange(preferredBoundary = 'start') {
      const maximum = Number(this.trimMax)
      if (!Number.isFinite(maximum) || maximum <= 0) return
      const gap = Math.min(0.1, maximum)
      let start = Number(this.trimStart)
      let end = Number(this.trimEnd)
      if (!Number.isFinite(start)) start = 0
      if (!Number.isFinite(end)) end = maximum
      start = Math.min(Math.max(start, 0), Math.max(0, maximum - gap))
      end = Math.min(Math.max(end, gap), maximum)
      if (end - start < gap) {
        if (preferredBoundary === 'end') start = Math.max(0, end - gap)
        else end = Math.min(maximum, start + gap)
      }
      if (end - start < gap) start = Math.max(0, end - gap)
      this.trimStart = start
      this.trimEnd = end
    },
    setTrimBoundary(boundary, value) {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || !['start', 'end'].includes(boundary)) return
      if (boundary === 'start') this.trimStart = numeric
      else this.trimEnd = numeric
      this.normalizeTrimRange(boundary)
      this.seekTrimPreview(boundary === 'start' ? this.trimStart : this.trimEnd)
    },
    seekTrimPreview(value) {
      const player = this.$refs.videoPlayer
      const time = Number(value)
      if (!player || !Number.isFinite(time)) return
      player.currentTime = Math.min(Math.max(time, 0), Number(this.trimMax))
    },
    async previewTrimRange() {
      if (!this.canTrim) return
      const player = this.$refs.videoPlayer
      if (!player || typeof player.play !== 'function') return
      this.seekTrimPreview(this.trimStart)
      this.trimPreviewing = true
      try {
        const playback = player.play()
        if (playback && typeof playback.then === 'function') await playback
      } catch (_error) {
        this.trimPreviewing = false
        this.showStory2VideoOperationFailure()
      }
    },
    handleTrimPreviewProgress(event) {
      if (!this.trimPreviewing) return
      const player = event?.target || this.$refs.videoPlayer
      if (!player || Number(player.currentTime) < Number(this.trimEnd)) return
      if (typeof player.pause === 'function') player.pause()
      player.currentTime = Number(this.trimStart)
      this.trimPreviewing = false
    },
    formatTrimTime(value) {
      const seconds = Math.max(0, Number(value) || 0)
      const minutes = Math.floor(seconds / 60)
      const remainder = (seconds % 60).toFixed(1).padStart(4, '0')
      return String(minutes).padStart(2, '0') + ':' + remainder
    },
    // 下载统一走主进程保存对话框：renderer 的 <a download> 对跨源/本地 HTTP
    // 媒体 URL 无效（会静默失败），必须用 dialog.showSaveDialog + 文件复制。
    async saveFileAs(filePath, suggestedName) {
      try {
        const result = await story2videoSaveAs(filePath, suggestedName)
        if (result?.code !== 0) throw new Error(result?.message || '保存失败')
        if (result.data?.cancelled) return
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SAVE_COMPLETED })
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      }
    },
    async download() {
      if (!this.videoPath) return
      await this.saveFileAs(this.videoPath, 'video_' + Date.now() + '.' + this.formatLabel.toLowerCase())
    },
    async downloadArtifact(filePath, name) {
      if (!filePath) return
      await this.saveFileAs(filePath, name)
    },
    async downloadNarration() {
      if (!this.audioPath) return
      await this.downloadArtifact(this.audioPath, this.fileName(this.audioPath, 'narration.m4a'))
    },
    fileName(filePath, fallback) {
      return String(filePath || '').split(/[\\/]/).pop() || fallback
    },
    extension(filePath, fallback) {
      const name = this.fileName(filePath, '')
      const match = name.match(/(\.[a-z0-9]{2,5})$/i)
      return match ? match[1].toLowerCase() : fallback
    },
    segmentName(index, kind, filePath) {
      const fallback = kind === 'image' ? '.png' : kind === 'audio' ? '.mp3' : '.mp4'
      return 'segment-' + String(index + 1).padStart(3, '0') + '-' + kind + this.extension(filePath, fallback)
    },
    exportFiles() {
      const files = []
      if (this.videoPath) files.push({ path: this.videoPath, name: this.fileName(this.videoPath, 'video.mp4') })
      if (this.audioPath) files.push({ path: this.audioPath, name: this.fileName(this.audioPath, 'narration.m4a') })
      this.segments.forEach((segment, index) => {
        if (segment.imagePath) files.push({ path: segment.imagePath, name: this.segmentName(index, 'image', segment.imagePath) })
        if (segment.audioPath) files.push({ path: segment.audioPath, name: this.segmentName(index, 'audio', segment.audioPath) })
        if (segment.videoPath) files.push({ path: segment.videoPath, name: this.segmentName(index, 'video', segment.videoPath) })
      })
      return files
    },
    async exportZip() {
      const files = this.exportFiles()
      if (!files.length) return
      try {
        const result = await story2videoExportZip(files)
        if (result?.code !== 0) throw new Error('ZIP 导出失败')
        this.showStory2VideoNotification({
          messageKey: result.data?.cancelled
            ? STORY2VIDEO_NOTIFICATION_KEYS.EXPORT_CANCELLED
            : STORY2VIDEO_NOTIFICATION_KEYS.EXPORT_COMPLETED,
        })
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      }
    },
    async copyLocalPath() {
      if (!this.videoPath) return
      try {
        const result = await story2videoCopyPath(this.videoPath)
        if (result?.code !== 0) throw new Error('复制路径失败')
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PATH_COPIED })
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      }
    },
    async showInFolder() {
      if (!this.videoPath) return
      try {
        const result = await story2videoShowInFolder(this.videoPath)
        if (result?.code !== 0) throw new Error('打开文件夹失败')
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      }
    },
    async trimVideo() {
      if (!this.canTrim || this.trimming) return
      this.trimPreviewing = false
      if (this.$refs.videoPlayer && typeof this.$refs.videoPlayer.pause === 'function') this.$refs.videoPlayer.pause()
      this.trimming = true
      try {
        const result = await videoProcess('trim', {
          input_path: this.videoPath,
          start_seconds: Number(this.trimStart),
          end_seconds: Number(this.trimEnd),
          codec: 'libx264',
        })
        const output = result?.data?.output || result?.data?.data?.output
        if (result?.code !== 0 || !result.data?.success || !output) {
          throw new Error(result?.message || result?.data?.error || '视频裁剪失败')
        }
        this.trimmedPath = output
        this.trimmedSrc = await this.resolveLocalUrl(output, this.trimmedSrc)
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TRIM_COMPLETED })
      } catch (_error) {
        this.trimmedPath = null
        this.trimmedSrc = null
        this.showStory2VideoOperationFailure()
      } finally {
        this.trimming = false
      }
    },
    async downloadTrimmed() {
      if (!this.trimmedPath) return
      await this.saveFileAs(this.trimmedPath, this.fileName(this.trimmedPath, 'video-clip.mp4'))
    },
    async showTrimmedInFolder() {
      if (!this.trimmedPath) return
      try {
        const result = await story2videoShowInFolder(this.trimmedPath)
        if (result?.code !== 0) throw new Error('打开裁剪片段所在文件夹失败')
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      }
    },
    moveSegment(index, offset) {
      const target = index + offset
      if (target < 0 || target >= this.segments.length) return
      const next = this.segments.slice()
      const [segment] = next.splice(index, 1)
      next.splice(target, 0, segment)
      this.segments = next
      this.segmentsDirty = true
      // 分段重排后 refs 下标失效，重置并重算滚动高亮（2026-09-18）
      this.segmentItemRefs = []
      this.$nextTick(() => this.recalcSegmentHighlight())
    },
    removeSegment(index) {
      if (this.segments.length <= 1) return
      this.segments.splice(index, 1)
      this.segmentsDirty = true
      // 分段删除后 refs 下标失效，重置并重算滚动高亮（2026-09-18）
      this.segmentItemRefs = []
      this.$nextTick(() => this.recalcSegmentHighlight())
    },
    async saveSegments() {
      if (!this.projectId || !this.segments.length) return false
      this.saving = true
      try {
        const updates = this.segments.map(segment => ({
          id: segment.id,
          text: segment.text || '',
          prompt: segment.prompt || '',
          videoPrompt: segment.videoPrompt || '',
          subtitleBlocks: Array.isArray(segment.subtitleBlocks) ? segment.subtitleBlocks : [],
          voiceId: segment.voiceId || '',
          voiceSpeed: segment.voiceSpeed === undefined || segment.voiceSpeed === null || segment.voiceSpeed === '' ? undefined : Number(segment.voiceSpeed),
          voicePitch: segment.voicePitch === undefined || segment.voicePitch === null || segment.voicePitch === '' ? undefined : Number(segment.voicePitch),
          voiceEmotion: segment.voiceEmotion || '',
        }))
        const result = await story2videoUpdateSegments(this.projectId, updates)
        if (result?.code !== 0) throw new Error(result?.message || '分段保存失败')
        if (Array.isArray(result.data?.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(segment => ({ ...segment }))
        }
        this.project = result.data || this.project
        // 主进程返回的分段不含渲染端派生 URL（imageUrl/alternateImageUrls/videoUrl），必须重新解析，否则保存后图片/素材/视频槽消失（2026-08-16 回归）
        await this.refreshSegmentImageUrls()
        this.segmentsDirty = false
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SEGMENTS_SAVED })
        return true
      } catch (_error) {
        this.showStory2VideoOperationFailure()
        return false
      } finally {
        this.saving = false
      }
    },
    // 离开守卫三动作（2026-08-16）：保存并离开 / 不保存离开 / 取消
    async saveAndLeave() {
      const next = this.pendingLeaveNext
      if (typeof next !== 'function') return
      if (!(await this.saveSegments())) return
      this.pendingLeaveNext = null
      this.unsavedLeaveDialog.visible = false
      next()
    },
    discardAndLeave() {
      if (this.saving) return // 保存在途时禁止穿插触发（双 next 竞态，2026-08-16 审查 W1）
      const next = this.pendingLeaveNext
      if (typeof next !== 'function') return
      this.pendingLeaveNext = null
      this.unsavedLeaveDialog.visible = false
      next()
    },
    cancelUnsavedLeave() {
      if (this.saving) return // 保存在途时禁止取消（否则保存完成后的 next 悬挂/竞态，2026-08-16 审查 W1）
      const next = this.pendingLeaveNext
      this.pendingLeaveNext = null
      this.unsavedLeaveDialog.visible = false
      if (typeof next === 'function') next(false)
    },
    isSegmentBusy(segmentId) {
      return Boolean(this.segmentBusy[segmentId])
    },
    segmentBusyKind(segmentId) {
      // 返回 busy 类型标识（'' = 空闲），模板用 === 'image'/'video'/'genImage'/'genVideo' 区分文案
      return this.segmentBusy[segmentId] || ''
    },
    hasUsableVideoPrompt(segment) {
      return Boolean(segment && [segment.videoPrompt, segment.prompt, segment.text].some(source => typeof source === 'string' && source.trim()))
    },
    async replaceSegmentAudio(segmentId, event) {
      const input = event?.target
      const file = input?.files?.[0]
      if (!file || !this.projectId || this.isSegmentBusy(segmentId)) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'audio' }
      try {
        const imported = await story2videoImportMedia(file, 'audio')
        const filePath = imported?.code === 0 ? imported.data?.path : null
        if (!filePath) throw new Error(imported?.message || '旁白导入失败')
        const result = await story2videoReplaceSegmentAudio(this.projectId, segmentId, filePath)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || '旁白替换失败')
        this.project = result.data
        this.segments = Array.isArray(result.data.segments)
          ? result.data.segments.map(segment => ({ ...segment }))
          : this.segments
        // 旁白替换同样以 IPC 返回整体替换分段，需重建媒体 URL，避免图片/素材槽消失（同类回归）
        await this.refreshSegmentImageUrls()
        this.segmentsDirty = true
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SEGMENT_AUDIO_REPLACED })
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      } finally {
        if (input) input.value = ''
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async retrySegment(segmentId, mode) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: mode }
      try {
        const result = await story2videoRetrySegment(this.projectId, segmentId, mode)
        if (result?.code !== 0) throw new Error(result?.message || '分段重试失败')
        if (Array.isArray(result.data?.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(segment => ({ ...segment }))
        }
        this.project = result.data || this.project
        this.segmentsDirty = true
        // 重试图片/视频会生成新文件，必须重新解析本地媒体 URL，否则分段图片仍显示旧图或空白。
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({
          messageKey: mode === 'image'
            ? STORY2VIDEO_NOTIFICATION_KEYS.SEGMENT_IMAGE_RETRIED
            : STORY2VIDEO_NOTIFICATION_KEYS.SEGMENT_VIDEO_RETRIED,
        })
      } catch (error) {
        // 重试失败也刷新一次：服务端可能部分更新了分段（新图片已落盘但结果未完全返回）
        await this.refreshSegmentImageUrls().catch(() => {})
        // 透传真实错误走通知归一化（余额/限流/API Key 等已映射类别显示具体原因），未映射回退 operation_failed
        this.showStory2VideoNotification({ error: error && error.message ? error.message : '' })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async recomposeProject() {
      if (!this.projectId || this.recomposing) return
      if (this.segmentsDirty && !(await this.saveSegments())) return
      this.recomposing = true
      try {
        const result = await story2videoRecomposeProject(this.projectId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || '重新合成失败')
        this.project = result.data
        if (Array.isArray(result.data.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(segment => ({ ...segment }))
        }
        // 重新合成返回的分段对象不含素材 URL，必须重新解析本地媒体 URL，否则素材区/分段图空白。
        await this.refreshSegmentImageUrls()
        if (Object.prototype.hasOwnProperty.call(result.data, 'audioPath')) {
          this.audioPath = result.data.audioPath || null
        }
        try {
          this.audioSrc = this.audioPath ? await this.resolveLocalUrl(this.audioPath, this.audioSrc) : null
        } catch (_error) {
          this.audioSrc = null
        }
        if (!result.data.videoPath) {
          this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PREVIEW_MISSING })
          return
        }
        const videoLoaded = await this.loadVideoPath(result.data.videoPath)
        if (!videoLoaded) return
        this.projectId = result.data.projectId || this.projectId
        this.segmentsDirty = false
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PROJECT_RECOMPOSED })
      } catch (error) {
        // 透传真实错误走通知归一化（余额/限流/API Key/素材缺失等已映射类别显示具体原因），未映射回退 operation_failed
        const rawError = error && error.message ? error.message : String(error || '')
        this.showStory2VideoNotification({ error: rawError })
      } finally {
        this.recomposing = false
      }
    },
  },
}
</script>

<style scoped>
/* 视频任务编辑页：整页 flex 纵向布局；编辑内容为固定操作条预留底部安全空间。 */
.result-page { padding: 24px 24px calc(var(--result-action-bar-space, 88px) + 24px); max-width: 1040px; margin: 0 auto; min-height: 100%; display: flex; flex-direction: column; }

/* 分段快捷定位固定竖条：右侧 sticky，不随页面滚动（2026-08-18 UX 修正） */
.segment-jump-sidebar { position: fixed; right: 20px; top: 80px; width: 200px; z-index: 100; max-height: calc(100vh - 120px); overflow-y: auto; }
.segment-jump-sidebar .segment-jump-bar { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.segment-jump-sidebar .segment-jump-numbers { display: flex; flex-wrap: wrap; gap: 6px; }
.segment-jump-sidebar .segment-jump-nav { display: flex; gap: 8px; justify-content: center; }

.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.page-header h1 { font-size: var(--font-size-xl); font-weight: 700; margin: 0; }
.page-subtitle { margin: 4px 0 0; color: var(--text); font-size: var(--font-size-base); font-weight: 600; }
.page-meta { margin: 2px 0 0; color: var(--text-muted); font-size: var(--font-size-xs); }
.result-header-status { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; min-width: 0; }
.status-badge { padding: 5px 8px; border-radius: 4px; background: var(--warning-bg); color: var(--warning); font-size: var(--font-size-xs); }
.bgm-skipped-notice { display: flex; align-items: center; gap: 8px; padding: 10px 14px; margin-bottom: 16px; color: var(--banner-info-color); background: var(--banner-info-bg); border: 1px solid var(--banner-info-border); border-radius: 8px; font-size: var(--font-size-sm); line-height: 1.5; }
.loading-state, .empty-state { text-align: center; padding: 60px 0; color: var(--text-muted); }
.video-player { width: 100%; max-height: 68vh; border-radius: 8px; background: var(--ink); }
/* 无成片占位区块（2026-10-20）：与 .video-player 同一容器与圆角，高度用同一上限档位，
   保证「加载出成片」与「本来就没有成片」两种终态的页面高度一致，不产生布局跳变。 */
.video-section--placeholder { display: flex; }
/* 回到顶部：固定右下，避免遮挡底部操作条（result-action-bar 在底部，留出安全距离）。 */
.back-to-top { position: fixed; right: 24px; bottom: 96px; width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: var(--font-size-md); line-height: 1; cursor: pointer; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12); z-index: 20; }
.back-to-top:hover { border-color: var(--primary); color: var(--primary); }
/* 分段渲染窗口哨兵：进入视口前 240px 即触发，视觉上保持轻量（不占内容流高度）。 */
.segment-list-sentinel { display: flex; justify-content: center; padding: 12px 0 4px; }
.video-info { margin: 12px 0; font-size: var(--font-size-sm); color: var(--text-muted); }
.completion-summary { color: var(--banner-success-text); font-weight: 600; margin-bottom: 4px; }
.video-info p { margin: 4px 0; }
.path-text { overflow-wrap: anywhere; }
.actions, .section-actions, .segment-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.actions { margin-top: 16px; }
.project-section { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--border); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.section-heading h2 { margin: 0; font-size: var(--font-size-md); }
.section-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: var(--font-size-sm); }
.segments-unsaved-chip { display: inline-block; margin-left: 10px; padding: 2px 8px; border-radius: 10px; background: #fdf6ec; color: #e6a23c; font-size: var(--font-size-xs); font-weight: 500; }
/* 查看文案弹窗：原文案含原始换行与超长行。pre 默认 white-space: pre 不折行，
   长行会横向溢出弹窗（内容被裁切）。pre-wrap 保留原始换行并自动折行；
   overflow-wrap/word-break 兜底 URL 等无空格长串。滚动交给 .ui-modal-body，不叠第二层滚动条。 */
.script-modal-body { min-width: 0; }
.script-text { margin: 0; color: var(--text); font-family: inherit; font-size: var(--font-size-sm); line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
/* 视频任务编辑页底部操作条：固定在主工作区底部，不跟随页面内容滚动。 */
.result-action-bar { position: fixed; left: var(--mp-sidebar-width, 200px); right: 0; bottom: 0; z-index: 110; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; min-height: var(--result-action-bar-space, 88px); margin: 0; padding: 12px max(20px, calc((100vw - var(--mp-sidebar-width, 200px) - 1040px) / 2 + 24px)); border-top: 1px solid var(--hairline, rgba(0,0,0,0.06)); background: var(--surface, #fff); box-shadow: 0 -2px 12px rgba(0,0,0,0.08); }
.result-action-bar-status { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.result-action-bar-status .segments-unsaved-chip { margin-left: 0; }
.result-action-bar-status .action-bar-progress { color: var(--text-muted); font-size: var(--font-size-xs); }
.result-action-bar-buttons { display: flex; flex-wrap: wrap; gap: 10px; }
.audio-player { width: 100%; height: 42px; }
.trim-range-panel { display: grid; gap: 8px; margin-bottom: 14px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.trim-range-values { display: flex; justify-content: space-between; color: var(--text-muted); font-variant-numeric: tabular-nums; font-size: var(--font-size-xs); }
.trim-range-control { display: grid; grid-template-columns: 44px 1fr; align-items: center; gap: 10px; color: var(--text-muted); font-size: var(--font-size-xs); font-weight: 600; }
.trim-range-control input { width: 100%; min-width: 0; accent-color: var(--primary); }
.trim-controls { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto auto; gap: 12px; align-items: end; }
.trim-controls label { display: grid; gap: 6px; color: var(--text-muted); font-size: var(--font-size-xs); font-weight: 600; }
.trim-controls input { min-width: 0; border: 1px solid var(--border); border-radius: 6px; padding: 9px 10px; background: var(--bg); color: var(--text); }
.trim-progress { width: 100%; height: 4px; margin-top: 10px; accent-color: var(--primary); }
.trim-duration { margin: 8px 0 0; color: var(--text-muted); font-size: var(--font-size-xs); }
.trim-result { display: grid; gap: 10px; margin-top: 14px; }
.asset-placeholder { color: var(--text-muted); font-size: var(--font-size-xs); }
.narration-placeholder { display: flex; align-items: center; min-height: 44px; padding: 0 12px; border-radius: 6px; background: var(--bg); }

@media (max-width: 900px) {
  .segment-jump-sidebar { display: none; }

}
@media (max-width: 720px) {
  .result-page { padding: 16px 16px calc(var(--result-action-bar-space-mobile, 196px) + 16px); }
  .section-heading { align-items: flex-start; flex-direction: column; }
  .trim-controls { grid-template-columns: 1fr; }
  .actions > *, .section-actions > * { flex: 1 1 auto; }
  .result-header-status { width: 100%; justify-content: flex-start; }
  .result-action-bar { left: 68px; min-height: var(--result-action-bar-space-mobile, 196px); padding: 10px 14px; align-items: flex-start; }
  .result-action-bar-status, .result-action-bar-buttons { width: 100%; }
  .result-action-bar-buttons > * { flex: 1 1 100%; }
}
@media (min-width: 721px) and (max-width: 900px) {
  .result-action-bar { left: 68px; padding-inline: max(20px, calc((100vw - 68px - 1040px) / 2 + 24px)); }
}
</style>

