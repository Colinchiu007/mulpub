'use strict'
/* check-schedule-heartbeat.js 的行为锁（node --test，只用内置模块，零真实出站、零网络）
 *
 * 这把锁防的是"心跳判据自己变成装饰"，所以每一档都必须**可达**且**互不合并**：
 *   OK / LATE / NEVER_RAN / SCANNER_FAULT —— 四个出口各有一条用例，两个退出码（1 与 2）各有一条用例。
 * 合规形态必须绿（H1）：只测"能红"的锁会把自己的修复路径也焊死（本仓反复踩过的同一条）。
 * 采集一律注入：本仓 network-egress-guard 会拦真实出站，任何"在测试里打 GitHub"的写法当场变红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const HB = require('./check-schedule-heartbeat.js')
const { loadWorkflows } = require('./check-schedule-failure-watch.js')

const REPO = process.env.HB_REPO || path.resolve(__dirname, '..')
const NOW = Date.parse('2026-10-23T12:00:00Z')
const HOUR = 3600 * 1000

const NOOP = () => {}
const y = (lines) => lines.join('\n') + '\n'
const wf = (file, crons) => ({ file, name: file, scheduled: true, crons })
/** 相对 NOW 往回推 h 小时的一次「已完成的定时 run」。 */
const beat = (h) => ({ created_at: new Date(NOW - h * HOUR).toISOString(), status: 'completed', event: 'schedule', conclusion: 'success' })
const runsOf = (runs) => () => ({ ok: true, runs })
const judge = (opts) => HB.judge({ now: NOW, env: {}, warn: NOOP, ...opts })
const runMain = (opts) => {
  const lines = []
  const warns = []
  const rc = HB.main({ argv: [], now: NOW, env: {}, log: (s) => lines.push(s), warn: (s) => warns.push(s), ...opts })
  return { rc, lines, warns }
}

function fixture (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbfix-'))
  const wd = path.join(dir, '.github', 'workflows')
  fs.mkdirSync(wd, { recursive: true })
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(wd, name), body, 'utf8')
  return dir
}
const SCHED_DAILY = (title) => y(['name: ' + title, 'on:', '  schedule:', "    - cron: '23 3 * * *'", 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps: []'])

test('H1 新鲜绿控：daily 作业 3 小时前跑过 ⇒ OK 且退出码 0（合规形态不得红）', () => {
  const workflows = [wf('cleanup-artifacts.yml', ['23 3 * * *'])]
  const r = judge({ workflows, runsOf: runsOf([beat(3)]) })
  assert.equal(r.verdict, 'OK')
  assert.deepEqual(r.faults, [])
  const { rc, lines } = runMain({ workflows, runsOf: runsOf([beat(3)]) })
  assert.equal(rc, 0, '合规形态必须 0，否则每天都是自己咬自己的假红')
  assert.match(lines[0], /判定=OK/)
  assert.match(lines[0], /workflows=1 late=0 never=0 faults=0/)
  assert.match(lines[0], /slack_hours=8\(default\)/)
})

test('H2 LATE：daily 作业 40 小时前跑过 ⇒ 红并点名文件 + age_hours + 阈值', () => {
  const workflows = [wf('cleanup-artifacts.yml', ['23 3 * * *'])]
  const { rc, lines } = runMain({ workflows, runsOf: runsOf([beat(40)]) })
  assert.equal(rc, 1)
  const late = lines.find((l) => l.startsWith('  LATE'))
  assert.ok(late, '必须有一行 LATE 明细：' + lines.join(' / '))
  assert.match(late, /LATE cleanup-artifacts\.yml/)
  assert.match(late, /period=daily/)
  assert.match(late, /age_hours=40\.0/)
  assert.match(late, /阈值_hours=32\.0/)
})

test('H3 边界：阈值取「严格大于」——正好 32h 绿、多 1 秒红（差 1 秒即翻转）', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const exact = judge({ workflows, runsOf: runsOf([{ created_at: new Date(NOW - (24 * HOUR + 8 * HOUR)).toISOString(), status: 'completed', event: 'schedule' }]) })
  assert.equal(exact.rows[0].verdict, 'OK', '正好等于阈值不得算迟到（>=/> 取向必须由用例钉住）')
  const over = judge({ workflows, runsOf: runsOf([{ created_at: new Date(NOW - (24 * HOUR + 8 * HOUR + 1000)).toISOString(), status: 'completed', event: 'schedule' }]) })
  assert.equal(over.rows[0].verdict, 'LATE')
})

test('H4 NEVER_RAN 与 SCANNER_FAULT 是两个档、两个退出码（不得合并）', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const never = runMain({ workflows, runsOf: runsOf([]) })
  assert.equal(never.rc, 1)
  assert.match(never.lines[0], /判定=FAIL/)
  assert.match(never.lines.find((l) => l.startsWith('  NEVER_RAN')), /completed_schedule_run=0/)
  const blind = runMain({ workflows, runsOf: () => ({ ok: false, error: 'gh api 失败：HTTP 404' }) })
  assert.equal(blind.rc, 2, '工具失明必须走 2；并进 1 会让下一个人以为"那天真的没跑"')
  assert.match(blind.lines[0], /判定=SCANNER_FAULT/)
  assert.match(blind.lines.find((l) => l.startsWith('  SCANNER_FAULT')), /HTTP 404/)
})

test('H5 别的 event 不算心跳：只有 push run 的作业必须判 NEVER_RAN（形状判据的反例夹具）', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const runs = [
    { created_at: new Date(NOW - 1 * HOUR).toISOString(), status: 'completed', event: 'push', conclusion: 'success' },
    { created_at: new Date(NOW - 2 * HOUR).toISOString(), status: 'completed', event: 'workflow_dispatch', conclusion: 'success' },
    { created_at: new Date(NOW - 3 * HOUR).toISOString(), status: 'completed', event: 'pull_request', conclusion: 'failure' },
  ]
  const r = judge({ workflows, runsOf: runsOf(runs) })
  assert.equal(r.rows[0].verdict, 'NEVER_RAN')
  assert.equal(r.rows[0].last, null, 'last 不得被 push run 的时间顶替（顶替了就等于把"没兑现"读成"很新鲜"）')
  assert.equal(r.rows[0].collected, 3)
})

test('H6 queued / in_progress 不算兑现：只有 status=completed 才算一次心跳', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const runs = [
    { created_at: new Date(NOW - 1 * HOUR).toISOString(), status: 'in_progress', event: 'schedule', conclusion: null },
    { created_at: new Date(NOW - 2 * HOUR).toISOString(), status: 'queued', event: 'schedule', conclusion: null },
  ]
  assert.equal(judge({ workflows, runsOf: runsOf(runs) }).rows[0].verdict, 'NEVER_RAN')
  // conclusion=failure **算**一次心跳：本判据问"跑没跑"，"跑失败"归报警那一刀管
  const failed = [{ created_at: new Date(NOW - 3 * HOUR).toISOString(), status: 'completed', event: 'schedule', conclusion: 'failure' }]
  assert.equal(judge({ workflows, runsOf: runsOf(failed) }).rows[0].verdict, 'OK')
})

test('H7 多行 cron 取最短周期：daily+weekly 同作业按 daily 判迟到（与声明顺序无关）', () => {
  const both = (crons) => [wf('a.yml', crons)]
  for (const crons of [['0 18 * * 3', '23 3 * * *'], ['23 3 * * *', '0 18 * * 3']]) {
    const r = judge({ workflows: both(crons), runsOf: runsOf([beat(33)]) })
    assert.equal(r.rows[0].period, 'daily', JSON.stringify(crons) + ' 应按最短周期判')
    assert.equal(r.rows[0].verdict, 'LATE')
    assert.equal(judge({ workflows: both(crons), runsOf: runsOf([beat(30)]) }).rows[0].verdict, 'OK')
  }
})

test('H8 cron 推不出周期 ⇒ SCANNER_FAULT 且退出码 2（禁止"未知就当 daily"）', () => {
  const cases = [
    ['0 3 * 1 1', 'mon 非星号'],
    ['30 6 * *', '只有 4 段'],
    ['0 3 1,15 * *', 'dom 是逗号列表'],
    ['*/15 * * * *', '分钟是步进'],
  ]
  for (const [cron, why] of cases) {
    const { rc, lines } = runMain({ workflows: [wf('a.yml', [cron])], runsOf: runsOf([beat(1)]) })
    assert.equal(rc, 2, why + ' 必须走"我不知道"档，拿到 ' + lines[0])
    assert.ok(lines.some((l) => l.startsWith('  SCANNER_FAULT') && l.includes(JSON.stringify(cron))), why + ' 必须点名原串：' + lines.join(' / '))
  }
})

test('H9 env 纪律：abc / 0 / -5 各回落 8 并打印 warn；24 生效并被首行读到', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  for (const bad of ['abc', '0', '-5', 'NaN']) {
    const { rc, lines, warns } = runMain({ workflows, runsOf: runsOf([beat(3)]), env: { MP_SCHEDULE_HEARTBEAT_SLACK_HOURS: bad } })
    assert.equal(rc, 0, bad + ' 应回落默认 8（33h 迟到才该红，这里 3h 是绿的）')
    assert.match(lines[0], /slack_hours=8\(invalid-fallback\)/, bad + ' 的回落必须被标出来')
    assert.equal(warns.filter((l) => /MP_SCHEDULE_HEARTBEAT_SLACK_HOURS/.test(l)).length, 1, bad + '：静默回落＝配置错误永远不被知道')
  }
  const wide = runMain({ workflows, runsOf: runsOf([beat(40)]), env: { MP_SCHEDULE_HEARTBEAT_SLACK_HOURS: '24' } })
  assert.equal(wide.rc, 0, 'slack=24 时 40h 仍在 48h 阈值内')
  assert.match(wide.lines[0], /slack_hours=24\(env\)/)
  assert.match(wide.lines.find((l) => l.startsWith('  OK')), /阈值_hours=48\.0/)
})

test('H10 provenance：预算必须 ≥ 实测最大间隔，样本量与重测命令都要在册', () => {
  const P = HB.HEARTBEAT_PROVENANCE
  assert.ok(typeof P.remeasure === 'string' && P.remeasure.includes('gh api'), '出处必须是一条能原样重跑的取数命令，不是死数')
  assert.ok(Number.isInteger(P.minSamples) && P.minSamples >= 3, '样本量下界必须写出来')
  for (const kind of ['daily', 'weekly']) {
    const budget = HB.PERIODS[kind] + P.slackHours * HOUR
    assert.ok(budget >= P.maxIntervalRatio * HB.PERIODS[kind], `${kind} 阈值 ${budget / HOUR}h 低于实测 ×${P.maxIntervalRatio}`)
  }
  for (const [file, n] of Object.entries(P.samplesPerWorkflow)) {
    assert.ok(Number.isInteger(n) && n > 0, `${file} 的样本数必须是正整数（低于下界也要写数量）`)
  }
  assert.ok(P.unmeasuredKinds.includes('monthly'), 'monthly 是 31 天的保守上界、没有实测样本，必须逐字承认')
})

test('H11 真仓规模下界：带 schedule 的作业 ≥ 4 且每条都推得出周期（推不出即红，不许"未知就跳过"）', () => {
  const scheduled = loadWorkflows(REPO).filter((w) => w.scheduled)
  assert.ok(scheduled.length >= 4, `真仓只扫到 ${scheduled.length} 条带 schedule 的作业 ⇒ 判据域退化`)
  const r = judge({ workflows: scheduled, runsOf: runsOf([beat(1)]) })
  assert.deepEqual(r.faults.map((f) => `${f.file}: ${f.reason}`), [], '真仓里每条作业的 cron 都必须推得出周期')
  assert.equal(r.rows.length, scheduled.length)
  assert.ok(r.rows.every((row) => ['daily', 'weekly', 'monthly'].includes(row.period)), JSON.stringify(r.rows.map((x) => [x.file, x.period])))
})

test('H12 接线锁：心跳作业自带 schedule、点名跑判据与行为锁，且被报警名单收走（两把锁互咬）', () => {
  const rows = loadWorkflows(REPO)
  const hb = rows.find((r) => r.file === 'schedule-heartbeat.yml')
  assert.ok(hb, 'schedule-heartbeat.yml 必须存在')
  assert.equal(hb.scheduled, true, '心跳作业自己必须带 on.schedule —— 它正是被本判据守的那类作业')
  assert.ok(HB.periodFromCron(hb.crons[0]), `心跳作业的 cron 必须推得出周期，拿到 ${JSON.stringify(hb.crons)}`)
  // 行尾先归一再匹配：这些 workflow 在工作副本里是 CRLF（i/lf w/crlf），而 `/bash$/m` 里的 `$`
  // 不会跨过 \r —— 不归一的话同一份文件在"检出成 CRLF 的机器"上是假红、在"直接写 LF 的机器"上是绿。
  const txt = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'schedule-heartbeat.yml'), 'utf8').replace(/\r\n/g, '\n')
  // 接线判据必须**剥掉注释行**再匹配执行体：本文件第 38 行的说明文字里原样出现了脚本名，
  // 按"文件里有没有这个串"判，摘掉真正的 run 那一行照样绿（AGENTS 点名的"注释对门禁算正文"同型，
  // 本刀由变异 m12 实测打红过第一次）。
  const code = txt.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.ok(code.includes('node scripts/check-schedule-heartbeat.js'), '判据本体必须在这个作业里被点名执行（否则锁存在但没有执行体）')
  assert.ok(code.includes('node --test scripts/check-schedule-heartbeat.test.js'), '行为锁也要在同一作业里跑一遍（防"只有 PR 侧跑"）')
  assert.match(txt, /^[ \t]*shell:[ \t]*bash[ \t]*$/m, '多条测试命令的 run 块必须 fail-fast（bash -e -o pipefail）')
  assert.match(txt, /^[ \t]*timeout-minutes:[ \t]*\d+/m)
  assert.match(txt, /actions:[ \t]*read/)
  const handler = rows.find((r) => r.file === 'ci-failure-handler.yml')
  assert.ok(handler && handler.runList, '读不到 handler 名单 ⇒ 这条接线锁无从判定')
  assert.ok(handler.runList.includes(hb.name), `心跳作业没进报警名单 ⇒ Gate 2b13 会红；名单="${handler.runList.join(',')}"`)
  // 预算格：登记必须在册，且**登记数 == 声明数**。为什么要这一格（m17/m18/m19 三条变异各测一半）：
  // Gate 2b7 能抓"登记数与声明数分叉"（m18 实测两边都红），也能抓"登记了但 jobId 写错"（m17 同上）；
  // 但它的**枚举域取自注册表自己的 workflow 列表**（check-coverage-budget.js:239），
  // 所以"新增一整个 workflow 文件而压根没登记"对它不可见 —— m19 实测：删掉整格后 Gate 2b7 照绿，只有这条红。
  const reg = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'gate-timeout-registry.json'), 'utf8'))
  const cell = reg.jobs.find((x) => x.workflow === '.github/workflows/schedule-heartbeat.yml' && x.jobId === 'schedule-heartbeat')
  assert.ok(cell, '新作业的 timeout-minutes 必须在注册表里有格；漏登记不会被 Gate 2b7 抓到（枚举域来自注册表自身），只能由这条补')
  assert.ok(['measured', 'seeded'].includes(cell.state), 'state 必须是闭集，实际 ' + cell.state)
  const declared = Number(txt.match(/^[ \t]*timeout-minutes:[ \t]*(\d+)/m)[1])
  assert.equal(cell.timeoutMinutes, declared, `登记数(${cell.timeoutMinutes}) 与 workflow 声明数(${declared}) 不一致 ⇒ 两处各说一套`)
})

test('H13 采集器：argv 带 --jq 与三个必需字段；gh 抛错/非数组/字段缺席一律"取不到数"', () => {
  const calls = []
  const exec = (cmd, args) => { calls.push({ cmd, args }); return JSON.stringify([beat(1)]) }
  const runsOf2 = HB.makeGhCollector({ repo: 'o/r', exec })
  const res = runsOf2('cleanup-artifacts.yml')
  assert.equal(res.ok, true)
  assert.deepEqual(calls.length, 1)
  assert.equal(calls[0].cmd, 'gh')
  assert.ok(calls[0].args.includes('--jq'), '必须让 gh 自己剥壳，判据侧只认扁平数组')
  const joined = calls[0].args.join(' ')
  for (const f of HB.REQUIRED_RUN_FIELDS) assert.ok(joined.includes(f), `jq 投影里少了 ${f} ⇒ 判据永远读不到它`)
  assert.ok(!calls[0].args[1].includes('event=schedule'), '查询里带 event=schedule 会让判据侧的 event 过滤变成死码，并丢掉"只有 push run"这一现场信息')

  const boom = HB.makeGhCollector({ repo: 'o/r', exec: () => { throw new Error('ETIMEDOUT') } })
  assert.equal(boom('a.yml').ok, false, '采集挂死必须是取不到数，不是静默跳过')

  assert.equal(HB.parseRunsJson('{"workflow_runs":[]}', 'a.yml').ok, false, '忘记 --jq 时 gh 返回的是信封对象 ⇒ 必须判失明而不是空列表')
  const wrongField = () => ({ ok: true, runs: [{ created_at: new Date(NOW - HOUR).toISOString(), state: 'completed', event: 'schedule' }] })
  const r = judge({ workflows: [wf('a.yml', ['23 3 * * *'])], runsOf: wrongField })
  assert.equal(r.verdict, 'SCANNER_FAULT')
  assert.match(r.faults[0].reason, /缺必需字段 status/, '字段名写错必须落"取不到数"，不得读成"没有 run"')

  const noCalls = []
  const guarded = HB.makeGhCollector({ repo: 'o/r', exec: (cmd, args) => { noCalls.push(args); return '[]' } })
  for (const bad of ['../evil.yml', 'a.sh', '']) assert.equal(guarded(bad).ok, false, `${bad} 不该被拼进 API 路径`)
  assert.deepEqual(noCalls, [], '文件名不合时必须 fail closed，一次调用都不发')
  assert.throws(() => HB.makeGhCollector({ repo: '' }), /GITHUB_REPOSITORY/)
})

test('H15 参数面：--limit N 与 --limit=N 两种写法都要生效，且判定只按被限定的那一组算', () => {
  // 第 3 条作业是迟到的：limit=2 时它不进判定域（smoke 档），不传 limit 时必须红。
  const workflows = [
    wf('a.yml', ['23 3 * * *']),
    wf('b.yml', ['23 3 * * *']),
    wf('c.yml', ['23 3 * * *']),
  ]
  const runsOf = (file) => ({ ok: true, runs: [file === 'c.yml' ? beat(100) : beat(2)] })
  for (const argv of [['--limit', '2'], ['--limit=2']]) {
    const { rc, lines } = runMain({ argv, workflows, runsOf })
    assert.equal(rc, 0, JSON.stringify(argv) + ' 未被生效解析时，c.yml 的迟到会把 smoke 档判成红：' + lines[0])
    assert.match(lines[0], /workflows=3 late=0 never=0 faults=0/)
    assert.equal(lines.filter((l) => /^  (OK|LATE|NEVER_RAN|SCANNER_FAULT) /.test(l)).length, 2, JSON.stringify(argv) + ' 的明细行数必须真的被限定')
  }
  const full = runMain({ argv: [], workflows, runsOf })
  assert.equal(full.rc, 1, '不带 limit 时同一条迟到作业必须红（否则上面的绿是探针失明）')
  for (const argv of [['--limit', '0'], ['--limit', 'x'], ['--limit'], ['--nope'], ['a.yml', 'b.yml']]) {
    const { rc, lines } = runMain({ argv, workflows, runsOf })
    assert.equal(rc, 2, JSON.stringify(argv) + ' 必须走自身故障档而不是被静默忽略：' + lines.join(' / '))
  }
})

test('H16 判据域为空 ⇒ SCANNER_FAULT（"没扫到作业"绝不等于"作业都按时跑了"）', () => {
  const workflows = [{ file: 'push-only.yml', name: 'push-only', scheduled: false, crons: [] }]
  const r = judge({ workflows, runsOf: runsOf([]) })
  assert.equal(r.verdict, 'SCANNER_FAULT')
  assert.equal(r.rows.length, 0)
  assert.match(r.faults[0].reason, /一条带 schedule 的作业都没扫到/)
  const { rc, lines } = runMain({ workflows, runsOf: runsOf([]) })
  assert.equal(rc, 2, '域级失明不在 rows 里，退出码必须另加回来')
  assert.match(lines[0], /判定=SCANNER_FAULT/)
  assert.ok(lines.some((l) => l.includes('一条带 schedule 的作业都没扫到')), lines.join(' / '))
})

test('H14 loader 的 crons：块内全收、块外一律不收、行尾注释剥掉（精确数组断言）', () => {
  const dir = fixture({
    'multi.yml': y(['name: Multi', 'on:', '  schedule:', "    - cron: '23 3 * * *'", "    - cron: '0 18 * * 3'", 'jobs:', '  a:', '    steps: []']),
    'outside.yml': y(['name: Outside', 'on:', '  schedule:', "    - cron: '23 3 * * *'", '  workflow_dispatch:', 'env:', '  CRON_TABLE: |', "    - cron: '0 0 1 1 *'", 'jobs:', '  a:', '    steps: []']),
    'comment.yml': y(['name: Comment', 'on:', '  schedule:', "    - cron: '10 22 * * *' # 每天 22:10 UTC", 'jobs:', '  a:', '    steps: []']),
    'plain.yml': SCHED_DAILY('Plain'),
  })
  try {
    const by = Object.fromEntries(loadWorkflows(dir).map((r) => [r.file, r]))
    assert.deepEqual(by['multi.yml'].crons, ['23 3 * * *', '0 18 * * 3'], '两行 cron 必须全收，否则周报被读成日报')
    assert.deepEqual(by['outside.yml'].crons, ['23 3 * * *'], 'schedule 块之外出现的 cron 字样不得被当成一次定时声明')
    assert.deepEqual(by['comment.yml'].crons, ['10 22 * * *'], '行尾注释必须剥掉，否则周期推导拿到的是带注释的串')
    assert.deepEqual(by['plain.yml'].crons, ['23 3 * * *'])
    assert.equal(by['plain.yml'].name, 'Plain')
    assert.deepEqual(by['plain.yml'].scheduled, true)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
