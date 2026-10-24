'use strict'
/* check-schedule-failure-watch.js 的行为锁（node --test，只用内置模块，零真实出站、零网络）
 *
 * 两条方向相反的判据都必须有正反控：
 *  - 「带 schedule 却不在报警名单里」⇒ 红（这是 cleanup 的定时 run 连红 9 次的真因）
 *  - 「名单里有名字但没有工作流叫这个名」⇒ 红（改名/删作业会让名单读起来像已覆盖）
 * 合规模拟（夹具里名字齐了）必须绿 —— 只测"能红"的锁会把自己的修复路径也焊死。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { judge, loadWorkflows } = require('./check-schedule-failure-watch.js')

const REPO = process.env.SWD_REPO || path.resolve(__dirname, '..')

function fixture (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swd-'))
  const wd = path.join(dir, '.github', 'workflows')
  fs.mkdirSync(wd, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(wd, name), body, 'utf8')
  }
  return dir
}
// 夹具一律用「行数组 + join 换行符」拼，不要写成"YAML 键名冒号紧跟一个转义换行"的串：
// Gate 12c 的绝对路径计数会把那种写法读成盘符形态（键名尾部的冒号紧跟一个转义符开头），
// 三条就报三处"新增本机绝对路径"。改写法而不是改账本（账本只能缩小，是 AGENTS 明令的口径）。
// 同理，本注释也不原样引用那个被禁字面量 —— 门禁扫的是整个文件，注释对它算正文。
const y = (lines) => lines.join('\n') + '\n'
const HANDLER = (list) => y([
  'name: CI Failure Handler (Level 4)',
  'on:',
  '  workflow_run:',
  `    workflows: [${list.map((s) => `"${s}"`).join(', ')}]`,
  '    types: [completed]',
  'jobs:',
  '  handle-ci-failure:',
  "    if: ${{ github.event.workflow_run.conclusion == 'failure' }}",
  '    runs-on: windows-latest',
  '    steps:',
  '      - name: x',
  '        run: echo hi',
])
const SCHED = (title) => y(['name: ' + title, 'on:', '  schedule:', "    - cron: '23 3 * * *'", 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps: []'])
const PUSHONLY = (title) => y(['name: ' + title, 'on:', '  push:', '    branches: [main]', 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps: []'])

test('T1 负控：带 schedule 却不在名单里 ⇒ FAIL 并逐条点名文件', () => {
  const dir = fixture({
    'ci-failure-handler.yml': HANDLER(['Something Else']),
    'cleanup-artifacts.yml': SCHED('Cleanup Artifacts'),
  })
  try {
    const r = judge(dir)
    assert.equal(r.verdict, 'FAIL')
    assert.equal(r.scheduledCount, 1)
    assert.deepEqual(r.uncovered.map((u) => u.file), ['cleanup-artifacts.yml'])
    assert.equal(r.stale.length, 1, '"Something Else" 没有对应工作流 ⇒ 另一头的红')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('T2 正控：名单收全 ⇒ 必须绿（合规形态不得红）', () => {
  const dir = fixture({
    'ci-failure-handler.yml': HANDLER(['Cleanup Artifacts', 'Dep Audit']),
    'cleanup-artifacts.yml': SCHED('Cleanup Artifacts'),
    'dep-audit.yml': SCHED('Dep Audit'),
    'docs.yml': PUSHONLY('Docs'),
  })
  try {
    const r = judge(dir)
    assert.equal(r.verdict, 'OK', JSON.stringify(r))
    assert.equal(r.scheduledCount, 2)
    assert.equal(r.uncovered.length + r.stale.length, 0)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('T3 注释免疫：名单括号内部夹的注释行不得变成一条"名单项"', () => {
  // 取这个形状是因为它才是真会坏的地方：`workflows: [` 之后 `[^\]]*` 会一路吞到 `]`，
  // 括号内的注释行**不剥就会被当成一个名字** ⇒ 凭空多出一条"陈旧名单项"，判据对自己的
  // 修复路径报红（本仓踩过"锁把自己的合规写法判红"那一类）。
  // 注：`#   schedule:` 这类注释本来就匹配不上锚点，守住它的是**锚定**而不是剥注释，
  // 那条性质由 T3b + 变异 m8 负责，不要在这里混着声称。
  const withInlineComment = y([
    'name: CI Failure Handler (Level 4)',
    'on:',
    '  workflow_run:',
    '    workflows: [',
    '      "Cleanup Artifacts",',
    '      # 下面这三条也是定时作业，别删',
    '    ]',
    '    types: [completed]',
    'jobs:',
    '  handle-ci-failure:',
    '    runs-on: windows-latest',
    '    steps: []',
  ])
  const dir = fixture({
    'ci-failure-handler.yml': withInlineComment,
    'cleanup-artifacts.yml': SCHED('Cleanup Artifacts'),
  })
  try {
    const r = judge(dir)
    assert.equal(r.listCount, 1, `括号内注释被当成名单项 ⇒ ${JSON.stringify(r)}`)
    assert.equal(r.stale.length, 0)
    assert.equal(r.verdict, 'OK')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('T3b 注释里的 schedule 字样不得被读成一次声明（散文 ≠ 触发器）', () => {
  const body = y([
    'name: Not Scheduled',
    '# 这份作业不是定时触发的，历史上曾在下面这种块里写过示例：',
    '#   schedule:',
    "#     - cron: '0 0 * * *'",
    'on:',
    '  push:',
    '    branches: [main]',
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    steps: []',
  ])
  const dir = fixture({ 'ci-failure-handler.yml': HANDLER(['Not Scheduled']), 'not-scheduled.yml': body })
  try {
    const r = judge(dir)
    assert.equal(r.scheduledCount, 0, '注释行不该被算成一次 schedule 声明')
    assert.equal(r.oddShape.length, 0)
    assert.equal(r.verdict, 'OK')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('T11 缩进弹性：`on:` 之下用 4 个空格缩进（合法 YAML）也必须被识别为定时作业', () => {
  // 上一版锚点写死「恰好 2 个空格」，改成 4/6 空格缩进的合法文件会**静默返回 0**，
  // 于是判据报"没有待覆盖项 ⇒ 通过"——正是本刀要消灭的那类静默。
  const deep = y([
    'name: Deep Indent Gate',
    'on:',
    '    schedule:',
    "        - cron: '0 6 * * *'",
    'jobs:',
    '    a:',
    '        runs-on: ubuntu-latest',
    '        steps: []',
  ])
  const dir = fixture({ 'ci-failure-handler.yml': HANDLER([]), 'deep-indent.yml': deep })
  try {
    const r = judge(dir)
    assert.deepEqual(r.scheduledNames, ['Deep Indent Gate'], '缩进变化不得让作业从检测里消失')
    assert.equal(r.uncovered.length, 1)
    assert.equal(r.oddShape.length, 0, 'cron 在同一份 body 里，oddShape 自证应成立')
    assert.equal(r.verdict, 'FAIL')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('T12 反形夹具：有一行像 schedule: 但后面没有 cron 列表项 ⇒ 不算定时作业（合取条件生效）', () => {
  // 形状判据必须配一条反例：只看"有一行像 schedule:"会把文档/示例里的字样读成一次声明，
  // 于是名单判据会对一份**没有**定时器的文件要求覆盖（假阳），也会把 oddShape 一路点脏。
  const docOnly = y([
    'name: Doc Only Gate',
    'on:',
    '  workflow_dispatch:',
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: 说明',
    '        run: |',
    '          echo "配置样例如下"',
    '  schedule:',
    '    timeout-minutes: 5',
  ])
  const dir1 = fixture({ 'ci-failure-handler.yml': HANDLER(['Doc Only Gate']), 'doc-only.yml': docOnly })
  try {
    const r = judge(dir1)
    assert.deepEqual(r.scheduledNames, [], '合取条件被摘掉时这条必须红（见驱动 m9）')
    assert.equal(r.uncovered.length, 0, '文档里提一句 schedule: 不该凭空造出一条"必须被覆盖"的义务')
    assert.equal(r.stale.length, 0, '该文件确实存在 ⇒ 名单里那条不算陈旧')
    assert.equal(r.verdict, 'OK')
  } finally { fs.rmSync(dir1, { recursive: true, force: true }) }
  // 正向对偶：同一份文件补上紧邻的 cron 项，就必须被认成定时作业
  const withCron = docOnly.replace('  schedule:\n    timeout-minutes: 5', "  schedule:\n    - cron: '15 4 * * *'")
  const dir2 = fixture({ 'ci-failure-handler.yml': HANDLER([]), 'doc-only.yml': withCron })
  try {
    const r = judge(dir2)
    assert.deepEqual(r.scheduledNames, ['Doc Only Gate'], '补了 cron 项还不认，就是单向夹具')
    assert.equal(r.oddShape.length, 0)
  } finally { fs.rmSync(dir2, { recursive: true, force: true }) }
})

test('T10 只有陈旧名单项（无未覆盖）也必须判 FAIL —— 单向锁不算锁', () => {
  const dir = fixture({
    'ci-failure-handler.yml': HANDLER(['Cleanup Artifacts', 'Renamed Away Gate']),
    'cleanup-artifacts.yml': SCHED('Cleanup Artifacts'),
  })
  try {
    const r = judge(dir)
    assert.equal(r.uncovered.length, 0, '这条夹具刻意只留 stale 一个缺陷源')
    assert.deepEqual(r.stale, ['Renamed Away Gate'])
    assert.equal(r.verdict, 'FAIL', '名单里那条永远不会被触发，读起来却像"已覆盖"')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('T4 行尾免疫：同一份内容的 CRLF 与 LF 结论逐字相同', () => {
  const lf = { 'ci-failure-handler.yml': HANDLER(['Cleanup Artifacts']), 'cleanup-artifacts.yml': SCHED('Cleanup Artifacts') }
  const a = fixture(lf)
  const b = fixture(Object.fromEntries(Object.entries(lf).map(([k, v]) => [k, v.replace(/\n/g, '\r\n')])))
  try {
    assert.deepEqual(judge(b), judge(a), 'CRLF 夹具必须给出同一结论（本仓 workflows 是 i/lf w/crlf）')
  } finally {
    fs.rmSync(a, { recursive: true, force: true })
    fs.rmSync(b, { recursive: true, force: true })
  }
})

test('T5 扫描器失明一律判 SCANNER_FAULT，不得退化成"没有定时作业"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swd-empty-'))
  try {
    assert.equal(judge(dir).verdict, 'SCANNER_FAULT', '连 .github/workflows 都没有')
    const wd = path.join(dir, '.github', 'workflows')
    fs.mkdirSync(wd, { recursive: true })
    fs.writeFileSync(path.join(wd, 'README.txt'), 'not a workflow\n', 'utf8')
    assert.equal(judge(dir).verdict, 'SCANNER_FAULT', '目录存在但一个 yml 都没枚举到 ⇒ 同样是失明，不是"全绿"')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('T6 真仓规模下界与成员（解析退化成空集合时这条要红）', () => {
  const r = judge(REPO)
  const rows = loadWorkflows(REPO)
  assert.ok(rows.length >= 12, `真仓工作流数应 ≥ 12，实得 ${rows.length}`)
  assert.ok(r.scheduledCount >= 4, `带 schedule 的作业应 ≥ 4，实得 ${r.scheduledCount}`)
  assert.ok(r.scheduledNames.includes('Cleanup Artifacts'), 'Cleanup Artifacts 必须在 scheduled 集合里（本刀的立项现场）')
  assert.ok(r.listCount >= r.scheduledCount, '报警名单不得比待覆盖集合还短')
})

test('T7 真仓判定必须为 OK，且接线在位：判据自己被 PR 侧作业点名', () => {
  const r = judge(REPO)
  assert.equal(r.verdict, 'OK', `未覆盖=${JSON.stringify(r.uncovered)} 陈旧=${JSON.stringify(r.stale)} 形状可疑=${JSON.stringify(r.oddShape)}`)
  const strip = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  const qg = strip(fs.readFileSync(path.join(REPO, '.github', 'workflows', 'quality-gate.yml'), 'utf8'))
  assert.ok(qg.includes('node --test scripts/check-schedule-failure-watch.test.js'),
    '本锁不得只活在文档里：它要防的正是"没有任何东西在看"，自己却没人跑就是同型')
})

test('T8 handler 的两条既有守卫在位：只在 failure 时动手、无 PR 时不评论', () => {
  const raw = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci-failure-handler.yml'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(raw, /if:[\s]*\$\{\{\s*github\.event\.workflow_run\.conclusion == 'failure'\s*\}\}/,
    '少了这条 ⇒ 每次成功也建 Issue，通知面变成噪声源，最后没人看')
  assert.match(raw, /if:[\s]*steps\.parse-failure\.outputs\.PR_NUMBER != ''/,
    '定时作业没有关联 PR；缺这道守卫会在空 PR 号上跑评论步骤')
})

test('T9 变异驱动必须真被 git 追踪（记录里写"驱动已入仓"，就得有东西在数这件事）', () => {
  const { spawnSync } = require('node:child_process')
  const rel = 'scripts/check-schedule-failure-watch.mutation.js'
  const env = { ...process.env }
  // GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE / GIT_COMMON_DIR 会静默压过 cwd：钩子窗口里跑本锁时
  // 它们指向别的仓，于是锁量的根本不是本仓的追踪态（本仓实测踩过同款）。
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[k]
  const r = spawnSync('git', ['ls-files', '--', rel], { cwd: REPO, encoding: 'utf8', env })
  if (r.status !== 0) throw new Error(`git ls-files 取不到读数（rc=${r.status}），按未证实处理：${String(r.stderr || '').slice(0, 200)}`)
  assert.equal((r.stdout || '').trim(), rel,
    `${rel} 不在索引里：.gitignore 的 scripts/*.js 会静默吞掉新建脚本，"驱动已入仓"就成了假话`)
})
