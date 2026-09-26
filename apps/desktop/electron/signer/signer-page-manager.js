'use strict'
/**
 * 签名页管理器（W3 design §2 签名页基建，electron main 进程侧）
 * 职责：隐藏 BrowserWindow 承载平台创作者页面（Tier-B 签名页），懒建按平台复用；
 * 域锁；webpackChunk push 劫持抽取器（只回传签名结果，绝不回传函数体源码）；
 * 拦截法一致性双验证；IPC 白名单 signer:invoke/signer:status；限流降级。
 * 合规红线：零 HTTP 客户端；注入脚本禁 Function.prototype.toString / JSON.stringify(fn)。
 * 依赖注入 createSignerPageManager({ BrowserWindow }) 便于离线契约测试。
 */

const DOMAIN_WHITELIST = {
  kuaishou: ['cp.kuaishou.com', 'www.kuaishou.com'],
  xiaohongshu: ['creator.xiaohongshu.com', 'edith.xiaohongshu.com'],
}

const MAX_FAILS_BEFORE_DEGRADED = 3

function isAllowedNavigation (url, platform) {
  const hosts = DOMAIN_WHITELIST[platform]
  if (!hosts || typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return hosts.includes(parsed.hostname)
  } catch (_e) {
    return false
  }
}

// S2b 实证形态：webpack5 三元 push（require 捕获在 runtime 槽）；导出签名为 async，入 {url,type,params}，
// 产出 `__NS_sig3=<值>` 串 → 剥前缀得裸签名值。禁止回传函数体源码（无 toString/JSON.stringify(fn)）。
const EXTRACTOR_SCRIPT = `(async function () {
  var chunk = window[__MP_SIGN_CHUNK_GLOBAL__];
  if (!chunk || !Array.isArray(chunk) || typeof chunk.push !== 'function') return { ok: false, reason: 'no-webpack-chunk' };
  var captured = null, grabErr = null;
  try {
    chunk.push([['__mp_sig_probe__'], {}, function (req) { try { captured = req(__MP_SIGN_MODULE_ID__); } catch (e) { grabErr = String((e && e.message) || e); } }]);
  } catch (e) { return { ok: false, reason: 'push-threw' }; }
  if (!captured) return { ok: false, reason: grabErr ? 'require-threw' : 'require-miss' };
  if (typeof captured[__MP_SIGN_EXPORT__] !== 'function') return { ok: false, reason: 'sign-fn-missing' };
  var out;
  try { out = await captured[__MP_SIGN_EXPORT__](__MP_SIGN_PAYLOAD__); } catch (e) { return { ok: false, reason: 'sign-threw' }; }
  if (typeof out !== 'string' || !out) return { ok: false, reason: 'sign-not-string' };
  var m = /__NS_sig3=([^&]+)/.exec(out);
  var sig = m ? m[1] : out;
  if (!sig) return { ok: false, reason: 'sig-empty' };
  return { ok: true, signature: sig };
})()`

function createSignerPageManager (deps) {
  const BrowserWindow = deps && deps.BrowserWindow
  if (typeof BrowserWindow !== 'function') {
    throw new Error('signer-page-manager: createSignerPageManager requires deps.BrowserWindow')
  }

  const pages = new Map()
  const commands = new Map()
  const platformState = new Map()
  let signFn = null

  function getState (platform) {
    if (!platformState.has(platform)) platformState.set(platform, { failCount: 0, degraded: false })
    return platformState.get(platform)
  }

  function attachDomainLock (platform, page) {
    const wc = page && page.webContents
    if (!wc || typeof wc.on !== 'function') return
    const deny = (event, navUrl) => {
      if (!isAllowedNavigation(navUrl, platform)) {
        if (typeof event.preventDefault === 'function') event.preventDefault()
      }
    }
    wc.on('will-navigate', deny)
  }

  async function getOrCreatePage (platform) {
    if (!DOMAIN_WHITELIST[platform]) {
      throw new Error(`signer-page-manager: unknown platform "${platform}" (not in domain whitelist)`)
    }
    if (pages.has(platform)) return pages.get(platform)
    const page = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true },
    })
    attachDomainLock(platform, page)
    pages.set(platform, page)
    return page
  }

  function registerCommand (command, platform) {
    if (!DOMAIN_WHITELIST[platform]) {
      throw new Error(`signer-page-manager: registerCommand unknown platform "${platform}"`)
    }
    commands.set(command, { platform, verified: false })
  }

  function markVerified (command) {
    const entry = commands.get(command)
    if (!entry) throw new Error(`signer-page-manager: cannot verify unregistered command "${command}"`)
    entry.verified = true
  }

  function unverifyCommand (command) {
    const entry = commands.get(command)
    if (entry) entry.verified = false
  }

  function _setSignFn (fn) {
    if (typeof fn !== 'function') throw new Error('signer-page-manager: _setSignFn requires a function')
    signFn = fn
  }

  async function invokeSign (command, payload) {
    const entry = commands.get(command)
    if (!entry) {
      throw new Error(`signer-page-manager: command "${command}" not registered (fail-closed)`)
    }
    const state = getState(entry.platform)
    if (state.degraded) {
      throw new Error(`signer-page-manager: platform "${entry.platform}" degraded (限流降级), await self-heal or resetState`)
    }
    if (!entry.verified) {
      throw new Error(`signer-page-manager: command "${command}" unverified (拦截双验证未通过)`)
    }
    if (!signFn) {
      throw new Error('signer-page-manager: no sign function wired (装配层未接线)')
    }
    try {
      const result = await signFn(command, payload)
      if (typeof result !== 'string' || result.length === 0) {
        throw new Error('signer-page-manager: sign result must be a non-empty string')
      }
      state.failCount = 0
      return result
    } catch (err) {
      state.failCount++
      if (state.failCount >= MAX_FAILS_BEFORE_DEGRADED) state.degraded = true
      throw err
    }
  }

  async function interceptCompare (platform, ctx) {
    const c = ctx || {}
    const match = typeof c.pageSignature === 'string'
      && typeof c.localSignature === 'string'
      && c.pageSignature.length > 0
      && c.pageSignature === c.localSignature
    for (const entry of commands.values()) {
      if (entry.platform !== platform) continue
      entry.verified = match
    }
    return match ? 'verified' : 'unverifiable'
  }

  function status (platform) {
    const st = getState(platform)
    return { degraded: st.degraded, failCount: st.failCount }
  }

  function resetState (platform) {
    platformState.delete(platform)
  }

  function registerIpcHandlers (ipcMain) {
    if (!ipcMain || typeof ipcMain.handle !== 'function') {
      throw new Error('signer-page-manager: registerIpcHandlers requires ipcMain with handle()')
    }
    ipcMain.handle('signer:invoke', async (_event, args) => {
      const command = args && args.command
      const payload = args && args.payload
      if (!command || !commands.has(command)) {
        return { code: -2, message: `signer:invoke: command not whitelisted (${command})` }
      }
      try {
        const sig = await invokeSign(command, payload)
        return { code: 0, data: sig }
      } catch (err) {
        return { code: -1, message: err && err.message ? err.message : String(err) }
      }
    })
    ipcMain.handle('signer:status', async (_event, args) => {
      const platform = args && args.platform
      if (!platform || !DOMAIN_WHITELIST[platform]) return { code: -2, message: 'signer:status: unknown platform' }
      return { code: 0, data: status(platform) }
    })
  }

  function dispose () {
    for (const page of pages.values()) {
      try { if (page && !page.isDestroyed()) page.destroy() } catch (_e) { /* ignore */ }
    }
    pages.clear()
  }

  return {
    getOrCreatePage,
    registerCommand,
    markVerified,
    unverifyCommand,
    invokeSign,
    interceptCompare,
    status,
    resetState,
    registerIpcHandlers,
    attachDomainLock,
    dispose,
    _setSignFn,
  }
}

module.exports = { createSignerPageManager, DOMAIN_WHITELIST, isAllowedNavigation, EXTRACTOR_SCRIPT }
