/**
 * offline-manager 的断网推送回归锁（UX-AUDIT-2026-10-17 阶段 1.7 / audit-7）
 *
 * 现场事实：`net.on("online"/"offline")` 早在 startMonitoring 里注册好了，
 * 但 `onNetworkChange` 只在**恢复**方向通知渲染层 ⇒ 主进程知道掉线、用户不知道。
 * 本锁锁住这条方向性缺口，也锁住「通知是旁路」：主窗口缺席或 send 抛错
 * 都不得把网络监测本身带崩。
 *
 * 接缝按本仓既有做法：CJS 依赖用 test-setup 的 `__registerMock`（经 Module._load 拦截），
 * 主窗口用 startMonitoring(fakeWin) 注入 `_mainWin`，让 getMainWindow 走第一分支。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-offline-mgr-'))
const sent = []
const fakeWin = {
  isDestroyed: () => false,
  webContents: { send: (channel, payload) => { sent.push({ channel, payload }) } },
}

__registerMock('./logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
__registerMock('electron', {
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [fakeWin] },
  net: { on: vi.fn(), isConnected: () => true },
})

const manager = require('./offline-manager')

describe('offline-manager 网络方向通知', () => {
  beforeEach(() => {
    manager.startMonitoring(fakeWin)
    // 复位到「在线」基线（模块态是进程级，测试必须自己把起点钉住）
    manager.onNetworkChange(false)
    sent.length = 0
  })

  it('在线 → 离线：发且只发一次 offline:lost，并带上待发布计数', () => {
    manager.onNetworkChange(true)

    expect(sent.map(s => s.channel)).toEqual(['offline:lost'])
    expect(typeof sent[0].payload.cachedCount).toBe('number')
  })

  it('重复的离线事件不再重复通知（wasOffline 已成立）', () => {
    manager.onNetworkChange(true)
    manager.onNetworkChange(true)

    expect(sent.filter(s => s.channel === 'offline:lost')).toHaveLength(1)
  })

  it('离线 → 在线：只发 offline:restored，不得再补一条 lost', () => {
    manager.onNetworkChange(true)
    sent.length = 0

    manager.onNetworkChange(false)

    expect(sent.map(s => s.channel)).toEqual(['offline:restored'])
  })

  it('没有任何可用窗口时静默旁路，不影响状态机（通知是观测面，不是主流程）', () => {
    const electron = require('electron')
    const original = electron.BrowserWindow.getAllWindows
    // getMainWindow 的取值链是「_mainWin → 否则 getAllWindows()[0]」，
    // 只把 _mainWin 置空不足以走到"无窗口"那一档，必须同时让兜底也拿不到窗口。
    manager.startMonitoring(null)
    electron.BrowserWindow.getAllWindows = () => []
    try {
      expect(() => manager.onNetworkChange(true)).not.toThrow()
      expect(sent).toHaveLength(0)
      expect(manager.isOffline()).toBe(true)
    } finally {
      electron.BrowserWindow.getAllWindows = original
      manager.onNetworkChange(false)
      manager.startMonitoring(fakeWin)
    }
  })
})

describe('preload / 白名单接线锁（渲染端拿不到通道等于没修）', () => {
  const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')

  it('preload 暴露 onOfflineLost 并成对 removeListener', () => {
    const src = read('../preload/system.js')
    expect(src).toMatch(/onOfflineLost:\s*\(cb\)\s*=>\s*\{[\s\S]{0,220}?'offline:lost'[\s\S]{0,220}?removeListener\('offline:lost'/)
  })

  it('access-control 白名单含 onOfflineLost（白名单漏一项即静默不可用）', () => {
    expect(read('../preload/access-control.js')).toContain("'onOfflineLost'")
  })
})
