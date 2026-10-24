const adapterRegistry = require('./adapters/_base/registry-singleton')

// @vitest-environment node
'use strict'

const { ModelProviderManager, canUseWithoutApiKey } = require('./model-provider-manager')

function createManager(provider) {
  const manager = new ModelProviderManager(null)
  manager._ready = true
  manager.getProviderWithKey = vi.fn(() => provider)
  manager._writeLog = vi.fn()
  if (adapterRegistry.hasFactory(provider.id)) { adapterRegistry.removeFactory(provider.id) } adapterRegistry.registerFactory(provider.id, () => ({}))
  manager._getOrCreateAdapter = vi.fn(() => ({
    supports: () => true,
    synthesize: vi.fn(async () => ({ audio: Buffer.from('audio'), format: 'wav' })),
    chatCompletion: vi.fn(async () => ({ content: '本地端点回复' })),
    transcribe: vi.fn(async () => ({ text: '本地转写结果' })),
  }))
  return manager
}

describe('ModelProviderManager local no-key adapters', () => {
  it('allows a loopback Piper provider without an API key', async () => {
    const manager = createManager({
      id: 'piper',
      name: 'Piper',
      category: 'tts',
      base_url: 'http://127.0.0.1:5000',
      api_key: '',
    })

    await expect(manager.callAdapter('piper', 'synthesize', { text: '本地语音' }))
      .resolves.toMatchObject({ code: 0, data: { format: 'wav' } })
    expect(manager._getOrCreateAdapter).toHaveBeenCalledTimes(1)
  })

  it('still rejects a no-key local adapter when its endpoint is remote', async () => {
    const manager = createManager({
      id: 'piper',
      name: 'Piper',
      category: 'tts',
      base_url: 'https://example.invalid',
      api_key: '',
    })

    await expect(manager.callAdapter('piper', 'synthesize', { text: '不应发出远程请求' }))
      .resolves.toMatchObject({ code: -1, message: expect.stringMatching(/API Key/i) })
    expect(manager._getOrCreateAdapter).not.toHaveBeenCalled()
  })
  it.each([
    ['piper', 'tts'],
    ['local-diffusion', 'image'],
    ['comfyui', 'image'],
  ])('returns an enabled loopback %s provider as the default without an API key', (id, category) => {
    const provider = {
      id,
      name: id,
      category,
      base_url: 'http://127.0.0.1:5000',
      api_key_enc: null,
      api_key: '',
      models: '[]',
      config: '{}',
      enabled: 1,
      is_default: 1,
      is_preset: 1,
    }
    const manager = new ModelProviderManager({
      db: {
        prepare: vi.fn(() => ({ all: vi.fn(() => [provider]) })),
      },
    })
    manager._ready = true

    expect(manager.getDefault(category)).toMatchObject({
      id,
      is_configured: true,
      api_key_masked: '',
    })
  })
})

// 2026-10-23 实测补：免 Key 判据从「硬编码服务商 id 白名单」改为「base_url 在回环地址上」。
// 起因：内置的「Ollama (本地)」预置（ollama.js 头注写明 apiKey 可空、默认 baseUrl
// http://localhost:11434）因为不在白名单里被要求必须填 Key；在 safeStorage 不可用的
// 环境（Linux 无头/容器）里连假 Key 都存不进去（CRYPTO_UNAVAILABLE），
// 「配置模型 → 跑流水线」整条链直接不可用。
describe('ModelProviderManager 回环免 Key 判据（属性判定）', () => {
  it('ollama（本地 OpenAI 兼容端点）无 Key 且指向回环时可直接调用', async () => {
    const manager = createManager({
      id: 'ollama',
      name: 'Ollama (本地)',
      category: 'llm',
      base_url: 'http://127.0.0.1:8787/v1',
      api_key: '',
    })

    await expect(manager.callAdapter('ollama', 'chatCompletion', { messages: [] }))
      .resolves.toMatchObject({ code: 0 })
    expect(manager._getOrCreateAdapter).toHaveBeenCalledTimes(1)
  })

  it('local-whisper（本地语音识别）同样免 Key', async () => {
    const manager = createManager({
      id: 'local-whisper',
      name: '本地 Whisper',
      category: 'speech_recognition',
      base_url: 'http://localhost:8080',
      api_key: '',
    })

    await expect(manager.callAdapter('local-whisper', 'transcribe', { audio: Buffer.from('a') }))
      .resolves.toMatchObject({ code: 0 })
  })

  it('远端端点的本地预置仍必须配 Key（无 Key 配置不得变成远程请求通道）', async () => {
    const manager = createManager({
      id: 'ollama',
      name: 'Ollama (本地)',
      category: 'llm',
      base_url: 'https://example.invalid/v1',
      api_key: '',
    })

    await expect(manager.callAdapter('ollama', 'chatCompletion', { messages: [] }))
      .resolves.toMatchObject({ code: -1, message: expect.stringMatching(/API Key/i) })
    expect(manager._getOrCreateAdapter).not.toHaveBeenCalled()
  })

  it('空 base_url 不等于「本地」：它表示「用适配器默认地址」，而那可能是远端（如 heygen）', () => {
    // 2026-10-23 CI 实测：最初把空地址也当回环，导致「HeyGen 已配但无 API Key → 拦截」
    // 这条既有回归锁被打破（HeyGen 的默认地址是 https://api.heygen.com/v2，是远端）。
    expect(canUseWithoutApiKey({ id: 'heygen', base_url: '' })).toBe(false)
    expect(canUseWithoutApiKey({ id: 'heygen' })).toBe(false)
    expect(canUseWithoutApiKey({ id: 'heygen', base_url: undefined })).toBe(false)
    // 而三个本地预置的 base_url 允许留空（适配器默认地址在回环）⇒ 仍然免 Key
    expect(canUseWithoutApiKey({ id: 'local-diffusion', base_url: '' })).toBe(true)
    expect(canUseWithoutApiKey({ id: 'piper', base_url: '' })).toBe(true)
    expect(canUseWithoutApiKey({ id: 'comfyui', base_url: '' })).toBe(true)
  })

  it('远端服务商的 base_url 非回环时，免 Key 判定一律为否', () => {
    expect(canUseWithoutApiKey({ id: 'openai', base_url: 'https://api.openai.com/v1' })).toBe(false)
    expect(canUseWithoutApiKey({ id: 'openai', base_url: 'http://10.0.0.5:8080/v1' })).toBe(false)
    // 回环（含 ::1 / 空值=适配器自带本地默认）⇒ 免 Key
    expect(canUseWithoutApiKey({ id: 'openai', base_url: 'http://127.0.0.1:8787/v1' })).toBe(true)
    expect(canUseWithoutApiKey({ id: 'openai', base_url: 'http://[::1]:8787/v1' })).toBe(true)
    expect(canUseWithoutApiKey({ id: 'local-diffusion', base_url: '' })).toBe(true)
    expect(canUseWithoutApiKey(null)).toBe(false)
  })
})
