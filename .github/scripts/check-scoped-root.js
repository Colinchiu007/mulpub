#!/usr/bin/env node
/**
 * check-scoped-root.js — scoped 样式块裸 :root 选择器门禁（CI Gate 15b）
 *
 * 拦什么：
 * Vue scoped 样式块中直接写 `:root {}`（或含 `:root` 的后代选择器）。
 * @vitejs/plugin-vue 会把 scoped 块的选择器编译为 `:root[data-v-xxx]`，
 * 而 data-v 属性只挂在组件内部元素上、html 根元素永远不带 → 该规则永不匹配，
 * 块内定义的 CSS 自定义属性静默失效。典型事故：PR #2075 数据看板「奶油·薰衣草」
 * token 全部未定义 → hero 卡片 linear-gradient 整条作废 → 白字白底隐形，
 * 单测与 headless 截图均无法发现（2026-09-21 由 PR #2114 修复为 :global(:root)）。
 *
 * 校验方式：
 * 1. 用 @vue/compiler-sfc 解析每个 .vue 的 style 块，只查 scoped 块；
 * 2. 用 postcss 解析块内容，遍历规则选择器，剥掉 :global(...) 包装后仍含
 *    `:root` / 裸 `html` / `body` 根选择器即失败（同样会被加 data-v 后缀而永不匹配）；
 * 3. 任一违规输出文件、行号与选择器并 exit 1。
 *
 * 用法：
 *   node .github/scripts/check-scoped-root.js            # 默认门禁
 *   node .github/scripts/check-scoped-root.js --json     # JSON 明细
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

/** 剥掉 :global(...) 包装后，判断单个选择器是否含会被 scoped 编译破坏的根选择器 */
function findRootPseudo (selector) {
  const stripped = selector.replace(/:global\([^)]*\)/g, ' ')
  const hits = []
  if (/:root\b/.test(stripped)) hits.push(':root')
  // 裸 html/body 作为起始（或独立组合符后的）类型选择器：编译后变 html[data-v-xxx] 同样永不匹配
  if (/(^|[\s>+~])html(?![\w-])/.test(stripped)) hits.push('html')
  if (/(^|[\s>+~])body(?![\w-])/.test(stripped)) hits.push('body')
  return hits
}

/** 核心检查：对单个 scoped 样式块内容返回违规列表（供门禁与自测共用） */
function checkScopedBlock (postcss, content, offsetLine = 0) {
  const violations = []
  let root
  try {
    root = postcss.parse(content)
  } catch {
    // 语法错误由 Gate 15（check-vue-style-parse）负责报告，这里不重复报
    return violations
  }
  root.walkRules((rule) => {
    // @keyframes 内的步骤选择器（0%/to）不可能含根选择器，跳过以减少遍历
    if (rule.parent && rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name || '')) return
    for (const sel of rule.selector.split(',')) {
      const hits = findRootPseudo(sel.trim())
      if (hits.length > 0) {
        violations.push({
          line: (rule.source && rule.source.start ? rule.source.start.line : 1) + offsetLine,
          selector: sel.trim(),
          hits,
        })
      }
    }
  })
  return violations
}

function main () {
  const opts = parseArgs(process.argv.slice(2))
  let deps
  try {
    deps = loadDeps()
  } catch (err) {
    process.stdout.write(`[scoped-root] FAIL：无法加载 @vue/compiler-sfc / postcss：${err.message}\n`)
    process.exit(1)
    return
  }

  const files = SCAN_DIRS.flatMap((d) => listVueFiles(d, []))
  const failures = []
  let scopedBlocks = 0

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
    } catch {
      continue // SFC 解析失败由 Gate 15 报告
    }
    for (const block of descriptor.styles || []) {
      if (!block.scoped) continue
      scopedBlocks++
      const offsetLine = block.start ? source.slice(0, block.start).split('\n').length - 1 : 0
      for (const v of checkScopedBlock(deps.postcss, block.content, offsetLine)) {
        failures.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          ...v,
          error: `scoped 样式块中的 ${v.hits.join('/')} 会被编译为 ${v.hits[0]}[data-v-xxx]，永不匹配根元素；请改用 :global(${v.hits[0]}) 或移到全局样式`,
        })
      }
    }
  }

  const pass = failures.length === 0
  if (opts.json) {
    process.stdout.write(JSON.stringify({ files: files.length, scopedBlocks, pass, failures }, null, 2) + '\n')
  } else {
    process.stdout.write(`[scoped-root] 扫描 ${files.length} 个 .vue / ${scopedBlocks} 个 scoped 样式块\n`)
    for (const f of failures) process.stdout.write(`[scoped-root] FAIL：${f.file}:${f.line} → ${f.selector}（${f.error}）\n`)
    process.stdout.write(pass ? '[scoped-root] PASS\n' : '[scoped-root] 失败：scoped 样式块存在裸根选择器（事故原型：PR #2075 看板 token 静默失效）\n')
  }
  process.exit(pass ? 0 : 1)
}

if (require.main === module) main()
module.exports = { checkScopedBlock, findRootPseudo }
