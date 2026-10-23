// @ts-check
'use strict'
/**
 * film-engineering-import IPC 契约测试（PR-3b · F-J 资产导入写路径）
 *
 * 覆盖：
 *   - sender 授权硬断言：外部网页 / 子框架 / 协议不对 / 路由不匹配 ⇒ 一律 UNAUTHORIZED_SENDER；
 *   - **入参为空**：路径只能来自原生对话框（取消 ⇒ cancelled，不是失败）；
 *   - UNC 网络路径 / 非目录 ⇒ NOT_A_DIRECTORY；
 *   - 成功 ⇒ code 0；失败 ⇒ errorCode = reason 闭集值 + 恢复路径。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import nodeFs from 'node:fs'
import nodeOs from 'node:os'
import nodePath from 'node:path'

__enableElectronMock()

let registerImportHandlers

beforeEach(async () => {
  vi.resetModules()
  const mod = await import('./film-engineering-import')
  registerImportHandlers = mod.registerImportHandlers
})

function createMockIpcMain () {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    _get: (channel) => handlers[channel],
  }
}

/** 受信任来源 + 影视工程路由（hash 路由） */
function trustedEvent (url) {
  return {
    senderFrame: { url: url || 'http://localhost:5174/#/film-engineering' },
    sender: { send: vi.fn() },
  }
}

function tmpDir (tag) {
  return nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'kit-ipc-' + tag + '-'))
}

function makeDeps (overrides) {
  const userDataDir = tmpDir('ud')
  return Object.assign({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    filmEngineeringService: {
      userDataDir,
      invalidateKitCache: vi.fn(),
      setImportInProgress: vi.fn(),
    },
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [tmpDir('src')] })),
    },
    _testImportKit: vi.fn(async () => ({ ok: true, stats: { fileCount: 9, totalBytes: 1234 } })),
    _testLoadFilmKit: vi.fn(() => ({ ok: true })),
  }, overrides || {})
}

describe('film-engineering:import-kit · sender 授权断言（硬）', () => {
  it('外部网页 ⇒ 未授权（来源门禁先拦），且不弹对话框', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(
      { senderFrame: { url: 'https://evil.example/#/film-engineering' } },
    )
    // ⚠ 外部页面先被 `withSenderCheck` 的**来源**门禁拦下（返回它的信封，无 errorCode）；
    //   本处理器自己的路由/主框架断言只在**来源可信**时才起作用。
    expect(r.code).toBe(-3)
    expect(deps.dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(deps._testImportKit).not.toHaveBeenCalled()
  })

  it('子框架 ⇒ UNAUTHORIZED_SENDER', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')({
      senderFrame: { url: 'http://localhost:5174/#/film-engineering', parent: { url: 'x' } },
    })
    expect(r.code).toBe(-3)
    expect(deps._testImportKit).not.toHaveBeenCalled()
  })

  it('协议不在白名单 ⇒ UNAUTHORIZED_SENDER', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(
      trustedEvent('file:///C:/app/index.html#/film-engineering'),
    )
    expect(r.code).toBe(-3)
  })

  it('路由不在 /film-engineering ⇒ UNAUTHORIZED_SENDER', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(
      trustedEvent('http://localhost:5174/#/accounts'),
    )
    expect(r.code).toBe(-3)
    expect(deps._testImportKit).not.toHaveBeenCalled()
  })

  it('经典直达路由 /film-engineering/classic ⇒ 放行', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(
      trustedEvent('http://localhost:5174/#/film-engineering/classic'),
    )
    expect(r.code).toBe(0)
  })
})

describe('film-engineering:import-kit · 对话框与入参', () => {
  it('取消 ⇒ cancelled（不算失败）', async () => {
    const deps = makeDeps({
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
    })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.code).toBe(0)
    expect(r.data.cancelled).toBe(true)
    expect(r.data.reason).toBe('CANCELLED')
    expect(deps._testImportKit).not.toHaveBeenCalled()
  })

  it('UNC 网络路径 ⇒ NOT_A_DIRECTORY（handler 层就拒）', async () => {
    const deps = makeDeps({
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['\\\\host\\share\\kit'] })) },
    })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.code).toBe(-2)
    expect(r.errorCode).toBe('NOT_A_DIRECTORY')
    expect(deps._testImportKit).not.toHaveBeenCalled()
  })

  it('非目录 ⇒ NOT_A_DIRECTORY', async () => {
    const file = nodePath.join(tmpDir('f'), 'a.txt')
    nodeFs.writeFileSync(file, 'x', 'utf8')
    const deps = makeDeps({
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [file] })) },
    })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.errorCode).toBe('NOT_A_DIRECTORY')
  })

  it('路径只来自对话框（renderer 不能传路径）⇒ 导入调用不带路径参数以外的任何东西', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    const arg = deps._testImportKit.mock.calls[0][0]
    expect(arg.kitDir).toBeTruthy()
    expect(arg.userDataDir).toBeTruthy()
    expect(arg.senderRoute).toBe('/film-engineering')
  })
})

describe('film-engineering:import-kit · 结果信封', () => {
  it('成功 ⇒ code 0 + 统计', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.code).toBe(0)
    expect(r.data.ok).toBe(true)
    expect(r.data.fileCount).toBe(9)
  })

  it('失败 ⇒ errorCode = reason 闭集值 + 恢复路径', async () => {
    const deps = makeDeps({
      _testImportKit: vi.fn(async () => ({
        ok: false,
        reason: 'ROLLBACK_FAILED',
        message: '回滚失败',
        recoveryPath: 'D:/x/film-kit.bak-1',
        recoveryState: 'BAK_LEFT',
      })),
    })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.code).toBe(-13)
    expect(r.errorCode).toBe('ROLLBACK_FAILED')
    expect(r.data.recoveryPath).toBe('D:/x/film-kit.bak-1')
    expect(r.data.recoveryState).toBe('BAK_LEFT')
  })
})
