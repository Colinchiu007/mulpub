'use strict'

/**
 * podcast-episode-publish.js — 成片 → 播客一期 的主进程编排（刀 3 步骤 4–6）
 *
 * 为什么把编排放主进程而不是渲染层：这条链要跨 await 依次持有「抽取出的临时文件、
 * 对象存储的一次 PUT、episodes.json 的一次读改写、feed.xml 的一次重建」。渲染层一旦
 * 被关闭/刷新，中间态就没人负责收尾；而 `feedSync` 与 `PODCAST_CHANNEL_BUSY` 的互斥语义
 * 只在主进程有唯一实现（刀 1/刀 2 的既有口径），在渲染层另搭一套必然漂移。
 *
 * 相位是**闭集**（PRD §8 结构锁⑪：改枚举必须与逐格结果态测试同 PR）：
 *   pickChannel → extractMix → probe → uploadAudio → attach → buildFeed → uploadFeed
 * 外加 `cancelled`。**取消只在 `uploadAudio` 之前允许**：那之前零出站零计费，回滚只是删临时文件；
 * 之后取消会留下「对象存储有、feed 没有」的半态，那比不取消更糟，所以界面必须给出理由而不是静默接受。
 *
 * 依赖全注入（uploadImpl / episodeSink / feedSink / extractImpl），因此：
 * - 测试不起真进程、不真出站（本仓零真实出站纪律）；
 * - 上传层的三处一致校验（stat == ffprobe == putObject 返回 size）在这里收口：
 *   `putObject` 回来的字节与实测不符即**不挂这一期**——公网 feed 引用一个尺寸错的文件，
 *   订阅端会长期表现为「下载卡在 99%」，而本地一切看起来都成功。
 */

const PHASES = Object.freeze([
  'pickChannel', 'extractMix', 'probe', 'uploadAudio', 'attach', 'buildFeed', 'uploadFeed',
])
const CANCELABLE_UNTIL = 'uploadAudio'
const EPISODE_PUBLISH_ERRORS = {
  NO_CHANNEL: 'PODCAST_CHANNEL_ID_REQUIRED',
  NOT_CONFIGURED: 'PODCAST_HOSTING_REQUIRED',
  UPLOAD_FAILED: 'PODCAST_HOSTING_UPLOAD_FAILED',
  SIZE_MISMATCH: 'PODCAST_AUDIO_SIZE_MISMATCH',
  ATTACH_REJECTED: 'PODCAST_EPISODE_INVALID',
  CANCELLED: 'PODCAST_PUBLISH_CANCELLED',
  LATE_CANCEL: 'PODCAST_CANCEL_TOO_LATE',
}

function pubErr (code, message, extra) {
  const e = new Error(code + ': ' + message)
  e.code = code
  if (extra) Object.assign(e, extra)
  return e
}

function createEpisodePublisher (deps = {}) {
  const {
    extractEpisodeAudio, assertUploadSizeMatches,
    uploadImpl, episodeSink, feedSink, channelGate, logger,
  } = deps
  const log = logger || { info () {}, warn () {}, error () {} }
  if (typeof extractEpisodeAudio !== 'function' || typeof uploadImpl !== 'function'
    || typeof episodeSink !== 'function' || typeof feedSink !== 'function') {
    throw pubErr('PODCAST_EPISODE_INVALID', '编排必须注入 extract/upload/episode/feed 四个实现（缺一个都不许默认发真实出站）')
  }

  /**
   * @param {{channelId:string, project:object, videoPath:string, outBase:string,
   *          title:string, meta:object, cancelToken?:{cancelled:boolean},
   *          host?:{assertConfigured?:Function}}} input
   */
  async function publish (input = {}) {
    const channelId = String(input.channelId || '').trim()
    if (!channelId) throw pubErr(EPISODE_PUBLISH_ERRORS.NO_CHANNEL, '出期必须指定频道（对象 key 含 channelId，缺它等于把两期写进同一层）')
    const phases = []
    const mark = (phase, extra) => { phases.push(Object.assign({ phase }, extra || {})); return phase }
    const cancelled = () => Boolean(input.cancelToken && input.cancelToken.cancelled === true)

    mark('pickChannel')
    if (channelGate && typeof channelGate.assertWritable === 'function') channelGate.assertWritable(channelId)
    if (input.host && typeof input.host.assertConfigured === 'function') input.host.assertConfigured()

    // 1) 抽混音（内含降级判定与编码器实测；一切拒绝都在任何出站之前）
    mark('extractMix')
    const mixed = await extractEpisodeAudio(input)
    mark('probe', { durationSec: mixed.durationSec, sizeBytes: mixed.sizeBytes, mime: mixed.mime })

    // 2) 取消窗口关闭点：uploadAudio 一旦开始就不许再取消（见文件头理由）
    if (cancelled()) {
      cleanup(input, mixed)
      mark('cancelled')
      throw pubErr(EPISODE_PUBLISH_ERRORS.CANCELLED, '已在上传前取消，临时文件已回滚', { phases })
    }

    mark('uploadAudio')
    let uploaded
    try {
      uploaded = await uploadImpl({ channelId, filePath: mixed.outPath, mime: mixed.mime })
    } catch (e) {
      cleanup(input, mixed)
      e.publishPhases = phases
      throw e
    }
    // 三处一致校验的第三处：上传回来的字节必须等于本地实测
    try {
      assertUploadSizeMatches(mixed.sizeBytes, uploaded && uploaded.size)
    } catch (e) {
      log.warn('[podcast-publish] 上传字节与实测不符，不挂这一期：audio ' + channelId)
      cleanup(input, mixed)
      e.publishPhases = phases
      throw e
    }
    // 只认 https：RSS 与各家聚合端都把非加密直链判为混合内容或干脆不抓，
    // 而"能点开"不等于"能订阅"，这里放宽一次就会在几周后变成"某期永远播不出来"。
    if (!uploaded || typeof uploaded.url !== 'string' || !/^https:\/\//i.test(uploaded.url)) {
      cleanup(input, mixed)
      throw pubErr(EPISODE_PUBLISH_ERRORS.UPLOAD_FAILED, '上传未返回可公网访问的 https 地址，不挂这一期', { phases })
    }

    mark('attach')
    const episode = Object.assign({}, input.meta || {}, {
      title: String(input.title || ''),
      audioUrl: uploaded.url,
      durationSec: mixed.durationSec,
      sizeBytes: mixed.sizeBytes,
      mime: mixed.mime,
    })
    const attached = await episodeSink(channelId, episode)

    mark('buildFeed')
    const built = await feedSink(channelId)

    mark('uploadFeed')
    const feedRes = await uploadImpl({ channelId, filePath: built.path, kind: 'feed' }).catch((e) => {
      // feed 上传失败是 partial：本地这一期已挂上，公网 feed 未更新——必须如实分层，
      // 压成 failed 会诱导用户删掉这一期重来（而这一期本地是对的）。
      log.warn('[podcast-publish] 公网 feed 未更新：' + ((e && e.code) || (e && e.message) || String(e)))
      return { partial: true, error: e }
    })

    const partial = !feedRes || feedRes.partial === true
    if (!partial) cleanup(input, mixed)
    return {
      state: partial ? 'partial' : 'success',
      phases,
      audioUrl: uploaded.url,
      episodeId: attached && attached.id,
      itemCount: built && built.itemCount,
      feedUrl: partial ? '' : feedRes.url,
      message: partial ? '这一期已登记到本地频道，公网 feed 尚未更新' : '',
    }
  }

  function cleanup (input, mixed) {
    const fs = input.fsImpl || require('fs')
    const p = mixed && mixed.outPath
    if (!p) return
    try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch (e) {
      // 临时文件删不掉不掩盖主结论：只出声，让用户知道磁盘上留了一份
      log.warn('[podcast-publish] 临时音频未能清理：' + ((e && e.message) || String(e)))
    }
  }

  /** 取消是否还来得及（渲染层据此决定按钮是否可点，而不是点完才报错）。 */
  function cancellableAt (phase) {
    const idx = PHASES.indexOf(phase)
    const stop = PHASES.indexOf(CANCELABLE_UNTIL)
    return idx >= 0 && idx < stop
  }

  return { publish, cancellableAt, PHASES, EPISODE_PUBLISH_ERRORS }
}

module.exports = { createEpisodePublisher, PHASES, CANCELABLE_UNTIL, EPISODE_PUBLISH_ERRORS }
