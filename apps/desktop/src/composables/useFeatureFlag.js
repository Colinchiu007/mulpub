/**
 * useFeatureFlag.js — 运营中心 feature flag 的极薄读取 composable
 *
 * 复用既有 runtime 链路（不新建 IPC、不改主进程）：
 *   `opsCenterSyncRuntime()` → `{ code, data: { featureFlags } }`
 *   消费先例：`src/views/CreateView.vue:2703`（videoCreation.maxOutputResolution）
 *
 * 口径（docs/adr/0006-entry-gated-by-ops-feature-flag.md）：
 *   flag 缺失 / 从未同步过运营配置 / 网络不可达 / 调用抛错 → **一律按关闭**（fail-closed）。
 *   运营入口的存在性本身就是权限边界，不能"读不到就当开"。
 *
 * 真值判定只接受显式布尔真与字符串/数字 1（运营后台下发的布尔开关），
 * 其余形态（对象/数组/任意字符串）按关闭处理。
 */
import { readonly, ref } from 'vue'
import { opsCenterSyncRuntime } from '@/api/ops-center-sync'

/** 账号管理页【同步云端】入口开关键（PRD §3 前置条件表） */
export const FEATURE_FLAG_ACCOUNT_CLOUD_SYNC = 'account_cloud_sync'

/** flag 值 → 布尔（fail-closed：未知形态一律 false） */
export function isFlagEnabled (value) {
  if (value === true || value === 1) return true
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1'
  }
  return false
}

/**
 * 读取单个运营 feature flag。
 * @param {string} key flag 键
 */
export function useFeatureFlag (key) {
  const enabled = ref(false)
  const loading = ref(false)
  const resolved = ref(false)

  async function refresh () {
    if (!key) {
      enabled.value = false
      resolved.value = true
      return false
    }
    loading.value = true
    try {
      const runtime = await opsCenterSyncRuntime()
      const flags = runtime && runtime.code === 0 ? runtime.data?.featureFlags : null
      enabled.value = flags ? isFlagEnabled(flags[key]) : false
    } catch (_) {
      // 运营配置不可达：按关闭处理，不提示（入口隐藏即可，无用户可感知失败路径）
      enabled.value = false
    } finally {
      loading.value = false
      resolved.value = true
    }
    return enabled.value
  }

  return {
    enabled: readonly(enabled),
    loading: readonly(loading),
    resolved: readonly(resolved),
    refresh,
  }
}

export default useFeatureFlag
