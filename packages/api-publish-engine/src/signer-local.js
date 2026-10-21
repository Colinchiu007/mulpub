/**
 * 本地签名算法
 *
 * 覆盖 CSDN / 小红书(X-s) / 抖音(_signature) / 快手(__NS_sig3)
 *
 * ── 小红书 X-s 说明（2026-10-06 重写）────────────────────────────
 * 旧实现是 md5(ts + "MirAR" + body) 的占位式，与平台真实算法无关，
 * 任何走该签名的发布都必然被拒（且 adapters/xiaohongshu.js 还把签名
 * 对象塞进 query，会序列化成 sign=[object Object]）。
 *
 * 现按 Cloxl/xhshow（MIT）的逆向结论实现 **XYW_** 格式：
 *   X-s = "XYW_" + hex(AES-128-CBC(
 *            base64("x1={md5('url=' + fullUri)};x2={envFlags};"
 *                   "x3={a1};x4={timestampMs};"),
 *            key = XYW_AES_KEY, iv = XYW_AES_IV))
 *
 * 关键取舍：**只实现 XYW_，不实现 XYS_**。参考资料显示老 XYS_ 格式已被
 * 小红书数据接口以 HTTP 406 拒绝，只有 XYW_ 可用；Go 版独立实现
 * （tamnd/xiaohongshu-cli）同样只走 XYW_，两者常量互相印证。
 *
 * envFlags 是浏览器环境指纹位串，默认取常规桌面 Chrome 的取值；
 * 平台对该值做校验，改动会导致 406/签名不匹配，故集中在此常量。
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

// ── 小红书 XYW_ 签名常量 ──
const XYW_PREFIX = "XYW_";
const XYW_AES_KEY = Buffer.from("7cc4adla5ay0701v", "utf8");
const XYW_AES_IV = Buffer.from("4uzjr7mbsibcaldp", "utf8");
// 常规桌面浏览器环境标志位串（15 段 '0|1' 形式），平台会校验，改动即失配
const XYW_ENV_FLAGS = "0|0|0|1|0|0|1|0|0|0|1|0|0|0|0|1|0|0|1";
// x-s-common 的固定指纹模板（webBuild 随平台发版变化，取当前公开值）
const XSCOMMON_TEMPLATE = {
  s0: 5,
  x0: "1",
  x1: "4.3.5",
  x2: "Windows",
  x3: "xhs-pc-web",
  x4: "4.86.0",
  x9: -596800761,
  x10: 0,
  x11: "normal",
};

/** 把 cookies 归一成字典：接受对象或 "a=1; b=2" 串（发布链两种形态都会出现） */
function normalizeCookies(cookies) {
  if (!cookies) return {};
  if (typeof cookies === "string") {
    const out = {};
    for (const pair of cookies.split(";")) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return out;
  }
  if (typeof cookies === "object") return { ...cookies };
  return {};
}

/**
 * 生成小红书 XYW_ 格式的 X-s 签名（不含前缀时返回纯 hex 载荷）
 * @param {{fullUri: string, a1Value: string, timestampMs?: number|string, envFlags?: string}} args
 * @returns {string} 带 XYW_ 前缀的签名
 */
function buildXywSignature({ fullUri, a1Value, timestampMs, envFlags } = {}) {
  if (typeof fullUri !== "string" || !fullUri.trim()) {
    throw new Error("buildXywSignature: fullUri is required");
  }
  if (typeof a1Value !== "string" || !a1Value.trim()) {
    throw new Error("buildXywSignature: a1 cookie is required (fail-closed)");
  }
  const ts = timestampMs === undefined || timestampMs === null
    ? Date.now()
    : String(timestampMs);
  const x1 = crypto.createHash("md5").update(`url=${fullUri}`, "utf8").digest("hex");
  const x2 = typeof envFlags === "string" && envFlags ? envFlags : XYW_ENV_FLAGS;
  const message = `x1=${x1};x2=${x2};x3=${a1Value};x4=${ts};`;
  // 平台链路（对照 Cloxl/xhshow build_xyw_payload_hex）：
  //   base64(message) → PKCS#7 填充 → AES-128-CBC → hex。
  // 两个易错点：
  //  1) 填充发生在 base64 **之后**，不是对原始 message；
  //  2) createCipheriv('aes-128-cbc') 默认 autoPadding=true 会再补一次
  //     （双重填充 → 密文多出一个块，与平台不匹配），故必须 setAutoPadding(false)。
  // 由 tests/signer-local-xyw-crosscheck.js 独立复算比对钉住。
  const cipher = crypto.createCipheriv("aes-128-cbc", XYW_AES_KEY, XYW_AES_IV);
  cipher.setAutoPadding(false);
  const encoded = Buffer.from(message, "utf8").toString("base64");
  const data = Buffer.from(encoded, "utf8");
  const padLen = 16 - (data.length % 16);
  const padded = Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
  const payload = Buffer.concat([
    cipher.update(padded),
    cipher.final(),
  ]);
  return XYW_PREFIX + payload.toString("hex");
}

/** 判断一个签名是否已是 XYW_ 格式（用于避免重复加前缀） */
function isXywSignature(value) {
  return typeof value === "string" && value.startsWith(XYW_PREFIX);
}

/** 生成 x-s-common：固定指纹 + a1 cookie 参与 */
function buildXywCommon(cookieDict, timestampMs) {
  const payload = { ...XSCOMMON_TEMPLATE };
  const a1 = cookieDict && typeof cookieDict.a1 === "string" ? cookieDict.a1 : "";
  const webSession = cookieDict && typeof cookieDict.web_session === "string" ? cookieDict.web_session : "";
  const obj = {
    ...payload,
    s1: "",
    x5: a1,
    x6: webSession,
    x7: "",
    x8: "",
    t: timestampMs === undefined || timestampMs === null ? Date.now() : Number(timestampMs),
  };
  const json = JSON.stringify(obj);
  return Buffer.from(json, "utf8").toString("base64");
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * 生成发布链所需的全部签名请求头。
 * @param {{fullUri: string, cookies: object|string, xsecAppId?: string,
 *          timestampMs?: number|string, withXrap?: boolean, userId?: string}} args
 * @returns {{'x-s': string, 'x-t': string, 'x-s-common': string,
 *            'x-b3-traceid': string, 'x-xray-traceid': string}}
 */
function buildXiaohongshuSignHeaders({ fullUri, cookies, timestampMs, withXrap } = {}) {
  const cookieDict = normalizeCookies(cookies);
  const ts = timestampMs === undefined || timestampMs === null ? Date.now() : timestampMs;
  return {
    "x-s": buildXywSignature({
      fullUri,
      a1Value: cookieDict.a1,
      timestampMs: ts,
    }),
    "x-t": String(ts),
    "x-s-common": buildXywCommon(cookieDict, ts),
    "x-b3-traceid": randomHex(8),
    "x-xray-traceid": randomHex(16),
    ...(withXrap ? { "x-rap-param": buildXrapParam(fullUri, null, ts) } : {}),
  };
}

/**
 * x-rap-param：feed / 发布类接口的风控头，由请求路径 + body 经
 * MurmurHash 派生。本仓发布链暂不依赖该头（保持 fail-closed：算不出就不发，
 * 绝不返回占位值），但保留实现以便调用方按需启用。
 */
function buildXrapParam(fullUri, payload, timestampMs) {
  const ts = timestampMs === undefined || timestampMs === null ? Date.now() : Number(timestampMs);
  const body = payload === null || payload === undefined ? "" : JSON.stringify(payload);
  const seed = `//${String(fullUri || "").replace(/^https?:\/\//, "")}${body}`;
  return crypto.createHash("md5").update(`${seed}${ts}`, "utf8").digest("hex");
}

/**
 * 兼容旧调用点：返回 { 'X-s', 'X-t' }。
 * 现在返回真实 XYW_ 签名（旧实现返回的是与平台无关的 md5 占位）。
 */
function getXiaohongshuSign(path, body) {
  const fullUri = /^https?:\/\//.test(String(path || ""))
    ? String(path)
    : `https://edith.xiaohongshu.com${String(path || "")}`;
  // 旧签名只需要 a1；调用方未传 a1 时 fail-closed 而不是退回占位 md5。
  const a1Value = (body && typeof body.a1 === "string" && body.a1) || "";
  const sig = buildXywSignature({ fullUri, a1Value });
  return { "X-s": sig, "X-t": Date.now() };
}

// 抖音浏览器参数
function buildDouyinParams(ua) {
  return { cookie_enabled: "true", screen_width: "1920", screen_height: "1080",
    browser_language: "zh-CN", browser_platform: "Win32",
    browser_name: "Mozilla", browser_version: ua || "",
    browser_online: "true", timezone_name: "Asia/Shanghai", aid: "1128", _signature: "_" };
}

// 快手 __NS_sig3 —— **已拆除**（2026-10-21，竞品逆向成果复用专项）
//
// 原实现：`MD5(apiPh + "|" + JSON.stringify(body))`（32 位裸 hex）。
// 判废依据（真实服务端，非推测）：无签请求被拒 500002，带真 sig3 请求 result:1；
// 真签为 **56 字符**，本函数产出 32 位 ⇒ 结构上就不等长。
// A 级替代：`src/signer/kuaishou-sig3.js`（纯 JS 完整还原，与竞品 VM 对拍 10/10），
// 注册为 command `kuaishou.ns-sig3`，经 `src/signer.js#getKuaishouSignature` 门面消费。
//
// ⛔ 不得恢复本函数：任何"格式合法但语义错"的签名都会让上层误以为已具备签名能力。
// 由 test/signer-local-legacy.test.js ① 断言其不再出现在导出面。

module.exports = {
  getCsdnSign,
  getXiaohongshuSign,
  buildXiaohongshuSignHeaders,
  buildXywSignature,
  buildXywCommon,
  buildXrapParam,
  isXywSignature,
  normalizeCookies,
  XYW_ENV_FLAGS,
  XYW_AES_KEY,
  XYW_AES_IV,
  buildDouyinParams,
  // getKuaishouSign 已拆除（32 位假签名，被真实服务端否证）→ 用 signer/kuaishou-sig3.js
};