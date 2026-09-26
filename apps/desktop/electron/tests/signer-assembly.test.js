// @vitest-environment node
/**
 * W3 task 2.4 红测：签名页装配层（signer-assembly）
 * 契约：EXTRACTOR 占位符渲染 / 隐藏页按平台+会话键复用 / cookie 注入 /
 * 导航一次 / executeJavaScript 超时降级（首个导航不被无限门控，对齐 #2363 事故回归对） /
 * ok:false 逐因失败 / 会话键缺失 fail-closed / provider 桥接线。
 * RED 阶段：signer-assembly 尚不存在，require 抛 Cannot find module。
 */
const path = require('path')
const ASSEMBLY_MODULE = path.join(__dirname, '..', 'signer', 'signer-assembly')

describe('signer-assembly: buildExtractorScript 占位符渲染', () => {
  const { buildExtractorScript } = require(ASSEMBLY_MODULE)
  it('全部占位符被 JSON 值替换，渲染后不残留占位名', () => {
    const script = buildExtractorScript('kuaishou', { url: '/rest/x', type: 'json', params: {} })
    expect(script).not.toMatch(/__MP_SIGN_[A-Z_]+__/)
    expect(script).toMatch('"webpackChunkks_fe_creator_platform"')
    expect(script).toMatch('29924')
    expect(script).toMatch('"PJ"')
  })
  it('payload 逐字段序列化进脚本（url/type/params）', () => {
    const script = buildExtractorScript('kuaishou', { url: '/rest/cp/works/v2/video/pc/submit', type: 'json', params: { caption: 'hi' } })
    expect(script).toMatch('"/rest/cp/works/v2/video/pc/submit"')
    expect(script).toMatch('"caption"')
  })
  it('渲染结果仍是 S2b 异步三元 push 形态（继承模板约束）', () => {
    const script = buildExtractorScript('kuaishou', { url: '/x', type: 'json', params: {} })
    expect(script).toMatch(/async function/)
    expect(script).toMatch(/push\(\[[^\]]*\],\s*\{\},\s*function/)
    expect(script).not.toMatch(/Function\s*\.\s*prototype\s*\.\s*toString/)
  })
  it('未知平台 fail-closed', () => {
    expect(() => buildExtractorScript('weixin', { url: '/x' })).toThrow(/unknown platform|未知平台/)
  })
})

function makeAssembly (overlays = {}) {
  const { createSignerAssembly } = require(ASSEMBLY_MODULE)
  const instances = []
  const cookieSets = []
  class FakeWindow {
    constructor (opts) {
      this.opts = opts
      this.destroyed = false
      this.loaded = []
      this.execCount = 0
      this.execBehavior = { ok: true, signature: 'SIG-ABC-56CHARS' }
      this.lastCode = null
      this.webContents = {
        session: { cookies: { get: async () => [], set: async (a) => { cookieSets.push(a) } } },
        executeJavaScript: (code) => {
          this.lastCode = code
          this.execCount++
          const b = this.execBehavior
          if (b && typeof b.then === 'function') return b
          return Promise.resolve(b)
        },
        on: () => {},
      }
      instances.push(this)
    }
    async loadURL (url) { this.loaded.push(url); return undefined }
    destroy () { this.destroyed = true }
    isDestroyed () { return this.destroyed }
  }
  const noop = () => {}
  const asm = createSignerAssembly(Object.assign({
    BrowserWindow: FakeWindow,
    log: { info: noop, warn: noop, error: noop },
    timeoutMs: 50,
  }, overlays))
  asm.__instances = instances
  asm.__cookieSets = cookieSets
  return asm
}

const KS_CTX = {
  command: 'kuaishou.ns-sig3-browser',
  platform: 'kuaishou',
  sessionKey: 'acct-1',
  cookieHeader: 'kuaishou.web.cp.api_ph=abc123; passToken=xyz',
  payload: { url: '/rest/cp/works/v2/video/pc/submit', type: 'json', params: { caption: 't' } },
}

describe('signer-assembly: 隐藏页求签（正常路径）', () => {
  it('首次求签建隐藏窗口、注入 cookie、导航一次、回传裸签名', async () => {
    const asm = makeAssembly()
    const sig = await asm.sign(KS_CTX)
    expect(sig).toBe('SIG-ABC-56CHARS')
    expect(asm.__instances.length).toBe(1)
    const win = asm.__instances[0]
    expect(win.opts.show).toBe(false)
    expect(win.loaded.length).toBe(1)
    expect(win.lastCode).toMatch(/webpackChunkks_fe_creator_platform/)
  })
  it('同平台同会话键二次求签复用页面（不再导航）', async () => {
    const asm = makeAssembly()
    await asm.sign(KS_CTX)
    await asm.sign(KS_CTX)
    expect(asm.__instances.length).toBe(1)
    expect(asm.__instances[0].loaded.length).toBe(1)
    expect(asm.__instances[0].execCount).toBe(2)
  })
  it('不同账号（会话键）各自独立页面', async () => {
    const asm = makeAssembly()
    await asm.sign({ ...KS_CTX, sessionKey: 'acct-1' })
    await asm.sign({ ...KS_CTX, sessionKey: 'acct-2' })
    expect(asm.__instances.length).toBe(2)
  })
  it('cookie 头被解析并注入页面 session（ph 与 passToken 都在）', async () => {
    const asm = makeAssembly()
    await asm.sign(KS_CTX)
    const names = asm.__cookieSets.map(c => c.name)
    expect(names).toContain('kuaishou.web.cp.api_ph')
    expect(names).toContain('passToken')
  })
  it('bindCookie 后求签不需携带 cookieHeader（cookie 只存主进程，脚本不含 cookie 明文）', async () => {
    const asm = makeAssembly()
    expect(asm.bindCookie('kuaishou', 'acct-bind', 'kuaishou.web.cp.api_ph=zzz9')).toBe(true)
    const ctx = { ...KS_CTX, sessionKey: 'acct-bind' }
    delete ctx.cookieHeader
    const sig = await asm.sign(ctx)
    expect(sig).toBe('SIG-ABC-56CHARS')
    expect(asm.__cookieSets.map(c => c.value)).toContain('zzz9')
    expect(asm.__instances[0].lastCode).not.toMatch('zzz9')
  })
  it('未绑定 cookie 且 ctx 未携带 → 仍建页但注入零条 cookie（登录态缺失由平台侧失败暴露）', async () => {
    const asm = makeAssembly()
    const ctx = { ...KS_CTX, sessionKey: 'acct-nocookie' }
    delete ctx.cookieHeader
    await asm.sign(ctx)
    expect(asm.__cookieSets.length).toBe(0)
  })
})

describe('signer-assembly: 异常面（fail-closed / 超时降级）', () => {
  it('抽取器返回 ok:false → 抛错含 reason，不回退假签名', async () => {
    const asm = makeAssembly({
      onPageCreated: (win) => { win.execBehavior = { ok: false, reason: 'no-webpack-chunk' } },
    })
    await expect(asm.sign({ ...KS_CTX, sessionKey: 'acct-fail' })).rejects.toThrow(/no-webpack-chunk|抽取失败/)
  })
  it('executeJavaScript 挂起 → 超时抛错（首个导航不被无限门控，#2363 回归对）', async () => {
    const hanging = { then: (resolve, reject) => { void resolve; void reject /* 永不 settle */ } }
    const asm = makeAssembly({ timeoutMs: 30, onPageCreated: (win) => { win.execBehavior = hanging } })
    await expect(asm.sign({ ...KS_CTX, sessionKey: 'acct-hang' })).rejects.toThrow(/timeout|超时/)
  })
  it('缺 sessionKey → fail-closed 抛错（不共享单例、不静默）', async () => {
    const asm = makeAssembly()
    await expect(asm.sign({ ...KS_CTX, sessionKey: undefined })).rejects.toThrow(/sessionKey|会话/)
  })
  it('未知平台 ctx → fail-closed', async () => {
    const asm = makeAssembly()
    await expect(asm.sign({ ...KS_CTX, platform: 'weixin', command: 'weixin.sig' })).rejects.toThrow(/unknown platform|未知平台/)
  })
})

describe('signer-assembly: 主进程接线 registerSignerAssembly', () => {
  it('注入 provider 桥并注册平台 command 白名单', () => {
    const { registerSignerAssembly } = require(ASSEMBLY_MODULE)
    const calls = []
    const provider = {
      setBridge: (fn) => calls.push(['setBridge', typeof fn]),
      registerCommands: (cmds, platform) => calls.push(['registerCommands', cmds.join(','), platform]),
      verify: (c) => calls.push(['providerVerify', c]),
    }
    const manager = {
      registerIpcHandlers: (ipc) => { void ipc; calls.push(['ipc']) },
      registerCommand: (c, p) => calls.push(['managerCommand', c, p]),
      markVerified: (c) => calls.push(['verified', c]),
      _setSignFn: (fn) => calls.push(['signFn', typeof fn]),
    }
    const handlers = {}
    registerSignerAssembly({
      manager,
      provider,
      assembly: { sign: async () => 's', prewarm: async () => ({ ok: true }) },
      ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; calls.push(['handle', ch]) } },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    })
    expect(calls).toEqual(expect.arrayContaining([
      ['managerCommand', 'kuaishou.ns-sig3-browser', 'kuaishou'],
      ['managerCommand', 'xiaohongshu.x-s-browser', 'xiaohongshu'],
      ['registerCommands', 'kuaishou.ns-sig3-browser', 'kuaishou'],
      ['registerCommands', 'xiaohongshu.x-s-browser', 'xiaohongshu'],
      ['setBridge', 'function'],
      ['signFn', 'function'],
      ['ipc'],
      ['handle', 'signer:prewarm'],
    ]))
    // S2b 仅实证 kuaishou（Tier-A GO）→ 只有 kuaishou 置 verified（manager + provider 两侧同步）。
    expect(calls).toContainEqual(['verified', 'kuaishou.ns-sig3-browser'])
    expect(calls).toContainEqual(['providerVerify', 'kuaishou.ns-sig3-browser'])
    // 小红书止步（design §6）：只注册 provider 槽位，绝不 verified —— 否则 renderer 经 signer:invoke
    // 会让 manager 放行、创建隐藏页并导航未激活平台活页（触达未取证域，越红线）。
    expect(calls).not.toContainEqual(['verified', 'xiaohongshu.x-s-browser'])
    expect(calls).not.toContainEqual(['providerVerify', 'xiaohongshu.x-s-browser'])
  })
})
