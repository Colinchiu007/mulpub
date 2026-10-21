/**
 * useOpsCenterRuntime.js — 运营后台运行时策略 composable
 *
 * 读取主进程 OpsCenterSync 缓存的公告 / 内容安全策略状态，
 * 供 App.vue 公告横幅展示；无同步配置或未拉取时为空（静默）。
 */
import { ref } from 'vue'
import { opsCenterSyncRuntime } from '@/api/ops-center-sync'

/**
 * 公告 severity 的闭合词表（机器值，不是文案）。
 * 文案归 locales/announcement/{zh,en}.js —— 此前这里是一张写死中文的标签表，
 * 于是英文界面必然露出中文；组件现在只取机器值，标签按 locale 取。
 */
export const SEVERITIES = ['info', 'warning', 'maintenance']

export function useOpsCenterRuntime () {
  const announcements = ref([])
  const updatePolicy = ref(null)
  const contentPolicy = ref(null)
  const syncedAt = ref('')
  const loaded = ref(false)

  async function loadRuntime () {
    // 拉取失败必须以「返回值」表达，不得把 rejection 抛给调用方。
    // 唯一的消费路径是组件的 onMounted(() => loadRuntime()) —— 那条链没人 await，
    // 一旦 reject 就是 Unhandled Rejection（实测：接线后全域 vitest 报 `Errors 5 errors`，
    // 全部来自 `@/api/electron-bridge` 的部分 mock 缺 `invokeWithFallback`）。
    // 公告是可选信息：运营中心不可达时应当"没有公告"，而不是"一条未处理错误"。
    let res
    try {
      res = await opsCenterSyncRuntime()
    } catch (error) {
      loaded.value = true
      return { code: -1, message: String((error && error.message) || error), data: null }
    }
    if (res.code === 0 && res.data) {
      announcements.value = Array.isArray(res.data.announcements) ? res.data.announcements : []
      updatePolicy.value = res.data.updatePolicy || null
      contentPolicy.value = res.data.contentPolicy || null
      syncedAt.value = res.data.syncedAt || ''
    }
    loaded.value = true
    return res
  }

  return {
    announcements,
    updatePolicy,
    contentPolicy,
    syncedAt,
    loaded,
    loadRuntime,
  }
}
