'use strict'
/**
 * 入口链在临时仓库里要能跑起来的那组文件 —— **单一实现**，给所有"把 deep-review.sh 拷进临时仓
 * 再真跑一遍"的测试夹具共用（现存两位消费者：`deep-review-entry-rc.test.js`、
 * `deep-review-deep-deps.test.js` 里的 `deep-review-deps.test.js`）。
 *
 * 为什么要有这个文件（2026-10-24 两次红换来的，都是同一形状）：
 * ① 上游把闭环状态词从 `check-pr-exec-record.js` 搬进 `lib/exec-record-statuses.js`，
 *    而入口用例的闭包是**手抄数组** ⇒ 夹具少拷一个文件，CI 上六条入口用例一起红，
 *    唯一归因证据埋在被测子进程输出里（`Cannot find module './lib/exec-record-statuses'`）。
 * ② 本刀给入口加了轮次上限（新调用点 `lib/ccg-review-rounds.js` / `lib/ccg-delivery-digest.js`），
 *    **另一个**夹具（deps）没人提醒去长 ⇒ 三条既有用例红，而且入口把"CLI 跑不起来"
 *    读成"账本读不出"，给出一条与事实无关的处置建议。
 * 两份手抄清单结构上一定会漂 ⇒ 清单只留一份，并且**沿依赖边走出来**而不是靠人记得。
 *
 * 两条边都要走，缺一不可：
 * - `.js` 的相对 `require('./x')`（含**无 `.js` 后缀**的写法，实测漏过）；
 * - `.sh` 里 `node scripts/<x>.js` 的调用点——纯 require 图会整块丢掉 `lib/ccg-review-rounds.js`
 *   （它只被 bash 调），这不是设想，是当场探针报出来的。
 */
const fs = require('node:fs')
const path = require('node:path')

/** 入口链的**根**（不含传递依赖）。加新东西只有两种正当方式：新增真入口，或让下面两条边走到它。 */
const ENTRY_ROOTS = Object.freeze([
  'deep-review.sh',
  'ccg-review-writeback.js',
  'ccg-review-decider.js',
  'check-pr-exec-record.js',
  'classify-docs-only.js',
  'ccg-review-backends.list',
  'lib/ccg-backends.sh'
])

/**
 * 沿相对 require 求传递闭包。缺文件**不静默跳过**：收进 `unresolved`（连"是谁要求的"一起），
 * 由调用方决定怎么出声——"闭包算漏一个"读起来必须不像"这个分支不需要它"。
 */
function closureOf (scriptsRoot, roots, unresolved = []) {
  const seen = new Set()
  const queue = roots.slice()
  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    seen.add(rel)
    if (!rel.endsWith('.js')) continue
    const abs = path.join(scriptsRoot, rel)
    if (!fs.existsSync(abs)) { unresolved.push({ from: '(root)', rel }); continue }
    const src = fs.readFileSync(abs, 'utf8')
    const base = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel) + '/'
    for (const m of src.matchAll(/require\((['"])\.\/([^'"]+)\1\)/g)) {
      const target = base + m[2]
      const withJs = target.endsWith('.js') ? target : target + '.js'
      if (fs.existsSync(path.join(scriptsRoot, withJs))) queue.push(withJs)
      else if (fs.existsSync(path.join(scriptsRoot, target))) queue.push(target)
      else unresolved.push({ from: rel, rel: target })
    }
  }
  return [...seen].sort()
}

/** .sh 以 `node scripts/<x>.js` 形态调用的文件（require 图的结构盲区）。 */
function bashInvoked (scriptsRoot) {
  const sh = fs.readFileSync(path.join(scriptsRoot, 'deep-review.sh'), 'utf8')
  const out = []
  for (const m of sh.matchAll(/node [^\n]*?scripts\/([A-Za-z0-9_./-]+\.js)/g)) out.push(m[1])
  return [...new Set(out)]
}

/**
 * 完整闭包 + 反失明下界。返回 `{ files, unresolved, bashInvoked }`。
 * 下界守的是"扫描退化成一个都不剩"：那在产物上完全像"这个分支不需要那些脚本"。
 */
function entryClosure (scriptsRoot) {
  const unresolved = []
  const called = bashInvoked(scriptsRoot)
  const files = closureOf(scriptsRoot, ENTRY_ROOTS.concat(called), unresolved)
  if (!files.includes('deep-review.sh') || files.length < 6) {
    throw new Error(`入口闭包退化（files=${files.length} 项，bash 调用点 ${called.length} 个）：${JSON.stringify(files)}`)
  }
  return { files, unresolved, bashInvoked: called }
}

module.exports = { ENTRY_ROOTS, closureOf, bashInvoked, entryClosure }
