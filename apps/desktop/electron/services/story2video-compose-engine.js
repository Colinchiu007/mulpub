// @ts-check
/**
 * Story2VideoComposeEngine — 基于 ffmpeg 的视频合成引擎
 *
 * 职责：
 *   - 接收 assetManifest（图片 + TTS 音频 + 字幕）
 *   - 用 ffmpeg 将每张图片配对应音频合成视频片段
 *   - 拼接所有片段为最终视频
 *
 * 设计意图：
 *   替代 ServiceBus 中的占位响应，让 story2video-compose 流水线真正产出视频。
 *   不依赖 Remotion/Canvas，纯 Node.js + ffmpeg 子进程。
 */
'use strict'

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { promisify } = require('util')
const {
  MAX_INPUT_FILE_BYTES,
  MAX_INPUT_TOTAL_BYTES,
  MAX_BGM_FILE_BYTES,
  getAllowedMediaRoots,
  isPathWithin,
  resolveReadableMediaFile,
} = require('./story2video-paths')
const { findFfmpeg, findFfprobe } = require('./media-tool-paths')
const {
  buildSubtitleTimeline,
  splitSubtitleBlocks,
} = require('./story2video-segmentation')

const execFileAsync = promisify(execFile)
const COMPOSE_LOG_MODULE = 'Story2VideoCompose'
const FFMPEG_HEARTBEAT_INTERVAL_MS = 10 * 1000
const FFMPEG_STALLED_OUTPUT_WARN_MS = 30 * 1000

function outputFileBytes (filePath) {
  if (!filePath) return 0
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile() ? stat.size : 0
  } catch (_) {
    return 0
  }
}

function safeFfmpegDiagnostic (value) {
  const redactAbsolutePath = (line) => {
    const windowsIndex = line.search(/[A-Za-z]:[\\/]/)
    const unixMatch = /(?:^|[\s'"[({=:,])\//.exec(line)
    const unixIndex = unixMatch ? unixMatch.index + unixMatch[0].length - 1 : -1
    const pathIndex = windowsIndex === -1
      ? unixIndex
      : (unixIndex === -1 ? windowsIndex : Math.min(windowsIndex, unixIndex))
    return pathIndex === -1 ? line : line.slice(0, pathIndex) + '<path>'
  }

  return String(value || '')
    .split(/\r?\n/)
    .map(redactAbsolutePath)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-300)
}

function ffmpegErrorMeta (error) {
  const source = error?.cause || error || {}
  return {
    errorCode: typeof error?.code === 'string' ? error.code : (typeof source.code === 'string' ? source.code : null),
    exitCode: typeof source.code === 'number' ? source.code : null,
    signal: typeof source.signal === 'string' ? source.signal : null,
    killed: source.killed === true,
    stderr: safeFfmpegDiagnostic(source.stderr),
  }
}

function isFfmpegStageTimeoutError (error) {
  return error?.code === 'ETIMEDOUT' || (error?.killed === true && error?.signal === 'SIGTERM')
}

function normalizeFfmpegStageError (error, stage) {
  if (!isFfmpegStageTimeoutError(error)) return error
  const timeoutError = new Error(stage + ' ffmpeg stage timed out')
  timeoutError.code = 'ETIMEDOUT'
  timeoutError.cause = error
  return timeoutError
}

async function execFfmpegStage (args, options, stage, binary = FFMPEG) {
  const { onStarted, ...execOptions } = options || {}
  try {
    return await new Promise((resolve, reject) => {
      const child = execFile(binary, args, execOptions, (error, stdout, stderr) => {
        if (error) {
          if (stderr && !error.stderr) error.stderr = stderr
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      })
      if (typeof onStarted === 'function') onStarted(child?.pid || null)
    })
  } catch (error) {
    throw normalizeFfmpegStageError(error, stage)
  }
}

// BGM 降级原因机器码（单一 i18n 来源约定）：warnings 只含机器码，不含用户可见文案；
// 文案统一由前端依据 data.bgmSkippedReason 本地化（story2video-notifications 的
// bgmSkippedReasonText/formatBgmSkippedNotification），服务层不硬编码中文（2026-08-10）。
// 约定：码形如 bgm_<reason>，与前端 BGM_SKIP_REASON_TEXT 的 reason 键一一对应；
// renderer 不得把 warnings 当输入（bgmSkippedReason 才是权威码）。
const BGM_SKIP_WARNING_CODES = Object.freeze({
  size_exceeded: 'bgm_size_exceeded',
  format_unsupported: 'bgm_format_unsupported',
  not_allowed: 'bgm_not_allowed',
  unreadable: 'bgm_unreadable',
})

/**
 * 判定 BGM 被跳过的最可能原因（启发式，与 resolveReadableMediaFile 最终裁决一致）：
 * format_unsupported=扩展名不支持（含无扩展名）/ size_exceeded=可读但超 BGM 单文件上限 /
 * not_allowed=可读未超限但不在允许根目录 / 其余=不可读（缺失/符号链接/不存在）。
 */
function diagnoseBgmSkipReason (candidate, allowedRoots) {
  const localPath = typeof candidate === 'string' && candidate.trim() ? candidate.trim() : ''
  if (!localPath) return 'unreadable'
  const extension = path.extname(localPath).toLowerCase()
  if (!['.wav', '.m4a', '.mp3'].includes(extension)) return 'format_unsupported'
  try {
    const stat = fs.statSync(localPath)
    if (stat.isFile() && stat.size > MAX_BGM_FILE_BYTES) return 'size_exceeded'
    if (Array.isArray(allowedRoots) && !isPathWithin(localPath, allowedRoots)) return 'not_allowed'
  } catch (_) { /* 不存在/不可读 → unreadable */ }
  return 'unreadable'
}

const DEFAULT_MAX_DURATION_SECONDS = 50 * 60
const DEFAULT_MAX_AUDIO_DURATION_SECONDS = 50 * 60
const DEFAULT_MAX_SEGMENT_DURATION_SECONDS = 3 * 60
const DEFAULT_MAX_OUTPUT_PIXELS = 7680 * 4320
// 单条 ffmpeg 命令最多输入的片段数。超过时按块合成再递归合并，
// 避免 25+ 场景（27 路 xfade/acrossfade）在低内存环境触发 x264 malloc 失败。
const MAX_XFADE_INPUTS = 8

/** compose 子进度已知阶段枚举（执行器 fail-closed 校验复用，新增 phase 必须同步此处）。 */
const KNOWN_COMPOSE_PHASES = ['preflight', 'validated', 'segments', 'concat', 'narration', 'watermark', 'bgm', 'webm', 'verify', 'done']

/**
 * compose 子进度归一化（引擎发射与执行器 fail-closed 写入共用语义）。
 * - percent 取整并钳制 [0,100]；
 * - segmentsTotal 存在时须为 ≥1 整数；segmentsDone 存在时须为 [0, segmentsTotal] 整数；
 * - phase 必须为非空字符串；
 * - 结构为纯原始值对象（IPC structuredClone 安全）。
 * 任一约束失败返回 null，调用方应丢弃该次更新（fail-closed）。
 * @param {object} update
 * @returns {{phase: string, percent: number, segmentsDone?: number, segmentsTotal?: number, message?: string}|null}
 */
function normalizeComposeProgressUpdate (update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return null
  const phase = typeof update.phase === 'string' && update.phase.trim() ? update.phase.trim() : ''
  if (!phase) return null
  // 严格数值校验：拒绝 Number() 强转穿透（null→0 / []→0 / true→1 / '39'→39）
  if (typeof update.percent !== 'number' || !Number.isFinite(update.percent)) return null
  const normalized = {
    phase,
    percent: Math.max(0, Math.min(100, Math.round(update.percent))),
  }
  if (update.segmentsTotal !== undefined && update.segmentsTotal !== null) {
    if (typeof update.segmentsTotal !== 'number' || !Number.isInteger(update.segmentsTotal) || update.segmentsTotal < 1) return null
    normalized.segmentsTotal = update.segmentsTotal
  }
  if (update.segmentsDone !== undefined && update.segmentsDone !== null) {
    if (typeof update.segmentsDone !== 'number' || !Number.isInteger(update.segmentsDone) || update.segmentsDone < 0) return null
    if (normalized.segmentsTotal !== undefined && update.segmentsDone > normalized.segmentsTotal) return null
    normalized.segmentsDone = update.segmentsDone
  }
  if (typeof update.message === 'string' && update.message) normalized.message = update.message
  return normalized
}

const FFMPEG = findFfmpeg()
const FFPROBE = findFfprobe()

/**
 * 转义 ffmpeg drawtext 滤镜中的字幕文本
 *
 * ffmpeg drawtext 的 text 参数在单引号上下文中，以下字符需转义：
 *   - \  必须最先转义（否则后续转义符 \ 会被二次转义）
 *   - :  滤镜参数分隔符
 *   - '  单引号字符串结束符
 *   - ,  滤镜链分隔符
 *   - %  避免 %{...} 函数扩展（如 %{n} 帧号）
 *   - { } 避免 ${...} 变量扩展
 *
 * @param {string} text - 原始字幕文本
 * @returns {string} 转义后的文本，可直接用于 drawtext=text='...'
 */
// Windows 中文字体候选历史（按优先级）：msyh.ttc / msyh.ttf / simhei.ttf / simsun.ttc / msjh.ttc
// ⚠️ 2026-10-16：该列表已移入 font-resolver 的 SYSTEM_FONT_CANDIDATES，本模块不再自持。
// 原因是实测 ffmpeg drawtext 的 `fontfile=` 对非 ASCII 路径**静默失败**（豆腐块、
// rc=0、stderr 干净），而用户可能把应用装到 `D:\软件\社媒管家\`。自包含得意黑 +
// ASCII 副本由 font-resolver 统一负责，见该模块头注释与 font-resolver.test.js。
// 另修一处历史 bug：原候选值写的是 'C:\\\\Windows\\\\Fonts\\\\msyh.ttc'（JS 字符串里
// 双层反斜杠），fs.existsSync 永远匹配不到真实路径 —— 系统字体回落实际上是失效的。

let cachedCjkFont = null

/**
 * 解析一个可用的 CJK 字体路径（仅 Windows 静态 ffmpeg 需要显式 fontfile）。
 *
 * 2026-10-16 改为委托 font-resolver：优先自包含得意黑（字幕/水印的指定字体），
 * 并经 ASCII 副本层规避 ffmpeg 的路径敏感性；找不到才回落系统字体。
 * 返回 '' 表示无可用字体（调用方据此不注入 fontfile，交由 fontconfig）。
 */
function resolveCjkFont () {
  if (cachedCjkFont !== null) return cachedCjkFont
  const { resolveContentCjkFont } = require('./font-resolver')
  const { fontFile } = resolveContentCjkFont()
  cachedCjkFont = fontFile || ''
  return cachedCjkFont
}

/** 把字体路径转成 drawtext fontfile 值（正斜杠 + 单反斜杠转义冒号）。 */
function escapeFontFilePath (filePath) {
  if (!filePath) return ''
  // 兼容单个或连续多个反斜杠，统一归一为正斜杠
  return String(filePath)
    .replace(/\\+/g, '/')
    .replace(/:/g, '\\:')
}

function escapeSubtitleText (text) {
  if (!text) return ''
  return String(text)
    .replace(/\\/g, '\\\\')  // 1. 反斜杠最先转义（\ → \\）
    .replace(/:/g, '\\:')    // 2. 冒号
    .replace(/'/g, "\\'")    // 3. 单引号
    .replace(/,/g, '\\,')    // 4. 逗号
    .replace(/%/g, '\\%')    // 5. 百分号
    .replace(/\{/g, '\\{')   // 6. 左花括号
    .replace(/\}/g, '\\}')   // 7. 右花括号
}

const TRANSITION_NAMES = {
  fade: 'fade',
  'slide-left': 'slideleft',
  'slide-right': 'slideright',
  'slide-up': 'slideup',
  'slide-down': 'slidedown',
}

function clampNumber (value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function parseResolution (value) {
  const match = String(value || '').match(/^(\d{2,5})x(\d{2,5})$/i)
  if (!match) return { width: 1280, height: 720 }
  return {
    width: clampNumber(match[1], 160, 7680, 1280),
    height: clampNumber(match[2], 160, 7680, 720),
  }
}

function validateResolution (value, maxPixels) {
  if (value === undefined || value === null || value === '') return null
  const match = String(value).match(/^(\d{2,5})x(\d{2,5})$/i)
  if (!match) return 'Invalid output resolution'
  const width = Number(match[1])
  const height = Number(match[2])
  if (width < 160 || height < 160 || width > 7680 || height > 7680) {
    return 'Output resolution is outside the allowed range'
  }
  if (width * height > maxPixels) return 'Output resolution exceeds the pixel limit'
  return null
}

function positiveLimit (value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function buildScaleFilter (width, height) {
  const safeWidth = Math.max(160, Math.round(Number(width) || 1280))
  const safeHeight = Math.max(160, Math.round(Number(height) || 720))
  return 'scale=' + safeWidth + ':' + safeHeight + ':force_original_aspect_ratio=decrease,' +
    'pad=' + safeWidth + ':' + safeHeight + ':(ow-iw)/2:(oh-ih)/2:color=black'
}

/**
 * 片段编码超时（ms）：按「时长 × 帧率」估算编码工作量，最低 30s、上限 5min。
 * 抖动修复用 2x 中间分辨率 zoompan（1080p 输出 → 3840x2160 画布），
 * 本机编码速度约 10-20fps，20s 片段需要 40s+；固定 30s 超时会把慢速编码误杀
 * （E2E-PENDING 待办 D 同类资源问题：27 场景 run 在第 13 段失败）。
 * @param {number|string|undefined|null} effectDuration 片段有效时长（秒）
 * @param {number|string|undefined|null} fps 帧率
 * @returns {number} 超时毫秒数
 */
/**
 * 输出分辨率能力上限：'1080p'（默认，禁止 4K）| '4k'（允许 3840x2160）。
 * 以像素面积判定（1080x1920 竖屏与 1920x1080 横屏同级，均属于 1080p 档）。
 * 由运营配置 videoCreation.maxOutputResolution 或环境变量 MAX_OUTPUT_RESOLUTION 决定。
 */
function resolveMaxOutputDimensions (maxKey) {
  return maxKey === '4k'
    ? { key: '4k', width: 3840, height: 2160 }
    : { key: '1080p', width: 1920, height: 1080 }
}

/**
 * 校验输出分辨率是否超出能力上限（fail-closed）。
 * @param {string|undefined|null} resolutionValue - 如 '3840x2160'
 * @param {string} maxKey - '1080p' | '4k'
 * @returns {string|null} 超限时返回错误文案，否则 null
 */
function validateResolutionCapability (resolutionValue, maxKey) {
  const max = resolveMaxOutputDimensions(maxKey)
  const parsed = parseResolution(resolutionValue)
  if (parsed && parsed.width * parsed.height > max.width * max.height) {
    return '输出分辨率 ' + parsed.width + 'x' + parsed.height +
      ' 超出当前允许上限（' + max.width + 'x' + max.height +
      '，MAX_OUTPUT_RESOLUTION=4k 或运营配置 videoCreation.maxOutputResolution=4k 可开启 4K）'
  }
  return null
}

/**
 * zoompan 工作分辨率 = 输出 × workScale，长边封顶 3840（按比例缩放，保持宽高比）。
 * 抖动修复依赖 2x 上采样，但 4K 输出若按 2x 会生成 7680×4320（8K）中间画布，
 * 内存/编码时长爆炸（E2E-PENDING 待办 D 同类）；中间分辨率一律封顶 3840。
 * @param {number|string} width 输出宽
 * @param {number|string} height 输出高
 * @param {number} [workScale=2] 工作倍率
 * @returns {{width: number, height: number}}
 */
function computeWorkResolution (width, height, workScale) {
  const scale = Number.isFinite(Number(workScale)) && Number(workScale) > 0 ? Number(workScale) : 2
  const cap = 3840
  let w = Math.round(clampNumber(width, 160, 4096) * scale)
  let h = Math.round(clampNumber(height, 160, 4096) * scale)
  if (Math.max(w, h) > cap) {
    const factor = cap / Math.max(w, h)
    w = Math.round(w * factor)
    h = Math.round(h * factor)
  }
  return { width: w, height: h }
}

function computeSegmentEncodeTimeoutMs (effectDuration, fps, workScale = 2) {
  const seconds = Math.max(0.1, Number(effectDuration) || 3)
  const frameRate = clampNumber(fps, 1, 120, 30)
  const scale = clampNumber(workScale, 1, 2, 2)
  // zoompan 在低速桌面环境按最低 10fps 估算；工作倍率越高，像素量近似按平方增长。
  // 给每次重试独立预算，避免片段已经持续写入时被固定短超时误杀。
  const estimatedMs = Math.ceil((seconds * frameRate * scale * scale) / 10) * 1000
  return Math.max(60000, Math.min(600000, estimatedMs + 30000))
}

// 全量重编码档位：xfade 合并与 watermark 后置烧录共用（解码+drawtext+整片重编码，工作量同级）。
// 公式 max(2 分钟, 时长×3+2 分钟)：最低 1.5x 实时编码假设 + 大幅余量（337s 成片实测 5+ 分钟合并）。
const FULL_REENCODE_TIMEOUT_PROFILE = Object.freeze({ minMs: 120000, factor: 3, overheadMs: 120000, maxMs: 6 * 60 * 60 * 1000 })

const FFMPEG_STAGE_TIMEOUT_PROFILES = Object.freeze({
  concat: Object.freeze({ minMs: 60000, factor: 0.25, overheadMs: 30000, maxMs: 30 * 60 * 1000 }),
  narration: Object.freeze({ minMs: 120000, factor: 2, overheadMs: 30000, maxMs: 2 * 60 * 60 * 1000 }),
  bgm: Object.freeze({ minMs: 120000, factor: 2, overheadMs: 30000, maxMs: 2 * 60 * 60 * 1000 }),
  webm: Object.freeze({ minMs: 180000, factor: 6, overheadMs: 120000, maxMs: 6 * 60 * 60 * 1000 }),
  validate: Object.freeze({ minMs: 60000, factor: 2, overheadMs: 30000, maxMs: 2 * 60 * 60 * 1000 }),
  xfade: FULL_REENCODE_TIMEOUT_PROFILE,
  // watermark：后置烧录全片视频轨重编码（libx264），量级与 xfade 全量重编码一致
  watermark: FULL_REENCODE_TIMEOUT_PROFILE,
})

function computeFfmpegStageTimeoutMs (stage, durationSeconds) {
  const profile = FFMPEG_STAGE_TIMEOUT_PROFILES[stage]
  if (!profile) throw new Error('Unknown ffmpeg timeout stage: ' + stage)
  const seconds = Number(durationSeconds)
  if (!Number.isFinite(seconds) || seconds <= 0) return profile.minMs
  const estimatedMs = Math.ceil(seconds * profile.factor * 1000) + profile.overheadMs
  return Math.min(profile.maxMs, Math.max(profile.minMs, estimatedMs))
}

/**
 * xfade/acrossfade 合并的编码超时：整段输出全量重编码，固定 120s 会杀掉长视频合并
 * （真实复现：27 场景 ~337s 成片，chunk 合并需 5+ 分钟，120s 超时导致 compose 失败，2026-08-11）。
 * 公式：max(2 分钟, 输出时长 × 3 + 2 分钟)——假设最低 1.5x 实时编码速度 + 大幅余量。
 */
function computeMergeEncodeTimeoutMs (outputSeconds) {
  return computeFfmpegStageTimeoutMs('xfade', outputSeconds)
}

/**
 * 时长上限文案格式化：整分钟输出「X 分钟」，非整分钟输出「X 分 Y 秒」。
 * 避免 Math.round 在非整分钟配置下误导（如 90s 报「2 分钟」、3050s 报「51 分钟」）。
 */
function formatDurationLimit (seconds) {
  const totalSeconds = Math.max(0, Number(seconds) || 0)
  if (totalSeconds % 60 === 0) return Math.round(totalSeconds / 60) + ' 分钟'
  return Math.floor(totalSeconds / 60) + ' 分 ' + Math.round(totalSeconds % 60) + ' 秒'
}

function normalizeComposeScenes (assetManifest) {
  if (!assetManifest || typeof assetManifest !== 'object') return []
  const sentences = Array.isArray(assetManifest.sentences) ? assetManifest.sentences : []
  const images = Array.isArray(assetManifest.images) ? assetManifest.images : []
  const videos = Array.isArray(assetManifest.videos) ? assetManifest.videos : []
  const audio = Array.isArray(assetManifest.audio) ? assetManifest.audio : []
  const sourceScenes = Array.isArray(assetManifest.scenes) && assetManifest.scenes.length > 0
    ? assetManifest.scenes
    : Array.from({ length: Math.max(images.length, videos.length, audio.length) }, (_, index) => ({
        index,
        imagePath: images[index]?.path || images[index]?.imagePath,
        videoPath: videos[index]?.path || videos[index]?.videoPath,
        audioPath: audio[index]?.path || audio[index]?.audioPath,
        duration: audio[index]?.duration,
        text: sentences[index]?.text || sentences[index]?.content || '',
      }))

  return sourceScenes.map((scene, position) => {
    const index = Number.isInteger(scene?.index) && scene.index >= 0 ? scene.index : position
    const image = images[index] || images[position]
    const sound = audio[index] || audio[position]
    const sentence = sentences[index] || sentences[position]
    return {
      index,
      imagePath: scene?.imagePath || scene?.image?.path || image?.path || image?.imagePath || null,
      // 混合模式（2026-08-11）：AI 视频场景保留 videoPath
      videoPath: scene?.videoPath || scene?.video?.path || null,
      audioPath: scene?.audioPath || scene?.audio?.path || sound?.path || sound?.audioPath || null,
      duration: clampNumber(scene?.duration ?? sound?.duration, 0, 3600, null),
      text: scene?.text || scene?.content || sentence?.text || sentence?.content || '',
      prompt: scene?.prompt || '',
      // 历史提示词翻译（2026-08-12）：非 en 界面随分段持久化，结果页只读展示
      promptTranslation: scene?.promptTranslation || null,
      imageMeta: scene?.imageMeta || image?.meta || null,
      audioMeta: scene?.audioMeta || sound?.meta || null,
      subtitleBlocks: Array.isArray(scene?.subtitleBlocks)
        ? [...scene.subtitleBlocks]
        : (Array.isArray(sentence?.subtitleBlocks) ? [...sentence.subtitleBlocks] : []),
      subtitleTimeline: Array.isArray(scene?.subtitleTimeline) ? [...scene.subtitleTimeline] : [],
      sceneSource: scene?.sceneSource || sentence?.sceneSource || null,
      subtitleSource: scene?.subtitleSource || sentence?.subtitleSource || null,
      degraded: scene?.degraded === true || sentence?.degraded === true,
      fallbackReason: scene?.fallbackReason || sentence?.fallbackReason || null,
    }
  })
}

function buildImageEffectFilter (effect, width, height, fps, duration, rounding = 'round') {
  const safeWidth = Math.max(160, Math.round(Number(width) || 1280))
  const safeHeight = Math.max(160, Math.round(Number(height) || 720))
  const safeFps = Math.max(1, Math.min(120, Math.round(Number(fps) || 30)))
  // 有效时长已知时把动效进度归一化到场景时长（T=round(duration*fps)）；
  // 时长未知（探测失败/旧项目）或 duration*fps 溢出为 Infinity 时回退固定帧增量公式。
  // rounding='ceil'：min-duration 静音补齐段用 -t 锁定目标时长且去掉 -shortest，
  // 视频轨是 binding 流，d=帧数必须向上取整，避免视频轨比目标时长短 ≤1 帧造成尾部无帧（W4）。
  const rawFrames = Number.isFinite(duration) && duration > 0 ? duration * safeFps : null
  const knownFrames = rawFrames !== null && Number.isFinite(rawFrames)
  const totalFrames = knownFrames
    ? Math.max(2, rounding === 'ceil' ? Math.ceil(rawFrames) : Math.round(rawFrames))
    : Math.max(safeFps, Math.round(safeFps * 3))
  const progress = knownFrames ? 'min(1,on/' + totalFrames + ')' : null
  // 关键修复（origin/main）：zoompan 需要 d=输出总帧数（=时长×帧率）才能产生连续动画；
  // d=1 且输入为单帧静态图时 zoom 状态不累积，动效完全不可见。
  const zoompan = (zoom, x, y) =>
    "zoompan=z='" + zoom + "':x='" + x + "':y='" + y + "':d=" + totalFrames +
    ':s=' + safeWidth + 'x' + safeHeight + ':fps=' + safeFps

  switch (effect) {
    case 'zoom-in':
      return zoompan(progress ? '1+0.25*' + progress : 'min(zoom+0.0015,1.25)', 'iw/2-(iw/zoom/2)', 'ih/2-(ih/zoom/2)')
    case 'zoom-out':
      return zoompan(progress ? 'if(eq(on,1),1.25,1.25-0.25*' + progress + ')' : 'if(eq(on,1),1.25,max(zoom-0.0015,1))', 'iw/2-(iw/zoom/2)', 'ih/2-(ih/zoom/2)')
    case 'pan-left':
      // 归一化进度（min(1,on/T)）与 origin/main 的 on/totalFrames 等价；未知时长时回退 legacy 固定帧增量。
      return zoompan('1.12', progress ? '(iw-iw/zoom)*' + progress : '(iw-iw/zoom)*on/120', 'ih/2-(ih/zoom/2)')
    case 'pan-right':
      return zoompan('1.12', progress ? '(iw-iw/zoom)*(1-' + progress + ')' : '(iw-iw/zoom)*(1-on/120)', 'ih/2-(ih/zoom/2)')
    case 'pan-up':
      return zoompan('1.12', 'iw/2-(iw/zoom/2)', progress ? '(ih-ih/zoom)*' + progress : '(ih-ih/zoom)*on/120')
    case 'pan-down':
      return zoompan('1.12', 'iw/2-(iw/zoom/2)', progress ? '(ih-ih/zoom)*(1-' + progress + ')' : '(ih-ih/zoom)*(1-on/120)')
    case 'zoom-pan':
      return zoompan(progress ? '1+0.15*' + progress : 'min(zoom+0.001,1.15)', progress ? '(iw-iw/zoom)*' + progress : '(iw-iw/zoom)*on/180', 'ih/2-(ih/zoom/2)')
    case 'rotate':
      return "rotate='0.02*sin(2*PI*t/4)':fillcolor=black@0"
    case 'blur-in':
      return 'boxblur=2:1'
    default:
      return ''
  }
}

function buildSubtitleFilter (textOrTimeline, style) {
  const entries = Array.isArray(textOrTimeline)
    ? textOrTimeline
      .map(item => (typeof item === 'string' ? { text: item } : item))
      .filter(item => item && item.text)
    : (textOrTimeline ? [{ text: textOrTimeline }] : [])
  if (entries.length === 0) return ''
  const config = typeof style === 'string' ? { style } : (style || {})
  const sizeMap = {
    size1: 16, size2: 20, size3: 24, size4: 28, size5: 32, size6: 40,
    sm: 18, md: 24, lg: 32, xl: 40,
  }
  const fontSize = Math.round(clampNumber(config.fontSize || sizeMap[config.size], 12, 96, 24))
  const color = /^#[0-9a-f]{3,8}$/i.test(String(config.color || ''))
    ? String(config.color)
    : 'white'
  const borderWidth = config.style === 'style3' ? 4 : 2
  const box = config.style === 'style2' ? ':box=1:boxcolor=black@0.55:boxborderw=10' : ''
  // 字幕垂直位置：距视频底部比例（0.2 = 字幕底边位于画面 80% 高度处，即距底部 20%）。
  // 可经 subtitleStyle.bottomMarginRatio 覆盖（0.05-0.5），默认 0.2（避免贴底）。
  const bottomRatio = clampNumber(config.bottomMarginRatio, 0.05, 0.5, 0.2)
  // 中文字幕乱码修复：Windows 静态 ffmpeg 的 drawtext 默认字体无 CJK 字形，
  // 必须显式指定 fontfile（微软雅黑等），否则中文渲染成豆腐块/乱码。
  const fontFile = escapeFontFilePath(resolveCjkFont())
  const fontOption = fontFile ? ":fontfile='" + fontFile + "'" : ''
  return entries.map(item => {
    const startTime = Number(item.startTime)
    const endTime = Number(item.endTime)
    const enable = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime
      ? ":enable='gte(t," + Math.max(0, startTime).toFixed(3) + ')*lt(t,' + endTime.toFixed(3) + ")'"
      : ''
    return "drawtext=text='" + escapeSubtitleText(item.text) + "'" + fontOption + ':fontcolor=' + color +
      ':fontsize=' + fontSize + ':borderw=' + borderWidth + ':bordercolor=black' +
      box + ':x=(w-text_w)/2:y=h*' + (1 - bottomRatio).toFixed(3) + '-th' + enable
  }).join(',')
}

function normalizeSceneSubtitleBlocks (scene) {
  if (Array.isArray(scene?.subtitleBlocks) && scene.subtitleBlocks.length > 0) {
    return scene.subtitleBlocks
      .map(item => String(typeof item === 'string' ? item : item?.text || '').trim())
      .filter(Boolean)
  }
  if (Array.isArray(scene?.subtitleTimeline) && scene.subtitleTimeline.length > 0) {
    return scene.subtitleTimeline
      .map(item => String(item?.text || '').trim())
      .filter(Boolean)
  }
  return splitSubtitleBlocks(scene?.text || '')
}

/**
 * moving 水印坐标表达式（片段内嵌与成片级后置烧录共用单一来源）。
 * x 周期 100s / y 周期 140s、0.9 中心幅度、双轴 sin（sin(0)=0 → t=0 起点画面正中）；
 * 表达式内禁止逗号（防滤镜链切分）；无 random()，同参数逐帧可复现。
 */
function buildMovingWatermarkPositionExpr () {
  return "x='(w-text_w)/2*(1+0.9*sin(2*PI*t/100))':y='(h-text_h)/2*(1+0.9*sin(2*PI*t/140))'"
}

/** drawtext 色名白名单：十六进制或常用 ffmpeg 色名，其余回退 white（防止非法色名硬失败）。 */
const WATERMARK_COLOR_NAMES = new Set([
  'white', 'black', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta',
  'gray', 'grey', 'orange', 'purple', 'pink', 'brown', 'transparent',
])
function resolveWatermarkColor (rawColor) {
  const value = String(rawColor || '')
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value
  return WATERMARK_COLOR_NAMES.has(value.toLowerCase()) ? value.toLowerCase() : 'white'
}

function buildWatermarkFilter (options) {
  const config = options && typeof options.watermark === 'object'
    ? options.watermark
    : (options && options.watermarkConfig) || {}
  const enabled = config.enabled === true || options?.watermark === true
  const text = options?.watermarkText || config.text || ''
  if (!enabled || !text) return ''
  const fontSize = Math.round(clampNumber(config.fontSize, 10, 96, 24))
  const opacity = clampNumber(config.opacity, 0, 1, 0.6).toFixed(2)
  const color = resolveWatermarkColor(config.color)
  // 位置坐标契约（2026-08-14 修复）：drawtext 的 x/y 是文本包围盒左上角坐标。
  // 回归：旧公式 bottom-* 用 y=h-20、center 用 y=(h+text_h)/2，把文字主体画出画布/整体下移，
  // 导致默认 bottom-right 下成片完全看不到水印（commit e1b46eba0 引入）。
  const positions = {
    // 边距契约（2026-08-14 调整）：用户反馈四角距边过近，水平/底部 20px→40px、顶部 40px→60px。
    'top-left': 'x=40:y=60',
    'top-right': 'x=w-text_w-40:y=60',
    'bottom-left': 'x=40:y=h-text_h-40',
    'bottom-right': 'x=w-text_w-40:y=h-text_h-40',
    center: 'x=(w-text_w)/2:y=(h-text_h)/2',
    // moving：确定性 Lissajous 平滑漂移（x 周期 100s / y 周期 140s，90% 中心幅度，起点正中）。
    // 2026-08-14：用户反馈 10s/14s 漂移过快影响观看，周期放大 10 倍（速度约为原 1/10）。
    // 不用逐帧随机：ffmpeg random() 每帧取新值 → 文字闪烁且不可复现；表达式内禁止逗号（会切分滤镜链）。
    // 回归（2026-08-27）：y 曾用 cos(2*PI*t/140) —— cos(0)=1 → t=0 起点 y=0.95*(h-text_h)（底部 95%），短视频全程滞留下半区
    // （用户反馈「仅底部移动」）；sin(0)=0 起点居中，周期/幅度/确定性不变。
    moving: buildMovingWatermarkPositionExpr(),
  }
  const position = positions[config.position] || positions['bottom-right']
  const fontFile = escapeFontFilePath(resolveCjkFont())
  const fontOption = fontFile ? ":fontfile='" + fontFile + "'" : ''
  return "drawtext=text='" + escapeSubtitleText(text) + "'" + fontOption + ':fontcolor=' + color + '@' + opacity +
    ':fontsize=' + fontSize + ':' + position
}

function hasUsableFile (filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

/**
 * 根据实际片段时长生成安全的转场计划。
 * xfade 的 duration 必须小于相邻两个输入的时长，不能直接使用用户配置值。
 */
function buildTransitionPlan (segmentDurations, requestedDuration, transitionName) {
  const durations = Array.isArray(segmentDurations)
    ? segmentDurations.map(value => {
        const number = Number(value)
        return Number.isFinite(number) && number > 0 ? number : null
      })
    : []
  const total = durations.reduce((sum, value) => sum + (value || 0), 0)
  // transitionName 必须随计划返回：_xfadeMerge 从 plan.transitionName 构造
  // xfade=transition=<name>，缺失会生成 transition=undefined 导致 ffmpeg 报错。
  const resolvedTransitionName = typeof transitionName === 'string' && transitionName.trim() ? transitionName : 'fade'
  if (durations.length < 2 || durations.some(value => value === null)) {
    return { enabled: false, durations, transitions: [], totalDuration: total, transitionName: resolvedTransitionName }
  }

  const requested = clampNumber(requestedDuration, 0.1, 1.5, 0.4)
  const transitions = []
  let elapsed = durations[0]
  let previous = durations[0]
  for (let index = 1; index < durations.length; index++) {
    const current = durations[index]
    // 留出 20% 的余量，避免 duration 等于输入边界导致 ffmpeg 拒绝滤镜。
    const duration = Math.min(requested, previous * 0.8, current * 0.8)
    if (!Number.isFinite(duration) || duration < 0.01 || elapsed <= duration) {
      return { enabled: false, durations, transitions: [], totalDuration: total, transitionName: resolvedTransitionName }
    }
    transitions.push({ duration, offset: elapsed - duration })
    elapsed += current - duration
    previous = current
  }
  return { enabled: true, durations, transitions, totalDuration: elapsed, transitionName: resolvedTransitionName }
}

/**
 * 分块合成全流程的总块数 = 各级块数之和（最后一级仅复制，不新增块）。
 * 用于 87→89 拼接子进度共享同一分母，避免递归层数影响进度推进速度。
 * ⚠️ 必须与 _concatSegmentsChunked 的分块循环（ceil(剩余/块大小) 直到 ≤1）保持同步：
 * 若递归策略变化（块大小、最小块规则、最大层数），此处分母必须同步更新，
 * 否则 done 可能越界 total（percent 被钳到 89）或末块 <89（narration 跳 89 造成结尾停顿）。
 * @param {number} segmentCount - 输入片段数
 * @param {number} [chunkSize] - 每块上限，默认 MAX_XFADE_INPUTS
 * @returns {number}
 */
function countChunkedMergeChunks (segmentCount, chunkSize) {
  const size = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : MAX_XFADE_INPUTS
  let total = 0
  let remaining = Math.max(0, Math.floor(segmentCount) || 0)
  do {
    const chunks = Math.ceil(remaining / size)
    total += chunks
    remaining = chunks
  } while (remaining > 1)
  return total
}

class Story2VideoComposeEngine {
  /**
   * @param {object} [opts]
   * @param {string} [opts.outputDir] - 输出目录（默认 os.tmpdir）
   * @param {object} [opts.log] - 日志模块
   * @param {number} [opts.maxSessionAgeMs] - 历史 sessionDir 最大保留时间 ms（默认 24h）
   * @param {string[]} [opts.allowedMediaRoots] - 允许读取媒体的根目录
   */
  constructor (opts) {
    opts = opts || {}
    this.outputDir = path.resolve(opts.outputDir || path.join(os.tmpdir(), 'story2video'))
    this.log = opts.log || require('./logger')
    this.maxSessionAgeMs = opts.maxSessionAgeMs || 24 * 60 * 60 * 1000
    this.allowedMediaRoots = Array.isArray(opts.allowedMediaRoots) && opts.allowedMediaRoots.length > 0
      ? opts.allowedMediaRoots.map(root => path.resolve(root))
      : getAllowedMediaRoots([this.outputDir, process.cwd()])
    this.maxInputFileBytes = positiveLimit(opts.maxInputFileBytes, MAX_INPUT_FILE_BYTES)
    this.maxInputTotalBytes = positiveLimit(opts.maxInputTotalBytes, MAX_INPUT_TOTAL_BYTES)
    this.maxDurationSeconds = positiveLimit(opts.maxDurationSeconds, DEFAULT_MAX_DURATION_SECONDS)
    this.maxAudioDurationSeconds = positiveLimit(opts.maxAudioDurationSeconds, DEFAULT_MAX_AUDIO_DURATION_SECONDS)
    this.maxSegmentDurationSeconds = positiveLimit(opts.maxSegmentDurationSeconds, DEFAULT_MAX_SEGMENT_DURATION_SECONDS)
    this.maxOutputPixels = positiveLimit(opts.maxOutputPixels, DEFAULT_MAX_OUTPUT_PIXELS)
    // 输出分辨率能力开关：'1080p'（默认，禁止 4K）| '4k'。fail-closed——未知值一律按 1080p。
    // 支持惰性读取（运营功能开关运行时下发）：getMaxOutputResolution 优先，静态值兜底
    this.ffmpegBinary = typeof opts.ffmpegBinary === 'string' && opts.ffmpegBinary.trim()
      ? opts.ffmpegBinary.trim()
      : FFMPEG
    this.maxOutputResolution = opts.maxOutputResolution === '4k' ? '4k' : '1080p'
    this._maxOutputResolutionGetter = typeof opts.getMaxOutputResolution === 'function'
      ? opts.getMaxOutputResolution
      : null
    this._execFfmpegStage = typeof opts.execFfmpegStage === 'function'
      ? opts.execFfmpegStage
      : (args, options, stage) => execFfmpegStage(args, options, stage, this.ffmpegBinary)
    this._segmentSeq = 0
  }

  /** 当前输出分辨率能力（惰性读取运营功能开关；读取失败回退构造期静态值，fail-closed） */
  _currentMaxOutputResolution () {
    if (this._maxOutputResolutionGetter) {
      try {
        const v = this._maxOutputResolutionGetter()
        if (v === '4k' || v === '1080p') return v
      } catch (_) { /* 回退静态值 */ }
    }
    return this.maxOutputResolution
  }

  _logComposeEvent (level, event, meta) {
    const write = typeof this.log?.[level] === 'function'
      ? this.log[level]
      : this.log?.info
    if (typeof write !== 'function') return
    write.call(this.log, COMPOSE_LOG_MODULE, event, { event, ...meta })
  }

  async _runComposeStage (details, run) {
    const startedAt = Date.now()
    this._logComposeEvent('info', 'compose_stage_started', details)
    try {
      const result = await run()
      this._logComposeEvent('info', 'compose_stage_succeeded', {
        ...details,
        elapsedMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      this._logComposeEvent('error', 'compose_stage_failed', {
        ...details,
        elapsedMs: Date.now() - startedAt,
        errorCode: typeof error?.code === 'string' ? error.code : null,
        error: safeFfmpegDiagnostic(error?.message),
      })
      throw error
    }
  }

  async _runFfmpegStage (args, options, details) {
    const startedAt = Date.now()
    const outputPath = details?.outputPath || null
    const heartbeatEnabled = details?.heartbeat === true
    let lastOutputBytes = outputFileBytes(outputPath)
    let lastGrowthAt = startedAt
    const metadata = {
      composeId: details?.composeId || null,
      stage: details?.stage || null,
      operation: details?.operation || null,
      output: outputPath ? path.basename(outputPath) : null,
      inputCount: Number.isInteger(details?.inputCount) ? details.inputCount : null,
      estimatedDurationSeconds: Number.isFinite(details?.estimatedDuration) ? details.estimatedDuration : null,
      timeoutMs: Number.isFinite(options?.timeout) ? options.timeout : null,
      ...details?.meta,
    }
    const emitHeartbeat = () => {
      const now = Date.now()
      const outputBytes = outputFileBytes(outputPath)
      if (outputBytes > lastOutputBytes) lastGrowthAt = now
      const stalled = now - lastGrowthAt >= FFMPEG_STALLED_OUTPUT_WARN_MS
      this._logComposeEvent(stalled ? 'warn' : 'info', 'ffmpeg_heartbeat', {
        ...metadata,
        elapsedMs: now - startedAt,
        outputBytes,
        outputGrowing: outputBytes > lastOutputBytes,
        stalled,
      })
      if (typeof details?.onHeartbeat === 'function') {
        details.onHeartbeat({
          elapsedMs: now - startedAt,
          outputBytes,
          outputGrowing: outputBytes > lastOutputBytes,
          stalled,
        })
      }
      lastOutputBytes = outputBytes
    }
    let heartbeatTimer = null
    if (heartbeatEnabled) {
      heartbeatTimer = setInterval(emitHeartbeat, FFMPEG_HEARTBEAT_INTERVAL_MS)
      if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref()
    }
    try {
      const result = await this._execFfmpegStage(args, {
        ...options,
        onStarted: (pid) => {
          this._logComposeEvent('info', 'ffmpeg_started', { ...metadata, pid })
        },
      }, details?.operation || 'ffmpeg')
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      this._logComposeEvent('info', 'ffmpeg_succeeded', {
        ...metadata,
        elapsedMs: Date.now() - startedAt,
        outputBytes: outputFileBytes(outputPath),
      })
      return result
    } catch (error) {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      const event = isFfmpegStageTimeoutError(error) ? 'ffmpeg_timeout' : 'ffmpeg_failed'
      this._logComposeEvent(event === 'ffmpeg_timeout' ? 'warn' : 'error', event, {
        ...metadata,
        elapsedMs: Date.now() - startedAt,
        outputBytes: outputFileBytes(outputPath),
        ...ffmpegErrorMeta(error),
      })
      throw error
    }
  }

  _requireFfmpegOutput (outputPath, details, stderr) {
    if (hasUsableFile(outputPath)) return
    this._logComposeEvent('error', 'ffmpeg_output_missing', {
      composeId: details?.composeId || null,
      stage: details?.stage || null,
      operation: details?.operation || null,
      output: outputPath ? path.basename(outputPath) : null,
      outputBytes: outputFileBytes(outputPath),
      stderr: safeFfmpegDiagnostic(stderr),
      ...details?.meta,
    })
    throw new Error(details?.message || 'ffmpeg did not produce output')
  }

  /**
   * 合成视频
   * @param {object} assetManifest - generate_assets 阶段的输出
   * @param {object} [options] - 合成选项；可携带 `onProgress` 回调（与第三参等价，第三参优先）
   * @param {Function} [onProgress] - 子进度回调 `({ phase, percent, segmentsDone?, segmentsTotal?, message? }) => void`；
   *    percent 单调不降、整数 0-100；done/100 仅在成功 return 前发射，失败路径冻结在最后有效值
   * @returns {Promise<{code: number, data?: object, message?: string}>}
   *   data.warnings 为机器码数组（bgm_*，调试/可观测用，非用户文案）；
   *   BGM 降级语义见 data.bgmSkipped / data.bgmSkippedReason（renderer 据此本地化）。
   */
  async compose (assetManifest, options, onProgress) {
    // 子进度回调：第三参优先，兼容 options.onProgress；发射值经 normalizeComposeProgressUpdate
    // 归一化且 percent 单调不降。done/100 只在成功 return 前发射；失败路径冻结在最后有效值。
    const progressCb = (typeof onProgress === 'function')
      ? onProgress
      : (options && typeof options.onProgress === 'function' ? options.onProgress : null)
    let lastEmittedPercent = -1
    const emitComposeProgress = (update) => {
      if (!progressCb) return
      const normalized = normalizeComposeProgressUpdate(update)
      if (!normalized) return
      if (normalized.percent < lastEmittedPercent) return
      lastEmittedPercent = normalized.percent
      progressCb(normalized)
    }

    const composeSequence = ++this._segmentSeq
    const composeId = 'compose_' + Date.now() + '_' + composeSequence
    this._logComposeEvent('info', 'compose_started', {
      composeId,
      stage: 'compose',
      sceneCount: Array.isArray(assetManifest?.scenes) ? assetManifest.scenes.length : null,
      requestedFormat: options?.format === 'webm' ? 'webm' : 'mp4',
      transition: options?.transition || 'fade',
    })
    const logComposeFailure = (stage, error, meta) => {
      this._logComposeEvent('error', 'compose_failed', {
        composeId,
        stage,
        errorCode: typeof error?.code === 'string' ? error.code : null,
        error: safeFfmpegDiagnostic(error?.message || error),
        ...meta,
      })
    }

    if (!this.ffmpegBinary) {
      logComposeFailure('preflight', 'ffmpeg not found', { reason: 'ffmpeg_not_found' })
      return { code: -1, message: 'ffmpeg not found' }
    }

    let scenes = normalizeComposeScenes(assetManifest)
    if (scenes.length === 0) {
      logComposeFailure('preflight', 'Invalid assetManifest', { reason: 'invalid_asset_manifest' })
      return { code: -1, message: 'Invalid assetManifest: missing scenes or image/audio pairs' }
    }

    const resolutionError = validateResolution(options?.resolution, this.maxOutputPixels)
    if (resolutionError) {
      logComposeFailure('preflight', resolutionError, { reason: 'invalid_resolution' })
      return { code: -1, message: resolutionError }
    }
    // 运营开关 fail-closed：未开启 4K 时拒绝 4K 及以上输出分辨率
    const capabilityError = validateResolutionCapability(options?.resolution, this._currentMaxOutputResolution())
    if (capabilityError) {
      logComposeFailure('preflight', capabilityError, { reason: 'resolution_capability_rejected' })
      return { code: -1, message: capabilityError }
    }

    const requestedBgmPath = options?.bgmPath || assetManifest.bgmPath || assetManifest.bgm?.path
    // BGM 为可选配置：文件缺失/不可读/越界时降级为无 BGM 继续合成（不整条流水线失败）。
    // data.warnings 仅含机器码（bgm_*，见 BGM_SKIP_WARNING_CODES），供调试/可观测，不承载用户可见文案；
    // 用户提示由前端依 data.bgmSkippedReason 本地化（story2video-notifications 单一来源，2026-08-10）。
    const composeWarnings = []
    let bgmSkipped = false
    let bgmSkippedReason = null
    let totalInputBytes = 0
    const accountInput = (filePath) => {
      const stat = fs.statSync(filePath)
      totalInputBytes += stat.size
      return totalInputBytes <= this.maxInputTotalBytes
    }
    const preparedScenes = []
    for (let index = 0; index < scenes.length; index++) {
      const scene = scenes[index]
      // 混合模式（2026-08-11）：AI 视频场景提供 videoPath，图片轮播场景提供 imagePath；二选一且 audioPath 必有。
      const videoPath = resolveReadableMediaFile(scene?.videoPath, {
        kind: 'video',
        allowedRoots: this.allowedMediaRoots,
        // 视频源按媒体规则上限（512MB）校验，而非通用输入上限（100MB），与 PRD 7.1.25 一致（2026-08-11 W6）
        maxBytes: Math.max(this.maxInputFileBytes, 512 * 1024 * 1024),
      })
      const imagePath = videoPath
        ? null
        : resolveReadableMediaFile(scene?.imagePath, {
            kind: 'image',
            allowedRoots: this.allowedMediaRoots,
            maxBytes: this.maxInputFileBytes,
          })
      const audioPath = resolveReadableMediaFile(scene?.audioPath, {
        kind: 'audio',
        allowedRoots: this.allowedMediaRoots,
        maxBytes: this.maxInputFileBytes,
      })
      if (!videoPath && !imagePath) {
        logComposeFailure('preflight', 'Scene media path rejected', { reason: 'scene_media_unreadable', sceneIndex: index })
        return { code: -1, message: 'Scene media path is not allowed or unreadable at index ' + index }
      }
      if (!audioPath) {
        logComposeFailure('preflight', 'Scene audio path rejected', { reason: 'scene_audio_unreadable', sceneIndex: index })
        return { code: -1, message: 'Scene audio path is not allowed or unreadable at index ' + index }
      }
      const mediaInputs = videoPath ? [videoPath, audioPath] : [imagePath, audioPath]
      for (const mediaPath of mediaInputs) {
        if (!accountInput(mediaPath)) {
          logComposeFailure('preflight', 'Input media exceeds total size limit', { reason: 'input_size_limit' })
          return { code: -1, message: 'Input media exceeds the total size limit' }
        }
      }
      preparedScenes.push({ ...scene, videoPath, imagePath, audioPath })
    }
    scenes = preparedScenes

    let bgmPath = null
    if (requestedBgmPath) {
      bgmPath = resolveReadableMediaFile(requestedBgmPath, {
        kind: 'bgm',
        allowedRoots: this.allowedMediaRoots,
        maxBytes: this.maxInputFileBytes,
      })
      if (!bgmPath) {
        // 降级而非失败：BGM 可选。重试/断点续跑可能引用已被清理或移动的路径。
        const reason = diagnoseBgmSkipReason(requestedBgmPath, this.allowedMediaRoots)
        this.log.warn('Story2VideoCompose', 'BGM skipped: ' + reason + ' (requested path could not be resolved)')
        bgmSkipped = true
        bgmSkippedReason = reason
        composeWarnings.push(BGM_SKIP_WARNING_CODES[reason] || BGM_SKIP_WARNING_CODES.unreadable)
      } else if (!accountInput(bgmPath)) {
        logComposeFailure('preflight', 'Input media exceeds total size limit', { reason: 'input_size_limit' })
        return { code: -1, message: 'Input media exceeds the total size limit' }
      }
    }

    // 子进度：素材路径/大小校验通过后进入耗时预检（probe 音频时长）
    emitComposeProgress({
      phase: 'preflight',
      percent: 0,
      segmentsTotal: scenes.length,
      message: '正在准备视频合成素材',
    })

    // 场景时长模式（三层模型③）：follow-audio 跟随旁白（默认）；min-duration 以静音补齐到 minSceneDuration
    const sceneDurationMode = options?.sceneDurationMode === 'min-duration' ? 'min-duration' : 'follow-audio'
    const minSceneDuration = clampNumber(options?.minSceneDuration, 1, 60, 6)
    // 提前声明：预检（effectiveRequestedDuration）与场景循环共用同一默认值，避免 TDZ
    const defaultSceneDuration = clampNumber(options?.defaultSceneDuration, 1, 60, 6)

    const probedAudioDurations = []
    let totalAudioDuration = 0
    for (let index = 0; index < scenes.length; index++) {
      const audioDuration = await this._probeMediaDuration(scenes[index].audioPath)
      probedAudioDurations.push(audioDuration)
      if (!audioDuration) continue
      if (scenes.length > 1 && audioDuration > this.maxSegmentDurationSeconds) {
        logComposeFailure('preflight', 'Segment narration duration limit exceeded', { reason: 'segment_duration_limit', sceneIndex: index })
        return { code: -1, message: '单段旁白时长不能超过 ' + formatDurationLimit(this.maxSegmentDurationSeconds) }
      }
      totalAudioDuration += audioDuration
    }
    // 成片检查在前：默认成片与旁白上限一致，任何超限输入先返回「成片总时长」文案（PRD §7.1.25a 合同）；
    // 旁白检查仅在旁白上限低于成片上限（更严旁白约束）时可达。
    if (totalAudioDuration > this.maxDurationSeconds) {
      logComposeFailure('preflight', 'Output duration limit exceeded', { reason: 'output_duration_limit' })
      return { code: -1, message: '成片总时长不能超过 ' + formatDurationLimit(this.maxDurationSeconds) }
    }
    if (totalAudioDuration > this.maxAudioDurationSeconds) {
      logComposeFailure('preflight', 'Narration duration limit exceeded', { reason: 'narration_duration_limit' })
      return { code: -1, message: '旁白音频总时长不能超过 ' + formatDurationLimit(this.maxAudioDurationSeconds) }
    }
    const effectiveRequestedDuration = scenes.reduce((total, scene, index) => {
      // min-duration 模式预检与场景循环共用同一 base 公式（probed || duration || defaultSceneDuration），
      // 并计入静音补齐；follow-audio 分支保持原公式（probed || duration || 0）逐字节不变（W3）。
      const base = sceneDurationMode === 'min-duration'
        ? (probedAudioDurations[index] || Number(scene.duration) || defaultSceneDuration)
        : (probedAudioDurations[index] || Number(scene.duration) || 0)
      return total + (sceneDurationMode === 'min-duration' ? Math.max(base, minSceneDuration) : base)
    }, 0)
    if (effectiveRequestedDuration > this.maxDurationSeconds) {
      logComposeFailure('preflight', 'Requested duration limit exceeded', { reason: 'requested_duration_limit' })
      return { code: -1, message: 'Requested video duration exceeds the allowed limit of ' + Math.round(this.maxDurationSeconds / 60) + ' minutes' }
    }

    // 子进度：预检全部通过，进入逐片段合成
    emitComposeProgress({
      phase: 'validated',
      percent: 3,
      segmentsTotal: scenes.length,
      message: '素材校验完成',
    })
    emitComposeProgress({
      phase: 'segments',
      percent: 3,
      segmentsDone: 0,
      segmentsTotal: scenes.length,
      message: '开始合成视频片段',
    })

    // 确保输出目录存在
    fs.mkdirSync(this.outputDir, { recursive: true })

    // P2-7: 启动时清理历史残留 sessionDir（超过 maxSessionAgeMs）
    this._cleanupOldSessions()

    const sessionId = 's2v_' + Date.now() + '_' + composeSequence
    const sessionDir = path.join(this.outputDir, sessionId)
    fs.mkdirSync(sessionDir, { recursive: true })

    const transition = options?.transition || 'fade'
    const subtitleEnabled = options?.subtitleEnabled !== false
    const resolution = parseResolution(options?.resolution)
    const fps = clampNumber(options?.fps, 1, 120, 30)
    const voiceVolume = clampNumber(options?.voiceVolume, 0, 2, 1)
    const outputFormat = options?.format === 'webm' ? 'webm' : 'mp4'

    this._logComposeEvent('info', 'compose_session_created', {
      composeId,
      stage: 'preflight',
      sceneCount: scenes.length,
      session: path.basename(sessionDir),
    })

    // 1. 为每个图片+音频对创建视频片段
    const segments = []
    const segmentRecords = []
    const segmentDurations = []
    let accumulatedDuration = 0

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]
      const segPath = path.join(sessionDir, 'seg_' + String(i).padStart(4, '0') + '.mp4')
      const reportedDuration = scene.duration === null || scene.duration === undefined
        ? null
        : clampNumber(scene.duration, 0.1, 3600, null)
      const audioDuration = probedAudioDurations[i]
      // scene.duration 是 TTS 提供方上报的非权威元数据，不是剪辑上限；裁剪由 trim API 负责。
      // ffprobe 成功时以真实音频时长为准，避免旁白被截断；缺少上报值时由 -shortest 跟随音频。
      const duration = reportedDuration && audioDuration ? audioDuration : reportedDuration
      const subtitleBlocks = normalizeSceneSubtitleBlocks(scene)
      // 动效归一化、静音补齐与字幕时间轴统一使用“有效时长”：真实音频时长优先，探测失败时回退上报时长/defaultSceneDuration；
      // min-duration 模式下取 max(音频实际时长, minSceneDuration)。
      const baseDuration = audioDuration || duration || defaultSceneDuration
      const effectDuration = sceneDurationMode === 'min-duration'
        ? Math.max(baseDuration, minSceneDuration)
        : baseDuration
      const subtitleTimeline = buildSubtitleTimeline(subtitleBlocks, effectDuration)
      // C1：仅当真实探测到音频（audioDuration 非空）且补齐目标严格大于音频时长时启用静音补齐；
      // 探测失败一律走 follow-audio -shortest 路径，绝不 -t/apad 硬截断未知长度旁白。
      const padTo = sceneDurationMode === 'min-duration' && audioDuration !== null && audioDuration > 0 &&
        effectDuration > audioDuration
        ? clampNumber(effectDuration, 0.1, 3600, null)
        : null

      try {
        await this._runComposeStage({
          composeId,
          stage: 'segments',
          operation: scene.videoPath ? 'video_segment_encode' : 'image_segment_encode',
          sceneIndex: i,
          estimatedDurationSeconds: effectDuration,
          output: path.basename(segPath),
        }, async () => {
          const segmentOptions = {
            duration,
            effectDuration,
            sceneDurationMode,
            padTo,
            subtitleText: subtitleEnabled ? scene.text : '',
            subtitleTimeline: subtitleEnabled ? subtitleTimeline : [],
            transition,
            imageEffect: options?.imageEffect || 'none',
            subtitleStyle: options?.subtitleStyle,
            watermark: options?.watermark,
            watermarkText: options?.watermarkText,
            watermarkConfig: options?.watermarkConfig,
            voiceVolume,
            width: resolution.width,
            height: resolution.height,
            fps,
            composeId,
            sceneIndex: i,
            videoMode: options?.videoMode || 'off',
            shortVideoHandling: options?.shortVideoHandling || 'loop',
            sceneTotal: scenes.length,
          }
          // 混合模式（2026-08-11）：AI 视频场景走视频片段编码，图片轮播场景走 zoompan 编码
          if (scene.videoPath) await this._createVideoSegment(scene.videoPath, scene.audioPath, segPath, segmentOptions)
          else await this._createSegment(scene.imagePath, scene.audioPath, segPath, segmentOptions)
        })
        segments.push(segPath)
        const actualDuration = await this._probeMediaDuration(segPath)
        const segmentDuration = actualDuration || duration || audioDuration || defaultSceneDuration
        accumulatedDuration += segmentDuration
        if (accumulatedDuration > this.maxDurationSeconds) {
          this._cleanupSession(sessionDir)
          return { code: -1, message: 'Composed video duration exceeds the allowed limit of ' + Math.round(this.maxDurationSeconds / 60) + ' minutes' }
        }
        segmentDurations.push(segmentDuration)
        segmentRecords.push({
          ...scene,
          duration: segmentDuration,
          // 真实 TTS 音频时长（探测失败为 null）：供 5b TTS 时长样本校准采集，
          // min-duration 补齐场景的 duration 为视频片段时长，与旁白实际时长分离。
          audioDuration,
          subtitleBlocks,
          subtitleTimeline: buildSubtitleTimeline(subtitleBlocks, segmentDuration),
          videoPath: segPath,
          mediaKind: scene.videoPath ? 'video' : 'image',
          status: 'completed',
        })
        // 子进度：每完成一个片段更新一次（percent = 3 + 72·k/N，k=N 时精确 75）
        emitComposeProgress({
          phase: 'segments',
          percent: 3 + (72 * (i + 1)) / scenes.length,
          segmentsDone: i + 1,
          segmentsTotal: scenes.length,
          message: '正在合成视频片段 ' + (i + 1) + '/' + scenes.length,
        })
        this._logComposeEvent('info', 'segment_created', {
          composeId,
          stage: 'segments',
          operation: scene.videoPath ? 'video_segment_encode' : 'image_segment_encode',
          sceneIndex: i,
          output: path.basename(segPath),
          outputBytes: outputFileBytes(segPath),
          durationSeconds: segmentDuration,
        })
      } catch (e) {
        logComposeFailure('segments', e, { sceneIndex: i })
        this._cleanupSession(sessionDir)
        return { code: -1, message: 'Segment ' + i + ' failed to create: ' + safeFfmpegDiagnostic(e.message) }
      }
    }

    if (segments.length === 0) {
      // P2-7: 失败时清理 sessionDir
      this._cleanupSession(sessionDir)
      return { code: -1, message: 'All segments failed to create' }
    }

    const estimatedNarrationDuration = scenes.reduce((sum, scene, index) => {
      const reportedDuration = Number(scene.duration)
      const fallbackDuration = Number.isFinite(reportedDuration) && reportedDuration > 0 ? reportedDuration : 0
      const probedDuration = Number(probedAudioDurations[index])
      const audioDuration = Number.isFinite(probedDuration) && probedDuration > 0
        ? probedDuration
        : fallbackDuration
      return sum + audioDuration
    }, 0)
    const segmentDurationTotal = segmentDurations.reduce((sum, duration) => sum + duration, 0)
    const transitionName = TRANSITION_NAMES[transition]
    const finalTransitionPlan = transitionName
      ? buildTransitionPlan(segmentDurations, options?.transitionDuration, transitionName)
      : null
    const estimatedOutputDuration = finalTransitionPlan?.enabled
      ? finalTransitionPlan.totalDuration
      : segmentDurationTotal

    // 子进度：进入拼接（含 chunked 递归合成，权重拓宽到 87 避免长视频停滞）
    emitComposeProgress({
      phase: 'concat',
      percent: 87,
      segmentsDone: segments.length,
      segmentsTotal: scenes.length,
      message: '正在拼接视频片段',
    })

    // 2. 拼接所有片段
    const outputPath = path.join(sessionDir, 'output.mp4')
    try {
      await this._runComposeStage({
        composeId,
        stage: 'concat',
        operation: 'segment_concat',
        inputCount: segments.length,
        estimatedDurationSeconds: estimatedOutputDuration,
        output: path.basename(outputPath),
      }, async () => {
        if (segments.length === 1) {
          fs.copyFileSync(segments[0], outputPath)
          return
        }
        await this._concatSegments(segments, outputPath, sessionDir, {
          transition,
          transitionDuration: options?.transitionDuration,
          segmentDurations,
          composeId,
          // 分块拼接子进度：每完成一块在 87→89 之间推进一次，消除超长列表拼接期"假卡死"
          onChunkCreated: (chunk) => {
            emitComposeProgress({
              phase: 'concat',
              percent: 87 + (2 * chunk.done) / chunk.total,
              segmentsDone: segments.length,
              segmentsTotal: scenes.length,
              message: '正在拼接视频片段（分块 ' + chunk.done + '/' + chunk.total + '）',
            })
          },
        })
      })
    } catch (e) {
      // P2-7: 拼接失败时清理 sessionDir
      logComposeFailure('concat', e, { inputCount: segments.length })
      this._cleanupSession(sessionDir)
      throw e
    }

    // 子进度：旁白合并
    emitComposeProgress({
      phase: 'narration',
      percent: 89,
      segmentsDone: segments.length,
      segmentsTotal: scenes.length,
      message: '正在合并旁白音频',
    })

    // 3. 将所有分段旁白合并为独立音频，结果页可播放和下载完整旁白。
    const narrationPath = path.join(sessionDir, 'narration.m4a')
    try {
      await this._runComposeStage({
        composeId,
        stage: 'narration',
        operation: 'narration_concat',
        inputCount: scenes.length,
        estimatedDurationSeconds: estimatedNarrationDuration,
        output: path.basename(narrationPath),
      }, () => this._concatNarrationAudio(
        scenes.map(scene => scene.audioPath),
        narrationPath,
        sessionDir,
        voiceVolume,
        estimatedNarrationDuration,
        { composeId, stage: 'narration' },
      ))
    } catch (e) {
      logComposeFailure('narration', e, { inputCount: scenes.length })
      this._cleanupSession(sessionDir)
      return { code: -1, message: 'Narration concat failed: ' + safeFfmpegDiagnostic(e.message) }
    }

    // 4. 可选 BGM 混音（仅接受已下载的本地文件，避免在主进程隐式发起网络请求）
    let composedPath = outputPath

    // 4.5 移动水印后置烧录（跨镜头连续漂移，2026-08-27）
    // 架构变更：moving 水印若在片段内绘制，drawtext 的 t 时间轴在片段级重置，
    // 每个镜头都从画面中心独立漂移，镜头切换时位置跳变（用户反馈「只在底部移动」的
    // 同源问题：片段级 t 短 + cos 起点在底部，见 buildWatermarkFilter 回归注释）。
    // 提升到 xfade 合并后统一叠加：t 为成片时间轴，漂移跨镜头连续、全程贴近中心往返。
    // 代价：整片视频轨重编码一次（音频 -c:a copy 不重编码）；额外编码耗时与回退考量
    // 见 openspec/changes/watermark-cross-segment-continuous-drift/design.md。
    const watermarkConfig = options && typeof options.watermark === 'object'
      ? options.watermark
      : (options?.watermarkConfig || {})
    const watermarkEnabled = options?.watermark === true || watermarkConfig?.enabled === true
    const watermarkText = options?.watermarkText || watermarkConfig?.text || ''
    if (segments.length > 1 && watermarkConfig?.position === 'moving' && watermarkEnabled && watermarkText) {
      emitComposeProgress({
        phase: 'watermark',
        percent: 90,
        segmentsDone: segments.length,
        segmentsTotal: scenes.length,
        message: '正在烧录移动水印',
      })
      const watermarkedPath = path.join(sessionDir, 'watermarked.mp4')
      try {
        await this._runComposeStage({
          composeId,
          stage: 'watermark',
          operation: 'watermark_burn',
          inputCount: 1,
          estimatedDurationSeconds: estimatedOutputDuration,
          output: path.basename(watermarkedPath),
        }, () => this._burnMovingWatermark(
          composedPath,
          watermarkedPath,
          watermarkConfig,
          watermarkText,
          estimatedOutputDuration,
          { composeId, stage: 'watermark' },
        ))
        composedPath = watermarkedPath
      } catch (e) {
        logComposeFailure('watermark', e, { inputCount: 1 })
        this._cleanupSession(sessionDir)
        return { code: -1, message: 'Watermark burn failed: ' + safeFfmpegDiagnostic(e.message) }
      }
    }
    if (bgmPath) {
      // 混音前复核：文件可能在合成期间被惰性 GC 删除（运行中导入触发），降级而非硬失败。
      const stillValid = resolveReadableMediaFile(bgmPath, {
        kind: 'bgm',
        allowedRoots: this.allowedMediaRoots,
        maxBytes: this.maxInputFileBytes,
      })
      if (!stillValid) {
        bgmSkipped = true
        bgmSkippedReason = 'unreadable'
        bgmPath = null
        composeWarnings.push(BGM_SKIP_WARNING_CODES.unreadable)
        this.log.warn('Story2VideoCompose', 'BGM skipped at mix time: file no longer readable')
      } else {
        bgmPath = stillValid
        // 子进度：混音开始
        emitComposeProgress({
          phase: 'bgm',
          percent: 92,
          segmentsDone: segments.length,
          segmentsTotal: scenes.length,
          message: '正在混入背景音乐',
        })
        const mixedPath = path.join(sessionDir, 'mixed.mp4')
        try {
          await this._runComposeStage({
            composeId,
            stage: 'bgm',
            operation: 'bgm_mix',
            inputCount: 2,
            estimatedDurationSeconds: estimatedOutputDuration,
            output: path.basename(mixedPath),
          }, () => this._mixBgm(
            composedPath,
            bgmPath,
            mixedPath,
            options?.bgmVolume,
            estimatedOutputDuration,
            { composeId, stage: 'bgm' },
          ))
          composedPath = mixedPath
        } catch (e) {
          logComposeFailure('bgm', e)
          this._cleanupSession(sessionDir)
          return { code: -1, message: 'BGM mix failed: ' + safeFfmpegDiagnostic(e.message) }
        }
      }
    }

    if (outputFormat === 'webm') {
      // 子进度：WebM 转码开始
      emitComposeProgress({
        phase: 'webm',
        percent: 95,
        segmentsDone: segments.length,
        segmentsTotal: scenes.length,
        message: '正在转码 WebM 输出',
      })
      const webmPath = path.join(sessionDir, 'output.webm')
      try {
        await this._runComposeStage({
          composeId,
          stage: 'webm',
          operation: 'webm_transcode',
          inputCount: 1,
          estimatedDurationSeconds: estimatedOutputDuration,
          output: path.basename(webmPath),
        }, () => this._transcodeWebm(composedPath, webmPath, estimatedOutputDuration, { composeId, stage: 'webm' }))
        composedPath = webmPath
      } catch (e) {
        logComposeFailure('webm', e)
        this._cleanupSession(sessionDir)
        return { code: -1, message: 'WebM transcode failed: ' + safeFfmpegDiagnostic(e.message) }
      }
    }

    // 子进度：输出校验
    emitComposeProgress({
      phase: 'verify',
      percent: 98,
      segmentsDone: segments.length,
      segmentsTotal: scenes.length,
      message: '正在校验输出视频',
    })

    // 5. 验证输出：非空 + ffmpeg 可解码
    if (!hasUsableFile(composedPath)) {
      this._logComposeEvent('error', 'ffmpeg_output_missing', {
        composeId,
        stage: 'verify',
        operation: 'output_validation',
        output: path.basename(composedPath),
        outputBytes: outputFileBytes(composedPath),
      })
      logComposeFailure('verify', 'Output file not created', { reason: 'output_missing' })
      this._cleanupSession(sessionDir)
      return { code: -1, message: 'Output file not created' }
    }
    if (options?.validateOutput !== false) {
      try {
        await this._runComposeStage({
          composeId,
          stage: 'verify',
          operation: 'output_validation',
          inputCount: 1,
          estimatedDurationSeconds: estimatedOutputDuration,
          output: path.basename(composedPath),
        }, () => this._validateOutput(composedPath, estimatedOutputDuration, { composeId, stage: 'verify' }))
      } catch (e) {
        logComposeFailure('verify', e)
        this._cleanupSession(sessionDir)
        return { code: -1, message: 'Output validation failed: ' + safeFfmpegDiagnostic(e.message) }
      }
    }

    const measuredOutputDuration = await this._probeMediaDuration(composedPath)
    const calculatedOutputDuration = estimatedOutputDuration
    const outputDuration = measuredOutputDuration || Math.max(0, calculatedOutputDuration)

    // 6. 成功后，将成片、完整旁白和分段视频移到 outputDir 根目录。
    const finalPath = path.join(this.outputDir, sessionId + '_output.' + outputFormat)
    try {
      fs.copyFileSync(composedPath, finalPath)
    } catch (e) {
      // 移动失败则保留原路径（output.mp4 仍在 sessionDir 内）
      this._logComposeEvent('warn', 'final_output_copy_fallback', {
        composeId,
        stage: 'persist',
        error: safeFfmpegDiagnostic(e.message),
        output: path.basename(composedPath),
      })
       const stat = fs.statSync(composedPath)
      // 子进度：成功完成（done 仅出现在成功 return 前）
      emitComposeProgress({
        phase: 'done',
        percent: 100,
        segmentsDone: segments.length,
        segmentsTotal: scenes.length,
        message: '视频合成完成',
      })
      this._logComposeEvent('info', 'compose_succeeded', {
        composeId,
        stage: 'done',
        segmentCount: segments.length,
        output: path.basename(composedPath),
        outputBytes: stat.size,
        durationSeconds: outputDuration,
        persisted: false,
      })
      return {
        code: 0,
        data: {
          videoPath: composedPath,
          fileSize: stat.size,
          segmentCount: segments.length,
          duration: outputDuration,
          bgmApplied: Boolean(bgmPath),
          bgmSkipped,
          bgmSkippedReason,
          warnings: composeWarnings.length > 0 ? [...composeWarnings] : undefined,
          format: outputFormat,
          audioPath: narrationPath,
          segments: segmentRecords,
        },
      }
    }
    const finalNarrationPath = path.join(this.outputDir, sessionId + '_narration.m4a')
    const finalSegmentDir = path.join(this.outputDir, sessionId + '_segments')
    let finalSegments
    try {
      fs.copyFileSync(narrationPath, finalNarrationPath)
      fs.mkdirSync(finalSegmentDir, { recursive: true })
      finalSegments = segmentRecords.map((segment, index) => {
        const videoPath = path.join(finalSegmentDir, 'segment_' + String(index).padStart(4, '0') + '.mp4')
        fs.copyFileSync(segment.videoPath, videoPath)
        const sceneVideoPath = segment.videoMeta && segment.videoMeta.sceneVideoPath ? segment.videoMeta.sceneVideoPath : segment.videoPath
        return { ...segment, videoPath, videoMeta: { ...segment.videoMeta, sceneVideoPath: sceneVideoPath || segment.videoPath } }
      })
    } catch (e) {
      try { fs.rmSync(finalSegmentDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
      try { fs.unlinkSync(finalNarrationPath) } catch (_) { /* ignore */ }
      try { fs.unlinkSync(finalPath) } catch (_) { /* ignore */ }
      logComposeFailure('persist', e, { output: path.basename(finalPath) })
      this._cleanupSession(sessionDir)
      return { code: -1, message: 'Failed to persist compose artifacts: ' + safeFfmpegDiagnostic(e.message) }
    }
    // 成功移到 finalPath 后清理 sessionDir
    this._cleanupSession(sessionDir)

    const stat = fs.statSync(finalPath)
    if (!stat || stat.size <= 0) {
      logComposeFailure('persist', 'Final output file is empty', { reason: 'final_output_empty', output: path.basename(finalPath) })
      return { code: -1, message: 'Final output file is empty' }
    }

    // 子进度：成功完成（done 仅出现在成功 return 前）
    emitComposeProgress({
      phase: 'done',
      percent: 100,
      segmentsDone: segments.length,
      segmentsTotal: scenes.length,
      message: '视频合成完成',
    })
    this._logComposeEvent('info', 'compose_succeeded', {
      composeId,
      stage: 'done',
      segmentCount: segments.length,
      output: path.basename(finalPath),
      outputBytes: stat.size,
      durationSeconds: outputDuration,
      persisted: true,
    })

    return {
      code: 0,
      data: {
        videoPath: finalPath,
        fileSize: stat.size,
        segmentCount: segments.length,
        duration: outputDuration,
        bgmApplied: Boolean(bgmPath),
        bgmSkipped,
        bgmSkippedReason,
        warnings: composeWarnings.length > 0 ? [...composeWarnings] : undefined,
        format: outputFormat,
        audioPath: finalNarrationPath,
        segments: finalSegments,
      },
    }
  }

  /** 重新渲染一个分段，供结果页单段重试使用。 */
  async renderSegment (scene, options = {}, destinationPath) {
    if (!this.ffmpegBinary) return { code: -1, message: 'ffmpeg not found' }
    if (!scene || typeof scene !== 'object' || typeof destinationPath !== 'string' || !path.isAbsolute(destinationPath)) {
      return { code: -1, message: 'Invalid segment render request' }
    }
    // 与 compose() 同能力守卫：未开启 4K 时拒绝 4K 分段渲染
    const capabilityError = validateResolutionCapability(options.resolution, this._currentMaxOutputResolution())
    if (capabilityError) return { code: -1, message: capabilityError }
    const videoPath = resolveReadableMediaFile(scene.videoPath, {
      kind: 'video', allowedRoots: this.allowedMediaRoots, maxBytes: Math.max(this.maxInputFileBytes, 512 * 1024 * 1024),
    })
    const imagePath = videoPath
      ? null
      : resolveReadableMediaFile(scene.imagePath, {
          kind: 'image', allowedRoots: this.allowedMediaRoots, maxBytes: this.maxInputFileBytes,
        })
    const audioPath = resolveReadableMediaFile(scene.audioPath, {
      kind: 'audio', allowedRoots: this.allowedMediaRoots, maxBytes: this.maxInputFileBytes,
    })
    if ((!imagePath && !videoPath) || !audioPath) {
      return { code: -1, message: 'Segment media path is not allowed or unreadable' }
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
    const audioDuration = await this._probeMediaDuration(audioPath)
    // 与 _composeScene 对齐：上报 duration 收敛到 0.1..3600，避免极端有限值经
    // duration*fps 溢出为 Infinity 使动效归一化静默退化。
    const reportedDuration = scene.duration === null || scene.duration === undefined
      ? null
      : clampNumber(scene.duration, 0.1, 3600, null)
    const duration = reportedDuration && audioDuration ? audioDuration : reportedDuration
    const subtitleBlocks = normalizeSceneSubtitleBlocks(scene)
    // min-duration 补齐与动效归一化统一 effectiveDuration（与 compose() 对齐），字幕时间轴同样按补齐后时长生成
    const sceneDurationMode = options.sceneDurationMode === 'min-duration' ? 'min-duration' : 'follow-audio'
    const minSceneDuration = clampNumber(options.minSceneDuration, 1, 60, 6)
    const baseEffective = audioDuration || duration || clampNumber(options.defaultSceneDuration, 1, 60, 6)
    const effectDuration = sceneDurationMode === 'min-duration'
      ? Math.max(baseEffective, minSceneDuration)
      : baseEffective
    const subtitleTimeline = buildSubtitleTimeline(subtitleBlocks, effectDuration)
    // C1：与 compose() 同守卫——仅真实探测到音频且补齐目标严格大于音频时长时才启用静音补齐
    const padTo = sceneDurationMode === 'min-duration' && audioDuration !== null && audioDuration > 0 &&
      effectDuration > audioDuration
      ? clampNumber(effectDuration, 0.1, 3600, null)
      : null
    try {
      const segmentOpts = {
        duration,
        effectDuration,
        sceneDurationMode,
        padTo,
        subtitleText: options.subtitleEnabled === false ? '' : (scene.text || ''),
        subtitleTimeline: options.subtitleEnabled === false ? [] : subtitleTimeline,
        transition: options.transition || 'none',
        imageEffect: options.imageEffect || 'none',
        subtitleStyle: options.subtitleStyle,
        watermark: options.watermark,
        watermarkText: options.watermarkText,
        watermarkConfig: options.watermarkConfig,
        voiceVolume: clampNumber(options.voiceVolume, 0, 2, 1),
        ...parseResolution(options.resolution),
        fps: clampNumber(options.fps, 1, 120, 30),
        videoMode: options.videoMode || 'off',
        shortVideoHandling: options.shortVideoHandling || 'loop',
      }
      if (videoPath) {
        await this._createVideoSegment(videoPath, audioPath, destinationPath, segmentOpts)
      } else {
        await this._createSegment(imagePath, audioPath, destinationPath, segmentOpts)
      }
      const measuredDuration = await this._probeMediaDuration(destinationPath)
      const finalDuration = measuredDuration || audioDuration || duration
      return {
        code: 0,
        data: {
          videoPath: destinationPath,
          duration: finalDuration,
          audioDuration,
          subtitleBlocks,
          subtitleTimeline: buildSubtitleTimeline(subtitleBlocks, finalDuration),
        },
      }
    } catch (error) {
      try { fs.unlinkSync(destinationPath) } catch (_) { /* ignore */ }
      return { code: -1, message: safeFfmpegDiagnostic(error.message) }
    }
  }

  /**
   * 清理单个 sessionDir（删除目录及所有内容）
   *
   * 注意：fs.rmSync({ recursive: true }) 在部分 Windows 环境静默失败（不抛错但未删除），
   * 改用手动递归删除（unlinkSync + rmdirSync）确保跨平台可靠。
   *
   * @param {string} sessionDir - session 目录路径
   * @private
   */
  _cleanupSession (sessionDir) {
    try {
      if (!fs.existsSync(sessionDir)) return
      const target = path.resolve(sessionDir)
      const outputRoot = path.resolve(this.outputDir)
      const canonicalTarget = fs.realpathSync.native(target)
      if (target === outputRoot || !isPathWithin(target, [outputRoot]) ||
          !isPathWithin(canonicalTarget, [outputRoot])) {
        this._logComposeEvent('warn', 'session_cleanup_refused', {
          stage: 'cleanup',
          reason: 'outside_output_dir',
        })
        return
      }
      this._rmSyncRecursive(sessionDir)
      this.log.info('Story2VideoCompose', 'Cleaned sessionDir: ' + path.basename(sessionDir))
    } catch (e) {
      this._logComposeEvent('warn', 'session_cleanup_failed', {
        stage: 'cleanup',
        errorCode: typeof e?.code === 'string' ? e.code : null,
        error: safeFfmpegDiagnostic(e?.message),
      })
    }
  }

  /**
   * 递归删除目录（跨平台可靠实现）
   *
   * fs.rmSync({ recursive: true, force: true }) 在部分 Windows 环境静默失败，
   * 此方法手动遍历并删除每个文件再删除目录，确保删除生效。
   *
   * @param {string} dirPath - 要删除的目录
   * @private
   */
  _rmSyncRecursive (dirPath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        this._rmSyncRecursive(fullPath)
      } else {
        fs.unlinkSync(fullPath)
      }
    }
    fs.rmdirSync(dirPath)
  }

  /**
   * 清理历史残留的 sessionDir（超过 maxSessionAgeMs 的 s2v_* 目录）
   * @param {number} [maxAgeMs] - 最大保留时间 ms（默认使用 this.maxSessionAgeMs）
   * @returns {number} 清理的目录数
   * @private
   */
  _cleanupOldSessions (maxAgeMs) {
    const maxAge = maxAgeMs || this.maxSessionAgeMs
    const now = Date.now()
    let cleaned = 0
    try {
      const entries = fs.readdirSync(this.outputDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (!entry.name.startsWith('s2v_')) continue
        const dirPath = path.join(this.outputDir, entry.name)
        try {
          const stat = fs.statSync(dirPath)
          if (now - stat.mtimeMs > maxAge) {
            this._cleanupSession(dirPath)
            if (!fs.existsSync(dirPath)) cleaned++
          }
        } catch (e) {
          // 单个目录清理失败不中断其他清理
          this._logComposeEvent('warn', 'stale_session_cleanup_failed', {
            stage: 'cleanup',
            session: entry.name,
            errorCode: typeof e?.code === 'string' ? e.code : null,
            error: safeFfmpegDiagnostic(e?.message),
          })
        }
      }
      if (cleaned > 0) {
        this._logComposeEvent('info', 'stale_sessions_cleaned', {
          stage: 'cleanup',
          sessionCount: cleaned,
        })
      }
    } catch (e) {
      this._logComposeEvent('warn', 'stale_session_scan_failed', {
        stage: 'cleanup',
        errorCode: typeof e?.code === 'string' ? e.code : null,
        error: safeFfmpegDiagnostic(e?.message),
      })
    }
    return cleaned
  }

  /**
   * 读取媒体真实时长；探测失败时返回 null，由调用方选择保守回退策略。
   * @private
   */
  async _probeMediaDuration (filePath) {
    if (!FFPROBE || !hasUsableFile(filePath)) return null
    try {
      const { stdout } = await execFileAsync(FFPROBE, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ], { timeout: 30000, maxBuffer: 128 * 1024 })
      const duration = Number.parseFloat(String(stdout || '').trim())
      return Number.isFinite(duration) && duration > 0 ? duration : null
    } catch (e) {
      this._logComposeEvent('warn', 'ffprobe_failed', {
        stage: 'preflight',
        operation: 'duration_probe',
        errorCode: typeof e?.code === 'string' ? e.code : null,
        error: safeFfmpegDiagnostic(e?.message),
      })
      return null
    }
  }

  /**
   * 读取视频流时长。停止模式优先使用视频流字段，容器时长不可用时回退到通用探测。
   * @private
   */
  async _probeVideoDuration (filePath) {
    if (!FFPROBE || !hasUsableFile(filePath)) return null
    try {
      const { stdout } = await execFileAsync(FFPROBE, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ], { timeout: 30000, maxBuffer: 128 * 1024 })
      const duration = Number.parseFloat(String(stdout || '').trim())
      if (Number.isFinite(duration) && duration > 0) return duration
    } catch (e) {
      this._logComposeEvent('warn', 'ffprobe_video_stream_failed', {
        stage: 'preflight',
        operation: 'video_duration_probe',
        errorCode: typeof e?.code === 'string' ? e.code : null,
        error: safeFfmpegDiagnostic(e?.message),
      })
    }
    return this._probeMediaDuration(filePath)
  }

  /**
   * 创建单个视频片段（图片 + 音频 + 可选字幕）。
   * 抖动修复默认以 2x 工作分辨率执行 zoompan；编码失败（超时/资源受限）时
   * 逐级降档重试 2x → 1.5x → 1x，全部失败才抛错，避免单段失败拖垮整条流水线。
   * @private
   */
  async _createSegment (imagePath, audioPath, outputPath, opts) {
    const workScales = [2, 1.5, 1]
    let lastError = null
    for (const workScale of workScales) {
      try {
        await this._encodeSegmentOnce(imagePath, audioPath, outputPath, { ...opts, workScale })
        return
      } catch (e) {
        lastError = e
        this._logComposeEvent('warn', 'segment_encode_retry', {
          composeId: opts?.composeId || null,
          stage: 'segments',
          operation: 'image_segment_encode',
          sceneIndex: Number.isInteger(opts?.sceneIndex) ? opts.sceneIndex : null,
          workScale,
          errorCode: typeof e?.code === 'string' ? e.code : null,
          error: safeFfmpegDiagnostic(e?.message),
        })
      }
    }
    throw lastError
  }

  /**
   * 单次片段编码（指定工作分辨率倍率）。失败由 _createSegment 的降档循环处理。
   * @private
   */
  async _encodeSegmentOnce (imagePath, audioPath, outputPath, opts) {
    const args = ['-y']

    // min-duration 静音补齐：目标时长由调用方在“真实探测到音频且补齐目标严格大于音频时长”时计算并传入 padTo。
    // 补齐时以 -t 锁定目标时长 + 音频 apad 静音 + 去掉 -shortest；否则保持 -shortest 跟随旁白。
    // 探测失败时调用方传 padTo=null，这里一律走 follow-audio 路径，绝不 -t/apad 硬截断未知长度旁白（C1）。
    const padTo = Number.isFinite(Number(opts.padTo)) && Number(opts.padTo) > 0
      ? clampNumber(opts.padTo, 0.1, 3600, null)
      : null
    // 动效归一化以“有效时长”（audioDuration||reportedDuration||defaultSceneDuration）为基线，
    // 帧数由 buildImageEffectFilter 内部按 duration*fps 计算（含溢出守卫与 d=总帧数 修复）。
    // 补齐段视频轨是 binding 流（去 -shortest），帧数向上取整避免尾部缺帧（W4）。
    const frameRounding = padTo ? 'ceil' : 'round'
    const imageEffect = buildImageEffectFilter(opts.imageEffect, opts.width, opts.height, opts.fps, opts.effectDuration, frameRounding)

    // 输入：有动效时用单帧图片输入（zoompan 自行生成 d 帧，-loop 1 会破坏帧计数）；
    // 无动效时保持图片循环（配合 fade/shortest 生成静态片段）。
    if (imageEffect) {
      args.push('-i', imagePath, '-i', audioPath)
    } else {
      args.push('-loop', '1', '-i', imagePath, '-i', audioPath)
    }

    // 字幕滤镜
    // 抖动修复（origin/main）：zoompan 亚像素采样会造成画面跳动。先把输入上采样到 2x 工作分辨率，
    // 在 2x 画布上执行 zoompan（s=2x 尺寸），再下采样回目标分辨率，帧间运动平滑。
    const filters = []
    if (imageEffect) {
      // 工作分辨率封顶 3840（computeWorkResolution），避免 4K 输出产生 8K 中间画布
      const work = computeWorkResolution(opts.width, opts.height, opts.workScale)
      filters.push(buildScaleFilter(work.width, work.height))
      filters.push(buildImageEffectFilter(opts.imageEffect, work.width, work.height, opts.fps, opts.effectDuration, frameRounding))
      filters.push(buildScaleFilter(opts.width, opts.height))
    } else {
      filters.push(buildScaleFilter(opts.width, opts.height))
    }
    const subtitleFilter = buildSubtitleFilter(
      Array.isArray(opts.subtitleTimeline) && opts.subtitleTimeline.length > 0
        ? opts.subtitleTimeline
        : opts.subtitleText,
      opts.subtitleStyle,
    )
    if (subtitleFilter) filters.push(subtitleFilter)
    const watermarkFilter = buildWatermarkFilter(opts)
    const watermarkPosition = opts && typeof opts.watermark === 'object' ? opts.watermark.position : opts?.watermarkConfig?.position
    // moving 水印仅多镜头（sceneTotal>1）后置到成片合并后统一烧录（成片时间轴跨镜头连续漂移），片段内不内嵌；
    // 静态位置与单镜头 moving 保持片段内内嵌（单镜头 t 成片=片段，连续无跳变、零额外编码）。
    const watermarkPostpone = watermarkPosition === 'moving' && Number(opts.sceneTotal) > 1
    if (watermarkFilter && !watermarkPostpone) filters.push(watermarkFilter)

    // 单片段淡入；滑动转场由 concat 阶段的 xfade 处理。
    if (opts.transition === 'fade') {
      filters.push('fade=t=in:st=0:d=0.5')
    }

    if (filters.length > 0) {
      args.push('-vf', filters.join(','))
    }

    // 时长
    if (padTo) {
      args.push('-t', String(padTo))
    } else if (opts.duration && Number(opts.duration) > 0) {
      args.push('-t', String(clampNumber(opts.duration, 0.1, 3600, 3)))
    }

    const voiceVolume = clampNumber(opts.voiceVolume, 0, 2, 1)
    if (padTo) {
      args.push('-af', (voiceVolume !== 1 ? 'volume=' + voiceVolume.toFixed(3) + ',' : '') + 'apad')
    } else if (voiceVolume !== 1) {
      args.push('-af', 'volume=' + voiceVolume.toFixed(3))
    }

    // 编码
    args.push('-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p')
    args.push('-c:a', 'aac', '-b:a', '128k')
    if (padTo) {
      args.push('-r', String(clampNumber(opts.fps, 1, 120, 30)))
    } else {
      args.push('-shortest', '-r', String(clampNumber(opts.fps, 1, 120, 30)))
    }

    // 输出
    args.push(outputPath)

    // 编码超时按时长、帧率和工作倍率估算，避免 zoompan 慢速编码被过短预算误杀。
    const encodeTimeout = computeSegmentEncodeTimeoutMs(opts.effectDuration, opts.fps, opts.workScale)
    const { stderr } = await this._runFfmpegStage(args, { timeout: encodeTimeout, maxBuffer: 1024 * 1024 }, {
      composeId: opts.composeId,
      stage: 'segments',
      operation: 'image_segment_encode',
      inputCount: 2,
      estimatedDuration: opts.effectDuration,
      outputPath,
      heartbeat: true,
      meta: { sceneIndex: opts.sceneIndex, workScale: opts.workScale },
    })
    this._requireFfmpegOutput(outputPath, {
      composeId: opts.composeId,
      stage: 'segments',
      operation: 'image_segment_encode',
      meta: { sceneIndex: opts.sceneIndex, workScale: opts.workScale },
      message: 'ffmpeg did not produce output: ' + safeFfmpegDiagnostic(stderr),
    }, stderr)
  }

  /**
   * AI 视频场景片段：以预生成的 AI 视频为画面基底，归一化分辨率/帧率、按片段有效时长裁剪，
   * 叠加字幕/水印并混入 TTS 旁白。失败降档重试语义与图片片段一致。
   * @private
   */
  async _createVideoSegment (videoPath, audioPath, outputPath, opts) {
    // 视频片段无需 zoompan 超采样：直接按目标分辨率编码（不做 2x 工作分辨率，避免无谓的重编码成本，2026-08-11 W9）。
    await this._encodeVideoSegmentOnce(videoPath, audioPath, outputPath, { ...opts, workScale: 1 })
  }

  /**
   * 单次 AI 视频片段编码（指定工作分辨率倍率）。失败由 _createVideoSegment 的降档循环处理。
   * @private
   */
  async _encodeVideoSegmentOnce (videoPath, audioPath, outputPath, opts) {
    const args = ['-y']

    const padTo = Number.isFinite(Number(opts.padTo)) && Number(opts.padTo) > 0
      ? clampNumber(opts.padTo, 0.1, 3600, null)
      : null

    const fps = clampNumber(opts.fps, 1, 120, 30)
    const targetDuration = [opts.effectDuration, opts.duration, opts.audioDuration]
      .map(value => Number(value))
      .find(value => Number.isFinite(value) && value > 0) || null
    const aiVideoMode = opts.videoMode === 'fixed' || opts.videoMode === 'ai-judged'
    const stopAtEndRequested = opts.shortVideoHandling === 'stop-at-end' && aiVideoMode
    const sourceVideoDuration = stopAtEndRequested
      ? await this._probeVideoDuration(videoPath)
      : null
    const singlePassVideo = stopAtEndRequested && Number.isFinite(sourceVideoDuration) && sourceVideoDuration > 0
    const shortVideoTailDuration = sourceVideoDuration && targetDuration && sourceVideoDuration < targetDuration
      ? targetDuration - sourceVideoDuration
      : null
    const stopAtEnd = Number.isFinite(shortVideoTailDuration) && shortVideoTailDuration > 0

    // 默认循环保持历史行为；只有显式 stop-at-end、AI 视频模式且探测到短片段时才去掉循环。
    // 探测失败按循环回退，避免旧 provider 的非标准媒体导致成片提前结束。
    args.push('-fflags', '+genpts')
    if (!singlePassVideo) args.push('-stream_loop', '-1')
    args.push('-i', videoPath, '-i', audioPath)

    // 视频滤镜：归一化分辨率（等比缩放 + 黑边补齐，保留完整画面）、帧率，再叠加字幕/水印
    const work = computeWorkResolution(opts.width, opts.height, opts.workScale)
    const filters = []
    filters.push('scale=' + work.width + ':' + work.height + ':force_original_aspect_ratio=decrease')
    filters.push('pad=' + work.width + ':' + work.height + ':(ow-iw)/2:(oh-ih)/2:color=black')
    filters.push('fps=' + fps)
    filters.push(buildScaleFilter(opts.width, opts.height))
    const subtitleFilter = buildSubtitleFilter(
      Array.isArray(opts.subtitleTimeline) && opts.subtitleTimeline.length > 0
        ? opts.subtitleTimeline
        : opts.subtitleText,
      opts.subtitleStyle,
    )
    if (subtitleFilter) filters.push(subtitleFilter)
    const watermarkFilter = buildWatermarkFilter(opts)
    const watermarkPosition = opts && typeof opts.watermark === 'object' ? opts.watermark.position : opts?.watermarkConfig?.position
    // moving 水印仅多镜头（sceneTotal>1）后置到成片合并后统一烧录（成片时间轴跨镜头连续漂移），片段内不内嵌；
    // 静态位置与单镜头 moving 保持片段内内嵌（单镜头 t 成片=片段，连续无跳变、零额外编码）。
    const watermarkPostpone = watermarkPosition === 'moving' && Number(opts.sceneTotal) > 1
    if (watermarkFilter && !watermarkPostpone) filters.push(watermarkFilter)
    // 单片段淡入；滑动转场由 concat 阶段的 xfade 处理
    if (opts.transition === 'fade') {
      filters.push('fade=t=in:st=0:d=0.5')
    }
    if (stopAtEnd) {
      const tailDuration = Number(shortVideoTailDuration.toFixed(6))
      const tailStart = Math.max(0, sourceVideoDuration - (1 / fps))
      const tailZoom = buildImageEffectFilter('zoom-in', opts.width, opts.height, fps, tailDuration, 'ceil')
      const commonFilters = filters.slice(0, 4)
      const overlayFilters = filters.slice(4)
      const tailGraph = [
        '[0:v]' + commonFilters.join(',') + ',split=2[videoBodySrc][videoTailSrc]',
        '[videoBodySrc]trim=duration=' + sourceVideoDuration.toFixed(6) + ',setpts=PTS-STARTPTS[videoBody]',
        '[videoTailSrc]trim=start=' + tailStart.toFixed(6) + ':duration=' + (1 / fps).toFixed(6) +
          ',select=eq(n\\,0),setpts=PTS-STARTPTS,' + tailZoom + '[videoTail]',
        '[videoBody][videoTail]concat=n=2:v=1:a=0,setpts=PTS-STARTPTS' +
          (overlayFilters.length > 0 ? ',' + overlayFilters.join(',') : '') + '[videoOut]',
      ].join(';')
      args.push('-filter_complex', tailGraph, '-map', '[videoOut]')
    } else {
      args.push('-vf', filters.join(','), '-map', '0:v:0')
    }

    // 时长：与图片片段同一语义（follow-audio 跟随旁白 / min-duration 静音补齐）
    if (padTo) {
      args.push('-t', String(padTo))
    } else if (stopAtEnd && targetDuration) {
      args.push('-t', String(targetDuration))
    } else if (opts.duration && Number(opts.duration) > 0) {
      args.push('-t', String(clampNumber(opts.duration, 0.1, 3600, 3)))
    }

    const voiceVolume = clampNumber(opts.voiceVolume, 0, 2, 1)
    if (padTo) {
      args.push('-af', (voiceVolume !== 1 ? 'volume=' + voiceVolume.toFixed(3) + ',' : '') + 'apad')
    } else if (voiceVolume !== 1) {
      args.push('-af', 'volume=' + voiceVolume.toFixed(3))
    }

    // 旁白音频合同（2026-08-11 W10）：显式映射 TTS 旁白为片段音频。
    // ffmpeg 无 -map 时默认只挑一条音频流，实测会选中 AI 视频自带音频而丢弃 TTS 解说
    // （440Hz 视频音频 vs 880Hz TTS 合成测试中输出为 440Hz）。这里强制
    // video ← 输入0 的 AI 视频、audio ← 输入1 的 TTS 旁白；AI 视频自带音频不保留
    // （如需环境音混合另行开放，避免音量/时长契约漂移）。
    args.push('-map', '1:a:0')

    // 编码：视频输入不适用 stillimage tune
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p')
    args.push('-c:a', 'aac', '-b:a', '128k')
    if (padTo) {
      args.push('-r', String(fps))
    } else {
      args.push('-shortest', '-r', String(fps))
    }
    args.push(outputPath)

    const encodeTimeout = computeSegmentEncodeTimeoutMs(opts.effectDuration, opts.fps)
    const { stderr } = await this._runFfmpegStage(args, { timeout: encodeTimeout, maxBuffer: 1024 * 1024 }, {
      composeId: opts.composeId,
      stage: 'segments',
      operation: 'video_segment_encode',
      inputCount: 2,
      estimatedDuration: opts.effectDuration,
      outputPath,
      heartbeat: true,
      meta: { sceneIndex: opts.sceneIndex },
    })
    this._requireFfmpegOutput(outputPath, {
      composeId: opts.composeId,
      stage: 'segments',
      operation: 'video_segment_encode',
      meta: { sceneIndex: opts.sceneIndex },
      message: 'ffmpeg did not produce output: ' + safeFfmpegDiagnostic(stderr),
    }, stderr)
  }

  /**
   * 拼接视频片段（分段合成，避免超长流水线单命令输入过多）。
   * @private
   */
  async _concatSegments (segments, outputPath, sessionDir, options) {
    const transition = options?.transition || 'none'
    const transitionName = TRANSITION_NAMES[transition]
    if (transitionName && segments.length > 1) {
      const durations = Array.isArray(options?.segmentDurations) ? options.segmentDurations : []
      const plan = buildTransitionPlan(durations, options?.transitionDuration, transitionName)
      if (plan.enabled) {
        if (segments.length > MAX_XFADE_INPUTS) {
          await this._concatSegmentsChunked(segments, durations, outputPath, sessionDir, {
            transitionName,
            transitionDuration: options?.transitionDuration,
            onChunkCreated: options?.onChunkCreated,
            composeId: options?.composeId,
          }, 0)
        } else {
          await this._xfadeMerge(segments, plan, outputPath, {
            composeId: options?.composeId,
            stage: 'concat',
          })
        }
        return
      }
      this.log.warn('Story2VideoCompose', 'Segment durations are too short or unknown; falling back to concat without transition')
    }
    const durations = Array.isArray(options?.segmentDurations) ? options.segmentDurations : []
    const plainConcatObservability = options?.composeId
      ? { composeId: options.composeId, stage: 'concat' }
      : undefined
    if (plainConcatObservability) await this._plainConcat(segments, outputPath, sessionDir, durations, plainConcatObservability)
    else await this._plainConcat(segments, outputPath, sessionDir, durations)
  }

  /**
   * 单条 ffmpeg 命令：对一组片段构建 xfade/acrossfade 图并输出。
   * @private
   */
  async _xfadeMerge (segments, plan, outputPath, observability = {}) {
    const transitionName = plan.transitionName
    const inputArgs = []
    for (const segment of segments) inputArgs.push('-i', segment)

    const filterParts = []
    let currentVideo = '[0:v]'
    for (let index = 1; index < segments.length; index++) {
      const transitionStep = plan.transitions[index - 1]
      const nextVideo = '[v' + index + ']'
      filterParts.push(currentVideo + '[' + index + ':v]xfade=transition=' + transitionName +
        ':duration=' + transitionStep.duration.toFixed(3) + ':offset=' + transitionStep.offset.toFixed(3) + nextVideo)
      currentVideo = nextVideo
    }

    let currentAudio = '[0:a]'
    for (let index = 1; index < segments.length; index++) {
      const transitionStep = plan.transitions[index - 1]
      const nextAudio = '[a' + index + ']'
      filterParts.push(currentAudio + '[' + index + ':a]acrossfade=d=' +
        transitionStep.duration.toFixed(3) + ':c1=tri:c2=tri' + nextAudio)
      currentAudio = nextAudio
    }
    filterParts.push(currentAudio + 'anull[aout]')
    const args = ['-y', ...inputArgs, '-filter_complex', filterParts.join(';'),
      '-map', currentVideo, '-map', '[aout]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', outputPath]
    // 超时随输出时长动态计算（长视频全量重编码，2026-08-11 真实 bug 修复）
    const mergeTimeout = computeMergeEncodeTimeoutMs(plan.totalDuration)
    const { stderr } = await this._runFfmpegStage(args, { timeout: mergeTimeout, maxBuffer: 2 * 1024 * 1024 }, {
      composeId: observability.composeId,
      stage: observability.stage || 'concat',
      operation: 'xfade_merge',
      inputCount: segments.length,
      estimatedDuration: plan.totalDuration,
      outputPath,
      heartbeat: true,
      meta: observability.meta,
      onHeartbeat: observability.onHeartbeat,
    })
    this._requireFfmpegOutput(outputPath, {
      composeId: observability.composeId,
      stage: observability.stage || 'concat',
      operation: 'xfade_merge',
      meta: observability.meta,
      message: 'ffmpeg xfade did not produce output: ' + safeFfmpegDiagnostic(stderr),
    }, stderr)
  }

  /** 使用 concat demuxer 无损拼接（无转场）。@private */
  async _plainConcat (segments, outputPath, sessionDir, segmentDurations, observability = {}) {
    const listFile = path.join(sessionDir, 'concat_list.txt')
    const listContent = segments.map(s => "file '" + s.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n')
    fs.writeFileSync(listFile, listContent, 'utf-8')

    const args = [
      '-y', '-f', 'concat', '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      outputPath,
    ]

    const durations = Array.isArray(segmentDurations) ? segmentDurations : []
    const totalDuration = durations.length === segments.length && durations.every(value => Number.isFinite(Number(value)) && Number(value) > 0)
      ? durations.reduce((sum, value) => sum + Number(value), 0)
      : null
    const concatTimeout = computeFfmpegStageTimeoutMs('concat', totalDuration)
    const { stderr } = await this._runFfmpegStage(args, { timeout: concatTimeout, maxBuffer: 1024 * 1024 }, {
      composeId: observability.composeId,
      stage: observability.stage || 'concat',
      operation: 'plain_concat',
      inputCount: segments.length,
      estimatedDuration: totalDuration,
      outputPath,
      heartbeat: true,
      meta: observability.meta,
      onHeartbeat: observability.onHeartbeat,
    })
    this._requireFfmpegOutput(outputPath, {
      composeId: observability.composeId,
      stage: observability.stage || 'concat',
      operation: 'plain_concat',
      meta: observability.meta,
      message: 'ffmpeg concat did not produce output: ' + safeFfmpegDiagnostic(stderr),
    }, stderr)
  }

  /**
   * 分块合成：把超长片段列表切成 ≤ MAX_XFADE_INPUTS 的块，块内 xfade 合成中间文件，
   * 再递归合并中间文件（块间同样带转场）。避免单条 ffmpeg 命令输入路数过多。
   * @private
   */
  async _concatSegmentsChunked (segments, durations, outputPath, sessionDir, options, level, progressState) {
    const chunkSize = MAX_XFADE_INPUTS
    const currentLevel = Number.isInteger(level) ? level : 0
    const onChunkCreated = typeof options?.onChunkCreated === 'function' ? options.onChunkCreated : null
    // 递归全程共享同一进度分母（总块数 = 各级块数之和，见 countChunkedMergeChunks 的同步约束），done 跨层级单调累加
    const state = progressState || { total: countChunkedMergeChunks(segments.length, chunkSize), done: 0 }
    const intermediatePaths = []
    const chunkDurations = []
    for (let offset = 0; offset < segments.length; offset += chunkSize) {
      const part = segments.slice(offset, offset + chunkSize)
      const partDurations = Array.isArray(durations) ? durations.slice(offset, offset + chunkSize) : []
      const plan = buildTransitionPlan(partDurations, options?.transitionDuration)
      const chunkIndex = intermediatePaths.length
      // 中间文件名带递归层级，避免与输入（上一层的中间文件）同名冲突
      const intermediate = path.join(sessionDir, 'merge_l' + currentLevel + '_chunk_' + String(chunkIndex).padStart(3, '0') + '.mp4')
      const chunkMeta = {
        composeId: options?.composeId || null,
        stage: 'concat',
        level: currentLevel,
        chunkIndex,
        totalChunks: state.total,
        inputCount: part.length,
        output: path.basename(intermediate),
      }
      const chunkStartedAt = Date.now()
      this._logComposeEvent('info', 'merge_chunk_started', chunkMeta)
      try {
        if (part.length > 1 && plan.enabled) {
          await this._xfadeMerge(part, { ...plan, transitionName: options.transitionName }, intermediate, {
            composeId: options?.composeId,
            stage: 'concat',
            meta: { level: currentLevel, chunkIndex, totalChunks: state.total },
            onHeartbeat: (heartbeat) => this._logComposeEvent(heartbeat.stalled ? 'warn' : 'info', 'merge_chunk_heartbeat', {
              ...chunkMeta,
              ...heartbeat,
            }),
          })
          chunkDurations.push(plan.totalDuration)
        } else {
          // 块内无法使用转场（时长未知/过短）→ 无损拼接该块
          await this._plainConcat(part, intermediate, sessionDir, partDurations, {
            composeId: options?.composeId,
            stage: 'concat',
            meta: { level: currentLevel, chunkIndex, totalChunks: state.total },
            onHeartbeat: (heartbeat) => this._logComposeEvent(heartbeat.stalled ? 'warn' : 'info', 'merge_chunk_heartbeat', {
              ...chunkMeta,
              ...heartbeat,
            }),
          })
          const partDuration = partDurations.length === part.length && partDurations.every(value => Number.isFinite(Number(value)) && Number(value) > 0)
            ? partDurations.reduce((sum, value) => sum + Number(value), 0)
            : null
          chunkDurations.push(partDuration)
        }
      } catch (error) {
        this._logComposeEvent('error', 'merge_chunk_failed', {
          ...chunkMeta,
          elapsedMs: Date.now() - chunkStartedAt,
          outputBytes: outputFileBytes(intermediate),
          errorCode: typeof error?.code === 'string' ? error.code : null,
          error: safeFfmpegDiagnostic(error?.message),
        })
        throw error
      }
      intermediatePaths.push(intermediate)
      // 每完成一块立即上报（87→89 之间按块推进），消除长列表拼接期"假卡死"
      state.done += 1
      this._logComposeEvent('info', 'merge_chunk_succeeded', {
        ...chunkMeta,
        elapsedMs: Date.now() - chunkStartedAt,
        outputBytes: outputFileBytes(intermediate),
      })
      this.log.info(COMPOSE_LOG_MODULE, 'merge_l' + currentLevel + '_chunk_' + String(chunkIndex).padStart(3, '0') + ' created: ' + path.basename(intermediate), {
        event: 'merge_chunk_created',
        composeId: options?.composeId || null,
        level: currentLevel,
        chunkIndex,
      })
      if (onChunkCreated) {
        onChunkCreated({
          level: currentLevel,
          chunkIndex,
          done: state.done,
          total: state.total,
          path: intermediate,
        })
      }
    }

    if (intermediatePaths.length === 1) {
      fs.copyFileSync(intermediatePaths[0], outputPath)
      return
    }
    await this._concatSegmentsChunked(intermediatePaths, chunkDurations, outputPath, sessionDir, options, currentLevel + 1, state)
  }

  /** 将所有旁白解码后顺序拼接，避免旧实现只保留第一段音频。 */
  async _concatNarrationAudio (audioPaths, outputPath, _sessionDir, voiceVolume, estimatedDuration, observability = {}) {
    if (!Array.isArray(audioPaths) || audioPaths.length === 0) throw new Error('No narration audio')
    const inputs = []
    const labels = []
    for (let index = 0; index < audioPaths.length; index++) {
      inputs.push('-i', audioPaths[index])
      labels.push('[' + index + ':a]')
    }
    const normalizedVolume = clampNumber(voiceVolume, 0, 2, 1)
    const filter = labels.join('') + 'concat=n=' + audioPaths.length + ':v=0:a=1[concat]' +
      (normalizedVolume === 1 ? ';[concat]anull[aout]' : ';[concat]volume=' + normalizedVolume.toFixed(3) + '[aout]')
    const { stderr } = await this._runFfmpegStage([
      '-y', ...inputs,
      '-filter_complex', filter,
      '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k',
      outputPath,
    ], { timeout: computeFfmpegStageTimeoutMs('narration', estimatedDuration), maxBuffer: 2 * 1024 * 1024 }, {
      composeId: observability.composeId,
      stage: observability.stage || 'narration',
      operation: 'narration_concat',
      inputCount: audioPaths.length,
      estimatedDuration,
      outputPath,
      heartbeat: true,
    })
    this._requireFfmpegOutput(outputPath, {
      composeId: observability.composeId,
      stage: observability.stage || 'narration',
      operation: 'narration_concat',
      message: safeFfmpegDiagnostic(stderr) || 'ffmpeg did not produce narration audio',
    }, stderr)
  }

  /**
   * 将 moving 水印统一烧录到合并成片（跨镜头连续漂移）。
   * - 输入为 xfade 合并后的整片：drawtext 的 t 是成片时间轴，漂移跨镜头连续，
   *   且 sin(0)=0 保证 t=0 起点位于画面中心（(w-text_w)/2, (h-text_h)/2）。
   * - 表达式与 buildWatermarkFilter moving 分支保持一致（x 周期 100s / y 周期 140s，
   *   90% 中心幅度）；禁止在滤镜内用逗号（会切分滤镜链），滤镜一旦构造失败
   *   由 _runFfmpegStage 抛出并 fail-closed。
   * - 视频轨全量重编码（libx264 crf 18 保持质量），音频轨 -c:a copy 不重编码。
   */
  async _burnMovingWatermark (videoPath, outputPath, config, watermarkText, estimatedDuration, observability = {}) {
    // 单一来源：滤镜串与片段内嵌路径完全一致（buildWatermarkFilter 统一处理字体/转义/透明度/字号/色名/位置表达式）
    const filter = buildWatermarkFilter({ watermark: config, watermarkText })
    if (!filter) throw new Error('watermark burn requires a non-empty watermark filter')
    const { stderr } = await this._runFfmpegStage([
      '-y', '-i', videoPath,
      '-vf', filter,
      '-map', '0:v:0',
      // 显式 -map 会丢弃未映射流：必须同时可选映射音频（0:a:0?），否则 -c:a copy 成空操作
      // （冒烟实测缺此行时水印输出丢失全部音频流，2026-08-27）
      '-map', '0:a:0?',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      // crf 18：相对片段母版（libx264 默认 crf 23）的二次再编码档位，近无损档
      '-crf', '18',
      '-c:a', 'copy',
      outputPath,
    ], { timeout: computeFfmpegStageTimeoutMs('watermark', estimatedDuration), maxBuffer: 2 * 1024 * 1024 }, {
      composeId: observability.composeId,
      stage: observability.stage || 'watermark',
      operation: 'watermark_burn',
      inputCount: 1,
      estimatedDuration,
      outputPath,
      heartbeat: true,
    })
    this._requireFfmpegOutput(outputPath, {
      composeId: observability.composeId,
      stage: observability.stage || 'watermark',
      operation: 'watermark_burn',
      message: safeFfmpegDiagnostic(stderr) || 'ffmpeg did not produce watermarked output',
    }, stderr)
  }

  /** 将 BGM 按指定音量混入成片，BGM 不足时循环到视频结束。 */
  async _mixBgm (videoPath, bgmPath, outputPath, volume, estimatedDuration, observability = {}) {
    let level = Number(volume)
    if (level > 1) level /= 10
    level = clampNumber(level, 0, 1, 0.3)
    const filter = '[1:a]volume=' + level.toFixed(3) + '[bgm];' +
      '[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]'
    const { stderr } = await this._runFfmpegStage([
      '-y', '-i', videoPath, '-stream_loop', '-1', '-i', bgmPath,
      '-filter_complex', filter,
      '-map', '0:v:0', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-shortest', outputPath,
    ], { timeout: computeFfmpegStageTimeoutMs('bgm', estimatedDuration), maxBuffer: 2 * 1024 * 1024 }, {
      composeId: observability.composeId,
      stage: observability.stage || 'bgm',
      operation: 'bgm_mix',
      inputCount: 2,
      estimatedDuration,
      outputPath,
      heartbeat: true,
    })
    this._requireFfmpegOutput(outputPath, {
      composeId: observability.composeId,
      stage: observability.stage || 'bgm',
      operation: 'bgm_mix',
      message: safeFfmpegDiagnostic(stderr) || 'ffmpeg did not produce mixed output',
    }, stderr)
  }

  /** 将最终 MP4 中间产物转码为 WebM，保持 UI format 选项与输出一致。 */
  async _transcodeWebm (inputPath, outputPath, estimatedDuration, observability = {}) {
    const { stderr } = await this._runFfmpegStage([
      '-y', '-i', inputPath,
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0',
      '-c:a', 'libopus', '-b:a', '128k',
      outputPath,
    ], { timeout: computeFfmpegStageTimeoutMs('webm', estimatedDuration), maxBuffer: 2 * 1024 * 1024 }, {
      composeId: observability.composeId,
      stage: observability.stage || 'webm',
      operation: 'webm_transcode',
      inputCount: 1,
      estimatedDuration,
      outputPath,
      heartbeat: true,
    })
    this._requireFfmpegOutput(outputPath, {
      composeId: observability.composeId,
      stage: observability.stage || 'webm',
      operation: 'webm_transcode',
      message: safeFfmpegDiagnostic(stderr) || 'ffmpeg did not produce WebM output',
    }, stderr)
  }

  /** 用 ffmpeg 解码检查输出是否为可播放视频。 */
  async _validateOutput (filePath, estimatedDuration, observability = {}) {
    if (!hasUsableFile(filePath)) throw new Error('file is missing or empty')
    const { stderr } = await this._runFfmpegStage([
      '-v', 'error', '-i', filePath, '-map', '0:v:0', '-f', 'null', '-',
    ], { timeout: computeFfmpegStageTimeoutMs('validate', estimatedDuration), maxBuffer: 512 * 1024 }, {
      composeId: observability.composeId,
      stage: observability.stage || 'verify',
      operation: 'output_validation',
      inputCount: 1,
      estimatedDuration,
      outputPath: null,
    })
    if (stderr && stderr.trim()) throw new Error(stderr.trim().slice(-400))
  }
}

module.exports = {
  Story2VideoComposeEngine,
  findFfmpeg,
  findFfprobe,
  KNOWN_COMPOSE_PHASES,
  normalizeComposeProgressUpdate,
  countChunkedMergeChunks,
  escapeSubtitleText,
  normalizeComposeScenes,
  buildTransitionPlan,
  buildImageEffectFilter,
  buildSubtitleFilter,
  buildWatermarkFilter,
  buildScaleFilter,
  computeFfmpegStageTimeoutMs,
  isFfmpegStageTimeoutError,
  normalizeFfmpegStageError,
  computeSegmentEncodeTimeoutMs,
  computeMergeEncodeTimeoutMs,
  resolveMaxOutputDimensions,
  validateResolutionCapability,
  computeWorkResolution,
  parseResolution,
  resolveCjkFont,
  escapeFontFilePath,
}
