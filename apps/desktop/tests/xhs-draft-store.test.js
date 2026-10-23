'use strict'

const { DB_NAME, STORE_BY_KIND, readDrafts, findDraftByTitle, waitForDraft } = require('../electron/services/xhs-draft-store')

function fakeWin (impl) {
  return { webContents: { executeJavaScript: impl } }
}

describe('xhs-draft-store', () => {
  it('DB 名与仓库映射与真机取证一致', () => {
    expect(DB_NAME).toBe('draft-database-v1')
    expect(STORE_BY_KIND.video).toBe('video-draft')
    expect(STORE_BY_KIND.image).toBe('image-draft')
    expect(STORE_BY_KIND.article).toBe('article-draft')
    expect(STORE_BY_KIND.audio).toBe('audio-draft')
  })

  it('readDrafts 会按 kind 选择对象仓库', async () => {
    let captured = ''
    const win = fakeWin(async (code) => { captured = code; return [{ draftId: 'a', title: 't', timeStamp: 1 }] })
    const list = await readDrafts(win, 'image')
    expect(captured).toContain('"image-draft"')
    expect(list).toHaveLength(1)
  })

  it('findDraftByTitle 命中标题即成功', async () => {
    const win = fakeWin(async () => [
      { draftId: 'd1', title: '别的标题', timeStamp: 1 },
      { draftId: 'd2', title: '被误解的明朝：西方史料里的另一个大明', timeStamp: 2 },
    ])
    const r = await findDraftByTitle(win, '被误解的明朝：西方史料里的另一个大明')
    expect(r.ok).toBe(true)
    expect(r.draftId).toBe('d2')
    expect(r.total).toBe(2)
  })

  it('findDraftByTitle 标题不匹配则失败并给出理由', async () => {
    const win = fakeWin(async () => [{ draftId: 'd1', title: '别的', timeStamp: 1 }])
    const r = await findDraftByTitle(win, '期望标题')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('title-not-found')
  })

  it('空标题时按 baseline 之外的新条目判定', async () => {
    const win = fakeWin(async () => [{ draftId: 'new-1', title: '', timeStamp: 5 }])
    const r = await findDraftByTitle(win, '', { baselineIds: ['old-1'] })
    expect(r.ok).toBe(true)
    expect(r.draftId).toBe('new-1')
  })

  it('空标题且无新条目则失败', async () => {
    const win = fakeWin(async () => [{ draftId: 'old-1', title: '', timeStamp: 5 }])
    const r = await findDraftByTitle(win, '', { baselineIds: ['old-1'] })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no-new-draft')
  })

  it('IDB 不可读时失败并带 err 原因（不得当成成功）', async () => {
    const win = fakeWin(async () => ({ __err: 'SecurityError' }))
    const r = await findDraftByTitle(win, '任意')
    expect(r.ok).toBe(false)
    expect(String(r.reason)).toContain('idb-unreadable')
  })

  it('waitForDraft 轮询到命中即返回，并带 waitedMs', async () => {
    let n = 0
    const win = fakeWin(async () => {
      n++
      return n >= 2 ? [{ draftId: 'x', title: 'T', timeStamp: 1 }] : []
    })
    const r = await waitForDraft(win, 'T', { timeoutMs: 3000, intervalMs: 10 })
    expect(r.ok).toBe(true)
    expect(typeof r.waitedMs).toBe('number')
  })

  it('waitForDraft 超时返回 ok=false（不假成功）', async () => {
    const win = fakeWin(async () => [])
    const r = await waitForDraft(win, 'T', { timeoutMs: 60, intervalMs: 10 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('title-not-found')
  })
})
