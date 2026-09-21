'use strict'

const { ERROR } = require('../core/error-codes')
const { isTrustedSender } = require('../core/ipc-security')

const PUBLIC_CHANNELS = new Set([
  'app:get-version', 'app:get-platform',
  'update:check', 'update:download', 'update:install', 'update:install-now',
  'first-run:check', 'show-notification',
  'onboarding:complete', 'onboarding:get-steps', 'onboarding:status',
  'license:info', 'license:activate', 'license:deactivate',
  'license:activate-trial', 'license:has-feature', 'license:features',
  'payment:create-order', 'payment:list-orders', 'payment:get-order', 'payment:cancel',
  'auth:open-login', 'auth:complete-login', 'auth:close', 'auth:login-silent',
  'auth:open-qrcode-login', 'auth:qrcode-close',
  'oauth:start', 'oauth:close', 'oauth:get-configs',
  'platform:list', 'platform:get', 'platform:definitions',
  'offline:status', 'offline:is-offline', 'offline:cached-tasks',
  'offline:add-to-cache', 'offline:clear-cache',
  'hotkeys:list',
  'sensitive:check', 'sensitive:replace',
  'sync:all', 'sync:platform', 'sync:cached',
  'webview:set-layout', 'webview:open-tab', 'webview:close-tab',
  'webview:close-all', 'webview:list-tabs',
  // 模型服务商配置：只读通道未登录可用（离线查看/测试已配置模型，保持本地钥匙串语义）；
  // 写操作（create/update/delete/set-default/clean-logs）不在 public 列表 → 默认 authenticated（需登录）。
  'model-provider:list', 'model-provider:get', 'model-provider:get-default',
  'model-provider:test', 'model-provider:presets',
  'model-provider:is-configured', 'model-provider:logs',
  'ops-center-sync:get', 'ops-center-sync:save', 'ops-center-sync:now', 'ops-center-sync:runtime', 'ops-center-sync:pipelineOptions',
  'logs:info', 'logs:clear', 'logs:error', 'feedback:submit',
  'notify:log',
  'render:status', 'render:install-deps',
  'pipeline:list', 'pipeline:get', 'pipeline:history',
  // 本地只读历史通道：未登录时也可查看本机创作历史（写/敏感通道仍要求登录）。
  //  - story2video:list-projects / story2video:get-project：项目数据按 owner 隔离（__legacy__=设备级本地空间）
  //  - pipeline:history：设备级 run 历史（不过滤 owner，本地内存/持久化快照）
  'story2video:list-projects', 'story2video:get-project', 'story2video:get-thumbnail',
  // 本地媒体导入（story2video:import-media）：把用户经 webUtils 选中的文件复制到应用控制的
  // 临时目录（kind/扩展名/大小校验 + withSenderCheck 可信来源），纯设备本地操作、不暴露私有数据，
  // 未登录/未激活许可证时也必须可用，否则图片轮播的背景音乐/旁白/视频素材选择完全不可用（2026-08-09）。
  'story2video:import-media',
  // BGM 素材库（story2video:bgm-library-*）：设备级持久化素材库（userData/story2video-bgm），
  // 添加/改名/删除/列表均为纯本地文件操作，未登录可用（与 import-media 同属本地素材管理）。
  'story2video:bgm-library-list', 'story2video:bgm-library-add',
  'story2video:bgm-library-rename', 'story2video:bgm-library-delete',
  // 流水线「保存配置」（story2video:config-profile-*）：设备级命名组合配置库
  // （userData/story2video-config-profiles），保存/应用/改名/删除均为纯本地操作，未登录可用。
  'story2video:config-profile-list', 'story2video:config-profile-create',
  'story2video:config-profile-rename', 'story2video:config-profile-delete',
  // 批量创作文件选择（story2video:pick-batch-files）：纯本地系统对话框（.txt/.md 多选），
  // 与 video-clone:pick-file 同属设备本地操作，未登录可用；批量创建/状态/取消需登录（story2video_write）。
  'story2video:pick-batch-files',
  // 视频克隆（本地分析流水线）：run/cancel/edit/regenerate/history/pick-file 未登录可用；发布经 PublisherRouter（外部验收边界）
  'video-clone:run', 'video-clone:cancel', 'video-clone:report:edit', 'video-clone:report:regenerate',
  'video-clone:pick-file', 'video-clone:history',
  'film-engineering:status', 'film-engineering:list-scenes', 'film-engineering:list-shots',
  'film-engineering:get-shot', 'film-engineering:doctrine',
  'film-engineering:copy-text', 'film-engineering:copy-texts',
  'film-engineering:adapt-script', 'film-engineering:export', 'film-engineering:generate-selected',
  'film-engineering:retry-shot',
  'usage:stats', 'usage:daily', 'usage:track',
  'identity:get-state', 'identity:sign-in', 'identity:switch-account', 'identity:sign-out',
  // 服务状态面板：纯本地只读诊断信息，未登录可见（与 identity:* 对齐）
  'services:get-status',
  // 热文采集/改写：URL 正文提取/RSS/Sitemap 均为纯本地操作，未登录可用
  'aggregation:collect', 'aggregation:collect-batch', 'aggregation:rewrite',
  'aggregation:sources', 'aggregation:task-status',
  // 采集回退层（Node url-collector）：与 aggregation:collect 同为纯本地 URL 提取，
  // 未登录必须开放，否则主路径失败后回退层被 license 拦截（-3），采集彻底不可用
  'url-collect:fetch',
  // 反爬站点路由查询（纯函数，无网络副作用）：与 url-collect:fetch 同为采集通道
  'url-collect:needs-stealth',
  // 热门选题：公开热搜榜单聚合，纯本地抓取，未登录可用
  'hot-topics:fetch', 'hot-topics:get-cache',
  // 知乎收藏夹：官方 API + 本地批量采集/改写（用户自己的收藏内容），未登录可用
  'zhihu-favlist:list', 'zhihu-favlist:contents',
  'zhihu-favlist:batch-collect', 'zhihu-favlist:batch-rewrite', 'zhihu-favlist:cancel',
  // 爆款分析/文案生成/趋势（viral:*）：与 aggregation/hot-topics 同属本地内容工具，
  // orchestrator 不可用时 ViralEngine 自动回退本地启发式分析（v2.3.43 设计意图即离线可用），
  // 未登录必须开放，否则本地兜底被 -3 AUTH_REQUIRED 门禁架空，功能整体不可用（2026-09-21）。
  'viral:analyze', 'viral:generate', 'viral:trending',
])

const ADMIN_ONLY_CHANNELS = new Set([
  'payment:complete', 'payment:simulate',
  'proxy:test', 'proxy:test-all', 'proxy:reset',
])

// 业务权益是服务端权威；本地 license 只在身份服务未启用的兼容模式生效。
// 本地 RPA 发布沿用现有 cloud_publish 产品权益名，避免客户端自行发明一套套餐。
const CHANNEL_FEATURE_MAP = Object.freeze({
  'publish:wechat': 'cloud_publish',
  'publish:batch': 'cloud_publish',
  'cloud-publisher:submit': 'cloud_publish',
  'cloud-publisher:list-tasks': 'cloud_publish',
  'cloud-publisher:get-task': 'cloud_publish',
})

// 登录即可（authenticated）的基础功能 feature 预留映射（2026-08-11）。
// 语义：这些通道要求登录（不在 PUBLIC_CHANNELS），但当前【不强制】服务端下发
// feature —— 服务端 entitlement 尚未同步或未下发这些 feature 时，登录用户照常可用，
// 避免锁死现有用户。未来如需会员分级：把对应通道从本表移入 CHANNEL_FEATURE_MAP，
// 并让服务端 /api/v1/me 下发对应 feature（缺失即拒，见 requireEntitlement）。
const LOGIN_ONLY_FEATURE_MAP = Object.freeze({
  // 发布历史 / 队列 / 进度
  'history:list': 'publish_history',
  'history:get': 'publish_history',
  'history:delete': 'publish_history',
  'queue:status': 'publish_history',
  'queue:history': 'publish_history',
  'queue:cancel': 'publish_history',
  'queue:retry': 'publish_history',
  'dashboard:stats': 'publish_history',
  // 流水线写操作/运行控制
  'pipeline:start': 'pipeline_run',
  'pipeline:pause': 'pipeline_run',
  'pipeline:resume': 'pipeline_run',
  'pipeline:cancel': 'pipeline_run',
  'pipeline:status': 'pipeline_run',
  'pipeline:advance': 'pipeline_run',
  'pipeline:fetch': 'pipeline_run',
  // 视频处理 / 渲染（消耗本机资源）
  'video:status': 'video_process',
  'video:list-process-types': 'video_process',
  'video:list-analyze-types': 'video_process',
  'video:list-stock-sources': 'video_process',
  'video:process': 'video_process',
  'video:analyze': 'video_process',
  'video:mix-audio': 'video_process',
  'video:search-stock': 'video_process',
  'video:generate-subtitle': 'video_process',
  'render:start': 'video_process',
  'render:cancel': 'video_process',
  'render:validate-props': 'video_process',
  'render:list-compositions': 'video_process',
  'render:get-composition': 'video_process',
  // Story2Video 写操作
  'story2video:delete-project': 'story2video_write',
  'story2video:update-segments': 'story2video_write',
  'story2video:replace-segment-audio': 'story2video_write',
  'story2video:retry-segment': 'story2video_write',
  'story2video:recompose-project': 'story2video_write',
  'story2video:select-scene-material': 'story2video_write',
  'story2video:generate-scene-image': 'story2video_write',
  'story2video:generate-scene-video': 'story2video_write',
  'story2video:generate-scene-ai-video': 'story2video_write',
  'story2video:regenerate-scene-subtitle': 'story2video_write',
  'story2video:regenerate-scene-audio': 'story2video_write',
  'story2video:regenerate-scene-prompt': 'story2video_write',
  'story2video:transcribe': 'story2video_write',
  'story2video:capabilities': 'story2video_write',
  'story2video:export-zip': 'story2video_write',
  'story2video:create-share-url': 'story2video_write',
  'story2video:copy-path': 'story2video_write',
  'story2video:show-in-folder': 'story2video_write',
  'story2video:save-as': 'story2video_write',
  'story2video:batch:create': 'story2video_write',
  'story2video:batch:status': 'story2video_write',
  'story2video:batch:cancel': 'story2video_write',
  // 模型服务商配置写操作（2026-08-11：未登录被拒）
  'model-provider:create': 'model_provider_write',
  'model-provider:update': 'model_provider_write',
  'model-provider:delete': 'model_provider_write',
  'model-provider:set-default': 'model_provider_write',
  'model-provider:clean-logs': 'model_provider_write',
})

const ONLINE_ONLY_FEATURE_CHANNELS = new Set([
  'cloud-publisher:submit',
  'cloud-publisher:list-tasks',
  'cloud-publisher:get-task',
])

function getAccessLevel(licenseManager, env = process.env, app, identityService) {
  if (identityService) {
    try {
      const status = identityService.getState().status
      return status === 'authenticated' || status === 'offline_authenticated'
        ? 'authenticated'
        : 'public'
    } catch (_) {
      return 'public'
    }
  }
  // 打包状态是开发管理员短路的唯一权威，避免残留环境变量在生产包中提权。
  const isDevMode = app && app.isPackaged === false
  if (isDevMode) return 'admin'
  try {
    if (licenseManager && typeof licenseManager.isPro === 'function' && licenseManager.isPro()) {
      return 'authenticated'
    }
  } catch (_) {
    // 许可证状态不可读时按最低权限处理。
  }
  return 'public'
}

function requiredLevelForChannel(channel) {
  if (ADMIN_ONLY_CHANNELS.has(channel)) return 'admin'
  if (PUBLIC_CHANNELS.has(channel)) return 'public'
  return 'authenticated'
}

function requiredFeatureForChannel(channel) {
  return CHANNEL_FEATURE_MAP[channel] || null
}

// 是否为「登录即可」的基础功能通道（feature 预留，见 LOGIN_ONLY_FEATURE_MAP）。
function isLoginOnlyFeatureChannel(channel) {
  return Object.prototype.hasOwnProperty.call(LOGIN_ONLY_FEATURE_MAP, channel)
}

function hasAccess(currentLevel, requiredLevel) {
  if (requiredLevel === 'public') return true
  if (requiredLevel === 'authenticated') {
    return currentLevel === 'authenticated' || currentLevel === 'admin'
  }
  return currentLevel === 'admin'
}

function denied(channel) {
  return {
    code: ERROR.AUTH_ERROR,
    errorCode: 'AUTH_REQUIRED',
    // 用户可见文案不得包含内部通道名；通道名仅作诊断（messageParams.channel）。
    message: '当前许可证无权访问该功能，请先登录并确认账号已开通所需权益后重试。',
    messageParams: { channel },
  }
}

function entitlementDenied(channel) {
  return {
    code: ERROR.AUTH_ERROR,
    errorCode: 'ENTITLEMENT_REQUIRED',
    message: '当前账号没有所需权益，无法使用该功能。请升级或开通对应权益后重试。',
    messageParams: { channel },
  }
}

function untrustedSender() {
  return {
    code: ERROR.AUTH_ERROR,
    errorCode: 'UNTRUSTED_SENDER',
    message: '未授权的调用来源',
  }
}

/**
 * 包装 ipcMain.handle。权限在 handler 执行时读取，而不是注册时缓存。
 */
function createAccessControlledIpcMain(ipcMain, licenseManager, env = process.env, app, identityService) {
  return new Proxy(ipcMain, {
    get(target, property, receiver) {
      if (property !== 'handle') {
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      }

      const registerHandle = target.handle.bind(target)
      return function registerProtectedHandler(channel, handler) {
        const requiredLevel = requiredLevelForChannel(channel)
        return registerHandle(channel, async function dynamicallyAuthorizedHandler(...args) {
          const event = args[0]
          if (!isTrustedSender(event, app)) return untrustedSender()
          if (requiredLevel !== 'public') {
            const currentLevel = getAccessLevel(licenseManager, env, app, identityService)
            if (!hasAccess(currentLevel, requiredLevel)) return denied(channel)
          }
          const feature = requiredFeatureForChannel(channel)
          if (feature && identityService) {
            // 开发/未打包模式跳过业务权益校验（与 getAccessLevel 的 dev admin 短路一致）：

            // 本地验证发布流程时账号可能未开通 cloud_publish，产品权益门禁不应阻塞开发/测试。

            const isDevMode = app && app.isPackaged === false

            if (!isDevMode) {

            if (typeof identityService.requireEntitlement !== 'function') return entitlementDenied(channel)
            try {
              await identityService.requireEntitlement(feature, {
                onlineOnly: ONLINE_ONLY_FEATURE_CHANNELS.has(channel),
              })
            } catch (_) {
              return entitlementDenied(channel)
            }
            }

          }
          return handler.apply(this, args)
        })
      }
    },
  })
}

module.exports = {
  ADMIN_ONLY_CHANNELS,
  PUBLIC_CHANNELS,
  CHANNEL_FEATURE_MAP,
  LOGIN_ONLY_FEATURE_MAP,
  createAccessControlledIpcMain,
  getAccessLevel,
  hasAccess,
  requiredLevelForChannel,
  requiredFeatureForChannel,
  isLoginOnlyFeatureChannel,
}
