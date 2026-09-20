// @ts-check
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfigProfileManager from './ConfigProfileManager.vue'
import i18n from '@/i18n'

const profile = (overrides = {}) => ({
  id: 'profile-000000000001',
  name: '竖屏配置',
  pipelineId: 'video-clone',
  snapshot: { schemaVersion: 1 },
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  ...overrides,
})

function mountManager (overrides = {}) {
  return mount(ConfigProfileManager, {
    props: {
      pipelineId: 'video-clone',
      pipelineLabel: '视频克隆',
      snapshot: { schemaVersion: 1, value: 'current' },
      dirty: false,
      disabled: false,
      testIdPrefix: 'video-clone-config-profile',
      ...overrides,
    },
    global: {
      plugins: [i18n],
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        Transition: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('ConfigProfileManager', () => {
  it('renders save/manage entries and opens a trimmed save dialog', async () => {
    const w = mountManager()
    expect(w.find('[data-testid="video-clone-config-profile-save"]').exists()).toBe(true)
    expect(w.find('[data-testid="video-clone-config-profile-manage"]').exists()).toBe(true)
    await w.find('[data-testid="video-clone-config-profile-save"]').trigger('click')
    expect(w.find('[data-testid="video-clone-config-profile-save-dialog"]').exists()).toBe(true)
    const input = w.find('[data-testid="video-clone-config-profile-name-input"]')
    await input.setValue('  新配置  ')
    expect(input.element.value).toBe('  新配置  ')
    expect(input.attributes('maxlength')).toBe('60')
  })

  it('saves the JSON-safe snapshot and asks for overwrite on duplicate', async () => {
    const onSave = vi.fn().mockResolvedValue(profile({ name: '新配置' }))
    const w = mountManager({ onSave, existingProfiles: [profile({ name: '新配置' })] })
    await w.find('[data-testid="video-clone-config-profile-save"]').trigger('click')
    await w.find('[data-testid="video-clone-config-profile-name-input"]').setValue(' 新配置 ')
    await w.find('[data-testid="video-clone-config-profile-save-confirm"]').trigger('click')
    expect(onSave).not.toHaveBeenCalled()
    expect(w.find('[data-testid="video-clone-config-profile-overwrite-hint"]').exists()).toBe(true)
    await w.find('[data-testid="video-clone-config-profile-save-confirm"]').trigger('click')
    expect(onSave).toHaveBeenCalledWith('新配置', expect.objectContaining({ overwrite: true, snapshot: expect.any(Object) }))
  })

  it('loads profiles newest first and disables foreign pipeline apply', async () => {
    const onList = vi.fn().mockResolvedValue([
      profile({ id: 'profile-000000000002', name: '旧', updatedAt: 1000, pipelineId: 'video-clone' }),
      profile({ id: 'profile-000000000003', name: '其他', updatedAt: 3000, pipelineId: 'film-engineering' }),
      profile({ id: 'profile-000000000004', name: '新', updatedAt: 5000, pipelineId: 'video-clone' }),
    ])
    const w = mountManager({ onList })
    await w.find('[data-testid="video-clone-config-profile-manage"]').trigger('click')
    await vi.waitFor(() => expect(onList).toHaveBeenCalledTimes(1))
    const rows = w.findAll('[data-testid="video-clone-config-profile-row"]')
    expect(rows.map((row) => row.text().includes('新'))).toContain(true)
    expect(rows.map((row) => row.text().includes('其他'))).toContain(true)
    expect(rows.map((row) => row.text().includes('旧'))).toContain(true)
    const foreign = rows.find((row) => row.text().includes('其他'))
    expect(foreign.find('[data-testid="video-clone-config-profile-apply"]').attributes('disabled')).toBeDefined()
    expect(rows[0].text()).toContain('新')
  })

  it('confirms before applying dirty form and emits the selected profile', async () => {
    const onApply = vi.fn().mockResolvedValue(true)
    const target = profile()
    const w = mountManager({ dirty: true, existingProfiles: [target], onApply })
    await w.find('[data-testid="video-clone-config-profile-manage"]').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid="video-clone-config-profile-row"]').exists()).toBe(true))
    await w.find('[data-testid="video-clone-config-profile-apply"]').trigger('click')
    expect(w.find('[data-testid="video-clone-config-profile-apply-dialog"]').exists()).toBe(true)
    expect(onApply).not.toHaveBeenCalled()
    await w.find('[data-testid="video-clone-config-profile-apply-confirm"]').trigger('click')
    expect(onApply).toHaveBeenCalledWith(target)
  })

  it('renames and deletes only after the corresponding actions', async () => {
    const target = profile()
    const onRename = vi.fn().mockResolvedValue({ ...target, name: '改名' })
    const onDelete = vi.fn().mockResolvedValue(true)
    const w = mountManager({ existingProfiles: [target], onRename, onDelete })
    await w.find('[data-testid="video-clone-config-profile-manage"]').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid="video-clone-config-profile-row"]').exists()).toBe(true))
    await w.find('[data-testid="video-clone-config-profile-rename"]').trigger('click')
    await w.find('[data-testid="video-clone-config-profile-rename-input"]').setValue(' 改名 ')
    await w.find('[data-testid="video-clone-config-profile-rename-confirm"]').trigger('click')
    expect(onRename).toHaveBeenCalledWith(target.id, '改名')
    await w.find('[data-testid="video-clone-config-profile-delete"]').trigger('click')
    expect(w.find('[data-testid="video-clone-config-profile-delete-dialog"]').exists()).toBe(true)
    await w.find('[data-testid="video-clone-config-profile-delete-confirm"]').trigger('click')
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: target.id, name: '改名' }))
  })

  it('allows the manager to close while a list request is pending and ignores its late result', async () => {
    let resolveList
    const onList = vi.fn(() => new Promise((resolve) => { resolveList = resolve }))
    const w = mountManager({ onList })
    await w.find('[data-testid="video-clone-config-profile-manage"]').trigger('click')
    expect(w.find('[data-testid="video-clone-config-profile-list-dialog"]').exists()).toBe(true)
    await w.find('[data-testid="video-clone-config-profile-list-close"]').trigger('click')
    expect(w.find('[data-testid="video-clone-config-profile-list-dialog"]').exists()).toBe(false)
    resolveList([profile({ name: '过期结果' })])
    await Promise.resolve()
    await Promise.resolve()
    expect(w.find('[data-testid="video-clone-config-profile-row"]').exists()).toBe(false)
  })

  it('surfaces save failure inline without a duplicate error toast', async () => {
    const { ElMessage } = await import('element-plus')
    const errSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    const w = mountManager({ onSave: vi.fn().mockResolvedValue({ code: -1, message: '配置保存失败' }) })
    await w.find('[data-testid="video-clone-config-profile-save"]').trigger('click')
    await w.find('[data-testid="video-clone-config-profile-name-input"]').setValue('失败回归')
    await w.find('[data-testid="video-clone-config-profile-save-confirm"]').trigger('click')
    await vi.waitFor(() => expect(w.find('.config-profile-error').text()).toContain('配置保存失败'))
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('maps browser-mode bridge failure to friendly Chinese instead of leaking electronAPI text', async () => {
    const { ElMessage } = await import('element-plus')
    const errSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    const w = mountManager({ onSave: vi.fn().mockResolvedValue({ code: -1, message: 'electronAPI not available' }) })
    await w.find('[data-testid="video-clone-config-profile-save"]').trigger('click')
    await w.find('[data-testid="video-clone-config-profile-name-input"]').setValue('桥接不可用')
    await w.find('[data-testid="video-clone-config-profile-save-confirm"]').trigger('click')
    await vi.waitFor(() => expect(w.find('.config-profile-error').exists()).toBe(true))
    const text = w.find('.config-profile-error').text()
    expect(text).not.toContain('electronAPI')
    expect(text).toContain('配置保存失败')
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('keeps the save dialog open and surfaces a nonzero IPC envelope', async () => {
    const w = mountManager({ onSave: vi.fn().mockResolvedValue({ code: -1, message: '配置保存失败' }) })
    await w.find('[data-testid="video-clone-config-profile-save"]').trigger('click')
    await w.find('[data-testid="video-clone-config-profile-name-input"]').setValue('失败回归')
    await w.find('[data-testid="video-clone-config-profile-save-confirm"]').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid="video-clone-config-profile-save-dialog"]').exists()).toBe(true))
    expect(w.find('.config-profile-error').text()).toContain('配置保存失败')
    expect(w.find('[data-testid="video-clone-config-profile-save-confirm"]').attributes('disabled')).toBeUndefined()
  })

  it('surfaces a list envelope error instead of treating it as an empty list', async () => {
    const w = mountManager({ onList: vi.fn().mockResolvedValue({ code: -1, message: '配置列表加载失败' }) })
    await w.find('[data-testid="video-clone-config-profile-manage"]').trigger('click')
    await vi.waitFor(() => expect(w.find('.config-profile-error').exists()).toBe(true))
    expect(w.find('.config-profile-error').text()).toContain('配置列表加载失败')
    expect(w.find('[data-testid="video-clone-config-profile-row"]').exists()).toBe(false)
  })
})
