/**
 * resolveS2VDefaultProviderId —— 流水线生成器默认值判定（2026-10-18）
 *
 * 覆盖：默认口径三类形态（普通 provider / 多模态能力默认 / 多模态整体默认）、
 * 图片视频同样跟随、无默认回首项、悬空 id 不回退、空列表、能力声明校验、脏入参不抛错。
 */
import { describe, it, expect } from 'vitest'
import { resolveS2VDefaultProviderId } from './s2v-default-provider'

const MIMO = { id: 'mimo-tts', name: 'MiMo TTS', category: 'tts', is_default: false, models: ['mimo-v2.5-tts'] }
const MINIMAX_MM = {
  id: 'minimax-multimodal', name: 'MiniMax', category: 'multimodal',
  is_default: false, capabilities: ['tts'], capability_models: { tts: 'speech-2.8-turbo' },
  models: ['speech-2.8-turbo'],
  // 用户在「模型设置」里把该多模态模型的 TTS 能力设为默认
  config: { capability_defaults: ['tts'] },
}
const ELEVEN = { id: 'elevenlabs', name: 'ElevenLabs', category: 'tts', is_default: true, models: ['eleven_multilingual_v2'] }

describe('resolveS2VDefaultProviderId（流水线生成器默认值跟随模型设置默认）', () => {
  it('模型设置默认 = 多模态 TTS 能力时，默认选中该多模态而非列表首项 Mimo', () => {
    expect(resolveS2VDefaultProviderId([MIMO, MINIMAX_MM, ELEVEN], 'tts')).toBe('minimax-multimodal')
  })

  it('模型设置默认 = 普通 TTS 服务商时，默认选中该服务商而非多模态', () => {
    const mmNoDefault = { ...MINIMAX_MM, config: { capability_defaults: [] } }
    expect(resolveS2VDefaultProviderId([MIMO, mmNoDefault, ELEVEN], 'tts')).toBe('elevenlabs')
  })

  it('多模态整体默认（is_default）同样视为该能力默认', () => {
    const mmGlobal = { ...MINIMAX_MM, is_default: true, config: {} }
    expect(resolveS2VDefaultProviderId([MIMO, mmGlobal, ELEVEN], 'tts')).toBe('minimax-multimodal')
  })

  it('图片/视频类别同样跟随默认（不只修 TTS）', () => {
    const imgA = { id: 'img-a', name: 'A', category: 'image', is_default: false, models: ['m1'] }
    const imgB = { id: 'img-b', name: 'B', category: 'image', is_default: true, models: ['m2'] }
    expect(resolveS2VDefaultProviderId([imgA, imgB], 'image')).toBe('img-b')
  })

  it('没有任何默认时回退首项（保持旧行为）', () => {
    const a = { id: 'a', category: 'tts', is_default: false, models: ['m'] }
    const b = { id: 'b', category: 'tts', is_default: false, models: ['m'] }
    expect(resolveS2VDefaultProviderId([a, b], 'tts')).toBe('a')
  })

  it('默认 provider 不在候选列表时回退首项（不返回悬空 id）', () => {
    const a = { id: 'a', category: 'tts', is_default: false, models: ['m'] }
    expect(resolveS2VDefaultProviderId([a], 'tts', 'deleted-provider')).toBe('a')
  })

  it('空列表返回空串（上游渲染「自动 Edge TTS」/「无」）', () => {
    expect(resolveS2VDefaultProviderId([], 'tts')).toBe('')
  })

  it('多模态未声明该能力时不算默认（防止 image 默认抢走 tts 下拉）', () => {
    const mmNoTts = { id: 'mm', name: 'MM', category: 'multimodal', is_default: true, capabilities: ['image'], capability_models: { image: 'i1' }, models: ['i1'], config: {} }
    const ttsOnly = { id: 'tts-x', name: 'T', category: 'tts', is_default: false, models: ['t1'] }
    expect(resolveS2VDefaultProviderId([ttsOnly, mmNoTts], 'tts')).toBe('tts-x')
  })

  it('非字符串/空入参不抛错', () => {
    expect(resolveS2VDefaultProviderId(null, 'tts')).toBe('')
    expect(resolveS2VDefaultProviderId(undefined, undefined)).toBe('')
    expect(resolveS2VDefaultProviderId('nope', 'tts')).toBe('')
  })

  it('preferredId 在列表内但不是该能力默认时被忽略（不把非默认当成默认）', () => {
    const mmNoDefault = { ...MINIMAX_MM, config: { capability_defaults: [] } }
    expect(resolveS2VDefaultProviderId([MIMO, mmNoDefault, ELEVEN], 'tts', 'minimax-multimodal')).toBe('elevenlabs')
  })

  it('config 为标量/数组时安全降级（不抛错）', () => {
    const broken = { id: 'b1', category: 'multimodal', is_default: false, capabilities: ['tts'], config: 'oops' }
    const fallback = { id: 'f1', category: 'tts', is_default: false, models: ['m'] }
    expect(resolveS2VDefaultProviderId([broken, fallback], 'tts')).toBe('b1')
  })
})
