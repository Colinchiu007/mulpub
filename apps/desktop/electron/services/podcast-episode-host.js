'use strict'

/**
 * podcast-episode-host.js — 成片一键出期的**真实宿主接线层**（刀 3 第 3 片）
 *
 * 编排层（`podcast-episode-publish.js`）刻意不 require 任何东西：它只认四个注入实现，
 * 所以「谁真的起 ffmpeg、谁真的锁频道、临时文件写到哪」这类问题在它那里没有答案。
 * 本文件是这些问题的**唯一**答案，也是 `podcast:episode:publishFromVideo` 唯一的调用者。
 *
 * 三件事必须在这里发生，而不是在 IPC 层或渲染层：
 *
 * 1. **整条链持一个频道忙标记**（QM-6 后端 ① W1）。前两片的注释写着「锁归整条出期链」，
 *    而实现里一次都没取锁——那句话当时是假的。忙标记的语义是「这份频道数据有一次发布在飞」，
 *    临界区必须横跨「音频 PUT → 挂期 → 重建 feed → feed PUT」这四次跨 await 的写；
 *    把它下放到 `publishAudio` 会把一次发布切成两段互斥，段间仍能插进手工写。
 *    取锁失败即 `PODCAST_CHANNEL_BUSY` **立即拒绝不排队**（排队会让用户以为按钮没生效）。
 *
 * 2. **临时目录基名由主进程算**（PRD §6.4：`outBase` 由主进程持有，不接受渲染层给路径）。
 *    接受渲染层路径等于让渲染进程决定主进程往磁盘哪里写、又删哪里；一旦有目录穿越，
 *    收尾那一步就变成「删调用方指定的任何文件」。runId 同时是目录名的一部分，
 *    所以它的形态判据（`RUN_ID_RE`）就是这条边界本身，不是装饰。
 *
 * 3. **取消要能真的打断在途子进程**（tasks 3.7 ③ F3）。置位 `cancelled` 只让链在下一个采样点
 *    停下，而抽取一次要跑几十秒，不 kill 就等于把「取消」实现成「再等一次完整的 ffmpeg」。
 *
 * 零真实出站与零真实进程由注入实现（`spawnImpl`/`fsImpl`）保证：测试不碰宿主，
 * 而生产路径的 `spawnImpl` 是唯一 `require('child_process')` 的地方（只在真起进程时加载）。
 */

const path = require('path')
const os = require('os')
const { createEpisodePublisher, EPISODE_PUBLISH_ERRORS, PHASES } = require('./podcast-episode-publish')
const { createEpisodeAdapters } = require('./podcast-episode-adapters')
const { extractEpisodeAudio, assertUploadSizeMatches } = require('./podcast-episode-extract')
const { episodeCancelRegistry, CANCEL_ERRORS, RUN_ID_RE } = require('./podcast-episode-cancel')
const { synthesizeEpisodeAudio } = require('./podcast-episode-synth')
const { validateComposeInput } = require('./podcast-tts-compose')

const HOST_ERRORS = {
  VIDEO_MISSING: 'PODCAST_VIDEO_NOT_FOUND',
  INVALID: 'PODCAST_EPISODE_INVALID',
  BUSY: 'PODCAST_CHANNEL_BUSY',
  // 计费同意闸门：文本出期每块都要调 provider 的 TTS，花的是用户的钱而不是本地算力。
  // 未确认即拒，且必须排在内容判据**之前**——把「没同意」报成「正文过短」会让用户以为
  // 是稿件问题，从而去改稿件而不是去找那个他从未见过的确认框。
  BILLING_UNCONFIRMED: 'PODCAST_TTS_BILLING_UNCONFIRMED',
}

/** meta 白名单：只允许引擎 `validateEpisode` 逐字消费、且不是链自身产物的键。 */
const META_ALLOWLIST = Object.freeze(['description', 'subtitle', 'guid'])
const TITLE_MAX_CODEPOINTS = 200

function hostErr (code, message, extra) {
  const e = new Error(code + ': ' + message)
  e.code = code
  if (extra) Object.assign(e, extra)
  return e
}

/**
 * @param {{registry:object, channelServiceOf:Function, hostingService:object, logger?:object,
 *          fsImpl?:object, spawnImpl?:Function, tmpRoot?:string,
 *          findFfmpeg?:Function, findFfprobe?:Function}} deps
 */
function createEpisodeHost (deps = {}) {
  const log = deps.logger || { info () {}, warn () {}, error () {} }
  const fs = deps.fsImpl || require('fs')
  const registry = deps.registry
  if (!registry || typeof registry.tryBeginPublish !== 'function' || typeof registry.endPublish !== 'function'
    || typeof deps.channelServiceOf !== 'function' || !deps.hostingService) {
    throw hostErr(HOST_ERRORS.INVALID, '出期宿主必须注入 registry（取/放忙标记）、频道服务与托管服务')
  }

  // 默认 spawn：真起子进程并回收 stdout/stderr。非 0 退出不算抛错——判由 extract 按 code 做，
  // 这一层只负责「跑到哪一步、拿到什么输出、以及怎么被杀掉」。
  function defaultSpawn (opts) {
    const { spawn } = require('child_process')
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawn(opts.command, opts.args, { windowsHide: true })
      } catch (e) { reject(e); return }
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => { stdout += String(d) })
      child.stderr.on('data', (d) => { stderr += String(d) })
      opts.registerKill((fn) => { try { child.kill() } catch (_) { /* 已退出，杀不掉由超时自己报错 */ } void fn })
      child.on('error', (e) => { opts.registerKill(null); reject(e) })
      child.on('close', (code) => { opts.registerKill(null); resolve({ code, stdout, stderr }) })
    })
  }
  const spawnImpl = deps.spawnImpl || defaultSpawn

  /**
   * 出期链的**唯一**执行体：持锁凭证、取消登记、忙标记、临时目录、相位观察者、终态边界、
   * finally 收尾都只在这里发生一次。两种来源（成片抽混音 / 文本合成）只在两处不同：
   * `extractImpl`（extractMix 这一站的实现）与 `extraInput`（喂给那一站的素材）。
   * 把这两处当参数传，而不是复制一条链——`probe` 及之后的每一步必须逐字复用，
   * 否则「换素材来源」就会顺带改掉取消窗口、忙标记范围或收尾语义（那才是真事故）。
   */
  async function runChain (ctx) {
    const emitProgress = ctx.emitProgress
    const lockToken = 'ep-' + ctx.runId
    const adapters = createEpisodeAdapters({
      channelServiceOf: deps.channelServiceOf,
      hostingService: deps.hostingService,
      // 复用同一次持锁：feed 步的 publishFeed 自带取锁，必须认得「锁已在链上」才不会被自己挡住
      heldBy: lockToken,
      logger: log,
    })
    let emitPhase = () => {}
    const publisher = createEpisodePublisher({
      extractEpisodeAudio: ctx.extractImpl,
      assertUploadSizeMatches,
      // §6.4.2 口径③：每个相位必须有 start（执行前）与 done 两个边界。观察者由编排层在
      // mark() 这个**既有**边界点上回调，真正的发送点仍然只有本宿主一处。
      onPhase: (e) => emitPhase(e.phase, e.state, e),
      uploadImpl: adapters.uploadImpl,
      episodeSink: adapters.episodeSink,
      feedSink: adapters.feedSink,
      channelGate: adapters.channelGate,
      logger: log,
    })
    /* §6.4.2 口径②：`cancellable` 只在这里算，用的就是编排层那份唯一实现 `cancellableAt`，
       渲染层只读这个位（禁止前端抄相位表或按时长猜）。
       口径③：发送点唯一在本宿主——编排层只在既有 mark() 边界上回调观察者，不发事件。
       发送失败不得冒泡：进度是旁路，绝不能让一次遮罩上的动画问题毁掉真实出期。 */
    emitPhase = (phase, state, extra) => {
      if (!emitProgress || !phase) return
      const evt = { runId: ctx.runId, phase, state, cancellable: publisher.cancellableAt(phase) === true }
      if (extra) {
        if (extra.durationSec != null) evt.durationSec = extra.durationSec
        if (extra.sizeBytes != null) evt.sizeBytes = extra.sizeBytes
        if (extra.mime) evt.mime = extra.mime
        if (extra.message) evt.message = extra.message
        if (extra.errorCode) evt.errorCode = extra.errorCode
        if (extra.subCode) evt.subCode = extra.subCode
      }
      try { emitProgress(evt) } catch (e) {
        log.warn('[podcast-host] 进度事件发送失败，不阻断出期: ' + ((e && e.message) || String(e)))
      }
    }

    // ③ 取消登记先于取锁：token 是主进程侧的活引用，编排层改的就是它（见 cancel 模块头）。
    const cancel = episodeCancelRegistry.begin(ctx.runId, { cancellableAt: publisher.cancellableAt, initialPhase: PHASES[0] })

    // ② 忙标记：整条链一份，立即拒绝不排队。
    if (!registry.tryBeginPublish(ctx.channelId, { reason: ctx.reason, token: lockToken })) {
      episodeCancelRegistry.end(ctx.runId)
      throw hostErr(HOST_ERRORS.BUSY, '该频道有一次发布正在进行，请等它结束', { channelId: ctx.channelId })
    }
    // 临时目录基名由主进程算：渲染层永远拿不到「写哪里」的决定权
    const tmpRoot = deps.tmpRoot || path.join(os.tmpdir(), 'mulpub-podcast')
    const runDir = path.join(tmpRoot, 'episode-' + ctx.runId)
    const outBase = path.join(runDir, 'episode')
    try {
      ctx.prepare({ fs, runDir, log, hostErr, HOST_ERRORS })
      const r = await publisher.publish(Object.assign({
        channelId: ctx.channelId,
        outBase,
        title: ctx.title,
        meta: ctx.meta,
        fsImpl: fs,
        cancelToken: cancel,
        host: adapters.host,
        spawnImpl: (opts) => spawnImpl({
          ...opts,
          registerKill: (fn) => episodeCancelRegistry.setKill(cancel, fn || undefined),
        }),
        // 超时只杀进程、不置 cancelled：置了就会把「等太久」在下一次采样读成「用户不要了」
        killImpl: () => { episodeCancelRegistry.killRunning(cancel) },
      }, ctx.extraInput))
      // 链结束时最后一条必须是终态边界（§6.4.2 口径③）。partial 的最后一站是
      // 「公网 feed 未更新」——如实标 skipped，既不得画成 done（谎称已上线），
      // 也不得因为没画完就说成失败（那会诱导用户删掉本地已登记的一期重来）。
      const trail = Array.isArray(r && r.phases) ? r.phases : []
      const last = trail.length ? String(trail[trail.length - 1].phase || '') : ''
      emitPhase(last, r && r.state === 'partial' ? 'skipped' : 'done', { message: (r && r.message) || '' })
      return r
    } catch (e) {
      // 取消不是失败：用户主动停止且已回滚，压成 failed 会诱导他删掉这一期重来
      const fTrail = Array.isArray((e && (e.publishPhases || e.phases))) ? (e.publishPhases || e.phases) : []
      const fLast = fTrail.length ? String(fTrail[fTrail.length - 1].phase || '') : PHASES[0]
      if (e && e.code === EPISODE_PUBLISH_ERRORS.CANCELLED) {
        emitPhase(fLast, 'cancelled')
        return {
          state: 'cancelled',
          phases: (e && (e.publishPhases || e.phases)) || [],
          audioUrl: '', episodeId: '', itemCount: 0, feedUrl: '',
          message: '已在上传前取消，临时文件已回滚', errorCode: '', errorMessage: '',
        }
      }
      // 失败也要留终态边界：否则界面会停在最后一个 start 上（视觉上等同卡死），
      // 而用户唯一能看到的诊断信息（卡在哪一站、什么码）此刻还只在信封里。
      emitPhase(fLast, 'failed', {
        subCode: (e && typeof e.code === 'string') ? e.code : ((e && e.subCode) || ''),
        errorCode: (e && typeof e.code === 'number') ? String(e.code) : '',
        message: (e && e.message) || '',
      })
      throw e
    } finally {
      // 抽取中途被 kill 会留下截断文件，而此刻编排层并不持有它——由本层统一收尾
      removeRunDir(runDir, fs, log)
      episodeCancelRegistry.end(ctx.runId)
      registry.endPublish(ctx.channelId)
    }
  }

  /** meta 白名单收口：非白名单键只出声、不落盘。两种来源共用。 */
  function pickMeta (rawMeta, label) {
    const src = rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta) ? rawMeta : {}
    const dropped = Object.keys(src).filter((k) => !META_ALLOWLIST.includes(k))
    if (dropped.length) log.warn('[podcast-host] ' + label + ' meta 丢弃非白名单键 ' + dropped.length + ' 个（不静默落盘）')
    const meta = {}
    for (const k of META_ALLOWLIST) if (k in src) meta[k] = src[k]
    return meta
  }

  async function publishFromVideo (payload = {}, opts = {}) {
    // 进度发射器由 IPC 注册点按**每次调用**注入（发送目标是这一次调用的 sender）。
    // 不在宿主里缓存它：缓存等于把「谁订阅」变成进程级状态，多窗口下会互相串台。
    const emitProgress = opts && typeof opts.emitProgress === 'function' ? opts.emitProgress : null
    const p = payload && typeof payload === 'object' ? payload : {}
    // ① 入参形状层：缺任一必填即拒，且发生在任何出站与任何磁盘写之前。
    const channelId = String(p.channelId || '').trim()
    if (!channelId) throw hostErr(HOST_ERRORS.INVALID, '出期必须指定频道')
    const runId = String(p.runId || '').trim()
    if (!RUN_ID_RE.test(runId)) {
      throw hostErr(CANCEL_ERRORS.RUN_ID_INVALID, '发起出期必须带形态合法的 runId（8–64 位，它同时是临时目录名）')
    }
    const project = p.project
    if (!project || typeof project !== 'object' || !Array.isArray(project.segments)) {
      throw hostErr(HOST_ERRORS.INVALID, '缺少项目数据（segments[] 是降级判定的唯一来源，缺它等于没有音轨来源，不许猜）')
    }
    const videoPath = String(p.videoPath || '')
    if (!videoPath) throw hostErr(HOST_ERRORS.VIDEO_MISSING, '缺少成片路径')
    const title = String(p.title || '')
    if (!title.trim()) throw hostErr(HOST_ERRORS.INVALID, '单集标题不能为空')
    // 码点而不是 UTF-16 单元：emoji 与扩展平面汉字按单元计数会少算，判据就成了假门禁
    if (Array.from(title).length > TITLE_MAX_CODEPOINTS) {
      throw hostErr(HOST_ERRORS.INVALID, '单集标题不得超过 ' + TITLE_MAX_CODEPOINTS + ' 码点')
    }
    const meta = pickMeta(p.meta, 'publishFromVideo')

    return runChain({
      channelId, runId, title, meta, emitProgress,
      reason: 'episode:publishFromVideo',
      extractImpl: extractEpisodeAudio,
      prepare: ({ fs, runDir, hostErr, HOST_ERRORS: H }) => {
        if (!fs.existsSync(videoPath)) throw hostErr(H.VIDEO_MISSING, '找不到成片文件，请回结果页重新生成或重选路径')
        if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true })
      },
      extraInput: {
        project, videoPath,
        ffmpegPath: typeof deps.findFfmpeg === 'function' ? deps.findFfmpeg() : null,
        ffprobePath: typeof deps.findFfprobe === 'function' ? deps.findFfprobe() : null,
      },
    })
  }

  /**
   * 文本出期（tasks 4.3 / PRD §7.4.9 的下游）：口播稿 → 分块 TTS → 同一条链的 probe 及之后。
   *
   * 三条口径：
   * 1. **计费同意闸门排在内容判据之前**，且只认显式 `true`（缺字段、字符串 'true'、
   *    渲染层传来的 truthy 对象都不算同意）。这是花钱的开关，默认值必须是拒绝。
   * 2. 正文/标题/runId/音色三段的判据**只有 `podcast-tts-compose` 一份实现**，
   *    本宿主直接转发它的 `code` 与 `issues`，不在此处重写长度或形态规则。
   * 3. 三个合成实现（generateTTS / concatBlocks / probeImpl）必须由生产接线点注入，
   *    缺一即拒——退化成「换成视频链」或静默起真出站都是错的。
   */
  async function publishFromScript (payload = {}, opts = {}) {
    const emitProgress = opts && typeof opts.emitProgress === 'function' ? opts.emitProgress : null
    const p = payload && typeof payload === 'object' ? payload : {}
    if (p.billingConfirmed !== true) {
      throw hostErr(HOST_ERRORS.BILLING_UNCONFIRMED, '文本出期会逐块调用 TTS 服务商并产生计费，请先确认用量与费用')
    }
    const plan = validateComposeInput(p)
    if (!plan.ok) {
      throw hostErr(plan.code, (plan.issues && plan.issues[0] && plan.issues[0].message) || '文本出期入参不合法', {
        issues: plan.issues || [],
      })
    }
    if (typeof deps.generateTTS !== 'function' || typeof deps.concatBlocks !== 'function' || typeof deps.probeImpl !== 'function') {
      throw hostErr(HOST_ERRORS.INVALID, '文本出期必须注入 generateTTS / concatBlocks / probeImpl 三个实现（宿主不代替接线点猜默认）')
    }
    const meta = pickMeta(p.meta, 'publishFromScript')
    const voiceRef = p.voiceRef && typeof p.voiceRef === 'object' ? p.voiceRef : null
    const gapSec = p.gapSec == null ? undefined : p.gapSec

    return runChain({
      channelId: plan.channelId, runId: plan.runId, title: plan.title, meta, emitProgress,
      reason: 'episode:publishFromScript',
      extractImpl: (input) => synthesizeEpisodeAudio(Object.assign({}, input, {
        chunks: plan.chunks, voiceRef, gapSec, logger: log,
        generateTTS: deps.generateTTS, concatBlocks: deps.concatBlocks, probeImpl: deps.probeImpl,
      })),
      prepare: ({ fs, runDir }) => {
        if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true })
      },
      extraInput: { copy: p.copy, content: String((p.copy && p.copy.content) || '') },
    })
  }

  function cancelPublish (runId) { return episodeCancelRegistry.requestCancel(runId) }

  return { publishFromVideo, publishFromScript, cancelPublish, HOST_ERRORS, META_ALLOWLIST }
}

/** 只删本 run 目录里**列出来的**文件再删目录本身；绝不递归到父级（目录名由 runId 决定）。 */
function removeRunDir (dir, fs, log) {
  try {
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      try { fs.unlinkSync(path.join(dir, name)) } catch (e) {
        log.warn('[podcast-host] 临时文件未清理：' + name)
      }
    }
    try { fs.rmdirSync(dir) } catch (e) { /* 目录非空就留着，不升级为递归删 */ }
  } catch (e) {
    log.warn('[podcast-host] 临时目录读取失败：' + ((e && e.message) || String(e)))
  }
}

module.exports = { createEpisodeHost, HOST_ERRORS, META_ALLOWLIST, TITLE_MAX_CODEPOINTS, removeRunDir }
