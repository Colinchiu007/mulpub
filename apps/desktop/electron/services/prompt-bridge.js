// @ts-check
/**
 * PromptBridge — prompt-engine Python 子进程管理
 * 端口 8013，提供提示词优化服务
 *
 * P2-6: 继承 BasePythonBridge，仅保留业务方法 optimize/optimizeBatch
 * 公共逻辑（start/stop/attach/healthCheck/watchdog/restart）由基类提供
 */
const http = require('http')
const { execFile } = require('child_process')
const { BasePythonBridge } = require('./base-python-bridge')
const { config } = require('../config/app-config')
const {
  normalizePromptEngineStyle,
  normalizePromptEnginePlatform,
  assertNoSensitiveContext,
} = require('./prompt-engine-contract')
const { resolveOptimizationStrategy } = require('./prompt-engine-kernel')
const { resolveProviderDefaultModel } = require('./model-provider-manager')
const {
  buildVideoOptimizeRequest,
  buildStandaloneVideoOptimizeRequest,
  isStandaloneVideoEngineEnabled,
  getStandaloneVideoEngineTarget,
} = require('./video-prompt-engine-contract')

const PROMPT_PORT = config.promptBridge.port
const PROMPT_HOST = config.promptBridge.host
// LLM 只返回空/纯推理内容时（如 DeepSeek 只输出思考块），prompt-engine 会以 502/错误返回。
// 命中该错误时不要重复调用 CLI 兜底（同样会再烧一次 LLM 且可能再次拿到空内容），
// 直接透传 error 结果，由 story2video optimize 阶段回退原文继续。见 isPromptEngineEmptyReasoningError。
const EMPTY_REASONING_ERROR_PATTERN = /空内容|仅包含推理内容|未生成有效优化词|empty\s+content|only\s+(reasoning|thinking|thought)/i
// BYOK：提示词引擎的 LLM 一律由调用方（桌面版「模型设置」）注入，引擎不再使用服务端 key 兜底
const CALLER_ID = 'multi-publish-desktop'
// P1-A: 移除硬编码开发者路径，必须通过环境变量配置
// PROMPT_DIR 必须指向包含 prompt_engine 包的 Python 项目根目录
const _defaultPromptDir = (() => {
  const knownPaths = [
    'D:\\Data\\projects\\prompt-engine',
    'D:\\Projects\\prompt-engine',
  ]
  const fs = require('fs')
  for (const p of knownPaths) {
    try { if (fs.existsSync(p + '/prompt_engine')) return p } catch (_) { /* ignore */ }
  }
  return process.cwd()
})()
const PROMPT_DIR = process.env.PROMPT_DIR || _defaultPromptDir

function normalizeOptimizeRequest (request) {
  const normalized = request !== null && typeof request === 'object' && !Array.isArray(request)
    ? { ...request }
    : { prompt: String(request) }

  if (normalized.max_length === null || normalized.max_length === undefined || normalized.max_length === '') {
    delete normalized.max_length
  }
  if (normalized.context === null || normalized.context === undefined || normalized.context === '') {
    delete normalized.context
  } else if (typeof normalized.context === 'string') {
    normalized.context = { synopsis: normalized.context }
  } else if (normalized.context !== null && typeof normalized.context === 'object') {
    // 纵深防御：context 会发给外部服务，敏感凭据键在此处再拦一道（契约层已拦）
    assertNoSensitiveContext(normalized.context, 'optimize.context')
  }
  // 图片提示词统一契约：发送前归一平台/风格，避免历史别名（cinematic/dall-e/stable-diffusion 等）触发 422
  if (normalized.platform !== undefined && normalized.platform !== null && normalized.platform !== '') {
    normalized.platform = normalizePromptEnginePlatform(normalized.platform)
  }
  if (normalized.style !== undefined && normalized.style !== null && normalized.style !== '') {
    normalized.style = normalizePromptEngineStyle(normalized.style)
  } else if (normalized.style === '') {
    delete normalized.style
  }
  // optimization_strategy 归一化：缺省 llm；template/llm 由调用方显式选择
  normalized.optimization_strategy = resolveOptimizationStrategy(normalized)
  // bypass_cache 布尔归一化：Boolean('false') === true 是 JS 陷阱，需显式处理
  const _bv = normalized.bypass_cache !== undefined ? normalized.bypass_cache : normalized.bypassCache
  if (_bv !== undefined) {
    normalized.bypass_cache = _bv === true || _bv === 'true' || _bv === 1
  }
  // 清理驼峰字段，避免透传到引擎
  delete normalized.optimizationStrategy
  delete normalized.bypassCache
  // 剥离桌面端内部字段：index 仅用于流水线分段追踪，不应透传到引擎（additionalProperties: false 会 422）
  delete normalized.index
  return normalized
}

/**
 * 该请求是否需要调用 LLM（与引擎端 requires_llm 语义一致：video 域或图片 creative_level>3）。
 * @param {object} request - 归一后的优化请求
 * @returns {boolean}
 */
function requiresLlm (request) {
  // creative_level 只控制创意强度，不参与策略路由；由 optimization_strategy 决定
  return resolveOptimizationStrategy(request) === 'llm'
}

/**
 * 桌面 provider id → 引擎 provider 注册名映射。
 * sensenova（商汤，OpenAI 兼容）与 deepseek 直接映射；其余 OpenAI 兼容供应商一律走 openai_compat。
 * @param {string} providerId
 * @returns {string}
 */
function engineProviderFor (providerId) {
  if (providerId === 'sensenova-llm') return 'sensenova'
  if (providerId === 'deepseek') return 'deepseek'
  return 'openai_compat'
}

/**
 * 解析默认 LLM 的实际模型：多模态 provider 按能力路由（capability_models.llm 优先），
 * 与 ModelProviderManager 调用解析（capability_models[type] 或 models[0]）保持一致；
 * 否则回退 models 首个有效项。多模态 provider 的 models[0] 可能是 TTS/图片模型
 * （如 minimax-multimodal 的 speech-2.8-turbo），不能当 LLM 注入引擎。
 * @param {{ models?: unknown, capability_models?: object|null }} provider
 * @returns {string}
 */
function llmModelFor (provider) {
  const model = resolveProviderDefaultModel(provider, 'llm')
  if (model) return model
  // 多模态 provider 必须显式声明 capability_models.llm（或用户/运营默认模型），不猜测
  if (provider && provider.category === 'multimodal') {
    throw new Error('未配置可用模型：多模态 provider 必须在 capability_models.llm 中声明 LLM 模型')
  }
  return ''
}

/**
 * 独立视频引擎（video_prompt_engine，8020）目标（每次调用读取环境变量，便于测试/运行期切换）。
 * @returns {{ host: string, port: number } | null}
 */
function _standaloneTarget () {
  if (!isStandaloneVideoEngineEnabled()) return null
  const { host, port } = getStandaloneVideoEngineTarget()
  const n = Number(port)
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return null
  return { host, port: n }
}

/**
 * 在优化结果外层附加后端来源元数据（浅拷贝，绝不改写引擎返回的原始对象/数组）。
 * 元数据仅供内部链路（story2video-stages 组装 continuity）消费，不进入发送给引擎的 payload。
 * @param {unknown} result
 * @param {{ backend: 'standalone-8020' | 'legacy-8013', fallback?: boolean }} meta
 * @returns {unknown}
 */
function tagVideoEngineResult (result, meta) {
  const tagObject = (value) => Object.assign({}, value, {
    _prompt_engine_backend: meta.backend,
    ...(meta.fallback ? { _prompt_engine_fallback: true } : {}),
  })

  const tagBatchItems = (value) => {
    if (!Array.isArray(value)) return value
    return value.map(item => (
      item !== null && typeof item === 'object' && !Array.isArray(item)
        ? tagObject(item)
        : item
    ))
  }

  if (Array.isArray(result)) return tagBatchItems(result)
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    const tagged = tagObject(result)
    for (const key of ['results', 'optimized_prompts']) {
      if (Array.isArray(tagged[key])) tagged[key] = tagBatchItems(tagged[key])
    }
    if (tagged.data !== null && typeof tagged.data === 'object' && !Array.isArray(tagged.data)) {
      tagged.data = { ...tagged.data }
      for (const key of ['results', 'optimized_prompts']) {
        if (Array.isArray(tagged.data[key])) tagged.data[key] = tagBatchItems(tagged.data[key])
      }
    }
    return tagged
  }
  return result
}

class PromptBridge extends BasePythonBridge {
  /**
   * @param {{ log?: any }} opts
   */
  constructor ({ log } = {}) {
    super({
      name: 'PromptBridge',
      pythonModule: 'prompt_engine.api',
      port: PROMPT_PORT,
      host: PROMPT_HOST,
      workDir: PROMPT_DIR,
      log,
      requestTimeout: 120000,
    })
  }

  /**
   * 由桌面「模型设置」的默认 LLM 构造引擎 BYOK llm 绑定（provider/model/base_url/api_key）。
   * 无可用默认 LLM 时 fail-closed 抛错——引擎不再使用服务端 config.yaml / OpsCenter key 兜底。
   * @returns {{ provider: string, model: string, base_url?: string, api_key: string }}
   */
  resolveLlmBind () {
    const manager = this.modelProviderManager
    if (!manager || typeof manager.getDefault !== 'function' || typeof manager.getProviderWithKey !== 'function') {
      throw new Error('模型服务未就绪：无法解析默认 LLM（提示词引擎需要调用方自己的模型绑定）')
    }
    const def = manager.getDefault('llm')
    const id = def && typeof def.id === 'string' ? def.id.trim() : ''
    if (!id) {
      throw new Error('未配置默认文字推理模型：请在「模型设置」中选择并配置 LLM 后重试')
    }
    if (typeof manager.getProviderWithKey !== 'function') {
      throw new Error('模型服务未就绪：无法读取默认 LLM 的 API Key')
    }
    const withKey = manager.getProviderWithKey(id)
    if (!withKey || typeof withKey.api_key !== 'string' || !withKey.api_key.trim()) {
      throw new Error(`默认 LLM「${(def && def.name) || id}」未配置 API Key：请在「模型设置」中填写后重试`)
    }
    const model = llmModelFor(withKey)
    if (!model) {
      throw new Error(`默认 LLM「${(def && def.name) || id}」未配置可用模型：请在「模型设置」中选择模型后重试`)
    }
    const bind = { provider: engineProviderFor(id), model, api_key: withKey.api_key, caller: CALLER_ID }
    if (typeof withKey.base_url === 'string' && withKey.base_url.trim()) {
      bind.base_url = withKey.base_url.trim()
    }
    this.log.info(this.name, 'resolveLlmBind: provider=' + bind.provider + ', model=' + bind.model + ', caller=' + bind.caller + (bind.base_url ? ', base_url=' + bind.base_url : ''))

    return bind
  }

  /**
   * 优化提示词 — POST /v1/optimize
   * @param {object} request - { prompt, ...options }
   * @returns {Promise<object>}
   */
  /**
   * CLI fallback -- spawn CLI subprocess when HTTP is unavailable.
   * @param {object} request - normalized optimize request
   * @param {string} [traceId]
   * @returns {Promise<object>}
   * @private
   */
  _cliFallbackSingle (request, traceId) {
    return new Promise((resolve, reject) => {
      const { args: pyArgs, apiKey } = buildCliFallbackCommand(request)
      this.log.info(this.name, `CLI fallback: python ${pyArgs.slice(0, 5).join(' ')}... traceId=${traceId || '-'}`)
      const childEnv = { ...process.env, PYTHONPATH: PROMPT_DIR }
      if (apiKey) childEnv.PROMPT_ENGINE_API_KEY = apiKey
      // 仅 MP_PYTHON 作为解释器覆盖；PYTHON_PATH 是 Python 模块搜索路径（目录），绝不可当作可执行文件。
      execFile(process.env.MP_PYTHON || 'python', pyArgs, { cwd: PROMPT_DIR, timeout: 120000, windowsHide: true, env: childEnv }, (err, stdout, stderr) => {
        if (err) {
          // logging-coverage-audit：stderr 参数此前被丢弃，CLI 真实报错不可见
          this.log.warn(this.name, `CLI fallback failed: ${err.message} stderr=${String(stderr || '').trim().slice(0, 500)}`)
          reject(new Error(`CLI fallback failed: ${err.message}`))
          return
        }
        try {
          const result = JSON.parse(stdout.trim())
          resolve(result)
        } catch (e) {
          this.log.warn(this.name, `CLI fallback returned invalid JSON: ${stdout.slice(0, 200)}`)
          reject(new Error('CLI fallback returned invalid JSON'))
        }
      })
    })
  }

  /**
   * optimize -- POST /v1/optimize with CLI fallback on HTTP failure.
   */
  _defaultLlmProviderId () {
    const manager = this.modelProviderManager
    const def = manager && typeof manager.getDefault === 'function' ? manager.getDefault('llm') : null
    return def && typeof def.id === 'string' ? def.id.trim() : ''
  }

  _assertLlmProviderAvailable (runtime) {
    const ctx = runtime && runtime.providerRunContext
    const providerId = this._defaultLlmProviderId()
    if (ctx && providerId && typeof ctx.assertAvailable === 'function') ctx.assertAvailable(providerId)
  }

  _openLlmProviderOnQuota (runtime, error) {
    const ctx = runtime && runtime.providerRunContext
    const providerId = this._defaultLlmProviderId()
    return Boolean(providerId && ctx && typeof ctx.openIfQuota === 'function' && ctx.openIfQuota(providerId, error))
  }

  _maybeOpenLlmProviderQuota (runtime, result) {
    if (!runtime || !runtime.providerRunContext) return
    if (result && typeof result === 'object' && (result.error || result.message)) runtime.providerRunContext.openIfQuota(this._defaultLlmProviderId(), result.error || result)
  }

  async optimize (request, traceId, runtime = {}) {
    await this.ensureRunning()
    const normalized = normalizeOptimizeRequest(request)
    if (requiresLlm(normalized)) {
      this._assertLlmProviderAvailable(runtime)
      normalized.llm = this.resolveLlmBind()
    }
    const strategy = normalized.optimization_strategy || 'unknown'
    const promptLen = typeof normalized.prompt === 'string' ? normalized.prompt.length : 0
    this.log.info(this.name, `optimize: strategy=${strategy}, prompt_len=${promptLen}, has_llm=${!!normalized.llm}, traceId=${traceId || '-'}`)
    if (normalized.llm) {
      this.log.info(this.name, `optimize: llm.provider=${normalized.llm.provider}, llm.model=${normalized.llm.model}, caller=${normalized.llm.caller || '-'}`)
    }
    try {
      const result = await this._post('/v1/optimize', JSON.stringify(normalized), undefined, traceId)
      this.log.info(this.name, `optimize: OK strategy_used=${result && result.strategy_used || '-'}, key_source=${result && result.key_source || '-'}, cache_hit=${result && result.cache_hit || '-'}, traceId=${traceId || '-'}`)
      this._maybeOpenLlmProviderQuota(runtime, result)
      return result
    } catch (httpErr) {
      this.log.warn(this.name, `optimize: FAILED ${httpErr instanceof Error ? httpErr.message : String(httpErr)}, traceId=${traceId || '-'}`)
      const httpMessage = httpErr instanceof Error ? httpErr.message : String(httpErr)
      if (EMPTY_REASONING_ERROR_PATTERN.test(httpMessage)) {
        this.log.warn(this.name, `optimize: empty-reasoning LLM 结果，跳过 CLI 兜底并回退原文, traceId=${traceId || '-'}`)
        return { error: httpMessage, optimized_prompt: '' }
      }
      if (this._openLlmProviderOnQuota(runtime, httpErr)) {
        this.log.warn(this.name, `optimize: quota/token-plan 错误，跳过 CLI 兜底, traceId=${traceId || '-'}`)
        return { error: httpMessage, optimized_prompt: '' }
      }
      return this._cliFallbackSingle(normalized, traceId)
    }
  }


  /**
   * 批量优化 — POST /v1/optimize/batch
   * @param {object[]} requests - 优化请求数组
   * @returns {Promise<object>}
   */
  async optimizeBatch (requests, traceId, runtime = {}) {
    await this.ensureRunning()
    const normalized = requests.map(normalizeOptimizeRequest)
    // 任一请求需要 LLM 即整体注入同一条默认 LLM 绑定（同一产品统一配置的模型）
    const bind = normalized.some(requiresLlm) ? this.resolveLlmBind() : null
    if (normalized.some(requiresLlm)) this._assertLlmProviderAvailable(runtime)
    if (bind) {
      for (const n of normalized) {
        if (requiresLlm(n)) n.llm = bind
      }
    }
    try {
      return await this._post('/v1/optimize/batch', JSON.stringify({ requests: normalized }), undefined, traceId)
    } catch (httpErr) {
      this.log.warn(this.name, `Batch HTTP failed (${httpErr instanceof Error ? httpErr.message : String(httpErr)}), trying CLI fallback for ${normalized.length} items`)
      if (this._openLlmProviderOnQuota(runtime, httpErr)) {
        this.log.warn(this.name, `Batch quota/token-plan 错误，跳过 CLI 兜底, traceId=${traceId || '-'}`)
        return normalized.map((n) => ({ error: httpErr instanceof Error ? httpErr.message : String(httpErr) }))
      }
      const results = []
      for (const n of normalized) {
        try {
          results.push(await this._cliFallbackSingle(n, traceId))
        } catch (cliErr) {
          results.push({ error: cliErr instanceof Error ? cliErr.message : String(cliErr) })
        }
      }
      return results
    }
  }

  /**
   * 独立视频引擎 POST — 不启动子进程（8020 由外部/脚本单独托管），失败抛错由调用方回退。
   * @param {string} path
   * @param {string} body
   * @param {number} [timeout]
   * @returns {Promise<object>}
   * @protected
   */
  _postStandalone (path, body, timeout, traceId) {
    const target = _standaloneTarget()
    if (!target) return Promise.reject(new Error('standalone video engine not configured (VIDEO_PROMPT_PORT)'))
    const reqTimeout = timeout || this.requestTimeout
    // 仅记录 path + traceId，绝不记录 body；traceId 非 header 安全 ASCII 时跳过头发送
    const safeTraceId = typeof traceId === 'string' && /^[A-Za-z0-9._:\-_]{1,64}$/.test(traceId) ? traceId : null
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    if (safeTraceId) {
      headers['X-Request-Id'] = safeTraceId
      this.log.info(this.name, `POST ${path} traceId=${safeTraceId}`)
    } else if (traceId) {
      this.log.warn(this.name, `POST ${path} 跳过非法 traceId（非 header 安全字符）`)
    }
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: target.host,
        port: target.port,
        path,
        method: 'POST',
        headers,
        timeout: reqTimeout,
      }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
        if (res.statusCode >= 400) {
          let detail = data
          try { const parsed = JSON.parse(data); detail = parsed.detail || parsed.message || data } catch (_) { /* ignore */ }
          reject(new Error('standalone video engine HTTP ' + res.statusCode + ': ' + detail))
          return
        }
        try { resolve(JSON.parse(data)) } catch { reject(new Error('standalone video engine 返回非法 JSON')) }
      })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('standalone video engine request timeout')) })
      req.write(body)
      req.end()
    })
  }

  /**
   * 视频提示词优化 — 独立引擎（8020 /v1/video/optimize）优先，失败回退 8013 /v1/optimize（domain=video）。
   * 独立引擎与图片引擎完全分离（video_prompt_engine 包），回退仅用于兼容未托管 8020 的环境。
   * @param {string|object} promptOrRequest - 提示词或 { prompt, ...options }
   * @param {object} [options] - 视频优化选项（platform/style/creativeLevel/maxLength/negativePrompt/context/outputLanguage 等）
   * @returns {Promise<object>}
   */
  async optimizeVideo (promptOrRequest, options) {
    const isObjectReq = promptOrRequest !== null && typeof promptOrRequest === 'object' && !Array.isArray(promptOrRequest)
    const prompt = isObjectReq ? promptOrRequest.prompt : String(promptOrRequest)
    const opts = isObjectReq ? { ...promptOrRequest } : options
    // traceId 是控制字段：提取后不进业务 payload，仅用于 X-Request-Id 头
    const { traceId, providerRunContext, ...rest } = opts || {}
    const runtime = { providerRunContext }
    if (_standaloneTarget()) {
      try {
        this._assertLlmProviderAvailable(runtime)
        const standaloneReq = buildStandaloneVideoOptimizeRequest(prompt, rest)
        standaloneReq.llm = this.resolveLlmBind()
        const result = await this._postStandalone('/v1/video/optimize', JSON.stringify(standaloneReq), undefined, traceId)
        return tagVideoEngineResult(result, { backend: 'standalone-8020' })
      } catch (e) {
        const isClientError = e.message && e.message.startsWith('standalone video engine HTTP 4')
        if (this._openLlmProviderOnQuota(runtime, e)) throw e
        if (isClientError) throw e
        const target = _standaloneTarget()
        this.log.warn('PromptBridge', `独立视频引擎(${target.host}:${target.port})不可用，回退 8013 domain=video：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    await this.ensureRunning()
    const legacyReq = buildVideoOptimizeRequest(prompt, rest)
    // 独立视频引擎失败回退 8013：video 域必须走 BYOK llm 绑定（调用方自己的 LLM）
    legacyReq.llm = this.resolveLlmBind()
    const result = await this._post('/v1/optimize', JSON.stringify(legacyReq), undefined, traceId)
    this._maybeOpenLlmProviderQuota(runtime, result)
    return tagVideoEngineResult(result, { backend: 'legacy-8013', fallback: Boolean(_standaloneTarget()) })
  }

  /**
   * 批量视频提示词优化 — 独立引擎（8020 /v1/video/optimize/batch）优先，失败回退 8013 /v1/optimize/batch。
   * @param {string[]|object[]} prompts - 提示词数组或 { prompt, ...options } 数组
   * @param {object} [options] - 对所有纯字符串项生效的公共选项
   * @returns {Promise<object>}
   */
  async optimizeVideosBatch (prompts, options) {
    // traceId 是控制字段：从顶层 options 提取，不进业务 payload
    const { traceId, providerRunContext, ...restOptions } = options || {}
    const runtime = { providerRunContext }
    const build = (item) => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        return { prompt: item.prompt, opts: { ...item } }
      }
      return { prompt: String(item), opts: restOptions }
    }
    if (_standaloneTarget()) {
      try {
        this._assertLlmProviderAvailable(runtime)
        const requests = (prompts || []).map(item => {
          const { prompt, opts } = build(item)
          return buildStandaloneVideoOptimizeRequest(prompt, opts)
        })
        const _bind = this.resolveLlmBind()
        for (const r of requests) { r.llm = _bind }
        const result = await this._postStandalone('/v1/video/optimize/batch', JSON.stringify({ requests }), undefined, traceId)
        return tagVideoEngineResult(result, { backend: 'standalone-8020' })
      } catch (e) {
        const isClientError = e.message && e.message.startsWith('standalone video engine HTTP 4')
        if (this._openLlmProviderOnQuota(runtime, e)) throw e
        if (isClientError) throw e
        const target = _standaloneTarget()
        this.log.warn('PromptBridge', `独立视频引擎(${target.host}:${target.port})不可用，回退 8013 domain=video 批量：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    await this.ensureRunning()
    const requests = (prompts || []).map(item => {
      const { prompt, opts } = build(item)
      return buildVideoOptimizeRequest(prompt, opts)
    })
    const bind = this.resolveLlmBind()
    for (const req of requests) {
      req.llm = bind
          }
    const result = await this._post('/v1/optimize/batch', JSON.stringify({ requests }), undefined, traceId)
    this._maybeOpenLlmProviderQuota(runtime, result)
    return tagVideoEngineResult(result, { backend: 'legacy-8013', fallback: Boolean(_standaloneTarget()) })
  }
}

// Stage -1.3: API Key 移出 argv，经 env 传递。纯函数便于测试命令行构造。
/**
 * 构建 prompt-engine CLI fallback 的 argv 与 API Key。
 * @param {object} request - 规范化 optimize 请求
 * @returns {{ args: string[], apiKey: string }} args 不含 Key；Key 单独返回供 env 注入
 */
function buildCliFallbackCommand (request) {
  const args = ['-m', 'prompt_engine.cli', 'optimize', request.prompt || '', '--json']
  args.push('--strategy', request.optimization_strategy || 'llm')
  args.push('--creative-level', String(request.creative_level || 5))
  let apiKey = ''
  if (request.platform) args.push('--platform', request.platform)
  if (request.llm) {
    const llm = request.llm
    if (llm.provider) args.push('--provider', llm.provider)
    if (llm.model) args.push('--model', llm.model)
    if (llm.api_key) apiKey = llm.api_key
    if (llm.base_url) args.push('--base-url', llm.base_url)
    if (llm.caller) args.push('--caller', llm.caller)
  }
  return { args, apiKey }
}

module.exports = PromptBridge
module.exports.buildCliFallbackCommand = buildCliFallbackCommand

