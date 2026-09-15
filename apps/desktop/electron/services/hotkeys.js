// @ts-check
/**
 * HotKeys — 全局快捷键
 *
 * 注册 Electron globalShortcut，为应用提供键盘操作支持。
 *
 * 快捷键列表：
 *   Ctrl+Alt+P — 打开发布页
 *   Ctrl+Alt+M — 打开分屏监控
 *   Ctrl+Alt+D — 打开数据看板
 *   Ctrl+Alt+C — 打开内容采集
 *   Ctrl+Alt+H — 返回首页
 *   Ctrl+Alt+Q — 退出应用
 *
 * 文件位置: apps/desktop/electron/hotkeys.js
 */
const { globalShortcut, BrowserWindow } = require('electron')
const log = require('./logger')

const SHORTCUTS = {
  'CmdOrCtrl+Alt+P': { route: '/publish', label: '发布' },
  'CmdOrCtrl+Alt+D': { route: '/dashboard', label: '数据看板' },
  'CmdOrCtrl+Alt+C': { route: '/collection', label: '内容采集' },
  'CmdOrCtrl+Alt+H': { route: '/', label: '首页' },
  'CmdOrCtrl+Alt+N': { route: '/publish', label: '新建发布' },
  'CmdOrCtrl+Alt+A': { route: '/accounts', label: '账号管理' },
  'CmdOrCtrl+Alt+K': { route: '/keywords', label: '关键词监测' },
  'CmdOrCtrl+Alt+V': { route: '/viral-analysis', label: '爆款分析' },
  'CmdOrCtrl+Comma': { route: '/accounts', label: '设置' },
  'CmdOrCtrl+Alt+Q': { route: '__quit__', label: '退出' },
}

let registered = false

/**
 * 注册全局快捷键
 */
function register () {
  if (registered) return

  for (const [accelerator, config] of Object.entries(SHORTCUTS)) {
    try {
      globalShortcut.register(accelerator, () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (!win || win.isDestroyed()) return

        if (config.route === '__quit__') {
          win.destroy()
          return
        }

        // 显示窗口（如果最小化到托盘了）
        if (win.isMinimized()) win.restore()
        if (!win.isVisible()) win.show()
        win.focus()

        // 发送导航指令到渲染进程
        win.webContents.send('app:navigate', config.route)
        log.info('HotKeys', `${accelerator} → ${config.label}`)
      })
    } catch (/** @type {any} */ e) {
      log.warn('HotKeys', `Failed to register ${accelerator}: ${e.message}`)
    }
  }

  registered = true
  log.info('HotKeys', `${Object.keys(SHORTCUTS).length} shortcuts registered`)
}

/**
 * 注销所有快捷键
 */
function unregister () {
  globalShortcut.unregisterAll()
  registered = false
  log.info('HotKeys', 'All shortcuts unregistered')
}

/**
 * 获取已注册的快捷键列表（用于前端展示）
 */
function getShortcuts () {
  return Object.entries(SHORTCUTS).map(([key, val]) => ({
    accelerator: key,
    ...val,
  }))
}

module.exports = {
  register,
  unregister,
  getShortcuts,
}
