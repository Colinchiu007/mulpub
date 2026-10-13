'use strict'
/*
 * scripts/check-record-qm5-rows.js 的锁（node --test）
 *
 * 判据要守的东西（本会话实测到的事故）：一份执行记录的「防止再次发生（QM-5 ⑤）」行标题
 * 在多次改写中被吞掉，正文并入上一行末尾，于是五步只剩四步有名有姓，而**没有任何门禁变红**
 * （check-pr-exec-record.js 只判"本 PR 携带执行记录或带原因的豁免"，不校验行集）。
 * 摸底还发现这不是孤例：全仓 254 份记录中，25 份用了 QM-5 标记却缺 ⑤。
 *
 * 三条设计约束，每条都有对应的用例钉住：
 *  A. **必须必需集从 _TEMPLATE.md 派生**，不得在代码里手抄"①②③④⑤"——
 *     实测模板本身只声明 ①②④⑤（不含 ③ 系统性漏洞），手抄五个会让模板自己当场红。
 *  B. 只对**本 PR 改动的记录**生效（改动面棘轮），未用 QM-5 约定的历史记录不进域。
 *  C. 欠账清单只能缩小：清单里登了但实况不缺 ⇒ 陈旧登记必须红（同 check-unwired-tests 的口径）。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const {
  requiredStepsFromTemplate,
  stepsPresentInRecord,
  collect,
  KNOWN_MISSING_QM5,
} = require('./check-record-qm5-rows.js')

const TEMPLATE_WITH_FOUR = [
  '| 门禁 | 状态 | Fresh 证据 |',
  '|------|------|-----------|',
  '| 变更类型与隔离 |  | x |',
  '| 第一性原因（QM-5 ①） |  |  |',
  '| 逃逸分析（QM-5 ②） |  |  |',
  '| 修复 + 回归保护（QM-5 ④） |  |  |',
  '| 防止再次发生（QM-5 ⑤） |  |  |',
  '| 远程同步 | PENDING | y |',
].join('\n')

const REC_FULL = [
  '## 本次执行记录：t（slug，2026-10-13）',
  '',
  '| 门禁 | 状态 | Fresh 证据 |',
  '|------|------|-----------|',
  '| 变更类型与隔离 | PASS | a |',
  '| 第一性原因（QM-5 ①） | PASS | b |',
  '| 逃逸分析（QM-5 ②） | PASS | c |',
  '| 系统性漏洞（QM-5 ③） | PASS | d |',
  '| 修复 + 回归保护（QM-5 ④） | PASS | e |',
  '| 防止再次发生（QM-5 ⑤） | PASS | f |',
  '| 远程同步 | PASS | g |',
].join('\n')

const REC_MISSING_5 = REC_FULL.replace(/^.*防止再次发生（QM-5 ⑤）.*\n/m, '')
// 事故形状本体：⑤ 的正文被并进上一行末尾，行标题消失
const REC_SWALLOWED_5 = REC_MISSING_5.replace(
  '| 修复 + 回归保护（QM-5 ④） | PASS | e |',
  '| 修复 + 回归保护（QM-5 ④） | PASS | e ①棘轮现在测的是它声称的变量（并入的正文） |'
)
const REC_OLD_FORMAT = ['## 本次执行记录：老格式（无 QM-5 字面）', '', '| 门禁 | 状态 | 证据 |', '| 根因 | PASS | x |'].join('\n')

function fixtureRoot(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm5rows-'))
  const rec = path.join(dir, 'openspec', 'records')
  fs.mkdirSync(rec, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    const p = path.join(rec, name)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text)
  }
  return dir
}

// ── A. 必需集来自模板派生 ────────────────────────────────────────────────
test('必需步骤集从模板行题派生：模板声明什么就要求什么', () => {
  const got = requiredStepsFromTemplate(TEMPLATE_WITH_FOUR)
  assert.deepStrictEqual(got, ['①', '②', '④', '⑤'],
    '模板里没有 ③ 就不得要求 ③（手抄五个会让模板自身当场红）')
})

test('真实仓库的模板：派生结果非空，且不含未被模板声明的步骤', () => {
  const root = path.resolve(__dirname, '..')
  const tpl = fs.readFileSync(path.join(root, 'openspec/records/_TEMPLATE.md'), 'utf8')
  const got = requiredStepsFromTemplate(tpl)
  assert.ok(Array.isArray(got) && got.length >= 3, '模板至少要声明 3 步，否则解析退化成空集（假绿）')
  assert.ok(!tpl.includes('系统性漏洞（QM-5 ③）') || got.includes('③'),
    '若模板声明了 ③，派生结果必须含 ③')
})

test('记录里出现的步骤标记按行题采集，正文里提到的字样不算', () => {
  const present = stepsPresentInRecord(
    REC_MISSING_5 + '\n本行只是引用了 防止再次发生（QM-5 ⑤） 这个说法，不是表格行\n'
  )
  assert.ok(!present.has('⑤'), '非表格行里出现的 ⑤ 不得算作"该行存在"，否则一句注释就能糊过判据')
  assert.ok(present.has('①') && present.has('②') && present.has('④'))
})

// ── B. 改动面棘轮 + 域排除 ───────────────────────────────────────────────
test('合规记录不进违规集（正向夹具，防"合规形态被误报"）', () => {
  const root = fixtureRoot({ 'ok.md': REC_FULL, '_TEMPLATE.md': TEMPLATE_WITH_FOUR })
  try {
    const r = collect({ root, changed: ['openspec/records/ok.md'], templateText: TEMPLATE_WITH_FOUR, known: {} })
    assert.deepStrictEqual(r.violations, [], '五步齐全的记录不得被判违规')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('缺 ⑤ 的被改动记录必须被点名（本会话实际事故形状：行标题被吞、正文并入上一行）', () => {
  const root = fixtureRoot({ 'swallowed.md': REC_SWALLOWED_5, '_TEMPLATE.md': TEMPLATE_WITH_FOUR })
  try {
    const r = collect({ root, changed: ['openspec/records/swallowed.md'], templateText: TEMPLATE_WITH_FOUR, known: {} })
    assert.strictEqual(r.violations.length, 1)
    assert.strictEqual(r.violations[0].file, 'openspec/records/swallowed.md')
    assert.deepStrictEqual(r.violations[0].missing, ['⑤'])
    assert.match(JSON.stringify(r), /防止再次发生/, '违规文案要点名缺的是哪一步的行题')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('未使用 QM-5 约定的历史记录不进检查域（不误伤老格式）', () => {
  const root = fixtureRoot({ 'old.md': REC_OLD_FORMAT })
  try {
    const r = collect({ root, changed: ['openspec/records/old.md'], templateText: TEMPLATE_WITH_FOUR, known: {} })
    assert.deepStrictEqual(r.violations, [])
    assert.deepStrictEqual(r.inDomain, [], '老格式记录不得被算进域内')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('模板自身与豁免目录被排除（模板是判据来源，不是被审对象）', () => {
  const root = fixtureRoot({ '_TEMPLATE.md': TEMPLATE_WITH_FOUR, '_exempt/x.md': REC_MISSING_5, '_legacy-absent.md': REC_MISSING_5 })
  try {
    const r = collect({
      root,
      changed: ['openspec/records/_TEMPLATE.md', 'openspec/records/_exempt/x.md', 'openspec/records/_legacy-absent.md'],
      templateText: TEMPLATE_WITH_FOUR,
      known: {},
    })
    assert.deepStrictEqual(r.inDomain, [], '这三类路径必须整体排出域外')
    assert.deepStrictEqual(r.violations, [])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

// ── C. 欠账清单只能缩小 ──────────────────────────────────────────────────
test('欠账登记项可以免报，但登记了却不缺 ⇒ 陈旧登记必须红（清单只能缩小）', () => {
  const root = fixtureRoot({ 'fine.md': REC_FULL, 'bad.md': REC_MISSING_5 })
  try {
    const r = collect({
      root,
      changed: ['openspec/records/fine.md', 'openspec/records/bad.md'],
      templateText: TEMPLATE_WITH_FOUR,
      known: { 'openspec/records/fine.md': '早已补齐，忘了删登记' },
    })
    assert.deepStrictEqual(r.violations.map((v) => v.file), ['openspec/records/bad.md'])
    assert.deepStrictEqual(r.stale, ['openspec/records/fine.md'], '已补齐却还挂在清单里 ⇒ 键漂移不许静默')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('清单里登了、但文件已从改动集消失且确实缺行 ⇒ 不算陈旧（防"用摘掉登记来销账"）', () => {
  const root = fixtureRoot({ 'gone.md': REC_MISSING_5 })
  try {
    const r = collect({ root, changed: [], templateText: TEMPLATE_WITH_FOUR, known: { 'openspec/records/gone.md': '历史缺口' } })
    assert.deepStrictEqual(r.stale, [], '文件仍缺行时，登记项不算陈旧')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

// ── 真实仓库：域规模下界 + 现状对账 ──────────────────────────────────────
test('真实仓库：检查域非空且有规模下界；本 PR 改动集内不得有未登记缺行', () => {
  const root = path.resolve(__dirname, '..')
  const all = fs.readdirSync(path.join(root, 'openspec/records')).filter((f) => f.endsWith('.md'))
  assert.ok(all.length >= 200, `记录文件数下界 200，实测 ${all.length} —— 解析/枚举退化时这条要先响`)
  const r = collect({ root, changed: [], templateText: fs.readFileSync(path.join(root, 'openspec/records/_TEMPLATE.md'), 'utf8') })
  assert.ok(r.inDomain.length >= 100, `使用 QM-5 约定的记录至少 100 篇（实测 ${r.inDomain.length}），否则域判定本身坏了`)
  assert.deepStrictEqual(r.violations, [], '真实仓库当前不得有"改动集内未登记"的缺行')
})

test('CLI 必须从进程入口跑（只测导出函数等于没测 CLI 层）', () => {
  const root = path.resolve(__dirname, '..')
  const p = spawnSync(process.execPath, [path.join(__dirname, 'check-record-qm5-rows.js'),
    '--base=origin/main', '--head=HEAD'], { encoding: 'utf8', cwd: root })
  assert.ok(!/ENOENT|Usage:|Cannot find module/.test(p.stderr || ''), 'CLI 必须真的可执行：' + (p.stderr || '').slice(0, 120))
  assert.ok([0, 1, 2].includes(p.status), `rc 必须落在 0/1/2 三档，实测 ${p.status}：${(p.stderr || '').slice(0, 120)}`)
  assert.match(p.stdout, /欠账登记=/, '输出必须有"欠账登记"这一可见项')
})

// ── 承重两条：unregistered 与改动集无关；CLI 端到端真跑 ──────────────────
test('全仓未登记缺行必须被点名，且不依赖改动集（否则新缺口能靠"没人改它"隐身）', () => {
  const root = fixtureRoot({ 'silent.md': REC_MISSING_5, '_TEMPLATE.md': TEMPLATE_WITH_FOUR })
  try {
    const r = collect({ root, changed: [], templateText: TEMPLATE_WITH_FOUR, known: {} })
    assert.strictEqual(r.violations.length, 0, '不在改动集 ⇒ 不进 violations（口径 B）')
    assert.deepStrictEqual(r.unregistered.map((v) => v.file), ['openspec/records/silent.md'],
      '但必须进 unregistered —— 这条是"清单只能缩小"的承重位')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('CLI 端到端：临时 git 仓库里删掉 ⑤ 行必须 rc=1，补回必须 rc=0（正向对偶）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm5cli-'))
  const rec = path.join(dir, 'openspec', 'records')
  fs.mkdirSync(rec, { recursive: true })
  fs.writeFileSync(path.join(rec, '_TEMPLATE.md'), TEMPLATE_WITH_FOUR)
  const CLI = path.join(__dirname, 'check-record-qm5-rows.js')
  const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e', '-C', dir].concat(a),
    { encoding: 'utf8' })
  try {
    // commit1：合规记录
    fs.writeFileSync(path.join(rec, 'e2e.md'), REC_FULL + '\n')
    g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'c1')
    // commit2：删掉 ⑤ 那一行（复刻本会话的事故形状）
    fs.writeFileSync(path.join(rec, 'e2e.md'), REC_MISSING_5 + '\n')
    g('add', '-A'); g('commit', '-q', '-m', 'c2')
    const bad = spawnSync(process.execPath, [CLI, '--root=' + dir, '--base=HEAD~1', '--head=HEAD'],
      { encoding: 'utf8' })
    assert.strictEqual(bad.status, 1, '删行后 CLI 必须 rc=1，实测 rc=' + bad.status + ' 输出=<<' + (bad.stdout || '').slice(0, 200) + '>>')
    assert.match(bad.stdout, /e2e\.md.*防止再次发生/s, 'rc=1 的文案必须点名文件与缺的那一步')

    // commit3：把 ⑤ 补回去 ⇒ 必须回到 rc=0（否则这条门禁恒红，等于没有）
    fs.writeFileSync(path.join(rec, 'e2e.md'), REC_FULL + '\n')
    g('add', '-A'); g('commit', '-q', '-m', 'c3')
    const good = spawnSync(process.execPath, [CLI, '--root=' + dir, '--base=HEAD~1', '--head=HEAD'],
      { encoding: 'utf8' })
    assert.strictEqual(good.status, 0, '补回后必须 rc=0，实测=<<' + (good.stdout || '').slice(0, 240) + '>>')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test('KNOWN_MISSING_QM5 每条必须带原因，且键必须是真实存在的记录文件', () => {
  const root = path.resolve(__dirname, '..')
  const entries = Object.entries(KNOWN_MISSING_QM5)
  assert.ok(entries.length >= 1, '摸底测得 25 篇缺 ⑤，清单不得为空集（空集=把既有缺口当不存在）')
  for (const [file, reason] of entries) {
    assert.match(file, /^openspec\/records\/.+\.md$/, `键必须是记录载体路径：${file}`)
    assert.ok(String(reason).trim().length >= 8, `欠账必须带可读原因：${file}`)
    const abs = path.join(root, file)
    assert.ok(fs.existsSync(abs), `欠账必须指向真实存在的记录文件（陈旧路径登记=永不生效的防线）：${file}`)
    const r = collect({ root, changed: [file], templateText: fs.readFileSync(path.join(root, 'openspec/records/_TEMPLATE.md'), 'utf8'), known: KNOWN_MISSING_QM5 })
    // 承重的是 unregistered（与改动集无关的那一路判据）。changed=[] 时 violations 恒空，
    // 拿它当"已登记所以不报"的证据是装饰性断言 —— 这里故意把该文件放进 changed 再判。
    assert.ok(!r.violations.some((v) => v.file === file), `已登记的 ${file} 不得进 violations`)
    assert.ok(!r.unregistered.some((v) => v.file === file), `已登记的 ${file} 不得算未登记缺行`)
    assert.ok(r.inDomain.includes(file), `${file} 必须真的在检查域内，否则"它被登记了"这件事毫无意义（空集也满足"不报错"）`)
  }
})
