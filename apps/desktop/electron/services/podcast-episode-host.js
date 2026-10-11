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

const HOST_ERRORS = {
  VIDEO_MISSING: 'PODCAST_VIDEO_NOT_FOUND',
  INVALID: 'PODCAST_EPISODE_INVALID',
  BUSY: 'PODCAST_CHANNEL_BUSY',
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

  async function publishFromVideo (payload = {}) {
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
    const rawMeta = p.meta && typeof p.meta === 'object' && !Array.isArray(p.meta) ? p.meta : {}
    const dropped = Object.keys(rawMeta).filter((k) => !META_ALLOWLIST.includes(k))
    if (dropped.length) log.warn('[podcast-host] meta 丢弃非白名单键 ' + dropped.length + ' 个（不静默落盘）')
    const meta = {}
    for (const k of META_ALLOWLIST) if (k in rawMeta) meta[k] = rawMeta[k]

    // 持锁凭证：runId 已经过形态判定，所以它能安全地作为「谁持有这把锁」的比对值。
    // publishFeed 只认这个凭证，不接受调用方声明「我已经持锁」——那等于任何人都能绕过忙标记。
    const lockToken = 'ep-' + runId
    // 适配层与编排层的构造都没有副作用（不发请求、不落盘），所以先把它们建好，
    // 再用编排层的**同一个**窗口判据去登记取消——判据只许有一处实现，
    // 在宿主里另写「哪些相位可取消」就是给下一次改枚举留一条漂移路径。
    const adapters = createEpisodeAdapters({
      channelServiceOf: deps.channelServiceOf,
      hostingService: deps.hostingService,
      // 复用同一次持锁：feed 步的 publishFeed 自带取锁，必须认得「锁已在链上」才不会被自己挡住
      heldBy: lockToken,
      logger: log,
    })
    const publisher = createEpisodePublisher({
      extractEpisodeAudio, assertUploadSizeMatches,
      uploadImpl: adapters.uploadImpl,
      episodeSink: adapters.episodeSink,
      feedSink: adapters.feedSink,
      channelGate: adapters.channelGate,
      logger: log,
    })
    // ③ 取消登记先于取锁：token 是主进程侧的活引用，编排层改的就是它（见 cancel 模块头）。
    const cancel = episodeCancelRegistry.begin(runId, { cancellableAt: publisher.cancellableAt, initialPhase: PHASES[0] })

    // ② 忙标记：整条链一份，立即拒绝不排队。
    if (!registry.tryBeginPublish(channelId, { reason: 'episode:publishFromVideo', token: lockToken })) {
      episodeCancelRegistry.end(runId)
      throw hostErr(HOST_ERRORS.BUSY, '该频道有一次发布正在进行，请等它结束', { channelId })
    }
    // 临时目录基名由主进程算：渲染层永远拿不到「写哪里」的决定权
    const tmpRoot = deps.tmpRoot || path.join(os.tmpdir(), 'mulpub-podcast')
    const runDir = path.join(tmpRoot, 'episode-' + runId)
    const outBase = path.join(runDir, 'episode')
    try {
      if (!fs.existsSync(videoPath)) throw hostErr(HOST_ERRORS.VIDEO_MISSING, '找不到成片文件，请回结果页重新生成或重选路径')
      if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true })
      const ffmpegPath = typeof deps.findFfmpeg === 'function' ? deps.findFfmpeg() : null
      const ffprobePath = typeof deps.findFfprobe === 'function' ? deps.findFfprobe() : null
      const input = {
        channelId, project, videoPath, outBase, title, meta,
        ffmpegPath, ffprobePath, fsImpl: fs,
        cancelToken: cancel,
        host: adapters.host,
        spawnImpl: (opts) => spawnImpl({
          ...opts,
          registerKill: (fn) => episodeCancelRegistry.setKill(cancel, fn || undefined),
        }),
        // 超时只杀进程、不置 cancelled：置了就会把「等太久」在下一次采样读成「用户不要了」
        killImpl: () => { episodeCancelRegistry.killRunning(cancel) },
      }
      return await publisher.publish(input)
    } catch (e) {
      // 取消不是失败：用户主动停止且已回滚，压成 failed 会诱导他删掉这一期重来
      if (e && e.code === EPISODE_PUBLISH_ERRORS.CANCELLED) {
        return {
          state: 'cancelled',
          phases: (e && (e.publishPhases || e.phases)) || [],
          audioUrl: '', episodeId: '', itemCount: 0, feedUrl: '',
          message: '已在上传前取消，临时文件已回滚', errorCode: '', errorMessage: '',
        }
      }
      throw e
    } finally {
      // 抽取中途被 kill 会留下截断文件，而此刻编排层并不持有它——由本层统一收尾
      removeRunDir(runDir, fs, log)
      episodeCancelRegistry.end(runId)
      registry.endPublish(channelId)
    }
  }

  function cancelPublish (runId) { return episodeCancelRegistry.requestCancel(runId) }

  return { publishFromVideo, cancelPublish, HOST_ERRORS, META_ALLOWLIST }
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
