// @vitest-environment node
/**
 * W3 task 2.3 红测（Electron 集成，本机临时假 webpack 页面）
 * signer-page-manager 契约：域锁 / 抽取器无函数体泄露 / 拦截比对 / 限流降级 / IPC 白名单 / 懒建单例
 * RED 阶段：signer-page-manager 实现尚不存在，require 抛 Cannot find module。
 */
const path = require('path')
const SIGNER_MODULE = path.join(__dirname, '..', 'signer', 'signer-page-manager')

describe('signer-page-manager: 域锁 isAllowedNavigation', () => {
  const { isAllowedNavigation, DOMAIN_WHITELIST } = require(SIGNER_MODULE)
  it('放行快手创作者域', () => {
    expect(isAllowedNavigation('https://cp.kuaishou.com/profile', 'kuaishou')).toBe(true)
  })
  it('放行小红书创作域', () => {
    expect(isAllowedNavigation('https://creator.xiaohongshu.com/publish', 'xiaohongshu')).toBe(true)
  })
  it('拒绝外部恶意域', () => {
    expect(isAllowedNavigation('https://evil.com/steal', 'kuaishou')).toBe(false)
  })
  it('拒绝未注册平台', () => {
    expect(isAllowedNavigation('https://cp.kuaishou.com/', 'weixin')).toBe(false)
  })
  it('白名单只含已知平台键', () => {
    expect(Object.keys(DOMAIN_WHITELIST).sort()).toEqual(['kuaishou', 'xiaohongshu'])
  })
})

describe('signer-page-manager: 抽取器脚本不回传函数体', () => {
  const { EXTRACTOR_SCRIPT } = require(SIGNER_MODULE)
  it('不含 Function.prototype.toString', () => {
    expect(EXTRACTOR_SCRIPT).not.toMatch(/Function\s*\.\s*prototype\s*\.\s*toString/)
  })
  it('不含 JSON.stringify(fn) 形式的整体序列化', () => {
    expect(EXTRACTOR_SCRIPT).not.toMatch(/JSON\s*\.\s*stringify\s*\(\s*fn\b/)
  })
  it('S2b 异步契约：async IIFE + await 调用签名器', () => {
    expect(EXTRACTOR_SCRIPT).toMatch(/async function/)
    expect(EXTRACTOR_SCRIPT).toMatch(/await /)
  })
  it('S2b require 捕获用 webpack5 三元 push（runtime 槽，非二元）', () => {
    expect(EXTRACTOR_SCRIPT).toMatch(/push\(\[[^\]]*\],\s*\{\},\s*function/)
  })
  it('S2b 全局名经占位符注入（不硬编码旧 webpackChunk）', () => {
    expect(EXTRACTOR_SCRIPT).toMatch(/window\[__MP_SIGN_CHUNK_GLOBAL__\]/)
    expect(EXTRACTOR_SCRIPT).not.toMatch(/webpackChunk_kuaishou_pc/)
  })
  it('S2b 剥离 __NS_sig3= 前缀返回裸签名值', () => {
    expect(EXTRACTOR_SCRIPT).toMatch(/__NS_sig3=/)
  })
})

function makeManager () {
  const { createSignerPageManager } = require(SIGNER_MODULE)
  const instances = []
  class FakeBrowserWindow {
    constructor (opts) { this.opts = opts; this.destroyed = false; instances.push(this) }
    once () {}
    on () {}
    async loadURL (url) { this.lastUrl = url }
    async executeJavaScript (code) { this.lastCode = code; return undefined }
    destroy () { this.destroyed = true }
    isDestroyed () { return this.destroyed }
  }
  const manager = createSignerPageManager({ BrowserWindow: FakeBrowserWindow })
  return { manager, instances }
}

describe('signer-page-manager: getOrCreatePage 懒建单例', () => {
  const { createSignerPageManager } = require(SIGNER_MODULE)
  expect(typeof createSignerPageManager).toBe('function')
  it('首次调用才建窗，二次复用同一实例', async () => {
    const { manager, instances } = makeManager()
    expect(instances.length).toBe(0)
    const p1 = await manager.getOrCreatePage('kuaishou')
    const p2 = await manager.getOrCreatePage('kuaishou')
    expect(instances.length).toBe(1)
    expect(p1).toBe(p2)
  })
  it('不同平台各自独立实例', async () => {
    const { manager, instances } = makeManager()
    await manager.getOrCreatePage('kuaishou')
    await manager.getOrCreatePage('xiaohongshu')
    expect(instances.length).toBe(2)
  })
})

describe('signer-page-manager: IPC command 白名单', () => {
  it('注册 signer:invoke / signer:status', () => {
    const { manager } = makeManager()
    const handlers = {}
    manager.registerIpcHandlers({ handle: (ch, fn) => { handlers[ch] = fn } })
    expect(Object.keys(handlers).sort()).toEqual(['signer:invoke', 'signer:status'])
  })
  it('白名单外 command 被拒绝', async () => {
    const { manager } = makeManager()
    const handlers = {}
    manager.registerIpcHandlers({ handle: (ch, fn) => { handlers[ch] = fn } })
    const res = await handlers['signer:invoke']({}, { command: 'arbitrary.evil', payload: {} })
    expect(res.code).not.toBe(0)
  })
  it('已注册 verified command 通过求签返回 code:0', async () => {
    const { manager } = makeManager()
    const handlers = {}
    manager.registerIpcHandlers({ handle: (ch, fn) => { handlers[ch] = fn } })
    manager.registerCommand('kuaishou.ns-sig3-browser', 'kuaishou')
    manager.markVerified('kuaishou.ns-sig3-browser')
    manager._setSignFn(async () => 'sig-abc-123')
    const res = await handlers['signer:invoke']({}, { command: 'kuaishou.ns-sig3-browser', payload: { body: {} } })
    expect(res.code).toBe(0)
    expect(res.data).toBe('sig-abc-123')
  })
})

describe('signer-page-manager: 拦截法双验证', () => {
  it('本地复算 == 页面真发值 → verified', async () => {
    const { manager } = makeManager()
    manager.registerCommand('kuaishou.ns-sig3-browser', 'kuaishou')
    const verdict = await manager.interceptCompare('kuaishou', {
      payload: { body: { x: 1 } }, pageSignature: 'AAAA', localSignature: 'AAAA',
    })
    expect(verdict).toBe('verified')
  })
  it('不一致 → unverifiable', async () => {
    const { manager } = makeManager()
    manager.registerCommand('kuaishou.ns-sig3-browser', 'kuaishou')
    const verdict = await manager.interceptCompare('kuaishou', {
      payload: { body: { x: 1 } }, pageSignature: 'AAAA', localSignature: 'BBBB',
    })
    expect(verdict).toBe('unverifiable')
  })
})

describe('signer-page-manager: 限流第 4 次失败置 degraded', () => {
  it('连续 3 次失败不降级，第 4 次触发 degraded 后拒绝', async () => {
    const { manager } = makeManager()
    manager.registerCommand('kuaishou.ns-sig3-browser', 'kuaishou')
    manager.markVerified('kuaishou.ns-sig3-browser')
    manager._setSignFn(async () => { throw new Error('page hang') })
    await expect(manager.invokeSign('kuaishou.ns-sig3-browser', {})).rejects.toThrow(/page hang/)
    await expect(manager.invokeSign('kuaishou.ns-sig3-browser', {})).rejects.toThrow(/page hang/)
    await expect(manager.invokeSign('kuaishou.ns-sig3-browser', {})).rejects.toThrow(/page hang/)
    await expect(manager.invokeSign('kuaishou.ns-sig3-browser', {})).rejects.toThrow(/degraded|降级/)
    expect(manager.status('kuaishou').degraded).toBe(true)
  })
})
