import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TtsVoiceService, classifyCatalogFailure, redactFailureDetail } from './tts-voice-service'

const CACHE_KEY = 'tts-voice-catalog:v2:openai-tts:tts-1'
const GPT4O_MINI_TTS_CACHE_KEY = 'tts-voice-catalog:v2:openai-tts:gpt-4o-mini-tts'
const LEGACY_GPT4O_MINI_TTS_CACHE_KEY = 'tts-voice-catalog:v1:openai-tts:gpt-4o-mini-tts'
const PREFERENCE_KEY = 'tts-voice-preference:v1:openai-tts:tts-1'

function createUserStore(initialValues = {}, ownerSubject = 'user-a') {
  const values = new Map(Object.entries(initialValues))
  return {
    getUserSetting: vi.fn((key, defaultValue) => values.has(key) ? values.get(key) : defaultValue),
    setUserSetting: vi.fn((key, value) => values.set(key, value)),
    getOwnerSubject: vi.fn(() => ownerSubject),
    values,
  }
}

function createManager(result = { code: 0, data: ['alloy', 'nova'] }) {
  return {
    getProvider: vi.fn(() => ({
      id: 'openai-tts',
      category: 'tts',
      models: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15'],
    })),
    callAdapter: vi.fn(async (...args) => typeof result === 'function' ? result(...args) : result),
  }
}

describe('TtsVoiceService', () => {
  let now
  let store
  let manager
  let service

  beforeEach(() => {
    now = 1_700_000_000_000
    store = createUserStore()
    manager = createManager()
    service = new TtsVoiceService({
      store,
      modelProviderManager: manager,
      now: () => now,
      cacheTtlMs: 60_000,
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    })
  })

  it('通过当前用户的 settings 缓存已注册 adapter 的 listVoices 结果', async () => {
    const first = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })
    const second = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(manager.callAdapter).toHaveBeenCalledTimes(1)
    expect(manager.callAdapter).toHaveBeenCalledWith('openai-tts', 'listVoices', { model: 'tts-1' })
    expect(first).toMatchObject({ code: 0, data: { cache: 'refreshed', selectedVoiceId: 'alloy' } })
    expect(second).toMatchObject({ code: 0, data: { cache: 'hit', selectedVoiceId: 'alloy' } })
    expect(store.setUserSetting).toHaveBeenCalledWith(CACHE_KEY, expect.objectContaining({
      providerId: 'openai-tts',
      model: 'tts-1',
      voices: [
        { id: 'alloy', name: 'alloy', source: 'builtin' },
        { id: 'nova', name: 'nova', source: 'builtin' },
      ],
    }), 'user-a')
    expect(store.getUserSetting.mock.calls.map(([key]) => key)).toContain(CACHE_KEY)
  })

  it('仅在显式刷新或缓存失效时再次调用 adapter', async () => {
    await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })
    await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1', refresh: true })
    now += 60_001
    await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(manager.callAdapter).toHaveBeenCalledTimes(3)
  })

  it('按模型向 adapter 传递最小安全参数，并隔离不同模型的目录缓存', async () => {
    manager = createManager((providerId, method, params) => {
      expect(providerId).toBe('openai-tts')
      expect(method).toBe('listVoices')
      if (params.model === 'tts-1') {
        return { code: 0, data: ['alloy', 'ash', 'coral'] }
      }
      if (params.model === 'gpt-4o-mini-tts') {
        return { code: 0, data: ['alloy', 'coral', 'ballad', 'verse', 'marin', 'cedar'] }
      }
      return { code: -1, message: 'unexpected model' }
    })
    service = new TtsVoiceService({
      store,
      modelProviderManager: manager,
      now: () => now,
      cacheTtlMs: 60_000,
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    })

    const legacy = await service.getCatalog({
      providerId: 'openai-tts',
      model: 'tts-1',
      rendererOnly: 'must-not-reach-adapter',
    })
    const gpt4oMini = await service.getCatalog({
      providerId: 'openai-tts',
      model: 'gpt-4o-mini-tts',
    })
    const legacyCacheHit = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })
    const gpt4oMiniCacheHit = await service.getCatalog({ providerId: 'openai-tts', model: 'gpt-4o-mini-tts' })

    expect(manager.callAdapter).toHaveBeenCalledTimes(2)
    expect(manager.callAdapter).toHaveBeenNthCalledWith(1, 'openai-tts', 'listVoices', { model: 'tts-1' })
    expect(manager.callAdapter).toHaveBeenNthCalledWith(2, 'openai-tts', 'listVoices', { model: 'gpt-4o-mini-tts' })
    expect(legacy).toMatchObject({
      code: 0,
      data: { cache: 'refreshed', voices: [{ id: 'alloy' }, { id: 'ash' }, { id: 'coral' }] },
    })
    expect(gpt4oMini).toMatchObject({
      code: 0,
      data: { cache: 'refreshed', voices: [{ id: 'alloy' }, { id: 'coral' }, { id: 'ballad' }, { id: 'verse' }, { id: 'marin' }, { id: 'cedar' }] },
    })
    expect(legacy.data.voices.map((voice) => voice.id)).not.toContain('ballad')
    expect(gpt4oMini.data.voices.map((voice) => voice.id)).toContain('ballad')
    expect(legacyCacheHit).toMatchObject({ code: 0, data: { cache: 'hit' } })
    expect(gpt4oMiniCacheHit).toMatchObject({ code: 0, data: { cache: 'hit' } })
    expect(store.values.get(CACHE_KEY)).toMatchObject({ model: 'tts-1' })
    expect(store.values.get(GPT4O_MINI_TTS_CACHE_KEY)).toMatchObject({ model: 'gpt-4o-mini-tts' })
  })

  it('忽略旧的模型无关 v1 目录缓存，并以 v2 目录刷新当前模型', async () => {
    store.values.set(LEGACY_GPT4O_MINI_TTS_CACHE_KEY, {
      version: 1,
      providerId: 'openai-tts',
      model: 'gpt-4o-mini-tts',
      voices: [{ id: 'alloy', name: 'alloy', source: 'builtin' }],
      refreshedAt: now,
      expiresAt: now + 60_000,
    })
    manager.callAdapter.mockResolvedValueOnce({ code: 0, data: ['alloy', 'ballad'] })

    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'gpt-4o-mini-tts' })

    expect(manager.callAdapter).toHaveBeenCalledWith(
      'openai-tts',
      'listVoices',
      { model: 'gpt-4o-mini-tts' },
    )
    expect(result).toMatchObject({
      code: 0,
      data: { cache: 'refreshed', voices: [{ id: 'alloy' }, { id: 'ballad' }] },
    })
    expect(store.getUserSetting).not.toHaveBeenCalledWith(LEGACY_GPT4O_MINI_TTS_CACHE_KEY, expect.anything(), 'user-a')
    expect(store.values.get(GPT4O_MINI_TTS_CACHE_KEY)).toMatchObject({ version: 2, model: 'gpt-4o-mini-tts' })
  })

  it('从失效偏好回退到合法默认音色，并修复当前用户的偏好记录', async () => {
    store.values.set(PREFERENCE_KEY, {
      providerId: 'openai-tts',
      model: 'tts-1',
      voiceId: 'removed-voice',
      selectedAt: now - 1,
    })

    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(result).toMatchObject({ code: 0, data: { selectedVoiceId: 'alloy' } })
    expect(store.setUserSetting).toHaveBeenCalledWith(PREFERENCE_KEY, expect.objectContaining({
      providerId: 'openai-tts',
      model: 'tts-1',
      voiceId: 'alloy',
    }), 'user-a')
  })

  it('拒绝跨模型或不在目录内的选择，不覆盖已有合法偏好', async () => {
    await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })
    store.setUserSetting.mockClear()

    const mismatch = await service.selectVoice({
      providerId: 'openai-tts',
      model: 'unknown-model',
      voiceId: 'alloy',
    })
    const unknownVoice = await service.selectVoice({
      providerId: 'openai-tts',
      model: 'tts-1',
      voiceId: 'not-in-catalog',
    })

    expect(mismatch).toMatchObject({ code: -1, message: 'VOICE_MODEL_MISMATCH' })
    expect(unknownVoice).toMatchObject({ code: -1, message: 'VOICE_NOT_IN_CATALOG' })
    expect(store.setUserSetting).not.toHaveBeenCalledWith(
      PREFERENCE_KEY,
      expect.objectContaining({ voiceId: 'not-in-catalog' }),
    )
  })

  it('选择音色后恢复服务商默认，清除偏好且重新读取仍返回默认音色', async () => {
    await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })
    await service.selectVoice({ providerId: 'openai-tts', model: 'tts-1', voiceId: 'nova' })
    expect(store.values.get(PREFERENCE_KEY)).toMatchObject({ voiceId: 'nova' })
    const cleared = await service.clearVoicePreference({ providerId: 'openai-tts', model: 'tts-1' })
    expect(cleared).toMatchObject({ code: 0, data: { selectedVoiceId: 'alloy', preference: 'cleared' } })
    expect(store.values.get(PREFERENCE_KEY)).toBeNull()
    const reread = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })
    expect(reread).toMatchObject({ code: 0, data: { selectedVoiceId: 'alloy' } })
    expect(store.values.get(PREFERENCE_KEY)).toBeNull()
  })

  it('对不支持或未配置的 provider fail closed，且不写入 cache 或偏好', async () => {
    // MiMo TTS 现已支持音色列表（BUILTIN，9 个预置音色）；改用不在白名单的模型验证 fail closed
    const unsupported = await service.getCatalog({ providerId: 'mimo-tts', model: 'mimo-v2.5-tts-voicedesign' })
    manager.callAdapter.mockResolvedValueOnce({ code: -1, message: 'Bearer token leaked by upstream' })
    const unavailable = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(unsupported).toMatchObject({ code: -1, message: 'VOICE_MODEL_MISMATCH' })
    expect(unavailable).toMatchObject({ code: -1, message: 'VOICE_CATALOG_UNAVAILABLE' })
    expect(manager.callAdapter).toHaveBeenCalledTimes(1)
    expect(store.setUserSetting).not.toHaveBeenCalled()
  })

  it('配置类失败（未配置 API Key）返回 VOICE_CATALOG_CONFIG_UNAVAILABLE 且不写缓存', async () => {
    manager.callAdapter.mockResolvedValueOnce({
      code: -1,
      message: '尚未配置 API Key，请先在“模型设置”中填写 OpenAI TTS 的 API Key 后重试（API Key not configured）',
    })
    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(result).toMatchObject({ code: -1, message: 'VOICE_CATALOG_CONFIG_UNAVAILABLE' })
    expect(result.data.detail).toContain('API Key')
    expect(store.setUserSetting).not.toHaveBeenCalled()
  })

  it('瞬时失败（网络/超时）仍返回 VOICE_CATALOG_UNAVAILABLE 且不写缓存', async () => {
    manager.callAdapter.mockResolvedValueOnce({ code: -1, message: 'upstream 503 gateway timeout' })
    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(result).toMatchObject({ code: -1, message: 'VOICE_CATALOG_UNAVAILABLE' })
    expect(result.data.detail).toContain('503')
    expect(store.setUserSetting).not.toHaveBeenCalled()
  })

  it('认证失败（401/unauthorized/invalid api key）归配置类错误', async () => {
    manager.callAdapter.mockResolvedValueOnce({ code: -1, message: 'HTTP 401 Unauthorized: invalid api key' })
    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(result).toMatchObject({ code: -1, message: 'VOICE_CATALOG_CONFIG_UNAVAILABLE' })
    expect(store.setUserSetting).not.toHaveBeenCalled()
  })

  it('adapter 方法不支持归 VOICE_CATALOG_UNSUPPORTED（指引「暂不支持」而非「配置 Key」）', async () => {
    manager.callAdapter.mockResolvedValueOnce({
      code: -1,
      message: '服务商 openai-tts 不支持该操作，请检查模型配置后重试（Method "listVoices" not supported by adapter "openai-tts"）',
    })
    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(result).toMatchObject({ code: -1, message: 'VOICE_CATALOG_UNSUPPORTED' })
    expect(store.setUserSetting).not.toHaveBeenCalled()
  })

  it('失败 detail 截断到 200 字符上限', async () => {
    manager.callAdapter.mockResolvedValueOnce({ code: -1, message: 'x'.repeat(500) })
    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })
    expect(result.data.detail.length).toBeLessThanOrEqual(200)
  })

  it('敏感失败 message（Bearer token）不回显原文，仅回显分类短语', async () => {
    manager.callAdapter.mockResolvedValueOnce({ code: -1, message: 'Bearer token leaked by upstream' })
    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(result).toMatchObject({ code: -1, message: 'VOICE_CATALOG_UNAVAILABLE' })
    expect(result.data.detail).not.toContain('Bearer')
    expect(result.data.detail).not.toContain('token')
    expect(result.data.detail).not.toContain('leaked')
  })

  it('分类/脱敏纯函数：undefined message 归瞬时，空 message 详情为空', () => {
    expect(classifyCatalogFailure(undefined)).toBe('transient')
    expect(classifyCatalogFailure('')).toBe('transient')
    expect(classifyCatalogFailure('尚未配置 API Key（API Key not configured）')).toBe('config')
    expect(classifyCatalogFailure('upstream 503')).toBe('transient')
    expect(redactFailureDetail(undefined)).toBe('')
    expect(redactFailureDetail('Bearer abc.def token')).toBe('upstream-auth-error')
  })

  it('adapter 返回无 message 的失败默认归瞬时错误 UNAVAILABLE', async () => {
    manager.callAdapter.mockResolvedValueOnce({ code: -1 })
    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(result).toMatchObject({ code: -1, message: 'VOICE_CATALOG_UNAVAILABLE' })
    expect(result.data.detail).toBe('empty or invalid adapter result')
    expect(store.setUserSetting).not.toHaveBeenCalled()
  })

  it('目录失败路径记录 provider/model 与脱敏原因，不含密钥原文', async () => {
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    service = new TtsVoiceService({
      store,
      modelProviderManager: manager,
      now: () => now,
      cacheTtlMs: 60_000,
      logger,
    })
    manager.callAdapter.mockResolvedValueOnce({ code: -1, message: 'sk-secret-key invalid（API Key not configured）' })
    await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(logger.warn).toHaveBeenCalled()
    const [moduleName, message] = logger.warn.mock.calls[0]
    expect(String(moduleName)).toContain('tts-voice')
    expect(String(message)).toContain('openai-tts')
    expect(String(message)).toContain('tts-1')
    expect(String(message)).not.toContain('sk-secret-key')
  })

  it('拒绝不匹配的缓存和敏感的 adapter 输出，避免把 secret 写入 settings', async () => {
    store.values.set(CACHE_KEY, {
      providerId: 'openai-tts',
      model: 'tts-1-hd',
      refreshedAt: now,
      expiresAt: now + 60_000,
      voices: [{ id: 'wrong-model', name: 'wrong-model', source: 'builtin' }],
    })
    manager.callAdapter.mockResolvedValueOnce({
      code: 0,
      data: [{ id: 'alloy', name: 'alloy', token: 'should-never-persist', audio: 'also-never-persist' }],
    })

    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(manager.callAdapter).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ code: 0, data: { voices: [{ id: 'alloy', name: 'alloy', source: 'builtin' }] } })
    expect(JSON.stringify(store.values.get(CACHE_KEY))).not.toContain('should-never-persist')
    expect(JSON.stringify(store.values.get(CACHE_KEY))).not.toContain('also-never-persist')
  })

  it('在异步刷新开始时固定 owner，避免登录切换时跨用户读写目录和偏好', async () => {
    let resolveAdapter
    manager.callAdapter.mockImplementationOnce(() => new Promise(resolve => { resolveAdapter = resolve }))

    const pending = service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })
    await Promise.resolve()
    store.getOwnerSubject.mockReturnValue('user-b')
    resolveAdapter({ code: 0, data: ['alloy', 'nova'] })

    const result = await pending

    expect(result).toMatchObject({ code: 0, data: { selectedVoiceId: 'alloy' } })
    expect(store.getOwnerSubject).toHaveBeenCalledTimes(1)
    expect(store.getUserSetting.mock.calls.every(([, , owner]) => owner === 'user-a')).toBe(true)
    expect(store.setUserSetting.mock.calls.every(([, , owner]) => owner === 'user-a')).toBe(true)
  })

  it('在身份未解析时 fail closed，不读取缓存、不调用 adapter 或写入偏好', async () => {
    store.getOwnerSubject.mockReturnValue(null)

    const result = await service.getCatalog({ providerId: 'openai-tts', model: 'tts-1' })

    expect(result).toMatchObject({ code: -1, message: 'VOICE_OWNER_UNAVAILABLE' })
    expect(store.getUserSetting).not.toHaveBeenCalled()
    expect(store.setUserSetting).not.toHaveBeenCalled()
    expect(manager.callAdapter).not.toHaveBeenCalled()
  })
})


describe('selectVoice — MiniMax 系统音色 id（含空格/括号）', () => {
  it('接受 Chinese (Mandarin)_Reliable_Executive 并保存偏好（回归 VOICE_CATALOG_INVALID_ARGUMENTS）', async () => {
    const now = 1_700_000_000_000
    const store = createUserStore()
    const manager = {
      getProvider: vi.fn(() => ({ id: 'minimax-tts', category: 'tts', models: ['speech-2.8-turbo'] })),
      callAdapter: vi.fn(async () => ({ code: 0, data: [
        { id: 'male-qn-qingse', name: '青年男声' },
        { id: 'Chinese (Mandarin)_Reliable_Executive', name: '沉稳高管' },
        { id: 'Chinese (Mandarin)_Humorous_Elder', name: '搞笑大爷' },
      ] })),
    }
    const service = new TtsVoiceService({ store, modelProviderManager: manager, now: () => now, cacheTtlMs: 60_000 })

    const catalog = await service.getCatalog({ providerId: 'minimax-tts', model: 'speech-2.8-turbo' })
    expect(catalog.code).toBe(0)
    expect(catalog.data.voices.map((v) => v.id)).toContain('Chinese (Mandarin)_Reliable_Executive')

    const selected = await service.selectVoice({ providerId: 'minimax-tts', model: 'speech-2.8-turbo', voiceId: 'Chinese (Mandarin)_Reliable_Executive' })
    expect(selected.code).toBe(0)
    expect(selected.data.selectedVoiceId).toBe('Chinese (Mandarin)_Reliable_Executive')
    expect(store.setUserSetting).toHaveBeenCalledWith(
      'tts-voice-preference:v1:minimax-tts:speech-2.8-turbo',
      expect.objectContaining({ voiceId: 'Chinese (Mandarin)_Reliable_Executive' }),
      'user-a',
    )
  })

  it('拒绝含路径分隔符/遍历序列的 voiceId', async () => {
    const now = 1_700_000_000_000
    const service = new TtsVoiceService({ store: createUserStore(), modelProviderManager: createManager(), now: () => now, cacheTtlMs: 60_000 })
    const result = await service.selectVoice({ providerId: 'openai-tts', model: 'tts-1', voiceId: '..\\..\\evil' })
    expect(result).toMatchObject({ code: -1, message: 'VOICE_CATALOG_INVALID_ARGUMENTS' })
  })
})

describe('getCatalog — 失效克隆音色（voice_id 不合规）', () => {
  it('非法克隆不进入可选项并回退默认音色；以 invalidVoices 返回供前端提示', async () => {
    const now = 1_700_000_000_000
    const store = createUserStore()
    const manager = {
      getProvider: vi.fn(() => ({ id: 'minimax-tts', category: 'tts', models: ['speech-2.8-turbo'] })),
      callAdapter: vi.fn(async () => ({ code: 0, data: [{ id: 'male-qn-qingse', name: '青涩青年音色' }] })),
    }
    const cloneService = {
      listClones: vi.fn(async () => ({
        code: 0,
        data: {
          voices: [
            { id: '01', name: '01', source: 'user_clone', invalid: true },
            { id: 'MiniMaxVoice_abc123', name: '合法克隆', source: 'user_clone' },
          ],
        },
      })),
    }
    const service = new TtsVoiceService({ store, modelProviderManager: manager, now: () => now, cacheTtlMs: 60_000 })
    service._cloneService = cloneService

    const catalog = await service.getCatalog({ providerId: 'minimax-tts', model: 'speech-2.8-turbo' })
    expect(catalog.code).toBe(0)
    expect(catalog.data.voices.map((v) => v.id)).not.toContain('01')
    expect(catalog.data.voices.map((v) => v.id)).toContain('MiniMaxVoice_abc123')
    expect(catalog.data.invalidVoices.map((v) => v.id)).toEqual(['01'])
    expect(catalog.data.selectedVoiceId).toBe('male-qn-qingse')
  })
})

describe('getCatalog — 多模态模型（minimax-multimodal）承担 TTS 能力', () => {
  it('白名单命中且 provider 声明 tts 能力时返回音色目录', async () => {
    const now = 1_700_000_000_000
    const store = createUserStore()
    const manager = {
      getProvider: vi.fn(() => ({
        id: 'minimax-multimodal',
        category: 'multimodal',
        capabilities: ['llm', 'tts', 'image', 'video'],
        capability_models: { llm: 'MiniMax-M2.7', tts: 'speech-2.8-turbo', image: 'image-01', video: 'MiniMax-Hailuo-2.3' },
        models: ['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3', 'MiniMax-M2.7'],
      })),
      callAdapter: vi.fn(async () => ({ code: 0, data: [
        { id: 'male-qn-qingse', name: '青年男声' },
        { id: 'Chinese (Mandarin)_Reliable_Executive', name: '沉稳高管' },
      ] })),
    }
    const service = new TtsVoiceService({ store, modelProviderManager: manager, now: () => now, cacheTtlMs: 60_000 })

    const catalog = await service.getCatalog({ providerId: 'minimax-multimodal', model: 'speech-2.8-turbo' })
    expect(catalog.code).toBe(0)
    expect(catalog.data.providerId).toBe('minimax-multimodal')
    expect(catalog.data.voices.map((v) => v.id)).toContain('Chinese (Mandarin)_Reliable_Executive')
    expect(catalog.data.capability).toMatchObject({
      type: 'user_clone',
      canListVoices: true,
      clone: { enabled: true, entry: 'desktop_upload' },
    })
    expect(manager.callAdapter).toHaveBeenCalledWith('minimax-multimodal', 'listVoices', { model: 'speech-2.8-turbo' })
  })

  it('未声明 tts 能力的多模态模型被拒绝（VOICE_MODEL_MISMATCH），不调用 adapter', async () => {
    const now = 1_700_000_000_000
    const store = createUserStore()
    const manager = {
      getProvider: vi.fn(() => ({
        id: 'minimax-multimodal',
        category: 'multimodal',
        capabilities: ['image'],
        models: ['image-01'],
      })),
      callAdapter: vi.fn(async () => ({ code: 0, data: [] })),
    }
    const service = new TtsVoiceService({ store, modelProviderManager: manager, now: () => now, cacheTtlMs: 60_000 })
    // 白名单命中（provider/model 均为已批准 TTS 组合）后，provider 未声明 tts 能力 → _hasMatchingProvider 拒绝
    const result = await service.getCatalog({ providerId: 'minimax-multimodal', model: 'speech-2.8-turbo' })
    expect(result).toMatchObject({ code: -1, message: 'VOICE_MODEL_MISMATCH' })
    expect(manager.callAdapter).not.toHaveBeenCalled()
  })

  it('capability_models.tts 不在白名单时 fail closed（VOICE_MODEL_MISMATCH），不调用 adapter', async () => {
    const now = 1_700_000_000_000
    const store = createUserStore()
    const manager = {
      getProvider: vi.fn(() => ({
        id: 'minimax-multimodal',
        category: 'multimodal',
        capabilities: ['tts'],
        models: [],
        capability_models: { tts: 'speech-3.0-experimental' },
      })),
      callAdapter: vi.fn(async () => ({ code: 0, data: [] })),
    }
    const service = new TtsVoiceService({ store, modelProviderManager: manager, now: () => now, cacheTtlMs: 60_000 })
    const result = await service.getCatalog({ providerId: 'minimax-multimodal', model: 'speech-3.0-experimental' })
    expect(result).toMatchObject({ code: -1, message: 'VOICE_MODEL_MISMATCH' })
    expect(manager.callAdapter).not.toHaveBeenCalled()
  })

  describe('MiMo TTS catalog（2026-09-18）', () => {
    function createMimoService({ cloneVoices = [] } = {}) {
      const now = 1_700_000_000_000
      const store = createUserStore()
      const manager = {
        getProvider: vi.fn(() => ({
          id: 'mimo-tts',
          category: 'tts',
          models: ['mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone'],
        })),
        callAdapter: vi.fn(async () => ({
          code: 0,
          data: [
            { id: 'mimo_default', name: 'MiMo-默认' },
            { id: '冰糖', name: '冰糖' },
            { id: 'Mia', name: 'Mia' },
          ],
        })),
      }
      const cloneService = {
        listClones: vi.fn(async () => ({
          code: 0,
          data: { voices: cloneVoices },
        })),
      }
      const service = new TtsVoiceService({
        store,
        modelProviderManager: manager,
        cloneService,
        now: () => now,
        cacheTtlMs: 60_000,
      })
      return { store, manager, cloneService, service }
    }

    it('mimo-v2.5-tts catalog 返回预置音色并合并 voiceclone 克隆音色', async () => {
      const { service, cloneService } = createMimoService({
        cloneVoices: [
          { id: 'mimo-clone-abc', name: '音色001', source: 'user_clone' },
        ],
      })
      const result = await service.getCatalog({ providerId: 'mimo-tts', model: 'mimo-v2.5-tts' })
      expect(result.code).toBe(0)
      const voiceIds = result.data.voices.map(v => v.id)
      expect(voiceIds).toContain('mimo_default')
      expect(voiceIds).toContain('冰糖')
      expect(voiceIds).toContain('Mia')
      // 克隆音色从 voiceclone 模型 registry 合并
      expect(voiceIds).toContain('mimo-clone-abc')
      // 克隆列表查询用 voiceclone 模型
      expect(cloneService.listClones).toHaveBeenCalledWith({
        providerId: 'mimo-tts',
        model: 'mimo-v2.5-tts-voiceclone',
      })
      expect(result.data.selectedVoiceId).toBe('mimo_default')
    })

    it('mimo 下选择克隆音色后 catalog 回填克隆偏好（voiceclone 键）', async () => {
      const { store, service } = createMimoService({
        cloneVoices: [
          { id: 'mimo-clone-abc', name: '音色001', source: 'user_clone' },
        ],
      })
      // 先选择克隆音色（写入 voiceclone 偏好键）
      const selectResult = await service.selectVoice({
        providerId: 'mimo-tts',
        model: 'mimo-v2.5-tts-voiceclone',
        voiceId: 'mimo-clone-abc',
      })
      expect(selectResult.code).toBe(0)
      // catalog（tts 模型）应回填 voiceclone 键的克隆偏好
      const catalogResult = await service.getCatalog({ providerId: 'mimo-tts', model: 'mimo-v2.5-tts' })
      expect(catalogResult.code).toBe(0)
      expect(catalogResult.data.selectedVoiceId).toBe('mimo-clone-abc')
    })

    it('mimo 下清除偏好同时清 tts 与 voiceclone 键', async () => {
      const { store, service } = createMimoService()
      const cleared = await service.clearVoicePreference({ providerId: 'mimo-tts', model: 'mimo-v2.5-tts' })
      expect(cleared.code).toBe(0)
      const setCalls = store.setUserSetting.mock.calls
      const clearedKeys = setCalls.filter(([, value]) => value === null).map(([key]) => key)
      expect(clearedKeys).toContain('tts-voice-preference:v1:mimo-tts:mimo-v2.5-tts')
      expect(clearedKeys).toContain('tts-voice-preference:v1:mimo-tts:mimo-v2.5-tts-voiceclone')
    })
  })
})
