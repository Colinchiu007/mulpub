'use strict'

/**
 * dev 环境渲染层 HTTP 缓存治理（dev-cache-guard）
 *
 * 事故与根因的完整取证见 `openspec/records/dev-http-cache-guard.md`（四层定位：
 * 源码/磁盘产物/HTTP 响应都含正确导出，唯独**渲染层** import 到旧副本）。
 * 一句话：Vite 对预构建产物发 `immutable`，而 `?v=<hash>` 指纹不含 workspace 源码内容
 * ⇒ 源码变了 URL 没变 ⇒ Chromium 命中旧条目且不校验（Ctrl+Shift+R 也未必救得回来）。
 *
 * 修复必须两条腿（缺一不可）：
 *   ① 启动时清一次 HTTP 缓存 —— 杀掉**已经**被污染的条目；
 *   ② 对 dev server origin 强制 `no-store` —— 挡住**再次**污染。
 * 只做 ① 挡不住再次污染；只做 ② 清不掉已污染的旧副本（实测正是后者造成"改了不生效"）。
 *
 * 打包状态优先于开发环境变量（AGENTS.md QM-2）：只有 `app.isPackaged === false` 才接管；
 * 任何「开发环境变量」一律不读。测试里有源码结构锁钉住这一点。
 */

/** 兜底 filter：本机回环**所有端口**。仅在拿不到 dev server origin 时使用——
 *  它同时会改写本机其他服务（后端 18357 / prompt 21157…）的缓存语义（CCG i5）。 */
const DEV_URL_FILTERS = [
  'http://127.0.0.1:*/*',
  'http://localhost:*/*',
  'http://[::1]:*/*',
  'https://127.0.0.1:*/*',
  'https://localhost:*/*',
  'https://[::1]:*/*',
]

const NO_STORE_VALUE = 'no-store, no-cache, must-revalidate, max-age=0'

/**
 * 回环 host 判据（不含端口/路径）——用 URL 解析后的 hostname 比对，绝不用子串。
 *
 * 覆盖 `127.0.0.0/8` **整段**而非只认 `127.0.0.1`：dev server 绑到 `127.0.0.2`
 * 一类地址时，`devServerUrl` 生成的精确 filter 仍会命中，但若判定只认 `.1`，
 * handler 会把响应当"非 dev server"原样透传 ⇒ 守卫静默漏网（CCG 第三轮 i8）。
 *
 * `localhost` 与 IPv6 `::1` 单列（IPv6 先经 normalizeHostname 去方括号）。
 */
function isLoopbackHost (hostname) {
  const h = normalizeHostname(hostname)
  if (h === 'localhost' || h === '::1') return true
  // 严格四段点分十进制：`1270.0.0.1`（少点）与 `127.0.0.1.evil.test` 都不匹配
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
}

/**
 * 归一化 hostname：`new URL('http://[::1]:5231/').hostname` 返回**带方括号**的
 * `'[::1]'`，与 `'::1'` 是同一主机的两种写法。不去括号就要在 Set 里放两个条目，
 * 一旦有人只改一处就会出现"看起来支持 IPv6、其实漏一半"的静默缺口（CCG 第二轮 i4）。
 */
function normalizeHostname (hostname) {
  if (typeof hostname !== 'string') return ''
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

/** 同一 session 只装一次（仅在**注册成功**后标记，否则一次瞬时失败会永久锁死重试）。 */
const guardedSessions = new WeakSet()

/**
 * 判断 URL 是否指向本机 dev server。
 *
 * 必须用 `new URL()` 解析后比对 hostname：子串判据（"包含 127.0.0.1"）会被
 * `https://evil.test/127.0.0.1:5231/x.js` 与 `https://localhost.evil.test/` 穿透，
 * 那会让 `no-store` 改写到第三方响应上（平台登录态/接口缓存行为被改变）。
 *
 * @param {string | undefined | null} url
 * @returns {boolean}
 */
function isDevServerUrl (url) {
  if (typeof url !== 'string' || url === '') return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return isLoopbackHost(parsed.hostname)
}

/**
 * 由 dev server URL 构造**精确到端口**的 filter（CCG i5）。
 *
 * 拿不到 origin / 非回环 / 无端口 / IPv6 字面量时一律回落兜底集：
 *   - IPv6（`[::1]`）刻意不构造 filter —— Chromium URL pattern 对它的接受度未经证实，
 *     而"注册时抛错"的代价是 dev 启动直接崩（CCG i2），收益远小于风险。
 *
 * @param {string} [devServerUrl]
 * @returns {string[]}
 */
function buildDevUrlFilters (devServerUrl) {
  if (typeof devServerUrl !== 'string' || devServerUrl === '') return DEV_URL_FILTERS
  let parsed
  try {
    parsed = new URL(devServerUrl)
  } catch {
    return DEV_URL_FILTERS
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return DEV_URL_FILTERS
  if (!isLoopbackHost(parsed.hostname)) return DEV_URL_FILTERS
  if (normalizeHostname(parsed.hostname).includes(':')) return DEV_URL_FILTERS // IPv6 字面量：走兜底
  if (!parsed.port) return DEV_URL_FILTERS
  return [`${parsed.protocol}//${parsed.hostname}:${parsed.port}/*`]
}

/** 把响应头里的缓存校验位抹成 no-store；其余头原样保留。 */
function rewriteCacheHeaders (responseHeaders) {
  const out = {}
  for (const [key, value] of Object.entries(responseHeaders || {})) {
    const lower = key.toLowerCase()
    // ETag/Last-Modified 是"再校验"的依据：留着它 Chromium 仍可按协商缓存复用旧条目。
    if (lower === 'etag' || lower === 'last-modified') continue
    // 缓存头一律输出为规范大小写 Cache-Control，不沿用入参大小写——入参大小写由
    // Chromium 版本决定（实测可能回小写），输出必须稳定，否则调用方无法用固定键名读取。
    if (lower === 'cache-control') continue
    out[key] = value
  }
  out['Cache-Control'] = [NO_STORE_VALUE]
  return out
}

/** 旁路观测：任何失败都只 warn，绝不阻断启动。 */
function warn (log, event, error) {
  if (log && typeof log.notify === 'function') {
    log.notify('dev-cache-guard', event, {
      level: 'WARN',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 安装 dev 缓存守卫。
 *
 * 必须在窗口 `loadURL(dev server)` **之前**调用，否则首屏那份缓存仍会写进磁盘
 * （window.js 有接线锁断言先后）。
 *
 * fail-open：任何一格失败都只降级/告警，绝不抛错——dev 启动崩掉的代价远大于缓存旧副本。
 *
 * @param {{ app?: any, session?: any, log?: { notify?: Function }, devServerUrl?: string }} deps
 * @returns {{ installed: boolean, reason?: 'packaged'|'no-session'|'unsupported-session'|'already-installed'|'headers-rewrite-unavailable' }}
 */
function installDevCacheGuard (deps) {
  const { app, session, log, devServerUrl } = deps || {}

  // ① 打包状态优先：非明确未打包一律不接管（fail-closed）
  if (!app || app.isPackaged !== false) {
    return { installed: false, reason: 'packaged' }
  }

  // ② 能力缺失 → 不接管（夹具 session 或 Electron 版本差异）
  if (!session || typeof session !== 'object') {
    return { installed: false, reason: 'no-session' }
  }
  if (typeof session.clearCache !== 'function' ||
      !session.webRequest || typeof session.webRequest.onHeadersReceived !== 'function') {
    return { installed: false, reason: 'unsupported-session' }
  }

  // ③ 幂等：已成功装过就不再注册（标记只在注册成功后写入）
  if (guardedSessions.has(session)) {
    return { installed: false, reason: 'already-installed' }
  }

  // ④ 腿①：杀掉已污染的旧条目。**必须可被 await**（clearCache 是异步的）——
  //    若在它落定前就 loadURL，Chromium 可能仍从磁盘命中旧条目，而旧条目是
  //    immutable 时**不会发起网络请求** ⇒ 腿② 的 onHeadersReceived 根本不触发
  //    ⇒ 首屏仍是旧副本（症状原样复现）。调用方在 loadURL 前 await cacheCleared。
  //    该 Promise 永不 reject（失败只 warn 并落定），否则调用方一个未捕获拒绝
  //    反而会阻断加载。
  let cacheCleared = Promise.resolve()
  try {
    const cleared = session.clearCache()
    if (cleared && typeof cleared.then === 'function') {
      cacheCleared = cleared.then(
        () => undefined,
        (error) => {
          warn(log, 'clear-cache-failed', error)
          return undefined
        }
      )
    }
  } catch (error) {
    warn(log, 'clear-cache-threw', error)
  }

  // ⑤ 腿②：对 dev server origin 强制 no-store，挡住再次污染。
  //    非回环 URL 一律原样透传（第三方响应不被改写）。
  //    注册本身可能因 URL pattern 被拒而**同步抛错**（CCG i2）⇒ 必须包 try/catch：
  //    dev 启动崩掉的代价远大于"没有守卫"，宁可降级为只清缓存。
  let headersGuardOn = false
  try {
    session.webRequest.onHeadersReceived({ urls: buildDevUrlFilters(devServerUrl) }, (details, callback) => {
      try {
        if (typeof callback !== 'function') return
        if (!isDevServerUrl(details && details.url)) {
          callback({ responseHeaders: (details && details.responseHeaders) || {} })
          return
        }
        callback({ responseHeaders: rewriteCacheHeaders(details.responseHeaders) })
      } catch (error) {
        // 改写失败时退化为放行原样头——吞掉回调会让请求挂死，比缓存旧副本更糟。
        warn(log, 'rewrite-failed', error)
        if (typeof callback === 'function') {
          callback({ responseHeaders: (details && details.responseHeaders) || {} })
        }
      }
    })
    headersGuardOn = true
  } catch (error) {
    warn(log, 'headers-rewrite-registration-failed', error)
  }

  if (!headersGuardOn) {
    // 清缓存那条腿已经生效，但"挡住再次污染"缺位 ⇒ installed=true 且带降级 reason，
    // 让调用方能把它记进日志（防静默 no-op）。
    return { installed: true, reason: 'headers-rewrite-unavailable', cacheCleared }
  }

  guardedSessions.add(session)
  return { installed: true, cacheCleared }
}

module.exports = {
  installDevCacheGuard,
  isDevServerUrl,
  buildDevUrlFilters,
  rewriteCacheHeaders,
  DEV_URL_FILTERS,
  NO_STORE_VALUE,
}
