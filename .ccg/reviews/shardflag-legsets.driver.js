'use strict'
/**
 * 两腿文件集合对照原件（change: desktop-shard-flag，2026-10-11）——把"各跑全量"从**计数**升级为**集合**。
 *
 * 起因：外部评审指出"两腿 Test Files 汇总逐字相同 ⇒ 各跑全量"这句是过度声明——
 * 计数相同理论上还可由"两腿恰好分到同一批文件"解释。真正的判据是**文件名集合**：
 * 先剥 ANSI（GitHub 日志原文带 \u001b[32m），再只认 vitest verbose reporter 的逐条用例行，
 * 取每腿实际枚举到的测试文件名集合，比交集与两侧独有项。
 *
 * 跑法（两份作业日志先落地）：
 *   gh api --allow-escape-sequences repos/<owner>/<repo>/actions/jobs/<jobId>/logs > job-<jobId>.log
 *   node .ccg/reviews/shardflag-legsets.driver.js <log1> <log2> [<log3> ...]
 * 抓不到任何 reporter 行即抛错（探针失明不得被读成"集合相同"）。
 */
const fs = require('fs')

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const MARK = /^\S+Z\s*(?:✓|✗|×|❯|↓|stdout\s*\||stderr\s*\|)/
const NAME = /([\w.\-/\\]+?\.(?:test|spec)\.(?:js|mjs|ts|tsx|jsx))/

function leg (p) {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
  const set = new Set()
  let reporterLines = 0
  for (const raw of lines) {
    const line = raw.replace(ANSI, '')
    if (!MARK.test(line)) continue
    const m = NAME.exec(line)
    if (!m) continue
    reporterLines++
    set.add(m[1].split('\\').join('/'))
  }
  return { set, reporterLines }
}

const paths = process.argv.slice(2).filter((p) => p.endsWith('.log'))
if (paths.length < 2) throw new Error('USAGE: node shardflag-legsets.driver.js <joblog1> <joblog2> [...]（至少两份日志）')
const legs = paths.map((p) => ({ p, ...leg(p) }))
for (const l of legs) {
  console.log('LEG=' + l.p + ' reporter_lines=' + l.reporterLines + ' distinct_test_files=' + l.set.size)
  if (l.set.size === 0) throw new Error('PROBE_EMPTY：' + l.p + ' 一条 reporter 行都没抓到，探针失明，不得据此下结论')
}
const [x, y] = legs
const onlyX = [...x.set].filter((f) => !y.set.has(f))
const onlyY = [...y.set].filter((f) => !x.set.has(f))
const both = [...x.set].filter((f) => y.set.has(f))
console.log('INTERSECTION=' + both.length)
console.log('ONLY_IN_FIRST=' + onlyX.length + (onlyX.length ? ' e.g. ' + onlyX.slice(0, 5).join(' , ') : ''))
console.log('ONLY_IN_SECOND=' + onlyY.length + (onlyY.length ? ' e.g. ' + onlyY.slice(0, 5).join(' , ') : ''))
console.log(onlyX.length === 0 && onlyY.length === 0
  ? 'VERDICT=两侧独有项均为 0 ⇒ 两腿跑的是同一批文件（集合级证据，不是计数巧合）'
  : 'VERDICT=两侧存在独有项 ⇒ 分片确有分开（若这是修复后的 run，这就是分片生效的证据）')
console.log('NOTE: distinct_test_files 只统计日志里**实际枚举到**的文件名；与 vitest 自报的 Test Files 总数可能相差' +
  '（汇总行本身不含文件名、被跳过的文件不逐条打印），因此本探针的判据是"两侧独有项是否为 0"，不是"数量等于某值"。')
