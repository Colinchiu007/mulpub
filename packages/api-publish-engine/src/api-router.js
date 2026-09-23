const logger = require('./logger')
/**
 * API Router ? P0/P1/P2 API mode routing
 *
 * P0: has_api:true platforms use API mode (1-5s vs 60s+ RPA)
 * P1: New platform adapters prioritize API, RPA as fallback
 * P2: Auto-route from platforms.yaml, auto-fallback on failure
 */
const fs = require("fs");
const yaml = require("js-yaml");
const { resolvePlatformConfigPath } = require('./runtime-config-path')

let _platforms = null;
let _apiPlatforms = null;

function loadConfig() {
  if (_platforms) return _platforms;
  try {
    const raw = fs.readFileSync(resolvePlatformConfigPath(), "utf8");
    _platforms = yaml.load(raw).platforms;
    _apiPlatforms = Object.entries(_platforms)
      .filter(function(e) { return e[1].has_api; })
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
  return cfg ? !!cfg.has_api : false;
}

function supportsApi(platform) {
  try { return require("./index").supportsApi(platform); }
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
};
