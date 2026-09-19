#!/usr/bin/env node
/**
 * check-font-size-scale.js —— Gate 16：字号七档门禁（T1-6）
 *
 * 目标：消灭 12/13/14px 摇摆（全库 806 处 font-size 字面量），统一走 tokens.css
 * 七档槽（--font-size-xs/sm/base/md/lg/xl/xxl）。
 *
 * 规则：
 * 1. .vue / .css 内禁止出现 font-size 字面量（px/rem），必须用 var(--font-size-*)。
 *    例外：tokens.css 自身（定义处）。
 * 2. 允许的七档 token：xs(12) sm(13) base(15) md(17) lg(20) xl(24) xxl(32)。
 *
 * 渐进策略：本门禁先以「白名单基线」模式运行——基线文件记录各文件当前字面量
 * 数量，只允许下降不允许上升（与 debt-budget 同思路）；归零后切换为硬禁。
 *
 * 用法：
 *   node .github/scripts/check-font-size-scale.js            # 检查（基线对比）
 *   node .github/scripts/check-font-size-scale.js --update   # 更新基线（需审查 diff）
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const SCAN_DIRS = [
  path.join(ROOT, 'apps/desktop/src'),
  path.join(ROOT, 'ops-center/frontend/src'),
]
const BASELINE = path.join(__dirname, 'font-size-baseline.json')
const TOKENS_FILE = path.join(ROOT, 'apps/desktop/src/styles/tokens.css')

// 允许的七档 token（与 tokens.css 字号阶梯一致）
const ALLOWED_TOKENS = [
  '--font-size-xs',
  '--font-size-sm',
  '--font-size-base',
  '--font-size-md',
  '--font-size-lg',
  '--font-size-xl',
  '--font-size-xxl',
]

const LITERAL_RE = /font-size\s*:\s*([0-9.]+(?:px|rem))\b/gi

function walk (dir, out) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      walk(p, out)
    } else if (/\.(vue|css)$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

function scan () {
  const counts = {}
  const samples = {}
  for (const dir of SCAN_DIRS) {
    for (const f of walk(dir, [])) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/')
      if (rel.endsWith('styles/tokens.css')) continue // 定义处豁免
      const src = fs.readFileSync(f, 'utf8')
      let n = 0
      let m
      const hits = []
      LITERAL_RE.lastIndex = 0
      while ((m = LITERAL_RE.exec(src)) !== null) {
        n++
        if (hits.length < 3) hits.push(m[1])
      }
      if (n > 0) {
        counts[rel] = n
        samples[rel] = hits
      }
    }
  }
  return { counts, samples }
}

function main () {
  const update = process.argv.includes('--update')
  // 校验 tokens.css 七档齐全（fail-closed：槽缺失即失败）
  const tokensSrc = fs.readFileSync(TOKENS_FILE, 'utf8')
  const missing = ALLOWED_TOKENS.filter((t) => !tokensSrc.includes(t + ':'))
  if (missing.length > 0) {
    console.error(`[font-size] tokens.css 缺少字号槽：${missing.join(', ')}`)
    process.exit(1)
  }

  const { counts, samples } = scan()
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  if (update) {
    fs.writeFileSync(BASELINE, JSON.stringify({ counts, total, updatedAt: new Date().toISOString() }, null, 2) + '\n')
    console.log(`[font-size] 基线已更新：${total} 处字面量 / ${Object.keys(counts).length} 文件`)
    process.exit(0)
  }

  if (!fs.existsSync(BASELINE)) {
    console.error(`[font-size] 基线不存在，先运行 --update 生成并审查`)
    process.exit(1)
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  let regressions = 0
  const lines = []
  for (const [f, n] of Object.entries(counts)) {
    const b = base.counts[f] || 0
    if (n > b) {
      regressions += n - b
      lines.push(`  ↑ ${f}: ${n} > 基线 ${b}（样例 ${samples[f].join('/')}）`)
    }
  }
  const removed = Object.entries(base.counts).reduce((a, [f, b]) => a + Math.max(0, b - (counts[f] || 0)), 0)

  if (regressions > 0) {
    console.error(`[font-size] FAIL：${regressions} 处新增 font-size 字面量（应使用 var(--font-size-*)）`)
    lines.forEach((l) => console.error(l))
    process.exit(1)
  }
  console.log(`[font-size] PASS（当前 ${total} / 基线 ${base.total}，本轮清理 ${removed} 处；七档 token 走 var()）`)
}

main()
