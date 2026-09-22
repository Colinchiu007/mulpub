/**
 * home-shell-preload.js — 「+」新标签内嵌独立 SPA 实例的受守护 preload
 * （PRD-TAB-INDEPENDENT-HOME-2026-09-22 §5 安全约束 S1/S2）
 *
 * 安全不变式（双判据，缺一不暴露完整 electronAPI）：
 *   ① 主进程创建该视图时注入了 --mp-home-shell-url=<期望地址>，
 *      说明当前文档确由主进程以本应用主页地址打开；
 *   ② 当前文档 location 与期望地址同源，且 search 仍含 mp-home-shell=1，
 *      说明文档没有被重定向到外站、壳态参数也没有被剥离。
 * 页面被恶意重定向（外站复用同源路径但去掉参数 / 换 host）时，preload 会
 * 在新文档中重新执行，判据②失败 → 自动降级为仅暴露受限 monitor 桥。
 *
 * 判据逻辑刻意内联（不 import src/ 渲染层模块）：本文件与源码契约测试
 * （electron/home-shell-preload.test.js）逐字校验该行为，内联避免 CJS/ESM
 * 双加载形态差异，且保证 esbuild 打包产物语义一致。
 */
const { contextBridge, ipcRenderer } = require('electron')

const API_ARG_PREFIX = '--mp-home-shell-url='

/** 解析主进程注入的期望主页地址（未注入返回 null，此时一律不暴露 electronAPI） */
function getExpectedHomeShellUrl () {
  const argv = (typeof process !== 'undefined' && Array.isArray(process.argv)) ? process.argv : []
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith(API_ARG_PREFIX)) {
      const value = arg.slice(API_ARG_PREFIX.length)
      if (value) return value
    }
  }
  return null
}

/** 壳态参数判据：search 严格含 mp-home-shell=1（先剥 hash，防 '1#/route' 污染；
    先去前导 ? 再剥 #，兼容 jsdom 等把 hash 拼进 search 的 location 实现） */
function hasHomeShellParam (search) {
  if (typeof search !== 'string' || !search) return false
  const stripped = search.startsWith('?') ? search.slice(1) : search
  const queryPart = stripped.split('#')[0]
  if (!queryPart) return false
  try {
    const params = new URLSearchParams(queryPart)
    return params.get('mp-home-shell') === '1'
  } catch (_) {
    return false
  }
}

/** 双判据校验：期望地址可解析、当前文档与其同源、且壳态参数仍在 */
function verifyHomeShell () {
  try {
    const expected = getExpectedHomeShellUrl()
    if (!expected) return false
    const expectedUrl = new URL(expected)
    const locationUrl = new URL(window.location.href)
    if (locationUrl.origin !== expectedUrl.origin) return false
    return hasHomeShellParam(locationUrl.search) && hasHomeShellParam(expectedUrl.search)
  } catch (_) {
    return false
  }
}

// 受限监控桥：与 monitor-preload 同级能力（只读当前 URL / 上报就绪），始终暴露
contextBridge.exposeInMainWorld('multiPublishMonitor', {
  getCurrentUrl: () => window.location.href,
  reportReady: () => {
    ipcRenderer.send('monitor:page-ready', { url: window.location.href })
  },
})

// 完整 electronAPI：仅双判据通过时挂载（复用 preload/index.js 的聚合暴露与三级鉴权）。
if (verifyHomeShell()) {
  require('./preload/index.js')
}
