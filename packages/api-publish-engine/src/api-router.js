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

/**
 * 三态总闸的**缺省派生**——单一来源（CCG 第四轮 i4 upheld 后抽出）。
 *
 * 原先这条规则在 isApiTrack 与 getPublishMode 里各写一份（后者在文件更下方），
 * 改一处忘另一处就会重演本 PR 要消灭的漂移。现在两处都走本函数。
 *
 * @param {object} cfg 平台配置（platforms.yaml 的一个平台块）
 * @returns {string} 'api-only' | 'api-then-dom' | 'dom-only'
 */
function derivePublishMode (cfg) {
  if (cfg && cfg.publishMode != null && cfg.publishMode !== '') return cfg.publishMode
  // 缺省派生：has_api:true → api-then-dom，否则 dom-only（与 W1 §5.1 一致）
  return (cfg && cfg.has_api) ? 'api-then-dom' : 'dom-only'
}

/**
 * 该平台当前是否真的走 API 轨（两轴合取，单一来源）。
 *
 * ★ CCG 第五轮 i3（upheld）：必须经 `normalizeMode` 归一，**不得**自己比字符串。
 *   原先直接 `mode === 'api-only' || mode === 'api-then-dom'`，遇到非法 publishMode
 *   （拼写错误、大小写不符）会**静默返回 false**（当 dom-only 处理）；而 getPublishMode
 *   走 normalizeMode 是 **fail-closed 抛错**的 ⇒ 同一份坏配置，两个读者结论相反
 *   （一个炸、一个静默走 DOM 轨）——正是本 PR 声称要消灭的判据分叉。
 *   现在两处都过同一个归一函数，非法值一致抛错。
 *
 * ★ CCG 第六轮 i1（upheld）：但「抛错」不能**级联**。
 *   loadConfig 里 `_apiPlatforms = Object.entries(...).filter(isApiTrack)` 会在加载时
 *   对**所有**平台求值；任何一个平台 publishMode 拼错就一路抛到 loadConfig 的 catch
 *   ⇒ shouldUseApi / supportsApi / listApiPlatforms / getPublishMode **全部**返回 false，
 *   一个 typo 让整个 App 的 API 路由失效（fail-closed 过度级联：错误影响面从
 *   「单个平台」放大到「全部平台」）。
 *   故提供两个入口，语义分离：
 *     · `isApiTrack(cfg)`      —— 单点查询，**fail-closed 抛错**（调用方明确知道在问哪一个平台）；
 *     · `isApiTrackSafe(cfg)`  —— 批量推导用，**fail-safe 返回 false 并告警**
 *       （坏配置的平台退化为「不走 API 轨」，不影响其他平台）。
 */
function isApiTrack (cfg) {
  if (!cfg || !cfg.has_api) return false
  var pm = require('./publish/core/publish-mode');
  var mode = pm.normalizeMode(derivePublishMode(cfg));
  return mode === pm.MODES.apiOnly || mode === pm.MODES.apiThenDom;
}

/** isApiTrack 的 fail-safe 版本：非法配置返回 false 并告警，**不抛错**（供批量推导用）。 */
function isApiTrackSafe (cfg) {
  try {
    return isApiTrack(cfg);
  } catch (e) {
    logger.warn('api-router',
      'publishMode 非法，该平台暂按非 API 轨处理（不影响其他平台）: ' + e.message,
      { publishMode: cfg && cfg.publishMode });
    return false;
  }
}

function loadConfig() {
  if (_platforms) return _platforms;
  try {
    const raw = fs.readFileSync(resolvePlatformConfigPath(), "utf8");
    _platforms = yaml.load(raw).platforms;
    // ★ CCG 第六轮 i1（upheld）：批量推导必须用 fail-safe 版 —— 用会抛错的 isApiTrack
    //   会让**任何一个**平台的配置 typo 一路抛到本 catch，导致全部 API 路由静默失效。
    _apiPlatforms = Object.entries(_platforms)
      .filter(function(e) { return isApiTrackSafe(e[1]); })
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

/**
 * 单点查询的**带平台名** fail-safe 包装（CCG 第七轮 i5，Info 已加固）。
 *
 * 背景：isApiTrack 改为 fail-closed（非法 publishMode 抛错）后，
 * `shouldUseApi`/`supportsApi` 从「从不抛错」变成「可抛错」。而桌面
 * `_publish_generic` 与批量发布循环（batchPublishWithRouting 之外的调用方）
 * 未必有 try/catch ⇒ 一个平台的配置 typo 会**中止整批**——i1 的级联在其它接缝复发。
 *
 * 口径：告警 + 返回 false（该平台按非 API 轨处理，不影响其他平台），
 *       与 isApiTrackSafe 一致；但**保留平台名**在日志里，便于定位坏配置。
 */
function isApiTrackForPlatform (platform) {
  try {
    return isApiTrack(loadConfig()[platform]);
  } catch (e) {
    logger.warn('api-router',
      `publishMode 非法，${platform} 暂按非 API 轨处理（不影响其他平台）: ${e.message}`);
    return false;
  }
}

function shouldUseApi(platform) {
  // ★ 两轴合取（见文件头 i1 修复说明）：has_api 只说明「有实现」，
  //   还要 publishMode 真的走 API 轨才算 API 平台。
  // ★ CCG 第七轮 i5：走带平台名的 fail-safe 包装，避免单点 typo 中止整批发布。
  return isApiTrackForPlatform(platform);
}

function supportsApi(platform) {
  try {
    return require("./index").supportsApi(platform) && isApiTrackForPlatform(platform);
  }
  catch(e) { return false; }
}

function listApiPlatforms() {
  loadConfig();
  return _apiPlatforms || [];
}

/**
 * 发布模式（W1 §5.1）：三态总闸，逐平台。
 * 取值走 **derivePublishMode() 单一来源**（缺省派生不再本地复写，见其注释），
 * 再经 normalizeMode 归一。非法值 normalizeMode 抛错（fail-closed），
 * 避免误配置静默走错轨。
 *
 * ★ CCG 第八轮 i2（upheld）：本函数与 shouldUseApi 必须**同一口径**。
 *   shouldUseApi 走 isApiTrackForPlatform（fail-safe：坏配置告警 + 返回 false ⇒ 非 API 轨），
 *   若本函数对同一份坏配置仍**抛错**，两个读者结论相反（一个说「非 API 轨」、一个炸），
 *   正是本 PR 声称要消灭的判据分叉。故本函数提供同口径的 fail-safe 版本：
 *   坏配置 ⇒ 告警 + 返回 dom-only（与 shouldUseApi 的 false 一致）。
 *
 * @param {string} platform
 * @param {{safe?: boolean}} [opts] safe=true 时坏配置不抛错，告警后返回 dom-only
 * @returns {string} 'api-only' | 'api-then-dom' | 'dom-only'
 */
function getPublishMode(platform, opts) {
  var pm = require('./publish/core/publish-mode');
  var raw = derivePublishMode(loadConfig()[platform]);
  try {
    return pm.normalizeMode(raw);
  } catch (e) {
    if (opts && opts.safe) {
      logger.warn('api-router',
        `publishMode 非法，${platform} 暂按 dom-only 处理（与 shouldUseApi 的 fail-safe 口径一致）: ${e.message}`);
      return pm.MODES.domOnly;
    }
    throw e;
  }
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
  //   ★ CCG 第六轮 i1（upheld）：另导出 fail-safe 版 isApiTrackSafe —— 批量推导
  //   （loadConfig 的 _apiPlatforms）用它，避免单点配置 typo 级联成全局路由失效；
  //   单点查询（shouldUseApi / supportsApi）仍用 fail-closed 的 isApiTrack。
  isApiTrack, isApiTrackSafe,
};
