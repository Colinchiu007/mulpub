// @ts-check
/**
 * SystemTray — 系统托盘管理
 * 
 * 基于参考产品逆向分析的系统托盘：
 * - 最小化保持系统常规行为；运行任务时关闭窗口→隐藏到托盘后台执行
 * - 托盘菜单（设置、发布、退出）
 * - 托盘闪烁告警（发布失败时）
 * 
 * 文件位置: apps/desktop/electron/services/system-tray.js
 */
// eslint-disable-next-line no-unused-vars
const { Tray, Menu, ipcMain, nativeImage, shell, app } = require('electron')
const path = require('path')
const fs = require('fs')
const log = require('./logger')
const { isTrustedSender } = require('../core/ipc-security')

let tray = null
const MAX_FLASH_TIMES = 20

// dev 模式 dist/ 未构建时托盘图标缺失的兜底（内嵌 base64，按平台区分）：
// - Windows/Linux：32×32 蓝色占位 PNG（保证 dev 下托盘可用，窗口关闭→托盘后台运行依赖托盘可用性）。
// - macOS：16×16 透明底+黑色圆环的「模板图标」（menu bar 深色/浅色自动适配），
//   渲染时经 setTemplateImage(true) 由系统按当前菜单栏外观着色。
const TRAY_FALLBACK_ICONS = {
  darwin: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALUlEQVR4nGNgGKzgPw5MtkaiDaLIAEKKCBpCjBNHkgFkBSI2RfRNB8QYNAgBAKqRW6Wmp8r6AAAAAElFTkSuQmCC',
  default: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAALklEQVR4nO3OIQEAAAgDsDciIOFPDMzE/DLbfoqAgICAgICAgICAgICAgMB34AAtB6CXOGzAegAAAABJRU5ErkJggg==',
}

/**
 * 解析托盘图标：优先应用图标（dist/assets/icon.png），缺失时按平台回退内嵌占位图。
 * macOS 使用模板图标（setTemplateImage(true)），其余平台使用常规占位图。
 * @param {string} [platform] 目标平台（默认 process.platform，测试可注入）
 * @returns {string|object} 文件路径或 nativeImage
 */
function resolveTrayIcon (platform = process.platform) {
  const iconPath = path.join(__dirname, '..', '..', 'dist', 'assets', 'icon.png')
  if (fs.existsSync(iconPath)) return iconPath
  const fallbackBase64 = TRAY_FALLBACK_ICONS[platform] || TRAY_FALLBACK_ICONS.default
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(fallbackBase64, 'base64'))
    if (platform === 'darwin' && image && typeof image.setTemplateImage === 'function') {
      image.setTemplateImage(true)
    }
    return image
  } catch (e) {
    log.warn('SystemTray', 'Fallback tray icon unavailable (' + (e && e.message ? e.message : String(e)) + '), using missing path')
    return iconPath
  }
}

/**
 * 初始化系统托盘
 */
function init (mainWindow) {
  // 防止重复 init 导致 Tray 泄漏（销毁旧 Tray 再创建新的）
  if (tray) { try { tray.destroy() } catch (_) { /* ignore */ } }
  
  // 创建托盘图标（使用应用图标；dev 模式 dist/ 缺失时回退内嵌占位图）
  const icon = resolveTrayIcon()
  // 托盘为非必要功能：无系统托盘环境（headless/xvfb）或图标解析失败时优雅降级，不阻断启动
  try {
    tray = new Tray(icon)
  } catch (e) {
    tray = null
    log.warn('SystemTray', 'Tray unavailable, skipping: ' + (e && e.message ? e.message : String(e)))
    return
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) mainWindow.show()
      },
    },
    { type: 'separator' },
    {
      label: '发布设置',
      click: () => {
        if (mainWindow) mainWindow.webContents.send('app:show-settings')
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        // 走 app.quit() 而非 tray.destroy + mainWindow.destroy：前者触发 before-quit
        // 完整清理链（运行中任务落盘 + 服务清理），后者绕过 before-quit 会丢失运行态。
        app.quit()
      },
    },
  ])
  
  tray.setToolTip('Multi-Publish — 多平台内容发布')
  tray.setContextMenu(contextMenu)
  
  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
    }
  })
  
  log.info('SystemTray', 'System tray initialized')
}

/**
 * 托盘闪烁告警（用于发布失败通知）
 * 
 * @param {number} times - 闪烁次数
 */
function flashTray (times = 3) {
  if (!tray) return
  
  let count = 0
  const interval = setInterval(() => {
    if (count >= times * 2) {
      clearInterval(interval)
      tray.setImage('')
      return
    }
    
    // 交替显示/隐藏图标
    const iconPath = count % 2 === 0 
      ? path.join(__dirname, '..', '..', 'dist', 'assets', 'icon.png')
      : path.join(__dirname, '..', '..', 'dist', 'assets', 'icon-tray.png')
    
    if (fs.existsSync(iconPath)) {
      tray.setImage(iconPath)
    }
    count++
  }, 500)
  // R28 修复：unref 让定时器不阻止进程退出
  if (interval && interval.unref) interval.unref()
}

// 需要 fs 模块
// (已移至文件顶部)

/**
 * 设置托盘提示文字
 */
function setTooltip (text) {
  if (tray) {
    tray.setToolTip(text)
  }
}

/**
 * 销毁托盘
 */
function destroy () {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

/**
 * 托盘是否可用（init 成功后为 true；headless/无托盘环境为 false）。
 * 窗口关闭→托盘后台运行决策依赖该能力：托盘不可用时关闭窗口直接退出进程。
 */
function isAvailable () {
  return Boolean(tray)
}

/**
 * 注册托盘相关 IPC 处理
 *
 * 安全：tray:flash / tray:set-tooltip 是同步 IPC（ipcMain.on），
 * 不走 createAccessControlledIpcMain Proxy，需手动校验 sender 来源
 */
function registerIpcHandlers () {
  ipcMain.on('tray:flash', (event, payload) => {
    if (!isTrustedSender(event, app)) {
      log.warn('Tray', 'tray:flash rejected: untrusted sender')
      return
    }
    const normalizedPayload = payload === undefined ? {} : payload
    if (!normalizedPayload || typeof normalizedPayload !== 'object' || Array.isArray(normalizedPayload)) return
    const times = normalizedPayload.times === undefined ? 3 : normalizedPayload.times
    if (!Number.isInteger(times) || times < 1 || times > MAX_FLASH_TIMES) return
    flashTray(times)
  })

  ipcMain.on('tray:set-tooltip', (event, text) => {
    if (!isTrustedSender(event, app)) {
      log.warn('Tray', 'tray:set-tooltip rejected: untrusted sender')
      return
    }
    if (typeof text !== 'string' || text.length > 256) return
    setTooltip(text)
  })
}

module.exports = {
  init,
  flashTray,
  setTooltip,
  destroy,
  isAvailable,
  resolveTrayIcon,
  registerIpcHandlers,
}
