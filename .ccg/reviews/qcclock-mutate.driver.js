'use strict'
/**
 * fix-quick-collect-clock-rot 变异反证原件（可重跑）
 *
 * 每条自带 `run`（要跑哪些测试文件）与 `expectFiles`（want=red 时必须点名的红）：
 * 上一版用 `RUN['ABCDEF'[i]]` 与 cases 下标隐式对齐，删/插一条 case 就会把变异跑到错误的
 * 文件集上 —— 对 want=green 那条尤其致命（"在缩小的文件集上真空成立"= 静默假绿）。
 * 现在启动即校验每条都有 run/expect，且 want=red 的 run 集必须覆盖 expectFiles。
 *
 * 打补丁 → 跑测试 → 按 want 判定 → **finally 逐字节还原并回读**。
 * 开工前先验被触文件干净：上一轮有两个评审并发读同一个 worktree，其中一个自述跑了本驱动器，
 * 现场"2 文件红"因此不可归因 —— 清洁检查就是为了让这种污染当场响，而不是留给下一个人猜。
 *   node .ccg/reviews/qcclock-mutate.driver.js
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
const LOCK_NAME = 'electron/services/quick-collect-clock-determinism.test.js'
const IPC_NAME = 'electron/ipc-handlers/quick-collect.test.js'
const CN_NAME = 'electron/services/quick-collect-cn-sources.test.js'

function toRegExp (literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped.replace(/\n/g, '\\r?\\n'), 'g')
}
function patch (file, from, to, expect = 1) {
  const src = fs.readFileSync(file, 'utf8')
  const hits = src.match(toRegExp(from)) || []
  if (hits.length !== expect) throw new Error('ANCHOR ' + path.relative(ROOT, file) + ' hits=' + hits.length + ' expect=' + expect)
  // 行尾跟随目标文件自己的写法：这些测试文件是 i/lf w/crlf，用字面 \n 做 split/join 会
  // "计数命中、替换没发生"，变异静默空转、电池照报 OK。
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const next = src.replace(toRegExp(from), () => to.replace(/\n/g, eol))
  if (next === src) throw new Error('PATCH_NOOP ' + path.relative(ROOT, file))
  fs.writeFileSync(file, next)
  return src
}
function restore (file, bytes) {
  fs.writeFileSync(file, bytes)
  if (fs.readFileSync(file, 'utf8') !== bytes) throw new Error('RESTORE_MISMATCH ' + path.relative(ROOT, file))
  return 'bytes_equal'
}
function runVitest (files) {
  let out = ''
  try {
    out = execFileSync('pnpm', ['exec', 'vitest', 'run', ...files], { cwd: DESKTOP, encoding: 'utf8', maxBuffer: 1 << 26, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) { out = String((e.stdout || '') + (e.stderr || '')) }
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '')
  const failed = (clean.match(/^ FAIL .*$/gm) || []).map((l) => l.trim())
  // vitest 的汇总行长这样：`      Tests  1 failed | 18 passed (19)`（不是 node:test 的 `ℹ Tests`）
  const sum = /\n\s*Tests\s+([^\n]*)/.exec(clean)
  const tests = sum ? sum[1].trim() : '?'
  const pass = !!sum && !/failed/.test(sum[1]) && /\d+ passed/.test(sum[1])
  return { failed, tests, cleanPass: pass }
}
const namesOf = (failed) => [...new Set(failed.map((l) => l.replace(/^ FAIL\s+/, '').split(' > ')[0]))]

const cases = [
  {
    name: 'A 摘掉 IPC handler 透给引擎的时钟（半接线缝隙复发）',
    file: HANDLER, from: '      now: deps.now,\n', to: '', expect: 1,
    want: 'red', run: [IPC_NAME, CN_NAME], expectFiles: [IPC_NAME, CN_NAME],
    why: '本 PR 的运行时那一半：漏了它，窗口过滤读真实墙上时间，夹具红就是必然',
  },
  {
    name: 'B 摘掉 IPC 测试夹具的**全部**两处时钟注入',
    patches: [
      { file: IPC_TEST, from: '    now: () => NOW,\n', to: '', expect: 1 },
      { file: IPC_TEST, from: '      now: () => past,\n', to: '', expect: 1 },
    ],
    want: 'red', run: [LOCK_NAME], expectFiles: [LOCK_NAME],
    why: '结构锁真的在看守"驱动者必须注入"，不是恒绿。⚠ 必须一次摘两处：该文件在 #3459 之后有 2 处 '
      + 'now: () =>（我加的 makeDeps 与他们的"过去时钟行为锁"），只摘一处时文件级判据照旧通过 —— '
      + '这不是电池写错，而是**文件级判据的盲区被并发合并当场演示了一次**（原 B 条只摘一处就静默不再测任何东西）。'
      + '调用点级的行为锁（他们那条）与接缝锁（本锁第 ⑤ 条）才是兜得住这一类的两层。',
  },
  {
    name: 'C 摘掉引擎测试里唯一那处时钟注入（换第二个驱动者）',
    file: ENGINE_TEST, from: 'createQuickCollectEngine({ now: () => NOW, ...deps })', to: 'createQuickCollectEngine({ ...deps }) // MUT-C', expect: 1,
    want: 'red', run: [LOCK_NAME], expectFiles: [LOCK_NAME],
    why: '锁不是给某一个文件立的纪念碑',
  },
  {
    name: 'D 把驱动者判据改成永不匹配（锁空转）',
    file: LOCK, from: 'const DRIVES_CLOCK = /createQuickCollectEngine|createFeedTrendFetcher|import\\(([\'"])(?!@)[^\'"]*\\/quick-collect\\1\\)/',
    to: 'const DRIVES_CLOCK = /__NEVER_MATCH__/ // MUT-D', expect: 1,
    want: 'red', run: [LOCK_NAME], expectFiles: [LOCK_NAME],
    why: '解析退化成空集合时，域非空 + 驱动者下界必须当场红',
  },
  {
    name: 'E 把违规判据改成恒不成立（装饰性门禁）',
    file: LOCK, from: '    .filter((e) => DRIVES_CLOCK.test(e.src) && ABS_FIXTURE.test(e.src) && !CLOCK_PROVIDER.test(e.src))',
    to: '    .filter(() => false) // MUT-E', expect: 1,
    want: 'red', run: [LOCK_NAME], expectFiles: [LOCK_NAME],
    why: '真实域那条 toEqual([]) 对"恒不成立"是瞎的，必须由合成夹具抓住',
  },
  {
    name: 'F 只把夹具的绝对时刻挪一天（合规编辑）',
    file: IPC_TEST, from: "const NOW = Date.parse('2026-10-11T04:00:00.000Z')",
    to: "const NOW = Date.parse('2026-10-12T04:00:00.000Z')", expect: 1,
    want: 'green', run: [IPC_NAME, LOCK_NAME], expectFiles: [],
    why: '反向边界：本锁禁的是"夹具与判据不同源"，不是"不许换日期"',
  },
  {
    name: 'G 把渲染端 import 也算成驱动者（去掉 (?!@) 负向预查）',
    file: LOCK, from: 'const DRIVES_CLOCK = /createQuickCollectEngine|createFeedTrendFetcher|import\\(([\'"])(?!@)[^\'"]*\\/quick-collect\\1\\)/',
    to: 'const DRIVES_CLOCK = /createQuickCollectEngine|createFeedTrendFetcher|import\\(([\'"])[^\'"]*\\/quick-collect\\1\\)/ // MUT-G', expect: 1,
    want: 'red', run: [LOCK_NAME], expectFiles: [LOCK_NAME],
    why: '渲染端 `@/api/quick-collect` 是 invokeWithFallback 桥接层，不读主进程时钟；把它算成驱动者就会拿"必须注入"去要求一份无法有意义注入的文件（QM-6 可维护性轴 MAJOR#2）',
  },
  {
    name: 'H 绝对时刻判据退回只认 Date.parse 的窄形状',
    file: LOCK, from: 'const ABS_FIXTURE = /Date\\.(?:parse|UTC)\\s*\\(\\s*[\'"]?20\\d|new Date\\(\\s*[\'"]20\\d|20\\d{2}-\\d{2}-\\d{2}|[A-Z][a-z]{2}\\s+20\\d{2}\\s+\\d{2}:\\d{2}/',
    to: 'const ABS_FIXTURE = /Date\\.parse\\(\'20/ // MUT-H', expect: 1,
    want: 'red', run: [LOCK_NAME], expectFiles: [LOCK_NAME],
    why: '事故夹具本身就是 RFC-822 pubDate；只认 Date.parse 时，合理清理成 Date.UTC 或只有 pubDate 的新驱动文件都静默逃逸（QM-6 MAJOR#1）',
  },
  {
    name: 'I 把调用点窗口从 800 收到 60 字符',
    file: LOCK, from: '      const window = src.slice(at, at + 800)',
    to: '      const window = src.slice(at, at + 60) // MUT-I', expect: 1,
    want: 'red', run: [LOCK_NAME], expectFiles: [LOCK_NAME],
    why: '实测两处偏移 246 / 53 —— 窗口一收，引擎那处的 now 就落到窗外，判据第 4 条必须红（证明余量在测东西，不是随手写的数）',
  },
  {
    name: 'J 摘掉 feed 抓取器那处 now（第二处调用点）',
    file: HANDLER, from: 'const feedFn = createFeedTrendFetcher({ fetchFn: deps.fetchFn, log, now: deps.now })',
    to: 'const feedFn = createFeedTrendFetcher({ fetchFn: deps.fetchFn, log }) // MUT-J', expect: 1,
    want: 'red', run: [LOCK_NAME], expectFiles: [LOCK_NAME],
    why: '第 4 条守两处调用点，摘任一处都要红；否则"两处"只是注释里的说法',
  },
]

// ── 启动自检：每条 case 必须自带 run，want=red 的 run 集必须覆盖 expectFiles ──
/** 单补丁与新写的多补丁统一成 patches[] */
const patchesOf = (c) => c.patches || [{ file: c.file, from: c.from, to: c.to, expect: c.expect }]
for (const c of cases) {
  if (!Array.isArray(c.run) || c.run.length === 0) throw new Error('CASE_MISSING_RUN: ' + c.name)
  if (c.want === 'red' && c.expectFiles.some((f) => !c.run.includes(f))) throw new Error('CASE_RUN_NOT_COVER_EXPECT: ' + c.name)
  for (const p of patchesOf(c)) if (!p.file || !p.from) throw new Error('CASE_MISSING_PATCH: ' + c.name)
}

// ── 开工前残留检查：被触文件里不许有 MUT-* 记号（上一轮被杀留下的现场就是这种东西）。
//    这里**不**要求工作树干净——本电池的被测对象就是未提交的改动，要求干净等于要求自己先提交。
const touched = [...new Set(cases.flatMap((c) => patchesOf(c).map((p) => path.relative(ROOT, p.file).split(path.sep).join('/'))))]
const residue = touched.filter((f) => /MUT-[A-Z]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
if (residue.length) throw new Error('PREFLIGHT_RESIDUE（这些文件里还有变异记号，先从 HEAD 精确还原再跑）: ' + residue.join(', '))
console.log('PREFLIGHT_NO_RESIDUE files=' + touched.length + ' status=[' +
  execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', ...touched], { encoding: 'utf8' }).trim().replace(/\r?\n/g, ' | ') + ']')

console.log('# qcclock 变异反证原件')
console.log('# head=' + execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
console.log('# collectedAt=' + new Date().toISOString() + ' cases=' + cases.length)

let bad = 0
for (const c of cases) {
  console.log('\n== ' + c.name)
  const backups = []
  try {
    for (const p of patchesOf(c)) backups.push({ file: p.file, bytes: patch(p.file, p.from, p.to, p.expect) })
  } catch (e) {
    for (const b of backups.reverse()) console.log('   restored=' + restore(b.file, b.bytes))
    console.log('   ABORTED ' + e.message)
    bad++
    continue
  }
  try {
    const r = runVitest(c.run)
    const got = namesOf(r.failed)
    if (c.want === 'red') {
      const missing = c.expectFiles.filter((f) => !got.some((g) => g.endsWith(f)))
      const extras = got.filter((g) => !c.expectFiles.some((f) => g.endsWith(f)))
      const ok = got.length > 0 && missing.length === 0
      console.log('   want=red 点名红=' + ok + ' fail=[' + (got.join(' , ') || 'NONE') + ']' +
        (missing.length ? ' MISSING:[' + missing.join(',') + ']' : '') + (extras.length ? ' EXTRAS:[' + extras.join(',') + ']' : ''))
      if (!ok) bad++
    } else {
      const ok = got.length === 0
      console.log('   want=green 对照绿=' + ok + ' fail=[' + (got.join(' , ') || '0') + ']')
      if (!ok) bad++
    }
    console.log('   tests=' + r.tests)
  } finally {
    for (const b of backups.slice().reverse()) console.log('   restored=' + restore(b.file, b.bytes))
  }
}

const fin = runVitest([IPC_NAME, CN_NAME, LOCK_NAME])
const finOk = fin.tests !== '?' && fin.cleanPass && fin.failed.length === 0
console.log('\n== FINAL（还原后复跑）')
console.log('   tests=' + fin.tests + ' fail=[' + (namesOf(fin.failed).join(' , ') || '0') + '] ⇒ ' + (finOk ? 'OK' : 'SUITE_DID_NOT_RUN'))
if (!finOk) bad++
console.log('\nMUTATION_BAD=' + bad)
process.exit(bad ? 1 : 0)
