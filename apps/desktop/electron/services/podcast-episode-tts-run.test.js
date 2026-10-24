import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// `__dirname` 在纯 ESM 下不存在；本仓两种写法都有（`import.meta.url` 这条是标准做法），
// 这里取标准那条，免得换个运行器就 ReferenceError。
const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOD = path.resolve(HERE, 'podcast-episode-tts-run.js')
/** 分块层是 CJS；与同族 `podcast-episode-synth.test.js` 同构，用 `await import()` 加载，不混用 `require`。 */
const MOD_COMPOSE = path.resolve(HERE, 'podcast-tts-compose.js')

async function load () { return import(MOD) }

/**
 * 默认 provider（**必填定位键**）与依赖桩。音色链已收敛为两层（2026-10-19 用户裁决，
 * PRD §7.4.1.2 是唯一真源）：① 用户偏好 → ② capability 的 `defaultVoiceId` → ③ 都拿不到就拒绝出期。
 * 曾经的第 ① 档「频道 `voiceRef`」已撤档（写侧从未存在），本层不得再消费它。
 */
const DP = { providerId: 'openai-tts', model: 'tts-1' }
/** 撤档前那一档的形状，只在「不得被消费」的回归锁里用作夹具。 */
const CHANNEL_REF = { providerId: 'openai-tts', model: 'tts-1', voiceId: 'alloy' }
const DEPS_OK = {
  readPreference: () => null,
  getCapability: (providerId, model) => ({ providerId, model, defaultVoiceId: 'alloy', voices: [] }),
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
    const r = prepareEpisodeTtsRun({ content: content(20), defaultProvider: DP }, {})
    expect(r.ok).toBe(false)
    expect(r.code).toBe(RUN_ERRORS.INVALID_ARGS)
    expect(r.issues[0].path).toBe('tts.deps')
  })

  it('空文案走分块层的既有码，不在本层新立一个码', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const { TTS_COMPOSE_ERRORS } = await import(MOD_COMPOSE)
    const r = prepareEpisodeTtsRun({ content: '   ', defaultProvider: DP }, DEPS_OK)
    expect(r.ok).toBe(false)
    expect(r.code).toBe(TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT)
    expect(r.issues[0].path).toBe('copy.content')
  })

  it('音色解析失败逐字透传 code 与 issues.path（本层不得重新包码）', async () => {
    const { prepareEpisodeTtsRun } = await load()
    // 没有默认 provider ⇒ ①② 两级没有定位键 ⇒ 音色层拒发（判据归音色层，本层不代猜）
    const r = prepareEpisodeTtsRun({ content: content(20) }, DEPS_OK)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    expect(Array.isArray(r.issues)).toBe(true)
    expect(r.issues[0].path).toBe('voice')
  })

  it('偏好读异常也逐字透传（voice.preference ≠ voice：归因不得被擦掉）', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const r = prepareEpisodeTtsRun(
      { content: content(20), defaultProvider: DP },
      { readPreference: () => { throw new Error('storage down') }, getCapability: DEPS_OK.getCapability }
    )
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    expect(r.issues[0].path).toBe('voice.preference')
  })

  it('默认 provider + capability 命中 ⇒ origin=providerDefault，且 voice 形状沿用音色层（不另包一层）', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const r = prepareEpisodeTtsRun({ content: content(30), defaultProvider: DP }, DEPS_OK)
    expect(r.ok).toBe(true)
    expect(r.voice.origin).toBe('providerDefault')
    expect(r.voice.providerId).toBe('openai-tts')
    expect(r.voice.voiceId).toBe('alloy')
    expect(r.voice.voice).toBeUndefined()
  })

  it('estimate 只含展示量：码点/块数/时长区间，且不含任何判据字段', async () => {
    const { prepareEpisodeTtsRun, CP_PER_SEC_BY_SPEED } = await load()
    const c = content(40)
    const r = prepareEpisodeTtsRun({ content: c, defaultProvider: DP }, DEPS_OK)
    const { cpLen } = await import(MOD_COMPOSE)
    expect(r.estimate.codepoints).toBe(cpLen(c))
    expect(r.estimate.blocks).toBe(r.chunks.length)
    expect(r.estimate.estimatedSecLow).toBeLessThan(r.estimate.estimatedSecHigh)
    expect(Math.round(cpLen(c) / CP_PER_SEC_BY_SPEED.fast * 10) / 10).toBe(r.estimate.estimatedSecLow)
    expect(Object.keys(r.estimate).sort()).toEqual(['blocks', 'codepoints', 'estimatedSecHigh', 'estimatedSecLow'])
  })

  it('prepare 是零出站的：一次 TTS、一次 LLM 都不许发生', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const generateTTS = vi.fn()
    const invokeLlm = vi.fn()
    prepareEpisodeTtsRun({ content: content(30), defaultProvider: DP }, { ...DEPS_OK, generateTTS, invokeLlm })
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
      { content: original, title: '标题', outBase: '/tmp/ep', defaultProvider: DP },
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

  it('口语化旁路（结构不合格）仍出一期，且合成收到的仍是原文', async () => {
    const { runEpisodeTts } = await load()
    const original = content(30)
    // 结构不合格：改写稿多出一段（段落数从 1 变 2）⇒ 口语化层判 structure_rejected 并回退原文。
    // 这条与上面的 invoke_failed 是**两个不同的旁路**：一个失败在「调用」，一个失败在「结构」，
    // 两条都必须证明「合成层拿到的是原文」——只锁一条会让另一条悄悄退化（2026-10-22 QM-6 i8）。
    const deps = synthDeps({ invokeLlm: async () => original + '\n多出来的一段。' })
    const res = await runEpisodeTts(
      { content: original, title: '标题', outBase: '/tmp/ep', defaultProvider: DP },
      deps
    )
    expect(res.colloquial.applied).toBe(false)
    expect(res.colloquial.reason).toBe('structure_rejected')
    const spoken = deps.generateTTS.mock.calls.map(c => c[0].text).join('')
    expect(spoken).toBe(original)
  })

  it('口语化旁路（provider 异常）仍出一期，且合成收到原文', async () => {
    const { runEpisodeTts } = await load()
    const original = content(30)
    const deps = synthDeps({ invokeLlm: async () => { throw new Error('boom') } })
    const res = await runEpisodeTts(
      { content: original, title: '标题', outBase: '/tmp/ep', defaultProvider: DP },
      deps
    )
    expect(res.colloquial.applied).toBe(false)
    expect(res.colloquial.reason).toBe('invoke_failed')
    // 旁路必须用**原文**合成。这条断言改过两次，每次都是因为它**证明不了目标**：
    //   ① 初稿写成 `x).toBe(x)`（恒真，恒真断言不构成回归锁）；
    //   ② 改成 `expect(original).toContain(call[0].text)` —— 方向对了但**力度不够**：块文本本就是原文的
    //      子串，所以「原文包含块」几乎恒真，它证明不了合成层拿到的是原文而不是别的改写稿
    //      （2026-10-22 QM-6 评审 i4 命中）。
    // 现在按「逐块拼回去必须逐字等于原文」断言：块数、顺序、每个字的归属都算过。
    const spoken = deps.generateTTS.mock.calls.map(c => c[0].text).join('')
    expect(spoken).toBe(original)
    expect(deps.generateTTS.mock.calls.length).toBeGreaterThan(0)
  })

  it('取消发生在合成之前：抛 PODCAST_PUBLISH_CANCELLED 且一次 TTS 都不发', async () => {
    const { runEpisodeTts, RUN_ERRORS } = await load()
    const deps = synthDeps()
    await expect(runEpisodeTts(
      { content: content(30), outBase: '/tmp/ep', defaultProvider: DP, cancelToken: { cancelled: true } },
      deps
    )).rejects.toMatchObject({ code: RUN_ERRORS.CANCELLED })
    expect(deps.generateTTS).not.toHaveBeenCalled()
    expect(deps.invokeLlm).not.toHaveBeenCalled()
  })

  it('音色未解析时不进合成，也不进口语化（出站顺序不可颠倒）', async () => {
    const { runEpisodeTts } = await load()
    const deps = synthDeps()
    // 缺默认 provider ⇒ 定位键缺失 ⇒ 音色层拒发（path='voice'）
    await expect(runEpisodeTts(
      { content: content(30), outBase: '/tmp/ep' },
      deps
    )).rejects.toMatchObject({ code: 'PODCAST_TTS_VOICE_UNRESOLVED', issues: [{ path: 'voice' }] })
    expect(deps.invokeLlm).not.toHaveBeenCalled()
    expect(deps.generateTTS).not.toHaveBeenCalled()
  })

  it('结果里的 voice/estimate 是准备层的量，blocks 是合成层的实测（两个真源分列）', async () => {
    const { runEpisodeTts } = await load()
    const deps = synthDeps()
    const res = await runEpisodeTts(
      { content: content(60), outBase: '/tmp/ep', defaultProvider: DP },
      deps
    )
    expect(res.estimate.blocks).toBeGreaterThan(0)
    expect(res.blocks).toBe(deps.generateTTS.mock.calls.length)
    expect(res.voice.origin).toBe('providerDefault')
  })

  it('结构锁：本层不得自带第二份协议/音色/分块判据', async () => {
    const src = fs.readFileSync(path.resolve(HERE, 'podcast-episode-tts-run.js'), 'utf8')
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
    const src = fs.readFileSync(path.resolve(HERE, 'podcast-episode-tts-run.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const collBlock = src.slice(src.indexOf('colloquializeCopy({'))
    const synthBlock = src.slice(src.indexOf('synthesizeEpisodeAudio({'))
    expect(collBlock.slice(0, 300)).toContain('content: prepared.content')
    expect(synthBlock.slice(0, 400)).toContain('content: coll.content')
    expect(src).not.toMatch(/const coll = await colloquializeCopy\(\{[^)]*\bcoll\.\w/sm)
  })
})

describe('回归锁：①② 两级回退不得因漏传 defaultProvider 变成死代码（2026-10-12 QM-6 前端评审 C3）', () => {
  it('有默认 provider + 偏好命中 ⇒ origin=preference', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const r = prepareEpisodeTtsRun(
      { content: content(30), defaultProvider: DP },
      { readPreference: () => ({ voiceId: 'nova' }), getCapability: () => ({ defaultVoiceId: null }) }
    )
    expect(r.ok).toBe(true)
    expect(r.voice.origin).toBe('preference')
    expect(r.voice.voiceId).toBe('nova')
  })

  it('无偏好 + capability 有默认 ⇒ origin=providerDefault', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const r = prepareEpisodeTtsRun(
      { content: content(30), defaultProvider: DP },
      { readPreference: () => null, getCapability: () => ({ defaultVoiceId: 'alloy' }) }
    )
    expect(r.ok).toBe(true)
    expect(r.voice.origin).toBe('providerDefault')
  })

  it('两层全缺 ⇒ 拒绝，且两个读取实现各被调用一次（不是没查就拒）', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const readPreference = vi.fn(() => null)
    const getCapability = vi.fn(() => ({ defaultVoiceId: null }))
    const r = prepareEpisodeTtsRun({ content: content(30), defaultProvider: DP }, { readPreference, getCapability })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    expect(readPreference).toHaveBeenCalledTimes(1)
    expect(getCapability).toHaveBeenCalledTimes(1)
  })

  it('usesOriginal 位必须能区分「采纳改写」与「走原文」（渲染提示文字的唯一依据）', async () => {
    const { runEpisodeTts } = await load()
    const deps = synthDeps()
    const res = await runEpisodeTts(
      { content: content(30), outBase: '/tmp/ep', defaultProvider: DP, colloquialize: false },
      deps
    )
    expect(res.colloquial.usesOriginal).toBe(true)
    const d2 = synthDeps({ invokeLlm: async () => content(30).replace(/句子/g, '说话') })
    const res2 = await runEpisodeTts({ content: content(30), outBase: '/tmp/ep', defaultProvider: DP }, d2)
    expect(res2.colloquial.usesOriginal).toBe(false)
  })
})

describe('回归锁：频道 voiceRef 那一档已于 2026-10-19 撤档（PRD §7.4.1.2），本层不得再消费它', () => {
  it('带频道 voiceRef 但无默认 provider ⇒ 仍然拒绝（频道档不是回退）', async () => {
    const { prepareEpisodeTtsRun } = await load()
    const r = prepareEpisodeTtsRun({ content: content(30), channel: { voiceRef: CHANNEL_REF } }, DEPS_OK)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
  })

  it('实现里不得出现 channelRef / input.channel 任何一个（留着不可达的档位比少一条更坏）', async () => {
    const src = fs.readFileSync(path.resolve(HERE, 'podcast-episode-tts-run.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).not.toMatch(/channelRef/)
    expect(src).not.toMatch(/input\.channel/)
  })
})
