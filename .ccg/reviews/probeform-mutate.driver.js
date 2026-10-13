'use strict'
/**
 * 变异反证（change: budget-probe-form-split，2026-10-12）
 * 证明 scripts/gate-budget.js 的形态分档与 scripts/gate-budget-probe.js 的接线都在测它声称的东西。
 * 每条 want=red 都改的是**判据自己**（不是实现），want=green 证明没把无关改动一并打死；
 * 逐条按字节还原并断言 `restored=bytes_equal`。
 *   node .ccg/reviews/probeform-mutate.driver.js
 */
const fs = require('fs')
const cp = require('child_process')
const path = require('path')
const ROOT = path.resolve(__dirname, '..', '..')
const GATE = path.join(ROOT, 'scripts', 'gate-budget.js')
const PROBE = path.join(ROOT, 'scripts', 'gate-budget-probe.js')
const CHK = path.join(ROOT, 'scripts', 'check-desktop-shard-forwarding.js')

function runTests () {
  let out = ''
  try {
    out = cp.execFileSync(process.execPath, ['--test', 'scripts/gate-budget.test.js'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 300000 })
  } catch (e) { out = String(e.stdout || '') + String(e.stderr || '') }
  const lines = out.split(/\r?\n/)
  const failed = [...new Set(lines.filter((l) => l.startsWith('✖') && !/failing tests/.test(l))
    .map((l) => l.replace(/\s+\([\d.]+m?s\)\s*$/, '').trim()))]
  const num = (k) => { const m = lines.find((l) => l.includes('ℹ ' + k + ' ')); return m ? m.replace(/[^0-9]/g, '') : '?' }
  return { nfail: failed.length, tests: num('tests'), pass: num('pass'), failed }
}
/**
 * 锚点必须行尾无关：本仓工作副本是 CRLF（`* text=auto` 的 checkout 转换），
 * 多行锚点若按 `\n` 字面匹配就永远 hits=0 —— 第一版就是这样，A/C 两条被 ABORTED 才发现。
 * 单行锚点（B/D/E/F）当时照样命中，所以"部分能命中"绝不能当"锚点体系没问题"。
 */
function toRegExp (literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 命中后字符串里是**真换行**（不是两字符的 \n），所以按 /\n/ 替换；
  // 上一版按 /\\n/ 替换等于没替换，A/C 两条继续 hits=0 —— 修 bug 也要验它真的被修到。
  return new RegExp(escaped.replace(/\n/g, '\\r?\\n'), 'g')
}
function patch (file, from, to, expect) {
  const b = fs.readFileSync(file)
  const t = b.toString('utf8')
  const re = toRegExp(from)
  const hits = t.match(re) || []
  if (hits.length !== expect) throw new Error('ANCHOR ' + path.basename(file) + ' hits=' + hits.length + ' expect=' + expect + ' :: ' + from.slice(0, 60))
  // 替换文本按被命中那一行的实际行尾还原（保持 CRLF 文件不被写成 LF —— 见 AGENTS.md 行尾铁律）
  const eol = hits[0].includes('\r\n') ? '\r\n' : '\n'
  fs.writeFileSync(file, Buffer.from(t.replace(re, to.split('\n').join(eol)), 'utf8'))
  return b
}
function restore (file, b) {
  fs.writeFileSync(file, b)
  if (Buffer.compare(b, fs.readFileSync(file)) !== 0) throw new Error('RESTORE_MISMATCH ' + file)
  return 'bytes_equal'
}

const cases = [
  {
    name: 'A 让 checkSizing 无视 form（退回混池旧口径）',
    file: GATE, from: '  const maxObs = form\n    ? Math.max(form.gate4MaxSuccessMin, form.shardMaxSuccessMin)\n    : Math.max(provenance.gate4MaxSuccessMin, provenance.shardMaxSuccessMin)',
    to: '  const maxObs = Math.max(provenance.gate4MaxSuccessMin, provenance.shardMaxSuccessMin)',
    expect: 1, want: 'red', lock: '旧形态的观测最大值不得决定当前预算',
    why: '这条锁的全部意义就是"旧形态的 31.55 不能再决定当前预算"；把它改回混池必须红',
  },
  {
    name: 'B 摘掉"同形态样本不足"出口',
    file: GATE, from: '    if (form.gate4SuccessN < MIN_SAMPLE_CURRENT_FORM || form.shardSuccessN < MIN_SAMPLE_CURRENT_FORM) {', to: '    if (false) { // MUT-B 不再说"判不了"', expect: 1,
    want: 'red', lock: '样本不足且观测值本身没违约',
    why: '样本不足时必须说"判不了"。摘掉它 = 拿 2 个样本的分布去判"预算站得住"',
  },
  {
    name: 'C 解析失败时把 unknown 默认成 fixed',
    file: GATE, from: "  } catch (e) {\n    return 'unknown'\n  }", to: "  } catch (e) {\n    return 'fixed' // MUT-C 读不到就放行\n  }", expect: 1,
    want: 'red', lock: '解析不了就是 unknown',
    why: '"判据读不到"不得被读成"分片是好的"——这是本仓反复出事的那一类假绿',
  },
  {
    name: 'D 探针不把 form 交给判据',
    file: PROBE, from: 'gate.checkSizing({ provenance: fresh, form })', to: 'gate.checkSizing({ provenance: fresh })', expect: 1,
    want: 'red', lock: '探针接线：必须把 form 交给 checkSizing',
    why: '分档逻辑留在判据里但没人传参，等价于这次修复从未发生（注册≠注入）',
  },
  {
    name: 'E 把 FORM_* 未知样本记进 probe_errors',
    file: PROBE, from: "    unknowns.push({ sha, why: 'FORM_BLOB_MISSING：本地没有该提交（PR head 分支已删？先 git fetch）' })",
    to: "    errs.push('FORM_BLOB_MISSING ' + sha) // MUT-E 把结构性未知当探针故障", expect: 1,
    want: 'red', lock: '探针接线：必须把 form 交给 checkSizing',
    why: 'PR head 提交本地取不到是结构性的；混进 errs 会让探针永久退 3，新判据自己被关闭',
  },
  {
    name: 'F 合规形态必须照绿：把余量从 5 分抬到 6 分',
    file: GATE, from: 'const TIMEOUT_MARGIN_MIN = 5', to: 'const TIMEOUT_MARGIN_MIN = 6', expect: 1,
    want: 'green', lock: null,
    why: '反向边界：分档判据不该把无关的余量微调也打死（55 仍 ≥ 45+1.38+6）',
  },
  // ── 第 2 轮（QM-6 双轴命中"稀缺吃掉告警"之后的补证）──
  {
    name: 'G 回到第 1 轮的开关：有 form 就不判 RULE_VIOLATED（稀缺吃掉告警）',
    file: GATE, from: '  if (!(budgetMin >= maxObs * SAFETY_MULTIPLIER - 1e-9)) {',
    to: '  if (!(budgetMin >= maxObs * SAFETY_MULTIPLIER - 1e-9) && form === null) { // MUT-G', expect: 1,
    want: 'red', lock: '稀缺不得吃掉告警',
    why: '本次 CRITICAL 的复发形态：样本少 ≠ 没观测到 44 分。稀缺只削弱"确认"，削弱不了告警',
  },
  {
    name: 'H 把两池下限加总判（gate4 够 + shard 不够也会报"够"）',
    file: GATE, from: '    if (form.gate4SuccessN < MIN_SAMPLE_CURRENT_FORM || form.shardSuccessN < MIN_SAMPLE_CURRENT_FORM) {',
    to: '    if ((form.gate4SuccessN + form.shardSuccessN) < MIN_SAMPLE_CURRENT_FORM) { // MUT-H', expect: 1,
    want: 'red', lock: '同形态样本下限按池分别判',
    why: '两池是两个 job、两种预算语义，加总 28 是个假数 —— 这正是 QM-6 逻辑轴 MINOR 独立命中的一条',
  },
  {
    name: 'I 出口码表换序：稀缺排在告警之前',
    file: GATE, from: '  if ((sized.alarms || []).length) return 1\n  if ((sized.scarcity || []).length) return 4',
    to: '  if ((sized.scarcity || []).length) return 4\n  if ((sized.alarms || []).length) return 1 // MUT-I 换序', expect: 1,
    want: 'red', lock: '出口码是一张表',
    why: '换序就把"已观测到贴脸时长"读成"还没量够、先别动"—— 本 PR 花全部力气消灭的误标签，且它在 if 链里是静默的',
  },
  {
    name: 'J 把 require 挪进 try（装配断裂被洗成 unknown）',
    file: GATE, from: '  const { classifyShardForm } = require(\'./check-desktop-shard-forwarding.js\')\n  try {\n    return classifyShardForm(workflowText)',
    to: '  try {\n    const { classifyShardForm } = require(\'./check-desktop-shard-forwarding.js\') // MUT-J\n    return classifyShardForm(workflowText)', expect: 1,
    want: 'red', lock: '解析模块本身没了要炸出声',
    why: '"模块没了"与"这批 run 读不到形态"是两件事；混成一类会让判据失明伪装成数据缺失（QM-6 逻辑轴 MAJOR#2）',
  },
  {
    name: 'K 形态判据去掉"续行被注释吃掉"这一支',
    file: CHK, from: '  return (f.bareCount || !f.hasShard || f.severs.length) ? \'broken\' : \'fixed\'',
    to: '  return (f.bareCount || !f.hasShard) ? \'broken\' : \'fixed\' // MUT-K', expect: 1,
    want: 'red', lock: '形态判定只有一份实现',
    why: 'CI 会因续行断裂把那个 run 报红，探针却把它归进 fixed 池 —— 分档前提被第二份实现钻空子（QM-6 可维护性轴 MAJOR#1）',
  },
  {
    name: 'L 预算常量的正则去掉行首锚',
    file: GATE, from: '  const m = /^[ \\t]*const GATE_TEST_BUDGET_MS\\s*=\\s*(\\d+)/m.exec(String(text || \'\'))',
    to: '  const m = /GATE_TEST_BUDGET_MS\\s*=\\s*(\\d+)/.exec(String(text || \'\')) // MUT-L', expect: 1,
    want: 'red', lock: '预算解析两处健壮性',
    why: '注释里的历史叙述（"历史上 GATE_TEST_BUDGET_MS = 1800000 曾…"）会被当成该 run 生效的预算，形态键当场漂移',
  },
  {
    name: 'M workflow 兜底两处取值不一致时取第一个',
    file: GATE, from: '  if (vals.length !== 1) return null', to: '  if (!vals.length) return null // MUT-M 取第一个猜一个', expect: 1,
    want: 'red', lock: '预算解析两处健壮性',
    why: '两处墙不同时取第一个等于猜；本文件的纪律是"读不准就当读不到"（返回 null → 该 run 记 unknown）',
  },
  {
    name: 'N 探针不再按形态算截尾证据',
    file: PROBE, from: '    censoredUnderPriorBudgetN: censoredUnder(bucket.g4, priorBudgetMin).length + censoredUnder(bucket.shard, priorBudgetMin).length,',
    to: '', expect: 1,
    want: 'red', lock: '探针接线',
    why: '贴脸时要求"被杀样本"作证，证据却来自混池旧档 —— 判据的字段来源必须逐字段如实（文档注释不许声称得比代码干净）',
  },
  {
    name: 'O 合规编辑必须照绿：只改稀缺理由的尾部措辞（判据码不动）',
    file: GATE, from: ' —— 不能确认预算站得住；上面若仍有告警，告警照样算数`',
    to: ' —— 不能确认预算站得住（措辞调整）`', expect: 1,
    want: 'green', lock: null,
    why: '反向边界：锁认的是 INSUFFICIENT_CURRENT_FORM 这个判据码，不是整句话。把文案钉死会让下一次合规改文案红在自己身上',
  },
]

console.log('# budget-probe 形态分档 变异反证')
console.log('# head=' + cp.execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
console.log('# node=' + process.version + ' collectedAt=' + new Date().toISOString())
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
  console.log('   want=' + c.want + ' fail=' + r.nfail + ' pass=' + r.pass + '/' + r.tests + ' ' + (c.want === 'green' ? '对照绿=' : '点名红=') + named + ' restored=' + back)
  console.log('   red: ' + (r.failed.join(' | ') || '(none)').slice(0, 200))
  if (!named) bad++
}
const fin = runTests()
console.log('\n== FINAL（未变异）fail=' + fin.nfail + ' pass=' + fin.pass + '/' + fin.tests)
if (!(fin.nfail === 0 && fin.pass === fin.tests)) bad++
console.log('MUTATION_BAD=' + bad)
process.exitCode = bad ? 1 : 0
