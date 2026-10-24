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
// 入口链闭包**只有一份实现**：scripts/lib/deep-review-fixture-closure.js。
// 动因（两次同形红，都是"手抄清单与真实依赖边漂开"）：① 上游把闭环状态词搬进
// lib/exec-record-statuses.js ⇒ 本文件的旧手抄清单少拷一个文件，CI 上六条入口用例一起红；
// ② 本刀给入口新增 lib/ccg-review-rounds.js 调用点 ⇒ **另一个**夹具（deep-review-deps）没跟着长。
// 所以这里不再维护清单，也不许第二个消费者自带一份（⓱ 里有这条锁）。
const { ENTRY_ROOTS, closureOf, entryClosure } = require('./lib/deep-review-fixture-closure')

const CLOSURE = entryClosure(path.join(ROOT, 'scripts'))
const SCRIPT_CLOSURE = CLOSURE.files
const CLOSURE_UNRESOLVED = CLOSURE.unresolved

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
    // findings 文本变一定进语义指纹（只有 at 变不算新交付，写回器④-b 钉着）。
    // 入口级要造「同一个 sha、又真跑出一批新交付」这一格，没这个旋钮两边就永远同指纹。
    findings: [{ id: 'f1', severity: 'Info', finding: '假驱动交付的一条意见' + (process.env.MP_FAKE_NOTE || '') }],
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
  // 闭包完整性在这里落地成**测试自己的红**：缺一个 lib 文件时，症状原本埋在入口子进程的输出里
  // （`⚠ 写回器自身未能运行` + 一句 Cannot find module），六条用例一起红却没人点名缺的是谁。
  if (CLOSURE_UNRESOLVED.length) {
    throw new Error('脚本闭包缺件（夹具会少拷一个文件，红被推到被测子进程深处）：'
      + CLOSURE_UNRESOLVED.map((u) => `${u.from} -> ${u.rel}`).join(' , ')
      + `｜现有闭包 ${SCRIPT_CLOSURE.length} 项`)
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

test('④ 驱动 rc 与写回成败无关：写回被拒时入口 rc 仍是驱动的 rc', (t) => {
  // 两个被拒原因各测一格，且都必须"不改 rc"——
  // 期望后端不符（证明入口把清单里的 critic 透传下来了）与"自扮演收口没带公开复核"
  // 是两条不同的出口判据（2026-10-24 起 self-play 有了第二出口，文案也随之分开）。
  for (const [performedBy, wantReason] of [['Claude', 'reason=backend-mismatch'], ['self-play', 'reason=no-adjudication-evidence']]) {
    const fx = makeFixture(t)
    const r = runEntry(fx, { MP_FAKE_RC: '1', MP_FAKE_DELIVER: '1', MP_FAKE_PERFORMED_BY: performedBy })
    assert.strictEqual(r.rc, 1, `${performedBy} 被拒不得改变评审 rc，实得 ${r.rc}\n---\n${r.out.slice(-2500)}`)
    assert.ok(r.out.includes(wantReason),
      `必须点名是哪一格（${wantReason}），实得：\n${r.out.slice(-2500)}`)
    if (wantReason === 'reason=backend-mismatch') {
      assert.ok(r.out.includes('期望 "claude"'),
        'backend-mismatch 那行必须带期望后端 ⇒ 这才是"入口把清单里的 critic 透传下来"的证据')
    }
    // ⚠ 这里**不能**断"记录逐字节不变"——驱动自己刚整体替换过 deepReview，字节当然变了。
    //   写回器的职责边界是"不加 tier/evidence、不动驱动写的值"，就按这两条断。
    const after = readRec(fx.recFile)
    assert.ok(!('tier' in after.deepReview), `${performedBy} 被拒时不得添加 tier 键，实得：` + JSON.stringify(after.deepReview))
    assert.ok(!('evidence' in after.deepReview), `${performedBy} 被拒时不得添加 evidence 键`)
    assert.strictEqual(after.deepReview.performedBy, performedBy, '驱动写进去的值不得被写回器顺手改掉（它只补自己的两个键）')
  }
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

/* ---------------- 跨调用轮次上限（openspec change: qm6-rebuttal-round-cap）----------------
   这三条测的是**入口真跑**，不是库：轮次账挂在什么键上、超限那一档到底调不调模型，
   只有真跑一遍 sh scripts/deep-review.sh 才看得见。库侧的锁在 ccg-review-rounds.test.js。 */

function branchOf (dir) {
  return execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8', stdio: 'pipe'
  }).trim()
}

test('⓬ 轮次账按 (分支, HEAD sha) 记：首跑计第 1 轮、同 sha 重跑不计数', (t) => {
  const fx = makeFixture(t)
  const change = branchOf(fx.dir)
  const ledgerDir = path.join(fx.dir, 'openspec', 'changes', change)
  const ledger = path.join(ledgerDir, 'external-rounds.json')
  fs.mkdirSync(ledgerDir, { recursive: true })

  const r1 = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '1' })
  assert.strictEqual(r1.rc, 0, r1.out.slice(-1500))
  assert.match(r1.out, /外部评审轮次 第 1\/3 轮（本轮真调用外部评审/,
    `首跑必须报「第 1 轮」而不是「已记 0 轮」——0/3 读起来像没跑：\n${r1.out.slice(-2500)}`)
  assert.match(r1.out, /\[rounds\] counted=1 round=1/,
    `驱动返回后必须落账一次：\n${r1.out.slice(-2500)}`)
  assert.ok(fs.existsSync(ledger), '账本必须落在 openspec/changes/<分支>/ 下（受管、能随 PR diff 看见）')

  const r2 = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '1' })
  assert.match(r2.out, /同一载荷重跑，本轮不计数/,
    `同 sha 重跑要明说不计数：\n${r2.out.slice(-2500)}`)
  // 键换成 (sha, 交付指纹) 之后，入口**总是**调用 record（旧的 seen 跳过守卫已删），
  // 所以断言从「这一行不许出现」改成「这一行必须出现且报 counted=0」：
  // 要守的语义没变（同一次交付不重复计费），能看见的产物变了——不跟着改会把正确实现判成红。
  assert.match(r2.out, /\[rounds\] counted=0 round=1/,
    `同 sha 重跑不得再发起记账调用（少了这一格，"不计数"只剩库里的幂等在兜）：\n${r2.out.slice(-2500)}`)

  const data = JSON.parse(fs.readFileSync(ledger, 'utf8'))
  const rounds = data.changes[change].rounds
  assert.strictEqual(rounds.length, 1,
    `账本里必须只有 1 条，实得 ${rounds.length} 条：${JSON.stringify(rounds)}`)
  assert.strictEqual(rounds[0].headSha, fx.sha,
    '记的必须是 HEAD sha —— 挂到内容寻址的记录名上，重投一次提交就每次归零且全程静默')
})

test('⓭ 已达上限 ⇒ 不调模型、打印 ESCALATED、非零退出，且记录与账本都不被动', (t) => {
  const fx = makeFixture(t)
  const change = branchOf(fx.dir)
  const ledgerDir = path.join(fx.dir, 'openspec', 'changes', change)
  const ledger = path.join(ledgerDir, 'external-rounds.json')
  fs.mkdirSync(ledgerDir, { recursive: true })
  const rounds = ['a', 'b', 'c'].map((s) => ({ headSha: s.repeat(40), recordName: null, at: '2026-01-01T00:00:00.000Z' }))
  fs.writeFileSync(ledger, JSON.stringify({ version: 1, changes: { [change]: { rounds } } }, null, 2) + '\n', 'utf8')
  const before = fs.readFileSync(fx.recFile, 'utf8')

  const r = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '1' })
  assert.strictEqual(r.rc, 1, `超限必须非零退出（升级不是自动放行），实得 ${r.rc}\n${r.out.slice(-2500)}`)
  assert.match(r.out, /ESCALATED：外部评审已达轮次上限（3\/3）/,
    `读数要点名上限已到：\n${r.out.slice(-2500)}`)
  assert.match(r.out, /不再调用模型/, `必须说清这一轮没花额度：\n${r.out.slice(-2500)}`)
  assert.ok(!/本轮真调用外部评审/.test(r.out),
    '已达上限那一档不得再说「本轮真调用外部评审」——紧接着就是不调用，那是一句假话')
  assert.strictEqual(fs.readFileSync(fx.recFile, 'utf8'), before,
    '判定记录一个字节都不能动 —— 动了就说明驱动其实被调用了，「不调模型」是假话')
  const after = JSON.parse(fs.readFileSync(ledger, 'utf8')).changes[change].rounds
  assert.strictEqual(after.length, 3,
    `拒绝调用那一步不得顺手再记一轮（把配额花在没发生的事上）：实得 ${after.length} 条`)
})

test('⓮ 入口以 scripts/ 路径 node 调用的每个 js 都必须在夹具 require 闭包里', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'deep-review.sh'), 'utf8')
  const called = new Set()
  for (const m of src.matchAll(/node [^\n]*?scripts\/([A-Za-z0-9_./-]+\.js)/g)) called.add(m[1])
  assert.ok(called.size >= 3,
    `扫描必须真的命中调用点（实得 ${called.size}）—— 命中 0 条的扫描器就是把锁写成装饰`)
  const missing = [...called].filter((f) => !SCRIPT_CLOSURE.includes(f))
  assert.deepStrictEqual(missing, [],
    `入口会 node 调它们，但夹具没复制过去：${missing.join(', ')}。后果不是报错而是被兜底成一句告警，`
      + '锁全绿而生产路径一次都没被跑过（本仓「装饰性门禁」的形状）')
  // 范围如实划定：本条只覆盖「以 scripts/ 字面路径调用」的 js。
  // 形如 node "$DRIVER"（变量寻址到仓外引擎）那一条不在本判据域内，由 deep-review-deps.test.js 负责。
})

test('⓯ 账本读不出 ⇒ 不调用模型、非零退出，且读数必须与"跑满了"分档（QM-6 第二轮 i3/i5）', (t) => {
  const fx = makeFixture(t)
  const change = branchOf(fx.dir)
  const ledgerDir = path.join(fx.dir, 'openspec', 'changes', change)
  const ledger = path.join(ledgerDir, 'external-rounds.json')
  fs.mkdirSync(ledgerDir, { recursive: true })
  const broken = '{ 这不是 json'
  fs.writeFileSync(ledger, broken, 'utf8')
  const before = fs.readFileSync(fx.recFile, 'utf8')

  const r = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '1' })
  assert.strictEqual(r.rc, 1, `读不出必须拦（旧取向"照常调用 + 一句告警"给了零成本绕行）：实得 ${r.rc}\n${r.out.slice(-2500)}`)
  assert.match(r.out, /轮次账本读不出/, `读数要点名是没读数：\n${r.out.slice(-2500)}`)
  assert.ok(!/已达轮次上限/.test(r.out),
    `这一档不得复用"跑满了"的文案 —— 一个是配额用尽、一个是判据自己失明，处置动作完全不同：\n${r.out.slice(-2500)}`)
  assert.ok(!/本轮真调用外部评审/.test(r.out), '拦下的那一轮没有调用模型，读数不能说反话')
  assert.strictEqual(fs.readFileSync(fx.recFile, 'utf8'), before,
    '判定记录一字节都不动 ⇒ 驱动确实没被调用（"不调模型"如果是假话，这一条必红）')
  assert.strictEqual(fs.readFileSync(ledger, 'utf8'), broken,
    '拦下时不得顺手改写那份坏账本：把"读不出"静默修成"零轮"就是自己给自己清预算')
})

test('⓰ 同一 sha 但产出新交付 ⇒ 必须再计一轮（i4 那个松口的入口级证据）', (t) => {
  const fx = makeFixture(t)
  const change = branchOf(fx.dir)
  const ledgerDir = path.join(fx.dir, 'openspec', 'changes', change)
  const ledger = path.join(ledgerDir, 'external-rounds.json')
  fs.mkdirSync(ledgerDir, { recursive: true })

  const r1 = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '1', MP_FAKE_NOTE: '第一批内容' })
  assert.strictEqual(r1.rc, 0, r1.out.slice(-1500))
  assert.match(r1.out, /\[rounds\] counted=1 round=1/,
    `首记必须 counted=1：\n${r1.out.slice(-2500)}`)

  // 第二次不重新提交（sha 始终不变），只让交付换一批内容。
  // 只按 sha 去重的旧实现在这里报 counted=0 —— 于是"同一份载荷上反复真调模型"永远只算一轮，
  // 上限对最花钱的那种循环完全不起作用。这一条就是那格的入口级证据。
  const r2 = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '1', MP_FAKE_NOTE: '第二批内容' })
  assert.match(r2.out, /\[rounds\] counted=1 round=2/,
    `同 sha 的新交付必须计入第二轮：\n${r2.out.slice(-2500)}`)

  const rounds = JSON.parse(fs.readFileSync(ledger, 'utf8')).changes[change].rounds
  assert.strictEqual(rounds.length, 2,
    `账本应有两条，实得 ${rounds.length} 条：${JSON.stringify(rounds)}`)
  assert.strictEqual(new Set(rounds.map((r) => r.delivery)).size, 2,
    '两条记录的交付指纹必须不同 ⇒ 计数的增量来自交付身份，而不是来自新提交：' + JSON.stringify(rounds))
  assert.strictEqual(new Set(rounds.map((r) => r.headSha)).size, 1,
    '而 sha 始终是同一个 —— 否则这条测的是"换载荷"，与 R2 重复')
})

test('⓱ 脚本闭包沿 require 与 bash 调用两条边传递：上游新增的 lib 不需要手抄就必须在夹具里', () => {
  // 这条是 CI 六条入口用例红的**根因锁**：闭包原先是手抄数组，上游把闭环状态词搬进
  // lib/exec-record-statuses.js 之后清单没跟着长，夹具少拷一个文件，而红埋在子进程输出里。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-dr-clo-${process.pid}-`))
  try {
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
    // 合成树：种子 a.js 要求 ./lib/b（**无 .js 后缀**的写法），b 再要求 ./c —— 两跳都要走出来。
    fs.writeFileSync(path.join(dir, 'a.js'), "require('./lib/b')\n")
    fs.writeFileSync(path.join(dir, 'lib', 'b.js'), "require('./c')\n")
    fs.writeFileSync(path.join(dir, 'lib', 'c.js'), 'module.exports = 1\n')
    fs.writeFileSync(path.join(dir, 'keep.list'), 'x\n')
    const un = []
    const got = closureOf(dir, ['a.js', 'keep.list'], un)
    assert.deepStrictEqual(got, ['a.js', 'keep.list', 'lib/b.js', 'lib/c.js'],
      `闭包要把两跳都收进来（含无后缀写法与非 js 种子），实得 ${JSON.stringify(got)}`)
    assert.deepStrictEqual(un, [], `不该有缺件，实得 ${JSON.stringify(un)}`)
    // 缺件必须被**点名**（连"是谁要求的"一起报），不得静默丢掉——那正是本次事故的形状。
    fs.writeFileSync(path.join(dir, 'a.js'), "require('./lib/ghost')\n")
    const u2 = []
    closureOf(dir, ['a.js'], u2)
    assert.deepStrictEqual(u2, [{ from: 'a.js', rel: 'lib/ghost' }],
      `缺件的报告必须带引用方，实得 ${JSON.stringify(u2)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  // 真树那一侧：本分支的入口链闭包里必须同时含「被 require 的 lib」与「被 bash node 调的 lib」。
  // 只测合成树会留下"合成树对、真树靠运气"的空档。
  assert.ok(SCRIPT_CLOSURE.includes('lib/ccg-review-rounds.js'),
    `bash 调的那个 lib 必须在闭包里（它不被任何 .js require，纯 require 图会整块丢掉它）：${JSON.stringify(SCRIPT_CLOSURE)}`)
  assert.ok(SCRIPT_CLOSURE.includes('lib/ccg-delivery-digest.js'),
    `入口两侧都调的交付指纹实现必须在闭包里：${JSON.stringify(SCRIPT_CLOSURE)}`)
  assert.deepStrictEqual(CLOSURE_UNRESOLVED, [],
    `真树闭包不得有缺件（有就说明夹具会在被测子进程里炸成 Cannot find module）：${JSON.stringify(CLOSURE_UNRESOLVED)}`)
  const scriptsDir = path.join(ROOT, 'scripts')
  const backends = fs.readFileSync(path.join(scriptsDir, 'ccg-review-writeback.js'), 'utf8')
  const required = [...backends.matchAll(/require\((['"])\.\/([^'"]+)\1\)/g)].map((m) => m[2])
  assert.ok(required.length > 0, `写回器应当有相对 require（实得 ${required.length} 条 ⇒ 扫描器读不到东西）`)
  for (const r of required) {
    const cands = ['lib/' + r, 'lib/' + r + '.js', r, r + '.js']
    assert.ok(cands.some((c) => SCRIPT_CLOSURE.includes(c)),
      `写回器 require 的 ${r} 必须在闭包里（候选 ${JSON.stringify(cands)}，闭包 ${JSON.stringify(SCRIPT_CLOSURE)}）`)
  }
  // **单一实现锁**：所有"把入口拷进临时仓库再真跑"的夹具都必须引用同一份闭包，
  // 且不得在自己文件里再写一份算法——第二份不需要写错，只需要没人记得同步（这两次红的共同成因）。
  for (const f of ['deep-review-entry-rc.test.js', 'deep-review-deps.test.js']) {
    const src = fs.readFileSync(path.join(scriptsDir, f), 'utf8')
    assert.match(src, /require\((['"])\.\/lib\/deep-review-fixture-closure\1\)/,
      `${f} 必须引用共享闭包实现（自带一份清单就一定会漂）`)
    assert.ok(!/function\s+closureOf\s*\(/.test(src),
      `${f} 不得自带第二份闭包算法；要扩大闭包只有"加真入口"或"让两条边走到它"两种正当方式`)
  }
})

test('⓲ 轮次 CLI 跑不起来（缺文件）必须自成一档：不得冒充「账本读不出」', (t) => {
  // 现场：本刀给入口加了 lib/ccg-review-rounds.js 这个调用点，而 deps 那份手抄闭包没跟着长 ⇒
  // 三条与本刀无关的用例红成"入口说账本读不出、于是不调模型"，归因指向一个**根本没坏**的文件。
  // 这一条锁的就是那两句文案不许再互相冒充：动作相同（都拦），修的对象不同（装文件 vs 修 json）。
  const fx = makeFixture(t)
  fs.rmSync(path.join(fx.dir, 'scripts', 'lib', 'ccg-review-rounds.js'))
  const before = fs.readFileSync(fx.recFile, 'utf8')

  const r = runEntry(fx, { MP_FAKE_RC: '0', MP_FAKE_DELIVER: '1' })
  assert.strictEqual(r.rc, 1,
    `CLI 没跑起来必须拦下本轮（无证据不放行），实得 rc=${r.rc}\n${r.out.slice(-2500)}`)
  assert.match(r.out, /轮次判据 CLI 未正常退出/,
    `要说出真实那一档（判据没跑起来），实得：\n${r.out.slice(-2500)}`)
  assert.ok(!/轮次账本读不出/.test(r.out),
    '不得说成「账本读不出」——那会把人支使去查一份没坏的 external-rounds.json（本刀就是这么绕的）')
  assert.match(r.out, /Cannot find module|不调用模型/,
    `必须带上 CLI 原文或"本轮不调用模型"，让人一眼看到缺的是谁：\n${r.out.slice(-2500)}`)
  assert.strictEqual(fs.readFileSync(fx.recFile, 'utf8'), before,
    '判定记录一个字节都不能动 —— 动了就是驱动其实被调了，"不调模型"是假话')
})
