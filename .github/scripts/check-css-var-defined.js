#!/usr/bin/env node
/**
 * check-css-var-defined.js — 未定义 CSS 变量引用扫描（CI Gate 15c）
 *
 * 拦什么：
 * 样式里写了 var(--x) 且无 fallback，但 --x 在整个前端源码里从未定义。
 * 后果：未定义变量会让整条声明失效（CSS 规范），而不是回退到默认值。
 * 典型事故：PR #2075 数据看板引用了从未定义的 --shadow-sm/--cream-surface，
 * 导致白卡 box-shadow / 迷你卡背景整条作废 → 白卡白底「渲染隐形」；
 * 单测（vitest 不注入 SFC 样式）与 headless 截图（读的是同一份坏样式）都拦不住，
 * 2026-09-21 由 Dashboard 源码守卫（Dashboard.style-guard.test.js）在源码层锁定，
 * 本门禁把同类「引用未定义变量」的防护从单文件推广到全前端源码。
 *
 * 校验规则（对齐 check-color-literals / check-font-size-scale 基线口径）：
 * 1. 按 app 分组扫描（apps/desktop/src 与 ops-center/frontend/src 各自成集），
 *    定义集 = 组内所有 .vue/.css/.js/.ts 里出现的自定义属性写入：
 *      - CSS 声明   --x: ...
 *      - JS 动态写入 setProperty('--x', ...) 与对象键 '--x': ...
 *    引用集 = .css/.vue 中无 fallback 的 var(--x)（带 fallback 的 var(--x, ...) 不拦）。
 * 2. 前缀白名单（--el-* 等由 UI 库运行时提供）不计未定义。
 * 3. 未定义命中总数 <= 基线 cssVarUndefined（只降不升）；新增即 exit 1。
 * 4. --update-baseline 重写基线（仅供清零批次使用）。
 *
 * 用法：
 *   node .github/scripts/check-css-var-defined.js
 *   node .github/scripts/check-css-var-defined.js --json
 *   node .github/scripts/check-css-var-defined.js --update-baseline
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const BASELINE_FILE = path.join(__dirname, 'frontend-consistency-baseline.json')
const APP_SRC_DIRS = [
  path.join(ROOT, 'apps', 'desktop', 'src'),
  path.join(ROOT, 'ops-center', 'frontend', 'src'),
]
// 由 UI 库/浏览器运行时提供的变量，静态源码不会定义，视为已定义。
const WHITELIST_PREFIXES = ['--el-']

const DEF_DECL_RE = /(-{2}[a-z][a-z0-9-]*)\s*:/gi
const DEF_SETPROP_RE = /setProperty\(\s*['"](\-{2}[^'"]+)['"]/gi
const DEF_OBJKEY_RE = /['"](\-{2}[a-z0-9-]+)['"]\s*:/gi
const REF_RE = /var\(\s*(\-{2}[a-z0-9-]+)\s*\)/gi

function parseArgs (args) {
  const opts = { json: false, updateBaseline: false }
  for (const a of args) {
    if (a === '--json') opts.json = true
    if (a === '--update-baseline') opts.updateBaseline = true
  }
  return opts
}

function walk (dir, out) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      walk(full, out)
    } else if (/\.(vue|css|js|ts)$/i.test(e.name) && !/\.test\.(js|ts)$/i.test(e.name)) {
      out.push(full)
    }
  }
  return out
}

function collect (re, line) {
  const names = []
  re.lastIndex = 0
  let m
  while ((m = re.exec(line)) !== null) names.push(m[1].toLowerCase())
  return names
}

// 收集一个 app 组内所有「定义」的变量名（小写）
function collectDefined (files) {
  const defined = new Set()
  for (const file of files) {
    let content = ''
    try { content = fs.readFileSync(file, 'utf8') } catch { continue }
    for (const line of content.split(/\r?\n/)) {
      for (const n of collect(DEF_DECL_RE, line)) defined.add(n)
      for (const n of collect(DEF_SETPROP_RE, line)) defined.add(n)
      for (const n of collect(DEF_OBJKEY_RE, line)) defined.add(n)
    }
  }
  return defined
}

// 扫描一个 app 组内所有无 fallback 的 var(--x) 引用，返回未定义命中
function collectUndefined (files, defined) {
  const hits = []
  for (const file of files) {
    if (!/\.(vue|css)$/i.test(file)) continue
    let content = ''
    try { content = fs.readFileSync(file, 'utf8') } catch { continue }
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      for (const name of collect(REF_RE, lines[i])) {
        if (defined.has(name)) continue
        if (WHITELIST_PREFIXES.some((p) => name.startsWith(p))) continue
        hits.push({ file: rel, line: i + 1, name })
      }
    }
  }
  return hits
}

function evaluate (actual, allowed) {
  const failures = []
  if (actual > allowed) {
    failures.push(
      `未定义 CSS 变量引用超出基线：当前 ${actual} 处 > 基线 ${allowed} 处（新增 ${actual - allowed} 处）。` +
        `var(--x) 无 fallback 且 --x 从未定义会使整条声明失效（PR #2075 看板白卡隐形原型）。` +
        `请在 src/styles/tokens.css 定义该 token，或改用已存在的语义变量，或为 var() 补 fallback。`,
    )
  }
  return { actual, allowed, pass: failures.length === 0, failures }
}

function run () {
  const allHits = []
  for (const appDir of APP_SRC_DIRS) {
    const files = walk(appDir, [])
    const defined = collectDefined(files)
    allHits.push(...collectUndefined(files, defined))
  }
  return allHits
}

function main () {
  const opts = parseArgs(process.argv.slice(2))
  const hits = run()
  const actual = hits.length
  let baseline = {}
  try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) } catch { baseline = {} }
  const allowed = typeof baseline.cssVarUndefined === 'number' ? baseline.cssVarUndefined : actual

  if (opts.updateBaseline) {
    baseline.cssVarUndefined = actual
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n')
    process.stdout.write(`[css-var-defined] baseline updated: cssVarUndefined = ${actual}\n`)
    process.exit(0)
  }

  const report = Object.assign({}, evaluate(actual, allowed), { hits })
  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(`[css-var-defined] 未定义 CSS 变量（无 fallback）：当前 ${actual} / 基线 ${allowed}\n`)
    for (const h of report.hits) process.stdout.write(`[css-var-defined] UNDEF：${h.file}:${h.line} -> ${h.name}\n`)
    for (const f of report.failures) process.stdout.write(`[css-var-defined] FAIL：${f}\n`)
    if (report.pass) process.stdout.write('[css-var-defined] PASS\n')
  }
  process.exit(report.pass ? 0 : 1)
}

if (require.main === module) main()
module.exports = { DEF_DECL_RE, DEF_SETPROP_RE, DEF_OBJKEY_RE, REF_RE, WHITELIST_PREFIXES, parseArgs, collect, collectDefined, collectUndefined, evaluate }