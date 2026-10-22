'use strict'
/**
 * ccg-artifact-shape-survey.test.js —— 普查工具的两把锁：判据面（纯函数）与采集面（真跑 git）
 *
 * 为什么必须有：`qm6-closure-writeback` design §2 的三条数（已闭环 / 其中无 tier / 闭集外自造值）
 * 原先是一次性手工探针的读数，属本仓明令禁止留下的孤立数（tasks 0.1b）。把交叉表搬进工具之后，
 * 工具本身也要能被证伪 —— 否则只是把孤立读数换了个存放处。
 *
 * 跑法：node --test scripts/ccg-artifact-shape-survey.test.js
 *
 * 三条设计约束（都是本仓反复踩过的形态，逐条对应到下面的用例）：
 *  ① 夹具必须让**不同输入返回不同读数** —— 对所有输入同形的夹具，对「按输入区分」这一类缺陷结构性免疫；
 *  ② 收了参数却不消费 = 死代码：词表与闭环集都做了「换一个就变一个数」的行为对偶，不只断言它存在；
 *  ③ 「空集」与「没跑」必须逐字可区分，且采集面必须真跑一次 git，不用假 rows 代替。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')

const survey = require('./ccg-artifact-shape-survey.js')
const { CLOSED_DEEP_REVIEW_STATUSES, classifyEvidenceTier } = require('./check-pr-exec-record.js')

const CLOSED = 'cleared'
const OPEN = 'pending'

function row (over) {
  return Object.assign({ file: 'x.json', mode: 'dual', status: OPEN, pb: 'null', f: 'absent', sp: -1, sc: -1, tier: 'absent' }, over)
}

test('交叉表按注入行精确成行（同输入同表、异输入异表）', () => {
  const rows = [
    row({ status: CLOSED, tier: 'absent' }),
    row({ status: CLOSED, tier: 'absent' }),
    row({ status: CLOSED, tier: 'external' }),
    row({ status: OPEN, tier: 'unknown' }),
    row({ status: CLOSED, tier: 'external' }),
    row({ status: OPEN, tier: 'absent' })
  ]
  const out = survey.summarizeClosedTier(rows, { closedSet: CLOSED_DEEP_REVIEW_STATUSES, vocabOf: survey.vocabOfJudgeAuthority })
  assert.deepStrictEqual(out.entries, [
    ['closed tier=absent', 2],
    ['closed tier=external', 2],
    ['not-closed tier=absent', 1],
    ['not-closed tier=unknown', 1]
  ])
  assert.deepStrictEqual(
    { closed: out.closed, absentInClosed: out.absentInClosed, tierPresent: out.tierPresent, unrecognized: out.unrecognized },
    { closed: 4, absentInClosed: 2, tierPresent: 3, unrecognized: 0 }
  )
})

test('closedSet 缺失或类型不对一律当场抛错（不得回落成本地默认词表）', () => {
  const rows = [row({ status: CLOSED })]
  assert.throws(
    () => survey.summarizeClosedTier(rows, { vocabOf: survey.vocabOfJudgeAuthority }),
    /closedSet 必须是调用方透传的 Set/
  )
  assert.throws(
    () => survey.summarizeClosedTier(rows, { closedSet: ['cleared'], vocabOf: survey.vocabOfJudgeAuthority }),
    /closedSet 必须是调用方透传的 Set/
  )
})

test('vocabOf 缺失一律当场抛错（与上一条各测各的，不合并计一条）', () => {
  assert.throws(
    () => survey.summarizeClosedTier([row()], { closedSet: CLOSED_DEEP_REVIEW_STATUSES }),
    /vocabOf 必须是调用方透传的 function/
  )
  assert.throws(
    () => survey.summarizeClosedTier([row()], { closedSet: CLOSED_DEEP_REVIEW_STATUSES, vocabOf: 'not-a-fn' }),
    /vocabOf 必须是调用方透传的 function/
  )
})

test('两个注入键都真被消费：换一个词表/换一个闭环集，读数必须跟着换', () => {
  const rows = [row({ status: CLOSED, tier: 'external' }), row({ status: OPEN, tier: 'external' })]
  const real = survey.summarizeClosedTier(rows, { closedSet: CLOSED_DEEP_REVIEW_STATUSES, vocabOf: survey.vocabOfJudgeAuthority })
  // vocabOf 换成「一律判成闭集外」——若实现收了却不消费，这一句不会变
  const allWild = survey.summarizeClosedTier(rows, { closedSet: CLOSED_DEEP_REVIEW_STATUSES, vocabOf: () => 'unrecognized' })
  assert.strictEqual(real.unrecognized, 0, 'external 在闭集内 ⇒ 真词表不判野值')
  assert.strictEqual(allWild.unrecognized, 2, '换词表 ⇒ 同一批行改判 2 条，证明 vocabOf 真被消费')
  assert.deepStrictEqual(allWild.entries.map((e) => e[0]), ['closed tier=unrecognized', 'not-closed tier=unrecognized'])
  // closedSet 换成空集 —— 原读数里 closed=1 必须变成 0
  const noneClosed = survey.summarizeClosedTier(rows, { closedSet: new Set(), vocabOf: survey.vocabOfJudgeAuthority })
  assert.strictEqual(real.closed, 1)
  assert.strictEqual(noneClosed.closed, 0)
  assert.ok(noneClosed.entries.every(([, n]) => n > 0), '空 closedSet 不得造出零计数行')
})

test('tier 词表经判据问一次，本文件不得另抄一份闭集（行为对偶 + 禁词锁）', () => {
  const inSet = ['external', 'self-play', 'none', 'unknown']
  for (const raw of inSet) {
    assert.strictEqual(survey.vocabOfJudgeAuthority(raw), raw, `${raw} 在闭集内 ⇒ 原样返回`)
    assert.notStrictEqual(classifyEvidenceTier({ tier: raw }), 'unrecognized')
  }
  for (const raw of ['External', 'externl', '42', '[object Object]']) {
    assert.strictEqual(survey.vocabOfJudgeAuthority(raw), 'unrecognized', `${raw} 不在闭集 ⇒ 归 unrecognized`)
    assert.strictEqual(classifyEvidenceTier({ tier: raw }), 'unrecognized')
  }
  assert.strictEqual(survey.vocabOfJudgeAuthority('absent'), 'absent')
  // 判据闭集若被改动（新增一个合法 tier 值），本文件必须跟着变 —— 这条就是"第二份事实"的检测点
  const probeRaw = '__not_a_tier__'
  assert.strictEqual(survey.vocabOfJudgeAuthority(probeRaw), classifyEvidenceTier({ tier: probeRaw }) === 'unrecognized' ? 'unrecognized' : probeRaw)

  const src = stripComments(fs.readFileSync(path.join(__dirname, 'ccg-artifact-shape-survey.js'), 'utf8'))
  const vocabLiterals = ['cleared', 'needs_revision', 'self_play_resolved'].filter((w) => src.includes(`'${w}'`))
  assert.deepStrictEqual(vocabLiterals, [], '闭环词表必须来自 check-pr-exec-record.js，不得在本文件写字面量')
  assert.match(src, /require\(['"]\.\/check-pr-exec-record\.js['"]\)/, '必须引用判据侧词表')
})

/**
 * 行保留式剥注释。**必须保持行数不变**，否则调用点逐行对齐会错位——
 * 这条不是理论担忧：本文件第一版用的 `/\*[\s\S]*?\*\//` 会把块注释连换行一起吃掉
 * （实测 379 行 → 320 行），而当时锁照样"看起来在跑"。是上面那条不变式把它抓出来的。
 */
function stripComments (s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/^\s*\/\/.*$/gm, '')
}

test('采集面真跑一次 git：混合形态的三份产物 + 一份坏 JSON 必须各归各位', () => {
  const repo = makeTempRepo([
    { name: 'a.json', body: { mode: 'dual', deepReview: { status: CLOSED, tier: 'external', evidence: 'https://github.com/o/r/pull/1#issuecomment-1' } } },
    { name: 'b.json', body: { mode: 'dual', deepReview: { status: CLOSED } } },
    { name: 'c.json', body: { mode: 'single', deepReview: { status: OPEN, tier: 'unknown' } } },
    { name: 'd.json', raw: '{ this is not json' }
  ])
  try {
    const { rows, parseFail, jsonTotal } = survey.collectRows('HEAD', { cwd: repo })
    assert.strictEqual(jsonTotal, 4, '三份好产物 + 一份坏产物都在 ls-tree 里')
    assert.strictEqual(parseFail, 1, '坏 JSON 必须计入"读不到"，不得静默消失')
    assert.strictEqual(rows.length, 3)
    const ct = survey.summarizeClosedTier(rows, { closedSet: CLOSED_DEEP_REVIEW_STATUSES, vocabOf: survey.vocabOfJudgeAuthority })
    assert.deepStrictEqual(
      { closed: ct.closed, absentInClosed: ct.absentInClosed, tierPresent: ct.tierPresent, unrecognized: ct.unrecognized },
      { closed: 2, absentInClosed: 1, tierPresent: 2, unrecognized: 0 }
    )
    assert.ok(rows.length > 0, '采集退化时不得报出与"仓里没有产物"同形的读数')
    // cwd 这个定位键必须真被消费：换一个「是 git 仓但没有 .ccg/reviews」的目录，读数要变 0。
    // （漏传不报错、中间两级成死代码那一型的检测点 —— 不这样做，本用例其实是在扫真仓。）
    // 注意探针必须是**能跑的 git 仓**：非 git 目录会让 execFileSync 抛错，那测的是 git 报错不是键的消费。
    const elsewhere = makeTempRepo([])
    try {
      assert.strictEqual(survey.collectRows('HEAD', { cwd: elsewhere }).jsonTotal, 0)
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true })
    }
  } finally {
    rmTemp(repo)
  }
})

/**
 * 前置体检（第 3 轮 i8）：本套件的采集面用例要起真 git。`git` 不可用时**必须点名失败**，
 * 不得让 ENOENT 冒成"某个断言不成立"——那是把工具缺失读成判据结论的同型错误。
 */
let gitPreflight = null
function requireGit () {
  if (gitPreflight === null) {
    try {
      gitPreflight = cp.execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()
    } catch (e) {
      throw new Error(`ERR_FIXTURE_PREREQ: 本机取不到 git（${String(e.message).split('\n')[0].slice(0, 80)}）` +
        '⇒ 采集面用例无法执行。这是前置缺失，不是判据结论，不得按 skip 处理后当成通过。')
    }
  }
  return gitPreflight
}

/**
 * 下面这组（stripStrings / lineToCode / findUnjustifiedCalls / countCallSites）是"本文件不得裸调"锁的实现。
 * 一处对 `survey.collectRows` / `survey.resolveRef` 的调用
 * 只有两种合法形态 —— 显式带 `cwd`，或标了「故意裸调」并断言它抛错。
 * （本注释**故意不写成带括号的调用形状**：文档里出现那个形状会被下面那条"文档块不藏调用"守卫点名。）
 * 判据 MUST NOT 依赖「这一行里出现了 cwd 这三个字母」：上一版就是这么写的，而那些行被放行的
 * 真实原因是**断言用的错误消息正则里恰好含 cwd**（QM-6 i1）。那是巧合，不是判据。
 *
 * 匹配前先把**字符串字面量整段剥掉**：本文件里有若干把"假裸调"当探针输入的用例，
 * 那些串不是被执行代码，扫到它们就是把判据写成"文件里出现过这个形状"而不是"这里真的调了"。
 * 剥离方向偏保守（可能漏判成"没调用"），所以另配两条：**扫描域非空下限** + 纯函数正控/反控。
 */
function stripStrings (src) {
  return src.replace(/'[^'\n]*'/g, "''").replace(/"[^"\n]*"/g, '""')
}
/**
 * 标记必须按**原文**判，不能按"剥完注释的代码"判（QM-6 第 3 轮 i3）。
 * `stripComments` 只清行首注释，所以行尾的 `// 故意裸调` 恰好活下来 —— 上一版能过是运气；
 * 一旦有人把标记写成整行注释放在调用之前，它就被剥掉，锁会把合法代码判成违规。
 * 这里把两路分开：调用点形状取剥过字符串与注释的代码行，标记与 cwd 取原文行。
 * 前提是"剥注释不改变行数"，那条不变式单独成用例（行号错位会让本锁静默脱靶）。
 */
/**
 * 逐行独立成码：`raw[i]` 与 `code[i]` 的对应关系**不能依赖跨行剥注释**。
 * 上一版把 `stripStrings(stripComments(src))` 整体喂给 split，指望行数不变——实测块注释让
 * 386 行塌成 364 行，错位 22 行后这把锁测量的就不是它声称的那一行了（是本仓说的"装饰性门禁"
 * 的又一格：判据在跑，但跑在错的对象上）。这里改为**每行自己剥自己的字符串与行尾注释**，
 * 对齐由构造保证；跨行块注释里的符号不参与判定，另用一条结构守卫保证文档块不藏调用。
 */
function lineToCode (line) {
  // 顺序要紧：先剥字符串字面量，再砍行尾注释。反过来的话，注释符出现在字符串里
  // （本文件就有一条这样的探针）会把这一行从中间截断，剩下一个引号不闭合的形状，
  // 于是"这行真的调用了"这个判断从形状上就错了。
  return stripStrings(line).replace(/\/\/.*$/, '')
}
function findUnjustifiedCalls (src) {
  const raw = src.split(/\r?\n/)
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const code = lineToCode(raw[i])
    if (!/survey\.(collectRows|resolveRef)\s*\(/.test(code)) continue
    if (/cwd\s*:/.test(code)) continue
    if (/故意裸调/.test(raw[i])) continue
    if (i > 0 && /^\s*\/\//.test(raw[i - 1]) && /故意裸调/.test(raw[i - 1])) continue
    out.push(code.trim())
  }
  return out
}
function countCallSites (src) {
  return src.split(/\r?\n/).filter((l) => /survey\.(collectRows|resolveRef)\s*\(/.test(lineToCode(l))).length
}

test('裸调锁自己可被证伪（正控必须点名注入的假裸调，否则「0 命中」是探针失明）', () => {
  assert.deepStrictEqual(findUnjustifiedCalls('  survey.collectRows("HEAD", { cwd: repo })'), [])
  assert.deepStrictEqual(findUnjustifiedCalls('  survey.collectRows("HEAD") // 故意裸调：断言它抛错'), [])
  const one = findUnjustifiedCalls('  const r = survey.collectRows("HEAD")')
  assert.strictEqual(one.length, 1, '真裸调必须被点名')
  assert.match(one[0], /survey\.collectRows\(/, '点名的那行确实是调用点（剥字符串会改变字面内容，所以断言形状而非逐字）')
  assert.strictEqual(findUnjustifiedCalls('  survey.resolveRef("HEAD")').length, 1)
  // 反控：错误消息里出现 cwd 字样，不得成为放行理由（把上一版的巧合形状钉成用例）
  assert.strictEqual(findUnjustifiedCalls('  assert.throws(() => survey.collectRows("HEAD"), /x/)').length, 1)
  // 作用域反向控制：调用只出现在字符串字面量里 ⇒ 不算调用点（否则本文件的探针会被判成违规）
  assert.strictEqual(countCallSites('  const probe = "survey.collectRows( 这串不是代码 ");'), 0)
  assert.strictEqual(countCallSites('  survey.collectRows( 这是代码 );'), 1)
})

test('标记的两条腿都要走通：整行注释与行尾注释同等有效（i3 的加固判据）', () => {
  const trailing = '  survey.collectRows("HEAD") // 故意裸调'
  const ownline = ['  // 故意裸调', '  survey.collectRows("HEAD")'].join('\n')
  assert.deepStrictEqual(findUnjustifiedCalls(trailing), [], '行尾注释标记（上一版唯一能过的形态）')
  assert.deepStrictEqual(findUnjustifiedCalls(ownline), [], '整行注释标记——上一版会被 stripComments 剥掉从而误判违规')
  assert.strictEqual(findUnjustifiedCalls('  survey.collectRows("HEAD")').length, 1, '没有标记时必须红')
  // 标记必须**紧贴**调用：隔一行就不算，否则"以后再说"的注释会变成永久豁免
  assert.strictEqual(findUnjustifiedCalls(['  // 故意裸调', '', '  survey.collectRows("HEAD")'].join('\n')).length, 1)
  // 行里只是出现过 cwd 三个字母（如错误消息正则）不构成豁免 —— 这条把 i1 指出的巧合钉死
  assert.strictEqual(findUnjustifiedCalls('  assert.throws(() => survey.collectRows("HEAD"), /cwd 必须/)').length, 1)
})

test('对齐由构造保证：lineToCode 逐行处理，且文档块里不得藏调用符号（否则本锁量错对象）', () => {
  const sample = ['// 整行注释', 'const a = 1 // 行尾注释', '', '  /* 块', '   注释 */', 'const b = 2'].join('\n')
  assert.strictEqual(sample.split(/\r?\n/).length, sample.split(/\r?\n/).map(lineToCode).length,
    '逐行处理 ⇒ 行数不可能变（旧版整块剥注释会塌行，本条把那个前提写死）')
  assert.strictEqual(lineToCode('  f(survey.collectRows("HEAD") // 说明').includes('survey.collectRows('), true,
    '行尾注释剥净后调用形状仍在')
  const self = fs.readFileSync(path.join(__dirname, 'ccg-artifact-shape-survey.test.js'), 'utf8')
  const docLines = self.split(/\r?\n/).filter((l) => /^\s*[*\/]/.test(l) && !/^\s*\/\/[^/]/.test(l))
  const hidden = docLines.filter((l) => /survey\.(collectRows|resolveRef)\s*\(/.test(l))
  assert.deepStrictEqual(hidden.map((l) => l.trim()), [],
    '文档/注释行里出现调用符号 ⇒ 逐行式扫描会把它当代码或把它漏掉，两种都错，必须改成带标记')
})

/**
 * 夹具的环境卫生（QM-6 i5）：`collectRows`/`resolveRef` 起的 git 子进程继承本进程 env。
 * 宿主若带着 `GIT_DIR`/`GIT_WORK_TREE`（在钩子里跑测试时是真的会出现），git 会**无视 cwd 参数**
 * 直接绑到那个目录上——于是"临时仓夹具"读的其实是主仓，且症状是读数不对而不是报错。
 * 这里在套件前后摘掉/还原，不污染被测模块的签名（不为测试需求给生产代码加口子）。
 */
const GIT_LEAK = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']
const savedGitEnv = {}
const removedKeys = []
test.before(() => {
  for (const k of GIT_LEAK) {
    if (k in process.env) { savedGitEnv[k] = process.env[k]; removedKeys.push(k); delete process.env[k] }
  }
})
test.after(() => {
  for (const k of GIT_LEAK) { if (k in savedGitEnv) process.env[k] = savedGitEnv[k]; else delete process.env[k] }
})

test('套件开始前宿主 git 环境必须是干净的（摘掉了什么要留痕）', () => {
  for (const k of GIT_LEAK) assert.ok(!(k in process.env), `${k} 仍在 env 里 ⇒ 本套件的临时仓夹具会读到宿主绑定的那个仓`)
  console.log(`[fixture-env] removed=${removedKeys.length ? removedKeys.join(',') : 'none'}`)
})

test('危险本身钉成用例：GIT_DIR 会静默覆盖 cwd（所以上一条卫生不是cargo-cult）', () => {
  const A = makeTempRepo([{ name: 'a.json', body: { mode: 'dual', deepReview: { status: CLOSED } } }])
  const B = makeTempRepo([{ name: 'b.json', body: { mode: 'single', deepReview: { status: 'pending' } } }])
  try {
    assert.deepStrictEqual(survey.collectRows('HEAD', { cwd: A }).rows.map((r) => r.file), ['.ccg/reviews/a.json'])
    process.env.GIT_DIR = path.join(B, '.git')
    // 2026-10-21 实测：带 {cwd: A} 的调用在 GIT_DIR=B 时返回 **B** 的内容，且不报错。
    // 这就是"夹具看着在跑、量的却是别人的仓"的假绿通道 —— 断言危险存在，而不是假装它不会发生。
    assert.deepStrictEqual(survey.collectRows('HEAD', { cwd: A }).rows.map((r) => r.file), ['.ccg/reviews/b.json'])
    delete process.env.GIT_DIR
    assert.deepStrictEqual(survey.collectRows('HEAD', { cwd: A }).rows.map((r) => r.file), ['.ccg/reviews/a.json'])
  } finally {
    delete process.env.GIT_DIR
    rmTemp(A); rmTemp(B)
  }
})

test('判据词表契约：闭集成员变了必须让本文件出声（i5，"version contract"的仓内替代）', () => {
  // 本工具的分桶口径由判据 `classifyEvidenceTier` 决定。判据**增删闭集成员**时，交叉表的桶会跟着变，
  // 而表本身不会报错——所以这里用探针把"当前闭集是哪四个"钉住：判据改了，这条立刻红，
  // 提醒改的人 design §2 那张交叉表的口径同时漂移了（不是给工具加版本号，是给口径加引信）。
  const accepted = ['external', 'self-play', 'none', 'unknown']
    .filter((v) => classifyEvidenceTier({ tier: v }) !== 'unrecognized')
  assert.deepStrictEqual(accepted.slice().sort(), ['external', 'none', 'self-play', 'unknown'])
  for (const v of ['External', 'externl', 'selfplay', 'unknown2', 'none-ish', '__not_a_tier__']) {
    assert.strictEqual(survey.vocabOfJudgeAuthority(v), 'unrecognized', `${v} 不在闭集 ⇒ 必须归 unrecognized`)
  }
  assert.strictEqual(survey.vocabOfJudgeAuthority('absent'), 'absent')
})

test('注入的 vocabOf 抛错必须原样冒出来（这把尺子坏了要出声，不得逐行标成 exception 继续量）', () => {
  const boom = () => { throw new Error('词表坏了') }
  assert.throws(() => survey.summarizeClosedTier([row()], { closedSet: CLOSED_DEEP_REVIEW_STATUSES, vocabOf: boom }), /词表坏了/)
})

test('本测试文件自己不得有未标明的裸调（扫描域非空下限单独成判据）', () => {
  const self = fs.readFileSync(path.join(__dirname, 'ccg-artifact-shape-survey.test.js'), 'utf8')
  const sites = countCallSites(self)
  assert.ok(sites >= 6, `扫描域只取到 ${sites} 处采集调用（< 6）⇒ 扫描退化，「没有裸调」这个结论不可认领`)
  assert.deepStrictEqual(findUnjustifiedCalls(self), [])
})

test('CLI 与库面分离：加载本文件不触发整仓采集（否则一次 require 数分钟）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'ccg-artifact-shape-survey.js'), 'utf8')
  assert.match(src, /if \(require\.main === module\) main\(\)/)
  const body = stripComments(src)
  const callAtTop = body.split(/\r?\n/).some((l, i) => /(^|[^\w.])collectRows\(/.test(l) && !/function collectRows/.test(l) && !/^\s/.test(l))
  assert.strictEqual(callAtTop, false, 'collectRows 只能在 main() 内调用')
})

test('空仓：交叉表必须出行并点名空集，不得与"没跑"同形', () => {
  const repo = makeTempRepo([])
  try {
    const out = cp.execFileSync(process.execPath, [path.join(__dirname, 'ccg-artifact-shape-survey.js'), '--ref=HEAD'],
      { encoding: 'utf8', cwd: repo })
    assert.match(out, /闭环 × tier 交叉表/)
    assert.match(out, /空集也出行/)
    assert.match(out, /\[闭环×tier\] closed=0 其中 tier=absent=0/)
    assert.match(out, /^REF=HEAD@[0-9a-f]{9}/m, '读数必须连着它量的是哪个 commit 一起报')
  } finally {
    rmTemp(repo)
  }
})

test('resolveRef：取不到一律出声 "unresolvable"，不得抛栈也不得留空串', () => {
  const repo = makeTempRepo([{ name: 'a.json', body: { mode: 'dual', deepReview: { status: CLOSED } } }])
  try {
    assert.match(survey.resolveRef('HEAD', { cwd: repo }), /^[0-9a-f]{40}$/)
    assert.strictEqual(survey.resolveRef('refs/heads/不存在的分支', { cwd: repo }), 'unresolvable')
    assert.strictEqual(survey.resolveRef('HEAD', { cwd: repo }).slice(0, 9).length, 9)
  } finally {
    rmTemp(repo)
  }
})

test('cwd 是必填定位键：裸调 collectRows / resolveRef 一律当场抛错（QM-6 i8）', () => {
  // 顺序是判据的一部分：纯函数断言必须排在会起 git 的断言**之前**。
  // 变异反证 M9（把守卫改成恒假）下，若先跑 collectRows('HEAD')，那条裸调不再抛错，
  // 于是本用例会去扫真仓的 1662 份产物、挂到超时——红变成"没跑完"，指不出是哪条锁失效。
  assert.throws(() => survey.requireCwd(undefined, 'probe'), /cwd 必须由调用方显式给出/)
  assert.throws(() => survey.requireCwd({}, 'probe'), /cwd 必须由调用方显式给出/)
  assert.throws(() => survey.requireCwd({ cwd: '' }, 'probe'), /cwd 必须由调用方显式给出/)
  assert.throws(() => survey.requireCwd({ cwd: '   ' }, 'probe'), /cwd 必须由调用方显式给出/)
  assert.strictEqual(survey.requireCwd({ cwd: 'a-relative-dir' }, 'probe'), 'a-relative-dir')
  // 下面三行是**故意裸调**（断言它必须抛错），所以必须带标记；不带标记就会被上一条锁点名。
  assert.throws(() => survey.collectRows('HEAD'), /必须由调用方显式给出/) // 故意裸调
  assert.throws(() => survey.collectRows('HEAD', {}), /必须由调用方显式给出/) // 故意裸调
  assert.throws(() => survey.resolveRef('HEAD'), /必须由调用方显式给出/) // 故意裸调
})

function makeTempRepo (files) {
  requireGit()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mp-survey-${process.pid}-`))
  const run = (a) => cp.execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  run(['init', '-q', '--initial-branch=main'])
  run(['config', 'user.email', 'probe@example.invalid'])
  run(['config', 'user.name', 'probe'])
  if (files.length) {
    fs.mkdirSync(path.join(dir, '.ccg', 'reviews'), { recursive: true })
    for (const f of files) {
      fs.writeFileSync(path.join(dir, '.ccg', 'reviews', f.name), f.raw || JSON.stringify(f.body, null, 2), 'utf8')
    }
  } else {
    fs.writeFileSync(path.join(dir, 'README'), 'empty\n', 'utf8')
  }
  run(['add', '-A'])
  run(['commit', '-q', '-m', 'probe'])
  return dir
}

function rmTemp (dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录留给 OS，测试不因清理失败而红 */ }
}
