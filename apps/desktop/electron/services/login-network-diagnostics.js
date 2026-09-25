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
        (contentLength === null ? '' : ' contentLength=' + contentLength))
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

module.exports = { attachLoginNetworkDiagnostics, classifyNetError }
