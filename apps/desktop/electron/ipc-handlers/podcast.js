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
 *   podcast:channel:get     → { code, data: { channel, feedSync } }
 *   podcast:channel:save    → { code, data: { channel } }
 *   podcast:episode:list    → { code, data: { episodes, cap, count, stock } }   // stock = §7.9.4 固化摘要，无凭据/计数不齐即 null
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
 * 成片一键出期（刀 3 第 3 片；完整合同见 PRD §6.4）：
 *   podcast:episode:publishFromVideo → { code, data: { state, phases, audioUrl, episodeId, itemCount, feedUrl, message, errorCode, errorMessage } }
 *   podcast:episode:publish:cancel   → { code, data: { outcome, phase } }   // outcome ∈ accepted|too_late|unknown
 * 出期前的只读预览（4.3②-a；完整合同见 PRD §7.10.4.1）：
 *   podcast:episode:planPreview → { code, data: { ok, plan: { totalBlocks, totalCodepoints }, voice|null } }
 *   // 这条通道不写任何东西；voice 为 null 表示「来源不显示」而不是「没解析出来」，计数缺失一律整块不显示
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
  // 空数组是 truthy —— 原判据把「按设计不带 issues」的错误（如 SECRET_MISSING 以 {issues:[]} 抛，
  // 意图就是与「字段不合格」区分开）也塞进 VALIDATION_ERROR 分支，envelope.code 于是成了错值。
  // 渲染层现按 subCode 取文案所以用户无感，但错误分类本身说谎，会让下一次按 code 分流的逻辑走错。
  const rawIssues = err && Array.isArray(err.issues) ? err.issues : null
  const issues = rawIssues && rawIssues.length ? rawIssues : null
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
  // tasks 4.4b：存量 mime 固化的宿主实例（进程内一份；跨进程的"已做过"只看 index 的 stockStamp）
  let stockHost = null
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
    // tasks 4.4b：首个需要该频道数据的调用顺手固化存量 mime（PRD §7.9 与 §7.9.7）。
    // 三条口径：① 旁路——装配或固化失败只 warn，绝不把用户的频道列表读请求打挂；
    // ② 进程内一份实例，跨进程的"已做过"由 stockStamp 自己判，这里不再判一次（两处判据必漂移）；
    // ③ 不 await——固化是补历史数据，不该出现在本次列表请求的关键路径上。
    try {
      if (!stockHost) {
        const { createStockFreezeHost } = require('../services/podcast-stock-freeze-host')
        stockHost = createStockFreezeHost({ registry: reg, logger: log })
      }
      stockHost.freezeChannel(id)
    } catch (e) {
      log.warn('[podcast] 存量固化旁路失败，不影响本次读取：' + ((e && e.message) || String(e)))
    }
    return svc
  }

  // ⛔ 通道名必须在下方 8 个注册点各自写成字符串字面量，不得收回本 helper
  // 或以循环注册：electron/tests/ipc-contract.test.js 的合同是按**源码字面量**抓取
  // preload 的 invoke 通道与主进程 handler 做双向对账的，间接注册会让整条通道
  // 从对账里消失（表现为「preload 有 8 个通道没有 handler」，而运行时其实一切正常）。
  // 另注：本文件注释内**禁止**出现 `ipcMain.handle(` 紧跟引号的写法——
  // .github/scripts/check-ipc-bridge.js 的 RE1 不区分注释与代码，会把注释里的示例
  // 当成真实注册过的通道，导致「Handler 已注册但 preload.js 未暴露」的假缺口。
  // 信封映射（唯一实现）。⚠️ 不要把它当成"守卫"：`check-ipc-sender-guard.js` 的显式守卫
  // 占比是按**注册点字面**统计的，经别名包装的注册只算咽喉点覆盖、不计入分子——
  // 新增通道若全走别名，就会把整体占比稀释到阈值以下（刀 2 加 4 条时实测 65.5% → 64.9% 判红）。
  // 因此新增注册一律写成 `withSenderCheck(handlerFor(...))`：守卫在注册点可见，映射仍只一份。
  const handlerFor = (label, fn) => async (_event, payload) => {
    try {
      // 第二个实参是本次调用的 sender 事件：只有出期进度这类「按调用方回发」的通道会读它，
      // 其余处理函数按既有形状只取 payload，多传一个实参不改变它们的行为。
      const data = await fn(payload, _event)
      return { code: 0, data }
    } catch (e) {
      // 只记通道名与错误消息：引擎消息仅含校验码，不含用户文本
      log.warn('[ipc:podcast] ' + label + ': ' + ((e && e.message) || String(e)))
      return toIpcError(e)
    }
  }
  const guarded = (label, fn) => withSenderCheck(handlerFor(label, fn))

  ipcMain.handle('podcast:channel:get', guarded('channel:get', (payload) => {
    // feedSync 与 meta 是同一份 channel.json 的两段（刀 1 的两段结构）。这里必须一起回：
    // 渲染层的「公网 feed 未同步」横幅只能读这一处，而 getChannel() 按既有合同只回 meta，
    // 少带这一段就等于「写侧落了盘、读侧没人看」——那条承诺就只存在于文档里。
    const svc = getService(channelOf(payload))
    return { channel: svc.getChannel(), feedSync: svc.readFeedSync() || null }
  }))

  ipcMain.handle('podcast:channel:save', guarded('channel:save', (payload) => {
    // 缺参同样交给服务判：saveChannel(null) 走引擎的 CHANNEL_MISSING，
    // 于是「没传对象」和「传了但不合格」共用**一份**校验实现，不在本层另写 issue 字面量。
    return { channel: getService(channelOf(payload), { writable: true }).saveChannel(unwrapObject(payload, 'channel')) }
  }))

  // L5 去重位：每次注册一份，随生命周期走，不跨用例污染
  let stockShapeWarned = false

  ipcMain.handle('podcast:episode:list', guarded('episode:list', (payload) => {
    const svc = getService(channelOf(payload))
    const episodes = svc.listEpisodes()
    // PRD §8.2：每期**追加**一个 compliance（闭集 ok|invalid|stock）。判据不在这里重写——
    // 只读重跑引擎 validateEpisode；stock 档另需 index 的 stockStamp 作凭据（缺凭据即不猜来源）。
    // 不对称口径：episodes 是主路、compliance 是旁路，旁路炸了只回落成「没有这个键」，
    // 不得丢期、不得让整个列表报错（§8.2.3 行 4）。
    let annotated = episodes
    let stock = null
    // 畸形 stockStamp 是**常驻**状态：不去重就每次列表刷新都同一句 warn（刷屏会把真信号冲掉）。
    // 位点放在本 registerHandlers 作用域而非模块作用域——模块级标记是跨用例状态，测试里会互相吞。
    try {
      const mod = (deps && deps.podcastEpisodeCompliance) || require('../services/podcast-episode-compliance')
      // 只取「已被解析过」的 registry：读 index 属旁路，不得在列表路径上第一次去碰 userData
      const stampRecord = mod.readStockStampRecord({ registry, logger: log, fsImpl: deps && deps.podcastFs })
      annotated = mod.annotateEpisodes({
        episodes,
        stockStamp: stampRecord ? stampRecord.at : null,
        channelId: channelOf(payload),
        logger: log,
      })
      // PRD §7.9.4：频道页的固化摘要与 compliance 共用上面那一次读（两份读必然漂移）
      stock = mod.toFreezeSummary(stampRecord)
      if (stampRecord && !stock) {
        // 凭据在位而计数不齐 = 固化层写出的形状本层不认识。出声，界面上是「整行不显示」而不是「0 期」
        if (!stockShapeWarned) {
          stockShapeWarned = true
          log.warn('[podcast-stock] stockStamp 在位但三个实测计数不齐，本次列表不显示固化摘要（同一进程只报一次）')
        }
      }
    } catch (e) {
      log.warn('[podcast-compliance] 标记失败，本次列表不带 compliance：' + e.message)
    }
    return { episodes: annotated, cap: svc.episodeCap(), count: episodes.length, stock }
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
      // 凭证存储可注入：测试必须能断言「secret 只进加密存储、不进 index.json」这条线。
      // ⛔ 这一行不能省：省略时服务会退回**真实** credential-store，本机因为有系统凭据保护而全绿，
      // CI runner 上 DPAPI 不可用 ⇒ saveCredential 返回 false ⇒ CRYPTO_UNAVAILABLE，
      // 表现为两条用例报 `expected -1 to be +0`（2026-10-10 shard 2 实测）。
      credentialStore: deps && deps.podcastCredentialStore,
    })
    return hostingService
  }

  // 出期宿主同样惰性构造：注册动作本身不得解析 media tool 路径（打包前它们可能不存在）。
  let episodeHost = deps && deps.podcastEpisodeHost ? deps.podcastEpisodeHost : null
  function getEpisodeHost () {
    if (episodeHost) return episodeHost
    const { createEpisodeHost } = require('../services/podcast-episode-host')
    const mediaToolPaths = require('../services/media-tool-paths')
    episodeHost = createEpisodeHost({
      registry: getRegistry(),
      channelServiceOf: (id, options) => getService(id, options),
      hostingService: getHostingService(),
      logger: log,
      // 打包产物优先；解析不到时宿主会把这一站判成抽取前置条件不成立，不回退宿主 PATH
      findFfmpeg: () => mediaToolPaths.findFfmpeg(),
      findFfprobe: () => mediaToolPaths.findFfprobe(),
    })
    return episodeHost
  }


  // 4.3②-a 的只读预览宿主（PRD §7.10.4.1）：计费二次确认框要显示的「切几块 / 多少码点 / 谁说话」
  // 只有这一处来源。三条不可让：
  // 1. **只读**——不建目录、不占频道忙标记、不碰出期宿主；判据在 podcast-plan-preview-ipc.test.js 按「缺席」取证
  //    （返回码为 0 不构成证据：顺手把真 store 拽进来也会照样回 0）。
  // 2. **不另算一个数**——分块判据仍是 planChunks 一份、音色回退仍是 resolveEpisodeVoice 一份；
  //    前端自抄一份切分必然与「实际发出去的块数」漂移，而那个数正是确认框唯一要告诉用户的。
  // 3. 缺实现即拒：deps 没接 store 或没接 modelProviderManager 时不猜默认值，让浮层如实显示「没解析出来」。
  let planPreview = deps && deps.podcastEpisodePlanPreview ? deps.podcastEpisodePlanPreview : null
  let previewDepWarned = false
  function getPlanPreview () {
    if (planPreview) return planPreview
    const { createEpisodePlanPreview } = require('../services/podcast-episode-plan-preview')
    const { createVoiceReaders } = require('../services/podcast-episode-tts-adapters')
    const catalog = require('../services/tts-voice-catalog')
    const { resolveProviderDefaultModel } = require('../services/model-provider-manager')
    const readers = createVoiceReaders({
      // 偏好键的字面量只在 adapters 那一处，本层不再抄一份（抄了就有两份键格式，改一处即漂移）
      readSetting: (key) => {
        const s = deps && deps.store
        if (!s || typeof s.getUserSetting !== 'function') {
          if (!previewDepWarned) {
            previewDepWarned = true
            log.warn('[ipc:podcast] 预览缺 store 注入：音色偏好按未配置处理（不猜默认音色，只报一次）')
          }
          return null
        }
        return s.getUserSetting(key, null, resolveIpcOwnerSubject(deps && deps.identityService))
      },
      getVoiceCapability: (providerId, model) => catalog.getVoiceCapability(providerId, model),
    })
    planPreview = createEpisodePlanPreview({
      channelRefOf: (channelId) => {
        // 只读：getService 不带 writable ⇒ 走 assertChannelExists，预览永远拿不到写判据
        const meta = getService(channelId).getChannel()
        return meta && meta.voiceRef && typeof meta.voiceRef === 'object' ? meta.voiceRef : null
      },
      defaultProviderOf: () => {
        const m = deps && deps.modelProviderManager
        if (!m || typeof m.getDefault !== 'function') {
          if (!previewDepWarned) {
            previewDepWarned = true
            log.warn('[ipc:podcast] 预览缺 modelProviderManager 注入：② ③ 两层没有定位键，将如实拒绝')
          }
          return null
        }
        const row = m.getDefault('tts')
        if (!row || !row.id) return null
        // 默认模型取法只有 model-provider-manager 一份实现，本层不自己挑 models[0]
        return { providerId: String(row.id), model: resolveProviderDefaultModel(row, 'tts') }
      },
      readPreference: readers.readPreference,
      getCapability: readers.getCapability,
      warn: (msg) => log.warn(String(msg || ''))
    })
    return planPreview
  }
  ipcMain.handle('podcast:hosting:get', withSenderCheck(handlerFor('hosting:get', async () => ({ hosting: getHostingService().getHosting() }))))

  ipcMain.handle('podcast:hosting:save', withSenderCheck(handlerFor('hosting:save', async (payload) => {
    // secret 缺席 = 保持不变，合并规则只在 hosting-service 一处；本层不判字段、不补默认值
    return { hosting: (await getHostingService().saveHosting(unwrapObject(payload, 'hosting'))).hosting }
  })))

  ipcMain.handle('podcast:hosting:check', withSenderCheck(handlerFor('hosting:check', async () => getHostingService().checkHosting())))

  ipcMain.handle('podcast:feed:publish', withSenderCheck(handlerFor('feed:publish', async (payload) => {
    const r = await getHostingService().publishFeed(channelOf(payload))
    // 只回可公开的形状：url 是公网地址，但不含签名头与凭证
    return {
      state: r.state, url: r.url || '', bytes: r.bytes || 0, itemCount: r.itemCount || 0,
      backupCreated: Boolean(r.backupCreated), prevExists: Boolean(r.prevExists),
      code: r.code || '', status: r.status == null ? null : r.status,
    }
  })))

  // ⛔ 通道名必须写成这里的**字面量**，不许收回变量或循环注册（见上方注释：对账按字面量抓取）。
  // 入参不含 outBase —— 临时目录基名由宿主按 runId 算，渲染层没有「写到哪」的决定权。
  ipcMain.handle('podcast:episode:publishFromVideo', withSenderCheck(handlerFor('episode:publishFromVideo', async (payload, event) => {
    // 三态（success/partial/cancelled）原样透出，不在本层压平：partial 的本地已登记、
    // 公网未更新是两种行动方向的唯一区分点。
    // §6.4.2 第三条通道：进度只回给**发起这一次调用的那个 sender**（不做全窗口广播，
    // 否则多窗口下 A 的遮罩会跟着 B 的出期走），宿主拿到的就是下面这个闭包，
    // 全仓发送点唯一在此。通道名写成字面量——对账脚本按字面量抓取，变量派发会造出假缺口。
    const sender = event && event.sender
    const emitProgress = (evt) => {
      if (!sender || typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return
      sender.send('podcast:episode:publish:progress', evt)
    }
    return await getEpisodeHost().publishFromVideo(payload || {}, { emitProgress })
  })))

  ipcMain.handle('podcast:episode:publish:cancel', withSenderCheck(handlerFor('episode:publish:cancel', async (payload) => {
    const runId = payload && typeof payload.runId === 'string' ? payload.runId : ''
    // outcome 三态如实回：unknown 是「已结束或从未登记」，不得读成「已取消」，
    // 否则界面会对一次已经发布成功的出期说「已取消，临时文件已回滚」。
    return getEpisodeHost().cancelPublish(runId)
  })))

  // 只读预览（PRD §7.10.4.1）。⛔ 通道名同样必须是字面量：electron/tests/ipc-contract.test.js 按字面量
  // 双向对账，收回变量或循环注册会让这条通道从对账里消失。
  ipcMain.handle('podcast:episode:planPreview', withSenderCheck(handlerFor('episode:planPreview', async (payload) => {
    const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    const script = typeof p.script === 'string' ? p.script : (typeof p.content === 'string' ? p.content : '')
    return getPlanPreview().previewEpisodePlan({ channelId: channelOf(payload), script })
  })))
}

module.exports = registerHandlers
module.exports.unwrapObject = unwrapObject
module.exports.toIpcError = toIpcError
