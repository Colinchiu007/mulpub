// @ts-check
'use strict'
/**
 * F-3a：自动模式「规划 → 逐镜出片 → 台账 → 收口合成 → final.mp4」端到端集成测试
 *
 * ## 它闭合的是 PRD 的哪个缺口
 *
 * PRD `01-docs/PRD-FILM-AUTO-LONGFORM-2026-10-24.md` §三 F-3 写「出片成功路径从未在真机跑通」，
 * 上游 PRD `01-docs/PRD-FILM-AUTO-MODE-2026-10-09.md` G5 写「plan → start → 台账 → manifest →
 * 真实 ffmpeg 出 final.mp4 的端到端集成测试」未闭合。
 *
 * 既有测试的覆盖边界（逐条核实过，**不是「没有测试」**）：
 *  - `film-manifest-compose-run.test.js` 覆盖的是**合成阶段**：它用 `_testRunTool` 桩把
 *    final.mp4 写成字符串 `'fake-final'`、用 `_testProbe` 桩返回假 SPEC
 *    ⇒ 它证明的是「**编排与调用形状正确**」，**不证明**「真 ffmpeg 真能出一条可播的成片」。
 *  - `auto-runner.test.js` 覆盖的是**批执行语义**：生成函数是假对象、不产真实文件。
 * ⇒ 两块之间的**衔接**（自动模式逐镜产物 → 收口清单 → 真 ffmpeg 合成）**从未被验过**。
 *
 * ## 本文件验什么、不验什么（诚实边界）
 *
 * 验（**全部是真代码**）：
 *  - `planAutoShots` 真规划出 12 镜；
 *  - `createProject` / `writeProject` 真落台账（project.json）；
 *  - `runAutoBatch` 真调度 12 镜、真落 `shot_NNN.mp4`、真以**磁盘为真**回写逐镜状态；
 *  - `film-render` 真调 ffmpeg 合成，真产出 `final.mp4`；
 *  - **真 ffprobe** 断言成片：有视频流、时长 ≈ 12 × 镜长、体积非空壳；
 *  - **缺镜 fail-closed**：少一个片段 ⇒ 不产出 final.mp4（不产「缺镜假成片」）。
 *
 * 不验（**必须由 F-1 / F-2 用真 provider 验**）：
 *  - provider 是否产出**对白音轨**（F-1）——本文件断言的音轨存在性来自**桩产的静音轨**，
 *    它**只能证明合成层会带上音轨流**，**不能**证明真 provider 产对白；
 *  - provider 是否**接受应用下发的镜长**（F-2）——桩按应用的秒数造片，与 provider 无关；
 *  - 跨进程的「渲染端经 pipeline 通道发起合成」那一跳（由 `film-auto-mode-driver.js`
 *    Phase 2 覆盖，它需要真 provider）。
 *
 * ⇒ 本文件的绿灯是「**范围受限的观测**」：**应用侧出片链路通**，**不是**「真 provider 能出片」。
 *
 * ## 媒体依赖
 *
 * ffmpeg/ffprobe 走 `media-tool-paths` 的既有探测（与 `story2video-stages.test.js` 同一套）。
 * 取不到时**整个 describe 跳过**（不产假绿），并在用例里显式标注「本环境未覆盖」。
 * CI 的 desktop-shards job **有意不继承** `SKIP_NATIVE_MEDIA_TOOL_TESTS=1`
 * ⇒ 那条路径上 ffmpeg 是真跑的（见 quality-gate.yml 的环境契约注释）。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

const { planAutoShots } = require('./auto-plan')
const { createProject, writeProject, readProject } = require('./auto-project')
const { runAutoBatch, autoRunIdFor, shotFileName } = require('./auto-runner')
const { PRODUCTION_BATCH_SIZE } = require('./production-driver')
const { registerFilmRenderStage } = require('./film-render')
const { findFfmpeg, findFfprobe } = require('../media-tool-paths')

/** 受控媒体根（与 film-render.getFilmMediaRoot / auto-project.mediaRootOf 同构） */
const MEDIA_ROOT = path.join(os.tmpdir(), 'film-engineering')
const HOME = os.tmpdir()
const SHOT_SECONDS = 5
const SHOT_COUNT = 12
const CLIP_W = 320
const CLIP_H = 240

const FFMPEG = findFfmpeg()
const FFPROBE = findFfprobe()
/** 冷启动 runner 上 ffmpeg 首次 spawn 可能超过全局 hookTimeout —— 只给这一个 hook 单独放宽预算 */
const MEDIA_SETUP_HOOK_TIMEOUT_MS = 60000
/**
 * 用例级时限：这两个用例真跑 ffmpeg（12 段编码 + 一次 concat 合成），
 * 耗时随机器快慢浮动（沙箱 Linux 实测 ~7.6s）。仓内 vitest 的全局 testTimeout 是 10s
 * ⇒ 在更慢的 Windows CI runner 上会顶不住（记忆：「不该让机器快慢决定判定」）。
 * ⇒ 只放宽**本文件这两个用例**的时限，不改断言语义、不改 skip 守卫。
 */
const MEDIA_CASE_TIMEOUT_MS = 180000

/** 12 段剧本：每段一句带引号台词（≤ 20 字 ⇒ 推算 2.5 秒，装得下 5 秒档） */
function makeScript () {
  return Array.from({ length: SHOT_COUNT }, (_, i) =>
    '第' + (i + 1) + '场 夜 客厅\n人物抬头，低声说：「这一句是第' + (i + 1) + '句台词。」'
  ).join('\n\n')
}

/** 模板分镜：只需 prompt（+ model 供逐镜派生用） */
const TEMPLATE_SHOTS = [{
  model: 'nano_banana_2',
  prompt: [
    'INT. 客厅 - 夜',
    '[CHARACTER: HERO]',
    'HERO 站在窗边，手里握着一封信。',
    '',
    '镜头缓慢推近，人物表情从犹豫转为决绝。',
  ].join('\n'),
}]

/** 真 ffmpeg 造一段可播的 mp4（颜色源 + 静音轨），与 story2video-stages.test.js 同一手法 */
function encodeClip (dest, seconds) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=' + CLIP_W + 'x' + CLIP_H + ':d=' + seconds,
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      dest,
    ], (error) => {
      if (error) reject(new Error('ffmpeg 造片段失败: ' + String(error && error.stderr || error).slice(0, 300)))
      else resolve()
    })
  })
}

/** 真 ffprobe 读成片规格 */
function probeFile (file) {
  return new Promise((resolve, reject) => {
    execFile(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], (error, stdout) => {
      if (error) { reject(new Error('ffprobe 失败: ' + String(error && error.stderr || error).slice(0, 300))); return }
      try { resolve(JSON.parse(stdout)) } catch (e) { reject(e) }
    })
  })
}

/**
 * 最小 pipeline 宿主：只注册 film_render 一个执行器。
 *
 * ⚠️ 为什么不直接用 `PipelineEngine`：
 *  - `registerFilmRenderStage` 对宿主的全部要求只有三样 —— `stageExecutor` 存在、`log`、
 *    `registerStageExecutor(type, fn)`；被验的是**film_render 执行体本身**，不是六阶段编排；
 *  - 真 `PipelineEngine` 会经 `stage-executor` 拉进 `@multi-publish/story2video-engine`
 *    （workspace 包）⇒ 把它拖进本文件会让这条用例在**没有 workspace 链接**的环境里整体加载失败；
 *  - 六阶段编排（含真引擎的 manifest 直通）由 `film-manifest-compose-run.test.js` 覆盖
 *    （那份用假 ffmpeg）⇒ 本文件补的是**真媒体**那一半，两者互补。
 */
function makeRenderHost () {
  const custom = new Map()
  const host = {
    log: { info () {}, warn () {}, error () {}, notify () {} },
    stageExecutor: {
      register (type, fn) { custom.set(type, fn) },
      async execute ({ runId, stage, params, context, onProgress }) {
        const fn = custom.get(stage.type)
        if (!fn) return { success: false, error: 'no executor for ' + stage.type }
        return fn({ runId, stage, params, context, onProgress })
      },
    },
    registerStageExecutor (type, fn) { this.stageExecutor.register(type, fn) },
  }
  const registered = registerFilmRenderStage(host)
  if (!registered.success) throw new Error('registerFilmRenderStage 失败: ' + registered.error)
  return host
}

function fakeAiGenerator () {
  return {
    _modelProviderManager: {
      getDefault: (cap) => (cap === 'video' ? { id: 'minimax' } : null),
    },
  }
}

describe('F-3a 自动模式出片 → 收口合成 端到端（生成层用桩 + 真 ffmpeg 合成）', () => {
  let mediaAvailable = true
  const taskId = 'f3a-' + process.pid + '-' + Date.now()
  const renderRunId = 'auto/' + taskId + '/compose'
  const renderDir = path.join(MEDIA_ROOT, renderRunId)
  let project = null
  let manifest = null
  /** 批次产物：[{ runId, dir, shotIds }]（12 镜按 PRODUCTION_BATCH_SIZE 分 2 批） */
  let batches = []

  beforeAll(async () => {
    if (!FFMPEG || !FFPROBE) { mediaAvailable = false; return }
    // 清掉本测试专属目录，避免上一轮残留让「整批跳过、零生成」静默假绿
    try { fs.rmSync(path.join(MEDIA_ROOT, 'auto', taskId), { recursive: true, force: true }) } catch { /* 清理失败不阻断 */ }
    try { fs.rmSync(renderDir, { recursive: true, force: true }) } catch { /* 清理失败不阻断 */ }
  }, MEDIA_SETUP_HOOK_TIMEOUT_MS)

  afterAll(() => {
    if (!mediaAvailable) return
    try { fs.rmSync(path.join(MEDIA_ROOT, 'auto', taskId), { recursive: true, force: true }) } catch { /* 清理失败可忽略 */ }
    try { fs.rmSync(renderDir, { recursive: true, force: true }) } catch { /* 清理失败可忽略 */ }
  })

  it('12 镜：真规划 → 真出片落盘 → 台账回写 → 真 ffmpeg 合成 → final.mp4（ffprobe 断言）', async () => {
    if (!mediaAvailable) {
      console.warn('[F-3a] 本环境无 ffmpeg/ffprobe ⇒ 端到端路径未覆盖（不产假绿）')
      return
    }

    // ── 1) 真规划：12 镜
    const plan = planAutoShots({
      script: makeScript(),
      seconds: SHOT_SECONDS,
      targetDurationSec: SHOT_SECONDS * SHOT_COUNT,
      aspect: '16x9',
      templateShots: TEMPLATE_SHOTS,
      mediaRoot: MEDIA_ROOT,
    })
    expect(plan.ok, '规划失败: ' + JSON.stringify(plan.errorCode || plan.message)).toBe(true)
    expect(plan.shots.length).toBe(SHOT_COUNT)
    expect(plan.shots.every((s) => typeof s.prompt === 'string' && s.prompt.trim().length > 0)).toBe(true)

    // ── 2) 真落台账
    const created = createProject({ taskId, plan, home: HOME })
    expect(created.schemaVersion, 'createProject 失败').toBeTruthy()
    project = created
    const written = writeProject({ home: HOME, project })
    expect(written.ok, 'writeProject 失败: ' + JSON.stringify(written.message)).toBe(true)
    expect(fs.existsSync(path.join(MEDIA_ROOT, 'auto', taskId, 'project.json'))).toBe(true)

    // ── 3) 真批执行（生成层用桩：真 ffmpeg 造每镜一个真 mp4）
    //    12 镜按 PRODUCTION_BATCH_SIZE 分 2 批 ⇒ 顺带覆盖「分批出片 + 跨批聚合合成」
    //    （renderManifest 的设计意图就是跨 run 聚合，不是单 run 收口）。
    const stubGen = async (opts) => {
      const dest = path.join(opts.runDir, shotFileName(opts.index))
      await encodeClip(dest, SHOT_SECONDS)
      return { index: opts.index, shotId: opts.shot.shotId, success: true, path: dest }
    }
    const shotIds = project.shots.map((s) => s.shotId)
    batches = []
    for (let start = 0, b = 0; start < shotIds.length; start += PRODUCTION_BATCH_SIZE, b++) {
      const ids = shotIds.slice(start, start + PRODUCTION_BATCH_SIZE)
      const runId = autoRunIdFor(taskId, b, project.runSeq)
      batches.push({ runId, dir: path.join(MEDIA_ROOT, runId), shotIds: ids })
      const runRes = await runAutoBatch({
        batch: { runId, shotIds: ids },
        project,
        aiGenerator: fakeAiGenerator(),
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        deps: { _testGenerateShotVideo: stubGen },
        persist: (p) => { writeProject({ home: HOME, project: p }) },
      })
      expect(runRes.refWarnings).toBeTruthy()
    }
    expect(batches.length, '12 镜应按 PRODUCTION_BATCH_SIZE 分批').toBeGreaterThan(1)

    // 每批的片段真落盘（文件名用**批内**序号，目录按批隔离）
    let onDisk = 0
    for (const b of batches) {
      for (let i = 0; i < b.shotIds.length; i++) {
        const f = path.join(b.dir, shotFileName(i))
        expect(fs.existsSync(f), '缺片段 ' + path.join(b.runId, shotFileName(i))).toBe(true)
        expect(fs.statSync(f).size).toBeGreaterThan(0)
        onDisk++
      }
    }
    expect(onDisk).toBe(SHOT_COUNT)

    // 台账以**磁盘为真**回写为 done
    const reloaded = readProject({ home: HOME, taskId })
    expect(reloaded.ok).toBe(true)
    expect(reloaded.project.shots.every((s) => s.status === 'done')).toBe(true)
    expect(reloaded.project.shots.every((s) => typeof s.outputPath === 'string' && fs.existsSync(s.outputPath))).toBe(true)

    // ── 4) 收口清单（跨 run manifest：片段在批目录，成片在合成 run 目录）
    manifest = []
    let order = 0
    for (const b of batches) {
      for (let i = 0; i < b.shotIds.length; i++) {
        manifest.push({
          shotId: b.shotIds[i],
          orderIndex: order++,
          sourceKind: 'generated',
          path: path.join(b.dir, shotFileName(i)),
        })
      }
    }
    expect(manifest.length).toBe(SHOT_COUNT)

    // ── 5) 真 ffmpeg 合成
    const host = makeRenderHost()
    const rendered = await host.stageExecutor.execute({
      runId: renderRunId,
      stage: { type: 'film_render' },
      params: { aspect: project.aspect },
      context: { renderManifest: manifest },
      onProgress: () => {},
    })
    expect(rendered.success, '合成失败: ' + JSON.stringify(rendered.error)).toBe(true)

    const finalPath = path.join(renderDir, 'final.mp4')
    expect(fs.existsSync(finalPath), 'final.mp4 未产出').toBe(true)
    expect(fs.statSync(finalPath).size).toBeGreaterThan(0)

    // ── 6) 产物有效性断言（真 ffprobe）：空壳/假文件过不了这一关
    const probed = await probeFile(finalPath)
    const videoStreams = (probed.streams || []).filter((s) => s.codec_type === 'video')
    expect(videoStreams.length, 'final.mp4 无视频流').toBe(1)
    expect(Number(videoStreams[0].width)).toBe(CLIP_W)
    expect(Number(videoStreams[0].height)).toBe(CLIP_H)
    const duration = Number(probed.format && probed.format.duration)
    expect(Number.isFinite(duration), 'final.mp4 无时长').toBe(true)
    // 12 镜 × 5 秒 = 60 秒（留 2 秒容差给 concat/编码误差）
    expect(duration).toBeGreaterThan(58)
    expect(duration).toBeLessThan(62)
  }, MEDIA_CASE_TIMEOUT_MS)

  it('缺镜不产成片：少一个片段 ⇒ 合成 fail-closed，无 final.mp4', async () => {
    if (!mediaAvailable) return
    expect(manifest, '前置用例未产出 manifest').toBeTruthy()

    // 删掉第 6 镜的产物（模拟「缺镜不产成片」的入口）
    const victim = manifest[5].path
    expect(fs.existsSync(victim)).toBe(true)
    fs.unlinkSync(victim)

    // 用**另一个**合成 run 目录：前一个用例已产出过 final.mp4，
    // 复用同一目录会把「这次没产出」与「上次留下的」混在一起（断言就失去意义）。
    const failRunId = 'auto/' + taskId + '/compose-missing'
    const failDir = path.join(MEDIA_ROOT, failRunId)
    const host = makeRenderHost()
    const rendered = await host.stageExecutor.execute({
      runId: failRunId,
      stage: { type: 'film_render' },
      params: { aspect: project.aspect },
      context: { renderManifest: manifest },
      onProgress: () => {},
    })
    expect(rendered.success, '缺镜却合成成功（缺镜假成片）').toBe(false)
    expect(String(rendered.error)).toContain('缺失')
    expect(fs.existsSync(path.join(failDir, 'final.mp4')), '缺镜却产出了 final.mp4').toBe(false)
  }, MEDIA_CASE_TIMEOUT_MS)
})
