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
 * 获取快手 __NS_sig3（本地计算：MD5(api_ph | JSON(body))，api_ph 取自登录 cookie）。
 *
 * @param {string} _path   保留参数（历史通道使用，现忽略）
 * @param {object} body    发布数据
 * @param {string} [cookie] 登录 cookie（含 kuaishou.web.cp.api_ph）
 * @returns {Promise<{signature: string, __NS_sig3: string}>}
 */
async function getKuaishouSignature (_path, body, cookie) {
  const phMatch = cookie && cookie.match(/kuaishou\.web\.cp\.api_ph=([^;]+)/)
  const sig = await registry.sign('kuaishou.ns-sig3', { body, apiPh: phMatch ? phMatch[1] : null })
  return { signature: sig, __NS_sig3: sig }
}

module.exports = {
  registry,
  getDouyinSignature,
  getKuaishouSignature,
}
