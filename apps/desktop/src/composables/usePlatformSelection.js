// @ts-check
/**
 * usePlatformSelection.js — 平台选择 composable（从 Publish.vue 拆分）
 *
 * 职责：
 *   - 维护 selectedPlatforms / selectedAccounts 状态
 *   - togglePlatform 切换平台选择
 *   - hasVideoPlatforms 检测视频平台
 *   - watch 同步 selectedAccounts 默认值
 *
 * 依赖：accountStore（传入参数）
 */
import { ref, computed, watch } from 'vue'
import { normalizeAccountIds } from '@/features/publish/publish-contract'
import { isAccountActive } from '@/utils/account-active'

const VIDEO_PLATFORMS = new Set(['douyin', 'tencent_video', 'kuaishou', 'bilibili', 'tiktok', 'youtube'])
const VIDEO_CONTENT_CATEGORIES = new Set(['VIDEO', 'MIXED'])

/**
 * 依据平台目录的内容分类判断是否需要视频媒体输入。
 * VIDEO 平台只支持视频，MIXED 平台同时支持图文和视频；目录未加载时
 * 回退到已知平台集合，兼容旧版调用方。
 * @param {string} platformId
 * @param {object} platformCatalog
 * @returns {boolean}
 */
export function isVideoContentPlatform(platformId, platformCatalog) {
  const getter = platformCatalog && platformCatalog.getContentCategory
  if (typeof getter === 'function') {
    const category = getter(platformId)
    if (typeof category === 'string' && category.trim()) {
      return VIDEO_CONTENT_CATEGORIES.has(category.trim().toUpperCase())
    }
  }
  const contentCategories = platformCatalog && platformCatalog.contentCategories
  const categoryMap = contentCategories && contentCategories.value
    ? contentCategories.value
    : contentCategories
  const category = categoryMap && categoryMap[platformId]
  if (typeof category === 'string' && category.trim()) {
    return VIDEO_CONTENT_CATEGORIES.has(category.trim().toUpperCase())
  }
  return VIDEO_PLATFORMS.has(platformId)
}

/**
 * 平台选择 composable
 * @param {object} accountStore - 账号 store（需有 byPlatform / getDefault）
 * @param {object} [platformCatalog] - 平台 store/catalog（可提供 getContentCategory）
 * @returns {object} 响应式状态 + 方法
 */
export function usePlatformSelection(accountStore, platformCatalog = null) {
  const selectedPlatforms = ref(['wechat_mp'])
  const selectedAccounts = ref({}) // { platformId: accountId[] }

  const hasVideoPlatforms = computed(function () {
    return selectedPlatforms.value.some(function (p) {
      return isVideoContentPlatform(p, platformCatalog)
    })
  })

  function togglePlatform(platformId) {
    const idx = selectedPlatforms.value.indexOf(platformId)
    if (idx === -1) {
      selectedPlatforms.value.push(platformId)
    } else {
      selectedPlatforms.value.splice(idx, 1)
    }
  }

  function getAccounts(platformId) {
    const byPlatform = accountStore.byPlatform?.value || accountStore.byPlatform
    const list = (byPlatform && byPlatform[platformId]) || []
    // 启用态收口点：停用账号不进入可选集合。getAvailableAccountIds / isAccountAvailable /
    // reconcileSelectedAccounts 全部经由本函数，因此「不可勾选」「不作默认回填」
    // 「已选中的自动剔除」三条语义共用同一个判定，不会各写一遍而漂移。
    return list.filter(account => isAccountActive(account))
  }

  function getDefaultAccount(platformId) {
    return accountStore.getDefault(platformId)
  }

  function getSelectedAccountIds(platformId) {
    return normalizeAccountIds(selectedAccounts.value[platformId])
  }

  function setSelectedAccountIds(platformId, accountIds) {
    selectedAccounts.value[platformId] = normalizeAccountIds(accountIds)
  }

  function toggleAccount(platformId, accountId) {
    const current = getSelectedAccountIds(platformId)
    const index = current.indexOf(accountId)
    if (index === -1) current.push(accountId)
    else current.splice(index, 1)
    setSelectedAccountIds(platformId, current)
  }

  function isAccountSelected(platformId, accountId) {
    return getSelectedAccountIds(platformId).includes(accountId)
  }

  function getAvailableAccountIds(platformId) {
    return normalizeAccountIds(getAccounts(platformId).map(account => (
      account?.id || account?.accountId || account?.account_id
    )))
  }

  function isAccountAvailable(platformId, accountId) {
    return getAvailableAccountIds(platformId).includes(accountId)
  }

  function sameAccountIds(rawValue, accountIds) {
    if (!Array.isArray(rawValue) || rawValue.length !== accountIds.length) return false
    return rawValue.every((id, index) => id === accountIds[index])
  }

  function reconcileSelectedAccounts() {
    const newPlatforms = Array.isArray(selectedPlatforms.value) ? selectedPlatforms.value : []
    for (const pid of newPlatforms) {
      const availableIds = getAvailableAccountIds(pid)
      const availableIdSet = new Set(availableIds)
      let selected = getSelectedAccountIds(pid).filter(accountId => availableIdSet.has(accountId))
      if (selected.length === 0 && availableIds.length > 0) {
        const def = getDefaultAccount(pid)
        const defaultId = def?.id || def?.accountId || def?.account_id
        if (typeof defaultId === 'string' && availableIdSet.has(defaultId)) selected = [defaultId]
      }
      if (selected.length > 0) {
        if (!sameAccountIds(selectedAccounts.value[pid], selected)) {
          setSelectedAccountIds(pid, selected)
        }
      } else if (Object.prototype.hasOwnProperty.call(selectedAccounts.value, pid)) {
        delete selectedAccounts.value[pid]
      }
    }
    for (const pid of Object.keys(selectedAccounts.value)) {
      if (newPlatforms.indexOf(pid) === -1) {
        delete selectedAccounts.value[pid]
      }
    }
  }

  watch(
    [selectedPlatforms, () => accountStore.byPlatform?.value || accountStore.byPlatform, selectedAccounts],
    reconcileSelectedAccounts,
    { deep: true },
  )

  return {
    selectedPlatforms,
    selectedAccounts,
    hasVideoPlatforms,
    isVideoPlatform: (platformId) => isVideoContentPlatform(platformId, platformCatalog),
    togglePlatform,
    getAccounts,
    getDefaultAccount,
    getSelectedAccountIds,
    setSelectedAccountIds,
    toggleAccount,
    isAccountSelected,
    getAvailableAccountIds,
    isAccountAvailable,
    reconcileSelectedAccounts,
  }
}
