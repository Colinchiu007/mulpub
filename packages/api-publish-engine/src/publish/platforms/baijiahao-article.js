'use strict'
/**
 * baijiahao-article.js — 百家号图文（文章）发布链（W1 §4.3）
 *
 * 对齐参考产品逆向链（证据 01-docs/rpa-api-publish/evidence/yx-bjh-check.txt）：
 *   1. getBaseToken     GET  /?source=inner            → 正则提 BJH__INIT__AUTH__ = "..."
 *   2. getPublishToken  GET  /pcui/article/edit?type=news (headers.token=baseToken) → 响应头 token
 *   3. uploadImage      POST /pcui/picture/uploadproxy  (multipart，!isJson 风控重试)
 *   4. submitArticle    POST /pcui/article/save?callback=bjhdraft            (草稿/私密优先)
 *                       POST /pcui/article/publish?type=news&callback=bjhpublish (正式发布)
 *
 * 合规红线：远程签名通道已永久拆除，本链进程内自足；测试仅对本机假 HTTP 服务器发请求。
 * 数据校验 fail-closed：缺 cookie / userAgent 在发起任何请求前抛错（零请求）。
 */
const { createHttpClient, requestWithRetry } = require('../core/http-base')
const { errorCode } = require('../../error-codes')

const DEFAULT_BASE_URL = 'https://baijiahao.baidu.com'
const HOST = 'baijiahao.baidu.com'
const REFERER_EDIT = 'https://baijiahao.baidu.com/builder/rc/edit?type=news'
const FORM_TYPE = 'application/x-www-form-urlencoded'
// 百家号标题上限 149 字节（UTF-8），与图文/视频链一致
const TITLE_MAX_BYTES = 149

/** 百家号链业务错误，携带统一错误码 */
class BaijiahaoArticleError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'BaijiahaoArticleError'
    this.code = code === undefined ? errorCode.data_error : code
  }
}

/** UTF-8 字节安全截断标题（不切多字节字符），上限 149 字节 */
function truncateTitle (title, maxBytes = TITLE_MAX_BYTES) {
  const str = String(title == null ? '' : title)
  const chars = Array.from(str)
  let bytes = 0
  let out = ''
  for (const ch of chars) {
    const b = Buffer.byteLength(ch, 'utf8')
    if (bytes + b > maxBytes) break
    bytes += b
    out += ch
  }
  return out
}

class BaijiahaoArticleChain {
  /**
   * @param {{http?: object, baseUrl?: string, userAgent?: string, cookie?: string,
   *   timeout?: number, agents?: object, logger?: object}} [opts]
   */
  constructor (opts = {}) {
    this.baseUrl = opts.baseUrl || DEFAULT_BASE_URL
    this.userAgent = opts.userAgent
    this.cookie = opts.cookie
    this.logger = opts.logger || console
    this.http = opts.http || createHttpClient({
      baseURL: this.baseUrl,
      timeout: opts.timeout,
      agents: opts.agents,
    })
  }

  /** 发起前统一校验：缺 cookie / userAgent → fail-closed 抛错（零请求） */
  _assertPreconditions () {
    if (!this.cookie) {
      throw new BaijiahaoArticleError('baijiahao-article: missing cookie (fail-closed, refusing to publish)', errorCode.data_error)
    }
    if (!this.userAgent) {
      throw new BaijiahaoArticleError('baijiahao-article: missing User-Agent (fail-closed, refusing to publish)', errorCode.request_error)
    }
  }

  _headers (extra) {
    return Object.assign({
      'User-Agent': this.userAgent,
      Cookie: this.cookie,
      host: HOST,
    }, extra || {})
  }

  /** Step 1：从首页提取 baseToken（BJH__INIT__AUTH__） */
  async getBaseToken () {
    const res = await requestWithRetry(this.http, {
      method: 'get',
      url: '/?source=inner',
      headers: this._headers({ referer: 'https://baijiahao.baidu.com/' }),
      responseType: 'text',
      maxRedirects: 0,
    }, { isJson: () => true })
    const html = typeof res.data === 'string' ? res.data : String(res.data == null ? '' : res.data)
    const m = /BJH__INIT__AUTH__\s*=\s*['"]{1}([^'"]+)['"]{1}/.exec(html)
    if (!m || !m[1]) {
      throw new BaijiahaoArticleError('baijiahao-article: baseToken not found in /?source=inner (cookie may be expired)', errorCode.data_error)
    }
    return m[1]
  }

  /** Step 2：带 baseToken 请求编辑页，响应头 token 即 publishToken */
  async getPublishToken (baseToken) {
    if (!baseToken) throw new BaijiahaoArticleError('baijiahao-article: baseToken required for publishToken', errorCode.data_error)
    const res = await requestWithRetry(this.http, {
      method: 'get',
      url: '/pcui/article/edit',
      params: { type: 'news' },
      headers: this._headers({ referer: REFERER_EDIT, token: baseToken }),
    })
    const pt = res.headers && (res.headers.token || res.headers.Token)
    if (!pt) {
      throw new BaijiahaoArticleError('baijiahao-article: publishToken missing in edit response headers', errorCode.data_error)
    }
    return String(pt)
  }

  /** Step 3：图片上传代理（multipart），返回图片 URL；!isJson 命中风控页时由 requestWithRetry 重试 */
  async uploadImage (form) {
    const res = await requestWithRetry(this.http, {
      method: 'post',
      url: '/pcui/picture/uploadproxy',
      headers: this._headers({ referer: REFERER_EDIT, 'Content-Type': 'multipart/form-data' }),
      data: form,
    })
    const data = res.data || {}
    if (data.errno && Number(data.errno) !== 0) {
      throw new BaijiahaoArticleError('baijiahao-article: uploadproxy errno=' + data.errno + ' ' + (data.errmsg || ''), errorCode.data_error)
    }
    const url = (data.data && (data.data.url || data.data.oss_url)) || data.url
    return { url, raw: data }
  }

  /** 构造图文表单（x-www-form-urlencoded），标题 149 字节截断 */
  buildArticleFormData (taskData) {
    const params = new URLSearchParams()
    params.set('title', truncateTitle(taskData.title))
    params.set('content', String(taskData.content == null ? '' : taskData.content))
    params.set('category', String(taskData.category == null ? '未分类' : taskData.category))
    params.set('reward_money', '0')
    params.set('is_pay_column', '0')
    params.set('type', 'news')
    if (taskData.cover) params.set('project_cover', String(taskData.cover))
    if (Array.isArray(taskData.original) && taskData.original.length) {
      params.set('original', '1')
    }
    return params.toString()
  }

  /** Step 4：提交文章。draft=true → save?callback=bjhdraft（私密/草稿优先）；否则 publish?type=news */
  async submitArticle (publishToken, formData, opts = {}) {
    if (!publishToken) throw new BaijiahaoArticleError('baijiahao-article: publishToken required', errorCode.data_error)
    const draft = opts.draft !== false // 默认私密优先（草稿）
    const url = draft
      ? '/pcui/article/save'
      : '/pcui/article/publish'
    const params = draft ? { callback: 'bjhdraft' } : { type: 'news', callback: 'bjhpublish' }
    const res = await requestWithRetry(this.http, {
      method: 'post',
      url,
      params,
      headers: this._headers({ referer: REFERER_EDIT, 'Content-Type': FORM_TYPE + ';', token: publishToken }),
      data: formData,
    })
    const data = res.data || {}
    const errno = Number(data.errno)
    if (errno === 10000015) {
      const hit = (data.data && data.data.hit_rule) || ''
      return { success: false, code: errno, error: '百家号风控拦截：' + (data.errmsg || '') + (hit ? '（' + hit + '）' : '') + '，请先在浏览器中登录百家号完成验证' }
    }
    if (errno && errno !== 0) {
      return { success: false, code: errno, error: data.errmsg || 'baijiahao submit failed' }
    }
    return { success: true, draft, publishId: (data.ret && data.ret.id) ? String(data.ret.id) : (data.id ? String(data.id) : ''), raw: data }
  }

  /**
   * 全链编排：baseToken → publishToken → (uploadImage) → submitArticle。
   * @param {object} taskData {title, content, cover?, images?}
   * @param {{draft?: boolean}} [opts]
   */
  async run (taskData, opts = {}) {
    this._assertPreconditions()
    if (!taskData || !taskData.title) {
      throw new BaijiahaoArticleError('baijiahao-article: taskData.title required', errorCode.data_error)
    }
    const baseToken = await this.getBaseToken()
    const publishToken = await this.getPublishToken(baseToken)
    if (Array.isArray(taskData.images)) {
      for (const img of taskData.images) {
        if (img && img.form) await this.uploadImage(img.form)
      }
    }
    const formData = this.buildArticleFormData(taskData)
    const result = await this.submitArticle(publishToken, formData, opts)
    result.platform = 'baijiahao'
    return result
  }
}

module.exports = {
  BaijiahaoArticleChain,
  BaijiahaoArticleError,
  truncateTitle,
  DEFAULT_BASE_URL,
  TITLE_MAX_BYTES,
}
