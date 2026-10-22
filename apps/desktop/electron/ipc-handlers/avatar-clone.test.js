// @ts-check
/**
 * avatar-clone.test.js — 数字人形象克隆 IPC 测试
 *
 * 锁定：
 *  - 五个通道名与入参校验（fail-closed，非布尔 refresh / 非法 id 一律拒）
 *  - 素材走「对话框选文件 → selectionId → add」两段式（与 tts-voice-clone 同型），
 *    renderer 不得直接传字节/路径
 *  - service 抛错不得穿透成未捕获异常
 */
import { describe, it, expect, vi } from 'vitest'

import registerAvatarCloneHandlers from './avatar-clone'

// 项目统一负数错误码（core/error-codes）；withSenderCheck 拒绝时返回 AUTH_ERROR
const EC = { VALIDATION_ERROR: -2, REQUEST_ERROR: -1, AUTH_ERROR: -3 }

function validEvent (id = 1) {
  return { sender: { id }, senderFrame: { url: 'app://localhost/' } }
}

/** 可信来源但缺 sender.id ⇒ senderKey 取不到，必须 fail closed */
function trustedEventWithoutSenderId () {
  return { senderFrame: { url: 'app://localhost/' } }
}

function createIpc () {
  const handlers = new Map()
  return {
    handlers,
    handle: vi.fn((channel, fn) => handlers.set(channel, fn)),
  }
}

function createService (overrides = {}) {
  return {
    listClones: vi.fn(async () => ({ code: 0, data: { avatars: [] } })),
    createSampleSelection: vi.fn(async () => ({ code: 0, data: { selectionId: 'sel-1', expiresAt: 1 } })),
    addCloneFromSelection: vi.fn(async () => ({ code: 0, data: { avatar: { id: 'av-1' } } })),
    deleteClone: vi.fn(async () => ({ code: 0, data: { deleted: true } })),
    renameClone: vi.fn(async () => ({ code: 0, data: { avatar: { id: 'av-1', name: '新名' } } })),
    refreshTrainingState: vi.fn(async () => ({ code: 0, data: { avatar: { id: 'av-1' } } })),
    ...overrides,
  }
}

function setup (serviceOverrides = {}, deps = {}) {
  const ipc = createIpc()
  registerAvatarCloneHandlers(ipc, { avatarCloneService: createService(serviceOverrides), ...deps })
  return ipc
}

describe('avatar-clone IPC', () => {
  it('注册五个通道', () => {
    const ipc = setup()
    expect([...ipc.handlers.keys()]).toEqual([
      'avatar-clone:list',
      'avatar-clone:choose-media',
      'avatar-clone:add',
      'avatar-clone:delete',
      'avatar-clone:rename',
    ])
  })

  describe('list', () => {
    it('透传 service 结果', async () => {
      const ipc = setup({ listClones: vi.fn(async () => ({ code: 0, data: { avatars: [{ id: 'a' }] } })) })
      const result = await ipc.handlers.get('avatar-clone:list')(validEvent(), {})
      expect(result.code).toBe(0)
      expect(result.data.avatars).toHaveLength(1)
    })

    it('service 抛错不穿透', async () => {
      const ipc = setup({ listClones: vi.fn(async () => { throw new Error('boom') }) })
      const result = await ipc.handlers.get('avatar-clone:list')(validEvent(), {})
      expect(result.code).toBe(EC.REQUEST_ERROR)
    })

    it('不可信来源被 withSenderCheck 拦下（AUTH_ERROR）', async () => {
      const ipc = setup()
      const result = await ipc.handlers.get('avatar-clone:list')({ senderFrame: { url: 'https://evil.example/' } }, {})
      expect(result.code).toBe(EC.AUTH_ERROR)
    })
  })

  describe('choose-media', () => {
    it('对话框取消 → 空 paths，不创建 selection', async () => {
      const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true })) }
      const ipc = setup({}, { dialog })
      const result = await ipc.handlers.get('avatar-clone:choose-media')(validEvent(), { type: 'photo' })
      expect(result.code).toBe(0)
      expect(result.data.paths).toEqual([])
    })

    it('按素材类型给不同的文件过滤器', async () => {
      const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true })) }
      const ipc = setup({}, { dialog })
      await ipc.handlers.get('avatar-clone:choose-media')(validEvent(), { type: 'photo' })
      expect(dialog.showOpenDialog.mock.calls[0][0].filters[0].extensions).toEqual(['png', 'jpg', 'jpeg', 'webp'])

      dialog.showOpenDialog.mockClear()
      await ipc.handlers.get('avatar-clone:choose-media')(validEvent(), { type: 'digital_twin' })
      expect(dialog.showOpenDialog.mock.calls[0][0].filters[0].extensions).toEqual(['mp4', 'mov', 'webm'])
    })

    it('非法 type 拒绝，不弹对话框', async () => {
      const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true })) }
      const ipc = setup({}, { dialog })
      const result = await ipc.handlers.get('avatar-clone:choose-media')(validEvent(), { type: 'hologram' })
      expect(result.code).toBe(EC.VALIDATION_ERROR)
      expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    })
  })

  describe('add', () => {
    it('透传 selectionId + name + sourceKind', async () => {
      const add = vi.fn(async () => ({ code: 0, data: { avatar: { id: 'av-1' } } }))
      const ipc = setup({ addCloneFromSelection: add })
      const result = await ipc.handlers.get('avatar-clone:add')(validEvent(), {
        selectionId: 'sel-1', name: '我的形象', sourceKind: 'self', type: 'photo',
      })
      expect(result.code).toBe(0)
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ selectionId: 'sel-1', name: '我的形象', sourceKind: 'self', type: 'photo' }),
        'webcontents:1',
      )
    })

    it('缺 selectionId / name / type 一律拒绝', async () => {
      const ipc = setup()
      for (const args of [
        { name: 'x', type: 'photo' },
        { selectionId: 's', type: 'photo' },
        { selectionId: 's', name: 'x' },
      ]) {
        const result = await ipc.handlers.get('avatar-clone:add')(validEvent(), args)
        expect(result.code).toBe(EC.VALIDATION_ERROR)
      }
    })

    it('renderer 直传路径/字节一律拒绝（素材必须走对话框两段式）', async () => {
      const ipc = setup()
      const result = await ipc.handlers.get('avatar-clone:add')(validEvent(), {
        selectionId: 'sel-1', name: 'x', type: 'photo', media: { path: 'C:/renderer.png' },
      })
      expect(result.code).toBe(EC.VALIDATION_ERROR)
    })

    it('可信来源但缺 sender.id 时 fail closed，不交给 service', async () => {
      const add = vi.fn(async () => ({ code: 0, data: {} }))
      const ipc = setup({ addCloneFromSelection: add })
      const result = await ipc.handlers.get('avatar-clone:add')(trustedEventWithoutSenderId(), {
        selectionId: 'sel-1', name: 'x', type: 'photo',
      })
      expect(result.code).toBe(EC.VALIDATION_ERROR)
      expect(add).not.toHaveBeenCalled()
    })

    it('sourceKind 非枚举值拒绝', async () => {
      const ipc = setup()
      const result = await ipc.handlers.get('avatar-clone:add')(validEvent(), {
        selectionId: 'sel-1', name: 'x', type: 'photo', sourceKind: 'stolen',
      })
      expect(result.code).toBe(EC.VALIDATION_ERROR)
    })
  })

  describe('delete / rename', () => {
    it('delete 透传 avatarId', async () => {
      const del = vi.fn(async () => ({ code: 0, data: { deleted: true } }))
      const ipc = setup({ deleteClone: del })
      const result = await ipc.handlers.get('avatar-clone:delete')(validEvent(), { avatarId: 'av-1' })
      expect(result.code).toBe(0)
      expect(del).toHaveBeenCalledWith({ avatarId: 'av-1' })
    })

    it('delete 非法 avatarId 拒绝', async () => {
      const ipc = setup()
      expect((await ipc.handlers.get('avatar-clone:delete')(validEvent(), { avatarId: '../escape' })).code).toBe(EC.VALIDATION_ERROR)
      expect((await ipc.handlers.get('avatar-clone:delete')(validEvent(), {})).code).toBe(EC.VALIDATION_ERROR)
    })

    it('rename 透传 avatarId + name', async () => {
      const rename = vi.fn(async () => ({ code: 0, data: {} }))
      const ipc = setup({ renameClone: rename })
      const result = await ipc.handlers.get('avatar-clone:rename')(validEvent(), { avatarId: 'av-1', name: '新名' })
      expect(result.code).toBe(0)
      expect(rename).toHaveBeenCalledWith({ avatarId: 'av-1', name: '新名' })
    })

    it('rename 缺 name 拒绝', async () => {
      const ipc = setup()
      expect((await ipc.handlers.get('avatar-clone:rename')(validEvent(), { avatarId: 'av-1' })).code).toBe(EC.VALIDATION_ERROR)
    })
  })
})
