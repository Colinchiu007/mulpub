'use strict'
/**
 * deep-review-entry-rc.test.js —— 入口的「先保 rc，再加动作」（tasks 2.2 / 2.3）
 *
 * 这把锁测的不是源码里出现了什么字面，而是**真跑一次 `sh scripts/deep-review.sh`**：
 *  ① 驱动返回什么 rc，入口就返回什么 rc（0 / 1 / 2 三档各跑一次，逐字相等）。
 *     写回步骤加在调用之后时最容易把 rc 换成写回器的 rc —— 而写回器**恒 0**（旁路语义），
 *     于是"评审失败"会在入口变成"评审成功"。这条只有真跑能看见。
 *  ② 写回确实发生在"引擎已返回之后、exit 之前"：断言盘里的记录被补上了 tier/evidence。
 *     把写回调用挪到 `exit` 之后 ⇒ 这一条永远红（本仓「释放必须发生在控制流正确位置」同型）。
 *  ③ 驱动没交付时**一个字都不许写**（no-write / not-closed / backend-mismatch 三格各测各的）。
 *  ④ dry-run 不产生产物，也不得引入写回步骤（预览不该改产物）。
 *
 * 夹具刻意用**假驱动**（写在 os.tmpdir() 下、由 `MP_FAKE_*` 指路），因此本文件不依赖
 * 本机是否装了 adversarial-review-loop —— 与既有 deep-review-deps.test.js 里那批
 * `testNeedsEngine` 锁不同，这批在 CI 上必须真跑（否则"入口会写回"这件事在 CI 无证据）。
 *
 * 跑法：node --test scripts/deep-review-entry-rc.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')

/** 写回器（及其 require 闭包）在真跑时会被入口调到；夹具必须把它们一起放进临时仓库。 */
const SCRIPT_CLOSURE = [
  'deep-review.sh',
  'ccg-review-writeback.js',
  'ccg-review-decider.js',
  'check-pr-exec-record.js',
  'classify-docs-only.js',
  'ccg-review-backends.list',
  'lib/ccg-backends.sh',
  'lib/ccg-review-backends.js',
  'lib/ccg-delivery-digest.js',
  'lib/exec-record-audit.js',
  'lib/exec-record-statuses.js'
]

const FAKE_DRIVER = `'use strict'
// 假驱动：只复刻真引擎 ccg-deep-review.js 的**收口站点形状**（:1252-1256）——
// 整体替换 rec.deepReview，键集为 required,status,performedBy,findings,minScore,at，
// **不写 tier、不写 evidence**（这正是本片要修的那件事）。
const fs = require('node:fs')
const rec = process.env.MP_FAKE_REC
const rc = Number(process.env.MP_FAKE_RC || '0')
if (process.env.MP_FAKE_KILL) {
  // 9.3：信号终止形态。入口必须把 shell 观察到的那个数原样传出去，不得被写回器洗成 0。
  process.kill(process.pid, process.env.MP_FAKE_KILL)
}
if (process.env.MP_FAKE_DELIVER === '1') {
  const j = JSON.parse(fs.readFileSync(rec, 'utf8'))
  j.deepReview = {
    required: true,
    status: process.env.MP_FAKE_STATUS || 'cleared',
    performedBy: process.env.MP_FAKE_PERFORMED_BY || 'claude',
    findings: [{ id: 'f1', severity: 'Info', finding: '假驱动交付的一条意见' }],
    minScore: 6,
    at: new Date().toISOString()
  }
  fs.writeFileSync(rec, JSON.stringify(j, null, 2) + '\\n', 'utf8')
}
process.exit(rc)
`

/**
 * 解析 Git Bash。**刻意不写死盘符字面量**：`scripts/check-doc-abs-paths.js`（Gate 12c）的账本
 * 按"该文件里出现了多少条本机绝对路径"计数，且只能缩小；新测试文件里躺一条
 * `C:\\Program Files\\...` 就是给账本加行 ⇒ 当场红。改成从环境变量取安装根，
 * 顺带修掉"Git 装在别处就找不到"这一格真实缺陷。
 * ⚠ 少测的那一维要如实记：本文件不再验证「盘符字面量那条候选」，
 *    那一维由 deep-review-deps.test.js 的同名解析函数负责。
 */
function resolveGitBash () {
  const cands = [process.env.MP_GIT_BASH]
  for (const key of Object.keys(process.env)) {
    if (/^programfiles(\(x86\))?$/i.test(key)) {
      const root = process.env[key]
      if (root) cands.push(path.join(root, 'Git', 'bin', 'bash.exe'))
    }
  }
  cands.push('/bin/bash', '/usr/bin/bash')
  for (const c of cands) if (c && fs.existsSync(c)) return c
  try {
    const r = spawnSync('which', ['bash'], { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
  } catch (_) { /* ignore */ }
  return null
}

const BASH = resolveGitBash()

/**
 * 造一个临时仓库：两笔提交（保证 HEAD^ 存在，不走"首笔提交"那条支路）、
 * HEAD 名下有一份 mode=dual 的判定记录、入口脚本及其 require 闭包只复制到工作区
 * 并经 .git/info/exclude 对 git 彻底隐形（夹具不得污染被测前提）。
 *
 * `record` 两档（**这一档决定 ④ 的哪一格会被测到**）：
 *  - `pending`      判定器刚写完的初值（status=pending / tier=unknown / findings=null）
 *  - `stale-closed` 上一轮遗留的"已闭环但没有 tier"的记录 —— 写回器最容易误收口的那一格
 */
function makeFixture (t, opts) {
  const variant = (opts && opts.record) || 'pending'
  assert.ok(BASH, '解析不到 bash ⇒ 入口行为锁一次都跑不了（不得静默跳过）')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-dr-entry-${process.pid}-`))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  git(['init', '-q'])
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'seed'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'biz change'])

  for (const rel of SCRIPT_CLOSURE) {
    const src = path.join(ROOT, 'scripts', rel)
    const dst = path.join(dir, 'scripts', rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
  const exclude = path.join(dir, '.git', 'info', 'exclude')
  fs.mkdirSync(path.dirname(exclude), { recursive: true })
  fs.appendFileSync(exclude, '\n' + SCRIPT_CLOSURE.map((r) => 'scripts/' + r).join('\n') + '\n')

  const sha = git(['rev-parse', 'HEAD']).trim()
  const recDir = path.join(dir, '.ccg', 'reviews')
  fs.mkdirSync(recDir, { recursive: true })
  const recFile = path.join(recDir, sha + '.json')
  const rec0 = {
    sha,
    mode: 'dual',
    layer: 'diff',
    reviewBackends: { critic: 'claude', proposer: 'opencode', source: 'list' },
    deepReview: variant === 'stale-closed'
      // 引擎的收口形状：整体替换 ⇒ tier/evidence 键**不存在**（不是 null）。
      // ⚠ findings / minScore / status / performedBy 都与 FAKE_DRIVER 写的那份**逐字相同**，
      //   只差 `at`——⑪ 就是靠这个等式测「驱动只刷了时间戳」这一格在生产传参形态下拦得住。
      //   两边内容不同时，那格会被"确实有新交付"合法通过，测试就成了空转。
      ? { required: true, status: 'cleared', performedBy: 'claude', findings: [{ id: 'f1', severity: 'Info', finding: '假驱动交付的一条意见' }], minScore: 6, at: '2026-01-01T00:00:00.000Z' }
      // 判定器初值形状（真源 buildDeepReviewInit）：tier=unknown、evidence=null
      : { required: true, status: 'pending', tier: 'unknown', evidence: null, findings: null, performedBy: null }
  }
  fs.writeFileSync(recFile, JSON.stringify(rec0, null, 2) + '\n', 'utf8')

  // 假后端目录 + 假 wrapper：让入口的依赖体检在**任何机器**上都能过（_RB_OK≥1），
  // 否则本文件在 CI 上会整批红在"没有评审后端"，而不是红在被测那段。
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), `mp-dr-bin-${process.pid}-`))
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }))
  for (const name of ['claude', 'opencode']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 0\n')
    fs.chmodSync(path.join(bin, name), 0o755)
  }
  const wrapper = path.join(bin, 'codeagent-wrapper.exe')
  fs.writeFileSync(wrapper, 'fake\n')

  const arl = fs.mkdtempSync(path.join(os.tmpdir(), `mp-dr-arl-${process.pid}-`))
  t.after(() => fs.rmSync(arl, { recursive: true, force: true }))
  fs.writeFileSync(path.join(arl, 'ccg-deep-review.js'), FAKE_DRIVER, 'utf8')

  return { dir, recFile, sha, arl, env: {
    ...process.env,
    CCG_ARL_DIR: arl,
    CCG_BACKEND_BIN_DIRS: bin,
    CODEAGENT_WRAPPER: wrapper,
    MP_FAKE_REC: recFile
  } }
}

/**
 * PATH 刻意收敛到「git / sha256sum / node」，不给 npm。
 * 动因是实测：candidate_dirs 里 `command -v npm` 命中时会跑 `npm prefix -g`，本机每次 3–10s，
 * 两个后端 × 每条用例 ⇒ 单条用例 40–55s（实测），这把锁会从秒级拖成分钟级。
 * 后端可见性不依赖 npm 分支 —— 它由 CCG_BACKEND_BIN_DIRS 单点提供（候选目录命中 ⇒ ABS）。
 * ⚠ 少测的那一维要如实记：本文件不覆盖「后端从 npm 全局目录解析出来」那条路径，
 *    那一维由 deep-review-deps.test.js 的后端表对账锁负责。
 */
/** Windows 盘符路径 → Git Bash 认得的 POSIX 形态（PATH 里的 `C:\` 会被冒号当分隔符劈开）。 */
function toPosixDir (p) {
  if (p.startsWith('/')) return p
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p)
  if (!m) return p
  return '/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/')
}

function minimalPath () {
  const nodeDir = toPosixDir(path.dirname(process.execPath))
  const posix = fs.existsSync('/mingw64/bin') ? '/mingw64/bin:/usr/bin' : '/usr/bin:/bin'
  return posix + ':' + nodeDir
}

/**
 * 每一次真跑都必须先证明"它走到了被测那一段"。
 * 这一条不是防御性冗余：把 PATH 收小时曾让全部 7 条都变成 `✗ 找不到 node ⇒ rc=2`，
 * 而「期望 rc=2」那条用例照样**绿** —— 环境崩掉的 rc 与被测的 rc 在产物上完全同形。
 */
function assertReachedDriver (r) {
  assert.ok(r.out.includes('═══ CCG 深度审查'),
    `夹具没跑到被测段（横幅之前的任一早退都会让 rc 与被测形态完全同形——`
    + `实测收小 PATH 后 7 条全部变成「✗ 找不到 node ⇒ rc=2」，而「期望 rc=2」那条照样绿），rc=${r.rc}：\n${r.out.slice(-1200)}`)
}

function runEntry (fx, extraEnv, args) {
  const env = Object.assign({}, fx.env, { PATH: minimalPath() }, extraEnv || {})
  const r = spawnSync(BASH, ['scripts/deep-review.sh'].concat(args || []), {
    cwd: fx.dir, encoding: 'utf8', env, maxBuffer: 1 << 24
  })
  const out = (r.stdout || '') + (r.stderr || '')
  const res = { rc: r.status, out }
  assertReachedDriver(res)
  return res
}

function readRec (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

test('① 驱动 rc=0 ⇒ 入口 rc=0，且盘里的记录被写回 tier=external + delivery@ 摘要', (t) => {
  const fx = makeFixture(t)
  const r = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '1' })
  assert.strictEqual(r.rc, 0, `入口 rc 必须等于驱动 rc，实得 ${r.rc}\n---\n${r.out.slice(-2500)}`)
  assert.ok(r.out.includes('[ccg-review-writeback] 已写回 tier=external'),
    `入口必须把写回步骤跑起来并出声，实得：\n${r.out.slice(-2500)}`)
  const after = readRec(fx.recFile)
  assert.strictEqual(after.deepReview.tier, 'external', '写回发生在"引擎已返回之后、exit 之前"；挪到 exit 之后这一条必红')
  assert.match(after.deepReview.evidence, /^delivery@[0-9a-f]{64}$/)
  assert.strictEqual(after.deepReview.status, 'cleared', '写回器不得顺手改 status')
})

test('② 驱动 rc=1 ⇒ 入口 rc 逐字等于 1（写回器恒 0 不得顶掉评审的失败）', (t) => {
  const fx = makeFixture(t)
  const r = runEntry(fx, { MP_FAKE_RC: '1', MP_FAKE_DELIVER: '1' })
  assert.strictEqual(r.rc, 1, `评审失败必须在入口保持失败，实得 ${r.rc}\n---\n${r.out.slice(-2500)}`)
  assert.strictEqual(readRec(fx.recFile).deepReview.tier, 'external', 'rc 非 0 不代表没交付：交付了照样写回')
})

test('③ 驱动 rc=2 ⇒ 入口 rc 逐字等于 2', (t) => {
  const fx = makeFixture(t)
  const r = runEntry(fx, { MP_FAKE_RC: '2', MP_FAKE_DELIVER: '1' })
  assert.strictEqual(r.rc, 2, `实得 ${r.rc}\n---\n${r.out.slice(-2500)}`)
})

test('④ 驱动 rc 与写回成败无关：写回被拒（backend-mismatch）时入口 rc 仍是驱动的 rc', (t) => {
  const fx = makeFixture(t)
  const r = runEntry(fx, { MP_FAKE_RC: '1', MP_FAKE_DELIVER: '1', MP_FAKE_PERFORMED_BY: 'self-play' })
  assert.strictEqual(r.rc, 1, `期望后端不符不得改变评审 rc，实得 ${r.rc}\n---\n${r.out.slice(-2500)}`)
  assert.ok(r.out.includes('reason=backend-mismatch'),
    `必须点名是"期望后端不符"这一格（证明入口把清单里的 critic 透传下来了），实得：\n${r.out.slice(-2500)}`)
  // ⚠ 这里**不能**断"记录逐字节不变"——驱动自己刚整体替换过 deepReview，字节当然变了。
  //   写回器的职责边界是"不加 tier/evidence、不动驱动写的值"，就按这两条断。
  const after = readRec(fx.recFile)
  assert.ok(!('tier' in after.deepReview), '被拒时不得添加 tier 键，实得：' + JSON.stringify(after.deepReview))
  assert.ok(!('evidence' in after.deepReview), '被拒时不得添加 evidence 键')
  assert.strictEqual(after.deepReview.performedBy, 'self-play', '驱动写进去的值不得被写回器顺手改掉（它只补自己的两个键）')
})

test('⑤ 上一轮已闭环、本轮驱动没写过 ⇒ reason=no-write，记录逐字节不变（两侧哈希同形的现场证据）', (t) => {
  // 这一格为什么必须用 stale-closed 而不是 pending 的记录：五条是**短路**评估的，
  //   pending 记录会在 ① 就退回 not-closed，永远走不到字节比对 —— 用它测"哈希口径一致"
  //   等于没测（实测第一版就栽在这里，红文案指的就是 not-closed）。
  //   stale-closed 是这条判据真正要防的形态：驱动一次没写，而盘上躺着一份看着完全合法的
  //   闭环交付 —— 没有字节对照，写回器会把它当"本次刚交付"补上 tier。
  const fx = makeFixture(t, { record: 'stale-closed' })
  const before = fs.readFileSync(fx.recFile)
  const r = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '0' })
  assert.strictEqual(r.rc, 0)
  assert.ok(r.out.includes('reason=no-write'),
    `两侧哈希必须同形才可能抓到这一格；实得：\n${r.out.slice(-2500)}`)
  assert.deepStrictEqual(fs.readFileSync(fx.recFile), before, '拒绝写入时既有产物必须逐字节不变')
})

test('⑥ 驱动交付了但未收口（status 仍 pending）⇒ reason=not-closed，不得补 tier', (t) => {
  const fx = makeFixture(t)
  const r = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '1', MP_FAKE_STATUS: 'pending' })
  assert.ok(r.out.includes('reason=not-closed'), `实得：\n${r.out.slice(-2500)}`)
  const after = readRec(fx.recFile)
  assert.ok(!('tier' in after.deepReview), '未收口的交付不得补 tier')
  assert.strictEqual(after.deepReview.status, 'pending', '写回器不得把 pending 抬成闭环状态')
})

test('⑦ dry-run 不得引入写回步骤（预览不改产物）', (t) => {
  const fx = makeFixture(t)
  const before = fs.readFileSync(fx.recFile)
  const r = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '0' }, ['--dry-run'])
  assert.strictEqual(r.rc, 0, `实得 ${r.rc}\n---\n${r.out.slice(-2500)}`)
  assert.ok(!r.out.includes('[ccg-review-writeback]'),
    `dry-run 分支里出现了写回步骤，说明预览在改产物：\n${r.out.slice(-2500)}`)
  assert.deepStrictEqual(fs.readFileSync(fx.recFile), before)
})

/**
 * ⑧ 信号终止（tasks 9.3）。
 * ⛔ 期望值**不写死 137**：`128+signo` 是 POSIX shell 的读数，而本机是 Git Bash + Windows node，
 *    `process.kill(pid,'SIGKILL')` 在那里被观察成什么，只有同一 shell 实测才知道（实测前不许猜）。
 *    写死常数的锁会在某一侧恒红、在另一侧恒绿——两者都不是"测过了"。
 *    正解：先用同一个假驱动在**同一个 bash、同一份 env** 里裸跑一次拿到读数，再要求入口逐字等于它。
 */
test('⑧ 假驱动被信号终止 ⇒ 入口 rc 等于同机同 shell 实测到的那个数（探针读数一并打印）', (t) => {
  const fx = makeFixture(t)
  const driver = path.join(fx.arl, 'ccg-deep-review.js')
  const env = Object.assign({}, fx.env, {
    PATH: minimalPath(),
    MP_FAKE_DRIVER: driver,
    MP_FAKE_KILL: 'SIGKILL',
    MP_FAKE_DELIVER: '1',
    MP_FAKE_RC: '0'
  })
  const probe = spawnSync(BASH, ['-c', 'node "$MP_FAKE_DRIVER" >/dev/null 2>&1; echo $?'], { cwd: fx.dir, encoding: 'utf8', env })
  const observed = Number(String(probe.stdout).trim())
  console.log('[entry-rc] 信号终止实测读数 SIGKILL => ' + observed + '（probe rc=' + probe.status + '）')
  assert.ok(Number.isFinite(observed) && observed > 0,
    `探针自己必须拿到一个非零读数，否则"入口等于探针"是恒真（实得 stdout=${JSON.stringify(probe.stdout)} stderr=${String(probe.stderr).slice(0, 200)}）`)
  const r = runEntry(fx, { MP_FAKE_KILL: 'SIGKILL', MP_FAKE_DELIVER: '1', MP_FAKE_RC: '0' })
  assert.strictEqual(r.rc, observed,
    `入口不得对 rc 做任何加工：期望 ${observed}，实得 ${r.rc}\n---\n${r.out.slice(-1500)}`)
})

/** ⑨ 写回器自身起不来（模块缺失 ⇒ node 非零）。合同：它是旁路，不得改评审 rc，且必须出声。 */
test('⑨ 写回器起不来 ⇒ 入口仍返回驱动的 rc，并打印"写回器自身未能运行"', (t) => {
  const fx = makeFixture(t)
  fs.rmSync(path.join(fx.dir, 'scripts', 'ccg-review-writeback.js'))
  const r = runEntry(fx, { MP_FAKE_RC: '1', MP_FAKE_DELIVER: '1' })
  assert.strictEqual(r.rc, 1, `写回器崩了不得把评审的失败改掉，实得 ${r.rc}\n---\n${r.out.slice(-1500)}`)
  assert.ok(r.out.includes('写回器自身未能运行'),
    `静默跳过比少一个字段更糟（AGENTS「静默配置失败必须留日志」），实得：\n${r.out.slice(-1500)}`)
})

/**
 * ⑪ 外部深审 round 2 的 **i1（Critical）**在生产传参形态上的回归锁。
 * 场景：上一轮已经闭环过（记录里躺着一份合法的 `cleared` 交付），本轮驱动**只刷了 `at`**
 * （引擎每个 writeBack 站点都写 `at: new Date()`）。原实现只在调用方给 Buffer 时才计算动手前的
 * 语义指纹，而真跑入口只给 `--before-sha256` ⇒ 这一格永远不触发，"只刷时间戳的旧交付"会被
 * 当成新交付写上 `tier=external`。这条用例走的就是**入口的那份传参**，所以它测的是生产接线，
 * 不是注入路径（④-b 那条单元用例只喂 Buffer，正是它把这个缺口漏掉的）。
 */
test('⑪ 驱动只刷新时间戳 ⇒ 入口侧 reason=no-new-delivery，且不得写上 tier', (t) => {
  const fx = makeFixture(t, { record: 'stale-closed' })
  const before = fs.readFileSync(fx.recFile)
  const r = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '1' })
  assert.ok(r.out.includes('reason=no-new-delivery'),
    `只变 at 必须被认成"没有新交付"，实得：\n${r.out.slice(-2000)}`)
  const after = fs.readFileSync(fx.recFile)
  assert.notDeepStrictEqual(after, before, '驱动确实写过（字节变了），否则这条测的是 no-write')
  assert.ok(!after.includes(Buffer.from('"tier"')), '不得把上一轮的闭环交付当本次产出补 tier')
  assert.strictEqual(readRec(fx.recFile).deepReview.status, 'cleared', '既有 status 不得被改写')
})
