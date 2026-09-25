/**
 * useOpsCenterSync.js — 运营后台同步 composable
 *
 * 职责：
 *   - 加载/保存运营后台同步配置（URL、API Key、自动同步开关）
 *   - 手动触发「立即同步」（先持久化当前表单再拉取下发）并回显结果
 *   - 暴露 lastSyncedAt，供模型设置页把限流/模型字段转为只读
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getAppLocale } from '@/i18n'
import { opsCenterSyncGet, opsCenterSyncSave, opsCenterSyncNow } from '@/api/ops-center-sync'
import { formatUserError } from '@/utils/user-facing-error'
import { useNotify } from './useNotify'

export function useOpsCenterSync () {
  const { t } = useI18n()
  // 统一通知通道（D1 决策）：toast 走 useNotify（带 notify:log 上报）
  const { notifyError, notifySuccess, notifyWarning } = useNotify()
  // ─── 状态 ─────────────────────────────────────
  const syncUrl = ref('')
  const syncApiKey = ref('')
  const syncApiKeyConfigured = ref(false)
  const syncAutoSync = ref(true)
  const lastSyncedAt = ref('')
  const syncing = ref(false)
  const syncStatus = ref('')      // 成功/提示文案
  const syncError = ref('')       // 错误文案（与成功互斥）
  const autoConnected = ref(false) // 方案C：登录会话自动连接
  const autoUrl = ref('')          // 自动发现的 URL（只读展示）

  /** 是否已配置同步（有 URL 且有 Key），驱动限流/模型只读 */
  const syncConfigured = ref(false)

  function applyConfig (cfg) {
    if (!cfg) return
    syncUrl.value = cfg.url || ''
    syncApiKeyConfigured.value = !!cfg.apiKeyConfigured
    syncAutoSync.value = cfg.autoSync !== false
    lastSyncedAt.value = cfg.lastSyncedAt || ''
    autoConnected.value = !!cfg.autoConnected
    autoUrl.value = cfg.autoUrl || ''
    // 方案C：autoConnected 也算已配置（无需手动 Key 即可同步）
    syncConfigured.value = !!(cfg.url && cfg.apiKeyConfigured) || !!cfg.autoConnected
  }

  function formatLastSync (iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(getAppLocale() === 'en' ? 'en-US' : 'zh-CN', { hour12: false })
  }

  /** 从主进程加载配置 */
  async function loadSyncConfig () {
    const res = await opsCenterSyncGet()
    if (res.code === 0 && res.config) {
      syncApiKey.value = ''
      applyConfig(res.config)
    }
    return res
  }

  /** 保存配置（apiKey 留空 = 保留现有 Key） */
  async function saveSyncConfig () {
    const res = await opsCenterSyncSave({
      url: syncUrl.value,
      apiKey: syncApiKey.value,
      autoSync: syncAutoSync.value,
    })
    if (res.code === 0) {
      notifySuccess('modelProviders.syncConfigSaved', { message: t('modelProviders.syncConfigSaved') })
      syncApiKey.value = ''
      applyConfig(res.config)
    } else {
      notifyError('modelProviders.saveSyncConfigFailed', { message: formatUserError(res, { fallback: t('modelProviders.saveSyncConfigFailed') }).message })
    }
    return res
  }

  /** 立即同步：先持久化当前表单 → 拉取目录 → 下发到本地模型配置 */
  async function runSyncNow () {
    if (syncing.value) return null
    syncing.value = true
    syncStatus.value = ''
    syncError.value = ''
    try {
      // 用户可能未点「保存配置」直接点「立即同步」：先用当前表单保存
      const saved = await opsCenterSyncSave({
        url: syncUrl.value,
        apiKey: syncApiKey.value,
        autoSync: syncAutoSync.value,
      })
      if (saved.code !== 0) {
        syncError.value = formatUserError(saved, { fallback: t('modelProviders.syncUnavailable') }).message
        notifyError('modelProviders.syncUnavailable', { message: syncError.value })
        return saved
      }
      syncApiKey.value = ''
      applyConfig(saved.config)

      const res = await opsCenterSyncNow()
      if (res.code === 0) {
        syncStatus.value = t('modelProviders.syncSuccess', { count: res.updated || 0, time: formatLastSync(res.syncedAt) })
        lastSyncedAt.value = res.syncedAt || ''
        notifySuccess('modelProviders.syncSuccess', { message: syncStatus.value })
      } else if (res.runtimeApplied) {
        // 目录与运营配置是两条独立通道：目录未完成但运营配置（菜单/公告/开关）已下发时，
        // 笼统报「同步失败」会让人以为白改了，反而去反复重启应用。
        const reason = formatUserError(res, { fallback: t('modelProviders.syncFailed') }).message
        syncStatus.value = t('modelProviders.syncPartialSuccess', { reason })
        notifyWarning('modelProviders.syncPartialSuccess', { message: syncStatus.value })
      } else {
        syncError.value = formatUserError(res, { fallback: t('modelProviders.syncFailed') }).message
        notifyError('modelProviders.syncFailed', { message: syncError.value })
      }
      return res
    } catch (e) {
      syncError.value = formatUserError(e, { fallback: t('modelProviders.syncError') }).message
      notifyError('modelProviders.syncError', { message: syncError.value })
      return { code: -1, message: syncError.value }
    } finally {
      syncing.value = false
    }
  }

  return {
    syncUrl,
    syncApiKey,
    syncApiKeyConfigured,
    syncAutoSync,
    lastSyncedAt,
    syncing,
    syncStatus,
    syncError,
    syncConfigured,
    autoConnected,
    autoUrl,
    formatLastSync,
    loadSyncConfig,
    saveSyncConfig,
    runSyncNow,
  }
}
