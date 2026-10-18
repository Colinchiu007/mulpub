/**
 * toutiao-adapter-routing.test.js — 头条适配器「按内容类型分流」契约
 * （toutiao-video-api，2026-10-18）
 *
 * 背景：`ToutiaoAdapter` 此前只有图文（`/api/article/publish`），`uploadVideo` 返回 null，
 * 头条视频任务只能走 DOM 轨。本轮补视频 API 轨后，必须在适配器层按内容类型分流，
 * 且**不得**把视频任务误送到图文端点（那会拿 `/api/article/publish` 发一个没有视频的文章，
 * 是「静默错发」，比失败更糟）。
 *
 * 本套件钉三件事：
 * ① 有 `video.path` ⇒ 走 `_videoChain().run()`，且**不**触达 `publish()`（图文端点）；
 * ② 无 `video.path` ⇒ 仍走原有图文路径（不回归）；
 * ③ 缺 cookie / dryRun 的 fail-closed 与短路语义不变。
 */
const ToutiaoAdapter = require('../src/adapters/toutiao')

function makeFakeChain (result) {
  const calls = []
  return {
    calls,
    run: async (td, opts) => { calls.push({ td, opts }); return result || { success: true, platform: 'toutiao', publishId: 'VID_PUB' } },
  }
}

describe('ToutiaoAdapter — 按内容类型分流（视频 API 轨）', () => {
  let adapter
  let publishSpy

  beforeEach(() => {
    adapter = new ToutiaoAdapter()
    // 图文端点打桩：若视频任务误触达这里，用例会红
    publishSpy = vi.fn(async () => ({ success: true, platform: 'toutiao', publishId: 'ARTICLE_1' }))
    adapter.publish = publishSpy
  })

  it('有 video.path ⇒ 走视频链 run()，且绝不触达图文 publish()', async () => {
    const chain = makeFakeChain()
    adapter._videoChainOverride = chain
    const r = await adapter.execute({ video: { path: 'D:/v.mp4' }, title: 'T' }, 'sessionid=S; uid_tt=1')
    expect(chain.calls.length).toBe(1)
    expect(publishSpy).not.toHaveBeenCalled()
    expect(r).toMatchObject({ success: true, platform: 'toutiao' })
  })

  it('视频链收到的 taskData 保真（video.path 与 title 不被改写）', async () => {
    const chain = makeFakeChain()
    adapter._videoChainOverride = chain
    await adapter.execute({ video: { path: 'D:/a/b.mp4' }, title: '标题原样', content: '正文原样' }, 'sessionid=S; uid_tt=1')
    expect(chain.calls[0].td.video.path).toBe('D:/a/b.mp4')
    expect(chain.calls[0].td.title).toBe('标题原样')
    expect(chain.calls[0].td.content).toBe('正文原样')
  })

  it('无 video.path ⇒ 仍走图文路径（不回归），且不构造视频链', async () => {
    const chain = makeFakeChain()
    adapter._videoChainOverride = chain
    await adapter.execute({ title: 'T', content: '正文' }, 'sessionid=S')
    expect(chain.calls.length).toBe(0)
    // 图文路径最终会调 publish()（super.execute → publish）
    expect(publishSpy).toHaveBeenCalled()
  })

  it('dryRun ⇒ 直接返回 dryRun 结果，不构造视频链也不发请求', async () => {
    const chain = makeFakeChain()
    adapter._videoChainOverride = chain
    const r = await adapter.execute({ video: { path: 'D:/v.mp4' } }, 'sessionid=S', { dryRun: true })
    expect(r).toMatchObject({ success: true, dryRun: true, platform: 'toutiao' })
    expect(chain.calls.length).toBe(0)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('视频任务缺 cookie ⇒ fail-closed，不构造视频链（零请求）', async () => {
    const chain = makeFakeChain()
    adapter._videoChainOverride = chain
    const r = await adapter.execute({ video: { path: 'D:/v.mp4' } }, null)
    expect(r.success).toBe(false)
    expect(r.platform).toBe('toutiao')
    expect(String(r.error)).toContain('账号信息缺失')
    expect(chain.calls.length).toBe(0)
  })

  it('视频链抛错 ⇒ 归一成失败结果，不冒泡', async () => {
    adapter._videoChainOverride = {
      run: async () => { const e = new Error('vod apply 无 UploadNodes'); e.code = -1; throw e },
    }
    const r = await adapter.execute({ video: { path: 'D:/v.mp4' } }, 'sessionid=S')
    expect(r.success).toBe(false)
    expect(String(r.error)).toContain('UploadNodes')
    expect(r.code).toBe(-1)
  })

  it('onProgress 透传给视频链', async () => {
    const chain = makeFakeChain()
    adapter._videoChainOverride = chain
    const onProgress = vi.fn()
    await adapter.execute({ video: { path: 'D:/v.mp4' } }, 'sessionid=S', { onProgress })
    expect(chain.calls[0].opts.onProgress).toBe(onProgress)
  })

  it('适配器身份与平台端点不变（不破坏既有调用方）', () => {
    expect(adapter.getReferer()).toBe('https://mp.toutiao.com/profile_v4/')
    expect(adapter.getOrigin()).toBe('https://mp.toutiao.com')
  })
})
