import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

/**
 * 4.3②-a 的判据之家：二次确认框的**只读**预览接口（PRD §7.10.4.1）。
 *
 * 这一层的失败形态不是「算错一个数」，而是**显示 0** 或 **替用户选一个音色**——
 * 两者都能正常返回 200。所以本文件的每条断言都指向「缺席」或「逐字相等」，
 * 而不指向「返回码为 0」。分块与音色解析一律用**真实现**（`planChunks`/`resolveEpisodeVoice`），
 * 夹具只喂数据：把被调方 mock 掉，就等于把「只转发不加工」这条合同测成空气。
 */

const MOD = path.resolve(__dirname, 'podcast-episode-plan-preview.js')
async function load () { return import(MOD) }

/** 造一段足够长的正文（下限 80 码点由 compose 持有，这里只用它，不重抄数字）。 */
function script (blocks) {
  const unit = '这是用于分块判据的一整句正文，句末带终止标点，长度足以让下限判据不误伤夹具本身。'
  return Array.from({ length: blocks }, (_, i) => (i + 1) + '、' + unit).join('\n')
}

const CHANNEL_REF = { providerId: 'elevenlabs', model: 'eleven_multilingual_v2', voiceId: 'clone-a' }

function baseDeps (over = {}) {
  return Object.assign({
    channelRefOf: () => CHANNEL_REF,
    defaultProviderOf: () => ({ providerId: 'openai-tts', model: 'tts-1' }),
    readPreference: () => null,
    getCapability: (providerId, model) => ({ providerId, model, defaultVoiceId: 'alloy' }),
    warn: () => {},
  }, over)
}

describe('previewEpisodePlan：成功载荷的形状（浮层只会读这几个键）', () => {
  it('顶层恰为 ok/plan/voice，plan 两键、voice 五键（多一少一都是合同漂移）', async () => {
    const { createEpisodePlanPreview } = await load()
    const host = createEpisodePlanPreview(baseDeps())
    const r = await host.previewEpisodePlan({ channelId: 'ch_alpha', script: script(3) })
    expect(Object.keys(r).sort()).toEqual(['ok', 'plan', 'voice'])
    expect(Object.keys(r.plan).sort()).toEqual(['totalBlocks', 'totalCodepoints'])
    expect(Object.keys(r.voice).sort()).toEqual(['model', 'origin', 'providerId', 'resolvedBy', 'voiceId'])
    expect(r.ok).toBe(true)
    expect(r.voice.origin).toBe('channel')
  })

  it('载荷必须能被结构化克隆逐字往返（IPC 传 ref/proxy 会静默丢字段）', async () => {
    const { createEpisodePlanPreview } = await load()
    const r = await createEpisodePlanPreview(baseDeps()).previewEpisodePlan({ channelId: 'ch_alpha', script: script(2) })
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })

  it('totalBlocks 与真源 planChunks 的块数逐字相等，本层不得自己再切一遍', async () => {
    const { createEpisodePlanPreview } = await load()
    const { planChunks } = require('./podcast-tts-compose')
    const text = script(6)
    const real = planChunks(text)
    const r = await createEpisodePlanPreview(baseDeps()).previewEpisodePlan({ channelId: 'ch_alpha', script: text })
    expect(real.ok).toBe(true)
    expect(r.plan.totalBlocks).toBe(real.chunks.length)
  })

  it('totalCodepoints 等于各块码点之和（不是原文 UTF-16 长度，空段不计入计费面）', async () => {
    const { createEpisodePlanPreview } = await load()
    const { planChunks, cpLen } = require('./podcast-tts-compose')
    const text = script(4) + '\n   \t \n' + script(2)
    const real = planChunks(text)
    const sum = real.chunks.reduce((n, c) => n + cpLen(c.text), 0)
    const r = await createEpisodePlanPreview(baseDeps()).previewEpisodePlan({ channelId: 'ch_alpha', script: text })
    expect(r.plan.totalCodepoints).toBe(sum)
    expect(r.plan.totalCodepoints).not.toBe(text.length)
  })
})

describe('previewEpisodePlan：拒绝态不是空态（§7.10.4.1 验收 3）', () => {
  it('正文短于下限时抛既有码 PODCAST_TTS_COPY_TOO_SHORT，并带 issues（不得回一个 0 块的 ok）', async () => {
    const { createEpisodePlanPreview } = await load()
    const host = createEpisodePlanPreview(baseDeps())
    await expect(host.previewEpisodePlan({ channelId: 'ch_alpha', script: '太短了' })).rejects.toMatchObject({
      code: 'PODCAST_TTS_COPY_TOO_SHORT',
    })
    const err = await host.previewEpisodePlan({ channelId: 'ch_alpha', script: '太短了' }).catch((e) => e)
    expect(Array.isArray(err.issues)).toBe(true)
    expect(err.issues.length).toBeGreaterThan(0)
    expect(err.issues[0].message).toContain('80')
  })

  it('音色三段半配置 ⇒ PODCAST_TTS_VOICE_UNRESOLVED 且 path=voiceRef（沿用解析层，不另造码）', async () => {
    const { createEpisodePlanPreview } = await load()
    const host = createEpisodePlanPreview(baseDeps({ channelRefOf: () => ({ providerId: 'elevenlabs', model: '', voiceId: 'x' }) }))
    const err = await host.previewEpisodePlan({ channelId: 'ch_alpha', script: script(2) }).catch((e) => e)
    expect(err.code).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    expect(err.issues[0].path).toBe('voiceRef')
  })

  it('三层都拿不到音色 ⇒ 同一码拒绝，issues[].path=voice（预览不得替用户挑一个音色）', async () => {
    const { createEpisodePlanPreview } = await load()
    const host = createEpisodePlanPreview(baseDeps({
      channelRefOf: () => null,
      defaultProviderOf: () => ({ providerId: 'no-default', model: 'no-model' }),
      getCapability: () => ({ providerId: 'no-default', model: 'no-model', defaultVoiceId: null }),
    }))
    const err = await host.previewEpisodePlan({ channelId: 'ch_alpha', script: script(2) }).catch((e) => e)
    expect(err.code).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    expect(err.issues[0].path).toBe('voice')
  })

  it('缺 channelId ⇒ PODCAST_CHANNEL_ID_REQUIRED（判据来自 compose 那份码表）', async () => {
    const { createEpisodePlanPreview } = await load()
    const err = await createEpisodePlanPreview(baseDeps()).previewEpisodePlan({ channelId: '  ', script: script(2) }).catch((e) => e)
    expect(err.code).toBe('PODCAST_CHANNEL_ID_REQUIRED')
  })
})

describe('previewEpisodePlan：回退链与「命中来源」必须如实带出', () => {
  it('频道没配音色时走 ② 偏好层，origin 如实为 preference（①层恒空不得演成整链拒绝）', async () => {
    const { createEpisodePlanPreview } = await load()
    const host = createEpisodePlanPreview(baseDeps({
      channelRefOf: () => null,
      readPreference: (providerId, model) => ({ voiceId: 'pref-' + providerId + '-' + model }),
    }))
    const r = await host.previewEpisodePlan({ channelId: 'ch_alpha', script: script(2) })
    expect(r.voice.origin).toBe('preference')
    expect(r.voice.voiceId).toBe('pref-openai-tts-tts-1')
  })

  it('偏好没配时落到 ③ capability 默认音色，origin 如实为 providerDefault', async () => {
    const { createEpisodePlanPreview } = await load()
    const host = createEpisodePlanPreview(baseDeps({ channelRefOf: () => null, readPreference: () => null }))
    const r = await host.previewEpisodePlan({ channelId: 'ch_alpha', script: script(2) })
    expect(r.voice.origin).toBe('providerDefault')
    expect(r.voice.voiceId).toBe('alloy')
  })

  it('没有默认 provider 定位键 ⇒ 拒绝，且不得回退去「随便挑一个」（同 §7.4.1 口径）', async () => {
    const { createEpisodePlanPreview } = await load()
    const host = createEpisodePlanPreview(baseDeps({ channelRefOf: () => null, defaultProviderOf: () => null }))
    const err = await host.previewEpisodePlan({ channelId: 'ch_alpha', script: script(2) }).catch((e) => e)
    expect(err.code).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
  })

  it('origin 不在闭集内 ⇒ voice 整段不显示并出声 warn（不显示 ≠ 报错，也 ≠ 照显示一个错来源）', async () => {
    const { createEpisodePlanPreview } = await load()
    const warns = []
    const host = createEpisodePlanPreview(baseDeps({
      channelRefOf: () => null,
      // 闭集外的 origin 用真解析层不可达，只能经注入点造一次——这条注入的生产默认就是真实现，
      // 而「接线处不得传 resolveVoice 替身」由下面那条结构锁守住（否则注入点会变成第二份口径）。
      resolveVoice: () => ({ ok: true, providerId: 'p', model: 'm', voiceId: 'v', origin: 'ghost', resolvedBy: 'ghost:p/m' }),
      warn: (m) => warns.push(String(m)),
    }))
    const r = await host.previewEpisodePlan({ channelId: 'ch_alpha', script: script(2) })
    expect(r.voice).toBeNull()
    expect(r.plan.totalBlocks).toBeGreaterThan(0)
    expect(warns.join('|')).toContain('origin')
  })

  it('生产接线不得注入 resolveVoice 替身（音色判据全仓只许 podcast-tts-voice 一份）', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../ipc-handlers/podcast.js'), 'utf8')
    expect(src).not.toMatch(/resolveVoice\s*:/)
  })
})

describe('previewEpisodePlan：只读的两条机械保证', () => {
  it('不缓存：同一入参连调两次，读取实现各被调两次（偏好可能在别处改过）', async () => {
    const { createEpisodePlanPreview } = await load()
    const readPreference = vi.fn(() => null)
    const getCapability = vi.fn(() => ({ providerId: 'openai-tts', model: 'tts-1', defaultVoiceId: 'alloy' }))
    const host = createEpisodePlanPreview(baseDeps({ channelRefOf: () => null, readPreference, getCapability }))
    const arg = { channelId: 'ch_alpha', script: script(2) }
    await host.previewEpisodePlan(arg)
    await host.previewEpisodePlan(arg)
    expect(readPreference).toHaveBeenCalledTimes(2)
    expect(getCapability).toHaveBeenCalledTimes(2)
  })

  it('模块本体不得 require fs / child_process / net / 宿主链（mkdir=0 的构造性保证）', async () => {
    const raw = fs.readFileSync(MOD, 'utf8')
    // 判据必须**剥注释后再比**：本文件的头注释里就要写「不出现 mkdirSync」这几个词，
    // 不剥注释的话这条锁会因为解释了禁词而判红（同族坑：仓内多处结构锁都栽在注释命中禁词上）。
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l)).join('\n')
    // 正控：剥完仍在读的 require 必须还看得见，否则「禁词全不命中」可能只是切片切错了
    expect(src).toMatch(/require\(\s*'\.\/podcast-tts-compose'\s*\)/)
    expect(src).toMatch(/require\(\s*'\.\/podcast-tts-voice'\s*\)/)
    for (const forbidden of [
      /require\(\s*['"]node:fs['"]\s*\)/, /require\(\s*['"]fs['"]\s*\)/,
      /require\(\s*['"]node:child_process['"]\s*\)/, /require\(\s*['"]child_process['"]\s*\)/,
      /require\(\s*['"]net['"]\s*\)/,
      /podcast-episode-host/, /podcast-episode-publish/, /podcast-hosting/,
      /tryBeginPublish/, /mkdirSync/,
    ]) expect(src).not.toMatch(forbidden)
  })

  it('缺任一注入实现即 fail closed（缺一个就不许猜默认，也不许静默少一层回退）', async () => {
    const { createEpisodePlanPreview } = await load()
    for (const key of ['channelRefOf', 'defaultProviderOf', 'readPreference', 'getCapability']) {
      const deps = baseDeps()
      delete deps[key]
      const host = createEpisodePlanPreview(deps)
      const err = await host.previewEpisodePlan({ channelId: 'ch_alpha', script: script(2) }).catch((e) => e)
      expect(err.code, key + ' 缺失时必须拒绝').toBe('PODCAST_EPISODE_INVALID')
    }
  })

  it('resolveEpisodeVoice 必须有本模块这个生产调用方（结构锁：命中文件数 > 1）', async () => {
    const root = __dirname
    const hits = []
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith('.js') || name.endsWith('.test.js')) continue
      const p = path.join(root, name)
      const src = fs.readFileSync(p, 'utf8')
      if (src.includes('resolveEpisodeVoice')) hits.push(name)
    }
    expect(hits.length).toBeGreaterThan(1)
    expect(hits).toContain('podcast-episode-plan-preview.js')
    expect(hits).toContain('podcast-tts-voice.js')
  })
})
