'use strict';

/**
 * 组装根：从环境变量构造 `WeChatNativeProvider`。
 *
 * ## 为什么必须有这个文件（2026-10-22 实测）
 *
 * 在此之前 `WeChatNativeProvider` **只在它自己的定义文件和测试里出现过**，生产代码从未 `new` 过它：
 *
 *   logto-runtime.js:127  new SubscriptionService({ repository, planOverrides })   ← 没传 paymentProvider
 *   subscription-service.js:120  this.paymentProvider = options.paymentProvider || null
 *   subscription-payment.js:56   if (!this.paymentProvider) { … }                  ← 恒回 503
 *
 * 于是：迁移应用了、compose 透传了、`.env` 填满了、商户平台配好了 —— `POST /me/checkout` **仍然恒 503**。
 *
 * 而 100+ 条支付测试全绿也发现不了，因为每条都**注入** provider：
 * 被注入的东西永远不需要有人去构造它。单元覆盖率 100%，**组合根覆盖率 0%**。
 * 本文件就是那个"有人去构造它"的地方。
 *
 * ## 一次接全，不许半接
 *
 * 下单需要商户私钥签名；回调需要平台公钥验签。只接下单不接验签 = 用户付了钱、webhook 401、
 * 权益不发放 —— 比"根本付不了款"更糟。所以本工厂对两者都做强制校验，缺一即抛。
 */

const fs = require('fs');
const crypto = require('crypto');
const { WeChatNativeProvider } = require('./wechat-native');
const { PaymentProviderError } = require('./index');

const WECHAT_NATIVE = 'wechat_native';
const NONCE_BYTES = 16;
const AUTH_SCHEMA = 'WECHATPAY2-SHA256-RSA2048';

/**
 * 校验「这是不是一把能用的私钥」。
 *
 * 为什么在加载期校验而不是等第一次下单：`crypto.createSign().sign(垃圾内容)` 抛的是
 * OpenSSL 的 `error:...:asn1 encoding routines` —— 那个错误发生在用户点「立即购买」的那一刻，
 * 表现为一次 502，而根因（env 里粘错了内容）跟现象隔了三层。加载期校验把它变成启动期的一条明确报错。
 */
function assertPrivateKey (pem) {
  try {
    crypto.createPrivateKey(pem);
  } catch (error) {
    throw new PaymentProviderError(
      'PAYMENT_CERT_INVALID',
      `商户私钥不是合法的 PEM 私钥：${(error && error.message) || error}`,
      500,
    );
  }
}

/**
 * 校验平台凭据。允许两种形态（与 `toVerifiableKey` 的口径一致）：
 * ① X509 证书（PEM 含 CERTIFICATE 头，或裸 Base64 的证书）；
 * ② 微信支付公钥（裸 Base64 SPKI 或 PEM 公钥）。
 */
function assertPlatformKey (value) {
  const text = String(value || '').trim();
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    try {
      new crypto.X509Certificate(text);
      return;
    } catch (error) {
      throw new PaymentProviderError('PAYMENT_CERT_INVALID', `平台证书不可解析：${(error && error.message) || error}`, 500);
    }
  }
  const candidates = [text];
  if (!text.includes('-----BEGIN')) {
    // 裸 Base64：可能是证书也可能是 SPKI 公钥，两种都试（与 provider 的 toVerifiableKey 同口径）。
    candidates.unshift(
      `-----BEGIN PUBLIC KEY-----\n${text}\n-----END PUBLIC KEY-----`,
    );
  }
  for (const candidate of candidates) {
    try {
      crypto.createPublicKey(candidate);
      return;
    } catch (_) { /* 继续试下一种 */ }
  }
  throw new PaymentProviderError('PAYMENT_CERT_INVALID', '平台公钥既不是可解析的证书，也不是可解析的公钥', 500);
}
/** 读一份 PEM：优先内联内容，其次文件路径。两者都没有即抛（绝不返回空串让下游拿空密钥去签名）。 */
function readPem (env, contentVar, pathVar, deps = {}) {
  const inline = String(env[contentVar] || '').trim();
  if (inline) return inline;
  const filePath = String(env[pathVar] || '').trim();
  if (!filePath) {
    throw new PaymentProviderError(
      'PAYMENT_CONFIG_INVALID',
      `缺少 ${contentVar} 或 ${pathVar}（二选一必填）`,
      500,
    );
  }
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  let text;
  try {
    text = String(readFile(filePath, 'utf8') || '').trim();
  } catch (error) {
    throw new PaymentProviderError(
      'PAYMENT_CERT_UNREADABLE',
      `${pathVar} 指向的文件读不出来：${(error && error.message) || error}`,
      500,
    );
  }
  if (!text) {
    throw new PaymentProviderError('PAYMENT_CERT_UNREADABLE', `${pathVar} 指向的文件是空的`, 500);
  }
  return text;
}

/**
 * 生成微信 APIv3 的 `Authorization` 头。
 *
 * 签名原文（微信文档的固定格式，**五个字段四个换行**，末尾必须有一个换行）：
 *
 *   HTTP方法\nURL路径\n时间戳\n随机串\n请求报文主体\n
 *
 * 报文主体必须与实际发出的**逐字节一致**。本仓下单时实际发的是 `JSON.stringify(body)`，
 * 所以这里也对同一个对象做 `JSON.stringify` —— 不能传对象本身，也不能二次格式化。
 *
 * @returns {string} `WECHATPAY2-SHA256-RSA2048 mchid="…",nonce_str="…",signature="…",timestamp="…",serial_no="…"`
 */
function buildAuthorizationHeader ({
  mchId,
  serialNo,
  privateKey,
  method,
  path,
  body,
  nonceStr,
  timestamp,
  sign,
}) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body == null ? {} : body);
  const message = `${method}\n${path}\n${timestamp}\n${nonceStr}\n${bodyText}\n`;
  const signer = sign || ((text, key) => crypto.createSign('RSA-SHA256').update(text, 'utf8').sign(key, 'base64'));
  const signature = signer(message, privateKey);
  return `${AUTH_SCHEMA} mchid="${mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
}

/**
 * 从环境变量构造 provider。
 *
 * @param {object} env 环境变量（`process.env` 或测试注入的对象）
 * @param {object} [deps] 注入点：`fetcher` / `now` / `nonce` / `readFile` / `sign`
 * @returns {WeChatNativeProvider|null} `PAYMENT_PROVIDER !== 'wechat_native'` 时返回 `null`（入口 fail-closed）
 */
function createWeChatNativeProvider (env = {}, deps = {}) {
  const kind = String(env.PAYMENT_PROVIDER || 'none').trim().toLowerCase();
  // 非 wechat_native（含默认 none）：返回 null，让 /me/checkout 走 503 分支。
  // 这里**不抛错**：没配支付的环境必须能正常启动，支付是可选能力。
  if (kind !== WECHAT_NATIVE) return null;

  const appid = String(env.WECHAT_PAY_APPID || '').trim();
  const mchId = String(env.WECHAT_PAY_MCH_ID || '').trim();
  const apiV3Key = String(env.WECHAT_PAY_API_V3_KEY || '');
  const notifyUrl = String(env.WECHAT_PAY_NOTIFY_URL || '').trim();
  const serialNo = String(env.WECHAT_PAY_CERT_SERIAL_NO || '').trim();

  const missing = [];
  if (!appid) missing.push('WECHAT_PAY_APPID');
  if (!mchId) missing.push('WECHAT_PAY_MCH_ID');
  if (!apiV3Key) missing.push('WECHAT_PAY_API_V3_KEY');
  if (!notifyUrl) missing.push('WECHAT_PAY_NOTIFY_URL');
  if (!serialNo) missing.push('WECHAT_PAY_CERT_SERIAL_NO');
  if (missing.length) {
    throw new PaymentProviderError(
      'PAYMENT_CONFIG_INVALID',
      `PAYMENT_PROVIDER=wechat_native 时缺少：${missing.join(', ')}`,
      500,
    );
  }
  if (apiV3Key.length !== 32) {
    throw new PaymentProviderError('PAYMENT_API_V3_KEY_INVALID', 'WECHAT_PAY_API_V3_KEY 必须是 32 个字符', 500);
  }

  // 商户私钥（下单签名）与平台公钥（回调验签）必须同时具备 —— 见文件头「一次接全」。
  const merchantPrivateKey = readPem(env, 'WECHAT_PAY_CERT_CONTENT', 'WECHAT_PAY_CERT_PATH', deps);
  const platformPublicKey = readPem(
    env,
    'WECHAT_PAY_PLATFORM_PUBLIC_KEY',
    'WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH',
    deps,
  );
  // 微信 2024+ 公钥模式用 `PUB_KEY_ID_…` 作为回调头里的 serial；配置了就按它核对。
  const publicKeyId = String(env.WECHAT_PAY_PUBLIC_KEY_ID || '').trim();

  // 加载期就把「能不能用」验掉，别等用户点购买时才炸（见 assertPrivateKey 的说明）。
  assertPrivateKey(merchantPrivateKey);
  assertPlatformKey(platformPublicKey);

  const now = typeof deps.now === 'function' ? deps.now : () => new Date();
  const makeNonce = typeof deps.nonce === 'function'
    ? deps.nonce
    : () => crypto.randomBytes(NONCE_BYTES).toString('hex');
  const fetcher = deps.fetcher || ((url, init) => fetch(url, init));

  return new WeChatNativeProvider({
    appid,
    mchId,
    apiV3Key,
    notifyUrl,
    fetcher,
    now,
    signRequest: (method, path, body) => ({
      Authorization: buildAuthorizationHeader({
        mchId,
        serialNo,
        privateKey: merchantPrivateKey,
        method,
        path,
        body,
        nonceStr: makeNonce(),
        timestamp: String(Math.floor(now().getTime() / 1000)),
        sign: deps.sign,
      }),
    }),
    certificateProvider: {
      /**
       * 只持有一把平台公钥（本仓只有单一商户）。
       * 配了 `WECHAT_PAY_PUBLIC_KEY_ID` 就按它核对：serial 对不上时返回 null，
       * 让验签以 `PAYMENT_WEBHOOK_CERT_NOT_FOUND` 失败 —— 这是**刻意 fail-closed**，
       * 因为"换公钥了但没更新配置"必须吵出来，不能拿旧公钥默默验过。
       */
      getBySerial: async (serial) => {
        if (publicKeyId && String(serial || '') !== publicKeyId) return null;
        return platformPublicKey;
      },
    },
  });
}

module.exports = {
  AUTH_SCHEMA,
  WECHAT_NATIVE,
  assertPlatformKey,
  assertPrivateKey,
  buildAuthorizationHeader,
  createWeChatNativeProvider,
  readPem,
};
