'use strict'
/**
 * kuaishou-capabilities.js — 快手「发布前能力面」（W4 §6）
 *
 * 逐字对齐 01-docs/rpa-api-publish/evidence/yx-bundle-slices.txt：
 *   accountCurrent POST /rest/v2/creator/pc/authority/account/current?__NS_sig3=
 *               （getUserInfoResponse$3）
 *   fans          POST /rest/cp/creator/pc/home/infoV2?__NS_sig3=
 *               （getUserFansNumResponse）
 *   两者请求体均为 {"kuaishou.web.cp.api_ph": <cookie 内取出的 apiPh>}
 *
 * 签名纪律与 kuaishou-video.js 完全一致，不另开通道：
 *   - 仅经进程内 signer 注册表 command `kuaishou.ns-sig3-browser`
 *   - 未注入 / 未就绪 → 抛 signerNotReady，上层降级 unsupported
 *   - 签名结果本地断言（非空且 ≥ MIN_SIG_LEN），不合格 fail-closed
 *   - 绝不调用任何第三方签名服务（取证里的 qianming.refpub.cn 是参考产品的实现，本仓明令禁止）
 *
 * 合规：只直连 cp.kuaishou.com 官方域；client/signer 可注入 → 测试零外发。
 */
const { createHttpClient, requestWithRetry } = require('../core/http-base')
const { registry } = require('../../signer')
const { errorCode } = require('../../error-codes')

const CP_BASE = 'https://cp.kuaishou.com'
const REFERER = CP_BASE + '/profile'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.114 Safari/537.36'
const API_PH_KEY = 'kuaishou.web.cp.api_ph'

/*
 * 签名命令选择（2026-10 变更）
 *
 *   DEFAULT_SIGN_COMMAND = 'kuaishou.ns-sig3'
 *     Tier-A 纯 JS。竞品 VM 算法完整还原，与 VM 逐字节对拍 10/10，
 *     并在真实服务端验证通过（无签 500002 被拒 / 带签 result:1）。
 *     优点：零浏览器依赖、0.08–0.17 ms/次。
 *
 *   BROWSER_SIGN_COMMAND = 'kuaishou.ns-sig3-browser'
 *     Tier-B 页面签名器（Playwright/CEF 隐藏页）。保留为**回退**：
 *     submit 等带发布副作用的端点尚未用纯 JS 做活体回归，需要时
 *     可在构造时显式传 { signCommand: BROWSER_SIGN_COMMAND }。
 */
const DEFAULT_SIGN_COMMAND = 'kuaishou.ns-sig3'
const BROWSER_SIGN_COMMAND = 'kuaishou.ns-sig3-browser'
// 兼容既有导出名与历史引用：未显式指定时使用的命令
const SIGN_COMMAND = DEFAULT_SIGN_COMMAND
const MIN_SIG_LEN = 40

const ACCOUNT_CURRENT_PATH = '/rest/v2/creator/pc/authority/account/current'
const HOME_INFO_PATH = '/rest/cp/creator/pc/home/infoV2'

class KuaishouCapabilitiesError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'KuaishouCapabilitiesError'
    this.code = code === undefined ? errorCode.data_error : code
  }
}

function cookieValue (cookie, key) {
  for (const seg of String(cookie || '').split(';')) {
    const kv = seg.split('=')
    if (kv[0].trim() === key) return kv.slice(1).join('=').trim()
  }
  return ''
}

class KuaishouCapabilities {
  /**
   * @param {{cookie:string, userAgent?:string, client?:object, signer?:Function, timeout?:number,
   *          signCommand?:string}} opts
   *   signCommand 缺省为 DEFAULT_SIGN_COMMAND（Tier-A 纯 JS）；
   *   需要回退到页面签名器时传 BROWSER_SIGN_COMMAND。
   */
  constructor (opts = {}) {
    this.cookie = opts.cookie
    this.userAgent = opts.userAgent || UA
    this.signer = opts.signer
    this.signCommand = opts.signCommand || DEFAULT_SIGN_COMMAND
    this.client = opts.client || createHttpClient({
      baseURL: opts.apiBase || CP_BASE,
      timeout: opts.timeout,
      agents: opts.agents,
      headers: { 'User-Agent': this.userAgent },
    })
  }

  _assertCookie () {
    if (!this.cookie) {
      throw new KuaishouCapabilitiesError(
        'kuaishou-capabilities: missing cookie (fail-closed, refusing to query)', errorCode.data_error)
    }
    const apiPh = cookieValue(this.cookie, API_PH_KEY)
    if (!apiPh) {
      throw new KuaishouCapabilitiesError(
        'kuaishou-capabilities: missing ' + API_PH_KEY + ' in cookie (账号信息缺失，请重新授权此账号再试)',
        errorCode.data_error)
    }
    return apiPh
  }

  async _sign (url, bodyObj, opts) {
    const signer = this.signer || ((cmd, payload) => registry.sign(cmd, payload))
    const payload = { url, type: 'json', params: bodyObj, accountId: (opts && opts.accountId) || undefined }
    let sig
    try {
      sig = await signer(this.signCommand, payload)
    } catch (e) {
      const msg = String((e && e.message) || e)
      const notReady = /未就绪|not\s*ready|bridge not injected|未验证|unverified|degraded|not registered|未注册/i.test(msg)
      throw Object.assign(
        new KuaishouCapabilitiesError('kuaishou-capabilities: signer failed: ' + msg),
        { signerNotReady: notReady })
    }
    if (typeof sig !== 'string' || sig.length < MIN_SIG_LEN) {
      throw new KuaishouCapabilitiesError(
        'kuaishou-capabilities: invalid __NS_sig3 (empty or shorter than ' + MIN_SIG_LEN + ' chars, fail-closed)')
    }
    return sig
  }

  /** ★带签 POST：__NS_sig3 拼 query；result==109 → login_expired。 */
  async _signedPostJson (urlPath, bodyObj, opts) {
    const apiPh = this._assertCookie()
    const body = Object.assign({}, bodyObj, { [API_PH_KEY]: apiPh })
    const sig = await this._sign(urlPath, body, opts)
    const res = await requestWithRetry(this.client, {
      method: 'post',
      url: urlPath + '?__NS_sig3=' + encodeURIComponent(sig),
      data: JSON.stringify(body),
      headers: {
        'User-Agent': this.userAgent,
        Cookie: this.cookie,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: REFERER,
        'Content-Type': 'application/json;charset=UTF-8',
      },
      validateStatus: (s) => s >= 200 && s < 500,
    })
    const d = res.data || {}
    if (d.result === 109) {
      throw Object.assign(
        new KuaishouCapabilitiesError('kuaishou-capabilities: 登录态失效 (result=109)', errorCode.data_error),
        { login_expired: true })
    }
    if (d.result !== 1) {
      throw new KuaishouCapabilitiesError(
        'kuaishou-capabilities: ' + urlPath + ' result=' + d.result + ' msg=' + (d.message || ''))
    }
    return d.data || {}
  }

  /** 1. 账号信息（authorId/用户名/头像）。 */
  async userInfo (opts) {
    const data = await this._signedPostJson(ACCOUNT_CURRENT_PATH, {}, opts)
    const user = (data && (data.user || data.author)) || data || {}
    return {
      platform: 'kuaishou',
      uid: String(user.authorId || user.userId || user.id || ''),
      nickname: user.userName || user.authorName || user.name || '',
      avatar: user.headUrl || user.avatar || '',
      raw: data,
    }
  }

  /** 2. 粉丝数与创作者概览（home/infoV2）。 */
  async fansCount (opts) {
    const data = await this._signedPostJson(HOME_INFO_PATH, {}, opts)
    const info = (data && (data.info || data.user)) || {}
    return {
      platform: 'kuaishou',
      fans: Number(info.fansCount || info.fans || 0) || 0,
      nickname: info.userName || info.authorName || '',
      raw: data,
    }
  }

  /**
   * 3. 发布有效性预检。快手切片未取证独立的「发布权限」端点，
   *    故不编造 —— 只用已取证的账号权威接口裁定登录态与账号可用性。
   */
  async publishPermission (opts) {
    try {
      const info = await this.userInfo(opts)
      return {
        allowed: Boolean(info.uid || info.nickname),
        risk_blocked: false,
        platform: 'kuaishou',
        reason: (info.uid || info.nickname) ? '' : 'authority/account/current 未返回账号信息，登录态可能已失效',
        raw: info.raw,
      }
    } catch (err) {
      if (err && err.login_expired) {
        return { allowed: false, risk_blocked: false, platform: 'kuaishou', reason: err.message, login_expired: true }
      }
      if (err && err.signerNotReady) {
        return {
          allowed: false, risk_blocked: false, platform: 'kuaishou',
          reason: '快手签名页未就绪，无法预检（发布链同样不可用）', signer_not_ready: true,
        }
      }
      throw err
    }
  }
}

module.exports = {
  KuaishouCapabilities,
  KuaishouCapabilitiesError,
  CP_BASE,
  API_PH_KEY,
  SIGN_COMMAND,
  DEFAULT_SIGN_COMMAND,
  BROWSER_SIGN_COMMAND,
  MIN_SIG_LEN,
  ACCOUNT_CURRENT_PATH,
  HOME_INFO_PATH,
}