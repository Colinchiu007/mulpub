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
  'film-engineering:download-recycled',
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

describe('film-engineering:download-recycled（L3 原片回收下载，任务 6.2/D7）', () => {
  function makeSvc (over = {}) {
    return makeDeps({
      filmEngineeringService: Object.assign(makeServiceMock(), {
        getAllowedHosts: over.getAllowedHosts || vi.fn(() => ['cdn.example.com']),
        getShot: over.getShot || vi.fn((id) => (id === 's-ok'
          ? { shotId: 's-ok', resultUrl: 'https://cdn.example.com/raw/ok.mp4' }
          : { shotId: id, resultUrl: null })),
      }),
    })
  }

  it('成功：URL 一律取 kit resultUrl，落盘 production/<taskId>/recycled/shot_NNN.mp4，条目含 orderIndex', async () => {
    const dl = vi.fn(async (o) => ({ ok: true, entry: { shotId: o.shotId, path: o.destDir + '/' + o.fileName, sourceKind: 'downloaded' } }))
    const deps = makeSvc()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, { ...deps, _testDownloadShot: dl })
    const r = await ipcMain._get('film-engineering:download-recycled')(TRUSTED_EVENT, {
      taskId: 'task-1', items: [{ shotId: 's-ok', orderIndex: 5 }],
    })
    expect(r.code).toBe(0)
    expect(r.data.allOk).toBe(true)
    expect(r.data.results[0].orderIndex).toBe(5)
    expect(r.data.results[0].entry.sourceKind).toBe('downloaded')
    expect(r.data.results[0].entry.orderIndex).toBe(5)
    expect(String(r.data.results[0].entry.path).replace(/\\/g, '/')).toMatch(/film-engineering\/production\/task-1\/recycled\/shot_005\.mp4$/)
    const arg = dl.mock.calls[0][0]
    expect(arg.fileName).toBe('shot_005.mp4')
    expect(arg.url).toBe('https://cdn.example.com/raw/ok.mp4')
    expect(arg.allowedHosts).toEqual(['cdn.example.com'])
    expect(deps.filmEngineeringService.getShot).toHaveBeenCalledWith('s-ok')
  })

  it('renderer 传入 url 字段被忽略（服务端只信 kit）', async () => {
    const dl = vi.fn(async (o) => ({ ok: true, entry: { shotId: o.shotId, path: o.destDir, sourceKind: 'downloaded' } }))
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, { ...makeSvc(), _testDownloadShot: dl })
    const r = await ipcMain._get('film-engineering:download-recycled')(TRUSTED_EVENT, {
      taskId: 't2', items: [{ shotId: 's-ok', orderIndex: 0, url: 'https://evil.example/x.mp4' }],
    })
    expect(r.code).toBe(0)
    expect(dl.mock.calls[0][0].url).toBe('https://cdn.example.com/raw/ok.mp4')
  })

  it('部分失败隔离：无 resultUrl 的镜单项失败，其余照常成功', async () => {
    const dl = vi.fn(async (o) => ({ ok: true, entry: { shotId: o.shotId, path: 'p', sourceKind: 'downloaded' } }))
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, { ...makeSvc(), _testDownloadShot: dl })
    const r = await ipcMain._get('film-engineering:download-recycled')(TRUSTED_EVENT, {
      taskId: 't3', items: [{ shotId: 's-ok', orderIndex: 0 }, { shotId: 's-missing', orderIndex: 1 }],
    })
    expect(r.code).toBe(0)
    expect(r.data.allOk).toBe(false)
    expect(r.data.results[0].ok).toBe(true)
    expect(r.data.results[1].ok).toBe(false)
    expect(r.data.results[1].error).toMatch(/resultUrl/)
    expect(dl.mock.calls.length).toBe(1)
  })

  it('下载器失败透传 error（隔离不中断批次）', async () => {
    const dl = vi.fn(async () => ({ ok: false, error: '下载失败：片段验证未通过' }))
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, { ...makeSvc(), _testDownloadShot: dl })
    const r = await ipcMain._get('film-engineering:download-recycled')(TRUSTED_EVENT, {
      taskId: 't4', items: [{ shotId: 's-ok', orderIndex: 0 }],
    })
    expect(r.code).toBe(0)
    expect(r.data.allOk).toBe(false)
    expect(r.data.results[0].error).toMatch(/片段验证未通过/)
  })

  it('入参校验：taskId 路径遍历 / items 空 / orderIndex 重复或非法 → 非零信封', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, { ...makeSvc(), _testDownloadShot: vi.fn() })
    const call = (payload) => ipcMain._get('film-engineering:download-recycled')(TRUSTED_EVENT, payload)
    for (const bad of [
      { taskId: '../evil', items: [{ shotId: 's-ok', orderIndex: 0 }] },
      { taskId: 'a\\b', items: [{ shotId: 's-ok', orderIndex: 0 }] },
      { taskId: '', items: [{ shotId: 's-ok', orderIndex: 0 }] },
      { taskId: 't', items: [] },
      { taskId: 't', items: 'not-array' },
      { taskId: 't', items: [{ shotId: 's-ok', orderIndex: 1 }, { shotId: 's-ok', orderIndex: 1 }] },
      { taskId: 't', items: [{ shotId: 's-ok', orderIndex: -1 }] },
      { taskId: 't', items: [{ shotId: 's-ok', orderIndex: 1.5 }] },
      { taskId: 't', items: [{ shotId: '  ', orderIndex: 0 }] },
      { taskId: 't', items: Array.from({ length: 51 }, (_, i) => ({ shotId: 's-ok', orderIndex: i })) },
    ]) {
      const r = await call(bad)
      expect(r.code, JSON.stringify(bad).slice(0, 60)).not.toBe(0)
    }
  })

  it('kit 不可用 → FILM_KIT_UNAVAILABLE 信封（fail-closed）', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, {
      ...makeSvc({ getAllowedHosts: vi.fn(() => { throw new Error('FILM_KIT_UNAVAILABLE: load failed') }) }),
      _testDownloadShot: vi.fn(),
    })
    const r = await ipcMain._get('film-engineering:download-recycled')(TRUSTED_EVENT, {
      taskId: 't', items: [{ shotId: 's-ok', orderIndex: 0 }],
    })
    expect(r.code).not.toBe(0)
    expect(r.message).toMatch(/FILM_KIT_UNAVAILABLE/)
  })
})
