/**
 * Renderer ↔ preload 的数字人形象克隆 API。
 *
 * 与 avatar-catalog.js 同构：不直接触碰 IPC，只调用固定的 contextBridge 表面
 * （electron-bridge 的 invokeNamespace，ns=avatarClone）。
 *
 * 为什么每个导出直接写字面量而不经内部辅助函数转发：契约测试
 * （ipc-exposure-contract）从调用点抽首参字面量做对账，`method` 经辅助函数
 * 参数转发会变成"动态取名"，对账就看不见这条路径了。
 */
import { invokeNamespace } from './electron-bridge'

const NS = 'avatarClone'

function unavailable (data = undefined) {
  return data === undefined
    ? { code: -1, message: 'AVATAR_CLONE_API_UNAVAILABLE' }
    : { code: -1, message: 'AVATAR_CLONE_API_UNAVAILABLE', data }
}

/** 列出本账号的克隆形象（含失效标记） */
export async function listAvatarClones (input) {
  try {
    const r = await invokeNamespace(NS, 'list', input)
    return r === undefined ? unavailable({ avatars: [] }) : r
  } catch (_) {
    return unavailable({ avatars: [] })
  }
}

/** 打开主进程文件对话框选择素材（照片或视频），返回 selectionId */
export async function chooseAvatarCloneMedia (input) {
  try {
    const r = await invokeNamespace(NS, 'chooseMedia', input)
    return r === undefined ? unavailable(null) : r
  } catch (_) {
    return unavailable(null)
  }
}

/** 按 selectionId 创建克隆形象 */
export async function addAvatarClone (input) {
  try {
    const r = await invokeNamespace(NS, 'add', input)
    return r === undefined ? unavailable(null) : r
  } catch (_) {
    return unavailable(null)
  }
}

/** 删除克隆形象（先远端后本地） */
export async function deleteAvatarClone (input) {
  try {
    const r = await invokeNamespace(NS, 'delete', input)
    return r === undefined ? unavailable(null) : r
  } catch (_) {
    return unavailable(null)
  }
}

/** 重命名克隆形象（只改本地） */
export async function renameAvatarClone (input) {
  try {
    const r = await invokeNamespace(NS, 'rename', input)
    return r === undefined ? unavailable(null) : r
  } catch (_) {
    return unavailable(null)
  }
}
