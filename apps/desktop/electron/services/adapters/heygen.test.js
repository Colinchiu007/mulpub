// @ts-check
/**
 * heygen.test.js — HeyGen 数字人 Adapter 测试
 *
 * 验证：构造、validateConfig、能力协商、generateVideo（数字人）、getVideoStatus、错误处理、testConnection、网络错误
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

__registerMock('../logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() })

const { HeyGenAdapter } = require('./heygen')
const { ProviderError, ERROR_CODES } = require('./_base/provider-error')
const { ADAPTER_VERSION } = require('./_base/base')

function createFetchResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    async json() { return body },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
    body: null,
  }
}

function createFetchMock(responses = []) {
  const calls = []
  const mock = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    return responses.shift() || createFetchResponse({})
  })
  mock.calls = calls
  return mock
}

describe('HeyGenAdapter — HeyGen 数字人', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch; vi.clearAllMocks() })

  describe('构造与配置', () => {
    it('接受 credentials + options 分离参数', () => {
      const adapter = new HeyGenAdapter({
        id: 'heygen', apiKey: 'hg-key', baseUrl: 'https://api.heygen.com/v2',
      }, { timeout: 60000 })
      expect(adapter.id).toBe('heygen')
      expect(adapter.credentials.apiKey).toBe('hg-key')
    })
    it('默认 baseUrl', () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      expect(adapter.credentials.baseUrl).toBe('https://api.heygen.com/v2')
    })
    it('版本号匹配 ADAPTER_VERSION', () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      expect(adapter.version).toBe(ADAPTER_VERSION)
    })
  })

  describe('validateConfig', () => {
    it('有 apiKey 时返回 valid', () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      expect(adapter.validateConfig().valid).toBe(true)
    })
    it('无 apiKey 时返回 invalid', () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: '' })
      expect(adapter.validateConfig().valid).toBe(false)
    })
  })

  describe('能力协商', () => {
    it('支持 generateVideo / getVideoStatus', () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      expect(adapter.supports('generateVideo')).toBe(true)
      expect(adapter.supports('getVideoStatus')).toBe(true)
      expect(adapter.capabilities()).toContain('generateVideo')
    })
  })

  describe('generateVideo', () => {
    it('POST /video/generate 返回 { taskId, model }', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        data: { video_id: 'vid-123' },
      })])
      global.fetch = fetchMock

      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.generateVideo({
        character: 'anna',
        voice: 'en_us',
        script: 'Hello world',
      })

      expect(result.taskId).toBe('vid-123')
      expect(result.model).toBe('heygen')

      expect(fetchMock.calls[0].url).toContain('/video/generate')
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.video_inputs[0].character).toBe('anna')
      expect(body.video_inputs[0].voice).toBe('en_us')
      expect(body.video_inputs[0].script).toBe('Hello world')
      expect(fetchMock.calls[0].opts.headers['Authorization']).toBe('Bearer k')
    })

    it('无 character 抛错', async () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await expect(adapter.generateVideo({ voice: 'v', script: 's' })).rejects.toThrow(/character.*required/i)
    })

    it('无 voice 抛错', async () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await expect(adapter.generateVideo({ character: 'c', script: 's' })).rejects.toThrow(/voice.*required/i)
    })

    it('无 script 抛错', async () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await expect(adapter.generateVideo({ character: 'c', voice: 'v' })).rejects.toThrow(/script.*required/i)
    })

    it('401 → AUTH_FAILED', async () => {
      global.fetch = createFetchMock([createFetchResponse({ message: 'Bad key' }, 401)])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'bad' })
      try {
        await adapter.generateVideo({ character: 'c', voice: 'v', script: 's' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.AUTH_FAILED)
      }
    })

    it('429 → RATE_LIMITED', async () => {
      global.fetch = createFetchMock([createFetchResponse({ message: 'rate' }, 429)])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      try {
        await adapter.generateVideo({ character: 'c', voice: 'v', script: 's' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.RATE_LIMITED)
      }
    })
  })

  describe('getVideoStatus', () => {
    it('GET /video/status?id={taskId} 返回状态', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        data: { status: 'completed', video_url: 'https://example.com/v.mp4', progress: 100 },
      })])
      global.fetch = fetchMock

      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.getVideoStatus('vid-123')

      expect(result.status).toBe('completed')
      expect(result.videoUrl).toBe('https://example.com/v.mp4')
      expect(result.progress).toBe(100)
      expect(fetchMock.calls[0].url).toContain('/video/status')
      expect(fetchMock.calls[0].url).toContain('id=vid-123')
    })

    it('processing 状态映射', async () => {
      global.fetch = createFetchMock([createFetchResponse({
        data: { status: 'processing', progress: 50 },
      })])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.getVideoStatus('v1')
      expect(result.status).toBe('processing')
      expect(result.progress).toBe(50)
    })

    it('无 taskId 抛错', async () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await expect(adapter.getVideoStatus('')).rejects.toThrow(/taskId.*required/i)
    })
  })

  describe('listAvatars — 数字人形象目录', () => {
    it('GET /avatars 归一化为 { id, name, previewUrl, gender }', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        data: {
          avatars: [
            { avatar_id: 'ava-1', avatar_name: '主持人小雅', preview_url: 'https://x/1.png', gender: 'female' },
            { avatar_id: 'ava-2', avatar_name: '主持人小博', gender: 'male' },
          ],
        },
      })])
      global.fetch = fetchMock

      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const list = await adapter.listAvatars()

      expect(list).toHaveLength(2)
      expect(list[0]).toEqual({
        id: 'ava-1', name: '主持人小雅', previewUrl: 'https://x/1.png', gender: 'female',
      })
      expect(list[1].previewUrl).toBe('')
      expect(fetchMock.calls[0].url).toContain('/avatars')
    })

    it('data 直接为数组的形态也能解析', async () => {
      global.fetch = createFetchMock([createFetchResponse({
        data: [{ avatar_id: 'ava-9', avatar_name: '备用形象' }],
      })])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const list = await adapter.listAvatars()
      expect(list).toEqual([{ id: 'ava-9', name: '备用形象', previewUrl: '', gender: '' }])
    })

    it('缺 id 的条目丢弃，不产出空 character', async () => {
      global.fetch = createFetchMock([createFetchResponse({
        data: { avatars: [{ avatar_name: '无名' }, { avatar_id: 'ava-1' }] },
      })])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const list = await adapter.listAvatars()
      expect(list).toHaveLength(1)
      expect(list[0]).toEqual({ id: 'ava-1', name: 'ava-1', previewUrl: '', gender: '' })
    })

    it('响应体异常（无 data）返回空数组而非抛错', async () => {
      global.fetch = createFetchMock([createFetchResponse({})])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await expect(adapter.listAvatars()).resolves.toEqual([])
    })

    it('401 认证失败向上冒泡为 AUTH_FAILED', async () => {
      global.fetch = createFetchMock([createFetchResponse({ message: 'Unauthorized' }, 401)])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'bad' })
      try {
        await adapter.listAvatars()
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.AUTH_FAILED)
      }
    })
  })

  describe('listVoices — 音色目录', () => {
    it('GET /voices 归一化为 { id, name, language, gender }', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        data: {
          voices: [
            { voice_id: 'v-1', name: '甜美女声', language: 'zh-CN', gender: 'female' },
            { voice_id: 'v-2', name: '沉稳男声', language: 'en-US', gender: 'male' },
          ],
        },
      })])
      global.fetch = fetchMock

      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const list = await adapter.listVoices()

      expect(list).toHaveLength(2)
      expect(list[0]).toEqual({ id: 'v-1', name: '甜美女声', language: 'zh-CN', gender: 'female' })
      expect(fetchMock.calls[0].url).toContain('/voices')
    })

    it('data 直接为数组的形态也能解析', async () => {
      global.fetch = createFetchMock([createFetchResponse({
        data: [{ voice_id: 'v-9', display_name: '展示名' }],
      })])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const list = await adapter.listVoices()
      expect(list).toEqual([{ id: 'v-9', name: '展示名', language: '', gender: '' }])
    })

    it('缺 voice_id 的条目丢弃', async () => {
      global.fetch = createFetchMock([createFetchResponse({
        data: { voices: [{ name: '无名音色' }, { voice_id: 'v-1' }] },
      })])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const list = await adapter.listVoices()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('v-1')
    })
  })

  describe('testConnection', () => {
    it('请求成功返回 true', async () => {
      global.fetch = createFetchMock([createFetchResponse({ data: { status: 'completed' } })])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.testConnection()
      expect(result.success).toBe(true)
    })
  })

  describe('网络错误分类', () => {
    it('ETIMEDOUT → TIMEOUT', async () => {
      global.fetch = vi.fn(async () => { throw new Error('ETIMEDOUT') })
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      try {
        await adapter.generateVideo({ character: 'c', voice: 'v', script: 's' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.TIMEOUT)
      }
    })
    it('ECONNREFUSED → NETWORK_ERROR', async () => {
      global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      try {
        await adapter.generateVideo({ character: 'c', voice: 'v', script: 's' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.NETWORK_ERROR)
      }
    })
  })
})
