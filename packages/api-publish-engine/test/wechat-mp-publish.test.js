'use strict'
/**
 * 微信公众号 API 轨发布/群发链测试（wechat-mp-publish-track，PRD §G）。
 * 全部走注入的 fake http，无网络。判据锚点 = 参考产品逐函数契约。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const load = (rel) => require(path.join(__dirname, '../src/adapters/wechat-mp', rel))
const publish = load('publish')

function fakeHttp (responses) {
  const calls = []
  const queue = responses.slice()
  const http = {
    calls,
    async post (url, body, opts) {
      calls.push({ method: 'post', url, body, opts })
      const item = queue.shift()
      if (item && item.throw) throw item.throw
      // 默认成功回包：copyright 检查以 err_msg==='default' 判通过（参考产品判据），
      // 其余检查只看 ret，故默认 err_msg 用 'default' 对两者都成立。
      return item ? item.json : { base_resp: { ret: 0, err_msg: 'default' } }
    },
    async get (url, opts) {
      calls.push({ method: 'get', url, opts })
      const item = queue.shift()
      return item ? item.json !== undefined ? item.json : item.text : ''
    },
  }
  return http
}

const CTX = { cookie: 'c=1', token: 't1', appMsgId: '700001' }

test('runPublishChecks：5 道检查全过 ⇒ ok（顺序与端点/动作正确）', async () => {
  const http = fakeHttp([])
  const r = await publish.runPublishChecks(http, CTX)
  assert.equal(r.ok, true)
  const posts = http.calls.filter((c) => c.method === 'post')
  assert.equal(posts.length, 5)
  assert.match(posts[0].url, /masssend\?t=ajax-response&for_check=1&is_release_publish_page=1/)
  assert.match(posts[1].url, /masssend\?action=check_same_material/)
  assert.match(posts[2].url, /masssend\?action=get_appmsg_copyright_stat/)
  assert.match(posts[3].url, /masssend\?action=check_ad/)
  assert.match(posts[4].url, /masssend\?action=check_music/)
  // body 带 appmsgid
  for (const p of posts) assert.match(p.body, /appmsgid=700001/)
})

test('runPublishChecks：copyright 的 err_msg=default 才算通过（缺 base_resp ⇒ fail-closed）', async () => {
  const http = fakeHttp([
    { json: { base_resp: { ret: 0 } } },
    { json: { base_resp: { ret: 0 } } },
    // copyright：没有 err_msg='default' ⇒ 不通过
    { json: { base_resp: { ret: 0, err_msg: 'some-error' } } },
  ])
  const r = await publish.runPublishChecks(http, CTX)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'publish-copyright-failed')
})

test('runPublishChecks：原创冲突给出冲突文章链接', async () => {
  const http = fakeHttp([
    { json: { base_resp: { ret: 0 } } },
    { json: { base_resp: { ret: 0 } } },
    { json: { base_resp: { ret: 0, err_msg: 'xxx found reprint from other article' }, list: JSON.stringify({ list: [{ source_url: 'https://mp.weixin.qq.com/s/abc' }] }) } },
  ])
  const r = await publish.runPublishChecks(http, CTX)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'publish-copyright-conflict')
  assert.match(r.error, /https:\/\/mp\.weixin\.qq\.com\/s\/abc/)
})

test('runMassSendChecks：群发页未签协议 ⇒ 先 setprotocolsign 再重拉，且取到 operation_seq', async () => {
  const http = fakeHttp([
    { text: '腾讯提醒你 ... 同意以上声明 ... operation_seq:["op_seq_123"]' }, // 第一次群发页
    { json: { base_resp: { ret: 0 } } }, // setprotocolsign 的 POST 回包
    { text: 'ok operation_seq: "op_seq_123"' }, // 签署后重拉
  ])
  const r = await publish.runMassSendChecks(http, CTX)
  assert.equal(r.ok, true)
  assert.equal(r.operationSeq, 'op_seq_123')
  const posts = http.calls.filter((c) => c.method === 'post')
  assert.ok(posts.some((c) => c.url.includes('setprotocolsign') && c.body.includes('issigned=1')), '应有协议签署请求')
})

test('runMassSendChecks：正文过短（64715 + TEXT_NUM_TOO_SMALL）⇒ 可操作文案', async () => {
  const http = fakeHttp([
    { text: 'operation_seq: "x"' },
    { json: { base_resp: { ret: 64715, err_msg: 'TEXT_NUM_TOO_SMALL ...' } } },
  ])
  const r = await publish.runMassSendChecks(http, CTX)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'masssend-original-too-short')
  assert.match(r.error, /300/)
})

test('buildPushBody：21 字段全量对齐参考产品（发布态 isFreePublish 双写）', () => {
  const body = publish.buildPushBody(
    { sex: 0, groupId: '', country: '全部', province: '广东', city: '深圳', publishTime: 0 },
    '700001', 't1', { operationSeq: '', isFreePublish: true },
  )
  for (const frag of [
    'token=t1', 'lang=zh_CN&f=json&ajax=1&random=', 'type=10', 'ack=', 'reprint_info=',
    'reprint_confirm=0', 'list=', 'appmsgid=700001', 'share_page=1', 'sex=0', 'groupid=',
    'isMulti=0', 'synctxweibo=0', 'sync_version=1', 'isFreePublish=true', 'fingerprint=',
    'country=', 'province=%E5%B9%BF%E4%B8%9C', 'city=%E6%B7%B1%E5%9C%B3',
    'operation_seq=', 'req_id=', 'req_time=', 'send_time=0', 'code=',
  ]) {
    assert.ok(body.includes(frag), `应包含 ${frag}`)
  }
  assert.equal(body.match(/isFreePublish=true/g).length, 2, '发布态 isFreePublish 应双写（参考产品原样行为）')
  assert.ok(!body.includes('direct_send=1'), '无定时 ⇒ 不带 direct_send')
})

test('buildPushBody：定时群发 ⇒ direct_send=1 + send_time', () => {
  const body = publish.buildPushBody({ publishTime: 1760000000000 }, '1', 't', { operationSeq: 'op', isFreePublish: false })
  assert.ok(body.includes('direct_send=1'))
  assert.ok(body.includes('send_time=1760000000000'))
  assert.ok(body.includes('operation_seq=op'))
  assert.ok(body.includes('isFreePublish=false'))
})

test('sendPush：ret=0 ⇒ 成功不重试', async () => {
  const http = fakeHttp([{ json: { base_resp: { ret: 0, err_msg: 'ok' } } }])
  const r = await publish.sendPush(http, Object.assign({}, CTX, { delayFn: async () => {} }), 'a=1', { notifySubscribers: 0 })
  assert.equal(r.ok, true)
  assert.equal(r.retried, false)
  assert.match(http.calls[0].url, /is_release_publish_page=1/, '发布路径 URL 应带发布页旗标')
})

test('sendPush：首次失败 ⇒ 5s 后重试一次；第二次成功 ⇒ ok（且 URL 带定时旗标）', async () => {
  const http = fakeHttp([
    { json: { base_resp: { ret: -1, err_msg: 'busy' } } },
    { json: { base_resp: { ret: 0, err_msg: 'ok' } } },
  ])
  const r = await publish.sendPush(http, Object.assign({}, CTX, { delayFn: async () => {} }), 'a=1', { notifySubscribers: 1, publishTime: 1760000000000 })
  assert.equal(r.ok, true)
  assert.equal(r.retried, true)
  assert.equal(http.calls.length, 2)
  assert.match(http.calls[0].url, /action=time_send/, '定时群发应带 time_send 旗标')
})

test('sendPush：两次都失败 ⇒ fail-closed 并带平台文案', async () => {
  const http = fakeHttp([
    { json: { base_resp: { ret: 200013, err_msg: 'freq limit' } } },
    { json: { base_resp: { ret: 200013, err_msg: 'freq limit' } } },
  ])
  const r = await publish.sendPush(http, Object.assign({}, CTX, { delayFn: async () => {} }), 'a=1', { notifySubscribers: 1 })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'masssend-push-failed')
  assert.match(r.error, /freq limit/)
})

test('publishArticle：publish/masssend 全链（masssend 带 operation_seq；未知模式 fail-closed）', async () => {
  const httpOk = fakeHttp([
    { text: 'operation_seq: "op9"' }, // 群发页
    { json: { base_resp: { ret: 0, err_msg: 'default' } } }, // copyright
    { json: { base_resp: { ret: 0 } } }, // ad
    { json: { base_resp: { ret: 0 } } }, // music
    { json: { base_resp: { ret: 0, err_msg: 'ok' } } }, // push
  ])
  const r = await publish.publishArticle(httpOk, { ...CTX, publishMode: 'masssend', task: {} })
  assert.equal(r.ok, true)
  const push = httpOk.calls[httpOk.calls.length - 1]
  assert.match(push.url, /masssend\?t=ajax-response&token=t1/)
  assert.ok(!push.url.includes('is_release_publish_page'), '群发路径不带发布页旗标')
  assert.match(push.body, /operation_seq=op9/)

  const bad = await publish.publishArticle(fakeHttp([]), { ...CTX, publishMode: 'bogus' })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'publish-mode-unsupported')
})
