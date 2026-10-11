'use strict'
/*
 * check-changelog-duplicate-entries.test.js — 用 node:test + 真实临时文件跑，不 mock 文件系统。
 * 夹具一律落在 os.tmpdir() 下带 PID/随机后缀的独立目录（并发会话会同时跑本文件）。
 * 每条"锁"都配了反向用例：只证"有重复会红"不够，还要证"没重复不会红"和"去重没吃掉唯一条目"。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { splitEntries, analyze, dedupe, collect, countByTitle, compareByTitle, main } = require('./check-changelog-duplicate-entries.js')

function tmpDir () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cde-${process.pid}-${Math.random().toString(16).slice(2)}-`))
  return dir
}

const E = (title, body) => `# [未发布] ${title}\n${body}\n\n`

test('splitEntries 按标题行切块并保留 preamble（三种行尾都不吃掉字节）', () => {
  const text = `preamble line\n${E('A', 'a1')}---\n${E('B', 'b1')}`
  const { preamble, blocks } = splitEntries(text)
  assert.equal(preamble, 'preamble line\n')
  assert.equal(blocks.length, 2)
  assert.ok(blocks[0].startsWith('# [未发布] A'))
  const headingLines = (b) => b.split('\n').filter((l) => l.replace(/\r+$/, '').startsWith('# [未发布]')).length
  assert.equal(headingLines(blocks[0]), 1, '每块只应含一个标题行')
  assert.equal(headingLines(blocks[1]), 1)
  // 块拼接回去必须与原文逐字节相同（判据：不重新生成，只搬运）
  assert.equal(preamble + blocks.join(''), text)
})

test('splitEntries 在 CRLF 文本上不改变任何字节（本仓 CHANGELOG 的实际形态）', () => {
  const crlf = `p\r\n${E('A', 'a1').replace(/\n/g, '\r\n')}---\r\n${E('B', 'b1').replace(/\n/g, '\r\n')}`
  const { preamble, blocks } = splitEntries(crlf)
  assert.equal(preamble + blocks.join(''), crlf)
  assert.equal(analyze(crlf).entries, 2)
})

test('analyze：无重复判 ok，不给出假阳性', () => {
  const text = `${E('A', 'x')}${E('B', 'yy')}${E('C', 'z')}`
  const a = analyze(text)
  assert.deepEqual(
    { entries: a.entries, distinct: a.distinct, redundant: a.redundant, ok: a.ok, worst: a.worst },
    { entries: 3, distinct: 3, redundant: 0, ok: true, worst: 1 },
  )
})

test('analyze：同题多份时按份数报出，并点名最坏的一条', () => {
  const text = `${E('A', 'x')}${E('B', 'y')}${E('A', 'x')}${E('A', 'longer body here')}${E('B', 'y')}`
  const a = analyze(text)
  assert.equal(a.entries, 5)
  assert.equal(a.distinct, 2)
  assert.equal(a.redundant, 3)
  assert.equal(a.ok, false)
  assert.equal(a.worst, 3, 'A 出现 3 次')
  assert.deepEqual(a.duplicateTitles.map((d) => [d.title, d.count]), [
    ['# [未发布] A', 3],
    ['# [未发布] B', 2],
  ])
})

test('dedupe：同题保留正文最长的那一份，顺序按标题首次出现', () => {
  const text = `PRE\n${E('A', 'short')}${E('B', 'b')}${E('A', 'much much longer body')}`
  const d = dedupe(text)
  assert.equal(d.removed, 1)
  assert.equal(d.entriesAfter, 2)
  const titles = analyze(d.text).entries
  assert.equal(titles, 2)
  assert.ok(d.text.includes('much much longer body'), '应保留最长正文')
  assert.equal(d.text.includes('short'), false, '短的那一份应被丢弃')
  assert.ok(d.text.indexOf('# [未发布] A') < d.text.indexOf('# [未发布] B'), '顺序按首次出现')
  assert.ok(d.text.startsWith('PRE\n'), 'preamble 原样在最前')
})

test('dedupe 是幂等的：跑第二遍一个字节都不动', () => {
  const text = `PRE\n${E('A', 'x')}${E('B', 'y')}${E('A', 'z longer')}${E('C', 'w')}`
  const once = dedupe(text).text
  const twice = dedupe(once)
  assert.equal(twice.removed, 0)
  assert.equal(twice.text, once)
  assert.equal(analyze(once).ok, true)
})

test('dedupe 不得吃掉唯一条目：去重后的标题集合必须与原文的标题集合相同', () => {
  const titles = ['A', 'B', 'C', 'D', 'E']
  const text = titles.map((t) => E(t, `body-${t}`)).join('') + E('B', 'dup-b-longer-body')
  const d = dedupe(text)
  const uniqBefore = [...new Set(titles)]
  const uniqAfter = splitEntries(d.text).blocks
    .map((b) => b.split('\n')[0].replace(/\r+$/, '').trim().replace('# [未发布] ', ''))
  assert.deepEqual(uniqAfter.slice().sort(), uniqBefore.slice().sort())
  assert.equal(uniqAfter.length, uniqBefore.length, '条目数必须等于不同标题数')
})

test('analyze 报的 kept 与 dedupe 实际保留的那一份必须是同一个索引（同一条规则只准一份实现）', () => {
  const text = `PRE\n${E('A', 'short')}${E('B', 'b')}${E('A', 'medium body')}${E('A', 'the longest body of all')}`
  const a = analyze(text)
  const groups = splitEntries(text).blocks
  const keptOfA = a.duplicateTitles.find((d) => d.title === '# [未发布] A').kept
  assert.equal(groups[keptOfA].includes('the longest body of all'), true, 'analyze 说要留最长那份')
  const d = dedupe(text)
  assert.equal(d.text.includes('the longest body of all'), true, 'dedupe 真留了同一份')
  assert.equal(d.text.includes('medium body'), false)
  assert.equal(d.text.includes('short'), false)
})

test('棘轮判据：base 已有的标题多一份即红；副本变少为绿；新标题允许出现一次', () => {
  const base = `${E('A', 'a1')}${E('A', 'a1b')}${E('B', 'b')}`
  assert.deepEqual(compareByTitle(base, base).grew.map((g) => [g.title, g.from, g.to]), [], '同一份内容自身为绿')
  const grew = compareByTitle(base, `${base}${E('A', 'a1c')}`)
  assert.deepEqual(grew.grew.map((g) => [g.title, g.from, g.to]), [['# [未发布] A', 2, 3]], 'A 被多插一份必须被抓')
  assert.deepEqual(compareByTitle(base, `${E('A', 'a1')}${E('B', 'b')}`).grew, [], '把副本削少（去重方向）必须为绿')
  assert.deepEqual(compareByTitle(base, `${base}${E('NEW', 'n')}`).grew, [], '本 PR 新增一条自己的条目是正常形状')
  assert.deepEqual(
    compareByTitle(base, `${base}${E('NEW', 'n')}${E('NEW', 'n again')}`).grew.map((g) => [g.title, g.from, g.to]),
    [['# [未发布] NEW', 0, 2]], '新标题被插两遍也要抓（只遍历 base 标题就会漏掉这种）',
  )
})

test('main --base 走真 git：base=head 判绿，ref 不存在必须 fail-closed 判红', () => {
  const { execFileSync } = require('node:child_process')
  const root = execFileSync('node', ['-e', 'process.stdout.write(process.cwd())'], { encoding: 'utf8' }).trim()
  const log = []
  const origLog = console.log
  const origErr = console.error
  try {
    console.log = (...a) => log.push(a.join(' '))
    console.error = (...a) => log.push('ERR:' + a.join(' '))
    assert.equal(main([`--root=${root}`, '--base=HEAD', '--head=HEAD']), 0, '同一份内容自比必须为绿')
    assert.equal(main([`--root=${root}`, '--base=no-such-ref-abcdef', '--head=HEAD']), 1, '取不到 base 不得判绿')
  } finally {
    console.log = origLog
    console.error = origErr
  }
})

test('countByTitle 与 analyze 用的是同一套切块与标题口径', () => {
  const text = `P\n${E('A', 'x')}${E('B', 'y')}${E('A', 'z')}`
  const counts = countByTitle(text)
  const a = analyze(text)
  assert.equal(counts.get('# [未发布] A'), 2)
  assert.equal(counts.get('# [未发布] B'), 1)
  assert.equal(a.entries, [...counts.values()].reduce((s, n) => s + n, 0), '两处的条目数必须一致')
  assert.equal(a.redundant, a.entries - counts.size)
})

test('collect 对「文件缺失 / 空文件 / 没有任何条目」三种取数失败都抛错（不把失败读成干净）', () => {
  const dir = tmpDir()
  try {
    assert.throws(() => collect({ root: dir, path: 'nope.md' }), /找不到目标文件/)
    fs.writeFileSync(path.join(dir, 'empty.md'), '', 'utf8')
    assert.throws(() => collect({ root: dir, path: 'empty.md' }), /为空/)
    fs.writeFileSync(path.join(dir, 'noheading.md'), 'just text\n', 'utf8')
    assert.throws(() => collect({ root: dir, path: 'noheading.md' }), /一条/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('main：有重复返回 1，干净返回 0，取不到文件返回 1（门禁的退出码契约）', () => {
  const dir = tmpDir()
  const log = []
  const origLog = console.log
  const origErr = console.error
  try {
    console.log = (...a) => log.push(a.join(' '))
    console.error = (...a) => log.push('ERR:' + a.join(' '))
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `P\n${E('A', 'x')}${E('A', 'y longer')}`, 'utf8')
    assert.equal(main(['--root=' + dir]), 1, '重复必须 rc=1')
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `P\n${E('A', 'x')}${E('B', 'y')}`, 'utf8')
    assert.equal(main(['--root=' + dir]), 0, '干净必须 rc=0')
    assert.equal(main(['--root=' + dir, '--path=nope.md']), 1, '取不到必须 rc=1（不得静默通过）')
  } finally {
    console.log = origLog
    console.error = origErr
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('main --dedup --apply 写盘后独立回读为干净；且无重复时不产生任何写入', () => {
  const dir = tmpDir()
  const log = []
  const origLog = console.log
  const origErr = console.error
  try {
    console.log = (...a) => log.push(a.join(' '))
    console.error = (...a) => log.push('ERR:' + a.join(' '))
    const dirty = `P\n${E('A', 'x')}${E('A', 'y longer')}${E('B', 'b')}`
    const f = path.join(dir, 'CHANGELOG.md')
    fs.writeFileSync(f, dirty, 'utf8')
    assert.equal(main(['--root=' + dir, '--dedup', '--apply']), 0)
    assert.ok(log.join('\n').includes('removed=1'), '应报出去掉了 1 份')
    assert.equal(analyze(fs.readFileSync(f, 'utf8')).ok, true, '写盘后独立回读必须干净')

    // 幂等：再跑一次应"无改动不写盘"（用 mtime 变化以外的判据——内容必须逐字节相同）
    const before = fs.readFileSync(f)
    log.length = 0
    assert.equal(main(['--root=' + dir, '--dedup', '--apply']), 0)
    assert.ok(log.join('\n').includes('无改动'), '第二次应报无改动')
    assert.equal(Buffer.compare(fs.readFileSync(f), before), 0, '第二次不得改动文件字节')
  } finally {
    console.log = origLog
    console.error = origErr
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/*
 * ── changelog-dedup-reconcile.js 的锁（QM-6 F-A）─────────────────────────
 * 对账器存在的意义就是"产生清理的那个脚本不能自己给自己开证明"，
 * 所以这里的每一条反向用例都必须让**对账器**红，而不是让 dedupe 红。
 * 一律用真 git 仓库（os.tmpdir 下独立目录 + 隔离 GIT_CONFIG_GLOBAL），blob 形态与 CI 一致。
 */
const { execFileSync } = require('node:child_process')
const { reconcile, main: reconcileMain } = require('./changelog-dedup-reconcile.js')

function makeGitRepo () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rec-${process.pid}-${Math.random().toString(16).slice(2)}-`))
  const cfg = path.join(dir, 'empty-gitconfig')
  fs.writeFileSync(cfg, '')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_SYSTEM: cfg, HOME: dir, USERPROFILE: dir }
  const g = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env, maxBuffer: 1 << 26 })
  g(['init', '-q', '-b', 'main'])
  return { dir, g }
}

function commit (repo, content, msg) {
  fs.writeFileSync(path.join(repo.dir, 'CHANGELOG.md'), content)
  repo.g(['add', '--', 'CHANGELOG.md'])
  repo.g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg])
}

test('对账器：合法清理（同题削到 1 份 + 留 pickKeeper 那份 + 新增一条自己的台账）⇒ 过', () => {
  const repo = makeGitRepo()
  commit(repo, `---\n${E('A', 'a1')}${E('B', 'b1')}${E('B', 'b2 更长那份')}${E('C', 'c1')}`, 'base with duplicates')
  commit(repo, `---\n${E('A', 'a1')}${E('B', 'b2 更长那份')}${E('C', 'c1')}${E('D', '本 PR 自己那条')}`, 'dedup + own new entry')
  const r = reconcile({ base: 'HEAD^', head: 'HEAD', root: repo.dir })
  assert.deepEqual(r.failures, [], '合法清理不该被判红：' + r.failures.join(' ; '))
  assert.equal(r.ok, true)
  assert.equal(r.base_redundant, 1)
  assert.equal(r.head_redundant, 0)
  assert.equal(reconcileMain(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 0)
  fs.rmSync(repo.dir, { recursive: true, force: true })
})

test('对账器负控一：某个标题一份都不剩 ⇒ 红（这才是 #2884 那种事故，不能被"削副本"的说法洗白）', () => {
  const repo = makeGitRepo()
  commit(repo, `---\n${E('A', 'a1')}${E('B', 'b1')}${E('B', 'b2 更长')}`, 'base')
  commit(repo, `---\n${E('B', 'b2 更长')}`, 'A 整条不见了')
  const r = reconcile({ base: 'HEAD^', head: 'HEAD', root: repo.dir })
  assert.match(r.failures.join('\n'), /标题整条消失/)
  assert.equal(reconcileMain(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1)
  fs.rmSync(repo.dir, { recursive: true, force: true })
})

test('对账器负控二：保留块被人改写过（只差一个 CR 也算）⇒ 红', () => {
  const repo = makeGitRepo()
  commit(repo, `---\n${E('A', 'a1')}${E('B', 'b1')}${E('B', 'b2 更长')}`, 'base')
  // 正文与 base 的任一副本都不逐字节相同：这里把最长那份的结尾行尾改成了 \r\n
  const edited = `---\n${E('A', 'a1')}${E('B', 'b2 更长').replace('\n\n', '\r\n\r\n')}`
  commit(repo, edited, 'kept copy edited')
  const r = reconcile({ base: 'HEAD^', head: 'HEAD', root: repo.dir })
  assert.match(r.failures.join('\n'), /逐字节|pickKeeper/, '必须点名是同源性坏了：' + r.failures.join(' ; '))
  assert.equal(reconcileMain(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1)
  fs.rmSync(repo.dir, { recursive: true, force: true })
})

test('对账器负控三：head 里仍有同题多份 ⇒ 红（幂等性质与"每标题恰好一块"都被守住）', () => {
  const repo = makeGitRepo()
  commit(repo, `---\n${E('A', 'a1')}${E('B', 'b1')}${E('B', 'b2 更长')}`, 'base')
  // 必须让 head 与 base 有实际差异，否则 git 不产生提交（第一版夹具就是"完全相同"，直接 commit 失败）
  commit(repo, `---\n${E('A', 'a1')}${E('B', 'b1')}${E('B', 'b2 更长')}${E('D', '新加一条但没削旧副本')}`, '加了新条目却没削重复')
  const r = reconcile({ base: 'HEAD^', head: 'HEAD', root: repo.dir })
  // 分别钉住两条：A4 幂等 与 A5「每标题恰好一块」。合成一条正则会让"只剩一条还在工作"看不出来。
  const all = r.failures.join('\n')
  assert.match(all, /幂等不成立/, 'A4 必须报：' + r.failures.join(' ; '))
  assert.match(all, /结果里仍有同题多份/, 'A5 必须报：' + r.failures.join(' ; '))
  // 反向一半：A3 只适用于"被削减成恰好一份"的标题。没削干净的档位报 A4/A5 就够了，
  // 若把它也算成"留错了份"，报错文案会把人往"pickKeeper 挑错了"的方向带走 —— 误报不是判据的一部分。
  assert.doesNotMatch(all, /留下的不是 pickKeeper/, 'A3 不得对未削减的标题开火：' + r.failures.join(' ; '))
  assert.equal(r.ok, false)
  fs.rmSync(repo.dir, { recursive: true, force: true })
})

test('对账器 fail closed：head 零条目 ⇒ 抛并判红，不得读成"零丢失"', () => {
  const repo = makeGitRepo()
  commit(repo, `---\n${E('A', 'a1')}`, 'base')
  commit(repo, '---\n这段正文里没有任何一级标题\n', 'head has no entries')
  assert.equal(reconcileMain(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1)
  fs.rmSync(repo.dir, { recursive: true, force: true })
})

/*
 * 对账器的 OK 自述必须与它实际判定的性质集合一致（同 PR 的"自述失真"锁）。
 * 动因：reconcile 实跑 A1–A6（A6 是 QM-6 后端 MAJOR-3 补的 preamble 逐字节不变），
 * 但成功那行只列 A1–A5 并自称「五项全过」—— 被检项少报一项，读日志的人会以为 preamble 没人看。
 * 判据取自**源码里真正 push 进 failures 的 A 前缀集合**，不是手写清单（手写清单会跟着漂移）。
 */
test('对账器 OK 自述必须覆盖它实际跑的性质，且声明的条数与列出的条数相等', () => {
  const src = fs.readFileSync(path.join(__dirname, 'changelog-dedup-reconcile.js'), 'utf8')
  // 注：下面这条锚点对源码排版敏感（整句换成别的写法就漏取），真正兜住「锚点退化成空集合」的是紧随其后的
// 规模下界断言，不是这条正则本身 —— 改 reconcile 判据排版时必须先看那条还成不成立。
const implemented = [...new Set([...src.matchAll(/failures\.push\(\s*`A(\d)/g)].map((m) => 'A' + m[1]))].sort()
  assert.ok(implemented.length >= 5, '判据本身退化（只取到 ' + implemented.length + ' 条 A 性质）—— 空集合会让本锁恒真')
  const repo = makeGitRepo()
  commit(repo, `---\n${E('A', 'a1')}${E('B', 'b1')}${E('B', 'b2 更长那份')}${E('C', 'c1')}`, 'base with duplicates')
  commit(repo, `---\n${E('A', 'a1')}${E('B', 'b2 更长那份')}${E('C', 'c1')}${E('D', '本 PR 自己那条')}`, 'legal dedup + own entry')
  const lines = []
  const origLog = console.log, origErr = console.error
  console.log = (...a) => { lines.push(a.join(' ')); }
  console.error = (...a) => { lines.push(a.join(' ')); }
  let rc
  try { rc = reconcileMain(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']) } finally { console.log = origLog; console.error = origErr; }
  assert.equal(rc, 0, '合法清理必须过，实跑红说明夹具失效而不是锁生效')
  const okLine = lines.find((l) => /\[changelog-dedup-reconcile\] OK/.test(l))
  assert.ok(okLine, '必须有一行 OK 自述（没有就没人能从日志知道跑了哪些判据）')
  for (const a of implemented) {
    assert.ok(okLine.includes(a), `OK 自述漏报了实际在跑的 ${a}（implemented=${implemented.join(
)}）`)
  }
  const CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 }
  const declared = okLine.match(/([一二三四五六七八九十\d]+)\s*项/)
  assert.ok(declared, 'OK 自述必须声明判据条数（如「六项全过」）')
  const n = /^\d+$/.test(declared[1]) ? Number(declared[1]) : CN[declared[1]]
  assert.equal(n, implemented.length, `声明 ${n} 项，实际跑 ${implemented.length} 项 —— 自述失真`)
  fs.rmSync(repo.dir, { recursive: true, force: true })
})
