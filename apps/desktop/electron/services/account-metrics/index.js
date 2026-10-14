// @ts-check
/**
 * AccountMetricsService — 账号级作品互动数据回流编排
 *
 * 定位（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §四）：
 * 发布记录页五项互动列恒空的根因不是「没展示」，而是**没有任何一层真的取过数**：
 * 公开页 parser 对国内主流平台结构性不可行（需登录 / 指标在打包脚本里），
 * 而落库侧从不写互动字段。本服务补的就是中间这一层：带账号 Cookie 调创作者后台列表接口，
 * 一次请求拿回该账号全部作品的指标，落成 `performance_snapshot` 并按归因规则挂到发布记录上。
 *
 * ⛔ 防封是本次需求的第一约束（用户原话「不能太频繁查询以防被封」）。本服务把频控做成
 * 三层，缺一层都能被单个入口打穿：
 *   ① 轮次层：24h 一轮（`ROUND_INTERVAL_MS`），由 `start()` 的定时器驱动；
 *   ② 账号层：每账号每天最多 `accountDailyMax` 轮（含手动刷新），超限记 `skipped_daily_cap`；
 *   ③ 请求层：页间延迟带随机抖动（`throttle.pageDelayMs()`），账号之间**串行**（不并发）。
 * 三层都是「上限」而不是「目标」——数据非实时是明确接受的产品取舍。
 *
 * 依赖全部经构造注入（store / 账号列表 / 凭证 / HTTP / 签名器 / 时钟），
 * 因此本文件可在无 Electron、无网络的环境里逐条单测（PRD §7.1 T9–T14）。
 */
'use strict'

const log = require('../logger')
const { getAdapter, supportedPlatforms } = require('./adapters')
const { AccountMetricsThrottle } = require('./throttle')
const { planWorkLinks } = require('./link')
// P1-2：平台能力描述（UI 文案用）+ 采集结果与厂商矩阵的交叉校验。
// 见 capability.js 头注：**它不是请求门控**，矩阵是厂商的能力边界、本仓实测优先。
const { buildPlatformCapability, checkMetrics } = require('./capability')
const {
  resolveConfig,
  HTTP_TIMEOUT_MS,
  SNAPSHOT_SOURCE,
  SCHEDULE_INITIAL_DELAY_MS,
} = require('./constants')
// 凭证 → 请求头的转换统一走 cookies.js（本文件只负责编排；凭证不经过适配器）
const { cookiesToHeader, cookieNameSet, injectBodyFromCookie } = require('./cookies')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

class AccountMetricsService {
  /**
   * @param {object} deps
   * @param {object} deps.store 已 mixin account-metrics-store 的 Store 实例
   * @param {() => Promise<Array<{id: string, platform: string, name?: string, status?: string}>>} [deps.listAccounts]
   * @param {(accountId: string, platform: string) => Promise<object|null>|object|null} [deps.loadCredential]
   * @param {(ownerSubject: string|undefined) => Promise<Array<object>>|Array<object>} [deps.listPublishRecords]
   * @param {(req: object) => Promise<{statusCode: number, json: any}>} [deps.httpRequest]
   * @param {{sign?: (ctx: object) => Promise<object|null>|object|null}|null} [deps.signer]
   * @param {(reason: string, detail: object) => void} [deps.warn]
   * @param {object} [deps.config]
   * @param {number} [deps.scheduleInitialDelayMs]
   */
  constructor (deps) {
    const d = deps || {}
    this._store = d.store || null
    this._listAccounts = typeof d.listAccounts === 'function' ? d.listAccounts : async () => []
    this._loadCredential = typeof d.loadCredential === 'function' ? d.loadCredential : () => null
    this._listPublishRecords = typeof d.listPublishRecords === 'function' ? d.listPublishRecords : async () => []
    this._httpRequest = typeof d.httpRequest === 'function' ? d.httpRequest : null
    this._signer = d.signer || null
    // 调度轮（非 IPC 触发）没有调用方传 owner：经 provider 从身份服务取当前 subject。
    // 取不到就是 undefined（legacy 档），与全仓 `resolveIpcOwnerSubject` 的三态口径一致。
    this._resolveOwner = typeof d.resolveOwner === 'function' ? d.resolveOwner : null
    this._configOverrides = d.config || null
    this._throttle = null
    this._throttleSignature = ''
    this._running = false
    this._initialTimer = null
    this._roundTimer = null
    this._scheduleInitialDelayMs = Number.isFinite(d.scheduleInitialDelayMs)
      ? d.scheduleInitialDelayMs
      : SCHEDULE_INITIAL_DELAY_MS
    this._lastStatus = null
  }

  setStore (store) { this._store = store }
  setSigner (signer) { this._signer = signer }

  setHttpRequest (fn) { this._httpRequest = typeof fn === 'function' ? fn : null }

  /**
   * 注入「当前归属主体」解析器（调度轮用）。返回三态，与全仓 `resolveIpcOwnerSubject` 同口径：
   * 非空串 = 已登录；`null` = 有身份服务但认不出是谁（**跳过本轮**，fail closed）；
   * `undefined` = 无身份服务（legacy 档，落到无归属桶）。
   */
  setResolveOwner (fn) { this._resolveOwner = typeof fn === 'function' ? fn : null }

  _config () { return resolveConfig(this._configOverrides) }

  _throttler () {
    const c = this._config()
    // 参数签名变化时重建：`resolveConfig` 的契约是「每次调用都重新读 env，便于排障时改环境变量重试」，
    // 而节流参数（延迟/抖动/日上限）此前被首次构造固化 ⇒ 只有页大小/页上限能改，配置半生效更难判断。
    // 重建会丢内存态额度与失败计数，故只在签名真的变了时重建（同参数下仍是同一实例）。
    const signature = [c.pageDelayBaseMs, c.pageDelayJitterRatio, c.accountDailyMax].join('|')
    if (!this._throttle || this._throttleSignature !== signature) {
      this._throttle = new AccountMetricsThrottle({
        pageDelayBaseMs: c.pageDelayBaseMs,
        pageDelayJitterRatio: c.pageDelayJitterRatio,
        accountDailyMax: c.accountDailyMax,
      })
      this._throttleSignature = signature
    }
    return this._throttle
  }

  /**
   * 跑一轮。同实例内防重入（用户在采集进行中再点刷新不叠加请求）。
   *
   * @param {object} [opts]
   * @param {string} [opts.reason] 'schedule' | 'manual'
   * @param {string|undefined} [opts.ownerSubject]
   * @param {boolean} [opts.force] true = 忽略 24h 轮次间隔（手动刷新用），但仍守账号日上限与页间抖动
   * @returns {Promise<object>} 统计信封
   */
  async runRound (opts) {
    const o = opts || {}
    const startedAt = Date.now()
    // 归属：调用方显式给了就用；没给（调度轮）则问身份服务；再拿不到就是 undefined（legacy 档）。
    let ownerSubject = o.ownerSubject
    if (ownerSubject === undefined && this._resolveOwner) {
      try { ownerSubject = this._resolveOwner() } catch (_) { ownerSubject = undefined }
    }
    const result = {
      ran: false,
      reason: o.reason || 'manual',
      accounts: [],
      counts: { active: 0, synced: 0, needs_login: 0, unsupported: 0, skipped_daily_cap: 0, truncated: 0, failed: 0, linked: 0, snapshots: 0 },
      startedAt: new Date(startedAt).toISOString(),
    }

    if (this._running) {
      result.skippedReason = 'already_running'
      return result
    }
    // 有身份服务但认不出主体（未登录/令牌过期）⇒ 整轮跳过。此处**不能**回落到无归属桶：
    // 那会把已登录用户的数据写进 legacy 桶，下次登录后读不到，看起来像「采集了但没显示」。
    if (ownerSubject === null) {
      result.skippedReason = 'no_identity'
      return result
    }
    if (!this._store || !this._httpRequest) {
      result.skippedReason = this._store ? 'http_unavailable' : 'store_unavailable'
      return result
    }

    this._running = true
    try {
      const c = this._config()
      const throttle = this._throttler()
      let accounts = []
      try {
        accounts = (await this._listAccounts()) || []
      } catch (e) {
        log.warn('AccountMetrics', 'listAccounts failed: ' + (e && e.message))
        result.skippedReason = 'accounts_unavailable'
        return result
      }
      if (!Array.isArray(accounts)) accounts = []

      // V1：只处理 active 账号。expired/unverified 发请求只会触发风控，且「未登录」必须与
      // 「平台不支持」在界面上可区分，所以分别计数而不是笼统跳过。
      const active = accounts.filter(a => a && String(a.status || '') === 'active')
      result.counts.active = active.length
      const publishRecords = await this._safePublishRecords(ownerSubject)
      /** @type {Array<object>} 本轮全部作品，跨账号汇聚后统一归因 */
      const allWorks = []

      for (const account of active) {
        const accountId = String(account.id || '')
        const platform = String(account.platform || '').toLowerCase()
        const entry = { accountId, platform, status: 'pending', pages: 0, items: 0, error: '' }
        // P1-2：把平台能力描述并入快照，供 UI 区分「平台不支持」与「这次没采到」。
        // 此前两种都显示 `-`，用户无法判断是该换个平台还是该重试。
        // ⚠️ 这只影响**展示**；不得用它决定要不要发请求（见 capability.js 头注）。
        entry.capability = buildPlatformCapability(platform)
        try {
          const adapter = getAdapter(platform)
          if (!adapter) {
            entry.status = 'unsupported'
            entry.error = 'no_adapter'
            result.counts.unsupported += 1
            result.accounts.push(entry)
            continue
          }
          // V6：账号日上限（含手动刷新）
          if (!throttle.canRun(accountId, startedAt)) {
            entry.status = 'skipped_daily_cap'
            result.counts.skipped_daily_cap += 1
            result.accounts.push(entry)
            continue
          }
          // V2：会话校验在发请求**之前**。缺会话 Cookie 的请求 100% 被重定向到登录页，
          // 纯属浪费风控额度，而且会把「没登录」误记成「平台不支持」。
          const credential = await this._safeCredential(accountId, platform)
          const cookieHeader = cookiesToHeader(credential && credential.cookies)
          const names = cookieNameSet(cookieHeader)
          const missing = (adapter.requiredCookieNames || []).filter(n => !names.has(String(n).toLowerCase()))
          if (!cookieHeader || missing.length > 0) {
            entry.status = 'needs_login'
            entry.error = missing.length ? ('missing_cookie:' + missing.join(',')) : 'no_cookie'
            result.counts.needs_login += 1
            result.accounts.push(entry)
            continue
          }
          if (adapter.requiresSigner && !this._signer) {
            // 不伪造签名：宁可如实报不支持，也不发一个必然被拒且可能被记为异常行为的请求
            entry.status = 'unsupported'
            entry.error = 'signer_unavailable'
            result.counts.unsupported += 1
            result.accounts.push(entry)
            continue
          }

          throttle.recordRun(accountId, startedAt)
          const pageResult = await this._syncAccount({
            adapter, account, cookieHeader, throttle, config: c, startedAt,
          })
          entry.status = pageResult.status
          entry.pages = pageResult.pages
          entry.items = pageResult.items.length
          entry.error = pageResult.error || ''
          if (pageResult.truncated) { entry.truncated = true; result.counts.truncated += 1 }
          // P1-2 判据③：与厂商矩阵交叉校验。只回传「不一致」的条目 ——
          // `declared-but-null`（声明有、实测没有）是**值得告警**的信号：声明过期或适配器漏解析。
          // `undeclared-but-present` 不是错误（实测优先），一并带上供排查。
          const checks = checkMetrics(platform, pageResult.items)
          if (checks.length > 0) entry.metricChecks = checks
          for (const work of pageResult.items) allWorks.push({ ...work, platform, accountId })
          if (pageResult.status === 'ok') { result.counts.synced += 1; throttle.recordSuccess(accountId) } else if (pageResult.status === 'failed') { result.counts.failed += 1 }
        } catch (e) {
          entry.status = 'failed'
          entry.error = (e && e.message) || String(e)
          result.counts.failed += 1
          log.warn('AccountMetrics', 'account failed ' + platform + ':' + accountId + ' ' + entry.error)
        }
        result.accounts.push(entry)
      }

      // 归因 + 落盘（跨账号一次性做，避免同一作品被两个账号各挂一次）
      if (allWorks.length > 0) {
        const tracked = this._store.listTrackedForAccountSync
          ? this._store.listTrackedForAccountSync(ownerSubject)
          : { rows: [] }
        // ⛔ 写侧读失败必须出声（QM-6 后端轴 MAJOR）：store 把 SQL 故障吞成 `{rows:[], error}`，
        // 照常继续的话整轮会报 `ran:true / synced=N` 而 snapshots=0，界面回落「尚未采集」，
        // 与「库真的坏了」不可区分。读侧（performance:history-metrics）对同一形态是翻成
        // REQUEST_ERROR 的，写侧必须同口径。
        if (tracked && tracked.error) {
          result.counts.snapshots = 0
          result.writeError = 'listTrackedForAccountSync: ' + tracked.error
          log.warn('AccountMetrics', 'attribution input unavailable: ' + result.writeError)
        } else {
          if (tracked && tracked.truncated) result.trackedTruncated = true
          const plan = planWorkLinks({
            trackedRows: tracked.rows || [],
            works: allWorks,
            records: publishRecords,
          })
          const written = this._store.applyAccountSyncLinks
            ? this._store.applyAccountSyncLinks({
              links: plan.links,
              ownerSubject,
              nowMs: startedAt,
              source: SNAPSHOT_SOURCE,
            })
            : { written: 0, backfilled: 0, skipped: 0 }
          result.counts.linked = plan.links.length
          result.counts.snapshots = written.written || 0
          result.linkStats = plan.stats
          if (plan.ambiguous.length > 0) result.counts.ambiguous = plan.ambiguous.length
        }
      }

      result.ran = true
      result.counts.works = allWorks.length
      result.finishedAt = new Date().toISOString()
      result.durationMs = Date.now() - startedAt
      this._persistState(result, ownerSubject)
      this._lastStatus = result
      return result
    } finally {
      this._running = false
    }
  }

  /**
   * 单账号分页采集。V3 页上限 / V4 页间抖动 / V7 游标去重 / V8 失败熔断。
   * @returns {Promise<{status: string, pages: number, items: Array<object>, truncated: boolean, error: string}>}
   */
  async _syncAccount ({ adapter, account, cookieHeader, throttle, config, startedAt }) {
    const out = { status: 'ok', pages: 0, items: [], truncated: false, error: '' }
    let cursor = adapter.platform === 'douyin' || adapter.platform === 'kuaishou' ? '0' : '1'
    let lastFirstId = ''
    // 「页数触顶」必须与「分页自然结束」分开：空页 break 与游标去重 break 都不是触顶。
    // 曾经三条退出路径共用循环外那句 `out.truncated = true` ⇒ 正常采完也报截断（QM-6 后端轴 MAJOR）。
    let exhaustedPages = true
    for (let page = 0; page < config.maxPagesPerAccount; page += 1) {
      const built = adapter.buildListRequest({ cursor, pageSize: config.pageSize })
      if (!built || built.unsupportedReason) {
        out.status = 'unsupported'
        out.error = (built && built.unsupportedReason) || 'no_request'
        return out
      }
      const headers = { ...(built.headers || {}) }
      if (adapter.requiresSigner && this._signer && typeof this._signer.sign === 'function') {
        const signed = await this._signer.sign({
          platform: adapter.platform,
          url: built.url,
          method: built.method,
          body: built.body,
          cookieHeader,
          accountId: account.id,
        })
        if (!signed || typeof signed !== 'object') {
          // 签名器在场但签不出：不降级为「不带签名硬发」，如实报不支持
          out.status = 'unsupported'
          out.error = 'sign_failed'
          return out
        }
        Object.assign(headers, signed)
      }
      headers.Cookie = cookieHeader
      // 平台把某些设备指纹**同时**放在 Cookie 与 JSON body 里（逆向真源对快手的实测形态）。
      // 适配器声明 `bodyFromCookie: { bodyKey: cookieName }`，此处统一注入（凭证不经过适配器）。
      const body = injectBodyFromCookie(built.body, adapter.bodyFromCookie, cookieHeader)

      let res
      try {
        res = await this._httpRequest({
          url: built.url, method: built.method || 'GET', headers,
          body, timeoutMs: HTTP_TIMEOUT_MS,
        })
      } catch (e) {
        out.status = 'failed'
        out.error = 'request_error:' + ((e && e.message) || String(e))
        throttle.recordFailure(account.id)
        return out
      }
      out.pages += 1
      const status = Number(res && res.statusCode) || 0
      if (status < 200 || status >= 300) {
        // V9：非 2xx 一律判失败并出声，**绝不落 0 值快照**（「取到 0」与「没取到」是两种结论）
        out.status = 'failed'
        out.error = 'http_' + status
        if (throttle.recordFailure(account.id)) out.error += ':backoff'
        return out
      }
      if (!res || res.json === null || res.json === undefined) {
        out.status = 'failed'
        out.error = 'invalid_json'
        throttle.recordFailure(account.id)
        return out
      }

      let parsed
      try {
        parsed = adapter.parseList(res.json)
      } catch (e) {
        // 「登录已过期」与「接口形态变了」是两个结论，界面给出的下一步动作完全不同：
        // 前者要用户去账号页重新登录，后者只能等适配器跟进。适配器用 `err.needsLogin` 标记前者。
        if (e && e.needsLogin === true) {
          out.status = 'needs_login'
          out.error = 'session_expired:' + ((e && e.message) || '')
          return out
        }
        out.status = 'failed'
        out.error = 'parse_error:' + ((e && e.message) || String(e))
        throttle.recordFailure(account.id)
        return out
      }
      const items = (parsed && Array.isArray(parsed.items)) ? parsed.items : []
      if (items.length === 0) { exhaustedPages = false; break }
      // V7：游标去重（平台游标实现存在重复页的已知形态；不去重会死循环）
      const firstId = String(items[0].postId || '')
      if (firstId && firstId === lastFirstId) break
      lastFirstId = firstId
      out.items.push(...items)

      if (!parsed.hasMore) return out
      cursor = parsed.nextCursor !== null && parsed.nextCursor !== undefined
        ? String(parsed.nextCursor)
        : String(Number(cursor) + 1)
      // V4：页间抖动。最后一页之后不再等（省掉结尾那次无意义延迟）。
      if (page < config.maxPagesPerAccount - 1) await sleep(throttle.pageDelayMs())
    }
    // 只有 for 条件自然耗尽（还有下一页但页数用尽）才是真截断；
    // 两条 break（空页 / 游标去重）都已把 exhaustedPages 置假。
    out.truncated = exhaustedPages
    return out
  }

  async _safeCredential (accountId, platform) {
    try {
      return await this._loadCredential(accountId, platform)
    } catch (e) {
      log.warn('AccountMetrics', 'loadCredential failed ' + platform + ':' + accountId + ' ' + ((e && e.message) || e))
      return null
    }
  }

  async _safePublishRecords (ownerSubject) {
    try {
      const rows = await this._listPublishRecords(ownerSubject)
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      log.warn('AccountMetrics', 'listPublishRecords failed: ' + ((e && e.message) || e))
      return []
    }
  }

  _persistState (result, ownerSubject) {
    if (!this._store || typeof this._store.setAccountSyncState !== 'function') return
    this._store.setAccountSyncState({
      lastRunAt: result.startedAt,
      lastFinishedAt: result.finishedAt || null,
      lastReason: result.reason,
      counts: result.counts,
      accounts: (result.accounts || []).map(a => ({
        accountId: a.accountId, platform: a.platform, status: a.status, error: a.error || '',
      })),
      supportedPlatforms: supportedPlatforms(),
    }, ownerSubject)
  }

  /** 读最近一次状态（含「从未采集」）。 */
  getStatus (ownerSubject) {
    if (this._store && typeof this._store.getAccountSyncState === 'function') {
      const persisted = this._store.getAccountSyncState(ownerSubject)
      if (persisted) return persisted
    }
    return this._lastStatus || null
  }

  /** 24h 一轮的调度。首轮延迟 60s（等身份与账户服务就绪，见 constants.js 的注释）。 */
  start () {
    if (this._roundTimer || this._initialTimer) return
    const c = this._config()
    this._initialTimer = setTimeout(() => {
      this._initialTimer = null
      this.runRound({ reason: 'schedule' }).catch(e => log.warn('AccountMetrics', 'initial round failed: ' + ((e && e.message) || e)))
    }, this._scheduleInitialDelayMs)
    if (this._initialTimer.unref) this._initialTimer.unref()
    this._roundTimer = setInterval(() => {
      this.runRound({ reason: 'schedule' }).catch(e => log.warn('AccountMetrics', 'round failed: ' + ((e && e.message) || e)))
    }, c.roundIntervalMs)
    if (this._roundTimer.unref) this._roundTimer.unref()
    log.info('AccountMetrics', 'scheduler started (initial ' + this._scheduleInitialDelayMs + 'ms + every ' + c.roundIntervalMs + 'ms)')
  }

  stop () {
    if (this._initialTimer) { clearTimeout(this._initialTimer); this._initialTimer = null }
    if (this._roundTimer) { clearInterval(this._roundTimer); this._roundTimer = null }
  }
}

module.exports = { AccountMetricsService, cookiesToHeader, cookieNameSet }
