'use strict'

/**
 * 回归锁（2026-10-23）：视频号作品列表在子 iframe 内
 *
 * 真机症状：artifact 判据报 post-list-timeout:textLen=15，
 * 而 15 恰是壳页文本「视频号 · 助手 9 退出登录」的长度 ——
 * 说明判据只读了顶层壳页，标题渲染在子 frame 里，永远读不到。
 */
const { confirmPublished } = require('../electron/services/tencent-artifact')

/** 构造一个多 frame 的假窗口：主 frame 是壳页，子 frame 是作品列表 */
function fakeWinWithFrames (frames) {
  return {
    webContents: {
      loadURL: async () => {},
      executeJavaScript: async () => ({ hit: false, len: 0 }),
      mainFrame: { framesInSubtree: frames },
    },
  }
}

describe('tencent-artifact 跨 frame 读取', () => {
  it('壳页无标题、子 frame 有标题 ⇒ 应判成功', async () => {
    const shell = { executeJavaScript: async () => ({ hit: false, len: 15 }) }
    const listFrame = { executeJavaScript: async () => ({ hit: true, len: 800 }) }
    const win = fakeWinWithFrames([shell, listFrame])
    const r = await confirmPublished(win, '被误解的明朝', { timeoutMs: 2000, intervalMs: 10 })
    expect(r.ok).toBe(true)
    expect(r.evidence).toBe('post-list-dom')
  })

  it('所有 frame 都没有标题 ⇒ 必须判失败（不得假成功）', async () => {
    const shell = { executeJavaScript: async () => ({ hit: false, len: 15 }) }
    const other = { executeJavaScript: async () => ({ hit: false, len: 120 }) }
    const win = fakeWinWithFrames([shell, other])
    const r = await confirmPublished(win, '不存在的标题', { timeoutMs: 60, intervalMs: 10 })
    expect(r.ok).toBe(false)
    expect(r.evidence).toBe('not-found')
  })

  it('frame 执行抛错时其余 frame 仍被读取', async () => {
    const broken = { executeJavaScript: async () => { throw new Error('frame detached') } }
    const listFrame = { executeJavaScript: async () => ({ hit: true, len: 500 }) }
    const win = fakeWinWithFrames([broken, listFrame])
    const r = await confirmPublished(win, '标题Y', { timeoutMs: 2000, intervalMs: 10 })
    expect(r.ok).toBe(true)
  })
})
