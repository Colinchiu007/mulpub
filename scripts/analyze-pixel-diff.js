#!/usr/bin/env node
/**
 * 像素 diff 分布分析（替代"肉眼看截图"判断视觉回归是否可接受）。
 *
 * 为什么需要它：本项目的既有教训是「两张 PNG 仅差 127 字节，像素差异却有 9.41%」
 * （见 AGENTS.md QM-2 像素门禁排红模板第 ④ 条）—— 文件大小和肉眼都不可靠。
 * 视觉回归报 N% 时，真正要回答的是：**差异铺在哪儿**。
 *
 * 判读口径：
 *   · 差异集中在少数连续行带 ⇒ 局部改动，符合"我改了某一块"的预期
 *   · 差异铺满全图（覆盖高度 > 70%）⇒ 全局污染，多半是字体/主题类副作用，需排查
 *   · 大量 1px 行带 ⇒ 边框/分隔线位置偏移，通常伴随布局位移
 *
 * 用法：node scripts/analyze-pixel-diff.js <diff.png> [阈值百分比]
 * 依赖：pngjs（仓库根 node_modules，node-linker=hoisted）
 */
'use strict'

const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const { PNG } = require(path.join(root, 'node_modules', 'pngjs'))

const file = process.argv[2]
const rowThresholdPct = Number(process.argv[3] || 5)

if (!file) {
  console.error('用法: node scripts/analyze-pixel-diff.js <diff.png> [单行差异阈值%]')
  process.exit(2)
}
if (!fs.existsSync(file)) {
  console.error('找不到文件: ' + file)
  process.exit(2)
}

const png = PNG.sync.read(fs.readFileSync(file))
const { width: w, height: h, data } = png

/** pixel-diff 惯例：差异像素被标成高饱和色（红/品红等），未变区域保持灰阶或原样。 */
function isMarked (r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b) > 40
}

const step = 2 // 横向采样：够用且快一倍
const sampledPerRow = Math.ceil(w / step)
const rowCounts = new Array(h).fill(0)

for (let y = 0; y < h; y++) {
  let c = 0
  for (let x = 0; x < w; x += step) {
    const i = (w * y + x) << 2
    if (isMarked(data[i], data[i + 1], data[i + 2])) c++
  }
  rowCounts[y] = c
}

const total = rowCounts.reduce((s, c) => s + c, 0)
const pct = (total / (h * sampledPerRow)) * 100
console.log(`diff 图: ${path.basename(file)} (${w}x${h})`)
console.log(`差异像素占比: ${pct.toFixed(2)}%`)

// 找差异行带
const threshold = sampledPerRow * (rowThresholdPct / 100)
const bands = []
let start = null
for (let y = 0; y < h; y++) {
  const hot = rowCounts[y] > threshold
  if (hot && start === null) start = y
  else if (!hot && start !== null) { bands.push([start, y - 1]); start = null }
}
if (start !== null) bands.push([start, h - 1])

console.log(`\n差异行带 ${bands.length} 段（单行差异 > ${rowThresholdPct}%）:`)
for (const [s, e] of bands) {
  const seg = rowCounts.slice(s, e + 1).reduce((a, b) => a + b, 0)
  const segPct = (seg / ((e - s + 1) * sampledPerRow)) * 100
  console.log(`  y ${String(s).padStart(4)}-${String(e).padStart(4)} (高 ${String(e - s + 1).padStart(3)}px)  ${segPct.toFixed(1)}%`)
}

const covered = bands.reduce((s, [a, b]) => s + (b - a + 1), 0)
const coverPct = (covered / h) * 100
console.log(`\n差异覆盖高度: ${covered}px / ${h}px = ${coverPct.toFixed(1)}%`)
console.log(coverPct > 70
  ? '⚠ 判读：差异铺满全图 —— 疑似字体/主题类全局污染，需排查'
  : '✓ 判读：差异集中在局部行带 —— 符合局部改动预期')
