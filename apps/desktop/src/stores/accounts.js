import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { listAccounts, accountDelete, accountSetDefault, accountUpdate, accountSetActive } from '@/api/publisher'
import { usePlatformStore } from '@/stores/platforms'
import { formatUserError } from '@/utils/user-facing-error'
import { isAccountActive } from '@/utils/account-active'
import i18n from '@/i18n'

// 上游瞬时不可用（身份服务 JWKS 抖动 / 后端 5xx / 网络与超时）时保留上一次列表：
// 「这一帧取不到」绝不能显示成「一个账号都没有」（账号页首开 25s 事故的用户可见面）。
const TRANSIENT_FAILURE_CODES = Object.freeze([
  'AUTH_JWKS_UNAVAILABLE',
  'AUTH_JWKS_INVALID',
  'NETWORK_ERROR',
  'TIMEOUT',
])

function isTransientFailure(res) {
  if (!res || typeof res !== 'object') return false
  if (TRANSIENT_FAILURE_CODES.includes(res.errorCode)) return true
  return typeof res.status === 'number' && res.status >= 500
}

/**
 * 账号管理 Store（增强版 - 参考产品复用）
 * 支持：按平台分组展示、账号分组管理、批量操作、搜索过滤、排序
 */
export const useAccountStore = defineStore('accounts', () => {
  const platformStore = usePlatformStore()
  const accounts = ref([])
  const groups = ref([])
  const favoriteIds = ref(new Set())
  const loading = ref(false)
  const error = ref(null)
  // 结构化错误码：界面按码分流（AUTH_REQUIRED → 登录引导；其余 → 错误态 + 重试）
  const errorCode = ref(null)
  const loaded = ref(false)

  const searchQuery = ref('')
  const filterStatus = ref('all')
  const filterPlatform = ref('')
  const sortBy = ref('name')
  const sortOrder = ref('asc')
  const selectedIds = ref(new Set())
  const isAllSelected = ref(false)

  async function load() {
    loading.value = true
    error.value = null
    errorCode.value = null
    let shouldReconcileMetadata = false
    let transient = false
    const loadFailedText = i18n.global.t('accountsPage.loadFailed')
    try {
      const res = await listAccounts()
      if (res && res.code === 0 && Array.isArray(res.data)) {
        accounts.value = res.data
        shouldReconcileMetadata = true
      } else if (Array.isArray(res)) {
        accounts.value = res
        shouldReconcileMetadata = true
      } else {
        // 非零 code / 结构异常：必须记录错误，否则界面会静默显示「暂无账号」
        const formatted = formatUserError(res, { fallback: loadFailedText })
        transient = isTransientFailure(res) || TRANSIENT_FAILURE_CODES.includes(formatted.errorCode)
        error.value = formatted.message
        errorCode.value = formatted.errorCode
        if (!transient) accounts.value = []
      }
      reconcileSelection()
      loadGroups()
      loadFavorites()
      if (shouldReconcileMetadata) reconcileAccountMetadata()
      // 瞬时失败不标记为已加载：下次进入账号页仍需重新拉取
      loaded.value = !transient
    } catch (e) {
      // requestBackend 直接 reject（后端未启动 / 连接超时）同样走瞬时判定：
      // 「这一帧取不到」保留上一次列表，而不是清成「暂无账号」。
      const formatted = formatUserError(e, { fallback: loadFailedText })
      transient = TRANSIENT_FAILURE_CODES.includes(formatted.errorCode)
      error.value = formatted.message
      errorCode.value = formatted.errorCode
      if (!transient) accounts.value = []
      reconcileSelection()
      loaded.value = !transient
    } finally {
      loading.value = false
    }
  }

  /** 幂等加载：已加载过则跳过，避免多处 onMounted 重复调用。
   *  缓存 in-flight Promise 防止并发竞态（多组件同时 ensureLoaded 只触发一次 load） */
  let _loadPromise = null
  async function ensureLoaded() {
    if (loaded.value && !loading.value) return
    if (_loadPromise) return _loadPromise
    _loadPromise = load().finally(() => { _loadPromise = null })
    return _loadPromise
  }

  const byPlatform = computed(() => {
    const map = {}
    for (const acc of accounts.value) {
      const p = acc.platform
      if (!map[p]) map[p] = []
      map[p].push(acc)
    }
    return map
  })

  function normalizeText (value) {
    return String(value ?? '').trim().toLocaleLowerCase('zh-CN')
  }

  function normalizeDate (value) {
    if (value === null || value === undefined || value === '') return Number.NEGATIVE_INFINITY
    const timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
  }

  function normalizeNumber (value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY
    const text = String(value ?? '').trim().replace(/,/g, '')
    if (!text) return Number.NEGATIVE_INFINITY
    const match = text.match(/^(-?\d+(?:\.\d+)?)\s*(万|w|k)?$/i)
    if (!match) return Number.NEGATIVE_INFINITY
    const base = Number(match[1])
    if (!Number.isFinite(base)) return Number.NEGATIVE_INFINITY
    const suffix = String(match[2] || '').toLowerCase()
    return base * (suffix === '万' ? 10000 : suffix === 'w' ? 10000 : suffix === 'k' ? 1000 : 1)
  }

  function normalizeStatus (value) {
    return value === 'active' || value === 'online' ? 1 : 0
  }

  function sortValue (account, field) {
    if (field === 'name') return normalizeText(account.account_name || account.name)
    if (field === 'platform') return normalizeText(platformStore.getLabel(account.platform) || account.platform)
    if (field === 'created_at' || field === 'last_used_at') return normalizeDate(account[field])
    if (field === 'followers') return normalizeNumber(account.followers ?? account.follower_count ?? account.followers_count ?? account.fans ?? account.fans_count ?? account.fansCount ?? account['粉丝数'])
    if (field === 'status') return normalizeStatus(account.status)
    const raw = account[field]
    const numeric = normalizeNumber(raw)
    return numeric !== Number.NEGATIVE_INFINITY ? numeric : normalizeText(raw)
  }

  function sortAccounts (result) {
    const field = sortBy.value || 'name'
    const direction = sortOrder.value === 'desc' ? -1 : 1
    return result
      .map((account, index) => ({ account, index, value: sortValue(account, field) }))
      .sort((left, right) => {
        if (left.value < right.value) return -1 * direction
        if (left.value > right.value) return 1 * direction
        return left.index - right.index
      })
      .map(({ account }) => account)
  }

  const accountsBeforePlatformFilter = computed(() => {
    let result = [...accounts.value]
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      result = result.filter(acc =>
        (acc.name || '').toLowerCase().includes(q) ||
        (acc.account_name || '').toLowerCase().includes(q) ||
        (acc.platform || '').toLowerCase().includes(q) ||
        String(platformStore.getLabel(acc.platform) || '').toLowerCase().includes(q)
      )
    }
    if (filterStatus.value === 'favorite') {
      result = result.filter(acc => favoriteIds.value.has(acc.id))
    } else if (filterStatus.value !== 'all') {
      result = result.filter(acc => {
        if (filterStatus.value === 'active') return acc.status === 'active' || acc.status === 'online'
        return acc.status !== 'active' && acc.status !== 'online'
      })
    }
    return sortAccounts(result)
  })

  const filteredAccounts = computed(() => {
    const result = accountsBeforePlatformFilter.value
    return filterPlatform.value
      ? result.filter(acc => acc.platform === filterPlatform.value)
      : result
  })

  const groupedByPlatform = computed(() => {
    const map = {}
    for (const acc of filteredAccounts.value) {
      const p = acc.platform
      if (!map[p]) map[p] = { platform: p, accounts: [], activeCount: 0, inactiveCount: 0 }
      map[p].accounts.push(acc)
      if (acc.status === 'active' || acc.status === 'online') map[p].activeCount++
      else map[p].inactiveCount++
    }
    return Object.values(map).sort((a, b) => b.activeCount - a.activeCount || b.accounts.length - a.accounts.length)
  })

  function syncAllSelected() {
    const visibleIds = filteredAccounts.value.map(account => account.id)
    isAllSelected.value = visibleIds.length > 0 && visibleIds.every(id => selectedIds.value.has(id))
  }

  function reconcileSelection() {
    const validIds = new Set(accounts.value.map(account => account.id))
    selectedIds.value = new Set(Array.from(selectedIds.value).filter(id => validIds.has(id)))
    syncAllSelected()
  }

  watch([filteredAccounts, selectedIds], syncAllSelected, { flush: 'sync' })

  function loadGroups() {
    try {
      const raw = localStorage.getItem('mp_account_groups')
      const parsed = raw ? JSON.parse(raw) : []
      if (!Array.isArray(parsed)) {
        groups.value = []
        return
      }
      let migrated = false
      groups.value = parsed.map(group => {
        const platformFilter = group.platformFilter || null
        let accountIds = group.accountIds
        if (!Array.isArray(accountIds)) {
          accountIds = accounts.value
            .filter(account => !platformFilter || account.platform === platformFilter)
            .map(account => account.id)
          migrated = true
        }
        return {
          ...group,
          platformFilter,
          accountIds: Array.from(new Set(accountIds)),
        }
      })
      if (migrated) saveGroups()
    } catch { groups.value = [] }
  }
  function saveGroups() {
    try {
      localStorage.setItem('mp_account_groups', JSON.stringify(groups.value))
      return true
    } catch {
      return false
    }
  }
  function createGroup(name, platformFilter, accountIds = []) {
    const normalizedPlatform = platformFilter || null
    const validIds = new Set(accounts.value
      .filter(account => !normalizedPlatform || account.platform === normalizedPlatform)
      .map(account => account.id))
    const group = {
      id: 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name,
      platformFilter: normalizedPlatform,
      accountIds: Array.from(new Set(accountIds.filter(id => validIds.has(id)))),
    }
    groups.value.push(group)
    saveGroups()
    return group
  }
  function deleteGroup(groupId) {
    groups.value = groups.value.filter(g => g.id !== groupId)
    saveGroups()
  }
  function renameGroup(groupId, name) {
    const normalizedName = String(name || '').trim()
    const group = groups.value.find(item => item.id === groupId)
    if (!group || !normalizedName) return false
    if (groups.value.some(item => item.id !== groupId && item.name === normalizedName)) return false
    group.name = normalizedName
    saveGroups()
    return true
  }
  function setGroupPlatform(groupId, platformFilter) {
    const group = groups.value.find(item => item.id === groupId)
    if (!group) return false
    const normalizedPlatform = platformFilter || null
    const validIds = new Set(accounts.value
      .filter(account => !normalizedPlatform || account.platform === normalizedPlatform)
      .map(account => account.id))
    group.platformFilter = normalizedPlatform
    group.accountIds = (group.accountIds || []).filter(accountId => validIds.has(accountId))
    saveGroups()
    return true
  }
  function getGroupAccounts(groupId) {
    const group = groups.value.find(g => g.id === groupId)
    if (!group) return []
    const memberIds = new Set(group.accountIds || [])
    return accounts.value.filter(account =>
      memberIds.has(account.id) && (!group.platformFilter || account.platform === group.platformFilter)
    )
  }
  function isAccountInGroup(groupId, accountId) {
    const group = groups.value.find(item => item.id === groupId)
    return Boolean(group && Array.isArray(group.accountIds) && group.accountIds.includes(accountId))
  }
  function toggleAccountInGroup(groupId, accountId) {
    const group = groups.value.find(item => item.id === groupId)
    const account = accounts.value.find(item => item.id === accountId)
    if (!group || !account || (group.platformFilter && account.platform !== group.platformFilter)) return false
    const next = new Set(group.accountIds || [])
    if (next.has(accountId)) next.delete(accountId)
    else next.add(accountId)
    group.accountIds = Array.from(next)
    saveGroups()
    return true
  }

  function loadFavorites() {
    try {
      const raw = localStorage.getItem('mp_account_favorites')
      const parsed = raw ? JSON.parse(raw) : []
      favoriteIds.value = new Set(Array.isArray(parsed) ? parsed : [])
    } catch {
      favoriteIds.value = new Set()
    }
  }
  function saveFavorites() {
    try {
      localStorage.setItem('mp_account_favorites', JSON.stringify(Array.from(favoriteIds.value)))
      return true
    } catch {
      return false
    }
  }
  function isFavorite(accountId) {
    return favoriteIds.value.has(accountId)
  }
  function toggleFavorite(accountId) {
    if (!accounts.value.some(account => account.id === accountId)) return false
    const next = new Set(favoriteIds.value)
    if (next.has(accountId)) next.delete(accountId)
    else next.add(accountId)
    favoriteIds.value = next
    saveFavorites()
    return true
  }
  function reconcileAccountMetadata() {
    const validIds = new Set(accounts.value.map(account => account.id))
    const nextFavorites = new Set(Array.from(favoriteIds.value).filter(id => validIds.has(id)))
    if (nextFavorites.size !== favoriteIds.value.size) {
      favoriteIds.value = nextFavorites
      saveFavorites()
    }
    let groupsChanged = false
    for (const group of groups.value) {
      const nextIds = (group.accountIds || []).filter(id => validIds.has(id))
      if (nextIds.length !== (group.accountIds || []).length) {
        group.accountIds = nextIds
        groupsChanged = true
      }
    }
    if (groupsChanged) saveGroups()
  }

  function toggleSelect(accountId) {
    if (selectedIds.value.has(accountId)) selectedIds.value.delete(accountId)
    else selectedIds.value.add(accountId)
    selectedIds.value = new Set(selectedIds.value)
    syncAllSelected()
  }
  function selectAll(accountIds) {
    const visibleIds = Array.isArray(accountIds)
      ? Array.from(new Set(accountIds))
      : filteredAccounts.value.map(account => account.id)
    const next = new Set(selectedIds.value)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => next.has(id))
    if (allVisibleSelected) visibleIds.forEach(id => next.delete(id))
    else visibleIds.forEach(id => next.add(id))
    selectedIds.value = next
    syncAllSelected()
  }
  function clearSelection() {
    selectedIds.value = new Set()
    isAllSelected.value = false
  }
  async function batchDelete(accountIds) {
    const ids = Array.isArray(accountIds)
      ? Array.from(new Set(accountIds)).filter(id => selectedIds.value.has(id))
      : Array.from(selectedIds.value)
    let success = 0, failed = 0
    for (const id of ids) {
      try {
        const res = await accountDelete(id)
        if (res.code === 0) success++; else failed++
      } catch { failed++ }
    }
    clearSelection()
    await load()
    return { success, failed }
  }
  /**
   * 批量启用 / 停用：写 is_active（启用态），与登录态 status 正交。
   * 旧实现 batchSetStatus(status) 走 accountUpdate 写 Electron SQLite，而账号列表读的是
   * 后端 accounts.json —— 写进去读不到，按钮等于装饰；且 'active'|'inactive' 与登录态
   * 词表撞车，会把「停用」误写成「已登录」。
   */
  async function batchSetActive(isActive, accountIds) {
    const ids = Array.isArray(accountIds)
      ? Array.from(new Set(accountIds)).filter(id => selectedIds.value.has(id))
      : Array.from(selectedIds.value)
    let success = 0, failed = 0
    for (const id of ids) {
      // platform 是 IPC 入参校验的必需段；解析不出来就无法定位真源，
      // 诚实计为失败而不是静默跳过（静默跳过会把「已启用 x 个」报虚）。
      const platform = accounts.value.find(account => account.id === id)?.platform
      if (typeof isActive !== 'boolean' || !platform) { failed++; continue }
      try {
        const res = await accountSetActive(id, platform, isActive)
        if (res.code === 0) success++; else failed++
      } catch { failed++ }
    }
    clearSelection()
    await load()
    return { success, failed }
  }

  function getDefault(platform) {
    const list = byPlatform.value[platform]
    if (!list || list.length === 0) return null
    return list.find(a => a.is_default) || list[0]
  }
  async function setDefault(accountId, platform) {
    const account = accounts.value.find(item => item.id === accountId)
    if (!account || account.platform !== platform) return { code: -2, message: '账号不属于指定平台' }
    try { const res = await accountSetDefault(platform, accountId); if (res.code === 0) await load(); return res }
    catch (e) { return { code: -1, message: formatUserError(e, { fallback: '操作失败' }).message } }
  }
  async function renameAccount(accountId, newName) {
    try { const res = await accountUpdate(accountId, { name: newName }); if (res.code === 0) await load(); return res }
    catch (e) { return { code: -1, message: formatUserError(e, { fallback: '操作失败' }).message } }
  }

  return {
    accounts, groups, favoriteIds, loading, error, errorCode, loaded, searchQuery, filterStatus, filterPlatform, sortBy, sortOrder, selectedIds, isAllSelected,
    byPlatform, accountsBeforePlatformFilter, filteredAccounts, groupedByPlatform,
    load, ensureLoaded, loadGroups, loadFavorites, getDefault, setDefault, renameAccount,
    createGroup, deleteGroup, renameGroup, setGroupPlatform, getGroupAccounts, isAccountInGroup, toggleAccountInGroup,
    isFavorite, toggleFavorite,
    toggleSelect, selectAll, clearSelection, batchDelete, batchSetActive, isAccountActive,
  }
})
