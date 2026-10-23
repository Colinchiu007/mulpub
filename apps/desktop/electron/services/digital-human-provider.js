// @ts-check
/**
 * digital-human-provider.js — 数字人 provider 的能力解析（单一真源）
 *
 * 存在理由（change: digital-human-multiprovider）：
 * provider 名此前在**两处硬编码**（digital-human-stages.js 与
 * pipeline-model-preflight.js 各写一份 `DIGITAL_HUMAN_PROVIDER = 'heygen'`），
 * 导致：① 用户无法切换服务商；② 加第三家要改多处；③ 两处容易漂移。
 *
 * 本模块把「谁是数字人 provider」收敛成一个函数，两处都调它。
 *
 * 设计取舍：
 *  - 用 **capability** 而非新 category：仓内已有 capabilities 机制
 *    （minimax-multimodal 在用），新 category 会牵动 model-provider 全链路；
 *  - 优先级「显式覆盖 > 唯一命中 > 模型设置默认」：显式覆盖保留人工指向
 *    其他数字人服务的口子（原 resolveDigitalHumanProvider 已有此语义）；
 *  - 一家都没配时返回 null（fail closed），**不回落 getDefault('video')** ——
 *    那会拿到通用文生视频模型，把数字人流水线跑成普通文生视频。
 */
'use strict'

/** 数字人能力标识（与 model_providers.capabilities 的取值对齐） */
const DIGITAL_HUMAN_CAPABILITY = 'digital_human'

/** 声明了数字人能力的 provider 列表（按 id 排序，避免对象顺序漂移） */
function listDigitalHumanProviders (manager) {
  if (!manager || typeof manager.listProviders !== 'function') return []
  let providers
  try {
    providers = manager.listProviders()
  } catch (_) {
    return []
  }
  if (!Array.isArray(providers)) return []
  return providers
    .filter((p) => p && typeof p.id === 'string' && p.id.trim())
    .filter((p) => Array.isArray(p.capabilities) && p.capabilities.includes(DIGITAL_HUMAN_CAPABILITY))
    .map((p) => ({ ...p, id: p.id.trim() }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * 解析当前应使用的数字人 provider id。
 *
 * @param {object} manager modelProviderManager
 * @param {{videoProvider?: string}} [params] 允许显式覆盖
 * @returns {string|null} 解析不到返回 null（调用方 fail closed）
 */
function resolveDigitalHumanProviderId (manager, params) {
  const override = typeof params === 'object' && params !== null && typeof params.videoProvider === 'string'
    ? params.videoProvider.trim()
    : ''
  if (override) return override

  const candidates = listDigitalHumanProviders(manager)
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0].id

  // 多家：取模型设置里 video 能力的默认 provider（若它恰好是数字人）
  const defaultId = manager && typeof manager.getDefault === 'function'
    ? (() => {
      try {
        const def = manager.getDefault('video')
        return def && typeof def.id === 'string' ? def.id.trim() : ''
      } catch (_) { return '' }
    })()
    : ''
  if (defaultId && candidates.some((p) => p.id === defaultId)) return defaultId

  // 默认 provider 不是数字人：取排序后第一家（稳定，不随机）
  return candidates[0].id
}

module.exports = {
  DIGITAL_HUMAN_CAPABILITY,
  listDigitalHumanProviders,
  resolveDigitalHumanProviderId,
}
