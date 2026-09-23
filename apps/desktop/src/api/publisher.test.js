/**
 * api/publisher.js -- 完整测试
 * 模式：每个函数都是 getApi() 的委托调用
 * 测试策略：数据驱动，覆盖所有函数的 normal + fallback 路径
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const exportedNames = [
  // 发布
  "publishWechat", "publishBatch", "onProgress",
  // AI 写作
  "modelProviderIsConfigured", "aiIsConfigured", "aiGenerateTitles",
  "aiEnhanceContent", "aiGenerateSummary",
  // 队列
  "getQueueStatus", "getQueueHistory", "cancelTask", "retryTask",
  // 发布历史
  "historyList", "historyGet", "historyDelete",
  // 统计
  "dashboardStats",
  // 定时发布
  "schedulerCreate", "schedulerList", "schedulerCancel",
  // 账号管理
  "listAccounts", "accountAdd", "accountDelete", "accountCheckLogin",
  "accountList", "accountSetDefault", "accountUpdate", "accountSetActive",
  // 内嵌浏览器登录
  "authOpenLogin", "authCompleteLogin", "authClose", "onAuthViewOpened",
  "onAuthCompleted", "onAuthViewClosed",
  // 渲染
  "renderStart", "renderCancel", "renderGetStatus", "renderInstallDeps",
  "renderStartAiVideo",
  "onRenderProgress", "onRenderComplete", "onRenderError", "onRenderInstallProgress",
  // 内容情报
  "intelligenceSearch", "intelligenceSearchTitles", "intelligenceFetchTrending",
  "intelligenceSuggestTags", "intelligenceFindReferences",
  "intelligenceGetOptimalTime", "intelligenceGetBenchmark",
  // 关键词监测
  "keywordStatus", "keywordStart", "keywordStop", "keywordHistory",
  // 爆款分析
  "viralAnalyze", "viralGenerate",
  // 平台配置
  "platformList", "platformGet", "getPlatformDefinitions",
  // 敏感词
  "sensitiveCheck", "sensitiveReplace",
  // 数据同步
  "syncAll", "syncPlatform",
  // 自动更新
  "updateCheck", "updateDownload", "updateInstall", "updateInstallNow", "onUpdateStatus",
  // 全局存储
  "storeGetSetting", "storeSetSetting", "storeAddPublishRecord", "storeListPublishHistory",
  // OAuth
  "oauthStart", "oauthClose", "onOAuthCompleted",
  // 批量发布
  "batchCreate", "batchExecute", "batchSchedule", "batchGet", "batchList", "batchDelete", "onBatchProgress",
  // 二维码登录与账号状态事件
  "authOpenQrCodeLogin", "authQrCodeClose", "onQrCodeOpened", "onQrCodeDetected", "onQrCodeCompleted", "onQrCodeClosed", "onAccountStatusChanged",
  // 支付
  "paymentCreateOrder", "paymentListOrders", "paymentGetOrder",
  "paymentSimulate", "paymentCancel",
  // 首次运行
  "firstRunCheck", "onFirstRunStatus",
  // 离线
  "offlineStatus", "offlineAddToCache", "offlineClearCache", "onOfflineRestored",
  // 通知
  "showNotification",
  // 草稿箱（参考产品复用）
  "draftSave", "draftList", "draftDelete",
  "story2videoImportMedia", "story2videoExportZip", "story2videoCreateShareUrl",
  "story2videoCopyPath", "story2videoShowInFolder", "story2videoSaveAs", "story2videoListProjects",
  "story2videoGetProject", "story2videoDeleteProject", "story2videoUpdateSegments",
  "story2videoReplaceSegmentAudio",
  "story2videoRetrySegment", "story2videoRecomposeProject", "story2videoTranscribe",
  "story2videoCapabilities", "videoProcess",
  // 流水线「保存配置」（2026-08-28 s2v-pipeline-config-profiles）
  "story2videoConfigProfileList", "story2videoConfigProfileCreate",
  "story2videoConfigProfileRename", "story2videoConfigProfileDelete",
];

const apiMeta = {
    // 渲染监听器
  onRenderProgress:       { args: [vi.fn()], fallback: undefined, returns: "function" },
  onRenderComplete:       { args: [vi.fn()], fallback: undefined, returns: "function" },
  onRenderError:          { args: [vi.fn()], fallback: undefined, returns: "function" },
  onRenderInstallProgress: { args: [vi.fn()], fallback: undefined, returns: "function" },
  // 内容情报
  intelligenceSearch:        { args: ["test", {}], fallback: { code: 0, data: [] }, returns: "object" },
  intelligenceSearchTitles:  { args: ["test", {}], fallback: [], returns: "object" },
  intelligenceFetchTrending: { args: [{}], fallback: [], returns: "object" },
  intelligenceSuggestTags:   { args: ["content", {}], fallback: null, returns: "null" },
  intelligenceFindReferences: { args: ["https://x.com", {}], fallback: [], returns: "object" },
  intelligenceGetOptimalTime: { args: ["keyword"], fallback: null, returns: "null" },
  intelligenceGetBenchmark:   { args: [{}], fallback: null, returns: "null" },
  // 关键词监测
  keywordStatus:   { args: [], fallback: { code: 0, data: {} }, returns: "object" },
  keywordStart:    { args: ["kw", {}], fallback: { code: -1 }, returns: "object" },
  keywordStop:     { args: ["kw"], fallback: { code: -1 }, returns: "object" },
  keywordHistory:  { args: ["kw"], fallback: { code: 0, data: [] }, returns: "object" },
  // 爆款分析
  viralAnalyze:    { args: ["articles", "topic"], fallback: { code: -1 }, returns: "object" },
  viralGenerate:   { args: [{}], fallback: { code: -1 }, returns: "object" },
  // 平台配置
  platformList:    { args: [], fallback: { code: 0, data: [] }, returns: "object" },
  platformGet:     { args: ["wx"], fallback: { code: -1 }, returns: "object" },
  getPlatformDefinitions: { args: [], fallback: { code: -1 }, returns: "object" },
publishWechat: { args: [{ title: "t", content: "c" }], fallback: undefined, returns: "undefined" },
  publishBatch: { args: [["wx"], { title: "t" }], fallback: { code: -1, message: "electronAPI not available" }, throws: false },
  onProgress: { args: [vi.fn()], fallback: undefined, returns: "function" },
  modelProviderIsConfigured: { args: ["llm"], fallback: { code: -1, data: false }, returns: "object" },
  aiIsConfigured: { args: [], fallback: { code: -1, data: false }, returns: "object" },
  aiGenerateTitles: { args: ["AI 技术"], fallback: { code: -1, data: [] }, returns: "object" },
  aiEnhanceContent: { args: ["正文", "polish"], fallback: { code: -1, data: "" }, returns: "object" },
  aiGenerateSummary: { args: ["正文"], fallback: { code: -1, data: "" }, returns: "object" },
  getQueueStatus: { args: [], fallback: {}, returns: "object" },
  getQueueHistory: { args: [], fallback: { code: 0, data: [] }, returns: "object" },
  cancelTask: { args: ["task-1"], fallback: { code: -1 }, returns: "object" },
  retryTask: { args: ["task-1"], fallback: { code: -1 }, returns: "object" },
  historyList: { args: [{ page: 1 }], fallback: { code: 0, data: { total: 0, records: [] } }, returns: "object" },
  historyGet: { args: ["id-1"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  historyDelete: { args: [["id-1"]], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  dashboardStats: { args: [], fallback: { code: 0, data: { total: 0, success: 0, failed: 0, byPlatform: {}, daily: [] } }, returns: "object" },
  schedulerCreate: { args: [{ time: "2026-01-01" }], fallback: { code: -1 }, returns: "object" },
  schedulerList: { args: [], fallback: { code: 0, data: [] }, returns: "object" },
  schedulerCancel: { args: ["sched-1"], fallback: { code: -1 }, returns: "object" },
  listAccounts: { args: [], fallback: { code: 0, data: [] }, returns: "object" },
  accountAdd: { args: ["wechat_mp"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  accountDelete: { args: ["acc-1"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  accountCheckLogin: { args: ["wechat_mp", "acc-1"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  accountList: { args: [], fallback: { code: 0, data: [] }, returns: "object" },
  accountSetDefault: { args: ["wechat_mp", "acc-1"], fallback: undefined, returns: "undefined" },
  accountUpdate: { args: ["acc-1", { name: "new" }], fallback: undefined, returns: "undefined" },
  accountSetActive: { args: ["acc-1", "wechat_mp", false], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  authOpenLogin: { args: ["weibo", undefined], fallback: { code: -1 }, returns: "object" },
  authCompleteLogin: { args: [], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  authClose: { args: [], fallback: undefined, returns: "undefined" },
  onAuthViewOpened: { args: [vi.fn()], fallback: undefined, returns: "function" },
  onAuthCompleted: { args: [vi.fn()], fallback: undefined, returns: "function" },
  onAuthViewClosed: { args: [vi.fn()], fallback: undefined, returns: "function" },
  renderStart: { args: [{ type: "video" }], fallback: undefined, returns: "undefined" },
  renderStartAiVideo: { args: [{ prompt: "test" }], fallback: undefined, returns: "undefined" },
  renderCancel: { args: [], fallback: {}, returns: "object" },
  renderGetStatus: { args: [], fallback: {}, returns: "object" },
  renderInstallDeps: { args: [], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  sensitiveCheck: { args: ["text"], fallback: { code: -1 }, returns: "object" },
  sensitiveReplace: { args: ["text"], fallback: { code: -1 }, returns: "object" },
  syncAll: { args: [], fallback: { code: -1 }, returns: "object" },
  syncPlatform: { args: ["douyin"], fallback: { code: -1 }, returns: "object" },
  updateCheck: { args: [], fallback: {}, returns: "object" },
  updateDownload: { args: [], fallback: {}, returns: "object" },
  updateInstall: { args: [], fallback: {}, returns: "object" },
  updateInstallNow: { args: [], fallback: {}, returns: "object" },
  onUpdateStatus: { args: [vi.fn()], fallback: undefined, returns: "function" },
  storeGetSetting: { args: ["theme"], fallback: null, returns: "null" },
  storeSetSetting: { args: ["theme", "dark"], fallback: undefined, returns: "undefined" },
  storeAddPublishRecord: { args: [{ id: "1" }], fallback: null, returns: "null" },
  storeListPublishHistory: { args: [{ page: 1 }], fallback: { code: 0, data: [] }, returns: "object" },
  oauthStart: { args: [{ platform: "twitter" }], fallback: { code: -1 }, returns: "object" },
  oauthClose: { args: [], fallback: undefined, returns: "undefined" },
  onOAuthCompleted: { args: [vi.fn()], fallback: undefined, returns: "function" },
  batchCreate: { args: [{ platforms: ["wx"] }], fallback: { code: -1 }, returns: "object" },
  batchExecute: { args: ["batch-1"], fallback: { code: -1 }, returns: "object" },
  batchSchedule: { args: ["batch-1"], fallback: { code: -1 }, returns: "object" },
  batchGet: { args: ["batch-1"], fallback: { code: -1 }, returns: "object" },
  batchList: { args: [], fallback: { code: 0, data: [] }, returns: "object" },
  batchDelete: { args: ["batch-1"], fallback: undefined, returns: "undefined" },
  onBatchProgress: { args: [vi.fn()], fallback: undefined, returns: "function" },
  authOpenQrCodeLogin: { args: ["wechat_mp"], fallback: { code: -1 }, returns: "object" },
  authQrCodeClose: { args: [], fallback: { code: -1 }, returns: "object" },
  onQrCodeOpened: { args: [vi.fn()], fallback: undefined, returns: "function" },
  onQrCodeDetected: { args: [vi.fn()], fallback: undefined, returns: "function" },
  onQrCodeCompleted: { args: [vi.fn()], fallback: undefined, returns: "function" },
  onQrCodeClosed: { args: [vi.fn()], fallback: undefined, returns: "function" },
  onAccountStatusChanged: { args: [vi.fn()], fallback: undefined, returns: "function" },
  paymentCreateOrder: { args: [{ amount: 100 }], fallback: { code: -1 }, returns: "object" },
  paymentListOrders: { args: [], fallback: { code: 0, data: [] }, returns: "object" },
  paymentGetOrder: { args: ["ord-1"], fallback: { code: -1 }, returns: "object" },
  paymentSimulate: { args: ["ord-1"], fallback: { code: -1 }, returns: "object" },
  paymentCancel: { args: ["ord-1"], fallback: { code: -1 }, returns: "object" },
  firstRunCheck: { args: [], fallback: { code: 0, data: { setupDone: false } }, returns: "object" },
  onFirstRunStatus: { args: [vi.fn()], fallback: undefined, returns: "function" },
  offlineStatus: { args: [], fallback: { code: -1, data: { offline: false, cachedCount: 0, cachedTasks: [] } }, returns: "object" },
  offlineAddToCache: { args: [{ task: "x" }], fallback: { code: -1 }, returns: "object" },
  offlineClearCache: { args: [], fallback: { code: -1 }, returns: "object" },
  onOfflineRestored: { args: [vi.fn()], fallback: undefined, returns: "function" },
  showNotification: { args: [{ title: "test" }], fallback: undefined, returns: "undefined" },
  draftSave: { args: [{ id: "d1", title: "t" }], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  draftList: { args: [], fallback: { code: 0, data: [] }, returns: "object" },
  draftDelete: { args: ["d1"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoImportMedia: { args: [{ name: "voice.mp3" }, "audio"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoExportZip: { args: [[{ path: "C:/video.mp4" }]], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoCreateShareUrl: { args: ["C:/video.mp4"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoCopyPath: { args: ["C:/video.mp4"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoShowInFolder: { args: ["C:/video.mp4"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoSaveAs: { args: ["C:/video.mp4", "out.mp4"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoListProjects: { args: [], fallback: { code: -1, message: "electronAPI not available", data: [] }, returns: "object" },
  story2videoGetProject: { args: ["project-1"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoDeleteProject: { args: ["project-1"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoUpdateSegments: { args: ["project-1", [{ id: "segment-0" }]], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoReplaceSegmentAudio: { args: ["project-1", "segment-0", "C:/voice.mp3"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoRetrySegment: { args: ["project-1", "segment-0", "image"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoRecomposeProject: { args: ["project-1"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoTranscribe: { args: ["C:/voice.mp3"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoCapabilities: { args: [], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  videoProcess: { args: ["trim", { input_path: "C:/video.mp4", start_seconds: 1, end_seconds: 3 }], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoConfigProfileList: { args: [], fallback: { code: -1, message: "electronAPI not available", data: [] }, returns: "object" },
  story2videoConfigProfileCreate: { args: [{ pipelineId: "story2video-compose", name: "n", snapshot: {}, overwrite: false }], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoConfigProfileRename: { args: ["profile-1", "n2"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" },
  story2videoConfigProfileDelete: { args: ["profile-1"], fallback: { code: -1, message: "electronAPI not available" }, returns: "object" }
};

function createMockApi() {
  const mock = {};
  for (const name of exportedNames) {
    mock[name] = vi.fn();
  }
  return mock;
}

describe("api/publisher -- 所有函数导出", () => {
  it("导出 " + exportedNames.length + " 个函数", async () => {
    const pub = await import("./publisher.js");
    for (const name of exportedNames) {
      expect(typeof pub[name]).toBe("function");
    }
  });
});

describe("api/publisher -- normal 路径（electronAPI 存在）", () => {
  let mockApi;
  beforeEach(async () => {
    vi.resetModules();
    delete window.electronAPI;
  });
  function setupNormal(name) {
    mockApi = createMockApi();
    const resolvedValue = { code: 0, name };
    // intelligenceFetchTrending 在 publisher.js 中拆 envelope（res.code===0 → res.data），
    // 故 mock 需把期望返回值包进 data，使 unwrap 后仍等于 resolvedValue
    if (name === "intelligenceFetchTrending" || name === "storeGetSetting") {
      mockApi[name].mockResolvedValue({ code: 0, data: resolvedValue });
    } else {
      mockApi[name].mockResolvedValue(resolvedValue);
    }
    window.electronAPI = mockApi;
    return resolvedValue;
  }
  for (const [name, meta] of Object.entries(apiMeta)) {
    if (meta.returns === "function") continue;
    it(name + " -- electronAPI 存在时调用委托", async () => {
      const resolved = setupNormal(name);
      const m = await import("./publisher.js");
      const result = await m[name](...meta.args);
      expect(mockApi[name]).toHaveBeenCalledWith(...meta.args);
      expect(result).toEqual(resolved);
    });
  }
  for (const [name, meta] of Object.entries(apiMeta)) {
    if (meta.returns !== "function") continue;
    it(name + " -- 注册 listener 返回注销函数", async () => {
      mockApi = createMockApi();
      mockApi[name].mockReturnValue(vi.fn());
      window.electronAPI = mockApi;
      const m = await import("./publisher.js");
      const cb = vi.fn();
      const cleanup = m[name](cb);
      expect(mockApi[name]).toHaveBeenCalledWith(cb);
      expect(typeof cleanup).toBe("function");
    });
  }
});

describe("api/publisher -- fallback 路径（electronAPI 不存在）", () => {
  let pub;
  beforeEach(async () => {
    vi.resetModules();
    delete window.electronAPI;
    pub = await import("./publisher.js");
  });
  for (const [name, meta] of Object.entries(apiMeta)) {
    if (meta.throws) {
      it(name + " -- electronAPI 不存在时 throw", async () => {
        await expect(pub[name](...meta.args)).rejects.toThrow("electronAPI not available");
      });
    } else if (meta.returns === "function") {
      it(name + " -- electronAPI 不存在时返回空函数", () => {
        const cb = vi.fn();
        const result = pub[name](cb);
        expect(typeof result).toBe("function");
        expect(() => result()).not.toThrow();
      });
    } else if (meta.fallback !== undefined) {
      it(name + " -- electronAPI 不存在时返回 fallback", async () => {
        const result = await pub[name](...meta.args);
        expect(result).toEqual(meta.fallback);
      });
    }
  }
});

describe("api/publisher -- 边界条件", () => {
  it("electronAPI 为 null 时正常返回 fallback", async () => {
    vi.resetModules();
    window.electronAPI = null;
    const pub = await import("./publisher.js");
    const result = await pub.offlineStatus();
    expect(result).toEqual({
      code: -1,
      data: { offline: false, cachedCount: 0, cachedTasks: [] },
    });
  });
  it("electronAPI 部分实现时仍可工作", async () => {
    vi.resetModules();
    window.electronAPI = { publishBatch: vi.fn().mockResolvedValue({ code: 0 }) };
    const pub = await import("./publisher.js");
    const result = await pub.publishBatch(["wx"], { t: "test" });
    expect(result).toEqual({ code: 0 });
    // 部分实现时未实现的方法会 TypeError（electronAPI 有对象但不含该方法）
    // 这是预期行为 — electronAPI 要么全有要么全无
  });
  it("storeGetSetting 解包生产 IPC envelope", async () => {
    vi.resetModules();
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: "dark" }),
    };
    const pub = await import("./publisher.js");

    await expect(pub.storeGetSetting("theme")).resolves.toBe("dark");
  });
  it("storeGetSetting 业务失败时返回 null", async () => {
    vi.resetModules();
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue({ code: -1, message: "读取失败" }),
    };
    const pub = await import("./publisher.js");

    await expect(pub.storeGetSetting("theme")).resolves.toBeNull();
  });
});

