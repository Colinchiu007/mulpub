/**
 * 播客频道 IPC 单轨链路的行为锁（走**真实桥接层**，不 mock 桥接）
 *
 * 为什么必须有这个文件：渲染层取用点从 composable 下沉到 src/api/podcast-channel.js
 * 之后，check-frontend-consistency 只会数「字面量出现没有」，数不出「调用还通不通」。
 * 本仓实测踩过「全绿但链路是断的」（跨包夹具替对方剥壳那一类），所以这里把三种
 * 结果语义逐个跑出来：命名空间缺失 / 方法缺失 / handler 抛错 / 返回非对象。
 *
 * 接缝纪律：只 mock `window.electronAPI`（preload 的暴露面），桥接层与 composable
 * 都用真实实现 —— 摘掉桥接层的 available 判定，本文件立刻红。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive } from 'vue'

const seenArgs = []

function makeFakeApi () {
  return {
    podcast: {
      channelGet: vi.fn(async (...args) => { seenArgs.push(args); return { ok: true, channel: null } }),
      channelSave: vi.fn(async (...args) => { seenArgs.push(args); return { ok: true, channel: args[0] } }),
      episodeList: vi.fn(async (...args) => { seenArgs.push(args); return { ok: true, episodes: [] } }),
    },
  }
}

describe('podcast-channel 桥接层：available 语义与脱壳', () => {
  beforeEach(() => {
    seenArgs.length = 0
    vi.resetModules()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('命名空间存在时原样带出主进程返回值，并标记 available', async () => {
    vi.stubGlobal('window', { electronAPI: makeFakeApi() })
    const { channelGet } = await import('@/api/podcast-channel')
    expect(await channelGet()).toEqual({ available: true, result: { ok: true, channel: null } })
  })

  it('podcast 命名空间缺失 → available:false，且一个方法都不被调用', async () => {
    vi.stubGlobal('window', { electronAPI: {} })
    const { channelGet } = await import('@/api/podcast-channel')
    expect(await channelGet()).toEqual({ available: false })
  })

  it('命名空间在、方法名不在 → available:false（与 handler 抛错区分开）', async () => {
    vi.stubGlobal('window', { electronAPI: { podcast: {} } })
    const { feedBuild } = await import('@/api/podcast-channel')
    expect(await feedBuild()).toEqual({ available: false })
  })

  it('reactive 载荷经桥接层后，暴露面收到的必须是 plain object（脱壳真实发生）', async () => {
    const fake = makeFakeApi()
    vi.stubGlobal('window', { electronAPI: fake })
    const { channelSave } = await import('@/api/podcast-channel')
    const form = reactive({ title: '午间电台', settings: { language: 'zh-CN' } })

    await channelSave(form)

    expect(fake.podcast.channelSave).toHaveBeenCalledTimes(1)
    const [passed] = seenArgs[0]
    expect(passed).not.toBe(form)
    expect(Object.getPrototypeOf(passed)).toBe(Object.prototype)
    expect(passed).toEqual({ title: '午间电台', settings: { language: 'zh-CN' } })
  })

  it('handler reject 原样向上抛，桥接层不吞成 available:false', async () => {
    vi.stubGlobal('window', {
      electronAPI: { podcast: { feedVerify: vi.fn(async () => { throw new Error('boom') }) } },
    })
    const { feedVerify } = await import('@/api/podcast-channel')
    await expect(feedVerify()).rejects.toThrow('boom')
  })

  // QM-6 外部评审（后端模型）命中的真实缺口：preload 访问控制在未登录/未激活时
  // 是**同步 throw**（createDynamicAccessApi 的包装函数不是 async），于是它既不属于
  // 「方法缺失」也不同于 handler 的 reject。本仓 M-14 早已给这类失败定调
  // （electron-bridge.invokeWithFallback：权限不足必须落进 fallback 语义），
  // 所以桥接层必须把它归进 available:false，而不是让界面报「调用失败，请重试」。
  it('权限前置条件（未登录/未激活）**同步** throw → available:false，且不上抛', async () => {
    // 夹具逐字复刻 access-control.createPermissionError 的产物形状：name 是判据，
    // message 文案与 code 一并带上，免得下一个会话照抄一个 predicate 认不出的假错误。
    const permission = () => {
      const e = new Error('许可证权限不足，无法调用 channelGet')
      e.name = 'LicensePermissionError'
      e.code = 'AUTH_ERROR'
      return e
    }
    vi.stubGlobal('window', {
      electronAPI: { podcast: { channelGet: vi.fn(() => { throw permission() }) } },
    })
    const { channelGet } = await import('@/api/podcast-channel')
    expect(await channelGet()).toEqual({ available: false })
  })

  it('非权限类的同步 throw 仍原样上抛（不得被 available:false 一并吃掉）', async () => {
    vi.stubGlobal('window', {
      electronAPI: { podcast: { channelGet: vi.fn(() => { throw new Error('preload 内部故障') }) } },
    })
    const { channelGet } = await import('@/api/podcast-channel')
    await expect(channelGet()).rejects.toThrow('preload 内部故障')
  })
})

describe('usePodcastChannel：桥接结果到用户可见错误码的映射', () => {
  beforeEach(() => {
    seenArgs.length = 0
    vi.resetModules()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('主进程可达时落地数据、错误位清空', async () => {
    vi.stubGlobal('window', { electronAPI: makeFakeApi() })
    const { usePodcastChannel } = await import('./usePodcastChannel')
    const s = usePodcastChannel()

    await s.loadEpisodes()

    expect(s.episodesError.value).toBe('')
    expect(s.episodes.value).toEqual([])
    expect(s.episodesLoaded.value).toBe(true)
  })

  it('命名空间缺失 → PODCAST_IPC_UNAVAILABLE（不是把状态抹成空列表假装成功）', async () => {
    vi.stubGlobal('window', { electronAPI: {} })
    const { usePodcastChannel, IPC_UNAVAILABLE } = await import('./usePodcastChannel')
    const s = usePodcastChannel()

    const res = await s.loadChannel()

    expect(res.code).toBe(IPC_UNAVAILABLE)
    expect(s.channelError.value).toBe(IPC_UNAVAILABLE)
    expect(s.channelLoaded.value).toBe(true)
  })
  // 评审 i7：EC 数字只区分「往哪查」，用户可见文案必须按领域码取 —— subCode 存在时优先
  it('失败信封带 subCode → composable 用领域码顶替 EC 数字（否则新增校验码只能落到兜底文案）', async () => {
    vi.stubGlobal('window', {
      electronAPI: { podcast: { episodeList: vi.fn(async () => ({ ok: false, code: -3, subCode: 'PODCAST_CHANNEL_BUSY', message: 'PODCAST_CHANNEL_BUSY: episode:save' })) } },
    })
    const { usePodcastChannel } = await import('./usePodcastChannel')
    const s = usePodcastChannel()

    const res = await s.loadEpisodes()

    expect(res.code).toBe('PODCAST_CHANNEL_BUSY')
    expect(s.episodesError.value).toBe('PODCAST_CHANNEL_BUSY')
  })

  it('handler 抛错 → PODCAST_IPC_EXCEPTION 并保留原始 message', async () => {
    vi.stubGlobal('window', {
      electronAPI: { podcast: { episodeList: vi.fn(async () => { throw new Error('db locked') }) } },
    })
    const { usePodcastChannel, IPC_EXCEPTION } = await import('./usePodcastChannel')
    const s = usePodcastChannel()

    const res = await s.loadEpisodes()

    expect(res.code).toBe(IPC_EXCEPTION)
    expect(res.message).toContain('db locked')
    expect(s.episodesError.value).toBe(IPC_EXCEPTION)
  })

  it('主进程返回非对象（契约破坏）→ PODCAST_IPC_EXCEPTION，不得退化成空数据', async () => {
    vi.stubGlobal('window', {
      electronAPI: { podcast: { episodeList: vi.fn(async () => 'ok') } },
    })
    const { usePodcastChannel, IPC_EXCEPTION } = await import('./usePodcastChannel')
    const s = usePodcastChannel()

    expect((await s.loadEpisodes()).code).toBe(IPC_EXCEPTION)
  })

  it('未登录/未激活（权限同步 throw 穿透桥接层）→ IPC_UNAVAILABLE，不是「调用失败请重试」', async () => {
    // 这条锁的是**用户可见语义**：桥接层归并成 available:false 之后，composable 必须
    // 走与「命名空间缺失」同一分支。摘掉桥接层的权限判据会让本条落到 IPC_EXCEPTION 而变红。
    vi.stubGlobal('window', {
      electronAPI: {
        podcast: {
          channelGet: vi.fn(() => {
            const e = new Error('许可证权限不足，无法调用 channelGet')
            e.name = 'LicensePermissionError'
            throw e
          }),
        },
      },
    })
    const { usePodcastChannel, IPC_UNAVAILABLE } = await import('./usePodcastChannel')
    const s = usePodcastChannel()

    const res = await s.loadChannel()

    expect(res.code).toBe(IPC_UNAVAILABLE)
    expect(s.channelError.value).toBe(IPC_UNAVAILABLE)
  })
})

describe('IPC 单轨制结构锁', () => {
  const METHODS = [
    'channelGet', 'channelSave', 'episodeList', 'episodeSave',
    'episodeRemove', 'feedBuild', 'feedVerify', 'endpointList',
  ]

  it('composable 源码不再出现桌面端暴露面字面量，取用点只在 src/api', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(process.cwd(), 'src')
    const src = fs.readFileSync(path.join(root, 'composables', 'usePodcastChannel.js'), 'utf8')
    expect(src).not.toMatch(/electronAPI/)

    const bridge = fs.readFileSync(path.join(root, 'api', 'podcast-channel.js'), 'utf8')
    // 每条路径的首参必须是**方法名字面量**：ipc-exposure-contract 的静态对账按字面量抽名，
    // 经辅助函数转发成变量就变成「生产侧动态取名」，该文件会当场红（本仓 C-1 同形态）。
    for (const m of METHODS) expect(bridge).toContain(`invokeNamespace(NS, '${m}'`)
    expect(bridge).not.toMatch(/invokeNamespace\(\s*NS\s*,\s*[^'"\s]/)

    // QM-6 后端评审的缺口防再犯：权限类前置条件必须归进 available:false，
    // 且调用必须以 thunk 形态发生在 envelope 的 try 之内（invokeNamespace 非 async，
    // 直接传 promise 会让同步 throw 逃过 catch —— 那是一条静默的语义退化）。
    expect(bridge).toMatch(/import \{[^}]*\bisPermissionError\b[^}]*\} from '\.\/electron-bridge'/)
    expect(bridge).toMatch(/isPermissionError\(err\)/)
    expect(bridge).toMatch(/await pending\(\)/)
    expect(bridge).not.toMatch(/envelope\(\s*invokeNamespace\(/)
  })

  it('桥接层导出面与 preload 暴露面逐字一致（防改名漂移）', async () => {
    const api = await import('@/api/podcast-channel')
    // 必须拿**真 preload 面**比对，不能拿本文件的 METHODS 常量：后者与桥接层是同一只手写的，
    // 两边一起改名时该断言照绿（QM-6 前端模型实测命中这条）。preload 是 CJS 且导出工厂，
    // 用一个只记录通道名的假 ipcRenderer 实例化，取 podcast 命名空间的键即为暴露面。
    const mod = await import('../../electron/preload/podcast.js')
    const createPodcastApi = mod.createPodcastApi ?? mod.default.createPodcastApi
    const surface = createPodcastApi({ invoke: async () => ({ code: 0, data: null }) }).podcast
    expect(Object.keys(api).sort()).toEqual(Object.keys(surface).sort())
    expect(Object.keys(surface)).toHaveLength(17)
  })
})
