'use strict'
/* 变异反证驱动：check-schedule-heartbeat（change: schedule-heartbeat-lock）
 *
 * 目的不是"证明测试能红"，而是**证明每条锁真的在守它声称的那个东西**。
 * 七条硬约束（1-5 是本仓踩过的坑，6-7 由上一刀的 QM-6 评审命中后固化）：
 *  1. 动手前先读原始字节建基线，并在每条变异前复核"文件没被别人改过"——
 *     崩溃一次的驱动会把污染态固化成 ORIG，后续全部建立在脏基线上（本仓实测踩过）。
 *  2. 每条变异的锚点必须**恰命中 1 次**，且目标文本在改前不得已存在（防重复改）。
 *  3. 应用后先 `node --check`，语法坏掉记 PROBLEM 而不是 MISSED——
 *     "整片 LOADFAIL"不是"这条锁没牙"，是驱动自己把被测物毁了。
 *  4. 每个靶子套件必须**真的被收集**（`# tests N`，N ≥ 下界）；一个没跑的文件在摘要里
 *     与"跑了且绿"完全同形，所以 collected 低于下界一律 UNREADABLE ⇒ PROBLEM。
 *  5. 还原后立即重跑一次被测锁，全绿才继续下一条（防"改坏了没还原"）。
 *  6. MISSED 只允许是**声明过的**重叠防呆（ALLOWED_MISSED），且重叠必须由另一条变异机械证明；
 *     否则算失败。本驱动当前不允许任何 MISSED。
 *  7. 写后必须回读：锚点命中数只证明"它在原文里唯一"，不证明"盘上现在是被改后的内容"。
 *
 * 行尾：靶子文件有的在工作副本是 CRLF（workflows/*.yml、check-schedule-failure-watch.js）、
 * 有的是 LF（本刀新建的两个 js）。锚点一律按"归一行尾后的文本"匹配，写回时按原文件的
 * 实际行尾还原分隔符——变异是临时的，但绝不留下混行尾。
 *
 * 用法：node scripts/check-schedule-heartbeat.mutation.js            # 全部
 *       node scripts/check-schedule-heartbeat.mutation.js m3 m5      # 只跑指定 id
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const JUDGE = 'scripts/check-schedule-heartbeat.js'
const LOCKS = 'scripts/check-schedule-heartbeat.test.js'
const WATCH = 'scripts/check-schedule-failure-watch.js'
const WATCHLOCKS = 'scripts/check-schedule-failure-watch.test.js'
const HBWF = '.github/workflows/schedule-heartbeat.yml'
const HND = '.github/workflows/ci-failure-handler.yml'
const REG = 'scripts/gate-timeout-registry.json'

const SUITES = [
  { file: LOCKS, minTests: 16 },
  { file: WATCHLOCKS, minTests: 13 },
  // 第三套是**对照**：m17（把登记格子的 jobId 写错）它也必须红，m18（workflow 里的数与登记数分叉）它必须绿。
  // 后者不是失败，而是要在现场演示的那件事 —— Gate 2b7 的枚举域取自注册表自身（check-coverage-budget.js:239），
  // 所以"两处各说一套"只有本刀的 H12 看得见。把它列进靶子套件，这个结论就是读数而不是我的话。
  { file: 'scripts/check-coverage-budget.test.js', minTests: 26 },
]

/* 每条都写「它还活着时会拦住什么」——红文案将来指不回这句话，就说明这条变异是白做的。 */
const MUTATIONS = [
  {
    id: 'm1', file: JUDGE,
    note: '摘掉 status=completed 过滤 ⇒ 排队中/进行中的 run 被当成一次心跳兑现（永不 NEVER_RAN）',
    from: "    if (r.event !== 'schedule' || r.status !== 'completed') continue",
    to: "    if (r.event !== 'schedule') continue",
    expect: ['H6'],
  },
  {
    id: 'm2', file: JUDGE,
    note: '摘掉 event=schedule 过滤 ⇒ 只有 push run 的作业被读成"cron 按时兑现了"',
    from: "    if (r.event !== 'schedule' || r.status !== 'completed') continue",
    to: "    if (r.status !== 'completed') continue",
    expect: ['H5'],
  },
  {
    id: 'm3', file: JUDGE,
    note: '阈值从「周期 + 宽限」退化成「周期」⇒ 实测漂移 5.68h 会天天假红，且 32h 边界翻面',
    from: '    row.thresholdHours = (sp.period.ms + slackHours * HOUR) / HOUR',
    to: '    row.thresholdHours = (sp.period.ms) / HOUR',
    expect: ['H3', 'H9'],
  },
  {
    id: 'm4', file: JUDGE,
    note: '边界取向从「严格大于」改成「大于等于」⇒ 正好等于阈值的作业被误判迟到',
    from: '    if (row.ageHours > row.thresholdHours)',
    to: '    if (row.ageHours >= row.thresholdHours)',
    expect: ['H3'],
  },
  {
    id: 'm5', file: JUDGE,
    note: 'mon 位不合时不再"推不出"而是继续往下猜 ⇒ 无法判定的 cron 形状永远不出声，周报被按周判',
    from: "  if (mon !== '*') return null",
    to: "  if (mon === '__unreachable__') return null",
    expect: ['H8'],
  },
  {
    id: 'm6', file: JUDGE,
    note: '把 SCANNER_FAULT 并进 FAIL（退出码 1）⇒ 下一个修判据的人会把"我不知道"读成"那天真的没跑"',
    from: "  return verdict === 'SCANNER_FAULT' ? 2 : (verdict === 'FAIL' ? 1 : 0)",
    to: "  return (verdict === 'FAIL' || verdict === 'SCANNER_FAULT') ? 1 : 0",
    expect: ['H4', 'H8', 'H16'],
  },
  {
    id: 'm7', file: JUDGE,
    note: '必需字段校验从抛错改成跳过 ⇒ 采集器读错字段名（status/state）时"取不到数"退化成"没有 run"',
    from: "      if (typeof r[k] !== 'string' || r[k] === '') throw new Error(`run[${i}] 缺必需字段 ${k}（采集器与 API 契约漂移）`)",
    to: "      if (typeof r[k] !== 'string' || r[k] === '') continue",
    expect: ['H13'],
  },
  {
    id: 'm8', file: JUDGE,
    note: '查询里加回 event=schedule ⇒ 判据侧的 event 过滤变成死码，"只有 push run"这一现场信息也被丢掉',
    from: 'runs?per_page=${perPage}',
    to: 'runs?event=schedule&per_page=${perPage}',
    expect: ['H13'],
  },
  {
    id: 'm9', file: JUDGE,
    note: '判据域为空不再报失明 ⇒ 一条作业都没扫到时打印全绿（本仓点名的"按目录里有什么迭代"同型）',
    from: '  if (scheduled.length === 0) {',
    to: '  if (false) {',
    expect: ['H16'],
  },
  {
    id: 'm10', file: JUDGE,
    note: '--limit 整个被忽略 ⇒ smoke 档与全量档同形，"只跑前 2 条"被放大成整域',
    from: '  const scoped = parsed.limit === null ? r.rows : r.rows.slice(0, parsed.limit)',
    to: '  const scoped = r.rows',
    expect: ['H15'],
  },
  {
    id: 'm11', file: JUDGE,
    note: '把 --limit 退回"只认 --limit=N"这一被规则明文禁止的旧形态 ⇒ 空格写法被静默丢弃',
    from: "    if (a === '--limit') o.limit = posInt('--limit', next())",
    to: "    if (a === '--limit') i += 1",
    expect: ['H15'],
  },
  {
    id: 'm12', file: HBWF,
    note: '摘掉心跳作业里点名执行判据那一行 ⇒ 判据存在但没有执行体（装饰性门禁）',
    from: '        run: node scripts/check-schedule-heartbeat.js --explain',
    to: '        run: echo "heartbeat judge not wired"',
    expect: ['H12'],
  },
  {
    id: 'm13', file: HBWF,
    note: '把 permissions 的 actions: read 换成别的 ⇒ 心跳作业读不到 run 历史，采集必然失败',
    from: '  actions: read',
    to: '  checks: read',
    expect: ['H12'],
  },
  {
    id: 'm14', file: HND,
    note: '把心跳作业在报警名单里的名字改掉 ⇒ Gate 2b13 与本锁的互咬必须当场响（两把锁各红各的）',
    from: '      "定时作业心跳巡检",',
    to: '      "已被改名的作业",',
    expect: ['H12'],
    alsoExpectWatch: ['T7'],
  },
  {
    id: 'm15', file: WATCH,
    note: 'crons 只取第一条 ⇒ 同一作业多行 cron 时，周报被读成日报（周期推错且不可归因）',
    from: "      out.push(l.slice(l.indexOf('cron:') + 5).replace(/\\s+#.*$/, '').trim().replace(/^[\"']|[\"']$/g, ''))",
    to: "      out.push(l.slice(l.indexOf('cron:') + 5).replace(/\\s+#.*$/, '').trim().replace(/^[\"']|[\"']$/g, ''))\n      break",
    expect: ['H14'],
  },
  {
    id: 'm16', file: WATCH,
    note: '取消 schedule 块的缩进边界 ⇒ 别处出现的 cron 字样被当成一次定时声明收进周期推导',
    from: '      if (l.match(/^[ \\t]*/)[0].length <= schedIndent) break',
    to: '      if (false) break',
    expect: ['H14'],
  },
  {
    id: 'm17', file: REG,
    note: '把心跳作业那格预算的 jobId 写错 ⇒ 登记与真源错位（Gate 2b7 与本锁**同时**红，实测还多红一条 budget 13）',
    from: '"workflow": ".github/workflows/schedule-heartbeat.yml", "jobId": "schedule-heartbeat"',
    to: '"workflow": ".github/workflows/schedule-heartbeat.yml", "jobId": "schedule-heartbeat-typo"',
    expect: ['H12'],
    alsoExpectBudget: ['22'],
  },
  {
    id: 'm18', file: HBWF,
    note: '把 workflow 里声明的 timeout-minutes 从 10 改成 12（登记数仍是 10）⇒ 数字漂移这一格**两把锁都红**：' +
      '本刀 H12 与 Gate 2b7 的 budget 用例 22。我最初把这条写成"只有 H12 红"，被 expectGreen 当场否证——' +
      '改成如实的"两边都红"，真正的盲区是 m19 那一格',
    from: '    timeout-minutes: 10',
    to: '    timeout-minutes: 12',
    expect: ['H12'],
    alsoExpectBudget: ['22'],
  },
  {
    id: 'm19', file: REG, kind: 'drop-line',
    /* 这才是本刀补那一格的真正理由：`check-coverage-budget.js:239` 的枚举域取自**注册表自己的 workflow 列表**，
     * 所以"新增一整个 workflow 文件而预算没登记"对它结构上不可见 —— 删掉整格后 cells 与 jobs 一起少一，
     * 照样报"全部同源、无未登记、无消失"。这条读数不是我的话：驱动要求 budget 套件**全绿**才算 CAUGHT。 */
    note: '从注册表删掉心跳作业那一格（整行）⇒ 只有 H12 红，Gate 2b7 那套必须照绿——它看不见"该登记却没登记的新文件"',
    from: '"jobId": "schedule-heartbeat"',
    to: '',
    expect: ['H12'],
    expectGreen: ['scripts/check-coverage-budget.test.js'],
  },
  {
    id: 'msanity', file: LOCKS,
    /* 这一条不是被测锁的防呆，而是**驱动自己的体检**：把一个期望值改成明显错的数，
     * 若仍然"没红"，说明驱动根本没在读 TAP（`# tests 0`、ANSI 残片、ENOENT 三形态都长这样）。 */
    note: '把 H2 的阈值期望改成 99.0 ⇒ 若这条不红，是驱动失明，不是锁没牙',
    from: '  assert.match(late, /阈值_hours=32\\.0/)',
    to: '  assert.match(late, /阈值_hours=99\\.0/)',
    expect: ['H2'],
  },
]

const ALLOWED_MISSED = new Set()

function read (rel) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) throw new Error(`SUITES/靶子文件不存在：${rel}（驱动拒绝在缺件的环境里出读数）`)
  return fs.readFileSync(p, 'utf8')
}
function write (rel, text) { fs.writeFileSync(path.join(ROOT, rel), text, 'utf8') }
/** 锚点用 LF 书写；按被改物的真实行尾展开（写回时不引入混行尾）。 */
function expand (text, s) { return text.includes('\r\n') ? s.split('\n').join('\r\n') : s }

function suiteRun (suite) {
  const r = spawnSync(process.execPath, ['--test', suite.file], { cwd: ROOT, encoding: 'utf8' })
  const out = String(r.stdout || '')
  const err = String(r.stderr || '')
  const m = out.match(/^# tests (\d+)$/m)
  const f = out.match(/^# fail (\d+)$/m)
  const reds = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1].trim())
  const collected = m ? Number(m[1]) : null
  const failCount = f ? Number(f[1]) : null
  // 下界只对**本刀的**两套是合同；对借来的对照套件，缩水属于别人的重构，
  // 文案必须点名"是别人的套件变了，不是我的驱动坏了"，否则下一次归因会去查错的地方。
  const own = suite.file === LOCKS || suite.file === WATCHLOCKS
  if (collected === null || failCount === null) {
    return { ok: false, why: `UNREADABLE(${suite.file}) tests=${m ? m[1] : '无'} fail=${f ? f[1] : '无'} rc=${r.status} stderr=${err.slice(0, 160)}` }
  }
  if (collected < suite.minTests) {
    return {
      ok: false,
      why: `UNREADABLE(${suite.file}) collected=${collected} < 下界 ${suite.minTests}（` +
        (own ? '本刀自己的套件收集数退化 ⇒ 有文件没跑完' : '对照套件缩水：那是**别人**的档改了，不是本驱动坏了 ⇒ 按现读数重设下界') + '）',
    }
  }
  if (r.status !== 0 && reds.length === 0) {
    return { ok: false, why: `UNREADABLE(${suite.file}) rc=${r.status} 但失败清单为空（worker 被杀 / LOADFAIL 一类），stdout 尾部：${out.slice(-400)}` }
  }
  return { ok: true, suite: suite.file, collected, failCount, reds }
}

const nameHit = (reds, want) => reds.some((r) => r === want || r.startsWith(want + ' '))

function restoreAll (orig) {
  for (const [f, text] of Object.entries(orig)) {
    if (read(f) !== text) write(f, text)
    if (read(f) !== text) throw new Error(`还原失败：${f}`)
  }
}

function runAll () {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  if (only.length) {
    const unknown = only.filter((id) => !MUTATIONS.some((m) => m.id === id))
    if (unknown.length) throw new Error(`未知变异 id：${unknown.join(',')}（参数不得被静默忽略）`)
  }
  const targets = [...new Set(MUTATIONS.map((m) => m.file))]
  // 缺件出声**一次**：让每条变异各报一遍 UNREADABLE 会把"环境不对"演成"20 条锁都没牙"。
  for (const s of SUITES) read(s.file)
  const orig = Object.fromEntries(targets.map((f) => [f, read(f)]))
  for (const m of MUTATIONS) {
    const src = orig[m.file]
    const from = expand(src, m.from)
    const hits = src.split(from).length - 1
    if (hits !== 1) throw new Error(`${m.id} 在 ${m.file} 的锚点命中 ${hits} 次（要求恰为 1）`)
    if (m.kind === 'drop-line') {
      const lines = src.split('\n').filter((l) => l.includes(from))
      if (lines.length !== 1) throw new Error(`${m.id} 是 drop-line，但含锚点的行有 ${lines.length} 行`)
      continue
    }
    if (m.to !== '' && src.split(expand(src, m.to)).length - 1 !== 0) throw new Error(`${m.id} 的目标文本在改前已存在于 ${m.file}`)
  }
  // 探针自证：驱动要求"某条用例必须红"，就先确认那条用例真的在文件里（否则 reds 永远不可能含它，MISSED 是假的）。
  const namePool = read(LOCKS) + read(WATCHLOCKS) + read('scripts/check-coverage-budget.test.js')
  for (const m of MUTATIONS) {
    for (const want of [...m.expect, ...(m.alsoExpectWatch || []), ...(m.alsoExpectBudget || [])]) {
      if (!namePool.includes(`'${want}`)) throw new Error(`${m.id} 要求 ${want} 必须红，但行为锁文件里没有这个用例名（探针指向不存在的东西）`)
    }
    for (const g of m.expectGreen || []) {
      if (!SUITES.some((s) => s.file === g)) throw new Error(`${m.id} 要求 ${g} 保持绿，但它不在靶子套件清单里（这句声明无从验证）`)
    }
  }

  const results = []
  let attempted = 0
  try {
    for (const m of MUTATIONS) {
      if (only.length && !only.includes(m.id)) continue
      attempted++
      const before = read(m.file)
      if (before !== orig[m.file]) { results.push({ id: m.id, state: 'PROBLEM', why: `开工前 ${m.file} 已被别人改过，拒绝在脏基线上做变异` }); break }
      const src = expand(before, m.from)
      let mutated
      if (m.kind === 'drop-line') {
        const keep = before.split('\n').filter((l) => !l.includes(src))
        if (before.split('\n').length - keep.length !== 1) { restoreAll(orig); results.push({ id: m.id, state: 'PROBLEM', why: 'drop-line 删掉的行数不是 1，立即还原' }); break }
        mutated = keep.join('\n')
      } else {
        mutated = before.split(src).join(expand(before, m.to))
      }
      write(m.file, mutated)
      const applied = read(m.file)
      if (m.to !== '' && applied === before) { results.push({ id: m.id, state: 'PROBLEM', why: '写后回读没有变化，替换未落地' }); restoreAll(orig); break }
      if (m.file.endsWith('.json')) {
        try { JSON.parse(applied) } catch (e) {
          results.push({ id: m.id, state: 'PROBLEM', why: `变异把 JSON 改坏了（记 PROBLEM 不记 MISSED）：${e.message.slice(0, 160)}` })
          restoreAll(orig)
          continue
        }
      }
      if (m.file.endsWith('.js')) {
        const c = spawnSync(process.execPath, ['--check', m.file], { cwd: ROOT, encoding: 'utf8' })
        if (c.status !== 0) {
          results.push({ id: m.id, state: 'PROBLEM', why: `变异把语法改坏了（记 PROBLEM 不记 MISSED）：${String(c.stderr || '').split('\n').slice(0, 3).join(' / ')}` })
          restoreAll(orig)
          continue
        }
      }
      const runs = SUITES.map(suiteRun)
      restoreAll(orig)
      const bad = runs.find((x) => !x.ok)
      if (bad) { results.push({ id: m.id, state: 'PROBLEM', why: bad.why }); continue }
      // expectGreen 是**声明的可验证部分**：m18 要的就是"Gate 2b7 那套照绿"，它红了说明我写的盲区结论是错的。
      const greenViolated = (m.expectGreen || []).filter((f) => runs.some((x) => x.suite === f && x.reds.length > 0))
      if (greenViolated.length) {
        results.push({ id: m.id, state: 'PROBLEM', why: `声明应保持绿的套件红了：${greenViolated.join(',')}（驱动当场否证这条声明）` })
        continue
      }
      const reds = runs.flatMap((x) => x.reds)
      const wantAll = [...m.expect, ...(m.alsoExpectWatch || []), ...(m.alsoExpectBudget || [])]
      const caught = m.expect.filter((e) => nameHit(reds, e))
      const also = wantAll.filter((e) => !m.expect.includes(e) && nameHit(reds, e))
      const unexpected = reds.filter((r) => !wantAll.some((e) => nameHit([r], e)))
      if (reds.length === 0) {
        results.push({ id: m.id, state: ALLOWED_MISSED.has(m.id) ? 'MISSED(声明的重叠)' : 'MISSED', why: m.note, reds: [] })
      } else if (caught.length !== m.expect.length || also.length !== (wantAll.length - m.expect.length)) {
        results.push({ id: m.id, state: 'PROBLEM', why: `期望指名红缺席：缺 ${wantAll.filter((e) => !nameHit(reds, e)).join(',')}；实际红：${reds.join(' | ') || '(无)'}` })
      } else {
        results.push({
          id: m.id, state: 'CAUGHT', why: m.note, reds,
          also: also.length ? also : undefined, unexpected: unexpected.length ? unexpected : undefined,
          collected: runs.map((x) => `${path.basename(x.suite)}=${x.collected}`).join(' '),
        })
      }
      const recheck = SUITES.map(suiteRun).filter((x) => !x.ok || x.reds.length > 0)
      if (recheck.length) { results.push({ id: `${m.id}-restore`, state: 'PROBLEM', why: `还原后被测锁仍红/未跑：${JSON.stringify(recheck.map((x) => x.why || x.reds))}` }); break }
    }
  } finally {
    restoreAll(orig)
  }
  return { results, attempted }
}

if (require.main === module) {
  const { results, attempted } = runAll()
  for (const r of results) {
    console.log(`${r.state.padEnd(18)} ${r.id} ${r.why}`)
    if (r.collected) console.log(`  收集：${r.collected}`)
    if (r.reds && r.reds.length) console.log(`  红：${r.reds.join(' | ')}`)
    if (r.also) console.log(`  同时红（跨靶子）：${r.also.join(' | ')}`)
    if (r.unexpected) console.log(`  未预期但红：${r.unexpected.join(' | ')}`)
  }
  const ca = results.filter((x) => x.state === 'CAUGHT').length
  const mi = results.filter((x) => x.state.startsWith('MISSED')).length
  const pr = results.filter((x) => x.state === 'PROBLEM').length
  const total = results.filter((x) => !x.id.endsWith('-restore')).length
  console.log(`SUMMARY CAUGHT=${ca} MISSED=${mi} PROBLEM=${pr} TOTAL=${total} ATTEMPTED=${attempted}`)
  const ok = pr === 0 && mi === ALLOWED_MISSED.size && total === attempted
  console.log(ok ? 'RESULT=OK' : 'RESULT=FAIL')
  process.exit(ok ? 0 : 1)
}

module.exports = { MUTATIONS, SUITES, runAll }
