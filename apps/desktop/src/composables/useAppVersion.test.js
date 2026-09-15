import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/electron-bridge', () => ({
  invoke: invokeMock,
}))

import { extractAppVersion, useAppVersion } from './useAppVersion'

describe('extractAppVersion', () => {
  it('读取成功响应中的版本号', () => {
    expect(extractAppVersion({ code: 0, data: '2.3.53' })).toBe('2.3.53')
  })

  it('去除版本号首尾空白', () => {
    expect(extractAppVersion({ code: 0, data: '  2.3.53 ' })).toBe('2.3.53')
  })

  it('把非字符串版本号转成字符串', () => {
    expect(extractAppVersion({ code: 0, data: 23 })).toBe('23')
  })

  it.each([
    ['失败码', { code: -1, data: '2.3.53' }],
    ['空字符串', { code: 0, data: '' }],
    ['只有空白', { code: 0, data: '   ' }],
    ['data 为 null', { code: 0, data: null }],
    ['data 缺失', { code: 0 }],
    ['响应为 undefined', undefined],
    ['响应为 null', null],
    ['响应不是对象', '2.3.53'],
    ['响应是数组', [{ code: 0, data: '2.3.53' }]],
  ])('无有效版本时返回空字符串：%s', (_label, response) => {
    expect(extractAppVersion(response)).toBe('')
  })
})

describe('useAppVersion', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('loadVersion 读取版本号并复位 loading', async () => {
    invokeMock.mockResolvedValue({ code: 0, data: '9.9.9' })
    const { version, loading, loadVersion } = useAppVersion()

    const result = await loadVersion()

    expect(invokeMock).toHaveBeenCalledWith('getVersion')
    expect(result).toBe('9.9.9')
    expect(version.value).toBe('9.9.9')
    expect(loading.value).toBe(false)
  })

  it('IPC 不可用（返回 undefined）时降级为空字符串', async () => {
    invokeMock.mockResolvedValue(undefined)
    const { version, loadVersion } = useAppVersion()

    await expect(loadVersion()).resolves.toBe('')
    expect(version.value).toBe('')
  })

  it('IPC 抛错时静默降级，不向外冒泡', async () => {
    invokeMock.mockRejectedValue(new Error('ipc down'))
    const { version, loading, loadVersion } = useAppVersion()

    await expect(loadVersion()).resolves.toBe('')
    expect(version.value).toBe('')
    expect(loading.value).toBe(false)
  })

  it('失败码不覆盖为脏值', async () => {
    invokeMock.mockResolvedValue({ code: -3, message: '未授权的调用来源' })
    const { version, loadVersion } = useAppVersion()

    await loadVersion()

    expect(version.value).toBe('')
  })
})
