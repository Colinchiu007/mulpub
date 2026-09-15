// @ts-check
/**
 * ops-center-sync.test.js (ipc-handlers) — 运营后台同步 IPC 通道
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

  it('注册 get/save/now/runtime/pipelineOptions/appMenu 六个通道并透传服务结果', async () => {
    const { ipcMain, call, handlers } = makeIpcMain()
    const opsCenterSync = {
      getConfig: vi.fn(() => ({ url: 'https://ops.example.com', apiKeyConfigured: true, autoSync: true, lastSyncedAt: 't1' })),
      saveConfig: vi.fn((payload) => ({ code: 0, config: { ...payload } })),
      syncNow: vi.fn(async () => ({ code: 0, updated: 3, syncedAt: 't2' })),
      getRuntimeState: vi.fn(() => ({ announcements: [], updatePolicy: null, contentPolicy: null, syncedAt: '' })),
      getPipelineOptions: vi.fn(() => ({ visibility: { 'basic.resolution': true }, defaults: { 'basic.resolution': '1920x1080' } })),
      getAppMenu: vi.fn(() => ({ items: [{ key: 'home', visible: false, sort_order: 0 }], syncedAt: 't1' })),
    }
    registerHandlers(ipcMain, { opsCenterSync, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })

    expect(Object.keys(handlers).sort()).toEqual(['ops-center-sync:appMenu', 'ops-center-sync:get', 'ops-center-sync:now', 'ops-center-sync:pipelineOptions', 'ops-center-sync:runtime', 'ops-center-sync:save'])

    const get = await call('ops-center-sync:get')
    expect(get.code).toBe(0)
    expect(get.config.url).toBe('https://ops.example.com')
    expect(get.config.apiKey).toBeUndefined()

    const save = await call('ops-center-sync:save', { url: 'https://ops.example.com', apiKey: 'k', autoSync: true })
    expect(save.code).toBe(0)
    expect(opsCenterSync.saveConfig).toHaveBeenCalledWith({ url: 'https://ops.example.com', apiKey: 'k', autoSync: true })

    const now = await call('ops-center-sync:now')
    expect(now.code).toBe(0)
    expect(now.updated).toBe(3)
    expect(opsCenterSync.syncNow).toHaveBeenCalledTimes(1)

    const runtime = await call('ops-center-sync:runtime')
    expect(runtime.code).toBe(0)
    expect(runtime.data.announcements).toEqual([])
    expect(opsCenterSync.getRuntimeState).toHaveBeenCalledTimes(1)

    const po = await call('ops-center-sync:pipelineOptions')
    expect(po.code).toBe(0)
    expect(po.data.visibility).toEqual({ 'basic.resolution': true })
    expect(po.data.defaults).toEqual({ 'basic.resolution': '1920x1080' })
    expect(opsCenterSync.getPipelineOptions).toHaveBeenCalledTimes(1)
  })

  it('服务抛错时返回 code -1 而非崩溃', async () => {
    const { ipcMain, call } = makeIpcMain()
    const opsCenterSync = {
      getConfig: vi.fn(() => { throw new Error('boom') }),
      saveConfig: vi.fn(() => { throw new Error('boom') }),
      syncNow: vi.fn(async () => { throw new Error('boom') }),
      getPipelineOptions: vi.fn(() => { throw new Error('boom') }),
    }
    registerHandlers(ipcMain, { opsCenterSync, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    expect((await call('ops-center-sync:get')).code).toBe(-1)
    expect((await call('ops-center-sync:save', {})).code).toBe(-1)
    expect((await call('ops-center-sync:now')).code).toBe(-1)
    expect((await call('ops-center-sync:pipelineOptions')).code).toBe(-1)
  })

  it('缺少 opsCenterSync 服务时不注册通道（不崩溃）', () => {
    const { ipcMain, handlers } = makeIpcMain()
    registerHandlers(ipcMain, { log: { info: vi.fn(), warn: vi.fn() } })
    expect(Object.keys(handlers)).toHaveLength(0)
  })
})
