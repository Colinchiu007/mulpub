import { describe, expect, it } from 'vitest'

import {
  CAPABILITY_TYPES,
  getVoiceCapability,
  normalizeVoiceList,
} from './tts-voice-catalog'

describe('TTS 音色能力目录', () => {
  it('只对已批准的 provider/model 组合返回能力', () => {
    for (const model of ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15']) {
      expect(getVoiceCapability('openai-tts', model)).toMatchObject({
        model,
        type: CAPABILITY_TYPES.BUILTIN,
        canListVoices: true,
        defaultVoiceId: 'alloy',
      })
    }
    expect(getVoiceCapability('openai-tts', 'unknown-model')).toMatchObject({
      type: CAPABILITY_TYPES.UNSUPPORTED,
      canListVoices: false,
    })
    expect(getVoiceCapability('unknown-provider', 'tts-1')).toMatchObject({
      type: CAPABILITY_TYPES.UNSUPPORTED,
      canListVoices: false,
    })
  })

  it('提供平台个人槽位和已实现克隆的明确元数据', () => {
    const doubao = getVoiceCapability('doubao-tts', 'doubao-tts')
    const elevenLabs = getVoiceCapability('elevenlabs', 'eleven_multilingual_v2')

    expect(doubao).toMatchObject({
      type: CAPABILITY_TYPES.PROVIDER_PERSONAL_SLOT,
      clone: {
        enabled: false,
        entry: 'provider_console',
        implementation: 'external_console_required',
      },
    })
    expect(elevenLabs).toMatchObject({
      type: CAPABILITY_TYPES.USER_CLONE,
      clone: {
        enabled: true,
        entry: 'desktop_upload',
        implementation: 'adapter_implemented',
      },
    })
  })

  it('只保留安全可显示的音色元数据', () => {
    const voices = normalizeVoiceList([
      {
        voice_id: 'voice-1',
        name: '安全音色',
        api_key: 'must-not-persist',
        authorization: 'Bearer must-not-persist',
        audio: Buffer.from('must-not-persist'),
        clonePath: 'voice-clones/user-1.wav',
      },
      {
        id: 'voice-2',
        display_name: '备用音色',
        token: 'must-not-persist',
        clonePath: '../../escape.wav',
      },
    ], { source: CAPABILITY_TYPES.USER_CLONE })

    expect(voices).toEqual([
      {
        id: 'voice-1',
        name: '安全音色',
        source: CAPABILITY_TYPES.USER_CLONE,
        clonePath: 'voice-clones/user-1.wav',
      },
      {
        id: 'voice-2',
        name: '备用音色',
        source: CAPABILITY_TYPES.USER_CLONE,
      },
    ])
    expect(JSON.stringify(voices)).not.toContain('must-not-persist')
  })

  it('多模态预设（minimax-multimodal）复用 MiniMax TTS 音色能力边界', () => {
    for (const model of ['speech-2.8-turbo', 'speech-2.8-hd', 'speech-2.6-hd', 'speech-2.6-turbo']) {
      const capability = getVoiceCapability('minimax-multimodal', model)
      expect(capability).toMatchObject({
        model,
        type: CAPABILITY_TYPES.USER_CLONE,
        canListVoices: true,
        defaultVoiceId: 'male-qn-qingse',
        clone: { enabled: true, entry: 'desktop_upload', implementation: 'adapter_implemented' },
      })
    }
    // 非 TTS 模型与未列入白名单的 TTS 模型必须 fail closed
    expect(getVoiceCapability('minimax-multimodal', 'image-01')).toMatchObject({
      type: CAPABILITY_TYPES.UNSUPPORTED,
      canListVoices: false,
      reason: 'model_not_whitelisted',
    })
    expect(getVoiceCapability('minimax-multimodal', 'speech-3.0')).toMatchObject({
      type: CAPABILITY_TYPES.UNSUPPORTED,
      canListVoices: false,
      reason: 'model_not_whitelisted',
    })
  })

  // ── change: digital-human-multiprovider ──────────────────────────────
  // 数字人 provider 也走 TTS 音色目录：形象克隆与声音克隆在用户眼里是
  // 「一个数字人」的两半，若目录不声明克隆能力，UI 的音色克隆面板
  // （S2vConfigPanels 的 s2v-voice-clone-toggle）对这两家根本不渲染，
  // 用户看不到「能给数字人配自己的声音」这个入口。

  it('两家数字人 provider 都声明声音克隆能力（heygen + hifly）', () => {
    for (const [providerId, model] of [['heygen', 'heygen-video'], ['hifly', 'hifly-video']]) {
      expect(getVoiceCapability(providerId, model)).toMatchObject({
        providerId,
        model,
        type: CAPABILITY_TYPES.USER_CLONE,
        canListVoices: true,
        clone: { enabled: true, entry: 'desktop_upload', implementation: 'adapter_implemented' },
      })
    }
  })

  it('数字人 provider 的克隆能力与其形象克隆能力同源（避免只声明一半）', () => {
    // 两家都实现了形象克隆四件套 + 声音克隆，目录必须两边都认；
    // 只认一边会让用户「克隆了形象却发现配不了自己的声音」。
    const dhProviders = ['heygen', 'hifly']
    for (const providerId of dhProviders) {
      const model = `${providerId}-video`
      const capability = getVoiceCapability(providerId, model)
      expect(capability.clone?.enabled).toBe(true)
      expect(capability.clone?.entry).toBe('desktop_upload')
    }
  })

  it('未知数字人模型 fail closed（不得因为带 video 字样就放行）', () => {
    expect(getVoiceCapability('heygen', 'heygen-video-v3')).toMatchObject({
      type: CAPABILITY_TYPES.UNSUPPORTED,
      canListVoices: false,
    })
    expect(getVoiceCapability('hifly', 'unknown')).toMatchObject({
      type: CAPABILITY_TYPES.UNSUPPORTED,
      canListVoices: false,
    })
  })
})
