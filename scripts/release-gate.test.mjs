import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseVersion, compareLevel, runGate, parseAggregateReading, AGGREGATE_READ_ARGS } from './release-gate.mjs'

const CHANGELOG_WITH = (ver, breaking = false) =>
  `# [未发布] 其他条目\n\n## [v${ver}] - 2026-09-14\n${breaking ? '\n### BREAKING CHANGE: 移除旧 IPC 接口\n' : '\n### feat: 正常功能\n'}`

// 聚合器干净读数：records 非 0（采集面活着）且 landed/learningsLanded 都是 0（台账已收口）。
// ⛔ 既有 9 条用例现在**必须**带上这个字段 —— 把"没取证"变成硬失败之后，
// 让 aggregate 可选就等于给这条门禁留一个静默的旁路（见 R1）。
const CLEAN = {
  status: 0,
  stdout: 'AGGREGATE records=10 missing=9 malformed=0 learningsShape=0 landed=0 learningsLanded=0 duprisk=0 mode=dry\n',
}
const withClean = (o) => ({ aggregate: CLEAN, ...o })

test('parseVersion 解析 v 前缀与裸版本', () => {
  assert.deepEqual(parseVersion('v0.1.0'), { major: 0, minor: 1, patch: 0, raw: '0.1.0' })
  assert.deepEqual(parseVersion('2.3.53'), { major: 2, minor: 3, patch: 53, raw: '2.3.53' })
  assert.equal(parseVersion('not-a-version'), null)
})

test('compareLevel 判定 bump 级别', () => {
  const t = parseVersion('0.2.0')
  assert.equal(compareLevel(t, parseVersion('0.1.0')), 'minor')
  assert.equal(compareLevel(parseVersion('0.1.1'), parseVersion('0.1.0')), 'patch')
  assert.equal(compareLevel(parseVersion('1.0.0'), parseVersion('0.9.9')), 'major')
  assert.equal(compareLevel(t, null), 'patch')
})

test('runGate 硬失败：tag 与 root 版本不一致（未 bump 就打 tag）', () => {
  const r = runGate(withClean({ rootVersion: '0.1.0', changelog: CHANGELOG_WITH('0.1.0'), tag: 'v0.2.0' }))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('版本号未更新')))
})

test('runGate 硬失败：CHANGELOG 未收口（缺少目标版本小节）', () => {
  const r = runGate(withClean({ rootVersion: '0.2.0', changelog: '# [未发布] 还没收口\n', tag: 'v0.2.0' }))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('CHANGELOG 未收口')))
})

test('runGate 硬失败：root 与 desktop 版本不一致', () => {
  const r = runGate(withClean({ rootVersion: '0.2.0', desktopVersion: '0.1.0', changelog: CHANGELOG_WITH('0.2.0'), tag: 'v0.2.0' }))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('版本不一致')))
})

test('runGate 通过：tag 与 root 一致且 CHANGELOG 已收口', () => {
  const r = runGate(withClean({ rootVersion: '0.2.0', desktopVersion: '0.2.0', changelog: CHANGELOG_WITH('0.2.0'), tag: 'v0.2.0' }))
  assert.equal(r.ok, true)
  assert.equal(r.errors.length, 0)
})

test('runGate 软警告：破坏性变更标记但本次为 patch 级', () => {
  const changelog =
    '## [v0.1.0] - 2026-09-13\n\n### feat: 旧功能\n\n' +
    '## [v0.1.1] - 2026-09-14\n\n### BREAKING CHANGE: 移除旧 IPC 接口\n'
  const r = runGate(withClean({ rootVersion: '0.1.1', desktopVersion: '0.1.1', changelog, tag: 'v0.1.1' }))
  assert.equal(r.ok, true) // 软警告不阻断
  assert.ok(r.warnings.some((w) => w.includes('破坏性变更')))
})

test('runGate 软警告不触发：破坏性变更但 bump 了 minor', () => {
  const changelog =
    '## [v0.1.0] - 2026-09-13\n\n### feat: 旧功能\n\n' +
    '## [v0.2.0] - 2026-09-14\n\n### BREAKING CHANGE: 重构发布管线\n'
  const r = runGate(withClean({ rootVersion: '0.2.0', desktopVersion: '0.2.0', changelog, tag: 'v0.2.0' }))
  assert.equal(r.ok, true)
  assert.equal(r.warnings.length, 0)
})

test('runGate 本地自检（无 tag）：仅校验 CHANGELOG 与一致性', () => {
  const pass = runGate(withClean({ rootVersion: '0.3.0', desktopVersion: '0.3.0', changelog: CHANGELOG_WITH('0.3.0') }))
  assert.equal(pass.ok, true)
  const fail = runGate(withClean({ rootVersion: '0.3.0', changelog: '# [未发布]\n' }))
  assert.equal(fail.ok, false)
})

// ═══════════════════════════════════════════════════════════════════
//  tasks 4.1：发版门禁在「版本小节校验之前」消费聚合器读数
//  三条文案必须可分辨：AGGREGATE_FAIL（聚合器/采集面坏了）／AGGREGATE_PENDING
//  （有 N 条待搬，给人一条可跑的命令）／CHANGELOG 未收口（原有语义，不变）。
//  合并成一句会让人去改 CHANGELOG 而不是修聚合器 —— 这正是本条用例存在的理由。
// ═══════════════════════════════════════════════════════════════════

const has = (r, code) => r.errors.filter((e) => e.includes(code))
const UNCLOSED = 'CHANGELOG 未收口'

test('R1 没取证就是硬失败：aggregate 缺席 ⇒ AGGREGATE_FAIL，且不得出现"未收口"', () => {
  const r = runGate({ rootVersion: '0.9.0', changelog: '# [未发布]\n', tag: 'v0.9.0' })
  assert.equal(r.ok, false)
  assert.equal(has(r, 'AGGREGATE_FAIL').length, 1, `缺席必须落一条 AGGREGATE_FAIL，实得：${JSON.stringify(r.errors)}`)
  assert.ok(!r.errors.some((e) => e.includes(UNCLOSED)), '拿不到聚合器读数时不得同时报"未收口"——那会把人支使去改 CHANGELOG')
})

test('R2 聚合器 rc≠0 ⇒ AGGREGATE_FAIL 并带上 rc 读数，且不得出现"未收口"', () => {
  const r = runGate({
    rootVersion: '0.9.0',
    changelog: '# [未发布]\n',
    tag: 'v0.9.0',
    aggregate: { status: 1, stdout: 'AGG_ARG: 未知或非法参数 --wrte\n' },
  })
  assert.equal(r.ok, false)
  const [e] = has(r, 'AGGREGATE_FAIL')
  assert.ok(e, JSON.stringify(r.errors))
  assert.match(e, /rc=1/)
  assert.ok(e.includes('AGG_ARG'), '红文案必须带上聚合器自己的输出摘要，否则无法归因')
  assert.ok(!r.errors.some((x) => x.includes(UNCLOSED)))
})

test('R3 聚合器 rc=0 但没有 AGGREGATE 首行 ⇒ 判"没跑到"，不得读成"无待搬"（探针失明）', () => {
  const r = runGate({
    rootVersion: '0.9.0',
    changelog: CHANGELOG_WITH('0.9.0'),
    tag: 'v0.9.0',
    aggregate: { status: 0, stdout: 'some warning\n\n' },
  })
  assert.equal(r.ok, false)
  assert.equal(has(r, 'AGGREGATE_FAIL').length, 1)
  assert.match(has(r, 'AGGREGATE_FAIL')[0], /首行/)
})

test('R4 records=0 是采集面退化，不等于"没有待搬条目" ⇒ AGGREGATE_FAIL', () => {
  const r = runGate({
    rootVersion: '0.9.0',
    changelog: CHANGELOG_WITH('0.9.0'),
    tag: 'v0.9.0',
    aggregate: { status: 0, stdout: 'AGGREGATE records=0 missing=0 malformed=0 landed=0 learningsLanded=0 mode=dry\n' },
  })
  assert.equal(r.ok, false)
  assert.equal(has(r, 'AGGREGATE_FAIL').length, 1)
  assert.match(has(r, 'AGGREGATE_FAIL')[0], /records=0/)
})

test('R5 landed>0 ⇒ AGGREGATE_PENDING，文案逐字给出可跑的那条命令，且此时不报"未收口"', () => {
  const r = runGate({
    rootVersion: '0.9.0',
    changelog: '# [未发布] x\n',
    tag: 'v0.9.0',
    aggregate: { status: 0, stdout: 'AGGREGATE records=20 missing=18 malformed=0 landed=3 learningsLanded=0 mode=dry\n' },
  })
  assert.equal(r.ok, false)
  const [e] = has(r, 'AGGREGATE_PENDING')
  assert.ok(e, JSON.stringify(r.errors))
  assert.match(e, /3 条/)
  assert.ok(e.includes('node scripts/aggregate-changelog.js --write'), '欠账必须给出口：一条能直接跑的命令')
  assert.ok(!r.errors.some((x) => x.includes(UNCLOSED)), '台账本来就没写完，此时报"缺版本小节"是误导')
})

test('R6 learnings 那侧没搬完同样算待搬（landed=0 但 learningsLanded=2）', () => {
  const r = runGate({
    rootVersion: '0.9.0',
    changelog: CHANGELOG_WITH('0.9.0'),
    tag: 'v0.9.0',
    aggregate: { status: 0, stdout: 'AGGREGATE records=20 missing=18 landed=0 learningsLanded=2 mode=dry\n' },
  })
  assert.equal(r.ok, false)
  assert.equal(has(r, 'AGGREGATE_PENDING').length, 1)
  assert.match(has(r, 'AGGREGATE_PENDING')[0], /2 条/)
})

test('R7 读数干净时原有语义一字不变（回归对：缺版本小节 ⇒ 还是"CHANGELOG 未收口"）', () => {
  const r = runGate({ rootVersion: '0.9.0', changelog: '# [未发布] x\n', tag: 'v0.9.0', aggregate: CLEAN })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes(UNCLOSED)), JSON.stringify(r.errors))
  assert.equal(has(r, 'AGGREGATE_FAIL').length, 0)
  assert.equal(has(r, 'AGGREGATE_PENDING').length, 0)
})

test('R8 读数干净且已收口 ⇒ 通过（新增消费点不得把合法发版判红）', () => {
  const r = runGate({ rootVersion: '0.9.0', desktopVersion: '0.9.0', changelog: CHANGELOG_WITH('0.9.0'), tag: 'v0.9.0', aggregate: CLEAN })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
})

test('R9 参数面：landed 读不出数字一律按未证实处理，不得默认成 0', () => {
  const r = runGate({
    rootVersion: '0.9.0',
    changelog: CHANGELOG_WITH('0.9.0'),
    tag: 'v0.9.0',
    aggregate: { status: 0, stdout: 'AGGREGATE records=20 missing=18 landed=NaN learningsLanded= mode=dry\n' },
  })
  assert.equal(r.ok, false)
  assert.equal(has(r, 'AGGREGATE_FAIL').length, 1)
  // 纯函数侧的同一判据：parseAggregateReading 对缺键/非数字必须返回 null，不能返回 0
  assert.equal(parseAggregateReading('AGGREGATE records=20 malformed=1 mode=dry\n').ok, false)
  assert.equal(parseAggregateReading('AGGREGATE records=20 landed=3 learningsLanded=0 mode=dry\n').landed, 3)
})

// ── 真跑端到端：证明"聚合器真的被调用、且排在版本小节校验之前" ──
// 结构锁只能证明源码里那行字在，不能证明它被执行（本仓把这类锁记作装饰性门禁的第 N 种落点）。
// release-gate.mjs 的 ROOT 由自身位置向上两级求得 ⇒ 把它整份拷进 <夹具>/scripts/ 就能真跑 CLI。
function mkFixture ({ aggregateScript, changelog, version = '0.9.0' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-fixture-'))
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version }), 'utf8')
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog, 'utf8')
  fs.copyFileSync(
    path.resolve(fileURLToPath(import.meta.url), '..', 'release-gate.mjs'),
    path.join(dir, 'scripts', 'release-gate.mjs')
  )
  fs.writeFileSync(path.join(dir, 'scripts', 'aggregate-changelog.js'), aggregateScript, 'utf8')
  return dir
}
const runCli = (dir) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'release-gate.mjs'), '--tag', 'v0.9.0'], { encoding: 'utf8' })
// 调用痕迹落在**夹具自己目录里**（不在 tmp 上放固定名 —— 并发会话/并行 runner 会互相撞）。
// 痕迹记的是**实收 argv**，不只是"被调过"：那才能证明传的是 --dry-run 而不是顺手写成 --write。
const CALLED = 'called.txt'
const calledStub = (tail) =>
  `require('fs').writeFileSync(require('path').resolve(__dirname, '${CALLED}'), JSON.stringify(process.argv.slice(2)))\n${tail}`

test('R10 真跑：聚合器 exit 1 ⇒ CLI rc=1、stderr 有 AGGREGATE_FAIL、没有"未收口"，且聚合器确实被调用过', () => {
  const dir = mkFixture({
    changelog: '# [未发布] x\n',
    aggregateScript: calledStub("console.error('boom')\nprocess.exit(1)\n"),
  })
  const r = runCli(dir)
  assert.equal(r.status, 1)
  assert.ok(fs.existsSync(path.join(dir, 'scripts', CALLED)), '聚合器根本没被调用 ⇒ 接线不在执行路径上（字符串在源码里不算证据）')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'scripts', CALLED), 'utf8')), ['--dry-run'])
  assert.match(r.stderr, /AGGREGATE_FAIL/)
  assert.ok(!r.stderr.includes(UNCLOSED), `不得同时报"未收口"：\n${r.stderr}`)
})

test('R11 真跑：聚合器报 landed=3 ⇒ CLI 给 AGGREGATE_PENDING 与 --write 命令', () => {
  const dir = mkFixture({
    changelog: '# [未发布] x\n',
    aggregateScript: calledStub("console.log('AGGREGATE records=20 missing=18 malformed=0 landed=3 learningsLanded=0 duprisk=0 mode=dry')\n"),
  })
  const r = runCli(dir)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /AGGREGATE_PENDING/)
  assert.ok(r.stderr.includes('node scripts/aggregate-changelog.js --write'), r.stderr)
})

test('R12 真跑：读数干净 + CHANGELOG 已收口 ⇒ rc=0（新增消费点不得拦住合法发版）', () => {
  const dir = mkFixture({
    changelog: CHANGELOG_WITH('0.9.0'),
    aggregateScript: calledStub("console.log('AGGREGATE records=20 missing=18 malformed=0 landed=0 learningsLanded=0 duprisk=0 mode=dry')\n"),
  })
  const r = runCli(dir)
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.ok(fs.existsSync(path.join(dir, 'scripts', CALLED)))
})

test('R13 结构锁：发版校验只读聚合器，MUST NOT 自己写台账（写台账是发版动作，不是校验动作）', () => {
  // 真跑侧由 R10/R12 的实收 argv 守住；本条守的是**旗标清单本身**——
  // 把 '--write' 塞进这份清单会同时让 R10/R12 与本条变红，两条锁各测各的。
  assert.deepEqual(AGGREGATE_READ_ARGS, ['--dry-run'])
  assert.ok(!AGGREGATE_READ_ARGS.includes('--write'))
  const src = fs
    .readFileSync(path.resolve(fileURLToPath(import.meta.url), '..', 'release-gate.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.match(src, /--dry-run/, '调用聚合器必须显式声明只读取数')
})

test('R14 真跑：聚合器文件缺失 ⇒ fail-closed 到 AGGREGATE_FAIL，绝不静默放行（QM-6 i5 的处置锁）', () => {
  // 评审问的是"没检查文件存在会不会执行未知内容 / 静默通过"。取证答案是：node 自己以
  // rc=1 失败（Cannot find module），而 rc≠0 走的就是 AGGREGATE_FAIL 那一档 —— 本条把
  // 这个"已核实为安全"的格子钉住，否则下一个人改 spawn 错误处理时它就漂了。
  const dir = mkFixture({ changelog: CHANGELOG_WITH('0.9.0'), aggregateScript: '' })
  fs.unlinkSync(path.join(dir, 'scripts', 'aggregate-changelog.js'))
  const r = runCli(dir)
  assert.equal(r.status, 1, `聚合器缺失必须拦下发版：\n${r.stdout}${r.stderr}`)
  assert.match(r.stderr, /AGGREGATE_FAIL/)
  assert.ok(!r.stderr.includes(UNCLOSED), '取证不成时不得同时报"未收口"')
  assert.ok(!r.stderr.includes('✅'), '不得把"没跑到"读成"通过"')
})
