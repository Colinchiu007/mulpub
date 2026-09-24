// @ts-check
'use strict'
/**
 * film-engineering IPC 契约测试
 * 覆盖：sender 校验 / 入参校验 / FILM_KIT_UNAVAILABLE / 正常通道
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import nodeFs from 'node:fs'
import nodePath from 'node:path'
import nodeOs from 'node:os'

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
  'film-engineering:upload-reference',
  'film-engineering:download-recycled',
  'film-engineering:production-plan',
  'film-engineering:production-run-batch',
  'film-engineering:production-status',
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

  it('upload-reference 正常落盘返回规范化路径', async () => {
    const saveStub = vi.fn(async ({ mediaRoot }) => ({
      ok: true,
      path: nodePath.join(mediaRoot, 'references', 'ref-0123456789abcdef.png'),
      fileName: 'ref-0123456789abcdef.png',
      bytes: 68,
      mime: 'image/png',
    }))
    const deps = makeDeps({ _testSaveReference: saveStub })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:upload-reference')(TRUSTED_EVENT, { dataUrl: 'data:image/png;base64,AAAA' })
    expect(result.code).toBe(0)
    expect(result.data.fileName).toBe('ref-0123456789abcdef.png')
    expect(saveStub).toHaveBeenCalledTimes(1)
    expect(typeof saveStub.mock.calls[0][0].mediaRoot).toBe('string')
    expect(saveStub.mock.calls[0][0].mediaRoot).toMatch(/film-engineering/)
  })

  it('upload-reference 空 dataUrl 返回 VALIDATION_ERROR 且不落盘', async () => {
    const saveStub = vi.fn()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps({ _testSaveReference: saveStub }))
    const result = await ipcMain._get('film-engineering:upload-reference')(TRUSTED_EVENT, {})
    expect(result.code).toBe(-2)
    expect(saveStub).not.toHaveBeenCalled()
  })

  it('upload-reference 内容嗅探失败按校验错误返回', async () => {
    const saveStub = vi.fn(async () => ({ ok: false, error: '仅支持 PNG / JPEG / WEBP 格式参考图' }))
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps({ _testSaveReference: saveStub }))
    const result = await ipcMain._get('film-engineering:upload-reference')(TRUSTED_EVENT, { dataUrl: 'data:application/x-msdownload;base64,TVog' })
    expect(result.code).toBe(-2)
    expect(result.message).toMatch(/PNG/)
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

describe('film-engineering production 批量出片（任务 7.2/8.1-8.3，D6/D9）', () => {
  function makeVideoDeps (over = {}) {
    return makeDeps({
      aiGenerator: {
        _modelProviderManager: {
          getDefault: () => ({ id: 'vp1', models: ['seedance-pro'] }),
          callAdapter: vi.fn(),
        },
      },
      ...over,
    })
  }
  const idsOf = (n) => Array.from({ length: n }, (_, i) => 's' + i)
  const cleanupDirs = []
  afterEach(() => { while (cleanupDirs.length) { try { nodeFs.rmSync(cleanupDirs.pop(), { recursive: true, force: true }) } catch { /* 忽略 */ } } })

  it('production-plan：21 镜 → 3 批（10/10/1）+ 磁盘/墙钟估算 + 受控媒体根', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps())
    const r = await ipcMain._get('film-engineering:production-plan')(TRUSTED_EVENT, { shotIds: idsOf(21) })
    expect(r.code).toBe(0)
    expect(r.data.batchCount).toBe(3)
    expect(r.data.batchSize).toBe(10)
    expect(r.data.batches.map((b) => b.shotCount)).toEqual([10, 10, 1])
    expect(r.data.diskEstimateBytes).toBe(21 * 8 * 1024 * 1024)
    expect(r.data.wallclockEstimateSeconds).toBe(21 * 300)
    expect(r.data.mediaRoot.replace(/\\/g, '/')).toContain('film-engineering')
  })

  it('production-plan：空/超限/非法项 → VALIDATION_ERROR(-2)', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps())
    const h = ipcMain._get('film-engineering:production-plan')
    expect((await h(TRUSTED_EVENT, { shotIds: [] })).code).toBe(-2)
    expect((await h(TRUSTED_EVENT, { shotIds: idsOf(1001) })).code).toBe(-2)
    expect((await h(TRUSTED_EVENT, { shotIds: ['ok', '  '] })).code).toBe(-2)
    expect((await h(TRUSTED_EVENT, {})).code).toBe(-2)
  })

  it('run-batch：未配置视频 Provider → REQUEST_ERROR + VIDEO_MODEL_NOT_CONFIGURED', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps())
    const r = await ipcMain._get('film-engineering:production-run-batch')(TRUSTED_EVENT,
      { taskId: 'tk', shotIds: idsOf(2), batchIndex: 0 })
    expect(r.code).not.toBe(0)
    expect(r.errorCode).toBe('VIDEO_MODEL_NOT_CONFIGURED')
  })

  it('run-batch：taskId 路径遍历 / batchIndex 非整数 → -2（先于 provider 检查）', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeVideoDeps())
    const h = ipcMain._get('film-engineering:production-run-batch')
    expect((await h(TRUSTED_EVENT, { taskId: '../eviltk', shotIds: idsOf(2), batchIndex: 0 })).code).toBe(-2)
    expect((await h(TRUSTED_EVENT, { taskId: 'tk', shotIds: idsOf(2), batchIndex: 1.5 })).code).toBe(-2)
    expect((await h(TRUSTED_EVENT, { taskId: 'tk', shotIds: idsOf(2), batchIndex: -1 })).code).toBe(-2)
  })

  it('run-batch：driver 接线正确（ledgerDir 受控根/runOnlyBatch/事件推送/结果透传）', async () => {
    const sent = []
    const event = { senderFrame: TRUSTED_EVENT.senderFrame, sender: { send: (ch, payload) => sent.push([ch, payload]) } }
    let captured = null
    const driver = vi.fn(async (opts) => {
      captured = opts
      opts.emit({ type: 'production:batch', batchIndex: 2, status: 'running', doneCount: 20, totalCount: 21 })
      return {
        ok: true,
        ledger: { batches: [{ batchIndex: 2, status: 'done', error: null }] },
        renderManifest: { entries: [{ shotId: 's1', path: '/x/shot_000.mp4', sourceKind: 'generated', orderIndex: 0 }] },
        manifestError: null,
        failedBatches: [],
      }
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeVideoDeps({ _testRunProduction: driver }))
    const r = await ipcMain._get('film-engineering:production-run-batch')(event,
      { taskId: 'tk9', shotIds: idsOf(3), batchIndex: 2 })
    expect(r.code).toBe(0)
    expect(r.data.ok).toBe(true)
    expect(r.data.batchStatus).toBe('done')
    expect(r.data.renderManifest.length).toBe(1)
    expect(captured.taskId).toBe('tk9')
    expect(captured.runOnlyBatch).toBe(2)
    expect(captured.ledgerDir.replace(/\\/g, '/')).toContain('film-engineering/production/tk9')
    expect(typeof captured.probe).toBe('function')
    expect(typeof captured.runBatch).toBe('function')
    expect(sent.length).toBe(1)
    expect(sent[0][0]).toBe('film-engineering:production-update')
    expect(sent[0][1].type).toBe('production:batch')
    // sender 缺失（窗口销毁）不炸：emit 内部吞
    const ipcMain2 = createMockIpcMain()
    registerHandlers(ipcMain2, makeVideoDeps({
      _testRunProduction: async (opts) => { opts.emit({ type: 'x' }); return { ok: true, ledger: { batches: [] }, renderManifest: null, manifestError: null, failedBatches: [] } },
    }))
    const r2 = await ipcMain2._get('film-engineering:production-run-batch')(TRUSTED_EVENT,
      { taskId: 'tk2', shotIds: idsOf(2), batchIndex: 0 })
    expect(r2.code).toBe(0)
  })

  it('真实 runBatch 接线：fake generateShotVideo 逐镜上报；缺 prompt 镜 failed 不调生成', async () => {
    let captured = null
    const gen = vi.fn(async ({ shot, index }) => ({ index, shotId: shot.shotId, success: true, path: 'x' }))
    const service = makeServiceMock({
      getShot: vi.fn((id) => (id === 'bad' ? { shotId: id, prompt: '   ' } : { shotId: id, prompt: 'p-' + id })),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeVideoDeps({
      filmEngineeringService: service,
      _testGenerateShotVideo: gen,
      _testRunProduction: async (opts) => {
        captured = opts
        return { ok: true, ledger: { batches: [] }, renderManifest: null, manifestError: null, failedBatches: [] }
      },
    }))
    await ipcMain._get('film-engineering:production-run-batch')(TRUSTED_EVENT,
      { taskId: 'wire', shotIds: idsOf(2), batchIndex: 0, aspect: '9x16', seconds: 8 })
    const runId = 'prod-wire-b0'
    const dir = nodePath.join(nodeOs.tmpdir(), 'film-engineering', runId)
    cleanupDirs.push(dir)
    const progress = []
    await captured.runBatch(
      { batchIndex: 0, runId, shotIds: ['s1', 'bad', 's3'] },
      { onShotProgress: (i, st) => progress.push([i, st]) },
    )
    expect(gen).toHaveBeenCalledTimes(2)
    expect(gen.mock.calls[0][0].aspect).toBe('9x16')
    expect(gen.mock.calls[0][0].seconds).toBe(8)
    expect(gen.mock.calls[0][0].providerCfg.providerId).toBe('vp1')
    expect(gen.mock.calls[0][0].runDir.replace(/\\/g, '/')).toContain('film-engineering/' + runId)
    const done = progress.filter(([, st]) => st === 'done').map(([i]) => i).sort()
    const failed = progress.filter(([, st]) => st === 'failed').map(([i]) => i)
    expect(done).toEqual([0, 2])
    expect(failed).toEqual([1])
    expect(nodeFs.existsSync(dir)).toBe(true)
  })

  it('runBatch：入口 provider 预检优先于 driver（无 provider 时 driver 零调用）', async () => {
    const driver = vi.fn(async () => { throw new Error('should not reach') })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps({ _testRunProduction: driver }))
    const r = await ipcMain._get('film-engineering:production-run-batch')(TRUSTED_EVENT,
      { taskId: 'p2', shotIds: idsOf(2), batchIndex: 0 })
    expect(r.code).not.toBe(0)
    expect(r.errorCode).toBe('VIDEO_MODEL_NOT_CONFIGURED')
    expect(driver).not.toHaveBeenCalled()
  })

  it('production-status：无台账 exists:false；有台账返回批/镜状态 + 双核计数 + 收口清单', async () => {
    const ipcMain = createMockIpcMain()
    const probe = vi.fn(() => ({ missing: [] }))
    registerHandlers(ipcMain, makeDeps({ _testProbe: probe }))
    const h = ipcMain._get('film-engineering:production-status')
    const r0 = await h(TRUSTED_EVENT, { taskId: 'nostat', shotIds: idsOf(2) })
    expect(r0.code).toBe(0)
    expect(r0.data.exists).toBe(false)
    expect(r0.data.renderManifest).toBeNull()

    const taskId = 'stat-' + Date.now()
    const dir = nodePath.join(nodeOs.tmpdir(), 'film-engineering', 'production', taskId)
    cleanupDirs.push(dir)
    nodeFs.mkdirSync(dir, { recursive: true })
    const ledger = {
      schemaVersion: 1,
      taskId,
      batchSize: 10,
      createdAt: new Date().toISOString(),
      batches: [{
        batchIndex: 0,
        runId: 'prod-' + taskId + '-b0',
        shotIds: ['s0', 's1'],
        shots: [{ shotId: 's0', status: 'done' }, { shotId: 's1', status: 'failed' }],
        status: 'done',
        error: null,
      }],
    }
    nodeFs.writeFileSync(nodePath.join(dir, 'ledger.json'), JSON.stringify(ledger))
    const r = await h(TRUSTED_EVENT, { taskId, shotIds: idsOf(2) })
    expect(r.code).toBe(0)
    expect(r.data.exists).toBe(true)
    expect(r.data.batches[0].status).toBe('done')
    expect(r.data.batches[0].needRun).toBe(false)
    expect(r.data.doneCount).toBe(2)
    expect(r.data.renderManifest.length).toBe(2)
    expect(r.data.renderManifest.map((e) => e.orderIndex)).toEqual([0, 1])
    // 磁盘缺产物 → 收口为 null（双判据）
    const probe2 = { _testProbe: () => ({ missing: [1] }) }
    const ipcMain2 = createMockIpcMain()
    registerHandlers(ipcMain2, makeDeps(probe2))
    const r2 = await ipcMain2._get('film-engineering:production-status')(TRUSTED_EVENT, { taskId, shotIds: idsOf(2) })
    expect(r2.data.renderManifest).toBeNull()
    expect(r2.data.manifestError).toMatch(/缺失/)
  })

  it('production-status：非法入参 → -2', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps())
    expect((await ipcMain._get('film-engineering:production-status')(TRUSTED_EVENT, { taskId: 'a/b', shotIds: idsOf(1) })).code).toBe(-2)
  })
})
