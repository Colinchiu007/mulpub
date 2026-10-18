// @ts-check
/**
 * HotKeys — 全局快捷键
 *
 * 注册 Electron globalShortcut，为应用提供键盘操作支持。
 *
 * 快捷键表由下方 SHORTCUTS **单点持有**（10 条）。历史上的头部注释只列了 6 条、
 * 并把 `CmdOrCtrl+Comma` 写成「设置」而它实际跳 /accounts —— 那份注释与表长期不同步，
 * 而设置页「快捷键」面板（阶段 1.6）直接消费 getShortcuts()，
 * 所以这里写什么用户就看到什么。口径：
 *   - `labelKey` 是渲染端 locales 的键（展示用，双语）
 *   - `label`   只给主进程日志用（中文，不面向用户）
 *   - 新增快捷键必须同时补 locales `hotkeys.label.*` 的 zh/en 一对，否则设置页会露出键名
 *
 * 键位当前不可由用户自定义（本模块不提供写路径）；设置页只做只读展示 + 明确说明。
 */
const { globalShortcut, BrowserWindow } = require('electron')
const log = require('./logger')

const SHORTCUTS = {
  'CmdOrCtrl+Alt+P': { route: '/publish', label: '发布', labelKey: 'hotkeys.label.publish' },
  'CmdOrCtrl+Alt+D': { route: '/dashboard', label: '数据看板', labelKey: 'hotkeys.label.dashboard' },
  'CmdOrCtrl+Alt+C': { route: '/collection', label: '内容采集', labelKey: 'hotkeys.label.collection' },
  'CmdOrCtrl+Alt+H': { route: '/', label: '首页', labelKey: 'hotkeys.label.home' },
  'CmdOrCtrl+Alt+N': { route: '/publish', label: '新建发布', labelKey: 'hotkeys.label.newPublish' },
  'CmdOrCtrl+Alt+A': { route: '/accounts', label: '账号管理', labelKey: 'hotkeys.label.accounts' },
  'CmdOrCtrl+Alt+K': { route: '/keywords', label: '关键词监测', labelKey: 'hotkeys.label.keywords' },
  'CmdOrCtrl+Alt+V': { route: '/viral-analysis', label: '爆款分析', labelKey: 'hotkeys.label.viral' },
  // 实测语义就是「跳账号管理」，不是打开设置弹窗；旧注释写成「设置」是错的，
  // 展示面不得复读这个错（阶段 1.6 的键位表若与行为不符，比没有表更伤）。
  'CmdOrCtrl+Comma': { route: '/accounts', label: '账号管理', labelKey: 'hotkeys.label.accounts' },
  'CmdOrCtrl+Alt+Q': { route: '__quit__', label: '退出', labelKey: 'hotkeys.label.quit' },
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
