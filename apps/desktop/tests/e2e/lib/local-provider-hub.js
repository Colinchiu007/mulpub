// @ts-check
/**
 * local-provider-hub.js — 离线 Provider 桩（LLM + 图片生成）
 *
 * 用途：让 animated-explainer（AI 讲解视频）流水线在**没有任何付费 API Key** 的环境里
 * 也能被真实跑通 —— 用于 CDP 端到端复跑、CI 冒烟、以及本地开发自测。
 *
 * 两个桩都严格复刻真实 Provider 的线上协议，桌面端适配器零改动即可对接：
 *
 * 1. LLM 桩 —— OpenAI 兼容协议（`POST {base}/chat/completions`）
 *    - 复用 apps/desktop/electron/services/adapters/openai.js 的请求/响应契约：
 *      请求 `{ model, messages, temperature, max_tokens }`，
 *      响应 `{ choices: [{ message: { content }, finish_reason }] }`。
 *    - 桌面端 `model-provider-manager` 的**泛化兜底**：任何 `llm` 类别且配了
 *      `base_url` 的 provider 都会走 `OpenAICompatibleAdapter`，因此把本地
 *      provider 的 base_url 指到这里即可，无需改任何生产代码。
 *    - 路由依据是**阶段 system prompt**（explainer-stages.js 里的固定常量），
 *      不是用户输入：research / proposal / script / scenes 四阶段各对应一份
 *      预置文案，避免「同一个词命中两个阶段」的歧义。
 *
 * 2. 图片桩 —— Stable Diffusion WebUI 兼容协议（`POST {base}/sdapi/v1/txt2img`）
 *    - 对应 `adapters/local-diffusion.js`：请求 `{ prompt, width, height, steps, ... }`，
 *      响应 `{ images: [base64png] }`。
 *    - 该 provider 属 `LOCAL_NO_KEY_PROVIDER_IDS`，且 base_url 指向回环地址时
 *      **免 API Key**（见 model-provider-manager.js 的 canUseWithoutApiKey），
 *      正好满足流水线启动前的模型能力前置校验。
 *    - 出图不是占位灰块：用 ffmpeg 渲染一张带渐变底、标题、副标题与进度条的
 *      动效卡片，标题取自该场景的旁白文案（与 copy fixture 同源），
 *      因此成片是「有信息量的讲解画面」而不是无意义的色块。
 *
 * 边界：本模块只服务于 E2E/自测，**不进生产链路**；真实用户永远走各自的服务商。
 */

'use strict'

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
// ⚠ 必须**显式 require**：某些 Node 构建会把内置模块暴露成全局（实测本机 `globalThis.zlib` 存在）
//   ⇒ 漏掉这一行时本机跑绿、CI 的 Node 构建上没有 ⇒ ReferenceError: zlib is not defined。
//   依赖「恰好存在的全局」= 依赖某台机器的构建细节。
const zlib = require('zlib')
const { execFile, execFileSync } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const { findFfmpeg } = require('../../../electron/services/media-tool-paths')
const { escapeDrawtextText } = require('../../../electron/services/asset-generator')
const { buildDrawtextFontOption } = require('../../../electron/services/font-resolver')

/** LLM 桩默认端口（避开仓库 dev-ports.js 派生的 9222-12021 / 5174-7973 区间） */
const DEFAULT_LLM_PORT = 8787
/** 图片桩默认端口（对齐 local-diffusion 适配器的默认 baseUrl 端口） */
const DEFAULT_IMAGE_PORT = 7860

/**
 * 卡片标题安全区边距（占画幅宽度的比例）。
 *
 * 合成引擎默认动效 zoom-in 会把画面从 1.0 放大到 1.25 倍并居中裁切，
 * 左右各吃掉 10% ⇒ 边距必须 ≥ 10%，取 13% 留余量。详见 renderCard 的注释。
 */
const SAFE_MARGIN_RATIO = 0.13

/**
 * 阶段 system prompt 特征串 → copy fixture 的键。
 *
 * ⚠ **这些特征串必须与 `electron/services/explainer/explainer-preprod-stages.js` /
 *   `explainer/explainer-prod-stages.js` 里的 system prompt 一一对应。**
 *   ⚠ 2026-10-24 实测踩坑：P2a 把前三个阶段的 system prompt 全改写了
 *   （「结构化的讲解视频大纲」→「你是资深视频研究员」等）⇒ 旧特征串**全部失效**
 *   ⇒ 四个阶段一起落到 default 'research' ⇒ E2E 拿到的全是 research 文案，且**不报错**。
 *   ⇒ 特征串选「阶段角色名」这种语义稳定的措辞，别选会随改写消失的描述；
 *     并且 `lib/local-provider-hub.test.js` 里有机械守卫断言每个特征串都能在
 *     对应的提示词常量里找到 ⇒ 提示词一改，守卫立刻红。
 */
const STAGE_ROUTES = [
  { key: 'scenes', match: '你是视频分镜师' },
  { key: 'scenes', match: '严格的 JSON 输出助手' },
  { key: 'script', match: '你是视频编剧' },
  { key: 'proposal', match: '你是视频制片人' },
  { key: 'research', match: '你是资深视频研究员' },
]

/**
 * 组装提示词里的镜头语言标记。
 * ⚠ 必须与 `electron/services/explainer/explainer-shot-language.js` 的组装格式一致
 *   （那边是「镜头：{值}」）⇒ 改了那边就要改这里。
 *   `local-provider-hub.test.js` 里有守卫断言。
 */
const SHOT_LANGUAGE_MARKER = '镜头：'

/** 卡片配色（背景渐变起止色 + 强调色），按画面提示词哈希稳定选取 */
const CARD_PALETTES = [
  { c0: '0x08101F', c1: '0x16324F', accent: '0x4FC3F7' },
  { c0: '0x140B1E', c1: '0x3A1B54', accent: '0xCE93D8' },
  { c0: '0x0B1A12', c1: '0x17402A', accent: '0x66BB6A' },
  { c0: '0x1A1206', c1: '0x4A2C0C', accent: '0xFFB74D' },
  { c0: '0x1A0A0A', c1: '0x4A1414', accent: '0xEF5350' },
]

/** 读取文案基准文件 */
function loadCopy (copyPath) {
  const raw = fs.readFileSync(copyPath, 'utf8')
  const copy = JSON.parse(raw)
  if (!copy || typeof copy !== 'object') throw new Error('文案基准必须是 JSON 对象')
  for (const key of ['research', 'proposal', 'script', 'scenes']) {
    if (!copy[key]) throw new Error('文案基准缺少字段: ' + key)
  }
  if (!Array.isArray(copy.scenes) || copy.scenes.length === 0) {
    throw new Error('文案基准的 scenes 必须是非空数组')
  }
  return copy
}

/** 按 system prompt 判定当前处于哪个阶段 */
function resolveStageKey (messages) {
  const system = (messages || [])
    .filter(m => m && m.role === 'system')
    .map(m => String(m.content || ''))
    .join('\n')
  for (const route of STAGE_ROUTES) {
    if (system.includes(route.match)) return route.key
  }
  return 'research'
}

/**
 * 画面提示词 → 场景文案（让出图带上旁白标题，而不是干巴巴的提示词）。
 *
 * ⚠ P2b 起，生图提示词由**代码确定性组装**（风格 + description + 六段镜头语言 + texture），
 *   **不再等于** fixture 里的 prompt ⇒ 纯「相等匹配」会失配 ⇒ 退化成「拿提示词前 40 字当标题」。
 * ⇒ 三级匹配：description 相等 → prompt 相等（旧形态）→ description 被提示词包含（组装形态）。
 */
function findSceneByPrompt (copy, prompt) {
  const target = String(prompt || '').trim()
  if (!target) return null
  const scenes = copy.scenes || []
  const byDescription = scenes.find(scene => String(scene.description || '').trim() === target)
  if (byDescription) return byDescription
  const byPrompt = scenes.find(scene => String(scene.prompt || '').trim() === target)
  if (byPrompt) return byPrompt
  // 第三级：**P2b 组装形态**。组装结果 = 风格 + description + 六段镜头语言 + texture
  //   ⇒ 含 SHOT_LANGUAGE_MARKER，且 description 不是首段 ⇒ 只能用「包含」匹配。
  //   ⚠ 用标记做门槛（而不是无条件包含）—— 否则「description + 追加内容」也会命中 ⇒ 相似提示词串台。
  //   ⚠ 且**必须唯一命中**才返回：多个场景都命中 ⇒ 判为串台 ⇒ 返回 null。
  if (target.includes(SHOT_LANGUAGE_MARKER)) {
    const hits = scenes.filter(scene => {
      const description = String(scene.description || scene.prompt || '').trim()
      return description && target.includes(description)
    })
    if (hits.length === 1) return hits[0]
  }
  return null
}

/** 稳定字符串哈希（用于按提示词挑配色，保证同一场景每次渲染一致） */
function stableHash (text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

/** 估算字符宽度（全角算 1，半角算 0.55） */
function charWidth (ch) {
  const code = ch.codePointAt(0)
  if (code > 0x2e80) return 1
  if (ch === ' ') return 0.35
  return 0.55
}

/** 按估算宽度折行（中文排版够用，不追求像素级精确） */
function wrapText (text, maxUnits) {
  const source = String(text || '').replace(/\s+/g, ' ').trim()
  if (!source) return []
  const lines = []
  let current = ''
  let width = 0
  for (const ch of source) {
    const w = charWidth(ch)
    if (width + w > maxUnits && current) {
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
 * 构造一条 drawtext 滤镜。
 * 注意：buildDrawtextFontOption() 返回的片段**自带前导冒号**（形如
 * `:fontfile='/x/y.otf'`），直接 join(':') 会拼出 `::` 让 ffmpeg 报
 * "Both text and text file provided"，因此这里按固定顺序拼接而非 join。
 */
function drawText (options) {
  let filter = "drawtext=text='" + escapeDrawtextText(options.text) + "'" + buildDrawtextFontOption()
  filter += ':fontcolor=' + options.color
  filter += ':fontsize=' + options.size
  filter += ':x=' + options.x
  filter += ':y=' + options.y
  if (options.alpha !== undefined) filter += ':alpha=' + options.alpha
  return filter
}

/**
 * 解析可用的 ffmpeg。
 *
 * 优先用仓库的 media-tool-paths（尊重 FFMPEG_PATH 覆盖 → 打包目录 → 预置包 → PATH）。
 * 但预置包在某些环境里**不可执行**（NFS 挂载丢执行位、postinstall 未跑完的半截二进制），
 * 此时 spawn 会报 EACCES —— 对「离线出图桩」来说这是环境问题，不该让整条流水线崩。
 * 故这里做一次可执行性校验，不通过就回退到 PATH 上的 ffmpeg。
 *
 * @returns {string} ffmpeg 可执行文件路径
 */
// ── 无 ffmpeg 兜底：不依赖任何外部二进制的 PNG 编码（RGBA8）────────────────────
// 动因（2026-10-24 实测，主干红）：出图原本**只**走 ffmpeg 渲染 ⇒ 没有 ffmpeg 的机器
//   （实测：Windows CI runner）上出图路径**从未被走过**，出图用例只能 skip；
//   而依赖它的统计断言是无条件的 ⇒ skip 静默变成后续失败 ⇒ electron-tests 分片红 ⇒
//   主干红 ⇒ 全部 open PR 被挡。⇒ 兜底不是「为了让测试变绿」，是**让出图路径在每台机器上
//   都有覆盖**；有 ffmpeg 时仍走 ffmpeg 渲染带文字的完整卡片。
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let pngCrcTable = null
function pngCrc32 (buf) {
  if (!pngCrcTable) {
    pngCrcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      pngCrcTable[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = pngCrcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function pngChunk (type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

/**
 * 编码一张 RGBA8 PNG。pixelAt(x, y) 返回 [r, g, b]。
 * 尺寸**精确**：宽高写进 IHDR ⇒ 消费方按请求尺寸读到的就是请求尺寸。
 */
function encodePng (width, height, pixelAt) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1)
    raw[rowOff] = 0 // filter type 0（None）
    for (let x = 0; x < width; x++) {
      const px = pixelAt(x, y)
      const i = rowOff + 1 + x * 4
      raw[i] = px[0] & 0xff
      raw[i + 1] = px[1] & 0xff
      raw[i + 2] = px[2] & 0xff
      raw[i + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** 0xRRGGBB → [r, g, b] */
function hexToRgb (hex) {
  const s = String(hex || '0x000000').replace(/^0x/i, '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function resolveFfmpegBinary () {
  const candidates = []
  try {
    const resolved = findFfmpeg()
    if (resolved) candidates.push(resolved)
  } catch (_) { /* 预置包不可用时继续回退 */ }
  candidates.push('ffmpeg')
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep)) {
        fs.accessSync(candidate, fs.constants.X_OK)
      }
      execFileSync(candidate, ['-version'], { stdio: 'ignore', timeout: 10000 })
      return candidate
    } catch (_) { /* 试下一个 */ }
  }
  throw new Error('找不到可执行的 ffmpeg（候选：' + candidates.join(', ') + '）')
}

/**
 * 渲染一张讲解卡片 PNG。
 *
 * **版面必须落在「标题安全区」内**：合成引擎的默认动效是 `zoom-in`
 * （story2video-compose-engine.js 的 buildImageEffectFilter：`1+0.25*progress`
 * 居中缩放），即画面在场景内从 1.0 放大到 **1.25** 倍并居中裁切 ——
 * 左右各被裁掉 (1 - 1/1.25) / 2 = **10%**。
 * 所以卡片的所有文字都必须距左右边缘 ≥ 10% 画幅，否则成片里会被切掉首尾字
 * （实测：左边距 73px < 128px 时，「好消息是」被裁成「消息是」）。
 * 这里统一用 SAFE_MARGIN_RATIO = 13% 做边距，留出余量。
 *
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>}
 */
async function renderCard (options) {
  const width = Math.max(320, Math.min(3840, Number(options.width) || 1920))
  const height = Math.max(240, Math.min(2160, Number(options.height) || 1080))
  const headline = String(options.headline || '').trim()
  const body = String(options.body || '').trim()
  const palette = CARD_PALETTES[stableHash(String(options.prompt || '')) % CARD_PALETTES.length]

  const unit = width / 1920
  const titleSize = Math.round(54 * unit)
  const bodySize = Math.round(30 * unit)
  const labelSize = Math.round(26 * unit)
  const counterSize = Math.round(30 * unit)
  const lineGap = Math.round(titleSize * 1.35)
  // 标题安全区：zoom-in 1.25 居中裁切会吃掉左右各 10%，边距取 13% 留余量。
  const margin = Math.round(width * SAFE_MARGIN_RATIO)
  const contentWidth = Math.max(120, width - margin * 2)
  // 折行宽度按**像素预算**算（CJK 字宽 ≈ 1em），不再用固定字数
  const headlineMaxUnits = Math.max(6, Math.floor(contentWidth / titleSize))
  const bodyMaxUnits = Math.max(10, Math.floor(contentWidth / bodySize))

  // 主标题最多 3 行，副标题最多 4 行
  const headlineLines = wrapText(headline, headlineMaxUnits).slice(0, 3)
  const bodyLines = wrapText(body, bodyMaxUnits).slice(0, 4)

  const filters = []
  filters.push(drawText({
    text: options.label || 'AI 讲解视频',
    color: palette.accent,
    size: labelSize,
    x: margin,
    y: margin,
  }))
  // 强调色短横线
  filters.push("drawbox=x=" + margin + ':y=' + (margin + Math.round(labelSize * 1.9)) +
    ':w=' + Math.round(120 * unit) + ':h=' + Math.round(6 * unit) + ':color=' + palette.accent + '@0.9:t=fill')

  let y = margin + Math.round(labelSize * 3.4)
  for (const line of headlineLines) {
    filters.push(drawText({ text: line, color: 'white', size: titleSize, x: margin, y }))
    y += lineGap
  }
  y += Math.round(titleSize * 0.4)
  for (const line of bodyLines) {
    filters.push(drawText({ text: line, color: '0xD8DEE9', size: bodySize, x: margin, y, alpha: '0.82' }))
    y += Math.round(bodySize * 1.5)
  }

  // 底部：序号 + 进度条
  const counter = String(options.counter || '')
  if (counter) {
    filters.push(drawText({
      text: counter,
      color: '0xFFFFFF',
      size: counterSize,
      x: '(w-text_w-' + margin + ')',
      y: '(h-text_h-' + margin + ')',
      alpha: '0.75',
    }))
  }
  const barWidth = Math.round(width * 0.16)
  const barHeight = Math.round(8 * unit)
  const barX = margin
  const barY = height - margin - barHeight
  filters.push("drawbox=x=" + barX + ':y=' + barY + ':w=' + barWidth + ':h=' + barHeight +
    ':color=0xFFFFFF@0.18:t=fill')
  const ratio = Math.max(0.04, Math.min(1, Number(options.progress) || 0.04))
  filters.push("drawbox=x=" + barX + ':y=' + barY + ':w=' + Math.round(barWidth * ratio) + ':h=' + barHeight +
    ':color=' + palette.accent + ':t=fill')

  // ⚠ 没有 ffmpeg 时**不能抛**：出图路径在这些机器上从未被走过 ⇒ 出图用例只能 skip，
  //   而依赖它的统计断言是无条件的 ⇒ skip 静默变成失败（实测：主干 electron-tests 分片红）。
  //   ⇒ 走不依赖外部二进制的 PNG 兜底编码，尺寸精确、形状仍是渐变卡片。
  let ffmpeg = null
  try { ffmpeg = resolveFfmpegBinary() } catch (_) { ffmpeg = null }
  if (!ffmpeg) {
    const c0 = hexToRgb(palette.c0)
    const c1 = hexToRgb(palette.c1)
    const accent = hexToRgb(palette.accent)
    const buffer = encodePng(width, height, (x, y) => {
      const t = Math.min(1, Math.max(0, (x / width) * 0.6 + (y / height) * 0.4))
      const base = [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ]
      // 底部进度条：与 ffmpeg 路径同形（accent 的一条横带），让兜底图也不是纯渐变
      const barTop = height - Math.round(height * 0.08)
      if (y >= barTop && y < barTop + Math.max(4, Math.round(height * 0.012)) && x < Math.round(width * 0.16)) {
        return accent
      }
      return base
    })
    return { buffer, width, height, degraded: true }
  }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-local-img-'))
  const outFile = path.join(outDir, 'card.png')
  const filterSource = 'gradients=s=' + width + 'x' + height +
    ':c0=' + palette.c0 + ':c1=' + palette.c1 + ':x0=0:y0=0:x1=' + width + ':y1=' + height + ':n=2'
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', filterSource,
    '-vf', filters.join(','),
    '-frames:v', '1',
    '-f', 'image2', outFile,
  ]
  try {
    await execFileAsync(ffmpeg, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
    const buffer = fs.readFileSync(outFile)
    return { buffer, width, height, degraded: false }
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }) } catch (_) { /* 临时目录清理失败不阻断 */ }
  }
}

/** 读取 JSON 请求体 */
function readJsonBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(new Error('请求体不是合法 JSON: ' + e.message)) }
    })
    req.on('error', reject)
  })
}

/** 发送 JSON 响应 */
function sendJson (res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

class LocalProviderHub {
  /**
   * @param {{ copyPath: string, llmPort?: number, imagePort?: number, log?: Function }} options
   */
  constructor (options) {
    this.copyPath = options.copyPath
    this.llmPort = options.llmPort || DEFAULT_LLM_PORT
    this.imagePort = options.imagePort || DEFAULT_IMAGE_PORT
    this.log = options.log || (() => {})
    this.copy = loadCopy(this.copyPath)
    this._servers = []
    this._calls = { llm: 0, image: 0 }
  }

  /** 启动两个桩服务 */
  async start () {
    this._servers.push(await this._startLlmServer())
    this._servers.push(await this._startImageServer())
    this.log('本地 Provider 桩已启动：llm=127.0.0.1:' + this.llmPort +
      ' image=127.0.0.1:' + this.imagePort)
    return {
      llmBaseUrl: 'http://127.0.0.1:' + this.llmPort + '/v1',
      imageBaseUrl: 'http://127.0.0.1:' + this.imagePort,
    }
  }

  /** 关闭所有桩服务 */
  async stop () {
    const servers = this._servers.splice(0)
    for (const server of servers) {
      await new Promise((resolve) => server.close(() => resolve()))
    }
  }

  /** 调用统计（用于断言各阶段确实被打到） */
  stats () {
    return { ...this._calls }
  }

  async _startLlmServer () {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
          return sendJson(res, 200, { object: 'list', data: [{ id: 'local-explainer', object: 'model' }] })
        }
        if (req.method !== 'POST' || !req.url.startsWith('/v1/chat/completions')) {
          return sendJson(res, 404, { error: { message: 'unsupported llm route: ' + req.url } })
        }
        const body = await readJsonBody(req)
        const stageKey = resolveStageKey(body.messages)
        this._calls.llm++
        this.log('[llm-stub] 阶段=' + stageKey + ' model=' + (body.model || '-') +
          ' messages=' + (Array.isArray(body.messages) ? body.messages.length : 0))
        let content = this.copy[stageKey]
        if (stageKey === 'scenes') content = JSON.stringify(this.copy.scenes)
        sendJson(res, 200, {
          id: 'chatcmpl-local',
          object: 'chat.completion',
          model: body.model || 'local-explainer',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        })
      } catch (error) {
        sendJson(res, 500, { error: { message: String(error && error.message ? error.message : error) } })
      }
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.llmPort, '127.0.0.1', resolve)
    })
    return server
  }

  async _startImageServer () {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url.startsWith('/sdapi/v1/options')) {
          return sendJson(res, 200, { sd_model_checkpoint: 'local-explainer-card', samples: 1 })
        }
        if (req.method === 'GET' && req.url.startsWith('/sdapi/v1/sd-models')) {
          return sendJson(res, 200, ['local-explainer-card'])
        }
        if (req.method !== 'POST' || !req.url.startsWith('/sdapi/v1/txt2img')) {
          return sendJson(res, 404, { error: 'unsupported image route: ' + req.url })
        }
        const body = await readJsonBody(req)
        const scene = findSceneByPrompt(this.copy, body.prompt)
        this._calls.image++
        this.log('[image-stub] ' + (scene ? '命中场景文案' : '按提示词渲染') +
          ' ' + (body.width || '?') + 'x' + (body.height || '?'))
        const card = await renderCard({
          prompt: body.prompt,
          width: body.width,
          height: body.height,
          headline: scene ? scene.text : String(body.prompt || '').slice(0, 40),
          body: body.prompt,
          label: 'AI 讲解视频 · ' + (this.copy.topic || ''),
          counter: scene ? '场景 ' + ((this.copy.scenes.indexOf(scene) + 1) + ' / ' + this.copy.scenes.length) : '',
          progress: scene ? (this.copy.scenes.indexOf(scene) + 1) / this.copy.scenes.length : 0.04,
        })
        sendJson(res, 200, {
          images: [card.buffer.toString('base64')],
          parameters: { width: card.width, height: card.height, steps: body.steps || 20 },
          info: 'local-provider-hub',
        })
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.imagePort, '127.0.0.1', resolve)
    })
    return server
  }
}

module.exports = {
  LocalProviderHub,
  resolveFfmpegBinary,
  encodePng,
  hexToRgb,
  SAFE_MARGIN_RATIO,
  loadCopy,
  resolveStageKey,
  findSceneByPrompt,
  wrapText,
  renderCard,
  DEFAULT_LLM_PORT,
  DEFAULT_IMAGE_PORT,
  STAGE_ROUTES,
}
