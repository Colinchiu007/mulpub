#!/usr/bin/env node
/**
 * check-mask-coverage.js — 掩码覆盖 A/B 的 CLI 入口（2026-10-18）
 *
 * 用法：
 *   node scripts/check-mask-coverage.js                      # 与 origin/main 对比
 *   node scripts/check-mask-coverage.js --base HEAD~1         # 与上一提交对比
 *   node scripts/check-mask-coverage.js --limit 20 --json
 *
 * 退出码：
 *   0 = 无回归（可见字符减少的文件数 = 0，且两实现都等长）
 *   1 = 存在回归或有文件等长性失败 —— **不许合入**，先解释为什么某些文件变得更不可见
 *   2 = 自身故障（git 取不到 baseline / baseline 不是可用的 maskNonCode）
 *
 * ⚠ 安全边界（CCG 深度审查 i1）：`--base` 指向的 ref 里那段 `code-mask.js` 会被 **require 执行**。
 * 只对可信 ref 使用（`origin/main` / `HEAD~N` / 自己刚提交的分支），不要指向来源不明的分支或标签。
 *
 * 判据纪律：改动 `scripts/lib/code-mask.js` 的 PR 必须跑本判据并附读数。
 * 「可见字符减少 0」是唯一可接受的形态；增加说明修复生效（例如补上了某种词法形态）。
 * 见 `01-docs/learnings.md` 的「掩码/解析器类判据必须先用 A/B 证明能看见」。
 */

'use strict'

const path = require('node:path')
const ab = require('./lib/mask-coverage-ab')

function arg (name, fallback) {
  const i = process.argv.indexOf('--' + name)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}

function main () {
  const root = path.resolve(__dirname, '..')
  const base = typeof arg('base', 'origin/main') === 'string' ? arg('base', 'origin/main') : 'origin/main'
  const limit = Number(arg('limit', 10)) || 10
  const asJson = process.argv.includes('--json')

  let baselineFn
  try {
    baselineFn = ab.loadMaskFromGit(root, base)
  } catch (e) {
    console.error('[mask-coverage] 自身故障: ' + e.message)
    return 2
  }
  const candidateFn = require(path.join(root, 'scripts', 'lib', 'code-mask.js')).maskNonCode

  const r = ab.compareCoverage({ root, baseline: baselineFn, candidate: candidateFn })

  if (asJson) {
    console.log(JSON.stringify(r, null, 2))
  } else {
    console.log(`[mask-coverage] base=${base} 扫描 ${r.scan} 文件`)
    console.log(`[mask-coverage] 可见增加=${r.increased.length} 基本不变=${r.same} 可见减少=${r.decreased.length} 等长性失败=${r.unequal.length}`)
    if (r.increased.length) {
      console.log(`[mask-coverage] 增益最大 ${Math.min(limit, r.increased.length)} 个：`)
      for (const x of r.increased.slice(0, limit)) {
        const mult = x.ratio == null ? '∞' : ('×' + x.ratio)
        console.log(`  ${mult.padStart(7)}  ${x.file}  (${x.base} -> ${x.now})`)
      }
    }
    if (r.decreased.length) {
      console.log('[mask-coverage] 回归（可见字符减少，必须为 0）：')
      for (const x of r.decreased.slice(0, limit)) {
        const mult = x.ratio == null ? '0' : ('×' + x.ratio)
        console.log(`  ${mult.padStart(7)}  ${x.file}  (${x.base} -> ${x.now})`)
      }
    }
    for (const x of r.unequal.slice(0, limit)) {
      console.log(`  [等长性失败] ${x.file}  ${x.why}`)
    }
  }

  if (r.decreased.length > 0 || r.unequal.length > 0) {
    if (!asJson) {
      console.error('[mask-coverage] FAIL：存在回归或等长性失败，不许合入 —— 先解释为什么某些文件变得更不可见')
    }
    return 1
  }
  if (!asJson) console.log('[mask-coverage] PASS（无回归、等长性全部成立）')
  return 0
}

if (require.main === module) process.exit(main())

module.exports = { main }
