// @ts-check
/**
 * T0-6b 壳态互斥守卫测试
 *
 * 验证「工作台壳态（isHomeTab）下浏览器壳与工作台不同时展示」（A1 决策）的完整链路：
 *   1. WebviewManager.setShellMode：workbench 隐藏全部内嵌视图；browser 恢复
 *   2. IPC 通道 'page-manager:set-shell-mode' 在 webview-manager 注册
 *   3. preload（page-manager.js + index.bundle.js）暴露 setShellMode
 *   4. App.vue watch isHomeTab 上报壳态
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

describe('T0-6b 壳态互斥：静态链路完整性', () => {
  it('webview-manager 注册 page-manager:set-shell-mode handler', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/services/webview-manager.js'), 'utf8')
    expect(src).toContain("ipcMain.handle('page-manager:set-shell-mode'")
    expect(src).toContain('setShellMode (mode)')
    expect(src).toContain("this._shellMode = 'browser'") // 构造器默认值
  })

  it('webview-manager setShellMode：workbench 隐藏 / browser 恢复', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/services/webview-manager.js'), 'utf8')
    // workbench 分支：隐藏全部（标签 + 登录视图 + 扫码视图）
    expect(src).toMatch(/setShellMode[\s\S]*?workbench[\s\S]*?_hideAllTabs\(\)/)
    expect(src).toMatch(/setShellMode[\s\S]*?this\._authViewManager\.hide\(\)/)
    expect(src).toMatch(/setShellMode[\s\S]*?this\._qrCodeLogin\.hide\(\)/)
    // browser 分支：恢复显示
    expect(src).toMatch(/setShellMode[\s\S]*?this\._repositionAll\(\)/)
    // 非法值守卫
    expect(src).toMatch(/setShellMode[\s\S]*?Invalid shell mode/)
  })

  it('preload page-manager.js 暴露 setShellMode 且通道一致', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/preload/page-manager.js'), 'utf8')
    expect(src).toMatch(/setShellMode: \(mode\) => ipcRenderer\.invoke\('page-manager:set-shell-mode', mode\)/)
  })

  it('preload index.bundle.js 已重打包（含 setShellMode）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/preload/index.bundle.js'), 'utf8')
    expect(src).toContain('setShellMode')
    expect(src).toContain('page-manager:set-shell-mode')
  })

  it('App.vue watch isHomeTab 上报壳态（immediate）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/App.vue'), 'utf8')
    // watch 上报：workbench / browser 两个方向 + immediate 首帧同步。
    // 容忍 watch 体内的前置守卫行（如内嵌主页实例的 isHomeShell 早返回，PRD-TAB-INDEPENDENT-HOME S4），但仍断言上报调用存在。
    expect(src).toMatch(/watch\(isHomeTab, \(home\) => \{[\s\S]*?invokePageManager\('setShellMode', home \? 'workbench' : 'browser'\)/)
    expect(src).toMatch(/\{ immediate: true \}/)
  })

  it('view-bounds TOP 参数化（topOffset）支持工作台壳态布局', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/services/view-bounds.js'), 'utf8')
    expect(src).toMatch(/topOffset = BROWSER_CHROME_TOP/)
  })
})

describe('T0-6b 壳态互斥：WebviewManager 行为', () => {
  it('setShellMode 行为验证（mock）', async () => {
    // 直接构造最小实例验证行为（不走 Electron）
    const WebviewManager = (await import(path.join(ROOT, 'electron/services/webview-manager.js'))).default
    const wm = Object.create(WebviewManager.prototype)
    wm._shellMode = 'browser'
    const hidden = []
    wm._hideAllTabs = () => hidden.push('tabs')
    wm._authViewManager = { hide: () => hidden.push('auth') }
    wm._qrCodeLogin = { hide: () => hidden.push('qr') }
    let repositioned = false
    wm._repositionAll = () => { repositioned = true }

    // workbench：全部隐藏
    wm.setShellMode('workbench')
    expect(wm._shellMode).toBe('workbench')
    expect(hidden).toEqual(['tabs', 'auth', 'qr'])
    expect(repositioned).toBe(false)

    // 同值不重复触发
    wm.setShellMode('workbench')
    expect(hidden).toHaveLength(3)

    // browser：恢复
    wm.setShellMode('browser')
    expect(wm._shellMode).toBe('browser')
    expect(repositioned).toBe(true)

    // 非法值忽略
    wm.setShellMode('invalid')
    expect(wm._shellMode).toBe('browser')

    expect(wm.isWorkbenchShell()).toBe(false)
  })
})
