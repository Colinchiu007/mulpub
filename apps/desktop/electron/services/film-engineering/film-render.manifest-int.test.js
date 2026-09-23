// @ts-check
'use strict'
/**
 * film_render renderManifest 集成测试（任务 5.3，film-full-corpus-production）
 *
 * 真实 ffmpeg/ffprobe fixture：构造两个临时 run 目录 + 一个"下载"目录的三源混合
 * manifest，直拷与归一两条路径各出片一次，ffprobe 实测成片时长 = Σ 片段时长（±0.5s）。
 * 环境缺二进制时整组 skip（捆绑 ffmpeg-ffprobe-static；CI build job 自带）。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { PipelineEngine } = require('../pipeline-engine')
const { registerFilmRenderStage, getFilmMediaRoot } = require('./film-render')
const { getFilmRunDir } = require('./video-gen')
const { findFfmpeg, findFfprobe } = require('../media-tool-paths')

const FFMPEG = findFfmpeg()
const FFPROBE = findFfprobe()
const hasTools = Boolean(FFMPEG && FFPROBE)

function makeClip (outPath, width, height, seconds) {
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=duration=' + seconds + ':size=' + width + 'x' + height + ':rate=24',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    outPath,
  ], { timeout: 120000 })
}

function probeDuration (p) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf8', timeout: 60000 })
  return parseFloat(String(out).trim())
}

function mkRenderFn () {
  const engine = new PipelineEngine({ log: { info () {}, warn () {}, error () {} } })
  engine.stageExecutor = { _customExecutors: new Map(), register (type, fn) { this._customExecutors.set(type, fn) } }
  engine._stageExecutors = engine.stageExecutor._customExecutors
  registerFilmRenderStage(engine)
  return engine._stageExecutors.get('film_render')
}

describe.skipIf(!hasTools)('film_render renderManifest 集成（真实 ffmpeg，任务 5.3）', () => {
  const cleanup = []
  beforeAll(() => { fs.mkdirSync(getFilmMediaRoot(), { recursive: true }) })
  afterAll(() => {
    for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 忽略 */ } }
  })
  function mk (tag) {
    const d = fs.mkdtempSync(path.join(getFilmMediaRoot(), tag + '-'))
    cleanup.push(d)
    return d
  }
  function entry (shotId, p, orderIndex, sourceKind) {
    return { shotId, path: p, orderIndex, sourceKind }
  }

  it('三源混合 manifest 规格一致 → -c copy 直拷，ffprobe 时长 = Σ 片段（±0.5s）', async () => {
    const runA = mk('intA')
    const runB = mk('intB')
    const recycled = mk('intDL') // 模拟下载回收目录（sourceKind: downloaded）
    const c0 = path.join(runA, 'shot_000.mp4')
    const c1 = path.join(recycled, 'shot_001.mp4')
    const c2 = path.join(runB, 'shot_002.mp4')
    makeClip(c0, 1280, 720, 2)
    makeClip(c1, 1280, 720, 2)
    makeClip(c2, 1280, 720, 2)
    const runId = 't-int-copy-' + Date.now()
    const runDir = getFilmRunDir(runId)
    fs.mkdirSync(runDir, { recursive: true })
    cleanup.push(runDir)
    const fn = mkRenderFn()
    const result = await fn({
      runId, stage: { name: 'render', type: 'film_render', options: {} },
      params: { aspect: '16x9' },
      context: { renderManifest: [
        entry('s2', c2, 2, 'generated'),
        entry('s0', c0, 0, 'generated'),
        entry('s1', c1, 1, 'downloaded'),
      ] },
      onProgress: () => {},
    })
    expect(result.success).toBe(true)
    expect(result.output.mode).toBe('copy')
    expect(result.output.source).toBe('renderManifest')
    expect(result.output.clipCount).toBe(3)
    const d = probeDuration(result.output.finalPath)
    expect(d).toBeGreaterThan(6 - 0.5)
    expect(d).toBeLessThan(6 + 0.5)
  }, 180000)

  it('manifest 混规格（720p+360p）→ normalize 最小归一路径出片，时长 = Σ（±0.5s）', async () => {
    const runA = mk('ixA')
    const recycled = mk('ixDL')
    const c0 = path.join(runA, 'shot_000.mp4')
    const c1 = path.join(recycled, 'shot_001.mp4')
    makeClip(c0, 1280, 720, 2)
    makeClip(c1, 640, 360, 2)
    const runId = 't-int-norm-' + Date.now()
    const runDir = getFilmRunDir(runId)
    fs.mkdirSync(runDir, { recursive: true })
    cleanup.push(runDir)
    const fn = mkRenderFn()
    const result = await fn({
      runId, stage: { name: 'render', type: 'film_render', options: {} },
      params: { aspect: '16x9' },
      context: { renderManifest: [
        entry('n0', c0, 0, 'generated'),
        entry('n1', c1, 1, 'downloaded'),
      ] },
      onProgress: () => {},
    })
    expect(result.success).toBe(true)
    expect(result.output.mode).toBe('normalize')
    const d = probeDuration(result.output.finalPath)
    expect(d).toBeGreaterThan(4 - 0.5)
    expect(d).toBeLessThan(4 + 0.5)
  }, 180000)
})
