'use strict'
// 回归锁：假想 enforce 扫描（change: qm6-tier-watermark 半片 2）
//
// 为什么必须有：用户裁决「advisory→enforce 暂不翻，等水位」，但翻之前必须先知道
// "今天翻上去会红哪几条"。这个数此前只能靠临时手跑，且很容易把"没跑出来红"读成"不会红"。
//
// 接缝形状与真实实现同形（本仓「契约夹具不得替对方剥壳」那条）：
//   materialize({repo, baseSha, headSha, number, inspect}) -> {built, dir, baseline, aTxt}
//     ↑ inspect(dir) 的返回值挂在 **`baseline`** 键下，不是摊平在顶层。本机首跑就是因为
//       替身把它摊平，15 条锁全绿而真跑每条 PR 都归成 unexpected-exit-undefined（design D15-①）。
//   inspect(dir) 由 preview 绑好 number，内部调 runChecker({dir, baseSha, headSha, number})
//     -> {cmd, rc, stdout, stderr}
//   默认 materialize **就是** debt-recheck-live.mergedTreeEvidence（它只解构自己认识的键，
//   多给的 number 被忽略 ⇒ 身份锁成立且不改动既有实现）。
// 行为用例一律注入替身；无网络（本仓 network-egress-guard 会拦真实出站）。

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const LIVE = require('./lib/debt-recheck-live.js')
const P = require('./qm6-enforce-preview.js')
const { stripCommentsForScan } = require('./check-pr-exec-record.js')

const oid = (n) => (String(n) + 'a'.repeat(40)).slice(0, 40)

// 夹具路径一律经 os.tmpdir() 拼接，**不写盘符字面量**：判据 scripts/check-doc-abs-paths.js
// 的域是全部受管文件（不只是文档），新写的失效绝对路径会当场超存量基线。
// 这些目录本来就不该存在 —— 替身从不真的检出任何东西。
const FAKE_REPO = path.join(os.tmpdir(), 'mp-preview-fake-repo')
const FAKE_LOCK = path.join(os.tmpdir(), 'mp-preview-no-such-lock.json')
const FAKE_WT = path.join(os.tmpdir(), 'mp-preview-fake-wt')
const FAKE_CHECKER = path.join(FAKE_REPO, 'scripts', 'check-pr-exec-record.js')

function makeDeps (o) {
  const opt = o || {}
  const calls = { gh: [], git: [], cmdLines: [], cleaned: [], repoArgs: [] }
  const seenRepoArgs = calls.repoArgs
  const deps = {
    repo: FAKE_REPO,
    gh: (args) => {
      calls.gh.push(args.join(' '))
      if (args[0] === 'pr' && args[1] === 'list') {
        if (opt.listFails) return { rc: 1, stdout: '', stderr: 'gh: no token' }
        return { rc: 0, stdout: JSON.stringify(opt.prs || []), stderr: '' }
      }
      return { rc: 0, stdout: '', stderr: '' }
    },
    git: (args) => {
      calls.git.push(args.join(' '))
      return { rc: 0, stdout: (opt.baseSha || oid(9000)) + '\n', stderr: '' }
    },
    fetchHead: ({ number }) => {
      if ((opt.refMissing || []).includes(number)) return { rc: 128, sha: '', stderr: "fatal: couldn't find remote ref" }
      if ((opt.badHead || []).includes(number)) return { rc: 0, sha: 'not-an-oid', stderr: '' }
      return { rc: 0, sha: oid(number), stderr: '' }
    },
    runChecker: ({ dir, baseSha, number }) => {
      const cmd = P.buildCheckerCommand({ dir, baseSha, checker: FAKE_CHECKER })
      calls.cmdLines.push({ number, cmd })
      const v = (opt.verdicts || {})[number] || { rc: 0, stdout: 'OK: 本 PR 携带执行记录或带原因的豁免\n', stderr: '' }
      return { cmd, rc: v.rc, stdout: v.stdout || '', stderr: v.stderr || '' }
    },
    materialize: ({ repo, baseSha, number, inspect }) => {
      seenRepoArgs.push({ repo, baseSha, number })
      if (opt.buildFails && opt.buildFails[number]) return { built: false, reason: opt.buildFails[number] }
      const dir = path.join(FAKE_WT, String(number))
      // 形状与真实实现**逐字同形**：inspect 的返回值挂在 baseline 键下，与 aTxt 并列。
      // 上一版把它摊平到顶层 ⇒ 13 条锁全绿，而本机真跑时每条 PR 都归成 unexpected-exit-undefined。
      return { built: true, dir, baseline: inspect(dir) || {}, aTxt: null }
    },
    cleanup: ({ number }) => { calls.cleaned.push(number) },
  }
  return { deps, calls }
}

function run (opts) {
  const d = makeDeps(opts)
  const res = P.preview(Object.assign({ repo: FAKE_REPO }, d.deps))
  return { rc: res.exitCode, text: res.stdout + res.stderr, calls: d.calls, res }
}

// ── A 免责标注的位置：必须早于任何 pr= 行 ────────────────────────────────────
test('读数首行必须早于任何 pr= 行打印"这不是门禁判决"，末行再打一次', () => {
  const r = run({ prs: [{ number: 4300, headRefName: 'x' }] })
  const lines = r.text.split(/\r?\n/)
  const first = lines.findIndex((l) => l.includes('PREVIEW-NOT-GATE'))
  const firstPr = lines.findIndex((l) => /^pr=\d+/.test(l))
  assert.ok(first >= 0, '没有免责锚串；text=' + JSON.stringify(r.text))
  assert.ok(firstPr >= 0, '夹具没造出 pr= 行，这条锁什么都没测')
  assert.ok(first < firstPr, '免责行排在 pr= 之后 ⇒ 读前半段的人已经把"没红"读成"会绿"')
  const last = lines.map((l) => l.includes('PREVIEW-NOT-GATE')).lastIndexOf(true)
  assert.ok(last > firstPr, '末行也必须再打一次')
})

// ── B 命令行逐字：enforce + no-remote + base ─────────────────────────────────
test('合成 worktree 里被调起的命令行必须逐字含 --mode=enforce、--no-remote 与 --base=', () => {
  const r = run({ prs: [{ number: 4301, headRefName: 'x' }] })
  assert.equal(r.calls.cmdLines.length, 1, '判据没被调起')
  const cmd = r.calls.cmdLines[0].cmd.join(' ')
  assert.match(cmd, /--mode=enforce/, '没带 enforce ⇒ 量的是 advisory 的打印，不是转阻断后的判决')
  assert.match(cmd, /--no-remote/, '预览不得联网：默认路径会去查远端分支集合，无凭据机器上会产出一串归因不到的失败')
  assert.match(cmd, /--base=/, 'base 必须显式落到被测那一笔主干 sha，否则读的是别人的 merge-base')
  assert.match(cmd, /check-pr-exec-record\.js/, '调起的必须是被对账的那条判据本体，不是第二份实现')
  assert.equal(r.calls.cmdLines[0].number, 4301)
})

// ── C 没判 ≠ 不红 ────────────────────────────────────────────────────────────
test('取不到 PR 头 / 回显不是 oid / 合成失败 ⇒ 落 UNJUDGEABLE 并点名缺哪一段，不得计入"这条不会红"', () => {
  const r = run({
    prs: [{ number: 4302, headRefName: 'x' }, { number: 4303, headRefName: 'y' }, { number: 4304, headRefName: 'z' }],
    refMissing: [4302],
    badHead: [4303],
    buildFails: { 4304: 'merge-conflicting' },
  })
  assert.match(r.text, /pr=4302 归因=UNJUDGEABLE reason=ref-missing/)
  assert.match(r.text, /pr=4303 归因=UNJUDGEABLE reason=head-shape/)
  assert.match(r.text, /pr=4304 归因=UNJUDGEABLE reason=merge-conflicting/)
  assert.doesNotMatch(r.text, /pr=430[234] 归因=WOULD-BE-OK/, '没判的条目被写成"不红" ⇒ 缺席被读成通过')
  const tally = r.text.match(/WOULD-BE-RED=(\d+) WOULD-BE-OK=(\d+) UNJUDGEABLE=(\d+)/)
  assert.ok(tally, '没有汇总行；text=' + JSON.stringify(r.text))
  assert.deepEqual([tally[1], tally[2], tally[3]], ['0', '0', '3'])
})

// ── D 零条在飞 vs 取不到列表（M-F6） ─────────────────────────────────────────
test('prs=0 (none-open) 退 0；而"列不出来"退 2 并打印归因 —— 两者不得同形', () => {
  const none = run({ prs: [] })
  assert.match(none.text, /prs=0 \(none-open\)/)
  assert.equal(none.rc, 0)
  const broken = run({ prs: [{ number: 1, headRefName: 'x' }], listFails: true })
  assert.equal(broken.rc, 2, '取不到列表必须退 2；text=' + broken.text)
  assert.match(broken.text, /PREVIEW-SELF-FAULT/)
  assert.doesNotMatch(broken.text, /prs=0 \(none-open\)/, '把"取不到列表"洗成"没有在飞 PR"正是本刀要防的那件事')
})

// ── E 会红 ⇒ rc=1（产出，不是故障）+ 每笔实测耗时 ────────────────────────────
test('存在 WOULD-BE-RED 时退 1（与"工具自身故障"的 2 分档），且每笔实测耗时随行打印', () => {
  const r = run({
    prs: [{ number: 4305, headRefName: 'x' }, { number: 4306, headRefName: 'y' }],
    verdicts: { 4305: { rc: 1, stdout: 'BLOCKED: CCG 深度审查欠账\n', stderr: '' } },
  })
  assert.match(r.text, /pr=4305 归因=WOULD-BE-RED/)
  assert.match(r.text, /pr=4306 归因=WOULD-BE-OK/)
  assert.equal(r.rc, 1)
  assert.match(r.text, /pr=4305 [^\n]*ms=\d+/, '每笔实测耗时不落进读数，下次调预算又只能猜')
})

// ── F 判据自身退 2 ⇒ 不是"会红" ─────────────────────────────────────────────
test('判据本体返回 2（用法/取证失败档）⇒ 该条记 UNJUDGEABLE/self-check-fault，不得记成会红', () => {
  const r = run({ prs: [{ number: 4307, headRefName: 'x' }], verdicts: { 4307: { rc: 2, stdout: '', stderr: 'usage' } } })
  assert.match(r.text, /pr=4307 归因=UNJUDGEABLE reason=self-check-fault/)
  assert.doesNotMatch(r.text, /pr=4307 归因=WOULD-BE-RED/)
})

// ── G --max 与单实例锁 ───────────────────────────────────────────────────────
test('--max 非法值回落默认并带出原值（0 合法）；陈旧锁必须被接管，活锁必须点名持有者 PID', () => {
  const bad = P.parseArgs(['--max=abc'])
  assert.equal(bad.max, P.DEFAULT_MAX)
  assert.equal(bad.defectMax, 'abc', '非法值必须原样带出来供上层出声：静默回落等于"设错了永远不被知道"')
  const zero = P.parseArgs(['--max=0'])
  assert.equal(zero.max, 0, '0 是合法上限（"只点名不合成"），不得被假值回落吃掉')
  const occupied = P.acquireLock({ file: FAKE_LOCK, now: () => 2000000000000, readHolder: () => 'PID=9999 START=1999999940000 node scripts/qm6-enforce-preview.js', pidAlive: () => true, selfPid: 1111, write: () => true })
  assert.equal(occupied.ok, false)
  assert.match(occupied.message, /9999/, '拒绝时必须点名持有者 PID，否则运维只能靠猜')
  const stale = P.acquireLock({ file: FAKE_LOCK, now: () => 2000000000000, readHolder: () => 'PID=8888 START=1999999940000 stale', pidAlive: () => false, selfPid: 1111, write: () => true })
  assert.equal(stale.ok, true, '持有者进程已不在 ⇒ 陈旧锁必须被接管，否则这把自己焊死')
  const unwritable = P.acquireLock({ file: FAKE_LOCK, readHolder: () => '', pidAlive: () => false, selfPid: 1111, write: () => false })
  assert.equal(unwritable.ok, false, '锁写不下去时必须拒绝运行（fail closed），而不是"没有锁也照样并发跑"')
})

// ── H 默认闭包的身份锁（不注入替身的那条路，design D6） ──────────────────────
test('默认闭包必须逐字接在既有实现上：materialize===mergedTreeEvidence，且默认命令行带 enforce+no-remote+base', () => {
  const d = P.defaultsFor(FAKE_REPO)
  assert.equal(d.materialize, LIVE.mergedTreeEvidence,
    '默认的 per-PR 合成合并不是 debt-recheck-live 那一份 ⇒ 又抄了第二份装配')
  for (const k of ['gh', 'git', 'fetchHead', 'runChecker', 'cleanup']) {
    assert.equal(typeof d[k], 'function', '默认闭包缺 ' + k + ' ⇒ 不注入时根本跑不起来')
  }
  // 真构造点：默认 runChecker 自己拼命令并真调（目录不存在 ⇒ 只拿回非 0，不触网、不碰仓库）
  const res = d.runChecker({ dir: path.join(FAKE_REPO, 'no-such-worktree'), baseSha: oid(1), headSha: oid(2), number: 4308 })
  assert.ok(Array.isArray(res.cmd), '默认 runChecker 必须把实际命令行带回来，否则"命令行长什么样"没有任何锁能看见')
  const cmd = res.cmd.join(' ')
  assert.match(cmd, /--mode=enforce/)
  assert.match(cmd, /--no-remote/)
  assert.match(cmd, /--base=/)
  assert.match(cmd, /check-pr-exec-record\.js/)
})

// ── I 结构锁：不得自带第二份合成合并 ─────────────────────────────────────────
test('本文件不得直接调用 merge-tree / commit-tree / worktree（合成合并只允许有一份实现）', () => {
  const src = stripCommentsForScan(fs.readFileSync(path.join(__dirname, 'qm6-enforce-preview.js'), 'utf8').split(/\r\n/).join('\n'))
  for (const banned of ['merge-tree', 'commit-tree', 'worktree']) {
    assert.ok(!src.includes("'" + banned) && !src.includes('"' + banned),
      '源码里出现直接调 ' + banned + ' 的字面量 ⇒ 装配被抄成第二份；正解是经 debt-recheck-live 的 mergedTreeEvidence')
  }
  // 反向自证：注释里提到这些词必须放行（禁令按语义位置切，本仓 2026-10-19 一天三次打红）
  const withComments = '// 复用 merge-tree / commit-tree / worktree 链\nmodule.exports = {}\n'
  assert.ok(!stripCommentsForScan(withComments).includes("'merge-tree'"))
})

// ── J 接线锁 ─────────────────────────────────────────────────────────────────
test('qm6-enforce-preview.test.js 必须接进 quality-gate.yml 的可执行正文', () => {
  const wf = stripCommentsForScan(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml'), 'utf8').split(/\r\n/).join('\n'))
  assert.ok(wf.includes('scripts/qm6-enforce-preview.test.js'), '未接线 ⇒ 本文件永远不会执行，也没有任何东西会因此变红')
})

// ── L 流式：一条判完就得看见一条（跑 30 条时全程无输出等于工具坏了也没人知道） ──
test('onLine 必须逐行回调且顺序与最终 stdout 一致；不得把所有行攒到最后一次性给', () => {
  const d = makeDeps({ prs: [{ number: 4310, headRefName: 'x' }, { number: 4311, headRefName: 'y' }] })
  const got = []
  const res = P.preview(Object.assign({ repo: FAKE_REPO, onLine: (l) => got.push(l) }, d.deps))
  const all = res.stdout.replace(/\n$/, '').split('\n')
  assert.ok(got.length >= 4, '回调次数 ' + got.length + ' ⇒ 要么没流式，要么行数与输出不同源')
  assert.deepEqual(got, all, '回调序列与 stdout 不一致 ⇒ 流式那份与落盘那份是两个口径')
  const firstPr = got.findIndex((l) => /^pr=4310/.test(l))
  const summary = got.findIndex((l) => l.includes('PREVIEW-SUMMARY'))
  assert.ok(firstPr >= 0 && firstPr < summary, 'pr= 行必须在汇总行之前就被交付')
})

// ── M repo 必须传到合成合并（真机跑过一次的形状：repo 丢了 ⇒ 整轮读的是别的仓） ──
test('materialize 收到的 repo 与 baseSha 必须是本次真正被测的那一份', () => {
  const r = run({ prs: [{ number: 4312, headRefName: 'x' }] })
  assert.equal(r.calls.repoArgs.length, 1)
  assert.equal(r.calls.repoArgs[0].repo, FAKE_REPO,
    'repo 没传进合成合并 ⇒ mergedTreeEvidence 会在错误的仓库里建 worktree，而读数看起来完全正常')
  assert.equal(r.calls.repoArgs[0].baseSha, (oid(9000)), 'baseSha 必须由 --ref 现取并原样带下去')
})

// ── N/O 真实现契约锁：合成合并的返回值形状不得由夹具想象 ─────────────────────
/** 只假 git 的 merge-tree/commit-tree/worktree 链（真 mergedTreeEvidence 自己走这三步）。 */
function fakeGitForMerge (sink) {
  return (args) => {
    const j = args.join(' ')
    if (sink) sink.push(j)
    if (j.includes('merge-tree')) return { rc: 0, stdout: 'e'.repeat(40) + '\n', stderr: '' }
    if (j.includes('commit-tree')) return { rc: 0, stdout: 'f'.repeat(40) + '\n', stderr: '' }
    // base 也要能被现取：fakeGit 若不答 rev-parse，preview 会在"没有 base"这一档就收口，
    // 那条真实现契约锁根本没走到合成合并那一步（本文件第一版就错过这一次）。
    if (j.includes('rev-parse')) return { rc: 0, stdout: 'd'.repeat(40) + '\n', stderr: '' }
    return { rc: 0, stdout: '', stderr: '' }
  }
}

test('真实 mergedTreeEvidence 把 inspect 的返回值挂在 baseline 键下 —— 改形状必须先红这条', () => {
  const res = LIVE.mergedTreeEvidence({
    repo: FAKE_REPO, baseSha: oid(1), headSha: oid(2),
    inspect: () => ({ rc: 1, stdout: 'BLOCKED', stderr: '' }),
    git: fakeGitForMerge(null),
  })
  assert.equal(res.built, true, '真实现没建成：' + JSON.stringify(res))
  assert.ok(res.baseline && typeof res.baseline === 'object',
    'inspect 的返回值不在 baseline 键下 ⇒ preview 的读取处必须同步改；实读键集=' + JSON.stringify(Object.keys(res)))
  assert.equal(res.baseline.rc, 1)
  assert.ok('aTxt' in res, 'aTxt 这一并列键是那份实现自带的（它探的是债务夹具的 a.txt）；它出现与否说明量的还是同一份实现')
})

test('preview 经**真** mergedTreeEvidence（只假 git）跑通：判据 rc=1 必须归成 WOULD-BE-RED', () => {
  const d = makeDeps({ prs: [{ number: 4320, headRefName: 'x' }], verdicts: { 4320: { rc: 1, stdout: 'BLOCKED: CCG 深度审查欠账\n', stderr: '' } } })
  const res = P.preview({
    repo: FAKE_REPO,
    gh: d.deps.gh,
    git: fakeGitForMerge(null),
    fetchHead: d.deps.fetchHead,
    materialize: LIVE.mergedTreeEvidence,
    runChecker: d.deps.runChecker,
    cleanup: () => {},
  })
  assert.match(res.stdout, /pr=4320 归因=WOULD-BE-RED/,
    '经真实现跑不出 WOULD-BE-RED ⇒ 本机首跑那条 unexpected-exit-undefined 就是形状错；实读=' + res.stdout)
  assert.doesNotMatch(res.stdout, /pr=4320 归因=UNJUDGEABLE/)
  assert.equal(res.exitCode, 1)
})

// ── K 派生测量不得变成新载体（design D1 的反向锁，按语义位置切） ─────────────
test('两个工具都不得往仓库里写：禁 append 形态，禁以仓库根为前缀的写目标（tmp 锁文件不在此列）', () => {
  for (const f of ['qm6-tier-watermark.js', 'qm6-enforce-preview.js']) {
    const src = stripCommentsForScan(fs.readFileSync(path.join(__dirname, f), 'utf8').split(/\r\n/).join('\n'))
    assert.ok(!/appendFileSync/.test(src), f + ' 出现 appendFileSync ⇒ 它开始变成"每轮往同一处追加"的载体')
    assert.ok(!/writeFileSync\(\s*(path\.join\(\s*__dirname|repo|args\.repo|opts\.repo)/.test(src),
      f + ' 往仓库路径写文件 ⇒ 水位/预览必须是派生测量（design D1），新建追加型写面正是本仓拆掉的东西')
  }
  // 反向自证：锁文件写在 tmp 下是允许的，判据不得把它当违规（否则等于禁止自己的单实例锁）
  const okTmp = "const os=require('node:os');fs.writeFileSync(path.join(os.tmpdir(),'x.json'),'{}')"
  assert.ok(!/writeFileSync\(\s*(path\.join\(\s*__dirname|repo|args\.repo|opts\.repo)/.test(okTmp))
})

// ── Q 会红的条目必须说出为什么（本机首跑暴露：只贴覆盖率摘要，红因看不见） ──
test('红因提取：抽点名行而不是覆盖率摘要；没有可归因行时必须打未点名哨兵', () => {
  const named = [
    'MODE=dual',
    'TIER-COVERAGE dual-closed total=1 external=0 self-play=1 unrecognized=0',
    'BLOCKED: 高危面 scripts/check-pr-exec-record.js 上 dual-closed 的产物 tier=self-play',
  ].join('\n')
  const r1 = P.blockingReasons(named)
  assert.match(r1, /BLOCKED/, '点名行必须被抽出来')
  assert.match(r1, /check-pr-exec-record/, '高危面名字必须留在红因里（本刀落点就是高危面，漏了就不知道该补哪一路）')
  assert.ok(!r1.includes('TIER-COVERAGE'), 'TIER-COVERAGE 只是覆盖率摘要，不是红因；把它当"这条为什么红"贴出去会误导裁决')

  const unnamed = 'TIER-COVERAGE dual-closed total=0\nMODE=single'
  assert.match(P.blockingReasons(unnamed), /未点名/, '判据退 1 但输出里没有可归因行 ⇒ 必须显式说"没点名"，不得留空让人推定红因')
})

// ── R --only 圈定复跑（全量一轮几十分钟，红因只在"会红"那几条上才需要） ──────
test('--only 只判圈定的号；圈不到的必须点名缺失，一条都不在时要走独立档', () => {
  const one = makeDeps({ prs: [{ number: 4330, headRefName: 'x' }, { number: 4331, headRefName: 'y' }] })
  const r1 = P.preview(Object.assign({ repo: FAKE_REPO, only: [4330] }, one.deps))
  assert.match(r1.stdout, /^pr=4330 归因=/m)
  assert.doesNotMatch(r1.stdout, /^pr=4331 归因=/m, '没被圈定的条目不得被顺手判掉')
  assert.match(r1.stdout, /--only 圈定 1\/1/)

  const two = makeDeps({ prs: [{ number: 4332, headRefName: 'x' }] })
  const r2 = P.preview(Object.assign({ repo: FAKE_REPO, only: [4332, 9999] }, two.deps))
  assert.match(r2.stdout, /9999/, '要的号不在 open 列表 ⇒ 必须点名，静默少判一条就是名单少一行还没人知道')

  const none = makeDeps({ prs: [{ number: 4333, headRefName: 'x' }] })
  const r3 = P.preview(Object.assign({ repo: FAKE_REPO, only: [9998] }, none.deps))
  assert.match(r3.stdout, /prs=0 \(only-none-open\)/, '"圈定的都不在"与"仓库没有在飞 PR"必须是两个档')
  assert.equal(r3.exitCode, 0)

  const bad = P.parseArgs(['--only=4334,abc'])
  assert.deepEqual(bad.only, [4334])
  assert.equal(bad.defectOnly, 'abc', '非法项要被知道，不得静默丢弃')

  // 非法项必须**拒跑**而不是"点名后继续判剩下的"（评审轮 4 i5；与 --max 的回落刻意不对称）。
  // 手误形态很具体：中文逗号 `4334，4335` 会让整串变成一个非法项 ⇒ only 退化成空集，
  // 而汇总行 prs=0 读起来完全像"圈定的都判完了"。
  const reject = P.preview(Object.assign({ repo: FAKE_REPO, only: [4334], defectOnly: 'abc' }, one.deps))
  assert.equal(reject.exitCode, 2, '--only 含非法项必须走"自身故障"档（2），不得退化成一次看起来成功的扫描')
  assert.match(reject.stdout, /PREVIEW-SELF-FAULT --only 含非数字项/)
  assert.doesNotMatch(reject.stdout, /^pr=/m, '拒绝运行就一条都不判')
  assert.match(reject.stdout, /PREVIEW-NOT-GATE[^]*PREVIEW-NOT-GATE/, '拒绝档同样要首尾各打一次免责（否则被贴进 PR 时没人知道它不是判决）')
})

// ── S 测量行不得冒充判决行（本机复跑那三条红时真实踩到的形态） ──────────────
test('TRANSITION-CHECK 是测量行：整段只有它时必须走未点名并把末行贴出来', () => {
  const onlyMeasurement = [
    'MODE=dual',
    'TRANSITION-CHECK 转变=无转变 扫描域=0 已核对=0 无出处=0 未证实=0',
  ].join('\n')
  const r = P.blockingReasons(onlyMeasurement)
  assert.match(r, /未点名/, '只有测量行 ⇒ 不得把它当红因贴出去')
  assert.match(r, /末行=TRANSITION-CHECK/, '未点名时必须把末行原样带出来，否则连"它说了什么"都丢了')
  assert.ok(!/^TRANSITION-CHECK/.test(r), '返回值不得以测量行开头冒充归因')
})

// ── T 工具的失明不得记成"这条会红" ───────────────────────────────────────────
test('判据理由是「变更集为空或取证失败」时归 UNJUDGEABLE/empty-changeset，不进会红名单', () => {
  const a = P.attribute(1, '- 变更集为空或取证失败：无法判定本 PR 是否携带执行记录')
  assert.equal(a.verdict, 'UNJUDGEABLE')
  assert.equal(a.reason, 'empty-changeset')
  const b = P.attribute(1, '- CCG 深度审查欠账 1 条')
  assert.equal(b.verdict, 'WOULD-BE-RED', '真欠账必须照常进名单，改判只针对这一种失明')
})

// ── U 锁的身份不能只看 PID（评审 i5：PID 会被复用） ──────────────────────────
test('单实例锁核对命令行与年龄：别人的 PID 顶住锁、或本工具超龄时必须被接管并出声', () => {
  const NOW = 2_000_000_000_000
  const fresh = P.acquireLock({
    file: FAKE_LOCK, selfPid: 1111, now: () => NOW,
    readHolder: () => 'PID=9999 START=' + (NOW - 60_000) + ' node scripts/qm6-enforce-preview.js',
    pidAlive: () => true, write: () => true,
  })
  assert.equal(fresh.ok, false, '本工具自己的年轻锁必须仍被尊重')

  const reused = P.acquireLock({
    file: FAKE_LOCK, selfPid: 1111, now: () => NOW,
    readHolder: () => 'PID=9999 START=' + (NOW - 60_000) + ' node somewhere-else/other-tool.js',
    pidAlive: () => true, write: () => true,
  })
  assert.equal(reused.ok, true, '锁里命令行不是本工具 ⇒ 那个 PID 大概率是复用的，不能永久拒跑')
  assert.match(reused.takenOver, /not-mine|命令行/, '接管必须说清为什么接管')

  const aged = P.acquireLock({
    file: FAKE_LOCK, selfPid: 1111, now: () => NOW,
    readHolder: () => 'PID=9999 START=' + (NOW - (P.DEFAULT_LOCK_AGE_MS + 60_000)) + ' node scripts/qm6-enforce-preview.js',
    pidAlive: () => true, write: () => true,
  })
  assert.equal(aged.ok, true, '超龄锁必须被接管（否则一次崩溃把自己焊死）')
  assert.match(aged.takenOver, /age/, '超龄接管必须打年龄')

  const legacy = P.acquireLock({
    file: FAKE_LOCK, selfPid: 1111, now: () => NOW,
    readHolder: () => 'PID=9999 node scripts/qm6-enforce-preview.js',
    pidAlive: () => true, write: () => true,
  })
  assert.equal(legacy.ok, true, '旧形态锁（无 START）不得永久拒跑，但必须被点名')
  assert.match(legacy.takenOver, /no-start/, '无时间戳也要出声')
})

// ── V 判据本体缺席不得报假红（评审 i6 采纳；比它担心的"跑不起来"更糟的是"跑起来并报红"） ──
test('runChecker：合成合并里没有 check-pr-exec-record.js ⇒ 归"判不了"，绝不归"会红"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm6-prev-nochecker-'))
  try {
    const d = P.defaultsFor(process.cwd())
    const r = d.runChecker({ dir, baseSha: oid(1), headSha: oid(2), number: 4321 })
    // 退 1 是本工具"这条 PR 会红"的唯一含义。判据文件不存在时 node 报 "Cannot find module" 也退 1，
    // 于是"工具读不到判据"会被记成一条谁也修不动的债（本机实测过的同型：pr=4285 的空变更集）。
    assert.equal(r.rc, 2, '判据缺席必须归 rc=2（自身故障档），实读 rc=' + String(r.rc) + ' stderr=' + String(r.stderr).slice(0, 200))
    assert.match(r.stderr, /checker-missing/, '缺席这件事要指名，不得只留一个空 rc')
    const a = P.attribute(r.rc, r.stdout)
    assert.equal(a.verdict, 'UNJUDGEABLE')
    assert.equal(a.reason, 'self-check-fault')
    assert.ok(String(r.cmd[1]).endsWith(path.join('scripts', 'check-pr-exec-record.js')),
      'cmd 仍要如实记录它想跑的是哪一份，否则归因无法复核')
    // 缺席档也必须带回**完整**命令行：只给 [node, 路径] 会让人以为"是命令拼错了"，
    // 而真实原因是判据本体不在这棵树上（这一格是写这条锁的当场被 §H 抓到的，不是设想）。
    assert.match(r.cmd.join(' '), /--mode=enforce/, '缺席档的 cmd 不得退化成半条命令')
    assert.match(r.cmd.join(' '), /--no-remote/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── W 被测代码拿不到凭证（评审轮 5 i2 的采纳） ────────────────────────────────
// 这条链跑的是**被评估那个 PR 自己树上的** check-pr-exec-record.js，而 spawn 默认继承父环境，
// 于是操作者 shell 里的令牌会原样交进一段尚未评审的代码。gitSafeEnv 只剥 GIT_* 那一族
// （它防的是"测量对象被污染"，不是防凭证外泄），所以在此之上再按键名形态剥一轮。
test('subjectEnv：按键名形态剥凭证，且保留判据本体真正需要的变量', () => {
  const r = P.subjectEnv({
    GITHUB_TOKEN: 't', GH_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 't', SSH_AUTH_SOCK: 't',
    PATH: 'p', HOME: 'h', MP_QM6_CRITIC: 'claude',
  })
  assert.equal(r.stripped, 4, '四条凭证形态都要被剥掉，实剥 ' + r.stripped)
  assert.equal(r.env.PATH, 'p')
  assert.equal(r.env.MP_QM6_CRITIC, 'claude', '后端选择器不是凭证，剥掉会让预览改判成别的 critic')
  for (const k of Object.keys(r.env)) {
    assert.ok(!P.SUBJECT_ENV_DENY_RE.test(k), '漏剥：' + k)
  }
})

// 纯函数测不出"接线"：这里造一份**真的会被执行**的桩判据，让它自己回吐看见了哪些键。
test('接线锁：runChecker 真的把裁好的 env 交给被执行的那份 PR 代码（不是只存在一个没被用的函数）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm6-prev-env-'))
  // canary 必须是**凭证形态**的键名，否则"它通过了"根本不是判据（我第一版就用错了名字：
  // MP_PREVIEW_CANARY 不含凭证词 ⇒ 被测代码照单收下，红的其实是这条断言而不是实现）。
  const canary = 'MP_PREVIEW_SECRET_CANARY_' + process.pid
  try {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
    // 桩判据按行数组拼，不做任何行尾拼接（这条链上一次就是因为手拼 EOL 把测试自己写坏的）。
    const stubSrc = [
      'const k = ' + JSON.stringify(canary),
      'const t = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) ? "yes" : "no"',
      'const p = process.env.PATH ? "ok" : "gone"',
      'const s = process.env[k] === "leak" ? "leak" : "absent"',
      'process.stdout.write("SECRET=" + s + " TOKEN=" + t + " PATH=" + p + "\\n")',
    ].join('\n')
    fs.writeFileSync(path.join(dir, 'scripts', 'check-pr-exec-record.js'), stubSrc)
    const saved = process.env[canary]
    process.env[canary] = 'leak'
    try {
      const d = P.defaultsFor(process.cwd())
      const r = d.runChecker({ dir, baseSha: oid(1), headSha: oid(2), number: 4321 })
      assert.equal(r.rc, 0, '桩判据没跑起来 ⇒ 这条锁没测到接线：' + String(r.stderr).slice(0, 200))
      assert.match(r.stdout, /SECRET=absent/, '凭证形态的键必须到不了被测代码')
      assert.match(r.stdout, /TOKEN=no/)
      assert.match(r.stdout, /PATH=ok/, '裁凭证不等于裁环境：PATH 没了 node 自己就找不到，红会伪装成"被测代码坏了"')
      assert.doesNotMatch(r.stdout, /SECRET=leak/)
    } finally {
      delete process.env[canary]
      if (saved !== undefined) process.env[canary] = saved
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
