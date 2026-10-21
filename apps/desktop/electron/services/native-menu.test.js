import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  shouldRemoveNativeMenuBar,
  removeApplicationMenu,
  removeWindowMenuBar,
} from './native-menu.js'

/**
 * native-menu.test.js — 原生应用菜单移除策略的回归锁（2026-10-21，remove-native-menu-bar）
 *
 * 背景：Electron 默认给应用装一份 File / Edit / View / Window 菜单，本仓从未替换过，
 * 于是主窗口顶部一直挂着那一行系统菜单。本组测试钉死「菜单被移除」这一契约，
 * 防止将来有人（无意中）再把它装回来。
 *
 * 判据分三档：
 *  1. Windows / Linux → 必须移除（全局 setApplicationMenu(null) + 窗口 setMenu(null)）；
 *  2. macOS → 必须保留（系统菜单栏承载 Cmd 快捷键，移除会破坏平台惯例）；
 *  3. API 不可用 / 夹具缺方法 → 不得抛错（菜单移除失败只是「不好看」，不能拦住应用启动）。
 */

describe('shouldRemoveNativeMenuBar（平台策略）', () => {
  it('Windows 移除（那行菜单在窗口内，正是要去掉的对象）', () => {
    expect(shouldRemoveNativeMenuBar('win32')).toBe(true)
  })

  it('Linux 移除', () => {
    expect(shouldRemoveNativeMenuBar('linux')).toBe(true)
  })

  it('macOS 保留（系统菜单栏承载 Cmd 快捷键）', () => {
    expect(shouldRemoveNativeMenuBar('darwin')).toBe(false)
  })

  it('缺省取 process.platform', () => {
    expect(shouldRemoveNativeMenuBar()).toBe(shouldRemoveNativeMenuBar(process.platform))
  })
})

describe('removeApplicationMenu（全局应用菜单）', () => {
  it('Windows：置空应用菜单模板（默认菜单的源头）', () => {
    const Menu = { setApplicationMenu: vi.fn() }

    const result = removeApplicationMenu({ Menu, platform: 'win32' })

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1)
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith(null)
    expect(result).toEqual({ removed: true, reason: 'removed' })
  })

  it('macOS：保留原生菜单，一个字节都不动', () => {
    const Menu = { setApplicationMenu: vi.fn() }

    const result = removeApplicationMenu({ Menu, platform: 'darwin' })

    expect(Menu.setApplicationMenu).not.toHaveBeenCalled()
    expect(result).toEqual({ removed: false, reason: 'macos-keeps-native-menu' })
  })

  it('Menu 模块缺失时不抛错（不得拦住应用启动）', () => {
    expect(() => removeApplicationMenu({ platform: 'win32' })).not.toThrow()
    expect(removeApplicationMenu({ platform: 'win32' })).toEqual({
      removed: false,
      reason: 'menu-api-unavailable',
    })
  })

  it('Menu 上没有 setApplicationMenu 时不抛错', () => {
    const result = removeApplicationMenu({ Menu: {}, platform: 'win32' })
    expect(result).toEqual({ removed: false, reason: 'menu-api-unavailable' })
  })

  it('重复调用幂等（每次都置空，不累积副作用）', () => {
    const Menu = { setApplicationMenu: vi.fn() }

    removeApplicationMenu({ Menu, platform: 'win32' })
    removeApplicationMenu({ Menu, platform: 'win32' })

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(2)
    expect(Menu.setApplicationMenu).toHaveBeenNthCalledWith(1, null)
    expect(Menu.setApplicationMenu).toHaveBeenNthCalledWith(2, null)
  })
})

describe('removeWindowMenuBar（单个窗口的菜单栏）', () => {
  it('Windows：窗口自身置空菜单（即便将来又装了全局菜单，主窗口也不长出这行）', () => {
    const win = { setMenu: vi.fn() }

    const result = removeWindowMenuBar(win, { platform: 'win32' })

    expect(win.setMenu).toHaveBeenCalledTimes(1)
    expect(win.setMenu).toHaveBeenCalledWith(null)
    expect(result).toEqual({ removed: true, reason: 'removed' })
  })

  it('macOS：保留窗口菜单', () => {
    const win = { setMenu: vi.fn() }

    const result = removeWindowMenuBar(win, { platform: 'darwin' })

    expect(win.setMenu).not.toHaveBeenCalled()
    expect(result).toEqual({ removed: false, reason: 'macos-keeps-native-menu' })
  })

  it('窗口缺 setMenu 时不抛错', () => {
    expect(() => removeWindowMenuBar({}, { platform: 'win32' })).not.toThrow()
    expect(removeWindowMenuBar({}, { platform: 'win32' })).toEqual({
      removed: false,
      reason: 'window-menu-api-unavailable',
    })
  })

  it('窗口为 null 时不抛错', () => {
    expect(removeWindowMenuBar(null, { platform: 'win32' })).toEqual({
      removed: false,
      reason: 'window-menu-api-unavailable',
    })
  })
})

// 真实依赖锁：本模块依赖的三个 Electron API 的存在性与「可置 null」的签名直接来自
// 已安装 Electron 的类型声明，而不是我对 API 的记忆。前提一旦被上游改变，
// 这里必须先变红，避免「按不存在的 API 写代码、单测靠 mock 全绿」。
const installedElectronDts = (() => {
  try {
    const req = createRequire(import.meta.url)
    const electronPkgDir = path.dirname(req.resolve('electron'))
    return readFileSync(path.join(electronPkgDir, 'electron.d.ts'), 'utf8')
  } catch (_) {
    return null
  }
})()

describe.skipIf(installedElectronDts === null)(
  'menu removal contract against installed Electron typings',
  () => {
    it('Menu.setApplicationMenu 接受 Menu | null', () => {
      expect(installedElectronDts).toMatch(/static setApplicationMenu\(menu: \(Menu\) \| \(null\)\): void;/)
    })

    it('BrowserWindow.setMenu 接受 Menu | null', () => {
      expect(installedElectronDts).toMatch(/setMenu\(menu: \(Menu\) \| \(null\)\): void;/)
    })

    it('BrowserWindow 构造选项支持 autoHideMenuBar', () => {
      expect(installedElectronDts).toMatch(/autoHideMenuBar\?: boolean;/)
    })
  },
)
