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
import { buildStory2VideoTextConfigFromSnapshot } from '@/story2video/s2v-config-snapshot'
import { STORY2VIDEO_STAGE_NAMES } from '@/domain/pipeline-constants'
import { getAppLocale } from '@/i18n'
import { showPipelineBackgroundToast } from '@/stores/pipeline-background-toast'

const GEN_VIDEO_PIPELINE_NAME = 'story2video-compose'
const GEN_VIDEO_REWRITE_STAGE = 'rewrite_copy'
const GEN_VIDEO_STAGE_NAMES = Object.freeze([GEN_VIDEO_REWRITE_STAGE, ...STORY2VIDEO_STAGE_NAMES])
const GEN_VIDEO_POLL_INTERVAL_MS = 3000
const GEN_VIDEO_TERMINAL_STAGE_STATUSES = new Set(['completed', 'skipped', 'failed', 'cancelled'])

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
  const genVideoStages = ref([])
  const genVideoRunId = ref(null)
  const genVideoPhase = ref('idle') // idle | rewriting | starting | running | completed | failed | cancelled（后台脱离后复位为 idle，无 background 滞留态）
  const genVideoErrorText = ref('')
  const genVideoStartedAt = ref(0)
  const genVideoRewrittenContent = ref('')
  const genVideoDraftId = ref(null)
  const genVideoRunProgress = ref(null)
  let genVideoPollTimer = null
  let genVideoUnsubscribe = null
  let genVideoTickTimer = null
  let genVideoSeq = 0

  // ── 计算属性 ──

  /** 弹窗标题（选题名截断 30 字，避免标题过长） */
  const genVideoModalTitle = computed(() => {
    const topic = genVideoTopic.value?.topic || ''
    const short = topic.length > 30 ? topic.slice(0, 30) + '…' : topic
    return t('hotTopics.genVideoTitle', { topic: short })
  })

  /** 总进度：按已完成阶段数估算；流水线 run progress 映射到当前阶段区间 */
  const genVideoProgressPercent = computed(() => {
    const total = GEN_VIDEO_STAGE_NAMES.length
    if (genVideoPhase.value === 'completed') return 100
    const done = countCompletedGenStages()
    const base = (done / total) * 100
    if (genVideoPhase.value === 'rewriting' || genVideoPhase.value === 'starting') {
      return Math.min(99, Math.round(base))
    }
    const runPct = Number(genVideoRunProgress.value)
    if (Number.isFinite(runPct) && runPct >= 0) {
      return Math.min(99, Math.round(base + (Math.min(runPct, 100) / 100) * ((1 / total) * 100)))
    }
    return Math.min(99, Math.round(base))
  })

  const genVideoTick = ref(0)
  const genVideoElapsedMs = computed(() => {
    void genVideoTick.value // 响应式依赖：1s tick 驱动 Date.now 重算（Date.now 非响应式源）
    return genVideoStartedAt.value > 0 ? Math.max(0, Date.now() - genVideoStartedAt.value) : null
  })

  const genVideoSummary = computed(() => {
    if (genVideoPhase.value === 'rewriting') return t('hotTopics.genVideoStartToast')
    return ''
  })

  const genVideoTerminal = computed(() =>
    ['completed', 'failed', 'cancelled'].includes(genVideoPhase.value),
  )

  const genVideoCanRetry = computed(() => genVideoPhase.value === 'failed')

  const genVideoCanCancel = computed(() =>
    ['rewriting', 'starting', 'running'].includes(genVideoPhase.value),
  )

  /** 后台运行：仅流水线已真正启动（running 且持有 runId）时可脱离；
   * 改写/启动阶段还没有主进程 run，脱离无意义（spec 规则 2：方法内重校验状态）。 */
  const genVideoCanBackground = computed(() =>
    genVideoPhase.value === 'running' && Boolean(genVideoRunId.value),
  )

  function countCompletedGenStages() {
    return genVideoStages.value.filter(s => s && s.status === 'completed').length
  }

  // ── 编排方法 ──

  /** 初始化弹窗 stages：改写 pending + 流水线 7 阶段 pending */
  function initGenVideoStages() {
    genVideoStages.value = GEN_VIDEO_STAGE_NAMES.map(name => ({
      id: name, name, status: 'pending', startedAt: null, completedAt: null, progress: null,
    }))
  }

  function setGenStage(name, patch) {
    const stage = genVideoStages.value.find(s => s.name === name)
    if (!stage) return
    Object.assign(stage, patch)
  }

  /** 入口：点击【生成视频】 */
  async function startGenerateVideo(topic) {
    if (genVideoBusy.value || !topic?.topic) return
    genVideoTopic.value = topic
    genVideoRewrittenContent.value = ''
    genVideoDraftId.value = null
    genVideoRunId.value = null
    genVideoRunProgress.value = null
    genVideoErrorText.value = ''
    genVideoStartedAt.value = Date.now()
    genVideoSeq++
    initGenVideoStages()
    genVideoModalOpen.value = true
    await runGenVideoRewrite(genVideoSeq)
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

  /** 阶段二：读取默认选项并启动故事讲述流水线 */
  async function runGenVideoPipelineStart(seq) {
    if (seq !== genVideoSeq) return
    genVideoPhase.value = 'starting'
    setGenStage('split', { status: 'running', startedAt: new Date().toISOString() })
    try {
      // 读取用户保存的默认选项（owner-scoped SQLite；缺失回退内置默认）
      let snapshot = null
      try {
        snapshot = await storeGetSetting('story2video.lastOptions.v1')
      } catch (_) { snapshot = null }
      if (isDisposed() || seq !== genVideoSeq) return
      const text = genVideoRewrittenContent.value
      const story2videoTextConfig = buildStory2VideoTextConfigFromSnapshot(text, snapshot)
      const params = {
        text,
        inputMode: 'text',
        checkpointPolicy: 'none',
        autoAdvance: true,
        background: true,
        uiLocale: getAppLocale(),
        story2videoTextConfig,
      }
      const res = await pipelineStartOrchestrated(GEN_VIDEO_PIPELINE_NAME, params)
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
      // 流水线启动失败：改写已完成保留；流水线首阶段标 failed
      setGenStage('split', { status: 'failed', error: (e && e.message) || '', completedAt: new Date().toISOString() })
      genVideoPhase.value = 'failed'
      genVideoErrorText.value = t('hotTopics.genVideoPipelineFailed')
      genVideoBusy.value = false
    }
  }

  /** 合并流水线 stages 到弹窗 stages（保留改写阶段） */
  function mergeGenStages(incomingStages) {
    if (!Array.isArray(incomingStages)) return
    for (const inc of incomingStages) {
      if (!inc || typeof inc.name !== 'string') continue
      const target = genVideoStages.value.find(s => s.name === inc.name)
      if (target) {
        // 终态守卫：已 completed/skipped/failed/cancelled 的阶段不被乱序推送降级回 running
        const nextStatus = GEN_VIDEO_TERMINAL_STAGE_STATUSES.has(target.status)
          ? target.status
          : (inc.status || target.status)
        Object.assign(target, {
          status: nextStatus,
          startedAt: inc.startedAt || target.startedAt,
          completedAt: inc.completedAt || target.completedAt,
          error: inc.error ?? target.error,
          progress: inc.progress ?? target.progress,
        })
      }
    }
  }

  /** 启动双通道跟踪：onPipelineUpdate 实时推送 + 3s 轮询兜底 */
  function startGenVideoTracking() {
    stopGenVideoTracking()
    const runId = genVideoRunId.value
    if (!runId) return
    genVideoUnsubscribe = onPipelineUpdate(snapshot => handleGenVideoPush(snapshot))
    genVideoPollTimer = setInterval(() => pollGenVideoRun(runId), GEN_VIDEO_POLL_INTERVAL_MS)
    genVideoTickTimer = setInterval(() => { genVideoTick.value++ }, 1000)
    void pollGenVideoRun(runId)
  }

  function stopGenVideoTracking() {
    if (genVideoPollTimer) { clearInterval(genVideoPollTimer); genVideoPollTimer = null }
    if (genVideoUnsubscribe) { try { genVideoUnsubscribe() } catch (_) { /* 取消订阅失败无害，静默忽略 */ } genVideoUnsubscribe = null }
    if (genVideoTickTimer) { clearInterval(genVideoTickTimer); genVideoTickTimer = null }
  }

  /** 实时推送处理（runId 快照守卫） */
  function handleGenVideoPush(snapshot) {
    if (isDisposed() || !snapshot || typeof snapshot !== 'object') return
    const runId = genVideoRunId.value
    if (!runId || snapshot.runId !== runId) return
    const status = snapshot.status && typeof snapshot.status === 'object' ? snapshot.status : null
    if (Array.isArray(snapshot.stages)) mergeGenStages(snapshot.stages)
    else if (status && Array.isArray(status.stages)) mergeGenStages(status.stages)
    if (status && Number.isFinite(Number(status.progress))) genVideoRunProgress.value = Number(status.progress)
    const finalStatus = status?.status || snapshot.status
    if (typeof finalStatus === 'string' && ['completed', 'failed', 'cancelled'].includes(finalStatus)) {
      void pollGenVideoRun(runId, true)
    }
  }

  /** 轮询全量 run context（终态判定与 videoPath 提取的唯一权威来源） */
  async function pollGenVideoRun(runId, force = false) {
    if (isDisposed() || genVideoRunId.value !== runId) return
    try {
      const res = await pipelineGetRunContext(runId)
      if (isDisposed() || genVideoRunId.value !== runId) return
      if (res?.code !== 0 || !res.data) return
      const returnedRunId = res.data.runId || res.data.id
      if (typeof returnedRunId === 'string' && returnedRunId.trim() && returnedRunId.trim() !== runId) return
      const status = res.data.status && typeof res.data.status === 'object' ? res.data.status : null
      const stages = Array.isArray(res.data.stages) ? res.data.stages : (status ? status.stages : null)
      if (Array.isArray(stages)) mergeGenStages(stages)
      if (status && Number.isFinite(Number(status.progress))) genVideoRunProgress.value = Number(status.progress)
      const runStatus = status?.status || res.data.status
      if (runStatus === 'completed') {
        finishGenVideoCompleted(res.data)
      } else if (runStatus === 'failed' || runStatus === 'cancelled') {
        finishGenVideoTerminal(runStatus, res.data)
      } else if (force && runStatus && !['running', 'paused'].includes(runStatus)) {
        finishGenVideoTerminal(runStatus, res.data)
      }
    } catch (_) { /* 轮询失败等下一轮 */ }
  }

  /** 完成：提取 videoPath 跳结果页 */
  function finishGenVideoCompleted(data) {
    const context = data?.context && typeof data.context === 'object' ? data.context : null
    const publish = context?.publish?.data || context?.publish
    const compose = context?.compose?.data || context?.compose
    const videoPath = publish?.videoPath || publish?.path || compose?.videoPath || compose?.path || null
    stopGenVideoTracking()
    for (const s of genVideoStages.value) {
      if (s.status !== 'completed' && s.status !== 'skipped') s.status = 'completed'
    }
    genVideoPhase.value = 'completed'
    genVideoBusy.value = false
    if (videoPath) {
      const query = { path: videoPath }
      if (data?.context?.story2videoProject?.projectId) query.project = data.context.story2videoProject.projectId
      if (genVideoRunId.value) query.runId = genVideoRunId.value
      genVideoModalOpen.value = false
      router.push({ path: '/create/result', query })
    } else {
      genVideoPhase.value = 'failed'
      genVideoErrorText.value = t('hotTopics.genVideoPipelineFailed')
    }
  }

  /** 终态：failed / cancelled */
  function finishGenVideoTerminal(status, data) {
    stopGenVideoTracking()
    const failedStage = genVideoStages.value.find(s => s.status === 'running' || s.status === 'failed')
    if (failedStage && status === 'failed') {
      failedStage.status = 'failed'
      if (!failedStage.error && data?.error) failedStage.error = String(data.error)
    }
    for (const s of genVideoStages.value) {
      if (s.status === 'running' || s.status === 'paused') s.status = status === 'cancelled' ? 'cancelled' : 'failed'
      else if (s.status === 'pending') s.status = 'cancelled'
    }
    genVideoPhase.value = status === 'cancelled' ? 'cancelled' : 'failed'
    genVideoErrorText.value = status === 'cancelled' ? t('hotTopics.genVideoCancelled') : t('hotTopics.genVideoPipelineFailed')
    genVideoBusy.value = false
  }

  /** 重试：改写已成功则从流水线启动开始；否则从改写开始 */
  async function retryGenVideo() {
    if (genVideoPhase.value !== 'failed') return
    genVideoSeq++
    const seq = genVideoSeq
    genVideoBusy.value = true
    genVideoErrorText.value = ''
    genVideoRunId.value = null
    genVideoRunProgress.value = null
    genVideoStartedAt.value = Date.now()
    // 重置流水线阶段为 pending（保留改写阶段状态决定重试起点）
    for (const s of genVideoStages.value) {
      if (s.name !== GEN_VIDEO_REWRITE_STAGE) {
        Object.assign(s, { status: 'pending', startedAt: null, completedAt: null, error: null, progress: null })
      }
    }
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
    for (const s of genVideoStages.value) {
      if (s.status === 'running' || s.status === 'pending' || s.status === 'paused') s.status = 'cancelled'
    }
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
    genVideoStages.value = []
    genVideoRunId.value = null
    genVideoRunProgress.value = null
    genVideoStartedAt.value = 0
    genVideoErrorText.value = ''
    genVideoRewrittenContent.value = ''
    genVideoDraftId.value = null
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
    genVideoModalOpen, genVideoBusy, genVideoTopic, genVideoStages, genVideoRunId, genVideoPhase, genVideoErrorText,
    // 计算
    genVideoModalTitle, genVideoProgressPercent, genVideoElapsedMs, genVideoSummary,
    genVideoTerminal, genVideoCanRetry, genVideoCanCancel, genVideoCanBackground,
    // 方法
    startGenerateVideo, retryGenVideo, cancelGenVideo, handleGenVideoClose, detachGenVideoToBackground,
    closeGenVideoModal, mergeGenStages, disposeGenVideo,
  }
}
