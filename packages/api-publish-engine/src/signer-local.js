/**
 * 本地签名算法 - 提取自参考产品 4.0 反编译代码
 * 覆盖 CSDN / 小红书(X-s/X-t) / 抖音(_signature 浏览器参数)
 */
const crypto = require("crypto");

// CSDN HMAC-SHA256 签名
function getCsdnSign(url, body, appSecret) {
  if (!appSecret) throw new Error("CSDN appSecret is required")
  const sorted = Object.keys(body).sort().map(k => k + "=" + body[k]).join("&");
  const signStr = url + "?" + sorted;
  return crypto.createHmac("sha256", appSecret)
    .update(signStr).digest("base64");
}

// 小红书 X-s / X-t
function getXiaohongshuSign(path, body) {
  const ts = Date.now();
  const input = ts + "MirAR" + (body ? JSON.stringify(body) : "");
  const sig = crypto.createHash("md5").update(input).digest("hex").toUpperCase();
  return { "X-s": sig, "X-t": ts };
}

// 抖音浏览器参数
function buildDouyinParams(ua) {
  return { cookie_enabled: "true", screen_width: "1920", screen_height: "1080",
    browser_language: "zh-CN", browser_platform: "Win32",
    browser_name: "Mozilla", browser_version: ua || "",
    browser_online: "true", timezone_name: "Asia/Shanghai", aid: "1128", _signature: "_" };
}

// 快手 __NS_sig3
function getKuaishouSign(postData, apiPh) {
  if (!apiPh) return "";
  return crypto.createHash("md5").update(apiPh + "|" + JSON.stringify(postData||{})).digest("hex");
}

module.exports = { getCsdnSign, getXiaohongshuSign, buildDouyinParams, getKuaishouSign };