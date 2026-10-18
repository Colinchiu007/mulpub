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
    const res = await opsCenterSyncRuntime()
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
