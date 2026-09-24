// @ts-check
/**
 * HTTP API 登录检测 — 用保存的 Cookie 直接调用平台内部 API 判断登录态
 *
 * 参考同类产品 checkAccountAlive 逆向：不打开浏览器窗口，纯 HTTP 请求，
 * 每次检测 <1 秒（浏览器窗口方案需 4-8 秒/平台）。
 *
 * API 端点来源：参考产品 4.0 逆向（packages/main/dist/index.cjs）。
 * 各平台判断逻辑采用黑名单语义：仅平台明确告知未登录才判失效；
 * 其余不确定响应（风控页/结构变更/非预期状态码）返回 undefined，
 * 由调用方（account-manager.checkLoginStatus）降级到浏览器检测，
 * 避免平台风控拦截检测请求时把有效 Cookie 误判为已失效（假阳性）。
 * - douyin: GET /aweme/v1/creator/pc/user/info/ → status_code === 0 且有 user
 *   数据判有效；status_code === 8 或 status_msg/msg 含「未登录」判失效
 *   （对齐参考产品 checkAccountAlive）；其余一切 → 不确定，降级
 * - toutiao: GET /mp/agw/media/get_media_info → code === 0 且有 user.id
 */
const log = require("../services/logger");

/**
 * @typedef {Object} HttpCheckApi
 * @property {string} url
 * @property {Record<string,string>} headers
 * @property {'GET'|'POST'} [method] - 默认 GET
 * @property {string|(() => string)} [body] - POST JSON body（视频号 auth_data）；
 *               函数形态在每次发请求时求值，含 timestamp 的接口必须用函数形态，
 *               否则时间戳会被模块加载时刻冻结（进程存活越久偏差越大，平台按
 *               时间戳校验失败 → 检测结论失真）
 * @property {string} [contentType] - POST Content-Type（默认 application/json）
 * @property {(data:any)=>boolean|undefined} [check] - JSON 响应判定；undefined=不确定（降级浏览器检测）；check 与 checkHtml 互斥
 * @property {(html:string)=>boolean|undefined} [checkHtml] - HTML 响应判定（公众号 loginpage 正则）；undefined=不确定（降级浏览器检测）
 * @property {(cookieHeader:string)=>boolean} [precheck] - 请求前 cookie 预检（如 bilibili 必须含 bili_jct）
 */

/** 从平台响应字段安全取正整数计数（取不到返回 undefined，让调用方保持原值） */
function toCount(v) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

/** @type {Record<string, HttpCheckApi>} */
const HTTP_CHECK_APIS = {
  douyin: {
    url: "https://creator.douyin.com/aweme/v1/creator/pc/user/info/",
    headers: {
      Referer: "https://creator.douyin.com/creator-micro/home",
      Origin: "https://creator.douyin.com",
    },
    check: (data) => {
      // 黑名单语义（对齐参考产品 checkAccountAlive）：只有平台明确告知
      // 未登录才判失效；风控拦截/结构变更/其他状态码一律返回 undefined
      // 交由调用方降级浏览器检测，避免把有效 Cookie 误判为已失效。
      if (!data || typeof data !== "object") return undefined; // 风控页/非 JSON → 不确定，降级
      if (
        data.status_code === 0 &&
        data.data &&
        (data.data.uid || data.data.user_id || data.data.nickname !== undefined)
      )
        return true;
      if (data.status_code === 8) return false; // 对齐参考产品 checkAccountAlive：8=明确未登录
      const msg = data.status_msg || data.msg || data.message;
      if (typeof msg === "string" && msg.includes("未登录")) return false;
      return undefined; // 其余一切（其他码/缺字段/结构变更）→ 不确定，降级
    },
    extract: (d) => {
      const u = (d && d.data && (d.data.user || d.data)) || {};
      return {
        nickname: u.nickname || u.nick_name || u.uname || "",
        followers: toCount(u.follower_count != null ? u.follower_count : u.fans_count),
        platformAccountId: String(u.uid || u.user_id || ""),
      };
    },
  },
  toutiao: {
    url: "https://mp.toutiao.com/mp/agw/media/get_media_info",
    headers: {
      Referer: "https://mp.toutiao.com/profile_v4/graphic/publish",
    },
    check: (data) => {
      // 黑名单语义：仅明确成功/明确未登录文案才给结论，其余降级浏览器检测
      if (!data || typeof data !== "object") return undefined;
      if (
        data.code === 0 &&
        data.data &&
        data.data.user &&
        (data.data.user.id || data.data.user.user_id)
      )
        return true;
      const msg = data.message || data.msg || data.status_msg;
      if (typeof msg === "string" && /未登录|请先登录|登录过期|重新登录/.test(msg)) return false;
      return undefined;
    },
    extract: (d) => {
      const u = (d && d.data && d.data.user) || {};
      return {
        nickname: u.name || u.screen_name || "",
        followers: toCount(u.fans_count != null ? u.fans_count : u.follower_count),
        platformAccountId: String(u.id || u.user_id || ""),
      };
    },
  },
  // 公众号：对齐参考产品 getWeixingongzhonghaoUserInfo —— GET loginpage 页（带 cookie），
  // 登录态由 HTML 内嵌的 token=/uin:/nick_name 正则体现；未登录时这些字段缺失。
  // 这比「访问后台首页看是否 302」更可靠：Cookie（slave_sid）过期后访问 cgi-bin/home
  // 仍可能返回 200 渲染骨架，但 loginpage 页面未登录时不会内嵌 token。
  wechat_mp: {
    url: "https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome",
    headers: {
      Referer: "https://mp.weixin.qq.com/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    checkHtml: (html) => {
      // 黑名单语义：token+uin 同时存在判有效；明确登录页文案判失效；
      // 空响应/风控页/结构变更（无 token 也无登录特征）→ 不确定，降级浏览器检测
      if (!html || typeof html !== "string") return undefined;
      // 对齐参考产品正则：&token=[0-9a-zA-Z]{3,} 与 uin:"[0-9]{3,}" 同时存在 → 已登录
      const hasToken = /&token=[0-9a-zA-Z]{3,}/.test(html) || /token=[0-9a-zA-Z]{3,}/.test(html);
      const hasUin = /uin:\s{0,}"[0-9]{3,}"/.test(html);
      if (hasToken && hasUin) return true;
      if (/扫码登录|请使用微信扫码|请登录|welcome_login/.test(html)) return false;
      return undefined;
    },
  },
  // 视频号：对齐参考产品 getShipinhaoUserInfo —— POST auth_data 接口（带 cookie），
  // errCode 300333/300334 判失效，data.finderUser 存在判有效。
  // 这比「访问后台首页看 302」更可靠，且渲染崩溃保护下视频号只能走 HTTP 检测。
  tencent_video: {
    url: "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data",
    headers: {
      Referer: "https://channels.weixin.qq.com",
    },
    method: "POST",
    contentType: "application/json",
    // 必须是函数：HTTP_CHECK_APIS 是模块级常量，直接写 JSON.stringify(Date.now())
    // 只会在 require 时求值一次，之后所有检测都带着同一个陈旧 timestamp。
    body: () =>
      JSON.stringify({
        timestamp: Date.now().toString().substring(0, 13),
        _log_finder_uin: "",
        _log_finder_id: "",
        rawKeyBuff: null,
        pluginSessionId: null,
        scene: 7,
        reqScene: 7,
      }),
    check: (data) => {
      // 黑名单语义：errCode 300333/300334 = 登录失效（参考产品判定）；
      // finderUser 存在判有效；其余结构（接口变更/风控）→ 不确定，降级
      if (!data || typeof data !== "object") return undefined;
      if (data.errCode === 300333 || data.errCode === 300334) return false;
      if (data.errCode === 0 && data.data && data.data.finderUser) return true;
      return undefined;
    },
    extract: (d) => {
      const f = (d && d.data && d.data.finderUser) || {};
      return {
        nickname: f.nickname || f.finderUsername || "",
        followers: toCount(f.fansCount != null ? f.fansCount : f.fans_count),
        platformAccountId: String(f.uniqId || ""),
      };
    },
  },
  // bilibili：对齐参考产品 getBilibiliUserInfo —— GET nav 接口（带 cookie + Referer），
  // code === -101 判失效，data.mid 存在判有效；cookie 必须含 bili_jct（缺失即失效）。
  bilibili: {
    url: "https://api.bilibili.com/x/web-interface/nav",
    headers: {
      Referer: "https://member.bilibili.com/",
    },
    precheck: (cookieHeader) => cookieHeader.includes("bili_jct="),
    check: (data) => {
      // 黑名单语义：code -101 = 明确未登录；code 0 且有 mid 判有效；
      // 其余状态码（风控 -352 等/结构变更）→ 不确定，降级
      if (!data || typeof data !== "object") return undefined;
      if (data.code === -101) return false;
      if (data.code === 0 && data.data && data.data.mid) return true;
      return undefined;
    },
    extract: (d) => {
      const u = (d && d.data) || {};
      return {
        nickname: u.uname || "",
        followers: toCount(u.fans),
        platformAccountId: String(u.mid || ""),
      };
    },
  },
};

/** 超时（毫秒）——HTTP API 检测应远快于浏览器窗口 */
const HTTP_CHECK_TIMEOUT_MS = 8000;

/**
 * 将 Cookie 数组转为请求头 Cookie 字符串
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {string}
 */
function cookiesToHeader(cookies) {
  if (!Array.isArray(cookies)) return "";
  return cookies
    .filter((c) => c && c.name && c.value)
    .map((c) => c.name + "=" + c.value)
    .join("; ");
}

/**
 * HTTP API 检测平台登录态（仅支持 HTTP_CHECK_APIS 中注册的平台）
 * @param {string} platform
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {Promise<{supported: boolean, valid?: boolean, code?: string, error?: string}>}
 */
async function checkLoginViaHttpApi(platform, cookies) {
  const api = HTTP_CHECK_APIS[platform];
  if (!api) return { supported: false };

  const cookieHeader = cookiesToHeader(cookies);
  if (!cookieHeader) return { supported: true, valid: false, code: "CHECK_LOGIN_NO_CREDENTIAL" };
  if (typeof api.precheck === "function" && !api.precheck(cookieHeader)) {
    log.info(
      "HttpLoginChecker",
      platform + ": cookie precheck failed (missing required key) → expired",
    );
    return { supported: true, valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_CHECK_TIMEOUT_MS);
  try {
    const fetchOptions = {
      method: api.method || "GET",
      headers: {
        ...api.headers,
        Cookie: cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
      redirect: "manual",
    };
    if (api.method === "POST") {
      fetchOptions.headers["Content-Type"] = api.contentType || "application/json";
      fetchOptions.body = typeof api.body === "function" ? api.body() : api.body || "{}";
    }
    const response = await fetch(api.url, fetchOptions);
    clearTimeout(timer);

    // 3xx：Location 指向登录页 = Cookie 失效；其他重定向（含拿不到 Location）
    // 可能是风控跳转，不判失效 → 不确定，降级浏览器检测（黑名单语义）
    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307
    ) {
      const location = response.headers.get("location") || "";
      if (/login|passport|signin|sso/i.test(location)) {
        log.info(
          "HttpLoginChecker",
          platform + ": redirect to " + location.slice(0, 80) + " → expired",
        );
        return { supported: true, valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED" };
      }
      log.info(
        "HttpLoginChecker",
        platform + ": redirect to " + location.slice(0, 80) + " → inconclusive → fallback",
      );
      return { supported: true, valid: undefined, code: "CHECK_LOGIN_INCONCLUSIVE" };
    }

    if (!response.ok) {
      // 401/403 = 平台明确未授权 → Cookie 失效；其余非 2xx（404/429/5xx 等）
      // 可能是风控/临时故障，不判失效 → 不确定，降级浏览器检测
      if (response.status === 401 || response.status === 403) {
        log.info("HttpLoginChecker", platform + ": HTTP " + response.status + " → expired");
        return { supported: true, valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED" };
      }
      log.info(
        "HttpLoginChecker",
        platform + ": HTTP " + response.status + " → inconclusive → fallback",
      );
      return { supported: true, valid: undefined, code: "CHECK_LOGIN_INCONCLUSIVE" };
    }

    // HTML 响应判定（公众号 loginpage 正则）
    if (typeof api.checkHtml === "function") {
      const html = await response.text().catch(() => "");
      const valid = api.checkHtml(html);
      if (valid === undefined) {
        // 判定不确定（风控页/结构变更/空响应）→ 不判失效，降级浏览器检测
        log.info(
          "HttpLoginChecker",
          platform + ": HTML check → inconclusive (html len=" + html.length + ") → fallback",
        );
        return { supported: true, valid: undefined, code: "CHECK_LOGIN_INCONCLUSIVE" };
      }
      log.info(
        "HttpLoginChecker",
        platform +
          ": HTML check → " +
          (valid ? "valid" : "expired") +
          " (html len=" +
          html.length +
          ")",
      );
      return {
        supported: true,
        valid,
        code: valid ? "CHECK_LOGIN_SUCCESS_HTTP_API" : "CHECK_LOGIN_COOKIE_EXPIRED",
      };
    }

    // JSON 响应判定
    const data = await response.json().catch(() => null);
    const valid = typeof api.check === "function" ? api.check(data) : false;
    if (valid === undefined) {
      // 判定不确定（风控页/结构变更/非预期状态码）→ 不判失效，降级浏览器检测
      log.info(
        "HttpLoginChecker",
        platform +
          ": API check → inconclusive (data keys: " +
          (data ? Object.keys(data).slice(0, 5).join(",") : "null") +
          ")",
      );
      return { supported: true, valid: undefined, code: "CHECK_LOGIN_INCONCLUSIVE" };
    }
    log.info(
      "HttpLoginChecker",
      platform +
        ": API check → " +
        (valid ? "valid" : "expired") +
        " (data keys: " +
        (data ? Object.keys(data).slice(0, 5).join(",") : "null") +
        ")",
    );
    return {
      supported: true,
      valid,
      code: valid ? "CHECK_LOGIN_SUCCESS_HTTP_API" : "CHECK_LOGIN_COOKIE_EXPIRED",
    };
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e && (e.name === "AbortError" || e.name === "TimeoutError");
    log.warn(
      "HttpLoginChecker",
      platform +
        ": " +
        (isAbort ? "timeout" : "error") +
        " → " +
        (e && e.message ? e.message : String(e)),
    );
    // 网络错误不判失效，返回 unknown 让调用方降级到浏览器检测
    return {
      supported: true,
      valid: undefined,
      code: isAbort ? "CHECK_LOGIN_HTTP_TIMEOUT" : "CHECK_LOGIN_HTTP_ERROR",
      error: e && e.message,
    };
  }
}

/**
 * 检查平台是否支持 HTTP API 检测
 * @param {string} platform
 * @returns {boolean}
 */
function isHttpCheckSupported(platform) {
  return Boolean(HTTP_CHECK_APIS[platform]);
}

/**
 * HTTP API 快速路径入口（供 checkLoginStatus 调用）。
 * 有 Cookie 且平台已注册时尝试 HTTP API 检测；返回 null 表示不适用
 * （无 Cookie/未注册）或结果不确定（网络错误），调用方降级到浏览器检测。
 * @param {string} platform
 * @param {Array<{name:string, value:string}>} cookies
 * @param {string} accountId
 * @returns {Promise<{valid:boolean, code:string}|null>}
 */
async function tryHttpLoginCheck(platform, cookies, accountId) {
  if (!cookies || cookies.length === 0 || !isHttpCheckSupported(platform)) return null;
  const httpResult = await checkLoginViaHttpApi(platform, cookies);
  if (httpResult.valid === undefined) {
    log.info(
      "HttpLoginChecker",
      "inconclusive " + platform + ":" + accountId + " → falling back to browser check",
    );
    return null;
  }
  log.info(
    "HttpLoginChecker",
    "fast-path " +
      platform +
      ":" +
      accountId +
      " valid=" +
      httpResult.valid +
      " code=" +
      httpResult.code,
  );
  return { valid: httpResult.valid, code: httpResult.code };
}

/**
 * 用保存的 Cookie 调平台创作者 API 提取账号资料（昵称/粉丝/平台ID）。
 * 与登录检测共用同一批已注册端点（对齐蚁小二：不抓 DOM，直接读结构化 JSON）。
 * 只在平台注册了 extract 且响应可解析时返回字段；任何异常/缺字段一律省略键，
 * 由调用方（refreshProfileFromHttpApi）经 buildProfilePatch 决定「缺席=不修改」。
 * @param {string} platform
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {Promise<{supported: boolean, nickname?: string, followers?: number, platformAccountId?: string}>}
 */
async function fetchAccountInfoViaHttpApi(platform, cookies) {
  const api = HTTP_CHECK_APIS[platform];
  if (!api || typeof api.extract !== "function") return { supported: false };
  const cookieHeader = cookiesToHeader(cookies);
  if (!cookieHeader) return { supported: true };
  if (typeof api.precheck === "function" && !api.precheck(cookieHeader)) return { supported: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_CHECK_TIMEOUT_MS);
  try {
    const fetchOptions = {
      method: api.method || "GET",
      headers: {
        ...api.headers,
        Cookie: cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
      redirect: "manual",
    };
    if (api.method === "POST") {
      fetchOptions.headers["Content-Type"] = api.contentType || "application/json";
      fetchOptions.body = typeof api.body === "function" ? api.body() : api.body || "{}";
    }
    const response = await fetch(api.url, fetchOptions);
    clearTimeout(timer);
    if (!response.ok) return { supported: true };
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") return { supported: true };
    const info = api.extract(data) || {};
    const out = { supported: true };
    if (typeof info.nickname === "string" && info.nickname.trim())
      out.nickname = info.nickname.trim();
    if (typeof info.followers === "number") out.followers = info.followers;
    if (typeof info.platformAccountId === "string" && info.platformAccountId)
      out.platformAccountId = info.platformAccountId;
    return out;
  } catch (e) {
    clearTimeout(timer);
    return { supported: true };
  }
}

module.exports = {
  checkLoginViaHttpApi,
  isHttpCheckSupported,
  cookiesToHeader,
  tryHttpLoginCheck,
  fetchAccountInfoViaHttpApi,
};
