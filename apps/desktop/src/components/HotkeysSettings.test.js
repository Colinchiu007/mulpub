import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'

const hotkeysList = vi.hoisted(() => vi.fn())

import HotkeysSettings from './HotkeysSettings.vue'

const ROWS = [
  { accelerator: 'CmdOrCtrl+Alt+P', route: '/publish', label: '发布', labelKey: 'hotkeys.label.publish' },
  { accelerator: 'CmdOrCtrl+Comma', route: '/accounts', label: '账号管理', labelKey: 'hotkeys.label.accounts' },
]

async function flush (wrapper) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

function mountPanel () {
  return mount(HotkeysSettings, { global: { plugins: [i18n] } })
}

describe('HotkeysSettings（阶段 1.6 / audit-10：设置页消费既有 hotkeys:list）', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    hotkeysList.mockReset()
    window.electronAPI = { hotkeysList }
  })

  it('取数期间不得渲染出「空表」——只给 role=status 的加载提示', async () => {
    let release
    hotkeysList.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ code: 0, data: ROWS }) }))
    const wrapper = mountPanel()

    expect(wrapper.find('[data-testid="hotkeys-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hotkeys-table"]').exists()).toBe(false)

    release()
    await flush(wrapper)
    expect(wrapper.find('[data-testid="hotkeys-loading"]').exists()).toBe(false)
  })

  it('渲染主进程真表：每行 = 可读按键 + 本地化用途（精确到行数与内容）', async () => {
    hotkeysList.mockResolvedValue({ code: 0, data: ROWS })
    const wrapper = await flush(mountPanel())

    const rows = wrapper.findAll('[data-testid="hotkeys-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('kbd').text()).toBe('Ctrl+Alt+P')
    expect(rows[0].text()).toContain(i18n.global.t('hotkeys.label.publish'))
    expect(rows[1].find('kbd').text()).toBe('Ctrl+,')
    // 表格必须是语义表格（列头存在，供屏幕阅读器把按键与用途对上）
    expect(wrapper.find('table thead th').text()).toBe(i18n.global.t('hotkeys.colKeys'))
  })

  it('IPC 不可用（浏览器预览 / 无 electronAPI）时给 role=alert + 重试，而不是空表', async () => {
    window.electronAPI = {}
    const wrapper = await flush(mountPanel())

    const alert = wrapper.get('[data-testid="hotkeys-error"]')
    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).toContain(i18n.global.t('hotkeys.unavailable'))
    expect(wrapper.find('[data-testid="hotkeys-table"]').exists()).toBe(false)

    // 重试成功后同一面板切到表格
    window.electronAPI = { hotkeysList }
    hotkeysList.mockResolvedValue({ code: 0, data: ROWS })
    await wrapper.get('[data-testid="hotkeys-retry"]').trigger('click')
    await flush(wrapper)
    expect(wrapper.findAll('[data-testid="hotkeys-row"]')).toHaveLength(2)
  })

  it.each([
    ['非成功码', { code: 1, data: ROWS }],
    ['空列表', { code: 0, data: [] }],
    ['结构破坏', { code: 0, data: null }],
    ['抛错', new Error('boom')],
  ])('%s 一律判不可用（不得把主进程故障读成「没有快捷键」）', async (_label, value) => {
    if (value instanceof Error) hotkeysList.mockRejectedValue(value)
    else hotkeysList.mockResolvedValue(value)
    const wrapper = await flush(mountPanel())
    expect(wrapper.find('[data-testid="hotkeys-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hotkeys-table"]').exists()).toBe(false)
  })

  it('labelKey 缺失时退回主进程标签并出声告警（静默兜底会把键表写成假证据）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    hotkeysList.mockResolvedValue({ code: 0, data: [{ accelerator: 'CmdOrCtrl+Alt+X', route: '/x', label: '未知用途' }] })
    const wrapper = await flush(mountPanel())

    expect(wrapper.findAll('[data-testid="hotkeys-row"]')).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('labelKey'), 'CmdOrCtrl+Alt+X')
    warn.mockRestore()
  })
})
