'use strict'

/**
 * podcast-hosting-service.js — 播客托管直传的服务层（刀 2）
 *
 * 它存在的理由只有三件，每一件都不能交给上层或下层单独做：
 * 1) **凭证只在内存里短暂存在**：AK/SK 走 `credential-store` 的按 owner 分区加密落盘，
 *    `index.json` 只留 `credentialRef` 与可回显的非敏感字段。界面上任何读取都必须走
 *    `getHosting()` 的掩码输出 —— secret 一旦进 IPC 返回值，就会进渲染层状态、进 DevTools、
 *    进崩溃转储，而那三者都没有「只看一下」的边界。
 * 2) **「改 bucket 不必重输 secret」与「不许用空 secret 静默覆写有效凭证」必须同时成立**：
 *    `:save` 收到的 secret 缺席 = 从存储取旧值回填后再校验；显式 `clearSecret` 才是删除。
 *    缺前者，用户每改一次 endpoint 都要重输；缺后者，一次「表单没带 secret」的保存会把
 *    长期 AK 抹成空串，之后每次上传 403，而界面仍显示「已配置」——这是本模块最重的错。
 * 3) **发布失败必须分层**：没有 feed 产物（本地就没东西，公网未变）与 PUT 失败（公网未变、
 *    已记 attemptedAt）在界面上是两句话，不得压成一句「发布失败」。
 *
 * ⛔ 出站判据：`httpClient` 必须由调用方注入。缺省即 **零真实出站**（与 `headImpl` 同口径，
 *    仓内 `network-egress-guard` 会把漏注入的打红），`checkHosting()` 缺省如实返回
 *    「未探测」，不得返回「配置正常」——那是把「没检查」伪装成「检查过」。
 */

const path = require('path')
const fs = require('fs')

const {
  validateHosting,
  normalizePathPrefix,
  objectPublicUrl,
  buildOssPutHeaders,
  putObject,
  DEFAULT_PATH_PREFIX,
} = require('./podcast-hosting-upload')
const { channelPublishPass } = require('./podcast-channel-locks')
const { atomicRenameSync, ATOMIC_RENAME_RETRY_DELAYS_MS } = require('./podcast-channel-service')

const HOSTING_ERRORS = {
  IDENTITY_REQUIRED: 'PODCAST_HOSTING_IDENTITY_REQUIRED',
  SECRET_MISSING: 'PODCAST_HOSTING_SECRET_MISSING',
  CRYPTO_UNAVAILABLE: 'PODCAST_HOSTING_CRYPTO_UNAVAILABLE',
  FEED_NOT_BUILT: 'PODCAST_FEED_NOT_BUILT',
  HOSTING_INVALID: 'PODCAST_HOSTING_INVALID',
  REGISTRY_REQUIRED: 'PODCAST_HOSTING_REGISTRY_REQUIRED',
}

const MASK_KEEP = 4
const PROBE_TIMEOUT_MS = 8000
const DEFAULT_REF = 'podcast-hosting'

function err (code, message, extra) {
  const e = new Error(code + ': ' + message)
  e.code = code
  if (extra) Object.assign(e, extra)
  return e
}

function noopLogger () {
  return { info () {}, warn () {}, error () {} }
}

/** AK 掩码：只留尾 4 位。留前缀会与本仓「日志/响应禁记凭证」的口径打架；尾 4 位足以定位是哪把钥匙。 */
function maskAccessKeyId (id) {
  const s = String(id || '')
  if (!s) return ''
  return s.length <= MASK_KEEP ? '*'.repeat(s.length) : '*'.repeat(s.length - MASK_KEEP) + s.slice(-MASK_KEEP)
}

class PodcastHostingService {
  /**
   * @param {object} options
   * @param {import('./podcast-channel-registry')} options.registry 频道目录（hosting 真源 + 发布忙标记）
   * @param {(channelId: string) => {buildFeed: Function, writeFeedSync: Function}} options.channelOf
   *        按频道取频道服务：**路径解析与 feedSync 的落盘唯一实现都在频道服务**，本层不得自己拼目录
   * @param {object} [options.credentialStore] credential-store 替身（测试注入）
   * @param {() => (string|null|undefined)} [options.ownerSubject] **三态**：string=有身份；
   *        null=有身份服务但认不出是谁（必须 fail closed）；undefined=legacy 档（允许）
   * @param {object} [options.app] Electron app 替身
   * @param {object} [options.logger]
   * @param {{put: Function}} [options.httpClient] PUT 客户端；缺省不发出任何请求
   * @param {(d: Date) => string} [options.dateImpl] OSS Date 头（测试固定）
   * @param {typeof import('fs')} [options.fsImpl]
   */
  constructor (options = {}) {
    if (!options || !options.registry) throw err(HOSTING_ERRORS.REGISTRY_REQUIRED, '托管服务必须持有频道目录')
    if (typeof options.channelOf !== 'function') throw err('PODCAST_HOSTING_CHANNEL_RESOLVER_REQUIRED', '托管服务必须能按频道取频道服务')
    this._registry = options.registry
    this._channelOf = options.channelOf
    this._credentialStore = options.credentialStore || require('./credential-store')
    this._ownerSubject = typeof options.ownerSubject === 'function' ? options.ownerSubject : () => undefined
    this._app = options.app || null
    this._logger = options.logger || null
    this._httpClient = options.httpClient && typeof options.httpClient.put === 'function' ? options.httpClient : null
    this._dateImpl = typeof options.dateImpl === 'function' ? options.dateImpl : null
    this._fs = options.fsImpl || fs
    this._userData = null
  }

  get logger () {
    if (!this._logger) {
      this._logger = (() => {
        try {
          const log = require('./logger')
          if (log && typeof log.warn === 'function') return log
        } catch (_) { /* logger 不可用不得让托管起不来 */ }
        return noopLogger()
      })()
    }
    return this._logger
  }

  userDataDir () {
    if (!this._userData) {
      let app = this._app
      if (!app) { try { app = require('electron').app } catch (_) { app = null } }
      if (!app || typeof app.getPath !== 'function') {
        throw err(HOSTING_ERRORS.CRYPTO_UNAVAILABLE, '无法解析 userData，凭证无处落盘（不得静默写相对路径）')
      }
      this._userData = app.getPath('userData')
    }
    return this._userData
  }

  /** 身份三态：`null` 一律拒绝写入——「认不出是谁」不等于「没有身份」；`undefined` 走 legacy 档。 */
  resolveOwner () {
    const owner = this._ownerSubject()
    if (owner === null) throw err(HOSTING_ERRORS.IDENTITY_REQUIRED, '当前登录态无法确定归属，已阻止写入托管凭证')
    return owner
  }

  /** 读取永不回显 secret；`configured` 以「凭证真的取得到」为准，而不是以 ref 存在为准。 */
  getHosting () {
    const stored = this._registry.readHosting() || {}
    const secretPair = this._readSecret(stored.credentialRef)
    return {
      provider: stored.provider || 'oss',
      endpoint: stored.endpoint || '',
      bucket: stored.bucket || '',
      pathPrefix: stored.pathPrefix || DEFAULT_PATH_PREFIX,
      credentialRef: stored.credentialRef || '',
      maskedAccessKeyId: secretPair ? maskAccessKeyId(secretPair.accessKeyId) : (stored.maskedAccessKeyId || ''),
      configured: Boolean(stored.credentialRef && secretPair),
      updatedAt: stored.updatedAt || '',
    }
  }

  _readSecret (ref) {
    if (!ref) return null
    try {
      const data = this._credentialStore.loadCredential(ref, this.userDataDir(), this.resolveOwner())
      if (!data || typeof data !== 'object') return null
      const accessKeyId = String(data.accessKeyId || '')
      const accessKeySecret = String(data.accessKeySecret || '')
      if (!accessKeyId || !accessKeySecret) return null
      return { accessKeyId, accessKeySecret, securityToken: String(data.securityToken || '') }
    } catch (e) {
      this.logger.warn('PodcastHosting', 'credential read failed (ref=' + ref + '): ' + ((e && e.message) || String(e)))
      return null
    }
  }

  /**
   * 保存托管配置（async：index.json 的写必须在 index 锁内 await 完成）。缺席字段沿用旧值（PRD §6.3）
   * `PODCAST_HOSTING_CREDENTIAL_REQUIRED` 从「字段不合格」里单独摘出来判：它正是
   * 「没带 secret 且也没有可复用的旧凭证」这一种情形，要给出可行动的文案而不是混在格式错里。
   */
  async saveHosting (patch) {
    if (!patch || typeof patch !== 'object') throw err(HOSTING_ERRORS.HOSTING_INVALID, '托管配置必须是对象')
    const prev = this._registry.readHosting() || {}
    const owner = this.resolveOwner()
    const prevSecret = this._readSecret(prev.credentialRef)
    const next = {
      provider: patch.provider != null ? patch.provider : prev.provider,
      endpoint: patch.endpoint != null ? patch.endpoint : prev.endpoint,
      bucket: patch.bucket != null ? patch.bucket : prev.bucket,
      pathPrefix: patch.pathPrefix != null ? patch.pathPrefix : prev.pathPrefix,
    }

    if (patch.clearSecret === true) {
      if (prev.credentialRef) {
        try {
          this._credentialStore.deleteCredential(prev.credentialRef, this.userDataDir(), owner)
        } catch (e) {
          this.logger.warn('PodcastHosting', 'credential delete failed: ' + ((e && e.message) || String(e)))
        }
      }
      await this._registry.writeHosting(Object.assign({}, next, { credentialRef: '', maskedAccessKeyId: '' }))
      this.logger.info('PodcastHosting', 'hosting secret cleared (ref removed)')
      return { hosting: this.getHosting() }
    }

    const prevAk = prevSecret ? String(prevSecret.accessKeyId || '') : ''
    const inputKeyId = patch.accessKeyId != null ? String(patch.accessKeyId).trim() : ''
    const keyId = inputKeyId || prevAk
    // secret 也必须先 trim 再判缺席：`'   '` 若当真值用，会**静默销毁**已存的真实凭证**，
    // 而 `configured` 仍是 true（validateHosting 的 CREDENTIAL_REQUIRED 恰好在下一行被过滤掉，
    // 判据又只挡空串）。语义口径只有一条：**空白 = 缺席 = 沿用已存凭证**，与渲染层一致。
    const inputSecret = patch.accessKeySecret != null ? String(patch.accessKeySecret).trim() : ''
    // 「半新半旧」的另一半（QM-6 后端评审命中）：只换 AccessKeyId、不重填 Secret，
    // 会把**新 AK 配旧 Secret** 存下去——两值都非空所以过校验，`configured` 仍为 true，
    // 但从此每次上传都 403，而界面只显示「上传失败」，用户完全看不到真正的原因是键配错。
    // 成对重填是唯一不自相矛盾的口径：Secret 不回显，所以也无法"带着旧 Secret 换个 AK"。
    if (inputKeyId && prevAk && inputKeyId !== prevAk && !inputSecret) {
      throw err(HOSTING_ERRORS.SECRET_MISSING, '更换 AccessKeyId 必须同时重填 AccessKeySecret（新 AK 配旧 Secret 签名必然 403）', { issues: [] })
    }
    const secret = inputSecret || (prevSecret ? prevSecret.accessKeySecret : '')
    const issues = validateHosting(Object.assign({}, next, { accessKeyId: keyId, accessKeySecret: secret }))
      .filter((i) => i && i.code !== 'PODCAST_HOSTING_CREDENTIAL_REQUIRED')
    if (issues.length) throw err(HOSTING_ERRORS.HOSTING_INVALID, '托管配置不合格', { issues })
    if (!keyId || !secret) {
      throw err(HOSTING_ERRORS.SECRET_MISSING, '缺少 AccessKeyId / AccessKeySecret，且没有可复用的已存凭证；请重新填写一次', { issues: [] })
    }

    const ref = prev.credentialRef || DEFAULT_REF
    const wrote = this._credentialStore.saveCredential(ref, { accessKeyId: keyId, accessKeySecret: secret, securityToken: String(patch.securityToken || '') }, this.userDataDir(), owner)
    if (!wrote) throw err(HOSTING_ERRORS.CRYPTO_UNAVAILABLE, '凭证未能加密落盘（系统凭据保护不可用或被拒绝），已停止保存')

    // registry 的 index 写一律在 index 锁内 ⇒ 返回的是 promise。**不 await 就是「报成功而没落盘」**，
    // 而 `getHosting()` 读的是磁盘状态，会把这种半态伪装成「未配置」（刀 2 实测踩过）。
    await this._registry.writeHosting(Object.assign({}, next, { credentialRef: ref, maskedAccessKeyId: maskAccessKeyId(keyId) }))
    this.logger.info('PodcastHosting', 'hosting saved (ref=' + ref + ', issues=' + issues.length + ')')
    return { hosting: this.getHosting() }
  }

  /** 探测可达性；未注入 httpClient 时如实回「未探测」。 */
  async checkHosting () {
    const view = this.getHosting()
    if (!view.configured) return { checked: false, reason: 'PODCAST_HOSTING_NOT_CONFIGURED', hosting: view }
    if (!this._httpClient) return { checked: false, reason: 'PODCAST_HOSTING_CHECK_SKIPPED', hosting: view }
    const secret = this._readSecret(view.credentialRef)
    // 探测键必须**唯一且自带命名空间**。原来写死 `<prefix>/probe.txt`：用户 bucket 里若已有
    // 同名对象（这名字太容易被占用），点一次「测试连通」就把人家的文件覆写了——
    // 一个只该验证凭证与可达性的动作产生了真实写入副作用。
    // 不用 HEAD：HEAD 要求对象已存在，而未发布过的频道必然 404，那会被读成"凭证不通"。
    // 留给运维的口径：这些探针对象写在 `_podcast-probe/` 前缀下，bucket 生命周期规则可直接清掉。
    const probeStamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8)
    const objectKey = normalizePathPrefix(view.pathPrefix) + '/_podcast-probe/probe-' + probeStamp + '.txt'
    const url = objectPublicUrl({ endpoint: view.endpoint, bucket: view.bucket, objectKey })
    if (!url) throw err(HOSTING_ERRORS.HOSTING_INVALID, '无法由 endpoint/bucket 拼出可探测地址')
    const headers = buildOssPutHeaders({
      endpoint: view.endpoint,
      bucket: view.bucket,
      objectKey,
      contentType: 'text/plain',
      accessKeyId: secret.accessKeyId,
      accessKeySecret: secret.accessKeySecret,
      date: this._dateImpl ? this._dateImpl(new Date()) : undefined,
    })
    try {
      const res = await this._httpClient.put(url, 'probe', { headers, timeout: PROBE_TIMEOUT_MS, validateStatus: () => true })
      const status = Number(res && res.status)
      return { checked: true, ok: status >= 200 && status < 300, status: Number.isInteger(status) ? status : null, hosting: view }
    } catch (e) {
      this.logger.warn('PodcastHosting', 'hosting probe failed: ' + ((e && e.message) || String(e)))
      return { checked: true, ok: false, status: null, hosting: view }
    }
  }

  /**
   * 覆盖上传本频道的 feed.xml。顺序不可换：**先建回滚点，再覆盖主键**。
   * 反过来做的话主键写坏就没有任何一份「上次成功的 feed」可退，聚合端定时抓到的是坏 feed——
   * 那比不发布严重。回滚点建不出来**不阻断**主上传（`backupCreated:false` + 界面标注），
   * 因为「因为建不出回滚点就拒绝发布」会把用户锁死在原地。
   */
  async publishFeed (channelId) {
    const id = String(channelId || '').trim()
    if (!id) throw err('PODCAST_CHANNEL_ID_REQUIRED', '发布 feed 必须指定频道')
    if (!this._registry.tryBeginPublish(id, { reason: 'feed:publish' })) {
      const busy = err('PODCAST_CHANNEL_BUSY', '该频道有一次发布正在进行，请等它结束')
      busy.channelId = id
      throw busy
    }
    try {
      const svc = this._channelOf(id)
      const dir = this._registry.channelDir(id)
      const feedPath = path.join(dir, 'feed.xml')
      const prevPath = path.join(dir, 'feed.prev.xml')
      // 回滚点必须**先于 buildFeed** 落快照。buildFeed 就地覆写 feed.xml，在那之后复制出来的
      // "prev" 其实是本次产物——它不是回滚点，只是同一份内容的第二份拷贝（QM-6 后端评审命中）。
      const hadPrevious = this._fs.existsSync(feedPath)
      let snapshotted = false
      if (hadPrevious) {
        // 备份自身也必须原子替换：prev 存在的唯一理由是「出事时有一份能退回的」，
        // 直接覆写若在拷贝中途被杀就留下一份撕裂的 prev —— 比没有备份更坏（看着能退，退回去是坏的）。
        const tmpPrev = prevPath + '.tmp-' + Date.now()
        try {
          this._fs.copyFileSync(feedPath, tmpPrev)
          atomicRenameSync(this._fs, tmpPrev, prevPath, ATOMIC_RENAME_RETRY_DELAYS_MS)
          snapshotted = true
        } catch (e) {
          try { if (this._fs.existsSync(tmpPrev)) this._fs.unlinkSync(tmpPrev) } catch (_) { /* 清不掉不阻断发布 */ }
          this.logger.warn('PodcastHosting', 'feed snapshot failed: ' + ((e && e.message) || String(e)))
        }
      }
      // buildFeed 与 writeFeedSync 都要落盘到 episodes/feed 的真源，而忙标记此刻正被本次发布持有；
      // 通行证按同键、同步作用域放行「发布自己写自己的状态」，跨 await 不持有。
      const built = channelPublishPass.run(id, () => svc.buildFeed())
      if (!built || !built.path || !this._fs.existsSync(built.path)) throw err(HOSTING_ERRORS.FEED_NOT_BUILT, '该频道还没有可用的 feed 产物，请先生成 Feed')

      const view = this.getHosting()
      if (!view.configured) throw err('PODCAST_HOSTING_REQUIRED', '使用本地音频需先配置对象存储托管（当前支持阿里云 OSS）')
      const secret = this._readSecret(view.credentialRef)
      if (!secret) throw err(HOSTING_ERRORS.SECRET_MISSING, '已存的托管凭证读不出来，请重新填写一次')
      // 配置与凭证在发布开始时锁一份，全程不二次读（中途改配置会得到「半新半旧」的签名）
      const snapshot = { view, secret }
      const prefix = normalizePathPrefix(view.pathPrefix)
      const key = prefix + '/' + id + '/feed.xml'
      const stampKey = prefix + '/' + id + '/feed.' + new Date().toISOString().replace(/[:.]/g, '-') + '.xml'
      const attemptedAt = new Date().toISOString()

      // 云端存档传的是**上一版**（与本地 prev 同一份内容），不是本次产物：
      // 目的是"本地 prev 被清掉后仍能指回上一版"，而不是给本次内容多留一份拷贝。
      let backupCreated = false
      if (snapshotted) {
        try {
          await this._put(snapshot, stampKey, prevPath)
          backupCreated = true
        } catch (e) {
          this.logger.warn('PodcastHosting', 'feed archive failed: ' + ((e && e.status) || (e && e.message) || String(e)))
        }
      }

      let uploaded
      try {
        uploaded = await this._put(snapshot, key, built.path)
      } catch (e) {
        const code = (e && e.code) || 'PODCAST_HOSTING_UPLOAD_FAILED'
        // 失败态写盘本身也可能抛（channel.json 损坏、锁超时）。它绝不能顶掉这一格的
        // 「公网未更新、可重试」形状——否则调用方只拿到一个不相干的 STORE_* 码，
        // 用户会以为本地数据坏了，而真实情况只是 OSS 拒了这次上传。
        let failed = null
        try {
          failed = channelPublishPass.run(id, () => svc.writeFeedSync({
            status: 'failed', attemptedAt, publishedAt: '', objectKey: key,
            error: { code, status: (e && e.status) || null, itemCount: built.itemCount },
          }))
        } catch (e2) {
          this.logger.warn('PodcastHosting', 'feedSync 失败态未落盘：' + ((e2 && e2.code) || (e2 && e2.message) || String(e2)))
        }
        this.logger.warn('PodcastHosting', 'feed publish failed (items=' + built.itemCount + ' status=' + ((e && e.status) || 'none') + ')')
        return { state: 'failed', code, status: (e && e.status) || null, backupCreated, prevExists: hadPrevious, itemCount: built.itemCount, feedSync: failed }
      }

      const url = objectPublicUrl({ endpoint: view.endpoint, bucket: view.bucket, objectKey: key })
      let synced = null
      try {
        synced = channelPublishPass.run(id, () => svc.writeFeedSync({
          status: 'success', attemptedAt, publishedAt: new Date().toISOString(), objectKey: key, url,
          bytes: uploaded.size, itemCount: built.itemCount, backupCreated,
        }))
      } catch (e2) {
        this.logger.warn('PodcastHosting', 'feedSync 成功态未落盘：' + ((e2 && e2.code) || (e2 && e2.message) || String(e2)))
      }
      this.logger.info('PodcastHosting', 'feed published (items=' + built.itemCount + ' bytes=' + uploaded.size + ' archive=' + (backupCreated ? 'yes' : 'no') + ' prev=' + (hadPrevious ? 'yes' : 'no') + ' snap=' + (snapshotted ? 'ok' : 'failed') + ')')
      return { state: 'success', url, bytes: uploaded.size, itemCount: built.itemCount, backupCreated, prevExists: hadPrevious, feedSync: synced }
    } finally {
      this._registry.endPublish(id)
    }
  }

  /**
   * 单个对象的 PUT。签名与 URL 都在这一处算，`putObject` 只负责发。
   * ⛔ 不得把 secret 拼进任何日志/错误消息：`putObject` 的异常消息只允许出现状态码。
   */
  async _put (snapshot, objectKey, filePath) {
    const url = objectPublicUrl({ endpoint: snapshot.view.endpoint, bucket: snapshot.view.bucket, objectKey })
    if (!url) throw err(HOSTING_ERRORS.HOSTING_INVALID, '无法由 endpoint/bucket 拼出上传地址')
    const headers = buildOssPutHeaders({
      endpoint: snapshot.view.endpoint,
      bucket: snapshot.view.bucket,
      objectKey,
      contentType: 'application/rss+xml',
      accessKeyId: snapshot.secret.accessKeyId,
      accessKeySecret: snapshot.secret.accessKeySecret,
      date: this._dateImpl ? this._dateImpl(new Date()) : undefined,
    })
    return putObject({
      httpClient: this._httpClient,
      fsImpl: this._fs,
      filePath,
      url,
      headers,
    })
  }
}

module.exports = PodcastHostingService
module.exports.HOSTING_ERRORS = HOSTING_ERRORS
module.exports.MASK_KEEP = MASK_KEEP
module.exports.maskAccessKeyId = maskAccessKeyId
