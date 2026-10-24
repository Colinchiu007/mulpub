// @ts-check
'use strict'
/**
 * model-provider-video-capabilities.js — 视频生成能力描述（渲染层按能力渲染 UI）
 *
 * ## 判据落在「模型的能力属性」上
 *
 * 能力由**模型**决定，不由「providerId 名单」决定：
 * `describeVideoModel(model)` 对已知模型返回其能力描述，对未知模型返回**保守回落**
 * （`id` 为空）。因此：
 *   - model = 'agnes-video-2.5-flash' ⇒ 三模式 + 720P + 参考图≤5 + 不支持参考视频
 *   - model = 'agnes-video-2.5'        ⇒ 三模式 + 四档分辨率 + 参考图≤8 + 支持参考视频
 *   - model = 其它（kling / veo / …）  ⇒ 保守默认：**只支持文生视频**
 *
 * 为什么不用「providerId 名单」：名单判据对新增对象默认不成立——将来再做一个讲同一套协议的
 * 适配器（或换用同一批模型），若判据是名单，就必须记得去改这张名单。改成模型属性后，
 * 只要模型被能力表收录即自动生效。
 *
 * 非 Agnes 协议一律返回**保守默认** ⇒ 渲染层不会出现「给了参考图、适配器根本不认」的错位。
 *
 * ## 为什么不放在 model-provider-manager.js 里
 *
 * `model-provider-manager.js` 在「点名还账」清单里（target=1284、**容差 0**），main 上正好
 * 1284 行 ⇒ **任何净增长都会让主干变红、全仓 PR 被挡**。本模块让 manager 保持净零增长。
 */

const { describeVideoModel } = require('./adapters/agnes-video-models')

/** 非已知模型时的保守默认：只支持文生视频 */
const FALLBACK_CAPABILITIES = Object.freeze({
  protocol: 'generic',
  modes: Object.freeze(['text']),
  sizes: Object.freeze([]),
  defaultSize: '',
  maxImages: 0,
  maxAudios: 0,
  maxVideos: 0,
  supportsReferenceVideo: false,
  aspectRatios: Object.freeze([]),
})

/**
 * 取视频生成能力描述。
 *
 * @param {string} [model] - 当前视频 provider 的默认模型 ID
 * @returns {{protocol: string, modes: string[], sizes: string[], defaultSize: string, maxImages: number, maxAudios: number, maxVideos: number, supportsReferenceVideo: boolean, aspectRatios: string[]}}
 */
function describeVideoCapabilities (model) {
  const spec = describeVideoModel(model || '')
  // 未知模型 ⇒ 能力描述的 id 为空 ⇒ 保守回落
  if (!spec.id) return { ...FALLBACK_CAPABILITIES }
  return {
    protocol: spec.id,
    modes: ['text', 'keyframe', 'reference'],
    sizes: spec.sizes.slice(),
    defaultSize: spec.defaultSize,
    maxImages: spec.maxImages,
    maxAudios: spec.maxAudios,
    maxVideos: spec.maxVideos,
    supportsReferenceVideo: spec.supportsReferenceVideo,
    aspectRatios: spec.aspectRatios.slice(),
    // 计费口径（¥/秒，按分辨率档位）：渲染层据此显示预计成本——
    // 参考视频的秒数与输出秒数**相加计费**，不显示会让用户意外多付。
    prices: currentPrices(spec),
    listPrices: { ...spec.listPrices },
  }
}

/**
 * 各档位的**现行价**（¥/秒）；未列出的档位按列表价。
 * @param {object} spec
 * @returns {Record<string, number>}
 */
function currentPrices (spec) {
  const out = {}
  for (const tier of spec.sizes) {
    const current = Number(spec.currentPrices[tier])
    const list = Number(spec.listPrices[tier])
    out[tier] = Number.isFinite(current) ? current : (Number.isFinite(list) ? list : 0)
  }
  return out
}

module.exports = {
  describeVideoCapabilities,
  FALLBACK_CAPABILITIES,
}
