'use strict'
/**
 * ccg-review-gate-surfaces 的回归锁（tasks 11.1）
 *
 * 动因（2026-10-23 实测）：「哪些路径属于机械闸门本体」在仓里有两份互不认账的表 ——
 * 判据侧 `check-pr-exec-record.js::HIGH_RISK_SURFACES`（收口矩阵读它）与决策侧
 * `ccg-review-decider.js::RULES.sensitivePaths`（决定要不要起双模型）各抄一份，且后者
 * **一条守门面路径都不含**：改 `.github/workflows/` 或 `scripts/check-*.js` 时决策层只看
 * 行数与 auth/加密关键词 ⇒ 判 `single` ⇒ 凭一条 pending 产物即可通过既有闭环判据
 * （= 已登记的缺陷 G）。本模块把「守门面清单」收成一处，两个消费者各取所需：
 * 判据继续按它做收口要求，决策层只**观测**命中、不改 mode。
 *
 * 运行：node --test scripts/lib/ccg-review-gate-surfaces.test.js
 * 只 require node 内置模块（CI 的 changes 作业不装依赖）。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const LIB = 'ccg-review-gate-surfaces.js'
const surfaces = require('./' + LIB)
const judge = require('../check-pr-exec-record.js')

// ── 清单本体 ──
test('守门面清单非空、条数有下界、每条都带 why', () => {
  const list = surfaces.GATE_SURFACES
  assert.ok(Array.isArray(list), 'GATE_SURFACES 必须是数组')
  assert.ok(list.length >= 5, `清单只剩 ${list.length} 条（下界 5）⇒ 有人删了守门面条目而没同步判据`)
  for (const s of list) {
    assert.ok(typeof s.prefix === 'string' && s.prefix.length > 0, `条目缺 prefix：${JSON.stringify(s)}`)
    assert.ok(typeof s.why === 'string' && s.why.length > 0, `条目 ${s.prefix} 缺 why：无出处的清单项等于没人能复核它`)
  }
  const dup = list.map((s) => s.prefix).filter((p, i, a) => a.indexOf(p) !== i)
  assert.deepStrictEqual(dup, [], '前缀不得重复：两条同前缀会让"命中了几条"这个数说谎')
})

test('本模块只做名称查询，不得长成第二份文件匹配实现', () => {
  // 文件→前缀的匹配（段起点、vendored 排除、扩展名作用域）唯一实现是
  // check-pr-exec-record.js 的 highRiskPrefixOf。本模块若把它抄一遍，两份必然在
  // vendored 那条上分裂 —— 所以禁的是"文件匹配的形状"，不是字符串比较本身。
  const src = fs.readFileSync(path.join(__dirname, LIB), 'utf8')
  assert.ok(!/isVendored|VENDORED_SUBTREES/.test(src), 'vendored 排除只准存在于判据侧一处')
  assert.ok(!/split\(['"]\/['"]\)|path\.sep|\\\\\/\//.test(src), '本模块不得切路径段做匹配')
  // 名称查询的两个语义各自有界：精确成员 vs 家族归属，不得混成一个
  assert.strictEqual(surfaces.isGateSurfacePrefix('scripts/check-'), true, '清单自身成员必须被认出来')
  assert.strictEqual(surfaces.isGateSurfacePrefix('scripts/check-docs-sync.js'), false,
    '成员查询只认清单原值：把文件路径喂给它不成立，那是 highRiskPrefixOf 的活')
  assert.strictEqual(surfaces.looksLikeGatePrefix('scripts/check-docs-sync.js'), true,
    '家族归属要认得出"某条守门面条目下面的具体文件"')
  assert.strictEqual(surfaces.looksLikeGatePrefix('01-docs/PRD.md'), false, '文档不属于守门面')
})

// ── 与判据清单对账（派生，不是各抄一份） ──
test('判据的 HIGH_RISK_SURFACES 必须逐字含本清单每一条，且不得反过来自己长出一条守门面', () => {
  const judgePrefixes = judge.HIGH_RISK_SURFACES.map((s) => s.prefix)
  for (const s of surfaces.GATE_SURFACES) {
    assert.ok(judgePrefixes.includes(s.prefix), `判据清单缺 ${s.prefix} ⇒ 改这条守门面件不会触发任何收口要求`)
  }
  // 反向：判据里凡是落在守门面家族内的条目，本清单必须承认（否则两份表又开始各自生长）
  const rogue = judgePrefixes.filter((p) => surfaces.looksLikeGatePrefix(p) && !surfaces.isGateSurfacePrefix(p))
  assert.deepStrictEqual(rogue, [], `判据里出现未经本清单承认的守门面条目：${rogue.join(', ')}`)
})

test('接线锁：判据与决策层都必须 require 本模块（缺一个，另一份表就会自己漂移）', () => {
  const j = fs.readFileSync(path.join(__dirname, '..', 'check-pr-exec-record.js'), 'utf8')
  const d = fs.readFileSync(path.join(__dirname, '..', 'ccg-review-decider.js'), 'utf8')
  assert.match(j, /require\(['"]\.\/lib\/ccg-review-gate-surfaces\.js['"]\)/, '判据必须从本模块取守门面清单')
  assert.match(d, /require\(['"]\.\/lib\/ccg-review-gate-surfaces\.js['"]\)/, '决策层必须从本模块取守门面清单')
})

test('规模读数留痕：清单条目与判据高危面的交集计数（引用时现跑，不得写进注释当常数）', () => {
  const judgePrefixes = new Set(judge.HIGH_RISK_SURFACES.map((s) => s.prefix))
  const n = surfaces.GATE_SURFACES.filter((s) => judgePrefixes.has(s.prefix)).length
  console.log(`[gate-surface] entries=${surfaces.GATE_SURFACES.length} judgeHighRisk=${judge.HIGH_RISK_SURFACES.length} derived=${n}`)
  assert.strictEqual(n, surfaces.GATE_SURFACES.length, '每一条守门面条目都必须出现在判据高危面里（derived ≠ 条目数即漏派生）')
})
