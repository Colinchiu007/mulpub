/**
 * XiaohongshuAdapter — 小红书平台适配器（极高风险，真实浏览器 + 极低频）
 *
 * 特征：
 *   - x-s/x-t 签名交浏览器 JS 计算（不自行逆向）
 *   - 需要登录态，极低频（默认 20 条/天，间隔 30-60s）
 *   - 行为仿真强度 heavy
 */
const { BaseAdapter } = require('./base-adapter')

class XiaohongshuAdapter extends BaseAdapter {
  constructor (opts = {}) {
    super({ ...opts, platform: 'xiaohongshu' })
    this._behaviorSim = opts.behaviorSim || null
  }

  extractContent (response) {
    const body = response.body || ''
    // 小红书笔记正文通常 .note-content / .desc
    const noteMatch = body.match(/<div[^>]*class="[^"]*note-content[^"]*"[\s\S]*?<\/div>/i)
      || body.match(/<div[^>]*class="[^"]*desc[^"]*"[\s\S]*?<\/div>/i)
    const text = noteMatch ? noteMatch[0].replace(/<[^>]+>/g, '').trim() : body.replace(/<[^>]+>/g, '').trim().slice(0, 2000)
    return { text, title: response.title || '', platform: 'xiaohongshu' }
  }

  detectBlock (response) {
    const base = super.detectBlock(response)
    if (base.blocked) return base
    if (response.body && /captcha|验证码|滑块/i.test(response.body)) {
      return { blocked: true, reason: 'captcha' }
    }
    if (response.body && /登录后查看|请登录|未登录/i.test(response.body)) {
      return { blocked: true, reason: 'login_expired' }
    }
    return { blocked: false }
  }

  buildUrl (target) {
    if (typeof target === 'string') return target
    if (target.noteId) return 'https://www.xiaohongshu.com/explore/' + encodeURIComponent(String(target.noteId))
    return target.url
  }

  async _doFetch (url, strategy) {
    if (this._browser) {
      const browser = this._browser
      if (this._behaviorSim && strategy.warmup) {
        await this._behaviorSim.browsePath(browser, 'https://www.xiaohongshu.com/explore', url)
      } else {
        await browser.goto(url)
        await new Promise(r => setTimeout(r, 5000))
      }
      const body = await browser.evaluate(() => document.documentElement.outerHTML)
      const title = await browser.evaluate(() => document.title)
      return { status: 200, body, title, url }
    }
    return { status: 200, body: '', title: '', url }
  }
}

module.exports = { XiaohongshuAdapter }
