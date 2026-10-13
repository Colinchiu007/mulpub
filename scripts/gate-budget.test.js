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

test('workflow 两处等待都走单一真源：时长不得写成字面量、超时文案必须插值预算', () => {
  const jobs = jobBlocks(wf)
  const injected = [...wf.match(/WaitForExit\(\[int\]\$gateBudgetMs\)/g)].length
  assert.ok(injected >= 2, `WaitForExit([int]$gateBudgetMs) 出现 ${injected} 次，Gate 4 与 shard 两处都必须在`)
  assert.equal((wf.match(/WaitForExit\(1800000\)/g) || []).length, 0, '仍有一处写死 1800000')
  // 口径（2026-10-11 被 #3315 撞出来后收窄）：要禁的是"把时长钉成一个会漂移的字面量"，不是"提到 30 分钟"这句话。
  // 原判据对全文禁 `30\s*(分钟|minute)`，而 #3315 在注释里写「desktop 混进 Gate 4 的 30 分钟预算」是**历史归因**、
  // 是事实 —— 一条把被批准的修法自己判红的锁，就是 AGENTS.md 里 PR #3225 记过的那种失守。
  // 收窄后仍守住原意图：中文形态实测存在过（:633 与 :739），只锁英文等于没锁（QM-6 maint 轴命中），
  // 所以按"任何语言的数字 + 分钟/minute"扫**非注释行**，并把超时文案单独要求它插值真实预算。
  // 判据必须容得下连字符形态：`45-minute` / `30-minute` 这类写法在 `\d+\s*minute` 下**不匹配**
  // （数字与词之间隔着 `-`），而旧文案用的正是 `30-minute`，漏了它就是把要禁的形态留在盲区（M9n 实测命中）。
  const hardCoded = wf.split(/\r?\n/)
    .map((l, i) => (/^\s*#/.test(l) ? 0 : (/\d+\s*-?\s*(?:分钟|minute)/.test(l) ? i + 1 : 0)))
    .filter(Boolean)
  assert.deepEqual(hardCoded, [], `非注释行把测试时长写成了字面量（行 ${hardCoded.join(',')}）——数字只能来自 scripts/gate-budget.js`)
  const msgs = [...wf.matchAll(/Write-Host "([^"]*exceeded its[^"]*budget[^"]*)"/g)]
  assert.equal(msgs.length, 2, `超时文案应有 2 处，实得 ${msgs.length} —— 判据要跟着改`)
  for (const m of msgs) {
    assert.ok(m[1].includes('$gateBudgetMs'), `失败文案没插值真实预算，读日志的人会按字面数理解安全网：${m[1].slice(0, 70)}`)
  }
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

/* ────────── 形态分档（change: budget-probe-form-split）──────────
 * 动因（#3357 合并后实测）：探针把窗口内所有 shard 成功样本混成一池，而这一步在一天内换了
 * 两代形态（预算 30→45、分片"两腿各跑全量"→真半量），于是 RULE_VIOLATED 拿一个**旧形态**的
 * 31.55 分去要求给"半量"定墙。样本换代不是判据失效，但混池是。 */
const formOf = (over) => ({ gate4SuccessN: 40, shardSuccessN: 40, gate4MaxSuccessMin: 2.05, shardMaxSuccessMin: 12.4, censoredUnderPriorBudgetN: 3, ...over })

test('旧形态的观测最大值不得决定当前预算（混池就是这次误报的根因）', () => {
  const base = gate.checkSizing({ provenance: freshProvenance({ gate4MaxSuccessMin: 29.88, shardMaxSuccessMin: 31.55 }) })
  assert.equal(base.ok, false, '夹具前提：不传 form 时仍按全局字段判（这条必须红，否则下面的绿是假的）')
  const split = gate.checkSizing({ provenance: base && freshProvenance({ gate4MaxSuccessMin: 29.88, shardMaxSuccessMin: 31.55 }), form: formOf() })
  assert.equal(split.ok, true, '按当前形态分档后，旧形态的 31.55 不能再触发重定数：' + split.reasons.join(' ; '))
  assert.equal(split.maxObs, 12.4, 'checkSizing 的 maxObs 必须换成当前形态的值')
})

test('样本不足且观测值本身没违约 ⇒ 只报"样本不够"，不报"要重定数"（对照：违约那条另立）', () => {
  const r = gate.checkSizing({ provenance: freshProvenance(), form: formOf({ gate4SuccessN: 1, shardSuccessN: 1 }) })
  assert.equal(r.ok, false, '真分片形态只有 2 个样本，不足以证明预算站得住')
  assert.ok(r.scarcity.some((x) => /INSUFFICIENT_CURRENT_FORM/.test(x)), '理由必须点名是"同形态样本不够"：' + r.reasons.join(' ; '))
  assert.equal(r.alarms.length, 0, '这条夹具的观测 max 只有 12.4 分，规则站得住 ⇒ 不该有告警')
  assert.equal(r.reasons.some((x) => /RULE_VIOLATED|NO_LONGER_SIZED/.test(x)), false,
    '分装的目的是两者不得互相覆盖：稀缺说"别急着改数"，告警说"该改了"：' + r.reasons.join(' ; '))
})

test('当前形态自己贴脸/违约时，RULE_VIOLATED 仍然必须红（分档不是把它整体关掉）', () => {
  const r = gate.checkSizing({ provenance: freshProvenance(), form: formOf({ shardMaxSuccessMin: 31.55 }) })
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some((x) => /RULE_VIOLATED/.test(x)), '当前形态自身已违反 ×1.5 必须红：' + r.reasons.join(' ; '))
})

test('形态键是纯函数：从 workflow 正文判分片是否已修好，从 gate-budget 正文取预算', () => {
  const wf = fs.readFileSync(WF_PATH, 'utf8')
  assert.equal(gate.shardFormOf(wf), 'fixed', '当前 main 的 workflow 应是"分片已修好"形态')
  const broken = wf.replace('              "test",', '              "test",\r\n              "--",')
  assert.notEqual(broken, wf, '夹具没改到东西，这条对照失效')
  assert.equal(gate.shardFormOf(broken), 'broken', '把裸 "--" 塞回去必须判 broken')
  assert.equal(gate.budgetMinFromGateBudgetText('const GATE_TEST_BUDGET_MS = 2700000 // x'), 45)
  assert.equal(gate.budgetMinFromGateBudgetText('没有这个常量'), null, '取不到必须返回 null，不得瞎猜一个数')
})

test('解析不了就是 unknown —— 不得默认成 fixed（默认放行等于给这条判据关灯）', () => {
  assert.equal(gate.shardFormOf('jobs:\n  other:\n    steps: []\n'), 'unknown',
    '找不到 shard 步骤时必须报 unknown；返回 fixed 会让"判据读不到"被读成"分片是好的"')
  assert.equal(gate.shardFormOf('- name: "Desktop tests shard x"\n  run: |\n    nothing\n'), 'unknown')
})

test('探针接线：必须把 form 交给 checkSizing，且 unknown 不得混进 probe_errors', () => {
  const src = fs.readFileSync(PROBE_PATH, 'utf8')
  assert.match(src, /checkSizing\(\{\s*provenance:\s*fresh,\s*form,?\s*\}\)/, // 只认语义：参数换行/尾逗号/顺序都不该让这条锁红
    '探针没把当前形态交给判据 —— 混池旧口径会原样回来（#3357 那次误报的形态）')
  assert.match(src, /gate\.exitCodeFor\(/, '探针必须用判据侧的出口码表，不得在 main() 里用 if 的书写顺序表达优先级')
  assert.match(src, /EXIT=4 INSUFFICIENT_CURRENT_FORM/, '出口横幅必须复用判据码本身，否则日志里两个名字互相搜不到')
  assert.match(src, /gate\.waitExitBudgetMin\(/, 'workflow 兜底取预算必须用判据侧那一份，不得在探针里抄第二份正则')
  assert.match(src, /censoredUnderPriorBudgetN:\s*censoredUnder\(bucket/, '当前形态的截尾证据必须由形态桶算出并交给判据，否则「贴脸要截尾作证」又回到混池口径')
  assert.match(src, /form_censored=/, '当前形态的截尾证据必须打进现场，否则「贴脸要截尾作证」读起来还是混池口径')
  assert.match(src, /unknowns\.push\(/, 'unknown 样本必须有独立账')
  assert.equal(/errs\.push\(\s*['"`]FORM_/.test(src), false,
    'FORM_* 一律不许进 errs —— PR head 提交本地取不到是结构性的，混进 errs 会让探针永久退 3（等于把新判据自己关掉）')
})

/* ────────── 样本稀缺只削弱"确认"，不削弱"告警"（budget-probe-form-split 第 2 轮）──────────
 * 动因：第 1 轮把 INSUFFICIENT 做成了整条 else 分支的开关 —— 于是"当前形态已经观测到 44 分
 * （预算 45）但只有 14 个样本"这种组合，只剩一句"判不了"，RULE_VIOLATED / NO_LONGER_SIZED
 * 被一起关掉。QM-6 后端轴独立命中同一条；我此前也自己复现过一次。
 * 口径：样本稀缺削弱的是"max 就是真上界"这个**正向结论**（右截尾 ⇒ 观测 max 只会低估），
 * 它削弱不了"确实跑出过一个 44 分"这个**直接证据**。
 */

test('样本不足 + 当前形态自己已违约 ⇒ 两条都要报，稀缺不得吃掉告警（红在结构，不红在措辞）', () => {
  const r = gate.checkSizing({ provenance: freshProvenance(), form: formOf({ gate4SuccessN: 6, shardSuccessN: 8, shardMaxSuccessMin: 44.0 }) })
  assert.equal(r.ok, false)
  assert.ok(r.scarcity.some((x) => /INSUFFICIENT_CURRENT_FORM/.test(x)), '稀缺必须仍然出声：' + r.reasons.join(' ; '))
  assert.ok(r.alarms.some((x) => /RULE_VIOLATED/.test(x)), '观测到 44 分而预算 45 分，"要重定数"不得被样本不足吃掉：' + r.reasons.join(' ; '))
  assert.ok(r.alarms.some((x) => /NO_LONGER_SIZED/.test(x)), '已达 0.9 档同理必须红：' + r.reasons.join(' ; '))
})

test('同形态样本下限按池分别判（Gate 4 够不代表 shard 够）', () => {
  const lopsided = gate.checkSizing({ provenance: freshProvenance(), form: formOf({ gate4SuccessN: 25, shardSuccessN: 3 }) })
  assert.ok(lopsided.scarcity.some((x) => /INSUFFICIENT_CURRENT_FORM/.test(x)),
    'shard 侧只有 3 个样本时不得判"当前形态已确认"——两池分布不同，加总 28 是个假数：' + lopsided.reasons.join(' ; '))
  const both = gate.checkSizing({ provenance: freshProvenance(), form: formOf({ gate4SuccessN: 25, shardSuccessN: 25 }) })
  assert.equal(both.scarcity.length, 0, '两池都达下限后不得再报稀缺：' + both.reasons.join(' ; '))
})

test('出口码是一张表，不是 if 的书写顺序：取数失败 > 告警 > 稀缺 > 贴脸 > 干净', () => {
  const mk = (over) => ({ alarms: [], scarcity: [], hugging: false, ok: true, ...over })
  assert.equal(gate.exitCodeFor(mk({}), 7), 3, '取数失败必须最优先（数字本身不可用）')
  assert.equal(gate.exitCodeFor(mk({ alarms: ['RULE_VIOLATED…'], scarcity: ['INSUFFICIENT_CURRENT_FORM…'], ok: false }), 0), 1, '两者并存时 actionable 的那个赢：读 4 会被当成「还没量够、别动”')
  assert.equal(gate.exitCodeFor(mk({ scarcity: ['INSUFFICIENT_CURRENT_FORM…'], ok: false }), 0), 4)
  assert.equal(gate.exitCodeFor(mk({ alarms: ['unit-tests: timeout-minutes…'], ok: false }), 0), 1)
  assert.equal(gate.exitCodeFor(mk({ hugging: true }), 0), 2, '贴脸但规则仍站得住 ⇒ 要重测的信号')
  assert.equal(gate.exitCodeFor(mk({}), 0), 0)
})

test('形态判定只有一份实现：续行被注释吃掉的 run 也必须是 broken', () => {
  // 第 1 轮 shardFormOf 只看裸 "--" 与 --shard=，而 check() 还看"续行被注释吞掉"和语义层 ——
  // 于是同一次"分片失效"，CI 报红、探针却把它归进 fixed 池，形态分档的前提被自己钻空子。
  const nl = wf.includes('\r\n') ? '\r\n' : '\n'
  const anchor = '            -ArgumentList @('
  const at = wf.indexOf(anchor)
  assert.ok(at > -1, 'workflow 里找不到 -ArgumentList @(...) 锚点 —— 夹具失效，先改这里再谈判据')
  const severed = wf.slice(0, at) + '              # 我把续行顶掉了' + nl + wf.slice(at)
  assert.notEqual(severed, wf, '夹具没改到东西，这条对照失效')
  assert.equal(gate.shardFormOf(severed), 'broken', '续行断裂同样是"分片没生效"，不得判 fixed')
})

test('解析模块本身没了要炸出声，不得被洗成 unknown（unknown 是数据缺失，不是装配断裂）', () => {
  const Module = require('module')
  const orig = Module._load
  let hit = 0
  Module._load = function (request, ...rest) {
    if (String(request).includes('check-desktop-shard-forwarding')) { hit++; throw new Error('MODULE_GONE') }
    return orig.call(this, request, ...rest)
  }
  let threw = null
  try { gate.shardFormOf(wf) } catch (e) { threw = String(e.message) } finally { Module._load = orig }
  assert.equal(hit, 1, '桩没被走到 = 这条用例什么都没测（模块被缓存在别处了）')
  assert.ok(threw && /MODULE_GONE/.test(threw), '把装配断裂读成"这批样本没形态"就是判据失明的第二种形态；got=' + threw)
})

test('预算解析两处健壮性：常量必须锚在声明行，兜底取值不一致就当读不到', () => {
  const prose = '// 历史上 GATE_TEST_BUDGET_MS = 1800000 曾被抄在 workflow 两处' + String.fromCharCode(10) + 'const GATE_TEST_BUDGET_MS = 2700000 // 45 分'
  assert.equal(gate.budgetMinFromGateBudgetText(prose), 45, '正文里的历史叙述不得被当成现行常量')
  assert.equal(gate.budgetMinFromGateBudgetText(''), null, '空文本读不到预算必须返回 null')
  assert.equal(typeof gate.waitExitBudgetMin, 'function', 'workflow 兜底解析要有名字，别散在调用点')
  const twoValues = 'a WaitForExit(2700000) b' + String.fromCharCode(10) + 'c WaitForExit(1800000) d'
  assert.equal(gate.waitExitBudgetMin(twoValues), null, '两处字面量不一致时不得取第一个猜一个')
  const sameTwice = 'a WaitForExit(2700000) b' + String.fromCharCode(10) + 'c WaitForExit(2700000) d'
  assert.equal(gate.waitExitBudgetMin(sameTwice), 45, '两处一致才取值')
})

test('贴脸时的截尾证据也按形态取，不得拿混池旧数充当当前形态的证据', () => {
  const r = gate.checkSizing({ provenance: freshProvenance({ censoredUnderPriorBudgetN: 9 }), form: formOf({ shardMaxSuccessMin: 37.0, censoredUnderPriorBudgetN: 0 }) })
  assert.ok(r.alarms.some((x) => /假上界/.test(x)),
    '当前形态自己贴脸且该形态内零截尾样本 ⇒ 必须报"max 是假上界"，provenance 里的 9 条是别的形态的：' + r.reasons.join(' ; '))
  const ok = gate.checkSizing({ provenance: freshProvenance({ censoredUnderPriorBudgetN: 9 }), form: formOf({ shardMaxSuccessMin: 37.0, censoredUnderPriorBudgetN: 3 }) })
  assert.equal(ok.alarms.some((x) => /假上界/.test(x)), false, '同形态里有一条截尾样本就够（下限 1）')
})

test('perJob 不得被"样本不足"出口吞掉（样本不足只该停统计判据，job 上限是算术事实）', () => {
  const r = gate.checkSizing({
    provenance: freshProvenance(),
    jobTimeouts: { 'unit-tests': 30, 'desktop-shards': 30 },
    form: formOf({ gate4SuccessN: 3, shardSuccessN: 3 }),
  })
  assert.ok(r.scarcity.some((x) => /INSUFFICIENT_CURRENT_FORM/.test(x)), '夹具前提：样本确实不足')
  assert.ok(r.alarms.some((x) => /unit-tests: timeout-minutes 30/.test(x)),
    '30 分 < 预算 45 + 前置 + 余量 是算术事实，与样本量无关，不得一起被吞：' + r.reasons.join(' ; '))
  assert.ok(r.alarms.some((x) => /desktop-shards: timeout-minutes 30/.test(x)))
})
