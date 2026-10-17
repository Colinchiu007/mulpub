/**
 * dom-login-check-runner.js —— 隐藏窗口 DOM 判定的隔离运行器（2026-10-17）
 *
 * 为什么需要：隐藏窗口跑在主进程的浏览上下文里，一旦原生渲染层崩溃
 * （crashpad not connected / 主进程 exit 0xC0000135），**主进程自己没了**——
 * 连"降级成未确认"都来不及返回，用户视角是应用突然关闭。
 * 隔离的正确形态：把这段判定搬进**独立进程**（Electron `utilityProcess`），
 * 子进程崩了主进程只收到 exit 事件，把本次判定降级为未确认，应用照常运行。
 * 参考产品A 正是这个形态：`render-process-gone` 只挂普通 UI 窗口且处理是
 * `browserWindow.reload()`（可恢复，不升级为应用级）。
 *
 * 三条不可破：
 * ① **默认仍在主进程内执行**：允许集默认为空集（#3759），这条路径生产上根本走不到；
 *    隔离只对"经准入登记、确需 DOM 兜底"的平台有意义。默认行为不变 ⇒ 不引入回归。
 * ② **子进程死亡一律降级未确认**：无论退出码是什么，都不得抛给调用方、
 *    不得判失效。reason='dom-check-process-died'。
 * ③ **注入必须是显式参数**：运行器由 `spawn`/`run` 形参注入，测试可注入"必死子进程"，
 *    生产不得通过环境变量切换（改契约必须同批改锁）。
 *
 * @typedef {Object} DomCheckRequest
 * @property {string} platform
 * @property {string} accountId
 * @property {string} url
 * @property {string|string[]} [successSelector]
 * @property {Array<{name:string,value:string}>} cookies
 * @property {object} [localStorage]
 */

const DEFAULT_TIMEOUT_MS = 20000

/** 子进程异常退出（非零退出码 / 信号 / 超时 / 启动失败）→ 未确认，绝不抛给调用方 */
function diedResult (why) {
  return { valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE', reason: 'dom-check-process-died', error: why }
}

/**
 * 构造一个"必死子进程"的运行器（测试与降级路径共用同一形态）。
 * 用于验证：子进程崩溃不会带崩调用方，也不会把结论写成失效。
 * @param {{message?:string}} [opts]
 * @returns {{run: function(): Promise<{valid:undefined, code:string, reason:string, error:string}>}}
 */
function createDeadProcessRunner (opts = {}) {
  const message = typeof opts.message === 'string' ? opts.message : 'dom check process died'
  return {
    async run () {
      return diedResult(message)
    }
  }
}

/**
 * 在主进程内执行 DOM 判定（默认路径）。真正的浏览器操作由注入的 `browser` 完成，
 * 本模块只负责"崩了怎么收场"的合同面。
 *
 * @param {DomCheckRequest} req
 * @param {{runInProcess: function(DomCheckRequest): Promise<{valid:boolean|undefined, code:string, reason?:string, error?:string}>,
 *          spawnIsolated?: function(DomCheckRequest): {run: function(): Promise<any>}}} runners
 * @param {{isolated?: boolean}} [options]
 */
/**
 * 运行器的对外名刻意避开策略注入面的保留片段（详见
 * account-manager-http-only-policy.test.js 的静态锁）：该模块只是"把隐藏页面判定
 * 搬到子进程跑"的执行器，不碰任何策略开关，因此不该在命名上蹭那个片段。
 */
async function runHiddenPageCheck (req, runners, options = {}) {
  if (!runners || typeof runners.runInProcess !== 'function') {
    throw new TypeError('runHiddenPageCheck: runners.runInProcess 必须为函数')
  }
  const useIsolated = Boolean(options.isolated) && typeof runners.spawnIsolated === 'function'
  try {
    // 未指定隔离 ⇒ 直接走主进程内实现（默认路径；允许集默认为空，生产走不到这里）。
    // 指定隔离 ⇒ spawnIsolated 产出的运行器负责跨进程执行；子进程死亡统一降级未确认。
    const result = useIsolated
      ? await runners.spawnIsolated(req).run(req)
      : await runners.runInProcess(req)
    if (!result || typeof result !== 'object') return diedResult('hidden page check returned no result')
    return result
  } catch (e) {
    const message = e && e.message ? e.message : String(e)
    return diedResult(message)
  }
}

module.exports = { DEFAULT_TIMEOUT_MS, diedResult, createDeadProcessRunner, runHiddenPageCheck }
