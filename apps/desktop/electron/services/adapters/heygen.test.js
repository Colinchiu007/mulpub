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
    // 官方契约锁：请求体形状来自 HeyGen 文档（POST /v2/video/generate），
    // 不是照实现回写。旧实现把 character/voice 当扁平字符串、script 当顶层字段，
    // 单测当时也照着错形状断言，于是全绿但真实调用必 400（见执行记录逃逸分析）。
    it('POST /v2/video/generate 按官方契约提交 video_inputs 对象 + dimension', async () => {
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

      expect(fetchMock.calls[0].url).toBe('https://api.heygen.com/v2/video/generate')
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.video_inputs).toHaveLength(1)
      expect(body.video_inputs[0].character).toEqual({
        type: 'avatar',
        avatar_id: 'anna',
        avatar_style: 'normal',
      })
      expect(body.video_inputs[0].voice).toEqual({
        type: 'text',
        input_text: 'Hello world',
        voice_id: 'en_us',
      })
      expect(body.video_inputs[0].script).toBeUndefined()
      expect(body.dimension).toEqual({ width: 1280, height: 720 })
      // HeyGen 文档的认证头是 X-Api-Key；单一认证头，避免双头歧义
      expect(fetchMock.calls[0].opts.headers['X-Api-Key']).toBe('k')
      expect(fetchMock.calls[0].opts.headers['Authorization']).toBeUndefined()
    })

    it('显式 width/height/avatarStyle 覆盖默认值', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ data: { video_id: 'vid-9' } })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await adapter.generateVideo({
        character: 'c', voice: 'v', script: 's', width: 1080, height: 1920, avatarStyle: 'circle',
      })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.video_inputs[0].character.avatar_style).toBe('circle')
      expect(body.dimension).toEqual({ width: 1080, height: 1920 })
    })

    it('未知 avatarStyle 回落 normal，不把拼错的值发给上游', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ data: { video_id: 'vid-10' } })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await adapter.generateVideo({ character: 'c', voice: 'v', script: 's', avatarStyle: 'wide' })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.video_inputs[0].character.avatar_style).toBe('normal')
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
    // 官方契约锁：视频状态查询在 v1 API 根下，不是 /v2/video/status
    it('GET /v1/video_status.get?video_id={taskId} 返回状态', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        code: 100,
        data: { status: 'completed', video_url: 'https://example.com/v.mp4', progress: 100 },
      })])
      global.fetch = fetchMock

      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.getVideoStatus('vid-123')

      expect(result.status).toBe('completed')
      expect(result.videoUrl).toBe('https://example.com/v.mp4')
      expect(result.progress).toBe(100)
      expect(fetchMock.calls[0].url).toBe('https://api.heygen.com/v1/video_status.get?video_id=vid-123')
      expect(fetchMock.calls[0].url).not.toContain('/v2/video/status')
    })

    it('processing 状态映射', async () => {
      global.fetch = createFetchMock([createFetchResponse({
        code: 100,
        data: { status: 'processing', progress: 50 },
      })])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.getVideoStatus('v1')
      expect(result.status).toBe('processing')
      expect(result.progress).toBe(50)
    })

    it('waiting/pending 归一为 processing', async () => {
      global.fetch = createFetchMock([
        createFetchResponse({ code: 100, data: { status: 'waiting' } }),
        createFetchResponse({ code: 100, data: { status: 'pending' } }),
      ])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      expect((await adapter.getVideoStatus('v1')).status).toBe('processing')
      expect((await adapter.getVideoStatus('v2')).status).toBe('processing')
    })

    it('baseUrl 不带版本段时 apiRoot 不误伤路径', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ code: 100, data: { status: 'processing' } })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k', baseUrl: 'https://api.heygen.com' })
      await adapter.getVideoStatus('vid-1')
      expect(fetchMock.calls[0].url).toBe('https://api.heygen.com/v1/video_status.get?video_id=vid-1')
    })

    it('baseUrl 带端口时保留端口', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ code: 100, data: { status: 'processing' } })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k', baseUrl: 'https://api.heygen.com:8443/v2' })
      await adapter.getVideoStatus('vid-2')
      expect(fetchMock.calls[0].url).toBe('https://api.heygen.com:8443/v1/video_status.get?video_id=vid-2')
    })

    it('HTTP 200 但 API code 非成功码 → PROVIDER_ERROR', async () => {
      global.fetch = createFetchMock([createFetchResponse({
        code: 400, message: 'video not found', data: null,
      })])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      try {
        await adapter.getVideoStatus('missing')
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
        expect(e.message).toContain('video not found')
      }
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
    it('用 GET /v2/avatars 验证认证，200 返回 true', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ data: { avatars: [] } })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.testConnection()
      expect(result.success).toBe(true)
      expect(fetchMock.calls[0].url).toBe('https://api.heygen.com/v2/avatars')
      expect(fetchMock.calls[0].opts.headers['X-Api-Key']).toBe('k')
    })

    it('401 返回 success:false + AUTH_FAILED', async () => {
      global.fetch = createFetchMock([createFetchResponse({ message: 'Unauthorized' }, 401)])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'bad' })
      const result = await adapter.testConnection()
      expect(result.success).toBe(false)
      expect(result.error.code).toBe(ERROR_CODES.AUTH_FAILED)
    })
  })

  describe('cloneVoice — 声音克隆（POST /v3/voices/clone）', () => {
    // 官方契约锁：声音克隆是**独立端点**，不在视频生成时一起做。
    // 证据：developers.heygen.com/reference/clone-a-voice —— "Returns a voice_clone_id
    // that can be polled via GET /v3/voices/ until the status is 'complete'. The
    // resulting voice can be used with POST /v3/voices/speech and POST /v3/videos."
    // 注意版本段：克隆在 /v3，视频生成在 /v2（#4194），状态查询在 /v1。
    it('单条样本 → mode=instant，返回 { id, name }', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        data: { voice_clone_id: 'vc-123', name: '我的声音' },
      })])
      global.fetch = fetchMock

      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.cloneVoice({
        name: '我的声音',
        samples: [{
          blob: new Blob(['audio'], { type: 'audio/wav' }),
          fileName: 'me.wav',
          contentType: 'audio/wav',
        }],
      })

      expect(result).toEqual({ id: 'vc-123', name: '我的声音' })
      expect(fetchMock.calls[0].url).toBe('https://api.heygen.com/v3/voices/clone')
      expect(fetchMock.calls[0].opts.method).toBe('POST')
      expect(fetchMock.calls[0].opts.headers['X-Api-Key']).toBe('k')
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.mode).toBe('instant')
      expect(body.name).toBe('我的声音')
      // 素材以 base64 data URL 形式进 JSON 体（非 multipart）
      expect(typeof body.audio).toBe('string')
      expect(body.audio.startsWith('data:audio/wav;base64,')).toBe(true)
    })

    it('多条样本 → mode=professional', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        data: { voice_clone_id: 'vc-9', name: '专业声音' },
      })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await adapter.cloneVoice({
        name: '专业声音',
        samples: [
          { blob: new Blob(['a'], { type: 'audio/wav' }), fileName: 'a.wav', contentType: 'audio/wav' },
          { blob: new Blob(['b'], { type: 'audio/wav' }), fileName: 'b.wav', contentType: 'audio/wav' },
        ],
      })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.mode).toBe('professional')
    })

    it('缺 name 或缺样本抛 INVALID_CONFIG，且不发起请求', async () => {
      const fetchMock = vi.fn()
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const sample = { blob: new Blob(['a'], { type: 'audio/wav' }), fileName: 'a.wav', contentType: 'audio/wav' }
      await expect(adapter.cloneVoice({ samples: [sample] })).rejects.toThrow(/name.*required/i)
      await expect(adapter.cloneVoice({ name: 'x', samples: [] })).rejects.toThrow(/sample/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('响应缺 voice_clone_id → PROVIDER_ERROR', async () => {
      global.fetch = createFetchMock([createFetchResponse({ data: {} })])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      try {
        await adapter.cloneVoice({ name: 'x', samples: [{ blob: new Blob(['a']), fileName: 'a.wav', contentType: 'audio/wav' }] })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
      }
    })

    it('401 → AUTH_FAILED', async () => {
      global.fetch = createFetchMock([createFetchResponse({ message: 'Bad key' }, 401)])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'bad' })
      try {
        await adapter.cloneVoice({ name: 'x', samples: [{ blob: new Blob(['a']), fileName: 'a.wav', contentType: 'audio/wav' }] })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.AUTH_FAILED)
      }
    })
  })

  describe('deleteVoice — 删除克隆声音（DELETE /v3/voices/{id}）', () => {
    it('按官方路径删除并带 X-Api-Key', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ data: {} })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await adapter.deleteVoice('vc-123')
      expect(fetchMock.calls[0].url).toBe('https://api.heygen.com/v3/voices/vc-123')
      expect(fetchMock.calls[0].opts.method).toBe('DELETE')
      expect(fetchMock.calls[0].opts.headers['X-Api-Key']).toBe('k')
    })

    it('空 voiceId 抛 INVALID_CONFIG，且不发起请求', async () => {
      const fetchMock = vi.fn()
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await expect(adapter.deleteVoice('')).rejects.toThrow(/voiceId.*required/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('createAvatar — 形象克隆（POST /v3/avatars）', () => {
    // 端点族已由官方文档确认（"Supports photo, digital_twin, and prompt types"），
    // 但**字段名未经真实响应核对** ⇒ 按提案的 KNOWN_METHODS 分期登记决策，
    // 这两个方法本轮不登记进 callAdapter 闸门，测试只锁适配层自身契约。
    it('照片形象 type=photo，返回 { id }', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        data: { avatar_id: 'av-1', id: 'av-1' },
      })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.createAvatar({
        name: '我的形象',
        type: 'photo',
        image: { blob: new Blob(['img'], { type: 'image/png' }), fileName: 'me.png', contentType: 'image/png' },
      })
      expect(result.id).toBe('av-1')
      expect(fetchMock.calls[0].url).toBe('https://api.heygen.com/v3/avatars')
      expect(fetchMock.calls[0].opts.method).toBe('POST')
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.type).toBe('photo')
      expect(body.name).toBe('我的形象')
    })

    it('视频形象 type=digital_twin', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        data: { avatar_id: 'av-2', id: 'av-2' },
      })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await adapter.createAvatar({
        name: '视频形象',
        type: 'digital_twin',
        video: { blob: new Blob(['vid'], { type: 'video/mp4' }), fileName: 'me.mp4', contentType: 'video/mp4' },
      })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.type).toBe('digital_twin')
    })

    it('未知 type 抛 INVALID_CONFIG', async () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await expect(adapter.createAvatar({ name: 'x', type: 'hologram' })).rejects.toThrow(/type must be/i)
    })

    it('photo 缺 image / digital_twin 缺 video 抛 INVALID_CONFIG', async () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await expect(adapter.createAvatar({ name: 'x', type: 'photo' })).rejects.toThrow(/image.*required/i)
      await expect(adapter.createAvatar({ name: 'x', type: 'digital_twin' })).rejects.toThrow(/video.*required/i)
    })
  })

  describe('getAvatarStatus — 形象训练状态（GET /v3/avatars/looks/{id}）', () => {
    it('解析 training status 与 videoUrl 缺失', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        data: { id: 'av-1', status: 'training', training_status: 'training', progress: 40 },
      })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.getAvatarStatus('av-1')
      expect(fetchMock.calls[0].url).toBe('https://api.heygen.com/v3/avatars/looks/av-1')
      expect(result.status).toBe('training')
      expect(result.progress).toBe(40)
    })

    it('completed 归一', async () => {
      global.fetch = createFetchMock([createFetchResponse({
        data: { id: 'av-1', status: 'completed', training_status: 'ready' },
      })])
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      const result = await adapter.getAvatarStatus('av-1')
      expect(result.status).toBe('completed')
    })

    it('空 avatarId 抛 INVALID_CONFIG', async () => {
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await expect(adapter.getAvatarStatus('')).rejects.toThrow(/avatarId.*required/i)
    })
  })

  describe('deleteAvatar — 删除克隆形象（DELETE /v3/avatars/looks/{id}）', () => {
    it('按官方路径删除', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ data: {} })])
      global.fetch = fetchMock
      const adapter = new HeyGenAdapter({ id: 'heygen', apiKey: 'k' })
      await adapter.deleteAvatar('av-1')
      expect(fetchMock.calls[0].url).toBe('https://api.heygen.com/v3/avatars/looks/av-1')
      expect(fetchMock.calls[0].opts.method).toBe('DELETE')
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
