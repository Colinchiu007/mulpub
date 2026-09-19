#!/usr/bin/env node
/**
 * check-vue-style-parse.js — Vue 单文件组件样式块可解析门禁（CI Gate 15）
 *
 * 拦什么：
 * 「本地测试全绿、CI 构建却失败」的样式语法错误。典型事故：CSS 块注释里写了
 * 形如 `--color-xxx-*` 紧跟斜杠的写法，其中的星号加斜杠会**提前闭合注释**，
 * 后续注释文字被 postcss 当作 CSS 解析 → vite build 报 `Unknown word xxx`，而 vitest 单测
 * （不编译 style 块）完全不受影响，本地无法发现。本项目已因此连续三次构建变红
 * （ViralAnalysis #1962、Collection 修复提交、Intelligence #2003）。
 *
 * 校验方式（与 vite 的 @vitejs/plugin-vue 同路径）：
 * 1. 用 @vue/compiler-sfc parse 出每个 .vue 的 style 块；
 * 2. 用 postcss 严格解析每个 style 块内容（含 <style scoped> 与 lang.css）；
 * 3. 任一解析失败即输出文件、行号与错误原因并 exit 1。
 *
 * 用法：
 *   node .github/scripts/check-vue-style-parse.js            # 默认门禁
 *   node .github/scripts/check-vue-style-parse.js --json     # JSON 明细
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const SCAN_DIRS = [
  path.join(ROOT, 'apps', 'desktop', 'src'),
  path.join(ROOT, 'ops-center', 'frontend', 'src'),
]

/** 延迟 require：依赖缺失时按失败处理（宁可红，不可静默放行） */
function loadDeps () {
  const base = path.join(ROOT, 'node_modules')
  const sfc = require(path.join(base, '@vue', 'compiler-sfc'))
  const postcss = require(path.join(base, 'postcss'))
  return { sfc, postcss }
}

function parseArgs (args) {
  const opts = { json: false }
  for (const a of args) if (a === '--json') opts.json = true
  return opts
}

function listVueFiles (dir, out) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue
      listVueFiles(full, out)
    } else if (e.name.endsWith('.vue')) {
      out.push(full)
    }
  }
  return out
}

function main () {
  const opts = parseArgs(process.argv.slice(2))
  let deps
  try {
    deps = loadDeps()
  } catch (err) {
    process.stdout.write(`[vue-style-parse] FAIL：无法加载 @vue/compiler-sfc / postcss：${err.message}\n`)
    process.exit(1)
    return
  }

  const files = SCAN_DIRS.flatMap((d) => listVueFiles(d, []))
  const failures = []
  let styleBlocks = 0

  for (const file of files) {
    let source = ''
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    let descriptor
    try {
      descriptor = deps.sfc.parse(source, { filename: file }).descriptor
    } catch (err) {
      failures.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), error: `SFC 解析失败：${err.message}` })
      continue
    }
    for (const block of descriptor.styles || []) {
      styleBlocks++
      try {
        deps.postcss.parse(block.content, { from: file })
      } catch (err) {
        failures.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          error: String(err.message).split('\n')[0],
        })
      }
    }
  }

  const pass = failures.length === 0
  if (opts.json) {
    process.stdout.write(JSON.stringify({ files: files.length, styleBlocks, pass, failures }, null, 2) + '\n')
  } else {
    process.stdout.write(`[vue-style-parse] 扫描 ${files.length} 个 .vue / ${styleBlocks} 个样式块\n`)
    for (const f of failures) process.stdout.write(`[vue-style-parse] FAIL：${f.file} → ${f.error}\n`)
    process.stdout.write(pass ? '[vue-style-parse] PASS\n' : '[vue-style-parse] 失败：样式块存在语法错误（常见原因：块注释内出现 */ 提前闭合）\n')
  }
  process.exit(pass ? 0 : 1)
}

if (require.main === module) main()
module.exports = { parseArgs }
