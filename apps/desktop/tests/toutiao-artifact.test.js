'use strict'

/**
 * toutiao-artifact 的行为锁（2026-10-22）
 *
 * 真机证据：头条发布后页面不跳转、无成功文案 ⇒ url/api/dom 三种判据全不可用。
 * 唯一可行：查作品列表（逆向成果给出的三个端点）+ 作品管理页 DOM 兜底。
 */

const { LIST_ENDPOINTS, WORKS_PAGE, probeEndpoints, probeWorksPage, confirmPublished } = require('../electron/services/toutiao-artifact')

function fakeWin (impl) {
  return { webContents: { executeJavaScript: impl, loadURL: async () => {} } }
}

describe('toutiao-artifact', () => {
  it('端点清单与逆向成果一致（creator_center/list + statistic item list）', () => {
    expect(LIST_ENDPOINTS).toContain('/mp/agw/creator_center/list/v2')
    expect(LIST_ENDPOINTS).toContain('/mp/agw/creator_center/list')
    expect(LIST_ENDPOINTS).toContain('/mp/agw/statistic/v2/item/list')
    expect(WORKS_PAGE).toContain('mp.toutiao.com')
  })

  it('空标题直接失败，不去打接口', async () => {
    let called = false
    const win = fakeWin(async () => { called = true; return { ok: false, detail: 'empty-title' } })
    const r = await probeEndpoints(win, '')
    expect(r.ok).toBe(false)
    expect(called).toBe(true) // 页面内脚本自己判空
  })

  it('端点命中标题即成功', async () => {
    const win = fakeWin(async () => ({ ok: true, hitEndpoint: '/mp/agw/creator_center/list/v2', detail: 'len=100' }))
    const r = await probeEndpoints(win, '被误解的明朝：西方史料里的另一个大明')
    expect(r.ok).toBe(true)
    expect(r.hitEndpoint).toBe('/mp/agw/creator_center/list/v2')
  })

  it('端点未命中则失败并带原因', async () => {
    const win = fakeWin(async () => ({ ok: false, detail: 'no-endpoint-hit' }))
    const r = await probeEndpoints(win, '标题X')
    expect(r.ok).toBe(false)
    expect(r.detail).toBe('no-endpoint-hit')
  })

  it('executeJavaScript 抛错时按失败处理（不假成功）', async () => {
    const win = fakeWin(async () => { throw new Error('boom') })
    const r = await probeEndpoints(win, '标题X')
    expect(r.ok).toBe(false)
    expect(String(r.detail)).toContain('exec-failed')
  })

  it('confirmPublished 端点命中时 evidence 指向该端点', async () => {
    const win = fakeWin(async () => ({ ok: true, hitEndpoint: '/mp/agw/statistic/v2/item/list', detail: 'len=1' }))
    const r = await confirmPublished(win, '标题X')
    expect(r.ok).toBe(true)
    expect(r.evidence).toContain('/mp/agw/statistic/v2/item/list')
  })

  it('confirmPublished 端点未命中时走作品页兜底并命中', async () => {
    let n = 0
    const win = fakeWin(async () => { n++; return n === 1 ? { ok: false, detail: 'no-endpoint-hit' } : true })
    const r = await confirmPublished(win, '标题X', { timeoutMs: 3000, intervalMs: 10 })
    expect(r.ok).toBe(true)
    expect(r.evidence).toBe('works-page-dom')
  })

  it('两条路都不命中时返回 not-found（不假成功）', async () => {
    const win = fakeWin(async () => false)
    const r = await confirmPublished(win, '标题X', { timeoutMs: 30, intervalMs: 10 })
    expect(r.ok).toBe(false)
    expect(r.evidence).toBe('not-found')
  })
})
