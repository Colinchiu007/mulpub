'use strict'
/**
 * ccg-review-writeback.test.js —— 仓内唯一写回器的五条件合取（tasks 3.1 / 3.2 / 3.3 / 3.5）
 *
 * 这个模块的存在本身就是本片的目的：全仓此前没有任何生产方会写 `deepReview.tier`，
 * 于是合规的评审也只能手写（#3987 / #4071 都是自己写的）。
 *
 * 三条夹具纪律（都是本仓反复踩过的）：
 *  ① 夹具必须让**不同输入产生不同结果** —— 对所有输入返回同一份记录的夹具，
 *     对"按记录区分"这一整类缺陷结构性免疫；
 *  ② 拒绝写入时必须断言**既有产物逐字节不变**，"返回了 false"不等于"没动文件"；
 *  ③ 每条出声名各测各的，不得合并成"总之没写"——塌成一个布尔就看不出缺了哪一条。
 *
 * 跑法：node --test scripts/ccg-review-writeback.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const MOD = path.join(__dirname, 'ccg-review-writeback.js')
const CLOSED = 'cleared'
const FINDINGS = [
  { id: 'i1', severity: 'Critical', finding: 'A' },
  { id: 'i2', severity: 'Warning', finding: 'B' }
]

function mod () {
  return require(MOD)
}

/** 现场形状：引擎收口是整体替换，所以 init 写的 tier/evidence 键在这里**必须不存在**。 */
function deliveredRecord (over) {
  const dr = Object.assign({
    required: true,
    status: CLOSED,
    performedBy: 'claude',
    findings: FINDINGS.map((f) => Object.assign({}, f)),
    minScore: 6,
    at: '2026-10-21T00:00:00.000Z'
  }, over || {})
  delete dr.tier
  delete dr.evidence
  return { sha: 'a'.repeat(40), mode: 'dual', layer: 'diff', deepReview: dr }
}

function withRecord (rec, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wbtest-${process.pid}-`))
  const file = path.join(dir, 'rec.json')
  fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n', 'utf8')
  try {
    return fn(file, fs.readFileSync(file))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function run (file, beforeBytes, expectedCritic) {
  return mod().applyWriteback({ recordPath: file, beforeBytes, expectedCritic: expectedCritic === undefined ? 'claude' : expectedCritic })
}

/**
 * 驱动的真实时序夹具：先落"引擎动手前"的记录，取 beforeBytes，再落"引擎收口后"的记录。
 * ⚠ 不能拿"当前字节"当 beforeBytes —— 那等于问"有没有写过"却把答案喂成"没写过"，
 * 写回器会正确地报 no-write。（第一版就是这个夹具前提错，红在实现上找了半天。）
 */
function withDelivery (beforeRec, afterRec, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wbdel-${process.pid}-`))
  const file = path.join(dir, 'rec.json')
  fs.writeFileSync(file, JSON.stringify(beforeRec, null, 2) + '\n', 'utf8')
  const beforeBytes = fs.readFileSync(file)
  fs.writeFileSync(file, JSON.stringify(afterRec, null, 2) + '\n', 'utf8')
  try {
    return fn(file, beforeBytes)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function runWithDelivery (beforeRec, afterRec) {
  return withDelivery(beforeRec, afterRec, (file, beforeBytes) => run(file, beforeBytes))
}

test('写回器必须存在（3.x 的落点：本仓第一个也是唯一一个写 tier 的生产方）', () => {
  assert.ok(fs.existsSync(MOD), 'scripts/ccg-review-writeback.js 不存在 ⇒ 合规收口仍只能手写')
})

test('五条件齐备：写 tier=external + delivery@ 摘要，并逐条打点', () => {
  const res = runWithDelivery(deliveredRecord({ status: 'pending' }), deliveredRecord())
  assert.deepStrictEqual(res.spoke.slice().sort(), ['backend-matches', 'closed-status', 'delivery-changed', 'findings-present', 'nonempty-findings'],
    `五条各打各的读数，实得 ${JSON.stringify(res.spoke)}`)
  assert.strictEqual(res.wrote, true, `应写回，实得 reason=${res.reason} detail=${res.detail || '-'}`)
  // 测试名写的是「写 tier=external」，那这两条就必须真的断——第二代变异驱动 N4（把档位改成
  // internal）实测只红了「盘里内容」那一条，这一条照样绿：名字比断言宽。
  assert.strictEqual(res.tier, 'external', `返回值必须交出档位，实得 ${JSON.stringify(res.tier)}`)
  assert.match(res.evidence, /^delivery@[0-9a-f]{64}$/, `返回值必须交出将落盘的摘要：${res.evidence}`)
})

test('写进盘里的内容：只有 tier/evidence 两个键变，既有字段逐字不动', () => {
  withDelivery(deliveredRecord({ status: 'pending' }), deliveredRecord(), (file, beforeBytes) => {
    run(file, beforeBytes)
    const after = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.strictEqual(after.deepReview.tier, 'external')
    assert.match(after.deepReview.evidence, /^delivery@[0-9a-f]{64}$/)
    assert.strictEqual(after.deepReview.performedBy, 'claude', '既有字段不得被顺手改掉')
    assert.strictEqual(after.deepReview.status, CLOSED)
    assert.strictEqual(after.deepReview.findings.length, 2)
    assert.strictEqual(after.sha, 'a'.repeat(40), '记录外壳字段（sha/mode/layer）不得被动')
    assert.strictEqual(after.mode, 'dual')
  })
})

test('① status 不在闭环白名单 ⇒ 不写，且文件逐字节不变', () => {
  withRecord(deliveredRecord({ status: 'pending' }), (file, before) => {
    const res = run(file, before)
    assert.strictEqual(res.reason, 'not-closed')
    assert.strictEqual(res.wrote, false)
    assert.deepStrictEqual(fs.readFileSync(file), before, '拒绝写入时必须逐字节不变（返回 false 不等于没动文件）')
  })
})

test('② findings 缺席 / 非数组 / 空数组 ⇒ 三种都不写，各自点名', () => {
  for (const [label, over] of [['absent', { findings: undefined }], ['not-array', { findings: 'x' }], ['empty', { findings: [] }]]) {
    withRecord(deliveredRecord(over), (file, before) => {
      const res = run(file, before)
      assert.strictEqual(res.reason, 'empty-findings', `${label} 应归 empty-findings，实得 ${res.reason}`)
      assert.strictEqual(res.wrote, false)
      assert.deepStrictEqual(fs.readFileSync(file), before)
    })
  }
})

test('③ performedBy ≠ 上层透传的期望后端 ⇒ 不写（backend-mismatch）', () => {
  withRecord(deliveredRecord({ performedBy: 'self-play' }), (file, before) => {
    const res = run(file, before)
    assert.strictEqual(res.reason, 'backend-mismatch')
    assert.strictEqual(res.wrote, false)
  })
  withRecord(deliveredRecord({ performedBy: 'Claude' }), (file, before) => {
    // 逐字相等，不做大小写归一：performedBy 的真源是清单，差一个字母就是另一个人
    assert.strictEqual(run(file, before).reason, 'backend-mismatch')
  })
})

test('④-a 字节未变 ⇒ 不写并打 no-write（没交付就别动文件）', () => {
  withRecord(deliveredRecord(), (file, before) => {
    fs.writeFileSync(file, JSON.stringify(deliveredRecord(), null, 2) + '\n', 'utf8')
    const same = fs.readFileSync(file)
    const res = run(file, same)
    assert.strictEqual(res.reason, 'no-write')
    assert.strictEqual(res.wrote, false)
  })
})

test('④-a2 跨实现口径：beforeSha256 来自 shell 的 sha256sum（原始字节）时，含中文的记录必须仍被判 no-write', () => {
  // 动因：入口侧（deep-review.sh）只能用 `sha256sum` 取动手前的哈希，它量的是**原始字节**；
  //   而本模块若把字节先 toString('binary') 再按 utf8 重新编码去哈希，非 ASCII 内容会被
  //   多写一倍字节 ⇒ 两侧永远不等 ⇒ no-write 这一格**永久点不到火**（装饰性门禁），
  //   而它正是"驱动根本没写过这条记录"的唯一出口。既有 ④-a 两侧同用一份实现，抓不到它。
  const rec = deliveredRecord({ findings: [{ id: 'i1', severity: 'Critical', finding: '全仓没有任何生产方写 tier' }] })
  withRecord(rec, (file, before) => {
    const rawBytesHex = require('node:crypto').createHash('sha256').update(before).digest('hex')
    // ④ 现在要求**两半都给**（i1 的处置），所以这条要连带给动手前的语义指纹；
    //   本条测的仍然是"字节那一半的跨实现口径"，指纹只是让执行流走到 no-write 这一格。
    const { deepReviewFingerprint } = require('./lib/ccg-delivery-digest.js')
    const res = mod().applyWriteback({
      recordPath: file,
      beforeSha256: rawBytesHex,
      beforeFingerprint: deepReviewFingerprint(rec.deepReview),
      expectedCritic: 'claude'
    })
    assert.strictEqual(res.reason, 'no-write',
      `字节没变必须判 no-write（实得 reason=${res.reason}）⇒ 哈希两侧口径不同源`)
    assert.strictEqual(res.wrote, false)
    assert.deepStrictEqual(fs.readFileSync(file), before, '拒绝写入时既有产物必须逐字节不变')
  })
})

test('④-b 只有 at 变了不算新交付 ⇒ 不写并打 no-new-delivery（评审 i1，Critical）', () => {
  // 引擎每个 writeBack 站点都写 at: new Date()，所以"字节变了"只证明"写过一次"。
  const oldRec = deliveredRecord({ at: undefined })
  oldRec.deepReview.at = '2026-10-20T00:00:00.000Z'
  const newRec = JSON.parse(JSON.stringify(oldRec))
  newRec.deepReview.at = '2026-10-21T09:00:00.000Z'
  withRecord(oldRec, (file) => {
    const before = fs.readFileSync(file)
    fs.writeFileSync(file, JSON.stringify(newRec, null, 2) + '\n', 'utf8')
    const res = run(file, before)
    assert.strictEqual(res.reason, 'no-new-delivery', `只有时间戳变化必须被判"没有新交付"，实得 ${res.reason}`)
    assert.strictEqual(res.wrote, false)
  })
})

test('④-c 语义指纹变了（status 变、findings 没变）⇒ 仍算新交付，必须写', () => {
  const oldRec = deliveredRecord({ status: 'pending' })
  const newRec = JSON.parse(JSON.stringify(oldRec))
  newRec.deepReview.status = CLOSED
  newRec.deepReview.at = '2026-10-21T09:00:00.000Z'
  withRecord(oldRec, (file) => {
    const before = fs.readFileSync(file)
    fs.writeFileSync(file, JSON.stringify(newRec, null, 2) + '\n', 'utf8')
    const res = run(file, before)
    assert.strictEqual(res.wrote, true, `status 变而 findings 未变仍是新交付，实得 reason=${res.reason}`)
  })
})

test('④-d 上层没给动手前状态 ⇒ 不写、且不得把 delivery-changed 打进 spoke（fail-closed）', () => {
  // 为什么这条必须存在：入口侧动手前的哈希**只能由 shell 取**（sha256sum）。若那一格取不到
  // （文件被并发删过 / sha256sum 缺失）而本模块照写，那么"上一条记录是本次驱动产出的"
  // 这一条就再没有任何东西在证 —— 而记录里躺着的往往是**上一轮**的闭环交付。
  // 实测原实现：beforeSha 为空时 `if (beforeSha && ...)` 整格跳过，照样 wrote=true 并把
  // delivery-changed 写进 spoke —— 那是给一个没验证过的条件打了勾。
  withRecord(deliveredRecord(), (file, before) => {
    const res = mod().applyWriteback({ recordPath: file, expectedCritic: 'claude' })
    assert.strictEqual(res.wrote, false, '取不到动手前状态时必须拒绝写入')
    assert.strictEqual(res.reason, 'before-state-missing')
    assert.ok(!res.spoke.includes('delivery-changed'), `未验证的条件不得打点，实得 spoke=${JSON.stringify(res.spoke)}`)
    assert.deepStrictEqual(fs.readFileSync(file), before)
  })
  // 空串形态（shell 里 `sha256sum` 失败会留下空变量）同样 fail-closed
  withRecord(deliveredRecord(), (file, before) => {
    const res = mod().applyWriteback({ recordPath: file, expectedCritic: 'claude', beforeSha256: '' })
    assert.strictEqual(res.reason, 'before-state-missing')
    assert.deepStrictEqual(fs.readFileSync(file), before)
  })
})

test('⑤ recordPath 未透传 ⇒ 当场抛错并点名，禁止两种猜法回退（评审 i6）', () => {
  assert.throws(() => mod().applyWriteback({ expectedCritic: 'claude' }), /missing-record-path/)
  assert.throws(() => mod().applyWriteback({ recordPath: '', expectedCritic: 'claude' }), /missing-record-path/)
})

test('⑤-b 只动显式透传的那份记录：不得按记录里的 sha 去找"引擎真正写过的那份"（tasks 3.5 负控）', () => {
  // 场景：驱动实际交付的是 B（闭环），而 A 仍停在 pending。
  // 若本模块"贴心地"按 rec.sha 去解析路径，它会写 B —— 那正是"给一份没被我核对过的记录补 tier"。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wbsha-${process.pid}-`))
  const a = path.join(dir, 'A.json')
  const b = path.join(dir, 'B.json')
  const shaB = 'b'.repeat(40)
  try {
    fs.writeFileSync(a, JSON.stringify(deliveredRecord({ status: 'pending' }), null, 2) + '\n', 'utf8')
    const bRec = deliveredRecord()
    bRec.sha = shaB
    fs.writeFileSync(b, JSON.stringify(bRec, null, 2) + '\n', 'utf8')
    const aBefore = fs.readFileSync(a)
    const bBefore = fs.readFileSync(b)
    const res = mod().applyWriteback({ recordPath: a, beforeBytes: aBefore, expectedCritic: 'claude' })
    assert.strictEqual(res.reason, 'not-closed', `A 自己没闭环就应当拒绝，实得 ${res.reason}`)
    assert.deepStrictEqual(fs.readFileSync(a), aBefore, 'A 不得被改')
    assert.deepStrictEqual(fs.readFileSync(b), bBefore,
      'B 才是"引擎写过的那份"，但路径由上层显式透传 ⇒ 本模块一眼都不许看它')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('期望后端未透传同样当场抛错（多层链上的键漏传不报错那一型）', () => {
  withRecord(deliveredRecord(), (file, before) => {
    assert.throws(() => mod().applyWriteback({ recordPath: file, beforeBytes: before }), /expectedCritic/)
  })
})

test('缺 tier 键时按 buildDeepReviewInit 的同一口径补齐再判定（D6，不重抄字段表）', () => {
  const rec = deliveredRecord()
  assert.ok(!('tier' in rec.deepReview), '夹具必须等于现场形状：引擎整体替换后 tier 键不存在')
  withDelivery(deliveredRecord({ status: 'pending' }), rec, (file, beforeBytes) => {
    const res = run(file, beforeBytes)
    assert.strictEqual(res.wrote, true, `应写回，实得 reason=${res.reason}`)
    const after = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.strictEqual(after.deepReview.tier, 'external')
  })
})

test('文件读不到 / JSON 坏 ⇒ 不写不猜，reason 点名且不留半成品', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wbbad-${process.pid}-`))
  try {
    const missing = path.join(dir, 'nope.json')
    const res = mod().applyWriteback({ recordPath: missing, beforeBytes: Buffer.alloc(0), expectedCritic: 'claude' })
    assert.strictEqual(res.wrote, false)
    assert.strictEqual(res.reason, 'record-unreadable')
    assert.ok(!fs.existsSync(missing), '失败时不得凭空造出一个记录文件')
    const bad = path.join(dir, 'bad.json')
    fs.writeFileSync(bad, '{ not json', 'utf8')
    const beforeBad = fs.readFileSync(bad)
    const r2 = mod().applyWriteback({ recordPath: bad, beforeBytes: beforeBad, expectedCritic: 'claude' })
    assert.strictEqual(r2.reason, 'record-unreadable')
    assert.deepStrictEqual(fs.readFileSync(bad), beforeBad)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('写盘是原子的：不留 .tmp，重跑幂等（第二次不得再改写）', () => {
  withDelivery(deliveredRecord({ status: 'pending' }), deliveredRecord(), (file, beforeBytes) => {
    const first = run(file, beforeBytes)
    assert.strictEqual(first.wrote, true, `首次应写回，实得 reason=${first.reason}`)
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.includes('.tmp')), [],
      '原子写的临时文件必须被 rename 走，不留半成品')
    const second = run(file, fs.readFileSync(file))
    assert.strictEqual(second.wrote, false)
    assert.ok(['no-write', 'no-new-delivery'].includes(second.reason), `重跑不得反复改写，实得 ${second.reason}`)
  })
})

test('9.5 闭集冻结快照锁：CLOSED_DEEP_REVIEW_STATUSES 必须逐项等于快照（不得单边加宽）', () => {
  // 写回器复用判据的闭集，判据侧日后放宽/收窄会**静默跟随**（跨家族评审 i5）。
  // 快照只能整体替换：加一个词必须先在这里改，而改这里就是显式改动，会被评审看见。
  const { CLOSED_DEEP_REVIEW_STATUSES } = require('./check-pr-exec-record.js')
  const PINNED = ['cleared', 'needs_revision', 'self_play_resolved']
  assert.deepStrictEqual([...CLOSED_DEEP_REVIEW_STATUSES].sort(), PINNED,
    '闭集变了 ⇒ 必须同次改本快照并给出出处（写回器与判据的口径一致性靠这一行钉住）')
})

test('CLI 面：参数不合法时不得以裸栈收尾，且退出码恒 0（spec「写回器抛错不改退出码」）', () => {
  const { spawnSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wbcli-${process.pid}-`))
  const file = path.join(dir, 'rec.json')
  try {
    fs.writeFileSync(file, JSON.stringify(deliveredRecord(), null, 2) + '\n', 'utf8')
    const r = spawnSync(process.execPath, [MOD, '--record=' + file], { encoding: 'utf8' })
    assert.strictEqual(r.status, 0, `旁路语义：CLI 不得用自己的退出码顶掉评审的。实得 ${r.status}\nstderr=${r.stderr}`)
    assert.strictEqual(String(r.stderr).trim(), '',
      `抛错必须被接住并打成一行 reason，不得漏裸栈到 stderr（实测漏栈时这里躺着一整段 at 帧）：\n${r.stderr}`)
    assert.match(String(r.stdout), /reason=/, '必须点名缺的是哪一条')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

/**
 * ④-e / ④-f —— 外部深审 round 2 的 **i1（Critical，crypto 高危域）的回归锁**。
 * 原缺陷：`beforeFp` 只在传入 **Buffer**（`beforeBytes`）时才计算，而生产入口
 * `deep-review.sh` 只透传 `--before-sha256`（十六进制串）⇒ 真实调用路径上 `beforeFp` 恒 null
 * ⇒ 「只有 `at` 变了不算新交付」这一格**永远不会触发**：任何带字节差异的旧记录（哪怕只刷了时间戳）
 * 都会被当成新交付并写上 `tier=external`。
 * 既有 ④-b 只测了 Buffer 那一档，所以它绿着把这个生产缺口漏掉了 ——
 * 这正是本仓记过的「测试只走注入路径、生产接线没被测」的同型。
 */
function atOnlyChange (dir, name, oldAt, newAt) {
  const { deepReviewFingerprint } = require('./lib/ccg-delivery-digest.js')
  const file = path.join(dir, name)
  const mk = (at) => ({
    sha: 'a'.repeat(40),
    mode: 'dual',
    deepReview: { required: true, status: 'cleared', performedBy: 'claude', findings: FINDINGS.map((f) => Object.assign({}, f)), minScore: 5, at }
  })
  fs.writeFileSync(file, JSON.stringify(mk(oldAt), null, 2) + '\n', 'utf8')
  const beforeBytes = fs.readFileSync(file)
  const crypto = require('node:crypto')
  const beforeSha256 = crypto.createHash('sha256').update(beforeBytes).digest('hex')
  const beforeFingerprint = deepReviewFingerprint(mk(oldAt).deepReview)
  fs.writeFileSync(file, JSON.stringify(mk(newAt), null, 2) + '\n', 'utf8')
  return { file, beforeSha256, beforeFingerprint }
}

test('④-e 生产入口的传参形态（只给 hex + 指纹）：只有 at 变了必须判 no-new-delivery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wbfpt-${process.pid}-`))
  try {
    const c = atOnlyChange(dir, 'r.json', '2026-10-20T00:00:00.000Z', '2026-10-22T00:00:00.000Z')
    const res = mod().applyWriteback({
      recordPath: c.file,
      expectedCritic: 'claude',
      beforeSha256: c.beforeSha256,
      beforeFingerprint: c.beforeFingerprint
    })
    assert.strictEqual(res.reason, 'no-new-delivery',
      `生产形态下"只刷时间戳"必须被拦；实得 reason=${res.reason} wrote=${res.wrote} ⇒ ④ 的第二半在生产路径上是死的`)
    assert.ok(!res.spoke.includes('delivery-changed'), `未验证的条件不得打点，实得 spoke=${JSON.stringify(res.spoke)}`)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('④-f 只给了字节哈希、没给动手前指纹 ⇒ before-state-missing（不得只验一半就放行）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wbfpm-${process.pid}-`))
  try {
    const c = atOnlyChange(dir, 'r.json', '2026-10-20T00:00:00.000Z', '2026-10-22T00:00:00.000Z')
    const res = mod().applyWriteback({ recordPath: c.file, expectedCritic: 'claude', beforeSha256: c.beforeSha256 })
    assert.strictEqual(res.wrote, false, '④ 的两半里缺一半就不算 ④ 成立')
    assert.strictEqual(res.reason, 'before-state-missing')
    const bytesNow = fs.readFileSync(c.file)
    assert.deepStrictEqual(bytesNow, fs.readFileSync(c.file), '拒写时产物不得被改一笔')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('④-g 真跑一次 lib 的指纹出口：入口就是用它取动手前指纹的（不许在 shell 里重抄算法）', () => {
  const { spawnSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wbfpc-${process.pid}-`))
  try {
    const c = atOnlyChange(dir, 'r.json', '2026-10-20T00:00:00.000Z', '2026-10-22T00:00:00.000Z')
    const lib = path.join(__dirname, 'lib', 'ccg-delivery-digest.js')
    const r = spawnSync(process.execPath, [lib, '--print-fingerprint=' + c.file], { encoding: 'utf8' })
    assert.strictEqual(r.status, 0, `取指纹出口必须可用，实得 rc=${r.status} stderr=${r.stderr}`)
    assert.strictEqual(String(r.stdout).trim(), c.beforeFingerprint,
      'shell 侧拿到的指纹必须与判据用的是同一份实现算出来的（否则 ④ 的两边永远不等）')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ── §12 外部深审 i1 / i2 / i3 的处置锁（2026-10-22，重放在主干那代之上） ──────────────
test('§12a dry：五条件齐备但本轮不落盘，打印将写的 evidence，既有字节逐字不变（i1）', () => {
  withDelivery(deliveredRecord({ status: 'pending' }), deliveredRecord(), (file, beforeBytes) => {
    const keep = fs.readFileSync(file)
    const res = mod().applyWriteback({ recordPath: file, beforeBytes, expectedCritic: 'claude', dry: true })
    assert.strictEqual(res.wrote, false, 'dry 档绝不落盘')
    assert.strictEqual(res.reason, 'dry-run', `应点名 dry-run，实得 ${res.reason}`)
    assert.match(res.evidence, /^delivery@[0-9a-f]{64}$/, 'dry 也要把**将写什么**交出来，否则无从核对')
    assert.strictEqual(res.action, 'external', 'dry 的语义是"这一轮本来会走 external 那一档"，不是降级')
    assert.deepStrictEqual(fs.readFileSync(file), keep, 'dry 之后盘上字节必须逐字不变（返回 false 不等于没动文件）')
  })
})

test('§12b 作用域判据：.. 段与非 .json 一律在任何 IO 之前抛错，既有文件一个字节都不动（i2）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wbdom-${process.pid}-`))
  try {
    // 诱饵就放在临时目录里，用一个真实存在、可解析、但不是判定产物的 JSON ——
    // i2 的原始主张是"REC 里塞 .. 就能任意读写"，这条负控把"写错位置"那一半真的拦下来给人看。
    const decoy = path.join(dir, 'package.json')
    fs.writeFileSync(decoy, JSON.stringify({ name: 'multi-publish', version: '0.0.0' }), 'utf8')
    const keep = fs.readFileSync(decoy)
    for (const bad of ['../../etc/passwd.json', 'rec.txt', 'a/../b/rec.json']) {
      assert.throws(() => mod().applyWriteback({ recordPath: bad, beforeBytes: Buffer.from('{}'), expectedCritic: 'claude' }),
        /missing-record-path|record-path-out-of-domain/, `${JSON.stringify(bad)} 必须被拒在 IO 之前`)
    }
    // 作用域**内**但不是判定产物的那份 JSON：不抛错，走 record-unreadable 的拒绝路径，一个字节都不写 ——
    // 这一格才是 i2 里"任意文件被改写"那半的真实答案（拦它的是五条件本身，不是路径形状）。
    const inside = mod().applyWriteback({ recordPath: decoy, beforeBytes: Buffer.from('{}'), expectedCritic: 'claude' })
    assert.strictEqual(inside.wrote, false, `诱饵必须被判未写回，实得 ${JSON.stringify(inside)}`)
    assert.strictEqual(inside.reason, 'record-unreadable', `应点名「读不出判定产物」，实得 ${inside.reason}`)
    assert.deepStrictEqual(fs.readFileSync(decoy), keep, '诱饵文件必须逐字不变')
    assert.deepStrictEqual(fs.readFileSync(path.join(dir, 'package.json')), keep, '按文件名给的路径同样不得被写')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('§12c 真实产物命名必须逐条通过作用域判据（规模下界，防「判据只对自己的夹具成立」）', () => {
  const dir = path.join(__dirname, '..', '.ccg', 'reviews')
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
  assert.ok(names.length >= 100, `真实产物面必须有规模（实得 ${names.length}），否则这条锁什么都没看`)
  const bad = names.filter((n) => {
    try { mod().assertRecordPathScope('.ccg/reviews/' + n); return false } catch { return true }
  })
  assert.deepStrictEqual(bad, [],
    `这些主干真实产物名会被作用域判据误杀，而入口递下来的正是这个形状：${bad.slice(0, 5).join(', ')}`)
  console.log(`[ccg-review-writeback-test] §12c 现场：真实产物 ${names.length} 条全部通过作用域判据`)
})

test('§12d 规格那张处置表与 DECLINE_REASONS 逐名同文（i3：一张表，不散在 if 链里）', () => {
  const specFile = path.join(__dirname, '..', 'openspec', 'changes', 'qm6-closure-writeback',
    'specs', 'qm6-closure-writeback', 'spec.md')
  const lines = fs.readFileSync(specFile, 'utf8').split(/\r?\n/)
  const h = lines.findIndex((l) => /^\|\s*缺件名/.test(l))
  if (h < 0) throw new Error('规格里那张处置表的表头找不到（以 "| 缺件名" 起头）⇒ 本条判据失明，不得当成通过')
  const fromSpec = new Set()
  let rows = 0
  for (let i = h + 2; i < lines.length && /^\|/.test(lines[i]); i++) {
    rows++
    const firstCol = lines[i].split('|')[1] || ''
    for (const m of firstCol.matchAll(/`([a-z-]+)`/g)) fromSpec.add(m[1])
  }
  assert.ok(rows >= 5, `表格行数不足（实得 ${rows}）⇒ 表被改坏，本条要同步`)
  const inCode = new Set(mod().DECLINE_REASONS)
  // 非缺件那一档也必须进同一把锁（第 6 轮 i3）：只比 DECLINE_REASONS 的话，
  // `dry-run` 这类"名字确实会出现在输出里、但不是缺件"的出口就从两张表之间漏掉。
  const outcomes = new Set(mod().NON_DECLINE_OUTCOMES)
  assert.ok(outcomes.has('dry-run'), 'dry-run 必须登记在 NON_DECLINE_OUTCOMES 里：' + JSON.stringify([...outcomes]))
  const throws = new Set(['missing-record-path', 'record-path-out-of-domain'])
  for (const n of throws) assert.ok(fromSpec.has(n), `规格的抛错档必须点名 ${n}`)
  const diff = [...fromSpec].filter((n) => !inCode.has(n) && !throws.has(n) && !outcomes.has(n))
  const missing = [...inCode].filter((n) => !fromSpec.has(n))
  assert.deepStrictEqual(diff, [], `规格里有而代码没有的缺件名：${diff.join(
)}`)
  assert.deepStrictEqual(missing, [], `代码里会出声而规格没写的缺件名：${missing.join(
)}`)
  assert.ok(inCode.size >= 8, `DECLINE_REASONS 规模异常（${inCode.size}）`)
  const notSpeced = [...inCode, ...outcomes].filter((n) => !fromSpec.has(n))
  assert.deepStrictEqual(notSpeced, [], `代码会出声而规格没写的名：${notSpeced.join(', ')}`)
  console.log(`[ccg-review-writeback-test] §12d 现场：规格 ${fromSpec.size} 名 / 拒写 ${inCode.size} 名 + 非拒写出口 ${outcomes.size} 名 + 抛错 2 名，逐名对账通过`)
})
