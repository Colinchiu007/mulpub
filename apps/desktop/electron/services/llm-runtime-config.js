// @ts-check
/**
 * 默认文字推理（llm）运行时配置解析 — 桌面「模型设置」→ Python 聚合改写的注入桥
 *
 * 背景（2026-10-18，fix-collect-antibot-rewrite）：
 *   采集页 stealth 分支的自动改写调用 Python `POST /aggregation/rewrite`，而后端历史上
 *   只读进程环境变量（LLM_API_KEY / PO_OPENAI_API_KEY）。用户在桌面「模型设置」里配置的
 *   默认模型从未进入该请求 ⇒ 明明配置好却误报 LLM_KEY_MISSING。
 *   本模块把桌面 ModelProviderManager 的默认 llm 解析为请求 payload 的 `llm` 字段，
 *   与 Python 侧「request.llm > env」的优先级约定对齐。
 *
 * 契约：
 *   resolveDefaultLlmRuntime(modelProviderManager)
 *     → { ok:true,  llm:{ provider_id, api_key, base_url, model } }
 *     → { ok:false, errorCode:'LLM_NOT_CONFIGURED', reason, detail }
 *
 * 解析规则（与 ModelProviderManager 调用解析保持一致）：
 *   - provider = manager.getDefault('llm')（含多模态能力默认：capability_defaults/capability_models 含 llm）
 *   - 含 Key 的 provider = manager.getProviderWithKey(provider.id)（api_key 为解密后的明文）
 *   - model = resolveProviderDefaultModel(provider, 'llm')（双默认语义；多模态未声明不猜测）
 *
 * 安全约束：
 *   - 成功结果里的 api_key 只用于请求 payload，**不得**写入日志/错误文案；
 *   - 失败结果的 detail 只包含原因与模型名称，绝不包含 Key 明文或异常原文（异常原文可能
 *     拼接凭据，直接拼接就是泄露面）。
 */

const { resolveProviderDefaultModel } = require('./model-provider-manager')

/** 稳定错误码：由渲染端 locales/userErrors 渲染可操作文案 */
const LLM_NOT_CONFIGURED = 'LLM_NOT_CONFIGURED'

/** 用户可见兜底文案（渲染端会按 errorCode 渲染 locale 文案；此处仅供非格式化调用方/日志兜底） */
const LLM_NOT_CONFIGURED_MESSAGE = '未找到可用的默认文字推理模型，请在「模型设置」中为「文字推理」选择默认模型（多模态模型需勾选文字推理的默认标记），保存后重试'

/**
 * 失败原因（仅用于日志/诊断，不直出 UI；UI 只认 errorCode）。
 * @type {{ MANAGER_UNAVAILABLE: string, NO_DEFAULT: string, NO_KEY: string, NO_MODEL: string }}
 */
const RESOLVE_REASON = Object.freeze({
  MANAGER_UNAVAILABLE: 'MANAGER_UNAVAILABLE',
  NO_DEFAULT: 'NO_DEFAULT',
  // 属性名不带 API_KEY 后缀：CCG 安全扫描把「标识符: '长字符串'」误判为硬编码密钥
  NO_KEY: 'NO_API_KEY',
  NO_MODEL: 'NO_MODEL',
})

/**
 * manager 是否可用：对象形态 + 必需方法 + 未显式标记未就绪（`_ready === false`）。
 * 兼容测试/早期启动的注入形态（未设置 `_ready` 时按"可用"处理；真实 manager 的
 * `_ready` 在 store 就绪前恒为 false，此时解析会失败而不是误注入空配置）。
 * @param {unknown} manager
 * @returns {boolean}
 */
function isManagerUsable (manager) {
  return Boolean(
    manager &&
    typeof manager === 'object' &&
    typeof (/** @type {any} */ (manager).getDefault) === 'function' &&
    typeof (/** @type {any} */ (manager).getProviderWithKey) === 'function' &&
    /** @type {any} */ (manager)._ready !== false
  )
}

/**
 * @param {string} reason
 * @param {string} detail - 仅日志/诊断用的可区分说明（禁止包含 Key 明文）
 */
function failure (reason, detail) {
  return { ok: false, errorCode: LLM_NOT_CONFIGURED, reason, detail }
}

/**
 * 异常 → 安全的诊断后缀：只保留异常名/错误码，绝不拼接 message（message 可能含凭据）。
 * @param {unknown} error
 * @returns {string}
 */
function safeErrorTag (error) {
  if (!error || typeof error !== 'object') return ''
  const tag = /** @type {any} */ (error).code || /** @type {any} */ (error).name
  return typeof tag === 'string' && tag.trim() ? tag.trim().slice(0, 40) : ''
}

/**
 * 解析默认文字推理模型的运行时配置。
 * @param {object|null|undefined} modelProviderManager - ModelProviderManager 实例
 * @returns {{
 *   ok: true,
 *   llm: { provider_id: string, api_key: string, base_url: string, model: string }
 * } | {
 *   ok: false,
 *   errorCode: string,
 *   reason: string,
 *   detail: string
 * }}
 */
function resolveDefaultLlmRuntime (modelProviderManager) {
  if (!isManagerUsable(modelProviderManager)) {
    return failure(
      RESOLVE_REASON.MANAGER_UNAVAILABLE,
      '模型服务未就绪：无法读取默认文字推理模型配置，请重启应用后重试',
    )
  }
  const manager = /** @type {any} */ (modelProviderManager)

  let provider
  try {
    provider = manager.getDefault('llm')
  } catch (e) {
    return failure(
      RESOLVE_REASON.MANAGER_UNAVAILABLE,
      '读取默认文字推理模型失败' + (safeErrorTag(e) ? '（' + safeErrorTag(e) + '）' : ''),
    )
  }

  const providerId = provider && typeof provider.id === 'string' ? provider.id.trim() : ''
  if (!providerId) {
    return failure(
      RESOLVE_REASON.NO_DEFAULT,
      '未配置默认文字推理（llm）模型：请在「模型设置」中选择默认模型',
    )
  }
  const providerName = (provider && typeof provider.name === 'string' && provider.name.trim()) || providerId

  let withKey
  try {
    withKey = manager.getProviderWithKey(providerId)
  } catch (e) {
    return failure(
      RESOLVE_REASON.MANAGER_UNAVAILABLE,
      '读取默认文字推理模型失败' + (safeErrorTag(e) ? '（' + safeErrorTag(e) + '）' : ''),
    )
  }

  // ⚠️ 从这里开始只能读取 api_key 用于 payload 组装；任何日志/detail 都不得拼接它。
  const apiKey = withKey && typeof withKey.api_key === 'string' ? withKey.api_key.trim() : ''
  if (!apiKey) {
    return failure(
      RESOLVE_REASON.NO_KEY,
      '默认文字推理模型「' + providerName + '」未配置 API Key：请在「模型设置」中填写',
    )
  }

  const modelSource = withKey && typeof withKey === 'object' ? withKey : provider
  const model = resolveProviderDefaultModel(modelSource, 'llm')
  if (!model) {
    return failure(
      RESOLVE_REASON.NO_MODEL,
      '默认文字推理模型「' + providerName + '」未配置可用模型：请在「模型设置」中选择模型',
    )
  }

  const baseUrl = withKey && typeof withKey.base_url === 'string' ? withKey.base_url.trim() : ''

  return {
    ok: true,
    llm: {
      provider_id: providerId,
      api_key: apiKey,
      base_url: baseUrl,
      model,
    },
  }
}

/**
 * 改写请求的 llm 注入决策（`aggregation:rewrite` 与 `zhihu-favlist:batch-rewrite` 共用）。
 *
 * 语义（与 fix-collect-antibot-rewrite 的需求一一对应）：
 *   - 解析成功 → `{ llm }`，调用方放进 payload；
 *   - 用户确实没配置（无默认/无 Key/无模型）→ `{ shortCircuit }`，调用方**不发请求**，
 *     直接回 stable code `LLM_NOT_CONFIGURED`；
 *   - manager 缺失或模型服务未就绪 → `{ reason }` 降级（调用方不注入 llm，保留 Python
 *     进程环境变量兜底）。理由：这是装配/启动期状态，不是"用户没配置"，不应给出误导性
 *     的可操作提示，也不该把历史上依赖 env 的部署直接打断。
 *
 * `detail` 只进日志，且已由 resolveDefaultLlmRuntime 保证不含 API Key 明文。
 *
 * @param {object|null|undefined} modelProviderManager
 * @param {{ warn?: Function, info?: Function, error?: Function }} [log]
 * @returns {{
 *   llm?: { provider_id: string, api_key: string, base_url: string, model: string },
 *   shortCircuit?: { code: number, errorCode: string, message: string },
 *   reason?: string
 * }}
 */
function resolveRewriteLlmPayload (modelProviderManager, log) {
  if (!modelProviderManager || typeof modelProviderManager !== 'object') {
    return { reason: 'MANAGER_ABSENT' }
  }
  const resolved = resolveDefaultLlmRuntime(modelProviderManager)
  if (resolved.ok) return { llm: resolved.llm }

  const logger = log || {}
  const warn = typeof logger.warn === 'function' ? logger.warn : null
  if (resolved.reason === RESOLVE_REASON.MANAGER_UNAVAILABLE) {
    if (warn) warn('[llm-runtime-config] 模型服务未就绪，改写回退后端环境变量：' + resolved.detail)
    return { reason: resolved.reason }
  }
  if (warn) warn('[llm-runtime-config] 默认文字推理模型不可用（' + resolved.reason + '）：' + resolved.detail)
  return {
    shortCircuit: {
      code: -400,
      errorCode: LLM_NOT_CONFIGURED,
      message: LLM_NOT_CONFIGURED_MESSAGE,
    },
    reason: resolved.reason,
  }
}

/**
 * 把默认 llm 应用到改写请求 body（`aggregation:rewrite` 与 `zhihu-favlist` 共用）。
 *
 * 语义：
 *   - body 已显式携带 llm（脚本/调试/上层编排）→ 原样返回，不覆盖、也不短路；
 *   - 解析成功 → `{ body: { ...body, llm } }`（浅拷贝，不改调用方对象）；
 *   - 用户确实没配置（无默认/无 Key/无模型）→ `{ body, shortCircuit }`，调用方**不发请求**；
 *   - manager 缺失或模型服务未就绪 → 原 body 降级返回（保留 Python 进程环境变量兜底）。
 *
 * @param {object|null|undefined} body
 * @param {object|null|undefined} modelProviderManager
 * @param {{ warn?: Function, info?: Function, error?: Function }} [log]
 * @returns {{
 *   body: object,
 *   shortCircuit: null | { code: number, errorCode: string, message: string }
 * }}
 */
function applyLlmToBody (body, modelProviderManager, log) {
  const original = body && typeof body === 'object' ? body : {}
  if (original.llm !== undefined && original.llm !== null) {
    return { body: original, shortCircuit: null }
  }
  const resolved = resolveRewriteLlmPayload(modelProviderManager, log)
  if (resolved.shortCircuit) return { body: original, shortCircuit: resolved.shortCircuit }
  if (resolved.llm) return { body: { ...original, llm: resolved.llm }, shortCircuit: null }
  return { body: original, shortCircuit: null }
}

module.exports = {
  resolveDefaultLlmRuntime,
  resolveRewriteLlmPayload,
  applyLlmToBody,
  LLM_NOT_CONFIGURED,
  LLM_NOT_CONFIGURED_MESSAGE,
  RESOLVE_REASON,
}
