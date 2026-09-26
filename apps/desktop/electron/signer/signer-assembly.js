'use strict'
/**
 * 签名页装配层（W3 design §1/§2，task 2.4 桌面侧接线）
 *
 * 职责：把 signer-page-manager（契约层）接到真实 Electron 环境——
 * - EXTRACTOR 模板按平台档案渲染（S2b 实证：webpackChunkks_fe_creator_platform / moduleId 29924 / 导出 PJ / 异步契约）
 * - 隐藏页按 平台+会话键 复用（多账号隔离，design §2.1 V-partition：默认独立 partition + cookie 注入，
 *   与 rpa-view-manager 的 persist:rpa-<platform>-<accountId> 登录态同源——cookie 由发布链从账号会话取来传入）
 * - executeJavaScript 超时降级（#2363 头条 CDP 挂起事故回归对：求签挂起不得无限门控）
 * - registerSignerAssembly：主进程装配入口——manager 装配 signFn、provider 桥注入、command 白名单、
 *   signer:prewarm IPC（renderer 不可触达任意 JS 求值，仅按白名单 command 预热页面）
 *
 * 合规红线：本模块零 HTTP 客户端；注入脚本只回传签名结果字符串，绝不回传函数体源码。
 */
const { EXTRACTOR_SCRIPT } = require('./signer-page-manager')

// S2b 实证平台档案（evidence/api-w3-kuaishou/spike-verdict.md §EXTRACTOR 重写形态）
const PROFILES = {
  kuaishou: {
    chunkGlobal: 'webpackChunkks_fe_creator_platform',
    moduleId: 29924,
    fnExport: 'PJ',
    creatorUrl: 'https://cp.kuaishou.com/',
    cookieDomain: 'cp.kuaishou.com',
    commands: ['kuaishou.ns-sig3-browser'],
  },
  xiaohongshu: {
    // S2b 止步裁决（design §6）：x-s 依赖外包签名服务，本波只留 provider 槽不激活链
    chunkGlobal: 'webpackChunk_xhs_creator',
    moduleId: -1,
    fnExport: 'default',
    creatorUrl: 'https://creator.xiaohongshu.com/',
    cookieDomain: 'creator.xiaohongshu.com',
    commands: ['xiaohongshu.x-s-browser'],
  },
}

/** 把 S2b 占位符渲染为平台专属一次性抽取脚本（值一律 JSON 序列化，防注入拼接） */
function buildExtractorScript (platform, payload) {
  const profile = PROFILES[platform]
  if (!profile) throw new Error(`signer-assembly: unknown platform "${platform}" (not in signer profiles)`)
  return EXTRACTOR_SCRIPT
    .replaceAll('__MP_SIGN_CHUNK_GLOBAL__', JSON.stringify(profile.chunkGlobal))
    .replaceAll('__MP_SIGN_MODULE_ID__', JSON.stringify(profile.moduleId))
    .replaceAll('__MP_SIGN_EXPORT__', JSON.stringify(profile.fnExport))
    .replaceAll('__MP_SIGN_PAYLOAD__', JSON.stringify(payload || {}))
}

/** 解析 Cookie 头串（name=value; name2=value2），domain 固定补平台创作者域 */
function parseCookieHeader (cookieHeader, domain) {
  if (typeof cookieHeader !== 'string' || !cookieHeader.trim()) return []
  return cookieHeader.split(';')
    .map(pair => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      if (eq <= 0) return null
      return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain, secure: true, url: 'https://' + domain + '/' }
    })
    .filter(Boolean)
}

function withTimeout (promise, ms, label, log) {
  let timer = null
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`signer-assembly: ${label} timeout (${ms}ms)`)), ms)
    if (timer && timer.unref) timer.unref()
  })
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer) })
}

/**
 * 创建装配实例（依赖注入便于离线契约测试）
 * @param {{BrowserWindow:Function, log?:object, timeoutMs?:number, onPageCreated?:(win)=>void}} deps
 */
function createSignerAssembly (deps) {
  const BrowserWindow = deps && deps.BrowserWindow
  if (typeof BrowserWindow !== 'function') {
    throw new Error('signer-assembly: createSignerAssembly requires deps.BrowserWindow')
  }
  const log = deps.log || console
  const timeoutMs = typeof deps.timeoutMs === 'number' && deps.timeoutMs > 0 ? deps.timeoutMs : 15000
  const pages = new Map() // `${platform}::${sessionKey}` -> { win, navigated }
  const cookieStore = new Map() // `${platform}::${accountId}` -> cookie 头串（仅存主进程内存，绝不随 IPC 回传）

  /** 发布链/预热侧绑定登录 cookie（in-proc 调用，不经 renderer IPC 回传） */
  function bindCookie (platform, sessionKey, cookieHeader) {
    if (!PROFILES[platform]) throw new Error(`signer-assembly: unknown platform "${platform}" (not in signer profiles)`)
    if (!sessionKey) throw new Error('signer-assembly: bindCookie requires sessionKey (accountId)')
    if (typeof cookieHeader !== 'string' || !cookieHeader.trim()) {
      cookieStore.delete(platform + '::' + sessionKey)
      return false
    }
    cookieStore.set(platform + '::' + sessionKey, cookieHeader)
    return true
  }

  async function getOrCreatePage (platform, sessionKey, cookieHeader) {
    const profile = PROFILES[platform]
    if (!profile) throw new Error(`signer-assembly: unknown platform "${platform}" (not in signer profiles)`)
    if (!sessionKey) {
      throw new Error(`signer-assembly: missing sessionKey for platform "${platform}"（多账号必须按账号隔离签名页，fail-closed）`)
    }
    const key = platform + '::' + sessionKey
    if (pages.has(key)) return pages.get(key)
    const win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    })
    const entry = { win, navigated: false }
    pages.set(key, entry)
    if (typeof deps.onPageCreated === 'function') deps.onPageCreated(win, key)
    // cookie 注入（登录态与 rpa-view-manager._restoreCookies 同源形态）
    const cookies = parseCookieHeader(cookieHeader, profile.cookieDomain)
    const cookieJar = win.webContents && win.webContents.session && win.webContents.session.cookies
    for (const c of cookies) {
      try { await cookieJar.set(c) } catch (e) {
        log.warn('Signer', 'cookie inject failed name=' + c.name + ' err=' + (e && e.message ? e.message : String(e)))
      }
    }
    // 导航一次（首个导航不被无限门控：dom-ready 不参与，超时即弃页，#2363 回归对）
    try {
      await withTimeout(win.loadURL(profile.creatorUrl), timeoutMs, 'loadURL ' + platform, log)
      entry.navigated = true
    } catch (err) {
      pages.delete(key)
      try { if (!win.isDestroyed()) win.destroy() } catch (_e) { /* ignore */ }
      throw err
    }
    return entry
  }

  /**
   * 求签执行体：page 就绪 → 注入渲染后抽取脚本 → 回传裸签名字符串。
   * 失败一律抛错（计入 manager 限流），绝不返回近似/本地签名兜底。
   */
  async function sign (ctx) {
    const { platform, sessionKey } = ctx || {}
    const cookieHeader = ctx.cookieHeader || cookieStore.get(platform + '::' + sessionKey) || ''
    const entry = await getOrCreatePage(platform, sessionKey, cookieHeader)
    const RESERVED = { command: 1, platform: 1, sessionKey: 1, cookieHeader: 1 }
    const payload = (ctx.payload && typeof ctx.payload === 'object')
      ? ctx.payload
      : Object.fromEntries(Object.entries(ctx || {}).filter(([k]) => !RESERVED[k]))
    const script = buildExtractorScript(platform, payload)
    let outcome
    try {
      outcome = await withTimeout(Promise.resolve(entry.win.webContents.executeJavaScript(script)), timeoutMs, 'extractor ' + platform, log)
    } catch (err) {
      // 挂起/异常页面直接废弃，下次求签重建（自愈），防止坏页面被复用
      pages.delete(platform + '::' + sessionKey)
      try { if (!entry.win.isDestroyed()) entry.win.destroy() } catch (_e) { /* ignore */ }
      throw err
    }
    if (!outcome || outcome.ok !== true || typeof outcome.signature !== 'string' || !outcome.signature) {
      throw new Error(`signer-assembly: extractor failed platform=${platform} reason=${(outcome && outcome.reason) || 'unknown'}`)
    }
    return outcome.signature
  }

  function prewarm (platform, sessionKey, cookieHeader) {
    return getOrCreatePage(platform, sessionKey, cookieHeader).then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, error: err && err.message ? err.message : String(err) }))
  }

  function dispose () {
    for (const entry of pages.values()) {
      try { if (entry.win && !entry.win.isDestroyed()) entry.win.destroy() } catch (_e) { /* ignore */ }
    }
    pages.clear()
    cookieStore.clear()
  }

  function pageCount () { return pages.size }

  return { sign, prewarm, bindCookie, dispose, pageCount, getOrCreatePage }
}

// verified 位依据 spike 实证：S2b 仅对 kuaishou 做 Tier-A GO（活体终判），
// xiaohongshu 止步（design §6：x-s 依赖外包签名服务，本波只留 provider 槽不激活链）。
// 未实证平台绝不置 verified——否则会被放行触达未取证活页。
const BRIDGE_COMMANDS = [
  ['kuaishou.ns-sig3-browser', 'kuaishou', true],
  ['xiaohongshu.x-s-browser', 'xiaohongshu', false],
]

/**
 * 主进程装配入口（bootstrap 在 app ready 后调用）：
 * manager ↔ assembly ↔ provider ↔ ipcMain 四方接线。
 * verified 标记依据 S2b 活体终判（Tier-A GO）；后续拦截法比对不一致会经 interceptCompare 降级。
 */
function registerSignerAssembly (deps) {
  const manager = deps.manager
  const provider = deps.provider
  const ipcMain = deps.ipcMain
  const log = deps.log || console
  if (!manager || typeof manager.registerCommand !== 'function' || typeof manager._setSignFn !== 'function') {
    throw new Error('signer-assembly: registerSignerAssembly requires manager (registerCommand/_setSignFn)')
  }
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('signer-assembly: registerSignerAssembly requires ipcMain with handle()')
  }
  // Gate 17（P1-14）：prewarm 会触发隐藏页创建（活的副作用面），必须显式校验 sender 来源，
  // 不依赖 controlledIpcMain 咽喉点注入（静态不可判定即违规，缺依赖 fail-closed）。
  const isTrustedSender = deps.isTrustedSender
  if (typeof isTrustedSender !== 'function') {
    throw new Error('signer-assembly: registerSignerAssembly requires isTrustedSender(event)')
  }
  const assembly = deps.assembly
  if (!assembly || typeof assembly.sign !== 'function' || typeof assembly.prewarm !== 'function') {
    throw new Error('signer-assembly: registerSignerAssembly requires assembly ({ sign, prewarm })')
  }

  // provider 桥（引擎侧）：bridge(signCommand, payload) 由发布链携带 {platform, sessionKey, cookie} 调用
  if (provider && typeof provider.setBridge === 'function') {
    provider.setBridge((signCommand, payload) => manager.invokeSign(signCommand, payload))
  }
  for (const [command, platform, verified] of BRIDGE_COMMANDS) {
    manager.registerCommand(command, platform)
    if (provider && typeof provider.registerCommands === 'function') {
      provider.registerCommands([command], platform)
    }
    // 仅 spike 实证通过的命令置 verified（manager + provider 两侧同步，路径 A/B 语义一致）；
    // 未实证（如小红书止步）保持 unverified：manager.invokeSign / provider.sign 均 fail-closed 拒绝，
    // 不创建隐藏页、不触达未激活平台活页。
    if (verified) {
      manager.markVerified(command)
      if (provider && typeof provider.verify === 'function') provider.verify(command)
    }
  }
  manager._setSignFn((command, payload) => {
    const platform = (BRIDGE_COMMANDS.find(([c]) => c === command) || [])[1]
    if (!platform) throw new Error(`signer-assembly: signFn received unlisted command "${command}"`)
    const accountId = payload && payload.accountId
    const ctx = { command, platform, sessionKey: accountId, payload }
    return assembly.sign(ctx)
  })
  manager.registerIpcHandlers(ipcMain)
  ipcMain.handle('signer:prewarm', async (event, args) => {
    if (!isTrustedSender(event)) {
      log.warn('Signer', 'signer:prewarm rejected: untrusted sender')
      return { code: -2, message: 'signer:prewarm: 未授权的调用来源 (untrusted sender)' }
    }
    const platform = args && args.platform
    const sessionKey = args && args.sessionKey
    if (!PROFILES[platform]) return { code: -2, message: 'signer:prewarm: unknown platform' }
    if (!sessionKey) return { code: -2, message: 'signer:prewarm: missing sessionKey' }
    try {
      await assembly.getOrCreatePage(platform, sessionKey, '')
      return { code: 0, data: { ok: true } }
    } catch (err) {
      return { code: -1, message: err && err.message ? err.message : String(err) }
    }
  })
  log.info('Signer', 'signer assembly registered (commands: ' + BRIDGE_COMMANDS.map(([c]) => c).join(', ') + ')')
  return { manager, provider, assembly }
}

module.exports = { PROFILES, buildExtractorScript, parseCookieHeader, createSignerAssembly, registerSignerAssembly, BRIDGE_COMMANDS }
