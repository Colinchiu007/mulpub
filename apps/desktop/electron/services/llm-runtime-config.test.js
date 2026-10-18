// @ts-check
/**
 * llm-runtime-config — 桌面「模型设置」默认文字推理模型 → Python 聚合改写运行时配置解析
 *
 * 背景（2026-10-18，fix-collect-antibot-rewrite）：
 *   用户已在「模型设置」配置好默认 LLM（含多模态能力默认），但采集页自动改写调用
 *   Python `/aggregation/rewrite`，后端只读进程 env LLM_API_KEY/PO_OPENAI_API_KEY，
 *   桌面配置从未注入 → 误报 LLM_KEY_MISSING。本 helper 负责把桌面配置解析为请求 payload。
 *
 * 契约：
 *   resolveDefaultLlmRuntime(modelProviderManager)
 *     → { ok:true, llm:{ provider_id, api_key, base_url, model } }
 *     → { ok:false, errorCode:'LLM_NOT_CONFIGURED', reason, detail }
 *
 * 安全：失败结果/日志一律不得包含 API Key 明文（测试只断言"不含"，不打印值）。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'

const { resolveDefaultLlmRuntime, applyLlmToBody } = require('./llm-runtime-config')

/** 多模态 provider：能力声明 llm，默认模型走 capability_models.llm（用户实际配置形态） */
const MULTIMODAL_PROVIDER = {
  id: 'agnes-multimodal',
  name: 'Agnes 多模态',
  category: 'multimodal',
  base_url: 'https://agnes.example.com/v1',
  models: ['agnes-vision-1'],
  capability_models: { llm: 'agnes-3.0-flash' },
  config: { capabilities: ['llm', 'image'], capability_defaults: ['llm'] },
}

/**
 * @param {{ def?: object|null, withKey?: object|null, ready?: boolean }} [opts]
 */
function makeManager ({ def = null, withKey = null, ready } = {}) {
  /** @type {any} */
  const manager = {
    getDefault: vi.fn((category) => {
      expect(category).toBe('llm')
      return def
    }),
    getProviderWithKey: vi.fn((id) => {
      expect(id).toBe(def && def.id)
      return withKey
    }),
  }
  if (ready !== undefined) manager._ready = ready
  return manager
}

describe('resolveDefaultLlmRuntime — 成功解析', () => {
  it('多模态默认 provider（capability_defaults/capability_models 含 llm）解析出完整 llm 运行时配置', () => {
    const apiKey = 'sk-unit-test-secret-0001'
    const manager = makeManager({
      def: MULTIMODAL_PROVIDER,
      withKey: { ...MULTIMODAL_PROVIDER, api_key: apiKey },
      ready: true,
    })

    const result = resolveDefaultLlmRuntime(manager)

    expect(result.ok).toBe(true)
    expect(result.llm).toEqual({
      provider_id: 'agnes-multimodal',
      api_key: apiKey,
      base_url: 'https://agnes.example.com/v1',
      model: 'agnes-3.0-flash',
    })
    expect(manager.getDefault).toHaveBeenCalledTimes(1)
    expect(manager.getProviderWithKey).toHaveBeenCalledWith('agnes-multimodal')
  })

  it('单能力 llm provider 回退 models[0]；缺 base_url 时归一为空串', () => {
    const provider = { id: 'deepseek', name: 'DeepSeek', category: 'llm', models: ['deepseek-chat'] }
    const manager = makeManager({
      def: provider,
      withKey: { ...provider, api_key: 'sk-unit-test-secret-0002' },
      ready: true,
    })

    const result = resolveDefaultLlmRuntime(manager)

    expect(result.ok).toBe(true)
    expect(result.llm.model).toBe('deepseek-chat')
    expect(result.llm.base_url).toBe('')
  })
})

describe('resolveDefaultLlmRuntime — 失败原因可区分（reason 仅用于日志，不直出 UI）', () => {
  it('manager 未就绪（缺失 / 方法不全 / _ready=false）→ MANAGER_UNAVAILABLE', () => {
    const notReady = makeManager({ ready: false })
    const cases = [
      null,
      undefined,
      {},
      notReady,
      { getDefault: vi.fn() }, // 缺 getProviderWithKey
    ]
    for (const manager of cases) {
      const result = resolveDefaultLlmRuntime(manager)
      expect(result.ok, String(manager)).toBe(false)
      expect(result.errorCode).toBe('LLM_NOT_CONFIGURED')
      expect(result.reason).toBe('MANAGER_UNAVAILABLE')
      expect(result.detail).toBeTruthy()
    }
  })

  it('没有默认 llm provider → NO_DEFAULT', () => {
    const result = resolveDefaultLlmRuntime(makeManager({ def: null, withKey: null, ready: true }))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('LLM_NOT_CONFIGURED')
    expect(result.reason).toBe('NO_DEFAULT')
    expect(result.detail).toContain('默认')
  })

  it('默认 provider 无 API Key → NO_API_KEY', () => {
    const result = resolveDefaultLlmRuntime(makeManager({
      def: MULTIMODAL_PROVIDER,
      withKey: { ...MULTIMODAL_PROVIDER, api_key: '' },
      ready: true,
    }))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('LLM_NOT_CONFIGURED')
    expect(result.reason).toBe('NO_API_KEY')
    expect(result.detail).toContain('API Key')
  })

  it('默认 provider 无可用模型（多模态未声明 capability_models.llm）→ NO_MODEL', () => {
    const provider = {
      id: 'agnes-multimodal',
      name: 'Agnes 多模态',
      category: 'multimodal',
      models: ['agnes-vision-1'],
      config: { capabilities: ['llm'], capability_defaults: ['llm'] },
    }
    const result = resolveDefaultLlmRuntime(makeManager({
      def: provider,
      withKey: { ...provider, api_key: 'sk-unit-test-secret-0003' },
      ready: true,
    }))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('LLM_NOT_CONFIGURED')
    expect(result.reason).toBe('NO_MODEL')
    expect(result.detail).toContain('模型')
  })
})

describe('resolveDefaultLlmRuntime — 不泄露 API Key', () => {
  it('失败结果里不含 Key 明文（无模型但 Key 存在）', () => {
    const apiKey = 'sk-unit-test-must-not-leak-0042'
    const provider = {
      id: 'agnes-multimodal',
      name: 'Agnes 多模态',
      category: 'multimodal',
      models: [],
    }
    const result = resolveDefaultLlmRuntime(makeManager({
      def: provider,
      withKey: { ...provider, api_key: apiKey },
      ready: true,
    }))

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(apiKey)
    expect(result).not.toHaveProperty('llm')
    expect(result).not.toHaveProperty('api_key')
  })

  it('manager 抛异常时降级为 MANAGER_UNAVAILABLE 且不携带异常里的 Key', () => {
    const apiKey = 'sk-unit-test-must-not-leak-0043'
    const manager = {
      getDefault: vi.fn(() => { throw new Error('boom ' + apiKey) }),
      getProviderWithKey: vi.fn(),
      _ready: true,
    }
    const result = resolveDefaultLlmRuntime(manager)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('LLM_NOT_CONFIGURED')
    expect(JSON.stringify(result)).not.toContain(apiKey)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// applyLlmToBody — IPC handler 共用的「注入 / 短路 / 显式 llm 不覆盖」决策
// （两个 handler 都改用它，避免重复 5-8 行；行为由这里直接主测）
// ═══════════════════════════════════════════════════════════════════════
describe('applyLlmToBody', () => {
  const OK_MANAGER = () => makeManager({
    def: MULTIMODAL_PROVIDER,
    withKey: { ...MULTIMODAL_PROVIDER, api_key: 'sk-apply-test-secret-01' },
    ready: true,
  })

  it('解析成功 → 返回带 llm 的新 body，且不改调用方对象', () => {
    const original = { content: '原文', style: '轻松易懂' }
    const result = applyLlmToBody(original, OK_MANAGER())

    expect(result.shortCircuit).toBeNull()
    expect(result.body).toEqual({
      content: '原文',
      style: '轻松易懂',
      llm: {
        provider_id: 'agnes-multimodal',
        api_key: 'sk-apply-test-secret-01',
        base_url: 'https://agnes.example.com/v1',
        model: 'agnes-3.0-flash',
      },
    })
    expect(original).not.toHaveProperty('llm')
    expect(result.body).not.toBe(original)
  })

  it('用户未配置 → shortCircuit 与 body 原样返回（调用方据此不发请求）', () => {
    const original = { content: '原文' }
    const result = applyLlmToBody(original, makeManager({ ready: true }))

    expect(result.shortCircuit).toEqual(expect.objectContaining({
      code: -400,
      errorCode: 'LLM_NOT_CONFIGURED',
      message: expect.any(String),
    }))
    expect(result.body).toBe(original)
  })

  it('显式 llm 不覆盖：即使 manager 不可解析也原样返回且不短路', () => {
    const explicit = { api_key: 'caller-key', base_url: 'https://caller.example.com/v1', model: 'caller-model' }
    const original = { content: '原文', llm: explicit }
    const result = applyLlmToBody(original, makeManager({ ready: true }))

    expect(result.shortCircuit).toBeNull()
    expect(result.body).toBe(original)
    expect(result.body.llm).toBe(explicit)
  })

  it('无 manager（依赖缺失）→ 降级返回原 body、不短路（保留 Python env 兜底）', () => {
    const original = { content: '原文' }
    const result = applyLlmToBody(original, undefined)

    expect(result.shortCircuit).toBeNull()
    expect(result.body).toBe(original)
  })
})
