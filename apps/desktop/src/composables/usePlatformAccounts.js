// @ts-check
/**
 * usePlatformAccounts.js — 平台账号 composable（从 App.vue 拆分）
 *
 * 职责：
 *   - 维护侧栏平台列表 + 多账号状态
 *   - 提供 loadAccounts / switchAccount 副作用方法
 *   - 提供 getDefaultAccount / getAccountText / getStatusClass / filterPlatforms 纯函数
 *
 * 设计：
 *   - 纯函数导出（可独立测试，参考 useProviderFilters 范式）
 *   - usePlatformAccounts() 返回响应式状态 + 方法（包装纯函数 + 副作用）
 */
import { ref, computed } from 'vue'
import { accountList, accountSetDefault } from '@/api/publisher'
import platformDisplayDefinitions from '@multi-publish/shared-utils/src/platform-display-definitions.json'
import { resolveAccountDisplayName } from '@/utils/account-display-name'

const { PLATFORM_NAMES, PLATFORM_ICONS } = platformDisplayDefinitions

// 平台元数据直接派生自共享定义，避免前端平台列表漂移。
export const platformMeta = Object.fromEntries(
  Object.keys(PLATFORM_NAMES).map(function (id) {
    return [id, { label: PLATFORM_NAMES[id], icon: PLATFORM_ICONS[id] || '' }]
  }),
)

/**
 * 获取平台默认账号
 * @param {Array} accounts - 平台账号数组
 * @returns {object|null}
 */
export function getDefaultAccount(accounts) {
  if (!accounts || accounts.length === 0) return null
  return accounts.find(function (a) { return a.is_default }) || accounts[0]
}

/**
 * 获取账号显示文本
 * @param {Array} accounts - 平台账号数组
 * @returns {string}
 */
export function getAccountText(accounts) {
  const def = getDefaultAccount(accounts)
  // 侧栏平台账号文案同样走唯一入口：`def.name` 由主进程写成 document.title，
  // 不做过滤就会在侧栏出现「首页 - 知乎」这类网页标题。
  return def ? (resolveAccountDisplayName(def, {
    platformLabel: PLATFORM_NAMES[def.platform] || '',
  }) || '已登录') : '未登录'
}

/**
 * 获取账号状态 class
 * @param {Array} accounts - 平台账号数组
 * @returns {'online'|'offline'}
 */
export function getStatusClass(accounts) {
  const def = getDefaultAccount(accounts)
  if (!def) return 'offline'
  return def.status === 'active' || def.status === 'online' ? 'online' : 'offline'
}

/**
 * 过滤平台列表
 * @param {string[]} ids - 全部平台 ID
 * @param {string} search - 搜索词
 * @param {object} meta - 平台元数据
 * @returns {string[]}
 */
export function filterPlatforms(ids, search, meta) {
  if (!search) return ids
  const q = search.toLowerCase()
  return ids.filter(function (id) {
    return meta[id].label.toLowerCase().includes(q) || id.toLowerCase().includes(q)
  })
}

/**
 * 平台账号 composable
 * @returns {object} 响应式状态 + 方法
 */
export function usePlatformAccounts(options = {}) {
  const platformSearch = ref('')
  const activePlatform = ref(null)
  const accountStore = options && options.accountStore
  const platformAccounts = accountStore
    ? computed(() => accountStore.byPlatform || {})
    : ref({}) // { platformId: [account, ...] }
  const loaded = ref(false)

  const filteredPlatforms = computed(function () {
    return filterPlatforms(Object.keys(platformMeta), platformSearch.value, platformMeta)
  })

  async function loadAccounts() {
    try {
      if (accountStore) {
        await accountStore.load()
        loaded.value = true
        return
      }
      const res = await accountList()
      if (res && res.code === 0 && Array.isArray(res.data)) {
        const grouped = {}
        for (const acc of res.data) {
          if (!grouped[acc.platform]) grouped[acc.platform] = []
          grouped[acc.platform].push(acc)
        }
        platformAccounts.value = grouped
      }
      loaded.value = true
    } catch (e) {
      console.warn('Failed to load accounts:', e)
      loaded.value = true
    }
  }

  async function switchAccount(platform, accountId) {
    try {
      if (accountStore) {
        await accountStore.setDefault(accountId, platform)
        loaded.value = true
        return
      }
      await accountSetDefault(platform, accountId)
      await loadAccounts()
    } catch (e) {
      console.warn('Failed to switch account:', e)
    }
  }

  function getAccountsForPlatform(platform) {
    return platformAccounts.value[platform] || []
  }

  return {
    platformSearch,
    activePlatform,
    platformAccounts,
    loaded,
    filteredPlatforms,
    loadAccounts,
    switchAccount,
    getAccountsForPlatform,
    getDefaultAccount: function (platform) {
      return getDefaultAccount(platformAccounts.value[platform])
    },
    getAccountText: function (platform) {
      return getAccountText(platformAccounts.value[platform])
    },
    getStatusClass: function (platform) {
      return getStatusClass(platformAccounts.value[platform])
    },
  }
}
