/**
 * 快捷采集桥接层（渲染端唯一接触 IPC 的入口）
 *
 * 方法名 = preload 暴露的扁平方法名（`electronAPI.quickCollect*`）；通道名只在 preload 侧出现
 * （`check-ipc-bridge` 按 preload 源码字面量对账）。
 *
 * 失败语义：无 electronAPI / 权限不足 → `invokeWithFallback` 的 fallback（`code: -1`），
 * 由调用方映射成「模块暂不可用」；主进程返回的领域码原样透传（面板按码取文案）。
 */
import { invokeWithFallback, on } from './electron-bridge'

/** 预置目录读取失败时的兜底（不伪装成空目录，让调用方能区分） */
const PRESETS_FALLBACK = { code: -1, message: 'QC_IPC_UNAVAILABLE', data: [] }

/**
 * 读取内置指令目录（无参）。
 * @returns {Promise<{ code: number, data?: object[], message?: string }>}
 */
export async function quickCollectListPresets () {
  return invokeWithFallback('quickCollectListPresets', PRESETS_FALLBACK)
}

/**
 * 执行一条快捷采集指令。
 * @param {object} command 归一后的指令（渲染端已做表单校验，主进程仍会再校验一遍）
 * @param {string} [requestId] 进度事件关联用
 * @returns {Promise<{ code: number, data?: object, message?: string }>}
 */
export async function quickCollectRun (command, requestId = '') {
  return invokeWithFallback(
    'quickCollectRun',
    { code: -1, message: 'QC_IPC_UNAVAILABLE' },
    { command, requestId },
  )
}

/**
 * 订阅执行阶段进度。
 * @param {(payload: { requestId?: string, stage?: string, percent?: number }) => void} callback
 * @returns {() => void} 取消订阅
 */
export function onQuickCollectProgress (callback) {
  return on('QuickCollectProgress', callback)
}
