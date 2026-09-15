/**
 * IPC Mock 主文件
 *
 * 在 Vite dev server 模式下注入 window.electronAPI，模拟主进程 IPC。
 *
 * 设计原则：
 * 1. 返回统一结构 { code: 0|非0, data?: ..., message?: ... }
 *    - 与 electron/services/ 下的 handleAsync 风格保持一致
 * 2. 所有 fixture 数据从 window.__fixtures 读取（由 Playwright addInitScript 注入）
 * 3. 支持 failNextCall / failAllCalls 钩子，用于错误路径测试
 * 4. 记录所有调用到 window.__ipcCalls，供测试断言使用
 *
 * 使用方式（Playwright）：
 *   await page.addInitScript({ content: fs.readFileSync('ipc-mock.js', 'utf8') + '\ninitMock();' });
 */

(function () {
  // 标记已注入，避免重复
  if (window.__ipcMockInjected) return;
  window.__ipcMockInjected = true;

  // 调用日志
  window.__ipcCalls = [];
  window.__ipcCallsByMethod = {};
  // 失败注入控制
  window.__ipcFailNextCall = null;     // { method, code, message } | null
  window.__ipcFailAllForMethod = null; // { method, code, message } | null

  const modelProviderFixtures = (window.__fixtures && window.__fixtures.modelProviders) || {};
  const visualSearch = window.location && typeof window.location.search === 'string'
    ? window.location.search
    : '';
  const visualView = typeof URLSearchParams === 'function'
    ? new URLSearchParams(visualSearch).get('visual-view')
    : null;
  const providerFixtures = modelProviderFixtures.providers || [];
  const visualProviders = modelProviderFixtures.visualProviders || [];

  // 内部可变状态（mock store）
  const state = {
    accounts: (window.__fixtures && window.__fixtures.accounts && window.__fixtures.accounts.accounts) || [],
    articles: (window.__fixtures && window.__fixtures.articles && window.__fixtures.articles.articles) || [],
    publishHistory: (window.__fixtures && window.__fixtures.publishHistory && window.__fixtures.publishHistory.publishHistory) || [],
    stats: (window.__fixtures && window.__fixtures.publishHistory && window.__fixtures.publishHistory.stats) || { total: 0, success: 0, failed: 0 },
    providers: visualView === 'model-provider-delete-dialog'
      ? [...providerFixtures, ...visualProviders]
      : providerFixtures,
    providerDefaults: modelProviderFixtures.defaults || {},
    providerCategories: modelProviderFixtures.categories || [],
    comments: (window.__fixtures && window.__fixtures.comments && window.__fixtures.comments.comments) || [],
    schedulerTasks: (window.__fixtures && window.__fixtures.comments && window.__fixtures.comments.schedulerTasks) || [],
    story2videoProjects: [{
      projectId: 'e2e-story2video-project',
      title: 'E2E 视频任务',
      pipeline: 'story2video-compose',
      sourceText: '用于验证历史任务直接进入视频任务编辑页的 E2E 文案。',
      createdAt: '2026-07-10T10:00:00Z',
      updatedAt: '2026-07-10T10:05:00Z',
      segments: [{
        id: 'e2e-scene-0',
        index: 0,
        text: '用于验证历史任务直接进入视频任务编辑页的 E2E 文案。',
        status: 'completed',
        duration: 5,
      }],
      options: {},
    }],
    // 运行时状态
    offline: false,
    licensed: { isPro: false, trial: true, trialDaysLeft: 7 },
    loginStatus: { weibo: 'online', zhihu: 'online', douyin: 'online', xiaohongshu: 'online', wechat_mp: 'online' }
  };

  // 允许在 addInitScript 中通过 window.__proDefault 预置 Pro 状态
  if (window.__proDefault === true) state.licensed.isPro = true;
  if (window.__offlineDefault === true) state.offline = true;

  // 工具函数
  function ok(data) { return { code: 0, data }; }
  function fail(message, code) { return { code: code || -1, message }; }

  function recordCall(method, args) {
    window.__ipcCalls.push({ method, args: args ? args.slice(0, 2) : [], at: Date.now() });
    if (!window.__ipcCallsByMethod[method]) window.__ipcCallsByMethod[method] = 0;
    window.__ipcCallsByMethod[method]++;
  }

  function maybeFail(method) {
    // 单次失败优先
    if (window.__ipcFailNextCall && window.__ipcFailNextCall.method === method) {
      const f = window.__ipcFailNextCall;
      window.__ipcFailNextCall = null;
      return fail(f.message || 'injected failure', f.code);
    }
    // 持续失败
    if (window.__ipcFailAllForMethod && window.__ipcFailAllForMethod.method === method) {
      const f = window.__ipcFailAllForMethod;
      return fail(f.message || 'persistent failure', f.code);
    }
    return null;
  }

  // 主 API 构造器
  function makeHandler(method, handler) {
    return async function (...args) {
      recordCall(method, args);
      const f = maybeFail(method);
      if (f) return f;
      try {
        return await handler(...args);
      } catch (e) {
        return fail(e.message || String(e));
      }
    };
  }

  // pipeline 子对象（preload.js 把 pipelines 暴露为 { list, get }）
  const pipelinesObj = {
    list: makeHandler('pipelines.list', async () => ok([
      { id: 'p_001', name: '热点话题流水线', steps: 5 },
      { id: 'p_002', name: 'AI 写作流水线', steps: 4 }
    ])),
    get: makeHandler('pipelines.get', async (name) => ok({
      id: name, name, steps: [
        { id: 's1', type: 'collect', label: '采集' },
        { id: 's2', type: 'ai-write', label: 'AI 写作' },
        { id: 's3', type: 'optimize', label: '优化' },
        { id: 's4', type: 'publish', label: '发布' }
      ]
    }))
  };

  // 通用 listener registry
  const listeners = {};
  function makeOn(channel) {
    return function (cb) {
      if (!listeners[channel]) listeners[channel] = [];
      listeners[channel].push(cb);
      return function () {
        listeners[channel] = (listeners[channel] || []).filter(function (x) { return x !== cb; });
      };
    };
  }
  window.__fireEvent = function (channel, payload) {
    (listeners[channel] || []).forEach(function (cb) { try { cb(payload); } catch (_) {} });
  };

  // 构造完整 IPC API
  const api = {
    // 系统
    getVersion: makeHandler('getVersion', async () => ok('0.1.0')),
    getPlatform: makeHandler('getPlatform', async () => ok('win32')),

    // 自动更新
    updateCheck: makeHandler('updateCheck', async () => ok({ available: false, version: '0.1.0' })),
    updateDownload: makeHandler('updateDownload', async () => ok({ started: true })),
    updateInstall: makeHandler('updateInstall', async () => ok({ installed: true })),
    updateInstallNow: makeHandler('updateInstallNow', async () => ok(true)),
    onUpdateStatus: makeOn('update:status'),

    // 首次运行
    firstRunCheck: makeHandler('firstRunCheck', async () => ok({ isFirstRun: true, setupDone: false })),
    onFirstRunStatus: makeOn('first-run:status'),

    // 平台
    platformList: makeHandler('platformList', async () => ok([
      { id: 'wechat_mp', name: '微信公众号', icon: '💬', comment_url: 'https://mp.weixin.qq.com/' },
      { id: 'zhihu', name: '知乎', icon: '❓', comment_url: 'https://www.zhihu.com/notifications' },
      { id: 'weibo', name: '微博', icon: '✧', comment_url: 'https://weibo.com/comment/inbox' },
      { id: 'douyin', name: '抖音', icon: '🎵', comment_url: 'https://creator.douyin.com/' },
      { id: 'xiaohongshu', name: '小红书', icon: '📕', comment_url: 'https://creator.xiaohongshu.com/' }
    ])),
    platformGet: makeHandler('platformGet', async (id) => ok(state.accounts.filter(function (a) { return a.platform === id; }))),
    getPlatformDefinitions: makeHandler('getPlatformDefinitions', async () => ok({
      names: {
        wechat_mp: '微信公众号',
        zhihu: '知乎',
        weibo: '微博',
        douyin: '抖音',
        xiaohongshu: '小红书',
        tencent_video: '视频号',
        kuaishou: '快手',
        toutiao: '今日头条',
        bilibili: 'B站',
        baijiahao: '百家号',
        youtube: 'YouTube',
        tiktok: 'TikTok',
        twitter: 'Twitter/X',
        instagram: 'Instagram',
        facebook: 'Facebook'
      },
      icons: {
        wechat_mp: '💬',
        zhihu: '❓',
        weibo: '✧',
        douyin: '🎵',
        xiaohongshu: '📕',
        tencent_video: '▶',
        kuaishou: '🎬',
        toutiao: '📰',
        bilibili: '📺',
        baijiahao: '📖',
        youtube: '▶',
        tiktok: '♪',
        twitter: '✕',
        instagram: '📷',
        facebook: '👍'
      },
      content_categories: {
        wechat_mp: 'IMAGE_TEXT',
        zhihu: 'IMAGE_TEXT',
        weibo: 'MIXED',
        douyin: 'VIDEO',
        xiaohongshu: 'MIXED',
        tencent_video: 'VIDEO',
        kuaishou: 'VIDEO',
        toutiao: 'MIXED',
        bilibili: 'VIDEO',
        baijiahao: 'IMAGE_TEXT',
        youtube: 'VIDEO',
        tiktok: 'VIDEO',
        twitter: 'MIXED',
        instagram: 'IMAGE_TEXT',
        facebook: 'MIXED'
      },
      categories: {
        wechat_mp: '中文',
        zhihu: '中文',
        weibo: '中文',
        douyin: '中文',
        xiaohongshu: '中文',
        tencent_video: '中文',
        kuaishou: '中文',
        toutiao: '中文',
        bilibili: '中文',
        baijiahao: '中文',
        youtube: '海外',
        tiktok: '海外',
        twitter: '海外',
        instagram: '海外',
        facebook: '海外'
      },
      dashboardUrls: {
        wechat_mp: 'https://mp.weixin.qq.com/',
        zhihu: 'https://www.zhihu.com/',
        weibo: 'https://weibo.com/',
        douyin: 'https://creator.douyin.com/',
        xiaohongshu: 'https://creator.xiaohongshu.com/',
        tencent_video: 'https://channels.weixin.qq.com/',
        kuaishou: 'https://cp.kuaishou.com/',
        toutiao: 'https://mp.toutiao.com/',
        bilibili: 'https://www.bilibili.com/',
        baijiahao: 'https://baijiahao.baidu.com/',
        youtube: 'https://studio.youtube.com/',
        tiktok: 'https://www.tiktok.com/',
        twitter: 'https://twitter.com/home',
        instagram: 'https://www.instagram.com/',
        facebook: 'https://www.facebook.com/'
      },
      qrCodePlatforms: ['wechat_mp', 'tencent_video', 'zhihu', 'weibo', 'toutiao']
    })),

    // 敏感词
    sensitiveCheck: makeHandler('sensitiveCheck', async ({ text }) => ok({ hasSensitive: false, words: [] })),
    sensitiveReplace: makeHandler('sensitiveReplace', async ({ text }) => ok(text || '')),

    // 数据同步
    syncAll: makeHandler('syncAll', async () => ok({ synced: 0, cached: [] })),
    syncPlatform: makeHandler('syncPlatform', async () => ok({ synced: 0 })),
    syncCached: makeHandler('syncCached', async () => ok([
      { platform: 'wechat_mp', articles: 32, views: 12500, comments: 89, followers: 1500, error: null },
      { platform: 'douyin', articles: 28, views: 89000, comments: 567, followers: 3200, error: null },
      { platform: 'xiaohongshu', articles: 24, views: 45000, comments: 378, followers: 2800, error: null },
      { platform: 'zhihu', articles: 18, views: 34000, comments: 234, followers: 1100, error: null },
      { platform: 'weibo', articles: 22, views: 22000, comments: 145, followers: 900, error: null },
      { platform: 'bilibili', articles: 12, views: 56000, comments: 412, followers: 1800, error: null }
    ])),

    // 通知
    showNotification: makeHandler('showNotification', async () => ok(true)),
    onNotification: makeOn('notification'),

    // pageManager（应用内浏览器标签栏，嵌套对象；替代原分屏监控 webview:* API）
    pageManager: {
      createNewTabPage: makeHandler('pageManagerCreateNewTabPage', async (opts) => ok({ tabId: 'btab_' + Date.now() })),
      closeTab: makeHandler('pageManagerCloseTab', async () => ok(true)),
      switchToTab: makeHandler('pageManagerSwitchTab', async () => ok(true)),
      // 查询类返回空态：视觉测试（复用本 mock）依赖 tabStore 空态渲染（与无 pageManager 时代一致），
      // 若返回 home 标签会让 NavBar/导航状态出现，造成全页像素位移（见 QG Visual create-editor/dashboard 失配）
      getAllTabs: makeHandler('pageManagerGetAllTabs', async () => ok([])),
      getActiveTab: makeHandler('pageManagerGetActiveTab', async () => ok(null)),
      getHomeTab: makeHandler('pageManagerGetHomeTab', async () => ok({ tabId: 'home', url: '', title: '首页', loading: false, canGoBack: false, canGoForward: false })),
      navigate: makeHandler('pageManagerNavigate', async () => ok(true)),
      goBack: makeHandler('pageManagerGoBack', async () => ok(true)),
      goForward: makeHandler('pageManagerGoForward', async () => ok(true)),
      reload: makeHandler('pageManagerReload', async () => ok(true)),
      searchOrNavigate: makeHandler('pageManagerSearchOrNavigate', async () => ok(true)),
      subscribeEvents: makeHandler('pageManagerSubscribeEvents', async () => ok({ subscriberId: 'e2e-mock' })),
      unsubscribeEvents: makeHandler('pageManagerUnsubscribeEvents', async () => ok(true)),
      setSidebarWidth: makeHandler('pageManagerSetSidebarWidth', async () => ok(true)),
      saveCookies: makeHandler('pageManagerSaveCookies', async () => ok(true)),
      onTabEvent: (event, cb) => { void cb; return () => {}; },
      on: (event, cb) => { void cb; return () => {}; },
      onNavigationChanged: (cb) => { void cb; return () => {}; }
    },

    // 回调服务器
    onCallbackReceived: makeOn('callback:received'),

    // 离线
    offlineStatus: makeHandler('offlineStatus', async () => ok({
      offline: state.offline,
      cachedCount: 0,
      cachedTasks: [],
    })),
    offlineIsOffline: makeHandler('offlineIsOffline', async () => ok(state.offline)),
    offlineCachedTasks: makeHandler('offlineCachedTasks', async () => ok([])),
    offlineAddToCache: makeHandler('offlineAddToCache', async () => ok(true)),
    offlineClearCache: makeHandler('offlineClearCache', async () => ok(true)),
    onOfflineRestored: makeOn('offline:restored'),

    // Onboarding
    onboardingComplete: makeHandler('onboardingComplete', async () => ok(true)),
    onboardingGetSteps: makeHandler('onboardingGetSteps', async () => ok([])),
    onboardingStatus: makeHandler('onboardingStatus', async () => ok({ completed: true })),

    // 支付
    paymentCreateOrder: makeHandler('paymentCreateOrder', async () => ok({ orderId: 'mock_order' })),
    paymentListOrders: makeHandler('paymentListOrders', async () => ok([])),
    paymentGetOrder: makeHandler('paymentGetOrder', async () => ok(null)),
    paymentComplete: makeHandler('paymentComplete', async () => ok({ success: true })),
    paymentSimulate: makeHandler('paymentSimulate', async () => ok({ success: true })),
    paymentCancel: makeHandler('paymentCancel', async () => ok(true)),

    // 全局导航
    onNavigate: makeOn('app:navigate'),

    // Analytics
    analyticsOverview: makeHandler('analyticsOverview', async () => ok(state.stats)),
    analyticsPlatform: makeHandler('analyticsPlatform', async (p) => ok({ platform: p, total: 10, success: 9, failed: 1, articles: 5, views: 1000, comments: 30, followers: 200 })),
    analyticsPlatforms: makeHandler('analyticsPlatforms', async () => ok([
      { platform: 'wechat_mp', articles: 32, views: 12500, comments: 89, followers: 1500, error: null },
      { platform: 'douyin', articles: 28, views: 89000, comments: 567, followers: 3200, error: null },
      { platform: 'xiaohongshu', articles: 24, views: 45000, comments: 378, followers: 2800, error: null },
      { platform: 'zhihu', articles: 18, views: 34000, comments: 234, followers: 1100, error: null },
      { platform: 'weibo', articles: 22, views: 22000, comments: 145, followers: 900, error: null },
      { platform: 'bilibili', articles: 12, views: 56000, comments: 412, followers: 1800, error: null }
    ])),

    // Hotkeys
    hotkeysList: makeHandler('hotkeysList', async () => ok([])),

    // 关键词
    keywordStart: makeHandler('keywordStart', async (kw) => ok({ keyword: kw && (kw.keyword || kw), running: true })),
    keywordStop: makeHandler('keywordStop', async () => ok(true)),
    keywordStatus: makeHandler('keywordStatus', async () => ok([
      { keyword: 'AI 创作', running: true, lastChecked: new Date().toISOString(), samples: 12 }
    ])),
    keywordHistory: makeHandler('keywordHistory', async () => ok([
      { checkedAt: new Date().toISOString(), totalMentions: 128, topEngagement: 86 }
    ])),
    keywordStopAll: makeHandler('keywordStopAll', async () => ok(true)),

    // 代理
    proxyAdd: makeHandler('proxyAdd', async () => ok({ id: 'px_1' })),
    proxyAddBatch: makeHandler('proxyAddBatch', async () => ok({ added: 0 })),
    proxyList: makeHandler('proxyList', async () => ok([])),
    proxyRemove: makeHandler('proxyRemove', async () => ok(true)),
    proxyTest: makeHandler('proxyTest', async () => ok({ latency: 100, ok: true })),
    proxyTestAll: makeHandler('proxyTestAll', async () => ok({ ok: 0, failed: 0 })),
    proxyStatus: makeHandler('proxyStatus', async () => ok({ available: 0, total: 0 })),
    proxyGetNext: makeHandler('proxyGetNext', async () => ok(null)),
    proxyReset: makeHandler('proxyReset', async () => ok(true)),
    proxyRemoveDead: makeHandler('proxyRemoveDead', async () => ok({ removed: 0 })),

    // 上传
    uploadChunked: makeHandler('uploadChunked', async () => ok({ url: 'https://mock.test/upload' })),
    uploadCancel: makeHandler('uploadCancel', async () => ok(true)),

    // 模板
    templateList: makeHandler('templateList', async () => ok([])),
    templateGet: makeHandler('templateGet', async () => ok(null)),
    templateAdd: makeHandler('templateAdd', async (t) => ok({ id: 'tpl_' + Date.now(), ...t })),
    templateUpdate: makeHandler('templateUpdate', async () => ok(true)),
    templateDelete: makeHandler('templateDelete', async () => ok(true)),
    templateListByCategory: makeHandler('templateListByCategory', async () => ok([])),
    templateGetPresets: makeHandler('templateGetPresets', async () => ok([])),

    // 许可证
    licenseInfo: makeHandler('licenseInfo', async () => ok(state.licensed)),
    licenseActivate: makeHandler('licenseActivate', async (key) => {
      if (!key) return fail('激活码不能为空');
      state.licensed = { isPro: true, trial: false, key };
      return ok(state.licensed);
    }),
    licenseDeactivate: makeHandler('licenseDeactivate', async () => {
      state.licensed = { isPro: false, trial: false };
      return ok(state.licensed);
    }),
    licenseActivateTrial: makeHandler('licenseActivateTrial', async () => {
      state.licensed = { isPro: false, trial: true, trialDaysLeft: 7 };
      return ok(state.licensed);
    }),
    licenseHasFeature: makeHandler('licenseHasFeature', async () => ok(state.licensed.isPro || state.licensed.trial)),
    licenseFeatures: makeHandler('licenseFeatures', async () => ok(['basic_publish', 'ai_writer', 'analytics'])),

    // Provider
    providerList: makeHandler('providerList', async () => ok(state.providers)),
    providerCreate: makeHandler('providerCreate', async (data) => ok({ id: 'custom_' + Date.now(), ...data })),
    providerUpdate: makeHandler('providerUpdate', async (name, data) => ok({ name, ...data })),
    providerDelete: makeHandler('providerDelete', async () => ok(true)),
    providerTest: makeHandler('providerTest', async () => ok({ ok: true, latency: 120 })),
    providerListUser: makeHandler('providerListUser', async () => ok([])),
    providerGetUser: makeHandler('providerGetUser', async () => ok(null)),
    providerSetUserKey: makeHandler('providerSetUserKey', async (name) => ok({ name, configured: true })),
    providerDeleteUserKey: makeHandler('providerDeleteUserKey', async () => ok(true)),

    // AI
    aiListProviders: makeHandler('aiListProviders', async (type) => ok(state.providers.filter(function (p) { return !type || p.category === type; }))),
    aiGetConfig: makeHandler('aiGetConfig', async () => ok({})),
    aiListModels: makeHandler('aiListModels', async () => ok(['gpt-4', 'gpt-3.5-turbo'])),
    aiGenerate: makeHandler('aiGenerate', async (typeOrOptions) => {
      const type = typeof typeOrOptions === 'string' ? typeOrOptions : (typeOrOptions && typeOrOptions.type);
      return ok({ text: 'AI 生成的 ' + (type || 'content') + ' 内容（mock）', content: 'AI 生成的内容（mock）', tokens: 42 });
    }),
    aiTestConnection: makeHandler('aiTestConnection', async () => ok({ ok: true, latency: 80 })),
    aiSaveConfig: makeHandler('aiSaveConfig', async () => ok(true)),
    aiIsConfigured: makeHandler('aiIsConfigured', async () => ok(true)),
    aiGenerateTitles: makeHandler('aiGenerateTitles', async () => ok(['标题1', '标题2', '标题3'])),
    aiEnhanceContent: makeHandler('aiEnhanceContent', async () => ok('润色后的内容')),
    aiGenerateSummary: makeHandler('aiGenerateSummary', async () => ok('内容摘要')),
    onAIProgress: makeOn('ai:progress'),
    onAIComplete: makeOn('ai:complete'),
    onAIError: makeOn('ai:error'),

    // 模型服务商
    modelProviderList: makeHandler('modelProviderList', async (cat) => ok(state.providers.filter(function (p) { return !cat || p.category === cat; }))),
    modelProviderGet: makeHandler('modelProviderGet', async (id) => ok(state.providers.find(function (p) { return p.id === id; }) || null)),
    modelProviderCreate: makeHandler('modelProviderCreate', async (data) => {
      const id = 'custom_' + Date.now();
      const now = new Date().toISOString();
      const created = Object.assign({ id, is_preset: false, is_default: false, is_configured: true, created_at: now, updated_at: now }, data);
      state.providers.push(created);
      return ok(created);
    }),
    modelProviderUpdate: makeHandler('modelProviderUpdate', async (id, data) => {
      const idx = state.providers.findIndex(function (p) { return p.id === id; });
      if (idx >= 0) {
        state.providers[idx] = Object.assign({}, state.providers[idx], data);
        return ok(state.providers[idx]);
      }
      return fail('not found');
    }),
    modelProviderDelete: makeHandler('modelProviderDelete', async (id) => {
      state.providers = state.providers.filter(function (p) { return p.id !== id; });
      return ok(true);
    }),
    modelProviderSetDefault: makeHandler('modelProviderSetDefault', async (cat, id) => {
      state.providers.forEach(function (p) { if (p.category === cat) p.is_default = (p.id === id); });
      state.providerDefaults[cat] = id;
      return ok({ category: cat, id });
    }),
    modelProviderGetDefault: makeHandler('modelProviderGetDefault', async (cat) => ok(state.providers.find(function (p) { return p.id === state.providerDefaults[cat]; }) || null)),
    modelProviderTest: makeHandler('modelProviderTest', async () => ok({ ok: true, latency: 95, model: 'gpt-4' })),
    modelProviderPresets: makeHandler('modelProviderPresets', async (cat) => ok(state.providers.filter(function (p) { return p.is_preset && (!cat || p.category === cat); }))),
    modelProviderIsConfigured: makeHandler('modelProviderIsConfigured', async (cat) => ok(state.providerDefaults[cat] != null)),

    // 视频
    videoStatus: makeHandler('videoStatus', async () => ok({ ready: true })),
    videoListProcessTypes: makeHandler('videoListProcessTypes', async () => ok(['cut', 'merge', 'subtitle'])),
    videoListAnalyzeTypes: makeHandler('videoListAnalyzeTypes', async () => ok(['scene', 'object'])),
    videoListStockSources: makeHandler('videoListStockSources', async () => ok(['pexels', 'pixabay'])),
    videoProcess: makeHandler('videoProcess', async () => ok({ taskId: 'vt_' + Date.now() })),
    videoAnalyze: makeHandler('videoAnalyze', async () => ok({ result: {} })),
    videoMixAudio: makeHandler('videoMixAudio', async () => ok({ output: '/mock/output.mp4' })),
    videoSearchStock: makeHandler('videoSearchStock', async () => ok([])),
    videoGenerateSubtitle: makeHandler('videoGenerateSubtitle', async () => ok({ srt: '' })),
    onVideoProgress: makeOn('video:progress'),
    onVideoComplete: makeOn('video:complete'),
    onVideoError: makeOn('video:error'),

    // 批量发布
    batchCreate: makeHandler('batchCreate', async (b) => ok({ id: 'batch_' + Date.now(), ...b })),
    batchExecute: makeHandler('batchExecute', async () => ok(true)),
    batchSchedule: makeHandler('batchSchedule', async () => ok(true)),
    batchList: makeHandler('batchList', async () => ok([])),
    batchGet: makeHandler('batchGet', async () => ok(null)),
    batchDelete: makeHandler('batchDelete', async () => ok(true)),
    batchDuplicateArticle: makeHandler('batchDuplicateArticle', async (a) => ok({ id: 'dup_' + Date.now(), ...a })),
    onBatchProgress: makeOn('batch:progress'),

    // 发布
    publishWechat: makeHandler('publishWechat', async () => ok({ success: true, message: '已发布到微信公众号', url: 'https://mock.weixin/test' })),
    publishBatch: makeHandler('publishBatch', async () => ok({ success: true, results: [], message: '批量发布成功' })),
    listAccounts: makeHandler('listAccounts', async () => ok(state.accounts)),

    // 渲染
    renderStart: makeHandler('renderStart', async () => ok({ taskId: 'rt_' + Date.now() })),
    renderCancel: makeHandler('renderCancel', async () => ok(true)),
    renderGetStatus: makeHandler('renderGetStatus', async () => ok({ ready: true, composerExists: true, nodeModulesExist: true, progress: 0, status: 'idle' })),
    renderInstallDeps: makeHandler('renderInstallDeps', async () => ok({ installed: true, log: '依赖安装完成（mock）' })),
    onRenderProgress: makeOn('render:progress'),
    onRenderComplete: makeOn('render:complete'),
    onRenderError: makeOn('render:error'),
    onRenderInstallProgress: makeOn('render:install-progress'),
    renderListCompositions: makeHandler('renderListCompositions', async () => ok([])),
    renderGetComposition: makeHandler('renderGetComposition', async () => ok(null)),
    renderValidateProps: makeHandler('renderValidateProps', async () => ok({ valid: true })),

    // 流水线
    pipelines: pipelinesObj,
    // 与 electron/services/pipeline-engine.js 的 PIPELINES/listPipelines 对齐：
    // 14 条内置流水线（CreateView 额外插入 video-clone 与 film-engineering → 卡片共 16），story2video-compose（故事讲述）优先，screen-demo 无真实引擎标记 available=false。
    pipelineList: makeHandler('pipelineList', async () => ok([
      { name: 'story2video-compose', description: '将文案自动生成图片轮播视频（可选 AI 视频混合）', category: 'generated', stageCount: 7, estimatedCost: 'medium', available: true, stages: ['split', 'scene_context', 'optimize', 'select_video_scenes', 'generate_assets', 'compose', 'publish'] },
      { name: 'animated-explainer', description: '从主题或创意自动生成完整讲解视频', category: 'generated', stageCount: 8, estimatedCost: 'medium', available: true, stages: ['research', 'proposal', 'script', 'scenes', 'assets', 'editing', 'compose', 'publish'] },
      { name: 'talking-head', description: '上传视频和文案，生成带字幕的口播视频', category: 'talking_head', stageCount: 4, estimatedCost: 'low', available: true, stages: ['upload', 'transcribe', 'captions', 'render'] },
      { name: 'cinematic', description: '将素材视频渲染成电影感短片', category: 'cinematic', stageCount: 4, estimatedCost: 'low', available: true, stages: ['ingest', 'grade', 'compose', 'render'] },
      { name: 'animation', description: '使用 AI 生成动画序列', category: 'animation', stageCount: 4, estimatedCost: 'high', available: true, stages: ['concept', 'storyboard', 'animate', 'render'] },
      { name: 'avatar-spokesperson', description: '使用数字人生成口播视频', category: 'talking_head', stageCount: 4, estimatedCost: 'high', available: true, stages: ['avatar_select', 'script', 'generate', 'render'] },
      { name: 'character-animation', description: '使用 AI 驱动角色表演', category: 'animation', stageCount: 4, estimatedCost: 'high', available: true, stages: ['character_design', 'rigging', 'animate', 'render'] },
      { name: 'clip-factory', description: '从长视频自动提取精彩片段', category: 'screen_recording', stageCount: 4, estimatedCost: 'low', available: true, stages: ['analyze', 'extract', 'caption', 'export'] },
      { name: 'documentary-montage', description: '以纪录片风格编辑素材', category: 'cinematic', stageCount: 5, estimatedCost: 'medium', available: true, stages: ['research', 'ingest', 'edit', 'narrate', 'render'] },
      { name: 'hybrid', description: '混合 AI 生成内容与实拍素材', category: 'hybrid', stageCount: 4, estimatedCost: 'high', available: true, stages: ['plan', 'generate', 'merge', 'render'] },
      { name: 'localization-dub', description: '翻译视频并生成多语言配音', category: 'hybrid', stageCount: 4, estimatedCost: 'medium', available: true, stages: ['transcribe', 'translate', 'tts', 'sync'] },
      { name: 'podcast-repurpose', description: '将音频播客转为可视化视频', category: 'hybrid', stageCount: 4, estimatedCost: 'medium', available: true, stages: ['analyze', 'visualize', 'assemble', 'render'] },
      { name: 'framework-smoke', description: '快速验证流水线配置', category: 'custom', stageCount: 2, estimatedCost: 'low', available: true, stages: ['verify', 'report'] },
      { name: 'screen-demo', description: '录制屏幕操作并自动添加标注', category: 'screen_recording', stageCount: 3, estimatedCost: 'low', available: false, stages: ['record', 'annotate', 'render'] }
    ])),
    pipelineGet: makeHandler('pipelineGet', async () => ok(null)),
    pipelineStart: makeHandler('pipelineStart', async (name) => ok({ started: true, pipelineName: name })),
    pipelineStartOrchestrated: makeHandler('pipelineStartOrchestrated', async (name) => ok({ runId: 'e2e-' + (name || 'story2video-compose') + '-run', status: 'running' })),
    pipelineGetRunContext: makeHandler('pipelineGetRunContext', async () => ok({
      context: { story2videoProject: { projectId: 'e2e-story2video-project' } },
      status: { status: 'running', progress: 10 },
    })),
    pipelineConfirmSceneAssets: makeHandler('pipelineConfirmSceneAssets', async (runId, selections) => ok({
      success: true, runId: runId || 'e2e-run', selections: Array.isArray(selections) ? selections.length : 0,
    })),
    pipelinePause: makeHandler('pipelinePause', async () => ok(true)),
    pipelineResume: makeHandler('pipelineResume', async () => ok(true)),
    pipelineCancel: makeHandler('pipelineCancel', async () => ok(true)),
    pipelineStatus: makeHandler('pipelineStatus', async () => ok({ status: 'idle' })),
    pipelineAdvance: makeHandler('pipelineAdvance', async () => ok(true)),
    pipelineHistory: makeHandler('pipelineHistory', async () => ok([
      {
        id: 'e2e-story2video-project',
        projectId: 'e2e-story2video-project',
        pipeline: 'story2video-compose',
        status: 'completed',
        createdAt: '2026-07-10T10:00:00Z',
        updatedAt: '2026-07-10T10:05:00Z',
        endedAt: '2026-07-10T10:05:00Z',
        activeMs: 300000,
        stages: [{ name: 'split', status: 'completed' }, { name: 'compose', status: 'completed' }],
      }
    ])),
    pipelineFetch: makeHandler('pipelineFetch', async () => ok(null)),
    story2videoListProjects: makeHandler('story2videoListProjects', async () => ok(state.story2videoProjects)),
    story2videoGetProject: makeHandler('story2videoGetProject', async (projectId) => {
      const project = state.story2videoProjects.find(item => item.projectId === projectId)
      return project ? ok(project) : fail('项目不存在')
    }),
    story2videoDeleteProject: makeHandler('story2videoDeleteProject', async (projectId) => {
      state.story2videoProjects = state.story2videoProjects.filter(item => item.projectId !== projectId)
      return ok(true)
    }),

    // Story2Video 媒体导入（preload 桥接：getPathForFile 返回字符串，导入通道返回 { code, data: { path } }）
    getPathForFile: () => 'C:/mock/e2e-video.mp4',
    story2videoImportMedia: makeHandler('story2videoImportMedia', async (file, kind) => ok({ path: 'C:/mock/e2e-imported.' + (kind === 'video' ? 'mp4' : 'wav'), originalName: (file && file.name) || 'e2e-file' })),
    story2videoImportMediaPath: makeHandler('story2videoImportMediaPath', async (filePath, kind) => ok({ path: 'C:/mock/e2e-imported.' + (kind === 'video' ? 'mp4' : 'wav'), originalName: 'e2e.mp4' })),

    // BGM 素材库（2026-08-14）：列表/添加/重命名/删除，路径须落在媒体白名单内
    story2videoBgmLibraryList: makeHandler('story2videoBgmLibraryList', async () => ok([
      { id: 'e2e-bgm-1', name: 'E2E 背景音乐', path: 'C:/mock/e2e-bgm-1.mp3' },
    ])),
    story2videoBgmLibraryAdd: makeHandler('story2videoBgmLibraryAdd', async ({ filePath }) => ok({ id: 'e2e-bgm-new', name: 'e2e-bgm-new', path: filePath || 'C:/mock/e2e-bgm-new.mp3' })),
    story2videoBgmLibraryRename: makeHandler('story2videoBgmLibraryRename', async ({ id, name }) => ok({ id, name })),
    story2videoBgmLibraryDelete: makeHandler('story2videoBgmLibraryDelete', async ({ id }) => ok({ deleted: true, id })),

    // 内容情报
    intelligenceSuggestTags: makeHandler('intelligenceSuggestTags', async () => ok(['AI', '内容', '运营'])),
    intelligenceGetOptimalTime: makeHandler('intelligenceGetOptimalTime', async () => ok({ hour: 10, weekday: 3 })),
    intelligenceSearch: makeHandler('intelligenceSearch', async (query) => ok({
      total: 2,
      timestamp: new Date().toISOString(),
      results: [
        { id: 'intel_1', source: 'reddit', author: 'mock-user', title: query + ' 热门讨论', url: 'https://example.com/reddit', snippet: '跨平台高互动内容示例', upvotes: 268, comments: 42, engagement: 88.6 },
        { id: 'intel_2', source: 'github', author: 'mock-org', title: query + ' 开源趋势', url: 'https://example.com/github', snippet: '相关开源项目趋势示例', upvotes: 156, comments: 18, engagement: 76.2 }
      ]
    })),
    intelligenceSearchTitles: makeHandler('intelligenceSearchTitles', async () => ok({
      titleAnalysis: { patterns: [['AI', 5], ['效率', 3]], suggestion: { tip: '标题中加入明确收益与数字' } }
    })),
    intelligenceFetchTrending: makeHandler('intelligenceFetchTrending', async () => ok([])),
    intelligenceFindReferences: makeHandler('intelligenceFindReferences', async () => ok([])),
    intelligenceGetBenchmark: makeHandler('intelligenceGetBenchmark', async () => ok({
          benchmark: {
            sampleSize: 12,
            engagement: { avg: 65.4, median: 50, top10: 120, top25: 80 },
            upvotes: { avg: 320, median: 220, top10: 900 },
            comments: { avg: 28, median: 18, top10: 80 },
            topSources: ['中产家庭', '一线城市', '新中产'],
            generatedAt: '2026-07-12 10:00'
          },
          message: '基于 12 条同类内容'
        })),

    // 队列
    getQueueStatus: makeHandler('getQueueStatus', async () => ok({ running: 0, pending: 0 })),
    getQueueHistory: makeHandler('getQueueHistory', async () => ok([])),
    cancelTask: makeHandler('cancelTask', async () => ok(true)),

    // 历史
    historyList: makeHandler('historyList', async () => ok({ records: state.publishHistory, total: state.publishHistory.length })),
    historyGet: makeHandler('historyGet', async (id) => ok(state.publishHistory.find(function (h) { return h.id === id; }) || null)),

    // 看板
    dashboardStats: makeHandler('dashboardStats', async () => ok(Object.assign({}, state.stats, {
      successRate: state.stats.total ? Math.round(state.stats.success / state.stats.total * 100) : 0,
      daily: Array.from({ length: 14 }, function (_, i) { return { date: '2026-07-' + String(i + 1).padStart(2, '0'), total: i + 3 }; }),
      perPlatform: Object.keys(state.stats.byPlatform || {}).reduce(function (all, platform) {
        all[platform] = { total: state.stats.byPlatform[platform] };
        return all;
      }, {})
    }))),

    // 定时
    schedulerCreate: makeHandler('schedulerCreate', async (s) => ok({ id: 'sched_' + Date.now(), ...s })),
    schedulerList: makeHandler('schedulerList', async () => ok(state.schedulerTasks)),
    schedulerCancel: makeHandler('schedulerCancel', async () => ok(true)),

    onProgress: makeOn('publish:progress'),

    // 云发布
    cloudPublishSubmit: makeHandler('cloudPublishSubmit', async (input) => ok({ task_id: 'cpt_' + Date.now(), status: 'pending', input_data: input })),
    cloudPublishListTasks: makeHandler('cloudPublishListTasks', async () => ok({
      items: [{ id: 'cloud_001', status: 'completed', input_data: { platform: 'bilibili', title: 'E2E 云发布记录' }, created_at: '2026-07-11T10:00:00Z' }],
      total: 1
    })),
    cloudPublishGetTask: makeHandler('cloudPublishGetTask', async (id) => ok({ id, status: 'completed' })),
    cloudPublishPlatforms: makeHandler('cloudPublishPlatforms', async () => ok([
      { id: 'weibo', name: '微博' },
      { id: 'douyin', name: '抖音' },
      { id: 'wechat_mp', name: '微信公众号' },
      { id: 'bilibili', name: 'B站' }
    ])),

    // URL Collect
    urlCollectFetch: makeHandler('urlCollectFetch', async () => ok({
      url: 'https://mock',
      title: '采集的标题',
      description: '采集的内容摘要',
      content: '采集的内容',
      coverImage: 'https://mock.test/cover.jpg',
      images: ['https://mock.test/cover.jpg'],
      ogMeta: {}
    })),

    // Viral
    viralAnalyze: makeHandler('viralAnalyze', async () => ok({
      overall_score: 78,
      trend_direction: 'rising',
      suggested_angles: ['效率提升', '真实案例', '工具对比'],
      factors: [{ name: 'emotion', label: '情绪共鸣', score: 0.82 }, { name: 'utility', label: '实用价值', score: 0.76 }],
      platform_scores: { '小红书': 82.5, '抖音': 76.0 },
      suggested_structures: [{ structure: '数字 + 收益', expected_lift: '18%' }],
      rising_keywords: [{ word: 'AI创作' }, { word: '效率工具' }]
    })),
    viralGenerate: makeHandler('viralGenerate', async (options) => ok({
      task: (options && options.task) || 'titles',
      data: { titles: [
        { title: '5 个 AI 工具让内容效率翻倍', structure: '数字清单', emotion: '惊喜', predicted_score: 89, reasoning: '收益明确' },
        { title: '内容创作者都在用的 AI 工作流', structure: '趋势', emotion: '好奇', predicted_score: 84, reasoning: '贴近目标用户' }
      ] }
    })),
    viralTrending: makeHandler('viralTrending', async () => ok([])),

    // 评论
    commentList: makeHandler('commentList', async () => ok(state.comments)),
    commentReply: makeHandler('commentReply', async () => ok({ success: true, replyId: 'r_' + Date.now() })),
    commentStartPolling: makeHandler('commentStartPolling', async () => ok({ running: true })),
    commentStopPolling: makeHandler('commentStopPolling', async () => ok(true)),
    commentStatus: makeHandler('commentStatus', async () => ok({ running: 0 })),
    onCommentReplied: makeOn('comment:replied'),

    // 账号管理
    accountAdd: makeHandler('accountAdd', async (platform) => {
      const id = 'acc_' + platform + '_' + Date.now();
      const acc = { id, platform, name: '测试' + platform, is_default: false, status: 'online', created_at: new Date().toISOString() };
      state.accounts.push(acc);
      return ok(acc);
    }),
    accountDelete: makeHandler('accountDelete', async (accountId) => {
      state.accounts = state.accounts.filter(function (a) { return a.id !== accountId; });
      return ok(true);
    }),
    accountCheckLogin: makeHandler('accountCheckLogin', async (p) => ok({ platform: p, loggedIn: true, valid: true, message: '登录有效' })),
    accountList: makeHandler('accountList', async () => ok(state.accounts)),
    accountSetDefault: makeHandler('accountSetDefault', async (platform, accountId) => {
      state.accounts.forEach(function (a) {
        if (a.platform === platform) a.is_default = (a.id === accountId);
      });
      return ok(true);
    }),
    accountGetDefault: makeHandler('accountGetDefault', async (platform) => {
      return ok(state.accounts.find(function (a) { return a.platform === platform && a.is_default; }) || null);
    }),
    accountUpdate: makeHandler('accountUpdate', async (id, fields) => {
      const idx = state.accounts.findIndex(function (a) { return a.id === id; });
      if (idx >= 0) {
        state.accounts[idx] = Object.assign({}, state.accounts[idx], fields);
        return ok(state.accounts[idx]);
      }
      return fail('not found');
    }),

    // 身份（Logto）预置登录态：E2E 需要登录的功能（流水线启动/发布等）依赖 authenticated 状态；
    // 未预置时 identityStore 为 error/disabled，主动操作登录门（useLoginGate）会拦截启动。
    identityGetState: makeHandler('identityGetState', async () => ok({
      status: 'authenticated',
      user: { sub: 'e2e-user', name: 'E2E 用户', username: 'e2e', picture: '' },
      entitlement: {
        plan: 'pro',
        features: [
          'cloud_publish', 'ai_writer', 'publish_history', 'pipeline_run',
          'video_process', 'story2video_write', 'model_provider_write',
        ],
        source: 'online',
      },
      error: null,
    })),
    identitySignIn: makeHandler('identitySignIn', async () => ok({
      status: 'authenticated',
      user: { sub: 'e2e-user', name: 'E2E 用户', username: 'e2e', picture: '' },
      entitlement: { plan: 'pro', features: [], source: 'online' },
      error: null,
    })),
    identitySignOut: makeHandler('identitySignOut', async () => ok({ status: 'signed_out', user: null })),
    onIdentityStateChanged: makeOn('identity:state-changed'),

    // 嵌入浏览器登录
    authOpenLogin: makeHandler('authOpenLogin', async (platform) => ok({ opened: true, platform })),
    authClose: makeHandler('authClose', async () => ok(true)),
    onAuthViewOpened: makeOn('auth:view-opened'),
    onAuthCompleted: makeOn('auth:completed'),
    onAuthViewClosed: makeOn('auth:view-closed'),
    authLoginSilent: makeHandler('authLoginSilent', async (platform, accountId) => ok({ success: true, platform, accountId })),

    // QR 扫码登录
    authOpenQrCodeLogin: makeHandler('authOpenQrCodeLogin', async (p) => ok({ opened: true, platform: p })),
    authQrCodeClose: makeHandler('authQrCodeClose', async () => ok(true)),
    onQrCodeOpened: makeOn('qrcode:opened'),
    onQrCodeDetected: makeOn('qrcode:detected'),
    onQrCodeCompleted: makeOn('qrcode:completed'),
    onQrCodeClosed: makeOn('qrcode:closed'),

    // OAuth
    oauthStart: makeHandler('oauthStart', async () => ok({ started: true })),
    oauthClose: makeHandler('oauthClose', async () => ok(true)),
    oauthGetConfigs: makeHandler('oauthGetConfigs', async () => ok([])),
    onOAuthOpened: makeOn('oauth:opened'),
    onOAuthCompleted: makeOn('oauth:completed'),
    onOAuthFailed: makeOn('oauth:failed'),
    onOAuthClosed: makeOn('oauth:closed'),

    // 统一存储（注意：preload 调用 storeListAccounts 不带 platform 参数，
    //  与 accountList 行为一致；带 platform 时按平台过滤）
    storeAddAccount: makeHandler('storeAddAccount', async (a) => {
      const id = a.id || ('store_acc_' + Date.now());
      const acc = Object.assign({ id, created_at: new Date().toISOString(), is_default: false, status: 'active' }, a);
      state.accounts.push(acc);
      return ok(acc);
    }),
    storeGetAccount: makeHandler('storeGetAccount', async (id) => ok(state.accounts.find(function (a) { return a.id === id; }) || null)),
    storeListAccounts: makeHandler('storeListAccounts', async (platform) => ok(platform ? state.accounts.filter(function (a) { return a.platform === platform; }) : state.accounts)),
    storeDeleteAccount: makeHandler('storeDeleteAccount', async (id) => {
      state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
      return ok(true);
    }),
    storeAddPublishRecord: makeHandler('storeAddPublishRecord', async (r) => {
      const rec = Object.assign({ id: 'rec_' + Date.now(), publishedAt: new Date().toISOString() }, r);
      state.publishHistory.unshift(rec);
      return ok(rec);
    }),
    storeListPublishHistory: makeHandler('storeListPublishHistory', async () => ok({
      records: state.publishHistory.map(function (item, index) {
        return Object.assign({ composition: item.title || ('视频 ' + (index + 1)), outputPath: 'C:/mock/video-' + (index + 1) + '.mp4', completedAt: item.publishedAt, createdAt: item.publishedAt }, item);
      }),
      total: state.publishHistory.length
    })),
    storeGetPublishStats: makeHandler('storeGetPublishStats', async () => ok(state.stats)),
    storeAddScheduledTask: makeHandler('storeAddScheduledTask', async (t) => {
      const task = Object.assign({ id: 'st_' + Date.now(), status: 'pending' }, t);
      state.schedulerTasks.push(task);
      return ok(task);
    }),
    storeListScheduledTasks: makeHandler('storeListScheduledTasks', async () => ok(state.schedulerTasks)),
    storeDeleteTask: makeHandler('storeDeleteTask', async (id) => {
      state.schedulerTasks = state.schedulerTasks.filter(function (t) { return t.id !== id; });
      return ok(true);
    }),
    storeGetSetting: makeHandler('storeGetSetting', async (key) => ok({
      'drafts': JSON.stringify(state.articles),
      'default_llm': 'preset_openai',
      'theme': 'light'
    }[key] || null)),
    storeSetSetting: makeHandler('storeSetSetting', async () => ok(true)),
    storeListCallbackLogs: makeHandler('storeListCallbackLogs', async () => ok([]))
  };

  // 暴露到 window
  window.electronAPI = api;
  // 暴露 fixture 状态访问器（测试中可读取真实数据）
  window.__mockState = state;
  // 模拟离线模式
  window.__setOffline = function (v) { state.offline = !!v; };
  // 模拟激活 Pro
  window.__setPro = function (v) { state.licensed.isPro = !!v; };
  // 重置 mock store（测试间隔离）
  window.__resetMock = function () {
    window.__ipcCalls = [];
    window.__ipcCallsByMethod = {};
    window.__ipcFailNextCall = null;
    window.__ipcFailAllForMethod = null;
    state.offline = false;
  };
  // 触发下一次 IPC 调用失败
  window.__failNext = function (method, message, code) {
    window.__ipcFailNextCall = { method, message: message || 'mocked failure', code: code || -1 };
  };
})();
