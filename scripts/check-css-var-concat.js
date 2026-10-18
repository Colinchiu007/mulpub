#!/usr/bin/env node
/**
 * check-css-var-concat.js —— 结构性门禁：CSS 声明里 `var(--token)` 后黏十六进制字面量
 *
 * 动因（UX-AUDIT-2026-10-17 阶段 0.6 / audit-42 家族）：本仓实测有 4 处写成
 *   background: var(--color-bg-card)8f8;
 *   background: var(--surface)3e0;
 * 这种形态。它不是「颜色带 alpha」，而是**整条声明被 CSS 解析器判为非法并丢弃** ——
 * 于是规则长期是死代码，用户看不到任何背景，而既有 `check-css-var-defined.js` 只查
 * 「var() 引用的变量名有没有定义」，对 `var(已定义)8f8` 这种**尾巴多一截**的写法完全看不见。
 *
 * 判据（口径与三条约束）：
 *  1. 只测量**会被 CSS 解析器看到**的文本：`.css` 全文、`.vue` 的 `<style>` 块与
 *     `style="..."` 内联属性值。`.vue` 的 `<script>`/`<template>` 正文不进域 ——
 *     否则 `views/Intelligence.vue` 里那句「修复 .intel-tip 损坏的 var(--surface)3e0」
 *     的注释会被当违规（那是文档，不是缺陷）。
 *  2. 起始标签/属性值里的 `>` 会截断朴素正则（`ReferenceFinder.vue` 的
 *     `@mouseover="e => …"` 就是实例），所以属性抽取必须做**引号感知**扫描。
 *  3. 判据只做「token 之后黏了 hex 字面量」这一形状，不做颜色合法性判断、不清洗后放行。
 *
 * 退出码分档（不得混档，否则把「门禁瞎了」读成「有问题」/反之）：
 *   0 = 扫描完成且违规数 0
 *   1 = 发现违规
 *   2 = 判据自身故障（扫描根不存在 / 目录读不动）
 */
'use strict'

const fs = require('fs')
const path = require('path')

// var(--token) 之后紧跟 2-8 位 hex 字面量（`8f8` / `3e0` / `1f0` / 完整 6-8 位都算）。
// 刻意不含空格：`var(--x) 4px` 是合法写法，不该命中。
const BAD_SHAPE = /var\(\s*--[\w-]+\s*\)[0-9a-fA-F]{2,8}\b/g

const DEFAULT_ROOTS = ['apps/desktop/src', 'apps/desktop/electron']

function parseArgs (argv) {
  const opts = { roots: [], json: false, minFiles: 0 }
  for (const a of argv) {
    if (a.startsWith('--root=')) opts.roots.push(a.slice(7))
    else if (a === '--json') opts.json = true
    else if (a.startsWith('--min-files=')) opts.minFiles = Number(a.slice(12))
    else if (a.startsWith('--')) {
      throw new Error(`未知旗标 ${a}（参数被静默忽略等于把「没扫」读成「扫过且干净」）`)
    } else opts.roots.push(a)
  }
  if (opts.roots.length === 0) opts.roots = DEFAULT_ROOTS
  if (!Number.isFinite(opts.minFiles) || opts.minFiles < 0) {
    throw new Error(`--min-files 取值非法：${argv.find(a => a.startsWith('--min-files'))}`)
  }
  return opts
}

/** 去掉 CSS 注释（块注释会跨行），保留其余字节位置无关 */
function stripCssComments (text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/**
 * 从 .vue 抽出「CSS 解析器会看到」的文本段。
 * 两条都不能省：style 块（含多行）、style 内联属性（值里可含 `>` 之前的逗号等）。
 */
function extractCssRegions (source, file) {
  const regions = []
  const blockRe = /<style\b[^>]*>([\s\S]*?)<\/style>/g
  let m
  while ((m = blockRe.exec(source)) !== null) {
    regions.push({ start: m.index + m[0].indexOf(m[1]), text: m[1] })
  }
  // 内联 style 属性：引号感知地取到闭合引号，避免被值里的 `>` 截断
  let i = 0
  while (true) {
    const at = source.indexOf('style="', i)
    if (at === -1) break
    const valueStart = at + 'style="'.length
    const valueEnd = source.indexOf('"', valueStart)
    if (valueEnd === -1) {
      throw new Error(`${file}: 内联 style 属性的引号未闭合，判据无法定位该声明`)
    }
    regions.push({ start: valueStart, text: source.slice(valueStart, valueEnd) })
    i = valueEnd
  }
  return regions
}

function lineOf (whole, index) {
  let line = 1
  for (let k = 0; k < index; k += 1) if (whole[k] === '\n') line += 1
  return line
}

function walk (dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    throw new Error(`扫描根读不动：${dir} —— ${e.message}`)
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && (entry.name.endsWith('.vue') || entry.name.endsWith('.css'))) out.push(full)
  }
  return out
}

function scan (repoRoot, roots) {
  const violations = []
  const files = []
  for (const rel of roots) {
    const abs = path.resolve(repoRoot, rel)
    if (!fs.existsSync(abs)) throw new Error(`扫描根不存在：${rel}`)
    if (fs.statSync(abs).isFile()) files.push(abs)
    else walk(abs, files)
  }
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const regions = file.endsWith('.css') ? [{ start: 0, text: source }] : extractCssRegions(source, file)
    for (const region of regions) {
      const cleaned = stripCssComments(region.text)
      const re = new RegExp(BAD_SHAPE.source, 'g')
      let m
      while ((m = re.exec(cleaned)) !== null) {
        violations.push({
          file: path.relative(repoRoot, file).replace(/\\/g, '/'),
          line: lineOf(source, region.start + m.index),
          snippet: m[0],
        })
      }
    }
  }
  return { filesScanned: files.length, violations }
}

function main () {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`FAIL(parser): ${e.message}`)
    return 2
  }
  const repoRoot = process.env.MP_REPO_ROOT || process.cwd()
  let result
  try {
    result = scan(repoRoot, opts.roots)
  } catch (e) {
    console.error(`FAIL(scanner): ${e.message}`)
    return 2
  }
  // 反失明：扫描域塌陷（解析退化、路径写错）时，"0 违规"完全可能是"一个文件都没扫"
  if (result.filesScanned < opts.minFiles) {
    console.error(`FAIL(domain): files=${result.filesScanned} < min-files=${opts.minFiles} —— 判定域退化，不判绿`)
    return 2
  }
  if (opts.json) {
    console.log(JSON.stringify({
      judge: 'css-var-concat', files_scanned: result.filesScanned, violations: result.violations,
    }))
  } else {
    console.log(`[css-var-concat] files=${result.filesScanned} violations=${result.violations.length}`)
    for (const v of result.violations) console.log(`  ${v.file}:${v.line}  ${v.snippet}`)
  }
  return result.violations.length === 0 ? 0 : 1
}

if (require.main === module) process.exit(main())

module.exports = { scan, parseArgs, extractCssRegions, stripCssComments }
