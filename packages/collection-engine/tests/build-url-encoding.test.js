import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const {
  ZhihuAdapter, BilibiliAdapter, XiaohongshuAdapter, DouyinAdapter,
} = req('../src/index.js')

/**
 * P2 安全小项：buildUrl 的 id 必须 URL 编码（体检报告 §安全小项）
 *
 * 原写法把 target.bvid / aid / noteId / videoId 直接拼进 URL。这些 id 来自上游
 * 链接解析（用户粘贴的分享文案、爬虫抓到的 href），只要含 `&` `#` `?` 或 `/`
 * 就能改写请求语义：
 *   bvid = "BV1&aid=123456"      → 多塞一个 aid 参数，命中另一条视频
 *   bvid = "BV1#x"               → 截断查询串
 *   noteId = "abc/../../evil"    → 越到别的路由路径
 * 编码不改变正常 id 的结果（`BV1xx411c7mD` 编码后不变），因此是纯收紧。
 */

function queryOf (url) {
  return [...new URL(url).searchParams.entries()]
}

describe('BilibiliAdapter.buildUrl 编码', () => {
  const a = new BilibiliAdapter()

  it('正常 bvid / aid 结果不变（回归保护）', () => {
    expect(a.buildUrl({ bvid: 'BV1xx411c7mD' })).toContain('bvid=BV1xx411c7mD')
    expect(a.buildUrl({ aid: '12345' })).toContain('aid=12345')
  })

  it('bvid 里的 & 不会新增查询参数', () => {
    const url = a.buildUrl({ bvid: 'BV1&aid=999' })
    expect(queryOf(url)).toEqual([['bvid', 'BV1&aid=999']])
  })

  it('bvid 里的 # 不会截断查询串', () => {
    const url = a.buildUrl({ bvid: 'BV1#frag' })
    expect(url).not.toContain('#')
    expect(queryOf(url)).toEqual([['bvid', 'BV1#frag']])
  })

  it('aid 注入额外参数同样被编码', () => {
    expect(queryOf(a.buildUrl({ aid: '1?x=2' }))).toEqual([['aid', '1?x=2']])
  })

  it('数字型 id 也可接受（调用方常传 Number）', () => {
    expect(queryOf(a.buildUrl({ aid: 12345 }))).toEqual([['aid', '12345']])
  })
})

describe('其它适配器 buildUrl 编码', () => {
  it('知乎：qid/aid 不得越出 /question/{qid}/answer/{aid} 路径', () => {
    const url = new ZhihuAdapter().buildUrl({ qid: '1/../../x', aid: '2?y=3' })
    expect(url.startsWith('https://www.zhihu.com/question/')).toBe(true)
    expect(url).not.toContain('?')
    expect(new URL(url).pathname.split('/').filter(Boolean)).toEqual(['question', '1%2F..%2F..%2Fx', 'answer', '2%3Fy%3D3'])
  })

  it('小红书：noteId 含斜杠不会跳到别的资源路径', () => {
    const url = new XiaohongshuAdapter().buildUrl({ noteId: 'abc/explore2' })
    expect(new URL(url).pathname).toBe('/explore/abc%2Fexplore2')
  })

  it('抖音：videoId 含 # 不会截断 URL', () => {
    const url = new DouyinAdapter().buildUrl({ videoId: 'v1#x' })
    expect(url).not.toContain('#')
    expect(new URL(url).pathname).toBe('/video/v1%23x')
  })

  it('字符串 target 视为完整链接，原样返回（既有契约不变）', () => {
    expect(new DouyinAdapter().buildUrl('https://www.douyin.com/video/abc')).toBe('https://www.douyin.com/video/abc')
  })
})
