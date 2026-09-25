var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// electron/core/access-level.js
var require_access_level = __commonJS({
  "electron/core/access-level.js"(exports2, module2) {
    "use strict";
    var ACCESS_LEVELS = Object.freeze(["public", "authenticated", "admin"]);
    var ACCESS_LEVEL_CHANNEL = "auth:get-access-level";
    var ACCESS_LEVEL_INVALIDATE_EVENT = "auth:access-level-invalidated";
    var ACCESS_LEVEL_TTL_MS = 2e3;
    function isAccessLevel(value) {
      return ACCESS_LEVELS.includes(value);
    }
    module2.exports = {
      ACCESS_LEVELS,
      ACCESS_LEVEL_CHANNEL,
      ACCESS_LEVEL_INVALIDATE_EVENT,
      ACCESS_LEVEL_TTL_MS,
      isAccessLevel
    };
  }
});

// electron/preload/access-level-cache.js
var require_access_level_cache = __commonJS({
  "electron/preload/access-level-cache.js"(exports2, module2) {
    "use strict";
    var {
      ACCESS_LEVEL_TTL_MS,
      isAccessLevel
    } = require_access_level();
    function createAccessLevelCache({ read, ttlMs = ACCESS_LEVEL_TTL_MS, now = Date.now } = {}) {
      let cached = null;
      let expiresAt = 0;
      function invalidate() {
        cached = null;
        expiresAt = 0;
      }
      function get() {
        if (cached !== null && now() < expiresAt) return cached;
        let level = "public";
        try {
          const fresh = typeof read === "function" ? read() : null;
          if (isAccessLevel(fresh)) level = fresh;
        } catch (_) {
          void _;
        }
        cached = level;
        expiresAt = now() + ttlMs;
        return level;
      }
      function isFresh() {
        return cached !== null && now() < expiresAt;
      }
      return { get, invalidate, isFresh };
    }
    module2.exports = { createAccessLevelCache };
  }
});

// electron/preload/publish.js
var require_publish = __commonJS({
  "electron/preload/publish.js"(exports2, module2) {
    function createPublishApi(ipcRenderer2, options = {}) {
      const resolveFilePath = typeof options.getPathForFile === "function" ? options.getPathForFile : () => "";
      return {
        // Electron 32+ 移除了 File.path；路径解析必须在可信 preload 中完成。
        getPathForFile: (file) => {
          try {
            return String(resolveFilePath(file) || "");
          } catch {
            return "";
          }
        },
        // 发布 API
        publishWechat: (articleData) => ipcRenderer2.invoke("publish:wechat", articleData),
        publishBatch: (platforms, article) => ipcRenderer2.invoke("publish:batch", { platforms, article }),
        extractVideoCover: (videoPath) => ipcRenderer2.invoke("cover:extract", videoPath),
        generateAiCover: (payload) => ipcRenderer2.invoke("cover:generate-ai", payload),
        listPlatformCollections: (payload) => ipcRenderer2.invoke("collection:list", payload),
        cropVideoCover: (payload) => ipcRenderer2.invoke("cover:crop", payload),
        readCoverData: (imagePath) => ipcRenderer2.invoke("cover:read-data", imagePath),
        listAccounts: () => ipcRenderer2.invoke("accounts:list"),
        // 渲染 API
        renderStart: (data) => ipcRenderer2.invoke("render:start", data),
        renderStartAiVideo: (data) => ipcRenderer2.invoke("render:start-ai-video", data),
        renderCancel: () => ipcRenderer2.invoke("render:cancel"),
        renderGetStatus: () => ipcRenderer2.invoke("render:status"),
        renderInstallDeps: () => ipcRenderer2.invoke("render:install-deps"),
        onRenderProgress: (callback) => {
          const h = (_e, p) => callback(p);
          ipcRenderer2.on("render:progress", h);
          return () => ipcRenderer2.removeListener("render:progress", h);
        },
        // 流水线阶段进度实时推送（openspec pipeline-progress-real-time-push）：轻量快照（progressOnly），取消函数移除监听
        onPipelineUpdate: (callback) => {
          const h = (_e, payload) => callback(payload);
          ipcRenderer2.on("pipeline:update", h);
          return () => ipcRenderer2.removeListener("pipeline:update", h);
        },
        onRenderComplete: (callback) => {
          const h = (_e, p) => callback(p);
          ipcRenderer2.on("render:complete", h);
          return () => ipcRenderer2.removeListener("render:complete", h);
        },
        onRenderError: (callback) => {
          const h = (_e, p) => callback(p);
          ipcRenderer2.on("render:error", h);
          return () => ipcRenderer2.removeListener("render:error", h);
        },
        onRenderInstallProgress: (callback) => {
          const h = (_e, p) => callback(p);
          ipcRenderer2.on("render:install-progress", h);
          return () => ipcRenderer2.removeListener("render:install-progress", h);
        },
        renderListCompositions: () => ipcRenderer2.invoke("render:list-compositions"),
        renderGetComposition: (id) => ipcRenderer2.invoke("render:get-composition", id),
        renderValidateProps: (compositionId, props) => ipcRenderer2.invoke("render:validate-props", compositionId, props),
        // 流水线 API（嵌套对象）
        pipelines: {
          list: () => ipcRenderer2.invoke("pipeline:list"),
          get: (name) => ipcRenderer2.invoke("pipeline:get", name)
        },
        // 内容情报 API（已注册于 services/content-intelligence.js）
        intelligenceSuggestTags: (content, opts) => ipcRenderer2.invoke("intelligence:suggest-tags", { content, opts }),
        intelligenceGetOptimalTime: (keyword) => ipcRenderer2.invoke("intelligence:get-optimal-time", { keyword }),
        intelligenceSearch: (query, opts) => ipcRenderer2.invoke("intelligence:search", { query, opts }),
        // handler 解构 { title, opts }，前端用 query 作为标题
        intelligenceSearchTitles: (query, opts) => ipcRenderer2.invoke("intelligence:search-titles", { title: query, opts }),
        intelligenceFetchTrending: (opts) => ipcRenderer2.invoke("intelligence:fetch-trending", opts),
        // handler 解构 { text, opts }，前端用 url 作为搜索文本
        intelligenceFindReferences: (url, opts) => ipcRenderer2.invoke("intelligence:find-references", { text: url, opts }),
        // handler 解构 { title, opts }，前端传 { keyword, sampleSize }
        intelligenceGetBenchmark: (opts) => {
          const o = opts || {};
          return ipcRenderer2.invoke("intelligence:get-benchmark", { title: o.keyword || o.title, opts: o });
        },
        // 队列 API
        getQueueStatus: () => ipcRenderer2.invoke("queue:status"),
        getQueueHistory: () => ipcRenderer2.invoke("queue:history"),
        cancelTask: (taskId) => ipcRenderer2.invoke("queue:cancel", taskId),
        retryTask: (taskId) => ipcRenderer2.invoke("queue:retry", taskId),
        // 发布历史 API
        historyList: (opts) => ipcRenderer2.invoke("history:list", opts),
        historyGet: (id) => ipcRenderer2.invoke("history:get", id),
        historyDelete: (ids) => ipcRenderer2.invoke("history:delete", { ids: Array.isArray(ids) ? ids : [ids] }),
        // 发布统计 API
        dashboardStats: () => ipcRenderer2.invoke("dashboard:stats"),
        // 定时发布 API
        schedulerCreate: (schedule) => ipcRenderer2.invoke("scheduler:create", schedule),
        schedulerList: () => ipcRenderer2.invoke("scheduler:list"),
        schedulerCancel: (id) => ipcRenderer2.invoke("scheduler:cancel", id),
        // 进度监听
        onProgress: (callback) => {
          const handler = (_, data) => callback(data);
          ipcRenderer2.on("publish:progress", handler);
          return () => ipcRenderer2.removeListener("publish:progress", handler);
        },
        // W1 §6.1：风控挂起信号（主进程 task:failed 命中风控 → publish:risk-hold）
        onRiskHold: (callback) => {
          const handler = (_, data) => callback(data);
          ipcRenderer2.on("publish:risk-hold", handler);
          return () => ipcRenderer2.removeListener("publish:risk-hold", handler);
        },
        // W1 §5 enforcement：风控挂起清单查询/显式恢复 + 挂起状态变更广播
        onRiskSuspended: (callback) => {
          const handler = (_, data) => callback(data);
          ipcRenderer2.on("publish:risk-suspended", handler);
          return () => ipcRenderer2.removeListener("publish:risk-suspended", handler);
        },
        listSuspendedRisk: () => ipcRenderer2.invoke("publishRisk:listSuspended"),
        resumeRisk: (payload) => ipcRenderer2.invoke("publishRisk:resume", payload),
        isSuspendedRisk: (payload) => ipcRenderer2.invoke("publishRisk:isSuspended", payload),
        // Pipeline 流水线 API（Phase 3）
        pipelineList: () => ipcRenderer2.invoke("pipeline:list"),
        pipelineGet: (name) => ipcRenderer2.invoke("pipeline:get", name),
        pipelineStart: (name, params) => ipcRenderer2.invoke("pipeline:start", name, params),
        pipelinePause: () => ipcRenderer2.invoke("pipeline:pause"),
        pipelineResume: () => ipcRenderer2.invoke("pipeline:resume"),
        pipelineCancel: () => ipcRenderer2.invoke("pipeline:cancel"),
        pipelineStatus: (name) => ipcRenderer2.invoke("pipeline:status", name),
        pipelineAdvance: () => ipcRenderer2.invoke("pipeline:advance"),
        pipelineHistory: () => ipcRenderer2.invoke("pipeline:history"),
        pipelineDeleteRun: (runId) => ipcRenderer2.invoke("pipeline:delete-run", runId),
        pipelinePauseRun: (runId) => ipcRenderer2.invoke("pipeline:pause-run", runId),
        pipelineCancelRun: (runId) => ipcRenderer2.invoke("pipeline:cancel-run", runId),
        pipelineFetch: (name) => ipcRenderer2.invoke("pipeline:fetch", name),
        // 编排模式 API（story2video-compose）
        pipelineStartOrchestrated: (name, params) => ipcRenderer2.invoke("pipeline:startOrchestrated", name, params),
        pipelineResumeOrchestration: (runId) => ipcRenderer2.invoke("pipeline:resumeOrchestration", runId),
        pipelineExecuteStage: (runId) => ipcRenderer2.invoke("pipeline:executeStage", runId),
        pipelineAdvanceToNextCheckpoint: (runId) => ipcRenderer2.invoke("pipeline:advanceToNextCheckpoint", runId),
        pipelineConfirmSceneAssets: (runId, selections) => ipcRenderer2.invoke("pipeline:confirmSceneAssets", runId, selections),
        pipelineConfirmStageGate: (runId, contextPatch) => ipcRenderer2.invoke("pipeline:confirm-stage-gate", runId, contextPatch),
        pipelineGetRunContext: (runId) => ipcRenderer2.invoke("pipeline:getRunContext", runId),
        // Story2Video 本地交付
        story2videoImportMedia: (file, kind) => {
          let filePath;
          try {
            filePath = String(resolveFilePath(file) || "");
          } catch {
            return Promise.resolve({ code: -1, message: "无法读取媒体文件路径" });
          }
          if (!filePath) return Promise.resolve({ code: -1, message: "无法读取媒体文件路径" });
          return ipcRenderer2.invoke("story2video:import-media", { filePath, kind });
        },
        // File 对象跨 contextBridge 后可能丢失路径；renderer 先经 getPathForFile
        // 解析真实路径，再走基于路径的导入，避免 webUtils.getPathForFile 拿不到文件。
        story2videoImportMediaPath: (filePath, kind) => {
          const normalized = String(filePath || "").trim();
          if (!normalized) return Promise.resolve({ code: -1, message: "无法读取媒体文件路径" });
          return ipcRenderer2.invoke("story2video:import-media", { filePath: normalized, kind });
        },
        // BGM 素材库（与主进程 PUBLIC_CHANNELS 的 story2video:bgm-library-* 对齐）：
        // 添加沿用 import-media 的 File 路径解析，其余操作直通。
        story2videoBgmLibraryList: () => ipcRenderer2.invoke("story2video:bgm-library-list"),
        story2videoBgmLibraryAdd: (file) => {
          let filePath;
          try {
            filePath = String(resolveFilePath(file) || "");
          } catch {
            return Promise.resolve({ code: -1, message: "无法读取背景音乐文件路径" });
          }
          if (!filePath) return Promise.resolve({ code: -1, message: "无法读取背景音乐文件路径" });
          return ipcRenderer2.invoke("story2video:bgm-library-add", { filePath });
        },
        story2videoBgmLibraryRename: (id, name) => ipcRenderer2.invoke("story2video:bgm-library-rename", { id, name }),
        story2videoBgmLibraryDelete: (id) => ipcRenderer2.invoke("story2video:bgm-library-delete", { id }),
        // 流水线「保存配置」（与主进程 PUBLIC_CHANNELS 的 story2video:config-profile-* 对齐）：
        // 设备级命名组合配置管理（列表/保存/改名/删除），未登录可用。
        story2videoConfigProfileList: () => ipcRenderer2.invoke("story2video:config-profile-list"),
        story2videoConfigProfileCreate: (request) => ipcRenderer2.invoke("story2video:config-profile-create", request),
        story2videoConfigProfileRename: (id, name) => ipcRenderer2.invoke("story2video:config-profile-rename", { id, name }),
        story2videoConfigProfileDelete: (id) => ipcRenderer2.invoke("story2video:config-profile-delete", { id }),
        story2videoExportZip: (files, destinationPath) => ipcRenderer2.invoke("story2video:export-zip", { files, destinationPath }),
        story2videoCreateShareUrl: (filePath, previousUrl) => ipcRenderer2.invoke("story2video:create-share-url", filePath, previousUrl),
        story2videoCopyPath: (filePath) => ipcRenderer2.invoke("story2video:copy-path", filePath),
        story2videoShowInFolder: (filePath) => ipcRenderer2.invoke("story2video:show-in-folder", filePath),
        story2videoSaveAs: (filePath, suggestedName) => ipcRenderer2.invoke("story2video:save-as", { filePath, suggestedName }),
        story2videoEnsureProject: (payload) => ipcRenderer2.invoke("story2video:ensure-project", payload),
        story2videoListProjects: () => ipcRenderer2.invoke("story2video:list-projects"),
        story2videoGetProject: (projectId) => ipcRenderer2.invoke("story2video:get-project", projectId),
        story2videoGetThumbnail: (projectId) => ipcRenderer2.invoke("story2video:get-thumbnail", projectId),
        story2videoDeleteProject: (projectId) => ipcRenderer2.invoke("story2video:delete-project", projectId),
        story2videoUpdateSegments: (projectId, segments) => ipcRenderer2.invoke("story2video:update-segments", { projectId, segments }),
        story2videoReplaceSegmentAudio: (projectId, segmentId, filePath) => ipcRenderer2.invoke("story2video:replace-segment-audio", { projectId, segmentId, filePath }),
        story2videoRetrySegment: (projectId, segmentId, mode) => ipcRenderer2.invoke("story2video:retry-segment", { projectId, segmentId, mode }),
        story2videoRecomposeProject: (projectId) => ipcRenderer2.invoke("story2video:recompose-project", projectId),
        story2videoSelectSceneMaterial: (projectId, segmentId, kind) => ipcRenderer2.invoke("story2video:select-scene-material", { projectId, segmentId, kind }),
        story2videoGenerateSceneImage: (projectId, segmentId) => ipcRenderer2.invoke("story2video:generate-scene-image", { projectId, segmentId }),
        story2videoGenerateSceneVideo: (projectId, segmentId) => ipcRenderer2.invoke("story2video:generate-scene-video", { projectId, segmentId }),
        story2videoGenerateSceneAiVideo: (projectId, segmentId) => ipcRenderer2.invoke("story2video:generate-scene-ai-video", { projectId, segmentId }),
        story2videoRegenerateSceneSubtitle: (projectId, segmentId) => ipcRenderer2.invoke("story2video:regenerate-scene-subtitle", { projectId, segmentId }),
        story2videoRegenerateSceneAudio: (projectId, segmentId) => ipcRenderer2.invoke("story2video:regenerate-scene-audio", { projectId, segmentId }),
        story2videoRegenerateScenePrompt: (projectId, segmentId, kind) => ipcRenderer2.invoke("story2video:regenerate-scene-prompt", { projectId, segmentId, kind }),
        story2videoTranscribe: (filePath) => ipcRenderer2.invoke("story2video:transcribe", { filePath }),
        story2videoCapabilities: () => ipcRenderer2.invoke("story2video:capabilities"),
        // Story2Video 批量创作（openspec story2video-batch-create）
        story2videoBatchCreate: (payload) => ipcRenderer2.invoke("story2video:batch:create", payload),
        story2videoBatchStatus: () => ipcRenderer2.invoke("story2video:batch:status"),
        story2videoBatchCancel: (batchId, itemIds) => ipcRenderer2.invoke("story2video:batch:cancel", { batchId, itemIds }),
        // 本地文件选择（.txt/.md 多选）：返回 [{ path, name }]，路径由主进程对话框直接提供
        story2videoPickBatchFiles: () => ipcRenderer2.invoke("story2video:pick-batch-files"),
        // Cloud Publisher API
        cloudPublishSubmit: (params) => ipcRenderer2.invoke("cloud-publisher:submit", params),
        cloudPublishListTasks: () => ipcRenderer2.invoke("cloud-publisher:list-tasks"),
        cloudPublishGetTask: (taskId) => ipcRenderer2.invoke("cloud-publisher:get-task", taskId),
        cloudPublishPlatforms: () => ipcRenderer2.invoke("cloud-publisher:platforms"),
        // URL Collect API
        // manual: true — 采集页用户手动点击（豁免周末随机限流；批量走 aggregation 不经此通道）
        urlCollectFetch: (url) => ipcRenderer2.invoke("url-collect:fetch", { url, manual: true }),
        // 反爬站点路由查询：知乎/百家号等站点直接 HTTP 裸连会触发风控，
        // 渲染层据此跳过 Python 聚合层裸连、直连 stealth 浏览器通道
        urlCollectNeedsStealth: (url) => ipcRenderer2.invoke("url-collect:needs-stealth", { url }),
        // Viral Analysis API
        viralAnalyze: (articles, topic) => ipcRenderer2.invoke("viral:analyze", { articles, topic }),
        viralGenerate: (opts) => ipcRenderer2.invoke("viral:generate", opts),
        viralTrending: (articles) => ipcRenderer2.invoke("viral:trending", { articles }),
        // PR-2 F8：爆款已达成数据角标（复用既有 impact 通道，零新增 IPC）
        getRecentImpactSnapshots: () => ipcRenderer2.invoke("impact:get-recent-snapshots"),
        // Draft API
        draftSave: (draft) => ipcRenderer2.invoke("draftSave", draft),
        draftList: () => ipcRenderer2.invoke("draftList"),
        draftDelete: (draftId) => ipcRenderer2.invoke("draftDelete", draftId),
        // Comment Management API (PRD F13)
        commentList: (platform, accountId, maxDays) => ipcRenderer2.invoke("comment:list", { platform, accountId, maxDays }),
        commentReply: (platform, accountId, commentId, content) => ipcRenderer2.invoke("comment:reply", { platform, accountId, commentId, content }),
        commentStartPolling: (opts = {}) => ipcRenderer2.invoke("comment:start-polling", {
          platform: opts.platform,
          accountId: opts.accountId,
          interval: opts.interval,
          maxDays: opts.maxDays,
          template: opts.template
        }),
        commentStopPolling: (key) => ipcRenderer2.invoke("comment:stop-polling", { key }),
        commentStatus: () => ipcRenderer2.invoke("comment:status"),
        onCommentReplied: (cb) => {
          const h = (_, data) => cb(data);
          ipcRenderer2.on("comment:replied", h);
          return () => ipcRenderer2.removeListener("comment:replied", h);
        }
      };
    }
    module2.exports = { createPublishApi };
  }
});

// electron/preload/account.js
var require_account = __commonJS({
  "electron/preload/account.js"(exports2, module2) {
    function createAccountApi(ipcRenderer2) {
      return {
        // 账号管理 API
        accountAdd: (platform) => ipcRenderer2.invoke("account:add", platform),
        accountDelete: (accountId) => ipcRenderer2.invoke("account:delete", accountId),
        accountCheckLogin: (platform, accountId) => ipcRenderer2.invoke("account:check-login", { platform, accountId }),
        accountBatchCheckLogin: (accountIds) => ipcRenderer2.invoke("accounts:batch-check-login", { accountIds }),
        accountBatchOpenLogin: (accountIds) => ipcRenderer2.invoke("accounts:batch-open-login", { accountIds }),
        accountList: () => ipcRenderer2.invoke("account:list"),
        accountSetDefault: (platform, accountId) => ipcRenderer2.invoke("store:set-default-account", { platform, accountId }),
        accountGetDefault: (platform) => ipcRenderer2.invoke("store:get-default-account", platform),
        accountUpdate: (id, fields) => ipcRenderer2.invoke("store:update-account", { id, fields }),
        accountSetProxy: (accountId, platform, proxy) => ipcRenderer2.invoke("account:set-proxy", { accountId, platform, proxy }),
        accountSetActive: (accountId, platform, isActive) => ipcRenderer2.invoke("account:set-active", { accountId, platform, isActive }),
        // 内嵌浏览器登录 API
        authOpenLogin: (platform, accountId) => ipcRenderer2.invoke("auth:open-login", { platform, accountId }),
        authCompleteLogin: () => ipcRenderer2.invoke("auth:complete-login"),
        authClose: () => ipcRenderer2.invoke("auth:close"),
        onAuthViewOpened: (callback) => {
          const h = (_, data) => callback(data);
          ipcRenderer2.on("auth:view-opened", h);
          return () => ipcRenderer2.removeListener("auth:view-opened", h);
        },
        onAuthCompleted: (callback) => {
          const h = (_, data) => callback(data);
          ipcRenderer2.on("auth:completed", h);
          return () => ipcRenderer2.removeListener("auth:completed", h);
        },
        onAuthViewClosed: (callback) => {
          const h = () => callback();
          ipcRenderer2.on("auth:view-closed", h);
          return () => ipcRenderer2.removeListener("auth:view-closed", h);
        },
        // Auth API（静默登录）
        authLoginSilent: (platform, accountId) => ipcRenderer2.invoke("auth:login-silent", { platform, accountId }),
        // 扫码登录 API
        authOpenQrCodeLogin: (platform) => ipcRenderer2.invoke("auth:open-qrcode-login", platform),
        authQrCodeClose: () => ipcRenderer2.invoke("auth:qrcode-close"),
        onQrCodeOpened: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("qrcode:opened", h);
          return () => ipcRenderer2.removeListener("qrcode:opened", h);
        },
        onQrCodeDetected: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("qrcode:detected", h);
          return () => ipcRenderer2.removeListener("qrcode:detected", h);
        },
        onQrCodeCompleted: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("qrcode:completed", h);
          return () => ipcRenderer2.removeListener("qrcode:completed", h);
        },
        onQrCodeClosed: (cb) => {
          const h = () => cb();
          ipcRenderer2.on("qrcode:closed", h);
          return () => ipcRenderer2.removeListener("qrcode:closed", h);
        },
        onAccountStatusChanged: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("account:status-changed", h);
          return () => ipcRenderer2.removeListener("account:status-changed", h);
        },
        onAccountsBatchCheckProgress: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("accounts:batch-check-progress", h);
          return () => ipcRenderer2.removeListener("accounts:batch-check-progress", h);
        },
        // OAuth 认证 API
        oauthStart: (opts) => ipcRenderer2.invoke("oauth:start", opts),
        oauthClose: () => ipcRenderer2.invoke("oauth:close"),
        oauthGetConfigs: () => ipcRenderer2.invoke("oauth:get-configs"),
        onOAuthOpened: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("oauth:opened", h);
          return () => ipcRenderer2.removeListener("oauth:opened", h);
        },
        onOAuthCompleted: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("oauth:completed", h);
          return () => ipcRenderer2.removeListener("oauth:completed", h);
        },
        onOAuthFailed: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("oauth:failed", h);
          return () => ipcRenderer2.removeListener("oauth:failed", h);
        },
        onOAuthClosed: (cb) => {
          const h = () => cb();
          ipcRenderer2.on("oauth:closed", h);
          return () => ipcRenderer2.removeListener("oauth:closed", h);
        },
        // 统一数据存储 API
        storeAddAccount: (account) => ipcRenderer2.invoke("store:add-account", account),
        storeGetAccount: (id) => ipcRenderer2.invoke("store:get-account", id),
        storeListAccounts: (platform) => ipcRenderer2.invoke("store:list-accounts", platform),
        storeDeleteAccount: (id) => ipcRenderer2.invoke("store:delete-account", id),
        storeAddPublishRecord: (record) => ipcRenderer2.invoke("store:add-publish-record", record),
        storeListPublishHistory: (opts) => ipcRenderer2.invoke("store:list-publish-history", opts),
        storeGetPublishStats: () => ipcRenderer2.invoke("store:get-publish-stats"),
        storeAddScheduledTask: (task) => ipcRenderer2.invoke("store:add-scheduled-task", task),
        storeListScheduledTasks: () => ipcRenderer2.invoke("store:list-scheduled-tasks"),
        storeDeleteTask: (id) => ipcRenderer2.invoke("store:delete-task", id),
        storeGetSetting: (key) => ipcRenderer2.invoke("store:get-setting", key),
        storeSetSetting: (key, value) => ipcRenderer2.invoke("store:set-setting", key, value),
        storeListCallbackLogs: (limit) => ipcRenderer2.invoke("store:list-callback-logs", limit)
      };
    }
    module2.exports = { createAccountApi };
  }
});

// electron/preload/system.js
var require_system = __commonJS({
  "electron/preload/system.js"(exports2, module2) {
    function createSystemApi(ipcRenderer2) {
      return {
        // 系统 API
        getVersion: () => ipcRenderer2.invoke("app:get-version"),
        getPlatform: () => ipcRenderer2.invoke("app:get-platform"),
        // 自动更新 API
        updateCheck: () => ipcRenderer2.invoke("update:check"),
        updateDownload: () => ipcRenderer2.invoke("update:download"),
        updateInstall: () => ipcRenderer2.invoke("update:install"),
        // 侧边栏「新版本」入口：未下载则先下载，下载完成后自动退出并安装
        updateInstallNow: () => ipcRenderer2.invoke("update:install-now"),
        onUpdateStatus: (callback) => {
          const handler = (_event, payload) => callback(payload);
          ipcRenderer2.on("update:status", handler);
          return () => ipcRenderer2.removeListener("update:status", handler);
        },
        // 首次运行引导 API
        firstRunCheck: () => ipcRenderer2.invoke("first-run:check"),
        onFirstRunStatus: (callback) => {
          const handler = (_event, payload) => callback(payload);
          ipcRenderer2.on("first-run:status", handler);
          return () => ipcRenderer2.removeListener("first-run:status", handler);
        },
        // 平台配置 API
        platformList: () => ipcRenderer2.invoke("platform:list"),
        platformGet: (id) => ipcRenderer2.invoke("platform:get", id),
        getPlatformDefinitions: () => ipcRenderer2.invoke("platform:definitions"),
        // 敏感词预检 API
        sensitiveCheck: (text) => ipcRenderer2.invoke("sensitive:check", { text }),
        sensitiveReplace: (text) => ipcRenderer2.invoke("sensitive:replace", { text }),
        // 数据同步 API
        syncAll: () => ipcRenderer2.invoke("sync:all"),
        syncPlatform: (platform) => ipcRenderer2.invoke("sync:platform", platform),
        syncCached: () => ipcRenderer2.invoke("sync:cached"),
        // 通知 API
        showNotification: (data) => ipcRenderer2.invoke("show-notification", data),
        onNotification: (cb) => {
          const h = (_, data) => cb(data);
          ipcRenderer2.on("notification", h);
          return () => ipcRenderer2.removeListener("notification", h);
        },
        // 回调服务器 API
        onCallbackReceived: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("callback:received", h);
          return () => ipcRenderer2.removeListener("callback:received", h);
        },
        // 离线模式 API
        offlineStatus: () => ipcRenderer2.invoke("offline:status"),
        offlineIsOffline: () => ipcRenderer2.invoke("offline:is-offline"),
        offlineCachedTasks: () => ipcRenderer2.invoke("offline:cached-tasks"),
        offlineAddToCache: (task) => ipcRenderer2.invoke("offline:add-to-cache", task),
        offlineClearCache: () => ipcRenderer2.invoke("offline:clear-cache"),
        onOfflineRestored: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("offline:restored", h);
          return () => ipcRenderer2.removeListener("offline:restored", h);
        },
        // Onboarding API
        onboardingComplete: () => ipcRenderer2.invoke("onboarding:complete"),
        onboardingGetSteps: () => ipcRenderer2.invoke("onboarding:get-steps"),
        onboardingStatus: () => ipcRenderer2.invoke("onboarding:status"),
        // 支付 API
        paymentCreateOrder: (options) => ipcRenderer2.invoke("payment:create-order", options),
        paymentListOrders: () => ipcRenderer2.invoke("payment:list-orders"),
        paymentGetOrder: (orderId) => ipcRenderer2.invoke("payment:get-order", orderId),
        paymentComplete: (orderId, txnId) => ipcRenderer2.invoke("payment:complete", { orderId, txnId }),
        paymentSimulate: (orderId) => ipcRenderer2.invoke("payment:simulate", { orderId }),
        paymentCancel: (orderId) => ipcRenderer2.invoke("payment:cancel", orderId),
        // 全局导航 API（快捷键触发）
        onNavigate: (cb) => {
          const h = (_, route) => cb(route);
          ipcRenderer2.on("app:navigate", h);
          return () => ipcRenderer2.removeListener("app:navigate", h);
        },
        // Analytics API
        analyticsOverview: () => ipcRenderer2.invoke("analytics:overview"),
        analyticsPlatform: (platform) => ipcRenderer2.invoke("analytics:platform", { platform }),
        analyticsPlatforms: () => ipcRenderer2.invoke("analytics:platforms"),
        // Prompt engine evolution API (P0 反馈管道 + P1b 记忆库)
        generationFeedback: (payload) => ipcRenderer2.invoke("generation:feedback", payload),
        promptLibraryList: () => ipcRenderer2.invoke("prompt-library:list"),
        promptLibraryGet: (id, version) => ipcRenderer2.invoke("prompt-library:get", { id, version }),
        promptLibrarySave: (payload) => ipcRenderer2.invoke("prompt-library:save", payload),
        promptLibraryActivate: (id, confirmedBy) => ipcRenderer2.invoke("prompt-library:activate", { id, confirmedBy }),
        // Hotkeys API
        hotkeysList: () => ipcRenderer2.invoke("hotkeys:list"),
        // Keyword API
        keywordStart: (keyword, opts) => ipcRenderer2.invoke("keyword:start", { keyword, opts }),
        keywordStop: (keyword) => ipcRenderer2.invoke("keyword:stop", { keyword }),
        keywordStatus: () => ipcRenderer2.invoke("keyword:status"),
        keywordHistory: (keyword) => ipcRenderer2.invoke("keyword:history", { keyword }),
        keywordStopAll: () => ipcRenderer2.invoke("keyword:stop-all"),
        // Proxy API
        proxyAdd: (host, port, type) => ipcRenderer2.invoke("proxy:add", { host, port, type }),
        proxyAddBatch: (proxies) => ipcRenderer2.invoke("proxy:add-batch", { proxies }),
        proxyList: () => ipcRenderer2.invoke("proxy:list"),
        proxyRemove: (id) => ipcRenderer2.invoke("proxy:remove", { id }),
        proxyTest: (id, timeout) => ipcRenderer2.invoke("proxy:test", { id, timeout }),
        proxyTestAll: (timeout) => ipcRenderer2.invoke("proxy:test-all", { timeout }),
        proxyStatus: () => ipcRenderer2.invoke("proxy:status"),
        proxyGetNext: () => ipcRenderer2.invoke("proxy:get-next"),
        proxyReset: () => ipcRenderer2.invoke("proxy:reset"),
        proxyRemoveDead: () => ipcRenderer2.invoke("proxy:remove-dead"),
        // Upload API
        uploadChunked: (filePath) => ipcRenderer2.invoke("upload:chunked", { filePath }),
        uploadCancel: () => ipcRenderer2.invoke("upload:cancel"),
        onUploadProgress: (callback) => {
          const h = (_e, payload) => callback(payload);
          ipcRenderer2.on("upload:progress", h);
          return () => ipcRenderer2.removeListener("upload:progress", h);
        },
        // Template API
        templateList: () => ipcRenderer2.invoke("template:list"),
        templateGet: (id) => ipcRenderer2.invoke("template:get", id),
        templateAdd: (tpl) => ipcRenderer2.invoke("template:add", tpl),
        templateUpdate: (id, updates) => ipcRenderer2.invoke("template:update", { id, updates }),
        templateDelete: (id) => ipcRenderer2.invoke("template:delete", id),
        templateListByCategory: (category) => ipcRenderer2.invoke("template:list-by-category", category),
        templateGetPresets: () => ipcRenderer2.invoke("template:get-presets"),
        // 许可证 API
        licenseInfo: () => ipcRenderer2.invoke("license:info"),
        licenseActivate: (key) => ipcRenderer2.invoke("license:activate", key),
        licenseDeactivate: () => ipcRenderer2.invoke("license:deactivate"),
        licenseActivateTrial: () => ipcRenderer2.invoke("license:activate-trial"),
        licenseHasFeature: (name) => ipcRenderer2.invoke("license:has-feature", name),
        licenseFeatures: () => ipcRenderer2.invoke("license:features"),
        // Provider API
        providerList: () => ipcRenderer2.invoke("provider:list"),
        providerCreate: (data) => ipcRenderer2.invoke("provider:create", data),
        providerUpdate: (name, data) => ipcRenderer2.invoke("provider:update", name, data),
        providerDelete: (name) => ipcRenderer2.invoke("provider:delete", name),
        providerTest: (name) => ipcRenderer2.invoke("provider:test", name),
        providerListUser: () => ipcRenderer2.invoke("provider:list-user"),
        providerGetUser: (name) => ipcRenderer2.invoke("provider:get-user", name),
        providerSetUserKey: (name, apiKey, baseUrl) => ipcRenderer2.invoke("provider:set-user-key", name, apiKey, baseUrl),
        providerDeleteUserKey: (name) => ipcRenderer2.invoke("provider:delete-user-key", name),
        // AI 生成 API（Phase 2）
        aiListProviders: (type) => ipcRenderer2.invoke("ai:list-providers", type),
        aiGetConfig: (providerId) => ipcRenderer2.invoke("ai:get-config", providerId),
        aiListModels: (providerId) => ipcRenderer2.invoke("ai:list-models", providerId),
        aiGenerate: (type, provider, params) => ipcRenderer2.invoke("ai:generate", { type, provider, params }),
        aiTestConnection: (providerId) => ipcRenderer2.invoke("ai:test-connection", providerId),
        aiSaveConfig: (providerId, config) => ipcRenderer2.invoke("ai:save-config", providerId, config),
        aiIsConfigured: () => ipcRenderer2.invoke("ai:is-configured"),
        aiGenerateTitles: (topic) => ipcRenderer2.invoke("ai:generate-titles", topic),
        aiEnhanceContent: (content, style) => ipcRenderer2.invoke("ai:enhance-content", content, style),
        aiGenerateSummary: (content) => ipcRenderer2.invoke("ai:generate-summary", content),
        aiRewrite: (params) => ipcRenderer2.invoke("ai:rewrite", params),
        aiListRewriteStrategies: () => ipcRenderer2.invoke("ai:list-rewrite-strategies"),
        aiGetRecommendedStrategies: (userSettings) => ipcRenderer2.invoke("ai:get-recommended-strategies", userSettings),
        onAIProgress: (callback) => {
          const h = (_e, p) => callback(p);
          ipcRenderer2.on("ai:progress", h);
          return () => ipcRenderer2.removeListener("ai:progress", h);
        },
        onAIComplete: (callback) => {
          const h = (_e, p) => callback(p);
          ipcRenderer2.on("ai:complete", h);
          return () => ipcRenderer2.removeListener("ai:complete", h);
        },
        onAIError: (callback) => {
          const h = (_e, p) => callback(p);
          ipcRenderer2.on("ai:error", h);
          return () => ipcRenderer2.removeListener("ai:error", h);
        },
        // 视频处理 API（Phase 2）
        videoStatus: () => ipcRenderer2.invoke("video:status"),
        videoListProcessTypes: () => ipcRenderer2.invoke("video:list-process-types"),
        videoListAnalyzeTypes: () => ipcRenderer2.invoke("video:list-analyze-types"),
        videoListStockSources: () => ipcRenderer2.invoke("video:list-stock-sources"),
        videoProcess: (type, params) => ipcRenderer2.invoke("video:process", { type, params }),
        videoAnalyze: (type, filePath) => ipcRenderer2.invoke("video:analyze", type, filePath),
        videoMixAudio: (params) => ipcRenderer2.invoke("video:mix-audio", params),
        videoSearchStock: (query, source, limit) => ipcRenderer2.invoke("video:search-stock", query, source, limit),
        videoGenerateSubtitle: (audioPath, language) => ipcRenderer2.invoke("video:generate-subtitle", audioPath, language),
        onVideoProgress: (callback) => {
          const h = (_e, p) => callback(p);
          ipcRenderer2.on("video:progress", h);
          return () => ipcRenderer2.removeListener("video:progress", h);
        },
        onVideoComplete: (callback) => {
          const h = (_e, p) => callback(p);
          ipcRenderer2.on("video:complete", h);
          return () => ipcRenderer2.removeListener("video:complete", h);
        },
        onVideoError: (callback) => {
          const h = (_e, p) => callback(p);
          ipcRenderer2.on("video:error", h);
          return () => ipcRenderer2.removeListener("video:error", h);
        },
        // 批量发布 API（批量管理工具，不是单次发布）
        batchCreate: (batch) => ipcRenderer2.invoke("batch:create", batch),
        batchExecute: (id) => ipcRenderer2.invoke("batch:execute", id),
        batchSchedule: (id) => ipcRenderer2.invoke("batch:schedule", id),
        batchList: () => ipcRenderer2.invoke("batch:list"),
        batchGet: (id) => ipcRenderer2.invoke("batch:get", id),
        batchDelete: (id) => ipcRenderer2.invoke("batch:delete", id),
        batchDuplicateArticle: (article) => ipcRenderer2.invoke("batch:duplicate-article", article),
        onBatchProgress: (cb) => {
          const h = (_, d) => cb(d);
          ipcRenderer2.on("batch:progress", h);
          return () => ipcRenderer2.removeListener("batch:progress", h);
        },
        // 模型服务商管理 API（5 类模型 CRUD + 默认设置 + 调用日志）
        modelProviderList: (category) => ipcRenderer2.invoke("model-provider:list", category),
        opsCenterSyncGet: () => ipcRenderer2.invoke("ops-center-sync:get"),
        opsCenterSyncSave: (payload) => ipcRenderer2.invoke("ops-center-sync:save", payload),
        opsCenterSyncNow: () => ipcRenderer2.invoke("ops-center-sync:now"),
        opsCenterSyncRuntime: () => ipcRenderer2.invoke("ops-center-sync:runtime"),
        opsCenterSyncPipelineOptions: () => ipcRenderer2.invoke("ops-center-sync:pipelineOptions"),
        opsCenterSyncAppMenu: () => ipcRenderer2.invoke("ops-center-sync:appMenu"),
        modelProviderGet: (id) => ipcRenderer2.invoke("model-provider:get", id),
        modelProviderCreate: (data) => ipcRenderer2.invoke("model-provider:create", data),
        modelProviderUpdate: (id, data) => ipcRenderer2.invoke("model-provider:update", id, data),
        modelProviderDelete: (id) => ipcRenderer2.invoke("model-provider:delete", id),
        modelProviderSetDefault: (category, id) => ipcRenderer2.invoke("model-provider:set-default", category, id),
        modelProviderSetCapabilityDefault: (providerId, capability, enabled) => ipcRenderer2.invoke("model-provider:set-capability-default", providerId, capability, enabled),
        modelProviderGetDefault: (category) => ipcRenderer2.invoke("model-provider:get-default", category),
        modelProviderTest: (id) => ipcRenderer2.invoke("model-provider:test", id),
        modelProviderPresets: (category) => ipcRenderer2.invoke("model-provider:presets", category),
        modelProviderIsConfigured: (category) => ipcRenderer2.invoke("model-provider:is-configured", category),
        modelProviderLogs: (filter) => ipcRenderer2.invoke("model-provider:logs", filter),
        modelProviderCleanLogs: (days) => ipcRenderer2.invoke("model-provider:clean-logs", days),
        // 应用日志 API（设置-通用设置：查看/清理/渲染进程错误上报）
        logsGetInfo: () => ipcRenderer2.invoke("logs:info"),
        logsClear: () => ipcRenderer2.invoke("logs:clear"),
        // 缓存清理 API（设置-通用设置：统计/清理临时缓存）
        cacheGetStats: () => ipcRenderer2.invoke("cache:stats"),
        cacheClear: () => ipcRenderer2.invoke("cache:clear"),
        logError: (message) => ipcRenderer2.invoke("logs:error", { message }),
        submitFeedback: (payload) => ipcRenderer2.invoke("feedback:submit", payload),
        // 通知日志上报（notify:log）——renderer notify() 通道内部调用，写结构化日志行
        notifyLog: (payload) => ipcRenderer2.invoke("notify:log", payload)
      };
    }
    module2.exports = { createSystemApi };
  }
});

// electron/preload/project.js
var require_project = __commonJS({
  "electron/preload/project.js"(exports2, module2) {
    function createProjectApi(ipcRenderer2) {
      return {
        project: {
          list: () => ipcRenderer2.invoke("project:list"),
          get: (projectId) => ipcRenderer2.invoke("project:get", { projectId }),
          del: (projectId) => ipcRenderer2.invoke("project:delete", { projectId })
        }
      };
    }
    module2.exports = { createProjectApi };
  }
});

// electron/preload/board.js
var require_board = __commonJS({
  "electron/preload/board.js"(exports2, module2) {
    function createBoardApi(ipcRenderer2) {
      const updateListeners = /* @__PURE__ */ new Set();
      ipcRenderer2.on("board:update", (_event, payload) => {
        const board = payload && payload.board;
        if (board) {
          for (const cb of updateListeners) {
            try {
              cb(board);
            } catch (_) {
              void _;
            }
          }
        }
      });
      return {
        board: {
          subscribe: (projectId) => ipcRenderer2.invoke("board:subscribe", { projectId }),
          unsubscribe: () => ipcRenderer2.invoke("board:unsubscribe"),
          get: (projectId) => ipcRenderer2.invoke("board:get", { projectId }),
          onUpdate: (callback) => {
            updateListeners.add(callback);
            return () => updateListeners.delete(callback);
          }
        }
      };
    }
    module2.exports = { createBoardApi };
  }
});

// electron/preload/contact-sheet.js
var require_contact_sheet = __commonJS({
  "electron/preload/contact-sheet.js"(exports2, module2) {
    function createContactSheetApi(ipcRenderer2) {
      const approvalListeners = /* @__PURE__ */ new Set();
      ipcRenderer2.on("approval:request", (_event, payload) => {
        if (payload && payload.type === "contact_sheet") {
          for (const cb of approvalListeners) {
            try {
              cb(payload);
            } catch (_) {
              void _;
            }
          }
        }
      });
      return {
        contactSheet: {
          list: (projectId) => ipcRenderer2.invoke("contact-sheet:list", { projectId }),
          approve: (sceneId, selectedTakeId) => ipcRenderer2.invoke("contact-sheet:approve", { sceneId, selectedTakeId }),
          reject: (sceneId, feedback) => ipcRenderer2.invoke("contact-sheet:reject", { sceneId, feedback }),
          onApprovalRequest: (callback) => {
            approvalListeners.add(callback);
            return () => approvalListeners.delete(callback);
          }
        }
      };
    }
    module2.exports = { createContactSheetApi };
  }
});

// electron/preload/approval-gate.js
var require_approval_gate = __commonJS({
  "electron/preload/approval-gate.js"(exports2, module2) {
    function createApprovalGateApi(ipcRenderer2) {
      const gateListeners = /* @__PURE__ */ new Set();
      ipcRenderer2.on("approval:request", (_event, payload) => {
        if (payload && payload.type === "approval_gate") {
          for (const cb of gateListeners) {
            try {
              cb(payload);
            } catch (_) {
              void _;
            }
          }
        }
      });
      return {
        approvalGate: {
          get: (projectId) => ipcRenderer2.invoke("approval-gate:get", { projectId }),
          approve: (gateId, decision, modification) => ipcRenderer2.invoke("approval-gate:approve", { gateId, decision, modification }),
          onApprovalRequest: (callback) => {
            gateListeners.add(callback);
            return () => gateListeners.delete(callback);
          }
        }
      };
    }
    module2.exports = { createApprovalGateApi };
  }
});

// electron/preload/replay.js
var require_replay = __commonJS({
  "electron/preload/replay.js"(exports2, module2) {
    function createReplayApi(ipcRenderer2) {
      return {
        replay: {
          get: (projectId) => ipcRenderer2.invoke("replay:get", { projectId })
        }
      };
    }
    module2.exports = { createReplayApi };
  }
});

// electron/preload/identity.js
var require_identity = __commonJS({
  "electron/preload/identity.js"(exports2, module2) {
    function createIdentityApi(ipcRenderer2) {
      return {
        identityGetState: () => ipcRenderer2.invoke("identity:get-state"),
        identitySignIn: () => ipcRenderer2.invoke("identity:sign-in"),
        identitySwitchAccount: () => ipcRenderer2.invoke("identity:switch-account"),
        identitySignOut: () => ipcRenderer2.invoke("identity:sign-out"),
        onIdentityStateChanged: (callback) => {
          const handler = (_event, state) => callback(state);
          ipcRenderer2.on("identity:state-changed", handler);
          return () => ipcRenderer2.removeListener("identity:state-changed", handler);
        }
      };
    }
    module2.exports = { createIdentityApi };
  }
});

// electron/preload/tts-voice-catalog.js
var require_tts_voice_catalog = __commonJS({
  "electron/preload/tts-voice-catalog.js"(exports2, module2) {
    "use strict";
    function createTtsVoiceCatalogApi(ipcRenderer2) {
      return {
        ttsVoice: {
          catalog: (input) => ipcRenderer2.invoke("tts-voice:catalog", input),
          capability: (input) => ipcRenderer2.invoke("tts-voice:capability", input),
          select: (input) => ipcRenderer2.invoke("tts-voice:select", input),
          clearPreference: (input) => ipcRenderer2.invoke("tts-voice:clear-preference", input)
        }
      };
    }
    module2.exports = { createTtsVoiceCatalogApi };
  }
});

// electron/preload/tts-voice-clone.js
var require_tts_voice_clone = __commonJS({
  "electron/preload/tts-voice-clone.js"(exports2, module2) {
    "use strict";
    function createTtsVoiceCloneApi(ipcRenderer2) {
      return {
        ttsVoiceClone: {
          requirements: (input) => ipcRenderer2.invoke("tts-voice-clone:requirements", input),
          chooseSamples: (input) => ipcRenderer2.invoke("tts-voice-clone:choose-samples", input),
          list: (input) => ipcRenderer2.invoke("tts-voice-clone:list", input),
          add: (input) => ipcRenderer2.invoke("tts-voice-clone:add", input),
          deleteClone: (input) => ipcRenderer2.invoke("tts-voice-clone:delete", input),
          rename: (input) => ipcRenderer2.invoke("tts-voice-clone:rename", input)
        }
      };
    }
    module2.exports = { createTtsVoiceCloneApi };
  }
});

// electron/preload/prompt-eval.js
var require_prompt_eval = __commonJS({
  "electron/preload/prompt-eval.js"(exports2, module2) {
    function createPromptEvalApi(ipcRenderer2) {
      return {
        promptEvalRun: (request) => ipcRenderer2.invoke("prompt-eval:run", request),
        promptEvalList: () => ipcRenderer2.invoke("prompt-eval:list"),
        promptEvalGet: (id) => ipcRenderer2.invoke("prompt-eval:get", id),
        promptEvalDelete: (id) => ipcRenderer2.invoke("prompt-eval:delete", id),
        promptEvalAnalyze: () => ipcRenderer2.invoke("prompt-eval:analyze"),
        promptEvalDimensions: () => ipcRenderer2.invoke("prompt-eval:dimensions")
      };
    }
    module2.exports = { createPromptEvalApi };
  }
});

// electron/preload/page-manager.js
var require_page_manager = __commonJS({
  "electron/preload/page-manager.js"(exports2, module2) {
    function createPageManagerApi(ipcRenderer2) {
      return {
        pageManager: {
          // ── Tab CRUD ──
          createNewTabPage: (opts) => ipcRenderer2.invoke("page-manager:create-new-tab-page", opts),
          closeTab: (tabId) => ipcRenderer2.invoke("page-manager:close-tab", tabId),
          switchToTab: (tabId) => ipcRenderer2.invoke("page-manager:switch-tab", tabId),
          // ── Navigation ──
          navigate: (tabId, url) => ipcRenderer2.invoke("page-manager:navigate", { tabId, url }),
          goBack: (tabId) => ipcRenderer2.invoke("page-manager:go-back", tabId),
          goForward: (tabId) => ipcRenderer2.invoke("page-manager:go-forward", tabId),
          reload: (tabId, ignoreCache) => ipcRenderer2.invoke("page-manager:reload", { tabId, ignoreCache }),
          searchOrNavigate: (query, tabId) => ipcRenderer2.invoke("page-manager:search-or-navigate", { query, tabId }),
          // 共享左侧边栏驱动当前聚焦的 home-shell 标签在其自身 SPA 内导航（主进程定向投递到该标签 webContents）
          navigateActiveHomeShell: (path) => ipcRenderer2.invoke("page-manager:navigate-active-home-shell", { path }),
          // ── Query ──
          getAllTabs: () => ipcRenderer2.invoke("page-manager:get-all-tabs"),
          getActiveTab: () => ipcRenderer2.invoke("page-manager:get-active-tab"),
          getHomeTab: () => ipcRenderer2.invoke("page-manager:get-home-tab"),
          saveCookies: (tabId) => ipcRenderer2.invoke("page-manager:save-cookies", tabId),
          saveAccountTabCredentials: (tabId) => ipcRenderer2.invoke("page-manager:save-account-tab-credentials", tabId),
          // 查询账号标签凭证保存态（方案二：关闭护栏）
          getAccountTabSaveState: (tabId) => ipcRenderer2.invoke("page-manager:account-tab-save-state", tabId),
          // 批量保存全部未保存账号标签（方案三：全部保存）
          saveAllUnsavedAccounts: () => ipcRenderer2.invoke("page-manager:save-all-unsaved-accounts"),
          // ── Event subscription ──
          subscribeEvents: (subscriberId) => ipcRenderer2.invoke("page-manager:subscribe-events", { subscriberId }),
          unsubscribeEvents: (subscriberId) => ipcRenderer2.invoke("page-manager:unsubscribe-events", { subscriberId }),
          // ── 左侧导航栏宽度同步 ──
          setSidebarWidth: (width) => ipcRenderer2.invoke("page-manager:set-sidebar-width", width),
          // T0-6b 壳态互斥：渲染层上报壳态（'workbench'|'browser'），主进程切换内嵌视图可见性
          setShellMode: (mode) => ipcRenderer2.invoke("page-manager:set-shell-mode", mode),
          // 弹窗互斥（2026-09-23）：应用级模态浮层打开期间挂起内嵌 WebContentsView，
          // 否则原生图层压住弹窗（设置/升级/关闭确认）。owner 标识浮层来源，ref-count 释放。
          suspendEmbeddedViews: (owner) => ipcRenderer2.invoke("page-manager:suspend-embedded-views", owner),
          resumeEmbeddedViews: (owner) => ipcRenderer2.invoke("page-manager:resume-embedded-views", owner),
          /**
           * 监听导航状态变化（URL/标题/前进后退状态）
           * callback 收到 { tabId, url, title, canGoBack, canGoForward }
           */
          onNavigationChanged: (cb) => {
            const h = (_, payload) => cb(payload?.data || payload);
            ipcRenderer2.on("page-manager:navigation-changed", h);
            return () => ipcRenderer2.removeListener("page-manager:navigation-changed", h);
          },
          /**
           * 监听单个 tab 事件（created/closed/switched）
           * callback 收到 { tabId, ... } 原始数据
           */
          onTabEvent: (event, cb) => {
            const h = (_, payload) => cb(payload?.data || payload);
            ipcRenderer2.on("page-manager:" + event, h);
            return () => ipcRenderer2.removeListener("page-manager:" + event, h);
          },
          // ── 通用事件监听入口 ──
          on: (channel, cb) => {
            const h = (_, payload) => cb(payload?.data || payload);
            ipcRenderer2.on("page-manager:" + channel, h);
            return () => ipcRenderer2.removeListener("page-manager:" + channel, h);
          }
        }
      };
    }
    module2.exports = { createPageManagerApi };
  }
});

// electron/preload/video-clone.js
var require_video_clone = __commonJS({
  "electron/preload/video-clone.js"(exports2, module2) {
    var { ipcRenderer: ipcRenderer2 } = require("electron");
    function createVideoCloneApi(ipcRendererRef = ipcRenderer2) {
      return {
        videoClone: {
          run: (request) => ipcRendererRef.invoke("video-clone:run", request),
          cancel: (runId) => ipcRendererRef.invoke("video-clone:cancel", { runId }),
          editReport: (report, patch) => ipcRendererRef.invoke("video-clone:report:edit", { report, patch }),
          regenerate: (runId) => ipcRendererRef.invoke("video-clone:report:regenerate", { runId }),
          pickFile: () => ipcRendererRef.invoke("video-clone:pick-file"),
          history: () => ipcRendererRef.invoke("video-clone:history"),
          onProgress: (cb) => {
            const listener = (_event, evt) => {
              try {
                cb(evt);
              } catch {
              }
            };
            ipcRendererRef.on("video-clone:progress", listener);
            return () => ipcRendererRef.removeListener("video-clone:progress", listener);
          }
        }
      };
    }
    module2.exports = { createVideoCloneApi };
  }
});

// electron/preload/services.js
var require_services = __commonJS({
  "electron/preload/services.js"(exports2, module2) {
    function createServicesApi(ipcRenderer2) {
      return {
        servicesGetStatus: () => ipcRenderer2.invoke("services:get-status"),
        servicesRestart: (key) => ipcRenderer2.invoke("services:restart", { key })
      };
    }
    module2.exports = { createServicesApi };
  }
});

// electron/preload/film-engineering.js
var require_film_engineering = __commonJS({
  "electron/preload/film-engineering.js"(exports2, module2) {
    var { ipcRenderer: ipcRenderer2 } = require("electron");
    function createFilmEngineeringApi(ipcRendererRef = ipcRenderer2) {
      return {
        filmEngineering: {
          status: () => ipcRendererRef.invoke("film-engineering:status"),
          listScenes: () => ipcRendererRef.invoke("film-engineering:list-scenes"),
          listShots: (sceneId, pageOpts) => ipcRendererRef.invoke("film-engineering:list-shots", sceneId, pageOpts),
          getShot: (shotId) => ipcRendererRef.invoke("film-engineering:get-shot", shotId),
          doctrine: () => ipcRendererRef.invoke("film-engineering:doctrine"),
          copyText: (shotId, mode) => ipcRendererRef.invoke("film-engineering:copy-text", shotId, mode),
          copyTexts: (shotIds, mode) => ipcRendererRef.invoke("film-engineering:copy-texts", shotIds, mode),
          adaptScript: (payload) => ipcRendererRef.invoke("film-engineering:adapt-script", payload),
          exportPrompts: (selectedShots, format) => ipcRendererRef.invoke("film-engineering:export", selectedShots, format),
          generateSelected: (selectedShots, opts) => ipcRendererRef.invoke("film-engineering:generate-selected", selectedShots, opts),
          uploadReference: (payload) => ipcRendererRef.invoke("film-engineering:upload-reference", payload),
          retryShot: (payload) => ipcRendererRef.invoke("film-engineering:retry-shot", payload),
          downloadRecycled: (payload) => ipcRendererRef.invoke("film-engineering:download-recycled", payload),
          productionPlan: (payload) => ipcRendererRef.invoke("film-engineering:production-plan", payload),
          productionRunBatch: (payload) => ipcRendererRef.invoke("film-engineering:production-run-batch", payload),
          productionStatus: (payload) => ipcRendererRef.invoke("film-engineering:production-status", payload),
          onProductionUpdate: (callback) => {
            const h = (_e, p) => callback(p);
            ipcRendererRef.on("film-engineering:production-update", h);
            return () => ipcRendererRef.removeListener("film-engineering:production-update", h);
          }
        }
      };
    }
    module2.exports = { createFilmEngineeringApi };
  }
});

// electron/preload/aggregation.js
var require_aggregation = __commonJS({
  "electron/preload/aggregation.js"(exports2, module2) {
    function createAggregationApi(ipcRenderer2) {
      return {
        aggregationCollect: (payload) => ipcRenderer2.invoke("aggregation:collect", payload),
        aggregationCollectVideo: (payload) => ipcRenderer2.invoke("aggregation:collect-video", payload),
        aggregationCollectBatch: (payload) => ipcRenderer2.invoke("aggregation:collect-batch", payload),
        aggregationRewrite: (payload) => ipcRenderer2.invoke("aggregation:rewrite", payload),
        aggregationSources: () => ipcRenderer2.invoke("aggregation:sources"),
        aggregationTaskStatus: (taskId) => ipcRenderer2.invoke("aggregation:task-status", taskId),
        // ASR 依赖安装（-6 引导弹窗触发；进度经 asr-install:progress 事件推送）
        aggregationAsrInstall: () => ipcRenderer2.invoke("aggregation:asr-install"),
        onAsrInstallProgress: (callback) => {
          const listener = (_event, progress) => callback(progress);
          ipcRenderer2.on("asr-install:progress", listener);
          return () => ipcRenderer2.removeListener("asr-install:progress", listener);
        },
        // 知乎收藏夹（官方 API + 批量频率控制）
        zhihuFavlistList: () => ipcRenderer2.invoke("zhihu-favlist:list"),
        zhihuFavlistContents: (payload) => ipcRenderer2.invoke("zhihu-favlist:contents", payload),
        zhihuFavlistBatchCollect: (payload) => ipcRenderer2.invoke("zhihu-favlist:batch-collect", payload),
        zhihuFavlistBatchRewrite: (payload) => ipcRenderer2.invoke("zhihu-favlist:batch-rewrite", payload),
        zhihuFavlistCancel: (type) => ipcRenderer2.invoke("zhihu-favlist:cancel", { type })
      };
    }
    module2.exports = { createAggregationApi };
  }
});

// electron/preload/hot-topics.js
var require_hot_topics = __commonJS({
  "electron/preload/hot-topics.js"(exports2, module2) {
    function createHotTopicsApi(ipcRenderer2) {
      return {
        hotTopicsFetch: (payload) => ipcRenderer2.invoke("hot-topics:fetch", payload),
        hotTopicsGetCache: () => ipcRenderer2.invoke("hot-topics:get-cache"),
        // 收藏
        hotTopicsFavoriteAdd: (topic) => ipcRenderer2.invoke("hot-topics:favorite-add", { topic }),
        hotTopicsFavoriteRemove: (topicId) => ipcRenderer2.invoke("hot-topics:favorite-remove", { topicId }),
        hotTopicsFavoriteList: () => ipcRenderer2.invoke("hot-topics:favorite-list")
      };
    }
    module2.exports = { createHotTopicsApi };
  }
});

// electron/preload/auto-pipeline.js
var require_auto_pipeline = __commonJS({
  "electron/preload/auto-pipeline.js"(exports2, module2) {
    function createAutoPipelineApi(ipcRenderer2) {
      return {
        autoPipelineStart: (config) => ipcRenderer2.invoke("auto-pipeline:start", config),
        autoPipelineGetRun: (runId) => ipcRenderer2.invoke("auto-pipeline:get-run", runId),
        autoPipelineCancel: (runId) => ipcRenderer2.invoke("auto-pipeline:cancel", runId),
        autoPipelineListRuns: () => ipcRenderer2.invoke("auto-pipeline:list-runs")
      };
    }
    module2.exports = { createAutoPipelineApi };
  }
});

// electron/preload/knowledge-library.js
var require_knowledge_library = __commonJS({
  "electron/preload/knowledge-library.js"(exports2, module2) {
    function createKnowledgeLibraryApi(ipcRenderer2) {
      return {
        // 爆款库
        addViralToLibrary: (item) => ipcRenderer2.invoke("knowledge-library:add-viral", item),
        addViralBatchToLibrary: (items) => ipcRenderer2.invoke("knowledge-library:add-viral-batch", items),
        listViralItems: (params) => ipcRenderer2.invoke("knowledge-library:list-viral", params),
        getViralItem: (id) => ipcRenderer2.invoke("knowledge-library:get-viral", id),
        updateViralItem: (id, updates) => ipcRenderer2.invoke("knowledge-library:update-viral", id, updates),
        deleteViralItem: (id) => ipcRenderer2.invoke("knowledge-library:delete-viral", id),
        searchViralItems: (query, limit) => ipcRenderer2.invoke("knowledge-library:search-viral", query, limit),
        // 模式卡片（P1）
        listPatternCards: (params) => ipcRenderer2.invoke("knowledge-library:list-pattern-cards", params),
        reextractPattern: (viralItemId) => ipcRenderer2.invoke("knowledge-library:reextract-pattern", viralItemId),
        getPatternQueueStats: () => ipcRenderer2.invoke("knowledge-library:pattern-queue-stats"),
        // 效果闭环（P2）
        listTrackedContent: (params) => ipcRenderer2.invoke("performance:list-tracked", params),
        addManualSnapshot: (trackedContentId, metrics) => ipcRenderer2.invoke("performance:add-manual-snapshot", trackedContentId, metrics),
        recomputeAttribution: () => ipcRenderer2.invoke("performance:recompute-attribution"),
        listPatternPerformance: (params) => ipcRenderer2.invoke("performance:list-pattern-performance", params),
        triggerPerformanceRecrawl: (opts) => ipcRenderer2.invoke("performance:trigger-recrawl", opts),
        // 个人知识库
        addPersonalToLibrary: (item) => ipcRenderer2.invoke("knowledge-library:add-personal", item),
        addPersonalBatchToLibrary: (items) => ipcRenderer2.invoke("knowledge-library:add-personal-batch", items),
        listPersonalItems: (params) => ipcRenderer2.invoke("knowledge-library:list-personal", params),
        getPersonalItem: (id) => ipcRenderer2.invoke("knowledge-library:get-personal", id),
        updatePersonalItem: (id, updates) => ipcRenderer2.invoke("knowledge-library:update-personal", id, updates),
        deletePersonalItem: (id) => ipcRenderer2.invoke("knowledge-library:delete-personal", id),
        searchPersonalItems: (query, limit) => ipcRenderer2.invoke("knowledge-library:search-personal", query, limit),
        // 飞书 API 配置
        feishuGetConfig: () => ipcRenderer2.invoke("feishu:get-config"),
        feishuSaveConfig: (appId, appSecret) => ipcRenderer2.invoke("feishu:save-config", appId, appSecret),
        feishuTestConnection: (appId, appSecret) => ipcRenderer2.invoke("feishu:test-connection", appId, appSecret),
        // 文件批量导入
        importFiles: (files, categoryPerFile) => ipcRenderer2.invoke("knowledge-library:import-files", files, categoryPerFile),
        // 飞书导出
        exportViralToFeishu: (title) => ipcRenderer2.invoke("knowledge-library:export-viral-to-feishu", title),
        exportPersonalToFeishu: (title) => ipcRenderer2.invoke("knowledge-library:export-personal-to-feishu", title),
        // P2 反馈闭环：用户采纳/拒绝驱动知识置信度
        applyKnowledgeFeedback: (action, refs) => ipcRenderer2.invoke("knowledge-library:apply-feedback", action, refs)
      };
    }
    module2.exports = { createKnowledgeLibraryApi };
  }
});

// electron/preload/access-control.js
var require_access_control = __commonJS({
  "electron/preload/access-control.js"(exports2, module2) {
    "use strict";
    var AUTH_ERROR = -3;
    var ADMIN_ONLY_METHODS = [
      "paymentComplete",
      "paymentSimulate",
      "proxyTest",
      "proxyTestAll",
      "proxyReset"
    ];
    var PUBLIC_METHODS = [
      "getVersion",
      "getPlatform",
      "updateCheck",
      "updateDownload",
      "updateInstall",
      "updateInstallNow",
      "onUpdateStatus",
      "firstRunCheck",
      "onFirstRunStatus",
      "showNotification",
      "onNotification",
      "onNavigate",
      "onboardingComplete",
      "onboardingGetSteps",
      "onboardingStatus",
      "licenseInfo",
      "licenseActivate",
      "licenseDeactivate",
      "licenseActivateTrial",
      "licenseHasFeature",
      "licenseFeatures",
      "paymentCreateOrder",
      "paymentListOrders",
      "paymentGetOrder",
      "paymentCancel",
      "authOpenLogin",
      "authClose",
      "onAuthViewOpened",
      "onAuthCompleted",
      "onAuthViewClosed",
      "authLoginSilent",
      "authOpenQrCodeLogin",
      "authQrCodeClose",
      "onQrCodeOpened",
      "onQrCodeDetected",
      "onQrCodeCompleted",
      "onQrCodeClosed",
      "oauthStart",
      "oauthClose",
      "oauthGetConfigs",
      "onOAuthOpened",
      "onOAuthCompleted",
      "onOAuthFailed",
      "onOAuthClosed",
      "platformList",
      "platformGet",
      "getPlatformDefinitions",
      "offlineStatus",
      "offlineIsOffline",
      "offlineCachedTasks",
      "offlineAddToCache",
      "offlineClearCache",
      "onOfflineRestored",
      "onCallbackReceived",
      "hotkeysList",
      "sensitiveCheck",
      "sensitiveReplace",
      "syncAll",
      "syncPlatform",
      "syncCached",
      "modelProviderList",
      "modelProviderGet",
      "opsCenterSyncGet",
      "opsCenterSyncSave",
      "opsCenterSyncNow",
      "opsCenterSyncRuntime",
      // 模型服务商：读方法未登录可用（离线查看/测试已配置模型）；
      // 写方法（Create/Update/Delete/SetDefault/CleanLogs）为 authenticated，未登录调用被拒。
      "modelProviderGetDefault",
      "modelProviderTest",
      "modelProviderPresets",
      "modelProviderIsConfigured",
      "modelProviderLogs",
      "logsGetInfo",
      "logsClear",
      "logError",
      "notifyLog",
      "cacheGetStats",
      "cacheClear",
      "renderGetStatus",
      "renderInstallDeps",
      "onRenderInstallProgress",
      "pipelineList",
      "pipelineGet",
      // 本地媒体导入（与主进程 PUBLIC_CHANNELS 的 story2video:import-media 对齐）：
      // File 路径经 webUtils 解析后仅发送路径给主进程做受控复制，纯设备本地操作。
      "story2videoImportMedia",
      // renderer 选择本地媒体时通过 Electron webUtils 解析绝对路径；不传文件内容。
      "getPathForFile",
      // Story2Video 本地历史读取与缩略图查询：项目数据按 owner 隔离，未登录也可查看本机历史。
      "story2videoListProjects",
      "story2videoGetProject",
      "story2videoGetThumbnail",
      // BGM 素材库（与主进程 PUBLIC_CHANNELS 的 story2video:bgm-library-* 对齐）：
      // 设备级本地素材库管理（列表/添加/改名/删除），未登录可用。
      "story2videoBgmLibraryList",
      "story2videoBgmLibraryAdd",
      "story2videoBgmLibraryRename",
      "story2videoBgmLibraryDelete",
      // 流水线「保存配置」（与主进程 story2video:config-profile-* 对齐）：设备级本地配置管理，未登录可用。
      "story2videoConfigProfileList",
      "story2videoConfigProfileCreate",
      "story2videoConfigProfileRename",
      "story2videoConfigProfileDelete",
      "identityGetState",
      "identitySignIn",
      "identitySwitchAccount",
      "identitySignOut",
      "onIdentityStateChanged",
      // 服务状态面板：纯本地只读诊断信息，未登录可见（与 identity:get-state 同理）
      "servicesGetStatus",
      // 视频克隆：本地分析流水线（未登录可用）；发布经 PublisherRouter 外部验收边界
      "videoClone",
      "videoClone.run",
      "videoClone.cancel",
      "videoClone.editReport",
      "videoClone.regenerate",
      "videoClone.pickFile",
      "videoClone.history",
      "videoClone.onProgress",
      // 影视工程：随包 film-kit 资产浏览/复制/剧本套用（设备本地操作，未登录可用）；
      // 勾选生成（generateSelected）复用 assetGenerator，是否可用由主进程服务自校验。
      "filmEngineering",
      "filmEngineering.status",
      "filmEngineering.listScenes",
      "filmEngineering.listShots",
      "filmEngineering.getShot",
      "filmEngineering.doctrine",
      "filmEngineering.copyText",
      "filmEngineering.copyTexts",
      "filmEngineering.adaptScript",
      "filmEngineering.exportPrompts",
      "filmEngineering.generateSelected",
      "filmEngineering.retryShot",
      "filmEngineering.downloadRecycled",
      "filmEngineering.productionPlan",
      "filmEngineering.productionRunBatch",
      "filmEngineering.productionStatus",
      "filmEngineering.onProductionUpdate"
    ];
    function hasAccess(currentLevel, requiredLevel) {
      if (requiredLevel === "public") return true;
      if (requiredLevel === "authenticated") {
        return currentLevel === "authenticated" || currentLevel === "admin";
      }
      return currentLevel === "admin";
    }
    function requiredLevelForMethod(methodName, inheritedLevel = "public", fullName = null) {
      const name = fullName || methodName;
      if (inheritedLevel !== "public") return inheritedLevel;
      if (ADMIN_ONLY_METHODS.includes(name)) return "admin";
      if (PUBLIC_METHODS.includes(name)) return "public";
      return "authenticated";
    }
    function createPermissionError(methodName) {
      const error = new Error(`许可证权限不足，无法调用 ${methodName}`);
      error.name = "LicensePermissionError";
      error.code = AUTH_ERROR;
      return error;
    }
    function readAccessLevel(getCurrentAccessLevel) {
      try {
        const level = getCurrentAccessLevel();
        if (level === "public" || level === "authenticated" || level === "admin") return level;
      } catch (_) {
        void _;
      }
      return "public";
    }
    function createDynamicAccessApi(api, getCurrentAccessLevel, inheritedLevel = "public", prefix = "") {
      const exposed = {};
      const initialLevel = readAccessLevel(getCurrentAccessLevel);
      for (const key of Object.keys(api)) {
        const value = api[key];
        const fullName = prefix ? prefix + "." + key : key;
        const requiredLevel = requiredLevelForMethod(key, inheritedLevel, fullName);
        if (requiredLevel === "admin" && initialLevel !== "admin") continue;
        if (typeof value === "function") {
          if (requiredLevel === "public") {
            exposed[key] = value;
            continue;
          }
          exposed[key] = function(...args) {
            if (!hasAccess(readAccessLevel(getCurrentAccessLevel), requiredLevel)) {
              throw createPermissionError(key);
            }
            return value.apply(this, args);
          };
        } else if (value && typeof value === "object") {
          exposed[key] = createDynamicAccessApi(value, getCurrentAccessLevel, requiredLevel, fullName);
        }
      }
      return exposed;
    }
    function filterApiByAccessLevel(api, level) {
      const filtered = {};
      for (const key of Object.keys(api)) {
        const value = api[key];
        const requiredLevel = requiredLevelForMethod(key);
        if (!hasAccess(level, requiredLevel)) continue;
        if (typeof value === "function") filtered[key] = value;
        else if (value && typeof value === "object") filtered[key] = value;
      }
      return filtered;
    }
    module2.exports = {
      ADMIN_ONLY_METHODS,
      PUBLIC_METHODS,
      createDynamicAccessApi,
      filterApiByAccessLevel,
      hasAccess
    };
  }
});

// electron/preload/index.js
var require_preload = __commonJS({
  "electron/preload/index.js"(exports2, module2) {
    var { contextBridge: contextBridge2, ipcRenderer: ipcRenderer2, webUtils } = require("electron");
    var {
      ACCESS_LEVEL_CHANNEL,
      ACCESS_LEVEL_INVALIDATE_EVENT,
      isAccessLevel
    } = require_access_level();
    var { createAccessLevelCache } = require_access_level_cache();
    var { createPublishApi } = require_publish();
    var { createAccountApi } = require_account();
    var { createSystemApi } = require_system();
    var { createProjectApi } = require_project();
    var { createBoardApi } = require_board();
    var { createContactSheetApi } = require_contact_sheet();
    var { createApprovalGateApi } = require_approval_gate();
    var { createReplayApi } = require_replay();
    var { createIdentityApi } = require_identity();
    var { createTtsVoiceCatalogApi } = require_tts_voice_catalog();
    var { createTtsVoiceCloneApi } = require_tts_voice_clone();
    var { createPromptEvalApi } = require_prompt_eval();
    var { createPageManagerApi } = require_page_manager();
    var { createVideoCloneApi } = require_video_clone();
    var { createServicesApi } = require_services();
    var { createFilmEngineeringApi } = require_film_engineering();
    var { createAggregationApi } = require_aggregation();
    var { createHotTopicsApi } = require_hot_topics();
    var { createAutoPipelineApi } = require_auto_pipeline();
    var { createKnowledgeLibraryApi } = require_knowledge_library();
    var {
      ADMIN_ONLY_METHODS,
      PUBLIC_METHODS,
      createDynamicAccessApi,
      filterApiByAccessLevel
    } = require_access_control();
    function readAccessLevelFromMain() {
      try {
        if (typeof ipcRenderer2.sendSync === "function") {
          const level = ipcRenderer2.sendSync(ACCESS_LEVEL_CHANNEL);
          if (isAccessLevel(level)) return level;
        }
      } catch (_) {
        void _;
      }
      return "public";
    }
    var accessLevelCache = createAccessLevelCache({ read: readAccessLevelFromMain });
    if (typeof ipcRenderer2.on === "function") {
      ipcRenderer2.on(ACCESS_LEVEL_INVALIDATE_EVENT, () => accessLevelCache.invalidate());
    }
    function getAccessLevel() {
      return accessLevelCache.get();
    }
    var fullApi = {
      ...createPublishApi(ipcRenderer2, {
        getPathForFile: (file) => webUtils?.getPathForFile(file) || ""
      }),
      ...createAccountApi(ipcRenderer2),
      ...createSystemApi(ipcRenderer2),
      ...createProjectApi(ipcRenderer2),
      ...createBoardApi(ipcRenderer2),
      ...createContactSheetApi(ipcRenderer2),
      ...createApprovalGateApi(ipcRenderer2),
      ...createReplayApi(ipcRenderer2),
      ...createIdentityApi(ipcRenderer2),
      ...createTtsVoiceCatalogApi(ipcRenderer2),
      ...createTtsVoiceCloneApi(ipcRenderer2),
      ...createPromptEvalApi(ipcRenderer2),
      ...createPageManagerApi(ipcRenderer2),
      ...createVideoCloneApi(ipcRenderer2),
      ...createServicesApi(ipcRenderer2),
      ...createFilmEngineeringApi(ipcRenderer2),
      ...createAggregationApi(ipcRenderer2),
      ...createHotTopicsApi(ipcRenderer2),
      ...createAutoPipelineApi(ipcRenderer2),
      ...createKnowledgeLibraryApi(ipcRenderer2),
      // P2 限流自检（authenticated，默认受限）
      rateLimitSelfCheck: (params) => ipcRenderer2.invoke("rate-limit:self-check", params),
      rateLimitReport: (payload) => ipcRenderer2.invoke("rate-limit:report", payload)
    };
    var exposedApi = createDynamicAccessApi(fullApi, getAccessLevel);
    exposedApi.getAccessLevel = getAccessLevel;
    contextBridge2.exposeInMainWorld("electronAPI", exposedApi);
    module2.exports = {
      getAccessLevel,
      accessLevelCache,
      filterApiByAccessLevel,
      createDynamicAccessApi,
      ADMIN_ONLY_METHODS,
      PUBLIC_METHODS
    };
  }
});

// electron/home-shell-preload.js
var { contextBridge, ipcRenderer } = require("electron");
var API_ARG_PREFIX = "--mp-home-shell-url=";
function getExpectedHomeShellUrl() {
  const argv = typeof process !== "undefined" && Array.isArray(process.argv) ? process.argv : [];
  for (const arg of argv) {
    if (typeof arg === "string" && arg.startsWith(API_ARG_PREFIX)) {
      const value = arg.slice(API_ARG_PREFIX.length);
      if (value) return value;
    }
  }
  return null;
}
function hasHomeShellParam(search) {
  if (typeof search !== "string" || !search) return false;
  const stripped = search.startsWith("?") ? search.slice(1) : search;
  const queryPart = stripped.split("#")[0];
  if (!queryPart) return false;
  try {
    const params = new URLSearchParams(queryPart);
    return params.get("mp-home-shell") === "1";
  } catch (_) {
    return false;
  }
}
function verifyHomeShell() {
  try {
    const expected = getExpectedHomeShellUrl();
    if (!expected) return false;
    const expectedUrl = new URL(expected);
    const locationUrl = new URL(window.location.href);
    if (locationUrl.origin !== expectedUrl.origin) return false;
    return hasHomeShellParam(locationUrl.search) && hasHomeShellParam(expectedUrl.search);
  } catch (_) {
    return false;
  }
}
contextBridge.exposeInMainWorld("multiPublishMonitor", {
  getCurrentUrl: () => window.location.href,
  reportReady: () => {
    ipcRenderer.send("monitor:page-ready", { url: window.location.href });
  }
});
if (verifyHomeShell()) {
  require_preload();
}
