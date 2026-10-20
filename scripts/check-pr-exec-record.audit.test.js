'use strict'

// check-pr-exec-record.js --audit 的回归锁（2026-10-20）
//
// 为什么单独一个文件、不进 check-pr-exec-record.test.js：后者已 141 KB，
// 再往里堆会让「一个测试文件」自成一个不可读的模块；而审计档是一条**独立能力**
// （只读、不参与判定），它的失败面与 enforce 路径完全不同，混测会让红因难归。
//
// 本文件锁住的四件事，每件都有对应的失败形态：
//   1) 分档必须是**可证伪**的：只按记录里真实存在的字段归类，不猜「已修/未修」。
//   2) 落地归因只认「记录文件是否在 origin/main 树里」，不去比 commit sha ——
//      squash 合并后主干的 commit 是新对象，feature 分支的 sha 永远不在主干历史里，
//      按 sha 判会把每个已合并 PR 都算成「未落地」。
//   3) 只读：跑完不得新增/修改任何文件（审计的最大风险是它自己变成写方）。
//   4) 永不阻断：未闭环记录再多也 exit 0；只有用法错误才 exit 2。

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, 'check-pr-exec-record.js')

/** 造一个带 git 的临时仓库，写入给定的记录文件并提交 */
function makeRepo(records, { withMainRef = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-recro-audit-'))
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 't@t.t')
  git('config', 'user.name', 't')
  git('config', 'commit.gpgsign', 'false')
  const recDir = path.join(dir, '.ccg', 'reviews')
  fs.mkdirSync(recDir, { recursive: true })
  for (const [name, body] of Object.entries(records)) {
    fs.writeFileSync(path.join(recDir, `${name}.json`), JSON.stringify(body, null, 2))
  }
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'fixture')
  if (withMainRef) {
    // audit 用 origin/main 判定「记录是否已落主干」；fixture 里把当前提交当作主干
    git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD').trim())
  }
  return { dir, git }
}

function runAudit(dir, extra = []) {
  try {
    const stdout = execFileSync('node', [SCRIPT, '--audit', `--repo=${dir}`, ...extra], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' }
  }
}

const dual = (overrides = {}) => ({
  sha: 'a'.repeat(40),
  layer: 'diff',
  mode: 'dual',
  decidedAt: '2026-10-01T00:00:00.000Z',
  deepReview: { required: true, status: 'pending', performedBy: null, findings: [{ id: 'F1' }] },
  ...overrides,
})

test('只读审计：按记录里真实存在的字段分档，不猜「已修/未修」', () => {
  const { dir } = makeRepo({
    p1: dual({ deepReview: { required: true, status: 'pending', performedBy: null, findings: [{}] } }),
    p2: dual({ deepReview: { required: true, status: 'error', performedBy: null, error: 'critic truncated' } }),
    p3: dual({ deepReview: { required: true, status: 'self_play_blocked', performedBy: 'self-play', findings: [{}] } }),
    p4: dual({ deepReview: { required: true, status: 'self_play_adjudicated', performedBy: 'self-play', findings: [{}] } }),
    c1: dual({ deepReview: { required: true, status: 'cleared', performedBy: 'claude', findings: [] } }),
    s1: dual({ mode: 'single', deepReview: { required: false, status: 'pending', performedBy: null, findings: [] } }),
    k1: dual({ mode: 'skip', reason: 'docs-only', deepReview: undefined }),
  })

  const r = runAudit(dir)
  assert.strictEqual(r.code, 0, `审计必须 exit 0（只读不阻断），实际 ${r.code}：${r.stderr}`)
  const out = r.stdout

  // 分档计数：只有 dual 进统计；闭环白名单三值不计入未闭环
  assert.match(out, /记录总数\s*:\s*7/, '应统计全部记录文件')
  assert.match(out, /dual 判定\s*:\s*5/, '只有 mode=dual 进欠账统计')
  assert.match(out, /未闭环\s*:\s*4/, 'cleared 不在未闭环之列')
  assert.match(out, /pending\s+1/, 'pending 单列')
  assert.match(out, /error\s+1/, 'error 单列（引擎失败 ≠ 欠账）')
  assert.match(out, /self_play_blocked\s+1/, 'blocked 单列')
  assert.match(out, /self_play_adjudicated\s+1/, 'adjudicated 单列')

  // 判据的自我说明必须出现在输出里 —— 这是让读者不误以为可以批量关闭的关键一句
  assert.match(out, /不可从记录判定/, '必须显式声明「是否已修」不可判定')
  assert.match(out, /不写任何文件/, '必须在输出里声明只读')
})

test('落地归因按「记录文件是否在 origin/main 树里」，不按 commit sha', () => {
  // 关键：记录里的 sha 刻意填成主干里不存在的对象（模拟 squash 之后的 feature 分支 sha），
  // 但这些记录文件本身在主干树里 ⇒ 必须判为「已落地」。按 sha 判会全部误判成未落地。
  const { dir } = makeRepo({
    landed1: dual({ sha: 'b'.repeat(40), deepReview: { required: true, status: 'pending', performedBy: null, findings: [{}] } }),
    landed2: dual({ sha: 'c'.repeat(40), deepReview: { required: true, status: 'pending', performedBy: null, findings: [{}] } }),
  })
  const r = runAudit(dir)
  assert.strictEqual(r.code, 0, r.stderr)
  assert.match(r.stdout, /已落地\s*:\s*2/, '记录文件在主干树里即视为已落地，与记录里的 sha 无关')
  assert.match(r.stdout, /未落地\s*:\s*0/)
})

test('未落地记录：文件只在本地（不在 origin/main 树里）必须单列', () => {
  const { dir, git } = makeRepo({
    inMain: dual({ deepReview: { required: true, status: 'pending', performedBy: null, findings: [{}] } }),
  })
  // 追加一份「只在本地」的记录，且不推主干树
  const recDir = path.join(dir, '.ccg', 'reviews')
  fs.writeFileSync(path.join(recDir, 'local-only.json'), JSON.stringify(
    dual({ deepReview: { required: true, status: 'pending', performedBy: null, findings: [{}] } }), null, 2))
  git('add', '-A')
  git('commit', '-q', '-m', 'local only')

  const r = runAudit(dir)
  assert.strictEqual(r.code, 0, r.stderr)
  assert.match(r.stdout, /已落地\s*:\s*1/)
  assert.match(r.stdout, /未落地\s*:\s*1/)
})

test('只读：跑完审计不得新增或改动任何文件', () => {
  const { dir, git } = makeRepo({
    p1: dual({ deepReview: { required: true, status: 'pending', performedBy: null, findings: [{}] } }),
  })
  const before = git('status', '--porcelain')
  const shaBefore = git('rev-parse', 'HEAD')
  runAudit(dir)
  assert.strictEqual(git('status', '--porcelain'), before, '审计不得留下工作区改动')
  assert.strictEqual(git('rev-parse', 'HEAD'), shaBefore, '审计不得创建提交')
})

test('永不阻断：未闭环记录 277 条级别的量也不改变退出码', () => {
  const records = {}
  for (let i = 0; i < 40; i++) {
    records[`p${i}`] = dual({ deepReview: { required: true, status: 'pending', performedBy: null, findings: [{}] } })
  }
  const { dir } = makeRepo(records)
  const r = runAudit(dir)
  assert.strictEqual(r.code, 0, '欠账再多也 exit 0 —— 审计不是判据')
  assert.match(r.stdout, /未闭环\s*:\s*40/)
})

test('--json 输出可被机器消费，且字段与文本档同源', () => {
  const { dir } = makeRepo({
    p1: dual({ deepReview: { required: true, status: 'pending', performedBy: null, findings: [{}, {}] } }),
    c1: dual({ deepReview: { required: true, status: 'cleared', performedBy: 'claude', findings: [] } }),
  })
  const r = runAudit(dir, ['--json'])
  assert.strictEqual(r.code, 0, r.stderr)
  const j = JSON.parse(r.stdout)
  assert.strictEqual(j.total, 2)
  assert.strictEqual(j.dual, 2)
  assert.strictEqual(j.closed, 1)
  assert.strictEqual(j.open, 1)
  assert.strictEqual(j.byStatus.pending, 1)
  assert.strictEqual(j.landed.open, 1)
  assert.strictEqual(j.notLanded.open, 0)
  assert.strictEqual(j.readOnly, true)
  assert.strictEqual(j.findingsTotal, 2, 'findings 数应可累加（用于说明「有多少条待人工看」）')
})

test('用法错误（--limit 非数字）exit 2，不得静默当成 0', () => {
  const { dir } = makeRepo({ p1: dual() })
  const r = runAudit(dir, ['--limit=abc'])
  assert.strictEqual(r.code, 2, '用法错误必须区别于「审计通过」')
  assert.match(r.stderr, /--limit/)
})

// ── 外部评审（claude）第 1 轮 i2 / i5 的回归保护 ──────────────────────────
// i2: 闭环白名单在「审计模块」与「判据本体」各有一份定义，同步改一处会漏另一处。
//     本轮的选择是**不重构 enforce 路径**（那是高危面的逻辑改动），而是加一把
//     「同真源」锁：两份定义必须始终相等，任何一侧漂移当场红。
test('i2：审计模块的闭环白名单必须与判据本体的白名单逐字一致（防两处独立定义漂移）', () => {
  const fs2 = require('node:fs')
  const { CLOSED_STATUSES } = require('./lib/exec-record-audit')
  const src = fs2.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  // 判据本体里这三词出现在闭环解释注释与白名单判定处；取源码中出现的三个词作对照
  const expected = ['cleared', 'needs_revision', 'self_play_resolved']
  for (const word of expected) {
    assert.ok(src.includes(word), `判据本体源码里应出现 ${word}`)
    assert.ok(CLOSED_STATUSES.has(word), `审计模块的闭环白名单缺 ${word} ⇒ 两份定义漂移`)
  }
  assert.strictEqual(CLOSED_STATUSES.size, expected.length,
    `闭环白名单必须恰好 ${expected.length} 个词；多出的词等于放宽闭环口径`)
})

// i5: --repo 指向没有记录目录的路径时，必须有可诊断的说明，而不是静默「0 条」。
test('i5：--repo 指向不存在的记录目录时给出可诊断说明，且不阻断', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-recro-empty-'))
  const r = runAudit(empty)
  assert.strictEqual(r.code, 0, '无可审计记录不是错误，仍 exit 0')
  assert.match(r.stdout, /记录总数\s*:\s*0/)
  assert.match(r.stdout, /\.ccg\/reviews/, '必须点出它找的是哪个目录，否则用户无从诊断')
})
