// @ts-check
/**
 * performance-loop IPC：performance:trigger-recrawl 立即回采调试入口回归。
 *
 * 修复前该 handler 是空壳（只 return supported，从不跑 processRound），
 * 无法在会话内即时观测「回采→爆款库写回」。修复后必须真正执行一轮巡检，
 * 并支持 { force } 忽略 T+1h 排期纳入未到期条目。
 */
// withSenderCheck 通过 require('electron').app 读取 isPackaged → 需启用 electron mock
__enableElectronMock()

let registerHandlers
let originalIsPackaged

beforeEach(async () => {
  vi.resetModules()
  originalIsPackaged = __electronMock.app.isPackaged
  __electronMock.app.isPackaged = false
  const mod = await import('./performance-loop')
  registerHandlers = mod.default || mod
})
afterEach(() => { __electronMock.app.isPackaged = originalIsPackaged })

const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }
const fakeStore = { db: { prepare: () => ({ get: () => ({ n: 0 }), all: () => [] }) } }

function makeIpc () {
  const handlers = {}
  return { handlers, ipcMain: { handle: (ch, fn) => { handlers[ch] = fn } } }
}

describe('performance:trigger-recrawl 立即回采入口', () => {
  it('force=true -> processRound({force:true}) 被调用 + 返回 supported/ran', async () => {
    const { handlers, ipcMain } = makeIpc()
    const performanceRecrawlService = { processRound: vi.fn(async () => {}) }
    registerHandlers(ipcMain, { store: fakeStore, performanceRecrawlService })
    const r = await handlers['performance:trigger-recrawl'](TRUSTED_EVENT, { force: true })
    expect(r.code).toBe(0)
    expect(Array.isArray(r.data.supported)).toBe(true)
    expect(r.data.ran).toBe(true)
    expect(r.data.force).toBe(true)
    expect(performanceRecrawlService.processRound).toHaveBeenCalledTimes(1)
    expect(performanceRecrawlService.processRound).toHaveBeenCalledWith({ force: true })
  })

  it('缺省 opts -> 非强制巡检（force:false，仅纳入已到期条目）', async () => {
    const { handlers, ipcMain } = makeIpc()
    const performanceRecrawlService = { processRound: vi.fn(async () => {}) }
    registerHandlers(ipcMain, { store: fakeStore, performanceRecrawlService })
    await handlers['performance:trigger-recrawl'](TRUSTED_EVENT, undefined)
    expect(performanceRecrawlService.processRound).toHaveBeenCalledWith({ force: false })
  })

  it('回采服务未就绪 -> ran:false，仍返回 supported 不抛', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, { store: fakeStore, performanceRecrawlService: null })
    const r = await handlers['performance:trigger-recrawl'](TRUSTED_EVENT, {})
    expect(r.code).toBe(0)
    expect(r.data.ran).toBe(false)
  })
})
