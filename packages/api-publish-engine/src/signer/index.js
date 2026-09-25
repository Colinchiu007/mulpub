'use strict'

/**
 * 签名模块装配入口（W1 §2）
 *
 * 建立进程内默认注册表，收编现有 Tier-A 本地算法（对齐 signer-local.js 行为），
 * 以规范化 signCommand 注册。各平台发布链（§4）require 本模块后追加注册自己的
 * command（视频号 Content-MD5、B站 csrf、百家号 token 等）。
 *
 * 合规红线：本模块不引入任何 HTTP 客户端；sign() 只调用已注册的纯计算函数。
 */

const crypto = require('crypto')
const local = require('../signer-local')
const { createRegistry } = require('./registry')
const douyinTicketGuard = require('./douyin-ticket-guard')
const { createBrowserPageProvider } = require('./browser-page-provider')

const registry = createRegistry()

// ---- Tier-A 本地算法收编（与 signer-local.js 行为一致）----

// 快手 __NS_sig3：MD5(api_ph | JSON(body))；缺 api_ph 时返回空串（由上层校验拦截）
registry.register('kuaishou.ns-sig3', (payload) => {
  const p = payload || {}
  return local.getKuaishouSign(p.body, p.apiPh)
})

// 抖音浏览器参数（占位签名，真实有效性待活体验证）
registry.register('douyin.browser-params', (payload) => {
  const p = payload || {}
  return local.buildDouyinParams(p.ua)
})

// 小红书 X-s / X-t
registry.register('xiaohongshu.x-s', (payload) => {
  const p = payload || {}
  return local.getXiaohongshuSign(p.path, p.body)
})

// CSDN HMAC-SHA256
registry.register('csdn.hmac-sha256', (payload) => {
  const p = payload || {}
  return local.getCsdnSign(p.url, p.body, p.appSecret)
})

// 视频号 Content-MD5（上传鉴权用：base64(MD5(rawBytes))）
registry.register('shipinhao.content-md5', (payload) => {
  const buf = payload && payload.buffer
  if (!buf || !buf.length) throw new Error('signer: shipinhao.content-md5 requires non-empty buffer')
  return crypto.createHash('md5').update(buf).digest('base64')
})

// 抖音 ticket-guard 本地签名（W2 D4：进程内 registry，替代第三方签名通道）
registry.register('douyin.ticket-guard-client-data', (payload) => {
  const p = payload || {}
  return douyinTicketGuard.clientSign(p.cookie)
})

registry.register('douyin.ticket-guard-ree-public-key', (payload) => {
  const p = payload || {}
  return douyinTicketGuard.extractReePublicKey(p.cookie)
})

// ---- Browser-page provider（W3 签名页基建）----
// 单例 provider，桌面装配层通过 setBridge() 注入 IPC 通道
const browserPageProvider = createBrowserPageProvider()

// Tier-B 备选 command（本地公式不变，spike S0 验证后决定走哪个）：
// 未注入 bridge 时求签自动 fail-closed 抛「签名页未就绪」
registry.register('kuaishou.ns-sig3-browser', async (payload) => {
  return browserPageProvider.sign('kuaishou.ns-sig3', payload)
})
registry.register('xiaohongshu.x-s-browser', async (payload) => {
  return browserPageProvider.sign('xiaohongshu.x-s', payload)
})

module.exports = { registry, createRegistry, sign: registry.sign, register: registry.register, has: registry.has, list: registry.list, browserPageProvider }
