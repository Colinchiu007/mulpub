// @ts-check
/**
 * minimax-tts.test.js — TDD: MiniMax TTS Adapter 测试
 *
 * MiniMax TTS API 关键特性：
 * - 认证头 Authorization: Bearer {key}
 * - synthesize: POST /t2a_v2，请求体 { model, text, voice_setting, audio_setting }
 * - 响应中 data.audio 为 hex 编码字符串，需转换为 Buffer
 * - 支持 speed（0.5-2，默认 1.0）和 pitch（默认 0）
 * - 支持 mp3/wav/flac 格式
 * - listModels: 静态返回 4 个模型
 * - testConnection: 验证 apiKey 存在
 *
 * 使用 fetch mock，不发起真实 HTTP 请求
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

__registerMock('../logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() })

const { MinimaxTtsAdapter, MINIMAX_TTS_MODELS } = require('./minimax-tts')
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

// hex 编码的"Hello"测试数据
const HEX_AUDIO = '48656c6c6f'

describe('MinimaxTtsAdapter — MiniMax TTS Adapter', () => {
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
      const adapter = new MinimaxTtsAdapter({
        id: 'minimax-tts',
        apiKey: 'mm-test-key',
        baseUrl: 'https://api.minimaxi.com/v1',
      }, {
        timeout: 30000,
        maxRetries: 2,
      })
      expect(adapter.id).toBe('minimax-tts')
      expect(adapter.credentials.apiKey).toBe('mm-test-key')
      expect(adapter.credentials.baseUrl).toBe('https://api.minimaxi.com/v1')
      expect(adapter.options.timeout).toBe(30000)
    })

    it('默认 baseUrl 为 MiniMax 官方端点', () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      expect(adapter.credentials.baseUrl).toBe('https://api.minimaxi.com/v1')
    })

    it('版本号匹配 ADAPTER_VERSION', () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      expect(adapter.version).toBe(ADAPTER_VERSION)
    })
  })

  describe('validateConfig', () => {
    it('有 apiKey 时返回 valid', () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = adapter.validateConfig()
      expect(result.valid).toBe(true)
    })

    it('无 apiKey 时返回 invalid + errors', () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: '' })
      const result = adapter.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('apiKey is required')
    })
  })

  describe('能力协商', () => {
    it('支持 TTS 方法 synthesize', () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      expect(adapter.supports('synthesize')).toBe(true)
    })

    it('支持 listModels 和 testConnection', () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      expect(adapter.supports('listModels')).toBe(true)
      expect(adapter.supports('testConnection')).toBe(true)
    })

    it('不支持 LLM/Image/Video 方法', () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      expect(adapter.supports('chatCompletion')).toBe(false)
      expect(adapter.supports('generateImage')).toBe(false)
      expect(adapter.supports('generateVideo')).toBe(false)
    })

    it('capabilities() 返回 TTS 相关方法', () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const caps = adapter.capabilities()
      expect(caps).toContain('synthesize')
      expect(caps).toContain('listModels')
      expect(caps).toContain('testConnection')
      expect(caps).not.toContain('chatCompletion')
    })
  })

  describe('认证头（Bearer 模式）', () => {
    it('请求头使用 Authorization Bearer', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { audio: HEX_AUDIO } }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.synthesize({ text: 'Hello', model: 'speech-2.6-hd' })

      const headers = fetchMock.calls[0].opts.headers
      expect(headers['Authorization']).toBe('Bearer mm-test')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('synthesize', () => {
    it('POST /t2a_v2 返回 Buffer 音频（hex 转 Buffer）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { audio: HEX_AUDIO } }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = await adapter.synthesize({
        text: 'Hello world',
        voice: 'male-qn-qingse',
        model: 'speech-2.6-hd',
      })

      expect(result.audio).toBeInstanceOf(Buffer)
      // hex "48656c6c6f" → "Hello"
      expect(result.audio.toString('utf8')).toBe('Hello')
      expect(result.format).toBe('mp3')

      // 验证 URL 包含 /t2a_v2
      expect(fetchMock.calls[0].url).toContain('/t2a_v2')
    })

    it('text 参数映射到 body.text', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { audio: HEX_AUDIO } }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.synthesize({ text: '你好世界', model: 'speech-2.6-hd' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.text).toBe('你好世界')
    })

    it('voice 参数映射到 voice_setting.voice_id', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { audio: HEX_AUDIO } }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.synthesize({ text: 'Hi', voice: 'female-shaonv', model: 'speech-2.6-hd' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.voice_setting.voice_id).toBe('female-shaonv')
    })

    it('speed/pitch 参数映射到 voice_setting', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { audio: HEX_AUDIO } }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.synthesize({ text: 'Hi', speed: 1.5, pitch: 5, model: 'speech-2.6-hd' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.voice_setting.speed).toBe(1.5)
      expect(body.voice_setting.pitch).toBe(5)
    })

    it('默认 speed=1.0，pitch=0', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { audio: HEX_AUDIO } }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.synthesize({ text: 'Hi', model: 'speech-2.6-hd' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.voice_setting.speed).toBe(1.0)
      expect(body.voice_setting.pitch).toBe(0)
    })

    it('outputFormat 映射到 audio_setting.format', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { audio: HEX_AUDIO } }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.synthesize({ text: 'Hi', outputFormat: 'wav', model: 'speech-2.6-hd' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.audio_setting.format).toBe('wav')
      expect(body.audio_setting.sample_rate).toBe(32000)
    })

    it('无 text 参数抛错误', async () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await expect(adapter.synthesize({ voice: 'v1' }))
        .rejects.toThrow(/text.*required/i)
    })

    it('响应缺少 audio data → ProviderError(PROVIDER_ERROR)', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: {} }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      try {
      await adapter.synthesize({ text: 'Hi', model: 'speech-2.6-hd' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError)
        expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
      }
    })

    it('401 错误 → ProviderError(AUTH_FAILED)', async () => {
      global.fetch = createFetchMock([
        createFetchResponse({ base_resp: { status_msg: 'Invalid API key' } }, 401),
      ])
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-bad' })
      try {
      await adapter.synthesize({ text: 'Hi', model: 'speech-2.6-hd' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError)
        expect(e.code).toBe(ERROR_CODES.AUTH_FAILED)
      }
    })

    it('网络错误 → ProviderError(NETWORK_ERROR)', async () => {
      global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      try {
      await adapter.synthesize({ text: 'Hi', model: 'speech-2.6-hd' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.NETWORK_ERROR)
      }
    })

    it('fetch 挂起 → 有界超时 → ProviderError(TIMEOUT)（回归：DEFAULT_TIMEOUT 必须接入 fetch）', async () => {
      global.fetch = vi.fn((url, opts = {}) => new Promise((resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }))
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' }, { timeout: 100 })
      const t0 = Date.now()
      try {
        await adapter.synthesize({ text: '你好', voice: 'male-qn-qingse' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError)
        expect(e.code).toBe(ERROR_CODES.TIMEOUT)
      }
      expect(Date.now() - t0).toBeLessThan(5000)
    })
  })

  describe('listModels', () => {
    it('返回静态预定义的 MiniMax TTS 模型列表（4 个）', async () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const models = await adapter.listModels()
      expect(models).toHaveLength(4)
      const ids = models.map(m => m.id)
      expect(ids).toContain('speech-2.8-hd')
      expect(ids).toContain('speech-2.8-turbo')
      expect(ids).toContain('speech-2.6-hd')
      expect(ids).toContain('speech-2.6-turbo')
    })

    it('不发起 HTTP 请求（静态列表）', async () => {
      const fetchMock = createFetchMock([])
      global.fetch = fetchMock
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.listModels()
      expect(fetchMock.calls).toHaveLength(0)
    })
  })

  describe('testConnection', () => {
    it('apiKey 存在时返回 { success: true }', async () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = await adapter.testConnection()
      expect(result.success).toBe(true)
    })

    it('apiKey 缺失时返回 { success: false, error }', async () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: '' })
      const result = await adapter.testConnection()
      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(ProviderError)
      expect(result.error.code).toBe(ERROR_CODES.INVALID_CONFIG)
    })
  })

  describe('listVoices', () => {
    it('返回官方系统音色列表（含中文常用音色）', async () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const voices = await adapter.listVoices()
      expect(Array.isArray(voices)).toBe(true)
      expect(voices.length).toBeGreaterThan(100)
      const ids = voices.map(v => v.id)
      expect(ids).toContain('male-qn-qingse')
      expect(ids).toContain('female-shaonv')
      expect(ids).toContain('wumei_yujie')
      expect(ids).toContain('English_Gentle-voiced_man')
      expect(voices[0]).toHaveProperty('id')
      expect(voices[0]).toHaveProperty('name')
      // 回归：官方文档提取不得含编码替换符（U+FFFD 乱码）
      // 2026-10-07：原先此处还有一个「字符类里直接写替换符」的正则，与下面
      // includes('\uFFFD') 语义完全等价、纯冗余；且它让本文件成为全仓唯一
      // 「故意含字面 U+FFFD」的文件，只能靠基线豁免。删掉后断言行为不变。
      const corrupted = voices.filter(v => String(v.name).includes('\uFFFD'))
      expect(corrupted).toEqual([])
      expect(voices.find(v => v.id === 'male-qn-daxuesheng-jingpin')?.name).toBe('青年大学生音色-beta')
    })

    it('不发起 HTTP 请求（静态权威列表）', async () => {
      const fetchMock = createFetchMock([])
      global.fetch = fetchMock
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.listVoices()
      expect(fetchMock.calls).toHaveLength(0)
    })
  })

  describe('cloneVoice', () => {
    it('上传样本并调用复刻接口返回 voice_id', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ file: { file_id: 12345 } }),
        createFetchResponse({ voice_id: 'MiniMaxCloneTest' }),
      ])
      global.fetch = fetchMock
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })
      const result = await adapter.cloneVoice({ name: '克隆音色测试', samples: [{ blob, fileName: 'clone.mp3', contentType: 'audio/mpeg' }] })
      expect(result.id).toBe('MiniMaxCloneTest')
      expect(result.name).toBe('克隆音色测试')
      expect(fetchMock.calls).toHaveLength(2)
      // 精确 URL：base_url 默认含 /v1（https://api.minimaxi.com/v1），路径不得重复 /v1
      expect(String(fetchMock.calls[0].url)).toBe('https://api.minimaxi.com/v1/files/upload')
      expect(String(fetchMock.calls[1].url)).toBe('https://api.minimaxi.com/v1/voice_clone')
      // 官方文档：快速复刻接口必须传 model=speech-2.8-hd
      const cloneBody = JSON.parse(fetchMock.calls[1].opts.body)
      expect(cloneBody.model).toBe('speech-2.8-hd')
      // 请求体 voice_id 必须为符合官方约束的合规 id（buildMiniMaxCloneVoiceId 生成：
      // MiniMax 前缀 + 名称清洗 + 随机后缀，长度 [8,256]、末位非 -/_）
      expect(cloneBody.voice_id).toMatch(/^MiniMax[A-Za-z0-9_-]{7,}$/)
      expect(cloneBody.voice_id.length).toBeGreaterThanOrEqual(8)
    })

    it('base_url 含 /v1（真实 preset 配置）时不产生双重 /v1（回归「音色克隆服务不可用」）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ file: { file_id: 12345 } }),
        createFetchResponse({ voice_id: 'MiniMaxClonePreset' }),
      ])
      global.fetch = fetchMock
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test', baseUrl: 'https://api.minimaxi.com/v1' })
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })
      const result = await adapter.cloneVoice({ name: '克隆音色', samples: [{ blob, fileName: 'clone.mp3', contentType: 'audio/mpeg' }] })
      expect(result.id).toBe('MiniMaxClonePreset')
      const urls = fetchMock.calls.map((c) => String(c.url))
      expect(urls).toEqual([
        'https://api.minimaxi.com/v1/files/upload',
        'https://api.minimaxi.com/v1/voice_clone',
      ])
      expect(urls.every((u) => !u.includes('/v1/v1'))).toBe(true)
    })

    it('复刻接口 200 + base_resp 业务错误时 fail closed，不持久化幻影克隆音色（2038 无权限）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ file: { file_id: 12345 } }),
        createFetchResponse({ base_resp: { status_code: 2038, status_msg: 'voice clone user forbidden' } }),
      ])
      global.fetch = fetchMock
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })
      const error = await adapter.cloneVoice({ name: '音色001', samples: [{ blob, fileName: 'clone.mp3', contentType: 'audio/mpeg' }] }).catch((e) => e)
      expect(error).toBeInstanceOf(ProviderError)
      expect(error.context).toMatchObject({ statusCode: 2038 })
      expect(error.message).toContain('voice clone user forbidden')
    })

    // 2026-10-19 事故（项目 mvevl2ya_7sl8 后续）：订阅套餐账号克隆被 MiniMax 拒绝，
    // 服务端原文 "your current token plan not support model, voice_clone"。
    // 必须归类为 PLAN_UNSUPPORTED（而不是 QUOTA_EXCEEDED / PROVIDER_ERROR），
    // 让用户看到「套餐不支持，需按量付费」而不是误导性的「暂时不可用，请重试」。
    it('套餐不支持克隆（token plan not support voice_clone）归类为 PLAN_UNSUPPORTED，优先于额度类判定', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ file: { file_id: 12345 } }),
        createFetchResponse({ base_resp: { status_code: 2013, status_msg: 'your current token plan not support model, voice_clone' } }),
      ])
      global.fetch = fetchMock
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })
      const error = await adapter.cloneVoice({ name: '音色001', samples: [{ blob, fileName: 'clone.mp3', contentType: 'audio/mpeg' }] }).catch((e) => e)
      expect(error).toBeInstanceOf(ProviderError)
      expect(error.code).toBe('PLAN_UNSUPPORTED')
      expect(error.message).toContain('token plan not support')
    })

    it('status_code=2038 时同样归类为 PLAN_UNSUPPORTED（官方：语音克隆功能被禁用，需完成认证）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ file: { file_id: 12345 } }),
        createFetchResponse({ base_resp: { status_code: 2038, status_msg: 'voice clone user forbidden' } }),
      ])
      global.fetch = fetchMock
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })
      const error = await adapter.cloneVoice({ name: '音色001', samples: [{ blob, fileName: 'clone.mp3', contentType: 'audio/mpeg' }] }).catch((e) => e)
      expect(error.code).toBe('PLAN_UNSUPPORTED')
      expect(error.context).toMatchObject({ statusCode: 2038 })
    })

    it('普通额度类错误（insufficient balance）不误判为 PLAN_UNSUPPORTED，仍为 QUOTA_EXCEEDED', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ file: { file_id: 12345 } }),
        createFetchResponse({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }),
      ])
      global.fetch = fetchMock
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })
      const error = await adapter.cloneVoice({ name: '音色001', samples: [{ blob, fileName: 'clone.mp3', contentType: 'audio/mpeg' }] }).catch((e) => e)
      expect(error.code).toBe('QUOTA_EXCEEDED')
    })

    it('缺少样本时抛出配置错误', async () => {
      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await expect(adapter.cloneVoice({ name: 'x', samples: [] })).rejects.toThrow()
    })
  })

  describe('synthesize 字幕时间戳（subtitle_enable + subtitle_type=word）', () => {
    it('同步 /t2a_v2：subtitleType=word 时开启字幕并透传 subtitle_file 下载链接 + extra_info 时长', async () => {
      const subtitleUrl = 'https://cdn.minimax.chat/subtitles/task-9/subtitle.json'
      const fetchMock = createFetchMock([
        createFetchResponse({
          data: {
            audio: HEX_AUDIO,
            subtitle_file: subtitleUrl,
            extra_info: { audio_length: 1234 },
          },
        }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = await adapter.synthesize({ text: '你好', model: 'speech-2.6-hd', subtitleType: 'word' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.subtitle_enable).toBe(true)
      expect(body.subtitle_type).toBe('word')
      expect(result.subtitleFile).toBe(subtitleUrl)
      expect(result.duration).toBe(1.234)
      expect(result.audio.toString('utf8')).toBe('Hello')
    })

    it('withTimestamps=true 默认启用词级字幕（word）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { audio: HEX_AUDIO, subtitle_file: 'https://cdn.minimax.chat/sub.json' } }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.synthesize({ text: '你好', model: 'speech-2.6-hd', withTimestamps: true })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.subtitle_enable).toBe(true)
      expect(body.subtitle_type).toBe('word')
    })

    it('未请求字幕时请求体不携带 subtitle_enable（行为兼容）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ data: { audio: HEX_AUDIO } })])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.synthesize({ text: '你好', model: 'speech-2.6-hd' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.subtitle_enable).toBeUndefined()
      expect(body.subtitle_type).toBeUndefined()
    })

    it('字幕白名单之外的模型不发送 subtitle_enable（避免参数错误）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ data: { audio: HEX_AUDIO } })])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.synthesize({ text: '你好', model: 'custom-tts-model', subtitleType: 'word' })

      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.subtitle_enable).toBeUndefined()
      expect(body.subtitle_type).toBeUndefined()
    })
  })

  describe('异步 T2A（speech-2.8-* 默认模型）', () => {
    const ASYNC_AUDIO_HEX = '68656c6c6f2d6173796e63' // "hello-async"

    function createBinaryResponse(bytes) {
      const buf = new Uint8Array(bytes).buffer
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        async json() { return {} },
        async text() { return '' },
        async arrayBuffer() { return buf },
        body: null,
      }
    }

    it('speech-2.8-turbo 走 t2a_async_v2 → query → 下载，返回 Buffer 音频', async () => {
      const createResp = createFetchResponse({ data: { task_id: 'task-1' } })
      const queryResp = createFetchResponse({ data: { file_id: 'file-1', status: 'success' } })
      const downloadResp = createBinaryResponse(Buffer.from(ASYNC_AUDIO_HEX, 'hex'))
      const fetchMock = createFetchMock([createResp, queryResp, downloadResp])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = await adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo' })

      expect(result.audio.toString('utf8')).toBe('hello-async')
      expect(result.format).toBe('mp3')
      // 创建任务用异步端点；下载用 files/retrieve_content
      expect(fetchMock.calls[0].url).toContain('/t2a_async_v2')
      expect(fetchMock.calls[2].url).toContain('/files/retrieve_content?file_id=file-1')
      // 请求体含 language_boost 与 audio_setting 异步字段
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.language_boost).toBe('auto')
      expect(body.audio_setting.audio_sample_rate).toBe(32000)
      expect(body.voice_setting.vol).toBe(10)
    })

    it('异步创建任务携带字幕参数，查询响应透传 subtitle_file + extra_info 时长', async () => {
      const subtitleUrl = 'https://cdn.minimax.chat/subtitles/async-1/subtitle.json'
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { task_id: 'task-sub' } }),
        createFetchResponse({
          data: { file_id: 'file-sub', status: 'success', subtitle_file: subtitleUrl, extra_info: { audio_length: 2000 } },
        }),
        createBinaryResponse(Buffer.from(ASYNC_AUDIO_HEX, 'hex')),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = await adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo', subtitleType: 'word' })

      const createBody = JSON.parse(fetchMock.calls[0].opts.body)
      expect(createBody.subtitle_enable).toBe(true)
      expect(createBody.subtitle_type).toBe('word')
      expect(result.subtitleFile).toBe(subtitleUrl)
      expect(result.duration).toBe(2)
      expect(result.audio.toString('utf8')).toBe('hello-async')
    })

    it('异步端点拒绝未文档化字幕参数时降级重试（不带字幕），TTS 不回归', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ base_resp: { status_code: 2013, status_msg: 'invalid params' } }, 400),
        createFetchResponse({ data: { task_id: 'task-fallback' } }),
        createFetchResponse({ data: { file_id: 'file-fallback' } }),
        createBinaryResponse(Buffer.from(ASYNC_AUDIO_HEX, 'hex')),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = await adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo', subtitleType: 'word' })

      const firstBody = JSON.parse(fetchMock.calls[0].opts.body)
      const secondBody = JSON.parse(fetchMock.calls[1].opts.body)
      expect(firstBody.subtitle_enable).toBe(true)
      expect(secondBody.subtitle_enable).toBeUndefined()
      expect(secondBody.subtitle_type).toBeUndefined()
      expect(result.audio.toString('utf8')).toBe('hello-async')
      expect(result.subtitleFile).toBeUndefined()
    })

    it('异步创建接口以 200 + base_resp(2013) 业务错误拒绝字幕参数时同样降级重试', async () => {
      // MiniMax 常见业务错误形态：HTTP 200 + base_resp.status_code != 0（而非非 2xx）
      const fetchMock = createFetchMock([
        createFetchResponse({ base_resp: { status_code: 2013, status_msg: 'invalid params' } }),
        createFetchResponse({ data: { task_id: 'task-body-fallback' } }),
        createFetchResponse({ data: { file_id: 'file-body-fallback' } }),
        createBinaryResponse(Buffer.from(ASYNC_AUDIO_HEX, 'hex')),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = await adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo', subtitleType: 'word' })

      const firstBody = JSON.parse(fetchMock.calls[0].opts.body)
      const secondBody = JSON.parse(fetchMock.calls[1].opts.body)
      expect(firstBody.subtitle_enable).toBe(true)
      expect(secondBody.subtitle_enable).toBeUndefined()
      expect(secondBody.subtitle_type).toBeUndefined()
      expect(fetchMock.calls.length).toBe(4)
      expect(result.audio.toString('utf8')).toBe('hello-async')
      expect(result.subtitleFile).toBeUndefined()
    })

    it('异步创建接口非参数类错误（503 通用消息）不触发字幕降级重试，原样抛出', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({}, 503),
        createFetchResponse({ data: { task_id: 'never' } }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const error = await adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo', subtitleType: 'word' }).catch((e) => e)
      expect(error).toBeInstanceOf(ProviderError)
      expect(error.code).toBe('PROVIDER_ERROR')
      expect(error.context.statusCode).toBe(503)
      expect(fetchMock.calls.length).toBe(1)
    })

    it('官方查询响应（status/file_id 在顶层）时正常完成并下载', async () => {
      // 官方 query 接口返回 { task_id, status, file_id, base_resp }（顶层，不在 data 内）
      const createResp = createFetchResponse({ task_id: 12345 })
      const queryResp = createFetchResponse({ task_id: 12345, status: 'success', file_id: 67890, base_resp: { status_code: 0, status_msg: 'SUCCESS' } })
      const downloadResp = createBinaryResponse(Buffer.from(ASYNC_AUDIO_HEX, 'hex'))
      const fetchMock = createFetchMock([createResp, queryResp, downloadResp])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = await adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo' })
      expect(result.audio.toString('utf8')).toBe('hello-async')
      expect(fetchMock.calls[1].url).toContain('/query/t2a_async_query_v2?task_id=12345')
      expect(fetchMock.calls[2].url).toContain('/files/retrieve_content?file_id=67890')
    })

    it('官方查询响应顶层 status=processing 时继续轮询（不误判完成/失败）', async () => {
      const createResp = createFetchResponse({ task_id: 12346 })
      const queryResp1 = createFetchResponse({ task_id: 12346, status: 'processing', base_resp: { status_code: 0 } })
      const queryResp2 = createFetchResponse({ task_id: 12346, status: 'success', file_id: 67891, base_resp: { status_code: 0 } })
      const downloadResp = createBinaryResponse(Buffer.from(ASYNC_AUDIO_HEX, 'hex'))
      const fetchMock = createFetchMock([createResp, queryResp1, queryResp2, downloadResp])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = await adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo' })
      expect(result.audio.toString('utf8')).toBe('hello-async')
      // 创建 + 2 次查询 + 下载
      expect(fetchMock.calls.length).toBe(4)
    })

    it('查询响应直接携带 data.audio（hex）时直接返回，不下载', async () => {
      const createResp = createFetchResponse({ data: { task_id: 'task-2' } })
      const queryResp = createFetchResponse({ data: { audio: ASYNC_AUDIO_HEX, status: 'success' } })
      const fetchMock = createFetchMock([createResp, queryResp])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const result = await adapter.synthesize({ text: '你好', model: 'speech-2.8-hd' })
      expect(result.audio.toString('utf8')).toBe('hello-async')
      // 只发生 2 次请求（创建 + 查询），未走下载
      expect(fetchMock.calls.length).toBe(2)
    })

    it('音色无效错误归类 INVALID_CONFIG（不可重试）并透传原因', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ base_resp: { status_code: 1004, status_msg: 'invalid params, voice id wrong' } }),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      const error = await adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo' }).catch((e) => e)
      expect(error).toBeInstanceOf(ProviderError)
      expect(error.code).toBe('INVALID_CONFIG')
      expect(error.retryable).toBe(false)
      expect(error.message).toContain('voice id wrong')
    })

    it('克隆音色（非系统音色）自动改用 speech-02-hd 模型走异步合成', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { task_id: 'task-clone' } }),
        createFetchResponse({ data: { file_id: 'file-clone' } }),
        createBinaryResponse(Buffer.from('68656c6c6f', 'hex')),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      // voice '01' 不在系统音色列表（本地克隆音色）→ 必须用 speech-02-hd，而不是配置的 speech-2.8-turbo
      const result = await adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo', voice: '01' })
      expect(result.audio.toString('utf8')).toBe('hello')

      const createBody = JSON.parse(fetchMock.calls[0].opts.body)
      expect(createBody.model).toBe('speech-02-hd')
      expect(createBody.voice_setting.voice_id).toBe('01')
    })

    it('官方音色使用配置的模型（speech-2.8-turbo）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ data: { task_id: 'task-sys' } }),
        createFetchResponse({ data: { file_id: 'file-sys' } }),
        createBinaryResponse(Buffer.from('68656c6c6f', 'hex')),
      ])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo', voice: 'male-qn-qingse' })

      const createBody = JSON.parse(fetchMock.calls[0].opts.body)
      expect(createBody.model).toBe('speech-2.8-turbo')
      expect(createBody.voice_setting.voice_id).toBe('male-qn-qingse')
    })

    it('创建任务未返回 task_id 时抛 ProviderError', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ base_resp: { status_code: 1004, status_msg: 'bad' } })])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await expect(adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo' })).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
      })
    })

    it('查询返回 error/失败状态时抛 ProviderError，不再轮询', async () => {
      const createResp = createFetchResponse({ data: { task_id: 'task-3' } })
      const queryResp = createFetchResponse({ data: { error: { message: 'voice not supported' }, status: 'failed' } })
      const fetchMock = createFetchMock([createResp, queryResp])
      global.fetch = fetchMock

      const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
      await expect(adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo' })).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
        message: expect.stringContaining('voice not supported'),
      })
    })

    it('轮询超时抛 ProviderError TIMEOUT（异步轮询上限可注入）', async () => {
      const calls = []
      global.fetch = vi.fn(async (url) => {
        calls.push(String(url))
        // 创建任务返回 task_id；查询持续返回 pending（无 file_id、无 error）
        return String(url).includes('query')
          ? createFetchResponse({ data: { status: 'pending' } })
          : createFetchResponse({ data: { task_id: 'task-4' } })
      })

      const adapter = new MinimaxTtsAdapter(
        { id: 'minimax-tts', apiKey: 'mm-test' },
        { asyncPollTimeoutMs: 50 }
      )
      await expect(adapter.synthesize({ text: '你好', model: 'speech-2.8-turbo' })).rejects.toMatchObject({
        code: 'TIMEOUT',
      })
      // 至少发生过创建 + 一次查询
      expect(calls.some((u) => u.includes('/t2a_async_v2'))).toBe(true)
      expect(calls.some((u) => u.includes('/query/t2a_async_query_v2'))).toBe(true)
    })
  })

  // ─── 克隆音色 voice_id 合规性（官方约束：长度[8,256]、首字母、仅[A-Za-z0-9_-]、末位非 -/_）───
  describe('克隆音色 voice_id 合规性', () => {
    const { buildMiniMaxCloneVoiceId, isValidMiniMaxCloneVoiceId } = require('./minimax-tts')

    it('buildMiniMaxCloneVoiceId 生成的 id 始终满足官方约束', () => {
      for (const name of ['01', '我的音色', '沉稳高管', 'abc', 'a-b_c', '', '超长名称'.repeat(50)]) {
        const id = buildMiniMaxCloneVoiceId(name)
        expect(isValidMiniMaxCloneVoiceId(id)).toBe(true)
        expect(id).toMatch(/^[a-zA-Z]/)
        expect(id.length).toBeGreaterThanOrEqual(8)
        expect(id.length).toBeLessThanOrEqual(256)
      }
    })

    it('生成 id 带随机后缀，多次生成不重复', () => {
      const seen = new Set(Array.from({ length: 50 }, () => buildMiniMaxCloneVoiceId('克隆音色')))
      expect(seen.size).toBe(50)
    })

    it('isValidMiniMaxCloneVoiceId 拒绝非法 id（短/数字开头/非法字符/末位 -_）', () => {
      expect(isValidMiniMaxCloneVoiceId('01')).toBe(false)          // 长度不足且数字开头
      expect(isValidMiniMaxCloneVoiceId('12345678')).toBe(false)    // 数字开头
      expect(isValidMiniMaxCloneVoiceId('MiniMax name')).toBe(false) // 空格
      expect(isValidMiniMaxCloneVoiceId('MiniMax001_')).toBe(false)  // 末位 _
      expect(isValidMiniMaxCloneVoiceId('MiniMax001-')).toBe(false)  // 末位 -
      expect(isValidMiniMaxCloneVoiceId(null)).toBe(false)
      expect(isValidMiniMaxCloneVoiceId('MiniMax001')).toBe(true)
    })

    it('cloneVoice 复刻请求携带合规 voice_id，且返回 id 合规', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ file: { file_id: 12345 } }),
        createFetchResponse({ voice_id: 'MiniMaxMyVoice_abc123' }),
      ])
      global.fetch = fetchMock
      try {
        const adapter = new MinimaxTtsAdapter({ id: 'minimax-tts', apiKey: 'mm-test' })
        const blob = new Blob(['audio-bytes'], { type: 'audio/mpeg' })
        const result = await adapter.cloneVoice({ name: '我的音色01', samples: [{ blob, fileName: 'a.mp3' }] })
        expect(result.id).toBe('MiniMaxMyVoice_abc123')
        expect(isValidMiniMaxCloneVoiceId(result.id)).toBe(true)
        const cloneCall = fetchMock.calls.find((c) => String(c.url).includes('/voice_clone'))
        const body = JSON.parse(cloneCall.opts.body)
        expect(isValidMiniMaxCloneVoiceId(body.voice_id)).toBe(true)
        expect(body.voice_id).toMatch(/^MiniMax/)
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})
