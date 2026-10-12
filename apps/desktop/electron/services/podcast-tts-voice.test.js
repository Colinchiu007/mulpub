'use strict'
/**
 * 刀 4 第 3 片·上半的行为锁（PRD §7.4.1 四步回退链 / §7.4.6 显示项 3）。
 *
 * 三条锁的写法纪律：
 * - 顺序判据一律用「调用计数」而不是「返回值形状」——回退链最常见的错法是②命中时仍去读了③，
 *   那样即使命中也把 capability 的读异常变成新的拒绝路径（用户配过音色反而出不了期）。
 * - 「读偏好异常」与「偏好没配」必须各测一条且结果不同：把前者顺手降级到 ③ 就是静默换人说话。
 * - 跨模块契约锁注入**真** `tts-voice-catalog.getVoiceCapability`，不用手搓 capability 形状
 *   （AGENTS「契约夹具不得替对方剥壳/替对方改签名」的同族：手搓形状会让字段名漂移测不出来）。
 */
import { describe, it, expect, vi } from 'vitest'
const path = require('node:path')

const MODULE = path.resolve(__dirname, 'podcast-tts-voice.js')

async function load () { return import(MODULE) }

function mkDeps (opts = {}) {
  const calls = { pref: 0, cap: 0 }
  const deps = {
    calls,
    readPreference: vi.fn((p, m) => {
      calls.pref++
      if (typeof opts.preference === 'function') return opts.preference(p, m)
      return opts.preference === undefined ? null : opts.preference
    }),
    getCapability: vi.fn((p, m) => {
      calls.cap++
      if (typeof opts.capability === 'function') return opts.capability(p, m)
      return opts.capability === undefined ? { defaultVoiceId: null } : opts.capability
    }),
    warn: vi.fn(),
  }
  return deps
}

describe('resolveEpisodeVoice —— 四步回退链的顺序与出声', () => {
  it('① 频道三段齐备（providerId 键名）即用频道音色，且不读偏好与 capability', async () => {
    const { resolveEpisodeVoice, VOICE_ORIGIN } = await load()
    const d = mkDeps({ preference: { voiceId: 'should-not-be-used' }, capability: { defaultVoiceId: 'nope' } })
    const res = resolveEpisodeVoice({
      channelRef: { providerId: 'openai-tts', model: 'tts-1', voiceId: 'nova' },
      defaultProvider: { providerId: 'doubao-tts', model: 'doubao-tts' },
      readPreference: d.readPreference, getCapability: d.getCapability, warn: d.warn,
    })
    expect(res).toEqual({ ok: true, providerId: 'openai-tts', model: 'tts-1', voiceId: 'nova', origin: VOICE_ORIGIN.CHANNEL, resolvedBy: 'voiceRef:openai-tts/tts-1' })
    expect(d.calls).toEqual({ pref: 0, cap: 0 })
  })

  it('别名键 provider **不再被接受**，且与形状层 voiceRefIssues 同结论（两层不得对同一条入参反向）', async () => {
    const { resolveEpisodeVoice, VOICE_ERRORS } = await load()
    const { voiceRefIssues } = require('./podcast-tts-compose')
    const aliasRef = { provider: 'openai-tts', model: 'tts-1', voiceId: 'nova' }
    const res = resolveEpisodeVoice({
      channelRef: aliasRef,
      defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
      readPreference: () => ({ voiceId: 'alloy' }), getCapability: () => ({ defaultVoiceId: null }),
    })
    // 形状层（先跑）对这条判半配置；本层也必须判半配置——两边结论必须一致
    expect(voiceRefIssues(aliasRef).length).toBe(1)
    expect(res.ok).toBe(false)
    expect(res.code).toBe(VOICE_ERRORS.UNRESOLVED)
    expect(res.issues[0].path).toBe('voiceRef')
    // 逐字段对账：两层同结论的判据必须覆盖「三段齐备」这一侧，否则别名用例只是恒不匹配
    const goodRef = { providerId: 'openai-tts', model: 'tts-1', voiceId: 'nova' }
    expect(voiceRefIssues(goodRef)).toEqual([])
    const ok = resolveEpisodeVoice({
      channelRef: goodRef,
      readPreference: () => null, getCapability: () => ({ defaultVoiceId: null }),
    })
    expect(ok.ok).toBe(true)
    expect(ok.voiceId).toBe('nova')
  })

  it('非对象的 voiceRef 当场拒绝，不落进回退链替用户选音色', async () => {
    const { resolveEpisodeVoice, VOICE_ERRORS } = await load()
    for (const bad of ['openai-tts', 42, ['x'], true]) {
      const d = { pref: 0, cap: 0 }
      const res = resolveEpisodeVoice({
        channelRef: bad,
        defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
        readPreference: () => { d.pref++ }, getCapability: () => { d.cap++ },
      })
      expect(res.ok).toBe(false)
      expect(res.code).toBe(VOICE_ERRORS.UNRESOLVED)
      expect(res.issues[0].path).toBe('voiceRef')
      expect(d).toEqual({ pref: 0, cap: 0 })
    }
  })

  it('② 之前不得越过：voiceRef 半配置当场拒绝（issues[].path=voiceRef），两个读取实现一次都不被调用', async () => {
    const { resolveEpisodeVoice, VOICE_ERRORS } = await load()
    const d = mkDeps({ preference: { voiceId: 'alloy' }, capability: { defaultVoiceId: 'alloy' } })
    const res = resolveEpisodeVoice({
      channelRef: { providerId: 'openai-tts', model: 'tts-1' },
      defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
      readPreference: d.readPreference, getCapability: d.getCapability,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(VOICE_ERRORS.UNRESOLVED)
    expect(res.issues[0].code).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    expect(res.issues[0].path).toBe('voiceRef')
    expect(d.calls).toEqual({ pref: 0, cap: 0 })
  })

  it('频道完全未配置（三段同缺）才算真的走回退，不被判成半配置', async () => {
    const { resolveEpisodeVoice } = await load()
    const d = mkDeps({ preference: { voiceId: 'bing' }, capability: { defaultVoiceId: 'alloy' } })
    const res = resolveEpisodeVoice({
      channelRef: null,
      defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
      readPreference: d.readPreference, getCapability: d.getCapability,
    })
    expect(res.ok).toBe(true)
    expect(res.voiceId).toBe('bing')
  })

  it('② 命中用户偏好：origin=preference，且不再读 capability', async () => {
    const { resolveEpisodeVoice, VOICE_ORIGIN } = await load()
    const d = mkDeps({ preference: { voiceId: 'echo' }, capability: { defaultVoiceId: 'alloy' } })
    const res = resolveEpisodeVoice({
      defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
      readPreference: d.readPreference, getCapability: d.getCapability,
    })
    expect(res).toEqual({ ok: true, providerId: 'openai-tts', model: 'tts-1', voiceId: 'echo', origin: VOICE_ORIGIN.PREFERENCE, resolvedBy: 'preference:openai-tts/tts-1' })
    expect(d.calls).toEqual({ pref: 1, cap: 0 })
    expect(d.readPreference).toHaveBeenCalledWith('openai-tts', 'tts-1')
  })

  it('偏好记录里的 voiceId 是空串/纯空白时按「没配」处理，继续回退到 ③', async () => {
    const { resolveEpisodeVoice, VOICE_ORIGIN } = await load()
    for (const blank of ['', '   ', { voiceId: '  ' }, { voiceId: '' }]) {
      const d = mkDeps({ preference: blank, capability: { defaultVoiceId: 'alloy' } })
      const res = resolveEpisodeVoice({
        defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
        readPreference: d.readPreference, getCapability: d.getCapability,
      })
      expect(res.ok).toBe(true)
      expect(res.origin).toBe(VOICE_ORIGIN.PROVIDER_DEFAULT)
      expect(res.voiceId).toBe('alloy')
    }
  })

  it('偏好记录是裸字符串形状也能解析（真 store 的两种历史形状都覆盖）', async () => {
    const { resolveEpisodeVoice, VOICE_ORIGIN } = await load()
    const d = mkDeps({ preference: 'shimmer', capability: { defaultVoiceId: 'alloy' } })
    const res = resolveEpisodeVoice({
      defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
      readPreference: d.readPreference, getCapability: d.getCapability,
    })
    expect(res.origin).toBe(VOICE_ORIGIN.PREFERENCE)
    expect(res.voiceId).toBe('shimmer')
  })

  it('④ 三层都拿不到 ⇒ 拒绝出期，issues 指明是哪一层空', async () => {
    const { resolveEpisodeVoice, VOICE_ERRORS } = await load()
    const d = mkDeps({ preference: null, capability: { defaultVoiceId: null } })
    const res = resolveEpisodeVoice({
      defaultProvider: { providerId: 'elevenlabs', model: 'eleven_multilingual_v2' },
      readPreference: d.readPreference, getCapability: d.getCapability, warn: d.warn,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(VOICE_ERRORS.UNRESOLVED)
    expect(res.issues[0].path).toBe('voice')
    expect(d.calls).toEqual({ pref: 1, cap: 1 })
  })

  it('没有默认 provider 时不得"随便挑一个"：②③ 无定位键即拒绝，且两个读取都不被调用', async () => {
    const { resolveEpisodeVoice, VOICE_ERRORS } = await load()
    const d = mkDeps({ preference: { voiceId: 'alloy' }, capability: { defaultVoiceId: 'alloy' } })
    const res = resolveEpisodeVoice({
      channelRef: null, defaultProvider: null,
      readPreference: d.readPreference, getCapability: d.getCapability, warn: d.warn,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(VOICE_ERRORS.UNRESOLVED)
    expect(d.calls).toEqual({ pref: 0, cap: 0 })
    expect(d.warn).toHaveBeenCalledTimes(1)
  })

  it('「偏好读取异常」≠「偏好没配」：前者必须拒绝并出声，不得静默降级到 capability', async () => {
    const { resolveEpisodeVoice, VOICE_ERRORS, VOICE_ORIGIN } = await load()
    const boom = mkDeps({
      preference: () => { throw new Error('store 不可用') },
      capability: { defaultVoiceId: 'alloy' },
    })
    const res = resolveEpisodeVoice({
      defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
      readPreference: boom.readPreference, getCapability: boom.getCapability, warn: boom.warn,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(VOICE_ERRORS.UNRESOLVED)
    expect(res.issues[0].path).toBe('voice.preference')
    expect(boom.calls.cap).toBe(0)
    expect(boom.warn).toHaveBeenCalledTimes(1)

    // 对照组：真的没配（返回 null）时**必须**继续走到 ③，否则上面那条就成了"任何偏好读不到都拒绝"
    const fine = mkDeps({ preference: null, capability: { defaultVoiceId: 'alloy' } })
    const res2 = resolveEpisodeVoice({
      defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
      readPreference: fine.readPreference, getCapability: fine.getCapability,
    })
    expect(res2.origin).toBe(VOICE_ORIGIN.PROVIDER_DEFAULT)
  })

  it('capability 读取异常同样拒绝，不猜音色', async () => {
    const { resolveEpisodeVoice, VOICE_ERRORS } = await load()
    const d = {
      readPreference: () => null,
      getCapability: () => { throw new Error('catalog 坏了') },
      warn: vi.fn(),
    }
    const res = resolveEpisodeVoice({
      defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
      readPreference: d.readPreference, getCapability: d.getCapability, warn: d.warn,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(VOICE_ERRORS.UNRESOLVED)
    expect(res.issues[0].path).toBe('voice.capability')
  })

  it('注入缺失 fail closed，且发生在任何读取之前', async () => {
    const { resolveEpisodeVoice } = await load()
    const spy = vi.fn()
    const res = resolveEpisodeVoice({ readPreference: spy })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('PODCAST_EPISODE_INVALID')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('跨模块契约锁 —— 必须拿真 capability 表跑一次', () => {
  it('真 getVoiceCapability：openai-tts/tts-1 解析到 alloy（capability 声明的默认音色）', async () => {
    const { resolveEpisodeVoice, VOICE_ORIGIN } = await load()
    const catalog = require('./tts-voice-catalog')
    const res = resolveEpisodeVoice({
      defaultProvider: { providerId: 'openai-tts', model: 'tts-1' },
      readPreference: () => null,
      getCapability: (p, m) => catalog.getVoiceCapability(p, m),
    })
    expect(res.ok).toBe(true)
    expect(res.origin).toBe(VOICE_ORIGIN.PROVIDER_DEFAULT)
    expect(res.voiceId).toBe(catalog.getVoiceCapability('openai-tts', 'tts-1').defaultVoiceId)
    expect(res.voiceId).toBe('alloy')
  })

  it('真 getVoiceCapability：elevenlabs 系没有 defaultVoiceId ⇒ 必须拒绝，不得拿"第一个音色"兜底', async () => {
    const { resolveEpisodeVoice, VOICE_ERRORS } = await load()
    const catalog = require('./tts-voice-catalog')
    expect(catalog.getVoiceCapability('elevenlabs', 'eleven_multilingual_v2').defaultVoiceId).toBe(null)
    const res = resolveEpisodeVoice({
      defaultProvider: { providerId: 'elevenlabs', model: 'eleven_multilingual_v2' },
      readPreference: () => null,
      getCapability: (p, m) => catalog.getVoiceCapability(p, m),
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(VOICE_ERRORS.UNRESOLVED)
  })

  it('未知 provider 走真表也不产音色（provider_not_whitelisted 不是命中）', async () => {
    const { resolveEpisodeVoice, VOICE_ERRORS } = await load()
    const catalog = require('./tts-voice-catalog')
    const res = resolveEpisodeVoice({
      defaultProvider: { providerId: 'not-a-provider', model: 'x' },
      readPreference: () => null,
      getCapability: (p, m) => catalog.getVoiceCapability(p, m),
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(VOICE_ERRORS.UNRESOLVED)
  })
})

describe('本层不得自己走出站（音色解析在任何 provider 调用之前）', () => {
  it('源码只允许 require 同目录的分块层，不得出现网络/provider 依赖', () => {
    const fs = require('node:fs')
    const src = fs.readFileSync(MODULE, 'utf8')
    const requires = [...src.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2])
    expect(requires.filter((r) => !r.startsWith('./') && !r.startsWith('node:path')).sort()).toEqual([])
    expect(src).not.toMatch(/\b(fetch|axios|http\.request|https\.request|generateTTS|AssetGenerator)\b/)
    // 码表单点：音色解析只允许复用分块层那一个用户可见码，出现第二个字面量即红（防「每层各造一份码」）
    const codeLiterals = [...new Set([...src.matchAll(/'PODCAST_[A-Z_]+'/g)].map((x) => x[0]))]
    expect(codeLiterals).toEqual(["'PODCAST_EPISODE_INVALID'"])
    expect(src).toContain('TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE')
  })
})
