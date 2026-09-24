// @ts-check
'use strict'
/**
 * film-engineering video-reference-inputs - 画布参考图 → 视频 provider 参考输入（tasks 4.3）
 *
 * 合同（openspec change: film-engineering-canvas，PRD §12.5 本切片收口）：
 *   - 前端连线注入的 localReferences（[{shotId, paths}]，paths 为 upload-reference IPC
 *     返回的受控根内绝对路径）在这里翻译成 provider 的参考输入参数；
 *   - 能力探测用显式映射表（providerId → 参考参数名），不扩张 BaseAdapter.KNOWN_METHODS：
 *     未列入一律保守视为不支持 → 降级纯文本出片 + 明示 warning（不静默失败、不阻断）；
 *   - 路径纵深防御：只接受规范化后位于受控媒体根（os.tmpdir()/film-engineering，与
 *     reference-store 落盘根、film-render getFilmMediaRoot 同值）内的文件；越界（含 '..'
 *     遍历、绝对路径外指）一律拒绝读取内容，仅在 warning 中报告 outside-media-root；
 *   - 内容只信魔数嗅探（sniffImageType），读取侧兜底体积上限 MAX_REF_BYTES；
 *   - 一镜多参考 v1 取首个有效参考（首帧语义），后续切片再扩多参考。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { sniffImageType, isWithin, MAX_REF_BYTES } = require('./reference-store')

/**
 * providerId → 视频生成参考输入参数名（经源码核实的 adapter 形状）：
 *   minimax        params.firstFrameImage → API first_frame_image（URL 或 base64）
 *   agnes-video    params.image
 *   agnes-multimodal params.image
 * seedance / kling / veo 等当前 adapter 无参考输入参数，不得列入（列入即承诺行为）。
 */
const VIDEO_REFERENCE_PARAM_BY_PROVIDER = Object.freeze({
  minimax: 'firstFrameImage',
  'agnes-video': 'image',
  'agnes-multimodal': 'image',
})

/** 保守能力探测：未显式列入映射表的 provider 一律视为不支持参考输入 */
function supportsVideoReferenceInput (providerId) {
  return typeof providerId === 'string' &&
    Object.prototype.hasOwnProperty.call(VIDEO_REFERENCE_PARAM_BY_PROVIDER, providerId)
}

/**
 * 归一化画布负载 → Map<shotId, paths[]>。非法形状防御跳过（绝不抛异常）：
 * 用户可控内容，经 IPC 已达，这里是不信任边界的第二道闸。
 * @param {unknown} raw
 * @returns {Map<string, string[]>}
 */
function normalizeLocalReferences (raw) {
  /** @type {Map<string, string[]>} */
  const map = new Map()
  if (!Array.isArray(raw)) return map
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const shotId = typeof entry.shotId === 'string' ? entry.shotId.trim() : ''
    if (!shotId || !Array.isArray(entry.paths)) continue
    const pathsArr = entry.paths.filter(p => typeof p === 'string' && p.trim() !== '')
    if (pathsArr.length === 0) continue
    map.set(shotId, pathsArr)
  }
  return map
}

/**
 * 解析单镜参考输入。返回：
 *   { }                              —— 该镜无参考（向后兼容静默）
 *   { refParam: {k: dataURL}, usedPath }  —— 注入成功（首帧语义取首个有效参考）
 *   { warning: {shotId, reason}, refParam?, usedPath? } —— 降级/部分无效明示
 * @param {{ providerId: string, refMap: Map<string, string[]>, shotId: string, mediaRoot?: string, fsImpl?: typeof fs }} opts
 */
function resolveShotReferenceInput ({ providerId, refMap, shotId, mediaRoot = path.join(os.tmpdir(), 'film-engineering'), fsImpl = fs }) {
  const paths = (refMap && typeof refMap.get === 'function') ? refMap.get(String(shotId || '')) : null
  if (!paths || paths.length === 0) return {}
  if (!supportsVideoReferenceInput(providerId)) {
    return { warning: { shotId, reason: 'provider ' + providerId + ' 不支持参考图输入，本镜已降级为纯文本生成' } }
  }
  const paramKey = VIDEO_REFERENCE_PARAM_BY_PROVIDER[providerId]
  if (typeof mediaRoot !== 'string' || mediaRoot.trim() === '') {
    return { warning: { shotId, reason: '受控媒体根未配置，参考图未注入' } }
  }
  /** @type {string[]} */
  const failureReasons = []
  for (const p of paths) {
    let reason
    try {
      const abs = path.resolve(p)
      if (!isWithin(mediaRoot, abs)) {
        // 越界：不读取内容，只报告（纵深防御，防 '..' 遍历/绝对路径外指）
        failureReasons.push('outside-media-root')
        continue
      }
      if (!fsImpl.existsSync(abs)) {
        reason = '文件不存在'
      } else if (!fsImpl.statSync(abs).isFile()) {
        reason = '不是普通文件'
      } else {
        const buf = fsImpl.readFileSync(abs)
        if (buf.length > MAX_REF_BYTES) {
          reason = '超过 ' + Math.floor(MAX_REF_BYTES / 1024 / 1024) + 'MB 上限'
        } else {
          const sniffed = sniffImageType(buf)
          if (!sniffed) {
            reason = '图像魔数嗅探失败（非 PNG/JPEG/WEBP）'
          } else {
            return {
              refParam: { [paramKey]: 'data:' + sniffed.mime + ';base64,' + buf.toString('base64') },
              usedPath: abs,
              warning: failureReasons.length > 0
                ? { shotId, reason: '部分参考无效已跳过: ' + failureReasons.slice(0, 3).join('; ') }
                : undefined,
            }
          }
        }
      }
    } catch (e) {
      reason = (e && e.message) ? e.message : String(e)
    }
    if (reason) failureReasons.push(reason)
  }
  return { warning: { shotId, reason: '参考图均不可用: ' + failureReasons.slice(0, 3).join('; ') } }
}

module.exports = {
  VIDEO_REFERENCE_PARAM_BY_PROVIDER,
  supportsVideoReferenceInput,
  normalizeLocalReferences,
  resolveShotReferenceInput,
}
