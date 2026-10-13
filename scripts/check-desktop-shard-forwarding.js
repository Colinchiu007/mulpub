'use strict'
/**
 * desktop-shards 的分片旗标是否真的送到了 vitest（2026-10-11，change: desktop-shard-flag）。
 *
 * 为什么要有这个文件：`.github/workflows/quality-gate.yml` 的 Desktop tests shard 步骤把七个
 * vitest 选项写在一个裸 `"--"` 之后，而 pnpm 会把那个 `--` **原样**交给脚本 ⇒ vitest 在 `--` 处
 * 停止解析选项，七个旗标全部变成"位置参数"。后果实测：两个 matrix 腿都跑了全量
 * （`Test Files 872 passed | 1 skipped (873)` 两条一模一样），桌面套件每次 CI 被完整跑两遍。
 * 它藏了这么久是因为其余六个旗标在 `apps/desktop/vitest.config.js` 里有第二份等价配置
 * （maxWorkers/fileParallelism/testTimeout/hookTimeout/teardownTimeout/reporters），掉了也看不出来；
 * 只有 `--shard` 没有兜底，而它恰好是"没生效也不报错"的那种。
 *
 * 三条判据，缺一不可：
 *  ① 结构层：从 workflow 正文里解析出真实 argv（不是匹配文本形状），判里面没有裸 `--`、有 `--shard=`；
 *  ② 行为层：**照 argv 真的跑一次** pnpm，让被调用方自己打印它收到了什么 —— 只匹配 workflow 文本
 *    等于把 #3315 那个"锁只匹配形状、从不问消费者收到什么"的错误再犯一遍。
 *    ② 还配一个负控：把坏形态（带裸 `--`）喂进去，必须真的收到那个 `--`，否则探针是恒真的。
 *    这条负控在 `check()` 内部也会出声（`probe` 可注入，便于离线构造"探针变盲"的形态并把它钉成红）。
 *  ③ 第二落点（本 PR 自己踩到的，2026-10-11）：**注释行插在反引号续行之后**会让 PowerShell 静默
 *    重新分组，`-ArgumentList @(...)` 整块掉队 —— 实测它**不报语法错**（三态对照见执行记录），
 *    所以"pwsh 解析通过"不构成证据，判据只能是文本级的"续行与下一行不得是注释"。
 *
 *   node scripts/check-desktop-shard-forwarding.js          # 结构 + 行为 + 续行完整性
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const WORKFLOW = '.github/workflows/quality-gate.yml'
const PKG_TOKEN = '@multi-publish/desktop'
const MATRIX_TOKEN = '${{ matrix.shard }}'

/** 从 workflow 正文里取出 desktop-shards 那一步的 -ArgumentList 实参数组。
 *  注释行先整行抹空：本仓的 why-comment 里会原样写出 `-ArgumentList @(...)` 这种代码字样
 *  （本轮的"位置纪律"注释就写了），不抹空的话惰性正则会从注释那处起锚，
 *  把中间的真实代码一起吞进捕获区 —— 锚点被自己的说明文字劫持，是"装饰性锁"的一种落点。 */
function parseShardArgv (workflowText) {
  const codeOnly = workflowText.split(/\r?\n/).map((l) => (/^\s*#/.test(l) ? '' : l)).join('\n')
  const stepIdx = codeOnly.indexOf('- name: "Desktop tests shard')
  if (stepIdx < 0) throw new Error('SHARD_STEP_NOT_FOUND：workflow 里找不到 Desktop tests shard 步骤（改名了？判据要跟着改）')
  const win = codeOnly.slice(stepIdx, stepIdx + 4000)
  const m = /-ArgumentList\s*@\(([\s\S]*?)\)\s*`\r?\n/.exec(win)
  if (!m) throw new Error('ARGUMENT_LIST_NOT_FOUND：解析不到 -ArgumentList @(...)，判据失明（不得当"没有问题"放行）')
  const tokens = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].replace(/\\"/g, '"'))
  if (tokens.length === 0) throw new Error('ARGUMENT_LIST_EMPTY：解析到 0 个实参，判据失明')
  return tokens
}

/** 临时 pnpm workspace：跑 argv 并让被调用方自己打印收到了什么。 */
function buildProbeWorkspace () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-shard-fwd-'))
  fs.mkdirSync(path.join(dir, 'packages', 'probe'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n')
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mp-shard-fwd-root', private: true, packageManager: 'pnpm@11.13.1' }) + '\n')
  fs.writeFileSync(path.join(dir, 'packages', 'probe', 'package.json'),
    JSON.stringify({ name: '@mpfwd/probe', version: '1.0.0', scripts: { test: 'node echo-args.js' } }) + '\n')
  fs.writeFileSync(path.join(dir, 'packages', 'probe', 'echo-args.js'),
    'console.log("ARGV=" + JSON.stringify(process.argv.slice(1)))\n')
  return dir
}

function runArgv (argv, { shard = '1/2' } = {}) {
  const dir = buildProbeWorkspace()
  const args = argv.map((t) => t.split(PKG_TOKEN).join('@mpfwd/probe').split(MATRIX_TOKEN).join(shard))
  try {
    // shell:true 是 Windows 必需：Node ≥18.20 拒绝不带 shell 地 spawn `.cmd`（实测 EINVAL），
    // 而 pnpm 在 Windows 上就是 pnpm.cmd。shell 模式下实参只拼接不转义（DEP0190），
    // 因此这里逐个加引号，并把"含 shell 元字符的实参"当场判为探针失效 —— 宁可红也不要静默跑错。
    const meta = /["&|<>^%]/
    if (args.some((t) => meta.test(t))) throw new Error('PROBE_ARG_UNSAFE：实参含 cmd 元字符，shell 拼接不可信：' + args.filter((t) => meta.test(t)).join(' '))
    const out = cp.execFileSync('pnpm', args.map((t) => `"${t}"`), { cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 26, shell: true })
    const m = /ARGV=(\[[\s\S]*?\])/.exec(out)
    if (!m) throw new Error('PROBE_NO_ARGV：被调用方没打印 argv，判据失明：' + out.slice(0, 200))
    return JSON.parse(m[1])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/**
 * 第二落点（本轮自己踩到的）：反引号续行的**下一行是注释行** ⇒ PowerShell 不报语法错，
 * 只是把语句重新分组，续行后面那串 `-ArgumentList @(...)` 静默变成一条独立语句，
 * Start-Process 于是带着 0 个参数被拉起来。实测三态对照（见执行记录）：
 *   A 基线（带裸 "--"）    解析 0 错、Start-Process 的 extent 含 -ArgumentList、长度 334
 *   B 注释插在续行之后     解析仍 0 错（所以"语法没报错"不是证据！）、extent 长度塌到 34、不含 -ArgumentList
 *   C 注释移到命令之前     解析 0 错、含 -ArgumentList、长度 324
 * 判据只能是"续行与下一条非注释行必须相邻"这一条文本级规则；全仓 13 个 workflow 实测 0 命中，
 * 因此不设例外清单（命中即红）。注释行自身的行尾反引号是散文里的行内代码闭合，须排除。
 */
function findContinuationSevers (text) {
  const lines = text.split(/\r?\n/)
  const hits = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*#/.test(lines[i])) continue
    if (/[`][ \t]*$/.test(lines[i]) && /^\s*#/.test(lines[i + 1])) hits.push({ line: i + 1, text: lines[i].slice(-60) })
  }
  return hits
}

/** 扫全部 workflow 正文；目录为空或读不动一律抛错（不得把"扫不到"读成"没问题"）。 */
function checkContinuations ({ root = path.resolve(__dirname, '..') } = {}) {
  const dir = path.join(root, '.github', 'workflows')
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.yml') || n.endsWith('.yaml')).sort()
  if (names.length === 0) throw new Error('WORKFLOWS_EMPTY：' + dir + ' 里一个 workflow 都没有，判据失明')
  const problems = []
  for (const n of names) {
    const hits = findContinuationSevers(fs.readFileSync(path.join(dir, n), 'utf8'))
    for (const h of hits) problems.push(`${n}:${h.line} 反引号续行的下一行是注释 ⇒ PowerShell 会把语句重新分组（实测 extent 从 334 塌到 34，参数整块掉队）：…${h.text}`)
  }
  return { files: names.length, problems }
}

/**
 * 分片形态的**唯一事实来源**：解析 argv（先把纯注释行挖空）、裸 "--" 计数、`--shard=` 是否存在、
 * 续行是否被注释吃掉。`check()` 与 `scripts/gate-budget.js` 的 `shardFormOf` 都消费这一份 ——
 * 两处各写各的判据就会出这种事：CI 把某个 run 报红的失效形态，探针却把它归进 "fixed" 池，
 * 于是"按形态分档"的前提被自己的第二份实现钻空子。解析不到那一步一律抛错，由调用方定语义。
 */
function shardFormFacts (text) {
  const argv = parseShardArgv(text)
  return {
    argv,
    bareCount: argv.filter((t) => t === '--').length,
    hasShard: argv.some((t) => String(t).startsWith('--shard=')),
    severs: findContinuationSevers(text),
  }
}

/** 三态里的两态在这里定（unknown 属于"读不到"，由抛错路径表达）：任一失效形态即 broken。 */
function classifyShardForm (text) {
  const f = shardFormFacts(text)
  return (f.bareCount || !f.hasShard || f.severs.length) ? 'broken' : 'fixed'
}

/**
 * 语义层（QM-6 逻辑轴 MAJOR#1 的答复）：行为层只证明"旗标送到了脚本"，**不证明 vitest 真按 --shard 切文件**。
 * 这里用仓库里**已安装的** vitest 在临时目录跑 4 个平凡测试文件，比两腿实际枚举到的文件名集合：
 * 互斥且合计等于总数，才是"分片语义生效"。本机实测（vitest 随仓库安装，pwsh/node 同版本）：
 *   --shard=1/2 → [t3,t4]、--shard=2/2 → [t2,t1]、--shard=1/4 → [t3]，单次约 0.7 秒。
 * ⛔ 不要用 `vitest list --filesOnly` 做这件事——实测它对 --shard **完全无反应**
 *   （全量/1÷2/2/2 都是 873），拿它当探针会把正确实现判成缺陷。
 */
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const SHARD_FIXTURE_TOTAL = 4

/** 逐级上溯找 vitest 入口；找不到一律抛错——"找不到就 skip"等于给这条判据关灯。 */
function resolveVitestEntry (fromDir) {
  let d = fromDir
  for (let i = 0; i < 8; i++) {
    const p = path.join(d, 'node_modules', 'vitest', 'vitest.mjs')
    if (fs.existsSync(p)) return p
    const up = path.dirname(d)
    if (up === d) break
    d = up
  }
  throw new Error('VITEST_ENTRY_NOT_FOUND：从 ' + fromDir + ' 上溯 8 层没找到 node_modules/vitest/vitest.mjs（不得静默跳过）')
}

function runVitestShard (entry, dir, shard) {
  const out = cp.execFileSync(process.execPath, [entry, 'run', '--root', dir, '--shard=' + shard],
    { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 240000, env: Object.assign({}, process.env, { CI: 'true' }) })
  const clean = out.replace(ANSI_RE, '')
  const files = [...new Set([...clean.matchAll(/[✓✗×]\s+([\w.\-/\\]+\.test\.js)/g)].map((m) => m[1].split('\\').join('/')))]
  if (files.length === 0) throw new Error('SHARD_PROBE_NO_FILES：vitest 跑完了但探针没枚举到任何测试文件名，判据失明：' +
    clean.split(/\r?\n/).filter((l) => /Test Files/.test(l))[0])
  return files
}

function runShardSemantics ({ root = path.resolve(__dirname, '..') } = {}) {
  const entry = resolveVitestEntry(root)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-shard-sem-'))
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mp-shard-sem', private: true, type: 'module' }) + '\n')
    for (let i = 1; i <= SHARD_FIXTURE_TOTAL; i++) {
      fs.writeFileSync(path.join(dir, 't' + i + '.test.js'),
        "import { test, expect } from 'vitest'\ntest('p" + i + "', () => { expect(" + i + ').toBe(' + i + ') })\n')
    }
    const legA = runVitestShard(entry, dir, '1/2')
    const legB = runVitestShard(entry, dir, '2/2')
    return { entry, total: SHARD_FIXTURE_TOTAL, legA, legB }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

function check ({ root = path.resolve(__dirname, '..'), probe = runArgv, semantics = runShardSemantics } = {}) {
  const problems = []
  const text = fs.readFileSync(path.join(root, WORKFLOW), 'utf8')
  const facts = shardFormFacts(text)
  const argv = facts.argv
  if (!facts.hasShard) problems.push('workflow 的 shard 参数里找不到 --shard=（分片整个不见了？）')
  if (facts.bareCount) problems.push(`workflow 的 -ArgumentList 里有 ${facts.bareCount} 个裸 "--"：pnpm 会原样交给脚本，vitest 到此停止解析选项 ⇒ 旗标全部静默失效`)

  // 第二落点：续行被注释吃掉（见 findContinuationSevers 的三态实测）
  const cont = checkContinuations({ root })
  problems.push(...cont.problems)

  // 语义层：vitest 自己承认两腿互斥（行为层只证明"送到了"，这一层证明"按它切了"）
  let semanticsResult = null
  try {
    semanticsResult = semantics({ root })
  } catch (e) {
    problems.push('语义层探针跑不起来（不得静默跳过）：' + String(e.message).slice(0, 200))
  }
  if (semanticsResult) {
    const { legA, legB, total } = semanticsResult
    const inter = legA.filter((f) => legB.includes(f))
    if (legA.length === 0 || legB.length === 0) {
      problems.push(`语义层探针某腿枚举到 0 个文件 ⇒ 判据失明，不得当通过：A=${JSON.stringify(legA)} B=${JSON.stringify(legB)}`)
    }
    if (inter.length) {
      problems.push(`--shard=1/2 与 2/2 有 ${inter.length} 个文件重叠（${inter.slice(0, 3).join(', ')}）` +
        ` ⇒ vitest 没有按旗标切文件。A=${JSON.stringify(legA)} B=${JSON.stringify(legB)}`)
    }
    if (legA.length + legB.length !== total) {
      problems.push(`两腿合计 ${legA.length + legB.length} 个文件 ≠ 夹具总数 ${total} ⇒ 分片在丢文件或没切`)
    }
  }

  // 行为层 + 负控：坏形态必须真的把 "--" 送进去，探针才有眼睛
  let received = null
  let control = null
  try {
    received = probe(argv)
    control = probe(['--filter', PKG_TOKEN, 'test', '--', '--shard=' + MATRIX_TOKEN])
  } catch (e) {
    problems.push('行为层探针跑不起来（不得静默跳过）：' + String(e.message).slice(0, 160))
  }
  if (received) {
    if (!received.some((t) => t.startsWith('--shard='))) {
      problems.push(`被调用方没收到 --shard ⇒ 分片仍然失效。实收 argv=${JSON.stringify(received)}`)
    }
    if (received.includes('--')) {
      problems.push(`被调用方收到了裸 "--" ⇒ vitest 会在它之后停止解析选项。实收 argv=${JSON.stringify(received)}`)
    }
  }
  if (control && !control.includes('--')) {
    problems.push('负控失效：手工插入的裸 "--" 没被送到被调用方 ⇒ 上面两条断言是恒真的，探针没有眼睛')
  }
  return { ok: problems.length === 0, problems, argv, received, control, continuation: cont, semantics: semanticsResult }
}

function main () {
  const r = check()
  console.log('[shard-forwarding] argv=' + JSON.stringify(r.argv))
  console.log('[shard-forwarding] 被调用方实收=' + JSON.stringify(r.received))
  console.log('[shard-forwarding] 续行完整性扫描：workflow ' + r.continuation.files + ' 个文件，命中 ' + r.continuation.problems.length + ' 处')
  if (r.semantics) {
    const inter = r.semantics.legA.filter((f) => r.semantics.legB.includes(f))
    console.log('[shard-forwarding] 语义层（真 vitest）：夹具 ' + r.semantics.total + ' 个文件，' +
      '1/2 → ' + JSON.stringify(r.semantics.legA) + '，2/2 → ' + JSON.stringify(r.semantics.legB) + '，重叠 ' + inter.length)
  }
  for (const p of r.problems) console.log('  PROBLEM: ' + p)
  console.log(r.ok ? 'OK —— 分片旗标确实送到了 vitest' : 'FAIL：桌面分片没有在分文件，两个 matrix 腿各跑全量')
  process.exitCode = r.ok ? 0 : 1
}

module.exports = { check, parseShardArgv, runArgv, findContinuationSevers, checkContinuations, runShardSemantics, resolveVitestEntry, shardFormFacts, classifyShardForm, WORKFLOW }
if (require.main === module) main(process.argv.slice(2))
