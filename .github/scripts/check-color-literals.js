#!/usr/bin/env node
/**
 * check-color-literals.js — 历史品牌色字面量门禁（desktop-ui-consistency T1-1，L1）
 *
 * 拦什么：
 * 「四套 token 已收编进 tokens.css 后，代码里再手写历史品牌色」的回归。历史色
 * （品牌紫两种写法 / Element 默认蓝 / 旧主题蓝 / 粉色 secondary / Apple 蓝）在
 * T1-1 之后只允许出现在 tokens.css 的「历史槽位收编区」——那是它们唯一的合法居所，
 * 旧 token 文件与组件/视图一律禁止再写字面量。
 *
 * 校验规则：
 * 1. 扫描 apps/desktop/src 与 ops-center/frontend/src 下所有 .vue/.css，
 *    匹配历史色清单（大小写不敏感，含注释行——注释里也不许再提色值，防止复辟）。
 * 2. tokens.css 的收编槽位区是唯一豁免文件（历史值只在那里出现一次）。
 * 3. 命中总数 ≤ 基线 frontend-consistency-baseline.json 的 colorLiterals
 *    （存量 172 处由后续批次逐文件清零，基线只降不升）；超出基线 → exit 1。
 * 4. --update-baseline 可重写基线（仅供清理批次使用，PR diff 里必须能看到基线下降）。
 *
 * 用法：
 *   node .github/scripts/check-color-literals.js                    # 默认门禁
 *   node .github/scripts/check-color-literals.js --json             # JSON 明细
 *   node .github/scripts/check-color-literals.js --update-baseline  # 重写基线
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const BASELINE_FILE = path.join(__dirname, 'frontend-consistency-baseline.json')
const TOKENS_FILE = path.join(ROOT, 'apps', 'desktop', 'src', 'styles', 'tokens.css')
const SCAN_DIRS = [
  path.join(ROOT, 'apps', 'desktop', 'src'),
  path.join(ROOT, 'ops-center', 'frontend', 'src'),
]
const EXEMPT_FILES = new Set([path.resolve(TOKENS_FILE)])

/** 历史品牌色清单（大小写不敏感）。新槽位区之外出现即计数。 */
const HISTORY_COLORS = [
  '#5048e5', // 品牌紫（tokens.css 唯一合法）
  '#5149e8', // 品牌紫漂移变体
  '#409eff', // Element Plus 默认蓝
  '#3a7be5', // 旧主题蓝
  '#007aff', // Apple 蓝
  '#f472b6', // cohere 粉色 secondary
]
const COLOR_RE = new RegExp(HISTORY_COLORS.join('|'), 'gi')

function parseArgs (args) {
  const opts = { json: false, updateBaseline: false }
  for (const a of args) {
    if (a === '--json') opts.json = true
    if (a === '--update-baseline') opts.updateBaseline = true
  }
  return opts
}

function listFiles (dir, out) {
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
      listFiles(full, out)
    } else if (/\.(vue|css)$/i.test(e.name)) {
      out.push(full)
    }
  }
  return out
}

function scan () {
  const files = SCAN_DIRS.flatMap((d) => listFiles(d, []))
  const hits = []
  for (const file of files) {
    if (EXEMPT_FILES.has(path.resolve(file))) continue
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(COLOR_RE)
      if (m) {
        hits.push({ file: rel, line: i + 1, colors: [...new Set(m.map((s) => s.toLowerCase()))] })
      }
    }
  }
  return hits
}

function readBaseline () {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function scanContent (rel, content, hits) {
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(COLOR_RE)
    if (m) {
      hits.push({ file: rel, line: i + 1, colors: [...new Set(m.map((s) => s.toLowerCase()))] })
    }
  }
  return hits
}

function evaluate (actual, allowed) {
  const failures = []
  if (actual > allowed) {
    failures.push(
      `历史品牌色字面量超出基线：当前 ${actual} 处 > 基线 ${allowed} 处（新增 ${actual - allowed} 处）。` +
        `请改用 src/styles/tokens.css 的语义变量（var(--color-*)）；` +
        `若确属清理批次（基线下降），运行 --update-baseline 并在 PR 中展示下降 diff。`,
    )
  }
  return { actual, allowed, pass: failures.length === 0, failures }
}

function main () {
  const opts = parseArgs(process.argv.slice(2))
  const hits = scan()
  const actual = hits.length
  const baseline = readBaseline()
  const allowed = typeof baseline.colorLiterals === 'number' ? baseline.colorLiterals : actual

  if (opts.updateBaseline) {
    baseline.colorLiterals = actual
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n')
    process.stdout.write(`[color-literals] baseline updated: colorLiterals = ${actual}\n`)
    process.exit(0)
  }

  const report = { ...evaluate(actual, allowed), hits }
  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(
      `[color-literals] 历史品牌色字面量：当前 ${actual} / 基线 ${allowed}（tokens.css 收编槽位区豁免）\n`,
    )
    for (const f of report.failures) process.stdout.write(`[color-literals] FAIL：${f}\n`)
    if (report.pass) process.stdout.write('[color-literals] PASS\n')
  }
  process.exit(report.pass ? 0 : 1)
}

if (require.main === module) main()
module.exports = { HISTORY_COLORS, COLOR_RE, parseArgs, scanContent, evaluate }

