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
        // ⚠ 档位语义更正（2026-10-23 验证层外部评审 codex i6 + 自查交叉核对）：
        //   回滚失败 ⇒ film-kit **缺失**、`.bak` = 旧 kit ⇒ 档位是 `MISSING_KIT`
        //   （恢复动作 = 改名回来）；`BAK_LEFT` 的恢复动作是「可安全删除」——
        //   两者互换会让用户删掉旧资产仅存的一份。
        recoveryState: 'MISSING_KIT',
      })),
    })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.code).toBe(-13)
    expect(r.errorCode).toBe('ROLLBACK_FAILED')
    expect(r.data.recoveryPath).toBe('D:/x/film-kit.bak-1')
    expect(r.data.recoveryState).toBe('MISSING_KIT')
  })

  // ⚠ 2026-10-23 验证层外部评审（claude i3 / codex i6）命中：初版成功信封**不带**残留档位
  //   ⇒ 「.bak 没删掉」「锁没删掉」这两件事**永远到不了用户眼前**。
  it('成功信封也必须带残留档位（.bak 未删 ⇒ BAK_LEFT + 路径）', async () => {
    const deps = makeDeps({
      _testImportKit: vi.fn(async () => ({
        ok: true,
        stats: { fileCount: 9, totalBytes: 1 },
        recoveryState: 'BAK_LEFT',
        recoveryPath: 'D:/x/film-kit.bak-1',
      })),
    })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.code).toBe(0)
    expect(r.data.recoveryState).toBe('BAK_LEFT')
    expect(r.data.recoveryPath).toBe('D:/x/film-kit.bak-1')
  })

  it('成功信封带 auditWritten=false（审计结果行没落盘 ⇒ 必须显式上报）', async () => {
    const deps = makeDeps({
      _testImportKit: vi.fn(async () => ({
        ok: true,
        stats: { fileCount: 9, totalBytes: 1 },
        auditWritten: false,
        auditMessage: '审计写入失败: disk on fire',
      })),
    })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.code).toBe(0)
    expect(r.data.auditWritten).toBe(false)
    expect(r.data.auditMessage).toContain('审计')
  })
})

describe('film-engineering:import-kit · 早退路径也要留审计痕迹', () => {
  // ⚠ 2026-10-23 验证层外部评审（codex i4）命中：初版**未授权 / 对话框不可用 /
  //   对话框失败 / 用户取消** 这四条路径**一行审计都不写**
  //   ⇒ 一次未授权的调用在审计里**完全不存在**。
  function auditRows (userDataDir) {
    const f = nodePath.join(userDataDir, 'film-kit-import.log')
    if (!nodeFs.existsSync(f)) return []
    return nodeFs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
  }

  it('用户取消 ⇒ 留一行 cancelled 审计', async () => {
    const deps = makeDeps({
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
    })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.code).toBe(0)
    expect(r.data.cancelled).toBe(true)
    const rows = auditRows(deps.filmEngineeringService.userDataDir)
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain('cancelled')
    expect(rows[0]).toContain('CANCELLED')
  })

  it('对话框不可用 ⇒ 留一行 failed 审计（reason 落在闭集内）', async () => {
    // ⚠ `dialog: undefined` 不行：`makeDeps` 用 `Object.assign` 覆盖 ⇒ undefined 会**覆盖掉**
    //   默认值 ⇒ handler 反而会回落到 `require('electron').dialog`（测试环境里有 mock）
    //   ⇒ 走不到「对话框不可用」那一格。用**空对象**（没有 showOpenDialog）才是真不可用。
    const deps = makeDeps({ dialog: {} })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.errorCode).toBe('DIALOG_UNAVAILABLE')
    const rows = auditRows(deps.filmEngineeringService.userDataDir)
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain('VALIDATION_ERROR')
  })

  it('所选路径不是目录 ⇒ 留一行 failed 审计（NOT_A_DIRECTORY）', async () => {
    const file = nodePath.join(tmpDir('f'), 'a.txt')
    nodeFs.writeFileSync(file, 'x', 'utf8')
    const deps = makeDeps({
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [file] })) },
    })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.errorCode).toBe('NOT_A_DIRECTORY')
    const rows = auditRows(deps.filmEngineeringService.userDataDir)
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain('NOT_A_DIRECTORY')
  })

  // ⚠ 2026-10-23 验证层外部评审（codex i1）命中：来源门禁在 handler **之前**拦截
  //   ⇒ 未授权的外部来源**一行审计都不写** ⇒ 「每次 IPC 调用都有痕迹」被自身行为证伪。
  //   ⇒ 通过 `withSenderCheck(fn, { onUntrusted })` 这一格补写。
  it('外部来源被来源门禁拦下 ⇒ 也要留一行未授权审计', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(
      { senderFrame: { url: 'https://evil.example/#/film-engineering' } },
    )
    expect(r.code).toBe(-3)
    const rows = auditRows(deps.filmEngineeringService.userDataDir)
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain('UNAUTHORIZED_SENDER')
  })

  it('失败信封透传 auditWritten=false（审计行没落盘 ⇒ 不静默）', async () => {
    const deps = makeDeps({
      _testImportKit: vi.fn(async () => ({
        ok: false,
        reason: 'VALIDATION_ERROR',
        message: '校验失败',
        auditWritten: false,
        auditMessage: '审计写入失败: disk on fire',
      })),
    })
    const ipcMain = createMockIpcMain()
    registerImportHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:import-kit')(trustedEvent())
    expect(r.code).not.toBe(0)
    expect(r.data.auditWritten).toBe(false)
    expect(String(r.data.auditMessage)).toContain('审计')
  })
})
