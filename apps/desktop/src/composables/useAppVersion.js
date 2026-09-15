/**
 * useAppVersion — 应用版本号读取（唯一取数入口）
 *
 * 数据来源：主进程 IPC `app:get-version`（`electron/ipc-handlers/misc.js`），
 * 从 `apps/desktop/package.json` 的 `version` 字段读取，统一返回
 * `{ code: 0, data: '<semver>' }`。
 *
 * 渲染层统一通过 `@/api/electron-bridge` 的 `invoke()` 调用：
 * - 非 Electron 环境（纯浏览器 / Vite 预览 / 视觉回归）没有 `window.electronAPI`，
 *   `invoke()` 返回 `undefined`，此处把版本号降级为空字符串，调用方自行决定是否展示。
 * - 主进程调用异常时不向外抛错，避免一个装饰性版本号把整个应用壳渲染打断。
 */
import { ref } from 'vue'
import { invoke } from '@/api/electron-bridge'

/**
 * 从 IPC 响应中提取版本号。
 * 只接受 `code === 0` 且 `data` 非空的成功响应，其余一律返回空字符串。
 * @param {any} response IPC 返回的 `{ code, data }` 结构
 * @returns {string} 版本号字符串（去首尾空白），无有效版本时返回 ''
 */
export function extractAppVersion (response) {
  if (!response || typeof response !== 'object') return ''
  if (response.code !== 0) return ''
  const { data } = response
  if (data === null || data === undefined) return ''
  return String(data).trim()
}

/**
 * 读取应用版本号的组合式函数。
 * @returns {{ version: import('vue').Ref<string>, loading: import('vue').Ref<boolean>, loadVersion: () => Promise<string> }}
 */
export function useAppVersion () {
  const version = ref('')
  const loading = ref(false)

  async function loadVersion () {
    loading.value = true
    try {
      version.value = extractAppVersion(await invoke('getVersion'))
    } catch {
      // 版本号是装饰性信息，失败时不冒泡、不留半截脏值
      version.value = ''
    } finally {
      loading.value = false
    }
    return version.value
  }

  return { version, loading, loadVersion }
}
