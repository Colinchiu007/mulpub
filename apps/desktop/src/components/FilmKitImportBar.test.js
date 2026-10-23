// @ts-check
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import FilmKitImportBar from './FilmKitImportBar.vue'
import i18n from '@/i18n'

/** 主进程 mock：按用例给不同信封 */
const bridge = {
  res: { code: 0, data: { ok: true, fileCount: 9 } },
  calls: 0,
  /** 可选：注入一个 pending promise（用于断言「导入中」态） */
  pending: null,
}

vi.mock('@/api/electron-bridge', () => ({
  getApi: () => ({
    filmEngineering: {
      importKit: async () => {
        bridge.calls += 1
        if (typeof bridge.pending === 'function') return bridge.pending()
        return bridge.res
      },
    },
  }),
}))

const notifyMock = { warn: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({
    notify: notifyMock.warn,
    notifyWarning: notifyMock.warn,
    notifySuccess: notifyMock.success,
    notifyError: notifyMock.error,
    notifyInfo: notifyMock.info,
  }),
}))

function mountBar (onImported) {
  return mount(FilmKitImportBar, {
    props: onImported ? { onImported } : {},
    global: {
      plugins: [i18n],
      compilerOptions: { isCustomElement: (tag) => tag.startsWith('el-') },
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        Transition: { template: '<div><slot /></div>' },
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  bridge.calls = 0
  bridge.pending = null
  bridge.res = { code: 0, data: { ok: true, fileCount: 9 } }
})

describe('FilmKitImportBar 资产导入（PR-3b · F-J）', () => {
  it('入口在顶部 + 说明文字', async () => {
    const wrapper = mountBar()
    await flushPromises()
    expect(wrapper.find('[data-testid="fe-kit-import-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="fe-kit-import-btn"]').exists()).toBe(true)
  })

  it('点入口先弹确认框；**取消不触发导入**', async () => {
    const wrapper = mountBar()
    await flushPromises()
    await wrapper.find('[data-testid="fe-kit-import-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="fe-kit-import-confirm"]').exists()).toBe(true)
    await wrapper.find('[data-testid="fe-kit-import-cancel"]').trigger('click')
    await flushPromises()
    expect(bridge.calls).toBe(0)
  })

  it('**确认后**才触发导入，且成功后回调刷新', async () => {
    const onImported = vi.fn()
    const wrapper = mountBar(onImported)
    await flushPromises()
    await wrapper.find('[data-testid="fe-kit-import-btn"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="fe-kit-import-ok"]').trigger('click')
    await flushPromises()
    expect(bridge.calls).toBe(1)
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('取消（主进程回 cancelled）⇒ 不算失败（不弹错误提示）', async () => {
    bridge.res = { code: 0, data: { cancelled: true, reason: 'CANCELLED' } }
    const onImported = vi.fn()
    const wrapper = mountBar(onImported)
    await flushPromises()
    await wrapper.find('[data-testid="fe-kit-import-btn"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="fe-kit-import-ok"]').trigger('click')
    await flushPromises()
    expect(bridge.calls).toBe(1)
    expect(onImported).not.toHaveBeenCalled()
    expect(notifyMock.warn).not.toHaveBeenCalled()
  })

  it('失败 ⇒ 弹错误提示 + 显示恢复指引告警', async () => {
    bridge.res = {
      code: -2,
      errorCode: 'LOCK_HELD',
      message: 'lock',
      data: { recoveryPath: 'D:/x/.import-lock', recoveryState: 'LOCK_LEFT' },
    }
    const wrapper = mountBar()
    await flushPromises()
    await wrapper.find('[data-testid="fe-kit-import-btn"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="fe-kit-import-ok"]').trigger('click')
    await flushPromises()
    expect(notifyMock.warn).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="fe-kit-import-recovery"]').exists()).toBe(true)
  })

  it('导入中 ⇒ 入口禁用 + 不可中断模态出现', async () => {
    // 可控 deferred：让导入**停在进行中**
    let release = null
    bridge.pending = () => new Promise((resolve) => { release = resolve })
    const wrapper = mountBar()
    await flushPromises()
    await wrapper.find('[data-testid="fe-kit-import-btn"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="fe-kit-import-ok"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="fe-kit-import-btn"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="fe-kit-importing"]').exists()).toBe(true)
    // 结束导入 ⇒ 模态收起、按钮恢复可用
    if (release) release({ code: 0, data: { ok: true, fileCount: 1 } })
    await flushPromises()
    expect(wrapper.find('[data-testid="fe-kit-import-btn"]').attributes('disabled')).toBeUndefined()
  })
})
