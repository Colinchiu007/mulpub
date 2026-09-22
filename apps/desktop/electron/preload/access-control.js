'use strict'

const AUTH_ERROR = -3

// 仅开发模式允许暴露的敏感方法。
const ADMIN_ONLY_METHODS = [
  'paymentComplete', 'paymentSimulate',
  'proxyTest', 'proxyTestAll', 'proxyReset',
]

// 未激活专业许可证时仍可使用的方法。
const PUBLIC_METHODS = [
  'getVersion', 'getPlatform',
  'updateCheck', 'updateDownload', 'updateInstall', 'updateInstallNow', 'onUpdateStatus',
  'firstRunCheck', 'onFirstRunStatus',
  'showNotification', 'onNotification',
  'onNavigate',
  'onboardingComplete', 'onboardingGetSteps', 'onboardingStatus',
  'licenseInfo', 'licenseActivate', 'licenseDeactivate', 'licenseActivateTrial',
  'licenseHasFeature', 'licenseFeatures',
  'paymentCreateOrder', 'paymentListOrders', 'paymentGetOrder', 'paymentCancel',
  'authOpenLogin', 'authClose', 'onAuthViewOpened', 'onAuthCompleted', 'onAuthViewClosed',
  'authLoginSilent',
  'authOpenQrCodeLogin', 'authQrCodeClose',
  'onQrCodeOpened', 'onQrCodeDetected', 'onQrCodeCompleted', 'onQrCodeClosed',
  'oauthStart', 'oauthClose', 'oauthGetConfigs',
  'onOAuthOpened', 'onOAuthCompleted', 'onOAuthFailed', 'onOAuthClosed',
  'platformList', 'platformGet', 'getPlatformDefinitions',
  'offlineStatus', 'offlineIsOffline', 'offlineCachedTasks', 'offlineAddToCache',
  'offlineClearCache', 'onOfflineRestored',
  'onCallbackReceived',
  'hotkeysList',
  'sensitiveCheck', 'sensitiveReplace',
  'syncAll', 'syncPlatform', 'syncCached',
  'modelProviderList', 'modelProviderGet',
  'opsCenterSyncGet', 'opsCenterSyncSave', 'opsCenterSyncNow', 'opsCenterSyncRuntime',
  // 模型服务商：读方法未登录可用（离线查看/测试已配置模型）；
  // 写方法（Create/Update/Delete/SetDefault/CleanLogs）为 authenticated，未登录调用被拒。
  'modelProviderGetDefault',
  'modelProviderTest', 'modelProviderPresets', 'modelProviderIsConfigured',
  'modelProviderLogs',
  'logsGetInfo', 'logsClear', 'logError', 'notifyLog',
  'renderGetStatus', 'renderInstallDeps', 'onRenderInstallProgress',
  'pipelineList', 'pipelineGet',
  // 本地媒体导入（与主进程 PUBLIC_CHANNELS 的 story2video:import-media 对齐）：
  // File 路径经 webUtils 解析后仅发送路径给主进程做受控复制，纯设备本地操作。
  'story2videoImportMedia',
  // renderer 选择本地媒体时通过 Electron webUtils 解析绝对路径；不传文件内容。
  'getPathForFile',
  // Story2Video 本地历史读取与缩略图查询：项目数据按 owner 隔离，未登录也可查看本机历史。
  'story2videoListProjects', 'story2videoGetProject', 'story2videoGetThumbnail',
  // BGM 素材库（与主进程 PUBLIC_CHANNELS 的 story2video:bgm-library-* 对齐）：
  // 设备级本地素材库管理（列表/添加/改名/删除），未登录可用。
  'story2videoBgmLibraryList', 'story2videoBgmLibraryAdd',
  'story2videoBgmLibraryRename', 'story2videoBgmLibraryDelete',
  // 流水线「保存配置」（与主进程 story2video:config-profile-* 对齐）：设备级本地配置管理，未登录可用。
  'story2videoConfigProfileList', 'story2videoConfigProfileCreate',
  'story2videoConfigProfileRename', 'story2videoConfigProfileDelete',
  'identityGetState', 'identitySignIn', 'identitySwitchAccount', 'identitySignOut', 'onIdentityStateChanged',
  // 服务状态面板：纯本地只读诊断信息，未登录可见（与 identity:get-state 同理）
  'servicesGetStatus',
  // 视频克隆：本地分析流水线（未登录可用）；发布经 PublisherRouter 外部验收边界
  'videoClone',
  'videoClone.run', 'videoClone.cancel', 'videoClone.editReport', 'videoClone.regenerate',
  'videoClone.pickFile', 'videoClone.history', 'videoClone.onProgress',
  // 影视工程：随包 film-kit 资产浏览/复制/剧本套用（设备本地操作，未登录可用）；
  // 勾选生成（generateSelected）复用 assetGenerator，是否可用由主进程服务自校验。
  'filmEngineering',
  'filmEngineering.status', 'filmEngineering.listScenes', 'filmEngineering.listShots',
  'filmEngineering.getShot', 'filmEngineering.doctrine',
  'filmEngineering.copyText', 'filmEngineering.copyTexts',
  'filmEngineering.adaptScript', 'filmEngineering.exportPrompts', 'filmEngineering.generateSelected',
  'filmEngineering.retryShot',
]

function hasAccess(currentLevel, requiredLevel) {
  if (requiredLevel === 'public') return true
  if (requiredLevel === 'authenticated') {
    return currentLevel === 'authenticated' || currentLevel === 'admin'
  }
  return currentLevel === 'admin'
}

function requiredLevelForMethod(methodName, inheritedLevel = 'public', fullName = null) {
  const name = fullName || methodName
  if (inheritedLevel !== 'public') return inheritedLevel
  if (ADMIN_ONLY_METHODS.includes(name)) return 'admin'
  if (PUBLIC_METHODS.includes(name)) return 'public'
  return 'authenticated'
}

function createPermissionError(methodName) {
  const error = new Error(`许可证权限不足，无法调用 ${methodName}`)
  error.name = 'LicensePermissionError'
  error.code = AUTH_ERROR
  return error
}

function readAccessLevel(getCurrentAccessLevel) {
  try {
    const level = getCurrentAccessLevel()
    if (level === 'public' || level === 'authenticated' || level === 'admin') return level
  } catch (_) {
    // 同步权限 IPC 不可用时按最低权限处理。
    void _
  }
  return 'public'
}

/**
 * 创建稳定的 renderer API 表面。受限函数每次调用时重新读取主进程权限，
 * 因此许可证升级或降级都不需要重载窗口。
 */
function createDynamicAccessApi(api, getCurrentAccessLevel, inheritedLevel = 'public', prefix = '') {
  const exposed = {}
  const initialLevel = readAccessLevel(getCurrentAccessLevel)

  for (const key of Object.keys(api)) {
    const value = api[key]
    const fullName = prefix ? prefix + '.' + key : key
    const requiredLevel = requiredLevelForMethod(key, inheritedLevel, fullName)

    // admin 能力不会在生产 renderer 中出现，避免扩大敏感 API 暴露面。
    if (requiredLevel === 'admin' && initialLevel !== 'admin') continue

    if (typeof value === 'function') {
      if (requiredLevel === 'public') {
        exposed[key] = value
        continue
      }
      exposed[key] = function (...args) {
        if (!hasAccess(readAccessLevel(getCurrentAccessLevel), requiredLevel)) {
          throw createPermissionError(key)
        }
        return value.apply(this, args)
      }
    } else if (value && typeof value === 'object') {
      exposed[key] = createDynamicAccessApi(value, getCurrentAccessLevel, requiredLevel, fullName)
    }
  }

  return exposed
}

function filterApiByAccessLevel(api, level) {
  const filtered = {}
  for (const key of Object.keys(api)) {
    const value = api[key]
    const requiredLevel = requiredLevelForMethod(key)
    if (!hasAccess(level, requiredLevel)) continue
    if (typeof value === 'function') filtered[key] = value
    else if (value && typeof value === 'object') filtered[key] = value
  }
  return filtered
}

module.exports = {
  ADMIN_ONLY_METHODS,
  PUBLIC_METHODS,
  createDynamicAccessApi,
  filterApiByAccessLevel,
  hasAccess,
}
