// @ts-check
'use strict'
/**
 * external-protocol-guard.js — 内嵌视图的「外部协议守卫」
 *
 * 存在理由（2026-10-21 现场事故）：
 * 账号页抖音账号失效 → 点卡片 → 应用内标签打开抖音创作者登录页；**同一时刻** Windows 弹出系统对话框
 * 「获取打开此'bitbrowser'链接的应用 / 你的电脑没有可打开此链接的应用」。
 * 取证结论：该对话框是 Windows 的「未注册协议」提示框——系统被要求打开一个 `bitbrowser://` 开头的链接，
 * 而本机没有任何程序注册该协议（`HKCU\Software\Classes\bitbrowser`、`HKLM\SOFTWARE\Classes\bitbrowser` 均不存在）。
 * 本应用自身不产生该协议（全仓 0 命中；唯一交给系统的地方 `electron/window.js` 的 `openExternalUrl`
 * 被 `isAllowedExternalUrl` 硬拦为 http/https）。
 *
 * 但事故暴露了本应用自己的一个洞：**加载平台真实页面的内嵌视图没有装协议守卫**。
 * Electron 的默认行为是——页面发起 `window.open('xxx://…')` 或主框架导航到自定义协议时，
 * Chromium 把它当**外部协议**交给操作系统 → 系统找不到处理程序 → 弹「选择打开方式」。
 * 也就是说，平台登录页里任何一段第三方脚本（广告 / SDK / 跳端逻辑）都可能把系统弹窗顶到用户脸上。
 * 本模块把这类请求**拦在应用内**，并留一条可检索的 WARN 日志。
 *
 * 判据口径（与仓库既有约定一致）：
 *   · 协议白名单走**共享实现** `packages/shared-utils/src/safe-http-url.js`（`safeHttpUrl`），
 *     本模块**不自带协议正则**——否则就成了第二份协议判定（`apps/desktop/src/href-scheme-contract.test.js`
 *     的「单一口径接线锁」会判红）。
 *   · 在共享实现之上**再加一档更严**：拒绝带 userinfo（`username` / `password`）的 URL。
 *     `safeHttpUrl` 是前缀判定，`https://user:secret@host/` 会被它放行；导航面交给的是
 *     「让页面跳去哪儿」，带 userinfo 属伪装凭据，必须挡。
 *   · 与 `electron/window.js` 的 `isAllowedExternalUrl`（OS 打开面）**刻意不合并**：
 *     仓库既有约定是「按 sink 分策略」（01-docs/PRD-HREF-SCHEME-GUARD-2026-09-29.md §5.1），
 *     且 window.js 那份被合同测试钉在原地（必须含 `url.username`、必须写明与 safe-http-url 的关系），本模块不动它。
 *
 * 放行/拦截语义：
 *   · `setWindowOpenHandler`：http(s) → `{action:'allow'}`（= Electron 默认新开窗，与守卫接入前一致）；
 *     其余协议 → `{action:'deny'}` + WARN。
 *   · `will-navigate`：http(s) → 放行（登录重定向链依赖它）；其余协议 → `preventDefault()` + WARN。
 *   · `will-navigate` 只对**主框架**触发，iframe 里的 `data:`/`blob:` 图片不在拦截面内（不误伤二维码/验证码图）。
 */

const { safeHttpUrl } = require('@multi-publish/shared-utils/src/safe-http-url')
const log = require('./logger')

/** 统一日志模块名（不按视图分裂，tag 进 params，便于一次 grep 看全部） */
const LOG_MODULE = 'ExternalProtocolGuard'

/** 日志里 URL 的最大长度（避免超长 URL 撑爆日志行） */
const LOGGED_URL_MAX = 200

/**
 * 已装守卫的 webContents 登记表（WeakMap：随对象回收，不留强引用）。
 * 为什么需要：CCG 外部评审 i1（Critical）——重复对同一个 webContents 调用本函数会
 * **叠加** `will-navigate` 监听器（`setWindowOpenHandler` 是 setter，重复调用只会覆盖，
 * 不会叠加），后果是拦截日志每次写两遍。当前五个接线点都"一次新建、一次安装"，
 * 但那是调用纪律而不是机制保证；这里用登记表把"重复安装"变成**不可能**而不是"不该发生"。
 * @type {WeakMap<object, { installed: boolean, navigationInstalled: boolean, blockedWindowOpen: number, blockedNavigation: number }>}
 */
const INSTALLED_GUARDS = new WeakMap()

/**
 * 导航面判据：是否允许这个 URL 在应用内导航 / 开新窗。
 * @param {unknown} rawUrl
 * @returns {boolean} http(s) 且不带 userinfo 才为 true
 */
function isAllowedNavigationUrl (rawUrl) {
  // 协议判定交给共享实现（本模块不写协议正则）
  const httpUrl = safeHttpUrl(rawUrl)
  if (!httpUrl) return false
  try {
    const parsed = new URL(httpUrl)
    return !parsed.username && !parsed.password
  } catch (_) {
    return false
  }
}

/**
 * 给一个 webContents 装外部协议守卫。
 *
 * @param {any} webContents Electron 的 webContents
 * @param {{ tag?: string }} [options] tag = 视图标识（auth-view / qrcode-login / oauth / rpa-view / silent-auth）
 * @returns {{ installed: boolean, navigationInstalled: boolean, blockedWindowOpen: number, blockedNavigation: number }}
 */
function attachExternalProtocolGuard (webContents, options = {}) {
  const tag = typeof options.tag === 'string' && options.tag ? options.tag : 'unknown'
  const state = {
    installed: false,
    navigationInstalled: false,
    blockedWindowOpen: 0,
    blockedNavigation: 0,
  }
  if (!webContents || typeof webContents !== 'object') return state

  // 幂等（CCG 外部评审 i1）：同一 webContents 已装过守卫 ⇒ 直接返回既有状态，
  // 不再叠加 will-navigate 监听器（否则一次拦截会写两遍日志）。
  const existing = INSTALLED_GUARDS.get(webContents)
  if (existing) return existing

  const record = (source, url) => {
    if (source === 'window-open') state.blockedWindowOpen += 1
    else state.blockedNavigation += 1
    try {
      log.notify(LOG_MODULE, 'external-protocol-blocked', {
        level: 'WARN',
        params: {
          tag,
          source,
          url: String(url == null ? '' : url).slice(0, LOGGED_URL_MAX),
        },
      })
    } catch (_) {
      // 日志失败不得影响拦截本身
    }
  }

  if (typeof webContents.setWindowOpenHandler === 'function') {
    webContents.setWindowOpenHandler(function (details) {
      const url = details && details.url
      if (isAllowedNavigationUrl(url)) return { action: 'allow' }
      record('window-open', url)
      return { action: 'deny' }
    })
    state.installed = true
  }

  if (typeof webContents.on === 'function') {
    webContents.on('will-navigate', function (event, url) {
      if (isAllowedNavigationUrl(url)) return
      try {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
      } catch (_) { /* ignore */ }
      record('navigation', url)
    })
    state.navigationInstalled = true
  }

  INSTALLED_GUARDS.set(webContents, state)
  return state
}

module.exports = { isAllowedNavigationUrl, attachExternalProtocolGuard }
