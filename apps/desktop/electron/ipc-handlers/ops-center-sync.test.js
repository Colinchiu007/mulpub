// @ts-check
/**
 * ops-center-sync.test.js (ipc-handlers) — 运营中心下发的运行时策略 IPC 通道
 *
 * 2026-10-15：`get` / `save` / `now` 三条通道已删除（渲染端零调用，见 handlers 文件头取证）。
 * 本文件除覆盖保留的三条外，还锁住「死通道不得复活」。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

function makeIpcMain () {
  const handlers = {}
  return {
    ipcMain: {
      handle: vi.fn((channel, handler) => { handlers[channel] = handler }),
    },
    call: (channel, ...args) => handlers[channel]({ sender: {}, senderFrame: undefined }, ...args),
    handlers,
  }
}

describe('ops-center-sync IPC handlers', () => {
  let registerHandlers

  beforeEach(() => { registerHandlers = require('./ops-center-sync').registerHandlers })

  it('注册 runtime/pipelineOptions/appMenu 三个通道并透传服务结果', async () => {
    const { ipcMain, call, handlers } = makeIpcMain()
    const opsCenterSync = {
      getRuntimeState: vi.fn(() => ({ announcements: [], updatePolicy: null, contentPolicy: null, syncedAt: '' })),
      getPipelineOptions: vi.fn(() => ({ visibility: { 'basic.resolution': true }, defaults: { 'basic.resolution': '1920x1080' } })),
      getAppMenu: vi.fn(() => ({ items: [{ key: 'home', visible: false, sort_order: 0 }], syncedAt: 't1' })),
    }
    registerHandlers(ipcMain, { opsCenterSync, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })

    expect(Object.keys(handlers).sort()).toEqual(['ops-center-sync:appMenu', 'ops-center-sync:pipelineOptions', 'ops-center-sync:runtime'])

    const runtime = await call('ops-center-sync:runtime')
    expect(runtime.code).toBe(0)
    expect(runtime.data.announcements).toEqual([])
    expect(opsCenterSync.getRuntimeState).toHaveBeenCalledTimes(1)

    const po = await call('ops-center-sync:pipelineOptions')
    expect(po.code).toBe(0)
    expect(po.data.visibility).toEqual({ 'basic.resolution': true })
    expect(po.data.defaults).toEqual({ 'basic.resolution': '1920x1080' })
    expect(opsCenterSync.getPipelineOptions).toHaveBeenCalledTimes(1)

    const menu = await call('ops-center-sync:appMenu')
    expect(menu.code).toBe(0)
    expect(menu.data.items).toEqual([{ key: 'home', visible: false, sort_order: 0 }])
    expect(opsCenterSync.getAppMenu).toHaveBeenCalledTimes(1)
  })

  it('死通道不得复活：get/save/now 三个通道均未注册', () => {
    const { ipcMain, handlers } = makeIpcMain()
    const opsCenterSync = {
      getConfig: vi.fn(() => ({ manualUrl: '', effectiveUrl: '', apiKeyConfigured: false, autoSync: true, lastSyncedAt: '' })),
      saveConfig: vi.fn(() => ({ code: 0 })),
      syncNow: vi.fn(async () => ({ code: 0 })),
      getRuntimeState: vi.fn(() => ({})),
      getPipelineOptions: vi.fn(() => ({})),
      getAppMenu: vi.fn(() => ({})),
    }
    registerHandlers(ipcMain, { opsCenterSync, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    for (const dead of ['ops-center-sync:get', 'ops-center-sync:save', 'ops-center-sync:now']) {
      expect(handlers[dead]).toBeUndefined()
    }
    // 服务侧这三个方法不得被触碰
    expect(opsCenterSync.getConfig).not.toHaveBeenCalled()
    expect(opsCenterSync.saveConfig).not.toHaveBeenCalled()
    expect(opsCenterSync.syncNow).not.toHaveBeenCalled()
  })

  it('服务抛错时返回 code -1 而非崩溃', async () => {
    const { ipcMain, call } = makeIpcMain()
    const opsCenterSync = {
      getPipelineOptions: vi.fn(() => { throw new Error('boom') }),
      getRuntimeState: vi.fn(() => { throw new Error('boom') }),
      getAppMenu: vi.fn(() => { throw new Error('boom') }),
    }
    registerHandlers(ipcMain, { opsCenterSync, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    expect((await call('ops-center-sync:runtime')).code).toBe(-1)
    expect((await call('ops-center-sync:pipelineOptions')).code).toBe(-1)
    expect((await call('ops-center-sync:appMenu')).code).toBe(-1)
  })

  it('服务方法缺失时返回「运行时策略服务未就绪」而非崩溃', async () => {
    const { ipcMain, call } = makeIpcMain()
    registerHandlers(ipcMain, { opsCenterSync: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    expect((await call('ops-center-sync:runtime')).message).toBe('运行时策略服务未就绪')
    expect((await call('ops-center-sync:pipelineOptions')).message).toBe('运行时策略服务未就绪')
    expect((await call('ops-center-sync:appMenu')).message).toBe('运行时策略服务未就绪')
  })

  it('缺少 opsCenterSync 服务时不注册通道（不崩溃）', () => {
    const { ipcMain, handlers } = makeIpcMain()
    registerHandlers(ipcMain, { log: { info: vi.fn(), warn: vi.fn() } })
    expect(Object.keys(handlers)).toHaveLength(0)
  })
})
