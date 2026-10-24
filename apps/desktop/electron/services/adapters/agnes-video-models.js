// @ts-check
'use strict'
/**
 * agnes-video-models.js — Agnes 视频模型能力描述（单一真源）
 *
 * 为什么要有这个文件：Agnes Video 2.5 系列的两个模型在**五个维度**上不同
 * （分辨率档位 / 参考图上限 / 参考音频上限 / 参考视频支持与否 / 输出像素）。
 * 若在 UI、IPC、适配器三处各写一遍 `modelId === 'agnes-video-2.5-flash'`，
 * 就会出现「三处不同步 ⇒ 某个模型多传了服务端拒收的字段 ⇒ 每次白跑一次 400」。
 * 因此把「模型能做什么」收敛成一张**能力描述表**，三方都从这里读。
 *
 * 数据来源（官方文档，2026-10-23 核对）：
 *   - Agnes Video 2.5 Flash  https://agnes-ai.com/zh-Hans/docs/agnes-video-25-flash
 *   - Agnes Video 2.5        https://agnes-ai.com/zh-Hans/docs/agnes-video-25
 *
 * 关键事实（易踩）：
 *   - Flash 的 size **固定** "720P"，其它值服务端返回 400 `size must be 720P`。
 *   - Flash 的 16:9 实际成片是 **1280x704**（不是 1280x720）——
 *     官方文档表格与「以实际生成文件为准」两处都指向 1280x704。
 *   - Flash **不支持参考视频**（`videos` 非空 → 400 `videos is not supported`）。
 *   - `n` 恒为 1（两个模型都不支持批量）。
 *
 * 未知模型一律**保守回落**（fail-closed）：取 Flash 的最严能力集。
 * 宁可在客户端拒收一个配错的模型，也不发一个必然 400 的请求。
 */

/** 合法画幅（两个模型一致） */
const AGNES_VIDEO_ASPECT_RATIOS = Object.freeze(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])

/**
 * 720P 档位的输出像素（官方文档「视频尺寸与画幅」）。
 * Flash 的 16:9 是 1280x704；标准 2.5 的 16:9 是 1280x720 —— **两者不同**，勿混用。
 */
const AGNES_VIDEO_PIXELS_720P = Object.freeze({
  '21:9': '1680x720',
  '16:9': '1280x704',
  '4:3': '960x720',
  '1:1': '720x720',
  '3:4': '720x960',
  '9:16': '720x1280',
})

/** 标准 2.5 的 1080P 档位输出像素 */
const AGNES_VIDEO_PIXELS_1080P = Object.freeze({
  '21:9': '2206x946',
  '16:9': '1920x1080',
  '4:3': '1664x1248',
  '1:1': '1440x1440',
  '3:4': '1248x1664',
  '9:16': '1080x1920',
})

/**
 * @typedef {object} AgnesVideoModelSpec
 * @property {string} id            模型 ID
 * @property {string} name          展示名
 * @property {string} description   能力摘要
 * @property {readonly string[]} sizes          支持的分辨率档位
 * @property {string} defaultSize   默认分辨率档位
 * @property {number} maxImages     参考图数量上限
 * @property {number} maxAudios     参考音频段数上限
 * @property {number} maxVideos     参考视频个数上限（0 = 不支持）
 * @property {boolean} supportsReferenceVideo  是否支持参考视频
 * @property {readonly string[]} aspectRatios   合法画幅
 */

/** @type {Readonly<Record<string, AgnesVideoModelSpec>>} */
const AGNES_VIDEO_MODELS = Object.freeze({
  'agnes-video-2.5-flash': Object.freeze({
    id: 'agnes-video-2.5-flash',
    name: 'Agnes Video 2.5 Flash',
    description: '视频生成（720P 固定；参考图 ≤5、参考音频 ≤3；不支持参考视频）',
    sizes: Object.freeze(['720P']),
    defaultSize: '720P',
    maxImages: 5,
    maxAudios: 3,
    maxVideos: 0,
    supportsReferenceVideo: false,
    aspectRatios: AGNES_VIDEO_ASPECT_RATIOS,
  }),
  'agnes-video-2.5': Object.freeze({
    id: 'agnes-video-2.5',
    name: 'Agnes Video 2.5',
    description: '视频生成（720P/1080P/1K/2K；参考图 ≤8、参考音频 ≤3、参考视频 ≤1）',
    sizes: Object.freeze(['720P', '1080P', '1K', '2K']),
    defaultSize: '720P',
    maxImages: 8,
    maxAudios: 3,
    maxVideos: 1,
    supportsReferenceVideo: true,
    aspectRatios: AGNES_VIDEO_ASPECT_RATIOS,
  }),
})

/**
 * 未知模型的保守回落能力集（取 Flash 的最严约束）。
 * @type {AgnesVideoModelSpec}
 */
const FALLBACK_VIDEO_MODEL_SPEC = Object.freeze({
  id: '',
  name: 'Agnes Video',
  description: '未识别的模型，按最严约束处理（720P / 参考图 ≤5 / 参考音频 ≤3 / 不支持参考视频）',
  sizes: Object.freeze(['720P']),
  defaultSize: '720P',
  maxImages: 5,
  maxAudios: 3,
  maxVideos: 0,
  supportsReferenceVideo: false,
  aspectRatios: AGNES_VIDEO_ASPECT_RATIOS,
})

/**
 * 取模型能力描述。未知模型返回保守回落描述。
 * @param {unknown} modelId
 * @returns {AgnesVideoModelSpec}
 */
function describeVideoModel (modelId) {
  const key = typeof modelId === 'string' ? modelId.trim() : ''
  return Object.prototype.hasOwnProperty.call(AGNES_VIDEO_MODELS, key)
    ? AGNES_VIDEO_MODELS[key]
    : FALLBACK_VIDEO_MODEL_SPEC
}

/**
 * 该模型 ID 是否是已知模型（未知 ⇒ 保守回落）。
 * @param {unknown} modelId
 * @returns {boolean}
 */
function isKnownVideoModel (modelId) {
  const key = typeof modelId === 'string' ? modelId.trim() : ''
  return Object.prototype.hasOwnProperty.call(AGNES_VIDEO_MODELS, key)
}

/**
 * 列出已知模型（供模型设置页与 UI 使用）。
 * @returns {{ id: string, name: string, description: string }[]}
 */
function listVideoModels () {
  return Object.values(AGNES_VIDEO_MODELS).map((m) => ({ id: m.id, name: m.name, description: m.description }))
}

/**
 * 取某档位 + 某画幅的输出像素（仅 720P / 1080P 有精确映射；1K 固定 1024x1024；2K 为 720P 的 2 倍）。
 * 官方明确「16:9 的输出尺寸以实际生成文件为准」⇒ 本函数仅用于**展示预期**，不作为判据。
 * @param {string} modelId
 * @param {string} size
 * @param {string} aspectRatio
 * @returns {string}
 */
function outputPixelsFor (modelId, size, aspectRatio) {
  const spec = describeVideoModel(modelId)
  const tier = spec.sizes.includes(size) ? size : spec.defaultSize
  const ratio = spec.aspectRatios.includes(aspectRatio) ? aspectRatio : '16:9'
  if (tier === '1K') return '1024x1024'
  if (tier === '2K') {
    const base = AGNES_VIDEO_PIXELS_720P[ratio]
    if (!base) return ''
    const [w, h] = base.split('x').map((n) => Number.parseInt(n, 10))
    return `${w * 2}x${h * 2}`
  }
  if (tier === '1080P') return AGNES_VIDEO_PIXELS_1080P[ratio] || ''
  return AGNES_VIDEO_PIXELS_720P[ratio] || ''
}

module.exports = {
  AGNES_VIDEO_MODELS,
  AGNES_VIDEO_ASPECT_RATIOS,
  FALLBACK_VIDEO_MODEL_SPEC,
  describeVideoModel,
  isKnownVideoModel,
  listVideoModels,
  outputPixelsFor,
}
