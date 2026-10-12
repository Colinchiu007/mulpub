import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const MOD = path.resolve(__dirname, 'podcast-episode-tts-run.js')

async function load () { return import(MOD) }

/** 三层真源都走真实实现（本层无状态，import/require 双份实例的坑不适用于纯函数模块）。 */
const CHANNEL_REF = { providerId: 'openai-tts', model: 'tts-1', voiceId: 'alloy' }
const DEPS_OK = {
  readPreference: () => null,
  getCapability: (providerId, model) => ({ providerId, model, defaultVoiceId: null, voices: [] }),
}

function content (n) {
  let s = ''
  for (let i = 0; i < n; i++) s += '句子' + i + '。'
  return s
}

function synthDeps (over = {}) {
  const generateTTS = over.generateTTS || vi.fn(async ({ text }) => ({ path: 'blk-' + text.length + '.mp3' }))
  const concatBlocks = over.concatBlocks || vi.fn(async ({ outPath }) => ({ path: outPath, mime: 'audio/mpeg' }))
  const probeImpl = over.probeImpl || vi.fn(async () => ({ durationSec: 120, sizeBytes: 4096 }))
  const fsImpl = over.fsImpl || { existsSync: () => true, statSync: () => ({ size: 4096 }) }
  const invokeLlm = over.invokeLlm || vi.fn(async () => null)
  return { ...DEPS_OK, generateTTS, concatBlocks, probeImpl, fsImpl, invokeLlm, logger: over.logger || { info () {}, warn () {}, error () {} } }
}

describe('刀4 第3片·下半：出期编排层 prepareEpisodeTtsRun（零出站）', () => {
  it('缺 readPreference / getCapability 一律 INVALID_ARGS，不猜音色', async () => {
    const { prepareEpisodeTtsRun, RUN_ERRORS } = await load()
    const r = prepareEpisodeTtsRun({ content: content(20), channel: { voiceRef: CHANNEL_REF } }, {})
    expect(r.ok).toBe(false)
    expect(r.code).toBe(RUN_ERRORS.INVALID_ARGS)
    expect(r.issues[0].path).toBe('tts.deps')
  })

  it('空文案走分块层的既有码，不在本层新立一个码', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const { TTS_COMPOSE_ERRORS } = require('./podcast-tts-compose')
    const r = prepareEpisodeTtsRun({ content: '   ', channel: { voiceRef: CHANNEL_REF } }, DEPS_OK)
    expect(r.ok).toBe(false)
    expect(r.code).toBe(TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT)
    expect(r.issues[0].path).toBe('copy.content')
  })

  it('音色解析失败逐字透传 code 与 issues.path（本层不得重新包码）', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const half = { providerId: 'openai-tts', model: 'tts-1' }
    const r = prepareEpisodeTtsRun({ content: content(20), channel: { voiceRef: half } }, DEPS_OK)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    expect(Array.isArray(r.issues)).toBe(true)
    expect(r.issues[0].path).toBe('voiceRef')
  })

  it('频道三段齐备 ⇒ origin=channel，且 voice 形状沿用音色层（不另包一层）', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const r = prepareEpisodeTtsRun({ content: content(30), channel: { voiceRef: CHANNEL_REF } }, DEPS_OK)
    expect(r.ok).toBe(true)
    expect(r.voice.origin).toBe('channel')
    expect(r.voice.providerId).toBe('openai-tts')
    expect(r.voice.voiceId).toBe('alloy')
    expect(r.voice.voice).toBeUndefined()
  })

  it('estimate 只含展示量：码点/块数/时长区间，且不含任何判据字段', async () => {
    const { prepareEpisodeTtsRun, ESTIMATE_CP_PER_SEC } = await load()
    const c = content(40)
    const r = prepareEpisodeTtsRun({ content: c, channel: { voiceRef: CHANNEL_REF } }, DEPS_OK)
    const { cpLen } = require('./podcast-tts-compose')
    expect(r.estimate.codepoints).toBe(cpLen(c))
    expect(r.estimate.blocks).toBe(r.chunks.length)
    expect(r.estimate.estimatedSecLow).toBeLessThan(r.estimate.estimatedSecHigh)
    expect(Math.round(cpLen(c) / ESTIMATE_CP_PER_SEC.high * 10) / 10).toBe(r.estimate.estimatedSecLow)
    expect(Object.keys(r.estimate).sort()).toEqual(['blocks', 'codepoints', 'estimatedSecHigh', 'estimatedSecLow'])
  })

  it('prepare 是零出站的：一次 TTS、一次 LLM 都不许发生', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const generateTTS = vi.fn()
    const invokeLlm = vi.fn()
    prepareEpisodeTtsRun({ content: content(30), channel: { voiceRef: CHANNEL_REF } }, { ...DEPS_OK, generateTTS, invokeLlm })
    expect(generateTTS).not.toHaveBeenCalled()
    expect(invokeLlm).not.toHaveBeenCalled()
  })
})

describe('刀4 第3片·下半：出期编排层 runEpisodeTts（顺序与旁路）', () => {
  it('正常链：口语化采纳后合成用的是改写文本，时长取实测而非预估', async () => {
    const { runEpisodeTts } = await load()
    const original = content(30)
    const deps = synthDeps({ invokeLlm: async () => original.replace(/句子/g, '说话') })
    const res = await runEpisodeTts(
      { content: original, title: '标题', outBase: '/tmp/ep', channel: { voiceRef: CHANNEL_REF } },
      deps
    )
    expect(deps.generateTTS).toHaveBeenCalled()
    const firstText = deps.generateTTS.mock.calls[0][0].text
    expect(firstText).toContain('说话')
    expect(res.colloquial.applied).toBe(true)
    expect(res.colloquial.reason).toBe('applied')
    expect(res.durationSec).toBe(120)
    expect(res.sizeBytes).toBe(4096)
    expect(res.mime).toBe('audio/mpeg')
    expect(res.blocks).toBe(deps.concatBlocks.mock.calls[0][0].blockCount)
  })

  it('口语化旁路（provider 异常）仍出一期，且合成收到原文', async () => {
    const { runEpisodeTts } = await load()
    const original = content(30)
    const deps = synthDeps({ invokeLlm: async () => { throw new Error('boom') } })
    const res = await runEpisodeTts(
      { content: original, title: '标题', outBase: '/tmp/ep', channel: { voiceRef: CHANNEL_REF } },
      deps
    )
    expect(res.colloquial.applied).toBe(false)
    expect(res.colloquial.reason).toBe('invoke_failed')
    // 旁路必须用**原文**合成：这条断言曾经被我写成 `x).toBe(x)`（恒真），恒真断言不构成回归锁。
    for (const call of deps.generateTTS.mock.calls) {
      expect(original).toContain(call[0].text)
    }
    expect(deps.generateTTS.mock.calls.length).toBeGreaterThan(0)
  })

  it('取消发生在合成之前：抛 PODCAST_PUBLISH_CANCELLED 且一次 TTS 都不发', async () => {
    const { runEpisodeTts, RUN_ERRORS } = await load()
    const deps = synthDeps()
    await expect(runEpisodeTts(
      { content: content(30), outBase: '/tmp/ep', channel: { voiceRef: CHANNEL_REF }, cancelToken: { cancelled: true } },
      deps
    )).rejects.toMatchObject({ code: RUN_ERRORS.CANCELLED })
    expect(deps.generateTTS).not.toHaveBeenCalled()
    expect(deps.invokeLlm).not.toHaveBeenCalled()
  })

  it('音色未解析时不进合成，也不进口语化（出站顺序不可颠倒）', async () => {
    const { runEpisodeTts } = await load()
    const deps = synthDeps()
    await expect(runEpisodeTts(
      { content: content(30), outBase: '/tmp/ep', channel: { voiceRef: { providerId: 'x' } } },
      deps
    )).rejects.toMatchObject({ code: 'PODCAST_TTS_VOICE_UNRESOLVED' })
    expect(deps.invokeLlm).not.toHaveBeenCalled()
    expect(deps.generateTTS).not.toHaveBeenCalled()
  })

  it('结果里的 voice/estimate 是准备层的量，blocks 是合成层的实测（两个真源分列）', async () => {
    const { runEpisodeTts } = await load()
    const deps = synthDeps()
    const res = await runEpisodeTts(
      { content: content(60), outBase: '/tmp/ep', channel: { voiceRef: CHANNEL_REF } },
      deps
    )
    expect(res.estimate.blocks).toBeGreaterThan(0)
    expect(res.blocks).toBe(deps.generateTTS.mock.calls.length)
    expect(res.voice.origin).toBe('channel')
  })

  it('结构锁：本层不得自带第二份协议/音色/分块判据', async () => {
    const fs = require('node:fs')
    const src = fs.readFileSync(path.resolve(__dirname, 'podcast-episode-tts-run.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src.indexOf('resolveEpisodeVoice')).toBeGreaterThan(-1)
    expect(src.indexOf('planChunks')).toBeGreaterThan(-1)
    expect(src.indexOf('colloquializeCopy')).toBeGreaterThan(-1)
    expect(src.indexOf('synthesizeEpisodeAudio')).toBeGreaterThan(-1)
    expect(src).not.toMatch(/function\s+plan[A-Z]/)
    expect(src).not.toMatch(/defaultVoiceId\s*\|\|/)
    expect(src).not.toMatch(/require\(['"]node:http['"]\)/)
  })
})

describe('回归锁：口语化与合成的 content 取值不得对调（2026-10-12 QM-6 后端评审命中）', () => {
  it('喂给 colloquializeCopy 的必须是 prepared.content，喂给 synthesizeEpisodeAudio 的必须是 coll.content', () => {
    const fs = require('node:fs')
    const src = fs.readFileSync(path.resolve(__dirname, 'podcast-episode-tts-run.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const collBlock = src.slice(src.indexOf('colloquializeCopy({'))
    const synthBlock = src.slice(src.indexOf('synthesizeEpisodeAudio({'))
    expect(collBlock.slice(0, 300)).toContain('content: prepared.content')
    expect(synthBlock.slice(0, 400)).toContain('content: coll.content')
    expect(src).not.toMatch(/const coll = await colloquializeCopy\(\{[^)]*\bcoll\.\w/sm)
  })
})

describe('回归锁：②③ 两级回退不得因漏传 defaultProvider 变成死代码（2026-10-12 QM-6 前端评审 C3）', () => {
  const DP = { providerId: 'openai-tts', model: 'tts-1' }

  it('频道无 voiceRef + 有默认 provider + 偏好命中 ⇒ origin=preference', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const r = prepareEpisodeTtsRun(
      { content: content(30), channel: {}, defaultProvider: DP },
      { readPreference: () => ({ voiceId: 'nova' }), getCapability: () => ({ defaultVoiceId: null }) }
    )
    expect(r.ok).toBe(true)
    expect(r.voice.origin).toBe('preference')
    expect(r.voice.voiceId).toBe('nova')
  })

  it('频道无 voiceRef + 无偏好 + capability 有默认 ⇒ origin=providerDefault', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const r = prepareEpisodeTtsRun(
      { content: content(30), channel: {}, defaultProvider: DP },
      { readPreference: () => null, getCapability: () => ({ defaultVoiceId: 'alloy' }) }
    )
    expect(r.ok).toBe(true)
    expect(r.voice.origin).toBe('providerDefault')
  })

  it('三层全缺 ⇒ 拒绝，且两个读取实现各被调用一次（不是没查就拒）', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const readPreference = vi.fn(() => null)
    const getCapability = vi.fn(() => ({ defaultVoiceId: null }))
    const r = prepareEpisodeTtsRun({ content: content(30), channel: {}, defaultProvider: DP }, { readPreference, getCapability })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    expect(readPreference).toHaveBeenCalledTimes(1)
    expect(getCapability).toHaveBeenCalledTimes(1)
  })

  it('usesOriginal 位必须能区分「采纳改写」与「走原文」（渲染提示文字的唯一依据）', async () => {
    const { runEpisodeTts } = await load()
    const deps = synthDeps()
    const res = await runEpisodeTts(
      { content: content(30), outBase: '/tmp/ep', channel: { voiceRef: CHANNEL_REF }, colloquialize: false },
      deps
    )
    expect(res.colloquial.usesOriginal).toBe(true)
    const d2 = synthDeps({ invokeLlm: async () => content(30).replace(/句子/g, '说话') })
    const res2 = await runEpisodeTts({ content: content(30), outBase: '/tmp/ep', channel: { voiceRef: CHANNEL_REF } }, d2)
    expect(res2.colloquial.usesOriginal).toBe(false)
  })
})
