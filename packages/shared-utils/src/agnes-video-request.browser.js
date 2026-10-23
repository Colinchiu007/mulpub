// @ts-check
'use strict'
/**
 * agnes-video-request — AI 视频生成请求的「模式 ↔ 媒体」契约（渲染层与主进程共用）
 *
 * ## 两份同源副本
 *
 * 本模块在仓库里有两份**逐行同源**的副本，只差模块包装：
 *   · `agnes-video-request.js`        —— CommonJS，主进程（Electron）用
 *   · `agnes-video-request.browser.js` —— ESM，渲染进程（浏览器）用
 *
 * 浏览器不能执行 `module.exports`：渲染层具名 import CJS 版时，vite dev server
 * 会在**运行时**抛 `does not provide an export named ...`，整页渲染失败；
 * 而 `vite build` / `vitest` / `tsc` **全是绿的**（各自由 rollup commonjs 插件、
 * vite-node interop、非类型检查兜底），只有跑 dev server 的视觉回归会红。
 * 故渲染层消费 ESM 孪生版并在 `apps/desktop/vite.config.js` 的 `resolve.alias` 登记；
 * 未登记时由 `scripts/check-renderer-cjs-boundary.js` 静态拦下。
 * 两侧漂移由 `__tests__/agnes-video-request-parity.test.js` 锁定。
 *
 * ## 为什么放在 shared-utils
 *
 * Agnes Video 2.5 的模式规则（text / keyframe / reference 各自接受什么、禁止什么）
 * 是**同一个约束的三处实现**：
 *   ① 渲染层：提交前拦截并给出可读提示（用户体验）
 *   ② 主进程 IPC：入参形状校验（少一次无谓往返）
 *   ③ 适配器：最终语义校验（服务端拒收前的最后一道）
 * 三处若各写一遍，迟早不同步 ⇒ 出现「界面说可以提交、服务端却 400」的错位。
 * 故收敛到此模块，三处共用同一个判据。
 *
 * 官方规则（agnes-video-25 / agnes-video-25-flash）：
 *   mode=text     ：纯文生视频；禁止 first_frame / last_frame / images / audios / videos
 *   mode=keyframe ：首尾帧控制；first_frame 与 last_frame 至少一个；禁止 images / audios / videos
 *   mode=reference：素材参考；images / audios / videos 至少一类非空；禁止 first_frame / last_frame
 */

/** 合法的生成模式 */
const AGNES_VIDEO_MODES = Object.freeze(['text', 'keyframe', 'reference'])

/** 校验失败的原因码（渲染层据此取 locale 文案，主进程据此做机器判定） */
const AGNES_VIDEO_REQUEST_ERRORS = Object.freeze({
  MODE_UNSUPPORTED: 'mode-unsupported',
  TEXT_DISALLOWS_MEDIA: 'text-disallows-media',
  KEYFRAME_REQUIRES_FRAME: 'keyframe-requires-frame',
  KEYFRAME_DISALLOWS_REFERENCE: 'keyframe-disallows-reference',
  REFERENCE_REQUIRES_MEDIA: 'reference-requires-media',
  REFERENCE_DISALLOWS_FRAMES: 'reference-disallows-frames',
})

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString (value) {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toStringArray (value) {
  return Array.isArray(value) ? value.filter((v) => isNonEmptyString(v) || typeof v === 'object') : []
}

/**
 * 推导模式（与适配器 generateVideo 的推导规则一致：帧 → keyframe，素材 → reference，其余 → text）。
 * @param {object} request
 * @returns {string}
 */
function inferVideoMode (request) {
  const r = request || {}
  if (isNonEmptyString(r.firstFrame) || isNonEmptyString(r.lastFrame)) return 'keyframe'
  if (toStringArray(r.images).length > 0 || toStringArray(r.audios).length > 0 || toStringArray(r.videos).length > 0) return 'reference'
  return 'text'
}

/**
 * 校验一次 AI 视频生成请求的模式与媒体是否自洽。
 *
 * @param {object} request
 * @param {string} [request.mode]                text / keyframe / reference；缺省时按媒体推导
 * @param {string[]} [request.images]
 * @param {string[]} [request.audios]
 * @param {Array} [request.videos]
 * @param {string} [request.firstFrame]
 * @param {string} [request.lastFrame]
 * @returns {{ ok: true, mode: string } | { ok: false, code: string, mode: string }}
 */
function validateVideoRequest (request) {
  const r = request || {}
  const mode = isNonEmptyString(r.mode) ? r.mode.trim() : inferVideoMode(r)
  const images = toStringArray(r.images)
  const audios = toStringArray(r.audios)
  const videos = toStringArray(r.videos)
  const hasFirst = isNonEmptyString(r.firstFrame)
  const hasLast = isNonEmptyString(r.lastFrame)
  const hasReferenceMedia = images.length > 0 || audios.length > 0 || videos.length > 0

  if (!AGNES_VIDEO_MODES.includes(mode)) {
    return { ok: false, code: AGNES_VIDEO_REQUEST_ERRORS.MODE_UNSUPPORTED, mode }
  }

  if (mode === 'text') {
    if (hasReferenceMedia || hasFirst || hasLast) {
      return { ok: false, code: AGNES_VIDEO_REQUEST_ERRORS.TEXT_DISALLOWS_MEDIA, mode }
    }
    return { ok: true, mode }
  }

  if (mode === 'keyframe') {
    if (!hasFirst && !hasLast) {
      return { ok: false, code: AGNES_VIDEO_REQUEST_ERRORS.KEYFRAME_REQUIRES_FRAME, mode }
    }
    if (hasReferenceMedia) {
      return { ok: false, code: AGNES_VIDEO_REQUEST_ERRORS.KEYFRAME_DISALLOWS_REFERENCE, mode }
    }
    return { ok: true, mode }
  }

  // reference
  if (hasFirst || hasLast) {
    return { ok: false, code: AGNES_VIDEO_REQUEST_ERRORS.REFERENCE_DISALLOWS_FRAMES, mode }
  }
  if (!hasReferenceMedia) {
    return { ok: false, code: AGNES_VIDEO_REQUEST_ERRORS.REFERENCE_REQUIRES_MEDIA, mode }
  }
  return { ok: true, mode }
}

export {
  AGNES_VIDEO_MODES,
  AGNES_VIDEO_REQUEST_ERRORS,
  inferVideoMode,
  validateVideoRequest,
}
