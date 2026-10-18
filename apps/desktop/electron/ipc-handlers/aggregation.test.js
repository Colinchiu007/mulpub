// @ts-check
/**
 * Aggregation IPC handlers 合同测试
 *
 * 验证 aggregation 相关 IPC 通道：
 * - aggregation:collect — 调用 pythonBridge.requestBackend POST /aggregation/collect
 * - aggregation:sources — 调用 pythonBridge.requestBackend GET /aggregation/sources
 * - aggregation:rewrite — 调用 pythonBridge.requestBackend POST /aggregation/rewrite
 * - aggregation:task-status — 调用 pythonBridge.requestBackend GET /aggregation/tasks/{id}
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../services/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

__enableElectronMock()

let registerHandlers
let originalNodeEnv
let originalIsPackaged

beforeEach(async () => {
  vi.resetModules()
  originalNodeEnv = process.env.NODE_ENV
  originalIsPackaged = __electronMock.app.isPackaged
  delete process.env.NODE_ENV
  __electronMock.app.isPackaged = false
  const mod = await import('./aggregation')
  registerHandlers = mod.default || mod
})

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  __electronMock.app.isPackaged = originalIsPackaged
})

function createMockIpcMain () {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    on: vi.fn(),
    _get: (channel) => handlers[channel],
  }
}

function createMockDeps (overrides = {}) {
  return {
    pythonBridge: { requestBackend: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    ...overrides,
  }
}

describe('aggregation IPC handlers', () => {
  it('registers aggregation:collect channel', () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    expect(ipcMain.handle).toHaveBeenCalledWith('aggregation:collect', expect.any(Function))
  })

  it('registers aggregation:sources channel', () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    expect(ipcMain.handle).toHaveBeenCalledWith('aggregation:sources', expect.any(Function))
  })

  it('registers aggregation:rewrite channel', () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    expect(ipcMain.handle).toHaveBeenCalledWith('aggregation:rewrite', expect.any(Function))
  })

  it('registers aggregation:task-status channel', () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    expect(ipcMain.handle).toHaveBeenCalledWith('aggregation:task-status', expect.any(Function))
  })

  it('aggregation:collect calls pythonBridge.requestBackend with POST /aggregation/collect', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({ title: '测试', content: '正文' }) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:collect')
    const result = await handler({}, { url: 'https://example.com', source_type: 'url' })

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith(
      'POST', '/aggregation/collect',
      { url: 'https://example.com', source_type: 'url' }
    )
    expect(result.title).toBe('测试')
  })

  it('aggregation:sources calls pythonBridge.requestBackend with GET /aggregation/sources', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue([{ type: 'rss', name: 'RSS' }]) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:sources')
    const result = await handler({})

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith('GET', '/aggregation/sources', null)
    expect(result).toHaveLength(1)
  })

  it('aggregation:rewrite calls pythonBridge.requestBackend with POST /aggregation/rewrite', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({ result_content: '改写后', word_count: 3 }) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:rewrite')
    const result = await handler({}, { content: '原文', style: '轻松易懂' })

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith(
      'POST', '/aggregation/rewrite',
      { content: '原文', style: '轻松易懂' }
    )
    expect(result.result_content).toBe('改写后')
  })

  it('aggregation:task-status calls pythonBridge.requestBackend with GET /aggregation/tasks/{id}', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({ task_id: 'abc', status: 'completed' }) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:task-status')
    const result = await handler({}, 'abc')

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith('GET', '/aggregation/tasks/abc', null)
    expect(result.status).toBe('completed')
  })

  it('aggregation:collect propagates backend errors', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({ code: 400, message: '采集失败' }) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:collect')
    const result = await handler({}, { url: 'https://example.com', source_type: 'url' })

    expect(result.code).toBe(400)
    expect(result.message).toBe('采集失败')
  })

  it('registers aggregation:collect-video channel', () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    expect(ipcMain.handle).toHaveBeenCalledWith('aggregation:collect-video', expect.any(Function))
  })

  it('aggregation:collect-video calls pythonBridge with POST /aggregation/collect-video and 600s timeout', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({ media_type: 'video', transcript: '文案' }) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:collect-video')
    const result = await handler({}, { url: 'https://v.douyin.com/abc/' })

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith(
      'POST', '/aggregation/collect-video',
      { url: 'https://v.douyin.com/abc/' }, 600000
    )
    expect(result.media_type).toBe('video')
  })

  it('aggregation:collect-video classifies ASR engine unavailable as -6', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockRejectedValue(new Error('ASR_ENGINE_UNAVAILABLE: 语音转写引擎不可用，请安装 faster-whisper')) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:collect-video')
    const result = await handler({}, { url: 'https://v.douyin.com/abc/' })

    expect(result.code).toBe(-6)
    expect(result.message).toContain('faster-whisper')
  })

  it('aggregation:collect-video classifies transcribe timeout as -7', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockRejectedValue(new Error('TRANSCRIBE_TIMEOUT: 转写超时')) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:collect-video')
    const result = await handler({}, { url: 'https://v.douyin.com/abc/' })

    expect(result.code).toBe(-7)
    expect(result.message).toContain('超时')
  })

  it('aggregation:collect-video classifies no audio track as -8', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockRejectedValue(new Error('NO_AUDIO_TRACK: 该视频无音轨')) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:collect-video')
    const result = await handler({}, { url: 'https://v.douyin.com/abc/' })

    expect(result.code).toBe(-8)
    expect(result.message).toContain('无音轨')
  })

  // ── 视频采集错误：python-bridge 对 HTTP 422 不抛异常而是 resolve {code:-422, message:"CODE: 中文提示"} ──
  // 回归：>10 分钟拒绝等具体提示曾被 -422/通用文案吞掉（QM-5 修复）

  it('collect-video resolve 路径：>10 分钟拒绝 → 透传 -422 与「视频过长（含实际时长）」提示', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({
      code: -422, status: 422,
      message: 'VIDEOCLONE_FILE_TOO_LARGE: 视频过长（15:32），采集仅支持 10 分钟内的短视频',
    }) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:collect-video')
    const result = await handler({}, { url: 'https://v.douyin.com/too-long/' })

    expect(result.message).toContain('视频过长')
    expect(result.message).toContain('15:32')
    expect(result.message).toContain('10 分钟')
  })

  it('collect-video resolve 路径：引擎缺失 → 透传安装指引而非「无法提取内容」', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({
      code: -422, status: 422,
      message: '-6: 语音转写引擎不可用，请安装 faster-whisper：pip install faster-whisper',
    }) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:collect-video')
    const result = await handler({}, { url: 'https://v.douyin.com/abc/' })

    expect(result.message).toContain('pip install faster-whisper')
    expect(result.message).not.toContain('无法提取内容')
  })

  it('collect-video resolve 路径：无音轨 → 透传「无音轨」提示', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({
      code: -422, status: 422,
      message: '-8: 该视频无音轨，无法进行语音转写',
    }) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:collect-video')
    const result = await handler({}, { url: 'https://v.douyin.com/abc/' })

    expect(result.message).toContain('无音轨')
  })

  it('collect-video resolve 路径：转写超时 → 透传「转写超时」提示', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({
      code: -422, status: 422,
      message: '-7: 转写超时（300 秒），请尝试较短的短视频',
    }) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:collect-video')
    const result = await handler({}, { url: 'https://v.douyin.com/abc/' })

    expect(result.message).toContain('转写超时')
    expect(result.message).toContain('较短的短视频')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 桌面「模型设置」默认 LLM → aggregation:rewrite 注入（fix-collect-antibot-rewrite）
//
// 根因：Python /aggregation/rewrite 只读进程 env（LLM_API_KEY/PO_OPENAI_API_KEY），
// 桌面模型设置从未注入 ⇒ 已配置默认模型仍误报 LLM_KEY_MISSING。
// 契约：调用后端前解析默认 llm 并放进 payload；解析失败短路 -400/LLM_NOT_CONFIGURED
// 且不发请求；renderer 自带 llm 时绝不覆盖；无 manager 时降级为不注入（保留 env 兜底）。
// ═══════════════════════════════════════════════════════════════════════

/** 用户实际配置形态：多模态 provider，能力默认 llm + capability_models.llm */
const LLM_PROVIDER = {
  id: 'agnes-multimodal',
  name: 'Agnes 多模态',
  category: 'multimodal',
  base_url: 'https://agnes.example.com/v1',
  models: ['agnes-vision-1'],
  capability_models: { llm: 'agnes-3.0-flash' },
  config: { capabilities: ['llm', 'image'], capability_defaults: ['llm'] },
}

/**
 * @param {{ provider?: object|null, apiKey?: string }} [opts]
 */
function createLlmManager ({ provider = LLM_PROVIDER, apiKey = 'sk-agg-test-secret-01' } = {}) {
  return {
    _ready: true,
    getDefault: vi.fn(() => provider),
    getProviderWithKey: vi.fn((id) => (provider ? { ...provider, api_key: apiKey } : null)),
  }
}

describe('aggregation:rewrite — 注入桌面「模型设置」默认 LLM', () => {
  it('解析成功 → payload 携带 llm（provider_id/api_key/base_url/model），且 Key 不落日志', async () => {
    const ipcMain = createMockIpcMain()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({ result_content: '改写后' }) }
    const modelProviderManager = createLlmManager()
    registerHandlers(ipcMain, createMockDeps({ pythonBridge, modelProviderManager, log }))

    const handler = ipcMain._get('aggregation:rewrite')
    const result = await handler({}, { content: '原文', style: '轻松易懂', length: 'keep' })

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith(
      'POST', '/aggregation/rewrite',
      {
        content: '原文', style: '轻松易懂', length: 'keep',
        llm: {
          provider_id: 'agnes-multimodal',
          api_key: 'sk-agg-test-secret-01',
          base_url: 'https://agnes.example.com/v1',
          model: 'agnes-3.0-flash',
        },
      },
    )
    expect(result.result_content).toBe('改写后')
    // Key 不得出现在任何日志调用里（测试只断言"不含"，不打印值）
    const logged = [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].flat().join(' ')
    expect(logged).not.toContain('sk-agg-test-secret-01')
  })

  it('无可用默认 llm → 短路 -400/LLM_NOT_CONFIGURED，一次请求都不发', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn() }
    const modelProviderManager = { _ready: true, getDefault: vi.fn(() => null), getProviderWithKey: vi.fn() }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge, modelProviderManager }))

    const handler = ipcMain._get('aggregation:rewrite')
    const result = await handler({}, { content: '原文' })

    expect(result.code).toBe(-400)
    expect(result.errorCode).toBe('LLM_NOT_CONFIGURED')
    expect(typeof result.message).toBe('string')
    expect(result.message.length).toBeGreaterThan(0)
    expect(pythonBridge.requestBackend).not.toHaveBeenCalled()
  })

  it('manager 有 provider 但无 Key → 同样短路 -400/LLM_NOT_CONFIGURED', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn() }
    const modelProviderManager = createLlmManager({ apiKey: '' })
    registerHandlers(ipcMain, createMockDeps({ pythonBridge, modelProviderManager }))

    const handler = ipcMain._get('aggregation:rewrite')
    const result = await handler({}, { content: '原文' })

    expect(result.errorCode).toBe('LLM_NOT_CONFIGURED')
    expect(pythonBridge.requestBackend).not.toHaveBeenCalled()
  })

  it('renderer 已带 llm → 原样透传，不覆盖、也不因未配置而短路', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({ result_content: '改写后' }) }
    // manager 不可用：若实现错误地去解析，就会短路
    const modelProviderManager = { _ready: true, getDefault: vi.fn(() => null), getProviderWithKey: vi.fn() }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge, modelProviderManager }))
    const callerLlm = { api_key: 'caller-provided-key', base_url: 'https://caller.example.com/v1', model: 'caller-model' }

    const handler = ipcMain._get('aggregation:rewrite')
    const result = await handler({}, { content: '原文', llm: callerLlm })

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith(
      'POST', '/aggregation/rewrite',
      { content: '原文', llm: callerLlm },
    )
    expect(result.result_content).toBe('改写后')
  })

  it('无 manager（依赖缺失）→ 降级为不注入 llm，请求照常发送（保留 Python env 兜底）', async () => {
    const ipcMain = createMockIpcMain()
    const pythonBridge = { requestBackend: vi.fn().mockResolvedValue({ result_content: '改写后' }) }
    registerHandlers(ipcMain, createMockDeps({ pythonBridge }))

    const handler = ipcMain._get('aggregation:rewrite')
    const result = await handler({}, { content: '原文' })

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith(
      'POST', '/aggregation/rewrite',
      { content: '原文' },
    )
    expect(result.result_content).toBe('改写后')
  })
})
