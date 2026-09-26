// @ts-check
/**
 * LoginNetworkDiagnostics — 登录页会话级网络诊断
 *
 * 设计动机：微信公众号登录页的二维码由 iframe 加载
 * （open.weixin.qq.com/cgi-bin/mpqrconnect，长轮询走 long.open.weixin.qq.com，
 * 静态资源走 res.wx.qq.com）。iframe 内部请求失败**不触发**外层
 * webContents 的 did-fail-load 事件，应用完全无感知，无法区分
 * 网络/代理问题与应用自身问题。
 *
 * 因此改用 session.webRequest 会话级监听——它能观察到该 session 分区上
 * 包括 iframe 在内的所有请求。仅记录与聚合，不干预请求本身：
 *   1. 请求失败（onErrorOccurred）→ 分类提示（代理/DNS/连接）
 *   2. 关键端点 HTTP >= 400（onCompleted）→ warn/info 记录
 *   3. 挂接时探测代理解析路径（resolveProxy）→ 直接回答"二维码请求会走哪个代理"
 *   4. 出码计时（onCompleted）→ getqrcode 每次完成的相对耗时与响应体长度，
 *      用于回答"二维码刷了很久才显示"里到底是首码迟到，还是 200 空体被反复重试
 *
 * 通过 attachLoginNetworkDiagnostics 同时挂到账号 session（persist:account-*）与
 * 登录视图 session（persist:auth-*）上；幂等标记防止同一 session 被多个登录标签复用时监听器翻倍。
 */
const log = require('./logger')

// 监听微信登录链路全部域名（覆盖 mp/open/long.open/res.wx 等子域）
const URL_FILTERS = [
  '*://*.weixin.qq.com/*',
  '*://*.wx.qq.com/*',
  '*://weixin.qq.com/*',
  '*://wx.qq.com/*'
]

/**
 * net 错误码 → 用户可执行的排查提示（纯函数，便于单测）
 * @param {string} error - Electron net 错误码（如 ERR_PROXY_CONNECTION_FAILED）
 * @returns {string} 中文提示文案
 */
function classifyNetError (error) {
  if (error === 'ERR_PROXY_CONNECTION_FAILED' ||
      error === 'ERR_TUNNEL_CONNECTION_FAILED' ||
      error === 'ERR_PROXY_AUTH_REQUESTED') {
    return '代理不可达或认证失败：检查系统代理与账号代理设置'
  }
  if (error === 'ERR_NAME_NOT_RESOLVED') {
    return 'DNS 解析失败：可能为代理 fake-IP 残留，建议 ipconfig /flushdns'
  }
  if (error === 'ERR_CONNECTION_TIMED_OUT' ||
      error === 'ERR_CONNECTION_RESET' ||
      error === 'ERR_CONNECTION_REFUSED') {
    return '连接失败：检查防火墙/代理节点可用性'
  }
  return '网络异常，请检查本机网络'
}

/**
 * 是否为二维码关键端点（mpqrconnect / qrconnect）
 * @param {string} url
 * @returns {boolean}
 */
function isQrConnectUrl (url) {
  return typeof url === 'string' && (url.indexOf('mpqrconnect') !== -1 || url.indexOf('qrconnect') !== -1)
}

// 出码端点：二维码字节本体的获取路径。刻意不含 l/qrconnect —— 那是 15s 一轮的
// 长轮询，计入会无限刷屏并掩盖"首码到底几秒到达"这个唯一要回答的问题。
const QR_IMAGE_MARKER = 'getqrcode'
// 出码尝试日志上限：微信码约 30s 过期刷新，长时间停留在登录页会持续产生请求
const QR_IMAGE_LOG_LIMIT = 6

/**
 * 是否为出码端点（二维码图片本体的获取路径）
 * @param {string} url
 * @returns {boolean}
 */
function isQrImageUrl (url) {
  return typeof url === 'string' && url.indexOf(QR_IMAGE_MARKER) !== -1
}

/**
 * 从 webRequest 响应头里取 Content-Length（大小写不敏感）
 * webRequest 不保证暴露响应体大小，取不到时返回 null 由调用方省略字段
 * @param {any} details
 * @returns {string|null}
 */
function readContentLength (details) {
  const headers = details && details.responseHeaders && details.responseHeaders.headers
  if (!Array.isArray(headers)) return null
  for (let i = 0; i < headers.length; i++) {
    const name = headers[i] && headers[i].name
    if (typeof name === 'string' && name.toLowerCase() === 'content-length') {
      return String(headers[i].value)
    }
  }
  return null
}

/**
 * 在 session 上挂接登录网络诊断监听（幂等，重复调用直接 return）
 * @param {Electron.Session} ses - 登录用 session（persist:account-* 账号分区 / persist:auth-* 登录视图分区）
 * @param {{platform?: string, accountId?: string}} [ctx] - 标签上下文，用于日志定位
 */
function attachLoginNetworkDiagnostics (ses, ctx) {
  if (!ses || ses.__loginNetDiagAttached) return
  ses.__loginNetDiagAttached = true

  var platform = (ctx && ctx.platform) || 'unknown'
  var accountId = (ctx && ctx.accountId) || 'unknown'
  var tag = '[' + platform + '/' + accountId + '] '
  var filter = { urls: URL_FILTERS }
  // 挂接点即计时原点：openLogin 在 loadURL 前一刻挂上，相对耗时可直接当作"首屏到出码"
  const attachedAt = Date.now()
  let qrImageCount = 0

  // 请求失败：iframe 内部失败也能在此捕获；ERR_ABORTED 属正常导航取消，跳过降噪
  ses.webRequest.onErrorOccurred(filter, function (details) {
    if (!details || details.error === 'ERR_ABORTED') return
    log.warn('LoginNetDiag', tag + 'request failed: ' + String(details.url).slice(0, 120) +
      ' error=' + details.error +
      (details.ip ? ' ip=' + details.ip : '') +
      ' → ' + classifyNetError(details.error))
  })

  // 关键端点 HTTP >= 400：二维码端点告警，其余普通记录
  ses.webRequest.onCompleted(filter, function (details) {
    var status = details && details.statusCode

    // 出码计时：从挂接点（openLogin 在 loadURL 前一刻挂上）到二维码字节到达的相对耗时。
    // 反复刷新的次数本身就是症状 —— contentLength=0 即 #1888 记录的"200 空体静默拒绝"特征。
    // 只在此处记，不另设监听器：既有契约要求 onCompleted 在单 session 上注册恰好一次。
    if (isQrImageUrl(details && details.url) && qrImageCount < QR_IMAGE_LOG_LIMIT) {
      qrImageCount += 1
      const contentLength = readContentLength(details)
      log.info('LoginNetDiag', tag + 'qr response #' + qrImageCount +
        ' after ' + (Date.now() - attachedAt) + 'ms' +
        ' status=' + status +
        // 跨域 iframe 的 responseHeaders 会被 Chromium 屏蔽，取不到时显式标 redacted，
        // 否则读日志的人会以为"这行本来没这个字段"，而漏掉 200 空体这一关键特征
        ' contentLength=' + (contentLength === null ? 'redacted' : contentLength))
    }

    if (typeof status !== 'number' || status < 400) return
    var msg = tag + 'HTTP ' + status + ' ' + String(details.url).slice(0, 120)
    if (isQrConnectUrl(details.url)) {
      log.warn('LoginNetDiag', msg)
    } else {
      log.info('LoginNetDiag', msg)
    }
  })

  // 挂接时探测代理解析路径：结果（如 "DIRECT" 或 "PROXY 127.0.0.1:7892"）
  // 直接回答"二维码请求会走哪个代理"
  try {
    Promise.resolve(ses.resolveProxy('https://open.weixin.qq.com/')).then(function (result) {
      log.info('LoginNetDiag', tag + 'proxy for open.weixin.qq.com → ' + result)
    }).catch(function (e) {
      log.warn('LoginNetDiag', tag + 'resolveProxy failed: ' + ((e && e.message) || 'unknown'))
    })
  } catch (e) {
    log.warn('LoginNetDiag', tag + 'resolveProxy failed: ' + ((e && e.message) || 'unknown'))
  }
}

/**
 * 登录关键端点的「响应体」诊断——复用 auth-view-cdp 已 attach 的 debugger，
 * 只 enable Network 并被动查询响应，不拦截、不改写、不新增第二个 attach。
 *
 * 为什么不用 session.webRequest：知乎等平台的风控拒绝常以 HTTP 200 +
 * `{"error":{"code","message"}}` 返回，状态码口径看不到拒绝原因；
 * 而 Fetch.requestPaused 拦截会改变登录热路径时序（#2353、头条标签卡死同类风险）。
 *
 * 日志只允许落「端点 + 状态码 + error.code + error.message」四类字段：
 * 整体转储响应体会把手机号 / token / 昵称写进可被用户上传的反馈日志里。
 *
 * @param {{ on: Function, sendCommand: Function } | null | undefined} debuggerObj
 * @param {{ platform?: string, accountId?: string }} [ctx]
 * @returns {boolean} 是否已挂接（未登记的平台返回 false，零新增监听面）
 */
function attachAuthResponseDiagnostics (debuggerObj, ctx) {
  if (!debuggerObj || typeof debuggerObj.on !== 'function' || typeof debuggerObj.sendCommand !== 'function') return false
  var platform = (ctx && ctx.platform) || 'unknown'
  if (!AUTH_ENDPOINT_MATCHERS[platform]) return false
  if (debuggerObj.__loginRespDiagAttached) return true
  debuggerObj.__loginRespDiagAttached = true

  var tag = '[' + platform + '/' + ((ctx && ctx.accountId) || 'unknown') + '] '
  var urlByRequestId = new Map()

  // Network.enable 失败（域不可用 / debugger 实际未 attach）只降级为「收不到事件」，
  // 绝不让观测代码影响登录本身。
  try {
    Promise.resolve(debuggerObj.sendCommand('Network.enable')).catch(function () { /* fail-open */ })
  } catch (_e) { /* fail-open */ }

  // Network.loadingFailed 事件本身不带 url，必须在发请求时按 requestId 登记
  var remember = function (requestId, safeUrl) {
    if (urlByRequestId.size >= MAX_TRACKED_REQUESTS) urlByRequestId.delete(urlByRequestId.keys().next().value)
    urlByRequestId.set(requestId, safeUrl)
  }

  debuggerObj.on('message', async function (_event, method, params) {
    try {
      var requestId = params && params.requestId

      if (method === 'Network.requestWillBeSent') {
        var sentUrl = params && params.request && params.request.url
        if (requestId && matchesAuthEndpoint(platform, sentUrl)) remember(requestId, diagnosticUrl(sentUrl))
        return
      }

      if (method === 'Network.loadingFailed') {
        if (!requestId || !urlByRequestId.has(requestId)) return
        var failedUrl = urlByRequestId.get(requestId)
        urlByRequestId.delete(requestId)
        var errorText = (params && params.errorText) || '<unknown>'
        if (errorText === 'ERR_ABORTED') return
        log.warn('LoginRespDiag', tag + '关键端点请求失败 url=' + failedUrl +
          ' netError=' + errorText + ' → ' + classifyNetError(errorText))
        return
      }

      if (method !== 'Network.responseReceived') return
      var response = params && params.response
      var url = response && response.url
      if (!matchesAuthEndpoint(platform, url)) return

      var status = typeof response.status === 'number' ? response.status : 0
      var bodyText = ''
      try {
        var result = await debuggerObj.sendCommand('Network.getResponseBody', { requestId: requestId })
        // base64（图片等）一律不解析，避免把二进制片段写进日志
        if (result && !result.base64Encoded) bodyText = String(result.body || '')
      } catch (_e) { bodyText = '' }

      var authError = extractAuthError(bodyText)
      if (!authError && status < 400) { urlByRequestId.delete(requestId); return }
      log.warn('LoginRespDiag', tag + '关键端点被拒 url=' + diagnosticUrl(url) +
        ' http=' + status +
        ' code=' + (authError ? authError.code : '<none>') +
        ' message=' + (authError ? authError.message : '<none>'))
      urlByRequestId.delete(requestId)
    } catch (e) {
      log.info('LoginRespDiag', tag + '诊断自身异常: ' + ((e && e.message) || 'unknown'))
    }
  })

  return true
}

// 需要观察登录拒绝原因的平台；未登记平台不挂接，避免无谓的 CDP 事件量
const AUTH_ENDPOINT_MATCHERS = {
  zhihu: {
    hosts: ['www.zhihu.com', 'zhihu.com'],
    path: /\/api\/v4\/(signin|signup|sms|captcha|verify|check_exists)/,
  },
}

const MAX_TRACKED_REQUESTS = 64
const MAX_MESSAGE_CHARS = 80

// 只保留 scheme+host+path：知乎短信请求的 query 会带手机号
function diagnosticUrl (url) {
  if (typeof url !== 'string' || !url) return '<unknown>'
  return url.split('?')[0].split('#')[0]
}

function matchesAuthEndpoint (platform, url) {
  var rule = AUTH_ENDPOINT_MATCHERS[platform]
  if (!rule || typeof url !== 'string' || !url) return false
  var host = ''
  try { host = new URL(url).hostname } catch (_e) { return false }
  var onPlatformHost = rule.hosts.some(function (h) { return host === h || host.endsWith('.' + h) })
  return onPlatformHost && rule.path.test(url)
}

// 返回 null 表示「没有业务错误」；返回对象表示确实拿到了拒绝原因
function extractAuthError (bodyText) {
  if (typeof bodyText !== 'string' || !bodyText) return { code: '<none>', message: '<unparsable>' }
  var parsed
  try { parsed = JSON.parse(bodyText) } catch (_e) { return { code: '<none>', message: '<unparsable>' } }
  if (!parsed || typeof parsed !== 'object') return null
  var err = parsed.error
  if (!err || typeof err !== 'object') return null
  var code = (typeof err.code === 'string' || typeof err.code === 'number') ? String(err.code) : '<invalid>'
  var rawMessage = typeof err.message === 'string' ? err.message
    : (err.message === undefined ? '<none>' : '<non-string>')
  var message = rawMessage.length > MAX_MESSAGE_CHARS
    ? rawMessage.slice(0, MAX_MESSAGE_CHARS) + '...'
    : rawMessage
  return { code: code, message: message }
}

module.exports = { attachLoginNetworkDiagnostics, attachAuthResponseDiagnostics, classifyNetError }
