'use strict'
/**
 * 1.1 示踪弹：从「仓侧初始化」到「驱动写回」到「判据读数」跑一整条真链路，
 * 断言一条刚交付的记录能读成 `external`，**且全程没有测试自己手写 `tier`**。
 *
 * 现在它必须红（本仓没有任何生产方写 `tier`）。红的形状是有意的：
 * 它红在 `require('./ccg-review-writeback.js')` 报 MODULE_NOT_FOUND ——
 * 也就是"写入方不存在"这件事本身，而不是某个断言调不出来。
 * 这条红就是 `qm6-closure-writeback` 的立项证据；实现（tasks 3.x）把它转绿。
 *
 * 跑法：node --test scripts/ccg-closure-writeback-chain.test.js
 *
 * 三条纪律（都是本仓踩过的位置）：
 *  ① 夹具不得替被测方把结论算好：这里的记录由**真** `buildDeepReviewInit` 产出，
 *     `deepReview` 的正文由**真** `writeBack` 站点写的形状（status/performedBy/findings/…）灌进去，
 *     测试自己不出现 `tier` 与 `evidence` 两个字面量（除负控那一条，它显式断言"没写"）。
 *  ② 判据侧不复制：最终读数一律经 `closureCorroboration()` 真跑取，不在测试里重算。
 *  ③ 断言"没生产方"与断言"有生产方"是两条用例，各自独立红；把后者写成"要么 external 要么
 *     保持 unknown"的宽容形状，等于把这条锁变成永不失败的存在性检查。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const mod = require('./check-pr-exec-record.js')
const decider = require('./ccg-review-decider.js')

/** 取一条刚被"引擎成功收口"写过的记录：字段形状照抄引擎 :1252-1256 的产物，不含 tier。 */
function freshlyDeliveredRecord () {
  const rec = decider.buildDeepReviewInit('dual')
  // 引擎收口处做的是**整体替换**（`:520` `rec.deepReview = deepReview`）：
  // 写进去的是 status/performedBy/findings/minScore/at，**不写 tier/evidence**。
  // 所以必须把 init 给的两个键删掉，才等于现场读到的形状——留着就是替被测方把结论算好。
  const closed = Object.assign({}, rec, {
    status: 'cleared',
    performedBy: 'claude',
    findings: [
      { id: 'i1', severity: 'Critical', finding: '断言取的是字符串存在性而非执行' },
      { id: 'i2', severity: 'Warning', finding: '失败出口之前有一步永远不会被读到' }
    ],
    minScore: 6,
    at: '2026-10-21T00:00:00.000Z'
  })
  delete closed.tier
  delete closed.evidence
  return closed
}

test('生产方存在：scripts/ccg-review-writeback.js 必须可被 require（1.1 的立项证据就红在这一条）', () => {
  const p = path.join(__dirname, 'ccg-review-writeback.js')
  assert.ok(fs.existsSync(p), '本仓还没有任何生产方会写 deepReview.tier ⇒ 合规收口只能手写，这正是本片要消掉的形状')
})

test('刚交付的记录经驱动写回后，判据读成 external，且测试没写过 tier/evidence', (t) => {
  const p = path.join(__dirname, 'ccg-review-writeback.js')
  if (!fs.existsSync(p)) {
    t.diagnostic('写入方尚未落地 ⇒ 本条按设计红在上一条，这里显式不判定（不得让它变成静默通过）')
    throw new Error('ccg-review-writeback.js 不存在：没有生产方，链路的终点无法到达')
  }
  const writeback = require(p)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wb-${process.pid}-`))
  try {
    const file = path.join(dir, 'rec.json')
    const rec = { sha: 'a'.repeat(40), mode: 'dual', deepReview: freshlyDeliveredRecord() }
    // 时序必须照抄驱动的真实动作：**动手前**取字节，动手后才是"刚交付"的形状。
    // 拿动手后的字节当 beforeBytes，写回器会（正确地）读成 no-write —— 第一版就栽在这。
    const preDelivery = JSON.parse(JSON.stringify(rec))
    preDelivery.deepReview.status = 'pending'
    preDelivery.deepReview.findings = null
    fs.writeFileSync(file, JSON.stringify(preDelivery, null, 2), 'utf8')
    const beforeBytes = fs.readFileSync(file)
    fs.writeFileSync(file, JSON.stringify(rec, null, 2), 'utf8')
    const res = writeback.applyWriteback({
      recordPath: file,
      // 上层显式透传定位键与期望后端：漏传不报错、中间两级成死代码那一型，本条就是防它
      beforeBytes,
      expectedCritic: 'claude'
    })
    assert.ok(res, 'applyWriteback 必须返回一个带出声名的读数')
    const after = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.strictEqual(after.deepReview.tier, 'external',
      `驱动写回后 tier 应为 external，实得 ${JSON.stringify(after.deepReview.tier)}（reason=${res.reason || '-'}, spoke=${(res.spoke || []).join('|')}）`)
    assert.ok(typeof after.deepReview.evidence === 'string' && after.deepReview.evidence.length > 0,
      'evidence 必须由写回器产出（delivery@ 摘要），不是留给会话手写的空格')

    // 判据侧真跑：closureCorroboration 是判据自己的函数，测试不重算
    const corr = mod.closureCorroboration(after.deepReview, () => true)
    assert.strictEqual(corr, 'external', `判据必须把这条读成已获外部佐证，实得 ${JSON.stringify(corr)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('负控：没有写回器介入时，同一条记录在判据侧仍读不成 external（证明上一条测的是"写了"，不是"存在"）', () => {
  const dr = freshlyDeliveredRecord()
  assert.ok(!('tier' in dr) || dr.tier === 'unknown',
    `引擎收口形态的记录不该自带可核 tier，实得 ${JSON.stringify(dr.tier)}`)
  const corr = mod.closureCorroboration(dr, () => true)
  assert.notStrictEqual(corr, 'external', `没写回就判成"已获外部佐证"（实得 ${JSON.stringify(corr)}）⇒ 判据恒真，上一条立刻失去意义`)
})
