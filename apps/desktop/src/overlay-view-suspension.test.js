// @ts-check
/**
 * 弹窗互斥（内嵌视图挂起）守卫测试
 * —— WebContentsView 是原生图层，永远压在主窗口 DOM 之上（z-index 无效）。
 * 浏览器/登录标签（外部网页）活动时打开应用级模态浮层（设置弹窗 / 升级弹窗 /
 * 关闭未保存标签确认框），若不挂起内嵌视图，浮层会被整块盖住：
 * 用户点击后"屏幕闪一下、弹窗没出现"（2026-09-23 Bug 修复）。
 *
 * 完整链路断言：
 *   1. WebviewManager.suspendEmbeddedViewsForOverlay / releaseEmbeddedViewsForOverlay 行为
 *   2. IPC 通道 page-manager:suspend|resume-embedded-views 在 webview-manager 注册
 *   3. _repositionAll / createNewTabPage / switchToTab 尊重挂起态
 *   4. preload（page-manager.js + index.bundle.js）暴露 suspendEmbeddedViews / resumeEmbeddedViews
 *   5. 渲染层 composable + App.vue（设置弹窗、关闭确认护栏）/ MpSidebar（升级弹窗）接入
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

describe('弹窗互斥：静态链路完整性', () => {
  it('webview-manager 注册挂起/恢复 IPC handler 与方法', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/services/webview-manager.js'), 'utf8')
    expect(src).toContain("ipcMain.handle('page-manager:suspend-embedded-views'")
    expect(src).toContain("ipcMain.handle('page-manager:resume-embedded-views'")
    expect(src).toContain('suspendEmbeddedViewsForOverlay (owner)')
    expect(src).toContain('releaseEmbeddedViewsForOverlay (owner)')
    expect(src).toContain('isEmbeddedViewsSuspended ()')
    expect(src).toContain('this._overlaySuspensions = new Set()') // 构造器初始化
  })

  it('挂起期间不得恢复可见性：_repositionAll / createNewTabPage / switchToTab 均有守卫', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/services/webview-manager.js'), 'utf8')
    // _repositionAll：挂起时隐藏全部标签并直接返回，不 setVisible(true)
    expect(src).toMatch(/_repositionAll \(\) \{[\s\S]*?if \(this\.isEmbeddedViewsSuspended\(\)\) \{\s*this\._hideAllTabs\(\)\s*return\s*\}/)
    // createNewTabPage：挂起时新标签以隐藏态挂载
    expect(src).toMatch(/self\._hideAllTabs\(\)[\s\S]*?view\.setVisible\(!self\.isEmbeddedViewsSuspended\(\)\)/)
    // switchToTab：挂起时切换目标标签不恢复显示
    expect(src).toMatch(/targetView\.setVisible\(!self\.isEmbeddedViewsSuspended\(\)\)/)
  })

  it('preload page-manager.js 暴露 suspendEmbeddedViews / resumeEmbeddedViews 且通道一致', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/preload/page-manager.js'), 'utf8')
    expect(src).toMatch(/suspendEmbeddedViews: \(owner\) => ipcRenderer\.invoke\('page-manager:suspend-embedded-views', owner\)/)
    expect(src).toMatch(/resumeEmbeddedViews: \(owner\) => ipcRenderer\.invoke\('page-manager:resume-embedded-views', owner\)/)
  })

  it('preload index.bundle.js 已重打包（含挂起/恢复通道）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/preload/index.bundle.js'), 'utf8')
    expect(src).toContain('suspendEmbeddedViews')
    expect(src).toContain('page-manager:suspend-embedded-views')
    expect(src).toContain('page-manager:resume-embedded-views')
  })

  it('渲染层 composable 存在且调用 pageManager 挂起/恢复', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/composables/useEmbeddedViewSuspension.js'), 'utf8')
    expect(src).toContain('export async function suspendEmbeddedViewsForOverlay')
    expect(src).toContain('export async function releaseEmbeddedViewsForOverlay')
    expect(src).toContain("invokePageManager('suspendEmbeddedViews', owner)")
    expect(src).toContain("invokePageManager('resumeEmbeddedViews', owner)")
  })

  it('App.vue：设置弹窗打开期间挂起内嵌视图；关闭未保存标签确认框同样挂起', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/App.vue'), 'utf8')
    expect(src).toMatch(/watch\(showSettingsDialog, \(open\) => \{[\s\S]*?suspendEmbeddedViewsForOverlay\('settings-dialog'\)[\s\S]*?releaseEmbeddedViewsForOverlay\('settings-dialog'\)/)
    // 关闭未保存账号标签的三选一确认框（ElMessageBox 居中模态）打开前挂起、结束后释放
    expect(src).toMatch(/await suspendEmbeddedViewsForOverlay\('tab-close-confirm'\)/)
    expect(src).toMatch(/finally \{[\s\S]*?await releaseEmbeddedViewsForOverlay\('tab-close-confirm'\)/)
  })

  it('MpSidebar：升级 Pro 弹窗打开期间挂起内嵌视图', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/layouts/MpSidebar.vue'), 'utf8')
    expect(src).toMatch(/watch\(showUpgradeModal, \(open\) => \{[\s\S]*?suspendEmbeddedViewsForOverlay\('upgrade-modal'\)[\s\S]*?releaseEmbeddedViewsForOverlay\('upgrade-modal'\)/)
  })
})

describe('弹窗互斥：WebviewManager 行为（mock）', () => {
  async function createManagerStub () {
    const WebviewManager = (await import(path.join(ROOT, 'electron/services/webview-manager.js'))).default
    const wm = Object.create(WebviewManager.prototype)
    wm._overlaySuspensions = new Set()
    wm._shellMode = 'browser'
    wm._tabViews = new Map()
    wm._tabStates = new Map()
    wm._authTabInfo = null
    wm._activeTabId = 'home'
    wm._homeTabId = 'home'
    wm.mainWindow = null
    const calls = []
    wm._hideAllTabs = () => calls.push('hide-tabs')
    wm._repositionAll = () => calls.push('reposition')
    wm._authViewManager = { hide: () => calls.push('hide-auth'), show: () => calls.push('show-auth') }
    wm._qrCodeLogin = { hide: () => calls.push('hide-qr'), show: () => calls.push('show-qr') }
    return { wm, calls }
  }

  it('suspend：计数 0→1 才隐藏；重复挂起不重复触发；release：归零才恢复', async () => {
    const { wm, calls } = await createManagerStub()

    expect(wm.suspendEmbeddedViewsForOverlay('a')).toBe(true)
    expect(calls).toEqual(['hide-tabs', 'hide-auth', 'hide-qr'])

    // 第二个浮层（如设置弹窗未关又弹升级窗）：不重复隐藏
    calls.length = 0
    expect(wm.suspendEmbeddedViewsForOverlay('b')).toBe(true)
    expect(calls).toEqual([])

    // 未知 owner 释放无效（防计数漂移）
    calls.length = 0
    expect(wm.releaseEmbeddedViewsForOverlay('unknown')).toBe(false)
    expect(calls).toEqual([])
    expect(wm.isEmbeddedViewsSuspended()).toBe(true)

    // 释放 'a' 后仍剩 'b'：未真正恢复（返回 false），但 owner 已从挂起集合移除
    expect(wm.releaseEmbeddedViewsForOverlay('a')).toBe(false)
    expect(wm.isEmbeddedViewsSuspended()).toBe(true)
    expect(calls).toEqual([])
    // 已移除的 owner 再释放：未知 owner，无效
    expect(wm.releaseEmbeddedViewsForOverlay('a')).toBe(false)

    calls.length = 0
    expect(wm.releaseEmbeddedViewsForOverlay('b')).toBe(true)
    expect(wm.isEmbeddedViewsSuspended()).toBe(false)
    expect(calls).toEqual(['reposition'])
  })

  it('workbench 壳态下释放不触发恢复（由 setShellMode 驱动）；重复释放不重复恢复', async () => {
    const { wm, calls } = await createManagerStub()
    wm._shellMode = 'workbench'
    wm.suspendEmbeddedViewsForOverlay('a')
    wm.releaseEmbeddedViewsForOverlay('a')
    expect(wm.isEmbeddedViewsSuspended()).toBe(false)
    expect(calls).toEqual(['hide-tabs', 'hide-auth', 'hide-qr']) // 无 reposition

    // 已归零后再释放：no-op
    calls.length = 0
    expect(wm.releaseEmbeddedViewsForOverlay('a')).toBe(false)
    expect(calls).toEqual([])
  })

  it('非法 owner（非字符串/空串）拒绝挂起', async () => {
    const { wm } = await createManagerStub()
    expect(wm.suspendEmbeddedViewsForOverlay('')).toBe(false)
    expect(wm.suspendEmbeddedViewsForOverlay(null)).toBe(false)
    expect(wm.isEmbeddedViewsSuspended()).toBe(false)
  })
})
