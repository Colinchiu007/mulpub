/**
 * DouyinAdapter — 抖音平台适配器（极高风险，真实浏览器 + 账号池轮换）
 *
 * 特征：
 *   - X-Bogus/a_bogus 签名交浏览器 JS 计算（不自行逆向）
 *   - 需要登录态，极低频（默认 20 条/天，间隔 30-90s）
 *   - 行为仿真强度 heavy
 */
const { BaseAdapter } = require('./base-adapter')

class DouyinAdapter extends BaseAdapter {
  constructor (opts = {}) {
    super({ ...opts, platform: 'douyin' })
    this._behaviorSim = opts.behaviorSim || null
  }

  extractContent (response) {
    const body = response.body || ''
    // 抖音视频描述通常在 .video-info-desc 或 meta 标签
    const descMatch = body.match(/<meta[^>]*name="description"[^>]*content="([^"]*)/i)
      || body.match(/<p[^>]*class="[^"]*desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
    const text = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, '').trim()
      : body.replace(/<[^>]+>/g, '').trim().slice(0, 1000)
    return { text, title: response.title || '', platform: 'douyin' }
  }

  detectBlock (response) {
    const base = super.detectBlock(response)
    if (base.blocked) return base
    if (response.body && /captcha|验证码|滑块|请完成安全验证/i.test(response.body)) {
      return { blocked: true, reason: 'captcha' }
    }
    if (response.body && /请登录|未登录|login/i.test(response.body)) {
      return { blocked: true, reason: 'login_expired' }
    }
    return { blocked: false }
  }

  buildUrl (target) {
    if (typeof target === 'string') return target
    // 路径段同样要编码：含 / # ? 的 id 会跳到别的路由或截断 URL（体检报告 P2 安全小项）
    if (target.videoId) return 'https://www.douyin.com/video/' + encodeURIComponent(String(target.videoId))
    return target.url
  }

  async _doFetch (url, strategy) {
    if (this._browser) {
      const browser = this._browser
      if (this._behaviorSim && strategy.warmup) {
        await this._behaviorSim.browsePath(browser, 'https://www.douyin.com/', url)
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

module.exports = { DouyinAdapter }
