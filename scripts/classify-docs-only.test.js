// Regression tests for scripts/classify-docs-only.js
//
// Why this gate exists: pure-docs PRs must land via PR (layering rule) but pay a full
// 10-runner CI bill. The short-circuit introduced by change `docs-only-ci-shortcircuit`
// lets heavy jobs skip ONLY when every changed file is on the docs whitelist. The whole
// safety of that short-circuit rests on this classifier being fail-closed:
//   * empty input (or non-array) => false  (never skip tests on "no evidence")
//   * any file outside the whitelist => false (mixed PRs run full CI)
//   * the whitelist itself must stay identical to the push paths-ignore list
//     (single source: CI_IGNORED_PATHS exported here, imported by workflow-contract.test.js)
//
// Matching semantics locked by this file (deliberate, fail-closed):
//   * `dir/**`  => any path under dir/ (any depth)
//   * `*.md`    => ROOT-LEVEL .md only (mirrors GitHub docs: '*.{js,py}' matches root files);
//                 sub-directory .md must be covered by an explicit `dir/**` entry
//   * literal   => exact path match
//
//   node --test scripts/classify-docs-only.test.js

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const classifier = require('./classify-docs-only.js')

// ---------------------------------------------------------------------------
// Whitelist content (ratchet: identical to the push paths-ignore list)
// ---------------------------------------------------------------------------

test('CI_IGNORED_PATHS 清单内容被钉死（与 push paths-ignore 同源同值）', () => {
  assert.deepStrictEqual(classifier.CI_IGNORED_PATHS, [
    '01-docs/**',
    'docs/**',
    '*.md',
    'LICENSE',
    '.gitignore',
    '.editorconfig',
    '.ccg/**',
    '.claude/**',
    '.hermes/**',
    '.agents/**',
    'openspec/**',
    // 欠账账本：它是「门禁的数据」，不是运行时代码。前提见下方
    // 「进白名单的路径，它自己的门禁必须在 changes job 里无条件跑」那条锁 ——
    // 没有那条前提，把任何路径放进这份名单都会连带短路掉它自己的检查，
    // 因为 static-gates 整个 job 被 docs-only != 'true' 门控。
    'scripts/gate-record-debt-ledger.json',
  ])
})

test('白名单不得混入代码/依赖/CI 路径（混入即漏跑全量测试）', () => {
  const forbidden = ['apps/**', 'packages/**', '.github/**', 'pnpm-lock.yaml', 'package.json', 'config/**', 'ops-center/**']
  for (const f of forbidden) {
    assert.ok(
      !classifier.CI_IGNORED_PATHS.includes(f),
      `白名单不得包含 ${f}：这会让代码变更被误判为 docs-only`,
    )
  }
})

// ---------------------------------------------------------------------------
// isDocsOnly(files)
// ---------------------------------------------------------------------------

test('全部文件命中白名单 => true', () => {
  assert.strictEqual(
    classifier.isDocsOnly([
      'CHANGELOG.md',
      'README.md',
      'AGENTS.md',
      '.quality-gates.md',
      'LICENSE',
      '.gitignore',
      '.editorconfig',
      '01-docs/PRD.md',
      '01-docs/rpa-api-publish/evidence/live-acceptance-pass-20260928.md',
      'docs/adr/0002.md',
      'openspec/changes/docs-only-ci-shortcircuit/proposal.md',
      'openspec/specs/ci-path-gating/spec.md',
      '.ccg/commands/frontend_task_id.md',
      '.claude/settings.json',
      '.hermes/plans/x.md',
      '.agents/skills/y/SKILL.md',
    ]),
    true,
  )
})

test('混入任一运行时代码文件 => false', () => {
  assert.strictEqual(
    classifier.isDocsOnly(['CHANGELOG.md', 'apps/desktop/electron/main.js']),
    false,
  )
})

test('混入 CI workflow 文件 => false（本 change 自身的 PR 也必须全量）', () => {
  assert.strictEqual(
    classifier.isDocsOnly(['openspec/changes/x/proposal.md', '.github/workflows/quality-gate.yml']),
    false,
  )
})

test('混入锁文件或 package.json => false', () => {
  assert.strictEqual(classifier.isDocsOnly(['CHANGELOG.md', 'pnpm-lock.yaml']), false)
  assert.strictEqual(classifier.isDocsOnly(['CHANGELOG.md', 'package.json']), false)
})

test('空清单 => false（fail-closed：无证据不得跳过测试）', () => {
  assert.strictEqual(classifier.isDocsOnly([]), false)
})

test('非数组输入 => false（fail-closed）', () => {
  assert.strictEqual(classifier.isDocsOnly(null), false)
  assert.strictEqual(classifier.isDocsOnly(undefined), false)
  assert.strictEqual(classifier.isDocsOnly('CHANGELOG.md'), false)
})

test('`*.md` 只匹配根目录：子目录 .md 不命中（除非有显式 dir/** 条目）', () => {
  // apps/desktop/README.md 不在任何 dir/** 白名单内 => 混合 => false
  assert.strictEqual(classifier.isDocsOnly(['apps/desktop/README.md']), false)
  // scripts/foo.md 同理（scripts/ 不在白名单）
  assert.strictEqual(classifier.isDocsOnly(['scripts/foo.md']), false)
  // 根目录 .md 命中
  assert.strictEqual(classifier.isDocsOnly(['README.md']), true)
})

// ---------------------------------------------------------------------------
// 回填/销账型 PR 必须能走 docs-only（否则每个销账 PR 都吃一轮全量重型 job）
// ---------------------------------------------------------------------------

test('回填 + 销账型 PR（置顶文档 + 账本 JSON）=> true', () => {
  assert.strictEqual(
    classifier.isDocsOnly(['.quality-gates.md', 'CHANGELOG.md', 'scripts/gate-record-debt-ledger.json']),
    true,
  )
})

test('账本 JSON 进白名单不得顺带放过 scripts/ 下的代码', () => {
  // 只放开那一个精确路径，不给目录级豁免
  assert.strictEqual(classifier.isDocsOnly(['scripts/gate-record-debt-ledger.js']), false)
  assert.strictEqual(classifier.isDocsOnly(['scripts/check-gate-record-debt.js']), false)
  assert.strictEqual(classifier.isDocsOnly(['scripts/gate-record-debt-ledger.json.bak']), false)
  assert.ok(!classifier.CI_IGNORED_PATHS.includes('scripts/**'), 'scripts/** 不得进白名单')
})

// ---------------------------------------------------------------------------
// 白名单的前提锁：进名单的路径，它自己的门禁必须在**无条件执行**的 changes job 里跑
//
// 原先这条锁是"账本 JSON 专用"的（PR #2718）。#2745 指出同一形态又出现一次 ——
// `openspec/records/**` 命中 `openspec/**` 白名单，而校验它的 check-pr-exec-record 住在被
// docs-only 门控的 static-gates。这里泛化成一张 (白名单路径 → 门禁去向) 对账表。
//
// 它不是提示，是双向对账：deepEqual 钉住表的键集合 == CI_IGNORED_PATHS，于是
// 「新增一条白名单却没往表里登记」当场红（外部评审点名的静默收窄），反向残留也红。
// 每行去向二选一：commands ⇒ 该门禁必须在 changes job 正文且整份 workflow 只出现一次；
// noGate ⇒ 显式承认"没有门禁消费这项内容"，原因必须非空（空原因等于静默绕过）。
// ---------------------------------------------------------------------------

const BRAND_CMDS = [
  'node --test scripts/check-no-brand-residue.test.js',
  'node scripts/check-no-brand-residue.js',
]
const DEBT_CMDS = [
  'node --test scripts/check-gate-record-debt.test.js',
  'node scripts/check-gate-record-debt.js',
]
const EXEC_RECORD_CMDS = [
  'node --test scripts/check-pr-exec-record.test.js',
  'node scripts/check-pr-exec-record.js',
]

const GATE_COVERAGE_FOR_WHITELIST = [
  { pattern: 'openspec/**', commands: EXEC_RECORD_CMDS,
    why: '执行记录与豁免文件都在 openspec/records 下，其存在性判据必须由 changes job 无条件覆盖（#2745）' },
  { pattern: 'scripts/gate-record-debt-ledger.json', commands: DEBT_CMDS,
    why: '账本 JSON 是 check-gate-record-debt 的数据源（#2718 先例）' },
  { pattern: '*.md', commands: BRAND_CMDS,
    why: 'AGENTS.md 把品牌残留列为文档 PR 的保留门禁，而 *.md 全在白名单 ⇒ 门禁必须住在不被短路的 job' },
  { pattern: '01-docs/**', commands: BRAND_CMDS, why: '同上：PRD / learnings 这些散文文档正是品牌词的风险面' },
  { pattern: 'docs/**', commands: BRAND_CMDS, why: '同上：本仓新增机制说明落在这里' },
  { pattern: 'LICENSE', noGate: '许可证全文由发版流程与 GPL 媒体约束条目人工核对，无脚本门禁消费其内容' },
  { pattern: '.gitignore', noGate: '忽略规则由 check-unwired-tests 与 git check-ignore 现场判据兜底，没有读这份文件的门禁' },
  { pattern: '.editorconfig', noGate: '无门禁消费；行尾风险由 PR 流程层的两口径 numstat 对账拦' },
  { pattern: '.ccg/**', noGate: '评审工具产物，无仓内门禁消费' },
  { pattern: '.claude/**', noGate: '工具配置副本，无仓内门禁消费' },
  { pattern: '.hermes/**', noGate: '计划存档目录，内容不做机器判定' },
  { pattern: '.agents/**', noGate: '上游技能制品副本目录，无仓内门禁消费' },
]

test('白名单对账表必须与 CI_IGNORED_PATHS 双向相等（新增白名单不登记即红，不允许静默收窄）', () => {
  const tableKeys = GATE_COVERAGE_FOR_WHITELIST.map((g) => g.pattern).sort()
  const whitelist = classifier.CI_IGNORED_PATHS.slice().sort()
  assert.deepStrictEqual(tableKeys, whitelist,
    '(白名单路径 → 门禁去向) 对账表与 CI_IGNORED_PATHS 不再一一对应 —— 表只能与名单同时增删')
  for (const g of GATE_COVERAGE_FOR_WHITELIST) {
    const hasCommands = Array.isArray(g.commands) && g.commands.length > 0
    const hasNoGate = typeof g.noGate === 'string' && g.noGate.trim().length > 0
    assert.ok(hasCommands !== hasNoGate,
      `${g.pattern} 的去向必须恰好二选一（commands 或带非空原因的 noGate），当前两者同为 ${hasCommands}`)
  }
})

test('对账表里每一条 commands 去向：门禁必须接线进 changes job，且整份 workflow 只出现一次', () => {
  const wfPath = path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml')
  // 本机工作区是 CRLF：带尾随换行的锚点会被 \r\n 打穿，所以解析前先归一到 blob（LF）域；
  // 再剥离注释行 —— 否则"把真实步骤注释掉"仍会被算作接线，那就是本仓点名的装饰性门禁。
  const wf = fs.readFileSync(wfPath, 'utf8').replace(/\r\n/g, '\n')
    .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  const changesAt = wf.indexOf('\n  changes:')
  const staticAt = wf.indexOf('\n  static-gates:')
  assert.ok(changesAt >= 0 && staticAt > changesAt, '未定位到 changes / static-gates 的 job 边界 —— 锁的锚点失效')
  const job = wf.slice(changesAt, staticAt)
  assert.ok(job.length > 0, '未取到 changes job 正文')
  // changes 是产出 docs-only 的那一步，它自己不能再被什么门控；否则"搬到 changes"这句承诺是空的
  assert.ok(!/^ {4}if:/m.test(job), 'changes job 出现 job 级 if ⇒ 它不再是无条件执行，本锁前提消失')
  let checked = 0
  for (const g of GATE_COVERAGE_FOR_WHITELIST) {
    if (!g.commands) continue
    for (const cmd of g.commands) {
      const hits = wf.split(cmd).length - 1
      assert.strictEqual(hits, 1, `${cmd} 在 workflow 正文出现 ${hits} 次：接线位置必须只有一处真源（${g.why}）`)
      assert.ok(job.includes(cmd),
        `${g.pattern} 的门禁未接线进 changes job：缺 ${cmd} ⇒ 纯文档 PR 会短路 static-gates，从此没人校验它（${g.why}）`)
      checked++
    }
  }
  assert.ok(checked >= 8, `本次实测校验的命令条数只有 ${checked} —— 对账表的 commands 侧被掏空了`)
})

// ---------------------------------------------------------------------------
// CLI (merge-base diff mode)
// ---------------------------------------------------------------------------

function gitRepoFixture(changes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-only-cli-'))
  const run = (args, opts = {}) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', ...opts })
  run(['init', '--quiet', '-b', 'main'])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'test'])
  fs.writeFileSync(path.join(dir, 'base-code.js'), 'module.exports = 1\n', 'utf8')
  run(['add', '.'])
  run(['commit', '--quiet', '-m', 'base'])
  run(['checkout', '--quiet', '-b', 'feature'])
  for (const [file, content] of Object.entries(changes)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content, 'utf8')
  }
  run(['add', '.'])
  run(['commit', '--quiet', '-m', 'changes', '--allow-empty'])
  return { dir, run }
}

function runCli(args, env = {}) {
  try {
    const stdout = execFileSync('node', [path.join(__dirname, 'classify-docs-only.js'), ...args], {
      cwd: __dirname,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })
    return { code: 0, stdout }
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? '') }
  }
}

test('CLI：纯文档变更 => docs-only=true，且输出文件清单证据', () => {
  const { dir } = gitRepoFixture({
    'CHANGELOG.md': 'x\n',
    'openspec/changes/x/proposal.md': 'y\n',
  })
  const r = runCli(['--base=main', `--head=feature`, `--repo=${dir}`])
  assert.strictEqual(r.code, 0, r.stdout)
  assert.match(r.stdout, /docs-only=true/)
  assert.match(r.stdout, /files=2/)
  assert.match(r.stdout, /CHANGELOG\.md/)
  assert.match(r.stdout, /openspec\/changes\/x\/proposal\.md/)
})

test('CLI：混合变更 => docs-only=false', () => {
  const { dir } = gitRepoFixture({
    'CHANGELOG.md': 'x\n',
    'apps/desktop/electron/main.js': 'z\n',
  })
  const r = runCli(['--base=main', '--head=feature', `--repo=${dir}`])
  assert.strictEqual(r.code, 0, r.stdout)
  assert.match(r.stdout, /docs-only=false/)
})

test('CLI：无差异（head == base）=> docs-only=false（fail-closed）', () => {
  const { dir } = gitRepoFixture({})
  const r = runCli(['--base=main', '--head=feature', `--repo=${dir}`])
  assert.strictEqual(r.code, 0, r.stdout)
  assert.match(r.stdout, /docs-only=false/)
})

test('CLI：git 失败（不存在的 ref）=> 非零退出（让 changes job 红、gate-result 拦）', () => {
  const { dir } = gitRepoFixture({ 'CHANGELOG.md': 'x\n' })
  const r = runCli(['--base=nonexistent-ref', '--head=feature', `--repo=${dir}`])
  assert.notStrictEqual(r.code, 0)
})

test('CLI：GITHUB_OUTPUT 存在时追加 docs-only=<bool>（CI changes job 消费）', () => {
  const { dir } = gitRepoFixture({ 'CHANGELOG.md': 'x\n' })
  const out = path.join(dir, 'github-output.txt')
  const r = runCli(['--base=main', '--head=feature', `--repo=${dir}`], { GITHUB_OUTPUT: out })
  assert.strictEqual(r.code, 0, r.stdout)
  const written = fs.readFileSync(out, 'utf8')
  assert.match(written, /^docs-only=true\n?$/m)
})

// ── 变更集取源必须只有一份实现（change enforce-gate-record-presence D1 / tasks 3.1）──
// 为什么要锁：本仓有过"同一个三态映射被抄成三份"的事故（login-state）。"本 PR 改了哪些文件"
// 一旦被第二个判据自行重实现，两份对 base 的取法就会漂移，出现"同一 PR 在 A 判 docs-only、
// 在 B 判缺记录"这种不可归因的红。所以取源提为导出，并由下面的锁钉住。
test('changedFiles 必须被导出，且在真实 git 夹具上返回 merge-base..head 的文件清单', () => {
  const clf = require('./classify-docs-only.js')
  assert.strictEqual(typeof clf.changedFiles, 'function', 'changedFiles 未导出：判据只能各自拼 diff')
  const { dir } = gitRepoFixture({ 'docs/a.md': 'a\n' })
  const files = clf.changedFiles({ repo: dir, base: 'main', head: 'feature' })
  assert.deepStrictEqual(files, ['docs/a.md'], JSON.stringify(files))
})

test('changedFiles 在 base 不可解析时必须抛错，不得返回空数组（空清单会被上层判成"没改文件"）', () => {
  const clf = require('./classify-docs-only.js')
  const { dir } = gitRepoFixture({ 'docs/a.md': 'a\n' })
  assert.throws(
    () => clf.changedFiles({ repo: dir, base: 'no-such-ref-xyz', head: 'feature' }),
    /git 取证失败/,
  )
})

test('main() 必须走 changedFiles 这一份取源（防止 CLI 与判据各算各的）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'classify-docs-only.js'), 'utf8')
  const body = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
  assert.match(body, /changedFiles\(\{/, 'main() 未调用 changedFiles')
  // 真正的不变量是"diff 只取一次"，不是"用了某个具体 flag"：新增记录要判"是不是新文件"，
  // 所以取源返回 name-status、名字由它派生 —— 若按 flag 计数，改成 --name-status 会让锁
  // 既可能假绿（0 处 name-only 时旧断言直接不成立）也可能假红。
  const diffCalls = (body.match(/git\(repo,\s*\['diff'/g) || []).length
  assert.strictEqual(diffCalls, 1, `git diff 取源出现 ${diffCalls} 处，必须收敛为一处`)
})

test('changedFileStatuses 必须区分 A/M/D/R（"改了一篇历史记录"不能算"新增了记录"）', () => {
  const { changedFileStatuses } = require('./classify-docs-only.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'name-status-'))
  const run = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  run(['init', '--quiet', '-b', 'main']); run(['config', 'user.email', 't@e.com']); run(['config', 'user.name', 't'])
  // 重命名内容必须足够大：git 的相似度启发式对 1 字节文件不判 R（实测第一版夹具就是这样，
  // 结果 A+D 而非 R —— 那是夹具问题，不是解析问题）。
  const body = Array.from({ length: 40 }, (_, i) => `line ${i} of shared rename content`).join('\n')
  fs.writeFileSync(path.join(dir, 'a.js'), '1'); fs.writeFileSync(path.join(dir, 'gone.md'), 'k')
  fs.writeFileSync(path.join(dir, 'will-rename.md'), body)
  run(['add', '.']); run(['commit', '--quiet', '-m', 'base'])
  run(['checkout', '--quiet', '-b', 'feature'])
  fs.mkdirSync(path.join(dir, 'openspec', 'records'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'openspec', 'records', 'new-rec.md'), 'x')
  fs.writeFileSync(path.join(dir, 'a.js'), '2')
  fs.unlinkSync(path.join(dir, 'gone.md'))
  fs.writeFileSync(path.join(dir, 'renamed.md'), body); fs.unlinkSync(path.join(dir, 'will-rename.md'))
  run(['add', '-A']); run(['commit', '--quiet', '-m', 'c'])
  const got = changedFileStatuses({ repo: dir, base: 'main', head: 'feature' })
  const flat = got.map((e) => `${e.status} ${e.file}`).sort()
  assert.ok(got.length >= 4, `解析结果过少（退化成空/半空就是这类 bug 的形状）：${JSON.stringify(flat)}`)
  assert.ok(flat.includes('A openspec/records/new-rec.md'), `新增记录文件必须是 A：${JSON.stringify(flat)}`)
  assert.ok(flat.includes('M a.js'), `修改必须是 M：${JSON.stringify(flat)}`)
  assert.ok(flat.includes('D gone.md'), `删除必须是 D：${JSON.stringify(flat)}`)
  const r = got.find((e) => /^R/.test(e.status))
  assert.ok(r, `重命名必须判成 R 且取新路径，不能拆成 A+D：${JSON.stringify(flat)}`)
  assert.strictEqual(r.file, 'renamed.md', `R 的 file 必须是新路径（旧路径进 from）：${JSON.stringify(r)}`)
  assert.strictEqual(r.from, 'will-rename.md', `R 的 from 必须是旧路径：${JSON.stringify(r)}`)
})
