'use strict'
/**
 * 变异反证电池（PR #3313 第 2 轮，16 条）——入库副本，为的是"产物可独立复核"这句话真的成立。
 *
 *   node .ccg/reviews/gatebudget-mutate.driver.js --dry    # 只校验 16 个锚点命中数，不动盘
 *   node .ccg/reviews/gatebudget-mutate.driver.js          # 逐条打补丁 → 跑锁 → 逐字节还原 → 复验
 *
 * 每条 want=red 都必须让**点名的那一条**锁变红；唯一一条 want=green（N2）守的是
 * "禁令不得挡掉被批准的修法"——只跑"违规必红"证明不了收窄成功。
 * 输出逐行含：改哪个文件、from → to、命中下界、还原后 Buffer.compare、pass/fail 真实读数。
 * 退出码：0 = MUTATION_BAD=0；非 0 = 有反证没成立（收尾还会打印原因）。
 */
const fs = require('fs')
const cp = require('child_process')
const path = require('path')
const ROOT = path.resolve(__dirname, '..', '..')
const WF = ROOT + '/.github/workflows/quality-gate.yml'
const MOD = ROOT + '/scripts/gate-budget.js'
const PRB = ROOT + '/scripts/gate-budget-probe.js'
const CTR = ROOT + '/.github/scripts/workflow-contract.test.js'
const LOCK = 'gate-budget.test.js'
const L_SRC = '两处等待都走'      // workflow 两处等待都走单一真源：时长不得写成字面量、超时文案必须插值预算
const dry = process.argv.includes('--dry')

function run () {
  let out = ''
  try { out = cp.execFileSync('node', ['--test', 'scripts/' + LOCK], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }) }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || '') }
  const lines = out.split(/\r?\n/)
  const failed = lines.filter((l) => l.startsWith('✖') && !/failing tests/.test(l)).map((l) => l.replace(/\s+\([\d.]+m?s\)\s*$/, '').trim())
  const num = (k) => { const m = lines.find((l) => l.includes('ℹ ' + k + ' ')); return m ? m.replace(/[^0-9]/g, '') : '?' }
  return { nfail: new Set(failed).size, tests: num('tests'), pass: num('pass'), failed: [...new Set(failed)] }
}
const countHits = (file, from) => fs.readFileSync(file, 'utf8').split(from).length - 1
function patch (file, from, to, expect) {
  const b = fs.readFileSync(file)
  const t = b.toString('utf8')
  const n = t.split(from).length - 1
  if (n !== expect) throw new Error(`ANCHOR ${path.basename(file)} hits=${n} expect=${expect}: ${from.slice(0, 60)}`)
  fs.writeFileSync(file, Buffer.from(t.split(from).join(to), 'utf8'))
  return b
}
function restore (file, b) {
  fs.writeFileSync(file, b)
  if (Buffer.compare(b, fs.readFileSync(file)) !== 0) throw new Error('RESTORE_MISMATCH ' + file)
  return 'bytes_equal'
}

const INFO = '= $gateUsePct% of $gateBudgetMin min budget"'
const cases = [
  ['M1 两处等待退回写死 1800000', WF, 'WaitForExit([int]$gateBudgetMs)', 'WaitForExit(1800000)', 2, L_SRC, 'red'],
  ['M2 预算调成 10 分钟', MOD, 'const GATE_TEST_BUDGET_MS = 2700000', 'const GATE_TEST_BUDGET_MS = 600000', 1, '定数规则', 'red'],
  ['M3 job 上限退回 40', WF, '    timeout-minutes: 55', '    timeout-minutes: 40', 2, 'job 上限与单一真源', 'red'],
  ['M4 守卫摘掉失败语义（弱化成打日志）', WF, "-notmatch '^\\d+$') { throw \"取不到 Gate 测试预算（scripts/gate-budget.js）—— 不得回落到写死值\" }",
    "-notmatch '^\\d+$') { Write-Host \"取不到预算，先记一笔\" }", 2, '而不只是"有个 if"', 'red'],
  ['M5 守卫去掉类型校验', WF, "-or $gateBudgetMs -notmatch '^\\d+$'", '', 2, '取预算失败必须当场让 job 失败', 'red'],
  ['M6 探针删一个出处字段', PRB, '    gate4CensoredNote: ', '    // MUT-6 removed\n    gate4CensoredNoteX: ', 1, '字段与出处逐字段对齐', 'red'],
  ['M7 安全倍数改小（用改判据消化矛盾）', MOD, 'const SAFETY_MULTIPLIER = 1.5', 'const SAFETY_MULTIPLIER = 1.0', 1, '判据的不可协商项', 'red'],
  ['M8 contract 钉回旧字面量', CTR, '/WaitForExit\\(\\[int\\]\\$gateBudgetMs\\)/', '/WaitForExit\\(1800000\\)/', 2, '旧形态不得被别的锁钉回来', 'red'],
  ['M9n 非注释行把预算写成字面量（英文连字符形态）', WF, INFO, '= 45-minute budget"', 2, L_SRC, 'red'],
  ['M10 两 job 共用较大前置（抹掉 per-job 口径）', MOD, "  'unit-tests': 'gate4OverheadMaxMin',", "  'unit-tests': 'shardOverheadMaxMin',", 1, '各用各的实测前置', 'red'],
  ['M11 摘掉带内贴脸告警', WF, '          $gateElapsedMin = [math]::Round(((Get-Date) - $launchMark).TotalMinutes, 1)', '          # MUT-11 告警被摘', 2, '带内信号', 'red'],
  ['M13 告警只留文本、删掉一处赋值', WF, '          $gateUsePct = [math]::Round(100 * $gateElapsedMin / $gateBudgetMin)', '          # MUT-13 赋值被删', 2, '带内信号', 'red'],
  ['M12 截尾比较改成分钟乘 60000 去比 ms', PRB, '!okRun(r) && r.min >= budgetMin * 0.98', '!okRun(r) && r.min * 60000 >= budgetMin', 1, '字段与出处逐字段对齐', 'red'],
  ['N1 超时文案把插值换成硬编码 45-minute（收窄锁的第二落点）', WF,
    'Gate 4 exceeded its $([int]($gateBudgetMs / 60000))-minute execution budget', 'Gate 4 exceeded its 45-minute execution budget', 1, L_SRC, 'red'],
  ['N2 合规形态：注释里新增历史归因「30 分钟」必须仍为绿', WF,
    '# desktop 全量因此混进 Gate 4 的 30 分钟预算', '# desktop 全量因此混进 Gate 4 的 30 分钟预算\r\n          # 复测注：曾按 30 分钟档定数，见 #3315', 1, null, 'green'],
  ['N3 预算降到 44 分（< 1.5×观测最大值）——RULE_VIOLATED 的唯一反证', MOD,
    'const GATE_TEST_BUDGET_MS = 2700000 // 45 分钟', 'const GATE_TEST_BUDGET_MS = 2640000 // 44 分钟', 1, '定数规则', 'red'],
]

console.log('COORD head_sha=' + cp.execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() +
  ' node=' + process.version + ' cases=' + cases.length + ' lock=scripts/' + LOCK)
if (dry) {
  let bad = 0
  for (const [name, file, from, , expect] of cases) {
    const n = countHits(file, from)
    if (n !== expect) { console.log('ANCHOR_MISMATCH ' + name + ' hits=' + n + ' expect=' + expect); bad++ }
  }
  console.log('DRY_BAD=' + bad)
  process.exitCode = bad ? 1 : 0
  return
}

const res = []
let aborted = 0
for (const [name, file, from, to, expect, expectLock, kind] of cases) {
  let b
  try { b = patch(file, from, to, expect) } catch (e) { console.log('ABORTED ' + name + ' :: ' + e.message); aborted++; break }
  const r = run()
  const named = kind === 'green' ? r.nfail === 0 : r.failed.some((f) => f.includes(expectLock))
  let back
  try { back = restore(file, b) } catch (e) { console.log('ABORTED_RESTORE ' + name + ' :: ' + e.message); aborted++; break }
  res.push({ name, kind, expect, from, to, r, named, back })
  console.log(`${name}\n   file=${path.basename(file)} hits>=${expect} patch: ${JSON.stringify(from.slice(0, 70))} -> ${JSON.stringify(to.slice(0, 70))}\n` +
    `   want=${kind} fail=${r.nfail} pass=${r.pass}/${r.tests} restored=${back} named=${named}\n   red: ${r.failed.join(' | ') || '(none)'}`)
}
const fin = run()
console.log(`FINAL 未变异 fail=${fin.nfail} pass=${fin.pass}/${fin.tests} restored_ok=${res.every((x) => x.back === 'bytes_equal')}`)
for (const f of [WF, MOD, PRB, CTR]) if (countHits(f, '<<<<<<<') !== 0) throw new Error('MARKER_LEFT ' + f)
const namedBad = res.filter((x) => x.named !== true).length
const finalGreen = fin.nfail === 0 && fin.pass === fin.tests && Number(fin.tests) >= 10 && res.length === cases.length
console.log('CASES_RAN=' + res.length + '/' + cases.length + ' MUTATION_BAD=' + (aborted + namedBad + (finalGreen ? 0 : 1)))
process.exitCode = aborted + namedBad + (finalGreen ? 0 : 1)
