/**
 * Renderer ↔ preload 的数字人形象/音色目录 API。
 *
 * 与 tts-voice-catalog.js 同构：不直接触碰 IPC，只调用固定的 contextBridge 表面
 * （electron-bridge 的 invokeNamespace，ns=avatarCatalog）。
 *
 * 为什么每个导出直接写字面量而不经内部辅助函数转发：契约测试
 * （ipc-exposure-contract）从调用点抽首参字面量做对账，`method` 经辅助函数
 * 参数转发会变成"动态取名"，对账就看不见这条路径了。
 */
import { invokeNamespace } from './electron-bridge'

const NS = 'avatarCatalog'

function unavailable (data = undefined) {
  return data === undefined
    ? { code: -1, message: 'AVATAR_CATALOG_API_UNAVAILABLE' }
    : { code: -1, message: 'AVATAR_CATALOG_API_UNAVAILABLE', data }
}

/** 列出数字人形象 */
export async function getAvatarCatalog (input) {
  try {
    const r = await invokeNamespace(NS, 'avatars', input)
    return r === undefined ? unavailable({ avatars: [] }) : r
  } catch (_) {
    return unavailable({ avatars: [] })
  }
}

/** 列出数字人音色 */
export async function getAvatarVoiceCatalog (input) {
  try {
    const r = await invokeNamespace(NS, 'voices', input)
    return r === undefined ? unavailable({ voices: [] }) : r
  } catch (_) {
    return unavailable({ voices: [] })
  }
}

/** 丢弃指定 provider 的目录缓存（换 Key 后强制重拉） */
export async function invalidateAvatarCatalog (input) {
  try {
    const r = await invokeNamespace(NS, 'invalidate', input)
    return r === undefined ? unavailable(null) : r
  } catch (_) {
    return unavailable(null)
  }
}
