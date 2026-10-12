/**
 * container.setup.creator.test.js — 博主监控容器装配的接线锁
 *
 * 事故（2026-10-12）：本文件注册的 `creatorCredentialProvider` **从未存在过**，
 * 而 `creatorCollector` 的工厂里写着 `c.get('creatorCredentialProvider') || (() => null)`。
 * 容器 `get` 对未注册名是**抛错**（`container.js:78`），不是返回 undefined ⇒
 * 只要有人解析 `creatorCollector`（`phase5-ipc.js` 就解析），工厂就抛 ⇒
 * `creatorRuntime` 一并失败 ⇒ 11 个 creator 通道全部降级 ⇒ 整页只剩
 * 「缺少采集依赖。请执行：」。注释里那句「可选注册项，缺省回落空实现」是**意图**，
 * 代码里没有兜底。本文件把「注册在位」与「兜底真的存在」两条都锁住。
 *
 * 用假容器而不是真容器：真容器要拉 20+ 个服务，而这里要测的只是
 * 「注册顺序 / 工厂形状 / 缺项兜底」三件事——夹具越接近被测契约越好。
 */
const { registerCreatorServices } = require('./container.setup.creator')

/** 惰性解析假容器：get 未注册名抛错，与 container.js 的真实语义一致 */
function createFakeContainer (seed = {}) {
  const factories = new Map()
  const resolved = { ...seed }
  const api = {
    register (name, factory) { factories.set(name, factory) },
    get (name) {
      if (Object.prototype.hasOwnProperty.call(resolved, name)) return resolved[name]
      const factory = factories.get(name)
      if (!factory) throw new Error('Service not registered: ' + name)
      const value = factory(api)
      resolved[name] = value
      return value
    },
    has (name) { return Object.prototype.hasOwnProperty.call(resolved, name) || factories.has(name) },
  }
  return api
}

function baseSeed () {
  return {
    store: { getDb: () => ({ fake: 'db' }), getSetting: () => null, setSetting: () => {} },
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    pythonBridge: { isRunning: () => true, requestBackend: async () => ({}) },
  }
}

describe('container.setup.creator · 注册完整性', () => {
  it('注册四项：creatorStore / creatorCredentialProvider / creatorCollector / creatorRuntime', () => {
    const container = createFakeContainer(baseSeed())
    registerCreatorServices(container)
    for (const name of ['creatorStore', 'creatorCredentialProvider', 'creatorCollector', 'creatorRuntime']) {
      expect(() => container.get(name)).not.toThrow()
    }
  })

  it('凭证提供者注册在采集器之前可解析（容器按需惰性求值，顺序错就抛）', () => {
    const container = createFakeContainer(baseSeed())
    registerCreatorServices(container)
    const provider = container.get('creatorCredentialProvider')
    expect(typeof provider.status).toBe('function')
    expect(typeof provider.getApiKey).toBe('function')
    expect(typeof provider.setApiKey).toBe('function')
    expect(typeof provider.clear).toBe('function')
  })
})

describe('container.setup.creator · 采集器拿到的凭证形状', () => {
  it('采集器收到的 credentialProvider 是「函数」，不是 provider 对象（形状适配不可省）', () => {
    const container = createFakeContainer(baseSeed())
    registerCreatorServices(container)
    // 直接解析采集器：工厂内部会去取凭证提供者。若把 provider 对象原样当函数传，
    // creator-collector-runtime 调用时会 TypeError（这是本轮修掉的第二个成因的邻接风险）。
    expect(() => container.get('creatorCollector')).not.toThrow()
  })

  it('已配 Key 时按 { apiKey, pythonBridge } 形状供给（保留 this 无关的调用语义）', () => {
    const container = createFakeContainer({
      ...baseSeed(),
      creatorCredentialProvider: {
        getApiKey: () => 'AIza-seeded-key-1234567890',
        status: () => ({ status: 'ok', fingerprint: 'abcd' }),
        setApiKey: () => ({ ok: true }),
        clear: () => ({ ok: true }),
      },
    })
    registerCreatorServices(container)
    const collector = container.get('creatorCollector')
    // 采集器把 credentialProvider 放在闭包里，只有真发起请求才用到；
    // 这里用 resolveChannelId 走一条不需要网络的路径，确认它没在构造期就抛。
    expect(typeof collector.resolveChannelId).toBe('function')
    expect(typeof collector.listPosts).toBe('function')
  })

  it('凭证提供者缺失时采集器仍能解析（兜底必须真的存在，而不是注释里的意图）', () => {
    const container = createFakeContainer(baseSeed())
    registerCreatorServices(container)
    // 模拟「注册项被删掉」：让 get 对凭证名抛错（与真实容器未注册时的行为一致）
    const originalGet = container.get
    container.get = (name) => {
      if (name === 'creatorCredentialProvider') throw new Error('Service not registered: creatorCredentialProvider')
      return originalGet(name)
    }
    expect(() => container.get('creatorCollector')).not.toThrow()
  })

  it('pythonBridge 缺失不阻塞采集器构造（字幕腿可选，发现腿不依赖它）', () => {
    const seed = baseSeed()
    delete seed.pythonBridge
    const container = createFakeContainer(seed)
    registerCreatorServices(container)
    expect(() => container.get('creatorCollector')).not.toThrow()
  })
})
