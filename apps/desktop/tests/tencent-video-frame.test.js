'use strict'

/**
 * tencent-video-frame 的行为锁（2026-10-22）
 * 真机：编辑器在子 frame /micro/content/post/create 内；短标题上限 16 字。
 */
const { CONTENT_FRAME_HINT, findContentFrame } = require('../electron/services/tencent-video-frame')

describe('tencent-video-frame', () => {
  it('子 frame 提示串与真机一致', () => {
    expect(CONTENT_FRAME_HINT).toBe('/micro/content/post/create')
  })

  it('findContentFrame 命中子 frame', () => {
    const win = { webContents: { mainFrame: { frames: [
      { url: 'https://channels.weixin.qq.com/platform/post/create' },
      { url: 'https://channels.weixin.qq.com/micro/content/post/create' },
    ] } } }
    const f = findContentFrame(win)
    expect(f && f.url).toContain('/micro/content/post/create')
  })

  it('没有子 frame 时返回 null（不抛）', () => {
    const win = { webContents: { mainFrame: { frames: [] } } }
    expect(findContentFrame(win)).toBe(null)
  })
})
