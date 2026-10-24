/**
 * 重新登录守卫（2026-10-24，account-card-login-button）
 *
 * 「登录」按钮 = **重建会话**，不是「查看会话」：
 * 主进程用**干净会话**（平台登录槽位，开局必清凭证）打开登录页，登录成功后**覆盖**账号现有凭证。
 * 因此「账号已显示已登录时点它」是一次不可逆动作 ⇒ 必须先让用户显式决定。
 *
 * 分派判据在 `utils/account-status.js` 的 `needsReloginConfirmation`（与 `accountStatusKind` 同文件，
 * 单一真源）：**只有「已登录」态需要确认** —— 它是唯一「有可用会话需要保护」的状态；
 * 已失效 / 未确认 / 异常 / 无检查记录都没有可用会话可保护，重新登录恰是它们的修复手段。
 *
 * 为什么整件事收在这里而不是散在 Accounts.vue：
 * ①确认框的文案拼装只服务这一处，却要占 Accounts.vue 二十行 —— 而 Accounts.vue 在逐文件行数门禁的
 *   **点名还账清单**里（零增长容差），新逻辑必须自己找地方落脚而不是把债务推给下一个人；
 * ②「重新登录」的门禁（要不要确认）与执行（打开登录页、失败提示、失效集合的增删纪律）是一件事，
 *   拆开写就会出现「确认过了但集合没清」这类半拉子状态。
 */
import { useI18n } from 'vue-i18n'
import { useNotify } from '@/composables/useNotify'
import { useAccountActions } from '@/composables/useAccountActions'
import { lastLoginCheckAt, needsReloginConfirmation } from '@/utils/account-status'
import { resolveAccountDisplayName } from '@/utils/account-display-name'
import { formatUserError } from '@/utils/user-facing-error'

/**
 * @param {object} options
 * @param {import('vue').Ref} options.pendingAuthAction 当前登录动作（'add' / 'relogin'）
 * @param {import('vue').Ref} options.loginMode 当前登录方式（'browser' / 'qrcode'）
 * @param {import('vue').Ref} options.checkedExpiredIds 本会话已确认失效的账号 ID 集合
 * @param {(platform: string) => string} options.platformLabel 平台显示名
 */
export function useReloginGuard (options = {}) {
  const { t, locale } = useI18n()
  const { notifyError, notifyConfirm } = useNotify()
  const accountActions = useAccountActions()
  const platformLabel = typeof options.platformLabel === 'function' ? options.platformLabel : (id) => id

  /**
   * 已登录态的二次确认。返回 true 才允许进入重新登录。
   * @param {object} account 账号对象
   * @returns {Promise<boolean>}
   */
  async function confirmRelogin (account) {
    if (!needsReloginConfirmation(account)) return true
    const checkedAt = lastLoginCheckAt(account)
    return notifyConfirm('accountsPage.reloginConfirmMessage', {
      title: t('accountsPage.reloginConfirmTitle'),
      message: t('accountsPage.reloginConfirmMessage', {
        name: resolveAccountDisplayName(account, { platformLabel: platformLabel(account.platform) }),
        platform: platformLabel(account.platform),
        // 把「最近一次检测时间」摆出来让用户自己判断这条「已登录」结论有多新 ——
        // 结论可能陈旧（上次检测可能是很久以前），判据不替用户猜。
        checkedAt: checkedAt ? checkedAt.toLocaleString(locale.value) : '',
      }),
      confirmButtonText: t('accountsPage.reloginConfirmAction'),
      cancelButtonText: t('accountsPage.cancel'),
      type: 'warning',
    })
  }

  /**
   * 重新登录：已登录态先二次确认，其余登录态直接进登录链路。
   *
   * 集合纪律（`checkedExpiredIds` = 「本会话内已确认该账号登录态失效」）：
   * - 取消重新登录 **不删**：取消 ≠ 账号恢复登录，账号仍然失效；
   *   删了会让它带着旧凭证进平台页，撞上 2026-09-16 公众号「二维码加载失败」事故路径。
   * - 重新登录成功才删：由调用方的 onCompleted 承担（主进程回传 accountId）。
   *
   * @param {object} account 账号对象
   */
  async function reloginAccount (account) {
    if (!account?.platform) return
    if (!(await confirmRelogin(account))) return
    options.pendingAuthAction.value = 'relogin'
    options.loginMode.value = 'browser'
    try {
      const result = await accountActions.openLogin('browser', account.platform, account.id)
      if (result?.cancelled) {
        options.pendingAuthAction.value = null
      } else if (result?.code !== 0) {
        options.pendingAuthAction.value = null
        notifyError('accountsPage.reloginFailed', { message: formatUserError(result, { fallback: result?.message || t('accountsPage.reloginFailed') }).message })
      }
      // 登录成功由 useAccountEvents.onCompleted 处理（notifySuccess + refresh）
    } catch (error) {
      options.pendingAuthAction.value = null
      notifyError('accountsPage.reloginFailed', { message: formatUserError(error, { fallback: t('accountsPage.reloginFailed') }).message })
    }
  }

  return { confirmRelogin, reloginAccount }
}
