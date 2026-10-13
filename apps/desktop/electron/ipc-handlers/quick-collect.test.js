/**
 * quick-collect IPC handlers
 *
 * 四条不可省：① 两条通道都注册；② 参数非对象 → -2（requireArgs）；
 * ③ 依赖后到也能工作（不解构 deps）；④ 进度事件推到发起窗口且带 requestId。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// withSenderCheck 需要 `require('electron').app.isPackaged === false` 才走测试放行；
// 本仓的 electron mock 是 **opt-in** 拦截（test-setup.js），不开启会得到 -3（未授权来源），
// 于是所有用例都会以同一个假失败收场。必须在本文件任何 `require('electron')` 之前开启。
beforeAll(() => { __enableElectronMock() })

const NOW = Date.parse('2026-10-11T04:00:00.000Z')

function makeIpcMain () {
  const handlers = {}
  return { handlers, handle: (channel, fn) => { handlers[channel] = fn } }
}

function makeWindow () {
  const send = vi.fn()
  const win = { webContents: { send }, isDestroyed: () => false }
  return { win, send }
}

function makeDeps (over = {}) {
  const { win } = makeWindow()
  return {
    BrowserWindow: { fromWebContents: () => win },
    contentIntelligence: {
      search: vi.fn(async () => ({
        results: [{
          url: 'https://example.com/a',
          title: '素材 A',
          source: 'hackernews',
          snippet: '摘要',
          engagement: 3,
          created_utc: Math.floor((NOW - 3600 * 1000) / 1000),
        }],
      })),
    },
    aiGenerator: { generateWithDefault: vi.fn(async () => ({ content: '生成的正文' })) },
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    // 注入固定时钟（2026-10-13，change: qc-clock-seam）：本文件夹具锚在写死的 NOW，
    // 而 48h 窗口过滤此前走真实时钟 ⇒ 夹具越窗后**必然**翻红（三个用例在
    // 2026-10-13T02:00Z 同时红）。engine 侧已转发 deps.now（见 ipc-handlers/quick-collect.js
    // 的 getEngine()），这里把时钟接上即恢复确定性。
    now: () => NOW,
    ...over,
  }
}

/** 可信来源事件（与既有 payment 合同测试同口径：开发态 localhost:5174） */
const TRUSTED_EVENT = { sender: { id: 1 }, senderFrame: { url: 'http://localhost:5174/' } }

const COMMAND = {
  id: 'qc-1',
  title: 'AI 领域动向',
  prompt: '请检索过去48小时内AI与新技术领域的真实动态，输出 3 条建议关注。',
  keywords: ['LLM release'],
  windowHours: 48,
  sources: ['hackernews'],
  builtin: false,
}

async function register (deps) {
  const { handlers, handle } = makeIpcMain()
  const registerHandlers = (await import('./quick-collect')).default
  registerHandlers({ handle }, deps)
  return { handlers, deps }
}

describe('quick-collect IPC/注册面', () => {
  let handlers
  beforeEach(async () => {
    ({ handlers } = await register(makeDeps()))
  })

  it('注册两条通道', () => {
    expect(Object.keys(handlers).sort()).toEqual(['quick-collect:list-presets', 'quick-collect:run'])
  })

  it('list-presets 返回 6 条内置指令，且两次调用互不影响（深拷贝出口）', async () => {
    const first = await handlers['quick-collect:list-presets']({})
    expect(first.code).toBe(0)
    expect(first.data).toHaveLength(6)
    first.data[0].title = '被改坏'
    const second = await handlers['quick-collect:list-presets']({})
    expect(second.data[0].title).not.toBe('被改坏')
  })

  it('run 成功：返回条目并把进度推到发起窗口', async () => {
    const { handlers: h, deps } = await register(makeDeps())
    const { win, send } = makeWindow()
    deps.BrowserWindow.fromWebContents = () => win
    const res = await h['quick-collect:run'](TRUSTED_EVENT, { command: COMMAND, requestId: 'req-1' })
    expect(res.code).toBe(0)
    expect(res.data.quickCollect.retrieval).toBe('ok')
    expect(deps.aiGenerator.generateWithDefault).toHaveBeenCalledTimes(1)
    const stages = send.mock.calls.map((c) => c[1].stage)
    expect(stages).toEqual(['retrieving', 'summarizing', 'done'])
    expect(send.mock.calls.every((c) => c[0] === 'quick-collect:progress' && c[1].requestId === 'req-1')).toBe(true)
  })

  it('回归锁（qc-clock-seam）：48h 窗口必须用注入的 deps.now，不得走真实时钟', async () => {
    // 用「远在过去」的固定时钟：真实时钟的 48h 窗口必然把该素材排除，因此只有 engine
    // 真的用了注入时钟、素材才会被判进窗口。丢掉 getEngine() 里的 now 转发 ⇒ 立刻红。
    // 这比「夹具锚在固定日期、等它自然老化」稳：老化型只在越窗后才红（2026-10-13 实测，
    // 三个用例在 2026-10-13T02:00Z 同时翻红）。
    const past = Date.parse('2020-01-01T00:00:00.000Z')
    const deps = makeDeps({
      now: () => past,
      contentIntelligence: {
        search: vi.fn(async () => ({
          results: [{
            url: 'https://example.com/past',
            title: '旧素材',
            source: 'hackernews',
            snippet: '摘要',
            engagement: 1,
            created_utc: Math.floor((past - 3600 * 1000) / 1000),
          }],
        })),
      },
    })
    const { handlers: h } = await register(deps)
    const res = await h['quick-collect:run'](TRUSTED_EVENT, { command: COMMAND })
    expect(res.code).toBe(0)
    // 走真实时钟 ⇒ 该素材「6 年前」，被 48h 窗口滤掉 ⇒ retrieval=empty（红）
    expect(res.data.quickCollect.retrieval).toBe('ok')
  })

  it('参数非对象 → -2 且不触发任何外呼', async () => {
    const { handlers: h, deps } = await register(makeDeps())
    const res = await h['quick-collect:run'](TRUSTED_EVENT, undefined)
    expect(res).toEqual({ code: -2, message: '缺少参数对象' })
    expect(deps.contentIntelligence.search).not.toHaveBeenCalled()
    expect(deps.aiGenerator.generateWithDefault).not.toHaveBeenCalled()
  })

  it('缺 command → 引擎领域码 QC_COMMAND_REQUIRED', async () => {
    const { handlers: h } = await register(makeDeps())
    expect(await h['quick-collect:run'](TRUSTED_EVENT, {})).toEqual({ code: -2, message: 'QC_COMMAND_REQUIRED' })
  })

  it('大模型缺席 → -101（且检索可以不发生也不报错）', async () => {
    const { handlers: h } = await register(makeDeps({ aiGenerator: undefined }))
    const res = await h['quick-collect:run'](TRUSTED_EVENT, { command: COMMAND })
    expect(res).toEqual({ code: -101, message: 'QC_LLM_NOT_CONFIGURED' })
  })

  it('检索依赖缺席 → retrieval=skipped，但模型仍被调用一次', async () => {
    const deps = makeDeps({ contentIntelligence: undefined })
    const { handlers: h } = await register(deps)
    const res = await h['quick-collect:run'](TRUSTED_EVENT, { command: COMMAND })
    expect(res.code).toBe(0)
    expect(res.data.quickCollect.retrieval).toBe('skipped')
    expect(deps.aiGenerator.generateWithDefault).toHaveBeenCalledTimes(1)
  })

  it('依赖在注册后注入也能工作（不解构 deps —— 反证 phase5 装配顺序）', async () => {
    const deps = makeDeps({ aiGenerator: undefined, contentIntelligence: undefined })
    const { handlers: h } = await register(deps)
    expect((await h['quick-collect:run'](TRUSTED_EVENT, { command: COMMAND })).code).toBe(-101)
    // 模拟容器随后注入（phase5 顺序）
    deps.aiGenerator = makeDeps().aiGenerator
    deps.contentIntelligence = makeDeps().contentIntelligence
    const res = await h['quick-collect:run'](TRUSTED_EVENT, { command: COMMAND })
    expect(res.code).toBe(0)
    expect(res.data.content).toBe('生成的正文')
  })

  it('模型调用失败 → -102（不吞错、不落空条目）', async () => {
    const deps = makeDeps({ aiGenerator: { generateWithDefault: vi.fn(async () => { throw new Error('429') }) } })
    const { handlers: h } = await register(deps)
    const res = await h['quick-collect:run'](TRUSTED_EVENT, { command: COMMAND })
    expect(res.code).toBe(-102)
    expect(res.message).toBe('429')
  })
})
