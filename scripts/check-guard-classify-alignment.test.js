'use strict'
/*
 * Alignment lock tests. Run with: node --test scripts/check-guard-classify-alignment.test.js
 *
 * Deliberate split:
 *  - real-repo cases carry the SCALE LOWER BOUNDS. A lower bound inside collect() would
 *    fail every small fixture (measured lesson in this repo: 15 legitimate fixtures were
 *    dragged red that way), so bounds live here and decision logic lives in fixtures.
 *  - fixtures inject `debt`, because the live list names 22 real files; a hardcoded list
 *    would make every fixture read as "22 stale registrations".
 *  - fixtures never pass an empty allow list on purpose: the judge refuses a degraded
 *    parse, so a realistic sentinel entry is used instead.
 */

const test = require('node:test').test
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const HERE = __dirname
const REPO = path.resolve(HERE, '..')
const judge = require('./check-guard-classify-alignment.js')
const { collect, DEBT, SelfFailure, extractGuardArray } = judge

const tmpDirs = []
function cleanUp() {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 })
}
process.on('exit', cleanUp)

function guardSource(topItems, rootItems) {
  const q = (xs) => xs.map((x) => "'" + x + "'").join(',')
  return 'param([string]$Root)\r\n' +
    "$allowedTop = @(" + q(topItems) + ')\r\n' +
    "$allowedRootFiles = @(" + q(rootItems) + ')\r\n'
}

function touch(dir, rel, content) {
  const file = path.join(dir, rel.split('/').join(path.sep))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content || 'x\n')
}

// Files named in `late` are written AFTER `git add -A`, so they stay untracked.
function buildRepo({ top = ['docs'], root = ['README.md'], files = {}, late = {}, stage = true, guard } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-align-' + process.pid + '-' + Math.random().toString(36).slice(2) + '-'))
  tmpDirs.push(dir)
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  fs.copyFileSync(path.join(REPO, 'scripts', 'classify-docs-only.js'), path.join(dir, 'scripts', 'classify-docs-only.js'))
  fs.writeFileSync(path.join(dir, 'scripts', 'guard-shared-root-writes.ps1'), guard || guardSource(top, root))
  for (const rel of Object.keys(files)) touch(dir, rel, files[rel])
  execFileSync('git', ['-C', dir, 'init', '-q'])
  if (stage) execFileSync('git', ['-C', dir, 'add', '-A'])
  for (const rel of Object.keys(late)) touch(dir, rel, late[rel])
  return dir
}

const baseFiles = { 'docs/readme.md': 'h\n', '.gitignore': 'node_modules/\n' }

test('真仓：当前零漂移零陈旧，且扫描规模必须看得见（防探针失明）', () => {
  const r = collect({ root: REPO })
  assert.ok(r.tracked > 8000, 'real repo tracked count should be in the thousands, got ' + r.tracked)
  assert.ok(r.docsTracked > 4000, 'docs-whitelisted tracked count should be in the thousands, got ' + r.docsTracked)
  assert.ok(r.patterns >= 14, "the classifier whitelist shrank below the size this lock was written against, got " + r.patterns)
  assert.deepStrictEqual(r.violations, [], 'live drift must be zero or a registered debt: ' + r.violations.join(', '))
  assert.deepStrictEqual(r.stale, [], 'a debt entry fixed without deleting its registration must not pass')
})

test('真仓：债务清单每一条都仍是一条真漂移（清单只能缩小，不得空转）', () => {
  const r = collect({ root: REPO })
  assert.strictEqual(r.acknowledged.length, Object.keys(DEBT).length,
    'every DEBT entry must still be uncovered; fixed entries have to be deleted here')
  assert.strictEqual(r.uncoveredCount, r.acknowledged.length)
  for (const [file, reason] of Object.entries(DEBT)) {
    assert.ok(typeof reason === 'string' && reason.trim().length > 0, 'debt entry needs a non-empty reason: ' + file)
    assert.ok(!file.includes('/'), 'debt entries are root-level files only: ' + file)
  }
})

test('真仓：.gitignore 已被守卫放行（本条正是被静默撤销的那一次）', () => {
  const r = collect({ root: REPO })
  assert.ok(r.allowedRootFiles.includes('.gitignore'), '.gitignore must be in $allowedRootFiles')
  assert.ok(!r.uncovered.includes('.gitignore'), 'got uncovered: ' + r.uncovered.join(','))
})

test('真仓：三个 vendored/工具目录已进入 $allowedTop', () => {
  const r = collect({ root: REPO })
  for (const dir of ['.quality-rhythm', '.claude', '.agents']) {
    assert.ok(r.allowedTop.includes(dir), 'expected ' + dir + ' in allowedTop, got ' + r.allowedTop.join(','))
  }
})

test('夹具：docs-only 且未被守卫覆盖 ⇒ 逐个点名成 NEW 漂移', () => {
  const dir = buildRepo({
    top: ['docs'],
    root: ['README.md'],
    files: Object.assign({}, baseFiles, { 'notes.md': 'h\n', 'LICENSE': 'MIT\n' }),
  })
  const r = collect({ root: dir, debt: {} })
  assert.deepStrictEqual(r.violations, ['.gitignore', 'LICENSE', 'notes.md'].sort(), JSON.stringify(r.violations))
  assert.strictEqual(r.uncoveredCount, 3)
})

test('夹具：把同一路径补进守卫清单后必须转绿（证明量的是清单生效，不是别的）', () => {
  const files = Object.assign({}, baseFiles, { 'notes.md': 'h\n' })
  const before = buildRepo({ top: ['docs'], root: ['README.md'], files })
  assert.deepStrictEqual(collect({ root: before, debt: {} }).violations, ['.gitignore', 'notes.md'])

  const after = buildRepo({ top: ['docs'], root: ['README.md', '.gitignore', 'notes.md'], files })
  const r = collect({ root: after, debt: {} })
  assert.deepStrictEqual(r.violations, [])
  assert.strictEqual(r.uncoveredCount, 0)
})

test('夹具：目录形态按首段判定，命中 $allowedTop 即整棵放行', () => {
  const dir = buildRepo({
    top: ['01-docs'],
    root: ['README.md'],
    files: { '01-docs/PRD.md': 'h\n', '01-docs/deep/other.md': 'h\n', '.gitignore': 'node_modules/\n', 'elsewhere/x.md': 'h\n' },
  })
  const r = collect({ root: dir, debt: {} })
  // `elsewhere/**` is not in CI_IGNORED_PATHS at all, so it is out of scope; the two
  // 01-docs files are covered by the directory form; `.gitignore` is not in root list.
  assert.deepStrictEqual(r.violations, ['.gitignore'])
})

test('夹具：债务清单覆盖到的漂移不算 NEW；条目不再真漂移即报陈旧', () => {
  const dir = buildRepo({ top: ['docs'], root: ['README.md'], files: Object.assign({}, baseFiles, { 'notes.md': 'h\n' }) })
  const covered = collect({ root: dir, debt: { '.gitignore': '历史残留', 'notes.md': '历史残留' } })
  assert.deepStrictEqual(covered.violations, [])
  assert.deepStrictEqual(covered.acknowledged, ['.gitignore', 'notes.md'])
  assert.deepStrictEqual(covered.stale, [])

  const stale = collect({ root: dir, debt: { 'gone.md': '已经不漂移了还挂着' } })
  assert.deepStrictEqual(stale.stale, ['gone.md'])
  assert.deepStrictEqual(stale.violations, ['.gitignore', 'notes.md'], 'replacing a debt entry must not hide the real drift')
})

test('夹具：未追踪文件天然不在判定面内（stray 与 ignored 都交给守卫，不放宽清单）', () => {
  const dir = buildRepo({
    top: ['docs'],
    root: ['README.md', '.gitignore'],
    files: { 'docs/readme.md': 'h\n', '.gitignore': 'node_modules/\nignored.md\n' },
    late: { 'ignored.md': 'h\n', 'stray.md': 'h\n' },
  })
  const r = collect({ root: dir, debt: {} })
  assert.deepStrictEqual(r.violations, [], 'untracked paths are out of scope by design: ' + r.violations.join(','))
  assert.ok(!r.violations.includes('stray.md'), 'an untracked stray file must not be allow-listed away')
  assert.ok(r.tracked >= 3, 'fixture must list its staged scaffolding, got ' + r.tracked)
})

test('SELF-FAILURE：读不到分类器/守卫、解析退化、空遍历一律出声，绝不判成零漂移', () => {
  assert.throws(() => collect({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'align-nothing-')) }), SelfFailure)

  const dir = buildRepo({ files: baseFiles })
  const guardFile = path.join(dir, 'scripts', 'guard-shared-root-writes.ps1')

  fs.writeFileSync(guardFile, 'param([string]$Root)\r\n# no arrays here\r\n')
  assert.throws(() => collect({ root: dir, debt: {} }), SelfFailure)

  // An array that exists only inside a comment must not be read as the live list.
  fs.writeFileSync(guardFile, "# $allowedTop = @('docs')\r\n# $allowedRootFiles = @('.gitignore')\r\n")
  assert.throws(() => collect({ root: dir, debt: {} }), /could not locate the live \$allowedTop/)

  assert.throws(() => extractGuardArray('$allowedTop = @()\r\n', 'allowedTop'), /parsed to an empty list/)

  // An empty traversal (nothing staged yet) must be loud, not "zero drift".
  const fresh = buildRepo({ files: baseFiles, stage: false })
  assert.throws(() => collect({ root: fresh, debt: {} }), /returned nothing/)
})

test('依赖面：判据只能 require node 内置模块与相对文件（它跑在无依赖安装的 changes job）', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'check-guard-classify-alignment.js'), 'utf8')
  const specs = [...src.matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)].map((m) => m[2])
  assert.ok(specs.length >= 3, 'expected the builtin requires to be present, found ' + JSON.stringify(specs))
  for (const spec of specs) {
    const allowed = spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../')
    assert.ok(allowed, 'judge may only require node builtins or relative files, got: ' + spec)
  }
  // The classifier must be loaded from the TARGET root so fixtures exercise the same
  // matcher the real job uses - a hardcoded absolute require would test only the copy.
  assert.match(src, /require\(path\.join\(root, CLASSIFY_REL/, 'classifier should be loaded relative to the target root')
})

test('自接线：判据与自身测试都点名在 changes job 内，且该步骤 shell: bash fail-fast', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'quality-gate.yml'), 'utf8').replace(/\r/g, '')
  const start = wf.indexOf('\n  changes:')
  const end = wf.indexOf('\n  static-gates:')
  assert.ok(start >= 0 && end > start, 'could not bound the changes job block - anchor drifted')
  const block = wf.slice(start, end)

  const steps = []
  let current = null
  for (const line of block.split('\n')) {
    const m = line.match(/^      - name: (.+)$/)
    if (m) {
      if (current) steps.push(current)
      current = { name: m[1], body: [] }
      continue
    }
    if (current) current.body.push(line)
  }
  if (current) steps.push(current)

  const hit = steps.filter((s) => s.body.join('\n').includes('scripts/check-guard-classify-alignment'))
  assert.ok(hit.length >= 1, 'no step inside the changes job names the alignment lock')
  const joined = hit.map((s) => s.body.join('\n')).join('\n')
  assert.ok(joined.includes('check-guard-classify-alignment.test.js'), 'the test file must be named, or it never runs')
  assert.match(joined, /node scripts\/check-guard-classify-alignment\.js/, 'the judge itself must run here')
  for (const s of hit) {
    assert.match(s.body.join('\n'), /shell: bash/, 'step "' + s.name + '" must run under bash to fail fast')
  }
})

test('解析器不按排版下判：多行数组与含括号的路径都必须能读出来（W1 回归）', () => {
  // A cosmetic reformat of the guard lists must not turn the lock into an exit-2
  // self-failure - that shape gates every PR through Gate Result, so a false red here is
  // as expensive as the drift it guards. The single-line assumption this replaces was never
  // under test, which is how it stayed latent.
  assert.deepStrictEqual(extractGuardArray("\$allowedTop = @('docs')\r\n", 'allowedTop'), ['docs'])
  assert.deepStrictEqual(
    extractGuardArray("\$allowedTop = @(\n  'docs',\n  '01-docs'\n)\r\n", 'allowedTop'),
    ['docs', '01-docs']
  )
  assert.deepStrictEqual(extractGuardArray("\$allowedTop = @('A(B).md')\r\n", 'allowedTop'), ['A(B).md'])
  // still blind to a commented-out array, and still loud about a never-closed one
  assert.throws(() => extractGuardArray("# \$allowedTop = @('docs')\r\n", 'allowedTop'), SelfFailure)
  assert.throws(() => extractGuardArray("\$allowedTop = @('docs',\n  'x'\n", 'allowedTop'), /no line ending with the closing paren/)
})

test('棘轮：债务清单大小钉死，只能靠删垃圾缩小、不得靠放宽守卫缩小', () => {
  const r = collect({ root: REPO })
  assert.strictEqual(Object.keys(DEBT).length, 21)
  assert.strictEqual(r.acknowledged.length, 21)
  assert.ok(!r.allowedRootFiles.includes('pr-body-temp.md'), 'litter must never be allow-listed')
  assert.ok(!r.allowedRootFiles.includes('CI-FINAL-REPORT-20260920.md'))
})
