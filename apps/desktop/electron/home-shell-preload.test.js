// @ts-check
/**
 * home-shell-preload.js 双判据守护测试（PRD-TAB-INDEPENDENT-HOME-2026-09-22 §5 S1/S2）
 *
 * 守护不变式：完整 electronAPI 只有在
 *   ① 主进程注入了 --mp-home-shell-url=<期望地址>（视图由主进程以精确匹配地址创建）
 *   ② 当前文档 location 与期望地址同源，且 search 仍含 mp-home-shell=1
 * 同时成立时才暴露；文档被重定向到外站（preload 重新执行但 href 不再匹配）时必须降级为
 * 仅受限 monitor 桥，绝不泄露业务 API。
 */
import { createRequire } from 'node:module'

__enableElectronMock()

const PRELOAD_PATH = './home-shell-preload.js'
const API_ARG_PREFIX = '--mp-home-shell-url='

// home-shell-preload.js 内部用裸 require('./preload/index.js')（Node CJS 缓存，
// vi.resetModules 清不掉）；不逐次清除会让第二次正向加载看不到 electronAPI。
// 生产环境每个 WebContentsView 都是 fresh 渲染进程，不存在此问题，纯属测试隔离。
const _req = createRequire(import.meta.url)

/** 在可控 location / argv 下加载一次 preload（每用例独立模块实例） */
async function loadPreload ({ href, argv = [] }) {
  vi.resetModules()
  try {
    delete _req.cache[_req.resolve('./home-shell-preload.js')]
    delete _req.cache[_req.resolve('./preload/index.js')]
  } catch (_) { /* 模块不在 CJS 缓存（走 vite pipeline）时忽略 */ }
  const originalLocation = window.location
  try {
    // jsdom 的 window.location.href 不跟随“把 location 替换为 URL 对象”（URL.href 是
    // 原型 getter），直接赋值又会被 jsdom Location 拒绝——用可写数据属性固定文档地址。
    const loc = new URL(href)
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: loc,
    })
    window.location.href = href
    const argvBackup = process.argv
    process.argv = [argv[0] || 'electron', ...argv]
    try {
      await import(PRELOAD_PATH)
    } finally {
      process.argv = argvBackup
    }
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  }
}

// test-setup 的 contextBridge.exposeInMainWorld 是普通空函数（无调用记录），
// 参照 electron/preload.test.js 的既有模式临时替换为 vi.fn 收集暴露的世界名，测后还原。
let _originalExpose

function exposedWorlds () {
  return (__electronMock.contextBridge.exposeInMainWorld.mock || []).calls.map(c => c[0])
}

describe('home-shell-preload 暴露面守护', () => {
  beforeEach(() => {
    vi.resetModules()
    __resetElectronMock()
    _originalExpose = __electronMock.contextBridge.exposeInMainWorld
    __electronMock.contextBridge.exposeInMainWorld = vi.fn()
  })

  afterEach(() => {
    if (_originalExpose) {
      __electronMock.contextBridge.exposeInMainWorld = _originalExpose
      _originalExpose = null
    }
  })

  it('打包态：href 与期望地址精确一致 → 暴露 electronAPI + monitor 桥', async () => {
    const expected = 'file:///D:/app/dist/index.html?mp-home-shell=1'
    await loadPreload({ href: expected, argv: [API_ARG_PREFIX + expected] })
    const worlds = exposedWorlds()
    expect(worlds).toContain('multiPublishMonitor')
    expect(worlds).toContain('electronAPI')
  })

  it('开发态：hash 变化后（同 origin + 参数仍在）→ 仍暴露 electronAPI', async () => {
    const expected = 'http://127.0.0.1:5174/?mp-home-shell=1'
    await loadPreload({ href: 'http://127.0.0.1:5174/?mp-home-shell=1#/accounts', argv: [API_ARG_PREFIX + expected] })
    expect(exposedWorlds()).toContain('electronAPI')
  })

  it('未注入期望地址参数（普通视图误挂本 preload）→ 只暴露 monitor 桥，不暴露 electronAPI', async () => {
    await loadPreload({ href: 'file:///D:/app/dist/index.html?mp-home-shell=1', argv: [] })
    const worlds = exposedWorlds()
    expect(worlds).toContain('multiPublishMonitor')
    expect(worlds).not.toContain('electronAPI')
  })

  it('页面重定向到外站（href 不再同源，argv 残留不影响）→ 不暴露 electronAPI', async () => {
    const expected = 'file:///D:/app/dist/index.html?mp-home-shell=1'
    await loadPreload({ href: 'https://evil.example.com/?mp-home-shell=1', argv: [API_ARG_PREFIX + expected] })
    expect(exposedWorlds()).not.toContain('electronAPI')
  })

  it('同目录但参数被去除（外站复用路径）→ 不暴露 electronAPI', async () => {
    const expected = 'file:///D:/app/dist/index.html?mp-home-shell=1'
    await loadPreload({ href: 'file:///D:/app/dist/index.html', argv: [API_ARG_PREFIX + expected] })
    expect(exposedWorlds()).not.toContain('electronAPI')
  })

  it('期望地址与当前 href 同源但不同查询值（mp-home-shell=0）→ 不暴露', async () => {
    const expected = 'file:///D:/app/dist/index.html?mp-home-shell=1'
    await loadPreload({ href: 'file:///D:/app/dist/index.html?mp-home-shell=0', argv: [API_ARG_PREFIX + expected] })
    expect(exposedWorlds()).not.toContain('electronAPI')
  })
})
