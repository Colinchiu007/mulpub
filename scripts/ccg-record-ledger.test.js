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

function addrFixture () {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-addr-'))
  fs.mkdirSync(path.join(repo, '.ccg', 'reviews'), { recursive: true })
  const head = 'a'.repeat(40), parent = 'b'.repeat(40), start = 'c'.repeat(40)
  const revParse = (r) => {
    if (r === 'HEAD') return head
    if (r === 'HEAD^') return parent
    throw new Error('no such ref: ' + r)
  }
  const write = (sha, obj) => fs.writeFileSync(path.join(repo, '.ccg', 'reviews', sha + '.json'), JSON.stringify(obj), 'utf8')
  const wipe = () => { for (const f of fs.readdirSync(path.join(repo, '.ccg', 'reviews'))) fs.rmSync(path.join(repo, '.ccg', 'reviews', f), { force: true }) }
  return { repo, head, parent, start, revParse, write, wipe }
}

test('W12：三个候选各自命中；HEAD 优先；非 40hex 的 base 不当候选', () => {
  const f = addrFixture()
  try {
    const P = (baseSha, sameAsDecider) => pickRecord({ repo: f.repo, revParse: f.revParse, baseSha, sameAsDecider })
    f.write(f.start, { ...CLOSED_REC, stagedDiffHash: 'd'.repeat(64) })
    assert.strictEqual(P(f.start, () => 'd'.repeat(64)).sha, f.start, '起点候选须过同源校验后才命中')
    assert.strictEqual(P(undefined, () => '').file, null, 'HEAD/HEAD^ 单独不该命中')
    assert.strictEqual(P('origin/main', () => '').file, null, 'ref 名不得被拼进路径当候选')

    f.wipe(); f.write(f.parent, CLOSED_REC)
    assert.strictEqual(P(f.start, () => '').sha, f.parent, 'pre-commit 形态（写在父提交）必须命中，且优先于起点')

    f.wipe(); f.write(f.head, { mode: 'skip' }); f.write(f.parent, CLOSED_REC)
    assert.strictEqual(P(f.start, () => '').sha, f.head, 'HEAD 必须优先')

    f.wipe()
    const none = P(f.start, () => '')
    assert.strictEqual(none.file, null)
    assert.deepStrictEqual(none.tried, [f.head, f.parent, f.start], '必须如实列出找过哪几处：' + JSON.stringify(none.tried))
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }) }
})

test('W13【借用防护】：分支起点那份记录必须过 stagedDiffHash 同源校验，否则宁缺不借', () => {
  // 现场依据：origin/main 的 16 份 dual+closed 记录里，有 3 份本身就是 main 的祖先 ——
  // 起点候选完全可能拿到**别的会话**的裁决，而 payload sha 是按本分支 diff 算的，
  // 于是伪造成的锚能通过判据的全部检查。这一格就是关那条路。
  const f = addrFixture()
  try {
    const P = (baseSha, sameAsDecider) => pickRecord({ repo: f.repo, revParse: f.revParse, baseSha, sameAsDecider })
    f.write(f.start, { ...CLOSED_REC, stagedDiffHash: 'd'.repeat(64) })
    const bad = P(f.start, () => '9'.repeat(64))
    assert.strictEqual(bad.file, null, '哈希不符 ⇒ 不得借用')
    assert.strictEqual(bad.skippedForeign, true)
    assert.match(bad.why, /stagedDiffHash/, '理由必须点名是哪一维不符：' + bad.why)

    f.wipe(); f.write(f.start, { mode: 'dual', deepReview: { required: true, status: 'cleared' } })
    const noHash = P(f.start, () => 'x')
    assert.strictEqual(noHash.file, null, '无可核的 stagedDiffHash ⇒ 不借（缺字段不等于放行）')
    assert.strictEqual(noHash.skippedForeign, true)

    // 同一份记录，校验通过时才真的被采用（正控，否则上面两条是「恒不借」的假锁）
    f.wipe(); f.write(f.start, { ...CLOSED_REC, stagedDiffHash: 'd'.repeat(64) })
    assert.strictEqual(P(f.start, () => 'd'.repeat(64)).file, '.ccg/reviews/' + f.start + '.json')
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }) }
})

test('W14：损坏的判定记录不得抛穿（判据侧同形态是有 try 的，写入侧必须一致）', () => {
  const f = addrFixture()
  try {
    fs.writeFileSync(path.join(f.repo, '.ccg', 'reviews', f.head + '.json'), '{ 不是 JSON', 'utf8')
    assert.doesNotThrow(() => pickRecord({ repo: f.repo, revParse: f.revParse, baseSha: f.start }),
      'JSON.parse 抛穿会让 runLedger/main 崩栈，违背「失败只出声」')
  } finally { fs.rmSync(f.repo, { recursive: true, force: true }) }
})

// ───────── shell→node 参数契约（C1 的落点）─────────

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
