'use strict'
/**
 * 微信公众号 API 轨 —— 图片上传（PRD §F2，校验组 B）。
 *
 * 两条轨不可互换：URL 走 uploadimg2cdn，本地文件走 filetransfer multipart。
 * 关键判据：最终 URL 只能来自平台回包。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createFakeHttp, SESSION } = require('./helpers/wechat-mp-fake-http')
const {
  MAX_COVER_BYTES,
  extToMime,
  isHttpUrl,
  pickUploadedUrl,
  uploadImageByUrl,
  uploadLocalImage,
  uploadImage,
} = require('../src/adapters/wechat-mp/assets')

function tmpFile (name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-mp-assets-'))
  const p = path.join(dir, name)
  fs.writeFileSync(p, Buffer.alloc(bytes, 7))
  return p
}

test('isHttpUrl 只认 http(s)', () => {
  assert.equal(isHttpUrl('https://a.com/x.png'), true)
  assert.equal(isHttpUrl('http://a.com/x.png'), true)
  assert.equal(isHttpUrl('C:\\img\\x.png'), false)
  assert.equal(isHttpUrl('//a.com/x.png'), false)
  assert.equal(isHttpUrl(''), false)
  assert.equal(isHttpUrl(undefined), false)
})

test('extToMime 扩展名映射（B3）', () => {
  assert.equal(extToMime('a.JPG'), 'jpeg')
  assert.equal(extToMime('a.jpeg'), 'jpeg')
  assert.equal(extToMime('a.png'), 'png')
  assert.equal(extToMime('a.gif'), 'gif')
  assert.equal(extToMime('a.webp'), 'webp')
  assert.equal(extToMime('a.bmp'), 'jpeg', '未知扩展名回落 jpeg')
  assert.equal(extToMime('noext'), 'jpeg')
})

test('pickUploadedUrl 优先 cdn_url，其次 url（B4）', () => {
  assert.equal(pickUploadedUrl({ cdn_url: 'https://mmbiz.qpic.cn/a', url: 'https://x/b' }), 'https://mmbiz.qpic.cn/a')
  assert.equal(pickUploadedUrl({ url: 'https://x/b' }), 'https://x/b')
  assert.equal(pickUploadedUrl({}), '')
  assert.equal(pickUploadedUrl(null), '')
})

test('uploadImageByUrl 命中 uploadimg2cdn，imgUrl 编码恰好一次（B5 防二次编码）', async () => {
  const http = createFakeHttp([
    {
      method: 'POST',
      match: (u) => u.includes('uploadimg2cdn'),
      respond: { data: { url: 'https://mmbiz.qpic.cn/mmbiz_png/AAA/0', img_format: 'png', file_id: 42 } },
    },
  ])
  const src = 'https://example.com/a b.png?x=1&y=2'
  const r = await uploadImageByUrl(http, { cookie: 'sid=1', token: 'tok', url: src })
  assert.equal(r.url, 'https://mmbiz.qpic.cn/mmbiz_png/AAA/0')
  assert.equal(r.fileId, '42')
  assert.equal(r.format, 'png')
  const call = http.calls[0]
  assert.match(call.url, /uploadimg2cdn/)
  // query 参数（与参考产品一致）
  assert.equal(call.params.lang, 'zh_CN')
  assert.equal(call.params.token, 'tok')
  assert.match(String(call.params.t), /^0\.428538/)
  // body 参数（解码后应逐字段等于原值；若实现做了二次编码，这里会拿到 %2520 之类）
  const parsed = new URLSearchParams(String(call.body))
  assert.equal(parsed.get('t'), 'ajax-editor-upload-img')
  assert.equal(parsed.get('imgUrl'), src, 'imgUrl 必须编码恰好一次')
  assert.equal(parsed.get('f'), 'json')
  assert.equal(parsed.get('ajax'), '1')
  assert.ok(!String(call.body).includes('imgUrl=' + src), '不得原样拼未编码的 URL')
})

test('uploadLocalImage 命中 filetransfer 且 scene=8 / ticket_id 来自会话（B6）', async () => {
  const http = createFakeHttp([
    {
      method: 'POST',
      match: (u) => u.includes('filetransfer'),
      respond: { data: { cdn_url: 'https://mmbiz.qpic.cn/mmbiz_jpg/BBB/0', content: 'fileid-9', type: 'image/jpeg' } },
    },
  ])
  const file = tmpFile('cover.png', 128)
  const r = await uploadLocalImage(http, { cookie: 'sid=1', session: SESSION, filePath: file })
  assert.equal(r.url, 'https://mmbiz.qpic.cn/mmbiz_jpg/BBB/0')
  assert.equal(r.fileId, 'fileid-9')
  const call = http.calls[0]
  assert.match(call.url, /filetransfer/)
  assert.equal(call.params.action, 'upload_material')
  assert.equal(call.params.scene, 8)
  assert.equal(call.params.writetype, 'doublewrite')
  assert.equal(call.params.ticket_id, SESSION.ticketId)
  assert.equal(call.params.ticket, SESSION.ticket)
  assert.equal(call.params.token, SESSION.token)
  assert.equal(call.params.f, 'json')
  assert.equal(call.params.lang, 'zh_CN')
  assert.ok(call.body instanceof FormData, 'body 必须是 multipart')
  assert.equal(call.body.get('type'), 'image/png')
  assert.equal(call.body.get('name'), 'cover.png')
  assert.ok(call.body.get('file'), 'file 字段必须存在')
  const ct = String(call.headers['Content-Type'] || '')
  assert.match(ct, /multipart\/form-data/)
})

test('uploadLocalImage 文件不存在 ⇒ cover-upload-failed（B1）', async () => {
  const http = createFakeHttp([])
  await assert.rejects(
    () => uploadLocalImage(http, { cookie: 'c', session: SESSION, filePath: path.join(os.tmpdir(), 'no-such-file-xyz.png') }),
    (err) => err.code === 'cover-upload-failed'
  )
  assert.equal(http.calls.length, 0, '文件不存在不得发请求')
})

test('uploadLocalImage 超过 2MB ⇒ cover-upload-failed 且文案带实际大小（B2）', async () => {
  const http = createFakeHttp([])
  const file = tmpFile('big.png', MAX_COVER_BYTES + 1)
  await assert.rejects(
    () => uploadLocalImage(http, { cookie: 'c', session: SESSION, filePath: file }),
    (err) => {
      assert.equal(err.code, 'cover-upload-failed')
      assert.match(String(err.message), /2MB|2097152|大小/)
      return true
    }
  )
  assert.equal(http.calls.length, 0, '超限不得发请求')
})

test('恰好 2MB 允许（边界值）', async () => {
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('filetransfer'), respond: { data: { cdn_url: 'https://mmbiz.qpic.cn/x/0' } } },
  ])
  const file = tmpFile('edge.png', MAX_COVER_BYTES)
  const r = await uploadLocalImage(http, { cookie: 'c', session: SESSION, filePath: file })
  assert.equal(r.url, 'https://mmbiz.qpic.cn/x/0')
})

test('回包无 URL ⇒ 抛错，且绝不回退用输入路径（B4）', async () => {
  const http = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('filetransfer'), respond: { data: { base_resp: { ret: -1, err_msg: 'nope' } } } },
  ])
  const file = tmpFile('cover.png', 64)
  await assert.rejects(
    () => uploadLocalImage(http, { cookie: 'c', session: SESSION, filePath: file }),
    (err) => {
      assert.equal(err.code, 'cover-upload-failed')
      assert.ok(!String(err.message).includes(file), '错误里不得把本地路径当成结果 URL')
      return true
    }
  )
})

test('uploadImage 按来源自动选轨（本地 vs URL）', async () => {
  const localHttp = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('filetransfer'), respond: { data: { cdn_url: 'https://mmbiz.qpic.cn/local/0' } } },
  ])
  const file = tmpFile('c.png', 32)
  const a = await uploadImage(localHttp, { cookie: 'c', session: SESSION, source: file })
  assert.equal(a.sourceKind, 'local')
  assert.equal(a.url, 'https://mmbiz.qpic.cn/local/0')

  const urlHttp = createFakeHttp([
    { method: 'POST', match: (u) => u.includes('uploadimg2cdn'), respond: { data: { url: 'https://mmbiz.qpic.cn/remote/0' } } },
  ])
  const b = await uploadImage(urlHttp, { cookie: 'c', session: SESSION, source: 'https://example.com/i.png' })
  assert.equal(b.sourceKind, 'url')
  assert.equal(b.url, 'https://mmbiz.qpic.cn/remote/0')
})

test('缺少 ticket/ticketId 时本地图片上传必须失败（C4）', async () => {
  const http = createFakeHttp([])
  const file = tmpFile('c.png', 32)
  await assert.rejects(
    () => uploadLocalImage(http, { cookie: 'c', session: { token: 't', ticketId: '', ticket: '' }, filePath: file }),
    (err) => err.code === 'cover-upload-failed'
  )
  assert.equal(http.calls.length, 0)
})
