// @ts-check
/**
 * ZhihuFavlistService — 知乎官方收藏夹 API 客户端
 *
 * 知乎开放平台（developer.zhihu.com）官方接口：
 *   - 收藏夹列表：GET /api/v1/user/favlists?Limit=50
 *   - 收藏夹内容：GET /api/v1/user/favlist_contents?FavlistUrlToken={token}&Offset={offset}&Limit=50
 *
 * 认证：Authorization: Bearer <access_secret> + X-Request-Timestamp（秒级，±10 分钟）
 * 响应：{ Code, Message, Data }，Data.Items[] + Data.Paging{IsEnd, NextOffset, Totals}
 * 错误码：30001=频率限制（可重试），30002=配额限制（当日不可再试）
 *
 * 限制（官方文档明确）：
 *   - 列表无分页（服务端忽略 Offset），仅返回前 Limit 个（≤50）
 *   - 不区分自建 vs 关注的收藏夹（下拉框显示全部，用户自选）
 */

const ZHIHU_API_BASE = 'https://developer.zhihu.com/api/v1'

class ZhihuFavlistService {
  /**
   * @param {object} [opts]
   * @param {object} [opts.axios] - HTTP 客户端（测试注入用；缺省懒加载 axios）
   * @param {object} [opts.log] - { info, warn, error }
   */
  constructor (opts = {}) {
    this._axios = opts.axios || null
    this._log = opts.log || { info: () => {}, warn: () => {}, error: () => {} }
  }

  _getAxios () {
    if (!this._axios) {
      this._axios = require('axios')
    }
    return this._axios
  }

  /**
   * 构造认证头。
   * @param {string} accessSecret
   * @returns {object}
   */
  _buildHeaders (accessSecret) {
    return {
      'Authorization': `Bearer ${accessSecret}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'Content-Type': 'application/json',
    }
  }

  /**
   * 获取用户收藏夹列表（官方 API 不区分自建 vs 关注，返回全部公开收藏夹）。
   * @param {string} accessSecret
   * @returns {Promise<{success: boolean, favlists?: Array, error?: string}>}
   */
  async listFavlists (accessSecret) {
    if (!accessSecret || typeof accessSecret !== 'string' || !accessSecret.trim()) {
      return { success: false, error: '未配置知乎 Access Secret' }
    }
    try {
      const res = await this._getAxios().get(`${ZHIHU_API_BASE}/user/favlists`, {
        params: { Limit: 50 },
        headers: this._buildHeaders(accessSecret),
        timeout: 15000,
      })
      const body = res.data || {}
      if (body.Code !== 0) {
        return this._apiError(body)
      }
      const items = Array.isArray(body.Data && body.Data.Items) ? body.Data.Items : []
      const favlists = items
        .filter((it) => it && it.UrlToken != null)
        .map((it) => ({
          urlToken: it.UrlToken,
          title: String(it.Title || '未命名收藏夹'),
          description: String(it.Description || ''),
          isPublic: Boolean(it.IsPublic),
          url: String(it.Url || ''),
        }))
      this._log.info('zhihu-favlist', '收藏夹列表获取成功', { count: favlists.length })
      return { success: true, favlists }
    } catch (e) {
      return this._networkError(e)
    }
  }

  /**
   * 获取收藏夹内全部内容（分页遍历直到 IsEnd）。
   * @param {string} accessSecret
   * @param {string|number} favlistUrlToken
   * @param {object} [opts]
   * @param {number} [opts.maxPages] - 分页保护上限，默认 50
   * @param {function} [opts.onProgress] - (page, accumulated) => void
   * @returns {Promise<{success: boolean, items?: Array, totals?: number, error?: string, retryable?: boolean}>}
   */
  async getFavlistContents (accessSecret, favlistUrlToken, opts = {}) {
    if (!accessSecret || typeof accessSecret !== 'string' || !accessSecret.trim()) {
      return { success: false, error: '未配置知乎 Access Secret' }
    }
    if (favlistUrlToken == null || favlistUrlToken === '') {
      return { success: false, error: '缺少收藏夹标识' }
    }
    const maxPages = Number.isFinite(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 50
    const items = []
    let offset = 0
    let totals = 0
    try {
      for (let page = 1; page <= maxPages; page++) {
        const res = await this._getAxios().get(`${ZHIHU_API_BASE}/user/favlist_contents`, {
          params: { FavlistUrlToken: favlistUrlToken, Offset: offset, Limit: 50 },
          headers: this._buildHeaders(accessSecret),
          timeout: 15000,
        })
        const body = res.data || {}
        if (body.Code !== 0) {
          return this._apiError(body)
        }
        const data = body.Data || {}
        const pageItems = Array.isArray(data.Items) ? data.Items : []
        for (const it of pageItems) {
          // Url 缺失的条目跳过（不中断整体遍历）
          if (!it || !it.Url) continue
          items.push({
            contentType: String(it.ContentType || ''),
            url: String(it.Url),
            title: String(it.Title || ''),
            summary: String(it.Summary || ''),
            favTime: Number(it.FavTime || 0),
            likeCount: Number(it.LikeCount || 0),
          })
        }
        totals = Number(data.Paging && data.Paging.Totals || items.length)
        if (opts.onProgress) {
          try { opts.onProgress(page, items.length) } catch { /* 回调异常不中断 */ }
        }
        const paging = data.Paging || {}
        if (paging.IsEnd === true) break
        const next = Number(paging.NextOffset)
        offset = Number.isFinite(next) && next > offset ? next : offset + pageItems.length
        if (pageItems.length === 0) break
      }
      this._log.info('zhihu-favlist', '收藏夹内容获取成功', { urlToken: favlistUrlToken, count: items.length, totals })
      return { success: true, items, totals }
    } catch (e) {
      return this._networkError(e)
    }
  }

  /**
   * API 业务错误（Code !== 0）归一化。
   */
  _apiError (body) {
    const code = Number(body.Code)
    const msg = String(body.Message || '')
    if (code === 30001) {
      return { success: false, error: '知乎 API 频率限制，请稍后重试', retryable: true, apiCode: code }
    }
    if (code === 30002) {
      return { success: false, error: '知乎 API 每日配额已用完，请明天再试', apiCode: code }
    }
    this._log.warn('zhihu-favlist', 'API 返回非零码', { code, msg })
    return { success: false, error: `知乎 API 错误（${code}）：${msg}`, apiCode: code }
  }

  /**
   * 网络异常归一化。
   */
  _networkError (e) {
    const msg = e && e.message ? e.message : String(e)
    this._log.error('zhihu-favlist', '网络请求失败', { error: msg })
    return { success: false, error: `网络连接失败: ${msg}` }
  }
}

module.exports = ZhihuFavlistService
