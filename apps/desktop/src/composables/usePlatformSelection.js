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
import { canAddPlatform as canAddPlatformByLimits, platformLimitState } from '@/features/member/plan-limits'

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
 * @param {object} [options]
 * @param {() => (object|null)} [options.getEntitlement] - 返回当前 entitlement 的 getter。
 *   不传 = 不做档位限制（既有调用方与单测零改动）；传了但 limits 缺失时按「不限」放行
 *   （见 features/member/plan-limits.js 的缺失即放行纪律）。
 * @returns {object} 响应式状态 + 方法
 */
export function usePlatformSelection(accountStore, platformCatalog = null, options = {}) {
  const selectedPlatforms = ref(['wechat_mp'])
  const selectedAccounts = ref({}) // { platformId: accountId[] }
  const getEntitlement = typeof options.getEntitlement === 'function' ? options.getEntitlement : () => null

  const hasVideoPlatforms = computed(function () {
    return selectedPlatforms.value.some(function (p) {
      return isVideoContentPlatform(p, platformCatalog)
    })
  })

  // 档位限制的只读视图：UI 可以直接展示「已选 N / 上限 M」而不必自己读 limits。
  const platformLimit = computed(function () {
    return platformLimitState(getEntitlement(), selectedPlatforms.value.length)
  })

  /** 是否还能追加平台（已选中的不受限，取消选择永远允许）。 */
  function canAddPlatform(platformId) {
    if (selectedPlatforms.value.indexOf(platformId) !== -1) return true
    return canAddPlatformByLimits(getEntitlement(), selectedPlatforms.value.length)
  }

  /**
   * 切换平台。
   * @returns {boolean} true = 已处理（选中或取消）；false = 被档位上限拒绝（调用方负责提示）
   */
  function togglePlatform(platformId) {
    const idx = selectedPlatforms.value.indexOf(platformId)
    if (idx === -1) {
      if (!canAddPlatform(platformId)) return false
      selectedPlatforms.value.push(platformId)
      return true
    }
    selectedPlatforms.value.splice(idx, 1)
    return true
  }

  // 「按组添加」（P2-8b）需要的是**只选不取消**的写入器。借用 togglePlatform 现在能过，
  // 因为它此刻只在"未选中"时被调用；但那是把调用方的时序当契约——一旦有人在别处复用
  // 这段判据（比如将来加"按组替换"），同样的调用就变成取消选择。显式写一次，成本两行。
  function selectPlatform(platformId) {
    if (selectedPlatforms.value.indexOf(platformId) === -1) {
      // 按组添加同受档位上限约束：否则一条「应用分组」就能绕过单点选择的上限。
      if (!canAddPlatform(platformId)) return false
      selectedPlatforms.value.push(platformId)
    }
    return true
  }

  function selectAccount(platformId, accountId) {
    const current = getSelectedAccountIds(platformId)
    if (current.indexOf(accountId) === -1) {
      current.push(accountId)
      setSelectedAccountIds(platformId, current)
    }
  }

  /**
   * 清空全部发布目标（publish-target-select-all 的「清空」按钮）。
   *
   * 刻意**不**提供"反选"：反选后选中的恰是"没有可用账号的平台"集合，
   * 用户得到的是一个必然被 validatePublishTargets 拒绝的状态（见 PRD §2.2）。
   * 清空是唯一无歧义的逆向操作，且与"再点一次全选即恢复"的撤销路径天然配对。
   *
   * 只动 selectedPlatforms：selectedAccounts 由 reconcileSelectedAccounts 的
   * deep watch 自动清理（凡不在 selectedPlatforms 里的平台键直接 delete），
   * 不在这里手写第二份清理逻辑。
   */
  function clearPlatforms() {
    selectedPlatforms.value = []
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
    platformLimit,
    canAddPlatform,
    isVideoPlatform: (platformId) => isVideoContentPlatform(platformId, platformCatalog),
    togglePlatform,
    selectPlatform,
    selectAccount,
    clearPlatforms,
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
