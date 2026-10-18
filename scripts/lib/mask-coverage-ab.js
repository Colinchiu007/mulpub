/**
 * mask-coverage-ab.js — 掩码覆盖 A/B 对比（2026-10-18，从两轮实测里固化）
 *
 * ## 为什么需要它
 * `scripts/lib/code-mask.js` 是八条结构锁的公共底座：**它错一次，八条锁一起瞎**，
 * 而「看不见」与「没有违规」在输出上完全同形（锁报 0 违规，可能只是它没看见）。
 *
 * 2026-10-18 修正则字面量缺陷时，正是靠「旧实现 vs 新实现逐文件比可见字符数」这个动作
 * 一次性拿到决定性证据（174 个文件增加 / 2916 不变 / **0 回归**），并当场揪出两个
 * 候选修复各自引入的回归（`url-collector.test.js` 14844→8010、`check-route-registry.js` 5622→4431）。
 * 那次对比是临时脚本（写在 `%TEMP%` 里，用完即弃）—— 也就是说这条最有效的取证手段
 * 当时**只存在于一次会话的记忆里**。本文件把它固化成可重复动作：
 *
 *   node scripts/check-mask-coverage.js --base origin/main
 *
 * 任何改动 `maskNonCode` 的 PR 都应先跑它，并附上读数：
 * **可见字符减少（回归）必须为 0**，否则 rc=1。
 *
 * ## 口径
 * - 「可见字符」= 掩码文本里非空白字符数（`\n` 不掩，故只数非空白）
 * - 逐文件判：相对 baseline 增 >2% ⇒ `increased`；减 >2% ⇒ `decreased`（回归）；其余 `same`
 * - 只扫**源码面**（apps / packages / scripts / .github），跳过依赖、构建产物与本地归档
 * - 两种实现都必须**等长**（掩码的下标可跨文本复用），不等长直接判失败
 */

'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

/** 源码面扫描根（与八条锁的实际扫描对象一致）。 */
const SOURCE_ROOTS = ['apps', 'packages', 'scripts', '.github']
/** 目录级剪枝：依赖、构建产物、本地归档（`.agent_context` 未跟踪，见 check-unwired-tests 同款理由）。 */
const PRUNE_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'coverage', '.playwright-browsers', '.next', 'build', '.agent_context'])
const SOURCE_EXT = /\.(js|cjs|mjs|ts|vue)$/

/** 遍历源码面文件，返回绝对路径清单（不跟随链接）。 */
function listSourceFiles (root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (PRUNE_DIRS.has(e.name)) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (SOURCE_EXT.test(e.name)) out.push(abs)
    }
  }
  for (const sub of SOURCE_ROOTS) {
    const d = path.join(root, sub)
    if (fs.existsSync(d)) walk(d)
  }
  return out
}

/**
 * 从某个 git ref 取 `scripts/lib/code-mask.js` 并 require 成 maskFn。
 *
 * ⚠ **安全边界（CCG 深度审查 i1，2026-10-18）**：本函数会 `require()` **目标 ref 里的源码**，
 * 也就是**执行该 ref 的代码**。因此它只应对**可信 ref** 使用（`origin/main`、`HEAD~N`、自己刚提交的分支）。
 * 不要把 `--base` 指向来源不明的分支/标签 —— 那等于主动执行仓库里的任意代码。
 * CI 侧不受影响：`mask-coverage-ab.test.js` 只用**不存在的 ref** 验证报错路径，从不加载真实 ref 代码。
 *
 * @param {string} root 仓库根
 * @param {string} ref 例如 'origin/main'
 * @returns {(src: string, opts?: object) => string}
 */
function loadMaskFromGit (root, ref) {
  let src
  try {
    src = execFileSync('git', ['-C', root, 'show', `${ref}:scripts/lib/code-mask.js`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    throw new Error(`取不到 ${ref}:scripts/lib/code-mask.js（ref 不存在或该文件当时还没有）：${(e.stderr || e.message || '').toString().slice(0, 200)}`)
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mask-ab-'))
  const file = path.join(dir, 'baseline-code-mask.cjs')
  fs.writeFileSync(file, src, 'utf8')
  const mod = require(file)
  // 临时目录清理：失败**出声**而不是静默（CCG i4）。Windows 上文件可能被杀毒/索引短暂占用，
  // 残留目录本身无害，但"悄悄留垃圾"会让 os.tmpdir 慢慢变大而无从察觉。
  // 注意：不需要清 require.cache —— 每次 mkdtemp 出来的路径唯一，缓存键不会复用到旧模块。
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    process.emitWarning(`[mask-coverage-ab] 临时目录清理失败（可手动删除）：${dir} —— ${(e && e.message) || e}`)
  }
  if (typeof mod.maskNonCode !== 'function') {
    throw new Error(`${ref} 的 code-mask 未导出 maskNonCode，无法作为 baseline`)
  }
  return mod.maskNonCode
}

/** 可见字符数（非空白）。 */
function visibleCount (s) {
  return s.replace(/\s/g, '').length
}

/**
 * 逐文件比较两个掩码实现的覆盖。
 *
 * @param {object} opts
 * @param {string} opts.root 仓库根
 * @param {(src: string) => string} opts.baseline 旧实现
 * @param {(src: string) => string} opts.candidate 新实现
 * @param {string[]} [opts.files] 显式文件清单（默认遍历源码面）
 * @param {number} [opts.thresholdPct=2] 判定增/减的百分比阈值
 * @returns {{scan:number, increased:Array, same:number, decreased:Array, unequal:Array}}
 */
function compareCoverage (opts) {
  const root = opts.root
  const baseline = opts.baseline
  const candidate = opts.candidate
  const thresholdPct = opts.thresholdPct == null ? 2 : opts.thresholdPct
  const files = opts.files || listSourceFiles(root)

  const increased = []
  const decreased = []
  const unequal = []
  let same = 0
  for (const abs of files) {
    let src
    try {
      src = fs.readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const a = baseline(src)
    const b = candidate(src)
    // 等长性是掩码的硬约束（下标可跨文本复用）——任一实现不等长即是缺陷，单独归类
    if (a.length !== src.length || b.length !== src.length) {
      unequal.push({ file: path.relative(root, abs).replace(/\\/g, '/'), why: `等长性失败 baseline=${a.length} candidate=${b.length} src=${src.length}` })
      continue
    }
    const va = visibleCount(a)
    const vb = visibleCount(b)
    if (va === 0 && vb === 0) { same++; continue }
    const deltaPct = va === 0 ? Infinity : ((vb - va) / va) * 100
    const row = {
      file: path.relative(root, abs).replace(/\\/g, '/'),
      base: va,
      now: vb,
      ratio: va === 0 ? null : Number((vb / va).toFixed(1)),
    }
    if (deltaPct > thresholdPct) increased.push(row)
    else if (deltaPct < -thresholdPct) decreased.push(row)
    else same++
  }
  increased.sort((x, y) => (y.ratio || 0) - (x.ratio || 0))
  return { scan: files.length, increased, same, decreased, unequal }
}

module.exports = {
  SOURCE_ROOTS,
  PRUNE_DIRS,
  listSourceFiles,
  loadMaskFromGit,
  visibleCount,
  compareCoverage,
}
