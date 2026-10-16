// @ts-check
/**
 * local-cover-generator.js — 本地内容感知封面生成器（零生图模型、零新增依赖）
 *
 * 用途：图文发布（小红书/快手/抖音图文）要求至少 1 张图片；当 AI 生图 provider 不可用
 * 或生图失败时，由本模块用「内容感知 SVG → sharp → PNG」产出**与文章内容相关**的封面，
 * 保证一键发布图文链路可用。
 *
 * 设计约束：
 * - 零模型调用：主题识别完全靠本地词典 + 哈希派生，这是「文字模型不可用」场景仍能产出
 *   内容相关封面的前提；任何对 LLM 的依赖都会让兜底在模型挂掉时一起挂掉。
 * - 零新增依赖：sharp 已在 packages/shared-utils 依赖（hoisted node_modules），主进程直接 require。
 * - 确定性：同一份内容必然产出同一张封面（便于回归断言与用户预期稳定）；换 variant 才换风格。
 * - 装饰不压字：纹样只在标题块下方的「安全区」内布局，杜绝装饰穿过标题。
 * - 比例：3:4（1080x1440，小红书/快手图文推荐竖版）/ 16:9（1920x1080）/ 1:1（1080x1080）
 *   / 4:3（1440x1080）/ 9:16（1080x1920）
 * - 输出：os.tmpdir()/multi-publish-cover-local/<时间戳>-<随机>.png（与 AI 封面目录区分）
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

/** 封面栅格化子进程超时（毫秒）。超时即当失败，不无限等待。 */
const RASTERIZE_TIMEOUT_MS = 60000

/**
 * 把封面 SVG 栅格化为 PNG。
 *
 * 为什么走子进程 + FONTCONFIG_FILE（2026-10-16 四轮实测）：
 *   ① 纯系统字体栈在无 CJK 字体的机器上（英文版/精简版 Windows、headless Linux）
 *      中文标题整块变豆腐块 —— A/B 对照实测封面 5.639% 像素差异，标题/徽章/关键词
 *      三条中文全灭，只剩图表装饰。
 *   ② sharp 的 `font` 选项（传目录、传字体文件）**均无效** —— Pango 只认 fontconfig
 *      已注册的字体；SVG 经 sharp 栅格化也不读 @font-face。
 *   ③ 唯一可行：渲染进程注入 `FONTCONFIG_FILE`，把自带字体目录写进 <dir>。
 *      实测 sha 前后不同（66a901dc vs 85c1cc5c）⇒ 得意黑确实被采用，不是回落系统字体。
 *
 * 失败纪律：任何一步失败都抛错，由 generateLocalCover 统一转成 code:-1 ——
 * 半张封面比没有更危险（会带着豆腐块发到平台上）。
 */
function rasterizeCover (svg, outputPath) {
  const { resolveContentCjkFont, buildFontconfigForSharp } = require('./font-resolver')
  const { fontFile, source } = resolveContentCjkFont({})
  const fontDir = source === 'bundled' ? path.dirname(fontFile) : ''

  const worker = path.join(__dirname, '.cover-rasterize-worker.js')
  // worker 不存在（裁剪过的产物）时退回直接渲染：至少有系统字体兜底
  if (!fs.existsSync(worker)) {
    const sharp = require('sharp')
    return sharp(Buffer.from(svg)).png().toFile(outputPath)
  }

  const env = { ...process.env }
  const fc = buildFontconfigForSharp({ fontDir })
  if (fc.injected) {
    env.FONTCONFIG_FILE = fc.fontconfigFile
    env.FONTCONFIG_PATH = path.dirname(fc.fontconfigFile)
  }

  const args = [
    worker,
    '--svg-file', writeTempSvg(svg),
    '--out', outputPath,
  ]
  execFileSync(process.execPath, args, { env, timeout: RASTERIZE_TIMEOUT_MS, stdio: 'ignore' })

  if (!fs.existsSync(outputPath)) {
    throw new Error('封面栅格化未产出文件')
  }
}

/** 把 SVG 写到 ASCII 安全临时文件（避免命令行传中文/超长参数） */
function writeTempSvg (svg) {
  const dir = path.join(os.tmpdir(), 'mp-cover-svg')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'cover-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.svg')
  fs.writeFileSync(file, svg, 'utf8')
  return file
}

const RATIOS = Object.freeze({
  '3:4': { width: 1080, height: 1440 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
})

/**
 * 封面文字字体栈。
 *
 * 2026-10-16 之前是 `'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif` ——
 * 纯系统字体栈。实测（A/B 对照，fontconfig 隔离为无 CJK）：英文版/精简版 Windows、
 * headless Linux 上中文标题**整块变豆腐块**（封面 5.639% 像素差异，标题/徽章/关键词
 * 三条中文全灭，只剩图表装饰）。封面是图文发布链路的一环，不能赌用户系统有中文字体。
 *
 * 现在：自包含得意黑（family 名 `Smiley Sans`）作首选项，系统字体栈次选。
 * ⚠️ 顺序不能反：sharp/Pango 的字体匹配比 Chromium 严格，首选项落空会直接降级。
 * ⚠️ SVG 经 sharp 栅格化时**不读 @font-face**，所以这里只能写 family 名；
 * 真正的字形来源由 font-resolver 把 otf 落到 ASCII 副本目录（Pango 可扫描）。
 */
const FONT_STACK = "'Smiley Sans','Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif"
const MAX_LINES = 4

const { TOPICS, MOTIFS } = require('./local-cover-topics')
const { motifs } = require('./local-cover-motifs')

/** FNV-1a 32 位哈希（无符号返回） */
function fnv1a (str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** HSL → #RRGGBB */
function hslToHex (h, s, l) {
  h = ((h % 360) + 360) % 360
  s /= 100
  l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  // 下列 if/else 链已穷尽 h∈[0,360)，不预置初值（ESLint no-useless-assignment）
  let r, g, b
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return '#' + to(r) + to(g) + to(b)
}

/** 转义 SVG 文本特殊字符（标题是用户内容，防注入 SVG 标记） */
function escapeXml (text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** CJK/全角字符（按 2 个单位宽计） */
function isWideChar (ch) {
  return /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch)
}

function displayWidth (s) {
  let w = 0
  for (const ch of s) w += isWideChar(ch) ? 2 : 1
  return w
}

// 中文排版禁则：不能出现在行首 / 不能出现在行尾的字符
const NO_LINE_START = '」）》】、。，！？：；·%…—’”'
const NO_LINE_END = '（「《【‘“'

/**
 * 标题折行：按显示宽度（CJK=2 / ASCII=1）切分，遵守三条排版规则
 *  1) ASCII 连续片段视为不可分割单元（「AI」「GPT-2026」不被拆成两行）
 *  2) 闭合标点不落行首（」不单独起行）
 *  3) 开启标点不落行尾（「不挂在行尾）
 *
 * @param {string} rawTitle
 * @param {number} maxUnits - 每行最大显示宽度
 * @returns {string[]} 最多 MAX_LINES 行
 */
function wrapTitle (rawTitle, maxUnits) {
  const title = String(rawTitle || '').trim()
  if (!title) return ['图文作品']

  // 切最小排版单元：ASCII 连续片段合并为 1 个单元
  const tokens = []
  let buf = ''
  for (const ch of title) {
    if (/[A-Za-z0-9@#.+_-]/.test(ch)) { buf += ch; continue }
    if (buf) { tokens.push(buf); buf = '' }
    tokens.push(ch)
  }
  if (buf) tokens.push(buf)

  const lines = []
  let cur = ''
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]
    if (cur && displayWidth(cur) + displayWidth(tk) > maxUnits) {
      let carry = null
      if (NO_LINE_START.includes(tk) && displayWidth(cur) > 2) { carry = cur.slice(-1); cur = cur.slice(0, -1) }
      lines.push(cur)
      if (lines.length >= MAX_LINES) {
        // 仍有未排入的文本 → 末行加省略号。如实标记「已截断」，
        // 否则 300 字标题会静默丢掉 278 字，调用方无从判断内容是否完整。
        if (i < tokens.length - 1 && cur.length > 0) {
          lines[lines.length - 1] = cur.slice(0, -1) + '…'
        }
        return lines
      }
      cur = (carry || '') + tk
    } else {
      cur += tk
    }
  }
  while (cur.length > 1 && NO_LINE_END.includes(cur.slice(-1)) && lines.length < MAX_LINES) {
    lines.push(cur.slice(0, -1))
    cur = cur.slice(-1)
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['图文作品']
}

/**
 * 主题识别：标题命中权重 3、正文命中权重 1，取加权最高者
 * @returns {{topic:object, score:number}|null} 无命中返回 null
 */
function detectTopic (title, content) {
  const t = String(title || '').toLowerCase()
  const c = String(content || '').slice(0, 400).toLowerCase()
  let best = null
  let bestScore = 0
  for (const topic of TOPICS) {
    let score = 0
    for (const k of topic.kw) {
      if (t.includes(k)) score += 3
      if (c.includes(k)) score += 1
    }
    if (score > bestScore) { bestScore = score; best = topic }
  }
  return bestScore > 0 ? { topic: best, score: bestScore } : null
}

/** 抽取最多 3 个命中关键词作为副标题 */
function extractKeywords (title, content) {
  const text = (String(title || '') + ' ' + String(content || '').slice(0, 200)).toLowerCase()
  const hit = []
  for (const topic of TOPICS) {
    for (const k of topic.kw) {
      if (text.includes(k) && hit.length < 3 && !hit.some((x) => x.toLowerCase() === k)) hit.push(k.toUpperCase())
    }
    if (hit.length >= 3) break
  }
  return hit
}

/**
 * 主题解析：显式指定 > 词典命中 > 内容哈希派生
 *
 * ⚠ 两处易踩的坑（均有回归测试钉住）：
 * 1) JS 的 `^` 返回**有符号** 32 位整数，哈希值 >2^31 时经 `^ k` 会翻成负数，
 *    导致 MOTIFS[负下标] === undefined，未命中分支直接崩 —— 必须 `>>> 0` 收回无符号。
 * 2) FNV-1a 的**低 4 位**对「随笔0/随笔1/…」这类高度相似串分布不均
 *    （实测 20 条只落 7 种纹样），纹样索引与色相都取高位（>>> 11）。
 */
function resolveTheme (title, content, forced, variant) {
  if (forced) {
    const t = TOPICS.find((x) => x.id === forced)
    if (t) return t
  }
  const hit = detectTopic(title, content)
  if (hit) return hit.topic
  const seed = (fnv1a(String(title || '') + '|' + String(content || '').slice(0, 200)) ^
    Math.imul((variant || 0) + 1, 2654435761)) >>> 0
  const hue = (seed >>> 11) % 360
  return {
    id: 'generated',
    label: '',
    motif: MOTIFS[(seed >>> 11) % MOTIFS.length],
    from: hslToHex(hue, 62, 26),
    to: hslToHex(hue + 40, 66, 44),
    accent: hslToHex(hue + 180, 85, 66),
  }
}

// CJK 字形相对基线的上伸比例（排版计算行盒高度用）
const ASCENT = 0.86

/**
 * 构造内容感知封面 SVG
 * @param {string} title 文章标题
 * @param {object} [options]
 * @param {number} [options.width=1080]
 * @param {number} [options.height=1440]
 * @param {string} [options.content] 正文摘要，供主题识别与关键词抽取
 * @param {string} [options.theme] 强制主题 id
 * @param {number} [options.variant=0] 风格变体，同内容换风格
 * @returns {string} SVG 字符串
 */
function buildCoverSvg (title, options = {}) {
  const w = options.width || 1080
  const h = options.height || 1440
  const theme = resolveTheme(title, options.content, options.theme, options.variant)
  const seed = (fnv1a(String(title || '') + '|' + theme.id) ^ Math.imul((options.variant || 0) + 1, 97)) >>> 0
  const units = w >= 1400 ? 13 : w >= 1000 ? 11 : 8
  const lines = wrapTitle(title, units)
  const kws = extractKeywords(title, options.content)

  // 字号按「短边」缩放（按宽缩放会把横版文字块撑爆、纹样区被挤没），
  // 并对整块高度设预算：超出则等比收缩，保证纹样安全区至少留 ~32% 画布高。
  const landscape = w / h > 1.25
  const maxBlock = Math.round(h * (landscape ? 0.58 : 0.62))
  const layout = (fs) => {
    const lineH = Math.round(fs * 1.42)
    const badgeR = Math.round(fs * 0.62)
    const badgeH = badgeR * 2
    const gap1 = Math.round(fs * 0.75)
    const gap2 = kws.length ? Math.round(fs * 0.9) : 0
    const kwsH = kws.length ? Math.round(fs * 0.46) : 0
    const titleBoxH = Math.round(fs * ASCENT) + lineH * (lines.length - 1) + Math.round(fs * 0.22)
    return { lineH, badgeR, badgeH, gap1, gap2, titleBoxH, totalH: badgeH + gap1 + titleBoxH + gap2 + kwsH }
  }
  let fs = Math.round(Math.min(w, h) * 0.072)
  let L = layout(fs)
  if (L.totalH > maxBlock) {
    fs = Math.max(Math.round(fs * (maxBlock / L.totalH)), Math.round(h * 0.032))
    L = layout(fs)
  }

  const { lineH, badgeR, badgeH, gap1, gap2, titleBoxH } = L
  const blockTop = Math.round((h - L.totalH) / 2)
  const badgeX = Math.round(w * 0.085)
  const badgeY = blockTop
  const label = theme.label || (options.variant ? '换个风格' : '内容封面')
  const barW = Math.round(fs * 0.18)
  const textX = badgeX + Math.round(fs * 0.55)
  const firstBaseline = badgeY + badgeH + gap1 + Math.round(fs * ASCENT)
  const kwsBaseline = firstBaseline + lineH * (lines.length - 1) + Math.round(fs * 0.22) + gap2 + Math.round(fs * 0.42)
  const blockBottom = kws.length ? kwsBaseline + fs * 0.1 : firstBaseline + lineH * (lines.length - 1) + fs * 0.3

  // 纹样安全区上边界：文字块下方，且不超过 84% 画高
  let safeTop = blockBottom + fs * 0.85
  if (safeTop > h * 0.84) safeTop = Math.max(h * 0.6, blockBottom + fs * 0.3)

  const tspans = lines
    .map((l, i) => `<tspan x="${textX}" dy="${i === 0 ? 0 : lineH}">${escapeXml(l)}</tspan>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="${theme.from}"/><stop offset="100%" stop-color="${theme.to}"/></linearGradient>` +
    `<linearGradient id="scrim" x1="0%" y1="0%" x2="0%" y2="100%">` +
    `<stop offset="0%" stop-color="#000" stop-opacity="0.26"/>` +
    `<stop offset="45%" stop-color="#000" stop-opacity="0.08"/>` +
    `<stop offset="100%" stop-color="#000" stop-opacity="0.40"/></linearGradient>` +
    `<linearGradient id="fade" x1="0%" y1="0%" x2="0%" y2="100%">` +
    `<stop offset="0%" stop-color="#000" stop-opacity="0.5"/>` +
    `<stop offset="100%" stop-color="#000" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="safe"><rect x="0" y="${Math.round(safeTop)}" width="${w}" height="${Math.round(h - safeTop)}"/></clipPath>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#bg)"/>` +
    `<g clip-path="url(#safe)">${motifs[theme.motif](w, h, '#ffffff', seed, Math.round(safeTop))}</g>` +
    `<rect x="0" y="${Math.round(safeTop - fs * 1.4)}" width="${w}" height="${Math.round(fs * 1.4)}" fill="url(#fade)"/>` +
    `<rect width="${w}" height="${h}" fill="url(#scrim)"/>` +
    `<rect x="${badgeX}" y="${badgeY}" width="${Math.round(label.length * fs * 0.62 + fs * 1.1)}" height="${badgeH}" rx="${badgeR}" fill="${theme.accent}" opacity="0.95"/>` +
    `<text x="${badgeX + Math.round(fs * 0.55)}" y="${Math.round(badgeY + badgeH * 0.68)}" font-family="${FONT_STACK}" font-size="${Math.round(fs * 0.5)}" font-weight="bold" fill="#101828">${escapeXml(label)}</text>` +
    `<rect x="${badgeX}" y="${firstBaseline - Math.round(fs * ASCENT)}" width="${barW}" height="${titleBoxH}" rx="${Math.round(fs * 0.09)}" fill="${theme.accent}"/>` +
    `<text x="${textX}" y="${firstBaseline}" font-family="${FONT_STACK}" font-size="${fs}" font-weight="bold" fill="#ffffff">${tspans}</text>` +
    (kws.length
      ? `<text x="${textX}" y="${kwsBaseline}" font-family="${FONT_STACK}" font-size="${Math.round(fs * 0.42)}" fill="#ffffff" opacity="0.86">${escapeXml(kws.join('  ·  '))}</text>`
      : '') +
    `</svg>`
}

/**
 * 生成本地内容感知封面
 * @param {string} title 文章标题（折行/截断由内部处理）
 * @param {object} [options]
 * @param {string} [options.outputDir] 输出目录（默认 os.tmpdir()/multi-publish-cover-local）
 * @param {string} [options.ratio] 宽高比（默认 3:4 竖版）
 * @param {string} [options.content] 正文摘要，供主题识别与关键词抽取
 * @param {string} [options.theme] 强制主题 id（15 个主题之一）
 * @param {number} [options.variant=0] 风格变体，同内容换风格
 * @returns {Promise<{code:number,data:{path:string,theme:string,themeLabel:string,keywords:string[]}|null,message?:string}>}
 */
async function generateLocalCover (title, options = {}) {
  try {
    const ratioKey = RATIOS[options.ratio] ? options.ratio : '3:4'
    const { width, height } = RATIOS[ratioKey]
    const outputDir = options.outputDir || path.join(os.tmpdir(), 'multi-publish-cover-local')
    fs.mkdirSync(outputDir, { recursive: true })
    const fileName = `cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
    const outputPath = path.join(outputDir, fileName)

    const svg = buildCoverSvg(title, {
      width,
      height,
      content: options.content,
      theme: options.theme,
      variant: options.variant,
    })
    await rasterizeCover(svg, outputPath)

    if (!fs.existsSync(outputPath)) {
      return { code: -1, data: null, message: '本地封面写入失败' }
    }
    const resolved = resolveTheme(title, options.content, options.theme, options.variant)
    return {
      code: 0,
      data: {
        path: outputPath,
        theme: resolved.id,
        themeLabel: resolved.label || '内容封面',
        keywords: extractKeywords(title, options.content),
      },
    }
  } catch (e) {
    return { code: -1, data: null, message: '本地封面生成失败：' + (e && e.message) }
  }
}

module.exports = {
  generateLocalCover,
  wrapTitle,
  buildCoverSvg,
  resolveTheme,
  detectTopic,
  extractKeywords,
  fnv1a,
  escapeXml,
  TOPICS,
  MOTIFS,
  motifs,
  RATIOS,
}