'use strict'
/*
 * check-schedule-failure-watch 的变异反证驱动（按需取证工具，不是门禁：CI 不点名跑它，
 * 跑它要改被测面文件）。用法：node scripts/check-schedule-failure-watch.mutation.js
 * 期望末行 `SUMMARY CAUGHT/MISSED/PROBLEM` 中 PROBLEM=0 且 RESULT=OK：CAUGHT 的每条都必须
 * **指名**它要抓的那条用例，MISSED 只允许是"声明过的冗余/重叠防呆"（见第 6 条）。
 *
 * 七条硬约束（1-5 是本仓踩过的坑，缺一条就会把"没跑"读成"已反证"；6-7 由 QM-6 评审命中后补）：
 * 1. 读写被测面一律 utf8 且读写同编码（曾用 latin1 读 ⇒ 含中文的锚点永不命中）。
 * 2. 每条变异前断言锚点命中恰为 1（0=锚点失效，≥2=不唯一），两种都当场 PROBLEM。
 * 3. 动手前要求被测面工作树 == HEAD（脏态须显式 --allow-dirty），否则拒绝——崩溃过的重放
 *    会把污染态固化成"还原基线"。
 * 4. 每条变异断言 `# tests >= MIN_TESTS`，只数红名会把"整套没跑起来"读成"红了很多条"。
 * 5. 靶子有三个：判据本体、行为锁自身、以及**报警名单那份 workflow**——最后这个才是本刀
 *    要防的退化形态（把 "Cleanup Artifacts" 从名单里删掉必须当场红），只改判据本体的
 *    变异集对它完全失明。跑完再跑一次被测锁证明还原态是绿的。
 * 6. MISSED 只允许是**声明过的**重叠防呆，且重叠必须由另一条变异机械证明（m4 的重叠由 m4b
 *    摘掉两道守卫后 T5 立刻红来证），驱动还反向校验"声明冗余却被抓住"⇒ PROBLEM，
 *    防止把"测试写空了"洗成"防呆重叠"（本轮 m3 就是被这条抓出来改判的）。
 * 7. 写后必须回读：锚点命中数只证明"它在原文里唯一"，不证明"盘上现在是被改后的内容"；
 *    还原后同样回读，脏了就中止整轮而不是继续往下跑。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const JUDGE = path.join('scripts', 'check-schedule-failure-watch.js')
const TESTFILE = path.join('scripts', 'check-schedule-failure-watch.test.js')
const HANDLER = path.join('.github', 'workflows', 'ci-failure-handler.yml')
const QG = path.join('.github', 'workflows', 'quality-gate.yml')

const MIN_TESTS = 13

const MUTS = [
  { id: 'm1', name: '只判"未覆盖"、不判"名单陈旧"（单向锁）', file: JUDGE,
    from: "verdict: (uncovered.length || stale.length || oddShape.length) ? 'FAIL' : 'OK'",
    to: "verdict: (uncovered.length || oddShape.length) ? 'FAIL' : 'OK'", exp: ['T10'] },
  { id: 'm2', name: '不剥注释 ⇒ 名单括号内的注释变成一条"名单项"', file: JUDGE,
    from: "const body = raw.split('\\n').filter((l) => !/^\\s*#/.test(l)).join('\\n')",
    to: 'const body = raw', exp: ['T3'] },
  { id: 'm8', name: '把缩进下界从「至少 2」退回「恰好 2」（换缩进的合法文件会静默漏检）', file: JUDGE,
    from: 'const SCHED_LINE = /^[ \\t]{2,}schedule[:][ \\t]*$/',
    to: 'const SCHED_LINE = /^[ \\t]{2}schedule[:][ \\t]*$/', exp: ['T11'] },
  { id: 'm9', name: '摘掉 cron 合取条件（文档里的 schedule: 字样会被读成一次声明）', file: JUDGE,
    from: '    for (let k = i + 1; k <= Math.min(i + 4, lines.length - 1); k++) {\n      if (CRON_ITEM.test(lines[k])) return true\n    }',
    to: '    return true', exp: ['T12'] },
  { id: 'm3', name: '不做行尾归一（本仓 workflows 是 i/lf w/crlf）', file: JUDGE,
    from: ".replace(/\\r\\n/g, '\\n')", to: '', exp: ['T4', 'T6'] },
  { id: 'm4', name: '摘掉"空扫描域"那条守卫', file: JUDGE, expectMiss: true,
    missWhy: '重叠：空域时 handler 一定也找不到，下一条 SCANNER_FAULT 分支接住同一结论。这半由 m4b **机械证明**（不是只靠这句话）—— 见 m4b。',
    from: "if (!rows.length) return { verdict: 'SCANNER_FAULT', reason: `.github/workflows 里一个 yml 都没枚举到（根：${root}）` }",
    to: '', exp: ['T5'] },
  { id: 'm4b', name: '同时摘掉两道 SCANNER_FAULT 守卫（证明 m4 的重叠是真的）', file: JUDGE,
    from: "if (!rows.length) return { verdict: 'SCANNER_FAULT', reason: `.github/workflows 里一个 yml 都没枚举到（根：${root}）` }\n  const handler = rows.find((r) => r.file === 'ci-failure-handler.yml')\n  if (!handler || !handler.runList) return { verdict: 'SCANNER_FAULT', reason: '读不到 handler 的 workflows 清单' }",
    to: "  const handler = rows.find((r) => r.file === 'ci-failure-handler.yml')", exp: ['T5'] },
  { id: 'm5', name: '从 workflow 里摘掉本锁的接线（判据变成"只有本地手动跑过"的装饰存量）', file: QG,
    from: '          node --test scripts/check-schedule-failure-watch.test.js', to: '          echo wiring-removed', exp: ['T7'] },
  { id: 'm6', name: '把 Cleanup Artifacts 从报警名单里删掉（本刀立项的那次退化形态）', file: HANDLER,
    from: '      "Cleanup Artifacts",\n', to: '', exp: ['T7'] },
  { id: 'm7', name: '名单里塞一个不存在的工作流名（陈旧项）', file: HANDLER,
    from: '      "Doc Sync Gate",', to: '      "Doc Sync Gate",\n      "Renamed Away Gate",', exp: ['T7'] },
]

function git (args) { return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }) }
function runLock () {
  const r = spawnSync(process.execPath, ['--test', TESTFILE.split(path.sep).join('/')], { cwd: ROOT, encoding: 'utf8' })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const t = /# tests (\d+)/.exec(out)
  const reds = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => (/(T\d+)/.exec(m[1]) || [, '?'])[1])
  return { rc: r.status, total: t ? Number(t[1]) : -1, reds }
}

const rels = [...new Set(MUTS.map((m) => m.file))]
const allowDirty = process.argv.includes('--allow-dirty')
const dirty = rels.flatMap((rel) => (git(['status', '--porcelain', '--', rel]).stdout || '').split('\n').filter((l) => l.trim()))
if (dirty.length && !allowDirty) {
  console.error(`REFUSE: 被测面工作树不等于 HEAD（${dirty.length} 行：${dirty.join(' / ')}）。先恢复干净再跑；确要在脏态取证才加 --allow-dirty。`)
  process.exit(2)
}
const orig = new Map()
for (const rel of rels) orig.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'))
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 10)

let ok = true
let nCaught = 0
let nMissed = 0
let nProblem = 0
for (const m of MUTS) {
  const rel = m.file
  const src = orig.get(rel)
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const a = m.from.replace(/\n/g, eol)
  const r = m.to.replace(/\n/g, eol)
  const hits = src.split(a).length - 1
  if (hits !== 1) {
    console.log(`PROBLEM ${m.id} ${m.name} | 锚点命中 ${hits} 次（要求恰为 1）`)
    nProblem++
    ok = false
    continue
  }
  const abs = path.join(ROOT, rel)
  fs.writeFileSync(abs, src.split(a).join(r), 'utf8')
  // 写后回读校（QM-6 第二轮 i7）：命中数只证明"锚点在原文里唯一"，不证明"盘上现在是被改后的内容"。
  // 一次失败的写（权限、锁、编辑中途）会让后面那轮被测锁量到**未改动的文件**，
  // 于是"没抓住"被记成 MISSED、"抓住了"可能被记成别的变异 —— 整张表就不可信了。
  const back = fs.readFileSync(abs, 'utf8')
  if (back === src) {
    fs.writeFileSync(abs, src, 'utf8')
    console.log(`PROBLEM ${m.id} ${m.name} | 写入未生效（回读与原文逐字相同）`)
    nProblem++
    ok = false
    continue
  }
  if (r !== '' && !back.includes(r)) {
    fs.writeFileSync(abs, src, 'utf8')
    console.log(`PROBLEM ${m.id} ${m.name} | 回读里找不到替换文本（可能被折叠/转义改掉）`)
    nProblem++
    ok = false
    continue
  }
  const res = runLock()
  fs.writeFileSync(abs, src, 'utf8')
  if (fs.readFileSync(abs, 'utf8') !== src) {
    console.log(`PROBLEM ${m.id} ${m.name} | 还原后仍与原文不同 —— 后续每条变异量的都是脏文件`)
    nProblem++
    ok = false
    break
  }
  const miss = m.exp.filter((e) => !res.reds.includes(e))
  const caught = res.total >= MIN_TESTS && !miss.length && res.rc !== 0
  let tag
  if (caught && !m.expectMiss) { tag = 'CAUGHT '; nCaught++ }
  else if (!caught && m.expectMiss) { tag = 'MISSED(声明为冗余防呆) '; nMissed++ }
  else if (caught && m.expectMiss) {
    tag = 'PROBLEM(声明冗余却抓住了 ⇒ 前提已变，去掉 expectMiss 或删掉那行冗余) '
    nProblem++
    ok = false
  } else {
    tag = `PROBLEM(未被任何用例抓住) `
    nProblem++
    ok = false
  }
  console.log(`${tag} ${m.id} ${m.name} | file=${rel} tests=${res.total} 红=[${res.reds.join(',')}] 缺=[${miss.join(',')}]`)
  if (m.expectMiss && !caught) console.log(`        ↳ ${m.missWhy}`)
}
console.log(`SUMMARY CAUGHT=${nCaught} MISSED=${nMissed} PROBLEM=${nProblem} TOTAL=${MUTS.length}`)
let restoredAll = true
for (const rel of rels) if (md5(fs.readFileSync(path.join(ROOT, rel), 'utf8')) !== md5(orig.get(rel))) restoredAll = false
const after = runLock()
console.log(`RESTORE md5=${restoredAll} files=${rels.length} 还原后被测锁 rc=${after.rc} tests=${after.total}`)
if (!restoredAll || after.rc !== 0 || after.total < MIN_TESTS) ok = false
console.log('RESULT=' + (ok ? 'OK' : 'NOT OK'))
process.exit(ok ? 0 : 1)
