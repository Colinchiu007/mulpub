// @ts-check
/**
 * test-helpers/windows-file-lock.js — 真实 Windows 独占文件锁夹具（跨包共用）
 *
 * 为什么要有这个共享模块：同一份实现此前被抄成三份
 * （apps/desktop/electron/services/credential-store.test.js、
 *  apps/desktop/electron/services/account-state-restorer.test.js、
 *  packages/api-publish-engine/test/api-key-manager-atomic-write.test.js），
 * 三份共用同一个缺陷，却各自被「修」过一次 —— 把用例超时 10s → 30s → 60s
 * （71e76a5e、1e22e68f）。缺陷是**无界的握手等待**，抬高超时只决定它多久之后才失败。
 *
 * 缺陷本体：`chunk.toString().includes('LOCKED')` 只看**单个 data 事件**。Node 的 stream
 * data 事件不代表对端 write 边界（子进程一次 WriteLine 完全可能被拆成 'LOC' + 'KED'），
 * 一旦跨块就永远匹配不到，握手 promise 永不 settle。
 *
 * 两条不变量：
 * 1) 握手按**累计缓冲**判定，跨块免疫；
 * 2) 握手与释放都带**显式预算**，超时错误里必须含阶段名、预算与子进程 stderr，
 *    让下一次红直接可读，而不是只剩一句 "Test timed out in 60000ms"。
 *
 * 用 CJS 导出：消费方一半是 vitest（ESM，走 default import 后解构），
 * 一半是 node --test（packages/api-publish-engine，require），互操作只在这一份实现上收敛。
 */
'use strict'

const { spawn } = require('node:child_process')

const LOCK_MARKER = 'LOCKED'

// 握手预算：CI 满载下 powershell.exe 冷启动是秒级，20s 已有数倍余量。
// 必须明显小于用例自身的超时上限，否则诊断信息会被框架超时抢先，等于没有。
const DEFAULT_HANDSHAKE_TIMEOUT_MS = Number(process.env.MP_WINDOWS_LOCK_HANDSHAKE_TIMEOUT_MS) || 20000
const DEFAULT_RELEASE_TIMEOUT_MS = Number(process.env.MP_WINDOWS_LOCK_RELEASE_TIMEOUT_MS) || 30000

/**
 * 累计式握手标记匹配器（纯对象，便于单测跨块行为）。
 * @returns {{feed: (chunk: any) => boolean, isLocked: () => boolean, text: () => string}}
 */
function createLockHandshake () {
  let buf = ''
  let locked = false
  return {
    feed (chunk) {
      buf += typeof chunk === 'string' ? chunk : String(chunk)
      if (!locked && buf.includes(LOCK_MARKER)) locked = true
      return locked
    },
    isLocked () {
      return locked
    },
    text () {
      return buf
    },
  }
}

function buildLockScript () {
  return [
    '& {',
    'param($file, $holdMs)',
    '$handle = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)',
    'try {',
    '[Console]::Out.WriteLine("' + LOCK_MARKER + '")',
    '[Console]::Out.Flush()',
    '[Threading.Thread]::Sleep([int]$holdMs)',
    '} finally { $handle.Dispose() }',
    '}',
  ].join('\n')
}

function withBudget (promise, timeoutMs, makeMessage) {
  let timer
  const budget = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(makeMessage(timeoutMs))), timeoutMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
  })
  return Promise.race([promise, budget]).finally(() => clearTimeout(timer))
}

/**
 * 在 filePath 上持有一个真实的 Windows 独占句柄 holdMs 毫秒。
 * @param {string} filePath
 * @param {number} holdMs
 * @param {{handshakeTimeoutMs?: number, releaseTimeoutMs?: number, spawnImpl?: Function}} [options]
 * @returns {Promise<{exitPromise: Promise<void>, release: () => Promise<void>}>}
 */
async function holdExclusiveWindowsFileLock (filePath, holdMs, options = {}) {
  const spawnImpl = options.spawnImpl || spawn
  const handshakeTimeoutMs = options.handshakeTimeoutMs || DEFAULT_HANDSHAKE_TIMEOUT_MS
  const releaseTimeoutMs = options.releaseTimeoutMs || DEFAULT_RELEASE_TIMEOUT_MS

  const child = spawnImpl('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    buildLockScript(),
    filePath,
    String(holdMs),
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

  let stderr = ''
  const handshake = createLockHandshake()

  let settleHandshake
  const handshakeSignal = new Promise((resolve, reject) => {
    settleHandshake = { resolve, reject }
  })
  let settleExit
  const exitPromise = new Promise((resolve, reject) => {
    settleExit = { resolve, reject }
  })
  // 子进程可能在任何人在 await 之前就非零退出（例如握手超时后我们已抛错返回）。
  // 先挂一个消费方避免 unhandledRejection；返回的仍是同一个 promise，真正 await 它的
  // 用例照样能拿到 rejection。
  exitPromise.catch(() => {})

  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  child.stdout.on('data', (chunk) => {
    if (handshake.feed(chunk)) settleHandshake.resolve()
  })
  child.once('error', (error) => {
    settleHandshake.reject(new Error('PowerShell failed to start: ' + (error && error.message)))
    settleExit.reject(error)
  })
  child.once('exit', (code) => {
    if (!handshake.isLocked()) {
      settleHandshake.reject(new Error('PowerShell exited before locking the file: ' + stderr))
    }
    if (code === 0) settleExit.resolve()
    else settleExit.reject(new Error('PowerShell file lock exited with code ' + code + ': ' + stderr))
  })

  try {
    await withBudget(
      handshakeSignal,
      handshakeTimeoutMs,
      (ms) => 'lock handshake did not report "' + LOCK_MARKER + '" within ' + ms + 'ms'
        + ' (stdout=' + JSON.stringify(handshake.text()) + ', stderr=' + JSON.stringify(stderr) + ')',
    )
  } catch (error) {
    try { child.kill() } catch (_) { /* 子进程已退出 */ }
    throw error
  }

  return {
    exitPromise,
    release: () => withBudget(
      exitPromise,
      releaseTimeoutMs,
      (ms) => 'file lock was not released within ' + ms + 'ms'
        + ' (holdMs=' + holdMs + ', stderr=' + JSON.stringify(stderr) + ')',
    ),
  }
}

module.exports = {
  holdExclusiveWindowsFileLock,
  createLockHandshake,
  LOCK_MARKER,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  DEFAULT_RELEASE_TIMEOUT_MS,
}
