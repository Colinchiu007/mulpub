import { ref } from 'vue'
import { onAuthCompleted, onAccountStatusChanged, accountBatchCheckLogin, accountUpdate } from '@/api/publisher'
import { reportError } from '@/utils/report-error'

/**
 * 首页「登录失效提醒」横幅状态与自动刷新。
 *
 * 关键修正（2026-09-12）：不再读数据库 status === 'expired'（PR #1677
 * 之后 checkLogin 已不写该字段，遗留脏数据会导致已登录账号误判失效），
 * 改为实际调用 accountBatchCheckLogin 确认当前登录状态。
 *
 * - expiredAccounts / expiredAccountCount / showExpiredBanner 为横幅渲染状态；
 * - refresh() 调 accountBatchCheckLogin 逐账号验证，仅真正失效的才入列；
 * - 检测完成后与账号页「一键检测」同口径回写 status + last_validated
 *   （登录态口径统一修复 2026-09-22：此前横幅只读不回写，两处检测时间
 *   不同、结果不持久化，用户看到主页与账号页失效计数不一致）；
 * - 事件订阅让凭证保存后自动刷新，用户无需切页；
 * - dispose() 清理全部订阅（组件 onUnmounted 调用）。
 */
export function useExpiredAccountsBanner (accountStore) {
  const expiredAccounts = ref([])
  const expiredAccountCount = ref(0)
  const showExpiredBanner = ref(false)
  const checking = ref(false)

  async function refresh () {
    if (checking.value) return
    checking.value = true
    try {
      await accountStore.load()
      const accounts = accountStore.accounts || []
      if (accounts.length === 0) {
        expiredAccounts.value = []
        expiredAccountCount.value = 0
        showExpiredBanner.value = false
        return
      }
      const ids = accounts.map(a => a.id).filter(Boolean)
      if (ids.length === 0) {
        expiredAccounts.value = []
        expiredAccountCount.value = 0
        showExpiredBanner.value = false
        return
      }
      const result = await accountBatchCheckLogin(ids)
      const results = (result?.code === 0 && Array.isArray(result?.data?.results))
        ? result.data.results
        : []
      const expired = accounts.filter(account => {
        const check = results.find(r => r.accountId === account.id)
        return check && !check.valid
      })
      // 与账号页 batchCheckAllLogins 同口径持久化检测结果，使两处读到同一份状态。
      // 失败不阻断横幅更新（下次检测自然重试）。
      if (results.length > 0) {
        const checkedAt = result?.data?.checkedAt || new Date().toISOString()
        for (const item of results) {
          if (!item?.accountId) continue
          accountUpdate(item.accountId, {
            status: item.valid ? 'active' : 'expired',
            last_validated: checkedAt,
          }).catch(() => {})
        }
      }
      expiredAccounts.value = expired
      expiredAccountCount.value = expired.length
      showExpiredBanner.value = expired.length > 0
    } catch (e) {
      reportError('刷新首页失效账号失败', e)
    } finally {
      checking.value = false
    }
  }

  const _cleanups = []
  function subscribeAutoRefresh () {
    for (const register of [onAuthCompleted, onAccountStatusChanged]) {
      try {
        const cleanup = register(() => { refresh() })
        if (typeof cleanup === 'function') _cleanups.push(cleanup)
      } catch (_) { /* Electron bridge 在纯浏览器环境不可用时保持静默 */ }
    }
  }

  function dispose () {
    for (const cleanup of _cleanups.splice(0)) {
      try { cleanup() } catch (_) { /* ignore */ }
    }
  }

  return { expiredAccounts, expiredAccountCount, showExpiredBanner, checking, refresh, subscribeAutoRefresh, dispose }
}
