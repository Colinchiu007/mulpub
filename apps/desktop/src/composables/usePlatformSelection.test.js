// @ts-check
/**
 * usePlatformSelection.test.js — 平台选择 composable 测试（Phase 4.3 TDD）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, reactive } from 'vue'
import { usePlatformSelection } from '../composables/usePlatformSelection'

function makeAccountStore() {
  return {
    byPlatform: reactive({
      wechat_mp: [
        { id: 'acc1', name: '公众号A', is_default: true },
        { id: 'acc3', name: '公众号B', is_default: false },
      ],
      zhihu: [{ id: 'acc2', name: '知乎号', is_default: true }],
    }),
    getDefault: vi.fn(function (p) {
      if (p === 'wechat_mp') return { id: 'acc1', name: '公众号A' }
      if (p === 'zhihu') return { id: 'acc2', name: '知乎号' }
      return null
    }),
  }
}

describe('usePlatformSelection — composable setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('返回响应式状态和方法', () => {
    const r = usePlatformSelection(makeAccountStore())
    expect(r.selectedPlatforms).toBeDefined()
    expect(r.selectedAccounts).toBeDefined()
    expect(r.hasVideoPlatforms).toBeDefined()
    expect(typeof r.togglePlatform).toBe('function')
    expect(typeof r.getAccounts).toBe('function')
    expect(typeof r.getDefaultAccount).toBe('function')
    expect(typeof r.getSelectedAccountIds).toBe('function')
    expect(typeof r.toggleAccount).toBe('function')
    expect(typeof r.isAccountSelected).toBe('function')
  })

  it('初始 selectedPlatforms = ["wechat_mp"]', () => {
    const r = usePlatformSelection(makeAccountStore())
    expect(r.selectedPlatforms.value).toEqual(['wechat_mp'])
  })

  it('初始 selectedAccounts 为空对象', () => {
    const r = usePlatformSelection(makeAccountStore())
    expect(r.selectedAccounts.value).toEqual({})
  })

  it('togglePlatform 添加平台', () => {
    const r = usePlatformSelection(makeAccountStore())
    r.togglePlatform('zhihu')
    expect(r.selectedPlatforms.value).toContain('zhihu')
  })

  it('togglePlatform 移除已选平台', () => {
    const r = usePlatformSelection(makeAccountStore())
    r.togglePlatform('wechat_mp')
    expect(r.selectedPlatforms.value).not.toContain('wechat_mp')
  })

  it('togglePlatform 重复添加不重复', () => {
    const r = usePlatformSelection(makeAccountStore())
    r.togglePlatform('zhihu')
    r.togglePlatform('zhihu')
    expect(r.selectedPlatforms.value).not.toContain('zhihu')
  })

  it('hasVideoPlatforms 检测视频平台', async () => {
    const r = usePlatformSelection(makeAccountStore())
    expect(r.hasVideoPlatforms.value).toBe(false)
    r.selectedPlatforms.value = ['douyin']
    await nextTick()
    expect(r.hasVideoPlatforms.value).toBe(true)
    r.selectedPlatforms.value = ['kuaishou']
    await nextTick()
    expect(r.hasVideoPlatforms.value).toBe(true)
    r.selectedPlatforms.value = ['tencent_video']
    await nextTick()
    expect(r.hasVideoPlatforms.value).toBe(true)
    r.selectedPlatforms.value = ['wechat_mp']
    await nextTick()
    expect(r.hasVideoPlatforms.value).toBe(false)
  })

  it('getAccounts 从 accountStore 获取', () => {
    const store = makeAccountStore()
    const r = usePlatformSelection(store)
    expect(r.getAccounts('wechat_mp')).toHaveLength(2)
    expect(r.getAccounts('nonexistent')).toEqual([])
  })

  it('getDefaultAccount 调用 accountStore.getDefault', () => {
    const store = makeAccountStore()
    const r = usePlatformSelection(store)
    const def = r.getDefaultAccount('wechat_mp')
    expect(store.getDefault).toHaveBeenCalledWith('wechat_mp')
    expect(def.id).toBe('acc1')
  })

  it('watch 同步：添加平台时自动设置默认账号', async () => {
    const store = makeAccountStore()
    const r = usePlatformSelection(store)
    r.selectedPlatforms.value = ['wechat_mp', 'zhihu']
    await nextTick()
    expect(r.selectedAccounts.value.wechat_mp).toEqual(['acc1'])
    expect(r.selectedAccounts.value.zhihu).toEqual(['acc2'])
  })

  it('watch 同步：移除平台时清理账号', async () => {
    const store = makeAccountStore()
    const r = usePlatformSelection(store)
    r.selectedPlatforms.value = ['wechat_mp', 'zhihu']
    await nextTick()
    expect(r.selectedAccounts.value.zhihu).toEqual(['acc2'])
    r.selectedPlatforms.value = ['wechat_mp']
    await nextTick()
    expect(r.selectedAccounts.value.zhihu).toBeUndefined()
  })

  it('watch 同步：无默认账号时不设置', async () => {
    const store = makeAccountStore()
    store.getDefault = vi.fn(function () { return null })
    const r = usePlatformSelection(store)
    r.selectedPlatforms.value = ['wechat_mp', 'unknown']
    await nextTick()
    expect(r.selectedAccounts.value.unknown).toBeUndefined()
  })

  it('初始 selectedPlatforms 已有的平台会触发 watch 设置默认账号', async () => {
    const store = makeAccountStore()
    const r = usePlatformSelection(store)
    // 初始 selectedPlatforms = ['wechat_mp']，watch 默认不立即执行
    // 但手动触发一次后应设置
    r.selectedPlatforms.value = ['wechat_mp']
    await nextTick()
    // watch 应已设置 wechat_mp 默认账号
    expect(r.selectedAccounts.value.wechat_mp).toEqual(['acc1'])
  })

  it('同平台可选择多个账号且重复选择会切换移除', async () => {
    const r = usePlatformSelection(makeAccountStore())
    r.selectedPlatforms.value = ['wechat_mp']
    await nextTick()

    r.toggleAccount('wechat_mp', 'acc3')
    expect(r.getSelectedAccountIds('wechat_mp')).toEqual(['acc1', 'acc3'])
    expect(r.isAccountSelected('wechat_mp', 'acc3')).toBe(true)

    r.toggleAccount('wechat_mp', 'acc1')
    expect(r.getSelectedAccountIds('wechat_mp')).toEqual(['acc3'])
    expect(r.isAccountSelected('wechat_mp', 'acc1')).toBe(false)
  })

  it('读取旧版单值账号选择时归一化为数组', () => {
    const r = usePlatformSelection(makeAccountStore())
    r.selectedAccounts.value.wechat_mp = 'acc1'
    expect(r.getSelectedAccountIds('wechat_mp')).toEqual(['acc1'])
  })

  it('账号列表刷新后移除失效选择并回退到当前默认账号', async () => {
    const store = makeAccountStore()
    const r = usePlatformSelection(store)
    r.selectedPlatforms.value = ['wechat_mp']
    await nextTick()
    r.setSelectedAccountIds('wechat_mp', ['acc1', 'acc3'])

    store.byPlatform.wechat_mp = [
      { id: 'acc3', name: '公众号B' },
      { id: 'acc4', name: '公众号C', is_default: true },
    ]
    store.getDefault = vi.fn(() => ({ id: 'acc4', name: '公众号C' }))
    await nextTick()
    expect(r.getSelectedAccountIds('wechat_mp')).toEqual(['acc3'])

    store.byPlatform.wechat_mp = [{ id: 'acc4', name: '公众号C', is_default: true }]
    await nextTick()
    expect(r.getSelectedAccountIds('wechat_mp')).toEqual(['acc4'])
  })

  it('草稿整体替换为失效账号后自动恢复有效默认账号', async () => {
    const r = usePlatformSelection(makeAccountStore())
    r.selectedPlatforms.value = ['wechat_mp']
    await nextTick()

    r.selectedAccounts.value = { wechat_mp: ['deleted-account'] }
    await nextTick()

    expect(r.getSelectedAccountIds('wechat_mp')).toEqual(['acc1'])
  })

  it('getAccounts 过滤停用账号，可选集合与渲染共用同一判定', () => {
    const store = makeAccountStore()
    store.byPlatform.wechat_mp = [
      { id: 'acc1', name: '公众号A', is_default: true, is_active: false },
      { id: 'acc3', name: '公众号B', is_default: false },
    ]
    const r = usePlatformSelection(store)

    expect(r.getAccounts('wechat_mp').map(account => account.id)).toEqual(['acc3'])
    expect(r.getAvailableAccountIds('wechat_mp')).toEqual(['acc3'])
    expect(r.isAccountAvailable('wechat_mp', 'acc1')).toBe(false)
  })

  it('默认账号被停用时不回填到发布目标，也不因脏 is_active 误停', async () => {
    const store = makeAccountStore()
    store.byPlatform.wechat_mp = [
      { id: 'acc1', name: '公众号A', is_default: true, is_active: false },
      { id: 'acc3', name: '公众号B', is_active: 'no' },
    ]
    const r = usePlatformSelection(store)
    r.selectedPlatforms.value = ['wechat_mp']
    await nextTick()

    // 默认账号已停用 → 不回填任何账号（与既有「无默认账号时不设置」同构），
    // 而 is_active 为脏值的 acc3 仍留在可选集合里，不被误停。
    expect(r.getAvailableAccountIds('wechat_mp')).toEqual(['acc3'])
    expect(r.getSelectedAccountIds('wechat_mp')).toEqual([])
  })

  it('已勾选账号被停用后自动从选择中剔除', async () => {
    const store = makeAccountStore()
    const r = usePlatformSelection(store)
    r.selectedPlatforms.value = ['wechat_mp']
    await nextTick()
    r.setSelectedAccountIds('wechat_mp', ['acc1', 'acc3'])

    store.byPlatform.wechat_mp = [
      { id: 'acc1', name: '公众号A', is_default: true, is_active: false },
      { id: 'acc3', name: '公众号B' },
    ]
    await nextTick()

    expect(r.getSelectedAccountIds('wechat_mp')).toEqual(['acc3'])
  })
})

describe('usePlatformSelection — 档位平台数上限（v2.0 C1.3）', () => {
  it('未传 getEntitlement 时不做限制（既有调用方零改动）', () => {
    const r = usePlatformSelection(makeAccountStore())
    for (const p of ['zhihu', 'douyin', 'weibo', 'kuaishou', 'bilibili']) r.togglePlatform(p)
    expect(r.selectedPlatforms.value.length).toBe(6)
  })

  it('免费档第 6 个平台被拒绝且返回 false（调用方据此提示）', () => {
    let entitlement = { plan: 'free', limits: { max_platforms: 5 } }
    const r = usePlatformSelection(makeAccountStore(), null, { getEntitlement: () => entitlement })
    for (const p of ['zhihu', 'douyin', 'weibo', 'kuaishou']) {
      expect(r.togglePlatform(p)).toBe(true)
    }
    expect(r.selectedPlatforms.value.length).toBe(5)
    // 第 6 个：拒绝，且状态不变
    expect(r.togglePlatform('bilibili')).toBe(false)
    expect(r.selectedPlatforms.value).not.toContain('bilibili')
    expect(r.platformLimit.value).toEqual({ limit: 5, selected: 5, atLimit: true })
  })

  it('已选中的平台永远可以取消（上限不锁死退出路径）', () => {
    const r = usePlatformSelection(makeAccountStore(), null, {
      getEntitlement: () => ({ plan: 'free', limits: { max_platforms: 1 } }),
    })
    // 初始就有 wechat_mp，上限 1 ⇒ 已满
    expect(r.canAddPlatform('zhihu')).toBe(false)
    expect(r.togglePlatform('wechat_mp')).toBe(true)
    expect(r.selectedPlatforms.value).toEqual([])
  })

  it('按组添加同受上限约束（不能绕过单点选择）', () => {
    const r = usePlatformSelection(makeAccountStore(), null, {
      getEntitlement: () => ({ plan: 'free', limits: { max_platforms: 2 } }),
    })
    expect(r.selectPlatform('zhihu')).toBe(true)
    expect(r.selectPlatform('douyin')).toBe(false)
    expect(r.selectedPlatforms.value).toEqual(['wechat_mp', 'zhihu'])
  })

  it('limits 缺失或 -1 时放行（缺失即放行 / 不限语义）', () => {
    const missing = usePlatformSelection(makeAccountStore(), null, {
      getEntitlement: () => ({ plan: 'free' }),
    })
    for (const p of ['zhihu', 'douyin', 'weibo', 'kuaishou', 'bilibili', 'toutiao']) {
      expect(missing.togglePlatform(p)).toBe(true)
    }
    const unlimited = usePlatformSelection(makeAccountStore(), null, {
      getEntitlement: () => ({ plan: 'pro', limits: { max_platforms: -1 } }),
    })
    for (const p of ['zhihu', 'douyin', 'weibo', 'kuaishou', 'bilibili', 'toutiao']) {
      expect(unlimited.togglePlatform(p)).toBe(true)
    }
    expect(unlimited.platformLimit.value.limit).toBeNull()
  })

  it('触顶时回调 onLimitReached 并带上限值（视图不再自己拼分支）', () => {
    const seen = []
    const r = usePlatformSelection(makeAccountStore(), null, {
      getEntitlement: () => ({ plan: 'free', limits: { max_platforms: 2 } }),
      onLimitReached: (limit) => seen.push(limit),
    })
    expect(r.togglePlatform('zhihu')).toBe(true)
    expect(seen).toEqual([]) // 未触顶不播报
    expect(r.togglePlatform('douyin')).toBe(false)
    expect(seen).toEqual([2])
  })

  it('降级自动裁剪：trimToLimit 保留前 N 个并回调一次（PRD N7 后半）', () => {
    const trimmed = []
    let ent = { plan: 'pro', limits: { max_platforms: -1 } }
    const r = usePlatformSelection(makeAccountStore(), null, {
      getEntitlement: () => ent,
      onTrimmed: (kept, removed) => trimmed.push({ kept, removed }),
    })
    for (const p of ['zhihu', 'douyin', 'weibo', 'kuaishou', 'bilibili', 'toutiao']) r.togglePlatform(p)
    expect(r.selectedPlatforms.value.length).toBe(7)

    expect(r.trimToLimit()).toEqual([]) // 不限 ⇒ 不裁剪
    ent = { plan: 'free', limits: { max_platforms: 3 } }
    expect(r.trimToLimit()).toEqual(['weibo', 'kuaishou', 'bilibili', 'toutiao'])
    expect(r.selectedPlatforms.value.length).toBe(3)
    expect(trimmed).toEqual([{ kept: 3, removed: ['weibo', 'kuaishou', 'bilibili', 'toutiao'] }])
  })

  it('降级后下一次切换先裁剪、再判「还能不能再加」', () => {
    let ent = { plan: 'pro', limits: { max_platforms: -1 } }
    const r = usePlatformSelection(makeAccountStore(), null, { getEntitlement: () => ent })
    for (const p of ['zhihu', 'douyin', 'weibo', 'kuaishou', 'bilibili', 'toutiao']) r.togglePlatform(p)
    ent = { plan: 'free', limits: { max_platforms: 2 } }
    expect(r.togglePlatform('zhihu')).toBe(true)
    expect(r.selectedPlatforms.value).toEqual(['wechat_mp'])
  })
})
