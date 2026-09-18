// @vitest-environment node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')

const { AssetGenerator, buildEdgeTtsScript, isPrivateAddress } = require('./asset-generator')
const { ProviderError, ERROR_CODES } = require('./adapters/_base/provider-error')

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
  'hex',
)
const WAV_BYTES = Buffer.from('524946462400000057415645666d7420100000000100010044ac00008858010002001000', 'hex')

function createGenerator(aiGenerator, overrides = {}) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-provider-assets-'))
  return {
    generator: new AssetGenerator({
      aiGenerator,
      log: { info: vi.fn(), warn: vi.fn() },
      outputDir,
      ...overrides,
    }),
    outputDir,
  }
}

describe('AssetGenerator provider integration', () => {
  it('writes a configured image provider result as a local media artifact instead of a placeholder', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => ({
        images: [{ b64_json: PNG_BYTES.toString('base64') }],
        model: 'sdxl',
      })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateImage('晨雾中的山谷', {
        image_provider: 'local-diffusion',
        index: 2,
        runId: 'provider-image',
      })

      expect(aiGenerator.generate).toHaveBeenCalledWith(
        'image',
        'local-diffusion',
        expect.objectContaining({ prompt: '晨雾中的山谷', response_format: 'b64_json' }),
      )
      expect(result).toMatchObject({
        code: 0,
        data: {
          provider: 'local-diffusion',
          source: 'model-provider',
          degraded: false,
        },
      })
      expect(fs.readFileSync(result.data.path).subarray(0, 8)).toEqual(PNG_BYTES.subarray(0, 8))
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('provider 返回空结果（如 { urls: [] }）时进入重试，5 次后返回 needs_user_input 友好提示', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: [], format: 'url' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateImage('测试场景描述', {
        image_provider: 'minimax-image',
        index: 0,
        runId: 'provider-empty',
      })

      expect(aiGenerator.generate).toHaveBeenCalledTimes(5)
      expect(result.code).toBe(-1)
      expect(result.needsUserInput).toBe(true)
      expect(result.checkpoint).toMatchObject({ reason: 'empty_result', sceneIndex: 0, sceneNumber: 1, attempts: 5 })
      expect(result.checkpoint.recommendation).toMatch(/未返回结果|内容安全策略|服务波动/)
      // 消息不再笼统报 content-policy review，而是如实说明多次未返回结果（2026-08-16 复盘）
      expect(result.message).toMatch(/repeatedly returned no result|no result/i)
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('uses a configured image provider even when the offline ffmpeg fallback is unavailable', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => ({ images: [{ b64_json: PNG_BYTES.toString('base64') }] })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, { ffmpeg: null })

    try {
      const result = await generator.generateImage('真实模型图片不依赖占位渲染器', {
        image_provider: 'local-diffusion',
        runId: 'provider-without-ffmpeg',
      })

      expect(aiGenerator.generate).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        code: 0,
        data: { source: 'model-provider', degraded: false },
      })
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('normalizes the legacy OpenAI image provider ID and preserves the requested aspect ratio', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => ({ images: [{ b64_json: PNG_BYTES.toString('base64') }] })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateImage('竖屏人物肖像', {
        image_provider: 'openai-image',
        aspect_ratio: '9:16',
        runId: 'legacy-openai-provider',
      })

      expect(result.code).toBe(0)
      expect(aiGenerator.generate).toHaveBeenCalledWith(
        'image',
        'dall-e',
        expect.objectContaining({ aspect_ratio: '9:16', width: 720, height: 1280 }),
      )
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('maps the 3:4 Story2Video output profile to a portrait provider image size', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => ({ images: [{ b64_json: PNG_BYTES.toString('base64') }] })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateImage('3:4 竖版画面', {
        image_provider: 'local-diffusion',
        aspect_ratio: '3:4',
        runId: 'provider-3-4-image',
      })

      expect(result.code).toBe(0)
      expect(aiGenerator.generate).toHaveBeenCalledWith(
        'image',
        'local-diffusion',
        expect.objectContaining({ aspect_ratio: '3:4', width: 768, height: 1024 }),
      )
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('builds an Edge TTS command that consumes the requested rate and pitch', () => {
    const script = buildEdgeTtsScript()

    expect(script).toContain('rate=sys.argv[4]')
    expect(script).toContain('pitch=sys.argv[5]')
  })
  it('fails closed for ComfyUI because the Story2Video path has no workflow and polling contract', async () => {
    const aiGenerator = { generate: vi.fn() }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateImage('不应伪造 ComfyUI 图片', {
        image_provider: 'comfyui',
        runId: 'unsupported-comfyui',
      })

      expect(result.code).toBeLessThan(0)
      expect(result.message).toMatch(/comfyui.*workflow.*poll/i)
      expect(aiGenerator.generate).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('uses connection-time public DNS validation before downloading an HTTPS provider image', async () => {
    const fetchImpl = vi.fn()
    const resolveHost = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }])
    let lookupResult = null
    const httpsRequest = vi.fn((url, options, onResponse) => {
      const request = new EventEmitter()
      request.setTimeout = vi.fn()
      request.end = vi.fn()
      request.destroy = vi.fn((error) => {
        if (error) queueMicrotask(() => request.emit('error', error))
      })
      queueMicrotask(() => {
        options.lookup('cdn.example.test', { family: 0 }, (error, address, family) => {
          if (error) return request.emit('error', error)
          lookupResult = { address, family }
          const response = new EventEmitter()
          response.statusCode = 200
          response.headers = {
            'content-type': 'image/png',
            'content-length': String(PNG_BYTES.length),
          }
          response.resume = vi.fn()
          onResponse(response)
          response.emit('data', PNG_BYTES)
          response.emit('end')
        })
      })
      return request
    })
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: ['https://cdn.example.test/generated.png'] })),
      getProviderConfig: vi.fn(() => ({ baseUrl: 'https://api.example.test' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, { fetchImpl, httpsRequest, resolveHost })

    try {
      const result = await generator.generateImage('供应商只返回可下载 URL 的图片', {
        image_provider: 'agnes-image',
        runId: 'provider-url-image',
      })

      expect(fetchImpl).not.toHaveBeenCalled()
      expect(httpsRequest).toHaveBeenCalledWith(
        expect.objectContaining({ hostname: 'cdn.example.test' }),
        expect.objectContaining({ lookup: expect.any(Function) }),
        expect.any(Function),
      )
      expect(lookupResult).toEqual({ address: '8.8.8.8', family: 4 })
      expect(resolveHost).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        code: 0,
        data: { source: 'model-provider', degraded: false },
      })
      expect(fs.readFileSync(result.data.path)).toEqual(PNG_BYTES)
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('times out an unresolved provider image hostname before creating an HTTPS request', async () => {
    const fetchImpl = vi.fn()
    const resolveHost = vi.fn(() => new Promise(() => {}))
    const httpsRequest = vi.fn()
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: ['https://timeout.example.test/generated.png'] })),
      getProviderConfig: vi.fn(() => ({ baseUrl: 'https://api.example.test' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, {
      fetchImpl,
      resolveHost,
      httpsRequest,
      providerImageTimeoutMs: 10,
    })

    try {
      const result = await generator.generateImage('DNS 长时间无响应不能卡住流水线', {
        image_provider: 'remote-provider',
        runId: 'dns-resolution-timeout',
      })

      expect(result.code).toBeLessThan(0)
      expect(result.message).toMatch(/DNS lookup timed out/i)
      expect(resolveHost).toHaveBeenCalledTimes(1)
      expect(httpsRequest).not.toHaveBeenCalled()
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('enforces a total timeout when a remote HTTPS image response never completes', async () => {
    const fetchImpl = vi.fn()
    const resolveHost = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }])
    let request
    const httpsRequest = vi.fn((url, options, onResponse) => {
      request = new EventEmitter()
      request.setTimeout = vi.fn()
      request.end = vi.fn()
      request.destroy = vi.fn((error) => {
        if (error) queueMicrotask(() => request.emit('error', error))
      })
      queueMicrotask(() => {
        options.lookup('slow.example.test', { family: 0 }, (error) => {
          if (error) return request.emit('error', error)
          const response = new EventEmitter()
          response.statusCode = 200
          response.headers = { 'content-type': 'image/png' }
          response.resume = vi.fn()
          onResponse(response)
        })
      })
      return request
    })
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: ['https://slow.example.test/generated.png'] })),
      getProviderConfig: vi.fn(() => ({ baseUrl: 'https://api.example.test' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, {
      fetchImpl,
      resolveHost,
      httpsRequest,
      providerImageTimeoutMs: 10,
    })

    try {
      const result = await generator.generateImage('慢速响应不能无限占用流水线', {
        image_provider: 'remote-provider',
        runId: 'https-total-timeout',
      })

      expect(result.code).toBeLessThan(0)
      expect(result.message).toMatch(/download timed out/i)
      expect(request.setTimeout).toHaveBeenCalledWith(expect.any(Number), expect.any(Function))
      expect(request.setTimeout.mock.calls[0][0]).toBeGreaterThanOrEqual(1)
      expect(request.setTimeout.mock.calls[0][0]).toBeLessThanOrEqual(10)
      expect(request.destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'provider image download timed out' }))
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('blocks a DNS rebinding target before a provider image HTTPS request is created', async () => {
    const fetchImpl = vi.fn()
    const resolveHost = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }])
    const httpsRequest = vi.fn((url, options) => {
      const request = new EventEmitter()
      request.setTimeout = vi.fn()
      request.end = vi.fn()
      request.destroy = vi.fn((error) => {
        if (error) queueMicrotask(() => request.emit('error', error))
      })
      queueMicrotask(() => options.lookup('rebind.example.test', { family: 0 }, (error) => {
        request.emit('error', error || new Error('test lookup should have been blocked'))
      }))
      return request
    })
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: ['https://rebind.example.test/generated.png'] })),
      getProviderConfig: vi.fn(() => ({ baseUrl: 'https://api.example.test' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, { fetchImpl, httpsRequest, resolveHost })

    try {
      const result = await generator.generateImage('DNS 重绑定不能访问本地服务', {
        image_provider: 'remote-provider',
        runId: 'dns-rebinding',
      })

      expect(result.code).toBeLessThan(0)
      expect(result.message).toMatch(/blocked network address/i)
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(httpsRequest).not.toHaveBeenCalled()
      expect(resolveHost).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('blocks non-global IPv4 and IPv6 ranges before downloading a provider image', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '192.0.2.1',
      '192.31.196.1',
      '192.52.193.1',
      '192.88.99.1',
      '192.168.1.1',
      '192.175.48.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '::1',
      'fc00::1',
      'fe80::1',
      '64:ff9b::7f00:1',
      '64:ff9b:1::1',
      '2001::1',
      '2001:10::1',
      '2001:20::1',
      '2001:db8::1',
      '2002::1',
      '3fff::1',
      '5f00::1',
    ]) {
      expect(isPrivateAddress(address)).toBe(true)
    }

    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('pins a verified public address when the HTTPS client asks to resolve the host more than once', async () => {
    const fetchImpl = vi.fn()
    const resolveHost = vi.fn()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    const lookupResults = []
    const httpsRequest = vi.fn((url, options, onResponse) => {
      const request = new EventEmitter()
      request.setTimeout = vi.fn()
      request.end = vi.fn()
      request.destroy = vi.fn((error) => {
        if (error) queueMicrotask(() => request.emit('error', error))
      })
      queueMicrotask(() => {
        options.lookup('pin.example.test', { family: 0 }, (firstError, firstAddress, firstFamily) => {
          if (firstError) return request.emit('error', firstError)
          lookupResults.push({ address: firstAddress, family: firstFamily })
          options.lookup('pin.example.test', { family: 0 }, (secondError, secondAddress, secondFamily) => {
            if (secondError) return request.emit('error', secondError)
            lookupResults.push({ address: secondAddress, family: secondFamily })
            const response = new EventEmitter()
            response.statusCode = 200
            response.headers = {
              'content-type': 'image/png',
              'content-length': String(PNG_BYTES.length),
            }
            response.resume = vi.fn()
            onResponse(response)
            response.emit('data', PNG_BYTES)
            response.emit('end')
          })
        })
      })
      return request
    })
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: ['https://pin.example.test/generated.png'] })),
      getProviderConfig: vi.fn(() => ({ baseUrl: 'https://api.example.test' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, { fetchImpl, httpsRequest, resolveHost })

    try {
      const result = await generator.generateImage('同一请求的 DNS 结果必须固定', {
        image_provider: 'remote-provider',
        runId: 'pinned-dns-address',
      })

      expect(result.code).toBe(0)
      expect(resolveHost).toHaveBeenCalledTimes(1)
      expect(lookupResults).toEqual([
        { address: '8.8.8.8', family: 4 },
        { address: '8.8.8.8', family: 4 },
      ])
      expect(httpsRequest).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ agent: false, lookup: expect.any(Function) }),
        expect.any(Function),
      )
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('rejects a provider URL that targets an unapproved local service before fetching it', async () => {
    const fetchImpl = vi.fn()
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: ['http://127.0.0.1:9222/private.png'] })),
      getProviderConfig: vi.fn(() => ({ baseUrl: 'https://api.example.test' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, { fetchImpl })

    try {
      const result = await generator.generateImage('不应访问本机调试端口', {
        image_provider: 'remote-provider',
        runId: 'blocked-local-url',
      })

      expect(result.code).toBeLessThan(0)
      expect(result.message).toMatch(/approved local provider endpoint/i)
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('does not mistake a 127-prefixed DNS name for an approved local provider endpoint', async () => {
    const fetchImpl = vi.fn()
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: ['http://127.attacker.example:7860/generated.png'] })),
      getProviderConfig: vi.fn(() => ({ baseUrl: 'http://127.0.0.1:7860' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, { fetchImpl })

    try {
      const result = await generator.generateImage('伪装本机地址不能绕过 Provider 下载边界', {
        image_provider: 'remote-provider',
        runId: 'spoofed-loopback-hostname',
      })

      expect(result.code).toBeLessThan(0)
      expect(result.message).toMatch(/must use HTTPS/i)
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('rejects a different loopback host from the configured provider endpoint', async () => {
    const fetchImpl = vi.fn()
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: ['http://127.0.0.2:7860/generated.png'] })),
      getProviderConfig: vi.fn(() => ({ baseUrl: 'http://127.0.0.1:7860' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, { fetchImpl })

    try {
      const result = await generator.generateImage('本机 Provider 不应跨 endpoint 下载图片', {
        image_provider: 'remote-provider',
        runId: 'different-loopback-host',
      })

      expect(result.code).toBeLessThan(0)
      expect(result.message).toMatch(/approved local provider endpoint/i)
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('stops an oversized streamed image from an approved local provider before buffering the whole response', async () => {
    const reader = {
      read: vi.fn().mockResolvedValueOnce({
        done: false,
        value: Buffer.alloc((25 * 1024 * 1024) + 1),
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    }
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: vi.fn(() => null) },
      body: { getReader: vi.fn(() => reader) },
    }))
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: ['http://127.0.0.1:7860/generated.png'] })),
      getProviderConfig: vi.fn(() => ({ baseUrl: 'http://127.0.0.1:7860' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, { fetchImpl })

    try {
      const result = await generator.generateImage('本机 Provider 超大流不应耗尽内存', {
        image_provider: 'local-provider',
        runId: 'oversized-local-provider-stream',
      })

      expect(result.code).toBeLessThan(0)
      expect(result.message).toMatch(/exceeds the allowed size/i)
      expect(reader.read).toHaveBeenCalledTimes(1)
      expect(reader.cancel).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('writes binary TTS output from the configured provider and preserves its audio format', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => ({ audio: WAV_BYTES, format: 'wav', model: 'piper' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateTTS('这是一个可听见的旁白。', {
        voice_provider: 'piper',
        index: 1,
        runId: 'provider-tts',
      })

      expect(aiGenerator.generate).toHaveBeenCalledWith(
        'tts',
        'piper',
        expect.objectContaining({ text: '这是一个可听见的旁白。', input: '这是一个可听见的旁白。' }),
      )
      expect(result).toMatchObject({
        code: 0,
        data: {
          provider: 'piper',
          source: 'model-provider',
          degraded: false,
          format: 'wav',
        },
      })
      expect(result.data.path).toMatch(/\.wav$/)
      expect(fs.readFileSync(result.data.path)).toEqual(WAV_BYTES)
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('passes the adapter-compatible voiceId and outputFormat fields to a configured TTS provider', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => ({ audio: WAV_BYTES, format: 'mp3', model: 'eleven_multilingual_v2' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateTTS('这段旁白必须使用指定音色。', {
        voice_provider: 'elevenlabs',
        voice_id: 'voice-123',
        audio_format: 'mp3_44100_128',
        runId: 'elevenlabs-fields',
      })

      expect(aiGenerator.generate).toHaveBeenCalledWith(
        'tts',
        'elevenlabs',
        expect.objectContaining({
          voice: 'voice-123',
          voice_id: 'voice-123',
          voiceId: 'voice-123',
          voiceName: 'voice-123',
          outputFormat: 'mp3_44100_128',
        }),
      )
      expect(result.code).toBe(0)
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('does not persist raw PCM as a usable narration when conversion is unavailable', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => ({ audio: Buffer.alloc(48, 1), format: 'pcm_24000' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, { ffmpeg: null })

    try {
      const result = await generator.generateTTS('原始 PCM 必须先转码。', {
        voice_provider: 'elevenlabs',
        voice_id: 'voice-123',
        runId: 'pcm-needs-conversion',
      })

      expect(result.code).toBeLessThan(0)
      expect(result.message).toMatch(/PCM.*ffmpeg/i)
      expect(fs.readdirSync(path.join(outputDir, 'pcm-needs-conversion'))).toEqual([])
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('does not silently replace an explicitly selected provider failure with a placeholder image', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => { throw new Error('provider unavailable') }),
    }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateImage('雪山下的湖泊', {
        image_provider: 'openai-image',
        index: 0,
        runId: 'provider-failure',
      })

      expect(result.code).toBeLessThan(0)
      expect(result.message).toMatch(/dall-e.*provider unavailable/i)
      expect(fs.readdirSync(path.join(outputDir, 'provider-failure'))).toEqual([])
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })
})

describe('AssetGenerator DNS lookup compatibility', () => {
  it('returns a pinned address array when Node requests lookup with all=true', async () => {
    const resolveHost = vi.fn(async () => [{ address: '8.8.4.4', family: 4 }])
    const httpsRequest = vi.fn((url, options, onResponse) => {
      const request = new EventEmitter()
      request.setTimeout = vi.fn()
      request.end = vi.fn()
      request.destroy = vi.fn((error) => {
        if (error) queueMicrotask(() => request.emit('error', error))
      })
      queueMicrotask(() => {
        options.lookup('auto-family.example.test', { family: 0, all: true }, (error, addresses) => {
          if (error) return request.emit('error', error)
          if (!Array.isArray(addresses) || addresses.length !== 1) {
            return request.emit('error', new Error('custom lookup must return addresses when all=true'))
          }
          const response = new EventEmitter()
          response.statusCode = 200
          response.headers = {
            'content-type': 'image/png',
            'content-length': String(PNG_BYTES.length),
          }
          response.resume = vi.fn()
          onResponse(response)
          response.emit('data', PNG_BYTES)
          response.emit('end')
        })
      })
      return request
    })
    const aiGenerator = {
      generate: vi.fn(async () => ({ urls: ['https://auto-family.example.test/generated.png'] })),
      getProviderConfig: vi.fn(() => ({ baseUrl: 'https://api.example.test' })),
    }
    const { generator, outputDir } = createGenerator(aiGenerator, { httpsRequest, resolveHost })

    try {
      const result = await generator.generateImage('Node 22 自动地址选择必须保留固定 DNS 地址', {
        image_provider: 'remote-provider',
        runId: 'lookup-all-true',
      })

      expect(result).toMatchObject({
        code: 0,
        data: { source: 'model-provider', degraded: false },
      })
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })
})

describe('AssetGenerator content-policy image retry', () => {
  it('retries a strict content-policy rejection with a scene-safe rewrite and records only safe attempt metadata', async () => {
    const rawPrompt = '不应出现在审计元数据中的原始场景描述'
    const aiGenerator = {
      generate: vi.fn()
        .mockRejectedValueOnce(new ProviderError(ERROR_CODES.CONTENT_POLICY, 'content_policy_violation'))
        .mockResolvedValueOnce({ images: [{ b64_json: PNG_BYTES.toString('base64') }] }),
    }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateImage(rawPrompt, {
        image_provider: 'local-diffusion',
        index: 1,
        runId: 'content-policy-rewrite',
      })

      expect(result).toMatchObject({
        code: 0,
        data: {
          source: 'model-provider',
          degraded: false,
          generationAttempts: [
            expect.objectContaining({ attempt: 1, outcome: 'content_policy_rejected', sceneNumber: 2 }),
            expect.objectContaining({ attempt: 2, outcome: 'success', sceneNumber: 2 }),
          ],
        },
      })
      expect(aiGenerator.generate).toHaveBeenCalledTimes(2)
      expect(aiGenerator.generate.mock.calls[1][2].prompt).toContain(rawPrompt)
      expect(JSON.stringify(result.data.generationAttempts)).not.toContain(rawPrompt)
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('does not retry a provider rate-limit failure or replace it with a placeholder', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => {
        throw new ProviderError(ERROR_CODES.RATE_LIMITED, 'rate limited')
      }),
    }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateImage('普通场景', {
        image_provider: 'local-diffusion',
        index: 0,
        runId: 'rate-limit-no-retry',
      })

      expect(result.code).toBeLessThan(0)
      expect(result).not.toHaveProperty('needsUserInput', true)
      expect(aiGenerator.generate).toHaveBeenCalledTimes(1)
      expect(result.data.generationAttempts).toEqual([
        expect.objectContaining({ attempt: 1, outcome: 'failed', category: 'rate' }),
      ])
      expect(fs.readdirSync(path.join(outputDir, 'rate-limit-no-retry'))).toEqual([])
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('returns needsUserInput after five content-policy rejections without generating a placeholder image', async () => {
    const aiGenerator = {
      generate: vi.fn(async () => {
        throw new ProviderError(ERROR_CODES.CONTENT_POLICY, 'content_policy_violation')
      }),
    }
    const { generator, outputDir } = createGenerator(aiGenerator)

    try {
      const result = await generator.generateImage('需要用户改写的场景', {
        image_provider: 'local-diffusion',
        index: 2,
        runId: 'content-policy-exhausted',
      })

      expect(aiGenerator.generate).toHaveBeenCalledTimes(5)
      expect(result).toMatchObject({
        code: -1,
        needsUserInput: true,
        checkpoint: {
          type: 'needs_user_input',
          reason: 'content_policy',
          sceneIndex: 2,
          sceneNumber: 3,
          attempts: 5,
        },
      })
      expect(result.data.generationAttempts).toHaveLength(5)
      expect(fs.readdirSync(path.join(outputDir, 'content-policy-exhausted'))).toEqual([])
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  describe('MiMo 克隆音色样本注入（2026-09-18）', () => {
    it('mimo-tts + mimo-clone- 音色时读取本地样本注入 cloneSampleData', async () => {
      const aiGenerator = {
        generate: vi.fn(async () => ({
          audio: WAV_BYTES,
          format: 'wav',
          model: 'mimo-v2.5-tts-voiceclone',
        })),
      }
      // 构造克隆样本目录 + 样本文件
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-mimo-clone-'))
      const sampleRelDir = 'voice-clone-samples/ownerhash/storage1'
      const sampleDir = path.join(userDataDir, sampleRelDir)
      fs.mkdirSync(sampleDir, { recursive: true })
      fs.writeFileSync(path.join(sampleDir, 'sample-01.mp3'), WAV_BYTES)
      const ttsVoiceCloneService = {
        findCloneSamples: vi.fn(async () => ({
          sampleStorage: { relativeDir: sampleRelDir, sampleCount: 1 },
          name: '音色001',
          model: 'mimo-v2.5-tts-voiceclone',
        })),
        _resolveUserDataPath: () => userDataDir,
      }
      const { generator, outputDir } = createGenerator(aiGenerator, { ttsVoiceCloneService })

      try {
        const result = await generator.generateTTS('测试旁白', {
          voice_id: 'mimo-clone-abc-123',
          voice_provider: 'mimo-tts',
          voice_model: 'mimo-v2.5-tts-voiceclone',
          index: 0,
          runId: 'mimo-clone-inject',
        })

        expect(result.code).toBe(0)
        // 验证传给 adapter 的参数包含 cloneSampleData（data URI）
        const ttsParams = aiGenerator.generate.mock.calls[0][2]
        expect(ttsParams.cloneSampleData).toMatch(/^data:audio\/mpeg;base64,/)
        expect(ttsParams.cloneSampleData.length).toBeGreaterThan(30)
        expect(ttsParams.voice_id).toBe('mimo-clone-abc-123')
      } finally {
        fs.rmSync(outputDir, { recursive: true, force: true })
        fs.rmSync(userDataDir, { recursive: true, force: true })
      }
    })

    it('mimo-tts + 克隆音色但样本缺失时 fail closed（INVALID_CONFIG）', async () => {
      const aiGenerator = {
        generate: vi.fn(async () => ({})),
      }
      const ttsVoiceCloneService = {
        findCloneSamples: vi.fn(async () => null),
        _resolveUserDataPath: () => '/nonexistent',
      }
      const { generator, outputDir } = createGenerator(aiGenerator, { ttsVoiceCloneService })

      try {
        await expect(generator.generateTTS('测试', {
          voice_id: 'mimo-clone-abc-123',
          voice_provider: 'mimo-tts',
          index: 0,
          runId: 'mimo-clone-missing',
        })).rejects.toThrow(/样本缺失/)
      } finally {
        fs.rmSync(outputDir, { recursive: true, force: true })
      }
    })

    it('非 mimo provider 不注入 cloneSampleData（行为不变）', async () => {
      const aiGenerator = {
        generate: vi.fn(async () => ({
          audio: WAV_BYTES,
          format: 'wav',
          model: 'speech-2.8-turbo',
        })),
      }
      const { generator, outputDir } = createGenerator(aiGenerator)

      try {
        const result = await generator.generateTTS('测试', {
          voice_id: 'male-qn-qingse',
          voice_provider: 'minimax-tts',
          voice_model: 'speech-2.8-turbo',
          index: 0,
          runId: 'minimax-no-inject',
        })
        expect(result.code).toBe(0)
        const ttsParams = aiGenerator.generate.mock.calls[0][2]
        expect(ttsParams.cloneSampleData).toBeUndefined()
      } finally {
        fs.rmSync(outputDir, { recursive: true, force: true })
      }
    })
  })
})
