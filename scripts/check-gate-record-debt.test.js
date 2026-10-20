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
  const r = checker.collect({ root: path.join(__dirname, '..'), ledger: checker.loadLedger(path.join(__dirname, '..')) })
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
  // 这条自检必须按档分判，否则它就是个写在今天、红在明天的引信：pull_request 事件里 GitHub 检出的是
  // main⊕本分支的**合并预览**，主干每几分钟长一块，"状态等于基线"在 PR 档结构上必红（2026-10-16 实测
  // run 38781654774 就是它先红）。PR 档改判"本分支自己没往旧载体加/删块"——那才是本 change 真正要守的东西。
  const onPr = (process.env.GITHUB_EVENT_NAME || '') === 'pull_request'
  if (onPr) {
    const d = r.carrierDrift
    if (d) {
      assert.strictEqual(d.removed.length, 0,
        'PR 档允许上游新增块，但绝不允许本 PR 删掉任何一块（删块＝搬走存档）')
      assert.ok(!d.added.some((t) => /freeze-legacy-gate-carrier/.test(t)),
        '本 PR 自己的记录块出现在旧载体里 ⇒ 违反了本 change 的规矩，应改写 openspec/records/')
      console.log('[carrier-selfcheck] branch=PR可见档 removed=0 自己的slug未进旧载体 added=' + d.added.length)
    } else {
      console.log('[carrier-selfcheck] branch=PR可见档 drift=null')
    }
  } else {
    assert.strictEqual(r.carrierDrift, null,
      '真仓旧载体与冻结基线不一致（main/本地档）：说明有人在旧载体上加/删了记录块，应改写 openspec/records/；确属有意变更存档面 → 人工跑 node scripts/freeze-gate-carrier.js 重取')
    console.log('[carrier-selfcheck] branch=严格档 headingCount=' + r.headingCount + ' drift=null')
  }
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
  const r = checker.collect({ root: path.join(__dirname, '..'), ledger: checker.loadLedger(path.join(__dirname, '..')) })
  assert.ok(r.crossSrcPairs > 50, '配对数退化成 ' + r.crossSrcPairs + ' —— 身份规则或载体块解析已失效')
  assert.strictEqual(r.crossSrcViolations.length, 0, '新违例必须由作者回填或显式承认，不许带着红合并')
  assert.strictEqual(r.crossSrcStaleAck.length, 0, JSON.stringify(r.crossSrcStaleAck))
})
// ---- 基线重算器的接线锁（2026-10-15，QM-6 前端轴命中）----
//
// 命中点不是风格问题而是**不可复位**：仓里没有任何测试/门禁引用 scripts/freeze-gate-carrier.js
// （`check-unwired-tests.js` 只扫 `*.test.*`），所以它一旦被 .gitignore 的 `scripts/*.js` 静默
// 吞掉，没有任何东西会变红——而冻结基线从此永久不可重取。那时 design R3 的两条
// 「不许手改基线」+「基线只能由该脚本生成」同时成立，等于把存档面焊在一个不存在的文件上。
//
// 三条各守一格：
//   ① 在库且未被忽略 —— 本地漏 negation 即红，不必等 CI 那句 Cannot find module；
//   ② 复用判据导出的 HEADING_RE / headingTitle —— 生成器曾自带 /^## / 与 slice(3)，
//      两处各写一份时判据改口径会让基线静默对不上，症状是"没人违规却门禁红"；
//   ③ 那条提取口径不得在生成器里再出现第二份（按去注释后的代码体判，注释里提它不算）。

test('基线重算器 freeze-gate-carrier.js 必须在库、不得被忽略、且复用判据同一套口径', () => {
  const { execFileSync } = require('node:child_process')
  const root = path.join(__dirname, '..')
  const rel = 'scripts/freeze-gate-carrier.js'
  const abs = path.join(__dirname, 'freeze-gate-carrier.js')

  // ① 在库：CI 检出里没有这个文件 ⇒ 一切免谈（那正是被忽略后的现场）
  assert.ok(fs.existsSync(abs), `基线重算器不在库：${rel} —— 冻结基线将不可重取`)

  // ① 未被忽略：判据看 check-ignore 的**回显规则**，不看 rc（反选也返回 rc=0，两者语义相同；
  //    而"没有任何规则命中"才是真未忽略，此时 rc=1 且输出为空）
  let decided = ''
  try {
    decided = execFileSync('git', ['check-ignore', '--no-index', '-v', rel], { cwd: root, encoding: 'utf8' }).trim()
  } catch (e) {
    const noise = String((e.stdout || '') + (e.stderr || '')).trim()
    assert.strictEqual(e.status, 1, `git check-ignore 探针异常（status=${e.status}）：${noise.slice(0, 200)}`)
    assert.strictEqual(noise, '', `git check-ignore rc=1 却有输出，探针不可信：${noise.slice(0, 200)}`)
    decided = ''
  }
  if (decided) {
    assert.match(
      decided,
      /![^\s]*freeze-gate-carrier\.js/,
      `决定该文件命运的规则不是反选：「${decided}」—— 漏了 .gitignore 里那条 !scripts/freeze-gate-carrier.js 就会这样：本地全绿、CI 上 Cannot find module`,
    )
  }

  // ②③ 口径单点：必须从判据取 HEADING_RE / headingTitle，且自己不得再写一份提取
  const src = fs.readFileSync(abs, 'utf8')
  assert.match(src, /require\('\.\/check-gate-record-debt\.js'\)/, '重算器没有复用判据模块，两份实现必然漂移')
  for (const sym of ['HEADING_RE', 'headingTitle', 'carrierSignature', 'GATE_FILE', 'CARRIER_FREEZE_FILE']) {
    assert.ok(src.includes(sym), `重算器未复用判据导出的 ${sym} —— 基线与判据的标题口径会分叉`)
  }
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')
  assert.ok(!/\^## /.test(codeOnly), '重算器自带 `^## ` 提取是第二份实现——标题口径必须由 check-gate-record-debt.js 单点持有')
  assert.ok(!/\.slice\(3\)/.test(codeOnly), '重算器自带 `.slice(3)` 是第二份实现——去掉 `## ` 前缀只准在 headingTitle 里发生一次')
})
test('冻结基线自身不一致（headings 长度 != headingCount）必须抛错，不得退化成只报计数', () => {
  // 采纳 QM-6 后端轴 ①-W2。这里的关键不是"能不能报红"，而是**报出来的东西名不副实**：
  // 计数与标题清单不符时，判据仍会因 sha/count 不等而红，但点名分支走 baselineHasTitles=false，
  // 打印成"基线没带标题"——把一次手改基线（design R3 明令禁止的形态）伪装成合法形态。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-freeze-self-'))
  const file = path.join(dir, 'freeze.json')
  const write = (obj) => fs.writeFileSync(file, JSON.stringify(obj), 'utf8')

  // 正控：合法基线必须读得出来。缺了它，下面三条负控只是"任何文件都抛错"的同形红。
  write({ headingSha256: 'a'.repeat(64), headingCount: 2, headings: ['甲', '乙'] })
  assert.deepStrictEqual(checker.loadCarrierFreeze(file).headings, ['甲', '乙'])

  // 负控 1：长度与计数不符（手改基线最可能的形态）⇒ 抛错
  write({ headingSha256: 'a'.repeat(64), headingCount: 3, headings: ['甲', '乙'] })
  assert.throws(() => checker.loadCarrierFreeze(file), /headings 与 headingCount 不一致/)

  // 负控 2：headings 不是数组 ⇒ 抛错
  write({ headingSha256: 'a'.repeat(64), headingCount: 2, headings: '甲乙' })
  assert.throws(() => checker.loadCarrierFreeze(file), /headings 与 headingCount 不一致/)

  // 负控 3：headings 缺席 ⇒ 仍然合法（夹具形态，baselineHasTitles 那条可见项就是为它设的；
  // 把它一并禁掉会让 6 条冻结用例集体红，那是把锁焊在实现细节上，不是守门）
  write({ headingSha256: 'a'.repeat(64), headingCount: 2 })
  assert.strictEqual(checker.loadCarrierFreeze(file).headings, undefined)
})
test('carrier-mode：visible 档只可见不阻断，block 档照拦，非法取值必须抛错', () => {
  // 这条锁守的是"锁装在哪一档"本身：PR 档（visible）里上游新增块必然让状态不等于基线，
  // 若它仍阻断，本门禁就变成"每个 PR 都红"的常量红；若实现退化成两档都不拦，冻结就没了牙。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-mode-'))
  const lines = []
  lines.push('## 本次执行记录：最新（m-newest，2026-09-28）')
  lines.push('')
  lines.push('| 门禁 | 状态 | Fresh 证据 |')
  lines.push('|------|------|-----------|')
  lines.push('| 远程同步 | PASS | PR #9101 合并 |')
  lines.push('')
  fs.writeFileSync(path.join(dir, '.quality-gates.md'), lines.join('\n'), 'utf8')
  fs.mkdirSync(path.join(dir, 'openspec', 'records'), { recursive: true })

  const base = checker.carrierSignature(['别的块'])
  const driftFreeze = { headingCount: base.count, headingSha256: base.sha256, titles: base.titles }
  const r = checker.collect({ root: dir, ledger: {}, carrierFreeze: driftFreeze })
  assert.ok(r.carrierDrift, '夹具必须真的构成漂移，否则下面两句是同形真')

  // 两档的差别必须可判：block 拦、visible 不拦
  assert.strictEqual(checker.hasBlocking(r, { carrierVisible: false }), true, 'block 档必须拦')
  assert.strictEqual(checker.hasBlocking(r, { carrierVisible: true }), false, 'visible 档不得拦')
  // 不拦不等于不说：可见项必须出现，且不得再以 ❌ 形态出现
  assert.match(checker.format(r, { carrierBlocking: false }), /可见项，PR 档不拦/)
  assert.match(checker.format(r, { carrierBlocking: true }), /^❌ 旧载体冻结被破坏/m)

  // 默认参数不得被改掉：老测试与 main 之外任何调用点都按"拦"理解
  assert.strictEqual(checker.hasBlocking(r), true, 'hasBlocking 默认必须仍拦')

  // 旗标解析：缺省=block，两种合法值各自生效，非法值与"看起来像但不等于"的写法一律抛错
  assert.strictEqual(checker.parseCarrierMode([]), 'block')
  assert.strictEqual(checker.parseCarrierMode(['--carrier-mode=visible']), 'visible')
  assert.strictEqual(checker.parseCarrierMode(['--carrier-mode=block']), 'block')
  for (const bad of ['--carrier-mode=visbile', '--carrier-mode=', '--carrier-mode=SKIP', '--carrier-mode']) {
    assert.throws(() => checker.parseCarrierMode([bad]), /carrier-mode/, `非法取值未抛错：${bad}`)
  }
})

// ── change: gate-record-sync-derived-status ──────────────────────────────────
// 「远程同步」收口从人工断言改为 git 现场推导。以下用例是新增判据的契约，
// 每条都对应 design.md D3 的某一格；ledger 一律注入，绝不允许判据默认去读生产仓库
// （carrierFreeze 同款教训：夹具静默量到真仓基线，判据就成了装饰）。

function mkML({ merged = [], added = [], ok = true, reason } = {}) {
  if (!ok) return { ok: false, reason }
  return {
    ok: true,
    mergedPrs: new Map(merged.map((n) => [n, { sha: 'f'.repeat(40), iso: '2026-10-17T00:00:00+08:00' }])),
    addedBy: new Map(added.map(([p, n]) => [p, n])),
    stats: { commits: 10, mergedPrs: merged.length, dupFooters: 0, addedPaths: added.length, addedRecordPaths: added.length },
  }
}

test('派生通道收口：状态列写 PENDING，但记录确由已合并 PR 带入基线 ⇒ 不得进欠账', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'derived-ok', { row: 'PENDING' })
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({ merged: [777], added: [['openspec/records/derived-ok.md', 777]] }),
  })
  assert.strictEqual(r.open.filter((o) => o.source === 'records').length, 0, JSON.stringify(r.open))
  assert.strictEqual(r.derivedClosed.length, 1, JSON.stringify(r.derivedClosed))
  assert.strictEqual(r.derivedClosed[0].pr, 777)
})

test('缺行仍然即红：派生证据不得豁免「这一行必须存在」', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'norow-derived', { withRow: false })
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({ merged: [778], added: [['openspec/records/norow-derived.md', 778]] }),
  })
  assert.strictEqual(r.missingRecordRows.length, 1, JSON.stringify(r.missingRecordRows))
  assert.strictEqual(r.derivedClosed.length, 0, '缺行的记录绝不能被派生算成收口')
  assert.strictEqual(checker.hasBlocking(r), true)
})

test('账本不可用必须退回断言档并 fail-closed：未闭合且无登记仍是欠账', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'open-no-reg', { row: 'PENDING' })
  const r = checker.collect({ root: dir, ledger: {}, mergeLedger: mkML({ ok: false, reason: 'git-failed' }) })
  assert.strictEqual(r.open.filter((o) => o.source === 'records').length, 1, JSON.stringify(r.open))
  assert.strictEqual(r.ledger.ok, false)
  assert.strictEqual(r.derivedClosed.length, 0)
  assert.match(checker.format(r), /MERGE-LEDGER prs=n\/a/, '不可用必须出声，不得静默降级')
})

test('字段卫生只约束「做过闭合断言」的记录：纯派生收口带 legacy 字段不得判红', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'derived-with-fields', {
    row: 'PENDING',
    fm: { sync_status: 'PENDING', sync_reason: '存量旧形态', sync_backfill_owner: '顺路清理' },
  })
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({ merged: [779], added: [['openspec/records/derived-with-fields.md', 779]] }),
  })
  assert.strictEqual(r.staleRecordFields.length, 0, JSON.stringify(r.staleRecordFields))
})

test('谁做断言谁受约束：派生命中但状态列仍写 PASS 时，字段卫生必须照常生效', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'derived-and-claims', { row: 'PASS', fm: { sync_status: 'PASS' } })
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({ merged: [780], added: [['openspec/records/derived-and-claims.md', 780]] }),
  })
  assert.strictEqual(r.staleRecordFields.length, 1, JSON.stringify(r.staleRecordFields))
  // 这一格是反证 M9 的指名落点：把 blob 闭合提到派生之前（"blob 占了这条记录，派生档就不必再记"）
  // 必须在这里变红——优先级链是"两条都记账、由谁定身"，不是"先到者独吞"。
  assert.strictEqual(r.derivedClosed.length, 1,
    '派生与断言同时成立时，派生档仍必须记账（自证行与跨源可见档都消费它，独吞会让读数说谎）')
})

test('本次变更集新增的记录判 byDesign，不红；预写 PASS 判 prematureClaim', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'brand-new-open', { row: 'PENDING' })
  recFile(dir, 'brand-new-claims', { row: 'PASS' })
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({ merged: [781], added: [['openspec/records/unrelated.md', 781]] }),
  })
  assert.strictEqual(r.open.filter((o) => o.source === 'records').length, 0, JSON.stringify(r.open))
  assert.deepStrictEqual(r.byDesign.sort(), ['brand-new-open.md'])
  assert.strictEqual(r.prematureClaims.length, 1, JSON.stringify(r.prematureClaims))
  assert.match(r.prematureClaims[0].file, /brand-new-claims/)
  assert.strictEqual(checker.hasBlocking(r), true, '预写不存在的证据必须拦')
  assert.match(checker.format(r), /预写/)
})

test('声明的来源 PR 与主干事实不符必须判红；缺省不判；一致不判', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'liar', { row: 'PENDING', fm: { delivered_by_pr: '111' } })
  recFile(dir, 'honest', { row: 'PENDING', fm: { delivered_by_pr: '222' } })
  recFile(dir, 'silent', { row: 'PENDING' })
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({
      merged: [222, 333],
      added: [['openspec/records/liar.md', 333], ['openspec/records/honest.md', 222], ['openspec/records/silent.md', 333]],
    }),
  })
  assert.strictEqual(r.intentMismatch.length, 1, JSON.stringify(r.intentMismatch))
  assert.match(r.intentMismatch[0].file, /liar/)
  assert.strictEqual(r.intentMismatch[0].declared, 111)
  assert.strictEqual(r.intentMismatch[0].actual, 333)
  assert.strictEqual(checker.hasBlocking(r), true)
})

test('跨源比对拦截面保持「blob 做过断言」；纯派生收口与旧载体的矛盾转可见并打印条数', () => {
  const dir = fixture([
    { head: '本次执行记录：甲（cross-legacy-claims，2026-09-28）', status: 'PENDING' },
    { head: '本次执行记录：乙（cross-derived-only，2026-09-28）', status: 'PENDING' },
  ])
  recFile(dir, 'cross-legacy-claims', { row: 'PASS' })
  recFile(dir, 'cross-derived-only', { row: 'PENDING' })
  const r = checker.collect({
    root: dir, ledger: {}, crossSrcAllowed: new Set(),
    mergeLedger: mkML({
      merged: [900],
      added: [['openspec/records/cross-derived-only.md', 900], ['openspec/records/cross-legacy-claims.md', 900]],
    }),
  })
  // blob 声称 PASS 的那篇：与旧载体同 slug 的 PENDING 构成矛盾 ⇒ 仍拦（既有行为不变）
  assert.strictEqual(r.crossSrcViolations.length, 1, JSON.stringify(r.crossSrcViolations))
  assert.match(r.crossSrcViolations[0].slug, /cross-legacy-claims/)
  // 纯派生收口的那篇：不拦，但必须可见并出声，否则"一个会话改写了别人的旧行"这种真矛盾永久沉默
  assert.strictEqual(r.derivedCrossVisible.length, 1, JSON.stringify(r.derivedCrossVisible))
  assert.match(checker.format(r), /派生.*旧载体.*1/)
})

test('归属三态在判据侧各有落点：NO_FOOTER 落兼容档，PR 不在账本出声后仍落兼容档', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'no-footer', { row: 'PASS' })
  recFile(dir, 'pr-missing', { row: 'PASS' })
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({
      merged: [901],
      added: [['openspec/records/no-footer.md', null], ['openspec/records/pr-missing.md', 999]],
    }),
  })
  assert.strictEqual(r.derivedClosed.length, 0, JSON.stringify(r.derivedClosed))
  assert.strictEqual(r.open.length, 0, '两篇状态列都写了 PASS，兼容档必须放行（存量零漂移的构成部分）')
  assert.deepStrictEqual(r.inconsistentAttribution.map((x) => x.file).sort(), ['pr-missing.md'],
    'PR 解析出来了但账本里没有 = 取证不一致，必须单列出声')
})

test('接线锁：判据从 merge-ledger 取值，自身不得再写第二份 git 解析', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-gate-record-debt.js'), 'utf8')
  assert.match(src, /require\(['"]\.\/lib\/merge-ledger\.js['"]\)/, '判据必须复用单一取源')
  const body = src.replace(/^\s*\/\/.*$/gm, '')
  assert.strictEqual(/'log'|"log"/.test(body), false, '判据内出现第二份 git log 解析就会与账本口径漂移')
  assert.strictEqual(/execFileSync\(\s*'git'/.test(body), false, '判据不得自己 spawn git')
})

test('规范键写了但读不出数字必须判红；旧键 sync_pr 自由文本只可见不误红存量', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  // 实测：真仓 6 篇的 sync_pr 形态是 0 / pending / 完整 URL，没有一篇是整数 ⇒ 旧键绝不能当判据输入
  recFile(dir, 'legacy-zero', { row: 'PASS', fm: { sync_pr: '0' } })
  recFile(dir, 'legacy-url', { row: 'PENDING', fm: { sync_pr: "'https://github.com/x/y/pull/3738'" } })
  recFile(dir, 'bad-canonical', { row: 'PENDING', fm: { delivered_by_pr: 'PR-123' } })
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({ merged: [500], added: [['openspec/records/legacy-zero.md', 500], ['openspec/records/legacy-url.md', 500]] }),
  })
  assert.strictEqual(r.ambiguousPrKeys.length, 2, JSON.stringify(r.ambiguousPrKeys))
  assert.match(checker.format(r), /sync_pr/, '歧义键必须出声，否则两个键名会永久并存')
  // 旧键不进拦截面：把它算成红，等于让 6 篇存量记录把之后每个 PR 都钉红（本仓"常量红"的已知形态）
  const onlyLegacy = r.intentMismatch.filter((m) => /legacy-/.test(m.file))
  assert.strictEqual(onlyLegacy.length, 0, JSON.stringify(r.intentMismatch))
  // 规范键写了却读不出数字：按未核对判红，不许静默当成"没声明"
  assert.strictEqual(r.intentMismatch.filter((m) => /bad-canonical/.test(m.file)).length, 1)
  assert.strictEqual(checker.hasBlocking(r), true)
})

// 真仓锁：接入派生档前后，拦截集合必须逐篇相同（"存量不动"的唯一机械证据）。
// 编码方式不需要两个代码版本——把"派生不可用"当改前口径跑一次，把真账本当改后口径跑一次：
// 前者走的正是改造前唯一存在的那条通道。baseRef 钉死为显式参数，不取当前 HEAD（并发主干不可复现）。
test('真仓改前/改后对账：派生接入不新增任何红，只把已合并的欠账转为收口', (t) => {
  const { execFileSync } = require('node:child_process')
  const { buildLedger } = require('./lib/merge-ledger.js')
  let root
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { encoding: 'utf8' })
  } catch (e) {
    t.skip('取不到 origin/main：' + e.message)
    return
  }
  const frozen = execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim()
  const ml = buildLedger({ baseRef: frozen, cwd: root })
  assert.equal(ml.ok, true, `真仓账本必须可用：${ml.reason}`)
  // 反证 M13 的落点：对账必须站在**同一个钉死 SHA** 上。去掉 `baseRef: frozen` 的钉死
  // （退回默认值或改写当前 HEAD）时，这一格立刻红——主干在会话进行中会前进，
  // 不钉 SHA 的改前/改后对账不可复现（评审 TASKS-4 实测：同一会话内 406→407 篇）。
  assert.strictEqual(ml.baseSha, frozen, '账本必须由显式钉死的 SHA 构建，不得由默认值另行解析')
  const unavailable = { ok: false, reason: 'forced-unavailable' }
  const before = checker.collect({ root, ledger: checker.loadLedger(), mergeLedger: unavailable })
  const after = checker.collect({ root, ledger: checker.loadLedger(), mergeLedger: ml })
  const key = (r) => ({
    open: r.open.map((o) => `${o.source}|${o.heading}`).sort(),
    missing: r.missingRecordRows.map((m) => m.file).sort(),
    fields: r.staleRecordFields.slice().sort(),
    contradictions: r.statusContradictions.map((c) => `${c.file}|${c.bulletLine}`).sort(),
    cross: r.crossSrcViolations.map((c) => c.slug).sort(),
    premature: r.prematureClaims.map((c) => c.file).sort(),
    mismatch: r.intentMismatch.map((c) => c.file).sort(),
  })
  const b = key(before)
  const a = key(after)
  assert.deepStrictEqual(a.premature, [], '真仓上不得出现预写证据')
  assert.deepStrictEqual(a.mismatch.filter((x) => !/unreadable/.test(x)), [],
    '真仓上不得出现"规范键与主干事实不符"（规范键 delivered_by_pr 尚无用户）')
  // 这条断言是本轮实测揪出来的：`sync_pr` 这个键名已被 6 篇记录占用且形态互不相通
  // （0 ×2 / pending ×3 / URL ×1）。写下它，下一个会话才不会又把规范键起成同一个名字。
  assert.ok(before.ambiguousPrKeys.length >= 6,
    `旧键歧义必须可见（下界 6，实测改前 ${before.ambiguousPrKeys.length}）`)
  assert.deepStrictEqual(after.ambiguousPrKeys.map((x) => x.file).sort(),
    before.ambiguousPrKeys.map((x) => x.file).sort(), '歧义集合不得因派生接入而变化')
  for (const f of ['open', 'missing', 'fields', 'contradictions', 'cross']) {
    assert.deepStrictEqual(a[f], b[f], `拦截集合的 ${f} 维度必须逐篇相同，实测差异即存量被动过`)
  }
  assert.ok(after.derivedClosed.length >= 300,
    `派生收口必须真的覆盖存量（下界 300，实测 ${after.derivedClosed.length}）`)
  assert.strictEqual(checker.hasBlocking(before), checker.hasBlocking(after), '两档的总判定必须同向')
})

test('parseFlags 必须接受 CI 实际下发的旗标形态，并对未知值与裸旗标抛错', () => {
  // 动因（本机实测两次）：
  //  ① 白名单曾写成带前导 -- 的整串，而比较用的是剥掉 -- 后的名字 ⇒ 永不相等 ⇒
  //     quality-gate.yml 里那句 --carrier-mode=$CARRIER_MODE 展开后会让判据在未捕获异常中退出（rc=1）。
  //     既有测试抓不到，因为它们直接喂 parseCarrierMode，绕过了 parseFlags 这一层。
  //  ② CI 下发的是**展开后**的值，所以锁必须按展开形态写，不能只测字面量。
  assert.doesNotThrow(() => checker.parseFlags([]))
  assert.doesNotThrow(() => checker.parseFlags(['--carrier-mode=visible']))
  assert.doesNotThrow(() => checker.parseFlags(['--carrier-mode=block']))
  assert.doesNotThrow(() => checker.parseFlags(['--base-ref=origin/main']))
  assert.doesNotThrow(() => checker.parseFlags(['--base-ref=' + 'f'.repeat(40)]))
  // `--current-pr` 曾被白名单接受却没有任何消费者（外部评审 F2）。"接受一个不生效的旗标"
  // 与"拼错了被静默忽略"是同一条反模式的两端 ⇒ 现在必须当场抛，而不是"收下再说"。
  assert.throws(() => checker.parseFlags(['--current-pr=3810']), /未知旗标/,
    '无人消费的旗标必须被拒绝，否则 CI 里它会读起来像"某一档生效了"')
  for (const bad of ['--json', '--Base-Ref=x', '--carriermode=visible', '--base-ref', '--current-pr']) {
    assert.throws(() => checker.parseFlags([bad]), /未知旗标|必须写成/, `未出声的参数形态：${bad}`)
  }
  // base-ref 的取值必须真的被用上（不是收下就丢）
  assert.strictEqual(checker.parseBaseRef(['--base-ref=refs/heads/x']), 'refs/heads/x')
  assert.strictEqual(checker.parseBaseRef([]), 'origin/main')
})

test('CI 档账本不可用必须非零退出：判据停用不是通过', async () => {
  const { spawnSync } = require('node:child_process')
  const root = process.cwd()
  const r = spawnSync(process.execPath, [
    path.join(__dirname, 'check-gate-record-debt.js'),
    '--base-ref=nope/nope',
  ], { encoding: 'utf8', cwd: root, env: { ...process.env, CI: 'true' } })
  assert.strictEqual(r.status, 2, `CI 下派生档停用应退 2，实际 ${r.status}；stderr=${String(r.stderr).slice(0, 200)}`)
  assert.match(String(r.stderr) + String(r.stdout), /派生档在 CI 上不可用/)
  assert.match(String(r.stdout), /MERGE-LEDGER prs=n\/a/)
  // 同一命令在本机（CI 未设）不得因为"本地没有 origin/main"就判故障——那是合法使用形态
  const local = spawnSync(process.execPath, [
    path.join(__dirname, 'check-gate-record-debt.js'),
    '--base-ref=nope/nope',
  ], { encoding: 'utf8', cwd: root, env: { ...process.env, CI: '' } })
  assert.notStrictEqual(local.status, 2, '本机跑不得套用 CI 档的强制退出')
})

test('接线锁：CLI 必须真的调用 parseFlags 并注入可用账本（函数有测试不等于被接上）', () => {
  // 动因：变异 N6 实测——把 main() 里的 parseFlags(argv) 整行摘掉，72 条用例全绿。
  // 那就是"既精确又无用"的锁：它测的是函数本体，而缺陷住在调用点上。
  const { spawnSync } = require('node:child_process')
  const cli = path.join(__dirname, 'check-gate-record-debt.js')
  const cwd = process.cwd()

  const bad = spawnSync(process.execPath, [cli, '--json'], { encoding: 'utf8', cwd })
  assert.notStrictEqual(bad.status, 0, `未知旗标必须让 CLI 失败，实际 rc=${bad.status}`)
  assert.match(String(bad.stderr) + String(bad.stdout), /未知旗标/)

  // CI 实际下发的形态必须能跑通：上一版白名单写成带 -- 前缀的整串，比较用的是剥掉 -- 的名字，
  // 于是 --carrier-mode=visible 也被判"未知"，判据在未捕获异常里退出（本机实测 rc=1）。
  const ok = spawnSync(process.execPath, [cli, '--carrier-mode=visible'], { encoding: 'utf8', cwd })
  assert.ok(ok.status === 0 || ok.status === 1,
    `合法旗标必须只产生判定结果（0/1），实际 rc=${ok.status}；stderr=${String(ok.stderr).slice(0, 200)}`)
  assert.doesNotMatch(String(ok.stderr), /未知旗标|必须写成/, '合法旗标被拒 = 判据在 CI 上恒红')
  // 变异 N8 实测：把 collect() 的默认账本构造写成坏 baseRef，72 条全绿——因为所有用例都注入 mergeLedger，
  // "默认那条路"从没被走过。CLI 的默认档必须自己证明真的读到了账本。
  assert.match(String(ok.stdout), /MERGE-LEDGER prs=\d+[^\n]*归属可解析记录=\d+/,
    `默认 baseRef 必须真读到账本；实际首行：${String(ok.stdout).split('\n')[0]}`)
  assert.doesNotMatch(String(ok.stdout), /MERGE-LEDGER prs=n\/a/, '默认档读出"不可用"说明取源接线坏了，不是通过')
  // M2 实测：把 collect(...) 的 closureDiff 注入整条摘掉，先前 104 条用例全绿——判据的"人工改写"
  // 那一档在 CLI 上从此恒不测，打印面只换成 prs=n/a，读起来像"这台机器取不到差量"而不是"没人改写"。
  // 与上一段 MERGE-LEDGER 同一条道理：函数本体有测试不等于它被接上，接线只能由产物线证明。
  const closureLine = String(ok.stdout).split('\n').find((l) => l.startsWith('HAND-CLOSURE')) || '<无该行>'
  assert.match(String(ok.stdout), /HAND-CLOSURE 人工改写=\d+ 新增重复行=\d+ 记录被删=\d+ 触碰记录=\d+/,
    `默认档必须真把 PR 差量喂进判据；实际：${closureLine}`)
  assert.doesNotMatch(String(ok.stdout), /HAND-CLOSURE prs=n\/a/,
    '默认档读出"未注入/取源失败"说明 CLI 那条接线断了，不是通过')
})

test('端到端：真历史上一笔回填 PR 必须让 CLI 判红并点名那篇记录', () => {
  // 这条测的是 argv → 取源 → classify → format → hasBlocking → 退出码 的整条链，
  // 所以它专门抓"M2 那一类断线"：判据本体的用例各测一段，接缝没人测就会恒绿。
  // SHA 是固定历史提交（本仓不改写 main），取不到就是环境异常 ⇒ 一律抛错而非 skip——
  // 把"没跑到"写成"按设计跳过"正是本仓装饰性门禁的落点之一。
  const { execFileSync, spawnSync } = require('node:child_process')
  const git = (a) => execFileSync('git', ['-c', 'core.quotepath=off', ...a], { encoding: 'utf8' }).trim()
  const BACKFILL_MERGE = '99f463121582294f52ab3cc543e8c9ad60055d09' // PR #3889 的 squash 合并
  const headSha = git(['rev-parse', '--verify', `${BACKFILL_MERGE}^{commit}`])
  const baseSha = git(['rev-parse', '--verify', `${BACKFILL_MERGE}^1`])
  const cli = path.join(__dirname, 'check-gate-record-debt.js')
  const r = spawnSync(process.execPath, [cli, `--base-ref=${baseSha}`, `--head-ref=${headSha}`], {
    encoding: 'utf8', cwd: process.cwd(), env: { ...process.env, CI: '' },
  })
  const out = String(r.stdout) + String(r.stderr)
  const hand = out.split('\n').find((l) => l.startsWith('HAND-CLOSURE')) || '<无该行>'
  assert.match(out, /HAND-CLOSURE 人工改写=[1-9]/, `真回填必须报出改写条数；实际：${hand}；rc=${r.status}`)
  assert.match(out, /max-lines-git-domain/, `红文案必须点名被改写的那篇记录；实际：${hand}`)
  assert.strictEqual(r.status, 1, `人工改写收口行必须阻断（rc=1），实际 rc=${r.status}；首行 ${hand}`)
  // 同一次跑里其余判据必须照跑：端到端用例若把 rc=1 归因到别处，就等于什么都没证明。
  assert.match(out, /MERGE-LEDGER prs=\d+/, `账本那档必须仍在同一趟里出数；实际：${out.split('\n')[0]}`)
})

test('账本不可用的出声必须点名"一起熄灯的三道能力"（评审 F1/F3）', () => {
  // 只说"派生档停用"是不够的：读的人会以为只是少一条收口通道，
  // 实际是"预写 PASS 不再被看见"和"归属谎报不再被核对"一起没了。
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'open-no-reg', { row: 'PENDING' })
  const r = checker.collect({ root: dir, ledger: {}, mergeLedger: mkML({ ok: false, reason: 'git-failed' }) })
  const text = checker.format(r)
  assert.match(text, /prematureClaims/, '必须点名预写拦截一起停用')
  assert.match(text, /delivered_by_pr/, '必须点名归属交叉核对一起停用')
  assert.match(text, /rc=2|CI 档/, '必须说明 CI 档这属于门禁故障而非降级')
})

test('规范键与旧键并存且取值不一致时，旧键不得被静默吞掉（评审 F4）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'both-keys', { row: 'PENDING', fm: { delivered_by_pr: '3810', sync_pr: '3999' } })
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({ merged: [3810], added: [['openspec/records/both-keys.md', 3810]] }),
  })
  assert.strictEqual(r.ambiguousPrKeys.length, 1, JSON.stringify(r.ambiguousPrKeys))
  assert.match(r.ambiguousPrKeys[0].value, /并存且不一致/, '必须说明是两键冲突，而不是只回显旧值')
  // 规范键与主干事实一致 ⇒ 不因旧键冲突而误判 intentMismatch
  assert.strictEqual(r.intentMismatch.length, 0, JSON.stringify(r.intentMismatch))
  assert.strictEqual(r.derivedClosed.length, 1, '收口仍按规范键与主干事实得出，旧键只制造可见歧义')
})

test('账本不可用时，新形态「由门禁推导」判未证实而非判忘了登记', () => {
  // 新模板要求：状态列只写「由门禁推导」、不再预填任何登记字段。
  // 若账本不可用还按旧口径追问"你的 sync_reason 呢"，就是把我测不了说成你没做（假指控），
  // 而且会诱导作者去补写登记字段——那正是本 change 要淘汰的形态。
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'new-form', { row: '由门禁推导' })
  const r = checker.collect({ root: dir, ledger: {}, mergeLedger: mkML({ ok: false, reason: 'not-injected' }) })
  assert.strictEqual(r.open.filter((o) => o.source === 'records').length, 0, JSON.stringify(r.open))
  assert.strictEqual(r.unprovenDerived.length, 1, JSON.stringify(r.unprovenDerived))
  assert.strictEqual(r.derivedClosed.length, 0, '未证实不等于已收口（fail-closed 的方向不许反过来）')
  assert.strictEqual(checker.hasBlocking(r), false, '未证实只出声，不把整条门禁钉红（CI 档由 rc=2 单独拦）')
  assert.match(checker.format(r), /未证实/)

  // 同一篇在账本可用时必须被派生收口，而不是继续挂"未证实"
  const okLedger = mkML({ merged: [4001], added: [['openspec/records/new-form.md', 4001]] })
  const r2 = checker.collect({ root: dir, ledger: {}, mergeLedger: okLedger })
  assert.strictEqual(r2.unprovenDerived.length, 0)
  assert.strictEqual(r2.derivedClosed.length, 1)
})

test('域一致锁：派生档实际处理过的文件集合必须逐等于 listRecordFiles 的返回值（评审 i8 / 反证 M10）', () => {
  // 这条锁防的不是"清单写错"，而是"循环换了输入源"：把 for 的文件集合换成一份额外的
  // readdirSync（不过 `_` 前缀、或递归进子目录）时，两份集合立刻不等。
  // 探针曾真实把 _exempt/ 读进门禁域并误判出"1 篇缺行"，所以判据必须是集合相等，不是计数。
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'domain-a', { row: 'PENDING' })
  recFile(dir, 'domain-b', { withRow: false })
  recFile(dir, 'domain-c', { row: '由门禁推导' })
  fs.writeFileSync(path.join(dir, 'openspec', 'records', '_TEMPLATE.md'), '# 模板自带一行 远程同步\n', 'utf8')
  const recordsRoot = path.join(dir, 'openspec', 'records')
  const ml = mkML({ merged: [5001], added: [['openspec/records/domain-a.md', 5001]] })
  const r = checker.collect({ root: dir, ledger: {}, mergeLedger: ml })

  const expected = checker.listRecordFiles(recordsRoot).slice().sort()
  assert.ok(expected.length >= 3, `夹具必须真的有内容可扫，实测 ${expected.length}`)
  assert.ok(!expected.includes('_TEMPLATE.md'), 'listRecordFiles 自己就该排除模板与 `_` 前缀')
  assert.deepStrictEqual(r.recordsClassified.slice().sort(), expected,
    '派生档的遍历域与唯一枚举实现不一致 ⇒ 存在第二份文件清单')
})


// ── change: ban-record-closure-backfill-pr ───────────────────────────────────
// 收口已改为按主干历史推导（#3879），AGENTS 也写下「禁止为改写这一行另开 PR」。
// 但实测禁令进 main 后 4 小时内仍有 4 笔回填 PR 合入 —— 成因是并发会话的分支在禁令
// 落地前就切出去了，它们读到的文档还是旧口径。对这一型违犯，"把话说清楚"作用为零，
// 所以这条必须是机械拦截（同 R0 删除守卫的理由）。
// 契约形态：同一文件内，删除侧存在未闭合的 `| 远程同步 |` 行 ∧ 新增侧存在闭合词的同一行。
// 弃用窄判据（"本 PR 只动了那一行"）：实测漏 2/4（#3890/#3891 顺带加了回读小节与 QM 行状态）。

function closureDiff(file, removed, added, extraHunks) {
  const L = []
  L.push('diff --git a/' + file + ' b/' + file)
  L.push('--- a/' + file)
  L.push('+++ b/' + file)
  if (extraHunks) L.push(...extraHunks)
  L.push('@@ -20,1 +20,1 @@')
  for (const s of removed) L.push('-| 远程同步 | ' + s + ' | 旧证据 |')
  for (const s of added) L.push('+| 远程同步 | ' + s + ' | 新证据 |')
  return L.join('\r\n') + '\r\n'
}

test('判据形态：同一文件内「未闭合 → 闭合词」必须被识别为人工改写', () => {
  const rows = checker.parseClosureTransitions(
    closureDiff('openspec/records/a.md', ['PENDING'], ['PASS']),
    new Set(['a.md'])
  )
  assert.equal(rows.length, 1, JSON.stringify(rows))
  assert.equal(rows[0].file, 'a.md')
  assert.equal(rows[0].from, 'PENDING')
  assert.equal(rows[0].to, 'PASS')
})

test('迁移方向不判：改成「由门禁推导」是本机制唯一鼓励的改写，锁不得装在这条路上', () => {
  const rows = checker.parseClosureTransitions(
    closureDiff('openspec/records/a.md', ['PENDING'], ['由门禁推导']),
    new Set(['a.md'])
  )
  assert.deepEqual(rows, [], '派生标记不得计入闭合词')
})

test('反向跃迁不判：闭合 → 未闭合不是在预写证据，判它只会误伤文案清理', () => {
  const rows = checker.parseClosureTransitions(
    closureDiff('openspec/records/a.md', ['PASS'], ['PENDING']),
    new Set(['a.md'])
  )
  assert.deepEqual(rows, [])
})

test('未触碰不判：diff 里没有这一行时，不得凭"历史上写过什么"红（存量不动）', () => {
  const text = [
    'diff --git a/openspec/records/a.md b/openspec/records/a.md',
    '--- a/openspec/records/a.md',
    '+++ b/openspec/records/a.md',
    '@@ -9,1 +9,1 @@',
    '+| QM-1 | PASS | 无关行 |',
    '',
  ].join('\r\n')
  assert.deepEqual(checker.parseClosureTransitions(text, new Set(['a.md'])), [])
})

test('整块重写也要配对：同 PR 改了 QM 行 + 那一行 + 若干 bullet 时不得漏判', () => {
  // 这就是 #3891 的真实形态：窄判据在这里失效。配对只看同一文件内的删除侧/新增侧，
  // 不要求行号对齐（一篇记录只应有一行 远程同步，重复行由既有"写两遍"判据拦）。
  const text = closureDiff(
    'openspec/records/a.md', ['PENDING'], ['PASS'],
    ['@@ -12,2 +12,2 @@',
     '-| QM-4 视觉 | 部分 | 基线待回填',
     '+| QM-4 视觉 | PASS | 基线已同源重取']
  )
  const rows = checker.parseClosureTransitions(text, new Set(['a.md']))
  assert.equal(rows.length, 1, JSON.stringify(rows))
  assert.equal(rows[0].to, 'PASS')
})

test('词表同源：闭合词字面量在判据里只允许出现一处（CLOSED_RE 本体）', () => {
  // 两份词表必然漂移，漂移方向是"换个新词就绕过"或"合法新词被误伤"。
  const src = fs.readFileSync(path.join(__dirname, 'check-gate-record-debt.js'), 'utf8')
  const needle = '(PASS|N\\/A|✅|已)'
  const hits = src.split(needle).length - 1
  assert.equal(hits, 1, '闭合词表出现 ' + hits + ' 次，必须恰好 1 处')
})

test('扫描域：域 = listRecordFiles ∩ diff ∩ 记录前缀，旧载体与模板/豁免目录不得进来', () => {
  const text = [
    closureDiff('openspec/records/b.md', ['PENDING'], ['PASS']),
    closureDiff('openspec/records/_TEMPLATE.md', ['PENDING'], ['PASS']),
    closureDiff('openspec/records/_exempt/c.md', ['PENDING'], ['PASS']),
    closureDiff('.quality-gates.md', ['PENDING'], ['PASS']),
  ].join('')
  const rows = checker.parseClosureTransitions(text, new Set(['b.md']))
  assert.deepEqual(rows.map((r) => r.file), ['b.md'], JSON.stringify(rows))
})

test('collect 接线：识别出的改写必须同时进打印面与 hasBlocking', () => {
  // 只打印不参与判定 = 装饰性门禁（本仓 Gate 7「捕获退出码但不参与判定」同型）。
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'hand-closed', { row: 'PENDING' })
  const okLedger = mkML({ merged: [5001], added: [['openspec/records/hand-closed.md', 5001]] })
  const r = checker.collect({
    root: dir, ledger: {}, mergeLedger: okLedger,
    closureDiff: {
      ok: true, files: ['hand-closed.md'],
      diff: closureDiff('openspec/records/hand-closed.md', ['PENDING'], ['PASS']),
    },
  })
  assert.equal(r.handClosedRows.length, 1, JSON.stringify(r.handClosedRows))
  assert.equal(checker.hasBlocking(r), true, '新红必须进阻断出口')
  const printed = checker.format(r)
  assert.match(printed, /人工改写/, '打印面必须点名这件事')
  assert.match(printed, /由门禁推导|不需要.*改写/, '文案必须给出不需要绕行的正解')
})

test('collect 未注入 closureDiff 时按未证实处理，不得读成"没有改写"', () => {
  // 把工具的失明读成结论是本仓「装饰性门禁」的同型；上一轮 LEDGER-1 同口径。
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'no-diff', { row: 'PENDING' })
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({ merged: [5002], added: [['openspec/records/no-diff.md', 5002]] }),
  })
  assert.equal(r.handClosureUnproven, 'not-injected')
  assert.equal(r.handClosedRows.length, 0)
  assert.equal(checker.hasBlocking(r), false, '本机档的未证实只出声，不把门禁钉红')
})

test('不可用的三种形态各自可区分，且都必须原样出声', () => {
  for (const reason of ['ref-unresolvable', 'git-failed', 'empty-diff-with-files']) {
    const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
    recFile(dir, 'u', { row: 'PENDING' })
    const r = checker.collect({
      root: dir, ledger: {},
      mergeLedger: mkML({ merged: [5003], added: [['openspec/records/u.md', 5003]] }),
      closureDiff: { ok: false, reason },
    })
    assert.equal(r.handClosureUnproven, reason, '原因必须原样出声：' + reason)
    assert.equal(r.handClosedRows.length, 0)
  }
})

test('CI 档未证实必须非零退出：判据停用不是通过', () => {
  // 真起子进程：collect 级断言测不到 CLI 里那档 rc（上一轮 N8 的同型教训）。
  const { spawnSync } = require('node:child_process')
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-gate-record-debt.js')], {
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', MP_TEST_FORCE_UNPROVEN: 'git-failed' },
    timeout: 120000,
  })
  assert.notEqual(r.status, 0, 'CI 档拿不到 diff 读数时必须非零：' + String(r.stdout).slice(0, 200))
  assert.match(`${r.stdout}${r.stderr}`, /人工改写|HAND-CLOSURE/, '必须点名是哪条锁停用')
})

test('域正确性锁：两点式会把别人改过的文件拉进扫描域，三点式不会', () => {
  // 对照实验（.tools/cmp-diff-mode.cjs）实测：两种写法的**红集逐字相同**，
  // 唯一可分辨处是文件集（两点式 2 / 三点式 1）。所以这条 MUST 断言文件集 ——
  // 断言红集的话两点式与三点式同绿，那条锁就是装饰（design D6/M5 已按此改写）。
  const { execFileSync } = require('node:child_process')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mp-hand-${process.pid}-`))
  const git = (a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf8' })
  git(['init', '-q'])
  const trunk = git(['symbolic-ref', '--short', 'HEAD']).trim()
  const row = (s) => '| 远程同步 | ' + s + ' | 证据 |\r\n'
  const write = (n, s) => {
    fs.mkdirSync(path.join(root, 'openspec', 'records'), { recursive: true })
    fs.writeFileSync(path.join(root, 'openspec', 'records', n), row(s))
  }
  write('mine.md', 'PENDING')
  write('theirs.md', 'PENDING')
  git(['add', '-A']); git(['commit', '-q', '-m', 'init'])
  git(['checkout', '-q', '-b', 'feat'])
  write('mine.md', 'PASS')
  git(['add', '-A']); git(['commit', '-q', '-m', 'mine hand-closed (#7001)'])
  const head = git(['rev-parse', 'HEAD']).trim()
  git(['checkout', '-q', trunk])
  write('theirs.md', 'PASS')
  write('other.md', 'PENDING')
  git(['add', '-A']); git(['commit', '-q', '-m', 'theirs hand-closed (#7002)'])
  const base = git(['rev-parse', 'HEAD']).trim()

  const three = checker.buildClosureDiff({ baseRef: base, headRef: head, cwd: root, recordsRel: 'openspec/records' })
  assert.equal(three.ok, true, JSON.stringify(three))
  assert.deepEqual(three.files, ['mine.md'], '域必须只含本 PR 触碰的那一篇：' + JSON.stringify(three.files))

  fs.rmSync(root, { recursive: true, force: true })
})

test('旗标面：--head-ref 必须被消费，裸旗标抛错、未知旗标抛错', () => {
  assert.equal(checker.parseHeadRef(['--head-ref=refs/pull/9/head']), 'refs/pull/9/head')
  assert.equal(checker.parseHeadRef([]), 'HEAD')
  assert.throws(() => checker.parseFlags(['--head-ref']), /必须写成/)
  assert.doesNotThrow(() => checker.parseFlags(['--head-ref=HEAD~1']))
})

test('真仓下界：这条锁在真实历史上确实有东西可拦（清单只能缩小）', (t) => {
  const { execFileSync } = require('node:child_process')
  let root
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { encoding: 'utf8' })
  } catch (e) {
    t.skip('取不到 origin/main：' + e.message)
    return
  }
  const d = checker.buildClosureDiff({
    baseRef: 'origin/main', headRef: 'HEAD', cwd: root, recordsRel: 'openspec/records',
  })
  assert.equal(d.ok, true, `真仓必须可用：${d.reason}`)
  // 本 PR 自己的 diff 不得触碰任何记录的收口行 —— 这是 tasks 5.7 的自指验证。
  assert.deepEqual(d.rows, [], '本 PR 不得是"为改写收口行开的 PR"：' + JSON.stringify(d.rows))
})

// ── 续：F1–F5 五档加固的红测（跨家族对抗评审命中，逐条独立核实后落地）──────────

test('F1 前置事实：没有重复行锁时，"追加第二行 PASS、首行不动"这条绕道确实静默通过', () => {
  // 这条不是在测实现，是在**证明绕道是活的**：只测"加锁后红"而不测"没锁时能过"，
  // 得到的证据只覆盖夹具里那几格，真实绕行面在夹具之外（本仓所谓装饰性门禁）。
  const text = [
    'diff --git a/openspec/records/a.md b/openspec/records/a.md',
    '--- a/openspec/records/a.md',
    '+++ b/openspec/records/a.md',
    '@@ -21,0 +22,1 @@',
    '+| 远程同步 | PASS | merge SHA abc1234 |',
    '',
  ].join('\r\n')
  // 跃迁档看不见它：新增侧有闭合词，但删除侧没有任何 远程同步 行。
  assert.deepEqual(checker.parseClosureTransitions(text, new Set(['a.md'])), [],
    '前提：跃迁档对"只追加一行"应当无感（否则 F1 不是绕道）')
})

test('F1 重复行档：本 PR 给已有多行的记录再加一行收口 ⇒ 判红', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'dup-two', { row: 'PENDING' })
  // 让结果内容真的有两行（模拟 base 里就已重复的那 10 篇之一的形态）
  const p = path.join(dir, 'openspec', 'records', 'dup-two.md')
  fs.appendFileSync(p, '| 远程同步 | PENDING | 第二行 |\r\n', 'utf8')
  const text = [
    'diff --git a/openspec/records/dup-two.md b/openspec/records/dup-two.md',
    '--- a/openspec/records/dup-two.md',
    '+++ b/openspec/records/dup-two.md',
    '@@ -21,0 +22,1 @@',
    '+| 远程同步 | PASS | merge SHA abc1234 |',
    '',
  ].join('\r\n')
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({ merged: [6001], added: [['openspec/records/dup-two.md', 6001]] }),
    closureDiff: { ok: true, diff: text },
  })
  assert.equal(r.dupClosureRows.length, 1, JSON.stringify(r.dupClosureRows))
  assert.equal(r.dupClosureRows[0].file, 'dup-two.md')
  assert.equal(checker.hasBlocking(r), true, '重复行档必须进阻断出口')
})

test('F1 反向：存量本来就两行、本 PR 没加行 ⇒ 不红（不得把没人造成的重复钉给路人）', () => {
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'stock-two', { row: 'PENDING' })
  fs.appendFileSync(path.join(dir, 'openspec', 'records', 'stock-two.md'), '| 远程同步 | PENDING | 第二行 |\r\n', 'utf8')
  const text = [
    'diff --git a/openspec/records/stock-two.md b/openspec/records/stock-two.md',
    '--- a/openspec/records/stock-two.md',
    '+++ b/openspec/records/stock-two.md',
    '@@ -3 +3 @@',
    '-| QM-1 | PENDING | x',
    '+| QM-1 | PASS | x',
    '',
  ].join('\r\n')
  const r = checker.collect({
    root: dir, ledger: {},
    mergeLedger: mkML({ merged: [6002], added: [['openspec/records/stock-two.md', 6002]] }),
    closureDiff: { ok: true, diff: text },
  })
  assert.deepEqual(r.dupClosureRows, [], JSON.stringify(r.dupClosureRows))
  assert.deepEqual(r.handClosedRows.filter((x) => x.file === 'stock-two.md'), [])
})

test('F2 围栏隔离：正确迁移 + 文档里引用示例行 ⇒ 不得误红', () => {
  const fence = ['@@ -20 +20,4 @@',
    '-| 远程同步 | PENDING | 旧 |',
    '+| 远程同步 | 由门禁推导 | 无需回填 |',
    '+```',
    '+| 远程同步 | PASS | 这是文档里引用的示例行 |',
    '+```',
  ].join('\r\n')
  const text = ['diff --git a/openspec/records/a.md b/openspec/records/a.md',
    '--- a/openspec/records/a.md', '+++ b/openspec/records/a.md', fence, ''].join('\r\n')
  assert.deepEqual(checker.parseClosureTransitions(text, new Set(['a.md'])), [],
    '围栏内的 PASS 不得与真实的未闭合行配对')
})

test('F2 反向：真实行确实被改成闭合词时，围栏的存在不得成为免罪符', () => {
  const text = ['diff --git a/openspec/records/a.md b/openspec/records/a.md',
    '--- a/openspec/records/a.md', '+++ b/openspec/records/a.md',
    '@@ -20 +20,4 @@',
    '+```',
    '+| 远程同步 | PENDING | 围栏里的示例 |',
    '+```',
    '-| 远程同步 | PENDING | 真行 |',
    '+| 远程同步 | PASS | 真行被改写 |',
    ''].join('\r\n')
  const rows = checker.parseClosureTransitions(text, new Set(['a.md']))
  assert.equal(rows.length, 1, JSON.stringify(rows))
})

test('F3 词边界：「已由门禁推导」是自然中文措辞，MUST NOT 被当成人工闭合', () => {
  const text = ['diff --git a/openspec/records/a.md b/openspec/records/a.md',
    '--- a/openspec/records/a.md', '+++ b/openspec/records/a.md',
    '@@ -20 +20 @@',
    '-| 远程同步 | PENDING | 旧 |',
    '+| 远程同步 | 已由门禁推导 | 新 |', ''].join('\r\n')
  assert.deepEqual(checker.parseClosureTransitions(text, new Set(['a.md'])), [],
    'CLOSED_RE 的 `已` 前缀会吃掉这个措辞；放宽必须做在唯一那份实现里')
})

test('F3 放宽的负控：「已由人工回填完成」MUST NOT 被当成派生标记', () => {
  const text = ['diff --git a/openspec/records/a.md b/openspec/records/a.md',
    '--- a/openspec/records/a.md', '+++ b/openspec/records/a.md',
    '@@ -20 +20 @@',
    '-| 远程同步 | PENDING | 旧 |',
    '+| 远程同步 | 已由人工回填完成 | 新 |', ''].join('\r\n')
  const rows = checker.parseClosureTransitions(text, new Set(['a.md']))
  assert.equal(rows.length, 1, '放宽过头会把真手写放过去：' + JSON.stringify(rows))
})

test('F4 删除/改名档：非 _ 前缀记录被删 ⇒ 红；_exempt 与模板不受此条约束', () => {
  const mk = (name, side) => ['diff --git a/' + name + ' b/' + name,
    '--- a/' + name, side === 'del' ? '+++ /dev/null' : '+++ b/' + name,
    '@@ -1 +1 @@', '-| 远程同步 | PENDING | x |',
    ...(side === 'add' ? ['+| 远程同步 | PASS | y |'] : [])].join('\r\n')
  const text = mk('openspec/records/gone.md', 'del') + mk('openspec/records/_TEMPLATE.md', 'del')
  // 域归 collect（它传的是 listRecordFiles 的结果，本就排除了 `_` 前缀）；
  // classify 不自己再判一次下划线，否则"什么算一篇记录"这条规则会长在两个地方。
  const rows = checker.parseClosureTransitions(text, new Set(['gone.md']))
  const del = rows.filter((x) => x.kind === 'deleted')
  const cls = checker.classifyClosureDiff({ diffText: text, fileNames: ['gone.md'], rowCountByName: new Map() })
  assert.deepEqual(cls.deleted.map((d) => d.file), ['gone.md'], JSON.stringify(cls.deleted))
  assert.equal(del.length, 0, '删除不伪装成跃迁')
})

test('F5 bullet 侧同判：只改 bullet 不动表格行也是一次回填', () => {
  const text = ['diff --git a/openspec/records/a.md b/openspec/records/a.md',
    '--- a/openspec/records/a.md', '+++ b/openspec/records/a.md',
    '@@ -31 +31 @@',
    '- - 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 远程同步 PENDING',
    '+ - 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 远程同步 PASS', ''].join('\r\n')
  const rows = checker.parseClosureTransitions(text, new Set(['a.md']))
  assert.equal(rows.length, 1, JSON.stringify(rows))
  assert.equal(rows[0].kind, 'bullet')
})

test('F5 反向负控：两形态都未闭合的在飞记录不得红', () => {
  const text = ['diff --git a/openspec/records/a.md b/openspec/records/a.md',
    '--- a/openspec/records/a.md', '+++ b/openspec/records/a.md',
    '@@ -31 +31 @@',
    '- - 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 远程同步 PENDING',
    '+ - 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING', ''].join('\r\n')
  assert.deepEqual(checker.parseClosureTransitions(text, new Set(['a.md'])), [])
})

test('取源位置锁：git 取源只能在 pr-record-diff.js 里，判据文件不得出现第二处', () => {
  // 基线规格原文「MUST NOT 在判据内另写 git 解析」——本次改动若把 diff 写进判据，
  // 就是当着这条锁的面改代码；放宽锁则是拆门。这条锁的存在本身就是本次的取舍记录。
  // 判据源码里那行**注释**就写着 execFileSync('git' —— 结构锁必须剥掉整行注释后再测，
  // 否则命中的是注释而不是调用点（本仓踩过多次的同型：锚点落在注释上，锁恒红或恒绿都无意义）。
  const src = fs.readFileSync(path.join(__dirname, 'check-gate-record-debt.js'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.equal(/execFileSync\(\s*['"]git/.test(src), false, '判据内出现了 git 取源')
  assert.match(src, /require\(['"]\.\/lib\/pr-record-diff\.js['"]\)/, '判据必须从共享取源模块拿差量')
  // 口径：禁的是"词表判断长在模块里"，不是"模块不许提到那个词"。
  // 第一版写成 `assert.equal(/远程同步/.test(mod), false)`，结果命中了模块注释里那句
  // 中文文件名示例（`远程同步-锁定.md`）⇒ 断言裸子串 = 散文能撞、真违规也能藏，两头都不可信。
  // 改断言结构件：状态列解析（split('|')）与闭合词字面量都不得出现在取源模块里。
  const mod = fs.readFileSync(path.join(__dirname, 'lib', 'pr-record-diff.js'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.match(mod, /--no-renames/, '差量取源必须 --no-renames（否则改名绕开删除档）')
  assert.match(mod, /\.\.\./, '差量取源必须用 merge-base 三点式')
  assert.equal(/split\(['"]\|['"]\)/.test(mod), false, '状态列取法必须在判据侧，模块只给结构')
  assert.equal(/PASS|N\/A|由门禁推导/.test(mod), false, '闭合词/派生标记字面量不得长在取源模块里')
})


test('取源自身的三档不可用必须由 buildClosureDiff 自己产出（不是只能被注入）', () => {
  // collect 级用例测的是"拿到 reason 之后怎么处理"；这一条测的是"reason 从哪来"。
  // 少了它，三档里任何一档在生产路径永不产出也照样全绿 —— 与上一轮"函数有测试不等于被接上"同型。
  const bad = checker.buildClosureDiff({ baseRef: 'nope/nope', headRef: 'HEAD', cwd: process.cwd() })
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, 'ref-unresolvable', JSON.stringify(bad))

  const notRepo = checker.buildClosureDiff({
    baseRef: 'HEAD', headRef: 'HEAD', cwd: require('node:os').tmpdir(),
  })
  assert.equal(notRepo.ok, false, JSON.stringify(notRepo))
  assert.equal(typeof notRepo.reason, 'string')
  assert.notEqual(notRepo.reason, 'ref-unresolvable',
    '跑错目录与分支不存在必须可区分：混成一个码就把"判据装错地方"报成"分支还没建好"')
})

test('取源必须真的带 --no-renames 与三点式（跑一次真仓库看产物，不读源码字面量）', () => {
  // 源码里出现 `--no-renames` 只证明有人写过它；这里要看的是改名在真实 diff 里
  // 确实呈现为"删 + 增"，否则删除档是被注释守着的。
  const { execFileSync } = require('node:child_process')
  const fsx = require('node:fs'), os = require('node:os'), pathp = require('node:path')
  const root = fsx.mkdtempSync(pathp.join(os.tmpdir(), `mp-renx-${process.pid}-`))
  const git = (a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf8' })
  git(['init', '-q'])
  fsx.mkdirSync(pathp.join(root, 'openspec', 'records'), { recursive: true })
  const write = (n, s) => fsx.writeFileSync(pathp.join(root, 'openspec', 'records', n), '| 远程同步 | ' + s + ' | x |\r\n')
  write('old-name.md', 'PENDING')
  git(['add', '-A']); git(['commit', '-q', '-m', 'init'])
  const base = git(['rev-parse', 'HEAD']).trim()
  git(['mv', 'openspec/records/old-name.md', 'openspec/records/new-name.md'])
  write('new-name.md', 'PASS')
  git(['add', '-A']); git(['commit', '-q', '-m', 'rename + hand close (#7100)'])
  const head = git(['rev-parse', 'HEAD']).trim()

  const r = checker.buildClosureDiff({ baseRef: base, headRef: head, cwd: root, recordsRel: 'openspec/records' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.ok(r.files.includes('old-name.md'),
    '--no-renames 下旧路径必须以删除出现，否则改名就是活绕道：' + JSON.stringify(r.files))
  assert.ok(r.deleted.some((d) => d.file === 'old-name.md'), JSON.stringify(r.deleted))
  fsx.rmSync(root, { recursive: true, force: true })
})

// ── 触碰记录计数：把"没碰记录"与"碰了且零改写"在打印面上分开 ────────────────────

test('classify 的 touched 按「域 ∩ 差量」计，不按差量原始文件数计', () => {
  const mk = (name) => ['diff --git a/' + name + ' b/' + name,
    '--- a/' + name, '+++ b/' + name, '@@ -1 +1 @@', '-x', '+y'].join('\r\n')
  const text = mk('openspec/records/in-domain.md') + mk('openspec/records/_TEMPLATE.md')
  const cls = checker.classifyClosureDiff({ diffText: text, fileNames: ['in-domain.md'], rowCountByName: new Map() })
  assert.equal(cls.touched, 1, `只该数到落在记录清单里的那篇，实际 ${cls.touched}`)
  const nil = checker.classifyClosureDiff({ diffText: '', fileNames: ['in-domain.md'], rowCountByName: new Map() })
  assert.equal(nil.touched, 0, '空差量必须报 0 篇，而不是 null/undefined——那是"测了且没碰"')
})

test('打印面：空差量是常态而非门禁故障，但"取不到"与"取到且干净"必须不同形', () => {
  // 动因：本 change 的 spec 初稿写着"diff 为空 ⇒ 未证实、CI 档非零退出"。实测那是每个非记录
  // PR 与每次 main push 的常态（--base-ref=HEAD --head-ref=HEAD 当场 rc=0），照那句话实现
  // 等于让 CI 在每个代码 PR 上退 2。正解：空差量算"测到了"，但把**触碰篇数**打出来，
  // 于是 0 篇（没碰）、1 篇零改写（碰了不是那一行）、n/a（取不到）三档在读数上互不相同。
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'quiet', { row: '由门禁推导' })
  const base = { root: dir, ledger: {}, mergeLedger: mkML({ merged: [6101], added: [['openspec/records/quiet.md', 6101]] }) }
  const empty = checker.collect({ ...base, closureDiff: { ok: true, diff: '' } })
  assert.equal(empty.handClosureUnproven, null, '空差量不是门禁故障')
  assert.equal(empty.closureTouched, 0)
  assert.match(checker.format(empty), /HAND-CLOSURE [^\n]*触碰记录=0/)
  const touched = checker.collect({ ...base, closureDiff: { ok: true, diff: [
    'diff --git a/openspec/records/quiet.md b/openspec/records/quiet.md',
    '--- a/openspec/records/quiet.md', '+++ b/openspec/records/quiet.md',
    '@@ -3 +3 @@', '-| QM-1 | PENDING | x', '+| QM-1 | PASS | x', ''].join('\r\n') } })
  assert.equal(touched.closureTouched, 1)
  assert.equal(touched.handClosedRows.length, 0, '碰了但不是收口行 ⇒ 零改写；与上面"没碰"同判定、不同读数')
  assert.match(checker.format(touched), /HAND-CLOSURE [^\n]*触碰记录=1/)
  const blind = checker.collect({ ...base, closureDiff: { ok: false, reason: 'git-failed' } })
  assert.match(checker.format(blind), /触碰记录=n\/a/, '取不到时不得打数字，否则"失明"读起来像"干净"')
})

// ── F8（跨家族评审）：差量行解析口径 ────────────────────────────────────

test('F8 差量行解析：git 元数据行不得伪装成跃迁，且 LF/CRLF 两档差量同判', () => {
  // 对应 spec 明写的三条口径。① `\` 开头的 git 元数据行（`String.fromCharCode(92) No newline at end of file`）
  // MUST 不参与配对；② "剥掉 -/+ 前缀再过词表"——原始行 `-| 远程同步 | …` 不匹配 ROW_RE
  // （该正则锚在 ^\|），漏剥前缀是**整档全量漏判且不报错**的形态，只能由行为用例钉住。
  const dir = fixture([{ head: '老记录（legacy，2026-09-28）', status: 'PASS' }])
  recFile(dir, 'no-newline', { row: 'PENDING' })
  const NO_NL = String.fromCharCode(92) + ' No newline at end of file'
  const seg = (a, b) => [
    'diff --git a/openspec/records/no-newline.md b/openspec/records/no-newline.md',
    '--- a/openspec/records/no-newline.md', '+++ b/openspec/records/no-newline.md',
    '@@ -21 +21 @@', '-' + a, NO_NL, '+' + b, NO_NL, '',
  ]
  const real = seg('| 远程同步 | PENDING | x', '| 远程同步 | PASS | y')
  const a = checker.parseClosureTransitions(real.join('\r\n'), new Set(['no-newline.md']))
  assert.equal(a.length, 1, JSON.stringify(a))
  assert.equal(a[0].to, 'PASS', '带元数据行也必须抓到那一次跃迁（漏剥前缀=整档失明）')
  // 元数据行自身不得被读成"删除侧有一行未收口"：这里只动 QM-1 行，必须零命中。
  const none = seg('| QM-1 | PENDING | x', '| QM-1 | PASS | x')
  assert.deepEqual(checker.parseClosureTransitions(none.join('\r\n'), new Set(['no-newline.md'])), [],
    '元数据行 / 非收口行不得伪装成跃迁')
  // 同一份差量按 LF 连接与按 CRLF 连接必须同判：判据里逐行剥尾部 \r 是唯一入口。
  assert.deepEqual(checker.parseClosureTransitions(real.join('\n'), new Set(['no-newline.md'])), a,
    '差量侧的行尾档不得改变判定')
})

// ── change: normalize-debt-ledger-entry-shape ──────────────────────────────

test('loadLedger 拒收非字符串登记项，并点名是哪个键', () => {
  // 旧实现"是对象就取 reason"是宽容读：那等于允许 {reason,status,line} 这个形状再生，
  // 而 status/line 实测已在静默腐化（line 9/9 指不到自己的行，status 1 条已和载体现状不符）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-ledger-shape-'))
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  const write = (obj) => fs.writeFileSync(
    path.join(dir, 'scripts', 'gate-record-debt-ledger.json'), JSON.stringify(obj, null, 2), 'utf8')
  write({ '记录甲': '纯字符串原因', '记录乙': { reason: '有原因', status: 'PENDING', line: 4479 } })
  let msg = ''
  try { checker.loadLedger(dir); assert.fail('对象形态必须被拒收，实际静默通过了') } catch (e) { msg = String(e.message || e) }
  assert.match(msg, /记录乙/, `错误文本必须点名是哪个键，实际：${msg.slice(0, 120)}`)
  assert.doesNotMatch(msg, /\bundefined\b/, `不得把键名打成 undefined：${msg.slice(0, 120)}`)
  // 纯字符串形态必须照旧通过（拒绝不能顺手把合法形态也拦掉）
  write({ '记录甲': '纯字符串原因' })
  assert.deepStrictEqual(checker.loadLedger(dir), { 记录甲: '纯字符串原因' })
})

test('空原因的旧判据不得被形状校验挤掉', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-ledger-blank-'))
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  const p = path.join(dir, 'scripts', 'gate-record-debt-ledger.json')
  fs.writeFileSync(p, JSON.stringify({ '记录甲': '   ' }), 'utf8')
  assert.throws(() => checker.loadLedger(dir), /缺少原因/, '字符串空白仍须按"缺原因"拒')
  fs.writeFileSync(p, JSON.stringify({ '记录甲': { reason: ' ', status: 'PENDING' } }), 'utf8')
  // 顺序是确定的：非字符串先被形状判据拒，所以这里必须点名形状错——
  // 写成「或缺少原因」就等于两条判据互相掩盖时也能绿（评审 I4）
  assert.throws(() => checker.loadLedger(dir), /必须是原因字符串/, '对象值必须先被形状判据拒，不得落到空白分支')
})

test('真仓形状锁：真实账本可 parse 且值全为非空字符串（防清空不在这条里）', () => {
  const file = path.join(__dirname, 'gate-record-debt-ledger.json')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const keys = Object.keys(raw)
  // 这里**不写 keys.length > 0**。账本被逐条销账到空是这条机制的**可达终态**（每条登记项的原因里
  // 都写着"回填后删除本条"），把非空钉成禁态就是本仓记案的"常量红"：合法工作做完之后，
  // 每个 PR 都被一条与它无关的锁拦死。防"靠清空账本变绿"的活由 `清空账本不得变绿` 那条
  // 机制锁承担，它用夹具（载体有未收口行 + ledger:{} ⇒ r.open 非空且进阻断出口），
  // 与真实账本此刻有几条无关；M7/M8 各让它指名变红。
  assert.ok(Array.isArray(keys), 'keys 必须是数组（Object.keys 退化 = 读的东西不对）')
  const bad = keys.filter((k) => typeof raw[k] !== 'string')
  assert.deepEqual(bad, [], `仍有非字符串登记项 ${bad.length} 条：${bad.slice(0, 3).join(" | ")}`)
  const blank = keys.filter((k) => !String(raw[k]).trim())
  assert.deepEqual(blank, [], '值不得为空白')
})

test('账本文件名在判据里只允许出现一处（LEDGER_FILE 是唯一口径）', () => {
  // 判据：账本文件名在「代码位置」只能出现一次，且那一次必须是 LEDGER_FILE 的定义行。
  // 为什么不写「剥掉注释再数出现次数」：本仓判据里有一条引导语在注释里点名这个文件名，而
  // /^\s*\/\// 只能剥整行注释、剥不掉行尾注释 —— 那种写法会把文档判成第二份硬编码（假红），
  // 而消除假红的唯一出路是把注释删掉，即为了让锁好过而销毁证据。逐处定位才对应「谁在写这个路径」。
  const src = fs.readFileSync(path.join(__dirname, 'check-gate-record-debt.js'), 'utf8')
  const TOKEN = 'gate-record-debt-ledger.json'
  const code = []
  const commented = []
  src.split(/\r?\n/).forEach((line, idx) => {
    let at = line.indexOf(TOKEN)
    while (at >= 0) {
      const head = line.slice(0, at)
      // 注释位 = 整行注释，或本行在先出现的 // 之后（排除 :// ——协议串里的 // 不是注释起点）
      let cue = -1
      for (let k = 0; k + 1 < head.length; k++) {
        if (head[k] === '/' && head[k + 1] === '/' && head[k - 1] !== ':') { cue = k; break }
      }
      const isComment = /^\s*\/\//.test(line) || cue >= 0
      ;(isComment ? commented : code).push({ line: idx + 1, text: line.trim().slice(0, 120) })
      at = line.indexOf(TOKEN, at + TOKEN.length)
    }
  })
  // 反失明：一处都没命中 = 读错了文件或文件名被改名，不得把空集读成「唯一」
  assert.ok(code.length + commented.length >= 1, '判据里读不到账本文件名 = 探针失明，不是合规')
  assert.strictEqual(code.length, 1, '代码位置命中 ' + code.length + ' 处：' + JSON.stringify(code) + ' 注释位置命中：' + JSON.stringify(commented))
  assert.match(code[0].text, /^const LEDGER_FILE = path\.join\(__dirname, 'gate-record-debt-ledger\.json'\)$/,
    '唯一口径必须是 LEDGER_FILE 定义行；第二处硬编码路径就是不认账的口径分裂')
  // 正控（防「把注释也当口径」的假红变成恒红）：真实现里确有注释提及，为 0 说明定位逻辑整体失灵
  assert.ok(commented.length >= 1, '注释位置的命中数为 0 = 定位逻辑失灵（本仓判据里就有注释提及的先例）')
})

test('真账本必须能被真 loadLedger 读通（形状锁不得只读文件绕过判据函数）', () => {
  // 评审 W3：形状锁自己 JSON.parse 文件，等于"文件形状对但判据读不通"这一格没人测。
  // 评审 W3：形状锁自己 JSON.parse 文件，等于"文件形状对但判据读不通"这一格没人测。
  // 这条把真实账本喂给真实函数：不抛错、值全为非空字符串、**键数与文件条数相等**。
  // 牙在"相等"上（函数静默丢条目即红），不在"条数>0"上——后者会把合法清空终态钉成禁态。
  const root = path.resolve(__dirname, '..')
  const got = checker.loadLedger(root)
  const keys = Object.keys(got)
  assert.ok(Array.isArray(keys), 'loadLedger 的返回面必须是普通对象')
  for (const k of keys) assert.ok(typeof got[k] === 'string' && got[k].trim(), `真账本里有非字符串/空原因：${k.slice(0, 40)}`)
  // 键数必须等于文件里的条数：读通不等于读全
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'gate-record-debt-ledger.json'), 'utf8'))
  assert.strictEqual(keys.length, Object.keys(raw).length, 'loadLedger 静默丢条目', keys.length)
})

test('清空账本不得变绿：未登记欠账判据必须真会红（反"为通过而清清单"）', () => {
  // 评审 W2：规格要"防清空"。数量下限会腐烂（合法销账后条数必然减少），所以这里证的是
  // **机制本身**：账本空了而载体仍有未收口行 ⇒ r.open（未登记欠账）非空且进阻断出口。
  const dir = fixture([{ head: '未收口的老记录（legacy，2026-09-28）', status: 'PENDING' }])
  const r = checker.collect({ root: dir, ledger: {}, mergeLedger: mkML({ ok: true, merged: [], added: [] }) })
  assert.ok((r.open || []).length >= 1, `账本清空后必须报未登记欠账，实际：${JSON.stringify(r.open)}`)
  assert.equal(checker.hasBlocking(r), true, '未登记欠账必须进阻断出口，否则这条判据只是打印')
  // 反向：同一篇登记上之后必须不红（防"恒红"的假严格）
  const okLedger = { '未收口的老记录（legacy，2026-09-28）': '历史记录的收口证据未由本会话取证' }
  const r2 = checker.collect({ root: dir, ledger: okLedger, mergeLedger: mkML({ ok: true, merged: [], added: [] }) })
  assert.deepEqual((r2.open || []).filter((x) => /未收口的老记录/.test(JSON.stringify(x))), [],
    `登记后仍报未登记 = 键匹配写错：${JSON.stringify(r2.open)}`)
  assert.equal(checker.hasBlocking(r2), false, '登记齐了就该不红')
})

test('W1：collect 缺 ledger 注入必须抛错——默认值等于静默读生产账本', () => {
  const dir = fixture([{ head: '未收口的老记录（legacy，2026-09-28）', status: 'PENDING' }])
  // 没注入：出声，且不得因为"读到了真仓那份清单里已有的键"而静默变绿
  assert.throws(() => checker.collect({ root: dir }), /缺 ledger 注入/, '缺注入必须按判据自身故障处理')
  // 注入了空账本：合法值，必须照常报未登记欠账（与"没注入"可区分是这条锁的本体）
  const r = checker.collect({ root: dir, ledger: {}, mergeLedger: mkML({ ok: true, merged: [], added: [] }) })
  assert.ok(r.open.length >= 1, '空账本不等于零欠账：' + JSON.stringify(r.open))
  assert.equal(checker.hasBlocking(r), true, '未登记欠账必须进阻断出口')
})

test('接线锁：main() 必须把 hasBlocking 映射成非零退出（返回值为真不等于 CLI 会拦）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-gate-record-debt.js'), 'utf8')
  const body = src.replace(/^\s*\/\/.*$/gm, '')
  assert.match(body, /if\s*\(\s*hasBlocking\(\s*r[^)]*\)\s*\)\s*process\.exit\(1\)/,
    '未收口/未登记的欠账必须落到 CLI 退出码；否则「拦住不让合」只活在 collect 的返回值里',
  )
  // 为什么是结构锁而不是行为锁：main() 的 root 取 path.resolve(__dirname, '..')，没有 --root 注入点，
  // 因此无法在夹具仓库里造出「确有阻断」的状态去断言 rc=1。把 root 做成可注入属改判据形态（改谁来守门），
  // 须人工过目；在那之前，这条映射至少被一道「摘掉即红」的锁看着（反证见本 PR 记录）。
})
