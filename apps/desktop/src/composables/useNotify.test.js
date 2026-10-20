import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted：mock 工厂被提升，顶层变量需用 hoisted 定义
const mocks = vi.hoisted(() => ({
  elMessage: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
  elMessageBox: { confirm: vi.fn() },
}))

// Mock element-plus 展示层
vi.mock('element-plus', () => ({
  ElMessage: mocks.elMessage,
  ElMessageBox: mocks.elMessageBox,
}))

// Mock electron-bridge（避免真实 IPC）
vi.mock('@/api/electron-bridge', () => ({
  invoke: vi.fn(),
}))

import { ElMessage, ElMessageBox } from 'element-plus'
import { invoke } from '@/api/electron-bridge'
import { useNotify } from './useNotify'

describe('useNotify — 导出完整性（QM-3）', () => {
  it('导出全部方法', () => {
    const n = useNotify()
    expect(n).toHaveProperty('notify')
    expect(n).toHaveProperty('notifyError')
    expect(n).toHaveProperty('notifySuccess')
    expect(n).toHaveProperty('notifyWarning')
    expect(n).toHaveProperty('notifyInfo')
    expect(n).toHaveProperty('notifyConfirm')
  })
})

describe('useNotify — 通知展示', () => {
  let n

  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue({ code: 0, data: true })
    n = useNotify()
  })

  it('notify 命中 key → ElMessage 展示 + 日志上报', async () => {
    const text = n.notify('story2video.quota_exceeded', { module: 'm', level: 'error' })
    expect(text.length).toBeGreaterThan(0)
    expect(ElMessage.error).toHaveBeenCalledWith(expect.objectContaining({ message: text, grouping: true }))
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledWith('notifyLog', expect.objectContaining({ messageKey: 'story2video.quota_exceeded' }))
  })

  it('level 映射到对应 ElMessage 方法', () => {
    n.notifySuccess('story2video.export_completed')
    n.notifyWarning('story2video.rate_limited')
    n.notifyInfo('story2video.path_copied')
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
    expect(ElMessage.warning).toHaveBeenCalledTimes(1)
    expect(ElMessage.info).toHaveBeenCalledTimes(1)
  })

  it('未命中 key + error 级 + fallback → ElMessage.error(fallback)', async () => {
    const text = n.notifyError('nonexistent.key', { fallback: '自定义错误' })
    expect(text).toBe('自定义错误')
    expect(ElMessage.error).toHaveBeenCalledWith(expect.objectContaining({ message: '自定义错误' }))
    await Promise.resolve()
    expect(invoke).toHaveBeenCalled()
  })

  it('未命中 key + 非 error 级 → 静默（不展示不抛错）', () => {
    const text = n.notify('nonexistent.key', { level: 'info' })
    expect(text).toBe('')
    expect(ElMessage.info).not.toHaveBeenCalled()
  })

  it('options.message 直接传文案（绕过 messageKey 解析）', () => {
    const text = n.notifyWarning('nonexistent.key', { message: '动态拼接的警告文案' })
    expect(text).toBe('动态拼接的警告文案')
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: '动态拼接的警告文案' }))
  })

  it('options.message 为 i18n 原始 key 时拦截，不直出（防泄漏）', () => {
    const text = n.notifyWarning('nonexistent.key', { message: 'accountsPage.loginExpiredHint' })
    expect(text).toBe('')
    expect(ElMessage.warning).not.toHaveBeenCalled()
  })
})

describe('useNotify — 确认弹窗', () => {
  let n

  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue({ code: 0, data: true })
    n = useNotify()
  })

  it('notifyConfirm 确认 → 返回 true', async () => {
    ElMessageBox.confirm.mockResolvedValue('confirm')
    const ok = await n.notifyConfirm('story2video.project_delete_confirm')
    expect(ok).toBe(true)
    expect(ElMessageBox.confirm).toHaveBeenCalled()
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledWith('notifyLog', expect.objectContaining({ level: 'info' }))
  })

  it('notifyConfirm 取消 → 返回 false', async () => {
    ElMessageBox.confirm.mockRejectedValue(new Error('cancel'))
    const ok = await n.notifyConfirm('story2video.project_delete_confirm')
    expect(ok).toBe(false)
  })

  it('notifyConfirm 未命中 key → 返回 false 不弹窗', async () => {
    const ok = await n.notifyConfirm('nonexistent.key')
    expect(ok).toBe(false)
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })

  it('notifyConfirm options.message 直接传文案', async () => {
    ElMessageBox.confirm.mockResolvedValue('confirm')
    const ok = await n.notifyConfirm('nonexistent.key', { message: '动态确认文案', title: '需要登录' })
    expect(ok).toBe(true)
    expect(ElMessageBox.confirm).toHaveBeenCalledWith('动态确认文案', '需要登录', expect.any(Object))
  })

  it('notifyConfirm 的 message/title/按钮为 i18n 原始 key 时拦截（防泄漏）', async () => {
    ElMessageBox.confirm.mockResolvedValue('confirm')
    const ok = await n.notifyConfirm('nonexistent.key', {
      message: 'accountsPage.loginExpiredHint',
      title: 'accountsPage.confirmTitle',
      confirmButtonText: 'accountsPage.goLogin',
      cancelButtonText: 'accountsPage.cancel',
    })
    expect(ok).toBe(false)
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })
})