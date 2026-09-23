import { describe, it, expect } from 'vitest'
const ShipinhaoAdapter = require('../src/adapters/shipinhao.js')
const { ShipinhaoVideoChain } = require('../src/publish/platforms/shipinhao-video.js')

describe('shipinhao tencent_video adapter (§4.4 变薄委托 ShipinhaoVideoChain，纯逻辑/转发)', () => {
  const a = new ShipinhaoAdapter()

  it('外部契约：name 保持 tencent_video（不随链内部 platform 改名）', () => {
    expect(a.name).toBe('tencent_video')
    expect(a.getReferer()).toBe('https://channels.weixin.qq.com/platform/post/create')
    expect(a.getOrigin()).toBe('https://channels.weixin.qq.com')
  })

  it('_chain 默认构造 ShipinhaoVideoChain，透传 cookie/UA/apiBase + finderIds', () => {
    const c = a._chain('sessionid=abc', null, { finderId: 'FID1', finderUin: 'UIN1' })
    expect(c).toBeInstanceOf(ShipinhaoVideoChain)
    expect(c.cookie).toBe('sessionid=abc')
    expect(c.userAgent).toBeTruthy()
    expect(c.finderId).toBe('FID1')
    expect(c.finderUin).toBe('UIN1')
  })

  it('buildPostData 委托链纯函数：media.videoId 取 uploadId、url 取 videoInfo、description 取 content、finderIds 透传', () => {
    const td = { title: 'T', content: '正文C', finderId: 'FID1', finderUin: 'UIN1', video: { width: 1080, height: 1920, duration: 12 } }
    const pd = a.buildPostData(td, { video: { uploadId: 'VID_UPLOAD_1', videoInfo: { url: 'https://v.qq.com/x.mp4' } } })
    expect(pd.description).toBe('正文C')
    expect(pd.media.videoId).toBe('VID_UPLOAD_1')
    expect(pd.media.url).toBe('https://v.qq.com/x.mp4')
    expect(pd.media.width).toBe(1080)
    expect(pd.media.height).toBe(1920)
    expect(pd._log_finder_id).toBe('FID1')
    expect(pd._log_finder_uin).toBe('UIN1')
    expect(pd.scene).toBe(7)
    expect(pd.reqScene).toBe(7)
  })

  it('buildPostData content 缺失回退 title；无 finderUin 回退 finderId', () => {
    const pd = a.buildPostData({ title: '只有标题', finderId: 'FID1' }, {})
    expect(pd.description).toBe('只有标题')
    expect(pd.media.videoId).toBe('')
    expect(pd._log_finder_uin).toBe('FID1')
    expect(pd._log_finder_id).toBe('FID1')
  })

  it('publish 委托新链并强制正式发布（draft:false → post_create），platform 映射回 tencent_video', async () => {
    let seen = null
    a._chainOverride = { publish: async (postData, opts) => { seen = { postData, opts }; return { success: true, platform: 'shipinhao', publishId: 'POST1' } } }
    try {
      const r = await a.publish('sessionid=x', { description: 'd' })
      expect(r.success).toBe(true)
      expect(r.publishId).toBe('POST1')
      expect(r.platform).toBe('tencent_video')
      expect(seen.opts).toEqual({ draft: false })
      expect(seen.postData).toEqual({ description: 'd' })
    } finally { delete a._chainOverride }
  })

  it('§4.4 委托契约：uploadVideo 无任务/无视频路径时返回 null（空上传零请求，不抛）', async () => {
    expect(await a.uploadVideo(null, 'sessionid=x', null)).toBeNull()
    expect(await a.uploadVideo({}, 'sessionid=x', null)).toBeNull()
    expect(await a.uploadVideo({ video: {} }, 'sessionid=x', null)).toBeNull()
  })

  it('§4.4 委托契约：uploadVideo 视频文件不存在时抛 SPH_NO_FILE（fail-closed 零请求）', async () => {
    let err = null
    try { await a.uploadVideo({ video: { path: 'D:\\no\\such\\file.mp4' } }, 'sessionid=x', null) } catch (e) { err = e }
    expect(err).not.toBeNull()
    expect(err.code).toBe('SPH_NO_FILE')
  })

  it('uploadCover 返回 null（视频号封面由抽帧，无独立上传链）', async () => {
    expect(await a.uploadCover({}, 'sessionid=x', null)).toBeNull()
  })
})
