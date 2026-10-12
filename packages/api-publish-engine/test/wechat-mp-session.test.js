'use strict'
/**
 * 微信公众号 API 轨 —— 会话 bootstrap 与群发保护预检（PRD §F1 / §F5，校验组 C / T1-T2）。
 *
 * 判据全部落在「提取出了什么」与「发没发出请求」上——不测实现细节。
 */
const assert = require('node:assert/strict')
const test = require('node:test')

const { createFakeHttp, LOGIN_PAGE_HTML } = require('./helpers/wechat-mp-fake-http')
const {
  extractSession,
  fetchSession,
  parseProtectionHtml,
  checkMassSendProtection,
} = require('../src/adapters/wechat-mp/session')

test('extractSession 提取六个字段（C1-C2）', () => {
  const s = extractSession(LOGIN_PAGE_HTML)
  assert.equal(s.token, '1234567890')
  assert.equal(s.nickName, '测试公众号')
  assert.equal(s.authorId, '123456789')
  assert.equal(s.ticketId, 'gh_ticket_abc')
  assert.equal(s.ticket, 'v2_ticket_xyz')
  assert.equal(s.canAppMsg, 1)
})

test('extractSession 不把 user_name 的值当成 ticket', () => {
  // 反例：`gh_ticket_abc` 里含 "ticket"，若用无边界正则 + 贪婪 .* 会互相串味
  const s = extractSession(LOGIN_PAGE_HTML)
  assert.notEqual(s.ticket, s.ticketId)
  assert.equal(s.ticket, 'v2_ticket_xyz')
})

test('extractSession 空输入不抛，字段全空', () => {
  const s = extractSession('')
  assert.equal(s.token, '')
  assert.equal(s.authorId, '')
})

test('fetchSession 命中 loginpage 且带 cookie（C1）', async () => {
  const http = createFakeHttp([
    { method: 'GET', match: (u) => u.includes('/cgi-bin/loginpage'), respond: { data: LOGIN_PAGE_HTML } },
  ])
  const s = await fetchSession(http, { cookie: 'sid=abc' })
  assert.equal(s.token, '1234567890')
  const call = http.calls[0]
  assert.match(call.url, /cgi-bin\/loginpage/)
  assert.equal(call.headers.Cookie, 'sid=abc')
})

test('fetchSession 无 token ⇒ needRelogin 且不再发任何请求（C1/C3）', async () => {
  const http = createFakeHttp([
    { method: 'GET', match: (u) => u.includes('/cgi-bin/loginpage'), respond: { data: '<html>请登录</html>' } },
  ])
  await assert.rejects(
    () => fetchSession(http, { cookie: 'sid=abc' }),
    (err) => {
      assert.equal(err.code, 'needRelogin')
      return true
    }
  )
  assert.equal(http.calls.length, 1, '登录失效后不得继续发请求')
})

test('fetchSession 空 cookie 直接失败，不空跑网络（C3）', async () => {
  const http = createFakeHttp([])
  await assert.rejects(() => fetchSession(http, { cookie: '' }), (err) => err.code === 'needRelogin')
  assert.equal(http.calls.length, 0, '空 cookie 不得发出请求')
})

test('parseProtectionHtml：安全中心未开通 ⇒ 未保护', () => {
  assert.equal(parseProtectionHtml('<html>未开通安全中心</html>'), false)
})

test('parseProtectionHtml：protect_status=1 ⇒ 已保护', () => {
  const html = '<script>var wx={}; wx.cgiData = {"protect_status":1};</script>'
  assert.equal(parseProtectionHtml(html), true)
})

test('parseProtectionHtml：protect_status=0 ⇒ 未保护', () => {
  const html = '<script>wx.cgiData = {"protect_status":0};</script>'
  assert.equal(parseProtectionHtml(html), false)
})

test('checkMassSendProtection：未开群发 ⇒ 发都不发（T1）', async () => {
  const http = createFakeHttp([])
  const r = await checkMassSendProtection(http, { cookie: 'c=1', token: 't1', massSend: false })
  assert.equal(r.ok, true)
  assert.equal(r.skipped, true)
  assert.equal(http.calls.length, 0, '只存草稿时不得请求安全中心')
})

test('checkMassSendProtection：群发 + 保护开启 ⇒ 拦下并给可操作文案（T2）', async () => {
  const http = createFakeHttp([
    {
      method: 'GET',
      match: (u) => u.includes('safecenterstatus'),
      respond: { data: '<script>wx.cgiData = {"protect_status":1};</script>' },
    },
  ])
  const r = await checkMassSendProtection(http, { cookie: 'c=1', token: 't1', massSend: true })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'mass-send-protected')
  assert.match(r.error, /安全中心/)
  assert.match(r.error, /群发/)
})

test('checkMassSendProtection：群发 + 未开通安全中心 ⇒ 放行且不抛（fail-open）', async () => {
  const http = createFakeHttp([
    { method: 'GET', match: (u) => u.includes('safecenterstatus'), respond: { data: '<html>no cgiData</html>' } },
  ])
  const r = await checkMassSendProtection(http, { cookie: 'c=1', token: 't1', massSend: true })
  assert.equal(r.ok, true)
})

test('checkMassSendProtection：请求抛错 ⇒ 放行（预检是增益不是依据）', async () => {
  const http = createFakeHttp([
    { method: 'GET', match: (u) => u.includes('safecenterstatus'), respond: new Error('ETIMEDOUT') },
  ])
  const r = await checkMassSendProtection(http, { cookie: 'c=1', token: 't1', massSend: true })
  assert.equal(r.ok, true)
  assert.equal(r.degraded, true)
})
