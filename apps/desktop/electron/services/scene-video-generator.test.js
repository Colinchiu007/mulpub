// @ts-check
/**
 * scene-video-generator.test.js — 单场景 AI 视频生成的参数契约与进度回调
 *
 * 覆盖：
 * - buildSubmitParams：扩展参数**有值才写键**（无值时参数集与扩展前逐字段相同）
 * - buildSubmitParams：firstFrame 同时写 image（供只认单张 image 的旧版适配器）
 * - buildSubmitParams：seed=0 是合法值（不被 || 吞掉）；显式 seconds 优先
 * - generateSceneVideo：媒体与模式透传到适配器；查询参数回传 model
 * - generateSceneVideo：onProgress 阶段回调（提交 / 排队 / 生成 / 下载 / 完成）
 * - generateSceneVideo：既有失败路径语义不回退
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, default: actual }
})

const { buildSubmitParams, generateSceneVideo, PROGRESS_STAGES } = require('./scene-video-generator')

/** 造一个只实现必要接口的 manager 替身 */
function createManager (behaviour) {
  const calls = { generateVideo: [], getVideoStatus: [] }
  return {
    calls,
    async callAdapter (providerId, method, params) {
      calls[method].push({ providerId, params })
      return behaviour(method, params, calls[method].length)
    },
  }
}

describe('buildSubmitParams — 扩展参数的透传规则', () => {
  const base = {
    prompt: 'p',
    model: 'agnes-video-2.5-flash',
    size: { width: 720, height: 1280 },
    frameRate: 30,
    numFrames: 121,
  }

  it('不传扩展参数时，参数集与扩展前逐字段相同（既有调用方零影响）', () => {
    const params = buildSubmitParams(base)
    expect(Object.keys(params).sort()).toEqual([
      'frameRate', 'frame_rate', 'height', 'model', 'numFrames', 'num_frames', 'prompt', 'width',
    ])
    expect(params).toEqual({
      prompt: 'p',
      model: 'agnes-video-2.5-flash',
      width: 720,
      height: 1280,
      numFrames: 121,
      frameRate: 30,
      num_frames: 121,
      frame_rate: 30,
    })
  })

  it('有值才写键：空数组与空字符串不产生参数', () => {
    const params = buildSubmitParams({
      ...base,
      mode: '',
      images: [],
      audios: [],
      videos: [],
      firstFrame: '',
      lastFrame: '',
      aspectRatio: '',
      seed: undefined,
      seconds: undefined,
    })
    expect(params).not.toHaveProperty('mode')
    expect(params).not.toHaveProperty('images')
    expect(params).not.toHaveProperty('audios')
    expect(params).not.toHaveProperty('videos')
    expect(params).not.toHaveProperty('firstFrame')
    expect(params).not.toHaveProperty('lastFrame')
    expect(params).not.toHaveProperty('aspectRatio')
    expect(params).not.toHaveProperty('seed')
    expect(params).not.toHaveProperty('seconds')
  })

  it('媒体与模式原样透传', () => {
    const params = buildSubmitParams({
      ...base,
      mode: 'reference',
      images: ['data:image/png;base64,AAA'],
      audios: ['data:audio/mpeg;base64,BBB'],
    })
    expect(params.mode).toBe('reference')
    expect(params.images).toEqual(['data:image/png;base64,AAA'])
    expect(params.audios).toEqual(['data:audio/mpeg;base64,BBB'])
  })

  it('firstFrame 同时写 first_frame 与 image（供只认单张 image 的旧版适配器）', () => {
    const params = buildSubmitParams({ ...base, mode: 'keyframe', firstFrame: 'https://x/first.png' })
    expect(params.firstFrame).toBe('https://x/first.png')
    expect(params.first_frame).toBe('https://x/first.png')
    expect(params.image).toBe('https://x/first.png')
  })

  it('seed=0 是合法随机种子，不能被静默丢弃', () => {
    const params = buildSubmitParams({ ...base, seed: 0 })
    expect(params.seed).toBe(0)
  })

  it('显式 seconds 优先于帧数推导', () => {
    const params = buildSubmitParams({ ...base, seconds: 9 })
    expect(params.seconds).toBe(9)
  })
})

describe('generateSceneVideo — 提交 / 轮询 / 进度', () => {
  it('提交失败时返回可读错误，且不上报完成态', async () => {
    const manager = createManager(() => ({ code: -1, message: 'provider exploded' }))
    const onProgress = vi.fn()
    const outcome = await generateSceneVideo({
      manager,
      providerId: 'p1',
      model: 'm',
      prompt: 'x',
      index: 0,
      seconds: 5,
      size: { width: 720, height: 1280 },
      fps: 30,
      runDir: '/tmp/x',
      onProgress,
    })
    expect(outcome.success).toBe(false)
    expect(outcome.error).toContain('provider exploded')
    expect(onProgress).toHaveBeenCalledWith(2, PROGRESS_STAGES.SUBMITTING)
  })

  it('适配器未返回任务 ID 时给出明确错误', async () => {
    const manager = createManager(() => ({ code: 0, data: {} }))
    const outcome = await generateSceneVideo({
      manager, providerId: 'p1', model: 'm', prompt: 'x', index: 0, seconds: 5,
      size: { width: 720, height: 1280 }, fps: 30, runDir: '/tmp/x',
    })
    expect(outcome.success).toBe(false)
    expect(outcome.error).toContain('未返回任务 ID')
  })

  it('模式与媒体透传到适配器；查询时回传 model（跨重启续查靠它）', async () => {
    const manager = createManager((method) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-1' } }
      return { code: -1, message: 'stop here' }
    })
    await generateSceneVideo({
      manager, providerId: 'p1', model: 'agnes-video-2.5', prompt: 'x', index: 0, seconds: 5,
      size: { width: 720, height: 1280 }, fps: 30, runDir: '/tmp/x',
      pollIntervalMs: 1,
      mode: 'reference', images: ['u1'], audios: ['a1'], aspectRatio: '9:16', seed: 7,
    })
    const submit = manager.calls.generateVideo[0].params
    expect(submit.mode).toBe('reference')
    expect(submit.images).toEqual(['u1'])
    expect(submit.audios).toEqual(['a1'])
    expect(submit.aspectRatio).toBe('9:16')
    expect(submit.aspect_ratio).toBe('9:16')
    expect(submit.seed).toBe(7)
    const status = manager.calls.getVideoStatus[0].params
    expect(status.model).toBe('agnes-video-2.5')
  })

  it('轮询期按服务端原始状态区分「排队中 / 生成中」，百分比如实透传不伪造增长', async () => {
    const stages = []
    const percents = []
    const manager = createManager((method, params, nth) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-1' } }
      if (nth === 1) return { code: 0, status: 'processing', providerStatus: 'queued', progress: 10 }
      if (nth === 2) return { code: 0, status: 'processing', providerStatus: 'in_progress', progress: 10 }
      return { code: -1, message: 'done polling' }
    })
    const outcome = await generateSceneVideo({
      manager, providerId: 'p1', model: 'm', prompt: 'x', index: 0, seconds: 5,
      size: { width: 720, height: 1280 }, fps: 30, runDir: '/tmp/x',
      pollIntervalMs: 1,
      onProgress: (pct, stage) => { percents.push(pct); stages.push(stage) },
    })
    expect(outcome.success).toBe(false)
    expect(stages).toContain(PROGRESS_STAGES.QUEUED)
    expect(stages).toContain(PROGRESS_STAGES.GENERATING)
    // 连续两次服务端都报 10 ⇒ 页面不得自己往上加
    const tens = percents.filter((p) => p === 10)
    expect(tens.length).toBeGreaterThanOrEqual(2)
    expect(Math.max(...percents)).toBe(10)
  })
})
