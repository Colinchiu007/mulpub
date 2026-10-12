/**
 * creator-adapters-web.test.js — 多平台采集器行为锁（PRD §9 锁 2/3/4/5/6）
 *
 * 用注入式 httpGet/signBridge/sessionProvider 覆盖真实路径，不依赖网络与登录态。
 * 三条必须由测试钉死的纪律：
 *   ① 无会话 → credential_missing 且**零网络请求**；
 *   ② 签名失败/风控 → signature_failed，**绝不返回空列表**；
 *   ③ external_id 只取端点真 ID 字段，取不到的条目被丢弃（不是「补个假 ID」）。
 */
const { createMultiPlatformCollector, toPost, isSignatureBlocked } = require('./creator-adapters-web')

const DOUYIN_SEC_UID = 'MS4wLjABAAAA' + 'A'.repeat(28)
const XHS_USER_ID = 'b'.repeat(24)

function makeDeps (over = {}) {
  const calls = { sign: [], http: [], sessions: [] }
  const deps = {
    sessionProvider: async (platform) => {
      calls.sessions.push(platform)
      return { cookieString: `sessionid=abc; a1=x`, accountId: 'acc-1', a1: 'x', b1: 'y' }
    },
    signBridge: async (platform, payload) => {
      calls.sign.push({ platform, ...payload })
      if (platform === 'douyin') return { a_bogus: 'bogus123' }
      return { x_s: 's', x_t: '1', x_s_common: 'c', x_b3_traceid: 't' }
    },
    httpGet: async (url, params, opts) => {
      calls.http.push({ url, params, opts })
      if (over.httpResponse) return over.httpResponse
      if (url.includes('douyin.com')) {
        return { status: 200, body: JSON.stringify({ aweme_list: over.douyinList || [], has_more: 0, next_max_cursor: 0 }) }
      }
      return { status: 200, body: JSON.stringify({ code: 0, data: { notes: over.xhsList || [], has_more: false, cursor: '' } }) }
    },
    log: { info () {}, warn () {}, error () {} },
    ...over.deps,
  }
  return { deps, calls }
}

describe('creator-adapters-web · 会话前置（零请求原则）', () => {
  it('无会话 → credential_missing，且不发任何请求、不调签名', async () => {
    const { deps, calls } = makeDeps({
      deps: { sessionProvider: async () => null },
    })
    const c = createMultiPlatformCollector(deps)
    await expect(c.listPosts('douyin', DOUYIN_SEC_UID)).rejects.toMatchObject({ code: 'creator:credential_missing' })
    expect(calls.http).toHaveLength(0)
    expect(calls.sign).toHaveLength(0)
  })

  it('hasSession 探测：有会话 true / 无会话 false（零网络）', async () => {
    const a = makeDeps()
    const c1 = createMultiPlatformCollector(a.deps)
    await expect(c1.hasSession('douyin')).resolves.toBe(true)
    const b = makeDeps({ deps: { sessionProvider: async () => null } })
    const c2 = createMultiPlatformCollector(b.deps)
    await expect(c2.hasSession('xiaohongshu')).resolves.toBe(false)
    expect(b.calls.http).toHaveLength(0)
    expect(c2.hasSession('youtube')).resolves.toBe(false)
  })
})

describe('creator-adapters-web · 抖音 listPosts', () => {
  it('请求带 sec_user_id + a_bogus 签名 + Cookie，响应归一为 Post[]', async () => {
    const { deps, calls } = makeDeps({
      douyinList: [{
        aweme_id: 'v1', desc: '视频描述',
        create_time: 1728700000,
        video: { cover: { url_list: ['https://p.douyinpic.com/cover.jpg'] } },
        statistics: { digg_count: 5, comment_count: 2, share_count: 1 },
      }],
    })
    const c = createMultiPlatformCollector(deps)
    const r = await c.listPosts('douyin', DOUYIN_SEC_UID, { cursor: 0 })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({
      externalId: 'v1',
      url: 'https://www.douyin.com/video/v1',
      thumbnailUrl: 'https://p.douyinpic.com/cover.jpg',
      contentQuality: 'stub',
    })
    expect(calls.sign[0].platform).toBe('douyin')
    expect(calls.sign[0].query_str).toContain('sec_user_id=' + DOUYIN_SEC_UID)
    expect(calls.http[0].params.headers.Cookie).toContain('sessionid=abc')
    expect(calls.http[0].url).toContain('a_bogus=bogus123')
  })

  it('缺 aweme_id 的条目被丢弃（不造假 ID）', async () => {
    const { deps } = makeDeps({ douyinList: [{ desc: 'no id' }, { aweme_id: 'ok', desc: 'x' }] })
    const c = createMultiPlatformCollector(deps)
    const r = await c.listPosts('douyin', DOUYIN_SEC_UID, {})
    expect(r.items).toHaveLength(1)
    expect(r.items[0].externalId).toBe('ok')
  })

  it('签名头缺失（桥返回空）→ signature_failed，不裸请求', async () => {
    const { deps } = makeDeps({
      deps: { signBridge: async () => ({}) },
    })
    const c = createMultiPlatformCollector(deps)
    await expect(c.listPosts('douyin', DOUYIN_SEC_UID)).rejects.toMatchObject({ code: 'creator:signature_failed' })
  })

  it.each([
    [403, 'HTTP 403'],
    [461, 'HTTP 461'],
  ])('端点 HTTP %i → signature_failed（不静默返回空列表）', async (status) => {
    const { deps } = makeDeps({ httpResponse: { status, body: 'Signature Not Found' } })
    const c = createMultiPlatformCollector(deps)
    await expect(c.listPosts('douyin', DOUYIN_SEC_UID)).rejects.toMatchObject({ code: 'creator:signature_failed' })
  })
})

describe('creator-adapters-web · 小红书 listPosts', () => {
  it('user_posted 端点 + X-S 系列签名头', async () => {
    const { deps, calls } = makeDeps({
      xhsList: [{
        note_id: 'note1',
        note_card: { display_title: '标题', cover: { url_list: ['https://sns-img.com/c.jpg'] }, interact_info: { liked_count: '9' } },
      }],
    })
    const c = createMultiPlatformCollector(deps)
    const r = await c.listPosts('xiaohongshu', XHS_USER_ID, {})
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ externalId: 'note1', url: 'https://www.xiaohongshu.com/explore/note1' })
    expect(calls.http[0].params.headers['X-S']).toBe('s')
    expect(calls.http[0].params.headers['X-S-Common']).toBe('c')
    expect(calls.http[0].url).toContain('user_id=' + XHS_USER_ID)
  })

  it('code=-100（登录态失效）→ credential_missing（不是 signature_failed）', async () => {
    const { deps } = makeDeps({ httpResponse: { status: 200, body: JSON.stringify({ code: -100, msg: 'login required' }) } })
    const c = createMultiPlatformCollector(deps)
    await expect(c.listPosts('xiaohongshu', XHS_USER_ID)).rejects.toMatchObject({ code: 'creator:credential_missing' })
  })

  it('code=其它 → signature_failed', async () => {
    const { deps } = makeDeps({ httpResponse: { status: 200, body: JSON.stringify({ code: 300015 }) } })
    const c = createMultiPlatformCollector(deps)
    await expect(c.listPosts('xiaohongshu', XHS_USER_ID)).rejects.toMatchObject({ code: 'creator:signature_failed' })
  })
})

describe('creator-adapters-web · 归一化与签名判定纯函数', () => {
  it('toPost：抖音/小红书都拒绝无 ID 条目', () => {
    expect(toPost('douyin', { desc: 'x' })).toBeNull()
    expect(toPost('xiaohongshu', { note_card: { display_title: 'x' } })).toBeNull()
  })

  it('isSignatureBlocked 判据：403/461/406 或 Signature 字样', () => {
    expect(isSignatureBlocked(403, '')).toBe(true)
    expect(isSignatureBlocked(200, 'Signature Not Found')).toBe(true)
    expect(isSignatureBlocked(200, '{"code":0}')).toBe(false)
  })
})
