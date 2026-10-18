// useHotTopicsGenVideo — 热门选题「一键生成视频」前端编排（状态 + 计算 + 方法）
//
// 为什么独立成 composable：HotTopics.vue 原本已 997 行，逼近本仓 filesOver1000 债务阈值
// （scripts/debt-baseline.json）；补收藏选题入口后越界。该编排与视图模板解耦、体量约 350 行、
// 且已有 15 用例覆盖，故与 useHotTopicsFavorites 同法抽出，而不是抬高债务基线。
//
// 依赖注入（与视图共享的三项）：buildRewriteInput（与批量发布共用同一改写输入契约）、
// hotUseViral（爆款库开关，与批量发布共用）、isDisposed（视图卸载标记）。
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { aiRewrite, draftSave, storeGetSetting, pipelineStartOrchestrated, pipelineGetRunContext, pipelineCancelRun, onPipelineUpdate } from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'
import {
  DEFAULT_GEN_VIDEO_PIPELINE,
  isPipelineRunnableFromTopic,
  buildGenVideoStartParams,
} from '@/features/hot-topics/gen-video-pipelines'
import {
  GEN_VIDEO_REWRITE_STAGE,
  createGenVideoStages,
  patchGenVideoStage,
  markFirstGenVideoStageRunning,
  markFirstGenVideoStageFailed,
  resetGenVideoStagesToPending,
  completeUnfinishedGenVideoStages,
  finalizeGenVideoTerminalStages,
  cancelGenVideoStages,
} from '@/features/hot-topics/gen-video-stage-tracking'
import { extractRunContextVideoPath } from '@/features/pipeline/run-context-video-path'
import {
  buildGenVideoModalTitle,
  buildGenVideoPipelineLabel,
  buildGenVideoSummary,
  isGenVideoTerminalPhase,
  canRetryGenVideo,
  canCancelGenVideo,
  canBackgroundGenVideo,
  isGenVideoResultReady,
  computeGenVideoProgressPercent,
} from '@/features/hot-topics/gen-video-view-model'
import { getAppLocale } from '@/i18n'
import { showPipelineBackgroundToast } from '@/stores/pipeline-background-toast'
import { extractRewriteHistoryId, attachRewriteLineage } from '@/utils/rewrite-lineage'
import { buildGenVideoPublishQuery } from '@/composables/useGenVideoPublishTitle'
import { useGenVideoRunTracking } from '@/composables/useGenVideoRunTracking'

const GEN_VIDEO_POLL_INTERVAL_MS = 3000

/**
 * @param {object} deps
 * @param {(topicText: string) => string} deps.buildRewriteInput 改写输入构造器（<20 字符补引导语）
 * @param {import('vue').Ref<boolean>} deps.hotUseViral 是否结合爆款库
 * @param {() => boolean} deps.isDisposed 视图是否已卸载（in-flight 响应不再写回状态）
 */
export function useHotTopicsGenVideo({ buildRewriteInput, hotUseViral, isDisposed }) {
  const router = useRouter()
  const { t } = useI18n()
  const { notifyInfo } = useNotify()

  // ── 状态 ──
  const genVideoModalOpen = ref(false)
  const genVideoBusy = ref(false)
  const genVideoTopic = ref(null)
  // 本次编排所选的视频创作流水线（hot-topics-pipeline-picker，2026-10-17）；
  // 空串 = 尚未选择/已复位。主按钮固定默认流水线，行内下箭头选择后立即以所选流水线启动。
  const genVideoPipelineName = ref('')
  const genVideoStages = ref([])
  const genVideoRunId = ref(null)
  const genVideoPhase = ref('idle') // idle | rewriting | starting | running | completed | failed | cancelled（后台脱离后复位为 idle，无 background 滞留态）
  const genVideoErrorText = ref('')
  const genVideoStartedAt = ref(0)
  const genVideoRewrittenContent = ref('')
  const genVideoDraftId = ref(null)
  const genVideoRunProgress = ref(null)
  // 四按钮片：本次 run 成功后的终态产物，是【查看】【去发布】的解锁判据与数据来源；
  // 由 finishGenVideoCompleted 写入，不从历史列表反查（多 run 并行时避免取错记录）。
  const genVideoCompletedVideoPath = ref('')
  const genVideoCompletedProjectId = ref('')
  const genVideoCompletedProject = ref(null)
  // 跟踪层的定时器/订阅句柄改由 useGenVideoRunTracking 自持（拆分产物），本文件不再维护
  let genVideoSeq = 0

  // ── 计算属性 ──

  /** 弹窗标题（选题名截断 30 字，避免标题过长） */
  const genVideoModalTitle = computed(() => buildGenVideoModalTitle(t, genVideoTopic.value?.topic))

  /** 本次编排的流水线显示名（弹窗内「流水线：xxx」；未选择为空串） */
  const genVideoPipelineLabel = computed(() => buildGenVideoPipelineLabel(t, genVideoPipelineName.value))

  /** 总进度：按已完成阶段数估算；流水线 run progress 映射到当前阶段区间（分母随所选流水线动态变化） */
  const genVideoProgressPercent = computed(() => computeGenVideoProgressPercent({
    phase: genVideoPhase.value,
    stages: genVideoStages.value,
    runProgress: genVideoRunProgress.value,
  }))

  const genVideoTick = ref(0)
  const genVideoElapsedMs = computed(() => {
    void genVideoTick.value // 响应式依赖：1s tick 驱动 Date.now 重算（Date.now 非响应式源）
    return genVideoStartedAt.value > 0 ? Math.max(0, Date.now() - genVideoStartedAt.value) : null
  })

  const genVideoSummary = computed(() => buildGenVideoSummary(t, genVideoPhase.value))

  const genVideoTerminal = computed(() => isGenVideoTerminalPhase(genVideoPhase.value))

  const genVideoCanRetry = computed(() => canRetryGenVideo(genVideoPhase.value))

  const genVideoCanCancel = computed(() => canCancelGenVideo(genVideoPhase.value))

  /** 后台运行：仅流水线已真正启动（running 且持有 runId）时可脱离；
   * 改写/启动阶段还没有主进程 run，脱离无意义（spec 规则 2：方法内重校验状态）。 */
  const genVideoCanBackground = computed(() => canBackgroundGenVideo(genVideoPhase.value, genVideoRunId.value))

  /** 四按钮片：解锁判据 —— 仅本次 run 成功且取得成片时可点；projectId 缺失（run-only）不影响解锁。 */
  const genVideoResultReady = computed(() => isGenVideoResultReady(genVideoPhase.value, genVideoCompletedVideoPath.value))

  // ── 编排方法 ──

  /** 改写阶段状态推进（阶段不存在时静默忽略） */
  function setGenStage(name, patch) {
    patchGenVideoStage(genVideoStages.value, name, patch)
  }

  /**
   * 入口：点击【生成视频】（默认流水线）或选择器中的某条流水线（pipelineName）。
   * @param {object} topic 选题条目（必须有非空 topic 文本）
   * @param {string} [pipelineName] 所选流水线；缺省 = 默认 story2video-compose
   * @returns {boolean} 是否真正进入编排（被 busy/非法流水线拦截时为 false）
   */
  async function startGenerateVideo(topic, pipelineName = DEFAULT_GEN_VIDEO_PIPELINE) {
    if (genVideoBusy.value || !topic?.topic) return false
    const requested = typeof pipelineName === 'string' && pipelineName.trim()
      ? pipelineName.trim()
      : DEFAULT_GEN_VIDEO_PIPELINE
    // 第二道防线：UI 已禁用不可执行项，方法内仍拒绝（防程序化调用绕过 disabled）
    if (!isPipelineRunnableFromTopic(requested)) return false
    genVideoPipelineName.value = requested
    genVideoTopic.value = topic
    genVideoRewrittenContent.value = ''
    genVideoDraftId.value = null
    genVideoRunId.value = null
    genVideoRunProgress.value = null
    genVideoErrorText.value = ''
    // 新编排不继承上一次 run 的终态产物（否则【查看】【去发布】会在新 run 完成前误解锁）
    genVideoCompletedVideoPath.value = ''
    genVideoCompletedProjectId.value = ''
    genVideoCompletedProject.value = null
    genVideoStartedAt.value = Date.now()
    genVideoSeq++
    genVideoStages.value = createGenVideoStages(requested)
    genVideoModalOpen.value = true
    await runGenVideoRewrite(genVideoSeq)
    return true
  }

  /** 阶段一：文案改写（aiRewrite mode=create）+ 存草稿 */
  async function runGenVideoRewrite(seq) {
    const topic = genVideoTopic.value
    if (!topic || seq !== genVideoSeq) return
    genVideoPhase.value = 'rewriting'
    genVideoBusy.value = true
    setGenStage(GEN_VIDEO_REWRITE_STAGE, { status: 'running', startedAt: new Date().toISOString(), completedAt: null, error: null })
    try {
      const res = await aiRewrite({ mode: 'create', content: buildRewriteInput(topic.topic), userSettings: { knowledgeOptions: { useViralLibrary: hotUseViral.value, usePersonalKnowledge: false } } })
      if (isDisposed() || seq !== genVideoSeq) return
      if (res && res.code === 0 && res.data && res.data.success) {
        const content = res.data.result || ''
        if (!content.trim()) throw new Error('empty rewrite result')
        genVideoRewrittenContent.value = content
        // 存草稿（失败不阻断视频生成——草稿只是回溯入口）
        const draft = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          title: topic.topic.slice(0, 64),
          content,
          source: 'hot-topics',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        // 归因链：这条草稿是改写产物，发布它时应能追回 rewrite_history 行（无 id 则不挂键）
        attachRewriteLineage(draft, extractRewriteHistoryId(res))
        try {
          const saved = await draftSave(draft)
          if (saved && saved.code === 0) genVideoDraftId.value = draft.id
        } catch (_) { /* 草稿保存失败不阻断 */ }
        if (isDisposed() || seq !== genVideoSeq) return
        setGenStage(GEN_VIDEO_REWRITE_STAGE, { status: 'completed', completedAt: new Date().toISOString() })
        await runGenVideoPipelineStart(seq)
      } else {
        throw new Error((res && res.message) || (res?.data && res.data.error) || 'rewrite failed')
      }
    } catch (e) {
      if (isDisposed() || seq !== genVideoSeq) return
      setGenStage(GEN_VIDEO_REWRITE_STAGE, { status: 'failed', error: (e && e.message) || '', completedAt: new Date().toISOString() })
      genVideoPhase.value = 'failed'
      genVideoErrorText.value = t('hotTopics.genVideoRewriteFailed')
      genVideoBusy.value = false
    }
  }

  /** 阶段二：读取默认选项并按所选流水线启动（story2video 完整配置 / 文本驱动自动流水线） */
  async function runGenVideoPipelineStart(seq) {
    if (seq !== genVideoSeq) return
    const pipelineName = genVideoPipelineName.value || DEFAULT_GEN_VIDEO_PIPELINE
    // 方法内二次校验：任何路径（重试/旧响应）都不得以不可执行流水线启动
    if (!isPipelineRunnableFromTopic(pipelineName)) {
      genVideoPhase.value = 'failed'
      genVideoErrorText.value = t('hotTopics.genVideoPipelineFailed')
      genVideoBusy.value = false
      return
    }
    genVideoPhase.value = 'starting'
    markFirstGenVideoStageRunning(genVideoStages.value)
    try {
      // 读取用户保存的默认选项（owner-scoped SQLite；缺失回退内置默认）
      let snapshot = null
      try {
        snapshot = await storeGetSetting('story2video.lastOptions.v1')
      } catch (_) { snapshot = null }
      if (isDisposed() || seq !== genVideoSeq) return
      const params = buildGenVideoStartParams({
        pipelineName,
        text: genVideoRewrittenContent.value,
        snapshot,
        uiLocale: getAppLocale(),
      })
      if (!params) throw new Error('invalid pipeline or empty rewrite result')
      const res = await pipelineStartOrchestrated(pipelineName, params)
      if (isDisposed() || seq !== genVideoSeq) return
      const outcome = res?.data
      if (res?.code === 0 && typeof outcome?.runId === 'string' && outcome.runId.trim() && outcome.success !== false) {
        genVideoRunId.value = outcome.runId.trim()
        genVideoPhase.value = 'running'
        // 用启动返回的 stages 初始化流水线部分（保留改写 completed 状态）
        if (Array.isArray(outcome.stages) && outcome.stages.length > 0) {
          mergeGenStages(outcome.stages)
        }
        startGenVideoTracking()
      } else {
        throw new Error((res && res.message) || (outcome && outcome.error) || 'pipeline start failed')
      }
    } catch (e) {
      if (isDisposed() || seq !== genVideoSeq) return
      // 流水线启动失败：改写已完成保留；所选流水线的第一个阶段标 failed
      markFirstGenVideoStageFailed(genVideoStages.value, e)
      genVideoPhase.value = 'failed'
      genVideoErrorText.value = t('hotTopics.genVideoPipelineFailed')
      genVideoBusy.value = false
    }
  }

  // run 跟踪层已拆到 useGenVideoRunTracking（check-max-lines 500 行红线拆分产物）；
  // 状态 ref 仍由本 composable 持有——单一真源不搬家，跟踪层只做「轮询/推送/终态分发」。
  const tracking = useGenVideoRunTracking({
    runId: genVideoRunId,
    tick: genVideoTick,
    progress: genVideoRunProgress,
    stages: genVideoStages,
    onCompleted: (data) => finishGenVideoCompleted(data),
    onTerminal: (status, data) => finishGenVideoTerminal(status, data),
    deps: { isDisposed, onPipelineUpdate, pipelineGetRunContext },
  })
  const mergeGenStages = tracking.mergeGenStages
  const startGenVideoTracking = tracking.startGenVideoTracking
  const stopGenVideoTracking = tracking.stopGenVideoTracking

  /** 完成：提取 videoPath 落终态产物，弹窗保留（不再自动跳结果页），
    * 由用户在弹窗内显式选择【查看】/【去发布】（unify-video-pipeline-progress-modal）。
    * 成片提取走共享纯函数（publish/compose/export/render/report），非 S2V 流水线同样可用。 */
  function finishGenVideoCompleted(data) {
    const context = data?.context && typeof data.context === 'object' ? data.context : null
    const videoPath = extractRunContextVideoPath(context)
    stopGenVideoTracking()
    completeUnfinishedGenVideoStages(genVideoStages.value)
    genVideoPhase.value = 'completed'
    genVideoBusy.value = false
    // 终态产物：两个出口按钮的解锁判据与数据来源（不从历史列表反查）
    genVideoCompletedVideoPath.value = videoPath || ''
    genVideoCompletedProjectId.value = (data?.context?.story2videoProject?.projectId) || ''
    genVideoCompletedProject.value = (data?.context?.story2videoProject && typeof data.context.story2videoProject === 'object')
      ? data.context.story2videoProject
      : null
    if (!videoPath) {
      // 成片缺失：保持失败提示，两个出口按钮保持灰显（不伪造可点击）
      genVideoPhase.value = 'failed'
      genVideoErrorText.value = t('hotTopics.genVideoPipelineFailed')
    }
  }

  /** 四按钮片：【查看】= 先复位前端跟踪态（终态 run 已在主进程收尾，不调 pipelineCancelRun），再带 view/filter 路由。 */
  function viewGenVideoInHistory() {
    if (!genVideoResultReady.value) return
    resetGenVideoFrontendState()
    router.push({ path: '/create', query: { view: 'history', filter: 'completed' } })
  }

  // 四按钮片：【去发布】= 与视频创作页/结果页同源（buildPublishFromProject + publishDataToQuery）；
  // run-only（无项目对象）退化为只带 type + video_path + 标题，不注入空 title/content。
  //
  // fix-hot-topics-genvideo-title（2026-10-17）：标题此前落到 buildPublishFromProject 回退链末端
  // （project.title ← sourceText），结果是「正文前 100 字」。现在标题由 AI 按爆款元素独立生成，
  // 三级降级：无默认文字推理模型 / 生成失败 → 原始选题文本。
  async function publishGenVideoResult() {
    if (!genVideoResultReady.value) return
    // busy 守卫：标题生成期间禁止重复点击（否则会发起第二次 LLM 调用与第二次跳转）
    if (genVideoBusy.value) return
    genVideoBusy.value = true
    try {
      const query = await buildGenVideoPublishQuery({
        videoPath: String(genVideoCompletedVideoPath.value || ''),
        project: genVideoCompletedProject.value,
        topicText: String(genVideoTopic.value?.topic || ''),
        bodyText: String(genVideoRewrittenContent.value || ''),
      })
      resetGenVideoFrontendState()
      router.push({ path: '/publish', query })
    } finally {
      genVideoBusy.value = false
    }
  }

  /** 终态：failed / cancelled */
  function finishGenVideoTerminal(status, data) {
    stopGenVideoTracking()
    finalizeGenVideoTerminalStages(genVideoStages.value, status, data?.error)
    genVideoPhase.value = status === 'cancelled' ? 'cancelled' : 'failed'
    genVideoErrorText.value = status === 'cancelled' ? t('hotTopics.genVideoCancelled') : t('hotTopics.genVideoPipelineFailed')
    genVideoBusy.value = false
  }

  /** 重试：改写已成功则从流水线启动开始；否则从改写开始（沿用本次所选流水线） */
  async function retryGenVideo() {
    if (genVideoPhase.value !== 'failed') return
    if (!genVideoPipelineName.value) genVideoPipelineName.value = DEFAULT_GEN_VIDEO_PIPELINE
    genVideoSeq++
    const seq = genVideoSeq
    genVideoBusy.value = true
    genVideoErrorText.value = ''
    genVideoRunId.value = null
    genVideoRunProgress.value = null
    // 重试不继承上一次终态产物（失败态本就没有，防御性清零避免脏状态误解锁）
    genVideoCompletedVideoPath.value = ''
    genVideoCompletedProjectId.value = ''
    genVideoCompletedProject.value = null
    genVideoStartedAt.value = Date.now()
    // 重置流水线阶段为 pending（保留改写阶段状态决定重试起点）
    resetGenVideoStagesToPending(genVideoStages.value)
    if (genVideoRewrittenContent.value) {
      // 改写产物已缓存：直接重试流水线启动
      await runGenVideoPipelineStart(seq)
    } else {
      setGenStage(GEN_VIDEO_REWRITE_STAGE, { status: 'pending', error: null })
      await runGenVideoRewrite(seq)
    }
  }

  /** 取消：改写/启动阶段 = 中止前端编排；流水线运行 = 调用 pipelineCancel（当前 run） */
  async function cancelGenVideo() {
    if (!genVideoCanCancel.value) return
    genVideoSeq++
    const phase = genVideoPhase.value
    if (phase === 'running' && genVideoRunId.value) {
      stopGenVideoTracking()
      try {
        await pipelineCancelRun(genVideoRunId.value)
      } catch (_) { /* 取消失败也按前端取消处理 */ }
    } else {
      stopGenVideoTracking()
    }
    cancelGenVideoStages(genVideoStages.value)
    genVideoPhase.value = 'cancelled'
    genVideoErrorText.value = t('hotTopics.genVideoCancelled')
    genVideoBusy.value = false
  }

  /** 前端跟踪态复位（唯一公共路径）：停跟踪 + 清空本次编排前端态 + 释放 busy。
   *  主进程 run 不受影响；必须释放 busy 以支持多任务并行（否则脱离后按钮永久禁用，PRD §6.7）。 */
  function resetGenVideoFrontendState() {
    genVideoSeq++ // 使在途改写/启动响应失效，避免脱离后旧响应重新挂回弹窗
    stopGenVideoTracking()
    genVideoModalOpen.value = false
    genVideoPhase.value = 'idle'
    genVideoTopic.value = null
    genVideoPipelineName.value = ''
    genVideoStages.value = []
    genVideoRunId.value = null
    genVideoRunProgress.value = null
    genVideoStartedAt.value = 0
    genVideoErrorText.value = ''
    genVideoRewrittenContent.value = ''
    genVideoDraftId.value = null
    genVideoCompletedVideoPath.value = ''
    genVideoCompletedProjectId.value = ''
    genVideoCompletedProject.value = null
    genVideoBusy.value = false
  }

  /** 弹窗关闭（右上角 × / 遮罩 / ESC 统一入口）：运行中（有 runId）= 后台运行；
   *  改写/启动（无 run）= 中止前端编排；终态 = 直接复位关闭。 */
  function handleGenVideoClose() {
    if (genVideoTerminal.value) {
      resetGenVideoFrontendState()
      return
    }
    const detached = genVideoCanBackground.value
    resetGenVideoFrontendState()
    if (detached) notifyInfo('hotTopics.genVideoBackgroundHint')
  }

  /** 显式【后台运行】按钮：与右上角 × 同一后台语义（复用唯一公共脱离路径），
   * 额外触发全局居中提示（2026-09-12 需求：所有视频流水线弹窗统一提供该按钮）。 */
  function detachGenVideoToBackground() {
    if (!genVideoCanBackground.value) return
    handleGenVideoClose()
    showPipelineBackgroundToast()
  }

  /** footer【关闭】按钮（仅终态显示）：语义别名，复用唯一复位路径。 */
  const closeGenVideoModal = resetGenVideoFrontendState

  /** 视图卸载清理：使 in-flight 响应失效 + 停止轮询/订阅（主进程 run 不受影响，后台继续） */
  function disposeGenVideo() {
    genVideoSeq++
    stopGenVideoTracking()
  }

  return {
    // 状态
    genVideoModalOpen, genVideoBusy, genVideoTopic, genVideoPipelineName, genVideoStages, genVideoRunId, genVideoPhase, genVideoErrorText,
    genVideoCompletedVideoPath, genVideoCompletedProjectId, genVideoCompletedProject,
    // 计算
    genVideoModalTitle, genVideoPipelineLabel, genVideoProgressPercent, genVideoElapsedMs, genVideoSummary,
    genVideoTerminal, genVideoCanRetry, genVideoCanCancel, genVideoCanBackground, genVideoResultReady,
    // 方法
    startGenerateVideo, retryGenVideo, cancelGenVideo, handleGenVideoClose, detachGenVideoToBackground,
    viewGenVideoInHistory, publishGenVideoResult,
    closeGenVideoModal, mergeGenStages, disposeGenVideo,
  }
}
