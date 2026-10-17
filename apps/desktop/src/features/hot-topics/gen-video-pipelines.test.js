// @ts-check
/**
 * 热门选题「生成视频」流水线目录纯函数（hot-topics-pipeline-picker，2026-10-17）。
 * 只测数据决策，不挂 Vue。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GEN_VIDEO_PIPELINE,
  STORY2VIDEO_PIPELINE,
  PIPELINE_DISABLED_REASON_KEYS,
  getPipelineRunMode,
  isPipelineRunnableFromTopic,
  getPipelineDisabledReasonKey,
  getPipelineStageNames,
  normalizePipelineList,
  buildGenVideoPipelineOptions,
  buildGenVideoStartParams,
  listRunnablePipelineNames,
} from './gen-video-pipelines'

/** 与主进程 PipelineEngine.listPipelines() 顺序一致的夹具（story2video 被优先排列）。 */
const PIPELINE_LIST = [
  { name: 'story2video-compose', available: true, category: 'generated' },
  { name: 'animated-explainer', available: true, category: 'generated' },
  { name: 'talking-head', available: true, category: 'talking_head' },
  { name: 'cinematic', available: true, category: 'cinematic' },
  { name: 'animation', available: true, category: 'animation' },
  { name: 'avatar-spokesperson', available: true, category: 'talking_head' },
  { name: 'character-animation', available: true, category: 'animation' },
  { name: 'clip-factory', available: true, category: 'screen_recording' },
  { name: 'documentary-montage', available: true, category: 'cinematic' },
  { name: 'hybrid', available: true, category: 'hybrid' },
  { name: 'localization-dub', available: true, category: 'hybrid' },
  { name: 'podcast-repurpose', available: true, category: 'hybrid' },
  { name: 'screen-demo', available: false, category: 'screen_recording' },
  { name: 'framework-smoke', available: true, category: 'custom' },
  { name: 'film-engineering', available: true, category: 'generated' },
]

const t = (key) => 'T:' + key

describe('gen-video-pipelines — 运行模式与可执行性', () => {
  it('classifies story2video / text-auto / needs-media / dedicated / internal / unknown', () => {
    expect(getPipelineRunMode('story2video-compose')).toBe('story2video')
    expect(getPipelineRunMode('animated-explainer')).toBe('text-auto')
    expect(getPipelineRunMode('documentary-montage')).toBe('text-auto')
    expect(getPipelineRunMode('animation')).toBe('text-auto')
    expect(getPipelineRunMode('avatar-spokesperson')).toBe('text-auto')
    expect(getPipelineRunMode('character-animation')).toBe('text-auto')
    expect(getPipelineRunMode('hybrid')).toBe('text-auto')
    expect(getPipelineRunMode('talking-head')).toBe('needs-media')
    expect(getPipelineRunMode('podcast-repurpose')).toBe('needs-media')
    expect(getPipelineRunMode('film-engineering')).toBe('dedicated')
    expect(getPipelineRunMode('framework-smoke')).toBe('internal')
    expect(getPipelineRunMode('screen-demo')).toBe('unsupported')
    expect(getPipelineRunMode('custom-dynamic-pipeline')).toBe('unsupported')
    expect(getPipelineRunMode('')).toBe('unsupported')
    expect(getPipelineRunMode(null)).toBe('unsupported')
  })

  it('only text-driven pipelines are runnable from a topic; media/dedicated/internal/unknown are not', () => {
    expect(isPipelineRunnableFromTopic('story2video-compose', true)).toBe(true)
    for (const name of ['animated-explainer', 'documentary-montage', 'animation', 'avatar-spokesperson', 'character-animation', 'hybrid']) {
      expect(isPipelineRunnableFromTopic(name, true)).toBe(true)
    }
    for (const name of ['talking-head', 'cinematic', 'clip-factory', 'localization-dub', 'podcast-repurpose', 'film-engineering', 'framework-smoke', 'screen-demo', 'custom-x']) {
      expect(isPipelineRunnableFromTopic(name, true)).toBe(false)
    }
    // 主进程声明 available=false（无执行引擎）时，文本驱动也不可执行
    expect(isPipelineRunnableFromTopic('animated-explainer', false)).toBe(false)
    expect(listRunnablePipelineNames()).toEqual([
      'story2video-compose', 'animated-explainer', 'documentary-montage',
      'animation', 'avatar-spokesperson', 'character-animation', 'hybrid',
    ])
  })

  it('maps disabled reasons to the four message keys (+ unavailable priority)', () => {
    expect(getPipelineDisabledReasonKey('story2video-compose', true)).toBeNull()
    expect(getPipelineDisabledReasonKey('animated-explainer', true)).toBeNull()
    expect(getPipelineDisabledReasonKey('talking-head', true)).toBe(PIPELINE_DISABLED_REASON_KEYS['needs-media'])
    expect(getPipelineDisabledReasonKey('film-engineering', true)).toBe(PIPELINE_DISABLED_REASON_KEYS.dedicated)
    expect(getPipelineDisabledReasonKey('framework-smoke', true)).toBe(PIPELINE_DISABLED_REASON_KEYS.internal)
    expect(getPipelineDisabledReasonKey('screen-demo', true)).toBe(PIPELINE_DISABLED_REASON_KEYS.unsupported)
    expect(getPipelineDisabledReasonKey('screen-demo', false)).toBe(PIPELINE_DISABLED_REASON_KEYS.unavailable)
    expect(getPipelineDisabledReasonKey('animated-explainer', false)).toBe(PIPELINE_DISABLED_REASON_KEYS.unavailable)
    expect(getPipelineDisabledReasonKey('brand-new-pipeline', true)).toBe(PIPELINE_DISABLED_REASON_KEYS.unsupported)
  })

  it('returns real stage names for the modal and empty array for unknown', () => {
    expect(getPipelineStageNames('animated-explainer')).toEqual([
      'research', 'proposal', 'script', 'scenes', 'assets', 'editing', 'compose', 'publish',
    ])
    expect(getPipelineStageNames('story2video-compose')).toEqual([
      'split', 'scene_context', 'optimize', 'select_video_scenes', 'generate_assets', 'compose', 'publish',
    ])
    expect(getPipelineStageNames('animation')).toEqual(['concept', 'storyboard', 'animate', 'render'])
    expect(getPipelineStageNames('unknown-pipeline')).toEqual([])
    expect(getPipelineStageNames(null)).toEqual([])
  })
})

describe('gen-video-pipelines — 清单归一化与选项排序', () => {
  it('drops invalid/duplicate entries and preserves main-process order', () => {
    expect(normalizePipelineList([
      null, 'x', [], { name: '' }, { name: '  ' }, { name: 'a', available: true },
      { name: 'a' }, { name: 'b', available: 'yes' },
    ])).toEqual([
      { name: 'a', available: true },
      { name: 'b', available: undefined },
    ])
    expect(normalizePipelineList(null)).toEqual([])
    expect(normalizePipelineList({})).toEqual([])
  })

  it('puts runnable pipelines first (preserving order), disabled after with reason text, default flagged', () => {
    const options = buildGenVideoPipelineOptions(PIPELINE_LIST, t)
    expect(options).toHaveLength(PIPELINE_LIST.length)
    const enabledNames = options.filter(o => o.enabled).map(o => o.name)
    expect(enabledNames).toEqual([
      'story2video-compose', 'animated-explainer', 'animation',
      'avatar-spokesperson', 'character-animation', 'documentary-montage', 'hybrid',
    ])
    const disabledNames = options.filter(o => !o.enabled).map(o => o.name)
    expect(disabledNames).toEqual([
      'talking-head', 'cinematic', 'clip-factory', 'localization-dub',
      'podcast-repurpose', 'screen-demo', 'framework-smoke', 'film-engineering',
    ])
    const byName = Object.fromEntries(options.map(o => [o.name, o]))
    expect(byName[DEFAULT_GEN_VIDEO_PIPELINE].isDefault).toBe(true)
    expect(options.filter(o => o.isDefault)).toHaveLength(1)
    expect(byName['animated-explainer'].isDefault).toBe(false)
    // 标签使用 pipeline-labels 的 i18n key（此处 t 为 stub）
    expect(byName['animated-explainer'].label).toBe('T:pipelines.names.animated-explainer')
    expect(byName['animated-explainer'].categoryLabel).toBe('T:pipelines.categories.generated')
    // 禁用原因：key + 已翻译文本双份（UI 用 reasonText，断言用 key）
    expect(byName['cinematic'].reasonKey).toBe(PIPELINE_DISABLED_REASON_KEYS['needs-media'])
    expect(byName['cinematic'].reasonText).toBe('T:' + PIPELINE_DISABLED_REASON_KEYS['needs-media'])
    expect(byName['screen-demo'].reasonKey).toBe(PIPELINE_DISABLED_REASON_KEYS.unavailable)
    expect(byName['story2video-compose'].reasonKey).toBeNull()
  })

  it('falls back to a single default option when the list is empty (caller decides)', () => {
    // 空清单本身返回空数组：回退项由 UI 在 IPC 失败分支显式构造，避免「空清单」和「加载失败」
    // 两种语义被混在一个函数里。
    expect(buildGenVideoPipelineOptions([], t)).toEqual([])
  })
})

describe('gen-video-pipelines — 启动参数构造', () => {
  it('builds the legacy story2video params (full text config, no top-level output fields)', () => {
    const params = buildGenVideoStartParams({
      pipelineName: 'story2video-compose',
      text: '改写后的完整文案',
      snapshot: null,
      uiLocale: 'zh-CN',
    })
    expect(params).toEqual({
      text: '改写后的完整文案',
      inputMode: 'text',
      checkpointPolicy: 'none',
      autoAdvance: true,
      background: true,
      uiLocale: 'zh-CN',
      story2videoTextConfig: expect.objectContaining({
        version: 1,
        mode: 'text',
        prompt: '改写后的完整文案',
        size: '720x1280',
      }),
    })
    expect(params).not.toHaveProperty('resolution')
    expect(params).not.toHaveProperty('aspectRatio')
  })

  it('builds text-auto params aligned with CreateView.startExplainerPipeline', () => {
    const params = buildGenVideoStartParams({
      pipelineName: 'animated-explainer',
      text: '解释视频文案',
      snapshot: { s2vOutputConfig: { resolution: '1920x1080', fps: 24, format: 'webm' } },
      uiLocale: 'en-US',
    })
    expect(params).toEqual({
      text: '解释视频文案',
      inputMode: 'text',
      checkpointPolicy: 'none',
      autoAdvance: true,
      background: true,
      uiLocale: 'en-US',
      storyboardMode: 'auto',
      style: 'clean-professional',
      resolution: '1920x1080',
      aspectRatio: '16:9',
      fps: 24,
      format: 'webm',
    })
    expect(params).not.toHaveProperty('story2videoTextConfig')
  })

  it('falls back to portrait defaults for invalid/absent snapshots', () => {
    const params = buildGenVideoStartParams({
      pipelineName: 'hybrid',
      text: '混合流水线文案',
      snapshot: { s2vOutputConfig: 'not-an-object' },
    })
    expect(params).toEqual(expect.objectContaining({
      resolution: '720x1280', aspectRatio: '9:16', fps: 30, format: 'mp4',
    }))
  })

  it('refuses to build params for non-runnable pipelines or empty text', () => {
    expect(buildGenVideoStartParams({ pipelineName: 'cinematic', text: 'x' })).toBeNull()
    expect(buildGenVideoStartParams({ pipelineName: 'film-engineering', text: 'x' })).toBeNull()
    expect(buildGenVideoStartParams({ pipelineName: 'unknown', text: 'x' })).toBeNull()
    expect(buildGenVideoStartParams({ pipelineName: 'animated-explainer', text: '   ' })).toBeNull()
    expect(buildGenVideoStartParams({ pipelineName: '', text: 'x' })).toBeNull()
    expect(buildGenVideoStartParams()).toBeNull()
    expect(STORY2VIDEO_PIPELINE).toBe('story2video-compose')
  })
})
