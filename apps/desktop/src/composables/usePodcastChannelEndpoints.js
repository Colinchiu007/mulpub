/**
 * usePodcastChannelEndpoints.js — 分发端目录域（小宇宙 / Apple / Spotify 等 RSS 聚合端的目录与指引）
 *
 * 为什么单独一份：这个域的性质与页面写路径不同——它是**只读目录数据**，
 * 且带一条"主进程不可达时降级到共享引擎的本地 ESM 目录"的分支。混在页面域里时，
 * 「降级只影响指引展示、不影响任何写操作」这条不变量只能靠注释记住；拆开后本模块
 * 不知道也不该不知道频道元信息与单集列表的形状（逐文件行数门禁同时促成这次拆分）。
 *
 * ⛔ 判据不在这里重写：目录的唯一实现是 `@multi-publish/shared-utils` 的 podcast-endpoints，
 * 主进程侧走它的 CJS、本模块在 IPC 不可达时走 ESM 孪生，两份由该包的 parity 测试锁住。
 */
import { ref } from 'vue'
import { endpointList } from '@/api/podcast-channel'
import { listPodcastEndpoints } from '@multi-publish/shared-utils/src/podcast-endpoints'

/**
 * @param {object} deps
 * @param {(invoke: Function, ...args: any[]) => Promise<object>} deps.call 唯一 IPC 出口（与页面域共用同一实现）
 * @param {string} deps.ipcUnavailable 「命名空间不可达」自有码（由页面域持有，避免两个模块各抄一个字面量）
 * @param {string} deps.ipcException 「这一轮调用抛错」自有码
 */
export function createPodcastChannelEndpoints (deps) {
  const { call, ipcUnavailable, ipcException } = deps
  const endpoints = ref([])
  const endpointsError = ref('')

  /**
   * 优先 IPC（主进程与引擎 CJS 同源）；不可达时降级本地 ESM 孪生目录。
   * 返回的 source 是给调用方如实区分「拿到了、且知道它是哪来的」用的，不是装饰。
   */
  async function loadEndpoints () {
    endpointsError.value = ''
    const res = await call(endpointList)
    if (res && res.endpoints && Array.isArray(res.endpoints) && res.endpoints.length > 0) {
      endpoints.value = res.endpoints
      return { ok: true, source: 'ipc' }
    }
    try {
      endpoints.value = listPodcastEndpoints()
      if (!res.ok) endpointsError.value = res.code || ipcException
      return { ok: true, source: 'local' }
    } catch {
      endpoints.value = []
      endpointsError.value = ipcUnavailable
      return { ok: false, code: ipcUnavailable }
    }
  }

  return { endpoints, endpointsError, loadEndpoints }
}
