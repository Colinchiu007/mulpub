import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * http-login-checker-profile — 账号资料来源（昵称/头像/粉丝/平台ID）契约
 *
 * 背景（2026-10-22 生产实测，PRD-ACCOUNT-PROFILE-AVATAR-2026-10-22）：
 * 账号页多个平台显示灰色通用头像或平台名，粉丝数全部「暂无数据」。
 * 根因不是「采集能力不存在」，而是**资料通道的契约里根本没有头像这一格**，
 * 且登录判定端点被反向绑死成资料端点（抖音注册的端点只回 `{status_code,uid}`）。
 *
 * 本文件锁住：
 *  1. 每个平台都有资料来源登记（少登记一个平台 = 那个平台永远补不齐资料）；
 *  2. 字段路径与 2026-10-22 **真实服务端实测**一致（不是静态 bundle 推断——
 *     静态推断在小红书/抖音/头条三处都被实测推翻）；
 *  3. 头像真的进了契约（这一格此前根本不存在）；
 *  4. 粉丝数 0 是合法值（不得被当成「没取到」）；
 *  5. 失败不产出字段（键缺席 = 不修改），绝不猜值。
 *
 * 零真实出站：所有响应都是喂进来的 fixture。
 */

describe('http-login-checker 账号资料来源', () => {
  /** @type {any} */
  let checker

  beforeEach(async () => {
    vi.resetModules()
    global.__enableElectronMock()
    global.__resetElectronMock()
    __registerMock('./logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    checker = await import('./http-login-checker.js')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** 按 URL 依次喂响应；未登记的 URL 一律 404 */
  const mockRoutes = (routes) => {
    const f = vi.fn(async (url) => {
      const hit = routes[url]
      if (!hit) return { ok: false, status: 404, text: async () => '', json: async () => null }
      if (typeof hit === 'string') return { ok: true, status: 200, text: async () => hit }
      return { ok: true, status: 200, text: async () => JSON.stringify(hit), json: async () => hit }
    })
    vi.stubGlobal('fetch', f)
    return f
  }

  const cookies = [{ name: 'sid', value: 'v' }]

  // ─── 登记完整性 ───
  it('八个账号管理平台都登记了资料来源', () => {
    for (const platform of ['douyin', 'toutiao', 'bilibili', 'xiaohongshu', 'zhihu', 'wechat_mp', 'tencent_video', 'kuaishou']) {
      expect(Array.isArray(checker.HTTP_PROFILE_APIS[platform]), platform + ' 未登记资料来源').toBe(true)
      expect(checker.HTTP_PROFILE_APIS[platform].length, platform + ' 资料来源为空').toBeGreaterThan(0)
    }
  })

  it('未登记平台的资料查询返回 supported:false（不发请求）', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await checker.fetchAccountInfoViaHttpApi('weibo', cookies)).toEqual({ supported: false })
    expect(f).not.toHaveBeenCalled()
  })

  it('无 cookie 时返回 supported:true 且不产出字段（不发请求）', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await checker.fetchAccountInfoViaHttpApi('douyin', [])).toEqual({ supported: true })
    expect(f).not.toHaveBeenCalled()
  })

  // ─── 抖音：顶层 user 对象（不是 data.user）──
  it('douyin 从顶层 user 取昵称/头像/粉丝/平台ID（实测字段路径）', async () => {
    mockRoutes({
      'https://creator.douyin.com/web/api/media/user/info/': {
        status_code: 0,
        user: {
          nickname: '里奥的吐槽',
          uid: '2232445177172442',
          follower_count: 266,
          avatar_larger: { uri: '1080x1080/aweme-avatar/x', url_list: ['https://p3.douyinpic.com/aweme/1080x1080/aweme-avatar/x.jpeg'] },
        },
      },
    })
    expect(await checker.fetchAccountInfoViaHttpApi('douyin', cookies)).toEqual({
      supported: true,
      nickname: '里奥的吐槽',
      avatar: 'https://p3.douyinpic.com/aweme/1080x1080/aweme-avatar/x.jpeg',
      followers: 266,
      platformAccountId: '2232445177172442',
    })
  })

  it('douyin 头像字段缺失时不产出 avatar 键（不得用占位值顶替）', async () => {
    mockRoutes({
      'https://creator.douyin.com/web/api/media/user/info/': { status_code: 0, user: { nickname: '甲', uid: '1' } },
    })
    const info = await checker.fetchAccountInfoViaHttpApi('douyin', cookies)
    expect('avatar' in info).toBe(false)
    expect(info.nickname).toBe('甲')
  })

  // ─── 今日头条：昵称/头像在 media，粉丝在另一个端点 ──
  it('toutiao 昵称与头像取 data.media，粉丝数取 fans/latest_stat（跨端点合并）', async () => {
    mockRoutes({
      'https://mp.toutiao.com/mp/agw/media/get_media_info': {
        code: 0,
        data: {
          media: { display_name: '观四方', id: '1342958645023752', https_avatar_url: 'https://p6.toutiaoimg.com/img/user-avatar/abc~300x300.image' },
          user: { id: '1342958645023752', screen_name: '观四方' },
        },
      },
      'https://mp.toutiao.com/mp/agw/statistic/v2/fans/latest_stat': {
        data: { fans_stat: { total_fans_count: 369, active_fans_count: 311 } },
      },
    })
    expect(await checker.fetchAccountInfoViaHttpApi('toutiao', cookies)).toEqual({
      supported: true,
      nickname: '观四方',
      avatar: 'https://p6.toutiaoimg.com/img/user-avatar/abc~300x300.image',
      followers: 369,
      platformAccountId: '1342958645023752',
    })
  })

  it('toutiao 粉丝端点失败时昵称与头像仍要产出（单来源失败不牵连其它来源）', async () => {
    mockRoutes({
      'https://mp.toutiao.com/mp/agw/media/get_media_info': {
        code: 0,
        data: { media: { display_name: '观四方', https_avatar_url: 'https://p6.toutiaoimg.com/img/user-avatar/abc~300x300.image' } },
      },
    })
    const info = await checker.fetchAccountInfoViaHttpApi('toutiao', cookies)
    expect(info.nickname).toBe('观四方')
    expect(info.avatar).toBe('https://p6.toutiaoimg.com/img/user-avatar/abc~300x300.image')
    expect('followers' in info).toBe(false)
  })

  // ─── B 站：粉丝端点依赖前一个来源给出的 mid ──
  it('bilibili 昵称/头像取 nav，粉丝取 relation/stat（第二个来源依赖第一个的 mid）', async () => {
    mockRoutes({
      'https://api.bilibili.com/x/web-interface/nav': {
        code: 0,
        data: { uname: '奔跑的丘丘', mid: 3747542357510297, face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg' },
      },
      'https://api.bilibili.com/x/relation/stat?vmid=3747542357510297': { code: 0, data: { follower: 1234, following: 7 } },
    })
    const info = await checker.fetchAccountInfoViaHttpApi('bilibili', [{ name: 'bili_jct', value: 'x' }])
    expect(info.nickname).toBe('奔跑的丘丘')
    expect(info.avatar).toBe('https://i0.hdslb.com/bfs/face/member/noface.jpg')
    expect(info.followers).toBe(1234)
    expect(info.platformAccountId).toBe('3747542357510297')
  })

  it('bilibili 取不到 mid 时跳过依赖它的粉丝来源（不得构造空 vmid 请求）', async () => {
    const f = mockRoutes({
      'https://api.bilibili.com/x/web-interface/nav': { code: 0, data: { uname: '甲' } },
    })
    const info = await checker.fetchAccountInfoViaHttpApi('bilibili', [{ name: 'bili_jct', value: 'x' }])
    expect(info.nickname).toBe('甲')
    expect('followers' in info).toBe(false)
    expect(f.mock.calls.some(c => String(c[0]).includes('relation/stat'))).toBe(false)
  })

  it('bilibili 缺 bili_jct 时 precheck 拦截、不发请求', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await checker.fetchAccountInfoViaHttpApi('bilibili', [{ name: 'SESSDATA', value: 'x' }]))
      .toEqual({ supported: true })
    expect(f).not.toHaveBeenCalled()
  })

  // ─── 小红书：真实字段是 userName / userAvatar（不是 nickname / images）──
  it('xiaohongshu 取 data.userName 与 data.userAvatar（实测字段名）', async () => {
    mockRoutes({
      'https://creator.xiaohongshu.com/api/galaxy/user/info': {
        success: true,
        data: { userName: '小红书', userAvatar: 'https://sns-avatar-qc.xhscdn.com/avatar/abc', userId: '5f1a2b3c00000000002a1b3c', redId: 'zhiaxga1hz' },
      },
      'https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info': {
        success: true,
        data: { name: '小红书', fans_count: 457, follow_count: 102 },
      },
    })
    expect(await checker.fetchAccountInfoViaHttpApi('xiaohongshu', cookies)).toEqual({
      supported: true,
      nickname: '小红书',
      avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/abc',
      followers: 457,
      platformAccountId: '5f1a2b3c00000000002a1b3c',
    })
  })

  it('xiaohongshu 静态 bundle 推断出的 nickname/images 字段不得被当成真字段', async () => {
    mockRoutes({
      'https://creator.xiaohongshu.com/api/galaxy/user/info': {
        success: true,
        data: { nickname: '旧字段名', images: 'https://old/field.png', userName: '真昵称', userAvatar: 'https://new/field.png' },
      },
      'https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info': { success: true, data: {} },
    })
    const info = await checker.fetchAccountInfoViaHttpApi('xiaohongshu', cookies)
    expect(info.nickname).toBe('真昵称')
    expect(info.avatar).toBe('https://new/field.png')
  })

  // ─── 知乎：/api/v4/me ──
  it('zhihu 取 /api/v4/me 的 name 与 avatar_url', async () => {
    mockRoutes({
      'https://www.zhihu.com/api/v4/me': {
        id: '013a4b7c9d2e4f6a8b0c1d2e3f4a5b6c',
        url_token: 'zhiaxga1hz',
        name: '秋叔',
        avatar_url: 'https://picx.zhimg.com/v2-22dfe7094375e34e38695123acd219db_xl.jpg',
        use_default_avatar: false,
      },
    })
    expect(await checker.fetchAccountInfoViaHttpApi('zhihu', cookies)).toEqual({
      supported: true,
      nickname: '秋叔',
      avatar: 'https://picx.zhimg.com/v2-22dfe7094375e34e38695123acd219db_xl.jpg',
      platformAccountId: '013a4b7c9d2e4f6a8b0c1d2e3f4a5b6c',
    })
  })

  // ─── 视频号 ──
  it('tencent_video 取 finderUser 的昵称与粉丝', async () => {
    mockRoutes({
      'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data': {
        errCode: 0,
        data: { finderUser: { uniqId: 'wx1', nickname: '搞艺术的秋叔', fansCount: 50 } },
      },
    })
    const info = await checker.fetchAccountInfoViaHttpApi('tencent_video', cookies)
    expect(info.nickname).toBe('搞艺术的秋叔')
    expect(info.followers).toBe(50)
    expect(info.platformAccountId).toBe('wx1')
  })

  // ─── 公众号：登录态同页 HTML ──
  it('wechat_mp 从登录态 loginpage HTML 取昵称与 uin', async () => {
    mockRoutes({
      'https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome':
        '<html><body><script>var pageData = { uin: "3100000001", nick_name: "数字生命丘丘" };</script></body></html>',
    })
    expect(await checker.fetchAccountInfoViaHttpApi('wechat_mp', cookies)).toEqual({
      supported: true,
      nickname: '数字生命丘丘',
      platformAccountId: '3100000001',
    })
  })

  it('wechat_mp 登录页（未登录形态）不产出昵称与 uid', async () => {
    mockRoutes({
      'https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome':
        '<html><body><div class="login_scanTips">请使用微信扫码</div><script>var pageData = { uin: "", nick_name: "" };</script></body></html>',
    })
    expect(await checker.fetchAccountInfoViaHttpApi('wechat_mp', cookies)).toEqual({ supported: true })
  })

  // 防御测试（CCG 评审 i3）：模板占位值变化时不得把占位当昵称落库。
  it('wechat_mp 模板占位（nick_name 为空或 {{…}}）不得被当成昵称', async () => {
    mockRoutes({
      'https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome':
        '<html><body><script>var pageData = { uin: "", nick_name: "{{nickname}}" };</script></body></html>',
    })
    const info = await checker.fetchAccountInfoViaHttpApi('wechat_mp', cookies)
    expect('nickname' in info).toBe(false)
    expect('platformAccountId' in info).toBe(false)
  })

  // ─── 快手：cookie 型来源，不发网络请求 ──
  it('kuaishou 只从登录后身份 Cookie 派生平台ID（纯本地，零请求）', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const info = await checker.fetchAccountInfoViaHttpApi('kuaishou', [
      { name: 'kuaishou.web.cp.api_st', value: 'ST-123' },
      { name: 'userId', value: '5321009876543' },
    ])
    expect(info.platformAccountId).toBe('5321009876543')
    expect(f).not.toHaveBeenCalled()
  })

  // ─── 登录判定侧的连带修正（资料回填只在「判定有效」时触发）───
  it('小红书：已登录时 HTTP 判定给出确定结论（否则资料回填永不触发）', async () => {
    mockRoutes({
      'https://creator.xiaohongshu.com/api/galaxy/user/info': {
        success: true,
        data: { userId: 'u1', userName: '甲', userAvatar: 'https://sns-avatar-qc.xhscdn.com/avatar/abc' },
      },
    })
    const result = await checker.checkLoginViaHttpApi('xiaohongshu', cookies)
    expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
    expect(checker.isHttpCheckSupported('xiaohongshu')).toBe(true)
  })

  it('小红书：未登录/风控/结构变更一律判「不确定」降级浏览器（不得判失效）', async () => {
    mockRoutes({
      'https://creator.xiaohongshu.com/api/galaxy/user/info': { success: false, code: -101 },
    })
    const result = await checker.checkLoginViaHttpApi('xiaohongshu', cookies)
    expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
  })

  it('抖音：顶层 uid + status_code=0 判有效（旧实现只认 data.data ⇒ 恒不确定）', async () => {
    mockRoutes({
      'https://creator.douyin.com/aweme/v1/creator/pc/user/info/': { status_code: 0, uid: 'u1' },
    })
    const result = await checker.checkLoginViaHttpApi('douyin', cookies)
    expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
  })

  it('抖音：status_code=8 仍判失效（对齐参考产品 checkAccountAlive）', async () => {
    mockRoutes({
      'https://creator.douyin.com/aweme/v1/creator/pc/user/info/': { status_code: 8, status_msg: '未登录' },
    })
    const result = await checker.checkLoginViaHttpApi('douyin', cookies)
    expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
  })

  // ─── 字段路径锚定到**真实服务端响应**（CCG 评审 i4）──
  // 上一轮这些用例喂的是手写 mock，字段名一旦写错 mock 与实现会一起错。
  // 下面三份 fixture 是 2026-10-22 用本机已登录账号的 Cookie 实测到的**真实响应形状**
  // （只保留字段结构，值已脱敏；取证记录见 openspec/records/fix-account-profile-avatar.md）。
  it('xiaohongshu：真实响应形状（galaxy/user/info）⇒ 字段路径与实测一致', async () => {
    const REAL_XHS_USER_INFO = {
      result: 1,
      success: true,
      code: 0,
      data: {
        userId: '5f1a2b3c00000000002a1b3c',
        userName: '真实昵称',
        userAvatar: 'https://sns-avatar-qc.xhscdn.com/avatar/1040g2jo31f4g7li6me605pm5tehncbt224i4ono?imageView2/2/w/60/format/webp',
        redId: 'zhiaxga1hz',
        role: 1,
        permissions: ['note'],
        realNameVerified: false,
      },
    }
    mockRoutes({
      'https://creator.xiaohongshu.com/api/galaxy/user/info': REAL_XHS_USER_INFO,
      'https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info': { success: true, data: { name: '真实昵称', fans_count: 457, follow_count: 102, faved_count: 5454 } },
    })
    const info = await checker.fetchAccountInfoViaHttpApi('xiaohongshu', cookies)
    expect(info.nickname).toBe('真实昵称')
    expect(info.avatar).toBe(REAL_XHS_USER_INFO.data.userAvatar)
    expect(info.followers).toBe(457)
    expect(info.platformAccountId).toBe('5f1a2b3c00000000002a1b3c')
  })

  it('douyin：真实响应形状（web/api/media/user/info）⇒ 顶层 user + avatar_larger.url_list', async () => {
    const REAL_DOUYIN_USER_INFO = {
      country_code: 'CN',
      status_code: 0,
      login_app: 'aweme',
      user: {
        uid: '2232445177172442',
        nickname: '真实昵称',
        follower_count: 266,
        following_count: 358,
        aweme_count: 137,
        sec_uid: 'MS4wLjABAAAAwjEtmZ7OxkNFM-e62997efIa0Lo2iIcaPyfnzHQaILc2_M-m-7s4HoaL8qq0huya',
        unique_id: 'rio007007',
        avatar_larger: {
          uri: '1080x1080/aweme-avatar/tos-cn-i-0813c000-ce_oYIGPrAt3Bl8BEf4bJpJgxAAID8TXeAEbgeL75',
          url_list: ['https://p3.douyinpic.com/aweme/1080x1080/aweme-avatar/tos-cn-i-0813c000-ce_oYIGPrAt3Bl8BEf4bJpJgxAAID8TXeAEbgeL75.jpeg?from'],
        },
        avatar_medium: { uri: '720x720/aweme-avatar/x', url_list: ['https://p3.douyinpic.com/aweme/720x720/aweme-avatar/x.jpeg'] },
        avatar_thumb: { uri: '100x100/aweme-avatar/x', url_list: ['https://p3.douyinpic.com/aweme/100x100/aweme-avatar/x.jpeg'] },
      },
    }
    mockRoutes({ 'https://creator.douyin.com/web/api/media/user/info/': REAL_DOUYIN_USER_INFO })
    const info = await checker.fetchAccountInfoViaHttpApi('douyin', cookies)
    expect(info.nickname).toBe('真实昵称')
    expect(info.avatar).toBe(REAL_DOUYIN_USER_INFO.user.avatar_larger.url_list[0])
    expect(info.followers).toBe(266)
    expect(info.platformAccountId).toBe('2232445177172442')
  })

  it('zhihu：真实响应形状（/api/v4/me）⇒ name + avatar_url', async () => {
    const REAL_ZHIHU_ME = {
      id: '013a4b7c9d2e4f6a8b0c1d2e3f4a5b6c',
      url_token: 'zhiaxga1hz',
      name: '真实昵称',
      avatar_url: 'https://picx.zhimg.com/v2-22dfe7094375e34e38695123acd219db_xl.jpg',
      avatar_url_template: 'https://picx.zhimg.com/v2-22dfe7094375e34e38695123acd219db_l.jpg',
      use_default_avatar: false,
      is_org: false,
      type: 'people',
    }
    mockRoutes({ 'https://www.zhihu.com/api/v4/me': REAL_ZHIHU_ME })
    const info = await checker.fetchAccountInfoViaHttpApi('zhihu', cookies)
    expect(info.nickname).toBe('真实昵称')
    expect(info.avatar).toBe(REAL_ZHIHU_ME.avatar_url)
    expect(info.platformAccountId).toBe(REAL_ZHIHU_ME.id)
  })

  // ─── 凭据出口（CCG 评审 i4，security）──
  it('只把属于目标主机的 Cookie 发过去（不整包外发）', async () => {
    const f = mockRoutes({
      'https://www.zhihu.com/api/v4/me': { id: 'u1', name: '秋叔' },
    })
    await checker.fetchAccountInfoViaHttpApi('zhihu', [
      { name: 'z_c0', value: 'zhihu-cookie', domain: '.zhihu.com' },
      { name: 'other', value: 'other-site-cookie', domain: '.example.com' },
    ])
    expect(f).toHaveBeenCalledTimes(1)
    const sent = f.mock.calls[0][1].headers.Cookie
    expect(sent).toContain('z_c0=zhihu-cookie')
    expect(sent).not.toContain('other-site-cookie')
  })

  it('目标主机不在平台登记域名内时一个 Cookie 都不发、也不发请求（fail-closed）', async () => {
    const original = checker.HTTP_PROFILE_APIS.zhihu
    const f = vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) }))
    vi.stubGlobal('fetch', f)
    try {
      checker.HTTP_PROFILE_APIS.zhihu = [{
        url: 'https://evil.example.com/steal',
        headers: {},
        extract: () => ({ nickname: 'x' }),
      }]
      const info = await checker.fetchAccountInfoViaHttpApi('zhihu', [{ name: 'z_c0', value: 'secret', domain: '.zhihu.com' }])
      expect(info).toEqual({ supported: true })
      expect(f).not.toHaveBeenCalled()
    } finally {
      checker.HTTP_PROFILE_APIS.zhihu = original
    }
  })

  // ─── 通用契约 ──
  it('粉丝数 0 是合法值（不得被当成「没取到」丢掉）', async () => {
    mockRoutes({
      'https://creator.xiaohongshu.com/api/galaxy/user/info': { success: true, data: { userName: '甲' } },
      'https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info': { success: true, data: { fans_count: 0 } },
    })
    const info = await checker.fetchAccountInfoViaHttpApi('xiaohongshu', cookies)
    expect(info.followers).toBe(0)
  })

  it('平台返回非 2xx 时不产出任何字段（不得猜值）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '', json: async () => null }))
    expect(await checker.fetchAccountInfoViaHttpApi('zhihu', cookies)).toEqual({ supported: true })
  })

  it('网络异常时降级为空结果（不抛错）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    expect(await checker.fetchAccountInfoViaHttpApi('zhihu', cookies)).toEqual({ supported: true })
  })
})
