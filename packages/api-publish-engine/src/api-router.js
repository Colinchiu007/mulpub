const logger = require('./logger')
/**
 * API Router ? P0/P1/P2 API mode routing
 *
 * P0: has_api:true platforms use API mode (1-5s vs 60s+ RPA)
 * P1: New platform adapters prioritize API, RPA as fallback
 * P2: Auto-route from platforms.yaml, auto-fallback on failure
 *
 * ★ 两轴语义（2026-10-16 p3-residual-criteria，CCG 深度评审 i1 upheld 后修复）：
 *   `has_api` 与 `publishMode` 是**两个独立轴**：
 *     · `has_api`    = 该平台**有没有** API 发布实现；
 *     · `publishMode` = 当前**走哪条轨**（api-only / api-then-dom / dom-only）。
 *   本仓既有「未入波」状态：`has_api:true` + `publishMode:dom-only`
 *   （youtube / twitter —— 二者都有完整 API 适配器，但尚未接入 API 发布波次）。
 *   旧实现 `supportsApi() = !!cfg.has_api` 会把这种平台**过报**成 API 平台，
 *   与 `rpa-view-manager.js:68` 记载的事故（publishMode=dom-only 却因 has_api=true
 *   误入 API 轨）同款。故「是不是 API 平台」一律取**两轴合取**。
 */
const fs = require("fs");
const yaml = require("js-yaml");
const { resolvePlatformConfigPath } = require('./runtime-config-path')

let _platforms = null;
let _apiPlatforms = null;

/** 该平台当前是否真的走 API 轨（两轴合取，单一来源）。 */
function isApiTrack (cfg) {
  if (!cfg || !cfg.has_api) return false
  var mode = cfg.publishMode
  // publishMode 缺省时按 has_api 派生（与 getPublishMode 同口径）
  if (mode == null || mode === '') mode = 'api-then-dom'
  return mode === 'api-only' || mode === 'api-then-dom'
}

function loadConfig() {
  if (_platforms) return _platforms;
  try {
    const raw = fs.readFileSync(resolvePlatformConfigPath(), "utf8");
    _platforms = yaml.load(raw).platforms;
    _apiPlatforms = Object.entries(_platforms)
      .filter(function(e) { return isApiTrack(e[1]); })
      .map(function(e) { return e[0]; });
    return _platforms;
  } catch (e) {
    logger.error('api-router', 'Failed to load platforms.yaml: ' + e.message);
    _platforms = {};
    _apiPlatforms = [];
    return _platforms;
  }
}

function listAllAvailablePlatforms() {
  try { return Object.keys(require("./index").REGISTRY); } catch(e) { return []; }
}

function reloadConfig() {
  _platforms = null;
  _apiPlatforms = null;
  return loadConfig();
}

function shouldUseApi(platform) {
  var cfg = loadConfig()[platform];
  // ★ 两轴合取（见文件头 i1 修复说明）：has_api 只说明「有实现」，
  //   还要 publishMode 真的走 API 轨才算 API 平台。
  return isApiTrack(cfg);
}

function supportsApi(platform) {
  try {
    return require("./index").supportsApi(platform) && isApiTrack(loadConfig()[platform]);
  }
  catch(e) { return false; }
}

function listApiPlatforms() {
  loadConfig();
  return _apiPlatforms || [];
}

/**
 * 发布模式（W1 §5.1）：三态总闸，逐平台。
 * 优先读 platforms.yaml 的 publishMode 字段；缺省时按 has_api 派生
 * （has_api:true → api-then-dom，否则 dom-only），再经 normalizeMode 归一。
 * 非法值 normalizeMode 抛错（fail-closed），避免误配置静默走错轨。
 * @param {string} platform
 * @returns {string} 'api-only' | 'api-then-dom' | 'dom-only'
 */
function getPublishMode(platform) {
  var pm = require('./publish/core/publish-mode');
  var cfg = loadConfig()[platform];
  var raw;
  if (cfg && cfg.publishMode != null && cfg.publishMode !== '') {
    raw = cfg.publishMode;
  } else {
    raw = (cfg && cfg.has_api) ? pm.MODES.apiThenDom : pm.MODES.domOnly;
  }
  return pm.normalizeMode(raw);
}

async function publishWithFallback(platform, taskData, cookie, opts) {
  opts = opts || {};
  var useApi = shouldUseApi(platform);
  var result = { platform: platform, apiAttempt: null, rpaFallback: false, success: false };

  if (useApi && supportsApi(platform)) {
    try {
      var { publishViaApi } = require("./index");
      result.apiAttempt = await publishViaApi(platform, taskData, cookie, opts);
      result.success = result.apiAttempt.success;
      if (result.success) return result;
      logger.warn('api-router', 'API publish failed, will fallback', { platform: platform, error: result.apiAttempt.error });
    } catch (apiErr) {
      result.apiAttempt = { success: false, error: apiErr.message };
      logger.warn('api-router', 'API publish threw, will fallback', { platform: platform, error: apiErr.message });
    }
  }

  if (!result.success && opts.rpaFallback !== false) {
    result.rpaFallback = true;
    result.fallbackReason = result.apiAttempt
      ? "API failed, needs RPA fallback"
      : "No API mode available, needs RPA";
    logger.info('api-router', 'falling back to RPA', { platform: platform, reason: result.fallbackReason });

    if (typeof opts.rpaPublish === "function") {
      try {
        var rpaResult = await opts.rpaPublish(platform, taskData, cookie, opts);
        result.success = rpaResult.success;
        result.rpaResult = rpaResult;
      } catch (rpaErr) {
        result.error = rpaErr.message;
        logger.error('api-router', 'RPA fallback publish failed', { platform: platform, error: rpaErr.message });
      }
    } else {
      result.requiresRpa = true;
    }
  }

  return result;
}

async function batchPublishWithRouting(platforms, taskData, cookie, opts) {
  opts = opts || {};
  var results = [];
  var total = platforms.length;

  for (var i = 0; i < total; i++) {
    var plat = platforms[i];
    try {
      var r = await publishWithFallback(plat, taskData, cookie, opts);
      results.push(r);
    } catch (e) {
      results.push({ platform: plat, success: false, error: e.message });
      logger.error('api-router', 'batch publish platform failed', { platform: plat, error: e.message, index: i, total: total });
    }
    if (opts.onProgress) {
      opts.onProgress(Math.round((i + 1) / total * 100), plat);
    }
  }
  return results;
}

module.exports = {
  shouldUseApi, supportsApi, listApiPlatforms, getPublishMode,
  publishWithFallback, batchPublishWithRouting,
  loadConfig, reloadConfig,
  // ★ CCG 第三轮 i5（2026-10-16，upheld）后导出：两轴合取的**单一来源**。
  //   原先这条判据在 api-router.js 内部 + 三个测试文件里各推导一遍（共 4 份），
  //   新增 publishMode 取值或 sync 重写字段后要 4 处同步，必然漂移。
  //   现在测试与下游一律 require 本函数，不再自己写三元式。
  isApiTrack,
};
