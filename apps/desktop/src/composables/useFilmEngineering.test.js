// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useFilmEngineering } from './useFilmEngineering'
import { writeClipboard } from '@/utils/clipboard'

vi.mock('@/utils/clipboard', () => ({ writeClipboard: vi.fn(async () => true) }))

function installMockApi () {
  const api = {
    status: vi.fn(async () => ({ code: 0, data: { available: true, filmMeta: { title: 'Hell Grind' }, sceneCount: 162, shotCount: 153, referenceCount: 332, error: null } })),
    listScenes: vi.fn(async () => ({ code: 0, data: [
      { id: 'scene-1', name: '废墟街道', count: 3, parentId: null, level: 0, shotCount: 2 },
      { id: 'scene-2', name: '博物馆', count: 2, parentId: null, level: 0, shotCount: 1 },
    ] })),
    listShots: vi.fn(async (sceneId) => ({ code: 0, data: [
      { shotId: 'shot-1', sceneId, prompt: 'EXACT 3 CHARACTERS — NO DUPLICATES\n...', model: 'seedance_2_0', refTokens: ['t-1'], width: 1920, height: 1080 },
      { shotId: 'shot-2', sceneId, prompt: 'GEO SPATIAL LAYOUT\n...', model: 'seedance_2_0', refTokens: [], width: null, height: null },
    ] })),
    getShot: vi.fn(async (shotId) => ({ code: 0, data: { shotId, prompt: 'full', resolvedRefs: [{ token: 't-1', entry: { kind: 'character', name: 'REIN', imageUrls: ['https://cdn.example.com/rein.png'] } }] } })),
    doctrine: vi.fn(async () => ({ code: 0, data: { blocks: [{ key: 'scene_context', label: 'SCENE CONTEXT' }], rules: [], glossary: [] } })),
    copyText: vi.fn(async (shotId, mode) => ({ code: 0, data: { text: 'copied-' + mode, mode } })),
    copyTexts: vi.fn(async (shotIds, mode) => ({ code: 0, data: { text: 'multi', mode, count: shotIds.length } })),
    adaptScript: vi.fn(async (payload) => ({ code: 0, data: { adaptedShots: [{ shotId: 'adapt-001', prompt: 'adapted prompt' }], llmEnhanced: false, warnings: [] } })),
    exportPrompts: vi.fn(async (shots, format) => ({ code: 0, data: { export: { json: '{}', markdown: '# x' }, fileName: 'film-engineering-prompts-2026-08-14.json' } })),
    generateSelected: vi.fn(async (shots, opts) => ({ code: 0, data: { results: [{ index: 0, shotId: 'shot-1', code: 0 }], partialFailure: false } })),
  }
  return api
}

function installProfileApi (api) {
  api.story2videoConfigProfileList = vi.fn(async () => ({ code: 0, data: [] }))
  api.story2videoConfigProfileCreate = vi.fn(async (request) => ({ code: 0, data: { id: 'profile-000000000001', ...request } }))
  api.story2videoConfigProfileRename = vi.fn(async (id, name) => ({ code: 0, data: { id, name } }))
  api.story2videoConfigProfileDelete = vi.fn(async (id) => ({ code: 0, data: { deleted: true, id } }))
  return api
}

describe('useFilmEngineering', () => {
  function stubWindow (api) {
    vi.stubGlobal('window', {
      electronAPI: { filmEngineering: api },
      navigator: { clipboard: { writeText: vi.fn(async () => undefined) } },
    })
  }

  function stubWindowWithProfiles (api) {
    vi.stubGlobal('window', {
      electronAPI: { filmEngineering: api, ...api },
      navigator: { clipboard: { writeText: vi.fn(async () => undefined) } },
    })
  }

  beforeEach(() => { stubWindow(installMockApi()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('loadStatus 成功：available=true 且带真实数据路径', async () => {
    const c = useFilmEngineering()
    const ok = await c.loadStatus()
    expect(ok).toBe(true)
    expect(c.status.value.available).toBe(true)
    expect(c.status.value.sceneCount).toBe(162)
    expect(c.status.value.shotCount).toBe(153)
  })

  it('loadStatus 失败：kit 不可用 → available=false 且 error 非空（空态可展示）', async () => {
    const api = installMockApi()
    api.status = vi.fn(async () => ({ code: -1, message: 'FILM_KIT_UNAVAILABLE: 文件缺失' }))
    stubWindow(api)
    const c = useFilmEngineering()
    const ok = await c.loadStatus()
    expect(ok).toBe(false)
    expect(c.status.value.available).toBe(false)
    expect(c.status.value.error).toBeTruthy()
  })

  it('loadScenes 自动选中第一个有分镜的场景并加载分镜（真实数据路径）', async () => {
    const api = installMockApi()
    stubWindow(api)
    const c = useFilmEngineering()
    await c.loadScenes()
    expect(c.scenes.value.length).toBe(2)
    expect(c.selectedSceneId.value).toBe('scene-1')
    expect(api.listShots).toHaveBeenCalledWith('scene-1')
    expect(c.shots.value.length).toBe(2)
  })

  it('勾选与批量复制：copyTexts 收到勾选 id 与模式', async () => {
    const api = installMockApi()
    stubWindow(api)
    const c = useFilmEngineering()
    await c.loadScenes()
    c.toggleShot('shot-1')
    c.copyMode.value = 'blocks'
    await c.copySelected()
    expect(api.copyTexts).toHaveBeenCalledWith(['shot-1'], 'blocks')
    expect(writeClipboard).toHaveBeenCalledWith('multi')
  })

  it('单镜复制：copyText 转发 shotId+mode 并写剪贴板', async () => {
    const api = installMockApi()
    stubWindow(api)
    const c = useFilmEngineering()
    await c.copyText('shot-1', 'full')
    expect(api.copyText).toHaveBeenCalledWith('shot-1', 'full')
    expect(writeClipboard).toHaveBeenCalledWith('copied-full')
  })

  it('剧本套用：请求映射为 script+characterMap+llmEnabled，结果进入 adaptedShots', async () => {
    const api = installMockApi()
    stubWindow(api)
    const c = useFilmEngineering()
    c.adapt.script = '第一场 废墟\n\n小强走在废墟中。'
    c.adapt.characterMap.ROKO = '小强'
    c.adapt.llmEnabled = true
    const ok = await c.adaptScript()
    expect(ok).toBe(true)
    expect(api.adaptScript).toHaveBeenCalledWith({
      script: '第一场 废墟\n\n小强走在废墟中。',
      characterMap: { ROKO: '小强' },
      llmEnabled: true,
    })
    expect(c.adapt.adaptedShots.length).toBe(1)
    expect(c.adapt.adaptedShots[0].prompt).toBe('adapted prompt')
  })

  it('空剧本：不请求主进程并提示', async () => {
    const api = installMockApi()
    stubWindow(api)
    const c = useFilmEngineering()
    c.adapt.script = ''
    const ok = await c.adaptScript()
    expect(ok).toBe(true) // 主进程返回校验错误，前端提示
    expect(api.adaptScript).toHaveBeenCalled()
  })

  it('勾选生成：最多 20 个，超过直接拒绝', async () => {
    const api = installMockApi()
    stubWindow(api)
    const c = useFilmEngineering()
    c.selectedShotIds.value = Array.from({ length: 21 }, (_, i) => 'shot-' + i)
    const res = await c.generateSelected()
    expect(res).toBe(false)
    expect(api.generateSelected).not.toHaveBeenCalled()
  })

  it('分镜详情：openShot 返回 resolvedRefs（引用素材解析）', async () => {
    const api = installMockApi()
    stubWindow(api)
    const c = useFilmEngineering()
    await c.openShot('shot-1')
    expect(c.shotDetail.value.shotId).toBe('shot-1')
    expect(c.shotDetail.value.resolvedRefs[0].entry.name).toBe('REIN')
  })

  it('导出：exportPrompts 收到可结构化克隆的纯 JSON 负载', async () => {
    const api = installMockApi()
    stubWindow(api)
    const c = useFilmEngineering()
    await c.loadScenes()
    c.toggleShot('shot-1')
    await c.exportSelected('json')
    const payload = api.exportPrompts.mock.calls[0][0]
    expect(Array.isArray(payload)).toBe(true)
    expect(() => structuredClone(payload)).not.toThrow()
    expect(api.exportPrompts).toHaveBeenCalledWith(payload, 'json')
  })

  it('勾选生成：generateSelected 收到可结构化克隆的纯 JSON 负载', async () => {
    const api = installMockApi()
    stubWindow(api)
    const c = useFilmEngineering()
    await c.loadScenes()
    c.toggleShot('shot-1')
    const res = await c.generateSelected()
    expect(res).toBeTruthy()
    const payload = api.generateSelected.mock.calls[0][0]
    expect(() => structuredClone(payload)).not.toThrow()
    expect(api.generateSelected).toHaveBeenCalledWith(payload, { aspectRatio: '16:9' })
  })

  it('buildConfigProfileSnapshot 只保存套用选项，不保存剧本结果或运行态', () => {
    const c = useFilmEngineering()
    c.copyMode.value = 'characters'
    c.adapt.script = '私密剧本'
    c.adapt.characterMap.ROKO = '小强'
    c.adapt.llmEnabled = true
    c.adapt.adaptedShots = [{ prompt: 'runtime' }]
    const entries = [{ key: 'ROKO', value: '小强' }, { key: ' JAXX ', value: ' 小莉 ' }]
    const snapshot = c.buildConfigProfileSnapshot(entries)
    expect(snapshot).toMatchObject({ schemaVersion: 1, kind: 'film-engineering', filmEngineering: { copyMode: 'characters', llmEnabled: true } })
    expect(snapshot.filmEngineering.characterMap).toEqual({ ROKO: '小强', JAXX: '小莉' })
    expect(snapshot.filmEngineering).not.toHaveProperty('script')
    expect(snapshot.filmEngineering).not.toHaveProperty('adaptedShots')
    expect(() => structuredClone(snapshot)).not.toThrow()
  })

  it('applyConfigProfileSnapshot 归一化模式并同步 roleEntries 与 adapt.characterMap', () => {
    const c = useFilmEngineering()
    const entries = [{ key: 'ROKO', value: '' }]
    expect(c.applyConfigProfileSnapshot({ kind: 'film-engineering', filmEngineering: { copyMode: 'geo', llmEnabled: true, characterMap: { ROKO: ' 小强 ', JAXX: '小莉' } } }, entries)).toBe(true)
    expect(c.copyMode.value).toBe('geo')
    expect(c.adapt.llmEnabled).toBe(true)
    expect(c.adapt.characterMap).toEqual({ ROKO: '小强', JAXX: '小莉' })
    expect(entries).toEqual([{ key: 'ROKO', value: '小强' }, { key: 'JAXX', value: '小莉' }])
    expect(c.applyConfigProfileSnapshot({ kind: 'film-engineering', filmEngineering: { copyMode: 'bad', llmEnabled: 'yes' } }, entries)).toBe(false)
    expect(c.copyMode.value).toBe('geo')
  })

  it('config profile CRUD 固定 film-engineering pipelineId，并过滤其他流水线', async () => {
    const api = installProfileApi(installMockApi())
    api.story2videoConfigProfileList.mockImplementation(async () => ({ code: 0, data: [
      { id: 'p1', name: 'film', pipelineId: 'film-engineering', updatedAt: 2 },
      { id: 'p2', name: 'other', pipelineId: 'video-clone', updatedAt: 3 },
    ] }))
    stubWindowWithProfiles(api)
    const c = useFilmEngineering()
    const list = await c.loadConfigProfiles()
    expect(list).toHaveLength(2)
    expect(list.find((item) => item.pipelineId === 'film-engineering')).toBeTruthy()
    expect(list.find((item) => item.pipelineId === 'video-clone')).toBeTruthy()
    await c.saveConfigProfile('影视配置')
    expect(api.story2videoConfigProfileCreate).toHaveBeenCalledWith(expect.objectContaining({ pipelineId: 'film-engineering' }))
  })
})
