// @ts-check
/**
 * monitor-preload.test.js — 内嵌浏览器视图 preload 的接线锁
 *
 * 两条不可省的断言：
 *   ① **反检测注入先于 IPC 桥**：注入必须在 preload 顶层尽早发起（页面脚本之前），
 *      桥是纯暴露动作、无时序要求。顺序写反会推迟注入时机。
 *   ② **桥的能力面不得因反检测改造而扩权**：本片只加注入，暴露面必须与改造前逐字一致
 *      （`multiPublishMonitor` 仍只有 getCurrentUrl / reportReady 两项）。
 *
 * 为什么必须加载真实文件而不是读源码文本：本仓已多次发生"代码在、测试在、单测全绿而功能
 * 从未生效"（`userAgent` 读错宿主属性、`getVisibilityState` 恒 unknown 死探针）。
 *
 * mock 走本仓既有机制（`__enableElectronMock` + `__registerMock`），**不能**用 `vi.mock`：
 * electron 主进程代码以 CJS require 加载，`vi.mock` 只作用于 vitest 的 SSR 转换层
 * （见 test-setup.js 头注）。
 */
import { createRequire } from 'node:module'

__enableElectronMock()

const _req = createRequire(import.meta.url)
const PRELOAD_PATH = './monitor-preload.js'
// 注册 key 用带文件名的相对路径：test-setup 的匹配是「normalizedResolved 以 '/' + key 结尾」，
// 注册 './stealth' 匹配不到 stealth/index.js（实测会假绿——require 到真模块而 mock 没生效）。
const STEALTH_MOCK_KEY = './stealth/index.js'

let installCalls = []
let exposed = []
let originalExpose = null
let originalWebFrame = null

/** 每用例重建 mock 并清 CJS 缓存，保证 preload 顶层代码真的重新执行 */
function setup ({ stealthMode = 'ok' } = {}) {
  installCalls = []
  exposed = []

  // electron mock：补 webFrame（test-setup 的 electron mock 没有它），并记录暴露调用
  const electronMock = globalThis.__electronMock
  if (!originalWebFrame) originalWebFrame = electronMock.webFrame
  electronMock.webFrame = { __isFakeWebFrame: true }
  if (!originalExpose) originalExpose = electronMock.contextBridge.exposeInMainWorld
  electronMock.contextBridge.exposeInMainWorld = (name, api) => {
    exposed.push({ name, api })
  }

  if (stealthMode === 'ok') {
    globalThis.__registerMock(STEALTH_MOCK_KEY, {
      installMainWorldEvasions: (options) => {
        installCalls.push({ injectedBeforeExpose: exposed.length, options })
        return { enabled: true, dispatched: true, reason: 'ok' }
      },
    })
  } else if (stealthMode === 'missing') {
    // 模拟 sandbox 下 require 相对路径失败：模块不存在 ⇒ require 抛错
    globalThis.__registerMock(STEALTH_MOCK_KEY, undefined)
  }

  try { delete _req.cache[_req.resolve(PRELOAD_PATH)] } catch (_e) { /* 走 vite pipeline 时不在 CJS 缓存 */ }
  vi.resetModules()
}

async function loadPreload () {
  await import(PRELOAD_PATH)
}

afterEach(() => {
  const electronMock = globalThis.__electronMock
  if (electronMock) {
    electronMock.webFrame = originalWebFrame
    if (originalExpose) electronMock.contextBridge.exposeInMainWorld = originalExpose
  }
  vi.restoreAllMocks()
})

describe('monitor-preload — 反检测注入接线', () => {
  it('注入发生在桥暴露之前（反检测要尽早，桥无时序要求）', async () => {
    setup()
    await loadPreload()
    expect(installCalls).toHaveLength(1)
    expect(installCalls[0].injectedBeforeExpose).toBeLessThan(exposed.length)
    expect(exposed.map((item) => item.name)).toEqual(['multiPublishMonitor'])
  })

  it('注入拿到的宿主对象是 electron 模块的 webFrame（worldId=0 通道的宿主）', async () => {
    setup()
    await loadPreload()
    expect(installCalls[0].options.webFrame).toEqual({ __isFakeWebFrame: true })
  })

  it('注入提供 warn 出口，且该出口只经 console.warn 留痕（sandbox 无 logger）', async () => {
    setup()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadPreload()
    expect(typeof installCalls[0].options.warn).toBe('function')
    installCalls[0].options.warn('[stealth] probe')
    expect(warnSpy).toHaveBeenCalledWith('[stealth] probe')
    warnSpy.mockRestore()
  })

  it('stealth 模块装载失败时不得阻断 preload：桥照常暴露且出声告警', async () => {
    setup({ stealthMode: 'missing' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(loadPreload()).resolves.toBeUndefined()
    // 桥仍在（反检测是旁路，桥是功能）
    expect(exposed.map((item) => item.name)).toEqual(['multiPublishMonitor'])
    // 失败必须出声：静默降级会让"反检测没生效"变成无痕迹故障
    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0][0])).toContain('反检测装载失败')
    warnSpy.mockRestore()
  })
})

describe('monitor-preload — 能力面回归锁（不得因本次改造扩权）', () => {
  it('暴露名与成员集合与改造前逐字一致', async () => {
    setup()
    await loadPreload()
    expect(exposed).toHaveLength(1)
    expect(exposed[0].name).toBe('multiPublishMonitor')
    expect(Object.keys(exposed[0].api).sort()).toEqual(['getCurrentUrl', 'reportReady'])
  })

  it('getCurrentUrl 只读当前地址且不接受入参（不得成为任意读能力）', async () => {
    setup()
    await loadPreload()
    expect(exposed[0].api.getCurrentUrl.length).toBe(0)
    expect(exposed[0].api.getCurrentUrl()).toBe(window.location.href)
  })

  it('reportReady 只发固定通道与当前地址，不转发任意载荷', async () => {
    setup()
    // test-setup 的 electron mock 里 ipcRenderer.send 不是 spy，必须显式 spyOn
    // （否则 toHaveBeenCalledTimes 会直接抛 "not a spy"，把"没断言成功"伪装成通过风险）
    const ipcRenderer = globalThis.__electronMock.ipcRenderer
    const sendSpy = vi.spyOn(ipcRenderer, 'send').mockImplementation(() => {})
    await loadPreload()
    exposed[0].api.reportReady()
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][0]).toBe('monitor:page-ready')
    expect(Object.keys(sendSpy.mock.calls[0][1])).toEqual(['url'])
  })
})
