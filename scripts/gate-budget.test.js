'use strict'
/**
 * Gate 测试预算的装配锁（openspec change: gate-budget-reprobe）
 *
 * 为什么这些锁必须存在：预算以字面量抄在 workflow 两处，改一处忘另一处 = 同一条 30 分钟墙
 * 仍然立着；只改 workflow 不改 `scripts/gate-budget.js` = 数字与出处分离，下一个人无从判断
 * 这个数是哪次量出来的。锁的判据一律**读真实文件**，不读我写的注释。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const gate = require('./gate-budget.js')
const ROOT = path.resolve(__dirname, '..')
const WF_PATH = path.join(ROOT, '.github', 'workflows', 'quality-gate.yml')
const CONTRACT_PATH = path.join(ROOT, '.github', 'scripts', 'workflow-contract.test.js')
const PROBE_PATH = path.join(ROOT, 'scripts', 'gate-budget-probe.js')

const wf = fs.readFileSync(WF_PATH, 'utf8')

// ── 解析工具（自带存在性断言，防"解析退化成空集合即全绿"）──
function jobBlocks (text) {
  const lines = text.split(/\r?\n/)
  const jobs = []
  let cur = null
  for (const l of lines) {
    const m = l.match(/^  ([a-z0-9][a-z0-9_-]*):\s*$/)
    if (m) { cur = { name: m[1], lines: [] }; jobs.push(cur); continue }
    if (cur) cur.lines.push(l)
  }
  assert.ok(jobs.length >= 5, `jobs 解析只有 ${jobs.length} 个，workflow 结构变了要先改这里`)
  return jobs.map((j) => ({ name: j.name, body: j.lines.join('\n'), timeoutMin: (() => {
    const t = j.lines.find((l) => /^\s+timeout-minutes:\s*(\d+)\s*$/.test(l))
    return t ? Number(t.match(/(\d+)/)[1]) : null
  })() }))
}

test('预算判据本身在测东西（把观测最大值抬高，判据必须翻脸）', () => {
  const base = gate.checkSizing()
  assert.equal(base.ok, true, '默认取值必须自洽：' + base.reasons.join(' ; '))
  const drifted = gate.checkSizing({ provenance: { ...gate.PROVENANCE, gate4MaxSuccessMin: 40 } })
  assert.equal(drifted.ok, false, '观测最大值抬到 40 分后，45 分预算不再满足 ×1.5 规则，必须判不成立')
  const tight = gate.checkSizing({ jobTimeoutMin: 40 })
  assert.equal(tight.ok, false, 'job 上限回到 40 分必须判不成立——否则抬内部预算等于让 GitHub 提前掐 job')
})

test('判据不得被"改小倍数"消化：安全倍数与样本下限是写死的红线', () => {
  assert.ok(gate.SAFETY_MULTIPLIER >= 1.5, `SAFETY_MULTIPLIER=${gate.SAFETY_MULTIPLIER} 被调小过——贴脸要靠重测解决，不靠放宽判据`)
  assert.ok(gate.MIN_SAMPLE_GATE4_SUCCESS >= 20, 'Gate 4 成功样本下限不得低于 20，一次观测不构成分布')
  assert.ok(gate.PROVENANCE.gate4CensoredN >= gate.MIN_SAMPLE_GATE4_CENSORED,
    '出处必须记录"被预算杀的次数"：没有截尾计数，max 就是假上界')
})

test('workflow 两处测试等待都改走单一真源，旧字面量必须彻底消失', () => {
  const jobs = jobBlocks(wf)
  const injected = [...wf.matchAll(/WaitForExit\(\[int\]\$gateBudgetMs\)/g)].length
  assert.ok(injected >= 2, `WaitForExit([int]$gateBudgetMs) 出现 ${injected} 次，Gate 4 与 shard 两处都必须在`)
  assert.equal((wf.match(/WaitForExit\(1800000\)/g) || []).length, 0,
    '仍有一处写死 1800000——改一处忘另一处就是这次要消灭的形态')
  assert.equal((wf.match(/30-minute/g) || []).length, 0, '文案还在自称 30 分钟，与实际预算不一致（本仓主题就是自述要对得上）')
  for (const name of ['unit-tests', 'desktop-shards']) {
    const j = jobs.find((x) => x.name === name)
    assert.ok(j, `job ${name} 解析不到`)
    assert.match(j.body, /gate-budget\.js/, `${name} 没有从 scripts/gate-budget.js 取预算`)
  }
})

test('取预算失败必须当场红，不许静默回落到旧值（防"装饰性装配"）', () => {
  const sites = wf.split(/\r?\n/).map((l, i) => ({ l, i })).filter((x) => /gate-budget\.js.*GATE_TEST_BUDGET_MS/.test(x.l))
  assert.ok(sites.length >= 2, `取数点只找到 ${sites.length} 处`)
  for (const s of sites) {
    const next = wf.split(/\r?\n/).slice(s.i + 1, s.i + 3).join('\n')
    assert.match(next, /if \(\$LASTEXITCODE -ne 0/, `第 ${s.i + 1} 行取数后没有判 $LASTEXITCODE：node 挂了会静默拿到空值`)
  }
})

test('job 上限必须容得下预算 + 实测前置 + 余量，且不许顺手改无关 job', () => {
  const jobs = jobBlocks(wf)
  for (const name of ['unit-tests', 'desktop-shards']) {
    const j = jobs.find((x) => x.name === name)
    assert.ok(j.timeoutMin != null, `${name} 没有 timeout-minutes`)
    assert.equal(j.timeoutMin, gate.GATE_JOB_TIMEOUT_MIN, `${name} 的 timeout-minutes 与单一真源不一致`)
    const need = gate.GATE_TEST_BUDGET_MS / 60000 + gate.PROVENANCE.shardOverheadMaxMin + gate.TIMEOUT_MARGIN_MIN
    assert.ok(j.timeoutMin >= need, `${name}: ${j.timeoutMin} 分 < 预算+前置+余量 = ${need.toFixed(1)} 分`)
  }
})

test('复测入口的输出字段与出处逐字段对齐（防"复测出来的数没法替换进去"）', () => {
  const src = fs.readFileSync(PROBE_PATH, 'utf8')
  const objStart = src.indexOf('const fresh = {')
  assert.ok(objStart >= 0, '探针里没有 fresh 对象——它不再产出可替换的出处结构')
  // 截尾必须按"缩进 2 空格的闭合花括号"找，不能用 indexOf('}')：对象里有模板插值
  // `${pushIds.length}` 自带右花括号，会把切片提前截断（实测只数到 3 个键）。
  const objEnd = src.indexOf('\n  }', objStart)
  assert.ok(objEnd > objStart, 'fresh 对象的闭合边界解析不到')
  const seg = src.slice(objStart, objEnd)
  const keys = [...seg.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1])
  assert.ok(keys.length >= 8, `探针字段只解析到 ${keys.length} 个，判据退化`)
  assert.deepEqual(keys.slice().sort(), gate.PROVENANCE_FIELDS.slice().sort(),
    '探针字段集与 PROVENANCE 不一致：复测结果将无法逐字段替换出处')
  assert.match(src, /\/ 60000/, '时长换算必须是 ms/60000；写成 /6000 会把分钟放大 10 倍（本仓实测踩过）')
})

test('旧形态不得被别的锁钉回来（workflow-contract 与本锁必须同口径）', () => {
  const contract = fs.readFileSync(CONTRACT_PATH, 'utf8')
  assert.equal((contract.match(/WaitForExit\(1800000\)/g) || []).length, 0,
    'workflow-contract.test.js 还在钉 1800000 —— 它会把我这次的修复判红，属"门禁挡住被自己批准的修法"')
  // 被断言对象本身是一段**正则字面量文本**（含反斜杠），用正则去找正则等于永远匹配不上；
  // 这里按字面串包含判断，且把要匹配的东西写成拼接，免得本行的 needle 自己撞下一条锁。
  const expectedLiteral = '/WaitForExit\\(\\[int\\]\\$gateBudgetMs\\)/'
  assert.ok(contract.includes(expectedLiteral), 'workflow-contract 应改钉注入形态（字面串 ' + expectedLiteral + '）')
})
