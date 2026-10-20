'use strict'
/**
 * 签名默认路径回归（2026-09-28 活体 6.3 裁决暴露的双缺陷）
 *
 * 活体证据（app-2026-09-28.log 22:00）：API 轨启动后
 * `kuaishou-video: 签名页未就绪（no signer injected；bridge 由桌面装配层注入）`
 * → 回退 DOM 轨。根因有二：
 * ① 链构造器文档契约「缺省走进程内注册表」从未实现——this.signer 为空直接抛错，
 *   桌面调用方（rpa-view-manager/publisher-router）都不显式传 signer；
 * ② registry 的 kuaishou.ns-sig3-browser 实现调 provider.sign('kuaishou.ns-sig3')
 *   （Tier-A 名），而桌面装配注册的命令是 kuaishou.ns-sig3-browser——命令名不匹配，
 *   即使走注册表也会 unknown command。
 */
const { registry } = require('../src/signer')
const { browserPageProvider } = require('../src/signer/index')
const { KuaishouVideoChain } = require('../src/publish/platforms/kuaishou-video')

describe('signer 默认路径（无显式 signer 注入）', () => {
  const origProviderSign = browserPageProvider.sign
  const origRegistrySign = registry.sign

  afterEach(() => {
    browserPageProvider.sign = origProviderSign
    registry.sign = origRegistrySign
  })

  it('registry 的 kuaishou.ns-sig3-browser 把自己的命令名透传给 provider（与桌面注册名一致）', async () => {
    const seen = []
    browserPageProvider.sign = async (command, payload) => {
      seen.push(command)
      return 'x'.repeat(64)
    }
    await registry.sign('kuaishou.ns-sig3-browser', { url: '/u', type: 'json', params: {} })
    expect(seen).toEqual(['kuaishou.ns-sig3-browser'])
  })

  it('链无 opts.signer 时缺省走进程内注册表（Tier-A 纯 JS 为默认命令）', async () => {
    const calls = []
    registry.sign = async (command, payload) => {
      calls.push(command)
      return 'y'.repeat(64)
    }
    const chain = new KuaishouVideoChain({ cookie: 'kuaishou.web.cp.api_st=sess; userId=u1' })
    const sig = await chain._sign('/rest/cp/works/v2/video/pc/upload/pre', { a: 1 }, 'json', { accountId: 'a1' })
    expect(sig).toBe('y'.repeat(64))
    expect(calls).toEqual(['kuaishou.ns-sig3'])
  })

  it('注册表路径的「签名页未就绪」映射为 signerNotReady（上层可降级 DOM）', async () => {
    registry.sign = async () => { throw new Error('签名页未就绪（browser-page-provider: bridge not injected）') }
    const chain = new KuaishouVideoChain({ cookie: 'kuaishou.web.cp.api_st=sess; userId=u1' })
    await expect(chain._sign('/x', {}, 'json', {})).rejects.toMatchObject({ signerNotReady: true })
  })

  it('显式 opts.signer 仍优先（测试注入通道不被默认回退破坏）', async () => {
    registry.sign = async () => { throw new Error('registry should not be called') }
    const chain = new KuaishouVideoChain({
      cookie: 'kuaishou.web.cp.api_st=sess; userId=u1',
      signer: async () => 'z'.repeat(64),
    })
    const sig = await chain._sign('/x', {}, 'json', {})
    expect(sig).toBe('z'.repeat(64))
  })
})
