/**
 * ZhihuAdapter — 知乎平台适配器（高风险，真实浏览器采集）
 *
 * 特征：
 *   - 需要登录态（复用 browser-data.js per-account session）
 *   - x-zse-96 签名交浏览器 JS 计算（不自行逆向）
 *   - 行为仿真（搜索→列表→详情，不直接深链）
 */
const { BaseAdapter } = require('./base-adapter')

class ZhihuAdapter extends BaseAdapter {
  constructor (opts = {}) {
    super({ ...opts, platform: 'zhihu' })
    this._behaviorSim = opts.behaviorSim || null
  }

  extractContent (response) {
    const body = response.body || ''
    // 知乎答案正文通常在 .RichContent-inner 或 .Post-RichText
    const richMatch = body.match(/<div[^>]*class="[^"]*RichContent-inner[^"]*"[\s\S]*?<\/div>/i)
      || body.match(/<div[^>]*class="[^"]*Post-RichText[^"]*"[\s\S]*?<\/div>/i)
      || body.match(/<span[^>]*class="[^"]*RichText[^"]*"[\s\S]*?<\/span>/i)
    const text = richMatch
      ? richMatch[0].replace(/<[^>]+>/g, '').trim()
      : body.replace(/<[^>]+>/g, '').trim().slice(0, 2000)
    return { text, title: response.title || '', platform: 'zhihu' }
  }

  detectBlock (response) {
    const base = super.detectBlock(response)
    if (base.blocked) return base
    // 知乎特有：验证码页面
    if (response.body && /captcha|验证码|请完成安全验证/i.test(response.body)) {
      return { blocked: true, reason: 'captcha' }
    }
    // 登录页面（未登录被重定向）
    if (response.body && /signin.*next=|class="SignFlow"/i.test(response.body)) {
      return { blocked: true, reason: 'login_expired' }
    }
    return { blocked: false }
  }

  buildUrl (target) {
    if (typeof target === 'string') return target
    // 知乎回答: https://www.zhihu.com/question/{qid}/answer/{aid}
    if (target.aid) {
      return (
        'https://www.zhihu.com/question/' +
        encodeURIComponent(String(target.qid)) +
        '/answer/' +
        encodeURIComponent(String(target.aid))
      )
    }
    return target.url
  }

  /** 真实浏览器采集（Electron 或 Playwright 注入） */
  async _doFetch (url, strategy) {
    // 真实浏览器模式下，调用方通过 opts._browser 注入浏览器实例
    if (this._browser) {
      const browser = this._browser
      // 行为仿真：预热 + 浏览路径
      if (this._behaviorSim && strategy.warmup) {
        const listUrl = url.replace(/\/answer\/\d+.*/, '')
        await this._behaviorSim.browsePath(browser, listUrl, url)
      } else {
        await browser.goto(url)
        await new Promise(r => setTimeout(r, 3000))
      }
      const body = await browser.evaluate(() => document.documentElement.outerHTML)
      const title = await browser.evaluate(() => document.title)
      return { status: 200, body, title, url }
    }

    // 无浏览器注入时，退化到 HTTP（供测试/非 Electron 环境）
    return { status: 200, body: '', title: '', url }
  }
}

module.exports = { ZhihuAdapter }
