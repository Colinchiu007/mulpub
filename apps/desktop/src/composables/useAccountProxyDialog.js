import { ref } from 'vue'

/**
 * useAccountProxyDialog — 账号代理设置弹窗的状态与流程（2026-10-15，nav-perf-ux）
 *
 * ## 为什么独立成 composable
 *
 * ① **范式**：本仓页面逻辑一律下沉到 composable（`useAccountActions`、
 *    `usePublishHistoryMetrics`、`useHistoryCoverThumbnails` …）；而 `Accounts.vue`
 *    是 `check-max-lines` 点名还账的超长文件（零增长容差），新逻辑不该继续堆进视图。
 * ② **关注点**：代理弹窗自带五个态（未读 / 读取中 / 读到 / 读失败 / 保存中）与两次
 *    往返（按需读 + 保存或清除），与「账号列表本身」的关注点正交。
 *
 * ## 为什么代理状态是「按需」读的
 *
 * 改造前 `accounts:list` 为给每个账号附加 `proxy`，逐账号走
 * `getAccountProxyStatus()` → `loadCredential()` → `decryptData()` → `deriveKey()` →
 * `crypto.pbkdf2Sync(100000)`。同步 PBKDF2 **阻塞主进程事件循环**，N 个账号 = N×125ms
 * 串行（实测 8 账号 `accounts:list` 1451–1579ms），用户感知为「点左侧菜单『账号』
 * 好几秒才加载」。
 *
 * #3591 把它改成异步并行（wall-time 降 3.5–3.7x，但**总 CPU 未减**，且每次进页复发）。
 * 本次改为：列表路径**一次解密都不做**，代理状态只在用户点开弹窗时经
 * `account:get-proxy` 读一次。
 *
 * ## 交互契约（惰性化必然引入的三个态，缺一不可）
 *
 * 少了它们，用户会先看到「当前未配置代理」的假象，再被异步到达的数据填上：
 *  - 打开即显示「正在读取当前代理配置…」；主进程走异步密钥派生，界面不卡
 *  - 读到 → 预填当前代理（掩码态）；确实未配置 → 如实显示「当前未配置」
 *  - 读失败 → 显示可重试的错误提示，且**不关闭弹窗**：用户仍可填一份新代理并保存
 *
 * @param {object} deps
 * @param {object} deps.accountActions `useAccountActions()` 的返回值（需含 `getProxy` / `setProxy`）
 * @param {() => Promise<void>} deps.refresh 保存/清除成功后刷新账号列表
 * @param {(key: string, params?: object) => void} deps.notifySuccess
 * @param {(key: string, params?: object) => void} deps.notifyError
 * @param {(err: unknown, opts: { fallback: string }) => { message: string }} deps.formatUserError
 * @param {(key: string) => string} deps.t i18n 翻译函数
 */
export function useAccountProxyDialog ({
  accountActions,
  refresh,
  notifySuccess,
  notifyError,
  formatUserError,
  t,
}) {
  const showProxyDialog = ref(false)
  const proxyAccount = ref(null)
  const savingProxy = ref(false)
  // 惰性读取的两个态：弹窗打开后有一次解密往返，必须有 loading，
  // 否则用户先看到「当前未配置代理」的假象再被填上。
  const proxyLoading = ref(false)
  const proxyLoadError = ref('')

  /** 读取 `proxyAccount` 当前的代理状态（打开弹窗时调一次；失败后由「重试」再调） */
  async function loadProxyForDialog () {
    const account = proxyAccount.value
    if (!account) return
    proxyLoading.value = true
    proxyLoadError.value = ''
    try {
      const result = await accountActions.getProxy(account)
      if (result?.code !== 0) {
        proxyLoadError.value = formatUserError(result, { fallback: t('accountsPage.proxyLoadFailed') }).message
        return
      }
      // 只替换 proxy 字段，其余字段保持列表里的原值（id / platform 供保存与清除使用）
      proxyAccount.value = { ...account, proxy: result?.data || { configured: false } }
    } catch (error) {
      proxyLoadError.value = formatUserError(error, { fallback: t('accountsPage.proxyLoadFailed') }).message
    } finally {
      proxyLoading.value = false
    }
  }

  /**
   * 打开代理设置弹窗 —— **按需**读取该账号的代理状态。
   *
   * `account` 来自列表，**已不含 proxy**，所以先给一份最小占位（避免下游读 undefined），
   * 再用读到的公开态替换。占位期间由 `proxyLoading` 驱动弹窗显示加载态。
   */
  async function openProxyDialog (account) {
    proxyAccount.value = { ...account, proxy: { configured: false } }
    proxyLoadError.value = ''
    showProxyDialog.value = true
    await loadProxyForDialog()
  }

  function closeProxyDialog () {
    if (savingProxy.value) return
    showProxyDialog.value = false
    proxyAccount.value = null
    proxyLoading.value = false
    proxyLoadError.value = ''
  }

  async function saveProxy (proxy) {
    if (!proxyAccount.value) return
    savingProxy.value = true
    try {
      const result = await accountActions.setProxy(proxyAccount.value, proxy)
      if (result?.code !== 0) {
        notifyError('accountsPage.saveProxyFailed', { message: formatUserError(result, { fallback: t('accountsPage.saveProxyFailed') }).message })
        return
      }
      notifySuccess('accountsPage.proxySaved')
      await refresh()
      closeProxyDialog()
    } catch (error) {
      notifyError('accountsPage.saveProxyFailed', { message: formatUserError(error, { fallback: t('accountsPage.saveProxyFailed') }).message })
    } finally {
      savingProxy.value = false
    }
  }

  async function clearProxy () {
    if (!proxyAccount.value) return
    savingProxy.value = true
    try {
      const result = await accountActions.setProxy(proxyAccount.value, null)
      if (result?.code !== 0) {
        notifyError('accountsPage.clearProxyFailed', { message: formatUserError(result, { fallback: t('accountsPage.clearProxyFailed') }).message })
        return
      }
      notifySuccess('accountsPage.proxyCleared')
      await refresh()
      closeProxyDialog()
    } catch (error) {
      notifyError('accountsPage.clearProxyFailed', { message: formatUserError(error, { fallback: t('accountsPage.clearProxyFailed') }).message })
    } finally {
      savingProxy.value = false
    }
  }

  return {
    showProxyDialog,
    proxyAccount,
    savingProxy,
    proxyLoading,
    proxyLoadError,
    openProxyDialog,
    loadProxyForDialog,
    closeProxyDialog,
    saveProxy,
    clearProxy,
  }
}
