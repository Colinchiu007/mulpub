import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import HiflyExtraPanel from './HiflyExtraPanel.vue'

/**
 * HiflyExtraPanel 测试（change: hifly-full-api-ui）。
 *
 * 覆盖 11 个端点的**面板行为**（不是 adapter 契约——那在 hifly-extra.test.js /
 * hifly-create-modes.test.js 里已锁）。这里只问四件事：
 *  1. 7 个模式都渲染出来；
 *  2. 上游能力未就绪时整体显示「暂不可用」而不是逐个报错；
 *  3. 收费提示只出现在 6 个收费模式上，**封面模式不出现**（它是免费的）；
 *  4. 删除入口只出现在「普通视频创作」类模式上（官方明确翻译/唱歌/图片驱动不支持删除）。
 */

const t = (key) => key

function makeApi (overrides = {}) {
  return {
    credit: vi.fn(async () => ({ code: 0, data: { left: 1582 } })),
    livelyTemplates: vi.fn(async () => ({ code: 0, data: { templates: [] } })),
    coverStyles: vi.fn(async () => ({ code: 0, data: { styles: [] } })),
    createCover: vi.fn(async () => ({ code: 0, data: { coverUrl: 'https://cdn/c.jpg' } })),
    deleteWork: vi.fn(async () => ({ code: 0, data: null })),
    createByAudio: vi.fn(async () => ({ code: 0, data: { taskId: 't-a' } })),
    createByTemplate: vi.fn(async () => ({ code: 0, data: { taskId: 't-t' } })),
    translate: vi.fn(async () => ({ code: 0, data: { taskId: 't-tr' } })),
    createBySing: vi.fn(async () => ({ code: 0, data: { taskId: 't-s' } })),
    createByImage: vi.fn(async () => ({ code: 0, data: { taskId: 't-i' } })),
    audioTts: vi.fn(async () => ({ code: 0, data: { taskId: 't-au' } })),
    ...overrides,
  }
}

async function mountPanel (api = makeApi()) {
  const w = mount(HiflyExtraPanel, { props: { t, api } })
  await new Promise((r) => setTimeout(r, 0))
  await w.vm.$nextTick()
  return w
}

describe('HiflyExtraPanel — 飞影 11 个扩展端点面板', () => {
  it('7 个模式 tab 全部渲染（声音/模板/翻译/唱歌/图片/音频/封面）', async () => {
    const w = await mountPanel()
    for (const key of ['audio', 'template', 'translate', 'sing', 'image', 'audioTts', 'cover']) {
      expect(w.find(`[data-testid="hifly-extra-tab-${key}"]`).exists()).toBe(true)
    }
    w.unmount()
  })

  // 上游 adapter 方法只有 hifly-full-api 合并后才存在；未就绪时 UI 必须整体隐藏，
  // 而不是让用户点到一堆必然失败的按钮。
  it('能力未就绪（HIFLY_EXTRA_UNSUPPORTED）⇒ 显示暂不可用并隐藏表单', async () => {
    const api = makeApi({
      credit: vi.fn(async () => ({ code: -1, message: 'HIFLY_EXTRA_UNSUPPORTED' })),
    })
    const w = await mountPanel(api)
    expect(w.find('[data-testid="hifly-extra-unsupported"]').exists()).toBe(true)
    expect(w.find('[data-testid="hifly-extra-tab-audio"]').exists()).toBe(false)
    w.unmount()
  })

  it('积分读取成功后显示余额', async () => {
    const w = await mountPanel()
    expect(w.find('[data-testid="hifly-extra-credit"]').text()).toContain('1582')
    w.unmount()
  })

  // 6 个创作模式收费，创建封面免费——这条差异最容易做错（都叫「创建」）
  it('收费提示只在收费模式出现；封面模式不出现', async () => {
    const w = await mountPanel()
    expect(w.find('[data-testid="hifly-extra-charge"]').exists()).toBe(true)

    await w.find('[data-testid="hifly-extra-tab-cover"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="hifly-extra-charge"]').exists()).toBe(false)
    w.unmount()
  })

  // 官方明确：翻译 / 唱歌 / 图片驱动的任务不支持 DELETE /video/task
  it('删除入口只在支持删除的模式出现', async () => {
    const api = makeApi()
    const w = await mountPanel(api)

    // 声音驱动（可删）：先提交拿到 taskId
    w.vm.draft = { fileId: 'f', avatar: 'a' }
    await w.find('[data-testid="hifly-extra-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.find('[data-testid="hifly-extra-delete"]').exists()).toBe(true)

    // 切到翻译（不可删）：结果被清空，且即便有 taskId 也不该给删除按钮
    await w.find('[data-testid="hifly-extra-tab-translate"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="hifly-extra-delete"]').exists()).toBe(false)
    w.unmount()
  })

  // 余额为 0 且是收费模式 ⇒ 禁用提交，不发必然失败的请求
  it('余额为 0 时收费模式的提交按钮被禁用', async () => {
    const api = makeApi({ credit: vi.fn(async () => ({ code: 0, data: { left: 0 } })) })
    const w = await mountPanel(api)
    const btn = w.find('[data-testid="hifly-extra-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('提交时把表单字段映射成 API 入参（空字段不传）', async () => {
    const api = makeApi()
    const w = await mountPanel(api)
    w.vm.draft = { fileId: 'f-1', avatar: 'av-1', title: '' }
    await w.find('[data-testid="hifly-extra-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.createByAudio).toHaveBeenCalledWith({ fileId: 'f-1', avatar: 'av-1' })
    w.unmount()
  })
})
