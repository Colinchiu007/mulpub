'use strict'

/**
 * 平台签名器 —— 进程内注册表门面（W1 §2 收口）
 *
 * 变更（2026-09-23）：
 * - 彻底拆除历史远程签名对比通道（原环境变量后门、远程端口表、远程求签函数与本模块
 *   内的 HTTP 客户端依赖一并删除）。运行时代码不再包含任何外部签名端点。
 * - 所有签名统一走 signer/index.js 的进程内注册表（Tier-A 本地算法）；未知 command
 *   由注册表 fail-closed。
 *
 * 保留对外函数签名以兼容既有 adapters：
 * - getDouyinSignature(url, userAgent) → 浏览器参数对象（纯本地，环境变量不再触发网络请求）
 * - getKuaishouSignature(path, body, cookie) → { signature, __NS_sig3 }
 */

const { registry } = require('./signer/index')

/**
 * 获取抖音浏览器参数（含占位 _signature）。纯本地，不发任何外部请求。
 */
async function getDouyinSignature (_url, userAgent) {
  return registry.sign('douyin.browser-params', { ua: userAgent })
}

/**
 * 获取快手 __NS_sig3（Tier-A 纯 JS 实现，2026-10 完整还原）。
 *
 * sig3 的真实输入是 `md5(按 key 排序的 query 串 + JSON.stringify(body))`，
 * 因此 **path 参与签名**（query 部分）；api_ph 本身不参与计算 ——
 * 旧实现 `MD5(api_ph | body)` 已被 W3 spike S0 判定为结构上不等价。
 *
 * ⚠ **fail-closed 保留（CCG 深度评审 i4 的处置）**：
 * 虽然 api_ph 不进入签名输入，但它标志「这是不是一个已登录的快手账号」。
 * 缺 cookie / 缺 api_ph 时**仍然拒绝签名**，维持与旧实现相同的安全边界 ——
 * 否则任何无凭证调用都能拿到一个"格式合法"的 56 位串，让上层误以为已具备签名能力。
 *
 * @param {string} path        请求路径（可带 query，会按键排序后参与签名）
 * @param {object} body        请求体
 * @param {string} cookie      登录 cookie（必须含 kuaishou.web.cp.api_ph）
 * @returns {Promise<{signature: string, __NS_sig3: string}>} 56 个 hex
 * @throws {Error} 缺 cookie 或缺 api_ph 时抛错（fail-closed，不返回空串/占位值）
 */
async function getKuaishouSignature (path, body, cookie) {
  const cookieStr = typeof cookie === 'string' ? cookie : ''
  if (!cookieStr.trim()) {
    throw new Error('getKuaishouSignature: missing cookie (fail-closed)')
  }
  const phMatch = cookieStr.match(/kuaishou\.web\.cp\.api_ph=([^;]+)/)
  if (!phMatch || !phMatch[1].trim()) {
    throw new Error('getKuaishouSignature: missing kuaishou.web.cp.api_ph in cookie (fail-closed)')
  }
  const sig = await registry.sign('kuaishou.ns-sig3', { url: path, type: 'json', params: body })
  return { signature: sig, __NS_sig3: sig }
}

module.exports = {
  registry,
  getDouyinSignature,
  getKuaishouSignature,
}
