import { ref } from 'vue'
import { onAuthCompleted, onAccountStatusChanged, accountBatchCheckLogin } from '@/api/publisher'
import { reportError } from '@/utils/report-error'
import i18n from '@/i18n'

/**
 * 首页「登录失效提醒」横幅状态与自动刷新。
 *
 * 关键修正（2026-09-12）：不再读数据库 status === 'expired'（PR #1677
 * 之后 checkLogin 已不写该字段，遗留脏数据会导致已登录账号误判失效），
 * 改为实际调用 accountBatchCheckLogin 确认当前登录状态。
 *
 * - expiredAccounts / expiredAccountCount / showExpiredBanner 为横幅渲染状态；
 * - refresh() 调 accountBatchCheckLogin 逐账号验证，仅真正失效的才入列；
 * - 登录态持久化由主进程单一写者完成（accounts:batch-check-login 内部
 *   AccountManager.persistLoginState → 后端 accounts.json），本文件不再回写；
 *   历史实现在这里 accountUpdate()，写的是 Electron 本地 SQLite，
 *   与读取端（后端 accounts.json）不是同一个库，用户看到主页与账号页
 *   失效计数不一致、且结论不固化（登录态口径统一修复 2026-09-22）；
 * - 三态口径：只有 valid === false 才算失效；valid === undefined 为「未确认」，
 *   不进横幅、不计入失效数量；
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
      // 三态：valid === false 才是「确认失效」；undefined 是「未确认」，不得冒充失效。
      const expired = accounts.filter(account => {
        const check = results.find(r => r.accountId === account.id)
        return Boolean(check) && check.valid === false
      })
      // 主进程回写失败时结果里带 persisted.ok === false，横幅侧必须暴露出来。
      const persistFailed = results.filter(r => r && r.persisted && r.persisted.ok === false)
      if (persistFailed.length > 0) {
        reportError(
          i18n.global.t('accountsPage.persistFailedTitle', { count: persistFailed.length }),
          new Error(persistFailed.map(r => String(r.accountId) + ':' + String((r.persisted && r.persisted.reason) || 'unknown')).join(', ')),
        )
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
