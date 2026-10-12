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
    return createCreatorCollector({
      credentialProvider: () => {
        if (!provider || typeof provider.getApiKey !== 'function') return null;
        const apiKey = provider.getApiKey();
        return apiKey ? { apiKey, pythonBridge } : null;
      },
      log: c.get('logger'),
    });
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
