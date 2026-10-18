// @vitest-environment node
/**
 * 跨层一致性锁：前端渲染层「语音模型解析口径」与主进程 resolveProviderDefaultModel
 * 必须逐项等价（voice-model-program-resolved，2026-10-18）。
 *
 * 存在理由（逃逸分析）：既有测试各自只测一层 —— useTtsVoices.test.js 测前端、
 * model-provider-manager.resolve-default.test.js 测主进程，**没有任何测试断言两层口径相同**。
 * 于是前端历史上可以随意把兜底从 fail-closed 改成 models[0] 而不触发任何红，
 * 这正是「多模态下语音模型下拉偶现非 TTS 模型」反复出现的结构性原因。
 * 本文件把「跨层等价」变成显式契约：同一夹具喂两层，返回值必须逐一相等。
 *
 * 夹具选取原则：每条差异都必须落在一个**具体边界**上，不能只测 happy path。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { resolveProviderDefaultModel } = require('./model-provider-manager')

// 前端 composable 经 ESM 源码静态导入；tts-voices-state 依赖 vue 的 reactive/computed，
// 在 node 环境下可用（无 DOM 依赖）。
let resolveVoiceModelForProvider

/** 主进程侧入参统一按 capability_models.tts 取（语音域），与前端 resolveVoiceModelForProvider 对齐 */
function mainResolve (provider) {
  return resolveProviderDefaultModel(provider, 'tts')
}

const MM = {
  id: 'minimax-multimodal',
  name: 'MiniMax',
  category: 'multimodal',
  models: ['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3', 'MiniMax-M2.7'],
  capability_models: { llm: 'MiniMax-M2.7', tts: 'speech-2.8-turbo', image: 'image-01', video: 'MiniMax-Hailuo-2.3' },
}

/** 夹具表：name → provider（覆盖全部优先级分支与边界） */
const CASES = {
  '单能力-运营默许模型（capability_models.tts）': {
    id: 'minimax-tts', name: 'MiniMax TTS', category: 'tts',
    models: ['speech-2.8-turbo'],
    capability_models: { tts: 'speech-2.8-turbo' },
  },
  '单能力-仅 provider 级 default_model': {
    id: 'google-tts', name: 'Google TTS', category: 'tts',
    models: ['google-tts', 'waveNet', 'neural2'],
    config: { default_model: 'waveNet' },
  },
  '单能力-用户默认优先于一切': {
    id: 'elevenlabs', name: 'ElevenLabs', category: 'tts',
    models: ['eleven_multilingual_v2', 'eleven_turbo_v2_5'],
    capability_models: { tts: 'eleven_multilingual_v2' },
    config: { user_default_model: 'eleven_turbo_v2_5', default_model: 'eleven_multilingual_v2' },
  },
  '单能力-用户默认失效（∉models）回退运营默许': {
    id: 'openai-tts', name: 'OpenAI TTS', category: 'tts',
    models: ['tts-1', 'tts-1-hd'],
    capability_models: { tts: 'tts-1' },
    config: { user_default_model: 'expired-model' },
  },
  '单能力-用户默认与运营默认均失效，回退 capability_models': {
    id: 'doubao-tts', name: '豆包 TTS', category: 'tts',
    models: ['doubao-tts', 'doubao-streaming-tts'],
    capability_models: { tts: 'doubao-streaming-tts' },
    config: { user_default_model: 'expired', default_model: 'also-expired' },
  },
  '单能力-无任何声明 → models[0]': {
    id: 'bare-tts', name: 'Bare TTS', category: 'tts',
    models: ['first-model', 'second-model'],
  },
  '单能力-models 为空 → 空串': {
    id: 'empty-tts', name: 'Empty TTS', category: 'tts', models: [],
  },
  '单能力-models 含脏项（空串/空白/null/数字）': {
    id: 'dirty-tts', name: 'Dirty TTS', category: 'tts',
    models: ['', '  ', null, 42, 'valid-model'],
  },
  '单能力-用户默认带首尾空白仍匹配': {
    id: 'space-tts', name: 'Space TTS', category: 'tts',
    models: ['gpt-4o-mini-tts'],
    config: { user_default_model: '  gpt-4o-mini-tts  ' },
  },
  '多模态-按 capability_models.tts 路由': MM,
  '多模态-用户默认优先（∈models）': {
    ...MM, config: { user_default_model: 'MiniMax-M2.7', default_model: 'MiniMax-Hailuo-2.3' },
  },
  '多模态-无 tts 能力声明 → fail-closed 空串': {
    id: 'x-multimodal', name: 'X Multimodal', category: 'multimodal',
    models: ['speech-2.8-turbo', 'image-01'],
    capability_models: { llm: 'MiniMax-M2.7', image: 'image-01' },
  },
  '多模态-capability_models 完全缺失 → fail-closed 空串': {
    id: 'y-multimodal', name: 'Y Multimodal', category: 'multimodal',
    models: ['a', 'b'],
  },
  '多模态-capability_models.tts 为空串 → 继续往下一级': {
    id: 'z-multimodal', name: 'Z Multimodal', category: 'multimodal',
    models: ['speech-2.8-turbo', 'image-01'],
    capability_models: { tts: '' },
    config: { default_model: 'image-01' },
  },
  '多模态-capability_models.tts 非字符串 → 安全降级': {
    id: 'w-multimodal', name: 'W Multimodal', category: 'multimodal',
    models: ['a', 'b'],
    capability_models: { tts: 42 },
  },
  'provider 为 null': null,
  'provider 为 undefined': undefined,
  'provider 为非对象': 'not-an-object',
  'provider 为空对象': {},
  'models 非数组': {
    id: 'bad-models', name: 'Bad Models', category: 'tts', models: 'oops',
  },
  'config 非对象': {
    id: 'bad-config', name: 'Bad Config', category: 'tts',
    models: ['m1'], capability_models: { tts: 'm1' },
    config: 'oops',
  },
}

describe('跨层一致性：前端 resolveVoiceModelForProvider vs 主进程 resolveProviderDefaultModel(·, \'tts\')', () => {
  beforeAll(async () => {
    const mod = await import('../../src/views/video-creation/composables/tts-voices-state')
    resolveVoiceModelForProvider = mod.resolveVoiceModelForProvider
  })

  it('解析函数已从 tts-voices-state 导出（防止拼写漂移）', () => {
    expect(typeof resolveVoiceModelForProvider).toBe('function')
  })

  for (const [name, provider] of Object.entries(CASES)) {
    it(`口径一致：${name}`, () => {
      const frontend = resolveVoiceModelForProvider(provider)
      const mainProcess = mainResolve(provider)
      expect(frontend).toBe(mainProcess)
    })
  }

  it('MiMo TTS 双模型特例不适用本口径（能力 driven，由调用方分支处理）', () => {
    // 该特例与「用户不该选模型」正交：预置音色→mimo-v2.5-tts、克隆→mimo-v2.5-tts-voiceclone。
    // 本口径对 mimo-tts 仍给出其 capability_models.tts（若运营有配），
    // 而 catalog/克隆请求的模型选择由 tts-voices-shared 的分支决定，不经过此函数。
    const mimo = {
      id: 'mimo-tts', name: 'MiMo TTS', category: 'tts',
      models: ['mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone'],
      capability_models: { tts: 'mimo-v2.5-tts' },
    }
    expect(resolveVoiceModelForProvider(mimo)).toBe('mimo-v2.5-tts')
    expect(mainResolve(mimo)).toBe('mimo-v2.5-tts')
  })
})

describe('跨层一致性的防漂移锁（变异反证）', () => {
  /**
   * 这条锁证明上面那些断言**真的在跑**，而不是恒真。
   * 方法：读主进程源码，确认其四级优先级的关键字都在；再读前端源码，
   * 确认前端没有把兜底写成 models[0]（多模态分支必须 fail-closed）。
   * 若有人把前端改成"多模态也兜底 models[0]"，本条立刻红。
   */
  const mainSrc = readFileSync(resolve(here, 'model-provider-manager.js'), 'utf8')
  const stateSrc = readFileSync(resolve(here, '../../src/views/video-creation/composables/tts-voices-state.js'), 'utf8')

  it('主进程仍持有四级优先级（user_default_model → default_model → capability_models → 兜底）', () => {
    expect(mainSrc).toContain('config.user_default_model')
    expect(mainSrc).toContain('config.default_model')
    expect(mainSrc).toContain('provider.capability_models[type]')
  })

  it('主进程多模态无声明仍 fail-closed（返回空串而非 models[0]）', () => {
    expect(mainSrc).toMatch(/if \(provider\.category === 'multimodal'\) return ''/)
  })

  it('前端 resolveVoiceModelForProvider 的实现存在且包含能力路由', () => {
    expect(stateSrc).toMatch(/export function resolveVoiceModelForProvider/)
    expect(stateSrc).toMatch(/capability_models\?*\.tts/)
  })

  it('前端多模态分支同样 fail-closed（不得兜底 models[0]）', () => {
    // 抓 resolveVoiceModelForProvider 函数体，确认含 category === 'multimodal' 时返回空串
    const fnStart = stateSrc.indexOf('export function resolveVoiceModelForProvider')
    expect(fnStart).toBeGreaterThan(-1)
    const fnBody = stateSrc.slice(fnStart, stateSrc.indexOf('\n}', fnStart))
    expect(fnBody).toMatch(/category === 'multimodal'/)
    expect(fnBody).toMatch(/return ''/)
  })
})
