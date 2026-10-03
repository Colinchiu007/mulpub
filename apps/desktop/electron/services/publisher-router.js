// @ts-check
/**
 * PublisherRouter 鈥?缁熶竴鍙戝竷璺敱
 *
 * 鏇夸唬 main.js 涓夋 if/else 璺敱锛岄泦涓鐞嗗钩鍙板埌鍙戝竷寮曟搸鐨勬槧灏勩€?
 * 骞冲彴淇℃伅浠?config/platforms.yaml 鍔犺浇锛堝崟鏁版嵁婧愶級銆?
 *
 * 鍙戝竷妯″紡锛?
 *   rpa_vm     鈥?RpaViewManager锛坋xecuteJavaScript 闅愯棌娴忚鍣級
 *   backend    鈥?Python FastAPI 鍚庣锛堥鐣欙級
 *
 * 鏂囦欢浣嶇疆: apps/desktop/electron/publisher-router.js
 */
const path = require('path')
const { execFile } = require('child_process')
const logger = require('./logger')
const PlatformConfig = require('@multi-publish/shared-utils/src/platform-config')
const { isPlatformCookieDomain } = require('@multi-publish/shared-utils/src/platform-definitions')
const { RichTextProcessor } = require('@multi-publish/api-publish-engine/src/rich-text-processor')
// 话题内联描述（publish-topic-inline-description）：描述文本是话题唯一真源，
// 主进程合并 tags 时把描述里的单井号内联话题一并并入（RichTextProcessor 只解析
// 双井号形态），供引擎侧三态处理（内联保留/转换/剥离）与 text_extra 标记消费。
const { extractInlineTopicNames } = require('@multi-publish/api-publish-engine/src/content-formatter')
const { getConfigPath } = require('./config-resolver')
const { buildApiTaskData } = require('./api-task-data')
// P1-5 语义级可见性：语义档位（public/friends/private）→ 平台字段值的单一真源在注册表层。
const { mapVisibilitySemantic } = require('@multi-publish/shared-utils/src/publish-capabilities')

// 鈹€鈹€鈹€ 璺敱琛紙纭害鏉燂級鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// mode: 鍙戝竷寮曟搸
//   'rpa_vm'  鈫?RpaViewManager锛坋xecuteJavaScript 寮曟搸锛屽綋鍓嶅敮涓€妯″紡锛?
//   'backend' 鈫?Python 鍚庣锛堥鐣欙級
const ROUTE_TABLE = {
  wechat_mp:    { mode: 'rpa_vm', timeout: 120000 },
  zhihu:        { mode: 'rpa_vm', timeout: 120000 },
  weibo:        { mode: 'rpa_vm', timeout: 120000 },
  douyin:       { mode: 'rpa_vm', timeout: 300000 },
  xiaohongshu:  { mode: 'rpa_vm', timeout: 120000 },
  tencent_video:{ mode: 'rpa_vm', timeout: 300000 },
  kuaishou:     { mode: 'rpa_vm', timeout: 300000 },
  toutiao:      { mode: 'rpa_vm', timeout: 120000 },
  bilibili:     { mode: 'api', timeout: 300000 },
  baijiahao:    { mode: 'api', timeout: 300000 },
  youtube:      { mode: 'rpa_vm', timeout: 300000 },
  tiktok:       { mode: 'rpa_vm', timeout: 300000 },
  twitter:      { mode: 'rpa_vm', timeout: 120000 },
  instagram:    { mode: 'rpa_vm', timeout: 120000 },
  facebook:     { mode: 'rpa_vm', timeout: 120000 },
  // 鈹€鈹€ 棰勭暀 鈹€鈹€
  // shipinhao: { mode: 'backend', timeout: 300000 },
}

function normalizeStringList (value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
}

function mergeUniqueStrings (...lists) {
  return [...new Set(lists.flat().filter(Boolean))]
}

function sanitizeDiagnosticEndpoint (url) {
  try {
    const parsed = new URL(String(url || ''))
    return parsed.origin + parsed.pathname
  } catch (_) {
    return ''
  }
}

function sanitizePublishResultUrl (url) {
  try {
    const parsed = new URL(String(url || ''))
    for (const key of [...parsed.searchParams.keys()]) {
      if (/(?:token|auth|cookie|session|signature|sign|credential|secret|ticket|code|sid)/i.test(key)) parsed.searchParams.delete(key)
    }
    parsed.hash = ''
    return parsed.toString()
  } catch (_) {
    return ''
  }
}

function sanitizePublishDiagnostics (diagnostics) {
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) return null
  const source = Array.isArray(diagnostics.responses)
    ? diagnostics.responses
    : (Array.isArray(diagnostics.requests) ? diagnostics.requests : [])
  const responseCountValue = Number(diagnostics.responseCount)
  const responseCount = Number.isFinite(responseCountValue) && responseCountValue >= 0
    ? Math.min(Math.floor(responseCountValue), 1000)
    : source.length
  const responses = source.slice(-20).map(item => ({
    endpoint: sanitizeDiagnosticEndpoint(item?.endpoint || item?.url),
    status: Number.isFinite(Number(item?.status)) ? Number(item.status) : 0,
    mimeType: String(item?.mimeType || '').split(';')[0].slice(0, 160),
  }))
  return {
    responseCount,
    responses,
    artifactFound: diagnostics.artifactFound === true || Boolean(diagnostics.artifact && diagnostics.artifact.postId),
  }
}

function resolveBooleanOption (override, base, key) {
  if (typeof override[key] === 'boolean') return override[key]
  return base[key] === true
}

// P1-4：公众号摘要 — platformOverrides.wechat_mp.digest 优先，其次文章基础字段
function override_digest (resolved) {
  const overrides = resolved.base.platformOverrides && typeof resolved.base.platformOverrides === 'object'
    ? resolved.base.platformOverrides
    : {}
  const o = overrides.wechat_mp && typeof overrides.wechat_mp === 'object' ? overrides.wechat_mp : {}
  return o.digest ?? resolved.base.digest ?? ''
}

/**
 * P1-5 通用区语义档位 → 该平台可见性字段值（无档位/该平台不支持该档位时返回 undefined，
 * 使调用点的 `?? ` 链继续回落到「不设」）。语义档位来自 taskData.visibilitySemantic，
 * 映射真源在注册表 semanticValues（mapVisibilitySemantic），此处不重复映射表。
 * @param {object} base
 * @param {string} platform
 * @returns {unknown|undefined}
 */
function semanticVisibilityValue (base, platform) {
  const semantic = String((base && base.visibilitySemantic) || '').trim()
  if (!semantic) return undefined
  const mapped = mapVisibilitySemantic(platform, semantic)
  return mapped === null ? undefined : mapped
}

function resolvePlatformArticle (task, platform) {
  const base = task && task.article && typeof task.article === 'object' ? task.article : {}
  const overrides = base.platformOverrides && typeof base.platformOverrides === 'object'
    ? base.platformOverrides
    : {}
  const override = overrides[platform] && typeof overrides[platform] === 'object'
    ? overrides[platform]
    : {}
  const resolved = {
    base,
    title: override.title || base.title || '',
    content: override.content || base.content || '',
  }
  if (platform === 'zhihu') {
    const declaration = Number(override.declare ?? base.declare ?? 0)
    resolved.commentPermission = 'anyone'
    resolved.declare = Number.isInteger(declaration) && declaration >= 0 && declaration <= 5
      ? declaration
      : 0
    resolved.topics = normalizeStringList(override.topics)
    resolved.draft = resolveBooleanOption(override, base, 'draft')
  } else if (platform === 'douyin') {
    resolved.draft = resolveBooleanOption(override, base, 'draft')
    // P1-5 可见性：抖音 item.common.visibility_type（0 公开 / 1 私密 / 2 好友）。
    // 引擎链读 taskData.visibility_type（douyin-video.js run/buildPostData），故键名用 snake。
    // 取值优先序：平台 override > 通用区语义档位映射 > 不设（用平台默认）
    const vt = Number(override.visibilityType ?? base.visibilityType ?? semanticVisibilityValue(base, platform))
    if (vt === 0 || vt === 1 || vt === 2) resolved.visibility_type = vt
  } else if (platform === 'weibo') {
    // P1-5 可见性：微博发布体 visible（0 公开 / 1 仅自己 / 6 好友圈）
    const visible = Number(override.visible ?? base.visible ?? semanticVisibilityValue(base, platform))
    if (visible === 0 || visible === 1 || visible === 6) resolved.visible = visible
  } else if (platform === 'kuaishou') {
    // P1-5 可见性：快手提交体 photoStatus（1 公开 / 2 仅自己）——引擎链读 td.visibilityType
    const vt = Number(override.visibilityType ?? base.visibilityType ?? semanticVisibilityValue(base, platform))
    if (vt === 1 || vt === 2) resolved.visibilityType = vt
  } else if (platform === 'wechat_mp') {
    resolved.massSend = resolveBooleanOption(override, base, 'massSend')
  }
  // P0-3：平台特有字段透传（参考同类产品统一 publishData 超集 + 每平台按需消费的架构）。
  // 字段从 platformOverrides[platform] 或文章基础字段解析，adapter 侧按平台消费。
  if (platform === 'bilibili') {
    // B站分区 tid + 版权声明（1=自制 2=转载）；参考产品映射：createType original→1, forward→2
    const category = Number(override.category ?? base.category)
    if (Number.isInteger(category) && category > 0) resolved.category = category
    const copyright = Number(override.copyright ?? base.copyright)
    if (copyright === 1 || copyright === 2) resolved.copyright = copyright
  } else if (platform === 'youtube') {
    // YouTube 分类 categoryId + 可见性 privacy（public/unlisted/private）
    const categoryId = String(override.categoryId ?? base.categoryId ?? '').trim()
    if (/^\d{1,2}$/.test(categoryId)) resolved.categoryId = categoryId
    const privacy = String(override.privacy ?? base.privacy ?? semanticVisibilityValue(base, platform) ?? '').trim()
    if (privacy === 'public' || privacy === 'unlisted' || privacy === 'private') resolved.privacy = privacy
  } else if (platform === 'tiktok') {
    // TikTok 可见性 privacy_level（PUBLIC/PRIVATE/FRIENDS）
    const privacyLevel = String(override.privacyLevel ?? base.privacyLevel ?? semanticVisibilityValue(base, platform) ?? '').trim()
    if (privacyLevel === 'PUBLIC' || privacyLevel === 'PRIVATE' || privacyLevel === 'FRIENDS') resolved.privacyLevel = privacyLevel
  } else if (platform === 'baijiahao') {
    // 百家号原创声明（original truthy → original_status=2）与位置
    if (typeof (override.original ?? base.original) === 'boolean') {
      resolved.original = Boolean(override.original ?? base.original)
    }
    const loc = override.location ?? base.location
    if (loc && typeof loc === 'object' && loc.uid) resolved.location = loc
    // UI 侧 locationName（手输位置名）→ 转为 adapter 消费的 location 对象（uid 用名称占位，
    // adapter 侧 uid 存在即传 position_lat_lng；无真实 POI 坐标时这是最诚实的降级）
    else {
      const locationName = String(override.locationName ?? base.locationName ?? '').trim()
      if (locationName) resolved.location = { uid: 'manual-' + locationName, name: locationName }
    }
  }
  // P2-1：合集/播放列表透传（B站 season_id、YouTube playlistId、百家号 bjhtopic）
  const collectionId = Number(override.collectionId ?? base.collectionId)
  if (Number.isInteger(collectionId) && collectionId > 0) resolved.collectionId = collectionId
  const playlistId = String(override.playlistId ?? base.playlistId ?? '').trim()
  if (/^[A-Za-z0-9_-]{5,60}$/.test(playlistId)) resolved.playlistId = playlistId
  const collection = override.collection ?? base.collection
  if (collection && typeof collection === 'object' && (collection.id || collection.sourceId)) {
    resolved.collection = collection
  }
  // UI 侧百家号合集输入 'ID' 或 'ID:名称' → collection 对象
  else if (platform === 'baijiahao') {
    const raw = String(override.collectionIdText ?? base.collectionIdText ?? '').trim()
    const m = raw.match(/^(\d+)(?::(.+))?$/)
    if (m) resolved.collection = { id: m[1], name: (m[2] || '').trim() }
  }
  // P3-1：商品（抖音 goodsInfoList / 小红书 shopping_cart）— 透传 goods 对象数组
  const goods = override.goods ?? base.goods
  if (Array.isArray(goods) && goods.length > 0 && goods.length <= 10) {
    resolved.goods = goods.map(function (g) {
      return { id: String(g.id || '').slice(0, 64), title: String(g.title || '').slice(0, 100) }
    }).filter(function (g) { return g.id })
  }
  // P3-2：任务/活动（抖音 hot_sentence/flashMobInfo）— 透传 taskId
  const taskId = String(override.taskId ?? base.taskId ?? '').trim()
  if (/^[A-Za-z0-9_-]{1,64}$/.test(taskId)) resolved.taskId = taskId
  return resolved
}

function buildPublishArticle (task, platform) {
  const resolved = resolvePlatformArticle(task, platform)
  const processed = new RichTextProcessor().process(resolved.content)
  const tags = mergeUniqueStrings(
    normalizeStringList(resolved.base.tags),
    processed.topics.map(topic => topic.name),
    // 话题内联描述：描述里的单井号 `#话题`（UI 追加管道写入）同样并入 tags，
    // 使「描述为真源」对手动编辑/追加的话题都成立（引擎侧按平台三态消费）
    extractInlineTopicNames(processed.content),
    resolved.topics || [],
  )
  const article = {
    accountId: task?.article?.accountId || task?.accountId || null,
    title: resolved.title,
    content: processed.content,
    video_path: resolved.base.video_path || (resolved.base.media_paths?.[0] ?? null),
    cover_path: resolved.base.cover_url || resolved.base.cover_path || null,
    tags,
    draft: resolved.draft ?? resolveBooleanOption({}, resolved.base, 'draft'),
    mentions: processed.mentions,
    // 2026-09-29 图文发布修复：article.images（本地文件路径，RPA 上传消费）优先透传——
    // 旧实现只传 processed.images（HTML 内容提取的 URL），渲染层附加的本地封面被静默丢弃，
    // 小红书/快手/抖音图文上传拿不到文件。base.images 存在时覆盖，否则保持内容提取语义。
    images: (Array.isArray(resolved.base.images) && resolved.base.images.length > 0)
      ? resolved.base.images.map(p => String(p))
      : processed.images,
    // P1-5：作者字段透传（原仅 wechat_mp RPA 硬编码消费，现全平台透传）
    author: String(resolved.base.author || '').slice(0, 60) || null,
  }
  // AI 生成内容声明：默认勾选（AI 生成内容），仅当显式 aiGenerated === false 时取消勾选。
  // 各平台发布时须如实声明内容创作方式，AI 生成内容不勾选会违规。
  article.aiGenerated = resolved.base.aiGenerated !== false
  if (platform === 'zhihu') {
    article.commentPermission = resolved.commentPermission
    article.declare = resolved.declare
  }
  if (platform === 'wechat_mp') article.massSend = resolved.massSend
  // P1-4 + P3-3：公众号摘要 + 评论开关（参考产品 digest/need_open_comment 映射）
  if (platform === 'wechat_mp') {
    const digest = String(override_digest(resolved) || '').trim()
    if (digest) article.digest = digest.slice(0, 120)
    if (typeof resolved.base.openComment === 'boolean') article.openComment = resolved.base.openComment
    else article.openComment = true // 默认开评论（公众号默认行为）
  }
  // P0-3：平台特有字段透传到 article（adapter buildPostData 消费）
  if (platform === 'bilibili') {
    if (resolved.category !== undefined) article.category = resolved.category
    if (resolved.copyright !== undefined) article.copyright = resolved.copyright
  }
  if (platform === 'youtube') {
    if (resolved.categoryId !== undefined) article.categoryId = resolved.categoryId
    if (resolved.privacy !== undefined) article.privacy = resolved.privacy
  }
  if (platform === 'tiktok' && resolved.privacyLevel !== undefined) article.privacyLevel = resolved.privacyLevel
  // P1-5 可见性：抖音/快手/微博三平台把语义映射值透传为引擎各自消费的字段名
  if (platform === 'douyin' && resolved.visibility_type !== undefined) article.visibility_type = resolved.visibility_type
  if (platform === 'kuaishou' && resolved.visibilityType !== undefined) article.visibilityType = resolved.visibilityType
  if (platform === 'weibo' && resolved.visible !== undefined) article.visible = resolved.visible
  if (platform === 'baijiahao') {
    if (resolved.original !== undefined) article.original = resolved.original
    if (resolved.location !== undefined) article.location = resolved.location
  }
  // P2-1：合集/播放列表透传到 article
  if (resolved.collectionId !== undefined) article.collectionId = resolved.collectionId
  if (resolved.playlistId !== undefined) article.playlistId = resolved.playlistId
  if (resolved.collection !== undefined) article.collection = resolved.collection
  // P3-1/P3-2/P3-4：商品/任务/投票/交叉发布透传
  if (resolved.goods !== undefined) article.goods = resolved.goods
  if (resolved.taskId !== undefined) article.taskId = resolved.taskId
  return article
}

function normalizeAuthData (credentials, platform) {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) return null
  if (credentials.platform && credentials.platform !== platform) return null
  const cookies = Array.isArray(credentials.cookies)
    ? credentials.cookies.filter(cookie => cookie && typeof cookie === 'object' && typeof cookie.domain === 'string' && isPlatformCookieDomain(platform, cookie.domain))
    : []
  const storedLocalStorage = credentials.localStorage ?? credentials.local_storage
  const localStorage = storedLocalStorage && typeof storedLocalStorage === 'object' && !Array.isArray(storedLocalStorage)
    ? storedLocalStorage
    : {}
  const indexedDB = credentials.indexedDB && typeof credentials.indexedDB === 'object' && !Array.isArray(credentials.indexedDB)
    ? credentials.indexedDB
    : {}
  if (cookies.length === 0 && Object.keys(localStorage).length === 0 && Object.keys(indexedDB).length === 0) return null
  const authData = { cookies, localStorage }
  if (Object.keys(indexedDB).length > 0) authData.indexedDB = indexedDB
  if (credentials.proxy !== undefined && credentials.proxy !== null) authData.proxy = credentials.proxy
  return authData
}

function getAccountForTask (store, accountId, ownerSubject) {
  if (!store || typeof store.getAccount !== 'function') return null
  return ownerSubject === undefined
    ? store.getAccount(accountId)
    : store.getAccount(accountId, ownerSubject)
}

function getDefaultAccountForTask (store, platform, ownerSubject) {
  if (!store || typeof store.getDefaultAccount !== 'function') return null
  return ownerSubject === undefined
    ? store.getDefaultAccount(platform)
    : store.getDefaultAccount(platform, ownerSubject)
}

function loadCredentialsForTask (accountManager, accountId, platform, ownerSubject) {
  if (!accountManager || typeof accountManager.loadSavedCredentials !== 'function') return null
  return ownerSubject === undefined
    ? accountManager.loadSavedCredentials(accountId, platform)
    : accountManager.loadSavedCredentials(accountId, platform, { ownerSubject })
}

/**
 * 解析任务指定的账号并加载其平台凭证（cookies/localStorage）。
 * RpaVmPublisher 与 ApiPublisher 共用；accountId 缺失时回退到平台默认账号。
 * @returns {{accountId: string|null, authData: object}}
 */
function loadAuthForTask (deps, platform, article, ownerSubject) {
  const store = deps.store
  const accountManager = deps.accountManager
  let accountId = article.accountId
  let authData = { cookies: [], localStorage: {} }
  if (accountId) {
    try {
      authData = normalizeAuthData(
        loadCredentialsForTask(accountManager, accountId, platform, ownerSubject),
        platform,
      ) || authData
    } catch (_) { /* 凭证回退不得阻断读取 */ }
    if (authData.cookies.length === 0 && (!authData.localStorage || Object.keys(authData.localStorage).length === 0)) {
      authData = normalizeAuthData(getAccountForTask(store, accountId, ownerSubject), platform) || authData
    }
  } else {
    const defaultAccount = getDefaultAccountForTask(store, platform, ownerSubject)
    if (defaultAccount) {
      accountId = defaultAccount.id || null
      article.accountId = accountId
      try {
        authData = normalizeAuthData(
          loadCredentialsForTask(accountManager, defaultAccount.id, platform, ownerSubject),
          platform,
        ) || authData
      } catch (_) { /* 凭证回退不得阻断读取 */ }
      if (authData.cookies.length === 0 && (!authData.localStorage || Object.keys(authData.localStorage).length === 0)) {
        const storeAuthData = normalizeAuthData(defaultAccount, platform)
        if (storeAuthData) authData = storeAuthData
      }
    }
  }
  return { accountId, authData }
}

/**
 * 用 ffprobe 探测视频宽高/时长（API 发布必须确认横版）。
 * 探测策略可被外部注入（测试/后端特化），默认走本地 ffprobe。
 * @returns {Promise<{width:number,height:number,duration:number}|null>}
 */
async function probeVideoInfo (videoPath, options = {}) {
  const exec = options.execFile || execFile
  const { findFfprobe } = require('./media-tool-paths')
  const ffprobe = findFfprobe(options.mediaToolOptions)
  if (!ffprobe) {
    const error = new Error('ffprobe 不可用，无法探测视频信息')
    error.code = 'FFPROBE_UNAVAILABLE'
    throw error
  }
  return new Promise((resolve, reject) => {
    exec(ffprobe, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration:format=duration',
      '-of', 'json',
      videoPath,
    ], { timeout: 30000 }, (err, stdout) => {
      if (err) {
        const error = new Error('ffprobe 探测视频失败: ' + (err.message || String(err)))
        error.code = 'FFPROBE_FAILED'
        return reject(error)
      }
      try {
        const data = JSON.parse(String(stdout || '{}'))
        const stream = data.streams && data.streams[0]
        const width = Number(stream && stream.width)
        const height = Number(stream && stream.height)
        if (!width || !height) return resolve(null)
        const duration = Number(stream && stream.duration) || Number(data.format && data.format.duration) || 0
        resolve({ width, height, duration })
      } catch (_) {
        reject(new Error('ffprobe 输出解析失败'))
      }
    })
  })
}

// 鈹€鈹€鈹€ 涓ょ Publisher 绛栫暐 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

// 视频发布要等平台大文件真实上传完成（强判定最长等 15 分钟）+转码/表单渲染，
// 路由表默认的 300s 会在上传中途杀任务（2026-09 smoke5/smoke6 实锤：
// kuaishou “timeout (300s)” 、B站 96MB 实测上传超 10 分钟），视频任务放宽到 30 分钟。
const VIDEO_RPA_TIMEOUT = 1800000
function resolveRpaTimeout (route, article) {
  const base = Number(route && route.timeout) || 0
  if (article && typeof article.video_path === 'string' && article.video_path.trim()) {
    return Math.max(base, VIDEO_RPA_TIMEOUT)
  }
  return base
}

class RpaVmPublisher {
  constructor (route, deps) {
    this.route = route
    this.rpaViewManager = deps.rpaViewManager
    this.store = deps.store
    this.accountManager = deps.accountManager
  }

  async publish (task, options = {}) {
    const platform = this.route.platform
    const ownerSubject = task && task.owner_subject
    const startedAt = Date.now()

    // 鍔犺浇璐﹀彿 Cookie
    const article = buildPublishArticle(task, platform)
    const { accountId, authData } = loadAuthForTask(
      { store: this.store, accountManager: this.accountManager },
      platform, article, ownerSubject,
    )

    const signal = options && options.signal
    if (signal?.aborted) {
      logger.notify('PublisherRouter', 'publish-cancelled', { level: 'WARN', params: { platform, accountId } })
      throw new Error('任务已取消')
    }
    const onAbort = () => {
      if (this.rpaViewManager && typeof this.rpaViewManager.cancel === 'function') {
        try {
          Promise.resolve(this.rpaViewManager.cancel(platform, accountId)).catch(() => {})
        } catch (_) { /* 取消清理不得覆盖任务取消结果 */ }
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const result = await this.rpaViewManager.publish(platform, article, authData, resolveRpaTimeout(this.route, article))
      // 发布器可能在 await 期间收到取消信号，成功响应不能覆盖取消语义。
      if (signal?.aborted) {
        logger.notify('PublisherRouter', 'publish-cancelled', { level: 'WARN', params: { platform, accountId } })
        throw new Error('任务已取消')
      }
      if (result.success) {
        const postId = typeof result.postId === 'string' && result.postId.trim()
          ? result.postId.trim()
          : (typeof result.publishId === 'string' && result.publishId.trim() ? result.publishId.trim() : '')
        if (['baijiahao', 'kuaishou'].includes(platform) && (!postId || postId === task.id || postId.toLowerCase().startsWith('task_'))) {
          throw new Error(result.error || '发布结果缺少平台作品 ID')
        }
        const diagnostics = sanitizePublishDiagnostics(result.diagnostics)
        logger.notify('PublisherRouter', 'rpa-publish-ok', {
          level: 'INFO',
          params: {
            platform,
            accountId,
            mode: 'dom',
            url: sanitizePublishResultUrl(result.url),
            durationMs: Date.now() - startedAt,
          },
        })
        return { success: true, url: sanitizePublishResultUrl(result.url), ...(postId ? { postId } : {}), platform, mode: 'dom', ...(diagnostics ? { diagnostics } : {}) }
      }
      throw new Error(result.error || 'RPA 鍙戝竷澶辫触')
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

class ApiPublisher {
  constructor (route, deps) {
    this.route = route
    this.rpaViewManager = deps.rpaViewManager
    this.store = deps.store
    this.accountManager = deps.accountManager
    this.probeVideo = deps.probeVideo || probeVideoInfo
    this.publishApi = deps.publishViaApi || null
  }

  /**
   * API 直调发布（BaijiahaoAdapter 移植参考产品发布链）。
   * 流程：凭证 → ffprobe 横版校验 → publishViaApi（上传/处理/发布）。
   */
  async publish (task, options = {}) {
    const platform = this.route.platform
    const ownerSubject = task && task.owner_subject
    const article = buildPublishArticle(task, platform)
    const { accountId, authData } = loadAuthForTask(
      { store: this.store, accountManager: this.accountManager },
      platform, article, ownerSubject,
    )
    const cookies = Array.isArray(authData.cookies) ? authData.cookies : []
    if (cookies.length === 0) {
      logger.notify('PublisherRouter', 'api-publish-error', {
        level: 'ERROR',
        errorCategory: 'auth_missing',
        error: '平台 Cookie 缺失（账号 ' + (accountId || '未指定') + ' 未登录或凭证不可用）',
        params: { platform, accountId, mode: 'api' },
      })
      throw new Error('平台 Cookie 缺失（账号 ' + (accountId || '未指定') + ' 未登录或凭证不可用）')
    }
    const cookie = cookies.map((c) => c.name + '=' + c.value).join('; ')
    const signal = options && options.signal
    if (signal && signal.aborted) {
      logger.notify('PublisherRouter', 'publish-cancelled', { level: 'WARN', params: { platform, accountId } })
      throw new Error('任务已取消')
    }
    // publish-progress-ux：API 直连轨此前完全静默——executor 传入的 onProgress
    // 透传给引擎（base-adapter execute 模板按 (percent, message) 回调）。
    const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null

    const videoPath = article.video_path
    // 图文 vs 视频分流：无 video_path 即图文（百家号/头条号只发图文，Q14，见 PRD §12.8）
    const isArticle = !videoPath
    let videoInfo = null
    if (!isArticle) {
      videoInfo = await this.probeVideo(videoPath)
      if (!videoInfo || !videoInfo.width || !videoInfo.height) throw new Error('视频信息探测失败（ffprobe 不可用或文件损坏）')
      if (videoInfo.width < videoInfo.height) throw new Error('竖版视频暂不支持 API 发布，请使用 RPA 发布')
    }

    const publishViaApi = this.publishApi || require('@multi-publish/api-publish-engine/src/index').publishViaApi
    // 形状翻译单一实现（api-task-data.js）：与 rpa-view-manager API-first 分支共用，
    // 防两路映射漂移（2026-09-28 活体残余①——RpaView 侧曾裸传 article 导致
    // 视频平台 API 轨 fail-closed）。
    const taskData = buildApiTaskData(article, videoInfo)

    const result = await publishViaApi(platform, taskData, cookie, {
      timeout: this.route.timeout,
      draft: article.draft === true,
      signal,
      ...(onProgress ? { onProgress } : {}),
    })
    if (signal && signal.aborted) {
      logger.notify('PublisherRouter', 'publish-cancelled', { level: 'WARN', params: { platform, accountId } })
      throw new Error('任务已取消')
    }
    if (!result || !result.success) throw new Error((result && result.error) || 'API 发布失败')
    const postId = typeof result.publishId === 'string' && result.publishId.trim() ? result.publishId.trim() : ''
    if (!postId) throw new Error('发布结果缺少平台作品 ID')
    return { success: true, url: sanitizePublishResultUrl(result.url || ''), postId, platform, mode: 'api' }
  }
}

class BackendPublisher {
  constructor (route, deps) {
    this.route = route
    this.pythonBridge = deps.pythonBridge
  }

  async publish (task) {
    const platform = this.route.platform
    const article = buildPublishArticle(task, platform)
    const body = {
      title: article.title,
      content: article.content,
      platform,
      media_paths: article.video_path ? [article.video_path] : (task?.article?.media_paths || []),
      cover_path: article.cover_path,
      tags: article.tags,
      draft: article.draft,
      mentions: article.mentions,
      images: article.images,
      ...(platform === 'zhihu' ? {
        commentPermission: article.commentPermission,
        declare: article.declare,
      } : {}),
      ...(platform === 'wechat_mp' ? { massSend: article.massSend } : {}),
    }

    const result = await this.pythonBridge.requestBackend('POST', '/api/publish', body)
    if (result.code === 0 && result.data?.success) {
      return { success: true, url: result.data.url || '', postId: result.data.task_id || task.id, platform }
    }
    const backendError = result.message || (result.data?.error || '鍙戝竷澶辫触')
    logger.notify('PublisherRouter', 'backend-publish-error', {
      level: 'ERROR',
      errorCategory: 'backend_error',
      error: String(backendError),
      params: { platform },
    })
    throw new Error(backendError)
  }
}

// 鈹€鈹€鈹€ Router 涓荤被 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

class PublisherRouter {
  /**
   * @param {string} [configPath] - platforms.yaml 璺緞锛岄粯璁や粠椤圭洰鏍圭洰褰曞姞杞?
   */
  constructor (configPath) {
    const resolvedPath = configPath || getConfigPath('platforms.yaml')
    this._platformConfig = new PlatformConfig(resolvedPath)
    this._routeTable = ROUTE_TABLE
  }

  /**
   * 鑾峰彇骞冲彴鐨勮矾鐢变俊鎭?
   * @param {string} platform
   * @returns {{ platform: string, mode: string, timeout: number, type: string, publishUrl: string }}
   */
  getRoute (platform) {
    const cfg = this._platformConfig.getPlatform(platform)
    if (!cfg) throw new Error("平台未配置: " + platform)

    const route = this._routeTable[platform]
    if (!route) throw new Error('Platform ' + platform + ' no route defined, please add in ROUTE_TABLE')

    return {
      platform,
      mode: route.mode,
      timeout: route.timeout,
      type: cfg.type || 'article',
      publishUrl: cfg.publish_url || '',
    }
  }

  /**
   * 鑾峰彇骞冲彴閰嶇疆
   */
  getPlatformConfig (platform) {
    return this._platformConfig.getPlatform(platform)
  }

  /**
   * 鍒楀嚭鎵€鏈夊钩鍙?
   */
  listPlatforms () {
    return this._platformConfig.listPlatforms()
  }

  /**
   * 鍒涘缓骞冲彴瀵瑰簲鐨勫彂甯冨櫒瀹炰緥
   *
   * @param {string} platform
   * @param {object} deps - { rpaViewManager, store, pythonBridge }
   * @returns {object} { publish(task): Promise<object> }
   */
  createPublisher (platform, deps) {
    const route = this.getRoute(platform)
    logger.notify('PublisherRouter', 'route-selected', { params: { platform, mode: route.mode } })

    switch (route.mode) {
      case 'rpa_vm':
        return new RpaVmPublisher(route, deps)
      case 'api':
        return new ApiPublisher(route, deps)
      case 'backend':
        return new BackendPublisher(route, deps)
      default:
        throw new Error("Unknown publish mode: " + route.mode + " (" + platform + ")")
    }
  }

  /**
   * 鑾峰彇璺敱琛紙鍙锛岀敤浜庤皟璇曪級
   */
  getRouteTable () {
    return { ...this._routeTable }
  }
}

module.exports = { PublisherRouter, ROUTE_TABLE, ApiPublisher, probeVideoInfo, loadAuthForTask, resolvePlatformArticle, buildPublishArticle }


