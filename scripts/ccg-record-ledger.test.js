'use strict';
/**
 * scripts/ccg-record-ledger.js（写入侧）的回归锁。
 * 跑法：node --test scripts/ccg-record-ledger.test.js
 * 接线：quality-gate.yml 的 changes 作业 Gate 2b4（与 lib 同步点名）。
 *
 * 分两类夹具，理由是内部评审点名过的两个假绿形态：
 *   - 纯逻辑（runLedger / shouldWriteLedger / nextLedgerFields / pickRecord）走注入 deps，不碰 gh/网络；
 *   - **shell→node 的参数契约必须用真子进程真仓库跑一次**（C1：13 条 JS 层变异全抓不到
 *     `--base <值>` 被解析成布尔 true 这个洞，因为洞在边界上，不在逻辑里）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const {
  runLedger, shouldWriteLedger, nextLedgerFields, pickRecord, parseArgs, ghRepoSlug,
  RECORD_DIFF_FLAGS, RECORD_PATHSPEC, branchCommitView, recordKeyAtCommit,
} = require('./ccg-record-ledger.js');
const lib = require('./lib/ccg-evidence-hash.js');

const SHA64 = 'ab'.repeat(32);
const BASE40 = 'cd'.repeat(20);
const HEAD40 = 'ef'.repeat(20);
const POSTED_URL = 'https://github.com/octo/repo/pull/7#issuecomment-5474171300';
const CLOSED_REC = { mode: 'dual', deepReview: { required: true, status: 'cleared', rounds: 3, critiqueFingerprint: 'f'.repeat(16) } };

function deps (over) {
  const calls = []
  const written = []
  const d = Object.assign({
    repo: '/tmp/whatever',
    baseLabel: 'origin/main',
    head: 'HEAD',
    log: (m) => calls.push('log:' + m),
    resolveRecord: () => ({ sha: 'e'.repeat(40), file: '.ccg/reviews/x.json', json: CLOSED_REC }),
    resolveBase: () => BASE40,
    resolveHead: () => HEAD40,
    payload: () => ({ sha: SHA64, bytes: 512 }),
    findPr: () => { calls.push('findPr'); return { number: 7, url: 'https://github.com/octo/repo/pull/7' } },
    postComment: () => { calls.push('post'); return { ok: true, url: POSTED_URL } },
    writeLedger: (f) => { calls.push('write'); written.push(f); return 5 },
  }, over || {})
  d.calls = calls
  d.written = written
  return d
}

// ───────── 资格与顺序 ─────────

test('W1：mode 不是 dual ⇒ 不落证据，且不得动台账（single/skip 没有外部裁决可落）', () => {
  const d = deps({ resolveRecord: () => ({ sha: 'x', file: '.ccg/reviews/x.json', json: { mode: 'single', deepReview: { required: true, status: 'cleared' } } }) })
  const r = runLedger(d)
  assert.strictEqual(r.why, 'not-applicable')
  assert.strictEqual(r.rc, 0, '不适用不是错误，不得把评审流程判红')
  assert.ok(!d.calls.includes('post') && !d.calls.includes('write'), JSON.stringify(d.calls))
})

test('W2：dual 但状态未闭环（pending / error）⇒ 绝不落证据 —— 落进去就是给自己发通过章', () => {
  for (const st of ['pending', 'error', 'blocked', 'self_play_pending']) {
    const d = deps({ resolveRecord: () => ({ sha: 'x', file: '.ccg/reviews/x.json', json: { mode: 'dual', deepReview: { required: true, status: st } } }) })
    const r = runLedger(d)
    assert.strictEqual(r.why, 'not-applicable', st + ' 必须不落')
    assert.ok(!d.calls.includes('write'), st + ' 却写了台账 ⇒ 假闭环')
  }
})

test('W3：空载荷（0 字节 / 等于空 diff 常量哈希）⇒ 不落', () => {
  for (const p of [{ sha: SHA64, bytes: 0 }, { sha: lib.EMPTY_DIFF_SHA256, bytes: 0 }]) {
    const d = deps({ payload: () => p })
    const r = runLedger(d)
    assert.strictEqual(r.rc, 2)
    assert.strictEqual(r.why, 'payload-empty-or-failed')
    assert.ok(!d.calls.includes('post'), '空载荷还去贴评论：' + JSON.stringify(d.calls))
  }
})

test('W4【核心顺序锁】：贴评论失败 ⇒ 一个字都不写台账（两种失败形态分开测）', () => {
  const a = deps({ postComment: () => ({ ok: false, err: 'gh: HTTP 403' }) })
  assert.strictEqual(runLedger(a).why, 'comment-failed')
  assert.deepStrictEqual(a.written, [])

  // ok=false 但带一个**形状完全合法**的 URL（gh 报错时 stdout 里确实可能有东西）。
  // 只测上一条会被下游 URL 形状校验顺带兜住 ⇒ 这条才证明 `if (!posted.ok)` 在承重。
  const b = deps({ postComment: () => ({ ok: false, err: 'gh: 502', url: POSTED_URL }) })
  assert.strictEqual(runLedger(b).why, 'comment-failed')
  assert.deepStrictEqual(b.written, [], '失败分支带上合法 URL 就放行 ⇒ 守卫成了装饰')
})

test('W5：gh 返回的 URL 不构成一条具体评论 ⇒ 不写字段（宁缺不假，禁止伪造 URL 顶上）', () => {
  for (const bad of ['Created comment on pull request octo/repo (#7)', 'https://github.com/octo/repo/pull/7', '']) {
    const d = deps({ postComment: () => ({ ok: true, url: bad }) })
    assert.strictEqual(runLedger(d).why, 'evidence-url-invalid', 'URL=`' + bad + '` 必须被拒')
    assert.deepStrictEqual(d.written, [])
  }
})

test('W6：本分支没有 open PR ⇒ 不落、出声说明后果', () => {
  const d = deps({ findPr: () => null })
  const r = runLedger(d)
  assert.strictEqual(r.rc, 1)
  assert.strictEqual(r.why, 'no-pr')
  assert.ok(!d.calls.includes('post') && !d.calls.includes('write'))
})

test('W7：成功路径必须写全 8 个台账字段，base/head 都是 40hex，且评论先于写字段', () => {
  const d = deps()
  assert.strictEqual(runLedger(d).rc, 0)
  const f = d.written[0]
  assert.strictEqual(f.ccg_payload_base, BASE40)
  assert.strictEqual(f.ccg_payload_head, HEAD40, 'head 侧也必须钉 sha —— 内部评审 I6：原先写死字面量 HEAD，下一次推送后范围就指向另一棵树')
  assert.strictEqual(f.ccg_evidence, POSTED_URL)
  assert.strictEqual(f.ccg_written_by, 'deep-review')
  assert.deepStrictEqual(Object.keys(f), lib.LEDGER_FIELDS)
  assert.deepStrictEqual(d.calls.filter(c => c === 'post' || c === 'write'), ['post', 'write'])
})

test('W8：--dry-run 不贴不写，但把 base/head/载荷三个数打出来', () => {
  const d = deps({ dryRun: true })
  const r = runLedger(d)
  assert.strictEqual(r.why, 'dry-run')
  assert.ok(!d.calls.includes('post') && !d.calls.includes('write'))
  assert.strictEqual(r.baseSha, BASE40)
  assert.strictEqual(r.headSha, HEAD40)
})

test('W9：head 解析失败 ⇒ 不落（宁可没有锚，也不要一个范围不明的锚）', () => {
  const d = deps({ resolveHead: () => { throw new Error('empty repo') } })
  assert.strictEqual(runLedger(d).why, 'head-unresolvable')
  assert.deepStrictEqual(d.written, [])
})

test('W10：shouldWriteLedger 对 required 不为 true 的记录不落', () => {
  assert.strictEqual(shouldWriteLedger({ mode: 'dual', deepReview: { required: false, status: 'cleared' } }).ok, false)
  assert.strictEqual(shouldWriteLedger({ mode: 'dual' }).ok, false)
  assert.strictEqual(shouldWriteLedger(null).ok, false)
  assert.strictEqual(shouldWriteLedger(CLOSED_REC).ok, true)
})

test('W11：nextLedgerFields 与 lib 的清单双向对账；ref 名 / 裸 PR URL 都抛', () => {
  const ok = { status: 'cleared', rounds: 3, payloadSha: SHA64, baseSha: BASE40, headSha: HEAD40, evidenceUrl: POSTED_URL, mode: 'dual' }
  assert.doesNotThrow(() => nextLedgerFields(ok))
  assert.throws(() => nextLedgerFields({ ...ok, baseSha: 'origin/main' }), /不得写 ref 名/)
  assert.throws(() => nextLedgerFields({ ...ok, headSha: 'HEAD' }), /不得写 ref 名/)
  assert.throws(() => nextLedgerFields({ ...ok, evidenceUrl: 'https://github.com/o/r/pull/7' }), /具体 PR 评论/)
  lib.LEDGER_FIELDS.push('ccg_tmp_extra')
  try { assert.throws(() => nextLedgerFields(ok), /不一致/) } finally { lib.LEDGER_FIELDS.pop() }
})

// ───────── 寻址（含「别借用陌生裁决」）─────────

/** 寻址单测夹具：只喂 commits 清单（真实仓库形态由 §7-T1…T4 用真判定器覆盖，这里不重复） */
function addrFixture () {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-addr-'))
  fs.mkdirSync(path.join(repo, '.ccg', 'reviews'), { recursive: true })
  const head = 'a'.repeat(40), parent = 'b'.repeat(40), start = 'c'.repeat(40)
  const KEY = 'd'.repeat(64)
  const write = (name, obj) => fs.writeFileSync(path.join(repo, '.ccg', 'reviews', name), JSON.stringify(obj), 'utf8')
  const wipe = () => { for (const f of fs.readdirSync(path.join(repo, '.ccg', 'reviews'))) fs.rmSync(path.join(repo, '.ccg', 'reviews', f), { force: true }) }
  return { repo, head, parent, start, KEY, write, wipe }
}

test('W12：一个提交三种取名各有命中；内容键名优先；非 40hex 不进候选', () => {
  const f = addrFixture()
  try {
    const P = (commits) => pickRecord({ repo: f.repo, commits })

    f.write(f.KEY + '.json', { sha: f.parent, mode: 'dual', stagedDiffHash: f.KEY })
    const h1 = P([{ sha: f.head, parent: f.parent, key: f.KEY }])
    assert.strictEqual(h1.file, '.ccg/reviews/' + f.KEY + '.json', '内容键名必须命中（这是 pre-commit 全量 add 的常态）')
    assert.strictEqual(h1.sha, f.parent, '内容键名那份记录的所有者是父提交（pre-commit 时的 HEAD）')

    f.wipe(); f.write(f.head + '.json', { sha: f.head, mode: 'skip' })
    assert.strictEqual(P([{ sha: f.head, parent: f.parent, key: '' }]).sha, f.head, '手工在提交后跑判定器的形态要认')

    f.wipe(); f.write(f.parent + '.json', { sha: f.parent, mode: 'dual' })
    assert.strictEqual(P([{ sha: f.head, parent: f.parent, key: '' }]).sha, f.parent, '空 diff 的回落名要认')

    // 优先级：三种名同时在场时取内容键那一份 —— 它是唯一「由本次变更内容决定」的凭据
    f.wipe()
    f.write(f.head + '.json', { sha: f.head, mode: 'skip' })
    f.write(f.parent + '.json', { sha: f.parent, mode: 'single' })
    f.write(f.KEY + '.json', { sha: f.parent, mode: 'dual', stagedDiffHash: f.KEY })
    assert.strictEqual(P([{ sha: f.head, parent: f.parent, key: f.KEY }]).json.mode, 'dual', '内容键名优先于两种 sha 名')

    // parentInSet 的两条支路各测一次（只测一边，另一边就是没牙的装饰分支）
    f.wipe(); f.write(f.parent + '.json', { sha: f.parent, mode: 'dual' })
    const alone = P([{ sha: f.head, parent: f.parent, key: f.KEY }])
    assert.strictEqual(alone.file, null, '本次有真实变更（key 非空）而父提交不在自有集合内 ⇒ <parent>.json 不得采纳')
    const two = P([{ sha: f.head, parent: f.parent, key: f.KEY }, { sha: f.parent, parent: f.start, key: '' }])
    assert.strictEqual(two.file, '.ccg/reviews/' + f.parent + '.json',
      '同一份记录，父提交本身是自有提交时应当采纳 —— 它要么是本提交的改名前记录，要么是同分支上一条，两者都属本 PR')
    assert.deepStrictEqual(two.tried, ['.ccg/reviews/' + f.parent + '.json'], 'tried 要如实列出探到过的文件：' + JSON.stringify(two.tried))

    f.wipe()
    const none = P([{ sha: f.head, parent: f.parent, key: f.KEY }])
    assert.strictEqual(none.file, null)
    assert.deepStrictEqual(none.tried, [], '一条都没探到时 tried 必须是空数组（与「探到但读坏了」可区分）')
    assert.strictEqual(P([{ sha: 'HEAD', parent: '', key: '' }]).file, null, '非 40hex 的 sha 不得被拼进路径当候选')
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }) }
})

test('W13【归属核对】：自报 sha 不符或 stagedDiffHash 核不上 ⇒ 宁缺不借；相符时确实采用（正控）', () => {
  // 现场依据：34 个 worktree 共享一份对象库，sha 名那条记录完全可能属于别的提交。
  // 内容寻址消掉了「按名字猜归属」这一格，但 <c>.json / <parent>.json 两种回落名仍只有
  // sha 一条凭据，所以那两条必须逐字核对 —— 缺字段不等于放行。
  const f = addrFixture()
  try {
    const P = (commits) => pickRecord({ repo: f.repo, commits })

    f.write(f.parent + '.json', { sha: 'e'.repeat(40), mode: 'dual' })
    const a = P([{ sha: f.head, parent: f.parent, key: '' }])
    assert.strictEqual(a.file, null, '所有者不符 ⇒ 不得借用')
    assert.strictEqual(a.skippedForeign, true)
    assert.match(a.why, /记录自报 sha/, '理由必须点名是哪一维不符：' + a.why)

    f.wipe(); f.write(f.head + '.json', { mode: 'dual' })
    const noClaim = P([{ sha: f.head, parent: f.parent, key: '' }])
    assert.strictEqual(noClaim.file, null, 'sha 名探针而记录没自报 sha ⇒ 不借（缺证据不等于放行）')
    assert.match(noClaim.why, /记录自报 sha=\(缺失\)/, noClaim.why)

    f.wipe(); f.write(f.KEY + '.json', { sha: f.parent, mode: 'dual', stagedDiffHash: '9'.repeat(64) })
    const b = P([{ sha: f.head, parent: f.parent, key: f.KEY }])
    assert.strictEqual(b.file, null, '记录里的键与本次实算不符 ⇒ 那份描述的是另一个变更集')
    assert.match(b.why, /stagedDiffHash/, b.why)

    f.wipe(); f.write(f.KEY + '.json', { sha: f.parent, mode: 'dual', stagedDiffHash: f.KEY })
    assert.strictEqual(P([{ sha: f.head, parent: f.parent, key: f.KEY }]).file, '.ccg/reviews/' + f.KEY + '.json',
      '正控：归属与键都相符时必须采用（否则上面三条是「恒不借」的假锁）')

    f.wipe(); f.write(f.KEY + '.json', { mode: 'dual' })
    assert.strictEqual(P([{ sha: f.head, parent: f.parent, key: f.KEY }]).file, '.ccg/reviews/' + f.KEY + '.json',
      '内容键名那份即便没自报 sha 也可采用 —— 名字本身就是凭据（首提交无父可对齐）')
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }) }
})

test('W14：损坏的判定记录不得抛穿，且要被记进 tried（与「根本没探到」可区分）', () => {
  const f = addrFixture()
  try {
    // 内容键名那一份是**合法 JSON 但不是对象** —— 只有形状守卫能挡住它（byKey 探针不核对自报 sha，
    // 因为名字本身就是凭据）。父名那一份是真·损坏字节，走的是 parse 抛错那一条路。
    fs.writeFileSync(path.join(f.repo, '.ccg', 'reviews', f.KEY + '.json'), '"只是一串合法 JSON 文本"', 'utf8')
    fs.writeFileSync(path.join(f.repo, '.ccg', 'reviews', f.head + '.json'), '{ 不是 JSON', 'utf8')
    const commits = [{ sha: f.head, parent: f.parent, key: f.KEY }]
    assert.doesNotThrow(() => pickRecord({ repo: f.repo, commits }),
      'JSON.parse 抛穿会让 runLedger/main 崩栈，违背「失败只出声」')
    const r = pickRecord({ repo: f.repo, commits })
    assert.strictEqual(r.file, null)
    assert.deepStrictEqual(r.tried, ['.ccg/reviews/' + f.KEY + '.json', '.ccg/reviews/' + f.head + '.json'],
      '探到过但读坏了/不是对象的，都要留在 tried 里（与「根本没探到文件」可区分）：' + JSON.stringify(r.tried))
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }) }
})

test('W15：parseArgs 必须同时吃 `--k=v` 与 `--k v`（真实调用方用的是空格形）', () => {
  assert.deepStrictEqual(parseArgs(['--base', 'origin/main', '--dry-run']), { base: 'origin/main', 'dry-run': true })
  assert.deepStrictEqual(parseArgs(['--base=origin/main']), { base: 'origin/main' })
  assert.strictEqual(parseArgs(['--base'])['base'], true, '旗标后面没值 ⇒ 才是 true')
  assert.strictEqual(parseArgs(['--no-color', '--base', 'x'])['no-color'], true)
  assert.strictEqual(parseArgs(['--base', 'x'])['base'], 'x')
})

test('W16【真进程 + 真仓库】：按 deep-review.sh 的真实 argv 跑一次收口，base 必须被解析成 sha（不得读成布尔 true）', () => {
  // 为什么必须有这条：C1 那个洞（`--base "$X"` 空格形被只认 `--k=v` 的解析器读成 true）
  // 在 13 条 JS 层变异下**全部逃过** —— 洞在 shell→node 边界，不在逻辑里。
  // 所以锁必须真起一个子进程、用真 argv、在真 git 仓库里跑。
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-argv-'))
  const git = (a) => cp.execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git(['init', '-q', '-b', 'main', '.'])
    git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't'])
    fs.mkdirSync(path.join(repo, 'openspec/records'), { recursive: true })
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'src/a.js'), 'export const a = 1\n')
    fs.writeFileSync(path.join(repo, 'openspec/records/main.md'), '---\nrecord: main\n---\n\n正文\n')
    git(['add', '-A']); git(['commit', '-q', '-m', 'base'])
    fs.writeFileSync(path.join(repo, 'src/a.js'), 'export const a = 2\n')
    git(['add', '-A']); git(['commit', '-q', '-m', 'c1'])
    const CLI = path.join(__dirname, 'ccg-record-ledger.js')
    for (const argv of [['--dry-run', '--base', 'main'], ['--dry-run', '--base=main']]) {
      const r = cp.spawnSync(process.execPath, [CLI, '--repo', repo].concat(argv), { cwd: repo, encoding: 'utf8' })
      const out = String(r.stdout || '') + String(r.stderr || '')
      assert.ok(!/base 解析失败/.test(out), JSON.stringify(argv) + ' 两种写法都必须能解析 base：' + out)
      assert.notStrictEqual(r.status, 2, 'rc=2 意味着 base 没解析出来：' + out)
    }
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('W17：deep-review.sh 必须以 `--base=` 等号形调用收口（结构锁，与 W15 行为锁配对）', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'scripts', 'deep-review.sh'), 'utf8')
  assert.match(sh, /node scripts\/ccg-record-ledger\.js --base=/,
    '空格形 `--base "$X"` 会被只认 `--k=v` 的解析器读成布尔 true ⇒ 收口在生产路径上永不落锚（内部评审 C1 实测 rc=2）')
  assert.doesNotMatch(sh, /ccg-record-ledger\.js --base "\$/, '不得再出现空格形取值写法')
})

test('W19：借用被拒时的文案必须与「没找到记录」区分开（两者补救动作不同）', () => {
  const d = deps({ resolveRecord: () => ({ sha: 'c'.repeat(40), file: null, json: null, skippedForeign: true, why: 'stagedDiffHash 与本次不符' }) })
  const r = runLedger(d)
  assert.strictEqual(r.why, 'record-not-provable-here', '必须是「不同源」这一档：' + JSON.stringify(r))
  assert.ok(!d.calls.some(c => /先提交一次/.test(c)), '不得让用户去「重新提交」—— 记录存在，只是不属于本次：' + JSON.stringify(d.calls))
  assert.ok(d.calls.some(c => /借用|不同源/.test(c)), '文案必须说清是拒绝借用：' + JSON.stringify(d.calls))

  const e = deps({ resolveRecord: () => ({ sha: '', file: null, json: null, tried: [] }) })
  assert.strictEqual(runLedger(e).why, 'no-record', '真的没有记录才是另一档（两档不得合并成一句）')
})

test('W18：ghRepoSlug 只从 remote 取 owner/repo（不从子进程输出反推）', () => {
  assert.strictEqual(ghRepoSlug({ repo: ROOT }), 'Colinchiu007/mulpub', '本仓 remote 解析必须可用：' + ghRepoSlug({ repo: ROOT }))
  assert.strictEqual(ghRepoSlug({ repo: os.tmpdir() }), '', '取不出时必须返回空串，由调用方判失败（不得猜一个）')
})

// ═══════════════════════════════════════════════════════════════════
// §7（2026-10-17，ccg-record-content-addressing 吸收轮）：跨实现契约锁
//
// 这一组的存在理由：上游把判定记录名从「父提交 sha」改成「暂存 diff 的内容键」之后，
// 写入侧原来的三候选（HEAD / HEAD^ / 分支起点）全部按 sha 取名，一次都命中不了。
// 而**当时 175 条用例全绿** —— 因为既有夹具把「claimed 哈希」直接喂成实现自己算出的值，
// 夹具与实现同源性为零（仓规里的「契约夹具不得替对方剥壳」）。所以这一组一律：
//   真调 decider.saveRecord 让**它**决定文件名 ⇒ 再要求 pickRecord/--locate 命中同一个文件。
// 两侧同结论才是锁；任何一侧单独改名都会红。
// ═══════════════════════════════════════════════════════════════════

const DECIDER = require('./ccg-review-decider.js')
const LEDGER_CLI = path.join(__dirname, 'ccg-record-ledger.js')

/** 真 git 仓库：seed 提交（= 分支起点）→ 一次带真实变更的提交 */
function sec7Repo (tag, changeContent) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), tag + '-'))
  const git = (a) => cp.execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '-b', 'main', '.'])
  git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'src/a.js'), 'export const a = 1\n')
  git(['add', '-A']); git(['commit', '-q', '-m', 'seed'])
  const base = git(['rev-parse', 'HEAD']).trim()
  fs.writeFileSync(path.join(repo, 'src/a.js'), changeContent || 'export const a = 2\n')
  git(['add', '-A'])
  return { repo, git, base }
}

/** 在给定 cwd 下真调判定器落记录（saveRecord 用 process.cwd() 定位 .ccg/reviews） */
function sec7SaveRecord (repo, sha, result) {
  const orig = process.cwd()
  try { process.chdir(repo); return DECIDER.saveRecord(result || { mode: 'dual', reason: 'sec7', stats: {} }, sha, 'diff', undefined) }
  finally { process.chdir(orig) }
}

function sec7Locate (repo, base) {
  const r = cp.spawnSync(process.execPath, [LEDGER_CLI, '--locate', '--repo', repo, '--base', base],
    { cwd: repo, encoding: 'utf8' })
  return { rc: r.status, out: String(r.stdout || '') + String(r.stderr || '') }
}

test('§7-T1【跨实现契约·承重】：判定器真落盘的文件名，--locate 必须命中同一个文件', () => {
  const f = sec7Repo('ccg-sec7-t1-')
  try {
    const parent = f.base                       // pre-commit 时 HEAD 就是父提交
    const written = sec7SaveRecord(f.repo, parent)
    assert.ok(written && /[/\\][0-9a-f]{64}\.json$/.test(String(written)),
      '判定器这次应当按内容键落盘（若这里就是 40hex 名，说明上游回落路径生效，本用例的前提不成立）：' + written)
    f.git(['commit', '-q', '-m', 'c1'])
    const onDisk = fs.readdirSync(path.join(f.repo, '.ccg', 'reviews')).filter(n => n.endsWith('.json'))
    assert.strictEqual(onDisk.length, 1, '现场应当只有一条记录：' + onDisk.join(','))
    const l = sec7Locate(f.repo, f.base)
    assert.strictEqual(l.rc, 0, '--locate 必须命中（rc=1 意味着内容寻址没打通）：' + l.out)
    assert.ok(l.out.startsWith('LOCATE .ccg/reviews/' + onDisk[0] + ' mode=dual'),
      '命中的文件名必须与磁盘上那条逐字相同，mode 必须读出来：' + l.out)
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }) }
})

test('§7-T2【正控·手工形态】：提交后手工跑判定器（空暂存 diff ⇒ 回落父名=HEAD），--locate 也要命中', () => {
  // 没有这一条，T1 的绿可能只是「只认新形态」—— 寻址退化成单一命名的死路也算通过。
  const f = sec7Repo('ccg-sec7-t2-')
  try {
    f.git(['commit', '-q', '-m', 'c1'])
    const head = f.git(['rev-parse', 'HEAD']).trim()
    const written = sec7SaveRecord(f.repo, head)   // index 干净 ⇒ 空 diff ⇒ 回落 <HEAD>.json
    assert.match(String(written), new RegExp(head + '\\.json$'), '手工形态应落在 HEAD 名下：' + written)
    const l = sec7Locate(f.repo, f.base)
    assert.strictEqual(l.rc, 0, '手工落盘的记录必须仍然寻得到：' + l.out)
    assert.ok(l.out.startsWith('LOCATE .ccg/reviews/' + head + '.json mode=dual'), l.out)
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }) }
})

test('§7-T3【借用防护·内容寻址版】：起点提交那条记录不得被本分支收口借用', () => {
  // base 是**上游提交**，它自己的判定记录描述的是别人的变更集。
  // 旧实现靠「事后比对 stagedDiffHash」甄别；新实现干脆不把 <base>.json 当候选（除非本次 diff 本来就空）。
  const f = sec7Repo('ccg-sec7-t3-')
  try {
    fs.mkdirSync(path.join(f.repo, '.ccg', 'reviews'), { recursive: true })
    fs.writeFileSync(path.join(f.repo, '.ccg', 'reviews', f.base + '.json'),
      JSON.stringify({ sha: f.base, mode: 'dual', deepReview: { required: true, status: 'cleared' } }), 'utf8')
    f.git(['commit', '-q', '-m', 'c1'])
    const l = sec7Locate(f.repo, f.base)
    assert.strictEqual(l.rc, 1, '本次有真实改动却没有自己的记录 ⇒ 必须报「找不到」，不得借上游那份：' + l.out)
    assert.match(l.out, /LOCATE none missing/, l.out)
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }) }
})

test('§7-T4【正控·回落名仍可用】：纯 .ccg 提交（内容键为空）时允许认 <父>.json', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-sec7-t4-'))
  const git = (a) => cp.execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git(['init', '-q', '-b', 'main', '.'])
    git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't'])
    fs.mkdirSync(path.join(repo, '.ccg', 'reviews'), { recursive: true })
    fs.writeFileSync(path.join(repo, '.ccg', 'reviews', 'keep.txt'), '占位，让 seed 提交非空\n')
    git(['add', '-A']); git(['commit', '-q', '-m', 'seed'])
    const base = git(['rev-parse', 'HEAD']).trim()
    // 起点上留一条 sha 名记录（改名之前的历史形态 / 纯 .ccg 提交的回落名都长这样）
    fs.writeFileSync(path.join(repo, '.ccg', 'reviews', base + '.json'),
      JSON.stringify({ sha: base, mode: 'dual', deepReview: { required: true, status: 'cleared' } }), 'utf8')
    // 本分支这一笔只动 .ccg ⇒ 排除 .ccg 的 diff 为空 ⇒ 判定器自己也会回落父 sha 命名
    fs.writeFileSync(path.join(repo, '.ccg', 'reviews', 'note.json'), JSON.stringify({ x: 1 }))
    git(['add', '-A']); git(['commit', '-q', '-m', 'ccg-only'])
    const l = cp.spawnSync(process.execPath, [LEDGER_CLI, '--locate', '--repo', repo, '--base', base],
      { cwd: repo, encoding: 'utf8' })
    const out = String(l.stdout || '') + String(l.stderr || '')
    assert.strictEqual(l.status, 0, '纯 .ccg 提交必须能按回落名命中（否则 T3 的严格就是把路走死）：' + out)
    assert.match(out, /LOCATE \.ccg\/reviews\/[0-9a-f]{40}\.json mode=dual/, out)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('§7-T5【配方同源·结构锁】：内容键的 diff 旗标必须与判定器源码逐项相等', () => {
  // 行为锁（T1）只能证明「此刻两侧同结论」；配方是两份源码里的两串字面量，
  // 谁被"顺手优化"掉一个旗标都要等到下次真实提交才显形。这一条把它变成当场红。
  const src = fs.readFileSync(path.join(__dirname, 'ccg-review-decider.js'), 'utf8')
  const codeLines = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  for (const flag of ['--no-textconv', '--no-ext-diff', '--no-renames']) {
    assert.ok(codeLines.includes(flag), '判定器源码必须出现 ' + flag + '（它改了配方，本锁要当场红）')
    assert.ok(RECORD_DIFF_FLAGS.includes(flag), '写入侧配方缺 ' + flag + ' ⇒ 同一变更会算出不同键')
  }
  assert.deepStrictEqual(RECORD_DIFF_FLAGS, ['--no-textconv', '--no-ext-diff', '--no-renames'],
    '旗标清单与判定器逐项相等（只准同步移动，不准单侧增删）')
  assert.deepStrictEqual(RECORD_PATHSPEC, ['--', '.', ':(exclude).ccg'], 'pathspec 必须同源：排除 .ccg 是内容键能对齐的前提')
  assert.ok(!/:\(exclude\)\.ccg\/reviews/.test(RECORD_PATHSPEC.join(' ')),
    '不得只排除 .ccg/reviews —— 判定器排的是整个 .ccg，收窄一侧就回到自指')
})
