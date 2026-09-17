// @ts-check
/**
 * model-provider-multimodal.test.js — 多模态模型类别/预设/路由/偏好开关
 *
 * 覆盖：
 *   - multimodal 类别与标签、MiniMax 多模态预设能力声明（≥2 项）与能力默认模型
 *   - 种子持久化：预设 capabilities/capability_models 写入行 config
 *   - getDefault 多模态路由：开启偏好且多模态已配置且声明能力 → 返回多模态模型；
 *     未开启 / 未配置 / 未声明能力 → 返回类别 provider
 *   - 偏好开关读写
 *   - MinimaxMultimodalAdapter 能力与委托
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

const initSqlJs = require('sql.js')

class SqlJsAdapter {
  constructor (database) { this.database = database }
  prepare (sql) {
    const database = this.database
    return {
      run (...params) {
        const statement = database.prepare(sql)
        if (params.length) statement.bind(params)
        statement.step()
        const changes = database.getRowsModified()
        statement.free()
        return { changes }
      },
      get (...params) {
        const statement = database.prepare(sql)
        if (params.length) statement.bind(params)
        const row = statement.step() ? statement.getAsObject() : undefined
        statement.free()
        return row
      },
      all (...params) {
        const rows = []
        const statement = database.prepare(sql)
        if (params.length) statement.bind(params)
        while (statement.step()) rows.push(statement.getAsObject())
        statement.free()
        return rows
      },
    }
  }
  exec (sql) { this.database.exec(sql) }
}

async function createStore (database, settings) {
  const { SCHEMA_SQL } = require('./store-schema')
const adapterRegistry = require('./adapters/_base/registry-singleton')
  const db = new SqlJsAdapter(database)
  for (const statement of SCHEMA_SQL) db.exec(statement)
  const map = settings || new Map()
  const store = {
    db,
    _ready: true,
    _resolveOwnerSubject: () => 'test-owner',
    getSetting: (key) => map.has(key) ? map.get(key) : null,
    setSetting: (key, value) => map.set(key, value),
    getUserSetting: (key, fallback) => (map.has(key) ? map.get(key) : fallback),
    setUserSetting: (key, value) => map.set(key, value),
  }
  return { db, store }
}

function newManager (store) {
  const { ModelProviderManager } = require('./model-provider-manager')
  const manager = new ModelProviderManager(store)
  manager.init()
  return manager
}

function enableProvider (db, id, apiKey = 'test-key') {
  db.prepare('UPDATE model_providers SET enabled = ? WHERE id = ?').run(1, id)
  db.prepare('UPDATE model_providers SET api_key = ? WHERE id = ?').run(apiKey, id)
}

describe('多模态模型类别与 MiniMax 预设', () => {
  let database

  beforeAll(async () => {
    const SQL = await initSqlJs()
    database = new SQL.Database()
  })
  afterAll(() => { if (database) database.close() })

  it('multimodal 类别与中文标签存在，且预设能力 ≥ 2 项', async () => {
    const { store } = await createStore(database)
    const manager = newManager(store)
    const presets = manager.getAvailablePresets('multimodal')
    const minimax = presets.find(p => p.id === 'minimax-multimodal')
    expect(minimax).toBeDefined()
    expect(minimax.name).toBe('MiniMax')
    expect(Array.isArray(minimax.capabilities)).toBe(true)
    expect(minimax.capabilities.length).toBeGreaterThanOrEqual(2)
    expect(minimax.capability_models).toBeDefined()
    // 能力默认模型必须覆盖每个声明能力
    for (const cap of minimax.capabilities) {
      expect(typeof minimax.capability_models[cap]).toBe('string')
    }
  })

  it('存量行 diff-merge：旧能力配置升级时合并新增 llm 能力', async () => {
    const { db, store } = await createStore(database)
    const manager = newManager(store)
    // 模拟升级前的存量行（无 llm）
    db.prepare("UPDATE model_providers SET config = ?, updated_at = datetime('now') WHERE id = 'minimax-multimodal'")
      .run(JSON.stringify({
        capabilities: ['tts', 'image', 'video'],
        capability_models: { tts: 'speech-2.8-turbo', image: 'image-01', video: 'MiniMax-Hailuo-2.3' },
      }))
    manager._syncPresetCapabilities()
    const row = db.prepare("SELECT config FROM model_providers WHERE id = 'minimax-multimodal'").get()
    const config = JSON.parse(row.config)
    expect([...config.capabilities].sort()).toEqual(['image', 'llm', 'tts', 'video'])
    expect(config.capability_models.llm).toBe('MiniMax-M2.7')
  })

  it('存量行 models 回填预设新增模型（如 MiniMax-M2.7），顺序保持不变且幂等', async () => {
    const { db, store } = await createStore(database)
    const manager = newManager(store)
    // 模拟升级前的存量行（缺 MiniMax-M2.7）
    db.prepare("UPDATE model_providers SET models = ?, updated_at = datetime('now') WHERE id = 'minimax-multimodal'")
      .run(JSON.stringify(['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3']))
    manager._syncPresetCapabilities()
    const row = db.prepare("SELECT models FROM model_providers WHERE id = 'minimax-multimodal'").get()
    const models = JSON.parse(row.models)
    expect(models).toContain('MiniMax-M2.7')
    expect(models.indexOf('MiniMax-M2.7')).toBe(3) // 只追加，不改变既有顺序
    // 幂等：再次同步不重复追加
    manager._syncPresetCapabilities()
    const row2 = db.prepare("SELECT models FROM model_providers WHERE id = 'minimax-multimodal'").get()
    expect(JSON.parse(row2.models).filter(m => m === 'MiniMax-M2.7')).toHaveLength(1)
  })

  it('存量行 models 含空格/空串时清洗去重后回填', async () => {
    const { db, store } = await createStore(database)
    const manager = newManager(store)
    db.prepare("UPDATE model_providers SET models = ?, updated_at = datetime('now') WHERE id = 'minimax-multimodal'")
      .run(JSON.stringify(['speech-2.8-turbo ', '', 'image-01', ' image-01 ', 'MiniMax-Hailuo-2.3']))
    manager._syncPresetCapabilities()
    const row = db.prepare("SELECT models FROM model_providers WHERE id = 'minimax-multimodal'").get()
    const models = JSON.parse(row.models)
    expect(models).toEqual(['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3', 'MiniMax-M2.7'])
  })

  it('预设已全部存在但存量含空格/空串/重复时，清洗结果也持久化', async () => {
    const { db, store } = await createStore(database)
    const manager = newManager(store)
    // 已含全部预设模型，但带空格/空串/重复（无需回填，清洗必须落库）
    db.prepare("UPDATE model_providers SET models = ?, updated_at = datetime('now') WHERE id = 'minimax-multimodal'")
      .run(JSON.stringify(['speech-2.8-turbo ', '', 'image-01', ' image-01 ', 'MiniMax-Hailuo-2.3', 'MiniMax-M2.7']))
    manager._syncPresetCapabilities()
    const row = db.prepare("SELECT models FROM model_providers WHERE id = 'minimax-multimodal'").get()
    expect(JSON.parse(row.models)).toEqual(['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3', 'MiniMax-M2.7'])
  })

  it('非 multimodal 类别行 models 不被同步改写', async () => {
    const { db, store } = await createStore(database)
    const manager = newManager(store)
    db.prepare("UPDATE model_providers SET models = ?, updated_at = datetime('now') WHERE id = 'openai'")
      .run(JSON.stringify(['gpt-4o']))
    manager._syncPresetCapabilities()
    const row = db.prepare("SELECT models FROM model_providers WHERE id = 'openai'").get()
    expect(JSON.parse(row.models)).toEqual(['gpt-4o'])
  })

  it('种子持久化：预设行 config 包含 capabilities 与 capability_models', async () => {
    const { db, store } = await createStore(database)
    const manager = newManager(store)
    const row = db.prepare("SELECT config FROM model_providers WHERE id = 'minimax-multimodal'").get()
    expect(row).toBeDefined()
    const config = JSON.parse(row.config)
    expect(config.capabilities).toContain('tts')
    expect(config.capability_models.image).toBe('image-01')
    const listed = manager.listProviders('multimodal').find(p => p.id === 'minimax-multimodal')
    expect([...listed.capabilities].sort()).toEqual(['image', 'llm', 'tts', 'video'])
    expect(listed.capability_models.video).toBe('MiniMax-Hailuo-2.3')
  })

  it('能力选择器（image/tts 等）并入已启用且声明该能力的多模态模型', async () => {
    const SQL = await initSqlJs()
    const database = new SQL.Database()
    try {
      const { db, store } = await createStore(database)
      const manager = newManager(store)

      // 未启用：不并入能力列表
      expect(manager.listProviders('image').some(p => p.id === 'minimax-multimodal')).toBe(false)

      enableProvider(db, 'minimax-multimodal', 'mm-key')
    // 设置 video capability_defaults 使多模态模型参与 video 默认解析
    const row = db.prepare("SELECT config FROM model_providers WHERE id = 'minimax-multimodal'").get()
    const config = JSON.parse(row.config)
    config.capability_defaults = ['video']
    db.prepare("UPDATE model_providers SET config = ? WHERE id = 'minimax-multimodal'").run(JSON.stringify(config))
      expect(manager.listProviders('image').some(p => p.id === 'minimax-multimodal')).toBe(true)
      expect(manager.listProviders('tts').some(p => p.id === 'minimax-multimodal')).toBe(true)
      // video 能力默认关闭（「支持生成视频」开关未开启），能力选择器不并入
      expect(manager.listProviders('video').some(p => p.id === 'minimax-multimodal')).toBe(false)
      expect(manager.listProviders('llm').some(p => p.id === 'minimax-multimodal')).toBe(true)

      // 未声明能力（speech_recognition）不并入
      expect(manager.listProviders('speech_recognition').some(p => p.id === 'minimax-multimodal')).toBe(false)

      // 并入项保留能力声明与能力默认模型，供前端限定语音模型下拉
      const imageEntry = manager.listProviders('image').find(p => p.id === 'minimax-multimodal')
      expect(imageEntry.category).toBe('multimodal')
      expect(imageEntry.capabilities).toContain('image')
      expect(imageEntry.capability_models.tts).toBe('speech-2.8-turbo')

      // 多模态类别列表仍只含多模态本身
      expect(manager.listProviders('multimodal').every(p => p.category === 'multimodal')).toBe(true)
    } finally {
      database.close()
    }
  })
})

describe('getDefault 多模态路由', () => {
  let database
  let db
  let store
  let manager

  beforeAll(async () => {
    const SQL = await initSqlJs()
    database = new SQL.Database()
    ;({ db, store } = await createStore(database))
    manager = newManager(store)
    // 配置类别 provider 与多模态 provider
    enableProvider(db, 'elevenlabs', 'tts-key')
    enableProvider(db, 'minimax-image', 'img-key')
    enableProvider(db, 'minimax-multimodal', 'mm-key')
  })
  afterAll(() => { if (database) database.close() })

  it('未开启偏好时返回类别 provider', () => {
    const tts = manager.getDefault('tts')
    expect(tts.id).toBe('elevenlabs')
  })

  it('capability_defaults 启用时，对应能力返回多模态模型（video 由开关控制）', () => {
    // 设置多模态模型的 capability_defaults
    const row = db.prepare("SELECT config FROM model_providers WHERE id = 'minimax-multimodal'").get()
    const config = JSON.parse(row.config)
    config.capability_defaults = ['llm', 'tts', 'image']
    db.prepare("UPDATE model_providers SET config = ? WHERE id = 'minimax-multimodal'").run(JSON.stringify(config))
    expect(manager.getDefault('llm').id).toBe('minimax-multimodal')
    expect(manager.getDefault('tts').id).toBe('minimax-multimodal')
    expect(manager.getDefault('image').id).toBe('minimax-multimodal')
    // video 能力默认关闭（「支持生成视频」开关未开启），不返回多模态
    expect(manager.getDefault('video')).toBeNull()
    // 清理 capability_defaults
    config.capability_defaults = []
    db.prepare("UPDATE model_providers SET config = ? WHERE id = 'minimax-multimodal'").run(JSON.stringify(config))
  })

  it('capability_defaults 未包含该能力时回退类别 provider', () => {
    // capability_defaults 已在上一个测试中清空
    expect(manager.getDefault('speech_recognition')).toBeNull()
    // tts 有类别 provider (elevenlabs)，但 capability_defaults 已清空，不返回多模态
    expect(manager.getDefault('tts').id).toBe('elevenlabs')
  })

  it('多模态未配置时回退类别 provider', async () => {
    db.prepare("UPDATE model_providers SET enabled = ? WHERE id = 'minimax-multimodal'").run(0)
    expect(manager.getDefault('tts').id).toBe('elevenlabs')
  })
})

describe('普通 provider 覆盖多模态全局默认', () => {
  it('将 OpenRouter 设为文字推理默认后，路由和持久化卡片标记保持一致', async () => {
    const SQL = await initSqlJs()
    const database = new SQL.Database()
    try {
      const { db, store } = await createStore(database)
      const manager = newManager(store)
      enableProvider(db, 'openrouter', 'openrouter-key')
      enableProvider(db, 'minimax-multimodal', 'minimax-key')

      expect(manager.setDefault('multimodal', 'minimax-multimodal').code).toBe(0)
      // 模拟能力默认改造前留下的整体默认：没有显式 capability_defaults，
      // 但 is_default 仍表示所有声明能力均为默认。
      const globalRow = db.prepare("SELECT config FROM model_providers WHERE id = 'minimax-multimodal'").get()
      const globalConfig = JSON.parse(globalRow.config)
      globalConfig.capability_defaults = []
      db.prepare("UPDATE model_providers SET config = ? WHERE id = 'minimax-multimodal'").run(JSON.stringify(globalConfig))
      expect(manager.getDefault('llm').id).toBe('minimax-multimodal')

      expect(manager.setDefault('llm', 'openrouter').code).toBe(0)

      expect(manager.getDefault('llm').id).toBe('openrouter')
      const providers = manager.listProviders()
      expect(providers.find(provider => provider.id === 'openrouter').is_default).toBe(true)
      expect(providers.find(provider => provider.id === 'minimax-multimodal').is_default).toBe(false)

      const row = db.prepare("SELECT config FROM model_providers WHERE id = 'minimax-multimodal'").get()
      const config = JSON.parse(row.config)
      expect(config.capability_defaults).not.toContain('llm')
      expect(config.capability_defaults).toEqual(expect.arrayContaining(['tts', 'image', 'video']))
      expect(manager.getDefault('tts').id).toBe('minimax-multimodal')
      expect(manager.getDefault('image').id).toBe('minimax-multimodal')
    } finally {
      database.close()
    }
  })

})


describe('多模态 video 能力开关（支持生成视频，默认关闭）', () => {
  let database
  let db
  let store
  let manager

  beforeAll(async () => {
    const SQL = await initSqlJs()
    database = new SQL.Database()
    ;({ db, store } = await createStore(database))
    manager = newManager(store)
    enableProvider(db, 'agnes-video', 'agnes-key')
    enableProvider(db, 'minimax-multimodal', 'mm-key')
  })
  afterAll(() => { if (database) database.close() })

  function setVideoEnabled (value) {
    const row = db.prepare("SELECT config FROM model_providers WHERE id = 'minimax-multimodal'").get()
    const config = JSON.parse(row.config)
    config.capability_enabled = { ...(config.capability_enabled || {}), video: value }
    // 确保 capability_defaults 包含 video（beforeAll 已设置，但 setVideoEnabled 会重写 config）
    if (!Array.isArray(config.capability_defaults)) config.capability_defaults = ['video']
    db.prepare("UPDATE model_providers SET config = ? WHERE id = 'minimax-multimodal'").run(JSON.stringify(config))
  }

  it('缺省（无 capability_enabled）时 video 默认解析回落 video 类别 provider', () => {
    expect(manager.getDefault('video').id).toBe('agnes-video')
  })

  it('capability_enabled.video=false 时不返回多模态 video', () => {
    setVideoEnabled(false)
    expect(manager.getDefault('video').id).toBe('agnes-video')
  })

  it('capability_enabled.video=true 时 video 默认解析回多模态模型', () => {
    setVideoEnabled(true)
    expect(manager.getDefault('video').id).toBe('minimax-multimodal')
  })

  it('listProviders(video) 开关关闭时不并入多模态行（能力选择器与默认路由一致）', () => {
    setVideoEnabled(false)
    expect(manager.listProviders('video').some(p => p.id === 'minimax-multimodal')).toBe(false)
  })

  it('listProviders(video) 开关开启时并入多模态行', () => {
    setVideoEnabled(true)
    expect(manager.listProviders('video').some(p => p.id === 'minimax-multimodal')).toBe(true)
  })

  it('关闭 video 不影响 llm/image/tts 多模态路由', () => {
    setVideoEnabled(false)
    // 确保 llm/image/tts 也在 capability_defaults 中
    const row = db.prepare("SELECT config FROM model_providers WHERE id = 'minimax-multimodal'").get()
    const config = JSON.parse(row.config)
    config.capability_defaults = ['llm', 'tts', 'image']
    db.prepare("UPDATE model_providers SET config = ? WHERE id = 'minimax-multimodal'").run(JSON.stringify(config))
    expect(manager.getDefault('llm').id).toBe('minimax-multimodal')
    expect(manager.getDefault('image').id).toBe('minimax-multimodal')
    expect(manager.getDefault('tts').id).toBe('minimax-multimodal')
  })

  it('_syncPresetCapabilities 不回填/覆盖 capability_enabled 开关', () => {
    setVideoEnabled(true)
    manager._syncPresetCapabilities()
    const row = db.prepare("SELECT config FROM model_providers WHERE id = 'minimax-multimodal'").get()
    const config = JSON.parse(row.config)
    expect(config.capability_enabled.video).toBe(true)
  })
})



describe('MinimaxMultimodalAdapter', () => {
  it('能力包含 llm/tts/image/video 方法与基础方法', () => {
    const { MinimaxMultimodalAdapter } = require('./adapters/minimax-multimodal')
    const adapter = new MinimaxMultimodalAdapter({ apiKey: 'k', baseUrl: 'https://api.minimaxi.com/v1' })
    const caps = adapter.capabilities()
    expect(caps).toContain('chatCompletion')
    expect(caps).toContain('synthesize')
    expect(caps).toContain('listVoices')
    expect(caps).toContain('generateImage')
    expect(caps).toContain('generateVideo')
    expect(caps).toContain('getVideoStatus')
    expect(caps).toContain('testConnection')
    expect(adapter.validateConfig().valid).toBe(true)
    expect(adapter.supports('chatCompletion')).toBe(true)
  })

  it('缺少 API Key 时校验失败', () => {
    const { MinimaxMultimodalAdapter } = require('./adapters/minimax-multimodal')
    const adapter = new MinimaxMultimodalAdapter({ baseUrl: 'https://api.minimaxi.com/v1' })
    expect(adapter.validateConfig().valid).toBe(false)
  })

  it('方法委托到内部 MiniMax TTS/Image/Video 适配器', async () => {
    const { MinimaxMultimodalAdapter } = require('./adapters/minimax-multimodal')
    const adapter = new MinimaxMultimodalAdapter({ apiKey: 'k', baseUrl: 'https://api.minimaxi.com/v1' })
    const ttsSpy = vi.spyOn(adapter._tts, 'synthesize').mockResolvedValue({ audio: Buffer.from('00', 'hex'), format: 'mp3' })
    const imageSpy = vi.spyOn(adapter._image, 'generateImage').mockResolvedValue({})
    const videoSpy = vi.spyOn(adapter._video, 'generateVideo').mockResolvedValue({})
    const voiceSpy = vi.spyOn(adapter._tts, 'listVoices').mockResolvedValue([])
    const llmSpy = vi.spyOn(adapter._llm, 'chatCompletion').mockResolvedValue({ content: 'ok' })

    await adapter.synthesize({ text: 'hi' })
    await adapter.generateImage({ prompt: 'x' })
    await adapter.generateVideo({ prompt: 'y' })
    await adapter.listVoices()
    await adapter.chatCompletion({ model: 'MiniMax-M2.7', messages: [{ role: 'user', content: 'hi' }] })

    expect(ttsSpy).toHaveBeenCalledWith({ text: 'hi' })
    expect(imageSpy).toHaveBeenCalledWith({ prompt: 'x' })
    expect(videoSpy).toHaveBeenCalledWith({ prompt: 'y' })
    expect(voiceSpy).toHaveBeenCalledTimes(1)
    expect(llmSpy).toHaveBeenCalledWith({ model: 'MiniMax-M2.7', messages: [{ role: 'user', content: 'hi' }] })
  })
})

describe('ai-generator 多模态能力模型选择', () => {
  it('generateWithDefault 使用 provider.capability_models[type] 作为模型', async () => {
    const { AIGenerator } = require('./ai-generator')
    const callAdapter = vi.fn(async () => ({ code: 0, data: { audio: Buffer.from('00', 'hex') } }))
    const manager = {
      _ready: true,
      getDefault: () => ({
        id: 'minimax-multimodal', enabled: true, is_configured: true,
        models: ['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3'],
        capability_models: { tts: 'speech-2.8-turbo', image: 'image-01' },
      }),
      getProviderWithKey: (id) => ({ id, api_key: 'k' }),
      callAdapter,
      adapterRegistry: new Map([['minimax-multimodal', () => ({})]]),
    }
    const ai = new AIGenerator()
    ai.setModelProviderManager(manager)
    await ai.generateWithDefault('tts', { text: 'hi' })
    expect(callAdapter).toHaveBeenCalledWith('minimax-multimodal', 'synthesize', expect.objectContaining({ model: 'speech-2.8-turbo' }))
  })

  it('generateWithDefault(llm) 使用多模态 capability_models.llm 并走 chatCompletion', async () => {
    const { AIGenerator } = require('./ai-generator')
    const callAdapter = vi.fn(async () => ({ code: 0, data: { content: 'ok' } }))
    const manager = {
      _ready: true,
      getDefault: () => ({
        id: 'minimax-multimodal', enabled: true, is_configured: true,
        models: ['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3', 'MiniMax-M2.7'],
        capability_models: { llm: 'MiniMax-M2.7', tts: 'speech-2.8-turbo', image: 'image-01', video: 'MiniMax-Hailuo-2.3' },
      }),
      getProviderWithKey: (id) => ({ id, api_key: 'k' }),
      callAdapter,
      adapterRegistry: new Map([['minimax-multimodal', () => ({})]]),
    }
    const ai = new AIGenerator()
    ai.setModelProviderManager(manager)
    const result = await ai.generateWithDefault('llm', { messages: [{ role: 'user', content: 'hi' }] })
    expect(callAdapter).toHaveBeenCalledWith('minimax-multimodal', 'chatCompletion', expect.objectContaining({ model: 'MiniMax-M2.7' }))
    expect(result.content).toBe('ok')
  })

  it('普通 provider（无 capability_models）回退首个模型', async () => {
    const { AIGenerator } = require('./ai-generator')
    const callAdapter = vi.fn(async () => ({ code: 0, data: { content: 'ok' } }))
    const manager = {
      _ready: true,
      getDefault: () => ({ id: 'openai', enabled: true, is_configured: true, models: ['gpt-4o'] }),
      getProviderWithKey: (id) => ({ id, api_key: 'k' }),
      callAdapter,
      adapterRegistry: new Map([['openai', () => ({})]]),
    }
    const ai = new AIGenerator()
    ai.setModelProviderManager(manager)
    await ai.generateWithDefault('llm', { messages: [] })
    expect(callAdapter).toHaveBeenCalledWith('openai', 'chatCompletion', expect.objectContaining({ model: 'gpt-4o' }))
  })
})
