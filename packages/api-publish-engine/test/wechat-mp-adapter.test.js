'use strict'
/**
 * 微信公众号 API 适配器 —— 端到端编排与**消灭假成功**的回归锁（PRD §F4，AC-5/AC-6）。
 *
 * 本文件的核心用例是「没有 appMsgId 就绝不能报成功」与「不再打列表端点」：
 * 这两条正是本 PR 要修掉的假成功形态（旧实现的 publish() 忽略 postData、只查列表、返回 success）。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createFakeHttp, LOGIN_PAGE_HTML, SESSION } = require('./helpers/wechat-mp-fake-http')

const COVER_CDN = 'https://mmbiz.qpic.cn/mmbiz_png/UPLOADED/0'
const CONTENT = '<p>这是正文的第一段内容，用于回读校验。</p>'
const ARTICLE = { title: '标题一', content: CONTENT, digest: '摘要', author: '作者名' }

function tmpCover () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-mp-adapter-'))
  const p = path.join(dir, 'cover.png')
  fs.writeFileSync(p, Buffer.alloc(64, 3))
  return p
}

function readbackHtml (opts = {}) {
  const title = opts.title === undefined ? '标题一' : opts.title
  const body = opts.body === undefined ? CONTENT : opts.body
  const cover = opts.cover === undefined ? `<img src="${COVER_CDN}">` : opts.cover
  return `<div id="js_title">${title}</div><div class="ProseMirror">${body}</div>${cover}`
}

/** 默认成功的假 HTTP：loginpage → filetransfer → operate_appmsg → appmsg_edit */
function happyHttp (overrides = {}) {
  return createFakeHttp([
    { method: 'GET', match: (u) => u.includes('loginpage'), respond: { data: LOGIN_PAGE_HTML } },
    {
      method: 'POST',
      match: (u) => u.includes('filetransfer'),
      respond: { data: { cdn_url: COVER_CDN, content: 'fid-1', type: 'image/png' } },
    },
    {
      method: 'POST',
      match: (u) => u.includes('operate_appmsg'),
      respond: overrides.create || { data: { appMsgId: 100000001, base_resp: { ret: 0 } } },
    },
    {
      method: 'GET',
      match: (u) => u.includes('appmsg_edit'),
      respond: { data: overrides.readback === undefined ? readbackHtml() : overrides.readback },
    },
  ])
}

function loadAdapter () {
  // 每例重新 require，避免实例间状态串味；适配器把 http 作为可注入字段
  delete require.cache[require.resolve('../src/adapters/wechat_mp')]
  const Adapter = require('../src/adapters/wechat_mp')
  return new Adapter()
}

async function runPublish ({ adapter, http, postData, cookie = 'sid=1' }) {
  adapter.http = http
  return adapter.publish(cookie, postData)
}

test('成功路径：会话→封面上传→建草稿→回读，publishId = appMsgId', async () => {
  const http = happyHttp()
  const cover = tmpCover()
  const r = await runPublish({
    adapter: loadAdapter(),
    http,
    postData: { ...ARTICLE, cover_path: cover, contentSourceUrl: 'https://example.com/src' },
  })
  assert.equal(r.success, true, r.error)
  assert.equal(r.publishId, '100000001')
  assert.equal(r.platform, 'wechat_mp')
  // 封面写进 create body 的五个槽位
  const createCall = http.callsTo('operate_appmsg')[0]
  const body = decodeURIComponent(String(createCall.body))
  for (const k of ['cdn_url0', 'cdn_235_1_url0', 'cdn_16_9_url0', 'cdn_1_1_url0', 'cdn_url_back0']) {
    assert.ok(body.includes(`${k}=${COVER_CDN}`), `缺 ${k}`)
  }
  assert.ok(body.includes('sourceurl0=https://example.com/src'))
})

test('🔴 无 appMsgId ⇒ 必须失败（消灭假成功，AC-5）', async () => {
  const http = happyHttp({ create: { data: { base_resp: { ret: 0, err_msg: 'ok' } } } })
  const r = await runPublish({
    adapter: loadAdapter(),
    http,
    postData: { ...ARTICLE, cover_path: tmpCover() },
  })
  assert.equal(r.success, false, '没有 appMsgId 绝不能报成功')
  assert.equal(r.code, 'draft-not-created')
})

test('🔴 不再请求 appmsgpublish 列表端点（AC-6）', async () => {
  const http = happyHttp()
  await runPublish({ adapter: loadAdapter(), http, postData: { ...ARTICLE, cover_path: tmpCover() } })
  assert.equal(http.callsTo('appmsgpublish').length, 0, '旧实现打的列表端点必须消失')
})

test('回读正文为空 ⇒ 失败且 code=readback-mismatch（H4）', async () => {
  const http = happyHttp({ readback: readbackHtml({ body: '' }) })
  const r = await runPublish({ adapter: loadAdapter(), http, postData: { ...ARTICLE, cover_path: tmpCover() } })
  assert.equal(r.success, false)
  assert.equal(r.code, 'readback-mismatch')
  assert.ok(r.detail, '必须带回读明细')
})

test('回读标题缺失 ⇒ 失败（H1）', async () => {
  const http = happyHttp({ readback: readbackHtml({ title: '别的标题' }) })
  const r = await runPublish({ adapter: loadAdapter(), http, postData: { ...ARTICLE, cover_path: tmpCover() } })
  assert.equal(r.success, false)
  assert.equal(r.code, 'readback-mismatch')
})

test('登录失效 ⇒ needRelogin 且未发起任何写操作（AC-2）', async () => {
  const http = createFakeHttp([
    { method: 'GET', match: (u) => u.includes('loginpage'), respond: { data: '<html>login</html>' } },
  ])
  const r = await runPublish({ adapter: loadAdapter(), http, postData: { ...ARTICLE, cover_path: tmpCover() } })
  assert.equal(r.success, false)
  assert.equal(r.code, 'needRelogin')
  assert.equal(http.callsTo('operate_appmsg').length, 0)
})

test('无封面 ⇒ 失败 cover-required，且不建草稿（D8）', async () => {
  const http = happyHttp()
  const r = await runPublish({ adapter: loadAdapter(), http, postData: { ...ARTICLE } })
  assert.equal(r.success, false)
  assert.equal(r.code, 'cover-required')
  assert.equal(http.callsTo('operate_appmsg').length, 0, '没有封面不得建草稿')
})

test('正文为空 ⇒ 失败，不建只有标题的草稿（D7）', async () => {
  const http = happyHttp()
  const r = await runPublish({
    adapter: loadAdapter(),
    http,
    postData: { title: '只有标题', content: '', cover_path: tmpCover() },
  })
  assert.equal(r.success, false)
  assert.equal(http.callsTo('operate_appmsg').length, 0, '正文为空不得建草稿')
})

test('多图文 ⇒ multi-article-unsupported 且不发请求（D6）', async () => {
  const http = happyHttp()
  const r = await runPublish({
    adapter: loadAdapter(),
    http,
    postData: { contentList: [ARTICLE, ARTICLE], cover_path: tmpCover() },
  })
  assert.equal(r.success, false)
  assert.equal(r.code, 'multi-article-unsupported')
  assert.equal(http.calls.length, 0)
})

test('封面已是平台 CDN ⇒ 直接复用，不重复上传（省一次往返）', async () => {
  const http = happyHttp()
  const r = await runPublish({
    adapter: loadAdapter(),
    http,
    postData: { ...ARTICLE, cover_url: COVER_CDN },
  })
  assert.equal(r.success, true, r.error)
  assert.equal(http.callsTo('filetransfer').length, 0, 'CDN URL 不应再走本地上传')
  assert.equal(http.callsTo('uploadimg2cdn').length, 0, 'CDN URL 不应再走 URL 上传')
})

test('buildPostData 把封面与文章字段映射进 postData（含 cover_path 透传）', () => {
  const adapter = loadAdapter()
  const postData = adapter.buildPostData({
    title: '标题一',
    content: '正文 #话题#',
    tags: ['话题'],
    cover_path: '/tmp/c.png',
    digest: '摘要',
    author: '作者名',
    content_source_url: 'https://example.com/src',
  })
  assert.equal(postData.title, '标题一')
  assert.equal(postData.cover_path, '/tmp/c.png')
  assert.equal(postData.digest, '摘要')
  assert.equal(postData.author, '作者名')
  assert.equal(postData.contentSourceUrl, 'https://example.com/src')
  assert.ok(!postData.content.includes('#话题#'), '话题应从正文剥离（既有契约）')
})

test('buildPostData 复用 execute 阶段已上传的封面 URL', () => {
  const adapter = loadAdapter()
  const postData = adapter.buildPostData({ title: 't', content: 'c' }, { cover: { url: COVER_CDN } })
  assert.equal(postData.cover_url, COVER_CDN)
})

test('uploadVideo 对图文返回 null（不误判为视频平台）', async () => {
  const adapter = loadAdapter()
  assert.equal(await adapter.uploadVideo({}, 'cookie'), null)
})
