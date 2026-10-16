// @ts-check
/**
 * .cover-rasterize-worker.js — 封面 SVG → PNG 栅格化 worker（子进程）
 *
 * 为什么必须是独立子进程（2026-10-16 实测）：
 *   `FONTCONFIG_FILE` 是 **libfontconfig 在进程启动时读取**的环境变量。
 *   在同一进程内改 `process.env.FONTCONFIG_FILE` 后再调 sharp 完全无效 ——
 *   fontconfig 的单例已经用旧环境初始化过了。只有**新起的子进程**才会读到新值。
 *
 * 这是让「自包含中文字体」在 sharp/librsvg 链路真正生效的唯一方式：
 *   - sharp 的 `font` 选项无效（传目录/文件都试过）
 *   - SVG 经 sharp 栅格化不读 @font-face
 *   - 只有让 Pango 在启动时就看见自带字体目录才行
 *
 * 用法：node .cover-rasterize-worker.js --svg-file <path> --out <path>
 * 退出码：0 = 成功；非 0 = 失败（stderr 带原因）
 */
'use strict'

const fs = require('fs')

function parseArgs (argv) {
  const out = {}
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]
    const val = argv[i + 1]
    if (!key.startsWith('--')) continue
    out[key.slice(2)] = val
  }
  return out
}

;(async () => {
  const args = parseArgs(process.argv)
  const svgFile = args['svg-file']
  const outFile = args.out
  if (!svgFile || !outFile) {
    console.error('usage: --svg-file <path> --out <path>')
    process.exit(2)
  }

  const svg = fs.readFileSync(svgFile, 'utf8')
  if (!svg || svg.length === 0) {
    console.error('empty svg input')
    process.exit(3)
  }

  const sharp = require('sharp')
  await sharp(Buffer.from(svg)).png().toFile(outFile)

  if (!fs.existsSync(outFile)) {
    console.error('rasterize produced no file')
    process.exit(4)
  }
  const size = fs.statSync(outFile).size
  if (size === 0) {
    console.error('rasterize produced empty file')
    process.exit(5)
  }
  process.exit(0)
})().catch((e) => {
  console.error('rasterize failed: ' + (e && e.message))
  process.exit(1)
})
