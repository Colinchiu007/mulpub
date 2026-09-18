// @ts-check
/**
 * mimo-tts.test.js — TDD: 小米 MiMo TTS Adapter 测试
 *
 * MiMo TTS API 关键特性：
 * - 认证头 api-key: $MIMO_API_KEY（非标准 Bearer，自定义 api-key header）
 * - synthesize: POST /chat/completions（OpenAI Chat 兼容格式）
 * - 请求体 { model, messages: [{role:'assistant', content: text}], audio: { voice, format }, stream: false }
 * - 响应中 choices[0].message.audio.data 为 base64 编码音频
 * - listModels: 静态返回 3 个模型
 * - testConnection: 验证 apiKey 存在
 * - 不支持 LLM/Image/Video 方法
 *
 * 使用 fetch mock，不发起真实 HTTP 请求
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

__registerMock('../logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn() })

const { MimoTtsAdapter, MIMO_TTS_MODELS } = require('./mimo-tts')
const { ProviderError, ERROR_CODES } = require('./_base/provider-error')
const { ADAPTER_VERSION } = require('./_base/base')

// ─── fetch mock 工具 ───
function createFetchResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    async json() { return body },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
    async arrayBuffer() { return new ArrayBuffer(8) },
    body: null,
  }
}

function createFetchMock(responses = []) {
  const calls = []
  const mock = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    const resp = responses.shift() || createFetchResponse({})
    return resp
  })
  mock.calls = calls
  return mock
}

describe('MimoTtsAdapter — 小米 MiMo TTS Adapter', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('构造与配置', () => {
    it('接受 credentials + options 分离参数', () => {
      const adapter = new MimoTtsAdapter({
        id: 'mimo-tts',
        apiKey: 'mimo-test-key',
        baseUrl: 'https://api.xiaomimimo.com/v1',
      }, {
        timeout: 30000,
        maxRetries: 2,
      })
      expect(adapter.id).toBe('mimo-tts')
      expect(adapter.credentials.apiKey).toBe('mimo-test-key')
      expect(adapter.credentials.baseUrl).toBe('https://api.xiaomimimo.com/v1')
      expect(adapter.options.timeout).toBe(30000)
    })

    it('默认 baseUrl 为 MiMo 官方端点', () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      expect(adapter.credentials.baseUrl).toBe('https://api.xiaomimimo.com/v1')
    })

    it('版本号匹配 ADAPTER_VERSION', () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      expect(adapter.version).toBe(ADAPTER_VERSION)
    })
  })

  describe('validateConfig', () => {
    it('有 apiKey 时返回 valid', () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      const result = adapter.validateConfig()
      expect(result.valid).toBe(true)
    })

    it('无 apiKey 时返回 invalid + errors', () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: '' })
      const result = adapter.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('apiKey is required')
    })
  })

  describe('能力协商', () => {
    it('支持 TTS 方法 synthesize', () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      expect(adapter.supports('synthesize')).toBe(true)
    })

    it('支持 listModels 和 testConnection', () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      expect(adapter.supports('listModels')).toBe(true)
      expect(adapter.supports('testConnection')).toBe(true)
    })

    it('不支持 LLM/Image/Video 方法', () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      expect(adapter.supports('chatCompletion')).toBe(false)
      expect(adapter.supports('generateImage')).toBe(false)
      expect(adapter.supports('generateVideo')).toBe(false)
    })

    it('capabilities() 返回 synthesize/listModels/testConnection', () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      const caps = adapter.capabilities()
      expect(caps).toContain('synthesize')
      expect(caps).toContain('listModels')
      expect(caps).toContain('testConnection')
      expect(caps).not.toContain('chatCompletion')
      expect(caps).not.toContain('generateImage')
    })
  })

  describe('认证头（关键差异：api-key header）', () => {
    it('请求头使用 api-key 而非 Authorization Bearer', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({
          choices: [{ message: { audio: { data: 'base64-audio-data' } } }],
        }),
      ])
      global.fetch = fetchMock

      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.synthesize({ text: 'Hello' })

      const headers = fetchMock.calls[0].opts.headers
      expect(headers['api-key']).toBe('mimo-test')
      expect(headers['Authorization']).toBeUndefined()
    })
  })

  describe('synthesize', () => {
    it('POST /chat/completions 返回 base64 音频', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({
          choices: [{ message: { audio: { data: 'SGVsbG8=' } } }],
        }),
      ])
      global.fetch = fetchMock

      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      const result = await adapter.synthesize({
        text: 'Hello world',
        voice: 'male',
      })

      expect(result.audio).toBe('SGVsbG8=')
      expect(result.format).toBe('wav')

      // 验证 URL 包含 /chat/completions
      expect(fetchMock.calls[0].url).toContain('/chat/completions')
    })

    it('text 参数映射到 messages[0].content', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({
          choices: [{ message: { audio: { data: 'x' } } }],
        }),
      ])
      global.fetch = fetchMock

      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.synthesize({ text: '你好世界' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.messages).toHaveLength(1)
      expect(body.messages[0].role).toBe('assistant')
      expect(body.messages[0].content).toBe('你好世界')
    })

    it('voice 参数映射到 audio.voice', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({
          choices: [{ message: { audio: { data: 'x' } } }],
        }),
      ])
      global.fetch = fetchMock

      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.synthesize({ text: 'Hi', voice: 'female' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.audio.voice).toBe('female')
    })

    it('未传 voice 时使用 MiMo 官方内置默认音色', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({
          choices: [{ message: { audio: { data: 'x' } } }],
        }),
      ])
      global.fetch = fetchMock

      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.synthesize({ text: 'Hi' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.audio.voice).toBe('mimo_default')
    })

    it('voice 为空字符串时使用 MiMo 官方内置默认音色', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({
          choices: [{ message: { audio: { data: 'x' } } }],
        }),
      ])
      global.fetch = fetchMock

      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.synthesize({ text: 'Hi', voice: '' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.audio.voice).toBe('mimo_default')
    })

    it('outputFormat 映射到 audio.format（默认 wav）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({
          choices: [{ message: { audio: { data: 'x' } } }],
        }),
      ])
      global.fetch = fetchMock

      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.synthesize({ text: 'Hi' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.audio.format).toBe('wav')
      expect(body.stream).toBe(false)
    })

    it('自定义 model 参数', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({
          choices: [{ message: { audio: { data: 'x' } } }],
        }),
      ])
      global.fetch = fetchMock

      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.synthesize({ text: 'Hi', model: 'mimo-v2.5-tts-voiceclone' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.model).toBe('mimo-v2.5-tts-voiceclone')
    })

    it('无 text 参数抛错误', async () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await expect(adapter.synthesize({ voice: 'v1' }))
        .rejects.toThrow(/text.*required/i)
    })

    it('响应缺少 audio data → ProviderError(PROVIDER_ERROR)', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ choices: [{ message: {} }] }),
      ])
      global.fetch = fetchMock

      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      try {
        await adapter.synthesize({ text: 'Hi' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError)
        expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
      }
    })

    it('401 错误 → ProviderError(AUTH_FAILED)', async () => {
      global.fetch = createFetchMock([
        createFetchResponse({ error: { message: 'Invalid API key' } }, 401),
      ])
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-bad' })
      try {
        await adapter.synthesize({ text: 'Hi' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError)
        expect(e.code).toBe(ERROR_CODES.AUTH_FAILED)
      }
    })

    it('网络错误（ECONNREFUSED）→ ProviderError(NETWORK_ERROR)', async () => {
      global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      try {
        await adapter.synthesize({ text: 'Hi' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.NETWORK_ERROR)
      }
    })
  })

  describe('listModels', () => {
    it('返回静态预定义的 MiMo TTS 模型列表', async () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      const models = await adapter.listModels()
      // mimo-v2.5-tts-voicedesign 项目用不到，已从代码中移除（2026-09-18）
      expect(models).toHaveLength(2)
      const ids = models.map(m => m.id)
      expect(ids).toContain('mimo-v2.5-tts')
      expect(ids).toContain('mimo-v2.5-tts-voiceclone')
      expect(ids).not.toContain('mimo-v2.5-tts-voicedesign')
    })

    it('不发起 HTTP 请求（静态列表）', async () => {
      const fetchMock = createFetchMock([])
      global.fetch = fetchMock
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.listModels()
      expect(fetchMock.calls).toHaveLength(0)
    })

    it('返回的列表是副本，修改不影响下次返回', async () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      const list1 = await adapter.listModels()
      list1.push({ id: 'injected', name: 'malicious' })

      const list2 = await adapter.listModels()
      expect(list2).toHaveLength(2)
      expect(list2.map(m => m.id)).not.toContain('injected')
    })
  })

  describe('testConnection', () => {
    it('apiKey 存在时返回 { success: true }', async () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      const result = await adapter.testConnection()
      expect(result.success).toBe(true)
    })

    it('apiKey 缺失时返回 { success: false, error }', async () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: '' })
      const result = await adapter.testConnection()
      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(ProviderError)
      expect(result.error.code).toBe(ERROR_CODES.INVALID_CONFIG)
    })
  })

  describe('listVoices — MiMo 预置音色', () => {
    it('返回 9 个官方预置音色', async () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      const voices = await adapter.listVoices()
      expect(voices).toHaveLength(9)
      const ids = voices.map(v => v.id)
      expect(ids).toContain('mimo_default')
      expect(ids).toContain('冰糖')
      expect(ids).toContain('茉莉')
      expect(ids).toContain('苏打')
      expect(ids).toContain('白桦')
      expect(ids).toContain('Mia')
      expect(ids).toContain('Chloe')
      expect(ids).toContain('Milo')
      expect(ids).toContain('Dean')
    })

    it('不发起 HTTP 请求（静态列表）', async () => {
      const fetchMock = createFetchMock([])
      global.fetch = fetchMock
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.listVoices()
      expect(fetchMock.calls).toHaveLength(0)
    })
  })

  describe('cloneVoice — MiMo 本地克隆音色', () => {
    it('返回本地 voice_id（mimo-clone- 前缀），不调用远端', async () => {
      const fetchMock = createFetchMock([])
      global.fetch = fetchMock
      const adapter = new MimoTtsAdapter({
        id: 'mimo-tts',
        apiKey: 'mimo-test',
      }, {
        randomUUID: () => 'test-uuid-1234',
      })
      const result = await adapter.cloneVoice({
        name: '我的克隆音色',
        samples: [{ blob: new Blob(['audio-data'], { type: 'audio/mpeg' }), fileName: 'sample.mp3', contentType: 'audio/mpeg' }],
      })
      expect(result.id).toBe('mimo-clone-test-uuid-1234')
      expect(result.name).toBe('我的克隆音色')
      expect(fetchMock.calls).toHaveLength(0)
    })

    it('无样本时抛 INVALID_CONFIG', async () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await expect(adapter.cloneVoice({ name: 'x' }))
        .rejects.toThrow(/样本/)
    })

    it('非 mp3/wav 格式抛 INVALID_CONFIG', async () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await expect(adapter.cloneVoice({
        name: 'x',
        samples: [{ blob: new Blob(['x'], { type: 'audio/ogg' }), fileName: 's.ogg', contentType: 'audio/ogg' }],
      })).rejects.toThrow('mp3/wav')
    })
  })

  describe('synthesize — 克隆音色自动切模型 + 注入样本', () => {
    it('克隆音色（mimo-clone- 前缀）自动用 voiceclone 模型并注入 cloneSampleData', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ choices: [{ message: { audio: { data: 'base64-audio' } } }] }),
      ])
      global.fetch = fetchMock
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.synthesize({
        text: 'Hello',
        voice: 'mimo-clone-abc',
        cloneSampleData: 'data:audio/mpeg;base64,U29tZUF1ZGlv',
      })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.model).toBe('mimo-v2.5-tts-voiceclone')
      expect(body.audio.voice).toBe('data:audio/mpeg;base64,U29tZUF1ZGlv')
    })

    it('克隆音色缺 cloneSampleData 抛 INVALID_CONFIG', async () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await expect(adapter.synthesize({ text: 'Hi', voice: 'mimo-clone-abc' }))
        .rejects.toThrow(/cloneSampleData/)
    })

    it('预置音色用 mimo-v2.5-tts 模型，voice 原样透传', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ choices: [{ message: { audio: { data: 'x' } } }] }),
      ])
      global.fetch = fetchMock
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      await adapter.synthesize({ text: 'Hi', voice: '冰糖' })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.model).toBe('mimo-v2.5-tts')
      expect(body.audio.voice).toBe('冰糖')
    })
  })

  describe('能力协商 — 新增 listVoices/cloneVoice', () => {
    it('supports listVoices 和 cloneVoice', () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      expect(adapter.supports('listVoices')).toBe(true)
      expect(adapter.supports('cloneVoice')).toBe(true)
      expect(adapter.supports('deleteVoice')).toBe(false)
    })

    it('capabilities() 包含 synthesize/listVoices/cloneVoice', () => {
      const adapter = new MimoTtsAdapter({ id: 'mimo-tts', apiKey: 'mimo-test' })
      const caps = adapter.capabilities()
      expect(caps).toContain('synthesize')
      expect(caps).toContain('listVoices')
      expect(caps).toContain('cloneVoice')
      expect(caps).not.toContain('deleteVoice')
    })
  })
})
