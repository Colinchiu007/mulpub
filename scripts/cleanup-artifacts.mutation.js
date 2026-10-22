'use strict'
/*
 * cleanup-artifacts.js 的变异反证驱动（QM-6 i3 的处置：取证工具必须入仓，否则"7/7 CAUGHT"
 * 只是一句别人无法复跑的话）。
 *
 * 它是**按需取证工具**，不是门禁：CI 不跑它（跑它要改被测源文件，且每次约 1 分钟）。
 * 用法（仓库根或任意 cwd 都行）：
 *   node scripts/cleanup-artifacts.mutation.js
 * 期望末行 `RESULT=OK`，且每条变异都 `CAUGHT` 并**指名**它要抓的那条用例。
 *
 * 四条从本仓既有事故里抄来的硬约束，缺一条这个驱动就会把"没跑"读成"已反证"：
 * 1. **读写被测源必须同编码 utf8**（曾用 latin1 读，含中文的锚点永不命中，而汇总只数 CAUGHT
 *    ⇒ 那条从未执行过的反证被写成"已反证"）。
 * 2. **每条变异前断言锚点命中恰为 1**：0=锚点失效（改动被摘掉了/文案漂了），≥2=不唯一。
 *    两种都当场 PROBLEM 并继续检查下一条，最后 RESULT 必非 OK——不许 `continue` 装作没事。
 * 3. **动手前要求工作树 == HEAD**（`--allow-dirty` 显式越过）：崩溃过一次的重放会把污染态
 *    固化成"还原基线"，于是还原"成功"是假的。
 * 4. **每条变异都要断言 `# tests >= MIN_TESTS`**：只数红名会让"整套没跑起来"读成"红了很多条"。
 * 跑完再跑一次被测锁，证明还原态是绿的（还原失败必须出声）。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const TARGET = path.join('scripts', 'cleanup-artifacts.js')
const LOCK = path.join('scripts', 'cleanup-artifacts.test.js')
const MIN_TESTS = 14

const MUTS = [
  { id: 'n1', name: '首页失败也当"没有待删条目"', from: 'if (page === 1) {', to: 'if (false) {', exp: ['A4'] },
  { id: 'n2', name: '不重试（退回 --paginate 的一次性形态）', from: 'for (; attempts < opt.retries; attempts++) {', to: 'for (; attempts < 1; attempts++) {', exp: ['A3'] },
  { id: 'n3', name: 'expired 也算待删', from: 'a.expired === false &&', to: '', exp: ['A1'] },
  { id: 'n4', name: 'cutoff 用成"当天零点"（边界误删）', from: ".replace(/\\.\\d{3}Z$/, 'Z')", to: ".slice(0,10) + 'T00:00:00Z'", exp: ['A2'] },
  { id: 'n5', name: 'dry-run 也发删除', from: 'if (opt.write) {', to: 'if (true) {', exp: ['A7'] },
  { id: 'n6', name: 'DELETE 去掉 --silent（204 空体复发）', from: "del(['api', '--silent', '-X', 'DELETE'", to: "del(['api', '-X', 'DELETE'", exp: ['A9'] },
  { id: 'n7', name: '半途页失败仍判 OK（静默漏删）', from: "degraded > 0 ? 'DEGRADED' : 'OK'", to: "'OK'", exp: ['A5'] },
  { id: 'n8', name: 'id 不校验形状，原样拼进 DELETE 路径段', from: 'if (Number.isInteger(a.id) && a.id > 0) ids.push(a.id)\n      else rejected++', to: 'ids.push(a.id)', exp: ['A13'] },
  { id: 'n9', name: '首行不再打印 rejected（坏形状被静默吞掉）', from: ' rejected=${r.rejected}', to: '', exp: ['A14'] },
]

function git (args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}
function runLock () {
  const r = spawnSync(process.execPath, ['--test', LOCK.replace(/\\/g, '/')], { cwd: ROOT, encoding: 'utf8' })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const t = /# tests (\d+)/.exec(out)
  const reds = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => (/(A\d+)/.exec(m[1]) || [, '?'])[1])
  return { rc: r.status, total: t ? Number(t[1]) : -1, reds }
}

const allowDirty = process.argv.includes('--allow-dirty')
const abs = path.join(ROOT, TARGET)
const dirty = (git(['status', '--porcelain', '--', TARGET]).stdout || '').trim()
if (dirty && !allowDirty) {
  console.error(`REFUSE: ${TARGET} 工作树不等于 HEAD（${dirty.split('\n').length} 行差异）。\n` +
    '先把被测源恢复干净再跑，否则"还原成功"会把污染态固化成基线。确要在脏态取证才加 --allow-dirty。')
  process.exit(2)
}

const orig = fs.readFileSync(abs, 'utf8')
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 10)
const baseline = md5(orig)

let ok = true
for (const m of MUTS) {
  const a = m.from.replace(/\n/g, orig.includes('\r\n') ? '\r\n' : '\n')
  const r = m.to.replace(/\n/g, orig.includes('\r\n') ? '\r\n' : '\n')
  const hits = orig.split(a).length - 1
  if (hits !== 1) {
    console.log(`PROBLEM ${m.id} ${m.name} | 锚点命中 ${hits} 次（要求恰为 1：0=锚点已失效，≥2=不唯一）`)
    ok = false
    continue
  }
  fs.writeFileSync(abs, orig.split(a).join(r), 'utf8')
  const res = runLock()
  fs.writeFileSync(abs, orig, 'utf8')
  const miss = m.exp.filter((e) => !res.reds.includes(e))
  const good = res.total >= MIN_TESTS && !miss.length && res.rc !== 0
  console.log(`${good ? 'CAUGHT ' : 'PROBLEM'} ${m.id} ${m.name} | tests=${res.total} 红=[${res.reds.join(',')}] 缺=[${miss.join(',')}]`)
  if (!good) ok = false
}

const after = md5(fs.readFileSync(abs, 'utf8'))
const restored = runLock()
console.log(`RESTORE md5=${after === baseline} 还原后被测锁 rc=${restored.rc} tests=${restored.total}`)
if (after !== baseline || restored.rc !== 0 || restored.total < MIN_TESTS) ok = false
console.log('RESULT=' + (ok ? 'OK' : 'NOT OK'))
process.exit(ok ? 0 : 1)
