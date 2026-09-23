/**
 * preload 聚合入口（Phase 3.3 + Bug-2 三级分离）
 *
 * 从 electron 拿到 ipcRenderer，分别构造三个子模块的 API，
 * 根据访问级别（public/authenticated/admin）动态鉴权后，
 * 通过 contextBridge.exposeInMainWorld 暴露给渲染进程。
 *
 * 三级分离设计：
 *   - public: 未登录可用（系统信息/登录入口/许可证激活/通知/onboarding）
 *   - authenticated: 登录后可用（业务 API：发布/流水线/账号/渲染等）
 *   - admin: 仅开发模式（敏感操作：paymentComplete/proxyTest 等）
 *
 * 访问级别由 preload 侧「主进程推送失效 + TTL 兜底」的缓存提供（见 ./access-level-cache.js）：
 * 受限 API 每次调用拿到的仍是最新级别，但不再每次同步往返主进程（审计 P2·性能税）。
 * 主进程在许可证激活/注销/试用与身份状态变化时广播 auth:access-level-invalidated；
 * 任何读不到合法级别的情况（IPC 未注册、抛异常、返回值被伪造）一律按 public 失败关闭。
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron')
const {
  ACCESS_LEVEL_CHANNEL,
  ACCESS_LEVEL_INVALIDATE_EVENT,
  isAccessLevel,
} = require('../core/access-level')
const { createAccessLevelCache } = require('./access-level-cache')
const { createPublishApi } = require('./publish')
const { createAccountApi } = require('./account')
const { createSystemApi } = require('./system')
const { createProjectApi } = require('./project')
const { createBoardApi } = require('./board')
const { createContactSheetApi } = require('./contact-sheet')
const { createApprovalGateApi } = require('./approval-gate')
const { createReplayApi } = require('./replay')
const { createIdentityApi } = require('./identity')
const { createTtsVoiceCatalogApi } = require('./tts-voice-catalog')
const { createTtsVoiceCloneApi } = require('./tts-voice-clone')
const { createPromptEvalApi } = require('./prompt-eval')
const { createPageManagerApi } = require('./page-manager')
const { createVideoCloneApi } = require('./video-clone')
const { createServicesApi } = require('./services')
const { createFilmEngineeringApi } = require('./film-engineering')
const { createAggregationApi } = require('./aggregation')
const { createHotTopicsApi } = require('./hot-topics')
const { createAutoPipelineApi } = require('./auto-pipeline')
const { createKnowledgeLibraryApi } = require('./knowledge-library')
const {
  ADMIN_ONLY_METHODS,
  PUBLIC_METHODS,
  createDynamicAccessApi,
  filterApiByAccessLevel,
} = require('./access-control')

/**
 * 回源函数：同步读取主进程的当前访问级别。
 *
 * Bug fix (QM-5 v2): preload 无法访问 app.isPackaged，但 electron 进程会以 !isPackaged
 * 作为 dev 判断（window.js:216），npm script 没设置 NODE_ENV 时只能依赖 sendSync 返回值。
 * sendSync 失败时按最低权限 public 处理（与生产环境一致），由主进程判断 dev 短路。
 */
function readAccessLevelFromMain() {
  try {
    if (typeof ipcRenderer.sendSync === 'function') {
      const level = ipcRenderer.sendSync(ACCESS_LEVEL_CHANNEL)
      if (isAccessLevel(level)) return level
    }
  } catch (_) { void _ /* IPC 未注册时 fallback */ }
  return 'public'
}

/**
 * 访问级别缓存（审计 P2·性能税）。原实现在每次受限 API 调用时都 sendSync 同步往返，
 * 会阻塞渲染进程直到主进程排空该请求；高频路径（列表轮询/进度回调）等于每次多交一份税。
 * 语义仍是「不重载窗口也能立即生效」：许可证激活/注销与身份登录/登出都会推送失效（①），
 * TTL 兜底保证漏收推送时最长一个周期后自动回源（②）。权威判定始终在主进程。
 */
const accessLevelCache = createAccessLevelCache({ read: readAccessLevelFromMain })

if (typeof ipcRenderer.on === 'function') {
  ipcRenderer.on(ACCESS_LEVEL_INVALIDATE_EVENT, () => accessLevelCache.invalidate())
}

function getAccessLevel() {
  return accessLevelCache.get()
}

const fullApi = {
  ...createPublishApi(ipcRenderer, {
    getPathForFile: (file) => webUtils?.getPathForFile(file) || '',
  }),
  ...createAccountApi(ipcRenderer),
  ...createSystemApi(ipcRenderer),
  ...createProjectApi(ipcRenderer),
  ...createBoardApi(ipcRenderer),
  ...createContactSheetApi(ipcRenderer),
  ...createApprovalGateApi(ipcRenderer),
  ...createReplayApi(ipcRenderer),
  ...createIdentityApi(ipcRenderer),
  ...createTtsVoiceCatalogApi(ipcRenderer),
  ...createTtsVoiceCloneApi(ipcRenderer),
  ...createPromptEvalApi(ipcRenderer),
  ...createPageManagerApi(ipcRenderer),
  ...createVideoCloneApi(ipcRenderer),
  ...createServicesApi(ipcRenderer),
  ...createFilmEngineeringApi(ipcRenderer),
  ...createAggregationApi(ipcRenderer),
  ...createHotTopicsApi(ipcRenderer),
  ...createAutoPipelineApi(ipcRenderer),
  ...createKnowledgeLibraryApi(ipcRenderer),
  // P2 限流自检（authenticated，默认受限）
  rateLimitSelfCheck: (params) => ipcRenderer.invoke('rate-limit:self-check', params),
  rateLimitReport: (payload) => ipcRenderer.invoke('rate-limit:report', payload),
}

const exposedApi = createDynamicAccessApi(fullApi, getAccessLevel)

exposedApi.getAccessLevel = getAccessLevel

contextBridge.exposeInMainWorld('electronAPI', exposedApi)

module.exports = {
  getAccessLevel,
  accessLevelCache,
  filterApiByAccessLevel,
  createDynamicAccessApi,
  ADMIN_ONLY_METHODS,
  PUBLIC_METHODS,
}


