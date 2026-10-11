// @ts-check
/**
 * publish-record-cover.test.js — 发布历史记录封面字段解析（回归锁）
 *
 * 缺陷背景（2026-10-12 用户报障）：发布历史页的缩略图**显示的是平台图标**，
 * 不是本次发布实际使用的封面。根因不在渲染端——`PublishHistory.vue` 的
 * `thumbnailUrl(record)` 读 `thumbnail|thumbnailUrl|cover|coverUrl`，而两个落库点
 * （`bootstrap/phase4-events.js` 的 task:success / task:failed）调 `history.addRecord()`
 * 时**一个封面键都没写**，于是该表达式恒为空、模板回退平台图标。
 *
 * 本文件锁的是「写侧」的取值契约：本次发布到底用了哪张封面。
 * 判据必须单一真源——两个落库点各写一份优先级，漂移的方向必然是
 * 「成功记录有封面、失败记录没有」（用户恰恰要在失败记录里看封面）。
 */
const { resolveRecordCover, isLocalImagePath } = require('./publish-record-cover')

describe('publish-record-cover — 封面取值优先级', () => {
  it('① 用户显式选择的本地封面优先，且清空远程 URL（互斥）', () => {
    // 互斥不是本模块的发明：`publish-upload-file.js` 的 `resolveCoverFields` 已确立
    // 「本地封面胜出时清空 URL，残留 URL 不得遮蔽用户刚选中的文件」。
    // 记录里保留两个非空值会让消费端的优先级规则重新变成两处判据。
    expect(resolveRecordCover({
      cover_path: 'D:/covers/picked.png',
      cover_url: 'https://example.com/remote.png',
      images: ['D:/img/first.png'],
    })).toEqual({
      cover_path: 'D:/covers/picked.png',
      cover_url: '',
    })
  })

  it('② cover_path 缺失时取 cover_file.path（描述符形态的同一张图）', () => {
    expect(resolveRecordCover({
      cover_file: { path: 'D:/covers/descriptor.png', name: 'a.png' },
      images: ['D:/img/first.png'],
    })).toEqual({
      cover_path: 'D:/covers/descriptor.png',
      cover_url: '',
    })
  })

  it('③ 只有远程封面 URL 时落 cover_url，且 cover_path 为空串', () => {
    expect(resolveRecordCover({ cover_url: 'https://example.com/c.png' }))
      .toEqual({ cover_path: '', cover_url: 'https://example.com/c.png' })
  })

  it('④ 都没有时退回首图（首图即封面型平台：快手 / 小红书）', () => {
    expect(resolveRecordCover({ images: ['D:/img/first.png', 'D:/img/second.png'] }))
      .toEqual({ cover_path: 'D:/img/first.png', cover_url: '' })
  })

  it('⑤ 全空时两个键都是空串（不得是 undefined——JSON 会丢键）', () => {
    const r = resolveRecordCover({})
    expect(r).toEqual({ cover_path: '', cover_url: '' })
    expect(Object.keys(JSON.parse(JSON.stringify(r))).sort()).toEqual(['cover_path', 'cover_url'])
  })

  it('非法入参不抛错，返回空值对', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(resolveRecordCover(bad)).toEqual({ cover_path: '', cover_url: '' })
    }
  })

  it('cover_path 是远程 URL 字符串时不当作本地路径（回退到 cover_url 语义）', () => {
    const r = resolveRecordCover({ cover_path: 'https://example.com/a.png' })
    // 本地键必须真的是本地路径；URL 只能进 cover_url
    expect(r.cover_path).toBe('')
    expect(r.cover_url).toBe('https://example.com/a.png')
  })

  it('🔴 非 http(s) 的 cover_url 被丢弃（javascript: / data: / 相对路径）', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAA', '/local/x.png', 'example.com/a.png', '  ']) {
      expect(resolveRecordCover({ cover_url: bad })).toEqual({ cover_path: '', cover_url: '' })
    }
  })

  it('images 里的非本地路径（远程 URL）不得进 cover_path，可取为 cover_url', () => {
    const r = resolveRecordCover({ images: ['https://cdn.example.com/a.png'] })
    expect(r.cover_path).toBe('')
    expect(r.cover_url).toBe('https://cdn.example.com/a.png')
  })

  it('前后空白被裁剪；空白串视为缺失', () => {
    expect(resolveRecordCover({ cover_path: '  D:/c/a.png  ' }).cover_path).toBe('D:/c/a.png')
    expect(resolveRecordCover({ images: ['  D:/img/b.png  '] }).cover_path).toBe('D:/img/b.png')
    // 空白 cover_path 视为缺失 → 回退首图；空白首图视为无封面（只认 images[0]，不向后扫）
    expect(resolveRecordCover({ cover_path: '   ', images: ['  '] })).toEqual({ cover_path: '', cover_url: '' })
  })

  it('只认 images[0] 作首图封面（不向后扫，避免把正文插图当封面）', () => {
    expect(resolveRecordCover({ images: ['  ', 'D:/img/second.png'] }))
      .toEqual({ cover_path: '', cover_url: '' })
  })
})

describe('publish-record-cover — 本地路径判据', () => {
  it('认得盘符 / 正反斜杠绝对路径 / file:// / UNC', () => {
    expect(isLocalImagePath('D:/c/a.png')).toBe(true)
    expect(isLocalImagePath('D:\\c\\a.png')).toBe(true)
    expect(isLocalImagePath('C:/Users/x/a.jpg')).toBe(true)
    expect(isLocalImagePath('\\\\server\\share\\a.png')).toBe(true)
    expect(isLocalImagePath('file:///D:/c/a.png')).toBe(true)
  })

  it('相对路径与 URL 不算本地路径', () => {
    expect(isLocalImagePath('covers/a.png')).toBe(false)
    expect(isLocalImagePath('./a.png')).toBe(false)
    expect(isLocalImagePath('https://x/a.png')).toBe(false)
    expect(isLocalImagePath('data:image/png;base64,AA')).toBe(false)
    expect(isLocalImagePath('')).toBe(false)
    expect(isLocalImagePath(null)).toBe(false)
  })
})
