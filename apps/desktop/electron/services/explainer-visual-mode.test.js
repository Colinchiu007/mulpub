// @vitest-environment node
// @ts-check
/**
 * explainer-visual-mode.test.js — 「画面模式」行为锁（AI 生成 / 动效标题卡）
 *
 * ## 要锁住的三条不变量
 *
 * ① **不调 provider**（title-card 模式）
 *    这是「不消耗积分」的**唯一可执行判据**。桌面端当前**没有积分扣减点**，
 *    唯一可观测的成本归集入口是「provider 调用的副作用」：
 *      model-provider-manager.callAdapter → _writeLog → model_provider_logs
 *        → usage-reporter 聚合 → POST /api/v1/usage/ingest → ops-center model_usage_daily.cost
 *    ⇒ 不调 provider ⇒ 整条链不发生 ⇒ 不产生成本归集 ⇒ 不消耗积分/额度。
 *    ⇒ 反过来说：**显式去跳过某个记账调用是错的**（那是全局副作用点，动了会污染所有 provider 调用）。
 *
 * ② **provider 必须被显式置空**（不是「不设」）
 *    story2video-stages 的 resolvedImageProvider 在 hasAssetGenerator 为真时
 *    **总会**回落模型设置里的默认 image provider ⇒ 只「不设 imageProvider」关不掉 AI 生图。
 *    这条是 ① 能否成立的前提，单独断言。
 *
 * ③ **AI 模式零行为变化**
 *    默认路径（含 provider 失败后的 degraded 占位图兜底）一字不变 ⇒ 回归锁。
 *
 * ## 反证纪律
 * 删掉 story2video-stages 里「标题卡模式把 resolvedImageProvider 置空」那一行，
 * 本文件立即变红（image_provider 会重新变成默认 provider id）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// ── 渲染器桩：不让测试真跑 ffmpeg ──────────────────────────────────────────
// 只拦 title-card-renderer 这一个模块；asset-generator 本身走真实实现。
const renderTitleCardMock = vi.fn(async () => ({ size: 4096, width: 1280, height: 720 }))
__registerMock('./title-card-renderer', {
  renderTitleCard: renderTitleCardMock,
  escapeDrawtextText: (text) => String(text == null ? '' : text),
})

const {
  registerStory2VideoStages,
  STORY2VIDEO_STAGE_TYPES,
} = require('./story2video-stages')
const { registerExplainerStages, EXPLAINER_STAGE_TYPES } = require('./explainer-stages')
const { AssetGenerator } = require('./asset-generator')
const { cleanupRunInputDir, STORY2VIDEO_TEMP_DIR } = require('./story2video-paths')
const fs = require('fs')
const os = require('os')
const path = require('path')

fs.mkdirSync(STORY2VIDEO_TEMP_DIR, { recursive: true })

const SANDBOX = path.join(os.tmpdir(), 'multi-publish-explainer-visual-mode-' + process.pid)

/**
 * 跑一次 story2video 的 generate_assets，返回 generateImage 收到的第一个 opts。
 * @param {{ params?: object, stageOptions?: object, scenes?: any[] }} input
 * @returns {Promise<object|null>}
 */
async function captureImageOpts({ params = {}, stageOptions = {}, scenes }) {
  const generateImage = vi.fn(async (_prompt, opts) => ({
    code: 0,
    data: { path: 'image-' + opts.index + '.png' },
  }))
  const assetGenerator = {
    generateImage,
    generateTTS: vi.fn(async (_text, { index }) => ({
      code: 0,
      data: { path: 'audio-' + index + '.mp3', duration: 2 },
    })),
  }
  const stageExecutor = new Map()
  const pipeline = {
    stageExecutor: {
      executors: stageExecutor,
      register(type, fn) { stageExecutor.set(type, fn) },
    },
    _assetGenerator: assetGenerator,
    // 配一个「模型设置里的默认 image provider」：hasAssetGenerator 为真时
    // resolvedImageProvider 总会回落它 ⇒ 这样才能精确断言
    // 「AI 模式回落默认 provider」与「标题卡模式显式置空」这条对照。
    aiGenerator: {
      _modelProviderManager: {
        getDefault: (type) => (type === 'image' ? { id: 'default-image-provider' } : null),
      },
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    registerStageExecutor(type, fn) {
      stageExecutor.set(type, fn)
      return { success: true }
    },
  }
  registerStory2VideoStages(pipeline)
  const fn = stageExecutor.get(STORY2VIDEO_STAGE_TYPES.GENERATE_ASSETS)
  fn.optimizeExecutor = stageExecutor.get(STORY2VIDEO_STAGE_TYPES.OPTIMIZE)
  fn.sceneContextExecutor = stageExecutor.get(STORY2VIDEO_STAGE_TYPES.SCENE_CONTEXT)
  fn.finalizeAssetsExecutor = stageExecutor.get(STORY2VIDEO_STAGE_TYPES.FINALIZE_ASSETS)

  await fn({
    stage: { options: { concurrency: 1, ...stageOptions } },
    params,
    context: {
      split: scenes || [{ text: '第一段旁白' }],
      optimize: ['第一段的视觉提示词'],
    },
    serviceBus: {},
  })
  const call = generateImage.mock.calls[0]
  return call ? call[1] : null
}

/**
 * 跑一次 explainer 的 generate_assets，返回内层 story2video_generate_assets 收到的入参。
 * @param {{ params?: object, stageOptions?: object, scenes?: any[] }} input
 */
async function captureInnerCall({ params = {}, stageOptions = {}, scenes } = {}) {
  const inner = vi.fn(async () => ({ success: true, output: { scenes: [] } }))
  const executors = new Map()
  const pipeline = {
    stageExecutor: {
      executors,
      register(type, fn) { executors.set(type, fn) },
      execute: inner,
    },
    aiGenerator: {
      _modelProviderManager: { getDefault: () => null },
      generateWithDefault: vi.fn(async () => ({ content: 'x' })),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    registerStageExecutor(type, fn) {
      executors.set(type, fn)
      return { success: true }
    },
  }
  registerExplainerStages(pipeline)
  const fn = executors.get(EXPLAINER_STAGE_TYPES.GENERATE_ASSETS)
  await fn({
    runId: 'run_visual_mode',
    stage: { options: stageOptions },
    params,
    context: { scenes: scenes || [{ prompt: 'p1', text: 't1', duration: 6 }] },
    onProgress: vi.fn(),
  })
  return inner.mock.calls[0] ? inner.mock.calls[0][0] : null
}

describe('画面模式 · story2video generate_assets 透传', () => {
  afterEach(() => {
    cleanupRunInputDir('run')
  })

  it("visualMode='title-card' → 传 local_render='title-card' 且 image_provider 被显式置空", async () => {
    const opts = await captureImageOpts({ params: { visualMode: 'title-card' } })
    expect(opts).toBeTruthy()
    expect(opts.local_render).toBe('title-card')
    // ① provider 必须被**显式置空**（不是「不设」）：hasAssetGenerator 为真时
    //    resolvedImageProvider 总会回落模型设置里的默认 image provider。
    expect(opts.image_provider).toBe('')
  })

  it("visualMode='title-card' → 标题取场景旁白(text)、副标题取画面提示词", async () => {
    const opts = await captureImageOpts({
      params: { visualMode: 'title-card' },
      scenes: [{ text: '拖延不是懒，是情绪调节失败' }],
    })
    expect(opts.title).toBe('拖延不是懒，是情绪调节失败')
    expect(opts.subtitle).toBe('第一段的视觉提示词')
  })

  it('默认（未传 visualMode）→ 不带 local_render，image_provider 照旧回落默认 provider', async () => {
    const opts = await captureImageOpts({ params: {} })
    expect(opts.local_render).toBeUndefined()
    expect(opts.image_provider).toBe('default-image-provider')
  })

  it("visualMode='ai' → 与默认路径完全一致（不触发本地渲染，provider 照旧回落默认）", async () => {
    const opts = await captureImageOpts({ params: { visualMode: 'ai' } })
    expect(opts.local_render).toBeUndefined()
    expect(opts.image_provider).toBe('default-image-provider')
  })
})

describe('画面模式 · explainer generate_assets 透传', () => {
  it("params.visualMode='title-card' → innerOptions.visualMode='title-card'（下游据此关掉 provider）", async () => {
    const call = await captureInnerCall({ params: { visualMode: 'title-card' } })
    expect(call).toBeTruthy()
    expect(call.stage.options.visualMode).toBe('title-card')
  })

  it('未传 visualMode → innerOptions 不带 visualMode（下游走默认 AI 生图路径）', async () => {
    const call = await captureInnerCall({ params: {} })
    expect(call).toBeTruthy()
    expect(call.stage.options.visualMode).toBeUndefined()
  })

  it("visualMode='title-card' → **不填**默认 image provider（第二道防线：两层都不提供 provider）", async () => {
    const ai = {
      _modelProviderManager: {
        getDefault: (type) => (type === 'image' ? { id: 'default-image-provider', models: ['image-01'] } : null),
      },
      generateWithDefault: vi.fn(async () => ({ content: 'x' })),
    }
    const inner = vi.fn(async () => ({ success: true, output: { scenes: [] } }))
    const executors = new Map()
    const pipeline = {
      stageExecutor: { executors, register(type, fn) { executors.set(type, fn) }, execute: inner },
      aiGenerator: ai,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      registerStageExecutor(type, fn) { executors.set(type, fn); return { success: true } },
    }
    registerExplainerStages(pipeline)
    const fn = executors.get(EXPLAINER_STAGE_TYPES.GENERATE_ASSETS)
    await fn({
      runId: 'run_visual_mode',
      stage: { options: {} },
      params: { visualMode: 'title-card' },
      context: { scenes: [{ prompt: 'p1', text: 't1', duration: 6 }] },
    })
    const opts = inner.mock.calls[0][0].stage.options
    expect(opts.visualMode).toBe('title-card')
    expect(opts.imageProvider).toBeUndefined()
    expect(opts.imageModel).toBeUndefined()
    // 对照：AI 模式仍然填默认 provider（老行为一字不变）
    const inner2 = vi.fn(async () => ({ success: true, output: { scenes: [] } }))
    const executors2 = new Map()
    const pipeline2 = {
      stageExecutor: { executors: executors2, register(type, fn) { executors2.set(type, fn) }, execute: inner2 },
      aiGenerator: ai,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      registerStageExecutor(type, fn) { executors2.set(type, fn); return { success: true } },
    }
    registerExplainerStages(pipeline2)
    await executors2.get(EXPLAINER_STAGE_TYPES.GENERATE_ASSETS)({
      runId: 'run_visual_mode_ai',
      stage: { options: {} },
      params: {},
      context: { scenes: [{ prompt: 'p1', text: 't1', duration: 6 }] },
    })
    const opts2 = inner2.mock.calls[0][0].stage.options
    expect(opts2.imageProvider).toBe('default-image-provider')
  })
})

describe('画面模式 · AssetGenerator 本地渲染（不调 provider = 不消耗积分）', () => {
  let gen

  beforeEach(() => {
    renderTitleCardMock.mockClear()
    fs.mkdirSync(SANDBOX, { recursive: true })
    gen = new AssetGenerator({
      outputDir: SANDBOX,
      ffmpeg: '/usr/bin/ffmpeg',
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
  })

  afterEach(() => {
    fs.rmSync(SANDBOX, { recursive: true, force: true })
  })

  it("local_render='title-card' → _tryProviderImage 完全不被调用（不产生模型调用日志）", async () => {
    const spy = vi.spyOn(gen, '_tryProviderImage')
    const result = await gen.generateImage('画面提示词', {
      local_render: 'title-card',
      title: '旁白文案',
      subtitle: '画面提示词',
      index: 0,
      aspect_ratio: '16:9',
    })
    expect(spy).not.toHaveBeenCalled()
    expect(result.code).toBe(0)
    // source 必须是新值 'title-card' 且 degraded=false：
    //   标题卡是**用户主动选的正常产物**，若沿用 'ffmpeg-placeholder'+degraded:true，
    //   会被发布侧「占位图不得当成功封面」那道防线误判成失败产物。
    expect(result.data.source).toBe('title-card')
    expect(result.data.degraded).toBe(false)
  })

  it("local_render='title-card' → 标题取 opts.title、副标题取 opts.subtitle", async () => {
    await gen.generateImage('画面提示词', {
      local_render: 'title-card',
      title: '旁白文案',
      subtitle: '画面提示词',
      index: 1,
      aspect_ratio: '16:9',
    })
    expect(renderTitleCardMock).toHaveBeenCalledTimes(1)
    const arg = renderTitleCardMock.mock.calls[0][0]
    expect(arg.title).toBe('旁白文案')
    expect(arg.subtitle).toBe('画面提示词')
  })

  it('未带 local_render → provider 失败后仍落回 degraded 占位卡（老行为一字不变）', async () => {
    vi.spyOn(gen, '_tryProviderImage').mockResolvedValue(null)
    const result = await gen.generateImage('画面提示词', { index: 2, aspect_ratio: '16:9' })
    expect(result.code).toBe(0)
    expect(result.data.source).toBe('ffmpeg-placeholder')
    expect(result.data.degraded).toBe(true)
  })
})
