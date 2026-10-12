'use strict'
/**
 * 变异反证原件（change: desktop-shard-flag，2026-10-11）。
 *
 * 用途：证明 `scripts/check-desktop-shard-forwarding.js` / `.test.js` 的每条锁都在测它声称的东西，
 * 而不是把缺陷钉成契约。所有 want=red 逐条把**规则明文禁止的那个形态**写进实现（A/B/G）或把出口逐个摘掉
 * （C/D/E/H/I/J/K/L/M），一条 want=green 证明合规形态没被过度收紧
 * （见记忆 [[feedback-counterproof-must-take-the-forbidden-form]]、[[feedback-guard-must-not-block-sanctioned-fix]]）。
 *
 * 每条变异跑完后按字节还原，并断言还原后的字节与备份逐字节相同（`restored=bytes_equal`）——
 * 变异驱动收尾若不验证还原，就会把上一轮的坏形态留给下一轮。
 *
 * 跑法（在本仓根）：
 *   node .ccg/reviews/shardflag-mutate.driver.js
 * 输出即 `.ccg/reviews/shardflag-mutations.txt` 的内容（本文件自记 head SHA / node 版本 / 采集时间）。
 */
const fs = require('fs')
const cp = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const WF = path.join(ROOT, '.github', 'workflows', 'quality-gate.yml')
const CHK = path.join(ROOT, 'scripts', 'check-desktop-shard-forwarding.js')

function git (...args) {
  return cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}
function runTests () {
  let out = ''
  try {
    out = cp.execFileSync(process.execPath, ['--test', 'scripts/check-desktop-shard-forwarding.test.js'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 300000 })
  } catch (e) { out = String(e.stdout || '') + String(e.stderr || '') }
  const lines = out.split(/\r?\n/)
  const failed = lines.filter((l) => l.startsWith('✖') && !/failing tests/.test(l))
    .map((l) => l.replace(/\s+\([\d.]+m?s\)\s*$/, '').trim())
  const num = (k) => { const m = lines.find((l) => l.includes('ℹ ' + k + ' ')); return m ? m.replace(/[^0-9]/g, '') : '?' }
  return { nfail: new Set(failed).size, tests: num('tests'), pass: num('pass'), failed: [...new Set(failed)] }
}
function patch (file, from, to, expect) {
  const b = fs.readFileSync(file)
  const t = b.toString('utf8')
  const n = t.split(from).length - 1
  if (n !== expect) throw new Error('ANCHOR ' + path.basename(file) + ' hits=' + n + ' expect=' + expect + ' :: ' + from.slice(0, 60))
  fs.writeFileSync(file, Buffer.from(t.split(from).join(to), 'utf8'))
  return b
}
function restore (file, b) {
  fs.writeFileSync(file, b)
  if (Buffer.compare(b, fs.readFileSync(file)) !== 0) throw new Error('RESTORE_MISMATCH ' + file)
  return 'bytes_equal'
}

const SHARD_LINE = '              "--shard=${{ matrix.shard }}",'
const cases = [
  {
    name: 'A 把裸 "--" 塞回 -ArgumentList（历史缺陷形态本身，不是"摘掉守卫"）',
    file: WF, from: SHARD_LINE, to: '              "--",\r\n' + SHARD_LINE, expect: 1,
    want: 'red', lock: '结构层：workflow 的 shard 实参里没有裸',
    why: '规则明文禁止的正是这个形态本身；同时应当红结构层与行为层（两处判据独立成立）',
  },
  {
    name: 'B 去掉 --shard 旗标（分片整个不见了也必须红）',
    file: WF, from: SHARD_LINE, to: '              "--maxWorkers=9",', expect: 1,
    want: 'red', lock: '结构层：workflow 的 shard 实参里没有裸',
    why: 'A 证"不许有 --"，B 证"必须有 --shard"，只钉一条会留下"旗标被人删掉也照绿"的洞',
  },
  {
    name: 'C 让负控变盲（探针永远"看不见那个 --"）',
    file: CHK, from: "  if (control && !control.includes('--')) {", to: "  if (false && control && !control.includes('--')) {", expect: 1,
    want: 'red', lock: '负控失效必须出声',
    why: '行为层两条断言的可信度全靠这条负控；把它改成 no-op 必须有人出声，否则"探针没眼睛"这件事本身不可见',
  },
  {
    name: 'D 让行为层探针退化成空 argv（读不到被调用方却继续往下判）',
    file: CHK, from: '    return JSON.parse(m[1])', to: '    return [] // MUT-D 探针失明也不出声', expect: 1,
    want: 'red', lock: '行为层：真的跑一次 pnpm',
    why: '解析退化成空集合 ⇒ 断言恒真，是"装饰性门禁"的经典形态；必须红',
  },
  {
    name: 'E 把 check() 的默认探针换成原样回吐（注入缝开成的后门）',
    file: CHK, from: 'probe = runArgv, semantics = runShardSemantics } = {}) {', to: "probe = (a) => a, semantics = () => ({ total: 4, legA: ['a', 'b'], legB: ['c', 'd'] }) } = {}) { // MUT-E", expect: 1,
    want: 'red', lock: '行为层：真的跑一次 pnpm',
    why: 'C 需要 probe 注入缝才可离线构造；缝本身必须是可锁的，否则"默认真链路"这件事没有东西在看',
  },
  {
    name: 'G 把注释插回反引号续行之后（本 PR 自己踩到的第二落点，原样复现）',
    file: WF,
    from: '          $testProcess = Start-Process -FilePath "pnpm.cmd" `\r\n            -ArgumentList @(',
    to: '          $testProcess = Start-Process -FilePath "pnpm.cmd" `\r\n              # 变异 G：说明文字插在了续行中间\r\n            -ArgumentList @(',
    expect: 1,
    want: 'red', lock: '第二落点：全仓 workflow',
    why: '这不是"摘掉守卫"，而是把真实发生过的缺陷形态写回实现：pwsh 解析器对它一个错都不报（三态实测 PARSE_ERRORS=0），' +
      '只有 CommandAst 的 extent 从 334 塌成 34 —— 所以必须有这条文本级判据，且它的反证必须用原形态',
  },
  {
    name: 'H 让 parseShardArgv 不再抹空注释行（锚点会被说明文字劫持）',
    file: CHK, from: `map((l) => (/^\\s*#/.test(l) ? '' : l))`, to: 'map((l) => l)', expect: 1,
    want: 'red', lock: '锚点不得被说明文字劫持',
    why: '本轮真实事故：workflow 里一句原样写了 `-ArgumentList @(...)` 的注释让惰性正则从注释起锚，' +
      '把 -FilePath "pnpm.cmd" 也收进实参 —— 锁不报错但开始测错的东西',
  },
  {
    name: 'I 让续行扫描判据恒假（永远返回空命中）',
    file: CHK, from: '  return hits', to: '  return [] // MUT-I 判据恒假', expect: 1,
    want: 'red', lock: '第二落点的判据本身',
    why: 'G 只能证明"真实 workflow 上"能红；这一条证明判据函数本身不是恒假（坏样本必须命中）',
  },
  {
    name: 'J 摘掉语义层的"重叠"判据（两腿跑同一批文件也必须出声）',
    file: CHK, from: '    if (inter.length) {', to: '    if (false && inter.length) { // MUT-J', expect: 1,
    want: 'red', lock: '语义层负控',
    why: '语义层是本轮答复"探针只证送到、不证切分"的那一层；它的核心出口是重叠检测，摘掉必须红',
  },
  {
    name: 'K 摘掉语义层的"合计"判据（分片丢文件这一档）',
    file: CHK, from: '    if (legA.length + legB.length !== total) {', to: '    if (false && legA.length + legB.length !== total) { // MUT-K', expect: 1,
    want: 'red', lock: '语义层负控',
    why: '与 J 是两个独立出口：只判重叠会漏掉"两腿各跑一半但合起来不足全量"',
  },
  {
    name: 'L 摘掉语义层的"空腿=失明"判据',
    file: CHK, from: '    if (legA.length === 0 || legB.length === 0) {', to: '    if (false && (legA.length === 0 || legB.length === 0)) { // MUT-L', expect: 1,
    want: 'red', lock: '语义层负控',
    why: '两腿都空时"重叠 0"会伪装成"完美互斥"——解析退化成空集合必须被单独判为失明',
  },
  {
    name: 'M 把捕获区从惰性改成贪心（跨步骤串台）',
    file: CHK, from: '@\\(([\\s\\S]*?)\\)', to: '@\\(([\\s\\S]*)\\)', expect: 1,
    want: 'red', lock: '锚点不串台',
    why: '证明"后面再来一个 -ArgumentList @(...) 不得改变解析结果"这条对照真的在测惰性边界',
  },
  {
    name: 'F 合规形态必须照绿：往实参里再加一个无关旗标',
    file: WF, from: '              "--teardownTimeout=10000"', to: '              "--teardownTimeout=10000",\r\n              "--passWithNoTests"', expect: 1,
    want: 'green', lock: null,
    why: '反向边界：判据禁的是"裸 --"和"缺 --shard"，不是"任何新增实参"。加一个无关旗标必须照绿，否则这条锁会打红下一个合规 PR',
  },
]

console.log('# shardflag 变异反证原件')
console.log('# head=' + git('rev-parse', 'HEAD') + ' branch=' + git('rev-parse', '--abbrev-ref', 'HEAD'))
console.log('# node=' + process.version + ' collectedAt=' + new Date().toISOString())
console.log('# 注：本原件运行时 worktree 尚有未提交改动，head 只标识仓库基线；逐字节现场见 git status 与 PR diff。')

let bad = 0
for (const c of cases) {
  console.log('\n== ' + c.name)
  console.log('   file=' + path.relative(ROOT, c.file).split(path.sep).join('/'))
  console.log('   from=' + JSON.stringify(c.from))
  console.log('   to  =' + JSON.stringify(c.to))
  console.log('   想证明=' + c.why)
  let b
  try { b = patch(c.file, c.from, c.to, c.expect) } catch (e) { console.log('   ABORTED ' + e.message); bad++; continue }
  const r = runTests()
  const named = c.want === 'green' ? r.nfail === 0 : r.failed.some((f) => f.includes(c.lock))
  const back = restore(c.file, b)
  console.log('   want=' + c.want + ' fail=' + r.nfail + ' pass=' + r.pass + '/' + r.tests +
    ' 预期那条锁红了=' + named + ' restored=' + back)
  console.log('   red: ' + (r.failed.join(' | ') || '(none)'))
  if (!named) bad++
}
const fin = runTests()
console.log('\n== FINAL（未变异）fail=' + fin.nfail + ' pass=' + fin.pass + '/' + fin.tests)
if (!(fin.nfail === 0 && fin.pass === fin.tests)) bad++
const redWant = cases.filter((c) => c.want === 'red').length
const greenWant = cases.filter((c) => c.want === 'green').length
console.log('MUTATION_BAD=' + bad + '（0 = ' + redWant + ' 条必须红的都点名红了、' + greenWant +
  ' 条必须绿的没被误伤、且还原后基线照绿）')
process.exitCode = bad ? 1 : 0
