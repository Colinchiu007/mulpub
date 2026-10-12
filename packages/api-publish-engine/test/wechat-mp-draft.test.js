'use strict'
/**
 * 微信公众号 API 轨 —— 草稿请求体构造、创建与回读（PRD §F3 / §5.3 / §5.4）。
 *
 * buildDraftBody 是纯函数，逐字段断言；createDraft/readbackDraft 用假 HTTP。
 */
const assert = require('node:assert/strict')
const test = require('node:test')

const { createFakeHttp, SESSION } = require('./helpers/wechat-mp-fake-http')
const {
  COVER_SLOTS,
  buildDraftBody,
  buildArticleFields,
  mapCommentSetting,
  serializeFields,
  createDraft,
  readbackDraft,
  htmlToText,
} = require('../src/adapters/wechat-mp/draft')

const COVER = 'https://mmbiz.qpic.cn/mmbiz_png/AAA/0'
const ARTICLE = {
  title: '标题一',
  content: '<p>这是正文的第一段内容，用于回读校验。</p>',
  digest: '摘要',
  author: '作者名',
  contentSourceUrl: 'https://example.com/src',
  coverUrl: COVER,
}

function parseBody (body) {
  const out = {}
  for (const pair of String(body || '').split('&')) {
    if (!pair) continue
    const i = pair.indexOf('=')
    const k = i < 0 ? pair : pair.slice(0, i)
    const v = i < 0 ? '' : pair.slice(i + 1)
    out[k] = decodeURIComponent(v)
  }
  return out
}

test('封面 5 槽位定义与参考产品一致（D2）', () => {
  assert.deepEqual(COVER_SLOTS, ['cdn_url', 'cdn_235_1_url', 'cdn_16_9_url', 'cdn_1_1_url', 'cdn_url_back'])
})

test('封面五槽位同值（D2）', () => {
  const body = parseBody(buildDraftBody(ARTICLE, 0))
  for (const slot of COVER_SLOTS) {
    assert.equal(body[`${slot}0`], COVER, `${slot}0 必须等于上传回包 URL`)
  }
  // 五者必须两两相等（防止只写 cdn_url0 的实现蒙混过关）
  const values = COVER_SLOTS.map((s) => body[`${s}0`])
  assert.equal(new Set(values).size, 1)
})

test('字段名带文章序号，值已编码（D1）', () => {
  const raw = buildDraftBody(ARTICLE, 0)
  assert.match(raw, /(^|&)title0=/)
  assert.ok(!raw.includes('标题一'), '中文标题必须被 encodeURIComponent')
  assert.deepEqual(Object.keys(parseBody(buildDraftBody(ARTICLE, 2))).filter((k) => k === 'title2'), ['title2'])
})

test('基础字段映射（title/content/digest/author/sourceurl）', () => {
  const body = parseBody(buildDraftBody(ARTICLE, 0))
  assert.equal(body.title0, '标题一')
  assert.equal(body.content0, ARTICLE.content)
  assert.equal(body.digest0, '摘要')
  assert.equal(body.author0, '作者名')
  assert.equal(body.sourceurl0, 'https://example.com/src')
  assert.equal(body.auto_gen_digest0, '1')
  assert.equal(body.crop_list0, '{}')
  assert.equal(body.show_cover_pic0, '0')
  assert.equal(body.fileid0, '0')
})

test('原文链接仅接受 http(s)（D4）', () => {
  const bad = parseBody(buildDraftBody({ ...ARTICLE, contentSourceUrl: 'javascript:alert(1)' }, 0))
  assert.equal(bad.sourceurl0, '')
  const empty = parseBody(buildDraftBody({ ...ARTICLE, contentSourceUrl: '' }, 0))
  assert.equal(empty.sourceurl0, '')
})

test('截断：title 64 / digest 120 / author 60（D3）', () => {
  const body = parseBody(buildDraftBody({
    ...ARTICLE,
    title: 'A'.repeat(80),
    digest: 'B'.repeat(200),
    author: 'C'.repeat(90),
  }, 0))
  assert.equal(body.title0.length, 64)
  assert.equal(body.digest0.length, 120)
  assert.equal(body.author0.length, 60)
})

test('评论三态映射（D5）', () => {
  assert.deepEqual(mapCommentSetting(0), { need_open_comment: 0, only_fans_can_comment: 0, only_fans_days_can_comment: 0 })
  assert.deepEqual(mapCommentSetting(1), { need_open_comment: 1, only_fans_can_comment: 1, only_fans_days_can_comment: 0 })
  assert.deepEqual(mapCommentSetting(2), { need_open_comment: 1, only_fans_can_comment: 0, only_fans_days_can_comment: 1 })
  assert.deepEqual(mapCommentSetting(3), { need_open_comment: 1, only_fans_can_comment: 0, only_fans_days_can_comment: 0 })
  // 未指定按「所有人可评」（本仓既有语义：openComment 缺省为开）
  assert.deepEqual(mapCommentSetting(undefined), mapCommentSetting(3))
})

test('关闭评论时不写 need_open_comment=1（D5）', () => {
  const body = parseBody(buildDraftBody({ ...ARTICLE, commentSetting: 0 }, 0))
  assert.equal(body.need_open_comment0, '0')
  assert.equal(body.reply_flag0, '2')
})

test('buildArticleFields 不产生 undefined 值（防 JSON/表单序列化丢键）', () => {
  const fields = buildArticleFields({ title: 't', content: '<p>c</p>' }, '')
  for (const [k, v] of Object.entries(fields)) {
    assert.notEqual(v, undefined, `${k} 不得为 undefined`)
    assert.notEqual(v, null, `${k} 不得为 null`)
  }
  assert.equal(fields.cdn_url, '')
})

test('serializeFields 跳过 undefined/null（不产出 name=undefined）', () => {
  const s = serializeFields({ a: '1', b: undefined, c: null, d: '' }, 0)
  assert.equal(s, 'a0=1&d0=')
})

test('createDraft 顶层参数齐全 + 使用 operate_appmsg create type=77', async () => {
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('operate_appmsg'), respond: { data: { appMsgId: 100000001, base_resp: { ret: 0 } } } },
  ])
  const r = await createDraft(http, { cookie: 'sid=1', session: SESSION, body: 'title0=t', count: 1 })
  assert.equal(r.appMsgId, 100000001)
  const call = http.calls[0]
  assert.match(call.url, /cgi-bin\/operate_appmsg/)
  assert.equal(call.params.sub, 'create')
  assert.equal(call.params.t, 'ajax-response')
  assert.equal(call.params.type, 77)
  assert.equal(call.params.token, SESSION.token)
  assert.equal(call.params.lang, 'zh_CN')
  for (const k of ['token=', 'lang=zh_CN', 'f=json', 'ajax=1', 'AppMsgId=', 'count=1', 'articlenum=1', 'data_seq=0', 'operate_from=Chrome', 'isnew=0', 'remind_flag=null']) {
    assert.ok(String(call.body).includes(k), `body 缺少 ${k}`)
  }
})

test('createDraft 无 appMsgId ⇒ draft-not-created（D7 的核心）', async () => {
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('operate_appmsg'), respond: { data: { base_resp: { ret: 0, err_msg: 'ok' } } } },
  ])
  await assert.rejects(
    () => createDraft(http, { cookie: 'c', session: SESSION, body: 'title0=t', count: 1 }),
    (err) => {
      assert.equal(err.code, 'draft-not-created')
      return true
    }
  )
})

test('createDraft ret=64714 ⇒ originality-required（AC-8）', async () => {
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('operate_appmsg'), respond: { data: { ret: '64714', base_resp: { ret: '64714', err_msg: 'x' } } } },
  ])
  await assert.rejects(
    () => createDraft(http, { cookie: 'c', session: SESSION, body: 'title0=t', count: 1 }),
    (err) => {
      assert.equal(err.code, 'originality-required')
      assert.match(err.message, /原创/)
      return true
    }
  )
})

test('createDraft 接口报错 ⇒ draft-not-created 且带平台原文', async () => {
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('operate_appmsg'), respond: { data: { base_resp: { ret: -1, err_msg: '系统繁忙' } } } },
  ])
  await assert.rejects(
    () => createDraft(http, { cookie: 'c', session: SESSION, body: 'title0=t', count: 1 }),
    (err) => {
      assert.equal(err.code, 'draft-not-created')
      assert.match(err.message, /系统繁忙/)
      return true
    }
  )
})

test('htmlToText 去脚本/样式/标签', () => {
  const t = htmlToText('<script>var a=1;</script><style>.x{}</style><p>甲&nbsp;乙</p>')
  assert.ok(t.includes('甲'))
  assert.ok(t.includes('乙'))
  assert.ok(!t.includes('var a=1'))
})

test('readbackDraft 三项齐全（H1-H3）', async () => {
  const html = [
    '<div id="js_title">标题一</div>',
    '<div class="ProseMirror">这是正文的第一段内容，用于回读校验。</div>',
    `<img src="${COVER}">`,
  ].join('')
  const http = createFakeHttp([
    { method: 'GET', match: (u) => u.includes('appmsg_edit'), respond: { data: html } },
  ])
  const r = await readbackDraft(http, { cookie: 'c', session: SESSION, appMsgId: '100000001', expect: ARTICLE })
  assert.equal(r.titleOk, true)
  assert.equal(r.contentOk, true)
  assert.equal(r.coverOk, true)
  assert.equal(r.ok, true)
  const call = http.calls[0]
  assert.match(call.url, /appmsgid=100000001/)
  assert.match(call.url, /type=77/)
})

test('readbackDraft 正文为空 ⇒ contentOk=false（H2）', async () => {
  const html = '<div id="js_title">标题一</div><div class="ProseMirror"></div>'
  const http = createFakeHttp([{ method: 'GET', match: (u) => u.includes('appmsg_edit'), respond: { data: html } }])
  const r = await readbackDraft(http, { cookie: 'c', session: SESSION, appMsgId: '1', expect: ARTICLE })
  assert.equal(r.contentOk, false)
  assert.equal(r.ok, false)
})

test('readbackDraft 标题缺失 ⇒ titleOk=false（H1）', async () => {
  const html = `<div>别的标题</div><div>这是正文的第一段内容，用于回读校验。</div><img src="${COVER}">`
  const http = createFakeHttp([{ method: 'GET', match: (u) => u.includes('appmsg_edit'), respond: { data: html } }])
  const r = await readbackDraft(http, { cookie: 'c', session: SESSION, appMsgId: '1', expect: ARTICLE })
  assert.equal(r.titleOk, false)
  assert.equal(r.ok, false)
})

test('readbackDraft 封面缺失 ⇒ coverOk=false（H3）', async () => {
  const html = '<div id="js_title">标题一</div><div>这是正文的第一段内容，用于回读校验。</div>'
  const http = createFakeHttp([{ method: 'GET', match: (u) => u.includes('appmsg_edit'), respond: { data: html } }])
  const r = await readbackDraft(http, { cookie: 'c', session: SESSION, appMsgId: '1', expect: ARTICLE })
  assert.equal(r.coverOk, false)
  assert.equal(r.ok, false)
})

test('无封面期望时不要求封面（coverUrl 为空）', async () => {
  const html = '<div>标题一</div><div>这是正文的第一段内容，用于回读校验。</div>'
  const http = createFakeHttp([{ method: 'GET', match: (u) => u.includes('appmsg_edit'), respond: { data: html } }])
  const r = await readbackDraft(http, { cookie: 'c', session: SESSION, appMsgId: '1', expect: { title: '标题一', content: ARTICLE.content } })
  assert.equal(r.coverOk, true)
  assert.equal(r.ok, true)
})
