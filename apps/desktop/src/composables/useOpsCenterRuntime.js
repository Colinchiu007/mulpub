/**
 * useOpsCenterRuntime.js — 运营后台运行时策略 composable
 *
 * 读取主进程 OpsCenterSync 缓存的公告 / 内容安全策略状态；无同步配置或未拉取时为空（静默）。
 * 消费方：`components/AnnouncementBanner.vue`（阶段 1.2 / audit-6 起才真正挂载，此前零引用）。
 * 公告档位文案不在这里持有——文案归属 locales（`announcement/*`），表现层按键取，
 * 否则 zh/en 成对约束（CI Gate 7）管不到一个 composable 里的中文字面量。
 */
import { ref } from 'vue'
import { opsCenterSyncRuntime } from '@/api/ops-center-sync'

export function useOpsCenterRuntime () {
  const announcements = ref([])
  const updatePolicy = ref(null)
  const contentPolicy = ref(null)
  const syncedAt = ref('')
  const loaded = ref(false)

  async function loadRuntime () {
    // 读取失败必须在这里收口，**不得**把 rejection 抛给消费方：`AnnouncementBanner` 是壳层
    // 组件（挂在 App.vue 下），它在 onMounted 里调用本函数且不 await —— 一旦这里 reject，
    // 就是 unhandled rejection，会在**每一个**挂载壳层的测试套件里冒出来（CI 实测 9 次），
    // 在生产里则是一次无人知晓的静默崩溃。语义与文档头一致：未拉取到即为空（静默），
    // 但静默不等于不出声 —— 留一条 warn 作为现场来源。
    let res
    try {
      res = await opsCenterSyncRuntime()
    } catch (err) {
      console.warn('[ops-center-runtime] 运行时策略读取失败，按无配置处理：', err?.message || err)
      loaded.value = true
      return { code: -1, message: 'runtime_read_failed', data: null }
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
