// @ts-check
'use strict'
/**
 * film_render 成片合成阶段测试（specs「成片合成与产物合同」3 场景 + D7 磁盘信物 / D8 拼接策略）
 *
 * seam 合同：_testProbe / _testRunTool 是 executor 正式测试注入点（与 video-gen _testSleep/_testDownload
 * 同构），生产 StageExecutor 不传自动用真实 ffprobe/ffmpeg；测试禁止依赖环境二进制。
 */
const fs = require('fs')
const path = require('path')
const { PipelineEngine } = require('../pipeline-engine')
const { registerFilmRenderStage, computeMissingShotIndices, collectDiskShots } = require('./film-render')
const { getFilmRunDir } = require('./video-gen')

function makeClipSpec (over = {}) {
  return {
    codec: 'h264', width: 1280, height: 720, fps: '24/1', timebase: '1/12288',
    hasAudio: true, sampleRate: 48000, channels: 2,
    ...over,
  }
}

function makeExecutorCtx (runId, shots, opts = {}) {
  return {
    runId,
    stage: { name: 'render', type: 'film_render', options: {} },
    params: { aspect: '16x9', seconds: 5 },
    context: {
      selectedShots: shots.map((s) => ({ shotId: s.shotId, title: s.shotId, prompt: 'p' })),
      ...(opts.contextPatch || {}),
    },
    onProgress: () => {},
    _testProbe: opts.probe || (async () => makeClipSpec()),
    _testRunTool: opts.runTool || (async () => ''),
  }
}

function seedDisk (runId, indices) {
  const dir = getFilmRunDir(runId)
  fs.mkdirSync(dir, { recursive: true })
  for (const i of indices) {
    fs.writeFileSync(path.join(dir, 'shot_' + String(i).padStart(3, '0') + '.mp4'), 'fake')
  }
  return dir
}

describe('film_render 成片合成', () => {
  let dir
  afterEach(() => {
    if (dir) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响断言 */ }
      dir = null
    }
  })

  describe('纯函数：磁盘产物清单（D7 信磁盘不信内存态）', () => {
    it('collectDiskShots 按选中数量扫描 shot_NNN.mp4，返回存在与缺失清单', () => {
      dir = seedDisk('t-collect', [0, 1, 3])
      const r = collectDiskShots(dir, 4)
      expect(r.files.map((f) => path.basename(f))).toEqual(['shot_000.mp4', 'shot_001.mp4', 'shot_003.mp4'])
      expect(r.missing).toEqual([2])
    })

    it('computeMissingShotIndices：生成阶段内存标失败但磁盘已补（重试覆盖）→ 视为可用', () => {
      dir = seedDisk('t-recovered', [0, 1])
      const videoResults = [
        { index: 0, shotId: 's-0', success: true, path: path.join(dir, 'shot_000.mp4') },
        { index: 1, shotId: 's-1', success: false, error: '超时' },
      ]
      // 磁盘上 shot_001.mp4 存在（重试已覆盖）→ 缺失清单为空
      expect(computeMissingShotIndices(2, dir, videoResults)).toEqual([])
    })

    it('磁盘缺镜 → 列出缺失序号（与内存态无关）', () => {
      dir = seedDisk('t-missing', [0, 2])
      expect(computeMissingShotIndices(3, dir, null)).toEqual([1])
      expect(computeMissingShotIndices(4, dir, null)).toEqual([1, 3])
    })
  })

  describe('阶段执行器', () => {
    let engine
    beforeEach(() => {
      engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
      // 测试桩：捕获注册的执行器函数（生产为真实 StageExecutor.register，同签名）
      engine.stageExecutor = { _customExecutors: new Map(), register(type, fn) { this._customExecutors.set(type, fn) } }
      engine._stageExecutors = engine.stageExecutor._customExecutors
      registerFilmRenderStage(engine)
    })

    it('规格全部一致 → 零重编码直拷（ffprobe 预检 + concat demuxer -c copy），产物 final.mp4', async () => {
      const runId = 't-copy-' + Date.now()
      dir = seedDisk(runId, [0, 1, 2])
      const probes = []
      const runs = []
      const ctx = makeExecutorCtx(runId, [{ shotId: 'a' }, { shotId: 'b' }, { shotId: 'c' }], {
        probe: async (p) => { probes.push(p); return makeClipSpec() },
        runTool: async (binary, args) => {
          runs.push({ binary, args })
          fs.writeFileSync(path.join(dir, 'final.mp4'), 'final')
          return ''
        },
      })
      const fn = engine._stageExecutors.get('film_render')
      expect(fn).toBeTruthy()
      const result = await fn(ctx)
      expect(result.success).toBe(true)
      expect(result.output.finalPath).toBe(path.join(dir, 'final.mp4'))
      expect(result.output.mode).toBe('copy')
      // 每片段都经 ffprobe 预检
      expect(probes.length).toBe(3)
      // 拼接走 concat demuxer 且 -c copy（零重编码）
      const concat = runs[runs.length - 1]
      expect(concat.args).toEqual(expect.arrayContaining(['-f', 'concat', '-safe', '0', '-c', 'copy']))
      expect(concat.args.join(' ')).not.toMatch(/-vf/)
    })

    it('规格不一致 → scale+pad 归一到目标画幅后拼接成功', async () => {
      const runId = 't-normal-' + Date.now()
      dir = seedDisk(runId, [0, 1])
      const runs = []
      let probeCount = 0
      const specs = [makeClipSpec(), makeClipSpec({ width: 720, height: 1280, timebase: '1/15360' })]
      const ctx = makeExecutorCtx(runId, [{ shotId: 'a' }, { shotId: 'b' }], {
        probe: async () => specs[(probeCount++) % specs.length],
        runTool: async (binary, args) => {
          runs.push({ binary, args })
          fs.writeFileSync(path.join(dir, 'final.mp4'), 'final')
          return ''
        },
      })
      const fn = engine._stageExecutors.get('film_render')
      const result = await fn(ctx)
      expect(result.success).toBe(true)
      expect(result.output.mode).toBe('normalize')
      // 归一阶段：每片段一次重编码（scale+pad 滤镜），最终一次 concat
      const filterArgs = runs.map((r) => r.args.join(' ')).filter((s) => /scale=|pad=/.test(s))
      expect(filterArgs.length).toBe(2)
      expect(runs[runs.length - 1].args).toEqual(expect.arrayContaining(['-f', 'concat']))
      expect(result.output.target).toEqual({ width: 1280, height: 720 })
    })

    it('缺镜 → fail 并列出缺失序号，不产出 final.mp4', async () => {
      const runId = 't-missing-' + Date.now()
      dir = seedDisk(runId, [0, 2])
      const ctx = makeExecutorCtx(runId, [{ shotId: 'a' }, { shotId: 'b' }, { shotId: 'c' }, { shotId: 'd' }])
      const fn = engine._stageExecutors.get('film_render')
      const result = await fn(ctx)
      expect(result.success).toBe(false)
      expect(result.error).toContain('1')
      expect(result.error).toContain('3')
      expect(result.missingIndices).toEqual([1, 3])
      expect(fs.existsSync(path.join(getFilmRunDir(runId), 'final.mp4'))).toBe(false)
    })

    it('产物清单以磁盘为准：内存态标失败但磁盘已补 → 正常出片', async () => {
      const runId = 't-disk-truth-' + Date.now()
      dir = seedDisk(runId, [0, 1])
      const runs = []
      const ctx = makeExecutorCtx(runId, [{ shotId: 'a' }, { shotId: 'b' }], {
        contextPatch: {
          generate_videos: {
            videoResults: [
              { index: 0, shotId: 'a', success: true },
              { index: 1, shotId: 'b', success: false, error: '超时' },
            ],
            runDir: dir,
          },
        },
        runTool: async (binary, args) => {
          runs.push({ binary, args })
          fs.writeFileSync(path.join(dir, 'final.mp4'), 'final')
          return ''
        },
      })
      const fn = engine._stageExecutors.get('film_render')
      const result = await fn(ctx)
      expect(result.success).toBe(true)
      expect(result.output.mode).toBe('copy')
    })

    it('selectedShots 缺失 → fail-closed 带原因', async () => {
      const fn = engine._stageExecutors.get('film_render')
      const result = await fn({
        runId: 't-empty', stage: { name: 'render', type: 'film_render', options: {} },
        params: {}, context: {}, onProgress: () => {},
        _testProbe: async () => makeClipSpec(), _testRunTool: async () => '',
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('selectedShots')
    })
  })
})
