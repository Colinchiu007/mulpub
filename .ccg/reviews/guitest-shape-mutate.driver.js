// 反证驱动：change gui-test-required-shape
// 用法：node .ccg/reviews/guitest-shape-mutate.driver.js [--only=N1,N3]
// 纪律：P1 未变异必须全绿；P2 期望锁名必须真实存在；P3 锚点命中数必须为 1；终态逐字节还原
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const WT = path.join(ROOT, 'apps', 'desktop')
const WF = path.join(ROOT, '.github', 'workflows', 'gui-test.yml')
const CR = path.join(ROOT, 'scripts', 'ci-gui-relevance.js')

const wfSrc = () => fs.readFileSync(WF, 'utf8')
const crSrc = () => fs.readFileSync(CR, 'utf8')

// 每条变异：目标文件 / 原文锚 / 替换 / 期望变红的锁名子串
const MUTATIONS = [
  { id: 'N1', file: WF, from: "if: github.event_name != 'pull_request' || needs.changes.outputs.gui-relevant == 'true'",
    to: "if: needs.changes.outputs.gui-relevant == 'true'",
    expect: 'gui-test 作业必须由 changes 判定作业门控' },
  { id: 'N2', file: WF, from: '    needs: [changes]\n', to: '',
    expect: 'gui-test 作业必须由 changes 判定作业门控' },
  { id: 'N3', file: WF, from: '  pull_request:\n    branches: [main]\n',
    to: "  pull_request:\n    branches: [main]\n    paths:\n      - 'apps/desktop/**'\n      - 'packages/**'\n      - 'package.json'\n      - 'pnpm-lock.yaml'\n      - '.github/workflows/gui-test.yml'\n",
    expect: 'GUI 工作流的 PR 触发不得再带 paths 白名单' },
  { id: 'N4', file: CR, from: "  'apps/desktop/**',\n", to: '',
    expect: 'GUI 相关性清单搬进判据脚本后内容不得缩水' },
  { id: 'N5', file: CR, from: '  return files.some((f) => typeof f === ', to: '  return true || files.some((f) => typeof f === ',
    expect: '相关性判定按行为而非字面串' },
  // N6 第一版写成 `false || files.some(...)`，那不是恒 false —— `||` 左侧为假时照旧求右侧，
  // 整行等价于原表达式，于是"MISSED"测的是变异本身没发生，而不是锁没牙（本轮实测 MISSED=1 的真相）。
  // 正解是整行替换成 `return false`，让"恒假"真的落到实现里。
  { id: 'N6', file: CR, from: "  return files.some((f) => typeof f === 'string' && GUI_PATHS.some((p) => matchesPattern(f, p)))",
    to: '  return false',
    expect: 'CLI 端到端：真 git 仓库里文档改动判否、桌面改动判是' },
  { id: 'N7', file: CR, from: "    process.stderr.write(`[ci-gui-relevance] ${e.message}\\n`)\n    process.exit(1)",
    to: "    if (process.env.GITHUB_OUTPUT) require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT, 'gui-relevant=false\\n', 'utf8')\n    process.exit(0)",
    expect: 'CLI 端到端：真 git 仓库里文档改动判否、桌面改动判是' },
  { id: 'N8', file: CR, from: "    fs.appendFileSync(process.env.GITHUB_OUTPUT, `gui-relevant=${relevant}\\n`, 'utf8')",
    to: '    // MUT N8: 不再写产出',
    expect: 'CLI 端到端：真 git 仓库里文档改动判否、桌面改动判是' },
  // 聚合作业三刀 + 空变更集留痕一刀（都是本轮按实测补的防线，必须各自有牙）
  { id: 'N9', file: WF, from: '    if: always()\n    timeout-minutes: 5',
    to: '    timeout-minutes: 5',
    expect: '必须有 GUI Gate Result 聚合作业' },
  { id: 'N10', file: WF, from: 'if [ "$CHANGES_RESULT" != "success" ]; then',
    to: 'if [ "$CHANGES_RESULT" = "definitely-never-matches" ]; then',
    expect: '必须有 GUI Gate Result 聚合作业' },
  { id: 'N11', file: WF, from: '          CHANGES_RESULT: ${{ needs.changes.result }}\n',
    to: '',
    expect: '必须有 GUI Gate Result 聚合作业' },
  { id: 'N12', file: CR, from: '    lines.unshift(\'NOTE: EMPTY_CHANGESET',
    to: '    if (false) lines.unshift(\'NOTE: EMPTY_CHANGESET',
    expect: 'CLI 端到端：真 git 仓库里文档改动判否、桌面改动判是' },
  { id: 'N13', file: WF, from: "      - 'package.json'\n", to: '',
    expect: 'push.paths 与 GUI_PATHS 是同一份清单' },
]

const backups = new Map()
const originals = new Map([[WF, wfSrc()], [CR, crSrc()]])

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') }

function runTests() {
  let out = ''
  let rc = 0
  try {
    out = execFileSync('pnpm', ['exec', 'vitest', 'run', 'tests/gui-ci-exit-contract.test.js'],
      { cwd: WT, encoding: 'utf8', maxBuffer: 1 << 26, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) { out = String((e.stdout || '') + (e.stderr || '')); rc = e.status || 1 }
  const t = stripAnsi(out).split(/\r?\n/)
  const failed = t.filter(l => /^\s*[×x]\s/.test(l)).map(l => l.replace(/^\s*[×x]\s*/, '').replace(/\s+\d+m?s$/, ''))
  const passed = (t.find(l => /Tests\s+\d+ passed/.test(l)) || '').trim()
  const zeroRun = !/Tests\s+\d+/.test(stripAnsi(out))
  return { rc, failed, summary: passed, zeroRun, raw: out }
}

// 锚点必须按**目标文件的真实行尾**拼：本仓工作副本里 gui-test.yml 是 `i/lf w/crlf`（实测 CRLF=207/207），
// 而我写的 ci-gui-relevance.js 是 LF。直接用 '\n' 拼多行锚点会在 CRLF 文件上 0 命中，
// 于是"变异没红"其实是"变异没发生"。本轮第一跑就被 P3 预检当场抓住 2 条（N2/N3）。
function eolOf(text) {
  const crlf = (text.match(/\r\n/g) || []).length
  const lf = (text.match(/\n/g) || []).length
  if (crlf === 0) return '\n'
  if (crlf === lf) return '\r\n'
  throw new Error(`目标文件是混行尾（CRLF=${crlf} LF_only=${lf - crlf}），禁止统一回写；变异表必须逐锚点显式给行尾`)
}

function adapt(text, s) {
  return s.split('\n').join(eolOf(text))
}

function apply(mut) {
  const cur = fs.readFileSync(mut.file, 'utf8')
  const from = adapt(cur, mut.from)
  const to = adapt(cur, mut.to)
  const n = cur.split(from).length - 1
  if (n !== 1) return { ok: false, why: `ANCHOR_HITS=${n} (期望 1)` }
  fs.writeFileSync(mut.file, cur.replace(from, to), 'utf8')
  return { ok: true }
}

function restoreAll() {
  for (const [f, s] of originals) fs.writeFileSync(f, s, 'utf8')
}

// ---- P1/P2/P3 预检 ----
const TESTFILE = path.join(ROOT, 'apps', 'desktop', 'tests', 'gui-ci-exit-contract.test.js')
const testSrc = fs.readFileSync(TESTFILE, 'utf8')
let preflightBad = 0
const base = runTests()
if (base.zeroRun) { console.log('P1 FAIL: vitest 一条都没跑（读不到结果，不得判绿）'); process.exit(9) }
if (base.failed.length !== 0) {
  console.log('P1 FAIL: 未变异基线就红 ' + base.failed.length + ' 条：\n  ' + base.failed.join('\n  '))
  preflightBad++
}
for (const m of MUTATIONS) {
  // P3：锚点必须恰好出现一次（0 次=改名/搬家/行尾不符，>1 次=replace 会打错位置）
  const src = originals.get(m.file)
  const hits = src.split(adapt(src, m.from)).length - 1
  if (hits !== 1) { console.log(`P3 FAIL ${m.id}: 锚点命中 ${hits} 次（期望 1）on ${path.basename(m.file)}`); preflightBad++ }
  // P2：期望锁名必须真的写在测试文件里（否则"它没红"永远无法被证明）
  if (!testSrc.includes(m.expect)) { console.log(`P2 FAIL ${m.id}: 期望锁名不存在于测试文件：${m.expect}`); preflightBad++ }
}
console.log('PREFLIGHT_BAD=' + preflightBad)
if (preflightBad > 0) { restoreAll(); process.exit(8) }

let missed = 0, wrongCause = 0
for (const m of MUTATIONS) {
  const a = apply(m)
  if (!a.ok) { console.log(`${m.id} SKIP ${a.why}`); missed++; continue }
  const r = runTests()
  const hitExpect = r.failed.some(f => f.includes(m.expect))
  if (!hitExpect) {
    if (r.failed.length === 0) { console.log(`${m.id} MISSED（拆了仍全绿）`); missed++ }
    else { console.log(`${m.id} WRONG_CAUSE 期望="${m.expect}" 实际红=${r.failed.length}: ${r.failed.slice(0, 2).join(' | ')}`); wrongCause++ }
  } else {
    console.log(`${m.id} CAUGHT (${r.failed.length} 红) 由「${m.expect}」抓住`)
  }
  restoreAll()
}
restoreAll()

let restored = true
for (const [f, s] of originals) if (fs.readFileSync(f, 'utf8') !== s) restored = false
console.log(`MUTATIONS=${MUTATIONS.length} MISSED=${missed} WRONG_CAUSE=${wrongCause} RESTORED_BYTES_EQUAL=${restored}`)
process.exit(missed + wrongCause === 0 && restored ? 0 : 7)
