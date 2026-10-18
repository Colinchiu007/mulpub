// @vitest-environment node
/**
 * resolveProviderDefaultModel — 模型默认值纯函数测试。
 * 2026-08-27 建立「双默认语义」；2026-10-18（voice-model-program-resolved）修订优先级：
 *   ① config.user_default_model（用户级，∈models 才生效）
 *   ② capability_models[type]（能力级默许模型，声明即有效）
 *   ③ config.default_model（provider 级默认，∈models 才生效；**多模态跳过**）
 *   ④ 单能力 models[0]；多模态无声明返回 ''（fail-closed）
 *
 * 为什么 ② 必须早于 ③：`minimax-multimodal` 目录下发的 default_model 是 MiniMax-M2.7（llm 模型），
 * 旧顺序（③ 优先）会让 tts/image/video 三个能力全部解析成 LLM 模型 —— 新建任务时前端显式传
 * params.voiceModel 掩盖了它，只有断点续跑 / 播客等走 __resumeUseCurrentModels 的路径会踩到。
 */
const { resolveProviderDefaultModel } = require('./model-provider-manager')

const MM = {
  id: 'minimax-multimodal',
  category: 'multimodal',
  models: ['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3', 'MiniMax-M2.7'],
  capability_models: { llm: 'MiniMax-M2.7', tts: 'speech-2.8-turbo', image: 'image-01', video: 'MiniMax-Hailuo-2.3' },
}

describe('resolveProviderDefaultModel（双默认语义 + 能力优先）', () => {
  it('1. 用户默认优先于运营预设与能力路由', () => {
    expect(resolveProviderDefaultModel({ ...MM, config: { user_default_model: 'MiniMax-M2.7', default_model: 'MiniMax-Hailuo-2.3' } }, 'llm')).toBe('MiniMax-M2.7')
  })

  it('2. 用户未设置时，能力级默许模型优先于 provider 级默认（2026-10-18 修订）', () => {
    // 修前返回 default_model = MiniMax-Hailuo-2.3（一个视频模型当 llm 用）；修后取 capability_models.llm
    expect(resolveProviderDefaultModel({ ...MM, config: { default_model: 'MiniMax-Hailuo-2.3' } }, 'llm')).toBe('MiniMax-M2.7')
    expect(resolveProviderDefaultModel({ ...MM, config: { default_model: 'MiniMax-M2.7' } }, 'tts')).toBe('speech-2.8-turbo')
  })

  it('3. 用户默认不在 models 视为失效并回退（不污染配置）', () => {
    expect(resolveProviderDefaultModel({ ...MM, config: { user_default_model: 'expired-model', default_model: 'MiniMax-M2.7' } }, 'llm')).toBe('MiniMax-M2.7')
  })

  it('4. 多模态缺能力声明时跳过 provider 级默认，仍然 fail-closed', () => {
    const noTts = {
      id: 'mm', category: 'multimodal', models: ['MiniMax-M2.7', 'image-01'],
      capability_models: { llm: 'MiniMax-M2.7', image: 'image-01' },
      config: { default_model: 'MiniMax-M2.7' },
    }
    expect(resolveProviderDefaultModel(noTts, 'tts')).toBe('')
    expect(resolveProviderDefaultModel(noTts, 'video')).toBe('')
  })

  it('4b. 多模态解 llm 时 provider 级默认仍生效（存量「多模态+仅 default_model」不降级）', () => {
    const llmOnlyOps = {
      id: 'mm2', category: 'multimodal', models: ['MiniMax-M2.7', 'speech-2.8-turbo'],
      capability_models: { tts: 'speech-2.8-turbo' },
      config: { default_model: 'MiniMax-M2.7' },
    }
    expect(resolveProviderDefaultModel(llmOnlyOps, 'llm')).toBe('MiniMax-M2.7')
    // 同一条目解 tts 走能力路由
    expect(resolveProviderDefaultModel(llmOnlyOps, 'tts')).toBe('speech-2.8-turbo')
  })

  it('5. 多模态按能力路由（声明即有效，不要求 ∈ models）', () => {
    expect(resolveProviderDefaultModel({ ...MM, config: {} }, 'tts')).toBe('speech-2.8-turbo')
  })

  it('6. 多模态无任何声明时返回空（fail-closed，不猜测）', () => {
    const bare = { id: 'x', category: 'multimodal', models: ['a', 'b'] }
    expect(resolveProviderDefaultModel(bare, 'llm')).toBe('')
    expect(resolveProviderDefaultModel(bare, 'video')).toBe('')
  })

  it('7. 单能力 provider 回退 models[0]', () => {
    expect(resolveProviderDefaultModel({ id: 'flux', category: 'image', models: ['flux-pro', 'flux-dev'] }, 'image')).toBe('flux-pro')
  })

  it('8. 单能力 provider 用户默认生效', () => {
    expect(resolveProviderDefaultModel({ id: 'flux', category: 'image', models: ['flux-pro', 'flux-dev'], config: { user_default_model: 'flux-dev' } }, 'image')).toBe('flux-dev')
  })

  it('8b. 单能力 provider 能力级默许模型优先于 provider 级默认', () => {
    const p = { id: 'tts-both', category: 'tts', models: ['m-cap', 'm-ops'], capability_models: { tts: 'm-cap' }, config: { default_model: 'm-ops' } }
    expect(resolveProviderDefaultModel(p, 'tts')).toBe('m-cap')
  })

  it('8c. 单能力 provider 无能力声明时 provider 级默认仍生效（兼容存量）', () => {
    const p = { id: 'tts-ops', category: 'tts', models: ['m1', 'm2'], config: { default_model: 'm2' } }
    expect(resolveProviderDefaultModel(p, 'tts')).toBe('m2')
  })

  it('9. 非法输入返回空字符串，不抛错', () => {
    expect(resolveProviderDefaultModel(null, 'llm')).toBe('')
    expect(resolveProviderDefaultModel(undefined, 'llm')).toBe('')
    expect(resolveProviderDefaultModel('str', 'llm')).toBe('')
    expect(resolveProviderDefaultModel({}, 'llm')).toBe('')
  })

  it('10. models 中空白/非字符串项被忽略', () => {
    const dirty = { id: 'x', category: 'llm', models: ['', '  ', null, 42, 'valid'] }
    expect(resolveProviderDefaultModel(dirty, 'llm')).toBe('valid')
  })

  it('11. 用户默认 trim 后匹配 models', () => {
    expect(resolveProviderDefaultModel({ id: 'x', category: 'llm', models: ['gpt-4o'], config: { user_default_model: '  gpt-4o  ' } }, 'llm')).toBe('gpt-4o')
  })

  it('12. capability_models 为字符串（异常构造）时安全降级', () => {
    expect(resolveProviderDefaultModel({ id: 'x', category: 'llm', models: ['a'], capability_models: 'oops' }, 'llm')).toBe('a')
  })
})
