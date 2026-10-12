// @ts-check
/**
 * 平台适配器回归（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §7.1 T5–T8）
 *
 * 夹具用**真实响应形态**（取自竞品逆向产物里各平台的字段名与嵌套层级），
 * 因为这一层的风险恰好在「字段名不同 ≠ 语义相同」：
 *   快手列表给的是 followCount（涨粉量）不是分享数；抖音/头条列表根本不返回收藏数。
 * 把这些顶替成别的字段，用户看到的就是**假数据**，比 `-` 更糟。
 */
import { describe, it, expect } from 'vitest'

const {
  getAdapter, supportedPlatforms, toCount, pickCount, epochToIso,
} = require('./adapters')

describe('平台适配器注册面', () => {
  it('T8 四个平台已注册；未注册平台返回 null（不抛错，交由编排层记 unsupported）', () => {
    expect(supportedPlatforms().sort()).toEqual(['douyin', 'kuaishou', 'toutiao', 'xiaohongshu'])
    expect(getAdapter('wechat_mp')).toBeNull()
    expect(getAdapter('')).toBeNull()
    expect(getAdapter(undefined)).toBeNull()
  })

  it('T7 requiredCookieNames 声明了会话 Cookie，供编排层在发请求前判 needs_login（V2）', () => {
    expect(getAdapter('xiaohongshu').requiredCookieNames).toContain('web_session')
    expect(getAdapter('kuaishou').requiredCookieNames).toContain('kuaishou.web.cp.api_ph')
    // 抖音/头条未声明必需项（平台未给出稳定的会话 Cookie 名），编排层只要求「有 Cookie」
    expect(getAdapter('douyin').requiredCookieNames).toEqual([])
    expect(getAdapter('toutiao').requiredCookieNames).toEqual([])
  })

  it('小红书声明需要签名器；取不到签名器时编排层降级 unsupported 而不是硬发', () => {
    expect(getAdapter('xiaohongshu').requiresSigner).toBe('xiaohongshu')
    expect(getAdapter('douyin').requiresSigner).toBeNull()
  })
})

describe('toCount / pickCount 量纲归一（V10）', () => {
  it('T6 只接受有限非负数；其余一律 null —— 0 是「平台说是 0」，null 是「没这个字段」', () => {
    expect(toCount(0)).toBe(0)
    expect(toCount(123)).toBe(123)
    expect(toCount('456')).toBe(456)
    expect(toCount(12.9)).toBe(12)
    expect(toCount(null)).toBeNull()
    expect(toCount(undefined)).toBeNull()
    expect(toCount('')).toBeNull()
    expect(toCount(-1)).toBeNull()
    expect(toCount(NaN)).toBeNull()
    expect(toCount(Infinity)).toBeNull()
    // 本地化字符串不猜（"1.2万" 猜成 12000 或 1.2 都是错的）
    expect(toCount('1.2万')).toBeNull()
    expect(toCount('abc')).toBeNull()
  })

  it('T6b pickCount 取第一个可解析值；全不可解析返回 null（不回落 0）', () => {
    expect(pickCount(null, undefined, 7)).toBe(7)
    expect(pickCount(0, 9)).toBe(0)
    expect(pickCount(null, undefined, '')).toBeNull()
  })
})

describe('小红书适配器', () => {
  const adapter = getAdapter('xiaohongshu')

  it('T5 解析 datacenter/note/analyze/list 的真实响应形态', () => {
    const json = {
      data: {
        page_size: 10,
        note_infos: [
          { id: 'note-1', title: '标题一', read_count: 1200, like_count: 34, comment_count: 5, fav_count: 6, share_count: 7, post_time: 1760000000 },
          { id: 'note-2', title: '标题二', read_count: 80, like_count: 1, comment_count: 0, fav_count: 0, share_count: 0, post_time: 1760100000 },
        ],
      },
    }
    const out = adapter.parseList(json)
    expect(out.items).toHaveLength(2)
    expect(out.items[0].postId).toBe('note-1')
    expect(out.items[0].metrics).toEqual({ views: 1200, likes: 34, comments: 5, favorites: 6, shares: 7 })
    // 满页 ⇒ 认为还有下一页
    expect(out.hasMore).toBe(false)
  })

  it('T5b 满 page_size 条数 ⇒ hasMore 为真（分页推进依据）', () => {
    const notes = Array.from({ length: 10 }, (_, i) => ({ id: 'n' + i, read_count: 1 }))
    const out = adapter.parseList({ data: { page_size: 10, note_infos: notes } })
    expect(out.items).toHaveLength(10)
    expect(out.hasMore).toBe(true)
  })

  it('T6c 无 postId 的条目被丢弃（拼不出链接也不该记账）', () => {
    const out = adapter.parseList({ data: { page_size: 10, note_infos: [{ title: 'x', read_count: 1 }] } })
    expect(out.items).toEqual([])
  })

  it('结构不符时抛错（编排层据此记 failed，不得返回空数组冒充「这个账号没作品」）', () => {
    expect(() => adapter.parseList({ data: {} })).toThrow(/note_infos/)
  })

  it('buildListRequest 产出真实端点与页码制参数', () => {
    const req = adapter.buildListRequest({ cursor: '2', pageSize: 10 })
    expect(req.method).toBe('GET')
    expect(req.url).toContain('creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/analyze/list')
    expect(req.url).toContain('page_num=2')
    expect(req.url).toContain('page_size=10')
    expect(req.headers.Referer).toContain('creator.xiaohongshu.com')
  })
})

describe('抖音适配器', () => {
  const adapter = getAdapter('douyin')

  it('T5 解析 aweme/post 的 statistics 嵌套', () => {
    const json = {
      aweme_list: [
        {
          aweme_id: '7300000000000000001',
          desc: '抖音标题',
          create_time: 1760000000,
          statistics: { play_count: 5000, digg_count: 120, comment_count: 8, share_count: 3 },
        },
      ],
      has_more: 1,
      max_cursor: 1699999999999,
    }
    const out = adapter.parseList(json)
    expect(out.items[0].postId).toBe('7300000000000000001')
    expect(out.items[0].metrics.views).toBe(5000)
    expect(out.items[0].metrics.likes).toBe(120)
    expect(out.items[0].metrics.comments).toBe(8)
    expect(out.items[0].metrics.shares).toBe(3)
    expect(out.hasMore).toBe(true)
    expect(out.nextCursor).toBe('1699999999999')
  })

  it('T6 抖音列表不返回收藏数 ⇒ favorites 为 null，不得拿别的字段顶替', () => {
    const out = adapter.parseList({ aweme_list: [{ aweme_id: 'a1', statistics: { play_count: 1, digg_count: 2, comment_count: 3 } }] })
    expect(out.items[0].metrics.favorites).toBeNull()
    expect(out.items[0].metrics.views).toBe(1)
  })

  it('has_more 缺失 ⇒ 不再翻页（不猜还有下一页）', () => {
    const out = adapter.parseList({ aweme_list: [{ aweme_id: 'a1', statistics: {} }] })
    expect(out.hasMore).toBe(false)
    expect(out.nextCursor).toBeNull()
  })

  it('结构不符时抛错', () => {
    expect(() => adapter.parseList({ status_code: 0 })).toThrow(/aweme_list/)
  })

  it('T2b 业务码 status_code=8（登录态失效）⇒ 抛错带 needsLogin，编排层据此记 needs_login 而不是 failed', () => {
    let err = null
    try { adapter.parseList({ status_code: 8, status_msg: '未登录' }) } catch (e) { err = e }
    expect(err).toBeTruthy()
    expect(err.needsLogin).toBe(true)
  })
})

describe('快手适配器', () => {
  const adapter = getAdapter('kuaishou')

  it('T5 解析 photoList.photoItems（POST JSON，页码制）', () => {
    const json = {
      data: {
        photoList: {
          pcursor: 'CURSOR-2',
          photoItems: [
            { photoId: 'ks-1', title: '快手作品', playCount: 900, likeCount: 20, commentCount: 4, collectCount: 2, followCount: 1, publishTime: 1760000000 },
          ],
        },
      },
    }
    const out = adapter.parseList(json)
    expect(out.items[0].postId).toBe('ks-1')
    expect(out.items[0].metrics).toEqual({ views: 900, likes: 20, comments: 4, favorites: 2, shares: null })
    expect(out.hasMore).toBe(true)
  })

  it('T5b 页码制关键锁：响应里的 pcursor 不得被当作游标回灌（回灌会让每轮都请求 page=0 ⇒ 只拿到第一页）', () => {
    const json = { data: { photoList: { pcursor: 'CURSOR-2', photoItems: [{ photoId: 'p1' }] } } }
    const parsed = adapter.parseList(json)
    // nextCursor 必须是 null（让编排层按页码自增）
    expect(parsed.nextCursor).toBeNull()
    // 端到端 round-trip：第 0 页的响应喂回去，下一页请求的 page 必须前进而不是回到 0
    const next = adapter.buildListRequest({ cursor: String(Number('0') + 1), pageSize: 10 })
    expect(next.body.page).toBe(1)
    // 反向反证：若把 pcursor 当游标用（旧实现），buildListRequest 会得到 page=0 ⇒ 与第一页重复
    const wrong = adapter.buildListRequest({ cursor: parsed.nextCursor === null ? '0' : parsed.nextCursor, pageSize: 10 })
    expect(wrong.body.page).toBe(0)
  })

  it('T6 快手给的是涨粉量(followCount)不是分享数 ⇒ shares 为 null，不顶替', () => {
    const out = adapter.parseList({ data: { photoList: { pcursor: '', photoItems: [{ photoId: 'p', followCount: 99 }] } } })
    expect(out.items[0].metrics.shares).toBeNull()
  })

  it('buildListRequest 是 POST + JSON body（该端点是 POST，写成 GET 会 405）', () => {
    const req = adapter.buildListRequest({ cursor: '1', pageSize: 10 })
    expect(req.method).toBe('POST')
    expect(req.url).toBe('https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/list')
    expect(req.body).toMatchObject({ page: 1, count: 10 })
    expect(req.headers['Content-Type']).toContain('application/json')
  })

  it('结构不符时抛错', () => {
    expect(() => adapter.parseList({ data: {} })).toThrow(/photoItems/)
  })
})

describe('头条号适配器', () => {
  const adapter = getAdapter('toutiao')

  it('T5 解析 contents[].article_attr/article_stat', () => {
    const json = {
      size: 20,
      contents: [
        {
          article_attr: { gid: '7400000000000000001', title: '头条标题', create_time: 1760000000 },
          article_stat: { impression_count: 9999, play_count: 3000, digg_count: 45, comment_count: 6 },
        },
      ],
    }
    const out = adapter.parseList(json)
    expect(out.items[0].postId).toBe('7400000000000000001')
    expect(out.items[0].metrics).toEqual({ views: 3000, likes: 45, comments: 6, favorites: null, shares: null })
  })

  it('T6b 头条不返回播放数 ⇒ views 为 null，**不得**回落展现量 impression_count（语义不同、会让图文系统性偏大）', () => {
    const out = adapter.parseList({ contents: [{ article_attr: { gid: 'g1' }, article_stat: { impression_count: 500, digg_count: 3 } }] })
    expect(out.items[0].metrics.views).toBeNull()
    expect(out.items[0].metrics.likes).toBe(3)
  })

  it('T6c 头条列表不返回收藏 ⇒ null（即使 article_stat 里没有该键也不补 0）', () => {
    const out = adapter.parseList({ contents: [{ article_attr: { gid: 'g2' }, article_stat: {} }] })
    expect(out.items[0].metrics).toEqual({ views: null, likes: null, comments: null, favorites: null, shares: null })
  })

  it('buildListRequest 带 need_stat=true（不带就拿不到 stat 字段）', () => {
    const req = adapter.buildListRequest({ cursor: '0', pageSize: 20 })
    expect(req.url).toContain('mp/agw/creator_center/list')
    expect(req.url).toContain('need_stat=true')
    expect(req.url).toContain('size=20')
  })

  it('结构不符时抛错', () => {
    expect(() => adapter.parseList({ code: 1 })).toThrow(/contents/)
  })
})

describe('epochToIso 时间归一', () => {
  it('秒/毫秒都能识别；不可信时间返回空串（不伪造成「现在」）', () => {
    expect(epochToIso(1760000000)).toBe(new Date(1760000000 * 1000).toISOString())
    expect(epochToIso(1760000000000)).toBe(new Date(1760000000000).toISOString())
    expect(epochToIso('2026-10-01T00:00:00.000Z')).toBe('2026-10-01T00:00:00.000Z')
    expect(epochToIso('')).toBe('')
    expect(epochToIso(null)).toBe('')
    expect(epochToIso(0)).toBe('')
    expect(epochToIso(1)).toBe('')
    expect(epochToIso('not-a-date')).toBe('')
    // 未来时间不可信
    expect(epochToIso(Math.floor(Date.now() / 1000) + 10 * 24 * 3600)).toBe('')
  })
})
