// @ts-check
/**
 * HelpSupport 行为合同（UX-AUDIT 阶段 1.10 / audit-24）
 *
 * 这一页此前只有一句「请联系支持团队或查阅使用文档」，而本仓没有任何文档站地址、
 * 也没有任何入口能落到那句话上——典型的死胡同文案。本锁的三个方向：
 *   ① 每个入口都必须**真的带动作**（R92 同族：按钮存在、方法存在、但没绑定 = 点了没反应）；
 *   ② 日志区块的三态不得混淆——取不到就是取不到（role=alert + 重试），
 *      不得显示「0 个日志文件」把失败冒充成空（那会让用户以为自己没日志）；
 *   ③ 复制走共享剪贴板实现，成功/失败各有一条出声路径。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const logsGetInfo = vi.fn()
const requestSettingsDialog = vi.fn()
const routerPush = vi.fn()
const writeClipboard = vi.fn()
const notifySuccess = vi.fn()
const notifyError = vi.fn()

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key, params) => (params ? `${key}|${JSON.stringify(params)}` : key) }),
}))
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useRouter: () => ({ push: routerPush }),
}))
vi.mock('@/api/publisher', () => ({ logsGetInfo: (...args) => logsGetInfo(...args) }))
vi.mock('@/api/electron-bridge', () => ({
  getApi: () => ({ getVersion: vi.fn().mockResolvedValue({ code: 0, data: '9.9.9' }) }),
}))
vi.mock('@/stores/settings-dialog', () => ({
  requestSettingsDialog: (tab) => requestSettingsDialog(tab),
}))
vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({ notifySuccess, notifyError }),
}))
vi.mock('@/utils/clipboard', () => ({ writeClipboard: (text) => writeClipboard(text) }))
// formatBytes 真实现依赖本地化与单位换算，会让断言随环境漂移；这里钉成可预期的标记串。
vi.mock('@/utils/bytes', () => ({ formatBytes: (n) => `formatted:${n}` }))

import HelpSupport from './HelpSupport.vue'

function okInfo (overrides = {}) {
  return {
    code: 0,
    data: { dir: 'D:/logs', totalBytes: 2048, fileCount: 3, ...overrides },
  }
}

async function mountHelp () {
  const wrapper = mount(HelpSupport)
  await flushPromises()
  return wrapper
}

describe('HelpSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    logsGetInfo.mockResolvedValue(okInfo())
    writeClipboard.mockResolvedValue(true)
  })

  it('三个入口都渲染，且点击分别落到真实目标（不是只写了方法的死按钮）', async () => {
    const wrapper = await mountHelp()
    await wrapper.get('[data-testid="help-entry-feedback"]').trigger('click')
    expect(requestSettingsDialog).toHaveBeenLastCalledWith('general')
    await wrapper.get('[data-testid="help-entry-model"]').trigger('click')
    expect(requestSettingsDialog).toHaveBeenLastCalledWith('model')
    await wrapper.get('[data-testid="help-entry-accounts"]').trigger('click')
    expect(routerPush).toHaveBeenCalledWith('/accounts')
    expect(requestSettingsDialog).toHaveBeenCalledTimes(2)
  })

  it('读取成功后展示日志规模与目录，并给出可点的复制入口', async () => {
    const wrapper = await mountHelp()
    expect(wrapper.find('[data-testid="help-logs-loading"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="help-logs-summary"]').text())
      .toContain('memberCenter.helpLogsSummary|{"files":3,"size":"formatted:2048"}')
    expect(wrapper.get('[data-testid="help-logs-dir"]').text()).toBe('D:/logs')
    const copy = wrapper.get('[data-testid="help-copy-logs-dir"]')
    expect(copy.attributes('disabled')).toBeUndefined()
    await copy.trigger('click')
    expect(writeClipboard).toHaveBeenCalledWith('D:/logs')
    expect(notifySuccess).toHaveBeenCalledWith('memberCenter.helpCopied')
  })

  it('IPC 非成功码必须落到"取不到"分支，不得显示 0 个文件冒充没有日志', async () => {
    logsGetInfo.mockResolvedValue({ code: 1, message: 'down' })
    const wrapper = await mountHelp()
    const alert = wrapper.get('[data-testid="help-logs-error"]')
    expect(alert.attributes('role')).toBe('alert')
    expect(wrapper.find('[data-testid="help-logs-summary"]').exists(), '失败态下不得渲染规模行').toBe(false)
    expect(wrapper.find('[data-testid="help-copy-logs-dir"]').exists()).toBe(false)
  })

  it('IPC 抛错同样进入失败态；点重试会再次读取并恢复', async () => {
    logsGetInfo.mockRejectedValueOnce(new Error('boom'))
    const wrapper = await mountHelp()
    expect(wrapper.find('[data-testid="help-logs-error"]').exists()).toBe(true)
    await wrapper.get('[data-testid="help-logs-retry"]').trigger('click')
    await flushPromises()
    expect(logsGetInfo).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="help-logs-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="help-logs-summary"]').exists()).toBe(true)
  })

  it('目录缺失时复制按钮禁用（不得复制空串冒充成功）', async () => {
    logsGetInfo.mockResolvedValue(okInfo({ dir: '' }))
    const wrapper = await mountHelp()
    const copy = wrapper.get('[data-testid="help-copy-logs-dir"]')
    expect(copy.attributes('disabled')).toBeDefined()
    await copy.trigger('click')
    expect(writeClipboard).not.toHaveBeenCalled()
    expect(notifySuccess).not.toHaveBeenCalled()
  })

  it('剪贴板返回 false 时如实报失败，不谎称已复制', async () => {
    writeClipboard.mockResolvedValue(false)
    const wrapper = await mountHelp()
    await wrapper.get('[data-testid="help-copy-logs-dir"]').trigger('click')
    await flushPromises()
    expect(notifySuccess).not.toHaveBeenCalled()
    expect(notifyError).toHaveBeenCalledWith('memberCenter.helpCopyFailed')
  })

  it('数值字段非有限数时归零但不隐藏区块（缺字段 ≠ 读不到）', async () => {
    logsGetInfo.mockResolvedValue({ code: 0, data: { dir: '/var/logs' } })
    const wrapper = await mountHelp()
    expect(wrapper.find('[data-testid="help-logs-error"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="help-logs-summary"]').text())
      .toContain('memberCenter.helpLogsSummary|{"files":0,"size":"formatted:0"}')
    expect(wrapper.get('[data-testid="help-logs-dir"]').text()).toBe('/var/logs')
  })

  it('版本号仍取 app:get-version（关于卡片不得回归）', async () => {
    const wrapper = await mountHelp()
    expect(wrapper.get('[data-testid="member-center-version"]').text()).toBe('9.9.9')
  })
})
