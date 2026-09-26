// @ts-check
/**
 * 账号云镜像同步（desktop 侧编排器）
 *
 * 职责：把本机真源账号（元数据 + 本机加密凭证）与业务 API 的云端镜像做双向合并，
 * 并把逐条过程如实广播给渲染层。本模块**不**决定登录态结论——恢复到本机的账号一律
 * unverified，active/expired 只能由本机自己的检测产生（见 docs/adr/0005）。
 *
 * 凭证摘要只在服务端计算。客户端比较的是服务端回传的裁决结果，本机绝不另算一份
 * 规范化摘要：两侧各写一套 normalization 必然漂移，漂移的表现是 unchanged 被误判成
 * 冲突（本仓已有 CJS/ESM 孪生词表漂移的先例，见 AGENTS.md「枚举式黑名单必须配结构化正向契约」）。
 *
 * @typedef {Object} PreparedRow
 * @property {string} accountId 本机真源 id（不跨设备稳定）
 * @property {string} platform
 * @property {?string} platformUid 平台原生主键；null = 本机无法定身份
 * @property {string} displayName
 * @property {string} accountName
 * @property {string} avatar
 * @property {?number} followers
 * @property {boolean} isActive
 * @property {?Object} credential {cookies, localStorage, indexedDB}
 * @property {?string} credentialError
 *
 * @typedef {Object} CloudSyncDeps
 * @property {{ listAccounts: () => Promise<any[]>, addAccount: Function, persistLoginState: Function }} AccountManager
 * @property {{ loadCredential: Function, saveCredential: Function }} credentialStore
 * @property {(platform:string, cookies:any[]) => Promise<{supported:boolean, platformAccountId?:string}>} fetchAccountInfo
 * @property {(platform:string, cookies:any[], extra?:any) => Promise<{supported?:boolean, valid?:boolean, code?:string}>} checkLogin
 * @property {{ request: (o:{subject:string, path:string, body?:any, method?:string, query?:string}) => Promise<any> }} apiClient
 * @property {(payload:any)=>void} [broadcast]
 * @property {(accountId:string, opts?:any) => any} [queueLoginCheck] 恢复后排一次本机检测
 * @property {string} [userDataDir]
 * @property {Record<string,string|undefined>} [env]
 * @property {() => number} [now]
 * @property {{info?:Function, warn?:Function, error?:Function}} [log]
 */

const OUTCOME = {
  CREATED: 'created',
  UPDATED: 'updated',
  UNCHANGED: 'unchanged',
  RESTORED: 'restored',
  SKIPPED_TOMBSTONE: 'skipped-tombstone',
  CONFLICT_LOCAL: 'conflict-resolved-local',
  CONFLICT_CLOUD: 'conflict-resolved-cloud',
  CONFLICT_UNRESOLVED: 'conflict-unresolved',
  INVALID_CREDENTIAL: 'invalid-credential',
  UID_UNAVAILABLE: 'uid-unavailable',
  FAILED: 'failed',
}

const ACCOUNT_PATH = '/api/v1/me/accounts'
const SYNC_PATH = '/api/v1/me/accounts/sync'
const DISCONNECT_PATH = '/api/v1/me/accounts/disconnect'
const DIGEST_TIMEOUT_MS = 10000

const TIMEOUT_SENTINEL = Symbol('cloudSyncTimeout')

function resolveInt (raw, fallback, min, max) {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return n
}

function errorMessage (e) { return String((e && (/** @type {any} */ (e).code || /** @type {any} */ (e).message)) || e || 'unknown') }

function keyOf (platform, uid) { return `${String(platform || '')}|${String(uid == null ? '' : uid)}` }

/**
 * 硬超时：超时后原 promise 的 reject 必须就地吃掉，否则变成 unhandledRejection
 * （AGENTS.md「批量 IPC 进度双边界与超时预算契约」的回归要求）。
 */
function raceWithTimeout (promiseOrValue, timeoutMs, timeoutValue) {
  const guarded = promiseOrValue instanceof Promise ? promiseOrValue : Promise.resolve(promiseOrValue)
  // 非 Promise 分支下 catch 不存在，统一走 Promise.resolve 包装
  const settled = guarded.catch((e) => ({ __cloudSyncError: errorMessage(e) }))
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
  })
  return Promise.race([settled, timeout]).then((value) => {
    if (timer) clearTimeout(timer)
    return value
  }, (e) => { if (timer) clearTimeout(timer); throw e })
}

function isTimeout (v) { return v === TIMEOUT_SENTINEL }

/** 固定并发映射；结果落位由调用方按 index 处理，完成顺序不影响结果集 */
async function mapWithConcurrency (items, limit, worker) {
  const size = Math.max(1, Math.min(limit, items.length || 1))
  let cursor = 0
  const runners = new Array(size).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

function emptySummary () {
  return {
    created: 0, updated: 0, unchanged: 0, restored: 0, skipped: 0,
    conflicts: 0, invalid: 0, uidUnavailable: 0, failed: 0,
    items: [], queuedCheck: 0, elapsedMs: 0, aborted: false, errorCode: null,
  }
}

/**
 * 从逐条结果重新推导聚合计数。冲突/失效/身份不明三类必须在终态收口时按 items 结算，
 * 否则中途分支少加一次计数就会汇出一个「全部成功」的假事实。
 */
function finishSummary (summary) {
  summary.conflicts = summary.items.filter((i) => String(i.outcome || '').startsWith('conflict-')).length
  summary.invalid = summary.items.filter((i) => i.outcome === OUTCOME.INVALID_CREDENTIAL).length
  summary.uidUnavailable = summary.items.filter((i) => i.outcome === OUTCOME.UID_UNAVAILABLE).length
  return summary
}

function createCloudAccountSync (deps) {
  const {
    AccountManager, credentialStore, fetchAccountInfo, checkLogin, apiClient,
    broadcast = () => {}, queueLoginCheck = null, userDataDir = '', env = {},
    now = () => Date.now(), log: logSink = null,
  } = deps || {}

  const concurrency = resolveInt(env.MP_CLOUD_SYNC_CONCURRENCY, 3, 1, 8)
  const accountTimeoutMs = resolveInt(env.MP_CLOUD_SYNC_ACCOUNT_TIMEOUT_MS, 20000, 1000, 120000)
  const totalBudgetMs = resolveInt(env.MP_CLOUD_SYNC_TOTAL_TIMEOUT_MS, 180000, 5000, 600000)

  let running = false
  let abortRequested = false

  function log (level, stage, detail) {
    const sink = logSink && logSink[level]
    if (typeof sink !== 'function') return
    try { sink('CloudSync', `cloud-account-sync ${stage}${detail ? ' :: ' + detail : ''}`) } catch (_) { /* 日志不得影响同步 */ }
  }

  function send (payload) {
    try { broadcast(payload) } catch (_) { /* 广播失败不阻断同步 */ }
  }

  function assertReady () {
    if (!apiClient || typeof apiClient.request !== 'function') {
      throw Object.assign(new Error('云端同步客户端未就绪'), { code: 'BUSINESS_USER_REPOSITORY_NOT_CONFIGURED' })
    }
    if (!credentialStore || typeof credentialStore.loadCredential !== 'function' || typeof credentialStore.saveCredential !== 'function') {
      throw Object.assign(new Error('凭证存储不可用'), { code: 'CREDENTIAL_STORE_UNAVAILABLE' })
    }
    if (!AccountManager || typeof AccountManager.listAccounts !== 'function') {
      throw Object.assign(new Error('账号真源不可用'), { code: 'ACCOUNT_MANAGER_UNAVAILABLE' })
    }
  }

  function callApi (subject, path, options) {
    return Promise.resolve(apiClient.request({ subject, path, ...(options || {}) }))
  }

  // ── 摘要：弹窗先看到的"共 xx 个" ──────────────────────────────────
  async function digest (subject) {
    assertReady()
    let cloud = null
    let reachable = true
    let errorCode = null
    try {
      const got = await raceWithTimeout(callApi(subject, ACCOUNT_PATH, { method: 'GET' }), DIGEST_TIMEOUT_MS, TIMEOUT_SENTINEL)
      if (isTimeout(got)) { reachable = false; errorCode = 'SYNC_TIMEOUT' }
      else if (got && got.__cloudSyncError) { reachable = false; errorCode = got.__cloudSyncError }
      else cloud = got
    } catch (e) {
      reachable = false
      errorCode = errorMessage(e)
    }

    let localCount = 0
    try {
      const accounts = await Promise.resolve(AccountManager.listAccounts())
      localCount = Array.isArray(accounts) ? accounts.filter((a) => a && a.id && a.platform).length : 0
    } catch (e) {
      log('warn', 'local-list-failed', errorMessage(e))
    }

    const data = {
      total: cloud && Number.isFinite(cloud.total) ? cloud.total : 0,
      byPlatform: cloud && Array.isArray(cloud.byPlatform) ? cloud.byPlatform : [],
      tombstones: cloud && Number.isFinite(cloud.tombstones) ? cloud.tombstones : 0,
      localCount,
      reachable,
      errorCode,
    }
    // 读不到与"云端为空"是两种界面文案，不可互相冒充（PRD §10.2 / §11）
    if (!reachable) { data.total = 0; data.byPlatform = []; data.tombstones = 0 }
    return { code: 0, data }
  }

  // ── 本机行准备：凭证 + 平台原生 uid ───────────────────────────────
  async function loadLocalRow (account, subject) {
    const row = {
      accountId: account.id,
      platform: account.platform,
      platformUid: typeof account.platform_account_id === 'string' && account.platform_account_id.trim()
        ? account.platform_account_id.trim() : null,
      displayName: account.name || '',
      accountName: account.account_name || '',
      avatar: account.avatar || '',
      followers: Number.isSafeInteger(account.followers) && account.followers >= 0 ? account.followers : null,
      isActive: account.is_active !== false,
      credential: null,
      credentialError: null,
    }

    let stored = null
    try {
      stored = await Promise.resolve(credentialStore.loadCredential(account.id, userDataDir, subject))
    } catch (e) {
      row.credentialError = 'CREDENTIAL_LOAD_FAILED'
      log('warn', 'credential-load-failed', `platform=${row.platform} accountId=${row.accountId} message=${errorMessage(e)}`)
      return row
    }
    const cookies = stored && Array.isArray(stored.cookies) ? stored.cookies : []
    if (!cookies.length) {
      // 无凭证 = 本机从未真正登录成功过（或历史半成功），不上行也不冒充可用
      row.credentialError = 'CHECK_LOGIN_NO_CREDENTIAL'
      return row
    }
    row.credential = stored

    if (!row.platformUid) {
      // 二级补齐：拿 cookie 调平台 user-info 接口取原生 uid（与竞品同构的做法）
      const info = await raceWithTimeout(
        Promise.resolve(fetchAccountInfo(row.platform, cookies)).catch((e) => ({ __cloudSyncError: errorMessage(e) })),
        accountTimeoutMs, TIMEOUT_SENTINEL,
      )
      if (!isTimeout(info) && info && typeof info.platformAccountId === 'string' && info.platformAccountId.trim()) {
        row.platformUid = info.platformAccountId.trim()
      } else {
        log('warn', 'uid-extract-miss', `platform=${row.platform} accountId=${row.accountId} reason=${isTimeout(info) ? 'timeout' : (info && info.__cloudSyncError) || 'no-uid-in-response'}`)
      }
    }
    return row
  }

  /** 判一份凭证在本机是否真能用；返回 'valid' | 'invalid' | 'inconclusive' */
  async function verdict (platform, credential) {
    const cookies = credential && Array.isArray(credential.cookies) ? credential.cookies : null
    if (!cookies || !cookies.length) return 'invalid'
    const res = await raceWithTimeout(
      Promise.resolve(checkLogin(platform, cookies)).catch((e) => ({ __cloudSyncError: errorMessage(e) })),
      accountTimeoutMs, TIMEOUT_SENTINEL,
    )
    if (isTimeout(res)) return 'inconclusive'
    if (res && res.__cloudSyncError) return 'inconclusive'
    if (res && res.valid === true) return 'valid'
    if (res && res.valid === false) return 'invalid'
    return 'inconclusive'
  }

  /**
   * 凭证冲突四分支（PRD §5.5）：较新者优先并先实测，两份都失效保留本机并标需重登，
   * 两份都无定论一律保留本机且不写负结论（单向证据规则）。
   * 较新一份由服务端在 conflict 裁决里给出 `credentialFreshness`；拿不到时按本机较新处理。
   */
  async function resolveCredentialConflict (platform, localCredential, cloudCredential, cloudNewer) {
    const ordered = cloudNewer
      ? [{ which: 'cloud', cred: cloudCredential }, { which: 'local', cred: localCredential }]
      : [{ which: 'local', cred: localCredential }, { which: 'cloud', cred: cloudCredential }]

    const verdicts = []
    for (const cand of ordered) {
      const v = await verdict(platform, cand.cred)
      verdicts.push({ ...cand, verdict: v })
      if (v === 'valid') return { winner: cand.which, credential: cand.cred, verdicts }
    }
    const anyInconclusive = verdicts.some((v) => v.verdict === 'inconclusive')
    return { winner: 'keep-local', credential: localCredential, invalid: !anyInconclusive, verdicts }
  }

  // ── 上行 ────────────────────────────────────────────────────────
  function toUpsertPayload (row) {
    return {
      platform: row.platform,
      platformUid: row.platformUid,
      displayName: row.displayName,
      accountName: row.accountName,
      avatar: row.avatar,
      followers: row.followers,
      isActive: row.isActive,
      credential: row.credential,
    }
  }

  async function fetchCloudCredential (subject, platform, platformUid) {
    const got = await raceWithTimeout(
      callApi(subject, SYNC_PATH, { method: 'POST', body: { keys: [{ platform, platformUid }] } }),
      accountTimeoutMs, TIMEOUT_SENTINEL,
    )
    if (isTimeout(got) || !got || got.__cloudSyncError) return null
    const list = Array.isArray(got.credentials) ? got.credentials : []
    const hit = list.find((c) => keyOf(c.platform, c.platformUid) === keyOf(platform, platformUid))
    return hit ? hit.credential || null : null
  }

  /** 把一份凭证落到本机（覆盖同名账号的本机凭证），并强制本机自证 */
  async function applyCredentialLocally (subject, accountId, credential, platform) {
    try {
      await Promise.resolve(credentialStore.saveCredential(accountId, credential, userDataDir, subject))
    } catch (e) {
      log('warn', 'credential-apply-failed', `platform=${platform} accountId=${accountId} message=${errorMessage(e)}`)
      return false
    }
    await markNeedLocalAttestation(accountId, platform)
    return true
  }

  /**
   * 恢复到本机 / 被云端凭证覆盖后的统一收尾：
   * status 强制 unverified（不继承云端结论）、last_validated 取本机此刻且标 restored 来源
   * （不参与 7 天超龄锚点），然后排一次本机检测。
   */
  async function markNeedLocalAttestation (accountId, platform) {
    try {
      await Promise.resolve(AccountManager.persistLoginState(accountId, {
        status: 'unverified',
        lastValidated: new Date(now()).toISOString(),
        validationOrigin: 'restored',
      }))
    } catch (e) {
      log('warn', 'restore-status-failed', `platform=${platform} accountId=${accountId} message=${errorMessage(e)}`)
    }
    if (typeof queueLoginCheck === 'function') {
      try { await Promise.resolve(queueLoginCheck(accountId, { platform, reason: 'cloud-restored' })) } catch (e) {
        log('warn', 'restore-check-queue-failed', `accountId=${accountId} message=${errorMessage(e)}`)
      }
    }
  }

  async function restoreToLocal (subject, cloudAccount, startedAt) {
    const credential = await fetchCloudCredential(subject, cloudAccount.platform, cloudAccount.platformUid)
    if (!credential || !Array.isArray(credential.cookies) || !credential.cookies.length) {
      return { outcome: OUTCOME.FAILED, code: 'CREDENTIAL_UNAVAILABLE' }
    }
    let created = null
    try {
      created = await Promise.resolve(AccountManager.addAccount({
        platform: cloudAccount.platform,
        name: cloudAccount.displayName || cloudAccount.accountName || '',
        account_name: cloudAccount.accountName || '',
        platform_account_id: cloudAccount.platformUid || '',
        followers: typeof cloudAccount.followers === 'number' ? cloudAccount.followers : null,
        avatar: cloudAccount.avatar || '',
        is_active: cloudAccount.isActive !== false,
        // 跨设备恢复的凭证来自云端镜像，不经本机登录捕获 → 弱证据，不得固化 active
        loginVerified: false,
      }))
    } catch (e) {
      return { outcome: OUTCOME.FAILED, code: errorMessage(e) }
    }
    const accountId = created && created.data && created.data.id
    if (!accountId) {
      return { outcome: OUTCOME.FAILED, code: (created && (created.errorCode || created.message)) || 'ACCOUNT_CREATE_FAILED' }
    }
    // 顺序不可颠倒：凭证未落盘不得声称该账号可用（AGENTS.md 固化顺序）
    try {
      await Promise.resolve(credentialStore.saveCredential(accountId, credential, userDataDir, subject))
    } catch (e) {
      log('warn', 'restore-credential-failed', `platform=${cloudAccount.platform} accountId=${accountId} message=${errorMessage(e)}`)
      return { outcome: OUTCOME.FAILED, code: 'CREDENTIAL_PERSIST_FAILED', accountId }
    }
    await markNeedLocalAttestation(accountId, cloudAccount.platform)
    return { outcome: OUTCOME.RESTORED, accountId, elapsedMs: now() - startedAt }
  }

  // ── 主流程 ──────────────────────────────────────────────────────
  async function sync (subject) {
    if (running) return { code: 409, errorCode: 'CLOUD_SYNC_IN_PROGRESS', data: emptySummary() }
    try { assertReady() } catch (e) { return { code: 503, errorCode: errorMessage(e), data: emptySummary() } }

    running = true
    abortRequested = false
    const startedAt = now()
    const summary = emptySummary()

    try {
      const accounts = await Promise.resolve(AccountManager.listAccounts())
      const locals = Array.isArray(accounts) ? accounts.filter((a) => a && a.id && a.platform) : []
      const prepared = new Array(locals.length).fill(null)

      await mapWithConcurrency(locals, concurrency, async (account, index) => {
        if (abortRequested) return
        send({ phase: 'start', index: index + 1, total: locals.length, platform: account.platform, accountId: account.id, name: account.name || '' })
        const row = await raceWithTimeout(
          Promise.resolve(loadLocalRow(account, subject)).catch((e) => ({ __cloudSyncError: errorMessage(e) })),
          accountTimeoutMs, TIMEOUT_SENTINEL,
        )
        if (isTimeout(row) || !row) {
          prepared[index] = null
          summary.failed += 1
          summary.items.push({ accountId: account.id, platform: account.platform, name: account.name || '', outcome: OUTCOME.FAILED, code: 'SYNC_BUDGET_EXCEEDED' })
          send({ phase: 'done', index: index + 1, total: locals.length, platform: account.platform, accountId: account.id, name: account.name || '', outcome: OUTCOME.FAILED, code: 'SYNC_BUDGET_EXCEEDED' })
          return
        }
        if (row.__cloudSyncError) {
          prepared[index] = null
          summary.failed += 1
          summary.items.push({ accountId: account.id, platform: account.platform, name: account.name || '', outcome: OUTCOME.FAILED, code: row.__cloudSyncError })
          send({ phase: 'done', index: index + 1, total: locals.length, platform: account.platform, accountId: account.id, name: account.name || '', outcome: OUTCOME.FAILED, code: row.__cloudSyncError })
          return
        }
        prepared[index] = row
      })

      const rows = prepared.filter(Boolean)
      // 墓碑命中与身份不明在本机侧先分池，不必问服务端
      const uploadable = rows.filter((r) => r.platformUid && !r.credentialError)
      const blockedByUid = rows.filter((r) => !r.platformUid && !r.credentialError)
      const credentialMissing = rows.filter((r) => r.credentialError)
      blockedByUid.forEach((r) => {
        summary.uidUnavailable += 1
        summary.items.push({ accountId: r.accountId, platform: r.platform, name: r.displayName, outcome: OUTCOME.UID_UNAVAILABLE, code: 'ACCOUNT_UID_INVALID' })
      })
      credentialMissing.forEach((r) => {
        summary.failed += 1
        summary.items.push({ accountId: r.accountId, platform: r.platform, name: r.displayName, outcome: OUTCOME.FAILED, code: r.credentialError })
      })

      // 一次性 PUT，由服务端逐条裁决 created/updated/unchanged/conflict/rejected
      const cloudFull = await callApi(subject, ACCOUNT_PATH, { method: 'GET', query: 'view=full' })
        .then((v) => (isTimeout(v) ? null : v))
        .catch(() => null)
      const tombstoneKeys = new Set(cloudFull && Array.isArray(cloudFull.tombstones) ? cloudFull.tombstones.map((t) => keyOf(t.platform, t.platformUid)) : [])

      const toUpload = []
      uploadable.forEach((r) => {
        if (tombstoneKeys.has(keyOf(r.platform, r.platformUid))) {
          summary.skipped += 1
          summary.items.push({ accountId: r.accountId, platform: r.platform, name: r.displayName, outcome: OUTCOME.SKIPPED_TOMBSTONE })
          return
        }
        toUpload.push(r)
      })

      let results = []
      if (toUpload.length) {
        const put = await raceWithTimeout(
          callApi(subject, ACCOUNT_PATH, { method: 'PUT', body: { accounts: toUpload.map(toUpsertPayload) } }),
          Math.max(accountTimeoutMs, totalBudgetMs - (now() - startedAt)), TIMEOUT_SENTINEL,
        )
        if (isTimeout(put) || !put || put.__cloudSyncError) {
          summary.errorCode = isTimeout(put) ? 'SYNC_BUDGET_EXCEEDED' : put && put.__cloudSyncError
          toUpload.forEach((r) => {
            summary.failed += 1
            summary.items.push({ accountId: r.accountId, platform: r.platform, name: r.displayName, outcome: OUTCOME.FAILED, code: summary.errorCode })
          })
        } else {
          results = Array.isArray(put.results) ? put.results : []
        }
      }

      const rowByKey = new Map(toUpload.map((r) => [keyOf(r.platform, r.platformUid), r]))
      const outcomeToCounter = { [OUTCOME.CREATED]: 'created', [OUTCOME.UPDATED]: 'updated', [OUTCOME.UNCHANGED]: 'unchanged' }
      for (const res of results) {
        const row = rowByKey.get(keyOf(res.platform, res.platformUid))
        if (!row) continue
        if (res.outcome === 'conflict') {
          const outcome = await settleConflict(subject, row, res)
          summary.conflicts += 1
          summary.items.push({ accountId: row.accountId, platform: row.platform, name: row.displayName, outcome })
          send({ phase: 'done', platform: row.platform, accountId: row.accountId, name: row.displayName, outcome })
          continue
        }
        if (res.outcome === 'rejected') {
          summary.failed += 1
          summary.items.push({ accountId: row.accountId, platform: row.platform, name: row.displayName, outcome: OUTCOME.FAILED, code: res.errorCode || 'ACCOUNT_REJECTED' })
          send({ phase: 'done', platform: row.platform, accountId: row.accountId, name: row.displayName, outcome: OUTCOME.FAILED, code: res.errorCode })
          continue
        }
        const counter = outcomeToCounter[res.outcome]
        if (counter) summary[counter] += 1
        else { summary.failed += 1; summary.items.push({ accountId: row.accountId, platform: row.platform, name: row.displayName, outcome: OUTCOME.FAILED, code: res.errorCode || 'CLOUD_RESULT_MISSING' }); continue }
        summary.items.push({ accountId: row.accountId, platform: row.platform, name: row.displayName, outcome: res.outcome, code: res.errorCode })
        send({ phase: 'done', platform: row.platform, accountId: row.accountId, name: row.displayName, outcome: res.outcome, code: res.errorCode })
      }

      // 云端有、本机无 → 恢复
      const localKeys = new Set(rows.filter((r) => r.platformUid).map((r) => keyOf(r.platform, r.platformUid)))
      const cloudAccounts = cloudFull && Array.isArray(cloudFull.accounts) ? cloudFull.accounts : []
      const toRestore = cloudAccounts.filter((c) => c.platform && c.platformUid
        && !localKeys.has(keyOf(c.platform, c.platformUid))
        && !tombstoneKeys.has(keyOf(c.platform, c.platformUid)))
      for (const c of toRestore) {
        if (abortRequested) break
        send({ phase: 'start', index: 0, total: toRestore.length, platform: c.platform, name: c.displayName || c.accountName || '' })
        const result = await raceWithTimeout(
          Promise.resolve(restoreToLocal(subject, c, startedAt)).catch((e) => ({ outcome: OUTCOME.FAILED, code: errorMessage(e) })),
          accountTimeoutMs, TIMEOUT_SENTINEL,
        )
        const settled = isTimeout(result) ? { outcome: OUTCOME.FAILED, code: 'SYNC_BUDGET_EXCEEDED' } : result
        if (settled.outcome === OUTCOME.RESTORED) summary.restored += 1
        else summary.failed += 1
        summary.items.push({ accountId: settled.accountId || null, platform: c.platform, name: c.displayName || '', outcome: settled.outcome, code: settled.code })
        send({ phase: 'done', index: 0, total: toRestore.length, platform: c.platform, accountId: settled.accountId || null, name: c.displayName || '', outcome: settled.outcome, code: settled.code })
      }

      summary.queuedCheck = summary.items.filter((i) => i.outcome === OUTCOME.RESTORED).length
      summary.elapsedMs = now() - startedAt
      summary.aborted = abortRequested
      if (now() - startedAt > totalBudgetMs && !summary.errorCode) summary.errorCode = 'SYNC_BUDGET_EXCEEDED'
      finishSummary(summary)
      log('info', 'summary', `created=${summary.created} updated=${summary.updated} unchanged=${summary.unchanged} restored=${summary.restored} skipped=${summary.skipped} conflicts=${summary.conflicts} invalid=${summary.invalid} uidUnavailable=${summary.uidUnavailable} failed=${summary.failed} aborted=${summary.aborted}`)
      return { code: 0, data: summary }
    } catch (e) {
      const code = errorMessage(e)
      log('error', 'failed', code)
      summary.errorCode = code
      summary.failed += 1
      summary.elapsedMs = now() - startedAt
      finishSummary(summary)
      return { code: 500, errorCode: code, data: summary }
    } finally {
      running = false
    }
  }

  /**
   * 服务端只报「有差异」，哪一份胜出必须由本机实测决定（PRD §5.5）。
   * 返回逐条结果枚举，并把胜出的一方落到正确位置。
   */
  async function settleConflict (subject, row, res) {
    const cloudCredential = await fetchCloudCredential(subject, row.platform, row.platformUid)
    const cloudNewer = res && res.credentialFreshness === 'cloud'
    const resolution = await resolveCredentialConflict(row.platform, row.credential, cloudCredential, cloudNewer)

    if (resolution.winner === 'cloud') {
      const applied = await applyCredentialLocally(subject, row.accountId, resolution.credential, row.platform)
      if (!applied) return OUTCOME.FAILED
      await callApi(subject, ACCOUNT_PATH, { method: 'PUT', body: { accounts: [{ ...toUpsertPayload({ ...row, credential: resolution.credential }), force: 'cloud-wins' }] } })
        .catch((e) => log('warn', 'conflict-cloud-put-failed', errorMessage(e)))
      return OUTCOME.CONFLICT_CLOUD
    }
    if (resolution.invalid) {
      // 两份都明确失效：本机原样保留，如实告诉用户需要重新登录（不静默丢弃）
      return OUTCOME.INVALID_CREDENTIAL
    }
    if (resolution.winner === 'keep-local') {
      await callApi(subject, ACCOUNT_PATH, { method: 'PUT', body: { accounts: [{ ...toUpsertPayload(row), force: 'local-wins' }] } })
        .catch((e) => log('warn', 'conflict-local-put-failed', errorMessage(e)))
      return OUTCOME.CONFLICT_UNRESOLVED
    }
    // 本机较新且有效 → 上行覆盖云端
    await callApi(subject, ACCOUNT_PATH, { method: 'PUT', body: { accounts: [{ ...toUpsertPayload(row), force: 'local-wins' }] } })
      .catch((e) => log('warn', 'conflict-local-put-failed', errorMessage(e)))
    return OUTCOME.CONFLICT_LOCAL
  }

  function disconnect (subject, confirm) {
    if (confirm !== 'cloud') return Promise.resolve({ code: 400, errorCode: 'DISCONNECT_CONFIRMATION_REQUIRED' })
    try { assertReady() } catch (e) { return Promise.resolve({ code: 503, errorCode: errorMessage(e) }) }
    return callApi(subject, DISCONNECT_PATH, { method: 'POST', body: { confirm } })
      .then((data) => ({ code: 0, data }))
      .catch((e) => ({ code: 500, errorCode: errorMessage(e) }))
  }

  return {
    digest, sync, disconnect,
    requestAbort: () => { if (!running) return false; abortRequested = true; return true },
    isRunning: () => running,
    OUTCOME,
  }
}

module.exports = { createCloudAccountSync, OUTCOME, keyOf, mapWithConcurrency, raceWithTimeout, TIMEOUT_SENTINEL }
