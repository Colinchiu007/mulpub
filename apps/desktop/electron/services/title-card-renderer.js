// @ts-check
/**
 * title-card-renderer.js — 文字标题卡渲染（确定性出图，无外部服务）
 *
 * 能力：**给定文字 → 出一张符合画幅的标题卡 PNG**。不调用任何 AI 服务，
 * 同一个输入永远得到同一张图（可复现、可回归、可当素材兜底）。
 *
 * 为什么要有它（2026-10-24 实测）：
 *   ① 流水线的素材出图默认走 AI 生图（要 Key、要钱、要网络），一旦 provider 不可用，
 *      现有兜底是 `asset-generator.js` 里内联的 ffmpeg drawtext 占位图 ——
 *      **单色背景 + 30 个字居中**，且**没有标题安全区**：合成阶段默认的 `zoom-in`
 *      动效会把画面从 1.0 放大到 1.25 倍并居中裁切（左右各裁 10%），
 *      于是占位图的边缘文字会被**无声地切掉**（实测：「好消息是」被裁成「消息是」，
 *      成片不报错、不降级、只是少字）。
 *   ② 「用文字做一张卡」是跨流水线通用需求（讲解视频的标题卡、字幕卡、封面卡、
 *      章节卡、演示里的要点卡…），每个流水线各写一份 ffmpeg 参数只会各错各的。
 *
 * 关键设计（每条都有判据，不是口味）：
 *   · **标题安全区**：`safeMarginRatio` 默认 0.13 —— 合成默认动效 zoom-in 的 1.25 倍
 *     居中裁切吃掉左右各 10%，13% 留 3% 余量。见 `SAFE_MARGIN_RATIO`。
 *   · **CJK 感知折行**：全角按 1em、半角按 0.55em 估宽，按**像素预算**折行
 *     （不是按字数）—— 中英混排时按字数折行会排歪。
 *   · **逐行渲染**：每行一个 drawtext，而不是把 `\n` 塞进 text=
 *     ⇒ 不用和 ffmpeg 的换行转义打架，行距也可控。
 *   · **字体走 font-resolver**：不自己找字体。仓库已解决「ffmpeg 的 fontfile=
 *     路径含非 ASCII 会静默出豆腐块」（实测 PNG 5495 → 765 字节、rc=0）。
 *   · **渐变降级**：优先 `gradients` 滤镜（ffmpeg ≥ 4.4），失败自动回退纯色
 *     —— 用户机器上的 ffmpeg 版本不可控，不能因为「要好看」而让出图整条失败。
 *
 * 用法：
 *   const { renderTitleCard } = require('./title-card-renderer')
 *   const card = await renderTitleCard({ title: '一句话标题', subtitle: '补充说明', outputPath: '/tmp/card.png' })
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFile, execFileSync } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const { findFfmpeg } = require('./media-tool-paths')
const { buildDrawtextFontOption } = require('./font-resolver')

/**
 * 标题安全区边距（占画幅宽度的比例）。
 *
 * 合成引擎默认动效 `zoom-in` 的实现是 `1+0.25*progress` 的**居中**缩放
 * （story2video-compose-engine.js 的 buildImageEffectFilter）⇒ 画面放大到 1.25 倍时
 * 左右各被裁掉 (1 - 1/1.25)/2 = **10%**。10% 是临界值（正好等于裁切量），
 * 取 13% 留 3% 余量，避免「刚好在边上的字」被切掉。
 */
const SAFE_MARGIN_RATIO = 0.13

/** 画幅下限（再小排版就没意义了，且 ffmpeg 滤镜会退化） */
const MIN_WIDTH = 320
const MIN_HEIGHT = 240

/**
 * 主题表。每个主题给出「背景渐变起止色 + 强调色 + 正文色」。
 *
 * 键名沿用 `asset-generator.js` 既有的 styleColors 键（cinematic/realistic/cartoon/
 * anime/cyberpunk/watercolor/minimalist）—— 那是流水线的 `imageStyle` 取值域，
 * 换名字会让调用方多记一张映射表。
 */
const THEMES = Object.freeze({
  cinematic: { c0: '0x08101F', c1: '0x16324F', accent: '0x4FC3F7', body: '0xD8DEE9' },
  realistic: { c0: '0x0B1A12', c1: '0x17402A', accent: '0x66BB6A', body: '0xD6E4DA' },
  cartoon: { c0: '0x0E2A47', c1: '0x4A90D9', accent: '0xFFD54F', body: '0xF2F7FD' },
  anime: { c0: '0x1A0A1E', c1: '0x4A1454', accent: '0xEF5350', body: '0xF6E7F6' },
  cyberpunk: { c0: '0x140B1E', c1: '0x3A1B54', accent: '0xCE93D8', body: '0xEDE3F3' },
  watercolor: { c0: '0x12232A', c1: '0x2F5A63', accent: '0x8FD3C7', body: '0xE4F2F2' },
  minimalist: { c0: '0xF0EEE8', c1: '0xDCD8CE', accent: '0x4A4A4A', body: '0x2A2A2A' },
})

const DEFAULT_THEME = 'cinematic'

/** 估算字符宽度（相对 em）：全角 1，半角 0.55，空格 0.35 */
function charWidth (ch) {
  const code = ch.codePointAt(0)
  if (code > 0x2e80) return 1
  if (ch === ' ') return 0.35
  return 0.55
}

/**
 * 按像素预算折行（CJK 感知）。
 * @param {string} text
 * @param {number} maxUnits 宽度预算（单位=em）
 * @returns {string[]}
 */
function wrapText (text, maxUnits) {
  const source = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (!source) return []
  const budget = Number.isFinite(maxUnits) && maxUnits > 0 ? maxUnits : 12
  const lines = []
  let current = ''
  let width = 0
  for (const ch of source) {
    const w = charWidth(ch)
    if (width + w > budget && current) {
      lines.push(current)
      current = ''
      width = 0
    }
    current += ch
    width += w
  }
  if (current) lines.push(current)
  return lines
}

/**
 * ffmpeg `drawtext` 的 text= 转义。
 *
 * 为什么放在这里而不是 asset-generator.js：渲染器与它**互相依赖**会造成循环
 * （asset-generator 要调本模块渲染占位图，本模块又要用转义函数）——
 * CommonJS 循环 require 下有一边拿到未完成的 exports，转义函数会是 undefined。
 * 转义是「渲染 drawtext 文本」这件事的固有部分，归属本模块最自然。
 *
 * 转义面：\ 与 ' 是 ffmpeg 滤镜语法里的定界符；: , 分隔 filter 参数；
 * % 触发 expansion；{ } 参与 expansion 表达式。
 *
 * ⛔ **单引号必须写成 `'\''`（闭合-转义-重开），不能写成 `\'`**（2026-10-24 实测）：
 *   ffmpeg 的 filtergraph 引号规则是「单引号内一切都是字面量（含反斜杠），
 *   想在引号内表示字面单引号，只能闭合引号 → 转义的单引号 → 重开引号」。
 *   旧写法 `\'` 在 `text='...'` 里会把引号**提前闭合**，后面的文本被当成
 *   **filter 参数**解析 —— 表现是两种：
 *     · 文本里带 `{word}` ⇒ `Option 'w' not found` ⇒ 渲染直接失败；
 *     · 文本里没有大括号 ⇒ **rc=0、不报错，但产出空白图**（实测 630 字节 vs 正常 3210 字节）。
 *   后者是**静默失败**：英文提示词里的 `'s`、引号极常见 ⇒ 素材占位图会变成空白图，
 *   而流水线一路绿灯。旧实现的这条转义从未被带引号的文案测过。
 */
function escapeDrawtextText (text) {
  return String(text || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    // 闭合-转义-重开：见上方注释
    .replace(/'/g, "'\\''")
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
}

/**
 * 构造一条 drawtext 滤镜。
 *
 * 注意 `buildDrawtextFontOption()` 返回的片段**自带前导冒号**（形如
 * `:fontfile='/x/y.otf'`），直接 join(':') 会拼出 `::` 让 ffmpeg 报
 * "Both text and text file provided"（实测踩过）。故这里按固定顺序拼接。
 */
function drawTextFilter (options) {
  let filter = "drawtext=text='" + escapeDrawtextText(options.text) + "'" + buildDrawtextFontOption()
  filter += ':fontcolor=' + options.color
  filter += ':fontsize=' + options.size
  filter += ':x=' + options.x
  filter += ':y=' + options.y
  if (options.alpha !== undefined) filter += ':alpha=' + options.alpha
  return filter
}

/**
 * 归一化并校验入参。
 * @param {object} options
 * @returns {{ title: string, subtitle: string, label: string, counter: string, width: number, height: number, theme: string, safeMarginRatio: number, titleMaxLines: number, subtitleMaxLines: number, progress: number|null, outputPath: string }}
 */
function normalizeOptions (options) {
  const input = options && typeof options === 'object' ? options : {}
  const width = Math.max(MIN_WIDTH, Math.round(Number(input.width) || 1280))
  const height = Math.max(MIN_HEIGHT, Math.round(Number(input.height) || 720))
  const themeKey = typeof input.theme === 'string' && THEMES[input.theme] ? input.theme : DEFAULT_THEME
  const marginRatio = Number.isFinite(Number(input.safeMarginRatio))
    ? Math.max(0, Math.min(0.4, Number(input.safeMarginRatio)))
    : SAFE_MARGIN_RATIO
  const progressRaw = Number(input.progress)
  return {
    title: String(input.title == null ? '' : input.title),
    subtitle: String(input.subtitle == null ? '' : input.subtitle),
    label: String(input.label == null ? '' : input.label),
    counter: String(input.counter == null ? '' : input.counter),
    width,
    height,
    theme: themeKey,
    safeMarginRatio: marginRatio,
    titleMaxLines: Math.max(1, Math.round(Number(input.titleMaxLines) || 3)),
    subtitleMaxLines: Math.max(1, Math.round(Number(input.subtitleMaxLines) || 4)),
    progress: Number.isFinite(progressRaw) ? Math.max(0, Math.min(1, progressRaw)) : null,
    outputPath: String(input.outputPath == null ? '' : input.outputPath),
  }
}

/**
 * 计算卡片版面（纯函数，无 IO）——**抽出来是为了让「标题安全区」可被机械断言**。
 *
 * 契约（测试锁的就是这几条）：
 *   · 所有正文/标题/标签的 x 坐标 **≥ margin**；
 *   · `margin ≥ width × 0.10`（zoom-in 1.25 居中裁切吃掉左右各 10%）；
 *   · 右下角计数与进度条同样落在安全区内（右边距 = margin）。
 *
 * @param {object} options
 * @returns {{
 *   margin: number, contentWidth: number, titleLines: string[], subtitleLines: string[],
 *   titleSize: number, subtitleSize: number, labelSize: number, counterSize: number,
 *   unit: number, theme: object, filters: string[]
 * }}
 */
function computeCardLayout (options) {
  const opts = normalizeOptions(options)
  const theme = THEMES[opts.theme]
  const unit = opts.width / 1920
  const margin = Math.round(opts.width * opts.safeMarginRatio)
  const contentWidth = Math.max(120, opts.width - margin * 2)
  const titleSize = Math.round(54 * unit)
  const subtitleSize = Math.round(30 * unit)
  const labelSize = Math.round(26 * unit)
  const counterSize = Math.round(30 * unit)
  const lineGap = Math.round(titleSize * 1.35)

  const titleLines = wrapText(opts.title, Math.floor(contentWidth / titleSize)).slice(0, opts.titleMaxLines)
  const subtitleLines = wrapText(opts.subtitle, Math.floor(contentWidth / subtitleSize)).slice(0, opts.subtitleMaxLines)

  const filters = []
  let y = margin

  if (opts.label) {
    filters.push(drawTextFilter({ text: opts.label, color: theme.accent, size: labelSize, x: margin, y }))
    y += Math.round(labelSize * 1.9)
    filters.push(
      'drawbox=x=' + margin + ':y=' + y + ':w=' + Math.round(120 * unit) +
      ':h=' + Math.max(2, Math.round(6 * unit)) + ':color=' + theme.accent + '@0.9:t=fill'
    )
    y += Math.round(labelSize * 1.6)
  }

  for (const line of titleLines) {
    filters.push(drawTextFilter({ text: line, color: 'white', size: titleSize, x: margin, y }))
    y += lineGap
  }

  if (subtitleLines.length) {
    y += Math.round(titleSize * 0.4)
    for (const line of subtitleLines) {
      filters.push(drawTextFilter({
        text: line, color: theme.body, size: subtitleSize, x: margin, y, alpha: '0.82',
      }))
      y += Math.round(subtitleSize * 1.5)
    }
  }

  if (opts.counter) {
    filters.push(drawTextFilter({
      text: opts.counter,
      color: 'white',
      size: counterSize,
      x: '(w-text_w-' + margin + ')',
      y: '(h-text_h-' + margin + ')',
      alpha: '0.75',
    }))
  }

  const barWidth = Math.round(opts.width * 0.16)
  const barHeight = Math.max(2, Math.round(8 * unit))
  const barY = opts.height - margin - barHeight
  filters.push('drawbox=x=' + margin + ':y=' + barY + ':w=' + barWidth + ':h=' + barHeight + ':color=white@0.18:t=fill')
  if (opts.progress !== null) {
    filters.push(
      'drawbox=x=' + margin + ':y=' + barY + ':w=' + Math.max(2, Math.round(barWidth * opts.progress)) +
      ':h=' + barHeight + ':color=' + theme.accent + ':t=fill'
    )
  }

  return {
    margin, contentWidth, titleLines, subtitleLines,
    titleSize, subtitleSize, labelSize, counterSize,
    unit, theme, filters,
  }
}

/**
 * 判定某个候选 ffmpeg 是否**真的可执行**。
 *
 * 为什么需要这一步（2026-10-24 实测）：
 *   `media-tool-paths.findFfmpeg()` 只判「文件存在」不判「能不能执行」——
 *   预置包 `ffmpeg-ffprobe-static` 的二进制在某些环境里**存在但不可执行**
 *   （实测：NFS 挂载丢失执行位 ⇒ spawn 报 `EACCES`；真实世界还有文件被权限改动、
 *   postinstall 未跑完只落了个半截文件等形态）。
 *   那种情况下直接 spawn 会得到一个**看起来像渲染失败**的错误，而根因其实是
 *   「选错了二进制」⇒ 必须在校验后再用。
 *
 * 判据：
 *   · 带路径分隔符 ⇒ `fs.accessSync(X_OK)`（Windows 上 Node 只查存在性，语义不变）；
 *   · 裸命令名（PATH 查找）⇒ 实际跑一次 `-version`，能起来才算数。
 *
 * @param {string} candidate
 * @returns {boolean}
 */
function isExecutableCandidate (candidate) {
  if (typeof candidate !== 'string' || !candidate) return false
  try {
    if (candidate.includes('/') || candidate.includes('\\')) {
      fs.accessSync(candidate, fs.constants.X_OK)
      return true
    }
    execFileSync(candidate, ['-version'], { stdio: 'ignore', timeout: 5000 })
    return true
  } catch (_) {
    return false
  }
}

/**
 * 解析一个**确实可执行**的 ffmpeg。
 *
 * 候选顺序：显式注入 → 仓库解析器（打包资源 / 环境变量 / 预置包 / PATH / 常见路径）→ 裸命令名。
 * 逐个过可执行性校验，全部不可用时返回 null（调用方据此给出明确错误，而不是甩一个 EACCES）。
 *
 * @param {{ ffmpegPath?: string }} [options]
 * @returns {string|null}
 */
function resolveFfmpegBinary (options = {}) {
  const candidates = []
  if (typeof options.ffmpegPath === 'string' && options.ffmpegPath.trim()) {
    candidates.push(options.ffmpegPath.trim())
  }
  try {
    const resolved = findFfmpeg()
    if (resolved) candidates.push(resolved)
  } catch (_) { /* 解析器异常时继续走 PATH 兜底 */ }
  candidates.push('ffmpeg')
  for (const candidate of candidates) {
    if (isExecutableCandidate(candidate)) return candidate
  }
  return null
}

/**
 * 渲染标题卡。
 *
 * @param {object} options
 * @param {string} options.outputPath 输出 PNG 路径（必填）
 * @param {string} [options.title] 主标题
 * @param {string} [options.subtitle] 副标题（通常放画面提示词）
 * @param {string} [options.label] 顶部小标签
 * @param {string} [options.counter] 右下角序号
 * @param {number} [options.width=1280]
 * @param {number} [options.height=720]
 * @param {string} [options.theme='cinematic']
 * @param {number} [options.safeMarginRatio=0.13]
 * @param {number} [options.progress] 0..1 底部进度条
 * @param {string} [options.ffmpegPath] 注入 ffmpeg 路径（测试用）
 * @returns {Promise<{ path: string, width: number, height: number, size: number, theme: string, safeMarginRatio: number, degraded: boolean }>}
 */
async function renderTitleCard (options) {
  const opts = normalizeOptions(options)
  if (!opts.outputPath) throw new Error('renderTitleCard: outputPath 必填')
  if (!opts.title.trim() && !opts.subtitle.trim()) {
    throw new Error('renderTitleCard: title 与 subtitle 至少要有一个非空')
  }

  const ffmpeg = resolveFfmpegBinary(options || {})
  if (!ffmpeg) throw new Error('renderTitleCard: 找不到可执行的 ffmpeg（FFMPEG_PATH 可覆盖）')

  const layout = computeCardLayout(opts)
  const filters = layout.filters

  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true })

  const gradientSource = 'gradients=s=' + opts.width + 'x' + opts.height +
    ':c0=' + layout.theme.c0 + ':c1=' + layout.theme.c1 + ':x0=0:y0=0:x1=' + opts.width + ':y1=' + opts.height + ':n=2'
  const solidSource = 'color=c=' + layout.theme.c0 + ':s=' + opts.width + 'x' + opts.height + ':d=1'

  let degraded = false
  let lastError = null
  for (const source of [gradientSource, solidSource]) {
    try {
      await execFileAsync(ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', source,
        '-vf', filters.join(','),
        '-frames:v', '1',
        '-f', 'image2', opts.outputPath,
      ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
      if (!fs.existsSync(opts.outputPath)) throw new Error('ffmpeg 未产出文件')
      const stat = fs.statSync(opts.outputPath)
      return {
        path: opts.outputPath,
        width: opts.width,
        height: opts.height,
        size: stat.size,
        theme: opts.theme,
        safeMarginRatio: opts.safeMarginRatio,
        degraded,
      }
    } catch (error) {
      lastError = error
      degraded = true
    }
  }
  throw new Error('renderTitleCard: ffmpeg 渲染失败: ' +
    (lastError && lastError.message ? lastError.message : String(lastError)))
}

module.exports = {
  renderTitleCard,
  escapeDrawtextText,
  computeCardLayout,
  resolveFfmpegBinary,
  isExecutableCandidate,
  wrapText,
  normalizeOptions,
  THEMES,
  SAFE_MARGIN_RATIO,
  MIN_WIDTH,
  MIN_HEIGHT,
}
