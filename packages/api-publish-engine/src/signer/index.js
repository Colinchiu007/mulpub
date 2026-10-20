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
const kuaishouSig3 = require('./kuaishou-sig3')

const registry = createRegistry()

// ---- Tier-A 本地算法收编（与 signer-local.js 行为一致）----

/*
 * 快手 __NS_sig3（2026-10 完整还原，替换旧的 MD5 近似式）
 *
 * 旧实现是 `MD5(api_ph + "|" + JSON(body))`（32 位裸 hex）。2026-09-25 的 W3 spike
 * S0 判定它"结构上不等于真签名"并作废，此后主链路改走 Tier-B 页面签名器。
 * 2026-10 把竞品 VM 算法完整还原为纯 JS（与 VM 逐字节对拍 10/10），
 * 且在真实服务端验证通过（无签 500002 被拒 / 带签 result:1），故 Tier-A 重新可用。
 *
 * 入参契约与页面签名器（PJ）同构：{ url, type, params } → 56 hex。
 * 兼容历史形态 { body, apiPh }：body 视作 params（apiPh 不再参与计算 ——
 * 真 sig3 的输入里没有 api_ph）。
 */
registry.register('kuaishou.ns-sig3', (payload) => {
  const p = payload || {}
  const params = p.params === undefined ? p.body : p.params
  return kuaishouSig3.sign({
    url: p.url,
    params,
    startupRandom: p.startupRandom,
    count: p.count,
  })
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
// 命令名透传修正（2026-09-28 活体 6.3）：桌面装配（signer-assembly BRIDGE_COMMANDS）
// 注册的命令是带 -browser 后缀的本名——此前实现传 Tier-A 名（kuaishou.ns-sig3），
// provider 白名单必然 unknown command。impl 收不到自己的注册名，此处按注册名透传。
registry.register('kuaishou.ns-sig3-browser', async (payload) => {
  return browserPageProvider.sign('kuaishou.ns-sig3-browser', payload)
})
registry.register('xiaohongshu.x-s-browser', async (payload) => {
  return browserPageProvider.sign('xiaohongshu.x-s-browser', payload)
})

module.exports = { registry, createRegistry, sign: registry.sign, register: registry.register, has: registry.has, list: registry.list, browserPageProvider }
