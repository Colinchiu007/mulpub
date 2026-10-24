'use strict'
// 回归锁：QM-6 外部出处覆盖率的水位计（change: qm6-tier-watermark）
//
// 为什么必须有：用户裁决「advisory→enforce 暂不翻，等水位」，但"水位"此前没有任何可重取落点
// —— check-pr-exec-record.js 的 TIER-COVERAGE 只统计本次变更集（分母通常是个位数），
// 且只在跑的那一瞬间存在于 stdout。没有这把尺，"什么时候能翻"就永远只能靠感觉。
//
// 夹具一律用**真 git 临时仓**（os.tmpdir()），不用 mock：本文件要锁的是"域怎么划、帧怎么切、
// 日期按哪个字段分桶"，这三件事在假读数上根本不可表示（同型教训见 design D2/D4/D5）。
// 全部用例无网络（本仓 network-egress-guard 会拦真实出站）。

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { gitSafeEnv } = require('./lib/debt-recheck-live.js')
const { AUDIT_ARTIFACT_RE, stripCommentsForScan } = require('./check-pr-exec-record.js')

const SCRIPT = path.join(__dirname, 'qm6-tier-watermark.js')
const HEX40 = 'a'.repeat(40)
const CLOSED = 'cleared'

// ── 夹具：一个真的临时 git 仓库 ────────────────────────────────────────────────
function makeRepo () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-wm-${process.pid}-${Math.random().toString(36).slice(2, 8)}-`))
  const base = gitSafeEnv().env
  const g = (args, env) => {
    const r = spawnSync('git', ['-C', dir].concat(args), {
      encoding: 'utf8', env: Object.assign({}, base, env || {}),
    })
    if (r.status !== 0) {
      throw new Error('夹具 git ' + args.join(' ') + ' rc=' + r.status + ' :: ' + String(r.stderr || '').slice(0, 200))
    }
    return String(r.stdout || '')
  }
  const ID = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid']
  g(['init', '-q', '--initial-branch=main'])
  g(ID.concat(['commit', '--allow-empty', '-q', '-m', 'seed']))
  const write = (rel, text) => {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    // 显式 LF：夹具不靠宿主 core.autocrlf（本仓那条 CRLF 事故的直接教训）
    fs.writeFileSync(p, text.replace(/\r\n/g, '\n'), 'utf8')
  }
  const commit = (msg, env) => {
    g(['add', '-A'])
    g(ID.concat(['commit', '-q', '-m', msg]), env || {})
  }
  return { dir, g, write, commit, ID }
}

/** 一份判定产物的最小真实形状（mode=dual 且 deepReview 已闭环）。 */
function artifact (deepReview, extra) {
  const rec = Object.assign({
    schema: 1,
    mode: 'dual',
    changedFiles: ['scripts/x.js'],
    changedLines: 10,
    deepReview: Object.assign({ required: true, status: CLOSED, performedBy: 'claude', findings: [] }, deepReview || {}),
  }, extra || {})
  // 真产物是多行 JSON（JSON.stringify(…, null, 2)）—— 这正好是"按行切帧"那版的陷阱面
  return JSON.stringify(rec, null, 2)
}
const name = (seed) => {
  const h = seed.replace(/[^0-9a-f]/g, '')
  return (h + '0'.repeat(40)).slice(0, 40)
}

function runWatermark (dir, extraArgs) {
  const args = [SCRIPT, '--repo=' + dir, '--ref=main'].concat(extraArgs || [])
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: gitSafeEnv().env })
  return { rc: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') }
}

/** 从读数行取字段；取不到就红 —— 静默容忍缺失字段等于把"没打这格"读成"这格是 0"。 */
function field (line, key) {
  // 键名里可能带正则元字符（'+'、'('），不转义就会被当量词，表现为"读数行缺字段"这种假红。
  const esc = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = line.match(new RegExp('(?:^|\\s)' + esc + '=([^\\s]+)'))
  assert.ok(m, '读数行缺字段 ' + key + '；实际行=' + JSON.stringify(line))
  return m[1]
}
function watermarkLine (out) {
  const l = String(out).split(/\r?\n/).find((x) => x.startsWith('TIER-WATERMARK main='))
  assert.ok(l, '没有 TIER-WATERMARK 读数行；完整 stdout=' + JSON.stringify(out))
  return l
}

// ── 1.1.1 六档读数必须精确 ───────────────────────────────────────────────────
test('水位行的六个档必须逐字对上（total/external/external-unverified/self-play/none/unknown/unrecognized）', () => {
  const fx = makeRepo()
  fx.write('.ccg/reviews/' + name(HEX40) + '.json', artifact({ tier: 'external', evidence: 'PR #4000 issuecomment-1234567890' }))
  fx.write('.ccg/reviews/' + name('b'.repeat(40)) + '.json', artifact({ tier: 'self-play' }))
  fx.write('.ccg/reviews/' + name('c'.repeat(40)) + '.json', artifact(undefined))
  fx.write('.ccg/reviews/' + name('d'.repeat(40)) + '.json', artifact({ tier: 'superseded' }))
  fx.commit('four artifacts')
  const mainSha = fx.g(['rev-parse', 'HEAD']).trim().slice(0, 10)

  const r = runWatermark(fx.dir)
  assert.equal(r.rc, 0, 'rc 必须为 0；stderr=' + r.err)
  const l = watermarkLine(r.out)
  assert.equal(field(l, 'total'), '4')
  assert.equal(field(l, 'external'), '1')
  assert.equal(field(l, 'external-unverified'), '0')
  assert.equal(field(l, 'self-play'), '1')
  assert.equal(field(l, 'none'), '0')
  assert.equal(field(l, 'unknown'), '1')
  assert.equal(field(l, 'unrecognized'), '1')
  assert.ok(l.startsWith('TIER-WATERMARK main=' + mainSha), '首段必须是实际落点短 sha；行=' + l)
  // 空集也必须出行：这条由 1.1.7 的"取不到 ⇒ 不出读数行"配对，两者不得同形
})

// ── 1.1.2 D3 的那格：两版实现答案不同的输入 ──────────────────────────────────
test('自称 external 但 evidence 形状不可核 ⇒ 必须降 external-unverified（这条输入证明分类只有一份实现）', () => {
  const fx = makeRepo()
  // 自写的一份"看字段值像不像 external"会数成 external；判据的 classifyEvidenceTier 数成 external-unverified
  fx.write('.ccg/reviews/' + name('e'.repeat(40)) + '.json', artifact({ tier: 'external', evidence: 'x' }))
  fx.commit('unshaped external')

  const l = watermarkLine(runWatermark(fx.dir).out)
  assert.equal(field(l, 'total'), '1')
  assert.equal(field(l, 'external'), '0', '把不可核的出处计入 external ⇒ 分类被抄成第二份了')
  assert.equal(field(l, 'external-unverified'), '1')
})

// ── 1.1.3 扫描域由正则持有，且域外必须被看见 ─────────────────────────────────
test('目录里的非产物形态文件不得进分母，但必须打印条数并提示域由正则划', () => {
  const fx = makeRepo()
  fx.write('.ccg/reviews/' + name('f'.repeat(40)) + '.json', artifact({ tier: 'self-play' }))
  // 本刀自己的第一版探针就栽在这一格：按目录扫 → 这 2 份 .md 进了视野 → 造出 parseFail=2 的假故障
  fx.write('.ccg/reviews/brief-watermark-logic.md', '审查这段实现：\n\n- 看域怎么划\n')
  fx.write('.ccg/reviews/notes.json', '这不是判定产物命名形态，不该被认成产物\n')
  fx.commit('one artifact plus two out-of-domain')

  const l = watermarkLine(runWatermark(fx.dir).out)
  assert.equal(field(l, 'total'), '1', '域外文件进了分母 ⇒ 扫描域被划回目录了')
  assert.equal(field(l, '域外'), '2')
  assert.ok(l.includes('AUDIT_ARTIFACT_RE'), '域外条数必须同时提示"域由正则划"，否则读的人会去找坏文件；行=' + l)
})

// ── 1.1.4 帧必须按字节切：多行 JSON 只算一条 ─────────────────────────────────
test('多行 JSON 的产物必须被计成一条记录（按行切帧的那版会把它劈成十几条）', () => {
  const fx = makeRepo()
  const body = artifact({ tier: 'self-play' })
  assert.ok(body.split('\n').length > 5, '夹具本身必须是多行 JSON，否则这条锁测不到任何东西')
  fx.write('.ccg/reviews/' + name('1'.repeat(40)) + '.json', body)
  fx.commit('multiline json')

  const l = watermarkLine(runWatermark(fx.dir).out)
  assert.equal(field(l, 'total'), '1', 'total=' + field(l, 'total') + ' ⇒ 帧按行切了')
  assert.equal(field(l, 'self-play'), '1')
})

// ── 1.1.5 存在性探针缺省必须出声，且行为真的不同 ────────────────────────────
test('路径形态出处：探针开着时按"该 revision 里是否存在"判，关掉时必须出声 probe=off 且按形状判', () => {
  const fx = makeRepo()
  fx.write('docs/adr/0009-real.md', '# 真的存在\n')
  fx.write('.ccg/reviews/' + name('2'.repeat(40)) + '.json', artifact({ tier: 'external', evidence: 'docs/adr/0009-real.md' }))
  fx.write('.ccg/reviews/' + name('3'.repeat(40)) + '.json', artifact({ tier: 'external', evidence: 'docs/adr/0099-nope.md' }))
  fx.commit('two path-shaped evidences')

  const on = watermarkLine(runWatermark(fx.dir).out)
  assert.equal(field(on, 'probe'), 'on')
  assert.equal(field(on, 'external'), '1', '存在的那条应核过；行=' + on)
  assert.equal(field(on, 'external-unverified'), '1', '不存在的那条必须降档；行=' + on)

  const off = watermarkLine(runWatermark(fx.dir, ['--no-probe']).out)
  assert.equal(field(off, 'probe'), 'off', '不传探针必须出声，不得静默按已核判')
  assert.equal(field(off, 'external'), '2', '关探针时只按形状判 ⇒ 两条都算 external（这正是"没验"与"验过"的区别）')
})

// ── 1.1.6 趋势按 committer 日期分桶，且只认"加入" ───────────────────────────
test('趋势行按 committer 日期分桶；同一份产物被重写只计一次加入', () => {
  const fx = makeRepo()
  const sep = '4'.repeat(40)
  fx.write('.ccg/reviews/' + name(sep) + '.json', artifact({ tier: 'self-play' }))
  // author 日期落在 9 月、committer 日期落在 10 月：分桶必须认 committer（D5-3）
  fx.commit('added in october (authored in september)', {
    GIT_AUTHOR_DATE: '2026-09-11T10:00:00+08:00',
    GIT_COMMITTER_DATE: '2026-10-02T10:00:00+08:00',
  })
  fx.write('.ccg/reviews/' + name(sep) + '.json', artifact({ tier: 'external', evidence: 'PR #4001 issuecomment-9876543210' }))
  fx.commit('rewritten in november', { GIT_COMMITTER_DATE: '2026-11-03T10:00:00+08:00' })

  const out = runWatermark(fx.dir).out
  const trend = String(out).split(/\r?\n/).filter((x) => x.startsWith('WATERMARK-TREND '))
  assert.ok(trend.length >= 1, '没有趋势行；stdout=' + JSON.stringify(out))
  const oct = trend.find((x) => x.includes('月=2026-10'))
  assert.ok(oct, '必须按 committer 日期落进 2026-10；实读=' + JSON.stringify(trend))
  assert.equal(field(oct, 'added'), '1')
  assert.ok(!trend.some((x) => x.includes('月=2026-11')), '重写不得再计一次加入；实读=' + JSON.stringify(trend))
  assert.ok(!trend.some((x) => x.includes('月=2026-09')), '分桶取 author 日期就是错的（squash 合并会把 author 留在编写时刻）')
})

// ── 1.1.7 取不到 ref ⇒ 自身故障档，不得打空读数 ─────────────────────────────
test('主干 ref 取不到 ⇒ WATERMARK-SELF-FAULT 且 rc=2，不得打印 total=0 后以 0 退出', () => {
  const fx = makeRepo()
  const r = spawnSync(process.execPath, [SCRIPT, '--repo=' + fx.dir, '--ref=refs/do-not-exist'],
    { encoding: 'utf8', env: gitSafeEnv().env })
  // 取的是 spawnSync 的 .status（不是 .rc —— 自己造的 runner 才返回 rc；读错字段会把
  // "退出码 undefined" 当成"不等于 2"，红得毫无信息量。本仓记过同型错：数 CI 时读错列名。）
  assert.equal(r.status, 2, '取不到 ref 必须退 2；stdout=' + r.stdout + ' stderr=' + r.stderr)
  assert.ok(String(r.stdout + r.stderr).includes('WATERMARK-SELF-FAULT'), '必须点名自身故障锚串')
  assert.ok(!String(r.stdout).includes('TIER-WATERMARK main='), '不得在取不到对象时打读数行')
})

// ── 1.1.8 结构锁：单进程批量取对象，不得逐文件 spawn ────────────────────────
test('取数必须走单进程 cat-file --batch，且不得保留逐文件 git show 的取法（禁令按语义位置切，注释不算）', () => {
  const src = stripCommentsForScan(fs.readFileSync(SCRIPT, 'utf8').split(/\r\n/).join('\n'))
  assert.match(src, /cat-file/, '没走 cat-file ⇒ 全量取数会退化成逐 blob spawn（实测 2041 次超 5 分钟不完成）')
  assert.match(src, /--batch/, '必须批量一次取全部对象')
  assert.doesNotMatch(src, /git[^\n]{0,40}\bshow\b/, '源码里不得出现 git show 取 blob 的形态')
  // 反例夹具（注释里出现同一个词必须放行）：本文件上方注释含 cat-file，判据扫的是去注释后的正文
  const withCommentOnly = "'use strict'\n// git show 在这里只是注释\nmodule.exports = {}\n"
  assert.doesNotMatch(stripCommentsForScan(withCommentOnly), /git[^\n]{0,40}\bshow\b/,
    '禁令把注释当命中 ⇒ 本仓 2026-10-19 三次实测打红的同型错法')
})

// ── 1.1.10 设计轴 i2：unknown 的两个成因必须拆得开，但等式必须守住 ───────────
test('unknown 桶的子读数（字段缺席 / 字面值 unknown）之和必须等于判据给的 unknown', () => {
  const fx = makeRepo()
  fx.write('.ccg/reviews/' + name('7'.repeat(40)) + '.json', artifact(undefined)) // 字段缺席：历史产物
  fx.write('.ccg/reviews/' + name('8'.repeat(40)) + '.json', artifact({ tier: 'unknown' })) // 有人显式声明不保证
  fx.commit('two no-claim records with different causes')

  const l = watermarkLine(runWatermark(fx.dir).out)
  assert.equal(field(l, 'unknown'), '2')
  assert.equal(field(l, 'unknown-字段缺席'), '1')
  assert.equal(field(l, 'unknown-字面值'), '1')
  // 等式锁：子读数不得自成一派。判据以后改了这档语义，这一条会先红，而不是悄悄换个解释。
  const sum = Number(field(l, 'unknown-字段缺席')) + Number(field(l, 'unknown-字面值'))
  assert.equal(sum, Number(field(l, 'unknown')), '子读数之和 != 判据桶 ⇒ 拆桶的那份逻辑与判据脱钩了')
})

// ── 1.1.9 接线锁：本测试必须被 CI 点名，且落点是 fail-fast 的 bash 步 ────────
test('qm6-tier-watermark.test.js 必须接进 quality-gate.yml 的 bash 步骤（写了不跑等于没写）', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  const body = stripCommentsForScan(wf.split(/\r\n/).join('\n'))
  assert.ok(body.includes('scripts/qm6-tier-watermark.test.js'),
    '测试文件未接进 CI 可执行正文 ⇒ 它永远不会执行，也没有任何东西会因此变红')
})

// ── 1.1.11 评审 i4：被 CI 点名的测试，其实现必须真的在版本库里（改名即红） ────
// 本机实测踩过的坑：.gitignore 里 `scripts/*.js` 那条默认忽略静默吞掉新脚本，而通用例外
// `!scripts/*.test.js` 把测试兜住 ⇒ "测试入库、判据不入库"在本地完全不可见（文件在盘上），只有 CI 会红。
// 这条锁把那个不可见变成红：它读的正是 .gitignore 的 negation 与 workflow 的点名清单。
// 文案刻意只引**模式名**不引行号：这份文件很长、行号会漂，漂了以后红文案会指错地方。
// 被吞掉时当场可复现的取证命令是 `git check-ignore -v scripts/<名>.js`，它自己会回显命中的模式与行位置。
test('本刀两个判据本体必须各自有 .gitignore negation（改名或漏登记当场红）', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8').split(/\r?\n/)
  const negations = gitignore.filter((l) => l.startsWith('!scripts/')).map((l) => l.trim())
  const pairs = [
    ['scripts/qm6-tier-watermark.test.js', 'scripts/qm6-tier-watermark.js'],
    ['scripts/qm6-enforce-preview.test.js', 'scripts/qm6-enforce-preview.js'],
  ]
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  for (const [testFile, implFile] of pairs) {
    assert.ok(wf.includes(testFile), testFile + ' 没被 CI 点名 ⇒ 实现登记得再对也不会跑')
    assert.ok(negations.includes('!' + implFile),
      implFile + ' 缺 .gitignore negation ⇒ 它会被 `scripts/*.js` 那条默认忽略静默吞掉：本地全绿、CI Cannot find module')
    assert.ok(fs.existsSync(path.join(__dirname, path.basename(implFile))), implFile + ' 不在盘上')
  }
  // 反向自证：把实现名改掉，这条锁必须红（不是靠 fs.existsSync 兜住，negation 才是判据）
  const renamed = negations.filter((l) => l === '!scripts/qm6-XXX.js')
  assert.equal(renamed.length, 0, '夹具自证失效')
})

// ── 1.1.12 评审 i3：把上一条从"我自己这两个文件"推广成"CI 点名的全部实现" ──────
// 1.1.11 只盯着本刀两个文件 ⇒ critic 的指控成立的那一半是"下一个新文件照样会被吞"。
// 这一条把它推广：从 workflow 的**可执行正文**里抽出所有被 `node --test` 点名的 scripts/*.test.js，
// 按同名推出实现（`<名>.test.js` → `<名>.js`），凡该实现在盘上就必须被 git 跟踪。
// 判据取"跟踪"而不是"有 negation"：negation 只是**建档时**的机制，一旦文件被跟踪，
// 默认忽略对它就不再生效（实测 origin/main 上有 3 个被跟踪却无 negation 的本体，它们全都工作正常
// —— 若把判据写成"必须有 negation"，这条锁会在合入当天就红在三条与本次无关的历史文件上）。
// 两条反失明下界（同源教训：解析退化成空集合时"零违规"读起来完全像通过）：
// 点名数 ≥ 50、在盘实现数 ≥ 40（当场实测 98 / 56，余量给在飞 PR 的重命名）。
test('CI 点名的每个测试，其同名实现在盘时必须是受 git 跟踪的文件（含规模下界）', () => {
  const root = path.join(__dirname, '..')
  const wfText = fs.readFileSync(path.join(root, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  const body = stripCommentsForScan(wfText.split(/\r\n/).join('\n'))
  const stems = new Set()
  const re = /node\s+(?:[^\n]*?\s)?--test[^\n]*?scripts\/([A-Za-z0-9_.-]+)\.test\.js/g
  let m
  while ((m = re.exec(body)) !== null) stems.add(m[1])
  assert.ok(stems.size >= 50, '从 workflow 抽出的点名测试不足 50（实得 ' + stems.size
    + '）⇒ 抽取退化，下面的"零违规"是探针失明而不是结论')

  const tracked = new Set(String(spawnSync('git', ['ls-files', 'scripts'],
    { cwd: root, encoding: 'utf8', env: gitSafeEnv().env }).stdout || '').split('\n')
    .map((l) => path.basename(l)).filter(Boolean))
  assert.ok(tracked.size > 100, 'git ls-files 退化 ⇒ 判据无从判定（实得 ' + tracked.size + '）')

  const onDisk = []
  const missing = []
  for (const stem of stems) {
    const impl = path.join(__dirname, stem + '.js')
    if (!fs.existsSync(impl)) continue
    onDisk.push(stem + '.js')
    if (!tracked.has(stem + '.js')) missing.push(stem + '.js')
  }
  assert.ok(onDisk.length >= 40, '同名实现在盘的数量不足 40（实得 ' + onDisk.length
    + '）⇒ 命名约定漂移或抽取退化，本条测的已经不是它声称的那一格')
  assert.deepEqual(missing, [], '这些判据本体没进版本库，而点名它们的测试已接进 CI ⇒ 本地全绿、'
    + 'CI 以 Cannot find module 红（正解：补一条 `!scripts/<名>.js` 再 git add）：' + missing.join(', '))
})

// ── 1.1.13 评审 i8：本 change 的文档交叉引用必须逐条能落地（悬空引用＝合同指向空处） ──
// 动因：本刀的文档高度自指（proposal / design / tasks / 记录互相引 §D11…§D18），
// 而"改了一节、其余跟着漂"是这类文档唯一的失效方式。行号会漂、小节号也会漂，
// 所以这里按**锚点是否存在**判，不按位置判。
test('本 change 里出现的每一个 §Dn 引用，design.md 必须有对应的 Dn 小节', () => {
  const changeDir = path.join(__dirname, '..', 'openspec', 'changes', 'qm6-tier-watermark')
  const design = fs.readFileSync(path.join(changeDir, 'design.md'), 'utf8')
  const heads = new Set([...design.matchAll(/^## (D\d+)/gm)].map((m) => m[1]))
  assert.ok(heads.size >= 12, 'design.md 的 Dn 小节数只剩 ' + heads.size
    + ' 个（低于 12）⇒ 要么小节被整段删了，要么本锁的锚点形态与文档漂移了')

  const files = ['proposal.md', 'design.md', 'tasks.md', path.join('specs', 'qm6-review-chain', 'spec.md'),
    path.join('..', '..', 'records', 'qm6-tier-watermark.md')]
  let refs = 0
  const dangling = []
  for (const rel of files) {
    const text = stripCommentsForScan(fs.readFileSync(path.join(changeDir, rel), 'utf8'))
    for (const m of text.matchAll(/\bD(\d{1,2})\b/g)) {
      refs++
      const key = 'D' + m[1]
      if (!heads.has(key)) dangling.push(rel.split(path.sep).join('/') + ' → ' + key)
    }
  }
  assert.ok(refs >= 30, '本 change 里只找到 ' + refs + ' 处 Dn 引用（低于 30）⇒ 抽取退化，"零悬空"这句话是探针失明')
  assert.deepEqual([...new Set(dangling)].sort(), [],
    '这些引用指到了一个不存在的小节（读的人会按它去找落点，找不到就当没这条）：')
})

// ── 1.1.14 合取③ 第二出口的分档必须出现在水位里（2026-10-24 授权放宽，改宽不得不可见） ──
const DIG = require('./lib/ccg-delivery-digest.js')
const ADJ_FINDINGS = [{ id: 'i1', severity: 'Critical', finding: 'A', verdict: 'dismissed', rationale: '轮 6 现场判据见 §D21' }]
const ADJ_URL = 'https://github.com/o/r/pull/4308#issuecomment-1'

test('水位行必须把 external 拆成直签 / 自扮演+公开复核，且两子读数之和等于 external', () => {
  const fx = makeRepo()
  fx.write('.ccg/reviews/' + name('d'.repeat(40)) + '.json',
    artifact({ tier: 'external', evidence: DIG.deliveryEvidence(ADJ_FINDINGS), findings: ADJ_FINDINGS }))
  fx.write('.ccg/reviews/' + name('e'.repeat(40)) + '.json',
    artifact({
      tier: 'external',
      evidence: ADJ_URL,
      tierBasis: 'adjudicated-self-play',
      adjudicationDigest: DIG.adjudicationDigest(ADJ_FINDINGS, ADJ_URL),
      findings: ADJ_FINDINGS,
    }))
  // 第三条：URL 换了但绑定没跟着换 ⇒ 判据降档，水位不得再把它算进 external
  fx.write('.ccg/reviews/' + name('f'.repeat(40)) + '.json',
    artifact({
      tier: 'external',
      evidence: 'https://github.com/o/r/pull/9999#issuecomment-2',
      tierBasis: 'adjudicated-self-play',
      adjudicationDigest: DIG.adjudicationDigest(ADJ_FINDINGS, ADJ_URL),
      findings: ADJ_FINDINGS,
    }))
  fx.commit('artifacts')
  const r = runWatermark(fx.dir)
  assert.equal(r.rc, 0, r.out + r.err)
  const line = watermarkLine(r.out)
  const direct = Number(field(line, 'external-直签'))
  const adjud = Number(field(line, 'external-自扮演复核'))
  const ext = Number(field(line, 'external'))
  assert.equal(direct, 1, '直签档计数错：' + line)
  assert.equal(adjud, 1, '自扮演+公开复核档没被认出来：' + line)
  assert.equal(direct + adjud, ext, '两子读数之和 != external ⇒ 分档在撒谎（放宽的合取③ 就此不可见）')
  assert.ok(!/WATERMARK-DEFECT external 分档/.test(r.out), '不等式检查自己误报：' + r.out)
})

test('分档不等式检查必须真的会咬：判据与派生工具口径分裂时出声（反"恒真检查"）', () => {
  // 这一条不测实现内部，测的是"当 by 里没有那两个键时会怎样"：
  // summarizeTierCoverage 若不导出分档，水位这里就会 NaN != 数字 ⇒ 必须打 WATERMARK-DEFECT 而不是静默。
  const sum = require('./check-pr-exec-record.js').summarizeTierCoverage([])
  assert.equal(typeof sum.by['external(直签)'], 'number', '判据没导出分档键 ⇒ 水位的求和检查会退化成 NaN 比较')
  assert.equal(sum.by['external(直签)'] + sum.by['external(自扮演+公开复核)'], sum.by.external,
    '空集也必须满足不等式（"零违规"与"什么都没算"必须可区分）')
  assert.match(sum.line, /\[external\(直签\)=0 external\(自扮演\+公开复核\)=0\]/, sum.line)
})
