/**
 * Renderer ↔ preload 的 TTS 音色克隆 API。
 *
 * M-9 收敛：删掉本地 getTtsVoiceCloneApi / toPlainIpcValue 副本，改走
 * electron-bridge 的 invokeNamespace（ns=ttsVoiceClone）。每个导出直接
 * 写 ns/method 字面量（不经参数转发），让契约测试的对账看得见每条路径。
 *
 * 行为对齐（含 CCG 评审 i1 修正）：旧实现在「方法缺失」与「主进程拒绝」
 * 两种失败下都回 TTS_VOICE_CLONE_API_UNAVAILABLE 信封。invokeNamespace 只在
 * 缺方法时返回 undefined；主进程 reject 会**冒泡**——这里 try/catch 兜住，
 * 与旧实现语义一致。
 */
import { invokeNamespace } from './electron-bridge'

const NS = 'ttsVoiceClone'

function unavailable (data = undefined) {
  return data === undefined
    ? { code: -1, message: 'TTS_VOICE_CLONE_API_UNAVAILABLE' }
    : { code: -1, message: 'TTS_VOICE_CLONE_API_UNAVAILABLE', data }
}

export async function getTtsVoiceCloneRequirements (input) {
  try {
    const r = await invokeNamespace(NS, 'requirements', input)
    return r === undefined ? unavailable(null) : r
  } catch (_) {
    return unavailable(null)
  }
}

export async function chooseTtsVoiceCloneSamples (input) {
  try {
    const r = await invokeNamespace(NS, 'chooseSamples', input)
    return r === undefined ? unavailable({ paths: [] }) : r
  } catch (_) {
    return unavailable({ paths: [] })
  }
}

export async function listTtsVoiceClones (input) {
  try {
    const r = await invokeNamespace(NS, 'list', input)
    return r === undefined ? unavailable({ voices: [] }) : r
  } catch (_) {
    return unavailable({ voices: [] })
  }
}

export async function addTtsVoiceClone (input) {
  try {
    const r = await invokeNamespace(NS, 'add', input)
    return r === undefined ? unavailable(null) : r
  } catch (_) {
    return unavailable(null)
  }
}

export async function deleteTtsVoiceClone (input) {
  try {
    const r = await invokeNamespace(NS, 'deleteClone', input)
    return r === undefined ? unavailable(null) : r
  } catch (_) {
    return unavailable(null)
  }
}

export async function renameTtsVoiceClone (input) {
  try {
    const r = await invokeNamespace(NS, 'rename', input)
    return r === undefined ? unavailable(null) : r
  } catch (_) {
    return unavailable(null)
  }
}

/**
 * 修改克隆音色的语速/音量/语调（change: hifly-voice-edit-ui）。
 *
 * 只对**自己克隆的**音色可用——服务端对公共音色返回通用失败、无法区分，
 * 所以 UI 只应在克隆音色列表里给入口。参数必须是字符串且在界内，
 * 越界由主进程拒绝（VOICE_CLONE_INVALID_ARGUMENTS）。
 */
export async function editTtsVoiceCloneParams (input) {
  try {
    const r = await invokeNamespace(NS, 'editParams', input)
    return r === undefined ? unavailable(null) : r
  } catch (_) {
    return unavailable(null)
  }
}
