/**
 * Stealth Preload — baseline 反检测 preload（RPA 窗口变体之一，PRD-OSS-RPA-HARDENING §3.1）
 *
 * ⚠️ 真实语义（2026-10-14 spike E4b 实证）：
 * 本文件在 contextIsolation 下运行于**隔离世界**（sandbox preload context），
 * 下方的 navigator/window patch 对**主世界不可见**——页面脚本读到的仍是原生
 * `navigator.webdriver` 等。历史头注把本文件描述成「preload 即完成主世界反检测
 * 注入」（类比 context.addInitScript），属错误声明，已按实证修正。
 *
 * 主世界注入的唯一入口是增强版：
 *   services/stealth/stealth-preload-enhanced.js
 *   （经 webFrame.executeJavaScriptInIsolatedWorld(0, …) 送进主世界，
 *    由 preload 变体映射表 riskControl.preloadVariant 按平台选挂：
 *    douyin/xiaohongshu/shipinhao 默认 enhanced，其余平台走本文件）。
 *
 * 本文件保留的原因（kill-switch 落点）：映射表关闭增强、未知平台回落、
 * 以及混入声明测试都要求 baseline 存在且行为不变。
 *
 * 来源：适配自 MediaTrace stealth.min.js (MIT) + Multi-Publish StealthHelper。
 */
try {
  // 1. Override navigator.webdriver
  delete navigator.__proto__.webdriver
  Object.defineProperty(navigator, 'webdriver', {
    value: undefined,
    writable: false,
    configurable: true,
  })
} catch (_e) { /* ignore */ }

try {
  // 2. Simulate chrome.runtime
  const origChrome = window.chrome || {}
  window.chrome = {
    runtime: {
      id: 'aohghmighlieiainnegkcijnfilokake',
      connect: function() { return { onMessage: { addListener: function() {} }, onDisconnect: { addListener: function() {} } } },
      sendMessage: function() {},
      onMessage: { addListener: function() {} },
      onConnect: { addListener: function() {} },
      lastError: undefined,
    },
    loadTimes: function() { return {} },
    csi: function() { return {} },
    app: origChrome.app || { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
    webstore: origChrome.webstore || { onInstallStage: { addListener: function() {} } },
  }
} catch (_e) { /* ignore */ }

try {
  // 3. Override navigator.plugins
  const fakePlugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
  ]
  Object.defineProperty(navigator, 'plugins', {
    get: function() {
      const arr = []
      for (let i = 0; i < fakePlugins.length; i++) arr[i] = fakePlugins[i]
      arr.length = fakePlugins.length
      arr.item = function(i) { return this[i] || null }
      arr.namedItem = function(n) { for (let j = 0; j < this.length; j++) { if (this[j].name === n) return this[j] } return null }
      arr.refresh = function() {}
      return arr
    },
    configurable: true,
  })
} catch (_e) { /* ignore */ }

try {
  // 4. Override navigator.languages
  Object.defineProperty(navigator, 'languages', {
    get: function() { return ['zh-CN', 'zh', 'en'] },
    configurable: true,
  })
} catch (_e) { /* ignore */ }

try {
  // 5. Permission query fix
  const origQuery = window.navigator.permissions.query
  window.navigator.permissions.query = function(perm) {
    if (perm && perm.name === 'clipboard-read') {
      return Promise.resolve({ state: 'granted', onchange: null })
    }
    return origQuery.call(window.navigator.permissions, perm)
  }
} catch (_e) { /* ignore */ }
