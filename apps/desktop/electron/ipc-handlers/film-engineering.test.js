// @ts-check
'use strict'
/**
 * film-engineering IPC 契约测试
 * 覆盖：sender 校验 / 入参校验 / FILM_KIT_UNAVAILABLE / 正常通道
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../services/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

__enableElectronMock()

let registerHandlers
let originalNodeEnv
let originalIsPackaged

beforeEach(async () => {
  vi.resetModules()
  originalNodeEnv = process.env.NODE_ENV
  originalIsPackaged = __electronMock.app.isPackaged
  delete process.env.NODE_ENV
  __electronMock.app.isPackaged = false
  const mod = await import('./film-engineering')
  registerHandlers = mod.default || mod
})

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  __electronMock.app.isPackaged = originalIsPackaged
})

function createMockIpcMain () {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    _get: (channel) => handlers[channel],
  }
}

const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }
const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }

function makeServiceMock (overrides = {}) {
  return {
    getStatus: vi.fn(() => ({ available: true, filmMeta: { title: 'Hell Grind' }, sceneCount: 1, shotCount: 1, referenceCount: 2, error: null })),
    listScenes: vi.fn(() => [{ id: 'cold-open', name: '1. COLD OPEN', count: 12, level: 0 }]),
    listShots: vi.fn(() => [{ shotId: 's1', sceneId: 'cold-open', prompt: 'p', model: 'm', refTokens: [] }]),
    getShot: vi.fn(() => ({ shotId: 's1', prompt: 'p', resolvedRefs: [] })),
    getDoctrine: vi.fn(() => ({ blocks: [], rules: [], glossary: [] })),
    buildCopyText: vi.fn(() => 'copy text'),
    buildCopyTexts: vi.fn(() => 'merged text'),
    adaptScript: vi.fn(async () => ({ ok: true, adaptedShots: [{ shotId: 'adapt-001', prompt: 'p' }], llmEnhanced: false, warnings: [] })),
    exportPrompts: vi.fn(() => ({ export: { json: '{}', markdown: '# x' }, fileName: 'x.json' })),
    generateSelected: vi.fn(async () => ({ ok: true, results: [{ code: 0 }], partialFailure: false })),
    ...overrides,
  }
}

function makeDeps (overrides = {}) {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    filmEngineeringService: makeServiceMock(),
    ...overrides,
  }
}

const CHANNELS = [
  'film-engineering:status',
  'film-engineering:list-scenes',
  'film-engineering:list-shots',
  'film-engineering:get-shot',
  'film-engineering:doctrine',
  'film-engineering:copy-text',
  'film-engineering:copy-texts',
  'film-engineering:adapt-script',
  'film-engineering:export',
  'film-engineering:generate-selected',
]

describe('film-engineering IPC sender 校验', () => {
  it.each(CHANNELS)('%s 拒绝外部网页调用', async (channel) => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get(channel)(UNTRUSTED_EVENT, {})
    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })
})

describe('film-engineering IPC 正常通道', () => {
  it('status 返回 kit 状态', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps())
    const result = await ipcMain._get('film-engineering:status')(TRUSTED_EVENT)
    expect(result.code).toBe(0)
    expect(result.data.available).toBe(true)
  })

  it('list-scenes 返回场景树', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps())
    const result = await ipcMain._get('film-engineering:list-scenes')(TRUSTED_EVENT)
    expect(result.code).toBe(0)
    expect(result.data.length).toBe(1)
  })

  it('list-shots 合法 sceneId 按 IPC 参数顺序转发到服务', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:list-shots')(TRUSTED_EVENT, 'scene-42')
    expect(result.code).toBe(0)
    expect(deps.filmEngineeringService.listShots).toHaveBeenCalledWith('scene-42', undefined)
  })

  it('get-shot 合法 shotId 按 IPC 参数顺序转发到服务', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:get-shot')(TRUSTED_EVENT, 'shot-42')
    expect(result.code).toBe(0)
    expect(deps.filmEngineeringService.getShot).toHaveBeenCalledWith('shot-42')
  })

  it('copy-text 合法 shotId 和 mode 按 IPC 参数顺序转发到服务', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:copy-text')(TRUSTED_EVENT, 'shot-42', ' blocks ')
    expect(result.code).toBe(0)
    expect(deps.filmEngineeringService.buildCopyText).toHaveBeenCalledWith('shot-42', 'blocks')
    expect(result.data.mode).toBe('blocks')
  })

  it('copy-texts 合法 shotIds 和 mode 按 IPC 参数顺序转发到服务', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const shotIds = ['shot-1', 'shot-2']
    const result = await ipcMain._get('film-engineering:copy-texts')(TRUSTED_EVENT, shotIds, ' geo ')
    expect(result.code).toBe(0)
    expect(deps.filmEngineeringService.buildCopyTexts).toHaveBeenCalledWith(shotIds, 'geo')
    expect(result.data.count).toBe(2)
  })

  it('export 合法 selectedShots 和 format 按 IPC 参数顺序转发到服务', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const selectedShots = [{ shotId: 'shot-42', prompt: 'prompt' }]
    const result = await ipcMain._get('film-engineering:export')(TRUSTED_EVENT, selectedShots, 'markdown')
    expect(result.code).toBe(0)
    expect(deps.filmEngineeringService.exportPrompts).toHaveBeenCalledWith(selectedShots, 'markdown')
  })

  it('list-shots 非法 sceneId 返回 VALIDATION_ERROR', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:list-shots')(TRUSTED_EVENT, '  ')
    expect(result.code).toBe(-2)
    expect(deps.filmEngineeringService.listShots).not.toHaveBeenCalled()
  })

  it('copy-texts 超过 50 项被拒绝', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const many = Array.from({ length: 51 }, (_, i) => 'id' + i)
    const result = await ipcMain._get('film-engineering:copy-texts')(TRUSTED_EVENT, many, 'full')
    expect(result.code).toBe(-2)
  })

  it('adapt-script 空剧本被拒绝', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:adapt-script')(TRUSTED_EVENT, { script: '', characterMap: {} })
    expect(result.code).toBe(-2)
    expect(result.message).toMatch(/剧本/)
    expect(deps.filmEngineeringService.adaptScript).not.toHaveBeenCalled()
  })

  it('adapt-script 超长剧本被拒绝', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps())
    const result = await ipcMain._get('film-engineering:adapt-script')(TRUSTED_EVENT, { script: 'x'.repeat(10001), characterMap: {} })
    expect(result.code).toBe(-2)
  })

  it('adapt-script 角色映射超 10 键被拒绝', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps())
    const cm = {}
    for (let i = 0; i < 11; i++) cm['K' + i] = 'v' + i
    const result = await ipcMain._get('film-engineering:adapt-script')(TRUSTED_EVENT, { script: '剧本', characterMap: cm })
    expect(result.code).toBe(-2)
  })

  it('adapt-script 成功返回 adaptedShots', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps())
    const result = await ipcMain._get('film-engineering:adapt-script')(TRUSTED_EVENT, {
      script: '第一场\n\n剧情。',
      characterMap: { ROKO: '小强' },
    })
    expect(result.code).toBe(0)
    expect(result.data.adaptedShots.length).toBe(1)
  })

  it('export 校验 selectedShots prompt 非空', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:export')(TRUSTED_EVENT, [{ prompt: '' }], 'json')
    expect(result.code).toBe(-2)
  })

  it('generate-selected 超过 20 项被拒绝', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const many = Array.from({ length: 21 }, () => ({ shotId: 's', sceneId: 'x', prompt: 'p', model: 'm', refTokens: [] }))
    const result = await ipcMain._get('film-engineering:generate-selected')(TRUSTED_EVENT, many, {})
    expect(result.code).toBe(-2)
    expect(deps.filmEngineeringService.generateSelected).not.toHaveBeenCalled()
  })
})

describe('film-engineering IPC fail-closed', () => {
  it('kit 不可用时查询类通道返回 FILM_KIT_UNAVAILABLE', async () => {
    const service = makeServiceMock({
      getStatus: vi.fn(() => ({ available: false, filmMeta: null, sceneCount: 0, shotCount: 0, referenceCount: 0, error: 'FILM_KIT_UNAVAILABLE: shot-library.json 缺失' })),
      listScenes: vi.fn(() => { throw new Error('FILM_KIT_UNAVAILABLE: shot-library.json 缺失') }),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps({ filmEngineeringService: service }))
    const status = await ipcMain._get('film-engineering:status')(TRUSTED_EVENT)
    expect(status.data.available).toBe(false)
    expect(status.data.error).toMatch(/FILM_KIT_UNAVAILABLE/)
    const scenes = await ipcMain._get('film-engineering:list-scenes')(TRUSTED_EVENT)
    expect(scenes.code).not.toBe(0)
    expect(scenes.message).toMatch(/FILM_KIT_UNAVAILABLE/)
  })
})

describe('list-shots 分页（任务 4.2）', () => {
  it('分页参数纯 JSON 透传到 service', async () => {
    const ipc = createMockIpcMain()
    const deps = makeDeps()
    registerHandlers(ipc, deps)
    const fn = ipc._get('film-engineering:list-shots')
    const res = await fn(TRUSTED_EVENT, 'cold-open', { limit: 10, offset: 20 })
    expect(res.code).toBe(0)
    expect(deps.filmEngineeringService.listShots).toHaveBeenCalledWith('cold-open', { limit: 10, offset: 20 })
  })

  it('分页参数类型非法一律 VALIDATION 拒绝（字符串/数组/子字段非数字）', async () => {
    const ipc = createMockIpcMain()
    const deps = makeDeps()
    registerHandlers(ipc, deps)
    const fn = ipc._get('film-engineering:list-shots')
    expect((await fn(TRUSTED_EVENT, 'cold-open', 'not-an-object')).code).not.toBe(0)
    expect((await fn(TRUSTED_EVENT, 'cold-open', [1, 2])).code).not.toBe(0)
    expect((await fn(TRUSTED_EVENT, 'cold-open', { limit: 'ten' })).code).not.toBe(0)
    expect((await fn(TRUSTED_EVENT, 'cold-open', { offset: 1.5 })).code).not.toBe(0)
    // 不传分页参数保持既有全量语义
    expect((await fn(TRUSTED_EVENT, 'cold-open')).code).toBe(0)
  })
})
