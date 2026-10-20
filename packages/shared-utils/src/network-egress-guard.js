// @ts-check
/**
 * packages/shared-utils/src/network-egress-guard.js — 测试层「禁止真实出站」的唯一实现
 *
 * 为什么要有这个共享模块：守卫原先只装在 `apps/desktop/test-setup.js` 的 vitest setup 里，
 * `packages/*`（252 个测试文件）与 `ops-center` 完全裸奔。本仓 **没有** `nock`/`msw`/`setupServer`
 * （实测全仓 0 命中），"测试不出网"没有任何传输层兜底，全靠逐文件手工注入桩 —— 漏一处就是一次真出站，
 * 而真出站挂起时先撞上框架 `testTimeout`，红里只剩 `Test timed out in 10000ms`，看不到主机也看不到出路。
 * 同一份判定被抄成第二份必然漂移（本仓已在登录态三态映射、Windows 文件锁夹具上各栽过一次），
 * 所以这里只放实现，各测试面只负责"装上它"。
 *
 * 三条硬约束（每条都对应一次已发生过的假绿，改动时一条都不能丢）：
 *  1) **Node 24 的 http/undici** 走 `net:Object.connect` 时会把 `[options, cb]` **作为单个数组参数**
 *     传进 `Socket.prototype.connect`（实测 arg0 = Array，keys=['0','1']）。不递归展平就把目标判成
 *     unknown 而静默放过 —— 第一版守卫正是这样漏掉的。
 *  2) **Node 22 的 `_http_client`** 会把 socket 早期错误改写成 `socket hang up`（CI 实测，本地 Node 24
 *     不改写），错误文案到不了调用方 ⇒ 可诊断性**不得**只挂在错误对象上，必须同时落账本 + console.warn，
 *     断言只依赖"秒失败 + 账本有记录"。
 *  3) `emit('error')` 之后的 `destroy()` **不得再带 error 参数**，否则二次触发无人监听的 'error'；
 *     而无监听者的调用方又必须走 `destroy(error)` 保持响亮 —— 只 `destroy()` 会让等 error 事件的调用方
 *     静默挂起，比崩掉更糟。
 *
 * 口径：放行 loopback（127/8、::1、localhost、`0.0.0.0`、`::`）与 unix / named pipe，其余在 **connect
 * 入口**拦截（因此 DNS 也不会发生，不会把 CI 拖进解析超时）。注意 `0.0.0.0` 只在 connect 语义下算本机；
 * "监听绑全网卡"是另一条判据，不得并进这里（否则要么漏拦 `listen(0)`，要么把全仓本地服务用例打红）。
 */
'use strict'

const net = require('net')
const path = require('path')
const fs = require('fs')
const ledgerStore = require('./network-egress-ledger.js') // sink 本体在隔壁文件（check-max-lines 的 limit=500 拆出来的，别搬回来）

const NETWORK_GUARD_APPLIED = '__mpTestNetworkGuardApplied'
const GUARD_WARNED = '__mpGuardWarned'
const BLOCKED_EGRESS_KEY = '__mpBlockedEgress'
const BLOCK_MARK = '[TEST-NETWORK-BLOCKED]'
const BLOCKED_CODE = 'ERR_TEST_NETWORK_BLOCKED'

function isLoopbackHostForTest (rawHost) {
  const host = String(rawHost || '').trim().replace(/^\[(.*)\]$/, '$1').toLowerCase()
  if (!host) return false
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || host === '::') return true
  if (host.startsWith('127.')) return true
  if (host.startsWith('::ffff:127.')) return true
  return false
}

/**
 * 从 `Socket.prototype.connect` 的实参里解析目标。返回 `{kind:'path'}` 表示 unix / named pipe，
 * `{kind:'unknown'}` 表示读不出来（调用方必须放行**但出声**，见 installTestNetworkGuard）。
 */
function readConnectTarget (args) {
  const first = args[0]
  if (Array.isArray(first)) return readConnectTarget(first)
  if (first && typeof first === 'object') {
    if (typeof first.path === 'string' && first.path) return { kind: 'path' }
    return { kind: 'host', host: first.host || first.hostname, port: first.port }
  }
  if (typeof first === 'string') {
    if (first.includes('/') || first.includes('\\')) return { kind: 'path' }
    return { kind: 'host', host: first, port: typeof args[1] === 'number' ? args[1] : undefined }
  }
  if (typeof first === 'number') {
    return { kind: 'host', host: typeof args[1] === 'string' ? args[1] : undefined, port: first }
  }
  return { kind: 'unknown' }
}

/**
 * 装上守卫。幂等：标记打在**被打补丁的函数自身**上（不是模块级 flag），因此 vitest 多 worker /
 * 多 realm 各自加载一次也不会互相覆盖成双层守卫。
 * @returns {{alreadyApplied: boolean}}
 */
function installTestNetworkGuard () {
  ledgerStore.recordInstallOnce()
  if (net.Socket.prototype.connect[NETWORK_GUARD_APPLIED]) return { alreadyApplied: true }
  const originalConnect = net.Socket.prototype.connect
  const guardedConnect = function (...args) {
    const target = readConnectTarget(args)
    if (target.kind !== 'path' && !target.host) {
      // 读不出目标就放行是必要的（不能因守卫误伤正常用例），但必须出声：
      // 静默放过等于守卫被 Node 的一次版本升级悄悄摘掉，正是本仓吃过两次的"假绿"形状。
      if (!net.Socket.prototype.connect[GUARD_WARNED]) {
        net.Socket.prototype.connect[GUARD_WARNED] = true
        console.warn(BLOCK_MARK + ' 守卫警告：无法从 connect 参数中识别目标主机（kind='
          + target.kind + '），本次放行。Node 版本=' + process.version
          + '，arg0 类型=' + (args[0] && args[0].constructor && args[0].constructor.name))
      }
    }
    if (target.kind === 'host' && target.host && !isLoopbackHostForTest(target.host)) {
      const socket = this
      const portText = target.port === undefined ? '' : ':' + target.port
      const detail = BLOCK_MARK + ' 单元测试禁止真实出站连接：' + target.host + portText + '。'
        + '请注入传输层桩（global.fetch = vi.fn() / __registerMock("axios", 桩) / 构造注入 axios|fetchImpl），'
        + '或把被测服务起在 127.0.0.1 的临时端口（listen(0, "127.0.0.1")）后访问 loopback 地址。'
      const error = new Error(detail)
      error.code = BLOCKED_CODE
      error.host = target.host
      error.port = target.port

      const blocked = globalThis[BLOCKED_EGRESS_KEY]
        || (globalThis[BLOCKED_EGRESS_KEY] = { list: [], seen: new Set() })
      const key = target.host + portText
      blocked.list.push({ host: target.host, port: target.port, at: Date.now(), node: process.version })
      if (!blocked.seen.has(key)) {
        blocked.seen.add(key)
        console.warn(detail)
      }
      // 落盘独立于"只出声一次"的去重：写失败时同一 host 的下一次尝试还会重试（见 recordExternalChild 同款注释）
      ledgerStore.ledgerWriteOnce({ type: 'blocked', host: target.host, port: target.port === undefined ? null : target.port }, 'blocked:' + key)

      process.nextTick(() => {
        const hasListener = socket.listenerCount('error') > 0
        if (!socket.destroyed && hasListener) {
          try { socket.emit('error', error) } catch (_) { /* 已被上层消化 */ }
          socket.destroy()
        } else {
          socket.destroy(error)
        }
      })
      return socket
    }
    return originalConnect.apply(this, args)
  }
  guardedConnect[NETWORK_GUARD_APPLIED] = true
  net.Socket.prototype.connect = guardedConnect
  return { alreadyApplied: false }
}

/**
 * 子进程面：把守卫传给 node 子进程。
 *
 * 为什么必须单独一层：`net.Socket.prototype.connect` 的补丁只在**装它的那个 realm** 有效。
 * 测试用 spawnSync / execFileSync / fork 起的 node 子进程里没有守卫，于是"测试期零真实出站"
 * 对这条路径结构性无效 —— #2783 的原始事故正是 `require('electron')` 在测试 realm 里
 * `spawnSync(process.execPath, [install.js])`，子进程真去下载数秒，耗时与 stdout 被记到
 * "当时正在跑的那条用例"头上（表现是"某用例随机 15s 超时"，而那条用例什么都没做）。
 *
 * 三条口径：
 *  1) 只给 **node 系**子进程注入 `--require <setup>`。非 node（git / python / electron.exe）
 *     注入不了守卫，一律**不改 argv**，只进台账并每个命令名出声一次 —— 把它们算成"已守住"
 *     就是把装饰性门禁写进安全声明。
 *  2) `execFileSync` / `execFile` 走的是 Node 内部绑定，patch 公开导出的 `spawnSync` **对它们无效**
 *     （实测：只 patch spawnSync 时 execFileSync 起的子进程 execArgv 里没有 --require）。
 *     所以四个入口必须逐个 patch。
 *  3) 包装层内部任何异常都必须原样落到真实调用（fail-open），但要 console.warn 出声 ——
 *     守卫把自己的测试弄崩，比漏一次出站更糟；漏一次而无人知道，比崩更难查。
 */
const CHILD_GUARD_FLAG = '__mpChildEgressGuarded'
const EXTERNAL_LEDGER_KEY = '__mpExternalChildSpawns'
const EXTERNAL_WARNED_KEY = '__mpExternalChildWarned'
const CHILD_WARN_MARK = '[TEST-NETWORK-CHILD-UNGUARDED]'
// Node 在 fork 未显式给 execArgv 时，默认会把"求值族"旗标连同其脚本值一起剔除；
// 一旦我们**显式写入** execArgv，这层保护就没了 —— 子进程会去执行父进程的 eval 脚本
// 而不是目标模块（实测：`node -e` 父进程下 fork 出的子进程 6s 不写盘、把自己递归 fork 出来，只能 kill）。
// 所以回落到 process.execArgv 时必须先自行过滤，口径与 Node 文档一致。
const EVAL_FLAGS_WITH_VALUE = ['-e', '--eval', '-p', '--print', '-c', '--check']

function isNodeCommand (command) {
  if (command === process.execPath) return !process.versions.electron
  const base = String(command || '').split(/[\\/]/).pop().toLowerCase()
  return base === 'node' || base === 'nodejs' || base === 'node.exe' || base === 'nodejs.exe'
}

/** exec/execSync 的 argv[0] 是整条命令行，取第一个空白/引号分隔的 token 才是命令名 */
function shellFirstToken (line) {
  const raw = String(line || '').trim()
  // 带引号的可执行路径里含空格时，"到第一个空格为止"会把 basename 折成中间那个词
  // （实测 `ledgerCommandName('"C:/Program Files/evil.exe" --x')` 返回 `Program`），
  // 于是真实的新命令被一个无意义键盖住、基线也读不出是谁在出网（QM-6 codex 路命中）。
  const quote = (raw[0] === '"' || raw[0] === "'") ? raw[0] : ''
  if (quote) {
    const close = raw.indexOf(quote, 1)
    if (close > 0) return raw.slice(1, close)
  }
  const s = raw.replace(/^["']/, '')
  const m = s.match(/^([^\s"'`|&;<>()]+)/)
  return m ? m[1] : s
}

/** 台账名：shell 命令行先取首 token，再取路径末段；否则 `npx vite build …` 会把整条串当"命令名" */
function ledgerCommandName (raw) {
  // `spawn(file, args)` / `fork(modulePath)` 传的是**裸路径**，不是 shell 命令行。
  // 路径含空格时（`C:\Program Files\Git\usr\bin\bash.exe`）切首 token 会把它折成 `Program`
  // ——真实的新外部命令被一个无意义键盖住，而台账的全部意义就是"谁在起子进程"。
  // `shellFirstToken` 只处理了**带引号**的形态，裸路径此前无人管（2026-10-20 由
  // electron-ci-shard 的行为锁命中：它的 spawn 的正是 Git Bash）。
  // 判据取**文件存在性**而不是猜词法：`exec`/`execSync` 传的是含空格分隔的整条命令行，
  // 整串不会解析成一个存在的文件，因此不会被这条提前命中。
  const whole = String(raw == null ? '' : raw).trim()
  if (whole && !/["'`|&;<>()]/.test(whole) && fs.existsSync(whole)) {
    return path.basename(whole) || '(empty)'
  }
  const token = shellFirstToken(raw)
  return String(token).split(/[\\/]/).pop() || '(empty)'
}

function filterEvalFlags (list) {
  const out = []
  const src = Array.isArray(list) ? list : []
  for (let i = 0; i < src.length; i++) {
    const a = String(src[i])
    if (EVAL_FLAGS_WITH_VALUE.includes(a)) { i++; continue }
    out.push(a)
  }
  return out
}

function sameModulePath (a, b) {
  const norm = (p) => { try { return path.resolve(String(p)) } catch (_) { return String(p) } }
  return norm(a) === norm(b)
}

function withRequireInjected (args, setupPath) {
  const list = Array.isArray(args) ? args : []
  for (let i = 0; i < list.length; i++) {
    const a = String(list[i])
    if (a === '--require' && sameModulePath(String(list[i + 1] || ''), setupPath)) return list
    if (a.startsWith('--require=') && sameModulePath(a.slice('--require='.length), setupPath)) return list
    if (a === '-r' && sameModulePath(String(list[i + 1] || ''), setupPath)) return list
  }
  return ['--require', setupPath, ...list]
}

/** spawn(command,args,options) / fork(modulePath,args,options) / exec(command,options) 都从下标 1 起找那个对象 */
function findOptionsObject (argv) {
  for (let i = 1; i < argv.length; i++) {
    const v = argv[i]
    if (v && typeof v === 'object' && !Array.isArray(v)) return { index: i, value: v }
  }
  return { index: -1, value: undefined }
}

// NODE_OPTIONS 按空白切词，路径含空格/引号会被拆断（实测 `Cannot find module 'D:/tmp'`）
function nodeOptionsSafe (setupPath) {
  return typeof setupPath === 'string' && setupPath.length > 0 && !/[\s"'`|&;<>()$]/.test(setupPath)
}

function withNodeOptions (options, setupPath) {
  const base = options && typeof options === 'object' ? options : {}
  const env = base.env || process.env
  const current = String(env.NODE_OPTIONS || '')
  if (current.includes(setupPath)) return base === options ? base : Object.assign({}, base, { env: Object.assign({}, env) })
  return Object.assign({}, base, {
    env: Object.assign({}, env, { NODE_OPTIONS: `${current ? `${current} ` : ''}--require ${setupPath}` }),
  })
}

function warnOnce (key, message) {  const warned = globalThis[EXTERNAL_WARNED_KEY] || (globalThis[EXTERNAL_WARNED_KEY] = new Set())
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`${CHILD_WARN_MARK} ${message}`)
}

function recordExternalChild (command) {
  const name = ledgerCommandName(command)
  // 落盘尝试与 realm 内去重**故意分成两件事**（QM-6 codex 路命中）：
  // 若先看 realm 台账再写盘，一次写失败就会因为"这个命令已经记过了"而永不重试 —— 台账少记且无声。
  ledgerStore.ledgerWriteOnce({ type: 'child', command: name }, 'child:' + name)
  const ledger = globalThis[EXTERNAL_LEDGER_KEY] || (globalThis[EXTERNAL_LEDGER_KEY] = [])
  if (!ledger.some((e) => e.command === name)) {
    ledger.push({ command: name, at: new Date().toISOString() })
    warnOnce(`ext:${name}`, `子进程 ${name} 不是 node，无法注入测试网络守卫；该子进程内的真实出站不受本守卫约束`)
  }
}

function readExternalChildLedger () {
  return (globalThis[EXTERNAL_LEDGER_KEY] || []).slice()
}


/**
 * 一次子进程调用的守卫决策。返回一个**行为标签**供测试断言（不是为了给人看，
 * 是为了让"到底走了哪条支路"在断言里可表达 —— 否则挂死/静默裸奔都读不出来）。
 */
function applyChildGuard (name, argv, setupPath) {
  const shellForm = name === 'exec' || name === 'execSync'
  const rawCommand = String(argv[0] || '')
  const commandName = shellForm ? shellFirstToken(rawCommand) : rawCommand
  const opts = findOptionsObject(argv)

  if (!setupPath) {
    warnOnce('no-setup-path', `${name} 拿不到 setupPath ⇒ 子进程面既不注入也不登记，本轮无守卫（装配错误，不是"没有子进程"）`)
    return 'no-setup'
  }
  // fork 的第一个参数是**模块路径**不是可执行文件，按命令名判 node 会把每一次 fork 误判成 external
  // （实测：注入根本没发生，而"目标脚本照常执行"的端到端用例照样绿 —— 因为不注入它也能跑完）。
  const nodeLike = name === 'fork' || isNodeCommand(commandName)
  if (!nodeLike) {
    recordExternalChild(rawCommand)
    return 'external'
  }

  if (name === 'fork') {
    const own = Object.prototype.hasOwnProperty.call(opts.value || {}, 'execArgv')
    const baseExecArgv = own ? opts.value.execArgv : filterEvalFlags(process.execArgv || [])
    // 挂载位：fork(modulePath[, args][, options])。已有对象就改它，否则落在参数位之后
    // （[mod] → 1、[mod,args] → 2、[mod,args,undefined] → 覆盖那个 undefined，而不是追加到 3）。
    const slot = opts.index >= 0 ? opts.index : Math.min(2, argv.length)
    argv[slot] = Object.assign({}, ledgerStore.withLedgerEnv(opts.value), {
      execArgv: withRequireInjected(baseExecArgv, setupPath),
    })
    return 'injected-fork'
  }

  if (shellForm) {
    // 命令行经 shell 展开，改 argv 不可行；NODE_OPTIONS 是唯一不改引号语义的注入面。
    if (!nodeOptionsSafe(setupPath)) {
      warnOnce('env-path-unsafe', `${name} 的 setupPath 含空白/引号，NODE_OPTIONS 会被拆断 ⇒ 跳过注入（该子进程无守卫）`)
      return 'skipped-unsafe-path'
    }
    argv[opts.index >= 0 ? opts.index : 1] = withNodeOptions(ledgerStore.withLedgerEnv(opts.value), setupPath)
    return 'injected-env'
  }

  if (opts.value && (opts.value.shell || opts.value.windowsVerbatimArguments)) {
    // shell/verbatim 形态下 Node 不转义参数，注入会在空格处断裂并打崩子进程；宁可不出声地放行原调用。
    warnOnce(`shell-opts:${ledgerCommandName(rawCommand)}`, `${name} 带 shell/verbatim 选项，注入会打崩子进程 ⇒ 跳过注入（该子进程无守卫）`)
    return 'skipped-shell-opts'
  }

  // env 与 argv 是两个独立的注入面：只补 --require 不补 env，自带 env 的调用方就会"守卫装了、记录丢了"。
  if (opts.index >= 0) argv[opts.index] = ledgerStore.withLedgerEnv(opts.value)
  const argsIndex = Array.isArray(argv[1]) ? 1 : (Array.isArray(argv[2]) ? 2 : -1)
  if (argsIndex > 0) argv[argsIndex] = withRequireInjected(argv[argsIndex], setupPath)
  else argv.splice(1, 0, withRequireInjected([], setupPath))
  return 'injected-argv'
}

function makeGuardedSpawner (name, original, setupPathRef) {
  const wrapped = function (...argv) {
    try {
      applyChildGuard(name, argv, setupPathRef.value)
    } catch (error) {
      console.warn(`${CHILD_WARN_MARK} ${name} 包装层自身异常，已原样放行真实调用：${(error && error.message) || error}`)
    }
    return original.apply(this, argv)
  }
  wrapped[CHILD_GUARD_FLAG] = true
  wrapped.__mpOriginalSpawn = original
  /**
   * 宿主函数的**符号契约必须原样搬过来** —— `child_process.execFile` 上挂着 Node 内部的
   * `Symbol(nodejs.util.promisify.custom)`（值是 ['stdout','stderr']），`util.promisify` 靠它决定
   * 决议形状。包装层不搬符号 ⇒ `promisify(wrapped)` 解析成**裸 stdout 字符串**而不是
   * `{stdout, stderr}`，于是 `const { stdout } = await execFileAsync(...)` 静默变成 undefined
   * —— 本仓实测：桌面 realm 装上子进程面后，`_probeMediaDuration` 恒返回 null，
   * story2video 的真实 ffmpeg 用例红在"expected null not to be null"（包装前 3/3 绿）。
   * 同名的 `.name`/`.length` 也一并保留，否则依赖函数签名的代码（含 promisify 的参数位置推断）
   * 会在包装后行为不同。
   */
  for (const sym of Object.getOwnPropertySymbols(original)) {
    try { wrapped[sym] = original[sym] } catch (_) { /* 只读符号：跳过，但真实调用仍走 original */ }
  }
  try {
    Object.defineProperty(wrapped, 'name', { value: original.name, configurable: true })
    Object.defineProperty(wrapped, 'length', { value: original.length, configurable: true })
  } catch (_) { /* 不可配置时保持默认，不影响行为 */ }
  return wrapped
}

function installTestChildProcessGuard ({ setupPath } = {}) {
  ledgerStore.recordInstallOnce()
  const childProcess = require('child_process')
  // 六个导出逐个 patch。exec/execSync 曾因"以为走 execFile"被漏掉：实测 `execSync('node -e …')`
  // 既不注入也不进台账（连可见化都没有），是这条门禁下唯一完全静默的出站口。
  const commands = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']
  let alreadyApplied = true
  for (const name of commands) {
    const original = childProcess[name]
    if (typeof original !== 'function') continue
    if (original[CHILD_GUARD_FLAG]) {
      if (original.__mpChildSetup) original.__mpChildSetup.value = setupPath || original.__mpChildSetup.value
      continue
    }
    alreadyApplied = false
    const setupPathRef = { value: setupPath }
    const wrapped = makeGuardedSpawner(name, original, setupPathRef)
    wrapped.__mpChildSetup = setupPathRef
    childProcess[name] = wrapped
  }
  return { alreadyApplied }
}

module.exports = {
  isLoopbackHostForTest,
  readConnectTarget,
  installTestNetworkGuard,
  installTestChildProcessGuard,
  readExternalChildLedger,
  isNodeCommand,
  applyChildGuard,
  filterEvalFlags,
  shellFirstToken,
  ledgerCommandName,
  BLOCKED_EGRESS_KEY,
  BLOCKED_CODE,
  BLOCK_MARK,
  CHILD_WARN_MARK,
}
