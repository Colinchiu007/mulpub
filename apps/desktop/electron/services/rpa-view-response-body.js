// @ts-check
/**
 * rpa-view-response-body.js — RpaViewManager 的 CDP 响应体采集通道
 * （wxmp-save-body-intercept，2026-10-16）
 *
 * ## 为什么有这个模块
 *
 * 1. **真实契约修复**：`_waitForResponseExclusive` 的 resolve 对象缺 `body` 字段
 *    （只有 `{url, statusCode, matchedUrls}`），而 wxmp-draft-mediaid-fix（PR #3445）
 *    补的「响应体 appMsgId」采集通道读 `saveResp.body` ⇒ 真机恒 undefined，
 *    通道从上线起空转。Electron `webRequest` 回调**不携带响应体**，body 只能经
 *    CDP `Network.getResponseBody` 采集。
 * 2. **行数门禁拆分**：`rpa-view-helpers.js` 贴近 500 行上限（debt-guard 新代码
 *    阻断门禁），同族的 CDP 响应体采集逻辑按既有 mixin/composable 范式下沉本模块。
 *
 * ## 三条不可破
 *
 *  ① **降级不阻塞**：debugger attach / Network.enable 任一步失败 ⇒ cdpReady=false，
 *     body 为空串——url/statusCode/matchedUrls 老通道照常工作；
 *  ② **复用他人 attach 不夺走**：attach 已被占时我们仍 enable+监听，但 cleanup
 *     不 detach（防把宿主会话的 debugger 拆掉）；
 *  ③ **getResponseBody 失败不得 reject 整个等待**：单条 body 失败降级为 ''。
 *
 * ## 对外导出
 *
 *  - `createResponseBodyCollector(win, patterns)` — `_waitForResponseExclusive` 用
 *  - `startPublishNetworkCapture(win, options)` — `_startPublishNetworkCapture` 用
 *    （原始响应体只在 parseResponseBody 回调局部作用域使用，禁止写日志/IPC 结果）
 */

const log = require('./logger')

/** CDP 响应体结果 → UTF-8 文本（base64 与明文两种形态统一处理）。 */
function decodeCdpBody (result) {
  if (!result) return ''
  return result.base64Encoded
    ? Buffer.from(result.body || '', 'base64').toString('utf8')
    : String(result.body || '')
}

/** 端点脱敏：只留 origin+pathname，去 query（防 access_token 之类凭证进记录）。 */
function sanitizeCaptureEndpoint (url) {
  try {
    const parsed = new URL(String(url || ''))
    return parsed.origin + parsed.pathname
  } catch (_) {
    return ''
  }
}

/**
 * 为 `_waitForResponseExclusive` 创建响应体采集器。
 * @param {object} win BrowserWindow（或带 webContents.debugger 的窗口形状）
 * @param {string[]} patterns URL 特征（与 _waitForResponseExclusive 同源）
 */
function createResponseBodyCollector (win, patterns) {
  const dbg = win && win.webContents && win.webContents.debugger
  let cdpReady = false
  /** 是否由本模块完成 attach（复用他人 attach 时 cleanup 不得 detach） */
  let weAttached = false

  function urlHit (url) {
    const u = url || ''
    for (let pi = 0; pi < patterns.length; pi++) { if (u.includes(patterns[pi])) return true }
    return false
  }

  /** 按 requestId 取响应体；失败/不可用返回 ''（绝不 reject）。 */
  function fetchBody (requestId) {
    if (!cdpReady || !requestId || !dbg) return Promise.resolve('')
    return dbg.sendCommand('Network.getResponseBody', { requestId })
      .then(function (r) { return decodeCdpBody(r) })
      .catch(function () { return '' })
  }

  /** CDP message 监听工厂：Network.responseReceived 命中 patterns 的 200 响应 → onHit */
  const onCdpMessage = function (onHit) {
    return function (_event, method, params) {
      try {
        if (!params) return
        if (method === 'Network.responseReceived') {
          const resp = params.response || {}
          if (!urlHit(resp.url)) return
          if (resp.status === 200 && typeof onHit === 'function') onHit(resp.url, resp.status, params.requestId)
        }
      } catch (e) { /* CDP 事件处理失败不阻塞 webRequest 通道 */ }
    }
  }

  /** attach + Network.enable；任一步失败 ⇒ 降级（cdpReady=false）。 */
  async function start () {
    if (!dbg || typeof dbg.attach !== 'function' || typeof dbg.sendCommand !== 'function' || typeof dbg.on !== 'function') return
    try { dbg.attach('1.3'); weAttached = true } catch (_e) { /* 已附加时复用既有 attach */ }
    try {
      await dbg.sendCommand('Network.enable')
      cdpReady = true
    } catch (e) {
      cdpReady = false
      log.warn('RpaView', 'response-body collector enable failed (degraded): ' + (e && e.message))
    }
  }

  /** 结束时清理：disable + removeListener + 仅在本模块 attach 过时 detach。 */
  function stop (listener) {
    if (!dbg) return
    if (cdpReady) { try { dbg.sendCommand('Network.disable').catch(function () {}) } catch (_e) { /* ignore */ } }
    if (listener) { try { dbg.removeListener('message', listener) } catch (_e) { /* ignore */ } }
    if (weAttached) { try { dbg.detach() } catch (_e) { /* ignore */ } }
  }

  return { get cdpReady () { return cdpReady }, fetchBody, onCdpMessage, start, stop }
}

/**
 * 发布点击后的网络证据采集（自 helpers 下沉，行为不变）。
 * 只在点击发布前短时开启；原始响应体只在 parseResponseBody 回调局部作用域使用。
 * @param {object} win BrowserWindow
 * @param {{parseResponseBody?: Function}} options
 * @returns {Promise<{records: object[], evidence: object[], stop: Function} | null>}
 */
async function startPublishNetworkCapture (win, options = {}) {
  const dbg = win.webContents.debugger
  const records = []
  const evidence = []
  const responseByRequestId = new Map()
  const pendingBodies = new Set()
  const parseResponseBody = typeof options.parseResponseBody === 'function' ? options.parseResponseBody : null
  const relevant = (url) => /(?:publish|submit|create|article|content|media|video|clue|work)/i.test(url || '')
  let stopped = false
  let listener = null
  const onMessage = async (_event, method, params) => {
    try {
      if (stopped) return
      if (method === 'Network.responseReceived' && relevant(params?.response?.url)) {
        const record = {
          endpoint: sanitizeCaptureEndpoint(params.response.url),
          status: params.response.status,
          mimeType: String(params.response.mimeType || '').slice(0, 160),
        }
        records.push(record)
        responseByRequestId.set(params.requestId, record)
      }
      if (method !== 'Network.loadingFinished') return
      const response = responseByRequestId.get(params.requestId)
      if (!response || !parseResponseBody) return
      const bodyPromise = dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId })
        .then(async result => {
          const body = decodeCdpBody(result)
          const parsedEvidence = await parseResponseBody(body.slice(0, 200 * 1024), { ...response })
          if (parsedEvidence && typeof parsedEvidence === 'object') evidence.push(parsedEvidence)
        })
        .catch(() => {})
      pendingBodies.add(bodyPromise)
      await bodyPromise
      pendingBodies.delete(bodyPromise)
    } catch (_) { /* 页面导航/窗口销毁时网络证据可为空 */ }
  }
  try {
    try { await dbg.attach('1.3') } catch (_) { /* 已附加时继续 */ }
    dbg.on('message', onMessage)
    listener = onMessage
    await dbg.sendCommand('Network.enable')
  } catch (error) {
    try { dbg.removeListener('message', onMessage) } catch (_) { /* ignore */ }
    try { await dbg.detach() } catch (_) { /* ignore */ }
    log.warn('RpaView', 'publish network capture unavailable: ' + error.message)
    return null
  }
  return {
    records,
    evidence,
    async stop () {
      if (stopped) return records.map(record => ({ ...record }))
      stopped = true
      await Promise.allSettled([...pendingBodies])
      try { await dbg.sendCommand('Network.disable') } catch (_) { /* ignore */ }
      try { dbg.removeListener('message', onMessage) } catch (_) { /* ignore */ }
      try { await dbg.detach() } catch (_) { /* ignore */ }
      responseByRequestId.clear()
      return records.map(record => ({ ...record }))
    },
  }
}

module.exports = { createResponseBodyCollector, startPublishNetworkCapture }
