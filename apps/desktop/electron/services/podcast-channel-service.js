// @ts-check
'use strict'
/**
 * podcast-channel-service.js — 播客 RSS 频道（主进程侧持久化 + feed 编排）
 *
 * 架构前提（不要按「新增发布平台」理解本模块）：小宇宙等是 **RSS 聚合端**，没有发布 API。
 * 本服务维护的是独立的「频道」实体：频道元信息 + 单集列表 → 生成 Podcast RSS 文件，
 * 用户把 feed 地址一次性提交给聚合端。因此本模块 **不参与** publish-capabilities /
 * platform-definitions / RPA 选择器，也不给 publishMode 增加取值。
 *
 * 校验的唯一实现是 @multi-publish/shared-utils/src/podcast-rss：
 * 本文件不得另写一份校验或正则（AGENTS.md「单一真源」）。
 *
 * 落盘位置（全部在 userData 下，原子替换语义见 atomicRenameSync）：
 *   {userData}/podcast/channel.json   频道元信息（单频道）
 *   {userData}/podcast/episodes.json  单集列表
 *   {userData}/podcast/feed.xml       构建产物
 *
 * 日志纪律：只记计数 / 文件名 / 错误码，**绝不**记录频道标题、单集标题、邮箱、音频 URL。
 */

const path = require('path')
const crypto = require('crypto')
const NodeFs = require('fs')

const {
  validateChannel: engineValidateChannel,
  buildFeed: engineBuildFeed,
  parseFeed: engineParseFeed,
  verifyFeed: engineVerifyFeed,
  issue: engineIssue,
  ITEMS_MAX,
} = require('@multi-publish/shared-utils/src/podcast-rss')
const { listPodcastEndpoints } = require('@multi-publish/shared-utils/src/podcast-endpoints')
// 写前判据的唯一实现：字段规则一律留在引擎，本层不得再抄一份（PRD §9 三层校验位）
const { validateEpisode: engineValidateEpisode } = require('@multi-publish/shared-utils/src/podcast-rss')

const PODCAST_DIR_NAME = 'podcast'
const CHANNEL_FILE = 'channel.json'
const EPISODES_FILE = 'episodes.json'
const FEED_FILE = 'feed.xml'

// Windows 上 rename 目标被别的进程短暂占用是常态（编辑器/杀毒/本应用其它窗口），
// 只允许对这三个码做短且有界的退避重试，其它错误原样抛出，禁止无限重试。
// 口径与 credential-store / publish-history / account-state-restorer 一致（同一组常量被抄过三次，
// 收敛成一份工具模块属独立切片，不在本特性范围内）。
const TRANSIENT_WINDOWS_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY'])
const ATOMIC_RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160, 320, 640]
const ATOMIC_RENAME_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4))

/** 服务层错误码（PODCAST_ 前缀）：与引擎的校验码（CHANNEL / EPISODE / FEED 前缀）分属两个命名空间。 */
const SERVICE_ERRORS = {
  CHANNEL_INVALID: 'PODCAST_CHANNEL_INVALID',
  FEED_NOT_BUILT: 'PODCAST_FEED_NOT_BUILT',
  EPISODE_INVALID: 'PODCAST_EPISODE_INVALID',
  EPISODES_FULL: 'PODCAST_EPISODES_FULL',
  STORE_UNAVAILABLE: 'PODCAST_STORE_UNAVAILABLE',
  STORE_CORRUPT: 'PODCAST_STORE_CORRUPT',
}

function serviceError (code, message, extra) {
  const err = new Error(message)
  err.code = code
  if (extra) Object.assign(err, extra)
  return err
}

/**
 * 原子替换：临时文件 rename 到位；Windows 瞬时占用按有界退避重试，预算耗尽原样抛出。
 * @param {typeof import('fs')} fsImpl
 * @param {string} sourcePath
 * @param {string} targetPath
 * @param {number[]} retryDelaysMs
 */
function atomicRenameSync (fsImpl, sourcePath, targetPath, retryDelaysMs) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fsImpl.renameSync(sourcePath, targetPath)
      return
    } catch (error) {
      const delayMs = retryDelaysMs[attempt]
      const isTransientWindowsLock = process.platform === 'win32' &&
        TRANSIENT_WINDOWS_RENAME_ERRORS.has(error && error.code)
      if (!isTransientWindowsLock || delayMs === undefined) throw error
      Atomics.wait(ATOMIC_RENAME_WAIT_BUFFER, 0, 0, delayMs)
    }
  }
}

function noopLogger () {
  return { info () {}, warn () {}, error () {} }
}

function resolveDefaultLogger () {
  try {
    const log = require('./logger')
    if (log && typeof log.warn === 'function') return log
  } catch (_) {
    //  logger 不可用时不得让频道服务起不来；降级为静默但仍在返回值里出声
  }
  return noopLogger()
}

const { channelBusyGate, channelPublishPass, CHANNEL_BUSY_ERROR } = require('./podcast-channel-locks')

class PodcastChannelService {
  /**
   * @param {object} [options]
   * @param {string} [options.userDataDir] 显式 userData（测试用 os.tmpdir() 唯一目录）；
   *        与 app.getPath('userData') **同构**：本服务一律在其下再建 podcast/ 子目录，
   *        调用方不得传「已经含 podcast/」的路径（否则同一份数据在两条解析路径下落点不同）。
   * @param {{getPath: (name: string) => string}} [options.app] Electron app 替身；缺省时惰性取
   * @param {{info:Function,warn:Function,error:Function}} [options.logger]
   * @param {(url: string) => Promise<{status?:number,contentType?:string,contentLength?:number}>} [options.headImpl]
   *        feed 自检的 HEAD 探针；**缺省即跳过网络检查**（生产默认不发任何出站请求）
   * @param {typeof import('fs')} [options.fs]
   * @param {number[]} [options.renameRetryDelaysMs]
   * @param {() => Date} [options.now] 仅供测试注入构建时间
   */
  constructor (options = {}) {
    this._fs = options.fs || NodeFs
    this._logger = options.logger || null
    this._app = options.app || null
    this._headImpl = typeof options.headImpl === 'function' ? options.headImpl : null
    this._retryDelaysMs = Array.isArray(options.renameRetryDelaysMs) && options.renameRetryDelaysMs.length
      ? options.renameRetryDelaysMs.slice()
      : ATOMIC_RENAME_RETRY_DELAYS_MS
    this._now = typeof options.now === 'function' ? options.now : null
    const explicit = typeof options.userDataDir === 'string' ? options.userDataDir.trim() : ''
    this._userData = explicit || null
    this._rootResolved = Boolean(explicit)
    this._root = explicit ? path.join(explicit, PODCAST_DIR_NAME) : null
    // 多频道：registry 把「该频道的目录」交进来，本层不再自己拼 podcast/ 子目录。
    // 两条解析路径必须互斥 —— 同时接受 userDataDir 与 channelDir 会让同一份数据落到两处。
    const channelDir = typeof options.channelDir === 'string' ? options.channelDir.trim() : ''
    if (channelDir) {
      if (explicit) throw serviceError(SERVICE_ERRORS.STORE_UNAVAILABLE, 'userDataDir 与 channelDir 不得同时传')
      this._root = channelDir
      this._rootResolved = true
    }
    this._channelId = typeof options.channelId === 'string' ? options.channelId.trim() : ''
  }

  get logger () {
    if (!this._logger) this._logger = resolveDefaultLogger()
    return this._logger
  }

  /**
   * 惰性解析 userData 根目录。
   * ⛔ 禁止在模块顶层读 app.getPath —— 那会让本模块在纯 Node（vitest）下 import 即绑死
   * mock 路径，测试就再也无法做真实文件往返（AGENTS.md「落盘读回必须与存储实际返回类型一致」同源）。
   * @returns {string}
   */
  resolvePodcastDir () {
    if (this._rootResolved) return this._root
    /** @type {string|null} */
    let userData = null
    try {
      const app = this._app || require('electron').app
      if (app && typeof app.getPath === 'function') userData = app.getPath('userData')
    } catch (_) {
      userData = null
    }
    if (!userData || typeof userData !== 'string' || !userData.trim()) {
      throw serviceError(SERVICE_ERRORS.STORE_UNAVAILABLE, '播客频道存储不可用：无法解析 userData')
    }
    this._root = path.join(userData, PODCAST_DIR_NAME)
    this._rootResolved = true
    return this._root
  }

  _file (name) {
    return path.join(this.resolvePodcastDir(), name)
  }

  _ensureDir () {
    const dir = this.resolvePodcastDir()
    try {
      this._fs.mkdirSync(dir, { recursive: true })
    } catch (e) {
      throw serviceError(SERVICE_ERRORS.STORE_UNAVAILABLE,
        '播客频道目录不可写：' + (e && e.message ? e.message : String(e)))
    }
    return dir
  }

  /**
   * 读 JSON；文件不存在返回 fallback，**内容损坏一律抛错**（fail closed）。
   * 损坏时若静默返回空值，下一次保存会把用户已有数据整份覆盖掉。
   * @param {string} fileName
   * @param {any} fallback
   */
  _readJson (fileName, fallback) {
    const file = this._file(fileName)
    let raw
    try {
      if (!this._fs.existsSync(file)) return fallback
      raw = this._fs.readFileSync(file, 'utf8')
    } catch (e) {
      throw serviceError(SERVICE_ERRORS.STORE_UNAVAILABLE,
        '播客频道读取失败：' + fileName + ' ' + (e && e.message ? e.message : String(e)))
    }
    try {
      const parsed = JSON.parse(raw)
      if (parsed == null || typeof parsed !== 'object') throw new TypeError('not an object')
      return parsed
    } catch (e) {
      this.logger.warn('PodcastChannel', 'store corrupt: ' + fileName + ' (' + (e && e.message) + ')')
      throw serviceError(SERVICE_ERRORS.STORE_CORRUPT,
        '播客频道数据文件已损坏：' + fileName + '，本轮拒绝读写以免覆盖')
    }
  }

  /** 原子写 JSON：先写 .tmp.<pid>，再 rename 到位；失败必须清理临时文件且不掩盖原错误。 */
  _writeJson (fileName, value) {
    this._ensureDir()
    const file = this._file(fileName)
    const tmpPath = file + '.tmp.' + process.pid
    let renamed = false
    try {
      this._fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8')
      atomicRenameSync(this._fs, tmpPath, file, this._retryDelaysMs)
      renamed = true
    } finally {
      if (!renamed) {
        try {
          if (this._fs.existsSync(tmpPath)) this._fs.rmSync(tmpPath, { force: true })
        } catch (_) { /* 清理失败不掩盖原错误 */ }
      }
    }
    return file
  }

  /** 频道元信息；尚未配置返回 null。 */
  getChannel () {
    const store = this._readJson(CHANNEL_FILE, null)
    if (!store || typeof store !== 'object') return null
    // 两段结构（meta/feedSync）里 getChannel 只回 meta：渲染层与引擎看到的形状与单频道时代逐字一致
    if (store.meta && typeof store.meta === 'object') return store.meta
    if (store.channel && typeof store.channel === 'object') return store.channel
    return null
  }

  /** 发布同步元数据；从未发布过返回 null（「没同步过」与「同步失败」的排查方向不同，不得合并）。 */
  readFeedSync () {
    const store = this._readJson(CHANNEL_FILE, null)
    if (!store || !store.feedSync || typeof store.feedSync !== 'object') return null
    return store.feedSync
  }

  /** 写发布同步元数据：**保留 meta 原值**（本方法与 saveChannel 是两个方向的写者，谁都不许抹掉对方）。 */
  writeFeedSync (patch0) {
    this._assertNoPublishInFlight('feed:sync')
    const prev = this._readJson(CHANNEL_FILE, null)
    const meta = (prev && (prev.meta || prev.channel)) || null
    const feedSync = Object.assign({}, (prev && prev.feedSync) || {}, patch0 || {}, { updatedAt: new Date().toISOString() })
    this._writeJson(CHANNEL_FILE, { version: 1, meta: meta || {}, feedSync })
    return feedSync
  }

  /**
   * 保存频道（校验委托引擎；不通过即抛错并携带结构化 issues，**不落盘**）。
   * @param {object} channel
   * @returns {object} 已落盘的频道对象
   */
  /**
   * 手工写者与一键发布互斥的唯一判据：该频道此刻有发布在飞即拒绝（PRD 降级矩阵 busy 行）。
   * ⛔ 不得改成排队等待：一键发布跨 await、可达分钟级，把同步的手工写拖进等待队列只会让
   *    用户点一次「保存」看到转圈超时；同步写互相之间的串行由事件循环本身保证。
   */
  _assertNoPublishInFlight (section) {
    const key = this._channelId || this._root || ''
    // 发布通行证：发布编排自己写 feedSync / 重建 feed 时必须放行（同键、同步作用域，见 locks 模块注释）
    if (key && channelPublishPass.isPassed(key)) return
    if (!key || !channelBusyGate.isBusy(key)) return
    const e = new Error(CHANNEL_BUSY_ERROR + ': ' + section + ' 频道正在发布，请稍候')
    e.code = CHANNEL_BUSY_ERROR
    throw e
  }

  saveChannel (channel) {
    this._assertNoPublishInFlight('channel:save')
    if (!channel || typeof channel !== 'object' || Array.isArray(channel)) {
      throw serviceError(SERVICE_ERRORS.CHANNEL_INVALID, '频道数据必须是对象', {
        issues: [engineIssue('CHANNEL_MISSING', 'channel', '频道配置缺失')],
      })
    }
    const check = engineValidateChannel(channel)
    if (!check.ok) {
      throw serviceError(SERVICE_ERRORS.CHANNEL_INVALID,
        'PODCAST_CHANNEL_INVALID: ' + check.issues.map((i) => i.code).join(','), { issues: check.issues })
    }
    const previous = this.getChannel()
    const nowIso = new Date().toISOString()
    const stored = Object.assign({}, channel, {
      createdAt: (previous && previous.createdAt) || nowIso,
      updatedAt: nowIso,
    })
    // 改名不得抹掉发布状态（评审 #19）：feedSync 从旧文件原样带过来
    const prev = this._readJson(CHANNEL_FILE, null)
    this._writeJson(CHANNEL_FILE, { version: 1, meta: stored, feedSync: (prev && prev.feedSync) || null })
    this.logger.info('PodcastChannel', 'channel saved (fields=' + Object.keys(stored).length + ')')
    return stored
  }

  /** 上限与判据同源：渲染层要拿它做事前禁用，绝不允许自己写一份 1000（评审 D-8/#6）。 */
  episodeCap () {
    return ITEMS_MAX
  }

  /** 单集列表（未配置返回空数组）。 */
  listEpisodes () {
    const store = this._readJson(EPISODES_FILE, null)
    const list = store && Array.isArray(store.episodes) ? store.episodes : []
    return list.filter((x) => x && typeof x === 'object')
  }

  /**
   * 保存单集：按 id 原地更新；**guid 重复视为同一集**（不产生第二条）。
   *
   * 本方法**不做**引擎级字段校验：单集允许「先只登记本地文件、尚未拿到 https 直链」的中间态
   * （引擎的 EPISODE_HOSTING_NOT_CONFIGURED 正是为这一段准备的），真正的 fail closed 发生在 buildFeed。
   * @param {object} episode
   * @returns {object} 已落盘的单集
   */
  /**
   * @param {object} episode
   * @param {{strict?:boolean}} [options] strict=true 时校验**合并后的产物**，不过即整次拒绝；
   *        strict=false（手工路径）落盘照旧、只出声——「先登记本地文件、尚未拿到直链」的中间态是既有合法状态。
   */
  saveEpisode (episode, options = {}) {
    this._assertNoPublishInFlight('episode:save')
    if (!episode || typeof episode !== 'object' || Array.isArray(episode)) {
      throw serviceError(SERVICE_ERRORS.EPISODE_INVALID, '单集数据必须是对象')
    }
    const strict = options.strict === true
    const list = this.listEpisodes()
    const incomingId = typeof episode.id === 'string' ? episode.id.trim() : ''
    const incomingGuid = typeof episode.guid === 'string' ? episode.guid.trim() : ''

    // 先按 id 命中；再按 guid 命中（同一集换个入口保存也不得产生重复项）
    let index = incomingId ? list.findIndex((x) => x.id === incomingId) : -1
    if (index < 0 && incomingGuid) index = list.findIndex((x) => x.guid === incomingGuid)

    const nowIso = new Date().toISOString()
    if (index >= 0) {
      const merged = Object.assign({}, list[index], episode, {
        id: list[index].id,
        createdAt: list[index].createdAt || nowIso,
        updatedAt: nowIso,
      })
      // 校验对象必须是**合并结果**：只校验传入对象会让旧记录里的脏字段在合并中存活（评审 #24）
      this._checkEpisodeForWrite(merged, strict)
      list[index] = merged
      this._writeJson(EPISODES_FILE, { version: 1, episodes: list })
      this.logger.info('PodcastChannel', 'episode updated (total=' + list.length + ')')
      return merged
    }

    if (list.length >= ITEMS_MAX) {
      throw serviceError(SERVICE_ERRORS.EPISODES_FULL,
        '单集数已达上限 ' + ITEMS_MAX + '，请先删除后再添加')
    }
    const created = Object.assign({}, episode, {
      id: incomingId || 'ep_' + crypto.randomUUID(),
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    this._checkEpisodeForWrite(created, strict)
    list.push(created)
    this._writeJson(EPISODES_FILE, { version: 1, episodes: list })
    this.logger.info('PodcastChannel', 'episode created (total=' + list.length + ')')
    return created
  }

  /**
   * 写前判据：委托引擎 validateEpisode，**不在本层另写字段规则**。
   * @param {object} candidate 将要落盘的完整对象（合并结果，不是入参）
   * @param {boolean} strict
   */
  _checkEpisodeForWrite (candidate, strict) {
    const issues = engineValidateEpisode(candidate, 0)
    if (!issues || !issues.length) return
    if (strict) {
      throw serviceError(SERVICE_ERRORS.EPISODE_INVALID,
        'PODCAST_EPISODE_INVALID: ' + issues.map((i) => i.code).join(','), { issues })
    }
    // 非严格：落盘照旧但必须出声——「有判据可依却不吭声」是静默失真的起点
    this.logger.warn('PodcastChannel', 'episode saved with violations (codes=' + issues.map((i) => i.code).join(',') + ')')
  }

  /**
   * 删除单集。
   * @param {string} id
   * @returns {boolean} false = 该 id 不存在（调用方必须如实透传，不得恒回 true）
   */
  removeEpisode (id) {
    this._assertNoPublishInFlight('episode:remove')
    const key = typeof id === 'string' ? id.trim() : ''
    if (!key) return false
    const list = this.listEpisodes()
    const next = list.filter((x) => x.id !== key)
    if (next.length === list.length) return false
    this._writeJson(EPISODES_FILE, { version: 1, episodes: next })
    this.logger.info('PodcastChannel', 'episode removed (total=' + next.length + ')')
    return true
  }

  /**
   * 构建 Podcast RSS 并原子落盘。
   * 引擎校验不过 → 原样抛出（code PODCAST_FEED_INVALID + issues），**绝不写出半成品文件**。
   * @returns {{path:string, itemCount:number, bytes:number}} 不回传 xml 正文
   */
  buildFeed () {
    this._assertNoPublishInFlight('feed:build')
    const channel = this.getChannel()
    const episodes = this.listEpisodes()
    let xml
    try {
      xml = engineBuildFeed(channel, episodes, this._now ? { now: this._now() } : {})
    } catch (e) {
      // 失败计数只到「码」这一层：引擎的 message 是 PODCAST_FEED_INVALID:<码列表>，不含用户文本
      this.logger.warn('PodcastChannel', 'feed build rejected: ' + (e && e.message))
      throw e
    }
    // itemCount 取自己产物的解析结果（引擎的唯一解析实现），而不是输入数组长度——
    // 二者不一致时说明构建环节自己出了问题，这里必须如实反映文件内容。
    const itemCount = engineParseFeed(xml).itemCount
    this._ensureDir()
    const file = this._file(FEED_FILE)
    const tmpPath = file + '.tmp.' + process.pid
    let renamed = false
    try {
      this._fs.writeFileSync(tmpPath, xml, 'utf8')
      atomicRenameSync(this._fs, tmpPath, file, this._retryDelaysMs)
      renamed = true
    } finally {
      if (!renamed) {
        try {
          if (this._fs.existsSync(tmpPath)) this._fs.rmSync(tmpPath, { force: true })
        } catch (_) { /* 清理失败不掩盖原错误 */ }
      }
    }
    const bytes = Buffer.byteLength(xml, 'utf8')
    this.logger.info('PodcastChannel', 'feed built (items=' + itemCount + ' bytes=' + bytes + ')')
    return { path: file, itemCount, bytes }
  }

  /**
   * feed 自检：读回自家 feed 文件后交给引擎。
   * headImpl 缺省不注入＝跳过网络检查（生产默认零出站）。
   * @returns {Promise<{issues:Array, checks:Array, itemCount:number}>}
   */
  async verifyFeed () {
    const file = this._file(FEED_FILE)
    let xml = null
    try {
      if (this._fs.existsSync(file)) xml = this._fs.readFileSync(file, 'utf8')
    } catch (e) {
      throw serviceError(SERVICE_ERRORS.STORE_UNAVAILABLE,
        'feed 文件读取失败：' + (e && e.message ? e.message : String(e)))
    }
    if (xml == null) {
      // 「还没构建」与「构建出来但不合格」排查方向不同，不得合并成一句 FEED_NO_ITEMS
      return {
        issues: [engineIssue(SERVICE_ERRORS.FEED_NOT_BUILT, 'feed', '尚未生成 feed 文件，请先构建')],
        checks: [],
        itemCount: 0,
      }
    }
    const result = await engineVerifyFeed(xml, { headImpl: this._headImpl })
    this.logger.info('PodcastChannel',
      'feed verified (items=' + result.itemCount + ' issues=' + result.issues.length +
      ' checks=' + result.checks.length + ' head=' + (this._headImpl ? 'on' : 'off') + ')')
    return { issues: result.issues, checks: result.checks, itemCount: result.itemCount }
  }

  /** 分发端目录：直接透传共享层，本层不加判断。 */
  listEndpoints () {
    return listPodcastEndpoints()
  }

  /** feed 产物路径（供 UI 展示「把该地址提交给聚合端」旁的本地文件位置；不含内容）。 */
  feedFilePath () {
    return this._file(FEED_FILE)
  }
}

module.exports = PodcastChannelService
module.exports.SERVICE_ERRORS = SERVICE_ERRORS
module.exports.ATOMIC_RENAME_RETRY_DELAYS_MS = ATOMIC_RENAME_RETRY_DELAYS_MS
module.exports.PODCAST_FILES = { PODCAST_DIR_NAME, CHANNEL_FILE, EPISODES_FILE, FEED_FILE }
// 原子替换的唯一实现（Windows 上只对 EPERM/EACCES/EBUSY 有界退避）。凡「临时文件 + rename」
// 落盘到用户态的地方一律复用，不得第二份实现——两份退避口径必然漂移。
module.exports.atomicRenameSync = atomicRenameSync
