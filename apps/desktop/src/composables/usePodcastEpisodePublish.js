/**
 * usePodcastEpisodePublish.js — 成片一键出期的渲染层状态机（刀 3 第 4 片）
 *
 * 为什么状态机在渲染层而链在主进程：出期要跨 await 持有「临时文件 → 对象存储 PUT → episodes.json
 * 读改写 → feed.xml 重建 → feed PUT」，中间态只能由主进程收尾（PRD §6.4 与 podcast-episode-publish.js
 * 文件头同一条理由）。渲染层这份只负责**用户看得见的那部分状态**：三态结果、逐相位轨迹、
 * 领域码到文案的映射、取消回执的三态。它不复制任何判据，也不得反过来给主进程猜判据。
 *
 * 三条不可破的口径：
 *
 * 1. **三态不压平**（spec「成片一键出期必须有单一 IPC 入口且三态结果不压平」）。
 *    `success / partial / cancelled` 原样留在 `result.state`，视图按 state 分支取文案。
 *    `partial` 压成 failed 会诱导用户删掉本来正确的一期重来；`cancelled`（取消回执的
 *    `accepted`）与结果的 `state:'cancelled'` 是两件事——回执只说明「请求登记上了」，
 *    最终是不是取消**只认结果**。`unknown` 更不是取消：那是对一次可能已经发布成功的出期
 *    说「已取消，临时文件已回滚」。
 *
 * 2. **可取消性只从信封取，不在前端抄相位表**（PRD §6.4 显示项：「取消按钮仅在
 *    `cancellableAt(phase)` 为真时可点（判据来自编排层，界面不得自己猜相位）」）。
 *    `cancellableAt` 的唯一实现在 `electron/services/podcast-episode-publish.js`，
   * 而链末信封里**没有**这个字段；逐相位实时通道 podcast:episode:publish:progress 已落地，所以 `cancellable`
 *    目前恒为 false、浮层据此禁用取消按钮并说明原因（§6.4.2 明写的降级路径，不是遗漏）。
 *    §6.4.2 已裁决补第三条通道 `podcast:episode:publish:progress`，载荷
 *    `{ runId, phase, state, cancellable, durationSec?, sizeBytes?, mime?, … }`；它落地后本文件
 *    **不改判据**就会自动放开——反过来，在这里写「哪些相位可取消」就是给下一次改枚举留一条漂移路径，
 *    由本文件的结构锁（usePodcastEpisodePublish.test.js）钉住。
 *
 * 3. **传给 IPC 的必须是纯 JSON**（AGENTS.md「IPC 参数序列化安全」）：Vue ref 包出来的
 *    reactive proxy 直接进 `ipcRenderer.invoke` 会抛 "An object could not be cloned"，
 *    所以 project/segments 在出口处 `JSON.parse(JSON.stringify(...))` 脱壳（`toPlain` 单点），
 *    脱不出来（循环引用）按 PODCAST_PAYLOAD_NOT_SERIALIZABLE 出声，不得静默发半个载荷。
 *
 * `runId` 由**渲染层生成**（PRD §6.4 入参表：主进程按它算临时目录名，形态判据
 * `RUN_ID_PATTERN` 就是目录穿越边界本身，不是装饰）。
 */
import { computed, ref } from 'vue'

import i18n from '@/i18n'
import { episodePublishFromVideo, episodePublishCancel, onEpisodePublishProgress } from '@/api/podcast-channel'
import { IPC_EXCEPTION, errorCodeText, normalizeIpcEnvelope, toPlain, usePodcastChannel } from './usePodcastChannel'

/** 与主进程 `podcast-episode-cancel.js` 的 RUN_ID_RE 逐字一致（形态不过主进程当场拒 PODCAST_EPISODE_INVALID） */
export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const RUN_ID_MIN_LENGTH = 8
const RUN_ID_MAX_LENGTH = 64

/**
 * 浮层进度条的**显示骨架**（PRD §6.4 显示项「七相位 + cancelled」，逐相位文案走 `episode.phase.*`）。
 * ⛔ 它只用来渲染标签与「这次链走到了哪几站」的既有事实，**不得**参与可取消判定、
 * 也不得用来推断当前相位——判据的唯一实现在编排层（见文件头第 2 条）。
 */
export const EPISODE_PHASE_STEPS = Object.freeze([
  'pickChannel', 'extractMix', 'probe', 'uploadAudio', 'attach', 'buildFeed', 'uploadFeed', 'cancelled',
])

/** 抽取失败的第二成因（打包的 ffmpeg 崩坏 vs 真的缺编码器）——排查方向完全不同，故分键。 */
export const EXTRACT_FAILED_ENCODER_STAGE = 'encoders'

/**
 * §6.4 领域码 → `podcast.episode.*` 文案键的映射表（本文件是唯一一份）。
 * 未命中的码（如 §6.3 的四条托管码）**不在这里重复造键**，直接落到 `podcast.errors.<码>`
 * 的既有文案（`errorCodeText`），它自己再回落 `podcast.errors.fallback`。
 */
export const EPISODE_COPY_KEYS = Object.freeze({
  PODCAST_AUDIO_DEGRADED_SOURCE: 'audioDegraded',
  PODCAST_VIDEO_NOT_FOUND: 'videoMissing',
  PODCAST_AUDIO_EXTRACT_FAILED: 'extractFailed',
  PODCAST_AUDIO_ENCODER_UNAVAILABLE: 'encoderMissing',
  PODCAST_AUDIO_MEASURE_FAILED: 'measureFailed',
  PODCAST_AUDIO_SIZE_MISMATCH: 'sizeMismatch',
  PODCAST_EPISODES_FULL: 'capFull',
  PODCAST_EPISODE_INVALID: 'invalid',
  PODCAST_FEED_BUILD_FAILED: 'feedBuildFailed',
  PODCAST_PUBLISH_CANCELLED: 'cancelled',
  PODCAST_CANCEL_TOO_LATE: 'cancelTooLate',
})

/**
 * 领域码 → 浮层文案键。`stage` 的判据留在这里但**不由本层猜**：
 * 主进程 `toIpcError` 目前不透传 err.stage（契约缺口，见 PRD §6.4 表第 3 行），
 * 所以缺 stage 时抽取失败如实落 `extractFailed`，不会被说成「ffmpeg 崩坏」。
 */
export function episodeCopyKeyFor (code, stage) {
  if (code === 'PODCAST_AUDIO_EXTRACT_FAILED' && stage === EXTRACT_FAILED_ENCODER_STAGE) return 'encoderBroken'
  return EPISODE_COPY_KEYS[String(code || '')] || ''
}

/**
 * 生成 runId：`ep` + 时刻(36 进制) + 随机尾巴，再按形态白名单净化。
 * 净化不是洁癖——`Math.random()` 在某些取值下会给出 `0`（尾巴为空），
 * 拼出来短于 8 位就是形态非法，主进程当场拒一条「发起出期必须带形态合法的 runId」，
 * 用户看到的是一句与他无关的失败。补零只在真的不够长时发生。
 */
export function makeEpisodeRunId (seed = Date.now (), random = Math.random) {
  const stamp = Number(seed).toString(36)
  const noise = String(Number(random()).toString(36).slice(2))
  const body = `ep${stamp}${noise}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, RUN_ID_MAX_LENGTH)
  return body.length >= RUN_ID_MIN_LENGTH ? body : body.padEnd(RUN_ID_MIN_LENGTH, '0')
}

export function usePodcastEpisodePublish () {
  // 频道目录域与配额一律复用页面域那一份实现（loadChannels / refreshQuota 的
  // channelId 注入与「每次动作前现算」都只有一份判据，禁止在这里另写一份）。
  // 这里刻意走 loadChannels 而不是「有值就用缓存」：PRD §8 要求 cap/count 与迁移状态
  // 每次发布动作发起前现算，缓存会让「刚在播客页删掉一期」这类变化在浮层里看不见。
  const { activeChannelId, channelCap, channelCount, channelListError, loadChannels, refreshQuota } = usePodcastChannel()

  const publishing = ref(false)
  const result = ref(null)
  const errorCode = ref('')
  const errorDetail = ref('')
  /** 失败信封带的成因阶段（§6.4 表第 3 行的 stage=encoders 分支用）。主进程目前不透传，见契约缺口。 */
  const errorStage = ref('')
  const issues = ref([])
  const runId = ref('')
  const cancelReceipt = ref(null)
  const cancelError = ref('')
  /**
   * §6.4.2 第三条通道的实时面。四个量各管一件事，不许互相代替：
   * - `livePhase`：最后一次 `start` 边界的相位——进度条画到这一站。
   * - `liveTrail`：逐边界累积的轨迹；链结束后信封里的 `phases` 才是权威归档来源，
   *   但在链**进行中**它是空的，进度条只能由这里喂（这就是本通道存在的全部理由）。
   * - `liveCancellable`：主进程算好下发的布尔位，界面**只读**。
   * - `progressAvailable`：preload 面没有订阅方法时为 false → 界面必须显式说「进度不可用」，
   *   禁止画一条停在首相位的假进度条。
   */
  const livePhase = ref('')
  const liveTrail = ref([])
  const liveCancellable = ref(false)
  const progressAvailable = ref(false)
  let unsubscribeProgress = null
  /** 轨迹的取值口径：链中取实时面，链末取信封（信封的 phases 含 durationSec 等实测值的完整形状）。 */
  const trail = computed(() => {
    const env = result.value && Array.isArray(result.value.phases) ? result.value.phases : []
    // 链中：信封此刻是空的，只有实时面能喂进度条。
    // 链末：以信封 phases 为权威归档——原写法「liveTrail 非空就永远优先」会让实时面
    // 在链结束后继续遮蔽信封，把只挂在信封上的逐相位字段吞掉（QM-6 前端评审命中）。
    if (publishing.value) return liveTrail.value
    if (env.length) return env
    return liveTrail.value
  })

  /** 三态原样透出，不压平；失败与「还没跑」是另外两档。 */
  const state = computed(() => {
    if (publishing.value) return 'running'
    if (result.value && result.value.state) return result.value.state
    if (errorCode.value) return 'failed'
    return ''
  })
  /**
   * ⛔ 取消位只认主进程下发的值（§6.4.2 口径②），前端不得自算相位表。
   * 进度通道可用时以实时位为准；通道不可用时退回信封里的 `cancellable`（链末才有），
   * 两者都没给就是 false ——「不知道能不能取消」的默认态是禁用并说明原因，不是「点了试试」。
   */
  const cancellable = computed(() => (progressAvailable.value
    ? liveCancellable.value === true
    : Boolean(result.value && result.value.cancellable === true)))
  const reachedPhases = computed(() => {
    const seen = []
    for (const entry of trail.value) {
      const phase = entry && entry.phase
      if (phase && !seen.includes(phase)) seen.push(phase)
    }
    return seen
  })
  /** 当前相位的实测值：宿主只在 `probe` 那一站挂 durationSec/sizeBytes/mime，取到就显示，取不到不编。 */
  const measured = computed(() => {
    for (const entry of trail.value) {
      if (!entry || entry.phase !== 'probe') continue
      if (entry.durationSec == null && entry.sizeBytes == null && !entry.mime) continue
      return { durationSec: entry.durationSec, sizeBytes: entry.sizeBytes, mime: entry.mime || '' }
    }
    return null
  })
  /**
   * 取消回执的三态。**accepted ≠ 已取消**：它只说明请求登记上了，链会在下一个采样点停下；
   * 真的取消了要看结果的 `state:'cancelled'`。unknown 不得读成已取消（见文件头第 1 条）。
   */
  const cancelOutcome = computed(() => (cancelReceipt.value ? String(cancelReceipt.value.outcome || '') : ''))
  const failureCode = computed(() => errorCode.value || String((result.value && result.value.errorCode) || ''))
  /** 失败句：优先 §6.4 表里的 episode.* 专属文案，未命中回落 podcast.errors.<码>（再回落 fallback）。 */
  const failureText = computed(() => {
    const code = failureCode.value
    if (!code) return ''
    const key = episodeCopyKeyFor(code, errorStage.value || (result.value && result.value.stage))
    if (key) return i18n.global.t(`podcast.episode.${key}`)
    return errorCodeText(code)
  })
  /** 结果句：三态各一句，partial 永不说成本地坏了，success 永不说「已即时生效」。 */
  const resultText = computed(() => {
    const res = result.value
    if (!res) return ''
    if (res.state === 'success') return i18n.global.t('podcast.episode.success', { feedUrl: res.feedUrl || '' })
    if (res.state === 'partial') return i18n.global.t('podcast.episode.partial')
    if (res.state === 'cancelled') return i18n.global.t('podcast.episode.cancelled')
    return ''
  })
  const cancelText = computed(() => {
    if (cancelError.value) return errorCodeText(cancelError.value)
    const outcome = cancelOutcome.value
    if (outcome === 'accepted') return i18n.global.t('podcast.episode.cancelAccepted')
    if (outcome === 'too_late') return i18n.global.t('podcast.episode.cancelTooLate')
    if (outcome === 'unknown') return i18n.global.t('podcast.episode.cancelUnknown')
    return ''
  })
  const detailText = computed(() => {
    const bits = []
    const fromResult = result.value && result.value.errorMessage
    const raw = String(fromResult || errorDetail.value || '')
    if (raw) bits.push(raw)
    // 取消回执带的 phase 是主进程给的原值（不是本层猜的），能映射到相位标签就附上，映射不到就整体不显示。
    const phase = cancelReceipt.value && cancelReceipt.value.phase
    if (typeof phase === 'string' && phase && EPISODE_PHASE_STEPS.includes(phase)) {
      bits.push(i18n.global.t(`podcast.episode.phase.${phase}`))
    }
    return bits.join(' · ')
  })
  const hasIssues = computed(() => Array.isArray(issues.value) && issues.value.length > 0)

  /**
   * 与 usePodcastHosting.js 同形态的本地 `call`：available/结果形状/subCode 优先三条归一
   * 都在 `normalizeIpcEnvelope` 一处，这里只保留「调用抛错 → IPC_EXCEPTION」这句调用现场的措辞。
   */
  async function call (invoke, ...args) {
    let envelope
    try {
      envelope = await invoke(...args)
    } catch (err) {
      return { ok: false, code: IPC_EXCEPTION, message: (err && err.message) || String(err) }
    }
    return normalizeIpcEnvelope(envelope)
  }

  function reset () {
    result.value = null
    errorCode.value = ''
    errorDetail.value = ''
    errorStage.value = ''
    issues.value = []
    runId.value = ''
    cancelReceipt.value = null
    cancelError.value = ''
  }

  /**
   * 发起一次出期。载荷**不含 `outBase`**——临时目录基名由宿主按 runId 算（PRD §6.4：
   * 接受渲染层给路径等于让渲染进程决定主进程往哪写、又删哪）。
   * @param {{project:object, segments?:Array, videoPath:string, title:string, meta?:object}} input
   */
  async function start (input = {}) {
    reset()
    // 判据取本次调用的返回值而不是 channelListError——那个错误位是页面域的持久状态，
    // 上一次失败留下的值会把这一次成功的读取也判成失败（同 AGENTS.md「沿用取锁前快照」同族）。
    const directory = await loadChannels()
    if (!directory || directory.ok !== true) {
      // 「读目录失败」与「没有频道」是两个排查方向，不得合并成一句（前者是环境/登录态，后者是用户还没建）
      errorCode.value = (directory && directory.code) || channelListError.value || IPC_EXCEPTION
      return { ok: false, code: errorCode.value }
    }
    const channelId = String(activeChannelId.value || '')
    if (!channelId) {
      errorCode.value = 'PODCAST_CHANNEL_ID_REQUIRED'
      return { ok: false, code: errorCode.value }
    }
    // 配额事前算（PRD §8：禁止跨动作缓存），满了就不再打这一次外发；
    // cap 还没读到（0）时不拦，交给主进程按真源判 PODCAST_EPISODES_FULL。
    const quota = await refreshQuota()
    if (quota && quota.cap > 0 && quota.count >= quota.cap) {
      errorCode.value = 'PODCAST_EPISODES_FULL'
      return { ok: false, code: errorCode.value }
    }

    const plainProject = toPlain(input.project)
    if (!plainProject || typeof plainProject !== 'object') {
      errorCode.value = 'PODCAST_PAYLOAD_NOT_SERIALIZABLE'
      return { ok: false, code: errorCode.value }
    }
    // 覆盖式 segments（结果页的分段是界面真源，见下方视图侧注释）：只认数组，
    // null/undefined 一律当「没给」，不得把「没给」当成「空数组」——那会让降级判定空转。
    const plainSegments = Array.isArray(input.segments) ? toPlain(input.segments) : null
    if (Array.isArray(input.segments) && plainSegments === null) {
      errorCode.value = 'PODCAST_PAYLOAD_NOT_SERIALIZABLE'
      return { ok: false, code: errorCode.value }
    }
    const project = plainSegments === null ? plainProject : Object.assign({}, plainProject, { segments: plainSegments })
    // 判据与宿主逐字一致：只判「是不是数组」。空数组不在这儿拦——真正的音轨来源是 videoPath，
    // segments 只承载降级判定，在这里加码会变成渲染层替主进程发明第二条判据。
    if (!Array.isArray(project.segments)) {
      errorCode.value = 'PODCAST_EPISODE_INVALID'
      return { ok: false, code: errorCode.value }
    }
    const videoPath = String(input.videoPath || '')
    if (!videoPath) {
      errorCode.value = 'PODCAST_VIDEO_NOT_FOUND'
      return { ok: false, code: errorCode.value }
    }

    const payload = { channelId, project, videoPath, title: String(input.title || ''), runId: makeEpisodeRunId() }
    if (input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)) {
      const plainMeta = toPlain(input.meta)
      if (plainMeta === null) {
        errorCode.value = 'PODCAST_PAYLOAD_NOT_SERIALIZABLE'
        return { ok: false, code: errorCode.value }
      }
      payload.meta = plainMeta
    }
    runId.value = payload.runId

    // 订阅必须先于发起调用：链一开跑就可能发出第一个 start 边界，晚订一步进度条就永远少一站
    // （而且少的那一站往往正是最耗时的那一站，症状看起来像「进度条卡住」而不是「少了一站」）。
    await watchProgress(payload.runId)
    publishing.value = true
    try {
      const res = await call(episodePublishFromVideo, toPlain(payload))
      if (res.ok) {
        result.value = res
      } else {
        errorCode.value = res.code || IPC_EXCEPTION
        errorDetail.value = typeof res.message === 'string' ? res.message : ''
        errorStage.value = typeof res.stage === 'string' ? res.stage : ''
        issues.value = Array.isArray(res.issues) ? res.issues : []
      }
      return res
    } finally {
      publishing.value = false
      stopProgressWatch()
    }
  }

  /**
   * 订阅本次 run 的相位边界（§6.4.2 第三条通道）。返回是否真的订上了：
   * 订不上时 `progressAvailable` 保持 false，界面走「进度不可用」那条显式降级文案，
   * 不得画一条停在首相位的假进度条。
   */
  async function watchProgress (id) {
    livePhase.value = ''
    liveTrail.value = []
    liveCancellable.value = false
    progressAvailable.value = false
    const sub = await onEpisodePublishProgress((evt) => {
      // 按 runId 过滤：别的窗口可能正在跑另一条出期链，它们的边界事件不得动本遮罩
      // （这是「订阅按 id 精确」纪律在推送型通道上的等价物）。
      if (!evt || evt.runId !== id) return
      if (typeof evt.cancellable === 'boolean') liveCancellable.value = evt.cancellable
      const phase = typeof evt.phase === 'string' ? evt.phase : ''
      const state = typeof evt.state === 'string' ? evt.state : ''
      if (!phase || !state) return
      if (state === 'start') livePhase.value = phase
      const rec = liveTrail.value.find((x) => x.phase === phase)
      if (!rec) {
        liveTrail.value.push({ phase, state, durationSec: evt.durationSec, sizeBytes: evt.sizeBytes, mime: evt.mime || '' })
        return
      }
      rec.state = state
      if (evt.durationSec != null) rec.durationSec = evt.durationSec
      if (evt.sizeBytes != null) rec.sizeBytes = evt.sizeBytes
      if (evt.mime) rec.mime = evt.mime
    })
    if (!sub || sub.available !== true || typeof sub.result !== 'function') {
      unsubscribeProgress = null
      return false
    }
    unsubscribeProgress = sub.result
    progressAvailable.value = true
    return true
  }

  /** 注销只删自己那个 handler（禁止 removeAllListeners），且失败不冒泡到出期链本身。 */
  function stopProgressWatch () {
    const fn = unsubscribeProgress
    unsubscribeProgress = null
    if (typeof fn !== 'function') return false
    try {
      fn()
      return true
    } catch (e) {
      return false
    }
  }

  /**
   * 请求取消（第二条通道，见 PRD §6.4 的 cancelToken 合同纠正）。
   * 没有 runId 时返回 null——那时链还没发起，「取消」无对象可指，不得伪造一个回执。
   */
  async function requestCancel () {
    const id = String(runId.value || '')
    if (!id) return null
    cancelError.value = ''
    const res = await call(episodePublishCancel, toPlain({ runId: id }))
    if (res.ok) {
      cancelReceipt.value = { outcome: res.outcome, phase: res.phase }
    } else {
      cancelError.value = res.code || IPC_EXCEPTION
    }
    return res
  }

  return {
    // 状态
    publishing,
    result,
    runId,
    errorCode,
    errorDetail,
    errorStage,
    issues,
    cancelReceipt,
    cancelError,
    // 频道域（复用页面域那一份实现，不在本文件另写 channelId 注入）
    activeChannelId,
    channelCap,
    channelCount,
    // 派生
    state,
    cancellable,
    livePhase,
    liveTrail,
    progressAvailable,
    stopProgressWatch,
    reachedPhases,
    measured,
    cancelOutcome,
    failureCode,
    failureText,
    resultText,
    cancelText,
    detailText,
    hasIssues,
    // 动作
    start,
    requestCancel,
    reset,
  }
}
