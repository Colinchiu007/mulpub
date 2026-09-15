/**
 * 平台签名器（本地化收口，2026-09-15）
 *
 * 设计：
 * - 快手 __NS_sig3：本地计算（MD5(api_ph|body)，api_ph 取自登录 cookie 的
 *   kuaishou.web.cp.api_ph），不再依赖第三方远程签名服务。
 * - 抖音 _signature：本地实现目前是"浏览器参数 + 占位签名"（buildDouyinParams），
 *   真实有效性待真机发布验证。验证开关：设置环境变量 MP_SIGNER_BASE 指向远程签名
 *   服务后，getDouyinSignature 走"远程优先、本地兜底"，用于对比远程/本地签名的
 *   发布成功率；未设置时纯本地，不发起任何外部请求。
 * - 历史上接入的第三方远程签名服务（小红书/百家号/头条，原端口 5062/5012/5032）
 *   已移除：小红书与百家号远程函数无生产调用方（小红书适配器本就走本地签名、
 *   百家号适配器走自身上传链），头条从未实现。
 *
 * 历史背景：第三方远程签名服务（qianming.*.cn，端口 5009/5042 等）复刻自参考
 * 产品的客户端调用方式；本项目已改为全部本地实现，远程仅保留为抖音验证期的
 * 可选对比通道，彻底移除后本文件不再包含任何外部端点。
 */

const axios = require("axios");
const { buildDouyinParams, getKuaishouSign } = require("./signer-local");

// 抖音验证开关：仅当显式设置 MP_SIGNER_BASE 时才发起远程签名请求（默认不设置 → 纯本地）
const SIGNER_BASE = process.env.MP_SIGNER_BASE || "";

// 抖音远程签名端口（验证期对比通道）
const SIGNER_PORTS = {
  douyin: 5042,
};

/**
 * 调用远程签名服务（仅验证期使用）
 * @param {string} platform - 平台标识
 * @param {object} params - 签名参数
 * @returns {Promise<object|null>} 签名结果；不可用/失败时返回 null（由调用方兜底）
 */
async function getRemoteSign(platform, params = {}) {
  const port = SIGNER_PORTS[platform];
  if (!port) throw new Error("No signer port for platform: " + platform);

  try {
    const resp = await axios.post(
      SIGNER_BASE + ":" + port + "/Sign/GetSign",
      params,
      { timeout: 10000, validateStatus: () => true }
    );
    if (resp.status === 200 && resp.data) {
      return resp.data;
    }
    console.warn("[signer] " + platform + " returned status " + resp.status);
    return null;
  } catch (err) {
    console.warn("[signer] " + platform + " request failed: " + err.message);
    return null;
  }
}

/**
 * 获取抖音 _signature
 *
 * 设置了 MP_SIGNER_BASE 时走"远程优先、本地兜底"（验证期对比通道）；
 * 否则纯本地（占位签名，待真机验证）。
 */
async function getDouyinSignature(url, userAgent) {
  if (SIGNER_BASE) {
    const remote = await getRemoteSign("douyin", { url, ts: Date.now() });
    if (remote) return remote;
  }
  return buildDouyinParams(userAgent);
}

/**
 * 获取快手 __NS_sig3（本地计算）
 *
 * 算法：MD5(api_ph | JSON.stringify(body))，api_ph 取自登录 cookie。
 * 注意：调用方必须传入 cookie，否则 api_ph 为空、签名为空串。
 *
 * @param {string} path - 请求路径（保留参数：远程对比通道使用）
 * @param {object} body - 发布数据
 * @param {string} [cookie] - 登录 cookie（含 kuaishou.web.cp.api_ph）
 * @returns {Promise<{signature: string, __NS_sig3: string}>}
 */
async function getKuaishouSignature(path, body, cookie) {
  const phMatch = cookie && cookie.match(/kuaishou\.web\.cp\.api_ph=([^;]+)/);
  const sig = getKuaishouSign(body, phMatch ? phMatch[1] : null);
  return { signature: sig, __NS_sig3: sig };
}

module.exports = {
  getRemoteSign,
  getDouyinSignature,
  getKuaishouSignature,
  SIGNER_PORTS,
};
