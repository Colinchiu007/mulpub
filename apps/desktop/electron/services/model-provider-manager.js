// @ts-check
/**
 * ModelProviderManager - Global model provider management
 *
 * Manages 6 categories (llm/tts/speech_recognition/image/video/audio)
 * P2: API Key encrypted with Electron safeStorage (api_key_enc BLOB)
 */

const log = require('./logger')
const adapterRegistry = require('./adapters/_base/registry-singleton')
const {
  PRESET_PROVIDERS,
  CATEGORIES,
  MULTIMODAL_CAPABILITY_IDS,
} = require('./model-provider-seeds')
const crypto = require('./crypto')
const { providerAnomalyBus } = require('./provider-anomaly')
const { PROVIDER_LIMITS } = require('./governor-provider-limits')

/**
 * 有界超时包装：provider 请求在 timeoutMs 内未完成即抛 ProviderError(TIMEOUT)。
 * 底层 fetch 若无 AbortSignal 会继续在后台挂起，但调用链在此处收敛，
 * 超时被归为瞬时错误（governor/阶段重试）而不会无限阻塞整个流水线。
 */
function withCallTimeout (promise, timeoutMs, providerId, method) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const { ProviderError, ERROR_CODES } = require('./adapters/_base/provider-error')
      reject(new ProviderError(ERROR_CODES.TIMEOUT,
        'provider request timed out after ' + timeoutMs + 'ms (' + providerId + '.' + method + ')',
        { providerId }))
    }, timeoutMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

// 这些适配器只允许在回环地址且无凭据时直连，避免把无 API Key 的配置变成远程请求通道。
const LOCAL_NO_KEY_PROVIDER_IDS = new Set(['piper', 'local-diffusion', 'comfyui'])

function isLoopbackBaseUrl (value) {
  if (value === undefined || value === null || String(value).trim() === '') return true
  try {
    const url = new URL(String(value))
    const host = url.hostname.toLowerCase()
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]')
  } catch (_) {
    return false
  }
}

function canUseWithoutApiKey (provider) {
  return Boolean(provider && LOCAL_NO_KEY_PROVIDER_IDS.has(provider.id) &&
    isLoopbackBaseUrl(provider.base_url))
}

function hasUsableApiKey (apiKey) {
  return typeof apiKey === 'string' && apiKey.trim() !== ''
}

const FIXED_PROVIDER_MODELS = new Map([
  ['minimax-image', ['image-01']],
])

function normalizeProviderModels (providerId, models) {
  const fixedModels = FIXED_PROVIDER_MODELS.get(providerId)
  return fixedModels ? [...fixedModels] : (Array.isArray(models) ? models : [])
}

/**
 * 解析 provider 实际使用的默认模型 ID（2026-08-27 双默认语义：运营预设 + 用户选择）。
 * 优先级：
 *   1. config.user_default_model（桌面端用户下拉选择，用户级，最高优先）
 *   2. config.default_model（运营中心预设默认模型 ID，目录同步下发）
 *   3. capability_models[type]（多模态按能力路由，显示声明即使不在 models 也有效）
 *   4. 单能力 provider 回退 models[0]；多模态 provider 无能力声明不猜测（返回 ''，调用方 fail-closed）
 * 用户/运营默认值不在 models 中视为失效并回退（fail-closed，不报错不污染配置）。
 * @param {{ models?: unknown, config?: object|null, capability_models?: object|null, category?: string }} provider
 * @param {string} [type] 能力类型：llm/tts/speech_recognition/image/video/audio
 * @returns {string}
 */
function resolveProviderDefaultModel (provider, type) {
  if (!provider || typeof provider !== 'object') return ''
  const models = Array.isArray(provider.models)
    ? provider.models.filter(m => typeof m === 'string' && m.trim()).map(m => m.trim())
    : []
  const config = provider.config && typeof provider.config === 'object' ? provider.config : {}
  // 1. 用户默认（桌面端「默认模型」下拉选择）
  const userDefault = typeof config.user_default_model === 'string' ? config.user_default_model.trim() : ''
  if (userDefault && models.includes(userDefault)) return userDefault
  // 2. 运营中心预设默认（目录同步下发）
  const opsDefault = typeof config.default_model === 'string' ? config.default_model.trim() : ''
  if (opsDefault && models.includes(opsDefault)) return opsDefault
  // 3. 多模态能力路由（显示声明，不校验 ∈ models）
  if (type && provider.capability_models && typeof provider.capability_models === 'object') {
    const byCapability = provider.capability_models[type]
    if (typeof byCapability === 'string' && byCapability.trim()) return byCapability.trim()
  }
  // 4. 兜底：多模态不猜测（models[0] 可能是 TTS/图片模型），单能力取首模型
  if (provider.category === 'multimodal') return ''
  return models[0] || ''
}

class ModelProviderManager {
  constructor (store) {
    this._store = store
    this._ready = false
    // P3.2: Adapter 工厂注册表 + 实例缓存
    this._adapterCache = new Map()
    // 统一调度网关（ApiUsageGovernor）：每分钟连接次数/5小时限额注入目标
    this._governor = null
  }

  /** 注入统一调度网关（ApiUsageGovernor）；配置变更后预算会自动同步 */
  setGovernor (governor) {
    this._governor = governor || null
    if (this._ready) this._applyGovernorLimits()
  }

  /** 归一化运营限流配置值：正整数或 null（允许空）；布尔/0/负数/小数视为非法 → null */
  _normalizeConfigLimit (value) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'boolean') return null
    const num = Number(value)
    if (!Number.isFinite(num) || num < 1) return null
    return Math.floor(num)
  }

  /**
   * 把每个 provider 的运营限流预算（config.rate_per_minute / limit_per_5h）注入 governor：
   *   - rate_per_minute → setProviderLimits({ rpm, maxConcurrent })
   *   - limit_per_5h    → setTokenWindows(5h 请求次数窗口)
   * 未配置的 provider 保留静态表/类别默认预算（governor 构造时已注入 PROVIDER_LIMITS）。
   */
  _applyGovernorLimits () {
    const governor = this._governor
    if (!governor || typeof governor.setProviderLimits !== 'function' || !this._ready || !this._store || !this._store.db) return
    try {
      const rows = this._store.db.prepare('SELECT id, category, config FROM model_providers').all()
      for (const row of rows) {
        const config = safeJsonParse(row.config, {}) || {}
        const rpm = this._normalizeConfigLimit(config.rate_per_minute)
        const limit5h = this._normalizeConfigLimit(config.limit_per_5h)
        if (rpm !== null) {
          // 并发换算（2026-08-13 与 model-call-scheduler 对齐）：
          // 同步类（llm/tts/image/stt）：取 1/10（下限 1、上限 4）。
          // 视频（异步任务制）：rpm 只约束提交速率，2 路并行安全 → ceil(rpm/3) 上限 2；
          // 音频：保持 1（场景少、provider 单一）。
          const isVideo = row.category === 'video'
          const isAudio = row.category === 'audio'
          const maxConcurrent = isVideo
            ? Math.max(1, Math.min(2, Math.ceil(rpm / 3)))
            : isAudio
              ? 1
              : Math.max(1, Math.min(4, Math.round(rpm / 10)))
          governor.setProviderLimits(row.id, { rpm, maxConcurrent })
        } else if (PROVIDER_LIMITS[row.id]) {
          // 未配置/已清空 → 回填静态表预算（恢复默认，避免陈旧配置残留）
          governor.setProviderLimits(row.id, PROVIDER_LIMITS[row.id])
        } else if (typeof governor.removeProviderLimits === 'function') {
          // 自定义 provider 清空配置 → 移除预算，回退类别默认
          governor.removeProviderLimits(row.id)
        }
        if (limit5h !== null && typeof governor.setProviderTokenWindows === 'function') {
          // 5h 请求次数窗口（provider 级，覆盖该 provider 所有 type:model key）
          governor.setProviderTokenWindows(row.id, [{ windowMs: 5 * 3600 * 1000, limit: limit5h, field: 'requests' }])
        } else if (limit5h === null && typeof governor.setProviderTokenWindows === 'function') {
          // 未配置/已清空 → 清除该 provider 的 5h 窗口（静态表无 5h 窗口）
          governor.setProviderTokenWindows(row.id, [])
        }
      }
      log.info('ModelProviderManager', 'Governor limits applied for ' + rows.length + ' providers')
    } catch (e) {
      log.warn('ModelProviderManager', 'apply governor limits failed: ' + e.message)
    }
  }

  /**
   * 将预设声明的运营限流预算（rate_per_minute / limit_per_5h）回填到存量预设行 config，
   * 使升级前的数据库也能拿到预算（INSERT OR IGNORE 不会更新已存在的行）。
   * diff-merge：仅填充缺失键，保留用户已配置值。
   */
  _syncPresetLimits () {
    const db = this._store && this._store.db
    if (!db) return
    for (const p of PRESET_PROVIDERS) {
      if (p.rate_per_minute == null && p.limit_per_5h == null) continue
      try {
        const row = db.prepare('SELECT config FROM model_providers WHERE id = ?').get(p.id)
        if (!row) continue
        const config = safeJsonParse(row.config, {}) || {}
        let changed = false
        if (p.rate_per_minute != null && config.rate_per_minute == null) {
          config.rate_per_minute = this._normalizeConfigLimit(p.rate_per_minute)
          changed = true
        }
        if (p.limit_per_5h != null && config.limit_per_5h == null) {
          config.limit_per_5h = this._normalizeConfigLimit(p.limit_per_5h)
          changed = true
        }
        if (changed) {
          db.prepare("UPDATE model_providers SET config = ?, updated_at = datetime('now') WHERE id = ?")
            .run(JSON.stringify(config), p.id)
          this._invalidateAdapterCache(p.id)
        }
      } catch (e) {
        log.warn('ModelProviderManager', 'sync preset limits failed for ' + p.id + ': ' + e.message)
      }
    }
  }

  /**
   * P3.2: 注册 Adapter 工厂
   * @param {string} providerId - 供应商 ID（如 'openai'）
   * @param {function} factory - (credentials) => BaseAdapter 实例
   */
  registerAdapter (providerId, factory) {
    if (!providerId || typeof factory !== 'function') {
      log.error('ModelProviderManager', 'registerAdapter: invalid providerId or factory')
      return
    }
    if (adapterRegistry.hasFactory(providerId)) {
      adapterRegistry.removeFactory(providerId)
    }
    adapterRegistry.registerFactory(providerId, factory)
    // 注册后清除该 provider 的缓存（下次 callAdapter 重建）
    this._adapterCache.delete(providerId)
    log.info('ModelProviderManager', 'Adapter factory registered: ' + providerId)
  }

  /**
   * P3.2: 统一调用入口
   * @param {string} providerId - 供应商 ID
   * @param {string} method - 方法名（如 'chatCompletion'）
   * @param {object} params - 方法参数
   * @returns {Promise<{code: number, data?: any, message?: string, error?: Error}>}
   */
  async callAdapter (providerId, method, params = {}, options = {}) {
    const providerRunContext = options && typeof options === 'object' ? options.providerRunContext : null
    const { ProviderCircuitOpenError } = require('./provider-run-context')
    if (providerRunContext && providerRunContext.isOpen && providerRunContext.isOpen(providerId)) {
      const failure = providerRunContext.failureOf ? providerRunContext.failureOf(providerId) : null
      return { code: -1, errorCode: 'PROVIDER_CIRCUIT_OPEN', message: `服务商「${providerId}」已因额度/套餐上限熔断，本次运行已停止该服务商的新请求：${(failure && failure.message) || ''}`, error: new ProviderCircuitOpenError(providerId, failure && failure.message) }
    }
    if (!this._ready) return { code: -1, errorCode: 'STORE_NOT_INITIALIZED', message: '模型服务尚未初始化，请稍后重试或重启应用。' }

    // 获取 provider（含解密后的 api_key）
    const provider = this.getProviderWithKey(providerId)
    if (!provider) {
      return { code: -1, errorCode: 'PROVIDER_NOT_FOUND', message: `未找到服务商「${providerId}」，可能已被删除。请刷新列表后重试。` }
    }
    if (!hasUsableApiKey(provider.api_key) && !canUseWithoutApiKey(provider)) {
      return { code: -1, errorCode: 'API_KEY_NOT_CONFIGURED', message: `尚未配置 API Key，请先在「模型设置」中填写 ${provider.name || providerId} 的 API Key 后重试。` }
    }

    // 检查 Adapter 工厂是否可用（专用工厂优先，llm + base_url 走泛化 OpenAI 兼容兜底）
    if (!this._resolveAdapterFactory(provider)) {
      return { code: -1, errorCode: 'ADAPTER_NOT_FOUND', message: `未找到「${providerId}」对应的服务商适配器，请检查服务商配置后重试。` }
    }

    // 获取或创建 Adapter 实例（factory 可能同步抛异常）
    let adapter
    try {
      adapter = this._getOrCreateAdapter(providerId, provider)
    } catch (e) {
      const { ProviderError } = require('./adapters/_base/provider-error')
      if (e instanceof ProviderError) {
        return { code: -1, error: e, message: e.message }
      }
      return { code: -1, errorCode: 'ADAPTER_INIT_FAILED', message: '适配器初始化失败，请检查服务商配置与服务状态后重试。', messageParams: { detail: String(e && e.message || e) } }
    }

    // 能力检查（在调用前完成，避免不必要的日志记录）
    if (typeof adapter.supports === 'function' && !adapter.supports(method)) {
      return { code: -1, errorCode: 'OPERATION_NOT_SUPPORTED', message: `服务商「${providerId}」不支持该操作，请在「模型设置」中调整模型配置后重试。`, messageParams: { method } }
    }

    // 调用 + 统一日志记录（所有路径覆盖，不依赖 router logHandler）
    // 有界超时：部分 provider（如 agnes-llm）请求可挂起 2-3 分钟甚至更久（fetch 级无超时），
    // 必须在 callAdapter 兜底加超时（视频类放宽），超时抛 TIMEOUT → 归为瞬时错误自动重试。
    const timeoutMs = Number.isFinite(Number(params && params.timeoutMs)) && Number(params.timeoutMs) > 0
      ? Number(params.timeoutMs)
      : (provider.category === 'video' ? 10 * 60 * 1000 : 2 * 60 * 1000)
    const startTime = Date.now()
    try {
      if (providerRunContext && method === 'cloneVoice' && params && typeof params.name === 'string' && params.name) {
        const recovery = await withCallTimeout(providerRunContext.cloneVoiceOnce({
          providerId,
          voiceId: params.name,
          fn: () => adapter[method](params),
        }), timeoutMs, providerId, method)
        if (recovery.failed) {
          const error = recovery.error
          if (providerRunContext && typeof providerRunContext.openIfQuota === 'function') providerRunContext.openIfQuota(providerId, error)
          return { code: -1, error, message: (error && error.message) || 'voice clone failed' }
        }
        return { code: 0, data: { id: recovery.voiceId } }
      }
      const result = await withCallTimeout(adapter[method](params), timeoutMs, providerId, method)
      if (providerRunContext && result && typeof result === 'object' && (Number(result.code) < 0 || result.success === false)) {
        providerRunContext.openIfQuota(providerId, result.error && typeof result.error === 'object' ? result.error : result)
      }
      const latency_ms = Date.now() - startTime
      this._writeLog(provider, method, 'success', latency_ms, null)
      // 慢响应检测：超过类别阈值 → 记为模型服务异常（供前端提示 + 日志定位）
      if (providerAnomalyBus.isSlow(provider.category, latency_ms)) {
        providerAnomalyBus.report({
          providerId,
          category: provider.category,
          model: params && typeof params.model === 'string' ? params.model : null,
          latencyMs: latency_ms,
          kind: 'slow',
        })
      }
      return { code: 0, data: result }
    } catch (e) {
      const latency_ms = Date.now() - startTime
      const errorMsg = e.message || String(e)
      this._writeLog(provider, method, 'error', latency_ms, errorMsg)
      // ProviderError 透传
      const { ProviderError, ERROR_CODES } = require('./adapters/_base/provider-error')
      if (e instanceof ProviderError) {
        // 超时/网络错误也记为模型服务异常（配合有界超时兜底，便于前端提示与日志定位）
        if (e.code === ERROR_CODES.TIMEOUT || e.code === ERROR_CODES.NETWORK_ERROR) {
          providerAnomalyBus.report({
            providerId,
            category: provider.category,
            model: params && typeof params.model === 'string' ? params.model : null,
            latencyMs: latency_ms,
            kind: e.code === ERROR_CODES.TIMEOUT ? 'timeout' : 'network',
          })
        }
        if (providerRunContext && typeof providerRunContext.openIfQuota === 'function') providerRunContext.openIfQuota(providerId, e)
        return { code: -1, error: e, message: e.message }
      }
      // 普通 Error 包装
      if (providerRunContext && typeof providerRunContext.openIfQuota === 'function') providerRunContext.openIfQuota(providerId, e)
      log.error('ModelProviderManager', `callAdapter ${providerId}.${method} failed: ${e.message}`)
      return { code: -1, message: e.message }
    }
  }

  /**
   * 写入调用日志（安全包装，失败不影响主流程）
   * @param {object} provider - provider config（含 id/category）
   * @param {string} action - 调用方法名
   * @param {string} status - 'success' | 'error'
   * @param {number} latencyMs - 延迟毫秒
   * @param {string|null} errorMessage - 错误消息
   * @private
   */
  _writeLog (provider, action, status, latencyMs, errorMessage) {
    if (!this._store || typeof this._store.addProviderLog !== 'function') return
    try {
      this._store.addProviderLog({
        provider_id: provider.id,
        category: provider.category || 'unknown',
        action,
        status,
        latency_ms: latencyMs,
        error_message: errorMessage,
      })
    } catch (_) {
      // 日志写入失败不影响主流程
    }
  }

  /**
   * 解析 Adapter 工厂：专用工厂优先，未命中时对 OpenAI 兼容的 LLM provider 走泛化兜底。
   *
   * 背景：运营中心目录同步（applyCatalog）可下发桌面端预设未登记的 provider（如天翼云 Coding Plan）。
   * 绝大多数云厂商 LLM 接口兼容 OpenAI 格式，若每次新增都要在桌面端补专用 Adapter，会导致「设默认后不可用」。
   * 因此：未注册专用工厂时，只要 provider 是 llm 类别且配置了 base_url，即回退到 OpenAICompatibleAdapter。
   *
   * 不满足兜底条件（非 llm / 无 base_url）仍返回 null，由调用方 fail-closed。
   * @param {{ id?: string, category?: string, base_url?: string }} provider
   * @returns {function|null} factory 或 null
   */
  _resolveAdapterFactory (provider) {
    if (!provider || typeof provider !== 'object' || !provider.id) return null
    const factory = adapterRegistry.getFactory(provider.id)
    if (factory) return factory
    // 泛化兜底：仅 llm 类别且配置了 base_url（OpenAI 兼容端点）
    const isLlm = provider.category === CATEGORIES.LLM
    const hasBaseUrl = typeof provider.base_url === 'string' && provider.base_url.trim() !== ''
    if (isLlm && hasBaseUrl) {
      const { OpenAICompatibleAdapter } = require('./adapters/_base/openai-compatible')
      return (creds) => new OpenAICompatibleAdapter(creds)
    }
    return null
  }

  /**
   * P3.2: 获取或创建 Adapter 实例（带缓存）
   */
  _getOrCreateAdapter (providerId, provider) {
    // 检查缓存
    if (this._adapterCache.has(providerId)) {
      return this._adapterCache.get(providerId)
    }

    // 创建新实例
    const factory = this._resolveAdapterFactory(provider)
    if (!factory) {
      throw new Error('No adapter factory for ' + providerId)
    }
    const config = provider.config && typeof provider.config === 'object'
      ? { ...provider.config }
      : {}
    const credentials = {
      id: provider.id,
      apiKey: provider.api_key,
      baseUrl: provider.base_url,
      models: provider.models,
      config,
    }
    // 豆包语音接口把 App ID 与 Access Token 分开：Token 复用已加密的 api_key，
    // App ID 保存在非敏感 config 中，避免把 Token 泄露到可读配置列。
    if (providerId === 'doubao-tts' || providerId === 'doubao-stt') {
      const appId = typeof config.appId === 'string' && config.appId.trim()
        ? config.appId.trim()
        : (typeof config.app_id === 'string' ? config.app_id.trim() : '')
      credentials.appId = appId
      credentials.app_id = appId
      credentials.token = provider.api_key
      if (typeof config.cluster === 'string' && config.cluster.trim()) {
        credentials.cluster = config.cluster.trim()
      }
    }
    const adapter = factory(credentials)
    this._adapterCache.set(providerId, adapter)
    return adapter
  }

  /**
   * P3.2: 清除指定 provider 的 Adapter 缓存
   * 在 updateProvider/deleteProvider 后调用
   */
  _invalidateAdapterCache (providerId) {
    this._adapterCache.delete(providerId)
  }

  /**
   * 注册内置 Adapter 工厂
   * 在 init() 中调用，注册全部 52 个预设供应商对应的 Adapter
   * 工厂只是 (credentials) => Adapter 函数，不立即创建实例
   *
   * 覆盖 6 大类别：llm / tts / speech_recognition / image / video / audio
   */
  _registerBuiltinAdapters () {
    // 供应商 ID → Adapter 类的映射（共 54 个，与 PRESET_PROVIDERS 一一对应）
    const adapters = {
      // ─── LLM 推理模型 (12) ─────────────────────────
      openai: require('./adapters/openai').OpenAIAdapter,
      anthropic: require('./adapters/anthropic').AnthropicAdapter,
      gemini: require('./adapters/gemini').GeminiAdapter,
      openrouter: require('./adapters/openrouter').OpenRouterAdapter,
      ollama: require('./adapters/ollama').OllamaAdapter,
      'doubao-llm': require('./adapters/doubao-llm').DoubaoLlmAdapter,
      deepseek: require('./adapters/deepseek').DeepSeekAdapter,
      'mimo-llm': require('./adapters/mimo-llm').MimoLlmAdapter,
      'opencode-go': require('./adapters/opencode-go').OpenCodeGoAdapter,
      'agnes-llm': require('./adapters/agnes-llm').AgnesLlmAdapter,
      'sensenova-llm': require('./adapters/sensenova-llm').SenseNovaLlmAdapter,
      'tianyiyun-coding-plan': require('./adapters/tianyiyun-coding-plan').TianyiYunCodingPlanAdapter,
      'minimax-llm': require('./adapters/minimax-llm').MinimaxLlmAdapter,
      // ─── TTS 语音合成 (7) ──────────────────────────
      elevenlabs: require('./adapters/elevenlabs').ElevenLabsAdapter,
      'openai-tts': require('./adapters/openai-tts').OpenAITtsAdapter,
      'doubao-tts': require('./adapters/doubao-tts').DoubaoTtsAdapter,
      'google-tts': require('./adapters/google-tts').GoogleTtsAdapter,
      piper: require('./adapters/piper').PiperAdapter,
      'mimo-tts': require('./adapters/mimo-tts').MimoTtsAdapter,
      'minimax-tts': require('./adapters/minimax-tts').MinimaxTtsAdapter,
      // ─── 语音识别 STT (5) ──────────────────────────
      whisper: require('./adapters/openai-whisper').OpenAIWhisperAdapter,
      'google-stt': require('./adapters/google-stt').GoogleSttAdapter,
      'doubao-stt': require('./adapters/doubao-stt').DoubaoSttAdapter,
      'baidu-stt': require('./adapters/baidu-stt').BaiduSttAdapter,
      'local-whisper': require('./adapters/local-whisper').LocalWhisperAdapter,
      // ─── 图像生成 (11) ─────────────────────────────
      flux: require('./adapters/flux').FluxAdapter,
      'dall-e': require('./adapters/openai-image').OpenAIImageAdapter,
      recraft: require('./adapters/recraft').RecraftAdapter,
      imagen: require('./adapters/imagen').ImagenAdapter,
      'grok-image': require('./adapters/grok-image').GrokImageAdapter,
      pixabay: require('./adapters/pixabay').PixabayAdapter,
      pexels: require('./adapters/pexels').PexelsAdapter,
      'local-diffusion': require('./adapters/local-diffusion').LocalDiffusionAdapter,
      comfyui: require('./adapters/comfyui').ComfyUiAdapter,
      'minimax-image': require('./adapters/minimax-image').MinimaxImageAdapter,
      'agnes-image': require('./adapters/agnes-image').AgnesImageAdapter,
      // ─── 视频生成 (14) ─────────────────────────────
      hunyuan: require('./adapters/hunyuan').HunyuanAdapter,
      cogvideo: require('./adapters/cogvideo').CogVideoAdapter,
      'grok-video': require('./adapters/grok-video').GrokVideoAdapter,
      heygen: require('./adapters/heygen').HeyGenAdapter,
      kling: require('./adapters/kling').KlingAdapter,
      runway: require('./adapters/runway').RunwayAdapter,
      veo: require('./adapters/veo').VeoAdapter,
      wan: require('./adapters/wan').WanAdapter,
      minimax: require('./adapters/minimax').MiniMaxAdapter,
      'minimax-multimodal': require('./adapters/minimax-multimodal').MinimaxMultimodalAdapter,
      'agnes-multimodal': require('./adapters/agnes-multimodal').AgnesMultimodalAdapter,
      ltx: require('./adapters/ltx').LtxAdapter,
      seedance: require('./adapters/seedance').SeedanceAdapter,
      higgsfield: require('./adapters/higgsfield').HiggsfieldAdapter,
      'agnes-video': require('./adapters/agnes-video').AgnesVideoAdapter,
      // ─── 音频生成 (5) ──────────────────────────────
      suno: require('./adapters/suno').SunoAdapter,
      musicgen: require('./adapters/musicgen').MusicGenAdapter,
      'pixabay-music': require('./adapters/pixabay-music').PixabayMusicAdapter,
      freesound: require('./adapters/freesound').FreesoundAdapter,
      'music-library': require('./adapters/_base/music-library').MusicLibraryAdapter,
    }

    for (const [providerId, AdapterClass] of Object.entries(adapters)) {
      this.registerAdapter(providerId, (creds) => new AdapterClass(creds))
    }

    log.info('ModelProviderManager', `Registered ${Object.keys(adapters).length} builtin adapters`)
  }

  init () {
    if (this._ready) return
    if (!this._store || !this._store._ready) {
      log.warn('ModelProviderManager', 'Store not ready, deferring init')
      return
    }
    try {
      this._seedPresets()
      this._syncPresetCapabilities()
      this._syncPresetLimits()
      this._migrateApiKeyEncryption()
      this._collapseMiniMaxTtsModel()
      this._registerBuiltinAdapters()
      this._ready = true
      this._applyGovernorLimits()
      log.info('ModelProviderManager', 'Initialized with ' + PRESET_PROVIDERS.length + ' preset providers')
    } catch (e) {
      log.error('ModelProviderManager', 'Init failed: ' + e.message)
    }
  }

  _seedPresets () {
    const db = this._store.db
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO model_providers
        (id, name, category, base_url, api_key, api_key_enc, models, enabled, is_default, is_preset, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', NULL, ?, 0, 0, 1, ?, datetime('now'), datetime('now'))
    `)
    for (const p of PRESET_PROVIDERS) {
      const config = {}
      if (Array.isArray(p.capabilities)) config.capabilities = p.capabilities
      if (p.capability_models && typeof p.capability_models === 'object') config.capability_models = p.capability_models
      // 运营限流预算（每分钟连接次数 / 5小时限额次数）：与 ops-center 预设目录对齐
      if (p.rate_per_minute != null) config.rate_per_minute = this._normalizeConfigLimit(p.rate_per_minute)
      if (p.limit_per_5h != null) config.limit_per_5h = this._normalizeConfigLimit(p.limit_per_5h)
      stmt.run(p.id, p.name, p.category, p.base_url || '', JSON.stringify(p.models || []), JSON.stringify(config))
    }
    // 将历史内置种子从已废弃的 image-01-live 组合收敛为固定模型；
    // 用户自定义模型列表不匹配旧种子值，因此不会被覆盖。
    db.prepare(
      "UPDATE model_providers SET models = ?, updated_at = datetime('now') WHERE id = 'minimax-image' AND models = ?"
    ).run(JSON.stringify(['image-01']), JSON.stringify(['image-01', 'image-01-live']))
  }

  /**
   * 将预设声明的多模态能力（capabilities / capability_models）回填到存量预设行 config，
   * 使升级前的数据库也能拿到能力声明（INSERT OR IGNORE 不会更新已存在的行）。
   */
  _syncPresetCapabilities () {
    const db = this._store && this._store.db
    if (!db) return
    for (const p of PRESET_PROVIDERS) {
      const capabilities = Array.isArray(p.capabilities) ? p.capabilities : []
      const capabilityModels = p.capability_models && typeof p.capability_models === 'object' ? p.capability_models : null
      if (capabilities.length === 0 && !capabilityModels) continue
      try {
        const row = db.prepare('SELECT config FROM model_providers WHERE id = ?').get(p.id)
        if (!row) continue
        const config = safeJsonParse(row.config, {}) || {}
        const existingCaps = Array.isArray(config.capabilities) ? config.capabilities : []
        const existingModels = config.capability_models && typeof config.capability_models === 'object'
          ? config.capability_models
          : null
        // 合并升级：存量行只回填预设新增的能力（diff-merge），
        // 保留用户已有配置，避免覆盖历史能力/模型选择。
        let changed = false
        if (capabilities.length > 0) {
          const merged = Array.from(new Set([...existingCaps, ...capabilities]))
          if (merged.length !== existingCaps.length || merged.some((c, i) => c !== existingCaps[i])) {
            config.capabilities = merged
            changed = true
          }
        }
        if (capabilityModels) {
          const mergedModels = { ...(existingModels || {}) }
          for (const [cap, model] of Object.entries(capabilityModels)) {
            if (!mergedModels[cap]) {
              mergedModels[cap] = model
              changed = true
            }
          }
          if (Object.keys(mergedModels).length > 0) config.capability_models = mergedModels
        }
        if (changed) {
          db.prepare("UPDATE model_providers SET config = ?, updated_at = datetime('now') WHERE id = ?")
            .run(JSON.stringify(config), p.id)
          this._invalidateAdapterCache(p.id)
        }
        // 多模态预设 models 由系统管理（UI 仅填 API Key）：存量行缺失预设模型时只增不删回填，
        // 保持设置页展示与预设目录一致（如 MiniMax-M2.7）；其他类别 models 用户可编辑，不触碰。
        if (p.category === CATEGORIES.MULTIMODAL && Array.isArray(p.models) && p.models.length > 0) {
          const modelsRow = db.prepare('SELECT models FROM model_providers WHERE id = ?').get(p.id)
          if (modelsRow) {
            const parsedModels = safeJsonParse(modelsRow.models, [])
            const rawModels = Array.isArray(parsedModels) ? parsedModels : []
            // 清洗存量项：trim/去空串/去重；预设下架模型后存量残留（只增不删策略）需人工迁移清理。
            const existingModels = []
            const seenModels = new Set()
            for (const model of rawModels) {
              if (typeof model !== 'string') continue
              const clean = model.trim()
              if (!clean || seenModels.has(clean)) continue
              seenModels.add(clean)
              existingModels.push(clean)
            }
            // 清洗本身（去空格/空串/重复）也视为变更并持久化，即使无需回填预设模型。
            let modelsChanged = existingModels.length !== rawModels.length
            if (!modelsChanged) {
              for (let i = 0; i < rawModels.length; i++) {
                if (rawModels[i] !== existingModels[i]) { modelsChanged = true; break }
              }
            }
            const mergedModels = [...existingModels]
            for (const model of p.models) {
              if (typeof model === 'string' && model.trim() && !mergedModels.includes(model.trim())) {
                mergedModels.push(model.trim())
                modelsChanged = true
              }
            }
            if (modelsChanged) {
              db.prepare("UPDATE model_providers SET models = ?, updated_at = datetime('now') WHERE id = ?")
                .run(JSON.stringify(mergedModels), p.id)
              this._invalidateAdapterCache(p.id)
            }
          }
        }
      } catch (e) {
        log.warn('ModelProviderManager', 'sync preset capabilities failed for ' + p.id + ': ' + e.message)
      }
    }
  }

  /** 将 MiniMax TTS 模型列表收敛为 speech-2.8-turbo（需求：默认模型、去掉模型 ID 输入） */
  _collapseMiniMaxTtsModel () {
    if (!this._store || !this._store.db) return
    try {
      const result = this._store.db.prepare(
        "UPDATE model_providers SET models = ?, updated_at = datetime('now') WHERE id = 'minimax-tts' AND models != ?"
      ).run(JSON.stringify(['speech-2.8-turbo']), JSON.stringify(['speech-2.8-turbo']))
      if (result && result.changes > 0) {
        log.info('ModelProviderManager', 'Collapsed minimax-tts models to speech-2.8-turbo')
      }
    } catch (e) {
      log.warn('ModelProviderManager', 'collapse minimax-tts model failed: ' + e.message)
    }
  }

  _migrateApiKeyEncryption () {
    if (!crypto.isAvailable()) {
      log.warn('ModelProviderManager', 'safeStorage not available, skipping API key encryption migration')
      return
    }
    const db = this._store.db
    const rows = db.prepare("SELECT id, api_key FROM model_providers WHERE api_key != '' AND api_key_enc IS NULL").all()
    if (rows.length === 0) return
    for (const row of rows) {
      try {
        const encrypted = crypto.encrypt(row.api_key)
        db.prepare('UPDATE model_providers SET api_key_enc = ?, api_key = ? WHERE id = ?').run(encrypted, '', row.id)
      } catch (e) {
        log.error('ModelProviderManager', 'Migration failed for ' + row.id + ': ' + e.message)
      }
    }
    log.info('ModelProviderManager', 'Migrated ' + rows.length + ' API keys to encrypted storage')
  }

  listProviders (category) {
    if (!this._ready) return []
    const db = this._store.db
    let rows
    if (category) {
      rows = db.prepare('SELECT * FROM model_providers WHERE category = ? ORDER BY is_default DESC, is_preset DESC, name ASC').all(category)
      // 能力选择器（llm/tts/image/video 等）：并入已启用且声明支持该能力的多模态模型。
      // 多模态预设用一个 API Key 覆盖多个能力域，只保留一个多模态模型时，
      // 图片/TTS/视频/推理下拉仍能看到并选用它（getDefault 按能力路由同理）。
      if (category !== CATEGORIES.MULTIMODAL) {
        rows = rows.concat(
          db.prepare('SELECT * FROM model_providers WHERE category = ? AND enabled = 1 ORDER BY is_default DESC, is_preset DESC, name ASC').all(CATEGORIES.MULTIMODAL)
        )
      }
    } else {
      rows = db.prepare('SELECT * FROM model_providers ORDER BY category, is_default DESC, is_preset DESC, name ASC').all()
    }
    // 过滤用户已删除（软删隐藏）的预设服务商；
    // 能力过滤时，多模态行必须声明包含该能力，避免把 image 下拉混入不含 image 能力的多模态模型。
    return rows.map(r => this._safeRow(r)).filter(p => {
      if (p.hidden) return false
      if (!category || category === CATEGORIES.MULTIMODAL) return true
      if (p.category === CATEGORIES.MULTIMODAL) {
        if (!(Array.isArray(p.capabilities) && p.capabilities.includes(category))) return false
        // video 能力由「支持生成视频」开关控制（默认关闭）：能力选择器（视频生成器下拉）
        // 与默认路由一致，未开启时不并入/不展示，避免用户选中后仍被套餐限制拒绝。
        if (category === 'video') {
          const cfg = typeof p.config === 'object' && p.config ? p.config : safeJsonParse(p.config, {})
          if (!(cfg.capability_enabled?.video === true)) return false
        }
        return true
      }
      return true
    })
  }

  getProvider (id) {
    if (!this._ready) return null
    const row = this._store.db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id)
    return row ? this._safeRow(row) : null
  }

  getProviderWithKey (id) {
    if (!this._ready) return null
    const row = this._store.db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id)
    if (!row) return null
    return { ...this._safeRow(row), api_key: this._getApiKey(row) }
  }

  /**
   * 查询指定 provider 的 Adapter 是否实现某方法（能力协商，如 'deleteVoice'）。
   * 供「本地管理」类操作（如删除本地克隆音色）判断是否需要/可以调用远端 API。
   *
   * 返回三态：
   * - `true`  — adapter 明确实现该方法（应调用远端 API）；
   * - `false` — adapter 明确不支持（如 MiniMax 官方 clone API 无删除端点 → 纯本地管理）；
   * - `null`  — 无法判定（store 未就绪 / factory 缺失 / provider 缺失 / 构造异常 / adapter 无 supports），
   *             调用方应回退保守行为（尝试远端调用），不得把「探测失败」当作「明确不支持」。
   *
   * - 与 callAdapter 使用相同的 provider 数据（含解密 key）与 adapter 缓存，避免能力查询污染缓存；
   * - 不校验 API Key 有效性：能力是静态契约，与是否已配置凭据无关。
   *
   * @param {string} providerId
   * @param {string} method
   * @returns {Promise<boolean|null>}
   */
  async supportsAdapterMethod (providerId, method) {
    if (typeof providerId !== 'string' || !providerId || typeof method !== 'string' || !method) return false
    if (!this._ready) return null
    const provider = this.getProviderWithKey(providerId)
    if (!provider) return null
    if (!this._resolveAdapterFactory(provider)) return null
    try {
      const adapter = this._getOrCreateAdapter(providerId, provider)
      if (typeof adapter.supports !== 'function') return null
      return adapter.supports(method) === true
    } catch (_) {
      return null
    }
  }

  createProvider (data) {
    if (!this._ready) return { code: -1, errorCode: 'STORE_NOT_INITIALIZED', message: '本地数据服务尚未就绪，请稍后重试或重启应用。' }
    if (!data || !data.id || !data.name || !data.category) {
      return { code: -1, errorCode: 'VALIDATION_ERROR', message: '缺少必填字段（ID / 名称 / 分类），请补全后重试。' }
    }
    const validCategories = Object.values(CATEGORIES)
    if (!validCategories.includes(data.category)) {
      return { code: -1, errorCode: 'INVALID_CATEGORY', message: '服务商分类无效，请重新选择后重试。' }
    }
    const apiKey = typeof data.api_key === 'string' ? data.api_key.trim() : ''
    if (!hasUsableApiKey(apiKey) && !canUseWithoutApiKey(data)) {
      return { code: -1, errorCode: 'API_KEY_REQUIRED', message: '远程服务商必须配置 API Key，请在「模型设置」中填写后重试。' }
    }
    const existing = this._store.db.prepare('SELECT id FROM model_providers WHERE id = ?').get(data.id)
    if (existing) {
      return { code: -1, errorCode: 'PROVIDER_EXISTS', message: '服务商 ID「' + data.id + '」已存在，请更换 ID 或直接编辑已有服务商后重试。' }
    }
    let apiKeyEnc = null
    if (apiKey) {
      if (!crypto.isAvailable()) {
        return { code: -1, errorCode: 'CRYPTO_UNAVAILABLE', message: '系统安全存储不可用，无法保存 API Key。请重启应用或检查系统设置后重试。' }
      }
      try {
        apiKeyEnc = crypto.encrypt(apiKey)
      } catch (e) {
        return { code: -1, errorCode: 'ENCRYPT_FAILED', message: 'API Key 加密失败，请重启应用后重试。', messageParams: { detail: String(e && e.message || e) } }
      }
    }
    const db = this._store.db
    try {
      db.prepare(`
        INSERT INTO model_providers (id, name, category, base_url, api_key, api_key_enc, models, enabled, is_default, is_preset, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', ?, ?, ?, 0, 0, ?, datetime('now'), datetime('now'))
      `).run(
        data.id, data.name, data.category,
        data.base_url || '', apiKeyEnc,
        JSON.stringify(normalizeProviderModels(data.id, data.models)),
        (hasUsableApiKey(apiKey) || canUseWithoutApiKey(data)) ? 1 : 0,
        JSON.stringify(data.config || {})
      )
      log.info('ModelProviderManager', 'Provider created: ' + data.id)
      this._applyGovernorLimits()
      if (this._store && this._store.db && typeof this._store.db.persist === 'function') {
        this._store.db.persist()
      }
      return { code: 0, data: this.getProvider(data.id) }
    } catch (e) {
      log.error('ModelProviderManager', 'Create failed: ' + e.message)
      return { code: -1, errorCode: 'CREATE_FAILED', message: '创建服务商失败，请检查输入后重试。', messageParams: { detail: String(e && e.message || e) } }
    }
  }

  updateProvider (id, updates) {
    if (!this._ready) return { code: -1, errorCode: 'STORE_NOT_INITIALIZED', message: '本地数据服务尚未就绪，请稍后重试或重启应用。' }
    const existing = this.getProvider(id)
    if (!existing) {
      return { code: -1, message: 'Provider "' + id + '" not found' }
    }
    const allowedFields = ['name', 'base_url', 'api_key', 'clearApiKey', 'models', 'enabled', 'config']
    const sets = []
    const vals = []
    for (const [k, v] of Object.entries(updates)) {
      if (!allowedFields.includes(k)) continue
      if (k === 'models') {
        sets.push('models = ?')
        vals.push(JSON.stringify(normalizeProviderModels(id, v)))
      } else if (k === 'config') {
        sets.push('config = ?')
        vals.push(JSON.stringify(v))
      } else if (k === 'api_key') {
        if (v) {
          if (!crypto.isAvailable()) {
            return { code: -1, errorCode: 'CRYPTO_UNAVAILABLE', message: '系统安全存储不可用，无法保存 API Key。请重启应用或检查系统设置后重试。' }
          }
          try {
            sets.push('api_key_enc = ?')
            vals.push(crypto.encrypt(v))
            sets.push('api_key = ?')
            vals.push('')
          } catch (e) {
            return { code: -1, errorCode: 'ENCRYPT_FAILED', message: 'API Key 加密失败，请重启应用后重试。', messageParams: { detail: String(e && e.message || e) } }
          }
        } else if (updates.clearApiKey) {
          sets.push('api_key_enc = ?')
          vals.push(null)
          sets.push('api_key = ?')
          vals.push('')
        }
        // api_key 为空且未显式 clearApiKey 时保持原 Key 不变
      } else if (k === 'clearApiKey') {
        if (v) {
          sets.push('api_key_enc = ?')
          vals.push(null)
          sets.push('api_key = ?')
          vals.push('')
        }
      } else {
        sets.push(k + ' = ?')
        vals.push(v)
      }
    }
    if (sets.length === 0) {
      return { code: -1, errorCode: 'NO_UPDATABLE_FIELDS', message: '没有可更新的字段，请修改内容后再保存。' }
    }
    if (updates.clearApiKey) {
      sets.push('enabled = ?')
      vals.push(0)
    } else if ('api_key' in updates && updates.api_key) {
      sets.push('enabled = ?')
      vals.push(1)
    }
    sets.push("updated_at = datetime('now')")
    vals.push(id)
    try {
      this._store.db.prepare('UPDATE model_providers SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals)
      // P3.2: 配置变更后清除 Adapter 缓存
      this._invalidateAdapterCache(id)
      // 运营限流预算变更后同步 governor（rate_per_minute / limit_per_5h 可能被修改）
      this._applyGovernorLimits()
      log.info('ModelProviderManager', 'Provider updated: ' + id)
      // Key/配置变更后立即持久化到磁盘，防止非正常退出丢失更新
      if (this._store && this._store.db && typeof this._store.db.persist === 'function') {
        this._store.db.persist()
      }
      return { code: 0, data: this.getProvider(id) }
    } catch (e) {
      log.error('ModelProviderManager', 'Update failed: ' + e.message)
      return { code: -1, errorCode: 'UPDATE_FAILED', message: '更新服务商失败，请稍后重试。', messageParams: { detail: String(e && e.message || e) } }
    }
  }

  deleteProvider (id) {
    if (!this._ready) return { code: -1, errorCode: 'STORE_NOT_INITIALIZED', message: '本地数据服务尚未就绪，请稍后重试或重启应用。' }
    const provider = this.getProvider(id)
    if (!provider) {
      return { code: -1, message: 'Provider "' + id + '" not found' }
    }
    try {
      const db = this._store.db
      if (provider.is_preset) {
        // 预设服务商：软删除（隐藏 + 清除 Key + 禁用）。行保留以便从
        // 「添加服务商 → 预设目录」重新添加；listProviders 会过滤隐藏项。
        const row = db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id)
        const config = safeJsonParse(row ? row.config : '{}', {}) || {}
        config.preset_hidden = true
        db.prepare(
          'UPDATE model_providers SET enabled = ?, api_key = ?, api_key_enc = NULL, is_default = ?, config = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).run(0, '', 0, JSON.stringify(config), id)
        this._invalidateAdapterCache(id)
        log.info('ModelProviderManager', 'Provider (preset) soft-deleted: ' + id)
        return { code: 0, message: '已删除（预设服务商已隐藏，可在“添加服务商”中重新添加）' }
      }
      if (provider.is_default) {
        db.prepare('UPDATE model_providers SET is_default = 0 WHERE category = ?').run(provider.category)
      }
      db.prepare('DELETE FROM model_providers WHERE id = ?').run(id)
      // P3.2: 删除后清除 Adapter 缓存
      this._invalidateAdapterCache(id)
      // 清理 governor 中的 provider 级预算/窗口（防止残留）
      if (this._governor) {
        if (typeof this._governor.removeProviderLimits === 'function') this._governor.removeProviderLimits(id)
        if (typeof this._governor.setProviderTokenWindows === 'function') this._governor.setProviderTokenWindows(id, [])
      }
      log.info('ModelProviderManager', 'Provider deleted: ' + id)
      if (this._store && this._store.db && typeof this._store.db.persist === 'function') {
        this._store.db.persist()
      }
      return { code: 0, message: '已删除' }
    } catch (e) {
      log.error('ModelProviderManager', 'Delete failed: ' + e.message)
      return { code: -1, errorCode: 'DELETE_FAILED', message: '删除服务商失败，请稍后重试。', messageParams: { detail: String(e && e.message || e) } }
    }
  }

  /**
   * 应用运营后台目录（运行时同步）：覆盖限流/模型/能力配置，不覆盖 api_key/enabled/is_default/base_url。
   * 目录存在但本地缺失 → 插入预设行（is_preset=1，enabled=0）。目录缺失的本地行不清除。
   */
  applyCatalog (items) {
    if (!this._ready || !this._store || !this._store.db) return { code: -1, errorCode: 'STORE_NOT_INITIALIZED', message: '本地数据服务尚未就绪，请稍后重试或重启应用。' }
    if (!Array.isArray(items)) return { code: -1, message: '目录数据格式错误' }
    const db = this._store.db
    let updated = 0
    let inserted = 0
    let unchanged = 0
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) continue
      const id = item.id.trim()
      const config = {}
      if (Array.isArray(item.capabilities)) config.capabilities = item.capabilities
      if (item.capability_models && typeof item.capability_models === 'object') config.capability_models = item.capability_models
      const rpm = this._normalizeConfigLimit(item.rate_per_minute)
      const limit5h = this._normalizeConfigLimit(item.limit_per_5h)
      if (rpm !== null) config.rate_per_minute = rpm
      if (limit5h !== null) config.limit_per_5h = limit5h
      // 自定义排序（运营中心预设模型 sort_order）：非负整数有效，其余视为未排序
      const sortNum = Number.isInteger(item.sort_order) && item.sort_order >= 0 ? item.sort_order : null
      if (sortNum !== null) config.sort_order = sortNum
      // default_model 为目录契约信息字段：写入 config 保留运营配置（供展示/后续模型选择路由使用）；
      // 当前模型调用解析走 capability_models[type] 或 models[0]，provider 级默认走 is_default=1。
      if (item.default_model && typeof item.default_model === 'string') config.default_model = item.default_model.trim()
      // 模型列表仅当目录项为完整数组时视为权威；畸形/缺字段项不覆盖本地 models（fail-closed）
      const hasModels = Array.isArray(item.models)
      const models = hasModels ? item.models.filter(m => typeof m === 'string' && m.trim()) : []

      const row = db.prepare('SELECT * FROM model_providers WHERE id = ?').get(id)
      if (row) {
        const existing = safeJsonParse(row.config, {}) || {}
        const merged = { ...existing, ...config }
        // 目录是限流的权威来源：运营未配置/非法值（null/''/0/布尔）→ 清除本地值，
        // 由 _applyGovernorLimits 回退到静态默认或移除 provider 级预算，避免陈旧值残留。
        if (rpm === null) delete merged.rate_per_minute
        if (limit5h === null) delete merged.limit_per_5h
        if (sortNum === null) delete merged.sort_order
        // 内容比对：目录同步每轮全量重放，无实质变化的行跳过 UPDATE，
        // 避免 updated_at 被周期性同步 bump，打乱「已配置=按最新修改排序」语义
        // （PRD-MODEL-LIST-SORT-ORDER-2026-09-23 §5）。
        const modelsChanged = hasModels &&
          stableStringify(safeJsonParse(row.models, []) || []) !== stableStringify(models)
        const configChanged = stableStringify(existing) !== stableStringify(merged)
        if (!modelsChanged && !configChanged) { unchanged += 1; continue }
        if (hasModels) {
          db.prepare("UPDATE model_providers SET models = ?, config = ?, updated_at = datetime('now') WHERE id = ?")
            .run(JSON.stringify(models), JSON.stringify(merged), id)
        } else {
          // 畸形/缺 models 字段的目录项：只合并 config，不清空本地模型列表
          db.prepare("UPDATE model_providers SET config = ?, updated_at = datetime('now') WHERE id = ?")
            .run(JSON.stringify(merged), id)
        }
        this._invalidateAdapterCache(id)
        updated += 1
      } else {
        const category = typeof item.category === 'string' && Object.values(CATEGORIES).includes(item.category) ? item.category : 'llm'
        const baseUrl = typeof item.base_url === 'string' ? item.base_url : ''
        const name = typeof item.name === 'string' ? item.name : id
        db.prepare(`
          INSERT INTO model_providers (id, name, category, base_url, api_key, api_key_enc, models, enabled, is_default, is_preset, config, created_at, updated_at)
          VALUES (?, ?, ?, ?, '', NULL, ?, 0, 0, 1, ?, datetime('now'), datetime('now'))
        `).run(id, name, category, baseUrl, JSON.stringify(models), JSON.stringify(config))
        inserted += 1
      }
    }
    this._applyGovernorLimits()
    log.info('ModelProviderManager', 'applyCatalog: updated=' + updated + ' inserted=' + inserted + ' unchanged=' + unchanged)
    return { code: 0, updated, inserted, unchanged }
  }

  setDefault (category, providerId) {
    if (!this._ready) return { code: -1, errorCode: 'STORE_NOT_INITIALIZED', message: '本地数据服务尚未就绪，请稍后重试或重启应用。' }
    const provider = this.getProvider(providerId)
    if (!provider) {
      return { code: -1, message: 'Provider "' + providerId + '" not found' }
    }
    if (provider.category !== category) {
      return { code: -1, errorCode: 'INVALID_CATEGORY', message: '该服务商不属于所选分类，请重新选择后重试。' }
    }
    const providerWithKey = this.getProviderWithKey(providerId)
    if (!providerWithKey || (!hasUsableApiKey(providerWithKey.api_key) && !canUseWithoutApiKey(providerWithKey))) {
      return { code: -1, errorCode: 'API_KEY_NOT_CONFIGURED', message: '请先在「模型设置」中配置 API Key，再设为默认。' }
    }
    try {
      const db = this._store.db
      const isMultimodal = category === CATEGORIES.MULTIMODAL
      const config = (provider.config && typeof provider.config === 'object') ? provider.config : safeJsonParse(provider.config, {}) || {}
      const capabilities = isMultimodal ? (Array.isArray(config.capabilities) ? config.capabilities : []) : []
      const doSet = () => {
        if (isMultimodal) {
          db.prepare('UPDATE model_providers SET is_default = 0 WHERE category = ?').run(CATEGORIES.MULTIMODAL)
          db.prepare('UPDATE model_providers SET is_default = 1 WHERE id = ?').run(providerId)
          for (const cap of capabilities) {
            this._clearCapabilityDefaultForCapability(db, cap, providerId)
            db.prepare('UPDATE model_providers SET is_default = 0 WHERE category = ? AND is_default = 1').run(cap)
          }
          config.capability_defaults = [...capabilities]
          db.prepare('UPDATE model_providers SET config = ? WHERE id = ?').run(JSON.stringify(config), providerId)
        } else {
          db.prepare('UPDATE model_providers SET is_default = 0 WHERE category = ?').run(category)
          db.prepare('UPDATE model_providers SET is_default = 1 WHERE id = ?').run(providerId)
          this._clearCapabilityDefaultForCapability(db, category, providerId)
        }
      }
      if (db.transaction) { db.transaction(doSet)() } else { doSet() }
      log.info('ModelProviderManager', 'Default ' + category + ' set to: ' + providerId)
      if (this._store && this._store.db && typeof this._store.db.persist === 'function') {
        this._store.db.persist()
      }
      return { code: 0, message: 'Set as default' }
    } catch (e) {
      log.error('ModelProviderManager', 'SetDefault failed: ' + e.message)
      return { code: -1, errorCode: 'SET_DEFAULT_FAILED', message: '设置默认服务商失败，请稍后重试。', messageParams: { detail: String(e && e.message || e) } }
    }
  }

  getDefault (category) {
    if (!this._ready) return null
    if (category !== CATEGORIES.MULTIMODAL) {
      const multimodal = this._multimodalProviderFor(category)
      if (multimodal) return multimodal
    }
    const rows = this._store.db.prepare('SELECT * FROM model_providers WHERE category = ? AND enabled = 1 ORDER BY is_default DESC, name ASC').all(category)
    const provider = rows.find(row => hasUsableApiKey(this._getApiKey(row)) || canUseWithoutApiKey(row))
    return provider ? this._safeRow(provider) : null
  }

  setCapabilityDefault (providerId, capability, enabled) {
    if (!this._ready) return { code: -1, errorCode: 'STORE_NOT_INITIALIZED', message: '本地数据服务尚未就绪，请稍后重试或重启应用。' }
    if (!MULTIMODAL_CAPABILITY_IDS.includes(capability)) {
      return { code: -1, errorCode: 'INVALID_CAPABILITY', message: '不支持的能力类型：' + capability }
    }
    const provider = this.getProvider(providerId)
    if (!provider || provider.category !== CATEGORIES.MULTIMODAL) {
      return { code: -1, errorCode: 'NOT_MULTIMODAL', message: '该服务商不是多模态模型。' }
    }
    const providerWithKey = this.getProviderWithKey(providerId)
    if (!providerWithKey || (!hasUsableApiKey(providerWithKey.api_key) && !canUseWithoutApiKey(providerWithKey))) {
      return { code: -1, errorCode: 'API_KEY_NOT_CONFIGURED', message: '请先在「模型设置」中配置 API Key，再设为默认。' }
    }
    const config = (provider.config && typeof provider.config === 'object') ? provider.config : safeJsonParse(provider.config, {}) || {}
    const caps = Array.isArray(config.capabilities) ? config.capabilities : []
    if (!caps.includes(capability)) {
      return { code: -1, errorCode: 'CAPABILITY_NOT_SUPPORTED', message: '该多模态模型不支持能力：' + capability }
    }
    try {
      const db = this._store.db
      if (enabled) {
        this._clearCapabilityDefaultForCapability(db, capability, providerId)
        db.prepare('UPDATE model_providers SET is_default = 0 WHERE category = ? AND is_default = 1').run(capability)
        if (!Array.isArray(config.capability_defaults)) config.capability_defaults = []
        if (!config.capability_defaults.includes(capability)) config.capability_defaults.push(capability)
      } else {
        if (Array.isArray(config.capability_defaults)) {
          config.capability_defaults = config.capability_defaults.filter(c => c !== capability)
        }
        if (!Array.isArray(config.capability_defaults) || config.capability_defaults.length === 0) {
          db.prepare('UPDATE model_providers SET is_default = 0 WHERE id = ?').run(providerId)
        }
      }
      db.prepare('UPDATE model_providers SET config = ? WHERE id = ?').run(JSON.stringify(config), providerId)
      if (this._store && this._store.db && typeof this._store.db.persist === 'function') {
        this._store.db.persist()
      }
      return { code: 0, data: { capability, enabled, capabilityDefaults: config.capability_defaults || [] } }
    } catch (e) {
      log.error('ModelProviderManager', 'setCapabilityDefault failed: ' + e.message)
      return { code: -1, errorCode: 'SET_CAPABILITY_DEFAULT_FAILED', message: '设置能力默认失败，请稍后重试。', messageParams: { detail: String(e && e.message || e) } }
    }
  }

  _clearCapabilityDefaultForCapability (db, capability, excludeProviderId) {
    db.prepare('UPDATE model_providers SET is_default = 0 WHERE category = ? AND is_default = 1 AND id != ?').run(capability, excludeProviderId)
    const multimodalRows = db.prepare('SELECT id, is_default, config FROM model_providers WHERE category = ?').all(CATEGORIES.MULTIMODAL)
    for (const row of multimodalRows) {
      if (row.id === excludeProviderId) continue
      const cfg = safeJsonParse(row.config, {}) || {}
      const explicitDefaults = Array.isArray(cfg.capability_defaults) ? cfg.capability_defaults : []
      const hasGlobalDefault = !!row.is_default
      const declaredCapabilities = Array.isArray(cfg.capabilities) ? cfg.capabilities : []
      if (!hasGlobalDefault && !explicitDefaults.includes(capability)) continue

      // 旧版“多模态整体默认”相当于其所有已声明能力均为默认。普通 provider
      // 覆盖其中一个能力时，必须先把其余能力显式保留，再清除整体标记；否则
      // _multimodalProviderFor 会继续将整体标记视为当前能力默认，导致成功提示与实际路由不一致。
      const defaultsToKeep = hasGlobalDefault
        ? Array.from(new Set([...declaredCapabilities, ...explicitDefaults]))
        : explicitDefaults
      cfg.capability_defaults = defaultsToKeep.filter(c => c !== capability)

      if (hasGlobalDefault) {
        db.prepare('UPDATE model_providers SET is_default = 0, config = ? WHERE id = ?').run(JSON.stringify(cfg), row.id)
      } else {
        db.prepare('UPDATE model_providers SET config = ? WHERE id = ?').run(JSON.stringify(cfg), row.id)
      }
    }
  }

  /**
   * 返回声明支持指定能力的已配置多模态模型（category=multimodal、enabled=1、有可用 Key）。
   * @param {string} category - 能力/类别（llm/tts/speech_recognition/image/video）
   * @returns {object|null}
   */
  _multimodalProviderFor (category) {
    if (!this._ready || !MULTIMODAL_CAPABILITY_IDS.includes(category)) return null
    const rows = this._store.db
      .prepare('SELECT * FROM model_providers WHERE category = ? AND enabled = 1 ORDER BY is_default DESC, name ASC')
      .all(CATEGORIES.MULTIMODAL)
    for (const row of rows) {
      if (!(hasUsableApiKey(this._getApiKey(row)) || canUseWithoutApiKey(row))) continue
      const config = safeJsonParse(row.config, {}) || {}
      if (!Array.isArray(config.capabilities) || !config.capabilities.includes(category)) continue
      if (category === 'video' && config.capability_enabled?.video !== true) continue
      const isDefault = (Array.isArray(config.capability_defaults) && config.capability_defaults.includes(category)) || !!row.is_default
      if (!isDefault) continue
      return this._safeRow(row)
    }
    return null
  }

  async testConnection (id) {
    if (!this._ready) return { code: -1, errorCode: 'STORE_NOT_INITIALIZED', message: '模型服务尚未初始化，请稍后重试或重启应用。' }
    const provider = this.getProviderWithKey(id)
    if (!provider) {
      return { code: -1, errorCode: 'PROVIDER_NOT_FOUND', message: `未找到服务商「${id}」，可能已被删除。请刷新列表后重试。` }
    }
    if (!hasUsableApiKey(provider.api_key) && !canUseWithoutApiKey(provider)) {
      return { code: -1, errorCode: 'API_KEY_NOT_CONFIGURED', message: `尚未配置 API Key，请先在「模型设置」中填写 ${provider.name || id} 的 API Key 后重试。` }
    }
    // P3.2: 若已解析到 Adapter 工厂（专用或泛化 LLM 兜底），通过 Adapter 实际调用 testConnection
    if (this._resolveAdapterFactory(provider)) {
      const result = await this.callAdapter(id, 'testConnection', {})
      return result
    }
    // Fallback: 仅配置校验（无可解析工厂时）
    return { code: 0, message: provider.name + ' 配置有效（config valid: ' + (provider.base_url || '默认地址') + '）' }
  }

  getAvailablePresets (category) {
    if (!this._ready) return []
    // Seed rows describe the built-in catalog, not completed user configuration.
    // Keep every preset selectable; saving an existing preset updates its seeded row.
    return PRESET_PROVIDERS.filter(p => p.category === category).map(p => ({
      id: p.id, name: p.name, category: p.category, base_url: p.base_url, models: normalizeProviderModels(p.id, p.models),
      capabilities: Array.isArray(p.capabilities) ? [...p.capabilities] : [],
      capability_models: p.capability_models && typeof p.capability_models === 'object' ? { ...p.capability_models } : null,
    }))
  }

  isConfigured (category) {
    if (!this._ready) return false
    const rows = this._store.db.prepare('SELECT * FROM model_providers WHERE category = ? AND enabled = 1').all(category)
    return rows.some(row => hasUsableApiKey(this._getApiKey(row)) || canUseWithoutApiKey(row))
  }

  _safeRow (row) {
    if (!row) return null
    const apiKey = this._getApiKey(row)
    const apiKeyMasked = hasUsableApiKey(apiKey) ? crypto.mask(apiKey) : ''
    const config = safeJsonParse(row.config, {}) || {}
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      base_url: row.base_url || '',
      models: normalizeProviderModels(row.id, safeJsonParse(row.models, [])),
      enabled: !!row.enabled,
      is_default: !!row.is_default,
      is_preset: !!row.is_preset,
      config,
      capabilities: Array.isArray(config.capabilities) ? [...config.capabilities] : [],
      capability_models: config.capability_models && typeof config.capability_models === 'object' ? { ...config.capability_models } : null,
      hidden: config.preset_hidden === true,
      is_configured: !!row.enabled && (hasUsableApiKey(apiKey) || canUseWithoutApiKey(row)),
      api_key_masked: apiKeyMasked,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  _getApiKey (row) {
    if (!row) return ''
    if (row.api_key_enc) {
      try {
        const decrypted = crypto.decrypt(row.api_key_enc)
        return typeof decrypted === 'string' ? decrypted : ''
      } catch (e) {
        log.error('ModelProviderManager', 'Decrypt failed for ' + (row.id || 'unknown') + ': ' + e.message)
        return ''
      }
    }
    return typeof row.api_key === 'string' ? row.api_key : ''
  }
}

/** 键序稳定的 JSON 序列化：applyCatalog 内容比对用（无实质变化不 bump updated_at） */
function stableStringify (value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
  }
  return JSON.stringify(value === undefined ? null : value)
}

function safeJsonParse (str, fallback) {
  if (!str || typeof str !== 'string') return fallback
  try { return JSON.parse(str) } catch { return fallback }
}

module.exports = { ModelProviderManager, canUseWithoutApiKey, hasUsableApiKey, isLoopbackBaseUrl, normalizeProviderModels, resolveProviderDefaultModel }

