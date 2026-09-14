/**
 * 远程签名服务客户端（第三方 HTTP 签名服务，端口按平台划分）
 *
 * 服务端点默认由常量提供，可用环境变量 MP_SIGNER_BASE 覆盖（部署/自建签名服务场景）。
 * 远程不可用时：抖音 / 快手 / 小红书 自动回退 signer-local 本地实现；
 * 百家号无本地回退，远程签名服务属于发布链路的硬依赖，端点不可移除。
 *
 * 各平台端口:
 *   快手 5008-5011
 *   抖音 5041-5042
 *   小红书 5061-5063
 *   百家号 5012
 *   头条号 5031-5032
 */

const axios = require("axios");
const { getCsdnSign, getXiaohongshuSign, buildDouyinParams, getKuaishouSign } = require("./signer-local");

const SIGNER_BASE = process.env.MP_SIGNER_BASE || "http://qianming.yixiaoer.cn";

// 各平台签名端口映射
const SIGNER_PORTS = {
  douyin: 5042,
  kuaishou: 5009,
  xiaohongshu: 5062,
  baijiahao: 5012,
  toutiao: 5032,
};

/**
 * 调用远程签名服务
 * @param {string} platform - 平台标识
 * @param {object} params - 签名参数
 * @returns {Promise<object>} { signature, cookies, ... }
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
 */
async function getDouyinSignature(url, userAgent) {
  const remote = await getRemoteSign("douyin", { url, ts: Date.now() });
  if (remote) return remote;
  return buildDouyinParams(userAgent);
}

/**
 * 获取快手 __NS_sig3
 */
async function getKuaishouSignature(path, body, cookie) {
  const remote = await getRemoteSign("kuaishou", { path, body, ts: Date.now() });
  if (remote) return remote;
  const phMatch = cookie && cookie.match(/kuaishou\.web\.cp\.api_ph=([^;]+)/);
  const sig = getKuaishouSign(body, phMatch ? phMatch[1] : null);
  return { signature: sig, __NS_sig3: sig };
}

/**
 * 获取小红书 COS token
 */
async function getXiaohongshuToken(path, body) {
  const remote = await getRemoteSign("xiaohongshu", { action: "getCosToken", ts: Date.now() });
  if (remote) return remote;
  return getXiaohongshuSign(path, body);
}

/**
 * 获取百家号签名
 */
async function getBaijiahaoSignature(params) {
  return getRemoteSign("baijiahao", params);
}

module.exports = {
  getRemoteSign,
  getDouyinSignature,
  getKuaishouSignature,
  getXiaohongshuToken,
  getBaijiahaoSignature,
  getCsdnSign,
  getXiaohongshuSign,
  SIGNER_PORTS,
};
