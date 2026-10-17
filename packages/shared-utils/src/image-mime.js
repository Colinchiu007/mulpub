/**
 * image-mime.js — 图片 mime ↔ 扩展名的单一真源（@multi-publish/shared-utils 版）
 *
 * ## 位置纪律（本轮实测决策）
 * 本表被两条链消费：
 * - **桌面主进程**（cover-cropper / media-downloader / story2video-media-server / prompt-eval）
 *   —— 可 require workspace 包（进 asar 的 node_modules）；
 * - **api-publish-engine** —— 「可独立打包的零 workspace 依赖运行时」（见该包
 *   category-resolver.js 头注释的架构约束），**不能** require shared-utils。
 * ⇒ 真源放这里供桌面链使用；api-publish-engine 的映射表按架构约束**显式豁免**
 *   （R7 扫描器的豁免清单，理由登记在 r3 模块头注释），不是漏改。
 *
 * ## 语义（与四份历史字面量对账后统一）
 * - ext → mime：大小写不敏感；未知 ext 返回 **null 不猜**（宁可失败不把 webp 发成 jpeg）；
 * - mime → ext：image/jpeg 确定性归一为 '.jpg'（与 media-downloader 落盘口径一致）；
 *   未知 mime 返回 null。
 * 纯数据模块：零依赖、无副作用、进打包（shared-utils 在 apps/desktop files 的 node_modules 内）。
 */

'use strict'

/** 支持的图片格式（唯一登记处；新增格式只改这里）。 */
const FORMATS = [
  { ext: '.jpg', mime: 'image/jpeg' },
  { ext: '.jpeg', mime: 'image/jpeg' },
  { ext: '.png', mime: 'image/png' },
  { ext: '.webp', mime: 'image/webp' },
]

const EXT_TO_MIME = Object.freeze(Object.fromEntries(FORMATS.map((f) => [f.ext, f.mime])))
// ⚠ image/jpeg 有两个 ext（.jpg/.jpeg）⇒ mime→ext 必须确定性归一：保留**首个**条目（.jpg）。
//   Object.fromEntries 是后写胜出，直接 fromEntries 会得到 .jpeg —— 归一失败（夹具当场抓出）。
const MIME_TO_EXT = Object.freeze(FORMATS.reduce((acc, f) => {
  if (!(f.mime in acc)) acc[f.mime] = f.ext
  return acc
}, {}))

/**
 * 扩展名（含点、大小写不敏感）→ mime；未知 ext 返回 null（不猜）。
 * @param {string} ext 如 '.png' 或 'png'
 * @returns {string|null}
 */
function extToMime (ext) {
  if (typeof ext !== 'string' || !ext) return null
  return EXT_TO_MIME[ext.startsWith('.') ? ext.toLowerCase() : '.' + ext.toLowerCase()] || null
}

/**
 * mime → 规范扩展名（含点）；image/jpeg 统一返回 '.jpg'。未知 mime 返回 null。
 * @param {string} mime
 * @returns {string|null}
 */
function mimeToExt (mime) {
  if (typeof mime !== 'string' || !mime) return null
  return MIME_TO_EXT[mime.toLowerCase()] || null
}

/**
 * 从 dataUrl 前缀取 mime；非 data:image 前缀返回 null。
 * @param {string} dataUrl
 * @returns {string|null}
 */
function mimeOfDataUrl (dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
  const m = /^data:(image\/[a-z0-9.+-]+)/i.exec(dataUrl)
  return m ? m[1].toLowerCase() : null
}

/**
 * 历史非规范 mime 别名（真实平台回包出现过）→ 规范 mime。
 * i5（CCG 020ff510）：兼容例外必须登记在真源，而不是散落在消费文件里只靠行内注释 ——
 *   「历史兼容」是显式概念，不是隐藏例外。消费方展开方式：
 *   `{ ...MIME_TO_EXT, ...LEGACY_MIME_ALIASES 的 ext 映射 }`（见 media-downloader）。
 */
const LEGACY_MIME_ALIASES = Object.freeze({ 'image/jpg': 'image/jpeg' })
module.exports = { FORMATS, EXT_TO_MIME, MIME_TO_EXT, LEGACY_MIME_ALIASES, extToMime, mimeToExt, mimeOfDataUrl }
