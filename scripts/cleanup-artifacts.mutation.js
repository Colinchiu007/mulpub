'use strict'
/*
 * cleanup-artifacts 的变异反证驱动（QM-6 i3 的处置：取证工具必须入仓，否则"9/9 CAUGHT"
 * 只是一句别人复跑不了的话）。
 *
 * 它是**按需取证工具**，不是门禁：CI 不跑它（跑它要改被测源文件，且每次约 1 分钟）。
 * 用法（任意 cwd 都行）：
 *   node scripts/cleanup-artifacts.mutation.js
 * 期望末行 `RESULT=OK`，且每条变异都 `CAUGHT` 并**指名**它要抓的那条用例。
 *
 * 五条从本仓既有事故里抄来的硬约束，缺一条这个驱动就会把"没跑"读成"已反证"：
 * 1. **读写被测源必须同编码 utf8**（曾用 latin1 读，含中文的锚点永不命中，而汇总只数 CAUGHT
 *    ⇒ 那条从未执行过的反证被写成"已反证"）。
 * 2. **每条变异前断言锚点命中恰为 1**：0=锚点失效（改动被摘掉了/文案漂了），≥2=不唯一。
 *    两种都当场 PROBLEM 并继续检查下一条，最后 RESULT 必非 OK——不许 `continue` 装作没事。
 * 3. **动手前要求被测面工作树 == HEAD**（`--allow-dirty` 显式越过）：崩溃过一次的重放会把
 *    污染态固化成"还原基线"，于是还原"成功"是假的。
 * 4. **每条变异都要断言 `# tests >= MIN_TESTS`**：只数红名会让"整套没跑起来"读成"红了很多条"。
 * 5. **靶子不止判据本体**：结构锁（A14/A15 读源码、查索引）也要能被反证，所以每条变异可指名
 *    自己的文件；对"锁本身"的变异（n11）改的是测试文件，只改判据本体的变异集对它完全失明。
 * 跑完再跑一次被测锁，证明还原态是绿的（还原失败必须出声）。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const TARGET = path.join('scripts', 'cleanup-artifacts.js')
const TESTFILE = path.join('scripts', 'cleanup-artifacts.test.js')
const LOCK = TESTFILE
const MIN_TESTS = 15

const V = "degraded > 0 ? 'DEGRADED' : rejected > 0 ? 'REJECTED_PRESENT' : 'OK'"

const MUTS = [
  { id: 'n1', name: '首页失败也当"没有待删条目"', from: 'if (page === 1) {', to: 'if (false) {', exp: ['A4'] },
  { id: 'n2', name: '不重试（退回 --paginate 的一次性形态）', from: 'for (; attempts < opt.retries; attempts++) {', to: 'for (; attempts < 1; attempts++) {', exp: ['A3'] },
  { id: 'n3', name: 'expired 也算待删', from: 'a.expired === false &&', to: '', exp: ['A1'] },
  { id: 'n4', name: 'cutoff 用成"当天零点"（边界误删）', from: ".replace(/\\.\\d{3}Z$/, 'Z')", to: ".slice(0,10) + 'T00:00:00Z'", exp: ['A2'] },
  { id: 'n5', name: 'dry-run 也发删除', from: 'if (opt.write) {', to: 'if (true) {', exp: ['A7'] },
  { id: 'n6', name: 'DELETE 去掉 --silent（204 空体复发）', from: "del(['api', '--silent', '-X', 'DELETE'", to: "del(['api', '-X', 'DELETE'", exp: ['A9'] },
  { id: 'n7', name: '半途页失败仍判 OK（静默漏删）', from: V, to: "rejected > 0 ? 'REJECTED_PRESENT' : 'OK'", exp: ['A5'] },
  { id: 'n8', name: 'id 不校验形状，原样拼进 DELETE 路径段', from: 'if (Number.isInteger(a.id) && a.id > 0) ids.push(a.id)\n      else rejected++', to: 'ids.push(a.id)', exp: ['A13'] },
  { id: 'n9', name: '首行不再打印 rejected（坏形状被静默吞掉）', from: ' rejected=${r.rejected}', to: '', exp: ['A14'] },
  { id: 'n10', name: 'rejected>0 仍判 OK（把"有条目被我拒了"读成"清理做完了"）', from: V, to: "degraded > 0 ? 'DEGRADED' : 'OK'", exp: ['A13'] },
  { id: 'n11', name: '追踪锁指向一个不存在的文件（锁自身退化成空转）', file: TESTFILE, from: "  const rel = 'scripts/cleanup-artifacts.mutation.js'", to: "  const rel = 'scripts/renamed-away-not-tracked.js'", exp: ['A15'] },
]

function git (args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}
function runLock () {
  const r = spawnSync(process.execPath, ['--test', LOCK.split(path.sep).join('/')], { cwd: ROOT, encoding: 'utf8' })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const t = /# tests (\d+)/.exec(out)
  const reds = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => (/(A\d+)/.exec(m[1]) || [, '?'])[1])
  return { rc: r.status, total: t ? Number(t[1]) : -1, reds }
}

const rels = [...new Set(MUTS.map((m) => m.file || TARGET))]
const allowDirty = process.argv.includes('--allow-dirty')
const dirtyLines = rels
  .flatMap((rel) => (git(['status', '--porcelain', '--', rel]).stdout || '').split('\n').filter((l) => l.trim()))
if (dirtyLines.length && !allowDirty) {
  console.error(`REFUSE: 被测面工作树不等于 HEAD（${dirtyLines.length} 行差异：${dirtyLines.join(' / ')}）。\n` +
    '先把这些文件恢复干净再跑，否则"还原成功"会把污染态固化成基线。确要在脏态取证才加 --allow-dirty。')
  process.exit(2)
}

const orig = new Map()
for (const rel of rels) orig.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'))
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 10)

let ok = true
for (const m of MUTS) {
  const rel = m.file || TARGET
  const src = orig.get(rel)
  const abs = path.join(ROOT, rel)
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const a = m.from.replace(/\n/g, eol)
  const r = m.to.replace(/\n/g, eol)
  const hits = src.split(a).length - 1
  if (hits !== 1) {
    console.log(`PROBLEM ${m.id} ${m.name} | 锚点命中 ${hits} 次（要求恰为 1：0=锚点已失效，≥2=不唯一）`)
    ok = false
    continue
  }
  fs.writeFileSync(abs, src.split(a).join(r), 'utf8')
  const res = runLock()
  fs.writeFileSync(abs, src, 'utf8')
  const miss = m.exp.filter((e) => !res.reds.includes(e))
  const good = res.total >= MIN_TESTS && !miss.length && res.rc !== 0
  console.log(`${good ? 'CAUGHT ' : 'PROBLEM'} ${m.id} ${m.name} | file=${rel} tests=${res.total} 红=[${res.reds.join(',')}] 缺=[${miss.join(',')}]`)
  if (!good) ok = false
}

let restoredAll = true
for (const rel of rels) {
  if (md5(fs.readFileSync(path.join(ROOT, rel), 'utf8')) !== md5(orig.get(rel))) restoredAll = false
}
const after = runLock()
console.log(`RESTORE md5=${restoredAll} files=${rels.length} 还原后被测锁 rc=${after.rc} tests=${after.total}`)
if (!restoredAll || after.rc !== 0 || after.total < MIN_TESTS) ok = false
console.log('RESULT=' + (ok ? 'OK' : 'NOT OK'))
process.exit(ok ? 0 : 1)
