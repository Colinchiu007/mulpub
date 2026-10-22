'use strict'

/**
 * 回归锁（2026-10-23）：头条视频走 API 轨、图文走 RPA 轨
 *
 * 背景：ROUTE_TABLE.toutiao 写死 rpa_vm，而仓库已有实网抓包实现的
 * toutiao-video-publish（经 api-publish-engine 的 publishViaApi 可达）。
 * RPA 在真机反复因页面时序失败，故视频改走 API。
 */
const { PublisherRouter } = require('./publisher-router')

const deps = { store: null, accountManager: null }

describe('publisher-router 头条内容分流', () => {
  it('头条 + 视频 ⇒ ApiPublisher', () => {
    const r = new PublisherRouter()
    const p = r.createPublisher('toutiao', { ...deps, contentType: 'video' })
    expect(p.constructor.name).toBe('ApiPublisher')
  })

  it('头条 + 图文 ⇒ 仍走 RPA（RpaVmPublisher）', () => {
    const r = new PublisherRouter()
    const p = r.createPublisher('toutiao', { ...deps, contentType: 'image' })
    expect(p.constructor.name).toBe('RpaVmPublisher')
  })

  it('未传 contentType 时保持原行为（RPA）', () => {
    const r = new PublisherRouter()
    const p = r.createPublisher('toutiao', { ...deps })
    expect(p.constructor.name).toBe('RpaVmPublisher')
  })
})
