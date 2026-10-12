'use strict';

/**
 * Container setup 分片：博主监控与采集（2026-10-07，PRD-CREATOR-MONITOR-COLLECT）
 *
 * 为什么从 container.setup.js 拆出来：
 *   装配这几项需要 20+ 行注释与依赖串接，顶上去会让 container.setup.js 撞上
 *   check-max-lines 的 500 行硬限（NEW_OVER_LIMIT，新代码不得引入超大文件）。
 *   仓库对这条红线的既定处方是「拆兄弟模块」而不是 `--update` 挂账——
 *   挂账等于承认「接受漂移」，而这个文件是全仓所有主进程服务的注册总表，
 *   让它无限增长只会把真正的结构问题藏进台账里。
 *
 * 装配顺序有依赖：creatorStore 需要 store，creatorCollector 需要凭证提供者，
 * creatorRuntime 依赖前两者。容器按注册顺序惰性求值，get 不到未注册名会抛，
 * 故这里显式串起来而不是让 runtime 自己去 get。
 *
 * ⛔ **2026-10-12 事故**：`creatorCollector` 的工厂里写着
 *   `credentialProvider: c.get('creatorCredentialProvider') || (() => null)`，
 *   而 `creatorCredentialProvider` **从未注册过**。容器 `get` 对未注册名是**抛错**
 *   （`container.js:78`），不是返回 undefined ⇒ 只要有人解析 `creatorCollector`，
 *   工厂就抛 ⇒ `creatorRuntime` 一并解析失败 ⇒ `ipc-handlers/creator.js` 判定依赖缺失
 *   ⇒ 11 个 creator 通道全部降级。注释里那句「可选注册项，缺省回落空实现」是意图，
 *   代码里没有兜底，两者不一致了一整个版本。本次同时补上**注册**与**兜底**：
 *   注册让它有真凭证可用，兜底让「将来又被删掉」退化成「没配 Key」而不是「整页不可用」。
 */
function registerCreatorServices(container) {
  container.register('creatorStore', function(c) {
    const { createCreatorStore } = require('../services/creator-store');
    const store = c.get('store');
    // getDb 是主路径；db 是历史字段名，两条都兜住以免 store 换实现时静默拿到 undefined
    // （undefined 会在建表时才炸，离装配点很远，排查成本高）。
    const db = typeof store.getDb === 'function' ? store.getDb() : store.db;
    return createCreatorStore(db);
  });

  // 凭证提供者（PRD-CREATOR-MONITOR-COLLECT §7.4）：safeStorage 加密存 settings，
  // 读取方向永不回传明文。必须注册在 creatorCollector **之前**（容器按注册顺序解析）。
  container.register('creatorCredentialProvider', function(c) {
    const { createCreatorCredentialProvider } = require('../services/creator-credential');
    let safeStorage;
    try {
      const electron = require('electron');
      safeStorage = (electron && electron.safeStorage) ? electron.safeStorage : null;
    } catch (_) {
      // 纯 Node（测试 / 脚本）环境没有 electron：显式传 null ⇒ 状态为 unavailable，
      // 而不是让 require 抛出去把整个容器带崩。
      safeStorage = null;
    }
    return createCreatorCredentialProvider({
      store: c.get('store'),
      safeStorage,
      log: c.get('logger'),
    });
  });

  container.register('creatorCollector', function(c) {
    const { createCreatorCollector } = require('../services/creator-collector-runtime');
    // 凭证提供者对采集器的形状是 `() => { apiKey, pythonBridge } | null`
    // （见 creator-collector-runtime 的 credentials()）。这里做**形状适配**，
    // 不是把 provider 对象直接塞进去——直接塞会被当函数调用而 TypeError。
    let provider = null;
    try {
      provider = c.get('creatorCredentialProvider');
    } catch (_) {
      provider = null; // 兜底：宁可「未配置 Key」，不要「整页不可用」
    }
    const pythonBridge = (() => {
      try { return c.get('pythonBridge'); } catch (_) { return null; }
    })();
    const youtubeCollector = createCreatorCollector({
      credentialProvider: () => {
        if (!provider || typeof provider.getApiKey !== 'function') return null;
        const apiKey = provider.getApiKey();
        return apiKey ? { apiKey, pythonBridge } : null;
      },
      log: c.get('logger'),
    });

    // ── 多平台分发（PRD-CREATOR-MULTI-PLATFORM-2026-10-12 §3）────────
    // 按 canonical ID 形态分发：UC… → youtube；MS4wLjABAAAA… → douyin；
    // 24hex → xiaohongshu。多平台腿任一依赖缺失都**不**影响 YouTube 主腿
    // （降级只发生在对应平台的调用上）。
    const { createPlatformDispatchCollector } = require('../services/creator-platform-dispatch');
    const { createMultiPlatformCollector } = require('../services/creator-adapters-web');
    const { createCreatorSessionProvider } = require('../services/creator-session-cookie');
    let accountManager = null;
    try { accountManager = c.get('accountManager'); } catch (_) { accountManager = null; }

    const sessionProvider = createCreatorSessionProvider({
      listAccounts: async () => {
        if (!accountManager || typeof accountManager.listAccounts !== 'function') return [];
        try { return await accountManager.listAccounts() || [] } catch (_) { return [] }
      },
      getAccountPartitionCookies: async (platform, accountId) => {
        const restore = require('../publishers/account-session-restore');
        if (typeof restore.getAccountPartitionCookies !== 'function') return [];
        try { return await restore.getAccountPartitionCookies(platform, accountId) || [] } catch (_) { return [] }
      },
      log: c.get('logger'),
    });

    // 签名桥：python-backend /api/creator/sign/*（xhshow + abogus，纯算法）
    const signBridge = async (platform, payload) => {
      if (!pythonBridge || typeof pythonBridge.requestBackend !== 'function') {
        const err = new Error('Python 后端未就绪，无法签名');
        err.code = 'creator:signature_failed';
        throw err;
      }
      if (platform === 'douyin') {
        const r = await pythonBridge.requestBackend('POST', '/api/creator/sign/douyin', {
          query_str: payload.query_str, user_agent: payload.user_agent || '',
        });
        return { a_bogus: (r && (r.a_bogus || (r.data && r.data.a_bogus))) || '' };
      }
      // xhs 签名只需要 a1 摘要要素（QM-6 后端评审 I1）：**不**把完整 Cookie 串发往签名服务——
      // 无 a1 时宁可签名失败（可见错误），不做「整串兜底」扩大明文流动面。
      const r = await pythonBridge.requestBackend('POST', '/api/creator/sign/xhs', {
        uri: payload.uri, a1: payload.a1 || '', method: 'GET',
      });
      if (r && (r.a1_missing || (r.data && r.data.a1_missing))) {
        const err = new Error('小红书会话缺少 a1 Cookie，无法签名');
        err.code = 'creator:signature_failed';
        throw err;
      }
      const d = (r && r.data) || r || {};
      return { x_s: d.x_s || d['x-s'] || '', x_t: d.x_t || d['x-t'] || '', x_s_common: d.x_s_common || d['x-s-common'] || '', x_b3_traceid: d.x_b3_traceid || d['x-b3-traceid'] || '' };
    };

    const multiPlatform = createMultiPlatformCollector({
      sessionProvider: (platform) => sessionProvider.getSession(platform),
      signBridge,
      httpGet: require('../services/creator-http').httpGetWithHeaders,
      log: c.get('logger'),
    });

    const dispatch = createPlatformDispatchCollector({ youtube: youtubeCollector, multiPlatform });
    // 平台状态查询挂到分发器上（creator:dependency-status 消费）
    dispatch.sessionProvider = sessionProvider;
    return dispatch;
  });

  container.register('creatorRuntime', function(c) {
    const { createCreatorRuntime } = require('../services/creator-runtime');
    return createCreatorRuntime({
      store: c.get('creatorStore'),
      collector: c.get('creatorCollector'),
      log: c.get('logger'),
    });
  });
}

module.exports = { registerCreatorServices };
