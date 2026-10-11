'use strict'
/**
 * 微信公众号 API 轨测试夹具：可注入的假 HTTP（零真实网络）。
 *
 * 为什么单独成文件而不是塞进某个 .test.js：四个测试文件都要用；
 * 文件名不匹配 `*.test.js`，因此不会被 run-tests.js 当成用例执行。
 */

/** 造一个假 http，规则按顺序匹配（第一条命中即用）。 */
function createFakeHttp (rules) {
  const calls = []

  function find (method, url, cfg) {
    for (const r of rules) {
      if (r.method && r.method !== method) continue
      if (!r.match(url, cfg)) continue
      return r
    }
    return null
  }

  function record (method, url, body, cfg) {
    const call = {
      method,
      url,
      body,
      params: (cfg && cfg.params) || {},
      headers: (cfg && cfg.headers) || {},
    }
    calls.push(call)
    return call
  }

  function respond (rule, call) {
    const out = typeof rule.respond === 'function' ? rule.respond(call) : rule.respond
    if (out instanceof Error) throw out
    return {
      status: (out && out.status) || 200,
      data: out ? out.data : undefined,
      headers: (out && out.headers) || {},
    }
  }

  return {
    calls,
    callsTo (fragment) {
      return calls.filter((c) => String(c.url).includes(fragment))
    },
    async get (url, cfg) {
      const call = record('GET', url, undefined, cfg)
      const rule = find('GET', url, cfg)
      if (!rule) return { status: 404, data: '' }
      return respond(rule, call)
    },
    async post (url, body, cfg) {
      const call = record('POST', url, body, cfg)
      const rule = find('POST', url, cfg)
      if (!rule) return { status: 404, data: '' }
      return respond(rule, call)
    },
  }
}

/** 真实 loginpage 的形态（含 token/nick_name/uin/user_name/ticket/can_app_msg）。
 *  注意字段写法与真实页面一致：`uin: "..."`（无引号包裹键名），
 *  与参考产品取证时用的正则口径对齐（`uin:[\s]{0,}"[0-9]{3,}"`）。 */
const LOGIN_PAGE_HTML = [
  '<script>',
  'var biz = "MjM5";',
  'var data = { user_name: "gh_ticket_abc", nick_name: "测试公众号", uin: "123456789", ticket: "v2_ticket_xyz", material_acl: {"can_app_msg": 1} };',
  '</script>',
  '<a href="/cgi-bin/home?t=home/index&lang=zh_CN&token=1234567890">首页</a>',
].join('\n')

/** 会话对象（测试里到处要用，抽出来免得多处硬编码）。 */
const SESSION = {
  token: '1234567890',
  nickName: '测试公众号',
  authorId: '123456789',
  ticketId: 'gh_ticket_abc',
  ticket: 'v2_ticket_xyz',
  canAppMsg: 1,
}

module.exports = { createFakeHttp, LOGIN_PAGE_HTML, SESSION }
