import { describe, expect, it, vi } from 'vitest'

const { createDynamicAccessApi } = require('./access-control')

describe('preload 许可证权限', () => {
  // 2026-10-17 remove-buyout-license：原「免费用户可管理升级订单，但不能完成或
  // 模拟支付」整条删除 —— 6 条 payment:* 通道已随买断授权模型移除（本地下单链路
  // 在 S1 修复后已无法授予授权）。下面的用例改用仍在白名单里的 licenseInfo。

  it('权限 IPC 失败时按 public 处理', () => {
    const publicMethod = vi.fn(() => 'info')
    const restrictedMethod = vi.fn()
    const api = createDynamicAccessApi(
      {
        licenseInfo: publicMethod,
        publishWechat: restrictedMethod,
      },
      () => { throw new Error('权限 IPC 不可用') },
    )

    expect(api.licenseInfo()).toBe('info')
    expect(() => api.publishWechat({ title: '禁止发布' })).toThrow(/许可证权限不足/)
    expect(restrictedMethod).not.toHaveBeenCalled()
  })

  it('模型服务商写方法未登录不可调用，读方法未登录可用', () => {
    const create = vi.fn()
    const list = vi.fn(() => Promise.resolve({ code: 0, data: [] }))
    const publicApi = createDynamicAccessApi(
      { modelProviderCreate: create, modelProviderList: list },
      () => 'public',
    )

    // 未登录：写方法调用抛权限错误且不触达底层
    expect(() => publicApi.modelProviderCreate({ id: 'openai' })).toThrow(/许可证权限不足/)
    expect(create).not.toHaveBeenCalled()
    // 未登录：读方法可用
    expect(publicApi.modelProviderList()).resolves.toEqual({ code: 0, data: [] })
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('模型服务商写方法登录后可用', () => {
    const create = vi.fn(() => Promise.resolve({ code: 0, data: { id: 'openai' } }))
    const api = createDynamicAccessApi({ modelProviderCreate: create }, () => 'authenticated')

    expect(api.modelProviderCreate({ id: 'openai', name: 'OpenAI' }))
      .resolves.toEqual({ code: 0, data: { id: 'openai' } })
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('videoClone 命名空间 public 放行（4e 回归）', () => {
  it('未登录（public）可调用 videoClone.onProgress（命名空间 + 子方法均 public）', () => {
    const { createDynamicAccessApi } = require('./access-control')
    const onProgress = vi.fn(() => 'ok')
    const api = createDynamicAccessApi(
      { videoClone: { onProgress, run: vi.fn() } },
      () => 'public',
    )
    expect(() => api.videoClone.onProgress(() => {})).not.toThrow()
    expect(() => api.videoClone.run({})).not.toThrow()
  })
})
