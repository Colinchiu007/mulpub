import { describe, it, expect } from 'vitest'
const BilibiliAdapter = require('../src/adapters/bilibili.js')

describe('bilibili Tier-A upos adapter (pure logic)', () => {
  const a = new BilibiliAdapter()

  it('_buildBase 解析新式 upos://bucket/object + endpoint(//host)', () => {
    const { base, objectPath } = a._buildBase({
      endpoint: '//upos-cs-upcdnbda2.bilivideo.com',
      upos_uri: 'upos://ugcever/n260923abc.mp4',
    })
    expect(base).toBe('https://upos-cs-upcdnbda2.bilivideo.com/ugcever/n260923abc.mp4')
    expect(objectPath).toBe('/ugcever/n260923abc.mp4')
  })

  it('_buildBase 兼容 //host/path 旧格式', () => {
    const { base } = a._buildBase({ endpoint: '', upos_uri: '//upos-host/ugc/x.mp4' })
    expect(base).toBe('https://upos-host/ugc/x.mp4')
  })

  it('buildPostData 产出 add/v3 精确 schema：videos=[{cid:biz_id, filename 去扩展名去 bucket}]', () => {
    const td = { title: '标题T', content: '正文C', tags: ['热点', { name: '资讯' }], category: 21 }
    const body = a.buildPostData(td, { video: { objBase: 'n260923abc', bizId: 42125099949 } })
    expect(body.tid).toBe(21)
    expect(body.copyright).toBe(1)
    expect(body.tag).toBe('热点,资讯')
    expect(body.videos).toHaveLength(1)
    expect(body.videos[0].cid).toBe(42125099949)
    expect(body.videos[0].filename).toBe('n260923abc')
    // 绝不应包含已废弃的 file / format 字段（21015 根因）
    expect(body.videos[0].file).toBeUndefined()
    expect(body.videos[0].format).toBeUndefined()
  })

  it('buildPostData 默认分区回退 21', () => {
    const body = a.buildPostData({ title: 'x' }, { video: { objBase: 'k', bizId: 0 } })
    expect(body.tid).toBe(21)
    expect(body.videos[0].cid).toBe(0)
  })

  it('publish 在 code=0 时返回 bvid 作为 publishId（不联网，注入桩 http）', async () => {
    a.http = { post: async () => ({ data: { code: 0, data: { bvid: 'BV1TEST', aid: 123 } } }) }
    const r = await a.publish('bili_jct=abcdef0123456789abcdef01; DedeUserID=999', { tid: 21 })
    expect(r.success).toBe(true)
    expect(r.publishId).toBe('BV1TEST')
    expect(r.url).toBe('https://www.bilibili.com/video/BV1TEST')
  })

  it('回归：简介/正文绝不携带「自动发布」水印（_cleanText 去括号 boilerplate）', () => {
    const td = {
      title: '汪顺400混的含金量（由多平台一键发布工具自动发布）',
      content: '汪顺400混的含金量\n（由多平台一键发布工具自动发布）',
    }
    const body = a.buildPostData(td, { video: { objBase: 'k', bizId: 1 } })
    const forbidden = ['自动发布', '一键发布工具', '由多平台']
    for (const f of forbidden) {
      expect(body.title).not.toContain(f)
      expect(body.desc).not.toContain(f)
    }
    expect(body.title).toBe('汪顺400混的含金量')
    expect(body.desc).toBe('汪顺400混的含金量')
  })
})
