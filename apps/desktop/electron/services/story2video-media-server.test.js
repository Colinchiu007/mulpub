// @vitest-environment node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  STORY2VIDEO_MEDIA_PATH,
  Story2VideoMediaServer,
} = require('./story2video-media-server')

describe('Story2Video 本机媒体流服务', () => {
  let root
  let mediaPath
  let server

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-media-server-'))
    mediaPath = path.join(root, 'result.mp4')
    fs.writeFileSync(mediaPath, '0123456789')
    server = new Story2VideoMediaServer()
  })

  afterEach(async () => {
    await server.stop()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('生成不泄露本地路径的回环 URL，并支持媒体 Range 请求', async () => {
    await server.start()
    const url = server.createUrl(mediaPath)
    const response = await fetch(url, { headers: { Range: 'bytes=2-5' } })

    expect(url).toMatch(new RegExp('^http://127\\.0\\.0\\.1:\\d+' + STORY2VIDEO_MEDIA_PATH + '[A-Za-z0-9_-]{16,}$'))
    expect(url).not.toContain(mediaPath)
    expect(url).not.toContain(path.basename(root))
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(await response.text()).toBe('2345')
  })

  it('图片文件返回正确的 image/* Content-Type（分段编辑区图片可显示）', async () => {
    await server.start()
    const imagePath = path.join(root, 'segment.png')
    fs.writeFileSync(imagePath, 'fake-png-bytes')
    const url = server.createUrl(imagePath)
    const response = await fetch(url)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('jpg/jpeg/webp 均映射为 image/* Content-Type', async () => {
    await server.start()
    for (const [name, expected] of [['a.jpg', 'image/jpeg'], ['b.jpeg', 'image/jpeg'], ['c.webp', 'image/webp']]) {
      const filePath = path.join(root, name)
      fs.writeFileSync(filePath, 'fake')
      const response = await fetch(server.createUrl(filePath))
      expect(response.headers.get('content-type')).toBe(expected)
    }
  })

  it('拒绝未知、过期和含额外参数的令牌请求', async () => {
    let now = 100
    await server.stop()
    server = new Story2VideoMediaServer({ now: () => now, tokenTtlMs: 10 })
    await server.start()
    const url = server.createUrl(mediaPath)
    const origin = new URL(url).origin

    expect((await fetch(origin + STORY2VIDEO_MEDIA_PATH + 'aaaaaaaaaaaaaaaa')).status).toBe(404)
    expect((await fetch(url + '?path=' + encodeURIComponent(mediaPath))).status).toBe(404)
    now += 10
    expect((await fetch(url)).status).toBe(404)
  })

  it('在服务停止后撤销令牌且不再监听端口', async () => {
    await server.start()
    const url = server.createUrl(mediaPath)

    await server.stop()

    expect(server.size).toBe(0)
    await expect(fetch(url)).rejects.toThrow()
  })

  it('拒绝未启动服务、相对路径和无效 Range', async () => {
    expect(() => server.createUrl(mediaPath)).toThrow(/未启动/)
    await server.start()
    expect(() => server.createUrl('relative.mp4')).toThrow(/绝对路径/)
    const url = server.createUrl(mediaPath)
    const response = await fetch(url, { headers: { Range: 'bytes=100-200' } })

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
  })

  it('在容量达到上限时淘汰最早令牌', async () => {
    const tokens = [
      'aaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccc',
    ]
    await server.stop()
    server = new Story2VideoMediaServer({
      maxEntries: 2,
      tokenFactory: () => tokens.shift(),
    })
    await server.start()
    const first = server.createUrl(mediaPath)
    const second = server.createUrl(mediaPath)
    const third = server.createUrl(mediaPath)

    expect(server.size).toBe(2)
    expect((await fetch(first)).status).toBe(404)
    expect((await fetch(second)).status).toBe(200)
    expect(server.revoke(third)).toBe(true)
    expect(server.size).toBe(1)
  })

  // ── 2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.1：令牌容量必须容纳一个整页大任务 ──
  //
  // 现场：169 段任务每段最多 5 个媒体位（image1/image2/video1/video2/audio）⇒ 最多 845 个
  // 回环 URL。旧容量 128 会在展开到约 26 段时开始 FIFO 淘汰 ⇒ 较早分段的图变 404 ⇒
  // 渲染端 @error 兜底把它显示成「未生成」——正是用户最初抱怨的「破图」形态回来了。
  it('默认容量足以容纳 169 段任务的全部媒体位（845 个 URL 不被淘汰）', async () => {
    // 用一个自增 tokenFactory 造 845 个唯一令牌，全部指向同一个真实文件
    let seq = 0
    await server.stop()
    server = new Story2VideoMediaServer({
      tokenFactory: () => 't' + String(seq++).padStart(23, '0'),
    })
    await server.start()

    const urls = []
    for (let i = 0; i < 845; i += 1) urls.push(server.createUrl(mediaPath))

    // 一个都没被淘汰
    expect(server.size).toBe(845)
    // 首个与最后一个是同一路径的不同令牌，二者都必须可访问
    expect((await fetch(urls[0])).status).toBe(200)
    expect((await fetch(urls[844])).status).toBe(200)
  })

  it('访问即续期：令牌在活跃使用时不因固定 15 分钟到期而失效', async () => {
    // 现场：用户在 169 段编辑页停留超过 15 分钟 ⇒ 全部令牌被 _pruneExpired 清空 ⇒
    // 图片整片变「未生成」。修法是滑动过期：每次成功命中就把 expiresAt 往后推。
    let now = 0
    const tokens = ['dddddddddddddddddddd']
    await server.stop()
    server = new Story2VideoMediaServer({
      tokenTtlMs: 1000,
      now: () => now,
      tokenFactory: () => tokens.shift(),
    })
    await server.start()
    const url = server.createUrl(mediaPath)

    // 每 800ms 访问一次，累计远超 TTL(1000ms)
    for (let i = 0; i < 5; i += 1) {
      now += 800
      expect((await fetch(url)).status).toBe(200)
    }

    // 续期确实发生：最后一次访问后 900ms（< TTL）仍可用
    now += 900
    expect((await fetch(url)).status).toBe(200)

    // 但停止使用超过 TTL 后必须失效（滑动过期不等于永不过期）
    now += 1200
    expect((await fetch(url)).status).toBe(404)
  })

  it('续期不改变容量上限：活跃访问不会让已淘汰令牌复活', async () => {
    let now = 0
    const tokens = [
      'eeeeeeeeeeeeeeeeeeee',
      'ffffffffffffffffffff',
    ]
    await server.stop()
    server = new Story2VideoMediaServer({
      maxEntries: 1,
      tokenTtlMs: 1000,
      now: () => now,
      tokenFactory: () => tokens.shift(),
    })
    await server.start()
    const first = server.createUrl(mediaPath)
    expect((await fetch(first)).status).toBe(200)

    // 第二次 createUrl 触发容量淘汰 ⇒ first 被删
    const second = server.createUrl(mediaPath)
    expect(server.size).toBe(1)
    now += 100
    expect((await fetch(first)).status).toBe(404)
    expect((await fetch(second)).status).toBe(200)
  })
})
