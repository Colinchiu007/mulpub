// @ts-check
/**
 * AuthView Session — 登录 Session / Cookie 管理
 *
 * 处理 Electron session 分区、Cookie 设置、localStorage 恢复。
 */

const _path = require('path')

/**
 * 创建隔离的 Session 分区
 * @param {string} accountId - 账号 ID
 * @param {{ fromPartition: Function }} sessionModule
 * @returns {import("electron").Session}
 */
function createSession(accountId, sessionModule) {
  const partition = `persist:auth-${accountId}`
  return sessionModule.fromPartition(partition, { cache: true })
}

/**
 * 设置 Cookie（支持单个或数组）
 * @param {import("electron").Session} session
 * @param {any} cookies
 */
async function setCookies(session, cookies) {
  if (!cookies || cookies.length === 0) return
  try {
    // 尝试批量设置
    await session.cookies.set(cookies)
  } catch (_e) {
    // 数组格式，逐个设置
    for (const c of cookies) {
      try { await session.cookies.set(c) } catch (_e2) { /* ignore invalid cookie */ }
    }
  }
}

/**
 * 在页面加载完成后恢复 localStorage
 * @param {import('electron').WebContentsView} view
 * @param {Record<string, string>} localStorage
 * @returns {Promise<void>}
 */
async function restoreLocalStorage(view, localStorage) {
  if (!localStorage || Object.keys(localStorage).length === 0) return
  /** @type {Promise<void>} */
  var p = new Promise((resolve) => {
    // R14 修复：增加 10s 超时，防止 did-finish-load 永不触发时 Promise 永久 pending
    var done = false
    var timer = setTimeout(() => {
      if (!done) { done = true; resolve() }
    }, 10000)
    if (timer && timer.unref) timer.unref()
    view.webContents.once('did-finish-load', async () => {
      if (done) return
      clearTimeout(timer)
      try {
        await view.webContents.executeJavaScript(`
          (function() {
            let data = ${JSON.stringify(localStorage)};
            Object.keys(data).forEach(function(k) {
              try { localStorage.setItem(k, data[k]); } catch (_e) { /* ignore */ }
            });
          })()
        `)
      } catch (_e) { /* ignore */ }
      done = true
      resolve()
    })
  })
  return p
}

function createIndexedDBRestoreScript(indexedDBData) {
  let data
  try { data = JSON.stringify(indexedDBData) } catch (_) { return null }
  if (!data || data.length > 524288) return null
  return `
    (async function() {
      const databases = ${data};
      if (!databases || typeof databases !== 'object' || !window.indexedDB) return;
      const entries = Object.entries(databases).slice(0, 8);
      await Promise.all(entries.map(([dbName, stores]) => new Promise((resolve) => {
        const storeEntries = Object.entries(stores || {}).slice(0, 16);
        const ensureStores = (db) => {
          const existing = new Set(Array.from(db.objectStoreNames));
          for (const [storeName] of storeEntries) {
            if (!existing.has(storeName)) db.createObjectStore(storeName);
          }
        };
        const openDatabase = () => new Promise((openResolve) => {
          let request;
          try { request = indexedDB.open(dbName); } catch (_) { openResolve(null); return; }
          request.onerror = () => openResolve(null);
          request.onupgradeneeded = () => {
            try { ensureStores(request.result); } catch (_) { /* ignore invalid store names */ }
          };
          request.onsuccess = (event) => {
            const db = event.target.result;
            const missing = storeEntries.some(([storeName]) => !Array.from(db.objectStoreNames).includes(storeName));
            if (!missing) { openResolve(db); return; }
            const nextVersion = db.version + 1;
            try { db.close(); } catch (_) { /* ignore */ }
            let upgradeRequest;
            try { upgradeRequest = indexedDB.open(dbName, nextVersion); } catch (_) { openResolve(null); return; }
            upgradeRequest.onerror = () => openResolve(null);
            upgradeRequest.onupgradeneeded = () => {
              try { ensureStores(upgradeRequest.result); } catch (_) { /* ignore invalid store names */ }
            };
            upgradeRequest.onsuccess = (upgradeEvent) => openResolve(upgradeEvent.target.result);
          };
        });
        openDatabase().then((db) => {
          if (!db) { resolve(); return; }
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            try { db.close(); } catch (_) { /* ignore */ }
            resolve();
          };
          if (storeEntries.length === 0) { finish(); return; }
          let remaining = storeEntries.length;
          const done = () => { remaining -= 1; if (remaining <= 0) finish(); };
          for (const [storeName, records] of storeEntries) {
            try {
              const transaction = db.transaction(storeName, 'readwrite');
              const store = transaction.objectStore(storeName);
              const recordEntries = Array.isArray(records)
                ? records
                  .filter(record => record && Object.prototype.hasOwnProperty.call(record, '__multi_publish_indexeddb_key__'))
                  .map(record => [record.__multi_publish_indexeddb_key__, record.value])
                  .slice(0, 64)
                : Object.entries(records || {}).slice(0, 64);
              for (const [key, value] of recordEntries) {
                try {
                  if (store.keyPath === null || store.keyPath === undefined) store.put(value, key);
                  else store.put(value);
                } catch (_) { /* ignore */ }
              }
              transaction.oncomplete = done;
              transaction.onerror = done;
              transaction.onabort = done;
            } catch (_) { done(); }
          }
          setTimeout(finish, 3000);
        }).catch(() => resolve());
      })));
    })()
  `
}

/**
 * 在页面加载完成后恢复 IndexedDB 快照。快照仅包含 JSON 安全值，写入失败不阻断登录。
 * @param {import('electron').WebContentsView} view
 * @param {Record<string, Record<string, Record<string, unknown>>>} indexedDBData
 * @returns {Promise<void>}
 */
async function restoreIndexedDB(view, indexedDBData) {
  if (!indexedDBData || typeof indexedDBData !== 'object' || Array.isArray(indexedDBData)) return
  const script = createIndexedDBRestoreScript(indexedDBData)
  if (!script) return
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve() }
    }, 10000)
    if (timer && timer.unref) timer.unref()
    view.webContents.once('did-finish-load', async () => {
      if (done) return
      clearTimeout(timer)
      try { await view.webContents.executeJavaScript(script) } catch (_) { /* ignore */ }
      done = true
      resolve()
    })
  })
}

/**
 * 创建并配置 WebContentsView
 * @param {string} accountId
 * @param {string} preloadPath
 * @param {import('electron').Session} sessionInstance
 */
function createAuthView(accountId, preloadPath, sessionInstance) {
  const { WebContentsView } = require('electron')
  return new WebContentsView({
    webPreferences: {
      session: sessionInstance,
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true, // 可见激活标签，真机实测出码期间 drawn=true（见 INVESTIGATE §12）
    }
  })
}

module.exports = { createSession, setCookies, restoreLocalStorage, restoreIndexedDB, createAuthView }

