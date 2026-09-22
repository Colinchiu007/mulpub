// @ts-check
'use strict'
/**
 * film-engineering film-render - 成片合成阶段（film_render）
 *
 * 合同（openspec change: film-engineering-video-gen，D8/D9）：
 *   - 产物清单以 run 目录磁盘扫描为准（shot_NNN.mp4 与选中序号对齐），不信任生成阶段
 *     内存态结果（单镜重试覆盖磁盘后视为可用，D7）；
 *   - 缺任一镜头 → fail 并列出缺失序号，绝不输出缺镜假成片；
 *   - 全部片段编解码规格（codec/宽高/帧率/时基/音频参数）一致 → concat demuxer -c copy
 *     零重编码直拷；不一致 → 仅做最小 scale+pad 归一到目标画幅（16x9→1280x720、
 *     9x16→720x1280、source→首片段宽高）后拼接，无转场/调色/字幕/音轨处理；
 *   - 产物 final.mp4 落在 film-engineering/<runId>/ 受控媒体根内（与 video-gen 同目录）。
 *
 * 测试 seam（与 video-gen _testSleep/_testDownload 同构，生产 StageExecutor 不传）：
 *   - _testProbe(path) → 片段规格；_testRunTool(binary, args) → ffmpeg/ffprobe 执行。
 *
 * 注册方式：container.setup.js 中调用 registerFilmRenderStage(pipelineEngine)
 */

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { findFfmpeg, findFfprobe } = require('../media-tool-paths')
const { emitStageStart, emitStageComplete } = require('../stage-progress')
const { getFilmRunDir, FILM_VIDEO_STAGE_TYPES } = require('./video-gen')

const TARGET_DIMENSIONS = { '16x9': { width: 1280, height: 720 }, '9x16': { width: 720, height: 1280 } }

function runTool (binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).slice(0, 1200)))
      else resolve(String(stdout) + '\n' + String(stderr))
    })
  })
}

/** ffprobe JSON 规格探测（视频流主流 + 音频流参数，供一致性比较） */
async function probeClip (inputPath) {
  const ffprobe = findFfprobe()
  if (!ffprobe) throw new Error('ffprobe 不可用，无法探测片段规格')
  await runTool(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', inputPath])
  // runTool 只回传文本，这里用一次性 JSON 输出重新取（stdout 前置流，取第一条视频/音频流）
  const output = await runToolWithJson(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', inputPath])
  let parsed
  try { parsed = JSON.parse(output) } catch { throw new Error('无法读取片段规格：' + inputPath) }
  const v = (parsed.streams || []).find((s) => s.codec_type === 'video')
  if (!v) throw new Error('片段无视频流：' + inputPath)
  const a = (parsed.streams || []).find((s) => s.codec_type === 'audio')
  return {
    codec: String(v.codec_name || ''),
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    fps: String(v.avg_frame_rate || v.r_frame_rate || ''),
    timebase: String(v.time_base || ''),
    hasAudio: Boolean(a),
    sampleRate: a ? Number(a.sample_rate) || 0 : 0,
    channels: a ? Number(a.channels) || 0 : 0,
  }
}

function runToolWithJson (binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).slice(0, 1200)))
      else resolve(String(stdout))
    })
  })
}

/** 规格一致性键（含音频轨道有无与参数） */
function specKey (spec) {
  return [spec.codec, spec.width, spec.height, spec.fps, spec.timebase, spec.hasAudio, spec.sampleRate, spec.channels].join('|')
}

function sameSpec (a, b) { return specKey(a) === specKey(b) }

/**
 * 扫描 run 目录磁盘产物，与选中数量对齐（序号 0..total-1 → shot_NNN.mp4）。
 * @returns {{files: string[], missing: number[]}}
 */
function collectDiskShots (runDir, total) {
  const files = []
  const missing = []
  for (let i = 0; i < total; i++) {
    const f = path.join(runDir, 'shot_' + String(i).padStart(3, '0') + '.mp4')
    if (fs.existsSync(f)) files.push(f)
    else missing.push(i)
  }
  return { files, missing }
}

/**
 * 缺失镜序号（D7：信磁盘不信内存态——videoResults 仅作上下文参考，不参与判定）。
 * @param {number} total 选中分镜数
 * @param {string} runDir run 产物目录
 * @param {Array<object>|null|undefined} _videoResults 生成阶段内存态（保留形参供调用点自说明）
 * @returns {number[]}
 */
function computeMissingShotIndices (total, runDir, _videoResults) {
  if (!runDir || !fs.existsSync(runDir)) return Array.from({ length: total }, (_, i) => i)
  return collectDiskShots(runDir, total).missing
}

/** concat demuxer 清单文件（Windows 路径转正斜杠，单引号转义） */
function writeConcatList (dirPath, files) {
  const listPath = path.join(dirPath, 'concat-list.txt')
  const lines = files.map((f) => "file '" + f.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'")
  fs.writeFileSync(listPath, lines.join('\n') + '\n', 'utf8')
  return listPath
}

function normalizeFilterFor (target) {
  return 'scale=' + target.width + ':' + target.height + ':force_original_aspect_ratio=decrease,' +
    'pad=' + target.width + ':' + target.height + ':(ow-iw)/2:(oh-ih)/2:color=black,setsar=1'
}

/**
 * 注册 film_render 阶段执行器
 * @param {object} pipelineEngine - PipelineEngine 实例
 * @returns {{success: boolean, error?: string, registered?: string[]}}
 */
function registerFilmRenderStage (pipelineEngine) {
  if (!pipelineEngine || !pipelineEngine.stageExecutor) {
    return { success: false, error: 'PipelineEngine.stageExecutor not configured (ServiceBus missing)' }
  }
  const log = pipelineEngine.log && typeof pipelineEngine.log.warn === 'function'
    ? pipelineEngine.log
    : { info () {}, warn () {}, error () {} }

  pipelineEngine.registerStageExecutor(
    FILM_VIDEO_STAGE_TYPES.RENDER,
    async ({ runId, params, context, onProgress, _testProbe, _testRunTool }) => {
      emitStageStart(onProgress, { messageKey: 'stageProgress.filmRenderStart' })
      const shots = (context && Array.isArray(context.selectedShots)) ? context.selectedShots : []
      if (shots.length === 0) {
        return { success: false, error: 'film_render 需要 context.selectedShots（先执行 film_select_shots）' }
      }
      const runDir = getFilmRunDir(runId)
      const probe = _testProbe || probeClip
      const tool = _testRunTool || runTool

      // 产物清单以磁盘为准（D7）：缺镜 fail-closed，不产出缺镜假成片
      const { files, missing } = collectDiskShots(runDir, shots.length)
      if (missing.length > 0) {
        return {
          success: false,
          error: 'film_render 缺失镜头产物，无法合成成片（缺失镜序号: ' + missing.join(', ') + '），请先单镜重试补齐',
          missingIndices: missing,
        }
      }

      // ffprobe 预检全部片段规格（D8）
      /** @type {Array<{spec: object}>} */
      const clips = []
      try {
        for (const f of files) clips.push({ path: f, spec: await probe(f) })
      } catch (error) {
        return { success: false, error: 'film_render 规格探测失败：' + ((error && error.message) || error) }
      }

      const finalPath = path.join(runDir, 'final.mp4')
      const consistent = clips.every((c) => sameSpec(c.spec, clips[0].spec))
      let mode = 'copy'
      let inputs = files
      if (!consistent) {
        // 目标画幅：16x9/9x16 固定尺寸；source 以首片段宽高为基准
        const aspect = (params && params.aspect) || '16x9'
        const target = TARGET_DIMENSIONS[aspect] || { width: clips[0].spec.width, height: clips[0].spec.height }
        const ffmpeg = _testRunTool ? (findFfmpeg() || 'ffmpeg') : findFfmpeg()
        if (!ffmpeg) return { success: false, error: 'FFmpeg 不可用，无法合成成片' }
        mode = 'normalize'
        inputs = []
        try {
          for (let i = 0; i < clips.length; i++) {
            const normPath = path.join(runDir, 'norm_' + String(i).padStart(3, '0') + '.mp4')
            // 最小工程归一：scale+pad 到目标画幅（无转场/调色/字幕；音频重编码保证 concat 兼容）
            await tool(ffmpeg, [
              '-y', '-i', clips[i].path,
              '-vf', normalizeFilterFor(target),
              '-r', '24',
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
              '-c:a', 'aac',
              normPath,
            ])
            inputs.push(normPath)
          }
        } catch (error) {
          return { success: false, error: 'film_render 规格归一失败：' + ((error && error.message) || error) }
        }
        // 归一后统一规格，直拷拼接
        void target
        clips.target = target
      }

      const ffmpeg = _testRunTool ? (findFfmpeg() || 'ffmpeg') : findFfmpeg()
      if (!ffmpeg) return { success: false, error: 'FFmpeg 不可用，无法合成成片' }
      try {
        const listPath = writeConcatList(runDir, inputs)
        await tool(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', finalPath])
        if (!fs.existsSync(finalPath)) {
          return { success: false, error: 'film_render 拼接未产出 final.mp4' }
        }
      } catch (error) {
        return { success: false, error: 'film_render 拼接失败：' + ((error && error.message) || error) }
      }

      const output = {
        finalPath,
        mode,
        clipCount: files.length,
        runDir,
      }
      if (clips.target) output.target = clips.target
      emitStageComplete(onProgress, {
        messageKey: 'stageProgress.filmRenderComplete',
        summaryKey: 'stageProgress.filmRenderSummary',
        summaryParams: { count: files.length },
      })
      log.info('FilmRender', 'final.mp4 composed (' + mode + ', ' + files.length + ' clips): ' + finalPath)
      return { success: true, output }
    },
  )

  return { success: true, registered: [FILM_VIDEO_STAGE_TYPES.RENDER] }
}

module.exports = {
  registerFilmRenderStage,
  computeMissingShotIndices,
  collectDiskShots,
  probeClip,
  specKey,
  sameSpec,
}
