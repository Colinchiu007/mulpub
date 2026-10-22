'use strict'

/**
 * tencent-artifact 的行为锁（2026-10-23）
 * 真机：视频号发布后页面重置为壳页，原「URL/文案变化」判据必 timeout，
 * 因此改用「作品列表出现该标题」作为判据。
 */
const { POST_LIST_URL, confirmPublished } = require('../electron/services/tencent-artifact')

function fakeWin (impl) {
  return { webContents: { executeJavaScript: impl, loadURL: async () => {} } }
}

describe('tencent-artifact', () => {
  it('作品列表 URL 指向 channels 发布者中心', () => {
    expect(POST_LIST_URL).toContain('channels.weixin.qq.com')
    expect(POST_LIST_URL).toContain('/post/list')
  })

  it('空标题直接失败（不导航不求证）', async () => {
    const win = fakeWin(async () => ({ hit: true, len: 100 }))
    const r = await confirmPublished(win, '')
    expect(r.ok).toBe(false)
    expect(r.evidence).toBe('empty-title')
  })

  it('列表出现标题即成功', async () => {
    const win = fakeWin(async () => ({ hit: true, len: 500 }))
    const r = await confirmPublished(win, '被误解的明朝：西方史料里的另一个大明', { timeoutMs: 3000, intervalMs: 10 })
    expect(r.ok).toBe(true)
    expect(r.evidence).toBe('post-list-dom')
  })

  it('列表无标题则失败并带 detail（不假成功）', async () => {
    const win = fakeWin(async () => ({ hit: false, len: 300 }))
    const r = await confirmPublished(win, '不存在的标题', { timeoutMs: 50, intervalMs: 10 })
    expect(r.ok).toBe(false)
    expect(r.evidence).toBe('not-found')
    expect(String(r.detail)).toContain('post-list-timeout')
  })

  it('executeJavaScript 抛错时按失败继续轮询并最终失败', async () => {
    const win = fakeWin(async () => { throw new Error('boom') })
    const r = await confirmPublished(win, '标题X', { timeoutMs: 50, intervalMs: 10 })
    expect(r.ok).toBe(false)
  })
})
