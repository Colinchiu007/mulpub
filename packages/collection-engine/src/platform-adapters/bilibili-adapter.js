/**
 * BilibiliAdapter — B站平台适配器（中风险，API 优先 + 浏览器兜底）
 *
 * 特征：
 *   - B站 API 相对开放，优先走 HTTP API（只需 wbi 签名）
 *   - wbi 签名字段由 img_key + sub_key + mixin 计算
 *   - API 不可用时降级到真实浏览器
 */
const { BaseAdapter } = require('./base-adapter')
const crypto = require('crypto')

const WBI_KEY_MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16,
  24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 52, 44, 34]

function generateWbiSign (params, imgKey, subKey) {
  const mixKey = imgKey + subKey
  // P1-9: wts 必须**先于**排序入签（B站 WBI 规范：签名字符串含 wts、不含 w_rid）。
  // 原实现把 wts 加在 md5 之后，签名必然校验失败 → 接口只返回 -403/-799 空壳。
  const signed = { ...params, wts: String(Math.floor(Date.now() / 1000)) }
  const sorted = Object.keys(signed).sort()
  const query = sorted.map(k => k + '=' + encodeURIComponent(signed[k])).join('&')
  signed.w_rid = crypto.createHash('md5').update(query + mixKey).digest('hex')
  return signed
}

function mixinKey (raw) {
  return WBI_KEY_MIXIN.slice(0, raw.length).map(i => raw[i]).join('')
}

class BilibiliAdapter extends BaseAdapter {
  constructor (opts = {}) {
    super({ ...opts, platform: 'bilibili' })
    this._apiBase = 'https://api.bilibili.com'
    this._imgKey = ''
    this._subKey = ''
    // 注入式 HTTP 客户端（测试用；默认 globalThis.fetch）
    this._http = opts.http || null
  }

  /** P1-9: 真实发起 GET；无 fetch 实现时抛错（而不是返回假 200 空壳） */
  async _httpGet (url) {
    const fetchImpl = this._http || globalThis.fetch
    if (!fetchImpl) throw new Error('bilibili _httpGet: no fetch implementation available')
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://www.bilibili.com/',
        Accept: 'application/json, text/plain, */*',
      },
    })
    const status = res.status != null ? res.status : res.statusCode
    const body = await res.text()
    let json = null
    try { json = JSON.parse(body) } catch (e) { json = null }
    return { status, body, json, title: '', url }
  }

  /** 设置 wbi 密钥对（需从 B站 nav 接口获取后再调用） */
  setWbiKeys (imgKey, subKey) {
    this._imgKey = mixinKey(imgKey)
    this._subKey = mixinKey(subKey)
  }

  extractContent (response) {
    const body = response.body || ''
    if (response.json) {
      const data = response.json.data || {}
      return { text: data.desc || data.title || '', title: data.title || '', platform: 'bilibili' }
    }
    const descMatch = body.match(/"desc":"([^"]*)"/)
    return {
      text: descMatch ? descMatch[1] : body.replace(/<[^>]+>/g, '').trim().slice(0, 1000),
      title: response.title || '',
      platform: 'bilibili',
    }
  }

  detectBlock (response) {
    const base = super.detectBlock(response)
    if (base.blocked) return base
    if (response.json && response.json.code === -412) {
      return { blocked: true, reason: 'rate_limited' }
    }
    if (response.json && response.json.code === -101) {
      return { blocked: true, reason: 'login_expired' }
    }
    if (response.body && /请先登录/i.test(response.body)) {
      return { blocked: true, reason: 'login_expired' }
    }
    return { blocked: false }
  }

  buildUrl (target) {
    if (typeof target === 'string') return target
    // P1-9: 参数必须编码 —— 真发请求后未编码的 bvid/aid 会变成查询注入点
    if (target.bvid) return this._apiBase + '/x/web-interface/view?bvid=' + encodeURIComponent(target.bvid)
    if (target.aid) return this._apiBase + '/x/web-interface/view?aid=' + encodeURIComponent(target.aid)
    return target.url
  }

  async _doFetch (url, strategy) {
    // HTTP API 优先
    if (!strategy.needsLogin && this._imgKey) {
      const params = {}
      const u = new URL(url)
      for (const [k, v] of u.searchParams) params[k] = v
      const signed = generateWbiSign(params, this._imgKey, this._subKey)
      const signedUrl = url.split('?')[0] + '?' + Object.entries(signed)
        .map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&')
      try {
        const resp = await this._httpGet(signedUrl)
        const empty = resp.json == null || this.isEmptyContent(this.extractContent(resp))
        if (!empty) return resp
        // 空壳（风控/签名失效/视频不存在）→ 有浏览器就兜底，没有就原样返回由 collect 判 empty_content 失败
        if (!this._browser) return resp
      } catch (err) {
        if (!this._browser) throw err
        // 浏览器兜底可用时，API 异常降级而非直接失败
      }
    }

    // 浏览器兜底
    if (this._browser) {
      const browser = this._browser
      await browser.goto(url)
      await new Promise(r => setTimeout(r, 3000))
      const body = await browser.evaluate(() => document.documentElement.outerHTML)
      const title = await browser.evaluate(() => document.title)
      return { status: 200, body, title, url }
    }

    return { status: 200, body: '', title: '', url }
  }
}

module.exports = { BilibiliAdapter, generateWbiSign, mixinKey, WBI_KEY_MIXIN }
