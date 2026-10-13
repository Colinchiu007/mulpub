'use strict'
/*
 * scripts/check-step-failfast.js 与 Gate 9 verdict 令牌的变异反证驱动器（change: gate3-failfast）。
 *
 * 为什么要跑它：这两处都是"防再犯锁"。按 AGENTS.md QM-2/QM-5 的纪律，只证"业务改动会变红"
 * 不足以证明锁在跑——必须把**判据本身**改成被它禁止的那个形态，看它是否立刻变红。
 * 14 条变异各自点名一条期望变红的锁；任一条没红，就说明那条锁是装饰性的。
 *
 * 用法（路径全部由 __dirname 推导，不写机器绝对路径，也不要求特定 cwd）：
 *   node .ccg/reviews/gate3failfast-mutate.driver.js            # 跑全部 14 条
 *   node .ccg/reviews/gate3failfast-mutate.driver.js --only=M4  # 只跑一条
 *
 * 三条前置自检（缺了它们，"全部 CAUGHT"可能只是"套件本来就红"）：
 *   P1 未改动状态下三组测试全绿；
 *   P2 每条变异期望变红的那把锁，其名字必须真实存在于对应测试文件里（写错名字＝永不命中）；
 *   P3 每条变异的锚点必须恰好命中 1 次（否则 ABORTED）。
 * 收尾：每条跑完按备份逐字节还原；最后整体再复核一次，任何文件没还原成原样都以非零码退出。
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const KEY_FILE = {
  checker: path.join(ROOT, 'scripts', 'check-step-failfast.js'),
  gate: path.join(ROOT, '.github', 'scripts', 'agent-review-gate.js'),
  workflow: path.join(ROOT, '.github', 'workflows', 'quality-gate.yml'),
}
const KEY_TEST = {
  checker: path.join(ROOT, 'scripts', 'check-step-failfast.test.js'),
  gate: path.join(ROOT, '.github', 'scripts', 'agent-review-gate.test.js'),
  workflow: path.join(ROOT, '.github', 'scripts', 'workflow-contract.test.js'),
}
const AXIS_FILES = {
  checker: ['scripts/check-step-failfast.test.js'],
  gate: ['.github/scripts/agent-review-gate.test.js'],
  workflow: ['.github/scripts/workflow-contract.test.js'],
}

const BACKUP = {}
for (const k of Object.keys(KEY_FILE)) BACKUP[k] = fs.readFileSync(KEY_FILE[k], 'utf8')

function inject (key, fromArr, toArr) {
  const text = BACKUP[key]
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const J = (arr) => arr.join('\n').split('\n').join(eol)
  const from = J(fromArr)
  const to = J(toArr)
  const n = text.split(from).length - 1
  if (n !== 1) {
    throw new Error('ANCHOR_NOT_UNIQUE(' + n + ') in ' + path.basename(KEY_FILE[key]) + ' :: ' + fromArr[0].trim().slice(0, 70))
  }
  fs.writeFileSync(KEY_FILE[key], text.split(from).join(to))
}

function restore () {
  for (const k of Object.keys(KEY_FILE)) fs.writeFileSync(KEY_FILE[k], BACKUP[k])
}

function runTests (axis) {
  const r = spawnSync(process.execPath, ['--test', ...AXIS_FILES[axis]], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '')
  const tests = Number((out.match(/^ℹ tests (\d+)$/m) || [])[1])
  const fail = Number((out.match(/^ℹ fail (\d+)$/m) || [])[1])
  if (!Number.isFinite(tests) || tests === 0) {
    throw new Error('测试解析退化（没跑或摘要格式变了），本次判定不可用：' + JSON.stringify(out.slice(-300)))
  }
  const names = [...new Set([...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]))].filter((n) => n !== 'failing tests:')
  return { tests, fail, names }
}

const B = String.fromCharCode(92)
const Q = String.fromCharCode(39)
const sq = (s) => s.split('"').join(Q)

const MUTS = []
MUTS.push({
  id: 'M1', axis: 'checker', key: 'checker',
  target: '退回「整块正文出现过退出码检查就算合规」（原缺陷本体）',
  expectRed: '只在最后一条命令后面写一条守卫',
  from: ['      const uncovered = /^bash$/.test(shell) ? [] : managed.filter((m) => {'],
  to: ['      const blockHasGuard = body.some((l) => NEXT_GUARD.test(l))',
    '      const uncovered = (/^bash$/.test(shell) || blockHasGuard) ? [] : managed.filter((m) => {'],
})
MUTS.push({
  id: 'M2', axis: 'checker', key: 'checker',
  target: '守卫窗口从紧邻 1 行放宽到 3 行（给第 N 条写的守卫会顺手盖住第 N-1 条）',
  expectRed: '只在最后一条命令后面写一条守卫',
  from: ['        const next = body[m.at + 1]', sq('        return !(typeof next === "string" && NEXT_GUARD.test(next))')],
  to: ['        const window = body.slice(m.at + 1, m.at + 4)', '        return !window.some((w) => NEXT_GUARD.test(w))'],
})
MUTS.push({
  id: 'M3', axis: 'checker', key: 'checker',
  target: '受管集合退回「只数测试文件」（门禁脚本不计数）',
  expectRed: '门禁脚本（node 跑一个 .js，非 --test）计入受管集合',
  from: ['        if (TEST_INVOCATION.test(text) || GATE_INVOCATION.test(text)) managed.push({ text, at })'],
  to: ['        if (TEST_INVOCATION.test(text)) managed.push({ text, at })'],
})
MUTS.push({
  id: 'M4', axis: 'checker', key: 'checker',
  target: '不解析 job 级 defaults: run: shell（只看步骤自己）',
  expectRed: 'job 级 defaults: run: shell: bash 视为 fail-fast',
  from: ["      if (shell === '(默认)') shell = jobShells.get(jobKeyHere) || '(默认)'"],
  to: ['      // 第二级回落（作业级 defaults）被摘除 —— 三级回落后 M4 只能摘这一级，N11 摘第三级'],
})
MUTS.push({
  id: 'M5', axis: 'checker', key: 'checker',
  target: '把空值 shell: 读成 bash（方向相反的归因）',
  expectRed: '空值 shell:（gui-test.yml 形状）不得被当成 bash',
  from: [sq('        if (s) { map.set(job, s[1] === "" ? "(空值)" : s[1]); break }')],
  to: [sq('        if (s) { map.set(job, s[1] === "" ? "bash" : s[1]); break }')],
})
MUTS.push({
  id: 'M6', axis: 'checker', key: 'checker',
  target: '把 || echo / || true 也当守卫（吞失败形状得以过棘轮）',
  expectRed: '同行 || exit 算守住；|| echo / || true 是把失败吃掉',
  from: ['const SAME_LINE_GUARD = /&&|' + B + '$LASTEXITCODE|' + B + '|' + B + '|' + B + 's*exit' + B + 'b/'],
  to: ['const SAME_LINE_GUARD = /&&|' + B + '$LASTEXITCODE|' + B + '|' + B + '|/'],
})
MUTS.push({
  id: 'M7', axis: 'checker', key: 'checker',
  target: 'collectCheck 退化成恒空集（解析失败被读成全部合规）',
  expectRed: '真实仓库',
  from: ['  return { stepsScanned, violations }'],
  to: ['  return { stepsScanned: 0, violations: [] }'],
})
MUTS.push({
  id: 'N1', axis: 'gate', key: 'gate',
  target: '令牌判据改成恒空（「审计没发生」再不可见，门禁照绿）',
  expectRed: '自主审计为每种「审计没有真正发生」的状态产出对应 verdict 令牌',
  from: ['  return VERDICT_NOTE_BY_STATUS[status] || "";'],
  to: ['  return "";'],
})
MUTS.push({
  id: 'N2', axis: 'gate', key: 'gate',
  target: '摘掉包装层（调用方拿到不带 verdictNote 的原始结果）',
  expectRed: '自主审计为每种「审计没有真正发生」的状态产出对应 verdict 令牌',
  // 变异刻意保持模块可加载：改名会让整个测试文件 require 期崩，node:test 只报 1 条文件级失败，
  // 那既不是"锁抓住了"也不是"锁没抓住"，而是**根本没跑到锁**（第 1 轮 N2 就是这样被误判成 MISSED）。
  from: ['  const result = evaluateAutonomousGateDecision(params);',
    '  return { ...result, verdictNote: verdictNoteFor(result.status) };'],
  to: ['  const result = evaluateAutonomousGateDecision(params);',
    '  return result;'],
})
MUTS.push({
  id: 'N3', axis: 'gate', key: 'gate',
  target: '算了令牌但不落盘（workflow 读不到任何东西）',
  expectRed: '自主审计 CLI 的 --note-file 把令牌落盘',
  from: ['  if (args["note-file"]) {'],
  to: ['  if (false && args["note-file"]) {'],
})
MUTS.push({
  id: 'N4', axis: 'gate', key: 'gate',
  target: '仅成功路径才写令牌文件（最需要留痕的阻塞路径反而没有）',
  expectRed: '自主审计 CLI 的 --note-file 把令牌落盘',
  from: ['  if (args["note-file"]) {'],
  to: ['  if (args["note-file"] && result.exitCode === 0) {'],
})
MUTS.push({
  id: 'N5', axis: 'gate', key: 'gate',
  target: '从映射表删掉 MISSING_REPORT（「根本没报告」退化成空令牌）',
  expectRed: '自主审计为每种「审计没有真正发生」的状态产出对应 verdict 令牌',
  from: ['  MISSING_REPORT: "NO_REPORT",'],
  to: ['  MISSING_REPORT_REMOVED: "NO_REPORT",'],
})
MUTS.push({
  id: 'N6', axis: 'workflow', key: 'workflow',
  target: 'workflow 删掉 --note-file 参数（Test-Path 恒走 else 分支）',
  expectRed: '自主覆盖审计仅在确认是无模型 NEED_HUMAN 报告时降级为告警',
  from: ['            "--has-openai-key=$([bool]$env:OPENAI_API_KEY)",', '            "--note-file=gate9-verdict-note.txt"'],
  to: ['            "--has-openai-key=$([bool]$env:OPENAI_API_KEY)"'],
})
MUTS.push({
  id: 'N7', axis: 'workflow', key: 'workflow',
  target: '把禁令明文禁止的那个形态本身写回 Gate 9（内联枚举报告文件 + 就地解析 JSON）',
  expectRed: '自主覆盖审计仅在确认是无模型 NEED_HUMAN 报告时降级为告警',
  from: ['          $gateArgs = @('],
  to: ['          $legacyProbe = Get-ChildItem "apps/desktop/tests/visual-testing/reports" | Select-Object -First 1',
    '          $legacyRep = Get-Content $legacyProbe.FullName -Raw | ConvertFrom-Json',
    '          $gateArgs = @('],
})
MUTS.push({
  id: 'N8', axis: 'workflow', key: 'workflow',
  target: '把 autonomous 作业的 outputs.verdict-note 声明整块删掉（复现 #3439 留下的断链形态）',
  expectRed: 'verdict 令牌的跨 job 通路必须真的接上',
  from: ['    outputs:',
    '      verdict-note: ${{ steps.autonomous-gate.outputs.verdict_note }}'],
  to: ['    # outputs 被删'],
})
MUTS.push({
  id: 'N9', axis: 'workflow', key: 'workflow',
  target: '只写 GITHUB_ENV、不写 GITHUB_OUTPUT（作业 output 取不到 env，这正是通路原本断掉的机制）',
  expectRed: 'verdict 令牌的跨 job 通路必须真的接上',
  from: ['            echo "verdict_note=$verdictNoteOut" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append'],
  to: ['            # GITHUB_OUTPUT 不写'],
})
MUTS.push({
  id: 'N10', axis: 'workflow', key: 'workflow',
  target: '把消费点换成另一个名字（声明与消费漂移时，两侧各自的断言都可能仍各自成立）',
  expectRed: 'verdict 令牌的跨 job 通路必须真的接上',
  from: ['          AUTONOMOUS_VERDICT_NOTE: ${{ needs.autonomous.outputs.verdict-note }}'],
  to: ['          AUTONOMOUS_VERDICT_NOTE: ${{ needs.autonomous.outputs.verdict-note-typo }}'],
})
// ── C. 第 3 轮：CI 实测打穿的两处运行期缺陷（PR #3477 首轮 QG Autonomous / QG Business API Postgres 双红）
MUTS.push({
  id: 'N11', axis: 'checker', key: 'checker',
  target: '摘掉"未声明 shell 时按 runs-on 推导默认档"那一级（把 bash 当 pwsh = 往真 bash 步骤塞 PowerShell）',
  expectRed: 'runs-on: ubuntu-latest 且未声明 shell',
  from: ["      if (shell === '(默认)') shell = defaultShellForRunsOn(jobRunsOns.get(jobKeyHere)) || '(默认)'"],
  to: ['      // 第三级回落被摘除'],
})
MUTS.push({
  id: 'N12', axis: 'checker', key: 'checker',
  target: '让 stepShell 上溯跨过步骤边界（兄弟步骤的 shell 泄漏进来 = 归属错了还在判合规）',
  expectRed: '兄弟步骤的 shell 不得泄漏进本步骤',
  from: ['    if (i !== idx && /^\\s*-\\s*name:/.test(lines[i])) return "(默认)"',
    '    if (i !== idx && /^\\s*run:/.test(lines[i])) return "(默认)"'],
  to: ['    // 边界即停的两条判据被摘除（回到"12 行窗口内第一个 shell:"那种靠距离躲过的形态）'],
})
MUTS.push({
  id: 'N13', axis: 'checker', key: 'checker',
  target: 'runs-on 推导反向出错（windows 判成 bash ⇒ 真吞红被放过）',
  expectRed: 'runs-on: windows-latest 且未声明 shell',
  from: ['  if (v.includes("windows")) return "pwsh"'],
  to: ['  if (v.includes("windows")) return "bash"'],
})
MUTS.push({
  id: 'N14', axis: 'workflow', key: 'workflow',
  target: '把 CI 实测抛错的那个形态写回去：直接对 Get-Content 的结果调 .Trim()（空文件时为 $null）',
  expectRed: '自主覆盖审计仅在确认是无模型 NEED_HUMAN 报告时降级为告警',
  from: ['            $verdictNote = [string](Get-Content gate9-verdict-note.txt -Raw)'],
  to: ['            $verdictNote = (Get-Content gate9-verdict-note.txt -Raw).Trim()'],
})
MUTS.push({
  id: 'N15', axis: 'workflow', key: 'workflow',
  target: '把 PowerShell 守卫写回 ubuntu 作业的 bash 步骤（就是首轮 CI 红的原形态）',
  expectRed: 'ubuntu 作业的 run 块不得被写成 PowerShell 语法',
  from: ['          node scripts/migrate-postgres.js --dry-run'],
  to: ['          node scripts/migrate-postgres.js --dry-run',
    '          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'],
})

const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7)
const chosen = onlyArg ? MUTS.filter((m) => m.id === onlyArg) : MUTS

if (chosen.length === 0) {
  console.log('NO_MATCH --only=' + onlyArg + '（可用：' + MUTS.map((m) => m.id).join(',') + '）')
  process.exitCode = 2
} else {
  let preflightBad = 0
  const pre = []
  const baseline = {}
  for (const axis of ['checker', 'gate', 'workflow']) {
    try {
      const r = runTests(axis)
      const ok = r.fail === 0
      if (!ok) preflightBad++
      baseline[axis] = r.tests
      pre.push([ok ? 'P1_OK    ' : 'P1_FAIL  ', axis, 'tests=' + r.tests + ' fail=' + r.fail,
        ok ? '' : '未改动就红：' + r.names.join(' / ')].join(' | '))
    } catch (e) {
      preflightBad++
      pre.push(['P1_ABORT', axis, String(e.message).slice(0, 160)].join(' | '))
    }
  }
  for (const m of chosen) {
    if (!fs.readFileSync(KEY_TEST[m.axis], 'utf8').includes(m.expectRed)) {
      preflightBad++
      pre.push(['P2_FAIL  ', m.id, '期望变红的锁名在该测试文件里不存在：' + m.expectRed].join(' | '))
    }
  }
  console.log(pre.join('\n'))
  console.log('PREFLIGHT_BAD=' + preflightBad)

  const rows = []
  let bad = preflightBad
  if (preflightBad === 0) {
    try {
      for (const m of chosen) {
        try {
          inject(m.key, m.from, m.to)
          const r = runTests(m.axis)
          const hit = r.names.some((n) => n.includes(m.expectRed))
          const ok = r.fail > 0 && hit
          if (!ok) bad++
          rows.push([ok ? 'CAUGHT ' : 'MISSED ', m.id, m.axis, 'fail=' + r.fail + '/' + r.tests,
            hit ? '命中期望锁' : '期望锁没红：' + m.expectRed, '｜' + m.target].join(' | '))
        } catch (e) {
          bad++
          rows.push(['ABORTED', m.id, m.axis, String(e.message).slice(0, 150)].join(' | '))
        } finally {
          restore()
        }
      }
    } finally {
      restore()
    }
  } else {
    console.log('ABORT：前置自检不通过，变异结果不可信（先修驱动/套件，再谈反证）')
  }

  const drift = []
  for (const k of Object.keys(KEY_FILE)) {
    if (fs.readFileSync(KEY_FILE[k], 'utf8') !== BACKUP[k]) drift.push(path.basename(KEY_FILE[k]))
  }
  console.log(rows.join('\n'))
  console.log('MUTATIONS=' + chosen.length + ' MISSED=' + bad)
  console.log('RESTORED_BYTES_EQUAL=' + (drift.length === 0 ? 'true' : 'false:' + drift.join(',')))
  process.exitCode = bad === 0 && drift.length === 0 ? 0 : 1
}
