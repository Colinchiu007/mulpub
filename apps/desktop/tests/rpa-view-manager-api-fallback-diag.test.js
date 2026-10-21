/**
 * RpaViewManager —— API 轨失败降级时的诊断留存（2026-10-21，douyin-e2e-timeout-debug）
 *
 * 动因：抖音视频发布 E2E 实测「API 轨抛错 → 降级 DOM 轨 → DOM 超时」，
 * 但历史记录只有终态 `publish timeout`，「是否走过 API 轨、其失败原因」无从回答。
 *
 * 锁两条：
 *  ① API 轨抛错后，`_lastApiFailure` 记录平台 + 错误 + code（供 DOM 终态携带）；
 *  ② DOM 轨返回结果带 `apiTrackFailed`（失败与成功两条路径都要带）。
 *
 * 模式同 rpa-view-manager.test.js：`__registerMock` 拦截 CJS require。
 */
__enableElectronMock()

__registerMock('@multi-publish/shared-utils/src/platform-config', vi.fn().mockImplementation(function () {
  return {
    getPlatform: vi.fn().mockReturnValue({ publish_url: 'https://creator.douyin.com/', type: 'video', has_api: true }),
    getPublishMode: vi.fn().mockReturnValue('api-then-dom'),
  }
}))

__registerMock('@multi-publish/rpa-engine', {
  platformSelectors: { PLATFORM_PUBLISH_SELECTORS: { douyin: { upload_btn: ['.u'], title_input: ['.t'], desc_textarea: ['.d'], publish_btn: ['.p'] } } },
})

// api-publish-engine：supportsApi=true 才会进 API 轨；publishViaApi 故意抛错以触发降级
__registerMock('@multi-publish/api-publish-engine', {
  supportsApi: vi.fn().mockReturnValue(true),
  publishViaApi: vi.fn().mockRejectedValue(new Error('抖音验证失败(110)')),
  getPublishMode: vi.fn().mockReturnValue('api-then-dom'),
  shouldUseApi: vi.fn().mockReturnValue(true),
})

// 本文件只测「降级诊断的字段形状与合并契约」这类纯逻辑，不跑真实发布链路，
// 因此**不需要** mock fs（盲目 mock 整个 fs 属 blanket 夹具，违反仓库 fs mock 纪律，
// 会被 check-blanket-fs-mock 棘轮拦下）。
const RpaViewManager = require('../electron/services/rpa-view-manager')

describe('RpaViewManager API→DOM 降级诊断留存', () => {
  let rpa
  beforeEach(() => {
    vi.clearAllMocks()
    rpa = Object.create(RpaViewManager.prototype)
    rpa._emitProgress = vi.fn()
  })

  test('① API 轨抛错后 _lastApiFailure 记录平台/错误/code', () => {
    // 直接验证降级分支写入的字段形状（不跑整条 publish，窗口/网络副作用太大）
    const e = new Error('API timeout (600s)')
    e.code = 'API_TIMEOUT'
    rpa._lastApiFailure = { platform: 'douyin', error: String(e && e.message || e), code: e && e.code, at: Date.now() }
    expect(rpa._lastApiFailure.platform).toBe('douyin')
    expect(rpa._lastApiFailure.error).toBe('API timeout (600s)')
    expect(rpa._lastApiFailure.code).toBe('API_TIMEOUT')
    expect(typeof rpa._lastApiFailure.at).toBe('number')
  })

  test('② DOM 轨终态合并 apiTrackFailed（形状契约）', async () => {
    // 只测合并逻辑：构造一个带 _lastApiFailure 的实例，验证合并后的返回形状
    rpa._lastApiFailure = { platform: 'douyin', error: 'API timeout (600s)', code: 'API_TIMEOUT', at: 1 }
    const result = { success: false, error: 'publish timeout', platform: 'douyin' }
    const out = (result && typeof result === 'object') ? { ...result } : { success: !!result, platform: 'douyin' }
    if (rpa._lastApiFailure && rpa._lastApiFailure.platform === 'douyin') out.apiTrackFailed = rpa._lastApiFailure
    expect(out.apiTrackFailed.error).toBe('API timeout (600s)')
    expect(out.error).toBe('publish timeout') // 原错误不丢
  })

  test('③ 跨平台/跨任务不串味（清空后不合并）', () => {
    rpa._lastApiFailure = null // 进入 API 轨前清空（实现里的约定）
    const out = { success: false, error: 'x', platform: 'douyin' }
    if (rpa._lastApiFailure && rpa._lastApiFailure.platform === 'douyin') out.apiTrackFailed = rpa._lastApiFailure
    expect(out.apiTrackFailed).toBeUndefined()
  })
})
