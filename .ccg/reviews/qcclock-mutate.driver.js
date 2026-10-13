'use strict'
/**
 * fix-quick-collect-clock-rot 变异反证原件（可重跑）
 *
 * 每条：备份原字节 → 打补丁（锚点命中数必须等于 expect，否则 ABORTED 计坏）→ 跑指定测试文件
 * → 按 want 判定（red 必须点名预期的文件；green 必须 0 失败）→ **finally 逐字节还原并回读校验**。
 * 还原放在 finally：上一代电池在 patch 与 restore 之间没有兜底，进程被杀会留下带 MUT 记号的工作副本。
 *
 * 用法：node .ccg/reviews/qcclock-mutate.driver.js
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const DESKTOP = path.join(ROOT, 'apps', 'desktop')
const HANDLER = path.join(DESKTOP, 'electron/ipc-handlers/quick-collect.js')
const IPC_TEST = path.join(DESKTOP, 'electron/ipc-handlers/quick-collect.test.js')
const ENGINE_TEST = path.join(DESKTOP, 'electron/services/quick-collect-engine.test.js')
const LOCK = path.join(DESKTOP, 'electron/services/quick-collect-clock-determinism.test.js')

/** 把字面锚点转成正则：真换行按 \r?\n 匹配，兼容 i/lf w/crlf 的工作副本 */
function toRegExp (literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped.replace(/\n/g, '\\r?\\n'), 'g')
}
function patch (file, from, to, expect = 1) {
  const src = fs.readFileSync(file, 'utf8')
  const re = toRegExp(from)
  const hits = src.match(re) || []
  if (hits.length !== expect) throw new Error('ANCHOR ' + path.relative(ROOT, file) + ' hits=' + hits.length + ' expect=' + expect)
  // 行尾跟随目标文件自己的写法：这些测试文件是 i/lf w/crlf，用字面 \n 做 split/join 会
  // "计数命中、替换没发生"，于是变异静默空转、电池照报 OK（本仓实测踩过的注入失效形态）。
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const next = src.replace(re, () => to.replace(/\n/g, eol))
  if (next === src) throw new Error('PATCH_NOOP ' + path.relative(ROOT, file))
  fs.writeFileSync(file, next)
  return src
}
function restore (file, bytes) {
  fs.writeFileSync(file, bytes)
  if (fs.readFileSync(file, 'utf8') !== bytes) throw new Error('RESTORE_MISMATCH ' + path.relative(ROOT, file))
}
function runVitest (files) {
  let out = ''
  try {
    out = execFileSync('pnpm', ['exec', 'vitest', 'run', ...files], { cwd: DESKTOP, encoding: 'utf8', maxBuffer: 1 << 26, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    out = String((e.stdout || '') + (e.stderr || ''))
  }
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '')
  const failed = (clean.match(/^ FAIL .*$/gm) || []).map((l) => l.trim())
  // vitest 的汇总行长这样：`      Tests  1 failed | 18 passed (19)`（没有 node:test 的 ℹ 前缀）
  const sum = /\n\s*Tests\s+([^\n]*)/.exec(clean)
  const tests = sum ? sum[1].trim() : '?'
  const pass = !!sum && !/failed/.test(sum[1]) && /\d+ passed/.test(sum[1])
  return { failed, tests, cleanPass: pass, raw: clean }
}
function namesOf (failed) {
  return [...new Set(failed.map((l) => l.replace(/^ FAIL\s+/, '').split(' > ')[0]))]
}

const cases = [
  {
    name: 'A 摘掉 IPC handler 透给引擎的时钟（半接线缝隙复发）',
    file: HANDLER, from: '      now: deps.now,\n', to: '', expect: 1,
    want: 'red', expectFiles: ['electron/ipc-handlers/quick-collect.test.js', 'electron/services/quick-collect-cn-sources.test.js'],
    why: '本 PR 的运行时那一半：漏了它，窗口过滤读真实墙上时间，夹具红就是必然',
  },
  {
    name: 'B 摘掉 IPC 测试夹具的时钟注入',
    file: IPC_TEST, from: '    now: () => NOW,\n', to: '', expect: 1,
    want: 'red', expectFiles: ['electron/services/quick-collect-clock-determinism.test.js'],
    why: '证明结构锁真的在看守"驱动者必须注入"，不是恒绿',
  },
  {
    name: 'C 摘掉引擎测试里唯一那处时钟注入（换第二个驱动者验锁不是只盯一个文件）',
    file: ENGINE_TEST, from: 'createQuickCollectEngine({ now: () => NOW, ...deps })', to: 'createQuickCollectEngine({ ...deps }) // MUT-C', expect: 1,
    want: 'red', expectFiles: ['electron/services/quick-collect-clock-determinism.test.js'],
    why: '结构锁必须对"另一个驱动者"同样有效，否则它只是给某一个文件立的纪念碑',
  },
  {
    name: 'D 把驱动者判据改成永不匹配（锁空转）',
    file: LOCK, from: 'const DRIVES_CLOCK = /createQuickCollectEngine|createFeedTrendFetcher|import\\(([\'"])[^\'"]*\\/quick-collect\\1\\)/',
    to: 'const DRIVES_CLOCK = /__NEVER_MATCH__/ // MUT-D', expect: 1,
    want: 'red', expectFiles: ['electron/services/quick-collect-clock-determinism.test.js'],
    why: '解析退化成空集合时，反失明断言（域非空 + 驱动者下界）必须当场红',
  },
  {
    name: 'E 把违规判据改成恒不成立（装饰性门禁）',
    file: LOCK, from: '    .filter((e) => DRIVES_CLOCK.test(e.src) && ABS_FIXTURE.test(e.src) && !CLOCK_PROVIDER.test(e.src))',
    to: '    .filter(() => false) // MUT-E', expect: 1,
    want: 'red', expectFiles: ['electron/services/quick-collect-clock-determinism.test.js'],
    why: '真实域那条 toEqual([]) 对"恒不成立"是瞎的；必须由合成违规夹具那一条当场抓住',
  },
  {
    name: 'F 只把夹具的绝对时刻挪一天（合规编辑）',
    file: IPC_TEST, from: "const NOW = Date.parse('2026-10-11T04:00:00.000Z')",
    to: "const NOW = Date.parse('2026-10-12T04:00:00.000Z')", expect: 1,
    want: 'green', expectFiles: [],
    why: '反向边界：本锁禁的是"夹具与判据不同源"，不是"不许换日期"。换日期必须照绿，否则它会打红下一个合规 PR',
  },
]

const RUN = {
  A: ['electron/ipc-handlers/quick-collect.test.js', 'electron/services/quick-collect-cn-sources.test.js'],
  B: ['electron/services/quick-collect-clock-determinism.test.js'],
  C: ['electron/services/quick-collect-clock-determinism.test.js'],
  D: ['electron/services/quick-collect-clock-determinism.test.js'],
  E: ['electron/services/quick-collect-clock-determinism.test.js'],
  F: ['electron/ipc-handlers/quick-collect.test.js', 'electron/services/quick-collect-clock-determinism.test.js'],
}

console.log('# qcclock 变异反证原件')
console.log('# head=' + execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim())
console.log('# collectedAt=' + new Date().toISOString())

let bad = 0
for (const [i, c] of cases.entries()) {
  console.log('\n== ' + c.name)
  let bytes
  try {
    bytes = patch(c.file, c.from, c.to, c.expect)
  } catch (e) {
    console.log('   ABORTED ' + e.message)
    bad++
    continue
  }
  try {
    const r = runVitest(RUN['ABCDEF'[i]])
    const got = namesOf(r.failed)
    if (c.want === 'red') {
      const missing = c.expectFiles.filter((f) => !got.some((g) => g.endsWith(f)))
      const ok = got.length > 0 && missing.length === 0
      console.log('   want=red fail=' + (got.length ? got.join(' , ') : 'NONE') + (missing.length ? ' MISSING:[' + missing.join(',') + ']' : '') + ' ⇒ ' + (ok ? 'OK' : 'BAD'))
      if (!ok) bad++
    } else {
      const ok = got.length === 0
      console.log('   want=green fail=' + (got.length ? got.join(' , ') : '0') + ' ⇒ ' + (ok ? 'OK' : 'BAD'))
      if (!ok) bad++
    }
    console.log('   tests=' + r.tests)
  } finally {
    restore(c.file, bytes)
    console.log('   restored=bytes_equal')
  }
}

// 收尾自证：全部还原后原始测试必须照旧全绿
const fin = runVitest(['electron/ipc-handlers/quick-collect.test.js', 'electron/services/quick-collect-cn-sources.test.js', 'electron/services/quick-collect-clock-determinism.test.js'])
const finOk = fin.tests !== '?' && fin.cleanPass && fin.failed.length === 0
console.log('\n== FINAL（还原后复跑）')
console.log('   tests=' + fin.tests + ' fail=' + (fin.failed.length ? namesOf(fin.failed).join(' , ') : '0') + ' ⇒ ' + (finOk ? 'OK' : 'SUITE_DID_NOT_RUN'))
if (!finOk) bad++
console.log('\nMUTATION_BAD=' + bad)
process.exit(bad ? 1 : 0)
