// @ts-check
/**
 * font-resolver.js — 创作内容自包含中文字体解析（单一实现）
 *
 * 为什么需要这个模块（2026-10-16 实证）：
 *   ① **ffmpeg drawtext 对非 ASCII 路径静默失败**：`fontfile=` 指向的目录名或文件名
 *      任一含中文，渲染结果就是豆腐块（实测 PNG 5495 → 765 字节），**不报错、不进
 *      stderr、rc=0**。用户完全可能把应用装到 `D:\软件\社媒管家\`，届时自包含字体
 *      形同虚设。因此必须先落到纯 ASCII 路径。
 *   ② **Pango/librsvg（sharp）的字体匹配比 Chromium 严格**：CSS 字体栈在 Chromium
 *      里能靠 `local()` 兜底，在 sharp 里首选项落空就直接降级。
 *   ③ **各链自抄一份解析逻辑必然漂移**：字幕 / 水印 / 封面 / 占位图四条链都要同一判据。
 *
 * 契约（改动需同步 font-resolver.test.js）：
 *   - `fontFile` 一定是 ASCII 安全路径（ffmpeg filter 转义安全），否则返回 ''
 *   - 找不到字体绝不抛异常 —— 字体问题只影响字形，不该炸掉发布/合成链
 *   - `source` ∈ 'bundled' | 'system' | 'none'，供日志与排障观测
 *   - ASCII 副本落点稳定（tmpRoot 下固定名），命中已存在副本时不重复拷贝
 *
 * 优先级：自包含得意黑（bundled） > 系统 CJK 字体（system） > 无（none）
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

/** ASCII 副本目录名（os.tmpdir() 下）—— 必须是纯 ASCII，这是 ffmpeg 兼容性的前提 */
const ASCII_SAFE_DIR_NAME = 'mp-fonts'

/** ASCII 副本文件名 —— 与源文件名解耦，源文件名含中文也不影响 */
const BUNDLED_FONT_BASENAME = 'SmileySans-Oblique.otf'

/**
 * 自包含得意黑在仓库/产物中的已知位置（按优先级）：
 *   打包态：`<resourcesPath>/fonts/`（extraResources 的 `to:"fonts"` 落点）
 *   开发态：`apps/desktop/src/public/fonts/`（Vite publicDir）
 */
/**
 * 打包态字体候选：`<resourcesPath>/fonts/`。
 *
 * ⛔ **extraResources 的 `to` 是相对 `resources` 目录展开的，不是安装根。**
 * 2026-10-16 实测（打包产物现成，`win-unpacked/resources/fonts/` 里字体确实在）：
 * 曾写成 `path.dirname(process.resourcesPath)/fonts` ⇒ 推出 `<installRoot>/fonts/`，
 * 两个候选 `exists` 全 false，`resolveContentCjkFont()` 返回 **`source='system'`** ——
 * 即**安装后的应用永远不会用自带得意黑**，无 CJK 字体的机器上照样豆腐块。
 * 该缺陷让整个「自包含」特性在生产上完全失效，且首版测试因断言是条件式而静默跳过。
 */
function packagedFontCandidates () {
  const out = []
  try {
    if (process.resourcesPath) {
      out.push(path.join(process.resourcesPath, 'fonts', BUNDLED_FONT_BASENAME))
    }
  } catch (_) { /* 非 Electron 环境继续 */ }
  return out
}

/**
 * 开发态字体候选：仓库 `apps/desktop/src/public/fonts/`（Vite publicDir）。
 * `__dirname` = `apps/desktop/electron/services` ⇒ 上溯两级到 `apps/desktop`。
 */
function devFontCandidates () {
  try {
    const desktopDir = path.resolve(__dirname, '..', '..')
    return [path.join(desktopDir, 'src', 'public', 'fonts', BUNDLED_FONT_BASENAME)]
  } catch (_) {
    return []
  }
}

/** 全部自包含字体候选（打包态优先 —— 用户机器上只有那一份可用） */
function bundledFontCandidates () {
  return [...packagedFontCandidates(), ...devFontCandidates()]
}

/** Windows 系统 CJK 字体候选（按优先级）；非 win32 交给 fontconfig，不注入 */
const SYSTEM_FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\msyh.ttc',
  'C:\\Windows\\Fonts\\msyh.ttf',
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\simsun.ttc',
  'C:\\Windows\\Fonts\\msjh.ttc',
]

/**
 * 「非 ASCII 不安全」判定 —— 判据是**路径中是否出现非 ASCII 字符**，
 * 不是"含反斜杠"（Windows 路径必然含反斜杠，反斜杠本身无害，
 * 真正让 ffmpeg 静默降级的是非 ASCII 字符）。
 *
 * 实测（2026-10-16）：`fontfile=` 的目录名或文件名任一含中文 ⇒ PNG 5495 → 765 字节
 * （豆腐块），rc=0、stderr 干净。ASCII 目录 + ASCII 文件名则正常。
 */
function isAsciiSafe (p) {
  if (typeof p !== 'string' || p.length === 0) return false
  return /^[\x20-\x7E]+$/.test(p)
}

/** 把字体复制到 ASCII 安全路径；已存在则跳过（幂等）。失败返回 ''。 */
function copyToAsciiSafe (sourceFontPath, tmpRoot) {
  if (!sourceFontPath) return ''
  const src = String(sourceFontPath)
  // 注意：源路径**允许**含中文 —— 这正是要把它搬走的理由
  try {
    if (!fs.existsSync(src)) return ''
    const stat = fs.statSync(src)
    if (!stat.isFile() || stat.size === 0) return ''

    const destDir = path.join(tmpRoot, ASCII_SAFE_DIR_NAME)
    const dest = path.join(destDir, BUNDLED_FONT_BASENAME)
    if (!isAsciiSafe(dest)) return ''

    if (fs.existsSync(dest) && fs.statSync(dest).size === stat.size) {
      return dest // 命中已存在副本，跳过 1.9MB 拷贝
    }
    fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(src, dest)
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== stat.size) return ''
    return dest
  } catch (_) {
    return ''
  }
}

/**
 * 解析创作内容（字幕 / 水印 / 封面 / 占位图）用的 CJK 字体。
 *
 * @param {object} [opts]
 * @param {string} [opts.tmpRoot] ASCII 副本根目录，默认 os.tmpdir()
 * @param {string} [opts.bundledFontPath] 显式指定自包含字体源路径（测试/覆盖用）
 * @param {boolean} [opts.allowBundled=true] 是否允许使用自包含字体
 * @param {boolean} [opts.allowSystem=true] 是否允许回落到系统字体
 * @returns {{fontFile: string, source: 'bundled'|'system'|'none'}}
 */
function resolveContentCjkFont (opts = {}) {
  const {
    tmpRoot,
    bundledFontPath,
    allowBundled = true,
    allowSystem = true,
  } = opts

  const root = tmpRoot || os.tmpdir()

  // ① 自包含得意黑
  if (allowBundled) {
    let src = bundledFontPath
    if (!src) {
      for (const candidate of bundledFontCandidates()) {
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
            src = candidate
            break
          }
        } catch (_) { /* 继续下一个候选 */ }
      }
    }
    if (src) {
      const asciiSafe = copyToAsciiSafe(src, root)
      if (asciiSafe) return { fontFile: asciiSafe, source: 'bundled' }
      // 源存在但拷贝失败：不静默当成"没有字体"，继续尝试系统字体
    }
  }

  // ② 系统 CJK 字体（仅 Windows；非 win32 由 fontconfig 处理）
  if (allowSystem && process.platform === 'win32') {
    for (const candidate of SYSTEM_FONT_CANDIDATES) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
          if (isAsciiSafe(candidate)) {
            return { fontFile: candidate, source: 'system' }
          }
        }
      } catch (_) { /* 继续下一个候选 */ }
    }
  }

  // ③ 无可用字体
  return { fontFile: '', source: 'none' }
}

/**
 * 为 sharp（librsvg/Pango）构建可用的 fontconfig，使自带中文字体可被渲染。
 *
 * 为什么需要（2026-10-16 实测，四轮对照）：
 *   - sharp 的 `font` 选项传目录、传字体文件，**均无效** —— Pango 只认 fontconfig
 *     已注册的字体，`font` 选项在这套安装上被静默忽略。
 *   - SVG 经 sharp 栅格化时**不读 @font-face**，所以 CSS 里写 url() 也没用。
 *   - 唯一可行：给渲染进程注入 `FONTCONFIG_FILE`，把自带字体目录写进 <dir>。
 *     实测 sha 前后不同（66a901dc vs 85c1cc5c）⇒ 得意黑确实被采用，而非回落系统字体。
 *
 * 实现要点：
 *   - `<dir>` 必须是**目录**（传单个 .ttf/.otf 文件路径会被当成目录，静默失效）
 *   - 必须同时保留系统字体目录，否则西文字体一起丢
 *   - 配置文件本身写到 ASCII 路径（fontconfig 对非 ASCII 路径同样敏感）
 *
 * @param {string} [opts.tmpRoot] 配置文件根目录，默认 os.tmpdir()
 * @param {string} [opts.fontDir] 自带字体目录（含得意黑），默认解析自包含副本目录
 * @returns {{fontconfigFile: string, injected: boolean}}
 */
function buildFontconfigForSharp (opts = {}) {
  const tmpRoot = opts.tmpRoot || os.tmpdir()
  const fontDir = opts.fontDir
  // 只保留真正需要的一条：ASCII 安全的目录
  const dirs = []
  if (fontDir && isAsciiSafe(fontDir)) {
    try {
      if (fs.existsSync(fontDir) && fs.statSync(fontDir).isDirectory()) dirs.push(fontDir)
    } catch (_) { /* 忽略 */ }
  }
  if (dirs.length === 0) return { fontconfigFile: '', injected: false }

  // 系统字体目录也要进 <dir>，否则西文全部变豆腐块
  const systemDir = process.platform === 'win32' ? 'C:/Windows/Fonts' : '/usr/share/fonts'
  if (isAsciiSafe(systemDir)) dirs.unshift(systemDir)

  // ⚠️ 必须统一成正斜杠：fontconfig 的 <dir> 遇到反斜杠会报 "ambiguous path"
  // 并静默跳过该目录（2026-10-16 实测 V3 变体因此失败）。
  const toPosix = (p) => String(p).replace(/\\/g, '/')

  const confDir = path.join(tmpRoot, ASCII_SAFE_DIR_NAME)
  const confFile = path.join(confDir, 'fonts.conf')
  if (!isAsciiSafe(confFile)) return { fontconfigFile: '', injected: false }

  const cacheDir = path.join(confDir, 'fontconfig-cache')
  const body = dirs.map(d => `  <dir prefix="cwd">${toPosix(d)}</dir>`).join('\n')
    + `\n  <cachedir>${toPosix(cacheDir)}</cachedir>`

  try {
    fs.mkdirSync(confDir, { recursive: true })
    fs.writeFileSync(confFile, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n${body}\n</fontconfig>\n`)
    return { fontconfigFile: confFile, injected: true }
  } catch (_) {
    return { fontconfigFile: '', injected: false }
  }
}

module.exports = {
  resolveContentCjkFont,
  isAsciiSafe,
  ASCII_SAFE_DIR_NAME,
  BUNDLED_FONT_BASENAME,
  packagedFontCandidates,
  devFontCandidates,
  bundledFontCandidates,
  SYSTEM_FONT_CANDIDATES,
  buildFontconfigForSharp,
}
