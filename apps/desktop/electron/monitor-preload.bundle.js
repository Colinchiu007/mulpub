var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// electron/stealth/evasions.js
var require_evasions = __commonJS({
  "electron/stealth/evasions.js"(exports2, module2) {
    var MARKER_KEY = "__mpStealthInj";
    var SOURCE_VERSION = "2026-10-15.1";
    var PROVENANCE = {
      /** 上游包名（apps/desktop 的 dependencies 之一，作为 evasion 技术的参照实现） */
      package: "puppeteer-extra-plugin-stealth",
      /** 上游版本——**必须与已安装版本一致**，由 evasions.test.js 机械核对 */
      version: "2.11.2",
      license: "MIT",
      /** 本模块并非上游代码的逐字移植：上游 evasion 依赖 puppeteer 的 page 对象，无法在 Electron
       *  preload 中直接复用。此处仅参照其技术路线（chrome.app/csi/loadTimes、permissions），
       *  取值与判定条件全部按本仓真机实测重写。 */
      relationship: "technique-reference"
    };
    var EVASION_IDS = [
      "chrome.keys",
      "navigator.userAgentData.brands",
      "notification.permission",
      "permissions.query"
    ];
    function buildEvasionSource() {
      return "(" + String(buildMainWorldFn) + ")(" + JSON.stringify(MARKER_KEY) + ", " + JSON.stringify(EVASION_IDS) + ", " + JSON.stringify(SOURCE_VERSION) + ");";
    }
    function buildMainWorldFn(markerKey, evasionIds, version) {
      var MARKER_KEY2 = markerKey;
      var EVASION_IDS2 = evasionIds;
      var VERSION = version;
      var state = {
        start: Date.now(),
        done: 0,
        version: VERSION,
        applied: [],
        failed: []
      };
      try {
        window[MARKER_KEY2] = state;
      } catch (_e) {
        return;
      }
      function apply(id, fn) {
        try {
          fn();
          state.applied.push(id);
        } catch (e) {
          state.failed.push(id + ":" + (e && e.message ? e.message : String(e)));
        }
      }
      apply("chrome.keys", function() {
        var chromeObj = window.chrome;
        if (!chromeObj || typeof chromeObj !== "object") return;
        var timing = window.performance && window.performance.timing ? window.performance.timing : null;
        var navStart = timing && timing.navigationStart ? timing.navigationStart : Date.now();
        function toSeconds(ms) {
          return ms ? ms / 1e3 : 0;
        }
        if (!chromeObj.app) {
          chromeObj.app = {
            isInstalled: false,
            InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
            RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
            getDetails: function() {
              return null;
            },
            getIsInstalled: function() {
              return false;
            },
            runningState: function() {
              return "cannot_run";
            }
          };
        }
        if (!chromeObj.csi) {
          chromeObj.csi = function() {
            return {
              onloadT: timing ? timing.domContentLoadedEventEnd : 0,
              startE: navStart,
              pageT: Date.now() - navStart,
              tran: 15
            };
          };
        }
        if (!chromeObj.loadTimes) {
          chromeObj.loadTimes = function() {
            var t = timing || {};
            var firstPaint = 0;
            try {
              var paints = window.performance.getEntriesByType ? window.performance.getEntriesByType("paint") : [];
              for (var i = 0; i < paints.length; i++) {
                if (paints[i].name === "first-paint") firstPaint = navStart + paints[i].startTime;
              }
            } catch (_e) {
            }
            return {
              requestTime: toSeconds(t.navigationStart),
              startLoadTime: toSeconds(t.navigationStart),
              commitLoadTime: toSeconds(t.responseStart),
              finishDocumentLoadTime: toSeconds(t.domContentLoadedEventEnd),
              finishLoadTime: toSeconds(t.loadEventEnd),
              firstPaintTime: firstPaint ? firstPaint / 1e3 : 0,
              firstPaintAfterLoadTime: 0,
              navigationType: "Other",
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true,
              npnProtocol: "h2",
              connectionInfo: "h2",
              wasAlternateProtocolAvailable: false
            };
          };
        }
      });
      apply("navigator.userAgentData.brands", function() {
        var uad = navigator.userAgentData;
        if (!uad || !uad.brands || typeof uad.brands.length !== "number") return;
        var match = /Chrome\/(\d+)/.exec(navigator.userAgent || "");
        var major = match ? match[1] : "";
        if (!major) return;
        var i;
        for (i = 0; i < uad.brands.length; i++) {
          if (uad.brands[i] && uad.brands[i].brand === "Google Chrome") return;
        }
        var brands = [{ brand: "Google Chrome", version: major }];
        for (i = 0; i < uad.brands.length; i++) brands.push(uad.brands[i]);
        var impl = {
          brands,
          mobile: uad.mobile,
          platform: uad.platform,
          getHighEntropyValues: function(hints) {
            if (typeof uad.getHighEntropyValues !== "function") return Promise.reject(new Error("not supported"));
            return Promise.resolve(uad.getHighEntropyValues(hints)).then(function(values) {
              if (!values || typeof values !== "object") return values;
              var copy = {};
              for (var key in values) {
                if (Object.prototype.hasOwnProperty.call(values, key)) copy[key] = values[key];
              }
              copy.brands = brands;
              return copy;
            });
          }
        };
        var proxy = new Proxy(uad, {
          get: function(target, prop) {
            if (Object.prototype.hasOwnProperty.call(impl, prop)) return impl[prop];
            var value = target[prop];
            return typeof value === "function" ? value.bind(target) : value;
          },
          has: function(target, prop) {
            return Object.prototype.hasOwnProperty.call(impl, prop) || prop in target;
          }
        });
        Object.defineProperty(navigator, "userAgentData", { get: function() {
          return proxy;
        }, configurable: true });
      });
      var FRESH_SITE_PERMISSION_STATE = "prompt";
      var FRESH_SITE_NOTIFICATION_PERMISSION = "default";
      apply("notification.permission", function() {
        var descriptor = Object.getOwnPropertyDescriptor(Notification, "permission");
        if (!descriptor || typeof descriptor.get !== "function") return;
        var nativeGet = descriptor.get;
        Object.defineProperty(Notification, "permission", {
          get: function() {
            var actual = nativeGet.call(Notification);
            return actual === "granted" ? FRESH_SITE_NOTIFICATION_PERMISSION : actual;
          },
          configurable: true
        });
        if (typeof Notification.requestPermission === "function") {
          var nativeRequest = Notification.requestPermission.bind(Notification);
          Notification.requestPermission = function(callback) {
            var result = Promise.resolve(nativeRequest()).then(function(value) {
              return value === "granted" ? FRESH_SITE_NOTIFICATION_PERMISSION : value;
            });
            if (typeof callback === "function") result.then(function(value) {
              callback(value);
            });
            return result;
          };
        }
      });
      apply("permissions.query", function() {
        var permissionsProto = window.Permissions && window.Permissions.prototype;
        if (!permissionsProto || typeof permissionsProto.query !== "function") return;
        var nativeQuery = permissionsProto.query;
        var COVERED = ["notifications", "geolocation", "camera", "microphone", "clipboard-read"];
        permissionsProto.query = function(descriptor) {
          var result = nativeQuery.apply(this, arguments);
          var name = descriptor && descriptor.name;
          if (COVERED.indexOf(name) === -1) return result;
          return Promise.resolve(result).then(function(status) {
            if (!status || status.state !== "granted") return status;
            var replacement = { state: FRESH_SITE_PERMISSION_STATE, onchange: null };
            try {
              if (window.PermissionStatus) Object.setPrototypeOf(replacement, window.PermissionStatus.prototype);
            } catch (_e) {
            }
            return replacement;
          });
        };
      });
      state.done = 1;
    }
    var CONTRACT = {
      MARKER_KEY,
      /** 三态观测取值 */
      STATE_NO_MARKER: "preload-not-run",
      STATE_NO_DONE: "partial-first-line-failed",
      STATE_DONE: "ok",
      /**
       * 三项 chrome 遗留属性（真实 Chrome 的 `Object.keys(window.chrome)` 恰为此三项，顺序即实测顺序）
       */
      CHROME_LEGACY_KEYS: ["loadTimes", "csi", "app"],
      FRESH_SITE_PERMISSION_STATE: "prompt",
      FRESH_SITE_NOTIFICATION_PERMISSION: "default"
    };
    module2.exports = {
      MARKER_KEY,
      SOURCE_VERSION,
      PROVENANCE,
      EVASION_IDS,
      CONTRACT,
      buildEvasionSource,
      // 导出本体供测试直接以假 window 执行（比只断言字符串更能发现逻辑错误）
      buildMainWorldFn
    };
  }
});

// electron/stealth/inject.js
var require_inject = __commonJS({
  "electron/stealth/inject.js"(exports2, module2) {
    var { MARKER_KEY, EVASION_IDS, CONTRACT, buildEvasionSource } = require_evasions();
    var DISABLE_VALUES = /* @__PURE__ */ new Set(["0", "false", "off", "no"]);
    function resolveStealthEnabled(env) {
      const source = env || (typeof process !== "undefined" ? process.env : {});
      const raw = source.MP_BROWSER_STEALTH;
      if (raw === void 0 || raw === null || String(raw).trim() === "") {
        return { enabled: true, reason: "default", rawValue: null };
      }
      const normalized = String(raw).trim().toLowerCase();
      if (DISABLE_VALUES.has(normalized)) {
        return { enabled: false, reason: "explicit-disable", rawValue: String(raw) };
      }
      return { enabled: true, reason: "explicit-enable", rawValue: String(raw) };
    }
    function injectMainWorldEvasions({ webFrame, source, warn, evaluate } = {}) {
      const warnFn = typeof warn === "function" ? warn : () => {
      };
      if (!webFrame || typeof webFrame.executeJavaScriptInIsolatedWorld !== "function") {
        warnFn("[stealth] webFrame.executeJavaScriptInIsolatedWorld 不可用，主世界反检测未注入（页面功能不受影响）");
        return {
          dispatched: false,
          reason: "webFrame-unavailable",
          readBack: () => Promise.resolve({ state: CONTRACT.STATE_NO_MARKER, reason: "webFrame-unavailable" })
        };
      }
      const code = typeof source === "string" && source ? source : buildEvasionSource();
      const runInMainWorld = typeof evaluate === "function" ? evaluate : (scriptCode) => webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: scriptCode }], true);
      let handle;
      try {
        handle = runInMainWorld(code);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        warnFn("[stealth] 主世界注入同步抛错，页面功能不受影响：" + message);
        return {
          dispatched: false,
          reason: "dispatch-threw:" + message,
          readBack: () => Promise.resolve({ state: CONTRACT.STATE_NO_MARKER, reason: "dispatch-threw" })
        };
      }
      const readBack = () => Promise.resolve(handle).then(() => runInMainWorld(
        "JSON.stringify((function(){var m=window[" + JSON.stringify(MARKER_KEY) + "];if(!m)return{state:" + JSON.stringify(CONTRACT.STATE_NO_MARKER) + "};return{state:m.done?" + JSON.stringify(CONTRACT.STATE_DONE) + ":" + JSON.stringify(CONTRACT.STATE_NO_DONE) + ",version:m.version,applied:m.applied,failed:m.failed}})())"
      )).then((raw) => {
        let parsed;
        try {
          parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch (_error) {
          parsed = null;
        }
        if (!parsed || typeof parsed !== "object") {
          warnFn("[stealth] 主世界标记读回结果不可解析，反检测状态未知");
          return { state: "unreadable", applied: [], failed: [] };
        }
        if (parsed.state !== CONTRACT.STATE_DONE) {
          warnFn("[stealth] 主世界反检测未完整生效：state=" + parsed.state + " applied=" + JSON.stringify(parsed.applied || []) + " failed=" + JSON.stringify(parsed.failed || []));
        } else if (Array.isArray(parsed.failed) && parsed.failed.length > 0) {
          warnFn("[stealth] 主世界反检测部分项失败：" + JSON.stringify(parsed.failed));
        }
        return parsed;
      }).catch((error) => {
        warnFn("[stealth] 主世界标记读回失败（注入结果未知）：" + (error && error.message || String(error)));
        return { state: "readback-failed", applied: [], failed: [], error: error && error.message || String(error) };
      });
      return { dispatched: true, reason: "ok", readBack };
    }
    function installMainWorldEvasions({ webFrame, env, warn } = {}) {
      const gate = resolveStealthEnabled(env);
      const warnFn = typeof warn === "function" ? warn : () => {
      };
      if (!gate.enabled) {
        warnFn("[stealth] 主世界反检测已被 MP_BROWSER_STEALTH=" + gate.rawValue + " 关闭（平台风控误判概率上升）");
        return { enabled: false, dispatched: false, reason: gate.reason };
      }
      const injection = injectMainWorldEvasions({ webFrame, warn: warnFn });
      if (injection.dispatched) injection.readBack();
      return { enabled: true, dispatched: injection.dispatched, reason: injection.reason };
    }
    module2.exports = {
      DISABLE_VALUES,
      EVASION_IDS,
      resolveStealthEnabled,
      injectMainWorldEvasions,
      installMainWorldEvasions
    };
  }
});

// electron/stealth/index.js
var require_stealth = __commonJS({
  "electron/stealth/index.js"(exports2, module2) {
    module2.exports = {
      ...require_evasions(),
      ...require_inject()
    };
  }
});

// electron/monitor-preload.js
var { contextBridge, ipcRenderer } = require("electron");
try {
  const stealth = require_stealth();
  stealth.installMainWorldEvasions({
    webFrame: require("electron").webFrame,
    warn: (message) => {
      try {
        console.warn(message);
      } catch (_e) {
      }
    }
  });
} catch (error) {
  try {
    console.warn("[stealth] 主世界反检测装载失败（页面功能不受影响）：" + (error && error.message || String(error)));
  } catch (_e) {
  }
}
contextBridge.exposeInMainWorld("multiPublishMonitor", {
  /** 获取当前页面 URL */
  getCurrentUrl: () => window.location.href,
  /** 通知主进程当前页面就绪 */
  reportReady: () => {
    ipcRenderer.send("monitor:page-ready", { url: window.location.href });
  }
});
