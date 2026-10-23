// @ts-check
/**
 * useQuickRenderMaterials.js — 快速渲染的素材读取与入列
 *
 * 职责边界：只管「把用户选的文件读成可提交的数据形态，并守住数量/体积上限」。
 * 不管模式语义（那是 packages/shared-utils/src/agnes-video-request 的判据），
 * 不管渲染（那是面板的事）。
 *
 * ⚠️ 本文件**不得出现中文字符串字面量**（渲染端 CJK 门禁按 file+content 增量比对基线）。
 */

/**
 * @param {string} mimeType
 * @returns {boolean}
 */
function isImage (mimeType) {
  return typeof mimeType === 'string' && mimeType.startsWith('image/')
}

/**
 * @param {string} mimeType
 * @returns {boolean}
 */
function isAudio (mimeType) {
  return typeof mimeType === 'string' && mimeType.startsWith('audio/')
}

/**
 * 把 File 读成 Data URL。
 * 参考图/参考音频以 data URI 形式提交（Agnes 侧「媒体须公网可达」的要求由适配器/服务端把关；
 * Data URI 形式免去二次托管，是本仓既有做法，见 film-engineering/video-reference-inputs.js）。
 * @param {File} file
 * @returns {Promise<string>}
 */
function readAsDataUrl (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve(String(ev.target.result || ''))
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * @param {object} deps
 * @param {(key: string, params?: object) => string} deps.t - vue-i18n 的 t
 * @param {() => number} deps.maxImages
 * @param {() => number} deps.maxAudios
 * @param {import('vue').Ref<{first: any, last: any}>} deps.frames
 * @param {import('vue').Ref<Array<{name: string, dataUrl: string, size: number}>>} deps.referenceImages
 * @param {import('vue').Ref<Array<{name: string, dataUrl: string, size: number}>>} deps.referenceAudios
 * @param {import('vue').Ref<Array<{name: string, dataUrl: string, size: number}>>} deps.galleryImages
 * @param {(message: string) => void} deps.onError
 */
export function useQuickRenderMaterials (deps) {
  const { t, maxImages, maxAudios, frames, referenceImages, referenceAudios, galleryImages, onError } = deps

  const maxImageMb = Math.round(5)
  const maxAudioMb = Math.round(10)

  /**
   * @param {Array<{name: string, dataUrl: string, size: number}>} list
   * @param {number} room
   * @param {string} limitKey
   * @param {number} max
   * @returns {Promise<Array<{name: string, dataUrl: string, size: number}>>} 本次真正入列的条目
   */
  async function ingest (files, list, room, limitKey, max, maxBytes, maxMb, accept) {
    const incoming = Array.from(files || []).filter((f) => f && accept(f.type))
    if (!incoming.length) return []
    if (room <= 0) {
      onError(t(limitKey, { max }))
      return []
    }
    if (incoming.length > room) onError(t(limitKey, { max }))
    const accepted = []
    for (const file of incoming.slice(0, room)) {
      if (file.size > maxBytes) {
        onError(t('create.story2video.ui.quickError.fileTooLarge', { max: maxMb }))
        continue
      }
      const dataUrl = await readAsDataUrl(file)
      const item = { name: file.name, dataUrl, size: file.size }
      list.push(item)
      accepted.push(item)
    }
    return accepted
  }

  /**
   * 加入参考图。
   * @param {FileList|File[]|null} files
   */
  async function pushImages (files) {
    const max = maxImages()
    await ingest(files, referenceImages.value, max - referenceImages.value.length,
      'create.story2video.ui.quickError.imageLimit', max, 5 * 1024 * 1024, maxImageMb, isImage)
  }

  /**
   * 加入参考音频。
   * @param {FileList|File[]|null} files
   */
  async function pushAudios (files) {
    const max = maxAudios()
    await ingest(files, referenceAudios.value, max - referenceAudios.value.length,
      'create.story2video.ui.quickError.audioLimit', max, 10 * 1024 * 1024, maxAudioMb, isAudio)
  }

  /**
   * 加入图片轮播素材（本地 Remotion 路径，无数量上限）。
   * @param {FileList|File[]|null} files
   */
  async function pushGallery (files) {
    await ingest(files, galleryImages.value, Number.MAX_SAFE_INTEGER,
      'create.story2video.ui.quickError.imageLimit', 0, 5 * 1024 * 1024, maxImageMb, isImage)
  }

  /**
   * 设置首帧/尾帧。
   * @param {'first'|'last'} slot
   * @param {FileList|File[]|null} files
   */
  async function pushFrame (slot, files) {
    const file = Array.from(files || []).find((f) => f && isImage(f.type))
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      onError(t('create.story2video.ui.quickError.fileTooLarge', { max: maxImageMb }))
      return
    }
    const dataUrl = await readAsDataUrl(file)
    frames.value = { ...frames.value, [slot]: { name: file.name, dataUrl, size: file.size } }
  }

  /**
   * 清空某个帧位。
   * @param {'first'|'last'} slot
   */
  function clearFrame (slot) {
    frames.value = { ...frames.value, [slot]: null }
  }

  return { pushImages, pushAudios, pushGallery, pushFrame, clearFrame }
}
