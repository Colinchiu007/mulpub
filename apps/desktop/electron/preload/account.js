/**
 * 账号/认证相关 preload API（Phase 3.3 拆分自原 preload.js）
 *
 * 工厂函数：createAccountApi(ipcRenderer)
 *   - ipcRenderer 由调用方（preload/index.js）注入，便于测试 mock
 *   - 不在此处 require('electron')，保持子模块独立可测
 *
 * 涵盖方法：
 *   - 账号管理：accountAdd / accountDelete / accountCheckLogin / accountList
 *               accountSetDefault / accountGetDefault / accountUpdate / accountSetActive
 *   - 内嵌浏览器登录：authOpenLogin / authClose / authLoginSilent
 *                     onAuthViewOpened / onAuthCompleted / onAuthViewClosed
 *   - 扫码登录：authOpenQrCodeLogin / authQrCodeClose
 *               onQrCodeOpened / onQrCodeDetected / onQrCodeCompleted / onQrCodeClosed
 *   - OAuth 认证：oauthStart / oauthClose / oauthGetConfigs
 *                 onOAuthOpened / onOAuthCompleted / onOAuthFailed / onOAuthClosed
 *   - 统一数据存储：storeAddAccount / storeGetAccount / storeListAccounts / storeDeleteAccount
 *                   storeAddPublishRecord / storeListPublishHistory / storeGetPublishStats
 *                   storeAddScheduledTask / storeListScheduledTasks / storeDeleteTask
 *                   storeGetSetting / storeSetSetting / storeListCallbackLogs
 */

/**
 * 创建账号/认证相关 API 对象
 * @param {Electron.IpcRenderer} ipcRenderer - 由 index.js 注入
 * @returns {Object} 账号/认证相关方法集合
 */
function createAccountApi(ipcRenderer) {
  return {
    // 账号管理 API
    accountAdd: (platform) => ipcRenderer.invoke('account:add', platform),
    accountDelete: (accountId) => ipcRenderer.invoke('account:delete', accountId),
    accountCheckLogin: (platform, accountId) => ipcRenderer.invoke('account:check-login', { platform, accountId }),
    accountBatchCheckLogin: (accountIds) => ipcRenderer.invoke('accounts:batch-check-login', { accountIds }),
    accountBatchOpenLogin: (accountIds) => ipcRenderer.invoke('accounts:batch-open-login', { accountIds }),
    accountList: () => ipcRenderer.invoke('account:list'),
    accountSetDefault: (platform, accountId) => ipcRenderer.invoke('store:set-default-account', { platform, accountId }),
    accountGetDefault: (platform) => ipcRenderer.invoke('store:get-default-account', platform),
    accountUpdate: (id, fields) => ipcRenderer.invoke('store:update-account', { id, fields }),
    accountSetProxy: (accountId, platform, proxy) => ipcRenderer.invoke('account:set-proxy', { accountId, platform, proxy }),
    accountSetActive: (accountId, platform, isActive) => ipcRenderer.invoke('account:set-active', { accountId, platform, isActive }),

    // 内嵌浏览器登录 API
    authOpenLogin: (platform, accountId) => ipcRenderer.invoke('auth:open-login', { platform, accountId }),
    authCompleteLogin: () => ipcRenderer.invoke('auth:complete-login'),
    authClose: () => ipcRenderer.invoke('auth:close'),
    onAuthViewOpened: (callback) => {
      const h = (_, data) => callback(data)
      ipcRenderer.on('auth:view-opened', h)
      return () => ipcRenderer.removeListener('auth:view-opened', h)
    },
    onAuthCompleted: (callback) => {
      const h = (_, data) => callback(data)
      ipcRenderer.on('auth:completed', h)
      return () => ipcRenderer.removeListener('auth:completed', h)
    },
    onAuthViewClosed: (callback) => {
      const h = () => callback()
      ipcRenderer.on('auth:view-closed', h)
      return () => ipcRenderer.removeListener('auth:view-closed', h)
    },
    // Auth API（静默登录）
    authLoginSilent: (platform, accountId) => ipcRenderer.invoke('auth:login-silent', { platform, accountId }),

    // 扫码登录 API
    authOpenQrCodeLogin: (platform) => ipcRenderer.invoke('auth:open-qrcode-login', platform),
    authQrCodeClose: () => ipcRenderer.invoke('auth:qrcode-close'),
    onQrCodeOpened: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('qrcode:opened', h); return () => ipcRenderer.removeListener('qrcode:opened', h)
    },
    onQrCodeDetected: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('qrcode:detected', h); return () => ipcRenderer.removeListener('qrcode:detected', h)
    },
    onQrCodeCompleted: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('qrcode:completed', h); return () => ipcRenderer.removeListener('qrcode:completed', h)
    },
    onQrCodeClosed: (cb) => {
      const h = () => cb(); ipcRenderer.on('qrcode:closed', h); return () => ipcRenderer.removeListener('qrcode:closed', h)
    },
    onAccountStatusChanged: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('account:status-changed', h); return () => ipcRenderer.removeListener('account:status-changed', h)
    },
    onAccountsBatchCheckProgress: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('accounts:batch-check-progress', h); return () => ipcRenderer.removeListener('accounts:batch-check-progress', h)
    },

    // OAuth 认证 API
    oauthStart: (opts) => ipcRenderer.invoke('oauth:start', opts),
    oauthClose: () => ipcRenderer.invoke('oauth:close'),
    oauthGetConfigs: () => ipcRenderer.invoke('oauth:get-configs'),
    onOAuthOpened: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('oauth:opened', h); return () => ipcRenderer.removeListener('oauth:opened', h)
    },
    onOAuthCompleted: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('oauth:completed', h); return () => ipcRenderer.removeListener('oauth:completed', h)
    },
    onOAuthFailed: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('oauth:failed', h); return () => ipcRenderer.removeListener('oauth:failed', h)
    },
    onOAuthClosed: (cb) => {
      const h = () => cb(); ipcRenderer.on('oauth:closed', h); return () => ipcRenderer.removeListener('oauth:closed', h)
    },

    // 统一数据存储 API
    storeAddAccount: (account) => ipcRenderer.invoke('store:add-account', account),
    storeGetAccount: (id) => ipcRenderer.invoke('store:get-account', id),
    storeListAccounts: (platform) => ipcRenderer.invoke('store:list-accounts', platform),
    storeDeleteAccount: (id) => ipcRenderer.invoke('store:delete-account', id),
    storeAddPublishRecord: (record) => ipcRenderer.invoke('store:add-publish-record', record),
    storeListPublishHistory: (opts) => ipcRenderer.invoke('store:list-publish-history', opts),
    storeGetPublishStats: () => ipcRenderer.invoke('store:get-publish-stats'),
    storeAddScheduledTask: (task) => ipcRenderer.invoke('store:add-scheduled-task', task),
    storeListScheduledTasks: () => ipcRenderer.invoke('store:list-scheduled-tasks'),
    storeDeleteTask: (id) => ipcRenderer.invoke('store:delete-task', id),
    storeGetSetting: (key) => ipcRenderer.invoke('store:get-setting', key),
    storeSetSetting: (key, value) => ipcRenderer.invoke('store:set-setting', key, value),
    storeListCallbackLogs: (limit) => ipcRenderer.invoke('store:list-callback-logs', limit),
  }
}

module.exports = { createAccountApi }
