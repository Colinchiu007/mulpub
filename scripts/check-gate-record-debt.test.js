// Regression tests for scripts/check-gate-record-debt.js
//
// Why this gate exists (measured on origin/main 2026-09-28): `.quality-gates.md` carries 127
// "远程同步" rows; 95 of them were backfilled into the established PASS wording, but 32 still say
// PENDING / OPEN / 待 PR 合并后核验 … and NOTHING anywhere detects that a backfill is owed. A row
// whose PR is already merged reads to the next agent as "this work is unfinished", which is how
// duplicate work starts. This gate makes that residue explicit and shrink-only.
//
// Design facts this file locks, each measured before being relied on:
//   * the status column is FREE TEXT (22 distinct spellings) => classify by a closed vocabulary,
//     anything unknown counts as OPEN (fail-closed), otherwise the drift reintroduces itself
//   * record headings are the only stable key available: slug extraction from `（…，slug，date）`
//     covers just 160/319 records and collides 4 times, so it cannot be the key
//   * the file is LF in the blob but CRLF in the working copy (`i/lf w/crlf attr/text=auto`), so
//     the checker must normalise trailing CR or every ledger key would differ per checkout
//
//   node --test scripts/check-gate-record-debt.test.js

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const checker = require('./check-gate-record-debt.js')

function fixture(rows, opt = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-debt-'))
  const lines = []
  for (const r of rows) {
    lines.push(`## ${r.head}`)
    lines.push('')
    lines.push('| 门禁 | 状态 | Fresh 证据 |')
    lines.push('|------|------|-----------|')
    lines.push(`| 远程同步 | ${r.status} | ${r.evidence || '—'} |`)
    lines.push('')
  }
  const body = lines.join('\n')
  const text = opt.crlf ? body.replace(/\n/g, '\r\n') : body
  fs.writeFileSync(path.join(dir, '.quality-gates.md'), text, 'utf8')
  // 两源就绪（enforce-gate-record-presence D5）：记录目录必须存在但可以为空——
  // "目录缺席"在生产里是 fail-closed 红（见下面那组用例），所以夹具也要把它建出来，
  // 否则 15 条既有测试会集体撞上新守卫，而那是守卫该有的行为，不是测试的错。
  fs.mkdirSync(path.join(dir, 'openspec', 'records'), { recursive: true })
  return dir
}

test('同一条记录被写两遍必须判红（单向包含判据抓不到重复）', () => {
  const dir = fixture([
    { head: '记录甲（alpha，2026-09-28）', status: 'PASS' },
    { head: '记录甲（alpha，2026-09-28）', status: 'PASS' },
  ])
  const r = checker.collect({ root: dir, ledger: {}, duplicatesAllowed: new Set() })
  assert.strictEqual(r.duplicates.length, 1, JSON.stringify(r.duplicates))
  assert.strictEqual(r.duplicates[0].count, 2)
  assert.match(r.duplicates[0].text, /记录甲/)
  assert.match(checker.format(r), /同一条执行记录被写了两遍/)
})

test('允许清单只能缩小：清单内的历史重复不报，其余重复一律报', () => {
  const dir = fixture([
    { head: '历史重复（legacy，2026-08-19）', status: 'PASS' },
    { head: '历史重复（legacy，2026-08-19）', status: 'PASS' },
    { head: '新写的重复（fresh，2026-09-28）', status: 'PASS' },
    { head: '新写的重复（fresh，2026-09-28）', status: 'PASS' },
  ])
  const r = checker.collect({
    root: dir,
    ledger: {},
    duplicatesAllowed: new Set(['历史重复（legacy，2026-08-19）']),
  })
  assert.strictEqual(r.duplicates.length, 1, JSON.stringify(r.duplicates))
  assert.match(r.duplicates[0].text, /新写的重复/)
})

test('真实仓库：允许清单里的历史重复确实仍然存在（清单不得变成无人认领的死条目）', () => {
  const r = checker.collect({ root: path.join(__dirname, '..') })
  assert.deepStrictEqual(r.duplicates, [], JSON.stringify(r.duplicates))
  const heads = new Set()
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.quality-gates.md'), 'utf8').split('\n')) {
    if (/^## /.test(line)) heads.add(checker.normalize(line.slice(3)))
  }
  for (const allowed of checker.DUPLICATE_HEADINGS_ALLOWED) {
    assert.ok(heads.has(allowed), `允许清单里的 ${allowed} 在文件里已找不到 ⇒ 该历史重复已被清理，必须把条目一并删掉（清单只能缩小）`)
  }
})

test('全 PASS 的记录不产生欠账，也不报陈旧登记', () => {
  const dir = fixture([
    { head: '记录甲（alpha，2026-09-28）', status: 'PASS', evidence: 'PR #9001 squash 合并' },
    { head: '记录乙（beta，2026-09-28）', status: 'PASS（例外已记录）', evidence: 'x' },
    { head: '记录丙（gamma，2026-09-28）', status: 'N/A', evidence: '无远端动作' },
  ])
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.open.length, 0, JSON.stringify(r.open))
  assert.deepStrictEqual(r.stale, [])
})

test('未登记的 PENDING 行必须被报为欠账，且带上所属记录标题', () => {
  const dir = fixture([{ head: '记录甲（alpha，2026-09-28）', status: 'PENDING', evidence: '待 runner 留痕' }])
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.open.length, 1)
  assert.match(r.open[0].heading, /记录甲/)
  assert.strictEqual(r.open[0].status, 'PENDING')
  assert.match(checker.format(r), /未登记/)
})

test('按标题登记后转绿；登记里的标题写错不得放行（防"随手登记个不存在的键"把锁变成 no-op）', () => {
  const rows = [{ head: '记录甲（alpha，2026-09-28）', status: 'PENDING', evidence: 'x' }]
  const dir = fixture(rows)
  const good = checker.collect({ root: dir, ledger: { '记录甲（alpha，2026-09-28）': '等 #9001 合并' } })
  assert.strictEqual(good.open.length, 0, JSON.stringify(good.open))
  const typo = checker.collect({ root: dir, ledger: { '记录甲（alpha，2026-09-27）': '日期抄错' } })
  assert.strictEqual(typo.open.length, 1, '错键不得吃掉真欠账')
  assert.strictEqual(typo.stale.length, 1, '错键自身要作为陈旧登记报出来')
})

test('回填完成后必须同步删除登记项，否则判红（这一步保证清单只会缩小）', () => {
  const dir = fixture([{ head: '记录甲（alpha，2026-09-28）', status: 'PASS', evidence: 'PR #9001 合并 SHA abc' }])
  const r = checker.collect({ root: dir, ledger: { '记录甲（alpha，2026-09-28）': '曾经欠账' } })
  assert.strictEqual(r.open.length, 0)
  assert.strictEqual(r.stale.length, 1)
  assert.match(checker.format(r), /陈旧登记/)
})

test('自由文本状态按闭合词表判：未知写法一律算未收口（fail closed）', () => {
  const dir = fixture([
    { head: 'A（a，2026-09-28）', status: '待 PR 合并后核验' },
    { head: 'B（b，2026-09-28）', status: '进行中' },
    { head: 'C（c，2026-09-28）', status: 'PASS（合并例外已记录）' },
    { head: 'D（d，2026-09-28）', status: '✅' },
    { head: 'E（e，2026-09-28）', status: '已闭环（2026-09-28 经用户授权提权）' },
  ])
  const ledger = { 'A（a，2026-09-28）': 'x', 'B（b，2026-09-28）': 'y' }
  const r = checker.collect({ root: dir, ledger })
  assert.deepStrictEqual(r.open.map(o => o.heading), [])
  const r2 = checker.collect({ root: dir, ledger: {} })
  assert.deepStrictEqual(r2.open.map(o => o.status), ['待 PR 合并后核验', '进行中'])
})

test('CRLF 工作区与 LF blob 必须给出同一判定（该文件 i/lf w/crlf，键不能随行尾漂）', () => {
  const rows = [{ head: '记录甲（alpha，2026-09-28）', status: 'PENDING', evidence: 'x' }]
  const lf = fixture(rows, { crlf: false })
  const cr = fixture(rows, { crlf: true })
  const a = checker.collect({ root: lf, ledger: { '记录甲（alpha，2026-09-28）': 'ok' } })
  const b = checker.collect({ root: cr, ledger: { '记录甲（alpha，2026-09-28）': 'ok' } })
  assert.deepStrictEqual(b.open, a.open, '同一内容不得因行尾判成不同结果')
  assert.strictEqual(b.open.length, 0)
})

test('没有 远程同步 行的文件判红而不是判绿（空遍历不等于零欠账）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-debt-empty-'))
  fs.writeFileSync(path.join(dir, '.quality-gates.md'), '## 只有标题没有表格\n', 'utf8')
  assert.throws(() => checker.collect({ root: dir, ledger: {} }), /未找到任何 远程同步 行/)
})

test('文件缺失必须抛错而不是静默通过', () => {
  assert.throws(() => checker.collect({ root: path.join(os.tmpdir(), 'definitely-not-here-9x7'), ledger: {} }), /不存在/)
})

// ---- 覆盖检测：整块缺 远程同步行 的历史缺口只做可见，最新一篇必须带行 ----
//
// 加这一段的原因（实测，非推断）：原实现只审计「已存在的行是否收口」，对「记录根本没有这一行」
// 完全失明。origin/main 2026-09-28 上 316 篇执行记录里 192 篇没有这一行，而门禁 RC=0 报 OK。
// 缺席比说谎更糟：说谎的记录下一个人看得见，缺席的记录连怀疑的对象都没有。
//
// 强制面刻意收窄成「最顶部一篇记录必须有行」：记录按惯例插在文件顶部 ⇒ "最新一篇" 定义良好，
// 无需基线、无需清单维护、也不会一上线就红 192 条。
// 已知漏洞（如实记录，不假装已闭合）：新记录若被插在非顶部位置，本条拦不住。

function mixFixture(blocks, opt = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-cov-'))
  const lines = []
  for (const b of blocks) {
    lines.push(`## ${b.head}`)
    lines.push('')
    if (b.row !== null) {
      lines.push('| 门禁 | 状态 | Fresh 证据 |')
      lines.push('|------|------|-----------|')
      lines.push(`| 远程同步 | ${b.row} | ${b.evidence || '—'} |`)
      lines.push('')
    }
    if (b.body) lines.push(b.body, '')
  }
  const text = opt.crlf ? lines.join('\r\n') : lines.join('\n')
  fs.writeFileSync(path.join(dir, '.quality-gates.md'), text, 'utf8')
  // 同 fixture()：记录目录必须存在（守卫是无条件的，不给"关掉守卫"这条静默降级通道）
  fs.mkdirSync(path.join(dir, 'openspec', 'records'), { recursive: true })
  return dir
}

test('最顶部执行记录缺 远程同步 行 ⇒ 不再判红，但必须识别、可见、并指向新载体', () => {
  // 语义变更（change: freeze-legacy-gate-carrier）：这条此前是拦截项，作用仅是"用位置猜哪篇最新"。
  // 新 PR 的强制载体已是 openspec/records/（那边有逐篇硬判据 missingRecordRows，在拦截面里），
  // 所以继续拦在这里只会逼会话去挤那个所有会话共用的大文件 —— 那正是丢工窗口的来源。
  const dir = mixFixture([
    { head: '本次执行记录：新功能甲（feat-a，2026-09-28）', row: null },
    { head: '本次执行记录：旧功能乙（feat-b，2026-09-27）', row: 'PASS', evidence: 'PR #9002 合并' },
  ])
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.topRecordMissingRow, true, '状态本身仍要算出来，否则可见项也无从打印')
  assert.match(r.topRecord.text, /新功能甲/)
  assert.strictEqual(r.recordsWithoutRow.length, 1)
  assert.strictEqual(checker.hasBlocking(r), false, '顶部缺行不得再进拦截面')
  const msg = checker.format(r)
  assert.match(msg, /可见项，不拦截：旧载体最顶部记录缺 远程同步 行/)
  assert.doesNotMatch(msg, /❌ 最顶部/, '已不拦截却打 ❌ 会把读者引向一个不存在的失败')
})

test('顶部记录带行时，历史缺行的记录只报可见、不判红（否则一上线就红 192 条而不可用）', () => {
  const dir = mixFixture([
    { head: '本次执行记录：最新（newest，2026-09-28）', row: 'PENDING', evidence: '待合并' },
    { head: '本次执行记录：历史一（h1，2026-09-01）', row: null },
    { head: '本次执行记录：历史二（h2，2026-08-01）', row: null },
  ])
  const ledger = { '本次执行记录：最新（newest，2026-09-28）': '本 PR 合并后由后续 docs PR 回填并删除本条' }
  const r = checker.collect({ root: dir, ledger })
  assert.strictEqual(r.topRecordMissingRow, false)
  assert.strictEqual(r.recordsWithoutRow.length, 2, '历史缺口必须被数出来')
  assert.match(checker.format(r), /2 篇执行记录整块没有 远程同步 行/)
  assert.strictEqual(r.open.length + r.stale.length, 0)
  assert.match(checker.format(r), /^OK/m, '历史缺行不得让门禁判红')
})

test('结构性章节（无日期、非「本次执行记录」前缀）不计入执行记录，缺行不误报', () => {
  // 实测 origin/main：321 个 ## 标题里 5 个是 固定强制门禁 / 提交前自检清单 / 强制卡点规则 /
  // 违规处理 / 质量节拍阶段对照 —— 它们永远不会有这一行，若计入则判据恒红。
  const dir = mixFixture([
    { head: '本次执行记录：真记录（real，2026-09-28）', row: 'PASS', evidence: 'PR #9003' },
    { head: '违规处理', row: null, body: '违反强制检查视为流程违规。' },
    { head: '提交前自检清单（必须全部勾选）', row: null },
  ])
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.recordCount, 1, '结构章节不得算执行记录')
  assert.strictEqual(r.headingCount, 3)
  assert.strictEqual(r.topRecordMissingRow, false)
  assert.strictEqual(r.recordsWithoutRow.length, 0)
})

test('覆盖判据不得随行尾漂（同一内容 CRLF 检出与 LF blob 必须同结论）', () => {
  const blocks = [
    { head: '本次执行记录：甲（a，2026-09-28）', row: null },
    { head: '本次执行记录：乙（b，2026-09-27）', row: 'PASS' },
  ]
  const a = checker.collect({ root: mixFixture(blocks, { crlf: false }), ledger: {} })
  const b = checker.collect({ root: mixFixture(blocks, { crlf: true }), ledger: {} })
  assert.strictEqual(a.topRecordMissingRow, true)
  assert.strictEqual(b.topRecordMissingRow, a.topRecordMissingRow)
  assert.strictEqual(b.recordsWithoutRow.length, a.recordsWithoutRow.length)
})

test('loadLedger 必须认参数：传夹具目录时不得静默读真实清单', () => {
  // 该测试文件一直按 loadLedger(root) 调用，而旧实现签名是无参 —— 于是永远读生产 ledger，
  // 夹具里的 ledger 形同不存在（"给了路径却拿到真仓状态"，属假绿通道）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-ledger-arg-'))
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'scripts', 'gate-record-debt-ledger.json'),
    JSON.stringify({ '记录甲': '夹具里的原因' }),
    'utf8',
  )
  assert.deepStrictEqual(checker.loadLedger(dir), { 记录甲: '夹具里的原因' })
  assert.deepStrictEqual(checker.loadLedger(path.join(dir, 'nowhere')), {})
  assert.notDeepStrictEqual(checker.loadLedger(dir), checker.loadLedger(),
    '夹具 ledger 与真实 ledger 必须能被区分开，否则参数是装饰')
})

test('真仓：旧载体必须等于冻结基线（这条是冻结判据的落地自检）', () => {
  // 原来的真仓自检盯的是"顶部那篇带没带行"，随该判据退出拦截面一起换掉。
  const root = path.resolve(__dirname, '..')
  const r = checker.collect({ root, ledger: checker.loadLedger(), carrierFreeze: checker.loadCarrierFreeze() })
  assert.ok(r.topRecord, '一篇执行记录都识别不到 ⇒ 分类判据坏了，不是通过')
  assert.ok(r.recordCount > 50, `识别到的执行记录数异常小：${r.recordCount}`)
  assert.ok(r.headingCount > 500,
    `冻结基线的规模下界不满足（实测 ${r.headingCount}）—— 识别退化会让"零漂移"变成假绿`)
  assert.strictEqual(r.carrierDrift, null,
    '真仓旧载体与冻结基线不一致：说明有人在旧载体上加/删了记录块，应改写 openspec/records/')
})

// ---- 旧载体冻结锁（change: freeze-legacy-gate-carrier）----
//
// 为什么需要它（实测，非推断）：每个 PR 都要往 `.quality-gates.md` 顶部插一块，而所有会话共用同一份
// 工作树 / index / HEAD。机器判定其实不需要这块 —— 记录文件源读自己 frontmatter（source:'records'），
// ledger 只服务旧载体（source:'legacy'）。实测代价：同一条回填 #3602/#3606 相隔 20 分钟落了两遍，
// 而共享根 reflog 显示 5 小时窗口内同一 HEAD 上发生 29 次 git 写动作。
//
// 判据是"记录块集合等于基线"：不许加块、不许删块，但**允许就地改写已有块里的状态行** ——
// 关闭 ledger 里那 25 条历史欠账这条路必须留着，否则冻结等于把旧账永远钉红。
function freezeOf(dir) {
  const lines = fs.readFileSync(path.join(dir, '.quality-gates.md'), 'utf8').split('\n')
  const titles = lines.filter((l) => /^## /.test(l)).map((l) => checker.normalize(l.slice(3)))
  const sig = checker.carrierSignature(titles)
  return { headingCount: sig.count, headingSha256: sig.sha256, headings: sig.titles }
}

test('冻结：与基线一致 ⇒ 不报漂移', () => {
  const dir = mixFixture([
    { head: '本次执行记录：甲（a，2026-10-15）', row: 'PASS', evidence: 'PR #1' },
    { head: '本次执行记录：乙（b，2026-10-14）', row: 'PASS', evidence: 'PR #2' },
  ])
  const r = checker.collect({ root: dir, ledger: {}, carrierFreeze: freezeOf(dir) })
  assert.strictEqual(r.carrierDrift, null)
  assert.strictEqual(checker.hasBlocking(r), false)
})

test('冻结：往旧载体加一块 ⇒ 判红并点名新块标题', () => {
  const dir = mixFixture([
    { head: '本次执行记录：甲（a，2026-10-15）', row: 'PASS', evidence: 'PR #1' },
  ])
  const base = freezeOf(dir)
  // 会话按旧惯习又插了一块（这正是本判据要拦的形态）
  fs.appendFileSync(path.join(dir, '.quality-gates.md'),
    '## 本次执行记录：新功能丙（feat-c，2026-10-15）\n\n| 远程同步 | PASS | x |\n\n', 'utf8')
  const r = checker.collect({ root: dir, ledger: {}, carrierFreeze: base })
  assert.ok(r.carrierDrift, '加了块却没报漂移 ⇒ 冻结锁是装饰')
  assert.deepStrictEqual(r.carrierDrift.added.filter((t) => /新功能丙/.test(t)).length, 1)
  assert.strictEqual(r.carrierDrift.removed.length, 0)
  assert.strictEqual(checker.hasBlocking(r), true)
  const msg = checker.format(r)
  assert.match(msg, /❌ 旧载体冻结被破坏/)
  assert.match(msg, /新功能丙/, '必须点名是哪一块，否则作者只能猜')
  assert.match(msg, /openspec\/records/, '必须给出合法出路')
})

test('冻结：只改已有块里的状态行（关闭历史欠账）⇒ 不得报漂移', () => {
  // 这条是"冻结不能把旧账封死"的反向锁：ledger 里还挂着 25 条 8 月欠账，唯一的关闭方式
  // 就是就地改旧载体里的状态行。没有这条，"冻结"会变成第二次静默丢工的成因。
  const dir = mixFixture([
    { head: '本次执行记录：老账（old，2026-08-13）', row: 'PENDING', evidence: '待回填' },
  ])
  const base = freezeOf(dir)
  const before = fs.readFileSync(path.join(dir, '.quality-gates.md'), 'utf8')
  fs.writeFileSync(path.join(dir, '.quality-gates.md'),
    before.replace('| 远程同步 | PENDING | 待回填 |', '| 远程同步 | PASS | merge abc123 |'), 'utf8')
  const r = checker.collect({ root: dir, ledger: {}, carrierFreeze: base })
  assert.strictEqual(r.carrierDrift, null, '关闭旧账不是加块，不得被冻结锁误伤')
})

test('冻结：删块同样判红（只减不增不等于可以搬走存档）', () => {
  const dir = mixFixture([
    { head: '本次执行记录：甲（a，2026-10-15）', row: 'PASS' },
    { head: '本次执行记录：乙（b，2026-10-14）', row: 'PASS' },
  ])
  const base = freezeOf(dir)
  const kept = mixFixture([{ head: '本次执行记录：甲（a，2026-10-15）', row: 'PASS' }])
  const r = checker.collect({ root: kept, ledger: {}, carrierFreeze: base })
  assert.ok(r.carrierDrift)
  assert.strictEqual(r.carrierDrift.removed.length, 1)
  assert.match(r.carrierDrift.removed[0], /乙/)
})

test('冻结：判据本体不得有"读不到基线就当没漂移"这条路', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-freeze-miss-'))
  assert.throws(() => checker.loadCarrierFreeze(path.join(dir, 'nope.json')),
    /冻结基线缺失/, '缺基线必须抛错，不能静默跳过')
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ headingCount: 0 }), 'utf8')
  assert.throws(() => checker.loadCarrierFreeze(path.join(dir, 'bad.json')),
    /不合法/, '条数为 0 的基线会让任何内容都判成漂移或都不漂移，两种都不可接受')
})

test('冻结：collect 默认不读生产基线（否则夹具会静流量到真仓状态）', () => {
  const dir = mixFixture([{ head: '本次执行记录：夹具甲（f，2026-10-15）', row: 'PASS' }])
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.carrierDrift, null,
    '未注入基线时不得报漂移；同时说明基线只能由调用方显式传入')
})


test('真仓：每一条未收口的 远程同步 行都必须已登记，且登记清单里不得有已回填的陈旧项', () => {
  const root = path.resolve(__dirname, '..')
  const ledger = checker.loadLedger(root)
  const r = checker.collect({ root, ledger })
  assert.strictEqual(r.open.length, 0, `存在未登记的欠账：\n${r.open.map(o => `${o.line} [${o.status}] ${o.heading}`).join('\n')}`)
  assert.strictEqual(r.stale.length, 0, `欠账清单含陈旧项（回填后请删除对应条目）：\n${r.stale.join('\n')}`)
})


// ── 两源：openspec/records/*.md 记录文件（change enforce-gate-record-presence，D5）──
// 语义与历史单文件同源但键形态不同：历史用「记录标题」当键 + 外部 JSON 清单登记欠账；
// 新记录用「文件名」当键，欠账登记就写在该文件自己的 frontmatter 里（改状态即删字段，
// 因此不存在"回填了却忘删登记项"这种漂移）。
function recFile(dir, name, { row = 'PENDING', withRow = true, fm } = {}) {
  const p = path.join(dir, 'openspec', 'records', name + '.md')
  const lines = ['---', `record: ${name}`]
  if (fm) for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${v}`)
  lines.push('---', '', `## 本次执行记录：${name}（${name}，2026-09-29）`, '')
  lines.push('| 门禁 | 状态 | Fresh 证据 |', '|------|------|-----------|')
  if (withRow) lines.push(`| 远程同步 | ${row} | 见正文 |`)
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8')
  return p
}

test('两源欠账必须合并进同一结论空间：历史未登记行 + 记录文件未登记行都要被列出', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PENDING' }])
  recFile(dir, 'new-one', { row: 'PENDING' })
  const r = checker.collect({ root: dir, ledger: {} })
  const heads = r.open.map(o => o.heading)
  assert.match(heads.join('\n'), /老记录/, '历史源的未登记欠账必须在')
  assert.match(heads.join('\n'), /new-one/, '文件源的未登记欠账必须在')
  assert.strictEqual(r.open.length, 2, JSON.stringify(r.open))
  assert.deepStrictEqual([...new Set(r.open.map(o => o.source))].sort(), ['legacy', 'records'],
    '两源必须各自可归因，否则分源计数无从谈起')
})

test('记录文件自带登记字段即视为已登记，无需外部清单（登记随文件走）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'self-registered', {
    row: 'PENDING',
    fm: { sync_reason: '本 PR 尚未合并，无法取证 merge SHA', sync_backfill_owner: '下一个会话' },
  })
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.open.length, 0, `自带登记的文件不该算未登记：${JSON.stringify(r.open)}`)
  // 这条断言是让本用例在实现前就变红的关键：只断言"没有欠账"的测试，对一个
  // 完全无视文件源的旧实现也会通过（装饰性绿）。必须同时证明该文件真被读进来了。
  assert.strictEqual(r.recordsFromFiles, 1, '文件源必须真的被枚举到，否则上一条断言是假绿')
})

test('登记字段缺失或为空必须判不合规并点名该文件（fail closed，不接受空原因）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'no-fields', { row: 'PENDING' })
  recFile(dir, 'empty-reason', { row: 'PENDING', fm: { sync_reason: '', sync_backfill_owner: 'x' } })
  recFile(dir, 'no-owner', { row: 'PENDING', fm: { sync_reason: '有原因', sync_backfill_owner: '' } })
  const r = checker.collect({ root: dir, ledger: {} })
  const named = r.open.map(o => o.heading).join('\n')
  for (const f of ['no-fields', 'empty-reason', 'no-owner']) {
    assert.match(named, new RegExp(f), `${f} 必须被判为未登记`)
  }
  assert.strictEqual(r.open.length, 3, JSON.stringify(r.open))
})

test('记录文件整块没有 远程同步 行必须判不合规（每篇独立可查，取代"只查顶部一篇"）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'rowless', { withRow: false })
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.missingRecordRows.length, 1, JSON.stringify(r.missingRecordRows))
  assert.match(r.missingRecordRows[0].file, /rowless/)
  assert.match(checker.format(r), /缺 远程同步 行/)
})

test('已收口却仍留登记字段判为陈旧字段（回填即删字段，不允许两者共存）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'closed-but-registered', {
    row: 'PASS',
    fm: { sync_reason: '已经回填了却没删字段', sync_backfill_owner: 'x' },
  })
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.staleRecordFields.length, 1, JSON.stringify(r.staleRecordFields))
  assert.match(checker.format(r), /回填后请删除/)
})

// 缺口来自一次真实清理：AGENTS.md 要求回填时删「sync_* 三字段」，实测 main 上有 11 篇只删了两个、
// 把 sync_status: PASS 留在原地，而门禁的「登记字段无残留」这句话当时根本不查这个字段。
test('只留 sync_status 也必须判陈旧字段（门禁自述的三个字段必须真的都查）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'closed-status-only', {
    row: 'PASS',
    fm: { sync_status: 'PASS' },
  })
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.staleRecordFields.length, 1, JSON.stringify(r.staleRecordFields))
  assert.match(r.staleRecordFields[0], /closed-status-only/)
  assert.match(r.staleRecordFields[0], /sync_status/, `点名必须含字段名：${r.staleRecordFields[0]}`)
})

// 反向：未收口的记录三个字段都带着是**正确形态**，不得被"残留"判据误伤 ——
// 这条与上一条成对，否则"补宽判据"会顺手把合法登记判红（那等于逼会话删掉登记去消红）。
test('未收口记录带着 sync_status: PENDING 不得判为陈旧字段', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'open-with-status', {
    row: 'PENDING',
    fm: { sync_status: 'PENDING', sync_reason: '本 PR 尚未合并', sync_backfill_owner: '下一个会话' },
  })
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.staleRecordFields.length, 0, JSON.stringify(r.staleRecordFields))
  // 带齐三个字段的未收口记录是「已登记的活账」：既不该被残留判据打红，也不该再进 open 未登记清单
  assert.strictEqual(r.open.filter((o) => o.source === 'records').length, 0, JSON.stringify(r.open))
})

test('记录目录缺席必须抛错，不得当成"零条记录"通过', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  fs.rmSync(path.join(dir, 'openspec', 'records'), { recursive: true, force: true })
  assert.throws(() => checker.collect({ root: dir, ledger: {} }), /openspec.records/)
})

test('记录目录读不动（被做成普通文件）必须抛错而不是静默跳过（R3 同款：不完整遍历判绿即假绿）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  fs.rmSync(path.join(dir, 'openspec', 'records'), { recursive: true, force: true })
  fs.writeFileSync(path.join(dir, 'openspec', 'records'), 'not a directory', 'utf8')
  assert.throws(() => checker.collect({ root: dir, ledger: {} }), /无法枚举/)
})

test('两源标识形态不得重叠：文件名键与历史标题键混用时报错（防一把清单喂两套语义）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, '标题长得一样（legacy，2026-09-28）', { row: 'PASS' })
  assert.throws(
    () => checker.collect({ root: dir, ledger: { '标题长得一样（legacy，2026-09-28）': '撞键' } }),
    /键形态|重叠/,
  )
})

test('对照轮：只给历史源时既有语义一字不改（词表/shrink-only/陈旧判定均不受两源改造影响）', () => {
  const dir = fixture([
    { head: '甲（a，2026-09-28）', status: 'PENDING' },
    { head: '乙（b，2026-09-28）', status: 'PASS' },
  ])
  const ledger = { '甲（a，2026-09-28）': '等合并' }
  const r = checker.collect({ root: dir, ledger })
  assert.strictEqual(r.open.length, 0, JSON.stringify(r.open))
  assert.strictEqual(r.stale.length, 0, JSON.stringify(r.stale))
  assert.strictEqual(r.recordsFromFiles, 0, '没有记录文件时文件源计数必须为 0')
  // 摘掉登记项 ⇒ 依旧按老规矩变红（证明改造没把历史判据改成 no-op）
  const r2 = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r2.open.length, 1)
})

test('真仓：openspec/records 目录必须已存在（缺失即本 change 的 1.1 未完成，不允许静默降级）', () => {
  const root = path.resolve(__dirname, '..')
  assert.ok(fs.existsSync(path.join(root, 'openspec', 'records')),
    'openspec/records/ 不存在：tasks 1.1 尚未落地')
})

test('模板与豁免目录不得被当作记录扫描（模板自己就带一行 远程同步，扫它必恒红）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, '_TEMPLATE', { row: 'PENDING' })                       // 下划线开头 = 模板，跳过
  const exDir = path.join(dir, 'openspec', 'records', '_exempt')
  fs.mkdirSync(exDir, { recursive: true })
  fs.writeFileSync(path.join(exDir, '_EXEMPT_TEMPLATE.md'), '---\nrecord: x\n---\n| 远程同步 | PENDING | |\n', 'utf8')
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.recordsFromFiles, 0, `模板/豁免不该计入记录数：${JSON.stringify(r)}`)
  assert.strictEqual(r.open.length, 0)
})
// ── 同篇两形态对账（change: gate-record-status-consistency，2026-10-10）─────────────────
// 现场实测：157 篇记录里 8 篇「表格行已 PASS、bullet 仍声明 远程同步 PENDING」，
// 而 readRecord() 只读表格行 ⇒ 那 8 句谎话门禁全盲。判据范围由实测决定：
//   宽式（含「远程同步」+状态词即判）27 命中 / 25 误报；收尾式 8 命中 / 0 误报。
// 因此锚点是「行闭合」与「bullet 以状态词收尾」，而**不是**词表穷举。

function recDecl(dir, name, rowStatus, declLine, extraFrontmatter) {
  const p = path.join(dir, 'openspec', 'records', name + '.md')
  const lines = ['---', 'record: ' + name]
  if (extraFrontmatter) for (const [k, v] of Object.entries(extraFrontmatter)) lines.push(k + ': ' + v)
  lines.push('---', '', '## 本次执行记录：' + name + '（' + name + '，2026-10-10）', '')
  if (rowStatus !== null) {
    lines.push('| 门禁 | 状态 | Fresh 证据 |', '|------|------|-----------|')
    lines.push('| 远程同步 | ' + rowStatus + ' | 见正文 |')
  }
  lines.push('', declLine, '')
  fs.writeFileSync(p, lines.join('\r\n') + '\r\n', 'utf8')
  return p
}

test('行已 PASS、bullet 仍声明未收口 ⇒ 必须点名矛盾（本 change 的主判据）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recDecl(dir, 'contra', 'PASS', '- 保留门禁：变更类型与隔离声明 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 远程同步 PENDING（本条自己的欠账）')
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.statusContradictions.length, 1, JSON.stringify(r.statusContradictions))
  const c = r.statusContradictions[0]
  assert.match(c.file, /contra\.md/, '必须点名到文件')
  assert.strictEqual(c.rowStatus, 'PASS')
  assert.match(c.bulletStatus, /^PENDING/, 'bullet 状态必须被原样取出: ' + c.bulletStatus)
  assert.ok(c.bulletLine > 0, '必须给出行号，否则回填者找不到位置')
  assert.match(checker.format(r), /两种形态互相矛盾/)
  assert.strictEqual(checker.hasBlocking(r), true, '矛盾必须进退出码面，不能只是打印')
})

test('合规形态必须绿：行 PASS + bullet 也 PASS（带 PR 号与 SHA 括注）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recDecl(dir, 'ok-both', 'PASS', '- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 远程同步 PASS（PR #3221 → main 8a64e3d1e）')
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.statusContradictions.length, 0, JSON.stringify(r.statusContradictions))
  assert.strictEqual(r.statusMismatchVisible.length, 0)
  assert.strictEqual(checker.hasBlocking(r), false, '锁不得把它自己提示的修复路径打红')
})

test('在飞 PR 的正常形态不得因新判据变红：行 PENDING + bullet PENDING（同侧未收口）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recDecl(dir, 'inflight', 'PENDING',
    '- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 远程同步 PENDING（本条自己的欠账）',
    { sync_reason: '本 PR 尚未合并', sync_backfill_owner: '后续回填轮' })
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.statusContradictions.length, 0, JSON.stringify(r.statusContradictions))
  assert.strictEqual(r.open.length, 0, '自带登记字段的未收口行仍按既有语义放行')
  assert.strictEqual(checker.hasBlocking(r), false)
})

test('散文里转述「把 远程同步 行 PENDING 回填为 PASS」不得被当成声明式状态（宽式误报回归）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recDecl(dir, 'prose', 'PASS', '- 本条把 远程同步 行由 PENDING 回填为 PASS，并在同一次提交删除三个 sync_* 字段')
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.statusContradictions.length, 0, JSON.stringify(r.statusContradictions))
  assert.strictEqual(r.statusMismatchVisible.length, 0, '散文也不得进可见项，否则可见项会被噪声淹没')
})

test('行内代码引用了表格行原文（描述该盲区本身）不得自指命中', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recDecl(dir, 'selfref', 'PASS', '- 实测：`| 远程同步 | PENDING |` 那一行在落地时就是坏的，而没有任何门禁看得见')
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.statusContradictions.length, 0, JSON.stringify(r.statusContradictions))
})

test('状态词后的尾随空格/制表不得让判据退化（收尾式的边界必须由测试钉住）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recDecl(dir, 'trailing', 'PASS', '- 保留门禁：行尾对账 ✅ | 远程同步 PENDING   ')
  recDecl(dir, 'tabbed', 'PASS', '- 保留门禁：行尾对账 ✅ | 远程同步 OPEN\t')
  const r = checker.collect({ root: dir, ledger: {} })
  const named = r.statusContradictions.map(c => c.file).join('\n')
  assert.match(named, /trailing/, '尾随空格变体必须仍被判')
  assert.match(named, /tabbed/, '制表符变体必须仍被判')
  assert.strictEqual(r.statusContradictions.length, 2, JSON.stringify(r.statusContradictions))
})

test('反向（行未收口、bullet 宣称完成）只可见、不拦截：拦截面按实测最小化', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recDecl(dir, 'reverse', 'PENDING',
    '- 保留门禁：行尾对账 ✅ | 远程同步 PASS（本行证据待补）',
    { sync_reason: '本 PR 尚未合并', sync_backfill_owner: '后续回填轮' })
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.statusContradictions.length, 0, '反向实测 0 篇 ⇒ 不得进拦截面')
  assert.strictEqual(r.statusMismatchVisible.length, 1, JSON.stringify(r.statusMismatchVisible))
  assert.match(checker.format(r), /可见项[^\n]*反向/, '反向必须打印出来，不能静默丢掉')
  assert.strictEqual(checker.hasBlocking(r), false)
})

test('同一文件至多命中一个方向的矛盾（两套红灯理由互斥，防"不知该听哪条"）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recDecl(dir, 'multi', 'PASS', '- 保留门禁：行尾对账 ✅ | 远程同步 PENDING')
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.statusContradictions.length, 1)
  assert.strictEqual(r.statusMismatchVisible.length, 0, '行状态是二值的 ⇒ 一个文件不可能同时被两个方向点名')
})

test('无表格行的记录仍由既有「整块缺行」判据拦，且不得同时被矛盾判据重复点名', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recDecl(dir, 'norow', null, '- 保留门禁：行尾对账 ✅ | 远程同步 PENDING')
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.missingRecordRows.length, 1, '既有判据必须仍然生效')
  assert.strictEqual(r.statusContradictions.length, 0, '缺行与矛盾两条判据不得重叠')
  assert.strictEqual(checker.hasBlocking(r), true)
})

test('旧载体 .quality-gates.md 的同形态矛盾只可见、不进拦截面（范围锁，防顺手扩面）', () => {
  const dir = fixture([{ head: '本次执行记录：旧载体块（legacy-block，2026-10-05）', status: 'PASS' }])
  const f = path.join(dir, '.quality-gates.md')
  const body = fs.readFileSync(f, 'utf8')
  fs.writeFileSync(f, body.replace(/\s+$/, '') + '\r\n- 保留门禁：行尾对账 ✅ | 远程同步 PENDING\r\n', 'utf8')
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.legacyVisibleContradictions, 1, '旧载体必须被"看见"')
  assert.strictEqual(r.statusContradictions.length, 0, '旧载体不得进新载体的拦截面（归属他人，不代改）')
  assert.strictEqual(checker.hasBlocking(r), false)
})

test('真仓自证：openspec/records 全量跑，本 change 落地后矛盾必须为 0（且必须证明扫到了文件）', () => {
  const root = path.resolve(__dirname, '..')
  const r = checker.collect({ root, ledger: checker.loadLedger() })
  assert.ok(r.recordsFromFiles > 100, '扫描域退化会让"零矛盾"变成假绿，实得 ' + r.recordsFromFiles)
  assert.deepStrictEqual(r.statusContradictions.map(c => c.file), [],
    '修复后仍存在的矛盾: ' + JSON.stringify(r.statusContradictions))
})

test('frontmatter 的 task: 行「…的远程同步行并销账（…）」不得被当成状态声明（真仓 6 处误报的形状）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  const p = recDecl(dir, 'taskline', 'PASS', '- 保留门禁：行尾对账 ✅ | 文档同步 ✅ | 远程同步 PASS（见同篇表格行）')
  // 该形状与合法 bullet 的位置特征**完全相同**（状态词紧跟「远程同步」、整行以括注收尾），
  // 唯一区别是它不是状态词。这就是实现第一版跑出 14 处（含 6 处误报）的原因，必须由命名用例钉住，
  // 不能只靠仓库级自证——仓库级用例依赖真仓里恰好有这种行，那是一个会漂移的前提。
  const text = fs.readFileSync(p, 'utf8')
    .replace('record: taskline', 'record: taskline\r\ntask: 回填三篇记录的远程同步行并销账（gate-record-backfill-11 / sync-status-field-cleanup，2026-10-08）')
  if (text === fs.readFileSync(p, 'utf8')) throw new Error('frontmatter 注入未生效')
  fs.writeFileSync(p, text, 'utf8')
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.statusContradictions.length, 0, JSON.stringify(r.statusContradictions))
  assert.strictEqual(r.statusMismatchVisible.length, 0, 'task: 行也不得进可见项：' + JSON.stringify(r.statusMismatchVisible))
})
// ── 跨源一致性（2026-10-14）：记录文件已 PASS 而旧载体同一条仍未收口 ⇒ 拦。
//    既有判据只管单源自洽，实测放过了「并发整取把已收口的回填倒退回 PENDING」两次。
function xsrcFixture (blocks, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-xsrc-'))
  const lines = []
  for (const b of blocks) {
    lines.push('## ' + b.head)
    lines.push('')
    lines.push('| 门禁 | 状态 | 证据 |')
    lines.push('|------|------|------|')
    if (b.row !== false) lines.push('| 远程同步 | ' + b.status + ' | x |')
    lines.push('')
  }
  fs.writeFileSync(path.join(dir, '.quality-gates.md'), lines.join('\n'), 'utf8')
  const rd = path.join(dir, 'openspec', 'records')
  fs.mkdirSync(rd, { recursive: true })
  for (const r of records) {
    const t = [
      '---',
      'record: ' + r.slug,
      'sync_status: PENDING',
      'sync_reason: 尚未合并',
      'sync_backfill_owner: 下一个会话',
      '---',
      '',
      '## 记录 ' + r.slug,
      '',
      '| 远程同步 | ' + r.status + ' | 证据 |',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(rd, r.slug + '.md'), t, 'utf8')
  }
  return dir
}

test('跨源：记录 PASS 而旧载体同 slug 未收口 ⇒ 违例并阻断', () => {
  const dir = xsrcFixture(
    [{ head: '某功能实现（xsrc-demo，2026-10-14）', status: 'PENDING' }],
    [{ slug: 'xsrc-demo', status: 'PASS' }],
  )
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.crossSrcPairs, 1, JSON.stringify(r.crossSrcPairs))
  assert.strictEqual(r.crossSrcViolations.length, 1, JSON.stringify(r.crossSrcViolations))
  assert.strictEqual(r.crossSrcViolations[0].slug, 'xsrc-demo')
  assert.strictEqual(checker.hasBlocking(r), true, '跨源违例必须进 hasBlocking，否则这道锁是装饰性的')
  assert.match(checker.format(r), /跨源矛盾 1 处/)
})

test('跨源：载体块整块没有 远程同步 行 ⇒ 不并进拦截面（缺行属历史 213 篇那一类）', () => {
  const dir = xsrcFixture(
    [
      { head: '某功能实现（xsrc-norow，2026-10-14）', row: false },
      { head: '陪跑记录（xsrc-decoy，2026-10-14）', status: 'PASS' },
    ],
    [{ slug: 'xsrc-norow', status: 'PASS' }],
  )
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.crossSrcViolations.length, 0, JSON.stringify(r.crossSrcViolations))
})

test('跨源：回填型块的未收口行说的是它自己那笔回填 ⇒ 排除但必须出声', () => {
  const dir = xsrcFixture(
    [{ head: '回填 xsrc-bf 远程同步 PASS 并销账（xsrc-bf，2026-10-14）', status: 'PENDING' }],
    [{ slug: 'xsrc-bf', status: 'PASS' }],
  )
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.crossSrcViolations.length, 0, '回填型块不得判违例')
  assert.strictEqual(r.crossSrcBackfillVisible.length, 1, '但必须可见，不许静默放过')
  assert.match(checker.format(r), /回填型载体块 1 处/)
})

test('跨源：承认清单只能缩小——已不再构成矛盾的项必须报错', () => {
  const dir = xsrcFixture(
    [{ head: '某功能实现（xsrc-ack，2026-10-14）', status: 'PASS' }],
    [{ slug: 'xsrc-ack', status: 'PASS' }],
  )
  const r = checker.collect({ root: dir, ledger: {}, crossSrcAllowed: new Set(['xsrc-ack']) })
  assert.ok(r.crossSrcStaleAck.indexOf('xsrc-ack') >= 0, '已收口却仍挂承认，必须变陈旧红')
  assert.strictEqual(checker.hasBlocking(r), true)
  assert.match(checker.format(r), /跨源承认清单已陈旧/)
})

test('跨源：身份规则退化时配对数必须显式归 0（基线写在断言里，不在生产脚本里抛）', () => {
  const dir = xsrcFixture(
    [{ head: '标题里根本没有括号形态的块', status: 'PASS' }],
    [{ slug: 'xsrc-loose', status: 'PASS' }],
  )
  const r = checker.collect({ root: dir, ledger: {} })
  assert.strictEqual(r.crossSrcPairs, 0, "括号定界失效时配对必须暴露成 0，而不是被当成通过")
  assert.strictEqual(r.crossSrcViolations.length, 0)
})

test('跨源：真仓现场报得出配对数，且当前零未承认违例（防判据整体失效）', () => {
  const r = checker.collect({ root: path.join(__dirname, '..') })
  assert.ok(r.crossSrcPairs > 50, '配对数退化成 ' + r.crossSrcPairs + ' —— 身份规则或载体块解析已失效')
  assert.strictEqual(r.crossSrcViolations.length, 0, '新违例必须由作者回填或显式承认，不许带着红合并')
  assert.strictEqual(r.crossSrcStaleAck.length, 0, JSON.stringify(r.crossSrcStaleAck))
})
