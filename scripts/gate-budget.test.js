'use strict'
/**
 * Gate 测试预算的装配锁（openspec change: gate-budget-reprobe）
 *
 * 为什么这些锁必须存在：预算原来以字面量抄在 workflow 两处，改一处忘另一处 = 同一条墙仍立着；
 * 数字与"它是怎么来的"分家 = 下一个人只能猜。所有判据都**读真实文件**，不读我写的注释。
 *
 * 两条来自 QM-6 的形状教训已锁进来：
 *  - 判据只认英文 `30-minute`，中文「30 分钟」从盲区穿过（maint 轴 W1，我实测确认）；
 *  - fail-closed 只断言"有 if ($LASTEXITCODE"，不断言"失败时真的失败"（maint 轴 W3）。
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
  return jobs.map((j) => ({
    name: j.name,
    body: j.lines.join('\n'),
    timeoutMin: (() => {
      const t = j.lines.find((l) => /^\s+timeout-minutes:\s*(\d+)\s*$/.test(l))
      return t ? Number(t.match(/(\d+)/)[1]) : null
    })(),
  }))
}
const freshProvenance = (over) => ({ ...gate.PROVENANCE, ...over })

test('定数规则本身在测东西（抬高观测最大值 / 改小倍数都必须翻脸）', () => {
  const base = gate.checkSizing()
  assert.equal(base.ok, true, '默认取值必须自洽：' + base.reasons.join(' ; '))
  const drifted = gate.checkSizing({ provenance: freshProvenance({ gate4MaxSuccessMin: 41 }) })
  assert.equal(drifted.ok, false, '观测最大值 41 分已达预算 45 分的 90%，必须判"预算不再满足规则"')
  assert.ok(drifted.reasons.some((r) => /NO_LONGER_SIZED|不再满足/.test(r)), '理由要点名是"要重定数"，不是含糊的不成立：' + drifted.reasons.join(' ; '))
  const tight = gate.checkSizing({ jobTimeouts: { 'unit-tests': 40, 'desktop-shards': 55 } })
  assert.equal(tight.ok, false, 'unit-tests 的 job 上限回到 40 必须判不成立——否则抬内层预算等于让 GitHub 提前掐 job')
})

test('健康态不得自判红：没贴脸时"零截尾样本"是正确结果（QM-6 双轴同指一处）', () => {
  // 预算刚从 30 抬到 45 后，历史上那批 30 分被杀的样本不再落在"当前预算"的 95% 里。
  // 若仍然要求 censored ≥ 1，则 CHANGELOG 里 mandated 的复测在一切正常时退 1，
  // 会把下一个会话推去"重定一个没问题的数"。截尾证据的要求只在**贴脸时**生效。
  const healthy = gate.checkSizing({ provenance: freshProvenance({ censoredUnderPriorBudgetN: 0, censoredUnderCurrentBudgetN: 0 }) })
  assert.equal(healthy.ok, true, '未贴脸且无截尾样本 = 抬完预算后的正常状态，必须判成立：' + healthy.reasons.join(' ; '))
  const hugging = gate.checkSizing({ provenance: freshProvenance({ gate4MaxSuccessMin: 37, censoredUnderPriorBudgetN: 0 }) })
  assert.equal(hugging.ok, false, '已贴脸（≥80% 预算）却拿不出任何截尾证据 ⇒ 必须红，因为 max 此时是假上界')
})

test('两个 job 各用各的实测前置，不得共用一个较大值糊过去', () => {
  const r = gate.checkSizing()
  assert.ok(r.perJob, 'checkSizing 必须给出 per-job 判定明细')
  assert.equal(r.perJob['unit-tests'].usesOverhead, gate.PROVENANCE.gate4OverheadMaxMin, 'unit-tests 应该用 Gate 4 自己量出来的前置')
  assert.equal(r.perJob['desktop-shards'].usesOverhead, gate.PROVENANCE.shardOverheadMaxMin, 'desktop-shards 应该用它自己的前置')
  // 死了的常量比没有更坏：注释、常量、代码三口径分裂正是 QM-6 指出的形态
  assert.equal('OVERHEAD_ALLOWANCE_MIN' in gate, false, 'OVERHEAD_ALLOWANCE_MIN 既不被 checkSizing 消费就不该存在')
  // 按名字的结构性锁：两个实测前置相等时（1.38 == 1.38），"交换 per-job 字段"在数值上是空操作，
  // 任何只看数值的判据都抓不住它 —— 口径必须按**名字**钉住，而不是靠值不同意外暴露。
  assert.equal(gate.JOB_OVERHEAD_FIELD['unit-tests'], 'gate4OverheadMaxMin', 'unit-tests 必须指名 Gate 4 自己的前置字段')
  assert.equal(gate.JOB_OVERHEAD_FIELD['desktop-shards'], 'shardOverheadMaxMin', 'desktop-shards 必须指名 shard 自己的前置字段')
  assert.notEqual(gate.JOB_OVERHEAD_FIELD['unit-tests'], gate.JOB_OVERHEAD_FIELD['desktop-shards'],
    '两个 job 必须映射到不同字段；同名 = per-job 口径已退化成一个值用两处')
  // 注释里的算式必须就是代码跑的算式
  const src = fs.readFileSync(path.join(__dirname, 'gate-budget.js'), 'utf8')
  const derived = gate.GATE_TEST_BUDGET_MS / 60000 + gate.PROVENANCE.shardOverheadMaxMin + gate.TIMEOUT_MARGIN_MIN
  // 必须锚定 const 声明行：`[^=]` 会跨行，把文档注释里的同名引用当成声明（实测捕到 0）
  const m = src.match(/^const GATE_JOB_TIMEOUT_MIN = (\d+)$/m)
  assert.ok(m, '解析不到 GATE_JOB_TIMEOUT_MIN')
  assert.ok(Number(m[1]) >= Math.ceil(derived / 5) * 5, `job 上限 ${m[1]} 低于"向上取整到 5 的倍数"的结果 ${Math.ceil(derived / 5) * 5}`)
  assert.match(src, new RegExp(`向上取整到 5 的倍数[^\\n]*${Math.ceil(derived / 5) * 5}|=\\s*${m[1]}[^\\n]*向上取整`), '注释必须写明取整规则，否则 53/52.8/55 三个数谁也不知道哪个是判据')
})

test('判据的不可协商项：安全倍数、样本下限、截尾证据下限都不得被调小来消化矛盾（M7 实测过这条锁缺失）', () => {
  assert.ok(gate.SAFETY_MULTIPLIER >= 1.5, `SAFETY_MULTIPLIER=${gate.SAFETY_MULTIPLIER} 被调小——贴脸要靠重测解决，不靠放宽判据`)
  assert.ok(gate.WARN_RATIO > 0 && gate.WARN_RATIO < gate.HARD_RATIO && gate.HARD_RATIO <= 0.95,
    `比例档必须 WARN(${gate.WARN_RATIO}) < HARD(${gate.HARD_RATIO}) ≤ 0.95，否则"贴脸"与"越界"会同时不成立或同时成立`)
  assert.ok(gate.MIN_SAMPLE_GATE4_SUCCESS >= 20, `成功样本下限 ${gate.MIN_SAMPLE_GATE4_SUCCESS} 太低：一次观测不构成分布`)
  assert.ok(gate.MIN_SAMPLE_CENSORED_WHEN_HUGGING >= 1, '贴脸时必须至少有一个截尾证据，否则 max 是假上界')
})

test('记录下来的出处自己不许贴脸（否则这次改动就是在制造下一次的红）', () => {
  const budgetMin = gate.GATE_TEST_BUDGET_MS / 60000
  const maxObs = Math.max(gate.PROVENANCE.gate4MaxSuccessMin, gate.PROVENANCE.shardMaxSuccessMin)
  assert.ok(maxObs < budgetMin * gate.HARD_RATIO, `观测最大 ${maxObs} 分已达预算 ${budgetMin} 分的 ${gate.HARD_RATIO * 100}%，必须重新定数`)
  assert.ok(gate.PROVENANCE.collectedAt, '出处必须带采集时刻')
  assert.ok(gate.PROVENANCE.priorBudgetMin > 0, '必须记录"采样窗口内生效的预算"，否则截尾判据会随抬价漂移')
})

test('workflow 两处等待都走单一真源，且任何语言的"30 分钟"自述都归零', () => {
  const jobs = jobBlocks(wf)
  const injected = [...wf.matchAll(/WaitForExit\(\[int\]\$gateBudgetMs\)/g)].length
  assert.ok(injected >= 2, `WaitForExit([int]$gateBudgetMs) 出现 ${injected} 次，Gate 4 与 shard 两处都必须在`)
  assert.equal((wf.match(/WaitForExit\(1800000\)/g) || []).length, 0, '仍有一处写死 1800000')
  // 中文形态实测存在过（:633 与 :739），只锁英文等于没锁 —— QM-6 maint 轴命中
  const stale = wf.split(/\r?\n/).map((l, i) => (/30\s*(?:分钟|minute)/.test(l) ? i + 1 : 0)).filter(Boolean)
  assert.deepEqual(stale, [], `workflow 里仍有"30 分钟"式自述（行 ${stale.join(',')}），安全网已是 ${gate.GATE_TEST_BUDGET_MS / 60000} 分`)
  for (const name of ['unit-tests', 'desktop-shards']) {
    const j = jobs.find((x) => x.name === name)
    assert.ok(j, `job ${name} 解析不到`)
    assert.match(j.body, /gate-budget\.js/, `${name} 没有从 scripts/gate-budget.js 取预算`)
  }
})

test('取预算失败必须当场让 job 失败，而不只是"有个 if"', () => {
  const lines = wf.split(/\r?\n/)
  const sites = lines.map((l, i) => (/gate-budget\.js.*GATE_TEST_BUDGET_MS/.test(l) ? i : -1)).filter((i) => i >= 0)
  assert.ok(sites.length >= 2, `取数点只找到 ${sites.length} 处`)
  for (const i of sites) {
    const win = lines.slice(i + 1, i + 4).join('\n')
    // 弱化形态 `if ($LASTEXITCODE -ne 0) { Write-Host ... }` 能过"只看 if 存在"的旧锁（maint 轴 W3）
    assert.match(win, /if \(\$LASTEXITCODE -ne 0[\s\S]{0,220}(throw|exit)/, `第 ${i + 1} 行取数后的守卫没有失败语义：node 挂了会静默拿到空值`)
        assert.ok(win.includes("-notmatch '^\\d+$'"), '必须同时拒空值与非正整数（空串经 [int] 是 0 ⇒ WaitForExit(0) 会误报超时）')
  }
})

test('每次 CI 跑都自带"离墙还有多远"的带内信号', () => {
  const jobs = jobBlocks(wf)
  for (const name of ['unit-tests', 'desktop-shards']) {
    const j = jobs.find((x) => x.name === name)
    assert.match(j.body, /::warning::[^\n]*(elapsed|耗时)[^\n]*budget/i, `${name} 成功后必须打一条 elapsed/预算 比例告警（贴脸时先出声，别等下一次红）`)
    assert.match(j.body, /0\.8/, `${name} 的贴脸阈值应与 checkSizing 的 WARN 档一致`)
    // 只有告警文本、没有算出这些数的赋值，是一个能过锁的运行期炸点（M11 实测）
    for (const v of ['$gateElapsedMin = ', '$gateBudgetMin = ', '$gateUsePct = ']) {
      assert.equal(j.body.split(v).length - 1, 1, `${name} 的告警缺少变量 ${v.trim()} 的赋值（文本还在，值已不存在）`)
    }
  }
})

test('job 上限与单一真源严格对齐，且不许动无关 job', () => {
  const jobs = jobBlocks(wf)
  const r = gate.checkSizing()
  for (const name of ['unit-tests', 'desktop-shards']) {
    const j = jobs.find((x) => x.name === name)
    assert.ok(j.timeoutMin != null, `${name} 没有 timeout-minutes`)
    assert.equal(j.timeoutMin, gate.GATE_JOB_TIMEOUT_MIN, `${name} 的 timeout-minutes 与单一真源不一致`)
    assert.equal(r.perJob[name].ok, true, `${name}: ${r.perJob[name].reason}`)
  }
  const cov = jobs.find((x) => x.name === 'coverage')
  assert.equal(cov.timeoutMin, 40, 'coverage job 没有 WaitForExit 站点，本次不得顺手改它')
})

test('复测入口的字段与出处逐字段对齐，单位换算锁到函数体', () => {
  const src = fs.readFileSync(PROBE_PATH, 'utf8')
  const objStart = src.indexOf('const fresh = {')
  assert.ok(objStart >= 0, '探针里没有 fresh 对象——它不再产出可替换的出处结构')
  // 截尾必须按"缩进 2 空格的闭合花括号"找：对象里有模板插值 `${x.length}` 自带右花括号，
  // indexOf('}') 会提前截断（实测只数到 3 个键）。
  const objEnd = src.indexOf('\n  }', objStart)
  assert.ok(objEnd > objStart, 'fresh 对象的闭合边界解析不到')
  const keys = [...src.slice(objStart, objEnd).matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*)(?::|,\s*$)/gm)].map((m) => m[1])
  assert.ok(keys.length >= 10, `探针字段只解析到 ${keys.length} 个，判据退化`)
  assert.deepEqual(keys.slice().sort(), gate.PROVENANCE_FIELDS.slice().sort(),
    '探针字段集与 PROVENANCE 不一致：复测结果将无法逐字段替换出处')
  // 只搜字面串 '/ 60000' 会被"另一处 * 60000"顺带满足 ⇒ 锁到 minutes() 函数体本身
  const fnStart = src.indexOf('function minutes (')
  assert.ok(fnStart >= 0, '探针里没有 minutes() 函数')
  const fnBody = src.slice(fnStart, src.indexOf('\n}\n', fnStart))
  assert.match(fnBody, /\/ 60000/, 'minutes() 必须按 ms/60000 换算（写成 /6000 把分钟放大 10 倍，实测踩过）')
  assert.doesNotMatch(fnBody, /\/ 6000(?!0)/, 'minutes() 里出现 /6000 量级')
  // 防的是单位混用：步长一律先化成分钟，截尾比较也必须两边都是分钟
  assert.match(src, /r\.min >= budgetMin \* 0\.98/, '截尾判定必须是「分钟 对 分钟」；任何一侧偷偷换成 ms 都会把结论放大或缩小 60000 倍')
  assert.doesNotMatch(src, /r\.min >= \w+ \* 60000/, '不许把分钟再乘 60000 去比 ms —— 单位混用就是这次的原始失误')
})

test('旧形态不得被别的锁钉回来（workflow-contract 与本锁同口径）', () => {
  const contract = fs.readFileSync(CONTRACT_PATH, 'utf8')
  assert.equal((contract.match(/WaitForExit\(1800000\)/g) || []).length, 0,
    'workflow-contract.test.js 还在钉 1800000 —— 它会把本次修法判红')
  // 被断言对象本身是"含反斜杠的正则字面量文本"，用正则去找正则等于恒不匹配；按字面串核。
  assert.ok(contract.includes('/WaitForExit\\(\\[int\\]\\$gateBudgetMs\\)/'), 'workflow-contract 应改钉注入形态')
})
