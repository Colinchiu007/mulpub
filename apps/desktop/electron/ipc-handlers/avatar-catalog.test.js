import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

__enableElectronMock()

let registerAvatarCatalogHandlers
let originalIsPackaged

beforeEach(async () => {
  vi.resetModules()
  originalIsPackaged = __electronMock.app.isPackaged
  __electronMock.app.isPackaged = false
  const module = await import('./avatar-catalog')
  registerAvatarCatalogHandlers = module.default || module
})

afterEach(() => {
  __electronMock.app.isPackaged = originalIsPackaged
})

function createIpcMain() {
  const handlers = new Map()
  return {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    handlers,
  }
}

function createService(overrides = {}) {
  return {
    listAvatars: vi.fn(async () => ({ code: 0, data: [{ id: 'a1', name: '形象A' }] })),
    listVoices: vi.fn(async () => ({ code: 0, data: [{ id: 'v1', name: '音色A' }] })),
    invalidate: vi.fn(),
    ...overrides,
  }
}

describe('数字人形象/音色目录 IPC', () => {
  it('注册三个通道', async () => {
    const ipcMain = createIpcMain()
    registerAvatarCatalogHandlers(ipcMain, { avatarCatalogService: createService() })
    expect([...ipcMain.handlers.keys()]).toEqual([
      'avatar-catalog:avatars',
      'avatar-catalog:voices',
      'avatar-catalog:invalidate',
    ])
  })

  it('avatars 通道把归一化参数交给服务并包装为 { avatars }', async () => {
    const ipcMain = createIpcMain()
    const service = createService()
    registerAvatarCatalogHandlers(ipcMain, { avatarCatalogService: service })

    const result = await ipcMain.handlers.get('avatar-catalog:avatars')({}, {
      providerId: 'heygen', refresh: true,
    })
    expect(result.code).toBe(0)
    expect(result.data.avatars).toEqual([{ id: 'a1', name: '形象A' }])
    expect(service.listAvatars).toHaveBeenCalledWith({ providerId: 'heygen', refresh: true })
  })

  it('voices 通道包装为 { voices }', async () => {
    const ipcMain = createIpcMain()
    const service = createService()
    registerAvatarCatalogHandlers(ipcMain, { avatarCatalogService: service })

    const result = await ipcMain.handlers.get('avatar-catalog:voices')({}, { providerId: 'heygen' })
    expect(result.code).toBe(0)
    expect(result.data.voices).toEqual([{ id: 'v1', name: '音色A' }])
    expect(service.listVoices).toHaveBeenCalledWith({ providerId: 'heygen' })
  })

  it('invalidate 通道转发 providerId', async () => {
    const ipcMain = createIpcMain()
    const service = createService()
    registerAvatarCatalogHandlers(ipcMain, { avatarCatalogService: service })

    const result = await ipcMain.handlers.get('avatar-catalog:invalidate')({}, { providerId: 'heygen' })
    expect(result.code).toBe(0)
    expect(service.invalidate).toHaveBeenCalledWith('heygen')
  })

  describe('入参校验（fail-closed）', () => {
    const badArgs = [
      ['null', null],
      ['数组', []],
      ['字符串', 'heygen'],
      ['缺 providerId', {}],
      ['providerId 空', { providerId: '' }],
      ['providerId 含斜杠', { providerId: 'hey/gen' }],
      ['providerId 含空格', { providerId: 'hey gen' }],
      ['refresh 非布尔', { providerId: 'heygen', refresh: 'true' }],
    ]
    for (const [label, args] of badArgs) {
      it(`${label} → AVATAR_CATALOG_INVALID_ARGUMENTS 且不触达服务`, async () => {
        const ipcMain = createIpcMain()
        const service = createService()
        registerAvatarCatalogHandlers(ipcMain, { avatarCatalogService: service })

        const result = await ipcMain.handlers.get('avatar-catalog:avatars')({}, args)
        expect(result.message).toBe('AVATAR_CATALOG_INVALID_ARGUMENTS')
        expect(service.listAvatars).not.toHaveBeenCalled()
      })
    }
  })

  it('服务返回失败码时透出原始 message，不改写为通用错误', async () => {
    const ipcMain = createIpcMain()
    const service = createService({
      listAvatars: vi.fn(async () => ({ code: -1, message: 'AVATAR_CATALOG_UNSUPPORTED_PROVIDER' })),
    })
    registerAvatarCatalogHandlers(ipcMain, { avatarCatalogService: service })

    const result = await ipcMain.handlers.get('avatar-catalog:avatars')({}, { providerId: 'kling' })
    expect(result.code).toBe(-1)
    expect(result.message).toBe('AVATAR_CATALOG_UNSUPPORTED_PROVIDER')
  })

  it('服务抛异常时收敛为 UNAVAILABLE，不把栈抛给 renderer', async () => {
    const ipcMain = createIpcMain()
    const service = createService({
      listAvatars: vi.fn(async () => { throw new Error('boom') }),
    })
    registerAvatarCatalogHandlers(ipcMain, { avatarCatalogService: service })

    const result = await ipcMain.handlers.get('avatar-catalog:avatars')({}, { providerId: 'heygen' })
    expect(result.code).toBe(-1)
    expect(result.message).toBe('AVATAR_CATALOG_UNAVAILABLE')
  })
})
