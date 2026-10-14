// @ts-check
/**
 * ops-center-sync.js — 运营后台 → 桌面端运行时同步（主进程）
 *
 * 1. 模型目录：/api/v1/model-presets/catalog（限流/模型/能力）→ ModelProviderManager.applyCatalog
 * 2. 运行时策略：/api/v1/runtime/bootstrap（公告 / 版本发布策略 / 内容安全敏感词 / 功能开关 / 平台发布元数据 / 官方内容模板 / 关键词监测目录）→ applyRuntime
 *
 * 安全：
 *   - API Key 经 safeStorage 加密后存 settings（不落明文）
 *   - URL 必须 http(s)（非本机回环强制 https）；禁重定向；10s 超时；响应 ≤1MB
 *   - 目录/运行时结构校验失败 fail-closed（不写本地）
 *
 * 断连韧性（2026-10-07，ops-center-resilience）：本文件只做接线，逻辑在两个新模块里
 *   - ops-runtime-snapshot.js：L2 快照 / L3 种子 / canonicalJson 与 config_hash
 *   - ops-resilience-reporter.js：降级事件本地队列 + 配置生效 ACK（拆分理由：本文件在 max-lines 债务清单上）
 */
'use strict'

const crypto = require('./crypto')
const nodeCrypto = require('crypto') // 内建密码学：Ed25519 验签（与上方 safeStorage 封装区分）
// 应用菜单配置净化（2026-09-15）：拆出独立模块以控制本文件体量（债务熔断 < 500 行）
const { normalizeAppMenu } = require('./app-menu-config')
const { resolveAutoSyncGuard, emitAutoSyncOutcome, safeOrigin } = require('./ops-center-sync-autosync-guard')
// 同步地址三口径（手填/自动/生效）：把「手动态」从混装的 url 字段里拆出来（纯函数，独立模块控体量）
const { resolveSyncUrls, shouldRefusePin } = require('./ops-center-sync-url')
// P0-1 信任锚：内置 DEV 公钥只对未打包态生效（判据拆独立模块，兼控本文件体量）
const { resolveTrustAnchor, resolveRuntimePublicKey, isPackagedApp } = require('./runtime-trust-anchor')
// 统一内容类别（2026-10-03）：热门选题 / 采集库 / 账号标签 共用的单一真源
const { normalizeContentCategories } = require('./content-categories')
// 断连韧性：L2/L3 数据源 + canonicalJson/config_hash 真源（canonicalJson 自本文件迁入，导出保持不变）
const { OpsRuntimeSnapshot, canonicalJson, replayLateBlock } = require('./ops-runtime-snapshot')
const { OpsResilienceReporter, classifyFailureKind, resolveResilienceAuth, tagOpsError, RUNTIME_ENDPOINT } = require('./ops-resilience-reporter')

const SETTING_KEY = 'opsCenterSync'
const RUNTIME_SETTING_KEY = 'opsCenterRuntime'
const MAX_CATALOG_BYTES = 1024 * 1024
const SYNC_TIMEOUT_MS = 10 * 1000
const MAX_FEATURE_FLAGS = 100

/** 内置默认 Ed25519 公钥（DEV KEY，2026-09-02）。与 .env.example 的 DEV 私钥配对，仅开发/演示自验环用。
 * 生产部署必须自建密钥对，并在部署层（identity-public.json 的 runtimePublicKey / env RUNTIME_PUBLIC_KEY）指定信任锚。 */
const DEFAULT_RUNTIME_PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAr6a4g942N23o31XNIcwFGX9VhSu2jlGA9dT1bfJIDpg=',
  '-----END PUBLIC KEY-----',
].join('\n')

/** 功能开关结构校验：仅接受 {key: 基本类型值}，超限/非法结构 fail-closed 返回空对象 */
function normalizeFeatureFlags(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  const entries = Object.entries(raw)
  if (entries.length > MAX_FEATURE_FLAGS) return {}
  for (const [k, v] of entries) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') {
      out[k] = v
    }
  }
  return out
}


function normalizeUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  let parsed
  try { parsed = new URL(text) } catch { return '' }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
  if (parsed.username || parsed.password) return ''
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopback = host === 'localhost' || host === '::1' || /^127\./.test(host)
  if (!isLoopback && parsed.protocol !== 'https:') return ''
  return parsed.toString().replace(/\/+$/, '')
}

/**
 * canonical JSON 序列化已迁至 ops-runtime-snapshot.js（config_hash 需要在客户端 / 导出脚本 /
 * CI 校验三处算出同一个值，各自一份必然漂移）。此处保留具名导入与再导出，既有固定向量
 * （ops-center-sync.test.js）与验签路径继续指向同一实现。
 */

/** Ed25519 验签：`{ ok: true }` 或 `{ ok: false, reason }`；缺失签名/签名非法一律拒绝（fail-closed） */
function verifyRuntimeSignature (payload, publicKeyPem) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'INVALID_PAYLOAD' }
  const sigB64 = payload.signature
  if (!sigB64 || typeof sigB64 !== 'string') return { ok: false, reason: 'MISSING_SIGNATURE' }
  // 无自定义锚时：未打包回落内置 DEV 公钥；打包版直接拒绝（NO_PRODUCTION_TRUST_ANCHOR）——
  // 否则持有 DEV 私钥的人可给生产客户端下发整份运行时策略（公告/版本/敏感词/应用菜单）。
  const anchor = resolveTrustAnchor(publicKeyPem, DEFAULT_RUNTIME_PUBLIC_KEY)
  if (anchor.error) return { ok: false, reason: anchor.error }
  const pem = anchor.pem
  let pubKey
  try { pubKey = nodeCrypto.createPublicKey(pem) } catch { return { ok: false, reason: 'INVALID_PUBLIC_KEY' } }
  let sig
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sigB64)) return { ok: false, reason: 'INVALID_SIGNATURE_ENCODING' }
    sig = Buffer.from(sigB64, 'base64')
    if (sig.length !== 64) return { ok: false, reason: 'INVALID_SIGNATURE_LENGTH' }
  } catch { return { ok: false, reason: 'INVALID_SIGNATURE_ENCODING' } }
  const { signature: _sig, ...rest } = payload
  try {
    const canonical = Buffer.from(canonicalJson(rest), 'utf-8')
    return nodeCrypto.verify(null, canonical, pubKey, sig) ? { ok: true } : { ok: false, reason: 'SIGNATURE_MISMATCH' }
  } catch { return { ok: false, reason: 'VERIFY_ERROR' } }
}

class OpsCenterSync {
  constructor({ store, modelProviderManager, log }) {
    this._store = store
    this._manager = modelProviderManager
    this._log = log || { info() {}, warn() {}, error() {}, notify() {} }
    // 运行时策略状态（公告/版本发布/内容安全），启动时从 settings 恢复
    this._runtime = this._loadRuntimeState()
    this._sensitiveFilter = null
    this._updatePolicyConsumer = null
    this._platformConfig = null
    this._templateManager = null
    this._keywordMonitor = null
    // 运营配置落地后通知主进程广播渲染端（免重启生效）；由 bootstrap 经 setter 注入
    this._onRuntimeUpdated = null
    // 方案C 零配置：运营中心自动发现 URL（由 bootstrap 经 setOpsCenterUrl 注入，优先于全局 env，避免污染其他读取者）
    this._autoOpsCenterUrl = ''
    // 断连韧性（2026-10-07）：L2/L3 数据源与上报侧独立成模块，本类只留接线
    this._snapshots = new OpsRuntimeSnapshot({ store, log: this._log, resourcesPath: this._resolveResourcesPath() })
    // fetcher 必须显式注入：不注入时 reporter._fetcher 为 null，_postJson 一律返回 {code:0, skipped:true}，
    // 而调用方按 code 0 判成功 ⇒ 降级事件被丢弃、ACK 记为「已发」并空烧 24h 心跳窗口（测试注入了故全绿）。
    this._resilience = new OpsResilienceReporter({
      store,
      log: this._log,
      fetcher: typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getAuth: () => this._resilienceAuth(),
    })
    this._servingTier = 'default'
    this._restoredFromDisk = false
    // 保留用于重放的原始 payload：注入器可能晚于水合到达（setPlatformConfig 就是这样），
    // 晚到时据此补喂对应数据块，避免「恢复了但少一块」且症状与未持久化无法区分。
    this._replayPayload = null
  }

  /** 打包态的资源目录（开发态为空，只走 asar 内候选路径） */
  _resolveResourcesPath() {
    try { return process.resourcesPath ? String(process.resourcesPath) : '' } catch (_) { return '' }
  }

  /** 上报鉴权（catalog key 优先，其次零配置自动发现的 bearer；判据见 reporter 模块注释） */
  _resilienceAuth() {
    return resolveResilienceAuth({
      manualUrl: this._getManualUrl(),
      auto: this._getAutoContext(),
      apiKeyConfigured: this.getConfig().apiKeyConfigured,
      readEncryptedKey: () => this._readEncryptedKey(),
    })
  }

  /** 当前配置由哪一层提供（L1 内存 / L2 本地快照 / L3 打包种子 / 代码内置默认值） */
  getServingTier() {
    return this._servingTier
  }

  /**
   * 启动时从 L2/L3 水合运行时策略（design §4.1）。为什么重放原始 payload 而不是各管理器各自的持久化：
   * 6 个注入管理器的入参就是 bootstrap 原始块，原样重喂即重放全部内存态（这正是「重启丢 6 类数据」的修复点）。
   * 幂等：只跑一次；重放不改写 L2（L3 只读不落盘），syncedAt 停在快照里的服务端时间。
   */
  restoreRuntimeFromDisk() {
    if (this._restoredFromDisk) return { tier: this._servingTier, replayed: false }
    this._restoredFromDisk = true
    const snapshot = this._snapshots.readSnapshotPayload()
    if (snapshot) {
      this.applyRuntime(snapshot, { replay: true, persistSnapshot: false })
      this._replayPayload = snapshot
      this._servingTier = 'L2'
      this._log.notify('OpsCenterSync', 'runtime-hydrated-from-snapshot', { params: { tier: 'L2' } })
      return { tier: 'L2', replayed: true }
    }
    const seed = this._snapshots.readSeed()
    if (seed) {
      this.applyRuntime(seed.payload, { replay: true, persistSnapshot: false })
      this._replayPayload = seed.payload
      this._servingTier = 'L3'
      this._log.notify('OpsCenterSync', 'runtime-hydrated-from-seed', { params: { tier: 'L3', source: seed.meta.source, staleDays: seed.staleDays } })
      return { tier: 'L3', replayed: true }
    }
    this._servingTier = 'default'
    this._log.notify('OpsCenterSync', 'runtime-hydrated-fallback', { level: 'WARN', params: { tier: 'default' } })
    return { tier: 'default', replayed: false }
  }

  /**
   * 读取一份持久化对象（本服务的唯一读取口径）。
   * `store.getSetting` 返回的是**解析后的值**，历史代码在此再 `JSON.parse` 会把对象
   * 变成 `[object Object]` 并静默退化为空配置；因此一律走 `getSettingObject`。
   * 缺失/损坏按"无配置"处理；注入物不符合存储契约必须留痕，不许静默变空。
   */
  _readStoredObject (settingKey) {
    const store = this._store
    if (!store) {
      this._log && this._log.notify('OpsCenterSync', 'store-missing-empty-config', { level: 'WARN', params: { settingKey } })
      return {}
    }
    if (typeof store.getSettingObject !== 'function') {
      this._log && this._log.notify('OpsCenterSync', 'get-setting-object-missing', { level: 'WARN', params: { settingKey } })
      return {}
    }
    try {
      return store.getSettingObject(settingKey, {})
    } catch (e) {
      this._log && this._log.notify('OpsCenterSync', 'setting-read-failed', { level: 'WARN', params: { settingKey }, error: String((e && e.message) || e) })
      return {}
    }
  }

  /** 读取同步配置（apiKey 脱敏，不返回明文） */
  getConfig() {
    const cfg = this._readStoredObject(SETTING_KEY)
    const auto = this._getAutoContext()
    const u = resolveSyncUrls({ storedUrl: cfg.url, autoUrl: auto ? auto.url : '', autoAvailable: !!auto })
    return {
      // 三口径显式分开：manualUrl 是判「手动态」的唯一依据；url 是同值历史别名（@deprecated）
      manualUrl: u.manualUrl,
      effectiveUrl: u.effectiveUrl,
      url: u.effectiveUrl,
      apiKeyConfigured: !!(cfg.apiKeyEnc),
      autoSync: cfg.autoSync !== false,
      lastSyncedAt: cfg.lastSyncedAt || '',
      runtimePublicKey: cfg.runtimePublicKey || '',
      autoConnected: u.autoConnected,
      autoUrl: u.autoUrl,
    }
  }

  /** 保存同步配置；apiKey 为空 = 保留现有 Key */
  saveConfig({ url, apiKey, autoSync, runtimePublicKey }) {
    const current = this.getConfig()
    const cleanUrl = normalizeUrl(url)
    if (url && !cleanUrl) {
      return { code: -1, message: 'Ops Center 地址必须是 http(s) URL（非本机地址强制 https）' }
    }
    // 固化护栏：零配置态下把自动地址原样写回手填不可逆（判据见 ops-center-sync-url.js::shouldRefusePin）
    const auto = this._getAutoContext()
    if (shouldRefusePin({ storedUrl: current.manualUrl, autoUrl: auto ? auto.url : '', candidate: cleanUrl })) {
      return { code: -1, message: '当前是自动发现的运营中心地址（未手填），无需保存；留空即跟随部署层' }
    }
    // apiKey 为空时透传已有密文（绝不解密后回写，避免明文落盘/解密失败抹 Key）
    let apiKeyEnc = this._getStoredKeyEnc()
    if (apiKey) {
      if (!crypto.isAvailable()) return { code: -1, message: '系统加密不可用，无法安全保存 API Key' }
      apiKeyEnc = crypto.encrypt(String(apiKey)).toString('base64')
    }
    // runtimePublicKey：Ed25519 自定义信任锚（PEM）。undefined/null = 保留现有值；
    // 显式空串 = 清除自定义锚（回退内置默认锚）；非空则必须先通过公钥解析才允许落盘。
    let pubKey = current.runtimePublicKey || ''
    if (runtimePublicKey !== undefined && runtimePublicKey !== null) {
      const trimmed = String(runtimePublicKey).trim()
      if (trimmed) {
        try { nodeCrypto.createPublicKey(trimmed) } catch { return { code: -1, message: 'runtimePublicKey 必须是合法 Ed25519 PEM 公钥' } }
      }
      pubKey = trimmed
    }
    const cfg = {
      url: cleanUrl,
      apiKeyEnc,
      autoSync: autoSync !== false,
      lastSyncedAt: current.lastSyncedAt || '',
      runtimePublicKey: pubKey,
    }
    try {
      this._store.setSetting(SETTING_KEY, cfg)
      return { code: 0, config: this.getConfig() }
    } catch (e) {
      return { code: -1, message: '保存同步配置失败: ' + e.message }
    }
  }

  _readEncryptedKey() {
    const cfg = this._readStoredObject(SETTING_KEY)
    if (!cfg.apiKeyEnc) return ''
    try { return crypto.decrypt(cfg.apiKeyEnc) } catch { return '' }
  }

  /** 读取用户手动配置的 Ops Center 地址（raw，不含方案C 自动发现回退）。用于区分手动态与零配置态 */
  _getManualUrl() {
    return this._readStoredObject(SETTING_KEY).url || ''
  }

  /** 立即同步：拉取目录 → applyCatalog → 运行时策略 → 更新 lastSyncedAt（in-flight 互斥） */
  async syncNow() {
    if (this._syncing) return { code: -1, message: '同步正在进行中，请稍候' }
    this._syncing = true
    try {
      return await this._syncNowInner()
    } finally {
      this._syncing = false
    }
  }

  async _syncNowInner() {
    const cfg = this.getConfig()
    // 方案C：优先使用自动发现的 context（identity-public.json + Logto JWT）。**不能用 getConfig().url
    // 判断手动态**（它把自动地址并入便于设置页展示）；否则零配置态下 !cfg.url 恒 false ⇒ useBearer 恒
    // false ⇒ 误报「未配置 API Key」、同步永不发起。此判据现已收敛到 getConfig().manualUrl。
    const auto = this._getAutoContext()
    const manualUrl = this._getManualUrl()
    const effectiveUrl = manualUrl || (auto ? auto.url : '')
    const useBearer = !manualUrl && !!auto && !cfg.apiKeyConfigured
    if (!effectiveUrl) return { code: -1, message: '未配置 Ops Center 地址' }
    if (!useBearer && !cfg.apiKeyConfigured) return { code: -1, message: '未配置 Ops Center API Key' }

    const makeAuth = () => (useBearer
      ? { type: 'bearer', getAccessToken: auto.getAccessToken }
      : { type: 'catalog-key', value: this._readEncryptedKey() })

    if (!this._manager || typeof this._manager.applyCatalog !== 'function') {
      // 模型服务未就绪时目录无处应用，但运营菜单/公告等运行时策略仍须下发
      return { code: -1, message: '模型服务未就绪', ...await this._syncRuntimeBestEffort(effectiveUrl, makeAuth) }
    }

    // 两条通道彼此独立且并行：目录（模型服务商配置）与运行时策略（公告/版本/菜单/开关）。串行会让任一条
    // 异常时另一条也拿不到（2026-09-25 复盘：目录失败导致运营菜单永远拉不到）；并行还保证总预算仍是单请求 10s。
    const [catalogSettled, runtimeSettled] = await Promise.allSettled([
      this._fetchCatalog(effectiveUrl, makeAuth()),
      this._fetchRuntime(effectiveUrl, makeAuth()),
    ])
    const runtimeResult = this._applyRuntimeSettled(runtimeSettled)

    if (catalogSettled.status === 'rejected') {
      return { code: -1, message: String((catalogSettled.reason && catalogSettled.reason.message) || catalogSettled.reason), ...runtimeResult }
    }

    const result = this._manager.applyCatalog(catalogSettled.value)
    if (result.code !== 0) return { ...result, ...runtimeResult }

    // 更新 lastSyncedAt
    const nowIso = new Date().toISOString()
    const updated = { url: manualUrl || '', apiKeyEnc: this._getStoredKeyEnc(), autoSync: cfg.autoSync, lastSyncedAt: nowIso, runtimePublicKey: cfg.runtimePublicKey || '' }
    try { this._store.setSetting(SETTING_KEY, updated) } catch (e) { this._log.notify('OpsCenterSync', 'last-synced-at-persist-failed', { level: 'WARN', error: String(e.message) }) }

    this._log.notify('OpsCenterSync', 'catalog-synced', { params: { updated: result.updated, at: nowIso, origin: safeOrigin(effectiveUrl) } })
    return { code: 0, updated: result.updated, syncedAt: nowIso, ...runtimeResult }
  }

  /** 拉取并应用运行时策略，失败仅告警（不影响调用方的目录结果） */
  async _syncRuntimeBestEffort(effectiveUrl, authFactory) {
    try {
      const runtime = await this._fetchRuntime(effectiveUrl, authFactory())
      return this._applyRuntimeSettled({ status: 'fulfilled', value: runtime })
    } catch (e) {
      return this._applyRuntimeSettled({ status: 'rejected', reason: e })
    }
  }

  /** 收敛 allSettled 的 runtime 结果：应用成功返回 applied，任何异常降级为 warn 不抛 */
  _applyRuntimeSettled(settled) {
    if (settled.status === 'fulfilled') {
      try {
        this.applyRuntime(settled.value)
        this._servingTier = 'L1'
        // 断连恢复补报 + 生效 ACK 都以「本轮成功应用」为触发点（失败路径不可能也不应该发）
        this._resilience.recordApplied({ payload: settled.value, servingTier: this._servingTier })
          .catch((e) => this._log.notify('OpsCenterSync', 'runtime-report-error', { level: 'WARN', error: String((e && e.message) || e) }))
        return { runtimeApplied: true, runtimeSyncedAt: settled.value.synced_at || '' }
      } catch (e) {
        this._log.notify('OpsCenterSync', 'runtime-apply-error', { level: 'WARN', error: String((e && e.message) || e) })
        return { runtimeApplied: false, runtimeSyncedAt: '' }
      }
    }
    const error = settled.reason
    this._log.notify('OpsCenterSync', 'runtime-sync-skipped', { level: 'WARN', error: String((error && error.message) || error) })
    // 连接失败与契约破坏都只是「本轮没拿到可信配置」：既有值 / L2 快照 / syncedAt 一律不动，
    // 同时记一条降级事件（design §4.3 + §3.4）。此处绝不区分二者 —— 分类由服务端校验决定。
    this._resilience.recordFailure({
      channel: 'runtime',
      endpoint: RUNTIME_ENDPOINT,
      failureKind: (error && error.failureKind) || classifyFailureKind(error),
      servingTier: this._servingTier,
    })
    return { runtimeApplied: false, runtimeSyncedAt: '' }
  }

  _getStoredKeyEnc() {
    return this._readStoredObject(SETTING_KEY).apiKeyEnc || ''
  }

  /** 读验签公钥：部署层优先，其次历史设置项；都没有返回空串（按打包态回落 DEV 或 fail-closed） */
  _getRuntimePublicKey() {
    return resolveRuntimePublicKey(this._deploymentPublicKey, this._readStoredObject(SETTING_KEY).runtimePublicKey)
  }

  // ─── 运行时策略（公告 / 版本发布 / 内容安全）────────────────

  _loadRuntimeState() {
    const state = this._readStoredObject(RUNTIME_SETTING_KEY)
    return {
      announcements: Array.isArray(state.announcements) ? state.announcements : [],
      updatePolicy: state.updatePolicy || null,
      contentPolicy: state.contentPolicy || null,
      featureFlags: normalizeFeatureFlags(state.featureFlags),
      pipelineOptions: (state.pipelineOptions && typeof state.pipelineOptions === 'object') ? state.pipelineOptions : null,
      appMenu: normalizeAppMenu(state.appMenu),
      contentCategories: normalizeContentCategories(state.contentCategories).items,
      syncedAt: state.syncedAt || '',
    }
  }

  _saveRuntimeState() {
    try { this._store.setSetting(RUNTIME_SETTING_KEY, this._runtime) } catch (e) { this._log.notify('OpsCenterSync', 'runtime-policy-persist-failed', { level: 'WARN', error: String(e.message) }) }
  }

  /** 运行时策略状态（公告/版本/内容安全）——IPC 暴露给渲染进程 */
  getRuntimeState() {
    const cp = this._runtime.contentPolicy
    // 敏感词库（word_list/replacement）仅保留在主进程，渲染端无需且最小权限
    return {
      announcements: this._runtime.announcements || [],
      updatePolicy: this._runtime.updatePolicy || null,
      contentPolicy: cp ? { name: cp.name, enabled: cp.enabled !== false, updatedAt: cp.updated_at || cp.updatedAt || '' } : null,
      featureFlags: this._runtime.featureFlags || {},
      pipelineOptions: this._runtime.pipelineOptions || null,
      appMenu: this._runtime.appMenu || null,
      contentCategories: this._runtime.contentCategories || [],
      syncedAt: this._runtime.syncedAt || '',
    }
  }

  /** 内容安全替换串（主进程消费；渲染端不返回） */
  getReplacement() {
    const cp = this._runtime.contentPolicy
    return (cp && cp.replacement) ? String(cp.replacement) : '***'
  }

  /** 目录同步 Key 明文（仅供内部上报/校验服务使用，不暴露给渲染进程） */
  getCatalogApiKey() {
    return this._readEncryptedKey()
  }

  /** 视频创作流水线选项控制（2026-08-31）：运营中心下发的可见性与默认值 */
  getPipelineOptions() {
    return this._runtime.pipelineOptions || null
  }

  /**
   * 应用端左侧边栏菜单配置（2026-09-15）：运营中心「应用菜单」下发的显示/隐藏与排序。
   * 返回 null 表示本轮无有效配置，渲染端据此 fail-open 回退本地默认菜单。
   */
  getAppMenu() {
    return this._runtime.appMenu || null
  }

  /**
   * 统一内容类别（2026-10-03）：运营中心「内容类别管理」下发的类别列表。
   * 返回空数组表示本轮无有效配置，渲染端据此 fail-open 回退内置 11 类。
   */
  getContentCategories() {
    const list = this._runtime.contentCategories
    return Array.isArray(list) ? list : []
  }

  /** 读取功能开关 typed value（主进程/引擎消费）；不存在返回 undefined */
  getFeatureFlag(key) {
    const flags = this._runtime.featureFlags || {}
    const k = String(key || '')
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return undefined
    return Object.prototype.hasOwnProperty.call(flags, k) ? flags[k] : undefined
  }

  /** 版本发布策略（auto-updater 消费） */
  getUpdatePolicy() {
    return this._runtime.updatePolicy || null
  }

  /** 设置更新策略消费者（bootstrap 注入 auto-updater 回调） */
  setUpdatePolicyConsumer(fn) {
    this._updatePolicyConsumer = typeof fn === 'function' ? fn : null
  }

  /** 注入平台配置加载器（phase1 接线）；无 applyRemote 的对象视为未注入 */
  setPlatformConfig(pc) {
    this._platformConfig = pc && typeof pc.applyRemote === 'function' ? pc : null
    // 补喂：setPlatformConfig 在 phase1 里位于 autoSyncOnStart **之后**，而 L2/L3 水合在
    // autoSyncOnStart 开头就跑完了 ⇒ platform_defs 恢复不到。判据与理由见 replayLateBlock。
    if (this._platformConfig) replayLateBlock(this._replayPayload, 'platform_defs', this._platformConfig, this._log, 'platform-defs')
  }

  /** 注入内容模板管理器（phase1 接线）；无 applyRemote 的对象视为未注入 */
  setTemplateManager(tm) {
    this._templateManager = tm && typeof tm.applyRemote === 'function' ? tm : null
  }

  /** 注入关键词监测器（phase1 接线）；无 applyRemoteWatchlist 的对象视为未注入 */
  setKeywordMonitor(km) {
    this._keywordMonitor = km && typeof km.applyRemoteWatchlist === 'function' ? km : null
  }

  /** 注入改写策略管理器（phase1 接线）；无 applyRemote 的对象视为未注入 */
  setRewriteStrategyManager(rsm) {
    this._rewriteStrategyManager = rsm && typeof rsm.applyRemote === 'function' ? rsm : null
  }

  /**
   * 注入改写硬约束管理器（rewrite-hard-constraints，2026-09-19）
   * bootstrap 下发默认硬约束版本；未注入时跳过（不影响其他运行时策略）。
   */
  setRewriteHardConstraintManager(rhcm) {
    this._rewriteHardConstraintManager = rhcm && typeof rhcm.applyRemote === 'function' ? rhcm : null
  }

  /**
   * 注入去 AI 味词库管理器（ai-taste-ops-center，2026-10-03）
   * bootstrap 下发词库覆盖层；未注入时跳过（引擎回内置词表）。
   */
  setRewriteAiTasteMapManager(ratm) {
    this._rewriteAiTasteMapManager = ratm && typeof ratm.applyRemote === 'function' ? ratm : null
  }

  /**
   * 注入改写引擎服务（rewrite-hard-constraints 审查 M2）：
   * 硬约束运行中更新时使引擎缓存失效，下次改写按新约束构建 systemPrompt。
   */
  setRewriteEngineService(res) {
    this._rewriteEngineService = res || null
  }


  /** 注入 access token 获取回调（方案C 零配置化：由 bootstrap 接线 authService.getAccessToken） */
  setGetAccessToken(fn) {
    this._getAccessToken = typeof fn === 'function' ? fn : null
  }

  /** 注入运营中心自动发现 URL（方案C 零配置：由 bootstrap 从 identity 运行时配置解析后传入，优先于全局 env） */
  setOpsCenterUrl(url) {
    this._autoOpsCenterUrl = normalizeUrl(url || '') || ''
  }

  setRuntimePublicKey(pem) { this._deploymentPublicKey = pem ? String(pem).trim() : '' }

  /**
   * 注入运行时策略变更通知器（由 bootstrap 在窗口就绪后接线）：
   * applyRuntime 成功后调用，主进程据此广播渲染端重拉配置，
   * 使「运营中心改了菜单/开关」不再依赖重启应用才生效。
   */
  setOnRuntimeUpdated(fn) {
    this._onRuntimeUpdated = typeof fn === 'function' ? fn : null
  }

  /**
   * 应用运行时策略：公告缓存 + 敏感词重建 + 更新策略推送 + 6 个注入管理器重放。
   * @param {object} payload bootstrap 原始 payload（重放时用 L2/L3 的原文）
   * @param {{replay?: boolean, persistSnapshot?: boolean}} [options]
   *   replay=true           —— 来自 L2/L3 的重放：不推进 syncedAt（停在快照里的服务端时间）
   *   persistSnapshot=false —— 只读水合，不写回 L2（L3 绝不能污染 L2 的「上次成功同步」语义）
   * 连接失败与验签失败路径根本不会走到本方法，这正是 design §4.3 真值表的落点。
   */
  applyRuntime(payload, options) {
    if (!payload || typeof payload !== 'object') return
    const { replay = false, persistSnapshot = !replay } = options || {}
    const next = {
      announcements: Array.isArray(payload.announcements) ? payload.announcements : [],
      updatePolicy: payload.update_policy && typeof payload.update_policy === 'object' ? payload.update_policy : null,
      contentPolicy: payload.content_policy && typeof payload.content_policy === 'object' ? payload.content_policy : null,
      featureFlags: normalizeFeatureFlags(payload.feature_flags),
      pipelineOptions: (payload.pipelineOptions && typeof payload.pipelineOptions === 'object') ? payload.pipelineOptions : null,
      appMenu: normalizeAppMenu(payload.appMenu),
      contentCategories: normalizeContentCategories(payload.contentCategories).items,
      syncedAt: payload.synced_at || (replay ? '' : new Date().toISOString()),
    }
    this._runtime = next
    this._sensitiveFilter = null // 触发惰性重建
    this._saveRuntimeState()
    // L2 快照存**原始 payload**（design §4.2）：启动时同一份原文再喂一次 applyRuntime，
    // 6 个注入管理器的内存态全部重放，无需为每个 setter 单独设计持久化格式。
    if (persistSnapshot) {
      const saved = this._snapshots.saveRawSnapshot(payload)
      if (!saved.ok) this._log.notify('OpsCenterSync', 'runtime-snapshot-skipped', { level: 'WARN', params: { reason: saved.reason } })
    }
    if (this._updatePolicyConsumer) {
      try { this._updatePolicyConsumer(next.updatePolicy) } catch (e) { this._log.notify('OpsCenterSync', 'update-policy-consumer-error', { level: 'WARN', error: String(e.message) }) }
    }
    // 平台发布元数据覆盖：注入 platformConfig 时应用；未注入跳过，不影响其他策略
    if (Array.isArray(payload.platform_defs) && this._platformConfig) {
      try {
        const n = this._platformConfig.applyRemote(payload.platform_defs)
        this._log.notify('OpsCenterSync', 'platform-defs-applied', { params: { platforms: n } })
      } catch (e) {
        this._log.notify('OpsCenterSync', 'platform-defs-apply-error', { level: 'WARN', error: String(e.message) })
      }
    }
    // 官方内容模板库覆盖：注入 templateManager 时应用；未注入跳过
    if (Array.isArray(payload.content_templates) && this._templateManager) {
      try {
        const n = this._templateManager.applyRemote(payload.content_templates)
        this._log.notify('OpsCenterSync', 'content-templates-applied', { params: { templates: n } })
      } catch (e) {
        this._log.notify('OpsCenterSync', 'content-templates-apply-error', { level: 'WARN', error: String((e && e.message) || e) })
      }
    }
    // 关键词监测目录覆盖：注入 keywordMonitor 时应用；未注入跳过
    if (Array.isArray(payload.keyword_watchlist) && this._keywordMonitor) {
      try {
        const n = this._keywordMonitor.applyRemoteWatchlist(payload.keyword_watchlist)
        this._log.notify('OpsCenterSync', 'keyword-watchlist-applied', { params: { entries: n } })
      } catch (e) {
        this._log.notify('OpsCenterSync', 'keyword-watchlist-apply-error', { level: 'WARN', error: String((e && e.message) || e) })
      }
    }
    // 改写策略运行时下发：注入 rewriteStrategyManager 时应用；未注入跳过
    if (Array.isArray(payload.rewrite_strategies) && this._rewriteStrategyManager) {
      try {
        const n = this._rewriteStrategyManager.applyRemote(payload.rewrite_strategies)
        this._log.notify('OpsCenterSync', 'rewrite-strategies-applied', { params: { strategies: n } })
      } catch (e) {
        this._log.notify('OpsCenterSync', 'rewrite-strategies-apply-error', { level: 'WARN', error: String((e && e.message) || e) })
      }
    }
    // 改写硬约束运行时下发（rewrite-hard-constraints，2026-09-19）：
    // bootstrap 携带默认版本时应用；未携带/未注入管理器时跳过（保持本地现状）。
    // 内容变化时通知改写引擎服务失效缓存（审查 M2：否则运行中 re-sync 后引擎沿用旧约束直到重启）
    if (payload.rewrite_hard_constraints && this._rewriteHardConstraintManager) {
      try {
        const changed = this._rewriteHardConstraintManager.applyRemote(payload.rewrite_hard_constraints)
        this._log.notify('OpsCenterSync', 'hard-constraints-applied', { params: { changed } })
        if (changed && this._rewriteEngineService && typeof this._rewriteEngineService.setHardConstraintManager === 'function') {
          // 重新注入使引擎缓存失效，下次改写按新硬约束构建 systemPrompt
          this._rewriteEngineService.setHardConstraintManager(this._rewriteHardConstraintManager)
          this._log.notify('OpsCenterSync', 'rewrite-cache-invalidated-hard-constraints')
        }
      } catch (e) {
        this._log.notify('OpsCenterSync', 'hard-constraints-apply-error', { level: 'WARN', error: String((e && e.message) || e) })
      }
    }
    // 去 AI 味词库运行时下发（ai-taste-ops-center，2026-10-03）：
    // bootstrap 携带词库覆盖层时应用；未携带/未注入管理器时跳过（保持本地现状）。
    // 变化时重注入改写引擎服务（照硬约束 M2 形态；remover 每次改写新建，重建即生效）。
    if (Array.isArray(payload.rewrite_ai_taste_map) && this._rewriteAiTasteMapManager) {
      try {
        const changed = this._rewriteAiTasteMapManager.applyRemote(payload.rewrite_ai_taste_map)
        this._log.notify('OpsCenterSync', 'ai-taste-map-applied', { params: { changed } })
        if (changed && this._rewriteEngineService && typeof this._rewriteEngineService.setAiTasteMapManager === 'function') {
          this._rewriteEngineService.setAiTasteMapManager(this._rewriteAiTasteMapManager)
          this._log.notify('OpsCenterSync', 'rewrite-cache-invalidated')
        }
      } catch (e) {
        this._log.notify('OpsCenterSync', 'ai-taste-map-apply-error', { level: 'WARN', error: String((e && e.message) || e) })
      }
    }
    this._log.notify('OpsCenterSync', 'runtime-applied', { params: { announcements: next.announcements.length, policy: next.updatePolicy ? 'set' : 'none' } })
    // 通知渲染端重拉运营配置（菜单/公告/功能开关），使「改了没生效」不再依赖重启。
    // 只传时间戳、不传配置内容：配置读取必须继续走受验签保护的 IPC 路径（design D4）。
    // 回调仅负责广播，任何窗口异常都不得影响已应用的运行时状态。
    if (this._onRuntimeUpdated) {
      try { this._onRuntimeUpdated({ syncedAt: next.syncedAt }) } catch (e) { this._log.notify('OpsCenterSync', 'runtime-updated-callback-error', { level: 'WARN', error: String((e && e.message) || e) }) }
    }
  }

  /** 敏感词过滤器：内置词库 + 远程内容安全策略词库（惰性构建） */
  getSensitiveFilter() {
    if (this._sensitiveFilter) return this._sensitiveFilter
    const words = []
    let SensitiveFilterClass = null
    try {
      SensitiveFilterClass = require('@multi-publish/shared-utils/src/sensitive-filter')
      if (SensitiveFilterClass.getBuiltinWords) words.push(...SensitiveFilterClass.getBuiltinWords())
    } catch { /* 内置词库不可用时降级为空词库 */ }
    const policy = this._runtime.contentPolicy
    if (policy && policy.enabled !== false && Array.isArray(policy.word_list)) {
      for (const w of policy.word_list) {
        if (typeof w === 'string' && w.trim()) words.push(w.trim())
      }
    }
    this._sensitiveFilter = SensitiveFilterClass ? new SensitiveFilterClass(Array.from(new Set(words))) : null
    return this._sensitiveFilter
  }

  // ─── 拉取 ───────────────────────────────────────────────


  /** 方案C 零配置化：从 identity 配置自动发现运营中心 URL，用 Logto JWT 鉴权；返回 {url, getAccessToken} 或 null。 */
  _getAutoContext() {
    const autoUrl = normalizeUrl(this._autoOpsCenterUrl || process.env.OPS_CENTER_URL || '')
    if (!autoUrl) return null
    if (!this._getAccessToken) return null
    return { url: autoUrl, getAccessToken: this._getAccessToken }
  }

  async _fetchCatalog(baseUrl, auth) {
    const data = await this._fetchJson('/api/v1/model-presets/catalog', auth, baseUrl)
    if (!data || !Array.isArray(data.items)) throw new Error('目录响应结构错误（缺少 items 数组）')
    return data.items
  }

  async _fetchRuntime(baseUrl, auth) {
    // 统一在出口打 failureKind：调用方（_applyRuntimeSettled）据此写降级事件，判据集中避免散落文案匹配。
    try {
      const data = await this._fetchJson('/api/v1/runtime/bootstrap', auth, baseUrl)
      // Stage -1.6：运行时策略（公告/版本/敏感词/featureFlags/pipelineOptions）Ed25519 验签。
      // 验签不通过 → 抛错，调用方整体拒绝应用任何运行时策略（fail-closed，pipelineOptions 永不经未验签路径合入）。
      const signed = verifyRuntimeSignature(data, this._getRuntimePublicKey())
      if (!signed.ok) {
        const hint = signed.reason === 'NO_PRODUCTION_TRUST_ANCHOR'
          ? '：打包版需在「运营中心同步配置」填写自定义 Ed25519 公钥作为信任锚' : ''
        throw new Error('运行时策略验签失败（' + signed.reason + '），已拒绝应用任何运行时策略' + hint)
      }
      if (!data || !Array.isArray(data.announcements)) throw new Error('运行时策略响应结构错误（缺少 announcements 数组）')
      return data
    } catch (e) { throw tagOpsError(e) }
  }

  async _fetchJson(path, auth, base) {
    // auth: { type: 'catalog-key', value } | { type: 'bearer', getAccessToken }
    // base 由调用方显式传入（此前内部重读混装的 getConfig().url，是唯一误用点）
    const url = String(base || process.env.OPS_CENTER_URL || '').replace(/\/+$/, '') + path
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS) : null
    let headers = { Accept: 'application/json' }
    if (auth && auth.type === 'bearer') {
      const token = await auth.getAccessToken()
      if (!token) throw new Error('无法获取登录凭证，请确认已登录')
      headers['Authorization'] = 'Bearer ' + token
    } else {
      headers['X-Catalog-Key'] = (auth && auth.value) || ''
    }
    let resp
    try {
      resp = await fetch(url, {
        headers,
        redirect: 'error',
        signal: controller?.signal,
      })
    } catch (e) {
      const isTimeout = e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')
      throw new Error(isTimeout ? '同步请求超时（10 秒）' : '无法连接 Ops Center: ' + (e.message || e.name), { cause: e })
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (resp.status === 401 || resp.status === 403) throw new Error('Ops Center API Key 无效（401/403）')
    if (resp.status === 404) throw new Error('Ops Center 端点未启用（404，需配置对应运营密钥/环境变量）')
    if (!resp.ok) throw new Error('Ops Center 返回 HTTP ' + resp.status)
    const buffer = Buffer.from(await resp.arrayBuffer())
    if (buffer.length > MAX_CATALOG_BYTES) throw new Error('运营同步响应超过 1MB，已拒绝')
    let data
    try { data = JSON.parse(buffer.toString('utf-8')) } catch { throw new Error('目录响应不是合法 JSON') }
    return data
  }

  /** 启动时 best-effort 自动同步（不阻塞启动；失败仅日志） */
  async autoSyncOnStart() {
    try {
      // 先水合 L2/L3：本方法由 phase1 在 6 个管理器注入完毕之后调用（既有顺序），
      // 因此此刻重放能真正把 6 类内存态喂回去 —— 顺序依赖写在这里的注释里以免被误删。
      this.restoreRuntimeFromDisk()
      const cfg = this.getConfig()
      const auto = this._getAutoContext()
      const guard = resolveAutoSyncGuard(cfg, !!auto, normalizeUrl(this._autoOpsCenterUrl || process.env.OPS_CENTER_URL || ''), typeof this._getAccessToken === 'function', isPackagedApp(), !!this._getRuntimePublicKey())
      emitAutoSyncOutcome(this._log, guard)
      if (!guard.ok) return
      setTimeout(() => {
        this.syncNow().then((r) => {
          if (r.code !== 0) this._log.notify('OpsCenterSync', 'auto-sync-skipped', { level: 'WARN', error: String(r.message) })
        }).catch((e) => this._log.notify('OpsCenterSync', 'auto-sync-error', { level: 'WARN', error: String(e.message) }))
      }, 3000)
    } catch (e) {
      this._log.notify('OpsCenterSync', 'auto-sync-init-error', { level: 'WARN', error: String(e.message) })
    }
  }
}

module.exports = { OpsCenterSync, normalizeUrl, canonicalJson, verifyRuntimeSignature, DEFAULT_RUNTIME_PUBLIC_KEY }
