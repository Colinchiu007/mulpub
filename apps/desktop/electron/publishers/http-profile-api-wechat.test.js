import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * http-profile-api — 公众号（wechat_mp）账号资料来源契约
 *
 * 背景（2026-10-23 实测，逆向成果交叉验证）：
 * 竞品逆向成果里出现一个头像端点线索 `mp.weixin.qq.com/misc/getheadimg?fakeid=`，
 * 但本轮**实测**发现更直接的事实：**公众号登录页模板本身就内嵌账号资料对象**
 * `window.wx.commonData.data`，字段含 `head_img` / `head_url`（头像）与
 * `nick_name_decode` / `real_nick_name` / `nick_name`（昵称）。
 * 模板原注释：
 *   nick_name        // encode 一次
 *   nick_name_decode // encode 一次 decode 一次，因为空格需要特殊转义处理
 *   real_nick_name   // 真实 nick_name，后台无兜底逻辑，未设置则返回空
 *   head_img         // ''.replace('http://', 'https://')
 *
 * ⇒ 头像**零新增请求**即可拿到（我方本来就在抓这一页），且昵称应取**解码后**的那份，
 *   否则带空格的昵称会显示成转义残渣。
 *
 * 夹具纪律（CCG 评审 i2，高危域「auth」）：夹具里的昵称/账号 ID/头像 URL
 * **全部是虚构值**（example.invalid 保留域）。真实账号昵称/ID 属用户数据，
 * 不得进仓库夹具；解析规则与真实模板同构（字段名、赋值形态、转义形态一致），
 * 值用假的即可。
 *
 * 运行前置（CCG 评审 i4）：本文件用到 `global.__enableElectronMock()` /
 * `global.__resetElectronMock()` / `__registerMock()` 三个全局，它们由
 * `apps/desktop/test-setup.js` 安装，而该文件登记在 `vitest.config.js` 的
 * `setupFiles`（另有 `vitest.stryker.config.js` 同款）⇒ **在本仓的 vitest 下必然存在**，
 * 与同目录 `http-login-checker-info.test.js` / `http-login-checker-profile.test.js`
 * 依赖的是同一套全局。
 * 因此**不写**「global 不存在就跳过」的防御分支：那会让本文件在 setupFiles
 * 缺失时**静默不跑**（用例数变 0 而 CI 仍绿）—— 与「vitest 的 include 是白名单、
 * 未登记的文件一个都不会跑」是同一类静默失败。
 * 反过来，若将来要在本仓之外单独跑本文件，必须先加载 test-setup.js，
 * 否则会在 `beforeEach` 里因 `global.__enableElectronMock is not a function` 立刻失败
 * （这是**响亮失败**，正是我们要的）。
 */

/**
 * 虚构的公众号登录页模板（结构与真实模板同构，值全部虚构）
 *
 * ⚠ 函数名与字段名（`handlerNickname` / `nick_name_decode` / `head_img` …）**只是同构模拟**，
 * 用于让解析器面对与真实模板**同形**的输入；它们不代表真实服务端实现，
 * 真实模板的结构以 2026-10-23 实测为准，而本文件里的**值一律是虚构的**。
 */
const WX_LOGIN_TEMPLATE = `
<script>
  var handlerNickname = function (str, escape) {
    var ar = ['&#39;', '\\'', '&quot;', '"', '&nbsp;', ' ', '&gt;', '>', '&lt;', '<', '&amp;', '&'];
    var arReverse = ['&#39;', '\\'', '&quot;', '"', '&nbsp;', ' ', '&gt;', '>', '&lt;', '<', '&amp;', '&'];
    var target; if (escape === false) { target = arReverse; } else { target = ar; }
    var r = str; for (var i = 0; i < target.length; i += 2) { r = r.replace(new RegExp(target[i], 'g'), target[1 + i]); }
    return r;
  };
  window.wx.commonData = { version: "5.0.0", uin: "9000000001",
    data: { t: "0000000000", ticket: "xxxxxx", lang: 'zh_CN', param: ["&token=", '&lang=zh_CN'].join(""),
      uin: "9000000001", uin_base64: "OTAwMDAwMDAwMQ==", user_name: "gh_fakeid",
      nick_name: "&#20320;&#20320;",
      nick_name_decode: handlerNickname("假假 甲", false),
      real_nick_name: "假假 甲",
      time: 1700000000, disable_head_box: 0, open_app_type: 0, serviceType: 0,
      realnameType: 1, isPersonVerify: 0, isWxVerify: 1, is_qverify: 0,
      sp_login: 0, sp_user_name: '', sp_nick_name: '',
      head_img: "http://example.invalid/fake-avatar.jpg".replace('http://', 'https://'),
      head_url: "https://example.invalid/fake-avatar-alt.jpg", alias: "fake_alias",
      verify_status: 0,
    }, path: { video: '' } };
</script>
`

const WX_LOGIN_PAGE = '<html><body><div class="login_scanTips">请使用微信扫码</div>' +
  '<script>var pageData = { uin: "", nick_name: "" };</script></body></html>'

/**
 * 去掉一个「函数调用形态」的字段（nick_name_decode: handlerNickname(...),）
 *
 * ⚠ 参数体按**引号内字符串**匹配，而不是 `[^)]*`（CCG 评审 i6）：
 * `[^)]*` 会在昵称里出现 `)` 时提前结束匹配 —— 替换掉半截字段，
 * 剩下的半截留在夹具里，测试「看起来改了」其实没改干净。
 * 引号形态与真实模板一致（双引号），故按 `"[^"]*"` 匹配参数即可。
 */
const dropFnField = (field) => new RegExp(field + ':\\s*[A-Za-z_$][\\w$.]*\\(\\s*"[^"]*"[^)]*\\),\\s*', 'g')
/** 去掉一个「字符串形态」的字段（值后面可能还跟着 .replace(...)，要一并吃掉） */
const dropStrField = (field) => new RegExp(field + ':\\s*"[^"]*"(\\.replace\\(\\s*(?:"[^"]*"|\'[^\']*\')\\s*,\\s*(?:"[^"]*"|\'[^\']*\')\\s*\\))?,\\s*', 'g')

describe('http-profile-api — 公众号账号资料来源', () => {
  /** @type {any} */
  let api
  /** @type {any} */
  let parser

  beforeEach(async () => {
    vi.resetModules()
    global.__enableElectronMock()
    global.__resetElectronMock()
    __registerMock('./logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    api = await import('./http-profile-api.js')
    // 解析器已拆到独立模块（逐文件行数门禁），这里**直接**测它 ——
    // 结构化失败原因在取数链路上观察不到（链路只暴露命中字段）。
    parser = await import('./wechat-mp-profile-parser.js')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mockHtml = (html) => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(html) })
    vi.stubGlobal('fetch', f)
    return f
  }

  it('wechat_mp 从登录页模板取出昵称、头像与平台ID', async () => {
    mockHtml(WX_LOGIN_TEMPLATE)
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])

    // 昵称取**解码后**的那份（平台自己 decode 过，空格是真空格）
    expect(info.nickname).toBe('假假 甲')
    // 头像来自 head_img，且 http:// 被归一成 https://（平台模板自己就这么做）
    expect(info.avatar).toBe('https://example.invalid/fake-avatar.jpg')
    expect(info.avatar).not.toMatch(/^http:\/\//)
    expect(info.platformAccountId).toBe('9000000001')
  })

  it('head_img 缺失时回落 head_url', async () => {
    mockHtml(WX_LOGIN_TEMPLATE.replace(dropStrField('head_img'), ''))
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(info.avatar).toBe('https://example.invalid/fake-avatar-alt.jpg')
  })

  it('昵称优先级：nick_name_decode → real_nick_name → nick_name（都不合格则不产出）', async () => {
    // 只有 encode 过的 nick_name（HTML 实体形态）时也可用，但取到的应是模板里那份
    mockHtml(WX_LOGIN_TEMPLATE
      .replace(dropFnField('nick_name_decode'), '')
      .replace(dropStrField('real_nick_name'), ''))
    const onlyEncoded = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(onlyEncoded.nickname).toBe('&#20320;&#20320;')

    // 三个都没有 → 不产出昵称键
    mockHtml(WX_LOGIN_TEMPLATE
      .replace(dropFnField('nick_name_decode'), '')
      .replace(dropStrField('real_nick_name'), '')
      .replace(dropStrField('nick_name'), ''))
    const none = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect('nickname' in none).toBe(false)
  })

  it('模板占位值（{{…}}）不得被当成昵称或头像', async () => {
    mockHtml(WX_LOGIN_TEMPLATE
      .replace(dropFnField('nick_name_decode'), '')
      .replace(dropStrField('real_nick_name'), '')
      .replace(dropStrField('nick_name'), 'nick_name: "{{nickname}}", ')
      .replace(dropStrField('head_img'), 'head_img: "{{head_img}}", ')
      .replace(dropStrField('head_url'), 'head_url: "{{head_url}}", '))
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect('nickname' in info).toBe(false)
    expect('avatar' in info).toBe(false)
  })

  it('登录页形态（未登录）不产出任何资料字段', async () => {
    mockHtml(WX_LOGIN_PAGE)
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(info).toEqual({ supported: true })
  })

  it('单引号形态的字段值同样能解析（模板引号形态不保证一致）', async () => {
    mockHtml(WX_LOGIN_TEMPLATE
      .replace(/nick_name_decode: handlerNickname\("([^"]*)", false\)/, "nick_name_decode: handlerNickname('$1', false)")
      .replace(/head_img: "([^"]*)"/, "head_img: '$1'"))
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(info.nickname).toBe('假假 甲')
    expect(info.avatar).toBe('https://example.invalid/fake-avatar.jpg')
  })

  // ── 形态白名单（CCG 评审 i3/i4）──
  it('非 http/https 的头像 URL 一律拒绝（不得把 javascript:/data: 放进 <img src>）', async () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd']) {
      // head_img 放非法值、head_url 一并去掉 ⇒ 产出里不得出现任何头像
      mockHtml(WX_LOGIN_TEMPLATE
        .replace(dropStrField('head_img'), `head_img: "${bad}", `)
        .replace(dropStrField('head_url'), ''))
      const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
      expect('avatar' in info, '非法 scheme 未被拒绝: ' + bad).toBe(false)
    }
  })

  it('head_img 非法时回落 head_url（而不是整条放弃头像）', async () => {
    mockHtml(WX_LOGIN_TEMPLATE.replace(dropStrField('head_img'), 'head_img: "javascript:alert(1)", '))
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(info.avatar).toBe('https://example.invalid/fake-avatar-alt.jpg')
  })

  it('昵称超长或含控制字符时拒绝（形态白名单，而非仅判非空）', async () => {
    const tooLong = '甲'.repeat(41)
    mockHtml(WX_LOGIN_TEMPLATE
      .replace(dropFnField('nick_name_decode'), '')
      .replace(dropStrField('real_nick_name'), '')
      .replace(dropStrField('nick_name'), `nick_name: "${tooLong}", `))
    const long = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect('nickname' in long).toBe(false)

    // 真正的控制字符（BEL）—— 不是字面量 "\u0007" 六个字符
    mockHtml(WX_LOGIN_TEMPLATE
      .replace(dropFnField('nick_name_decode'), '')
      .replace(dropStrField('real_nick_name'), '')
      .replace(dropStrField('nick_name'), 'nick_name: "甲' + '\u0007' + '乙", '))
    const control = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect('nickname' in control).toBe(false)
  })

  it('页面异常大（>2MB）时不解析也不产出（防异常大页面拖慢正则扫描）', async () => {
    const huge = WX_LOGIN_TEMPLATE + 'x'.repeat(3 * 1024 * 1024)
    mockHtml(huge)
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(info).toEqual({ supported: true })
  })

  // ── 体积判据按**字节**算（CCG 评审 i6）──
  it('多字节页面按字节判体积：字符数未超限但字节超限时同样不解析', async () => {
    // 1.5M 个中文 = 1.5M 个 UTF-16 单元（< 2MB 阈值，按字符数会放行）
    // 但 UTF-8 字节数 = 4.5MB（> 2MB 阈值）⇒ 必须被拦下。
    // 这条用例把「判据到底按字符还是按字节」钉死：只按字符的实现会在这里产出资料。
    const multibyte = WX_LOGIN_TEMPLATE + '字'.repeat(1_500_000)
    expect(multibyte.length).toBeLessThan(2 * 1024 * 1024)          // 字符数未超限
    expect(Buffer.byteLength(multibyte, 'utf8')).toBeGreaterThan(2 * 1024 * 1024) // 字节数超限
    mockHtml(multibyte)
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(info).toEqual({ supported: true })
  })

  // ── 引号闭合（CCG 评审 i5）──
  it('字段值里含异种引号时不截断（双引号值里可以含单引号，反之亦然）', async () => {
    // 双引号形态的值里含单引号：旧写法 `[^"\']*` 会在第一个单引号处停住，
    // 把昵称截成「假假」——显示出来的名字就少了后半截。
    mockHtml(WX_LOGIN_TEMPLATE
      .replace(dropFnField('nick_name_decode'), '')
      .replace(dropStrField('real_nick_name'), '')
      .replace(dropStrField('nick_name'), 'nick_name: "假\'假 甲", '))
    const withSingleQuote = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(withSingleQuote.nickname).toBe("假'假 甲")

    // 单引号形态的值里含双引号：同样不能截断。
    mockHtml(WX_LOGIN_TEMPLATE
      .replace(dropFnField('nick_name_decode'), '')
      .replace(dropStrField('real_nick_name'), '')
      .replace(dropStrField('nick_name'), 'nick_name: \'假"假 甲\', '))
    const withDoubleQuote = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(withDoubleQuote.nickname).toBe('假"假 甲')
  })

  it('函数调用形态的值里含异种引号时不截断', async () => {
    mockHtml(WX_LOGIN_TEMPLATE.replace(
      /nick_name_decode: handlerNickname\("[^"]*", false\)/,
      'nick_name_decode: handlerNickname("假\'假 甲", false)'))
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(info.nickname).toBe("假'假 甲")
  })

  // ── 第 3 轮外部评审落地的判据 ──
  it('函数名与左括号之间有空格时也能取到昵称（模板改个空格不该让昵称静默消失）', async () => {
    mockHtml(WX_LOGIN_TEMPLATE.replace(
      /nick_name_decode: handlerNickname\("[^"]*", false\)/,
      'nick_name_decode: handlerNickname ("假假 甲", false)'))
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(info.nickname).toBe('假假 甲')
  })

  it('头像主机不是公网形态时一律拒绝（IP 字面量 / 本机 / 单标签 / 内网后缀）', async () => {
    for (const bad of [
      'https://192.168.1.1/avatar.jpg',
      'https://127.0.0.1/avatar.jpg',
      'https://[::1]/avatar.jpg',
      'https://localhost/avatar.jpg',
      'https://box.local/avatar.jpg',
      'https://svc.internal/avatar.jpg',
      'https://intranet/avatar.jpg',
    ]) {
      mockHtml(WX_LOGIN_TEMPLATE
        .replace(dropStrField('head_img'), `head_img: "${bad}", `)
        .replace(dropStrField('head_url'), ''))
      const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
      expect('avatar' in info, '非公网头像主机未被拒绝: ' + bad).toBe(false)
    }
  })

  it('公网形态的头像主机照常保留（白名单不得误杀真头像）', async () => {
    mockHtml(WX_LOGIN_TEMPLATE
      .replace(dropStrField('head_img'), 'head_img: "https://cdn.example.com/a/b/avatar.jpg", ')
      .replace(dropStrField('head_url'), ''))
    const info = await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(info.avatar).toBe('https://cdn.example.com/a/b/avatar.jpg')
  })

  it('wechat_mp 的资料来源仍是只读 GET（不得引入有副作用的端点）', async () => {
    const f = mockHtml(WX_LOGIN_TEMPLATE)
    await api.fetchAccountInfoViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
    expect(f.mock.calls[0][0]).toBe('https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome')
    expect(f.mock.calls[0][1].method).toBe('GET')
  })
})

// ── 结构化失败原因（CCG 评审 i3）──────────────────────────────────────────
// 为什么单独测：`reason` 只在解析器里产出，取数链路只暴露「命中了哪些字段」，
// 于是「模板改版」与「字段值不合法」在链路上长得一模一样 —— 分不开就没法排查。
describe('wechat-mp-profile-parser — 结构化失败原因', () => {
  /** @type {any} */
  let parse

  beforeEach(async () => {
    vi.resetModules()
    global.__enableElectronMock()
    global.__resetElectronMock()
    parse = (await import('./wechat-mp-profile-parser.js')).parseWechatMpIdentity
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('非字符串/空输入 ⇒ no_html', () => {
    expect(parse(undefined).reason).toBe('no_html')
    expect(parse('').reason).toBe('no_html')
    expect(parse(123).reason).toBe('no_html')
  })

  it('登录页形态 ⇒ login_page（且不产出任何字段）', () => {
    const r = parse('<html>请使用微信扫码</html>')
    expect(r.reason).toBe('login_page')
    expect(r.nickname).toBe('')
    expect(r.avatar).toBe('')
    expect(r.platformAccountId).toBe('')
  })

  it('页面不像登录页但一个身份字段都没解析出 ⇒ identity_fields_missing（多半是模板改版）', () => {
    const r = parse('<html><body>hello</body></html>')
    expect(r.reason).toBe('identity_fields_missing')
  })

  it('字段在但填的是模板占位值 ⇒ identity_fields_invalid（不是 missing）', () => {
    // CCG 评审 i1：占位值是「字段在、值不合格」，与「字段不存在」是两种事实。
    // 混为一谈会把「这次没渲染出昵称」误报成「模板改版」。
    const r = parse('<script>var d = { uin: "{{uin}}", nick_name: "{{nickname}}", head_img: "{{head_img}}" };</script>')
    expect(r.nickname).toBe('')
    expect(r.avatar).toBe('')
    expect(r.platformAccountId).toBe('')
    expect(r.reason).toBe('identity_fields_invalid')
  })

  it('昵称是占位值但其它字段正常 ⇒ nickname_invalid（值不合格，不是字段缺失）', () => {
    const r = parse('<script>var d = { uin: "9000000001", nick_name: "{{nickname}}", head_img: "https://cdn.example.com/a.jpg" };</script>')
    expect(r.nickname).toBe('')
    expect(r.avatar).toBe('https://cdn.example.com/a.jpg')
    expect(r.reason).toBe('nickname_invalid')
  })

  it('昵称形态不合格（超长）⇒ nickname_invalid', () => {
    const tooLong = '甲'.repeat(41)
    const r = parse('<script>var d = { uin: "9000000001", nick_name: "' + tooLong + '" };</script>')
    expect(r.nickname).toBe('')
    expect(r.reason).toBe('nickname_invalid')
  })

  it('头像字段在但 scheme 非法 ⇒ avatar_rejected_scheme', () => {
    const r = parse('<script>var d = { uin: "9000000001", nick_name: "假假", head_img: "javascript:alert(1)" };</script>')
    expect(r.avatar).toBe('')
    expect(r.reason).toBe('avatar_rejected_scheme')
  })

  it('页面异常大 ⇒ page_too_large（按字节判，不截断）', () => {
    const r = parse('<script>var d = { uin: "9000000001" };</script>' + '字'.repeat(1_500_000))
    expect(r.reason).toBe('page_too_large')
    expect(r.platformAccountId).toBe('')
  })

  it('正常页 ⇒ reason 为空串（不是失败）', () => {
    const r = parse('<script>var d = { uin: "9000000001", nick_name: "假假" };</script>')
    expect(r.reason).toBe('')
    expect(r.nickname).toBe('假假')
    expect(r.platformAccountId).toBe('9000000001')
  })
})
