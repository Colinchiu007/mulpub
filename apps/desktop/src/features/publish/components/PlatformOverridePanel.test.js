import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PlatformOverridePanel from './PlatformOverridePanel.vue'

describe('PlatformOverridePanel', () => {
  const platforms = [
    { id: 'wechat_mp', label: '微信公众号', titleMax: 64, contentMax: 20000 },
    { id: 'xiaohongshu', label: '小红书', titleMax: 20, contentMax: 1000 },
    { id: 'zhihu', label: '知乎', titleMax: 120, contentMax: 100000 },
    { id: 'douyin', label: '抖音', titleMax: 55, contentMax: 2200 },
    { id: 'bilibili', label: '哔哩哔哩', titleMax: 80, contentMax: 2000 },
    { id: 'youtube', label: 'YouTube', titleMax: 100, contentMax: 5000 },
    { id: 'tiktok', label: 'TikTok', titleMax: 2200, contentMax: 2200 },
    { id: 'baijiahao', label: '百家号', titleMax: 49, contentMax: 50000 },
  ]

  it('渲染已选平台并展示限制', () => {
    const wrapper = mount(PlatformOverridePanel, {
      props: {
        platforms,
        modelValue: { wechat_mp: { title: '微信标题', content: '' } },
      },
    })

    expect(wrapper.text()).toContain('微信公众号')
    expect(wrapper.text()).toContain('64')
    expect(wrapper.text()).toContain('小红书')
  })

  it('启用平台差异内容时发出不可变更新', async () => {
    const modelValue = {}
    const wrapper = mount(PlatformOverridePanel, { props: { platforms, modelValue } })

    await wrapper.get('[data-testid="override-toggle-wechat_mp"]').setValue(true)

    expect(wrapper.emitted('update:modelValue')[0][0]).toEqual({
      wechat_mp: { title: '', content: '', digest: '', massSend: false, openComment: true },
    })
    expect(modelValue).toEqual({})
  })

  it('编辑字段时发出完整覆盖对象', async () => {
    const wrapper = mount(PlatformOverridePanel, {
      props: {
        platforms,
        modelValue: { wechat_mp: { title: '', content: '' } },
      },
    })

    await wrapper.get('[data-testid="override-title-wechat_mp"]').setValue('专属标题')

    expect(wrapper.emitted('update:modelValue').at(-1)[0]).toEqual({
      wechat_mp: { title: '专属标题', content: '', digest: '', massSend: false, openComment: true },
    })
  })

  it('启用知乎时带上参考产品文章发布默认权限', async () => {
    const wrapper = mount(PlatformOverridePanel, { props: { platforms, modelValue: {} } })

    await wrapper.get('[data-testid="override-toggle-zhihu"]').setValue(true)

    expect(wrapper.emitted('update:modelValue').at(-1)[0]).toEqual({
      zhihu: {
        title: '',
        content: '',
        commentPermission: 'anyone',
        declare: 0,
        topics: [],
        draft: false,
      },
    })
  })

  it('知乎创作声明使用证据化枚举并保持数值类型', async () => {
    const wrapper = mount(PlatformOverridePanel, {
      props: {
        platforms,
        modelValue: {
          zhihu: { title: '', content: '', commentPermission: 'anyone', declare: 0 },
        },
      },
    })

    expect(wrapper.get('[data-testid="override-comment-permission-zhihu"]').element.value).toBe('anyone')
    await wrapper.get('[data-testid="override-declare-zhihu"]').setValue('5')

    expect(wrapper.emitted('update:modelValue').at(-1)[0].zhihu).toMatchObject({
      commentPermission: 'anyone',
      declare: 5,
    })
  })

  it('知乎话题、草稿和公众号群发会产生受限的结构化选项', async () => {
    const wrapper = mount(PlatformOverridePanel, {
      props: {
        platforms,
        modelValue: {
          zhihu: { title: '', content: '', commentPermission: 'anyone', declare: 0, topics: [], draft: false },
          wechat_mp: { title: '', content: '', massSend: false },
          douyin: { title: '', content: '', draft: false },
        },
      },
    })

    await wrapper.get('[data-testid="override-topics-zhihu"]').setValue('AI, 人工智能，AI')
    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-draft-zhihu"]').setValue(true)
    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-mass-send-wechat_mp"]').setValue(true)
    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-draft-douyin"]').setValue(true)

    const latest = wrapper.emitted('update:modelValue').at(-1)[0]
    expect(latest.zhihu.topics).toEqual(['AI', '人工智能'])
    expect(latest.zhihu.draft).toBe(true)
    expect(latest.wechat_mp.massSend).toBe(true)
    expect(latest.douyin.draft).toBe(true)
  })

  it('B站差异化默认值含分区与版权声明，编辑后保持数值类型', async () => {
    const wrapper = mount(PlatformOverridePanel, { props: { platforms, modelValue: {} } })

    await wrapper.get('[data-testid="override-toggle-bilibili"]').setValue(true)

    expect(wrapper.emitted('update:modelValue').at(-1)[0].bilibili).toEqual({
      title: '', content: '', category: 21, copyright: 2, collectionId: '',
    })

    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-category-bilibili"]').setValue('171')
    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-copyright-bilibili"]').setValue('1')

    const latest = wrapper.emitted('update:modelValue').at(-1)[0].bilibili
    expect(latest.category).toBe(171)
    expect(latest.copyright).toBe(1)
  })

  it('YouTube 差异化默认值含分类与可见性，枚举校验生效', async () => {
    const wrapper = mount(PlatformOverridePanel, { props: { platforms, modelValue: {} } })

    await wrapper.get('[data-testid="override-toggle-youtube"]').setValue(true)

    expect(wrapper.emitted('update:modelValue').at(-1)[0].youtube).toEqual({
      title: '', content: '', categoryId: '22', privacy: 'public', playlistId: '',
    })

    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-category-id-youtube"]').setValue('20')
    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-privacy-youtube"]').setValue('unlisted')

    const latest = wrapper.emitted('update:modelValue').at(-1)[0].youtube
    expect(latest.categoryId).toBe('20')
    expect(latest.privacy).toBe('unlisted')
  })

  it('TikTok 可见性与百家号原创/位置差异化字段', async () => {
    const wrapper = mount(PlatformOverridePanel, { props: { platforms, modelValue: {} } })

    await wrapper.get('[data-testid="override-toggle-tiktok"]').setValue(true)
    expect(wrapper.emitted('update:modelValue').at(-1)[0].tiktok).toEqual({
      title: '', content: '', privacyLevel: 'PUBLIC',
    })

    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-privacy-level-tiktok"]').setValue('FRIENDS')
    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-toggle-baijiahao"]').setValue(true)
    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-original-baijiahao"]').setValue(true)
    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-location-baijiahao"]').setValue('北京·三里屯')

    const latest = wrapper.emitted('update:modelValue').at(-1)[0]
    expect(latest.tiktok.privacyLevel).toBe('FRIENDS')
    expect(latest.baijiahao.original).toBe(true)
    expect(latest.baijiahao.locationName).toBe('北京·三里屯')
  })

  it('公众号摘要与评论开关差异化字段（P1-4/P3-3）', async () => {
    const wrapper = mount(PlatformOverridePanel, { props: { platforms, modelValue: {} } })

    await wrapper.get('[data-testid="override-toggle-wechat_mp"]').setValue(true)
    expect(wrapper.emitted('update:modelValue').at(-1)[0].wechat_mp).toMatchObject({
      digest: '', openComment: true,
    })

    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-digest-wechat_mp"]').setValue('这是摘要内容')
    await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue').at(-1)[0] })
    await wrapper.get('[data-testid="override-open-comment-wechat_mp"]').setValue(false)

    const latest = wrapper.emitted('update:modelValue').at(-1)[0].wechat_mp
    expect(latest.digest).toBe('这是摘要内容')
    expect(latest.openComment).toBe(false)
  })
})
