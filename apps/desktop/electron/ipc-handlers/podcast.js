// @ts-check
/**
 * podcast IPC handlers — 播客 RSS 频道的主进程入口
 *
 * 本层只做三件事，不承载业务逻辑：
 *   1. 入参解构与类型守卫（越早拒绝越省资源，且在产生副作用前失败）
 *   2. 调用 PodcastChannelService，并把领域错误映射成 UI 可消费的形状
 *   3. 返回 envelope 的键名严格对齐渲染层合同（见下「通道合同」）
 *
 * 通道合同（渲染层按同一份合同并行开发，**键名逐字不得改**）：
 *   podcast:channel:get     → { code, data: { channel } }
 *   podcast:channel:save    → { code, data: { channel } }
 *   podcast:episode:list    → { code, data: { episodes } }
 *   podcast:episode:save    → { code, data: { episode } }
 *   podcast:episode:remove  → { code, data: { removed } }
 *   podcast:feed:build      → { code, data: { path, itemCount, bytes } }
 *   podcast:feed:verify     → { code, data: { issues, checks, itemCount } }
 *   podcast:endpoints:list  → { code, data: { endpoints } }   // 频道无关，无入参
 * 频道目录（刀 1，均经 registry 而非按频道构造的 service）：
 *   podcast:channel:list           → { code, data: { channels, defaultChannelId, empty, migrationStatus, migrationConflicts } }
 *   podcast:channel:create|rename|setDefault → { code, data: { channel, channels, ... } }（同 list 的目录形状）
 *   podcast:channel:migrate:resolve → { code, data: { ...目录形状 } }
 * 托管与发布（刀 2；凭证全局一份，发布按频道）：
 *   podcast:hosting:get|save  → { code, data: { hosting } }   // hosting 是**掩码视图**，永不含 secret
 *   podcast:hosting:check     → { code, data: { checked, ok, status, hosting } }
 *   podcast:feed:publish      → { code, data: { state, url, bytes, itemCount, backupCreated, code, status } }
 * 校验失败：{ code: EC.VALIDATION_ERROR, message, issues }——issues 是引擎的结构化码数组，
 * 文案由渲染层按 code 出（本层不回传用户未发布的标题/音频地址，也不回传 xml 正文）。
 * 失败信封另带 `subCode`（领域码，如 PODCAST_HOSTING_UPLOAD_FAILED）：`code` 是 EC 数字、决定往哪查，
 * 只有它能区分「传输失败」与「校验不过」；渲染层在 call() 单点优先用 subCode 取文案。
 *
 * ⛔ 这里没有「发布到播客平台」的通道：小宇宙等是 RSS 聚合端，feed 地址由用户一次性提交。
 * 本模块不参与 publish-capabilities / platform-definitions / publishMode 的任何判定。
 */

const EC = require('../core/error-codes').ERROR
const { withSenderCheck, resolveIpcOwnerSubject } = require('./helpers')

/**
 * 入参解包：同时接受「对象本体」与 `{ <key>: 对象 }` 两种载荷形状。
 *
 * 为什么两套都收：渲染层与本层是并行开发的，载荷形状没有第三种东西（如类型定义）能锁住。
 * 只认一种时，另一种会在运行时变成「频道标题不能为空」这种**看起来像用户填错**的假校验错误，
 * 排查方向完全被带偏。解包只判形状，不做任何字段校验（字段校验的唯一实现在引擎）。
 * @param {any} payload
 * @param {string} key
 */
function unwrapObject (payload, key) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  // 合同键存在但形状不对（数组 / null / 标量）→ 判缺失：让服务出 CHANNEL_MISSING，
  // 而不是把外层壳当载荷交给引擎，后者会报出「标题不能为空」这种像用户填错的假校验错误。
  if (key in payload) {
    const inner = payload[key]
    return inner && typeof inner === 'object' && !Array.isArray(inner) ? inner : null
  }
  return payload
}

/** 领域错误 → IPC envelope。不同排查方向的错误不得合并成一句话。 */
function toIpcError (err) {
  const code = err && err.code
  const issues = err && Array.isArray(err.issues) ? err.issues : null
  if (issues) {
    return { code: EC.VALIDATION_ERROR, subCode: code || '', message: (err && err.message) || '校验未通过', issues }
  }
  if (code === 'PODCAST_EPISODE_NOT_FOUND') {
    return { code: EC.NOT_FOUND, subCode: code || '', message: (err && err.message) || '单集不存在' }
  }
  if (code === 'PODCAST_STORE_CORRUPT' || code === 'PODCAST_STORE_UNAVAILABLE' || code === 'PODCAST_EPISODES_FULL' || code === 'PODCAST_EPISODE_INVALID') {
    return { code: EC.VALIDATION_ERROR, subCode: code || '', message: (err && err.message) || '频道数据不可写' }
  }
  return { code: EC.REQUEST_ERROR, subCode: code || '', message: (err && err.message) || '操作失败' }
}

function registerHandlers (ipcMain, deps) {
  const log = (deps && deps.log) || require('../services/logger')
  // 托管服务按频道取：hosting 是全局一份（PRD D-4），但发布动作必须有频道上下文。
  // 身份三态唯一实现在 helpers.resolveIpcOwnerSubject，本处只转发（不得写第四份取 sub 的实现）。
  let hostingService = null

  // 服务实例惰性解析：注册动作本身不得触碰 userData 目录（测试环境同样走这条注册路径）。
  /** @type {any} */
  // 测试注入的单实例直通：不注入时才走 registry（多频道）
  let injected = deps && deps.podcastChannelService ? deps.podcastChannelService : null
  let registry = deps && deps.podcastRegistry ? deps.podcastRegistry : null
  const servicesByChannel = new Map()
  function getRegistry () {
    if (registry) return registry
    const PodcastChannelRegistry = require('../services/podcast-channel-registry')
    const root = deps && deps.podcastUserDataDir
      ? require('path').join(String(deps.podcastUserDataDir).trim(), 'podcast')
      : undefined
    registry = new PodcastChannelRegistry({
      podcastRoot: root,
      app: deps && deps.podcastApp,
      logger: log,
      credentialStore: deps && deps.podcastCredentialStore,
      idFactory: deps && deps.podcastIdFactory,
    })
    return registry
  }
  function channelOf (payload) {
    if (!payload || typeof payload !== 'object') return ''
    return typeof payload.channelId === 'string' ? payload.channelId.trim() : ''
  }
  function getService (channelId, options) {
    if (injected) return injected
    const id = String(channelId || '').trim()
    if (!id) {
      const e = new Error('PODCAST_CHANNEL_ID_REQUIRED: 缺少 channelId')
      e.code = 'PODCAST_CHANNEL_ID_REQUIRED'
      throw e
    }
    if (servicesByChannel.has(id)) return servicesByChannel.get(id)
    const PodcastChannelService = require('../services/podcast-channel-service')
    const reg = getRegistry()
    if (options && options.writable) reg.assertChannelWritable(id)
    else reg.assertChannelExists(id)
    const svc = new PodcastChannelService({
      channelDir: reg.channelDir(id),
      channelId: id,
      logger: log,
      // headImpl 必须由调用方显式注入；缺省即跳过网络检查（禁止默认发真实出站）
      headImpl: deps && deps.podcastHeadImpl,
    })
    servicesByChannel.set(id, svc)
    return svc
  }

  // ⛔ 通道名必须在下方 8 个注册点各自写成字符串字面量，不得收回本 helper
  // 或以循环注册：electron/tests/ipc-contract.test.js 的合同是按**源码字面量**抓取
  // preload 的 invoke 通道与主进程 handler 做双向对账的，间接注册会让整条通道
  // 从对账里消失（表现为「preload 有 8 个通道没有 handler」，而运行时其实一切正常）。
  // 另注：本文件注释内**禁止**出现 `ipcMain.handle(` 紧跟引号的写法——
  // .github/scripts/check-ipc-bridge.js 的 RE1 不区分注释与代码，会把注释里的示例
  // 当成真实注册过的通道，导致「Handler 已注册但 preload.js 未暴露」的假缺口。
  const guarded = (label, fn) => withSenderCheck(async (_event, payload) => {
    try {
      const data = await fn(payload)
      return { code: 0, data }
    } catch (e) {
      // 只记通道名与错误消息：引擎消息仅含校验码，不含用户文本
      log.warn('[ipc:podcast] ' + label + ': ' + ((e && e.message) || String(e)))
      return toIpcError(e)
    }
  })

  ipcMain.handle('podcast:channel:get', guarded('channel:get', (payload) => ({ channel: getService(channelOf(payload)).getChannel() })))

  ipcMain.handle('podcast:channel:save', guarded('channel:save', (payload) => {
    // 缺参同样交给服务判：saveChannel(null) 走引擎的 CHANNEL_MISSING，
    // 于是「没传对象」和「传了但不合格」共用**一份**校验实现，不在本层另写 issue 字面量。
    return { channel: getService(channelOf(payload), { writable: true }).saveChannel(unwrapObject(payload, 'channel')) }
  }))

  ipcMain.handle('podcast:episode:list', guarded('episode:list', (payload) => {
    const svc = getService(channelOf(payload))
    const episodes = svc.listEpisodes()
    return { episodes, cap: svc.episodeCap(), count: episodes.length }
  }))

  ipcMain.handle('podcast:episode:save', guarded('episode:save', (payload) => {
    const svc = getService(channelOf(payload), { writable: true })
    // strict 由调用方声明：一键路径要整次拒绝，手工路径保留「先登记、后补直链」的中间态只出声
    const strict = Boolean(payload && payload.strict === true)
    return { episode: svc.saveEpisode(unwrapObject(payload, 'episode'), { strict }) }
  }))

  ipcMain.handle('podcast:episode:remove', guarded('episode:remove', (payload) => {
    const id = typeof payload === 'string' ? payload
      : (payload && typeof payload.id === 'string' ? payload.id : '')
    if (!id.trim()) {
      const e = new Error('缺少参数 id')
      e.code = 'PODCAST_EPISODE_INVALID'
      throw e
    }
    // 必须看服务判定结果：id 不存在时恒回 removed:true 会让 UI 显示「已删除」而库里纹丝不动
    if (!getService(channelOf(payload), { writable: true }).removeEpisode(id)) {
      const e = new Error('单集不存在')
      e.code = 'PODCAST_EPISODE_NOT_FOUND'
      throw e
    }
    return { removed: true }
  }))

  ipcMain.handle('podcast:feed:build', guarded('feed:build', (payload) => {
    const r = getService(channelOf(payload), { writable: true }).buildFeed()
    return { path: r.path, itemCount: r.itemCount, bytes: r.bytes }
  }))

  ipcMain.handle('podcast:feed:verify', guarded('feed:verify', async (payload) => {
    const r = await getService(channelOf(payload)).verifyFeed()
    return { issues: r.issues, checks: r.checks, itemCount: r.itemCount }
  }))

  // 分发端目录是**频道无关**的：给它加 channelId 语义不成立（评审 #4），也不得借用需要 channelId 的
  // service 构造——那会让本通道在生产路径上恒抛 PODCAST_CHANNEL_ID_REQUIRED（评审 i2）。
  ipcMain.handle('podcast:endpoints:list', guarded('endpoints:list', () => ({ endpoints: require('@multi-publish/shared-utils/src/podcast-endpoints').listPodcastEndpoints() })))

  ipcMain.handle('podcast:channel:list', guarded('channel:list', () => getRegistry().listChannels()))

  ipcMain.handle('podcast:channel:create', guarded('channel:create', (payload) => {
    const name = payload && typeof payload.name === 'string' ? payload.name : ''
    return getRegistry().createChannel(name)
  }))

  ipcMain.handle('podcast:channel:rename', guarded('channel:rename', (payload) => {
    const name = payload && typeof payload.name === 'string' ? payload.name : ''
    return getRegistry().renameChannel(channelOf(payload), name)
  }))

  ipcMain.handle('podcast:channel:setDefault', guarded('channel:setDefault', (payload) =>
    getRegistry().setDefaultChannel(channelOf(payload))
  ))

  ipcMain.handle('podcast:channel:migrate:resolve', guarded('channel:migrate:resolve', (payload) => {
    const direction = payload && typeof payload.direction === 'string' ? payload.direction : ''
    return getRegistry().resolveMigration(direction)
  }))

  function getHostingService () {
    if (hostingService) return hostingService
    const PodcastHostingService = require('../services/podcast-hosting-service')
    hostingService = new PodcastHostingService({
      registry: getRegistry(),
      // 频道服务由本层按 channelId 提供：路径解析与 feedSync 的落盘唯一实现都在它那里
      channelOf: (channelId) => getService(channelId, { writable: true }),
      ownerSubject: () => resolveIpcOwnerSubject(deps && deps.identityService),
      logger: log,
      // httpClient 缺省不注入 = 生产路径零真实出站；探测与上传必须由测试显式注入假 client
      httpClient: deps && deps.podcastHttpClient,
      // 凭证存储可注入：测试必须能断言「secret 只进加密存储、不进 index.json」这条线
    })
    return hostingService
  }

  ipcMain.handle('podcast:hosting:get', guarded('hosting:get', async () => ({ hosting: getHostingService().getHosting() })))

  ipcMain.handle('podcast:hosting:save', guarded('hosting:save', async (payload) => {
    // secret 缺席 = 保持不变，合并规则只在 hosting-service 一处；本层不判字段、不补默认值
    return { hosting: (await getHostingService().saveHosting(unwrapObject(payload, 'hosting'))).hosting }
  }))

  ipcMain.handle('podcast:hosting:check', guarded('hosting:check', async () => getHostingService().checkHosting()))

  ipcMain.handle('podcast:feed:publish', guarded('feed:publish', async (payload) => {
    const r = await getHostingService().publishFeed(channelOf(payload))
    // 只回可公开的形状：url 是公网地址，但不含签名头与凭证
    return {
      state: r.state, url: r.url || '', bytes: r.bytes || 0, itemCount: r.itemCount || 0,
      backupCreated: Boolean(r.backupCreated), code: r.code || '', status: r.status == null ? null : r.status,
    }
  }))
}

module.exports = registerHandlers
module.exports.unwrapObject = unwrapObject
module.exports.toIpcError = toIpcError
