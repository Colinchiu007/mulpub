/**
 * 飞影 11 个扩展端点的渲染层 API（change: hifly-full-api-ui）。
 *
 * 与 tts-voice-clone / avatar-clone 同型：走 electron-bridge 的 invokeNamespace，
 * 每个导出直接写 ns/method **字面量**——契约测试（ipc-exposure-contract）明确
 * 禁止动态取名调用点，否则它无法逐条对账到 preload 暴露面。
 *
 * 失败语义统一：主进程拒绝或缺方法都回 `{ code: -1, message: ... }` 信封，
 * 调用方只需判 `code === 0`。
 *
 * ⚠️ 能力可用性：上游 adapter 方法只有 `hifly-full-api` 合并后才存在。
 * 在它合并前，主进程会回 `HIFLY_EXTRA_UNSUPPORTED`；UI 据此隐藏入口（见 HiflyExtraPanel）。
 */
import { invokeNamespace } from './electron-bridge'

const NS = 'hiflyExtra'

function unavailable (message = 'HIFLY_EXTRA_UNAVAILABLE') {
  return { code: -1, message }
}

/** 查询账户积分（免费）。返回 `{ code: 0, data: { left } }`。 */
export async function getHiflyCredit () {
  try {
    const r = await invokeNamespace(NS, 'credit', {})
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}

/** 查询网感模板列表（免费）。 */
export async function listHiflyLivelyTemplates (input) {
  try {
    const r = await invokeNamespace(NS, 'livelyTemplates', input)
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}

/** 查询封面模板列表（免费）。 */
export async function listHiflyCoverStyles (input) {
  try {
    const r = await invokeNamespace(NS, 'coverStyles', input)
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}

/** 创建封面（**免费**）。 */
export async function createHiflyCover (input) {
  try {
    const r = await invokeNamespace(NS, 'createCover', input)
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}

/** 删除作品（免费，仅普通视频创作任务）。 */
export async function deleteHiflyWork (input) {
  try {
    const r = await invokeNamespace(NS, 'deleteWork', input)
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}

/** 视频创作（声音驱动）—— 收费。 */
export async function createHiflyVideoByAudio (input) {
  try {
    const r = await invokeNamespace(NS, 'createByAudio', input)
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}

/** 视频创作（网感模板）—— 收费。 */
export async function createHiflyVideoByTemplate (input) {
  try {
    const r = await invokeNamespace(NS, 'createByTemplate', input)
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}

/** 视频翻译 —— 收费。 */
export async function translateHiflyVideo (input) {
  try {
    const r = await invokeNamespace(NS, 'translate', input)
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}

/** 视频创作（唱歌）—— 收费。 */
export async function createHiflyVideoBySing (input) {
  try {
    const r = await invokeNamespace(NS, 'createBySing', input)
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}

/** 视频创作（图片驱动）—— 收费。 */
export async function createHiflyVideoByImage (input) {
  try {
    const r = await invokeNamespace(NS, 'createByImage', input)
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}

/** 音频创作 —— 收费。 */
export async function createHiflyAudioTts (input) {
  try {
    const r = await invokeNamespace(NS, 'audioTts', input)
    return r === undefined ? unavailable() : r
  } catch (error) {
    return unavailable((error && error.message) || 'HIFLY_EXTRA_UNAVAILABLE')
  }
}
