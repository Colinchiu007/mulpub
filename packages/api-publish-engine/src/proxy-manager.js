// 代理管理 (提取自参考产品 createProxyAgent)
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");

function createProxyAgent(proxyConfig) {
  if (!proxyConfig || !proxyConfig.host || !proxyConfig.port) return null;
  // 安全修复（2026-07-16）：凭据 encodeURIComponent，防止含 @ : 等特殊字符导致 URL 解析错误
  let auth = "";
  if (proxyConfig.username && proxyConfig.password) {
    const u = encodeURIComponent(proxyConfig.username);
    const p = encodeURIComponent(proxyConfig.password);
    auth = u + ":" + p + "@";
  }
  const protocol = proxyConfig.protocol || "http";
  const host = encodeURIComponent(proxyConfig.host);
  const proxyUrl = protocol + "://" + auth + host + ":" + proxyConfig.port;
  return {
    httpAgent: new HttpProxyAgent(proxyUrl),
    httpsAgent: new HttpsProxyAgent(proxyUrl),
  };
}

module.exports = { createProxyAgent };