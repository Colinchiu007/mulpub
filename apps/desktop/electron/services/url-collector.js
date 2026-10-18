// @ts-check
/**
 * URL Collector — URL 内容采集引擎（输入 URL → 标题/正文/封面/发布时间）
 *
 * 采集通道按站点路由（清单见 url-collector-antibot.js）：
 *   1. HTTP 请求 + Cheerio 解析（轻量；百家号 HTTP 优先，命中验证页才回退浏览器）
 *   2. Playwright stealth 浏览器（知乎等反爬/SPA 站点，浏览器优先）
 *
 * 文件位置: apps/desktop/electron/services/url-collector.js
 */
const log = require('./logger')
const EC = require('../core/error-codes').ERROR
const {
  CollectionStrategy,
  RateLimiter,
  CircuitBreaker,
  CoolDownPool,
  ContentCache,
  AuditLogger,
  HealthMonitor,
} = require('@multi-publish/collection-engine')
const path = require('path')
const { extractReadableText } = require('./readable-text')
const { parseEngagement, parseEngagementNumber } = require('./url-collector-engagement')
// Page 等待/容错、反爬判据与请求头、通道编排（验证页重试 / HTTP 优先回退）分别拆在
// url-collector-page-wait.js、url-collector-antibot.js、url-collector-browser.js（本文件只做装配；
// 拆出动机：本文件已贴着逐文件行数门禁 500 行上限）。
const { waitForContentReady, readPageContentWithRetry } = require('./url-collector-page-wait')
const ANTIBOT = require('./url-collector-antibot')
const { collectViaBrowser, collectHttpFirst } = require('./url-collector-browser')

class UrlCollector {
  /**
   * @param {object} [opts]
   * @param {string} [opts.auditDir] - 审计日志目录（L7 AuditLogger 落盘位置）。
   *   不传时回退 logger 同款规则（userData/logs）；传 null 显式禁用落盘。
   * @param {object} [opts.log] - 应用日志实例（info/warn/error）。默认模块级 logger；
   *   测试注入用（vi.mock 无法拦截 CJS 模块内部的 require，依赖注入是唯一可靠方式）。
   */
  constructor (opts = {}) {
    this._axios = null
    this._stealthBrowser = null
    this._log = opts.log || log
    // 防封八层防护核心组件（L0/L3/L5/L6/L7）
    this._strategy = new CollectionStrategy()
    this._rateLimiter = new RateLimiter()
    this._circuitBreaker = new CircuitBreaker()
    this._coolDownPool = new CoolDownPool()
    this._contentCache = new ContentCache()
    this._auditLogger = new AuditLogger({ dir: this._normalizeAuditDir(this._resolveAuditDir(opts.auditDir)) })
    this._healthMonitor = new HealthMonitor()
  }

  /**
   * 解析审计日志目录：显式传入 > logger 日志目录 > null（禁用落盘）。
   * AuditLogger 构造时无 dir 会静默丢弃所有防护事件（回归：采集失败无日志）。
   */
  _resolveAuditDir (explicitDir) {
    if (explicitDir !== undefined) return explicitDir
    try {
      // logger 模块暴露 getLogsDir（同款 userData/logs 规则）
      if (typeof log.getLogsDir === 'function') return log.getLogsDir()
    } catch { /* fallthrough */ }
    return null
  }

  /**
   * 规范化审计目录（审查 C2）：绝对路径化，拒绝空串。
   * @param {string} dir
   */
  _normalizeAuditDir (dir) {
    if (typeof dir !== 'string' || !dir.trim()) return null
    return path.resolve(dir)
  }

  /**
   * 懒加载 axios
   */
  _getAxios () {
    if (!this._axios) {
      this._axios = require('axios')
    }
    return this._axios
  }

  /**
   * 从 URL 采集内容
   * @param {string} url
   * @param {object} [opts]
   * @param {boolean} [opts.manual] - 用户手动单次采集（采集页点击）。手动模式豁免
   *   weekend-throttle 随机拒绝（用户周六想采一篇文章被 40% 概率拦截不合理），
   *   但保留 interval 限流与熔断（防连点滥用）。
   * @param {boolean} [opts.forceRefresh] - 强制重采：跳过内容缓存直采（「包含已采集」语义；
   *   2026-10-18 fav-force-recollect：此前仅绕 duplicate 名单，缓存空壳仍被上层判 unsubstantive）。
   * @returns {Promise<object>} { title, content, coverImage, description, publishTime, source, success }
   */
  async collect (url, opts = {}) {
    if (!url || typeof url !== 'string') {
      return { success: false, error: '无效的 URL' }
    }

    // 校验 URL 格式 + 协议白名单 + 内网 IP 防护（防 SSRF）
    let parsedUrl
    try {
      parsedUrl = new URL(url)
    // eslint-disable-next-line no-unused-vars
    } catch (e) {
      return { success: false, error: 'URL 格式不正确' }
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { success: false, error: '仅支持 http/https 协议' }
    }
    // 拒绝内网地址（防止 SSRF 探测内部服务如 Python 后端 127.0.0.1:8299）
    const hostname = parsedUrl.hostname.toLowerCase()
    const isInternal = hostname === 'localhost' ||
      hostname === '::1' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname.startsWith('169.254.') ||
      hostname.endsWith('.local')
    if (isInternal) {
      return { success: false, error: '不允许采集内网地址' }
    }

    const platform = this._platformFromHostname(hostname)

    // 八层防护门禁：预算 → 冷却池 → 熔断 → 频率 → 缓存
    const budget = this._strategy.checkBudget(platform)
    if (!budget.allowed) {
      this._auditLogger.blocked(platform, 'default', 'budget_exhausted')
      this._log.notify('url-collect', 'collect-blocked-budget', { level: 'WARN', params: { url, platform } })
      return { success: false, error: '已达每日采集预算上限', reason: 'budget_exhausted' }
    }

    if (this._coolDownPool.isBanned('account', platform)) {
      this._auditLogger.blocked(platform, 'default', 'cooldown')
      this._log.notify('url-collect', 'collect-blocked-cooldown', { level: 'WARN', params: { url, platform } })
      return { success: false, error: '该平台处于冷却期，请稍后再试', reason: 'cooldown' }
    }

    const strategy = this._strategy.getStrategy(platform)
    if (this._circuitBreaker.isOpen(platform, 'default', strategy.circuitBreaker)) {
      this._auditLogger.blocked(platform, 'default', 'circuit_open')
      this._log.notify('url-collect', 'collect-blocked-circuit', { level: 'WARN', params: { url, platform } })
      return { success: false, error: '该平台请求已熔断，请稍后再试', reason: 'circuit_open' }
    }

    const rateCheck = this._rateLimiter.evaluate({ ...strategy, platform, accountId: 'default', manual: Boolean(opts.manual) })
    if (!rateCheck.allowed) {
      this._auditLogger.blocked(platform, 'default', rateCheck.reason, { waitMs: rateCheck.waitMs })
      this._log.notify('url-collect', 'collect-blocked-rate', { level: 'WARN', params: { url, platform, reason: rateCheck.reason, waitMs: rateCheck.waitMs } })
      // 非活跃时段拦截与频率限流是不同原因，错误消息必须区分：
      // 统一返回「请求频率受限」会让前端 classifyCollectError 误判为 rate_limited
      // （显示「请求过于频繁，被平台限流」，误导用户）。
      const error = rateCheck.reason === 'outside-active-hours'
        ? '当前时段不在该平台活跃采集时段内，请稍后再试'
        : '请求频率受限，请稍后再试'
      return { success: false, error, reason: rateCheck.reason, waitMs: rateCheck.waitMs }
    }

    // forceRefresh 跳过内容缓存（「包含已采集」意图=真去采；缓存空壳会被上层判 unsubstantive 失败）
    if (!opts.forceRefresh && this._contentCache.hasUrl(url)) {
      this._log.notify('url-collect', 'collect-cache-hit', { params: { url, platform, reason: 'cache_hit' } })
      return { success: true, reason: 'cache_hit', title: '', content: '' }
    }

    try {
      this._rateLimiter.recordRequest(platform, 'default')
      this._strategy.consumeBudget(platform)
      const collectStart = Date.now()
      let result
      if (this._needsBrowser(hostname)) {
        this._log.notify('url-collect', 'collect-start-browser', { params: { url, platform } })
        result = await this._collectViaBrowser(url)
      } else if (this._isHttpFirst(hostname)) {
        this._log.notify('url-collect', 'collect-start-http-first', { params: { url, platform } })
        result = await collectHttpFirst({ http: () => this._collectViaHttp(url), browser: () => this._collectViaBrowser(url, 2), log: this._log }, url)
      } else {
        this._log.notify('url-collect', 'collect-start-http', { params: { url, platform } })
        result = await this._collectViaHttp(url)
      }
      const durationMs = Date.now() - collectStart
      if (result && result.success) {
        this._contentCache.mark(url, String(result.content || '').slice(0, 256))
        this._circuitBreaker.recordSuccess(platform, 'default')
        this._healthMonitor.record(platform, 'default', { success: true })
        this._auditLogger.request(platform, 'default', url, 200, 0)
        this._log.notify('url-collect', 'collect-ok', { params: { url, platform, mode: UrlCollector.routeFor(hostname), durationMs, titleLen: (result.title || '').length, contentLen: (result.content || '').length } })
      } else {
        // security_challenge 是站点侧概率性风控，不是采集器/账号故障：不记熔断（2026-10-18 QM-6 P3）。
        // 否则用户按提示「1-2 分钟后重试」连试 3 次即触发 failureThreshold=3 → 熔断 15 分钟。
        // 健康度与审计仍记录，只是不计熔断计数 / 不触发冷却封禁。
        const antibot = !!(result && result.reason === 'security_challenge')
        const reason = antibot ? 'security_challenge' : (result && result.error && /登录|验证码|请登录/.test(result.error) ? 'captcha' : 'blocked')
        if (!antibot) this._circuitBreaker.recordFailure(platform, 'default', strategy.circuitBreaker)
        this._healthMonitor.record(platform, 'default', { success: false, reason })
        this._auditLogger.blocked(platform, 'default', reason)
        if (!antibot && this._circuitBreaker.getState(platform, 'default', strategy.circuitBreaker).state === 'open') this._coolDownPool.ban('account', platform, reason)
      }
      return result
    } catch (e) {
      this._circuitBreaker.recordFailure(platform, 'default', strategy.circuitBreaker)
      this._healthMonitor.record(platform, 'default', { success: false, reason: 'network_error' })
      this._auditLogger.error(platform, 'default', e, { url })
      // 导航竞态错误（page.content 在导航中抛错）归类为可重试的 content_unextractable，
      // 避免渲染层 classifyCollectError 判为 unknown（「原因未识别」，误导用户）。
      const errMsg = e && e.message ? String(e.message) : ''
      const isNavigationRace = /navigating/.test(errMsg) || /navigation/i.test(errMsg)
      // 回归保护：采集失败必须写应用日志（此前只写 AuditLogger，而 AuditLogger
      // 无目录时静默丢弃，导致「采集失败」在 app-*.log 里完全无痕）
      this._log.notify('url-collect', 'collect-failed', { level: 'ERROR', params: { url, platform }, error: e && e.message ? e.message : String(e) })
      return {
        success: false,
        error: `采集失败: ${e.message}`,
        ...(isNavigationRace ? { reason: 'content_unextractable' } : {}),
      }
    }
  }

  /**
   * HTTP 方式采集（Cheerio 解析）
   */
  async _collectViaHttp (url) {
    const axios = this._getAxios()

    const response = await axios.get(url, {
      timeout: 15000,
      // 完整浏览器请求头属防御性加固（并非挑战的已证原因，证据口径见
      // url-collector-antibot.js 的 buildBrowserHeaders 注释）；判据仍是响应/HTML 本身。
      headers: ANTIBOT.buildBrowserHeaders(),
      responseType: 'text',
      maxRedirects: 5,
    })
    const html = String(response.data || '')
    // 重定向后的最终 URL 才是验证页判据（原始 URL 仍是文章地址）
    const finalUrl = (response.request && response.request.res && response.request.res.responseUrl) || url
    return this._parseHtml(html, finalUrl)
  }

  /**
   * 解析 HTML（Cheerio）
   */
  _parseHtml (html, url) {
    const cheerio = require('cheerio')
    // 解析前防验证页：HTML 层面（title / 正文强标记）已能判定就直接失败返回，
    // 不给「验证页被当文章」留任何路径（2026-10-18 现场）。
    if (ANTIBOT.isVerificationHtml(html, url)) return ANTIBOT.securityChallengeFailure()
    const $ = cheerio.load(html)

    const getMeta = (name) => {
      const el = $(`meta[property="${name}"], meta[name="${name}"]`).first()
      return el.attr('content') || ''
    }

    // 提取标题
    // let：百家号 SPA 无 og:title meta，下方百家号分支会用 h1 覆写回退
    let title = getMeta('og:title') || $('title').first().text() || ''

    // 提取描述
    const description = getMeta('og:description') || getMeta('description') || ''

    // 提取封面图
    const coverImage = getMeta('og:image') || getMeta('twitter:image') || ''

    // 提取发布时间
    const publishTime = getMeta('article:published_time') ||
                        getMeta('pubdate') ||
                        $('time[datetime]').first().attr('datetime') || ''

    // 提取站点名
    const source = getMeta('og:site_name') || new URL(url).hostname

    // 提取正文 — 按平台分派优先选择器，逐级回退
    const hostname = new URL(url).hostname.toLowerCase()
    let contentEl

    let textContent = ''

    // 知乎专栏文章：正文在 .Post-RichTextContainer > .RichText
    if (hostname === 'zhuanlan.zhihu.com') {
      contentEl = $('.Post-RichTextContainer').first()
      if (!contentEl.length) contentEl = $('.RichText.ztext.Post-RichText').first()
    }

    // 知乎问题/回答：正文在 .RichContent-inner
    if ((!contentEl || !contentEl.length) && (hostname === 'www.zhihu.com' || hostname === 'zhihu.com')) {
      contentEl = $('.RichContent-inner').first()
      if (!contentEl.length) contentEl = $('.RichText.ztext').first()
    }

    // 百家号：SPA 渲染，class 名每次构建混淆变化；正文稳定在 [data-testid="article"] 容器
    // （实测比「最多 <p> 的容器」干净：后者会把页脚/推荐噪声算进正文）。容器缺失时才回退
    // 旧的「段落聚合」启发式，并交同一套可读文本提取器收口（保留段落换行）。
    if (hostname === 'baijiahao.baidu.com' || hostname === 'mbd.baidu.com') {
      const articleEl = $('[data-testid="article"]').first()
      if (articleEl.length) textContent = extractReadableText(articleEl).slice(0, 50000)
      if (!textContent) {
        const containers = $('[class]').get()
        let bestContainer = null
        let bestParagraphCount = -1
        for (const el of containers) {
          const pCount = $(el).find('p').length
          if (pCount > bestParagraphCount) {
            bestParagraphCount = pCount
            bestContainer = el
          }
        }
        if (bestContainer && bestParagraphCount > 0) {
          textContent = extractReadableText($(bestContainer)).slice(0, 50000)
        }
      }
      // 百家号标题回退到 h1 或 title
      if (!title) title = $('h1').first().text().trim() || title
    }

    // 通用回退：article → main → body（textContent 仍为空时才走）
    if (!textContent) {
      if (!contentEl || !contentEl.length) {
        contentEl = $('article').first()
      }
      if (!contentEl || !contentEl.length) {
        contentEl = $('main').first()
      }
      if (!contentEl || !contentEl.length) {
        contentEl = $('body')
      }
      textContent = extractReadableText(contentEl).slice(0, 50000)
    }

    // 解析后再防验证页：提取后的正文是最终判据（HTML 实体编码等场景解析前看不到原文），
    // 命中强标记一律按验证页失败，绝不把验证文案当文章正文返回。
    if (ANTIBOT.isVerificationPage({ url, title, text: textContent })) {
      return ANTIBOT.securityChallengeFailure()
    }

    return {
      success: true,
      title,
      description,
      content: textContent,
      coverImage,
      publishTime,
      source,
      url,
      // 互动数据（viral-library-integration P0）：字段级 null = 页面未知，0 = 真实零互动。
      // 采集契约经 url-collect:fetch data 透传渲染层，无新增 IPC。
      engagement: this._parseEngagement($, html),
    }
  }

  /**
   * 互动计数字符串 → 非负整数（实现见 url-collector-engagement.js，P0 契约核心）。
   * @param {string|number|null|undefined} v
   * @returns {number|null}
   */
  static _parseEngagementNumber (v) {
    return parseEngagementNumber(v)
  }

  /**
   * 从已加载 DOM + 原始 HTML 提取互动计数（实现见 url-collector-engagement.js）。
   * 契约：字段级 null = 页面未知，0 = 真实零互动；fail-open 不破坏采集。
   * @param {object} $ - cheerio 实例
   * @param {string} html - 原始 HTML
   * @returns {{ likes: number|null, comments: number|null }}
   */
  _parseEngagement ($, html) {
    return parseEngagement($, html)
  }

  /** 反爬站点（浏览器优先）判定：清单单一来源见 url-collector-antibot.js（防两端漂移） */
  _needsBrowser (hostname) {
    return UrlCollector.isAntiCrawlHost(hostname)
  }

  /** HTTP 优先站点（百家号）：裸连成功即返回，命中验证页/正文为空才回退 stealth 浏览器 */
  _isHttpFirst (hostname) {
    return UrlCollector.isHttpFirstHost(hostname)
  }

  /** 静态判定：反爬站点（浏览器优先，知乎类裸连返回 403/异常页） */
  static isAntiCrawlHost (hostname) {
    return ANTIBOT.isAntiCrawlHost(hostname)
  }

  /** 静态判定：HTTP 优先站点（百家号，直连成功率高且成本低） */
  static isHttpFirstHost (hostname) {
    return ANTIBOT.isHttpFirstHost(hostname)
  }

  /** 采集路由：browser / http-first / http（needs-stealth IPC 的 mode 字段同源） */
  static routeFor (hostname) {
    return ANTIBOT.routeFor(hostname)
  }

  /** 反爬站点清单（浏览器优先） */
  static ANTI_CRAWL_HOSTNAMES = ANTIBOT.ANTI_CRAWL_HOSTNAMES

  /** HTTP 优先站点清单（百家号） */
  static NODE_HTTP_FIRST_HOSTNAMES = ANTIBOT.NODE_HTTP_FIRST_HOSTNAMES

  /** 从 hostname 映射平台标识（策略配置键） */
  _platformFromHostname (hostname) {
    if (hostname.includes('zhihu')) return 'zhihu'
    // 百家号：baijiahao.baidu.com / mbd.baidu.com（落地页）——此前无映射落 generic，
    // generic 的 weekendFactor 0.6 在周末 40% 概率随机拒绝（weekend-throttle），
    // 且 generic 间隔 min 8s 对单次手动采集过严
    if (hostname.includes('baijiahao') || hostname === 'mbd.baidu.com') return 'baijiahao'
    if (hostname.includes('weixin') || hostname.includes('wechat') || hostname === 'mp.weixin.qq.com') return 'wechat_mp'
    if (hostname.includes('bilibili')) return 'bilibili'
    if (hostname.includes('xiaohongshu') || hostname.includes('xhslink')) return 'xiaohongshu'
    if (hostname.includes('douyin')) return 'douyin'
    return 'generic'
  }

  /** Playwright stealth 浏览器采集：验证页判定 + 换新 context 有界重试见 url-collector-browser.js */
  async _collectViaBrowser (url, maxAttempts = 2) {
    return collectViaBrowser({
      getBrowser: () => this._getStealthBrowser(),
      parseHtml: (html, pageUrl) => this._parseHtml(html, pageUrl),
      log: this._log,
      fetchPage: async (page) => {
        // 条件等待正文就绪（替代固定 sleep）后再读 HTML；导航竞态重试见 page-wait 模块
        await this._waitForContentReady(page)
        return this._readPageContentWithRetry(page)
      },
    }, url, maxAttempts)
  }

  /** 懒启动 stealth 浏览器（实例复用；stealth 插件在首次启动前注册一次） */
  async _getStealthBrowser () {
    if (this._stealthBrowser) return this._stealthBrowser
    const { chromium } = require('playwright-extra')
    chromium.use(require('puppeteer-extra-plugin-stealth')())
    this._stealthBrowser = await chromium.launch({ headless: true })
    return this._stealthBrowser
  }

  /** 条件等待正文就绪，替代固定 sleep（判据/超时见 url-collector-page-wait.js；测试锁此入口） */
  async _waitForContentReady (page) {
    return waitForContentReady(page, { log: this._log, label: 'UrlCollector' })
  }

  /** 读取页面 HTML，导航竞态时等待后重试（判据见 url-collector-page-wait.js） */
  async _readPageContentWithRetry (page, maxAttempts = 3) {
    return readPageContentWithRetry(page, maxAttempts)
  }

  /**
   * 注册 IPC 处理器
   */
  registerIpcHandlers (injectedIpcMain) {
    // P1-14：必须注入 access-controlled ipcMain（createAccessControlledIpcMain）。
    // 禁止回退全局 ipcMain —— 那会同时绕过 isTrustedSender 来源校验与许可证/权益门禁，
    // 且在纯 Node（单测）下退化成无信息量的 TypeError。未注入即 fail-closed 抛错。
    if (!injectedIpcMain) {
      throw new Error('[IPC] url-collector registerIpcHandlers 需要注入受控 ipcMain（禁止使用全局 ipcMain）');
    }
    const ipcMain = injectedIpcMain;
    // 采集路由查询（纯函数，无副作用）：渲染层据此决定是否跳过 Python 聚合层裸连。
    // needsStealth=true 保持向后兼容语义（走主进程 Node 采集通道）；mode 为新增细分
    // （browser=知乎浏览器优先 / http-first=百家号 HTTP 优先 / http=普通站点）。
    ipcMain.handle('url-collect:needs-stealth', async (event, arg) => {
      if (!arg || typeof arg !== 'object' || typeof arg.url !== 'string') {
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      try {
        const hostname = new URL(arg.url).hostname.toLowerCase()
        const mode = UrlCollector.routeFor(hostname)
        return { code: 0, data: { needsStealth: mode !== 'http', mode } }
      } catch {
        // 非法 URL 交由后续 collect 的完整校验处理，这里不拦截
        return { code: 0, data: { needsStealth: false } }
      }
    });
    ipcMain.handle('url-collect:fetch', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { url } = arg
      try {
        // manual: 采集页用户手动点击（preload 传入）；批量/自动路径不经过此 IPC
        const result = await this.collect(url, { manual: Boolean(arg.manual) })
      // 失败时必须带顶层 message：前端 collectError 取 result.message，
      // 此前只有 data.error 导致前端拿到 undefined → 分类器按 code -1 兜底
      // 误判为 timeout（显示「目标网站响应超时」误导用户）
      if (result.success) {
        return { code: 0, data: result }
      }
      return { code: -1, message: result.error || '采集失败', data: result }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    })
  }
}

module.exports = UrlCollector
