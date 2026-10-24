// @ts-check
'use strict'
/**
 * agnes-video-request.js — Agnes 视频请求体的构造与本地预校验
 *
 * ## 为什么从适配器里抽出来
 *
 * `agnes-multimodal.js` 原本 420 行，加能力驱动的校验后逼近 500 行的「新增超大文件」门禁
 * （`.github/scripts/check-max-lines.js` 的 NEW_OVER_LIMIT）。请求体构造是**纯函数**、
 * 可独立测试的部分，抽出后适配器只留「发请求 + 处理重试」的职责。
 *
 * ## 为什么要有本地预校验
 *
 * Flash 的四条限制（size 固定 720P、images ≤5、audios ≤3、不支持 videos）在服务端是
 * **创建任务前**就拒绝的 400 —— 不计费，但每次都要浪费一次往返。客户端按**模型能力描述**
 * 预校验，把「必然 400」挡在本地；判据来自 `agnes-video-models.js`（单一真源），
 * 不在此处另抄一份模型名单。
 */

const { describeVideoModel } = require('./agnes-video-models')

/** 合法画幅（与能力描述一致；用于本地校验服务端会拒的取值） */
const VALID_ASPECT_RATIOS = Object.freeze(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])

/** 时长范围（官方要求字符串 "4"–"12"） */
const SECONDS_MIN = 4
const SECONDS_MAX = 12

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString (value) {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * 构造 Agnes Video 2.5 系列的请求体。
 *
 * @param {object} input
 * @param {object} input.params - 适配器收到的原始参数
 * @param {string} input.model - 模型 ID
 * @returns {{ body: Record<string, unknown> } | { error: string }}
 */
function buildAgnesVideoRequest (input) {
  const params = input.params || {}
  const model = input.model
  const spec = describeVideoModel(model)

  const hasImages = Array.isArray(params.images) && params.images.length > 0
  const hasAudios = Array.isArray(params.audios) && params.audios.length > 0
  const hasVideos = Array.isArray(params.videos) && params.videos.length > 0

  // 模式推导（与 shared-utils 的契约同源：帧 → keyframe，素材 → reference，其余 → text）
  let mode = params.mode
  if (!mode) {
    if (params.image || params.first_frame || params.last_frame) mode = 'keyframe'
    else if (hasImages || hasAudios || hasVideos) mode = 'reference'
    else mode = 'text'
  }

  // 分辨率档位：默认取模型默认档；显式指定但不被支持 ⇒ 本地拒收
  let size = spec.defaultSize
  if (isNonEmptyString(params.size)) {
    const requested = params.size.trim()
    if (!spec.sizes.includes(requested)) {
      return { error: `size must be one of ${spec.sizes.join(', ')} for model ${model}` }
    }
    size = requested
  }

  // 画幅：显式值优先（params.aspect_ratio || params.aspectRatio），否则由宽高推导
  // ⚠ 两个键名都要在：只认一个会让竖屏请求被静默丢弃、永远回退 16:9（见
  //   image-adapter-aspect-contract.test.js 的结构锁与配套行为锁）
  const explicitRatio = String(params.aspect_ratio || params.aspectRatio || '').trim()
  const aspectRatio = explicitRatio || pickAspectRatio(params.width, params.height)
  if (!VALID_ASPECT_RATIOS.includes(aspectRatio)) {
    return { error: `aspect_ratio must be one of ${VALID_ASPECT_RATIOS.join(', ')}` }
  }

  // 时长：显式值优先；越界 ⇒ 本地拒收（不静默夹取）
  let seconds
  if (params.seconds !== undefined && params.seconds !== null && params.seconds !== '') {
    const parsed = Number(params.seconds)
    if (!Number.isFinite(parsed) || parsed < SECONDS_MIN || parsed > SECONDS_MAX) {
      return { error: `seconds must be between ${SECONDS_MIN} and ${SECONDS_MAX}` }
    }
    seconds = String(Math.round(parsed))
  } else {
    seconds = pickSeconds(params.numFrames ?? params.num_frames, params.frameRate ?? params.frame_rate)
  }

  /** @type {Record<string, unknown>} */
  const body = {
    model,
    prompt: params.prompt,
    mode,
    size,
    aspect_ratio: aspectRatio,
    seconds,
    // seed=0 是合法随机种子，必须用 != null 判空而非 ||（避免 0 被静默丢弃）
    seed: params.seed != null ? params.seed : undefined,
  }

  if (mode === 'keyframe') {
    body.first_frame = params.first_frame || params.image || undefined
    body.last_frame = params.last_frame || undefined
    if (!body.first_frame && !body.last_frame) {
      return { error: 'keyframe mode requires first_frame or last_frame' }
    }
  } else if (mode === 'reference') {
    if (hasImages && params.images.length > spec.maxImages) {
      return { error: `images length must not exceed ${spec.maxImages}` }
    }
    if (hasAudios && params.audios.length > spec.maxAudios) {
      return { error: `audios length must not exceed ${spec.maxAudios}` }
    }
    if (hasVideos) {
      if (!spec.supportsReferenceVideo) {
        return { error: `videos is not supported by model ${model}` }
      }
      if (params.videos.length > spec.maxVideos) {
        return { error: `videos length must not exceed ${spec.maxVideos}` }
      }
      body.videos = params.videos
    }
    body.images = hasImages ? params.images : (params.image ? [params.image] : undefined)
    body.audios = hasAudios ? params.audios : undefined
    if (!body.images && !body.audios && !body.videos) {
      return { error: 'reference mode requires images or audios' }
    }
  }

  return { body }
}

/**
 * 从像素宽高推导最接近的支持画幅（对数距离最近），无有效宽高时默认 16:9
 * @param {number|string} [width]
 * @param {number|string} [height]
 * @returns {string}
 */
function pickAspectRatio (width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '16:9'
  const target = Math.log(w / h)
  let best = '16:9'
  let bestValue = 16 / 9
  let bestDiff = Infinity
  for (const ratio of VALID_ASPECT_RATIOS) {
    const value = ratio.split(':').map((n) => Number(n))
    const diff = Math.abs(Math.log(value[0] / value[1]) - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = ratio
      bestValue = value[0] / value[1]
    }
  }
  void bestValue
  return best
}

/**
 * 从帧数/帧率推导视频时长秒数（v2.5 Flash 要求字符串 "4"–"12"，默认 "5"）
 * @param {number|string} [numFrames]
 * @param {number|string} [frameRate]
 * @returns {string}
 */
function pickSeconds (numFrames, frameRate) {
  const frames = Number(numFrames)
  const rate = Number(frameRate)
  if (!Number.isFinite(frames) || !Number.isFinite(rate) || frames <= 0 || rate <= 0) return '5'
  const seconds = Math.round(frames / rate)
  return String(Math.min(SECONDS_MAX, Math.max(SECONDS_MIN, seconds)))
}

module.exports = {
  buildAgnesVideoRequest,
  pickAspectRatio,
  pickSeconds,
  VALID_ASPECT_RATIOS,
}
