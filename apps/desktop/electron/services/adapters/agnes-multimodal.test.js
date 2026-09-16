// @ts-check
/**
 * agnes-multimodal.test.js — TDD: Agnes-AI 多模态 Adapter（中国站）测试
 *
 * 覆盖：
 * - 构造与默认配置（中国站 Base URL https://api.agnes-ai.cn/v1）
 * - 能力委托：chatCompletion → AgnesLlmAdapter；generateImage → AgnesImageAdapter
 * - 视频 2.5 Flash 新协议：POST /videos（mode/seconds/size:"720P"/aspect_ratio）
 * - 任务查询：GET /agnesapi?video_id=&model_name=（model_name 必带）
 * - 503/429 有界重试；keyframe/reference 模式校验
 * - 预设契约：agnes-multimodal 种子声明 ≥2 能力 + capability_models
 *
 * 使用 fetch mock，不发起真实 HTTP 请求
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

global.__registerMock('../logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn() })

const { AgnesMultimodalAdapter, AGNES_MULTIMODAL_MODELS, pickAspectRatio, pickSeconds } = require('./agnes-multimodal')
const { PRESET_PROVIDERS, PRESET_RATE_LIMITS } = require('../model-provider-seeds')
const { ProviderError, ERROR_CODES } = require('./_base/provider-error')

// ─── fetch mock 工具 ───
function createFetchResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    async json() { return body },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
    async arrayBuffer() { return new ArrayBuffer(0) },
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

describe('AgnesMultimodalAdapter — Agnes-AI 多模态（中国站）', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('构造与配置', () => {
    it('默认 baseUrl 为中国站统一端点', () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-agnes-test' })
      expect(adapter.credentials.baseUrl).toBe('https://api.agnes-ai.cn/v1')
      expect(adapter.credentials.apiKey).toBe('sk-agnes-test')
    })

    it('显式 baseUrl 覆盖默认值（子适配器共享同一 credentials）', () => {
      const adapter = new AgnesMultimodalAdapter({
        id: 'agnes-multimodal',
        apiKey: 'sk-test',
        baseUrl: 'https://custom.example.com/v1',
      })
      expect(adapter.credentials.baseUrl).toBe('https://custom.example.com/v1')
      expect(adapter._llm.credentials.baseUrl).toBe('https://custom.example.com/v1')
      expect(adapter._image.credentials.baseUrl).toBe('https://custom.example.com/v1')
    })

    it('缺少 apiKey 时 validateConfig 失败', () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal' })
      const result = adapter.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('apiKey is required')
    })

    it('listModels 返回静态 3 个模型（副本）', async () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const models = await adapter.listModels()
      expect(models.map(m => m.id)).toEqual([
        'agnes-3.0-flash',
        'agnes-image-2.5-flash',
        'agnes-video-2.5-flash',
      ])
      models[0].id = 'mutated'
      expect(AGNES_MULTIMODAL_MODELS[0].id).toBe('agnes-3.0-flash')
    })
  })

  describe('参数推导工具', () => {
    it('pickSeconds：numFrames/frameRate 推导并 clamp 到 4–12，非法输入默认 "5"', () => {
      expect(pickSeconds(121, 24)).toBe('5')
      expect(pickSeconds(48, 24)).toBe('4')
      expect(pickSeconds(999, 24)).toBe('12')
      expect(pickSeconds(0, 24)).toBe('5')
      expect(pickSeconds(undefined, undefined)).toBe('5')
      expect(pickSeconds('abc', 'def')).toBe('5')
    })

    it('pickAspectRatio：宽高推导最近支持画幅，非法输入默认 16:9', () => {
      expect(pickAspectRatio(1280, 720)).toBe('16:9')
      expect(pickAspectRatio(720, 1280)).toBe('9:16')
      expect(pickAspectRatio(1024, 1024)).toBe('1:1')
      expect(pickAspectRatio(0, 720)).toBe('16:9')
      expect(pickAspectRatio(undefined, undefined)).toBe('16:9')
    })
  })

  describe('generateVideo — v2.5 协议', () => {
    it('text 模式：POST /videos，size 固定 720P，seconds 由帧数/帧率推导', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-123', id: 'task-1' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })

      const result = await adapter.generateVideo({
        prompt: '夜色中的城市街道',
        width: 1280,
        height: 720,
        numFrames: 121,
        frameRate: 24,
      })

      expect(result).toEqual({ taskId: 'vid-123', model: 'agnes-video-2.5-flash' })
      expect(fetchMock.calls).toHaveLength(1)
      const { url, opts } = fetchMock.calls[0]
      expect(url).toBe('https://api.agnes-ai.cn/v1/videos')
      expect(opts.method).toBe('POST')
      const body = JSON.parse(opts.body)
      expect(body).toMatchObject({
        model: 'agnes-video-2.5-flash',
        prompt: '夜色中的城市街道',
        mode: 'text',
        size: '720P',
        aspect_ratio: '16:9',
        seconds: '5',
      })
      // v2.0 旧协议字段不得出现
      expect(body.num_frames).toBeUndefined()
      expect(body.frame_rate).toBeUndefined()
      expect(body.width).toBeUndefined()
      expect(body.height).toBeUndefined()
    })

    it('认证头携带 Bearer token', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-1' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-abc' })
      await adapter.generateVideo({ prompt: 'p' })
      expect(fetchMock.calls[0].opts.headers.Authorization).toBe('Bearer sk-abc')
    })

    it('显式 model/aspect_ratio/seconds 优先；taskId 兼容 id/task_id 命名', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ id: 'task-9' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const result = await adapter.generateVideo({
        prompt: 'p',
        model: 'agnes-video-2.5-flash',
        aspect_ratio: '9:16',
        seconds: '6',
      })
      expect(result.taskId).toBe('task-9')
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.aspect_ratio).toBe('9:16')
      expect(body.seconds).toBe('6')
    })

    it('image 参数推导为 keyframe 模式并映射 first_frame', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-kf' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await adapter.generateVideo({ prompt: 'p', image: 'https://example.com/first.png' })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.mode).toBe('keyframe')
      expect(body.first_frame).toBe('https://example.com/first.png')
    })

    it('keyframe 模式缺 first_frame/last_frame 时抛 INVALID_CONFIG，不发起请求', async () => {
      const fetchMock = createFetchMock()
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await expect(adapter.generateVideo({ prompt: 'p', mode: 'keyframe' }))
        .rejects.toMatchObject({ code: ERROR_CODES.INVALID_CONFIG })
      expect(fetchMock.calls).toHaveLength(0)
    })

    it('reference 模式：images/audios 透传', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-ref' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await adapter.generateVideo({
        prompt: '以 <Picture 1> 为参考',
        images: ['https://example.com/a.png'],
        audios: ['https://example.com/b.mp3'],
      })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.mode).toBe('reference')
      expect(body.images).toEqual(['https://example.com/a.png'])
      expect(body.audios).toEqual(['https://example.com/b.mp3'])
    })

    it('503 后重试成功（注入短退避）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ detail: 'video_queue_full' }, 503),
        createFetchResponse({ video_id: 'vid-retry' }),
      ])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter(
        { id: 'agnes-multimodal', apiKey: 'sk-test' },
        { retryBackoffMs: [1, 1, 1, 1, 1] }
      )
      const result = await adapter.generateVideo({ prompt: 'p' })
      expect(result.taskId).toBe('vid-retry')
      expect(fetchMock.calls).toHaveLength(2)
    })

    it('400（非重试错误）立即抛出，不重试', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ detail: 'size must be 720P' }, 400)])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter(
        { id: 'agnes-multimodal', apiKey: 'sk-test' },
        { retryBackoffMs: [1, 1, 1, 1, 1] }
      )
      await expect(adapter.generateVideo({ prompt: 'p' })).rejects.toBeInstanceOf(ProviderError)
      expect(fetchMock.calls).toHaveLength(1)
    })

    it('缺少 prompt 时抛 INVALID_CONFIG', async () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await expect(adapter.generateVideo({})).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CONFIG })
    })
  })

  describe('getVideoStatus — /agnesapi + model_name', () => {
    it('查询 URL 带回提交时的 model_name，completed 时从 metadata.url 取视频地址', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ video_id: 'vid-q' }),
        createFetchResponse({
          status: 'completed',
          progress: 100,
          metadata: { url: 'https://cdn.example.com/out.mp4' },
        }),
      ])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const submit = await adapter.generateVideo({ prompt: 'p', model: 'agnes-video-2.5-flash' })
      const status = await adapter.getVideoStatus({ videoId: submit.taskId, taskId: submit.taskId })

      expect(status).toEqual({ status: 'completed', videoUrl: 'https://cdn.example.com/out.mp4', progress: 100 })
      const queryUrl = fetchMock.calls[1].url
      expect(queryUrl).toContain('https://api.agnes-ai.cn/agnesapi?')
      expect(queryUrl).toContain('video_id=vid-q')
      expect(queryUrl).toContain('model_name=agnes-video-2.5-flash')
    })

    it('未记录的任务默认按 agnes-video-2.5-flash 查询；queued 映射为 processing', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ status: 'queued', progress: 0 })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const status = await adapter.getVideoStatus('vid-unknown')
      expect(status.status).toBe('processing')
      expect(status.videoUrl).toBe('')
      expect(fetchMock.calls[0].url).toContain('model_name=agnes-video-2.5-flash')
    })

    it('failed 状态映射为 failed', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ status: 'failed' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const status = await adapter.getVideoStatus('vid-fail')
      expect(status.status).toBe('failed')
    })

    it('缺少 taskId 时抛 INVALID_CONFIG', async () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await expect(adapter.getVideoStatus('')).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CONFIG })
    })
  })

  describe('能力委托（LLM / Image）', () => {
    it('chatCompletion 默认模型 agnes-3.0-flash，POST /chat/completions', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        id: 'chatcmpl-1',
        choices: [{ index: 0, message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const result = await adapter.chatCompletion({
        messages: [{ role: 'user', content: '你好' }],
      })
      const { url, opts } = fetchMock.calls[0]
      expect(url).toBe('https://api.agnes-ai.cn/v1/chat/completions')
      const body = JSON.parse(opts.body)
      expect(body.model).toBe('agnes-3.0-flash')
      expect(body.messages).toEqual([{ role: 'user', content: '你好' }])
      expect(result.content).toBe('你好')
    })

    it('generateImage 默认模型 agnes-image-2.5-flash，response_format 走 extra_body', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        created: 1780000000,
        data: [{ url: 'https://cdn.example.com/img.png', b64_json: null, revised_prompt: null }],
      })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const result = await adapter.generateImage({ prompt: 'a cat', size: '2K', ratio: '16:9' })
      const { url, opts } = fetchMock.calls[0]
      expect(url).toBe('https://api.agnes-ai.cn/v1/images/generations')
      const body = JSON.parse(opts.body)
      expect(body.model).toBe('agnes-image-2.5-flash')
      expect(body.size).toBe('2K')
      expect(body.extra_body).toEqual({ response_format: 'url' })
      expect(body.response_format).toBeUndefined()
      expect(result.urls).toEqual(['https://cdn.example.com/img.png'])
    })
  })

  describe('预设契约（model-provider-seeds）', () => {
    it('agnes-multimodal 预设存在，声明 ≥2 能力且 capability_models 对齐', () => {
      const preset = PRESET_PROVIDERS.find(p => p.id === 'agnes-multimodal')
      expect(preset).toBeDefined()
      expect(preset.category).toBe('multimodal')
      expect(preset.base_url).toBe('https://api.agnes-ai.cn/v1')
      expect(preset.capabilities).toEqual(['llm', 'image', 'video'])
      expect(preset.capabilities.length).toBeGreaterThanOrEqual(2)
      expect(preset.capability_models).toEqual({
        llm: 'agnes-3.0-flash',
        image: 'agnes-image-2.5-flash',
        video: 'agnes-video-2.5-flash',
      })
      // capability_models 必须都在 models 列表内
      for (const modelId of Object.values(preset.capability_models)) {
        expect(preset.models).toContain(modelId)
      }
    })

    it('agnes-multimodal 预设已登记限流预算', () => {
      expect(PRESET_RATE_LIMITS['agnes-multimodal']).toBeDefined()
      expect(PRESET_RATE_LIMITS['agnes-multimodal'].rate_per_minute).toBeGreaterThanOrEqual(1)
    })
  })
})
