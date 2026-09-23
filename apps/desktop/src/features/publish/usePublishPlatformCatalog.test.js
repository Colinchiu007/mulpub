import { describe, expect, it } from 'vitest'
import { usePublishPlatformCatalog } from './usePublishPlatformCatalog'

function createPlatformStore () {
  return {
    platforms: [
      { id: 'wechat_mp', label: '微信公众号' },
      { id: 'bilibili', label: 'B站' },
      { id: 'youtube', label: 'YouTube' },
    ],
    getCategory: id => id === 'youtube' ? '海外' : '中文',
  }
}

function createAccountStore () {
  return {
    byPlatform: {
      wechat_mp: [{ id: 'wx-1' }],
      youtube: [{ id: 'yt-1' }],
    },
  }
}

describe('usePublishPlatformCatalog', () => {
  it('按平台类别分组并附带账号与展示标签', () => {
    const catalog = usePublishPlatformCatalog(createPlatformStore(), createAccountStore())

    expect(catalog.platforms.value).toEqual([
      { id: 'wechat_mp', label: '微信公众号', tag: null, tagClass: '' },
      { id: 'bilibili', label: 'B站', tag: '新', tagClass: 'cohere-tag-success' },
      { id: 'youtube', label: 'YouTube', tag: null, tagClass: '' },
    ])
    expect(catalog.groupedPlatforms.value).toEqual([
      {
        label: '国内平台',
        items: [
          { id: 'wechat_mp', label: '微信公众号', tag: null, tagClass: '', accounts: [{ id: 'wx-1', disabled: false }] },
          { id: 'bilibili', label: 'B站', tag: '新', tagClass: 'cohere-tag-success', accounts: [] },
        ],
      },
      {
        label: '国际平台',
        items: [
          { id: 'youtube', label: 'YouTube', tag: null, tagClass: '', accounts: [{ id: 'yt-1', disabled: false }] },
        ],
      },
    ])
  })

  it('未知类别默认归入国内平台', () => {
    const platformStore = { platforms: [{ id: 'custom', label: '自定义' }], getCategory: () => '' }
    const catalog = usePublishPlatformCatalog(platformStore, { byPlatform: {} })

    expect(catalog.groupedPlatforms.value[0]).toMatchObject({ label: '国内平台' })
  })

  it('停用账号仍列出但携带 disabled，供选择器渲染禁用态', () => {
    const platformStore = { platforms: [{ id: 'zhihu', label: '知乎' }], getCategory: () => '中文' }
    const accountStore = {
      byPlatform: {
        zhihu: [
          { id: 'zh-1', is_active: false },
          { id: 'zh-2' },
          { id: 'zh-3', is_active: 'no' },
        ],
      },
    }
    const catalog = usePublishPlatformCatalog(platformStore, accountStore)

    const rendered = catalog.groupedPlatforms.value[0].items[0].accounts
      .map(account => ({ id: account.id, disabled: account.disabled }))

    expect(rendered).toEqual([
      { id: 'zh-1', disabled: true },
      { id: 'zh-2', disabled: false },
      { id: 'zh-3', disabled: false },
    ])
    // 原始字段透传，供卡片渲染账号名与默认标记
    expect(catalog.groupedPlatforms.value[0].items[0].accounts[0]).toHaveProperty('is_active', false)
  })
})
