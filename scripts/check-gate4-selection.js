'use strict'
/**
 * scripts/check-gate4-selection.js —— 证明 Gate 4 真的把 `@multi-publish/desktop` 挡在 nx 选择集之外
 *
 * 一句话：判据不看 workflow 的**文本形状**，只看 nx **自己打印出来的选择声明**。
 *
 * 起因（2026-10-11 实测，main 上 QG Unit Tests 间歇性红的唯一根因）：
 *
 *     $testArgs = @("run", "test:all", "--", "--exclude=@multi-publish/desktop")
 *
 * 里那个独立的 `"--"` 不是 PowerShell 的转义习惯，它会被 pnpm **原样附加**到脚本命令上：
 *
 *     nx run-many -t test --all --parallel=1 -- --exclude=@multi-publish/desktop
 *                                               ↑ nx 把这里之后的一切都当成
 *                                                 「转发给每个任务命令的参数」
 *
 * 于是 nx 自己的选择集纹丝不动。run 38117456528 的现场两行就是这件事的全部证据：
 *
 *     NX   Running target test for 13 projects:        ← 13 个，含 desktop
 *     $ vitest run "--exclude=@multi-publish/desktop"   ← 旗标落到了叶子命令上
 *
 * 后果：Gate 4 在 30 分钟预算内串行跑 **desktop 全量**（而 desktop 已由 `desktop-shards`
 * 两个分片各跑一遍）。实测耗时正好压在预算临界点 ⇒ 成败取决于 runner 快慢：
 *   成功 run 38111779207 / 38111621873 的 Gate 4 步骤 = 1173s / 1322s
 *   失败 run 38114881457 / 38117318132 / 38117456528   = 1801s（= WaitForExit(1800000) 到点）
 *
 * 为什么既有门禁没拦住：`.github/scripts/workflow-contract.test.js:202-203` 用正则
 * **逐字钉住了这个带 `"--"` 的错误 argv**，把缺陷形态声明成受保护形态。它匹配的是文本，
 * 而不是「nx 收到什么」—— 这是 learnings 里「装饰性门禁」的又一落点：锁可以既精确又无用。
 *
 * 三层判据（缺一不判绿）：
 *   结构层  两个模式（affected / full）各自把 `$testArgs` 解析成最终命令行，
 *           要求 `--exclude=@multi-publish/desktop` 落在**独立 `--` 之前**（否则等于没传）。
 *   live 层 真跑一次「带 exclude」与一次「去掉 exclude」的同一条命令（A/B），读 nx 打印的
 *           声明清单：前者必须没有 desktop 且不少于 MIN_OTHERS 个，后者**必须有** desktop。
 *           后者是负控 —— 它不成立时说明探针根本看不见 desktop，此时"没有 desktop"这个
 *           结论本身不可信，必须判红而不是判绿。
 *   接线层 读的是仓里那两份真实文件（workflow + package.json），不是手搓夹具。
 *
 * affected 侧不强制 live 是**有理由的例外**（不是可省）：`nx affected` 的选择集等于「本 PR
 * 影响的包」，在干净工作区上是空集、nx 不打印声明 ⇒ A/B 的负控臂无法确定成立。机制证据由
 * full 侧一次性守住，affected 侧由结构层守「同一个旗标确实作为 nx 参数传出」。
 *
 * 退出码契约：0 判据成立 / 1 判据不成立（含探针取不到证据）/ 2 用法或文件读取错误。
 * 刻意**不提供** `--offline` 之类的跳过开关：那等于给这条锁留一条静默自杀的路。
 *
 * 用法：node scripts/check-gate4-selection.js [--root=<dir>]
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const DESKTOP_PROJECT = '@multi-publish/desktop'
const EXCLUDE_FLAG = '--exclude=' + DESKTOP_PROJECT
// 下界取 11：实测排除 desktop 后 nx 声明 12 个包（本机 2026-10-11 与 run 38117456528 同形）。
// 留 1 的余量是因为 workspace 会增减包；但**不得**降到 0 —— 降到 0 时"选择集为空"也会被放过，
// 那正是 #2902/#2596 反复踩过的「空集被误读」形态。
const MIN_OTHERS = 11

const GATE4_STEP_RE = /^[ \t]*- name:\s*"Gate 4 - Workspace unit tests"\s*$/m
const NEXT_STEP_RE = /^ {6}- name: /gm
const TEST_ARGS_RE = /\$testArgs\s*=\s*@\(([^)]*)\)/g
// nx affected 无受影响任务时的原文（本机 2026-10-11 实测，见 judgeLiveArm 的注释）
const NO_TASKS_RE = /NX\s+No tasks were run/
// live 臂经 pnpm 调用（Windows 上是 pnpm.cmd，且必须经 cmd.exe /c —— Node>=18.20 直接
// spawn 一个 .cmd 会 EINVAL，本仓已踩过两次）。
const PM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function tokenize (cmd) {
  return String(cmd).split(/\s+/).map((t) => t.replace(/^["']|["']$/g, '')).filter((t) => t !== '')
}

/**
 * 把 workflow 里的 `$testArgs = @(...)` 字面量解析成数组，并按脚本名归到两个模式。
 * @returns {{full: string[], affected: string[], problems: string[]}}
 */
function parseGate4TestArgs (workflowText) {
  const out = { full: [], affected: [], problems: [] }

  const stepAt = workflowText.search(GATE4_STEP_RE)
  if (stepAt === -1) {
    out.problems.push('找不到 Gate 4 步骤头（`- name: "Gate 4 - Workspace unit tests"`）—— 步骤被改名或删除，本锁的判定域已失联')
    return out
  }
  // 步骤正文的右边界：下一个同缩进的 `- name:`。找不到就到文件末尾。
  NEXT_STEP_RE.lastIndex = stepAt + 1
  const next = NEXT_STEP_RE.exec(workflowText)
  const body = workflowText.slice(stepAt, next ? stepAt + next.index : workflowText.length)

  const literals = []
  let m
  TEST_ARGS_RE.lastIndex = 0
  while ((m = TEST_ARGS_RE.exec(body)) !== null) {
    literals.push(m[1].split(',').map((s) => s.trim()).filter((s) => s !== ''))
  }
  if (literals.length === 0) {
    out.problems.push('Gate 4 步骤正文里取不到任何 $testArgs = @(...) 字面量 —— 变量被改名或赋值被搬走，本锁已失去读者')
    return out
  }
  for (const arr of literals) {
    const name = String(arr[1] || '').replace(/^["']|["']$/g, '')
    const mode = /affected/.test(name) ? 'affected' : (/all/.test(name) ? 'full' : null)
    if (!mode) { out.problems.push('$testArgs 引用的脚本 "' + name + '" 既不含 affected 也不含 all，无法归到两个模式'); continue }
    if (out[mode].length > 0) { out.problems.push('Gate 4 里 ' + mode + ' 侧出现两条 $testArgs —— 判哪一条是执行的那条？不得靠猜'); continue }
    out[mode] = arr.map((s) => String(s).replace(/^["']|["']$/g, '')).filter((s) => s !== '')
  }
  if (out.full.length === 0) out.problems.push('Gate 4 缺 full 模式（TEST_MODE≠affected 时执行的那条）的 $testArgs')
  if (out.affected.length === 0) out.problems.push('Gate 4 缺 affected 模式（PR 上执行的那条）的 $testArgs')
  return out
}

/** pnpm 的转发语义：脚本正文 + 空格 + 逐个转发的实参（不做任何引号/分隔符加工）。 */
function effectiveCommand ({ scriptText, forwarded }) {
  const rest = (forwarded || []).join(' ')
  return rest ? scriptText + ' ' + rest : scriptText
}

/**
 * exclude 旗标在最终命令行里落在哪一侧。
 * `nx`  = nx 会消费它（选择集受影响）
 * `task`= 落在独立 `--` 之后 ⇒ nx 把它转发给每个任务命令，自己的选择集不变（**这就是 Bug 形态**）
 * `absent` = 整条命令里根本没有这个旗标
 */
function classifyExcludePlacement (commandLine) {
  const tokens = tokenize(commandLine)
  const sepAt = tokens.indexOf('--')
  const flagAt = tokens.indexOf(EXCLUDE_FLAG)
  if (flagAt === -1) {
    const loose = tokens.findIndex((t) => t.startsWith('--exclude'))
    return { placement: 'absent', sepAt, flagAt: loose, hint: loose === -1 ? '整条命令没有 --exclude' : '出现了 --exclude 的其它写法（如 "--exclude <值>" 分成两个 token），本锁只认 ' + EXCLUDE_FLAG }
  }
  if (sepAt === -1 || flagAt < sepAt) return { placement: 'nx', sepAt, flagAt }
  return { placement: 'task', sepAt, flagAt }
}

/**
 * 读 nx 打印的选择声明：
 *   NX   Running target test for 12 projects:
 *   - pkg-a
 *   ...
 * @returns {{projects: string[], headerCount: number|null, unparsable: boolean, countMismatch: boolean}}
 */
function parseDeclaredProjects (text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/)
  let headerCount = null
  let singularProject = null
  for (const l of lines) {
    const m = /Running[^\n]*?for\s+(\d+)\s+project/.exec(l)
    if (m) { headerCount = Number(m[1]); break }
    // nx 在**只有一个**受影响项目时不打印计数，而是点名该项目：
    //   ` NX   Running target test for project @multi-publish/api-publish-engine:`
    //   （多项目形态才是 `for 12 projects:`）
    // 2026-10-12 实测缺陷：此前只认带数字的形态 ⇒ 任何「恰好影响 1 个非 desktop 包」的 PR
    // 恒被判「判据失联」而红（PR #3375 现场；本机 `node scripts/check-gate4-selection.js` 可复现）。
    // 判窗不放宽：单数形态仍要求「头部点名的项目」与「- 清单」自洽且只列 1 个。
    const s = /Running[^\n]*?for\s+project\s+([^\s:]+)\s*:?\s*$/.exec(l)
    if (s) { headerCount = 1; singularProject = s[1]; break }
  }
  const projects = []
  for (const l of lines) {
    const m = /^- (\S+)\s*$/.exec(l)
    if (m && !projects.includes(m[1])) projects.push(m[1])
  }
  let unparsable = headerCount === null || projects.length === 0
  // 单数形态的自洽检查：点名项目必须在清单里，且清单必须只有它一个
  if (!unparsable && singularProject) {
    if (!projects.includes(singularProject) || projects.length !== 1) unparsable = true
  }
  return { projects, headerCount, unparsable, countMismatch: headerCount !== null && headerCount !== projects.length }
}

/** 组装两臂的命令行（A = 原样，B = 去掉 exclude 的负控）。 */
function planCommands (workflowText, pkgScripts) {
  const args = parseGate4TestArgs(workflowText)
  const entries = []
  for (const mode of ['full', 'affected']) {
    const argv = args[mode]
    if (!argv || argv.length === 0) continue
    const scriptName = argv[1]
    const scriptText = scriptName ? (pkgScripts || {})[scriptName] : undefined
    if (!scriptText) {
      args.problems.push(mode + ' 侧引用的脚本 "' + scriptName + '" 不在 package.json 的 scripts 里（不得静默跳过判定）')
      continue
    }
    if (argv[0] !== 'run') {
      args.problems.push(mode + ' 侧第一条实参应是 "run"，实际是 "' + argv[0] + '" —— pnpm 调用形态被改，命令行组装不再成立')
      continue
    }
    const commandLine = effectiveCommand({ scriptText, forwarded: argv.slice(2) })
    const tokens = tokenize(commandLine)
    const hasFlag = tokens.includes(EXCLUDE_FLAG)
    // live 臂**必须按 CI 真正执行的那个调用来跑**，不能把脚本正文当命令直接 spawn：
    // `nx` 只有经 pnpm 才在 PATH 上（pnpm 会把 node_modules/.bin 注入子进程），
    // 裸 spawn 脚本正文会立刻 rc=1、什么都测不到（本脚本第一次实跑就撞在这条上）。
    //   A 臂 = `pnpm run <script> [转发实参...]`，与 Start-Process 用的 argv 逐字同形。
    //   B 臂（负控）= 优先走**同一条入口的孪生脚本**（去掉 `:no-desktop` 后缀那条，它自身不带
    //          exclude，本机实测 nx 声明 13 个包含 desktop）⇒ A/B 唯一的差别是"脚本自身带不带
    //          那个旗标"，两条臂共用完全相同的调用路径。QM-6 后端轴 Info C1 命中的原先写法
    //          （B 走 `pnpm exec nx ...`）与 A 的 `pnpm run <script>` 不是同一条解析路径，
    //          理论上可见到不同包集。只有孪生脚本不存在时才退回 `pnpm exec` 去旗标的形式。
    const runLine = [PM, 'run', scriptName].concat(argv.slice(2)).join(' ')
    const stripped = tokens.filter((t) => t !== EXCLUDE_FLAG)
    const twinName = scriptName.replace(/:no-desktop$/, '')
    const hasTwin = twinName !== scriptName && Boolean((pkgScripts || {})[twinName])
    const baseRunLine = hasFlag ? (hasTwin ? [PM, 'run', twinName].join(' ') : [PM, 'exec'].concat(stripped).join(' ')) : null
    entries.push({
      mode,
      scriptName,
      commandLine,
      baseCommandLine: hasFlag ? stripped.join(' ') : null,
      runLine,
      baseRunLine,
      baseKind: hasFlag ? (hasTwin ? 'twin:' + twinName : 'exec-fallback') : null,
      liveRequired: mode === 'full',
    })
  }
  return { entries, problems: args.problems.slice() }
}

/**
 * 主判据。
 * @param {{workflowText: string, pkgScripts: object, live: null|object}} input
 *        live = null 时只跑结构层（单测用）；否则 key 必须是**命令行原文**，value 是该命令的
 *        stdout+stderr 合并文本。命令行原文作键是刻意的：拼错键 = 取不到证据 = 判红，
 *        不会出现"注入了一条别的命令的输出还判绿"。
 */
function judge (input) {
  const problems = []
  const evidence = []
  const { workflowText, pkgScripts, live = null } = input

  const p = planCommands(workflowText, pkgScripts)
  problems.push(...p.problems)

  for (const e of p.entries) {
    const cls = classifyExcludePlacement(e.commandLine)
    if (cls.placement === 'absent') {
      problems.push(e.mode + ' 侧的最终命令行没有把 ' + EXCLUDE_FLAG + ' 传给 nx（' + (cls.hint || '整条命令没有 --exclude') + '）：' + e.commandLine)
    } else if (cls.placement === 'task') {
      problems.push(e.mode + ' 侧的 ' + EXCLUDE_FLAG + ' 落在独立 `--`（第 ' + cls.sepAt + ' 个 token）之后（flagAt=' + cls.flagAt + '）' +
        '⇒ nx 会把它**转发给每个任务命令**而不是自己消费，选择集不受影响（desktop 会照样进来）：' + e.commandLine)
    }
    if (cls.placement === 'nx') evidence.push(e.mode + ' exclude 作为 nx 旗标：' + e.commandLine)
  }

  if (live === null) return { ok: problems.length === 0, problems, evidence, entries: p.entries }

  for (const e of p.entries) {
    if (classifyExcludePlacement(e.commandLine).placement !== 'nx') continue
    if (!e.liveRequired) {
      if (live[e.runLine] != null) {
        judgeLiveArm(e, e.runLine, 'A', live, problems, evidence, { emptyIsLegitimate: true })
      } else {
        evidence.push(e.mode + ' 本轮无可选声明（affected 选择集取决于 diff），由结构层守住旗标位置')
      }
      continue
    }
    judgeLiveArm(e, e.runLine, 'A（带 ' + EXCLUDE_FLAG + '）', live, problems, evidence)
    judgeLiveArm(e, e.baseRunLine, 'B（去掉 exclude 的负控）', live, problems, evidence)
    evidence.push(e.mode + ' B 臂来源 ' + e.baseKind + '：' + e.baseRunLine)

    const a = parseDeclaredProjects(live[e.runLine])
    if (!a.unparsable && !a.countMismatch && !a.projects.includes(DESKTOP_PROJECT) && a.projects.length < MIN_OTHERS) {
      problems.push('排除后的选择集只有 ' + a.projects.length + ' 个包，低于下界 ' + MIN_OTHERS + ' —— ' +
        '「没有 desktop」很可能是「选择集整个为空/解析退化」，不是排除生效（空集不得当成通过）')
    }
  }

  return { ok: problems.length === 0, problems, evidence, entries: p.entries }
}

function judgeLiveArm (entry, commandLine, label, live, problems, evidence, { emptyIsLegitimate = false } = {}) {
  if (commandLine == null) {
    problems.push(entry.mode + ' 侧缺 ' + label + ' 的执行命令（结构层没能组出 runLine/baseRunLine）')
    return
  }
  const raw = live[commandLine]
  if (raw == null || raw === '') {
    problems.push(entry.mode + ' 侧 ' + label + ' 的选择声明没采集到 ⇒ 无法判定（缺证据不等于通过）：' + commandLine)
    return
  }
  const d = parseDeclaredProjects(raw)
  if (d.unparsable && emptyIsLegitimate && NO_TASKS_RE.test(raw)) {
    // 实测（2026-10-11 本机干净工作区）：`nx affected -t test` 无受影响任务时打印
    // ` NX   No tasks were run` 后 rc=0 退出。这是**合法的空选择集**，不是探针坏了；
    // 但它只能用于 affected 侧（选择集取决于 diff），full 侧出现同样输出即判红。
    evidence.push(entry.mode + ' 侧本轮确证无受影响任务（nx 原文 "No tasks were run"），A/B 由 full 侧守')
    return
  }
  if (d.unparsable) {
    problems.push(entry.mode + ' 侧 ' + label + ' 的 nx 输出里取不到「Running target ... for N projects」声明 —— nx 报错或换了输出形态，判据失联')
    return
  }
  if (d.countMismatch) {
    problems.push(entry.mode + ' 侧 ' + label + ' 的声明头说 ' + d.headerCount + ' 个，实际列出 ' + d.projects.length + ' 个 —— 采集被截断或解析退化，不得据此下结论')
    return
  }
  const has = d.projects.includes(DESKTOP_PROJECT)
  if (label.startsWith('A')) {
    if (has) problems.push(entry.mode + ' 侧 A/B 的 A 臂里 ' + DESKTOP_PROJECT + ' **仍在** nx 选择集（声明的 ' + d.projects.length + ' 个包含它）⇒ 排除没生效')
    else evidence.push(entry.mode + ' A 臂：nx 自己声明 ' + d.projects.length + ' 个包，不含 ' + DESKTOP_PROJECT)
  } else {
    if (!has) problems.push(entry.mode + ' 侧 B 臂（负控）不成立：去掉 ' + EXCLUDE_FLAG + ' 后 nx 声明里仍没有 ' + DESKTOP_PROJECT +
      ' —— 说明探针看不见被排除的东西，A 臂的"没有 desktop"因此不构成证据（判据失明，不是通过）')
    else evidence.push(entry.mode + ' B 臂（负控）：不传 exclude 时 nx 声明 ' + d.projects.length + ' 个包，含 ' + DESKTOP_PROJECT)
  }
}

// --- CLI：真跑 A/B -------------------------------------------------------------

/**
 * live 臂子进程的环境变量：**必须摘掉运行时出站台账的两个键**。
 *
 * 为什么：Gate 4 这一步自己就带 `MP_TEST_EGRESS_LEDGER=<runner.temp>\egress-ledger-unit-tests.jsonl`，
 * 并在步骤末尾用 `check-test-egress-ledger.js` 按"出现基线之外的新键即红"判定。
 * 本脚本的 A/B 两臂会**真起测试进程再中途杀掉**（只为读到 nx 的选择声明），
 * 若让它们继承同一个台账路径，那两次半成品运行就会往被判定的那份台账里写记录 ——
 * 一次自检把自己判红（同源教训：判据必须落在"取得到证据的位置"，也别落在"会污染证据的位置"）。
 * 摘掉这两个键即让守卫不写盘；被测的真实运行（Start-Process 那一趟）不受影响。
 */
function childEnv (env) {
  const out = Object.assign({}, env || {})
  delete out.MP_TEST_EGRESS_LEDGER
  delete out.MP_TEST_EGRESS_SUITE
  return out
}

function collectDeclaration (shellCommand, { cwd, maxMs = 45000, env } = {}) {
  return new Promise((resolve) => {
    let buf = ''
    let settled = false
    const argv = process.platform === 'win32' ? ['/c', shellCommand] : ['-c', shellCommand]
    const child = spawn(process.platform === 'win32' ? 'cmd.exe' : 'sh', argv, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: env || childEnv(process.env),
    })
    const kill = () => {
      // 只杀**自己 spawn 的**这一棵树（PID 归属明确），不碰任何无法归属的进程。
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) { /* 已退出 */ }
    }
    const finish = (why) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      kill()
      // 杀树与读输出之间留一点时间，让已缓冲的 stdout 落进 buf（声明块在任务启动前就打完了）
      setTimeout(() => resolve({ output: buf, why }), 250)
    }
    const onData = (c) => {
      buf += c.toString('utf8')
      const d = parseDeclaredProjects(buf)
      if (!d.unparsable && !d.countMismatch) finish('declared=' + d.projects.length)
      else if (/> nx run /.test(buf)) finish('taskStarted')
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => finish('exited:' + code))
    child.on('error', (e) => finish('spawnError:' + e.message))
    const timer = setTimeout(() => finish('cap'), maxMs)
  })
}

async function main () {
  const rootArg = process.argv.find((a) => a.startsWith('--root='))
  const root = rootArg ? path.resolve(rootArg.slice('--root='.length)) : path.resolve(__dirname, '..')
  const wfPath = path.join(root, '.github/workflows/quality-gate.yml')
  const pkgPath = path.join(root, 'package.json')

  let workflowText, pkgScripts
  try {
    workflowText = fs.readFileSync(wfPath, 'utf8')
    pkgScripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts
  } catch (e) {
    console.error('[gate4-selection] 读取判定域失败: ' + e.message)
    return 2
  }

  const p = planCommands(workflowText, pkgScripts)
  const live = {}
  if (p.problems.length === 0) {
    for (const e of p.entries) {
      if (classifyExcludePlacement(e.commandLine).placement !== 'nx') continue
      if (e.liveRequired) {
        const a = await collectDeclaration(e.runLine, { cwd: root })
        live[e.runLine] = a.output
        const b = await collectDeclaration(e.baseRunLine, { cwd: root })
        live[e.baseRunLine] = b.output
        console.log('[gate4-selection] A/B 采集完成 A=' + a.why + ' B=' + b.why)
      } else {
        const a = await collectDeclaration(e.runLine, { cwd: root })
        live[e.runLine] = a.output
        console.log('[gate4-selection] affected 侧采集（可为空声明）why=' + a.why)
      }
    }
  } else {
    console.log('[gate4-selection] 结构层已判红，跳过 live 采集（不再花 2×nx 启动的时间）')
  }

  const r = judge({ workflowText, pkgScripts, live })
  for (const line of r.evidence) console.log('[gate4-selection] ' + line)
  if (!r.ok) {
    for (const line of r.problems) console.error('[gate4-selection] 问题: ' + line)
    console.error('[gate4-selection] FAIL —— Gate 4 会把 desktop 全量测试混进 30 分钟预算，见 scripts/check-gate4-selection.js 头部注释')
    return 1
  }
  console.log('[gate4-selection] OK —— ' + DESKTOP_PROJECT + ' 确实不在 nx 的选择集里')
  return 0
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code }).catch((e) => {
    console.error('[gate4-selection] 脚本自身异常: ' + (e && e.stack))
    process.exitCode = 2
  })
}

module.exports = {
  DESKTOP_PROJECT,
  EXCLUDE_FLAG,
  MIN_OTHERS,
  parseGate4TestArgs,
  effectiveCommand,
  classifyExcludePlacement,
  parseDeclaredProjects,
  planCommands,
  judge,
  childEnv,
  collectDeclaration,
  main,
}
