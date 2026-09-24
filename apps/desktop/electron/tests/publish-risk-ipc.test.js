// @vitest-environment node
/**
 * W1 §5 enforcement：publishRisk:* IPC 契约测试
 * 模式与 ipc-contract.test.js 一致：注册 handlers 后直接调用（可信 localhost senderFrame 放行 withSenderCheck）
 */
const { RiskSuspendedError } = require('../services/risk-suspender-store')

// 启用 electron app mock（isPackaged===false），使 withSenderCheck 走 dev-localhost 可信来源分支。
// 必须在 require('../ipc-handlers/publish') 之前生效（下方 registerPublishRiskHandlers 懒加载）。
__enableElectronMock()

const trustedEvent = () => ({ senderFrame: { url: 'http://localhost:5174/' } })

function registerPublishRiskHandlers (riskSuspender) {
  delete require.cache[require.resolve('../ipc-handlers/publish')]
  const handlers = {}
  const BrowserWindow = { getAllWindows: () => [] }
  require('../ipc-handlers/publish')(
    { handle: (channel, handler) => { handlers[channel] = handler } },
    { taskQueue: null, history: null, BrowserWindow, log: null, identityService: null, riskSuspender },
  )
  return handlers
}

describe('publishRisk IPC handlers', () => {
  it('listSuspended 返回挂起清单；未接线服务时返回错误 envelope', async () => {
    const riskSuspender = { listSuspended: () => [{ platform: 'weixin', accountId: null }] }
    const handlers = registerPublishRiskHandlers(riskSuspender)
    await expect(handlers['publishRisk:listSuspended'](trustedEvent())).resolves.toEqual({
      code: 0, data: [{ platform: 'weixin', accountId: null }],
    })

    const none = registerPublishRiskHandlers(undefined)
    const res = await none['publishRisk:listSuspended'](trustedEvent())
    expect(res.code).not.toBe(0)
  })

  it('resume 校验 platform/accountId 格式，拒绝注入式路径段', async () => {
    const riskSuspender = { resume: vi.fn(() => true), listSuspended: () => [], isSuspended: () => true }
    const handlers = registerPublishRiskHandlers(riskSuspender)

    await expect(handlers['publishRisk:resume'](trustedEvent(), {})).resolves.toMatchObject({ code: -2 })
    await expect(handlers['publishRisk:resume'](trustedEvent(), { platform: 'a/b/../c' })).resolves.toMatchObject({ code: -2 })
    await expect(handlers['publishRisk:resume'](trustedEvent(), { platform: 'weixin', accountId: 'x;y' })).resolves.toMatchObject({ code: -2 })
    expect(riskSuspender.resume).not.toHaveBeenCalled()
  })

  it('resume 成功路径：调用服务并回传最新清单', async () => {
    const resume = vi.fn(() => true)
    const riskSuspender = { resume, listSuspended: () => [], isSuspended: () => false }
    const handlers = registerPublishRiskHandlers(riskSuspender)
    const res = await handlers['publishRisk:resume'](trustedEvent(), { platform: 'weixin', accountId: 'acc-1' })
    expect(res).toEqual({ code: 0, data: { changed: true, suspended: [] } })
    expect(resume).toHaveBeenCalledWith('weixin', 'acc-1')
  })

  it('isSuspended 返回布尔判定', async () => {
    const riskSuspender = { resume: () => false, listSuspended: () => [], isSuspended: (p, a) => p === 'weixin' && a === 'acc-1' }
    const handlers = registerPublishRiskHandlers(riskSuspender)
    await expect(handlers['publishRisk:isSuspended'](trustedEvent(), { platform: 'weixin', accountId: 'acc-1' })).resolves.toEqual({ code: 0, data: true })
    await expect(handlers['publishRisk:isSuspended'](trustedEvent(), { platform: 'weixin' })).resolves.toEqual({ code: 0, data: false })
    await expect(handlers['publishRisk:isSuspended'](trustedEvent(), {})).resolves.toMatchObject({ code: -2 })
  })

  it('服务抛错时返回错误 envelope 不崩溃', async () => {
    const riskSuspender = {
      listSuspended: () => { throw new Error('store broken') },
      resume: () => { throw new Error('store broken') },
      isSuspended: () => { throw new Error('store broken') },
    }
    const handlers = registerPublishRiskHandlers(riskSuspender)
    await expect(handlers['publishRisk:listSuspended'](trustedEvent())).resolves.toMatchObject({ code: -1, message: 'store broken' })
    await expect(handlers['publishRisk:resume'](trustedEvent(), { platform: 'weixin' })).resolves.toMatchObject({ code: -1 })
    await expect(handlers['publishRisk:isSuspended'](trustedEvent(), { platform: 'weixin' })).resolves.toMatchObject({ code: -1 })
    // sanity：executor 拦截错误本身携带 noRetry 语义（与 IPC 层解耦）
    expect(new RiskSuspendedError('weixin', 'acc-1').noRetry).toBe(true)
  })
})
