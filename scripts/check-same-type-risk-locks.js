#!/usr/bin/env node
/**
 * check-same-type-risk-locks.js — 跑「竞品缺陷同型风险」四条静态锁（见
 * `scripts/lib/same-type-risk-locks.js` 与
 * `01-docs/research/competitor-reverse-2026-10-13/derived/竞品缺陷同型风险清单.md`）。
 *
 * 用法：node scripts/check-same-type-risk-locks.js [--root <仓库根>] [--json]
 * 退出码：0 = 无发现；1 = 有发现（逐条打印）；2 = 参数错误。
 *
 * ⚠ 只读：不写任何文件。扫描面 = `apps/**`、`packages/**` 下的 `.js/.cjs/.mjs/.ts/.vue`
 *   （跳过 `node_modules`、`dist*`、`**​/__tests__/**` 之外无特权；测试文件也扫 —— 测试里的
 *   无界循环同样会挂 CI，只是失败方式更隐蔽）。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { scanAll } = require('./lib/same-type-risk-locks')

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', '.git', 'coverage', '.playwright-browsers'])
const EXTS = new Set(['.js', '.cjs', '.mjs', '.ts', '.vue'])
const SCAN_ROOTS = ['apps', 'packages']

function parseArgs (argv) {
  const o = { root: path.resolve(__dirname, '..'), json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') o.root = path.resolve(argv[++i])
    else if (a === '--json') o.json = true
    else { console.error('未知参数: ' + a); process.exit(2) }
  }
  return o
}

function walk (dir, out) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(full, out)
    } else if (e.isFile() && EXTS.has(path.extname(e.name))) {
      out.push(full)
    }
  }
}

function collectSources (root) {
  const files = []
  for (const r of SCAN_ROOTS) walk(path.join(root, r), files)
  const sources = []
  for (const f of files) {
    let text
    try { text = fs.readFileSync(f, 'utf8') } catch { continue }
    sources.push({ path: path.relative(root, f).split(path.sep).join('/'), text })
  }
  return sources
}

function main () {
  const o = parseArgs(process.argv.slice(2))
  const sources = collectSources(o.root)
  const result = scanAll(sources)

  if (o.json) {
    console.log(JSON.stringify({ ok: result.ok, stats: result.stats, findings: result.findings }, null, 2))
    process.exit(result.ok ? 0 : 1)
  }

  console.log('[same-type-risk] 扫描 ' + sources.length + ' 个文件')
  console.log('[same-type-risk] L1 字符类回调=' + result.stats.l1.filesWithCharClassCallback +
    ' 映射表=' + result.stats.l1.mapsFound +
    ' ｜ L2 while(true)=' + result.stats.l2.loops +
    ' ｜ L3 catch 块=' + result.stats.l3.catchBlocks +
    ' ｜ L4 含 setInterval 文件=' + result.stats.l4.filesWithInterval)

  if (result.ok) {
    console.log('[same-type-risk] PASS（四条锁全部通过）')
    process.exit(0)
  }

  console.log('[same-type-risk] FAIL：' + result.findings.length + ' 条发现')
  for (const f of result.findings) {
    console.log('  - [' + f.rule + '] ' + f.path + ' :: ' + f.detail)
  }
  process.exit(1)
}

if (require.main === module) main()

module.exports = { collectSources, parseArgs, SKIP_DIRS, EXTS }
