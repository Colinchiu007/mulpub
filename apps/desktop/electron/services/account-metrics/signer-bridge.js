// @ts-check
/**
 * account-metrics/signer-bridge — 把主进程既有签名器接成采集侧需要的形状
 *
 * 为什么需要这一层：签名器（`electron/signer/`）面向**发布**链设计，接口是
 * `browserPageProvider.sign(command, payload)`，返回裸签名（小红书还带 X-t），
 * 而采集侧只需要「给一个 URL，返回可直接并进请求头的对象」。
 * 两者之间隔着一个薄适配层，本文件就是它 —— 不在采集服务里内联 require，
 * 是为了让 `index.js` 可在纯 Node 下单测（签名器依赖 Electron，顶层 require 会污染测试）。
 *
 * ⛔ fail-closed（PRD §九 残余限制 2）：签名器未装配、命令未注册、返回形态不认识 —— 一律返回
 * `null`，由编排层把该平台记为 `unsupported`。**绝不退化成「不带签名硬发」**：
 * 那会把「签名不可用」变成「平台返回 406 / 空响应」，用户看到的是采集失败而不是能力缺失。
 */
'use strict'

const log = require('../logger')

/** 小红书签名结果 → 请求头。extractor 返回对象或 JSON 字符串两种形态（历史实现都出现过）。 */
function xhsSignatureHeaders (out) {
  let parsed = out
  if (typeof parsed === 'string') {
    const text = parsed.trim()
    if (!text) return null
    if (text.startsWith('{')) {
      try { parsed = JSON.parse(text) } catch (_) { return null }
    } else {
      // 裸签名串（只有 X-s，没有 X-t）：X-t 是必填头，缺了平台必拒 ⇒ 如实返回 null
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const xs = parsed['X-s'] !== undefined ? parsed['X-s'] : parsed['x-s']
  const xt = parsed['X-t'] !== undefined ? parsed['X-t'] : parsed['x-t']
  if (!xs || !xt) return null
  return { 'X-s': String(xs), 'X-t': String(xt) }
}

/**
 * 签名基址归一：**默认转成 pathname + search**。
 *
 * 依据：发布链的同一命令（`xiaohongshu.x-s-browser`）默认走路径口径
 * （`api-publish-engine/src/publish/platforms/xiaohongshu-draft.js:184-191`，注释「签名基址：按参考实现
 * 口径默认走路径」；只有 `MP_XHS_SIGN_URI=absolute` 时才用绝对 URL）。`_webmsxyw(url,data)` 是
 * 对**整串**求签（`signer-assembly.js:157` 原样透传），而平台侧按请求行（path+query）复算 ——
 * 传绝对 URL 会因签名不匹配恒被拒（表现为 failed），且旧实现不读该开关、无法用现成开关纠正。
 * @param {string} url
 * @returns {string}
 */
function signBaseUri (url) {
  const raw = String(url || '')
  if (!raw) return ''
  if (String(process.env.MP_XHS_SIGN_URI || '').toLowerCase() === 'absolute') return raw
  try {
    const u = new URL(raw)
    return u.pathname + u.search
  } catch (_) {
    return raw
  }
}

/**
 * 构造传给 AccountMetricsService 的 signer。
 * @returns {{sign: (ctx: object) => Promise<object|null>}}
 */
function createSignerBridge () {
  return {
    /**
     * @param {{platform: string, url: string, method?: string, body?: unknown, cookieHeader?: string, accountId?: string}} ctx
     * @returns {Promise<object|null>} 待并入请求头的对象；无法签名时 null
     */
    async sign (ctx) {
      const c = ctx || {}
      const platform = String(c.platform || '').toLowerCase()
      if (platform !== 'xiaohongshu') return null
      let provider
      try {
        const mod = require('@multi-publish/api-publish-engine/src/signer/index')
        provider = mod && mod.browserPageProvider
      } catch (e) {
        log.warn('AccountMetrics', 'signer provider unavailable: ' + ((e && e.message) || e))
        return null
      }
      if (!provider || typeof provider.sign !== 'function') return null
      try {
        // payload 形态对齐 xiaohongshu-draft-probe.js:175 的既有调用（fullUri/method/data/cookie），
        // 但 fullUri 走与发布链同一套「路径基址」口径（见 signBaseUri 的注释）。
        const out = await provider.sign('xiaohongshu.x-s-browser', {
          accountId: c.accountId,
          fullUri: signBaseUri(c.url),
          method: c.method || 'GET',
          data: c.body,
          cookie: c.cookieHeader,
        })
        return xhsSignatureHeaders(out)
      } catch (e) {
        // 求签失败（页面挂起 / 命令未注册 / 未验证）⇒ 记 warn 并返回 null，不抛错打断整轮
        log.warn('AccountMetrics', 'xiaohongshu sign failed: ' + ((e && e.message) || e))
        return null
      }
    },
  }
}

module.exports = { createSignerBridge, xhsSignatureHeaders, signBaseUri }
