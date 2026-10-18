// @ts-check
/**
 * ai:generate-gen-video-title IPC handler 合同测试（fix-hot-topics-genvideo-title，2026-10-17）
 *
 * 契约（PRD §9.1）：
 *   - 有默认 LLM → { code:0, data:{ success:true, title } }
 *   - 无默认 LLM / 无可用模型 → { code:0, data:{ success:false, reason:'no-model' } }（**不是 error**）
 *   - LLM 抛错 / 空 content → { code:0, data:{ success:false, reason:'failed', message } }
 *   - 参数非法 → VALIDATION_ERROR
 *   - 写操作：withSenderCheck 拒绝外部网页
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
  const mod = await import('./gen-video-title')
  registerHandlers = mod.default || mod
  // 纯函数出口（prompt 构造 / 输出清洗）从主进程模块取，与 handler 用的是同一份实现
  pureFns = {
    buildGenVideoTitlePrompt: mod.buildGenVideoTitlePrompt,
    normalizeGeneratedTitle: mod.normalizeGeneratedTitle,
  }
})

let pureFns = null

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

/** 构造带默认 LLM 的 aiGenerator mock */
function makeAiGenerator (overrides = {}) {
  const manager = {
    getDefault: vi.fn(() => ({ id: 'sensenova-llm', name: 'SenseNova', enabled: true, is_configured: true, models: ['deepseek-v4-flash'] })),
    getProviderWithKey: vi.fn(() => ({ id: 'sensenova-llm', api_key: 'sk-test', models: ['deepseek-v4-flash'] })),
    _ready: true,
  }
  return {
    _modelProviderManager: manager,
    generateWithDefault: vi.fn().mockResolvedValue({ content: '打工人醒醒！AI又抢活了' }),
    ...overrides,
  }
}

function createMockDeps (overrides = {}) {
  return {
    aiGenerator: makeAiGenerator(),
    BrowserWindow: { fromWebContents: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    ...overrides,
  }
}

const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }
const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }

const VALID_PAYLOAD = { topicText: 'AI大模型最新突破进展', bodyText: '改写后的正文内容……' }

const THINK_OPEN = '<' + 'think' + '>'
const THINK_CLOSE = '</' + 'think' + '>'

describe('buildGenVideoTitlePrompt（主进程侧 prompt 构造）', () => {
  it('T25 含选题、摘要与「只输出标题本身」约束', () => {
    const { system, user } = pureFns.buildGenVideoTitlePrompt({ topicText: 'AI大模型最新突破进展', bodyText: '改写后的正文内容……' })
    expect(system).toContain('只输出标题本身')
    expect(system).toContain('14') // 2026-10-18：理想长度 30→14（硬上限降到 20 字）
    expect(system).toContain('20')
    expect(user).toContain('AI大模型最新突破进展')
    expect(user).toContain('改写后的正文内容……')
  })

  it('T26 system prompt 含 5 类爆款元素要求', () => {
    const { system } = pureFns.buildGenVideoTitlePrompt({ topicText: 'x', bodyText: 'y' })
    expect(system).toContain('悬念')
    expect(system).toContain('数字')
    expect(system).toContain('情绪')
    expect(system).toContain('身份')
    expect(system).toContain('反常识')
  })

  it('T27 正文摘要截断到 200 字', () => {
    const body = '正'.repeat(500)
    const { user } = pureFns.buildGenVideoTitlePrompt({ topicText: 'x', bodyText: body })
    expect(user).toContain('正'.repeat(200))
    expect(user).not.toContain('正'.repeat(201))
  })

  it('T28 非字符串 / 空正文不抛错', () => {
    for (const bad of [null, undefined, 42, {}]) {
      const { user } = pureFns.buildGenVideoTitlePrompt({ topicText: 'x', bodyText: bad })
      expect(user).toContain('选题：x')
    }
  })

  it('T29 无参调用不抛错', () => {
    const { system, user } = pureFns.buildGenVideoTitlePrompt()
    expect(typeof system).toBe('string')
    expect(typeof user).toBe('string')
  })
})

describe('normalizeGeneratedTitle（主进程侧 LLM 输出清洗，10 条规则）', () => {
  const normalize = (raw, max) => pureFns.normalizeGeneratedTitle(raw, max)

  it('T1 剥离闭合的思维链块', () => {
    expect(normalize(THINK_OPEN + '\n我需要想一个爆款标题\n' + THINK_CLOSE + '\n外婆的灶台总飘着豆瓣香'))
      .toBe('外婆的灶台总飘着豆瓣香')
  })

  it('T2 剥离未闭合的思维链尾部（finish_reason=length 截断形态）', () => {
    expect(normalize('外婆的灶台总飘着豆瓣香\n' + THINK_OPEN + '\n还没有想完'))
      .toBe('外婆的灶台总飘着豆瓣香')
  })

  it('T3 剥离 markdown 代码围栏', () => {
    expect(normalize('```\n外婆的灶台\n```')).toBe('外婆的灶台')
    expect(normalize('```text\n外婆的灶台\n```')).toBe('外婆的灶台')
  })

  it('T4 多行输出只取首个非空行', () => {
    expect(normalize('\n\n外婆的灶台\n第二个候选\n第三个候选')).toBe('外婆的灶台')
  })

  it('T5 去掉成对的引号与书名号包裹', () => {
    expect(normalize('「外婆的灶台」')).toBe('外婆的灶台')
    expect(normalize('《外婆的灶台》')).toBe('外婆的灶台')
    expect(normalize('"外婆的灶台"')).toBe('外婆的灶台')
    expect(normalize("'外婆的灶台'")).toBe('外婆的灶台')
  })

  it('T6 单边引号不剥（可能是标题内容本身）', () => {
    expect(normalize('"外婆的灶台')).toBe('"外婆的灶台')
    expect(normalize('外婆的"灶台')).toBe('外婆的"灶台')
  })

  it('T7 去掉列表编号前缀', () => {
    expect(normalize('1. 外婆的灶台')).toBe('外婆的灶台')
    expect(normalize('2、外婆的灶台')).toBe('外婆的灶台')
    expect(normalize('1) 外婆的灶台')).toBe('外婆的灶台')
    expect(normalize('- 外婆的灶台')).toBe('外婆的灶台')
    expect(normalize('* 外婆的灶台')).toBe('外婆的灶台')
  })

  it('T8 去掉「标题：」类前缀标签', () => {
    expect(normalize('标题：外婆的灶台')).toBe('外婆的灶台')
    expect(normalize('Title: Grandma kitchen')).toBe('Grandma kitchen')
  })

  it('T9 去掉尾部标点与空白', () => {
    expect(normalize('外婆的灶台。')).toBe('外婆的灶台')
    expect(normalize('外婆的灶台！！')).toBe('外婆的灶台')
    expect(normalize('外婆的灶台，')).toBe('外婆的灶台')
    expect(normalize('外婆的灶台；;')).toBe('外婆的灶台')
    expect(normalize('外婆的灶台   ')).toBe('外婆的灶台')
  })

  it('T10 按 Unicode 码点截断（不产生孤立代理）', () => {
    const out = normalize('😀'.repeat(120), 10)
    expect([...out].length).toBe(10)
    expect(out).toBe('😀'.repeat(10))
  })

  it('T11 空 / 纯空白 / 纯标点 → 空串', () => {
    expect(normalize('')).toBe('')
    expect(normalize('   \n\t  ')).toBe('')
    expect(normalize('。！？')).toBe('')
    expect(normalize(null)).toBe('')
    expect(normalize(undefined)).toBe('')
  })

  it('T12 控制字符被清洗', () => {
    expect(normalize('外婆的灶台')).toBe('外婆的灶台')
  })

  it('T13 清洗顺序叠加：围栏 + 编号 + 引号 + 尾部标点', () => {
    expect(normalize('```\n1. 「外婆的灶台。」\n```')).toBe('外婆的灶台')
  })
})

describe('ai:generate-gen-video-title', () => {
  it('I1 有默认 LLM 且正常返回 → success:true + 标题', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('ai:generate-gen-video-title')

    const result = await handler(TRUSTED_EVENT, VALID_PAYLOAD)

    expect(result).toEqual({ code: 0, data: { success: true, title: '打工人醒醒！AI又抢活了' } })
  })

  it('I2 调用 generateWithDefault 使用 llm 类别并带上 prompt 消息', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    await handler(TRUSTED_EVENT, VALID_PAYLOAD)

    expect(deps.aiGenerator.generateWithDefault).toHaveBeenCalledTimes(1)
    const [type, params] = deps.aiGenerator.generateWithDefault.mock.calls[0]
    expect(type).toBe('llm')
    expect(params.messages).toHaveLength(2)
    expect(params.messages[0].role).toBe('system')
    expect(params.messages[1].role).toBe('user')
    expect(params.messages[1].content).toContain('AI大模型最新突破进展')
    expect(params.messages[1].content).toContain('改写后的正文内容……')
  })

  it('I3 无默认 LLM（getDefault 返回 null）→ no-model，不调 LLM', async () => {
    const deps = createMockDeps({
      aiGenerator: makeAiGenerator({
        _modelProviderManager: { getDefault: vi.fn(() => null), getProviderWithKey: vi.fn(() => null), _ready: true },
      }),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    const result = await handler(TRUSTED_EVENT, VALID_PAYLOAD)

    expect(result).toEqual({ code: 0, data: { success: false, reason: 'no-model' } })
    expect(deps.aiGenerator.generateWithDefault).not.toHaveBeenCalled()
  })

  it('I4 默认 LLM 无可用模型（models 为空）→ no-model', async () => {
    const deps = createMockDeps({
      aiGenerator: makeAiGenerator({
        _modelProviderManager: {
          getDefault: vi.fn(() => ({ id: 'p', name: 'P', enabled: true, is_configured: true, models: [] })),
          getProviderWithKey: vi.fn(() => ({ id: 'p', api_key: 'sk' })),
          _ready: true,
        },
      }),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    const result = await handler(TRUSTED_EVENT, VALID_PAYLOAD)

    expect(result).toEqual({ code: 0, data: { success: false, reason: 'no-model' } })
    expect(deps.aiGenerator.generateWithDefault).not.toHaveBeenCalled()
  })

  it('I5 generateWithDefault 抛错 → failed + message，不向渲染层抛', async () => {
    const deps = createMockDeps({
      aiGenerator: makeAiGenerator({
        generateWithDefault: vi.fn().mockRejectedValue(new Error('Network error')),
      }),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    const result = await handler(TRUSTED_EVENT, VALID_PAYLOAD)

    expect(result.code).toBe(0)
    expect(result.data.success).toBe(false)
    expect(result.data.reason).toBe('failed')
    expect(result.data.message).toContain('Network error')
  })

  it('I6 返回空 content → failed', async () => {
    const deps = createMockDeps({
      aiGenerator: makeAiGenerator({ generateWithDefault: vi.fn().mockResolvedValue({ content: '   ' }) }),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    const result = await handler(TRUSTED_EVENT, VALID_PAYLOAD)

    expect(result).toMatchObject({ code: 0, data: { success: false, reason: 'failed' } })
  })

  it('I7 参数非对象 → VALIDATION_ERROR', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('ai:generate-gen-video-title')

    for (const bad of [null, undefined, 'str', 42, []]) {
      const result = await handler(TRUSTED_EVENT, bad)
      expect(result.code).toBe(-2)
      expect(result.message).toBeTruthy()
    }
  })

  it('I8 topicText 为空串 → VALIDATION_ERROR，不浪费 LLM 调用', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    const result = await handler(TRUSTED_EVENT, { topicText: '   ', bodyText: 'x' })

    expect(result.code).toBe(-2)
    expect(deps.aiGenerator.generateWithDefault).not.toHaveBeenCalled()
  })

  it('I9 max 非法时用默认上限（透传给清洗逻辑，行为体现为不抛错）', async () => {
    const deps = createMockDeps({
      aiGenerator: makeAiGenerator({ generateWithDefault: vi.fn().mockResolvedValue({ content: '标'.repeat(300) }) }),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    const result = await handler(TRUSTED_EVENT, { ...VALID_PAYLOAD, max: 'not-a-number' })

    expect(result.code).toBe(0)
    expect(result.data.success).toBe(true)
    expect(result.data.title.length).toBe(20) // 2026-10-18：默认上限 100→20
  })

  it('I10 推理型模型自动放大 max_tokens', async () => {
    const deps = createMockDeps({
      aiGenerator: makeAiGenerator({
        _modelProviderManager: {
          getDefault: vi.fn(() => ({ id: 'minimax', name: 'MiniMax', enabled: true, is_configured: true, models: ['minimax-m3'] })),
          getProviderWithKey: vi.fn(() => ({ id: 'minimax', api_key: 'sk-mm', models: ['minimax-m3'] })),
          _ready: true,
        },
      }),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    await handler(TRUSTED_EVENT, VALID_PAYLOAD)

    const params = deps.aiGenerator.generateWithDefault.mock.calls[0][1]
    expect(params.max_tokens).toBe(5000)
  })

  it('I11 普通模型使用默认 max_tokens', async () => {
    const deps = createMockDeps({
      aiGenerator: makeAiGenerator({
        _modelProviderManager: {
          getDefault: vi.fn(() => ({ id: 'openai', name: 'OpenAI', enabled: true, is_configured: true, models: ['gpt-4o-mini'] })),
          getProviderWithKey: vi.fn(() => ({ id: 'openai', api_key: 'sk-oai', models: ['gpt-4o-mini'] })),
          _ready: true,
        },
      }),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    await handler(TRUSTED_EVENT, VALID_PAYLOAD)

    const params = deps.aiGenerator.generateWithDefault.mock.calls[0][1]
    expect(params.max_tokens).toBe(1600)
  })

  it('I12 写操作拒绝外部网页来源', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    const result = await handler(UNTRUSTED_EVENT, VALID_PAYLOAD)

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(deps.aiGenerator.generateWithDefault).not.toHaveBeenCalled()
  })

  it('I13 返回内容经清洗（围栏/编号/引号被剥掉）', async () => {
    const deps = createMockDeps({
      aiGenerator: makeAiGenerator({ generateWithDefault: vi.fn().mockResolvedValue({ content: '```\n1. 「外婆的灶台」\n```' }) }),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-gen-video-title')

    const result = await handler(TRUSTED_EVENT, VALID_PAYLOAD)

    expect(result.data.title).toBe('外婆的灶台')
  })
})
