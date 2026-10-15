// @ts-check
/**
 * stealth/inject.js — 主世界注入通道（单一实现）
 *
 * ## 为什么必须是这个通道
 *
 * `contextIsolation:true` 下 preload 运行在**隔离世界**：在其中 `Object.defineProperty(
 * navigator, ...)` 改的是隔离世界的原型，页面主世界毫无感觉。这是本仓存量缺陷
 * （`stealth-preload.js` 的 5 项 patch 从未生效，PRD-OSS-RPA-HARDENING §3.1 E4b 已 spike 确证）。
 *
 * 2026-10-15 用真实 Electron 复测（`scripts/probe-main-world-injection.js`）确认：
 *   - sandbox preload 中 `require('electron').webFrame` **可用**；
 *   - `webFrame.executeJavaScriptInIsolatedWorld(0, [{ code }], true)` 中 **worldId=0 即主世界**，
 *     且代码**早于页面脚本**执行（页面脚本首行即可读到注入结果）；
 *   - 注入代码写在隔离世界的标记，主世界**读不到**（隔离语义成立）。
 *
 * ## 为什么不用 debugger/CDP 通道
 *
 * RPA 上传链路已对同一 webContents 做过 per-op `debugger.attach`，第二个常驻 attach 会抛
 * 「Another debugger is already attached」；CDP 还要处理 fresh window 上 Page 域命令挂起
 * （须 blank bootstrap + 超时竞速）。preload 通道零 attach 生命周期，失败面小得多。
 *
 * ## 关键纪律：注入失败绝不影响页面功能
 *
 * 反检测是**尽力而为**的旁路：`webFrame` 不可用、命令抛错、源码语法错误，都必须只记日志、
 * 不让异常冒泡到 preload 顶层——否则会连带毁掉同文件里的监控桥/法务提示等真实功能。
 */

const { MARKER_KEY, EVASION_IDS, CONTRACT, buildEvasionSource } = require('./evasions')

/** 关闭开关的显式取值（其余任何值都视为未关闭，避免"写错值静默关掉反检测"） */
const DISABLE_VALUES = new Set(['0', 'false', 'off', 'no'])

/**
 * 解析是否启用主世界反检测。
 *
 * 默认**开启**：它的定位是「还原正常浏览器环境」，关掉只会让应用更容易被风控误判。
 * `MP_BROWSER_STEALTH=0` 为一次性回滚开关（配置改一行即回滚，无需回滚代码）。
 *
 * 非法值出声告警而不是静默采用——静默吞掉配置错误会让下一次「反检测失效」又变成无痕迹故障。
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ enabled: boolean, reason: string, rawValue: string|null }}
 */
function resolveStealthEnabled (env) {
  const source = env || (typeof process !== 'undefined' ? process.env : {})
  const raw = source.MP_BROWSER_STEALTH
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { enabled: true, reason: 'default', rawValue: null }
  }
  const normalized = String(raw).trim().toLowerCase()
  if (DISABLE_VALUES.has(normalized)) {
    return { enabled: false, reason: 'explicit-disable', rawValue: String(raw) }
  }
  return { enabled: true, reason: 'explicit-enable', rawValue: String(raw) }
}

/**
 * 注入主世界反检测源码。
 *
 * 返回三态观测所用的读回函数；**所有失败路径都 resolve**，绝不 reject——调用方在 preload
 * 顶层不会也不能处理异步错误。
 *
 * @param {object} options
 * @param {any} options.webFrame - `require('electron').webFrame`（缺失即跳过并报因）
 * @param {string} [options.source] - 覆盖源码（测试用）
 * @param {(message: string) => void} [options.warn] - 告警出口（preload 无 logger 时退化为 no-op）
 * @param {(code: string) => Promise<any>} [options.evaluate] - 覆盖主世界求值（测试用）
 * @returns {{ dispatched: boolean, reason: string, readBack: () => Promise<object> }}
 */
function injectMainWorldEvasions ({ webFrame, source, warn, evaluate } = {}) {
  const warnFn = typeof warn === 'function' ? warn : () => {}

  if (!webFrame || typeof webFrame.executeJavaScriptInIsolatedWorld !== 'function') {
    warnFn('[stealth] webFrame.executeJavaScriptInIsolatedWorld 不可用，主世界反检测未注入（页面功能不受影响）')
    return {
      dispatched: false,
      reason: 'webFrame-unavailable',
      readBack: () => Promise.resolve({ state: CONTRACT.STATE_NO_MARKER, reason: 'webFrame-unavailable' }),
    }
  }

  const code = typeof source === 'string' && source ? source : buildEvasionSource()

  /** 主世界求值：worldId=0。默认走 webFrame；测试可注入替身 */
  const runInMainWorld = typeof evaluate === 'function'
    ? evaluate
    : (scriptCode) => webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: scriptCode }], true)

  // catch 分支一律 return，故 handle 在被读到时必然已赋值（无需 null 初值）
  let handle
  try {
    // 顶层**同步**发起：document-start 语义靠"preload 顶层同步调用"保证，
    // 放进 then/setTimeout 会晚于页面脚本，等于白做（变异反证锁见 inject.test.js）
    handle = runInMainWorld(code)
  } catch (error) {
    const message = (error && error.message) ? error.message : String(error)
    warnFn('[stealth] 主世界注入同步抛错，页面功能不受影响：' + message)
    return {
      dispatched: false,
      reason: 'dispatch-threw:' + message,
      readBack: () => Promise.resolve({ state: CONTRACT.STATE_NO_MARKER, reason: 'dispatch-threw' }),
    }
  }

  /**
   * 三态读回（PRD-OSS-RPA-HARDENING §3.1 第 3 条）：
   *   无标记 ⇒ preload 未执行 / 注入未达主世界
   *   有标记无 done ⇒ 源码执行中途异常
   *   有 done 但 applied 缺项 ⇒ 部分 evasion 失败
   * 读回是**异步**的：观测不等于预防（缺失发生时页面已读过原生值），此处只负责如实告警。
   */
  const readBack = () => Promise.resolve(handle)
    .then(() => runInMainWorld(
      'JSON.stringify((function(){var m=window[' + JSON.stringify(MARKER_KEY) + '];' +
      'if(!m)return{state:' + JSON.stringify(CONTRACT.STATE_NO_MARKER) + '};' +
      'return{state:m.done?' + JSON.stringify(CONTRACT.STATE_DONE) + ':' + JSON.stringify(CONTRACT.STATE_NO_DONE) + ',' +
      'version:m.version,applied:m.applied,failed:m.failed}})())',
    ))
    .then((raw) => {
      // 不写 `= null` 初值：下面 try 与 catch 两条路径都会赋值，初值永不被读到，
      // 留着只会被 no-useless-assignment 判红（本仓 lint 是硬门禁，不是风格建议）
      let parsed
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      } catch (_error) {
        parsed = null
      }
      if (!parsed || typeof parsed !== 'object') {
        warnFn('[stealth] 主世界标记读回结果不可解析，反检测状态未知')
        return { state: 'unreadable', applied: [], failed: [] }
      }
      if (parsed.state !== CONTRACT.STATE_DONE) {
        warnFn('[stealth] 主世界反检测未完整生效：state=' + parsed.state +
          ' applied=' + JSON.stringify(parsed.applied || []) +
          ' failed=' + JSON.stringify(parsed.failed || []))
      } else if (Array.isArray(parsed.failed) && parsed.failed.length > 0) {
        warnFn('[stealth] 主世界反检测部分项失败：' + JSON.stringify(parsed.failed))
      }
      return parsed
    })
    .catch((error) => {
      // 读回失败只说明观测不可用，不代表注入没生效——必须与"注入失败"区分措辞
      warnFn('[stealth] 主世界标记读回失败（注入结果未知）：' + ((error && error.message) || String(error)))
      return { state: 'readback-failed', applied: [], failed: [], error: (error && error.message) || String(error) }
    })

  return { dispatched: true, reason: 'ok', readBack }
}

/**
 * preload 顶层便捷入口：解析开关 → 注入 → 挂读回告警。
 *
 * @param {object} options
 * @param {any} options.webFrame
 * @param {Record<string, string|undefined>} [options.env]
 * @param {(message: string) => void} [options.warn]
 * @returns {{ enabled: boolean, dispatched: boolean, reason: string }}
 */
function installMainWorldEvasions ({ webFrame, env, warn } = {}) {
  const gate = resolveStealthEnabled(env)
  const warnFn = typeof warn === 'function' ? warn : () => {}
  if (!gate.enabled) {
    warnFn('[stealth] 主世界反检测已被 MP_BROWSER_STEALTH=' + gate.rawValue + ' 关闭（平台风控误判概率上升）')
    return { enabled: false, dispatched: false, reason: gate.reason }
  }
  const injection = injectMainWorldEvasions({ webFrame, warn: warnFn })
  if (injection.dispatched) injection.readBack()
  return { enabled: true, dispatched: injection.dispatched, reason: injection.reason }
}

module.exports = {
  DISABLE_VALUES,
  EVASION_IDS,
  resolveStealthEnabled,
  injectMainWorldEvasions,
  installMainWorldEvasions,
}
