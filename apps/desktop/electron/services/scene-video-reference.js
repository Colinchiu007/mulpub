// @ts-check
'use strict'
/**
 * scene-video-reference.js — 场景 AI 视频的参考图输入构造
 *
 * ## 落点（为什么是「视频任务编辑页」而不是主流水线）
 *
 * 主流水线里**视频先生成、图片只作失败回退**（`imageTargetCount = 场景数 - 视频场景数`
 * ⇒ 视频场景根本不生成图片），而且视频提交**早于**该分镜图片的生成请求
 * ⇒ 「用分镜图当视频参考」在主流水线里没有素材可用，要做就得改成「每个视频场景也先生成图、
 * 并让该段视频等这张图」——那是资产策略层面的重做（多出 V 次图片生成 + 阶段内串行化），
 * 与 2026-08-13「视频与图片/旁白并行启动」的吞吐优化直接冲突，**属产品决策，不在本模块范围**。
 *
 * 而「视频任务编辑页 → 生成 AI 视频」这条路径上，**该场景已选定的图片一定存在**
 * （用户挑过）⇒ 零额外图片生成、零串行化、零成本，直接把「人物/商品跨镜头保持一致」
 * 这个真实诉求接上。故本模块只服务这一条路径。
 *
 * ## 能力判据
 *
 * 按**模型的能力属性**决定用哪种模式（与 `agnes-video-models.js` 同一真源）：
 *   - 模型支持 `keyframe`   ⇒ 用首帧锁构图（`mode=keyframe` + `firstFrame`）
 *   - 模型支持 `reference`  ⇒ 用参考图（`mode=reference` + `images`）
 *   - 都不支持                ⇒ 纯文本生成（不传任何媒体）
 * 未声明支持的 provider 一律走纯文本（保守），**不猜**。
 */

const fs = require('fs')
const { resolveReadableMediaFile } = require('./story2video-paths')
const { describeVideoCapabilities } = require('./model-provider-video-capabilities')

/**
 * 参考图体积上限：Base64 编码后约膨胀 33%，上游单请求 <50MB ⇒ 单张 ≤5MB 留足余量。
 * 超过则**跳过参考**（该段仍走纯文本生成），不阻断。
 */
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * 构造场景 AI 视频的参考输入。
 *
 * @param {object} input
 * @param {string} [input.model] - provider 的默认模型 ID（用于能力判定）
 * @param {string} [input.imagePath] - 该场景已选定的图片本地路径
 * @param {string[]} [input.allowedRoots] - 允许读取的媒体根
 * @param {typeof fs} [input.fsImpl] - 便于测试注入
 * @returns {{ mode?: string, firstFrame?: string, images?: string[], reason?: string }}
 */
function buildSceneVideoReference (input) {
  const opts = input || {}
  const capabilities = describeVideoCapabilities(opts.model || '')

  // 能力不支持任何参考 ⇒ 纯文本生成（不猜、不试）
  if (!capabilities.modes.includes('keyframe') && !capabilities.modes.includes('reference')) {
    return { reason: 'provider-has-no-reference-support' }
  }
  if (typeof opts.imagePath !== 'string' || !opts.imagePath.trim()) {
    return { reason: 'no-scene-image' }
  }

  const fsImpl = opts.fsImpl || fs
  const resolved = resolveReadableMediaFile(opts.imagePath, {
    kind: 'image',
    allowedRoots: opts.allowedRoots,
    maxBytes: MAX_REFERENCE_IMAGE_BYTES,
  })
  if (!resolved) {
    return { reason: 'image-not-readable-or-out-of-root' }
  }

  let buffer
  try {
    buffer = fsImpl.readFileSync(resolved)
  } catch (_) {
    return { reason: 'image-read-failed' }
  }
  if (!buffer || !buffer.length) return { reason: 'image-empty' }

  const mime = sniffImageMime(buffer)
  if (!mime) return { reason: 'image-type-unsupported' }

  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`

  if (capabilities.modes.includes('keyframe')) {
    return { mode: 'keyframe', firstFrame: dataUrl, reason: 'keyframe-from-scene-image' }
  }
  return { mode: 'reference', images: [dataUrl], reason: 'reference-from-scene-image' }
}

/**
 * 魔数嗅探图片类型（只信内容，不信扩展名）——与 film-engineering 的 reference-store 同口径。
 * @param {Buffer} buf
 * @returns {string|null} mime
 */
function sniffImageMime (buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'image/png'
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return null
}

/**
 * 同上，但返回**可直接展开进 generateVideo 参数**的形状（调用点一行即可接上）。
 * @param {object} input
 * @returns {{ params: Record<string, unknown>, reason?: string }}
 */
function buildSceneVideoReferenceParams (input) {
  const ref = buildSceneVideoReference(input)
  return {
    params: {
      ...(ref.mode ? { mode: ref.mode } : {}),
      ...(ref.firstFrame ? { firstFrame: ref.firstFrame } : {}),
      ...(ref.images ? { images: ref.images } : {}),
    },
    reason: ref.reason,
  }
}

module.exports = {
  buildSceneVideoReference,
  buildSceneVideoReferenceParams,
  sniffImageMime,
  MAX_REFERENCE_IMAGE_BYTES,
}
