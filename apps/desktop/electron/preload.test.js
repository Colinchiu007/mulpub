/**
 * Preload 拆分测试 — Phase 3.3
 *
 * 测试策略（避开 vi.mock('electron') 的局限）：
 *   - 直接调用工厂函数 createPublishApi / createAccountApi / createSystemApi
 *   - 传入 mock ipcRenderer，合并后得到与 contextBridge.exposeInMainWorld
 *     等价的方法集合，绕过 contextBridge.exposeInMainWorld
 *   - 子模块内部不调用 require('electron')，因此无需启用 electron mock
 *
 * 验证维度：
 *   1. 三个工厂函数存在且为函数，返回对象
 *   2. 所有原 preload.js 方法在新 API 对象中存在且为函数
 *   3. pipelines 嵌套对象有 list / get 方法
 *   4. invoke 类方法调用时转发到 ipcRenderer.invoke，channel 与原 preload.js 一致
 *   5. 监听器类方法返回 cancel 函数
 *   6. 总方法数符合预期（防止漏迁移或重复）
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let ipcRenderer, api

beforeEach(() => {
  ipcRenderer = {
    invoke: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  }
  const { createPublishApi } = require('./preload/publish')
  const { createAccountApi } = require('./preload/account')
  const { createSystemApi } = require('./preload/system')
  const { createIdentityApi } = require('./preload/identity')
  const { createVideoCloneApi } = require('./preload/video-clone')
  const { createFilmEngineeringApi } = require('./preload/film-engineering')
  const { createServicesApi } = require('./preload/services')
  api = {
    ...createPublishApi(ipcRenderer),
    ...createAccountApi(ipcRenderer),
    ...createSystemApi(ipcRenderer),
    ...createIdentityApi(ipcRenderer),
    ...createVideoCloneApi(ipcRenderer),
    ...createFilmEngineeringApi(ipcRenderer),
    ...createServicesApi(ipcRenderer),
  }
})

// === 方法名清单（从原 preload.js 351 行提取，不改变任何名称/IPC 通道/参数顺序）===
const PUBLISH_METHODS = [
  'getPathForFile',
  'publishWechat', 'publishBatch', 'listAccounts',
  'renderStart', 'renderCancel', 'renderGetStatus', 'renderInstallDeps',
  'renderStartAiVideo',
  'onRenderProgress', 'onRenderComplete', 'onRenderError', 'onRenderInstallProgress',
  'onPipelineUpdate',
  'renderListCompositions', 'renderGetComposition', 'renderValidateProps',
  'intelligenceSuggestTags', 'intelligenceGetOptimalTime',
  'intelligenceSearch', 'intelligenceSearchTitles', 'intelligenceFetchTrending',
  'intelligenceFindReferences', 'intelligenceGetBenchmark',
  'getQueueStatus', 'getQueueHistory', 'cancelTask',
  'historyList', 'historyGet', 'historyDelete',
  'dashboardStats',
  'schedulerCreate', 'schedulerList', 'schedulerCancel',
  'onProgress',
  'onRiskHold',
  'onRiskSuspended', 'listSuspendedRisk', 'resumeRisk', 'isSuspendedRisk',
  'pipelineList', 'pipelineGet', 'pipelineStart', 'pipelinePause', 'pipelineResume',
  'pipelineCancel', 'pipelineStatus', 'pipelineAdvance', 'pipelineHistory', 'pipelineFetch',
  'pipelineStartOrchestrated', 'pipelineExecuteStage',
  'pipelineAdvanceToNextCheckpoint', 'pipelineGetRunContext',
  'story2videoImportMedia', 'story2videoExportZip', 'story2videoCreateShareUrl',
  'story2videoCopyPath', 'story2videoShowInFolder', 'story2videoSaveAs', 'story2videoListProjects',
  'story2videoGetProject', 'story2videoGetThumbnail', 'story2videoDeleteProject', 'story2videoUpdateSegments',
  'story2videoReplaceSegmentAudio',
  'story2videoRetrySegment', 'story2videoRecomposeProject', 'story2videoTranscribe',
  'story2videoSelectSceneMaterial', 'story2videoGenerateSceneImage', 'story2videoGenerateSceneVideo',
  'story2videoCapabilities',
  'cloudPublishSubmit', 'cloudPublishListTasks', 'cloudPublishGetTask', 'cloudPublishPlatforms',
  'urlCollectFetch',
  'viralAnalyze', 'viralGenerate', 'viralTrending',
  'commentList', 'commentReply', 'commentStartPolling', 'commentStopPolling', 'commentStatus', 'onCommentReplied',
]

const ACCOUNT_METHODS = [
  'accountAdd', 'accountDelete', 'accountCheckLogin', 'accountBatchCheckLogin', 'accountBatchOpenLogin', 'accountList',
  'accountSetDefault', 'accountGetDefault', 'accountUpdate', 'accountSetProxy', 'accountSetActive',
  'authOpenLogin', 'authClose', 'authCompleteLogin', 'authLoginSilent',
  'onAuthViewOpened', 'onAuthCompleted', 'onAuthViewClosed',
  'authOpenQrCodeLogin', 'authQrCodeClose',
  'onQrCodeOpened', 'onQrCodeDetected', 'onQrCodeCompleted', 'onQrCodeClosed',
    'onAccountStatusChanged', 'onAccountsBatchCheckProgress',
  'oauthStart', 'oauthClose', 'oauthGetConfigs',
  'onOAuthOpened', 'onOAuthCompleted', 'onOAuthFailed', 'onOAuthClosed',
  'storeAddAccount', 'storeGetAccount', 'storeListAccounts', 'storeDeleteAccount',
  'storeAddPublishRecord', 'storeListPublishHistory', 'storeGetPublishStats',
  'storeAddScheduledTask', 'storeListScheduledTasks', 'storeDeleteTask',
  'storeGetSetting', 'storeSetSetting', 'storeListCallbackLogs',
]

const SYSTEM_METHODS = [
  'getVersion', 'getPlatform',
  'updateCheck', 'updateDownload', 'updateInstall', 'updateInstallNow', 'onUpdateStatus',
  'firstRunCheck', 'onFirstRunStatus',
  'platformList', 'platformGet', 'getPlatformDefinitions',
  'sensitiveCheck', 'sensitiveReplace',
  'syncAll', 'syncPlatform', 'syncCached',
  'showNotification', 'onNotification',
  'onCallbackReceived',
  'offlineStatus', 'offlineIsOffline', 'offlineCachedTasks', 'offlineAddToCache', 'offlineClearCache', 'onOfflineRestored',
  'onboardingComplete', 'onboardingGetSteps', 'onboardingStatus',
  'paymentCreateOrder', 'paymentListOrders', 'paymentGetOrder', 'paymentComplete', 'paymentSimulate', 'paymentCancel',
  'onNavigate',
  'analyticsOverview', 'analyticsPlatform', 'analyticsPlatforms',
  'hotkeysList',
  'keywordStart', 'keywordStop', 'keywordStatus', 'keywordHistory', 'keywordStopAll',
  'proxyAdd', 'proxyAddBatch', 'proxyList', 'proxyRemove', 'proxyTest', 'proxyTestAll',
  'proxyStatus', 'proxyGetNext', 'proxyReset', 'proxyRemoveDead',
  'uploadChunked', 'uploadCancel', 'onUploadProgress',
  'templateList', 'templateGet', 'templateAdd', 'templateUpdate', 'templateDelete',
  'templateListByCategory', 'templateGetPresets',
  'licenseInfo', 'licenseActivate', 'licenseDeactivate', 'licenseActivateTrial',
  'licenseHasFeature', 'licenseFeatures',
  'providerList', 'providerCreate', 'providerUpdate', 'providerDelete', 'providerTest',
  'providerListUser', 'providerGetUser', 'providerSetUserKey', 'providerDeleteUserKey',
  'aiListProviders', 'aiGetConfig', 'aiListModels', 'aiGenerate', 'aiTestConnection', 'aiSaveConfig',
  'aiIsConfigured', 'aiGenerateTitles', 'aiEnhanceContent', 'aiGenerateSummary',
  'onAIProgress', 'onAIComplete', 'onAIError',
  'videoStatus', 'videoListProcessTypes', 'videoListAnalyzeTypes', 'videoListStockSources',
  'videoProcess', 'videoAnalyze', 'videoMixAudio', 'videoSearchStock', 'videoGenerateSubtitle',
  'onVideoProgress', 'onVideoComplete', 'onVideoError',
  'batchCreate', 'batchExecute', 'batchSchedule', 'batchList', 'batchGet', 'batchDelete',
  'batchDuplicateArticle', 'onBatchProgress',
  'modelProviderList', 'modelProviderGet', 'modelProviderCreate', 'modelProviderUpdate',
  'modelProviderDelete', 'modelProviderSetDefault', 'modelProviderGetDefault',
  'modelProviderTest', 'modelProviderPresets', 'modelProviderIsConfigured',
  'modelProviderLogs', 'modelProviderCleanLogs',
  'logsGetInfo', 'logsClear', 'logError', 'notifyLog',
  'cacheGetStats', 'cacheClear',
  'promptLibraryGet', 'promptLibrarySave', 'promptLibraryActivate',
]

const IDENTITY_METHODS = [
  'identityGetState', 'identitySignIn', 'identitySwitchAccount', 'identitySignOut', 'onIdentityStateChanged',
]

// === 工厂函数导出 ===
describe('preload 子模块工厂函数', () => {
  it('createPublishApi 应为函数', () => {
    const { createPublishApi } = require('./preload/publish')
    expect(typeof createPublishApi).toBe('function')
  })

  it('createAccountApi 应为函数', () => {
    const { createAccountApi } = require('./preload/account')
    expect(typeof createAccountApi).toBe('function')
  })

  it('createSystemApi 应为函数', () => {
    const { createSystemApi } = require('./preload/system')
    expect(typeof createSystemApi).toBe('function')
  })

  it('createIdentityApi 应为函数', () => {
    const { createIdentityApi } = require('./preload/identity')
  const { createVideoCloneApi } = require('./preload/video-clone')
    expect(typeof createIdentityApi).toBe('function')
  })

  it('createPublishApi 返回非空对象', () => {
    const { createPublishApi } = require('./preload/publish')
    const r = createPublishApi(ipcRenderer)
    expect(typeof r).toBe('object')
    expect(r).not.toBe(null)
    expect(Object.keys(r).length).toBeGreaterThan(0)
  })

  it('createAccountApi 返回非空对象', () => {
    const { createAccountApi } = require('./preload/account')
    const r = createAccountApi(ipcRenderer)
    expect(typeof r).toBe('object')
    expect(r).not.toBe(null)
    expect(Object.keys(r).length).toBeGreaterThan(0)
  })

  it('createSystemApi 返回非空对象', () => {
    const { createSystemApi } = require('./preload/system')
    const r = createSystemApi(ipcRenderer)
    expect(typeof r).toBe('object')
    expect(r).not.toBe(null)
    expect(Object.keys(r).length).toBeGreaterThan(0)
  })
})

// === 总方法数验证（防止漏迁移或重复）===
describe('preload 子模块方法数', () => {
  it('publish 模块应导出 123 个键（W1 §5 enforcement：+onRiskSuspended/listSuspendedRisk/resumeRisk/isSuspendedRisk）', () => {
    const { createPublishApi } = require('./preload/publish')
    const r = createPublishApi(ipcRenderer)
    expect(Object.keys(r).length).toBe(123)
  })

  it('account 模块应导出 46 个方法', () => {
    const { createAccountApi } = require('./preload/account')
    const r = createAccountApi(ipcRenderer)
    expect(Object.keys(r).length).toBe(46)
  })

  it('system 模块应导出 147 个方法', () => {
    const { createSystemApi } = require('./preload/system')
    const r = createSystemApi(ipcRenderer)
    // 136 + opsCenterSyncGet/Save/Now/Runtime/PipelineOptions（运营后台同步 + 运行时策略）
    // + generationFeedback/promptLibraryList（提示词引擎自进化 P0 反馈管道）
    // + notifyLog（通知/日志统一通道，notify:log）
    // + promptLibraryGet/Save/Activate（提示词引擎自进化 P1b 记忆库）
    // + updateInstallNow（侧边栏「新版本」点击即退出安装）
    // + opsCenterSyncAppMenu（#1839 运营中心侧边栏显隐排序下发）
    // + onUploadProgress（#1853 分片上传实时进度事件）
    // - 10（分屏监控 webview:* API 随监控功能移除，网页查看统一走 pageManager）
    expect(Object.keys(r).length).toBe(147)
  })

  it('合并后 api 总键数应为 320（accountSetActive + pipelineConfirmStageGate + P2-2 generateAiCover + pipelineCancelRun + P3-7 listPlatformCollections + servicesGetStatus/servicesRestart + urlCollectNeedsStealth + promptLibraryGet/Save/Activate + updateInstallNow + opsCenterSyncAppMenu + onUploadProgress + renderStartAiVideo + PR-2 F8 getRecentImpactSnapshots - webview 分屏监控 API 移除）', () => {
    expect(Object.keys(api).length).toBe(325)
  })

  it('PUBLISH_METHODS 常量包含编排 API', () => {
    expect(PUBLISH_METHODS.length).toBe(87)
    expect(PUBLISH_METHODS).toEqual(expect.arrayContaining([
      'pipelineStartOrchestrated',
      'pipelineExecuteStage',
      'pipelineAdvanceToNextCheckpoint',
      'pipelineGetRunContext',
    ]))
  })

  it('ACCOUNT_METHODS 常量长度应为 45', () => {
    expect(ACCOUNT_METHODS.length).toBe(46)
  })

  it('SYSTEM_METHODS 常量长度应为 134', () => {
    expect(SYSTEM_METHODS.length).toBe(134)
  })

  it('IDENTITY_METHODS 常量长度应为 5', () => {
    expect(IDENTITY_METHODS.length).toBe(5)
  })
})

// === pipelines 嵌套对象结构 ===
describe('pipelines 嵌套对象结构', () => {
  it('api.pipelines 应为对象', () => {
    expect(typeof api.pipelines).toBe('object')
    expect(api.pipelines).not.toBe(null)
  })

  it('api.pipelines.list 应为函数', () => {
    expect(typeof api.pipelines.list).toBe('function')
  })

  it('api.pipelines.get 应为函数', () => {
    expect(typeof api.pipelines.get).toBe('function')
  })

  it('api.pipelines.list() 调用应转发到 ipcRenderer.invoke("pipeline:list")', () => {
    api.pipelines.list()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('pipeline:list')
  })

  it('api.pipelines.get("foo") 调用应转发到 ipcRenderer.invoke("pipeline:get", "foo")', () => {
    api.pipelines.get('foo')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('pipeline:get', 'foo')
  })
})

describe('本地文件路径桥接', () => {
  it('通过 webUtils 解析绝对路径，不把文件对象传给主进程', () => {
    const { createPublishApi } = require('./preload/publish')
    const resolver = vi.fn(() => 'C:/media/music.mp3')
    const file = { name: 'music.mp3' }
    const scopedApi = createPublishApi(ipcRenderer, { getPathForFile: resolver })

    expect(scopedApi.getPathForFile(file)).toBe('C:/media/music.mp3')
    expect(resolver).toHaveBeenCalledWith(file)
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('路径解析异常时返回空字符串', () => {
    const { createPublishApi } = require('./preload/publish')
    const scopedApi = createPublishApi(ipcRenderer, {
      getPathForFile: () => { throw new Error('invalid File') },
    })
    expect(scopedApi.getPathForFile({ name: 'music.mp3' })).toBe('')
  })
})

// === publish 模块方法存在性 + 类型（数据驱动）===
describe('publish 模块方法存在且为函数', () => {
  it.each(PUBLISH_METHODS)('%s 应存在于 api 且为函数', (name) => {
    expect(api).toHaveProperty(name)
    expect(typeof api[name]).toBe('function')
  })
})

// === account 模块方法存在性 + 类型（数据驱动）===
describe('account 模块方法存在且为函数', () => {
  it.each(ACCOUNT_METHODS)('%s 应存在于 api 且为函数', (name) => {
    expect(api).toHaveProperty(name)
    expect(typeof api[name]).toBe('function')
  })
})

// === system 模块方法存在性 + 类型（数据驱动）===
describe('system 模块方法存在且为函数', () => {
  it.each(SYSTEM_METHODS)('%s 应存在于 api 且为函数', (name) => {
    expect(api).toHaveProperty(name)
    expect(typeof api[name]).toBe('function')
  })
})

describe('identity 模块方法存在且为函数', () => {
  it.each(IDENTITY_METHODS)('%s 应存在于 api 且为函数', (name) => {
    expect(api).toHaveProperty(name)
    expect(typeof api[name]).toBe('function')
  })
})

// === invoke 转发抽样测试（12 个：channel 与原 preload.js 一致）===
describe('invoke 类方法转发到 ipcRenderer.invoke', () => {
  const INVOKE_CASES = [
    ['publishWechat', 'publish:wechat', [{ id: 1 }]],
    ['listAccounts', 'accounts:list', []],
    ['historyDelete', 'history:delete', [['record-1']]],
    ['getVersion', 'app:get-version', []],
    ['accountAdd', 'account:add', ['wechat']],
    ['storeGetSetting', 'store:get-setting', ['theme']],
    ['oauthStart', 'oauth:start', [{ platform: 'youtube' }]],
    ['videoStatus', 'video:status', []],
    ['paymentCreateOrder', 'payment:create-order', [{ amount: 100 }]],
    ['templateList', 'template:list', []],
    ['proxyAdd', 'proxy:add', [{ host: '127.0.0.1' }]],
    ['modelProviderLogs', 'model-provider:logs', [{ category: 'llm' }]],
    ['modelProviderCleanLogs', 'model-provider:clean-logs', [7]],
    ['pipelineStartOrchestrated', 'pipeline:startOrchestrated', ['story2video-compose', { text: '测试' }]],
    ['pipelineExecuteStage', 'pipeline:executeStage', ['run-1']],
    ['pipelineAdvanceToNextCheckpoint', 'pipeline:advanceToNextCheckpoint', ['run-1']],
    ['pipelineGetRunContext', 'pipeline:getRunContext', ['run-1']],
    ['story2videoExportZip', 'story2video:export-zip', [[{ path: 'C:/video.mp4' }], 'C:/videos.zip']],
    ['story2videoCreateShareUrl', 'story2video:create-share-url', ['C:/video.mp4']],
    ['story2videoCopyPath', 'story2video:copy-path', ['C:/video.mp4']],
    ['story2videoShowInFolder', 'story2video:show-in-folder', ['C:/video.mp4']],
    ['story2videoSaveAs', 'story2video:save-as', ['C:/video.mp4', 'out.mp4']],
    ['story2videoDeleteProject', 'story2video:delete-project', ['project-1']],
    ['story2videoReplaceSegmentAudio', 'story2video:replace-segment-audio', ['project-1', 'segment-0', 'C:/voice.mp3']],
    ['story2videoSelectSceneMaterial', 'story2video:select-scene-material', ['project-1', 'segment-0', 'image2']],
    ['story2videoGenerateSceneImage', 'story2video:generate-scene-image', ['project-1', 'segment-0']],
    ['story2videoGenerateSceneVideo', 'story2video:generate-scene-video', ['project-1', 'segment-0']],
  ]

  beforeEach(() => {
    ipcRenderer.invoke.mockClear()
  })

  it.each(INVOKE_CASES)('%s() 应转发到 invoke("%s", ...)', (method, channel, args) => {
    api[method](...args)
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.invoke.mock.calls[0][0]).toBe(channel)
  })
})

describe('Story2Video 媒体导入桥接', () => {
  it('先通过可信 webUtils 解析 File 路径，再发送纯 JSON 参数', async () => {
    const { createPublishApi } = require('./preload/publish')
    const resolver = vi.fn().mockReturnValue('D:/media/voice.mp3')
    const scopedApi = createPublishApi(ipcRenderer, { getPathForFile: resolver })
    const file = { name: 'voice.mp3' }

    await scopedApi.story2videoImportMedia(file, 'audio')

    expect(resolver).toHaveBeenCalledWith(file)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('story2video:import-media', {
      filePath: 'D:/media/voice.mp3',
      kind: 'audio',
    })
  })

  it('无法由 webUtils 解析的伪造路径不会发送到主进程', async () => {
    const { createPublishApi } = require('./preload/publish')
    const scopedIpcRenderer = { invoke: vi.fn() }
    const resolver = vi.fn(() => { throw new TypeError('需要真实 File 对象') })
    const scopedApi = createPublishApi(scopedIpcRenderer, { getPathForFile: resolver })

    const result = await scopedApi.story2videoImportMedia('C:/Users/user/private.mp3', 'audio')

    expect(resolver).toHaveBeenCalledWith('C:/Users/user/private.mp3')
    expect(result).toEqual({ code: -1, message: '无法读取媒体文件路径' })
    expect(scopedIpcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('本地媒体导入为公开方法且主进程通道公开（未登录可用，设备本地操作）', () => {
    const { PUBLIC_METHODS } = require('./preload/access-control')
    const { requiredLevelForChannel } = require('./ipc-handlers/license-access-control')
    expect(PUBLIC_METHODS).toContain('story2videoImportMedia')
    expect(requiredLevelForChannel('story2video:import-media')).toBe('public')
  })

  it('Story2Video 本地历史读取和缩略图查询为公开方法且主进程通道公开', () => {
    const { PUBLIC_METHODS } = require('./preload/access-control')
    const { requiredLevelForChannel } = require('./ipc-handlers/license-access-control')
    for (const method of ['story2videoListProjects', 'story2videoGetProject', 'story2videoGetThumbnail']) {
      expect(PUBLIC_METHODS).toContain(method)
    }
    expect(requiredLevelForChannel('story2video:list-projects')).toBe('public')
    expect(requiredLevelForChannel('story2video:get-project')).toBe('public')
    expect(requiredLevelForChannel('story2video:get-thumbnail')).toBe('public')
  })

  it('流水线「保存配置」为公开方法且主进程通道公开（设备级本地配置库）', () => {
    const { PUBLIC_METHODS } = require('./preload/access-control')
    const { requiredLevelForChannel } = require('./ipc-handlers/license-access-control')
    for (const method of ['story2videoConfigProfileList', 'story2videoConfigProfileCreate', 'story2videoConfigProfileRename', 'story2videoConfigProfileDelete']) {
      expect(PUBLIC_METHODS).toContain(method)
    }
    for (const channel of ['story2video:config-profile-list', 'story2video:config-profile-create', 'story2video:config-profile-rename', 'story2video:config-profile-delete']) {
      expect(requiredLevelForChannel(channel)).toBe('public')
    }
  })
})

// === 监听器类方法返回 cancel 函数（抽样 4 个）===
describe('监听器类方法返回 cancel 函数', () => {
  const LISTENER_CASES = [
    'onProgress',
    'onUpdateStatus',
    'onAuthViewOpened',
    'onQrCodeOpened',
  ]

  it.each(LISTENER_CASES)('%s(callback) 应返回 cancel 函数', (method) => {
    const cancel = api[method](() => {})
    expect(typeof cancel).toBe('function')
  })

  it.each(LISTENER_CASES)('%s 调用 cancel 后应调用 removeListener', (method) => {
    const cancel = api[method](() => {})
    expect(ipcRenderer.removeListener).not.toHaveBeenCalled()
    cancel()
    expect(ipcRenderer.removeListener).toHaveBeenCalledTimes(1)
  })
})

// === 无方法名重复校验 ===
describe('方法名清单无重复', () => {
  it('PUBLISH_METHODS 无重复', () => {
    const set = new Set(PUBLISH_METHODS)
    expect(set.size).toBe(PUBLISH_METHODS.length)
  })

  it('ACCOUNT_METHODS 无重复', () => {
    const set = new Set(ACCOUNT_METHODS)
    expect(set.size).toBe(ACCOUNT_METHODS.length)
  })

  it('SYSTEM_METHODS 无重复', () => {
    const set = new Set(SYSTEM_METHODS)
    expect(set.size).toBe(SYSTEM_METHODS.length)
  })

  it('四个模块间无方法名冲突', () => {
    const all = [...PUBLISH_METHODS, ...ACCOUNT_METHODS, ...SYSTEM_METHODS, ...IDENTITY_METHODS]
    const set = new Set(all)
    expect(set.size).toBe(all.length)
  })
})

// === 许可证运行时变更：API 引用必须按最新权限执行 ===
describe('preload 动态许可证权限', () => {
  it('同一受限 API 引用在升级后立即放行，降级后立即拒绝', () => {
    const { createDynamicAccessApi } = require('./preload/access-control')
    let accessLevel = 'public'
    const publishWechat = vi.fn(() => '已发布')
    const dynamicApi = createDynamicAccessApi(
      { publishWechat, getVersion: vi.fn(() => '1.0.0') },
      () => accessLevel,
    )

    expect(typeof dynamicApi.publishWechat).toBe('function')
    expect(() => dynamicApi.publishWechat({ title: '免费版' }))
      .toThrow(/许可证权限不足/)
    expect(publishWechat).not.toHaveBeenCalled()

    accessLevel = 'authenticated'
    expect(dynamicApi.publishWechat({ title: '专业版' })).toBe('已发布')
    expect(publishWechat).toHaveBeenCalledTimes(1)

    accessLevel = 'public'
    expect(() => dynamicApi.publishWechat({ title: '已降级' }))
      .toThrow(/许可证权限不足/)
    expect(publishWechat).toHaveBeenCalledTimes(1)
  })

  it('公开 API 始终可用，非开发环境不暴露 admin API', () => {
    const { createDynamicAccessApi } = require('./preload/access-control')
    const getVersion = vi.fn(() => '1.0.0')
    const dynamicApi = createDynamicAccessApi(
      { getVersion, paymentComplete: vi.fn() },
      () => 'public',
    )

    expect(dynamicApi.getVersion()).toBe('1.0.0')
    expect(dynamicApi.paymentComplete).toBeUndefined()
  })

  it('调用参数不能伪造访问级别', () => {
    const { createDynamicAccessApi } = require('./preload/access-control')
    const publishWechat = vi.fn()
    const dynamicApi = createDynamicAccessApi(
      { publishWechat },
      () => 'public',
    )

    expect(() => dynamicApi.publishWechat({
      accessLevel: 'admin',
      isPro: true,
    })).toThrow(/许可证权限不足/)
    expect(publishWechat).not.toHaveBeenCalled()
  })

  it('嵌套 API 在升级和降级后也立即使用最新权限', () => {
    const { createDynamicAccessApi } = require('./preload/access-control')
    let accessLevel = 'public'
    const list = vi.fn(() => ['pipeline-a'])
    const dynamicApi = createDynamicAccessApi(
      { pipelines: { list } },
      () => accessLevel,
    )

    expect(() => dynamicApi.pipelines.list()).toThrow(/许可证权限不足/)
    accessLevel = 'authenticated'
    expect(dynamicApi.pipelines.list()).toEqual(['pipeline-a'])
    accessLevel = 'public'
    expect(() => dynamicApi.pipelines.list()).toThrow(/许可证权限不足/)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('权限查询异常或返回非法值时按 public 失败关闭', () => {
    const { createDynamicAccessApi } = require('./preload/access-control')
    let queryMode = 'public'
    const publishWechat = vi.fn()
    const dynamicApi = createDynamicAccessApi(
      { publishWechat },
      () => {
        if (queryMode === 'throw') throw new Error('同步 IPC 不可用')
        return queryMode
      },
    )

    queryMode = 'throw'
    expect(() => dynamicApi.publishWechat()).toThrow(/许可证权限不足/)
    queryMode = 'forged-admin'
    expect(() => dynamicApi.publishWechat()).toThrow(/许可证权限不足/)
    expect(publishWechat).not.toHaveBeenCalled()
  })

  it('聚合入口暴露稳定 API，并在运行时升级和降级后立即生效', async () => {
    const preloadPath = require.resolve('./preload/index')
    const originalExpose = __electronMock.contextBridge.exposeInMainWorld
    const originalInvoke = __electronMock.ipcRenderer.invoke
    const originalSendSync = __electronMock.ipcRenderer.sendSync
    let accessLevel = 'public'

    __electronMock.contextBridge.exposeInMainWorld = vi.fn()
    __electronMock.ipcRenderer.invoke = vi.fn(async (channel, args) => ({ channel, args }))
    __electronMock.ipcRenderer.sendSync = vi.fn(() => accessLevel)
    __enableElectronMock()

    try {
      delete require.cache[preloadPath]
      require('./preload/index')

      expect(__electronMock.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1)
      const [worldName, exposedApi] = __electronMock.contextBridge.exposeInMainWorld.mock.calls[0]
      expect(worldName).toBe('electronAPI')
      expect(exposedApi).toHaveProperty('getVersion')
      expect(exposedApi).toHaveProperty('publishWechat')
      expect(exposedApi.paymentComplete).toBeUndefined()

      expect(() => exposedApi.publishWechat({ title: '免费版' }))
        .toThrow(/许可证权限不足/)

      // 审计 P2·性能税回归保护：主进程未推失效事件时，TTL 内的重复调用不得再打同步 IPC
      const sendSyncCallsBefore = __electronMock.ipcRenderer.sendSync.mock.calls.length
      expect(() => exposedApi.publishWechat({ title: '免费版' }))
        .toThrow(/许可证权限不足/)
      expect(() => exposedApi.publishWechat({ title: '免费版' }))
        .toThrow(/许可证权限不足/)
      expect(__electronMock.ipcRenderer.sendSync.mock.calls.length).toBe(sendSyncCallsBefore)

      // 主进程推送失效 → 不重载窗口，升级立即生效
      accessLevel = 'authenticated'
      __electronMock.ipcRenderer.emit('auth:access-level-invalidated', { reason: 'license-activate' })
      await expect(exposedApi.publishWechat({ title: '专业版' })).resolves.toEqual({
        channel: 'publish:wechat',
        args: { title: '专业版' },
      })

      accessLevel = 'public'
      __electronMock.ipcRenderer.emit('auth:access-level-invalidated', { reason: 'license-deactivate' })
      expect(() => exposedApi.publishWechat({ title: '已降级' }))
        .toThrow(/许可证权限不足/)
      expect(__electronMock.ipcRenderer.invoke).toHaveBeenCalledTimes(1)
      expect(__electronMock.ipcRenderer.sendSync)
        .toHaveBeenCalledWith('auth:get-access-level')
      // 两次推送之间最多回源一次：3 次受限调用共 2 次同步 IPC（推送前 1 次 + 每次推送后 1 次）
      expect(__electronMock.ipcRenderer.sendSync.mock.calls.length).toBe(sendSyncCallsBefore + 2)
    } finally {
      delete require.cache[preloadPath]
      __electronMock.contextBridge.exposeInMainWorld = originalExpose
      __electronMock.ipcRenderer.invoke = originalInvoke
      if (originalSendSync === undefined) delete __electronMock.ipcRenderer.sendSync
      else __electronMock.ipcRenderer.sendSync = originalSendSync
      __disableElectronMock()
    }
  })

  it('所有 preload 公开 invoke 方法对应的主进程通道都保持公开', () => {
    const { PUBLIC_METHODS } = require('./preload/access-control')
    const { requiredLevelForChannel } = require('./ipc-handlers/license-access-control')

    for (const methodName of PUBLIC_METHODS) {
    const resolvePath = (obj, p) => p.split('.').reduce((o, k) => (o ? o[k] : undefined), obj)
      const fn = resolvePath(api, methodName)
      // namespace 前缀（如 videoClone）是对象而非方法；其子方法以点路径单独在列表中并逐个断言
      if (fn && typeof fn === 'object') continue
      expect(fn, methodName).toBeTypeOf('function')
      ipcRenderer.invoke.mockClear()
      fn(vi.fn(), vi.fn(), vi.fn())

      for (const [channel] of ipcRenderer.invoke.mock.calls) {
        expect(requiredLevelForChannel(channel), `${methodName} -> ${channel}`).toBe('public')
      }
    }
  })
})

// === 子模块路径解析（require 链可加载，确保 QM-2 require 路径校验）===
describe('子模块 require 链可加载', () => {
  it('require("./preload/publish") 不抛错', () => {
    expect(() => require('./preload/publish')).not.toThrow()
  })

  it('require("./preload/account") 不抛错', () => {
    expect(() => require('./preload/account')).not.toThrow()
  })

  it('require("./preload/system") 不抛错', () => {
    expect(() => require('./preload/system')).not.toThrow()
  })

  it('require("./preload/index") 不抛错（聚合入口）', () => {
    // index.js 内部 require('electron')，需启用 electron mock 才能在非 electron 进程中加载
    // 工厂函数子模块不依赖 electron，故前面所有测试均无需启用 mock
    __enableElectronMock()
    try {
      expect(() => require('./preload/index')).not.toThrow()
    } finally {
      __disableElectronMock()
    }
  })
})

describe('影视工程 film-engineering preload API', () => {
  it('createFilmEngineeringApi 应为函数且返回 17 个方法', () => {
    const { createFilmEngineeringApi } = require('./preload/film-engineering')
    expect(typeof createFilmEngineeringApi).toBe('function')
    const api = createFilmEngineeringApi(ipcRenderer)
    expect(Object.keys(api.filmEngineering).length).toBe(17)
  })

  it.each([
    ['status', 'film-engineering:status', []],
    ['listScenes', 'film-engineering:list-scenes', []],
    ['listShots', 'film-engineering:list-shots', ['scene-1', { limit: 100, offset: 0 }]],
    ['getShot', 'film-engineering:get-shot', ['shot-1']],
    ['doctrine', 'film-engineering:doctrine', []],
    ['copyText', 'film-engineering:copy-text', ['shot-1', 'full']],
    ['copyTexts', 'film-engineering:copy-texts', [['shot-1', 'shot-2'], 'blocks']],
    ['adaptScript', 'film-engineering:adapt-script', [{ script: '第一场\n剧情', characterMap: { ROKO: '小强' } }]],
    ['exportPrompts', 'film-engineering:export', [[{ shotId: 's1', prompt: 'p' }], 'markdown']],
    ['generateSelected', 'film-engineering:generate-selected', [[{ shotId: 's1', prompt: 'p' }], { aspectRatio: '16:9' }]],
    ['uploadReference', 'film-engineering:upload-reference', [{ dataUrl: 'data:image/png;base64,AAAA' }]],
    ['retryShot', 'film-engineering:retry-shot', [{ runId: 'run-1', shotIndex: 0 }]],
    ['downloadRecycled', 'film-engineering:download-recycled', [{ taskId: 't1', items: [{ shotId: 's1', orderIndex: 0 }] }]],
    ['productionPlan', 'film-engineering:production-plan', [{ shotIds: ['s1'] }]],
    ['productionRunBatch', 'film-engineering:production-run-batch', [{ taskId: 't1', shotIds: ['s1'], batchIndex: 0 }]],
    ['productionStatus', 'film-engineering:production-status', [{ taskId: 't1', shotIds: ['s1'] }]],
  ])('%s() 应转发到 invoke("%s")', (method, channel, args) => {
    const { createFilmEngineeringApi } = require('./preload/film-engineering')
    ipcRenderer.invoke.mockClear()
    const api = createFilmEngineeringApi(ipcRenderer)
    api.filmEngineering[method](...args)
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.invoke.mock.calls[0][0]).toBe(channel)
    expect(ipcRenderer.invoke.mock.calls[0].slice(1)).toEqual(args)
  })

  it('film-engineering 为公开方法（未登录可用）且主进程通道公开', () => {
    const { PUBLIC_METHODS } = require('./preload/access-control')
    const { requiredLevelForChannel } = require('./ipc-handlers/license-access-control')
    expect(PUBLIC_METHODS).toContain('filmEngineering')
    expect(PUBLIC_METHODS).toContain('filmEngineering.status')
    expect(PUBLIC_METHODS).toContain('filmEngineering.generateSelected')
    expect(requiredLevelForChannel('film-engineering:list-scenes')).toBe('public')
    expect(requiredLevelForChannel('film-engineering:generate-selected')).toBe('public')
  })
})
