// §4.1 DouyinAdapter 变薄委托 DouyinVideoChain 契约测试（对齐 shipinhao-adapter.test.js 形态）
// 全用例零外发：dryRun / fail-closed 直接返回；真实链行为经 _chainOverride 假链覆盖。
const DouyinAdapter = require('../src/adapters/douyin.js')
const { DouyinVideoChain } = require('../src/publish/platforms/douyin-video.js')
const { errorCode } = require('../src/error-codes.js')

describe('douyin adapter (§4.1 变薄委托 DouyinVideoChain)', () => {
  const a = new DouyinAdapter()

  it('外部契约：name=douyin / getReferer / getOrigin', () => {
    expect(a.name).toBe('douyin')
    expect(a.getReferer()).toBe('https://creator.douyin.com/creator-micro/content/upload')
    expect(a.getOrigin()).toBe('https://creator.douyin.com')
  })

  it('_chain 默认构造 DouyinVideoChain，透传 cookie/UA；_chainOverride 优先返回假链', () => {
    const c = a._chain('sid_tt=abc; ttwid=x')
    expect(c).toBeInstanceOf(DouyinVideoChain)
    expect(c.cookie).toBe('sid_tt=abc; ttwid=x')
    expect(c.userAgent).toBeTruthy()
    const fake = { run: async () => ({ success: true }) }
    a._chainOverride = fake
    try {
      expect(a._chain('whatever')).toBe(fake)
    } finally { delete a._chainOverride }
  })

  it('execute dryRun 返回非 null 且零请求（{success,dryRun,platform}）', async () => {
    const r = await a.execute(null, null, { dryRun: true })
    expect(r).not.toBeNull()
    expect(r.success).toBe(true)
    expect(r.dryRun).toBe(true)
    expect(r.platform).toBe('douyin')
  })

  it('execute 无 cookie → fail-closed（data_error），不触网', async () => {
    const r = await a.execute({ title: 'T', video: { path: 'D:\\x.mp4' } }, null, {})
    expect(r.success).toBe(false)
    expect(r.code).toBe(errorCode.data_error)
    expect(r.platform).toBe('douyin')
  })

  it('execute 缺 video.path → fail-closed（data_error）', async () => {
    const r1 = await a.execute({}, 'cookie=x', {})
    expect(r1.success).toBe(false)
    expect(r1.code).toBe(errorCode.data_error)
    const r2 = await a.execute({ video: {} }, 'cookie=x', {})
    expect(r2.success).toBe(false)
    expect(r2.code).toBe(errorCode.data_error)
  })

  it('execute 成功归一：链 run 返回 publishId/mode → 补 code=success', async () => {
    let seenTd = null
    a._chainOverride = { run: async (td) => { seenTd = td; return { success: true, publishId: 'AWEME1', mode: 'api' } } }
    try {
      const r = await a.execute({ title: 'T', content: 'C', video: { path: 'D:\\x.mp4' } }, 'cookie=x', {})
      expect(r.success).toBe(true)
      expect(r.publishId).toBe('AWEME1')
      expect(r.mode).toBe('api')
      expect(r.code).toBe(errorCode.success)
      expect(r.platform).toBe('douyin')
      expect(seenTd).toBeTruthy()
    } finally { delete a._chainOverride }
  })

  it('execute 失败归一：链 run 返回 success:false 无 code → 补 request_error', async () => {
    a._chainOverride = { run: async () => ({ success: false, error: 'boom' }) }
    try {
      const r = await a.execute({ title: 'T', video: { path: 'D:\\x.mp4' } }, 'cookie=x', {})
      expect(r.success).toBe(false)
      expect(r.code).toBe(errorCode.request_error)
    } finally { delete a._chainOverride }
  })

  it('execute 链抛异常带 code/risk_blocked → catch 归一并透传 risk_blocked', async () => {
    const err = new Error('风控拦截'); err.code = errorCode.request_error; err.risk_blocked = true
    a._chainOverride = { run: async () => { throw err } }
    try {
      const r = await a.execute({ title: 'T', video: { path: 'D:\\x.mp4' } }, 'cookie=x', {})
      expect(r.success).toBe(false)
      expect(r.code).toBe(errorCode.request_error)
      expect(r.risk_blocked).toBe(true)
      expect(r.error).toBe('风控拦截')
    } finally { delete a._chainOverride }
  })

  it('execute 抛异常无 code → unknown_error', async () => {
    a._chainOverride = { run: async () => { throw new Error('x') } }
    try {
      const r = await a.execute({ title: 'T', video: { path: 'D:\\x.mp4' } }, 'cookie=x', {})
      expect(r.success).toBe(false)
      expect(r.code).toBe(errorCode.unknown_error)
    } finally { delete a._chainOverride }
  })

  it('granular 契约（统一入口）：uploadVideo 空任务/无路径返回 null、uploadCover 返回 null（零请求）', async () => {
    expect(await a.uploadVideo({}, '')).toBeNull()
    expect(await a.uploadVideo({ video: {} }, '')).toBeNull()
    expect(await a.uploadVideo(null, '')).toBeNull()
    expect(await a.uploadCover({}, '')).toBeNull()
  })

  it('buildPostData 委托链纯函数：item.common.video_id 取 video.videoId、item.cover.poster 取 cover.poster', () => {
    const pd = a.buildPostData({ title: 'T', content: 'C' }, { video: { videoId: 'V1' }, cover: { poster: 'P1' } })
    expect(pd.item.common.video_id).toBe('V1')
    expect(pd.item.common.item_title).toBe('T')
    expect(pd.item.cover.poster).toBe('P1')
    expect(pd.item.common.media_type).toBe(4)
  })
})
