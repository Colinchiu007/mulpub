// Regression tests for scripts/check-pr-exec-record.js
//
// Why (change enforce-gate-record-presence): on origin/main, 47 of 132 non-docs-only PRs in a
// 3-day window never touched `.quality-gates.md`, and 32 of those DID record gate reasoning in the
// PR body — but only 2 ever mentioned the `远程同步` row, i.e. the single thing the existing gate
// can actually check. The old checker presupposes a record exists, so "no record at all" is
// invisible to it by design (recorded as an unclosed hole in #2570's own 遗留).
//
// Facts locked here, each measured before being relied on:
//   * this repo lands PRs as SQUASH commits => the landing commit is SINGLE-PARENT. An earlier
//     probe used `git rev-list --merges` and found almost nothing; the window is walked with
//     `--first-parent` instead.
//   * `docs-only` classification must come from the SAME whitelist object as the CI changes job
//     (exported by classify-docs-only.js) — a second whitelist is the documented failure mode.
//   * the change-set is acquired once (changedFileStatuses) and this script MUST NOT shell out to
//     `git diff` itself; otherwise two predicates can disagree about "which files did this PR touch"
//     and produce an unattributable red.
//
//   node --test scripts/check-pr-exec-record.test.js

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const mod = require('./check-pr-exec-record.js')

const st = (list) => list.map(([status, file]) => ({ status, file }))

test('新增一篇记录文件即通过（判据只看本 PR 的变更集）', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/my-task.md'], ['M', 'apps/desktop/src/a.js']]),
    headBranch: 'my-task',
    exemptOnDisk: [],
    remoteBranches: new Set(['main', 'my-task']),
  })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.deepStrictEqual(r.addedRecords, ['openspec/records/my-task.md'])
})

test('既无记录也无豁免必须变红，且输出两条可执行出路（不能只说"不合规"）', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'apps/desktop/electron/main.js']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(r.ok, false)
  const msg = r.reasons.join('\n')
  assert.match(msg, /openspec\/records\//, '必须给出"新增一篇记录文件"这条出路')
  assert.match(msg, /_exempt/, '必须给出"新增一篇带原因的豁免文件"这条出路')
})

test('豁免文件是合法出路，但原因必须非空（空原因等于静默绕过）', () => {
  const dir = mod.writeFixtureRepo ? null : null
  const good = mod.evaluate({
    statuses: st([['A', 'openspec/records/_exempt/bot-maint.md']]),
    headBranch: 'bot-maint',
    exemptOnDisk: [{ branch: 'bot-maint', reason: '纯依赖版本 bump，无可验证行为变化' }],
    remoteBranches: new Set(['main', 'bot-maint']),
  })
  assert.strictEqual(good.ok, true, JSON.stringify(good.reasons))
  const empty = mod.evaluate({
    statuses: st([['A', 'openspec/records/_exempt/lazy.md']]),
    headBranch: 'lazy',
    exemptOnDisk: [{ branch: 'lazy', reason: '   ' }],
    remoteBranches: new Set(['main', 'lazy']),
  })
  assert.strictEqual(empty.ok, false, '空白原因必须拒')
  assert.match(empty.reasons.join('\n'), /原因/)
})

test('变更集为空 ⇒ fail-closed 判红（"没取到文件"不等于"没改文件"）', () => {
  const r = mod.evaluate({ statuses: [], headBranch: 'x', exemptOnDisk: [], remoteBranches: new Set(['main']) })
  assert.strictEqual(r.ok, false)
  assert.match(r.reasons.join('\n'), /变更集为空|取证失败/)
})

test('只有 M/D 没有 A 不算新增记录（改别人的记录不等于自己写了记录）', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'openspec/records/other.md'], ['D', 'openspec/records/stale.md']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(r.ok, false, JSON.stringify(r))
  assert.deepStrictEqual(r.addedRecords, [])
})

test('模板与豁免模板自身不得算作记录（它们带 PENDING 行，算进去就是恒红/恒绿）', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/_TEMPLATE.md'], ['A', 'openspec/records/_exempt/_TEMPLATE.md']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.deepStrictEqual(r.addedRecords, [], '模板不得计入记录')
  assert.strictEqual(r.ok, false, '只交模板等于什么都没交')
})

test('同一分支同时交记录与豁免是矛盾，必须红（豁免只能在没有记录时用）', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/twin.md'], ['A', 'openspec/records/_exempt/twin.md']]),
    headBranch: 'twin',
    exemptOnDisk: [{ branch: 'twin', reason: '两个都交了' }],
    remoteBranches: new Set(['main', 'twin']),
  })
  assert.strictEqual(r.ok, false)
  assert.match(r.reasons.join('\n'), /矛盾|同时/)
})

test('已消费的豁免（分支已不在远端）先计入可见待清理数，未达阈值不拦', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/ok.md']]),
    headBranch: 'ok',
    exemptOnDisk: [
      { branch: 'gone-a', reason: '已合并的历史豁免' },
      { branch: 'gone-b', reason: '已关闭的历史豁免' },
    ],
    remoteBranches: new Set(['main', 'ok']),
    threshold: 3,
  })
  assert.strictEqual(r.consumedExempts.length, 2, JSON.stringify(r.consumedExempts))
  assert.strictEqual(r.ok, true, '2 < 3 不该拦：' + r.reasons.join('\n'))
  assert.match(r.summary(), /待清理豁免 2 条/)
})

test('待清理豁免达到阈值必须拦，且点名文件（删除是删自己那个文件，零同行竞争）', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/ok.md']]),
    headBranch: 'ok',
    exemptOnDisk: [
      { branch: 'g1', reason: 'a' }, { branch: 'g2', reason: 'b' }, { branch: 'g3', reason: 'c' },
    ],
    remoteBranches: new Set(['main', 'ok']),
    threshold: 3,
  })
  assert.strictEqual(r.ok, false)
  assert.match(r.reasons.join('\n'), /g1|g2|g3/, '必须点名待清理项')
})

test('远端分支清单取不到时，消费判定降级为 unknown 且必须出声（不得静默当 0）', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/ok.md']]),
    headBranch: 'ok',
    exemptOnDisk: [{ branch: 'maybe-gone', reason: 'x' }],
    remoteBranches: null, // 模拟 ls-remote 失败
    threshold: 3,
  })
  assert.strictEqual(r.consumedKnown, false, '必须标明"这一维没测到"')
  assert.match(r.summary(), /consumed=unknown/)
  assert.strictEqual(r.ok, true, '取不到远端不该判红，但必须留痕')
})

// ── 与真实 git 的接缝：证明"取变更集"这条链在真仓库里真的通 ──
test('真接缝：从真实 git 夹具取到的 statuses 能被判据正确处理（夹具不得替实现剥壳）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-record-'))
  const run = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  run(['init', '--quiet', '-b', 'main'])
  run(['config', 'user.email', 't@e.com']); run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'openspec/records'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'a.js'), '1')
  run(['add', '.']); run(['commit', '--quiet', '-m', 'base'])
  run(['checkout', '--quiet', '-b', 'feat'])
  fs.writeFileSync(path.join(dir, 'a.js'), '2')
  fs.writeFileSync(path.join(dir, 'openspec/records', 'feat.md'), 'x')
  run(['add', '-A']); run(['commit', '--quiet', '-m', 'c'])

  const statuses = require('./classify-docs-only.js').changedFileStatuses({ repo: dir, base: 'main', head: 'feat' })
  const r = mod.evaluate({ statuses, headBranch: 'feat', exemptOnDisk: [], remoteBranches: new Set(['main', 'feat']) })
  assert.deepStrictEqual(r.addedRecords, ['openspec/records/feat.md'], JSON.stringify(statuses))
  assert.strictEqual(r.ok, true)
})

// ── 3.7 结构锁：不得出现第二份"本 PR 改了哪些文件"的口径 ──
test('本脚本必须复用 classify-docs-only 的取源，自己不得拼 git diff', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  const body = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
  assert.match(body, /require\(['"]\.\/classify-docs-only\.js['"]\)/, '必须引用共享取源模块')
  assert.match(body, /changedFileStatuses/, '必须调用 changedFileStatuses 而不是自取 diff')
  assert.doesNotMatch(body, /\[\s*['"]diff['"]/, '本脚本内不得出现自己的 git diff 调用')
  assert.doesNotMatch(body, /--name-only|--name-status/, '不得自带 diff flag（那是第二份口径）')
})

// ── D8：非阻断状态自身必须可被检测 ──
test('advisory 模式必须打印 MODE=advisory 且退出码为 0；enforce 模式下同一场景必须红', () => {
  const cli = (args) => {
    try {
      return { code: 0, out: execFileSync('node', [path.join(__dirname, 'check-pr-exec-record.js'), ...args], { encoding: 'utf8' }) }
    } catch (e) {
      return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') }
    }
  }
  const root = path.resolve(__dirname, '..')
  // 用 --statuses 注入一个"无记录"的变更集，避免依赖真实分支状态
  const adv = cli([`--repo=${root}`, '--base=HEAD', '--head=HEAD', '--statuses=[]', '--mode=advisory'])
  assert.strictEqual(adv.code, 0, adv.out)
  assert.match(adv.out, /MODE=advisory/, 'advisory 模式必须自报身份，否则没人知道它没在拦')
  const enf = cli([`--repo=${root}`, '--base=HEAD', '--head=HEAD', '--statuses=[]', '--mode=enforce'])
  assert.notStrictEqual(enf.code, 0, 'enforce 模式下同一输入必须红')
  assert.doesNotMatch(enf.out, /MODE=advisory/)
})

test('取证失败（base 不可解析）在 advisory 阶段不得判红，在 enforce 阶段必须判红', () => {
  const cli = (args) => {
    try {
      return { code: 0, out: execFileSync('node', [path.join(__dirname, 'check-pr-exec-record.js'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    } catch (e) { return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') } }
  }
  const root = path.resolve(__dirname, '..')
  const bad = `--base=no-such-ref-xyz-${process.pid}`
  const adv = cli([`--repo=${root}`, bad, '--head=HEAD', '--mode=advisory'])
  assert.strictEqual(adv.code, 0, '浅克隆/坏 base 不该在 advisory 阶段红：\n' + adv.out)
  assert.match(adv.out, /MODE=advisory/)
  const enf = cli([`--repo=${root}`, bad, '--head=HEAD', '--mode=enforce'])
  assert.notStrictEqual(enf.code, 0, 'enforce 阶段取不到证据必须红（fail-closed）')
})

// ── #2745 结构锁：本判据的输入在 docs-only 白名单里，它自己却住在被 docs-only 短路的 job ──
// 为什么必须锁 workflow 正文而不是脚本行为：`openspec/records/**` 命中 CI_IGNORED_PATHS 的
// `openspec/**`，而 `static-gates` 整个 job 被 `if: needs.changes.outputs.docs-only != 'true'` 门控。
// 于是「整篇没写执行记录」最高发的纯文档 PR，恰好是这条判据一次都不会执行的那一类。
// 短路真实发生过（不是理论）：PR #2732 判 docs-only=true，rollup 里 QG Static = SKIPPED 且照样合并。
// 同族先例与修法：`scripts/gate-record-debt-ledger.json` 同坑，PR #2718 把它自己的门禁搬进
// changes job 并留下位置判据 —— 本锁按同一形状写。
const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml')
const GATE_TEST_CMD = 'node --test scripts/check-pr-exec-record.test.js'
const GATE_CLI_CMD = 'node scripts/check-pr-exec-record.js'

// 工作区里的 .yml/.js 在本机是 CRLF（blob 才是 LF，且 core.autocrlf=false ⇒ 两者可以不一致）。
// 结构解析一律先归一到 LF 域，否则 '\njobs:\n' 这类锚点会被 '\r\n' 整条打穿 —— 表现是
// "锚点找不到"而不是"判据不成立"，读起来像 workflow 坏了。归一只用于解析，不回写文件。
//
// 同时剥离 YAML 注释行（QM-6 降级通道第一路命中 W2）：这些锁按**子串**匹配命令串，
// 若匹配域含注释，把真实步骤注释掉、只留一条含同字符串的注释，`at >= 0` 照样通过 ——
// 那是本仓点名的"装饰性门禁"。注释里提前出现字面 `exit 0` 也会污染"早于早退"的位置比较。
function stripYamlComments (text) {
  return text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
}

function readWorkflowForParse () {
  const rawBytes = fs.readFileSync(WORKFLOW_PATH, 'utf8')
  const crlf = (rawBytes.match(/\r\n/g) || []).length
  const raw = rawBytes.replace(/\r\n/g, '\n')
  assert.ok(raw.includes('\njobs:\n'), 'quality-gate.yml 里找不到 jobs: 段 —— 结构锁的锚点失效，须改锁不得改判据')
  const wf = stripYamlComments(raw)
  assert.ok(wf.length < raw.length, '剥离注释没有产生差异 —— 夹具里没有注释，这条域判据测不到东西')
  return { raw, wf, crlf }
}

function jobsOf (wf) {
  const blocks = {}
  let cur = null
  for (const line of wf.slice(wf.indexOf('\njobs:\n') + '\njobs:\n'.length).split('\n')) {
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (job) { cur = job[1]; blocks[cur] = ''; continue }
    if (/^[A-Za-z0-9_-]+:\s*$/.test(line)) { cur = null; continue }
    if (cur !== null) blocks[cur] += line + '\n'
  }
  assert.ok(Object.keys(blocks).length > 5,
    `解析出的 job 数只有 ${Object.keys(blocks).length} —— 解析退化，空/半空集合不得当作"没接线"的证据`)
  return blocks
}

test('#2745 前提：openspec/records 仍被同一份白名单判为 docs-only（前提变了须连同本锁重评）', () => {
  const classifier = require('./classify-docs-only.js')
  assert.ok(
    classifier.isDocsOnly(['openspec/records/some-branch.md']),
    'openspec/records 不再判为 docs-only ⇒ 短路前提消失，接线位置判据应连同白名单一起重新评估',
  )
})

test('#2745：门禁必须住在 changes job、住在 classify 步骤之后，且不得再留在 static-gates', () => {
  const { wf, crlf } = readWorkflowForParse()
  const jobs = jobsOf(wf)
  process.stdout.write(`[gate-2c2-wiring] worktree_crlf=${crlf} jobs=${Object.keys(jobs).length}\n`)
  assert.ok(jobs.changes && jobs.changes.length > 0, '未取到 changes job 正文')
  assert.ok(jobs['static-gates'] && jobs['static-gates'].length > 0, '未取到 static-gates job 正文')
  const classifyAt = jobs.changes.indexOf('- name: Detect docs-only changes')
  assert.ok(classifyAt >= 0, '未定位到 classify 步骤 —— 顺序判据失去锚点（改锁不得改判据）')
  for (const cmd of [GATE_TEST_CMD, GATE_CLI_CMD]) {
    const hits = wf.split(cmd).length - 1
    assert.strictEqual(hits, 1, `${cmd} 在 workflow 正文里出现 ${hits} 次：接线位置必须只有一处真源`)
    const at = jobs.changes.indexOf(cmd)
    assert.ok(at >= 0, `${cmd} 不在 changes job 里 ⇒ 纯文档 PR 短路 static-gates 后无人校验执行记录存在性`)
    // 后置于 classify 的理由（外部评审实测，纠正我原先"早于早退才覆盖 push"的判断）：
    // step 内的 `exit 0` 只结束该 step 的 shell，后续 step 照跑 ⇒ "早于早退"不换来任何覆盖差异；
    // 反过来，把这一步摆在 classify 之前，它一红（shell: bash 的 fail-fast）就让 changes job
    // 在写出 steps.classify.outputs.docs-only 之前中止，docs-only 判定整条消失、下游重型 job 全部跑满。
    assert.ok(at > classifyAt, `${cmd} 必须在 classify 步骤之后：本步不得先于 docs-only 输出，否则它一红就摧毁判定`)
    assert.ok(!jobs['static-gates'].includes(cmd), `${cmd} 仍留在被 docs-only 门控的 static-gates（接线未搬走）`)
  }
})

test('#2745：changes job 自身必须无条件执行（否则"搬到 changes 就覆盖纯文档 PR"这句承诺是空的）', () => {
  const { wf } = readWorkflowForParse()
  const changes = jobsOf(wf).changes
  assert.ok(!/^ {4}if:/m.test(changes),
    'changes job 出现了 job 级 if —— 一旦它按事件门控，搬到这里的门禁就不再覆盖纯文档 PR，而其余锁照绿')
  assert.ok(!/needs\.[a-z0-9-]+\.outputs\.docs-only/i.test(changes),
    'changes job 用别处产出的 docs-only 作门控 —— 它就是产出方，引用即自指')
})

test('#2745：static-gates 仍由 docs-only 门控（本锁的机制前提，被人摘掉门控时须连同本锁重评）', () => {
  const { wf } = readWorkflowForParse()
  const jobs = jobsOf(wf)
  assert.match(
    jobs['static-gates'],
    /if:\s*needs\.changes\.outputs\.docs-only\s*!=\s*'true'/,
    'static-gates 不再被 docs-only 门控 ⇒ 本锁的前提消失，须重新评估而不是把锁改成恒真',
  )
})

test('#2745：搬过去那一步必须用 step 级 env 声明 PR base，并保持 advisory（转阻断是单独一次有意动作）', () => {
  const { wf } = readWorkflowForParse()
  const changes = jobsOf(wf).changes
  const from = changes.indexOf(GATE_TEST_CMD)
  assert.ok(from >= 0, '门禁未接线进 changes job')
  const stepStart = changes.lastIndexOf('\n      - ', from)
  assert.ok(stepStart >= 0, '取不到承载门禁的那个 step 的起点 —— 结构解析退化')
  const nextStep = changes.indexOf('\n      - ', from)
  const step = changes.slice(stepStart, nextStep > 0 ? nextStep : undefined)
  assert.match(step, /EXEC_BASE:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/,
    'PR base 必须由 step 级 env 声明（run 正文里禁止内联 ${{ }}，字面替换先于 bash 解析）')
  assert.match(step, /--base="\$\{EXEC_BASE:-\}"/,
    'base 必须可空：push 事件下脚本自己走「非 PR 不适用」分支，不得让每个 push run 被不适用自己的判据判红')
  // 分支名同样必须由 CI 侧注入：runner 上是 detached HEAD，`git rev-parse --abbrev-ref HEAD` 得到字面量
  // "HEAD"，只靠脚本自读会让"修订自己那篇记录"这条出路在 CI 上静默作废，而本机永远复现不了。
  assert.match(step, /EXEC_HEAD_REF:\s*\$\{\{\s*github\.event\.pull_request\.head\.ref\s*\}\}/,
    '必须由 step 级 env 注入 PR head 分支名（与 EXEC_BASE 同一模式）')
  assert.match(step, /--head-branch="\$\{EXEC_HEAD_REF:-\}"/,
    'CLI 必须收到 --head-branch，否则判据回落到 detached 的字面量 HEAD')
  assert.match(step, /--mode=advisory/,
    '本步必须仍是 advisory。转阻断 = 删掉这个参数，必须另 PR 并带实测影响面（本窗口 14/59 个纯文档 PR 在任何记录源里都没有记录）')
})

// ── #2745 顺带那条口径漂移：回填/修订型文档 PR 改的是自己那篇记录，却因没有 A 而判"没写记录" ──
test('M 自己分支那篇记录算「本 PR 携带了记录」；M 别人的记录仍不算', () => {
  const mine = mod.evaluate({
    statuses: st([['M', 'openspec/records/backfill-x.md']]),
    headBranch: 'backfill-x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main', 'backfill-x']),
  })
  assert.strictEqual(mine.ok, true, JSON.stringify(mine))
  assert.deepStrictEqual(mine.revisedRecords, ['openspec/records/backfill-x.md'])

  const theirs = mod.evaluate({
    statuses: st([['M', 'openspec/records/other.md']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(theirs.ok, false, '改别人的记录不等于自己写了记录 —— 放宽只能按分支名放宽')
  assert.deepStrictEqual(theirs.revisedRecords, [])
})

test('同分支记录被 M 时仍不得与新增豁免并存（矛盾判定不因此放宽）', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'openspec/records/twin.md'], ['A', 'openspec/records/_exempt/twin.md']]),
    headBranch: 'twin',
    exemptOnDisk: [{ branch: 'twin', reason: '两个都交了' }],
    remoteBranches: new Set(['main', 'twin']),
  })
  assert.strictEqual(r.ok, false)
  assert.match(r.reasons.join('\n'), /矛盾|同时/)
})

// ── QM-6 降级通道第一路命中（W1）：CI 上 rev-parse 得到 detached HEAD ⇒ 放宽判据永不触发 ──
// actions/checkout 在 PR 上是 detached HEAD，`git rev-parse --abbrev-ref HEAD` 必返回字面量 "HEAD"，
// 于是 ownRecordPath 退化成 openspec/records/HEAD.md，"M 自己那篇"永远匹配不上 ——
// 而 CI 恰是这条判据唯一真正生效的地方（本机永远有真分支名）。
test('分支名解析优先级：显式参数 > GITHUB_HEAD_REF > git rev-parse；detached 且无 env 时不得猜', () => {
  const r = mod.resolveHeadBranch
  assert.strictEqual(typeof r, 'function', '必须导出 resolveHeadBranch（判据可单测，不留给宿主猜）')
  assert.deepStrictEqual(r({ argBranch: 'from-arg', envHeadRef: 'from-env', gitBranch: 'feat' }),
    { branch: 'from-arg', source: 'arg' })
  assert.deepStrictEqual(r({ argBranch: '', envHeadRef: 'from-env', gitBranch: 'feat' }),
    { branch: 'from-env', source: 'env' })
  assert.deepStrictEqual(r({ argBranch: '', envHeadRef: '', gitBranch: 'feat' }),
    { branch: 'feat', source: 'git' })
  // detached：rev-parse 的字面量 HEAD 不是分支名，无 env 时必须落成空串（偏严，绝不猜成 "HEAD"）
  assert.deepStrictEqual(r({ argBranch: '', envHeadRef: '', gitBranch: 'HEAD' }),
    { branch: '', source: 'detached' })
  assert.deepStrictEqual(r({ argBranch: '', envHeadRef: 'x', gitBranch: 'HEAD' }),
    { branch: 'x', source: 'env' })
})

test('真接缝：真 detached HEAD 的 git 夹具 + GITHUB_HEAD_REF ⇒ 修订自己那篇记录判为已携带', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-record-detached-'))
  const run = (args, opts = {}) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', ...opts })
  run(['init', '--quiet', '-b', 'main'])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'test'])
  fs.mkdirSync(path.join(dir, 'openspec', 'records'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'openspec', 'records', 'feat.md'), '初稿\n', 'utf8')
  run(['add', '.']); run(['commit', '--quiet', '-m', 'base'])
  run(['checkout', '--quiet', '-b', 'feat'])
  fs.writeFileSync(path.join(dir, 'openspec', 'records', 'feat.md'), '回填远程同步行\n', 'utf8')
  run(['add', '-A']); run(['commit', '--quiet', '-m', 'backfill'])
  // 关键一步：与 PR runner 一致地摘掉分支，使 rev-parse --abbrev-ref HEAD 返回字面量 HEAD
  run(['checkout', '--quiet', '--detach'])
  assert.strictEqual(run(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'HEAD',
    '夹具没有真的进入 detached 状态 —— 本用例的前提消失')

  const cli = (env) => {
    try {
      return execFileSync(process.execPath, [
        path.join(__dirname, 'check-pr-exec-record.js'),
        `--repo=${dir}`, '--base=main', '--head=HEAD', '--mode=advisory', '--no-remote',
      ], { encoding: 'utf8', env: { ...process.env, ...env } })
    } catch (e) { return String(e.stdout || '') + String(e.stderr || '') }
  }
  const withEnv = cli({ GITHUB_HEAD_REF: 'feat' })
  assert.match(withEnv, /修订本分支记录 1 篇/, 'CI 侧（有 GITHUB_HEAD_REF）必须认得"修订自己那篇"')
  assert.match(withEnv, /OK: 本 PR 携带执行记录/)
  // 没有 env 时必须如实落到 detached，不得把字面量 HEAD 当分支名去匹配 openspec/records/HEAD.md
  const withoutEnv = cli({ GITHUB_HEAD_REF: '' })
  assert.doesNotMatch(withoutEnv, /openspec\/records\/HEAD\.md/, 'detached 时不得拿字面量 HEAD 当分支名')
  fs.rmSync(dir, { recursive: true, force: true })
})

// ── QM-6 降级通道两路共同命中（W2）：结构锁按子串命中，注释里的同名字符串不得算接线 ──
test('结构锁的匹配域必须剥离 YAML 注释（把真步骤改成注释即判"未接线"）', () => {
  const { raw, wf } = readWorkflowForParse()
  assert.ok(/\n\s*#/.test(raw), 'workflow 里没有注释行 —— 这条域判据测不到东西')
  assert.ok(!/^\s*#/m.test(wf.split('\n').filter((l) => l.includes(GATE_TEST_CMD))[0] || ''),
    '匹配域里仍含注释行')
  assert.ok(wf.includes(GATE_TEST_CMD), '正文里确实有接线（剥离注释后仍在）')
  // 把真实那一行注释掉：剥离后必须整条消失，否则"没接线"这一判据永远不会红（装饰性门禁）
  const masked = wf.replace('          ' + GATE_TEST_CMD, '          # ' + GATE_TEST_CMD)
  assert.ok(!stripYamlComments(masked).includes(GATE_TEST_CMD),
    '真步骤改成注释后仍被算作接线 —— 这条锁是装饰性的')
})

// ── QM-6 降级通道第一路命中（W3）：保留名撞上分支名时，"改模板"就满足判据 ──
test('保留名（_TEMPLATE 这类）即便等于分支名也不得算修订记录', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'openspec/records/_TEMPLATE.md']]),
    headBranch: '_TEMPLATE',
    exemptOnDisk: [],
    remoteBranches: new Set(['main', '_TEMPLATE']),
  })
  assert.deepStrictEqual(r.revisedRecords, [], 'RECORDS_RE 的保留名守卫必须同样作用于修订路径')
  assert.strictEqual(r.ok, false, '只改模板不得满足"本 PR 携带执行记录"')
})
