/**
 * usePublishAddAccount.js — 发布页「请先添加账号」空态出口的接线层
 *
 * 存在的理由：`PublishTargetSelector.vue` 的账号区空态原来只有一句灰字「请先添加账号」，
 * 用户看到一个平台能选却没有任何账号可选，且页面上没有任何出口（必须先跳去账号页）。
 * 本刀补两个出口：「添加」（打开该平台登录页的新标签）与「已经添加成功？点击刷新」
 * （重新拉账号列表）。契约见 `01-docs/PRD-PUBLISH-ADD-ACCOUNT-ENTRY-2026-10-15.md`。
 *
 * 三条不可移动的语义（每一条都有对应的回归测试）：
 * 1. **accountId 占位值必须合法**：主进程 `webview-manager/tab-lifecycle.js:34` 只有
 *    `SAFE_IDENTIFIER.test(accountId)` 通过才启用 `persist:account-<id>` 持久分区。
 *    不带就落到 `persist:browse-<tabId>` 临时分区 —— 登录完保存不了凭证，用户会看到
 *    "添加了但刷新后还是没有"。取 `mp-new-<platform>`（同平台复用同一分区，而不是
 *    每次随机：随机会让同一平台的两次登录落在两个互不相通的分区里）。
 * 2. **cleanSession 必须显式 true**：与 `Accounts.vue:1196` / `Home.vue:304` 同口径。
 *    它还顺带把 `credentialSaveState` 置为 `'unsaved'`（`tab-lifecycle.js:201`），
 *    NavBar 的「保存账号」按钮才会出现（`App.vue:143-146` 的 isLoginTab 判据）。
 * 3. **刷新必须走 load() 而不是 ensureLoaded()**：`stores/accounts.js:104-109` 的
 *    `ensureLoaded()` 幂等 + in-flight 缓存，已加载即 no-op。发布页 `onMounted` 调过
 *    一次之后再调它就是空操作 —— 这正是"账号新增后发布页不刷新"的根因。
 */
import { ref } from 'vue'
import i18n from '@/i18n'
import { PLATFORM_LOGIN_URLS } from '@multi-publish/shared-utils/src/platform-definitions'

/** 新账号登录标签的账号 id 占位值（同平台复用，见文件头第 1 条）。 */
function newAccountIdFor (platform) {
  return 'mp-new-' + platform
}

/** 文案解析：与既有 composable（usePublishGroupTargets.js:26）同口径，直接读全局 i18n 实例。 */
function t (key, named) {
  return i18n.global.t(key, named || {})
}

export function usePublishAddAccount ({
  tabStore,
  accountStore,
  notifyError,
  notifyWarning,
  platformLabel,
}) {
  const refreshing = ref(false)

  // 平台显示名解析：与 Accounts.vue:591-593 同口径（platformStore.getLabel(id) || id）。
  // 由调用方注入而不是 composable 自己 import platformStore —— 保持本文件可被直接单测，
  // 且不与"账号页那一份 label 解析"形成第二份实现。
  const labelOf = (id) => (typeof platformLabel === 'function' ? platformLabel(id) : id) || id

  /**
   * 打开指定平台的登录页（应用内新标签）。
   *
   * @param {string} platform 平台 id
   * @param {{busy?: boolean}} [options] busy=true（发布进行中）时不打开
   * @returns {Promise<{ok: boolean, reason?: string, tabId?: string}>}
   */
  async function openLoginForPlatform (platform, options = {}) {
    // 判据顺序：先 busy（用户正在发布，任何跳转都是打扰），再平台合法性。
    // 两路都**不调 createTab**，也不弹提示——禁用态下按钮本就点不到，这里是双保险。
    if (options && options.busy === true) return { ok: false, reason: 'busy' }
    if (typeof platform !== 'string' || !platform) return { ok: false, reason: 'unsupported' }
    const url = PLATFORM_LOGIN_URLS[platform]
    if (!url) {
      // 注册表没有登录 URL：如实告知"这个平台不能在应用内开登录页"，
      // 而不是静默失败（静默失败会让用户以为按钮坏了）。
      // 播报口径与 Accounts.vue / usePublishGroupTargets.js 一致：key 进主进程日志，
      // message 是用户实际看到的拼装文案（只给 key 会让拼装文案失去出处）。
      notifyWarning('publishPage.addAccount.loginUnsupported', {
        message: t('publishPage.addAccount.loginUnsupported', { platform: labelOf(platform) }),
        params: { platform: labelOf(platform) },
      })
      return { ok: false, reason: 'unsupported' }
    }
    try {
      const tabId = await tabStore.createTab({
        url,
        platform,
        accountId: newAccountIdFor(platform),
        cleanSession: true,
        title: t('publishPage.addAccount.loginTabTitle', { platform: labelOf(platform) }),
      })
      // createTab 合同上不抛错（stores/tab.js:269-272 内部 catch 后返回 null），
      // 但"返回 null"必须被当成失败：假成功比不提示更糟。
      if (!tabId) {
        notifyError('publishPage.addAccount.openFailed')
        return { ok: false, reason: 'open-failed' }
      }
      return { ok: true, tabId }
    } catch (error) {
      // 兜未来实现漂移：不让点击变成未捕获异常。
      notifyError('publishPage.addAccount.openFailed')
      return { ok: false, reason: 'open-failed' }
    }
  }

  /**
   * 重新拉取账号列表。
   *
   * 刻意**不**做三件事：不自动勾选新账号（静默改用户意图）、不清空旧列表
   * （刷新失败不得显示成"没有账号"）、不在成功后弹 toast（界面自己变了就是反馈）。
   *
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async function refreshAccounts () {
    if (refreshing.value) return { ok: false, reason: 'already-refreshing' }
    refreshing.value = true
    try {
      await accountStore.load()
      return { ok: true }
    } catch (error) {
      notifyError('accountsPage.loadFailed')
      return { ok: false, reason: 'load-failed' }
    } finally {
      refreshing.value = false
    }
  }

  return { refreshing, openLoginForPlatform, refreshAccounts }
}
