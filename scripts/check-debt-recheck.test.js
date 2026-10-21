'use strict'
// 回归锁：债务守门输入变更后重算在飞 PR（change: debt-baseline-recheck）
//
// 为什么必须有：收紧 scripts/debt-baseline.json 之后，在飞 PR 的 required check **不会重跑**
// （pull_request 的 run 钉在触发时那一刻的 merge ref 上），于是带着旧基线绿结论的 PR 照样能
// 自动合并，主干当场变红。实测当下就有 4 笔陈旧绿（最久 7 天）。本文件锁的是"重算 + 点名"
// 这条链的决策与形状；度量本身只有 scripts/check-debt-budget.js 一处实现（spec 第二条
// Requirement），这里一律经注入的 seam 走。
//
// 全部用例无网络（本仓 network-egress-guard 会拦真实出站），git 只在 os.tmpdir() 的临时小仓库里跑。

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const R = require('./check-debt-recheck.js')

// 切片 D 把工具面拆成三份（入口 / 纯判决核 / 真 git 装配）。**读源码的锁必须按工具面全貌扫**：
// 拆分后入口只剩 41 行，"这个文件里不出现 X" 这类判据会退化成恒真——扫描域收缩本身就是失明
// （同型教训：凡按"目录里有什么"迭代的门禁，永远看不见"该有什么"）。
const TOOL_FILES = ['check-debt-recheck.js', path.join('lib', 'debt-recheck-core.js'), path.join('lib', 'debt-recheck-live.js')]
// 这份清单声明"哪些名字必须还活着"（读源码的锁按工具面全貌扫）。
const TOOL_DECLARATIONS = [
  'REASON_CLASS', 'assertReasonClass', 'reasonFault', 'excerptOf', 'classifyMergeTree', 'evaluatePr',
  'summarize', 'measurementLine', 'renderComment', 'findMarkerComment', 'blockingGateInputs',
  'gitSafeEnv', 'gitRunner', 'mergedTreeEvidence', 'shouldCommentOn', 'commentBudget', 'live', 'main',
]
// 下界**按顶层声明集合**算，不按字节/行数算（实现评审 i4：字节下界会把"正常把代码写短"判成
// 退化，而它真正要防的是"整块实现被删掉而不是被搬走"——那件事的正确信号就是名字不见了，且不误伤重构）。
function toolSources () {
  const parts = TOOL_FILES.map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
    .split('\r\n').join('\n'))
  assert.equal(parts.length, TOOL_FILES.length, '工具面文件清单退化')
  for (const [i, f] of TOOL_FILES.entries()) {
    assert.ok(/^(?:const|function)\s+[A-Za-z_$]/m.test(parts[i]),
      `工具面文件 ${f} 里没有任何顶层声明 ⇒ 该份被清空，扫描域收缩会让结构锁恒真`)
  }
  const total = parts.join('\n')
  const names = new Set()
  for (const l of total.split('\n')) {
    const m = l.match(/^(?:const|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/)
    if (m) names.add(m[1])
  }
  const missing = TOOL_DECLARATIONS.filter((x) => !names.has(x))
  assert.deepEqual(missing, [],
    `工具面声明集合退化（有整块实现被删掉而不是被搬走）；缺=${JSON.stringify(missing)}`)
  return total
}

function fakeGit (calls) {
  return (args) => {
    calls.push(args.join(' '))
    return calls.result ? calls.result(args) : { rc: 0, stdout: '', stderr: '' }
  }
}

// ── 1) classifyMergeTree：分类必须按 rc + stdout 形状，**不得**看 stderr ──────────────
// 现场依据（本机实测）：真冲突 = rc 1 / stdout 7 行 / stderr 零字节；
// 浅历史 = rc 128 / stderr 含 refusing to merge unrelated histories。
test('classifyMergeTree 按 rc 与 CONFLICT 字样分类：真冲突的首行仍是树 oid，stderr 是零字节', () => {
  // 逐字取自本机临时仓库探针的实测形状：
  //   rc=1 / stderr 0 字节 / 首行 = 冲突树的 oid / 其后 Auto-merging + CONFLICT
  const conflictTree = '5dfa6bbacdc503d5e04d7a1008c6b229f8d41b3f'
  const conflict = R.classifyMergeTree({
    rc: 1,
    stdout: [
      conflictTree,
      '100644 4f0e299f21857f2fd9da3c4be1e6abcf908538af 1\tb.json',
      '100644 b25aba9db30531b3125cedcb3d7cfe05bd057219 2\tb.json',
      '100644 a030657f0ae0fb56e93086dde64623f3f8587e97 3\tb.json',
      '',
      'Auto-merging b.json',
      'CONFLICT (content): Merge conflict in b.json',
      '',
    ].join('\n'),
    stderr: '',
  })
  assert.equal(conflict.ok, false, 'rc≠0 不得算成功（拿冲突树去量指标会一定"在基线内"，是本链最坏的静默失效）')
  assert.equal(conflict.reason, 'conflict', '必须靠 CONFLICT 字样认出：stderr 为空、首行也是合法 oid，两条"看起来合理"的判据都会失明')

  const shallow = R.classifyMergeTree({
    rc: 128, stdout: '', stderr: 'fatal: refusing to merge unrelated histories\n',
  })
  assert.equal(shallow.reason, 'unrelated-histories', '浅历史必须是独立一档：它不是这个 PR 有问题，是 CI 检出配错')

  const ok = R.classifyMergeTree({ rc: 0, stdout: 'a'.repeat(40) + '\n', stderr: '' })
  assert.equal(ok.ok, true)
  assert.equal(ok.treeOid, 'a'.repeat(40), '成功时首行必须是 40 位树 oid')
})

test('classifyMergeTree 遇到未知形状必须落进封闭词表而不是自由文本', () => {
  const weird = R.classifyMergeTree({ rc: 3, stdout: 'total nonsense', stderr: '' })
  assert.equal(weird.ok, false)
  assert.ok(R.UNJUDGEABLE_REASONS.includes(weird.reason),
    `reason 必须取自封闭集合 ${JSON.stringify(R.UNJUDGEABLE_REASONS)}，实际=${weird.reason}`)
})

// ── 2) 四档映射：判据退出码 0 / 非 0 / 自身崩溃 / 构造不出合并态 ─────────────────────
test('四档结论各自成立：量到基线内 / 违规 / 判据自身崩溃 / 构造不出合并态', () => {
  const mk = (over) => Object.assign({
    pr: { number: 7, headRef: 'refs/pull/7/head' },
    baseSha: 'b'.repeat(40),
    classify: () => ({ ok: true, treeOid: 'a'.repeat(40) }),
    commitTree: () => ({ rc: 0, commitOid: 'c'.repeat(40) }),
    worktreeAdd: () => ({ rc: 0, dir: '/tmp/wt' }),
    runChecker: () => ({ rc: 0, stdout: '✅ 所有债务指标在基线内，通过。' }),
    postComment: () => { throw new Error('不该被调用') },
  }, over)

  assert.equal(R.evaluatePr(mk()).verdict, 'IN_BASELINE')
  assert.equal(R.evaluatePr(mk({ runChecker: () => ({ rc: 1, stdout: '❌ maxFileLines: 610 (baseline: 500)' }) })).verdict, 'VIOLATES')
  assert.equal(R.evaluatePr(mk({ runChecker: () => ({ rc: null, stdout: '', stderr: 'boom' }) })).verdict, 'CHECKER_FAILED')
  const uj = R.evaluatePr(mk({ classify: () => ({ ok: false, reason: 'conflict' }) }))
  assert.equal(uj.verdict, 'UNJUDGEABLE')
  assert.equal(uj.reason, 'conflict')
})

test('VIOLATES 不得与"量不到"混为一谈，且 UNJUDGEABLE 必须带 reason', () => {
  const e = R.evaluatePr({
    pr: { number: 9, headRef: 'refs/pull/9/head' }, baseSha: 'b'.repeat(40),
    classify: () => ({ ok: false, reason: 'ref-missing' }),
    commitTree: () => { throw new Error('不该被调用') },
    worktreeAdd: () => { throw new Error('不该被调用') },
    runChecker: () => { throw new Error('不该被调用') },
  })
  assert.equal(e.verdict, 'UNJUDGEABLE')
  assert.equal(e.reason, 'ref-missing', '取错 ref 是工具侧故障，必须与 PR 真冲突分开')
})

// ── 3) 计数行：空集也必须出行 ───────────────────────────────────────────────────────
test('计数行在空集与全合规时都必须逐档出声', () => {
  const line = R.summarizeLine([])
  assert.equal(line, 'rows=0 IN_BASELINE=0 VIOLATES=0 UNJUDGEABLE=0 CHECKER_FAILED=0',
    '空集出行是唯一能把"没有"与"没量"分开的写法（本仓实测过空数组被读成"检查已通过"）')
  const line2 = R.summarizeLine([
    { verdict: 'IN_BASELINE' }, { verdict: 'VIOLATES' }, { verdict: 'VIOLATES' },
  ])
  assert.match(line2, /rows=3 IN_BASELINE=1 VIOLATES=2 UNJUDGEABLE=0 CHECKER_FAILED=0/)
})

// ── 4) 退出码语义（D6）─────────────────────────────────────────────────────────────
test('量到了就退 0（哪怕全部违规）；工具侧故障才非 0 且不得逐条刷评论', () => {
  const allJudged = R.summarize([
    { verdict: 'VIOLATES', pr: 1 }, { verdict: 'IN_BASELINE', pr: 2 }, { verdict: 'UNJUDGEABLE', reason: 'conflict', pr: 3 },
  ])
  assert.equal(allJudged.exitCode, 0, '"有债"是正常结论，判成 CI 红会诱导人改评论而不是改债；个别 PR 真冲突也一样')
  assert.equal(allJudged.shouldComment, true)

  const toolFault = R.summarize([{ verdict: 'UNJUDGEABLE', reason: 'unrelated-histories', pr: 4 }])
  assert.notEqual(toolFault.exitCode, 0, '浅历史 = CI 检出配错，必须让这次重算可见地失败')
  assert.equal(toolFault.shouldComment, false, '工具故障不得伪装成对 30 个人 PR 的判决')
  assert.equal(toolFault.faultReasons.join(','), 'unrelated-histories')
})

// ── 5) 评论幂等（只认标记前缀，base=/judged= 是给人看的） ────────────────────────────
test('评论按标记前缀幂等命中；标记里的 base/judged 不得参与判定', () => {
  const existing = [{
    id: 42,
    body: R.renderComment({
      entries: [{ verdict: 'VIOLATES', pr: 5, detail: 'maxFileLines 610 > 500' }],
      baseSha: 'old'.padEnd(40, '0'), judgedAt: '2026-01-01T00:00:00Z',
    }).split('\n')[0],
  }]
  const hit = R.findMarkerComment(existing)
  assert.equal(hit.id, 42, '命中既有条目 ⇒ PATCH，不得再 POST 第二条')

  const fresh = R.findMarkerComment([{ id: 1, body: '完全不同的评论' }], existing[0].body.split('-->')[0] + '-->')
  assert.equal(fresh, null)
  assert.ok(R.renderComment({ entries: [], baseSha: 'f'.repeat(40), judgedAt: 'x' }).startsWith('<'),
    '正文首行必须是机器标记')
})

test('renderComment 必须同时含计数行与每笔一行，且违规行要点名当下读数', () => {
  const body = R.renderComment({
    entries: [
      { verdict: 'VIOLATES', pr: 11, detail: 'maxFileLines: 610 (baseline: 500)' },
      { verdict: 'UNJUDGEABLE', pr: 12, reason: 'conflict' },
    ],
    baseSha: 'd'.repeat(40), judgedAt: '2026-10-20T12:00:00Z',
  })
  assert.match(body, /rows=2 IN_BASELINE=0 VIOLATES=1 UNJUDGEABLE=1 CHECKER_FAILED=0/)
  assert.match(body, /\| #11 .*VIOLATES.*610/)
  assert.match(body, /\| #12 .*UNJUDGEABLE.*conflict/)
  assert.match(body, /不阻断|required/i, '必须写清这一刀只点名不阻断，否则读者会以为它是新闸门')
})

// ── 6) D2 的行为证明：合并态里读到的是"该读的那份基线" ───────────────────────────────
// 这条只能用真 git 跑：读源码证明不了 merge-tree 的产物归属。
function makeRepo () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `debt-recheck-${process.pid}-${Date.now()}-`))
  const repo = path.join(root, 'r')
  fs.mkdirSync(repo, { recursive: true })
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
    assert.equal(r.status, 0, `git ${args.join(' ')} 失败：${r.stderr}`)
    return (r.stdout || '').trim()
  }
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@example.invalid'])
  g(['config', 'user.name', 't']); g(['config', 'commit.gpgsign', 'false'])
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'scripts', 'debt-baseline.json'), '{"maxFileLines":500}\n')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n')
  g(['add', '.']); g(['commit', '-q', '-m', 'base'])
  return { root, repo, g }
}
const readBaseline = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'scripts', 'debt-baseline.json'), 'utf8')).maxFileLines

test('D2 行为证明：PR 未动基线 ⇒ 合并态里是主干收紧后的那份', () => {
  const { root, repo, g } = makeRepo()
  try {
    fs.writeFileSync(path.join(repo, 'scripts', 'debt-baseline.json'), '{"maxFileLines":400}\n')
    g(['add', '.']); g(['commit', '-q', '-m', 'main tightens'])
    const baseSha = g(['rev-parse', 'HEAD'])
    g(['checkout', '-q', '-b', 'pr-clean', baseSha + '~1'])
    fs.writeFileSync(path.join(repo, 'a.txt'), 'base\npr line\n')
    g(['add', '.']); g(['commit', '-q', '-m', 'pr touches only a.txt'])
    const head = g(['rev-parse', 'HEAD'])

    let seen = null
    // inspect 在合并态**还存在时**被调用（实现用完即删 worktree，所以事后 existsSync 必然为假 ——
    // 断言必须落在回调里，否则会测成一个永远为假的"现场存在"检查）。
    const res = R.mergedTreeEvidence({
      repo, baseSha, headSha: head,
      inspect: (dir) => {
        const exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory()
        const aTxtPath = path.join(dir, 'a.txt')
        seen = { exists, hasPrFile: fs.existsSync(aTxtPath) ? fs.readFileSync(aTxtPath, 'utf8').trim() : null }
        return readBaseline(dir)
      },
    })
    assert.equal(res.baseline, 400, `合并态必须读主干那份收紧后的基线，实际=${res.baseline}`)
    assert.equal(seen && seen.exists, true, '必须在真合并态目录里读，而不是从 ref 拼字符串')
    assert.equal(seen.hasPrFile, 'base\npr line', 'PR 那侧的文件必须在同一个合并态里')
    assert.equal(res.aTxt, 'base\npr line', '返回值也必须带同一份现场（渲染层要用它做归因）')
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
})

test('D2 另一侧：PR 自己提议的基线不得被主干那份覆盖', () => {
  const { root, repo, g } = makeRepo()
  try {
    fs.writeFileSync(path.join(repo, 'scripts', 'debt-baseline.json'), '{"maxFileLines":400}\n')
    g(['add', '.']); g(['commit', '-q', '-m', 'main tightens'])
    const baseSha = g(['rev-parse', 'HEAD'])
    g(['checkout', '-q', '-b', 'pr-proposes', baseSha + '~1'])
    fs.writeFileSync(path.join(repo, 'scripts', 'debt-baseline.json'), '{"maxFileLines":450}\n')
    g(['add', '.']); g(['commit', '-q', '-m', 'pr proposes 450'])
    const head = g(['rev-parse', 'HEAD'])
    const res = R.mergedTreeEvidence({ repo, baseSha, headSha: head, inspect: readBaseline })
    // 两侧都改同一行 ⇒ 真冲突，必须落 UNJUDGEABLE(conflict) 而不是"随便挑一份基线"
    assert.equal(res.built, false, '构造失败必须出声（它从不判基线，成功侧只回 built=true）')
    assert.equal(res.reason, 'conflict', `同处收紧提案必须报冲突，不得静默选边；实际=${JSON.stringify(res)}`)
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
})

// ── 7) 接线锁：这个测试文件必须被不被 docs-only 短路的作业执行 ─────────────────────────
test('接线：本测试文件必须被 quality-gate.yml 点名（否则等于没写）', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  const body = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.match(body, /check-debt-recheck\.test\.js/,
    '新写测试必须同 PR 登记进 CI；本仓没有任何自动收集机制覆盖 scripts/ 下的测试')
})

// ── 8) 度量只有一处实现（结构锁）：重算脚本不得点名任何指标名 ────────────────────────
test('结构锁：重算脚本里不得出现任何债务指标名（度量只有 check-debt-budget.js 一处）', () => {
  const src = toolSources()
  const METRICS = ['maxFileLines', 'filesOver500', 'filesOver1000', 'modelProviderLines', 'modelProviderRequireFanOut', 'circularDeps']
  const hit = METRICS.filter((m) => src.includes(m))
  assert.deepEqual(hit, [],
    `重算脚本一旦出现指标名，就是第二份度量实现（两份必然漂移：一处改了另一处静默失真）。命中=${JSON.stringify(hit)}`)
})

// ── 9) 新 workflow 的接线锁：文件必须存在，且带三条不可省的声明 ─────────────────────
test('接线：重算 workflow 与脚本同 PR 落地，并写明"不阻断"+ fetch-depth: 0 + timeout-minutes', () => {
  const p = path.join(__dirname, '..', '.github', 'workflows', 'debt-baseline-recheck.yml')
  assert.ok(fs.existsSync(p), '重算 workflow 必须与脚本同 PR 落地，否则这条链永远不会跑')
  const y = fs.readFileSync(p, 'utf8').split('\r\n').join('\n')
  assert.match(y, /fetch-depth:\s*0/, '浅历史会让 merge-tree 报 unrelated histories ⇒ 整轮工具侧故障，必须禁浅历史')
  assert.match(y, /timeout-minutes:\s*\d+/, 'CI 侧耗时未测 ⇒ 必须有硬预算，不能裸跑')
  assert.match(y, /不\*\*是\*\* required check|不是\*\* required check/, '必须写清它不阻断，否则读者会把它当成新闸门')
})

// ── 10) 写入门闩（deep-review i3）：首轮只测量，不得一次给最多 30 个 PR 写评论 ──────────
test('写入门闩：只有严格 "1" 才开；live() 真调它（否则门闩是装饰）', () => {
  assert.equal(R.shouldCommentOn({}), false, '默认（未设）必须关：CI 侧耗时与评论速率未测，首轮不得写人 PR 的评论')
  assert.equal(R.shouldCommentOn({ MP_RECHECK_COMMENT: '' }), false)
  assert.equal(R.shouldCommentOn({ MP_RECHECK_COMMENT: '0' }), false)
  assert.equal(R.shouldCommentOn({ MP_RECHECK_COMMENT: 'true' }), false, '"看着像开"的取值不得放行写入（严格 "1" 才算）')
  assert.equal(R.shouldCommentOn({ MP_RECHECK_COMMENT: '01' }), false)
  assert.equal(R.shouldCommentOn({ MP_RECHECK_COMMENT: '1' }), true)
  const src = toolSources()
  const calls = (src.match(/shouldCommentOn\(env\)/g) || []).length
  assert.equal(calls, 1, `live() 必须真的经过这道门闩（导出但没人调 = 装饰性开关）；实际调用=${calls}`)
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'debt-baseline-recheck.yml'), 'utf8').split('\r\n').join('\n')
  assert.match(wf, /MP_RECHECK_COMMENT:\s*"0"/, 'workflow 必须把门闩显式写关，并说明开启需人工决定')
  assert.match(wf, /MP_RECHECK_MAX_COMMENTS:\s*"\d+"/, 'workflow 必须显式写每轮上限，不得只靠脚本默认值兜着（默认值一变就静默放大写入面）')
  const wiring = (src.match(/MP_RECHECK_MAX_COMMENTS/g) || []).length
  assert.ok(wiring >= 2, `脚本必须真的读这个变量（commentBudget 与 commentBudgetDefect 各一处）；实际命中=${wiring}`)
  assert.match(wf, /写入纪律/, 'workflow 自身必须写出三条写入纪律（外部复核第 2 轮 W4：只写在脚本里，读 workflow 的人看不到这条门是干什么的）')
})


// ── 11) 行为锁（外部复核 i3 → W4）：结构锁只证"被调用"，行为锁才证"无旁路可绕过" ──────
// 评审原文：「测试测的是纯函数返回值 + 源码中存在 shouldCommentOn 调用，不是行为执行验证；
// 差别在于结构测试保证'被调用'，行为测试保证'无旁路可绕过'」。
// 夹具纪律：注入的 gh 若没被真正使用，实现就会退回真实进程（本仓 network-egress-guard 会把它
// 打成"工具侧故障"，写调用照样是 0 ⇒ 用例假绿）。所以每条用例都先断言"注入的 gh 收到了 pr list"。
function recheckWorld (opts = {}) {
  const prs = opts.prs || [{ number: 11, title: 'a' }, { number: 22, title: 'b' }]
  const calls = []
  const logs = []
  const gitCalls = []
  const git = (args) => {
    gitCalls.push(args.join(' '))
    const j = args.join(' ')
    if (j.startsWith('rev-parse origin/main')) return { rc: 0, stdout: 'b'.repeat(40) + '\n', stderr: '' }
    if (j.startsWith('fetch')) return opts.fetchFails ? { rc: 128, stdout: '', stderr: "fatal: couldn't find remote ref" } : { rc: 0, stdout: '', stderr: '' }
    if (j.startsWith('rev-parse refs/recheck')) return opts.fetchFails ? { rc: 128, stdout: '', stderr: '' } : { rc: 0, stdout: 'c'.repeat(40) + '\n', stderr: '' }
    if (j.startsWith('merge-tree')) return { rc: 0, stdout: 'd'.repeat(40) + '\n', stderr: '' }
    if (/(^|\s)commit-tree(\s|$)/.test(j)) {
      // opts.commitTreeRc：让**默认闭包**面对一次真实失败（锁 H 用它验透传，不是验假实现）
      if (opts.commitTreeRc) return { rc: opts.commitTreeRc, stdout: '', stderr: opts.commitTreeStderr || '' }
      return { rc: 0, stdout: 'e'.repeat(40) + '\n', stderr: '' }
    }
    return { rc: 0, stdout: '', stderr: '' }
  }
  const gh = (args) => {
    const j = args.join(' ')
    calls.push(j)
    if (j.startsWith('pr list')) return { status: 0, stdout: JSON.stringify(prs), stderr: '' }
    if (j.startsWith('pr view')) {
      if (opts.stateFault) return { status: 1, stdout: '', stderr: 'HTTP 502' }
      return { status: 0, stdout: JSON.stringify({ state: opts.state || 'OPEN' }), stderr: '' }
    }
    if (j.includes('comments?per_page')) {
      return { status: 0, stdout: JSON.stringify(opts.existingComment ? [opts.existingComment] : []), stderr: '' }
    }
    if (j.includes('-f body=')) return { status: opts.writeStatus || 0, stdout: '', stderr: opts.writeErr || '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  // 外部复核第 3 轮 W5：夹具原先对所有 PR 都回同一个 rc ⇒ IN_BASELINE 那条"不该被写"的资格
  // 从未被表示过（夹具对所有输入给同一个答案，这类缺陷对它结构性免疫）。
  // 这里注入 worktreeAdd 拿到**按 PR 顺序**的目录串，再让 rcOf 按目录给不同的答案。
  let seq = 0
  const rcOf = opts.rcOf || (() => 1)
  const runChecker = (dir) => {
    const rc = rcOf(dir)
    return { rc, stdout: rc === 0 ? 'DEBT WITHIN BASELINE' : 'DEBT OVER BASELINE', stderr: '' }
  }
  const worktreeAdd = (commitOid) => { seq += 1; return { rc: 0, dir: 'wt-' + seq + '@' + commitOid } }
  // 切片 D：失败阶段也要能表示。不注入 seams 时保持切片 C 的形状（全跑通、由 rcOf 决定判决）。
  const seams = Object.assign({ worktreeAdd, runChecker }, opts.seams || {})
  // skipSeams：把某个 seam 交回**生产默认实现**（锁 H 用它证明默认闭包真的透传 stderr）。
  for (const k of (opts.skipSeams || [])) delete seams[k]
  R.live({
    env: opts.env || {}, git, gh, log: (m) => logs.push(String(m)),
    worktreeAdd: seams.worktreeAdd, runChecker: seams.runChecker, commitTree: seams.commitTree, classify: seams.classify,
  })
  return { calls, logs, gitCalls, writes: calls.filter((a) => /-f body=/.test(a)), prs }
}

test('行为锁：门闩关 ⇒ 零次写调用；门闩开 ⇒ 每条违规各写一次（同夹具只差 env）', () => {
  const off = recheckWorld({ env: { MP_REPO: 'o/r' } })
  assert.ok(off.calls.some((a) => a.startsWith('pr list')), '注入的 gh 必须真的被使用，否则这条用例在测真实进程（假锁）')
  assert.equal(off.writes.length, 0, 'MP_RECHECK_COMMENT 未设 ⇒ 一次写都不能发生（不是"写了但没打印"）')
  // 外部复核第 2 轮 W2：只断言"写调用 0 次"抓不到"写路径的第一步根本没被走到"这一格 ——
  // 写前状态查询与标记查找都属于写路径，关档时一次都不该发；否则"关闭"只是"写得少"。
  assert.equal(off.calls.filter((a) => a.startsWith('pr view')).length, 0, '关档不得做写前状态查询（它是写路径的第一步）')
  assert.equal(off.calls.filter((a) => a.includes('comments?per_page')).length, 0, '关档不得去读既有评论（那是为了 PATCH 才读的）')
  assert.equal(off.calls.filter((a) => a.startsWith('api')).length, 0, '关档时任何 api 形态调用都不该发生；实际=' + JSON.stringify(off.calls))
  assert.ok(off.logs.some((l) => /would-comment/.test(l)), '关档必须把"本来会写谁"逐条留痕，否则读起来像"没有违规"')

  const on = recheckWorld({ env: { MP_REPO: 'o/r', MP_RECHECK_COMMENT: '1' } })
  assert.equal(on.writes.length, 2, '开档时两条违规各写一次；实际=' + JSON.stringify(on.writes))
  assert.equal(on.calls.filter((a) => a.startsWith('pr view')).length, 2, '写入前必须**逐条**复查状态，整轮只查一次等于没查')
  assert.equal(on.calls.filter((a) => a.includes('comments?per_page')).length, 2, '写入前必须逐条找标记，否则幂等会退化成叠加')
})

// ── 12) 写入预算（外部复核 i3 → W3）：门闩开了也不得一次刷满全部在飞 PR ──────────────────
test('写入预算：默认 10、非法值回落并出声、0 是合法值（只点名不写）', () => {
  assert.equal(R.commentBudget({}), 10, '未设 ⇒ 默认上限')
  assert.equal(R.commentBudget({ MP_RECHECK_MAX_COMMENTS: '3' }), 3)
  assert.equal(R.commentBudget({ MP_RECHECK_MAX_COMMENTS: '0' }), 0, '0 是合法上限，不得被"假值回落"吃掉')
  for (const bad of ['abc', '-1', '2.5', '', ' ', '1e', 'NaN']) {
    assert.equal(R.commentBudget({ MP_RECHECK_MAX_COMMENTS: bad }), 10, `非法值 ${JSON.stringify(bad)} 必须回落默认`)
    assert.ok(R.commentBudgetDefect({ MP_RECHECK_MAX_COMMENTS: bad }) !== null, `非法值 ${JSON.stringify(bad)} 必须出声`)
  }
  assert.equal(R.commentBudgetDefect({}), null, '未设是正常路径，不得告警')
  assert.equal(R.commentBudgetDefect({ MP_RECHECK_MAX_COMMENTS: '3' }), null)

  const capped = recheckWorld({
    env: { MP_REPO: 'o/r', MP_RECHECK_COMMENT: '1', MP_RECHECK_MAX_COMMENTS: '2' },
    prs: [{ number: 1, title: 'a' }, { number: 2, title: 'b' }, { number: 3, title: 'c' }],
  })
  assert.equal(capped.writes.length, 2, '上限 2 ⇒ 第 3 条不得写；实际=' + JSON.stringify(capped.writes))
  assert.ok(capped.logs.some((l) => /上限/.test(l)), '触顶必须出声，不能静默少写（静默会让读者以为"都没违规"）')

  const zero = recheckWorld({ env: { MP_REPO: 'o/r', MP_RECHECK_COMMENT: '1', MP_RECHECK_MAX_COMMENTS: '0' } })
  assert.equal(zero.writes.length, 0, '上限 0 ⇒ 即使门闩开也不写')
})

// ── 13) 写前二次核查（外部复核 i3 → W3）：清单是几分钟前拉的，PR 可能已被合并 ──────────────
test('写前复查 PR 状态：非 OPEN 不写、读不到状态也不写（fail-closed）', () => {
  const merged = recheckWorld({ env: { MP_REPO: 'o/r', MP_RECHECK_COMMENT: '1' }, state: 'MERGED' })
  assert.equal(merged.writes.length, 0, '已合并的 PR 不得写评论')
  assert.ok(merged.logs.some((l) => /MERGED/.test(l)), '跳过要写明是哪个状态值，否则与"没违规"同形')

  const unreadable = recheckWorld({ env: { MP_REPO: 'o/r', MP_RECHECK_COMMENT: '1' }, stateFault: true })
  assert.equal(unreadable.writes.length, 0, '状态读不到 ⇒ 按未证实处理，不得写（把工具的失明读成"还是 open"）')
  assert.ok(unreadable.logs.some((l) => /unreadable/.test(l)), '读不到必须出声')
})


// ── 14) 写入资格（外部复核第 3 轮 W5）：只有"需要点名"的条目才有写路径 ───────────────────
test('写入资格：IN_BASELINE 的条目不得进入写路径（连状态复查都不该做）', () => {
  const mixed = recheckWorld({
    env: { MP_REPO: 'o/r', MP_RECHECK_COMMENT: '1' },
    prs: [{ number: 7, title: 'ok' }, { number: 8, title: 'bad' }, { number: 9, title: 'ok2' }],
    rcOf: (dir) => (dir.startsWith('wt-2') ? 1 : 0),
  })
  assert.equal(mixed.writes.length, 1, '三笔里只有一笔违规 ⇒ 只许写一条；实际=' + JSON.stringify(mixed.writes))
  assert.equal(mixed.calls.filter((a) => a.startsWith('pr view')).length, 1, 'IN_BASELINE 不得占用写路径的任何一步（含写前复查）')
  assert.ok(mixed.calls.some((a) => /body=/.test(a) && a.includes('issues/8/')), '写的那一条必须是违规那笔 pr=8')
})

// ── 15) 平台侧拒写（外部复核第 3 轮 W3 的 TOCTOU 那一格）：留痕、不重试、不改判 ──────────
test('写入被平台拒绝（404/410）时必须点名一次且不重试，也不把该轮判成工具故障', () => {
  const rejected = recheckWorld({
    env: { MP_REPO: 'o/r', MP_RECHECK_COMMENT: '1' },
    writeStatus: 1, writeErr: 'gh: HTTP 404 Not Found',
  })
  assert.equal(rejected.writes.length, 2, '预算按尝试计：被拒的两次也占额度，且**不得**重试成 4 次')
  const lines = rejected.logs.filter((l) => /写入被平台拒绝/.test(l))
  assert.ok(lines.length >= 1, '拒写必须走**专门的**归因行（"rc=1 :: …404…" 那种通用尾巴读起来与"写成功了"只差一个数字，会把拒写当成成功）；实际日志=' + JSON.stringify(rejected.logs.slice(-4)))
  assert.ok(!rejected.logs.some((l) => /工具侧故障/.test(l)), '别人的 PR 不可写不是本作业的工具故障，不得把整轮判成未证实')
})


// ── 16) 端点形状（第 4 轮复核 Critical#4）：更新走 issues/comments/<id>，新增走 issues/<n>/comments ──
// 现场：原先更新分支拼的是 `repos/<repo>/comments/<id>`（少一层 `issues/`），那是**永远 404** 的
// 错端点；而第 15 节的拒写归因会把它读成"这个 PR 在复查之后已不可写"——拼错的 URL 伪装成平台侧竞争。
// 更上一层的原因是夹具：`comments?per_page` 恒回 []，幂等更新这条路一次都没被走过。
test('幂等更新的端点形状：命中自家标记必须 PATCH /issues/comments/<id>，不得少一层 issues/', () => {
  const upd = recheckWorld({
    env: { MP_REPO: 'o/r', MP_RECHECK_COMMENT: '1' },
    existingComment: { id: 555, body: R.MARKER + ' base=deadbeef judged=1 -->\n\n上一轮结论' },
  })
  const patches = upd.calls.filter((a) => a.includes('-X PATCH'))
  assert.equal(patches.length, 2, '两条违规都命中自家标记 ⇒ 都必须更新而不是叠一条新的；实际=' + JSON.stringify(upd.calls))
  for (const p of patches) {
    assert.ok(/repos\/o\/r\/issues\/comments\/555/.test(p), '更新端点必须是 issues/comments/<id>，实际=' + p)
    assert.ok(!/repos\/o\/r\/comments\//.test(p), '不得出现缺 issues/ 那一层的形状（永远 404），实际=' + p)
  }
  const fresh = recheckWorld({ env: { MP_REPO: 'o/r', MP_RECHECK_COMMENT: '1' } })
  assert.equal(fresh.calls.filter((a) => /repos\/o\/r\/issues\/\d+\/comments/.test(a) && a.includes('-f body=')).length, 2,
    '没有标记时必须走新增端点 issues/<n>/comments（这条按"带 body 实参"筛，读评论那条同形但不带 body）')
  assert.equal(fresh.calls.filter((a) => a.includes('-X PATCH')).length, 0, '没有标记时不得凭空 PATCH')
})


// ── 17) fetch 失败归因（前端轴 W-FE1）：「没取到 PR 头」不得变成「主干自合并」 ──────────
// 现场：live() 原先写 `merge-tree baseSha (head || 'HEAD')`，fetch 失败时 head 为空 ⇒ 拿主干
// 跟自己合并，**一定成功**，随后 commit-tree 因缺父失败被归成 worktree-setup；而封闭词表里的
// ref-missing 没有任何路径产出，读词表的人会以为它覆盖了这个失败形态。
test('fetch 取不到 PR 头 ⇒ 归 ref-missing，且一次 merge-tree 都不许发', () => {
  const w = recheckWorld({ env: { MP_REPO: 'o/r' }, fetchFails: true })
  assert.ok(w.logs.some((l) => /verdict=UNJUDGEABLE\/ref-missing/.test(l)),
    '必须如实归到 ref-missing；实际日志=' + JSON.stringify(w.logs.slice(0, 6)))
  assert.equal(w.gitCalls.filter((a) => a.startsWith('merge-tree')).length, 0,
    '拿 HEAD 自合并会"成功"并给出假基线读数，这一步一次都不能发；实际=' + JSON.stringify(w.gitCalls))
})

// ── 18) 构造函数不得自称判决（前端轴 W-FE2）：它只证明"合并态造得出来" ──────────────────
test('合并态构造函数：成功回 built=true 且不带任何 verdict；失败回 built=false + reason', () => {
  const src = toolSources()
  const at = src.indexOf('function mergedTreeEvidence')
  assert.ok(at >= 0, '构造函数必须叫 mergedTreeEvidence（旧名 evaluateMergedBaseline 里的 evaluate 会让人以为它在判决）')
  const body = src.slice(at, src.indexOf('\n}', at))
  assert.ok(!/verdict:\s*'IN_BASELINE'/.test(body),
    '它从不跑判据，回 IN_BASELINE 是假判决（前端轴 W-FE2）；函数体里不得再出现该字面量')
  assert.ok(/built:\s*true/.test(body) && /built:\s*false/.test(body), '成功/失败两档都要显式出声')
})

// ── 19) 守门输入必须从 debt-guard.yml 派生（前端轴 W-FE3：第二处真源） ────────────────────
// 「哪些文件算守门输入」原先只在 workflow 的 paths: 里手写一份，而 debt-guard.yml 实际执行面
// 更大（它还跑逐文件行数门禁）。实测当场核对：debt-guard 的阻断 step 跑了 check-debt-budget.js
// 与 .github/scripts/check-max-lines.js，后者读 .github/scripts/max-lines-baseline.json；
// 死代码检测那步是 continue-on-error 的软门禁，不该进集合。
test('守门输入集合：从 debt-guard.yml 的阻断 step 派生脚本与其基线文件', () => {
  const yml = [
    'jobs:', '  d:', '    steps:', '      - run: node scripts/check-debt-budget.js',
    '      - run: |', '          node .github/scripts/check-max-lines.js',
    '      - name: 软门禁', '        continue-on-error: true', '        run: |',
    '          node scripts/detect-unwired-exports.js apps/desktop',
  ].join('\n')
  const files = {
    'scripts/check-debt-budget.js': "const B = path.join(__dirname, 'debt-baseline.json');",
    '.github/scripts/check-max-lines.js': "const BASELINE_PATH = path.join(__dirname, 'max-lines-baseline.json');",
    'scripts/detect-unwired-exports.js': 'no baseline here',
  }
  const got = R.blockingGateInputs(yml, (p) => files[p] || '')
  assert.deepEqual(got, [
    '.github/scripts/check-max-lines.js',
    '.github/scripts/max-lines-baseline.json',
    'scripts/check-debt-budget.js',
    'scripts/debt-baseline.json',
  ], '软门禁必须被排除，每个阻断脚本要连它自己声明的基线文件一起进集合；实际=' + JSON.stringify(got))
})

test('真实对账：debt-guard.yml 的阻断输入必须全部出现在本 workflow 的 paths 里', () => {
  const guard = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'debt-guard.yml'), 'utf8').split('\r\n').join('\n')
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'debt-baseline-recheck.yml'), 'utf8').split('\r\n').join('\n')
  const read = (p) => { try { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8') } catch { return '' } }
  const required = R.blockingGateInputs(guard, read)
  assert.ok(required.length >= 4, `派生集合不得退化成空（空集合会让下面的覆盖判断恒真）；实际=${JSON.stringify(required)}`)
  const listed = (() => {
    // 只取 paths: 那一块，不能拿"六空格缩进的 - 项"通吃：steps 的 - uses: 同缩进，会被误收。
    const lines = wf.split('\n')
    const at = lines.findIndex((l) => /^\s+paths:\s*$/.test(l))
    if (at < 0) return []
    const indent = (lines[at].match(/^\s*/) || [''])[0].length
    const out = []
    for (let i = at + 1; i < lines.length; i++) {
      const cur = lines[i]
      if (/^\s*(#|$)/.test(cur)) continue // 注释与空行不结束清单（本仓的 paths 块里就写着理由注释）
      const m = cur.match(/^(\s+)-\s+(\S.*)$/)
      if (!m || m[1].length <= indent) break
      out.push(m[2].trim())
    }
    return out
  })()
  assert.ok(listed.length >= 4, `paths 清单读取失败（命中 ${listed.length} 项）：${JSON.stringify(listed)}`)
  const missing = required.filter((p) => !listed.includes(p))
  assert.deepEqual(missing, [], `这些守门输入改了会作废在飞 PR 的绿结论，但不会触发重算：${JSON.stringify(missing)}`)
})


// ── 20) 基线文件派生的独立面（不与软门禁那格混在一条用例里） ─────────────────────────────
// 拆成单独一条是**判据分辨率**要求：M13（无视 continue-on-error）与 M14（不再派生脚本自己声明的
// 基线文件）都会撞在"完整集合"那条上；若只有一条用例，两者的红集逐字相同 ⇒ 锁分辨不了这两种退化。
// 这条夹具里**没有软门禁 step** ⇒ 只有 M14 会红。
test('派生集合必须含阻断脚本自己声明的基线文件（无软门禁的夹具，单独分辨 M14）', () => {
  const yml = ['steps:', '  - run: node scripts/check-debt-budget.js'].join('\n')
  const got = R.blockingGateInputs(yml, (p) => (p === 'scripts/check-debt-budget.js'
    ? "const BASELINE_PATH = path.join(__dirname, 'debt-baseline.json');" : ''))
  assert.deepEqual(got, ['scripts/check-debt-budget.js', 'scripts/debt-baseline.json'],
    '收紧账本与收紧判据本体是同一件事的两半，只收脚本名会漏掉账本那一半；实际=' + JSON.stringify(got))
})

// ══ 切片 D（change: debt-recheck-zero-measurement-fail）════════════════════════════
// 现场（run 39563222046 / job 119099176198，切片 C 落地后的**第一次真实运行**）：
//   [recheck] rows=30 IN_BASELINE=0 VIOLATES=0 UNJUDGEABLE=30 CHECKER_FAILED=0
//   逐条 15 × worktree-setup + 15 × conflict，runChecker 一次都没被调用，而步骤结论 = success。
// 下面 7 条锁逐格钉住"零测量不得报成功"与"量不到必须说得出是哪一步、为什么"。

// ── 21) 锁 A：含工具故障的一轮必须非零，且不得伪装成对别人 PR 的判决 ──────────────────
test('零测量轮不得报成功：全 merge-worktree-failed ⇒ exitCode≠0、shouldComment=false', () => {
  const entries = [
    { pr: 9, verdict: 'UNJUDGEABLE', reason: 'merge-worktree-failed', stage: 'worktree-add', detail: 'fatal: x' },
    { pr: 10, verdict: 'UNJUDGEABLE', reason: 'merge-worktree-failed', stage: 'worktree-add', detail: 'fatal: x' },
  ]
  const s = R.summarize(entries)
  assert.notEqual(s.exitCode, 0, '一条都没量到（且不是别人的 PR 冲突）⇒ 这一轮必须可见地失败；实际 exitCode=' + s.exitCode)
  assert.equal(s.shouldComment, false, '工具失明不得变成往别人 PR 上写评论')
  assert.deepEqual(s.faultReasons, ['merge-worktree-failed'])
  assert.equal(s.measured, 0, '读数行必须把"量到了几笔"单独算出来')
  assert.equal(R.measurementLine(entries), 'MEASURED=0(tool-fault:merge-worktree-failed)')
})

// ── 22) 锁 B：全 conflict 的一轮退 0（刻意的窄出口），但必须留痕 ──────────────────────
// 为什么这条不判红：conflict 的含义是"这笔 PR 与主干真有冲突"，GitHub 在 CONFLICTING 状态下
// 根本不让合并 ⇒ 陈旧绿进不了主干，本作业要防的那件事没发生。判红只会诱导人去改评论/改判据。
test('全 conflict 的一轮：退 0 但必须打印 MEASURED=0(all-conflict)，与"量了且都在基线内"可区分', () => {
  const entries = [
    { pr: 1, verdict: 'UNJUDGEABLE', reason: 'conflict' },
    { pr: 2, verdict: 'UNJUDGEABLE', reason: 'conflict' },
  ]
  const s = R.summarize(entries)
  assert.equal(s.exitCode, 0, '"他们本来就合不进去"不是本工具故障')
  assert.equal(s.measured, 0)
  assert.equal(s.allConflict, true)
  assert.equal(R.measurementLine(entries), 'MEASURED=0(all-conflict)')
  assert.equal(R.measurementLine([]), 'MEASURED=0(rows=0)', '没有 open PR 是"无事可做"，必须与"没量到"三种形态都不同形')
  assert.equal(R.measurementLine([{ pr: 3, verdict: 'IN_BASELINE' }]), 'MEASURED=1')
})

// ── 23) 锁 A′：结构不变式（不依赖名单完备），第二网专门接 CHECKER_FAILED 整轮崩那种形态 ──
test('整轮零测量且并非全 conflict ⇒ 非零，即便条目原因没进任何名单', () => {
  const future = R.summarize([
    { pr: 1, verdict: 'UNJUDGEABLE', reason: 'conflict' },
    { pr: 2, verdict: 'UNJUDGEABLE', reason: 'some-reason-added-next-round' },
  ])
  assert.notEqual(future.exitCode, 0, '词表外新档按未证实处理（fail closed），不得静默退 0')
  assert.equal(R.reasonFault('some-reason-added-next-round'), true)
  const allCrash = R.summarize([
    { pr: 3, verdict: 'CHECKER_FAILED', detail: '判据自身崩溃' },
    { pr: 4, verdict: 'CHECKER_FAILED', detail: '判据自身崩溃' },
  ])
  assert.notEqual(allCrash.exitCode, 0,
    '全 CHECKER_FAILED 时 verdict 不是 UNJUDGEABLE，故障名单看不见它 ⇒ 这一网必须是计数判据而不是名单')
})

// ── 23b) 混合轮：量到一笔**并且**另有工具故障 ⇒ 仍必须非零、且不写评论 ────────────────
// 这条是被变异反证逼出来的：第一轮 M-D3（退出码只看零测量）在 34 条全绿里**没有对手**——
// 既有夹具的故障样本都是"整轮零测量"形状，于是"部分失明"这一格从未被表示过。
// 判据早就写了 `toolFault || zeroMeasurement`，但只有断言能让它有牙。
test('混合轮：一笔量到 + 一笔工具故障 ⇒ 非零退出且不写评论（部分失明不得当完整结论）', () => {
  const s = R.summarize([
    { pr: 1, verdict: 'VIOLATES', detail: 'maxFileLines 610 > 500' },
    { pr: 2, verdict: 'UNJUDGEABLE', reason: 'merge-commit-failed', stage: 'commit-tree', detail: 'fatal: x' },
  ])
  assert.equal(s.measured, 1, '计数侧要如实分开：量到 1 笔、失明 1 笔')
  assert.notEqual(s.exitCode, 0, '有失明就不许把这一轮报成完整结论——否则"部分没量到"永远静默')
  assert.equal(s.shouldComment, false, '失明的那笔没结论，而点名要求"这一轮量的是全部在飞 PR"；半份结论不得写成判决')
})

// ── 24) 锁 C：三个失败单位三个档名（切片 C 把三者抄成一个 worktree-setup，修的人无法按档名定位）──
test('三个失败单位三个档名，且 seam 未装配仍是 worktree-setup', () => {
  const mk = (over) => Object.assign({
    pr: { number: 3 },
    classify: () => ({ ok: true, treeOid: 'a'.repeat(40) }),
    commitTree: () => ({ rc: 0, commitOid: 'c'.repeat(40), stderr: '' }),
    worktreeAdd: () => ({ rc: 0, dir: '/tmp/wt', stderr: '' }),
    runChecker: () => ({ rc: 0, stdout: 'DEBT WITHIN BASELINE', stderr: '' }),
  }, over)
  const noSeam = R.evaluatePr(mk({ commitTree: undefined }))
  assert.equal(noSeam.reason, 'worktree-setup', '"工具没装配好"这一档名保留给 seam 缺失（切片 C 既有合同）')
  assert.equal(noSeam.stage, 'seam')
  const ct = R.evaluatePr(mk({ commitTree: () => ({ rc: 128, commitOid: '', stderr: 'fatal: Unable to auto-detect email address\n' }) }))
  assert.equal(ct.reason, 'merge-commit-failed', `合成提交失败必须有自己的档名；实际=${JSON.stringify(ct)}`)
  assert.equal(ct.stage, 'commit-tree')
  assert.match(ct.detail, /Unable to auto-detect email address/, '现场（失败命令首行 stderr）必须随条目出来，否则下一轮还是猜')
  const wa = R.evaluatePr(mk({ worktreeAdd: () => ({ rc: 128, dir: '', stderr: 'fatal: already checked out at ...\n' }) }))
  assert.equal(wa.reason, 'merge-worktree-failed', `只读检出失败必须是另一档；实际=${JSON.stringify(wa)}`)
  assert.equal(wa.stage, 'worktree-add')
  assert.match(wa.detail, /already checked out/)
  assert.ok(ct.reason !== wa.reason && wa.reason !== noSeam.reason, '三档名互不相同')
  for (const r of ['worktree-setup', 'merge-commit-failed', 'merge-worktree-failed']) {
    assert.ok(R.TOOL_FAULT_REASONS.includes(r), `${r} 属工具侧故障，必须在故障档里（本次事故就是 worktree-setup 漏了）`)
    assert.ok(R.UNJUDGEABLE_REASONS.includes(r), `${r} 必须在封闭词表里`)
  }
})

// ── 25) 锁 E：归类表只有一处真源，非法值在**加载时**就抛 ───────────────────────────────
test('归类表派生词表与故障档；值非法 ⇒ assertReasonClass 当场点名（模块加载即经过它）', () => {
  assert.ok(R.REASON_CLASS && typeof R.REASON_CLASS === 'object', '必须有一张 reason→归类 表')
  assert.deepEqual(Object.keys(R.REASON_CLASS).slice().sort(), R.UNJUDGEABLE_REASONS.slice().sort(),
    '词表必须由归类表派生；手抄第二份名单就是本次事故的成因')
  assert.deepEqual(R.TOOL_FAULT_REASONS.slice().sort(),
    Object.keys(R.REASON_CLASS).filter((k) => R.REASON_CLASS[k] === 'tool-fault').sort(),
    '故障档必须由归类表派生，不得再写一遍')
  assert.deepEqual(Object.keys(R.REASON_CLASS).filter((k) => R.REASON_CLASS[k] === 'other-pr'), ['conflict'],
    '只有"别人 PR 真冲突"不算本工具故障')
  assert.throws(() => R.assertReasonClass({ conflict: 'other-pr', 'x-future': '' }), /x-future/,
    '空值/第三种值必须被点名——否则它既不算故障也不算 conflict，会被静默退 0')
  assert.doesNotThrow(() => R.assertReasonClass(R.REASON_CLASS))
  const src = toolSources()
  assert.ok(/(?:const|let)\s+REASON_CLASS\s*=\s*assertReasonClass\(/.test(src),
    '真表必须在模块加载处过一遍校验（只导出一个校验函数没人调 = 装饰性校验）')
})

// ── 26) 锁 D + 锁 F：现场要出现在日志/评论里，两条路对同一阶段必须报同一档 ────────────────
test('现场进逐条日志与评论表格；mergedTreeEvidence 与 evaluatePr 对同一阶段报同一档名', () => {
  const failing = { commitTree: () => ({ rc: 128, commitOid: '', stderr: 'fatal: no allowed user identity here\n' }) }
  const w = recheckWorld({ env: { MP_REPO: 'o/r' }, seams: failing })
  assert.ok(w.logs.some((l) => /merge-commit-failed/.test(l) && /no allowed user identity/.test(l)),
    '逐条日志必须同时带档名与失败命令首行；实际日志=' + JSON.stringify(w.logs.slice(0, 6)))

  const body = R.renderComment({
    entries: [{ pr: 21, verdict: 'UNJUDGEABLE', reason: 'merge-commit-failed', detail: 'fatal: synthetic case' }],
    baseSha: 'a'.repeat(40), judgedAt: '2026-10-22T00:00:00Z',
  })
  assert.match(body, /merge-commit-failed/, '评论现场列必须写档名')
  assert.match(body, /synthetic case/, '评论现场列必须带得出现场，否则点名等于没点名')

  const mkGit = (failAt) => (args) => {
    const j = args.join(' ')
    if (j.startsWith('merge-tree')) return { rc: 0, stdout: 'd'.repeat(40) + '\n', stderr: '' }
    if (/(^|\s)commit-tree(\s|$)/.test(j)) {
      return failAt === 'commit-tree'
        ? { rc: 128, stdout: '', stderr: 'fatal: empty ident name not allowed\n' }
        : { rc: 0, stdout: 'e'.repeat(40) + '\n', stderr: '' }
    }
    if (j.startsWith('worktree add')) return failAt === 'worktree-add' ? { rc: 128, stdout: '', stderr: 'fatal: already registered\n' } : { rc: 0, stdout: '', stderr: '' }
    return { rc: 0, stdout: '', stderr: '' }
  }
  const evArgs = { repo: 'X', baseSha: 'b'.repeat(40), headSha: 'h'.repeat(40), inspect: () => 1 }
  const c1 = R.mergedTreeEvidence(Object.assign({}, evArgs, { git: mkGit('commit-tree') }))
  assert.equal(c1.built, false)
  assert.equal(c1.reason, 'merge-commit-failed', `构造函数那条路必须与判决那条路档位同源；实际=${JSON.stringify(c1)}`)
  assert.match(c1.detail, /empty ident name/)
  const c2 = R.mergedTreeEvidence(Object.assign({}, evArgs, { git: mkGit('worktree-add') }))
  assert.equal(c2.reason, 'merge-worktree-failed')
  assert.equal(c2.reason, R.evaluatePr({
    pr: { number: 5 }, classify: () => ({ ok: true, treeOid: 'a'.repeat(40) }),
    commitTree: () => ({ rc: 0, commitOid: 'c'.repeat(40) }),
    worktreeAdd: () => ({ rc: 128, dir: '', stderr: 'fatal: already registered\n' }),
    runChecker: () => { throw new Error('不该被调用') },
  }).reason, '同一失败阶段在两处必须是同一个名字，否则"边数"会各改一半')
})

// ── 27) 锁 G：生产默认装配必须被真跑到（现有 25 条全注入替身 ⇒ 默认闭包里的笔误结构性不可见）──
// 这条**不注入** classify/commitTree/worktreeAdd/runChecker，只注入网络面 gh 与一个真临时仓库；
// 真跑 merge-tree → commit-tree → worktree add → 真 spawn process.execPath 判据桩。
// 注意夹具显式声明了 user.email/user.name：因此本锁**证不了**"CI 上没有身份会怎样"（那格仍未证实，
// 由 detail 字段交给下一次真实运行报出来）。把默认 runChecker 路径改错一个字母，本锁必须红。
function makeLiveWorld (stubRc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `debt-recheck-live-${process.pid}-${Date.now()}-`))
  const remote = path.join(root, 'remote')
  const clone = path.join(root, 'clone')
  const run = (cwd, args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
    assert.equal(r.status, 0, `git ${args.join(' ')} (cwd=${cwd}) 失败：${r.stderr}`)
    return (r.stdout || '').trim()
  }
  fs.mkdirSync(remote, { recursive: true })
  run(remote, ['init', '-q', '-b', 'main'])
  run(remote, ['config', 'commit.gpgsign', 'false'])
  // 夹具的 bootstrap 提交用显式 -c 带身份：克隆出来的仓库**不配任何身份**，
  // 这样被测的合成提交就只能靠自己的参数拿身份（见下面 live() 前后的 env 装卸）。
  const IDE = ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t']
  fs.mkdirSync(path.join(remote, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(remote, 'scripts', 'debt-baseline.json'), '{"maxFileLines":500}\n')
  fs.writeFileSync(path.join(remote, 'scripts', 'check-debt-budget.js'),
    'console.log("DEBT WITHIN BASELINE (stub)"); process.exit(' + (Number(stubRc) || 0) + ')\n')
  fs.writeFileSync(path.join(remote, 'a.txt'), 'base\n')
  run(remote, ['add', '.'])
  run(remote, IDE.concat(['commit', '-q', '-m', 'base']))
  run(remote, ['checkout', '-q', '-b', 'pr11'])
  fs.writeFileSync(path.join(remote, 'a.txt'), 'base\npr line\n')
  run(remote, ['add', '.'])
  run(remote, IDE.concat(['commit', '-q', '-m', 'pr touches only a.txt']))
  run(remote, ['update-ref', 'refs/pull/11/head', run(remote, ['rev-parse', 'HEAD'])])
  run(remote, ['checkout', '-q', 'main'])
  run(root, ['clone', '-q', remote, clone])
  // 克隆里**不配任何身份**，并在 live() 期间把 GIT_CONFIG_GLOBAL/SYSTEM 指到空文件、清掉 author/committer env：
  // 合成提交对身份的依赖不得由宿主配置兜着（实现评审 i5）。本机探针实测无身份时
  // `git commit-tree` rc=128 / "Author identity unknown"，带 -c 则 rc=0 —— 对照读数见下面 probe。
  const emptyCfg = path.join(root, 'empty.gitconfig')
  fs.writeFileSync(emptyCfg, '')
  const IDENTITY_KEYS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL',
    'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL', 'NAME']
  const savedIdent = {}
  for (const k of IDENTITY_KEYS) { savedIdent[k] = process.env[k]; delete process.env[k] }
  process.env.GIT_CONFIG_GLOBAL = emptyCfg
  process.env.GIT_CONFIG_SYSTEM = emptyCfg
  // 前置自证：解析出的 toplevel 必须就是这个克隆。GIT_DIR/GIT_WORK_TREE 若从宿主泄漏，
  // 这里当场红——不得让它安静地对着别人的仓跑完再报"量到了"（本仓记过同型夹具事故）。
  assert.equal(path.resolve(run(clone, ['rev-parse', '--show-toplevel'])), path.resolve(clone),
    '默认装配锁必须确认自己操作的是临时仓库')
  const logs = []
  const gh = (args) => {
    const j = args.join(' ')
    if (j.startsWith('pr list')) return { status: 0, stdout: JSON.stringify([{ number: 11, title: 'pr only' }]), stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  let rc
  let probe = 'unknown'
  try {
    rc = R.live({ repoDir: clone, env: { MP_REPO: 'o/r' }, gh, log: (m) => logs.push(String(m)) })
    // 对照探针必须在**同一份 env 现场里**取。上一版把它放在 finally 之后，宿主配置已经装回来，
    // 于是裸 commit-tree 照样成功——探针把自己的现场错位读成"这台机器能自造身份"（本仓第一跑就撞上）。
    const tree = run(clone, ['rev-parse', 'HEAD^{tree}'])
    const parent = run(clone, ['rev-parse', 'HEAD'])
    const bare = spawnSync('git', ['-C', clone, 'commit-tree', tree, '-p', parent, '-m', 'probe'], { encoding: 'utf8' })
    probe = bare.status === 0 ? 'identity-self-invented' : 'identity-required'
  } finally {
    for (const [k, v] of Object.entries(savedIdent)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  return { root, clone, logs, rc, probe }
}

test('生产默认装配真跑：不注入任何 seam 也必须量到那一笔（判据桩 exit 0 ⇒ IN_BASELINE）', () => {
  const world = makeLiveWorld(0)
  try {
    assert.ok(world.logs.some((l) => l.includes('pr=11') && l.includes('verdict=IN_BASELINE')),
      '默认闭包必须真跑完 merge-tree→commit-tree→worktree add→spawn 判据；实际日志=' + JSON.stringify(world.logs))
    assert.ok(!world.logs.some((l) => /verdict=UNJUDGEABLE/.test(l)), '任何一档 UNJUDGEABLE 都意味着默认链没接通')
    assert.equal(world.rc, 0, `量到了且合规必须退 0；实际 rc=${world.rc} 日志=${JSON.stringify(world.logs)}`)
    assert.ok(world.logs.some((l) => /MEASURED=1/.test(l)), '测量留痕行必须由 live() 真打出来（只在纯函数里存在 = 装饰）')
  } finally {
    try { fs.rmSync(world.root, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
})

test('生产默认装配真跑（判决侧）：判据桩 exit 1 ⇒ VIOLATES，不是任何 UNJUDGEABLE', () => {
  const world = makeLiveWorld(1)
  try {
    assert.ok(world.logs.some((l) => l.includes('pr=11') && l.includes('verdict=VIOLATES')),
      '判据返回非零必须走成 VIOLATES；实际日志=' + JSON.stringify(world.logs))
    assert.ok(!world.logs.some((l) => /verdict=UNJUDGEABLE|verdict=CHECKER_FAILED/.test(l)),
      '把"违规"演成"量不到"会让故障计数与判决互相顶罪（默认路径拼错正是这一形态）')
  } finally {
    try { fs.rmSync(world.root, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
})

// ── 28) 锁 I（设计评审 i5）：宿主带着 GIT_DIR 会**压过** `git -C` ⇒ 整轮读数来自别人的仓库 ──
// 拆成两条用例是**判据分辨率**要求：摘掉剔除（M-D11）与把告警改成 no-op（M-D12）都必须指名红，
// 写在同一条里两者红集逐字相同 ⇒ 锁分辨不了这两种退化。
const GIT_ENV_FIXTURE = () => {
  const V = require('./lib/debt-recheck-live.js')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `debt-recheck-env-${process.pid}-${Date.now()}-`))
  const mk = (name, subject) => {
    const dir = path.join(root, name)
    fs.mkdirSync(dir, { recursive: true })
    const init = spawnSync('git', ['init', '-q', '-b', 'main', dir], { encoding: 'utf8' })
    assert.equal(init.status, 0, '临时仓库建不起来（探针本身坏了）：' + init.stderr)
    fs.writeFileSync(path.join(dir, 'f.txt'), subject)
    const env = Object.assign({}, process.env, { GIT_DIR: path.join(dir, '.git'), GIT_WORK_TREE: dir })
    const add = spawnSync('git', ['add', 'f.txt'], { cwd: dir, encoding: 'utf8', env })
    assert.equal(add.status, 0, 'add 失败：' + add.stderr)
    const c = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', subject], { cwd: dir, encoding: 'utf8', env })
    assert.equal(c.status, 0, 'commit 失败：' + c.stderr)
    return dir
  }
  const A = mk('a', 'AAA-only')
  const B = mk('b', 'BBB-only')
  const saved = {}
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) { saved[k] = process.env[k]; delete process.env[k] }
  return {
    V, A, B, root,
    polluted: () => Object.assign({}, process.env, { GIT_DIR: path.join(B, '.git') }),
    withPolluted: (fn) => { process.env.GIT_DIR = path.join(B, '.git'); try { return fn() } finally { delete process.env.GIT_DIR } },
    cleanup: () => {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
      try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 夹具 */ }
    },
  }
}

test('GIT_DIR 泄漏（行为侧）：剔除后读数仍来自 repoDir；对照格证明 hazard 真实存在', () => {
  const f = GIT_ENV_FIXTURE()
  try {
    // 对照格：不剔 env 直接问 ⇒ 必须读到 B。这一格证明 hazard 在本机真实存在，
    // 否则"仍读到 A"那句就是在测一个不会发生的行为（恒真的锁 = 装饰性门禁）。
    const raw = spawnSync('git', ['-C', f.A, 'log', '-1', '--format=%s'], { encoding: 'utf8', env: f.polluted() })
    assert.equal(String(raw.stdout).trim(), 'BBB-only',
      '对照组没被 GIT_DIR 带跑 ⇒ 本机的 git 不采纳它，这条锁失去测量对象（须如实承认并换判据来源，不得留恒真断言）')
    // ⚠ 判据选择是当场量出来的：`--show-toplevel` 在"GIT_DIR=B 且未设 GIT_WORK_TREE"时**照样回 A**
    //   （本机探针：同一现场 subject=BBB 而 toplevel=A），拿它当判据会写出一条恒真的锁。
    const git = f.V.gitRunner(f.A, () => {})
    const top = f.withPolluted(() => git(['log', '-1', '--format=%s']))
    assert.equal(top.rc, 0, `读数失败=探针坏了，不得读成"没泄漏"：${top.stderr}`)
    assert.equal(String(top.stdout).trim(), 'AAA-only',
      `带 GIT_DIR 时整轮会去量别人的仓库 ⇒ 每条读数都是假的；实际读到=${JSON.stringify(String(top.stdout).trim())}`)
  } finally { f.cleanup() }
})

test('GIT_DIR 泄漏（告警侧）：剔除必须出声一次，没剔除不得虚报；gitSafeEnv 只动那三个键', () => {
  const V = require('./lib/debt-recheck-live.js')
  const dirty = V.gitSafeEnv({ PATH: 'x', GIT_DIR: '/elsewhere/.git', GIT_INDEX_FILE: '/tmp/i' })
  assert.ok(!('GIT_DIR' in dirty.env) && !('GIT_INDEX_FILE' in dirty.env),
    '这三个键必须剔除（它们压过 -C）；实际留下=' + JSON.stringify(Object.keys(dirty.env)))
  assert.equal(dirty.env.PATH, 'x', '其余 env 原样带着——全清 env 会让 git 连自己的配置都读不到')
  assert.deepEqual(dirty.stripped.slice().sort(), ['GIT_DIR', 'GIT_INDEX_FILE'])
  assert.deepEqual(V.gitSafeEnv({ PATH: 'x' }).stripped, [], '没污染时不得虚报一条告警（告警噪声会让人学会忽略它）')
  const notes = []
  V.envDefectNotice(['GIT_DIR'], (m) => notes.push(String(m)))
  V.envDefectNotice([], (m) => notes.push(String(m)))
  assert.equal(notes.length, 1, '剔除必须出声；静默剔除 = "本机环境一直有问题"永远不被知道')
  assert.match(notes[0], /另一个仓库/, '告警要写明后果，不然读起来像例行提示')
  const f = GIT_ENV_FIXTURE()
  try {
    const logged = []
    const git = f.V.gitRunner(f.A, (m) => logged.push(String(m)))
    f.withPolluted(() => git(['log', '-1', '--format=%s']))
    assert.ok(logged.some((l) => /GIT_DIR/.test(l)), '由 gitRunner 触发的运行必须自己把剔除现场打出来')
  } finally { f.cleanup() }
})
// ── 29) 锁 H：默认闭包必须把 stderr 透出来（否则"可归因"只在注入面成立，生产面仍是空的）──
// 这条只把 git 传输层换掉，commitTree/worktreeAdd/runChecker 一律用生产默认实现。
// 切片 C 的默认闭包 `return { rc, commitOid }` 不带 stderr ⇒ excerptOf 恒空 ⇒ 现场形同不存在。
test('默认 commitTree 遇到 git 失败 ⇒ 日志必须带出该命令的 stderr 首行', () => {
  const w = recheckWorld({
    env: { MP_REPO: 'o/r' },
    skipSeams: ['commitTree', 'worktreeAdd', 'runChecker'],
    commitTreeRc: 128,
    commitTreeStderr: 'fatal: empty ident name (for <>) not allowed\n',
  })
  assert.ok(w.gitCalls.some((a) => /(^|\s)commit-tree(\s|$)/.test(a)), '默认闭包必须真的发出 commit-tree（否则这条测的是假实现）')
  assert.ok(w.logs.some((l) => /merge-commit-failed/.test(l) && /empty ident name/.test(l)),
    '档名 + 失败命令首行必须同时出现在逐条日志里；实际日志=' + JSON.stringify(w.logs.slice(0, 6)))
})

// ── 30) 锁 J（实现评审 i5）：合成提交不得依赖"环境里恰好配了身份" ─────────────────────
// §27 那两条现在跑在"取不到任何身份"的现场里（夹具摘光了配置与 env），所以行为侧已被它们覆盖；
// 这里补两格：① 对照探针必须证明这一格在本机可表示（否则那条锁只是形式，要如实点名）；
// ② 默认闭包必须**真的把身份参数发进 argv**（用记录型 git 传输层看命令行，不注入 commitTree）。
test('身份对照：夹具现场里裸 commit-tree 必须失败，摘掉身份后默认链仍必须量到那一笔', () => {
  const world = makeLiveWorld(0)
  try {
    console.log('  [ident-probe] ' + world.probe)
    assert.equal(world.probe, 'identity-required',
      '这台机器的 git 能自造身份 ⇒ "无身份"这一现场不可表示，§27 那两条锁在此平台上是形式。'
      + '正解是换判据来源（例如显式断言 argv），不是把这条断言放宽；实际=' + world.probe)
    assert.ok(world.logs.some((l) => l.includes('verdict=IN_BASELINE')),
      '摘掉一切身份来源后默认链仍必须量到那一笔；实际日志=' + JSON.stringify(world.logs))
    assert.equal(world.rc, 0, '量到了且合规就必须退 0；实际 rc=' + world.rc)
  } finally {
    try { fs.rmSync(world.root, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
})

test('默认闭包把身份参数发进 argv；两处 commit-tree 都挂同一份身份常量', () => {
  const w = recheckWorld({ env: { MP_REPO: 'o/r' }, skipSeams: ['commitTree', 'worktreeAdd', 'runChecker'] })
  const ct = w.gitCalls.filter((a) => /(^|\s)commit-tree(\s|$)/.test(a))
  assert.equal(ct.length, 2, '夹具默认两笔 PR ⇒ 应发两次 commit-tree；实际=' + JSON.stringify(ct))
  for (const a of ct) {
    assert.match(a, /-c user\.name=\S+ -c user\.email=\S+ commit-tree/,
      '每次合成提交都必须自带身份，不得依赖宿主 git 配置；实际=' + JSON.stringify(a))
  }
  const src = fs.readFileSync(path.join(__dirname, 'lib', 'debt-recheck-live.js'), 'utf8').split('\r\n').join('\n')
  assert.equal((src.match(/SYNTHETIC_IDENTITY\.concat\(\['commit-tree'/g) || []).length, 2,
    '判决那条路与构造那条路都必须挂同一份身份常量——漏一处就是只修一半')
})
