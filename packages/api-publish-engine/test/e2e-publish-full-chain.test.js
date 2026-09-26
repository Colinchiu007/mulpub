import { describe, it, expect, beforeEach, vi } from 'vitest'
import BaijiahaoAdapter from '../src/adapters/baijiahao.js'
import KuaishouAdapter from '../src/adapters/kuaishou.js'

function mockHttp(adapter, handlers) {
  const calls = []
  adapter.http.post = vi.fn(async (url, body, opts) => {
    calls.push({ method: 'post', url, body, opts })
    const h = handlers.post && handlers.post(url, body, opts)
    return h || { data: {} }
  })
  adapter.http.get = vi.fn(async (url, opts) => {
    calls.push({ method: 'get', url, opts })
    const h = handlers.get && handlers.get(url, opts)
    return h || { data: {} }
  })
  return calls
}

const COOKIE = 'BAIDUID=ABC; BDUSS=XYZ; kuaishou.web.cp.api_ph=PH123'

vi.mock('../src/signer.js', () => ({
  getKuaishouSignature: vi.fn().mockResolvedValue({ signature: 'SIG_E2E' }),
}))

// 百家号（§4.4 由旧视频链改委托新文章链 BaijiahaoArticleChain）：
// 适配器 execute 委托链 run，链级 HTTP/token/风控/标题截断契约在
// baijiahao-article-chain.test.js（本机假 HTTP 服务器）完整覆盖；
// 此处只验「委托接线」（execute → chain.run，私密草稿优先、缺标题 fail-closed、AI 声明透传）。
function fakeArticleChain (captured) {
  return {
    async run (taskData, opts) {
      captured.taskData = taskData
      captured.opts = opts
      return { success: true, draft: !(opts && opts.draft === false), publishId: 'ARTICLE_E2E', platform: 'baijiahao' }
    },
  }
}

describe('E2E 百家号 API 发布全链路（委托文章链）', () => {
  let adapter
  beforeEach(() => { adapter = new BaijiahaoAdapter() })

  it('execute 委托文章链 run，私密草稿优先，返回 publishId', async () => {
    const captured = {}
    adapter._chainOverride = fakeArticleChain(captured)
    const result = await adapter.execute({
      title: 'E2E 测试', content: 'E2E 内容', tags: ['测试'],
    }, COOKIE, { timeout: 300000 })
    expect(result.success).toBe(true)
    expect(result.platform).toBe('baijiahao')
    expect(result.publishId).toBe('ARTICLE_E2E')
    expect(captured.opts.draft).toBe(true)
  })

  it('execute 透传 aiGenerated=false 给文章链（is_checked 由链表单决定）', async () => {
    const captured = {}
    adapter._chainOverride = fakeArticleChain(captured)
    await adapter.execute({ title: '人工', aiGenerated: false }, COOKIE)
    expect(captured.taskData.aiGenerated).toBe(false)
  })

  it('execute 缺标题 → 失败且不调用链（fail-closed 零请求）', async () => {
    let called = false
    adapter._chainOverride = { async run () { called = true; return { success: true } } }
    const result = await adapter.execute({ content: '无标题' }, COOKIE)
    expect(result.success).toBe(false)
    expect(result.error).toContain('缺少标题')
    expect(called).toBe(false)
  })

  it('buildPostData 委托文章链表单（含 aigc_bjh_status + 标题字节截断 ≤149）', () => {
    const fd = new BaijiahaoAdapter().buildPostData({
      title: '这是一个非常长的标题'.repeat(5), content: '测试', tags: [],
    })
    const decoded = decodeURIComponent(fd)
    expect(decoded).toContain('activity_list[0][id]=aigc_bjh_status')
    expect(decoded).toContain('type=news')
    const titlePart = /title=([^&]*)/.exec(fd)[1]
    expect(Buffer.byteLength(decodeURIComponent(titlePart), 'utf8')).toBeLessThanOrEqual(149)
  })
})

// 快手（W3 §5.3 变薄委托）：适配器 execute 委托单体链 KuaishouVideoChain.run，
// 链级 HTTP/求签/风控契约在 kuaishou-video-chain.test.js（本机假 HTTP 服务器）完整覆盖；
// 旧骨架 publish() + 远程签名拼参路径已下线，此处只验「委托接线」。
function fakeVideoChain (captured) {
  return {
    async run (taskData, opts) {
      captured.taskData = taskData
      captured.opts = opts
      return { success: true, mode: 'api', publishId: 'KS_VIDEO_E2E', platform: 'kuaishou' }
    },
  }
}

describe('E2E 快手 API 发布全链路（委托视频链）', () => {
  let adapter
  beforeEach(() => { adapter = new KuaishouAdapter() })

  it('buildPostData 默认 AI 生成（ai_generated=1）', () => {
    const postData = adapter.buildPostData({ title: 'E2E 快手', content: 'AI 生成', tags: ['测试'] })
    expect(postData.ai_generated).toBe(1)
    expect(postData.caption).toBe('E2E 快手\nAI 生成\n#测试')
  })

  it('execute 委托视频链 run，返回 publishId', async () => {
    const captured = {}
    adapter._chainOverride = fakeVideoChain(captured)
    const result = await adapter.execute({
      title: 'E2E 快手', content: 'AI 生成', tags: ['测试'],
      video: { path: __filename },
    }, COOKIE)
    expect(result.success).toBe(true)
    expect(result.platform).toBe('kuaishou')
    expect(result.publishId).toBe('KS_VIDEO_E2E')
  })

  it('execute 透传 aiGenerated=false 给视频链', async () => {
    const captured = {}
    adapter._chainOverride = fakeVideoChain(captured)
    await adapter.execute({ title: '人工', aiGenerated: false, video: { path: __filename } }, COOKIE)
    expect(captured.taskData.aiGenerated).toBe(false)
  })

  it('链返回失败（内容违规）→ 透传错误消息', async () => {
    adapter._chainOverride = {
      async run () { return { success: false, platform: 'kuaishou', error: '内容违规' } },
    }
    const result = await adapter.execute({ title: 'test', video: { path: __filename } }, COOKIE)
    expect(result.success).toBe(false)
    expect(result.error).toContain('违规')
  })

  it('缺 cookie → data_error 且不调链（fail-closed 零请求）', async () => {
    let called = false
    adapter._chainOverride = { async run () { called = true; return { success: true } } }
    const result = await adapter.execute({ title: 't', video: { path: __filename } }, '')
    expect(result.success).toBe(false)
    expect(called).toBe(false)
  })
})

describe('E2E 跨平台 AI 声明一致性', () => {
  it('百家号和快手默认都声明 AI 生成', () => {
    const bj = new BaijiahaoAdapter().buildPostData({ title: 't', content: 'c', tags: [] })
    const ks = new KuaishouAdapter().buildPostData({ title: 't', content: 'c' })
    expect(bj).toContain('activity_list%5B0%5D%5Bis_checked%5D=1')
    expect(ks.ai_generated).toBe(1)
  })
})
