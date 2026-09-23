const REGISTRY = {
  // Complex adapters (custom publish logic)
  zhihu: require("./adapters/zhihu"),
  douyin: require("./adapters/douyin"),
  kuaishou: require("./adapters/kuaishou"),
  baijiahao: require("./adapters/baijiahao"),
  wechat_mp: require("./adapters/wechat_mp"),
  tencent_video: require("./adapters/shipinhao"),
  weibo: require("./adapters/weibo"),
  // New platform adapters (参考产品逆向分析复用)
  xiaohongshu: require("./adapters/xiaohongshu"),
  toutiao: require("./adapters/toutiao"),
  bilibili: require("./adapters/bilibili"),
  // API-mode adapters (no publish method)
  youtube: require("./adapters/youtube"),
  tiktok: require("./adapters/tiktok"),
  twitter: require("./adapters/twitter"),
};


const { ScheduledPublish } = require("./scheduled-publish");
const { WebhookManager } = require("./webhook-manager");
const { AuditLog } = require("./audit-log");
const { PublishingPlan } = require("./publish-plan");
const { RateLimiter } = require("./rate-limiter");
const { AccessLogger } = require("./access-log");
const {
  DEFAULT_MAX_BODY_BYTES,
  LOGTO_WEBHOOK_EVENTS,
  LOGTO_WEBHOOK_SIGNATURE_HEADER,
  LogtoWebhookConsumer,
  LogtoWebhookError,
  deriveLogtoWebhookEventId,
} = require("./auth/logto-webhook");
const { createLogtoRuntime, LogtoRuntimeError } = require("./auth/logto-runtime");
const { PostgresEntitlementProvider, PostgresIdentityRepository } = require("./auth/postgres-identity-repository");
const { createProductionReadinessProbe } = require("./auth/production-readiness");
const platformConfigs = require("./adapters/platform-configs");
const PluginLoader = require("./plugin-loader")
const logger = require("./logger")
const apiRouter = require("./api-router")
const { createPublishService } = require("./publish/publish-service");

// ─── Plugin System Integration ───
const pluginLoader = new PluginLoader();
pluginLoader.loadAll();

/** 热重载所有插件 */
function reloadPlugins() {
  pluginLoader.loadAll();
}

function hasOwnPlatform(registry, platform) {
  return typeof platform === "string" && Object.prototype.hasOwnProperty.call(registry, platform);
}

/** 判断内置、配置化或插件平台是否具备 API 适配器。 */
function supportsApi(p) {
  return hasOwnPlatform(REGISTRY, p) || hasOwnPlatform(platformConfigs, p) || !!pluginLoader.get(p);
}

/** Get adapter (built-in or plugin) */
function getAdapter(p) {
  var C = hasOwnPlatform(REGISTRY, p) ? REGISTRY[p] : null;
  if (C) return new C();
  // 配置化适配器只接受配置表中的自有键，避免原型属性被当成平台名。
  if (hasOwnPlatform(platformConfigs, p)) {
    try {
      var { createAdapter } = require("./adapters/generic-adapter");
      var adapter = createAdapter(p);
      if (adapter) return adapter;
    } catch(e) { /* 配置化适配器不可用时继续尝试插件 */ }
  }
  var plugin = pluginLoader.get(p);
  return plugin || null;
}

async function publishViaApi(platform, taskData, cookie, opts) {
  var adapter = getAdapter(platform);
  if (!adapter) throw new Error("No API adapter for platform: " + platform);

  // 内置适配器的 execute 负责上传、构造发布数据及调用 publish。必须优先走该路径，
  // 否则会把 taskData 当成 Cookie 传给 publish，并跳过上传流程。
  var result;
  if (typeof adapter.execute === "function") {
    result = await adapter.execute(taskData, cookie, opts);
  } else if (typeof adapter.publishViaApi === "function") {
    result = await adapter.publishViaApi(taskData, cookie, opts);
  } else if (typeof adapter.publish === "function") {
    result = await adapter.publish(taskData, cookie, opts);
  } else {
    throw new Error("API adapter has no publish entrypoint for platform: " + platform);
  }

  if (!result || !result.success) throw new Error((result && result.error) || "API publish failed for " + platform);
  return result;
}

async function batchPublish(platforms, taskData, cookie, opts) {
  // Filter out disabled plugins
  platforms = platforms.filter(function(p) {
    var enabled = pluginLoader.isEnabled(p);
    // pluginLoader returns null for non-plugin platforms (built-in adapters)
    return enabled === null || enabled === true;
  });
  opts = opts || {};
  var results = [];
  var total = platforms.length;
  for (var i = 0; i < total; i++) {
    var plat = platforms[i];
    var entry = { platform: plat };
    try {
      if (!supportsApi(plat)) {
        entry.success = false;
        entry.error = "No API adapter for platform: " + plat;
      } else if (opts.dryRun) {
        entry.success = true;
        entry.dryRun = true;
      } else {
        entry.result = await publishViaApi(plat, taskData, cookie, opts);
        entry.success = true;
      }
    } catch (e) {
      entry.success = false;
      entry.error = e.message;
    }
    results.push(entry);
    if (opts.onProgress) opts.onProgress(Math.round((i + 1) / total * 100), plat);
  }
  return results;
}

// ─── W1 §5 双轨发布服务入口（API 优先 + 18min 频控 + 风控挂起；服务层事实路由）───
// getMode=apiRouter.getPublishMode(§5.1) 供三态；spacer/riskSuspender 为进程内单例；
// apiPublish=publishViaApi；domPublish 由每次调用 opts.rpaPublish 注入（缺省走 requiresDom）。
var _publishService = createPublishService({
  apiPublish: publishViaApi,
  getMode: function (p) { return apiRouter.getPublishMode(p); },
  logger: logger,
  onRiskEvent: function (e) { try { logger.warn("publish-service", "risk_" + e.type, e); } catch (_e) { /* 通知失败不炸主流程 */ } },
});

module.exports = {
  getAdapter, supportsApi, publishViaApi, batchPublish, reloadPlugins,
  // P3-7：合集列表拉取（adapter 可选实现）
  async listCollections(platform, cookie) {
    const adapter = getAdapter(platform);
    if (!adapter || typeof adapter.listCollections !== "function") return [];
    return adapter.listCollections(cookie);
  },
  REGISTRY, pluginLoader,
  ScheduledPublish, WebhookManager, AuditLog, PublishingPlan, RateLimiter, AccessLogger,
  DEFAULT_MAX_BODY_BYTES, LOGTO_WEBHOOK_EVENTS, LOGTO_WEBHOOK_SIGNATURE_HEADER,
  LogtoWebhookConsumer, LogtoWebhookError, deriveLogtoWebhookEventId,
  createLogtoRuntime, LogtoRuntimeError, PostgresEntitlementProvider, PostgresIdentityRepository,
  createProductionReadinessProbe,
  apiRouter: apiRouter,
  batchPublishWithRouting: apiRouter.batchPublishWithRouting,
  publishWithFallback: apiRouter.publishWithFallback,
  // W1 §5 服务层事实入口（推荐）；publishWithFallback 为旧非模式驱动路径，保留兼容
  publishWithMode: _publishService.publishWithMode,
  publishService: _publishService,
  getPublishMode: apiRouter.getPublishMode,
};
