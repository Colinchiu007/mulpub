import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import crypto from 'crypto'

const req = createRequire(import.meta.url)
const { BilibiliAdapter } = req('../src/platform-adapters/bilibili-adapter')
const { BaseAdapter } = req('../src/platform-adapters/base-adapter')
const { generateWbiSign } = req('../src/platform-adapters/bilibili-adapter')

/** 造一个 fetch stub，记录被调用的 URL */
function stubFetch (payload, opts = {}) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    if (opts.throw) throw Object.assign(new Error('net down'), { code: opts.code })
    return {
      status: opts.status || 200,
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    }
  }
  return { fn, calls }
}

const fakeBrowser = (html, title) => ({
  goto: async () => {},
  evaluate: async (fn) => (fn.toString().includes('document.title') ? title : html),
})

describe('P1-9 BilibiliAdapter 真发请求', () => {
  it('API 分支必须真的发 HTTP 请求并返回真实内容', async () => {
    const { fn, calls } = stubFetch({ code: 0, data: { title: '视频标题', desc: '这是简介正文' } })
    const a = new BilibiliAdapter({ http: fn })
    a.setWbiKeys('abcdefghijklmnopqrstuvwxyz123456', 'abcdefghijklmnopqrstuvwxyz654321')
    const resp = await a._doFetch(a.buildUrl({ bvid: 'BV1xx411c7mD' }), {})
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('w_rid=')
    expect(calls[0].url).toContain('wts=')
    expect(calls[0].init.headers.Referer).toBe('https://www.bilibili.com/')
    const content = a.extractContent(resp)
    expect(content.title).toBe('视频标题')
    expect(content.text).toBe('这是简介正文')
  })

  it('禁止返回写死的空壳假成功（桩实现回归）', async () => {
    const { fn } = stubFetch({ code: 0, data: { title: '真标题', desc: '真简介' } })
    const a = new BilibiliAdapter({ http: fn })
    a.setWbiKeys('abcdefghijklmnopqrstuvwxyz123456', 'abcdefghijklmnopqrstuvwxyz654321')
    const resp = await a._doFetch('https://api.bilibili.com/x/web-interface/view?bvid=BV1xx', {})
    expect(resp.json.data.title).toBe('真标题')
    expect(resp.body).not.toBe('')
  })

  it('API 空壳 + 有浏览器 → 回落浏览器取真实 HTML', async () => {
    const { fn, calls } = stubFetch({ code: 0, data: { title: '', desc: '' } })
    const a = new BilibiliAdapter({ http: fn })
    a._browser = fakeBrowser('<html><body>B站页面正文内容</body></html>', '页面标题')
    a.setWbiKeys('abcdefghijklmnopqrstuvwxyz123456', 'abcdefghijklmnopqrstuvwxyz654321')
    const resp = await a._doFetch('https://api.bilibili.com/x/web-interface/view?bvid=BV1xx', {})
    expect(calls).toHaveLength(1)
    expect(resp.body).toContain('B站页面正文内容')
  })

  it('API 抛错 + 无浏览器 → 抛给 collect（不得吞成 200）', async () => {
    const { fn } = stubFetch(null, { throw: true, code: 'ETIMEDOUT' })
    const a = new BilibiliAdapter({ http: fn })
    a.setWbiKeys('abcdefghijklmnopqrstuvwxyz123456', 'abcdefghijklmnopqrstuvwxyz654321')
    await expect(a._doFetch('https://api.bilibili.com/x/web-interface/view?bvid=BV1xx', {}))
      .rejects.toThrow('net down')
  })

  it('collect：空壳响应上报 success:false / reason:empty_content', async () => {
    const { fn } = stubFetch({ code: 0, data: { title: '', desc: '' } })
    const a = new BilibiliAdapter({ http: fn })
    a.setWbiKeys('abcdefghijklmnopqrstuvwxyz123456', 'abcdefghijklmnopqrstuvwxyz654321')
    const r = await a.collect({ bvid: 'BV1xx411c7mD' }, 'acc1')
    expect(r.success).toBe(false)
    expect(r.reason).toBe('empty_content')
  })

  it('collect：真实内容上报 success:true', async () => {
    const { fn } = stubFetch({ code: 0, data: { title: '标题', desc: '正文' } })
    const a = new BilibiliAdapter({ http: fn })
    a.setWbiKeys('abcdefghijklmnopqrstuvwxyz123456', 'abcdefghijklmnopqrstuvwxyz654321')
    const r = await a.collect({ bvid: 'BV1xx411c7mD' }, 'acc1')
    expect(r.success).toBe(true)
    expect(r.content.text).toBe('正文')
  })

  it('buildUrl 对 bvid/aid 做编码（真发请求后是注入点）', () => {
    const a = new BilibiliAdapter()
    const u = a.buildUrl({ bvid: 'BV1&aid=9&x=' })
    expect(u).not.toContain('&aid=9')
    expect(u).toContain('bvid=BV1%26aid%3D9%26x%3D')
  })
})

describe('P1-9 WBI 签名规范', () => {
  it('wts 必须参与签名（签名字符串含 wts、不含 w_rid）', () => {
    const p = generateWbiSign({ bvid: 'BV1xx' }, 'imgk', 'subk')
    const keys = Object.keys(p).filter(k => k !== 'w_rid').sort()
    const query = keys.map(k => k + '=' + encodeURIComponent(p[k])).join('&')
    const expectSign = crypto.createHash('md5').update(query + 'imgk' + 'subk').digest('hex')
    expect(p.wts).toBeTruthy()
    expect(p.w_rid).toBe(expectSign)
  })

  it('不修改入参对象（纯函数）', () => {
    const input = { bvid: 'BV1xx' }
    generateWbiSign(input, 'i', 's')
    expect(Object.keys(input)).toEqual(['bvid'])
  })
})

describe('P1-9 BaseAdapter 空内容硬约束（全平台）', () => {
  class Stub extends BaseAdapter {
    extractContent () { return { text: '', title: '' } }
    async _doFetch () { return { status: 200, body: '', url: 'u' } }
  }

  it('isEmptyContent 覆盖 null/空串/空白/仅空格标题', () => {
    const b = new Stub({ platform: 'x' })
    expect(b.isEmptyContent(null)).toBe(true)
    expect(b.isEmptyContent('')).toBe(true)
    expect(b.isEmptyContent('   ')).toBe(true)
    expect(b.isEmptyContent({ text: '', title: '' })).toBe(true)
    expect(b.isEmptyContent({ text: '有正文' })).toBe(false)
    expect(b.isEmptyContent({ title: '有标题' })).toBe(false)
  })

  it('空内容不得计入成功，且要退预算 + 记健康度失败', async () => {
    const events = []
    const b = new Stub({ platform: 'stub' })
    b.healthMonitor = { record: (p, a, r) => events.push(['health', r.success, r.reason]) }
    b.circuitBreaker = { isOpen: () => false, recordFailure: () => events.push(['cb-fail']), recordSuccess: () => events.push(['cb-ok']) }
    const r = await b.collect('u', 'acc1')
    expect(r.success).toBe(false)
    expect(r.reason).toBe('empty_content')
    expect(events).toEqual([['health', false, 'empty_content'], ['cb-fail']])
  })
})
