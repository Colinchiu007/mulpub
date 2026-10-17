// 回归锁：scripts/lib/merge-ledger.js —— 合并账本与记录归属的唯一取源。
//
// 为什么这条锁值得存在：远程同步的收口判定从「读人写的断言」改成「读 git 现场」，
// 一旦这个解析本身错了，错的是**所有**记录的收口结论；而它的失败形态大多静默
// （路径被引号转义 → 键对不上 → 该记录永远派生不出；重命名被检测 → 归属指错提交）。
// 每条用例都对应 design.md 里一条实测过的行为，不是凭空构造。
//
// 跑法（与 CI 同）：node --test scripts/lib/merge-ledger.test.js

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { buildLedger, classifyAttribution, LEDGER_UNAVAILABLE } = require('./merge-ledger.js')

// ── 夹具：每个用例一个独立临时仓库，隔离到 os.tmpdir + PID + 随机 ──
function makeRepo(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mp-ml-${name}-${process.pid}-`))
  const git = (args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
    { cwd: root, encoding: 'utf8' })
  git(['init', '-q'])
  return { root, git, write(rel, text) {
    const p = path.join(root, rel.replace(/\//g, path.sep))
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text)
  }, commit(msg) {
    git(['add', '-A'])
    git(['commit', '-q', '-m', msg])
  } }
}

const RECORDS = 'openspec/records'

test('合并账本只认行尾 (#NNNN) 尾注，同一标题里靠前的编号不算', () => {
  const r = makeRepo('footer')
  r.write(`${RECORDS}/a.md`, '| 远程同步 | PENDING |\n')
  // %s 只取标题行，所以"中段编号"必须写在同一行里才测得到：只有最末尾那个算尾注
  r.commit('docs: fix (#999) then ship (#101)')
  r.write(`${RECORDS}/b.md`, '| 远程同步 | PENDING |\n')
  r.commit('docs: b (#102)')

  const led = buildLedger({ baseRef: 'HEAD', cwd: r.root })
  assert.equal(led.ok, true)
  assert.equal(led.mergedPrs.has(101), true, '行尾的 (#101) 必须入账')
  assert.equal(led.mergedPrs.has(999), false, '同一标题里靠前的 (#999) 不是尾注，绝不能进账本')
  assert.equal(led.mergedPrs.get(102).sha.length, 40)
  assert.match(led.mergedPrs.get(102).iso, /^\d{4}-\d{2}-\d{2}T/)
})

test('归属映射取最近一次新增（newest-wins），删后重新加入归给重加那次', () => {
  const r = makeRepo('newest')
  r.write(`${RECORDS}/beta.md`, 'v1\n')
  r.commit('docs: add beta (#102)')
  fs.rmSync(path.join(r.root, RECORDS, 'beta.md'))
  r.commit('chore: drop beta (#104)')
  r.write(`${RECORDS}/beta.md`, 'v2\n')
  r.commit('feat: bring beta back (#105)')

  const led = buildLedger({ baseRef: 'HEAD', cwd: r.root })
  assert.equal(led.addedBy.get(`${RECORDS}/beta.md`), 105,
    'main 上现存的这份内容来自最近那次新增；取首次会把交付归给一个已被删除过的提交')
})

test('改名会把归属重指到改名那次提交（--no-renames 实测语义，禁止写反）', () => {
  const r = makeRepo('rename')
  r.write(`${RECORDS}/alpha.md`, 'x\n')
  r.commit('docs: alpha (#100)')
  r.git(['mv', `${RECORDS}/alpha.md`, `${RECORDS}/delta.md`])
  r.commit('docs: rename to delta (#200)')

  const led = buildLedger({ baseRef: 'HEAD', cwd: r.root })
  assert.equal(led.addedBy.get(`${RECORDS}/delta.md`), 200,
    '临时仓库实测：--no-renames 下新路径会带着改名提交的 A 出现，归属=200 而非 100')
  // 旧路径**不是**"只剩 D"：它当初的创建提交仍是一次 A，所以仍在映射里。
  // 判据只查询门禁域里实际存在的文件，alpha.md 早已不在工作树 ⇒ 这条残留永不被读到。
  // 断言它仍在，是为了钉住"NOT_IN_BASE 的唯一真实来源是本次变更集新增"这一设计口径
  // （design D3 原文把改名旧路径也列进 NOT_IN_BASE，属事实错误，已订正）。
  assert.equal(led.addedBy.get(`${RECORDS}/alpha.md`), 100)
  assert.equal(classifyAttribution(led, `${RECORDS}/ghost.md`).state, 'NOT_IN_BASE',
    '从未作为新增出现过的路径才是 NOT_IN_BASE')
})

test('非 ASCII 路径必须解析成字面键（core.quotepath=off 的行为锁）', () => {
  const r = makeRepo('unicode')
  const rel = `${RECORDS}/远程同步-锁定.md`
  r.write(rel, '| 远程同步 | PENDING |\n')
  r.commit('docs: 中文记录名 (#107)')

  const led = buildLedger({ baseRef: 'HEAD', cwd: r.root })
  assert.equal(led.addedBy.get(rel), 107,
    'quotepath 开着时 git 会把路径输出成带引号的转义串，键就对不上了——这条是静默失效')
})

test('归属三态各有定义，不得塌成两态', () => {
  const r = makeRepo('states')
  r.write(`${RECORDS}/hasfooter.md`, '1\n')
  r.commit('docs: has (#300)')
  r.write(`${RECORDS}/nofooter.md`, '1\n')
  r.commit('docs: no footer here')   // 有 A 记录但没有尾注

  const led = buildLedger({ baseRef: 'HEAD', cwd: r.root })
  assert.deepEqual(classifyAttribution(led, `${RECORDS}/hasfooter.md`),
    { state: 'PR', pr: 300, merged: true })
  assert.deepEqual(classifyAttribution(led, `${RECORDS}/nofooter.md`),
    { state: 'NO_FOOTER', pr: null, merged: false })
  assert.deepEqual(classifyAttribution(led, `${RECORDS}/ghost.md`),
    { state: 'NOT_IN_BASE', pr: null, merged: false })
})

test('PR 解析出来了但不在账本 = 取证不一致，merged 必须为 false 且不得算不可用', () => {
  const r = makeRepo('inconsistent')
  r.write(`${RECORDS}/a.md`, '1\n')
  r.commit('docs: a (#404)')
  // 以 a.md 所在提交之后的另一个 rev 为 base：a 的归属提交仍被 --diff-filter=A 看到，
  // 但账本按同一 baseRef 构造，二者必须同源 ⇒ 这里用"只取部分历史"的方式制造不一致
  const led = buildLedger({ baseRef: 'HEAD', cwd: r.root })
  assert.equal(led.ok, true)
  assert.equal(led.mergedPrs.has(404), true, '同源构造时 404 必然在账本里（本条先固定前提）')
  const forged = { ok: true, mergedPrs: new Map(), addedBy: led.addedBy }
  assert.equal(classifyAttribution(forged, `${RECORDS}/a.md`).merged, false,
    '归属有 PR 号而账本无此项时必须报 merged=false，交由判据走断言通道并出声')
})

test('三种取不到读数各自出声，且绝不返回空 Map 冒充"没有已合并 PR"', () => {
  const r = makeRepo('unavailable')
  r.write(`${RECORDS}/a.md`, '1\n')
  r.commit('docs: a (#500)')

  const badRef = buildLedger({ baseRef: 'nope/nope', cwd: r.root })
  assert.equal(badRef.ok, false)
  assert.equal(badRef.reason, LEDGER_UNAVAILABLE.refUnresolvable)

  const noRepo = buildLedger({ baseRef: 'HEAD', cwd: os.tmpdir() })
  assert.equal(noRepo.ok, false)
  assert.equal(noRepo.reason, LEDGER_UNAVAILABLE.gitFailed,
    '不是仓库时 git 会非零退出，必须被捕获成 gitFailed 而不是冒泡成栈')

  // 可解析的 ref + 一个带尾注的提交都没有 ⇒ 空账本必须报不可用（否则判据静默退化成装饰）
  const empty = makeRepo('emptyhist')
  fs.writeFileSync(path.join(empty.root, 'README.md'), 'x\n')
  empty.git(['add', '-A'])
  empty.git(['commit', '-q', '-m', 'chore: bootstrap'])   // 刻意不带 (#NNNN)
  const orphan = buildLedger({ baseRef: 'HEAD', cwd: empty.root })
  assert.equal(orphan.ok, false)
  assert.equal(orphan.reason, LEDGER_UNAVAILABLE.emptyLedger)
})

test('同一尾注重复出现要计数并且只留最近一次（不静默择一）', () => {
  const r = makeRepo('dup')
  r.write(`${RECORDS}/x.md`, '1\n')
  r.commit('docs: x (#600)')
  r.write(`${RECORDS}/y.md`, '1\n')
  r.commit('docs: y (#600)')

  const led = buildLedger({ baseRef: 'HEAD', cwd: r.root })
  assert.equal(led.stats.dupFooters, 1, '同尾注第二次出现必须被记下来')
  assert.equal(led.mergedPrs.get(600).sha.length, 40)
  assert.equal(led.addedBy.get(`${RECORDS}/y.md`), 600)
  assert.equal(led.addedBy.get(`${RECORDS}/x.md`), 600)
})

test('共享实现内禁止自建目录枚举（文件集合由调用方决定）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'merge-ledger.js'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')      // 注释里的字样不算命中
    .replace(/^\s*\*.*$/gm, '')
  assert.equal(/readdirSync|ls-tree|globSync/.test(src), false,
    '一旦这个模块自己去枚举目录，就会与 check-gate-record-debt.js 的 listRecordFiles 出现两份口径；'
    + '实测教训：自建过滤会把 _exempt/ 读进门禁域，使"缺行即红"被绕过')
})

// ── 真仓规模下界：判据本体不许在这仓里退化成"扫不到东西所以零问题" ──
test('真仓 origin/main 上账本与归属都读出非零规模（下界断言，不焊死某次读数）', (t) => {
  const { execFileSync: g } = require('node:child_process')
  let root
  try {
    root = g('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    g('git', ['rev-parse', '--verify', 'origin/main'], { encoding: 'utf8' })
  } catch (e) {
    t.skip('取不到 origin/main：' + e.message)
    return
  }
  const led = buildLedger({ baseRef: 'origin/main', cwd: root })
  assert.equal(led.ok, true, `真仓账本必须可用：${led.reason}`)
  assert.ok(led.stats.mergedPrs >= 1500, `已合并 PR 下界 1500，实测 ${led.stats.mergedPrs}`)
  assert.ok(led.stats.addedRecordPaths >= 400,
    `openspec/records 下归属可解析的文件数下界 400，实测 ${led.stats.addedRecordPaths}`)
})
