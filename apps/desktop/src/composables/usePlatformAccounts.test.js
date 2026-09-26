// @ts-check
/**
 * usePlatformAccounts.test.js — 平台账号 composable 测试（Phase 4.1 TDD）
 *
 * 范式：参考 useProviderFilters.test.js
 *   - 纯函数直接 import 测试（platformMeta / getDefaultAccount / getAccountText /
 *     getStatusClass / filterPlatforms）
 *   - composable setup 函数测试 window.electronAPI 副作用
 */
import { ref } from 'vue'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PLATFORM_NAMES } from '@multi-publish/shared-utils/src/platform-definitions'
import platformDisplayDefinitions from '@multi-publish/shared-utils/src/platform-display-definitions.json'

const publisherApi = vi.hoisted(() => ({
  accountList: vi.fn(() => window.electronAPI?.accountList?.() ?? Promise.resolve({ code: -1, data: [] })),
  accountSetDefault: vi.fn((platform, accountId) => window.electronAPI?.accountSetDefault?.(platform, accountId)),
}))

vi.mock('@/api/publisher', () => publisherApi)
import {
  platformMeta,
  getDefaultAccount,
  getAccountText,
  getStatusClass,
  filterPlatforms,
  usePlatformAccounts,
} from '../composables/usePlatformAccounts'

// ─── 纯函数测试 ────────────────────────────────────────
describe('usePlatformAccounts — 纯函数', () => {
  describe('platformMeta', () => {
    it('与共享平台定义完全一致', () => {
      const ids = Object.keys(platformMeta)
      expect(ids).toEqual(Object.keys(PLATFORM_NAMES))
      expect(ids).toEqual(Object.keys(platformDisplayDefinitions.PLATFORM_NAMES))
      expect(ids).not.toContain('yidian')
      expect(ids).toContain('instagram')
      expect(ids).toContain('facebook')
    })

    it('每个平台都有 label 和 icon', () => {
      for (const id of Object.keys(platformMeta)) {
        expect(platformMeta[id].label).toBeTruthy()
        expect(platformMeta[id].icon).toBeTruthy()
      }
    })

    it('包含 wechat_mp / zhihu / weibo / douyin / xiaohongshu', () => {
      expect(platformMeta.wechat_mp.label).toBe('微信公众号')
      expect(platformMeta.zhihu.label).toBe('知乎')
      expect(platformMeta.weibo.label).toBe('微博')
      expect(platformMeta.douyin.label).toBe('抖音')
      expect(platformMeta.xiaohongshu.label).toBe('小红书')
    })

    it('包含 youtube / tiktok / twitter', () => {
      expect(platformMeta.youtube).toBeDefined()
      expect(platformMeta.tiktok).toBeDefined()
      expect(platformMeta.twitter).toBeDefined()
    })
  })

  describe('getDefaultAccount', () => {
    it('返回 is_default 的账号', () => {
      const accounts = [
        { id: 'a1', name: 'A', is_default: false },
        { id: 'a2', name: 'B', is_default: true },
      ]
      expect(getDefaultAccount(accounts).id).toBe('a2')
    })

    it('无 is_default 时返回第一个', () => {
      const accounts = [
        { id: 'a1', name: 'A' },
        { id: 'a2', name: 'B' },
      ]
      expect(getDefaultAccount(accounts).id).toBe('a1')
    })

    it('空数组返回 null', () => {
      expect(getDefaultAccount([])).toBeNull()
    })

    it('null/undefined 返回 null', () => {
      expect(getDefaultAccount(null)).toBeNull()
      expect(getDefaultAccount(undefined)).toBeNull()
    })
  })

  describe('getAccountText', () => {
    it('有显示名时返回 account_name（与账号卡片同源）', () => {
      const accounts = [{ id: 'a1', account_name: '我的账号', is_default: true }]
      expect(getAccountText(accounts)).toBe('我的账号')
    })

    it('name 是 document.title 落盘位，绝不作为侧栏文案', () => {
      // 真实 accounts.json 里 douyin 的 name 就是「抖音创作者中心」这类标题
      expect(getAccountText([{ id: 'a1', platform: 'douyin', name: '抖音创作者中心', is_default: true }]))
        .toBe('抖音')
      expect(getAccountText([{ id: 'a1', name: '首页 - 知乎', is_default: true }])).toBe('已登录')
    })

    it('有账号但无 name 时返回"已登录"', () => {
      const accounts = [{ id: 'a1', is_default: true }]
      expect(getAccountText(accounts)).toBe('已登录')
    })

    it('无账号时返回"未登录"', () => {
      expect(getAccountText([])).toBe('未登录')
      expect(getAccountText(null)).toBe('未登录')
    })
  })

  describe('getStatusClass', () => {
    it('无账号返回 offline', () => {
      expect(getStatusClass([])).toBe('offline')
      expect(getStatusClass(null)).toBe('offline')
    })

    it('active 状态返回 online', () => {
      const accounts = [{ id: 'a1', status: 'active', is_default: true }]
      expect(getStatusClass(accounts)).toBe('online')
    })

    it('online 状态返回 online', () => {
      const accounts = [{ id: 'a1', status: 'online', is_default: true }]
      expect(getStatusClass(accounts)).toBe('online')
    })

    it('其他状态返回 offline', () => {
      const accounts = [{ id: 'a1', status: 'disabled', is_default: true }]
      expect(getStatusClass(accounts)).toBe('offline')
    })
  })

  describe('filterPlatforms', () => {
    const ids = Object.keys(platformMeta)

    it('无搜索词返回全部', () => {
      expect(filterPlatforms(ids, '', platformMeta)).toHaveLength(ids.length)
    })

    it('按 label 中文搜索', () => {
      const result = filterPlatforms(ids, '微信', platformMeta)
      expect(result).toContain('wechat_mp')
    })

    it('按 id 搜索（小写匹配）', () => {
      const result = filterPlatforms(ids, 'wechat', platformMeta)
      expect(result).toContain('wechat_mp')
    })

    it('搜索词大小写不敏感', () => {
      const result = filterPlatforms(ids, 'WECHAT', platformMeta)
      expect(result).toContain('wechat_mp')
    })

    it('无匹配返回空数组', () => {
      const result = filterPlatforms(ids, '不存在的平台', platformMeta)
      expect(result).toEqual([])
    })
  })
})

// ─── composable setup 测试 ────────────────────────────
describe('usePlatformAccounts — composable setup', () => {
  let originalElectronAPI

  beforeEach(() => {
    originalElectronAPI = window.electronAPI
    vi.clearAllMocks()
  })

  afterEach(() => {
    window.electronAPI = originalElectronAPI
  })

  it('返回响应式状态和方法', () => {
    window.electronAPI = {}
    const r = usePlatformAccounts()
    expect(r.platformSearch).toBeDefined()
    expect(r.activePlatform).toBeDefined()
    expect(r.platformAccounts).toBeDefined()
    expect(r.loaded).toBeDefined()
    expect(r.filteredPlatforms).toBeDefined()
    expect(typeof r.loadAccounts).toBe('function')
    expect(typeof r.switchAccount).toBe('function')
    expect(typeof r.getDefaultAccount).toBe('function')
    expect(typeof r.getAccountText).toBe('function')
    expect(typeof r.getStatusClass).toBe('function')
    expect(typeof r.getAccountsForPlatform).toBe('function')
  })

  it('filteredPlatforms 初始返回共享定义中的全部平台', () => {
    window.electronAPI = {}
    const r = usePlatformAccounts()
    expect(r.filteredPlatforms.value).toHaveLength(Object.keys(PLATFORM_NAMES).length)
  })

  it('filteredPlatforms 响应 platformSearch 变化', () => {
    window.electronAPI = {}
    const r = usePlatformAccounts()
    r.platformSearch.value = '微信'
    expect(r.filteredPlugins).toBeUndefined() // 确认无此字段
    expect(r.filteredPlatforms.value).toContain('wechat_mp')
    r.platformSearch.value = ''
    expect(r.filteredPlatforms.value).toHaveLength(Object.keys(PLATFORM_NAMES).length)
  })

  it('loadAccounts 无 electronAPI 时安全返回（loaded=true）', async () => {
    window.electronAPI = undefined
    const r = usePlatformAccounts()
    await expect(r.loadAccounts()).resolves.toBeUndefined()
    expect(r.loaded.value).toBe(true)
  })

  it('loadAccounts 无 accountList 方法时安全返回', async () => {
    window.electronAPI = {}
    const r = usePlatformAccounts()
    await r.loadAccounts()
    expect(r.loaded.value).toBe(true)
  })

  it('loadAccounts 成功时按 platform 分组', async () => {
    const accountList = vi.fn(function () {
      return Promise.resolve({
        code: 0,
        data: [
          { id: 'a1', platform: 'wechat_mp', name: '公众号A', is_default: true },
          { id: 'a2', platform: 'wechat_mp', name: '公众号B' },
          { id: 'a3', platform: 'zhihu', name: '知乎号', is_default: true },
        ],
      })
    })
    window.electronAPI = { accountList }
    const r = usePlatformAccounts()
    await r.loadAccounts()
    expect(r.platformAccounts.value.wechat_mp).toHaveLength(2)
    expect(r.platformAccounts.value.zhihu).toHaveLength(1)
    expect(r.loaded.value).toBe(true)
    expect(publisherApi.accountList).toHaveBeenCalledTimes(1)
  })

  it('loadAccounts code!=0 时不更新 platformAccounts', async () => {
    const accountList = vi.fn(function () {
      return Promise.resolve({ code: 1, data: [] })
    })
    window.electronAPI = { accountList }
    const r = usePlatformAccounts()
    r.platformAccounts.value = { existing: [{ id: 'x' }] }
    await r.loadAccounts()
    expect(r.platformAccounts.value.existing).toHaveLength(1)
  })

  it('loadAccounts data 非 Array 时安全处理', async () => {
    const accountList = vi.fn(function () {
      return Promise.resolve({ code: 0, data: null })
    })
    window.electronAPI = { accountList }
    const r = usePlatformAccounts()
    await expect(r.loadAccounts()).resolves.toBeUndefined()
  })

  it('loadAccounts 抛错时 loaded=true 且不崩溃', async () => {
    const accountList = vi.fn(function () { throw new Error('net error') })
    window.electronAPI = { accountList }
    const r = usePlatformAccounts()
    await r.loadAccounts()
    expect(r.loaded.value).toBe(true)
  })

  it('switchAccount 无 electronAPI 时安全返回', async () => {
    window.electronAPI = undefined
    const r = usePlatformAccounts()
    await expect(r.switchAccount('wechat_mp', 'a1')).resolves.toBeUndefined()
  })

  it('switchAccount 无 accountSetDefault 方法时安全返回', async () => {
    window.electronAPI = {}
    const r = usePlatformAccounts()
    await r.switchAccount('wechat_mp', 'a1')
  })

  it('switchAccount 调用 accountSetDefault 后刷新 loadAccounts', async () => {
    const accountSetDefault = vi.fn(function () { return Promise.resolve() })
    const accountList = vi.fn(function () {
      return Promise.resolve({ code: 0, data: [] })
    })
    window.electronAPI = { accountSetDefault, accountList }
    const r = usePlatformAccounts()
    await r.switchAccount('wechat_mp', 'a2')
    expect(accountSetDefault).toHaveBeenCalledWith('wechat_mp', 'a2')
    expect(publisherApi.accountSetDefault).toHaveBeenCalledWith('wechat_mp', 'a2')
    expect(accountList).toHaveBeenCalledTimes(1) // 刷新一次
  })

  it('switchAccount 抛错时不崩溃', async () => {
    const accountSetDefault = vi.fn(function () { throw new Error('fail') })
    window.electronAPI = { accountSetDefault }
    const r = usePlatformAccounts()
    await expect(r.switchAccount('wechat_mp', 'a1')).resolves.toBeUndefined()
  })

  it('getAccountsForPlatform 返回对应平台账号数组', () => {
    window.electronAPI = {}
    const r = usePlatformAccounts()
    r.platformAccounts.value = {
      wechat_mp: [{ id: 'a1' }, { id: 'a2' }],
      zhihu: [{ id: 'a3' }],
    }
    expect(r.getAccountsForPlatform('wechat_mp')).toHaveLength(2)
    expect(r.getAccountsForPlatform('zhihu')).toHaveLength(1)
    expect(r.getAccountsForPlatform('bilibili')).toEqual([])
  })

  it('getDefaultAccount/getAccountText/getStatusClass 包装纯函数', () => {
    window.electronAPI = {}
    const r = usePlatformAccounts()
    r.platformAccounts.value = {
      wechat_mp: [{ id: 'a1', account_name: '测试', status: 'active', is_default: true }],
    }
    expect(r.getDefaultAccount('wechat_mp').id).toBe('a1')
    expect(r.getAccountText('wechat_mp')).toBe('测试')
    expect(r.getStatusClass('wechat_mp')).toBe('online')
    expect(r.getDefaultAccount('bilibili')).toBeNull()
    expect(r.getAccountText('bilibili')).toBe('未登录')
    expect(r.getStatusClass('bilibili')).toBe('offline')
  })

  it('注入账号 Store 时共享同一响应式账号源并复用账号操作', async () => {
    const grouped = ref({
      wechat_mp: [{ id: 'a1', platform: 'wechat_mp', name: '公众号A', is_default: true }],
    })
    const accountStore = {
      get byPlatform() { return grouped.value },
      load: vi.fn(async () => undefined),
      setDefault: vi.fn(async () => ({ code: 0, data: true })),
    }
    const r = usePlatformAccounts({ accountStore })

    expect(r.getAccountsForPlatform('wechat_mp')).toHaveLength(1)
    grouped.value = {
      wechat_mp: [
        { id: 'a1', platform: 'wechat_mp', name: '公众号A' },
        { id: 'a2', platform: 'wechat_mp', name: '公众号B', is_default: true },
      ],
    }
    expect(r.getAccountsForPlatform('wechat_mp')).toHaveLength(2)

    await r.loadAccounts()
    await r.switchAccount('wechat_mp', 'a2')

    expect(accountStore.load).toHaveBeenCalledTimes(1)
    expect(accountStore.setDefault).toHaveBeenCalledWith('a2', 'wechat_mp')
    expect(publisherApi.accountList).not.toHaveBeenCalled()
    expect(publisherApi.accountSetDefault).not.toHaveBeenCalled()
  })
})
