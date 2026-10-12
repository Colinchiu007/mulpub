import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const MOD = path.resolve(__dirname, 'podcast-episode-tts-adapters.js')
async function load () { return import(MOD) }

const REF = { providerId: 'openai-tts', model: 'tts-1', voiceId: 'alloy' }

describe('createGenerateTTS：降级不得被消费成成功', () => {
  it('缺 assetGenerator 立刻抛，不静默降级成"没有 provider"', async () => {
    const { createGenerateTTS, ADAPTER_ERRORS } = await load()
    try { createGenerateTTS({}); throw new Error('should-not-reach') } catch (e) {
      expect(e.code).toBe(ADAPTER_ERRORS.ARGS_MISSING)
    }
  })

  it('入参键名同时给 camelCase 与 snake_case（缺一即静默丢音色）', async () => {
    const { createGenerateTTS } = await load()
    const generateTTS = vi.fn(async () => ({ code: 0, data: { path: '/a.mp3', degraded: false } }))
    const fn = createGenerateTTS({ assetGenerator: { generateTTS } })
    await fn({ text: '你好', index: 2, voiceRef: REF })
    const opts = generateTTS.mock.calls[0][1]
    expect(opts.voiceId).toBe('alloy')
    expect(opts.voice_id).toBe('alloy')
    expect(opts.providerId).toBe('openai-tts')
    expect(opts.index).toBe(2)
    expect(generateTTS.mock.calls[0][0]).toBe('你好')
  })

  it('degraded:true 原样如实回显（不得被抹成成功）', async () => {
    const { createGenerateTTS } = await load()
    const fn = createGenerateTTS({ assetGenerator: { generateTTS: async () => ({ code: 0, data: { path: '/s.mp3', degraded: true } }) } })
    const r = await fn({ text: 'x', voiceRef: REF })
    expect(r.degraded).toBe(true)
    expect(r.path).toBe('/s.mp3')
  })

  it('degraded 字段缺席 ⇒ 判降级（未知形状不当成功）', async () => {
    const { createGenerateTTS } = await load()
    const fn = createGenerateTTS({ assetGenerator: { generateTTS: async () => ({ code: 0, data: { path: '/x.mp3' } }) } })
    expect((await fn({ text: 'x', voiceRef: REF })).degraded).toBe(true)
  })

  it('code 非 0 / data 缺席 / path 空 ⇒ provider_failed 且 degraded', async () => {
    const { createGenerateTTS } = await load()
    for (const res of [{ code: -1, message: 'boom' }, { code: 0 }, { code: 0, data: { path: '' } }]) {
      const fn = createGenerateTTS({ assetGenerator: { generateTTS: async () => res } })
      const r = await fn({ text: 'x', voiceRef: REF })
      expect(r.degraded).toBe(true)
      expect(r.reason).toBe('provider_failed')
    }
  })

  it('provider 抛错 ⇒ invoke_failed，不把异常冒泡给合成层去猜', async () => {
    const { createGenerateTTS } = await load()
    const fn = createGenerateTTS({ assetGenerator: { generateTTS: async () => { throw new Error('E_CONN') } } })
    const r = await fn({ text: 'x', voiceRef: REF })
    expect(r.degraded).toBe(true)
    expect(r.reason).toBe('invoke_failed')
  })
})

describe('createVoiceReaders：只接线不判定', () => {
  it('偏好键逐字为 tts-voice-preference:v1:<provider>:<model>', async () => {
    const { createVoiceReaders } = await load()
    const readSetting = vi.fn(() => null)
    const cap = vi.fn(() => ({ defaultVoiceId: null }))
    const r = createVoiceReaders({ readSetting, getVoiceCapability: cap })
    r.readPreference('openai-tts', 'tts-1')
    expect(readSetting.mock.calls[0][0]).toBe('tts-voice-preference:v1:openai-tts:tts-1')
    expect(r.getCapability('openai-tts', 'tts-1')).toEqual({ defaultVoiceId: null })
    expect(cap).toHaveBeenCalledWith('openai-tts', 'tts-1')
  })

  it('两个读取实现缺一即抛', async () => {
    const { createVoiceReaders } = await load()
    expect(() => createVoiceReaders({ readSetting: () => null })).toThrow()
    expect(() => createVoiceReaders({ getVoiceCapability: () => null })).toThrow()
  })
})

describe('createConcatBlocks：块间静音预物化 + 路径逐字一致', () => {
  function fx (over = {}) {
    const written = []
    const fsImpl = over.fsImpl || {
      writeFileSync: (p, b) => written.push({ p, b }),
      existsSync: over.existsSync || (() => true),
      unlinkSync: () => {},
    }
    const spawnImpl = over.spawnImpl || vi.fn(async () => ({ code: 0 }))
    return { fn: null, written, spawnImpl, fsImpl, over }
  }

  it('产物路径必须逐字等于 outPath（合成层按它拒绝）', async () => {
    const { createConcatBlocks } = await load()
    const b = fx()
    const fn = createConcatBlocks({ ffmpegPath: '/ff', spawnImpl: b.spawnImpl, fsImpl: b.fsImpl })
    const r = await fn({ paths: ['/a.mp3', '/b.mp3'], gapSec: 0.4, outPath: '/out.mp3' })
    expect(r.path).toBe('/out.mp3')
    const concatCall = b.spawnImpl.mock.calls[b.spawnImpl.mock.calls.length - 1][0]
    expect(concatCall.args).toContain('/out.mp3')
    expect(concatCall.args[concatCall.args.indexOf('-f') + 1]).toBe('concat')
    expect(b.spawnImpl.mock.calls[0][0].command).toBe('/ff')
  })

  it('列表内容按 concat demuxer 转义单引号（路径带引号不得破坏列表）', async () => {
    const { createConcatBlocks } = await load()
    const b = fx()
    const fn = createConcatBlocks({ ffmpegPath: '/ff', spawnImpl: b.spawnImpl, fsImpl: b.fsImpl })
    await fn({ paths: ["/it's.mp3"], outPath: '/out.mp3' })
    expect(b.written[0].b).toBe("file '/it'\\''s.mp3'" + String.fromCharCode(10))
  })

  it('spawn 非 0 或产物不存在 ⇒ PODCAST_TTS_CONCAT_FAILED（不得返回半成品）', async () => {
    const { createConcatBlocks, ADAPTER_ERRORS } = await load()
    for (const over of [{ spawnImpl: async () => ({ code: 1 }) }, { spawnImpl: async () => ({ code: 0 }), existsSync: () => false }]) {
      const b = fx(over)
      const fn = createConcatBlocks({ ffmpegPath: '/ff', spawnImpl: over.spawnImpl, fsImpl: b.fsImpl })
      await expect(fn({ paths: ['/a.mp3'], outPath: '/out.mp3' })).rejects.toMatchObject({ code: ADAPTER_ERRORS.CONCAT_FAILED })
    }
  })

  it('空块列表直接拒绝，不产出 0 块的成功', async () => {
    const { createConcatBlocks, ADAPTER_ERRORS } = await load()
    const b = fx()
    const fn = createConcatBlocks({ ffmpegPath: '/ff', spawnImpl: b.spawnImpl, fsImpl: b.fsImpl })
    await expect(fn({ paths: [], outPath: '/out.mp3' })).rejects.toMatchObject({ code: ADAPTER_ERRORS.CONCAT_FAILED })
  })
})

describe('createProbeImpl：只认这次实测', () => {
  const ok = { code: 0, stdout: 'duration=37.500000\nsize=600000\n' }
  it('解析出 durationSec 与 sizeBytes', async () => {
    const { createProbeImpl } = await load()
    const fn = createProbeImpl({ ffprobePath: '/fp', spawnImpl: async () => ok, fsImpl: { existsSync: () => true } })
    const r = await fn('/out.mp3')
    expect(r.durationSec).toBe(37.5)
    expect(r.sizeBytes).toBe(600000)
  })

  it('无 duration / 时长 0 / 抛错 ⇒ PODCAST_TTS_AUDIO_TOO_SHORT（不得回落到申报值）', async () => {
    const { createProbeImpl, ADAPTER_ERRORS } = await load()
    for (const sp of [async () => ({ code: 0, stdout: 'size=1\n' }), async () => ({ code: 0, stdout: 'duration=0\nsize=1\n' }), async () => { throw new Error('x') }]) {
      const fn = createProbeImpl({ ffprobePath: '/fp', spawnImpl: sp })
      await expect(fn('/out.mp3')).rejects.toMatchObject({ code: ADAPTER_ERRORS.PROBE_FAILED })
    }
  })

  it('size 缺席时如实不填（合成层以磁盘 stat 为字节唯一权威）', async () => {
    const { createProbeImpl } = await load()
    const fn = createProbeImpl({ ffprobePath: '/fp', spawnImpl: async () => ({ code: 0, stdout: 'duration=3\n' }) })
    expect((await fn('/o.mp3')).sizeBytes).toBeUndefined()
  })
})

describe('结构锁：本适配层不得自带出站或第二份判据', () => {
  it('不 require child_process / 不 import provider，且四个工厂都在位', async () => {
    await load()
    const src = fs.readFileSync(MOD, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).not.toMatch(/node:child_process/)
    expect(src).not.toMatch(/require\(['"]@multi-publish/)
    expect(src).not.toMatch(/backgroundThrottling/)
    for (const k of ['createGenerateTTS', 'createVoiceReaders', 'createConcatBlocks', 'createProbeImpl']) {
      expect(src).toContain('function ' + k)
    }
  })
})

describe('createConcatBlocks 回归锁：gapSec 必须真的参与拼接（2026-10-12 QM-6 后端评审 Critical）', () => {
  function fx2 () {
    const written = []
    const calls = []
    const fsImpl = {
      writeFileSync: (p, b) => written.push({ p, b }),
      existsSync: () => true,
      unlinkSync: () => {},
    }
    const spawnImpl = vi.fn(async ({ args }) => { calls.push(args); return { code: 0 } })
    return { written, calls, fn: null, fsImpl, spawnImpl }
  }

  it('两块 + gapSec=0.4 ⇒ 列表为 块/静音/块，静音片段先用 anullsrc 物化', async () => {
    const { createConcatBlocks } = await load()
    const b = fx2()
    const fn = createConcatBlocks({ ffmpegPath: '/ff', spawnImpl: b.spawnImpl, fsImpl: b.fsImpl })
    const r = await fn({ paths: ['/a.mp3', '/b.mp3'], gapSec: 0.4, outPath: '/out.mp3' })
    expect(r.gapInserted).toBe(true)
    expect(r.gapSec).toBe(0.4)
    expect(b.calls[0]).toContain('anullsrc=channel_layout=mono:sample_rate=44100')
    expect(b.calls[0]).toContain('0.4')
    expect(b.written[0].b.split(String.fromCharCode(10))[0]).toContain('/a.mp3')
    expect(b.written[0].b).toContain('/out.mp3.gap.mp3')
    const lines = b.written[0].b.trim().split(String.fromCharCode(10))
    expect(lines.length).toBe(3)
    expect(lines[1]).toContain('gap.mp3')
  })

  it('单块不生成静音片段（没有块间可言），spawn 只被调一次', async () => {
    const { createConcatBlocks } = await load()
    const b = fx2()
    const fn = createConcatBlocks({ ffmpegPath: '/ff', spawnImpl: b.spawnImpl, fsImpl: b.fsImpl })
    const r = await fn({ paths: ['/a.mp3'], gapSec: 0.4, outPath: '/out.mp3' })
    expect(r.gapInserted).toBe(false)
    expect(b.spawnImpl).toHaveBeenCalledTimes(1)
  })

  it('静音片段生成失败 ⇒ 拒绝整次拼接，不得静默退化成无间隔', async () => {
    const { createConcatBlocks, ADAPTER_ERRORS } = await load()
    const written = []
    const fsImpl = { writeFileSync: (p, x) => written.push(p), existsSync: () => false, unlinkSync: () => {} }
    const spawnImpl = vi.fn(async () => ({ code: 0 }))
    const fn = createConcatBlocks({ ffmpegPath: '/ff', spawnImpl, fsImpl })
    await expect(fn({ paths: ['/a.mp3', '/b.mp3'], gapSec: 0.4, outPath: '/out.mp3' }))
      .rejects.toMatchObject({ code: ADAPTER_ERRORS.CONCAT_FAILED })
    expect(written.length).toBe(0)
  })

  it('gapSec 为 0 / 缺失 ⇒ 不插静音（合成层默认值由它自己负责，本层不猜）', async () => {
    const { createConcatBlocks } = await load()
    const b = fx2()
    const fn = createConcatBlocks({ ffmpegPath: '/ff', spawnImpl: b.spawnImpl, fsImpl: b.fsImpl })
    const r = await fn({ paths: ['/a.mp3', '/b.mp3'], outPath: '/out.mp3' })
    expect(r.gapInserted).toBe(false)
    expect(b.written[0].b.trim().split(String.fromCharCode(10)).length).toBe(2)
  })
})

describe('createGenerateTTS 回归锁：路由键必须同时给（2026-10-12 QM-6 后端评审 High）', () => {
  it('opts 含 voice_provider / voiceProvider / voice_model / voiceModel —— 只给 providerId/model 时 AssetGenerator 认不出 provider，会静默落到 edge 兜底', async () => {
    const { createGenerateTTS } = await load()
    const generateTTS = vi.fn(async () => ({ code: 0, data: { path: '/a.mp3', degraded: false } }))
    const fn = createGenerateTTS({ assetGenerator: { generateTTS } })
    await fn({ text: 'x', index: 0, voiceRef: { providerId: 'openai-tts', model: 'tts-1', voiceId: 'alloy' } })
    const opts = generateTTS.mock.calls[0][1]
    expect(opts.voice_provider).toBe('openai-tts')
    expect(opts.voiceProvider).toBe('openai-tts')
    expect(opts.voice_model).toBe('tts-1')
    expect(opts.voiceModel).toBe('tts-1')
    // getConfiguredProvider 的形态判据：非 [a-zA-Z0-9_-]{1,80} 的值不得被当 provider 传下去
    expect(typeof opts.voice_provider).toBe('string')
  })
})

describe('createConcatBlocks 回归锁：Windows 反斜杠必须先归一（Medium，与 _plainConcat 同口径）', () => {
  it('列表里的路径先把反斜杠归成正斜杠，且不破坏单引号转义', async () => {
    const { createConcatBlocks } = await load()
    const written = []
    const fsImpl = { writeFileSync: (p, b) => written.push(b), existsSync: () => true, unlinkSync: () => {} }
    const fn = createConcatBlocks({ ffmpegPath: 'C:\ff\ffmpeg.exe', spawnImpl: async () => ({ code: 0 }), fsImpl })
    const BSL = String.fromCharCode(92)
    await fn({ paths: ['C:' + BSL + 'tmp' + BSL + 'a.mp3', 'C:' + BSL + 'tmp' + BSL + "it's.mp3"], outPath: 'C:' + BSL + 'tmp' + BSL + 'out.mp3' })
    const body = written[0]
    expect(body).not.toContain(BSL + 'tmp')
    expect(body).toContain("file 'C:/tmp/a.mp3'")
    expect(body).toContain("file 'C:/tmp/it'\\''s.mp3'")
  })
})
