'use strict'
/**
 * scripts/check-gate4-selection.test.js —— Gate 4「desktop 是否真的被挡在 nx 选择集之外」的回归锁
 *
 * 钉的是**语义**而不是文本形状。`pnpm run test:all -- --exclude=@multi-publish/desktop` 里那个
 * 独立的 `--` 会被 pnpm 原样附加到脚本命令上，于是 nx 把它**之后**的一切都当成「转发给每个任务
 * 命令的参数」，自己根本没吃到 exclude。CI 现场（run 38117456528，2026-10-11）：
 *
 *     NX   Running target test for 13 projects:       ← 13 个，含 @multi-publish/desktop
 *     $ vitest run "--exclude=@multi-publish/desktop"  ← 旗标落到了叶子命令上
 *
 * 后果是 Gate 4 串行跑 desktop 全量，30 分钟预算正好卡在临界点：成功 run 实测 1173s / 1322s，
 * 失败 run 恰好 1801s = WaitForExit(1800000) 到点 ⇒ 一条 required check 的成败取决于 runner 快慢。
 *
 * 逃逸链里最要命的一环（PRD §4）：`.github/scripts/workflow-contract.test.js:202-203` 用正则
 * **逐字钉住了带 `"--"` 的错误 argv**，把缺陷形态说成"受保护形态"。它只匹配文本形状，
 * 从不问 nx 到底收到什么 —— 所以本锁的判据一律由「nx 自己打印的选择声明」推导。
 *
 * 夹具纪律：本文件**不**真起 nx（live 证据以文本注入）。真起 nx 的两条 A/B 臂由 CLI 入口
 * `node scripts/check-gate4-selection.js` 在 CI 上执行；T14/T15 直接读**仓里那两份真实文件**，
 * 证明本锁测量的域就是 CI 会执行的那份 workflow + package.json，而不是手搓夹具。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  DESKTOP_PROJECT,
  EXCLUDE_FLAG,
  MIN_OTHERS,
  parseGate4TestArgs,
  effectiveCommand,
  classifyExcludePlacement,
  parseDeclaredProjects,
  planCommands,
  judge,
} = require('./check-gate4-selection.js')

const ROOT = path.resolve(__dirname, '..')
const WORKFLOW = path.join(ROOT, '.github/workflows/quality-gate.yml')
const PKG = path.join(ROOT, 'package.json')

// --- 夹具：与仓里同形的两种形态 ------------------------------------------------
// FIXED = 本次修复后的形态；BROKEN = origin/main 上真实存在过、且被 workflow-contract
// 钉成"受保护形态"的那一版。两者都必须是**可判定的输入**，否则锁只测了自己想象的坏值。

// 夹具必须带 Gate 4 的步骤头：本锁按**步骤正文**扫描 `$testArgs`，锚不到步骤头就是
// 「判定域失联」而不是「没找到」。少这一行的话所有结构层夹具都会在同一条红上通过。
const STEP = '      - name: "Gate 4 - Workspace unit tests"\n        shell: pwsh\n'

const WF_FIXED = STEP + [
  '          if ($env:TEST_MODE -eq "affected") {',
  '            $testArgs = @("run", "test:affected:no-desktop")',
  '          } else {',
  '            $testArgs = @("run", "test:all:no-desktop")',
  '          }',
].join('\n')

const WF_BROKEN = STEP + [
  '            $testArgs = @("run", "test:affected", "--", "--exclude=@multi-publish/desktop")',
  '            $testArgs = @("run", "test:all", "--", "--exclude=@multi-publish/desktop")',
].join('\n')

const PKG_FIXED = {
  'test:all:no-desktop': 'nx run-many -t test --all --parallel=1 --exclude=@multi-publish/desktop',
  'test:affected:no-desktop': 'nx affected -t test --base=origin/main --parallel=1 --exclude=@multi-publish/desktop',
}
// 历史那份 package.json：脚本本身不带 exclude，全靠 workflow 转发（转发即断链）
const PKG_LEGACY = {
  'test:all': 'nx run-many -t test --all --parallel=1',
  'test:affected': 'nx affected -t test --base=origin/main --parallel=1',
}

const OTHERS = [
  '@multi-publish/ai-autonomous-tester',
  '@multi-publish/api-publish-engine',
  '@multi-publish/story2video-engine',
  '@multi-publish/video-clone-engine',
  '@multi-publish/collection-engine',
  'openmontage-remotion-composer',
  '@multi-publish/rewrite-engine',
  '@multi-publish/ai-writer-api',
  '@multi-publish/shared-utils',
  '@multi-publish/rpa-engine',
  '@multi-publish/ai-writer',
  '@multi-publish/ui',
]

function declaration (projects) {
  return [
    ' NX   Running target test for ' + projects.length + ' projects:',
    '',
  ].concat(projects.map((p) => '- ' + p)).concat(['', '']).join('\n')
}

const DECL_EXCLUDED = declaration(OTHERS)
const DECL_WITH_DESKTOP = declaration(OTHERS.concat([DESKTOP_PROJECT]))

/**
 * A/B 证据表：key 必须是**实际执行的那条命令**（runLine / baseRunLine），不是脚本正文。
 * 这一点本身就在被测：T20 锁住 runLine 走的是 pnpm 调用形态 —— 把脚本正文直接 spawn 时
 * `nx` 不在 PATH 上（只有 pnpm 会注入 node_modules/.bin），本脚本第一次实跑就 rc=1 撞在这。
 */
function liveOk (entries) {
  const map = {}
  for (const e of entries) {
    const nxLevel = e.commandLine.includes(EXCLUDE_FLAG) && e.commandLine.split(/\s+/).indexOf('--') === -1
    map[e.runLine] = nxLevel ? DECL_EXCLUDED : DECL_WITH_DESKTOP
    if (e.baseRunLine) map[e.baseRunLine] = DECL_WITH_DESKTOP
  }
  return map
}

/** 取那条**必须**有 live 证据的臂（full：选择集恒等于「全部带 test 目标的包」，A/B 才可信） */
function requiredEntry (entries) {
  const list = entries.filter((e) => e.liveRequired)
  assert.equal(list.length, 1, 'liveRequired 必须恰好成立一次（full 侧），实际 ' + list.length)
  return list[0]
}

function plan (workflowText, pkgScripts) {
  return planCommands(workflowText, pkgScripts)
}

// --- 结构层 --------------------------------------------------------------------

test('T1 合规形态必须判绿（存在性锁不得把自己的修复路径焊死）', () => {
  const p = plan(WF_FIXED, PKG_FIXED)
  const r = judge({ workflowText: WF_FIXED, pkgScripts: PKG_FIXED, live: null })
  assert.equal(p.problems.length, 0, '合规形态在 plan 层就被判红')
  assert.equal(r.ok, true, '合规形态被判红：' + r.problems.join(' / '))
  assert.deepEqual(r.problems, [])
})

test('T2 历史形态（exclude 排在独立 -- 之后）必须判红，并点名 nx 的转发语义', () => {
  const r = judge({ workflowText: WF_BROKEN, pkgScripts: PKG_LEGACY, live: null })
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /转发/)
  assert.match(r.problems.join('\n'), /@multi-publish\/desktop/)
})

test('T3 完全不带 exclude 时必须判红', () => {
  const pkg = {
    'test:all:no-desktop': 'nx run-many -t test --all --parallel=1',
    'test:affected:no-desktop': 'nx affected -t test --base=origin/main --parallel=1',
  }
  const r = judge({ workflowText: WF_FIXED, pkgScripts: pkg, live: null })
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /没有.*传给 nx|缺少/)
})

test('T4 把同一个 bug 写进 package.json 脚本（exclude 落在脚本自身的 -- 之后）也必须判红', () => {
  const pkg = {
    'test:all:no-desktop': 'nx run-many -t test --all --parallel=1 -- --exclude=@multi-publish/desktop',
    'test:affected:no-desktop': 'nx affected -t test --base=origin/main --parallel=1 -- --exclude=@multi-publish/desktop',
  }
  const r = judge({ workflowText: WF_FIXED, pkgScripts: pkg, live: null })
  assert.equal(r.ok, false, '脚本内部 -- 之后的 exclude 被放过了')
})

test('T5 引用的脚本不在 package.json 里必须 fail closed，不得静默跳过', () => {
  const r = judge({ workflowText: WF_FIXED, pkgScripts: {}, live: null })
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /package\.json/)
})

test('T6 workflow 里取不到 $testArgs 字面量必须判红（锚点失效不得当成通过）', () => {
  const r = judge({ workflowText: STEP + '          $gate4Args = @("run", "test:all:no-desktop")\n', pkgScripts: PKG_FIXED, live: null })
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /\$testArgs/)
})

test('T6b Gate 4 步骤头本身被改名/删除时必须判红，不得当成"没有该步骤所以没问题"', () => {
  const r = judge({ workflowText: WF_FIXED.replace('Gate 4 - Workspace unit tests', 'Gate 9 - Renamed'), pkgScripts: PKG_FIXED, live: null })
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /步骤头/)
})

test('T7 单引号形态的独立 -- 分隔符同样必须被抓到', () => {
  assert.equal(classifyExcludePlacement('nx run-many -t test --all --parallel=1 -- --exclude=@multi-publish/desktop').placement, 'task')
  const wf = STEP + '            $testArgs = @("run", "test:all", \'--\', "--exclude=@multi-publish/desktop")\n'
  const r = judge({ workflowText: wf, pkgScripts: PKG_LEGACY, live: null })
  assert.equal(r.ok, false)
})

test('T8 pnpm 裸转发（不带 --）是合规形态：exclude 必须判为 nx 侧', () => {
  // 本机 2026-10-11 实测：`pnpm run test:all --exclude=@multi-publish/desktop` ⇒ nx 声明 12 个项目、
  // desktop 不在其中；加上 `--` 即变 13 个含 desktop。这条锁住的是「别把 `"--"` 当引号习惯抄回来」。
  const cls = classifyExcludePlacement('nx run-many -t test --all --parallel=1 --exclude=@multi-publish/desktop')
  assert.equal(cls.placement, 'nx')
  const wf = STEP + [
    '            $testArgs = @("run", "test:affected", "--exclude=@multi-publish/desktop")',
    '            $testArgs = @("run", "test:all", "--exclude=@multi-publish/desktop")',
  ].join('\n')
  const r = judge({ workflowText: wf, pkgScripts: PKG_LEGACY, live: null })
  assert.equal(r.ok, true, '裸转发形态被判红：' + r.problems.join(' / '))
})

test('T9 两个模式都必须判，漏一个不算（affected 分支同样是断链现场）', () => {
  const wf = STEP + '            $testArgs = @("run", "test:all:no-desktop")\n'
  const r = judge({ workflowText: wf, pkgScripts: PKG_FIXED, live: null })
  assert.equal(r.ok, false, '只有一条 $testArgs（affected 分支丢了）却被判绿')
})

// --- live 层：A/B 两臂都必须读 --------------------------------------------------

test('T10 A/B 齐备且方向正确时必须判绿', () => {
  const entries = plan(WF_FIXED, PKG_FIXED).entries
  const r = judge({ workflowText: WF_FIXED, pkgScripts: PKG_FIXED, live: liveOk(entries) })
  assert.equal(r.ok, true, '合规形态 + 正确 A/B 被判红：' + r.problems.join(' / '))
})

test('T11 live 证据里带 exclude 的那次仍含 desktop ⇒ 判红', () => {
  const entries = plan(WF_FIXED, PKG_FIXED).entries
  const e = requiredEntry(entries)
  const map = {}
  map[e.runLine] = DECL_WITH_DESKTOP
  map[e.baseRunLine] = DECL_WITH_DESKTOP
  const r = judge({ workflowText: WF_FIXED, pkgScripts: PKG_FIXED, live: map })
  assert.equal(r.ok, false)
})

test('T12 负控不成立（不带 exclude 也报"没有 desktop"）必须判红而不是判绿', () => {
  // 探针看不见自己声称要测的东西时，任何"未命中"结论都不成立。
  const entries = plan(WF_FIXED, PKG_FIXED).entries
  const e = requiredEntry(entries)
  const map = {}
  map[e.runLine] = DECL_EXCLUDED
  map[e.baseRunLine] = DECL_EXCLUDED
  const r = judge({ workflowText: WF_FIXED, pkgScripts: PKG_FIXED, live: map })
  assert.equal(r.ok, false, '负控失明却报了结论')
  assert.match(r.problems.join('\n'), /负控|失明|探针/)
})

test('T13 声明头计数与清单条数不一致必须判红（防截断/防解析退化）', () => {
  const truncated = DECL_EXCLUDED.replace('for 12 projects', 'for 40 projects')
  const parsed = parseDeclaredProjects(truncated)
  assert.equal(parsed.countMismatch, true)
  assert.deepEqual(parsed.projects, OTHERS)
  const entries = plan(WF_FIXED, PKG_FIXED).entries
  const e = requiredEntry(entries)
  const map = {}
  map[e.runLine] = truncated
  map[e.baseRunLine] = DECL_WITH_DESKTOP
  const r = judge({ workflowText: WF_FIXED, pkgScripts: PKG_FIXED, live: map })
  assert.equal(r.ok, false)
})

test('T14 live 臂取不到选择声明（命令跑了但输出形态变了）必须判红', () => {
  const entries = plan(WF_FIXED, PKG_FIXED).entries
  const e = requiredEntry(entries)
  const map = {}
  map[e.runLine] = ' NX   Cannot find configuration for task test\n'
  map[e.baseRunLine] = DECL_WITH_DESKTOP
  const r = judge({ workflowText: WF_FIXED, pkgScripts: PKG_FIXED, live: map })
  assert.equal(r.ok, false)
})

test('T15 必须有的那条 live 证据缺席必须判红（不得只判有证据的那半）', () => {
  const entries = plan(WF_FIXED, PKG_FIXED).entries
  const e = requiredEntry(entries)
  const map = liveOk(entries)
  delete map[e.baseRunLine]
  const r = judge({ workflowText: WF_FIXED, pkgScripts: PKG_FIXED, live: map })
  assert.equal(r.ok, false, 'A/B 少了一臂却被判绿')
  assert.match(r.problems.join('\n'), /证据|未采集|缺/)
})

test('T18 affected 侧不强制 live 是**有理由的例外**，不得被当成"整条臂可省"', () => {
  // 理由（PRD §5.3）：`nx affected` 的选择集等于「本 PR 影响的包」，在干净工作区上是空集，
  // nx 不打印选择声明 ⇒ A/B 的负控臂无法确定成立。所以 affected 侧只由结构层守
  // 「同一个旗标确实作为 nx 参数传出」，A/B 机制证据由 full 侧一次性守住。
  // 这条锁本身防的是：有人把 liveRequired 全改成 false，让 A/B 臂整条静默消失。
  const entries = plan(WF_FIXED, PKG_FIXED).entries
  assert.deepEqual(entries.map((e) => e.mode).sort(), ['affected', 'full'])
  assert.equal(entries.find((e) => e.mode === 'affected').liveRequired, false)
  assert.equal(entries.find((e) => e.mode === 'full').liveRequired, true)
  // 且 full 侧的 live 证据必须是**两条**（A/B），少一条即红 —— 见 T15
})

test('T20 live 臂执行的是 pnpm 调用形态，而不是把脚本正文直接 spawn', () => {
  // Node>=18.20 直接 spawn .cmd 会 EINVAL；更关键的是 `nx` 只在 pnpm 注入 node_modules/.bin
  // 之后才在 PATH 上 —— 本脚本第一次实跑就是把脚本正文交给 cmd.exe，三条臂全部 rc=1、
  // 然后判「取不到声明」。判据本身没错（缺证据不判绿），但执行形态必须与 CI 一致。
  const entries = plan(WF_FIXED, PKG_FIXED).entries
  for (const e of entries) {
    assert.match(e.runLine, /^pnpm(?:\.cmd)? run /, e.mode + ' 侧 runLine 不是 pnpm 调用：' + e.runLine)
    assert.match(e.runLine, new RegExp('test:(all|affected):no-desktop$'), 'runLine 没带上被引用的脚本名：' + e.runLine)
    assert.ok(e.baseRunLine == null || /^pnpm(?:\.cmd)? exec nx /.test(e.baseRunLine), 'baseRunLine 必须经 pnpm exec 跑 nx：' + e.baseRunLine)
  }
  // A/B 两条命令的差别**只能**是那个旗标本身，否则负控测的不是同一个变量（见 T21）
})

test('T21 baseRunLine 与 runLine 只相差 exclude 旗标（负控不得偷换被测变量）', () => {
  const entries = plan(WF_FIXED, PKG_FIXED).entries
  const full = entries.find((e) => e.mode === 'full')
  assert.ok(full.baseRunLine.includes(EXCLUDE_FLAG) === false, 'B 臂应当不含 exclude：' + full.baseRunLine)
  assert.ok(full.commandLine.includes(EXCLUDE_FLAG), 'A 臂的内层命令必须含 exclude')
  // 去掉旗标后，A 的内层命令与 B 的内层命令必须逐字相同
  assert.equal(full.baseCommandLine, full.commandLine.replace(' ' + EXCLUDE_FLAG, ''))
})

// --- 真实文件臂：证明测量域是 CI 会执行的那两份 --------------------------------
test('T16 真实 workflow + package.json：两个模式的 exclude 都必须落在 nx 一侧', () => {
  const workflowText = fs.readFileSync(WORKFLOW, 'utf8')
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8')).scripts
  const p = plan(workflowText, pkg)
  assert.equal(p.problems.length, 0, '真实仓文件在 plan 层就红：' + p.problems.join(' / '))
  assert.equal(p.entries.length, 2, '必须同时覆盖 affected 与 full 两个模式')
  for (const e of p.entries) {
    assert.equal(classifyExcludePlacement(e.commandLine).placement, 'nx', e.mode + ' 侧 exclude 未落到 nx：' + e.commandLine)
  }
})

test('T17 真实文件的 $testArgs 字面量必须逐字解析出脚本名（防锚点漂成空集）', () => {
  const workflowText = fs.readFileSync(WORKFLOW, 'utf8')
  const args = parseGate4TestArgs(workflowText)
  assert.ok(args.full.length >= 2, 'full 侧 $testArgs 解析为空')
  assert.ok(args.affected.length >= 2, 'affected 侧 $testArgs 解析为空')
  assert.equal(args.full[0], 'run')
  assert.equal(args.affected[0], 'run')
  // 命中数规模下界：解析退化（nx 步骤被改名、变量被改）时这两条必须红
  assert.equal(args.full.includes('--'), false, 'full 侧仍带着把 exclude 推进转发区的 "--"')
  assert.equal(args.affected.includes('--'), false, 'affected 侧仍带着 "--"')
})
