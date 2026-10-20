// @ts-check
/**
 * useCollectionVideoCreation — 采集页「去发布 → 视频创作」的就地编排
 * （fix-collection-rewrite-publish-flow，2026-10-20）。
 *
 * ## 为什么不再跳视频创作页
 * 用户反馈：点「视频创作」后跳到视频创作页，用户还得再点一次「启动」，
 * 而**文案带入的还是上一次改写的结果**。期望的交互是：
 * 点「视频创作」→ 发布浮层消失 → **就地弹出视频创作流水线的执行进度浮层**。
 *
 * 本 composable 就是那个「就地执行 + 进度浮层」的状态机：
 * 采集页把**当前这次改写的结果**交给它，它启动流水线并跟踪到终态。
 *
 * ## 复用而非重写
 * 热门选题「一键成片」（`useHotTopicsGenVideo.js`）已有同型编排，但它自带
 * 「改写 → 存草稿」前置（热门选题是「选题 → 改写 → 视频」，采集页是
 * 「已改写 → 视频」）。因此这里**只复用它的纯函数契约与跟踪层**，不复制一份实现：
 *  - 阶段跟踪纯函数：`features/hot-topics/gen-video-stage-tracking.js`
 *  - 展示派生纯函数：`features/hot-topics/gen-video-view-model.js`
 *  - 启动参数构造：`features/hot-topics/gen-video-pipelines.js` 的 `buildGenVideoStartParams`
 *  - run 跟踪层（推送 + 3s 轮询兜底）：`composables/useGenVideoRunTracking.js`
 *  - 成片路径提取：`features/pipeline/run-context-video-path.js`
 *  - 发布出口 query：`composables/useGenVideoPublishTitle.js`
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  pipelineStartOrchestrated,
  pipelineCancelRun,
  pipelineGetRunContext,
  onPipelineUpdate,
  storeGetSetting,
} from '@/api/publisher'
import {
  buildGenVideoStartParams,
  DEFAULT_GEN_VIDEO_PIPELINE,
} from '@/features/hot-topics/gen-video-pipelines'
import {
  stageNamesForPipeline,
  markFirstGenVideoStageRunning,
  markFirstGenVideoStageFailed,
  resetGenVideoStagesToPending,
  completeUnfinishedGenVideoStages,
  finalizeGenVideoTerminalStages,
  cancelGenVideoStages,
} from '@/features/hot-topics/gen-video-stage-tracking'
import {
  buildGenVideoPipelineLabel,
  computeGenVideoProgressPercent,
  isGenVideoTerminalPhase,
  canRetryGenVideo,
  canCancelGenVideo,
  canBackgroundGenVideo,
  isGenVideoResultReady,
} from '@/features/hot-topics/gen-video-view-model'
import { useGenVideoRunTracking } from '@/composables/useGenVideoRunTracking'
import { extractRunContextVideoPath } from '@/features/pipeline/run-context-video-path'
import { buildGenVideoPublishQuery } from '@/composables/useGenVideoPublishTitle'
import { getAppLocale } from '@/i18n'
import { DEFAULT_STORY2VIDEO_TEXT_LIMIT } from '@/story2video/story-text-limit'

/**
 * 把文案裁到「故事讲述」流水线的生效上限（码点，不切 UTF-16）。
 *
 * 上限取**内置默认**（10000 码点）：运营中心可下发 `storyTextLimit` 覆盖，
 * 但采集页不订阅运营中心运行时块，这里用默认上限保证「至少不会把超长文案
 * 直接灌进流水线」。裁切发生时必须**如实告知用户**（否则用户会以为
 * 视频用的是完整文案）。
 *
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {{text: string, truncated: boolean, originalLength: number}}
 */
export function clampStory2VideoText (text, maxChars = DEFAULT_STORY2VIDEO_TEXT_LIMIT.maxChars) {
  const source = typeof text === 'string' ? text : ''
  const characters = Array.from(source)
  const limit = Number(maxChars) > 0 ? Number(maxChars) : DEFAULT_STORY2VIDEO_TEXT_LIMIT.maxChars
  if (characters.length <= limit) {
    return { text: source, truncated: false, originalLength: characters.length }
  }
  return {
    text: characters.slice(0, limit).join(''),
    truncated: true,
    originalLength: characters.length,
  }
}

/**
 * @param {object} [opts]
 * @param {() => boolean} [opts.isDisposed] 视图卸载标记（in-flight 响应不再写回状态）
 * @param {object} [opts.deps] 测试注入（API 覆盖；未覆盖的项走真实 API）
 */
export function useCollectionVideoCreation (opts = {}) {
  const router = useRouter()
  const { t } = useI18n()
  const isDisposed = typeof opts.isDisposed === 'function' ? opts.isDisposed : () => false

  const deps = {
    pipelineStartOrchestrated,
    pipelineCancelRun,
    pipelineGetRunContext,
    onPipelineUpdate,
    storeGetSetting,
    ...(opts.deps || {}),
  }

  // ── 状态 ──
  const videoModalOpen = ref(false)
  const videoBusy = ref(false)
  const videoPhase = ref('idle') // idle | starting | running | completed | failed | cancelled
  const videoStages = ref([])
  const videoRunId = ref(null)
  const videoRunProgress = ref(null)
  const videoErrorText = ref('')
  const videoStartedAt = ref(0)
  const videoPipelineName = ref('')
  const videoCompletedVideoPath = ref('')
  const videoCompletedProjectId = ref('')
  const videoCompletedProject = ref(null)
  /** 文案裁切披露：文案被裁到流水线上限时如实告知（否则用户以为用的是完整文案） */
  const videoTextTruncated = ref(false)
  const videoTextTruncatedLength = ref(0)
  const videoTextLimit = ref(DEFAULT_STORY2VIDEO_TEXT_LIMIT.maxChars)
  const videoTick = ref(0)
  let videoSeq = 0
  /** 本次编排使用的文案（发布出口的标题/正文来源） */
  let videoSourceText = ''
  let videoSourceTitle = ''

  // ── 计算属性 ──
  const videoPipelineLabel = computed(() => buildGenVideoPipelineLabel(t, videoPipelineName.value))
  const videoProgressPercent = computed(() => computeGenVideoProgressPercent({
    phase: videoPhase.value,
    stages: videoStages.value,
    runProgress: videoRunProgress.value,
  }))
  const videoElapsedMs = computed(() => {
    void videoTick.value
    return videoStartedAt.value > 0 ? Math.max(0, Date.now() - videoStartedAt.value) : null
  })
  const videoTerminal = computed(() => isGenVideoTerminalPhase(videoPhase.value))
  const videoCanRetry = computed(() => canRetryGenVideo(videoPhase.value))
  const videoCanCancel = computed(() => canCancelGenVideo(videoPhase.value))
  const videoCanBackground = computed(() => canBackgroundGenVideo(videoPhase.value, videoRunId.value))
  const videoResultReady = computed(() => isGenVideoResultReady(videoPhase.value, videoCompletedVideoPath.value))

  // ── 跟踪层 ──
  const tracking = useGenVideoRunTracking({
    runId: videoRunId,
    tick: videoTick,
    progress: videoRunProgress,
    stages: videoStages,
    onCompleted: (data) => finishCompleted(data),
    onTerminal: (status, data) => finishTerminal(status, data),
    deps: {
      isDisposed,
      onPipelineUpdate: deps.onPipelineUpdate,
      pipelineGetRunContext: deps.pipelineGetRunContext,
    },
  })

  /** 组装启动参数并启动流水线（启动 / 重试共用这一条路径，避免两份实现漂移） */
  async function startPipelineRun (seq, text) {
    let snapshot = null
    try {
      snapshot = await deps.storeGetSetting('story2video.lastOptions.v1')
    } catch (_e) { snapshot = null }
    if (isDisposed() || seq !== videoSeq) return false

    const clamped = clampStory2VideoText(text, videoTextLimit.value)
    if (clamped.truncated) {
      videoTextTruncated.value = true
      videoTextTruncatedLength.value = clamped.originalLength
    }
    const params = buildGenVideoStartParams({
      pipelineName: videoPipelineName.value || DEFAULT_GEN_VIDEO_PIPELINE,
      text: clamped.text,
      snapshot,
      uiLocale: getAppLocale(),
    })
    if (!params) throw new Error('invalid pipeline or empty text')

    markFirstGenVideoStageRunning(videoStages.value)
    const res = await deps.pipelineStartOrchestrated(
      videoPipelineName.value || DEFAULT_GEN_VIDEO_PIPELINE,
      params,
    )
    if (isDisposed() || seq !== videoSeq) return false
    const outcome = res && res.data
    if (res && res.code === 0 && outcome && typeof outcome.runId === 'string'
      && outcome.runId.trim() && outcome.success !== false) {
      videoRunId.value = outcome.runId.trim()
      videoPhase.value = 'running'
      if (Array.isArray(outcome.stages) && outcome.stages.length > 0) {
        tracking.mergeGenStages(outcome.stages)
      }
      tracking.startGenVideoTracking()
      return true
    }
    throw new Error((res && res.message) || (outcome && outcome.error) || 'pipeline start failed')
  }

  /**
   * 启动视频创作流水线（就地执行，不跳页）。
   *
   * @param {object} input
   * @param {string} input.text 当前改写结果（**必须是最新那次**，不是旧草稿）
   * @param {string} [input.pipelineName] 流水线名（默认 story2video-compose）
   * @param {string} [input.title] 标题（发布出口兜底用）
   * @returns {Promise<boolean>} 是否真正进入编排
   */
  async function startVideoCreation ({ text, pipelineName = DEFAULT_GEN_VIDEO_PIPELINE, title = '' } = {}) {
    if (videoBusy.value) return false
    const source = typeof text === 'string' ? text.trim() : ''
    if (!source) return false

    videoSeq += 1
    const seq = videoSeq
    videoPipelineName.value = typeof pipelineName === 'string' && pipelineName.trim()
      ? pipelineName.trim()
      : DEFAULT_GEN_VIDEO_PIPELINE
    videoSourceText = source
    videoSourceTitle = typeof title === 'string' ? title : ''
    videoRunId.value = null
    videoRunProgress.value = null
    videoErrorText.value = ''
    videoCompletedVideoPath.value = ''
    videoCompletedProjectId.value = ''
    videoCompletedProject.value = null
    videoStartedAt.value = Date.now()
    videoTextTruncated.value = false
    videoTextTruncatedLength.value = 0
    // 阶段列表：只有流水线自身的阶段（采集页的改写**已经**完成，不再有 rewrite_copy 阶段）
    videoStages.value = stageNamesForPipeline(videoPipelineName.value).map((name) => ({
      id: name,
      name,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      progress: null,
    }))
    videoModalOpen.value = true
    videoBusy.value = true
    videoPhase.value = 'starting'

    try {
      return await startPipelineRun(seq, source)
    } catch (e) {
      if (isDisposed() || seq !== videoSeq) return false
      markFirstGenVideoStageFailed(videoStages.value, e)
      videoPhase.value = 'failed'
      videoErrorText.value = t('collection.videoCreate.pipelineFailed')
      videoBusy.value = false
      return false
    }
  }

  /** 完成：提取成片路径，落终态产物 */
  function finishCompleted (data) {
    const context = data && typeof data.context === 'object' ? data.context : null
    const videoPath = extractRunContextVideoPath(context)
    tracking.stopGenVideoTracking()
    completeUnfinishedGenVideoStages(videoStages.value)
    videoPhase.value = 'completed'
    videoBusy.value = false
    videoCompletedVideoPath.value = videoPath || ''
    videoCompletedProjectId.value = (context && context.story2videoProject && context.story2videoProject.projectId) || ''
    videoCompletedProject.value = (context && context.story2videoProject && typeof context.story2videoProject === 'object')
      ? context.story2videoProject
      : null
    if (!videoPath) {
      // 成片缺失：保持失败态，两个出口按钮保持灰显（不伪造可点击）
      videoPhase.value = 'failed'
      videoErrorText.value = t('collection.videoCreate.pipelineFailed')
    }
  }

  /** 终态：failed / cancelled */
  function finishTerminal (status, data) {
    tracking.stopGenVideoTracking()
    finalizeGenVideoTerminalStages(videoStages.value, status, data && data.error)
    videoPhase.value = status === 'cancelled' ? 'cancelled' : 'failed'
    videoErrorText.value = status === 'cancelled'
      ? t('collection.videoCreate.cancelled')
      : t('collection.videoCreate.pipelineFailed')
    videoBusy.value = false
  }

  /** 取消：流水线已启动 ⇒ 调 pipelineCancelRun；未启动 ⇒ 只收前端态 */
  async function cancelVideoCreation () {
    if (!videoCanCancel.value) return
    videoSeq += 1
    tracking.stopGenVideoTracking()
    if (videoPhase.value === 'running' && videoRunId.value) {
      try {
        await deps.pipelineCancelRun(videoRunId.value)
      } catch (_e) { /* 取消失败也按前端取消处理 */ }
    }
    cancelGenVideoStages(videoStages.value)
    videoPhase.value = 'cancelled'
    videoErrorText.value = t('collection.videoCreate.cancelled')
    videoBusy.value = false
  }

  /** 重试：从流水线启动开始（文案仍在手上，无需重新改写） */
  async function retryVideoCreation () {
    if (videoPhase.value !== 'failed') return
    videoSeq += 1
    const seq = videoSeq
    videoBusy.value = true
    videoErrorText.value = ''
    videoRunId.value = null
    videoRunProgress.value = null
    videoCompletedVideoPath.value = ''
    videoCompletedProjectId.value = ''
    videoCompletedProject.value = null
    videoStartedAt.value = Date.now()
    resetGenVideoStagesToPending(videoStages.value)
    try {
      await startPipelineRun(seq, videoSourceText)
    } catch (e) {
      if (isDisposed() || seq !== videoSeq) return
      markFirstGenVideoStageFailed(videoStages.value, e)
      videoPhase.value = 'failed'
      videoErrorText.value = t('collection.videoCreate.pipelineFailed')
      videoBusy.value = false
    }
  }

  /** 前端跟踪态复位（主进程 run 不受影响） */
  function resetVideoState () {
    videoSeq += 1
    tracking.stopGenVideoTracking()
    videoModalOpen.value = false
    videoPhase.value = 'idle'
    videoStages.value = []
    videoRunId.value = null
    videoRunProgress.value = null
    videoStartedAt.value = 0
    videoErrorText.value = ''
    videoCompletedVideoPath.value = ''
    videoCompletedProjectId.value = ''
    videoCompletedProject.value = null
    videoBusy.value = false
    videoTextTruncated.value = false
    videoTextTruncatedLength.value = 0
    videoSourceText = ''
    videoSourceTitle = ''
  }

  /** 关闭浮层：终态 ⇒ 复位关闭；运行中 ⇒ 关闭浮层但主进程继续跑（后台运行） */
  function handleVideoClose () {
    resetVideoState()
  }

  /** 【查看视频】：跳视频创作页的历史（已完成）视图 */
  function viewVideoInHistory () {
    if (!videoResultReady.value) return
    resetVideoState()
    router.push({ path: '/create', query: { view: 'history', filter: 'completed' } })
  }

  /** 【去发布】：成片进发布页（与热门选题一键成片同源出口） */
  async function publishVideoResult () {
    if (!videoResultReady.value) return
    if (videoBusy.value) return
    videoBusy.value = true
    try {
      const query = await buildGenVideoPublishQuery({
        videoPath: String(videoCompletedVideoPath.value || ''),
        project: videoCompletedProject.value,
        topicText: String(videoSourceTitle || videoSourceText || ''),
        bodyText: String(videoSourceText || ''),
      })
      resetVideoState()
      router.push({ path: '/publish', query })
    } finally {
      videoBusy.value = false
    }
  }

  return {
    videoModalOpen, videoBusy, videoPhase, videoStages, videoRunId, videoRunProgress,
    videoErrorText, videoPipelineName, videoCompletedVideoPath, videoCompletedProjectId,
    videoCompletedProject, videoTextTruncated, videoTextTruncatedLength, videoTextLimit,
    videoProgressPercent, videoElapsedMs, videoPipelineLabel,
    videoTerminal, videoCanRetry, videoCanCancel, videoCanBackground, videoResultReady,
    startVideoCreation, cancelVideoCreation, retryVideoCreation,
    handleVideoClose, resetVideoState, viewVideoInHistory, publishVideoResult,
  }
}
