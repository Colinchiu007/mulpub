/**
 * monitor-preload.js — 内嵌浏览器视图（浏览标签 / 账号标签）预加载脚本
 *
 * 两项职责，互不耦合、互不阻断：
 *   ① **主世界反检测注入**：使内嵌浏览器在页面主世界呈现为正常 Chrome。
 *      注入通道与源码见 `electron/stealth/`（单一真源）。**必须在顶层同步发起**——
 *      放进 then/setTimeout 会晚于页面脚本执行，等于白做。
 *   ② 受限 IPC 桥：仅暴露读取当前 URL / 上报就绪两项能力，不暴露文件、进程等危险 API。
 *
 * ⚠️ 本文件在 `sandbox: true` 下运行，而 sandbox preload **无法 require 相对路径文件**
 *    （2026-10-15 真机实测：`require('./probe-require-target.js')` 报 `module not found`）。
 *    因此本文件作为 esbuild 打包入口（`apps/desktop/scripts/build-preload.js`）产出
 *    `monitor-preload.bundle.js`，运行时由 `webview-manager/utils.js` 的 `_monitorPreloadPath()`
 *    优先加载 bundle。若直接加载本源文件，`./stealth` 会解析失败——该失败被下面的
 *    try/catch 兜住：页面功能与 ② 的 IPC 桥不受影响，仅反检测降级并出声告警。
 */
const { contextBridge, ipcRenderer } = require('electron')

// ── ① 主世界反检测（尽力而为的旁路：任何失败都不得影响 ② 与页面本身）──
try {
  const stealth = require('./stealth')
  stealth.installMainWorldEvasions({
    webFrame: require('electron').webFrame,
    warn: (message) => {
      // preload 处于 sandbox，取不到本仓 logger；console.warn 是该层唯一可用的留痕出口。
      // 刻意不用 console.log：避免与页面自身日志混淆，也避免噪声掩盖真实告警。
      try { console.warn(message) } catch (_e) { /* 日志失败不影响主流程 */ }
    },
  })
} catch (error) {
  try {
    console.warn('[stealth] 主世界反检测装载失败（页面功能不受影响）：' +
      ((error && error.message) || String(error)))
  } catch (_e) { /* ignore */ }
}

// ── ② 受限监控桥（能力面保持不变，不得因反检测改造而扩权）──
contextBridge.exposeInMainWorld('multiPublishMonitor', {
  /** 获取当前页面 URL */
  getCurrentUrl: () => window.location.href,

  /** 通知主进程当前页面就绪 */
  reportReady: () => {
    ipcRenderer.send('monitor:page-ready', { url: window.location.href })
  },
})
