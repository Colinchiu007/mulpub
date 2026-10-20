/**
 * network-egress-guard-child.test.js — 测试期「禁止真实出站」守卫的**子进程面**
 *
 * 为什么要这一层（#2783 的另一半，两轮外部评审判 Critical）：守卫原先只 patch
 * `net.Socket.prototype.connect`，那只对**装它的那个 realm** 生效。而测试会用
 * `spawnSync` / `execFileSync` / `fork` 起**另一个 node 进程**做事 —— 那个 realm 里没有守卫，
 * 于是"测试期零真实出站"对这条路径结构性无效。#2783 的事故正是这个形状：
 * `require('electron')` 在测试 realm 里 `spawnSync(process.execPath, [install.js])`，
 * 子进程真去下载了 4 秒，耗时与 stdout 被 vitest 记到"当时正在跑的那条用例"头上。
 *
 * 六条被实测钉住的口径：
 *  1) 注入是否生效**一律由子进程自己报告**（打印 `process.execArgv`，或打印 socket 面标记），
 *     不用 mock 断言"我调过 spawn" —— Node 的 `execFileSync`/`execSync` 走内部绑定，
 *     patch 公开导出的 `spawnSync` 对它**无效**，靠 mock 会得到一条恒绿的假锁（本仓记作"装饰性门禁"）。
 *  2) 七个入口逐个 patch：spawn / spawnSync / execFile / execFileSync / **exec / execSync** / fork。
 *     exec/execSync 曾因"以为走 execFile"被漏掉 ⇒ 实测 `execSync('node -e …')` 既不注入也不进台账，
 *     是这条门禁下唯一完全静默的出站口（QM-6 两路评审独立命中）。
 *  3) 只对 node 系子进程注入；非 node（git / python / electron）不改 argv，只进台账并出声一次。
 *  4) `fork` 走 `options.execArgv`，且回落到 `process.execArgv` 时**必须剔除求值族旗标** ——
 *     显式写 execArgv 会取消 Node 默认的 `-e/--eval` 剔除，实测让子进程去跑父进程的 eval 脚本、
 *     目标模块根本不执行、子进程永不退出。
 *  5) 幂等：调用方自己已带同一 `--require`（含相对写法）时不得重复注入。
 *  6) 包装层自身异常不得吃掉真实 spawn（fail-open），但必须出声 —— 且这条锁**必须真的走进 catch 分支**，
 *     只跑正常输入的用例对"实现被删"完全免疫。
 *
 * 预算口径：子进程 timeout 一律取 CHILD_PROBE_TIMEOUT_MS，**必须显著小于** vitest testTimeout
 * （见本文件末「预算不得倒挂」那条），否则子进程挂死时框架先杀，红里只剩 `Test timed out`，
 * stderr 与 JSON 证据全丢 —— 那正是本工作流要消灭的诊断形态。
 */
import { describe, expect, it, beforeAll } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const GUARD_MODULE = path.join(here, '..', 'network-egress-guard.js')
const SETUP_MODULE = path.join(here, '..', '..', 'network-egress-guard.setup.js')
const TEST_NET_IP = '198.51.100.7'
const CHILD_PROBE_TIMEOUT_MS = 6000

let guard
let cp

beforeAll(() => {
  guard = require(GUARD_MODULE)
  cp = require('child_process')
})

const EXEC_ARGV_PROBE = 'console.log(JSON.stringify(process.execArgv))'
const SOCKET_MARK_PROBE = 'console.log(JSON.stringify(!!require("net").Socket.prototype.connect.__mpTestNetworkGuardApplied))'

function parseLastLine (stdout, stderr, label) {
  const text = String(stdout || '').trim()
  const line = text.split('\n').pop()
  try {
    return JSON.parse(line)
  } catch (_) {
    throw new Error(`${label} 的子进程没有吐出可解析的 JSON（stdout=${JSON.stringify(text)} stderr=${JSON.stringify(String(stderr || ''))}）`)
  }
}

function childExecArgvOf (argv) {
  const out = cp.spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: CHILD_PROBE_TIMEOUT_MS })
  expect(out.status, `子进程未正常退出：status=${out.status} signal=${out.signal} stderr=${String(out.stderr || '')}`).toBe(0)
  return parseLastLine(out.stdout, out.stderr, 'execArgv 探针')
}

/** 在子进程里真的连一次 TEST-NET-2，看它是不是被自己 realm 里的守卫拦在 connect 入口 */
const BLOCK_PROBE = [
  'const net = require("net")',
  'const s = new net.Socket()',
  's.on("error", (e) => { console.log(JSON.stringify({ blocked: e && e.code === "ERR_TEST_NETWORK_BLOCKED", code: e && e.code })); process.exit(0) })',
  'try { s.connect(443, "' + TEST_NET_IP + '") } catch (e) {',
  '  console.log(JSON.stringify({ blocked: e && e.code === "ERR_TEST_NETWORK_BLOCKED", code: e && e.code }))',
  '  process.exit(0)',
  '}',
].join('\n')

describe('子进程面：守卫必须传给 node 子进程', () => {
  it('对照组：走未包装的原始 spawnSync 时，子进程里 socket 面根本不存在（证明是这一层在起作用）', () => {
    // 装上之后 cp.spawnSync 本身已会注入 --require ⇒ 对照组必须显式走原始函数。
    // 这里**禁止** `|| cp.spawnSync` 之类的回退：守卫根本没装上时，回退会让对照组
    // 拿着真 spawnSync 也断言出"没有守卫"，装配失效照样绿（装饰性对照）。
    const raw = cp.spawnSync.__mpOriginalSpawn
    expect(typeof raw, 'cp.spawnSync.__mpOriginalSpawn 不存在 ⇒ 子进程面没装上，本对照不成立').toBe('function')
    const out = raw.call(cp, process.execPath, ['-e', SOCKET_MARK_PROBE], { encoding: 'utf8', timeout: CHILD_PROBE_TIMEOUT_MS })
    expect(out.status, String(out.stderr || '')).toBe(0)
    expect(parseLastLine(out.stdout, out.stderr, '对照组')).toBe(false)
  })

  it('installTestChildProcessGuard 存在且幂等（重复安装不得产生双层包装）', () => {
    expect(typeof guard.installTestChildProcessGuard).toBe('function')
    // 本测试面可能已由 vitest setupFiles 先装过一次 ⇒ 锁"承重性质"而不是首次返回值
    const before = cp.spawnSync
    expect(before.__mpChildEgressGuarded).toBe(true)
    expect(guard.installTestChildProcessGuard({ setupPath: SETUP_MODULE }).alreadyApplied).toBe(true)
    expect(cp.spawnSync).toBe(before)
    expect(typeof before.__mpOriginalSpawn).toBe('function')
    expect(before.__mpOriginalSpawn.__mpChildEgressGuarded).toBeUndefined()
  })

  it('七个导出都必须被包装（exec/execSync 曾被漏掉 ⇒ 静默出站）', () => {
    for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
      expect(cp[name].__mpChildEgressGuarded, `${name} 未被包装 ⇒ 该入口起的 node 子进程无守卫`).toBe(true)
      expect(typeof cp[name].__mpOriginalSpawn, `${name} 没有留下原始函数引用 ⇒ 无法做对照`).toBe('function')
    }
  })

  it('装上后 spawnSync 起的 node 子进程必须自己看到注入的 --require（子进程自报，不是 mock）', () => {
    guard.installTestChildProcessGuard({ setupPath: SETUP_MODULE })
    const argv = childExecArgvOf(['-e', EXEC_ARGV_PROBE])
    expect(argv).toContain('--require')
    expect(argv).toContain(SETUP_MODULE)
  })

  it('execFileSync 同样必须被覆盖（Node 内部绑定绕过 spawnSync，只 patch spawnSync 会恒绿）', () => {
    guard.installTestChildProcessGuard({ setupPath: SETUP_MODULE })
    const out = cp.execFileSync(process.execPath, ['-e', EXEC_ARGV_PROBE], { encoding: 'utf8', timeout: CHILD_PROBE_TIMEOUT_MS })
    const argv = parseLastLine(out, '', 'execFileSync')
    expect(argv).toContain(SETUP_MODULE)
  })

  it('execSync 走 shell，argv 改不了 ⇒ 必须经 NODE_OPTIONS 注入，且由子进程自报 socket 面真装上', () => {
    guard.installTestChildProcessGuard({ setupPath: SETUP_MODULE })
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-child-exec-'))
    const probe = path.join(dir, 'probe.js')
    fs.writeFileSync(probe, 'console.log(JSON.stringify(!!require("net").Socket.prototype.connect.__mpTestNetworkGuardApplied))\n')
    try {
      const out = cp.execSync(`node "${probe}"`, { encoding: 'utf8', timeout: CHILD_PROBE_TIMEOUT_MS })
      expect(parseLastLine(out, '', 'execSync 注入侧'), 'execSync 起的 node 子进程里没有守卫 ⇒ NODE_OPTIONS 注入失效').toBe(true)

      const raw = cp.execSync.__mpOriginalSpawn
      expect(typeof raw, 'execSync 未被包装 ⇒ 对照不成立').toBe('function')
      const control = raw.call(cp, `node "${probe}"`, { encoding: 'utf8', timeout: CHILD_PROBE_TIMEOUT_MS })
      expect(parseLastLine(control, '', 'execSync 对照组'), '对照组却有守卫 ⇒ 探针恒真，上一条不构成证据').toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('注入的守卫在子进程里真的拦下 connect，且是秒失败（拦在入口 ⇒ 无 DNS 无 SYN）', () => {
    guard.installTestChildProcessGuard({ setupPath: SETUP_MODULE })
    const t0 = Date.now()
    const out = cp.spawnSync(process.execPath, ['-e', BLOCK_PROBE], { encoding: 'utf8', timeout: CHILD_PROBE_TIMEOUT_MS })
    expect(out.status, `拦截探针子进程异常退出：stderr=${String(out.stderr || '')}`).toBe(0)
    const json = parseLastLine(out.stdout, out.stderr, '拦截探针')
    expect(json.blocked).toBe(true)
    expect(json.code).toBe('ERR_TEST_NETWORK_BLOCKED')
    expect(Date.now() - t0).toBeLessThan(5000)
  })

  it('幂等：调用方自带同一 --require 时，子进程只看到一个（不得重复注入）', () => {
    guard.installTestChildProcessGuard({ setupPath: SETUP_MODULE })
    const argv = childExecArgvOf(['--require', SETUP_MODULE, '-e', EXEC_ARGV_PROBE])
    expect(argv.filter((a) => a === '--require').length).toBe(1)
  })

  it('幂等对"同一文件的相对写法"也成立（去重按 path.resolve 归一，不按字符串全等）', () => {
    const relative = path.relative(process.cwd(), SETUP_MODULE)
    const args = ['--require', relative, '-e', '0']
    expect(guard.applyChildGuard('spawnSync', [process.execPath, args, {}], SETUP_MODULE)).toBe('injected-argv')
    expect(args).toEqual(['--require', relative, '-e', '0'])
  })

  it('非 node 子进程：argv 一字不改，但必须进台账（不冒充"守住了"）', () => {
    guard.installTestChildProcessGuard({ setupPath: SETUP_MODULE })
    const out = cp.spawnSync('git', ['--version'], { encoding: 'utf8', timeout: CHILD_PROBE_TIMEOUT_MS })
    expect(String(out.stdout)).toMatch(/^git version /)
    const externals = guard.readExternalChildLedger()
    expect(Array.isArray(externals)).toBe(true)
    expect(externals.some((e) => /git(\.exe)?$/i.test(String(e.command)))).toBe(true)
  })

  it('台账命令名取 shell 首 token：整条命令行不得成为"命令名"（否则台账读不出是谁在出网）', () => {
    expect(guard.ledgerCommandName('npx vite build --minify false')).toBe('npx')
    expect(guard.ledgerCommandName('C:\\Windows\\System32\\cmd.exe /c dir')).toBe('cmd.exe')
    expect(guard.ledgerCommandName('node -e "require(\'net\').connect(443,\'example.com\')"')).toBe('node')
    // 带引号且路径含空格时，"截到第一个空格"会把 basename 折成中间那个词（Program），
    // 于是真实的新外部命令被一个无意义键盖住；台账的整个意义就是"谁在出网"，这里必须折对。
    expect(guard.ledgerCommandName('"C:/Program Files/evil.exe" --do-outbound')).toBe('evil.exe')
    expect(guard.ledgerCommandName('"/usr/local/libexec/evil tool" -x')).toBe('evil tool')
  })

  it('台账命令名：spawn 的**裸路径**含空格时也不得被折成 Program（只治带引号形态是缺陷）', () => {
    // 2026-10-20 由 electron-ci-shard 的行为锁命中：#2525 的自证块要真跑一段 bash 才能验证
    // `-e -o pipefail` 语义，而 `resolveGitBash()` 给的是 `C:\Program Files\Git\…\bash.exe`。
    // 这条 spawn 是本仓**正当**的非 node 子进程，但旧实现把裸路径切首 token ⇒ 台账键成了
    // `child::Program`：真实命令被无意义键盖住，而台账的整个意义就是"谁在起子进程"。
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-name-'))
    const exe = path.join(dir, 'my tool.exe') // 文件名含空格，与 Git Bash 的形态同构
    fs.writeFileSync(exe, 'stub')
    expect(guard.ledgerCommandName(exe)).toBe('my tool.exe')
    // 负控：切首 token 的老行为会得到 'my'；显式钉住不许回退。
    expect(guard.ledgerCommandName(exe)).not.toBe('my')
    // 不存在的含空格串仍按**命令行**处理（exec 形态），不退化成"猜它是路径"。
    expect(guard.ledgerCommandName('git --version')).toBe('git')
  })

  it('fork 走 options.execArgv，不进 argv 位置（由子进程自己写盘报告，不用 mock）', async () => {
    guard.installTestChildProcessGuard({ setupPath: SETUP_MODULE })
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-child-fork-'))
    const outFile = path.join(dir, 'report.json')
    const child = path.join(dir, 'child.js')
    fs.writeFileSync(child, [
      'const fs = require("fs")',
      'fs.writeFileSync(process.argv[2], JSON.stringify({ execArgv: process.execArgv, rest: process.argv.slice(2) }))',
    ].join('\n'))
    const proc = cp.fork(child, [outFile], { silent: true })
    const t0 = Date.now()
    while (!fs.existsSync(outFile) && Date.now() - t0 < CHILD_PROBE_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    try { proc.kill() } catch { /* 已退出 */ }
    expect(fs.existsSync(outFile), 'fork 出的子进程没有写出报告：注入或 fork 本身失败').toBe(true)
    const json = JSON.parse(fs.readFileSync(outFile, 'utf8'))
    // 注入必须是"前置的 --require + 其路径"这一对，且不得混进任何求值族旗标。
    // 不用 toEqual 整表比对父进程 execArgv：Node 会按自己的规则归一继承来的旗标（实测条数就对不上），
    // 那种等式锁的是 Node 的实现细节，不是我承诺的语义。
    expect(json.execArgv.slice(0, 2)).toEqual(['--require', SETUP_MODULE])
    expect(json.execArgv.filter((a) => a === '-e' || a === '--eval' || a === '--print' || a === '-p')).toEqual([])
    expect(json.rest).toEqual([outFile])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('父进程以 `node -e` 形态 fork 时，求值族旗标必须被剔除（否则子进程去跑父脚本、永不退出）', () => {
    // 纯函数侧：口径 4 的过滤规则
    expect(guard.filterEvalFlags(['-e', 'script.js', '--expose-gc'])).toEqual(['--expose-gc'])
    expect(guard.filterEvalFlags(['--eval', 'x', '--require', 'y'])).toEqual(['--require', 'y'])
    // fork 的第一个参数是模块路径 —— 判 node 时必须按 fork 语义放行，否则每次 fork 都被误记成 external
    const argv = ['/tmp/child.js', ['-a']]
    const saved = process.execArgv
    Object.defineProperty(process, 'execArgv', { value: ['-e', 'require("evil")'], configurable: true, writable: true })
    try {
      expect(guard.applyChildGuard('fork', argv, SETUP_MODULE)).toBe('injected-fork')
    } finally {
      Object.defineProperty(process, 'execArgv', { value: saved, configurable: true, writable: true })
    }
    expect(argv[2].execArgv).toEqual(['--require', SETUP_MODULE])
  })

  it('父进程真的是 `node -e` 时，fork 出的子进程必须执行目标脚本（端到端，不是纯函数）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-e2e-fork-'))
    const child = path.join(dir, 'child.js')
    const outFile = path.join(dir, 'out.json')
    fs.writeFileSync(child, `require('fs').writeFileSync(${JSON.stringify(outFile)}, 'ok')\n`)
    // 父脚本自己等子进程退出并打印裁决 —— 不在测试进程里忙等（那会把"子进程没跑"
    // 和"我没等到"混成同一种红）。求值族旗标没被剔除时，子进程会去跑父脚本 ⇒ 再次 fork ⇒
    // 目标文件永不出现 ⇒ 这里如实报 MISSING/TIMEOUT。
    const parentScript = [
      "const cp=require('child_process')",
      `const g=require(${JSON.stringify(GUARD_MODULE)})`,
      `g.installTestChildProcessGuard({setupPath:${JSON.stringify(SETUP_MODULE)}})`,
      `const p=cp.fork(${JSON.stringify(child)},[],{silent:true})`,
      `let timed=false`,
      `const t=setTimeout(function(){timed=true;p.kill()},${CHILD_PROBE_TIMEOUT_MS - 1000})`,
      `p.on('exit',function(){clearTimeout(t);console.log(timed?'TIMEOUT':(require('fs').existsSync(${JSON.stringify(outFile)})?'OK':'MISSING'))})`,
    ].join(';')
    const out = cp.spawnSync(process.execPath, ['-e', parentScript], { encoding: 'utf8', timeout: CHILD_PROBE_TIMEOUT_MS })
    const verdict = String(out.stdout || '').trim().split('\n').pop()
    fs.rmSync(dir, { recursive: true, force: true })
    expect(verdict, `node -e 父进程下 fork 的子进程没有执行目标脚本（status=${out.status} signal=${out.signal} stderr=${String(out.stderr || '').slice(0, 300)}）`).toBe('OK')
  })

  it('带 shell / windowsVerbatimArguments 的 node 子进程：跳过注入并出声（注入会在空格处断裂、打崩子进程）', () => {
    const argv = [process.execPath, ['-e', '0'], { shell: true }]
    expect(guard.applyChildGuard('spawn', argv, SETUP_MODULE)).toBe('skipped-shell-opts')
    expect(argv[1]).toEqual(['-e', '0'])
    expect(guard.applyChildGuard('spawn', [process.execPath, ['-e', '0'], { windowsVerbatimArguments: true }], SETUP_MODULE))
      .toBe('skipped-shell-opts')
    // 同一条判据也必须覆盖 exec 族（它们本来就靠 shell，NODE_OPTIONS 是唯一安全注入面）
    expect(guard.applyChildGuard('execSync', ['node probe.js', { windowsVerbatimArguments: true }], SETUP_MODULE))
      .toBe('injected-env')
  })

  it('setupPath 缺失时必须出声，不得静默把子进程面变成 no-op（静默配置失败必须留日志）', () => {
    const warns = []
    const original = console.warn
    console.warn = (...a) => warns.push(String(a.join(' ')))
    try {
      expect(guard.applyChildGuard('spawnSync', [process.execPath, ['-e', '0'], {}], '')).toBe('no-setup')
    } finally {
      console.warn = original
    }
    expect(warns.some((w) => w.includes(guard.CHILD_WARN_MARK) && /setupPath/.test(w)),
      '缺 setupPath 却没出声：\n' + warns.join('\n')).toBe(true)
  })

  it('包装层自身异常不得吃掉真实 spawn（fail-open 且必须出声）—— 本用例必须真的走进 catch 分支', () => {
    guard.installTestChildProcessGuard({ setupPath: SETUP_MODULE })
    const warns = []
    const original = console.warn
    console.warn = (...a) => warns.push(String(a.join(' ')))
    let boom = false
    let realCallHappened = false
    try {
      // command 的 String() 一被调用就抛 ⇒ 唯一能确定走进 try 内部异常路径的注入方式
      const exploding = { toString () { boom = true; throw new Error('故意让包装层炸') } }
      try {
        cp.spawnSync(/** @type {any} */ (exploding), [], { encoding: 'utf8', timeout: CHILD_PROBE_TIMEOUT_MS })
        realCallHappened = true
      } catch (e) {
        // Node 自己会因为 file 不是 string 而抛 —— 这同样证明"真实调用被发起了"，
        // 而不是被包装层吞掉。断的是异常**来源**，不是"没抛"。
        realCallHappened = /"file" argument must be of type string/.test(String(e && e.message))
      }
      expect(boom, '包装层根本没碰到 toString ⇒ 本用例没有走进异常路径').toBe(true)
      expect(realCallHappened, '包装层炸了却没把真实调用发出去（把异常吞成了"没有子进程"）').toBe(true)
    } finally {
      console.warn = original
    }
    expect(warns.some((w) => w.includes(guard.CHILD_WARN_MARK) && /包装层自身异常/.test(w)),
      '包装层吞掉异常却没有出声：\n' + warns.join('\n')).toBe(true)
  })

  it('包装层必须保住宿主函数的 promisify 契约（丢符号会让 {stdout} 静默变 undefined）', async () => {
    guard.installTestChildProcessGuard({ setupPath: SETUP_MODULE })
    const util = require('util')
    // 行为锁：promisify 后的决议形状必须是 {stdout, stderr}，不是裸字符串
    const resolved = await util.promisify(cp.execFile)(process.execPath, ['-p', '1+1'])
    expect(typeof resolved, 'promisify(execFile) 不再解析成对象 ⇒ 自定义决议字段丢了').toBe('object')
    expect(String(resolved.stdout || '')).toContain('2')
    expect(Object.prototype.hasOwnProperty.call(resolved, 'stderr')).toBe(true)
    // 现场锁：包装层必须带着与原始函数**同一组符号**（Node 内部把 promisify 的决议形状
    // 实现挂在 `util.promisify.custom` 上，值是个函数，不是数组 —— 第一版按"值是 ['stdout','stderr']"
    // 去断言，实测取到 0 命中，那种锁会把"搬符号"这件事测不到）。
    const raw = cp.execFile.__mpOriginalSpawn
    expect(typeof raw, 'execFile 未被包装 ⇒ 本条不成立').toBe('function')
    const carried = Object.getOwnPropertySymbols(cp.execFile).map(String).sort()
    const wanted = Object.getOwnPropertySymbols(raw).map(String).sort()
    expect(carried.length, 'execFile 上一个符号都没有 ⇒ 宿主契约整段丢失').toBeGreaterThan(0)
    expect(carried).toEqual(wanted)
  })

  it('预算不得倒挂：子进程探针超时必须显著小于 vitest testTimeout，且随本文件一起被钉住', () => {
    // testTimeout 从 vitest.config.js 现场读，不写死 —— 写死的那个数会在别人调预算时静默失真，
    // 而"倒挂"这件事只有在两边都被实测时才可判定。
    const cfgText = fs.readFileSync(path.join(here, '..', '..', 'vitest.config.js'), 'utf8')
    const m = cfgText.match(/testTimeout:\s*(\d+)/)
    expect(m, 'vitest.config.js 里找不到 testTimeout ⇒ 本条锁的前提没了，须改锁不得改判据').toBeTruthy()
    const declared = Number(m[1])
    expect(CHILD_PROBE_TIMEOUT_MS).toBeLessThan(declared - 2000)
    const bare = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/timeout:\s*\d+/g) || []
    expect(bare, '本文件里出现了裸数字 timeout（必须引用 CHILD_PROBE_TIMEOUT_MS，否则一个漏写就是隐形倒挂）：\n'
      + bare.join('\n')).toEqual([])
  })
})

describe('装配面唯一：两个 realm 都必须同时装 socket 与子进程两个平面', () => {
  /** 注释里的调用不算接线（与 Gate 20 的 hasPlaneCall 同一条纪律，判据形状保持一份语义） */
  function codeOnly (file) {
    return fs.readFileSync(file, 'utf8').split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .map((l) => l.replace(/\s+\/\/.*$/, ''))
      .join('\n')
  }

  it('network-egress-guard.setup.js 两个 installer 都要调用', () => {
    const src = codeOnly(SETUP_MODULE)
    expect(src).toMatch(/installTestNetworkGuard\(\)/)
    expect(src).toMatch(/installTestChildProcessGuard\s*\([^)]*setupPath\s*:/)
  })

  // #2783 的案发现场是**桌面 realm**，而桌面用自己的 apps/desktop/test-setup.js 装守卫。
  // 只要求共享 setup 两面齐全，等于给主案发现场留着无守卫的子进程路径（QM-6 两路评审独立命中）。
  it('apps/desktop/test-setup.js 也必须装子进程面（桌面 realm 是 #2783 的现场）', () => {
    const desktopSetup = path.join(here, '..', '..', '..', '..', 'apps', 'desktop', 'test-setup.js')
    expect(fs.existsSync(desktopSetup), '找不到 apps/desktop/test-setup.js：' + desktopSetup).toBe(true)
    // 反证 M14 实测暴露过：文本级 toMatch(/installTestChildProcessGuard/) 会被"注释掉但留着那行字"骗绿。
    const src = codeOnly(desktopSetup)
    expect(src, '桌面 realm 没装子进程面 ⇒ require("electron") 起的 install.js 子进程仍然无守卫')
      .toMatch(/installTestChildProcessGuard\s*\([^)]*setupPath\s*:/)
    expect(src).toMatch(/network-egress-guard\.setup\.js/)
  })
})
